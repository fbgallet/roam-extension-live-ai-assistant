/**
 * Chat Agent Invocation Wrapper
 *
 * Provides a simple interface for invoking the chat agent
 */

import { HumanMessage } from "@langchain/core/messages";
import { createChatGraph, ChatAgentStateType } from "./chat-agent";
import { LlmInfos, TokensUsage } from "../langraphModelsLoader";
import {
  addImagesUrlToMessages,
  isModelSupportingImage,
} from "../../aiAPIsHub";

export interface ChatAgentOptions {
  // Required
  model: LlmInfos;
  userMessage: string;

  // Conversation state
  conversationHistory?: string[];
  conversationSummary?: string;
  exchangesSinceLastSummary?: number;

  // Results context
  resultsContext?: any[];
  resultsDescription?: string;

  // Configuration
  style?: string;
  commandPrompt?: string;
  toolsEnabled?: boolean;
  enabledTools?: Set<string>; // List of enabled tool names
  accessMode?: "Balanced" | "Full Access";
  isAgentMode?: boolean;

  // Permissions
  permissions?: { contentAccess: boolean };

  // Streaming
  streamingCallback?: (content: string) => void;

  // Tool usage callback
  toolUsageCallback?: (toolInfo: {
    toolName: string;
    args?: Record<string, any>;
  }) => void;

  // Tool response callback
  toolResponseCallback?: (toolInfo: {
    toolName: string;
    response: string;
  }) => void;

  // Agent callbacks
  addResultsCallback?: (results: any[]) => void;
  selectResultsCallback?: (uids: string[]) => void;
  expandedResultsCallback?: (currentResults: any[]) => Promise<any[]>;

  // Token usage tracking
  tokensUsage?: TokensUsage;

  // Active skill instructions (persists across turns)
  activeSkillInstructions?: string;

  // Tool results cache (for deduplication across turns)
  toolResultsCache?: Record<string, any>;

  // Previous state for continuation
  previousState?: Partial<ChatAgentStateType>;
}

export interface ChatAgentResult {
  // Response
  finalAnswer: string;

  // Updated conversation state
  conversationHistory: string[];
  conversationSummary?: string;
  exchangesSinceLastSummary: number;

  // Tool results cache
  toolResultsCache: Record<string, any>;

  // Active skill instructions (to persist for next turn)
  activeSkillInstructions?: string;

  // Token usage (cumulative across the conversation)
  tokensUsage: TokensUsage;

  // Timing
  duration: number;
}

/**
 * Invoke the chat agent
 */
export async function invokeChatAgent(
  options: ChatAgentOptions
): Promise<ChatAgentResult> {
  const startTime = Date.now();

  // Create the graph
  const graph = createChatGraph();

  let userMessage = [{ role: "user", content: options.userMessage }];
  if (isModelSupportingImage(options.model.id)) {
    const stringifiedHistory = JSON.stringify(options.conversationHistory);
    console.log("stringifiedHistory :>> ", stringifiedHistory);
    const messagesWithImage = await addImagesUrlToMessages(
      [undefined, userMessage[0]],
      stringifiedHistory
    );
    userMessage = messagesWithImage.slice(1);
  }

  console.log("userMessage :>> ", userMessage);
  const hMessage = userMessage.map((msg) => new HumanMessage(msg));
  console.log("hMessage :>> ", hMessage);
  // Build initial state
  const initialState: Partial<ChatAgentStateType> = {
    // Model
    model: options.model,

    // Messages
    messages: hMessage,

    // Configuration
    style: options.style,
    commandPrompt: options.commandPrompt,
    toolsEnabled: options.toolsEnabled ?? true,
    enabledTools: options.enabledTools,
    accessMode: options.accessMode || "Balanced",
    isAgentMode: options.isAgentMode ?? false,

    // Permissions
    permissions: options.permissions || { contentAccess: false },

    // Conversation state
    conversationHistory: options.conversationHistory || [],
    conversationSummary: options.conversationSummary,
    exchangesSinceLastSummary: options.exchangesSinceLastSummary || 0,

    // Results context
    resultsContext: options.resultsContext,
    resultsDescription: options.resultsDescription,

    // Streaming
    streamingCallback: options.streamingCallback,

    // Tool usage callback
    toolUsageCallback: options.toolUsageCallback,

    // Tool response callback
    toolResponseCallback: options.toolResponseCallback,

    // Agent callbacks
    addResultsCallback: options.addResultsCallback,
    selectResultsCallback: options.selectResultsCallback,
    expandedResultsCallback: options.expandedResultsCallback,
    needsExpansion: false,

    // Timing
    startTime,

    // Token usage (pass existing usage to be accumulated)
    tokensUsage: options.tokensUsage || { input_tokens: 0, output_tokens: 0 },

    // Active skill instructions
    activeSkillInstructions: options.activeSkillInstructions,

    // Tool results cache (use provided cache or start fresh)
    toolResultsCache: options.toolResultsCache || {},

    // Invalid tool call retry counter (start at 0)
    invalidToolCallRetries: 0,

    // Merge previous state if provided
    ...(options.previousState || {}),
  };

  // Invoke the graph
  const result = await graph.invoke(initialState);

  const duration = Date.now() - startTime;

  // Extract and return results - tokensUsage is now returned from the graph
  return {
    finalAnswer: result.finalAnswer || "",
    conversationHistory: result.conversationHistory || [],
    conversationSummary: result.conversationSummary,
    exchangesSinceLastSummary: result.exchangesSinceLastSummary || 0,
    toolResultsCache: result.toolResultsCache || {},
    activeSkillInstructions: result.activeSkillInstructions,
    tokensUsage: result.tokensUsage || { input_tokens: 0, output_tokens: 0 },
    duration,
  };
}

/**
 * Helper to create a chat agent invocation with sensible defaults
 */
export function createChatInvocation(
  model: LlmInfos,
  userMessage: string
): ChatAgentOptions {
  return {
    model,
    userMessage,
    toolsEnabled: true,
    accessMode: "Balanced",
    permissions: { contentAccess: false },
  };
}
