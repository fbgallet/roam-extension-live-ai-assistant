import {
  MessagesAnnotation,
  StateGraph,
  START,
  Annotation,
} from "@langchain/langgraph/web";
import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  LlmInfos,
  modelViaLanggraph,
  TokensUsage,
} from "../langraphModelsLoader";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import { createChildBlock, normalizePageTitle } from "../../../utils/roamAPI";
import { insertStructuredAIResponse } from "../../responseInsertion";
import { chatRoles, getInstantAssistantRole, defaultModel } from "../../..";
import { modelAccordingToProvider } from "../../aiAPIsHub";
import {
  updateAgentToaster,
  getAgentToasterStream,
  parseJSONWithFields,
  generateResultId,
  createResultSummary,
  generateSummaryText,
} from "../shared/agentsUtils";

// Import our tools registry
import {
  getAvailableTools,
  listAvailableToolNames,
} from "./tools/toolsRegistry";

// Import search utilities
import {
  deduplicateResultsByUid,
  sanitizePageReferences,
} from "./tools/searchUtils";

// Import prompts from separate file
import {
  buildSystemPrompt,
  buildRequestAnalysisPrompt,
  buildEnhancedAnalyzerPrompt,
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
  sampleItems: string[]; // First 3-5 items for context
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
      }
    >
  >, // Full results with lifecycle management
  nextResultId: Annotation<number>, // Counter for generating unique result IDs
  finalAnswer: Annotation<string | undefined>,
  // Token tracking across entire agent execution
  totalTokensUsed: Annotation<{ input: number; output: number }>,
  // Request analysis and routing
  routingDecision: Annotation<"use_cache" | "need_new_search" | "analyze_complexity">,
  reformulatedQuery: Annotation<string | undefined>,
  originalSearchContext: Annotation<string | undefined>,
  // Enhanced complexity analysis
  queryComplexity: Annotation<"simple" | "logical" | "multi-step">,
  userIntent: Annotation<string | undefined>,
  parsedComponents: Annotation<{
    // For simple queries (backwards compatible)
    searchTerms?: string[];
    logicalOperators?: string[];
    pageReferences?: Array<{ type: string; text: string }>;
    exclusions?: string[];
    
    // For complex logical queries - structured sub-queries
    subQueries?: Array<{
      id: string;
      conditions: Array<{
        type: "text" | "page_ref" | "block_ref" | "regex";
        text: string;
        matchType?: "exact" | "contains" | "regex";
        negate?: boolean;
        semanticExpansion?: boolean;
      }>;
      combineConditions: "AND" | "OR";
      purpose: "intermediate" | "final";
      toolName: "findBlocksByContent" | "findPagesByContent" | "findPagesByTitle";
    }>;
    
    // Operations to combine sub-queries
    combinations?: Array<{
      operation: "union" | "intersection" | "difference";
      inputQueries: string[]; // References to subQuery IDs
      outputId: string;
    }>;
    
    constraints?: {
      limitToPages?: string[];
      dateRange?: {
        start?: Date;
        end?: Date;
        strategy?: "explicit" | "relative" | "vague" | "recent_sort";
        description?: string;
      };
      maxResults?: number;
      userLimit?: number;
      randomSample?: boolean;
      sortBy?: "creation" | "modification" | "alphabetical" | "relevance" | "random";
    };
  }>,
  strategicGuidance: Annotation<{
    approach?: "single_search" | "multiple_searches_with_union" | "multi_step_workflow";
    reasoning?: string;
    recommendedSteps?: string[];
  }>,
  // Timing and cancellation
  startTime: Annotation<number>,
  abortSignal: Annotation<AbortSignal | undefined>,
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

// Removed: ROAM_FORMATTING_INSTRUCTIONS moved to prompts file

// Removed: buildSystemPrompt moved to ask-your-graph-prompts.ts

// Removed: buildFinalResponseSystemPrompt moved to ask-your-graph-prompts.ts

// Removed: extractResultDataForPrompt moved to ask-your-graph-prompts.ts

// Removed: buildRequestAnalysisPrompt moved to ask-your-graph-prompts.ts

// Conversation router node for intelligent routing decisions
const conversationRouter = async (state: typeof ReactSearchAgentState.State) => {
  console.log(`🔀 [ConversationRouter] Analyzing routing for: "${state.userQuery}"`);
  
  const hasCachedResults = Object.keys(state.cachedFullResults || {}).length > 0 || 
                           Object.keys(state.resultSummaries || {}).length > 0;
  const hasConversationHistory = state.conversationHistory?.length > 0;
  
  console.log(
    `🔀 [ConversationRouter] Context - Conversation: ${hasConversationHistory}, Cached: ${hasCachedResults}`
  );

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

  const isSimpleFollowUp = simpleFollowUpPatterns.some(pattern => pattern.test(query));
  const isCacheSuitable = cacheSuitablePatterns.some(pattern => pattern.test(query));
  const needsComplexAnalysis = complexAnalysisPatterns.some(pattern => pattern.test(query));

  // Decision logic
  if (!state.isConversationMode || !hasConversationHistory) {
    // Fresh request without conversation context - always analyze complexity
    console.log(`🔀 [ConversationRouter] → COMPLEXITY_ANALYZER (fresh request)`);
    return {
      routingDecision: "analyze_complexity" as const
    };
  }

  if (isSimpleFollowUp && hasCachedResults) {
    // Simple follow-up with available cache - use existing cache logic
    console.log(`🔀 [ConversationRouter] → CACHE_PROCESSOR (simple follow-up)`);
    return {
      routingDecision: "use_cache" as const,
      reformulatedQuery: state.userQuery,
      originalSearchContext: "previous conversation results"
    };
  }

  if (isCacheSuitable && hasCachedResults && !needsComplexAnalysis) {
    // Cache might be suitable and no complex analysis needed
    console.log(`🔀 [ConversationRouter] → CACHE_PROCESSOR (cache suitable)`);
    return {
      routingDecision: "use_cache" as const,
      reformulatedQuery: state.userQuery,
      originalSearchContext: "related to previous search results"
    };
  }

  if (needsComplexAnalysis) {
    // Complex query that definitely needs full analysis
    console.log(`🔀 [ConversationRouter] → COMPLEXITY_ANALYZER (complex analysis needed)`);
    return {
      routingDecision: "analyze_complexity" as const
    };
  }

  // Default: new search without complex analysis for simple conversational queries
  console.log(`🔀 [ConversationRouter] → ASSISTANT (simple conversational query)`);
  return {
    routingDecision: "need_new_search" as const,
    reformulatedQuery: state.userQuery,
    // Provide minimal guidance for simple queries
    queryComplexity: "simple" as const,
    userIntent: state.userQuery,
    parsedComponents: { searchTerms: state.userQuery.split(/\s+/).filter(term => term.length > 2) },
    strategicGuidance: {
      approach: "single_search" as const,
      reasoning: "Simple conversational request",
      recommendedSteps: ["Execute direct search based on user query"]
    }
  };
};

// Enhanced complexity analyzer node
const complexityAnalyzer = async (state: typeof ReactSearchAgentState.State) => {
  console.log(`🧠 [ComplexityAnalyzer] Analyzing request: "${state.userQuery}"`);
  
  const hasCachedResults = Object.keys(state.cachedFullResults || {}).length > 0 || 
                           Object.keys(state.resultSummaries || {}).length > 0;
  
  console.log(
    `🧠 [ComplexityAnalyzer] Conversation mode: ${state.isConversationMode}, Cached results: ${hasCachedResults}`
  );

  updateAgentToaster("🧠 Analyzing request complexity...");

  const analysisPrompt = buildEnhancedAnalyzerPrompt({
    ...state,
    permissions: state.permissions,
    privateMode: state.privateMode
  });
  const analysisLlm = modelViaLanggraph(state.model, turnTokensUsage);

  try {
    const response = await analysisLlm.invoke([
      new SystemMessage({ content: analysisPrompt }),
      new HumanMessage({ content: state.userQuery }),
    ]);

    const responseContent = response.content.toString();

    // Parse the enhanced analyzer response
    const analysis = parseJSONWithFields<{
      routingDecision: "use_cache" | "need_new_search" | "analyze_complexity";
      reformulatedQuery?: string;
      originalSearchContext?: string;
      complexity?: "simple" | "logical" | "multi-step";
      userIntent?: string;
      userSummary?: string;
      parsedComponents?: {
        searchTerms?: string[];
        logicalOperators?: string[];
        pageReferences?: Array<{ type: string; text: string }>;
        exclusions?: string[];
        constraints?: {
          limitToPages?: string[];
          dateRange?: {
            start?: Date;
            end?: Date;
            strategy?: string;
            description?: string;
          };
          maxResults?: number;
          userLimit?: number;
          randomSample?: boolean;
          sortBy?: string;
        };
      };
      suggestedStrategy?: {
        approach?: "single_search" | "multiple_searches_with_union" | "multi_step_workflow";
        reasoning?: string;
        recommendedSteps?: string[];
      };
    }>(responseContent, {
      routingDecision: ["routingDecision", "decision"],
      reformulatedQuery: ["reformulatedQuery", "reformulated_query", "query"],
      originalSearchContext: ["originalSearchContext", "original_search_context", "context"],
      complexity: ["complexity"],
      userIntent: ["userIntent", "user_intent"],
      userSummary: ["userSummary", "user_summary"],
      parsedComponents: ["parsedComponents", "parsed_components"],
      suggestedStrategy: ["suggestedStrategy", "suggested_strategy"],
    });

    if (!analysis) {
      console.warn("Failed to parse analyzer response, using fallback");
      return {
        routingDecision: "need_new_search" as const,
        reformulatedQuery: state.userQuery,
        queryComplexity: "simple" as const,
        userIntent: state.userQuery,
        parsedComponents: { searchTerms: [state.userQuery] },
        strategicGuidance: {
          approach: "single_search" as const,
          reasoning: "Fallback to simple search due to analysis failure",
          recommendedSteps: ["Search for user query terms"],
          }
      };
    }

    // Handle conversation mode routing
    if (analysis.routingDecision === "use_cache") {
      console.log(`🧠 [ComplexityAnalyzer] → Routing to CACHE PROCESSOR`);
      return {
        routingDecision: "use_cache" as const,
        reformulatedQuery: analysis.reformulatedQuery || state.userQuery,
        originalSearchContext: analysis.originalSearchContext,
      };
    }

    // Handle complexity analysis for new searches
    console.log(
      `🧠 [ComplexityAnalyzer] Complexity: ${analysis.complexity}, Approach: ${analysis.suggestedStrategy?.approach}`
    );
    console.log(
      `🧠 [ComplexityAnalyzer] → Routing to ASSISTANT with strategic guidance`
    );

    // Show user-friendly analysis summary in toaster
    const userSummary = analysis.userSummary || `🔍 ${analysis.complexity || "simple"} search planned`;
    updateAgentToaster(userSummary);

    // Enhanced date parsing for the constraints
    let enhancedParsedComponents = analysis.parsedComponents || { searchTerms: [state.userQuery] };
    
    // FIRST: Sanitize page references to fix LLM parsing errors
    enhancedParsedComponents = sanitizePageReferences(enhancedParsedComponents);
    
    // Apply smart date range parsing if not already provided by LLM
    console.log(`🔍 [DateParsing] Current constraints:`, enhancedParsedComponents.constraints);
    if (!enhancedParsedComponents.constraints?.dateRange) {
      const { limit } = extractUserRequestInfo(state.userQuery);
      const dateParseResult = parseSmartDateRange(state.userQuery, limit || undefined);
      
      console.log(`🔍 [DateParsing] Query: "${state.userQuery}", Limit: ${limit}, ParseResult:`, dateParseResult);
      
      if (dateParseResult) {
        console.log(`🧠 [ComplexityAnalyzer] Detected date constraint: ${dateParseResult.description}`);
        
        if (!enhancedParsedComponents.constraints) {
          enhancedParsedComponents.constraints = {};
        }
        
        if (dateParseResult.strategy === "recent_sort") {
          // Use recency sorting instead of date filtering
          enhancedParsedComponents.constraints.sortBy = "modification";
          console.log(`🧠 [ComplexityAnalyzer] Using recency sort for: ${dateParseResult.description}`);
        } else {
          // Use date range filtering
          enhancedParsedComponents.constraints.dateRange = {
            start: dateParseResult.start,
            end: dateParseResult.end,
            strategy: dateParseResult.strategy,
            description: dateParseResult.description
          };
          console.log(`🧠 [ComplexityAnalyzer] Using date range filter: ${dateParseResult.description}`);
        }
      }
    }

    return {
      routingDecision: "need_new_search" as const,
      reformulatedQuery: analysis.reformulatedQuery || state.userQuery,
      queryComplexity: analysis.complexity || "simple",
      userIntent: analysis.userIntent || state.userQuery,
      parsedComponents: enhancedParsedComponents,
      strategicGuidance: {
        approach: analysis.suggestedStrategy?.approach || "single_search",
        reasoning: analysis.suggestedStrategy?.reasoning || "Direct search approach",
        recommendedSteps: analysis.suggestedStrategy?.recommendedSteps || ["Search for user query"],
      }
    };
  } catch (error) {
    console.error("Complexity analysis failed:", error);
    // Fallback with basic complexity analysis
    return {
      routingDecision: "need_new_search" as const,
      reformulatedQuery: state.userQuery,
      queryComplexity: "simple" as const,
      userIntent: state.userQuery,
      parsedComponents: { searchTerms: [state.userQuery] },
      strategicGuidance: {
        approach: "single_search" as const,
        reasoning: "Fallback due to analysis error",
        recommendedSteps: ["Execute basic search"],
      }
    };
  }
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
    const cacheSystemPrompt = buildCacheSystemPrompt(state, cacheProcessorResponse, securityMode);

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
    console.log(
      `💾 [CacheProcessor] → Routing to NEW SEARCH (Private mode - no cache processing)`
    );
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
        `💾 [CacheProcessor] → Routing to HYBRID APPROACH (cached + new data)`
      );
      console.log(
        `💾 [CacheProcessor] Strategy: ${responseContent.substring(0, 100)}...`
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
          100
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
  };
};

const assistant = async (state: typeof ReactSearchAgentState.State) => {
  // Check for cancellation
  if (state.abortSignal?.aborted) {
    throw new Error("Operation cancelled by user");
  }

  // Tools are already filtered by permissions in loadModel
  // Create state-aware tool wrappers that auto-inject agent state
  const stateAwareTools = state.searchTools.map(tool => {
    if (tool.name === 'findBlocksByContent') {
      return {
        ...tool,
        func: async (llmInput: any) => {
          // Inject agent state into tool parameters
          const enrichedInput = {
            ...llmInput,
            resultMode: state.privateMode ? "uids_only" : "summary",
            secureMode: state.privateMode || false,
            userQuery: state.userQuery || "",
          };
          return tool.func(enrichedInput);
        }
      };
    }
    // Tools with minimal schemas don't need state injection (they handle it internally)
    return tool;
  });
  
  const llm_with_tools = llm.bindTools(stateAwareTools);

  // Use enhanced system prompt with strategic guidance
  console.log(`🎯 [Assistant] Using enhanced system prompt with strategic guidance`);
  const systemPrompt = buildSystemPrompt({
    permissions: state.permissions,
    privateMode: state.privateMode,
    isConversationMode: state.isConversationMode,
    queryComplexity: state.queryComplexity,
    userIntent: state.userIntent,
    parsedComponents: state.parsedComponents,
    strategicGuidance: state.strategicGuidance
  });
  const contextInstructions = `

CRITICAL INSTRUCTION: 
When using findBlocksByContent, always include userQuery parameter set to: "${state.userQuery}" to exclude the user's request block from results.`;

  const combinedSystemPrompt = systemPrompt + contextInstructions;
  const sys_msg = new SystemMessage({ content: combinedSystemPrompt });

  updateAgentToaster("🤖 Understanding your request...");

  // OPTIMIZATION: Replace verbose tool results with concise summaries to reduce token usage  
  const optimizedMessages = state.messages.map(msg => {
    // Check if this is a tool result message with verbose content (check for tool_call_id which indicates ToolMessage)
    if (msg.content && typeof msg.content === 'string' && msg.name && (msg as any).tool_call_id) {
      try {
        const parsed = JSON.parse(msg.content);
        // If it's a successful tool result with data array (verbose)
        if (parsed.success && parsed.data && Array.isArray(parsed.data) && parsed.data.length > 0) {
          // Create a concise summary instead of full results (no specific result ID needed here)
          const summary = {
            success: true,
            summary: `Found ${parsed.metadata?.totalFound || parsed.data.length} results${parsed.metadata?.wasLimited ? ` (showing ${parsed.data.length})` : ''} from ${msg.name}.`,
            count: {
              total: parsed.metadata?.totalFound || parsed.data.length,
              returned: parsed.data.length
            },
            metadata: {
              searchGuidance: parsed.metadata?.searchGuidance
            }
          };
          
          const summaryContent = JSON.stringify(summary);
          console.log(`🎯 [Assistant] Replaced verbose tool result (${msg.content.length} chars) with summary (${summaryContent.length} chars)`);
          
          // Create a new ToolMessage with the summary content
          return new ToolMessage({
            content: summaryContent,
            tool_call_id: (msg as any).tool_call_id,
            name: msg.name
          });
        }
      } catch (e) {
        // If parsing fails, return original message
      }
    }
    return msg;
  });

  const messages = [sys_msg, ...optimizedMessages];
  
  console.log(`🎯 [Assistant] System prompt length: ${combinedSystemPrompt.length} chars`);
  console.log(`🎯 [Assistant] Total messages: ${messages.length}`);
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
            const searchTerms = args.conditions.map((c: any) => {
              if (c.type === "page_ref") {
                return `[[${c.text}]]`;
              }
              return `"${c.text}"`;
            }).slice(0, 3); // Limit to 3 terms for brevity
            
            const combineLogic = args.combineConditions === "OR" ? " OR " : " AND ";
            const termDisplay = searchTerms.join(combineLogic);
            const limitText = args.conditions.length > 3 ? "..." : "";
            const scopeText = args.limitToPages?.length ? ` in [[${args.limitToPages[0]}]]${args.limitToPages.length > 1 ? '...' : ''}` : '';
            
            return `${termDisplay}${limitText}${scopeText}`;
          }
          const searchText = args.conditions?.find((c: any) => c.type === "text")?.text || "content";
          return `"${searchText}" in blocks`;

        case "findPagesByContent":
          if (args.conditions && Array.isArray(args.conditions)) {
            const searchTerms = args.conditions.map((c: any) => {
              if (c.type === "page_ref") return `[[${c.text}]]`;
              return `"${c.text}"`;
            }).slice(0, 3);
            const combineLogic = args.combineConditions === "OR" ? " OR " : " AND ";
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
          const blockCount = Array.isArray(args.blockUids) ? args.blockUids.length : "results";
          return `analyzing ${blockCount} blocks → finding referenced pages`;

        case "combineResults":
          const operation = args.operation || "union";
          const resultCount = Array.isArray(args.resultIds) ? args.resultIds.length : "multiple";
          const opText = operation === "union" ? "combining" : operation === "intersection" ? "finding common" : "processing";
          return `${opText} ${resultCount} search results`;

        case "getNodeDetails":
          const nodeType = args.pageTitle ? "page" : "block";
          const nodeName = args.pageTitle || `block ${args.blockUid || ""}`;
          return `reading ${nodeType} details: ${nodeName}`;

        case "findBlocksWithHierarchy":
          const hierarchyQuery = args.conditions?.find((c: any) => c.type === "text")?.text || "blocks";
          return `"${hierarchyQuery}" with context hierarchy`;

        case "extractHierarchyContent":
          const hierarchyCount = Array.isArray(args.blockUids) ? args.blockUids.length : "results";
          return `extracting hierarchy from ${hierarchyCount} blocks`;

        case "executeDatomicQuery":
          if (args.query) {
            // User-provided query
            const queryPreview = args.query.length > 50 ? args.query.substring(0, 47) + "..." : args.query;
            return `executing custom Datalog: ${queryPreview}`;
          } else if (args.variables) {
            // Parameterized query
            const varCount = Object.keys(args.variables).length;
            const queryHint = args.description || "parameterized query";
            return `executing query with ${varCount} variables: ${queryHint}`;
          } else {
            // Auto-generated query
            const queryHint = args.description || args.criteria || "advanced database search";
            return `generating & executing query: ${queryHint}`;
          }

        default:
          return `${toolName.replace(/([A-Z])/g, " $1").toLowerCase().replace(/^find/, "finding").replace(/^get/, "getting").replace(/^execute/, "executing").replace(/^extract/, "extracting")}`;
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
      const searchCount = toolExplanations.filter(exp => 
        exp.includes('"') || exp.includes('[[') || exp.includes('pages') || exp.includes('blocks')
      ).length;
      const analysisCount = toolExplanations.filter(exp => 
        exp.includes('analyzing') || exp.includes('→') || exp.includes('combining')
      ).length;
      
      if (searchCount > 0 && analysisCount > 0) {
        explanation = `${searchCount} searches + ${analysisCount} analysis steps`;
      } else if (searchCount > 1) {
        explanation = `${searchCount} parallel searches`;
      } else {
        explanation = `${toolExplanations.length} operations: ${toolExplanations.slice(0, 2).join(", ")}...`;
      }
    }

    updateAgentToaster(`🔍 ${explanation} (${llmDuration}s)`);
  } else {
    updateAgentToaster(`✅ Analysis complete (${llmDuration}s)`);
  }

  return {
    messages: [...state.messages, response],
    totalTokensUsed: updatedTotalTokens,
  };
};

const toolsWithResults = async (state: typeof ReactSearchAgentState.State) => {
  // Check for cancellation
  if (state.abortSignal?.aborted) {
    throw new Error("Operation cancelled by user");
  }

  // Don't overwrite the LLM-generated tool explanation from assistant function
  const toolNode = new ToolNode(state.searchTools);

  try {
    const toolStartTime = Date.now();

    // Check for cancellation before tool execution
    if (state.abortSignal?.aborted) {
      throw new Error("Operation cancelled by user");
    }

    // Create abort promise for tool execution
    const abortPromise = new Promise((_, reject) => {
      if (state.abortSignal) {
        const abortHandler = () =>
          reject(new Error("Operation cancelled by user"));
        state.abortSignal.addEventListener("abort", abortHandler, {
          once: true,
        });
      }
    });

    // Race between tool execution and abort signal - with custom state passing
    const result = await Promise.race([
      toolNode.invoke(state, { configurable: { state } }),
      abortPromise,
    ]);

    // Track tool results for potential reuse (following MCP agent pattern)
    const toolMessages = result.messages.filter(
      (msg: any) => msg._getType() === "tool"
    );

    const toolDuration = ((Date.now() - toolStartTime) / 1000).toFixed(1);

    // Count actual results from tool responses, not just tool calls
    let totalResults = 0;
    toolMessages.forEach((msg: any) => {
      try {
        const parsed = JSON.parse(msg.content);

        if (parsed.data && Array.isArray(parsed.data)) {
          totalResults += parsed.data.length;
        } else if (parsed.metadata?.returnedCount) {
          totalResults += parsed.metadata.returnedCount;
        } else if (parsed.success && parsed.data) {
          totalResults += 1; // Single result
        }
      } catch (e) {
        totalResults += 1; // Fallback for non-JSON content
      }
    });

    const resultText = totalResults === 1 ? "result" : "results";
    updateAgentToaster(
      `✅ Found ${totalResults} ${resultText} (${toolDuration}s)`
    );

    // Enhanced result processing with summarization (keeping message chain intact)
    const updatedResults = { ...state.toolResults };
    const updatedCache = { ...state.toolResultsCache };
    const updatedFullResults = { ...state.cachedFullResults };
    const updatedResultSummaries = { ...state.resultSummaries };
    const updatedResultStore = { ...state.resultStore };
    let nextResultId = state.nextResultId || 1;
    let hasLimitedResults = state.hasLimitedResults;

    // Determine security mode for summarization
    const securityMode = state.privateMode
      ? "private"
      : state.permissions?.contentAccess
      ? "full"
      : "balanced";

    // Track token savings
    let totalOriginalSize = 0;
    let totalCompressedSize = 0;
    let optimizedMessages = 0;

    // Process each tool result (keep existing caching, add summarization)
    toolMessages.forEach((msg: any) => {
      if (msg.tool_call_id && msg.content) {
        try {
          const parsed = JSON.parse(msg.content);

          // Store in regular results (backward compatibility)
          updatedResults[msg.tool_call_id] = {
            content: msg.content,
            timestamp: Date.now(),
            tool_name: msg.name,
          };

          // Cache results for comprehensive follow-ups (MCP pattern)
          updatedCache[msg.tool_call_id] = {
            content: msg.content,
            timestamp: Date.now(),
            tool_name: msg.name,
            type: "tool",
          };

          // Cache all results for potential follow-ups (not just limited ones)
          if (
            parsed.data &&
            Array.isArray(parsed.data) &&
            parsed.data.length > 0
          ) {
            const totalFound =
              parsed.metadata?.totalFound || parsed.data.length;
            console.log(
              `💾 [Caching] Storing ${totalFound} results for follow-up (tool: ${msg.name})`
            );
            updatedFullResults[`${msg.name}_${Date.now()}`] = {
              toolName: msg.name,
              fullResults: parsed,
              userQuery: state.userQuery,
              timestamp: Date.now(),
              canExpand: parsed.metadata?.canExpandResults || false,
            };

            // Mark as limited only if explicitly limited
            if (parsed.metadata?.wasLimited) {
              hasLimitedResults = true;
            }

            // NEW: Generate result summary and store full results separately
            const resultId = generateResultId(msg.name, nextResultId++);

            // Create result summary for LLM context
            const summary = createResultSummary(
              msg.name,
              resultId,
              state.userQuery,
              parsed,
              parsed.metadata?.sortedBy
            );

            // Store summary for LLM context
            updatedResultSummaries[resultId] = summary;

            // Store full results for tool access (extract data array from tool result)
            const resultData = parsed.data || parsed.results || parsed;
            updatedResultStore[resultId] = resultData;
            console.log(
              `📊 [Token Optimization] Stored result ${resultId}: ${
                Array.isArray(resultData)
                  ? resultData.length
                  : typeof resultData
              } items`
            );

            // Generate compact summary text for LLM
            const summaryText = generateSummaryText(summary, securityMode);

            console.log(
              `📊 [Token Optimization] Created summary ${resultId}: ${summaryText}`
            );

            // PHASE 3B: Replace message content with summary for token optimization
            const originalSize = msg.content.length;
            msg.content = JSON.stringify({
              success: true,
              summary: summaryText,
              resultId: resultId,
              toolName: msg.name,
              metadata: {
                totalCount: summary.totalCount,
                resultType: summary.resultType,
                availableForTools: true,
                originalSize: originalSize,
                compressedSize: -1, // Will be calculated below
              },
            });

            const compressedSize = msg.content.length;
            const tokenSavings = Math.round(
              (1 - compressedSize / originalSize) * 100
            );

            // Update the compressed size in the content
            const updatedContent = JSON.parse(msg.content);
            updatedContent.metadata.compressedSize = compressedSize;
            msg.content = JSON.stringify(updatedContent);

            // Track cumulative savings
            totalOriginalSize += originalSize;
            totalCompressedSize += compressedSize;
            optimizedMessages++;

            console.log(
              `💰 [Token Savings] ${msg.name}: ${originalSize} → ${compressedSize} bytes (${tokenSavings}% reduction)`
            );
          }
        } catch (e) {
          // Store raw content even if not JSON
          updatedResults[msg.tool_call_id] = {
            content: msg.content,
            timestamp: Date.now(),
            tool_name: msg.name,
          };
        }
      }
    });

    // Display cumulative token savings in toaster
    if (optimizedMessages > 0) {
      const totalSavings = Math.round(
        (1 - totalCompressedSize / totalOriginalSize) * 100
      );
      const savedBytes = totalOriginalSize - totalCompressedSize;
      updateAgentToaster(
        `💰 Token optimization: ${savedBytes} bytes saved (${totalSavings}% reduction)`
      );
    }

    return {
      ...result,
      toolResults: updatedResults,
      toolResultsCache: updatedCache,
      cachedFullResults: updatedFullResults,
      hasLimitedResults,
      // NEW: Token optimization state
      resultSummaries: updatedResultSummaries,
      resultStore: updatedResultStore,
      nextResultId,
      // Pass through total tokens
      totalTokensUsed: state.totalTokensUsed,
    };
  } catch (error) {
    console.error("🔧 Tool execution error:", error);
    updateAgentToaster("❌ Search failed - please try again");
    throw error;
  }
};

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
  
  if (state.isDirectChat && state.conversationHistory && state.conversationHistory.length > 0) {
    // Include recent conversation history as actual messages for better context
    const recentHistory = state.conversationHistory.slice(-6); // Last 3 exchanges (6 messages)
    for (const msg of recentHistory) {
      if (msg.role === 'user') {
        messages.push(new HumanMessage({ content: msg.content }));
      } else if (msg.role === 'assistant') {
        messages.push(new AIMessage({ content: msg.content })); // Use AIMessage for assistant responses
      }
    }
  }
  
  // Add current user message
  const userMessage = new HumanMessage({ content: state.userQuery });
  messages.push(userMessage);

  console.log(`🎯 [ResponseWriter] Total messages: ${messages.length}${state.isDirectChat ? ' (including conversation history)' : ''}`);
  console.log(
    `🎯 [ResponseWriter] System message length: ${sys_msg.content.length}`
  );
  if (state.isDirectChat && state.conversationHistory?.length > 0) {
    console.log(`💬 [DirectChat] Including ${state.conversationHistory.length} previous conversation messages`);
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

  console.log(`🎯 [FinalResponseWriter] Generated response in ${llmDuration}s`);
  console.log(`🎯 [FinalResponseWriter] Response content:`, response.content);
  console.log(
    `🎯 [FinalResponseWriter] Response type:`,
    typeof response.content
  );
  console.log(
    `🎯 [FinalResponseWriter] Response length:`,
    response.content?.length || 0
  );

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
    console.log(`⏱️ Total ReAct search time: ${totalDuration}s`);
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
  };
};

// Extract user-requested limit and sampling preferences from query
const extractUserRequestInfo = (userQuery: string): { limit: number | null; isRandom: boolean } => {
  const query = userQuery.toLowerCase();
  
  // Pattern 1: "N results", "N random results", "N pages", "N blocks"
  const numberResultsMatch = query.match(/(\d+)\s+(random\s+)?(results?|pages?|blocks?)/);
  if (numberResultsMatch) {
    const num = parseInt(numberResultsMatch[1], 10);
    const isRandom = !!numberResultsMatch[2]; // Check if "random" was captured
    if (num > 0 && num <= 500) {
      return { limit: num, isRandom };
    }
  }
  
  // Pattern 2: "first N", "top N", "show me N" - these are NOT random
  const firstNMatch = query.match(/(first|top|show me)\s+(\d+)/);
  if (firstNMatch) {
    const num = parseInt(firstNMatch[2], 10);
    if (num > 0 && num <= 500) {
      return { limit: num, isRandom: false };
    }
  }
  
  // Pattern 3: "limit to N", "max N", "up to N" - these are NOT random
  const limitMatch = query.match(/(limit to|max|up to)\s+(\d+)/);
  if (limitMatch) {
    const num = parseInt(limitMatch[2], 10);
    if (num > 0 && num <= 500) {
      return { limit: num, isRandom: false };
    }
  }
  
  // Pattern 4: "random N", "N random", "some random results"
  const randomOnlyMatch = query.match(/(random\s+(\d+)|(\d+)\s+random|some\s+random|a\s+few\s+random)/);
  if (randomOnlyMatch) {
    const num = randomOnlyMatch[2] || randomOnlyMatch[3];
    return { 
      limit: num ? parseInt(num, 10) : null, 
      isRandom: true 
    };
  }
  
  return { limit: null, isRandom: false };
};

// Legacy function for backwards compatibility
const extractUserRequestedLimit = (userQuery: string): number | null => {
  return extractUserRequestInfo(userQuery).limit;
};

// Enhanced date parsing system for time-based queries
interface DateRangeResult {
  start?: Date;
  end?: Date;
  strategy: "explicit" | "relative" | "vague" | "recent_sort";
  description: string;
}

const parseSmartDateRange = (userQuery: string, requestedLimit?: number): DateRangeResult | null => {
  const query = userQuery.toLowerCase();
  const now = new Date();
  
  // CASE 1: Explicit date intervals
  // "from 2024-01-01 to 2024-12-31", "between January 1 and March 15"
  const explicitDatePatterns = [
    // ISO dates: "from 2024-01-01 to 2024-12-31"
    /from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/,
    // Natural language: "between January 1 and March 15", "from Jan 1 to Mar 15"
    /between\s+((?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}(?:,?\s+\d{4})?)\s+and\s+((?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}(?:,?\s+\d{4})?)/,
    // "from January 1 to March 15"
    /from\s+((?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}(?:,?\s+\d{4})?)\s+to\s+((?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}(?:,?\s+\d{4})?)/
  ];

  for (const pattern of explicitDatePatterns) {
    const match = query.match(pattern);
    if (match) {
      const startStr = match[1];
      const endStr = match[2]; 
      try {
        const startDate = new Date(startStr);
        const endDate = new Date(endStr);
        if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
          return {
            start: startDate,
            end: endDate,
            strategy: "explicit",
            description: `From ${startDate.toDateString()} to ${endDate.toDateString()}`
          };
        }
      } catch (e) {
        console.warn("Failed to parse explicit dates:", startStr, endStr);
      }
    }
  }

  // CASE 2: Relative intervals with calculations
  // "since 1 month", "in the last 2 weeks", "during the past year"
  
  // Helper function to convert word numbers to digits
  const parseNumberWord = (word: string): number | null => {
    const numberWords: { [key: string]: number } = {
      'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
      'a': 1, 'an': 1
    };
    return numberWords[word.toLowerCase()] || null;
  };
  
  const relativePatterns: Array<{ pattern: RegExp; offsetFromNow: boolean; useWordNumbers?: boolean }> = [
    // "since N days/weeks/months/years ago" - with digits
    { pattern: /since\s+(\d+)\s+(days?|weeks?|months?|years?)\s+ago/, offsetFromNow: true },
    { pattern: /since\s+(\d+)\s+(days?|weeks?|months?|years?)/, offsetFromNow: true },
    // "since one week", "since a month" - with words
    { pattern: /since\s+(one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+(days?|weeks?|months?|years?)/, offsetFromNow: true, useWordNumbers: true },
    // "in the last N days/weeks/months/years"  
    { pattern: /in\s+the\s+last\s+(\d+)\s+(days?|weeks?|months?|years?)/, offsetFromNow: true },
    { pattern: /in\s+the\s+last\s+(one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+(days?|weeks?|months?|years?)/, offsetFromNow: true, useWordNumbers: true },
    { pattern: /during\s+the\s+past\s+(\d+)\s+(days?|weeks?|months?|years?)/, offsetFromNow: true },
    { pattern: /over\s+the\s+past\s+(\d+)\s+(days?|weeks?|months?|years?)/, offsetFromNow: true },
    // "last N days/weeks/months/years"
    { pattern: /last\s+(\d+)\s+(days?|weeks?|months?|years?)/, offsetFromNow: true },
    { pattern: /last\s+(one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+(days?|weeks?|months?|years?)/, offsetFromNow: true, useWordNumbers: true }
  ];

  for (const { pattern, offsetFromNow, useWordNumbers } of relativePatterns) {
    const match = query.match(pattern);
    if (match) {
      let amount: number;
      if (useWordNumbers) {
        amount = parseNumberWord(match[1]) || 1;
      } else {
        amount = parseInt(match[1], 10);
      }
      const unit = match[2].replace(/s$/, ''); // Remove plural
      
      console.log(`🔍 [DateParser] Matched: "${match[0]}", amount: ${amount}, unit: ${unit}`);
      
      const startDate = new Date(now);
      switch (unit) {
        case 'day':
          startDate.setDate(now.getDate() - amount);
          break;
        case 'week':
          startDate.setDate(now.getDate() - (amount * 7));
          break;
        case 'month':
          startDate.setMonth(now.getMonth() - amount);
          break;
        case 'year':
          startDate.setFullYear(now.getFullYear() - amount);
          break;
      }
      
      return {
        start: startDate,
        end: now,
        strategy: "relative",
        description: `Since ${amount} ${unit}${amount > 1 ? 's' : ''} ago (${startDate.toDateString()} to ${now.toDateString()})`
      };
    }
  }

  // CASE 3: Calendar-based relative dates (more complex)
  // "last month", "this year", "previous week"
  const calendarPatterns = [
    { pattern: /last\s+month/, calc: () => getLastMonth(now) },
    { pattern: /previous\s+month/, calc: () => getLastMonth(now) },
    { pattern: /this\s+month/, calc: () => getCurrentMonth(now) },
    { pattern: /last\s+week/, calc: () => getLastWeek(now) },
    { pattern: /previous\s+week/, calc: () => getLastWeek(now) },
    { pattern: /this\s+week/, calc: () => getCurrentWeek(now) },
    { pattern: /this\s+year/, calc: () => getCurrentYear(now) },
    { pattern: /last\s+year/, calc: () => getLastYear(now) },
    { pattern: /previous\s+year/, calc: () => getLastYear(now) }
  ];

  for (const { pattern, calc } of calendarPatterns) {
    if (pattern.test(query)) {
      const range = calc();
      return {
        start: range.start,
        end: range.end,
        strategy: "relative",
        description: `${pattern.source.replace(/\\s\+/g, ' ').replace(/[\\]/g, '')} (${range.start.toDateString()} to ${range.end.toDateString()})`
      };
    }
  }

  // CASE 4: Vague terms - decide between date filter or recency sort
  // "recent", "latest", "newest" with or without specific count
  const vaguePatterns = [
    { pattern: /\b(recent|latest|newest|new)\b/, defaultDays: 15 },
    { pattern: /\b(last|previous)\b/, defaultDays: 30 }
  ];

  for (const { pattern, defaultDays } of vaguePatterns) {
    if (pattern.test(query)) {
      // If user specified a number of results, use recency sorting instead of date filter
      if (requestedLimit && requestedLimit > 0) {
        return {
          strategy: "recent_sort",
          description: `Sort by modification date to get ${requestedLimit} most recent results`
        };
      } else {
        // No specific count - use arbitrary time window
        const startDate = new Date(now);
        startDate.setDate(now.getDate() - defaultDays);
        return {
          start: startDate,
          end: now,
          strategy: "vague",
          description: `Recent items from last ${defaultDays} days (${startDate.toDateString()} to ${now.toDateString()})`
        };
      }
    }
  }

  return null; // No date-related terms found
};

// Helper functions for calendar-based date calculations
const getLastMonth = (now: Date) => {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  return { start, end };
};

const getCurrentMonth = (now: Date) => {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
};

const getLastWeek = (now: Date) => {
  const today = new Date(now);
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const startOfThisWeek = new Date(today);
  startOfThisWeek.setDate(today.getDate() - dayOfWeek);
  startOfThisWeek.setHours(0, 0, 0, 0);
  
  const start = new Date(startOfThisWeek);
  start.setDate(startOfThisWeek.getDate() - 7);
  const end = new Date(startOfThisWeek);
  end.setMilliseconds(-1); // End of previous week
  
  return { start, end };
};

const getCurrentWeek = (now: Date) => {
  const today = new Date(now);
  const dayOfWeek = today.getDay();
  const start = new Date(today);
  start.setDate(today.getDate() - dayOfWeek);
  start.setHours(0, 0, 0, 0);
  
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  
  return { start, end };
};

const getCurrentYear = (now: Date) => {
  const start = new Date(now.getFullYear(), 0, 1);
  const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  return { start, end };
};

const getLastYear = (now: Date) => {
  const start = new Date(now.getFullYear() - 1, 0, 1);
  const end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
  return { start, end };
};

// Direct result formatting for simple private mode cases (no LLM needed)
const directFormat = async (state: typeof ReactSearchAgentState.State) => {
  console.log(`🎯 [DirectFormat] Formatting results without LLM for private mode`);
  updateAgentToaster("📝 Formatting results...");
  
  if (!state.resultStore || Object.keys(state.resultStore).length === 0) {
    return {
      ...state,
      finalAnswer: "No results found.",
    };
  }
  
  // Extract user-requested limit and random preference from query
  const { limit: userRequestedLimit, isRandom } = extractUserRequestInfo(state.userQuery || "");
  const displayLimit = userRequestedLimit || 20; // Default to 20 if no specific limit requested
  
  console.log(`🎯 [DirectFormat] User requested limit: ${userRequestedLimit}, isRandom: ${isRandom}, using display limit: ${displayLimit}`);
  
  // Get final/active results from resultStore
  const relevantEntries = Object.entries(state.resultStore).filter(([, result]) => {
    return (
      (result?.purpose === "final" || result?.purpose === "completion") &&
      result?.status === "active"
    );
  });
  
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
  const deduplicatedResults = deduplicateResultsByUid(allResults, "DirectFormat");
  
  // CRITICAL: Use deduplicated count for accurate display
  const totalCount = deduplicatedResults.length;
  
  // Apply random sampling or sequential limit to deduplicated results
  let limitedResults: any[];
  if (isRandom && totalCount > displayLimit) {
    // Apply random sampling using Fisher-Yates shuffle algorithm
    const shuffled = [...deduplicatedResults];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    limitedResults = shuffled.slice(0, displayLimit);
    console.log(`🎯 [DirectFormat] Applied random sampling: ${displayLimit} from ${totalCount} results`);
  } else {
    // Sequential limit (first N results)
    limitedResults = deduplicatedResults.slice(0, displayLimit);
    console.log(`🎯 [DirectFormat] Applied sequential limit: ${displayLimit} from ${totalCount} results`);
  }
  
  const displayCount = limitedResults.length;
  
  // Format the deduplicated and limited results
  const formattedItems = limitedResults.map(item => {
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
  
  const formattedResults = [formattedItems.join("\n")];
  
  // Create final formatted response with appropriate labeling
  let resultType = "results";
  if (hasPages && !hasBlocks) {
    resultType = "pages";
  } else if (hasBlocks && !hasPages) {
    resultType = "blocks";  
  }
  
  let resultText;
  if (displayCount === totalCount) {
    resultText = `Found ${totalCount} matching ${resultType}:\n${formattedResults.join("\n")}`;
  } else {
    const samplingLabel = isRandom ? 
      (userRequestedLimit ? `${displayCount} random` : `${displayCount} random`) :
      (userRequestedLimit ? `first ${displayCount}` : `first ${displayCount}`);
    resultText = `Found ${totalCount} matching ${resultType} [showing ${samplingLabel}]:\n${formattedResults.join("\n")}`;
    
    // Add Full Results note only when there are more results than displayed
    if (totalCount > displayCount) {
      const actionText = isRandom ? 
        "Click the **\"View Full Results\"** button to see all results or get a different random sample." :
        "Click the **\"View Full Results\"** button to see all results with selection options.";
      resultText += `\n\n---\n**Note**: ${actionText}`;
    }
  }
    
  console.log(`🎯 [DirectFormat] Generated direct response: ${resultText.length} chars, hasPages: ${hasPages}, hasBlocks: ${hasBlocks}`);
  
  return {
    ...state,
    finalAnswer: resultText,
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
    return "tools";
  }
  
  // Check if we have sufficient results to proceed with response
  const hasSufficientResults = state.resultStore && 
    Object.keys(state.resultStore).length > 0;
  
  // OPTIMIZATION: For simple private mode cases with results, skip LLM and format directly
  const canSkipResponseWriter = state.privateMode && 
    !state.isConversationMode &&
    hasSufficientResults &&
    !state.userQuery?.includes("analysis") && // Don't skip for analysis requests
    !state.userQuery?.includes("explain") &&
    !state.userQuery?.includes("summary");
  
  if (canSkipResponseWriter) {
    console.log(`🔀 [Graph] Assistant → DIRECT_FORMAT (private mode optimization)`);
    return "directFormat";
  }
  
  // If we have results but can't use direct format, go to response writer
  if (hasSufficientResults) {
    console.log(`🔀 [Graph] Assistant → RESPONSE_WRITER (results available)`);
  } else {
    console.log(`🔀 [Graph] Assistant → RESPONSE_WRITER (no tool calls)`);
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
  console.log(`🔀 [Graph] LoadModel → CONVERSATION_ROUTER (intelligent routing)`);
  return "conversationRouter";
};

// Routing logic after conversation router
const routeAfterConversationRouter = (state: typeof ReactSearchAgentState.State) => {
  if (state.routingDecision === "use_cache") {
    console.log(`🔀 [Graph] ConversationRouter → CACHE_PROCESSOR`);
    return "cacheProcessor";
  }
  if (state.routingDecision === "analyze_complexity") {
    console.log(`🔀 [Graph] ConversationRouter → COMPLEXITY_ANALYZER`);
    return "complexityAnalyzer";
  }
  // Default: need_new_search
  console.log(`🔀 [Graph] ConversationRouter → ASSISTANT`);
  return "assistant";
};

// Routing logic for complexity analysis
const routeAfterComplexityAnalysis = (state: typeof ReactSearchAgentState.State) => {
  const route =
    state.routingDecision === "use_cache" ? "cacheProcessor" : "assistant";
  console.log(`🔀 [Graph] ComplexityAnalyzer → ${route.toUpperCase()}`);
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
  // Create the standard ToolNode for execution
  const toolNode = new ToolNode(searchTools);

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
  // Check if we have sufficient results to skip assistant evaluation
  const hasResults = state.resultStore && Object.keys(state.resultStore).length > 0;
  
  if (hasResults) {
    // Get the most recent result
    const resultEntries = Object.entries(state.resultStore);
    const latestResult = resultEntries[resultEntries.length - 1]?.[1];
    
    // Detect if query requires multi-step analysis beyond simple block retrieval
    const requiresAnalysis = detectAnalyticalQuery(state.userQuery || "");
    
    const canSkipAssistant = 
      // Has sufficient data (>=20 results)
      (latestResult?.data?.length >= 20) &&
      // Tool purpose is final (not intermediate exploration) 
      (latestResult?.purpose === "final") &&
      // Not in conversation mode (no user refinement expected)
      (!state.isConversationMode) &&
      // Private mode (simple formatting)
      (state.privateMode) &&
      // Query doesn't require multi-step analysis
      (!requiresAnalysis);
    
    if (canSkipAssistant) {
      console.log(`🔀 [Graph] TOOLS → DIRECT_FORMAT (sufficient results: ${latestResult.data.length}, purpose: ${latestResult.purpose})`);
      return "directFormat";
    } else if (requiresAnalysis) {
      console.log(`🔀 [Graph] TOOLS → ASSISTANT (query requires analysis: "${state.userQuery}")`);
      return "assistant";
    }
  }
  
  console.log(`🔀 [Graph] TOOLS → ASSISTANT (evaluation needed)`);
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
    /\b(what are the|which are the|quels sont|quelles sont)\b/
  ];
  
  return analyticalPatterns.some(pattern => pattern.test(query));
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
        const toolResult = JSON.parse(message.content);
        if (toolResult.success && toolResult.data) {
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

          // Handle lifecycle management
          handleResultLifecycle(
            updatedResultStore,
            resultId,
            toolResult.data,
            message.name,
            lifecycleParams,
            toolResult.metadata
          );
        }
      } catch (error) {
        console.warn(
          `Failed to process tool result for ${message.name}:`,
          error
        );
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
  metadata?: any
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
  };

  console.log(
    `🔄 [ResultLifecycle] Stored ${resultId}: ${data.length} items, purpose: ${purpose}, status: active`
  );
};

// Build the ReAct Search Agent graph
const builder = new StateGraph(ReactSearchAgentState);
builder
  .addNode("loadModel", loadModel)
  .addNode("conversationRouter", conversationRouter)
  .addNode("complexityAnalyzer", complexityAnalyzer)
  .addNode("cacheProcessor", cacheProcessor)
  .addNode("assistant", assistant)
  .addNode("tools", toolsWithResultLifecycle)
  .addNode("responseWriter", responseWriter)
  .addNode("directFormat", directFormat)
  .addNode("insertResponse", insertResponse)

  .addEdge(START, "loadModel")
  .addConditionalEdges("loadModel", routeAfterLoadModel)
  .addConditionalEdges("conversationRouter", routeAfterConversationRouter)
  .addConditionalEdges("complexityAnalyzer", routeAfterComplexityAnalysis)
  .addConditionalEdges("cacheProcessor", routeAfterCache)
  .addConditionalEdges("assistant", shouldContinue)
  .addConditionalEdges("tools", routeAfterTools)
  .addEdge("responseWriter", "insertResponse")
  .addEdge("directFormat", "insertResponse")
  .addEdge("insertResponse", "__end__");

export const ReactSearchAgent = builder.compile();

// NOTE: Invoke functions are in ask-your-graph-invoke.ts
// This file contains only the core ReAct agent implementation
