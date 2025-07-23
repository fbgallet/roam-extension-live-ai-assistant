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

// Helper function to create a full LangChain tool from MCP tool
export const createFullLangChainTool = (mcpTool: any, client: any, withToasterFeedback: boolean = false) => {
  // Create Zod schema from MCP tool input schema
  const createZodSchema = (inputSchema: any) => {
    if (!inputSchema || !inputSchema.properties) {
      return z.object({});
    }

    const zodObject: Record<string, z.ZodType<any>> = {};

    for (const [key, prop] of Object.entries(inputSchema.properties)) {
      const property = prop as any;
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
          zodType = z.array(z.any());
          break;
        case "object":
          zodType = z.object({}).passthrough();
          break;
        default:
          zodType = z.any();
      }

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
      // Toaster feedback for UI integration
      if (withToasterFeedback) {
        const toolCallMsg = `\n🔧 Calling tool: ${mcpTool.name}`;
        const argsMsg = `\n📝 Args: ${JSON.stringify(input, null, 2)}`;

        const currentToaster =
          window.mcpToasterStreamElement ||
          document.querySelector(".mcp-toaster .bp3-toast-message");
        if (currentToaster) {
          currentToaster.innerText += toolCallMsg + argsMsg;
        }
      }

      try {
        console.log(
          `⚡ [MCP REQUEST] Calling server tool "${mcpTool.name}" with processed args:`,
          input
        );
        const result = await client.callTool(mcpTool.name, input);

        console.log(
          `✅ [MCP RESPONSE] Tool "${mcpTool.name}" raw result:`,
          JSON.stringify(result, null, 2)
        );

        if (result.result) {
          const formattedResult = JSON.stringify(result.result, null, 2);
          
          if (withToasterFeedback) {
            const responseMsg = `\n✅ Response received\n`;
            const currentToaster =
              window.mcpToasterStreamElement ||
              document.querySelector(".mcp-toaster .bp3-toast-message");
            if (currentToaster) {
              currentToaster.innerText += responseMsg;
            }
          }

          console.log(
            `📊 [MCP SUCCESS] Tool "${mcpTool.name}" formatted result:`,
            formattedResult
          );
          return formattedResult;
        } else if (result.error) {
          if (withToasterFeedback) {
            const errorMsg = `\n❌ Error: ${result.error}\n`;
            const currentToaster =
              window.mcpToasterStreamElement ||
              document.querySelector(".mcp-toaster .bp3-toast-message");
            if (currentToaster) {
              currentToaster.innerText += errorMsg;
            }
          }

          console.error(
            `❌ [MCP ERROR] Tool "${mcpTool.name}" returned error:`,
            result.error
          );
          throw new Error(`MCP Tool Error: ${result.error}`);
        } else {
          if (withToasterFeedback) {
            const warningMsg = `\n⚠️ Tool executed but returned no result\n`;
            const currentToaster =
              window.mcpToasterStreamElement ||
              document.querySelector(".mcp-toaster .bp3-toast-message");
            if (currentToaster) {
              currentToaster.innerText += warningMsg;
            }
          }

          console.log(
            `⚠️  [MCP WARNING] Tool "${mcpTool.name}" returned no result or error`
          );
          return "Tool executed but returned no result";
        }
      } catch (error) {
        if (withToasterFeedback) {
          const errorMsg = `\n💥 Exception: ${error.message}\n`;
          const currentToaster =
            window.mcpToasterStreamElement ||
            document.querySelector(".mcp-toaster .bp3-toast-message");
          if (currentToaster) {
            currentToaster.innerText += errorMsg;
          }
        }

        console.error(
          `💥 [MCP EXCEPTION] Error executing tool "${mcpTool.name}":`,
          error
        );

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
    return mcpToolsList.map((tool) => createFullLangChainTool(tool, client));
  }

  // Preferred tool mode - create optimized set
  const preferredTool = mcpToolsList.find((t) => t.name === preferredToolName);
  const otherTools = mcpToolsList.filter((t) => t.name !== preferredToolName);

  const tools = [];

  // Add preferred tool with full description
  if (preferredTool) {
    tools.push(createFullLangChainTool(preferredTool, client));
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
        const fullTool = createFullLangChainTool(requestedTool, currentClient);
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