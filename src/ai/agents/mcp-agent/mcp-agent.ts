import {
  MessagesAnnotation,
  StateGraph,
  START,
  Annotation,
} from "@langchain/langgraph/web";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
// import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import {
  LlmInfos,
  modelViaLanggraph,
  TokensUsage,
} from "../langraphModelsLoader";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import { createChildBlock, getParentBlock } from "../../../utils/roamAPI";
import { insertStructuredAIResponse } from "../../responseInsertion";
import {
  buildSystemPrompt,
  buildPlanningPrompt,
  buildConversationContext,
  buildToolDescriptions,
  MULTI_SERVER_PLAN_TEMPLATE,
  RETRY_PLAN_TEMPLATE,
} from "./mcp-agent-prompts";
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
  serverId: Annotation<string | string[]>,
  serverName: Annotation<string | string[]>,
  preferredToolName: Annotation<string | undefined>,
  mcpTools: Annotation<any[]>,
  availableToolsForDynamic: Annotation<any[]>,
  mcpToasterStream: Annotation<HTMLElement | null>,
  // Conversation state
  toolResultsCache: Annotation<Record<string, any>>,
  conversationHistory: Annotation<string[]>,
  previousResponse: Annotation<string | undefined>,
  isConversationMode: Annotation<boolean>,
  // Retry state
  isRetry: Annotation<boolean>,
  isToRedoBetter: Annotation<boolean>,
  // Planning state
  executionPlan: Annotation<string | undefined>,
  needsPlanning: Annotation<boolean>,
  // Timing
  startTime: Annotation<number>,
});

// LLM with bound tools
let llm: StructuredOutputType;
let turnTokensUsage: TokensUsage;
let sys_msg: SystemMessage;
let mcpTools: any[] = [];
let availableToolsForDynamic: any[] = [];

// System message templates moved to mcp-agent-prompts.ts

// Helper functions
const isMultiServer = (serverId: string | string[]): serverId is string[] => {
  return Array.isArray(serverId);
};

const buildServerInfo = (
  serverName: string | string[],
  isMultiple: boolean
): string => {
  if (isMultiple && Array.isArray(serverName)) {
    return `servers: ${serverName.join(", ")}`;
  }
  return `server "${serverName}"`;
};

// Nodes
const loadModel = async (state: typeof MCPAgentState.State) => {
  // Record start time if not already set
  const startTime = state.startTime || Date.now();

  llm = modelViaLanggraph(state.model, turnTokensUsage);

  const isMultiple = isMultiServer(state.serverId);
  const serverIds = isMultiple ? state.serverId : [state.serverId];
  const serverNames = isMultiple
    ? (state.serverName as string[])
    : [state.serverName as string];

  // Load MCP tools from all servers
  let allMcpToolsList: any[] = [];

  for (let i = 0; i < serverIds.length; i++) {
    const serverId = serverIds[i];
    const serverName = serverNames[i];

    const client = mcpManager.getClient(serverId);
    if (!client) {
      throw new Error(`MCP server ${serverName} not connected`);
    }

    // Get filtered MCP tools based on user preferences
    const mcpToolsList = getFilteredMCPTools(client, serverId as string);

    // Namespace tools if multiple servers
    const namespacedTools = isMultiple
      ? mcpToolsList.map((tool: any) => ({
          ...tool,
          name: `${serverName}:${tool.name}`,
          serverId,
          serverName,
        }))
      : mcpToolsList.map((tool: any) => ({ ...tool, serverId, serverName }));

    allMcpToolsList = [...allMcpToolsList, ...namespacedTools];
  }

  const mcpToolsList = allMcpToolsList;

  // Store available tools for dynamic loading
  availableToolsForDynamic = mcpToolsList;

  if (state.preferredToolName) {
    console.log(
      `Using "${state.preferredToolName}" from ${buildServerInfo(
        state.serverName,
        isMultiple
      )}`
    );
  } else {
    console.log(
      `🔧 Found ${mcpToolsList.length} MCP tools from ${buildServerInfo(
        state.serverName,
        isMultiple
      )}`
    );
  }

  // Create tools for LLM - need to handle multiple clients
  const allTools: any[] = [];

  for (let i = 0; i < serverIds.length; i++) {
    const serverId = serverIds[i];
    const client = mcpManager.getClient(serverId);
    const serverTools = mcpToolsList.filter(
      (tool) => tool.serverId === serverId
    );
    const tools = createToolsForLLM(
      serverTools,
      client,
      state.preferredToolName
    );
    allTools.push(...tools);
  }

  mcpTools = allTools;

  // Build tool descriptions and guidance
  const { toolDescriptions, preferredToolGuidance } = buildToolDescriptions(
    mcpToolsList,
    state.preferredToolName,
    isMultiple
  );

  // Build conversation context once for reuse
  const conversationContextData = buildConversationContext(state);
  const { conversationContext, conversationOptimization } =
    conversationContextData;

  // Context is now built once in conversationContextData

  const serverInfo = buildServerInfo(state.serverName as any, isMultiple);
  const systemPrompt = buildSystemPrompt({
    serverInfo,
    isMultiple,
    preferredToolGuidance,
    executionPlan: state.executionPlan,
    toolDescriptions,
    conversationContext,
    conversationOptimization,
    style: state.style,
    userPrompt: state.userPrompt,
  });

  console.log("Agent systemPrompt :>> ", systemPrompt);

  sys_msg = new SystemMessage({ content: systemPrompt });

  return {
    mcpTools: mcpTools,
    availableToolsForDynamic: availableToolsForDynamic,
    startTime: startTime,
  };
};

// Simple emergency parser for minor JSON formatting issues
const emergencyParsePlanningResponse = (responseText: string) => {
  try {
    console.log(`🔧 [EMERGENCY PARSING] Original text:`, responseText);

    // Clean up - focus only on removing markdown wrapper
    let cleanedText = responseText.trim();

    // Remove markdown code blocks if present
    cleanedText = cleanedText.replace(/^```json\s*\n?/, ""); // Remove opening ```json
    cleanedText = cleanedText.replace(/\n?\s*```\s*$/, ""); // Remove closing ```
    cleanedText = cleanedText.replace(/```/g, ""); // Remove any remaining ```

    // Additional cleanup
    cleanedText = cleanedText.trim();

    console.log(`🔧 [EMERGENCY PARSING] After markdown removal:`, cleanedText);

    // Try parsing the cleaned text directly (Claude's JSON is usually valid)
    const result = JSON.parse(cleanedText);

    console.log(`🔧 [EMERGENCY PARSING] Parsed result:`, result);

    // For multi-server planning, we always expect an execution plan
    const finalResult = {
      needsPlanning: true, // Always true for multi-server scenarios
      executionPlan:
        result.executionPlan ||
        result.execution_plan ||
        result.plan ||
        undefined,
      reasoning: result.reasoning || "Emergency parsing applied",
    };

    console.log(`🔧 [EMERGENCY PARSING] Final result:`, finalResult);
    return finalResult;
  } catch (error) {
    console.warn(`🔧 [EMERGENCY PARSING] Failed to clean and parse:`, error);
    console.warn(`🔧 [EMERGENCY PARSING] Text that failed:`, responseText);
    return null;
  }
};

// Multi-server planning node (complexity assessment removed - planning always occurs)
const multiServerPlanning = async (state: typeof MCPAgentState.State) => {
  const isMultiple = isMultiServer(state.serverId);
  const serverNames = isMultiple
    ? (state.serverName as string[])
    : [state.serverName as string];

  console.log(
    `📋 [MULTI-SERVER PLANNING] Node started - servers: ${serverNames.join(
      ", "
    )}, isRetry: ${state.isToRedoBetter}`
  );

  // Use the toaster element from state (more reliable than searching DOM)
  const currentToaster = state.mcpToasterStream;

  // Show planning node is active
  if (currentToaster) {
    currentToaster.innerText += `\n📋 Planning multi-server coordination...`;
    console.log(`📋 [TOASTER] Added multi-server planning message to toaster`);
  } else {
    console.warn(`⚠️ [TOASTER] No toaster element found in state for planning`);
  }

  // Handle forced planning scenarios (retry or predefined templates)
  if (state.isToRedoBetter) {
    const executionPlan = RETRY_PLAN_TEMPLATE;

    if (currentToaster) {
      currentToaster.innerText = currentToaster.innerText.replace(
        "📋 Planning multi-server coordination...",
        `📋 Retry Planning: ${executionPlan}`
      );
    }

    console.log(`📋 [PLANNING] Retry plan: ${executionPlan}`);
    return {
      needsPlanning: true,
      executionPlan,
    };
  }

  // Get server info and tool descriptions for multi-server planning
  const serverInfo = buildServerInfo(serverNames as any, isMultiple);
  const { toolDescriptions } = buildToolDescriptions(
    state.availableToolsForDynamic || [],
    state.preferredToolName,
    isMultiple
  );

  // Build planning prompt for multi-server coordination
  const planningPrompt = buildPlanningPrompt({
    serverInfo,
    toolDescriptions,
    userPrompt: state.userPrompt,
    isRetryBetter: state.isToRedoBetter,
    previousResponse: state.previousResponse,
  });

  try {
    // For planning, we need to use HumanMessage instead of standalone SystemMessage for Anthropic compatibility
    const planningResponse = await llm.invoke([
      new HumanMessage({ content: planningPrompt }),
    ]);

    const responseText = planningResponse.content.toString();
    console.log("📋 [PLANNING] Response text:", responseText);

    let planningResult: any;
    try {
      // First, try strict JSON parsing
      planningResult = JSON.parse(responseText);
    } catch (jsonError) {
      console.warn(
        `⚠️ [PLANNING] JSON parsing failed, attempting emergency parsing:`,
        jsonError
      );

      // Emergency parsing for malformed JSON
      planningResult = emergencyParsePlanningResponse(responseText);

      if (planningResult) {
        console.log(
          `📋 [PLANNING] Emergency parsing succeeded:`,
          planningResult
        );
      } else {
        console.warn(
          `⚠️ [PLANNING] Emergency parsing also failed, using fallback plan`
        );
        // Fallback to basic multi-server template
        planningResult = {
          executionPlan: MULTI_SERVER_PLAN_TEMPLATE.replace(
            "<SERVER_NAMES>",
            serverNames.join(", ")
          ),
          reasoning: "Fallback plan due to parsing failure",
        };
      }
    }

    // Multi-server planning always produces a plan
    const executionPlan =
      planningResult.executionPlan ||
      MULTI_SERVER_PLAN_TEMPLATE.replace(
        "<SERVER_NAMES>",
        serverNames.join(", ")
      );

    if (currentToaster) {
      // Replace planning message with actual plan preview
      currentToaster.innerText = currentToaster.innerText.replace(
        "📋 Planning multi-server coordination...",
        `📋 Multi-server plan: ${executionPlan.substring(0, 100)}...`
      );
    }

    console.log(`📋 [PLANNING] Multi-server execution plan: ${executionPlan}`);

    return {
      needsPlanning: true,
      executionPlan: executionPlan,
    };
  } catch (error) {
    console.warn(`⚠️ [PLANNING] Failed to create plan, using fallback:`, error);

    // Always provide a fallback plan for multi-server scenarios
    const fallbackPlan = MULTI_SERVER_PLAN_TEMPLATE.replace(
      "<SERVER_NAMES>",
      serverNames.join(", ")
    );

    if (currentToaster) {
      currentToaster.innerText = currentToaster.innerText.replace(
        "📋 Planning multi-server coordination...",
        `📋 Fallback plan: ${fallbackPlan}`
      );
    }

    return {
      needsPlanning: true,
      executionPlan: fallbackPlan,
    };
  }
};

const assistant = async (state: typeof MCPAgentState.State) => {
  const llm_with_tools = llm.bindTools(state.mcpTools);

  const messages = [sys_msg, ...state.messages];

  const currentToaster = state.mcpToasterStream;
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
    const currentToaster = state.mcpToasterStream;
    if (currentToaster) {
      currentToaster.innerText += `\n🏁 Total time: ${totalDuration}s`;
      
      // Add tokens used if available
      if (turnTokensUsage && (turnTokensUsage.input_tokens || turnTokensUsage.output_tokens)) {
        const inputTokens = turnTokensUsage.input_tokens || 0;
        const outputTokens = turnTokensUsage.output_tokens || 0;
        currentToaster.innerText += `\n🔢 Tokens: ${inputTokens} in / ${outputTokens} out`;
      }
    }
    console.log(`🏁 [MCP AGENT] Total execution time: ${totalDuration}s`);
    
    // Log token usage if available
    if (turnTokensUsage && (turnTokensUsage.input_tokens || turnTokensUsage.output_tokens)) {
      const inputTokens = turnTokensUsage.input_tokens || 0;
      const outputTokens = turnTokensUsage.output_tokens || 0;
      console.log(`🔢 [MCP AGENT] Tokens used: ${inputTokens} input / ${outputTokens} output`);
    }
  }

  const assistantRole = state.model.id
    ? getInstantAssistantRole(state.model.id)
    : chatRoles?.assistant || "";

  // Determine parent block based on conversation mode or retry mode
  let parentUid = state.rootUid;
  console.log("state.isConversationMode :>> ", state.isConversationMode);
  console.log("state.targetUid :>> ", state.targetUid);
  if (state.isConversationMode) {
    parentUid = getParentBlock(state.rootUid);
  }
  // else if (state.isRetry) {
  //   parentUid = state.targetUid;
  // }

  state.targetUid = await createChildBlock(
    parentUid,
    assistantRole,
    state.isRetry ? "first" : "last"
  );
  await insertStructuredAIResponse({
    targetUid: state.targetUid,
    content: lastMessage,
    forceInChildren: true,
  });
  // }

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
    .addNode("multiServerPlanning", multiServerPlanning)
    .addNode("assistant", assistant)
    .addNode("tools", toolsWithCaching)
    .addNode("insertResponse", insertResponse)

    .addEdge(START, "loadModel")
    .addConditionalEdges("loadModel", (state) => {
      const isMultiple = Array.isArray(state.serverId);

      // Skip planning if:
      // 1. Using a specific preferred tool (tool command, not server agent)
      // 2. OR single server (pure ReAct is better for single server)
      if (state.preferredToolName) {
        console.log(
          `🔄 [GRAPH] Skipping planning - using specific tool: ${state.preferredToolName}`
        );
        return "assistant";
      }

      if (!isMultiple) {
        console.log(
          `🔄 [GRAPH] Skipping planning - single server, using pure ReAct`
        );
        return "assistant";
      }

      console.log(
        `🔄 [GRAPH] Multi-server detected - running multi-server planning`
      );
      return "multiServerPlanning";
    })
    .addEdge("multiServerPlanning", "assistant")
    .addConditionalEdges("assistant", shouldContinue)
    .addEdge("tools", "assistant")
    .addEdge("insertResponse", "__end__");

  return builder.compile();
};
