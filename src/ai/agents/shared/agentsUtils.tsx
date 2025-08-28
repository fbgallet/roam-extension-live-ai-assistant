import React from "react";
import ReactDOM from "react-dom";
import { Button } from "@blueprintjs/core";
import {
  LlmInfos,
  TokensUsage,
  modelViaLanggraph,
} from "../langraphModelsLoader";
import { HumanMessage } from "@langchain/core/messages";
import {
  displayMCPToast,
  setAgentController,
  clearAgentController,
  setAgentFullResults,
  clearAgentFullResults,
  markAgentAsStopped,
  openFullResultsPopup,
  addButtonsToToaster,
  ensureToaster,
} from "../../../components/Toaster.js";

/**
 * Shared utilities for agents (MCP, Search, etc.)
 * Common functionality to reduce code duplication across agent implementations
 */

// Global toaster management
let agentToasterStream: HTMLElement | null = null;
let agentToasterInstance: any = null;

/**
 * Initialize agent toaster for progress tracking with stop functionality
 */
export const initializeAgentToaster = (
  agentType: string,
  serverInfo?: string,
  abortController?: AbortController
): HTMLElement | null => {
  // Set abort controller for stop functionality
  if (abortController) {
    setAgentController(abortController);
  }

  // Clear any previous full results
  clearAgentFullResults();

  // Use proper search agent toaster with stop button enabled
  agentToasterInstance = ensureToaster("AgentToaster");

  const toastId = agentToasterInstance.show({
    message: "",
    timeout: 0,
    isCloseButtonShown: false,
  });

  // Wait for toaster to be ready and add initial buttons
  setTimeout(() => {
    agentToasterStream = document.querySelector(
      ".search-agent-toaster .bp3-toast-message"
    );
    if (agentToasterStream) {
      const typeDisplay = agentType === "search" ? "Ask your graph" : agentType;
      const serverDisplay = serverInfo ? ` with ${serverInfo}` : "";
      agentToasterStream.innerText = `🚀 Starting ${typeDisplay}${serverDisplay}`;

      // Add initial buttons (stop + full results)
      addButtonsToToaster(
        toastId,
        ".search-agent-toaster",
        agentToasterInstance,
        {
          showStopButton: !!abortController,
          showFullResultsButton: agentType === "search" ? true : false,
        }
      );
    }
  }, 100);

  return agentToasterStream;
};

/**
 * Update agent toaster with progress message and optional expansion button
 */
export const updateAgentToaster = (
  message: string,
  options?: {
    showExpansionButton?: boolean;
    expansionOptions?: string;
    showFullResultsButton?: boolean;
  }
): void => {
  if (agentToasterStream) {
    agentToasterStream.innerText += `\n${message}`;

    // If expansion options are provided, update buttons to include expansion
    if (options?.showExpansionButton && options?.expansionOptions) {
      // Find the toaster element and update buttons
      const toasterElement = agentToasterStream.closest(".bp3-toast");
      if (toasterElement) {
        // Remove existing buttons
        const existingButtons = toasterElement.querySelector(".buttons");
        if (existingButtons) {
          existingButtons.remove();
        }

        // Add new buttons including expansion
        setTimeout(() => {
          addButtonsToToaster(
            null,
            ".search-agent-toaster",
            agentToasterInstance,
            {
              showExpansionButton: true,
              expansionOptions: options.expansionOptions,
              showStopButton: true, // Keep stop button during expansion
              showFullResultsButton: options.showFullResultsButton || false, // Enable full results button if requested
            }
          );
        }, 50); // Small delay to ensure DOM is ready
      }
    }
  }
};

/**
 * Replace last toaster message (useful for updating status)
 */
export const replaceLastToasterMessage = (
  oldMessage: string,
  newMessage: string
): void => {
  if (agentToasterStream) {
    agentToasterStream.innerText = agentToasterStream.innerText.replace(
      oldMessage,
      newMessage
    );
  }
};

/**
 * Generate intelligent post-completion expansion options based on search history
 */
const getPostCompletionExpansionOptions = (): string => {
  // Get expansion history from global state
  const expansionHistory = (window as any).searchExpansionHistory || {};
  const lastQuery = (window as any).lastSearchQuery || "";
  const queryKey = lastQuery.toLowerCase().trim();
  const previousExpansions = expansionHistory[queryKey] || [];

  console.log("🔧 [Post-Completion] Generating expansion options:", {
    lastQuery,
    queryKey,
    previousExpansions,
    historyExists: Object.keys(expansionHistory).length > 0,
  });

  // Default options if no previous expansions - use new strategy system
  const defaultOptions = `• 🤖 Auto (let the agent test progressive strategy)
• ⚡ All at once (fuzzy + synonyms + related concepts)
• 🔍 Fuzzy matching (typos, morphological variations)
• 📝 Synonyms and alternative terms
• 🧠 Related concepts and associated terms
• 🔄 Try other search strategies (combine different approaches)`;

  // If no previous expansions, show default
  if (previousExpansions.length === 0) {
    return defaultOptions;
  }

  // Build context-aware options based on what hasn't been tried
  const triedStrategies = new Set(
    previousExpansions.map((exp: any) => exp.strategy)
  );
  const availableOptions = [];

  // Add automatic progression option first
  if (!triedStrategies.has("automatic")) {
    availableOptions.push(
      "🤖 Automatic until results (level-to-level progression through Assistant)"
    );
  }

  // Add all-at-once option
  if (!triedStrategies.has("all")) {
    availableOptions.push(
      "⚡ All semantic expansions at once (fuzzy + synonyms + related concepts)"
    );
  }

  // Add individual strategy options based on what hasn't been tried
  if (!triedStrategies.has("fuzzy")) {
    availableOptions.push(
      "🔍 Fuzzy matching (typos, morphological variations)"
    );
  }
  if (!triedStrategies.has("synonyms")) {
    availableOptions.push("📝 Synonyms and alternative terms");
  }
  if (!triedStrategies.has("related_concepts")) {
    availableOptions.push("🧠 Related concepts and associated terms");
  }
  if (!triedStrategies.has("broader_terms")) {
    availableOptions.push("🌐 Broader terms and categories");
  }

  // Always offer multi-strategy as a final option
  availableOptions.push(
    "🔄 Try other search strategies (combine different approaches)"
  );

  return availableOptions.length > 0
    ? "• " + availableOptions.join("\n• ")
    : defaultOptions;
};

/**
 * Add final completion message to toaster with full results option
 */
export const completeAgentToaster = (
  agentType: string,
  executionTime?: number,
  tokensUsage?: TokensUsage,
  fullResults?: any[],
  targetUid?: string,
  userQuery?: string,
  formalQuery?: string,
  intentParserResult?: any
): void => {
  // Clear the agent controller since processing is complete
  clearAgentController();

  // Store full results for the "View Full Results" button
  if (fullResults && fullResults.length > 0) {
    setAgentFullResults(fullResults);
  }

  if (agentToasterStream) {
    const typeDisplay = agentType === "search" ? "Search Agent" : agentType;
    agentToasterStream.innerText += `\n🎉 ${typeDisplay} completed successfully!`;

    if (executionTime) {
      agentToasterStream.innerText += `\n🏁 Total time: ${executionTime.toFixed(
        1
      )}s`;
    }

    if (
      tokensUsage &&
      (tokensUsage.input_tokens || tokensUsage.output_tokens)
    ) {
      const inputTokens = tokensUsage.input_tokens || 0;
      const outputTokens = tokensUsage.output_tokens || 0;
      const totalTokens = inputTokens + outputTokens;
      agentToasterStream.innerText += `\n🔢 Tokens: ${totalTokens} total (${inputTokens} in / ${outputTokens} out)`;
    }

    // Replace Stop button with View Full Results button and store results persistently
    if (fullResults && fullResults.length > 0) {
      // Store results globally for command palette access
      (window as any).lastAskYourGraphResults = fullResults;
      // Store targetUid for insertion context
      if (targetUid) {
        (window as any).lastAgentResponseTargetUid = targetUid;
      }
      // Store queries for display in popup
      if (userQuery) {
        (window as any).lastUserQuery = userQuery;
      }
      if (formalQuery) {
        (window as any).lastFormalQuery = formalQuery;
      }
      // Store IntentParser result for query management
      if (intentParserResult) {
        (window as any).lastIntentParserResult = intentParserResult;
        
        // Add previous query to recent queries (if there was one)
        const { addRecentQuery } = require("../search-agent/helpers/queryStorage");
        const prevUserQuery = (window as any).previousUserQuery;
        const prevFormalQuery = (window as any).previousFormalQuery;
        const prevIntentParserResult = (window as any).previousIntentParserResult;
        
        if (prevUserQuery && prevIntentParserResult) {
          addRecentQuery({
            userQuery: prevUserQuery,
            formalQuery: prevFormalQuery || prevUserQuery,
            intentParserResult: prevIntentParserResult
          });
        }
        
        // Store current as previous for next time
        (window as any).previousUserQuery = userQuery;
        (window as any).previousFormalQuery = formalQuery;
        (window as any).previousIntentParserResult = intentParserResult;
      }

      setTimeout(() => {
        // Find and remove existing buttons from search-agent-toaster (not MCP toaster)
        const toasterElt = document.querySelector(
          ".search-agent-toaster .bp3-toast"
        );
        if (toasterElt) {
          const existingButtons = toasterElt.querySelector(".buttons");
          if (existingButtons) {
            existingButtons.remove();
          }

          // Generate intelligent expansion options based on what hasn't been tried
          const expansionOptions = getPostCompletionExpansionOptions();

          // Use the standard addButtonsToToaster function with correct toaster
          // showFullResultsButton: true will exclude copy button and include full results button
          addButtonsToToaster(
            "completion-toast",
            ".search-agent-toaster",
            agentToasterInstance, // Use the correct search agent toaster instance
            {
              showStopButton: false,
              showFullResultsButton: true,
              showExpansionButton: true,
              expansionOptions: expansionOptions,
            }
          );

          // Set up expansion handling for post-completion expansion
          setTimeout(() => {
            setupPostCompletionExpansionHandler();
          }, 300);
        }
      }, 200);
    }
  }
};

/**
 * Map expansion label and action to consistent strategy names
 * This ensures proper tracking across different expansion systems
 */
const mapLabelToStrategy = (label: string, action: string): string => {
  // Handle different label variations that map to the same strategy
  const labelMappings: Record<string, string> = {
    "Fuzzy matching (typos, morphological variations)": "fuzzy",
    "🔍 Fuzzy matching (typos, morphological variations)": "fuzzy",
    "Synonyms and alternative terms": "synonyms",
    "📝 Synonyms and alternative terms": "synonyms",
    "Related concepts and associated terms": "related_concepts",
    "🧠 Related concepts and associated terms": "related_concepts",
    "Broader terms and categories": "broader_terms",
    "🌐 Broader terms and categories": "broader_terms",
    "All semantic expansions at once (fuzzy + synonyms + related concepts)":
      "all",
    "⚡ All semantic expansions at once (fuzzy + synonyms + related concepts)":
      "all",
    "Automatic until results (level-to-level progression through Assistant)":
      "automatic",
    "🤖 Automatic until results (level-to-level progression through Assistant)":
      "automatic",
    "Auto (let the agent test progressive strategy)": "automatic",
    "🤖 Auto (let the agent test progressive strategy)": "automatic",
    "All at once (fuzzy + synonyms + related concepts)": "all",
    "⚡ All at once (fuzzy + synonyms + related concepts)": "all",
  };

  // First try to map by label
  if (labelMappings[label]) {
    return labelMappings[label];
  }

  // Fallback to action if available
  if (action && typeof action === "string") {
    return action.toLowerCase();
  }

  // Final fallback - extract strategy from label text
  const lowerLabel = label.toLowerCase();
  if (lowerLabel.includes("fuzzy")) return "fuzzy";
  if (lowerLabel.includes("synonym")) return "synonyms";
  if (lowerLabel.includes("related") || lowerLabel.includes("concept"))
    return "related_concepts";
  if (lowerLabel.includes("broader") || lowerLabel.includes("categor"))
    return "broader_terms";
  if (lowerLabel.includes("all") || lowerLabel.includes("once")) return "all";
  if (lowerLabel.includes("auto")) return "automatic";

  return action || "unknown";
};

/**
 * Set up expansion handling for post-completion expansion buttons
 * This handles expansion events after the agent has already completed
 */
const setupPostCompletionExpansionHandler = (): void => {
  // Clean up any existing expansion listeners first
  if (typeof window !== "undefined") {
    // Remove any existing listeners
    const allEventListeners = (window as any)._expansionListeners || [];
    allEventListeners.forEach((listener: any) => {
      try {
        window.removeEventListener("agentExpansion", listener);
      } catch (e) {
        // Ignore errors from removing non-existent listeners
      }
    });

    // Create new expansion handler for post-completion
    const postCompletionExpansionHandler = async (event: CustomEvent) => {
      try {
        const { action, label, emoji } = event.detail;
        console.log(
          `🚀 [Post-Completion Expansion] User selected: ${emoji} ${label}`
        );

        // Update toaster to show expansion is starting
        updateAgentToaster(
          `\n🚀 ${label}... Re-running search with expansion.`
        );

        // Import the necessary functions
        const invokeModule = await import(
          "../search-agent/ask-your-graph-invoke"
        );
        const invokeExpandedSearchDirect =
          invokeModule.invokeExpandedSearchDirect;

        // Get the last search parameters from the global state if available
        const lastQuery =
          (window as any).lastSearchQuery || "Please provide your search query";
        const lastRootUid =
          (window as any).lastSearchRootUid ||
          (window as any).roamAlphaAPI?.ui?.getFocusedBlock()?.["block-uid"];
        const lastParams = (window as any).lastSearchParams || {};

        if (!lastRootUid) {
          updateAgentToaster(
            `\n❌ Cannot determine where to insert results. Please focus on a block and try again.`
          );
          return;
        }

        if (!lastQuery || lastQuery === "Please provide your search query") {
          updateAgentToaster(
            `\n❌ No previous search query found. Please run a search first.`
          );
          return;
        }

        // Check expansion history for this query
        const expansionHistory = (window as any).searchExpansionHistory || {};
        const queryKey = lastQuery.toLowerCase().trim();
        const previousExpansions = expansionHistory[queryKey] || [];

        // Check if this specific expansion has been tried before
        // Map label to consistent strategy names to avoid false positives
        const normalizedStrategy = mapLabelToStrategy(label, action);
        const isRepeatExpansion = previousExpansions.some(
          (exp: any) =>
            exp.strategy === normalizedStrategy || exp.strategy === action
        );

        console.log(`🔧 [Post-Completion] Checking expansion history:`, {
          label,
          action,
          normalizedStrategy,
          previousExpansions,
          isRepeatExpansion,
        });

        if (isRepeatExpansion) {
          updateAgentToaster(
            `\n🔄 This expansion strategy has been tried before. Offering deeper alternatives...`
          );

          // Offer deeper expansion options
          setTimeout(() => {
            updateAgentToaster(``, {
              showExpansionButton: true,
              expansionOptions: `• 🚀 Multi-strategy deep search (combine all approaches)
• 🧠 AI-powered comprehensive analysis  
• 🌐 Cross-reference exploration (tags, links, mentions)`,
            });
          }, 1000);
          return;
        }

        // Record this expansion attempt
        if (!expansionHistory[queryKey]) {
          expansionHistory[queryKey] = [];
        }
        expansionHistory[queryKey].push({
          strategy: action,
          label: label,
          timestamp: Date.now(),
          level: previousExpansions.length + 1,
        });
        (window as any).searchExpansionHistory = expansionHistory;

        // Use direct assistant bypass for expansion
        await invokeExpandedSearchDirect({
          query: lastQuery,
          expansionStrategy: action,
          expansionLabel: label,
          expansionLevel: previousExpansions.length + 1,
          rootUid: lastRootUid,
          searchParams: lastParams,
        });
      } catch (error) {
        console.error("Error in post-completion expansion:", error);
        updateAgentToaster(`\n❌ Error applying expansion: ${error.message}`);
      }
    };

    // Track and add the new listener
    (window as any)._expansionListeners = [postCompletionExpansionHandler];
    window.addEventListener("agentExpansion", postCompletionExpansionHandler);

    console.log(
      "🔧 [Post-Completion] Expansion handler set up for completed search"
    );
  }
};

/**
 * Add error message to toaster
 */
export const errorAgentToaster = (error: Error): void => {
  // Clear the agent controller since processing failed
  clearAgentController();

  if (agentToasterStream) {
    agentToasterStream.innerText += `\n💥 Error: ${error.message}`;
  }
};

/**
 * Get current toaster stream element
 */
export const getAgentToasterStream = (): HTMLElement | null => {
  return agentToasterStream;
};

/**
 * Shared conversation state builder for agents
 * Handles summarization and history management
 */
export const buildAgentConversationState = async (
  currentHistory: any[],
  currentSummary: string | undefined,
  newUserPrompt: string,
  newAssistantResponse: any,
  llmInfos: LlmInfos,
  turnTokensUsage: TokensUsage,
  exchangesSinceLastSummary: number = 0,
  agentType: string = "agent"
) => {
  try {
    // Add new messages to history
    const assistantContent =
      typeof newAssistantResponse === "string"
        ? newAssistantResponse
        : newAssistantResponse?.toString() || "";

    const newHistory = [
      ...currentHistory,
      `User: ${newUserPrompt}`,
      `Assistant: ${assistantContent}`,
    ];

    // Increment exchanges counter
    const newExchangesSinceLastSummary = exchangesSinceLastSummary + 1;

    // Always keep last 6 messages (3 exchanges) for recent conversation
    const conversationHistory = newHistory.slice(-6);

    // Summarize every 3 exchanges (6 messages) to avoid summarizing every turn
    if (newExchangesSinceLastSummary >= 3 && newHistory.length > 6) {
      try {
        updateAgentToaster(`📝 Summarizing ${agentType} conversation...`);

        // Messages to summarize (everything except last 6)
        const messagesToSummarize = newHistory.slice(0, -6);
        const conversationToSummarize = messagesToSummarize.join("\n");

        // Create context-aware summarization prompt
        const contextPrompts = {
          search:
            "this search conversation that will help maintain context for future searches. Your summary should:\n\n1. **ALWAYS start with the original search request/goal** - what the user was trying to find or understand\n2. **Highlight important search findings and patterns** - key results discovered, successful search strategies, important pages/blocks found\n3. **Note search preferences and optimizations** - result modes used, any performance optimizations applied, user preferences for data display\n4. **Capture ongoing search directions** - areas still being explored, follow-up searches planned",
          mcp: "this MCP conversation that will help maintain context for future tool interactions. Your summary should:\n\n1. **ALWAYS start with the original user request/goal** - synthesize what the user initially wanted to accomplish\n2. **Highlight important findings, results, and conclusions** - include discoveries made, problems solved, key insights gained\n3. **Note tool usage patterns and preferences** - which tools were most effective, any optimizations applied\n4. **Capture ongoing tasks or directions** the conversation is heading",
          default:
            "this conversation that will help maintain context for future interactions. Your summary should:\n\n1. **ALWAYS start with the original user request/goal**\n2. **Highlight important findings and conclusions**\n3. **Note any ongoing tasks or directions**",
        };

        const contextPrompt =
          contextPrompts[agentType as keyof typeof contextPrompts] ||
          contextPrompts.default;

        const summarizationPrompt = `${
          currentSummary
            ? `**Previous Summary:**\n${currentSummary}\n\n**Additional conversation to incorporate:**`
            : "**Conversation to summarize:**"
        }\n${conversationToSummarize}\n\n**Instructions:** Provide a comprehensive summary of ${contextPrompt}`;

        // Use the same LLM to create summary
        const llm = modelViaLanggraph(llmInfos, turnTokensUsage);
        const summaryResponse = await llm.invoke([
          new HumanMessage({ content: summarizationPrompt }),
        ]);

        const newSummary = summaryResponse.content.toString();

        replaceLastToasterMessage(
          `📝 Summarizing ${agentType} conversation...`,
          `📝 ${agentType} conversation summarized`
        );

        return {
          conversationHistory,
          conversationSummary: newSummary,
          exchangesSinceLastSummary: 0, // Reset counter after summarization
        };
      } catch (error) {
        console.warn("⚠️ Summary failed - continuing without:", error);

        replaceLastToasterMessage(
          `📝 Summarizing ${agentType} conversation...`,
          "⚠️ Summary failed - continuing without"
        );

        // Fallback: keep the current summary if summarization fails, but still reset counter
        return {
          conversationHistory,
          conversationSummary: currentSummary,
          exchangesSinceLastSummary: 0, // Reset counter even on failure to avoid infinite retry
        };
      }
    }

    // Not enough exchanges to summarize yet
    return {
      conversationHistory,
      conversationSummary: currentSummary,
      exchangesSinceLastSummary: newExchangesSinceLastSummary, // Keep incrementing counter
    };
  } catch (error) {
    console.warn("⚠️ Conversation state building failed:", error);
    // Return safe defaults
    return {
      conversationHistory: currentHistory,
      conversationSummary: currentSummary,
      exchangesSinceLastSummary,
    };
  }
};

/**
 * Format agent execution time
 */
export const formatExecutionTime = (startTime: number): number => {
  return (Date.now() - startTime) / 1000;
};

/**
 * Format token usage for display
 */
export const formatTokenUsage = (tokensUsage: TokensUsage): string => {
  const inputTokens = tokensUsage.input_tokens || 0;
  const outputTokens = tokensUsage.output_tokens || 0;
  return `${inputTokens} in / ${outputTokens} out`;
};

/**
 * Common agent state validation
 */
export const validateAgentState = (
  requiredFields: string[],
  state: Record<string, any>
): { isValid: boolean; missingFields: string[] } => {
  const missingFields = requiredFields.filter(
    (field) => state[field] === undefined || state[field] === null
  );

  return {
    isValid: missingFields.length === 0,
    missingFields,
  };
};

/**
 * Common retry logic handler
 */
export const handleRetryLogic = (
  originalPrompt: string,
  options?: {
    retryInstruction?: string;
    isRetry?: boolean;
    isToRedoBetter?: boolean;
  }
): string => {
  if (
    options?.retryInstruction &&
    options?.isRetry &&
    options?.isToRedoBetter
  ) {
    return `${originalPrompt}\n\nPlease improve the response considering: ${options.retryInstruction}`;
  }
  return originalPrompt;
};

/**
 * Common permission validation
 */
export const validatePermissions = (
  permissions: { contentAccess: boolean },
  requiredLevel: "secure" | "full"
): boolean => {
  if (requiredLevel === "full") {
    return permissions.contentAccess === true;
  }
  return true; // Secure mode always allowed
};

/**
 * Robust JSON parsing for LLM responses (especially helpful for Anthropic models)
 * Handles common formatting issues and provides fallback options
 */
export const parseJSONResponse = <T = any,>(
  responseText: string,
  fallbackValue?: T
): T | null => {
  try {
    // Clean up - focus only on removing markdown wrapper
    let cleanedText = responseText.trim();

    // Remove markdown code blocks if present
    cleanedText = cleanedText.replace(/^```json\s*\n?/, ""); // Remove opening ```json
    cleanedText = cleanedText.replace(/\n?\s*```\s*$/, ""); // Remove closing ```
    cleanedText = cleanedText.replace(/```/g, ""); // Remove any remaining ```
    cleanedText = cleanedText.trim();

    // Try to find JSON within the text if direct parsing fails
    if (!cleanedText.startsWith("{") && !cleanedText.startsWith("[")) {
      const jsonMatch = cleanedText.match(/\{[\s\S]*?\}(?=\s*$|\s*\n\s*[A-Z])/);
      if (jsonMatch) {
        cleanedText = jsonMatch[0];
      }
    }

    // Additional cleanup: if we have extra text after JSON, extract just the JSON part
    if (cleanedText.includes("}")) {
      const lines = cleanedText.split("\n");
      let jsonLines = [];
      let braceCount = 0;
      let insideJson = false;

      for (const line of lines) {
        if (line.trim().startsWith("{")) {
          insideJson = true;
        }

        if (insideJson) {
          jsonLines.push(line);
          braceCount += (line.match(/\{/g) || []).length;
          braceCount -= (line.match(/\}/g) || []).length;

          if (braceCount === 0) {
            break; // Found complete JSON object
          }
        }
      }

      if (jsonLines.length > 0) {
        cleanedText = jsonLines.join("\n");
      }
    }

    // Try parsing the cleaned text directly
    const result = JSON.parse(cleanedText);
    return result as T;
  } catch (error) {
    console.warn("JSON parsing failed:", error, "Original text:", responseText);
    return fallbackValue || null;
  }
};

/**
 * Parse JSON response with specific field extraction
 * Useful when you know the expected structure and want to extract specific fields
 */
export const parseJSONWithFields = <T extends Record<string, any>>(
  responseText: string,
  fieldMappings: Record<keyof T, string[]>
): T | null => {
  const parsed = parseJSONResponse(responseText);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const result = {} as T;

  for (const [targetField, possibleFields] of Object.entries(fieldMappings)) {
    for (const field of possibleFields) {
      if (parsed[field] !== undefined) {
        result[targetField as keyof T] = parsed[field];
        break;
      }
    }
  }

  return result;
};

/**
 * Result summarization utilities for token optimization
 */

// Result summary interface (duplicated here for consistency)
export interface ResultSummary {
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

/**
 * Generate a unique result ID
 */
export const generateResultId = (toolName: string, counter: number): string => {
  return `${toolName}_${counter.toString().padStart(3, "0")}`;
};

/**
 * Create a result summary from tool result
 */
export const createResultSummary = (
  toolName: string,
  resultId: string,
  userQuery: string,
  toolResult: any,
  sortedBy?: string
): ResultSummary => {
  const data = toolResult.data || [];
  const metadata = toolResult.metadata || {};

  // Determine result type based on tool name and data structure
  const resultType = determineResultType(toolName, data);

  // Extract sample items for context
  const sampleItems = extractSampleItems(data, resultType, 3);

  return {
    id: resultId,
    toolName,
    query: userQuery,
    totalCount: data.length || metadata.returnedCount || 0,
    resultType,
    sampleItems,
    metadata: {
      wasLimited: metadata.wasLimited || false,
      canExpand: metadata.canExpandResults || false,
      searchTerms: extractSearchTerms(userQuery),
      sortedBy: sortedBy as any,
      availableCount:
        metadata.totalFound || metadata.availableCount || data.length || 0,
      // Type-specific metadata
      ...(resultType === "combinations" && {
        dataType: (data as any).type,
        operation: (data as any).operation,
      }),
      ...(resultType === "hierarchy" && {
        formatType: (data as any).content ? "string" : "structured",
        hierarchyDepth: (data as any).stats?.maxDepth,
      }),
    },
  };
};

/**
 * Determine result type from tool name and data
 */
const determineResultType = (
  toolName: string,
  data: any
): ResultSummary["resultType"] => {
  // Map tool names to result types
  const toolTypeMap: Record<string, ResultSummary["resultType"]> = {
    findBlocksByContent: "blocks",
    findBlocksWithHierarchy: "blocks",
    findPagesByTitle: "pages",
    findPagesByContent: "pages",
    findPagesSemantically: "pages",
    extractPageReferences: "references",
    extractHierarchyContent: "hierarchy",
    combineResults: "combinations",
    getNodeDetails: data[0]?.content ? "blocks" : "pages", // Heuristic
    executeDatomicQuery: data[0]?.uid
      ? data[0]?.content
        ? "blocks"
        : "pages"
      : "blocks",
  };

  return toolTypeMap[toolName] || "blocks";
};

/**
 * Extract sample items for LLM context
 */
const extractSampleItems = (
  data: any[],
  resultType: ResultSummary["resultType"],
  count: number
): string[] => {
  if (!Array.isArray(data) || data.length === 0) {
    return [];
  }

  const sampleData = data.slice(0, count);

  switch (resultType) {
    case "blocks":
      return sampleData.map((item) =>
        item.pageTitle ? `Block in [[${item.pageTitle}]]` : `Block ${item.uid}`
      );

    case "pages":
      return sampleData.map((item) => `[[${item.title}]]`);

    case "references":
      return sampleData.map(
        (item) => `[[${item.pageTitle}]] (${item.count} refs)`
      );

    case "hierarchy":
      return sampleData.map(
        (item) =>
          `Hierarchy from ${item.rootUid} (${
            item.stats?.totalBlocks || 0
          } blocks)`
      );

    case "combinations":
      // For combinations, data is not an array but a single result object
      return [
        `${(data as any).finalCount || data.length} combined ${
          (data as any).type || "items"
        }`,
      ];

    default:
      return sampleData.map((_, i) => `Item ${i + 1}`);
  }
};

/**
 * Extract search terms from user query (simple heuristic)
 */
const extractSearchTerms = (query: string): string[] => {
  // Simple extraction - look for quoted terms and significant words
  const quotedTerms =
    query.match(/"([^"]+)"/g)?.map((t) => t.slice(1, -1)) || [];
  const bracketTerms =
    query.match(/\[\[([^\]]+)\]\]/g)?.map((t) => t.slice(2, -2)) || [];
  const hashTerms = query.match(/#(\w+)/g)?.map((t) => t.slice(1)) || [];

  return [...new Set([...quotedTerms, ...bracketTerms, ...hashTerms])].slice(
    0,
    5
  );
};

/**
 * Generate compact summary text for LLM context
 */
export const generateSummaryText = (
  summary: ResultSummary,
  securityMode: "private" | "balanced" | "full"
): string => {
  const { id, toolName, totalCount, resultType, sampleItems, metadata } =
    summary;

  switch (securityMode) {
    case "private":
      // Minimal info for private mode
      return `Search ${id}: ${totalCount} ${resultType} found${
        metadata.sortedBy ? ` (sorted by ${metadata.sortedBy})` : ""
      }`;

    case "balanced":
      // Include samples but not detailed content
      const sampleText =
        sampleItems.length > 0
          ? `. Samples: ${sampleItems.slice(0, 2).join(", ")}`
          : "";
      return `Search ${id}: ${totalCount} ${resultType} found via ${toolName}${sampleText}${
        metadata.sortedBy ? ` (sorted by ${metadata.sortedBy})` : ""
      }. Use fromResultId: "${id}" to reference this data in other tools.`;

    case "full":
      // Full details with all samples
      const fullSampleText =
        sampleItems.length > 0 ? `. Examples: ${sampleItems.join(", ")}` : "";
      const limitText = metadata.wasLimited
        ? ` (${metadata.availableCount} total available)`
        : "";
      return `Search ${id}: ${totalCount} ${resultType} found via ${toolName}${fullSampleText}${limitText}${
        metadata.sortedBy ? ` (sorted by ${metadata.sortedBy})` : ""
      }. Use fromResultId: "${id}" to reference this data in other tools.`;

    default:
      return `Search ${id}: ${totalCount} ${resultType}`;
  }
};
