import {
  InputGroup,
  Menu,
  MenuItem,
  Popover,
  MenuDivider,
} from "@blueprintjs/core";
import { Suggest } from "@blueprintjs/select";
import React, { useState, useCallback, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { defaultModel, extensionStorage, isComponentVisible } from "..";
import ModelsMenu from "./ModelsMenu";
import { completionCommands } from "../ai/prompts";
import { aiCompletionRunner } from "../utils/roamExtensionCommands";
import {
  highlightHtmlElt,
  insertInstantButtons,
  mountComponent,
  setAsOutline,
  toggleOutlinerSelection,
  unmountComponent,
} from "../utils/domElts";
import { invokeOutlinerAgent } from "../ai/agents/outliner-agent";
import { PREBUILD_COMMANDS, languages } from "../ai/prebuildCommands";

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
  const [blockUid, setBlockUid] = useState(null);
  const [rootUid, setRootUid] = useState(null);
  const [defaultLgg, setDefaultLgg] = useState(
    extensionStorage.get("translationDefaultLgg")
  );
  const [customLgg, setCustomLgg] = useState(
    extensionStorage.get("translationCustomLgg")
  );
  const inputRef = useRef(null);
  const popoverRef = useRef(null);
  const focusedBlock = useRef(
    window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"]
  );

  useEffect(() => {
    window.LiveAI.toggleContextMenu = ({
      e,
      onlyOutliner = false,
      instantModel,
      blockUid,
    }) => {
      console.log("HERE window.LiveAI");
      setIsOutlinerAgent(onlyOutliner);
      instantModel && setModel(instantModel);
      blockUid && setBlockUid(blockUid);
      setPosition({
        x: Math.min(e.clientX, window.innerWidth - 200),
        y: Math.min(e.clientY, window.innerHeight - 300),
      });
      setIsOpen(true);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) setDisplayModelsMenu(false);
    else updateMenu();
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
    console.log("rootUid :>> ", rootUid);
    console.log("currentRootUid :>> ", currentRootUid);
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
    console.log("command :>> ", command);
    console.log("customLgg :>> ", customLgg);
    if (command.id === 11 || Math.floor(command.id / 100) === 11) {
      const selectedLgg =
        command.id === 11
          ? defaultLgg
          : command.id === 1199
          ? customLgg
          : command.name;
      console.log("selectedLgg :>> ", selectedLgg);
      if (defaultLgg !== selectedLgg) {
        setDefaultLgg(selectedLgg);
        extensionStorage.set("translationDefaultLgg", selectedLgg);
      }
      prompt = prompt.replace("<language>", selectedLgg);
    }
    console.log("Prompt clicker in context menu: ", prompt);
    if (
      !command.onlyOutliner &&
      (!isOutlinerAgent || (!rootUid && command.id !== 20))
    )
      aiCompletionRunner({
        e,
        blockUid,
        prompt,
        instantModel: model,
        includeUids: command.includeUids,
      });
    else {
      if (command.id === 20) handleOutlineSelection();
      else handleOutlinePrompt(e, prompt, model);
    }
  };

  const handleGlobalContextMenu = useCallback(async (e) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
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
      console.log("popoverRef :>> ", popoverRef.current);
      console.log("inputRef.current :>> ", inputRef.current);
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
      item.category.toLowerCase().includes(normalizedQuery)
    );
  };

  const insertModelsMenu = (callback, command) => {
    return displayModelsMenu || command.id === 10 ? (
      <ModelsMenu callback={callback} command={command} />
    ) : null;
  };

  const renderCommand = (command, { handleClick, modifiers }) => {
    return (
      <MenuItem
        key={command.id}
        icon={command.icon}
        text={
          // command.id === 11
          //   ? command.name.replace("<default>", defaultLgg)
          //   :
          command.name
        }
        label={
          // command.id === 11
          //   ? languages.find((elt) => elt[0] === defaultLgg)[1]
          //   :
          command.label
        }
        active={command === modifiers.active}
        onClick={(e) => {
          handleClickOnCommand({ e, command });
        }}
        onSelect={(e) => console.log("Select")}
        onContextMenu={(e) => {
          e.preventDefault();
          command.id !== 20
            ? () => {
                setDisplayModelsMenu(true);
              }
            : null;
        }}
      >
        {command.submenu
          ? command.submenu.map((sub) => {
              const subCommand = commands.find((item) => item.id === sub);
              return subCommand.id === 1199 ? (
                customLggMenuItem(subCommand)
              ) : (
                <MenuItem
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
    filteredItems.forEach((item) => {
      if (!grouped[item.category]) {
        grouped[item.category] = [];
      }
      grouped[item.category].push(item);
    });
    // console.log("grouped :>> ", grouped);
    return (
      <Menu className="str-aicommands-menu" ulRef={itemsParentRef}>
        {filteredItems.length ? (
          Object.entries(grouped)
            .filter(([_, categoryItems]) => categoryItems.length > 0)
            .map(([category, categoryItems]) => (
              <React.Fragment key={category}>
                {category && (
                  <MenuDivider className="menu-hint" title={category} />
                )}
                {categoryItems.map((item) => renderItem(item))}
              </React.Fragment>
            ))
        ) : (
          <>
            {rootUid ? (
              <MenuItem
                text="Outliner Agent: Apply this custom prompt"
                active={true}
                onClick={(e) => handleOutline(query)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setDisplayModelsMenu(true);
                }}
              >
                {insertModelsMenu(aiCompletionRunner, query)}
              </MenuItem>
            ) : null}
            <MenuItem
              text="Use this custom prompt"
              active={!rootUid ? true : false}
              onClick={(e) => aiCompletionRunner(e, query + ":\n")}
              onContextMenu={(e) => {
                e.preventDefault();
                setDisplayModelsMenu(true);
              }}
            >
              {insertModelsMenu(aiCompletionRunner, query + ":\n")}
            </MenuItem>
          </>
        )}
        <MenuDivider
          className="menu-hint"
          title={"ℹ︎ Right click to switch model"}
        />
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

  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      // onClick={(e) => e.stopPropagation()}
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
            <Suggest
              // style={{
              //   zIndex: 999,
              // }}
              popoverRef={popoverRef}
              tabIndex="0"
              fill={true}
              items={commands}
              itemListRenderer={groupedItemRenderer}
              itemRenderer={renderCommand}
              itemPredicate={filterCommands}
              onItemSelect={(command, e) => {
                console.log("e :>> ", e);
                // setSelectedCommand(command);
                handleClickOnCommand(e, command);
                console.log("Selected Command :>>", command);
              }}
              inputProps={{
                placeholder: "Live AI command...",
                inputRef: inputRef,
                fill: true,
                leftIcon: "filter-list",
                onClick: (e) => e.stopPropagation(),
              }}
              popoverProps={{
                minimal: true,
                placement: "right-start",
                popoverClassName: "suggested-aicommands",
              }}
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
