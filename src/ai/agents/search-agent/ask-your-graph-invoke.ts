import { defaultModel, automaticSemanticExpansionMode } from "../../..";
import { LlmInfos, TokensUsage } from "../langraphModelsLoader";
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
} from "../shared/agentsUtils";
import { mapLabelToStrategy } from "../shared/expansionConstants";
import { deduplicateResultsByUid } from "./helpers/searchUtils";
import { addRecentQuery } from "../../../components/full-results-popup/utils/queryStorage";
import { openFullResultsPopup } from "../../../components/full-results-popup";
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

  let llmInfos: LlmInfos = modelAccordingToProvider(model);

  const spinnerId = displaySpinner(rootUid);

  // Initialize toaster for progress tracking with stop functionality
  const getModeInfo = (privateMode: boolean, permissions: any) => {
    if (privateMode) return { name: "Private", icon: "🔒" };
    if (permissions.contentAccess) return { name: "Full Access", icon: "🔓" };
    return { name: "Balanced", icon: "🛡️" };
  };

  const modeInfo = getModeInfo(privateMode, permissions);

  // Suppress toaster when:
  // 1. Running FROM the popup (isPopupExecution with conversation mode)
  // 2. Running FROM the chat agent tool (rootUid === "chat-agent-tool")
  // When forcePopupOnly is true but NOT from chat-agent-tool, we still want toaster feedback
  const shouldSuppressToaster =
    (isPopupExecution && agentData?.isConversationMode) ||
    rootUid === "chat-agent-tool";

  initializeAgentToaster(
    "search",
    `${modeInfo.icon} ${modeInfo.name} mode`,
    abortController,
    shouldSuppressToaster
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
    const embeddedExternalContext = agentData?.externalContext;
    if (
      embeddedExternalContext?.results &&
      embeddedExternalContext.results.length > 0
    ) {
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
        conversationData.cachedFullResults[externalResultId] =
          externalCacheEntry;
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
    }

    // Store search parameters globally for potential post-completion expansion
    if (typeof window !== "undefined") {
      // CRITICAL: Clean up any existing expansion listeners from previous searches or cached code
      const existingListeners = (window as any)._expansionListeners || [];
      existingListeners.forEach((listener: any) => {
        try {
          window.removeEventListener("agentExpansion", listener);
          window.removeEventListener("agentPrivacyMode", listener);
          window.removeEventListener("agentScopeSelection", listener);
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

    // Store state globally for expansion handling
    if (typeof window !== "undefined") {
      (window as any).currentSearchAgentState = initialState;
    }

    // Invoke agent with interrupt handling
    let response = await ReactSearchAgent.invoke(initialState);

    // If the response has pendingExpansion, pendingPrivacyEscalation, or pendingScopeOptions, it means we need to wait for user input
    // The state has been updated by showResultsThenExpand, showPrivacyModeDialog, or showScopeSelectionDialog, so we don't resume from this response
    if (
      (response as any).pendingExpansion ||
      (response as any).pendingPrivacyEscalation ||
      (response as any).pendingScopeOptions
    ) {
      // Update the stored state with the current response state
      (window as any).currentSearchAgentState = response;
    }

    // Check if the graph was interrupted (user needs to provide input)
    // Note: Don't treat forcePopupOnly mode as an interrupt - it's a valid completion state
    // In forcePopupOnly mode, targetUid may be null (results go to popup, not Roam), so check agentData
    const isForcePopupOnlyMode =
      agentData?.forcePopupOnly || conversationData?.forcePopupOnly;
    if (
      (response as any).pendingExpansion ||
      (response as any).pendingPrivacyEscalation ||
      (response as any).pendingScopeOptions ||
      (!response.finalAnswer && !response.targetUid && !isForcePopupOnlyMode)
    ) {
      // Set up a promise that resolves when user makes a choice
      return new Promise((resolve, reject) => {
        // Add a flag to prevent duplicate handling during rapid clicks
        let isProcessingExpansion = false;
        let timeoutId: NodeJS.Timeout;
        let abortListener: () => void;

        // Listen for expansion events from toaster buttons
        const expansionEventListener = async (event: CustomEvent) => {
          if (isProcessingExpansion) {
            return;
          }
          isProcessingExpansion = true;

          try {
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
              const { action, label, emoji, strategyKey } = event.detail;

              console.log(`🚀 [Expansion] User selected: ${emoji} ${label}`);
              console.log(`🔧 [Expansion] Event detail:`, {
                action,
                label,
                emoji,
                strategyKey,
              });

              // Grant expansion consent and increment expansion level
              state.expansionConsent = true;
              state.expansionLabel = label;
              state.expansionLevel = (state.expansionLevel || 0) + 1;

              // Map action/label to exact strategy using the centralized mapping function
              const { mapLabelToStrategy } = await import(
                "../shared/expansionConstants"
              );

              // Check for strategy key first (more reliable)
              let strategy;
              if (strategyKey) {
                const { EXPANSION_OPTIONS } = await import(
                  "../shared/expansionConstants"
                );
                strategy =
                  EXPANSION_OPTIONS[strategyKey]?.strategy ||
                  mapLabelToStrategy(label, action);
              } else {
                strategy = mapLabelToStrategy(label, action);
              }

              // Set expansion strategy based on the mapped strategy value
              switch (strategy) {
                case "all":
                  // "All at once" semantic expansion
                  state.isExpansionGlobal = true;
                  state.semanticExpansion = "all";

                  break;

                case "fuzzy":
                case "synonyms":
                case "related_concepts":
                case "broader_terms":
                  // Individual semantic expansion strategies
                  state.isExpansionGlobal = true;
                  state.semanticExpansion = strategy;
                  console.log(
                    `🔧 [Expansion] Set global semantic expansion: ${strategy}`
                  );
                  break;

                case "automatic":
                  // Auto semantic expansion until results

                  state.automaticExpansionMode = "auto_until_result";
                  // Clear global semantic expansion flags since automatic mode handles its own expansion
                  state.isExpansionGlobal = false;
                  state.semanticExpansion = null;

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

              // Update toaster to show expansion is starting
              // Note: automatic expansion will show its own detailed progress, so skip the initial message
              if (strategy !== "automatic") {
                updateAgentToaster(`🚀 ${event.detail.label}...`);
              }
            }

            // Resume the graph execution from where it left off

            const finalResponse = await ReactSearchAgent.invoke(
              (window as any).currentSearchAgentState,
              {
                recursionLimit: 50,
                streamMode: "values",
              }
            );

            // Keep global state for subsequent expansions
            // State will be cleaned up when toaster is closed or session ends

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
              window.removeEventListener("agentScopeSelection", listener);
            } catch (e) {
              // Ignore errors from removing non-existent listeners
            }
          });

          // Privacy mode event listener for handling privacy escalation
          const privacyModeEventListener = async (event: CustomEvent) => {
            if (isProcessingExpansion) {
              return;
            }
            isProcessingExpansion = true;

            try {
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

                // Update privacy mode in global settings if user wants to remember
                if (rememberChoice) {
                  const { setSessionAskGraphMode } = await import(
                    "./ask-your-graph"
                  );
                  setSessionAskGraphMode(selectedMode);
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

                // CRITICAL: Continue graph execution from assistant node with updated state
                // We have the IntentParser response, now continue with updated privacy mode

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

          // Scope selection event listener for handling exploratory query scope selection
          const scopeSelectionEventListener = async (event: CustomEvent) => {
            if (isProcessingExpansion) {
              return;
            }
            isProcessingExpansion = true;

            try {
              // Clean up listeners and timers immediately
              window.removeEventListener(
                "agentExpansion",
                expansionEventListener
              );
              window.removeEventListener(
                "agentPrivacyMode",
                privacyModeEventListener
              );
              window.removeEventListener(
                "agentScopeSelection",
                scopeSelectionEventListener
              );
              if (timeoutId) clearTimeout(timeoutId);
              if (abortListener)
                abortController.signal.removeEventListener(
                  "abort",
                  abortListener
                );

              // Update agent state with selected scope strategy
              if ((window as any).currentSearchAgentState) {
                const state = (window as any).currentSearchAgentState;
                const { selectedStrategy, userIntent } = event.detail;

                // If selectedStrategy is null, user chose to skip scope analysis
                if (selectedStrategy === null) {
                  // Clear scope state and let the agent continue with the original query
                  state.pendingScopeOptions = undefined;
                  state.pendingRecommendedStrategy = undefined;
                  state.forceScopeSelection = undefined;
                  // CRITICAL: Set flag to skip scope analysis in IntentParser
                  state.skipScopeAnalysis = true;
                  // Reset routing to re-run through conversationRouter and IntentParser
                  state.routingDecision = "analyze_complexity";

                  // Resume graph execution - IntentParser will parse the query
                  // without scope selection instructions
                  const finalResponse = await ReactSearchAgent.invoke(state, {
                    recursionLimit: 50,
                    streamMode: "values",
                  });

                  // Clean up global state
                  delete (window as any).currentSearchAgentState;

                  // Process the final response and resolve with its result
                  const result = await processAgentResponse(finalResponse);
                  resolve(result);
                  return;
                }

                // Import the strategy mapper
                const { mapScopeStrategyToQuery } = await import(
                  "./ask-your-graph-agent"
                );

                // Map the selected strategy to executable query
                const queryConfig = mapScopeStrategyToQuery(
                  selectedStrategy,
                  userIntent || state.userIntent || "Exploratory analysis"
                );

                // Check if this strategy requires content access and user doesn't have it
                const hasContentAccess =
                  state.permissions?.contentAccess || false;
                const needsContentAccess =
                  queryConfig.constraints?.requiresAnalysis ||
                  queryConfig.constraints?.needsContentExpansion;

                // If strategy needs content but user doesn't have access, show privacy dialog
                // Skip if privacy mode was forced (e.g., inherited from chat agent)
                if (
                  needsContentAccess &&
                  (state.privateMode || !hasContentAccess) &&
                  !state.isPrivacyModeForced
                ) {
                  const currentMode = state.privateMode ? "Private" : "Secure";

                  // Show privacy escalation dialog
                  const { displayAskGraphModeDialog } = await import(
                    "../../../utils/domElts.js"
                  );

                  displayAskGraphModeDialog({
                    currentMode: currentMode,
                    suggestedMode: "balanced",
                    userQuery: state.userQuery,
                    onModeSelect: async (newMode: string) => {
                      // Update privacy mode based on selection
                      if (newMode === "private") {
                        state.privateMode = true;
                        state.permissions = { contentAccess: false };
                      } else if (newMode === "balanced") {
                        state.privateMode = false;
                        state.permissions = { contentAccess: false };
                      } else {
                        // full mode
                        state.privateMode = false;
                        state.permissions = { contentAccess: true };
                      }

                      // Now update state and resume execution
                      state.formalQuery = queryConfig.formalQuery;
                      state.userIntent = queryConfig.userIntent;
                      state.searchDetails = queryConfig.constraints;
                      state.searchStrategy = "direct";
                      state.queryComplexity = "simple";
                      state.analysisType = "summary";
                      state.pendingScopeOptions = undefined;
                      state.pendingRecommendedStrategy = undefined;
                      state.isPrivacyModeUpdated = true;

                      try {
                        // Resume graph execution with the updated state
                        const finalResponse = await ReactSearchAgent.invoke(
                          state,
                          {
                            recursionLimit: 50,
                            streamMode: "values",
                          }
                        );

                        // Clean up global state
                        delete (window as any).currentSearchAgentState;

                        // Process the final response and resolve with its result
                        const result = await processAgentResponse(
                          finalResponse
                        );
                        resolve(result);
                      } catch (error) {
                        console.error(
                          "❌ [Graph] Error resuming after privacy change:",
                          error
                        );
                        reject(error);
                      }
                    },
                  });

                  return; // Wait for user response
                }

                // Update state with the selected query configuration
                state.formalQuery = queryConfig.formalQuery;
                state.userIntent = queryConfig.userIntent;
                state.searchDetails = queryConfig.constraints;
                state.searchStrategy = "direct";
                state.queryComplexity = "simple";
                state.analysisType = "summary";
                // Clear pending scope state
                state.pendingScopeOptions = undefined;
                state.pendingRecommendedStrategy = undefined;
                // Bypass IntentParser since we already have the query
                state.isPrivacyModeUpdated = true;

                // Resume graph execution with the updated state
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
                "❌ [Graph] Error handling scope selection:",
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
            scopeSelectionEventListener,
          ];
          window.addEventListener("agentExpansion", expansionEventListener);
          window.addEventListener("agentPrivacyMode", privacyModeEventListener);
          window.addEventListener(
            "agentScopeSelection",
            scopeSelectionEventListener
          );

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
            window.removeEventListener(
              "agentScopeSelection",
              scopeSelectionEventListener
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
            window.removeEventListener(
              "agentScopeSelection",
              scopeSelectionEventListener
            );
            if (abortListener)
              abortController.signal.removeEventListener(
                "abort",
                abortListener
              );
            reject(new Error("User input timeout - no scope/mode choice made"));
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

        // NEW: Check the token-optimized resultStore first (preferred)
        if (response.resultStore) {
          Object.values(response.resultStore).forEach((resultEntry: any) => {
            // Handle new lifecycle structure: {data: Array, purpose: string, status: string, ...}
            if (
              resultEntry &&
              resultEntry.data &&
              Array.isArray(resultEntry.data)
            ) {
              const validResults = resultEntry.data.filter(
                (r) => r && (r.uid || r.pageUid || r.pageTitle || r.title)
              );

              allFullResults.push(...validResults);
            }
            // Handle legacy structure: direct array
            else if (Array.isArray(resultEntry)) {
              const validResults = resultEntry.filter(
                (r) => r && (r.uid || r.pageUid || r.pageTitle || r.title)
              );

              allFullResults.push(...validResults);
            }
          });
        }

        // FALLBACK: Check legacy cachedFullResults for backward compatibility
        if (response.cachedFullResults && allFullResults.length === 0) {
          Object.values(response.cachedFullResults).forEach(
            (toolResults: any) => {
              if (Array.isArray(toolResults)) {
                const validResults = toolResults.filter(
                  (r) => r && (r.uid || r.pageUid || r.pageTitle || r.title)
                );

                allFullResults.push(...validResults);
              } else if (
                toolResults &&
                toolResults.fullResults &&
                Array.isArray(toolResults.fullResults.data)
              ) {
                // Handle the case where results are nested under fullResults.data
                const validResults = toolResults.fullResults.data.filter(
                  (r) => r && (r.uid || r.pageUid || r.pageTitle || r.title)
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

        // Store this successful query as a recent query for future re-execution
        if (
          response?.userQuery &&
          response?.formalQuery &&
          response?.searchStrategy
        ) {
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
                preferredModel: response.model?.id || response.model?.name,
              },
              isComposed: false,
              querySteps: [],
              pageSelections: [],
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
            console.warn(
              `🔧 [Intent Parser] Could not update lastIntentParserResult - missing response or formalQuery`,
              {
                hasResponse: !!response,
                hasFormalQuery: !!response?.formalQuery,
              }
            );
          }
        }

        // Handle forcePopupOnly mode - automatically open the popup and skip Roam block insertion
        if (agentData?.forcePopupOnly) {
          // Add fullResults to response object for direct access (avoids window race conditions)
          (response as any).fullResults = fullResults;

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

          // Open the popup automatically (unless called from query composer, chat agent tool, OR composed query execution)
          // Don't open popup for:
          // - query-composer: results are added to existing popup
          // - chat-agent-tool: results are added via callback, popup already open
          // - composed-*: sub-executions that aggregate results elsewhere
          if (
            rootUid !== "query-composer" &&
            rootUid !== "chat-agent-tool" &&
            !rootUid.startsWith("composed-")
          ) {
            const userQuery = response?.userQuery || finalPrompt;
            const forceOpenChat =
              userQuery?.startsWith("all linked references of [[") || false;
            // Get intentParserResult from window (was set at line 849)
            const intentParserResult = (window as any).lastIntentParserResult;

            openFullResultsPopup({
              results: fullResults,
              targetUid: response?.targetUid,
              userQuery,
              formalQuery: response?.formalQuery,
              forceOpenChat,
              intentParserResult,
            });
          }

          // Return early to skip conversation buttons and Roam block insertion
          return {
            ...response,
            targetUid: null, // Skip Roam block insertion by nullifying targetUid
            forcePopupOnly: true, // Include flag in response for debugging
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
  // Use centralized strategy mapping function
  const mappedStrategy = mapLabelToStrategy(expansionLabel, expansionStrategy);

  // Create expansion agent data to pass semantic expansion parameters
  const expansionAgentData = {
    isConversationMode: false,
    isDirectExpansion: true, // Flag for assistant bypass
    semanticExpansion: mappedStrategy,
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
    // Set automatic expansion mode for "automatic" strategy only (not for custom)
    automaticExpansionMode:
      mappedStrategy === "automatic" ? "auto_until_result" : undefined,
    // Pass custom strategy for custom expansion
    customSemanticExpansion:
      mappedStrategy === "custom"
        ? searchParams.customSemanticExpansion
        : undefined,
  };

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

/**
 * Specialized function to invoke Ask Your Graph for linked references of the current page
 * This function handles page detection, creates the formal query, and bypasses IntentParser
 */
/**
 * DEPRECATED: Use openFullResultsPopup with roamContext instead.
 * This function is kept for backward compatibility.
 *
 * @deprecated Use openFullResultsPopup({ roamContext: { linkedRefs: true }, ... }) instead
 */
// export const invokeCurrentPageReferences = async ({
//   model = defaultModel,
//   rootUid,
//   targetUid,
//   target,
// }: {
//   model?: string;
//   rootUid?: string;
//   targetUid?: string;
//   target?: string;
// }) => {
//   // Import necessary functions
//   const { getMainPageUid, getPageNameByPageUid } = await import(
//     "../../../utils/roamAPI"
//   );
//   const { openFullResultsPopup } = await import(
//     "../../../components/full-results-popup"
//   );

//   try {
//     // Get current page information
//     const currentPageUid = await getMainPageUid();
//     if (!currentPageUid) {
//       throw new Error("No current page found");
//     }

//     // Get page name for the query
//     const pageName = getPageNameByPageUid(currentPageUid);
//     if (!pageName || pageName === "undefined") {
//       throw new Error("Could not get page name");
//     }

//     // Use the new openFullResultsPopup with roamContext
//     // This is much simpler and leverages the new RoamContext loader
//     const roamContext = {
//       linkedRefs: true,
//       sidebar: false,
//       mainPage: false,
//       logPages: false,
//     };

//     // Use currentPageUid as rootUid if not provided
//     const effectiveRootUid = rootUid || currentPageUid;
//     const effectiveTargetUid = targetUid || currentPageUid;

//     // Open popup directly - skip if called from query composer
//     if (rootUid !== "query-composer") {
//       console.log(
//         `🚀 [invokeCurrentPageReferences] Opening popup with RoamContext for: ${pageName}`
//       );

//       await openFullResultsPopup({
//         roamContext,
//         rootUid: effectiveRootUid,
//         targetUid: effectiveTargetUid,
//         // userQuery,
//         viewMode: "both", // Show both results and chat
//         initialChatModel: model,
//       });
//     } else {
//       console.log(
//         "🔧 [QueryComposer] Skipping popup opening - called from query composer"
//       );
//     }

//     // Return a minimal response object for compatibility
//     return {
//       // userQuery,
//       formalQuery: `ref:${pageName}`,
//       searchStrategy: "direct" as const,
//       analysisType: "simple",
//       language: "English",
//       confidence: 1.0,
//       datomicQuery: `ref:${pageName}`,
//       needsPostProcessing: false,
//       postProcessingType: undefined,
//       isExpansionGlobal: false,
//       semanticExpansion: undefined,
//       customSemanticExpansion: undefined,
//       searchDetails: { maxResults: 3000 },
//       forceOpenChat: true,
//       directToolExecution: true,
//     };
//   } catch (error) {
//     console.error("Error in invokeCurrentPageReferences:", error);
//     throw error;
//   }
// };
