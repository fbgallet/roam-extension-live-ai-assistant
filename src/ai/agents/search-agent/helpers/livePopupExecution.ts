/**
 * Live popup execution utilities
 * Handles re-execution of stored queries with real-time popup updates
 */

import { HumanMessage } from "@langchain/core/messages";
import { ReactSearchAgent, getCurrentTokenUsage } from "../ask-your-graph-agent";
import { LlmInfos } from "../../langraphModelsLoader";
import { modelAccordingToProvider } from "../../../aiAPIsHub";
import { defaultModel } from "../../../..";
import { IntentParserResult } from "./queryStorage";
import { deduplicateResultsByUid } from "./searchUtils";
import { 
  initializeAgentToaster,
  updateAgentToaster,
  completeAgentToaster,
  errorAgentToaster,
  formatExecutionTime
} from "../../shared/agentsUtils";
import { TokensUsage } from "../../langraphModelsLoader";

export interface PopupExecutionConfig {
  intentParserResult: IntentParserResult;
  userQuery: string;
  formalQuery?: string;
  onProgress?: (message: string) => void;
  onResults?: (results: any[], isPartial?: boolean) => void;
  onComplete?: (finalResults: any[]) => void;
  onError?: (error: string) => void;
}

/**
 * Execute a stored query with live updates to popup
 */
export const executeQueryWithLiveUpdates = async (config: PopupExecutionConfig): Promise<any[]> => {
  const {
    intentParserResult,
    userQuery,
    formalQuery,
    onProgress,
    onResults,
    onComplete,
    onError
  } = config;

  // Track execution time and tokens
  const startTime = Date.now();
  let turnTokensUsage: TokensUsage = { input_tokens: 0, output_tokens: 0 };
  
  console.log("🐛 [Popup Execution] Starting with query:", userQuery);
  console.log("🐛 [Popup Execution] Intent parser result:", intentParserResult);

  try {
    // Initialize the agent toaster for visual feedback
    const abortController = new AbortController();
    initializeAgentToaster(
      "search", 
      "🔄 Re-executing stored query",
      abortController
    );
    
    onProgress?.("🔧 Initializing search agent...");
    updateAgentToaster("🔧 Initializing search agent...");

    // Initialize the model
    const model = defaultModel;
    const llmInfos: LlmInfos = modelAccordingToProvider(model);

    onProgress?.("🔍 Starting search execution...");
    updateAgentToaster("🔍 Starting search execution...");

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
      turnTokensUsage: turnTokensUsage
    };

    // Execute the agent starting from Assistant node
    onProgress?.("🚀 Executing search...");
    updateAgentToaster("🚀 Executing search...");
    
    console.log("🐛 [Popup Execution] About to invoke agent with state:", {
      userQuery: initialState.userQuery,
      formalQuery: initialState.formalQuery,
      isPopupExecution: initialState.isPopupExecution,
      skipDirectFormat: initialState.skipDirectFormat,
      turnTokensUsageRef: turnTokensUsage
    });
    
    const response = await ReactSearchAgent.invoke(initialState, {
      recursionLimit: 50,
      streamMode: "values"
    });
    
    console.log("🐛 [Popup Execution] Agent response received:", {
      resultStoreKeys: Object.keys(response.resultStore || {}),
      toolResultsKeys: Object.keys(response.toolResults || {}),
      hasResults: !!(response.resultStore || response.toolResults)
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
    const finalResults = deduplicateResultsByUid(allResults, "livePopupExecution");
    
    onProgress?.(`✅ Search completed - found ${finalResults.length} results`);
    updateAgentToaster(`✅ Search completed - found ${finalResults.length} results`);
    onResults?.(finalResults, false); // Final results, not partial
    onComplete?.(finalResults);
    
    // Get the actual token usage from the agent's global state
    const actualTokenUsage = getCurrentTokenUsage();
    
    console.log("🐛 [Popup Execution] Token usage after execution:", actualTokenUsage);
    console.log("🐛 [Popup Execution] Final results count:", finalResults.length);
    
    // Complete the agent toaster with success, including execution time and tokens
    const executionTime = formatExecutionTime(startTime);
    console.log("🐛 [Popup Execution] Calling completeAgentToaster with:", {
      executionTime,
      actualTokenUsage,
      resultsCount: finalResults.length
    });
    
    completeAgentToaster(
      "search",
      executionTime,
      actualTokenUsage,
      finalResults
    );

    return finalResults;

  } catch (error) {
    console.error("Live popup execution error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    onError?.(`❌ Search failed: ${errorMessage}`);
    
    // Show error in toaster
    const errorObj = error instanceof Error ? error : new Error(errorMessage);
    errorAgentToaster(errorObj);
    
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
        'findBlocksByContent': '🔍 Searching blocks',
        'findPagesByContent': '📄 Searching pages', 
        'findPagesByTitle': '🏷️ Finding pages by title',
        'findPagesSemantically': '🧠 Semantic page search',
        'findBlocksWithHierarchy': '🌳 Hierarchical search',
        'extractHierarchyContent': '📊 Extracting content',
        'extractPageReferences': '🔗 Finding references',
        'getNodeDetails': '🔍 Getting node details',
        'executeDatomicQuery': '⚡ Database query',
        'combineResults': '🔄 Combining results'
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
    }
  };
};