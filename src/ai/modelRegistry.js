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
 * - thinkingDefault: If true, the thinking toggle STARTS ON (user may turn it off).
 * - thinkingOnly: If true, the model CANNOT run without thinking (e.g. Fable 5, o3,
 *     deepseek-reasoner, Gemini 3). The UI hides the enable/disable switch and the
 *     request layer always sends thinking params. Distinct from thinkingDefault,
 *     which is merely the default state of a toggle the user can flip.
 * - thinkingIdSuffix: For models with separate IDs for reasoning/non-reasoning (e.g., Grok)
 * - modelType: Special type like "image-generation"
 * - preferredDefault: If true, this model is the provider's recommended replacement
 *     when the user's default model becomes unavailable (removed model, missing API
 *     key). Without it, the fallback is simply the cheapest available model of the
 *     provider. Use it for models that are cheap AND capable enough to be a good
 *     all-purpose default. At most one per provider is expected; if several are
 *     flagged, the cheapest flagged one wins.
 */

// ==================== MODEL REGISTRY ====================

export const MODEL_REGISTRY = {
  // ==================== OpenAI Models ====================
  "gpt-5.6-sol": {
    id: "gpt-5.6-sol",
    name: "GPT 5.6 Sol",
    provider: "OpenAI",
    contextLength: 1050000,
    maxOutput: 128000,
    pricing: { input: 5, output: 30 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    thinkingDefault: true,
    aliases: ["GPT 5.6 Sol", "gpt-5-6-sol", "gpt-sol-latest"],
  },
  "gpt-5.6-terra": {
    id: "gpt-5.6-terra",
    name: "GPT 5.6 Terra",
    provider: "OpenAI",
    contextLength: 1050000,
    maxOutput: 128000,
    pricing: { input: 2, output: 12 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    thinkingDefault: true,
    aliases: ["GPT 5.6 Terra", "gpt-5-6-terra", "gpt-terra-latest"],
  },
  "gpt-5.6-luna": {
    id: "gpt-5.6-luna",
    name: "GPT 5.6 Luna",
    provider: "OpenAI",
    contextLength: 1050000,
    maxOutput: 128000,
    pricing: { input: 0.2, output: 1.2 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    thinkingDefault: true,
    preferredDefault: true,
    aliases: ["GPT 5.6 Luna", "gpt-5-6-luna", "gpt-luna-latest"],
  },

  "gpt-5-nano": {
    id: "gpt-5-nano",
    name: "GPT-5-nano",
    provider: "OpenAI",
    contextLength: 400000,
    maxOutput: 32000,
    pricing: { input: 0.05, output: 0.4 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: false,
    aliases: [],
  },

  "o4-mini": {
    id: "o4-mini",
    name: "o4 mini",
    provider: "OpenAI",
    contextLength: 200000,
    pricing: { input: 1.1, output: 4.4 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    thinkingDefault: true,
    thinkingOnly: true,
    visibleByDefault: false,
    systemRole: "user",
    aliases: [],
  },

  "o4-mini-deep-research": {
    id: "o4-mini-deep-research",
    name: "o4 mini Deep Research",
    provider: "OpenAI",
    contextLength: 200000,
    maxOutput: 100000,
    pricing: { input: 2, output: 8 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    thinkingDefault: true,
    thinkingOnly: true,
    visibleByDefault: false,
    systemRole: "user",
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
    thinkingDefault: true,
    thinkingOnly: true,
    visibleByDefault: false,
    systemRole: "user",
    aliases: [],
  },

  // OpenAI Image Generation Models
  "gpt-image-2": {
    id: "gpt-image-2",
    name: "GPT Image 2",
    provider: "OpenAI",
    pricing: { input: 5, inputImage: 8, output: 30 },
    capabilities: {
      imageInput: true,
      imageOutput: true,
      editImage: true,
    },
    modelType: "image-generation",
    visibleByDefault: true,
    aliases: [],
  },

  "gpt-image-1.5": {
    id: "gpt-image-1.5",
    name: "GPT Image 1.5",
    provider: "OpenAI",
    pricing: { input: 5, inputImage: 8, output: 32 },
    capabilities: {
      imageInput: true,
      imageOutput: true,
      editImage: true,
    },
    modelType: "image-generation",
    visibleByDefault: false,
    aliases: [],
  },

  "gpt-image-1-mini": {
    id: "gpt-image-1-mini",
    name: "GPT Image 1 mini",
    provider: "OpenAI",
    pricing: { input: 2, inputImage: 2.5, output: 8 },
    capabilities: {
      imageInput: true,
      imageOutput: true,
      // editImage: true,
    },
    modelType: "image-generation",
    visibleByDefault: true,
    aliases: [],
  },

  // ==================== Anthropic Models ====================
  "claude-fable-5": {
    id: "claude-fable-5",
    name: "Claude Fable 5",
    provider: "Anthropic",
    contextLength: 1000000,
    maxOutput: 128000,
    pricing: { input: 10, output: 50 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    thinkingDefault: true,
    thinkingOnly: true,
    visibleByDefault: true,
    aliases: ["claude-fable", "claude fable", "fable-latest"],
  },

  "claude-opus-5": {
    id: "claude-opus-5",
    name: "Claude Opus 5",
    provider: "Anthropic",
    contextLength: 1000000,
    maxOutput: 128000,
    pricing: { input: 5, output: 25 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    thinkingDefault: true,
    visibleByDefault: true,
    aliases: ["claude-5-opus", "claude opus", "claude opus 5", "opus-latest"],
  },

  "claude-opus-4-6": {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    provider: "Anthropic",
    contextLength: 1000000,
    maxOutput: 128000,
    pricing: { input: 5, output: 25 },
    capabilities: {
      thinking: true, // Supports thinking mode (toggled via UI)
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    thinkingDefault: true,
    visibleByDefault: false,
    aliases: ["claude-4.6-opus", "claude opus 4.6"],
  },

  "claude-sonnet-5": {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    provider: "Anthropic",
    contextLength: 1000000,
    maxOutput: 128000,
    pricing: { input: 3, output: 15 },
    capabilities: {
      thinking: true, // Supports thinking mode (toggled via UI)
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    thinkingDefault: true,
    visibleByDefault: true,
    preferredDefault: true,
    aliases: [
      "claude-sonnet",
      "claude-sonnet-5",
      "claude sonnet 5",
      "sonnet-latest",
    ],
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
    aliases: ["claude-haiku-4.5", "claude haiku 4.5", "haiku-latest"],
  },

  // ==================== Google Models ====================
  "gemini-3.1-pro-preview": {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    provider: "Google",
    contextLength: 1048576,
    maxOutput: 65536,
    pricing: { input: 2, output: 12 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
      videoInput: true,
      audioInput: true,
    },
    thinkingDefault: true,
    thinkingOnly: true,
    visibleByDefault: true,
    aliases: ["gemini-3.1-pro", "gemini-pro-latest"],
  },

  "gemini-3.6-flash": {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    provider: "Google",
    contextLength: 1048576,
    maxOutput: 65536,
    pricing: { input: 1.5, output: 7.5 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
      videoInput: true,
      audioInput: true,
    },
    thinkingOnly: true,
    visibleByDefault: true,
    preferredDefault: true,
    aliases: ["gemini-3-6-flash", "gemini-flash-latest"],
  },

  "gemini-3.5-flash-lite": {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash Lite",
    provider: "Google",
    contextLength: 1048576,
    maxOutput: 65536,
    pricing: { input: 0.3, output: 2.5 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
      videoInput: true,
      audioInput: true,
    },
    thinkingOnly: true,
    visibleByDefault: true,
    aliases: ["gemini-3-5-flash-lite", "gemini-lite-latest"],
  },

  // Google Image Generation Models
  "gemini-3.1-flash-image-preview": {
    id: "gemini-3.1-flash-image-preview",
    name: "Nano Banana 2",
    provider: "Google",
    pricing: { input: 0.25, inputImage: 0.25, output: 39 },
    capabilities: {
      imageInput: true,
      imageOutput: true,
      editImage: true,
    },
    modelType: "image-generation",
    visibleByDefault: true,
    aliases: ["nano-banana-2"],
  },

  "gemini-3.1-flash-lite-image": {
    id: "gemini-3.1-flash-lite-image",
    name: "Nano Banana 2 Lite",
    provider: "Google",
    pricing: { input: 0.1, inputImage: 0.1, output: 39 },
    capabilities: {
      imageInput: true,
      imageOutput: true,
      editImage: true,
    },
    modelType: "image-generation",
    visibleByDefault: true,
    aliases: ["nano-banana-2-lite"],
  },

  "gemini-2.5-flash-image": {
    id: "gemini-2.5-flash-image",
    name: "Nano Banana",
    provider: "Google",
    pricing: { input: 0.3, inputImage: 0.3, output: 39 },
    capabilities: {
      imageInput: true,
      imageOutput: true,
      editImage: true,
    },
    modelType: "image-generation",
    visibleByDefault: false,
    aliases: [],
  },

  "gemini-3-pro-image-preview": {
    id: "gemini-3-pro-image-preview",
    name: "Nano Banana Pro",
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
      editImage: true,
    },
    modelType: "image-generation",
    visibleByDefault: true,
    aliases: [],
  },

  // "imagen-4.0-generate-001": {
  //   id: "imagen-4.0-generate-001",
  //   name: "imagen-4.0",
  //   provider: "Google",
  //   pricing: { input: 0, output: 40000 },
  //   capabilities: {
  //     imageOutput: true,
  //   },
  //   modelType: "image-generation",
  //   visibleByDefault: true,
  //   aliases: [],
  // },

  // ==================== DeepSeek Models ====================
  "deepseek-v4-pro": {
    id: "deepseek-v4-pro",
    name: "DeepSeek-V4 Pro",
    provider: "DeepSeek",
    contextLength: 1000000,
    maxOutput: 384000,
    pricing: { input: 1.74, output: 3.48 },
    capabilities: {
      thinking: true,
      imageInput: false,
      fileInput: true,
    },
    thinkingDefault: false,
    visibleByDefault: true,
    aliases: ["deepseek-v4 pro", "deepseek v4 pro", "deepseek-pro-latest"],
  },

  "deepseek-v4-flash": {
    id: "deepseek-v4-flash",
    name: "DeepSeek-V4 Flash",
    provider: "DeepSeek",
    contextLength: 1000000,
    maxOutput: 384000,
    pricing: { input: 0.14, output: 0.28 },
    capabilities: {
      thinking: true,
      imageInput: false,
      fileInput: true,
    },
    thinkingDefault: false,
    visibleByDefault: true,
    aliases: ["deepseek v4 flash", "deepseek-v4", "deepseek-flash-latest"],
  },

  // ==================== Grok Models ====================

  "grok-4.5": {
    id: "grok-4.5",
    name: "Grok 4.5",
    provider: "Grok",
    contextLength: 500000,
    pricing: { input: 2, output: 6 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    // Grok 4.5 is reasoning-only: reasoning_effort "none" returns a 400
    // ("This model does not support reasoning_effort value none"), so thinking
    // can't be turned off — only its level tuned.
    thinkingDefault: true,
    thinkingOnly: true,
    visibleByDefault: true,
    aliases: ["grok-4-5", "grok-4.5", "grok-4", "grok-latest"],
  },

  "grok-4.3": {
    id: "grok-4.3",
    name: "Grok 4.3",
    provider: "Grok",
    contextLength: 1000000,
    pricing: { input: 1.5, output: 2.5 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    visibleByDefault: true,
    thinkingOnly: true,
    aliases: ["grok-4-3"],
  },

  // "grok-4.20": {
  //   id: "grok-4.20",
  //   name: "Grok 4.20",
  //   provider: "Grok",
  //   contextLength: 2000000,
  //   pricing: { input: 2, output: 6 },
  //   capabilities: {
  //     thinking: true,
  //     imageInput: true,
  //     webSearch: true,
  //     fileInput: true,
  //   },
  //   thinkingIdSuffix: { on: "-reasoning", off: "-non-reasoning" },
  //   visibleByDefault: false,
  //   aliases: [],
  // },

  "grok-4.20-multi-agent": {
    id: "grok-4.20-multi-agent",
    name: "Grok 4.20 Multi-agent",
    provider: "Grok",
    contextLength: 2000000,
    pricing: { input: 2, output: 6 },
    capabilities: {
      thinking: true,
      imageInput: true,
      webSearch: true,
      fileInput: true,
    },
    thinkingIdSuffix: { on: "-reasoning", off: "-non-reasoning" },
    visibleByDefault: false,
    aliases: [],
  },

  // Grok Image Generation Model
  "grok-imagine-image": {
    id: "grok-imagine-image",
    name: "Grok Imagine",
    provider: "Grok",
    pricing: { inputImage: 2, output: 20 }, // $0.002 per input image, $0.02 per output image
    capabilities: {
      imageInput: true,
      imageOutput: true,
      editImage: true,
    },
    modelType: "image-generation",
    visibleByDefault: true,
    aliases: [],
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

// ==================== CUSTOM MODEL THINKING ====================
// Custom / dynamic models (native custom endpoints, Groq, Ollama, OpenRouter)
// mostly don't live in MODEL_REGISTRY, so their thinking capability can't be
// read the usual way. This runtime map, populated from user config by
// registerCustomModelThinking(), lets the thinking helpers below recognize
// user-declared reasoning models. Keyed by the model's raw id.
export const CUSTOM_MODEL_THINKING = {}; // id -> { scheme, only, thinkingDefault }

/**
 * Register (or refresh) the thinking config of user-defined custom models.
 * Only models flagged as reasoning models are stored; others are removed so a
 * later un-flag takes effect.
 * @param {Array<{id: string, capabilities?: object, thinkingScheme?: string, thinkingOnly?: boolean, thinkingDefault?: boolean}>} models
 */
export function registerCustomModelThinking(
  models = [],
  { replace = false } = {},
) {
  if (replace) {
    for (const k of Object.keys(CUSTOM_MODEL_THINKING)) {
      delete CUSTOM_MODEL_THINKING[k];
    }
  }
  for (const m of models) {
    if (!m?.id) continue;
    const isThinking = m.capabilities?.thinking === true || !!m.thinkingScheme;
    if (isThinking) {
      CUSTOM_MODEL_THINKING[m.id] = {
        scheme: m.thinkingScheme || "openai-reasoning",
        only: m.thinkingOnly === true,
        // Custom reasoning models default to thinking-on unless told otherwise.
        thinkingDefault: m.thinkingDefault !== false,
      };
    } else {
      delete CUSTOM_MODEL_THINKING[m.id];
    }
  }
}

/**
 * Look up a custom model's thinking config by identifier (strips +thinking).
 * @param {string} identifier
 * @returns {{scheme: string, only: boolean, thinkingDefault: boolean}|null}
 */
export function getCustomModelThinking(identifier) {
  if (!identifier) return null;
  const cleanId = identifier.replace(/\+thinking/i, "").trim();
  if (CUSTOM_MODEL_THINKING[cleanId]) return CUSTOM_MODEL_THINKING[cleanId];
  // Custom models are keyed by their raw id, but chat/menu identifiers may carry
  // a dynamic-provider prefix (openRouter/, groq/, ollama/) — try without it.
  const stripped = cleanId.replace(/^(openRouter|groq|ollama)\//i, "");
  return CUSTOM_MODEL_THINKING[stripped] || null;
}

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

  // Fallback: match models whose ID is a prefix of the identifier
  // Handles thinking-mode suffixes like "grok-4-1-fast-reasoning" -> "grok-4-1-fast"
  for (const model of Object.values(MODEL_REGISTRY)) {
    if (
      model.thinkingIdSuffix &&
      normalized.startsWith(model.id.toLowerCase())
    ) {
      return model;
    }
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
 * Candidate replacement models for a provider, best-first, to be used when the
 * user's default model is no longer available. Models flagged `preferredDefault`
 * come first (cheapest first if several), then all other chat models by ascending
 * price. Image-generation models are excluded — they can never be a text default.
 * Callers still have to keep only the entries actually available (API key present,
 * model visible), since the registry knows nothing about the user's settings.
 * @param {string} provider - Provider name
 * @returns {Object[]} Array of model entries, best candidate first
 */
export function getDefaultModelCandidates(provider) {
  const cost = (m) =>
    typeof m.pricing?.input === "number"
      ? m.pricing.input + (m.pricing.output || 0)
      : Number.POSITIVE_INFINITY;

  return getModelsByProvider(provider)
    .filter(
      (m) => !m.capabilities?.imageOutput && m.modelType !== "image-generation",
    )
    .sort(
      (a, b) =>
        (b.preferredDefault === true) - (a.preferredDefault === true) ||
        cost(a) - cost(b),
    );
}

/**
 * Get API model ID (handles thinking variants and ID suffixes)
 * @param {string} identifier - Model identifier
 * @param {boolean} thinkingEnabled - Whether thinking mode is enabled
 * @returns {string} API model ID
 */
export function getApiModelId(identifier, thinkingEnabled = false) {
  const model = getModelByIdentifier(identifier);
  if (!model) return identifier;

  // Handle models with thinking ID suffixes (e.g., Grok)
  if (model.thinkingIdSuffix) {
    const suffix = thinkingEnabled
      ? model.thinkingIdSuffix.on
      : model.thinkingIdSuffix.off;
    return model.id + suffix;
  }

  return model.id;
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
  if (model?.capabilities?.thinking === true) return true;
  // Custom/dynamic models declared as reasoning models via the config UI.
  return !!getCustomModelThinking(identifier);
}

/**
 * Check if model has thinking enabled by default
 * @param {string} identifier - Model identifier
 * @returns {boolean}
 */
export function hasThinkingDefault(identifier) {
  const model = getModelByIdentifier(identifier);
  return model?.thinkingDefault === true;
}

/**
 * Check if a model can ONLY run with thinking (no way to disable it), e.g.
 * Claude Fable/Mythos 5, OpenAI o-series, deepseek-reasoner, Gemini 3.
 * The UI hides the enable/disable switch and the request layer always sends
 * thinking params for these. This is distinct from hasThinkingDefault(), which
 * is merely the initial state of a toggle the user is free to flip off.
 * @param {string} identifier - Model identifier
 * @returns {boolean}
 */
export function isThinkingOnly(identifier) {
  if (!identifier) return false;
  const cleanId = identifier.replace(/\+thinking/i, "").trim();
  const model = getModelByIdentifier(cleanId);
  if (model?.thinkingOnly === true) return true;
  return getCustomModelThinking(cleanId)?.only === true;
}

/**
 * Check if model uses adaptive thinking (type: "adaptive" + effort parameter)
 * instead of legacy thinking (type: "enabled" + budget_tokens).
 * Claude Opus 4.6+, Opus 5 and Claude Fable/Mythos 5 use adaptive thinking.
 * For Fable/Mythos 5, adaptive is the ONLY supported mode — type: "enabled"
 * and type: "disabled" both return 400 from the API.
 * On Opus 5, type: "enabled" returns 400 too, but type: "disabled" is accepted
 * as long as effort stays at "high" or below (we omit output_config when
 * thinking is off, so the API default of "high" applies).
 * @param {string} identifier - Model identifier
 * @returns {boolean}
 */
export function usesAdaptiveThinking(identifier) {
  if (!identifier) return false;
  // Strip +thinking suffix used by Claude models
  const cleanId = identifier.replace(/\+thinking/i, "").trim();
  const model = getModelByIdentifier(cleanId);
  return (
    model?.id === "claude-opus-4-6" ||
    model?.id === "claude-sonnet-4-6" ||
    model?.id === "claude-opus-4-7" ||
    model?.id === "claude-opus-4-8" ||
    model?.id === "claude-opus-5" ||
    model?.id === "claude-sonnet-5" ||
    model?.id === "claude-fable-5" ||
    model?.id === "claude-mythos-5"
  );
}

/**
 * Check if a model rejects sampling parameters (temperature, top_p, top_k).
 * These return a 400 error on Claude Opus 4.7+, Opus 5, Sonnet 5, and
 * Fable/Mythos 5.
 * NOTE: this is NOT the same set as usesAdaptiveThinking — Opus 4.6 and
 * Sonnet 4.6 use adaptive thinking but still accept a sampling parameter.
 * @param {string} identifier - Model identifier
 * @returns {boolean}
 */
export function rejectsSamplingParams(identifier) {
  if (!identifier) return false;
  // Strip +thinking suffix used by Claude models
  const cleanId = identifier.replace(/\+thinking/i, "").trim();
  const model = getModelByIdentifier(cleanId);
  return (
    model?.id === "claude-opus-4-7" ||
    model?.id === "claude-opus-4-8" ||
    model?.id === "claude-opus-5" ||
    model?.id === "claude-sonnet-5" ||
    model?.id === "claude-fable-5" ||
    model?.id === "claude-mythos-5"
  );
}

/**
 * Get the effort options for a model's thinking mode.
 * Adaptive thinking models use: low, medium, high, max
 * Legacy thinking models use: minimal, low, medium, high, max
 * "max" is mapped per-provider to the highest supported effort/budget
 * (capped at "high" for APIs that don't accept "max" as a discrete level).
 * @param {string} identifier - Model identifier
 * @returns {string[]} Array of effort level strings
 */
export function getThinkingEffortOptions(identifier) {
  if (usesAdaptiveThinking(identifier)) {
    return ["low", "medium", "high", "max"];
  }
  // GPT-5.6 drops "minimal" and adds "xhigh" + a discrete "max" level.
  if (supportsExtendedOpenAIEffort(identifier)) {
    return ["low", "medium", "high", "xhigh", "max"];
  }
  return ["minimal", "low", "medium", "high", "max"];
}

// ==================== THINKING REQUEST SCHEMES ====================
// Every provider/model expresses "reasoning effort" differently. These helpers
// are the SINGLE SOURCE OF TRUTH for that mapping so the raw-API layer
// (aiAPIsHub.js) and the LangChain layer (langraphModelsLoader.ts) can never
// drift apart. Each call site only decides WHERE to place the resolved values
// (top-level option, modelKwargs, thinkingConfig, …); the values themselves —
// and the enable/disable decision — live here.

// Canonical effort levels used across the app: minimal | low | medium | high | max
// Plus "xhigh" (between high and max), offered only by GPT-5.6. Because the
// user's effort is a single global setting, every mapper below must fold
// "xhigh" back to a value its provider actually accepts.

/** Anthropic adaptive: output_config.effort accepts low|medium|high|max (no "minimal"/"xhigh"). */
function toAdaptiveEffort(effort) {
  if (effort === "minimal") return "low";
  if (effort === "xhigh") return "high";
  return effort || "low";
}

/** Anthropic legacy: thinking.budget_tokens. */
function toBudgetTokens(effort) {
  const map = {
    minimal: 1024,
    low: 2500,
    medium: 4096,
    high: 8000,
    xhigh: 12000,
    max: 16000,
  };
  return map[effort] ?? 8000;
}

/**
 * GPT-5.6 family accepts "xhigh" and a discrete "max" reasoning_effort.
 * Accepts any identifier form — id, registry key, display name ("GPT 5.6 Terra")
 * or alias — by resolving to the canonical model id first, then falling back to
 * a raw-string check for dynamic/unregistered ids.
 */
function supportsExtendedOpenAIEffort(identifier) {
  if (!identifier) return false;
  const cleanId = identifier.replace(/\+thinking/i, "").trim();
  const model = getModelByIdentifier(cleanId);
  const id = (model?.id || cleanId).toLowerCase();
  return id.includes("gpt-5.6") || id.includes("gpt-5-6");
}

/**
 * OpenAI reasoning_effort mapping. Baseline GPT-5.x / o-series accept
 * minimal|low|medium|high, so "xhigh"/"max" fold to "high". GPT-5.6 additionally
 * accepts "xhigh" and "max" as discrete levels (and has no "minimal" → "low").
 */
function toOpenAIEffort(effort, modelId) {
  const e = effort || "low";
  if (supportsExtendedOpenAIEffort(modelId)) {
    return e === "minimal" ? "low" : e; // low|medium|high|xhigh|max pass through
  }
  return e === "xhigh" || e === "max" ? "high" : e;
}

/** Grok-4.x reasoning_effort: low (default) | medium | high. */
function toGrokEffort(effort) {
  if (effort === "max" || effort === "xhigh" || effort === "high")
    return "high";
  if (effort === "medium") return "medium";
  return "low";
}

/** OpenRouter unified reasoning.effort: low | medium | high (no minimal/xhigh/max). */
function toOpenRouterEffort(effort) {
  if (effort === "minimal") return "low";
  if (effort === "max" || effort === "xhigh") return "high";
  return effort || "low";
}

/** Gemini thinkingLevel: accepts low|medium|high — with per-model floors. */
function toGeminiLevel(modelId, effort) {
  let level = effort === "max" || effort === "xhigh" ? "high" : effort || "low";
  // Gemini 3(.1) Pro reject "minimal"/"medium"; floor them to "low".
  if (
    modelId === "gemini-3-pro-preview" &&
    (effort === "minimal" || effort === "medium")
  )
    level = "low";
  else if (modelId === "gemini-3.1-pro-preview" && effort === "minimal")
    level = "low";
  return level;
}

/**
 * Decide which "thinking scheme" a model uses. Falls back to id-string
 * heuristics for dynamic/unregistered models (custom OpenRouter, Ollama, …).
 * @param {string} identifier
 * @returns {"anthropic-adaptive"|"anthropic-budget"|"openai-reasoning"|"deepseek-v4"|"gemini"|"grok-effort"|"grok-mini"|"grok-suffix"|"none"}
 */
export function getThinkingScheme(identifier) {
  if (!identifier) return "none";
  const cleanId = identifier.replace(/\+thinking/i, "").trim();

  // A user-declared custom reasoning model wins over any inference.
  const custom = getCustomModelThinking(cleanId);
  if (custom) return custom.scheme;

  const model = getModelByIdentifier(cleanId);

  // An explicit scheme on the registry entry (e.g. auto-detected OpenRouter
  // reasoning models) takes precedence over provider inference.
  if (model?.thinkingScheme) return model.thinkingScheme;

  if (!model) {
    const id = cleanId.toLowerCase();
    if (id.includes("deepseek-v4")) return "deepseek-v4";
    if (id.includes("gpt-5") || id.includes("o3") || id.includes("o4"))
      return "openai-reasoning";
    if (id.includes("grok-3-mini")) return "grok-mini";
    if (id.includes("grok")) return "grok-effort";
    if (id.includes("gemini-3")) return "gemini";
    return "none";
  }

  const id = model.id;
  switch (model.provider) {
    case "Anthropic":
      if (!model.capabilities?.thinking) return "none";
      return usesAdaptiveThinking(id)
        ? "anthropic-adaptive"
        : "anthropic-budget";
    case "OpenAI":
      return model.capabilities?.thinking ? "openai-reasoning" : "none";
    case "DeepSeek":
      // deepseek-reasoner reasons purely by virtue of its id (no params to send).
      return id.includes("deepseek-v4") ? "deepseek-v4" : "none";
    case "Google":
      return model.capabilities?.thinking && id.includes("gemini-3")
        ? "gemini"
        : "none";
    case "Grok":
      if (model.thinkingIdSuffix) return "grok-suffix";
      if (id.includes("grok-3-mini")) return "grok-mini";
      return model.capabilities?.thinking ? "grok-effort" : "none";
    default:
      return "none";
  }
}

/**
 * Resolve the thinking configuration for a single request. Returns provider-
 * logical values (NOT wrapped for any particular SDK); the caller places them
 * into its own option container. Enable/disable honors isThinkingOnly().
 *
 * @param {string} identifier - Model identifier (may carry a "+thinking" suffix)
 * @param {{enabled?: boolean, effort?: string}} opts
 *   - enabled: the user's effective toggle. `undefined` means "no preference"
 *     (matters only for deepseek-v4, whose API default is thinking-on).
 *   - effort: canonical effort level (minimal|low|medium|high|xhigh|max).
 * @returns {{scheme: string, on: boolean, thinking?: object, outputConfig?: object, effort?: string, level?: string, reasoning?: object, think?: boolean}}
 *   - thinking: object to send as the provider's `thinking` param, when applicable.
 *   - outputConfig: Anthropic adaptive `output_config`, when applicable.
 *   - effort: resolved reasoning_effort string (OpenAI/Grok), when applicable.
 *   - level: resolved Gemini thinkingLevel, when applicable.
 *   - reasoning: OpenRouter unified `reasoning` object, when applicable.
 *   - think: Ollama boolean `think`, when applicable.
 */
export function resolveThinkingConfig(identifier, { enabled, effort } = {}) {
  const scheme = getThinkingScheme(identifier);
  const cleanId = (identifier || "").replace(/\+thinking/i, "").trim();
  const model = getModelByIdentifier(cleanId);
  const forced =
    model?.thinkingOnly === true ||
    getCustomModelThinking(cleanId)?.only === true;
  const on = forced || enabled === true;

  switch (scheme) {
    case "anthropic-adaptive":
      // Tri-state: explicit-off → {type:"disabled"}; on → adaptive; no
      // preference (undefined) → omit so the API default (adaptive on) applies.
      if (on)
        return {
          scheme,
          on: true,
          thinking: { type: "adaptive" },
          outputConfig: { effort: toAdaptiveEffort(effort) },
        };
      if (enabled === false)
        return { scheme, on: false, thinking: { type: "disabled" } };
      return { scheme, on: undefined };

    case "anthropic-budget":
      return on
        ? {
            scheme,
            on: true,
            thinking: {
              type: "enabled",
              budget_tokens: toBudgetTokens(effort),
            },
          }
        : { scheme, on: false }; // omit thinking → off (legacy default)

    case "openai-reasoning":
      if (on)
        return { scheme, on: true, effort: toOpenAIEffort(effort, cleanId) };
      // gpt-5.6 accepts an explicit "none" that disables reasoning while staying
      // compatible with function tools on /chat/completions (older OpenAI
      // reasoning models don't take "none", so omit the param for them). Sending
      // "none" also avoids the API applying its default reasoning effort, which
      // would otherwise conflict with bound tools.
      if (supportsExtendedOpenAIEffort(cleanId))
        return { scheme, on: false, effort: "none" };
      return { scheme, on: false };

    case "deepseek-v4":
      // Tri-state: undefined → omit (API default is thinking-on).
      if (enabled === false)
        return { scheme, on: false, thinking: { type: "disabled" } };
      if (enabled === true)
        return {
          scheme,
          on: true,
          thinking: { type: "enabled", effort: effort || "low" },
        };
      return { scheme, on: undefined };

    case "gemini":
      return on
        ? { scheme, on: true, level: toGeminiLevel(cleanId, effort) }
        : { scheme, on: false };

    case "grok-effort":
      return { scheme, on, effort: on ? toGrokEffort(effort) : "none" };

    case "grok-mini":
      return { scheme, on, effort: effort === "high" ? "high" : "low" };

    case "openrouter":
      // OpenRouter unified `reasoning` object. Explicit off disables it.
      if (on)
        return {
          scheme,
          on: true,
          reasoning: { effort: toOpenRouterEffort(effort) },
        };
      if (enabled === false)
        return { scheme, on: false, reasoning: { enabled: false } };
      return { scheme, on: false };

    case "ollama":
      // Ollama uses a top-level boolean `think`. No effort levels.
      if (on) return { scheme, on: true, think: true };
      if (enabled === false) return { scheme, on: false, think: false };
      return { scheme, on: false };

    default:
      return { scheme: "none", on };
  }
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
 * Get the default web search model based on the following logic:
 * 1. If a custom defaultWebSearchModel is set, use it
 * 2. If the default model supports web search, use it
 * 3. Otherwise, find the first visible web search model from the same provider
 * 4. Otherwise, find the first visible web search model from any provider
 * 5. Return null if no web search models are available
 *
 * @param {string|null} defaultModel - The current default model ID
 * @param {Function} isModelVisible - Function to check if a model is visible
 * @param {Array} orderedProviders - Array of providers in user's preferred order
 * @param {Object} modelOrder - Object with provider-specific model ordering
 * @param {string|null} defaultWebSearchModel - The custom default web search model (optional)
 * @returns {string|null} The ID of the default web search model, or null if none available
 */
export function getDefaultWebSearchModel(
  defaultModel,
  isModelVisible,
  orderedProviders,
  modelOrder,
  defaultWebSearchModel = null,
) {
  // Get all web search models
  const webSearchModels = getWebSearchModels();

  // 1. Check if a custom defaultWebSearchModel is set
  if (defaultWebSearchModel) {
    const customModel = getModelByIdentifier(defaultWebSearchModel);
    if (customModel?.capabilities?.webSearch === true) {
      return defaultWebSearchModel;
    }
  }

  // 2. Check if the default model supports web search
  if (defaultModel) {
    const defaultModelEntry = getModelByIdentifier(defaultModel);
    if (defaultModelEntry?.capabilities?.webSearch === true) {
      return defaultModel;
    }

    // 3. Find first visible web search model from the same provider
    const defaultProvider = defaultModelEntry?.provider;
    if (defaultProvider) {
      const sameProviderModels = webSearchModels.filter(
        (m) => m.provider === defaultProvider && isModelVisible(m.name),
      );

      if (sameProviderModels.length > 0) {
        // Sort by custom order if available
        const providerModelOrder = modelOrder?.[defaultProvider];
        if (providerModelOrder && Array.isArray(providerModelOrder)) {
          sameProviderModels.sort((a, b) => {
            const indexA = providerModelOrder.indexOf(a.name);
            const indexB = providerModelOrder.indexOf(b.name);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return a.name.localeCompare(b.name);
          });
        }
        return sameProviderModels[0].id;
      }
    }
  }

  // 4. Find first visible web search model from any provider (in user's provider order)
  for (const provider of orderedProviders) {
    const providerWebSearchModels = webSearchModels.filter(
      (m) => m.provider === provider && isModelVisible(m.name),
    );

    if (providerWebSearchModels.length > 0) {
      // Sort by custom order if available
      const providerModelOrder = modelOrder?.[provider];
      if (providerModelOrder && Array.isArray(providerModelOrder)) {
        providerWebSearchModels.sort((a, b) => {
          const indexA = providerModelOrder.indexOf(a.name);
          const indexB = providerModelOrder.indexOf(b.name);
          if (indexA !== -1 && indexB !== -1) return indexA - indexB;
          if (indexA !== -1) return -1;
          if (indexB !== -1) return 1;
          return a.name.localeCompare(b.name);
        });
      }
      return providerWebSearchModels[0].id;
    }
  }

  // 5. No visible web search models available
  return null;
}

// ==================== COMPLETION FUNCTION HELPERS ====================

/**
 * Get maximum output tokens for a model
 * @param {string} identifier - Model identifier
 * @returns {number} Max output tokens (default: 8192)
 */
export function getMaxOutput(identifier) {
  const model = getModelByIdentifier(identifier);
  return model?.maxOutput || 8192;
}

/**
 * Check if model supports streaming
 * @param {string} identifier - Model identifier
 * @returns {boolean} True if streaming is supported (default: true)
 */
export function supportsStreaming(identifier) {
  const model = getModelByIdentifier(identifier);
  return model?.noStreaming !== true;
}

/**
 * Get system message role for a model
 * Some models (o1, o3, o4) require "user" role, o3-pro requires "developer"
 * @param {string} identifier - Model identifier
 * @returns {string} Role: "system" | "user" | "developer"
 */
export function getSystemRole(identifier) {
  const model = getModelByIdentifier(identifier);
  return model?.systemRole || "system";
}

/**
 * Check if model should use legacy Completion API instead of Response API
 * @param {string} identifier - Model identifier
 * @returns {boolean} True if should use Completion API (default: false, use Response API)
 */
export function useCompletionApi(identifier) {
  const model = getModelByIdentifier(identifier);
  return model?.useCompletionApi === true;
}

/**
 * Get temperature configuration for a model based on provider
 * OpenAI uses 2.0 scale with 1.3 max, others use 1.0 scale with 2.0 max
 * @param {string} identifier - Model identifier
 * @returns {Object} { scale: number, max: number }
 */
export function getTemperatureConfig(identifier) {
  const model = getModelByIdentifier(identifier);
  if (model?.provider === "OpenAI") {
    return { scale: 2.0, max: 1.3 };
  }
  return { scale: 1.0, max: 2.0 };
}

/**
 * Check if model supports web search via Response API built-in tool
 * Most OpenAI models support this, except:
 * - gpt-4.1-nano
 * - gpt-5 with minimal reasoning (handled at runtime)
 * Note: Web search context is limited to 128k even for larger context models
 * @param {string} identifier - Model identifier
 * @returns {boolean}
 */
export function supportsResponseApiWebSearch(identifier) {
  const model = getModelByIdentifier(identifier);
  if (!model || model.provider !== "OpenAI") return false;

  // Exclusion list - models that don't support Response API web search
  const excludedModels = ["gpt-4.1-nano"];
  if (excludedModels.includes(model.id)) return false;

  // Image generation models don't support web search
  if (model.modelType === "image-generation") return false;

  return true;
}

/**
 * Get all OpenAI models that support web search via Response API
 * Returns models that can use web_search_preview tool
 * @param {boolean} excludeDedicatedSearch - If true, excludes models with dedicated webSearch capability
 * @returns {Object[]} Array of model entries with registry keys
 */
export function getResponseApiWebSearchModels(excludeDedicatedSearch = true) {
  return Object.entries(MODEL_REGISTRY)
    .filter(([_, m]) => {
      if (m.provider !== "OpenAI") return false;
      if (m.modelType === "image-generation") return false;
      if (excludeDedicatedSearch && m.capabilities?.webSearch) return false;
      if (["gpt-4.1-nano"].includes(m.id)) return false;
      return true;
    })
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
export function unregisterOpenRouterModel(modelId) {
  const key = `openRouter/${modelId}`;
  delete MODEL_REGISTRY[key];
}

export function registerOpenRouterModels(modelsInfo) {
  for (const model of modelsInfo) {
    const key = `openRouter/${model.id}`;
    if (!MODEL_REGISTRY[key]) {
      // Auto-detect reasoning support from OpenRouter's supported_parameters.
      const supportsReasoning = (model.supportedParameters || []).includes(
        "reasoning",
      );
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
          webSearch: true, // All OpenRouter models support web search via :online suffix
          ...(supportsReasoning ? { thinking: true } : {}),
        },
        // Reasoning is off by default (opt-in per model via the toggle/dialog),
        // and sent through OpenRouter's unified `reasoning` param.
        ...(supportsReasoning ? { thinkingScheme: "openrouter" } : {}),
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
