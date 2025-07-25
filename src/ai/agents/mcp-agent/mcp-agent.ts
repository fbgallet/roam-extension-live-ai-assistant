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
  buildResourceContent,
  MULTI_SERVER_PLAN_TEMPLATE,
  RETRY_PLAN_TEMPLATE,
} from "./mcp-agent-prompts";
import { mcpManager } from "./mcpManager";
import {
  getFilteredMCPTools,
  getMCPResources,
  getMCPPrompts,
  createToolsForLLM,
} from "./mcp-tools";
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
  conversationHistory: Annotation<string[]>, // User-visible conversation across executions
  conversationSummary: Annotation<string | undefined>, // Summary of older conversation parts
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
  // Prompt context
  promptContext: Annotation<
    | {
        promptName: string;
        isPromptCall: boolean;
        arguments?: Record<string, any>;
      }
    | undefined
  >,
  // Prompt enhancement result
  promptEnhancement: Annotation<
    | {
        systemPromptAddition: string;
        userPromptEnhancement: string;
        promptName: string;
        arguments: Record<string, any>;
        error?: string;
      }
    | undefined
  >,
  // Stateful MCP prompt guidance - persists across conversation turns
  mcpPromptGuidance: Annotation<string | undefined>,
  isPromptProcessed: Annotation<boolean>,
  // Resource context
  resourceContext: Annotation<
    | {
        resourceUri: string;
        isResourceCall: boolean;
        serverId?: string;
      }
    | undefined
  >,
  // Resource content result
  resourceContent: Annotation<
    | {
        content: string;
        uri: string;
        mimeType?: string;
        serverId: string;
        error?: string;
      }
    | undefined
  >,
  // Stateful resource content - persists across conversation turns
  activeResources: Annotation<Record<string, any>>,
  isResourceProcessed: Annotation<boolean>,
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

  // Load MCP tools and resources from all servers
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

    // Resources and prompts are handled separately in their respective processing nodes
    // Resources: processResourceContext node
    // Prompts: processPromptContext node

    // Resources are not tools - they provide context content
    // Store resources separately for context injection

    // Store prompts separately - they're not tools, they're conversation enhancers
    // We'll handle prompts differently in the prompt processing node

    // Only include actual tools, not resources
    const allServerItems = [...mcpToolsList];

    // Namespace items if multiple servers
    const namespacedItems = isMultiple
      ? allServerItems.map((item: any) => ({
          ...item,
          name:
            item.type === "resource" ? item.name : `${serverName}:${item.name}`,
          serverId,
          serverName,
        }))
      : allServerItems.map((item: any) => ({ ...item, serverId, serverName }));

    allMcpToolsList = [...allMcpToolsList, ...namespacedItems];
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
    const toolCount = mcpToolsList.filter((item) => !item.type).length;
    const resourceCount = mcpToolsList.filter(
      (item) => item.type === "resource"
    ).length;
    console.log(
      `🔧 Found ${toolCount} tools and ${resourceCount} resources from ${buildServerInfo(
        state.serverName,
        isMultiple
      )}`
    );
  }

  // Create tools for LLM - need to handle multiple clients and resources
  const allTools: any[] = [];

  for (let i = 0; i < serverIds.length; i++) {
    const serverId = serverIds[i];
    const client = mcpManager.getClient(serverId);
    const serverItems = mcpToolsList.filter(
      (item) => item.serverId === serverId
    );

    // Only create tools for actual MCP tools, not resources
    const tools = createToolsForLLM(
      serverItems,
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

  // Build base system prompt with MCP guidance and resource content if available
  console.log(
    "🔍 [DEBUG] MCP prompt guidance in state:",
    state.mcpPromptGuidance
  );
  console.log("🔍 [DEBUG] isPromptProcessed:", state.isPromptProcessed);
  console.log("🔍 [DEBUG] promptContext:", state.promptContext);
  console.log("🔍 [DEBUG] activeResources:", Object.keys(state.activeResources || {}));
  console.log("🔍 [DEBUG] resourceContext:", state.resourceContext);

  // Build resource content for system prompt
  const resourceContent = buildResourceContent(
    state.activeResources || {},
    state.resourceContent
  );

  let systemPrompt = buildSystemPrompt({
    serverInfo,
    isMultiple,
    preferredToolGuidance,
    executionPlan: state.executionPlan,
    toolDescriptions,
    conversationContext,
    conversationOptimization,
    style: state.style,
    userPrompt: state.userPrompt,
    mcpPromptGuidance: state.mcpPromptGuidance, // Include stored MCP guidance
    resourceContent, // Include resource content
  });

  // console.log("systemPrompt :>> ", systemPrompt);

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

// MCP Resource processing node - handles resource content retrieval and context injection
const processResourceContext = async (state: typeof MCPAgentState.State) => {
  if (!state.resourceContext?.isResourceCall) {
    return {}; // No resource context, continue normally
  }

  // Skip processing if already done in this conversation (stateful optimization)
  if (state.isResourceProcessed && state.activeResources[state.resourceContext.resourceUri]) {
    console.log(
      `📄 [RESOURCE PROCESSING] Skipping - already processed in this conversation`
    );
    return {
      resourceContent: state.activeResources[state.resourceContext.resourceUri],
    };
  }

  const { resourceUri, serverId } = state.resourceContext;
  console.log(`📄 [RESOURCE PROCESSING] Processing MCP resource: ${resourceUri}`);

  const currentToaster = state.mcpToasterStream;
  if (currentToaster) {
    currentToaster.innerText += `\n📄 Loading resource: ${resourceUri}...`;
  }

  try {
    // Get the appropriate server client
    const targetServerId = serverId || (Array.isArray(state.serverId) ? state.serverId[0] : state.serverId);
    const client = mcpManager.getClient(targetServerId);

    if (!client) {
      throw new Error(`MCP server not connected: ${targetServerId}`);
    }

    // Get the resource content with fallback URI formats
    let response;
    if (!resourceUri.includes('://') && !resourceUri.startsWith('/')) {
      // Try common URI formats for servers that might expect different schemes
      const uriFormats = [
        resourceUri,                  // original URI first
        `file://${resourceUri}`,     // file:// with 2 slashes
        `file:///${resourceUri}`,    // file:// with 3 slashes
      ];

      let lastError;
      for (const uri of uriFormats) {
        try {
          response = await client.getResource(uri);
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!response) {
        throw lastError;
      }
    } else {
      // URI already has a scheme, use as-is
      response = await client.getResource(resourceUri);
    }
    
    if (!response.result || !response.result.contents) {
      throw new Error(`No content from MCP resource: ${resourceUri}`);
    }

    // Process the resource content
    let content = response.result.contents;
    let mimeType = 'text/plain';
    
    // Handle different content types according to MCP spec
    if (Array.isArray(content)) {
      const processedContent = content.map(item => {
        if (item.type === 'text') {
          return item.text;
        } else if (item.type === 'blob') {
          mimeType = item.mimeType || 'application/octet-stream';
          return `[Binary content: ${item.mimeType || 'unknown type'}, ${item.blob?.length || 0} bytes]`;
        }
        return JSON.stringify(item);
      }).join('\n\n');
      content = processedContent;
    } else if (typeof content === 'object') {
      content = JSON.stringify(content, null, 2);
      mimeType = 'application/json';
    }

    if (currentToaster) {
      currentToaster.innerText = currentToaster.innerText.replace(
        `📄 Loading resource: ${resourceUri}...`,
        `📄 Loaded resource: ${resourceUri} (${content.length} chars)`
      );
    }

    const resourceResult = {
      content,
      uri: resourceUri,
      mimeType,
      serverId: targetServerId,
    };

    // Store for future conversation turns
    const updatedActiveResources = {
      ...state.activeResources,
      [resourceUri]: resourceResult,
    };

    return {
      resourceContent: resourceResult,
      activeResources: updatedActiveResources,
      isResourceProcessed: true,
    };
  } catch (error) {
    console.error(
      `❌ [RESOURCE ERROR] Error processing resource "${resourceUri}":`,
      error
    );

    if (currentToaster) {
      currentToaster.innerText = currentToaster.innerText.replace(
        `📄 Loading resource: ${resourceUri}...`,
        `❌ Resource failed: ${error.message}`
      );
    }

    // Continue without resource content rather than failing
    return {
      resourceContent: {
        content: "",
        uri: resourceUri,
        mimeType: 'text/plain',
        serverId: state.serverId,
        error: error.message,
      },
      // Mark as processed even on error to avoid retry loops
      isResourceProcessed: true,
    };
  }
};

// MCP Prompt processing node - handles prompt argument extraction and system prompt enhancement
const processPromptContext = async (state: typeof MCPAgentState.State) => {
  if (!state.promptContext?.isPromptCall) {
    return {}; // No prompt context, continue normally
  }

  // Skip processing if already done in this conversation (stateful optimization)
  if (state.isPromptProcessed && state.mcpPromptGuidance) {
    console.log(
      `📝 [PROMPT PROCESSING] Skipping - already processed in this conversation`
    );
    return {
      promptEnhancement: {
        systemPromptAddition: state.mcpPromptGuidance,
        userPromptEnhancement: "",
        promptName: state.promptContext.promptName,
        arguments: {},
      },
    };
  }

  const { promptName } = state.promptContext;
  console.log(`📝 [PROMPT PROCESSING] Processing MCP prompt: ${promptName}`);

  const currentToaster = state.mcpToasterStream;
  if (currentToaster) {
    currentToaster.innerText += `\n📝 Processing prompt: ${promptName}...`;
  }

  try {
    // Get the first server client (prompts should be server-specific)
    const isMultiple = isMultiServer(state.serverId);
    const serverIds = isMultiple ? state.serverId : [state.serverId];
    const client = mcpManager.getClient(serverIds[0]);

    if (!client) {
      throw new Error(`MCP server not connected`);
    }

    // Get prompt definition first to check for arguments
    // Use mcpManager to get all prompts (including fake test prompts)
    const allPrompts = mcpManager.getAllPrompts();
    const promptDef = allPrompts.find((p) => p.name === promptName);

    if (!promptDef) {
      throw new Error(`Prompt "${promptName}" not found`);
    }

    let promptArguments = {};

    // If prompt has arguments (required or optional), extract them from user prompt
    if (promptDef.arguments && promptDef.arguments.length > 0) {
      const requiredArgs = promptDef.arguments.filter((arg) => arg.required);
      const optionalArgs = promptDef.arguments.filter((arg) => !arg.required);

      if (requiredArgs.length > 0 || optionalArgs.length > 0) {
        console.log(
          `📝 [PROMPT ARGS] Extracting arguments for prompt: ${promptName}`
        );

        // Use LLM to extract arguments from user prompt
        const argExtractionPrompt = `Extract the following arguments from the user's prompt for the MCP prompt "${promptName}":

Required arguments:
${requiredArgs
  .map((arg) => `- ${arg.name}: ${arg.description || "No description"}`)
  .join("\n")}

${
  optionalArgs.length > 0
    ? `Optional arguments:
${optionalArgs
  .map((arg) => `- ${arg.name}: ${arg.description || "No description"}`)
  .join("\n")}`
    : ""
}

User prompt: "${state.userPrompt}"

Respond with JSON only, like: {"arg1": "value1", "arg2": "value2"}
If a required argument cannot be extracted, set it to null.`;

        const extractionResponse = await llm.invoke([
          new HumanMessage({ content: argExtractionPrompt }),
        ]);

        try {
          promptArguments = JSON.parse(extractionResponse.content.toString());
          console.log(`📝 [PROMPT ARGS] Extracted arguments:`, promptArguments);
        } catch (error) {
          console.warn(
            `📝 [PROMPT ARGS] Failed to parse extracted arguments:`,
            error
          );
          promptArguments = {};
        }

        // Check if any required arguments are missing
        const missingRequired = requiredArgs.filter(
          (arg) =>
            !promptArguments[arg.name] || promptArguments[arg.name] === null
        );

        if (missingRequired.length > 0) {
          throw new Error(
            `Missing required arguments for prompt "${promptName}": ${missingRequired
              .map((a) => a.name)
              .join(", ")}`
          );
        }
      }
    }

    // Get the completed prompt with arguments
    // Use mcpManager to handle both real and fake test prompts
    const promptResponse = await mcpManager.getPrompt(
      serverIds[0],
      promptName,
      promptArguments
    );

    console.log(
      "📝 [PROMPT RESPONSE] Full response:",
      JSON.stringify(promptResponse, null, 2)
    );

    if (!promptResponse.result || !promptResponse.result.messages) {
      throw new Error(`No messages from MCP prompt "${promptName}"`);
    }

    // Extract system prompt additions and user prompt enhancements
    let systemPromptAddition = "";
    let userPromptEnhancement = "";

    console.log(
      `📝 [PROMPT MESSAGES] Processing ${promptResponse.result.messages.length} messages:`
    );
    promptResponse.result.messages.forEach((message, index) => {
      console.log(
        `📝 [MESSAGE ${index}] Role: ${message.role}, Content type: ${message.content?.type}`
      );
      if (message.role === "system" && message.content.type === "text") {
        systemPromptAddition += message.content.text + "\n";
        console.log(
          `📝 [SYSTEM] Added ${message.content.text.length} chars to system prompt`
        );
      } else if (message.role === "user" && message.content.type === "text") {
        userPromptEnhancement = message.content.text;
      }
    });

    if (currentToaster) {
      currentToaster.innerText = currentToaster.innerText.replace(
        `📝 Processing prompt: ${promptName}...`,
        `📝 Applied prompt: ${promptName}`
      );
    }

    return {
      promptEnhancement: {
        systemPromptAddition,
        userPromptEnhancement,
        promptName,
        arguments: promptArguments,
      },
      // Store the guidance for future conversation turns
      mcpPromptGuidance: systemPromptAddition,
      isPromptProcessed: true,
    };
  } catch (error) {
    console.error(
      `❌ [PROMPT ERROR] Error processing prompt "${promptName}":`,
      error
    );

    if (currentToaster) {
      currentToaster.innerText = currentToaster.innerText.replace(
        `📝 Processing prompt: ${promptName}...`,
        `❌ Prompt failed: ${error.message}`
      );
    }

    // Continue without prompt enhancement rather than failing
    return {
      promptEnhancement: {
        systemPromptAddition: "",
        userPromptEnhancement: "",
        promptName,
        arguments: {},
        error: error.message,
      },
      // Mark as processed even on error to avoid retry loops
      mcpPromptGuidance: "",
      isPromptProcessed: true,
    };
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

  // System prompt already includes MCP guidance from loadModel or processPromptContext
  let currentSystemMsg = sys_msg;

  // Rebuild system prompt if we have fresh MCP prompt enhancement
  if (state.promptEnhancement?.systemPromptAddition) {
    console.log(
      `🔄 [ASSISTANT] Rebuilding system prompt with fresh MCP prompt enhancement`
    );

    // Rebuild system prompt with fresh enhancement
    const serverInfo = buildServerInfo(
      state.serverName as any,
      Array.isArray(state.serverId)
    );
    const { toolDescriptions, preferredToolGuidance } = buildToolDescriptions(
      state.availableToolsForDynamic || [],
      state.preferredToolName,
      Array.isArray(state.serverId)
    );
    const conversationContextData = buildConversationContext(state);

    // Build resource content for enhanced system prompt
    const resourceContent = buildResourceContent(
      state.activeResources || {},
      state.resourceContent
    );

    const enhancedSystemPrompt = buildSystemPrompt({
      serverInfo,
      isMultiple: Array.isArray(state.serverId),
      preferredToolGuidance,
      executionPlan: state.executionPlan,
      toolDescriptions,
      conversationContext: conversationContextData.conversationContext,
      conversationOptimization:
        conversationContextData.conversationOptimization,
      style: state.style,
      userPrompt: state.userPrompt,
      mcpPromptGuidance: state.promptEnhancement.systemPromptAddition,
      resourceContent, // Include resource content
    });

    currentSystemMsg = new SystemMessage({ content: enhancedSystemPrompt });

    console.log(
      `📝 [ASSISTANT] Rebuilt system prompt with MCP guidance from "${state.promptEnhancement.promptName}"`
    );
  } else if (state.mcpPromptGuidance) {
    console.log(
      `📝 [ASSISTANT] Using pre-loaded MCP prompt guidance (${state.mcpPromptGuidance.length} chars)`
    );
  } else {
    console.log(`📝 [ASSISTANT] No MCP prompt guidance available`);
  }

  console.log(
    `📝 [ASSISTANT] Assistant systemPrompt:`,
    currentSystemMsg.content
  );

  const messages = [currentSystemMsg, ...state.messages];

  console.log(
    `🤖 [ASSISTANT] System prompt length: ${currentSystemMsg.content.length} chars`
  );
  console.log(
    `🤖 [ASSISTANT] Tool names:`,
    state.mcpTools?.map((t) => t.name) || []
  );

  // Log MessagesAnnotation state to verify it's up-to-date
  console.log(
    `📨 [MESSAGES] MessagesAnnotation state (${state.messages.length} messages):`
  );
  state.messages.forEach((msg, index) => {
    const role =
      msg._getType() === "human"
        ? "User"
        : msg._getType() === "ai"
        ? "Assistant"
        : msg._getType() === "tool"
        ? "Tool"
        : msg._getType() === "system"
        ? "System"
        : msg._getType();
    const content =
      typeof msg.content === "string"
        ? msg.content.substring(0, 100)
        : JSON.stringify(msg.content).substring(0, 100);
    console.log(
      `📨 [MESSAGE ${index}] ${role}: ${content}${
        content.length >= 100 ? "..." : ""
      }`
    );
  });

  console.log("🤖 [ASSISTANT] Full messages being sent to LLM:", messages);

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
      if (
        turnTokensUsage &&
        (turnTokensUsage.input_tokens || turnTokensUsage.output_tokens)
      ) {
        const inputTokens = turnTokensUsage.input_tokens || 0;
        const outputTokens = turnTokensUsage.output_tokens || 0;
        currentToaster.innerText += `\n🔢 Tokens: ${inputTokens} in / ${outputTokens} out`;
      }
    }
    console.log(`🏁 [MCP AGENT] Total execution time: ${totalDuration}s`);

    // Log token usage if available
    if (
      turnTokensUsage &&
      (turnTokensUsage.input_tokens || turnTokensUsage.output_tokens)
    ) {
      const inputTokens = turnTokensUsage.input_tokens || 0;
      const outputTokens = turnTokensUsage.output_tokens || 0;
      console.log(
        `🔢 [MCP AGENT] Tokens used: ${inputTokens} input / ${outputTokens} output`
      );
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
    // Return the stateful MCP prompt guidance for future conversation turns
    mcpPromptGuidance: state.mcpPromptGuidance,
    isPromptProcessed: state.isPromptProcessed,
    // Return the stateful resource content for future conversation turns
    activeResources: state.activeResources,
    isResourceProcessed: state.isResourceProcessed,
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

// Custom tools node that caches results with resource deduplication
const toolsWithCaching = async (state: typeof MCPAgentState.State) => {
  const toolNode = new ToolNode(state.mcpTools);
  const result = await toolNode.invoke(state);

  // Cache tool results for conversation continuity with resource deduplication
  const toolMessages = result.messages.filter(
    (msg: any) => msg._getType() === "tool"
  );
  const updatedCache = { ...state.toolResultsCache };

  toolMessages.forEach((msg: any) => {
    if (msg.tool_call_id && msg.content) {
      const toolName = msg.name;
      const isResourceTool = toolName?.startsWith("resource_");
      const isPromptTool = toolName?.startsWith("prompt_");

      if (isResourceTool || isPromptTool) {
        // For resources and prompts, check if we already have this content cached
        // Use tool name + content hash for large content to avoid expensive comparisons
        const contentStr = msg.content.toString();
        const isLargeContent = contentStr.length > 10000;
        const contentKey = isLargeContent
          ? `${toolName}_${contentStr.length}_${contentStr.substring(0, 100)}`
          : contentStr;

        const existingCacheKey = Object.keys(updatedCache).find((key) => {
          const cached = updatedCache[key];
          if (
            cached.tool_name !== toolName ||
            cached.type !== (isResourceTool ? "resource" : "prompt")
          ) {
            return false;
          }

          // For large content, use the content key for fast comparison
          if (isLargeContent) {
            const cachedContentStr = cached.content.toString();
            const cachedContentKey = `${cached.tool_name}_${
              cachedContentStr.length
            }_${cachedContentStr.substring(0, 100)}`;
            return cachedContentKey === contentKey;
          }

          // For small content, direct comparison is fine
          return cached.content === msg.content;
        });

        if (existingCacheKey) {
          // Resource/prompt already cached - just update timestamp and reference the existing cache
          updatedCache[existingCacheKey].timestamp = Date.now();
          updatedCache[existingCacheKey].lastAccessedBy = msg.tool_call_id;
          console.log(
            `🔄 [CACHE] Reusing cached ${
              isResourceTool ? "resource" : "prompt"
            }: ${toolName}`
          );
        } else {
          // New resource/prompt - cache it
          updatedCache[msg.tool_call_id] = {
            content: msg.content,
            timestamp: Date.now(),
            tool_name: toolName,
            type: isResourceTool ? "resource" : "prompt",
            lastAccessedBy: msg.tool_call_id,
          };
          console.log(
            `💾 [CACHE] Cached new ${
              isResourceTool ? "resource" : "prompt"
            }: ${toolName}`
          );
        }
      } else {
        // Regular tools - cache normally (they may have different results each time)
        updatedCache[msg.tool_call_id] = {
          content: msg.content,
          timestamp: Date.now(),
          tool_name: toolName,
          type: "tool",
        };
      }
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
    .addNode("processResourceContext", processResourceContext)
    .addNode("processPromptContext", processPromptContext)
    .addNode("multiServerPlanning", multiServerPlanning)
    .addNode("assistant", assistant)
    .addNode("tools", toolsWithCaching)
    .addNode("insertResponse", insertResponse)

    .addEdge(START, "loadModel")
    .addConditionalEdges("loadModel", (state) => {
      // Check if this is a resource call that needs processing
      if (state.resourceContext?.isResourceCall) {
        // Only process if not already done in this conversation
        if (!state.isResourceProcessed) {
          console.log(
            `🔄 [GRAPH] Processing MCP resource: ${state.resourceContext.resourceUri}`
          );
          return "processResourceContext";
        } else {
          console.log(
            `🔄 [GRAPH] MCP resource already processed, skipping to next step`
          );
        }
      }

      // Check if this is a prompt call that needs processing
      if (state.promptContext?.isPromptCall) {
        // Only process if not already done in this conversation
        if (!state.isPromptProcessed) {
          console.log(
            `🔄 [GRAPH] Processing MCP prompt: ${state.promptContext.promptName}`
          );
          return "processPromptContext";
        } else {
          console.log(
            `🔄 [GRAPH] MCP prompt already processed, skipping to next step`
          );
        }
      }

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
    .addConditionalEdges("processResourceContext", (state) => {
      // After processing resource, check for prompt processing or continue with normal flow
      if (state.promptContext?.isPromptCall && !state.isPromptProcessed) {
        return "processPromptContext";
      }

      const isMultiple = Array.isArray(state.serverId);

      if (state.preferredToolName) {
        return "assistant";
      }

      if (!isMultiple) {
        return "assistant";
      }

      return "multiServerPlanning";
    })
    .addConditionalEdges("processPromptContext", (state) => {
      // After processing prompt, continue with normal flow
      const isMultiple = Array.isArray(state.serverId);

      if (state.preferredToolName) {
        return "assistant";
      }

      if (!isMultiple) {
        return "assistant";
      }

      return "multiServerPlanning";
    })
    .addEdge("multiServerPlanning", "assistant")
    .addConditionalEdges("assistant", shouldContinue)
    .addEdge("tools", "assistant")
    .addEdge("insertResponse", "__end__");

  return builder.compile();
};
