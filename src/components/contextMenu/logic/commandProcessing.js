import {
  getCustomPromptByUid,
  getFlattenedContentFromTree,
  getResolvedContentFromBlocks,
  concatAdditionalPrompt,
  getUnionContext,
  getConversationArray,
} from "../../../ai/dataExtraction";
import { completionCommands } from "../../../ai/prompts";
import {
  addToConversationHistory,
  chatRoles,
  getConversationParamsFromHistory,
  getInstantAssistantRole,
} from "../../..";
import {
  createChildBlock,
  getParentBlock,
  hasBlockChildren,
} from "../../../utils/roamAPI";
import { aiCompletionRunner } from "../../../ai/responseInsertion";
import { textToSpeech } from "../../../ai/aiAPIsHub";
import { mcpManager } from "../../../ai/agents/mcp-agent/mcpManager";
import { invokeMCPAgent } from "../../../ai/agents/mcp-agent/invoke-mcp-agent";
import {
  checkOutlineAvailabilityOrOpen,
  insertNewOutline,
  invokeOutlinerAgent,
} from "../../../ai/agents/outliner-agent/invoke-outliner-agent";
import { handleOutlineSelection } from "../handlers/outlinerCommandHandler";
import {
  extensionStorage,
  incrementCommandCounter,
  defaultModel,
} from "../../..";
import { hasTrueBooleanKey } from "../../../utils/dataProcessing";
import { insertInstantButtons, displayAskGraphModeDialog, displayAskGraphFirstTimeDialog } from "../../../utils/domElts";

export const handleClickOnCommand = async ({
  e,
  command,
  prompt,
  model,
  // Context and state
  roamContextRef,
  focusedBlockUid,
  focusedBlockContent,
  selectedBlocks,
  selectedTextInBlock,
  positionInRoamWindow,
  lastBuiltinCommand,
  rootUid,
  targetBlock,
  additionalPrompt,
  style,
  defaultLgg,
  customLgg,
  isOutlinerAgent,
  isInConversation,
  isCompletionOnly,
  isChildrenTreeToInclude,
  commands,
  // Setters
  setDefaultLgg,
  setRootUid,
  updateOutlineSelectionCommand,
  handleClose,
  setRoamContext,
  getInstantPrompt,
  handleOutlinePrompt,
}) => {
  let customContext;
  const capturedRoamContext = { ...roamContextRef.current };
  const capturedHasContext = hasTrueBooleanKey(capturedRoamContext);

  incrementCommandCounter(command.id);
  if (command.prompt && command.id > 22 && command.id !== 100)
    lastBuiltinCommand.current = {
      command: command.prompt,
      style,
      context: capturedHasContext ? capturedRoamContext : null,
    };
  const target =
    targetBlock === "auto" ? command.target || "new" : targetBlock || "new";
  if (command.name === "Text to Speech") {
    textToSpeech(getInstantPrompt(command, false), additionalPrompt);
    return;
  }
  if (command.category === "QUERY AGENTS") {
    if (command.callback) {
      try {
        // Ensure we have a valid focused block UID, fall back to current focus if needed
        let effectiveRootUid = focusedBlockUid.current;
        if (!effectiveRootUid) {
          // Try to get current focus as fallback
          const focusedBlock = window.roamAlphaAPI.ui.getFocusedBlock();
          effectiveRootUid = focusedBlock?.["block-uid"] || null;
        }
        
        await command.callback({
          model,
          target,
          rootUid: effectiveRootUid,
          targetUid: effectiveRootUid,
          prompt: getInstantPrompt(command),
          retryInstruction: additionalPrompt,
        });
      } catch (error) {
        if (error.message === "MODE_ESCALATION_NEEDED") {
          
          // Show mode selection dialog using the display function
          displayAskGraphModeDialog({
            currentMode: error.currentMode,
            suggestedMode: error.suggestedMode,
            userQuery: error.userQuery,
            onModeSelect: async (selectedMode, rememberChoice) => {
              try {
                // Set session mode if user chose to remember
                if (rememberChoice) {
                  const { setSessionAskGraphMode } = await import("../../../ai/agents/search-agent/ask-your-graph.ts");
                  setSessionAskGraphMode(selectedMode, true);
                }
                
                // Ensure we have a valid focused block UID for retry
                let effectiveRootUid = focusedBlockUid.current;
                if (!effectiveRootUid) {
                  const focusedBlock = window.roamAlphaAPI.ui.getFocusedBlock();
                  effectiveRootUid = focusedBlock?.["block-uid"] || null;
                }
                
                await command.callback({
                  model,
                  target,
                  rootUid: effectiveRootUid,
                  targetUid: effectiveRootUid,
                  prompt: error.userQuery, // Use the original prompt from the error
                  retryInstruction: additionalPrompt,
                  requestedMode: selectedMode,
                  bypassDialog: true,
                });
              } catch (retryError) {
                console.error("Error with selected mode in commandProcessing:", retryError);
              }
            }
          });
        } else if (error.message === "FIRST_TIME_SETUP_NEEDED") {
          // Show first time setup dialog
          displayAskGraphFirstTimeDialog({
            onModeSelect: async (selectedMode) => {
              try {
                // Set the selected mode as default
                const { setSessionAskGraphMode } = await import("../../../ai/agents/search-agent/ask-your-graph.ts");
                setSessionAskGraphMode(selectedMode, true);
                
                // Ensure we have a valid focused block UID for first time setup
                let effectiveRootUid = focusedBlockUid.current;
                if (!effectiveRootUid) {
                  const focusedBlock = window.roamAlphaAPI.ui.getFocusedBlock();
                  effectiveRootUid = focusedBlock?.["block-uid"] || null;
                }
                
                await command.callback({
                  model,
                  target,
                  rootUid: effectiveRootUid,
                  targetUid: effectiveRootUid,
                  prompt: error.userQuery,
                  retryInstruction: additionalPrompt,
                  requestedMode: selectedMode,
                  bypassDialog: true,
                });
              } catch (retryError) {
                console.error("Error with first time selected mode:", retryError);
              }
            }
          });
        } else {
          // Re-throw other errors
          throw error;
        }
      }
      return;
    }
  }
  if (command.category === "MY LIVE OUTLINES") {
    checkOutlineAvailabilityOrOpen(
      command.prompt,
      positionInRoamWindow.current
    );
    await extensionStorage.set("outlinerRootUid", command.prompt);
    setRootUid(command.prompt);
    updateOutlineSelectionCommand({ isToSelect: false });
    return;
  }
  if (command.category === "MY OUTLINE TEMPLATES") {
    await insertNewOutline(
      focusedBlockUid.current,
      command.prompt,
      positionInRoamWindow.current
    );
    setRootUid(extensionStorage.get("outlinerRootUid"));
    updateOutlineSelectionCommand({ isToSelect: false });
    return;
  }
  if (!prompt && command.category !== "CUSTOM PROMPTS") {
    prompt = command.prompt
      ? completionCommands[command.prompt]
      : command.id !== 19
      ? ""
      : command.prompt;
    if (command.customPrompt)
      prompt = prompt.replace("<target content>", command.customPrompt);
  }
  if (command.category === "CUSTOM PROMPTS") {
    const customCommand = getCustomPromptByUid(command.prompt);
    prompt = customCommand.prompt;
    if (customCommand.context)
      customContext = getUnionContext(
        capturedRoamContext,
        customCommand.context
      );
  }
  if (
    (command.id === 11 || Math.floor(command.id / 100) === 11) &&
    command.id !== 19
  ) {
    const selectedLgg =
      command.id === 11
        ? defaultLgg
        : command.id === 1199
        ? customLgg
        : command.name;
    if (defaultLgg !== selectedLgg) {
      setDefaultLgg(selectedLgg);
      extensionStorage.set("translationDefaultLgg", selectedLgg);
    }
    prompt = prompt.replace("<language>", selectedLgg);
  }

  if (command.id === 19) prompt = command.prompt;

  let conversationStyle;
  if (command.name === "Continue the conversation") {
    const parentUid = getParentBlock(focusedBlockUid.current);
    let convParams = getConversationParamsFromHistory(parentUid);
    if (!convParams) {
      convParams = { uid: parentUid };
      if (selectedBlocks.current)
        convParams.selectedUids = selectedBlocks.current;
      if (lastBuiltinCommand.current) {
        convParams.command = lastBuiltinCommand.current.command;
        convParams.context = lastBuiltinCommand.current.context;
        convParams.style = lastBuiltinCommand.current.style;
      }
      await addToConversationHistory(convParams);
    } else {
      conversationStyle = convParams?.style;
      convParams?.context && setRoamContext(convParams?.context);
    }
  }

  if (command.category === "AI MODEL") {
    model = command.model;
    if (isOutlinerAgent && rootUid) command = commands.find((c) => c.id === 21);
    else if (isInConversation) command = commands.find((c) => c.id === 10);
    else command = commands.find((c) => c.id === 1);
    if (model.includes("-search")) command.includeUids = false;
  }

  // Handle MCP commands FIRST before other command processing
  if (command.mcpType) {
    // Validate MCP command structure early
    if (!command.serverId || !command.serverName) {
      alert("MCP command is corrupted. Please refresh the menu and try again.");
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

        // ✅ Close menu after successful MCP execution (preserve context)
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
          preferredToolName: command.preferredToolName, // This guides the agent to use this specific tool
          roamContext: capturedHasContext ? capturedRoamContext : null,
        });

        // ✅ Close menu after successful MCP execution (preserve context)
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

        // ✅ Close menu after successful MCP execution (preserve context)
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
            // No real servers connected - just use a simple agent call without MCP tools
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
          // No preferredToolName for prompts - they should have full tool access
          style: style,
          isConversationMode: false,
          isRetry: false,
          isToRedoBetter: false,
          // Add prompt-specific context
          promptContext: {
            promptName: command.mcpData.name,
            isPromptCall: true,
          },
          roamContext: capturedHasContext ? capturedRoamContext : null,
        });

        // ✅ Close menu after successful MCP execution (preserve context)
        handleClose(false);
      }
    } catch (error) {
      console.error("Error executing MCP command:", error);
      alert(`Error executing MCP ${command.mcpType}: ${error.message}`);
      // ✅ Close menu even on error (preserve context for retry)
      handleClose(false);
    }
    return;
  }

  let includeChildren;
  if (
    command.name === "Main Page content as prompt" ||
    command.name === "Zoom content as prompt"
  ) {
    includeChildren = true;
  }

  if (
    focusedBlockUid.current &&
    command.id === 10 &&
    chatRoles.genericAssistantRegex.test(focusedBlockContent.current)
  ) {
    const conversationParentUid = getParentBlock(focusedBlockUid.current);
    let conversationPrompt = await getConversationArray(
      conversationParentUid,
      true
    );
    const conversationParams = getConversationParamsFromHistory(
      conversationParentUid
    );
    const conversationTargetUid = await createChildBlock(
      conversationParentUid,
      chatRoles.user
    );
    setTimeout(() => {
      insertInstantButtons({
        model,
        prompt: conversationPrompt,
        style,
        targetUid: conversationTargetUid,
        isUserResponse: true,
        selectedUids: conversationParams?.selectedUids,
        command: conversationParams?.command,
        roamContenxt: conversationParams?.context,
      });
    }, 200);
  } else if (
    command.id === 1 ||
    command.id === 10 ||
    command.id === 100 ||
    command.name === "Web search" ||
    isCompletionOnly ||
    (!rootUid && command.id !== 20 && command.id !== 21) ||
    (rootUid &&
      !command.isIncompatibleWith?.completion &&
      (focusedBlockContent.current === "" ||
        command.isIncompatibleWith?.outline))
  ) {
    if (
      rootUid &&
      (focusedBlockContent.current === "" ||
        command.isIncompatibleWith?.outline)
    ) {
      capturedRoamContext.block = true;
      capturedRoamContext.blockArgument.push(rootUid);
    }
    aiCompletionRunner({
      e,
      sourceUid: focusedBlockUid.current,
      prompt,
      additionalPrompt,
      command:
        command.name.slice(0, 16) === "Image generation"
          ? command.name
          : command.prompt,
      instantModel: model,
      includeUids:
        command.includeUids || target === "replace" || target === "append",
      includeChildren:
        includeChildren ||
        (isChildrenTreeToInclude && hasBlockChildren(focusedBlockUid.current)),
      withSuggestions: command.withSuggestions,
      target,
      selectedUids: selectedBlocks.current,
      selectedText: selectedTextInBlock.current,
      style:
        command.isIncompatibleWith?.style ||
        command.isIncompatibleWith?.specificStyle?.includes(style)
          ? "Normal"
          : conversationStyle || style,
      roamContext: customContext
        ? customContext
        : hasTrueBooleanKey(capturedRoamContext)
        ? capturedRoamContext
        : null,
      forceNotInConversation: isInConversation && command.id === 1,
    });
  } else {
    if (command.id === 20)
      handleOutlineSelection(
        rootUid,
        setRootUid,
        updateOutlineSelectionCommand
      );
    else if (command.id === 22) {
      await insertNewOutline(
        focusedBlockUid.current,
        null,
        positionInRoamWindow.current
      );
      setRootUid(extensionStorage.get("outlinerRootUid"));
      updateOutlineSelectionCommand({ isToSelect: false });
    } else {
      handleOutlinePrompt(e, prompt, model);
    }
  }
};

export const getInstantPrompt = (
  command,
  includeAdditionalPrompt = true,
  params = {}
) => {
  const {
    focusedBlockUid,
    focusedBlockContent,
    selectedBlocks,
    selectedTextInBlock,
    isChildrenTreeToInclude,
    additionalPrompt,
  } = params;
  let instantPrompt = "";
  if (focusedBlockUid.current) {
    if (isChildrenTreeToInclude && hasBlockChildren(focusedBlockUid.current))
      instantPrompt = getFlattenedContentFromTree({
        parentUid: focusedBlockUid.current,
        maxCapturing: 99,
        maxUid: 0,
        withDash: true,
      });
    else
      instantPrompt =
        selectedTextInBlock.current || focusedBlockContent.current;
  } else if (selectedBlocks?.current?.length) {
    instantPrompt = getResolvedContentFromBlocks(
      selectedBlocks.current,
      command?.includeUids || false,
      true
    );
  }
  if (includeAdditionalPrompt)
    instantPrompt = concatAdditionalPrompt(instantPrompt, additionalPrompt);
  return instantPrompt;
};

export const handleOutlinePrompt = async (e, prompt, model, params = {}) => {
  const { rootUid, focusedBlockUid, roamContext, style, getInstantPrompt } =
    params;
  if (rootUid)
    invokeOutlinerAgent({
      e,
      sourceUid: focusedBlockUid.current,
      rootUid,
      prompt: prompt || getInstantPrompt(),
      context: hasTrueBooleanKey(roamContext) ? roamContext : null,
      model,
      style,
    });
};
