import {
  MessagesAnnotation,
  StateGraph,
  START,
  Annotation,
} from "@langchain/langgraph/web";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  ToolMessage,
} from "@langchain/core/messages";
import DOMPurify from "dompurify";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  LlmInfos,
  modelViaLanggraph,
  TokensUsage,
} from "../langraphModelsLoader";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import { createChildBlock } from "../../../utils/roamAPI";
import { insertStructuredAIResponse } from "../../responseInsertion";
import { chatRoles, getInstantAssistantRole, defaultModel } from "../../..";
import {
  updateAgentToaster,
  replaceLastToasterMessage,
  parseJSONWithFields,
  generateSummaryText,
} from "../shared/agentsUtils";

// Import our tools registry
import { getAvailableTools } from "./tools/toolsRegistry";

// Import search utilities
import { deduplicateResultsByUid } from "./helpers/searchUtils";
import { performAdaptiveExpansion } from "./helpers/contextExpansion";
import { applyIntermediateContentTruncation } from "./helpers/contentTruncation";
import {
  determineComplexity,
  determineApproach,
  generateExecutionSteps,
} from "./helpers/queryAnalysis";
import {
  getContextualExpansionOptions,
  buildRetryGuidance,
} from "./helpers/expansionUI";
import { logger } from "./helpers/logging";
import { uiMessages } from "./helpers/uiMessages";

// Import prompts from separate file
import {
  buildSystemPrompt,
  buildIntentParserPrompt,
  buildFinalResponseSystemPrompt,
  buildCacheProcessingPrompt,
  buildCacheSystemPrompt,
} from "./ask-your-graph-prompts";
import { modelAccordingToProvider } from "../../aiAPIsHub";

// Result summary interface for token optimization
interface ResultSummary {
  id: string;
  toolName: string;
  query: string;
  totalCount: number;
  resultType: "blocks" | "pages" | "references" | "hierarchy" | "combinations";
  sampleItems: string[]; // First 5 items for context
  metadata: {
    wasLimited: boolean;
    canExpand: boolean;
    searchTerms: string[];
    sortedBy?: "creation" | "modification" | "alphabetical" | "random";
    availableCount: number;
    // Type-specific info
    dataType?: "blocks" | "pages"; // For combinations: what the UIDs represent
    operation?: string; // For combinations: union/intersection/etc
    formatType?: "string" | "structured"; // For hierarchy: content vs structure
    hierarchyDepth?: number; // For hierarchy: max depth
  };
}

const ReactSearchAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  model: Annotation<LlmInfos>,
  rootUid: Annotation<string>,
  targetUid: Annotation<string>,
  userQuery: Annotation<string>,
  searchTools: Annotation<any[]>,
  // Conversation state
  conversationHistory: Annotation<any[]>,
  conversationSummary: Annotation<string | undefined>,
  isConversationMode: Annotation<boolean>,
  isDirectChat: Annotation<boolean>,
  chatSystemPrompt: Annotation<string | undefined>,
  // Permissions
  permissions: Annotation<{ contentAccess: boolean; noTruncation?: boolean }>,
  privateMode: Annotation<boolean>, // Strict Private mode - only UIDs, no content processing
  // Results tracking and caching (following MCP agent pattern)
  toolResults: Annotation<Record<string, any>>,
  toolResultsCache: Annotation<Record<string, any>>, // Cache for comprehensive follow-ups
  cachedFullResults: Annotation<Record<string, any>>, // Store full results even when truncated for LLM
  hasLimitedResults: Annotation<boolean>, // Flag to indicate results were truncated
  // NEW: Token optimization - metadata for LLM, full results for tools
  resultSummaries: Annotation<Record<string, ResultSummary>>, // Metadata for LLM context
  resultStore: Annotation<
    Record<
      string,
      {
        data: any[];
        purpose: "final" | "intermediate" | "replacement" | "completion";
        status: "active" | "superseded";
        replacesResultId?: string;
        completesResultId?: string;
        toolName: string;
        timestamp: number;
        metadata?: any; // Tool metadata for access in directFormat
        error?: string; // Track tool errors vs successful results with 0 data
      }
    >
  >, // Full results with lifecycle management
  nextResultId: Annotation<number>, // Counter for generating unique result IDs
  finalAnswer: Annotation<string | undefined>,
  // Streaming response state
  streamElement: Annotation<HTMLElement | null | undefined>,
  wasStreamed: Annotation<boolean>,
  streamingTargetUid: Annotation<string | undefined>,
  // Token tracking across entire agent execution
  totalTokensUsed: Annotation<{ input: number; output: number }>,
  // Timing tracking - separate LLM vs tool execution
  timingMetrics: Annotation<{
    totalLlmTime: number; // milliseconds spent in LLM calls
    totalToolTime: number; // milliseconds spent in tool execution
    llmCalls: number; // number of LLM calls made
    toolCalls: number; // number of tool executions
  }>,
  // Request analysis and routing
  routingDecision: Annotation<
    | "use_cache"
    | "need_new_search"
    | "analyze_complexity"
    | "show_privacy_dialog"
    | "show_scope_options"
  >,
  reformulatedQuery: Annotation<string | undefined>,
  originalSearchContext: Annotation<string | undefined>,
  // Enhanced complexity analysis
  queryComplexity: Annotation<"simple" | "logical" | "multi-step">,
  userIntent: Annotation<string | undefined>,
  // Privacy escalation
  currentMode: Annotation<string | undefined>,
  suggestedMode: Annotation<string | undefined>,
  pendingPrivacyEscalation: Annotation<boolean>,
  privacyMessage: Annotation<string | undefined>,
  // New symbolic query fields
  formalQuery: Annotation<string | undefined>,
  searchStrategy: Annotation<"direct" | "hierarchical" | undefined>,
  forceHierarchical: Annotation<boolean | undefined>,
  analysisType: Annotation<
    "count" | "compare" | "connections" | "summary" | undefined
  >,
  language: Annotation<string | undefined>,
  confidence: Annotation<number | undefined>,
  datomicQuery: Annotation<string | undefined>,
  needsPostProcessing: Annotation<boolean | undefined>,
  postProcessingType: Annotation<string | undefined>,
  // Semantic expansion: simplified boolean flag + strategy
  isExpansionGlobal: Annotation<boolean | undefined>,
  semanticExpansion: Annotation<
    | "fuzzy"
    | "synonyms"
    | "related_concepts"
    | "broader_terms"
    | "all"
    | "custom"
    | undefined
  >,
  customSemanticExpansion: Annotation<string | undefined>,
  searchDetails: Annotation<
    | {
        timeRange?: {
          start: string;
          end: string;
          filterMode?: "created" | "modified";
        };
        maxResults?: number;
        requireRandom?: boolean;
        depthLimit?: number;
        requiresAnalysis?: boolean;
        needsContentExpansion?: boolean; // For scope strategy queries that need content
      }
    | undefined
  >,

  // Expansion tracking
  expansionGuidance: Annotation<string | undefined>,
  expansionState: Annotation<
    | {
        canExpand?: boolean;
        lastResultCount?: number;
        searchStrategy?: string;
        queryComplexity?: string;
        expansionApplied?: boolean;
        hasErrors?: boolean;
        // Semantic expansion history tracking
        appliedSemanticStrategies?: Array<
          "fuzzy" | "synonyms" | "related_concepts" | "broader_terms" | "custom"
        >;
      }
    | undefined
  >,
  expansionConsent: Annotation<boolean>, // User consent for expensive expansions
  zeroResultsAttempts: Annotation<number>, // Track consecutive zero result attempts (max 5)
  // Timing and cancellation
  startTime: Annotation<number>,
  abortSignal: Annotation<AbortSignal | undefined>,
  // Semantic expansion mode setting
  automaticExpansionMode: Annotation<string>,
  // Direct expansion bypass flag
  isDirectExpansion: Annotation<boolean>,
  maxDepthOverride: Annotation<number | null>,
  // Privacy mode update bypass flag
  isPrivacyModeUpdated: Annotation<boolean>,
  // Flag to indicate privacy mode was forced (skip privacy analysis in IntentParser)
  isPrivacyModeForced: Annotation<boolean>,
  // Popup execution mode - skip directFormat and insertResponse
  isPopupExecution: Annotation<boolean | undefined>,
  // Force popup-only results (skip Roam block insertion)
  forcePopupOnly: Annotation<boolean | undefined>,
  // Streaming callback for popup chat interface
  streamingCallback: Annotation<((content: string) => void) | undefined>,
  // Token usage for this turn (returned to caller)
  tokensUsage: Annotation<TokensUsage | undefined>,
  // NEW: Exploratory query scope selection
  pendingScopeOptions: Annotation<
    | Array<{
        strategy: string;
        description: string;
        bestFor: string;
        estimatedCount: number | string;
      }>
    | undefined
  >,
  pendingRecommendedStrategy: Annotation<string | undefined>,
  // Force scope selection dialog (for Pattern analysis command)
  forceScopeSelection: Annotation<boolean | undefined>,
  // Flag to skip scope analysis in IntentParser (when user explicitly skipped scope selection)
  skipScopeAnalysis: Annotation<boolean | undefined>,
});

// Global variables for the agent
let llm: StructuredOutputType;
let turnTokensUsage: TokensUsage;
let searchTools: any[] = [];

// Export function to get current token usage (for popup execution)
export const getCurrentTokenUsage = (): TokensUsage => {
  // console.log(
  //   "🐛 [getCurrentTokenUsage] Stack trace:",
  //   new Error().stack?.split("\n").slice(1, 4).join("\n")
  // );
  return { ...turnTokensUsage }; // Return a copy
};

// Initialize and get all available tools
const initializeTools = (permissions: { contentAccess: boolean }) => {
  // Get tools based on permissions using the registry
  searchTools = getAvailableTools(permissions);

  return searchTools;
};

// Conversation router node for intelligent routing decisions
const conversationRouter = async (
  state: typeof ReactSearchAgentState.State,
) => {
  // Check if forceScopeSelection flag is set (from Pattern analysis command)
  if (state.forceScopeSelection && !state.pendingScopeOptions) {
    logger.info("Force scope selection requested - showing dialog");

    // Generate scope options
    const scopeOptions = [
      {
        strategy: "all_page_titles",
        description: "Scan all page titles for topic overview",
        bestFor: "Quick high-level exploration of all topics in your graph",
        estimatedCount: "all",
      },
      {
        strategy: "recent_dnp",
        description: "Analyze patterns in last 90 daily notes",
        bestFor:
          "Understanding recent activities, habits, and temporal patterns",
        estimatedCount: 90,
      },
      {
        strategy: "random_pages",
        description: "Random sample of 100 pages for diverse patterns",
        bestFor: "Unbiased cross-section and statistical overview",
        estimatedCount: 100,
      },
      {
        strategy: "recent_modified",
        description: "100 most actively edited pages",
        bestFor: "Focus on current work and active projects",
        estimatedCount: 100,
      },
    ];

    // Store scope options and show dialog
    // Keep forceScopeSelection flag so dialog knows not to show skip button
    return {
      routingDecision: "show_scope_options" as const,
      userIntent: state.userIntent || "Exploratory pattern analysis",
      finalAnswer: "Please select a scope strategy for pattern analysis",
      queryComplexity: "multi-step" as const,
      pendingScopeOptions: scopeOptions,
      pendingRecommendedStrategy: "recent_dnp",
      // Keep forceScopeSelection true - will be cleared after dialog selection
    };
  }

  // Check for pending scope selection first
  if (state.pendingScopeOptions && state.pendingScopeOptions.length > 0) {
    logger.info("Pending scope selection detected - processing user choice");

    // Extract strategy selection from user query
    const query = state.userQuery.trim().toLowerCase();
    let selectedStrategy: string | null = null;

    // Try to match by number
    const numberMatch = query.match(/^(\d+)/);
    if (numberMatch) {
      const index = parseInt(numberMatch[1]) - 1;
      if (index >= 0 && index < state.pendingScopeOptions.length) {
        selectedStrategy = state.pendingScopeOptions[index].strategy;
      }
    }

    // Try to match by strategy name
    if (!selectedStrategy) {
      for (const option of state.pendingScopeOptions) {
        if (query.includes(option.strategy.toLowerCase())) {
          selectedStrategy = option.strategy;
          break;
        }
      }
    }

    // If no match or user said "recommended"/"proceed"/"yes", use recommended strategy
    if (
      !selectedStrategy ||
      /^(yes|ok|sure|proceed|recommended|default|go ahead)$/i.test(query)
    ) {
      selectedStrategy = state.pendingRecommendedStrategy || "all_page_titles";
      logger.info(`Using recommended strategy: ${selectedStrategy}`);
    }

    // Map strategy to query
    const queryConfig = mapScopeStrategyToQuery(
      selectedStrategy,
      state.userIntent || "Exploratory analysis",
    );

    logger.info(
      `Mapped strategy "${selectedStrategy}" to query: ${queryConfig.formalQuery}`,
    );
    updateAgentToaster(`🔍 Proceeding with: ${selectedStrategy}`);

    // Check if this strategy requires content analysis and user doesn't have content access
    const hasContentAccess = state.permissions?.contentAccess || false;
    const needsContentAccess =
      queryConfig.constraints?.requiresAnalysis ||
      queryConfig.constraints?.needsContentExpansion;

    // Show privacy escalation if strategy needs content but user doesn't have access
    // This includes both private mode AND secure mode (permissions.contentAccess = false)
    if (needsContentAccess && (state.privateMode || !hasContentAccess)) {
      const currentMode = state.privateMode ? "Private" : "Secure";

      logger.info(
        `Strategy requires content analysis but user is in ${currentMode} mode - showing privacy escalation dialog`,
      );
      updateAgentToaster(
        `🔒 This analysis requires "balanced" or "full" mode to access page content`,
      );

      return {
        routingDecision: "show_privacy_dialog" as const,
        userIntent: queryConfig.userIntent,
        formalQuery: queryConfig.formalQuery,
        searchDetails: queryConfig.constraints,
        currentMode: currentMode,
        suggestedMode: "balanced", // Suggest balanced mode for pattern analysis
        queryComplexity: "simple" as const,
        analysisType: "summary" as const,
        searchStrategy: "direct" as const,
        // Keep pending scope state in case user cancels
        pendingScopeOptions: state.pendingScopeOptions,
        pendingRecommendedStrategy: state.pendingRecommendedStrategy,
      };
    }

    return {
      routingDecision: "need_new_search" as const,
      formalQuery: queryConfig.formalQuery,
      userIntent: queryConfig.userIntent,
      searchDetails: queryConfig.constraints,
      searchStrategy: "direct" as const,
      queryComplexity: "simple" as const,
      // Clear pending scope state
      pendingScopeOptions: undefined,
      pendingRecommendedStrategy: undefined,
      analysisType: "summary" as const, // Exploratory queries typically need summary
    };
  }

  // Check for direct expansion bypass first - should skip all other routing logic
  logger.debug("ConversationRouter state:", {
    isDirectExpansion: state.isDirectExpansion,
    maxDepthOverride: state.maxDepthOverride,
    isPrivacyModeUpdated: state.isPrivacyModeUpdated,
    semanticExpansion: (state as any).semanticExpansion,
    isExpansionGlobal: (state as any).isExpansionGlobal,
  });

  if (state.isDirectExpansion) {
    // For direct expansion, we need to generate formalQuery from the userQuery
    // since we're bypassing IntentParser but still need the formal query for expansion options
    const formalQuery = state.userQuery; // The userQuery already contains the formatted query with operators

    return {
      routingDecision: "need_new_search" as const,
      reformulatedQuery: state.userQuery,
      originalSearchContext: "direct expansion request",
      formalQuery: formalQuery, // Store the formal query in state
      searchStrategy: "hierarchical", // Direct expansions are typically hierarchical
      // Update IntentParser-like results for hierarchical conversion
      forceHierarchical: Boolean(state.forceHierarchical), // Use the forceHierarchical from state
    };
  }

  // Check for privacy mode update bypass - skip all routing since we already have IntentParser response
  if (state.isPrivacyModeUpdated) {
    return {
      routingDecision: "need_new_search" as const,
      reformulatedQuery: state.userQuery,
      originalSearchContext: "privacy mode update",
    };
  }

  const hasCachedResults =
    Object.keys(state.cachedFullResults || {}).length > 0 ||
    Object.keys(state.resultSummaries || {}).length > 0;
  const hasConversationHistory = state.conversationHistory?.length > 0;

  // Pattern matching for simple conversational requests
  const query = state.userQuery.toLowerCase().trim();

  // Simple follow-up patterns
  const simpleFollowUpPatterns = [
    /^(show|give|get|display)\s+(me\s+)?(more|additional|extra|full)/,
    /^(more|additional|extra|full|complete)\s+(details|info|information|results)/,
    /^(expand|elaborate|explain)\s+(on\s+)?(this|that|these|those)/,
    /^(what|tell me|show me)\s+(about|more about|details about)/,
    /^(also|and)\s+/,
    /^(how about|what about)/,
    /^(can you|could you)\s+(show|find|get|give)/,
  ];

  // Cache-suitable patterns (asking for more of same topic)
  const cacheSuitablePatterns = [
    /\b(more|additional|extra|other|related|similar)\b/,
    /\b(also|and|plus|furthermore)\b/,
    /\b(expand|elaborate|details|comprehensive)\b/,
    /\b(what about|how about)\b/,
  ];

  // Complex analysis indicators
  const complexAnalysisPatterns = [
    /\b(most|least|top|bottom|highest|lowest|best|worst)\b/,
    /\b(count|number of|how many|combien)\b/,
    /\b(analy[sz]e|analy[sz]is|examine|compare|contrast)\b/,
    /\b(rank|order|sort|classify)\b/,
    /\b(mentioned|referenced|cited|linked).*\b(most|count)\b/,
    /\b(or|and not|but not)\b.*\b(or|and not|but not)\b/, // Multiple logical operators
    /\[\[.*?\]\].*\b(or|and)\b.*\[\[.*?\]\]/, // Multiple page references with logic
  ];

  // Retry patterns (language-agnostic through LLM detection later)
  const retryPatterns = {
    basic:
      /\b(retry|try again|search again|再試|再次|essayer|encore|probar|otra vez)\b/i,
    expansion:
      /\b(expand|broader|more results|deeper|plus|más|plus de|再多|扩展|étendre|ampliar)\b/i,
    semantic:
      /\b(similar|related|semantic|concepts|alternatives|相似|相关|概念|similaire|lié|concepto|relacionado)\b/i,
    hierarchical:
      /\b(context|hierarchy|parents|children|deep|上下文|层次|父|子|深度|contexte|hiérarchie|contexto|jerarquía)\b/i,
  };

  // Detect retry type from user query
  const detectRetryType = (query: string): string | null => {
    if (retryPatterns.semantic.test(query)) return "semantic";
    if (retryPatterns.hierarchical.test(query)) return "hierarchical";
    if (retryPatterns.expansion.test(query)) return "expansion";
    if (retryPatterns.basic.test(query)) return "basic";
    return null;
  };

  const retryType = detectRetryType(query);

  const isSimpleFollowUp = simpleFollowUpPatterns.some((pattern) =>
    pattern.test(query),
  );
  const isCacheSuitable = cacheSuitablePatterns.some((pattern) =>
    pattern.test(query),
  );
  const needsComplexAnalysis = complexAnalysisPatterns.some((pattern) =>
    pattern.test(query),
  );

  // Handle retry requests first (highest priority)
  if (retryType && hasConversationHistory) {
    console.log(
      `🔄 [ConversationRouter] Retry detected: ${retryType} expansion requested`,
    );

    const expansionGuidance = buildRetryGuidance(retryType, hasCachedResults);

    return {
      routingDecision: "analyze_complexity" as const, // Use intent parser to apply specific expansion
      reformulatedQuery: state.userQuery,
      expansionGuidance: expansionGuidance,
    };
  }

  // Decision logic
  // Special case: popup execution with pre-computed IntentParser results - skip IntentParser
  if ((state as any).isPopupExecution) {
    return {
      routingDecision: "need_new_search" as const,
    };
  }

  if (!state.isConversationMode || !hasConversationHistory) {
    // Fresh request without conversation context - always analyze complexity
    return {
      routingDecision: "analyze_complexity" as const,
    };
  }

  if (isSimpleFollowUp && hasCachedResults) {
    // Simple follow-up with available cache - use existing cache logic
    return {
      routingDecision: "use_cache" as const,
      reformulatedQuery: state.userQuery,
      originalSearchContext: "previous conversation results",
    };
  }

  if (isCacheSuitable && hasCachedResults && !needsComplexAnalysis) {
    // Cache might be suitable and no complex analysis needed
    return {
      routingDecision: "use_cache" as const,
      reformulatedQuery: state.userQuery,
      originalSearchContext: "related to previous search results",
    };
  }

  if (needsComplexAnalysis) {
    // Complex query that definitely needs full analysis
    return {
      routingDecision: "analyze_complexity" as const,
    };
  }

  // Default: new search without complex analysis for simple conversational queries
  return {
    routingDecision: "need_new_search" as const,
    reformulatedQuery: state.userQuery,
    // Provide minimal guidance for simple queries with new symbolic format
    queryComplexity: "simple" as const,
    userIntent: state.userQuery,
    formalQuery: state.userQuery, // Simple fallback - use user query as-is
    searchStrategy: "direct" as const,
  };
};

// Intent Parser node with symbolic language
const intentParser = async (state: typeof ReactSearchAgentState.State) => {
  logger.info(`Parsing request: "${state.userQuery}"`);
  uiMessages.parsingIntent();

  const parsingPrompt = buildIntentParserPrompt({
    userQuery: state.userQuery,
    conversationHistory: state.conversationHistory,
    conversationSummary: state.conversationSummary,
    permissions: state.permissions,
    privateMode: state.privateMode,
    rootUid: state.rootUid,
    skipPrivacyAnalysis: state.isPrivacyModeForced, // Skip privacy analysis if mode was forced
    skipScopeAnalysis: state.skipScopeAnalysis, // Skip scope analysis if user explicitly skipped it
  });

  try {
    const llmStartTime = Date.now();
    const parsingLlm = modelViaLanggraph(state.model, turnTokensUsage);
    const response = await parsingLlm.invoke([
      new SystemMessage({ content: parsingPrompt }),
      new HumanMessage({ content: state.userQuery }),
    ]);
    const llmDuration = Date.now() - llmStartTime;

    const responseContent = response.content.toString();
    console.log(
      `🎯 [IntentParser] Raw response (${llmDuration}ms):`,
      responseContent,
    );

    // Track tokens and timing
    const responseTokens = response.usage_metadata || {};
    const updatedTotalTokens = {
      input:
        (state.totalTokensUsed?.input || 0) +
        (responseTokens.input_tokens || 0),
      output:
        (state.totalTokensUsed?.output || 0) +
        (responseTokens.output_tokens || 0),
    };
    const updatedTimingMetrics = {
      totalLlmTime: (state.timingMetrics?.totalLlmTime || 0) + llmDuration,
      totalToolTime: state.timingMetrics?.totalToolTime || 0,
      llmCalls: (state.timingMetrics?.llmCalls || 0) + 1,
      toolCalls: state.timingMetrics?.toolCalls || 0,
    };

    // Parse the Intent Parser response
    const analysis = parseJSONWithFields<{
      routingDecision?: "direct_datomic";
      datomicQuery?: string;
      needsPostProcessing?: boolean;
      postProcessingType?: string;
      userIntent: string;
      formalQuery?: string;
      constraints?: {
        timeRange?: { start: string; end: string };
        maxResults?: number;
        requireRandom?: boolean;
        depthLimit?: number;
      };
      searchStrategy?: "direct" | "hierarchical";
      forceHierarchical?: boolean;
      analysisType?: "count" | "compare" | "connections" | "summary";
      expansionGuidance?: string;
      isExpansionGlobal?: boolean;
      semanticExpansion?:
        | "synonyms"
        | "related_concepts"
        | "broader_terms"
        | "all"
        | "custom";
      customSemanticExpansion?: string;
      suggestedMode?: "Balanced" | "Full Access";
      language: string;
      confidence: number;
      // NEW: Exploratory query fields
      needsScope?: boolean;
      scopeOptions?: Array<{
        strategy: string;
        description: string;
        bestFor: string;
        estimatedCount: number | string;
      }>;
      recommendedStrategy?: string;
    }>(responseContent, {
      routingDecision: ["routingDecision"],
      datomicQuery: ["datomicQuery"],
      needsPostProcessing: ["needsPostProcessing"],
      postProcessingType: ["postProcessingType"],
      userIntent: ["userIntent"],
      formalQuery: ["formalQuery"],
      constraints: ["constraints"],
      searchStrategy: ["searchStrategy"],
      forceHierarchical: ["forceHierarchical"],
      analysisType: ["analysisType"],
      expansionGuidance: ["expansionGuidance"],
      isExpansionGlobal: ["isExpansionGlobal"],
      semanticExpansion: ["semanticExpansion"],
      customSemanticExpansion: ["customSemanticExpansion"],
      suggestedMode: ["suggestedMode"],
      language: ["language"],
      confidence: ["confidence"],
      needsScope: ["needsScope"],
      scopeOptions: ["scopeOptions"],
      recommendedStrategy: ["recommendedStrategy"],
    });

    if (!analysis) {
      console.warn("Failed to parse Intent Parser response, using fallback");
      return {
        routingDecision: "need_new_search" as const,
        formalQuery: state.userQuery,
        userIntent: state.userQuery,
        searchStrategy: "direct" as const,
        confidence: 0.5,
        totalTokensUsed: updatedTotalTokens,
        timingMetrics: updatedTimingMetrics,
      };
    }

    // Handle exploratory query - needs scope clarification
    if (analysis.needsScope) {
      logger.info("Exploratory query detected - needs scope selection");
      updateAgentToaster("🔍 Analyzing exploratory request...");

      // Generate scope options dynamically
      const scopeOptions = [
        {
          strategy: "all_page_titles",
          description: "Scan all page titles for topic overview",
          bestFor: "Quick high-level exploration of all topics in your graph",
          estimatedCount: "all",
        },
        {
          strategy: "recent_dnp",
          description: "Analyze patterns in last 90 daily notes",
          bestFor:
            "Understanding recent activities, habits, and temporal patterns",
          estimatedCount: 90,
        },
        {
          strategy: "random_pages",
          description: "Random sample of 100 pages for diverse patterns",
          bestFor: "Unbiased cross-section and statistical overview",
          estimatedCount: 100,
        },
        {
          strategy: "recent_modified",
          description: "100 most actively edited pages",
          bestFor: "Focus on current work and active projects",
          estimatedCount: 100,
        },
      ];

      // Format scope options for presentation to user
      const optionsText = scopeOptions
        .map(
          (opt, idx) =>
            `${idx + 1}. **${opt.strategy}**: ${
              opt.description
            }\n   *Best for: ${opt.bestFor}* (≈${opt.estimatedCount} pages)`,
        )
        .join("\n\n");

      const scopeMessage = `I detected that you're looking for broad patterns or themes across your database. To provide meaningful analysis, I need to sample your data.

Here are the available strategies:

${optionsText}

**Recommended**: ${analysis.recommendedStrategy}

Please choose a strategy by number (1-${scopeOptions.length}), or I can proceed with the recommended approach.`;

      // Store the scope selection request in the finalAnswer to present to user
      return {
        routingDecision: "show_scope_options" as const,
        userIntent: analysis.userIntent,
        finalAnswer: scopeMessage,
        queryComplexity: "multi-step" as const,
        language: analysis.language,
        confidence: analysis.confidence,
        totalTokensUsed: updatedTotalTokens,
        timingMetrics: updatedTimingMetrics,
        // Store dynamically generated scope options for follow-up handling
        pendingScopeOptions: scopeOptions,
        pendingRecommendedStrategy: analysis.recommendedStrategy,
      };
    }

    // Handle direct Datomic query routing
    if (analysis.routingDecision === "direct_datomic") {
      logger.info("Direct Datomic query detected");
      uiMessages.executingDatomic();

      return {
        routingDecision: "need_new_search" as const,
        datomicQuery: analysis.datomicQuery,
        needsPostProcessing: analysis.needsPostProcessing,
        postProcessingType: analysis.postProcessingType,
        userIntent: analysis.userIntent,
        queryComplexity: "simple" as const,

        totalTokensUsed: updatedTotalTokens,
        timingMetrics: updatedTimingMetrics,
      };
    }

    // Handle privacy mode escalation
    if (analysis.suggestedMode && state.privateMode) {
      updateAgentToaster(
        `🔒 This query requires "${analysis.suggestedMode}" security level to access block content`,
      );

      // Use the same pattern as showResultsThenExpand to pause execution
      return {
        routingDecision: "show_privacy_dialog" as const,
        userIntent: analysis.userIntent,
        formalQuery: analysis.formalQuery,
        currentMode: "Private",
        suggestedMode: analysis.suggestedMode,
        queryComplexity: determineComplexity(analysis.formalQuery),
        totalTokensUsed: updatedTotalTokens,
        timingMetrics: updatedTimingMetrics,
      };
    }

    // Expansion guidance is now handled in ReAct Assistant prompt when needed
    const expansionGuidanceForLLM = "";

    // Replace the parsing message with query results
    replaceLastToasterMessage(
      "🎯 Parsing user intent...",
      `🔍 Symbolic query: ${analysis.formalQuery}`,
    );
    updateAgentToaster(`🔍 ${analysis.searchStrategy} search strategy planned`);
    if (analysis.isExpansionGlobal) {
      updateAgentToaster(
        `🧠 Global semantic expansion: ${
          analysis.semanticExpansion || "synonyms"
        }`,
      );
    }

    return {
      routingDecision: "need_new_search" as const,
      formalQuery: analysis.formalQuery, // Keep original, let LLM apply expansions
      userIntent: analysis.userIntent,
      queryComplexity: determineComplexity(analysis.formalQuery),

      searchStrategy: analysis.searchStrategy,
      forceHierarchical: analysis.forceHierarchical,
      analysisType: analysis.analysisType,
      searchDetails: analysis.constraints,
      expansionGuidance: expansionGuidanceForLLM || analysis.expansionGuidance, // Use generated guidance
      isExpansionGlobal: analysis.isExpansionGlobal,
      semanticExpansion: analysis.semanticExpansion,
      customSemanticExpansion: analysis.customSemanticExpansion,
      language: analysis.language,
      confidence: analysis.confidence,
      totalTokensUsed: updatedTotalTokens,
      timingMetrics: updatedTimingMetrics,
    };
  } catch (error) {
    console.error("Intent parsing failed:", error);
    updateAgentToaster("⚠️ Using simplified query analysis");

    // Fallback with basic parsing - still track any tokens used even on error
    const fallbackTokens = {
      input: state.totalTokensUsed?.input || 0,
      output: state.totalTokensUsed?.output || 0,
    };
    const fallbackTiming = {
      totalLlmTime: state.timingMetrics?.totalLlmTime || 0,
      totalToolTime: state.timingMetrics?.totalToolTime || 0,
      llmCalls: state.timingMetrics?.llmCalls || 0,
      toolCalls: state.timingMetrics?.toolCalls || 0,
    };

    return {
      routingDecision: "need_new_search" as const,
      formalQuery: state.userQuery,
      userIntent: state.userQuery,
      queryComplexity: "simple" as const,

      searchStrategy: "direct" as const,
      confidence: 0.3,
      totalTokensUsed: fallbackTokens,
      timingMetrics: fallbackTiming,
    };
  }
};

/**
 * Map exploratory scope strategy to executable query
 * Converts user selection (or recommended default) into formal query + constraints
 */
export const mapScopeStrategyToQuery = (
  strategy: string,
  originalIntent: string,
): {
  formalQuery: string;
  constraints?: any;
  userIntent: string;
} => {
  const now = new Date();
  const getDaysAgo = (days: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() - days);
    return date.toISOString().split("T")[0];
  };

  switch (strategy) {
    case "all_page_titles":
      return {
        formalQuery: "DATOMIC:GET_ALL_PAGES_METADATA_ONLY",
        constraints: {
          getAllPages: true,
          includeDaily: false,
          maxResults: null,
          requiresAnalysis: true, // Flag to prevent directFormat bypass
        },
        userIntent: `${originalIntent} - Use executeDatomicQuery tool with queryDescription parameter set to 'GET_ALL_PAGES_METADATA_ONLY' (this is a special marker that automatically executes a query to fetch ALL page titles excluding daily notes). After getting the results, analyze the page titles to identify topic clusters, recurring themes, and patterns. Group pages by topic and highlight dominant themes in your analysis.`,
      };

    case "recent_dnp":
      return {
        formalQuery: "page:(dnp)",
        constraints: {
          timeRange: {
            start: getDaysAgo(90),
            end: now.toISOString().split("T")[0],
            filterMode: "created" as const,
          },
          maxResults: 90,
          requiresAnalysis: true, // Force responseWriter for pattern analysis
          needsContentExpansion: true, // Expand pages with their full content for analysis
        },
        userIntent: `${originalIntent} - SINGLE-STEP QUERY: Call findDailyNotesByPeriod with timeRange={start: "${getDaysAgo(
          90,
        )}", end: "${
          now.toISOString().split("T")[0]
        }", filterMode: "created"}, limit=90, purpose="final" (or omit purpose). This will return the last 90 daily note pages (from the last 90 days based on creation date). After receiving the results, the system will automatically expand each page with its full content (children blocks). Analyze the CONTENT of these daily notes to identify patterns, themes, and insights.`,
      };

    case "random_pages":
      return {
        formalQuery: "page:(title:(regex:/.*/i))",
        constraints: {
          requireRandom: true,
          maxResults: 100,
          requiresAnalysis: true, // Force responseWriter for pattern analysis
          needsContentExpansion: true, // Expand pages with their full content for analysis
        },
        userIntent: `${originalIntent} - SINGLE-STEP QUERY: Call findPagesByTitle with conditions=[{text: ".*", matchType: "regex"}], limit=100, purpose="final" (or omit purpose). After receiving the results, the system will automatically expand each page with its full content (children blocks). Analyze the CONTENT of these pages to identify patterns, themes, and insights.`,
      };

    case "recent_modified":
      return {
        formalQuery: "page:(title:(regex:/.*/i))",
        constraints: {
          maxResults: 100,
          requiresAnalysis: true, // Force responseWriter for pattern analysis
          needsContentExpansion: true, // Expand pages with their full content for analysis
          // Will be sorted by modification date (most recent first) in tool execution
        },
        userIntent: `${originalIntent} - SINGLE-STEP QUERY: Call findPagesByTitle with conditions=[{text: ".*", matchType: "regex"}], limit=100, purpose="final" (or omit purpose). The tool will automatically sort by modification date (most recent first), returning the 100 most recently modified pages. After receiving the results, the system will automatically expand each page with its full content (children blocks). Analyze the CONTENT of these pages to identify patterns, themes, and insights.`,
      };

    case "topic_filtered":
      // This requires additional user input, handled separately
      return {
        formalQuery: "",
        userIntent: `${originalIntent} - Topic filtering requires specific tag/topic input`,
      };

    default:
      // Fallback to random pages
      return {
        formalQuery: "page:(title:(regex:/.*/i))",
        constraints: {
          requireRandom: true,
          maxResults: 100,
          requiresAnalysis: true, // Force responseWriter for pattern analysis
        },
        userIntent: `${originalIntent} - SINGLE-STEP QUERY: Call findPagesByTitle with conditions=[{text: ".*", matchType: "regex"}], limit=100, purpose="final" (or omit purpose). After receiving results, analyze them for patterns.`,
      };
  }
};

/**
 * Build optimized cache results summary using the new summarization system
 */
const buildCacheResultsSummary = (
  state: typeof ReactSearchAgentState.State,
): string => {
  const summaries: string[] = [];

  // NEW: Use token-optimized result summaries (preferred)
  if (state.resultSummaries && Object.keys(state.resultSummaries).length > 0) {
    Object.entries(state.resultSummaries).forEach(([resultId, summary]) => {
      const resultData = state.resultStore?.[resultId];

      // Only include active results (not superseded ones)
      if (resultData?.status === "active") {
        const summaryText = generateSummaryText(summary, "balanced"); // Use balanced mode for cache processing
        summaries.push(`${resultId}: ${summaryText}`);
      }
    });
  }

  // LEGACY: Fall back to old cachedFullResults for backward compatibility
  if (summaries.length === 0 && state.cachedFullResults) {
    Object.entries(state.cachedFullResults).forEach(([cacheId, cached]) => {
      const results = cached.fullResults;
      const dataCount = results?.data?.length || 0;
      const toolName = cached.toolName || "unknown";

      // Create legacy summary (much more compact than full JSON dump)
      summaries.push(`${cacheId}: ${dataCount} ${toolName} results available`);
    });
  }

  return summaries.length > 0
    ? summaries.join("\n")
    : "No cached results available";
};

/**
 * Generate cache-based response with proper formatting using actual result data
 */
const generateCacheBasedResponse = async (
  state: typeof ReactSearchAgentState.State,
  cacheProcessorResponse: string,
): Promise<{
  finalResponse: string;
  tokensUsed: { input: number; output: number };
  timingMetrics: { llmTime: number; llmCalls: number };
}> => {
  // If we have new result structure, enhance the response with proper formatting
  if (state.resultStore && Object.keys(state.resultStore).length > 0) {
    // Determine security mode
    const securityMode = state.privateMode
      ? "private"
      : state.permissions?.contentAccess
        ? "full"
        : "balanced";

    // Build a response using the same system as finalResponseWriter but with cache context
    const cacheSystemPrompt = buildCacheSystemPrompt(
      state,
      cacheProcessorResponse,
      securityMode,
    );

    try {
      const llmStartTime = Date.now();
      const llm = modelViaLanggraph(state.model, turnTokensUsage);
      const response = await llm.invoke([
        new SystemMessage({ content: cacheSystemPrompt }),
        new HumanMessage({ content: state.userQuery }),
      ]);
      const llmDuration = Date.now() - llmStartTime;

      // Track tokens from this additional LLM call
      const responseTokens = response.usage_metadata || {};
      const tokensUsed = {
        input: responseTokens.input_tokens || 0,
        output: responseTokens.output_tokens || 0,
      };
      const timingMetrics = {
        llmTime: llmDuration,
        llmCalls: 1,
      };

      return {
        finalResponse: response.content.toString(),
        tokensUsed,
        timingMetrics,
      };
    } catch (error) {
      console.warn(
        "Cache-based response generation failed, using original:",
        error,
      );
      return {
        finalResponse: cacheProcessorResponse,
        tokensUsed: { input: 0, output: 0 },
        timingMetrics: { llmTime: 0, llmCalls: 0 },
      };
    }
  }

  // For legacy results or when no new results available, return original response
  return {
    finalResponse: cacheProcessorResponse,
    tokensUsed: { input: 0, output: 0 },
    timingMetrics: { llmTime: 0, llmCalls: 0 },
  };
};

const cacheProcessor = async (state: typeof ReactSearchAgentState.State) => {
  // Count available results from both new and legacy systems
  const newResultsCount = Object.keys(state.resultSummaries || {}).length;
  const legacyResultsCount = Object.keys(state.cachedFullResults || {}).length;
  const totalResultsCount = newResultsCount + legacyResultsCount;

  logger.debug(
    `Available cached results: ${totalResultsCount} (${newResultsCount} new + ${legacyResultsCount} legacy)`,
  );
  uiMessages.processingCache();

  // In Private mode, don't process cached content - route to new search
  if (state.privateMode) {
    return {
      routingDecision: "need_new_search" as const,
      messages: [new HumanMessage(state.reformulatedQuery || state.userQuery)],
    };
  }

  // Build system prompt for cache processing
  const cacheProcessingPrompt = buildCacheProcessingPrompt(state);

  try {
    const llmStartTime = Date.now();
    const cacheProcessingLlm = modelViaLanggraph(state.model, turnTokensUsage);
    const response = await cacheProcessingLlm.invoke([
      new SystemMessage({ content: cacheProcessingPrompt }),
      new HumanMessage({ content: state.reformulatedQuery || state.userQuery }),
    ]);
    const llmDuration = Date.now() - llmStartTime;

    const responseContent = response.content.toString();
    logger.perf(`CacheProcessor LLM call completed in ${llmDuration}ms`);

    // Track tokens and timing
    const responseTokens = response.usage_metadata || {};
    const updatedTotalTokens = {
      input:
        (state.totalTokensUsed?.input || 0) +
        (responseTokens.input_tokens || 0),
      output:
        (state.totalTokensUsed?.output || 0) +
        (responseTokens.output_tokens || 0),
    };
    const updatedTimingMetrics = {
      totalLlmTime: (state.timingMetrics?.totalLlmTime || 0) + llmDuration,
      totalToolTime: state.timingMetrics?.totalToolTime || 0,
      llmCalls: (state.timingMetrics?.llmCalls || 0) + 1,
      toolCalls: state.timingMetrics?.toolCalls || 0,
    };

    // Handle HYBRID approach (new intelligent conversation mode)
    if (responseContent.startsWith("HYBRID:")) {
      // Provide both cached context and guidance for new searches to ReAct assistant
      const hybridQuery = `${state.reformulatedQuery || state.userQuery}

CONVERSATION CONTEXT - CACHED DATA AVAILABLE:
${buildCacheResultsSummary(state)}

HYBRID STRATEGY:
${responseContent}

INSTRUCTIONS: You can use fromResultId parameters to reference cached data and combine it with new targeted searches for a comprehensive response.`;

      return {
        routingDecision: "need_new_search" as const,
        messages: [new HumanMessage(hybridQuery)],
        totalTokensUsed: updatedTotalTokens,
        timingMetrics: updatedTimingMetrics,
      };
    }

    // Check if cache was insufficient
    if (responseContent.startsWith("INSUFFICIENT_CACHE:")) {
      // Pass the guidance to ReAct assistant
      const enhancedQuery =
        (state.reformulatedQuery || state.userQuery) + "\n\n" + responseContent;

      return {
        routingDecision: "need_new_search" as const,
        messages: [new HumanMessage(enhancedQuery)],
        totalTokensUsed: updatedTotalTokens,
        timingMetrics: updatedTimingMetrics,
      };
    }

    // Cache was sufficient, prepare final response using actual result data

    // For cache-sufficient responses, we should generate a proper final answer using our result data
    // This ensures consistency with the new finalResponseWriter approach
    const cacheResponseData = await generateCacheBasedResponse(
      state,
      responseContent,
    );

    // Combine tokens from the cache processing LLM call and any additional LLM call in generateCacheBasedResponse
    const finalTokensUsed = {
      input: updatedTotalTokens.input + cacheResponseData.tokensUsed.input,
      output: updatedTotalTokens.output + cacheResponseData.tokensUsed.output,
    };
    const finalTimingMetrics = {
      totalLlmTime:
        updatedTimingMetrics.totalLlmTime +
        cacheResponseData.timingMetrics.llmTime,
      totalToolTime: updatedTimingMetrics.totalToolTime,
      llmCalls:
        updatedTimingMetrics.llmCalls +
        cacheResponseData.timingMetrics.llmCalls,
      toolCalls: updatedTimingMetrics.toolCalls,
    };

    return {
      messages: [...state.messages, response],
      finalAnswer: cacheResponseData.finalResponse,
      totalTokensUsed: finalTokensUsed,
      timingMetrics: finalTimingMetrics,
    };
  } catch (error) {
    console.error("Cache processing failed:", error);
    // Fallback to new search on error - preserve current metrics
    const fallbackTokens = {
      input: state.totalTokensUsed?.input || 0,
      output: state.totalTokensUsed?.output || 0,
    };
    const fallbackTiming = {
      totalLlmTime: state.timingMetrics?.totalLlmTime || 0,
      totalToolTime: state.timingMetrics?.totalToolTime || 0,
      llmCalls: state.timingMetrics?.llmCalls || 0,
      toolCalls: state.timingMetrics?.toolCalls || 0,
    };
    return {
      routingDecision: "need_new_search" as const,
      messages: [new HumanMessage(state.reformulatedQuery || state.userQuery)],
      totalTokensUsed: fallbackTokens,
      timingMetrics: fallbackTiming,
    };
  }
};

const loadModel = async (state: typeof ReactSearchAgentState.State) => {
  const startTime = state.startTime || Date.now();

  // Reset token usage for new execution (important for popup executions)
  turnTokensUsage = { input_tokens: 0, output_tokens: 0 };

  // Initialize LLM
  llm = modelViaLanggraph(state.model, turnTokensUsage);

  // console.log("llm :>> ", llm);
  llm.supportsStrictToolCalling = true;

  // Show model information in toaster
  const modelDisplayName =
    state.model.id || state.model.name || "Unknown model";
  console.log("🤖 [loadModel] Using model:", modelDisplayName);

  // Only show toaster for non-popup executions to avoid duplicate messages
  if (!(state as any).isPopupExecution) {
    // Check if toaster stream is available and wait if needed
    const { getAgentToasterStream } = await import("../shared/agentsUtils");
    const toasterStream = getAgentToasterStream();

    if (!toasterStream) {
      // Wait briefly for toaster to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    updateAgentToaster(`🤖 Using ${modelDisplayName}`);

    // Show warning for thinking models
    if (state.model.thinking) {
      updateAgentToaster(
        `⚠️ Thinking models can be very slow to respond with this agent.`,
      );
    }
  }

  // Set default permissions (secure level only unless specified)
  const permissions = state.permissions || { contentAccess: false };

  // Initialize tools based on permissions
  const tools = initializeTools(permissions);

  return {
    searchTools: tools,
    startTime,
    permissions,
    privateMode: state.privateMode || false,
    // Preserve existing cached state if it exists, otherwise initialize empty
    toolResults: state.toolResults || {},
    toolResultsCache: state.toolResultsCache || {},
    cachedFullResults: state.cachedFullResults || {},
    hasLimitedResults: state.hasLimitedResults || false,
    // NEW: Initialize token optimization state
    resultSummaries: state.resultSummaries || {},
    resultStore: state.resultStore || {},
    nextResultId: state.nextResultId || 1,
    totalTokensUsed: state.totalTokensUsed || { input: 0, output: 0 },
    // Initialize timing metrics
    timingMetrics: state.timingMetrics || {
      totalLlmTime: 0,
      totalToolTime: 0,
      llmCalls: 0,
      toolCalls: 0,
    },
    // Initialize expansion tracking
    expansionConsent: state.expansionConsent || false,
    // Initialize streaming state
    streamElement: undefined,
    wasStreamed: false,
    streamingTargetUid: undefined,
  };
};

const assistant = async (state: typeof ReactSearchAgentState.State) => {
  // Check for cancellation
  if (state.abortSignal?.aborted) {
    throw new Error("Operation cancelled by user");
  }

  if ((state as any).isDirectExpansion) {
    // Inject expansion parameters directly into state (they should already be in agentData)
    if ((state as any).semanticExpansion) {
      state.semanticExpansion = (state as any).semanticExpansion;
    }
    if ((state as any).isExpansionGlobal !== undefined) {
      state.isExpansionGlobal = (state as any).isExpansionGlobal;
    }
  }

  // Tools are already filtered by permissions in loadModel
  // Note: State-aware tool wrappers are now handled in toolsWithResults for proper execution
  // IMPORTANT: Set strict: false to avoid OpenAI schema validation errors with optional parameters
  const llm_with_tools = llm.bindTools(state.searchTools, { strict: false });

  // Check if we need to add expansion strategies to the system prompt

  // Check if user requested exact matches (skip expansion) or specific expansion levels
  const userQuery = state.userQuery?.toLowerCase() || "";
  const requestsExactMatch =
    userQuery.includes("exact") ||
    userQuery.includes("strict") ||
    userQuery.includes("precise") ||
    userQuery.includes("literal") ||
    userQuery.includes("no expansion") ||
    userQuery.includes("without expansion") ||
    false;

  // Only check final results for expansion decision
  const finalResults = Object.values(state.resultStore || {}).filter(
    (result) => result?.purpose === "final" && result?.status === "active",
  );

  // Separate errors from successful searches and count total results
  const successfulResults = finalResults.filter((result) => !result.error);
  const totalResultCount = successfulResults.reduce((sum, result) => {
    if (Array.isArray(result.data)) return sum + result.data.length;
    // Handle nested data structures from tool responses
    if (result.data && typeof result.data === "object") {
      if ((result.data as any).results?.length > 0)
        return sum + (result.data as any).results.length;
      if ((result.data as any).pages?.length > 0)
        return sum + (result.data as any).pages.length;
      if ((result.data as any).content && (result.data as any).content.trim())
        return sum + 1;
    }
    return sum;
  }, 0);

  const hasLowResults = successfulResults.length > 0 && totalResultCount < 100;
  const hasNoResults = successfulResults.length === 0 || totalResultCount === 0;

  // CRITICAL: Only evaluate expansion if tools have already been executed
  // Don't trigger expansion on the first assistant call when no tools have run yet
  const hasToolsBeenExecuted = finalResults.length > 0;

  // NEW EXPANSION MODE LOGIC: Handle the four different expansion modes
  const expansionMode = state.automaticExpansionMode || "ask_user";
  console.log(
    `🔧 [Assistant] Expansion mode: ${expansionMode}, hasToolsBeenExecuted: ${hasToolsBeenExecuted}, hasNoResults: ${hasNoResults}, hasLowResults: ${hasLowResults}, requestsExactMatch: ${requestsExactMatch}`,
  );

  // Tools now handle expansion automatically (fuzzy → synonyms → related_concepts → broader_terms)
  // No need for LLM-orchestrated level expansion

  // Check if tools exhausted automatic expansion with 0 results
  let needsAlternativeStrategies = false;
  if (state.resultStore) {
    const toolResults = Object.values(state.resultStore);
    const hasAutoExpansionFailure = toolResults.some(
      (result: any) =>
        result?.metadata?.automaticExpansion?.finalAttempt === true &&
        result?.data?.length === 0,
    );
    if (hasAutoExpansionFailure) {
      needsAlternativeStrategies = true;
    }
  }

  // Use enhanced system prompt with symbolic query support and expansion strategies
  const systemPrompt = buildSystemPrompt({
    permissions: state.permissions,
    privateMode: state.privateMode,
    isConversationMode: state.isConversationMode,
    queryComplexity: state.queryComplexity,
    userIntent: state.userIntent,
    userQuery: state.userQuery,
    // New symbolic query fields
    formalQuery: state.formalQuery,
    analysisType: state.analysisType,
    language: state.language,
    datomicQuery: state.datomicQuery,
    searchDetails: state.searchDetails,
    // Expansion support
    searchStrategy: state.searchStrategy,
    isExpansionGlobal: state.isExpansionGlobal,
    semanticExpansion: state.semanticExpansion,
    needsAlternativeStrategies: needsAlternativeStrategies,
  });
  // console.log("Assistant systemPrompt :>> ", systemPrompt);
  const contextInstructions = `

CRITICAL INSTRUCTIONS: 
1. When using findBlocksByContent, findBlocksWithHierarchy, or findPagesByContent, always include excludeBlockUid parameter set to: "${
    state.rootUid
  }" to exclude the user's request block from results.

${
  state.forceHierarchical
    ? `2. HIERARCHICAL SEARCH REQUIRED: The user has requested hierarchical search (forceHierarchical=true). You MUST use findBlocksWithHierarchy tool instead of findBlocksByContent. Use depth=${
        state.maxDepthOverride || 1
      } for the hierarchical search.`
    : ""
}`;

  const combinedSystemPrompt = systemPrompt + contextInstructions;
  const sys_msg = new SystemMessage({ content: combinedSystemPrompt });

  uiMessages.understandingRequest();

  // OPTIMIZATION: Replace verbose tool results with concise summaries to reduce token usage
  const optimizedMessages = state.messages.map((msg) => {
    // Check if this is a tool result message with verbose content (check for tool_call_id which indicates ToolMessage)
    if (
      msg.content &&
      typeof msg.content === "string" &&
      msg.name &&
      (msg as any).tool_call_id
    ) {
      try {
        const parsed = JSON.parse(msg.content);
        // If it's a successful tool result with data array (verbose)
        if (
          parsed.success &&
          parsed.data &&
          Array.isArray(parsed.data) &&
          parsed.data.length > 0
        ) {
          // NEW: Full mode gets intermediate content truncation instead of summaries
          // Only for manageable result counts and when contentAccess is true
          const securityMode = state.privateMode
            ? "private"
            : state.permissions?.contentAccess
              ? "full"
              : "balanced";

          if (
            securityMode === "full" &&
            parsed.data.length <= 100 && // Only for manageable result counts
            parsed.data.length > 0
          ) {
            // Apply intermediate content truncation for full mode
            const noTruncation = state.permissions?.noTruncation || false;
            const truncatedData = applyIntermediateContentTruncation(
              parsed.data,
              50000,
              noTruncation,
            ); // 50k char limit for intermediate processing (skipped if noTruncation)
            const truncatedContent = JSON.stringify({
              ...parsed,
              data: truncatedData,
            });

            // Return ToolMessage with truncated but real content for full mode
            return new ToolMessage({
              content: truncatedContent,
              tool_call_id: (msg as any).tool_call_id,
              name: msg.name,
            });
          } else {
            // Private/balanced modes OR high result counts: use existing summary approach
            const summary = {
              success: true,
              summary: `Found ${
                parsed.metadata?.totalFound || parsed.data.length
              } results${
                parsed.metadata?.wasLimited
                  ? ` (showing ${parsed.data.length})`
                  : ""
              } from ${msg.name}.`,
              count: {
                total: parsed.metadata?.totalFound || parsed.data.length,
                returned: parsed.data.length,
              },
              metadata: {
                searchGuidance: parsed.metadata?.searchGuidance,
              },
            };

            const summaryContent = JSON.stringify(summary);

            // Create a new ToolMessage with the summary content
            return new ToolMessage({
              content: summaryContent,
              tool_call_id: (msg as any).tool_call_id,
              name: msg.name,
            });
          }
        }
      } catch (e) {
        // If parsing fails, return original message
      }
    }
    return msg;
  });

  const messages = [sys_msg, ...optimizedMessages];

  const llmStartTime = Date.now();

  // Check for cancellation before LLM call
  if (state.abortSignal?.aborted) {
    throw new Error("Operation cancelled by user");
  }

  // Create a promise that will reject if aborted
  const abortPromise = new Promise((_, reject) => {
    if (state.abortSignal) {
      const abortHandler = () =>
        reject(new Error("Operation cancelled by user"));
      state.abortSignal.addEventListener("abort", abortHandler, { once: true });
    }
  });

  // Race between the LLM call and the abort signal
  const response = await Promise.race([
    llm_with_tools.invoke(messages),
    abortPromise,
  ]);

  // console.log("Assistant response :>>, response");

  const llmDuration = Date.now() - llmStartTime;

  // Track tokens from this assistant call
  const responseTokens = response.usage_metadata || {};
  const updatedTotalTokens = {
    input:
      (state.totalTokensUsed?.input || 0) + (responseTokens.input_tokens || 0),
    output:
      (state.totalTokensUsed?.output || 0) +
      (responseTokens.output_tokens || 0),
  };

  if (response.tool_calls && response.tool_calls.length > 0) {
    // Generate user-friendly explanations for tool calls
    const toolExplanations = response.tool_calls.map((tc: any) => {
      const toolName = tc.name;
      const args = tc.args || {};

      // Generate brief, user-friendly explanations based on tool and arguments
      switch (toolName) {
        case "findBlocksByContent":
          if (args.conditions && Array.isArray(args.conditions)) {
            const searchTerms = args.conditions
              .map((c: any) => {
                if (c.type === "page_ref") {
                  return `[[${c.text}]]`;
                }
                return `"${c.text}"`;
              })
              .slice(0, 3); // Limit to 3 terms for brevity

            const combineLogic =
              args.combineConditions === "OR" ? " OR " : " AND ";
            const termDisplay = searchTerms.join(combineLogic);
            const limitText = args.conditions.length > 3 ? "..." : "";
            const scopeText = args.limitToPages?.length
              ? ` in [[${args.limitToPages[0]}]]${
                  args.limitToPages.length > 1 ? "..." : ""
                }`
              : "";

            return `Content Search: ${termDisplay}${limitText}${scopeText}`;
          }
          const searchText =
            args.conditions?.find((c: any) => c.type === "text")?.text ||
            "content";
          return `Content Search: "${searchText}"`;

        case "findPagesByContent":
          if (args.conditions && Array.isArray(args.conditions)) {
            const searchTerms = args.conditions
              .map((c: any) => {
                if (c.type === "page_ref") return `[[${c.text}]]`;
                return `"${c.text}"`;
              })
              .slice(0, 3);
            const combineLogic =
              args.combineConditions === "OR" ? " OR " : " AND ";
            const limitText = args.conditions.length > 3 ? "..." : "";
            return `Page Content Search: ${searchTerms.join(
              combineLogic,
            )}${limitText}`;
          }
          const pageSearchText = args.searchText || args.query || "content";
          return `Page Content Search: "${pageSearchText}"`;

        case "findPagesByTitle":
          const titleText = args.pageTitle || args.searchText || "page";
          return `Page Title Search: "${titleText}"`;

        case "findPagesSemantically":
          return `Semantic Search: "${args.query || "concept"}"`;

        case "extractPageReferences":
          const blockCount = Array.isArray(args.blockUids)
            ? args.blockUids.length
            : "results";
          return `Extract References: ${blockCount} block${
            blockCount !== 1 ? "s" : ""
          }`;

        case "combineResults":
          const operation = args.operation || "union";
          const resultCount = Array.isArray(args.resultIds)
            ? args.resultIds.length
            : "multiple";
          const opText =
            operation === "union"
              ? "combining"
              : operation === "intersection"
                ? "finding common"
                : "processing";
          return `Combine Results: ${opText} ${resultCount} sets`;

        case "getNodeDetails":
          const nodeType = args.pageTitle ? "page" : "block";
          const nodeName = args.pageTitle || `block ${args.blockUid || ""}`;
          return `Get Details: ${nodeType} ${nodeName}`;

        case "findBlocksWithHierarchy":
          const hierarchyQuery =
            args.conditions?.find((c: any) => c.type === "text")?.text ||
            "blocks";
          return `Hierarchy Search: "${hierarchyQuery}" with relationships`;

        case "extractHierarchyContent":
          const hierarchyCount = Array.isArray(args.blockUids)
            ? args.blockUids.length
            : "results";
          return `Extract Hierarchy: ${hierarchyCount} block${
            hierarchyCount !== 1 ? "s" : ""
          }`;

        case "executeDatomicQuery":
          if (args.query) {
            // User-provided query
            const queryPreview =
              args.query.length > 50
                ? args.query.substring(0, 47) + "..."
                : args.query;
            return `Datalog Query: ${queryPreview}`;
          } else if (args.variables) {
            // Parameterized query
            const varCount = Object.keys(args.variables).length;
            const queryHint = args.description || "parameterized query";
            return `Datalog Query: ${queryHint}`;
          } else {
            // Auto-generated query
            const queryHint =
              args.description || args.criteria || "advanced search";
            return `Datalog Query: ${queryHint}`;
          }

        case "findDailyNotesByPeriod":
          const startDate = args.startDate || "start";
          const endDate = args.endDate || "end";
          return `Daily Notes Search: ${startDate} to ${endDate}`;

        default:
          return `${toolName
            .replace(/([A-Z])/g, " $1")
            .toLowerCase()
            .replace(/^find/, "finding")
            .replace(/^get/, "getting")
            .replace(/^execute/, "executing")
            .replace(/^extract/, "extracting")}`;
      }
    });

    // Build user-friendly explanation for multiple tools
    let explanation;
    if (toolExplanations.length === 1) {
      explanation = toolExplanations[0];
    } else if (toolExplanations.length <= 3) {
      // Show all tools when there are few
      explanation = toolExplanations.join(" + ");
    } else {
      // Group similar tools for better readability
      const searchCount = toolExplanations.filter(
        (exp) =>
          exp.includes('"') ||
          exp.includes("[[") ||
          exp.includes("pages") ||
          exp.includes("blocks"),
      ).length;
      const analysisCount = toolExplanations.filter(
        (exp) =>
          exp.includes("analyzing") ||
          exp.includes("→") ||
          exp.includes("combining"),
      ).length;

      if (searchCount > 0 && analysisCount > 0) {
        explanation = `${searchCount} searches + ${analysisCount} analysis steps`;
      } else if (searchCount > 1) {
        explanation = `${searchCount} parallel searches`;
      } else {
        explanation = `${toolExplanations.length} operations: ${toolExplanations
          .slice(0, 2)
          .join(", ")}...`;
      }
    }

    replaceLastToasterMessage(
      "🤖 Understanding your request...",
      `🔍 ${explanation} (${(llmDuration / 1000).toFixed(1)}s)`,
    );
  } else {
    replaceLastToasterMessage(
      "🤖 Understanding your request...",
      `✅ Analysis complete (${(llmDuration / 1000).toFixed(1)}s)`,
    );
  }

  // Update timing metrics for assistant LLM call
  const assistantTimingMetrics = {
    totalLlmTime: (state.timingMetrics?.totalLlmTime || 0) + llmDuration,
    totalToolTime: state.timingMetrics?.totalToolTime || 0,
    llmCalls: (state.timingMetrics?.llmCalls || 0) + 1,
    toolCalls: state.timingMetrics?.toolCalls || 0,
  };

  return {
    messages: [...state.messages, response],
    totalTokensUsed: updatedTotalTokens,
    timingMetrics: assistantTimingMetrics,
  };
};

// toolsWithResults function removed - using toolsWithResultLifecycle instead

const responseWriter = async (state: typeof ReactSearchAgentState.State) => {
  // Check for cancellation
  if (state.abortSignal?.aborted) {
    throw new Error("Operation cancelled by user");
  }

  // Update toaster based on mode
  if (state.isDirectChat) {
    updateAgentToaster("💬 Generating chat response...");
  } else {
    updateAgentToaster("✍️ Crafting final response...");
  }

  // Determine security mode for data access strategy
  const securityMode = state.privateMode
    ? "private"
    : state.permissions?.contentAccess
      ? "full"
      : "balanced";

  // Handle system prompt based on execution mode
  let sys_msg: SystemMessage;

  if ((state as any).isPopupExecution) {
    // For popup execution, use the chatSystemPrompt as the system message
    if (state.chatSystemPrompt) {
      sys_msg = new SystemMessage({ content: state.chatSystemPrompt });
    } else {
      // Fallback for backward compatibility

      const responseSystemPrompt = buildFinalResponseSystemPrompt(
        state,
        securityMode,
      );
      sys_msg = new SystemMessage({ content: responseSystemPrompt });
    }
  } else {
    // For regular execution, build system prompt with access to actual result data via state
    const responseSystemPrompt = buildFinalResponseSystemPrompt(
      state,
      securityMode,
    );

    sys_msg = new SystemMessage({ content: responseSystemPrompt });
  }

  // Build conversation messages for direct chat mode
  const messages = [sys_msg];

  if (
    (state.isDirectChat || (state as any).isPopupExecution) &&
    state.conversationHistory &&
    state.conversationHistory.length > 0
  ) {
    // Include recent conversation history as actual messages for better context
    const recentHistory = state.conversationHistory.slice(-6); // Last 3 exchanges (6 messages)
    for (const msg of recentHistory) {
      if (msg.role === "user" || msg.role === "User") {
        messages.push(new HumanMessage({ content: msg.content }));
      } else if (msg.role === "assistant" || msg.role === "Assistant") {
        messages.push(new AIMessage({ content: msg.content })); // Use AIMessage for assistant responses
      }
    }
  }

  // Add current user message
  // In popup execution mode, userQuery is the actual user message
  // In regular execution mode, userQuery is the parsed user request
  // For exploratory queries with requiresAnalysis, use userIntent which contains the analysis instructions
  let messageContent =
    state.searchDetails?.requiresAnalysis && state.userIntent
      ? state.userIntent
      : state.userQuery;

  // SPECIAL CASE: If requiresAnalysis is true and we have results in resultStore,
  // we're in responseWriter after tools have been called. Strip out the tool call instructions.
  if (
    state.searchDetails?.requiresAnalysis &&
    state.resultStore &&
    Object.keys(state.resultStore).length > 0
  ) {
    // Check if we have final results (tools have been executed)
    const hasFinalResults = Object.values(state.resultStore).some(
      (result: any) => result?.purpose === "final" && result?.data?.length > 0,
    );

    if (hasFinalResults) {
      // Remove the tool call instruction part, keep only the analysis instructions
      // Handle multiple patterns:
      // 1. "- Use executeDatomicQuery tool... After getting the results, analyze..."
      // 2. "- SINGLE-STEP QUERY: Call findPagesByTitle... After receiving results, analyze..."

      // Pattern 1: executeDatomicQuery
      messageContent = messageContent.replace(
        /- Use executeDatomicQuery tool[^.]*\.\s*After getting the results,/i,
        "- Using the provided search results,",
      );

      // Pattern 2: findPagesByTitle with SINGLE-STEP QUERY
      messageContent = messageContent.replace(
        /- SINGLE-STEP QUERY: Call findPagesByTitle[^.]*\.\s*After receiving results,/i,
        "- Using the provided search results,",
      );

      // Pattern 3: Generic "tool call" followed by "analyze"
      messageContent = messageContent.replace(
        /- SINGLE-STEP QUERY: Call \w+[^.]*\.\s*(The tool will[^.]*\.)?\s*After receiving results,/i,
        "- Using the provided search results,",
      );
    }
  }

  const userMessage = new HumanMessage({ content: messageContent });
  messages.push(userMessage);

  if ((state as any).isPopupExecution) {
    console.log(
      `🎯 [PopupExecution] User message: "${state.userQuery.substring(0, 200)}${
        state.userQuery.length > 200 ? "..." : ""
      }"`,
    );
  }

  // Use LLM without tools for pure response generation
  const llmStartTime = Date.now();

  // Create abort promise
  const abortPromise = new Promise((_, reject) => {
    if (state.abortSignal) {
      const abortHandler = () =>
        reject(new Error("Operation cancelled by user"));
      state.abortSignal.addEventListener("abort", abortHandler, { once: true });
    }
  });

  // Import streaming dependencies
  const { streamResponse } = await import("../../..");

  // Determine if we should stream (similar to aiAPIsHub logic)
  // Don't stream for thinking models or o1/o3 models as they need special handling
  const isThinkingModel =
    state.model.thinking ||
    state.model.id?.startsWith("o1") ||
    state.model.id?.startsWith("o3") ||
    state.model.id?.startsWith("o4") ||
    state.model.id?.includes("reasoning");

  // For popup execution, only stream if we have a streaming callback
  const shouldStream = (state as any).isPopupExecution
    ? (state as any).streamingCallback && !isThinkingModel
    : streamResponse && !isThinkingModel;

  let finalAnswerContent = "";
  let response: any;
  let streamElt: HTMLElement | null = null;
  let streamingTargetUid: string | undefined = undefined;

  if (shouldStream) {
    // Skip block creation for popup execution or forcePopupOnly - streaming will be text-only or returned as data
    if (!(state as any).isPopupExecution && !state.forcePopupOnly) {
      // For streaming, we need to create the response block first
      const { getInstantAssistantRole } = await import("../../..");
      const { chatRoles } = await import("../../..");
      const { createChildBlock, insertBlockInCurrentView } =
        await import("../../../utils/roamAPI");
      const { insertParagraphForStream } =
        await import("../../../utils/domElts");

      const assistantRole = state.model.id
        ? getInstantAssistantRole(state.model.id)
        : chatRoles?.assistant || "";

      // Create response block first for streaming
      // If no rootUid (no block focused), insert at end of current page
      if (state.rootUid) {
        streamingTargetUid = await createChildBlock(
          state.rootUid,
          assistantRole,
        );
      } else {
        streamingTargetUid = await insertBlockInCurrentView(assistantRole);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
      // Create streaming element for displaying progress
      streamElt = insertParagraphForStream(streamingTargetUid);
    }

    try {
      // Use LangChain streaming
      const streamingResponse = await Promise.race([
        llm.stream(messages),
        abortPromise,
      ]);

      let streamedContent = "";
      let usage_metadata: any = undefined;
      let chunkCount = 0;

      for await (const chunk of streamingResponse) {
        chunkCount++;

        // Check for cancellation
        if (state.abortSignal?.aborted) {
          if (streamElt) {
            streamElt.innerHTML += DOMPurify.sanitize(
              " (⚠️ stream interrupted by user)",
            );
          }
          finalAnswerContent = streamedContent; // Use what we got so far
          break;
        }

        const chunkContent = chunk.content || "";
        streamedContent += chunkContent;

        // Update streaming display with detailed logging
        if (streamElt && chunkContent) {
          streamElt.innerHTML += DOMPurify.sanitize(chunkContent);

          // Force a repaint by accessing offsetHeight
          streamElt.offsetHeight;
        } else if ((state as any).streamingCallback && chunkContent) {
          // Use popup streaming callback for chat interface
          (state as any).streamingCallback(chunkContent);
        } else if (!streamElt && !(state as any).streamingCallback) {
          console.warn(
            `🎯 [ResponseWriter] No stream element or callback available for chunk ${chunkCount}`,
          );
        }

        // Collect usage metadata from the last chunk
        if (chunk.usage_metadata) {
          usage_metadata = chunk.usage_metadata;
        }
      }

      // Create final response object for consistency with non-streaming path
      // We need to create a proper AIMessage for the messages array
      const responseOptions: any = { content: streamedContent };
      if (usage_metadata) {
        responseOptions.usage_metadata = usage_metadata;
      }
      response = new AIMessage(responseOptions);

      finalAnswerContent = streamedContent;
    } catch (error) {
      console.error("Streaming error:", error);
      if (streamElt) {
        streamElt.innerHTML += DOMPurify.sanitize(
          " (⚠️ streaming failed, generating response normally)",
        );
      }
      // Fallback to non-streaming
      response = await Promise.race([llm.invoke(messages), abortPromise]);
      finalAnswerContent =
        typeof response.content === "string"
          ? response.content
          : response.content?.toString() || "";
    } finally {
      // Clean up streaming element (will be handled by insertResponse)
    }
  } else {
    // Generate final response (original non-streaming path)
    response = await Promise.race([llm.invoke(messages), abortPromise]);

    // Ensure finalAnswer is a string
    finalAnswerContent =
      typeof response.content === "string"
        ? response.content
        : response.content?.toString() || "";
  }

  const llmDuration = Date.now() - llmStartTime;

  // Replace the temporary "Generating..." or "Crafting..." message
  const tempMessage = state.isDirectChat
    ? "💬 Generating chat response..."
    : "✍️ Crafting final response...";

  replaceLastToasterMessage(
    tempMessage,
    `✅ Response generated (${(llmDuration / 1000).toFixed(1)}s)`,
  );

  console.log(`🎯 [FinalResponseWriter] Response content:`, finalAnswerContent);

  // Track tokens and timing from final response generation
  const responseTokens = response.usage_metadata || {};
  const updatedTotalTokens = {
    input:
      (state.totalTokensUsed?.input || 0) + (responseTokens.input_tokens || 0),
    output:
      (state.totalTokensUsed?.output || 0) +
      (responseTokens.output_tokens || 0),
  };

  const updatedTimingMetrics = {
    totalLlmTime: (state.timingMetrics?.totalLlmTime || 0) + llmDuration,
    totalToolTime: state.timingMetrics?.totalToolTime || 0,
    llmCalls: (state.timingMetrics?.llmCalls || 0) + 1,
    toolCalls: state.timingMetrics?.toolCalls || 0,
  };

  return {
    messages: [...state.messages, response],
    finalAnswer: finalAnswerContent,
    totalTokensUsed: updatedTotalTokens,
    timingMetrics: updatedTimingMetrics,
    // Pass streaming element info to insertResponse
    streamElement: streamElt,
    wasStreamed: shouldStream,
    // Pass the created target UID for streaming (if created)
    streamingTargetUid: shouldStream ? streamingTargetUid : undefined,
    // Token usage - always include for all execution modes
    tokensUsage: { ...turnTokensUsage },
    // IMPORTANT: For popup execution, include conversation state since we skip insertResponse
    ...((state as any).isPopupExecution && {
      // Return same conversation state as insertResponse would
      toolResultsCache: state.toolResultsCache,
      cachedFullResults: state.cachedFullResults,
      hasLimitedResults: state.hasLimitedResults,
      resultSummaries: state.resultSummaries,
      resultStore: state.resultStore,
      nextResultId: state.nextResultId,
      conversationHistory: state.conversationHistory,
      conversationSummary: state.conversationSummary,
      exchangesSinceLastSummary: (state as any).exchangesSinceLastSummary,
      isConversationMode: state.isConversationMode,
    }),
  };
};

const insertResponse = async (state: typeof ReactSearchAgentState.State) => {
  // Use finalAnswer from finalResponseWriter, fallback to last message if needed
  const lastMessage: string =
    state.finalAnswer || state.messages.at(-1).content.toString();

  updateAgentToaster("📝 Preparing your results...");

  // Handle streaming element cleanup
  if (state.wasStreamed && state.streamElement) {
    // Remove the temporary streaming element
    try {
      state.streamElement.remove();
    } catch (error) {
      console.warn("Failed to remove streaming element:", error);
    }
  }

  // Calculate and display comprehensive timing and token metrics
  if (state.startTime) {
    const totalDuration = ((Date.now() - state.startTime) / 1000).toFixed(1);

    // Display timing breakdown
    if (state.timingMetrics) {
      const llmTime = (state.timingMetrics.totalLlmTime / 1000).toFixed(1);
      const toolTime = (state.timingMetrics.totalToolTime / 1000).toFixed(1);
      const llmCalls = state.timingMetrics.llmCalls;
      const toolCalls = state.timingMetrics.toolCalls;

      const streamingNote = state.wasStreamed ? " (with streaming)" : "";

      // Detailed timing for console
      console.log(
        `⏱️ Total: ${totalDuration}s (LLM: ${llmTime}s/${llmCalls} calls, Tools: ${toolTime}s/${toolCalls} calls)${streamingNote}`,
      );

      // Simplified timing for toaster
      replaceLastToasterMessage(
        "📝 Preparing your results...",
        `✅ Completed in ${totalDuration}s`,
      );
    } else {
      replaceLastToasterMessage(
        "📝 Preparing your results...",
        `✅ Completed in ${totalDuration}s`,
      );
    }
  }

  // Display total tokens used in both console and toaster
  if (
    state.totalTokensUsed &&
    (state.totalTokensUsed.input > 0 || state.totalTokensUsed.output > 0)
  ) {
    const totalTokens =
      state.totalTokensUsed.input + state.totalTokensUsed.output;
    const tokenMessage = `Total tokens: ${totalTokens} (${state.totalTokensUsed.input} in / ${state.totalTokensUsed.output} out)`;

    console.log(`🔢 ${tokenMessage}`);
    updateAgentToaster(`🔢 ${tokenMessage}`);
  }

  let targetUid: string;

  if (state.wasStreamed && state.streamingTargetUid) {
    // For streamed responses, use the pre-created block
    targetUid = state.streamingTargetUid;
  } else {
    // For non-streamed responses, create the block now
    const assistantRole = state.model.id
      ? getInstantAssistantRole(state.model.id)
      : chatRoles?.assistant || "";

    // If no rootUid (no block focused), insert at end of current page
    if (state.rootUid) {
      targetUid = await createChildBlock(state.rootUid, assistantRole);
    } else {
      const { insertBlockInCurrentView } =
        await import("../../../utils/roamAPI");
      targetUid = await insertBlockInCurrentView(assistantRole);
    }
  }

  await insertStructuredAIResponse({
    targetUid,
    content: lastMessage,
    forceInChildren: true,
  });

  // Calculate result stats for smart button logic - only count final results with actual data
  const finalResults = Object.values(state.resultStore || {}).filter(
    (result) => result?.purpose === "final" && result?.status === "active",
  );

  // Only count results from successful searches (no errors)
  const successfulResults = finalResults.filter((result) => !result.error);
  const totalFinalResults = successfulResults.reduce(
    (sum, result) =>
      sum + (Array.isArray(result?.data) ? result.data.length : 0),
    0,
  );

  // Check if expansion was applied during this session
  const expansionApplied =
    state.expansionGuidance?.includes("zero_results") ||
    state.expansionGuidance?.includes("Progressive expansion needed");

  return {
    targetUid,
    finalAnswer: lastMessage,
    // Return cached results for conversation continuity (MCP pattern)
    toolResultsCache: state.toolResultsCache,
    cachedFullResults: state.cachedFullResults,
    hasLimitedResults: state.hasLimitedResults,
    // NEW: Return token optimization state for conversation continuity
    resultSummaries: state.resultSummaries,
    resultStore: state.resultStore,
    nextResultId: state.nextResultId,
    // IMPORTANT: Return conversation state for continuity
    conversationHistory: state.conversationHistory,
    conversationSummary: state.conversationSummary,
    exchangesSinceLastSummary: (state as any).exchangesSinceLastSummary,
    isConversationMode: state.isConversationMode,
    // Token usage for this turn
    tokensUsage: { ...turnTokensUsage },
    // Enhanced expansion metadata for smart buttons - focus on successful final results only
    expansionState: {
      lastResultCount: totalFinalResults, // Only count successful final results (no errors)
      searchStrategy: state.searchStrategy,
      canExpand:
        state.searchStrategy !== "direct" &&
        totalFinalResults < 50 &&
        !expansionApplied,
      queryComplexity: state.queryComplexity,
      expansionApplied: expansionApplied, // Track if we already tried expansion
      hasErrors: finalResults.some((result) => result.error), // Track if there were tool errors
      appliedSemanticStrategies:
        state.expansionState?.appliedSemanticStrategies || [], // Preserve semantic expansion history
    },
  };
};

// Adaptive context expansion node with intelligent depth and truncation
const contextExpansion = async (state: typeof ReactSearchAgentState.State) => {
  updateAgentToaster("🌳 Checking if more surrounding context is needed...");

  // For scope strategy queries, expand content regardless of purpose
  // This ensures pattern analysis gets full page content
  const isScopeStrategyQuery = state.searchDetails?.needsContentExpansion;

  console.log(
    `🌳 [ContextExpansion] Starting expansion - isScopeStrategyQuery: ${isScopeStrategyQuery}`,
  );

  // Get final results for context expansion
  // For scope strategies, accept any active results (purpose might not be set to "final")
  const finalResults = Object.values(state.resultStore || {}).filter(
    (result) => {
      if (isScopeStrategyQuery) {
        // For scope strategies, accept any active results with data
        return result?.status === "active" && result?.data?.length > 0;
      }
      // For normal queries, require purpose="final"
      return (
        result?.purpose === "final" &&
        result?.status === "active" &&
        result?.data?.length > 0
      );
    },
  );

  if (finalResults.length === 0) {
    console.log(
      `🌳 [ContextExpansion] EARLY RETURN: No final results found in resultStore`,
    );
    console.log(
      `🌳 [ContextExpansion] ResultStore keys:`,
      Object.keys(state.resultStore || {}),
    );
    console.log(
      `🌳 [ContextExpansion] ResultStore contents:`,
      JSON.stringify(state.resultStore, null, 2).slice(0, 500),
    );
    return state; // Pass through unchanged
  }

  console.log(
    `🌳 [ContextExpansion] Found ${finalResults.length} result sets to expand`,
  );

  const allResults = finalResults.flatMap((r) => r.data || []);
  const resultCount = allResults.length;

  // Skip expansion if too many results (performance protection)
  if (resultCount > 500) {
    console.log(
      `🌳 [ContextExpansion] EARLY RETURN: Too many results (${resultCount} > 500)`,
    );
    return state;
  }

  // Determine mode and token limits
  const mode = state.privateMode
    ? "private"
    : state.permissions?.contentAccess
      ? "full"
      : "balanced";

  if (mode === "private") {
    return state;
  }

  // Calculate current content length
  const currentContentLength = calculateTotalContentLength(allResults);

  // Convert agent state to access mode for expansion
  const accessMode = state.privateMode
    ? "Private"
    : state.permissions?.contentAccess
      ? "Full Access"
      : "Balanced";

  const modelTokensLimit = state.model?.id
    ? (modelAccordingToProvider(state.model.id) as any).tokensLimit || 32000
    : 32000;

  const noTruncation = state.permissions?.noTruncation || false;

  const expansionBudget = noTruncation
    ? Number.MAX_SAFE_INTEGER
    : accessMode === "Full Access"
      ? modelTokensLimit * 3.8
      : modelTokensLimit * 2; //  ~90% context window vs ~50% context window

  console.log(
    `🌳 [ContextExpansion] Current content: ${currentContentLength} chars, limit: ${expansionBudget}, mode: ${mode}, accessMode: ${accessMode}, noTruncation: ${noTruncation}`,
  );
  console.log(
    `🌳 [ContextExpansion] About to expand ${resultCount} results (${
      allResults.filter((r) => r.isPage).length
    } pages, ${allResults.filter((r) => !r.isPage).length} blocks)`,
  );

  // Perform adaptive context expansion
  const expandedResults = await performAdaptiveExpansion(
    allResults,
    expansionBudget,
    currentContentLength,
    accessMode,
    noTruncation,
  );

  console.log(
    `🌳 [ContextExpansion] Expansion complete - got ${expandedResults.length} expanded results`,
  );

  if (expandedResults.length > 0) {
    // Log sample of expanded content
    const sampleExpanded = expandedResults[0];
    console.log(`🌳 [ContextExpansion] Sample expanded result:`, {
      uid: sampleExpanded.uid,
      hasContent: !!sampleExpanded.content,
      contentLength: sampleExpanded.content?.length || 0,
      contentPreview: sampleExpanded.content?.slice(0, 200),
    });

    // Store expanded results in result store
    const contextResultId = `contextExpansion_${state.nextResultId || 1}`;
    const updatedResultStore = { ...state.resultStore };
    updatedResultStore[contextResultId] = {
      data: expandedResults,
      purpose: "final",
      status: "active",
      toolName: "contextExpansion",
      timestamp: Date.now(),
      metadata: {
        contextExpansion: true,
        originalResultCount: resultCount,
        expandedResultCount: expandedResults.length,
        mode: mode,
      },
    };

    console.log(
      `🌳 [ContextExpansion] Stored expanded results in resultStore with id: ${contextResultId}`,
    );

    replaceLastToasterMessage(
      "🌳 Checking if more surrounding context is needed...",
      `🌳 Added surrounding context (${expandedResults.length} results)`,
    );

    return {
      ...state,
      resultStore: updatedResultStore,
      nextResultId: (state.nextResultId || 1) + 1,
    };
  }

  console.log(
    `🌳 [ContextExpansion] No expanded results - returning state unchanged`,
  );
  return state;
};

// Helper function to calculate total content length
function calculateTotalContentLength(results: any[]): number {
  return results.reduce((total, result) => {
    const content = result.content || result.pageTitle || "";
    return total + content.length;
  }, 0);
}

// Direct result formatting for simple private mode cases (no LLM needed)
const directFormat = async (state: typeof ReactSearchAgentState.State) => {
  updateAgentToaster("📝 Formatting results...");

  if (!state.resultStore || Object.keys(state.resultStore).length === 0) {
    return {
      ...state,
      finalAnswer: "No results found.",
    };
  }

  // Use IntentParser results for user limits and random sampling
  const userRequestedLimit = state.searchDetails?.maxResults || null;
  const isRandom = state.searchDetails?.requireRandom || false;
  const displayLimit = userRequestedLimit || 20; // Default to 20 if no specific limit requested

  console.log(
    `🎯 [DirectFormat] User requested limit: ${userRequestedLimit}, isRandom: ${isRandom}, using display limit: ${displayLimit}`,
  );

  // Get final/active results from resultStore
  const relevantEntries = Object.entries(state.resultStore).filter(
    ([, result]) => {
      return (
        (result?.purpose === "final" || result?.purpose === "completion") &&
        result?.status === "active"
      );
    },
  );

  if (relevantEntries.length === 0) {
    return {
      ...state,
      finalAnswer: "No results found.",
    };
  }

  // Collect all results and deduplicate by UID
  let allResults: any[] = [];
  let hasPages = false;
  let hasBlocks = false;

  for (const [, result] of relevantEntries) {
    const data = result?.data || [];
    if (!Array.isArray(data) || data.length === 0) continue;

    allResults.push(...data);
  }

  // Deduplicate by UID (essential when multiple tool calls return overlapping results)
  const deduplicatedResults = deduplicateResultsByUid(
    allResults,
    "DirectFormat",
  );

  // CRITICAL: Use deduplicated count for accurate display
  const totalCount = deduplicatedResults.length;

  // Apply sampling/limiting directly on results
  let limitedResults: any[] = [];
  let displayCount = 0;

  // Apply random sampling if requested
  if (isRandom) {
    const shuffled = [...deduplicatedResults];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    limitedResults = shuffled.slice(0, displayLimit);
  } else {
    limitedResults = deduplicatedResults.slice(0, displayLimit);
  }

  displayCount = limitedResults.length;

  // Format results
  const formattedItems = limitedResults.map((item) => {
    // Check if this is a page: has title but no content, or explicitly marked as page
    const isPage = (!!item.title && !item.content) || item.isPage;

    if (isPage) {
      hasPages = true;
      // Use page title for pages
      const pageTitle = item.pageTitle || item.title;
      return `- [[${pageTitle}]]`;
    } else {
      hasBlocks = true;
      // Use embed syntax for blocks
      return `- {{[[embed-path]]: ((${item.uid}))}}`;
    }
  });

  const formattedSections = [formattedItems.join("\n")];

  const formattedResults = formattedSections;

  // Create final formatted response with appropriate labeling
  let resultType = "results";
  if (hasPages && !hasBlocks) {
    resultType = "pages";
  } else if (hasBlocks && !hasPages) {
    resultType = "blocks";
  }

  let resultText;
  if (displayCount === totalCount) {
    resultText = `Found ${totalCount} matching ${resultType}:\n${formattedResults.join(
      "\n\n",
    )}`;
  } else {
    const samplingLabel = isRandom
      ? userRequestedLimit
        ? `${displayCount} random`
        : `${displayCount} random`
      : userRequestedLimit
        ? `first ${displayCount}`
        : `first ${displayCount}`;
    resultText = `Found ${totalCount} matching ${resultType} [showing ${samplingLabel}]:\n${formattedResults.join(
      "\n\n",
    )}`;

    // Add Full Results note only when there are more results than displayed
    if (totalCount > displayCount) {
      const actionText = isRandom
        ? 'Click the **"View Full Results"** button to see all results or get a different random sample.'
        : 'Click the **"View Full Results"** button to see all results with selection options.';
      resultText += `\n\n---\n**Note**: ${actionText}`;
    }
  }

  // Log result distribution for debugging

  // Replace the formatting message
  replaceLastToasterMessage(
    "📝 Formatting results...",
    `✅ Results formatted: ${totalCount} ${resultType}`,
  );

  return {
    ...state,
    finalAnswer: resultText,
  };
};

/**
 * Show current results first, then offer expansion options
 * This gives users visibility into what was found before deciding on expansion
 */
const showResultsThenExpand = (state: typeof ReactSearchAgentState.State) => {
  // Get current results from the state
  const finalResults = state.resultStore
    ? Object.values(state.resultStore)
    : [];
  const allResults = finalResults.flatMap((entry: any) =>
    Array.isArray(entry.data) ? entry.data : [],
  );

  const resultCount = allResults.length;

  // In secure mode or when results are limited, show them first
  let resultsSummary = "";
  if (state.permissions?.contentAccess === false || resultCount <= 5) {
    // Secure mode: show UIDs/titles (not token consuming)
    if (resultCount > 0) {
      const titles = allResults
        .map((r) => r.title || r.pageTitle || `Block ${r.uid}`)
        .slice(0, 5);
      resultsSummary = `\n\n📋 Current results (${resultCount}):\n${titles
        .map((t) => `• ${t}`)
        .join("\n")}`;
      if (resultCount > 5) {
        resultsSummary += `\n• ... and ${resultCount - 5} more`;
      }
    } else {
      resultsSummary = "\n\n📋 No results found yet.";
    }
  } else {
    // Balanced/Full mode: just show count to avoid token consumption
    resultsSummary =
      resultCount > 0
        ? `\n\n📋 Found ${resultCount} results (click "View Full Results" to see them)`
        : "\n\n📋 No results found yet.";
  }

  // Show context-aware expansion options with buttons
  const expansionOptions = getContextualExpansionOptions(
    state.userQuery,
    state.formalQuery,
    state.expansionState?.appliedSemanticStrategies,
  );

  const message =
    resultCount === 0
      ? `⚠️ No results found. Try expansion strategies:`
      : `⚠️ Found ${resultCount} results. Try expansion for better coverage:`;

  replaceLastToasterMessage(
    "📝 Formatting results...",
    message + resultsSummary,
  );

  // Don't call updateAgentToaster with empty string - just update the buttons
  // The buttons will be added to the existing toaster message
  const toasterElement = (window as any).agentToasterStream?.closest?.(
    ".bp3-toast",
  );
  if (toasterElement) {
    const existingButtons = toasterElement.querySelector(".buttons");
    if (existingButtons) {
      existingButtons.remove();
    }

    // Use the addButtonsToToaster function to add expansion buttons
    setTimeout(() => {
      const { addButtonsToToaster } = require("../shared/agentsUtils");
      addButtonsToToaster(
        null,
        ".search-agent-toaster",
        (window as any).agentToasterInstance,
        {
          showExpansionButton: true,
          expansionOptions: expansionOptions,
          showStopButton: false,
          showFullResultsButton: resultCount > 0,
        },
      );
    }, 50);
  }

  // INTERRUPT: Stop execution and wait for human input
  // Make sure full results are available for popup during interrupt

  // Store the current state and return a special marker to indicate interrupt
  // The graph execution will pause here until user provides expansion consent
  return {
    ...state,
    // Mark that we're waiting for expansion consent
    pendingExpansion: true,
    expansionMessage: message + resultsSummary,
    expansionOptions: expansionOptions,
  };
};

/**
 * Show scope selection dialog and wait for user choice
 * Similar to showPrivacyModeDialog but for exploratory query scope selection
 */
const showScopeSelectionDialog = async (
  state: typeof ReactSearchAgentState.State,
) => {
  // Import the display function dynamically to avoid circular dependencies
  const { displayScopeSelectionDialog } =
    await import("../../../utils/domElts.js");

  logger.info("Showing scope selection dialog");

  // Show the scope selection dialog with callback to handle user choice
  displayScopeSelectionDialog({
    scopeOptions: state.pendingScopeOptions,
    recommendedStrategy: state.pendingRecommendedStrategy,
    userQuery: state.userQuery,
    forceScopeSelection: state.forceScopeSelection, // Hide skip button if true
    onScopeSelect: (selectedStrategy: string) => {
      logger.info(`User selected scope strategy: ${selectedStrategy}`);
      // Dispatch custom event to resume graph execution
      const event = new CustomEvent("agentScopeSelection", {
        detail: {
          selectedStrategy,
          userIntent: state.userIntent,
        },
      });
      window.dispatchEvent(event);
    },
    onSkip: () => {
      logger.info("User skipped scope selection - running query directly");
      // Dispatch event to run query without scope
      const event = new CustomEvent("agentScopeSelection", {
        detail: {
          selectedStrategy: null, // null means skip scope analysis
          userIntent: state.userIntent,
        },
      });
      window.dispatchEvent(event);
    },
    onCancel: () => {
      logger.info("User cancelled scope selection");
      // Dispatch abort event to stop the agent
      const event = new CustomEvent("agentAbort", {
        detail: {
          reason: "User cancelled scope selection",
        },
      });
      window.dispatchEvent(event);
    },
  });

  // INTERRUPT: Stop execution and wait for user scope selection
  // The graph execution will pause here until user selects a strategy
  return {
    ...state,
    // Keep scope options in state for the event handler
    pendingScopeOptions: state.pendingScopeOptions,
    pendingRecommendedStrategy: state.pendingRecommendedStrategy,
  };
};

/**
 * Show privacy mode escalation dialog and wait for user choice
 * Similar to showResultsThenExpand but for privacy mode selection
 */
const showPrivacyModeDialog = async (
  state: typeof ReactSearchAgentState.State,
) => {
  // Import the display function dynamically to avoid circular dependencies
  const { displayAskGraphModeDialog } =
    await import("../../../utils/domElts.js");

  // Show the mode selection dialog with callback to handle user choice
  displayAskGraphModeDialog({
    currentMode: state.currentMode,
    suggestedMode: state.suggestedMode,
    userQuery: state.userQuery,
    onModeSelect: (selectedMode: string, rememberChoice: boolean) => {
      // Dispatch custom event to resume graph execution
      const event = new CustomEvent("agentPrivacyMode", {
        detail: {
          selectedMode,
          rememberChoice,
          currentMode: state.currentMode,
          suggestedMode: state.suggestedMode,
        },
      });
      window.dispatchEvent(event);
    },
  });

  const message = `🔒 Content Access Required: This query needs ${state.suggestedMode} mode for content analysis.`;

  // INTERRUPT: Stop execution and wait for user mode selection
  // The graph execution will pause here until user selects a privacy mode
  return {
    ...state,
    // Mark that we're waiting for privacy mode selection
    pendingPrivacyEscalation: true,
    privacyMessage: message,
    // CRITICAL: Set flag to bypass IntentParser on restart since we already processed it
    isPrivacyModeUpdated: true,
  };
};

// Edges
const shouldContinue = (state: typeof ReactSearchAgentState.State) => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];

  if (
    "tool_calls" in lastMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls?.length
  ) {
    return "tools";
  }

  // Check if we have sufficient final results to proceed with response
  const finalResults = Object.values(state.resultStore || {}).filter(
    (result) => result?.purpose === "final" && result?.status === "active",
  );
  const totalFinalResults = finalResults.reduce(
    (sum, result) =>
      sum + (Array.isArray(result?.data) ? result.data.length : 0),
    0,
  );

  const hasSufficientResults = totalFinalResults > 0;

  logger.debug(`shouldContinue result status:`, {
    hasSufficientResults,
    totalFinalResults,
  });

  // OPTIMIZATION: For simple private mode cases with results, skip LLM and format directly
  const requiresAnalysis = state.searchDetails?.requiresAnalysis || false;

  const canSkipResponseWriter =
    state.privateMode &&
    !state.isConversationMode &&
    hasSufficientResults &&
    !requiresAnalysis && // Don't skip if analysis explicitly required
    !state.userQuery?.includes("analysis") && // Don't skip for analysis requests
    !state.userQuery?.includes("explain") &&
    !state.userQuery?.includes("summary");

  // ALSO skip LLM when user requested specific limits (like "2 random blocks")
  // to ensure proper limit enforcement regardless of mode
  const hasUserLimits =
    state.searchDetails?.maxResults || state.searchDetails?.requireRandom;
  const canSkipForLimits =
    hasUserLimits &&
    !state.isConversationMode &&
    hasSufficientResults &&
    !requiresAnalysis && // Don't skip if analysis explicitly required
    !state.userQuery?.includes("analysis") &&
    !state.userQuery?.includes("explain") &&
    !state.userQuery?.includes("summary");

  if (canSkipResponseWriter) {
    return "directFormat";
  }

  if (canSkipForLimits) {
    // Balanced/full mode should use responseWriter for proper result processing
    if (!state.privateMode) {
      return "responseWriter";
    }

    return "directFormat";
  }

  // Check if we need expansion due to zero final results from successful searches (not errors)
  if (finalResults.length > 0 && state.searchStrategy !== "direct") {
    // Check successful results vs those with errors
    const successfulResults = finalResults.filter((result) => !result.error);
    const hasZeroSuccessfulResults =
      successfulResults.length > 0 &&
      successfulResults.every((result) => {
        // Check if successful result has zero actual data
        if (Array.isArray(result?.data) && result.data.length === 0)
          return true;
        if (result?.data?.length === 0) return true;
        return false;
      });

    const hasExpansionGuidance =
      state.expansionGuidance?.includes("zero_results") ||
      state.expansionGuidance?.includes("Progressive expansion needed");

    // Safety check: track zero results attempts to prevent infinite loops
    const maxZeroAttempts = 5;

    if (hasZeroSuccessfulResults) {
      // Increment counter for final purpose results with zero data
      // Remove !hasExpansionGuidance condition that was preventing counter increments
      const finalPurposeResults = successfulResults.filter(
        (result) => result.purpose === "final",
      );
      if (finalPurposeResults.length > 0) {
        state.zeroResultsAttempts = (state.zeroResultsAttempts || 0) + 1;
      }

      // Check if we've hit the safety limit (use updated counter)
      const updatedZeroAttempts = state.zeroResultsAttempts || 0;
      if (updatedZeroAttempts >= maxZeroAttempts) {
        console.log(
          `🛑 [Graph] Maximum zero results attempts reached (${maxZeroAttempts}). Stopping automatic expansion.`,
        );
        // Go to showResultsThenExpand to give user manual control
        return "showResultsThenExpand";
      }

      // CRITICAL SAFETY CHECK: If LLM made no tool calls in the last message, something is wrong
      // The LLM should either be making new tool calls or clearly stopping, not getting stuck in limbo
      if (
        lastMessage &&
        (!("tool_calls" in lastMessage) ||
          !Array.isArray(lastMessage.tool_calls) ||
          lastMessage.tool_calls.length === 0)
      ) {
        console.log(
          `🛑 [Graph] SAFETY: Assistant made no tool calls on attempt ${updatedZeroAttempts}/${maxZeroAttempts}. LLM may be stuck - forcing stop.`,
        );
        // Force stop to prevent infinite loops where LLM doesn't make tool calls
        return "showResultsThenExpand";
      }

      // Continue with automatic expansion
      return "assistant";
    }
  }

  // If we have results but can't use direct format, go to response writer
  // Simple routing based on final results - context expansion handled by dedicated node
  if (hasSufficientResults) {
    return "responseWriter";
  } else {
    // No final results or tool calls - in private mode, use directFormat for "No results found"
    if (state.privateMode) {
      return "directFormat";
    } else {
      return "responseWriter";
    }
  }
};

// Routing logic after loading model - use conversation router for intelligent routing
const routeAfterLoadModel = (state: typeof ReactSearchAgentState.State) => {
  if (state.isDirectChat) {
    return "responseWriter";
  }

  // Use conversation router for intelligent routing decisions
  return "conversationRouter";
};

// Routing logic after conversation router
const routeAfterConversationRouter = (
  state: typeof ReactSearchAgentState.State,
) => {
  // Check for direct expansion bypass first
  if (state.isDirectExpansion) {
    return "assistant";
  }

  // Check for privacy mode update bypass - skip IntentParser since we already have its response
  if (state.isPrivacyModeUpdated) {
    return "assistant";
  }

  if (state.routingDecision === "use_cache") {
    logger.flow("Graph", "ConversationRouter → CACHE_PROCESSOR");
    return "cacheProcessor";
  }
  if (state.routingDecision === "analyze_complexity") {
    logger.flow("Graph", "ConversationRouter → INTENT_PARSER");
    return "intentParser";
  }
  // Default: need_new_search
  logger.flow("Graph", "ConversationRouter → ASSISTANT");
  return "assistant";
};

// Routing logic for intent parsing
const routeAfterIntentParsing = (state: typeof ReactSearchAgentState.State) => {
  if (state.routingDecision === "show_privacy_dialog") {
    return "showPrivacyModeDialog";
  }

  if (state.routingDecision === "show_scope_options") {
    logger.flow("Graph", "IntentParser → SHOW_SCOPE_SELECTION_DIALOG");
    return "showScopeSelectionDialog";
  }

  const route =
    state.routingDecision === "use_cache" ? "cacheProcessor" : "assistant";
  logger.flow("Graph", `IntentParser → ${route.toUpperCase()}`);
  return route;
};

// Routing logic for cache processor
const routeAfterCache = (state: typeof ReactSearchAgentState.State) => {
  // If cache processor set routingDecision to need_new_search, go to assistant
  if (state.routingDecision === "need_new_search") {
    return "assistant";
  }
  // Otherwise, cache was sufficient, go directly to insertResponse

  return "insertResponse";
};

// Custom tools node with intelligent result lifecycle management
const toolsWithResultLifecycle = async (
  state: typeof ReactSearchAgentState.State,
) => {
  const toolStartTime = Date.now();

  // Handle popup execution progress tracking
  if ((state as any).isPopupExecution && (state as any).popupProgressCallback) {
    (state as any).popupProgressCallback("🔧 Executing search tools...");
  }

  // Create state-aware tool wrappers that auto-inject agent state
  const stateAwareTools = state.searchTools.map((tool) => {
    if (tool.name === "findBlocksByContent") {
      return {
        ...tool,
        invoke: async (llmInput: any, config?: any) => {
          // Tool handles all state injection internally via config.configurable.state
          return tool.invoke(llmInput, config);
        },
      };
    }
    if (tool.name === "findBlocksWithHierarchy") {
      return {
        ...tool,
        invoke: async (llmInput: any, config?: any) => {
          // Tool automatically detects when to use combination testing based on condition count

          // Tool handles all state injection internally via config.configurable.state
          return tool.invoke(llmInput, config);
        },
      };
    }
    if (tool.name === "findPagesByContent") {
      return {
        ...tool,
        invoke: async (llmInput: any, config?: any) => {
          // Tool handles all state injection internally via config.configurable.state
          return tool.invoke(llmInput, config);
        },
      };
    }
    return tool;
  });

  // Create the standard ToolNode for execution using state-aware tools
  const toolNode = new ToolNode(stateAwareTools);

  // Execute tools normally
  const result = await toolNode.invoke(state, {
    configurable: { state },
  });

  const toolDuration = Date.now() - toolStartTime;
  const toolCallCount = result.messages.filter(
    (m) => !m.tool_calls && m.content,
  ).length;

  // Process tool results with lifecycle management
  const { resultStore: updatedResultStore, resultIdCounter: nextResultId } =
    processToolResultsWithLifecycle(state, result.messages);

  // Handle popup execution result updates
  if ((state as any).isPopupExecution) {
    // Calculate total results across all stores
    let totalResults = 0;
    Object.values(updatedResultStore).forEach((store: any) => {
      if (store?.data && Array.isArray(store.data)) {
        totalResults += store.data.length;
      }
    });

    if ((state as any).popupProgressCallback && totalResults > 0) {
      (state as any).popupProgressCallback(`🔍 Found ${totalResults} results`);
    }

    if ((state as any).popupResultsCallback && totalResults > 0) {
      // Flatten all results for popup update
      const allResults: any[] = [];
      Object.values(updatedResultStore).forEach((store: any) => {
        if (store?.data && Array.isArray(store.data)) {
          allResults.push(...store.data);
        }
      });
      (state as any).popupResultsCallback(allResults, true); // Partial results
    }
  }

  // Update timing metrics
  const updatedTimingMetrics = {
    totalLlmTime: state.timingMetrics?.totalLlmTime || 0,
    totalToolTime: (state.timingMetrics?.totalToolTime || 0) + toolDuration,
    llmCalls: state.timingMetrics?.llmCalls || 0,
    toolCalls: (state.timingMetrics?.toolCalls || 0) + toolCallCount,
  };

  return {
    ...result,
    resultStore: updatedResultStore,
    nextResultId: nextResultId,
    timingMetrics: updatedTimingMetrics,
  };
};

// Smart routing after tool execution - skip assistant when results are sufficient
const routeAfterTools = (state: typeof ReactSearchAgentState.State) => {
  // Special routing for popup execution or forcePopupOnly - skip all formatting and go directly to end
  // This is critical when called from chat-agent: results should be returned as-is to the chat agent
  if ((state as any).isPopupExecution || state.forcePopupOnly) {
    return "__end__";
  }

  // Check if we have actual result data (not just result store entries)
  const hasResults =
    state.resultStore &&
    Object.values(state.resultStore).some((result: any) => {
      if (!result?.data) return false;

      // Handle case where data might be a JSON string instead of parsed array
      if (typeof result.data === "string" && result.data.length > 0) {
        try {
          const parsed = JSON.parse(result.data);
          return Array.isArray(parsed) && parsed.length > 0;
        } catch {
          return false;
        }
      }

      return Array.isArray(result.data) && result.data.length > 0;
    });

  if (hasResults) {
    // Get the most recent result with actual data
    const resultEntries = Object.entries(state.resultStore);
    const latestResult = resultEntries[resultEntries.length - 1]?.[1];

    // Detect if query requires multi-step analysis beyond simple block retrieval
    const requiresAnalysis =
      state.searchDetails?.requiresAnalysis ||
      detectAnalyticalQuery(state.userQuery || "");

    const canSkipAssistant =
      // Tool purpose is final (not intermediate exploration)
      latestResult?.purpose === "final" &&
      // Not in conversation mode (no user refinement expected)
      !state.isConversationMode &&
      // ONLY private mode should skip assistant and go to directFormat
      // Balanced and full modes should always go to responseWriter for LLM processing
      state.privateMode &&
      // Query doesn't require multi-step analysis
      !requiresAnalysis;

    // Check if this is a scope strategy query (exploratory pattern analysis)
    // These queries should ALWAYS go directly to contextExpansion after first tool call
    // to prevent multiple tool calls
    const isScopeStrategyQuery = state.searchDetails?.needsContentExpansion;

    console.log(`🔀 [Tools Routing] Decision factors:`, {
      isScopeStrategyQuery,
      canSkipAssistant,
      latestResultPurpose: latestResult?.purpose,
      isConversationMode: state.isConversationMode,
    });

    if (canSkipAssistant) {
      console.log(`🔀 [Tools] Routing to: directFormat (private mode)`);
      return "directFormat";
    } else if (
      // For scope strategy queries (exploratory pattern analysis):
      // Always skip assistant loop after first tool call and go directly to contextExpansion → responseWriter
      // This prevents multiple tool calls when analyzing patterns
      (isScopeStrategyQuery && !state.isConversationMode) ||
      // For final results with requiresAnalysis (like metadata-only queries),
      // skip assistant loop and go directly to contextExpansion → responseWriter
      // This prevents the tool from being called multiple times
      (latestResult?.purpose === "final" && !state.isConversationMode)
    ) {
      console.log(
        `🔀 [Tools] Routing to: contextExpansion (scope strategy or final result)`,
      );
      return "contextExpansion";
    } else {
      console.log(`🔀 [Tools] Routing to: assistant (normal flow)`);
      return "assistant";
    }
  }

  // No results found - tools handle expansion automatically

  // For automatic expansion modes, grant consent automatically
  const automaticExpansionMode = state.automaticExpansionMode;
  if (
    automaticExpansionMode &&
    (automaticExpansionMode === "auto_until_result" ||
      automaticExpansionMode === "always_fuzzy" ||
      automaticExpansionMode === "always_synonyms" ||
      automaticExpansionMode === "always_all")
  ) {
    state.expansionConsent = true;
  }

  // Show expansion options for ANY level when no results found (user should always have control)
  if (!state.expansionConsent) {
    // First, route to show current results, then interrupt for expansion
    return "showResultsThenExpand";
  }

  // If we have expansion consent, continue with expanded search

  // IMPORTANT: Reset expansion consent so it doesn't persist indefinitely
  // This prevents infinite loops where every subsequent call has expansion consent
  state.expansionConsent = false;

  return "assistant";
};

// Detect queries that require multi-step analysis beyond simple block retrieval
const detectAnalyticalQuery = (userQuery: string): boolean => {
  const query = userQuery.toLowerCase();

  // Patterns that require analysis/counting/ranking of search results
  const analyticalPatterns = [
    // Most/least patterns
    /\b(most|least|top|bottom|highest|lowest|best|worst)\b/,
    // Counting patterns
    /\b(count|number of|how many|combien)\b/,
    // Ranking/ordering patterns
    /\b(rank|order|sort|classify|organize|organise)\b/,
    // Analysis patterns
    /\b(analy[sz]e|analy[sz]is|examine|compare|contrast)\b/,
    // Reference analysis patterns
    /\b(mentioned|referenced|cited|linked|connected)\b.*\b(most|count|analy|rank)\b/,
    /\b(most|count|analy|rank)\b.*\b(mentioned|referenced|cited|linked|connected)\b/,
    // Aggregation patterns
    /\b(total|sum|aggregate|combine|merge)\b/,
    // Pattern detection (French support)
    /\b(plus|moins|le plus|la plus|combien|analyser)\b/,
    // Questions requiring synthesis
    /\b(what are the|which are the|quels sont|quelles sont)\b/,
  ];

  return analyticalPatterns.some((pattern) => pattern.test(query));
};

// Process tool results with intelligent lifecycle management
const processToolResultsWithLifecycle = (
  state: typeof ReactSearchAgentState.State,
  toolMessages: any[],
): { resultStore: Record<string, any>; resultIdCounter: number } => {
  const updatedResultStore = { ...state.resultStore };
  let currentResultId = state.nextResultId || 1;

  // Process each tool message
  for (const message of toolMessages) {
    if (message.tool_calls) {
      // This is a tool call message, skip
      continue;
    }

    // This is a tool result message
    if (message.content && typeof message.content === "string") {
      try {
        // Try to parse as JSON first
        const toolResult = JSON.parse(message.content);

        // Extract lifecycle parameters from the tool call
        const toolCall = findCorrespondingToolCall(
          state.messages,
          message.name,
        );
        const lifecycleParams = extractLifecycleParams(toolCall);

        // Generate result ID with incrementing counter
        const resultId = `${message.name}_${String(currentResultId).padStart(
          3,
          "0",
        )}`;
        currentResultId++; // Increment for next result

        if (toolResult.success && toolResult.data) {
          // Parse data if it's a JSON string (can happen with some tool wrappers)
          let data = toolResult.data;

          // Keep parsing while data is a string (handle multiple stringifications)
          while (typeof data === "string") {
            try {
              const parsed = JSON.parse(data);
              data = parsed;
            } catch {
              // If parsing fails, stop trying
              break;
            }
          }

          // Handle successful results
          handleResultLifecycle(
            updatedResultStore,
            resultId,
            data,
            message.name,
            lifecycleParams,
            toolResult.metadata,
          );
        } else if (!toolResult.success || toolResult.error) {
          // Handle tool errors - store as empty data with error flag
          handleResultLifecycle(
            updatedResultStore,
            resultId,
            [],
            message.name,
            lifecycleParams,
            toolResult.metadata,
            toolResult.error || "Tool execution failed",
          );
        }
      } catch (jsonError) {
        // If JSON parsing fails, check if it's a plain error message
        if (
          message.content.startsWith("Error:") ||
          message.content.includes("failed")
        ) {
          console.warn(
            `Tool ${message.name} returned error: ${message.content}`,
          );
          // Don't try to store failed results in result store
        } else {
          console.warn(
            `Failed to process tool result for ${message.name}:`,
            jsonError,
            `Content was: ${message.content.substring(0, 200)}...`,
          );
        }
      }
    }
  }

  return { resultStore: updatedResultStore, resultIdCounter: currentResultId };
};

// Find the tool call that corresponds to this result
const findCorrespondingToolCall = (messages: any[], toolName: string): any => {
  // Look for the most recent tool call with this name
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.tool_calls) {
      const toolCall = msg.tool_calls.find((tc: any) => tc.name === toolName);
      if (toolCall) return toolCall;
    }
  }
  return null;
};

// Extract lifecycle parameters from tool call
const extractLifecycleParams = (toolCall: any) => {
  if (!toolCall?.args) return {};

  return {
    purpose: toolCall.args.purpose || "final", // Default to final if not specified
    replacesResultId: toolCall.args.replacesResultId,
    completesResultId: toolCall.args.completesResultId,
  };
};

// Handle result lifecycle management
const handleResultLifecycle = (
  resultStore: Record<string, any>,
  resultId: string,
  data: any[],
  toolName: string,
  lifecycleParams: any,
  metadata?: any,
  error?: string,
) => {
  const { purpose, replacesResultId, completesResultId } = lifecycleParams;

  // Handle replacement logic
  if (purpose === "replacement" && replacesResultId) {
    if (resultStore[replacesResultId]) {
      resultStore[replacesResultId].status = "superseded";
    }
  }

  // Handle completion logic - mark both results as final
  if (purpose === "completion" && completesResultId) {
    if (resultStore[completesResultId]) {
      resultStore[completesResultId].purpose = "final";
    }
  }

  // Store the new result
  resultStore[resultId] = {
    data,
    purpose: purpose === "completion" ? "final" : purpose,
    status: "active",
    replacesResultId,
    completesResultId,
    toolName,
    timestamp: Date.now(),
    metadata, // Include metadata for access in directFormat
    error, // Track if this result had errors
  };
};

// Routing functions for popup execution
const routeAfterResponseWriter = (
  state: typeof ReactSearchAgentState.State,
) => {
  if ((state as any).isPopupExecution || state.forcePopupOnly) {
    return "__end__";
  }

  return "insertResponse";
};

const routeAfterDirectFormat = (state: typeof ReactSearchAgentState.State) => {
  if ((state as any).isPopupExecution || state.forcePopupOnly) {
    return "__end__";
  }

  return "insertResponse";
};

// Build the ReAct Search Agent graph with human-in-the-loop support
const builder = new StateGraph(ReactSearchAgentState);
builder
  .addNode("loadModel", loadModel)
  .addNode("conversationRouter", conversationRouter)
  .addNode("intentParser", intentParser)
  .addNode("cacheProcessor", cacheProcessor)
  .addNode("assistant", assistant)
  .addNode("tools", toolsWithResultLifecycle)
  .addNode("contextExpansion", contextExpansion)
  .addNode("responseWriter", responseWriter)
  .addNode("directFormat", directFormat)
  .addNode("showResultsThenExpand", showResultsThenExpand)
  .addNode("showScopeSelectionDialog", showScopeSelectionDialog)
  .addNode("showPrivacyModeDialog", showPrivacyModeDialog)
  .addNode("insertResponse", insertResponse)

  .addEdge(START, "loadModel")
  .addConditionalEdges("loadModel", routeAfterLoadModel)
  .addConditionalEdges("conversationRouter", routeAfterConversationRouter)
  .addConditionalEdges("intentParser", routeAfterIntentParsing)
  .addConditionalEdges("cacheProcessor", routeAfterCache)
  .addConditionalEdges("assistant", shouldContinue)
  .addConditionalEdges("tools", routeAfterTools)
  .addEdge("contextExpansion", "responseWriter")
  .addConditionalEdges("responseWriter", routeAfterResponseWriter)
  .addConditionalEdges("directFormat", routeAfterDirectFormat)
  .addEdge("showScopeSelectionDialog", "__end__")
  .addEdge("insertResponse", "__end__");

// Note: Expansion event handling is now managed in ask-your-graph-invoke.ts
// using promise-based interrupts for better control flow

export const ReactSearchAgent = builder.compile({
  // Configure human-in-the-loop interrupts
  interruptBefore: [], // We handle interrupts via "__interrupt__" return value
  // Note: We use "__interrupt__" return from conditional edges instead of interruptBefore
  // This gives us more granular control over when to interrupt
});

// Store agent state globally for expansion handling
declare global {
  interface Window {
    currentSearchAgentState?: any;
    currentSearchAgentExecution?: {
      continueWithExpansion?: () => void;
    };
  }
}

// This file contains only the core ReAct agent implementation
