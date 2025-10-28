import {
  InputGroup,
  Menu,
  MenuItem,
  Popover,
  MenuDivider,
  Icon,
  Dialog,
} from "@blueprintjs/core";
import React, { useCallback, useEffect, useMemo } from "react";
import ReactDOM from "react-dom";
import {
  availableModels,
  defaultModel,
  extensionStorage,
  menuModifierKey,
} from "../..";
import ModelsMenu from "../ModelsMenu";
import { highlightHtmlElt, toggleOutlinerSelection } from "../../utils/domElts";
import { CATEGORY_ICON } from "../../ai/prebuildCommands";
import { languages } from "../../ai/languagesSupport";
import {
  getAndNormalizeContext,
  getFlattenedContentFromTree,
  getFocusAndSelection,
  getOrderedCustomPromptBlocks,
  isPromptInConversation,
} from "../../ai/dataExtraction";
import {
  getBlockOrderByUid,
  getPageStatus,
  getPageUidByBlockUid,
  isExistingBlock,
  isLogView,
  hasBlockChildren,
} from "../../utils/roamAPI";
import { invokeOutlinerAgent } from "../../ai/agents/outliner-agent/invoke-outliner-agent";
import { hasTrueBooleanKey } from "../../utils/dataProcessing";
import HelpDialog from "../HelpDialog";
import {
  estimateContextTokens,
  modelAccordingToProvider,
} from "../../ai/aiAPIsHub";
import { mcpManager } from "../../ai/agents/mcp-agent/mcpManager";
import ContextMenuHeader from "./components/ContextMenuHeader";
import ContextSelectionPanel from "./components/ContextSelectionPanel";
import TokenEstimateDisplay from "./components/TokenEstimateDisplay";
import StyleSelectionPanel from "./components/StyleSelectionPanel";
import CommandSuggest from "./components/CommandSuggest";
import MCPConfigComponent from "../MCPConfigComponent";
import { useContextMenuState } from "./hooks/useContextMenuState";
import {
  handleClickOnCommand as handleClickOnCommandLogic,
  getInstantPrompt,
} from "./logic/commandProcessing";
import { BUILTIN_STYLES } from "../../ai/styleConstants";

const SELECT_CMD = "Set as active Live Outline";
const UNSELECT_CMD = "Disable current Live Outline";

export let customStyleTitles = getOrderedCustomPromptBlocks("liveai/style").map(
  (custom) => custom.content
);
export let customStyles;

export const StandaloneContextMenu = () => {
  // Use the custom hook for all state management
  const {
    // UI State
    isOpen,
    setIsOpen,
    isMenuToDisplay,
    setIsMenuToDisplay,
    isHelpOpen,
    setIsHelpOpen,
    position,
    setPosition,
    displayModelsMenu,
    setDisplayModelsMenu,
    displayAddPrompt,
    setDisplayAddPrompt,
    isMCPConfigOpen,
    setIsMCPConfigOpen,

    // Command and Context State
    commands,
    setCommands,
    userCommands,
    setUserCommands,
    liveOutlines,
    setLiveOutlines,
    templates,
    setTemplates,
    setStableMcpCommands,
    activeCommand,
    setActiveCommand,

    // User Preferences
    isChildrenTreeToInclude,
    setIsChildrenTreeToInclude,
    targetBlock,
    setTargetBlock,
    style,
    setStyle,
    isPinnedStyle,
    setIsPinnedStyle,
    additionalPrompt,
    setAdditionalPrompt,
    setModel,

    // Mode State
    isOutlinerAgent,
    setIsOutlinerAgent,
    isCompletionOnly,
    setIsCompletionOnly,
    isInConversation,
    setIsInConversation,

    // Context State
    roamContext,
    setRoamContext,
    rootUid,
    setRootUid,
    dnpPeriod,
    setDnpPeriod,
    customDays,
    setCustomDays,
    estimatedTokens,
    setEstimatedTokens,

    // Language State
    defaultLgg,
    setDefaultLgg,
    customLgg,
    setCustomLgg,

    // Refs
    inputRef,
    popoverRef,
    focusedBlockUid,
    focusedBlockContent,
    selectedTextInBlock,
    positionInRoamWindow,
    selectedBlocks,
    mainViewUid,
    pageUid,
    isZoom,
    lastBuiltinCommand,
    isFirstBlock,
    roamContextRef,
    styleRef,
    targetBlockRef,

    // Functions
    handleClose,
  } = useContextMenuState();

  useEffect(() => {
    window.LiveAI.toggleContextMenu = ({
      e,
      onlyOutliner = false,
      onlyCompletion = false,
      focusUid,
      focusBlockContent,
    }) => {
      setIsOutlinerAgent(onlyOutliner);
      setIsCompletionOnly(onlyCompletion);
      setIsMenuToDisplay(false);
      setPosition({
        x: Math.min(e.clientX, window.innerWidth - 300),
        y: Math.min(e.clientY, window.innerHeight - 300),
      });
      focusedBlockUid.current = focusUid;
      focusedBlockContent.current = focusBlockContent || "";
      setIsOpen(true);
    };
    updateUserCommands();
    updateCustomStyles();
    updateLiveOutlines();
    updateTemplates();
  }, []);

  useEffect(() => {
    if (isOpen) {
      if (rootUid && !isExistingBlock(rootUid)) {
        setRootUid(null);
        toggleOutlinerSelection(null, false);
      }
      const {
        currentUid,
        currentBlockContent,
        selectionUids,
        selectedText,
        position,
      } = getFocusAndSelection();

      isFirstBlock.current =
        getBlockOrderByUid(currentUid) === 0 ? true : false;
      focusedBlockUid.current = !focusedBlockUid.current
        ? currentUid
        : focusedBlockUid;
      focusedBlockContent.current =
        focusedBlockUid.current && currentBlockContent?.trim();
      selectedBlocks.current = selectionUids;
      selectedTextInBlock.current = selectedText;
      positionInRoamWindow.current = position;

      setIsInConversation(
        currentUid ? isPromptInConversation(currentUid, false) : false
      );

      const adaptToStatus = async () => {
        const { zoomOrMainPageUid, isZoomInMainPage, currentPageUid } =
          await getPageStatus(
            focusedBlockUid.current || selectedBlocks.current?.[0]
          );
        mainViewUid.current = zoomOrMainPageUid;
        pageUid.current = currentPageUid;
        isZoom.current = isZoomInMainPage;

        if (selectedTextInBlock.current) {
          adaptMainCommandToSelection("text");
        } else if (focusedBlockUid.current) {
          adaptMainCommandToSelection("focus");
        } else if (selectedBlocks.current.length) {
          adaptMainCommandToSelection("blocks");
        } else if (isZoomInMainPage) adaptMainCommandToSelection("zoom");
        else adaptMainCommandToSelection("page");
        updateMenu();
      };
      adaptToStatus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!hasTrueBooleanKey(roamContext)) {
      setEstimatedTokens(null);
      return;
    }

    // Handle async context processing
    const estimateTokensAsync = async () => {
      try {
        const contextContent = hasTrueBooleanKey(roamContext)
          ? await getAndNormalizeContext({ roamContext })
          : null;
        const tokenEstimate = contextContent
          ? estimateContextTokens(contextContent)
          : null;
        setEstimatedTokens(tokenEstimate ? tokenEstimate.toString() : null);
      } catch (error) {
        console.error("Error estimating tokens:", error);
        setEstimatedTokens(null);
      }
    };

    estimateTokensAsync();
  }, [roamContext]);

  useEffect(() => {
    const updateMcpCommands = () => {
      try {
        const connectedServers = mcpManager.getConnectedServers();

        if (connectedServers.length === 0) {
          setStableMcpCommands([]);
          return;
        }

        // Get all tools, prompts, and resources
        const allTools = mcpManager.getAllTools();
        const allPrompts = mcpManager.getAllPrompts();
        const allResources = mcpManager.getAllResources();

        const allMcpCommands = [];

        // Helper function to format command name with server prefix
        const formatCommandName = (serverName, commandName) => {
          const truncatedServer =
            serverName.length > 14
              ? serverName.substring(0, 14) + "..."
              : serverName;
          return `${truncatedServer}: ${commandName}`;
        };

        // Add server agent commands
        const serverCommands = connectedServers.map((server, index) => ({
          id: 5500 + index,
          name: `Server: ${server.name}`,
          category: "MCP AGENTS",
          keyWords: `mcp server agent ${server.name}`,
          serverName: server.name,
          serverId: server.serverId,
          description: `AI agent with access to all tools and resources from ${server.name}`,
          mcpType: "agent",
          mcpData: server,
        }));

        if (connectedServers.length > 1) {
          const allServerNames = connectedServers.map((s) => s.name);
          const allServerIds = connectedServers.map((s) => s.serverId);

          serverCommands.unshift({
            id: 5499,
            name: `All Servers (${connectedServers.length})`,
            category: "MCP AGENTS",
            keyWords: `mcp agent multi server all ${allServerNames.join(" ")}`,
            serverName: allServerNames,
            serverId: allServerIds,
            description: `AI agent with coordinated access to all ${
              connectedServers.length
            } connected MCP servers: ${allServerNames.join(", ")}`,
            mcpType: "agent",
            mcpData: {
              isMultiServer: true,
              servers: connectedServers,
              serverCount: connectedServers.length,
            },
          });
        }

        allMcpCommands.push(...serverCommands);

        // Add tool commands
        const toolCommands = allTools.map((tool, index) => ({
          id: 5600 + index,
          name: formatCommandName(tool.serverName, tool.name),
          category: "MCP TOOLS",
          keyWords: `mcp tool ${tool.name} ${tool.serverName}`,
          serverName: tool.serverName,
          serverId: tool.serverId,
          description: tool.description || `Tool from ${tool.serverName}`,
          mcpType: "tool",
          mcpData: tool,
          preferredToolName: tool.name, // Add this for tool-specific invocation
        }));

        allMcpCommands.push(...toolCommands);

        // Add prompt commands
        const promptCommands = allPrompts.map((prompt, index) => ({
          id: 5700 + index,
          name: formatCommandName(prompt.serverName, prompt.name),
          category: "MCP PROMPTS",
          keyWords: `mcp prompt ${prompt.name} ${prompt.serverName}`,
          serverName: prompt.serverName,
          serverId: prompt.serverId,
          description: prompt.description || `Prompt from ${prompt.serverName}`,
          mcpType: "prompt",
          mcpData: prompt,
        }));

        allMcpCommands.push(...promptCommands);

        // Add resource commands
        const resourceCommands = allResources.map((resource, index) => ({
          id: 5800 + index,
          name: formatCommandName(
            resource.serverName,
            resource.name || resource.uri
          ),
          category: "MCP RESOURCES",
          keyWords: `mcp resource ${resource.name || resource.uri} ${
            resource.serverName
          }`,
          serverName: resource.serverName,
          serverId: resource.serverId,
          description:
            resource.description || `Resource from ${resource.serverName}`,
          mcpType: "resource",
          mcpData: resource,
        }));

        allMcpCommands.push(...resourceCommands);

        setStableMcpCommands(allMcpCommands);

        setCommands((prev) => {
          const withoutMcp = prev.filter(
            (cmd) => cmd.id < 5499 || cmd.id > 5999
          );
          return [...withoutMcp, ...allMcpCommands];
        });
      } catch (error) {
        console.error("Error updating stable MCP commands:", error);
        setStableMcpCommands([]);
      }
    };

    updateMcpCommands();

    if (isOpen) {
      updateMcpCommands();
    }
  }, [isOpen]);

  const stableItems = useMemo(() => {
    const contextHash = JSON.stringify(roamContext);
    const baseItems = commands
      .concat(userCommands)
      .concat(liveOutlines)
      .concat(templates)
      .map((item) => ({
        ...item,
        _contextGeneration: contextHash,
      }));

    const modelItems = availableModels.map((model, index) => {
      const llm = modelAccordingToProvider(model);
      return {
        id: 9000 + index,
        name: llm?.name || defaultModel,
        model: llm?.prefix + llm?.id || defaultModel,
        category: "AI MODEL",
        keyWords: llm?.thinking ? "reasoning, thinking" : "",
        _contextGeneration: contextHash,
      };
    });

    return baseItems.concat(modelItems);
  }, [
    commands,
    userCommands,
    liveOutlines,
    templates,
    availableModels,
    defaultModel,
    roamContext,
  ]);

  const adaptMainCommandToSelection = (selectionType) => {
    let adaptedName;
    switch (selectionType) {
      case "focus":
        adaptedName = "Focused blocks as prompt";
        break;
      case "text":
        adaptedName = "Selected text as prompt";
        break;
      case "blocks":
        adaptedName = "Selected blocks as prompt";
        break;
      case "zoom":
        adaptedName = "Zoom content as prompt";
        break;
      default:
        adaptedName = "Main Page content as prompt";
    }
    setCommands((prev) => {
      let selectedBlockCommand1 = prev.find((cmd) => cmd.id === 1);
      selectedBlockCommand1.name = adaptedName;
      let selectedBlockCommand101 = prev.find((cmd) => cmd.id === 100);
      selectedBlockCommand101.name = adaptedName;
      return [...prev];
    });
  };

  useEffect(() => {
    setCommands((prev) => {
      const updatedCommands = [...prev];
      const customLggCmd = updatedCommands.find((cmd) => cmd.id === 1199);
      customLggCmd.name = customLgg;
      return updatedCommands;
    });
    if (!languages.find((lgg) => lgg[0] === defaultLgg))
      setDefaultLgg(customLgg);
  }, [customLgg]);

  useEffect(() => {
    setCommands((prev) => {
      const updatedCommands = [...prev];
      const defaultLggCmd = updatedCommands.find((cmd) => cmd.id === 11);
      const defaultLggMap = languages.find((elt) => elt[0] === defaultLgg);
      defaultLggCmd.name = `Translate to... (${defaultLgg})`;
      defaultLggCmd.label = defaultLggMap ? defaultLggMap[1] : "";
      return updatedCommands;
    });
  }, [defaultLgg]);

  const handleGlobalContextMenu = useCallback(async (e) => {
    let modifierKey = menuModifierKey;
    if (modifierKey === "Control") modifierKey = "ctrl";
    modifierKey =
      modifierKey !== "disabled" ? modifierKey.toLowerCase() + "Key" : null;
    if (modifierKey && e[modifierKey]) {
      e.preventDefault();
      e.stopPropagation();
      const x = Math.min(e.clientX - 140, window.innerWidth - 360);
      const y = Math.min(e.clientY - 150, window.innerHeight - 300);
      setPosition({
        x: x > 0 ? x : 10,
        y: y > 0 ? y : 10,
      });
      const isOutlineHighlighted = document.querySelector(
        ".fixed-highlight-elt-blue"
      )
        ? true
        : false;
      const outlinerRoot = extensionStorage.get("outlinerRootUid");
      if (!isOutlineHighlighted && outlinerRoot) {
        setRootUid(outlinerRoot);
        setIsOutlinerAgent(true);
      }
      setIsOpen(true);
    }
  }, []);

  const handleClickOutside = useCallback((e) => {
    const target = e.target;

    if (
      !target.closest(".bp3-menu") &&
      !target.closest(".laia-help-dialog") &&
      !target.closest(".bp3-dialog")
    ) {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("contextmenu", handleGlobalContextMenu);
    if (isOpen && !isHelpOpen && !isMCPConfigOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 20);
    }
    return () => {
      document.removeEventListener("contextmenu", handleGlobalContextMenu);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [handleGlobalContextMenu, handleClickOutside, isOpen]);

  const updateOutlineSelectionCommand = ({ isToSelect = true }) => {
    setCommands((prev) => {
      let outlinerCommand = prev.find((cmd) => cmd.id === 20);
      outlinerCommand.name = isToSelect ? SELECT_CMD : UNSELECT_CMD;
      return [...prev];
    });
  };

  const handleOutlinePrompt = async (e, prompt, model) => {
    if (rootUid)
      invokeOutlinerAgent({
        e,
        sourceUid: focusedBlockUid.current,
        rootUid,
        prompt: prompt || getInstantPrompt(),
        context: hasTrueBooleanKey(roamContext) ? roamContext : null,
        model,
        style: styleRef.current,
      });
  };

  // 🔧 STABLE FILTER: Remove roamContext dependency to prevent re-creation
  const filterCommands = useCallback(
    (query, item) => {
      return filterCommandsInternal(query, item);
    },
    [isOutlinerAgent, isCompletionOnly, additionalPrompt]
  );

  // Wrapper function that calls the extracted command processing logic
  const handleClickOnCommand = async ({
    e,
    command,
    prompt,
    model: cmdModel,
  }) => {
    return await handleClickOnCommandLogic({
      e,
      command,
      prompt,
      model: cmdModel,
      // Context and state
      isChildrenTreeToInclude,
      roamContextRef,
      focusedBlockUid,
      focusedBlockContent,
      selectedBlocks,
      selectedTextInBlock,
      positionInRoamWindow,
      lastBuiltinCommand,
      rootUid,
      targetBlock: targetBlockRef.current, // Use ref to get latest value
      additionalPrompt,
      style: styleRef.current,
      defaultLgg,
      customLgg,
      isOutlinerAgent,
      isInConversation,
      commands,
      // Setters
      setDefaultLgg,
      setRootUid,
      updateOutlineSelectionCommand,
      handleClose,
      setRoamContext,
      getInstantPrompt: (command, includeAdditional = true) =>
        getInstantPrompt(command, includeAdditional, {
          focusedBlockUid,
          focusedBlockContent,
          selectedBlocks,
          selectedTextInBlock,
          isChildrenTreeToInclude,
          additionalPrompt,
        }),
      handleOutlinePrompt: (e, prompt, model) =>
        handleOutlinePrompt(e, prompt, model, {
          rootUid,
          focusedBlockUid,
          roamContext,
          style: styleRef.current,
          getInstantPrompt: () =>
            getInstantPrompt(command, true, {
              focusedBlockUid,
              focusedBlockContent,
              selectedBlocks,
              selectedTextInBlock,
              isChildrenTreeToInclude,
              additionalPrompt,
            }),
        }),
    });
  };

  // 🔧 COMPLETELY STABLE ITEM SELECT: No dependencies at all, use refs for state access
  const handleItemSelect = useCallback((command, e) => {
    handleClickOnCommand({ e, command });
    // ✅ Don't close immediately for MCP commands - they handle their own closing
    if (!command.mcpType) {
      setIsOpen(false);
    }
  }, []); // 🔧 NO DEPENDENCIES - completely stable reference

  const filterCommandsInternal = (query, item) => {
    if ((item.id === 0 || item.id === 2) && !additionalPrompt) return false;

    // Skip if command should be hidden based on current default privacy mode
    if (item.hideIfDefaultMode) {
      const {
        getCurrentAskGraphMode,
      } = require("../../ai/agents/search-agent/ask-your-graph");
      const currentMode = getCurrentAskGraphMode();
      if (item.hideIfDefaultMode === currentMode) {
        return false;
      }
    }

    if (
      item.name === "Text to Speech" &&
      !(
        selectedTextInBlock.current ||
        focusedBlockContent.current ||
        selectedBlocks.current?.length
      )
    )
      return false;
    if (
      !focusedBlockUid?.current &&
      !selectedBlocks?.current?.length &&
      /selected|continue/i.test(item.name)
    )
      return false;
    if (isOutlinerAgent && item.isIncompatibleWith?.outliner) return false;
    if (isCompletionOnly && item.isIncompatibleWith?.completion) return false;
    // if any block is focused or selected, and no context is selected
    if (item.id === 102 && !hasTrueBooleanKey(roamContextRef.current))
      return false;

    // ✨ ASK YOUR GRAPH CONDITIONAL FILTERING: Show different commands based on focus state
    const hasFocusedBlock = !!focusedBlockUid?.current;

    // If no block is focused, show only the new "Ask Linked References" command (id: 95) and "Open Results view" (id: 94)
    // Hide the regular Ask Your Graph commands (id: 92, 920, 921, 922, 93)
    if (!hasFocusedBlock) {
      if ([92, 920, 921, 922, 93].includes(item.id)) {
        return false; // Hide regular Ask Your Graph commands when no block is focused
      }
    }

    // If a block is focused, show regular Ask Your Graph commands but hide the "Ask Linked References" command (id: 95)
    if (hasFocusedBlock) {
      if (item.id === 95) {
        return false; // Hide "Ask Linked References" command when a block is focused
      }
    }

    // Hide "Ask your graph - Last results" if no results are available
    if (!query && item.id === 94) {
      const results = window.lastAskYourGraphResults;
      return results && Array.isArray(results) && results.length > 0;
    }

    // ✨ SIMPLIFIED MCP FILTERING: Show only MCP AGENTS (no complex submenu logic needed)

    if (!query) {
      if (isFirstBlock.current && item.id === 1) return true;
      if (
        item.category === "MY LIVE OUTLINES" ||
        item.category === "MY OUTLINE TEMPLATES" ||
        item.category === "AI MODEL"
      )
        return false;
      if (item.id === 1 && rootUid) return false;
      if (item.id === 10 && rootUid) return false;
      if (
        (item.id === 1 || item.id === 100) &&
        (isInConversation || isOutlinerAgent)
      )
        return false;
      if (item.id === 100 && (!isInConversation || isOutlinerAgent))
        return false;
      if (
        item.id === 20 &&
        (rootUid || !focusedBlockUid.current) &&
        item.name === "Set as active Live Outline"
      )
        return false;
      if (
        item.id === 21 &&
        (!rootUid || (rootUid && rootUid === focusedBlockUid.current))
      )
        return false;
      return item.isSub ? false : true;
    } else {
      if (isFirstBlock.current && item.id === 10) return false;
      if (item.id === 100) return false;
      if (item.id === 22 && rootUid) return false;
    }
    if (additionalPrompt && !query) {
      if (item.id === 0 && !isOutlinerAgent) return true;
      if (item.id === 2 && isOutlinerAgent) return true;
    }
    const normalizedQuery = query.toLowerCase();
    return (
      item.name.toLowerCase().includes(normalizedQuery) ||
      item.category?.toLowerCase().includes(normalizedQuery) ||
      item.keyWords?.toLowerCase().includes(normalizedQuery)
    );
  };

  const insertModelsMenu = (callback, command) => {
    const shouldShow =
      displayModelsMenu ||
      command.id === 1 ||
      command.id === 100 ||
      command.id === 101 ||
      command.id === 102 ||
      command.id === 102 ||
      command.name === "Web search" ||
      (command.name.includes("Image generation") &&
        command.name !== "Text to Speech" &&
        !command.name.includes("Image generation"));

    if (shouldShow) {
      if (!ModelsMenu) {
        console.error("❌ ModelsMenu is undefined!");
        return <div>ModelsMenu is undefined!</div>;
      }
      return (
        <ModelsMenu callback={callback} command={command} setModel={setModel} />
      );
    }
    return null;
  };

  const renderCommand = useCallback(
    (command, { handleClick, modifiers, query }) => {
      if (!command) return;

      // Smart naming: use displayName when filtered (query exists), clean name otherwise
      const displayText =
        query && command.displayName ? command.displayName : command.name;

      // 🔧 DEBUG: Let's use Blueprint MenuItem for MCP commands and see what breaks

      return (
        <MenuItem
          key={command.id}
          icon={command.icon}
          text={displayText}
          label={command.label}
          active={activeCommand === undefined && modifiers.active}
          aria-haspopup={true}
          tabindex="0"
          onClick={(e) => {
            if (command.mcpType) {
              console.log(
                "🎯 BLUEPRINT MCP CLICK:",
                command.name,
                "activeCommand:",
                activeCommand
              );
            }
            handleClick(e);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            command.id !== 20 && command.id !== 22
              ? setDisplayModelsMenu(true)
              : null;
            setActiveCommand(command.id);
          }}
        >
          {command.submenu && (!query || command.customPrompt) ? (
            <>
              {displayModelsMenu && (
                <MenuItem text={`Model for ${command.name}`}>
                  {insertModelsMenu(handleClickOnCommand, command)}
                </MenuItem>
              )}
              {command.submenu.map((sub) => {
                let subCommand;

                // For other categories, search in all available commands
                const allItems = commands
                  .concat(userCommands)
                  .concat(liveOutlines)
                  .concat(templates);
                // MCP commands now included directly in 'commands' array
                subCommand = allItems.find((item) => item.id === sub);

                // Skip if subCommand is not found
                if (!subCommand) {
                  return null;
                }

                // Skip if subCommand should be hidden based on current default privacy mode
                if (subCommand.hideIfDefaultMode) {
                  const {
                    getCurrentAskGraphMode,
                  } = require("../../ai/agents/search-agent/ask-your-graph");
                  const currentMode = getCurrentAskGraphMode();
                  if (subCommand.hideIfDefaultMode === currentMode) {
                    return null;
                  }
                }

                // Handle divider items
                if (subCommand.isDivider) {
                  return (
                    <MenuDivider
                      key={subCommand.id}
                      className="menu-hint"
                      title={
                        <>
                          <Icon icon={subCommand.dividerIcon} />{" "}
                          {subCommand.dividerTitle}
                        </>
                      }
                    />
                  );
                }

                return subCommand.id === 1199 ? (
                  customLggMenuItem(subCommand)
                ) : (
                  <MenuItem
                    tabindex="0"
                    key={subCommand.id}
                    text={subCommand.name}
                    label={subCommand.label}
                    active={modifiers.active}
                    onClick={async (e) => {
                      await handleClickOnCommand({ e, command: subCommand });
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setDisplayModelsMenu(true);
                      setActiveCommand(subCommand.id);
                    }}
                  >
                    {insertModelsMenu(handleClickOnCommand, subCommand)}
                  </MenuItem>
                );
              })}
            </>
          ) : (
            insertModelsMenu(handleClickOnCommand, command)
          )}
        </MenuItem>
      );
    },
    [
      activeCommand,
      additionalPrompt,
      setDisplayModelsMenu,
      setActiveCommand,
      handleClickOnCommand,
    ]
  );

  const groupedItemRenderer = ({
    items,
    itemsParentRef,
    renderItem,
    query,
  }) => {
    if (!isMenuToDisplay) return;
    const grouped = {};

    const filteredItems = items.filter((item) => filterCommands(query, item));
    let isCustomPrompt = false;

    if (!filteredItems.length) {
      isCustomPrompt = true;
      const customCommand = rootUid
        ? items.find((cmd) => cmd.id === 2)
        : items.find((cmd) => cmd.id === 0);
      customCommand.prompt = query + ":\n";
      filteredItems.push(customCommand);
      // display a selection of commands that can handle a custom basic content
      if (!rootUid) {
        const commandsToApplyToCustomPrompt = items.filter(
          (cmd) =>
            cmd.id === 11 ||
            cmd.id === 154 ||
            cmd.id === 1460 ||
            cmd.name === "Web search" ||
            cmd.name === "Fetch URL (with Claude)"
          // cmd.category === "QUERY AGENTS"
        );
        commandsToApplyToCustomPrompt.forEach((cmd) => {
          cmd.customPrompt = query;
          filteredItems.push(cmd);
        });
      }
      setActiveCommand(filteredItems[0].id);
    }

    let noCategoryItems = [];
    filteredItems.forEach((item) => {
      !isCustomPrompt && (item.customPrompt = null);
      if (!item.category) noCategoryItems.push(item);
      else {
        if (!grouped[item.category]) {
          grouped[item.category] = [];
        }
        grouped[item.category].push(item);
      }
    });

    const usedCommands = extensionStorage.get("commandCounter");

    const mostUsed =
      usedCommands && usedCommands?.counter?.length
        ? usedCommands.counter
            .filter(
              (item) =>
                item &&
                item.id > 10 &&
                item.id !== usedCommands?.last &&
                item.id !== 20 &&
                item.id !== 21 &&
                item.id !== 22
            )
            .slice(0, 5)
            .map((item) => {
              let command = commands.find((cmd) => cmd.id === item.id);
              return command;
            })
        : [];

    return (
      <Menu className="str-aicommands-menu" ulRef={itemsParentRef} small={true}>
        {!query || !filteredItems[0].category ? (
          <MenuDivider
            className="menu-hint"
            title={"ℹ︎ Right click to switch model"}
            onClick={(e) => {
              e.stopPropagation();
            }}
          />
        ) : null}
        {noCategoryItems.map((item) => renderItem(item))}
        {!query && (
          <>
            <MenuItem
              tabindex="0"
              text="Most used prompts"
              style={{ opacity: 0.6, cursor: "default" }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <>
                {mostUsed &&
                  mostUsed.length &&
                  mostUsed.map((cmd) => renderItem(cmd))}
                <MenuDivider className="menu-hint" title={"Last used:"} />
                {usedCommands?.last &&
                  renderItem(
                    commands.find((cmd) => cmd.id === usedCommands?.last)
                  )}
              </>
            </MenuItem>
            <MenuItem
              tabindex="0"
              text="Custom prompts"
              style={{ opacity: 0.6, cursor: "default" }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <>
                {userCommands.length ? (
                  userCommands.map((cmd) => renderItem(cmd))
                ) : (
                  <MenuItem
                    className="menu-hint"
                    text={
                      <div>
                        Empty...
                        <br />
                        No block mentioning <b>#liveai/prompt</b>
                      </div>
                    }
                  />
                )}
              </>
            </MenuItem>
          </>
        )}
        {Object.entries(grouped)
          .filter(([_, categoryItems]) => categoryItems.length > 0)
          .map(([category, categoryItems]) => (
            <React.Fragment key={category}>
              {category && (
                <MenuDivider
                  className="menu-hint"
                  title={
                    <>
                      <Icon icon={CATEGORY_ICON[category]} /> {category}
                    </>
                  }
                />
              )}
              {categoryItems.map((item) => renderItem(item))}
              {!query && !isCompletionOnly && category === "OUTLINER AGENT" && (
                <>
                  <MenuItem
                    text="Favorite Live Outlines"
                    style={{ opacity: 0.6, cursor: "default" }}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    {liveOutlines.length ? (
                      liveOutlines.map((outline) => renderItem(outline))
                    ) : (
                      <MenuItem
                        className="menu-hint"
                        text={
                          <div>
                            Empty...
                            <br />
                            No block mentioning <b>#liveai/outline</b>
                          </div>
                        }
                      />
                    )}
                  </MenuItem>
                  <MenuItem
                    text="New Outline from Template..."
                    style={{ opacity: 0.6, cursor: "default" }}
                  >
                    {templates.length ? (
                      templates.map((template) => renderItem(template))
                    ) : (
                      <MenuItem
                        className="menu-hint"
                        text={
                          <div>
                            Empty...
                            <br />
                            No block mentioning #liveai/template
                          </div>
                        }
                      />
                    )}
                  </MenuItem>
                </>
              )}
            </React.Fragment>
          ))}
        {query && filteredItems[0].category ? (
          <MenuDivider
            className="menu-hint"
            title="ℹ︎ Right click to switch model"
          />
        ) : null}
      </Menu>
    );
  };

  const customLggMenuItem = (command) => {
    return (
      <MenuItem
        className={"custom-lgg-menu"}
        key={1199}
        // icon={defaultLgg === "this?" ? "pin" : ""}
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (customLgg)
            await handleClickOnCommand({
              e,
              command,
            });
        }}
        onKeyDown={() => {
          // handleKeyDownOnModel(e);
        }}
        tabindex="0"
        text={
          <>
            User defined:
            <InputGroup
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              value={customLgg}
              onChange={(e) => {
                extensionStorage.set("translationCustomLgg", e.target.value);
                setCustomLgg(e.target.value);
              }}
              fill={true}
              className={"custom-lgg-input"}
            />
          </>
        }
        label="✍️"
      />
    );
  };

  const updateContext = (context, e) => {
    if (context === "liveOutline") {
      context = "block";
    } else {
      if (e.target.checked)
        highlightHtmlElt({
          roamElt:
            context === "logPages" && !isLogView() ? "pageTitle" : context,
        });
    }
    setRoamContext((prev) => {
      const clone = { ...prev };
      if (context === "page" || context === "zoom") {
        clone.pageViewUid =
          context === "page" && isZoom.current
            ? getPageUidByBlockUid(mainViewUid.current)
            : mainViewUid.current;
        context = "page";
      }
      clone[context] = !clone[context];
      if (context === "block") clone.blockArgument = [rootUid];
      return clone;
    });

    inputRef.current?.focus();
  };

  const handleAddPrompt = (e) => {
    e.stopPropagation();
    setDisplayAddPrompt((prev) => {
      if (prev && additionalPrompt) setAdditionalPrompt("");
      return !prev;
    });
  };

  const handleDnpPeriodChange = (selectedOption) => {
    setDnpPeriod(selectedOption.value);
    let nbOfDays =
      selectedOption.value === "Custom" ? customDays : selectedOption.days;
    // Update the roamContext.logPages based on selection
    setRoamContext((prev) => ({
      ...prev,
      logPages: selectedOption.value === 0 ? false : true,
      logPagesArgument: nbOfDays,
    }));
    inputRef.current?.focus();
  };

  const renderDnpPeriodItem = (option, { handleClick, modifiers }) => {
    return (
      <MenuItem
        key={option.value}
        text={option.label}
        active={modifiers.active}
        onClick={handleClick}
      />
    );
  };

  const updateMenu = () => {
    const currentRootUid = extensionStorage.get("outlinerRootUid");
    const outlinerCommand = commands.find((cmd) => cmd.id === 20);
    const isSelectCmd = !outlinerCommand.name?.includes("Disable");
    if (rootUid != currentRootUid) {
      setRootUid(currentRootUid);
      if (currentRootUid && isSelectCmd)
        updateOutlineSelectionCommand({ isToSelect: false });
      else if (!currentRootUid && !isSelectCmd)
        updateOutlineSelectionCommand({ isToSelect: true });
    } else {
      if (isSelectCmd && rootUid)
        updateOutlineSelectionCommand({ isToSelect: false });
      else if (!isSelectCmd && !rootUid)
        updateOutlineSelectionCommand({ isToSelect: true });
    }
    setIsMenuToDisplay(true);
  };

  const updateUserCommands = () => {
    const orderedCmds = getOrderedCustomPromptBlocks("liveai/prompt");

    if (orderedCmds) {
      const userCmds = orderedCmds.map((cmd, index) => {
        return {
          id: 3000 + index,
          name: cmd.content,
          category: "CUSTOM PROMPTS",
          keyWords: "user",
          prompt: cmd.uid,
          includeUids: true,
        };
      });
      setUserCommands(userCmds);
    } else if (userCommands.length) setUserCommands([]);
  };

  const updateCustomStyles = () => {
    const orderedStyles = getOrderedCustomPromptBlocks("liveai/style");
    if (orderedStyles) {
      customStyleTitles = orderedStyles.map((custom) => custom.content);
      customStyles = orderedStyles.map((custom) => {
        return {
          name: custom.content,
          prompt: getFlattenedContentFromTree({
            parentUid: custom.uid,
            maxCapturing: 99,
            maxUid: 0,
            withDash: true,
            isParentToIgnore: true,
          }),
        };
      });
    }
  };

  const updateLiveOutlines = () => {
    const orderedOutlines = getOrderedCustomPromptBlocks("liveai/outline");
    if (orderedOutlines) {
      const outlines = orderedOutlines.map((cmd, index) => {
        return {
          id: 2000 + index,
          name: cmd.content,
          category: "MY LIVE OUTLINES",
          keyWords: "user",
          prompt: cmd.uid,
        };
      });
      setLiveOutlines(outlines);
    } else if (liveOutlines.length) setLiveOutlines([]);
  };

  const updateTemplates = () => {
    const orderedTemplates = getOrderedCustomPromptBlocks("liveai/template");
    if (orderedTemplates) {
      const templatesCmds = orderedTemplates.map((cmd, index) => {
        return {
          id: 5000 + index,
          name: cmd.content,
          category: "MY OUTLINE TEMPLATES",
          keyWords: "user",
          prompt: cmd.uid,
        };
      });
      setTemplates(templatesCmds);
    } else if (templates.length) setTemplates([]);
  };

  // ✅ REMOVED: getMCPCommands() function - replaced with stable state management

  return (
    <Popover
      isOpen={isOpen}
      onClose={() => handleClose()}
      onClick={(e) => e.stopPropagation()}
    >
      {isOpen && (
        <div
          className="bp3-elevation-3 aicommands-div"
          draggable={true}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            left: position.x,
            top: position.y,
            zIndex: 999,
          }}
        >
          <Menu
            className="bp3-menu str-aicommands-menu"
            onKeyDown={(e) => {
              e.stopPropagation();
            }}
            onClick={(e) => {
              setIsOpen(false);
              e.stopPropagation();
            }}
          >
            <ContextMenuHeader
              defaultModel={defaultModel}
              setIsHelpOpen={setIsHelpOpen}
              setIsOpen={setIsOpen}
              setIsMCPConfigOpen={setIsMCPConfigOpen}
              updateUserCommands={updateUserCommands}
              updateCustomStyles={updateCustomStyles}
              updateLiveOutlines={updateLiveOutlines}
              updateTemplates={updateTemplates}
              handleClose={handleClose}
              inputRef={inputRef}
            />
            <ContextSelectionPanel
              selectedBlocks={selectedBlocks}
              selectedTextInBlock={selectedTextInBlock}
              focusedBlockUid={focusedBlockUid}
              isChildrenTreeToInclude={isChildrenTreeToInclude}
              setIsChildrenTreeToInclude={setIsChildrenTreeToInclude}
              roamContext={roamContext}
              updateContext={updateContext}
              mainViewUid={mainViewUid}
              isZoom={isZoom}
              pageUid={pageUid}
              dnpPeriod={dnpPeriod}
              handleDnpPeriodChange={handleDnpPeriodChange}
              customDays={customDays}
              setCustomDays={setCustomDays}
              setRoamContext={setRoamContext}
              rootUid={rootUid}
              renderDnpPeriodItem={renderDnpPeriodItem}
            />

            <TokenEstimateDisplay
              estimatedTokens={estimatedTokens}
              defaultModel={defaultModel}
            />
            <StyleSelectionPanel
              style={style}
              setStyle={setStyle}
              isPinnedStyle={isPinnedStyle}
              setIsPinnedStyle={setIsPinnedStyle}
              customStyleTitles={customStyleTitles}
              inputRef={inputRef}
            />
            <CommandSuggest
              roamContext={roamContext}
              popoverRef={popoverRef}
              stableItems={stableItems}
              groupedItemRenderer={groupedItemRenderer}
              renderCommand={renderCommand}
              filterCommands={filterCommands}
              handleItemSelect={handleItemSelect}
              inputRef={inputRef}
              displayAddPrompt={displayAddPrompt}
              handleAddPrompt={handleAddPrompt}
              targetBlock={targetBlock}
              setTargetBlock={setTargetBlock}
              additionalPrompt={additionalPrompt}
              setAdditionalPrompt={setAdditionalPrompt}
            />
          </Menu>
          <HelpDialog
            isOpen={isHelpOpen}
            onClose={() => {
              setIsHelpOpen(false);
            }}
          />
          <Dialog
            isOpen={isMCPConfigOpen}
            onClose={() => {
              setIsMCPConfigOpen(false);
            }}
            title="MCP Servers Configuration"
            canOutsideClickClose={true}
            canEscapeKeyClose={true}
          >
            <MCPConfigComponent extensionStorage={extensionStorage} />
          </Dialog>
        </div>
      )}
    </Popover>
  );
};
// Fonction d'initialisation à appeler une seule fois
export function initializeContextMenu() {
  const menuContainer = document.createElement("div");
  menuContainer.id = "context-menu-container";
  document.body.appendChild(menuContainer);

  ReactDOM.render(<StandaloneContextMenu />, menuContainer);
}
// Fonction de nettoyage si nécessaire
export function cleanupContextMenu() {
  window.roamAlphaAPI.ui.blockContextMenu.removeCommand({
    label: "Live AI: Context Menu (all commands & built-in prompts)",
  });
  const container = document.getElementById("context-menu-container");
  if (container) {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  }
}
