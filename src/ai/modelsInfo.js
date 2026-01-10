import {
  extensionStorage,
  openAiCustomModels,
  openRouterModels,
  openRouterModelsInfo,
  websearchContext,
} from "..";
import axios from "axios";
import {
  MODEL_REGISTRY,
  getModelsByProvider,
  getModelByIdentifier,
  getContextLength,
  getPricing,
} from "./modelRegistry";

// ==================== AVAILABLE MODELS ====================
// Derived from MODEL_REGISTRY - maintains backward compatibility

export const getAvailableModels = (provider) => {
  const registryModels = getModelsByProvider(provider)
    .filter((m) => m.visibleByDefault !== false)
    .map((m) => m.name);

  // Add custom models for OpenAI
  if (provider === "OpenAI" && openAiCustomModels?.length) {
    return registryModels.concat(openAiCustomModels);
  }

  return registryModels;
};

// ==================== CAPABILITY ARRAYS ====================
// Derived from MODEL_REGISTRY capabilities

export const imageGenerationModels = Object.entries(MODEL_REGISTRY)
  .filter(([_, m]) => m.capabilities?.imageOutput === true)
  .map(([_, m]) => m.id);

export const webSearchModels = Object.entries(MODEL_REGISTRY)
  .filter(([_, m]) => m.capabilities?.webSearch === true)
  .map(([_, m]) => m.id);

// ==================== TOKEN LIMITS ====================
// Proxy object that reads from MODEL_REGISTRY

const tokensLimitHandler = {
  get(target, prop) {
    // Handle special cases
    if (prop === "custom") return undefined;

    // Try to get from registry
    const contextLength = getContextLength(prop);
    if (contextLength) return contextLength;

    // Fallback to static values for aliases not in registry
    const staticFallbacks = {
      "gpt-5-chat-latest": 400000,
      "gpt-5.1-chat-latest": 400000,
    };
    return staticFallbacks[prop] || undefined;
  },
  has(target, prop) {
    return getModelByIdentifier(prop) !== null;
  },
  ownKeys() {
    return Object.keys(MODEL_REGISTRY);
  },
  getOwnPropertyDescriptor(target, prop) {
    if (getModelByIdentifier(prop)) {
      return { enumerable: true, configurable: true };
    }
    return undefined;
  },
};

export const tokensLimit = new Proxy({}, tokensLimitHandler);

// ==================== PRICING ====================
// Proxy object that reads from MODEL_REGISTRY

const modelsPricingHandler = {
  get(target, prop) {
    const pricing = getPricing(prop);
    if (pricing) {
      // Convert from registry format to legacy format
      const result = {
        input: pricing.input,
        output: pricing.output,
      };
      if (pricing.inputImage) result.input_image = pricing.inputImage;
      if (pricing.outputImage1k) result.output_image_1k = pricing.outputImage1k;
      if (pricing.outputImage2k) result.output_image_2k = pricing.outputImage2k;
      if (pricing.outputImage4k) result.output_image_4k = pricing.outputImage4k;
      return result;
    }
    return undefined;
  },
  has(target, prop) {
    return getPricing(prop) !== null;
  },
  ownKeys() {
    return Object.keys(MODEL_REGISTRY);
  },
  getOwnPropertyDescriptor(target, prop) {
    if (getPricing(prop)) {
      return { enumerable: true, configurable: true };
    }
    return undefined;
  },
};

export const modelsPricing = new Proxy({}, modelsPricingHandler);

// Deprecated for now on OpenAI API
// export const additionalPricingPerRequest = {
//   "gpt-5-search-api": 0.01,
//   "gpt-4o-mini-search-preview-low": 0.025,
//   "gpt-4o-mini-search-preview-medium": 0.0275,
//   "gpt-4o-mini-search-preview-high": 0.03,
//   "gpt-4o-search-preview-low": 0.03,
//   "gpt-4o-search-preview-medium": 0.035,
//   "gpt-4o-search-preview-high": 0.05,
// };

// function getAdditionalPricingPerRequest(model, level) {
//   const additionalPricing =
//     additionalPricingPerRequest[`${model}-${level}`] || 0;
//   return additionalPricing;
// }

export function openRouterModelPricing(model, inOrOut) {
  const modelInfo = openRouterModelsInfo.find((mdl) => mdl.id === model);
  if (modelInfo)
    return modelInfo[
      inOrOut === "input" ? "promptPricing" : "completionPricing"
    ];
  return null;
}

export async function getModelsInfo() {
  try {
    const { data } = await axios.get("https://openrouter.ai/api/v1/models");
    // console.log("data", data);
    let result = data.data
      .filter((model) => openRouterModels.includes(model.id))
      .map((model) => {
        tokensLimit["openRouter/" + model.id] = model.context_length;
        return {
          id: model.id,
          name: model.name,
          contextLength: Math.round(model.context_length / 1024),
          description: model.description,
          promptPricing: model.pricing.prompt * 1000000,
          completionPricing: model.pricing.completion * 1000000,
          imagePricing: model.pricing.image * 1000,
        };
      });
    return result;
  } catch (error) {
    console.log("Impossible to get OpenRouter models infos:", error);
    return [];
  }
}

/**
 * Normalize Claude model name to API ID or display name
 * Uses MODEL_REGISTRY aliases for matching
 *
 * Note: Thinking mode (+thinking suffix) is preserved as-is when present.
 * Future: Thinking mode will be controlled by a separate toggle in the UI.
 *
 * @param {string} model - Input model name/ID
 * @param {boolean} getShortName - Return display name instead of API ID
 * @returns {string} Normalized model name
 */
export function normalizeClaudeModel(model, getShortName) {
  if (!model) {
    return getShortName ? "Claude Haiku 3.5" : "claude-3-5-haiku-20241022";
  }

  // Check if thinking mode is requested (preserve the suffix)
  const hasThinking =
    model.toLowerCase().includes("+thinking") ||
    model.toLowerCase().includes(" thinking");
  const baseModel = model
    .toLowerCase()
    .replace("+thinking", "")
    .replace(" thinking", "")
    .trim();

  // Try to find the model in registry
  const entry = getModelByIdentifier(baseModel);

  if (entry && entry.provider === "Anthropic") {
    if (getShortName) {
      return hasThinking ? entry.name + " Thinking" : entry.name;
    }
    return hasThinking ? entry.id + "+thinking" : entry.id;
  }

  // Default fallback to Claude Haiku 3.5
  return getShortName ? "Claude Haiku 3.5" : "claude-3-5-haiku-20241022";
}

export const updateTokenCounter = (model, { input_tokens, output_tokens }) => {
  if (!model) return;
  model = normalizeModelId(model);
  let tokensCounter = extensionStorage.get("tokensCounter");
  if (!tokensCounter) {
    tokensCounter = {
      total: {},
    };
  }
  if (model.includes("+thinking")) model = model.replace("+thinking", "");
  if (!tokensCounter.total[model]) {
    tokensCounter.total[model] = {
      input: 0,
      output: 0,
    };
  }
  const currentMonth = new Date().getMonth() + 1;

  if (currentMonth !== tokensCounter?.monthly?.month) {
    tokensCounter.lastMonth = { ...tokensCounter.monthly };
    tokensCounter.monthly = {
      month: currentMonth,
    };
    tokensCounter.monthly[model] = {
      input: 0,
      output: 0,
    };
  }
  if (!tokensCounter.monthly[model]) {
    tokensCounter.monthly[model] = {
      input: 0,
      output: 0,
    };
  }

  // addtional cost for Web search OpenAI models per request (converted in input tokens)
  if (model.includes("-search") && typeof input_tokens === "number") {
    // const additionalCost = getAdditionalPricingPerRequest(
    //   model,
    //   websearchContext
    // );

    const additionalTokens = Math.ceil(
      0.01 / (modelsPricing[model].input / 1000000)
    );
    input_tokens += additionalTokens || 0;
  }

  // specific count for gpt-image-1
  if (model.includes("gpt-image-1")) {
    //console.log("input_tokens :>> ", input_tokens);
    const detailled_input_tokens = input_tokens;
    input_tokens = 0;
    input_tokens =
      detailled_input_tokens["text_tokens"] +
      detailled_input_tokens["image_tokens"] *
        (modelsPricing[model]["input_image"] / modelsPricing[model]["input"]);
  }
  // console.log("input_tokens :>> ", input_tokens);

  tokensCounter.total[model].input +=
    typeof input_tokens === "number" ? input_tokens : 0;
  tokensCounter.total[model].output +=
    typeof output_tokens === "number" ? output_tokens : 0;
  tokensCounter.monthly[model].input +=
    typeof input_tokens === "number" ? input_tokens : 0;
  tokensCounter.monthly[model].output +=
    typeof output_tokens === "number" ? output_tokens : 0;
  if (input_tokens && output_tokens) {
    tokensCounter.lastRequest = {
      model,
      input: input_tokens,
      output: output_tokens,
    };
  }
  extensionStorage.set("tokensCounter", { ...tokensCounter });
};

export const normalizeModelId = (model, toAscii = true) => {
  // extension API storage object keys doesn't support ".", "#", "$", "/", "[", or "]"
  if (toAscii)
    return model
      .replaceAll("#", "%35")
      .replaceAll("$", "%36")
      .replaceAll("/", "%47")
      .replaceAll(".", "%46")
      .replaceAll("[", "%91")
      .replaceAll("]", "%93");
  return model
    .replaceAll("%35", "#")
    .replaceAll("%36", "$")
    .replaceAll("%47", "/")
    .replaceAll("%46", ".")
    .replaceAll("%91", "[")
    .replaceAll("%93", "]");
};
