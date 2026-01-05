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
} from "@blueprintjs/core";
import ModelCard from "./ModelCard";
import CustomModelForm from "./CustomModelForm";
import OpenRouterBrowser from "./OpenRouterBrowser";
import ProviderEndpointConfig from "./ProviderEndpointConfig";
import { TokensUsageContent } from "../TokensDisplay";
import { AppToaster } from "../Toaster";
import { extensionStorage, setDefaultModel } from "../..";
import {
  getModelConfig,
  saveModelConfig,
  getProviderModels,
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
} from "../../utils/modelConfigHelpers";
import { getAvailableModels } from "../../ai/modelsInfo";
import "./ModelConfigDialog.css";

/**
 * ModelConfigDialog - Main configuration dialog for customizing model menu
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether dialog is open
 * @param {Function} props.onClose - Callback when dialog is closed
 * @param {Function} props.onSave - Callback when configuration is saved
 * @param {string} props.initialTab - Optional initial tab to display ("visibility", "custom", "usage-tokens")
 */
export const ModelConfigDialog = ({ isOpen, onClose, onSave, initialTab = "visibility" }) => {
  const [workingConfig, setWorkingConfig] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState(initialTab);
  const [expandedProviders, setExpandedProviders] = useState(new Set()); // Start with all collapsed
  const [draggedModel, setDraggedModel] = useState(null);
  const [draggedProvider, setDraggedProvider] = useState(null);
  const [showAddForm, setShowAddForm] = useState({}); // { provider: boolean } - tracks which provider forms are visible
  const [draggedCustomModel, setDraggedCustomModel] = useState(null); // For custom models drag-drop
  const [isDraggingOverDefault, setIsDraggingOverDefault] = useState(false); // For default model drop zone

  // Load config when dialog opens
  useEffect(() => {
    if (isOpen) {
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

      return () => clearTimeout(timer);
    }
  }, [isOpen]);

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
    setDraggedModel({ id: modelId, provider });
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
    setShowAddForm({ ...showAddForm, [provider]: false });

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

    AppToaster.show({
      message: `Default model set to: ${modelId}`,
      intent: "success",
      timeout: 2000,
    });
  };

  const handleDefaultModelDrop = (e) => {
    e.preventDefault();
    setIsDraggingOverDefault(false);

    if (!draggedModel) return;

    const prefix = getPrefix(draggedModel.provider);
    const modelId = prefix + draggedModel.id;

    handleSetDefaultModel(modelId);
  };

  const handleEndpointChange = (provider, endpoint) => {
    const providerEndpoints = {
      ...(workingConfig.providerEndpoints || {}),
      [provider]: endpoint
    };

    setWorkingConfig({
      ...workingConfig,
      providerEndpoints
    });
  };

  const handleReset = () => {
    if (
      window.confirm(
        "Reset all model configurations to defaults? This will clear all hidden models, favorites, custom ordering, and custom models."
      )
    ) {
      setWorkingConfig({
        hiddenModels: [],
        favoriteModels: [],
        defaultModel: null,
        modelOrder: null,
        providerOrder: null,
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
        providerEndpoints: {
          openai: { baseURL: "", enabled: false },
          ollama: { baseURL: "http://localhost:11434", enabled: false }
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

  const handleSave = async () => {
    try {
      // Save model config first
      await saveModelConfig(workingConfig);

      // Sync defaultModel to extensionStorage and update the global variable
      if (workingConfig.defaultModel) {
        setDefaultModel(workingConfig.defaultModel);
      }

      if (onSave) {
        onSave(workingConfig);
      }
      AppToaster.show({
        message: "Model configuration saved successfully!",
        intent: "success",
        timeout: 3000,
      });
      onClose();
    } catch (error) {
      console.error("Failed to save model config:", error);
      AppToaster.show({
        message: "Failed to save configuration",
        intent: "danger",
        timeout: 3000,
      });
    }
  };

  const handleCancel = () => {
    onClose();
  };

  // Toggle all models for a provider
  const handleToggleAllProvider = (provider, makeVisible) => {
    const models = getProviderModels(provider);
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
    const models = getProviderModels(provider);
    // Auto-expand if searching
    const isExpanded = searchQuery ? true : expandedProviders.has(provider);

    // Check if provider has API key (based on whether it has models from modelsInfo)
    const customProviders = ["OpenRouter", "Groq", "Ollama"];
    const isCustomProvider = customProviders.includes(provider);
    const baseModels = getAvailableModels(provider) || [];
    const hasApiKey = isCustomProvider || baseModels.length > 0;

    // Apply search filter
    const filteredModels = searchQuery
      ? models.filter(
          (m) =>
            m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.id.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : models;

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
            {filteredModels.map((model) => {
              const metadata = getModelMetadata(model.id);
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
        </Collapse>
      </div>
    );
  };

  // Render default model section
  const renderDefaultModelSection = () => {
    const currentDefault = workingConfig.defaultModel;

    // Find the model details
    let defaultModelInfo = null;
    if (currentDefault) {
      const allProviders = getAllProviders();
      for (const provider of allProviders) {
        const providerModels = getProviderModels(provider);
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
              {defaultModelInfo.pricing && defaultModelInfo.pricing.input > 0 && defaultModelInfo.pricing.output > 0 && (
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
            const models = getProviderModels(provider);
            const hasMatches = models.some(
              (m) =>
                m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                m.id.toLowerCase().includes(searchQuery.toLowerCase())
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
    const nativeProviders = ['openai', 'anthropic', 'google', 'deepseek', 'grok'];
    const openaiEndpoint = workingConfig.providerEndpoints?.openai;

    // Add openai-custom option if custom endpoint is enabled
    const availableProviders = nativeProviders.map(p => ({
      value: p,
      label: getProviderLabel(p)
    }));

    if (openaiEndpoint?.enabled) {
      availableProviders.push({
        value: 'openai-custom',
        label: 'OpenAI-compatible (custom endpoint)'
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
              onChange={(newEndpoint) => handleEndpointChange('openai', newEndpoint)}
            />
          </div>
        </div>
      );
    };

    // Render Native Provider APIs unified section
    const renderNativeProvidersSection = () => {
      const isFormVisible = showAddForm['native-apis'];
      const isExpanded = expandedProviders.has('native-apis');

      // Collect all native provider models
      const allNativeModels = [];
      nativeProviders.forEach(provider => {
        const models = workingConfig.customModels?.[provider] || [];
        models.forEach(model => {
          allNativeModels.push({ ...model, provider });
        });
      });

      return (
        <div className="provider-section native-apis-section">
          <div
            className="provider-section-header"
            onClick={() => handleToggleProvider('native-apis')}
          >
            <h4>
              {isExpanded ? "▼" : "▶"} Native Provider APIs
            </h4>
            <span className="provider-badge">
              {allNativeModels.length} models
            </span>
          </div>

          <Collapse isOpen={isExpanded}>
            <div className="custom-provider-content">
              {/* Existing models list - grouped by provider */}
              {allNativeModels.length > 0 ? (
                <div className="custom-models-list">
                  {nativeProviders.map(provider => {
                    const providerModels = workingConfig.customModels?.[provider] || [];
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
                              <span className="custom-model-id">{model.id}</span>
                            </div>
                            <div className="custom-model-meta">
                              {model.contextLength && (
                                <Tag minimal small>
                                  {formatContextLength(model.contextLength)}
                                </Tag>
                              )}
                              {model.pricing && model.pricing.input > 0 && (
                                <Tag minimal small intent="success">
                                  ${model.pricing.input.toFixed(2)}
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
                  onAdd={(provider, model) => handleAddCustomModel(provider, model)}
                  onCancel={() => toggleAddForm('native-apis')}
                />
              ) : (
                <Button
                  icon="plus"
                  small
                  minimal
                  intent="primary"
                  className="add-model-button"
                  onClick={() => toggleAddForm('native-apis')}
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
      const isExpanded = expandedProviders.has('openrouter');

      return (
        <div className="provider-section openrouter-section">
          <div
            className="provider-section-header"
            onClick={() => handleToggleProvider('openrouter')}
          >
            <h4>
              {isExpanded ? "▼" : "▶"} OpenRouter
            </h4>
            <span className="provider-badge">
              {customModels.length} models
            </span>
          </div>

          <Collapse isOpen={isExpanded}>
            <div className="custom-provider-content">
              {/* Integrated OpenRouter Browser */}
              <OpenRouterBrowser
                existingModels={customModels}
                onAddModel={(model) => handleAddCustomModel('openrouter', model)}
              />
            </div>
          </Collapse>
        </div>
      );
    };

    // Render Groq section
    const renderGroqSection = () => {
      const customModels = workingConfig.customModels?.groq || [];
      const isExpanded = expandedProviders.has('groq');
      const isFormVisible = showAddForm['groq'];

      return (
        <div className="provider-section groq-section">
          <div
            className="provider-section-header"
            onClick={() => handleToggleProvider('groq')}
          >
            <h4>
              {isExpanded ? "▼" : "▶"} Groq
            </h4>
            <span className="provider-badge">
              {customModels.length} models
            </span>
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
                        handleCustomModelDragStart(e, 'groq', model.id)
                      }
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) =>
                        handleCustomModelDrop(e, 'groq', model.id)
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
                        <span className="custom-model-id">{model.id}</span>
                      </div>
                      <div className="custom-model-meta">
                        {model.contextLength && (
                          <Tag minimal small>
                            {formatContextLength(model.contextLength)}
                          </Tag>
                        )}
                        {model.pricing && model.pricing.input > 0 && (
                          <Tag minimal small intent="success">
                            ${model.pricing.input.toFixed(2)}
                          </Tag>
                        )}
                      </div>
                      <Button
                        icon="trash"
                        intent="danger"
                        minimal
                        small
                        onClick={() =>
                          handleDeleteCustomModel('groq', model.id)
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
                  availableProviders={[{ value: 'groq', label: 'Groq' }]}
                  defaultProvider="groq"
                  allCustomModels={workingConfig.customModels}
                  onAdd={(provider, model) => handleAddCustomModel(provider, model)}
                  onCancel={() => toggleAddForm('groq')}
                />
              ) : (
                <Button
                  icon="plus"
                  small
                  minimal
                  intent="primary"
                  className="add-model-button"
                  onClick={() => toggleAddForm('groq')}
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
      const isExpanded = expandedProviders.has('ollama');
      const isFormVisible = showAddForm['ollama'];
      const endpoint = workingConfig.providerEndpoints?.ollama;

      return (
        <div className="provider-section ollama-section">
          <div
            className="provider-section-header"
            onClick={() => handleToggleProvider('ollama')}
          >
            <h4>
              {isExpanded ? "▼" : "▶"} Ollama
            </h4>
            <span className="provider-badge">
              {customModels.length} models
            </span>
          </div>

          <Collapse isOpen={isExpanded}>
            <div className="custom-provider-content">
              {/* Endpoint configuration */}
              <ProviderEndpointConfig
                provider="ollama"
                endpoint={endpoint}
                onChange={(newEndpoint) => handleEndpointChange('ollama', newEndpoint)}
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
                        handleCustomModelDragStart(e, 'ollama', model.id)
                      }
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) =>
                        handleCustomModelDrop(e, 'ollama', model.id)
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
                          handleDeleteCustomModel('ollama', model.id)
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
                  availableProviders={[{ value: 'ollama', label: 'Ollama' }]}
                  defaultProvider="ollama"
                  allCustomModels={workingConfig.customModels}
                  onAdd={(provider, model) => handleAddCustomModel(provider, model)}
                  onCancel={() => toggleAddForm('ollama')}
                />
              ) : (
                <Button
                  icon="plus"
                  small
                  minimal
                  intent="primary"
                  className="add-model-button"
                  onClick={() => toggleAddForm('ollama')}
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
      onClose={handleCancel}
      title="Customize Model Menu"
      className="model-config-dialog"
      canOutsideClickClose={false}
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
          {activeTab === "usage-tokens" && <TokensUsageContent showResetButton={true} />}
        </div>
      </div>

      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={handleReset} icon="reset">
            Reset to Defaults
          </Button>
          <Button onClick={handleCancel}>Cancel</Button>
          <Button onClick={handleSave} intent="primary" icon="saved">
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default ModelConfigDialog;
