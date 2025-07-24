import { roamBasicsFormat, stylePrompts } from "../../prompts";

// Type definitions
export interface MCPAgentState {
  isConversationMode: boolean;
  previousResponse?: string;
  toolResultsCache?: Record<string, any>;
  isRetry: boolean;
  isToRedoBetter: boolean;
}

// System message templates
export const multiServerPlanningTemplate = `You are an execution planner for multi-server MCP (Model Context Protocol) operations.

<SERVER_INFO>
<TOOL_DESCRIPTIONS>

You are coordinating tools across multiple MCP servers. Create a strategic execution plan that:
- Coordinates tools efficiently across different servers
- Identifies which server should handle each step
- Considers dependencies where tool outputs feed into subsequent operations
- Optimizes server usage and minimizes redundant operations

Provide an execution plan as a concise but complete numbered sequence:
1. do X with tool T1 from server S1
2. do Y with tool T2 from server S2 (using results from step 1)
3. etc.

Include key considerations for cross-server coordination.

Respond with JSON:
{
  "executionPlan": "detailed step-by-step plan",
  "reasoning": "brief explanation of coordination strategy"
}

User request: <USER_PROMPT>`;

export const systemPromptTemplate = `You are an AI assistant with access to MCP (Model Context Protocol) <SERVER_INFO>.

<PREFERRED_TOOL_GUIDANCE>

<CONVERSATION_CONTEXT>
<CONVERSATION_OPTIMIZATION>
Instructions for formatting your response:
${roamBasicsFormat}
<RESPONSE_STYLE>

REACT REASONING AND TOOL USAGE:
Follow the ReAct (Reasoning and Acting) pattern:

1. **REASON**: Think step-by-step about what you need to accomplish and which tools might help
2. **ACT**: Call the appropriate tool(s) based on your reasoning
3. **OBSERVE**: Analyze the tool results and determine if you need additional information
4. **REPEAT**: Continue the Reason → Act → Observe cycle until you have sufficient information

TOOL CHAINING STRATEGY:
- **Sequential reasoning**: After each tool call, reason about what the results tell you and what to do next
- **Chain dependencies**: Use outputs from one tool as inputs to subsequent tools when needed
- **Exact values**: When tools return IDs, names, or identifiers, use the EXACT values for subsequent tool calls (e.g., if a tool returns id: "abc-123", use "abc-123" not a similar name)
- **Parameter precision**: Always use exact parameter names as specified in the tool schema
- **Multi-step workflows**: Break complex tasks into logical steps, calling tools as needed at each step

<MULTI_SERVER_GUIDANCE>

FINAL RESPONSE GUIDANCE BASED ON OPERATION TYPE:
- **For ACTION operations** (writing to databases, creating elements, updating records, deleting items): Provide only a VERY CONCISE summary of what was accomplished (unless different instruction). Do NOT duplicate the full content of what was created/modified.
- **For RETRIEVAL operations** (fetching data, searching, reading information): Provide COMPREHENSIVE responses with the retrieved data that adds value to the user.
- **For CONVERSATIONAL operations** (user seeking advice, analysis, or interactive dialogue that may involve mixed actions/retrievals): Provide THOUGHTFUL, CONTEXTUAL responses that synthesize information and engage meaningfully with the user's intent, regardless of underlying tool operations.

Here is the user request: <USER_PROMPT>`;

export interface SystemPromptConfig {
  serverInfo: string;
  isMultiple: boolean;
  preferredToolGuidance: string;
  executionPlan?: string;
  toolDescriptions: string;
  conversationContext: string;
  conversationOptimization: string;
  style: string;
  userPrompt: string;
}

export interface PlanningPromptConfig {
  serverInfo: string;
  toolDescriptions: string;
  userPrompt: string;
  isRetryBetter: boolean;
  previousResponse?: string;
}

export const buildSystemPrompt = (config: SystemPromptConfig): string => {
  const executionPlanGuidance = config.executionPlan
    ? `\nEXECUTION PLAN:\n${config.executionPlan}\nFollow this plan but remain flexible if results require adjustments.\n`
    : "";

  const multiServerGuidance = config.isMultiple
    ? "\nMULTI-SERVER COORDINATION:\n- Tools are namespaced by server (e.g., server1:tool_name, server2:tool_name)\n- Consider cross-server workflows and data dependencies\n- Use appropriate servers for their specialized capabilities"
    : "";

  // Token optimization: Skip detailed tool descriptions for assistant execution
  // Tools are bound to LLM with precise schemas - descriptions are redundant
  const toolDescriptions = config.executionPlan
    ? "Tools will be provided as needed based on the execution plan."
    : config.isMultiple
    ? config.toolDescriptions // Keep descriptions for multi-server context
    : "MCP tools are available and will be provided with precise schemas when needed.";

  return systemPromptTemplate
    .replace("<SERVER_INFO>", config.serverInfo)
    .replace(
      "<RESPONSE_STYLE>",
      config.style !== "Normal"
        ? "\nWrite your response following this style:\n" +
            stylePrompts[config.style]
        : ""
    )
    .replace("<PREFERRED_TOOL_GUIDANCE>", config.preferredToolGuidance)
    .replace("<EXECUTION_PLAN_GUIDANCE>", executionPlanGuidance)
    .replace("<TOOL_DESCRIPTIONS>", toolDescriptions)
    .replace("<CONVERSATION_CONTEXT>", config.conversationContext)
    .replace("<CONVERSATION_OPTIMIZATION>", config.conversationOptimization)
    .replace("<MULTI_SERVER_GUIDANCE>", multiServerGuidance)
    .replace("<USER_PROMPT>", config.userPrompt);
};

export const buildPlanningPrompt = (config: PlanningPromptConfig): string => {
  let prompt = multiServerPlanningTemplate
    .replace("<SERVER_INFO>", config.serverInfo)
    .replace("<TOOL_DESCRIPTIONS>", config.toolDescriptions)
    .replace("<USER_PROMPT>", config.userPrompt);

  // Add retry context only if it's a retry scenario
  if (config.isRetryBetter && config.previousResponse) {
    prompt = prompt.replace(
      "You are coordinating tools across multiple MCP servers.",
      `PREVIOUS ATTEMPT ANALYSIS:
Previous response: ${config.previousResponse}
This is a retry to improve the previous response.

You are coordinating tools across multiple MCP servers.`
    );
  }

  return prompt;
};

// Conversation context templates
const CONVERSATION_CONTEXT_TEMPLATE = `
CONVERSATION CONTEXT:
Previous response: <PREVIOUS_RESPONSE>

Available cached tool results: <CACHED_RESULTS>

This is a follow-up question. Consider the previous context when responding.
`;

const CONVERSATION_OPTIMIZATION_TEMPLATE = `
CONVERSATION MODE OPTIMIZATION:
- In a conversation, if you have sufficient data from previous tool calls (provide above in the prompt), you should answer without making new tool calls
- Only make new tool calls if: 1) You need fresh/updated data, 2) The user is asking for something not covered by previous results, 3) You need to perform a new action
- When possible, reference and build upon previous responses and cached tool results
- Apply response guidance: Concise summaries for actions, comprehensive data for retrievals, thoughtful engagement for conversations
`;

const RETRY_CONTEXT_TEMPLATE = `
RETRY CONTEXT:
Previous response: <PREVIOUS_RESPONSE>

Available cached tool results: <CACHED_RESULTS>

This is a retry attempt to improve the previous response.
`;

const RETRY_OPTIMIZATION_TEMPLATE = `
RETRY MODE OPTIMIZATION:
- This is a retry attempt to improve the previous response
- Check the previous response and tool cache results to decide if you need new tool calls or can improve with existing data
- Only make new tool calls if: 1) Previous tools had errors, 2) You need additional data not in cache, 3) The retry instruction requires new information
- Focus on addressing the specific improvement requested in the retry instruction
- Apply response guidance: Concise summaries for actions, comprehensive data for retrievals, thoughtful engagement for conversations
`;

export const buildConversationContext = (state: any) => {
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

    conversationContext = CONVERSATION_CONTEXT_TEMPLATE.replace(
      "<PREVIOUS_RESPONSE>",
      state.previousResponse
    ).replace("<CACHED_RESULTS>", cachedResultsText);
    conversationOptimization = CONVERSATION_OPTIMIZATION_TEMPLATE;
  } else if (state.isRetry && state.isToRedoBetter && state.previousResponse) {
    // For better retry mode, include previous context but with retry-specific optimization
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
                contentStr.length > 50000
                  ? contentStr.substring(0, 50000) + "..."
                  : contentStr;
              return `\n- ${
                result.tool_name || "Unknown tool"
              } (${callId}): ${truncatedContent}`;
            })
            .join("")
        : "None";

    conversationContext = RETRY_CONTEXT_TEMPLATE.replace(
      "<PREVIOUS_RESPONSE>",
      state.previousResponse
    ).replace("<CACHED_RESULTS>", cachedResultsText);
    conversationOptimization = RETRY_OPTIMIZATION_TEMPLATE;
  }

  return {
    conversationContext,
    conversationOptimization,
  };
};

// Tool description templates
const PREFERRED_TOOL_SECTION = `
**Preferred Tool:**
- <TOOL_NAME>: <TOOL_DESCRIPTION><SCHEMA_INFO>

**Other Available Tools:**
<OTHER_TOOLS>

- request_tool_access: Get full access to any other tool by name
`;

const MULTI_SERVER_TOOLS_SECTION = `
**<SERVER_NAME> Server:**
<TOOLS_LIST>`;

export const buildToolDescriptions = (
  mcpToolsList: any[],
  preferredToolName?: string,
  isMultiple: boolean = false
) => {
  let toolDescriptions = "";
  let preferredToolGuidance = "";

  if (preferredToolName) {
    const preferredTool = mcpToolsList.find(
      (t: any) =>
        t.name === preferredToolName || t.name.endsWith(`:${preferredToolName}`)
    );
    const otherTools = mcpToolsList.filter(
      (t: any) =>
        t.name !== preferredToolName &&
        !t.name.endsWith(`:${preferredToolName}`)
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

      toolDescriptions = PREFERRED_TOOL_SECTION.replace(
        "<TOOL_NAME>",
        preferredTool.name
      )
        .replace("<TOOL_DESCRIPTION>", preferredTool.description)
        .replace("<SCHEMA_INFO>", schemaInfo)
        .replace(
          "<OTHER_TOOLS>",
          otherTools.map((t: any) => `- ${t.name}`).join("\n")
        );

      preferredToolGuidance = `PREFERRED TOOL GUIDANCE: The user wants to use the "${preferredToolName}" tool for this request. You MUST provide all required parameters when calling this tool. Start by attempting to use this tool with proper arguments, but feel free to use "request_tool_access" to get other tools if needed to complete the task effectively.\n`;
    }
  } else {
    if (isMultiple) {
      // Group tools by server for multi-server display
      const toolsByServer: { [key: string]: any[] } = {};
      mcpToolsList.forEach((tool) => {
        const serverName = tool.serverName || "unknown";
        if (!toolsByServer[serverName]) {
          toolsByServer[serverName] = [];
        }
        toolsByServer[serverName].push(tool);
      });

      toolDescriptions = Object.entries(toolsByServer)
        .map(([serverName, tools]) => {
          const toolList = tools
            .map(
              (t) => `- ${t.name}${t.description ? `: ${t.description}` : ""}`
            )
            .join("\n");
          return MULTI_SERVER_TOOLS_SECTION.replace(
            "<SERVER_NAME>",
            serverName
          ).replace("<TOOLS_LIST>", toolList);
        })
        .join("\n");
    } else {
      toolDescriptions = mcpToolsList
        .map(
          (t: any) => `- ${t.name}${t.description ? `: ${t.description}` : ""}`
        )
        .join("\n");
    }
    preferredToolGuidance = "";
  }

  return { toolDescriptions, preferredToolGuidance };
};

// Execution plan templates
export const MULTI_SERVER_PLAN_TEMPLATE = `Multi-server operation with <SERVER_NAMES>. Coordinate tools across servers as needed.`;
export const RETRY_PLAN_TEMPLATE = `Retry attempt: Analyze previous response and improve approach based on available tools.`;
