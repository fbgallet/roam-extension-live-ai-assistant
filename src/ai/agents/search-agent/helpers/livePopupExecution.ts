/**
 * Live popup execution utilities
 * Handles re-execution of stored queries with real-time popup updates
 */

import { HumanMessage } from "@langchain/core/messages";
import {
  ReactSearchAgent,
  getCurrentTokenUsage,
} from "../ask-your-graph-agent";
import { LlmInfos } from "../../langraphModelsLoader";
import { modelAccordingToProvider } from "../../../aiAPIsHub";
import { defaultModel } from "../../../..";
import { IntentParserResult, StoredQuery, QueryStep } from "../../../../components/full-results-popup/utils/queryStorage.js";
import { deduplicateResultsByUid } from "./searchUtils";
import {
  initializeAgentToaster,
  updateAgentToaster,
  completeAgentToaster,
  errorAgentToaster,
  formatExecutionTime,
} from "../../shared/agentsUtils";
import { TokensUsage } from "../../langraphModelsLoader";

export interface PopupExecutionConfig {
  intentParserResult: IntentParserResult;
  userQuery: string;
  formalQuery?: string;
  onProgress?: (message: string) => void;
  onResults?: (results: any[], isPartial?: boolean) => void;
  onComplete?: (finalResults: any[], executionTime?: string, tokens?: TokensUsage) => void;
  onError?: (error: string) => void;
  suppressToaster?: boolean; // Don't show toaster for composed query sub-executions
}

export interface ExecutionResult {
  results: any[];
  executionTime: string;
  tokens: TokensUsage;
}

/**
 * Execute a stored query with live updates to popup
 */
export const executeQueryWithLiveUpdates = async (
  config: PopupExecutionConfig
): Promise<any[]> => {
  const {
    intentParserResult,
    userQuery,
    formalQuery,
    onProgress,
    onResults,
    onComplete,
    onError,
    suppressToaster = false,
  } = config;

  // Track execution time and tokens
  const startTime = Date.now();
  let turnTokensUsage: TokensUsage = { input_tokens: 0, output_tokens: 0 };

  console.log("🐛 [Popup Execution] Starting with query:", userQuery);

  try {
    // Initialize the agent toaster for visual feedback (unless suppressed for composed queries)
    const abortController = new AbortController();
    if (!suppressToaster) {
      initializeAgentToaster(
        "search",
        "🔄 Re-executing stored query",
        abortController
      );
    }

    // Initialize the model (use preferred model if provided, otherwise default)
    const model = intentParserResult?.preferredModel || defaultModel;
    const llmInfos: LlmInfos = modelAccordingToProvider(model);

    const modelDisplayName = llmInfos.id || llmInfos.name || "Unknown model";
    onProgress?.(`🤖 Using ${modelDisplayName}`);
    if (!suppressToaster) {
      updateAgentToaster(`🤖 Using ${modelDisplayName}`);
    }

    onProgress?.("🔍 Starting search execution...");
    if (!suppressToaster) {
      updateAgentToaster("🔍 Starting search execution...");
    }

    // Prepare initial state skipping IntentParser
    const initialState = {
      model: llmInfos,
      rootUid: "temp", // Will be ignored in popup mode
      userQuery: userQuery,
      formalQuery: formalQuery || intentParserResult.formalQuery,
      messages: [new HumanMessage(userQuery)],

      // Copy IntentParser results directly
      searchStrategy: intentParserResult.searchStrategy,
      analysisType: intentParserResult.analysisType,
      language: intentParserResult.language,
      confidence: intentParserResult.confidence,
      datomicQuery: intentParserResult.datomicQuery,
      needsPostProcessing: intentParserResult.needsPostProcessing,
      postProcessingType: intentParserResult.postProcessingType,
      isExpansionGlobal: intentParserResult.isExpansionGlobal,
      semanticExpansion: intentParserResult.semanticExpansion,
      customSemanticExpansion: intentParserResult.customSemanticExpansion,
      searchDetails: intentParserResult.searchDetails,

      // Popup execution flags
      isPopupExecution: true,
      skipDirectFormat: true,

      // Empty initial states
      conversationHistory: [],
      isConversationMode: false,
      isDirectChat: false,
      permissions: { contentAccess: true }, // Allow content access for better results
      privateMode: false,
      toolResults: {},
      toolResultsCache: {},
      cachedFullResults: {},
      hasLimitedResults: false,
      resultSummaries: {},
      resultStore: {},
      nextResultId: 1,
      searchTools: [], // Will be populated by loadModel

      // Progress tracking
      popupProgressCallback: onProgress,
      popupResultsCallback: onResults,

      // Token tracking - pass reference to be updated by the agent
      turnTokensUsage: turnTokensUsage,
    };

    // Execute the agent starting from Assistant node
    onProgress?.("🚀 Executing search...");
    if (!suppressToaster) {
      updateAgentToaster("🚀 Executing search...");
    }

    const response = await ReactSearchAgent.invoke(initialState, {
      recursionLimit: 50,
      streamMode: "values",
    });

    // Extract results from final response
    let allResults: any[] = [];

    if (response.resultStore) {
      Object.values(response.resultStore).forEach((store: any) => {
        if (store.data && Array.isArray(store.data)) {
          allResults.push(...store.data);
        }
      });
    }

    // Legacy fallback - check other possible result locations
    if (allResults.length === 0 && response.toolResults) {
      Object.values(response.toolResults).forEach((result: any) => {
        if (result && result.data && Array.isArray(result.data)) {
          allResults.push(...result.data);
        }
      });
    }

    // Deduplicate results
    const finalResults = deduplicateResultsByUid(
      allResults,
      "livePopupExecution"
    );

    onProgress?.(`✅ Search completed - found ${finalResults.length} results`);
    if (!suppressToaster) {
      updateAgentToaster(
        `✅ Search completed - found ${finalResults.length} results`
      );
    }
    onResults?.(finalResults, false); // Final results, not partial
    onComplete?.(finalResults);

    // Get the actual token usage from the agent's global state
    const actualTokenUsage = getCurrentTokenUsage();

    console.log(
      "🐛 [Popup Execution] Token usage after execution:",
      actualTokenUsage
    );
    console.log(
      "🐛 [Popup Execution] Final results count:",
      finalResults.length
    );

    // Complete the agent toaster with success, including execution time and tokens
    const executionTimeSeconds = formatExecutionTime(startTime);
    const executionTimeFormatted = `${executionTimeSeconds.toFixed(1)}s`;

    if (!suppressToaster) {
      completeAgentToaster(
        "search",
        executionTimeSeconds,
        actualTokenUsage,
        finalResults,
        undefined, // targetUid
        undefined, // userQuery
        undefined, // formalQuery
        undefined, // intentParserResult
        false // not conversation mode for popup execution
      );
    }

    // Call onComplete with execution stats
    onComplete?.(finalResults, executionTimeFormatted, actualTokenUsage);

    return finalResults;
  } catch (error) {
    console.error("Live popup execution error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    onError?.(`❌ Search failed: ${errorMessage}`);

    // Show error in toaster (unless suppressed)
    if (!suppressToaster) {
      const errorObj = error instanceof Error ? error : new Error(errorMessage);
      errorAgentToaster(errorObj);
    }

    throw error;
  }
};

/**
 * Create a progress tracking wrapper for agent execution
 */
export const createProgressTracker = (
  onProgress?: (message: string) => void,
  onResults?: (results: any[], isPartial?: boolean) => void
) => {
  let lastResultCount = 0;

  return {
    trackToolExecution: (toolName: string, results?: any[]) => {
      const toolDisplayNames: { [key: string]: string } = {
        findBlocksByContent: "🔍 Searching blocks",
        findPagesByContent: "📄 Searching pages",
        findPagesByTitle: "🏷️ Finding pages by title",
        findPagesSemantically: "🧠 Semantic page search",
        findBlocksWithHierarchy: "🌳 Hierarchical search",
        extractHierarchyContent: "📊 Extracting content",
        extractPageReferences: "🔗 Finding references",
        getNodeDetails: "🔍 Getting node details",
        executeDatomicQuery: "⚡ Database query",
        combineResults: "🔄 Combining results",
      };

      const displayName = toolDisplayNames[toolName] || `🔧 ${toolName}`;
      onProgress?.(displayName);

      if (results && results.length > 0) {
        const newCount = results.length;
        if (newCount > lastResultCount) {
          onResults?.(results, true); // Partial results
          lastResultCount = newCount;
        }
      }
    },
  };
};

/**
 * Check if intentParser result contains date ranges that should be re-evaluated
 * Date ranges are often relative (e.g., "last 7 days") and need fresh interpretation
 */
const hasDateRange = (intentParserResult: any): boolean => {
  if (!intentParserResult) return false;

  // Check for timeRange in searchDetails
  if (intentParserResult.searchDetails?.timeRange) {
    console.log("📅 [hasDateRange] Found timeRange in searchDetails, will re-parse query");
    return true;
  }

  return false;
};

/**
 * Execute a composed query by running ALL queries in PARALLEL
 * Returns the union of all results (deduplicated)
 * Much faster and avoids React state synchronization issues
 */
export const executeComposedQueryParallel = async (
  query: StoredQuery,
  config: {
    onProgress?: (queryId: string, message: string) => void;
    onQueryComplete?: (queryId: string, results: any[], resultCount: number) => void;
    onAllComplete?: (finalResults: any[], querySummary: Array<{id: string, query: string, count: number}>, executionTime?: string, totalTokens?: TokensUsage) => void;
    onError?: (error: string) => void;
  }
): Promise<any[]> => {
  const { onProgress, onQueryComplete, onAllComplete, onError } = config;

  // Track overall execution time
  const startTime = Date.now();
  let totalTokens: TokensUsage = { input_tokens: 0, output_tokens: 0 };

  try {
    // Prepare all queries to execute
    const queriesToExecute: Array<{
      id: string;
      userQuery: string;
      formalQuery: string;
      intentParserResult?: any;
      needsFullParsing: boolean;
    }> = [];

    // Base query
    const baseNeedsFullParsing = !query.intentParserResult || hasDateRange(query.intentParserResult);
    queriesToExecute.push({
      id: 'base',
      userQuery: query.userQuery,
      formalQuery: query.formalQuery,
      intentParserResult: query.intentParserResult,
      needsFullParsing: baseNeedsFullParsing
    });

    // Additional query steps
    query.querySteps.forEach((step, i) => {
      const stepNeedsFullParsing = !step.intentParserResult || hasDateRange(step.intentParserResult);
      queriesToExecute.push({
        id: `step${i + 1}`,
        userQuery: step.userQuery,
        formalQuery: step.formalQuery,
        intentParserResult: step.intentParserResult,
        needsFullParsing: stepNeedsFullParsing
      });
    });

    console.log(`🚀 [executeComposedQueryParallel] Executing ${queriesToExecute.length} queries in parallel:`,
      queriesToExecute.map(q => ({ id: q.id, query: q.userQuery, needsFullParsing: q.needsFullParsing }))
    );

    // Execute all queries in parallel
    const resultSets = await Promise.all(
      queriesToExecute.map(async (queryInfo) => {
        onProgress?.(queryInfo.id, `🔍 Running: ${queryInfo.userQuery}`);

        let results: any[];

        if (queryInfo.needsFullParsing) {
          // Execute through full agent (includes IntentParser)
          console.log(`🔧 [${queryInfo.id}] Executing with full agent processing (IntentParser included)`);

          // Use a unique global variable for this query to avoid race conditions
          const resultKey = `__composedQueryResults_${queryInfo.id}_${Date.now()}`;

          const { invokeSearchAgentSecure } = await import("../ask-your-graph-invoke");

          const response = await invokeSearchAgentSecure({
            model: defaultModel,
            rootUid: `composed-${queryInfo.id}`,
            targetUid: `composed-${queryInfo.id}`,
            target: "replace",
            prompt: queryInfo.userQuery,
            permissions: { contentAccess: false },
            privateMode: true,
            previousAgentState: {
              forcePopupOnly: true, // Results only in popup, no toasters
            },
          });

          // Get results directly from response (should contain fullResults when forcePopupOnly is true)
          results = (response as any)?.fullResults || [];
          console.log(`📦 [${queryInfo.id}] Got ${results.length} results from response`);
        } else {
          // Skip IntentParser, execute directly with saved intentParser result
          console.log(`⚡ [${queryInfo.id}] Executing with cached intentParser (skipping IntentParser node)`);
          results = await executeQueryWithLiveUpdates({
            intentParserResult: queryInfo.intentParserResult!,
            userQuery: queryInfo.userQuery,
            formalQuery: queryInfo.formalQuery,
            onProgress: (msg) => onProgress?.(queryInfo.id, msg),
            suppressToaster: true, // Don't show toaster for composed query sub-executions
          });
        }

        onProgress?.(queryInfo.id, `✅ Completed - ${results.length} results`);
        onQueryComplete?.(queryInfo.id, results, results.length);

        return { id: queryInfo.id, query: queryInfo.userQuery, results };
      })
    );

    // Combine all results and deduplicate
    const allResults: any[] = [];
    const querySummary: Array<{id: string, query: string, count: number}> = [];

    resultSets.forEach(({ id, query: queryText, results }) => {
      allResults.push(...results);
      querySummary.push({ id, query: queryText, count: results.length });
    });

    const deduplicatedResults = deduplicateResultsByUid(allResults);

    // Calculate execution time and get token usage
    const executionTimeSeconds = formatExecutionTime(startTime);
    const executionTimeFormatted = `${executionTimeSeconds.toFixed(1)}s`;
    const actualTokenUsage = getCurrentTokenUsage(); // Get accumulated tokens from all queries

    console.log(`✅ [executeComposedQueryParallel] All queries completed:`, querySummary);
    console.log(`📊 [executeComposedQueryParallel] Total: ${allResults.length} results → ${deduplicatedResults.length} after deduplication`);
    console.log(`⏱️ [executeComposedQueryParallel] Execution time: ${executionTimeFormatted}, Tokens:`, actualTokenUsage);

    onAllComplete?.(deduplicatedResults, querySummary, executionTimeFormatted, actualTokenUsage);

    return deduplicatedResults;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    onError?.(`Composed query failed: ${errorMessage}`);
    throw error;
  }
};

/**
 * Execute a composed query by running each step sequentially
 * Returns the union of all results (deduplicated)
 * @deprecated Use executeComposedQueryParallel instead for better performance
 */
export const executeComposedQuery = async (
  query: StoredQuery,
  config: {
    onProgress?: (message: string) => void;
    onResults?: (results: any[], isPartial?: boolean) => void;
    onComplete?: (finalResults: any[]) => void;
    onError?: (error: string) => void;
  }
): Promise<any[]> => {
  const { onProgress, onResults, onComplete, onError } = config;

  try {
    let allResults: any[] = [];

    console.log("🔧 [executeComposedQuery] Starting composed query execution:", {
      baseQuery: query.userQuery,
      stepsCount: query.querySteps.length,
      steps: query.querySteps.map(s => ({
        userQuery: s.userQuery,
        hasIntentParserResult: !!s.intentParserResult
      }))
    });

    const totalSteps = 1 + query.querySteps.length;

    // Step 1: Execute base query
    onProgress?.(`🔍 [1/${totalSteps}] Executing base query: ${query.userQuery}`);

    let baseResults: any[];
    if (!query.intentParserResult) {
      // Base query doesn't have intentParserResult - need to execute through full agent
      console.warn("⚠️ [executeComposedQuery] Base query missing intentParserResult, executing through full agent");
      const { invokeSearchAgentSecure } = await import("../ask-your-graph-invoke");

      await invokeSearchAgentSecure({
        model: defaultModel,
        rootUid: "composed-query-base",
        targetUid: "composed-query-base",
        target: "replace",
        prompt: query.userQuery,
        permissions: { contentAccess: false },
        privateMode: true,
        previousAgentState: {
          forcePopupOnly: true,
        },
      });

      baseResults = (window as any).lastAskYourGraphResults || [];
      onProgress?.(`[Base] Completed - ${baseResults.length} results`);
    } else {
      baseResults = await executeQueryWithLiveUpdates({
        intentParserResult: query.intentParserResult,
        userQuery: query.userQuery,
        formalQuery: query.formalQuery,
        onProgress: (msg) => onProgress?.(`[Base] ${msg}`),
        onResults: (results, isPartial) => {
          allResults = deduplicateResultsByUid([...results]);
          onResults?.(allResults, isPartial);
        },
      });
    }

    allResults = deduplicateResultsByUid([...baseResults]);

    // Step 2: Execute each additional query step
    for (let i = 0; i < query.querySteps.length; i++) {
      const step = query.querySteps[i];
      const currentStep = i + 2; // +2 because base query is step 1
      onProgress?.(`🔍 [${currentStep}/${totalSteps}] Executing: ${step.userQuery}`);

      let stepResults: any[];
      if (!step.intentParserResult) {
        // Step doesn't have intentParserResult - execute through full agent
        console.warn(`⚠️ [executeComposedQuery] Step ${i + 1} missing intentParserResult, executing through full agent`);
        const { invokeSearchAgentSecure } = await import("../ask-your-graph-invoke");

        await invokeSearchAgentSecure({
          model: defaultModel,
          rootUid: `composed-query-step-${i}`,
          targetUid: `composed-query-step-${i}`,
          target: "replace",
          prompt: step.userQuery,
          permissions: { contentAccess: false },
          privateMode: true,
          previousAgentState: {
            forcePopupOnly: true,
          },
        });

        stepResults = (window as any).lastAskYourGraphResults || [];
        onProgress?.(`[Step ${i + 1}] Completed - ${stepResults.length} results`);
      } else {
        stepResults = await executeQueryWithLiveUpdates({
          intentParserResult: step.intentParserResult,
          userQuery: step.userQuery,
          formalQuery: step.formalQuery,
          onProgress: (msg) => onProgress?.(`[Step ${i + 1}] ${msg}`),
          onResults: (results, isPartial) => {
            // Merge with existing results (union)
            allResults = deduplicateResultsByUid([...allResults, ...results]);
            onResults?.(allResults, isPartial);
          },
        });
      }

      // Merge results (union - all unique results from all queries)
      const previousCount = allResults.length;
      allResults = deduplicateResultsByUid([...allResults, ...stepResults]);
      console.log(`🔗 [executeComposedQuery] After step ${i + 1}: ${previousCount} + ${stepResults.length} = ${allResults.length} total results`);
      onResults?.(allResults, true);
    }

    // Final results
    console.log(`✅ [executeComposedQuery] Completed with ${allResults.length} total results`);
    onProgress?.(`✅ Composed query completed - ${allResults.length} total results`);
    onComplete?.(allResults);
    return allResults;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    onError?.(`Composed query failed: ${errorMessage}`);
    throw error;
  }
};
