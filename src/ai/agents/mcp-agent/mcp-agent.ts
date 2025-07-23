import {
  MessagesAnnotation,
  StateGraph,
  START,
  Annotation,
} from "@langchain/langgraph/web";
import { SystemMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
// import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import {
  LlmInfos,
  modelViaLanggraph,
  TokensUsage,
} from "../langraphModelsLoader";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import {
  createChildBlock,
  getParentBlock,
  isExistingBlock,
} from "../../../utils/roamAPI";
import { insertStructuredAIResponse } from "../../responseInsertion";
import { roamBasicsFormat, stylePrompts } from "../../prompts";
import { mcpManager } from "./mcpManager";
import { getFilteredMCPTools, createToolsForLLM } from "./mcp-tools";
import { chatRoles, getInstantAssistantRole } from "../../..";

const MCPAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  model: Annotation<LlmInfos>,
  rootUid: Annotation<string>,
  targetUid: Annotation<string>,
  userPrompt: Annotation<string>,
  style: Annotation<string>,
  serverId: Annotation<string>,
  serverName: Annotation<string>,
  preferredToolName: Annotation<string | undefined>,
  mcpTools: Annotation<any[]>,
  availableToolsForDynamic: Annotation<any[]>,
  mcpToasterStream: Annotation<HTMLElement | null>,
  // Conversation state
  toolResultsCache: Annotation<Record<string, any>>,
  conversationHistory: Annotation<string[]>,
  previousResponse: Annotation<string | undefined>,
  isConversationMode: Annotation<boolean>,
  // Timing
  startTime: Annotation<number>,
});

// LLM with bound tools
let llm: StructuredOutputType;
let turnTokensUsage: TokensUsage;
let sys_msg: SystemMessage;
let mcpTools: any[] = [];
let availableToolsForDynamic: any[] = [];

// System message template
const system_prompt_template = `You are an AI assistant with access to MCP (Model Context Protocol) server "<SERVER_NAME>".

<PREFERRED_TOOL_GUIDANCE>
Available tools:
<TOOL_DESCRIPTIONS>
<CONVERSATION_CONTEXT>
<CONVERSATION_OPTIMIZATION>
Instructions for formatting your response:
${roamBasicsFormat}
<RESPONSE_STYLE>

IMPORTANT TOOL USAGE:
- Use the available MCP tools (if needed) to gather information and perform tasks
- When tools return data with IDs, names, or identifiers, use the EXACT values for subsequent tool calls. For example, if a tool returns a profile with id: "abc-123" and name: "John", use the ID "abc-123" (not "John") when that ID is required by another tool
- Chain multiple tools together as needed to complete complex tasks
- Provide comprehensive responses that synthesize information from multiple tool calls
- If you need access to tools other than the preferred one, use the "request_tool_access" tool first

CRITICAL PARAMETER GUIDELINES:
- Always use exact parameter names as specified in the tool schema

Here is the user request: <USER_PROMPT>`;

// Nodes
const loadModel = async (state: typeof MCPAgentState.State) => {
  // Record start time if not already set
  const startTime = state.startTime || Date.now();

  llm = modelViaLanggraph(state.model, turnTokensUsage);

  // Load MCP tools using our existing browser-compatible MCP client
  const client = mcpManager.getClient(state.serverId);
  if (!client) {
    throw new Error(`MCP server ${state.serverName} not connected`);
  }

  // Get filtered MCP tools based on user preferences
  const mcpToolsList = getFilteredMCPTools(client, state.serverId);

  // Log original MCP tool schemas for debugging
  console.log("📋 Original MCP Tools from server:");
  mcpToolsList.forEach((tool) => {
    console.log(`\n  Tool: ${tool.name}`);
    console.log(`  Description: ${tool.description || "No description"}`);
    console.log(
      `  Original inputSchema:`,
      JSON.stringify(tool.inputSchema, null, 2)
    );
  });

  // Store available tools for dynamic loading
  availableToolsForDynamic = mcpToolsList;

  if (state.preferredToolName) {
    console.log(
      `Using "${state.preferredToolName}" from server "${state.serverName}"`
    );
  } else {
    console.log(
      `🔧 Found ${mcpToolsList.length} MCP tools from server "${state.serverName}"`
    );
  }
  mcpTools = createToolsForLLM(mcpToolsList, client, state.preferredToolName);

  // Build system prompt with tool information
  let toolDescriptions = "";
  let preferredToolGuidance = "";

  if (state.preferredToolName) {
    const preferredTool = mcpToolsList.find(
      (t: any) => t.name === state.preferredToolName
    );
    const otherTools = mcpToolsList.filter(
      (t: any) => t.name !== state.preferredToolName
    );

    if (preferredTool) {
      // Include detailed schema information for the preferred tool
      const schemaInfo = preferredTool.inputSchema
        ? `\n  Required parameters: ${JSON.stringify(
            preferredTool.inputSchema.required || []
          )}\n  Schema: ${JSON.stringify(
            preferredTool.inputSchema.properties,
            null,
            2
          )}`
        : "\n  No parameters required";

      toolDescriptions = `
**Preferred Tool:**
- ${preferredTool.name}: ${preferredTool.description}${schemaInfo}

**Other Available Tools:**
${otherTools.map((t: any) => `- ${t.name}`).join("\n")}

- request_tool_access: Get full access to any other tool by name
`;

      preferredToolGuidance = `PREFERRED TOOL GUIDANCE: The user wants to use the "${state.preferredToolName}" tool for this request. You MUST provide all required parameters when calling this tool. Start by attempting to use this tool with proper arguments, but feel free to use "request_tool_access" to get other tools if needed to complete the task effectively.\n`;
    }
  } else {
    toolDescriptions = mcpToolsList
      .map(
        (t: any) => `- ${t.name}${t.description ? `: ${t.description}` : ""}`
      )
      .join("\n");
    preferredToolGuidance = "";
  }

  // Build conversation context
  let conversationContext = "";
  let conversationOptimization = "";

  if (state.isConversationMode && state.previousResponse) {
    // Filter out error responses from cached results
    const validCachedResults = Object.entries(
      state.toolResultsCache || {}
    ).filter(
      ([_, result]: [string, any]) =>
        result.content && !result.content.toString().startsWith("Error:")
    );

    const cachedResultsText =
      validCachedResults.length > 0
        ? validCachedResults
            .map(([callId, result]: [string, any]) => {
              const contentStr = result.content.toString();
              const truncatedContent =
                contentStr.length > 50000 // Limit arbitrarily set at approximately 12,500 tokens (for English)
                  ? contentStr.substring(0, 50000) + "..."
                  : contentStr;
              return `\n- ${
                result.tool_name || "Unknown tool"
              } (${callId}): ${truncatedContent}`;
            })
            .join("")
        : "None";

    conversationContext = `
CONVERSATION CONTEXT:
Previous response: ${state.previousResponse}

Available cached tool results: ${cachedResultsText}

This is a follow-up question. Consider the previous context when responding.
`;
    conversationOptimization = `
CONVERSATION MODE OPTIMIZATION:
- In a conversation, if you have sufficient data from previous tool calls (provide above in the prompt), you should answer without making new tool calls
- Only make new tool calls if: 1) You need fresh/updated data, 2) The user is asking for something not covered by previous results, 3) You need to perform a new action
- When possible, reference and build upon previous responses and cached tool results
`;
  } else {
    conversationContext = "";
    conversationOptimization = "";
  }

  console.log("state.style :>> ", state.style);

  const systemPrompt = system_prompt_template
    .replace("<SERVER_NAME>", state.serverName)
    .replace(
      "<RESPONSE_STYLE>",
      state.style !== "Normal"
        ? "\nWrite your response following this style:\n" +
            stylePrompts[state.style]
        : ""
    )
    .replace("<PREFERRED_TOOL_GUIDANCE>", preferredToolGuidance)
    .replace("<TOOL_DESCRIPTIONS>", toolDescriptions)
    .replace("<CONVERSATION_CONTEXT>", conversationContext)
    .replace("<CONVERSATION_OPTIMIZATION>", conversationOptimization)
    .replace("<USER_PROMPT>", state.userPrompt);

  console.log("systemPrompt :>> ", systemPrompt);

  // Log tool schemas for debugging
  console.log("🔧 MCP Tools schemas:");
  mcpTools.forEach((tool) => {
    console.log(`\n  Tool: ${tool.name}`);
    console.log(`  Description: ${tool.description || "No description"}`);
    if (tool.schema && tool.schema._def) {
      const formatZodType = (zodType: any, indent: string = "    "): string => {
        const def = zodType._def;
        const isOptional = def.typeName === "ZodOptional";
        const innerType = isOptional ? def.innerType : zodType;
        const innerDef = innerType._def;
        const typeName =
          innerDef.typeName?.replace("Zod", "").toLowerCase() || "unknown";
        const description = innerType.description || "No description";

        if (typeName === "object" && innerDef.shape) {
          const shape = innerDef.shape();
          const objectFields = Object.entries(shape)
            .map(([key, nestedType]: [string, any]) => {
              const nestedDef = nestedType._def;
              const nestedIsOptional = nestedDef.typeName === "ZodOptional";
              const formattedType = formatZodType(
                nestedType,
                indent + "  "
              ).trim();
              return `${indent}  ${key}${
                nestedIsOptional ? "?" : ""
              }: ${formattedType}`;
            })
            .join("\n");
          return `object {\n${objectFields}\n${indent}}`;
        } else if (typeName === "array" && innerDef.type) {
          const arrayType = formatZodType(innerDef.type, indent).trim();
          return `array<${arrayType}> - ${description}`;
        } else if (typeName === "enum" && innerDef.values) {
          const enumValues = innerDef.values.join(" | ");
          return `enum(${enumValues}) - ${description}`;
        } else {
          return `${typeName} - ${description}`;
        }
      };

      const shape = tool.schema._def.shape();
      const schemaInfo = Object.entries(shape).map(
        ([key, zodType]: [string, any]) => {
          const def = zodType._def;
          const isOptional = def.typeName === "ZodOptional";
          const formatted = formatZodType(zodType);
          return `    ${key}${isOptional ? "?" : ""}: ${formatted}`;
        }
      );
      console.log(`  Schema:\n${schemaInfo.join("\n")}`);
    } else {
      console.log(`  Schema: No schema available`);
    }
  });

  sys_msg = new SystemMessage({ content: systemPrompt });

  return {
    mcpTools: mcpTools,
    availableToolsForDynamic: availableToolsForDynamic,
    startTime: startTime,
  };
};

const assistant = async (state: typeof MCPAgentState.State) => {
  const llm_with_tools = llm.bindTools(state.mcpTools);

  const messages = [sys_msg, ...state.messages];

  const currentToaster =
    window.mcpToasterStreamElement ||
    document.querySelector(".mcp-toaster .bp3-toast-message");
  if (currentToaster) {
    currentToaster.innerText += `\n🤖 LLM thinking...`;
  }

  const llmStartTime = Date.now();
  const response = await llm_with_tools.invoke(messages);
  const llmDuration = ((Date.now() - llmStartTime) / 1000).toFixed(1);

  console.log(`🤖 [LLM RESPONSE] Response type: ${response.constructor.name}`);
  console.log(`🤖 [LLM CONTENT] Response content:`, response.content);

  if ("tool_calls" in response && response.tool_calls) {
    const toolCallNb = response.tool_calls.length;
    const toolCallsMsg = `\n🎯 LLM ${
      toolCallNb ? "decided to call tool" : "generated the final answer"
    } (${llmDuration}s)`;
    if (currentToaster) {
      currentToaster.innerText += toolCallsMsg;
    }
  } else {
    if (currentToaster) {
      currentToaster.innerText += `\n✅ LLM provided final answer (${llmDuration}s)`;
    }
    console.log(
      `🤖 [LLM NO_TOOLS] LLM provided final answer without tools in ${llmDuration}s`
    );
  }

  return {
    messages: [...state.messages, response],
  };
};

const insertResponse = async (state: typeof MCPAgentState.State) => {
  const lastMessage: string = state.messages.at(-1).content.toString();

  // Calculate and display total execution time
  if (state.startTime) {
    const totalDuration = ((Date.now() - state.startTime) / 1000).toFixed(1);
    const currentToaster =
      window.mcpToasterStreamElement ||
      document.querySelector(".mcp-toaster .bp3-toast-message");
    if (currentToaster) {
      currentToaster.innerText += `\n🏁 Total time: ${totalDuration}s`;
    }
    console.log(`🏁 [MCP AGENT] Total execution time: ${totalDuration}s`);
  }

  if (state.targetUid && isExistingBlock(state.targetUid)) {
    await insertStructuredAIResponse({
      targetUid: state.targetUid,
      content: lastMessage,
      target: "replace",
    });
  } else {
    const assistantRole = state.model.id
      ? getInstantAssistantRole(state.model.id)
      : chatRoles?.assistant || "";
    state.targetUid = await createChildBlock(
      state.isConversationMode ? getParentBlock(state.rootUid) : state.rootUid,
      assistantRole,
      "last"
    );
    await insertStructuredAIResponse({
      targetUid: state.targetUid,
      content: lastMessage,
      forceInChildren: true,
    });
  }

  return {
    targetUid: state.targetUid,
  };
};

// Edges
const shouldContinue = (state: typeof MCPAgentState.State) => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];
  if (
    "tool_calls" in lastMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls?.length
  ) {
    return "tools";
  }
  return "insertResponse";
};

// Custom tools node that caches results
const toolsWithCaching = async (state: typeof MCPAgentState.State) => {
  const toolNode = new ToolNode(state.mcpTools);
  const result = await toolNode.invoke(state);

  // Cache tool results for conversation continuity
  const toolMessages = result.messages.filter(
    (msg: any) => msg._getType() === "tool"
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

// Build graph dynamically for each invocation since tools change per server
export const createMCPGraph = (_tools: any[]) => {
  const builder = new StateGraph(MCPAgentState);
  builder
    .addNode("loadModel", loadModel)
    .addNode("assistant", assistant)
    .addNode("tools", toolsWithCaching)
    .addNode("insertResponse", insertResponse)

    .addEdge(START, "loadModel")
    .addEdge("loadModel", "assistant")
    .addConditionalEdges("assistant", shouldContinue)
    .addEdge("tools", "assistant")
    .addEdge("insertResponse", "__end__");

  return builder.compile();
};
