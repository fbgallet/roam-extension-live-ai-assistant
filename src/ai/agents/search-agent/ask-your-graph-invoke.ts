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
import { HumanMessage } from "@langchain/core/messages";
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
  };
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

    console.log(`🚀 Starting ReAct Search Agent: "${finalPrompt}"`);
    console.log(`🔍 Conversation parameters:`, {
      conversationHistory: conversationData.conversationHistory,
      conversationHistoryLength: conversationData.conversationHistory?.length || 0,
      conversationSummary: conversationData.conversationSummary,
      hasLimitedResults: conversationData.hasLimitedResults,
      isConversationMode: isConversationMode,
      cachedResultsCount: Object.keys(conversationData.cachedFullResults || {}).length,
      toolResultsCacheCount: Object.keys(conversationData.toolResultsCache || {}).length,
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
      permissions,
      privateMode,
      // Initialize caching (MCP pattern)
      toolResultsCache: conversationData.toolResultsCache || {},
      cachedFullResults: conversationData.cachedFullResults || {},
      hasLimitedResults: conversationData.hasLimitedResults || false,
      startTime: Date.now(),
      // Pass abort signal for cancellation
      abortSignal: abortController.signal,
    });

    // Extract full results for the popup functionality
    const fullResults = [];
    console.log("🔍 [ask-your-graph-invoke] response.cachedFullResults:", response.cachedFullResults);
    if (response.cachedFullResults) {
      Object.values(response.cachedFullResults).forEach((toolResults: any) => {
        console.log("🔍 [ask-your-graph-invoke] Processing toolResults:", toolResults);
        if (Array.isArray(toolResults)) {
          const validResults = toolResults.filter(r => r && r.uid);
          console.log("🔍 [ask-your-graph-invoke] Valid results with UIDs:", validResults.length);
          fullResults.push(...validResults);
        } else if (toolResults && toolResults.fullResults && Array.isArray(toolResults.fullResults.data)) {
          // Handle the case where results are nested under fullResults.data
          const validResults = toolResults.fullResults.data.filter(r => r && r.uid);
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
}: AgentInvoker) => {
  return await invokeSearchAgentInternal({
    model,
    rootUid,
    targetUid,
    target,
    prompt,
    permissions: permissions || { contentAccess: false }, // Default to secure mode for backward compatibility
    privateMode: privateMode || false,
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

