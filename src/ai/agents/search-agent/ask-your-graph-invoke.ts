import { defaultModel, automaticSemanticExpansionMode } from "../../..";
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
import { deduplicateResultsByUid } from "./helpers/searchUtils";
import { addRecentQuery } from "./helpers/queryStorage";
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
    semanticExpansion?:
      | "fuzzy"
      | "synonyms"
      | "related_concepts"
      | "broader_terms"
      | "all";
    isExpansionGlobal?: boolean;
    // Privacy mode update bypass flag
    isPrivacyModeUpdated?: boolean;
    // Flag to indicate privacy mode was forced (skip privacy analysis)
    isPrivacyModeForced?: boolean;
    // Flag to force popup-only results (skip Roam block insertion)
    forcePopupOnly?: boolean;
    // External context from chat or other components
    externalContext?: {
      results?: any[];
      contextType?: "search_results" | "chat_context" | "custom";
      description?: string;
    };
  };
  // NEW: External context from chat or other components
  externalContext?: {
    results?: any[]; // Results from FullResultsPopup or other sources
    contextType?: "search_results" | "chat_context" | "custom";
    description?: string; // Description of what these results represent
  };
  // NEW: Direct chat mode to bypass RequestAnalyzer
  isDirectChat?: boolean;
  // NEW: Popup execution mode - skip directFormat and insertResponse
  isPopupExecution?: boolean;
  // NEW: Chat system prompt for popup execution
  chatSystemPrompt?: string;
  // NEW: Streaming callback for popup chat interface
  streamingCallback?: (content: string) => void;
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
  isPopupExecution = false,
  chatSystemPrompt,
  streamingCallback,
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
  
  // Only show toaster if not in chat mode within popup
  if (!(isPopupExecution && agentData?.isConversationMode)) {
    initializeAgentToaster(
      "search",
      `${modeInfo.icon} ${modeInfo.name} mode`,
      abortController
    );
  }

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

    // Debug conversation data and history
    console.log(`🔍 [Invoke] Conversation history check:`, {
      hasAgentData: !!agentData,
      agentDataConversationHistory: agentData?.conversationHistory?.length || 0,
      conversationDataHistory: conversationData.conversationHistory?.length || 0,
      isConversationMode: conversationData.isConversationMode
    });

    // NEW: Process external context and integrate into agent's result management
    const embeddedExternalContext = agentData?.externalContext;
    if (embeddedExternalContext?.results && embeddedExternalContext.results.length > 0) {
      console.log(
        `📥 Integrating external context: ${
          embeddedExternalContext.results.length
        } results from ${embeddedExternalContext.contextType || "unknown source"}`
      );

      // Create a result entry for external context
      const externalResultId = "external_context_001";
      const externalCacheEntry = {
        toolName: "externalContext",
        fullResults: {
          data: embeddedExternalContext.results,
          metadata: {
            totalFound: embeddedExternalContext.results.length,
            contextType: embeddedExternalContext.contextType || "custom",
            description:
              embeddedExternalContext.description || "External context results",
          },
        },
        userQuery: `External context: ${
          embeddedExternalContext.description || "Chat results"
        }`,
        timestamp: Date.now(),
        canExpand: false,
      };

      // Add to cached results for conversation context (skip for popup execution to avoid duplicate context)
      if (!isPopupExecution) {
        if (!conversationData.cachedFullResults) {
          conversationData.cachedFullResults = {};
        }
        conversationData.cachedFullResults[externalResultId] = externalCacheEntry;
      }

      // Add to result store if supported
      if (conversationData.resultStore) {
        conversationData.resultStore[externalResultId] = {
          data: embeddedExternalContext.results,
          purpose: "final" as const,
          status: "active" as const,
          toolName: "externalContext",
          timestamp: Date.now(),
        };
      }

      console.log(
        `📥 External context integrated: ${embeddedExternalContext.results.length} results → resultStore[${externalResultId}]`
      );
      
      // Debug content lengths
      embeddedExternalContext.results.forEach((result, i) => {
        const content = result.content || result.text || '';
        console.log(`📝 Result ${i+1} content length: ${content.length} chars - "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`);
      });
    }

    // Store search parameters globally for potential post-completion expansion
    if (typeof window !== "undefined") {
      // CRITICAL: Clean up any existing expansion listeners from previous searches or cached code
      const existingListeners = (window as any)._expansionListeners || [];
      existingListeners.forEach((listener: any) => {
        try {
          window.removeEventListener("agentExpansion", listener);
          window.removeEventListener("agentPrivacyMode", listener);
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
        
        // Clean up the persistent expansion listener from previous sessions
        if ((window as any)._currentExpansionListener) {
          window.removeEventListener(
            "agentExpansion", 
            (window as any)._currentExpansionListener
          );
          delete (window as any)._currentExpansionListener;
        }
        
        // Clean up previous agent state
        delete (window as any).currentSearchAgentState;
        delete (window as any).currentSearchAgentExecution;
      } catch (e) {
        // Ignore if it doesn't exist
      }

      // Clear expansion history for NEW searches (not direct expansions)
      if (!conversationData.isDirectExpansion) {
        const queryKey = finalPrompt.toLowerCase().trim();

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
        // Preserve forcePopupOnly for expansions
        agentData: {
          forcePopupOnly: conversationData.forcePopupOnly,
        },
      };
    }

    console.log(`🚀 Starting ReAct Search Agent: "${finalPrompt}"`);
    // console.log(`🔍 Conversation parameters:`, {
    //   conversationHistory: conversationData.conversationHistory,
    //   conversationHistoryLength:
    //     conversationData.conversationHistory?.length || 0,
    //   conversationSummary: conversationData.conversationSummary,
    //   hasLimitedResults: conversationData.hasLimitedResults,
    //   isConversationMode: isConversationMode,
    //   cachedResultsCount: Object.keys(conversationData.cachedFullResults || {})
    //     .length,
    //   toolResultsCacheCount: Object.keys(
    //     conversationData.toolResultsCache || {}
    //   ).length,
    //   externalContextResults: externalContext?.results?.length || 0,
    // });

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
      // For popup execution, pass the chat system prompt
      chatSystemPrompt,
      isPopupExecution,
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
      // Add automatic semantic expansion mode setting from extension
      automaticExpansionMode: automaticSemanticExpansionMode,

      // Add expansion parameters for direct expansion
      isDirectExpansion: Boolean(conversationData.isDirectExpansion),
      maxDepthOverride: (conversationData as any).maxDepthOverride || null,
      semanticExpansion: conversationData.semanticExpansion || undefined,
      isExpansionGlobal: Boolean(conversationData.isExpansionGlobal),
      // Privacy mode update bypass flag
      isPrivacyModeUpdated: Boolean(conversationData.isPrivacyModeUpdated),
      // Flag to indicate privacy mode was forced (skip privacy analysis)
      isPrivacyModeForced: Boolean(conversationData.isPrivacyModeForced),
      // Force popup-only results (skip Roam block insertion)
      forcePopupOnly: Boolean(conversationData.forcePopupOnly),
      // Force hierarchical search mode (for flat → hierarchical conversion)
      forceHierarchical: Boolean((conversationData as any).forceHierarchical),
      // Streaming callback for popup chat interface
      streamingCallback,
    };

    // Debug expansion parameters
    if (conversationData.isDirectExpansion) {
      console.log(`🔧 [Direct Expansion] Initial state created with:`, {
        isDirectExpansion: initialState.isDirectExpansion,
        maxDepthOverride: initialState.maxDepthOverride,
        semanticExpansion: initialState.semanticExpansion,
        isExpansionGlobal: initialState.isExpansionGlobal,
        expansionLevel: initialState.expansionLevel,
      });
    }

    // Store state globally for expansion handling
    if (typeof window !== "undefined") {
      (window as any).currentSearchAgentState = initialState;
    }

    // Invoke agent with interrupt handling
    let response = await ReactSearchAgent.invoke(initialState);

    // If the response has pendingExpansion or pendingPrivacyEscalation, it means we need to wait for user input
    // The state has been updated by showResultsThenExpand or showPrivacyModeDialog, so we don't resume from this response
    if (
      (response as any).pendingExpansion ||
      (response as any).pendingPrivacyEscalation
    ) {
      // Update the stored state with the current response state
      (window as any).currentSearchAgentState = response;
    }

    // Check if the graph was interrupted (user needs to provide input)
    if (
      (response as any).pendingExpansion ||
      (response as any).pendingPrivacyEscalation ||
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

            // Clean up timers but keep expansion listener for subsequent expansions
            if (timeoutId) clearTimeout(timeoutId);
            if (abortListener)
              abortController.signal.removeEventListener(
                "abort",
                abortListener
              );
              
            // Keep the expansion listener active for multiple expansions
            // It will be cleaned up when the toaster is closed or session ends

            // Update agent state with expansion consent
            if ((window as any).currentSearchAgentState) {
              const state = (window as any).currentSearchAgentState;
              const { action, label, emoji } = event.detail;

              console.log(`🚀 [Expansion] User selected: ${emoji} ${label}`);

              // Grant expansion consent and increment expansion level
              state.expansionConsent = true;
              state.expansionLabel = label;
              state.expansionLevel = (state.expansionLevel || 0) + 1;

              // Map action/label to exact strategy using the centralized mapping function
              const { mapLabelToStrategy } = await import("../shared/expansionConstants");
              const strategy = mapLabelToStrategy(label, action);
              
              console.log(`🔧 [Expansion] Mapped "${label}" to strategy: "${strategy}"`);

              // Set expansion strategy based on the mapped strategy value
              switch (strategy) {
                case "all":
                  // "All at once" semantic expansion
                  state.isExpansionGlobal = true;
                  state.semanticExpansion = "all";
                  console.log(`🔧 [Expansion] Set global semantic expansion: all`);
                  break;
                  
                case "fuzzy":
                case "synonyms": 
                case "related_concepts":
                case "broader_terms":
                  // Individual semantic expansion strategies
                  state.isExpansionGlobal = true;
                  state.semanticExpansion = strategy;
                  console.log(`🔧 [Expansion] Set global semantic expansion: ${strategy}`);
                  break;
                  
                case "automatic":
                  // Auto semantic expansion until results
                  state.automaticExpansionMode = "auto_until_result";
                  console.log(`🔧 [Expansion] Set automatic expansion mode: auto_until_result`);
                  break;
                  
                case "hierarchical":
                  state.searchStrategy = "hierarchical";
                  break;
                  
                case "other":
                  state.expansionState = {
                    ...state.expansionState,
                    searchStrategy: "multi_tool",
                  };
                  break;
                  
                default:
                  // Handle depth expansions and other cases
                  if (action.includes("same-block")) {
                    state.searchStrategy = "flat";
                  } else if (action.includes("Deepen search")) {
                    // Handle depth expansion with depthTarget from event detail
                    if (event.detail.depthTarget) {
                      state.maxHierarchyDepth = event.detail.depthTarget;
                      state.searchStrategy = "hierarchical";
                    }
                  } else {
                    state.expansionState = {
                      ...state.expansionState,
                      searchStrategy: strategy,
                    };
                  }
                  break;
              }

              // Mark this as a direct expansion to skip intent parsing
              state.isDirectExpansion = true;
              
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

            // Keep global state for subsequent expansions
            // State will be cleaned up when toaster is closed or session ends
            console.log("🔄 [Expansion] Keeping state active for additional expansions");

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
              window.removeEventListener("agentPrivacyMode", listener);
            } catch (e) {
              // Ignore errors from removing non-existent listeners
            }
          });

          // Privacy mode event listener for handling privacy escalation
          const privacyModeEventListener = async (event: CustomEvent) => {
            if (isProcessingExpansion) {
              console.log(
                "🚫 [Graph] Privacy mode change already in progress, ignoring duplicate event"
              );
              return;
            }
            isProcessingExpansion = true;

            try {
              console.log("🔒 [Graph] Privacy mode choice made:", event.detail);

              // Clean up listeners and timers immediately
              window.removeEventListener(
                "agentExpansion",
                expansionEventListener
              );
              window.removeEventListener(
                "agentPrivacyMode",
                privacyModeEventListener
              );
              if (timeoutId) clearTimeout(timeoutId);
              if (abortListener)
                abortController.signal.removeEventListener(
                  "abort",
                  abortListener
                );

              // Update agent state with new privacy mode
              if ((window as any).currentSearchAgentState) {
                const state = (window as any).currentSearchAgentState;
                const { selectedMode, rememberChoice } = event.detail;

                console.log(`🔒 [Privacy] User selected mode: ${selectedMode}`);

                // Update privacy mode in global settings if user wants to remember
                if (rememberChoice) {
                  const { setSessionAskGraphMode } = await import(
                    "./ask-your-graph"
                  );
                  setSessionAskGraphMode(selectedMode, true);
                  console.log(
                    `🔒 [Privacy] Remembered choice: ${selectedMode}`
                  );
                }

                // Clear privacy escalation flags and update current mode
                state.pendingPrivacyEscalation = false;
                state.privacyMessage = undefined;
                state.currentMode = selectedMode;
                state.suggestedMode = undefined;

                // Update permissions based on new mode
                if (selectedMode === "Private") {
                  state.permissions = { contentAccess: false };
                  state.privateMode = true;
                } else {
                  state.permissions = { contentAccess: true };
                  state.privateMode = false;
                }

                // CRITICAL: Set flag to bypass conversationRouter and intentParser since we already have IntentParser response
                state.isPrivacyModeUpdated = true;
                state.routingDecision = "need_new_search";

                console.log(
                  `🔒 [Privacy] Updated permissions:`,
                  state.permissions
                );
                console.log(
                  `🔒 [Privacy] Set isPrivacyModeUpdated flag:`,
                  state.isPrivacyModeUpdated
                );

                // CRITICAL: Continue graph execution from assistant node with updated state
                // We have the IntentParser response, now continue with updated privacy mode
                console.log(
                  "🔄 [Privacy] Continuing graph execution from assistant node"
                );

                // Update toaster to show privacy mode change
                updateAgentToaster(
                  `🔒 Switched to ${selectedMode} mode - continuing search...`
                );

                // Continue the graph execution from assistant with updated state and permissions
                const finalResponse = await ReactSearchAgent.invoke(state, {
                  recursionLimit: 50,
                  streamMode: "values",
                });

                // Clean up global state
                delete (window as any).currentSearchAgentState;

                // Process the final response and resolve with its result
                const result = await processAgentResponse(finalResponse);
                resolve(result);
              } else {
                reject(new Error("Agent state not found"));
              }
            } catch (error) {
              console.error(
                "❌ [Graph] Error handling privacy mode choice:",
                error
              );
              reject(error);
            } finally {
              isProcessingExpansion = false;
            }
          };

          // Track this listener for cleanup
          (window as any)._expansionListeners = [
            expansionEventListener,
            privacyModeEventListener,
          ];
          window.addEventListener("agentExpansion", expansionEventListener);
          window.addEventListener("agentPrivacyMode", privacyModeEventListener);
          
          // Store the expansion listener reference for later cleanup
          (window as any)._currentExpansionListener = expansionEventListener;

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
            window.removeEventListener(
              "agentPrivacyMode",
              privacyModeEventListener
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
            window.removeEventListener(
              "agentPrivacyMode",
              privacyModeEventListener
            );
            if (abortListener)
              abortController.signal.removeEventListener(
                "abort",
                abortListener
              );
            reject(
              new Error("User input timeout - no privacy mode choice made")
            );
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

        // Store this successful query as a recent query for future re-execution
        if (response?.userQuery && response?.formalQuery && response?.searchStrategy) {
          try {
            addRecentQuery({
              userQuery: response.userQuery,
              formalQuery: response.formalQuery,
              intentParserResult: {
                formalQuery: response.formalQuery,
                searchStrategy: response.searchStrategy,
                analysisType: response.analysisType,
                language: response.language,
                confidence: response.confidence,
                datomicQuery: response.datomicQuery,
                needsPostProcessing: response.needsPostProcessing,
                postProcessingType: response.postProcessingType,
                isExpansionGlobal: response.isExpansionGlobal,
                semanticExpansion: response.semanticExpansion,
                customSemanticExpansion: response.customSemanticExpansion,
                searchDetails: response.searchDetails,
                preferredModel: response.model?.id || response.model?.name
              }
            });
          } catch (error) {
            console.warn("Failed to store recent query:", error);
          }
        }

        // Calculate execution time and complete toaster with full results
        const executionTime = formatExecutionTime(startTime);
        completeAgentToaster(
          "search",
          executionTime,
          turnTokensUsage,
          fullResults,
          response?.targetUid,
          response?.userQuery || finalPrompt,
          response?.formalQuery,
          response
            ? {
                formalQuery: response.formalQuery,
                searchStrategy: response.searchStrategy,
                analysisType: response.analysisType,
                language: response.language,
                confidence: response.confidence,
                datomicQuery: response.datomicQuery,
                needsPostProcessing: response.needsPostProcessing,
                postProcessingType: response.postProcessingType,
                isExpansionGlobal: response.isExpansionGlobal,
                semanticExpansion: response.semanticExpansion,
                customSemanticExpansion: response.customSemanticExpansion,
                searchDetails: response.searchDetails,
              }
            : undefined,
          agentData?.isConversationMode || false
        );

        // Store final agent state for expansion options (all execution paths)
        if (typeof window !== "undefined") {
          (window as any).lastAgentState = {
            maxDepthOverride: initialState.maxDepthOverride,
            isDirectExpansion: initialState.isDirectExpansion,
            semanticExpansion: initialState.semanticExpansion,
          };
          
          // Update lastIntentParserResult with the actual response data
          if (response && response.formalQuery) {
            (window as any).lastIntentParserResult = {
              formalQuery: response.formalQuery,
              searchStrategy: response.searchStrategy,
              analysisType: response.analysisType,
              language: response.language,
              confidence: response.confidence,
              datomicQuery: response.datomicQuery,
              needsPostProcessing: response.needsPostProcessing,
              postProcessingType: response.postProcessingType,
              isExpansionGlobal: response.isExpansionGlobal,
              semanticExpansion: response.semanticExpansion,
              customSemanticExpansion: response.customSemanticExpansion,
              searchDetails: response.searchDetails,
            };
          } else {
            console.warn(`🔧 [Intent Parser] Could not update lastIntentParserResult - missing response or formalQuery`, {
              hasResponse: !!response,
              hasFormalQuery: !!(response?.formalQuery)
            });
          }
          
          console.log(`🔧 [Agent State] Stored final agent state:`, (window as any).lastAgentState);
        }

        // Handle forcePopupOnly mode - automatically open the popup and skip Roam block insertion
        if (agentData?.forcePopupOnly) {
          console.log("🔍 [ForcePopupOnly] Opening FullResultsPopup automatically");
          
          // Store results and metadata for the popup
          if (typeof window !== "undefined") {
            (window as any).lastAskYourGraphResults = fullResults;
            (window as any).lastAgentResponseTargetUid = response?.targetUid;
            (window as any).lastUserQuery = response?.userQuery || finalPrompt;
            (window as any).lastFormalQuery = response?.formalQuery;
            // Store final agent state for expansion options
            (window as any).lastAgentState = {
              maxDepthOverride: initialState.maxDepthOverride,
              isDirectExpansion: initialState.isDirectExpansion,
              semanticExpansion: initialState.semanticExpansion,
            };
          }

          // Import and open the popup automatically
          import("../../../components/Toaster.js").then(({ openFullResultsPopup }) => {
            if (openFullResultsPopup) {
              console.log("🔍 [ForcePopupOnly] Opening popup with results:", fullResults?.length || 0);
              openFullResultsPopup(
                fullResults, 
                response?.targetUid, 
                response?.userQuery || finalPrompt, 
                response?.formalQuery
              );
            }
          }).catch((error) => {
            console.error("Failed to open FullResultsPopup:", error);
          });

          // Return early to skip conversation buttons and Roam block insertion
          return {
            ...response,
            targetUid: null, // Skip Roam block insertion by nullifying targetUid
            forcePopupOnly: true // Include flag in response for debugging
          };
        }

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
  isPopupExecution?: boolean; // For popup execution mode
  chatSystemPrompt?: string; // For popup chat system prompt
  streamingCallback?: (content: string) => void; // For popup streaming
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
  isPopupExecution,
  chatSystemPrompt,
  streamingCallback,
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
    isPopupExecution: isPopupExecution || false,
    chatSystemPrompt,
    streamingCallback,
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
    `🎯 [Direct Expansion] Strategy: ${expansionStrategy}, Query: "${query}", maxDepth override: ${searchParams.maxDepth}`
  );

  // Map expansion label to semantic expansion strategy for tools
  const mapExpansionLabelToStrategy = (
    expansionLabel: string,
    expansionStrategy: string
  ):
    | "fuzzy"
    | "synonyms"
    | "related_concepts"
    | "broader_terms"
    | "all"
    | null => {
    if (
      expansionLabel.includes("All") ||
      expansionLabel.includes("all") ||
      expansionLabel.includes("once")
    ) {
      return "all";
    } else if (
      expansionLabel.includes("Fuzzy") ||
      expansionLabel.includes("fuzzy") ||
      expansionLabel.includes("typos")
    ) {
      return "fuzzy";
    } else if (
      expansionLabel.includes("Synonyms") ||
      expansionLabel.includes("synonyms") ||
      expansionLabel.includes("alternative")
    ) {
      return "synonyms";
    } else if (
      expansionLabel.includes("Related") ||
      expansionLabel.includes("related") ||
      expansionLabel.includes("concepts")
    ) {
      return "related_concepts";
    } else if (
      expansionLabel.includes("Broader") ||
      expansionLabel.includes("broader") ||
      expansionLabel.includes("categories")
    ) {
      return "broader_terms";
    }
    return null;
  };

  // Create expansion agent data to pass semantic expansion parameters
  const expansionAgentData = {
    isConversationMode: false,
    isDirectExpansion: true, // Flag for assistant bypass
    semanticExpansion: mapExpansionLabelToStrategy(
      expansionLabel,
      expansionStrategy
    ),
    isExpansionGlobal: true,
    expansionLevel: expansionLevel,
    expansionConsent: true,
    toolResultsCache: {},
    cachedFullResults: {},
    hasLimitedResults: false,
    conversationHistory: [],
    conversationSummary: undefined,
    exchangesSinceLastSummary: 0,
    // Preserve forcePopupOnly flag from original search
    forcePopupOnly: searchParams.agentData?.forcePopupOnly || false,
    // Pass maxDepth override for depth expansion
    maxDepthOverride: searchParams.maxDepth || null,
    // Pass forceHierarchical for flat → hierarchical conversion
    forceHierarchical: searchParams.forceHierarchical || false,
  };

  console.log(
    `🎯 [Direct Expansion] Mapped semantic expansion: "${expansionAgentData.semanticExpansion}"`
  );
  console.log(
    `🔍 [Direct Expansion] ForcePopupOnly preserved: ${expansionAgentData.forcePopupOnly}`
  );
  console.log(
    `🏗️ [Direct Expansion] maxDepthOverride: ${expansionAgentData.maxDepthOverride}`
  );

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
    options: searchParams.options,
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
