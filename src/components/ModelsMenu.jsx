import { ContextMenu, Menu, MenuItem, MenuDivider } from "@blueprintjs/core";
import { defaultModel } from "..";

const ModelsMenu = ({ command, instantModel }) => {
  const handleClickOnModel = (e) => {
    let model = e.target.innerText.split("\n")[0];
    switch (model) {
      case "GPT 3.5":
        model = "gpt-3.5-turbo";
        break;
      case "GPT 4":
        model = "gpt-4-turbo-preview";
        break;
    }
    if (instantModel) instantModel.current = model;
    command(e, model);
  };

  const handleKeyDownOnModel = (e) => {
    if (e.code === "Enter" || e.code === "Space") {
      handleClickOnModel(e);
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
          handleClickOnModel(e);
        }}
        onKeyDown={(e) => {
          handleKeyDownOnModel(e);
        }}
        tabindex="0"
        text="GPT 3.5"
        labelElement="32k"
      />
      <MenuItem
        icon={defaultModel === "gpt-4-turbo-preview" && "pin"}
        onClick={(e) => {
          handleClickOnModel(e);
        }}
        onKeyDown={(e) => {
          handleKeyDownOnModel(e);
        }}
        tabindex="0"
        text="GPT 4"
        labelElement="128k"
      />
      <MenuDivider />
      <MenuItem
        icon={defaultModel === "Claude Haiku" && "pin"}
        onClick={(e) => {
          handleClickOnModel(e);
        }}
        onKeyDown={(e) => {
          handleKeyDownOnModel(e);
        }}
        tabindex="0"
        text="Claude Haiku"
        labelElement="200k"
      />
      <MenuItem
        icon={defaultModel === "Claude Sonnet" && "pin"}
        onClick={(e) => {
          handleClickOnModel(e);
        }}
        onKeyDown={(e) => {
          handleKeyDownOnModel(e);
        }}
        tabindex="0"
        text="Claude Sonnet"
        labelElement="200k"
      />
      <MenuItem
        icon={defaultModel === "Claude Opus" && "pin"}
        onClick={(e) => {
          handleClickOnModel(e);
        }}
        onKeyDown={(e) => {
          handleKeyDownOnModel(e);
        }}
        tabindex="0"
        text="Claude Opus"
        labelElement="200k"
      />
    </Menu>
  );
};

export default ModelsMenu;
