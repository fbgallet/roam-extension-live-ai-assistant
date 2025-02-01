import {
  ContextMenu,
  Menu,
  MenuItem,
  MenuDivider,
  Tooltip,
} from "@blueprintjs/core";
import {
  anthropicLibrary,
  deepseekLibrary,
  defaultModel,
  extensionStorage,
  groqModels,
  ollamaModels,
  openAiCustomModels,
  openRouterModels,
  openRouterModelsInfo,
  openRouterOnly,
  openaiLibrary,
  setDefaultModel,
} from "..";
import { tokensLimit } from "../ai/modelsInfo";
import { AppToaster } from "./Toaster";

const ModelsMenu = ({
  callback,
  command,
  prompt,
  roleStructure = "menuitem",
}) => {
  const handleClickOnModel = async (e, prefix, modelId) => {
    let model = getModelFromMenu(e, prefix, modelId);
    await callback({ e, command, prompt, model });
  };

  const handleKeyDownOnModel = (e, prefix, modelId) => {
    if (e.code === "Enter" || e.code === "Space") {
      handleClickOnModel(e, prefix, modelId);
      //  ContextMenu.hide();
    }
  };

  const handleContextMenu = (e, prefix, modelId) => {
    let model = getModelFromMenu(e, prefix, modelId);
    setDefaultModel(model);
    AppToaster.show({
      message: `Default AI model set to: ${model}`,
      timeout: 5000,
    });
  };

  const getModelFromMenu = (e, prefix, modelId) => {
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
      model = modelId;
      // const modelInfo = openRouterModelsInfo.find(
      //   (item) => item.name === model
      // );
      // model = modelInfo.id;
    }
    if (prefix) model = prefix + model;
    // if (typeof instantModel !== undefined) instantModel.current = model;
    // console.log("instantModel :>> ", instantModel);
    return model;
  };

  return (
    <Menu className="str-aimodels-menu" roleStructure={roleStructure}>
      {
        openRouterOnly ? null : openaiLibrary ? (
          <>
            <MenuItem
              icon={defaultModel === "gpt-4o-mini" && "pin"}
              onClick={(e) => {
                handleClickOnModel(e);
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              onContextMenu={(e) => handleContextMenu(e)}
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
              onContextMenu={(e) => handleContextMenu(e)}
              tabindex="0"
              text="GPT 4o"
              labelElement="128k"
            />
            <MenuItem text="o1 'reasoning' models">
              <MenuItem
                icon={defaultModel === "o3-mini" && "pin"}
                onClick={(e) => {
                  handleClickOnModel(e);
                }}
                onKeyDown={(e) => {
                  handleKeyDownOnModel(e);
                }}
                onContextMenu={(e) => handleContextMenu(e)}
                tabindex="0"
                text="o3-mini"
                labelElement="200k"
              />
              <MenuItem
                icon={defaultModel === "o1-mini" && "pin"}
                onClick={(e) => {
                  handleClickOnModel(e);
                }}
                onKeyDown={(e) => {
                  handleKeyDownOnModel(e);
                }}
                onContextMenu={(e) => handleContextMenu(e)}
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
                onContextMenu={(e) => handleContextMenu(e)}
                tabindex="0"
                text="o1"
                labelElement="200k"
              />
              <MenuDivider
                className="menu-hint"
                title={
                  <p>
                    ⚠️ Use with caution,
                    <br />
                    quite expensive models!
                    <br />
                    & not available for all users
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
                    onContextMenu={(e) => handleContextMenu(e)}
                    tabindex="0"
                    text={model}
                    labelElement={
                      tokensLimit[model]
                        ? (tokensLimit[model] / 1000).toFixed(0).toString() +
                          "k"
                        : null
                    }
                  />
                ))}
              </MenuItem>
            ) : null}
          </>
        ) : (
          <MenuDivider className="menu-hint" title="No OpenAI API key" />
        )
        // <MenuDivider />
      }
      {anthropicLibrary ? (
        <>
          {openaiLibrary && <MenuDivider />}
          <MenuItem
            icon={defaultModel === "Claude Haiku 3.5" && "pin"}
            onClick={(e) => {
              handleClickOnModel(e);
            }}
            onKeyDown={(e) => {
              handleKeyDownOnModel(e);
            }}
            onContextMenu={(e) => handleContextMenu(e)}
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
            onContextMenu={(e) => handleContextMenu(e)}
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
              onContextMenu={(e) => handleContextMenu(e)}
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
              onContextMenu={(e) => handleContextMenu(e)}
              tabindex="0"
              text="Claude Opus"
              labelElement="200k"
            />
          </MenuItem>
        </>
      ) : (
        <MenuDivider className="menu-hint" title="No Anthropic API key" />
      )}
      {openRouterOnly ? null : deepseekLibrary ? (
        <>
          {(openaiLibrary || anthropicLibrary) && <MenuDivider />}
          <MenuItem
            icon={defaultModel === "deepseek-chat" && "pin"}
            onClick={(e) => {
              handleClickOnModel(e);
            }}
            onKeyDown={(e) => {
              handleKeyDownOnModel(e);
            }}
            onContextMenu={(e) => handleContextMenu(e)}
            tabindex="0"
            text="deepseek-chat"
            labelElement="64k"
          />
          <MenuItem
            icon={defaultModel === "deepseek-reasoner" && "pin"}
            onClick={(e) => {
              handleClickOnModel(e);
            }}
            onKeyDown={(e) => {
              handleKeyDownOnModel(e);
            }}
            onContextMenu={(e) => handleContextMenu(e)}
            tabindex="0"
            text="deepseek-reasoner"
            labelElement="64k"
          />
        </>
      ) : (
        <MenuDivider className="menu-hint" title="No DeepSeek API key" />
      )}
      {openRouterModels.length ? (
        <>
          {openRouterOnly ? null : <MenuDivider title="Through OpenRouter" />}
          {openRouterModelsInfo.length ? (
            openRouterModelsInfo.map((model) => (
              <MenuItem
                icon={
                  ((defaultModel.includes("OpenRouter") &&
                    openRouterModels.length &&
                    openRouterModels[0] === model) ||
                    defaultModel === `openRouter/${model.id}`) &&
                  "pin"
                }
                onClick={(e) => {
                  handleClickOnModel(e, "openRouter/", model.id);
                }}
                onKeyDown={(e) => {
                  handleKeyDownOnModel(e, "openRouter/", model.id);
                }}
                onContextMenu={(e) =>
                  handleContextMenu(e, "openRouter/", model.id)
                }
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
                ((defaultModel.includes("Groq") &&
                  groqModels.length &&
                  groqModels[0] === model) ||
                  defaultModel === `groq/${model}`) &&
                "pin"
              }
              onClick={(e) => {
                handleClickOnModel(e, "groq/");
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e, "groq/");
              }}
              onContextMenu={(e) => handleContextMenu(e, "groq/")}
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
                ((defaultModel.includes("Ollama") &&
                  ollamaModels.length &&
                  ollamaModels[0] === model) ||
                  defaultModel === `ollama/${model}`) &&
                "pin"
              }
              onClick={(e) => {
                handleClickOnModel(e, "ollama/");
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e, "ollama/");
              }}
              onContextMenu={(e) => handleContextMenu(e, "ollama/")}
              tabindex="0"
              text={model}
              labelElement="8k"
            />
          ))}
        </>
      ) : null}
      <MenuDivider
        className="menu-hint"
        title="ℹ︎ Right click on model to set as default"
      />
    </Menu>
  );
};

export default ModelsMenu;
