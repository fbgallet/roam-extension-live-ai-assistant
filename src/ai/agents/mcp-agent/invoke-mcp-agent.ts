import { defaultModel } from "../../..";
import {
  LlmInfos,
  TokensUsage,
} from "../langraphModelsLoader";
import { modelAccordingToProvider } from "../../aiAPIsHub";
import { displaySpinner, removeSpinner } from "../../../utils/domElts";
import { displayMCPToast } from "../../../components/Toaster.js";
import { HumanMessage } from "@langchain/core/messages";
import { mcpManager } from "./mcpManager";
import { createMCPGraph } from "./mcp-agent";
import { getFilteredMCPTools, createFullLangChainTool } from "./mcp-tools";

let turnTokensUsage: TokensUsage;
let mcpToasterStream: HTMLElement | null = null;

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

  displayMCPToast("");
  setTimeout(() => {
    mcpToasterStream = window.mcpToasterStreamElement as HTMLElement | null;
    if (mcpToasterStream) {
      mcpToasterStream.innerText += `\n🚀 Starting MCP agent with server "${serverName}"`;
    }
  }, 100);

  try {
    const client = mcpManager.getClient(serverId);
    if (!client) {
      throw new Error(`MCP server ${serverName} not connected`);
    }

    // Get filtered MCP tools based on user preferences
    const mcpToolsList = getFilteredMCPTools(client, serverId);

    // Create tools in LangChain format using unified function with toaster feedback
    const langchainTools = mcpToolsList.map((mcpTool: any) =>
      createFullLangChainTool(mcpTool, client, true)
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