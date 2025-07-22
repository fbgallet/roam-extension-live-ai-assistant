import {
  MessagesAnnotation,
  StateGraph,
  START,
  Annotation,
} from "@langchain/langgraph/web";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
// import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { defaultModel } from "../../..";
import {
  LlmInfos,
  modelViaLanggraph,
  TokensUsage,
} from "../langraphModelsLoader";
import { modelAccordingToProvider } from "../../aiAPIsHub";
import { displaySpinner, removeSpinner } from "../../../utils/domElts";
import { displayMCPToast } from "../../../components/Toaster.js";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import {
  createChildBlock,
  isExistingBlock,
  updateBlock,
} from "../../../utils/roamAPI";
import { roamBasicsFormat } from "../../prompts";
import { mcpManager } from "../../../mcp/mcpManager";

// Extend Window interface for our global toaster element
declare global {
  interface Window {
    mcpToasterStreamElement?: HTMLElement | null;
  }
}

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
let mcpToasterStream: HTMLElement | null = null;
let currentClient: any = null;

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

// Helper function to create a full LangChain tool from MCP tool
const createFullLangChainTool = (mcpTool: any, client: any) => {
  // Create Zod schema from MCP tool input schema
  const createZodSchema = (inputSchema: any) => {
    if (!inputSchema || !inputSchema.properties) {
      return z.object({});
    }

    const zodObject: Record<string, z.ZodType<any>> = {};

    for (const [key, prop] of Object.entries(inputSchema.properties)) {
      const property = prop as any;
      let zodType: z.ZodType<any>;

      switch (property.type) {
        case "string":
          zodType = z.string();
          if (property.enum) {
            zodType = z.enum(property.enum as [string, ...string[]]);
          }
          break;
        case "number":
          zodType = z.number();
          break;
        case "integer":
          zodType = z.number().int();
          break;
        case "boolean":
          zodType = z.boolean();
          break;
        case "array":
          zodType = z.array(z.any());
          break;
        case "object":
          zodType = z.object({}).passthrough();
          break;
        default:
          zodType = z.any();
      }

      if (property.description) {
        zodType = zodType.describe(property.description);
      }

      if (!inputSchema.required || !inputSchema.required.includes(key)) {
        zodType = zodType.optional();
      }

      if (property.default !== undefined) {
        zodType = zodType.default(property.default);
      }

      zodObject[key] = zodType;
    }

    return z.object(zodObject);
  };

  return tool(
    async (input: any) => {
      try {
        console.log(
          `🔧 Executing MCP tool "${mcpTool.name}" with args:`,
          input
        );
        const result = await client.callTool(mcpTool.name, input);

        if (result.result) {
          console.log(`✅ MCP tool "${mcpTool.name}" result:`, result.result);
          return JSON.stringify(result.result, null, 2);
        } else if (result.error) {
          console.error(`❌ MCP tool "${mcpTool.name}" error:`, result.error);
          throw new Error(result.error);
        } else {
          return "Tool executed successfully but returned no result";
        }
      } catch (error) {
        console.error(
          `❌ Error executing MCP tool "${mcpTool.name}":`,
          error
        );
        throw error;
      }
    },
    {
      name: mcpTool.name,
      description: mcpTool.description || `Execute ${mcpTool.name}`,
      schema: createZodSchema(mcpTool.inputSchema),
    }
  );
};

// Helper function to create token-efficient tool set
const createToolsForLLM = (mcpToolsList: any[], client: any, preferredToolName?: string) => {
  if (!preferredToolName) {
    // Normal behavior - return all tools with full descriptions
    return mcpToolsList.map(tool => createFullLangChainTool(tool, client));
  }

  // Preferred tool mode - create optimized set
  const preferredTool = mcpToolsList.find(t => t.name === preferredToolName);
  const otherTools = mcpToolsList.filter(t => t.name !== preferredToolName);
  
  const tools = [];
  
  // Add preferred tool with full description
  if (preferredTool) {
    tools.push(createFullLangChainTool(preferredTool, client));
  }
  
  // Add "request_tool_access" meta-tool to get descriptions of other tools
  tools.push(
    tool(
      async ({ toolName }: { toolName: string }) => {
        const requestedTool = availableToolsForDynamic.find(t => t.name === toolName);
        if (!requestedTool) {
          return `Tool "${toolName}" not found. Available tools: ${otherTools.map(t => t.name).join(', ')}`;
        }
        
        // Create and add the full tool for future use
        const fullTool = createFullLangChainTool(requestedTool, currentClient);
        mcpTools.push(fullTool);
        
        return `Tool "${toolName}" is now available. Description: ${requestedTool.description}\n\nYou can now use this tool directly in your next response.`;
      },
      {
        name: "request_tool_access",
        description: "Request access to additional tools with full descriptions. Use this when you need tools other than the preferred one.",
        schema: z.object({
          toolName: z.string().describe("Name of the tool to get full access to")
        })
      }
    )
  );

  return tools;
};

// Nodes
const loadModel = async (state: typeof MCPAgentState.State) => {
  llm = modelViaLanggraph(state.model, turnTokensUsage);

  // Load MCP tools using our existing browser-compatible MCP client
  const client = mcpManager.getClient(state.serverId);
  if (!client) {
    throw new Error(`MCP server ${state.serverName} not connected`);
  }

  currentClient = client; // Store for dynamic tool access

  // Get filtered MCP tools based on user preferences
  const allServerTools = client.getTools();
  const toolPreferences = mcpManager.extensionStorage?.get('mcpToolPreferences') || {};
  const mcpToolsList = allServerTools.filter(tool => {
    const isEnabled = toolPreferences[state.serverId]?.[tool.name] !== false;
    return isEnabled;
  });
  console.log(
    `🔧 Found ${mcpToolsList.length} MCP tools from server "${state.serverName}"`
  );

  // Store available tools for dynamic loading
  availableToolsForDynamic = mcpToolsList;

  // Log basic tool information
  if (state.preferredToolName) {
    console.log(
      `🎯 [PREFERRED MODE] Using "${state.preferredToolName}" from server "${state.serverName}"`
    );
  } else {
    console.log(
      `🔧 Found ${mcpToolsList.length} MCP tools from server "${state.serverName}"`
    );
  }

  // Create tools using token-efficient approach
  mcpTools = createToolsForLLM(mcpToolsList, client, state.preferredToolName);

  console.log(
    `🔧 Created ${mcpTools.length} LangChain tools for LLM`
  );

  // Build system prompt with tool information
  let toolDescriptions = "";
  let preferredToolGuidance = "";
  
  if (state.preferredToolName) {
    const preferredTool = mcpToolsList.find((t: any) => t.name === state.preferredToolName);
    const otherTools = mcpToolsList.filter((t: any) => t.name !== state.preferredToolName);
    
    if (preferredTool) {
      // Include detailed schema information for the preferred tool
      const schemaInfo = preferredTool.inputSchema ? 
        `\n  Required parameters: ${JSON.stringify(preferredTool.inputSchema.required || [])}\n  Schema: ${JSON.stringify(preferredTool.inputSchema.properties, null, 2)}` :
        "\n  No parameters required";
      
      toolDescriptions = `
**Preferred Tool:**
- ${preferredTool.name}: ${preferredTool.description}${schemaInfo}

**Other Available Tools:**
${otherTools.map((t: any) => `- ${t.name}`).join('\n')}

- request_tool_access: Get full access to any other tool by name
`;
      
      preferredToolGuidance = `PREFERRED TOOL GUIDANCE: The user wants to use the "${state.preferredToolName}" tool for this request. You MUST provide all required parameters when calling this tool. Start by attempting to use this tool with proper arguments, but feel free to use "request_tool_access" to get other tools if needed to complete the task effectively.`;
    }
  } else {
    toolDescriptions = mcpToolsList.map((t: any) => `- ${t.name}: ${t.description}`).join('\n');
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

  // Combine system message with user messages
  const messages = [sys_msg, ...state.messages];
  console.log(`🤖 [LLM REQUEST] Invoking LLM with ${messages.length} messages`);
  console.log(
    `🤖 [LLM TOOLS] Available tools: ${state.mcpTools
      .map((t) => t.name)
      .join(", ")}`
  );

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

    console.log(
      `🤖 [LLM TOOL_CALLS] LLM wants to call ${response.tool_calls.length} tools:`
    );
    response.tool_calls.forEach((call: any, index: number) => {
      const toolMsg = `\n  • ${call.name}`;
      if (currentToaster) {
        currentToaster.innerText += toolMsg;
      }
      console.log(`🤖 [LLM TOOL_CALL ${index + 1}] Tool: ${call.name}`);
      console.log(
        `🤖 [LLM TOOL_CALL ${index + 1}] Args:`,
        JSON.stringify(call.args, null, 2)
      );
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
const createMCPGraph = (tools: any[]) => {
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

interface MCPAgentInvoker {
  model: string;
  rootUid: string;
  targetUid?: string;
  target?: string;
  prompt: string;
  serverId: string;
  serverName: string;
  preferredToolName?: string;
  previousResponse?: string;
}

// Invoke MCP agent
export const invokeMCPAgent = async ({
  model = defaultModel,
  rootUid,
  targetUid,
  target,
  prompt,
  serverId,
  serverName,
  preferredToolName,
  previousResponse,
}: MCPAgentInvoker) => {
  console.log("🤖 Invoking MCP Agent with:", {
    model,
    serverId,
    serverName,
    preferredToolName: preferredToolName || "(all tools)",
  });

  let llmInfos: LlmInfos = modelAccordingToProvider(model);
  const spinnerId = displaySpinner(rootUid);

  // Initialize MCP toaster
  displayMCPToast("");

  // Wait a bit for the toaster to be ready, then add startup message
  setTimeout(() => {
    mcpToasterStream = window.mcpToasterStreamElement as HTMLElement | null;
    if (mcpToasterStream) {
      mcpToasterStream.innerText += `\n🚀 Starting MCP agent with server "${serverName}"`;
    }
  }, 100);

  try {
    // First, load the tools to create the graph
    const client = mcpManager.getClient(serverId);
    if (!client) {
      throw new Error(`MCP server ${serverName} not connected`);
    }

    // Get filtered MCP tools based on user preferences
    const allServerTools = client.getTools();
    const toolPreferences = mcpManager.extensionStorage?.get('mcpToolPreferences') || {};
    const mcpToolsList = allServerTools.filter((tool: any) => {
      const isEnabled = toolPreferences[serverId]?.[tool.name] !== false;
      return isEnabled;
    });
    console.log(
      `🔧 Creating graph with ${mcpToolsList.length} tools from server "${serverName}"`
    );

    // Create tools in LangChain format with detailed logging
    const langchainTools = mcpToolsList.map((mcpTool: any) =>
      tool(
        async (input: any) => {
          const toolCallMsg = `\n🔧 Calling tool: ${mcpTool.name}`;
          const argsMsg = `\n📝 Args: ${JSON.stringify(input, null, 2)}`;

          console.log(`🔧 [MCP TOOL CALL] Tool: ${mcpTool.name}`);
          console.log(
            `📝 [MCP ARGS] Input received from LLM:`,
            JSON.stringify(input, null, 2)
          );
          // console.log(`📋 [MCP SCHEMA] Expected tool schema:`, JSON.stringify(mcpTool.inputSchema, null, 2));

          const currentToaster =
            window.mcpToasterStreamElement ||
            document.querySelector(".mcp-toaster .bp3-toast-message");
          if (currentToaster) {
            currentToaster.innerText += toolCallMsg + argsMsg;
          }

          try {
            console.log(
              `⚡ [MCP REQUEST] Calling server tool "${mcpTool.name}" with processed args:`,
              input
            );
            const result = await client.callTool(mcpTool.name, input);

            console.log(
              `✅ [MCP RESPONSE] Tool "${mcpTool.name}" raw result:`,
              JSON.stringify(result, null, 2)
            );

            if (result.result) {
              const formattedResult = JSON.stringify(result.result, null, 2);
              const responseMsg = `\n✅ Response received\n`;

              if (currentToaster) {
                currentToaster.innerText += responseMsg;
              }

              console.log(
                `📊 [MCP SUCCESS] Tool "${mcpTool.name}" formatted result:`,
                formattedResult
              );
              return formattedResult;
            } else if (result.error) {
              const errorMsg = `\n❌ Error: ${result.error}\n`;
              if (currentToaster) {
                currentToaster.innerText += errorMsg;
              }

              console.error(
                `❌ [MCP ERROR] Tool "${mcpTool.name}" returned error:`,
                result.error
              );
              throw new Error(`MCP Tool Error: ${result.error}`);
            } else {
              const warningMsg = `\n⚠️ Tool executed but returned no result\n`;
              if (currentToaster) {
                currentToaster.innerText += warningMsg;
              }

              console.log(
                `⚠️  [MCP WARNING] Tool "${mcpTool.name}" returned no result or error`
              );
              return "Tool executed but returned no result";
            }
          } catch (error) {
            const errorMsg = `\n💥 Exception: ${error.message}\n`;
            if (currentToaster) {
              currentToaster.innerText += errorMsg;
            }

            console.error(
              `💥 [MCP EXCEPTION] Error executing tool "${mcpTool.name}":`,
              error
            );
            console.error(
              `🔍 [MCP DEBUG] Input that caused error:`,
              JSON.stringify(input, null, 2)
            );

            // Retry logic for known issues
            if (
              error.message.includes("SQLITE_ERROR") &&
              mcpTool.name === "profiles"
            ) {
              console.log(
                `🔄 [MCP RETRY] Attempting retry with alternative parameters for profiles tool`
              );
              try {
                const retryInput = {
                  ...input,
                  profile_type:
                    input.profile_type === "all" ? "user" : input.profile_type,
                };
                console.log(
                  `🔄 [MCP RETRY] Retry with:`,
                  JSON.stringify(retryInput, null, 2)
                );
                const retryResult = await client.callTool(
                  mcpTool.name,
                  retryInput
                );

                if (retryResult.result) {
                  console.log(
                    `✅ [MCP RETRY SUCCESS] Retry succeeded:`,
                    JSON.stringify(retryResult.result, null, 2)
                  );
                  return JSON.stringify(retryResult.result, null, 2);
                }
              } catch (retryError) {
                console.error(
                  `❌ [MCP RETRY FAILED] Retry also failed:`,
                  retryError
                );
              }
            }

            throw error;
          }
        },
        {
          name: mcpTool.name,
          description: mcpTool.description || `Execute ${mcpTool.name}`,
          schema: z.object({}).passthrough(), // Simplified schema for now
        }
      )
    );

    // Create the graph with these tools
    const mcpAgent = createMCPGraph(langchainTools);

    const response = await mcpAgent.invoke({
      model: llmInfos,
      rootUid,
      userPrompt: prompt,
      serverId,
      serverName,
      preferredToolName,
      targetUid: target && target.includes("new") ? undefined : targetUid,
      mcpTools: langchainTools,
      availableToolsForDynamic: [],
      mcpToasterStream: mcpToasterStream,
      messages: [new HumanMessage(prompt)], // Initialize with user message
    });

    console.log("✅ MCP Agent response:", response);

    if (mcpToasterStream) {
      mcpToasterStream.innerText += `\n🎉 MCP Agent completed successfully!`;
    }

    return response;
  } catch (error) {
    console.error("❌ Error invoking MCP Agent:", error);

    if (mcpToasterStream) {
      mcpToasterStream.innerText += `\n💥 Error: ${error.message}`;
    }

    throw error;
  } finally {
    removeSpinner(spinnerId);
  }
};
