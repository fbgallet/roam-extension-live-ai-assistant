import {
  ContextMenu,
  InputGroup,
  Menu,
  MenuItem,
  MenuDivider,
  Tooltip,
} from "@blueprintjs/core";
import { Popover, Position } from "@blueprintjs/core";
import { defaultModel } from "..";
import ModelsMenu from "./ModelsMenu";
import { getFocusAndSelection } from "../utils/utils";
import { invokeNLQueryInterpreter } from "../ai/agents/nl-query";
import { completionCommands } from "../ai/prompts";

function CommandsMenu({ command, instantModel }) {
  let defaultLgg = "English";
  const handleClickOnCommand = (e, commandPrompt) => {
    // let command = e.target.innerText.split("\n")[0];
    console.log("instantModel :>> ", instantModel);
    if (e.metaKey && commandPrompt.includes("Translate the following content"))
      return;
    command(e, instantModel.current || defaultModel, commandPrompt);
  };

  const handleKeyDownOnModel = (e, commandPrompt) => {
    if (e.code === "Enter" || e.code === "Space") {
      handleClickOnCommand(e, commandPrompt, false);
      ContextMenu.hide();
    }
  };

  const handleAgentCommand = async (e, agent) => {
    let { currentUid, currentBlockContent, selectionUids } =
      getFocusAndSelection();
    await invokeNLQueryInterpreter({
      currentUid,
      prompt: currentBlockContent,
    });
  };

  const handleContextMenu = (e, command) => {
    e.preventDefault();
    ContextMenu.show(
      ModelsMenu({ command }),
      { left: e.clientX, top: e.clientY },
      null
    );
  };

  return (
    <Menu className="str-aicommands-menu">
      <MenuDivider
        className="menu-hint"
        title={`Default model: ${defaultModel}`}
      />
      <>
        <MenuItem
          active={false}
          shouldDismissPopover={false}
          onClick={(e) => {
            handleClickOnCommand(e);
          }}
          onKeyDown={(e) => {
            handleKeyDownOnModel(e);
          }}
          onContextMenu={(e) => handleContextMenu(e, command)}
          tabindex="0"
          text="Selected block(s) as prompt"
        >
          <ModelsMenu
            command={command}
            instantModel={instantModel}
            roleStructure={"listoption"}
          />
        </MenuItem>
        <MenuItem text="Pre-build prompts">
          <MenuItem
            onClick={(e) => {
              handleClickOnCommand(e, completionCommands["correctWording"]);
            }}
            onKeyDown={(e) => {
              handleKeyDownOnModel(e);
            }}
            onContextMenu={(e) => handleContextMenu(e, command)}
            tabindex="0"
            text="Fix wording"
          />
          <MenuItem
            onClick={(e) => {
              handleClickOnCommand(e, completionCommands["rephrase"]);
            }}
            onKeyDown={(e) => {
              handleKeyDownOnModel(e);
            }}
            onContextMenu={(e) => handleContextMenu(e, command)}
            tabindex="0"
            text="Rephrase"
          >
            <MenuItem
              onClick={(e) => {
                handleClickOnCommand(e, completionCommands["shorten"]);
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              onContextMenu={(e) => handleContextMenu(e, command)}
              tabindex="0"
              text="Shorter"
            />
            <MenuItem
              onClick={(e) => {
                handleClickOnCommand(e, completionCommands["clearer"]);
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              onContextMenu={(e) => handleContextMenu(e, command)}
              tabindex="0"
              text="Clearer"
            />
            <MenuItem
              onClick={(e) => {
                handleClickOnCommand(e, completionCommands["accessible"]);
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              onContextMenu={(e) => handleContextMenu(e, command)}
              tabindex="0"
              text="More accessible"
            />
            <MenuItem
              onClick={(e) => {
                handleClickOnCommand(e, completionCommands["formal"]);
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              onContextMenu={(e) => handleContextMenu(e, command)}
              tabindex="0"
              text="More formal"
            />
            <MenuItem
              onClick={(e) => {
                handleClickOnCommand(e, completionCommands["casual"]);
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              onContextMenu={(e) => handleContextMenu(e, command)}
              tabindex="0"
              text="More casual"
            />
          </MenuItem>
          <MenuItem text="Format...">
            <MenuItem
              onClick={(e) => {
                handleClickOnCommand(e, completionCommands["outline"]);
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              onContextMenu={(e) => handleContextMenu(e, command)}
              tabindex="0"
              text="Text to Outline"
            />
            <MenuItem
              onClick={(e) => {
                handleClickOnCommand(e, completionCommands["linearParagraph"]);
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              onContextMenu={(e) => handleContextMenu(e, command)}
              tabindex="0"
              text="Outline to Text"
            />
          </MenuItem>
          <MenuItem text="Content Generator...">
            <MenuItem
              onClick={(e) => {
                handleClickOnCommand(e, completionCommands["summarize"]);
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              onContextMenu={(e) => handleContextMenu(e, command)}
              tabindex="0"
              text="Summarize"
            />
            <MenuItem
              onClick={(e) => {
                handleClickOnCommand(e, completionCommands.argument);
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              onContextMenu={(e) => handleContextMenu(e, command)}
              tabindex="0"
              text="Argument"
            />
          </MenuItem>
          <MenuItem
            onClick={(e) => {
              handleClickOnCommand(e, completionCommands.challengeMyIdeas);
            }}
            onKeyDown={(e) => {
              handleKeyDownOnModel(e);
            }}
            onContextMenu={(e) => handleContextMenu(e, command)}
            tabindex="0"
            text="Challenge my ideas!"
          />
          <MenuItem
            onClick={(e) => {
              e.stopPropagation();
              handleClickOnCommand(
                e,
                completionCommands.translate.replace("<language>", defaultLgg)
              );
            }}
            onKeyDown={(e) => {
              handleKeyDownOnModel(e);
            }}
            onContextMenu={(e) => handleContextMenu(e, command)}
            tabindex="0"
            text={`Translate to (${defaultLgg})`}
          >
            {[
              ["English", "🇺🇸"],
              ["Spanish", "🇪🇸"],
              ["Mandarin Chinese", "🇨🇳"],
              ["Arabic", "🇸🇦"],
              ["Hindi", "🇮🇳"],
              ["French", "🇫🇷"],
              ["Portuguese", "🇵🇹"],
              ["Russian", "🇷🇺"],
              ["German", "🇩🇪"],
              ["Japanese", "🇯🇵"],
            ].map((lgg) => (
              <MenuItem
                shouldDismissPopover={false}
                icon={defaultLgg === lgg[0] ? "pin" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  if (e.metaKey) {
                    console.log("Meta key!", lgg[0]);
                    defaultLgg = lgg[0];
                    return;
                  }
                  handleClickOnCommand(
                    e,
                    completionCommands.translate.replace("<language>", lgg[0])
                  );
                }}
                onKeyDown={(e) => {
                  handleKeyDownOnModel(
                    e,
                    completionCommands.translate.replace("<language>", lgg[0])
                  );
                }}
                onContextMenu={(e) => handleContextMenu(e, command)}
                tabindex="0"
                text={lgg[0]}
                label={lgg[1]}
              />
            ))}
            <MenuItem
              icon={defaultLgg === "this?" ? "pin" : ""}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const inputElt = document.querySelector(
                  ".lai-custom-lgg-input > input"
                );
                handleClickOnCommand(
                  e,
                  completionCommands.translate.replace(
                    "<language>",
                    inputElt.value
                  )
                );
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              tabindex="0"
              text={
                <>
                  User defined:{" "}
                  <InputGroup
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    // defaultValue={"Greek"}
                    // value={customLgg}
                    onValueChange={(e) => setCustomLgg(e)}
                    fill={true}
                    className={"lai-custom-lgg-input"}
                  />
                </>
              }
              label="✍️"
            />
          </MenuItem>
        </MenuItem>
        <MenuDivider title="AI Agents" />
        <MenuItem
          onClick={(e) => {
            handleAgentCommand(e, "nlquery");
          }}
          onKeyDown={(e) => {
            handleKeyDownOnModel(e);
          }}
          tabindex="0"
          text="Natural language Query converter"
        />
      </>
    </Menu>
  );
}

export default CommandsMenu;
