import { defaultModel } from "../../..";
import {
  LlmInfos,
  TokensUsage,
  modelViaLanggraph,
} from "../langraphModelsLoader";
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
import { getAndNormalizeContext } from "../../dataExtraction";
import { hasTrueBooleanKey } from "../../../utils/dataProcessing";

let turnTokensUsage: TokensUsage = { input_tokens: 0, output_tokens: 0 }; // Initialize with proper TokensUsage structure
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
  roamContext?: any; // Roam context from ContextMenu
  // Conversation state for continuing conversations
  agentData?: {
    serverId: string | string[]; // Support multiple servers
    serverName: string | string[]; // Support multiple servers
    preferredToolName?: string;
    toolResultsCache?: Record<string, any>;
    conversationHistory?: string[]; // User-visible conversation across executions
    conversationSummary?: string; // Summary of older conversation parts
    exchangesSinceLastSummary?: number; // Track exchanges since last summary
    previousResponse?: string;
    isConversationMode?: boolean;
    // Stateful MCP prompt guidance
    mcpPromptGuidance?: string;
    isPromptProcessed?: boolean;
    // Stateful resource content
    activeResources?: Record<string, any>;
    isResourceProcessed?: boolean;
    // Stateful roam context
    roamContext?: any;
  };
  // Retry options
  options?: {
    retryInstruction?: string;
    isRetry?: boolean;
    isToRedoBetter?: boolean;
  };
  // Prompt-specific context
  promptContext?: {
    promptName: string;
    isPromptCall: boolean;
    arguments?: Record<string, any>;
  };
  // Resource-specific context
  resourceContext?: {
    resourceUri: string;
    isResourceCall: boolean;
    serverId?: string;
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
  roamContext,
  agentData,
  options,
  promptContext,
  resourceContext,
}: MCPAgentInvoker) => {
  console.log("🚀 Starting invokeMCPAgent with roamContext:", roamContext);

  let llmInfos: LlmInfos = modelAccordingToProvider(model);

  const spinnerId = displaySpinner(rootUid);

  displayMCPToast("");

  // Wait for toaster to be ready before starting agent
  await new Promise((resolve) => {
    setTimeout(() => {
      mcpToasterStream = window.mcpToasterStreamElement as HTMLElement | null;
      if (mcpToasterStream) {
        const serverDisplay = Array.isArray(serverName)
          ? `servers: ${serverName.join(", ")}`
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

    // Extract Roam context content if provided (use current or persisted from agentData)
    const effectiveRoamContext = roamContext || agentData?.roamContext;
    let contextContent = "";
    if (effectiveRoamContext && hasTrueBooleanKey(effectiveRoamContext)) {
      console.log("🔍 Extracting Roam context:", effectiveRoamContext);
      try {
        contextContent = await getAndNormalizeContext({
          roamContext: effectiveRoamContext,
          withHierarchy: true,
          withUid: true,
          uidToExclude: null,
        });
        console.log(
          "✅ Context extracted successfully, length:",
          contextContent.length
        );
      } catch (error) {
        console.error("❌ Failed to extract Roam context:", error);
        // Continue without context rather than failing
        contextContent = "";
      }
    } else {
      console.log("ℹ️ No Roam context provided or context is empty");
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
      const namespacedTools =
        serverIds.length > 1
          ? mcpToolsList.map((tool: any) => ({
              ...tool,
              name: `${sName}:${tool.name}`,
              serverId: sId,
              serverName: sName,
            }))
          : mcpToolsList.map((tool: any) => ({
              ...tool,
              serverId: sId,
              serverName: sName,
            }));

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
      conversationSummary: undefined,
      exchangesSinceLastSummary: 0,
      previousResponse: undefined,
      isConversationMode: false,
      mcpPromptGuidance: undefined,
      isPromptProcessed: false,
      activeResources: {},
      isResourceProcessed: false,
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
      conversationSummary: conversationData.conversationSummary,
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
      // Prompt context
      promptContext: promptContext,
      // Resource context
      resourceContext: resourceContext,
      // Stateful MCP prompt guidance
      mcpPromptGuidance: conversationData.mcpPromptGuidance,
      isPromptProcessed: conversationData.isPromptProcessed || false,
      // Stateful resource content
      activeResources: conversationData.activeResources || {},
      isResourceProcessed: conversationData.isResourceProcessed || false,
      // Roam context content
      roamContextContent: contextContent,
    });

    if (mcpToasterStream) {
      mcpToasterStream.innerText += `\n🎉 MCP Agent completed successfully!`;
    }

    // Insert conversation buttons for continued interaction
    if (response && response.targetUid) {
      // Build conversation state before setTimeout to handle async properly
      const conversationState = await buildConversationState(
        conversationData.conversationHistory || [],
        conversationData.conversationSummary,
        finalPrompt,
        response.messages?.at(-1)?.content || "",
        llmInfos,
        mcpToasterStream,
        conversationData.exchangesSinceLastSummary || 0
      );

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
            conversationHistory: conversationState.conversationHistory,
            conversationSummary: conversationState.conversationSummary,
            exchangesSinceLastSummary:
              conversationState.exchangesSinceLastSummary || 0,
            previousResponse: response.messages?.at(-1)?.content || "",
            isConversationMode: true,
            // Persist MCP prompt guidance for future conversation turns
            mcpPromptGuidance: response.mcpPromptGuidance,
            isPromptProcessed: response.isPromptProcessed || false,
            // Persist resource content for future conversation turns
            activeResources: response.activeResources || {},
            isResourceProcessed: response.isResourceProcessed || false,
            // Persist roam context for future conversation turns
            roamContext: effectiveRoamContext,
          },
          aiCallback: invokeMCPAgent,
        });
      }, 200);
    }

    return response;
  } catch (error) {
    if (mcpToasterStream) {
      mcpToasterStream.innerText += `\n💥 Error: ${error.message}`;
    }

    throw error;
  } finally {
    removeSpinner(spinnerId);
  }
};

// Helper function for conversation state management (summarization + history)
const buildConversationState = async (
  currentHistory: string[],
  currentSummary: string | undefined,
  newUserPrompt: string,
  newAssistantResponse: any,
  llmInfos: any,
  toasterElement: HTMLElement | null,
  exchangesSinceLastSummary: number = 0
) => {
  // Add new messages to history
  const assistantContent =
    typeof newAssistantResponse === "string"
      ? newAssistantResponse
      : newAssistantResponse?.toString() || "";

  const newHistory = [
    ...currentHistory,
    `User: ${newUserPrompt}`,
    `Assistant: ${assistantContent}`,
  ];

  // Increment exchanges counter
  const newExchangesSinceLastSummary = exchangesSinceLastSummary + 1;

  // Always keep last 6 messages (3 exchanges) for recent conversation
  const conversationHistory = newHistory.slice(-6);

  // Summarize every 3 exchanges (6 messages) to avoid summarizing every turn
  if (newExchangesSinceLastSummary >= 3 && newHistory.length > 6) {
    try {
      // Show toaster feedback
      if (toasterElement) {
        toasterElement.innerText += `\n📝 Summarizing conversation...`;
      }

      // Messages to summarize (everything except last 6)
      const messagesToSummarize = newHistory.slice(0, -6);
      const conversationToSummarize = messagesToSummarize.join("\n");

      // Create enhanced summarization prompt
      const summarizationPrompt = `${
        currentSummary
          ? `**Previous Summary:**
${currentSummary}

**Additional conversation to incorporate:**`
          : "**Conversation to summarize:**"
      }
${conversationToSummarize}

**Instructions:** Provide a comprehensive summary of this conversation that will help maintain context for future exchanges. Your summary should:

1. **ALWAYS start with the original user request/goal** - synthesize what the user initially wanted to accomplish
2. **Highlight important findings, results, and conclusions** - include discoveries made, problems solved, key insights gained and capture points where consensus was reached or where different viewpoints were established
3. **Note any ongoing tasks or directions** the conversation is heading`;

      // Use the same LLM to create summary
      const llm = modelViaLanggraph(llmInfos, turnTokensUsage);
      const summaryResponse = await llm.invoke([
        new HumanMessage({ content: summarizationPrompt }),
      ]);

      const newSummary = summaryResponse.content.toString();

      // Update toaster feedback
      if (toasterElement) {
        toasterElement.innerText = toasterElement.innerText.replace(
          "📝 Summarizing conversation...",
          "📝 Conversation summarized"
        );
      }

      return {
        conversationHistory,
        conversationSummary: newSummary,
        exchangesSinceLastSummary: 0, // Reset counter after summarization
      };
    } catch (error) {
      // Update toaster with error
      if (toasterElement) {
        toasterElement.innerText = toasterElement.innerText.replace(
          "📝 Summarizing conversation...",
          "⚠️ Summary failed - continuing without"
        );
      }

      // Fallback: keep the current summary if summarization fails, but still reset counter
      return {
        conversationHistory,
        conversationSummary: currentSummary,
        exchangesSinceLastSummary: 0, // Reset counter even on failure to avoid infinite retry
      };
    }
  }

  // Not enough exchanges to summarize yet
  return {
    conversationHistory,
    conversationSummary: currentSummary,
    exchangesSinceLastSummary: newExchangesSinceLastSummary, // Keep incrementing counter
  };
};
