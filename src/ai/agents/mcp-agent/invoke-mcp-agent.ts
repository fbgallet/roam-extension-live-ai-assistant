import { defaultModel } from "../../..";
import { LlmInfos, TokensUsage } from "../langraphModelsLoader";
import { modelAccordingToProvider } from "../../aiAPIsHub";
import {
  displaySpinner,
  removeSpinner,
  insertInstantButtons,
} from "../../../utils/domElts";
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
  style?: string;
  serverId: string;
  serverName: string;
  preferredToolName?: string;
  previousResponse?: string;
  // Conversation state for continuing conversations
  agentData?: {
    serverId: string;
    serverName: string;
    preferredToolName?: string;
    toolResultsCache?: Record<string, any>;
    conversationHistory?: string[];
    previousResponse?: string;
    isConversationMode?: boolean;
  };
}

// Invoke MCP agent
export const invokeMCPAgent = async ({
  model = defaultModel,
  rootUid,
  targetUid,
  target,
  prompt,
  style,
  serverId,
  serverName,
  preferredToolName,
  previousResponse,
  agentData,
}: MCPAgentInvoker) => {
  console.log("🤖 Invoking MCP Agent with:", {
    model,
    style,
    serverId,
    serverName,
    preferredToolName: preferredToolName || "(all tools)",
    rootUid,
    agentData: !!agentData,
  });

  console.log("💾 Agent data received:", agentData);
  console.log("🔧 Tool results cache:", agentData?.toolResultsCache);
  console.log(
    "📊 Cache size:",
    Object.keys(agentData?.toolResultsCache || {}).length
  );

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

    // Handle conversation state
    const isConversationMode = agentData?.isConversationMode || false;
    const conversationData = agentData || {
      serverId: serverId,
      serverName: serverName,
      preferredToolName: preferredToolName,
      toolResultsCache: {},
      conversationHistory: [],
      previousResponse: undefined,
      isConversationMode: false,
    };

    const response = await mcpAgent.invoke({
      model: llmInfos,
      rootUid,
      userPrompt: prompt,
      style,
      serverId: conversationData.serverId || serverId,
      serverName: conversationData.serverName || serverName,
      preferredToolName:
        conversationData.preferredToolName || preferredToolName,
      targetUid: target && target.includes("new") ? undefined : targetUid,
      mcpTools: langchainTools,
      availableToolsForDynamic: [],
      mcpToasterStream: mcpToasterStream,
      messages: [new HumanMessage(prompt)], // Initialize with user message
      // Conversation state
      toolResultsCache: conversationData.toolResultsCache || {},
      conversationHistory: conversationData.conversationHistory || [],
      previousResponse: conversationData.previousResponse || previousResponse,
      isConversationMode,
    });

    console.log("✅ MCP Agent response:", response);

    if (mcpToasterStream) {
      mcpToasterStream.innerText += `\n🎉 MCP Agent completed successfully!`;
    }

    // Insert conversation buttons for continued interaction
    if (response && response.targetUid) {
      setTimeout(() => {
        insertInstantButtons({
          model: llmInfos.id,
          prompt: [
            { role: "user", content: prompt },
            {
              role: "assistant",
              content: response.messages?.at(-1)?.content || "",
            },
          ],
          style,
          currentUid: rootUid,
          targetUid: response.targetUid,
          responseFormat: "text",
          response: response.messages?.at(-1)?.content || "",
          agentData: {
            serverId: conversationData.serverId || serverId,
            serverName: conversationData.serverName || serverName,
            preferredToolName:
              conversationData.preferredToolName || preferredToolName,
            toolResultsCache: response.toolResultsCache || {},
            conversationHistory: [
              ...(conversationData.conversationHistory || []),
              response.messages?.at(-1)?.content || "",
            ],
            previousResponse: response.messages?.at(-1)?.content || "",
            isConversationMode: true,
          },
          aiCallback: invokeMCPAgent,
        });
      }, 200);
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
