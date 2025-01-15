import {
  InputGroup,
  Menu,
  MenuItem,
  Popover,
  MenuDivider,
  Button,
  HTMLSelect,
  Tooltip,
  Icon,
  Checkbox,
} from "@blueprintjs/core";
import { Suggest } from "@blueprintjs/select";
import React, { useState, useCallback, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { defaultModel, extensionStorage } from "..";
import ModelsMenu from "./ModelsMenu";
import { completionCommands } from "../ai/prompts";
import {
  highlightHtmlElt,
  setAsOutline,
  simulateClick,
  toggleOutlinerSelection,
} from "../utils/domElts";
import { invokeOutlinerAgent } from "../ai/agents/outliner-agent";
import { PREBUILD_COMMANDS } from "../ai/prebuildCommands";
import { aiCompletionRunner } from "../ai/responseInsertion";
import { languages } from "../ai/languagesSupport";
import { getFocusAndSelection } from "../ai/dataExtraction";
import { isLogView } from "../utils/roamAPI";

const SELECT_CMD = "Outliner Agent: Set as active outline";
const UNSELECT_CMD = "Outliner Agent: Disable current outline";

const StandaloneContextMenu = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [commands, setCommands] = useState(PREBUILD_COMMANDS);
  const [selectedCommand, setSelectedCommand] = useState(null);
  const [model, setModel] = useState(null);
  const [isOutlinerAgent, setIsOutlinerAgent] = useState(false);
  const [displayModelsMenu, setDisplayModelsMenu] = useState(false);
  const [rootUid, setRootUid] = useState(null);
  const [defaultLgg, setDefaultLgg] = useState(
    extensionStorage.get("translationDefaultLgg")
  );
  const [customLgg, setCustomLgg] = useState(
    extensionStorage.get("translationCustomLgg")
  );
  const [targetBlock, setTargetBlock] = useState("auto");
  const [style, setStyle] = useState("Normal");
  const [isPinnedStyle, setIsPinnedStyle] = useState(false);
  const inputRef = useRef(null);
  const popoverRef = useRef(null);
  const blockUid = useRef(null);
  const focusedBlock = useRef(
    window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"]
  );
  const selectedBlocks = useRef(null);
  const [roamContext, setRoamContext] = useState({
    linkedRefs: false,
    sidebar: false,
    mainPage: false,
    logPages: false,
  });

  useEffect(() => {
    window.LiveAI.toggleContextMenu = ({
      e,
      onlyOutliner = false,
      instantModel,
      focusUid,
    }) => {
      setIsOutlinerAgent(onlyOutliner);
      instantModel && setModel(instantModel);
      setPosition({
        x: Math.min(e.clientX, window.innerWidth - 200),
        y: Math.min(e.clientY, window.innerHeight - 300),
      });
      const { currentUid, selectionUids } = getFocusAndSelection();
      blockUid.current = focusUid || currentUid;
      selectedBlocks.current = selectionUids;
      setIsOpen(true);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setDisplayModelsMenu(false);
      setTargetBlock("auto");
      if (!isPinnedStyle) setStyle("Normal");
      setRoamContext({
        linkedRefs: false,
        sidebar: false,
        mainPage: false,
        logPages: false,
      });
    } else updateMenu();
  }, [isOpen]);

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

  const updateMenu = () => {
    focusedBlock.current =
      window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
    const currentRootUid = extensionStorage.get("outlinerRootUid");
    const isSelectCmd = !commands[1].name.toLowerCase().includes("unselect");
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
  };

  const handleClickOnCommand = ({ e, command, prompt, model }) => {
    if (!prompt) {
      prompt = command.prompt ? completionCommands[command.prompt] : "";
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

    if (
      !command.onlyOutliner &&
      (!isOutlinerAgent || (!rootUid && command.id !== 20))
    )
      aiCompletionRunner({
        e,
        sourceUid: blockUid.current,
        prompt,
        instantModel: model,
        includeUids: command.includeUids,
        withSuggestions: command.withSuggestions,
        target:
          targetBlock === "auto"
            ? command.target || "new"
            : targetBlock || "new",
        selectedUids: selectedBlocks.current,
        style:
          command.isIncompatibleWith?.style ||
          command.isIncompatibleWith?.specificStyle.includes(style)
            ? "Normal"
            : style,
        roamContext,
      });
    else {
      if (command.id === 20) handleOutlineSelection();
      else handleOutlinePrompt(e, prompt, model);
    }
  };

  const handleGlobalContextMenu = useCallback(async (e) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      setPosition({
        x: Math.min(e.clientX - 115, window.innerWidth - 200),
        y: Math.min(e.clientY - 50, window.innerHeight - 300),
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
      const { selectionUids } = getFocusAndSelection();
      console.log("selectionUids in ContextMenu :>> ", selectionUids);
      selectedBlocks.current = selectionUids;
      setIsOpen(true);
    }
  }, []);

  const handleClickOutside = useCallback((e) => {
    const target = e.target;
    if (!target.closest(".bp3-menu")) {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("contextmenu", handleGlobalContextMenu);
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      setTimeout(() => {
        inputRef.current.focus();
      }, 10);
    }
    return () => {
      document.removeEventListener("contextmenu", handleGlobalContextMenu);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [handleGlobalContextMenu, handleClickOutside, isOpen]);

  const handleOutlineSelection = useCallback(async () => {
    const isSelectCmd = !commands[1].name.toLowerCase().includes("unselect");
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
    if (rootUid) invokeOutlinerAgent({ e, rootUid, prompt, model });
  };

  const filterCommands = (query, item) => {
    if (item.id === 0 || item.id === 2) return false;
    if (!query) {
      if (item.id === 10 && rootUid) return false;
      // TODO : display if the current outline is not visible...
      if (item.id === 20 && rootUid && rootUid !== focusedBlock.current)
        return false;
      if (
        item.id === 21 &&
        (!rootUid || (rootUid && rootUid === focusedBlock.current))
      )
        return false;
      return item.isSub ? false : true;
    }
    if (query.length === 10 && item.isSub) return false;
    const normalizedQuery = query.toLowerCase();
    // console.log("normalizedQuery :>> ", normalizedQuery);
    return (
      item.name.toLowerCase().includes(normalizedQuery) ||
      item.category?.toLowerCase().includes(normalizedQuery) ||
      item.keyWords?.toLowerCase().includes(normalizedQuery)
    );
  };

  const insertModelsMenu = (callback, command) => {
    return displayModelsMenu || command.id === 10 ? (
      <ModelsMenu callback={callback} command={command} />
    ) : null;
  };

  const renderCommand = (command, { handleClick, modifiers, query }) => {
    return (
      <MenuItem
        // active={index === 0 ? true : false}
        key={command.id}
        icon={command.icon}
        text={command.name}
        label={command.label}
        active={modifiers.active || command.id === 0}
        tabindex="0"
        onClick={(e) => {
          handleClickOnCommand({
            e,
            command,
            prompt: command.id === 0 && command.prompt,
          });
        }}
        onSelect={(e) => console.log("Select")}
        onContextMenu={(e) => {
          e.preventDefault();
          command.id !== 20 ? setDisplayModelsMenu(true) : null;
        }}
      >
        {command.submenu && !query
          ? command.submenu.map((sub) => {
              const subCommand = commands.find((item) => item.id === sub);
              return subCommand.id === 1199 ? (
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
                  }}
                >
                  {insertModelsMenu(handleClickOnCommand, command)}
                </MenuItem>
              );
            })
          : insertModelsMenu(handleClickOnCommand, command)}
      </MenuItem>
    );
  };

  const groupedItemRenderer = ({
    items,
    itemsParentRef,
    renderItem,
    query,
  }) => {
    const grouped = {};

    const filteredItems = items.filter((item) => filterCommands(query, item));
    if (!filteredItems.length) {
      const customCommand = rootUid ? items[1] : items[0];
      customCommand.prompt = query + ":\n";
      filteredItems.push(customCommand);
    }

    filteredItems.forEach((item) => {
      if (!grouped[item.category]) {
        grouped[item.category] = [];
      }
      grouped[item.category].push(item);
    });

    return (
      <Menu className="str-aicommands-menu" ulRef={itemsParentRef} small={true}>
        {!query || !filteredItems[0].category ? (
          <MenuDivider
            className="menu-hint"
            title={"ℹ︎ Right click to switch model"}
          />
        ) : null}
        {Object.entries(grouped)
          .filter(([_, categoryItems]) => categoryItems.length > 0)
          .map(([category, categoryItems]) => (
            <React.Fragment key={category}>
              {category && (
                <MenuDivider className="menu-hint" title={category} />
              )}
              {categoryItems.map((item) => renderItem(item))}
            </React.Fragment>
          ))}
        {query && filteredItems[0].category ? (
          <MenuDivider
            className="menu-hint"
            title={"ℹ︎ Right click to switch model"}
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
    if (!roamContext[context])
      highlightHtmlElt({
        roamElt: context === "logPages" && !isLogView() ? "pageTitle" : context,
      });
    setRoamContext((prev) => {
      const clone = { ...prev };
      clone[context] = !clone[context];
      return clone;
    });
    inputRef.current.focus();
  };

  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      onClick={(e) => e.stopPropagation()}
    >
      {isOpen && (
        <div
          className="bp3-elevation-3 aicommands-div"
          draggable={true}
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
            <MenuDivider
              className="menu-hint"
              title={
                <div>
                  LIVE AI ASSISTANT
                  <br />
                  Default model: {defaultModel}
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
                checked={roamContext.mainPage}
                label="Page"
                inline={true}
                onChange={() => updateContext("mainPage")}
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
            </div>
            <div
              className="aicommands-style"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              Style{" "}
              <Icon
                icon={isPinnedStyle ? "unpin" : "pin"}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPinnedStyle((prev) => !prev);
                }}
                intent={isPinnedStyle ? "primary" : "none"}
              />
              <HTMLSelect
                options={[
                  "Normal",
                  "Concise",
                  "Conversational",
                  "No bullet points",
                  "Atomic",
                  "Quiz",
                  "Socratic",
                ]}
                minimal={true}
                onClick={(e) => {
                  e.stopPropagation();
                }}
                onChange={(e) => {
                  setStyle(e.currentTarget.value);
                  inputRef.current.focus();
                }}
                value={style}
              />
            </div>
            {/* }
            ></MenuDivider> */}
            <Suggest
              popoverRef={popoverRef}
              fill={true}
              items={commands}
              itemListRenderer={groupedItemRenderer}
              itemRenderer={renderCommand}
              itemPredicate={filterCommands}
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
                leftIcon: "filter-list",
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
                        inputRef.current.focus();
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
          </Menu>
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
