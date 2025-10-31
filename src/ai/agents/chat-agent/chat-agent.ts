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
import {
  SystemMessage,
  HumanMessage,
  ToolMessage,
  AIMessage,
  RemoveMessage,
} from "@langchain/core/messages";
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
import { imageGeneration } from "../../aiAPIsHub";

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
  toolUsageCallback: Annotation<
    | ((toolInfo: { toolName: string; args?: Record<string, any> }) => void)
    | undefined
  >,
  // Agent callbacks
  addResultsCallback: Annotation<((results: any[]) => void) | undefined>,
  selectResultsCallback: Annotation<((uids: string[]) => void) | undefined>,
  expandedResultsCallback: Annotation<
    ((currentResults: any[]) => Promise<any[]>) | undefined
  >,
  toolResponseCallback: Annotation<
    ((toolInfo: { toolName: string; response: string }) => void) | undefined
  >,
  needsExpansion: Annotation<boolean>,
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
  // Invalid tool call retry counter
  invalidToolCallRetries: Annotation<number>,
});

// Module-level variables
let llm: StructuredOutputType;
let turnTokensUsage: TokensUsage;
let sys_msg: SystemMessage;
let originalUserMessageForHistory: string;

// Conversation summarization threshold
const SUMMARIZATION_THRESHOLD = 20;

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

  // Store original message for history tracking before modification
  originalUserMessageForHistory = lastMessage;

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
    // Command prompt is included in system prompt and also added to conversationHistory
    // in finalize() so it persists across turns until summarization
    commandPrompt: state.commandPrompt,
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
  let gathered: any = undefined;

  if (state.commandPrompt?.slice(0, 16) === "Image generation") {
    const imageLink = await imageGeneration(
      state.messages.at(-1).content,
      state.commandPrompt?.split("(")[1].split(")")[0],
      state.model.id,
      (t: any) => {
        turnTokensUsage = { ...t };
      }
    );

    return { messages: [...state.messages, new AIMessage(imageLink)] };
  }

  // Bind tools if enabled
  const llm_with_tools = state.toolsEnabled
    ? llm.bindTools(state.chatTools)
    : llm;

  // Streaming setup
  let streamingContent = "";
  const streamCallback = state.streamingCallback;

  // Workaround: Disable streaming for Gemini models due to tool call parsing issues
  const isGeminiModel = state.model.id.toLowerCase().includes("gemini");
  const shouldStream =
    streamCallback && (!isGeminiModel || !state.toolsEnabled);

  if (isGeminiModel && streamCallback) {
    console.log(
      "⚠️ Streaming disabled for Gemini model to avoid tool call issues"
    );
  }

  if (shouldStream) {
    // Stream the response - use concat to properly accumulate tool call chunks
    const stream = await llm_with_tools.stream(messages);

    for await (const chunk of stream) {
      // console.log("chunk :>> ", chunk);
      // Use concat to properly merge chunks including tool_call_chunks
      gathered = gathered !== undefined ? concat(gathered, chunk) : chunk;

      // Capture token usage from streaming chunks (Anthropic sends this in first chunk)
      if (chunk.usage_metadata) {
        if (chunk.usage_metadata.input_tokens) {
          turnTokensUsage.input_tokens = chunk.usage_metadata.input_tokens;
        }
        if (chunk.usage_metadata.output_tokens) {
          turnTokensUsage.output_tokens = chunk.usage_metadata.output_tokens;
        }
      }

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
            .map((item: any) => {
              if (typeof item === "string") {
                return item;
              } else if (item?.type === "text" && item?.text) {
                // Handle Anthropic's {type: "text", text: "..."} format
                return item.text;
              }
              return "";
            })
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
        state.toolUsageCallback({
          toolName: firstToolCall.name,
          args: firstToolCall.args,
        });
      }
    }

    // Return the gathered message (which has proper tool_calls)
    return {
      messages: [...state.messages, gathered],
    };
  } else {
    // Non-streaming response
    const response = await llm_with_tools.invoke(messages);

    // Capture token usage from response (Anthropic sends usage_metadata)
    if (response.usage_metadata) {
      if (response.usage_metadata.input_tokens) {
        turnTokensUsage.input_tokens = response.usage_metadata.input_tokens;
      }
      if (response.usage_metadata.output_tokens) {
        turnTokensUsage.output_tokens = response.usage_metadata.output_tokens;
      }
    }

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
        state.toolUsageCallback({
          toolName: firstToolCall.name,
          args: firstToolCall.args,
        });
      }
    }

    return {
      messages: [...state.messages, response],
    };
  }
};

/**
 * Handle invalid tool calls by creating error messages for the assistant
 */
const handleInvalidToolCalls = async (state: typeof ChatAgentState.State) => {
  const lastMessage: any = state.messages.at(-1);
  const invalidToolCalls = lastMessage?.invalid_tool_calls || [];
  const retries = state.invalidToolCallRetries || 0;

  console.log("🚨 Invalid tool calls detected:", invalidToolCalls);
  console.log(`Retry attempt: ${retries + 1}/3`);
  // console.log("Last message:", lastMessage);

  // We need to remove the problematic message with invalid_tool_calls
  // LangGraph's MessagesAnnotation uses a reducer, so we can:
  // 1. Use RemoveMessage to delete the bad message by ID
  // 2. Add new clean messages

  // Get the message ID for removal
  const badMessageId = lastMessage?.id;

  // First, extract any valid text content from the bad message to preserve it
  let preservedContent: AIMessage | null = null;
  if (lastMessage?.content) {
    const textContent = extractTextContent(lastMessage.content);
    if (textContent.trim()) {
      preservedContent = new AIMessage({ content: textContent });
    }
  }

  // Build the list of messages to add
  const messagesToAdd: any[] = [];

  // Remove the bad message if it has an ID
  if (badMessageId) {
    messagesToAdd.push(new RemoveMessage({ id: badMessageId }));
  }

  // Add preserved content if any
  if (preservedContent) {
    messagesToAdd.push(preservedContent);
  }

  // Maximum 3 retries
  const MAX_RETRIES = 3;

  // If we've exceeded max retries, provide a helpful error message and finalize
  if (retries >= MAX_RETRIES) {
    console.log("❌ Max retries exceeded for invalid tool calls");
    const errorSummary = invalidToolCalls
      .map((call: any) => `- ${call.name}: ${call.error}`)
      .join("\n");

    // Create an AI message explaining the failure
    const finalErrorMessage = new AIMessage({
      content: `I apologize, but I'm having trouble calling the tools correctly. After ${MAX_RETRIES} attempts, I encountered these errors:

${errorSummary}

This might be due to the model's limitations with tool calling. Please try:
1. Rephrasing your question more simply
2. Using a more capable model
3. Or ask me without requiring tool usage`,
    });

    messagesToAdd.push(finalErrorMessage);

    return {
      messages: messagesToAdd,
      invalidToolCallRetries: 0, // Reset for next turn
    };
  }

  // Create error messages for each invalid tool call with guidance
  const errorMessages = invalidToolCalls.map(
    (invalidCall: any, index: number) => {
      // Generate a unique tool_call_id if not provided
      const toolCallId = invalidCall.id || `invalid_${Date.now()}_${index}`;

      const errorText = `Tool call error for "${invalidCall.name}":
- Error: ${invalidCall.error}
- Args received: ${
        typeof invalidCall.args === "string"
          ? invalidCall.args
          : JSON.stringify(invalidCall.args)
      }
- Tool call ID: ${toolCallId}

Please review the tool's parameter schema and try again with valid arguments. This is retry ${
        retries + 1
      }/${MAX_RETRIES}.`;

      // Create a proper ToolMessage for LangGraph
      return new ToolMessage({
        content: errorText,
        tool_call_id: toolCallId,
        name: invalidCall.name || "unknown_tool",
      });
    }
  );

  // Add the error messages to the list
  messagesToAdd.push(...errorMessages);

  // Return all messages: RemoveMessage + preserved content + error messages
  // This prevents serialization errors with providers like Gemini
  return {
    messages: messagesToAdd,
    invalidToolCallRetries: retries + 1,
  };
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
      expandedResultsCallback: state.expandedResultsCallback,
      needsExpansion: state.needsExpansion || false,
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

  // Track if any tools that add results were called
  let needsExpansion = false;
  const resultsAddingTools = [
    "add_linked_references_by_title",
    "add_pages_by_title",
    "ask_your_graph",
  ];

  toolMessages.forEach((msg: any) => {
    if (msg.tool_call_id && msg.content) {
      updatedCache[msg.tool_call_id] = {
        content: msg.content,
        timestamp: Date.now(),
        tool_name: msg.name,
      };

      // Check if this tool adds results to context
      if (resultsAddingTools.includes(msg.name)) {
        needsExpansion = true;
      }

      // If this is the skill tool, extract and store its instructions
      if (msg.name === "live_ai_skills" && msg.content) {
        newActiveSkillInstructions = msg.content;
      }

      // Call toolResponseCallback to capture tool's response for UI display
      if (state.toolResponseCallback) {
        state.toolResponseCallback({
          toolName: msg.name,
          response: msg.content,
        });
      }
    }
  });

  // If tools added results, trigger expansion in parent component
  // and update the resultsContext with the newly expanded results
  let updatedResultsContext = state.resultsContext;
  let shouldRebuildSystemPrompt = false;

  if (needsExpansion && state.expandedResultsCallback) {
    try {
      // Pass the original results context - the callback tracks additions via ref
      updatedResultsContext = await state.expandedResultsCallback(
        state.resultsContext || []
      );
      console.log(
        `✅ [Chat Agent] Context expanded, now has ${updatedResultsContext.length} results`
      );
      shouldRebuildSystemPrompt = true;
    } catch (error) {
      console.error("❌ [Chat Agent] Failed to expand context:", error);
    }
  }

  // Rebuild system prompt if context was expanded
  if (shouldRebuildSystemPrompt && updatedResultsContext) {
    // Build conversation context
    const conversationContext = buildConversationContext(
      state.conversationHistory,
      state.conversationSummary
    );

    // Build results context with expanded results
    const resultsContextString = buildResultsContext(
      updatedResultsContext,
      state.resultsDescription
    );

    // Rebuild system prompt
    const systemPrompt = buildChatSystemPrompt({
      lastMessage: state.messages?.at(-1)?.content?.toString() || "",
      style: state.style,
      commandPrompt: state.commandPrompt,
      toolsEnabled: state.toolsEnabled,
      conversationContext: conversationContext,
      resultsContext: resultsContextString,
      accessMode: state.accessMode,
      isAgentMode: state.isAgentMode,
      activeSkillInstructions: newActiveSkillInstructions,
      enabledTools: state.enabledTools,
    });

    sys_msg = new SystemMessage({ content: systemPrompt });
  }

  return {
    ...result,
    resultsContext: updatedResultsContext,
    toolResultsCache: updatedCache,
    activeSkillInstructions: newActiveSkillInstructions,
    needsExpansion: needsExpansion,
    // Reset invalid tool call counter after successful tool execution
    invalidToolCallRetries: 0,
  };
};

/**
 * Helper function to extract text content from message content
 * Handles different formats from different providers
 */
const extractTextContent = (content: any): string => {
  if (!content) return "";

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    // Anthropic/Gemini format: array of objects/strings
    return content
      .map((item: any) => {
        if (typeof item === "string") {
          return item;
        } else if (item?.type === "text" && item?.text) {
          // Handle {type: "text", text: "..."} format
          return item.text;
        }
        // Ignore tool_use and other non-text items
        return "";
      })
      .join("");
  }

  // Fallback to toString for unexpected formats
  return String(content);
};

/**
 * Extract final answer and update conversation history
 */
const finalize = async (state: typeof ChatAgentState.State) => {
  const lastMessage = state.messages.at(-1);
  const finalAnswer = extractTextContent(lastMessage?.content);

  // Update conversation history
  const newHistory = [...(state.conversationHistory || [])];

  // If a commandPrompt was used in this turn, add the detailed instructions to history
  // This ensures they persist across turns until summarization
  if (state.commandPrompt) {
    // Use the original user message (before it was potentially modified in loadModel)
    const expandedCommandPrompt = buildCompleteCommandPrompt(
      state.commandPrompt,
      originalUserMessageForHistory
    );
    if (expandedCommandPrompt) {
      newHistory.push(
        `[User's Task Instructions for this request]: ${expandedCommandPrompt}`
      );
    }
  }

  // Add user message
  const userMessage = state.messages.find(
    (msg) => msg.getType?.() === "human" || msg._getType?.() === "human"
  );
  if (userMessage) {
    newHistory.push(`User: ${userMessage.content}`);
  }

  // Add assistant response
  newHistory.push(`Assistant: ${finalAnswer}`);

  console.log("newHistory :>> ", newHistory);

  return {
    finalAnswer,
    conversationHistory: newHistory,
    exchangesSinceLastSummary: (state.exchangesSinceLastSummary || 0) + 1,
    tokensUsage: turnTokensUsage,
    // Preserve state that should persist across turns
    activeSkillInstructions: state.activeSkillInstructions,
    toolResultsCache: state.toolResultsCache,
    // Reset retry counter for next turn
    invalidToolCallRetries: 0,
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

  // Check for invalid tool calls
  const hasInvalidToolCalls =
    "invalid_tool_calls" in lastMessage &&
    Array.isArray(lastMessage.invalid_tool_calls) &&
    lastMessage.invalid_tool_calls?.length > 0;

  if (hasToolCalls) {
    return "tools";
  }

  if (hasInvalidToolCalls) {
    return "handleInvalidToolCalls";
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

/**
 * Decide whether to retry or finalize after handling invalid tool calls
 */
const shouldRetryOrFinalize = (state: typeof ChatAgentState.State) => {
  const lastMessage: any = state.messages.at(-1);
  // Check if the last message is an error message (assistant role means max retries exceeded)
  const messageType = lastMessage?.getType?.() || lastMessage?._getType?.();
  if (messageType === "ai") {
    // AI/assistant message means we've hit max retries and created an error message
    return "finalize";
  }
  // Otherwise, retry with the assistant
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
    .addNode("handleInvalidToolCalls", handleInvalidToolCalls)
    .addNode("finalize", finalize)

    .addEdge(START, "loadModel")
    .addConditionalEdges("loadModel", checkSummarization)
    .addEdge("summarizeConversation", "assistant")
    .addConditionalEdges("assistant", shouldContinue)
    .addEdge("tools", "assistant")
    .addConditionalEdges("handleInvalidToolCalls", shouldRetryOrFinalize)
    .addEdge("finalize", "__end__");

  return builder.compile();
};

/**
 * Export state type for external use
 */
export type ChatAgentStateType = typeof ChatAgentState.State;
