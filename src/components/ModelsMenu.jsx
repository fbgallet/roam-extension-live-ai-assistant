import { ContextMenu, Menu, MenuItem, MenuDivider } from "@blueprintjs/core";
import { defaultModel } from "..";

const ModelsMenu = ({ command, instantModel }) => {
  const handleClickOnModel = (e, com) => {
    const model = e.target.innerText.split("\n")[0];
    switch (model) {
      case "GPT 3.5":
        instantModel.current = "gpt-3.5-turbo";
        break;
      case "GPT 4":
        instantModel.current = "gpt-4-turbo-preview";
        break;
      default:
        instantModel.current = model;
    }
    com(e);
  };

  const handleKeyDownOnModel = (e, com) => {
    if (e.code === "Enter" || e.code === "Space") {
      handleClickOnModel(e, com);
      ContextMenu.hide();
    }
  };

  return (
    <Menu className="str-aimodels-menu">
      {/* <p></p> */}
      <MenuDivider title="Choose AI model:" />
      <MenuItem
        icon={defaultModel === "gpt-3.5-turbo" && "pin"}
        onClick={(e) => {
          handleClickOnModel(e, command);
        }}
        onKeyDown={(e) => {
          handleKeyDownOnModel(e, command);
        }}
        tabindex="0"
        text="GPT 3.5"
        labelElement="32k"
      />
      <MenuItem
        icon={defaultModel === "gpt-4-turbo-preview" && "pin"}
        onClick={(e) => {
          handleClickOnModel(e, command);
        }}
        onKeyDown={(e) => {
          handleKeyDownOnModel(e, command);
        }}
        tabindex="0"
        text="GPT 4"
        labelElement="128k"
      />
      <MenuDivider />
      <MenuItem
        icon={defaultModel === "Claude Haiku" && "pin"}
        onClick={(e) => {
          handleClickOnModel(e, command);
        }}
        onKeyDown={(e) => {
          handleKeyDownOnModel(e, command);
        }}
        tabindex="0"
        text="Claude Haiku"
        labelElement="200k"
      />
      <MenuItem
        icon={defaultModel === "Claude Sonnet" && "pin"}
        onClick={(e) => {
          handleClickOnModel(e, command);
        }}
        onKeyDown={(e) => {
          handleKeyDownOnModel(e, command);
        }}
        tabindex="0"
        text="Claude Sonnet"
        labelElement="200k"
      />
      <MenuItem
        icon={defaultModel === "Claude Opus" && "pin"}
        onClick={(e) => {
          handleClickOnModel(e, command);
        }}
        onKeyDown={(e) => {
          handleKeyDownOnModel(e, command);
        }}
        tabindex="0"
        text="Claude Opus"
        labelElement="200k"
      />
    </Menu>
  );
};

export default ModelsMenu;
