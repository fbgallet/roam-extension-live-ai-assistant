import {
  InputGroup,
  Menu,
  MenuItem,
  Popover,
  MenuDivider,
  HTMLSelect,
  Tooltip,
  Icon,
  Checkbox,
  TextArea,
} from "@blueprintjs/core";
import { Suggest } from "@blueprintjs/select";
import React, { useState, useCallback, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import {
  addToConversationHistory,
  availableModels,
  defaultModel,
  defaultStyle,
  extensionStorage,
  getConversationParamsFromHistory,
  incrementCommandCounter,
} from "..";
import ModelsMenu from "./ModelsMenu";
import { completionCommands, stylePrompts } from "../ai/prompts";
import {
  displayTokensDialog,
  highlightHtmlElt,
  setAsOutline,
  simulateClick,
  toggleOutlinerSelection,
} from "../utils/domElts";
import {} from "../ai/agents/outliner-agent/outliner-agent";
import { BUILTIN_COMMANDS, CATEGORY_ICON } from "../ai/prebuildCommands";
import { aiCompletionRunner } from "../ai/responseInsertion";
import { languages } from "../ai/languagesSupport";
import {
  getCustomPromptByUid,
  getFlattenedContentFromTree,
  getFocusAndSelection,
  getOrderedCustomPromptBlocks,
  getUnionContext,
  isPromptInConversation,
} from "../ai/dataExtraction";
import {
  getBlockContentByUid,
  getBlockOrderByUid,
  getParentBlock,
  isExistingBlock,
  isLogView,
} from "../utils/roamAPI";
import {
  invokeOutlinerAgent,
  checkOutlineAvailabilityOrOpen,
  insertNewOutline,
} from "../ai/agents/outliner-agent/invoke-outliner-agent";
import { hasTrueBooleanKey } from "../utils/dataProcessing";
import HelpDialog from "./HelpDialog";
import { modelAccordingToProvider } from "../ai/aiAPIsHub";

const SELECT_CMD = "Set as active Live Outline";
const UNSELECT_CMD = "Disable current Live Outline";
export const BUILTIN_STYLES = [
  "Normal",
  "Concise",
  "Conversational",
  "No bullet points",
  "Atomic",
  "Quiz",
  "Socratic",
];
export let customStyleTitles = getOrderedCustomPromptBlocks("liveai/style").map(
  (custom) => custom.content
);
export let customStyles;

const voidRoamContext = {
  linkedRefs: false,
  linkedPages: false,
  sidebar: false,
  page: false,
  pageArgument: [],
  logPages: false,
  block: false,
  blockArgument: [],
  linkedRefsArgument: [],
};

const StandaloneContextMenu = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMenuToDisplay, setIsMenuToDisplay] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [commands, setCommands] = useState(BUILTIN_COMMANDS);
  const [userCommands, setUserCommands] = useState([]);
  const [model, setModel] = useState(null);
  const [isOutlinerAgent, setIsOutlinerAgent] = useState(false);
  const [isCompletionOnly, setIsCompletionOnly] = useState(false);
  const [activeCommand, setActiveCommand] = useState();
  const [displayModelsMenu, setDisplayModelsMenu] = useState(false);
  const [displayAddPrompt, setDisplayAddPrompt] = useState(false);
  const [rootUid, setRootUid] = useState(null);
  const [defaultLgg, setDefaultLgg] = useState(
    extensionStorage.get("translationDefaultLgg")
  );
  const [customLgg, setCustomLgg] = useState(
    extensionStorage.get("translationCustomLgg")
  );
  const [targetBlock, setTargetBlock] = useState("auto");
  const [style, setStyle] = useState(defaultStyle);
  // const [customStyleTitles, setCustomStyleTitles] = useState([]);
  const [isPinnedStyle, setIsPinnedStyle] = useState(false);
  const [additionalPrompt, setAdditionalPrompt] = useState("");
  const [liveOutlines, setLiveOutlines] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [isInConversation, setIsInConversation] = useState(false);
  const inputRef = useRef(null);
  const popoverRef = useRef(null);
  const focusedBlockUid = useRef(null);
  const focusedBlockContent = useRef(null);
  const selectedTextInBlock = useRef(null);
  const positionInRoamWindow = useRef(null);
  const selectedBlocks = useRef(null);
  const lastBuiltinCommand = useRef(null);
  const isFirstBlock = useRef(null);
  const [roamContext, setRoamContext] = useState({ ...voidRoamContext });

  useEffect(() => {
    window.LiveAI.toggleContextMenu = ({
      e,
      onlyOutliner = false,
      onlyCompletion = false,
      focusUid,
    }) => {
      setIsOutlinerAgent(onlyOutliner);
      setIsCompletionOnly(onlyCompletion);
      setIsMenuToDisplay(false);
      // if (e.target.classList.includes("outliner")) setIsOutlinerAgent(onlyOutliner);
      // if (e.target.classList.includes("fa-bolt")) setIsCompletionOnly(onlyCompletion);
      setPosition({
        x: Math.min(e.clientX, window.innerWidth - 300),
        y: Math.min(e.clientY, window.innerHeight - 300),
      });
      focusedBlockUid.current = focusUid;
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
      focusedBlockUid.current = !focusedBlockUid.current && currentUid;
      focusedBlockContent.current =
        focusedBlockUid.current && currentBlockContent.trim();
      selectedBlocks.current = selectionUids;
      selectedTextInBlock.current = selectedText;
      positionInRoamWindow.current = position;
      setIsInConversation(isPromptInConversation(currentUid, false));
      // if (!isPinnedStyle) setStyle(defaultStyle);
      updateMenu();
    }
  }, [isOpen]);

  const handleClose = () => {
    setIsOpen(false);
    focusedBlockUid.current = null;
    setIsMenuToDisplay(false);
    setDisplayModelsMenu(false);
    setTargetBlock("auto");
    setIsInConversation(false);
    setIsCompletionOnly(false);
    setIsOutlinerAgent(false);
    setIsHelpOpen(false);
    if (!isPinnedStyle) setStyle(defaultStyle);
    setRoamContext({ ...voidRoamContext });
    selectedBlocks.current = null;
    isFirstBlock.current = null;
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

  const handleClickOnCommand = async ({ e, command, prompt, model }) => {
    let customContext;
    incrementCommandCounter(command.id);
    if (command.prompt && command.id > 22 && command.id !== 100)
      lastBuiltinCommand.current = {
        command: command.prompt,
        style,
        context: hasTrueBooleanKey(roamContext) ? roamContext : null,
      };
    const target =
      targetBlock === "auto" ? command.target || "new" : targetBlock || "new";
    if (command.category === "QUERY AGENTS") {
      if (command.callback) {
        command.callback({
          model,
          target,
          rootUid: focusedBlockUid.current,
          targetUid: focusedBlockUid.current,
          prompt: getBlockContentByUid(focusedBlockUid.current),
          retryInstruction: additionalPrompt,
        });
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
      prompt = command.prompt ? completionCommands[command.prompt] : "";
    }
    if (command.category === "CUSTOM PROMPTS") {
      const customCommand = getCustomPromptByUid(command.prompt);
      prompt = customCommand.prompt;
      if (customCommand.context)
        customContext = getUnionContext(roamContext, customCommand.context);
      console.log("roamContext in ContextMenu :>> ", customContext);
    }
    if (command.id === 11 || Math.floor(command.id / 100) === 11) {
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

    if (additionalPrompt)
      prompt += "\n\nIMPORTANT additional instructions:\n" + additionalPrompt;

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
      if (isOutlinerAgent && rootUid)
        command = commands.find((c) => c.id === 21);
      else if (isInConversation) command = commands.find((c) => c.id === 10);
      else command = commands.find((c) => c.id === 1);
    }

    if (
      command.name === "Selected blocks as prompt" ||
      command.name === "Continue the conversation" ||
      // (command.id !== 20 &&
      //   (focusedBlockUid.current || selectedBlocks.current?.length)) ||
      isCompletionOnly ||
      (!rootUid && command.id !== 20 && command.id !== 21) ||
      // case with Live Outliner active AND blank focused block
      (rootUid &&
        !command.isIncompatibleWith?.completion &&
        (focusedBlockContent.current === "" ||
          command.isIncompatibleWith?.outline))
    ) {
      // in this case, use the Live Outline as context for the prompt
      if (
        rootUid &&
        (focusedBlockContent.current === "" ||
          command.isIncompatibleWith?.outline)
      ) {
        roamContext.block = true;
        roamContext.blockArgument.push(rootUid);
      }
      aiCompletionRunner({
        e,
        sourceUid: focusedBlockUid.current,
        prompt,
        command: command.prompt,
        instantModel: model,
        includeUids: command.includeUids,
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
          : hasTrueBooleanKey(roamContext)
          ? roamContext
          : null,
        forceNotInConversation: isInConversation && command.id === 1,
      });
    } else {
      if (command.id === 20) handleOutlineSelection();
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

  const handleGlobalContextMenu = useCallback(async (e) => {
    if (e.metaKey || e.ctrlKey) {
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

    if (!target.closest(".bp3-menu") && !target.closest(".laia-help-dialog")) {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("contextmenu", handleGlobalContextMenu);
    if (isOpen && !isHelpOpen) {
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

  const handleOutlineSelection = useCallback(async () => {
    const outlinerCommand = commands.find((cmd) => cmd.id === 20);
    const isSelectCmd = !outlinerCommand.name?.includes("Disable");
    if (isSelectCmd) {
      await setAsOutline();
      setRootUid(extensionStorage.get("outlinerRootUid"));
      updateOutlineSelectionCommand({ isToSelect: false });
      console.log("Select Outline");
    } else {
      toggleOutlinerSelection(rootUid, false);
      await extensionStorage.set("outlinerRootUid", null);
      setRootUid(null);
      updateOutlineSelectionCommand({ isToSelect: true });
    }
  });

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
        prompt,
        context: hasTrueBooleanKey(roamContext) ? roamContext : null,
        model,
        style,
      });
  };

  const filterCommands = (query, item) => {
    // console.log("item :>> ", item);
    if ((item.id === 0 || item.id === 2) && !additionalPrompt) return false;
    if (
      !focusedBlockUid?.current &&
      !selectedBlocks?.current?.length &&
      /selected|continue/i.test(item.name)
    )
      return false;
    if (isOutlinerAgent && item.isIncompatibleWith?.outliner) return false;
    if (isCompletionOnly && item.isIncompatibleWith?.completion) return false;
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
      if (item.id === 1 && (isInConversation || isOutlinerAgent)) return false;
      if (item.id === 100 && (!isInConversation || isOutlinerAgent))
        return false;
      // TODO : display if the current outline is not visible...
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
    // if (query.length === 10 && item.isSub) return false;
    const normalizedQuery = query.toLowerCase();
    // console.log("normalizedQuery :>> ", normalizedQuery);
    return (
      item.name.toLowerCase().includes(normalizedQuery) ||
      item.category?.toLowerCase().includes(normalizedQuery) ||
      item.keyWords?.toLowerCase().includes(normalizedQuery)
    );
  };

  const insertModelsMenu = (callback, command) => {
    return displayModelsMenu || command.id === 1 ? (
      <ModelsMenu callback={callback} command={command} />
    ) : null;
  };

  const renderCommand = (command, { handleClick, modifiers, query }) => {
    if (!command) return;
    return (
      <MenuItem
        key={command.id}
        icon={command.icon}
        text={command.name}
        label={command.label}
        active={
          // activeCommand === command.id ||
          activeCommand === undefined && modifiers.active
        }
        aria-haspopup={true}
        tabindex="0"
        onClick={(e) => {
          handleClickOnCommand({
            e,
            command,
            prompt:
              command.id === 0 || command.id === 2
                ? additionalPrompt || command.prompt
                : "",
          });
        }}
        onSelect={(e) => console.log("Select")}
        onContextMenu={(e) => {
          e.preventDefault();
          command.id !== 20 && command.id !== 22
            ? setDisplayModelsMenu(true)
            : null;
          setActiveCommand(command.id);
        }}
      >
        {command.submenu && !query ? (
          <>
            {displayModelsMenu && (
              <MenuItem text={`Model for ${command.name}`}>
                {insertModelsMenu(handleClickOnCommand, command)}
              </MenuItem>
            )}
            {command.submenu.map((sub) => {
              const subCommand = commands.find((item) => item.id === sub);
              return subCommand?.id === 1199 ? (
                customLggMenuItem(subCommand)
              ) : (
                <MenuItem
                  tabindex="0"
                  key={subCommand.id}
                  text={subCommand.name}
                  label={subCommand.label}
                  active={modifiers.active}
                  onClick={(e) => {
                    handleClickOnCommand({ e, command: subCommand });
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
  };

  const groupedItemRenderer = ({
    items,
    itemsParentRef,
    renderItem,
    query,
  }) => {
    if (!isMenuToDisplay) return;
    const grouped = {};

    const filteredItems = items.filter((item) => filterCommands(query, item));

    // console.log("filteredItems :>> ", filteredItems);

    if (!filteredItems.length) {
      const customCommand = rootUid
        ? items.find((cmd) => cmd.id === 2)
        : items.find((cmd) => cmd.id === 0);
      customCommand.prompt = query + ":\n";
      filteredItems.push(customCommand);
    } //else if (query) setActiveCommand(filteredItems[0].id);

    // console.log("filteredItems :>> ", filteredItems);

    let noCategoryItems = [];
    filteredItems.forEach((item) => {
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
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (customLgg)
            handleClickOnCommand({
              e,
              command,
            });
        }}
        onKeyDown={(e) => {
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

  const updateContext = (context) => {
    if (context === "liveOutline") {
      context = "block";
    } else {
      if (!roamContext[context])
        highlightHtmlElt({
          roamElt:
            context === "logPages" && !isLogView() ? "pageTitle" : context,
        });
    }
    setRoamContext((prev) => {
      const clone = { ...prev };
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
      // console.log("Live AI user custom styles :>> ", customStyles);
      // setCustomStyleTitles(customStyleTitles);
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
          // onClick={(e) => e.stopPropagation()}
          onDragStart={(e) => {
            const transparentImage = document.createElement("img");
            e.dataTransfer.clearData();
            transparentImage.src =
              "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
            e.dataTransfer.setDragImage(transparentImage, 0, 0);
            e.dataTransfer.effectAllowed = "none";
          }}
          onDrag={(e) => {
            e.preventDefault();
            e.clientX &&
              e.clientY &&
              setPosition({
                x: e.clientX - 100,
                y: e.clientY - 25,
              });
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
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
            <div className="aicommands-topbar">
              <div>LIVE AI ASSISTANT</div>
              <div className="laia-topbar-icons">
                <Tooltip
                  content="Quick reminder"
                  disabled={window.roamAlphaAPI.platform.isMobile}
                  hoverOpenDelay={600}
                  openOnTargetFocus={false}
                  style={{ zIndex: "9990" }}
                >
                  <Icon
                    icon="help"
                    size={12}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsHelpOpen(true);
                    }}
                  />
                </Tooltip>
                <Tooltip
                  content="Tokens usage and cost by model"
                  disabled={window.roamAlphaAPI.platform.isMobile}
                  hoverOpenDelay={600}
                  openOnTargetFocus={false}
                  style={{ zIndex: "9999" }}
                >
                  <Icon
                    icon="dollar"
                    size={12}
                    onClick={(e) => {
                      e.stopPropagation();
                      displayTokensDialog();
                      setIsOpen(false);
                    }}
                  />
                </Tooltip>
                <Tooltip
                  content="Refresh custom content menus"
                  disabled={window.roamAlphaAPI.platform.isMobile}
                  hoverOpenDelay={600}
                  openOnTargetFocus={false}
                  style={{ zIndex: "9999" }}
                >
                  <Icon
                    icon="reset"
                    size={10}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateUserCommands(true);
                      updateCustomStyles();
                      updateLiveOutlines();
                      updateTemplates();
                      inputRef.current?.focus();
                    }}
                  />
                </Tooltip>
                <Tooltip
                  content="Close context menu"
                  disabled={window.roamAlphaAPI.platform.isMobile}
                  hoverOpenDelay={600}
                  openOnTargetFocus={false}
                  style={{ zIndex: "9999" }}
                >
                  <Icon icon="cross" size={12} onClick={() => handleClose()} />
                </Tooltip>
              </div>
            </div>
            <MenuDivider
              className="menu-hint"
              title={
                <div>
                  Default model:{" "}
                  <b>
                    {defaultModel
                      .replace("openRouter/", "")
                      .replace("groq/", "")}
                  </b>
                </div>
              }
            />
            {/* <MenuDivider
              title={ */}
            <div
              className="aicommands-context"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              Context:{" "}
              <Checkbox
                checked={roamContext.page}
                label="Page"
                inline={true}
                onChange={() => updateContext("page")}
              />
              {isLogView() ? (
                <Checkbox
                  checked={roamContext.logPages}
                  label="DNPs"
                  inline={true}
                  onChange={() => updateContext("logPages")}
                />
              ) : (
                <Checkbox
                  checked={roamContext.linkedRefs}
                  label="Linked Refs"
                  inline={true}
                  onChange={() => updateContext("linkedRefs")}
                />
              )}
              <Checkbox
                checked={roamContext.sidebar}
                label="Sidebar"
                inline={true}
                onChange={() => updateContext("sidebar")}
              />
              {focusedBlockUid.current || selectedBlocks.current?.length ? (
                <Tooltip
                  content={
                    <div>
                      ⚠️ Mentioned pages content
                      <br />+ their linked references
                    </div>
                  }
                  openOnTargetFocus={false}
                >
                  <Checkbox
                    checked={roamContext.linkedPages}
                    label="[[pages]]"
                    inline={true}
                    onChange={() => updateContext("linkedPages")}
                  />
                </Tooltip>
              ) : null}
              {rootUid && (
                <Checkbox
                  checked={roamContext.block}
                  label="Outline"
                  inline={true}
                  onChange={() => updateContext("liveOutline")}
                />
              )}
            </div>
            <div
              className="aicommands-style"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              Style{" "}
              <Tooltip
                content={
                  <div>
                    Pin/unpin this style for this session
                    <br />
                    To set is as default, see extension settings
                  </div>
                }
                openOnTargetFocus={false}
                style={{ zIndex: "9999" }}
              >
                <Icon
                  icon={isPinnedStyle ? "unpin" : "pin"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsPinnedStyle((prev) => !prev);
                  }}
                  intent={isPinnedStyle ? "primary" : "none"}
                />
              </Tooltip>
              <HTMLSelect
                options={BUILTIN_STYLES.concat(customStyleTitles)}
                minimal={true}
                onClick={(e) => {
                  e.stopPropagation();
                }}
                onChange={(e) => {
                  setStyle(e.currentTarget.value);
                  inputRef.current?.focus();
                }}
                value={style}
              />
            </div>
            {/* }
            ></MenuDivider> */}
            <Suggest
              popoverRef={popoverRef}
              fill={true}
              items={commands
                .concat(userCommands)
                .concat(liveOutlines)
                .concat(templates)
                .concat(
                  availableModels.map((model, index) => {
                    const llm = modelAccordingToProvider(model);
                    return {
                      id: 9000 + index,
                      name: llm?.name || defaultModel,
                      model: llm?.id || defaultModel,
                      category: "AI MODEL",
                    };
                  })
                )}
              itemListRenderer={groupedItemRenderer}
              itemRenderer={renderCommand}
              itemPredicate={filterCommands}
              scrollToActiveItem={true}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onItemSelect={(command, e) => {
                handleClickOnCommand({ e, command });
                setIsOpen(false);
              }}
              inputProps={{
                className: "str-aicommands-input",
                placeholder: "Live AI command...",
                inputRef: inputRef,
                fill: true,
                leftElement: (
                  <Icon
                    icon={displayAddPrompt ? "minus" : "add"}
                    onClick={(e) => handleAddPrompt(e)}
                  />
                ),
                // leftIcon: "filter-list",
                onClick: (e) => e.stopPropagation(),
                onKeyPress: (e) => {
                  e.stopPropagation();
                  if (e.code === "Enter") {
                    const activeMenuElt = document.querySelector(".bp3-active");
                    if (activeMenuElt.innerText === "Use this custom prompt")
                      simulateClick(document.querySelector(".bp3-active"));
                  }
                },
                rightElement: (
                  <Tooltip
                    content="Target of the AI response"
                    openOnTargetFocus={false}
                    style={{ zIndex: "9999" }}
                  >
                    <HTMLSelect
                      // rightIcon="caret-down"
                      options={["auto", "new", "new w/o", "replace", "append"]}
                      minimal={true}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      onChange={(e) => {
                        setTargetBlock(e.currentTarget.value);
                        inputRef.current?.focus();
                      }}
                      value={targetBlock}
                    />
                  </Tooltip>
                ),
              }}
              popoverProps={{
                minimal: true,
                placement: "right-start",
                popoverClassName: "suggested-aicommands",
              }}
              inputValueRenderer={(item) => item.label}
            />
            {displayAddPrompt && (
              <div
                className="str-aicommands-additional"
                onClick={(e) => e.stopPropagation()}
              >
                <TextArea
                  // autoResize={true}
                  growVertically={true}
                  fill={true}
                  small={true}
                  placeholder="Write additional instructions to selected command..."
                  value={additionalPrompt}
                  onChange={(e) => {
                    setAdditionalPrompt(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.code === "Escape" || e.code === "Tab") {
                      e.preventDefault();
                      inputRef.current?.focus();
                    }
                  }}
                />
              </div>
            )}
          </Menu>
          <HelpDialog
            isOpen={isHelpOpen}
            onClose={() => {
              setIsHelpOpen(false);
            }}
          />
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
    label: "Live AI Assistant: Open context Menu",
  });
  // window.roamAlphaAPI.ui.msContextMenu.removeCommand({
  //   label: "Live AI Assistant: Open context Menu",
  // });
  const container = document.getElementById("context-menu-container");
  if (container) {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  }
}
