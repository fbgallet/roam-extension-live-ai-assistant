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
import { defaultModel } from "..";
import ModelsMenu from "./ModelsMenu";
import { completionCommands } from "../ai/prompts";
import { aiCompletionRunner } from "../utils/roamExtensionCommands";

const StandaloneContextMenu = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [selectedCommand, setSelectedCommand] = useState(null);
  const [model, setModel] = useState(null);
  const [completionCallback, setCompletionCallback] = useState(null);
  const [displayModelsMenu, setDisplayModelsMenu] = useState(false);
  const inputRef = useRef(null);
  const popoverRef = useRef(null);

  useEffect(() => {
    window.LiveAI.toggleComponentOpen = (e, callback, instantModel) => {
      console.log("HERE window.LiveAI");
      // console.log("callback :>> ", callback);
      setModel(instantModel);
      // getCallbackFunction();
      setPosition({
        x: Math.min(e.clientX, window.innerWidth - 200),
        y: Math.min(e.clientY, window.innerHeight - 300),
      });
      setIsOpen(true);
    };
  }, []);

  const handleGlobalContextMenu = useCallback(async (e) => {
    e.preventDefault();
    if (!e.metaKey && !e.ctrlKey) return;

    setPosition({
      x: Math.min(e.clientX, window.innerWidth - 200),
      y: Math.min(e.clientY, window.innerHeight - 300),
    });
    setIsOpen(true);
  }, []);

  const handleClickOutside = useCallback((e) => {
    const target = e.target;
    if (!target.closest(".bp3-menu")) {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) setDisplayModelsMenu(false);
  }, [isOpen]);

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

  const commands = [
    { id: 1, name: "Selected blocks as prompt", category: "" },
    { id: 2, name: "Translate", prompt: "", category: "REPHRASE" },
    {
      id: 3,
      name: "Rephrase",
      prompt: "rephrase",
      category: "REPHRASE",
      submenu: [4, 5, 6],
    },
    {
      id: 4,
      name: "Shorter",
      prompt: "shorter",
      category: "REPHRASE",
      isSub: true,
    },
    {
      id: 5,
      name: "Longer",
      prompt: "longer",
      category: "REPHRASE",
      isSub: true,
    },
    {
      id: 6,
      name: "Simpler",
      prompt: "simpler",
      category: "REPHRASE",
      isSub: true,
    },
    { id: 7, name: "Convert", prompt: "", category: "user" },
    { id: 8, name: "My command", prompt: "", category: "user" },
    // ... autres commandes
  ];

  const filterCommands = (query, item) => {
    if (!query) {
      return item.isSub ? false : true;
    }
    if (query.length === 1 && item.isSub) return false;
    const normalizedQuery = query.toLowerCase();
    console.log("normalizedQuery :>> ", normalizedQuery);
    return (
      item.name.toLowerCase().includes(normalizedQuery) ||
      item.category.toLowerCase().includes(normalizedQuery)
    );
  };

  const renderCommand = (command, { handleClick, modifiers }) => {
    let commandPrompt = command.prompt
      ? completionCommands[command.prompt]
      : "";
    return (
      <MenuItem
        key={command.id}
        text={command.name}
        active={modifiers.active}
        onClick={(e) => {
          aiCompletionRunner(e, commandPrompt);
        }}
        onSelect={(e) => console.log("Select")}
        onContextMenu={() => {
          setDisplayModelsMenu(true);
        }}
      >
        {command.submenu ? (
          command.submenu.map((sub) => {
            const subCommand = commands.find((item) => item.id === sub);
            commandPrompt = subCommand.prompt
              ? completionCommands[subCommand.prompt]
              : "";
            return (
              <MenuItem
                key={subCommand.id}
                text={subCommand.name}
                label={subCommand.type}
                active={modifiers.active}
                onClick={(e) => {
                  aiCompletionRunner(e, commandPrompt);
                }}
                onContextMenu={() => {
                  setDisplayModelsMenu(true);
                }}
              >
                {displayModelsMenu ? (
                  <ModelsMenu
                    callback={aiCompletionRunner}
                    commandPrompt={commandPrompt}
                  />
                ) : null}
              </MenuItem>
            );
          })
        ) : displayModelsMenu || command.id === 1 ? (
          <ModelsMenu
            callback={aiCompletionRunner}
            commandPrompt={commandPrompt}
          />
        ) : null}
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
    console.log("grouped :>> ", grouped);
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
          <MenuItem
            text="Use this custom prompt"
            active={true}
            onClick={(e) => aiCompletionRunner(e, query + ":\n")}
            onContextMenu={() => {
              setDisplayModelsMenu(true);
            }}
          >
            {displayModelsMenu ? (
              <ModelsMenu
                callback={aiCompletionRunner}
                commandPrompt={query + ":\n"}
              />
            ) : null}
          </MenuItem>
        )}
        <MenuDivider
          className="menu-hint"
          title={"ℹ︎ Right click to switch model"}
        />
      </Menu>
    );
  };

  return (
    <Popover isOpen={isOpen} onClose={() => setIsOpen(false)}>
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
              onItemSelect={(command) => {
                setSelectedCommand(command);
                console.log("Selected Command :>>", command);
              }}
              inputProps={{
                placeholder: "Live AI command...",
                inputRef: inputRef,
                fill: true,
                leftIcon: "filter-list",
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
  const container = document.getElementById("context-menu-container");
  if (container) {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  }
}
