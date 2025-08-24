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
  parseJSONWithFields,
  generateSummaryText,
} from "../shared/agentsUtils";

// Import our tools registry
import {
  getAvailableTools,
  listAvailableToolNames,
} from "./tools/toolsRegistry";

// Import search utilities
import { deduplicateResultsByUid } from "./tools/searchUtils";

// Import prompts from separate file
import {
  buildSystemPrompt,
  buildIntentParserPrompt,
  buildFinalResponseSystemPrompt,
  buildCacheProcessingPrompt,
  buildCacheSystemPrompt,
} from "./ask-your-graph-prompts";

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
  // Permissions
  permissions: Annotation<{ contentAccess: boolean }>,
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
  // Token tracking across entire agent execution
  totalTokensUsed: Annotation<{ input: number; output: number }>,
  // Request analysis and routing
  routingDecision: Annotation<
    "use_cache" | "need_new_search" | "analyze_complexity"
  >,
  reformulatedQuery: Annotation<string | undefined>,
  originalSearchContext: Annotation<string | undefined>,
  // Enhanced complexity analysis
  queryComplexity: Annotation<"simple" | "logical" | "multi-step">,
  userIntent: Annotation<string | undefined>,
  // New symbolic query fields
  formalQuery: Annotation<string | undefined>,
  searchStrategy: Annotation<"direct" | "hierarchical" | undefined>,
  analysisType: Annotation<
    "count" | "compare" | "connections" | "summary" | undefined
  >,
  language: Annotation<string | undefined>,
  confidence: Annotation<number | undefined>,
  datomicQuery: Annotation<string | undefined>,
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
        timeRange?: { start: string; end: string };
        maxResults?: number;
        requireRandom?: boolean;
        depthLimit?: number;
      }
    | undefined
  >,
  strategicGuidance: Annotation<{
    approach?:
      | "single_search"
      | "multiple_searches_with_union"
      | "multi_step_workflow";
    recommendedSteps?: string[];
  }>,
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
  expansionLevel: Annotation<number>, // Track current expansion level (0-6)
  expansionConsent: Annotation<boolean>, // User consent for expensive expansions (level 4+)
  zeroResultsAttempts: Annotation<number>, // Track consecutive zero result attempts (max 5)
  // Timing and cancellation
  startTime: Annotation<number>,
  abortSignal: Annotation<AbortSignal | undefined>,
  // Automatic semantic expansion setting
  automaticExpansion: Annotation<boolean>,
  // Direct expansion bypass flag
  isDirectExpansion: Annotation<boolean>,
});

// Global variables for the agent
let llm: StructuredOutputType;
let turnTokensUsage: TokensUsage;
let searchTools: any[] = [];

// Initialize and get all available tools
const initializeTools = (permissions: { contentAccess: boolean }) => {
  // Get tools based on permissions using the registry
  searchTools = getAvailableTools(permissions);

  console.log(
    `🔧 Initialized ${searchTools.length} tools:`,
    listAvailableToolNames(permissions)
  );

  return searchTools;
};

/**
 * Build specific retry guidance based on retry type
 */
const buildRetryGuidance = (
  retryType: string,
  hasCachedResults: boolean
): string => {
  const baseGuidance = hasCachedResults
    ? "Previous search results are available in cache. "
    : "No previous results cached. ";

  switch (retryType) {
    case "semantic":
      return (
        baseGuidance +
        "Apply semantic expansion: use related concepts, synonyms, and findPagesSemantically for page references."
      );

    case "hierarchical":
      return (
        baseGuidance +
        "Apply hierarchical expansion: convert flat searches to hierarchical (A + B → A <=> B), use deep hierarchy (>> instead of >), try bidirectional relationships."
      );

    case "expansion":
      return (
        baseGuidance +
        "Apply progressive expansion: fuzzy matching, semantic variations, scope broadening. Try Levels 4-6 strategies progressively."
      );

    case "basic":
    default:
      return (
        baseGuidance +
        "Apply basic retry with fuzzy matching and basic expansions."
      );
  }
};

// Conversation router node for intelligent routing decisions
const conversationRouter = async (
  state: typeof ReactSearchAgentState.State
) => {
  console.log(
    `🔀 [ConversationRouter] Analyzing routing for: "${state.userQuery}"`
  );

  // Check for direct expansion bypass first - should skip all other routing logic
  console.log(`🔧 [ConversationRouter] Debug state:`, {
    isDirectExpansion: (state as any).isDirectExpansion,
    semanticExpansion: (state as any).semanticExpansion,
    isExpansionGlobal: (state as any).isExpansionGlobal,
  });

  if ((state as any).isDirectExpansion) {
    console.log(
      `🔀 [ConversationRouter] Direct expansion detected → skipping to need_new_search`
    );
    return {
      routingDecision: "need_new_search" as const,
      reformulatedQuery: state.userQuery,
      originalSearchContext: "direct expansion request",
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
    pattern.test(query)
  );
  const isCacheSuitable = cacheSuitablePatterns.some((pattern) =>
    pattern.test(query)
  );
  const needsComplexAnalysis = complexAnalysisPatterns.some((pattern) =>
    pattern.test(query)
  );

  // Handle retry requests first (highest priority)
  if (retryType && hasConversationHistory) {
    console.log(
      `🔄 [ConversationRouter] Retry detected: ${retryType} expansion requested`
    );

    const expansionGuidance = buildRetryGuidance(retryType, hasCachedResults);

    return {
      routingDecision: "analyze_complexity" as const, // Use intent parser to apply specific expansion
      reformulatedQuery: state.userQuery,
      expansionGuidance: expansionGuidance,
    };
  }

  // Decision logic
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
    strategicGuidance: {
      approach: "single_search" as const,
      recommendedSteps: ["Execute direct search based on user query"],
    },
  };
};

// Intent Parser node with symbolic language
const intentParser = async (state: typeof ReactSearchAgentState.State) => {
  console.log(`🎯 [IntentParser] Parsing request: "${state.userQuery}"`);
  updateAgentToaster("🎯 Parsing user intent...");

  const parsingPrompt = buildIntentParserPrompt({
    userQuery: state.userQuery,
    conversationHistory: state.conversationHistory,
    conversationSummary: state.conversationSummary,
    permissions: state.permissions,
    privateMode: state.privateMode,
  });

  try {
    const parsingLlm = modelViaLanggraph(state.model, turnTokensUsage);
    const response = await parsingLlm.invoke([
      new SystemMessage({ content: parsingPrompt }),
      new HumanMessage({ content: state.userQuery }),
    ]);

    const responseContent = response.content.toString();
    console.log(`🎯 [IntentParser] Raw response:`, responseContent);

    // Parse the Intent Parser response
    const analysis = parseJSONWithFields<{
      routingDecision?: "direct_datomic";
      datomicQuery?: string;
      userIntent: string;
      formalQuery: string;
      constraints: {
        timeRange?: { start: string; end: string };
        maxResults?: number;
        requireRandom?: boolean;
        depthLimit?: number;
      };
      searchStrategy: "direct" | "hierarchical";
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
      language: string;
      confidence: number;
    }>(responseContent, {
      routingDecision: ["routingDecision"],
      datomicQuery: ["datomicQuery"],
      userIntent: ["userIntent"],
      formalQuery: ["formalQuery"],
      constraints: ["constraints"],
      searchStrategy: ["searchStrategy"],
      analysisType: ["analysisType"],
      expansionGuidance: ["expansionGuidance"],
      isExpansionGlobal: ["isExpansionGlobal"],
      semanticExpansion: ["semanticExpansion"],
      customSemanticExpansion: ["customSemanticExpansion"],
      language: ["language"],
      confidence: ["confidence"],
    });

    if (!analysis) {
      console.warn("Failed to parse Intent Parser response, using fallback");
      return {
        routingDecision: "need_new_search" as const,
        formalQuery: state.userQuery,
        userIntent: state.userQuery,
        searchStrategy: "direct" as const,
        confidence: 0.5,
      };
    }

    // Handle direct Datomic query routing
    if (analysis.routingDecision === "direct_datomic") {
      console.log(`🎯 [IntentParser] Direct Datomic query detected`);
      updateAgentToaster("🔄 Executing Datomic query...");

      return {
        routingDecision: "need_new_search" as const,
        datomicQuery: analysis.datomicQuery,
        userIntent: analysis.userIntent,
        queryComplexity: "simple" as const,
        strategicGuidance: {
          approach: "single_search" as const,
          recommendedSteps: ["Execute user-provided Datomic query"],
        },
      };
    }

    // Log semantic expansion detection
    if (analysis.isExpansionGlobal) {
      console.log(
        `🎯 [IntentParser] Global semantic expansion detected: ${
          analysis.semanticExpansion || "synonyms"
        }`
      );
    }

    // Expansion guidance is now handled in ReAct Assistant prompt when needed
    const expansionGuidanceForLLM = "";

    // Show user-friendly summary in toaster
    updateAgentToaster(`🔍 Symbolic query: ${analysis.formalQuery}`);
    updateAgentToaster(`🔍 ${analysis.searchStrategy} search strategy planned`);
    if (analysis.isExpansionGlobal) {
      updateAgentToaster(
        `🧠 Global semantic expansion: ${
          analysis.semanticExpansion || "synonyms"
        }`
      );
    }

    return {
      routingDecision: "need_new_search" as const,
      formalQuery: analysis.formalQuery, // Keep original, let LLM apply expansions
      userIntent: analysis.userIntent,
      queryComplexity: determineComplexity(analysis.formalQuery),
      strategicGuidance: {
        approach: determineApproach(analysis.formalQuery),
        recommendedSteps: generateExecutionSteps(
          analysis.formalQuery,
          analysis.analysisType
        ),
      },
      searchStrategy: analysis.searchStrategy,
      analysisType: analysis.analysisType,
      searchDetails: analysis.constraints,
      expansionGuidance: expansionGuidanceForLLM || analysis.expansionGuidance, // Use generated guidance
      isExpansionGlobal: analysis.isExpansionGlobal,
      semanticExpansion: analysis.semanticExpansion,
      customSemanticExpansion: analysis.customSemanticExpansion,
      language: analysis.language,
      confidence: analysis.confidence,
    };
  } catch (error) {
    console.error("Intent parsing failed:", error);
    updateAgentToaster("⚠️ Using fallback parsing");

    // Fallback with basic parsing
    return {
      routingDecision: "need_new_search" as const,
      formalQuery: state.userQuery,
      userIntent: state.userQuery,
      queryComplexity: "simple" as const,
      strategicGuidance: {
        approach: "single_search" as const,
        recommendedSteps: ["Execute basic search"],
      },
      searchStrategy: "direct" as const,
      confidence: 0.3,
    };
  }
};

// Helper functions for symbolic query processing and expansion

/**
 * Get user-friendly description of expansion strategy for toaster
 * Simplified 3-level system aligned with Roam usage patterns
 */
const getExpansionStrategyDescription = (
  level: number,
  intent: string
): string => {
  const strategies = {
    1: "Hierarchical expansion (bidirectional relationships, deep hierarchy)",
    2: "Fuzzy + semantic expansion (typos, synonyms, related concepts)",
    3: "Multi-tool strategy (alternative approaches, broader scope)",
  };

  const baseStrategy = strategies[level] || "Advanced expansion";

  if (intent === "semantic") {
    return `${baseStrategy} + enhanced AI semantic understanding`;
  } else if (intent === "hierarchical") {
    return `${baseStrategy} + deeper hierarchy analysis`;
  }

  return baseStrategy;
};

// Generate simple, consistent expansion options with contextual logic
const getContextualExpansionOptions = (
  userQuery: string,
  formalQuery?: string,
  appliedSemanticStrategies?: Array<
    "fuzzy" | "synonyms" | "related_concepts" | "broader_terms" | "custom"
  >
): string => {
  // Use formal query for analysis if available, fallback to user query
  const queryToAnalyze = formalQuery || userQuery;

  // Detect if this is primarily a page search
  const isPageSearch =
    queryToAnalyze.includes("page:(") ||
    userQuery.toLowerCase().includes("page") ||
    userQuery.toLowerCase().includes("title");

  // Detect if query has multiple conditions using symbolic operators
  const hasMultipleConditions =
    queryToAnalyze.includes("+") || // AND operator
    queryToAnalyze.includes("|") || // OR operator
    queryToAnalyze.includes("-"); // NOT operator

  const options = [];
  const appliedStrategies = appliedSemanticStrategies || [];

  // Define all semantic strategies with their info
  const semanticStrategies = {
    fuzzy: {
      emoji: "🔍",
      label: "Fuzzy matching (typos, morphological variations)",
    },
    synonyms: { emoji: "📝", label: "Synonyms and alternative terms" },
    related_concepts: {
      emoji: "🧠",
      label: "Related concepts and associated terms",
    },
    broader_terms: {
      emoji: "🔺",
      label: "Broader categories and umbrella terms",
    },
  };

  // First option: "Automatic until results" (normal level-to-level progression)
  options.push("🤖 Auto (let the agent test progressive strategy)");

  // Second option: "All semantic expansions at once" (only if no semantic expansion has been processed)
  const hasProcessedSemanticExpansion = appliedStrategies.some((strategy) =>
    ["fuzzy", "synonyms", "related_concepts", "broader_terms"].includes(
      strategy
    )
  );

  if (!hasProcessedSemanticExpansion) {
    options.push("⚡ All at once (fuzzy + synonyms + related concepts)");
  }

  // Add individual semantic strategies that haven't been processed yet
  const availableStrategies = Object.keys(semanticStrategies).filter(
    (strategy) => !appliedStrategies.includes(strategy as any)
  );

  // Don't display "broader_terms" if "related_concepts" has not been processed
  if (!appliedStrategies.includes("related_concepts")) {
    const broaderIndex = availableStrategies.indexOf("broader_terms");
    if (broaderIndex > -1) {
      availableStrategies.splice(broaderIndex, 1);
    }
  }

  // Add available semantic strategies
  for (const strategy of availableStrategies) {
    const info =
      semanticStrategies[strategy as keyof typeof semanticStrategies];
    options.push(`${info.emoji} ${info.label}`);
  }

  // Add hierarchy option for block searches with multiple conditions
  if (!isPageSearch && hasMultipleConditions) {
    options.push(
      "🏗️ Deepen hierarchy search (explore parent/child relationships)"
    );
  }

  // Always offer multi-strategy as final fallback
  options.push("🔄 Try other search strategies (combine different approaches)");

  // Format as bullet points
  return options.map((option) => `• ${option}`).join("\n");
};

const determineComplexity = (
  formalQuery: string
): "simple" | "logical" | "multi-step" => {
  if (formalQuery.includes("→")) return "multi-step";
  if (
    formalQuery.includes("+") ||
    formalQuery.includes("|") ||
    formalQuery.includes("-")
  )
    return "logical";
  return "simple";
};

const determineApproach = (
  formalQuery: string
): "single_search" | "multiple_searches_with_union" | "multi_step_workflow" => {
  if (formalQuery.includes("→")) return "multi_step_workflow";
  if (formalQuery.includes("|")) return "multiple_searches_with_union";
  return "single_search";
};

const generateExecutionSteps = (
  formalQuery: string,
  analysisType?: string
): string[] => {
  const steps = [`Execute symbolic query: ${formalQuery}`];
  if (analysisType) {
    steps.push(`Apply ${analysisType} analysis to results`);
  }
  return steps;
};

/**
 * Build optimized cache results summary using the new summarization system
 */
const buildCacheResultsSummary = (
  state: typeof ReactSearchAgentState.State
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
  cacheProcessorResponse: string
): Promise<string> => {
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
      securityMode
    );

    try {
      const llm = modelViaLanggraph(state.model, turnTokensUsage);
      const response = await llm.invoke([
        new SystemMessage({ content: cacheSystemPrompt }),
        new HumanMessage({ content: state.userQuery }),
      ]);

      return response.content.toString();
    } catch (error) {
      console.warn(
        "Cache-based response generation failed, using original:",
        error
      );
      return cacheProcessorResponse;
    }
  }

  // For legacy results or when no new results available, return original response
  return cacheProcessorResponse;
};

const cacheProcessor = async (state: typeof ReactSearchAgentState.State) => {
  console.log(
    `💾 [CacheProcessor] Processing request: "${
      state.reformulatedQuery || state.userQuery
    }"`
  );
  // Count available results from both new and legacy systems
  const newResultsCount = Object.keys(state.resultSummaries || {}).length;
  const legacyResultsCount = Object.keys(state.cachedFullResults || {}).length;
  const totalResultsCount = newResultsCount + legacyResultsCount;

  console.log(
    `💾 [CacheProcessor] Available cached results: ${totalResultsCount} (${newResultsCount} new + ${legacyResultsCount} legacy)`
  );
  updateAgentToaster("💾 Processing cached results...");

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
    const cacheProcessingLlm = modelViaLanggraph(state.model, turnTokensUsage);
    const response = await cacheProcessingLlm.invoke([
      new SystemMessage({ content: cacheProcessingPrompt }),
      new HumanMessage({ content: state.reformulatedQuery || state.userQuery }),
    ]);

    const responseContent = response.content.toString();

    // Handle HYBRID approach (new intelligent conversation mode)
    if (responseContent.startsWith("HYBRID:")) {
      console.log(
        `💾 [CacheProcessor] Strategy: ${responseContent.substring(0, 500)}...`
      );

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
      };
    }

    // Check if cache was insufficient
    if (responseContent.startsWith("INSUFFICIENT_CACHE:")) {
      console.log(
        `💾 [CacheProcessor] → Routing to NEW SEARCH (cache insufficient)`
      );
      console.log(
        `💾 [CacheProcessor] Guidance provided: ${responseContent.substring(
          0,
          200
        )}...`
      );

      // Pass the guidance to ReAct assistant
      const enhancedQuery =
        (state.reformulatedQuery || state.userQuery) + "\n\n" + responseContent;

      return {
        routingDecision: "need_new_search" as const,
        messages: [new HumanMessage(enhancedQuery)],
      };
    }

    // Cache was sufficient, prepare final response using actual result data
    console.log(`💾 [CacheProcessor] → FINAL RESPONSE (cache sufficient)`);

    // For cache-sufficient responses, we should generate a proper final answer using our result data
    // This ensures consistency with the new finalResponseWriter approach
    const finalResponse = await generateCacheBasedResponse(
      state,
      responseContent
    );

    return {
      messages: [...state.messages, response],
      finalAnswer: finalResponse,
    };
  } catch (error) {
    console.error("Cache processing failed:", error);
    // Fallback to new search on error
    return {
      routingDecision: "need_new_search" as const,
      messages: [new HumanMessage(state.reformulatedQuery || state.userQuery)],
    };
  }
};

const loadModel = async (state: typeof ReactSearchAgentState.State) => {
  const startTime = state.startTime || Date.now();

  console.log("state.rootUid :>> ", state.rootUid);

  // Initialize LLM
  llm = modelViaLanggraph(state.model, turnTokensUsage);

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
    // Initialize expansion tracking (Level 0 = initial search, Level 1+ = expansions)
    expansionLevel: state.expansionLevel || 0,
    expansionConsent: state.expansionConsent || false,
  };
};

const assistant = async (state: typeof ReactSearchAgentState.State) => {
  // Check for cancellation
  if (state.abortSignal?.aborted) {
    throw new Error("Operation cancelled by user");
  }

  // Handle direct expansion with pre-configured parameters
  console.log(`🔧 [Assistant] Debug state:`, {
    isDirectExpansion: (state as any).isDirectExpansion,
    semanticExpansion: (state as any).semanticExpansion,
    stateSemanticExpansion: state.semanticExpansion,
    isExpansionGlobal: (state as any).isExpansionGlobal,
    stateIsExpansionGlobal: state.isExpansionGlobal,
  });

  if ((state as any).isDirectExpansion) {
    console.log(
      `🎯 [Direct Expansion] Injecting expansion parameters from agentData`
    );

    // Inject expansion parameters directly into state (they should already be in agentData)
    if ((state as any).semanticExpansion) {
      state.semanticExpansion = (state as any).semanticExpansion;
    }
    if ((state as any).isExpansionGlobal !== undefined) {
      state.isExpansionGlobal = (state as any).isExpansionGlobal;
    }
    if ((state as any).expansionLevel !== undefined) {
      state.expansionLevel = (state as any).expansionLevel;
    }

    console.log(
      `🎯 [Direct Expansion] State updated with semanticExpansion: ${state.semanticExpansion}, isExpansionGlobal: ${state.isExpansionGlobal}, expansionLevel: ${state.expansionLevel}`
    );
  }

  // Tools are already filtered by permissions in loadModel
  // Note: State-aware tool wrappers are now handled in toolsWithResults for proper execution
  const llm_with_tools = llm.bindTools(state.searchTools);

  // Check if we need to add expansion strategies to the system prompt
  let shouldAddExpansionStrategies = false;

  // Check if user requested exact matches (skip expansion)
  const requestsExactMatch =
    state.userQuery?.toLowerCase().includes("exact") || false;

  // Only check final results for expansion decision
  const finalResults = Object.values(state.resultStore || {}).filter(
    (result) => result?.purpose === "final" && result?.status === "active"
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

  // Add expansion strategies for:
  // 1. Successful searches with <100 results, OR
  // 2. No results found (most important case for expansion)
  // NOTE: searchStrategy should NOT block expansion - user should always have expansion options when results are insufficient
  // CRITICAL: Maximum expansion level is 4 to prevent infinite loops
  if (
    hasToolsBeenExecuted &&
    (hasLowResults || hasNoResults) &&
    !requestsExactMatch &&
    (state.expansionLevel || 0) < 4 // Maximum expansion level is 4
  ) {
    const currentExpansionLevel = state.expansionLevel || 0;
    console.log(
      `🔍 [Assistant] Detected ${totalResultCount} final results ${
        hasNoResults ? "(zero results)" : "(low results <100)"
      }, adding expansion strategies (level ${currentExpansionLevel + 1})`
    );

    shouldAddExpansionStrategies = true;

    // Show specific expansion strategy being applied
    const expansionStrategy = getExpansionStrategyDescription(
      currentExpansionLevel + 1,
      state.searchStrategy || "direct"
    );
    updateAgentToaster(
      `🔧 Level ${currentExpansionLevel + 1}: ${expansionStrategy}`
    );

    // Update expansion state for UI buttons
    // Determine which semantic strategy is being applied based on expansion level
    const currentLevel = state.expansionLevel || 0;
    const appliedStrategies =
      state.expansionState?.appliedSemanticStrategies || [];

    // Map expansion level to semantic strategy (progression order)
    const levelToStrategyMap = {
      1: "fuzzy" as const,
      2: "synonyms" as const,
      3: "related_concepts" as const,
      // Level 4+ uses different tool strategies, not semantic expansion
    };

    const currentStrategy =
      levelToStrategyMap[currentLevel as keyof typeof levelToStrategyMap];
    const updatedStrategies =
      currentStrategy && !appliedStrategies.includes(currentStrategy)
        ? [...appliedStrategies, currentStrategy]
        : appliedStrategies;

    state.expansionState = {
      canExpand: true,
      lastResultCount: totalResultCount,
      searchStrategy: state.searchStrategy || "basic",
      queryComplexity: state.queryComplexity || "simple",
      appliedSemanticStrategies: updatedStrategies,
    };
  } else if (
    hasToolsBeenExecuted &&
    (hasLowResults || hasNoResults) &&
    !requestsExactMatch &&
    (state.expansionLevel || 0) >= 4 // Maximum level reached
  ) {
    console.log(
      `🛑 [Assistant] Maximum expansion level (4) reached with ${totalResultCount} results. No further expansion available.`
    );
    updateAgentToaster(
      `🛑 Maximum expansion level reached. Consider rephrasing your query or using different search terms.`
    );
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
    strategicGuidance: state.strategicGuidance,
    searchDetails: state.searchDetails,
    // Expansion support
    searchStrategy: state.searchStrategy,
    isExpansionGlobal: state.isExpansionGlobal,
    semanticExpansion: state.semanticExpansion,
    shouldAddExpansionStrategies: shouldAddExpansionStrategies,
    currentExpansionLevel: shouldAddExpansionStrategies
      ? (state.expansionLevel || 0) + 1 // If expansion is active, tell assistant the NEXT level
      : state.expansionLevel || 0, // Otherwise, use current level
  });
  // console.log("Assistant systemPrompt :>> ", systemPrompt);
  const contextInstructions = `

CRITICAL INSTRUCTION: 
When using findBlocksByContent, findBlocksWithHierarchy, or findPagesByContent, always include excludeBlockUid parameter set to: "${state.rootUid}" to exclude the user's request block from results.`;

  const combinedSystemPrompt = systemPrompt + contextInstructions;
  const sys_msg = new SystemMessage({ content: combinedSystemPrompt });

  updateAgentToaster("🤖 Understanding your request...");

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
          // Create a concise summary instead of full results (no specific result ID needed here)
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
          console.log(
            `🎯 [Assistant] Replaced verbose tool result (${msg.content.length} chars) with summary (${summaryContent.length} chars)`
          );

          // Create a new ToolMessage with the summary content
          return new ToolMessage({
            content: summaryContent,
            tool_call_id: (msg as any).tool_call_id,
            name: msg.name,
          });
        }
      } catch (e) {
        // If parsing fails, return original message
      }
    }
    return msg;
  });

  const messages = [sys_msg, ...optimizedMessages];

  console.log(
    `🎯 [Assistant] System prompt length: ${combinedSystemPrompt.length} chars`
  );

  // CLEAR EXPANSION LEVEL LOGGING
  const currentLevel = state.expansionLevel || 0;
  const nextLevel = shouldAddExpansionStrategies
    ? currentLevel + 1
    : currentLevel;
  console.log(
    `🔍 [EXPANSION] ASSISTANT CALLED AT LEVEL ${nextLevel} (currentLevel=${currentLevel}, shouldAddExpansionStrategies=${shouldAddExpansionStrategies})`
  );

  if (shouldAddExpansionStrategies) {
    console.log(
      `🧠 [EXPANSION] Level ${nextLevel} expansion strategies INCLUDED in system prompt for query: "${state.userQuery}"`
    );
  } else {
    console.log(
      `🚫 [EXPANSION] NO expansion strategies in system prompt (level ${currentLevel})`
    );
  }
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

  console.log("Assistant response :>>, response");

  const llmDuration = ((Date.now() - llmStartTime) / 1000).toFixed(1);

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

            return `${termDisplay}${limitText}${scopeText}`;
          }
          const searchText =
            args.conditions?.find((c: any) => c.type === "text")?.text ||
            "content";
          return `"${searchText}" in blocks`;

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
            return `pages with ${searchTerms.join(combineLogic)}${limitText}`;
          }
          const pageSearchText = args.searchText || args.query || "content";
          return `pages with "${pageSearchText}"`;

        case "findPagesByTitle":
          const titleText = args.pageTitle || args.searchText || "page";
          return `pages titled "${titleText}"`;

        case "findPagesSemantically":
          return `related to "${args.query || "concept"}"`;

        case "extractPageReferences":
          const blockCount = Array.isArray(args.blockUids)
            ? args.blockUids.length
            : "results";
          return `analyzing ${blockCount} blocks → finding referenced pages`;

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
          return `${opText} ${resultCount} search results`;

        case "getNodeDetails":
          const nodeType = args.pageTitle ? "page" : "block";
          const nodeName = args.pageTitle || `block ${args.blockUid || ""}`;
          return `reading ${nodeType} details: ${nodeName}`;

        case "findBlocksWithHierarchy":
          const hierarchyQuery =
            args.conditions?.find((c: any) => c.type === "text")?.text ||
            "blocks";
          return `"${hierarchyQuery}" with context hierarchy`;

        case "extractHierarchyContent":
          const hierarchyCount = Array.isArray(args.blockUids)
            ? args.blockUids.length
            : "results";
          return `extracting hierarchy from ${hierarchyCount} blocks`;

        case "executeDatomicQuery":
          if (args.query) {
            // User-provided query
            const queryPreview =
              args.query.length > 50
                ? args.query.substring(0, 47) + "..."
                : args.query;
            return `executing custom Datalog: ${queryPreview}`;
          } else if (args.variables) {
            // Parameterized query
            const varCount = Object.keys(args.variables).length;
            const queryHint = args.description || "parameterized query";
            return `executing query with ${varCount} variables: ${queryHint}`;
          } else {
            // Auto-generated query
            const queryHint =
              args.description || args.criteria || "advanced database search";
            return `generating & executing query: ${queryHint}`;
          }

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
          exp.includes("blocks")
      ).length;
      const analysisCount = toolExplanations.filter(
        (exp) =>
          exp.includes("analyzing") ||
          exp.includes("→") ||
          exp.includes("combining")
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

    updateAgentToaster(`🔍 ${explanation} (${llmDuration}s)`);
  } else {
    updateAgentToaster(`✅ Analysis complete (${llmDuration}s)`);
  }

  return {
    messages: [...state.messages, response],
    totalTokensUsed: updatedTotalTokens,
    // Increment expansion level if expansion strategies were added this round
    expansionLevel: shouldAddExpansionStrategies
      ? (state.expansionLevel || 0) + 1
      : state.expansionLevel || 0,
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

  // Build system prompt with access to actual result data via state
  const responseSystemPrompt = buildFinalResponseSystemPrompt(
    state,
    securityMode
  );
  console.log(
    `🎯 [FinalResponseWriter] System prompt length: ${responseSystemPrompt.length} chars`
  );
  console.log(
    `🎯 [FinalResponseWriter] System prompt preview:`,
    responseSystemPrompt.substring(0, 500) + "..."
  );
  const sys_msg = new SystemMessage({ content: responseSystemPrompt });

  // Build conversation messages for direct chat mode
  const messages = [sys_msg];

  if (
    state.isDirectChat &&
    state.conversationHistory &&
    state.conversationHistory.length > 0
  ) {
    // Include recent conversation history as actual messages for better context
    const recentHistory = state.conversationHistory.slice(-6); // Last 3 exchanges (6 messages)
    for (const msg of recentHistory) {
      if (msg.role === "user") {
        messages.push(new HumanMessage({ content: msg.content }));
      } else if (msg.role === "assistant") {
        messages.push(new AIMessage({ content: msg.content })); // Use AIMessage for assistant responses
      }
    }
  }

  // Add current user message
  const userMessage = new HumanMessage({ content: state.userQuery });
  messages.push(userMessage);

  console.log(
    `🎯 [ResponseWriter] Total messages: ${messages.length}${
      state.isDirectChat ? " (including conversation history)" : ""
    }`
  );
  console.log(
    `🎯 [ResponseWriter] System message length: ${sys_msg.content.length}`
  );
  if (state.isDirectChat && state.conversationHistory?.length > 0) {
    console.log(
      `💬 [DirectChat] Including ${state.conversationHistory.length} previous conversation messages`
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

  // Generate final response
  const response = await Promise.race([
    llm.invoke(messages), // Note: no tools binding for pure response
    abortPromise,
  ]);

  const llmDuration = ((Date.now() - llmStartTime) / 1000).toFixed(1);
  updateAgentToaster(`✅ Response generated (${llmDuration}s)`);

  console.log(`🎯 [FinalResponseWriter] Response content:`, response.content);

  // Track tokens from final response generation
  const responseTokens = response.usage_metadata || {};
  const updatedTotalTokens = {
    input:
      (state.totalTokensUsed?.input || 0) + (responseTokens.input_tokens || 0),
    output:
      (state.totalTokensUsed?.output || 0) +
      (responseTokens.output_tokens || 0),
  };

  // Ensure finalAnswer is a string
  const finalAnswerContent =
    typeof response.content === "string"
      ? response.content
      : response.content?.toString() || "";

  return {
    messages: [...state.messages, response],
    finalAnswer: finalAnswerContent,
    totalTokensUsed: updatedTotalTokens,
  };
};

const insertResponse = async (state: typeof ReactSearchAgentState.State) => {
  // Use finalAnswer from finalResponseWriter, fallback to last message if needed
  const lastMessage: string =
    state.finalAnswer || state.messages.at(-1).content.toString();

  updateAgentToaster("📝 Preparing your results...");

  // Calculate total execution time
  if (state.startTime) {
    const totalDuration = ((Date.now() - state.startTime) / 1000).toFixed(1);
  }

  // Display total tokens used in toaster
  if (
    state.totalTokensUsed &&
    (state.totalTokensUsed.input > 0 || state.totalTokensUsed.output > 0)
  ) {
    const totalTokens =
      state.totalTokensUsed.input + state.totalTokensUsed.output;
    updateAgentToaster(
      `🔢 Total tokens: ${totalTokens} (${state.totalTokensUsed.input} in / ${state.totalTokensUsed.output} out)`
    );
  }

  const assistantRole = state.model.id
    ? getInstantAssistantRole(state.model.id)
    : chatRoles?.assistant || "";

  // Create response block
  const targetUid = await createChildBlock(state.rootUid, assistantRole);

  await insertStructuredAIResponse({
    targetUid,
    content: lastMessage,
    forceInChildren: true,
  });

  console.log("✅ ReAct Search Agent completed");

  // Calculate result stats for smart button logic - only count final results with actual data
  const finalResults = Object.values(state.resultStore || {}).filter(
    (result) => result?.purpose === "final" && result?.status === "active"
  );

  // Only count results from successful searches (no errors)
  const successfulResults = finalResults.filter((result) => !result.error);
  const totalFinalResults = successfulResults.reduce(
    (sum, result) =>
      sum + (Array.isArray(result?.data) ? result.data.length : 0),
    0
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

// Direct result formatting for simple private mode cases (no LLM needed)
const directFormat = async (state: typeof ReactSearchAgentState.State) => {
  console.log(
    `🎯 [DirectFormat] Formatting results without LLM for private mode`
  );
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
    `🔍 [DEBUG DirectFormat] Full searchDetails:`,
    state.searchDetails
  );
  console.log(
    `🎯 [DirectFormat] User requested limit: ${userRequestedLimit}, isRandom: ${isRandom}, using display limit: ${displayLimit}`
  );

  // Get final/active results from resultStore
  const relevantEntries = Object.entries(state.resultStore).filter(
    ([, result]) => {
      return (
        (result?.purpose === "final" || result?.purpose === "completion") &&
        result?.status === "active"
      );
    }
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
    "DirectFormat"
  );

  // CRITICAL: Use deduplicated count for accurate display
  const totalCount = deduplicatedResults.length;

  // Group results by expansion level for ranking-aware display
  const resultsByLevel = {
    0: deduplicatedResults.filter(
      (item) => item && (item.expansionLevel || 0) === 0
    ), // Exact matches
    1: deduplicatedResults.filter(
      (item) => item && (item.expansionLevel || 0) === 1
    ), // Hierarchical
    2: deduplicatedResults.filter(
      (item) => item && (item.expansionLevel || 0) === 2
    ), // Fuzzy + Semantic
    3: deduplicatedResults.filter(
      (item) => item && (item.expansionLevel || 0) === 3
    ), // Multi-tool
  };

  const levelLabels = {
    0: "Exact matches",
    1: "Hierarchical expansion",
    2: "Fuzzy + semantic expansion",
    3: "Multi-tool expansion",
  };

  // Apply sampling/limiting across all levels proportionally
  let limitedResults: any[] = [];
  let displayCount = 0;
  const formattedSections: string[] = [];

  for (let level = 0; level <= 3; level++) {
    const levelResults = resultsByLevel[level];
    if (levelResults.length === 0) continue;

    // Calculate how many results to show from this level
    let levelLimit = levelResults.length;
    if (displayCount + levelResults.length > displayLimit) {
      levelLimit = Math.max(1, displayLimit - displayCount); // At least show 1 from each level
    }

    let levelLimitedResults;

    // Apply random sampling within level if requested
    if (isRandom) {
      const shuffled = [...levelResults];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      levelLimitedResults = shuffled.slice(0, levelLimit);
    } else {
      levelLimitedResults = levelResults.slice(0, levelLimit);
    }

    limitedResults.push(...levelLimitedResults);
    displayCount += levelLimitedResults.length;

    // Format results for this expansion level
    const levelFormattedItems = levelLimitedResults.map((item) => {
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

    // Add section header only if there are multiple expansion levels present
    const hasMultipleLevels =
      Object.values(resultsByLevel).filter((arr) => arr.length > 0).length > 1;
    if (hasMultipleLevels && levelFormattedItems.length > 0) {
      const sectionHeader = `**${levelLabels[level]} (${levelResults.length})**:`;
      formattedSections.push(
        `${sectionHeader}\n${levelFormattedItems.join("\n")}`
      );
    } else if (levelFormattedItems.length > 0) {
      formattedSections.push(levelFormattedItems.join("\n"));
    }

    // Stop if we've reached the display limit
    if (displayCount >= displayLimit) break;
  }

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
      "\n\n"
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
      "\n\n"
    )}`;

    // Add Full Results note only when there are more results than displayed
    if (totalCount > displayCount) {
      const actionText = isRandom
        ? 'Click the **"View Full Results"** button to see all results or get a different random sample.'
        : 'Click the **"View Full Results"** button to see all results with selection options.';
      resultText += `\n\n---\n**Note**: ${actionText}`;
    }
  }

  // Log expansion level distribution for debugging
  const levelCounts = Object.entries(resultsByLevel)
    .map(([level, results]) => `L${level}: ${results.length}`)
    .filter((_, i) => resultsByLevel[i].length > 0);

  console.log(
    `🎯 [DirectFormat] Generated direct response: ${
      resultText.length
    } chars, hasPages: ${hasPages}, hasBlocks: ${hasBlocks}, expansion levels: [${levelCounts.join(
      ", "
    )}]`
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
  console.log(
    "🎯 [ShowResultsThenExpand] Showing current results before expansion options"
  );

  // Get current results from the state
  const finalResults = state.resultStore
    ? Object.values(state.resultStore)
    : [];
  const allResults = finalResults.flatMap((entry: any) =>
    Array.isArray(entry.data) ? entry.data : []
  );

  const resultCount = allResults.length;
  const currentExpansionLevel = state.expansionLevel || 0;

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
    state.expansionState?.appliedSemanticStrategies
  );

  const message =
    resultCount === 0
      ? `⚠️ No results found. Try expansion strategies:`
      : `⚠️ Found ${resultCount} results. Try expansion for better coverage:`;

  console.log(`🎯 [TOASTER DEBUG] Calling updateAgentToaster with:`, {
    message: message + resultsSummary,
    showExpansionButton: true,
    expansionOptions: expansionOptions,
    expansionOptionsArray: expansionOptions.split("\n"),
  });

  updateAgentToaster(message + resultsSummary, {
    showExpansionButton: true,
    expansionOptions: expansionOptions,
    showFullResultsButton: resultCount > 0, // Enable full results button if we have results
  });

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

// Edges
const shouldContinue = (state: typeof ReactSearchAgentState.State) => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];

  if (
    "tool_calls" in lastMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls?.length
  ) {
    console.log(
      `🔀 [Graph] Assistant → TOOLS (${lastMessage.tool_calls.length} tool calls)`
    );

    // Debug logging: capture tool calls before schema validation
    console.log("🔍 [DEBUG] RAW TOOL CALLS BEFORE VALIDATION:");
    lastMessage.tool_calls.forEach((toolCall: any, index: number) => {
      console.log(`🔍 [DEBUG] Tool Call ${index + 1}:`, {
        name: toolCall.name,
        args: JSON.stringify(toolCall.args, null, 2),
      });
    });

    return "tools";
  }

  // Check if we have sufficient final results to proceed with response
  const finalResults = Object.values(state.resultStore || {}).filter(
    (result) => result?.purpose === "final" && result?.status === "active"
  );
  const totalFinalResults = finalResults.reduce(
    (sum, result) =>
      sum + (Array.isArray(result?.data) ? result.data.length : 0),
    0
  );

  const hasSufficientResults = totalFinalResults > 0;
  const hasZeroFinalResults =
    finalResults.length > 0 && totalFinalResults === 0;

  // OPTIMIZATION: For simple private mode cases with results, skip LLM and format directly
  const canSkipResponseWriter =
    state.privateMode &&
    !state.isConversationMode &&
    hasSufficientResults &&
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
    !state.userQuery?.includes("analysis") &&
    !state.userQuery?.includes("explain") &&
    !state.userQuery?.includes("summary");

  if (canSkipResponseWriter) {
    console.log(
      `🔀 [Graph] Assistant → DIRECT_FORMAT (private mode optimization)`
    );
    return "directFormat";
  }

  if (canSkipForLimits) {
    console.log(
      `🔀 [Graph] Assistant → DIRECT_FORMAT (user requested limits: ${
        state.searchDetails?.maxResults || "N/A"
      } results, random: ${state.searchDetails?.requireRandom || false})`
    );
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

    if (hasZeroSuccessfulResults && !hasExpansionGuidance) {
      // Increment counter only for final purpose results with zero data
      const finalPurposeResults = successfulResults.filter(
        (result) => result.purpose === "final"
      );
      if (finalPurposeResults.length > 0) {
        state.zeroResultsAttempts = (state.zeroResultsAttempts || 0) + 1;
        console.log(
          `📊 [Graph] Incrementing zero results counter for final purpose results: ${state.zeroResultsAttempts}`
        );
      }

      // Check if we've hit the safety limit (use updated counter)
      const updatedZeroAttempts = state.zeroResultsAttempts || 0;
      if (updatedZeroAttempts >= maxZeroAttempts) {
        console.log(
          `🛑 [Graph] Maximum zero results attempts reached (${maxZeroAttempts}). Stopping automatic expansion.`
        );
        // Go to showResultsThenExpand to give user manual control
        return "showResultsThenExpand";
      }

      // Check expansion level limits for automatic progression
      const currentLevel = state.expansionLevel || 0;
      if (currentLevel >= 4) {
        console.log(
          `🔄 [Graph] Level 4 reached with zero results. Prompting assistant to try different tool strategies.`
        );

        // Add strategic guidance to prompt assistant to change approach
        state.expansionGuidance = `zero_results_level_4_strategy_change: You have reached maximum expansion level (4) with zero results. 
CRITICAL: You MUST now try completely different tool strategies and sequences. Consider:

🔧 DIFFERENT TOOL COMBINATIONS:
- Try findPagesByContent instead of findBlocksByContent (or vice versa)
- Use extractHierarchyContent for broader context discovery
- Combine multiple tools with different search patterns
- Use extractPageReferences to find related content

🎯 ALTERNATIVE SEARCH APPROACHES:
- Break down complex queries into simpler parts
- Search for synonyms or related concepts  
- Use broader or narrower search terms
- Try different search operators (AND, OR, NOT)

🧠 STRATEGIC THINKING:
- Reflect on why previous searches failed
- Question if the content exists in this format
- Consider if the user query needs reinterpretation
- Try searching for metadata, tags, or references instead of direct content

You MUST change your tool strategy - don't repeat the same approach that gave zero results.`;

        return "assistant";
      }

      console.log(
        `🔀 [Graph] Assistant → CONTINUE WITH EXPANSION (0 results, attempt ${state.zeroResultsAttempts}/${maxZeroAttempts}, level ${currentLevel})`
      );

      // Continue with automatic expansion
      return "assistant";
    }
  }

  // If we have results but can't use direct format, go to response writer
  if (hasSufficientResults) {
    console.log(
      `🔀 [Graph] Assistant → RESPONSE_WRITER (${totalFinalResults} final results available)`
    );
  } else {
    console.log(
      `🔀 [Graph] Assistant → RESPONSE_WRITER (no final results or tool calls)`
    );
  }

  return "responseWriter";
};

// Routing logic after loading model - use conversation router for intelligent routing
const routeAfterLoadModel = (state: typeof ReactSearchAgentState.State) => {
  if (state.isDirectChat) {
    console.log(`🔀 [Graph] LoadModel → RESPONSE_WRITER (direct chat mode)`);
    return "responseWriter";
  }

  // Use conversation router for intelligent routing decisions
  return "conversationRouter";
};

// Routing logic after conversation router
const routeAfterConversationRouter = (
  state: typeof ReactSearchAgentState.State
) => {
  // Check for direct expansion bypass first
  if ((state as any).isDirectExpansion) {
    console.log(
      `🔀 [Graph] ConversationRouter → ASSISTANT (direct expansion bypass)`
    );
    return "assistant";
  }

  if (state.routingDecision === "use_cache") {
    console.log(`🔀 [Graph] ConversationRouter → CACHE_PROCESSOR`);
    return "cacheProcessor";
  }
  if (state.routingDecision === "analyze_complexity") {
    console.log(`🔀 [Graph] ConversationRouter → INTENT_PARSER`);
    return "intentParser";
  }
  // Default: need_new_search
  console.log(`🔀 [Graph] ConversationRouter → ASSISTANT`);
  return "assistant";
};

// Routing logic for intent parsing
const routeAfterIntentParsing = (state: typeof ReactSearchAgentState.State) => {
  const route =
    state.routingDecision === "use_cache" ? "cacheProcessor" : "assistant";
  console.log(`🔀 [Graph] IntentParser → ${route.toUpperCase()}`);
  return route;
};

// Routing logic for cache processor
const routeAfterCache = (state: typeof ReactSearchAgentState.State) => {
  // If cache processor set routingDecision to need_new_search, go to assistant
  if (state.routingDecision === "need_new_search") {
    console.log(`🔀 [Graph] CacheProcessor → ASSISTANT (cache insufficient)`);
    return "assistant";
  }
  // Otherwise, cache was sufficient, go directly to insertResponse
  console.log(`🔀 [Graph] CacheProcessor → INSERT RESPONSE (cache sufficient)`);
  return "insertResponse";
};

// Custom tools node with intelligent result lifecycle management
const toolsWithResultLifecycle = async (
  state: typeof ReactSearchAgentState.State
) => {
  // Create state-aware tool wrappers that auto-inject agent state
  const stateAwareTools = state.searchTools.map((tool) => {
    if (tool.name === "findBlocksByContent") {
      return {
        ...tool,
        invoke: async (llmInput: any, config?: any) => {
          const enrichedInput = {
            ...llmInput,
            resultMode: state.privateMode ? "uids_only" : "summary",
            secureMode: state.privateMode || false,
            userQuery: state.userQuery || "",
            excludeBlockUid: state.rootUid || "",
            expansionLevel: state.expansionLevel || 0, // Track expansion level for ranking
          };
          return tool.invoke(enrichedInput, config);
        },
      };
    }
    if (tool.name === "findBlocksWithHierarchy") {
      return {
        ...tool,
        invoke: async (llmInput: any, config?: any) => {
          const enrichedInput = {
            ...llmInput,
            secureMode: state.privateMode || false,
            excludeBlockUid: state.rootUid || "",
            expansionLevel: state.expansionLevel || 0,
          };
          return tool.invoke(enrichedInput, config);
        },
      };
    }
    if (tool.name === "findPagesByContent") {
      return {
        ...tool,
        invoke: async (llmInput: any, config?: any) => {
          const enrichedInput = {
            ...llmInput,
            secureMode: state.privateMode || false,
            excludeBlockUid: state.rootUid || "",
            expansionLevel: state.expansionLevel || 0,
          };
          return tool.invoke(enrichedInput, config);
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

  // Process tool results with lifecycle management
  const updatedResultStore = processToolResultsWithLifecycle(
    state,
    result.messages
  );

  return {
    ...result,
    resultStore: updatedResultStore,
    nextResultId:
      (state.nextResultId || 1) +
      result.messages.filter((m) => !m.tool_calls && m.content).length,
  };
};

// Smart routing after tool execution - skip assistant when results are sufficient
const routeAfterTools = (state: typeof ReactSearchAgentState.State) => {
  // Check if we have actual result data (not just result store entries)
  const hasResults =
    state.resultStore &&
    Object.values(state.resultStore).some(
      (result) =>
        result?.data && Array.isArray(result.data) && result.data.length > 0
    );

  if (hasResults) {
    // Get the most recent result with actual data
    const resultEntries = Object.entries(state.resultStore);
    const latestResult = resultEntries[resultEntries.length - 1]?.[1];

    // Detect if query requires multi-step analysis beyond simple block retrieval
    const requiresAnalysis = detectAnalyticalQuery(state.userQuery || "");

    // Check if user requested specific limits (like "2 random blocks")
    const hasUserLimits =
      state.searchDetails?.maxResults || state.searchDetails?.requireRandom;

    // DEBUG: Log routing decision details
    console.log(
      `🔍 [DEBUG routeAfterTools] searchDetails:`,
      state.searchDetails
    );
    console.log(`🔍 [DEBUG routeAfterTools] hasUserLimits: ${hasUserLimits}`);
    console.log(`🔍 [DEBUG routeAfterTools] latestResult:`, {
      purpose: latestResult?.purpose,
      dataLength: latestResult?.data?.length,
    });
    console.log(`🔍 [DEBUG routeAfterTools] conditions:`, {
      isConversationMode: state.isConversationMode,
      privateMode: state.privateMode,
      requiresAnalysis: requiresAnalysis,
    });

    const canSkipAssistant =
      // Tool purpose is final (not intermediate exploration)
      latestResult?.purpose === "final" &&
      // Not in conversation mode (no user refinement expected)
      !state.isConversationMode &&
      // Private mode (simple formatting)
      // or Has sufficient data (>=10 results)
      // or User requested specific limits (need directFormat for proper limit enforcement)
      (latestResult?.data?.length >= 10 ||
        state.privateMode ||
        hasUserLimits) &&
      // Query doesn't require multi-step analysis
      !requiresAnalysis;

    console.log(
      `🔍 [DEBUG routeAfterTools] canSkipAssistant: ${canSkipAssistant}`
    );

    if (canSkipAssistant) {
      console.log(
        `🔀 [Graph] TOOLS → DIRECT_FORMAT (sufficient results: ${latestResult.data.length}, purpose: ${latestResult.purpose}, hasUserLimits: ${hasUserLimits})`
      );
      return "directFormat";
    } else if (requiresAnalysis) {
      console.log(
        `🔀 [Graph] TOOLS → ASSISTANT (query requires analysis: "${state.userQuery}")`
      );
      return "assistant";
    }
  }

  // No results found - check expansion level and user consent
  const currentExpansionLevel = state.expansionLevel || 0;
  const maxExpansionLevel = 3; // Simplified 3-level system

  // If we've reached max expansion levels, route to directFormat in private mode
  if (currentExpansionLevel >= maxExpansionLevel) {
    if (state.privateMode) {
      console.log(
        `🔀 [Graph] TOOLS → DIRECT_FORMAT (max expansion reached, private mode)`
      );
      return "directFormat";
    } else {
      console.log(
        `🔀 [Graph] TOOLS → RESPONSE_WRITER (max expansion reached, public mode)`
      );
      return "responseWriter";
    }
  }

  // Show expansion options for ANY level when no results found (user should always have control)
  if (!state.expansionConsent) {
    console.log(
      `🔀 [Graph] TOOLS → SHOW_RESULTS_THEN_EXPAND (showing current results before expansion options for level ${
        currentExpansionLevel + 1
      })`
    );

    // First, route to show current results, then interrupt for expansion
    return "showResultsThenExpand";
  }

  // If we have expansion consent, continue with expanded search
  console.log(
    `🔀 [Graph] TOOLS → ASSISTANT (expansion consent granted, level ${currentExpansionLevel}, strategy: ${
      state.expansionState?.searchStrategy || state.searchStrategy || "default"
    })`
  );

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
  toolMessages: any[]
): Record<string, any> => {
  const updatedResultStore = { ...state.resultStore };

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
          message.name
        );
        const lifecycleParams = extractLifecycleParams(toolCall);

        // Generate result ID
        const resultId = `${message.name}_${String(
          state.nextResultId || 1
        ).padStart(3, "0")}`;

        if (toolResult.success && toolResult.data) {
          // Handle successful results
          handleResultLifecycle(
            updatedResultStore,
            resultId,
            toolResult.data,
            message.name,
            lifecycleParams,
            toolResult.metadata
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
            toolResult.error || "Tool execution failed"
          );
        }
      } catch (jsonError) {
        // If JSON parsing fails, check if it's a plain error message
        if (
          message.content.startsWith("Error:") ||
          message.content.includes("failed")
        ) {
          console.warn(
            `Tool ${message.name} returned error: ${message.content}`
          );
          // Don't try to store failed results in result store
        } else {
          console.warn(
            `Failed to process tool result for ${message.name}:`,
            jsonError,
            `Content was: ${message.content.substring(0, 200)}...`
          );
        }
      }
    }
  }

  return updatedResultStore;
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
  error?: string
) => {
  const { purpose, replacesResultId, completesResultId } = lifecycleParams;

  // Handle replacement logic
  if (purpose === "replacement" && replacesResultId) {
    if (resultStore[replacesResultId]) {
      resultStore[replacesResultId].status = "superseded";
      console.log(
        `🔄 [ResultLifecycle] ${replacesResultId} marked as superseded by ${resultId}`
      );
    }
  }

  // Handle completion logic - mark both results as final
  if (purpose === "completion" && completesResultId) {
    if (resultStore[completesResultId]) {
      resultStore[completesResultId].purpose = "final";
      console.log(
        `🔄 [ResultLifecycle] ${completesResultId} marked as final (completed by ${resultId})`
      );
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

  console.log(
    `🔄 [ResultLifecycle] Stored ${resultId}: ${
      data.length
    } items, purpose: ${purpose}, status: active${error ? ", with error" : ""}`
  );
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
  .addNode("responseWriter", responseWriter)
  .addNode("directFormat", directFormat)
  .addNode("showResultsThenExpand", showResultsThenExpand)
  .addNode("insertResponse", insertResponse)

  .addEdge(START, "loadModel")
  .addConditionalEdges("loadModel", routeAfterLoadModel)
  .addConditionalEdges("conversationRouter", routeAfterConversationRouter)
  .addConditionalEdges("intentParser", routeAfterIntentParsing)
  .addConditionalEdges("cacheProcessor", routeAfterCache)
  .addConditionalEdges("assistant", shouldContinue)
  .addConditionalEdges("tools", routeAfterTools)
  .addEdge("responseWriter", "insertResponse")
  .addEdge("directFormat", "insertResponse")
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
