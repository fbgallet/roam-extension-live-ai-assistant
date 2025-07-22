import { mcpManager } from "./mcpManager.js";
import { getAndNormalizeContext } from "../ai/dataExtraction.js";
import {
  modelAccordingToProvider,
  openaiCompletion,
  claudeCompletion,
} from "../ai/aiAPIsHub.js";
import { insertStructuredAIResponse } from "../ai/responseInsertion.js";

export class MCPAgentV2 {
  /**
   * Execute MCP Agent using native function calling (proper MCP standard)
   * This approach uses the LLM's native function calling capabilities
   * instead of prompt parsing, which is the correct MCP pattern.
   */
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
    console.log("🤖 MCPAgentV2.executeMCPAgent called with:", {
      serverId,
      serverName,
      userPrompt,
      instantModel,
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
        contextData = await MCPAgentV2.prepareContextForMCP(roamContext);
      }

      // Combine user prompt with additional prompt
      let finalPrompt = userPrompt;
      if (additionalPrompt) {
        finalPrompt = `${userPrompt}\n\n${additionalPrompt}`;
      }

      // Add context if available
      if (contextData) {
        finalPrompt = `Context from Roam Research:\n${contextData}\n\nUser Request: ${finalPrompt}`;
      }

      // Use native function calling if model supports it
      const supportsFunction =
        MCPAgentV2.modelSupportsFunctionCalling(instantModel);

      // TEMPORARY: Force structured prompting for debugging
      console.log("🔧 TEMPORARILY forcing structured prompting for debugging");
      return await MCPAgentV2.executeWithStructuredPrompting({
        serverId,
        serverName,
        finalPrompt,
        tools,
        resources,
        instantModel,
        sourceUid,
        target,
        style,
      });

      /*
      if (supportsFunction) {
        console.log("✅ Using native function calling for MCP integration");
        return await MCPAgentV2.executeWithNativeFunctionCalling({
          serverId,
          serverName,
          finalPrompt,
          tools,
          resources,
          instantModel,
          sourceUid,
          target,
          style,
        });
      } else {
        console.log(
          "⚠️  Fallback to structured prompting (model does not support function calling)"
        );
        // Fallback for models without function calling
        return await MCPAgentV2.executeWithStructuredPrompting({
          serverId,
          serverName,
          finalPrompt,
          tools,
          resources,
          instantModel,
          sourceUid,
          target,
          style,
        });
      }
      */
    } catch (error) {
      console.error(`❌ Error executing MCP agent for ${serverName}:`, error);
      return { success: false, error: error.message };
    }
  }

  static modelSupportsFunctionCalling(model) {
    if (!model) return false;

    console.log("🔍 Checking function calling support for model:", model);

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
      "claude-sonnet",
      "sonnet-4",
      "claude-4",
      "claude-sonnet-4", // Add Sonnet 4 variants
      "sonnet", // Generic sonnet
    ];

    const modelLower = model.toLowerCase();
    const supportsFC = functionCallingModels.some((m) =>
      modelLower.includes(m.toLowerCase())
    );

    console.log(`🔍 Model "${model}" supports function calling:`, supportsFC);
    return supportsFC;
  }

  static async executeWithNativeFunctionCalling({
    serverId,
    serverName,
    finalPrompt,
    tools,
    resources,
    instantModel,
    sourceUid,
    target,
    style,
  }) {
    const client = mcpManager.getClient(serverId);

    // Convert MCP tools to Claude format (different from OpenAI)
    const functionDefinitions = tools.map((tool) => ({
      name: tool.name,
      description:
        tool.description ||
        `Execute ${tool.name} tool from MCP server ${serverName}`,
      input_schema: tool.inputSchema || {
        type: "object",
        properties: {},
        required: [],
      },
    }));

    console.log(
      "🔧 Claude function definitions:",
      JSON.stringify(functionDefinitions, null, 2)
    );

    console.log("🔧 Function definitions for LLM:", functionDefinitions);

    try {
      const llm = modelAccordingToProvider(instantModel);
      if (!llm || !llm.provider) {
        throw new Error(`Unsupported model: ${instantModel}`);
      }

      let response;
      const messages = [
        {
          role: "user",
          content: `You are an AI assistant with access to MCP server "${serverName}". Use the available tools as needed to answer the user's request.\n\nUser request: ${finalPrompt}`,
        },
      ];

      if (llm.provider === "Anthropic") {
        // Claude function calling
        console.log(
          "🔧 Calling Claude with tools:",
          JSON.stringify(functionDefinitions, null, 2)
        );
        response = await claudeCompletion({
          model: llm.id,
          prompt: messages,
          command: "MCP Agent",
          systemPrompt: "",
          content: "",
          responseFormat: "text",
          targetUid: null,
          isButtonToInsert: false,
          tools: functionDefinitions, // Pass tools for Claude
        });
      } else {
        // OpenAI-style function calling
        response = await openaiCompletion({
          aiClient: llm.library,
          model: llm.id,
          systemPrompt: "",
          prompt: messages,
          command: "MCP Agent",
          content: "",
          responseFormat: "text",
          targetUid: null,
          isButtonToInsert: false,
          tools: functionDefinitions, // Pass tools for OpenAI
        });
      }

      console.log("🎯 LLM Response with function calling:", response);

      // Process function calls if any
      const toolResults = [];
      if (response.tool_calls || response.function_calls) {
        const calls = response.tool_calls || response.function_calls || [];

        for (const call of calls) {
          try {
            const toolName = call.function?.name || call.name;
            const args =
              typeof call.function?.arguments === "string"
                ? JSON.parse(call.function.arguments)
                : call.function?.arguments || call.arguments || {};

            console.log(`🔧 Executing MCP tool: ${toolName} with args:`, args);
            const result = await client.callTool(toolName, args);

            toolResults.push({
              tool: toolName,
              args,
              result: result.result,
            });
          } catch (error) {
            console.error(
              `❌ Error executing tool ${call.function?.name}:`,
              error
            );
            toolResults.push({
              tool: call.function?.name,
              error: error.message,
            });
          }
        }
      }

      // Get final response text
      const finalResponse =
        response.content || response.text || response.message || "";

      console.log("🎯 MCP Agent Final Response (V2):", finalResponse);
      console.log("🔧 Tools executed:", toolResults.length);
      if (toolResults.length > 0) {
        console.log("📊 Tool results:", toolResults);
      }

      // Insert the response into Roam using insertStructuredAIResponse
      if (finalResponse && sourceUid) {
        try {
          await insertStructuredAIResponse({
            targetUid: sourceUid,
            content: finalResponse,
            target,
            isTitleCompatible: false,
          });
          console.log("✅ MCP Agent response inserted into Roam successfully");
        } catch (error) {
          console.error("❌ Error inserting MCP Agent response into Roam:", error);
        }
      }

      return {
        success: true,
        result: finalResponse,
        toolsUsed: toolResults.length,
        toolResults,
      };
    } catch (error) {
      console.error("❌ Error with native function calling:", error);
      throw error;
    }
  }

  static async executeWithStructuredPrompting({
    serverId,
    serverName,
    finalPrompt,
    tools,
    resources,
    instantModel,
    sourceUid,
    target,
    style,
  }) {
    // Fallback implementation for models without function calling
    console.log("⚠️  Using structured prompting fallback");

    const client = mcpManager.getClient(serverId);

    // Generate enhanced prompt with tool descriptions
    let systemPrompt = `You are an AI assistant with access to MCP server "${serverName}". `;

    if (tools.length > 0) {
      systemPrompt += `\nYou have access to these tools:\n`;
      tools.forEach((tool) => {
        systemPrompt += `- ${tool.name}`;
        if (tool.description) {
          systemPrompt += `: ${tool.description}`;
        }
        // Add detailed parameter info if available
        if (tool.inputSchema && tool.inputSchema.properties) {
          const params = Object.keys(tool.inputSchema.properties)
            .map((key) => {
              const prop = tool.inputSchema.properties[key];
              let paramDesc = `${key}: ${prop.type}`;
              if (prop.description) {
                paramDesc += ` (${prop.description})`;
              }
              if (prop.enum) {
                paramDesc += ` [valid values: ${prop.enum.join(', ')}]`;
              }
              return paramDesc;
            })
            .join(", ");
          systemPrompt += ` (Parameters: ${params})`;
        }
        systemPrompt += "\n";
      });
    }

    systemPrompt += `\nTo use a tool, respond with:
TOOL_CALL: tool_name
ARGUMENTS: {"arg1": "value1", "arg2": "value2"}

IMPORTANT PARAMETER RULES:
1. Use the exact parameter names and values as specified in the tool schema
2. Pay attention to enum values and required parameters
3. When a tool returns data with IDs, names, or other identifiers, ALWAYS use the exact values from the tool results for subsequent tool calls
4. For example, if a tool returns a profile with id: "abc-123" and name: "John", use the ID "abc-123" (not the name "John") when that ID is required by another tool
5. Carefully analyze tool results to extract the correct values for subsequent operations

CRITICAL WORKFLOW:
- If you need to use tools to answer the question, ONLY provide tool calls initially
- Do NOT provide any answer or speculation before executing the tools
- Wait for all tool results before providing your final answer
- When chaining tools, carefully extract the exact parameter values from previous tool results

You can make multiple tool calls. After using tools, provide your final answer with:
FINAL_ANSWER: [your response here]

If you don't need any tools, provide your answer directly.`;

    const enhancedPrompt = `${systemPrompt}\n\nUser Request: ${finalPrompt}`;

    // Get LLM response
    const llm = modelAccordingToProvider(instantModel);
    if (!llm || !llm.provider) {
      throw new Error(`Unsupported model: ${instantModel}`);
    }

    const messages = [{ role: "user", content: enhancedPrompt }];
    let response;

    if (llm.provider === "Anthropic") {
      response = await claudeCompletion({
        model: llm.id,
        prompt: messages,
        command: "MCP Agent",
        systemPrompt: "",
        content: "",
        responseFormat: "text",
        targetUid: null,
        isButtonToInsert: false,
      });
      response = response.content || response.text || response || "";
    } else {
      response = await openaiCompletion({
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
      response = response.content || response.text || "";
    }

    console.log("🤖 LLM Response (structured):", response);

    // Parse and execute tools with enhanced error handling and parameter correction
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

            console.log(`🔧 Executing MCP tool: ${toolName} with args:`, args);
            const result = await client.callTool(toolName, args);

            if (result.result) {
              toolResults.push({
                tool: toolName,
                args,
                result: result.result,
              });
              console.log(`✅ Tool ${toolName} executed successfully:`, result.result);
            }
          } catch (error) {
            console.error(`❌ Error executing tool ${toolName}:`, error);
            console.error(`❌ Failed args:`, args);
            
            // Try to provide helpful error context
            let errorContext = error.message;
            if (error.message.includes("not found") && toolResults.length > 0) {
              // Check if we have data from previous tools that could help
              const previousResults = toolResults.map(tr => tr.result).filter(r => r);
              console.log(`💡 Hint: Previous tool results that might contain correct parameters:`, previousResults);
              errorContext += `\n\nNote: Previous tools returned data that might contain the correct parameters for this operation.`;
            }
            
            toolResults.push({
              tool: toolName,
              args,
              error: errorContext,
            });
          }
        }
      }
    }

    // If tools were used, get final synthesis - ignore the first response
    let finalResponse = response;
    if (toolResults.length > 0) {
      const toolResultsText = toolResults
        .map((tr, index) => {
          if (tr.tool) {
            return `${index}: args: ${JSON.stringify(tr.args)} result: ${JSON.stringify(tr.result || tr.error)}`;
          }
          return "";
        })
        .join("\n");

      const synthesisPrompt = `Based on the user request: "${finalPrompt}"

Tool execution results:
${toolResultsText}

IMPORTANT: Analyze the tool results carefully. If you notice that some tool calls failed due to incorrect parameters (like using a name instead of an ID), explain this in your response and suggest what the correct approach should have been.

Please provide a comprehensive answer that synthesizes this information and addresses the user's request. If there were parameter errors that prevented getting complete results, explain what information is available and what couldn't be retrieved due to the parameter issues.`;

      console.log('🔄 Synthesizing final response with tool results...');
      console.log('⚠️  Ignoring first LLM response (contained tool calls + hallucinations)');
      console.log('📊 Tool results for synthesis:', toolResultsText);
      finalResponse = await MCPAgentV2.getLLMResponse(synthesisPrompt, instantModel);
    }

    // Extract final answer if present (from either original response or synthesis)
    const finalAnswerMatch = finalResponse.match(/FINAL_ANSWER:\s*([\s\S]*)/);
    if (finalAnswerMatch) {
      finalResponse = finalAnswerMatch[1].trim();
    }

    console.log("🎯 MCP Agent Final Response (Structured):", finalResponse);
    console.log("🔧 Tools executed:", toolResults.length);
    if (toolResults.length > 0) {
      console.log("📊 Tool results:", toolResults);
    }

    // Insert the response into Roam using insertStructuredAIResponse
    if (finalResponse && sourceUid) {
      try {
        await insertStructuredAIResponse({
          targetUid: sourceUid,
          content: finalResponse,
          target,
          isTitleCompatible: false,
        });
        console.log("✅ MCP Agent response inserted into Roam successfully");
      } catch (error) {
        console.error("❌ Error inserting MCP Agent response into Roam:", error);
      }
    }

    return {
      success: true,
      result: finalResponse,
      toolsUsed: toolResults.length,
      toolResults,
    };
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

  static async getLLMResponse(prompt, model) {
    try {
      console.log('🔍 Getting LLM response for synthesis with model:', model);
      const llm = modelAccordingToProvider(model);
      
      if (!llm || !llm.provider) {
        throw new Error(`Unsupported model: ${model}`);
      }

      const messages = [{ role: "user", content: prompt }];
      
      if (llm.provider === "Anthropic") {
        const response = await claudeCompletion({
          model: llm.id,
          prompt: messages,
          command: "MCP Agent",
          systemPrompt: "",
          content: "",
          responseFormat: "text",
          targetUid: null,
          isButtonToInsert: false
        });
        return response.content || response.text || response || "";
      } else {
        // For OpenAI, OpenRouter, Groq, DeepSeek, etc.
        const response = await openaiCompletion({
          aiClient: llm.library,
          model: llm.id,
          systemPrompt: "",
          prompt: messages,
          command: "MCP Agent",
          content: "",
          responseFormat: "text",
          targetUid: null,
          isButtonToInsert: false
        });
        return response.content || response.text || response || "";
      }
    } catch (error) {
      console.error('❌ Error getting LLM response for synthesis:', error);
      throw error;
    }
  }
}

export default MCPAgentV2;
