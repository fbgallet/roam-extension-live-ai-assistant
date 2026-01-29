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
import { tokensLimit } from "../ai/modelsInfo";
import { getWebSearchModels, getImageGenerationModels } from "../ai/modelRegistry";
import { AppToaster } from "./Toaster";
import {
  getModelConfig,
  getProviderModels,
  isModelVisible,
  isModelFavorited,
  getFavoriteModels,
  getModelMetadata,
  formatContextLength,
  getOrderedProviders,
  getModelCapabilities,
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
    // Always set as main default model (web search will use it automatically if it supports web search)
    console.log("default model :>> ", model);
    setDefaultModel(model);
    setModel(model);
    AppToaster.show({
      message: `Default AI model set to: ${model}${
        isWebSearch ? " (will be used for web search)" : ""
      }`,
      timeout: 5000,
    });
  };

  const getModelFromMenu = (e, prefix, modelId) => {
    // Use modelId when provided (registry models and custom models)
    // Fall back to innerText for legacy menu items without modelId
    let model = modelId || e.target.innerText.split("\n")[0];

    // Handle display name to API ID mapping for legacy items
    if (!modelId) {
      switch (model) {
        case "GPT 4o mini":
          model = "gpt-4o-mini";
          break;
        case "GPT 4o":
          model = "gpt-4o";
          break;
      }
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
    // Also exclude image generation models (they only appear in image generation submenu)
    const visibleModels = models.filter(
      (m) =>
        isModelVisible(m.id) &&
        !isModelFavorited(m.id) &&
        !getModelCapabilities(m.id).includes("image")
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

    // Only show visible favorites, excluding image generation models
    const visibleFavorites = favoriteModels.filter(
      (m) =>
        isModelVisible(m.id) && !getModelCapabilities(m.id).includes("image")
    );

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

  // Config is now auto-saved in the dialog, this callback is kept for compatibility
  const handleConfigSave = () => {};

  // Get all models that support web search (all providers)
  const openAiWebSearchModels = () => {
    const webSearchModels = getWebSearchModels(); // Get all models with capabilities.webSearch = true

    // Filter to only visible models (use model.name for visibility check, as that's what's stored in config)
    const visibleModels = webSearchModels.filter((m) => isModelVisible(m.name));

    // Group models by provider
    const modelsByProvider = {};
    visibleModels.forEach((model) => {
      if (!modelsByProvider[model.provider]) {
        modelsByProvider[model.provider] = [];
      }
      modelsByProvider[model.provider].push(model);
    });

    // Get ordered providers (respecting user's custom order)
    const orderedProviders = getOrderedProviders().filter(
      (p) => modelsByProvider[p] && modelsByProvider[p].length > 0
    );

    // Sort models within each provider according to user's custom order
    orderedProviders.forEach((provider) => {
      const providerModels = modelsByProvider[provider];

      // Get the full provider models list to access the custom order
      const allProviderModels = getProviderModels(provider);
      const providerModelIds = allProviderModels.map(m => m.id);

      // Sort according to the same order as in getProviderModels
      providerModels.sort((a, b) => {
        const indexA = providerModelIds.indexOf(a.name);
        const indexB = providerModelIds.indexOf(b.name);

        // If both found in the ordered list, use that order
        if (indexA !== -1 && indexB !== -1) {
          return indexA - indexB;
        }
        // If only one found, it comes first
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        // Otherwise sort alphabetically by name
        return a.name.localeCompare(b.name);
      });
    });

    return (
      <>
        {orderedProviders.map((provider) => (
          <React.Fragment key={provider}>
            <MenuDivider title={provider} />
            {modelsByProvider[provider].map((model) => (
              <MenuItem
                key={model.id}
                icon={currentDefaultModel === model.id && "pin"}
                onClick={(e) => handleClickOnModel(e, "", model.id)}
                onKeyDown={(e) => handleKeyDownOnModel(e, "", model.id)}
                onContextMenu={(e) => handleContextMenu(e, "", model.id)}
                tabIndex={0}
                text={model.name}
                labelElement={
                  <Tag minimal>
                    {formatContextLength(
                      // Web search is limited to 128k context
                      Math.min(model.contextLength || 128000, 128000)
                    )}
                  </Tag>
                }
              />
            ))}
          </React.Fragment>
        ))}
      </>
    );
  };

  const imageGenerationModelsSubmenu = () => {
    const imageModels = getImageGenerationModels();

    // Filter to only visible models (use model.name for visibility check)
    const visibleModels = imageModels.filter((m) => isModelVisible(m.name));

    // Group models by provider
    const modelsByProvider = {};
    visibleModels.forEach((model) => {
      if (!modelsByProvider[model.provider]) {
        modelsByProvider[model.provider] = [];
      }
      modelsByProvider[model.provider].push(model);
    });

    // Get ordered providers (respecting user's custom order)
    const orderedProviders = getOrderedProviders().filter(
      (p) => modelsByProvider[p] && modelsByProvider[p].length > 0
    );

    // Sort models within each provider according to user's custom order
    orderedProviders.forEach((provider) => {
      const providerModels = modelsByProvider[provider];

      // Get the full provider models list to access the custom order
      const allProviderModels = getProviderModels(provider);
      const providerModelIds = allProviderModels.map((m) => m.id);

      // Sort according to the same order as in getProviderModels
      providerModels.sort((a, b) => {
        const indexA = providerModelIds.indexOf(a.name);
        const indexB = providerModelIds.indexOf(b.name);

        // If both found in the ordered list, use that order
        if (indexA !== -1 && indexB !== -1) {
          return indexA - indexB;
        }
        // If only one found, it comes first
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        // Otherwise sort alphabetically by name
        return a.name.localeCompare(b.name);
      });
    });

    return (
      <>
        {orderedProviders.map((provider) => (
          <React.Fragment key={provider}>
            <MenuDivider title={provider} />
            {modelsByProvider[provider].map((model) => (
              <MenuItem
                key={model.id}
                icon={currentDefaultModel === model.id && "pin"}
                onClick={(e) => handleClickOnModel(e, "", model.id)}
                onKeyDown={(e) => handleKeyDownOnModel(e, "", model.id)}
                onContextMenu={(e) => handleContextMenu(e, "", model.id)}
                tabIndex={0}
                text={model.name}
              />
            ))}
          </React.Fragment>
        ))}
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

  if (isImageGeneration) return imageGenerationModelsSubmenu();
  if (isWebSearch) return openAiWebSearchModels();

  return (
    <Menu className="str-aimodels-menu" roleStructure={roleStructure}>
      {!isWebSearch && (
        <>
          {/* <MenuDivider
            icon="cog"
            className="menu-hint"
            title="ℹ︎ Right click on model to set as default"            
          /> */}

          <MenuItem
            icon="cog"
            text="Customize Menu & Models..."
            onClick={() =>
              displayModelConfigDialog({ onSave: handleConfigSave })
            }
            className="menu-hint"
            title="Or Right click on a model to set it as default"
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
