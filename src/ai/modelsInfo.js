import {
  extensionStorage,
  openAiCustomModels,
  openRouterModels,
  openRouterModelsInfo,
  websearchContext,
} from "..";
import axios from "axios";

export const getAvailableModels = (provider) => {
  switch (provider) {
    case "OpenAI":
      return [
        "gpt-4.1-nano",
        "gpt-4.1-mini",
        "gpt-4.1",
        "gpt-4o-mini",
        "gpt-4o",
        "gpt-4o-mini-search",
        "gpt-4o-search",
        "o4-mini",
        "o3",
      ].concat(openAiCustomModels);
    case "Anthropic":
      return [
        "Claude Haiku",
        "Claude Haiku 3.5",
        "Claude Sonnet 3.5",
        "Claude Sonnet 4",
        "Claude Sonnet 4 Thinking",
        "Claude Opus 4",
      ];
    case "DeepSeek":
      return ["DeepSeek-V3", "DeepSeek-R1"];
    case "Grok":
      return ["Grok-2", "Grok-2 Vision"];
  }
};

export const tokensLimit = {
  "gpt-4.1-nano": 1047576,
  "gpt-4.1-mini": 1047576,
  "gpt-4.1": 1047576,
  "gpt-4o-mini": 131073,
  "gpt-4o": 131073,
  "gpt-4o-mini-search-preview": 128000,
  "gpt-4o-search-preview": 128000,
  "o4-mini": 200000,
  o3: 200000,
  "o3-mini": 200000,
  "Claude Haiku": 200000,
  "Claude Haiku 3.5": 200000,
  "Claude Sonnet 3.5": 200000,
  "Claude Sonnet 3.7": 200000,
  // "Claude Sonnet 3.7 Thinking": 200000,
  "Claude Sonnet 4": 200000,
  "Claude Sonnet 4 Thinking": 200000,
  "Claude Opus 4": 200000,
  "deepseek-chat": 64000,
  "deepseek-reasoner": 64000,
  "grok-2-1212": 131072,
  "grok-2-vision-1212": 32768,
  "gemini-2.0-flash-exp": 1047576,
  "gemini-1.5-flash": 1048576,
  "gemini-1.5-pro": 2097152,
  custom: undefined,
};

// pricing for 1M tokens
export const modelsPricing = {
  "gpt-4.1-nano": {
    input: 0.1,
    output: 0.4,
  },
  "gpt-4.1-mini": {
    input: 0.4,
    output: 1.6,
  },
  "gpt-4.1": {
    input: 2,
    output: 8,
  },
  "gpt-4o-mini": {
    input: 0.15,
    output: 0.6,
  },
  "gpt-4o": {
    input: 2.5,
    output: 10,
  },
  "gpt-4o-mini-search-preview": {
    input: 0.15,
    output: 0.6,
  },
  "gpt-4o-search-preview": {
    input: 2.5,
    output: 10,
  },
  "o4-mini": {
    input: 1.1,
    output: 4.4,
  },
  "o3-mini": {
    input: 1.1,
    output: 4.4,
  },
  o1: {
    input: 15,
    output: 60,
  },
  o3: {
    input: 10,
    output: 40,
  },
  "gpt-image-1": {
    input: 5,
    input_image: 10,
    output: 40,
  },
  "claude-3-haiku-20240307": {
    input: 0.25,
    output: 1.25,
  },
  "claude-3-5-haiku-20241022": {
    input: 0.8,
    output: 4,
  },
  "claude-3-5-sonnet-20241022": {
    input: 3,
    output: 15,
  },
  "claude-3-7-sonnet-20250219": {
    input: 3,
    output: 15,
  },
  "claude-sonnet-4-20250514": {
    input: 3,
    output: 15,
  },
  "claude-opus-4-20250514": {
    input: 15,
    output: 75,
  },
  "deepseek-chat": {
    input: 0.27,
    output: 1.1,
  },
  "deepseek-reasoner": {
    input: 0.55,
    output: 2.19,
  },
  "grok-2-1212": {
    input: 2,
    output: 10,
  },
  "grok-2-vision-1212": {
    input: 2,
    output: 10,
  },
};

export const additionalPricingPerRequest = {
  "gpt-4o-mini-search-preview-low": 0.025,
  "gpt-4o-mini-search-preview-medium": 0.0275,
  "gpt-4o-mini-search-preview-high": 0.03,
  "gpt-4o-search-preview-low": 0.03,
  "gpt-4o-search-preview-medium": 0.035,
  "gpt-4o-search-preview-high": 0.05,
};

function getAdditionalPricingPerRequest(model, level) {
  const additionalPricing =
    additionalPricingPerRequest[`${model}-${level}`] || 0;
  return additionalPricing;
}

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

export function normalizeClaudeModel(model, getShortName) {
  switch (model.toLowerCase()) {
    case "claude-4-opus":
    case "claude-opus-4-20250514":
    case "claude opus":
      model = getShortName ? "Claude Opus 4" : "claude-opus-4-20250514";
      break;
    case "claude-sonnet-4":
    case "claude-sonnet-4-20250514":
    case "claude sonnet 4":
      model = getShortName ? "Claude Sonnet 4" : "claude-sonnet-4-20250514";
      break;
    // claude-3-7-sonnet-latest
    case "claude-sonnet-4-20250514+thinking":
    case "claude sonnet 4 thinking":
      model = getShortName
        ? "Claude Sonnet 4 Thinking"
        : "claude-sonnet-4-20250514+thinking";
      break;
    case "claude-sonnet-3.5":
    case "claude-3-5-sonnet-20241022":
    case "claude sonnet 3.5":
      model = getShortName ? "Claude Sonnet 3.5" : "claude-3-5-sonnet-20241022";
      // model = "claude-3-5-sonnet-20240620"; previous version
      // model = "claude-3-sonnet-20240229"; previous version
      break;
    case "claude-sonnet-3.7":
    case "claude-3-7-sonnet-20250219":
    case "claude sonnet 3.7":
      model = getShortName ? "Claude Sonnet 3.7" : "claude-3-7-sonnet-20250219";
      break;
    // claude-3-7-sonnet-latest
    case "claude-3-7-sonnet-20250219+thinking":
    case "claude sonnet 3.7 thinking":
      model = getShortName
        ? "Claude Sonnet 3.7 Thinking"
        : "claude-3-7-sonnet-20250219+thinking";
      break;
    case "claude-haiku-3.5":
    case "claude-3-5-haiku-20241022":
    case "claude haiku 3.5":
      model = getShortName ? "Claude Haiku 3.5" : "claude-3-5-haiku-20241022";
      break;
    case "claude-haiku":
    case "claude-3-haiku-20240307":
    case "claude haiku":
      model = getShortName ? "Claude Haiku" : "claude-3-haiku-20240307";
      break;
    default:
      model = getShortName ? "Claude Haiku 3.5" : "claude-3-5-haiku-20241022";
  }
  return model;
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
    const additionalCost = getAdditionalPricingPerRequest(
      model,
      websearchContext
    );
    const additionalTokens = Math.ceil(
      additionalCost / (modelsPricing[model].input / 1000000)
    );
    input_tokens += additionalTokens || 0;
  }

  // specific count for gpt-image-1
  if (model === "gpt-image-1") {
    //console.log("input_tokens :>> ", input_tokens);
    const detailled_input_tokens = input_tokens;
    input_tokens = 0;
    input_tokens =
      detailled_input_tokens["text_tokens"] +
      detailled_input_tokens["image_tokens"] *
        (modelsPricing["gpt-image-1"]["input_image"] /
          modelsPricing["gpt-image-1"]["input"]);
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
