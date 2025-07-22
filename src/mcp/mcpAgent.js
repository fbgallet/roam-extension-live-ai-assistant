import { mcpManager } from "./mcpManager.js";
import { aiCompletionRunner } from "../ai/responseInsertion.js";
import { getAndNormalizeContext } from "../ai/dataExtraction.js";
import {
  modelAccordingToProvider,
  openaiCompletion,
  claudeCompletion,
} from "../ai/aiAPIsHub.js";
import {
  createChildBlock,
  createSiblingBlock,
  insertBlockInCurrentView,
} from "../utils/roamAPI.js";

export class MCPAgent {
  static async executeMCPAgent({
    serverId,
    serverName,
    userPrompt,
    sourceUid,
    additionalPrompt = "",
    instantModel,
    target = "new",
    roamContext = null,
    style = "Normal",
  }) {
    console.log("🤖 MCPAgent.executeMCPAgent called with:", {
      serverId,
      serverName,
      userPrompt,
      instantModel,
      target,
    });

    try {
      const client = mcpManager.getClient(serverId);
      if (!client) {
        console.error(`❌ MCP client not found for serverId: ${serverId}`);
        throw new Error(`MCP server ${serverName} not connected`);
      }

      const tools = client.getTools();
      const resources = client.getResources();

      console.log(
        `🔧 MCP Server "${serverName}" has ${tools.length} tools and ${resources.length} resources:`,
        {
          tools: tools.map((t) => t.name),
          resources: resources.map((r) => r.name || r.uri),
        }
      );

      if (!tools.length && !resources.length) {
        throw new Error(
          `No tools or resources available on MCP server ${serverName}`
        );
      }

      // Prepare Roam context if available
      let contextData = "";
      if (roamContext) {
        contextData = await MCPAgent.prepareContextForMCP(roamContext);
      }

      // Generate system prompt with available tools
      const systemPrompt = MCPAgent.generateSystemPrompt(
        serverName,
        tools,
        resources,
        contextData
      );

      // Combine user prompt with additional prompt
      let finalPrompt = userPrompt;
      if (additionalPrompt) {
        finalPrompt = `${userPrompt}\n\n${additionalPrompt}`;
      }

      // Use function calling if model supports it
      const supportsFunction =
        MCPAgent.modelSupportsFunctionCalling(instantModel);

      if (supportsFunction) {
        return await MCPAgent.executeWithFunctionCalling({
          serverId,
          systemPrompt,
          finalPrompt,
          tools,
          resources,
          sourceUid,
          instantModel,
          target,
          style,
        });
      } else {
        return await MCPAgent.executeWithStructuredPrompting({
          serverId,
          systemPrompt,
          finalPrompt,
          tools,
          resources,
          sourceUid,
          instantModel,
          target,
          style,
        });
      }
    } catch (error) {
      console.error(`Error executing MCP agent for ${serverName}:`, error);

      const errorMessage = `Error with MCP Agent "${serverName}": ${error.message}`;
      await aiCompletionRunner({
        sourceUid,
        prompt: errorMessage,
        additionalPrompt: "",
        command: `MCP Agent Error: ${serverName}`,
        instantModel: instantModel || "gpt-4o-mini",
        includeUids: false,
        target,
        style: "Normal",
        roamContext: null,
      });

      return { success: false, error: error.message };
    }
  }

  static generateSystemPrompt(serverName, tools, resources, contextData) {
    let systemPrompt = `You are an AI assistant with access to MCP server "${serverName}". `;

    if (contextData) {
      systemPrompt += `\n\nYou have access to the following Roam Research context:\n${contextData}\n`;
    }

    if (tools.length > 0) {
      systemPrompt += `\nYou have access to these tools:\n`;
      tools.forEach((tool) => {
        systemPrompt += `- ${tool.name}`;
        if (tool.description) {
          systemPrompt += `: ${tool.description}`;
        }
        if (tool.inputSchema && tool.inputSchema.properties) {
          const params = Object.keys(tool.inputSchema.properties)
            .map((key) => {
              const prop = tool.inputSchema.properties[key];
              return `${key}: ${prop.type}${
                prop.description ? ` (${prop.description})` : ""
              }`;
            })
            .join(", ");
          systemPrompt += ` (${params})`;
        }
        systemPrompt += "\n";
      });
    }

    if (resources.length > 0) {
      systemPrompt += `\nYou can access these resources:\n`;
      resources.forEach((resource) => {
        systemPrompt += `- ${resource.name || resource.uri}`;
        if (resource.description) {
          systemPrompt += `: ${resource.description}`;
        }
        systemPrompt += "\n";
      });
    }

    systemPrompt += `\nUse these tools and resources as needed to answer the user's request. You can call multiple tools in sequence if necessary. Always provide a comprehensive response that synthesizes the information from the tools you use.`;

    return systemPrompt;
  }

  static modelSupportsFunctionCalling(model) {
    if (!model) return false;

    // List of models that support function calling
    const functionCallingModels = [
      "gpt-4",
      "gpt-4-turbo",
      "gpt-4o",
      "gpt-4o-mini",
      "claude-3-opus",
      "claude-3-sonnet",
      "claude-3-haiku",
      "claude-3-5-sonnet",
      "claude-3-5-haiku",
      "claude-sonnet-4",
    ];

    return functionCallingModels.some((m) =>
      model.toLowerCase().includes(m.toLowerCase())
    );
  }

  static async executeWithFunctionCalling({
    serverId,
    systemPrompt,
    finalPrompt,
    tools,
    resources,
    sourceUid,
    instantModel,
    target,
    style,
  }) {
    // For now, fall back to structured prompting
    // TODO: Implement proper function calling when the LLM client supports it
    return await MCPAgent.executeWithStructuredPrompting({
      serverId,
      systemPrompt,
      finalPrompt,
      tools,
      resources,
      sourceUid,
      instantModel,
      target,
      style,
    });
  }

  static async executeWithStructuredPrompting({
    serverId,
    systemPrompt,
    finalPrompt,
    tools,
    resources,
    sourceUid,
    instantModel,
    target,
    style,
  }) {
    const client = mcpManager.getClient(serverId);

    // Enhanced prompt for structured tool calling
    const enhancedPrompt = `${systemPrompt}

User Request: ${finalPrompt}

If you need to use any tools, respond with the following format:
TOOL_CALL: tool_name
ARGUMENTS: {"arg1": "value1", "arg2": "value2"}

If you need to access a resource, respond with:
RESOURCE_ACCESS: resource_uri

You can make multiple tool calls by repeating the format.
After using tools, provide your final answer with:
FINAL_ANSWER: [your comprehensive response here]

If you don't need any tools, just provide your answer directly.`;

    // First LLM call to get tool usage plan
    let response = await MCPAgent.getLLMResponse(enhancedPrompt, instantModel);
    console.log("🤖 LLM Response for tool calling:", response);

    // Parse and execute tools
    const toolResults = [];
    const lines = response.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith("TOOL_CALL:")) {
        const toolName = line.replace("TOOL_CALL:", "").trim();
        const nextLine = lines[i + 1];

        if (nextLine && nextLine.trim().startsWith("ARGUMENTS:")) {
          try {
            const argsStr = nextLine.replace("ARGUMENTS:", "").trim();
            const args = JSON.parse(argsStr);

            console.log(`Executing MCP tool: ${toolName} with args:`, args);
            const result = await client.callTool(toolName, args);

            if (result.result) {
              toolResults.push({
                tool: toolName,
                args,
                result: result.result,
              });
            }
          } catch (error) {
            console.error(`Error executing tool ${toolName}:`, error);
            toolResults.push({
              tool: toolName,
              error: error.message,
            });
          }
        }
      } else if (line.startsWith("RESOURCE_ACCESS:")) {
        const resourceUri = line.replace("RESOURCE_ACCESS:", "").trim();

        try {
          console.log(`Accessing MCP resource: ${resourceUri}`);
          const result = await client.getResource(resourceUri);

          if (result.result) {
            toolResults.push({
              resource: resourceUri,
              result: result.result,
            });
          }
        } catch (error) {
          console.error(`Error accessing resource ${resourceUri}:`, error);
          toolResults.push({
            resource: resourceUri,
            error: error.message,
          });
        }
      }
    }

    // If tools were used, get final synthesis
    let finalResponse = response;
    if (toolResults.length > 0) {
      const toolResultsText = toolResults
        .map((tr) => {
          if (tr.tool) {
            return `Tool ${tr.tool} result: ${JSON.stringify(
              tr.result || tr.error
            )}`;
          } else if (tr.resource) {
            return `Resource ${tr.resource} content: ${JSON.stringify(
              tr.result || tr.error
            )}`;
          }
          return "";
        })
        .join("\n");

      const synthesisPrompt = `Based on the user request: "${finalPrompt}"

Tool execution results:
${toolResultsText}

Please provide a comprehensive answer that synthesizes this information and addresses the user's request.`;

      finalResponse = await MCPAgent.getLLMResponse(
        synthesisPrompt,
        instantModel
      );
    }

    // Extract final answer if present
    const finalAnswerMatch = finalResponse.match(/FINAL_ANSWER:\s*([\s\S]*)/);
    if (finalAnswerMatch) {
      finalResponse = finalAnswerMatch[1].trim();
    }

    // For development: display response in console instead of inserting into Roam
    console.log("🎯 MCP Agent Final Response:", finalResponse);
    console.log("🔧 Tools executed:", toolResults.length);
    if (toolResults.length > 0) {
      console.log("📊 Tool results:", toolResults);
    }

    return {
      success: true,
      result: finalResponse,
      toolsUsed: toolResults.length,
    };
  }

  static async getLLMResponse(prompt, model) {
    try {
      console.log("🔍 Getting LLM response for model:", model);
      const llm = modelAccordingToProvider(model);
      console.log("🔍 Model config:", llm);

      if (!llm || !llm.provider) {
        throw new Error(`Unsupported model: ${model}`);
      }

      const messages = [{ role: "user", content: prompt }];

      if (llm.provider === "anthropic") {
        const response = await claudeCompletion({
          model: llm.id,
          prompt: messages,
          command: "MCP Agent",
          systemPrompt: "",
          content: "",
          responseFormat: "text",
          targetUid: null,
          isButtonToInsert: false,
        });
        return response.content || response.text || "";
      } else {
        // For OpenAI, OpenRouter, Groq, DeepSeek, etc.
        console.log(
          "🔍 Using OpenAI-style completion with client:",
          llm.library
        );
        const response = await openaiCompletion({
          aiClient: llm.library,
          model: llm.id,
          systemPrompt: "",
          prompt: messages,
          command: "MCP Agent",
          content: "",
          responseFormat: "text",
          targetUid: null,
          isButtonToInsert: false,
        });
        return response.content || response.text || "";
      }
    } catch (error) {
      console.error("❌ Error getting LLM response:", error);
      console.error("❌ Error details:", error.stack);
      throw error;
    }
  }

  static async prepareContextForMCP(roamContext) {
    if (!roamContext) return "";

    try {
      const context = await getAndNormalizeContext({ roamContext });
      return context;
    } catch (error) {
      console.error("Error preparing Roam context for MCP agent:", error);
      return "";
    }
  }
}

export default MCPAgent;
