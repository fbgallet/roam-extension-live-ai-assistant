import {
  Menu,
  MenuItem,
  MenuDivider,
  Tooltip,
  Divider,
} from "@blueprintjs/core";
import {
  anthropicLibrary,
  customOpenAIOnly,
  deepseekLibrary,
  defaultModel,
  extensionStorage,
  googleLibrary,
  grokLibrary,
  groqModels,
  ollamaModels,
  openAiCustomModels,
  openRouterModels,
  openRouterModelsInfo,
  openRouterOnly,
  openaiLibrary,
  setDefaultModel,
} from "..";
import { normalizeClaudeModel, tokensLimit } from "../ai/modelsInfo";
import { AppToaster } from "./Toaster";
import { imageGeneration } from "../ai/aiAPIsHub";

const ModelsMenu = ({
  callback,
  command,
  prompt,
  setModel,
  roleStructure = "menuitem",
  isConversationToContinue,
}) => {
  let isWebSearch, isImageGeneration;
  if (command?.name === "Web search") isWebSearch = true;
  if (command?.name.includes("Image generation")) isImageGeneration = true;
  const handleClickOnModel = async (e, prefix, modelId) => {
    let model = getModelFromMenu(e, prefix, modelId);
    await callback({ e, command, prompt, model, isConversationToContinue });
  };

  const handleKeyDownOnModel = (e, prefix, modelId) => {
    if (e.code === "Enter" || e.code === "Space") {
      handleClickOnModel(e, prefix, modelId);
      //  ContextMenu.hide();
    }
  };

  const handleContextMenu = (e, prefix, modelId) => {
    e.preventDefault();
    let model = getModelFromMenu(e, prefix, modelId);
    if (!isWebSearch) {
      console.log("default model :>> ", model);
      setDefaultModel(model);
      setModel(model);
    } else {
      extensionStorage.set("webModel", normalizeClaudeModel(model));
    }
    AppToaster.show({
      message: `Default AI model ${
        isWebSearch ? "for Web search" : ""
      } set to: ${model}`,
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
      case "gpt-5 (not reasoning)":
        model = "gpt-5-chat-latest";
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
    return model;
  };

  const openAiWebSearchModels = () => {
    return (
      <>
        <MenuItem
          icon={defaultModel === "gpt-5-search-api" && "pin"}
          onClick={(e) => {
            handleClickOnModel(e);
          }}
          onKeyDown={(e) => {
            handleKeyDownOnModel(e);
          }}
          onContextMenu={(e) => handleContextMenu(e)}
          tabindex="0"
          text="gpt-5-search-api"
          labelElement="128k"
        />
        <MenuItem
          icon={defaultModel === "gpt-4o-search" && "pin"}
          onClick={(e) => {
            handleClickOnModel(e);
          }}
          onKeyDown={(e) => {
            handleKeyDownOnModel(e);
          }}
          onContextMenu={(e) => handleContextMenu(e)}
          tabindex="0"
          text="gpt-4o-search"
          labelElement="128k"
        />
        <MenuItem
          icon={defaultModel === "gpt-4o-mini-search" && "pin"}
          onClick={(e) => {
            handleClickOnModel(e);
          }}
          onKeyDown={(e) => {
            handleKeyDownOnModel(e);
          }}
          onContextMenu={(e) => handleContextMenu(e)}
          tabindex="0"
          text="gpt-4o-mini-search"
          labelElement="128k"
        />
      </>
    );
  };

  const openAiImageModels = () => {
    return (
      <>
        {openaiLibrary?.apiKey && (
          <>
            <MenuItem
              onClick={(e) => {
                handleClickOnModel(e);
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              onContextMenu={(e) => handleContextMenu(e)}
              tabindex="0"
              text="gpt-image-1-mini"
            />
            <MenuItem
              onClick={(e) => {
                handleClickOnModel(e);
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              onContextMenu={(e) => handleContextMenu(e)}
              tabindex="0"
              text="gpt-image-1"
            />
          </>
        )}
        {googleLibrary?.apiKey && (
          <>
            {openaiLibrary?.apiKey && <MenuDivider />}
            <MenuItem
              onClick={(e) => {
                handleClickOnModel(e);
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              onContextMenu={(e) => handleContextMenu(e)}
              tabindex="0"
              text="gemini-2.5-flash-image"
              labelElement="nano 🍌"
            />
            <MenuItem
              onClick={(e) => {
                handleClickOnModel(e);
              }}
              onKeyDown={(e) => {
                handleKeyDownOnModel(e);
              }}
              onContextMenu={(e) => handleContextMenu(e)}
              tabindex="0"
              text="imagen-4.0-generate-001"
            />
          </>
        )}
      </>
    );
  };

  const customOpenAIModelsMenu = (withMenu = true) => {
    const customModelsMap = () => {
      return openAiCustomModels.map((model) => (
        <MenuItem
          icon={defaultModel === model && "pin"}
          onClick={(e) => {
            handleClickOnModel(
              e,
              customOpenAIOnly ? "" : "custom/",
              model.replace("custom/", "")
            );
          }}
          onKeyDown={(e) => {
            handleKeyDownOnModel(e);
          }}
          onContextMenu={(e) => handleContextMenu(e)}
          tabindex="0"
          text={model.replace("custom/", "")}
          labelElement={
            tokensLimit[model]
              ? (tokensLimit[model] / 1000).toFixed(0).toString() + "k"
              : null
          }
        />
      ));
    };

    return openAiCustomModels && openAiCustomModels.length ? (
      withMenu ? (
        <MenuItem tabindex="0" text="Custom models via OpenAI API">
          {customModelsMap()}
        </MenuItem>
      ) : (
        <>
          <MenuDivider title="Custom OpenAI compatible models" />
          {customModelsMap()}
        </>
      )
    ) : null;
  };

  if (isImageGeneration) return openAiImageModels();

  return (
    <Menu className="str-aimodels-menu" roleStructure={roleStructure}>
      {!isWebSearch && (
        <MenuDivider
          className="menu-hint"
          title="ℹ︎ Right click on model to set as default"
        />
      )}
      {
        openRouterOnly ? null : openaiLibrary?.apiKey ? (
          !isWebSearch ? (
            <>
              <MenuItem
                icon={defaultModel === "gpt-5-nano" && "pin"}
                onClick={(e) => {
                  handleClickOnModel(e);
                }}
                onKeyDown={(e) => {
                  handleKeyDownOnModel(e);
                }}
                onContextMenu={(e) => handleContextMenu(e)}
                tabindex="0"
                text="gpt-5-nano"
                labelElement="400k"
              />
              <MenuItem
                icon={defaultModel === "gpt-5-mini" && "pin"}
                onClick={(e) => {
                  handleClickOnModel(e);
                }}
                onKeyDown={(e) => {
                  handleKeyDownOnModel(e);
                }}
                onContextMenu={(e) => handleContextMenu(e)}
                tabindex="0"
                text="gpt-5-mini"
                labelElement="400k"
              />
              <MenuItem
                icon={defaultModel === "gpt-5" && "pin"}
                onClick={(e) => {
                  handleClickOnModel(e);
                }}
                onKeyDown={(e) => {
                  handleKeyDownOnModel(e);
                }}
                onContextMenu={(e) => handleContextMenu(e)}
                tabindex="0"
                text="gpt-5"
                labelElement="400k"
              />
              <MenuItem
                icon={defaultModel === "gpt-5-chat-latest" && "pin"}
                onClick={(e) => {
                  handleClickOnModel(e);
                }}
                onKeyDown={(e) => {
                  handleKeyDownOnModel(e);
                }}
                onContextMenu={(e) => handleContextMenu(e)}
                tabindex="0"
                text="gpt-5 (not reasoning)"
                labelElement="400k"
              />
              <MenuItem text="Web Search models">
                {openAiWebSearchModels()}
              </MenuItem>

              <MenuItem text="o3/o4 'reasoning' models">
                <MenuItem
                  icon={defaultModel === "o4-mini" && "pin"}
                  onClick={(e) => {
                    handleClickOnModel(e);
                  }}
                  onKeyDown={(e) => {
                    handleKeyDownOnModel(e);
                  }}
                  onContextMenu={(e) => handleContextMenu(e)}
                  tabindex="0"
                  text="o4-mini"
                  labelElement="200k"
                />
                <MenuItem
                  icon={defaultModel === "o3" && "pin"}
                  onClick={(e) => {
                    handleClickOnModel(e);
                  }}
                  onKeyDown={(e) => {
                    handleKeyDownOnModel(e);
                  }}
                  onContextMenu={(e) => handleContextMenu(e)}
                  tabindex="0"
                  text="o3"
                  labelElement="200k"
                />
                <MenuItem
                  icon={defaultModel === "o3-pro" && "pin"}
                  onClick={(e) => {
                    handleClickOnModel(e);
                  }}
                  onKeyDown={(e) => {
                    handleKeyDownOnModel(e);
                  }}
                  onContextMenu={(e) => handleContextMenu(e)}
                  tabindex="0"
                  text="o3-pro"
                  labelElement="200k"
                />
                <MenuDivider
                  className="menu-hint"
                  title={
                    <p>
                      ⚠️ Use with caution,
                      <br />
                      o3-pro is an expensive model
                      <br />
                      (o4-mini is almost 15x cheaper)
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
              <MenuItem text="gpt-4 models (legacy)">
                <MenuItem
                  icon={defaultModel === "gpt-4.1-nano" && "pin"}
                  onClick={(e) => {
                    handleClickOnModel(e);
                  }}
                  onKeyDown={(e) => {
                    handleKeyDownOnModel(e);
                  }}
                  onContextMenu={(e) => handleContextMenu(e)}
                  tabindex="0"
                  text="gpt-4.1-nano"
                  labelElement="1000k"
                />
                <MenuItem
                  icon={defaultModel === "gpt-4.1-mini" && "pin"}
                  onClick={(e) => {
                    handleClickOnModel(e);
                  }}
                  onKeyDown={(e) => {
                    handleKeyDownOnModel(e);
                  }}
                  onContextMenu={(e) => handleContextMenu(e)}
                  tabindex="0"
                  text="gpt-4.1-mini"
                  labelElement="1000k"
                />
                <MenuItem
                  icon={defaultModel === "gpt-4.1" && "pin"}
                  onClick={(e) => {
                    handleClickOnModel(e);
                  }}
                  onKeyDown={(e) => {
                    handleKeyDownOnModel(e);
                  }}
                  onContextMenu={(e) => handleContextMenu(e)}
                  tabindex="0"
                  text="gpt-4.1"
                  labelElement="1000k"
                />
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
              </MenuItem>
              {customOpenAIModelsMenu()}
            </>
          ) : (
            openAiWebSearchModels()
          )
        ) : (
          <>
            {customOpenAIModelsMenu(false)}
            <MenuDivider className="menu-hint" title="No OpenAI API key" />
          </>
        )
        // <MenuDivider />
      }
      {openRouterOnly ? null : anthropicLibrary ? (
        <>
          {openaiLibrary && <MenuDivider />}
          <MenuItem
            icon={defaultModel === "Claude Haiku 4.5" && "pin"}
            onClick={(e) => {
              handleClickOnModel(e);
            }}
            onKeyDown={(e) => {
              handleKeyDownOnModel(e);
            }}
            onContextMenu={(e) => handleContextMenu(e)}
            tabindex="0"
            text="Claude Haiku 4.5"
            labelElement="200k"
          />
          <MenuItem
            icon={defaultModel === "Claude Sonnet 4.5" && "pin"}
            onClick={(e) => {
              handleClickOnModel(e);
            }}
            onKeyDown={(e) => {
              handleKeyDownOnModel(e);
            }}
            onContextMenu={(e) => handleContextMenu(e)}
            tabindex="0"
            text="Claude Sonnet 4.5"
            labelElement="200k"
          />
          {!isWebSearch && (
            <>
              <MenuItem
                icon={defaultModel === "Claude Sonnet 4.5 Thinking" && "pin"}
                onClick={(e) => {
                  handleClickOnModel(e);
                }}
                onKeyDown={(e) => {
                  handleKeyDownOnModel(e);
                }}
                onContextMenu={(e) => handleContextMenu(e)}
                tabindex="0"
                text="Claude Sonnet 4.5 Thinking"
                labelElement="200k"
              />
              <MenuItem
                icon={defaultModel === "Claude Opus 4.1" && "pin"}
                onClick={(e) => {
                  handleClickOnModel(e);
                }}
                onKeyDown={(e) => {
                  handleKeyDownOnModel(e);
                }}
                onContextMenu={(e) => handleContextMenu(e)}
                tabindex="0"
                text="Claude Opus 4.1"
                labelElement="200k"
              />
              <MenuItem text="Claude older models">
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
                  icon={defaultModel === "Claude Sonnet 3.7" && "pin"}
                  onClick={(e) => {
                    handleClickOnModel(e);
                  }}
                  onKeyDown={(e) => {
                    handleKeyDownOnModel(e);
                  }}
                  onContextMenu={(e) => handleContextMenu(e)}
                  tabindex="0"
                  text="Claude Sonnet 3.7"
                  labelElement="200k"
                />
                <MenuItem
                  icon={defaultModel === "Claude Sonnet 4" && "pin"}
                  onClick={(e) => {
                    handleClickOnModel(e);
                  }}
                  onKeyDown={(e) => {
                    handleKeyDownOnModel(e);
                  }}
                  onContextMenu={(e) => handleContextMenu(e)}
                  tabindex="0"
                  text="Claude Sonnet 4"
                  labelElement="200k"
                />
              </MenuItem>
            </>
          )}
        </>
      ) : (
        <MenuDivider className="menu-hint" title="No Anthropic API key" />
      )}
      {openRouterOnly
        ? null
        : deepseekLibrary &&
          !isWebSearch && (
            <>
              {(openaiLibrary || anthropicLibrary) && <MenuDivider />}
              <MenuItem
                icon={defaultModel === "DeepSeek-V3.2" && "pin"}
                onClick={(e) => {
                  handleClickOnModel(e);
                }}
                onKeyDown={(e) => {
                  handleKeyDownOnModel(e);
                }}
                onContextMenu={(e) => handleContextMenu(e)}
                tabindex="0"
                text="DeepSeek-V3.2"
                labelElement="128k"
              />
              <MenuItem
                icon={defaultModel === "DeepSeek-V3.2 Thinking" && "pin"}
                onClick={(e) => {
                  handleClickOnModel(e);
                }}
                onKeyDown={(e) => {
                  handleKeyDownOnModel(e);
                }}
                onContextMenu={(e) => handleContextMenu(e)}
                tabindex="0"
                text="DeepSeek-V3.2 Thinking"
                labelElement="128k"
              />
            </>
          )}
      {openRouterOnly
        ? null
        : grokLibrary && (
            <>
              {(openaiLibrary || anthropicLibrary) && <MenuDivider />}
              <MenuItem
                icon={defaultModel === "Grok-3-mini" && "pin"}
                onClick={(e) => {
                  handleClickOnModel(e);
                }}
                onKeyDown={(e) => {
                  handleKeyDownOnModel(e);
                }}
                onContextMenu={(e) => handleContextMenu(e)}
                tabindex="0"
                text="Grok-3-mini"
                labelElement="128k"
              >
                <MenuItem
                  icon={defaultModel === "Grok-3-mini-fast" && "pin"}
                  onClick={(e) => {
                    handleClickOnModel(e);
                  }}
                  onKeyDown={(e) => {
                    handleKeyDownOnModel(e);
                  }}
                  onContextMenu={(e) => handleContextMenu(e)}
                  tabindex="0"
                  text="Grok-3-mini-fast"
                  labelElement="128k"
                />
                <MenuItem
                  icon={defaultModel === "Grok-3-mini-high" && "pin"}
                  onClick={(e) => {
                    handleClickOnModel(e);
                  }}
                  onKeyDown={(e) => {
                    handleKeyDownOnModel(e);
                  }}
                  onContextMenu={(e) => handleContextMenu(e)}
                  tabindex="0"
                  text="Grok-3-mini-high"
                  labelElement="128k"
                />
              </MenuItem>
              <MenuItem
                icon={defaultModel === "Grok-3" && "pin"}
                onClick={(e) => {
                  handleClickOnModel(e);
                }}
                onKeyDown={(e) => {
                  handleKeyDownOnModel(e);
                }}
                onContextMenu={(e) => handleContextMenu(e)}
                tabindex="0"
                text="Grok-3"
                labelElement="128k"
              >
                <MenuItem
                  icon={defaultModel === "Grok-3-fast" && "pin"}
                  onClick={(e) => {
                    handleClickOnModel(e);
                  }}
                  onKeyDown={(e) => {
                    handleKeyDownOnModel(e);
                  }}
                  onContextMenu={(e) => handleContextMenu(e)}
                  tabindex="0"
                  text="Grok-3-fast"
                  labelElement="128k"
                />
              </MenuItem>
              <MenuItem
                icon={defaultModel === "Grok-4" && "pin"}
                onClick={(e) => {
                  handleClickOnModel(e);
                }}
                onKeyDown={(e) => {
                  handleKeyDownOnModel(e);
                }}
                onContextMenu={(e) => handleContextMenu(e)}
                tabindex="0"
                text="Grok-4"
                labelElement="128k"
              />
              {!isWebSearch && (
                <MenuItem
                  icon={defaultModel === "Grok-2 Vision" && "pin"}
                  onClick={(e) => {
                    handleClickOnModel(e);
                  }}
                  onKeyDown={(e) => {
                    handleKeyDownOnModel(e);
                  }}
                  onContextMenu={(e) => handleContextMenu(e)}
                  tabindex="0"
                  text="Grok-2 Vision"
                  labelElement="32k"
                />
              )}
            </>
          )}
      {openRouterOnly ? null : googleLibrary ? (
        <>
          {(openaiLibrary || anthropicLibrary || deepseekLibrary) && (
            <MenuDivider />
          )}
          <MenuItem
            icon={defaultModel === "gemini-2.5-flash-lite" && "pin"}
            onClick={(e) => {
              handleClickOnModel(e);
            }}
            onKeyDown={(e) => {
              handleKeyDownOnModel(e);
            }}
            onContextMenu={(e) => handleContextMenu(e)}
            tabindex="0"
            text="gemini-2.5-flash-lite"
            labelElement="1000k"
          />
          <MenuItem
            icon={defaultModel === "gemini-2.5-flash" && "pin"}
            onClick={(e) => {
              handleClickOnModel(e);
            }}
            onKeyDown={(e) => {
              handleKeyDownOnModel(e);
            }}
            onContextMenu={(e) => handleContextMenu(e)}
            tabindex="0"
            text="gemini-2.5-flash"
            labelElement="1000k"
          />
          <MenuItem
            icon={defaultModel === "gemini-2.5-pro" && "pin"}
            onClick={(e) => {
              handleClickOnModel(e);
            }}
            onKeyDown={(e) => {
              handleKeyDownOnModel(e);
            }}
            onContextMenu={(e) => handleContextMenu(e)}
            tabindex="0"
            text="gemini-2.5-pro"
            labelElement="2000k"
          />
        </>
      ) : (
        <MenuDivider className="menu-hint" title="No Google API key" />
      )}
      {openRouterModels.length && !isWebSearch ? (
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
                    hoverOpenDelay={1500}
                    hoverCloseDelay={6000}
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
      {groqModels.length && !isWebSearch ? (
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
      {ollamaModels.length && !isWebSearch ? (
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
    </Menu>
  );
};

export default ModelsMenu;
