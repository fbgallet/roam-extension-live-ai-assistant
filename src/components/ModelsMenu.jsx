import React from "react";
import {
  Menu,
  MenuItem,
  MenuDivider,
  Tooltip,
  Divider,
  Tag,
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
import {
  getModelConfig,
  saveModelConfig,
  getProviderModels,
  isModelVisible,
  isModelFavorited,
  getFavoriteModels,
  getModelMetadata,
  formatContextLength,
  getOrderedProviders,
} from "../utils/modelConfigHelpers";
import { displayModelConfigDialog } from "../utils/domElts";

const ModelsMenu = ({
  callback,
  command,
  prompt,
  setModel,
  roleStructure = "menuitem",
  isConversationToContinue,
}) => {
  const modelConfig = getModelConfig();
  // Read defaultModel from storage to get the current value (not stale import)
  const currentDefaultModel =
    extensionStorage.get("defaultModel") || defaultModel;

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
    }
    if (prefix === "openRouter/") {
      model = modelId;
    }
    if (prefix) model = prefix + model;
    return model;
  };

  // Helper to get provider prefix for model ID
  const getPrefix = (provider) => {
    switch (provider) {
      case "OpenRouter":
        return "openRouter/";
      case "Groq":
        return "groq/";
      case "Ollama":
        return "ollama/";
      default:
        return "";
    }
  };

  // Render individual model menu item
  const renderModelItem = (modelId, modelName, provider = "") => {
    const prefix = getPrefix(provider);
    const metadata = getModelMetadata(modelId);

    return (
      <MenuItem
        key={modelId}
        icon={currentDefaultModel === prefix + modelId && "pin"}
        onClick={(e) => handleClickOnModel(e, prefix, modelId)}
        onKeyDown={(e) => handleKeyDownOnModel(e, prefix, modelId)}
        onContextMenu={(e) => handleContextMenu(e, prefix, modelId)}
        tabIndex="0"
        text={modelName}
        labelElement={
          metadata?.contextLength ? (
            <Tag minimal>{formatContextLength(metadata.contextLength)}</Tag>
          ) : null
        }
      />
    );
  };

  // Get API library for a provider
  const getApiLibrary = (provider) => {
    switch (provider) {
      case "OpenAI":
        return openaiLibrary;
      case "Anthropic":
        return anthropicLibrary;
      case "Google":
        return googleLibrary;
      case "DeepSeek":
        return deepseekLibrary;
      case "Grok":
        return grokLibrary;
      case "OpenRouter":
        return { apiKey: openRouterModels.length > 0 };
      case "Groq":
        return { apiKey: groqModels.length > 0 };
      case "Ollama":
        return { apiKey: ollamaModels.length > 0 };
      default:
        return null;
    }
  };

  // Render models for a provider
  const renderProviderModels = (provider, apiLibrary) => {
    // Check API key (except for dynamic providers)
    if (
      !apiLibrary?.apiKey &&
      !["OpenRouter", "Groq", "Ollama"].includes(provider)
    ) {
      return (
        <MenuDivider className="menu-hint" title={`No ${provider} API key`} />
      );
    }

    // Get models for this provider
    const models = getProviderModels(provider);

    // Filter by visibility AND exclude favorited models (they appear in favorites section)
    const visibleModels = models.filter(
      (m) => isModelVisible(m.id) && !isModelFavorited(m.id)
    );

    if (visibleModels.length === 0) return null;

    return (
      <>
        <MenuDivider title={provider} />
        {visibleModels.map((model) =>
          renderModelItem(model.id, model.name, provider)
        )}
      </>
    );
  };

  // Render favorites section
  const renderFavorites = () => {
    const favorites = getFavoriteModels();
    if (favorites.length === 0) return null;

    // Get full model info for each favorite
    const allProviders = [
      "OpenAI",
      "Anthropic",
      "Google",
      "DeepSeek",
      "Grok",
      "OpenRouter",
      "Groq",
      "Ollama",
    ];
    const favoriteModels = favorites
      .map((modelId) => {
        for (const provider of allProviders) {
          const providerModels = getProviderModels(provider);
          const model = providerModels.find((m) => m.id === modelId);
          if (model) return { ...model, provider };
        }
        return null;
      })
      .filter(Boolean);

    // Only show visible favorites
    const visibleFavorites = favoriteModels.filter((m) => isModelVisible(m.id));

    if (visibleFavorites.length === 0) return null;

    return (
      <>
        <MenuDivider title="⭐ Favorites" />
        {visibleFavorites.map((model) =>
          renderModelItem(model.id, model.name, model.provider)
        )}
        <MenuDivider />
      </>
    );
  };

  const handleConfigSave = async (newConfig) => {
    await saveModelConfig(newConfig);
    // Force re-render by triggering parent update if needed
    AppToaster.show({
      message: "Model configuration saved! Refresh to see changes.",
      intent: "success",
      timeout: 3000,
    });
  };

  const openAiWebSearchModels = () => {
    return (
      <>
        <MenuItem
          icon={currentDefaultModel === "gpt-5-search-api" && "pin"}
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
          icon={currentDefaultModel === "gpt-4o-search" && "pin"}
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
          icon={currentDefaultModel === "gpt-4o-mini-search" && "pin"}
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
              text="gemini-3-pro-image-preview"
              labelElement="nano 🍌 pro"
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
          icon={currentDefaultModel === model && "pin"}
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
  if (isWebSearch) return openAiWebSearchModels();

  return (
    <Menu className="str-aimodels-menu" roleStructure={roleStructure}>
      {!isWebSearch && (
        <>
          <MenuDivider
            icon="cog"
            className="menu-hint"
            title="ℹ︎ Right click on model to set as default"
            onClick={() => console.log("Coucou")}
          />
          <MenuItem
            icon="cog"
            text="Customize Models..."
            onClick={() =>
              displayModelConfigDialog({ onSave: handleConfigSave })
            }
          />
        </>
      )}

      {/* Favorites Section */}
      {renderFavorites()}

      {/* Provider Sections - Ordered by user preference */}
      {getOrderedProviders()
        .filter((provider) =>
          openRouterOnly ? provider === "OpenRouter" : true
        )
        .map((provider) =>
          renderProviderModels(provider, getApiLibrary(provider))
        )}
    </Menu>
  );
};

export default ModelsMenu;
