import {
  ContextMenu,
  Menu,
  MenuItem,
  MenuDivider,
  Tooltip,
} from "@blueprintjs/core";
import {
  defaultModel,
  ollamaModels,
  openRouterModels,
  openRouterModelsInfo,
} from "..";

const ModelsMenu = ({ command }) => {
  const handleClickOnModel = (e, prefix) => {
    let model = e.target.innerText.split("\n")[0];
    switch (model) {
      case "GPT 3.5":
        model = "gpt-3.5-turbo";
        break;
      case "GPT 4":
        model = "gpt-4-turbo-preview";
        break;
    }
    // if (typeof instantModel !== undefined) instantModel.current = model;
    // console.log("instantModel :>> ", instantModel);
    command(e, prefix ? prefix + model : model);
  };

  const handleKeyDownOnModel = (e, prefix) => {
    if (e.code === "Enter" || e.code === "Space") {
      handleClickOnModel(e, prefix);
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
      {openRouterModels.length ? (
        <>
          <MenuDivider title="Through OpenRouter" />
          {openRouterModelsInfo.map((model) => (
            <MenuItem
              icon={defaultModel === model.id && "pin"}
              onClick={(e) => {
                handleClickOnModel(e, "openRouter/");
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e, "openRouter/");
              }}
              tabindex="0"
              text={
                <Tooltip
                  matchTargetWidth={true}
                  hoverOpenDelay={1000}
                  hoverCloseDelay={1000}
                  content={
                    <>
                      <div style={{ maxWidth: "350px" }}>
                        {model.description}
                      </div>
                      <br></br>
                      Pricing:
                      <ul>
                        <li>
                          prompt: {model.promptPricing.toFixed(5)}$ / M tokens
                        </li>
                        <li>
                          completion: {model.completionPricing.toFixed(5)}$ / M
                          tokens
                        </li>
                      </ul>
                    </>
                  }
                >
                  {model.name}
                </Tooltip>
              }
              labelElement={model.contextLength + "k"}
            />
          ))}
        </>
      ) : null}
      {ollamaModels.length ? (
        <>
          <MenuDivider title="Ollama local models" />
          {ollamaModels.map((model) => (
            <MenuItem
              icon={defaultModel === model && "pin"}
              onClick={(e) => {
                handleClickOnModel(e, "ollama/");
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e, "ollama/");
              }}
              tabindex="0"
              text={model}
              // labelElement="200k"
            />
          ))}
        </>
      ) : null}
    </Menu>
  );
};

export default ModelsMenu;
