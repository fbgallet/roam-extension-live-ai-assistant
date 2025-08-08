import { defaultModel } from "../../..";
import {
  LlmInfos,
  TokensUsage,
} from "../langraphModelsLoader";
import { modelAccordingToProvider } from "../../aiAPIsHub";
import {
  displaySpinner,
  removeSpinner,
  insertInstantButtons,
} from "../../../utils/domElts";
import { ReactSearchAgent } from "./ask-your-graph-agent";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  initializeAgentToaster,
  updateAgentToaster,
  completeAgentToaster,
  errorAgentToaster,
  buildAgentConversationState,
  formatExecutionTime,
  handleRetryLogic,
  validatePermissions,
} from "../shared/agentsUtils";
import {
  clearAgentController,
  markAgentAsStopped
} from "../../../components/Toaster.js";

let turnTokensUsage: TokensUsage = { input_tokens: 0, output_tokens: 0 };

interface SearchAgentInvoker {
  model: string;
  rootUid: string;
  targetUid?: string;
  target?: string;
  prompt: string;
  // Search permissions
  permissions?: { contentAccess: boolean };
  privateMode?: boolean; // Strict Private mode - only UIDs, no content processing
  // Conversation state for continuing conversations
  agentData?: {
    toolResultsCache?: Record<string, any>;
    cachedFullResults?: Record<string, any>;
    hasLimitedResults?: boolean;
    conversationHistory?: any[];
    conversationSummary?: string;
    exchangesSinceLastSummary?: number;
    previousResponse?: string;
    isConversationMode?: boolean;
    // NEW: Support for external result summaries and store
    resultSummaries?: Record<string, any>;
    resultStore?: Record<string, any>;
    nextResultId?: number;
  };
  // NEW: External context from chat or other components
  externalContext?: {
    results?: any[]; // Results from FullResultsPopup or other sources
    contextType?: "search_results" | "chat_context" | "custom";
    description?: string; // Description of what these results represent
  };
  // NEW: Direct chat mode to bypass RequestAnalyzer
  isDirectChat?: boolean;
  // Retry options
  options?: {
    retryInstruction?: string;
    isRetry?: boolean;
    isToRedoBetter?: boolean;
  };
}

// Internal invoke function for search agent (new interface)
const invokeSearchAgentInternal = async ({
  model = defaultModel,
  rootUid,
  targetUid,
  target,
  prompt,
  permissions = { contentAccess: false }, // Default to secure mode
  privateMode = false, // Default to non-private mode
  agentData,
  externalContext,
  isDirectChat = false,
  options,
}: SearchAgentInvoker) => {
  const startTime = Date.now();
  
  // Create abort controller for cancellation
  const abortController = new AbortController();
  
  // Essential debug for conversation mode and caching
  if (agentData?.isConversationMode) {
    console.log("🔄 Conversation mode - cached data:", {
      cachedResultsCount: Object.keys(agentData.cachedFullResults || {}).length,
      hasLimitedResults: agentData.hasLimitedResults,
      historyLength: agentData.conversationHistory?.length || 0
    });
  }

  let llmInfos: LlmInfos = modelAccordingToProvider(model);
  const spinnerId = displaySpinner(rootUid);

  // Initialize toaster for progress tracking with stop functionality
  const getModeInfo = (privateMode: boolean, permissions: any) => {
    if (privateMode) return { name: "Private", icon: "🔒" };
    if (permissions.contentAccess) return { name: "Full Access", icon: "🔓" };
    return { name: "Balanced", icon: "🛡️" };
  };
  
  const modeInfo = getModeInfo(privateMode, permissions);
  initializeAgentToaster("search", `${modeInfo.icon} ${modeInfo.name} mode`, abortController);

  try {
    // Handle conversation state and retry logic using shared utilities
    const isConversationMode = agentData?.isConversationMode || false;
    
    // Process prompt with retry instructions using shared utility
    const finalPrompt = handleRetryLogic(prompt, options);

    const conversationData = agentData || {
      toolResultsCache: {},
      cachedFullResults: {},
      hasLimitedResults: false,
      conversationHistory: [],
      conversationSummary: undefined,
      exchangesSinceLastSummary: 0,
      previousResponse: undefined,
      isConversationMode: false,
    };

    // NEW: Process external context and integrate into agent's result management
    if (externalContext?.results && externalContext.results.length > 0) {
      console.log(`📥 Integrating external context: ${externalContext.results.length} results from ${externalContext.contextType || 'unknown source'}`);
      
      // Create a result entry for external context
      const externalResultId = "external_context_001";
      const externalCacheEntry = {
        toolName: "externalContext",
        fullResults: {
          data: externalContext.results,
          metadata: {
            totalFound: externalContext.results.length,
            contextType: externalContext.contextType || "custom",
            description: externalContext.description || "External context results"
          }
        },
        userQuery: `External context: ${externalContext.description || 'Chat results'}`,
        timestamp: Date.now(),
        canExpand: false
      };
      
      // Add to cached results for conversation context
      if (!conversationData.cachedFullResults) {
        conversationData.cachedFullResults = {};
      }
      conversationData.cachedFullResults[externalResultId] = externalCacheEntry;
      
      // Add to result store if supported
      if (conversationData.resultStore) {
        conversationData.resultStore[externalResultId] = {
          data: externalContext.results,
          purpose: "final" as const,
          status: "active" as const,
          toolName: "externalContext",
          timestamp: Date.now()
        };
      }
      
      console.log(`📥 External context integrated as ${externalResultId}: ${externalContext.results.length} results`);
    }

    console.log(`🚀 Starting ReAct Search Agent: "${finalPrompt}"`);
    console.log(`🔍 Conversation parameters:`, {
      conversationHistory: conversationData.conversationHistory,
      conversationHistoryLength: conversationData.conversationHistory?.length || 0,
      conversationSummary: conversationData.conversationSummary,
      hasLimitedResults: conversationData.hasLimitedResults,
      isConversationMode: isConversationMode,
      cachedResultsCount: Object.keys(conversationData.cachedFullResults || {}).length,
      toolResultsCacheCount: Object.keys(conversationData.toolResultsCache || {}).length,
      externalContextResults: externalContext?.results?.length || 0,
    });

    // Additional debugging for conversation history content
    if (conversationData.conversationHistory && conversationData.conversationHistory.length > 0) {
      console.log(
        `🔍 Conversation history content:`,
        conversationData.conversationHistory.slice(-2)
      );
    }

    const response = await ReactSearchAgent.invoke({
      model: llmInfos,
      rootUid,
      userQuery: finalPrompt,
      messages: [new HumanMessage(finalPrompt)],
      conversationHistory: conversationData.conversationHistory || [],
      conversationSummary: conversationData.conversationSummary,
      isConversationMode,
      isDirectChat,
      permissions,
      privateMode,
      // Initialize caching (MCP pattern)
      toolResultsCache: conversationData.toolResultsCache || {},
      cachedFullResults: conversationData.cachedFullResults || {},
      hasLimitedResults: conversationData.hasLimitedResults || false,
      // NEW: Enhanced result management state
      resultSummaries: conversationData.resultSummaries || {},
      resultStore: conversationData.resultStore || {},
      nextResultId: conversationData.nextResultId || 1,
      startTime: Date.now(),
      // Pass abort signal for cancellation
      abortSignal: abortController.signal,
    });

    // Extract full results for the popup functionality
    const fullResults = [];
    console.log("🔍 [ask-your-graph-invoke] response.cachedFullResults:", response.cachedFullResults);
    console.log("🔍 [ask-your-graph-invoke] response.resultStore:", response.resultStore);
    
    // NEW: Check the token-optimized resultStore first (preferred)
    if (response.resultStore) {
      Object.values(response.resultStore).forEach((resultEntry: any) => {
        console.log("🔍 [ask-your-graph-invoke] Processing resultStore entry:", resultEntry);
        
        // Handle new lifecycle structure: {data: Array, purpose: string, status: string, ...}
        if (resultEntry && resultEntry.data && Array.isArray(resultEntry.data)) {
          const validResults = resultEntry.data.filter(r => r && (r.uid || r.pageUid || r.pageTitle));
          console.log("🔍 [ask-your-graph-invoke] Valid results from new structure:", validResults.length);
          fullResults.push(...validResults);
        }
        // Handle legacy structure: direct array
        else if (Array.isArray(resultEntry)) {
          const validResults = resultEntry.filter(r => r && (r.uid || r.pageUid || r.pageTitle));
          console.log("🔍 [ask-your-graph-invoke] Valid results from legacy structure:", validResults.length);
          fullResults.push(...validResults);
        }
      });
    }
    
    // FALLBACK: Check legacy cachedFullResults for backward compatibility
    if (response.cachedFullResults && fullResults.length === 0) {
      Object.values(response.cachedFullResults).forEach((toolResults: any) => {
        console.log("🔍 [ask-your-graph-invoke] Processing legacy cachedFullResults:", toolResults);
        if (Array.isArray(toolResults)) {
          const validResults = toolResults.filter(r => r && (r.uid || r.pageUid || r.pageTitle));
          console.log("🔍 [ask-your-graph-invoke] Valid results with UIDs:", validResults.length);
          fullResults.push(...validResults);
        } else if (toolResults && toolResults.fullResults && Array.isArray(toolResults.fullResults.data)) {
          // Handle the case where results are nested under fullResults.data
          const validResults = toolResults.fullResults.data.filter(r => r && (r.uid || r.pageUid || r.pageTitle));
          console.log("🔍 [ask-your-graph-invoke] Valid nested results with UIDs:", validResults.length);
          fullResults.push(...validResults);
        }
      });
    }
    
    console.log("🔍 [ask-your-graph-invoke] Final fullResults count:", fullResults.length);

    // Calculate execution time and complete toaster with full results
    const executionTime = formatExecutionTime(startTime);
    completeAgentToaster("search", executionTime, turnTokensUsage, fullResults, response?.targetUid);

    // Insert conversation buttons for continued interaction
    if (response && response.targetUid) {
      const conversationState = await buildAgentConversationState(
        conversationData.conversationHistory || [],
        conversationData.conversationSummary,
        finalPrompt,
        response.finalAnswer || "",
        llmInfos,
        turnTokensUsage,
        conversationData.exchangesSinceLastSummary || 0,
        "search"
      );

      setTimeout(() => {
        insertInstantButtons({
          model: llmInfos.id,
          prompt: [
            { role: "user", content: finalPrompt },
            {
              role: "assistant",
              content: response.finalAnswer || "",
            },
          ],
          currentUid: rootUid,
          targetUid: response.targetUid,
          responseFormat: "text",
          response: response.finalAnswer || "",
          agentData: {
            toolResultsCache: response.toolResultsCache || {},
            cachedFullResults: response.cachedFullResults || {},
            hasLimitedResults: response.hasLimitedResults || false,
            conversationHistory: conversationState.conversationHistory,
            conversationSummary: conversationState.conversationSummary,
            exchangesSinceLastSummary:
              conversationState.exchangesSinceLastSummary || 0,
            previousResponse: response.finalAnswer || "",
            isConversationMode: true,
          },
          aiCallback: invokeSearchAgent,
        });
      }, 200);
    }

    return response;
  } catch (error) {
    console.error("❌ Search Agent error:", error);
    
    // Handle cancellation gracefully
    if (error instanceof Error && error.message === "Operation cancelled by user") {
      markAgentAsStopped();
      updateAgentToaster("🛑 Search cancelled by user");
    } else {
      errorAgentToaster(error as Error);
    }
    
    throw error;
  } finally {
    removeSpinner(spinnerId);
    // Always clear the controller when done
    clearAgentController();
  }
};

// Context menu interface compatibility (matches existing search agent)
interface AgentInvoker {
  model: string;
  rootUid: string;
  target: string;
  targetUid?: string;
  prompt: string;
  previousAgentState?: any;
  onlySearch?: boolean;
  options?: any;
  permissions?: { contentAccess: boolean };
  privateMode?: boolean;
  isDirectChat?: boolean; // For chat mode to bypass RequestAnalyzer
}

// Main invoke function for backward compatibility with existing system
export const invokeSearchAgent = async ({
  model = defaultModel,
  rootUid,
  targetUid,
  target,
  prompt,
  previousAgentState,
  onlySearch,
  options,
  permissions,
  privateMode,
  isDirectChat,
}: AgentInvoker) => {
  return await invokeSearchAgentInternal({
    model,
    rootUid,
    targetUid,
    target,
    prompt,
    permissions: permissions || { contentAccess: false }, // Default to secure mode for backward compatibility
    privateMode: privateMode || false,
    isDirectChat: isDirectChat || false,
    agentData: previousAgentState,
    options,
  });
};

// Legacy invokeAskAgent for backward compatibility
export const invokeAskAgent = async ({
  model = defaultModel,
  rootUid,
  targetUid,
  target,
  prompt,
  previousAgentState,
  onlySearch,
  options,
  permissions,
  privateMode,
}: AgentInvoker) => {
  return await invokeSearchAgentInternal({
    model,
    rootUid,
    targetUid,
    target,
    prompt,
    permissions: permissions || { contentAccess: true }, // Ask agent typically needs full access
    privateMode: privateMode || false,
    agentData: previousAgentState,
    options,
  });
};

// Secure mode search agent (default - only secure tools)
export const invokeSearchAgentSecure = async ({
  model = defaultModel,
  rootUid,
  targetUid,
  target,
  prompt,
  previousAgentState,
  options,
  permissions,
  privateMode,
}: AgentInvoker) => {
  return await invokeSearchAgentInternal({
    model,
    rootUid,
    targetUid,
    target,
    prompt,
    permissions: permissions || { contentAccess: false },
    privateMode: privateMode || false,
    agentData: previousAgentState,
    options,
  });
};

// Non-secure mode search agent (includes content-level tools)
export const invokeSearchAgentFull = async ({
  model = defaultModel,
  rootUid,
  targetUid,
  target,
  prompt,
  previousAgentState,
  options,
  permissions,
  privateMode,
}: AgentInvoker) => {
  return await invokeSearchAgentInternal({
    model,
    rootUid,
    targetUid,
    target,
    prompt,
    permissions: permissions || { contentAccess: true },
    privateMode: privateMode || false,
    agentData: previousAgentState,
    options,
  });
};

