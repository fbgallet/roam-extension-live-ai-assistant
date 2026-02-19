import { extensionStorage } from "..";
import { webSearchModels, imageGenerationModels, normalizeClaudeModel } from "../ai/modelsInfo";
import { tokensLimit, modelsPricing, openRouterModelPricing } from "../ai/modelsInfo";
import { hasCapability, getModelsByProvider, MODEL_REGISTRY } from "../ai/modelRegistry";
import {
  getNewModelIds,
  getDeprecatedModels,
  isModelNew as isModelNewFromUpdates,
  getUpdateVersion,
} from "../ai/modelUpdates";

/**
 * Build the default hiddenModels list from MODEL_REGISTRY (models with visibleByDefault: false)
 * @returns {Array} Array of model names that should be hidden by default
 */
function getDefaultHiddenModels() {
  return Object.values(MODEL_REGISTRY)
    .filter((m) => m.visibleByDefault === false)
    .map((m) => m.name);
}

/**
 * Get model configuration with defaults if not exists
 * @returns {Object} Model configuration object
 */
export function getModelConfig() {
  const config = extensionStorage.get("modelConfig");

  if (!config || !config.version) {
    return {
      hiddenModels: getDefaultHiddenModels(),
      favoriteModels: [],
      defaultModel: null, // Default model for the extension
      modelOrder: null,
      providerOrder: null, // Order of providers in the menu
      customModels: {
        openai: [],
        anthropic: [],
        google: [],
        deepseek: [],
        grok: [],
        openrouter: [],
        groq: [],
        ollama: []
      },
      providerEndpoints: {
        // Only OpenAI-compatible and Ollama support custom endpoints
        // For OpenAI:
        //   - enabled: makes custom endpoint available for custom models
        //   - exclusive: routes ALL OpenAI-compatible calls through custom endpoint (replaces official API)
        openai: { baseURL: "", enabled: false, exclusive: false },
        ollama: { baseURL: "http://localhost:11434", enabled: false }
      },
      modelOptions: {},
      newModels: [],
      lastSeenVersion: "0.0.0",
      version: 2
    };
  }

  return config;
}

/**
 * Save model configuration to storage
 * @param {Object} config - Configuration object to save
 */
export async function saveModelConfig(config) {
  // Preserve version from config, default to 2 if not present
  const version = config.version || 2;
  await extensionStorage.set("modelConfig", { ...config, version });
}

/**
 * Parse comma-separated model list to structured format
 * @param {string} commaSeparated - Comma-separated model IDs
 * @returns {Array} Array of model objects
 */
function parseCustomModels(commaSeparated) {
  if (!commaSeparated || typeof commaSeparated !== 'string') {
    return [];
  }

  return commaSeparated
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(id => ({
      id,
      name: id, // Default name = id
      contextLength: null,
      pricing: null
    }));
}

/**
 * Migrate from old comma-separated storage format to new structured format
 * V1: Initial structured config
 * V2: Added new provider categories and providerEndpoints
 */
export async function migrateModelConfig() {
  const existing = extensionStorage.get("modelConfig");

  // Already on V2
  if (existing && existing.version === 2) {
    // Still run openRouterOnly migration if not yet done
    await migrateOpenRouterOnlySetting();
    return;
  }

  console.log("[Model Config] Migrating to new storage format...");

  // V1 to V2 migration
  if (existing && existing.version === 1) {
    console.log("[Model Config] Migrating from V1 to V2...");
    await migrateToV2(existing);
    // Run openRouterOnly migration after V2 upgrade
    await migrateOpenRouterOnlySetting();
    return;
  }

  // Fresh install or V0 (no version) - migrate to V2
  console.log("[Model Config] Migrating from V0 to V2...");

  // Get old comma-separated lists
  const customModel = extensionStorage.get("customModel") || "";
  const openRouterModels = extensionStorage.get("openRouterModels") || "";
  const groqModels = extensionStorage.get("groqModels") || "";
  const ollamaModels = extensionStorage.get("ollamaModels") || "";

  // Get old endpoint configurations
  const customBaseURL = extensionStorage.get("customBaseUrl") || "";
  const customOpenAIOnly = extensionStorage.get("customOpenAIOnly") || false;
  const ollamaServer = extensionStorage.get("ollamaServer") || "http://localhost:11434";

  const modelConfig = {
    hiddenModels: getDefaultHiddenModels(),
    favoriteModels: [],
    defaultModel: null,
    modelOrder: null,
    providerOrder: null,
    customModels: {
      openai: parseCustomModels(customModel),
      anthropic: [],
      google: [],
      deepseek: [],
      grok: [],
      openrouter: parseCustomModels(openRouterModels),
      groq: parseCustomModels(groqModels),
      ollama: parseCustomModels(ollamaModels)
    },
    providerEndpoints: {
      openai: {
        baseURL: customBaseURL,
        // If customBaseURL exists, enable the endpoint
        // exclusive maps to the old customOpenAIOnly behavior
        enabled: !!customBaseURL,
        exclusive: !!customOpenAIOnly
      },
      ollama: {
        baseURL: ollamaServer || "http://localhost:11434",
        enabled: !!(ollamaModels && ollamaModels.trim())
      }
    },
    modelOptions: {},
    newModels: [],
    lastSeenVersion: "0.0.0",
    version: 2
  };

  await extensionStorage.set("modelConfig", modelConfig);
  console.log("[Model Config] Migration to V2 complete:", modelConfig);

  // Run openRouterOnly migration after initial setup
  await migrateOpenRouterOnlySetting();
}

/**
 * Migrate from V1 to V2 config
 * @param {Object} v1Config - V1 configuration object
 */
async function migrateToV2(v1Config) {
  // Get old endpoint configurations from extensionStorage
  const customBaseURL = extensionStorage.get("customBaseUrl") || "";
  const customOpenAIOnly = extensionStorage.get("customOpenAIOnly") || false;
  const ollamaServer = extensionStorage.get("ollamaServer") || "http://localhost:11434";

  // Create V2 config with new provider categories and endpoints
  const v2Config = {
    ...v1Config,
    customModels: {
      openai: v1Config.customModels?.openai || [],
      anthropic: [],
      google: [],
      deepseek: [],
      grok: [],
      openrouter: v1Config.customModels?.openrouter || [],
      groq: v1Config.customModels?.groq || [],
      ollama: v1Config.customModels?.ollama || []
    },
    providerEndpoints: {
      openai: {
        baseURL: customBaseURL,
        // If customBaseURL exists, enable the endpoint
        // exclusive maps to the old customOpenAIOnly behavior
        enabled: !!customBaseURL,
        exclusive: !!customOpenAIOnly
      },
      ollama: {
        baseURL: ollamaServer || "http://localhost:11434",
        enabled: !!(v1Config.customModels?.ollama && v1Config.customModels.ollama.length > 0)
      }
    },
    version: 2
  };

  await extensionStorage.set("modelConfig", v2Config);
  console.log("[Model Config] Migration from V1 to V2 complete");
}

/**
 * Migrate openRouterOnly setting to new visibility system
 * This is a one-time migration that converts the old "OpenRouter Only" toggle
 * to the new granular visibility system in ModelConfigDialog
 */
export async function migrateOpenRouterOnlySetting() {
  const config = getModelConfig();

  // Check if migration already done
  if (config.openRouterOnlyMigrated) {
    return;
  }

  console.log("[Model Config] Migrating openRouterOnly setting...");

  // Check old setting from extensionStorage
  const openRouterOnly = extensionStorage.get("openRouterOnly");

  if (openRouterOnly === true) {
    console.log("[Model Config] openRouterOnly was enabled - hiding non-OpenRouter models");

    // Hide all non-OpenRouter providers' models
    const hiddenModels = [...(config.hiddenModels || [])];
    const allProviders = getAllProviders();

    allProviders.forEach(provider => {
      if (provider !== "OpenRouter") {
        const models = getProviderModels(provider);
        models.forEach(model => {
          if (!hiddenModels.includes(model.id)) {
            hiddenModels.push(model.id);
          }
        });
      }
    });

    config.hiddenModels = hiddenModels;
    console.log(`[Model Config] Hidden ${hiddenModels.length} non-OpenRouter models`);
  }

  // Mark migration as complete
  config.openRouterOnlyMigrated = true;
  await saveModelConfig(config);

  console.log("[Model Config] openRouterOnly migration complete");
}

/**
 * Get all models for a provider (base + custom + ordering applied)
 * @param {string} provider - Provider name
 * @returns {Array} Array of model objects with id and name
 */
export function getProviderModels(provider) {
  const modelConfig = getModelConfig();

  // Get ALL base models from MODEL_REGISTRY (not filtered by visibleByDefault)
  // This ensures models like DeepSeek that have visibleByDefault: false can still be shown
  // when the user explicitly makes them visible in the config
  const registryModels = getModelsByProvider(provider);

  // Get custom models for this provider
  const providerKey = provider.toLowerCase();
  const customModels = modelConfig.customModels?.[providerKey] || [];

  // Convert registry models to objects
  // For native providers, .name is used as canonical ID throughout the app (stored in hiddenModels, etc.)
  // For dynamic providers (OpenRouter, Groq, Ollama), .id (raw API id) is used as canonical ID
  // In both cases, the display name (.name from registry) is preserved for UI display
  const isDynamicProvider = ["OpenRouter", "Groq", "Ollama"].includes(provider);
  const baseModels = registryModels.map(m => {
    const canonicalId = isDynamicProvider ? m.id : m.name;
    return {
      id: canonicalId,
      name: m.name || canonicalId,
      contextLength: tokensLimit[m.name] || tokensLimit[m.id],
      pricing: modelsPricing[m.name] || modelsPricing[m.id]
    };
  });

  // Filter out custom models that are already in base models (to prevent duplicates)
  // Check against both the canonical id AND the raw registry .id to catch all naming variants
  const baseModelIdsSet = new Set(baseModels.map(m => m.id));
  const baseModelRawIds = new Set(registryModels.map(m => m.id));
  const uniqueCustomModels = customModels.filter(m =>
    !baseModelIdsSet.has(m.id) && !baseModelRawIds.has(m.id)
  );

  // Combine base and custom models
  const allModels = [...baseModels, ...uniqueCustomModels];

  // Apply custom ordering if defined
  const order = modelConfig.modelOrder?.[provider];
  if (order && Array.isArray(order)) {
    // Sort according to custom order, keeping unordered items at end
    const ordered = [];
    const unordered = [];

    allModels.forEach(model => {
      const index = order.indexOf(model.id);
      if (index !== -1) {
        ordered[index] = model;
      } else {
        unordered.push(model);
      }
    });

    // Filter out undefined from ordered array and append unordered
    return ordered.filter(Boolean).concat(unordered);
  }

  return allModels;
}

/**
 * Check if a model is visible (not hidden)
 * @param {string} modelId - Model ID to check
 * @returns {boolean} True if visible
 */
export function isModelVisible(modelId) {
  const modelConfig = getModelConfig();
  return !modelConfig.hiddenModels?.includes(modelId);
}

/**
 * Check if a model is favorited
 * @param {string} modelId - Model ID to check
 * @returns {boolean} True if favorited
 */
export function isModelFavorited(modelId) {
  const modelConfig = getModelConfig();
  return modelConfig.favoriteModels?.includes(modelId);
}

/**
 * Get all favorite models across all providers
 * @returns {Array} Array of model IDs
 */
export function getFavoriteModels() {
  const modelConfig = getModelConfig();
  return modelConfig.favoriteModels || [];
}

/**
 * Get metadata for a model (context length, pricing)
 * @param {string} modelId - Model ID
 * @returns {Object} Metadata object with contextLength and pricing
 */
export function getModelMetadata(modelId) {
  let lookupId = modelId;

  // Normalize Claude model IDs to their API names for metadata lookup
  if (modelId.startsWith('Claude')) {
    lookupId = normalizeClaudeModel(modelId, false);
  }

  const contextLength = tokensLimit[lookupId];
  const pricing = modelsPricing[lookupId];

  // Handle OpenRouter models
  if (modelId.startsWith('openRouter/')) {
    const baseId = modelId.replace('openRouter/', '');
    const orInput = openRouterModelPricing(baseId, 'input');
    const orOutput = openRouterModelPricing(baseId, 'output');

    const orPricing = (orInput !== null && orOutput !== null) ? {
      input: orInput,
      output: orOutput
    } : null;

    return {
      contextLength: contextLength || tokensLimit["openRouter/" + baseId],
      pricing: orPricing || pricing
    };
  }

  // Handle custom models - check if they have metadata in config
  const modelConfig = getModelConfig();
  const allCustomModels = [
    ...(modelConfig.customModels?.openai || []),
    ...(modelConfig.customModels?.anthropic || []),
    ...(modelConfig.customModels?.google || []),
    ...(modelConfig.customModels?.deepseek || []),
    ...(modelConfig.customModels?.grok || []),
    ...(modelConfig.customModels?.openrouter || []),
    ...(modelConfig.customModels?.groq || []),
    ...(modelConfig.customModels?.ollama || [])
  ];

  const customModel = allCustomModels.find(m => m.id === modelId);
  if (customModel) {
    return {
      contextLength: customModel.contextLength || contextLength,
      pricing: customModel.pricing || pricing
    };
  }

  return { contextLength, pricing };
}

/**
 * Format context length for display
 * @param {number} tokens - Context length in tokens
 * @returns {string} Formatted string (e.g., "128k", "1M")
 */
export function formatContextLength(tokens) {
  if (!tokens) return "N/A";
  if (tokens >= 1000000) return `${(tokens/1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens/1000)}k`;
  return `${tokens}`;
}

/**
 * Format pricing for display
 * @param {Object} pricing - Pricing object with input and output
 * @returns {string} Formatted string (e.g., "$0.25-$1.25")
 */
export function formatPricing(pricing) {
  if (!pricing || !pricing.input || !pricing.output) return "N/A";

  const input = pricing.input || 0;
  const output = pricing.output || 0;

  return `$${input.toFixed(2)}-$${output.toFixed(2)}`;
}

/**
 * Get pricing tooltip text
 * @param {Object} pricing - Pricing object
 * @returns {string} Tooltip text
 */
export function getPricingTooltip(pricing) {
  if (!pricing || !pricing.input || !pricing.output) {
    return "Pricing not available";
  }

  return `Input: $${pricing.input.toFixed(2)}/1M tokens\nOutput: $${pricing.output.toFixed(2)}/1M tokens`;
}

/**
 * Check if a model supports web search
 * @param {string} modelId - Model ID
 * @returns {boolean} True if model supports web search
 */
export function isWebSearchModel(modelId) {
  // Check registry capability first
  if (hasCapability(modelId, "webSearch")) return true;
  // Fallback: check against known web search models array
  if (webSearchModels.includes(modelId)) return true;
  // Also check for search-related names (for custom/dynamic models)
  const lower = modelId.toLowerCase();
  return lower.includes("search") || lower.includes("web");
}

/**
 * Check if a model is for image generation
 * @param {string} modelId - Model ID
 * @returns {boolean} True if model is for image generation
 */
export function isImageGenModel(modelId) {
  // Check registry capability first
  if (hasCapability(modelId, "imageOutput")) return true;
  // Fallback: check against known image generation models array
  if (imageGenerationModels.includes(modelId)) return true;
  // Also check for image-related names (for custom/dynamic models)
  const lower = modelId.toLowerCase();
  return lower.includes("image") || lower.includes("imagen") || lower.includes("dall");
}

/**
 * Check if a model is a reasoning/thinking model
 * @param {string} modelId - Model ID
 * @returns {boolean} True if model is reasoning/thinking model
 */
export function isReasoningModel(modelId) {
  // Check registry capability first
  if (hasCapability(modelId, "thinking")) return true;
  // Fallback: string-based detection for custom/dynamic models
  const lower = modelId.toLowerCase();
  return (
    lower.includes("thinking") ||
    lower.includes("reasoning") ||
    lower.includes("+thinking") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4") ||
    (lower.includes("deepseek") && lower.includes("thinking"))
  );
}

/**
 * Get model capabilities badges
 * @param {string} modelId - Model ID
 * @returns {Array} Array of capability strings
 */
export function getModelCapabilities(modelId) {
  const capabilities = [];
  if (isWebSearchModel(modelId)) capabilities.push("search");
  if (isImageGenModel(modelId)) capabilities.push("image");
  if (isReasoningModel(modelId)) capabilities.push("reasoning");
  return capabilities;
}

/**
 * Get all provider names (both base and custom providers)
 * @returns {Array} Array of provider names
 */
export function getAllProviders() {
  return ["OpenAI", "Anthropic", "Google", "DeepSeek", "Grok", "OpenRouter", "Groq", "Ollama"];
}

/**
 * Get custom provider names (user-configurable)
 * @returns {Array} Array of custom provider names in lowercase
 */
export function getCustomProviders() {
  return ["anthropic", "google", "deepseek", "grok", "openai", "openrouter", "groq", "ollama"];
}

/**
 * Get default order for a provider
 * @param {string} provider - Provider name
 * @returns {Array} Array of model IDs in default order
 */
export function getDefaultOrder(provider) {
  const models = getProviderModels(provider);
  return models.map(m => m.id);
}

/**
 * Get ordered list of providers
 * @returns {Array} Array of provider names in display order
 */
export function getOrderedProviders() {
  const modelConfig = getModelConfig();
  const defaultOrder = getAllProviders();
  const customOrder = modelConfig.providerOrder;

  if (!customOrder || !Array.isArray(customOrder)) {
    return defaultOrder;
  }

  // Apply custom ordering
  const ordered = [];
  const unordered = [];

  defaultOrder.forEach(provider => {
    const index = customOrder.indexOf(provider);
    if (index !== -1) {
      ordered[index] = provider;
    } else {
      unordered.push(provider);
    }
  });

  // Filter out undefined and append unordered
  return ordered.filter(Boolean).concat(unordered);
}

/**
 * Check if a model is marked as new (recently added)
 * @param {string} modelId - Model ID to check
 * @returns {boolean} True if model is new
 */
export function isModelNew(modelId) {
  const modelConfig = getModelConfig();

  // Check if this model is in our "new models" list (not yet seen by user)
  if (modelConfig.newModels?.includes(modelId)) {
    return true;
  }

  // Also check against the model updates definition
  return isModelNewFromUpdates(modelId);
}

/**
 * Check for model updates and get deprecated models the user is using
 * @returns {Object} Object with newModels array and deprecatedInUse array
 */
export function checkModelUpdates() {
  const modelConfig = getModelConfig();
  const deprecatedModels = getDeprecatedModels();

  // Get all models the user might be using (favorites, default model, etc.)
  const userModels = new Set([
    ...(modelConfig.favoriteModels || []),
    // Add any models that aren't hidden
    ...getAllProviders().flatMap(provider => {
      const models = getProviderModels(provider);
      return models
        .filter(m => !modelConfig.hiddenModels?.includes(m.id))
        .map(m => m.id);
    })
  ]);

  // Find deprecated models the user is using
  const deprecatedInUse = deprecatedModels.filter(update =>
    userModels.has(update.oldModelId)
  );

  // Get new models since last seen version
  const newModelIds = getNewModelIds();

  return {
    newModels: newModelIds,
    deprecatedInUse,
    updateVersion: getUpdateVersion()
  };
}

/**
 * Mark new models as seen (clear the NEW badges)
 */
export async function clearNewModelBadges() {
  const modelConfig = getModelConfig();
  await saveModelConfig({
    ...modelConfig,
    newModels: [],
    lastSeenVersion: getUpdateVersion()
  });
}

/**
 * Apply model migrations (replace old model IDs with new ones)
 * @param {Array} migrations - Array of {oldModelId, newModelId, provider}
 */
export async function applyModelMigrations(migrations) {
  const modelConfig = getModelConfig();

  let updatedConfig = { ...modelConfig };

  migrations.forEach(({ oldModelId, newModelId }) => {
    // Update favorites
    if (updatedConfig.favoriteModels?.includes(oldModelId)) {
      updatedConfig.favoriteModels = updatedConfig.favoriteModels.map(id =>
        id === oldModelId ? newModelId : id
      );
    }

    // Remove old model from hidden if new one should be visible
    if (updatedConfig.hiddenModels?.includes(oldModelId)) {
      updatedConfig.hiddenModels = updatedConfig.hiddenModels.filter(
        id => id !== oldModelId
      );
    }

    // Update model order if present
    if (updatedConfig.modelOrder) {
      Object.keys(updatedConfig.modelOrder).forEach(provider => {
        const order = updatedConfig.modelOrder[provider];
        if (order?.includes(oldModelId)) {
          updatedConfig.modelOrder[provider] = order.map(id =>
            id === oldModelId ? newModelId : id
          );
        }
      });
    }
  });

  await saveModelConfig(updatedConfig);
  console.log("[Model Config] Applied migrations:", migrations);
}

/**
 * Get endpoint configuration for a provider
 * @param {string} provider - Provider name (lowercase: 'openai', 'ollama')
 * @returns {Object|null} Endpoint configuration object or null if not configured
 */
export function getProviderEndpoint(provider) {
  const config = getModelConfig();
  return config.providerEndpoints?.[provider] || null;
}

/**
 * Save endpoint configuration for a provider
 * @param {string} provider - Provider name (lowercase: 'openai', 'ollama')
 * @param {Object} endpoint - Endpoint configuration {baseURL, enabled}
 */
export async function saveProviderEndpoint(provider, endpoint) {
  const config = getModelConfig();
  const providerEndpoints = {
    ...(config.providerEndpoints || {}),
    [provider]: endpoint
  };
  await saveModelConfig({ ...config, providerEndpoints });
}

/**
 * Get provider display label with appropriate suffix
 * @param {string} provider - Provider name (lowercase)
 * @returns {string} Display label
 */
export function getProviderLabel(provider) {
  const labels = {
    openai: "OpenAI-compatible",
    anthropic: "Anthropic",
    google: "Google",
    deepseek: "DeepSeek",
    grok: "Grok",
    openrouter: "OpenRouter",
    groq: "Groq",
    ollama: "Ollama"
  };
  return labels[provider] || provider;
}

/**
 * Check if a provider supports custom endpoints
 * @param {string} provider - Provider name (lowercase)
 * @returns {boolean} True if provider supports custom endpoints
 */
export function supportsCustomEndpoint(provider) {
  return provider === 'openai' || provider === 'ollama';
}

/**
 * Check if a model is a custom model (user-added, not built-in)
 * @param {string} modelId - Model ID to check
 * @param {string} provider - Provider name (e.g., "OpenAI", "Anthropic")
 * @returns {boolean} True if model is custom
 */
export function isCustomModel(modelId, provider) {
  const modelConfig = getModelConfig();
  const providerKey = provider.toLowerCase();
  const customModels = modelConfig.customModels?.[providerKey] || [];

  // Check if this model exists in the custom models list
  return customModels.some(m => m.id === modelId);
}
