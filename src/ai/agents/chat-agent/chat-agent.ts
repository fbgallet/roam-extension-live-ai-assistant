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
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { concat } from "@langchain/core/utils/stream";
import {
  LlmInfos,
  modelViaLanggraph,
  TokensUsage,
} from "../langraphModelsLoader";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import {
  buildChatSystemPrompt,
  buildCompleteCommandPrompt,
  buildConversationContext,
  buildResultsContext,
  SUMMARIZATION_PROMPT,
} from "./chat-agent-prompts";
import { getChatTools } from "./chat-tools";

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
  enabledTools: Annotation<Set<string> | undefined>,
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
  // Tool usage callback
  toolUsageCallback: Annotation<((toolName: string) => void) | undefined>,
  // Agent callbacks
  addResultsCallback: Annotation<((results: any[]) => void) | undefined>,
  selectResultsCallback: Annotation<((uids: string[]) => void) | undefined>,
  // Timing
  startTime: Annotation<number>,
  // Tool results cache
  toolResultsCache: Annotation<Record<string, any>>,
  // Active skill instructions (replaces previous when new skill is loaded)
  activeSkillInstructions: Annotation<string | undefined>,
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
  const chatTools = getChatTools(
    state.toolsEnabled,
    state.permissions,
    state.enabledTools
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
  let lastMessage = state.messages?.at(-1)?.content?.toString() || "";

  let isConversationContextToInclude = lastMessage || resultsContext;
  if (state.commandPrompt && state.conversationHistory.length) {
    let completedLastMessage = buildCompleteCommandPrompt(
      state.commandPrompt,
      lastMessage || resultsContext || conversationContext
    );
    state.messages.pop();
    state.messages.push(new HumanMessage(completedLastMessage));
  }

  // Build system prompt - NOTE: Don't include tool descriptions
  // LangChain's bindTools() handles tool schemas automatically via the API
  const systemPrompt = buildChatSystemPrompt({
    lastMessage: lastMessage,
    style: state.style,
    // Add command prompt to system prompt only for the first message
    commandPrompt: state.conversationHistory?.length < 2 && state.commandPrompt,
    toolsEnabled: state.toolsEnabled,
    conversationContext: isConversationContextToInclude && conversationContext,
    resultsContext,
    accessMode: state.accessMode,
    isAgentMode: state.isAgentMode,
    activeSkillInstructions: state.activeSkillInstructions,
    enabledTools: state.enabledTools,
  });

  console.log("systemPrompt :>> ", systemPrompt);

  sys_msg = new SystemMessage({ content: systemPrompt });

  return {
    messages: state.messages,
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
  const prompt = SUMMARIZATION_PROMPT.replace(
    "{conversation}",
    conversationText
  );

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
    console.log(
      "messages :>> ",
      messages.map((msg) => msg.content)
    );
    console.log("state.conversationHistory :>> ", state.conversationHistory);
    // Stream the response - use concat to properly accumulate tool call chunks
    const stream = await llm_with_tools.stream(messages);
    let gathered: any = undefined;

    for await (const chunk of stream) {
      // console.log("chunk :>> ", chunk);
      // Use concat to properly merge chunks including tool_call_chunks
      gathered = gathered !== undefined ? concat(gathered, chunk) : chunk;

      // Stream content to callback as it arrives
      if (chunk.content) {
        // Handle different content types from different providers
        let textContent = "";

        if (typeof chunk.content === "string") {
          // OpenAI and most providers send plain strings
          textContent = chunk.content;
        } else if (Array.isArray(chunk.content)) {
          // Anthropic/Gemini may send arrays with text and/or function calls
          // Extract only text content, ignore function calls for streaming
          textContent = chunk.content
            .filter((item: any) => typeof item === "string")
            .join("");
        }

        if (textContent) {
          streamingContent += textContent;
          streamCallback(textContent);
        }
      }
    }

    // Check for tool calls and notify via callback
    if (
      state.toolUsageCallback &&
      gathered &&
      gathered.tool_calls &&
      gathered.tool_calls.length > 0
    ) {
      const firstToolCall = gathered.tool_calls[0];
      if (firstToolCall && firstToolCall.name) {
        state.toolUsageCallback(firstToolCall.name);
      }
    }

    console.log("gathered :>> ", gathered);

    // Return the gathered message (which has proper tool_calls)
    return {
      messages: [...state.messages, gathered],
    };
  } else {
    // Non-streaming response
    const response = await llm_with_tools.invoke(messages);

    // Check for tool calls and notify via callback
    if (
      state.toolUsageCallback &&
      "tool_calls" in response &&
      Array.isArray(response.tool_calls) &&
      response.tool_calls?.length > 0
    ) {
      // Notify about the first tool being used
      const firstToolCall = response.tool_calls[0];
      if (firstToolCall && firstToolCall.name) {
        state.toolUsageCallback(firstToolCall.name);
      }
    }

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

  // Pass configuration to tools via the config parameter
  const config = {
    configurable: {
      currentResultsContext: state.resultsContext || [],
      addResultsCallback: state.addResultsCallback,
      selectResultsCallback: state.selectResultsCallback,
      model: state.model, // Pass model info so tools can reuse the same LLM
      llm: llm, // Pass the initialized LLM instance directly
      toolResultsCache: state.toolResultsCache || {}, // Pass cache for tool result deduplication
    },
  };

  const result = await toolNode.invoke(state, config);

  // Cache tool results
  const toolMessages = result.messages.filter(
    (msg: any) => msg.getType?.() === "tool" || msg._getType?.() === "tool"
  );
  const updatedCache = { ...state.toolResultsCache };

  // Extract skill instructions if the skill tool was called
  let newActiveSkillInstructions = state.activeSkillInstructions;

  toolMessages.forEach((msg: any) => {
    if (msg.tool_call_id && msg.content) {
      updatedCache[msg.tool_call_id] = {
        content: msg.content,
        timestamp: Date.now(),
        tool_name: msg.name,
      };

      // If this is the skill tool, extract and store its instructions
      if (msg.name === "live_ai_skills" && msg.content) {
        console.log("📚 Skill tool called, storing active instructions");
        newActiveSkillInstructions = msg.content;
      }
    }
  });

  return {
    ...result,
    toolResultsCache: updatedCache,
    activeSkillInstructions: newActiveSkillInstructions,
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
    // Preserve state that should persist across turns
    activeSkillInstructions: state.activeSkillInstructions,
    toolResultsCache: state.toolResultsCache,
  };
};

// Edges

/**
 * Decide whether to continue to tools or finalize
 */
const shouldContinue = (state: typeof ChatAgentState.State) => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];

  const hasToolCalls =
    "tool_calls" in lastMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls?.length > 0;

  if (hasToolCalls) {
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
