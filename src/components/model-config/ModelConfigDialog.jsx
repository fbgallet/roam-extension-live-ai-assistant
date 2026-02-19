import React, { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  Classes,
  Button,
  InputGroup,
  Tabs,
  Tab,
  Collapse,
  Tag,
  Icon,
  Tooltip,
} from "@blueprintjs/core";
import ModelCard from "./ModelCard";
import CustomModelForm from "./CustomModelForm";
import OpenRouterBrowser from "./OpenRouterBrowser";
import ProviderEndpointConfig from "./ProviderEndpointConfig";
import { TokensUsageContent } from "../TokensDisplay";
import { AppToaster } from "../Toaster";
import {
  extensionStorage,
  setDefaultModel,
  updateAvailableModels,
  OPENAI_API_KEY,
  ANTHROPIC_API_KEY,
  GOOGLE_API_KEY,
  DEEPSEEK_API_KEY,
  GROK_API_KEY,
  OPENROUTER_API_KEY,
  GROQ_API_KEY,
} from "../..";
import {
  getModelConfig,
  saveModelConfig,
  isModelVisible,
  isModelFavorited,
  getAllProviders,
  getCustomProviders,
  getDefaultOrder,
  getModelMetadata,
  formatContextLength,
  getOrderedProviders,
  isModelNew,
  clearNewModelBadges,
  getProviderLabel,
  supportsCustomEndpoint,
  isCustomModel,
  isImageGenModel,
} from "../../utils/modelConfigHelpers";
import { getAvailableModels } from "../../ai/modelsInfo";
import { getModelsByProvider, MODEL_REGISTRY, unregisterOpenRouterModel } from "../../ai/modelRegistry";
import "./ModelConfigDialog.css";

/**
 * ModelConfigDialog - Main configuration dialog for customizing model menu
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether dialog is open
 * @param {Function} props.onClose - Callback when dialog is closed
 * @param {Function} props.onSave - Callback when configuration is saved
 * @param {string} props.initialTab - Optional initial tab to display ("visibility", "custom", "usage-tokens")
 */
export const ModelConfigDialog = ({
  isOpen,
  onClose,
  onSave,
  initialTab = "visibility",
}) => {
  const [workingConfig, setWorkingConfig] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState(initialTab);
  const [expandedProviders, setExpandedProviders] = useState(new Set()); // Start with all collapsed
  const [draggedModel, setDraggedModel] = useState(null);
  const [draggedProvider, setDraggedProvider] = useState(null);
  const [showAddForm, setShowAddForm] = useState({}); // { provider: boolean } - tracks which provider forms are visible
  const [draggedCustomModel, setDraggedCustomModel] = useState(null); // For custom models drag-drop
  const [isDraggingOverDefault, setIsDraggingOverDefault] = useState(false); // For default model drop zone
  const [isDraggingOverWebSearch, setIsDraggingOverWebSearch] = useState(false); // For web search model drop zone
  const [isDraggingOverImageGen, setIsDraggingOverImageGen] = useState(false); // For image gen model drop zone

  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Load config when dialog opens
  useEffect(() => {
    if (isOpen) {
      setIsInitialLoad(true);
      const config = getModelConfig();
      const configCopy = JSON.parse(JSON.stringify(config)); // Deep copy

      // Initialize defaultModel from extensionStorage if not in config
      if (!configCopy.defaultModel) {
        const storedDefault = extensionStorage.get("defaultModel");
        if (storedDefault) {
          configCopy.defaultModel = storedDefault;
        }
      }

      setWorkingConfig(configCopy);
      setSearchQuery("");

      // Clear NEW badges after 3 seconds of viewing
      const timer = setTimeout(() => {
        clearNewModelBadges();
      }, 3000);

      // Mark initial load as complete after config is set
      const initTimer = setTimeout(() => {
        setIsInitialLoad(false);
      }, 100);

      return () => {
        clearTimeout(timer);
        clearTimeout(initTimer);
      };
    }
  }, [isOpen]);

  // Auto-save config whenever it changes (skip initial load)
  useEffect(() => {
    if (!isOpen || isInitialLoad || !workingConfig) return;

    const saveConfig = async () => {
      try {
        await saveModelConfig(workingConfig);
        // Sync defaultModel to extensionStorage
        if (workingConfig.defaultModel) {
          setDefaultModel(workingConfig.defaultModel);
        }
      } catch (error) {
        console.error("Failed to auto-save model config:", error);
        AppToaster.show({
          message: "Failed to save configuration",
          intent: "danger",
          timeout: 2000,
        });
      }
    };

    saveConfig();
  }, [workingConfig, isOpen, isInitialLoad]);

  /**
   * Get provider models from working config (includes unsaved custom models)
   * This is similar to getProviderModels() but uses workingConfig instead of saved config
   *
   * IMPORTANT: This returns ALL models regardless of visibleByDefault setting.
   * The visibleByDefault property only affects the initial visibility state in hiddenModels,
   * not whether the model appears in this configuration dialog.
   */
  const getProviderModelsFromWorkingConfig = (provider) => {
    // Get ALL base models from MODEL_REGISTRY, regardless of visibleByDefault
    // getModelsByProvider returns all models for the provider (not filtered by visibleByDefault)
    const registryModels = getModelsByProvider(provider);

    // Get custom models for this provider from working config
    const providerKey = provider.toLowerCase();
    const customModels = workingConfig?.customModels?.[providerKey] || [];

    // Convert registry models to objects
    // For native providers, .name is used as canonical ID throughout the app (stored in hiddenModels, etc.)
    // For dynamic providers (OpenRouter, Groq, Ollama), .id (raw API id) is used as canonical ID
    // In both cases, the display name (.name from registry) is preserved for UI display
    const isDynamicProvider = ["OpenRouter", "Groq", "Ollama"].includes(provider);
    const baseModels = registryModels.map((m) => {
      const canonicalId = isDynamicProvider ? m.id : m.name;
      return {
        id: canonicalId,
        name: m.name || canonicalId,
        contextLength: getModelMetadata(canonicalId).contextLength,
        pricing: getModelMetadata(canonicalId).pricing,
      };
    });

    // Filter out custom models that are already in base models (to prevent duplicates)
    // Check against both the canonical id AND the raw registry .id to catch all naming variants
    const baseModelIdsSet = new Set(baseModels.map(m => m.id));
    const baseModelRawIds = new Set(registryModels.map((m) => m.id));
    const uniqueCustomModels = customModels.filter(
      (m) => !baseModelIdsSet.has(m.id) && !baseModelRawIds.has(m.id)
    );

    // Combine base and custom models
    const allModels = [...baseModels, ...uniqueCustomModels];

    // Separate remote models from regular models
    const remoteModels = [];
    const regularModels = [];

    allModels.forEach((model) => {
      // Check if model is remote by looking in MODEL_REGISTRY
      const registryKey = Object.keys(MODEL_REGISTRY).find(
        (key) =>
          MODEL_REGISTRY[key].id === model.id ||
          MODEL_REGISTRY[key].name === model.id
      );
      if (registryKey && MODEL_REGISTRY[registryKey]?.isRemote) {
        remoteModels.push(model);
      } else {
        regularModels.push(model);
      }
    });

    // Apply custom ordering if defined
    const order = workingConfig?.modelOrder?.[provider];
    if (order && Array.isArray(order)) {
      const ordered = [];
      const unordered = [];

      // Put remote models first, then ordered, then unordered
      const allSorted = [...remoteModels, ...regularModels];
      allSorted.forEach((model) => {
        const index = order.indexOf(model.id);
        if (index !== -1) {
          ordered[index] = model;
        } else {
          unordered.push(model);
        }
      });

      return ordered.filter(Boolean).concat(unordered);
    }

    // Return remote models first, then regular models
    return [...remoteModels, ...regularModels];
  };

  // Check if a model is loaded from remote updates
  const isRemoteModel = (modelId) => {
    const registryKey = Object.keys(MODEL_REGISTRY).find(
      (key) =>
        MODEL_REGISTRY[key].id === modelId ||
        MODEL_REGISTRY[key].name === modelId
    );
    return registryKey && MODEL_REGISTRY[registryKey]?.isRemote === true;
  };

  if (!workingConfig) {
    return null;
  }

  const handleToggleProvider = (provider) => {
    const newExpanded = new Set(expandedProviders);
    if (newExpanded.has(provider)) {
      newExpanded.delete(provider);
    } else {
      newExpanded.add(provider);
    }
    setExpandedProviders(newExpanded);
  };

  const handleToggleVisibility = (modelId, isVisible) => {
    const newHiddenModels = [...(workingConfig.hiddenModels || [])];

    if (isVisible) {
      // Remove from hidden list
      const index = newHiddenModels.indexOf(modelId);
      if (index > -1) {
        newHiddenModels.splice(index, 1);
      }
    } else {
      // Add to hidden list
      if (!newHiddenModels.includes(modelId)) {
        newHiddenModels.push(modelId);
      }
    }

    setWorkingConfig({
      ...workingConfig,
      hiddenModels: newHiddenModels,
    });
  };

  const handleToggleFavorite = (modelId) => {
    const newFavorites = [...(workingConfig.favoriteModels || [])];
    const index = newFavorites.indexOf(modelId);

    if (index > -1) {
      newFavorites.splice(index, 1);
    } else {
      newFavorites.push(modelId);
    }

    setWorkingConfig({
      ...workingConfig,
      favoriteModels: newFavorites,
    });
  };

  const handleDragStart = (e, modelId, provider) => {
    const isImageGen = isImageGenModel(modelId);
    setDraggedModel({ id: modelId, provider, isImageGen });
  };

  const handleDrop = (e, targetModelId, provider) => {
    if (!draggedModel || draggedModel.provider !== provider) {
      // Can't drag across providers
      AppToaster.show({
        message: "Cannot reorder models across different providers",
        intent: "warning",
        timeout: 2000,
      });
      return;
    }

    const sourceId = draggedModel.id;
    const targetId = targetModelId;

    if (sourceId === targetId) return;

    // Get current order or create default
    const currentOrder =
      workingConfig.modelOrder?.[provider] || getDefaultOrder(provider);
    const newOrder = [...currentOrder];

    const sourceIndex = newOrder.indexOf(sourceId);
    const targetIndex = newOrder.indexOf(targetId);

    if (sourceIndex === -1 || targetIndex === -1) return;

    // Reorder: remove source and insert before target
    newOrder.splice(sourceIndex, 1);
    const newTargetIndex = newOrder.indexOf(targetId);
    newOrder.splice(newTargetIndex, 0, sourceId);

    setWorkingConfig({
      ...workingConfig,
      modelOrder: {
        ...(workingConfig.modelOrder || {}),
        [provider]: newOrder,
      },
    });
  };

  const handleDragEnd = () => {
    setDraggedModel(null);
    setDraggedProvider(null);
  };

  const handleProviderDragStart = (e, provider) => {
    setDraggedProvider(provider);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleProviderDrop = (e, targetProvider) => {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");

    if (!draggedProvider || draggedProvider === targetProvider) return;

    const providers = getAllProviders();
    const currentOrder = workingConfig.providerOrder || providers;
    const newOrder = [...currentOrder];

    const sourceIndex = newOrder.indexOf(draggedProvider);
    const targetIndex = newOrder.indexOf(targetProvider);

    if (sourceIndex === -1 || targetIndex === -1) return;

    // Reorder: remove source and insert before target
    newOrder.splice(sourceIndex, 1);
    const newTargetIndex = newOrder.indexOf(targetProvider);
    newOrder.splice(newTargetIndex, 0, draggedProvider);

    setWorkingConfig({
      ...workingConfig,
      providerOrder: newOrder,
    });
  };

  const handleProviderDragEnter = (e) => {
    e.preventDefault();
    e.currentTarget.classList.add("drag-over");
  };

  const handleProviderDragLeave = (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");
  };

  const handleAddCustomModel = (provider, model) => {
    const customModels = { ...(workingConfig.customModels || {}) };
    const providerModels = [...(customModels[provider] || [])];
    providerModels.push(model);
    customModels[provider] = providerModels;

    setWorkingConfig({
      ...workingConfig,
      customModels,
    });

    // Hide the form after adding
    // Check if this is a native provider (added via native-apis section)
    const nativeProviders = [
      "openai",
      "anthropic",
      "google",
      "deepseek",
      "grok",
    ];
    const formKey = nativeProviders.includes(provider)
      ? "native-apis"
      : provider;
    setShowAddForm({ ...showAddForm, [formKey]: false });

    AppToaster.show({
      message: `Added "${model.name}" to ${provider} models`,
      intent: "success",
      timeout: 2000,
    });
  };

  const handleDeleteCustomModel = (provider, modelId) => {
    const customModels = { ...(workingConfig.customModels || {}) };
    const providerModels = (customModels[provider] || []).filter(
      (m) => m.id !== modelId
    );
    customModels[provider] = providerModels;

    // For OpenRouter models, also remove from MODEL_REGISTRY so they disappear
    // from the Visibility tab and menu immediately (they are registered there
    // when an API key is set via registerOpenRouterModels).
    if (provider === "openrouter") {
      unregisterOpenRouterModel(modelId);
    }

    setWorkingConfig({
      ...workingConfig,
      customModels,
    });

    AppToaster.show({
      message: `Removed model from ${provider}`,
      intent: "success",
      timeout: 2000,
    });
  };

  // Drag-drop handlers for custom models
  const handleCustomModelDragStart = (e, provider, modelId) => {
    setDraggedCustomModel({ provider, modelId });
    e.dataTransfer.effectAllowed = "move";
  };

  const handleCustomModelDrop = (e, provider, targetModelId) => {
    e.preventDefault();

    if (!draggedCustomModel || draggedCustomModel.provider !== provider) {
      setDraggedCustomModel(null);
      return;
    }

    const sourceId = draggedCustomModel.modelId;
    if (sourceId === targetModelId) {
      setDraggedCustomModel(null);
      return;
    }

    // Reorder custom models for this provider
    const customModels = { ...(workingConfig.customModels || {}) };
    const providerModels = [...(customModels[provider] || [])];

    const sourceIndex = providerModels.findIndex((m) => m.id === sourceId);
    const targetIndex = providerModels.findIndex((m) => m.id === targetModelId);

    if (sourceIndex === -1 || targetIndex === -1) {
      setDraggedCustomModel(null);
      return;
    }

    // Remove source and insert before target
    const [movedModel] = providerModels.splice(sourceIndex, 1);
    const newTargetIndex = providerModels.findIndex(
      (m) => m.id === targetModelId
    );
    providerModels.splice(newTargetIndex, 0, movedModel);

    customModels[provider] = providerModels;

    setWorkingConfig({
      ...workingConfig,
      customModels,
    });

    setDraggedCustomModel(null);
  };

  const handleSetDefaultModel = (modelId) => {
    setWorkingConfig({
      ...workingConfig,
      defaultModel: modelId,
    });
  };

  const handleSetDefaultWebSearchModel = (modelId) => {
    setWorkingConfig({
      ...workingConfig,
      defaultWebSearchModel: modelId,
    });
  };

  const handleSetDefaultImageModel = (modelId) => {
    setWorkingConfig({
      ...workingConfig,
      defaultImageModel: modelId,
    });
  };

  const handleDefaultModelDrop = (e) => {
    e.preventDefault();
    setIsDraggingOverDefault(false);

    if (!draggedModel) return;

    // Prevent image gen models from being set as default chat model
    if (draggedModel.isImageGen) {
      AppToaster.show({
        message:
          "Image generation models can only be set as default for Image Gen",
        intent: "warning",
        timeout: 3000,
      });
      return;
    }

    const prefix = getPrefix(draggedModel.provider);
    const modelId = prefix + draggedModel.id;

    handleSetDefaultModel(modelId);
  };

  const handleWebSearchModelDrop = (e) => {
    e.preventDefault();
    setIsDraggingOverWebSearch(false);

    if (!draggedModel) return;

    // Prevent image gen models from being set as web search model
    if (draggedModel.isImageGen) {
      AppToaster.show({
        message:
          "Image generation models can only be set as default for Image Gen",
        intent: "warning",
        timeout: 3000,
      });
      return;
    }

    const prefix = getPrefix(draggedModel.provider);
    const modelId = prefix + draggedModel.id;

    handleSetDefaultWebSearchModel(modelId);
  };

  const handleImageGenModelDrop = (e) => {
    e.preventDefault();
    setIsDraggingOverImageGen(false);

    if (!draggedModel) return;

    // Only allow image gen models to be set as default image gen model
    if (!draggedModel.isImageGen) {
      AppToaster.show({
        message:
          "Only image generation models can be set as default for Image Gen",
        intent: "warning",
        timeout: 3000,
      });
      return;
    }

    const prefix = getPrefix(draggedModel.provider);
    const modelId = prefix + draggedModel.id;

    handleSetDefaultImageModel(modelId);
  };

  const handleEndpointChange = (provider, endpoint) => {
    const providerEndpoints = {
      ...(workingConfig.providerEndpoints || {}),
      [provider]: endpoint,
    };

    setWorkingConfig({
      ...workingConfig,
      providerEndpoints,
    });
  };

  const handleResetCustomModels = () => {
    if (
      window.confirm(
        "Delete all custom models? This cannot be undone. Provider endpoints and model visibility settings will be preserved."
      )
    ) {
      // Unregister all custom OpenRouter models from the registry
      (workingConfig.customModels?.openrouter || []).forEach((m) =>
        unregisterOpenRouterModel(m.id)
      );

      setWorkingConfig({
        ...workingConfig,
        customModels: {
          openai: [],
          anthropic: [],
          google: [],
          deepseek: [],
          grok: [],
          openrouter: [],
          groq: [],
          ollama: [],
        },
      });

      AppToaster.show({
        message: "All custom models deleted",
        intent: "success",
        timeout: 2000,
      });
    }
  };

  const handleReset = () => {
    if (
      window.confirm(
        "Reset model visibility, favorites, and ordering to defaults? Custom models and endpoints will be preserved."
      )
    ) {
      // Build hiddenModels list from models with visibleByDefault: false
      const defaultHiddenModels = Object.values(MODEL_REGISTRY)
        .filter((m) => m.visibleByDefault === false)
        .map((m) => m.name);

      setWorkingConfig({
        hiddenModels: defaultHiddenModels,
        favoriteModels: [],
        defaultModel: null,
        modelOrder: null,
        providerOrder: null,
        // Preserve custom models - they are user additions, not preferences
        customModels: workingConfig.customModels || {
          openai: [],
          anthropic: [],
          google: [],
          deepseek: [],
          grok: [],
          openrouter: [],
          groq: [],
          ollama: [],
        },
        // Preserve endpoint configurations
        providerEndpoints: workingConfig.providerEndpoints || {
          openai: { baseURL: "", enabled: false },
          ollama: { baseURL: "http://localhost:11434", enabled: false },
        },
        modelOptions: {},
        newModels: [],
        lastSeenVersion: workingConfig.lastSeenVersion || "0.0.0",
        version: 2,
      });

      AppToaster.show({
        message: "Configuration reset to defaults",
        intent: "success",
        timeout: 2000,
      });
    }
  };

  const handleClose = () => {
    // Update availableModels to reflect any changes made during the session
    updateAvailableModels();

    if (onSave) {
      onSave(workingConfig);
    }
    onClose();
  };

  // Toggle all models for a provider
  const handleToggleAllProvider = (provider, makeVisible) => {
    const models = getProviderModelsFromWorkingConfig(provider);
    const newHiddenModels = [...(workingConfig.hiddenModels || [])];

    models.forEach((model) => {
      const index = newHiddenModels.indexOf(model.id);
      if (makeVisible && index > -1) {
        // Remove from hidden list (make visible)
        newHiddenModels.splice(index, 1);
      } else if (!makeVisible && index === -1) {
        // Add to hidden list (make hidden)
        newHiddenModels.push(model.id);
      }
    });

    setWorkingConfig({
      ...workingConfig,
      hiddenModels: newHiddenModels,
    });
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

  // Render provider section for visibility tab
  const renderProviderSection = (provider) => {
    const models = getProviderModelsFromWorkingConfig(provider);
    // Auto-expand if searching
    const isExpanded = searchQuery ? true : expandedProviders.has(provider);

    // Check if provider has API key
    const customProviders = ["OpenRouter", "Groq", "Ollama"];
    const isCustomProvider = customProviders.includes(provider);

    // Check for actual API keys for each provider
    let hasApiKey = false;
    switch (provider) {
      case "OpenAI":
        hasApiKey = !!OPENAI_API_KEY;
        break;
      case "Anthropic":
        hasApiKey = !!ANTHROPIC_API_KEY;
        break;
      case "Google":
        hasApiKey = !!GOOGLE_API_KEY;
        break;
      case "DeepSeek":
        hasApiKey = !!DEEPSEEK_API_KEY;
        break;
      case "Grok":
        hasApiKey = !!GROK_API_KEY;
        break;
      case "OpenRouter":
        hasApiKey = !!OPENROUTER_API_KEY || models.length > 0;
        break;
      case "Groq":
        hasApiKey = !!GROQ_API_KEY || models.length > 0;
        break;
      case "Ollama":
        hasApiKey = models.length > 0;
        break;
      default:
        hasApiKey = false;
    }

    // Apply search filter (KEEP image generation models now)
    const filteredModels = searchQuery
      ? models.filter(
          (m) =>
            m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.id.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : models;

    // Separate regular models from image gen models
    const regularModels = filteredModels.filter((m) => !isImageGenModel(m.id));
    const imageGenModels = filteredModels.filter((m) => isImageGenModel(m.id));

    // Hide providers with 0 models (unless searching)
    if (filteredModels.length === 0) {
      return null;
    }

    const visibleCount = filteredModels.filter(
      (m) => !workingConfig.hiddenModels?.includes(m.id)
    ).length;

    const allVisible = visibleCount === filteredModels.length;
    const noneVisible = visibleCount === 0;
    const allHidden = noneVisible && filteredModels.length > 0;

    return (
      <div
        key={provider}
        className={`provider-section ${
          isCustomProvider ? "custom-provider" : ""
        } ${draggedProvider === provider ? "dragging" : ""} ${
          allHidden ? "all-hidden" : ""
        } ${!hasApiKey ? "no-api-key" : ""}`}
        draggable={true}
        onDragStart={(e) => handleProviderDragStart(e, provider)}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDragEnter={handleProviderDragEnter}
        onDragLeave={handleProviderDragLeave}
        onDrop={(e) => handleProviderDrop(e, provider)}
        onDragEnd={handleDragEnd}
      >
        <div className="provider-section-header">
          <span className="drag-handle">⋮⋮</span>
          <h4
            onClick={() => handleToggleProvider(provider)}
            style={{ flex: 1, cursor: "pointer" }}
          >
            {isExpanded ? "▼" : "▶"} {provider}
            {isCustomProvider && <span className="custom-badge">Custom</span>}
            {!hasApiKey && (
              <span className="no-api-key-indicator"> (No API key)</span>
            )}
          </h4>
          <span className="provider-badge">
            {visibleCount}/{filteredModels.length} visible
          </span>
          {!allVisible && (
            <Button
              icon="eye-open"
              minimal
              small
              onClick={(e) => {
                e.stopPropagation();
                handleToggleAllProvider(provider, true);
              }}
              title="Show all models"
            />
          )}
          {!noneVisible && (
            <Button
              icon="eye-off"
              minimal
              small
              onClick={(e) => {
                e.stopPropagation();
                handleToggleAllProvider(provider, false);
              }}
              title="Hide all models"
            />
          )}
        </div>

        <Collapse isOpen={isExpanded}>
          <div style={{ padding: "8px 0" }}>
            {/* Regular models section */}
            {regularModels.map((model) => {
              const metadata = getModelMetadata(model.id);
              const isCustom = isCustomModel(model.id, provider);
              const modelWithMetadata = {
                ...model,
                contextLength: metadata.contextLength,
                pricing: metadata.pricing,
              };

              return (
                <ModelCard
                  key={model.id}
                  model={modelWithMetadata}
                  isVisible={!workingConfig.hiddenModels?.includes(model.id)}
                  isFavorite={workingConfig.favoriteModels?.includes(model.id)}
                  isDraggable={true}
                  isNew={isModelNew(model.id)}
                  isCustom={isCustom}
                  isRemote={isRemoteModel(model.id)}
                  onToggleVisibility={handleToggleVisibility}
                  onToggleFavorite={handleToggleFavorite}
                  onDragStart={(e, modelId) =>
                    handleDragStart(e, modelId, provider)
                  }
                  onDrop={(e, modelId) => handleDrop(e, modelId, provider)}
                  onDragEnd={handleDragEnd}
                />
              );
            })}

            {/* Image generation models section - visually separated */}
            {imageGenModels.length > 0 && (
              <div className="image-gen-models-section">
                <div className="image-gen-section-header">
                  <Icon icon="media" size={12} style={{ marginRight: "6px" }} />
                  <span className="image-gen-section-title">
                    Image Generation Models
                  </span>
                  <Tooltip
                    content="These models only appear in the Image Generation submenu, not in the main model menu"
                    position="top"
                  >
                    <Icon
                      icon="info-sign"
                      size={12}
                      style={{ marginLeft: "6px", color: "#5c7080" }}
                    />
                  </Tooltip>
                </div>
                {imageGenModels.map((model) => {
                  const metadata = getModelMetadata(model.id);
                  const isCustom = isCustomModel(model.id, provider);
                  const modelWithMetadata = {
                    ...model,
                    contextLength: metadata.contextLength,
                    pricing: metadata.pricing,
                  };

                  return (
                    <ModelCard
                      key={model.id}
                      model={modelWithMetadata}
                      isVisible={
                        !workingConfig.hiddenModels?.includes(model.id)
                      }
                      isFavorite={workingConfig.favoriteModels?.includes(
                        model.id
                      )}
                      isDraggable={true}
                      isNew={isModelNew(model.id)}
                      isCustom={isCustom}
                      isRemote={isRemoteModel(model.id)}
                      isImageGen={true}
                      onToggleVisibility={handleToggleVisibility}
                      onToggleFavorite={handleToggleFavorite}
                      onDragStart={(e, modelId) =>
                        handleDragStart(e, modelId, provider)
                      }
                      onDrop={(e, modelId) => handleDrop(e, modelId, provider)}
                      onDragEnd={handleDragEnd}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </Collapse>
      </div>
    );
  };

  // Helper to get initial default image model
  const getInitialDefaultImageModel = () => {
    const availableModels = getAvailableModels();
    // Check if Google API is available (has Gemini models)
    const hasGoogle = availableModels.some((m) =>
      m.toLowerCase().includes("gemini")
    );

    if (hasGoogle) {
      return "gemini-3-pro-image-preview"; // Nano banana pro
    }

    // Check if OpenAI API is available
    const hasOpenAI = availableModels.some((m) =>
      m.toLowerCase().includes("gpt")
    );
    if (hasOpenAI) {
      return "gpt-image-1-mini";
    }

    return null;
  };

  // Render default model section
  const renderDefaultModelSection = () => {
    const currentDefault = workingConfig.defaultModel;

    // Find the model details
    let defaultModelInfo = null;
    if (currentDefault) {
      const allProviders = getAllProviders();
      for (const provider of allProviders) {
        const providerModels = getProviderModelsFromWorkingConfig(provider);
        const prefix = getPrefix(provider);
        const modelId = currentDefault.replace(prefix, "");
        const model = providerModels.find(
          (m) => m.id === modelId || prefix + m.id === currentDefault
        );
        if (model) {
          const metadata = getModelMetadata(model.id);
          defaultModelInfo = {
            ...model,
            provider,
            fullId: currentDefault,
            contextLength: metadata.contextLength,
            pricing: metadata.pricing,
          };
          break;
        }
      }
    }

    const isDragging = !!draggedModel;

    return (
      <div
        className={`default-model-section ${
          isDraggingOverDefault ? "drag-over" : ""
        } ${isDragging ? "dragging-active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOverDefault(true);
        }}
        onDragLeave={() => setIsDraggingOverDefault(false)}
        onDrop={handleDefaultModelDrop}
      >
        {!isDragging ? (
          defaultModelInfo ? (
            <div className="default-model-compact">
              <Icon icon="pin" className="default-pin-icon" />
              <span className="default-label">Default:</span>
              <span className="default-model-name">
                {defaultModelInfo.name}
              </span>
              {defaultModelInfo.contextLength && (
                <Tag minimal small className="default-tag">
                  {formatContextLength(defaultModelInfo.contextLength)}
                </Tag>
              )}
              {defaultModelInfo.pricing &&
                defaultModelInfo.pricing.input > 0 &&
                defaultModelInfo.pricing.output > 0 && (
                  <>
                    <Tag minimal small className="default-tag price-in">
                      In: ${defaultModelInfo.pricing.input.toFixed(2)}
                    </Tag>
                    <Tag minimal small className="default-tag price-out">
                      Out: ${defaultModelInfo.pricing.output.toFixed(2)}
                    </Tag>
                  </>
                )}
              <Button
                icon="cross"
                minimal
                small
                onClick={() => handleSetDefaultModel(null)}
                title="Clear default model"
                className="default-clear-btn"
              />
            </div>
          ) : (
            <div className="default-model-empty">
              <Icon icon="drag-handle-vertical" size={14} />
              <span>Drag a model here to set as default</span>
            </div>
          )
        ) : (
          <div className="default-model-empty">
            <Icon icon="drag-handle-vertical" size={14} />
            <span>Drop here to set as default</span>
          </div>
        )}
      </div>
    );
  };

  // Render default web search model section
  const renderDefaultWebSearchModelSection = () => {
    const currentDefault = workingConfig.defaultWebSearchModel;
    const isDragging = !!draggedModel;

    // Find the model details
    let defaultModelInfo = null;
    if (currentDefault) {
      const allProviders = getAllProviders();
      for (const provider of allProviders) {
        const providerModels = getProviderModelsFromWorkingConfig(provider);
        const prefix = getPrefix(provider);
        const modelId = currentDefault.replace(prefix, "");
        const model = providerModels.find(
          (m) => m.id === modelId || prefix + m.id === currentDefault
        );
        if (model) {
          const metadata = getModelMetadata(model.id);
          defaultModelInfo = {
            ...model,
            provider,
            fullId: currentDefault,
            contextLength: metadata.contextLength,
            pricing: metadata.pricing,
          };
          break;
        }
      }
    }

    return (
      <div
        className={`default-model-section default-websearch-section ${
          isDraggingOverWebSearch ? "drag-over" : ""
        } ${isDragging ? "dragging-active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOverWebSearch(true);
        }}
        onDragLeave={() => setIsDraggingOverWebSearch(false)}
        onDrop={handleWebSearchModelDrop}
      >
        {!isDragging ? (
          defaultModelInfo ? (
            <div className="default-model-compact">
              <Icon icon="search" className="default-pin-icon" size={12} />
              <span className="default-label">Web Search:</span>
              <span className="default-model-name">
                {defaultModelInfo.name}
              </span>
              {defaultModelInfo.pricing &&
                defaultModelInfo.pricing.input > 0 && (
                  <Tag minimal small className="default-tag price-in">
                    In: ${defaultModelInfo.pricing.input.toFixed(2)}
                  </Tag>
                )}
              <Button
                icon="cross"
                minimal
                small
                onClick={() => handleSetDefaultWebSearchModel(null)}
                title="Clear web search default model"
                className="default-clear-btn"
              />
            </div>
          ) : (
            <div className="default-model-empty">
              <Icon icon="search" size={12} />
              <span style={{ fontSize: "12px", color: "#5c7080" }}>
                Web Search: same as text generation default model
              </span>
            </div>
          )
        ) : (
          <div className="default-model-empty">
            <Icon icon="search" size={12} />
            <span style={{ fontSize: "12px" }}>
              Drop here for web search default
            </span>
          </div>
        )}
      </div>
    );
  };

  // Render default image generation model section
  const renderDefaultImageModelSection = () => {
    const currentDefault = workingConfig.defaultImageModel;
    const isDragging = !!draggedModel;

    // Find the model details
    let defaultModelInfo = null;
    if (currentDefault) {
      const allProviders = getAllProviders();
      for (const provider of allProviders) {
        const providerModels = getProviderModelsFromWorkingConfig(provider);
        const prefix = getPrefix(provider);
        const modelId = currentDefault.replace(prefix, "");
        const model = providerModels.find(
          (m) => m.id === modelId || prefix + m.id === currentDefault
        );
        if (model) {
          const metadata = getModelMetadata(model.id);
          defaultModelInfo = {
            ...model,
            provider,
            fullId: currentDefault,
            contextLength: metadata.contextLength,
            pricing: metadata.pricing,
          };
          break;
        }
      }
    }

    // Get initial default if not set
    const initialDefault = !currentDefault
      ? getInitialDefaultImageModel()
      : null;

    return (
      <div
        className={`default-model-section default-imagegen-section ${
          isDraggingOverImageGen ? "drag-over" : ""
        } ${isDragging ? "dragging-active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOverImageGen(true);
        }}
        onDragLeave={() => setIsDraggingOverImageGen(false)}
        onDrop={handleImageGenModelDrop}
      >
        {!isDragging ? (
          defaultModelInfo ? (
            <div className="default-model-compact">
              <Icon icon="media" className="default-pin-icon" size={12} />
              <span className="default-label">Image Gen:</span>
              <span className="default-model-name">
                {defaultModelInfo.name}
              </span>
              {defaultModelInfo.pricing &&
                defaultModelInfo.pricing.output > 0 && (
                  <Tag minimal small className="default-tag price-out">
                    Out: ${defaultModelInfo.pricing.output.toFixed(2)}
                  </Tag>
                )}
              <Button
                icon="cross"
                minimal
                small
                onClick={() => handleSetDefaultImageModel(null)}
                title="Clear image generation default model"
                className="default-clear-btn"
              />
            </div>
          ) : (
            <div className="default-model-empty">
              <Icon icon="media" size={12} />
              <span style={{ fontSize: "12px", color: "#5c7080" }}>
                Image Gen:{" "}
                {initialDefault || "gpt-image-1-mini or Nano Banana Pro"}
              </span>
            </div>
          )
        ) : (
          <div className="default-model-empty">
            <Icon icon="media" size={12} />
            <span style={{ fontSize: "12px" }}>
              Drop here for image generation default
            </span>
          </div>
        )}
      </div>
    );
  };

  // Render visibility panel
  const renderVisibilityPanel = () => {
    // Merge saved provider order with current provider list
    // This ensures new providers (like OpenRouter, Groq, Ollama) are included
    const allProviders = getAllProviders();
    let providers;

    if (
      workingConfig.providerOrder &&
      Array.isArray(workingConfig.providerOrder)
    ) {
      // Start with saved order
      providers = [...workingConfig.providerOrder];

      // Add any new providers that aren't in the saved order
      allProviders.forEach((provider) => {
        if (!providers.includes(provider)) {
          providers.push(provider);
        }
      });
    } else {
      providers = allProviders;
    }

    // If searching, expand all providers to show matching models
    const providersToRender = searchQuery
      ? providers
          .map((provider) => {
            const models = getProviderModelsFromWorkingConfig(provider);
            const hasMatches = models.some(
              (m) =>
                !isImageGenModel(m.id) &&
                (m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  m.id.toLowerCase().includes(searchQuery.toLowerCase()))
            );
            return hasMatches ? provider : null;
          })
          .filter(Boolean)
      : providers;

    return (
      <div className="visibility-panel">
        <div
          style={{
            marginBottom: "12px",
            fontSize: "12px",
            color: "#5c7080",
          }}
        >
          💡 Drag model or provider to reorder them in the menu
        </div>
        {providersToRender.map((provider) => renderProviderSection(provider))}
      </div>
    );
  };

  // Render custom models panel
  const renderCustomModelsPanel = () => {
    const toggleAddForm = (section) => {
      setShowAddForm({ ...showAddForm, [section]: !showAddForm[section] });
    };

    // Native providers that use official APIs
    const nativeProviders = [
      "openai",
      "anthropic",
      "google",
      "deepseek",
      "grok",
    ];
    const openaiEndpoint = workingConfig.providerEndpoints?.openai;

    // Add openai-custom option if custom endpoint is enabled
    const availableProviders = nativeProviders.map((p) => ({
      value: p,
      label: getProviderLabel(p),
    }));

    if (openaiEndpoint?.enabled) {
      availableProviders.push({
        value: "openai-custom",
        label: "OpenAI-compatible (custom endpoint)",
      });
    }

    // Render OpenAI Custom Endpoint Configuration Section
    const renderOpenAIEndpointSection = () => {
      return (
        <div className="provider-section openai-endpoint-section">
          <div className="provider-section-header">
            <h4>OpenAI Custom Endpoint Configuration</h4>
          </div>
          <div className="custom-provider-content">
            <ProviderEndpointConfig
              provider="openai"
              endpoint={openaiEndpoint}
              onChange={(newEndpoint) =>
                handleEndpointChange("openai", newEndpoint)
              }
            />
          </div>
        </div>
      );
    };

    // Render Native Provider APIs unified section
    const renderNativeProvidersSection = () => {
      const isFormVisible = showAddForm["native-apis"];
      const isExpanded = expandedProviders.has("native-apis");

      // Collect all native provider models
      const allNativeModels = [];
      nativeProviders.forEach((provider) => {
        const models = workingConfig.customModels?.[provider] || [];
        models.forEach((model) => {
          allNativeModels.push({ ...model, provider });
        });
      });

      return (
        <div className="provider-section native-apis-section">
          <div
            className="provider-section-header"
            onClick={() => handleToggleProvider("native-apis")}
          >
            <h4>{isExpanded ? "▼" : "▶"} Native Provider APIs</h4>
            <span className="provider-badge">
              {allNativeModels.length} models
            </span>
          </div>

          <Collapse isOpen={isExpanded}>
            <div className="custom-provider-content">
              {/* Existing models list - grouped by provider */}
              {allNativeModels.length > 0 ? (
                <div className="custom-models-list">
                  {nativeProviders.map((provider) => {
                    const providerModels =
                      workingConfig.customModels?.[provider] || [];
                    if (providerModels.length === 0) return null;

                    return (
                      <div key={provider} className="provider-models-group">
                        <div className="provider-models-group-label">
                          {getProviderLabel(provider)}
                        </div>
                        {providerModels.map((model) => (
                          <div
                            key={model.id}
                            className={`custom-model-row ${
                              draggedCustomModel?.modelId === model.id
                                ? "dragging"
                                : ""
                            }`}
                            draggable={true}
                            onDragStart={(e) =>
                              handleCustomModelDragStart(e, provider, model.id)
                            }
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                            }}
                            onDrop={(e) =>
                              handleCustomModelDrop(e, provider, model.id)
                            }
                            onDragEnd={() => setDraggedCustomModel(null)}
                          >
                            <Icon
                              icon="drag-handle-vertical"
                              className="drag-handle"
                            />
                            <div className="custom-model-info">
                              <span className="custom-model-name">
                                {model.name}
                              </span>
                              <span className="custom-model-id">
                                {model.id}
                              </span>
                            </div>
                            <div className="custom-model-meta">
                              {model.contextLength && (
                                <Tag minimal small>
                                  {formatContextLength(model.contextLength)}
                                </Tag>
                              )}
                              {model.pricing && model.pricing.input > 0 && (
                                <Tag
                                  minimal
                                  small
                                  className="pricing-tag price-in"
                                >
                                  In: ${model.pricing.input.toFixed(2)}
                                </Tag>
                              )}
                              {model.pricing && model.pricing.output > 0 && (
                                <Tag
                                  minimal
                                  small
                                  className="pricing-tag price-out"
                                >
                                  Out: ${model.pricing.output.toFixed(2)}
                                </Tag>
                              )}
                            </div>
                            <Button
                              icon="trash"
                              intent="danger"
                              minimal
                              small
                              onClick={() =>
                                handleDeleteCustomModel(provider, model.id)
                              }
                            />
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-models-hint">
                  No custom models added yet
                </div>
              )}

              {/* Add button or Form */}
              {isFormVisible ? (
                <CustomModelForm
                  availableProviders={availableProviders}
                  defaultProvider="openai"
                  allCustomModels={workingConfig.customModels}
                  onAdd={(provider, model) =>
                    handleAddCustomModel(provider, model)
                  }
                  onCancel={() => toggleAddForm("native-apis")}
                />
              ) : (
                <Button
                  icon="plus"
                  small
                  minimal
                  intent="primary"
                  className="add-model-button"
                  onClick={() => toggleAddForm("native-apis")}
                >
                  Add custom model
                </Button>
              )}
            </div>
          </Collapse>
        </div>
      );
    };

    // Render OpenRouter section with integrated browser
    const renderOpenRouterSection = () => {
      const customModels = workingConfig.customModels?.openrouter || [];
      const isExpanded = expandedProviders.has("openrouter");

      return (
        <div className="provider-section openrouter-section">
          <div
            className="provider-section-header"
            onClick={() => handleToggleProvider("openrouter")}
          >
            <h4>{isExpanded ? "▼" : "▶"} OpenRouter</h4>
            <span className="provider-badge">{customModels.length} models</span>
          </div>

          <Collapse isOpen={isExpanded}>
            <div className="custom-provider-content">
              {/* Integrated OpenRouter Browser */}
              <OpenRouterBrowser
                existingModels={customModels}
                onAddModel={(model) =>
                  handleAddCustomModel("openrouter", model)
                }
                onRemoveModel={(modelId) =>
                  handleDeleteCustomModel("openrouter", modelId)
                }
              />
            </div>
          </Collapse>
        </div>
      );
    };

    // Render Groq section
    const renderGroqSection = () => {
      const customModels = workingConfig.customModels?.groq || [];
      const isExpanded = expandedProviders.has("groq");
      const isFormVisible = showAddForm["groq"];

      return (
        <div className="provider-section groq-section">
          <div
            className="provider-section-header"
            onClick={() => handleToggleProvider("groq")}
          >
            <h4>{isExpanded ? "▼" : "▶"} Groq</h4>
            <span className="provider-badge">{customModels.length} models</span>
          </div>

          <Collapse isOpen={isExpanded}>
            <div className="custom-provider-content">
              {/* Existing models list */}
              {customModels.length > 0 ? (
                <div className="custom-models-list">
                  {customModels.map((model) => (
                    <div
                      key={model.id}
                      className={`custom-model-row ${
                        draggedCustomModel?.modelId === model.id
                          ? "dragging"
                          : ""
                      }`}
                      draggable={true}
                      onDragStart={(e) =>
                        handleCustomModelDragStart(e, "groq", model.id)
                      }
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => handleCustomModelDrop(e, "groq", model.id)}
                      onDragEnd={() => setDraggedCustomModel(null)}
                    >
                      <Icon
                        icon="drag-handle-vertical"
                        className="drag-handle"
                      />
                      <div className="custom-model-info">
                        <span className="custom-model-name">{model.name}</span>
                        <span className="custom-model-id">{model.id}</span>
                      </div>
                      <div className="custom-model-meta">
                        {model.contextLength && (
                          <Tag minimal small>
                            {formatContextLength(model.contextLength)}
                          </Tag>
                        )}
                        {model.pricing && model.pricing.input > 0 && (
                          <Tag minimal small className="pricing-tag price-in">
                            In: ${model.pricing.input.toFixed(2)}
                          </Tag>
                        )}
                        {model.pricing && model.pricing.output > 0 && (
                          <Tag minimal small className="pricing-tag price-out">
                            Out: ${model.pricing.output.toFixed(2)}
                          </Tag>
                        )}
                      </div>
                      <Button
                        icon="trash"
                        intent="danger"
                        minimal
                        small
                        onClick={() =>
                          handleDeleteCustomModel("groq", model.id)
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-models-hint">
                  No custom Groq models added yet
                </div>
              )}

              {/* Add button or Form */}
              {isFormVisible ? (
                <CustomModelForm
                  availableProviders={[{ value: "groq", label: "Groq" }]}
                  defaultProvider="groq"
                  allCustomModels={workingConfig.customModels}
                  onAdd={(provider, model) =>
                    handleAddCustomModel(provider, model)
                  }
                  onCancel={() => toggleAddForm("groq")}
                />
              ) : (
                <Button
                  icon="plus"
                  small
                  minimal
                  intent="primary"
                  className="add-model-button"
                  onClick={() => toggleAddForm("groq")}
                >
                  Add custom model
                </Button>
              )}
            </div>
          </Collapse>
        </div>
      );
    };

    // Render Ollama section with endpoint config
    const renderOllamaSection = () => {
      const customModels = workingConfig.customModels?.ollama || [];
      const isExpanded = expandedProviders.has("ollama");
      const isFormVisible = showAddForm["ollama"];
      const endpoint = workingConfig.providerEndpoints?.ollama;

      return (
        <div className="provider-section ollama-section">
          <div
            className="provider-section-header"
            onClick={() => handleToggleProvider("ollama")}
          >
            <h4>{isExpanded ? "▼" : "▶"} Ollama</h4>
            <span className="provider-badge">{customModels.length} models</span>
          </div>

          <Collapse isOpen={isExpanded}>
            <div className="custom-provider-content">
              {/* Endpoint configuration */}
              <ProviderEndpointConfig
                provider="ollama"
                endpoint={endpoint}
                onChange={(newEndpoint) =>
                  handleEndpointChange("ollama", newEndpoint)
                }
              />

              {/* Existing models list */}
              {customModels.length > 0 ? (
                <div className="custom-models-list">
                  {customModels.map((model) => (
                    <div
                      key={model.id}
                      className={`custom-model-row ${
                        draggedCustomModel?.modelId === model.id
                          ? "dragging"
                          : ""
                      }`}
                      draggable={true}
                      onDragStart={(e) =>
                        handleCustomModelDragStart(e, "ollama", model.id)
                      }
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) =>
                        handleCustomModelDrop(e, "ollama", model.id)
                      }
                      onDragEnd={() => setDraggedCustomModel(null)}
                    >
                      <Icon
                        icon="drag-handle-vertical"
                        className="drag-handle"
                      />
                      <div className="custom-model-info">
                        <span className="custom-model-name">{model.name}</span>
                        <span className="custom-model-id">{model.id}</span>
                      </div>
                      <div className="custom-model-meta">
                        {model.contextLength && (
                          <Tag minimal small>
                            {formatContextLength(model.contextLength)}
                          </Tag>
                        )}
                      </div>
                      <Button
                        icon="trash"
                        intent="danger"
                        minimal
                        small
                        onClick={() =>
                          handleDeleteCustomModel("ollama", model.id)
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-models-hint">
                  No custom Ollama models added yet
                </div>
              )}

              {/* Add button or Form */}
              {isFormVisible ? (
                <CustomModelForm
                  availableProviders={[{ value: "ollama", label: "Ollama" }]}
                  defaultProvider="ollama"
                  allCustomModels={workingConfig.customModels}
                  onAdd={(provider, model) =>
                    handleAddCustomModel(provider, model)
                  }
                  onCancel={() => toggleAddForm("ollama")}
                />
              ) : (
                <Button
                  icon="plus"
                  small
                  minimal
                  intent="primary"
                  className="add-model-button"
                  onClick={() => toggleAddForm("ollama")}
                >
                  Add custom model
                </Button>
              )}
            </div>
          </Collapse>
        </div>
      );
    };

    return (
      <div className="custom-models-panel">
        {renderOpenAIEndpointSection()}
        {renderNativeProvidersSection()}
        {renderOpenRouterSection()}
        {renderGroqSection()}
        {renderOllamaSection()}
      </div>
    );
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="Customize Model Menu"
      className="model-config-dialog"
    >
      <div className={Classes.DIALOG_BODY}>
        {/* Sticky header section */}
        <div className="dialog-sticky-header">
          <Tabs
            selectedTabId={activeTab}
            onChange={setActiveTab}
            className="model-tabs"
          >
            <Tab id="visibility" title="Model Visibility & Favorites" />
            <Tab id="custom" title="Custom Models" />
            <Tab id="usage-tokens" title="Usage & Tokens" />
          </Tabs>

          {/* Default model and search - only shown in visibility tab */}
          {activeTab === "visibility" && (
            <>
              {renderDefaultModelSection()}
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                {renderDefaultWebSearchModelSection()}
                {renderDefaultImageModelSection()}
              </div>
              <InputGroup
                leftIcon="search"
                placeholder="Search models..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="model-search"
                rightElement={
                  searchQuery ? (
                    <Button
                      icon="cross"
                      minimal
                      onClick={() => setSearchQuery("")}
                    />
                  ) : undefined
                }
              />
            </>
          )}
        </div>

        {/* Scrollable content area */}
        <div className="dialog-scrollable-content">
          {activeTab === "visibility" && renderVisibilityPanel()}
          {activeTab === "custom" && renderCustomModelsPanel()}
          {activeTab === "usage-tokens" && (
            <TokensUsageContent showResetButton={true} />
          )}
        </div>
      </div>

      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          {activeTab === "visibility" && (
            <Button onClick={handleReset} icon="reset">
              Reset to Defaults
            </Button>
          )}
          {activeTab === "custom" && (
            <Button onClick={handleResetCustomModels} icon="trash" intent="danger">
              Delete All Custom Models
            </Button>
          )}
          <Button onClick={handleClose} intent="primary">
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default ModelConfigDialog;
