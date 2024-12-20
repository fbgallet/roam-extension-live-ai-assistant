import {
  ContextMenu,
  Menu,
  MenuItem,
  MenuDivider,
  Tooltip,
} from "@blueprintjs/core";
import {
  defaultModel,
  groqModels,
  ollamaModels,
  openAiCustomModels,
  openRouterModels,
  openRouterModelsInfo,
  openRouterOnly,
} from "..";
import { tokensLimit } from "../ai/modelsInfo";

const ModelsMenu = ({ command, roleStructure = "menuitem" }) => {
  const handleClickOnModel = (e, prefix) => {
    let model = e.target.innerText.split("\n")[0];

    switch (model) {
      case "GPT 4o mini":
        model = "gpt-4o-mini";
        break;
      case "GPT 4o":
        model = "gpt-4o";
        break;
    }
    if (prefix === "openRouter/") {
      const modelInfo = openRouterModelsInfo.find(
        (item) => item.name === model
      );
      model = modelInfo.id;
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
    <Menu className="str-aimodels-menu" roleStructure={roleStructure}>
      {/* <MenuDivider
        title={
          "Choose AI model" + (openRouterOnly ? " (OpenRouter)" : "") + ":"
        }
      /> */}
      {openRouterOnly ? null : (
        <>
          <MenuItem
            icon={defaultModel === "gpt-4o-mini" && "pin"}
            onClick={(e) => {
              handleClickOnModel(e);
            }}
            onKeyDown={(e) => {
              handleKeyDownOnModel(e);
            }}
            tabindex="0"
            text="GPT 4o mini"
            labelElement="128k"
          />
          <MenuItem
            icon={defaultModel === "gpt-4o" && "pin"}
            onClick={(e) => {
              handleClickOnModel(e);
            }}
            onKeyDown={(e) => {
              handleKeyDownOnModel(e);
            }}
            tabindex="0"
            text="GPT 4o"
            labelElement="128k"
          />
          <MenuItem text="o1 'reasoning' models">
            <MenuDivider
              title={
                <p>
                  ⚠️ Use with caution,
                  <br />
                  expensive models!
                  <br />
                  See{" "}
                  <a href="https://openai.com/api/pricing/" target="_blank">
                    pricing
                  </a>{" "}
                  &{" "}
                  <a
                    href="https://openai.com/index/learning-to-reason-with-llms/"
                    target="_blank"
                  >
                    purpose
                  </a>
                </p>
              }
            />
            <MenuItem
              icon={defaultModel === "o1-mini" && "pin"}
              onClick={(e) => {
                handleClickOnModel(e);
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              tabindex="0"
              text="o1-mini"
              labelElement="128k"
            />
            <MenuItem
              icon={defaultModel === "o1" && "pin"}
              onClick={(e) => {
                handleClickOnModel(e);
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              tabindex="0"
              text="o1"
              labelElement="200k"
            />
          </MenuItem>
          {openAiCustomModels && openAiCustomModels.length ? (
            <MenuItem tabindex="0" text="Custom OpenAI models">
              {openAiCustomModels.map((model) => (
                <MenuItem
                  icon={
                    defaultModel === "first custom OpenAI model" &&
                    openAiCustomModels[0] === model &&
                    "pin"
                  }
                  onClick={(e) => {
                    handleClickOnModel(e);
                  }}
                  onKeyDown={(e) => {
                    handleKeyDownOnModel(e);
                  }}
                  tabindex="0"
                  text={model}
                  labelElement={
                    tokensLimit[model]
                      ? (tokensLimit[model] / 1000).toFixed(0).toString() + "k"
                      : null
                  }
                />
              ))}
            </MenuItem>
          ) : null}
          <MenuDivider />
          <MenuItem
            icon={defaultModel === "Claude Haiku 3.5" && "pin"}
            onClick={(e) => {
              handleClickOnModel(e);
            }}
            onKeyDown={(e) => {
              handleKeyDownOnModel(e);
            }}
            tabindex="0"
            text="Claude Haiku 3.5"
            labelElement="200k"
          />
          <MenuItem
            icon={defaultModel === "Claude Sonnet 3.5" && "pin"}
            onClick={(e) => {
              handleClickOnModel(e);
            }}
            onKeyDown={(e) => {
              handleKeyDownOnModel(e);
            }}
            tabindex="0"
            text="Claude Sonnet 3.5"
            labelElement="200k"
          />
          <MenuItem text="Claude 3 older models">
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
          </MenuItem>
        </>
      )}
      {openRouterModels.length ? (
        <>
          {openRouterOnly ? null : <MenuDivider title="Through OpenRouter" />}
          {openRouterModelsInfo.length ? (
            openRouterModelsInfo.map((model) => (
              <MenuItem
                icon={
                  defaultModel.includes("OpenRouter") &&
                  openRouterModels.length &&
                  openRouterModels[0] === model &&
                  "pin"
                }
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
                            prompt: {model.promptPricing.toFixed(3)}$ / M tokens
                          </li>
                          <li>
                            completion: {model.completionPricing.toFixed(3)}$ /
                            M tokens
                          </li>
                          {model.imagePricing ? (
                            <li>
                              image: {model.imagePricing.toFixed(2)}$ / k tokens
                            </li>
                          ) : null}
                        </ul>
                      </>
                    }
                  >
                    {model.name.split("(")[0].trim()}
                  </Tooltip>
                }
                labelElement={model.contextLength + "k"}
              />
            ))
          ) : (
            <div>OpenRouter works only online</div>
          )}
        </>
      ) : null}
      {groqModels.length ? (
        <>
          <MenuDivider title="Through Groq" />
          {groqModels.map((model) => (
            <MenuItem
              icon={
                defaultModel.includes("Groq") &&
                groqModels.length &&
                groqModels[0] === model &&
                "pin"
              }
              onClick={(e) => {
                handleClickOnModel(e, "groq/");
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e, "groq/");
              }}
              tabindex="0"
              text={model}
            />
          ))}
        </>
      ) : null}
      {ollamaModels.length ? (
        <>
          <MenuDivider title="Ollama local models" />
          {ollamaModels.map((model) => (
            <MenuItem
              icon={
                defaultModel.includes("Ollama") &&
                ollamaModels.length &&
                ollamaModels[0] === model &&
                "pin"
              }
              onClick={(e) => {
                handleClickOnModel(e, "ollama/");
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e, "ollama/");
              }}
              tabindex="0"
              text={model}
              labelElement="8k"
            />
          ))}
        </>
      ) : null}
    </Menu>
  );
};

export default ModelsMenu;
