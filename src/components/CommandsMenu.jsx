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
import { summarizePrompt, translatePrompt } from "../ai/prompts";

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
      <MenuDivider title={"Apply to focused/selected block(s)"} />
      <>
        <MenuItem
          shouldDismissPopover={false}
          onClick={(e) => {
            handleClickOnCommand(e);
          }}
          onKeyDown={(e) => {
            handleKeyDownOnModel(e);
          }}
          onContextMenu={(e) => handleContextMenu(e, command)}
          tabindex="0"
          text="Basic completion/generation"
        />
        <MenuItem text="Pre-build prompts">
          <MenuItem
            onClick={(e) => {
              handleClickOnCommand(e, summarizePrompt);
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
              e.stopPropagation();
              handleClickOnCommand(
                e,
                translatePrompt.replace("<language>", defaultLgg)
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
                    translatePrompt.replace("<language>", lgg[0])
                  );
                }}
                onKeyDown={(e) => {
                  handleKeyDownOnModel(
                    e,
                    translatePrompt.replace("<language>", lgg[0])
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
                  translatePrompt.replace("<language>", inputElt.value)
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
        <MenuDivider />
        <MenuItem tabindex="0" text="Change default model">
          <ModelsMenu
            command={command}
            instantModel={instantModel}
            roleStructure={"listoption"}
          />
        </MenuItem>
      </>
    </Menu>
  );
}

export default CommandsMenu;
