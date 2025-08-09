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
import { createChildBlock } from "../../../utils/roamAPI";
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

// Import prompts from separate file
import {
  buildSystemPrompt,
  buildRequestAnalysisPrompt,
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
  routingDecision: Annotation<"use_cache" | "need_new_search">,
  reformulatedQuery: Annotation<string | undefined>,
  originalSearchContext: Annotation<string | undefined>,
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

// Nodes
const requestAnalyzer = async (state: typeof ReactSearchAgentState.State) => {
  console.log(`🧠 [RequestAnalyzer] Analyzing request: "${state.userQuery}"`);
  console.log(
    `🧠 [RequestAnalyzer] Conversation mode: ${
      state.isConversationMode
    }, Cached results: ${Object.keys(state.cachedFullResults || {}).length}`
  );

  // Skip analysis if not in conversation mode or no cached results
  if (
    !state.isConversationMode ||
    !Object.keys(state.cachedFullResults || {}).length
  ) {
    console.log(
      `🧠 [RequestAnalyzer] → Routing to NEW SEARCH (no conversation or cache)`
    );
    return {
      routingDecision: "need_new_search" as const,
      reformulatedQuery: state.userQuery,
      originalSearchContext: undefined,
    };
  }

  updateAgentToaster("🧠 Analyzing your request...");

  const analysisPrompt = buildRequestAnalysisPrompt(state);
  const analysisLlm = modelViaLanggraph(state.model, turnTokensUsage);

  try {
    const response = await analysisLlm.invoke([
      new SystemMessage({ content: analysisPrompt }),
      new HumanMessage({ content: state.userQuery }),
    ]);

    const responseContent = response.content.toString();

    // Use shared JSON parsing with field mappings
    const analysis = parseJSONWithFields<{
      decision: "use_cache" | "need_new_search";
      reformulatedQuery: string;
      originalSearchContext: string | null;
      reasoning: string;
    }>(responseContent, {
      decision: ["decision"],
      reformulatedQuery: ["reformulatedQuery", "reformulated_query", "query"],
      originalSearchContext: [
        "originalSearchContext",
        "original_search_context",
        "context",
      ],
      reasoning: ["reasoning", "reason"],
    });

    if (!analysis) {
      console.warn(
        "Failed to parse analysis response, defaulting to new search"
      );
      return {
        routingDecision: "need_new_search" as const,
        reformulatedQuery: state.userQuery,
        originalSearchContext: undefined,
      };
    }

    console.log(
      `🧠 [RequestAnalyzer] Decision: ${analysis.decision}, Reformulated: "${analysis.reformulatedQuery}"`
    );
    console.log(
      `🧠 [RequestAnalyzer] → Routing to ${
        analysis.decision === "use_cache" ? "CACHE PROCESSOR" : "NEW SEARCH"
      }`
    );

    return {
      routingDecision: analysis.decision as "use_cache" | "need_new_search",
      reformulatedQuery: analysis.reformulatedQuery || state.userQuery,
      originalSearchContext: analysis.originalSearchContext,
    };
  } catch (error) {
    console.error("Request analysis failed:", error);
    // Fallback to new search on error
    return {
      routingDecision: "need_new_search" as const,
      reformulatedQuery: state.userQuery,
      originalSearchContext: undefined,
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

  // Use simplified full system prompt (no streamlined version)
  console.log(`🎯 [Assistant] Using simplified system prompt`);
  const systemPrompt = buildSystemPrompt(state);
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
                // For display, show page_ref as [[text]] (the text should already be clean without # or [])
                return `[[${c.text}]]`;
              }
              if (c.type === "text") return `"${c.text}"`;
              return `"${c.text}"`;
            });
            const combineLogic =
              args.combineConditions === "OR" ? " OR " : " AND ";
            return `searching for ${searchTerms.join(combineLogic)} in blocks`;
          }
          const searchText =
            args.conditions?.find((c: any) => c.type === "text")?.text ||
            args.conditions?.find((c: any) => c.type === "page_ref")
              ?.pageTitle ||
            "content";
          return `searching for "${searchText}" in blocks`;

        case "findPagesByContent":
          if (args.conditions && Array.isArray(args.conditions)) {
            const searchTerms = args.conditions.map((c: any) => {
              if (c.type === "page_ref") {
                // For display, show page_ref as [[text]] (the text should already be clean without # or [])
                return `[[${c.text}]]`;
              }
              if (c.type === "text") return `"${c.text}"`;
              return `"${c.text}"`;
            });
            const combineLogic =
              args.combineConditions === "OR" ? " OR " : " AND ";
            return `searching pages containing ${searchTerms.join(
              combineLogic
            )}`;
          }
          const pageSearchText = args.searchText || args.query || "content";
          return `searching pages containing "${pageSearchText}"`;

        case "findPagesByTitle":
          return `looking for pages titled "${
            args.pageTitle || args.searchText || "pages"
          }"`;

        case "findPagesSemantically":
          return `finding pages related to "${args.query || "concept"}"`;

        case "extractPageReferences":
          const blockCount = Array.isArray(args.blockUids)
            ? args.blockUids.length
            : "some";
          return `analyzing ${blockCount} blocks for page references`;

        case "getPageContent":
          return `retrieving content from "${args.pageTitle || "page"}"`;

        case "getBlockContent":
          return `getting block content and context`;

        default:
          return `using ${toolName.replace(/([A-Z])/g, " $1").toLowerCase()}`;
      }
    });

    const explanation =
      toolExplanations.length === 1
        ? toolExplanations[0]
        : `${toolExplanations.length} searches: ${toolExplanations.join(", ")}`;

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
  
  // Format results directly without LLM
  let formattedResults: string[] = [];
  let totalCount = 0;
  let displayCount = 0;
  let hasPages = false;
  let hasBlocks = false;
  
  for (const [, result] of relevantEntries) {
    const data = result?.data || [];
    if (!Array.isArray(data) || data.length === 0) continue;
    
    totalCount += result?.metadata?.totalFound || data.length;
    displayCount += data.length;
    
    // Distinguish between pages and blocks for proper formatting
    const formattedItems = data.map(item => {
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
    
    formattedResults.push(formattedItems.join("\n"));
  }
  
  // Create final formatted response with appropriate labeling
  let resultType = "results";
  if (hasPages && !hasBlocks) {
    resultType = "pages";
  } else if (hasBlocks && !hasPages) {
    resultType = "blocks";  
  }
  
  const resultText = displayCount === totalCount 
    ? `Found ${totalCount} matching ${resultType}:\n${formattedResults.join("\n")}`
    : `Found ${totalCount} matching ${resultType} [showing first ${displayCount}]:\n${formattedResults.join("\n")}`;
    
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

// Routing logic after loading model - check for optimizations
const routeAfterLoadModel = (state: typeof ReactSearchAgentState.State) => {
  if (state.isDirectChat) {
    console.log(`🔀 [Graph] LoadModel → RESPONSE_WRITER (direct chat mode)`);
    return "responseWriter";
  }
  
  // OPTIMIZATION: Skip RequestAnalyzer for simple direct queries
  // When there's no conversation context and no cached results, go directly to assistant
  const hasConversationContext = state.isConversationMode && (
    state.conversationHistory?.length > 0 || 
    Object.keys(state.cachedFullResults || {}).length > 0
  );
  
  if (!hasConversationContext) {
    console.log(`🔀 [Graph] LoadModel → ASSISTANT (simple query optimization)`);
    return "assistant";
  }
  
  console.log(
    `🔀 [Graph] LoadModel → REQUEST_ANALYZER (complex query with context)`
  );
  return "requestAnalyzer";
};

// Routing logic for request analysis
const routeAfterAnalysis = (state: typeof ReactSearchAgentState.State) => {
  const route =
    state.routingDecision === "use_cache" ? "cacheProcessor" : "assistant";
  console.log(`🔀 [Graph] RequestAnalyzer → ${route.toUpperCase()}`);
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
  .addNode("requestAnalyzer", requestAnalyzer)
  .addNode("cacheProcessor", cacheProcessor)
  .addNode("assistant", assistant)
  .addNode("tools", toolsWithResultLifecycle)
  .addNode("responseWriter", responseWriter)
  .addNode("directFormat", directFormat)
  .addNode("insertResponse", insertResponse)

  .addEdge(START, "loadModel")
  .addConditionalEdges("loadModel", routeAfterLoadModel)
  .addConditionalEdges("requestAnalyzer", routeAfterAnalysis)
  .addConditionalEdges("cacheProcessor", routeAfterCache)
  .addConditionalEdges("assistant", shouldContinue)
  .addConditionalEdges("tools", routeAfterTools)
  .addEdge("responseWriter", "insertResponse")
  .addEdge("directFormat", "insertResponse")
  .addEdge("insertResponse", "__end__");

export const ReactSearchAgent = builder.compile();

// NOTE: Invoke functions are in ask-your-graph-invoke.ts
// This file contains only the core ReAct agent implementation
