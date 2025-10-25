/**
 * Chat Agent Invocation Wrapper
 *
 * Provides a simple interface for invoking the chat agent
 */

import { HumanMessage } from "@langchain/core/messages";
import { createChatGraph, ChatAgentStateType } from "./chat-agent";
import { LlmInfos, TokensUsage } from "../langraphModelsLoader";

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
  accessMode?: "Balanced" | "Full Access";
  isAgentMode?: boolean;

  // Permissions
  permissions?: { contentAccess: boolean };

  // Streaming
  streamingCallback?: (content: string) => void;

  // Tool usage callback
  toolUsageCallback?: (toolName: string) => void;

  // Agent callbacks
  addResultsCallback?: (results: any[]) => void;
  selectResultsCallback?: (uids: string[]) => void;

  // Token usage tracking
  tokensUsage?: TokensUsage;

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

  // Build initial state
  const initialState: Partial<ChatAgentStateType> = {
    // Model
    model: options.model,

    // Messages
    messages: [new HumanMessage({ content: options.userMessage })],

    // Configuration
    style: options.style,
    commandPrompt: options.commandPrompt,
    toolsEnabled: options.toolsEnabled ?? true,
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

    // Agent callbacks
    addResultsCallback: options.addResultsCallback,
    selectResultsCallback: options.selectResultsCallback,

    // Timing
    startTime,

    // Token usage (pass existing usage to be accumulated)
    tokensUsage: options.tokensUsage || { input_tokens: 0, output_tokens: 0 },

    // Tool results cache
    toolResultsCache: {},

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
