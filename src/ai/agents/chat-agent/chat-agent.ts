/**
 * Chat Agent - LangGraph ReAct Agent
 *
 * A dedicated chat agent for handling conversational interactions with support for:
 * - Style formatting
 * - Built-in commands (prompts)
 * - Optional tool usage
 * - Conversation state management
 * - Streaming responses
 * - Search results context
 */

import {
  MessagesAnnotation,
  StateGraph,
  START,
  Annotation,
} from "@langchain/langgraph/web";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  LlmInfos,
  modelViaLanggraph,
  TokensUsage,
} from "../langraphModelsLoader";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import {
  buildChatSystemPrompt,
  buildConversationContext,
  buildResultsContext,
  SUMMARIZATION_PROMPT,
} from "./chat-agent-prompts";
import { getChatTools, getChatToolDescriptions } from "./chat-tools";

// Chat Agent State
const ChatAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  // Model configuration
  model: Annotation<LlmInfos>,
  // Response formatting
  style: Annotation<string | undefined>,
  // Command/prompt context
  commandPrompt: Annotation<string | undefined>,
  // Tool control
  toolsEnabled: Annotation<boolean>,
  permissions: Annotation<{ contentAccess: boolean }>,
  chatTools: Annotation<any[]>,
  // Conversation state
  conversationHistory: Annotation<string[] | undefined>,
  conversationSummary: Annotation<string | undefined>,
  exchangesSinceLastSummary: Annotation<number>,
  // Results context
  resultsContext: Annotation<any[] | undefined>,
  resultsDescription: Annotation<string | undefined>,
  // Access mode
  accessMode: Annotation<"Balanced" | "Full Access">,
  // Agent mode (enables deep analysis features)
  isAgentMode: Annotation<boolean>,
  // Streaming
  streamingCallback: Annotation<((content: string) => void) | undefined>,
  // Timing
  startTime: Annotation<number>,
  // Tool results cache
  toolResultsCache: Annotation<Record<string, any>>,
  // Response tracking
  finalAnswer: Annotation<string | undefined>,
  // Token usage tracking
  tokensUsage: Annotation<TokensUsage>,
});

// Module-level variables
let llm: StructuredOutputType;
let turnTokensUsage: TokensUsage;
let sys_msg: SystemMessage;

// Conversation summarization threshold
const SUMMARIZATION_THRESHOLD = 10;

// Nodes

/**
 * Load model and prepare tools based on configuration
 */
const loadModel = async (state: typeof ChatAgentState.State) => {
  const startTime = state.startTime || Date.now();

  // Initialize token usage tracking
  turnTokensUsage = state.tokensUsage || { input_tokens: 0, output_tokens: 0 };

  llm = modelViaLanggraph(state.model, turnTokensUsage);

  // Get tools based on permissions and tool enablement
  const chatTools = getChatTools(state.toolsEnabled, state.permissions);

  // Build tool descriptions for system prompt
  const toolDescriptions = getChatToolDescriptions(
    state.toolsEnabled,
    state.permissions
  );

  // Build conversation context
  const conversationContext = buildConversationContext(
    state.conversationHistory,
    state.conversationSummary
  );

  // Build results context
  const resultsContext = state.resultsContext
    ? buildResultsContext(state.resultsContext, state.resultsDescription)
    : undefined;

  // Build system prompt
  const systemPrompt = buildChatSystemPrompt({
    style: state.style,
    commandPrompt: state.commandPrompt,
    toolsEnabled: state.toolsEnabled,
    toolDescriptions,
    conversationContext,
    resultsContext,
    accessMode: state.accessMode,
    isAgentMode: state.isAgentMode,
  });

  sys_msg = new SystemMessage({ content: systemPrompt });

  return {
    chatTools,
    startTime,
  };
};

/**
 * Check if conversation needs summarization
 */
const shouldSummarize = (state: typeof ChatAgentState.State): boolean => {
  return (
    state.exchangesSinceLastSummary >= SUMMARIZATION_THRESHOLD &&
    state.conversationHistory &&
    state.conversationHistory.length > 0
  );
};

/**
 * Summarize conversation to reduce token usage
 */
const summarizeConversation = async (state: typeof ChatAgentState.State) => {
  if (!shouldSummarize(state)) {
    return {};
  }

  const conversationText = state.conversationHistory?.join("\n\n") || "";
  const prompt = SUMMARIZATION_PROMPT.replace("{conversation}", conversationText);

  const response = await llm.invoke([new HumanMessage({ content: prompt })]);
  const summary = response.content.toString();

  return {
    conversationSummary: summary,
    exchangesSinceLastSummary: 0,
    // Clear old conversation history after summarization
    conversationHistory: [],
  };
};

/**
 * Assistant node - generates response with optional tool calls
 */
const assistant = async (state: typeof ChatAgentState.State) => {
  const messages = [sys_msg, ...state.messages];

  // Bind tools if enabled
  const llm_with_tools = state.toolsEnabled
    ? llm.bindTools(state.chatTools)
    : llm;

  // Streaming setup
  let streamingContent = "";
  const streamCallback = state.streamingCallback;

  if (streamCallback) {
    // Stream the response
    const stream = await llm_with_tools.stream(messages);

    for await (const chunk of stream) {
      if (chunk.content) {
        const content = chunk.content.toString();
        streamingContent += content;
        streamCallback(content);
      }
    }

    // Create final response message as proper AIMessage
    const response = new AIMessage({
      content: streamingContent,
    });

    return {
      messages: [...state.messages, response],
    };
  } else {
    // Non-streaming response
    const response = await llm_with_tools.invoke(messages);

    return {
      messages: [...state.messages, response],
    };
  }
};

/**
 * Tools node with caching
 */
const toolsWithCaching = async (state: typeof ChatAgentState.State) => {
  const toolNode = new ToolNode(state.chatTools);
  const result = await toolNode.invoke(state);

  // Cache tool results
  const toolMessages = result.messages.filter(
    (msg: any) => msg.getType?.() === "tool" || msg._getType?.() === "tool"
  );
  const updatedCache = { ...state.toolResultsCache };

  toolMessages.forEach((msg: any) => {
    if (msg.tool_call_id && msg.content) {
      updatedCache[msg.tool_call_id] = {
        content: msg.content,
        timestamp: Date.now(),
        tool_name: msg.name,
      };
    }
  });

  return {
    ...result,
    toolResultsCache: updatedCache,
  };
};

/**
 * Extract final answer and update conversation history
 */
const finalize = async (state: typeof ChatAgentState.State) => {
  const lastMessage = state.messages.at(-1);
  const finalAnswer = lastMessage?.content?.toString() || "";

  // Update conversation history
  const newHistory = [...(state.conversationHistory || [])];

  // Add user message
  const userMessage = state.messages.find(
    (msg) => msg.getType?.() === "human" || msg._getType?.() === "human"
  );
  if (userMessage) {
    newHistory.push(`User: ${userMessage.content}`);
  }

  // Add assistant response
  newHistory.push(`Assistant: ${finalAnswer}`);

  return {
    finalAnswer,
    conversationHistory: newHistory,
    exchangesSinceLastSummary: (state.exchangesSinceLastSummary || 0) + 1,
    tokensUsage: turnTokensUsage,
  };
};

// Edges

/**
 * Decide whether to continue to tools or finalize
 */
const shouldContinue = (state: typeof ChatAgentState.State) => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];

  if (
    "tool_calls" in lastMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls?.length > 0
  ) {
    return "tools";
  }

  return "finalize";
};

/**
 * Check if summarization is needed before assistant
 */
const checkSummarization = (state: typeof ChatAgentState.State) => {
  if (shouldSummarize(state)) {
    return "summarizeConversation";
  }
  return "assistant";
};

// Build Graph

/**
 * Create the chat agent graph
 */
export const createChatGraph = () => {
  const builder = new StateGraph(ChatAgentState);

  builder
    .addNode("loadModel", loadModel)
    .addNode("summarizeConversation", summarizeConversation)
    .addNode("assistant", assistant)
    .addNode("tools", toolsWithCaching)
    .addNode("finalize", finalize)

    .addEdge(START, "loadModel")
    .addConditionalEdges("loadModel", checkSummarization)
    .addEdge("summarizeConversation", "assistant")
    .addConditionalEdges("assistant", shouldContinue)
    .addEdge("tools", "assistant")
    .addEdge("finalize", "__end__");

  return builder.compile();
};

/**
 * Export state type for external use
 */
export type ChatAgentStateType = typeof ChatAgentState.State;
