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
  serverId: string | string[]; // Support multiple servers
  serverName: string | string[]; // Support multiple servers
  preferredToolName?: string;
  previousResponse?: string;
  // Conversation state for continuing conversations
  agentData?: {
    serverId: string | string[]; // Support multiple servers
    serverName: string | string[]; // Support multiple servers
    preferredToolName?: string;
    toolResultsCache?: Record<string, any>;
    conversationHistory?: string[];
    previousResponse?: string;
    isConversationMode?: boolean;
  };
  // Retry options
  options?: {
    retryInstruction?: string;
    isRetry?: boolean;
    isToRedoBetter?: boolean;
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
  options,
}: MCPAgentInvoker) => {
  console.log("🤖 Invoking MCP Agent with:", {
    model,
    style,
    serverId,
    serverName,
    preferredToolName: preferredToolName, // Keep undefined when not set
    preferredToolDisplay: preferredToolName || "(all tools)", // For logging clarity
    rootUid,
    agentData: !!agentData,
    isRetry: options?.isRetry,
    hasRetryInstruction: !!options?.retryInstruction,
  });

  console.log("💾 Agent data received:", agentData);

  let llmInfos: LlmInfos = modelAccordingToProvider(model);
  const spinnerId = displaySpinner(rootUid);

  displayMCPToast("");
  
  // Wait for toaster to be ready before starting agent
  await new Promise(resolve => {
    setTimeout(() => {
      mcpToasterStream = window.mcpToasterStreamElement as HTMLElement | null;
      if (mcpToasterStream) {
        const serverDisplay = Array.isArray(serverName) 
          ? `servers: ${serverName.join(', ')}`
          : `server "${serverName}"`;
        mcpToasterStream.innerText += `\n🚀 Starting MCP agent with ${serverDisplay}`;
      }
      resolve(true);
    }, 100);
  });

  try {
    // Handle single or multiple servers
    const serverIds = Array.isArray(serverId) ? serverId : [serverId];
    const serverNames = Array.isArray(serverName) ? serverName : [serverName];
    
    // Validate all servers are connected
    for (let i = 0; i < serverIds.length; i++) {
      const client = mcpManager.getClient(serverIds[i]);
      if (!client) {
        throw new Error(`MCP server ${serverNames[i]} not connected`);
      }
    }

    // Get filtered MCP tools from all servers
    let allMcpToolsList: any[] = [];
    const allLangchainTools: any[] = [];
    
    for (let i = 0; i < serverIds.length; i++) {
      const sId = serverIds[i];
      const sName = serverNames[i];
      const client = mcpManager.getClient(sId);
      
      const mcpToolsList = getFilteredMCPTools(client, sId);
      
      // Namespace tools if multiple servers
      const namespacedTools = serverIds.length > 1
        ? mcpToolsList.map((tool: any) => ({ ...tool, name: `${sName}:${tool.name}`, serverId: sId, serverName: sName }))
        : mcpToolsList.map((tool: any) => ({ ...tool, serverId: sId, serverName: sName }));
      
      allMcpToolsList = [...allMcpToolsList, ...namespacedTools];
      
      // Create LangChain tools for this server
      const serverLangchainTools = mcpToolsList.map((mcpTool: any) =>
        createFullLangChainTool(mcpTool, client, true)
      );
      allLangchainTools.push(...serverLangchainTools);
    }

    const langchainTools = allLangchainTools;

    // Create the graph with these tools
    const mcpAgent = createMCPGraph(langchainTools);

    // Handle conversation state and retry logic
    const isConversationMode = agentData?.isConversationMode || false;
    const isRetry = options?.isRetry || false;
    const isToRedoBetter = options?.isToRedoBetter || false;

    // Process prompt with retry instructions if provided
    let finalPrompt = prompt;
    if (options?.retryInstruction && isRetry && isToRedoBetter) {
      finalPrompt = `${prompt}\n\nPlease improve the response considering: ${options.retryInstruction}`;
    }

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
      userPrompt: finalPrompt,
      style,
      serverId: conversationData.serverId || serverId,
      serverName: conversationData.serverName || serverName,
      preferredToolName:
        conversationData.preferredToolName || preferredToolName,
      targetUid: target && target.includes("new") ? undefined : targetUid,
      mcpTools: langchainTools,
      availableToolsForDynamic: allMcpToolsList, // Pass the tools list for planning
      mcpToasterStream: mcpToasterStream,
      messages: [new HumanMessage(finalPrompt)], // Initialize with final prompt (includes retry instructions)
      // Conversation state
      toolResultsCache: conversationData.toolResultsCache || {},
      conversationHistory: conversationData.conversationHistory || [],
      previousResponse:
        (isRetry && isToRedoBetter) || isConversationMode
          ? conversationData.previousResponse || previousResponse
          : undefined,
      isConversationMode: isRetry ? false : isConversationMode, // Retry is not conversation mode
      // Retry state
      isRetry: isRetry,
      isToRedoBetter: isToRedoBetter,
      // Planning state
      executionPlan: undefined,
      needsPlanning: false,
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
            { role: "user", content: finalPrompt },
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
