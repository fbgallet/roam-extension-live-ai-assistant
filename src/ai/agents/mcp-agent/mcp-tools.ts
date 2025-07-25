import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { mcpManager } from "./mcpManager";

// Extend Window interface for our global toaster element
declare global {
  interface Window {
    mcpToasterStreamElement?: HTMLElement | null;
  }
}

// Helper function to get filtered MCP tools based on user preferences
export const getFilteredMCPTools = (client: any, serverId: string) => {
  const allServerTools = client.getTools();
  const toolPreferences =
    mcpManager.extensionStorage?.get("mcpToolPreferences") || {};
  return allServerTools.filter((tool: any) => {
    const isEnabled = toolPreferences[serverId]?.[tool.name] !== false;
    return isEnabled;
  });
};

// Helper function to get MCP resources
export const getMCPResources = (client: any, serverId: string) => {
  try {
    const allResources = client.getResources();
    const resourcePreferences =
      mcpManager.extensionStorage?.get("mcpResourcePreferences") || {};
    return allResources.filter((resource: any) => {
      const isEnabled = resourcePreferences[serverId]?.[resource.uri] !== false;
      return isEnabled;
    });
  } catch (error) {
    console.warn(`Server ${serverId} does not support resources:`, error);
    return [];
  }
};

// Helper function to get MCP prompts
export const getMCPPrompts = (client: any, serverId: string) => {
  try {
    const allPrompts = client.getPrompts();
    const promptPreferences =
      mcpManager.extensionStorage?.get("mcpPromptPreferences") || {};
    return allPrompts.filter((prompt: any) => {
      const isEnabled = promptPreferences[serverId]?.[prompt.name] !== false;
      return isEnabled;
    });
  } catch (error) {
    console.warn(`Server ${serverId} does not support prompts:`, error);
    return [];
  }
};

// Helper function to create a full LangChain tool from MCP tool
export const createFullLangChainTool = (
  mcpTool: any,
  client: any,
  withToasterFeedback: boolean = false
) => {
  // Create Zod schema from MCP tool input schema
  const createZodSchema = (inputSchema: any): z.ZodObject<any> => {
    if (!inputSchema || !inputSchema.properties) {
      return z.object({});
    }

    const zodObject: Record<string, z.ZodType<any>> = {};

    const createZodTypeFromProperty = (property: any): z.ZodType<any> => {
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
          if (property.items) {
            const itemType = createZodTypeFromProperty(property.items);
            zodType = z.array(itemType);
          } else {
            zodType = z.array(z.any());
          }
          break;
        case "object":
          if (property.properties) {
            const nestedZodObject: Record<string, z.ZodType<any>> = {};
            for (const [nestedKey, nestedProp] of Object.entries(property.properties)) {
              let nestedZodType = createZodTypeFromProperty(nestedProp as any);
              
              if ((nestedProp as any).description) {
                nestedZodType = nestedZodType.describe((nestedProp as any).description);
              }
              
              if (!property.required || !property.required.includes(nestedKey)) {
                nestedZodType = nestedZodType.optional();
              }
              
              nestedZodObject[nestedKey] = nestedZodType;
            }
            zodType = z.object(nestedZodObject);
          } else {
            zodType = z.object({}).passthrough();
          }
          break;
        default:
          zodType = z.any();
      }

      return zodType;
    };

    for (const [key, prop] of Object.entries(inputSchema.properties)) {
      const property = prop as any;
      let zodType = createZodTypeFromProperty(property);

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
      const startTime = Date.now();
      
      // Toaster feedback for UI integration
      if (withToasterFeedback) {
        const toolCallMsg = `\n🔧 Calling ${mcpTool.name}...`;

        const currentToaster =
          window.mcpToasterStreamElement ||
          document.querySelector(".mcp-toaster .bp3-toast-message");
        if (currentToaster) {
          currentToaster.innerText += toolCallMsg;
        }
      }

      try {
        const result = await client.callTool(mcpTool.name, input);


        if (result.result) {
          const formattedResult = JSON.stringify(result.result, null, 2);
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          const responseLength = formattedResult.length;

          if (withToasterFeedback) {
            const responseMsg = `\n✅ Success (${duration}s, ${responseLength} chars)`;
            const currentToaster =
              window.mcpToasterStreamElement ||
              document.querySelector(".mcp-toaster .bp3-toast-message");
            if (currentToaster) {
              currentToaster.innerText += responseMsg;
            }
          }

          return formattedResult;
        } else if (result.error) {
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          
          if (withToasterFeedback) {
            const errorMsg = `\n❌ Failed (${duration}s): ${result.error}`;
            const currentToaster =
              window.mcpToasterStreamElement ||
              document.querySelector(".mcp-toaster .bp3-toast-message");
            if (currentToaster) {
              currentToaster.innerText += errorMsg;
            }
          }

          throw new Error(`MCP Tool Error: ${result.error}`);
        } else {
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          
          if (withToasterFeedback) {
            const warningMsg = `\n⚠️ No result (${duration}s)`;
            const currentToaster =
              window.mcpToasterStreamElement ||
              document.querySelector(".mcp-toaster .bp3-toast-message");
            if (currentToaster) {
              currentToaster.innerText += warningMsg;
            }
          }

          return "Tool executed but returned no result";
        }
      } catch (error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        
        if (withToasterFeedback) {
          const errorMsg = `\n💥 Exception (${duration}s): ${error.message}`;
          const currentToaster =
            window.mcpToasterStreamElement ||
            document.querySelector(".mcp-toaster .bp3-toast-message");
          if (currentToaster) {
            currentToaster.innerText += errorMsg;
          }
        }


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

// MCP Resources are handled as context content, not tools
// Resource functionality moved to resource context injection system

// MCP Prompts are no longer converted to tools - they enhance the system prompt directly
// The processPromptContext node in mcp-agent.ts handles prompt processing

// Helper function to create token-efficient tool set
export const createToolsForLLM = (
  mcpToolsList: any[],
  client: any,
  preferredToolName?: string,
  availableToolsForDynamic?: any[],
  mcpTools?: any[],
  currentClient?: any
) => {
  if (!preferredToolName) {
    // Normal behavior - return all tools with full descriptions
    return mcpToolsList.map((tool) => createFullLangChainTool(tool, client, true));
  }

  // Preferred tool mode - create optimized set
  const preferredTool = mcpToolsList.find((t) => t.name === preferredToolName);
  const otherTools = mcpToolsList.filter((t) => t.name !== preferredToolName);

  const tools = [];

  // Add preferred tool with full description
  if (preferredTool) {
    tools.push(createFullLangChainTool(preferredTool, client, true));
  }

  // Add "request_tool_access" meta-tool to get descriptions of other tools
  tools.push(
    tool(
      async ({ toolName }: { toolName: string }) => {
        const requestedTool = availableToolsForDynamic?.find(
          (t) => t.name === toolName
        );
        if (!requestedTool) {
          return `Tool "${toolName}" not found. Available tools: ${otherTools
            .map((t) => t.name)
            .join(", ")}`;
        }

        // Create and add the full tool for future use
        const fullTool = createFullLangChainTool(requestedTool, currentClient, true);
        mcpTools?.push(fullTool);

        return `Tool "${toolName}" is now available. Description: ${requestedTool.description}\\n\\nYou can now use this tool directly in your next response.`;
      },
      {
        name: "request_tool_access",
        description:
          "Request access to additional tools with full descriptions. Use this when you need tools other than the preferred one.",
        schema: z.object({
          toolName: z
            .string()
            .describe("Name of the tool to get full access to"),
        }),
      }
    )
  );

  return tools;
};
