/**
 * Unified Model Registry - Single Source of Truth
 *
 * This file contains the complete registry of all pre-defined models.
 * Adding a new model requires only adding an entry here.
 *
 * Model entry structure:
 * - id: API model ID (required)
 * - name: Display name in menu (required)
 * - provider: Provider name (required)
 * - contextLength: Token context window
 * - maxOutput: Maximum output tokens (optional)
 * - pricing: { input, output, inputImage?, outputImage? } - $/1M tokens
 * - capabilities: { thinking, imageInput, imageOutput, webSearch, fileInput, videoInput, audioInput }
 * - visibleByDefault: Show in menu by default
 * - aliases: Alternative identifiers for matching
 * - thinkingVariant: Flag for thinking mode activation
 * - modelType: Special type like "image-generation"
 */

// ==================== MODEL REGISTRY ====================

export const MODEL_REGISTRY = {
  // ==================== OpenAI Models ====================
  "gpt-5.2": {
    id: "gpt-5.2",
    name: "gpt-5.2",
    provider: "OpenAI",
    contextLength: 400000,
    maxOutput: 32000,
    pricing: { input: 1.75, output: 14 },
    capabilities: {
      thinking: false,
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: ["gpt5.2", "gpt-5-2", "gpt-5.2-chat-latest"],
  },

  "gpt-5.1": {
    id: "gpt-5.1",
    name: "gpt-5.1",
    provider: "OpenAI",
    contextLength: 400000,
    maxOutput: 32000,
    pricing: { input: 1.25, output: 10 },
    capabilities: {
      thinking: false,
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: ["gpt5.1", "gpt-5-1", "gpt-5.1-chat-latest"],
  },

  "gpt-5.1 reasoning": {
    id: "gpt-5.1",
    name: "gpt-5.1 reasoning",
    provider: "OpenAI",
    contextLength: 400000,
    maxOutput: 32000,
    pricing: { input: 1.25, output: 10 },
    capabilities: {
      thinking: true,
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: [],
  },

  "gpt-5": {
    id: "gpt-5",
    name: "gpt-5",
    provider: "OpenAI",
    contextLength: 400000,
    maxOutput: 32000,
    pricing: { input: 1.25, output: 10 },
    capabilities: {
      thinking: true,
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: ["gpt-5-chat-latest"],
  },

  "gpt-5-mini": {
    id: "gpt-5-mini",
    name: "gpt-5-mini",
    provider: "OpenAI",
    contextLength: 400000,
    maxOutput: 32000,
    pricing: { input: 0.25, output: 2 },
    capabilities: {
      thinking: true,
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: ["gpt-5.1-mini"],
  },

  "gpt-5-nano": {
    id: "gpt-5-nano",
    name: "gpt-5-nano",
    provider: "OpenAI",
    contextLength: 400000,
    maxOutput: 32000,
    pricing: { input: 0.05, output: 0.4 },
    capabilities: {
      thinking: true,
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: [],
  },

  "gpt-5-search-api": {
    id: "gpt-5-search-api",
    name: "gpt-5-search-api",
    provider: "OpenAI",
    contextLength: 128000,
    pricing: { input: 1.25, output: 10 },
    capabilities: {
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: ["gpt-5-search"],
  },

  "gpt-4.1": {
    id: "gpt-4.1",
    name: "gpt-4.1",
    provider: "OpenAI",
    contextLength: 1047576,
    pricing: { input: 2, output: 8 },
    capabilities: {
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: [],
  },

  "gpt-4.1-mini": {
    id: "gpt-4.1-mini",
    name: "gpt-4.1-mini",
    provider: "OpenAI",
    contextLength: 1047576,
    pricing: { input: 0.4, output: 1.6 },
    capabilities: {
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: [],
  },

  "gpt-4.1-nano": {
    id: "gpt-4.1-nano",
    name: "gpt-4.1-nano",
    provider: "OpenAI",
    contextLength: 1047576,
    pricing: { input: 0.1, output: 0.4 },
    capabilities: {
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: [],
  },

  "gpt-4o": {
    id: "gpt-4o",
    name: "gpt-4o",
    provider: "OpenAI",
    contextLength: 131073,
    pricing: { input: 2.5, output: 10 },
    capabilities: {
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: ["gpt-4o-2024-08-06"],
  },

  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    name: "gpt-4o-mini",
    provider: "OpenAI",
    contextLength: 131073,
    pricing: { input: 0.15, output: 0.6 },
    capabilities: {
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: ["gpt-4o-mini-2024-07-18"],
  },

  "gpt-4o-mini-search": {
    id: "gpt-4o-mini-search-preview",
    name: "gpt-4o-mini-search",
    provider: "OpenAI",
    contextLength: 128000,
    pricing: { input: 0.15, output: 0.6 },
    capabilities: {
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: ["gpt-4o-mini-search-preview"],
  },

  "gpt-4o-search": {
    id: "gpt-4o-search-preview",
    name: "gpt-4o-search",
    provider: "OpenAI",
    contextLength: 128000,
    pricing: { input: 2.5, output: 10 },
    capabilities: {
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: ["gpt-4o-search-preview"],
  },

  "o4-mini": {
    id: "o4-mini",
    name: "o4-mini",
    provider: "OpenAI",
    contextLength: 200000,
    pricing: { input: 1.1, output: 4.4 },
    capabilities: {
      thinking: true,
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: [],
  },

  o3: {
    id: "o3",
    name: "o3",
    provider: "OpenAI",
    contextLength: 200000,
    pricing: { input: 2, output: 8 },
    capabilities: {
      thinking: true,
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: [],
  },

  "o3-pro": {
    id: "o3-pro",
    name: "o3-pro",
    provider: "OpenAI",
    contextLength: 200000,
    pricing: { input: 20, output: 80 },
    capabilities: {
      thinking: true,
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: [],
  },

  "o3-mini": {
    id: "o3-mini",
    name: "o3-mini",
    provider: "OpenAI",
    contextLength: 200000,
    pricing: { input: 1.1, output: 4.4 },
    capabilities: {
      thinking: true,
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: [],
  },

  o1: {
    id: "o1",
    name: "o1",
    provider: "OpenAI",
    contextLength: 200000,
    pricing: { input: 15, output: 60 },
    capabilities: {
      thinking: true,
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: [],
  },

  // OpenAI Image Generation Models
  "gpt-image-1-mini": {
    id: "gpt-image-1-mini",
    name: "gpt-image-1-mini",
    provider: "OpenAI",
    pricing: { input: 2, inputImage: 2.5, output: 8 },
    capabilities: {
      imageInput: true,
      imageOutput: true,
    },
    modelType: "image-generation",
    visibleByDefault: true,
    aliases: [],
  },

  "gpt-image-1": {
    id: "gpt-image-1",
    name: "gpt-image-1",
    provider: "OpenAI",
    pricing: { input: 5, inputImage: 10, output: 40 },
    capabilities: {
      imageInput: true,
      imageOutput: true,
    },
    modelType: "image-generation",
    visibleByDefault: true,
    aliases: [],
  },

  // ==================== Anthropic Models ====================
  "claude-opus-4-5-20251101": {
    id: "claude-opus-4-5-20251101",
    name: "Claude Opus 4.5",
    provider: "Anthropic",
    contextLength: 200000,
    maxOutput: 32000,
    pricing: { input: 5, output: 25 },
    capabilities: {
      thinking: true, // Supports thinking mode (toggled via UI)
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: [
      "claude-4.5-opus",
      "claude opus",
      "claude opus 4.5",
      "claude-opus-4-5",
    ],
  },

  "claude-opus-4-1-20250805": {
    id: "claude-opus-4-1-20250805",
    name: "Claude Opus 4.1",
    provider: "Anthropic",
    contextLength: 200000,
    maxOutput: 32000,
    pricing: { input: 15, output: 75 },
    capabilities: {
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: ["claude-4.1-opus", "claude opus 4.1"],
  },

  "claude-sonnet-4-5-20250929": {
    id: "claude-sonnet-4-5-20250929",
    name: "Claude Sonnet 4.5",
    provider: "Anthropic",
    contextLength: 200000,
    maxOutput: 64000,
    pricing: { input: 3, output: 15 },
    capabilities: {
      thinking: true, // Supports thinking mode (toggled via UI)
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: [
      "claude-sonnet",
      "claude-sonnet-4.5",
      "claude-sonnet-4-5",
      "claude sonnet 4.5",
    ],
  },

  "claude-sonnet-4-20250514": {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "Anthropic",
    contextLength: 200000,
    maxOutput: 64000,
    pricing: { input: 3, output: 15 },
    capabilities: {
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: ["claude-sonnet-4", "claude sonnet 4"],
  },

  "claude-3-7-sonnet-20250219": {
    id: "claude-3-7-sonnet-20250219",
    name: "Claude Sonnet 3.7",
    provider: "Anthropic",
    contextLength: 200000,
    maxOutput: 64000,
    pricing: { input: 3, output: 15 },
    capabilities: {
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: ["claude-sonnet-3.7", "claude sonnet 3.7"],
  },

  "claude-3-5-sonnet-20241022": {
    id: "claude-3-5-sonnet-20241022",
    name: "Claude Sonnet 3.5",
    provider: "Anthropic",
    contextLength: 200000,
    maxOutput: 8192,
    pricing: { input: 3, output: 15 },
    capabilities: {
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: ["claude-sonnet-3.5", "claude sonnet 3.5"],
  },

  "claude-haiku-4-5-20251001": {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    contextLength: 200000,
    maxOutput: 8192,
    pricing: { input: 1, output: 5 },
    capabilities: {
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: ["claude-haiku-4.5", "claude haiku 4.5"],
  },

  "claude-3-5-haiku-20241022": {
    id: "claude-3-5-haiku-20241022",
    name: "Claude Haiku 3.5",
    provider: "Anthropic",
    contextLength: 200000,
    maxOutput: 8192,
    pricing: { input: 0.8, output: 4 },
    capabilities: {
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: ["claude-haiku-3.5", "claude haiku 3.5"],
  },

  "claude-3-haiku-20240307": {
    id: "claude-3-haiku-20240307",
    name: "Claude Haiku",
    provider: "Anthropic",
    contextLength: 200000,
    maxOutput: 4096,
    pricing: { input: 0.25, output: 1.25 },
    capabilities: {
      imageInput: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: ["claude-haiku", "claude haiku"],
  },

  // ==================== Google Models ====================
  "gemini-3-pro-preview": {
    id: "gemini-3-pro-preview",
    name: "gemini-3-pro-preview",
    provider: "Google",
    contextLength: 1048576,
    pricing: { input: 2, output: 12 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
      videoInput: true,
      audioInput: true,
    },
    visibleByDefault: true,
    aliases: ["gemini-3-pro"],
  },

  "gemini-2.5-pro": {
    id: "gemini-2.5-pro",
    name: "gemini-2.5-pro",
    provider: "Google",
    contextLength: 1048576,
    pricing: { input: 1.25, output: 10 },
    capabilities: {
      imageInput: true,
      webSearch: true,
      fileInput: true,
      videoInput: true,
      audioInput: true,
    },
    visibleByDefault: true,
    aliases: [],
  },

  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    name: "gemini-2.5-flash",
    provider: "Google",
    contextLength: 1048576,
    pricing: { input: 0.3, output: 2.5 },
    capabilities: {
      imageInput: true,
      webSearch: true,
      fileInput: true,
      videoInput: true,
      audioInput: true,
    },
    visibleByDefault: true,
    aliases: [],
  },

  "gemini-2.5-flash-lite": {
    id: "gemini-2.5-flash-lite",
    name: "gemini-2.5-flash-lite",
    provider: "Google",
    contextLength: 1048576,
    pricing: { input: 0.1, output: 0.4 },
    capabilities: {
      imageInput: true,
      webSearch: true,
      fileInput: true,
      videoInput: true,
      audioInput: true,
    },
    visibleByDefault: true,
    aliases: [],
  },

  // Google Image Generation Models
  "gemini-2.5-flash-image": {
    id: "gemini-2.5-flash-image",
    name: "gemini-2.5-flash-image",
    provider: "Google",
    pricing: { input: 0.3, inputImage: 0.3, output: 39 },
    capabilities: {
      imageInput: true,
      imageOutput: true,
    },
    modelType: "image-generation",
    visibleByDefault: true,
    aliases: [],
  },

  "gemini-3-pro-image-preview": {
    id: "gemini-3-pro-image-preview",
    name: "gemini-3-pro-image-preview",
    provider: "Google",
    pricing: {
      input: 2.0,
      inputImage: 1.1,
      output: 12.0,
      outputImage1k: 134.0,
      outputImage2k: 134.0,
      outputImage4k: 240.0,
    },
    capabilities: {
      imageInput: true,
      imageOutput: true,
    },
    modelType: "image-generation",
    visibleByDefault: true,
    aliases: [],
  },

  "imagen-4.0-generate-001": {
    id: "imagen-4.0-generate-001",
    name: "imagen-4.0-generate-001",
    provider: "Google",
    pricing: { input: 0, output: 40000 },
    capabilities: {
      imageOutput: true,
    },
    modelType: "image-generation",
    visibleByDefault: true,
    aliases: [],
  },

  "imagen-4.0-fast-generate-001": {
    id: "imagen-4.0-fast-generate-001",
    name: "imagen-4.0-fast-generate-001",
    provider: "Google",
    pricing: { input: 0, output: 20000 },
    capabilities: {
      imageOutput: true,
    },
    modelType: "image-generation",
    visibleByDefault: false,
    aliases: [],
  },

  "imagen-4.0-ultra-generate-001": {
    id: "imagen-4.0-ultra-generate-001",
    name: "imagen-4.0-ultra-generate-001",
    provider: "Google",
    pricing: { input: 0, output: 60000 },
    capabilities: {
      imageOutput: true,
    },
    modelType: "image-generation",
    visibleByDefault: false,
    aliases: [],
  },

  // ==================== DeepSeek Models ====================
  "deepseek-chat": {
    id: "deepseek-chat",
    name: "DeepSeek-V3.2",
    provider: "DeepSeek",
    contextLength: 128000,
    pricing: { input: 0.28, output: 0.42 },
    capabilities: {
      imageInput: false,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: ["deepseek-v3.2", "deepseek v3.2", "deepseek-v3"],
  },

  "deepseek-reasoner": {
    id: "deepseek-reasoner",
    name: "DeepSeek-V3.2 Thinking",
    provider: "DeepSeek",
    contextLength: 128000,
    pricing: { input: 0.28, output: 0.42 },
    capabilities: {
      thinking: true,
      imageInput: false,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: ["deepseek-v3.2 thinking", "deepseek v3.2 thinking"],
    thinkingVariant: true,
  },

  // ==================== Grok Models ====================
  "grok-4": {
    id: "grok-4",
    name: "Grok-4",
    provider: "Grok",
    contextLength: 256000,
    pricing: { input: 3, output: 15 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: [],
  },

  "grok-4-1-fast-reasoning": {
    id: "grok-4-1-fast-reasoning",
    name: "Grok-4-1-fast-reasoning",
    provider: "Grok",
    contextLength: 2000000,
    pricing: { input: 0.2, output: 0.5 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: [],
  },

  "grok-4-1-fast-non-reasoning": {
    id: "grok-4-1-fast-non-reasoning",
    name: "Grok-4-1-fast-non-reasoning",
    provider: "Grok",
    contextLength: 2000000,
    pricing: { input: 0.2, output: 0.5 },
    capabilities: {
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: [],
  },

  "grok-3": {
    id: "grok-3",
    name: "Grok-3",
    provider: "Grok",
    contextLength: 131072,
    pricing: { input: 3, output: 15 },
    capabilities: {
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: [],
  },

  "grok-3-mini": {
    id: "grok-3-mini",
    name: "Grok-3-mini",
    provider: "Grok",
    contextLength: 131072,
    pricing: { input: 0.3, output: 0.5 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: [],
  },

  "grok-3-mini-fast": {
    id: "grok-3-mini-fast",
    name: "Grok-3-mini-fast",
    provider: "Grok",
    contextLength: 131072,
    pricing: { input: 0.6, output: 4 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: [],
  },

  "grok-3-mini-high": {
    id: "grok-3-mini-high",
    name: "Grok-3-mini-high",
    provider: "Grok",
    contextLength: 131072,
    pricing: { input: 0.3, output: 0.5 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: [],
  },

  "grok-3-fast": {
    id: "grok-3-fast",
    name: "Grok-3-fast",
    provider: "Grok",
    contextLength: 131072,
    pricing: { input: 5, output: 25 },
    capabilities: {
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    aliases: [],
  },

  "grok-2-vision-1212": {
    id: "grok-2-vision-1212",
    name: "Grok-2 Vision",
    provider: "Grok",
    contextLength: 32768,
    pricing: { input: 2, output: 10 },
    capabilities: {
      imageInput: true,
      webSearch: true,
    },
    visibleByDefault: true,
    aliases: ["grok-2-vision", "grok-2 vision"],
  },

  "grok-2-1212": {
    id: "grok-2-1212",
    name: "Grok-2",
    provider: "Grok",
    contextLength: 131072,
    pricing: { input: 2, output: 10 },
    capabilities: {
      imageInput: true,
      webSearch: true,
    },
    visibleByDefault: false,
    aliases: ["grok-2"],
  },
};

// ==================== PROVIDER LIBRARIES ====================
// Set at runtime by index.js
export const PROVIDER_LIBRARIES = {
  OpenAI: null,
  Anthropic: null,
  Google: null,
  DeepSeek: null,
  Grok: null,
  OpenRouter: null,
  Groq: null,
  Ollama: null,
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Get model entry by any identifier (ID, name, or alias)
 * @param {string} identifier - Model ID, name, or alias
 * @returns {Object|null} Model entry or null
 */
export function getModelByIdentifier(identifier) {
  if (!identifier) return null;
  const normalized = identifier.toLowerCase().trim();

  // Direct lookup by key
  if (MODEL_REGISTRY[identifier]) {
    return MODEL_REGISTRY[identifier];
  }

  // Search by ID, name, or alias
  for (const [key, model] of Object.entries(MODEL_REGISTRY)) {
    if (key.toLowerCase() === normalized) return model;
    if (model.id.toLowerCase() === normalized) return model;
    if (model.name.toLowerCase() === normalized) return model;
    if (model.aliases?.some((a) => a.toLowerCase() === normalized))
      return model;
  }

  return null;
}

/**
 * Get all models for a provider
 * @param {string} provider - Provider name
 * @returns {Object[]} Array of model entries
 */
export function getModelsByProvider(provider) {
  return Object.entries(MODEL_REGISTRY)
    .filter(([_, m]) => m.provider === provider)
    .map(([key, m]) => ({ ...m, registryKey: key }));
}

/**
 * Get API model ID (handles thinking variants)
 * @param {string} identifier - Model identifier
 * @returns {string} API model ID
 */
export function getApiModelId(identifier) {
  const model = getModelByIdentifier(identifier);
  return model?.id || identifier;
}

/**
 * Get display name for a model
 * @param {string} identifier - Model identifier
 * @returns {string} Display name
 */
export function getDisplayName(identifier) {
  const model = getModelByIdentifier(identifier);
  return model?.name || identifier;
}

/**
 * Check if model has a specific capability
 * @param {string} identifier - Model identifier
 * @param {string} capability - Capability name
 * @returns {boolean}
 */
export function hasCapability(identifier, capability) {
  const model = getModelByIdentifier(identifier);
  return model?.capabilities?.[capability] === true;
}

/**
 * Get models with a specific capability
 * @param {string} capability - Capability name
 * @returns {Object[]} Array of model entries with registry keys
 */
export function getModelsWithCapability(capability) {
  return Object.entries(MODEL_REGISTRY)
    .filter(([_, m]) => m.capabilities?.[capability] === true)
    .map(([key, m]) => ({ ...m, registryKey: key }));
}

/**
 * Get context length for a model
 * @param {string} identifier - Model identifier
 * @returns {number|null}
 */
export function getContextLength(identifier) {
  const model = getModelByIdentifier(identifier);
  return model?.contextLength || null;
}

/**
 * Get pricing for a model
 * @param {string} identifier - Model identifier
 * @returns {Object|null} Pricing object
 */
export function getPricing(identifier) {
  const model = getModelByIdentifier(identifier);
  return model?.pricing || null;
}

/**
 * Determine provider from model identifier
 * @param {string} identifier - Model identifier
 * @returns {string|null} Provider name
 */
export function getProvider(identifier) {
  const model = getModelByIdentifier(identifier);
  return model?.provider || null;
}

/**
 * Check if model is a thinking/reasoning model
 * @param {string} identifier - Model identifier
 * @returns {boolean}
 */
export function isThinkingModel(identifier) {
  const model = getModelByIdentifier(identifier);
  return (
    model?.capabilities?.thinking === true || model?.thinkingVariant === true
  );
}

/**
 * Get all image generation models
 * @returns {Object[]}
 */
export function getImageGenerationModels() {
  return Object.entries(MODEL_REGISTRY)
    .filter(([_, m]) => m.capabilities?.imageOutput === true)
    .map(([key, m]) => ({ ...m, registryKey: key }));
}

/**
 * Get all web search capable models
 * @returns {Object[]}
 */
export function getWebSearchModels() {
  return Object.entries(MODEL_REGISTRY)
    .filter(([_, m]) => m.capabilities?.webSearch === true)
    .map(([key, m]) => ({ ...m, registryKey: key }));
}

/**
 * Get provider prefix for routing
 * @param {string} provider - Provider name
 * @returns {string} Prefix for model ID
 */
export function getProviderPrefix(provider) {
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
}

/**
 * Register dynamic models from OpenRouter
 * @param {Array} modelsInfo - Array of model info objects from OpenRouter API
 */
export function registerOpenRouterModels(modelsInfo) {
  for (const model of modelsInfo) {
    const key = `openRouter/${model.id}`;
    if (!MODEL_REGISTRY[key]) {
      MODEL_REGISTRY[key] = {
        id: model.id,
        name: model.name,
        provider: "OpenRouter",
        contextLength: model.contextLength * 1024,
        pricing: {
          input: model.promptPricing,
          output: model.completionPricing,
          inputImage: model.imagePricing,
        },
        capabilities: {
          imageInput: model.imagePricing > 0,
        },
        visibleByDefault: false,
        isDynamic: true,
        aliases: [],
      };
    }
  }
}

/**
 * Register dynamic models from Groq
 * @param {Array} models - Array of model IDs
 */
export function registerGroqModels(models) {
  for (const modelId of models) {
    const key = `groq/${modelId}`;
    if (!MODEL_REGISTRY[key]) {
      MODEL_REGISTRY[key] = {
        id: modelId,
        name: modelId,
        provider: "Groq",
        capabilities: {},
        visibleByDefault: false,
        isDynamic: true,
        aliases: [],
      };
    }
  }
}

/**
 * Register dynamic models from Ollama
 * @param {Array} models - Array of model IDs
 */
export function registerOllamaModels(models) {
  for (const modelId of models) {
    const key = `ollama/${modelId}`;
    if (!MODEL_REGISTRY[key]) {
      MODEL_REGISTRY[key] = {
        id: modelId,
        name: modelId,
        provider: "Ollama",
        capabilities: {},
        visibleByDefault: false,
        isDynamic: true,
        aliases: [],
      };
    }
  }
}

// ==================== REMOTE MODEL UPDATES ====================

const REMOTE_MODELS_URL =
  "https://raw.githubusercontent.com/fbgallet/roam-extension-speech-to-roam/main/model-updates.json";

/**
 * Fetch and merge remote models into registry
 * Allows adding new models without app release
 */
export async function loadRemoteModelUpdates() {
  try {
    const response = await fetch(REMOTE_MODELS_URL);
    if (!response.ok) {
      console.log("No remote model updates available");
      return;
    }
    const remoteModels = await response.json();

    let count = 0;
    for (const [key, model] of Object.entries(remoteModels.models || {})) {
      if (!MODEL_REGISTRY[key]) {
        MODEL_REGISTRY[key] = { ...model, isRemote: true };
        count++;
      }
    }

    if (count > 0) {
      console.log(`Loaded ${count} remote model updates`);
    }
  } catch (error) {
    console.log("Could not fetch remote model updates:", error.message);
  }
}

// ==================== COMPATIBILITY FUNCTIONS ====================

/**
 * Get available models for a provider (replaces getAvailableModels in modelsInfo.js)
 * Returns array of model names for menu display
 * @param {string} provider - Provider name
 * @returns {string[]} Array of model names
 */
export function getAvailableModelsFromRegistry(provider) {
  return getModelsByProvider(provider)
    .filter((m) => m.visibleByDefault !== false)
    .map((m) => m.name);
}

/**
 * Get LlmInfos object for langgraph agents
 * @param {string} modelIdentifier - Model identifier
 * @returns {Object|null} LlmInfos object compatible with langraphModelsLoader.ts
 */
export function getLlmInfosForAgent(modelIdentifier) {
  const entry = getModelByIdentifier(modelIdentifier);
  if (!entry) return null;

  return {
    provider: entry.provider,
    prefix: getProviderPrefix(entry.provider),
    id: entry.id,
    name: entry.name,
    library: PROVIDER_LIBRARIES[entry.provider],
    thinking: entry.capabilities?.thinking || entry.thinkingVariant || false,
    tokensLimit: entry.contextLength || 128000,
  };
}
