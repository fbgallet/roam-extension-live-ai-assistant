import { mcpManager } from "../../../ai/agents/mcp-agent/mcpManager";
import { invokeMCPAgent } from "../../../ai/agents/mcp-agent/invoke-mcp-agent";

/**
 * Handles MCP (Model Context Protocol) command execution
 */
export const handleMCPCommand = async ({
  command,
  capturedRoamContext,
  capturedHasContext,
  focusedBlockUid,
  focusedBlockContent,
  additionalPrompt,
  getInstantPrompt,
  targetBlock,
  model,
  defaultModel,
  style,
  handleClose,
}) => {
  // Validate MCP command structure early
  if (!command.serverId || !command.serverName) {
    alert(
      "MCP command is corrupted. Please refresh the menu and try again."
    );
    return;
  }

  // Handle static MCP commands - resolve actual server ID
  let effectiveServerId = command.serverId;
  let effectiveServerName = command.serverName;

  if (command.id === 8001) {
    // Static test command - find actual roam-research-mcp server
    const connectedServers = mcpManager.getConnectedServers();
    const roamServer = connectedServers.find(
      (s) => s.name === "roam-research-mcp"
    );
    if (roamServer) {
      effectiveServerId = roamServer.serverId;
      effectiveServerName = roamServer.name;
    } else {
      alert(
        "roam-research-mcp server not connected. Please check your MCP configuration."
      );
      return;
    }
  }

  const target = targetBlock === "auto" ? "new" : targetBlock || "new";

  try {
    if (command.mcpType === "agent") {
      // MCP Agent execution - uses LangGraph with MultiServerMCPClient
      const userPrompt =
        focusedBlockContent.current || getInstantPrompt(command);

      await invokeMCPAgent({
        model: model || defaultModel,
        rootUid: focusedBlockUid.current,
        targetUid: focusedBlockUid.current,
        target,
        prompt:
          userPrompt + (additionalPrompt ? `\n\n${additionalPrompt}` : ""),
        style,
        serverId: effectiveServerId,
        serverName: effectiveServerName,
        roamContext: capturedHasContext ? capturedRoamContext : null,
      });

      handleClose(false);
    } else if (command.mcpType === "tool") {
      // Use the MCP agent with preferred tool for individual tool execution
      const userPrompt =
        focusedBlockContent.current || getInstantPrompt(command);
      await invokeMCPAgent({
        model: model || defaultModel,
        rootUid: focusedBlockUid.current,
        targetUid: focusedBlockUid.current,
        target,
        prompt:
          userPrompt + (additionalPrompt ? `\n\n${additionalPrompt}` : ""),
        style,
        serverId: effectiveServerId,
        serverName: effectiveServerName,
        preferredToolName: command.preferredToolName,
        roamContext: capturedHasContext ? capturedRoamContext : null,
      });

      handleClose(false);
    } else if (command.mcpType === "resource") {
      await invokeMCPAgent({
        prompt: `${getInstantPrompt(command)}${
          additionalPrompt ? `\n\n${additionalPrompt}` : ""
        }`,
        rootUid: focusedBlockUid.current,
        model: model || defaultModel,
        serverId: command.serverId,
        serverName: command.serverName,
        style: style,
        isConversationMode: false,
        isRetry: false,
        isToRedoBetter: false,
        resourceContext: {
          resourceUri: command.mcpData.uri,
          isResourceCall: true,
          serverId: command.serverId,
        },
        roamContext: capturedHasContext ? capturedRoamContext : null,
      });

      handleClose(false);
    } else if (command.mcpType === "prompt") {
      // Handle MCP prompts through the agent with prompt context
      let effectiveServerId = command.serverId;
      let effectiveServerName = command.serverName;

      // For test prompts with fake server, use first available real server or handle specially
      if (command.serverId === "test-server") {
        const connectedServers = mcpManager.getConnectedServers();
        if (connectedServers.length > 0) {
          effectiveServerId = connectedServers[0].serverId;
          effectiveServerName = connectedServers[0].name;
        } else {
          alert(
            "No MCP servers connected. Please configure an MCP server to test prompts."
          );
          return;
        }
      }

      await invokeMCPAgent({
        prompt: `${getInstantPrompt(command)}${
          additionalPrompt ? `\n\n${additionalPrompt}` : ""
        }`,
        rootUid: focusedBlockUid.current,
        model: model || defaultModel,
        serverId: effectiveServerId,
        serverName: effectiveServerName,
        style: style,
        isConversationMode: false,
        isRetry: false,
        isToRedoBetter: false,
        promptContext: {
          promptName: command.mcpData.name,
          isPromptCall: true,
        },
        roamContext: capturedHasContext ? capturedRoamContext : null,
      });

      handleClose(false);
    }
  } catch (error) {
    console.error("Error executing MCP command:", error);
    alert(`Error executing MCP ${command.mcpType}: ${error.message}`);
    handleClose(false);
  }
};