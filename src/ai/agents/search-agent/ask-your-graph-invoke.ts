import { defaultModel, automaticSemanticExpansion } from "../../..";
import { LlmInfos, TokensUsage } from "../langraphModelsLoader";
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
import { deduplicateResultsByUid } from "./tools/searchUtils";
import {
  clearAgentController,
  markAgentAsStopped,
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
    // Expansion tracking
    expansionLevel?: number;
    expansionConsent?: boolean;
    zeroResultsAttempts?: number;
    // Direct expansion parameters
    isDirectExpansion?: boolean;
    semanticExpansion?: "fuzzy" | "synonyms" | "related_concepts" | "broader_terms" | "all";
    isExpansionGlobal?: boolean;
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
      historyLength: agentData.conversationHistory?.length || 0,
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
  initializeAgentToaster(
    "search",
    `${modeInfo.icon} ${modeInfo.name} mode`,
    abortController
  );

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
      // Result management defaults
      resultSummaries: {},
      resultStore: {},
      nextResultId: 1,
      // Expansion tracking defaults
      expansionLevel: 0,
      expansionConsent: false,
      zeroResultsAttempts: 0,
    };

    // NEW: Process external context and integrate into agent's result management
    if (externalContext?.results && externalContext.results.length > 0) {
      console.log(
        `📥 Integrating external context: ${
          externalContext.results.length
        } results from ${externalContext.contextType || "unknown source"}`
      );

      // Create a result entry for external context
      const externalResultId = "external_context_001";
      const externalCacheEntry = {
        toolName: "externalContext",
        fullResults: {
          data: externalContext.results,
          metadata: {
            totalFound: externalContext.results.length,
            contextType: externalContext.contextType || "custom",
            description:
              externalContext.description || "External context results",
          },
        },
        userQuery: `External context: ${
          externalContext.description || "Chat results"
        }`,
        timestamp: Date.now(),
        canExpand: false,
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
          timestamp: Date.now(),
        };
      }

      console.log(
        `📥 External context integrated as ${externalResultId}: ${externalContext.results.length} results`
      );
    }

    // Store search parameters globally for potential post-completion expansion
    if (typeof window !== "undefined") {
      // CRITICAL: Clean up any existing expansion listeners from previous searches or cached code
      const existingListeners = (window as any)._expansionListeners || [];
      existingListeners.forEach((listener: any) => {
        try {
          window.removeEventListener("agentExpansion", listener);
        } catch (e) {
          // Ignore errors from removing non-existent listeners
        }
      });
      (window as any)._expansionListeners = []; // Clear the tracking array

      // Also try to remove old-style listeners (for VM cached code)
      try {
        window.removeEventListener(
          "agentExpansion",
          (window as any).handleExpansionEvent
        );
      } catch (e) {
        // Ignore if it doesn't exist
      }

      // Clear expansion history for NEW searches (not direct expansions)
      if (!conversationData.isDirectExpansion) {
        const queryKey = finalPrompt.toLowerCase().trim();
        console.log("🧹 [New Search] Clearing expansion history for fresh search:", queryKey);
        
        // Clear expansion history for this specific query to start fresh
        const expansionHistory = (window as any).searchExpansionHistory || {};
        delete expansionHistory[queryKey];
        (window as any).searchExpansionHistory = expansionHistory;
      }

      (window as any).lastSearchQuery = finalPrompt;
      (window as any).lastSearchRootUid = rootUid;
      (window as any).lastSearchParams = {
        model,
        permissions,
        privateMode,
        options,
      };
    }

    console.log(`🚀 Starting ReAct Search Agent: "${finalPrompt}"`);
    console.log(`🔍 Conversation parameters:`, {
      conversationHistory: conversationData.conversationHistory,
      conversationHistoryLength:
        conversationData.conversationHistory?.length || 0,
      conversationSummary: conversationData.conversationSummary,
      hasLimitedResults: conversationData.hasLimitedResults,
      isConversationMode: isConversationMode,
      cachedResultsCount: Object.keys(conversationData.cachedFullResults || {})
        .length,
      toolResultsCacheCount: Object.keys(
        conversationData.toolResultsCache || {}
      ).length,
      externalContextResults: externalContext?.results?.length || 0,
    });

    // Additional debugging for conversation history content
    if (
      conversationData.conversationHistory &&
      conversationData.conversationHistory.length > 0
    ) {
      console.log(
        `🔍 Conversation history content:`,
        conversationData.conversationHistory.slice(-2)
      );
    }

    // Prepare initial state for the agent
    const initialState = {
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
      // Initialize expansion tracking
      expansionLevel: conversationData.expansionLevel || 0,
      expansionConsent: conversationData.expansionConsent || false,
      zeroResultsAttempts: conversationData.zeroResultsAttempts || 0,
      startTime: Date.now(),
      // Pass abort signal for cancellation
      abortSignal: abortController.signal,
      // Add automatic semantic expansion setting from extension
      automaticExpansion: automaticSemanticExpansion,
      
      // Add expansion parameters for direct expansion  
      isDirectExpansion: Boolean(conversationData.isDirectExpansion),
      semanticExpansion: conversationData.semanticExpansion || undefined,
      isExpansionGlobal: Boolean(conversationData.isExpansionGlobal),
    };

    // Debug expansion parameters
    if (conversationData.isDirectExpansion) {
      console.log(`🔧 [Direct Expansion] Initial state created with:`, {
        isDirectExpansion: initialState.isDirectExpansion,
        semanticExpansion: initialState.semanticExpansion,
        isExpansionGlobal: initialState.isExpansionGlobal,
        expansionLevel: initialState.expansionLevel
      });
    }

    // Store state globally for expansion handling
    if (typeof window !== "undefined") {
      (window as any).currentSearchAgentState = initialState;
    }

    // Invoke agent with interrupt handling
    let response = await ReactSearchAgent.invoke(initialState);

    // If the response has pendingExpansion, it means we need to wait for user input
    // The state has been updated by showResultsThenExpand, so we don't resume from this response
    if ((response as any).pendingExpansion) {
      // Update the stored state with the current response state
      (window as any).currentSearchAgentState = response;
    }

    // Check if the graph was interrupted (user needs to provide input)
    if (
      (response as any).pendingExpansion ||
      (!response.finalAnswer && !response.targetUid)
    ) {
      console.log("🚧 [Graph] Execution interrupted - waiting for user input");

      // Set up a promise that resolves when user makes a choice
      return new Promise((resolve, reject) => {
        // Add a flag to prevent duplicate handling during rapid clicks
        let isProcessingExpansion = false;
        let timeoutId: NodeJS.Timeout;
        let abortListener: () => void;

        // Listen for expansion events from toaster buttons
        const expansionEventListener = async (event: CustomEvent) => {
          if (isProcessingExpansion) {
            console.log(
              "🚫 [Graph] Expansion already in progress, ignoring duplicate event"
            );
            return;
          }
          isProcessingExpansion = true;

          try {
            console.log("🚀 [Graph] Expansion choice made:", event.detail);

            // Clean up listeners and timers immediately
            window.removeEventListener(
              "agentExpansion",
              expansionEventListener
            );
            if (timeoutId) clearTimeout(timeoutId);
            if (abortListener)
              abortController.signal.removeEventListener(
                "abort",
                abortListener
              );

            // Update agent state with expansion consent
            if ((window as any).currentSearchAgentState) {
              const state = (window as any).currentSearchAgentState;
              const { action, label, emoji } = event.detail;

              console.log(`🚀 [Expansion] User selected: ${emoji} ${label}`);

              // Grant expansion consent and increment expansion level
              state.expansionConsent = true;
              state.expansionLabel = label;
              state.expansionLevel = (state.expansionLevel || 0) + 1;

              // Set expansion strategy based on selected option
              if (action.includes("hierarchical")) {
                state.searchStrategy = "hierarchical";
              } else if (
                action.includes("fuzzy") ||
                action.includes("semantic")
              ) {
                state.expansionState = {
                  ...state.expansionState,
                  searchStrategy: "semantic",
                };
              } else if (action.includes("same-block")) {
                state.searchStrategy = "flat";
              } else if (action.includes("multi-tool")) {
                state.expansionState = {
                  ...state.expansionState,
                  searchStrategy: "multi_tool",
                };
              } else {
                state.expansionState = {
                  ...state.expansionState,
                  searchStrategy: action,
                }; // Generic fallback
              }

              // Clear pending expansion flag
              state.pendingExpansion = false;

              console.log(
                `🔄 [Expansion] Continuing with strategy: ${
                  state.searchStrategy ||
                  state.expansionState?.searchStrategy ||
                  "default"
                }`
              );
            }

            // Update toaster to show expansion is starting
            updateAgentToaster(`🚀 ${event.detail.label}...`);

            // Resume the graph execution from where it left off
            console.log("🔄 [Graph] State before resume:", {
              expansionConsent: (window as any).currentSearchAgentState
                .expansionConsent,
              expansionLevel: (window as any).currentSearchAgentState
                .expansionLevel,
              pendingExpansion: (window as any).currentSearchAgentState
                .pendingExpansion,
            });

            const finalResponse = await ReactSearchAgent.invoke(
              (window as any).currentSearchAgentState,
              {
                recursionLimit: 50,
                streamMode: "values",
              }
            );

            // Clean up global state
            delete (window as any).currentSearchAgentState;
            delete (window as any).currentSearchAgentExecution;

            // Process the final response and resolve with its result
            const result = await processAgentResponse(finalResponse);
            resolve(result);
          } catch (error) {
            console.error("Error resuming graph execution:", error);
            reject(error);
          }
        };

        // Set up event listener and cleanup mechanisms
        if (typeof window !== "undefined") {
          // CRITICAL: Remove any existing expansion listeners to prevent duplicates
          // This is important because hot-reloading or multiple agent calls could leave stale listeners
          const allEventListeners = (window as any)._expansionListeners || [];
          allEventListeners.forEach((listener: any) => {
            try {
              window.removeEventListener("agentExpansion", listener);
            } catch (e) {
              // Ignore errors from removing non-existent listeners
            }
          });

          // Track this listener for cleanup
          (window as any)._expansionListeners = [expansionEventListener];
          window.addEventListener("agentExpansion", expansionEventListener);

          // Store continuation function for manual triggering if needed
          (window as any).currentSearchAgentExecution = {
            continueWithExpansion: async () => {
              const mockEvent = new CustomEvent("agentExpansion", {
                detail: {
                  action: "smart expansion",
                  label: "Smart expansion",
                  emoji: "🔍",
                },
              });
              window.dispatchEvent(mockEvent);
            },
          };

          // Check if user cancelled during interrupt
          if (abortController.signal.aborted) {
            reject(new Error("Operation cancelled by user"));
            return;
          }

          // Listen for abort signal during interrupt
          abortListener = () => {
            window.removeEventListener(
              "agentExpansion",
              expansionEventListener
            );
            if (timeoutId) clearTimeout(timeoutId);
            reject(new Error("Operation cancelled by user"));
          };
          abortController.signal.addEventListener("abort", abortListener);

          // Set a timeout to prevent hanging indefinitely
          timeoutId = setTimeout(() => {
            window.removeEventListener(
              "agentExpansion",
              expansionEventListener
            );
            if (abortListener)
              abortController.signal.removeEventListener(
                "abort",
                abortListener
              );
            reject(new Error("User input timeout - no expansion choice made"));
          }, 300000); // 5 minutes timeout
        }
      });
    }

    // Process normal response (not interrupted)
    return await processAgentResponse(response);

    // Helper function to process agent response
    async function processAgentResponse(response: any): Promise<any> {
      try {
        // Extract full results for the popup functionality
        const allFullResults = [];
        console.log(
          "🔍 [ask-your-graph-invoke] response.cachedFullResults:",
          response.cachedFullResults
        );
        console.log(
          "🔍 [ask-your-graph-invoke] response.resultStore:",
          response.resultStore
        );

        // NEW: Check the token-optimized resultStore first (preferred)
        if (response.resultStore) {
          Object.values(response.resultStore).forEach((resultEntry: any) => {
            console.log(
              "🔍 [ask-your-graph-invoke] Processing resultStore entry:",
              resultEntry
            );

            // Handle new lifecycle structure: {data: Array, purpose: string, status: string, ...}
            if (
              resultEntry &&
              resultEntry.data &&
              Array.isArray(resultEntry.data)
            ) {
              const validResults = resultEntry.data.filter(
                (r) => r && (r.uid || r.pageUid || r.pageTitle)
              );
              console.log(
                "🔍 [ask-your-graph-invoke] Valid results from new structure:",
                validResults.length
              );
              allFullResults.push(...validResults);
            }
            // Handle legacy structure: direct array
            else if (Array.isArray(resultEntry)) {
              const validResults = resultEntry.filter(
                (r) => r && (r.uid || r.pageUid || r.pageTitle)
              );
              console.log(
                "🔍 [ask-your-graph-invoke] Valid results from legacy structure:",
                validResults.length
              );
              allFullResults.push(...validResults);
            }
          });
        }

        // FALLBACK: Check legacy cachedFullResults for backward compatibility
        if (response.cachedFullResults && allFullResults.length === 0) {
          Object.values(response.cachedFullResults).forEach(
            (toolResults: any) => {
              console.log(
                "🔍 [ask-your-graph-invoke] Processing legacy cachedFullResults:",
                toolResults
              );
              if (Array.isArray(toolResults)) {
                const validResults = toolResults.filter(
                  (r) => r && (r.uid || r.pageUid || r.pageTitle)
                );
                console.log(
                  "🔍 [ask-your-graph-invoke] Valid results with UIDs:",
                  validResults.length
                );
                allFullResults.push(...validResults);
              } else if (
                toolResults &&
                toolResults.fullResults &&
                Array.isArray(toolResults.fullResults.data)
              ) {
                // Handle the case where results are nested under fullResults.data
                const validResults = toolResults.fullResults.data.filter(
                  (r) => r && (r.uid || r.pageUid || r.pageTitle)
                );
                console.log(
                  "🔍 [ask-your-graph-invoke] Valid nested results with UIDs:",
                  validResults.length
                );
                allFullResults.push(...validResults);
              }
            }
          );
        }

        // CRITICAL: Deduplicate full results by UID to prevent duplicate entries in popup
        const fullResults = deduplicateResultsByUid(
          allFullResults,
          "ask-your-graph-invoke"
        );

        console.log(
          "🔍 [ask-your-graph-invoke] Full results before deduplication:",
          allFullResults.length
        );
        console.log(
          "🔍 [ask-your-graph-invoke] Full results after deduplication:",
          fullResults.length
        );

        // Calculate execution time and complete toaster with full results
        const executionTime = formatExecutionTime(startTime);
        completeAgentToaster(
          "search",
          executionTime,
          turnTokensUsage,
          fullResults,
          response?.targetUid
        );

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
        console.error("❌ processAgentResponse error:", error);
        throw error;
      }
    }
  } catch (error) {
    console.error("❌ Search Agent error:", error);

    // Handle cancellation gracefully
    if (
      error instanceof Error &&
      error.message === "Operation cancelled by user"
    ) {
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

/**
 * Direct expansion search using existing invokeSearchAgent with expansion parameters
 */
export const invokeExpandedSearchDirect = async ({
  query,
  expansionStrategy,
  expansionLabel,
  expansionLevel,
  rootUid,
  searchParams,
}: {
  query: string;
  expansionStrategy: string;
  expansionLabel: string;
  expansionLevel: number;
  rootUid: string;
  searchParams: any;
}) => {
  console.log(
    `🚀 [Direct Expansion] Starting Level ${expansionLevel} expansion: ${expansionLabel}`
  );
  console.log(
    `🎯 [Direct Expansion] Strategy: ${expansionStrategy}, Query: "${query}"`
  );

  // Map expansion label to semantic expansion strategy for tools
  const mapExpansionLabelToStrategy = (expansionLabel: string, expansionStrategy: string): "fuzzy" | "synonyms" | "related_concepts" | "broader_terms" | "all" | null => {
    if (expansionLabel.includes("All") || expansionLabel.includes("all") || expansionLabel.includes("once")) {
      return "all";
    } else if (expansionLabel.includes("Fuzzy") || expansionLabel.includes("fuzzy") || expansionLabel.includes("typos")) {
      return "fuzzy";  
    } else if (expansionLabel.includes("Synonyms") || expansionLabel.includes("synonyms") || expansionLabel.includes("alternative")) {
      return "synonyms";
    } else if (expansionLabel.includes("Related") || expansionLabel.includes("related") || expansionLabel.includes("concepts")) {
      return "related_concepts";
    } else if (expansionLabel.includes("Broader") || expansionLabel.includes("broader") || expansionLabel.includes("categories")) {
      return "broader_terms";
    }
    return null;
  };

  // Create expansion agent data to pass semantic expansion parameters
  const expansionAgentData = {
    isConversationMode: false,
    isDirectExpansion: true, // Flag for assistant bypass
    semanticExpansion: mapExpansionLabelToStrategy(expansionLabel, expansionStrategy),
    isExpansionGlobal: true,
    expansionLevel: expansionLevel,
    expansionConsent: true,
    toolResultsCache: {},
    cachedFullResults: {},
    hasLimitedResults: false,
    conversationHistory: [],
    conversationSummary: undefined,
    exchangesSinceLastSummary: 0
  };

  console.log(`🎯 [Direct Expansion] Mapped semantic expansion: "${expansionAgentData.semanticExpansion}"`);

  // Use the standard invokeSearchAgent but with expansion parameters pre-configured
  return await invokeSearchAgent({
    model: searchParams.model || "claude-3-5-sonnet-20241022",
    rootUid,
    targetUid: rootUid,
    target: "",
    prompt: query,
    permissions: searchParams.permissions,
    privateMode: searchParams.privateMode,
    isDirectChat: false, // Keep normal Roam insertion behavior
    previousAgentState: expansionAgentData,
    options: searchParams.options
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
