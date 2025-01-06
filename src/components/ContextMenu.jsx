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

const SELECT_CMD = "Outliner Agent: Set selected outline as target";
const UNSELECT_CMD = "Outliner Agent: Unselect current outline";

const AI_COMMANDS = [
  { id: 10, name: "Selected blocks as prompt", category: "", onlyGen: true },
  {
    id: 20,
    icon: "properties",
    name: SELECT_CMD,
    prompt: "",
    category: "",
    onlyOutliner: true,
  },
  {
    id: 21,
    icon: "properties",
    name: "Outliner Agent: Apply selected blocks as prompt",
    prompt: "",
    category: "",
    onlyOutliner: true,
  },
  {
    id: 12,
    name: "Extract highlighted texts",
    prompt: "extractHighlights",
    category: "EXTRACT",
    includeUids: true,
  },
  { id: 110, name: "Translate", prompt: "", category: "REPHRASE" },
  {
    id: 11,
    name: "Rephrase",
    prompt: "rephrase",
    category: "REPHRASE",
    submenu: [111, 112, 113],
  },
  {
    id: 111,
    name: "Shorter",
    prompt: "shorten",
    category: "REPHRASE",
    isSub: true,
  },
  {
    id: 112,
    name: "Clearer",
    prompt: "longer",
    category: "REPHRASE",
    isSub: true,
  },
  {
    id: 113,
    name: "More accessible",
    prompt: "accessible",
    category: "REPHRASE",
    isSub: true,
  },

  { id: 8, name: "Convert", prompt: "", category: "user" },
  { id: 9, name: "My command", prompt: "", category: "user" },
  // ... autres commandes
];

const StandaloneContextMenu = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [commands, setCommands] = useState(AI_COMMANDS);
  const [selectedCommand, setSelectedCommand] = useState(null);
  const [model, setModel] = useState(null);
  const [isOutlinerAgent, setIsOutlinerAgent] = useState(false);
  const [displayModelsMenu, setDisplayModelsMenu] = useState(false);
  const [blockUid, setBlockUid] = useState(null);
  const [rootUid, setRootUid] = useState(null);
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

  const insertModelsMenu = (callback, command, prompt) => {
    return displayModelsMenu || command.id === 10 ? (
      <ModelsMenu callback={callback} command={command} prompt={prompt} />
    ) : null;
  };

  const renderCommand = (command, { handleClick, modifiers }) => {
    let prompt = command.prompt ? completionCommands[command.prompt] : "";

    return (
      <MenuItem
        key={command.id}
        icon={command.icon}
        text={command.name}
        active={command === modifiers.active}
        onClick={(e) => {
          handleClickOnCommand({ e, command, prompt });
        }}
        onSelect={(e) => console.log("Select")}
        onContextMenu={
          command.id !== 20
            ? () => {
                setDisplayModelsMenu(true);
              }
            : null
        }
      >
        {command.submenu
          ? command.submenu.map((sub) => {
              const subCommand = commands.find((item) => item.id === sub);
              prompt = subCommand.prompt
                ? completionCommands[subCommand.prompt]
                : "";
              return (
                <MenuItem
                  key={subCommand.id}
                  text={subCommand.name}
                  label={subCommand.type}
                  active={modifiers.active}
                  onClick={(e) => {
                    handleClickOnCommand({ e, command: subCommand, prompt });
                  }}
                  onContextMenu={() => {
                    setDisplayModelsMenu(true);
                  }}
                >
                  {insertModelsMenu(handleClickOnCommand, command, prompt)}
                </MenuItem>
              );
            })
          : insertModelsMenu(handleClickOnCommand, command, prompt)}
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
                onContextMenu={() => {
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
              onContextMenu={() => {
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
                handleClick(e, command);
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
