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
  isExistingBlock,
  updateBlock,
} from "../../../utils/roamAPI";
import { roamBasicsFormat } from "../../prompts";
import { mcpManager } from "./mcpManager";
import { getFilteredMCPTools, createToolsForLLM } from "./mcp-tools";

const MCPAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  model: Annotation<LlmInfos>,
  rootUid: Annotation<string>,
  targetUid: Annotation<string>,
  userPrompt: Annotation<string>,
  serverId: Annotation<string>,
  serverName: Annotation<string>,
  preferredToolName: Annotation<string | undefined>,
  mcpTools: Annotation<any[]>,
  availableToolsForDynamic: Annotation<any[]>,
  mcpToasterStream: Annotation<HTMLElement | null>,
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

Instructions for formatting your response:
${roamBasicsFormat}

IMPORTANT TOOL USAGE:
- Use the available MCP tools as needed to gather information and perform tasks
- When tools return data with IDs, names, or identifiers, use the EXACT values for subsequent tool calls
- For example, if a tool returns a profile with id: "abc-123" and name: "John", use the ID "abc-123" (not "John") when that ID is required by another tool
- Chain multiple tools together as needed to complete complex tasks
- Provide comprehensive responses that synthesize information from multiple tool calls
- If you need access to tools other than the preferred one, use the "request_tool_access" tool first

CRITICAL PARAMETER GUIDELINES:
- For profiles tool: Use "profile_type": "user" instead of "all" if you get SQL errors
- Always use exact parameter names as specified in the tool schema
- If a tool call fails with SQLITE_ERROR, try alternative parameter values that might work better with the database schema

If you have to write specific Roam elements and they are not already properly formatted, write always:
- page name or page title in double brackets: [[page name]]
- block reference or block-uid in double parentheses: ((block-uid))

Here is the user request: <USER_PROMPT>`;

// Nodes
const loadModel = async (state: typeof MCPAgentState.State) => {
  llm = modelViaLanggraph(state.model, turnTokensUsage);

  // Load MCP tools using our existing browser-compatible MCP client
  const client = mcpManager.getClient(state.serverId);
  if (!client) {
    throw new Error(`MCP server ${state.serverName} not connected`);
  }

  // Get filtered MCP tools based on user preferences
  const mcpToolsList = getFilteredMCPTools(client, state.serverId);

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

      preferredToolGuidance = `PREFERRED TOOL GUIDANCE: The user wants to use the "${state.preferredToolName}" tool for this request. You MUST provide all required parameters when calling this tool. Start by attempting to use this tool with proper arguments, but feel free to use "request_tool_access" to get other tools if needed to complete the task effectively.`;
    }
  } else {
    toolDescriptions = mcpToolsList
      .map((t: any) => `- ${t.name}: ${t.description}`)
      .join("\n");
    preferredToolGuidance = "";
  }

  const systemPrompt = system_prompt_template
    .replace("<SERVER_NAME>", state.serverName)
    .replace("<PREFERRED_TOOL_GUIDANCE>", preferredToolGuidance)
    .replace("<TOOL_DESCRIPTIONS>", toolDescriptions)
    .replace("<USER_PROMPT>", state.userPrompt);

  sys_msg = new SystemMessage({ content: systemPrompt });

  return {
    mcpTools: mcpTools,
    availableToolsForDynamic: availableToolsForDynamic,
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

  const response = await llm_with_tools.invoke(messages);

  console.log(`🤖 [LLM RESPONSE] Response type: ${response.constructor.name}`);
  console.log(`🤖 [LLM CONTENT] Response content:`, response.content);

  if ("tool_calls" in response && response.tool_calls) {
    const toolCallsMsg = `\n🎯 LLM wants to call ${
      response.tool_calls.length
    } tool${response.tool_calls.length > 1 ? "s" : ""}:`;
    if (currentToaster) {
      currentToaster.innerText += toolCallsMsg;
    }

    response.tool_calls.forEach((call: any) => {
      const toolMsg = `\n  • ${call.name}`;
      if (currentToaster) {
        currentToaster.innerText += toolMsg;
      }
    });
  } else {
    if (currentToaster) {
      currentToaster.innerText += `\n✅ LLM provided final answer`;
    }
    console.log(`🤖 [LLM NO_TOOLS] LLM provided final answer without tools`);
  }

  return {
    messages: [...state.messages, response],
  };
};

const insertResponse = async (state: typeof MCPAgentState.State) => {
  const lastMessage: string = state.messages.at(-1).content.toString();
  if (state.targetUid && isExistingBlock(state.targetUid)) {
    await updateBlock({
      blockUid: state.targetUid,
      newContent: lastMessage,
    });
  } else {
    state.targetUid = await createChildBlock(
      state.rootUid,
      lastMessage,
      "last"
    );
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

// Build graph dynamically for each invocation since tools change per server
export const createMCPGraph = (tools: any[]) => {
  const builder = new StateGraph(MCPAgentState);
  builder
    .addNode("loadModel", loadModel)
    .addNode("assistant", assistant)
    .addNode("tools", new ToolNode(tools))
    .addNode("insertResponse", insertResponse)

    .addEdge(START, "loadModel")
    .addEdge("loadModel", "assistant")
    .addConditionalEdges("assistant", shouldContinue)
    .addEdge("tools", "assistant")
    .addEdge("insertResponse", "__end__");

  return builder.compile();
};
