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
  addButtonsToToaster
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

  // Use the same toaster system as MCP agent with stop button enabled
  // For search agents, never show copy button since they have full results popup
  displayMCPToast("", {
    showStopButton: !!abortController,
    showFullResultsButton: agentType === "search" ? true : false
  });

  // Wait for toaster to be ready
  setTimeout(() => {
    agentToasterStream = (window as any).mcpToasterStreamElement as HTMLElement | null;
    if (agentToasterStream) {
      const typeDisplay = agentType === "search" ? "Search Agent" : agentType;
      const serverDisplay = serverInfo ? ` with ${serverInfo}` : "";
      agentToasterStream.innerText = `🚀 Starting ${typeDisplay}${serverDisplay}`;
    }
  }, 100);

  return agentToasterStream;
};

/**
 * Update agent toaster with progress message
 */
export const updateAgentToaster = (message: string): void => {
  if (agentToasterStream) {
    agentToasterStream.innerText += `\n${message}`;
  }
};

/**
 * Replace last toaster message (useful for updating status)
 */
export const replaceLastToasterMessage = (oldMessage: string, newMessage: string): void => {
  if (agentToasterStream) {
    agentToasterStream.innerText = agentToasterStream.innerText.replace(
      oldMessage,
      newMessage
    );
  }
};

/**
 * Add final completion message to toaster with full results option
 */
export const completeAgentToaster = (
  agentType: string,
  executionTime?: number,
  tokensUsage?: TokensUsage,
  fullResults?: any[],
  targetUid?: string
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
      agentToasterStream.innerText += `\n🏁 Total time: ${executionTime.toFixed(1)}s`;
    }
    
    if (tokensUsage && (tokensUsage.input_tokens || tokensUsage.output_tokens)) {
      const inputTokens = tokensUsage.input_tokens || 0;
      const outputTokens = tokensUsage.output_tokens || 0;
      agentToasterStream.innerText += `\n🔢 Tokens: ${inputTokens} in / ${outputTokens} out`;
    }

    // Replace Stop button with View Full Results button and store results persistently
    if (fullResults && fullResults.length > 0) {
      // Store results globally for command palette access
      (window as any).lastAskYourGraphResults = fullResults;
      // Store targetUid for insertion context
      if (targetUid) {
        (window as any).lastAgentResponseTargetUid = targetUid;
      }
      
      setTimeout(() => {
        // Find and remove existing buttons
        const toasterElt = document.querySelector(".mcp-toaster .bp3-toast");
        if (toasterElt) {
          const existingButtons = toasterElt.querySelector(".buttons");
          if (existingButtons) {
            existingButtons.remove();
          }
          
          // Use the standard addButtonsToToaster function
          // showFullResultsButton: true will exclude copy button and include full results button
          addButtonsToToaster(
            "completion-toast",
            ".mcp-toaster", 
            null, // We don't need the toaster instance for clearing
            {
              showStopButton: false,
              showFullResultsButton: true
            }
          );
        }
      }, 200);
    }
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
          search: "this search conversation that will help maintain context for future searches. Your summary should:\n\n1. **ALWAYS start with the original search request/goal** - what the user was trying to find or understand\n2. **Highlight important search findings and patterns** - key results discovered, successful search strategies, important pages/blocks found\n3. **Note search preferences and optimizations** - result modes used, any performance optimizations applied, user preferences for data display\n4. **Capture ongoing search directions** - areas still being explored, follow-up searches planned",
          mcp: "this MCP conversation that will help maintain context for future tool interactions. Your summary should:\n\n1. **ALWAYS start with the original user request/goal** - synthesize what the user initially wanted to accomplish\n2. **Highlight important findings, results, and conclusions** - include discoveries made, problems solved, key insights gained\n3. **Note tool usage patterns and preferences** - which tools were most effective, any optimizations applied\n4. **Capture ongoing tasks or directions** the conversation is heading",
          default: "this conversation that will help maintain context for future interactions. Your summary should:\n\n1. **ALWAYS start with the original user request/goal**\n2. **Highlight important findings and conclusions**\n3. **Note any ongoing tasks or directions**"
        };

        const contextPrompt = contextPrompts[agentType as keyof typeof contextPrompts] || contextPrompts.default;

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
  const missingFields = requiredFields.filter(field => 
    state[field] === undefined || state[field] === null
  );
  
  return {
    isValid: missingFields.length === 0,
    missingFields
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
  if (options?.retryInstruction && options?.isRetry && options?.isToRedoBetter) {
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
export const parseJSONResponse = <T = any>(
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
    if (cleanedText.includes('}')) {
      const lines = cleanedText.split('\n');
      let jsonLines = [];
      let braceCount = 0;
      let insideJson = false;
      
      for (const line of lines) {
        if (line.trim().startsWith('{')) {
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
        cleanedText = jsonLines.join('\n');
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
  if (!parsed || typeof parsed !== 'object') {
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