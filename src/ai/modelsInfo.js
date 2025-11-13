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
        "gpt-5.1-chat-latest",
        "gpt-5-chat-latest",
        "gpt-5.1",
        "gpt-5",
        "gpt-5-mini",
        "gpt-5-nano",
        "gpt-5-search-api",
        "gpt-4.1",
        "gpt-4.1-mini",
        "gpt-4.1-nano",
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-4o-mini-search",
        "gpt-4o-search",
        "o4-mini",
        "o3",
        "o3-pro",
      ].concat(openAiCustomModels);
    case "Anthropic":
      return [
        "Claude Haiku 4.5",
        "Claude Haiku 3.5",
        "Claude Haiku",
        "Claude Sonnet 4.5",
        "Claude Sonnet 4.5 Thinking",
        "Claude Sonnet 4",
        "Claude Sonnet 3.7",
        "Claude Opus 4.1",
      ];
    case "DeepSeek":
      return ["DeepSeek-V3.2", "DeepSeek-V3.2 Thinking"];
    case "Grok":
      return [
        "Grok-4",
        "Grok-4-fast-reasoning",
        "Grok-4-fast-non-reasoning",
        "Grok-3",
        "Grok-3-mini",
        "Grok-3-mini-fast",
        "Grok-3-mini-high",
        "Grok-3-fast",
        "Grok-2 Vision",
      ];
    case "Google":
      return ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro"];
  }
};

export const tokensLimit = {
  "gpt-5": 400000,
  "gpt-5.1": 400000,
  "gpt-5-chat-latest": 400000,
  "gpt-5.1-chat-latest": 400000,
  "gpt-5-mini": 400000,
  "gpt-5-nano": 400000,
  "gpt-5-search-api": 128000,
  "gpt-4.1-nano": 1047576,
  "gpt-4.1-mini": 1047576,
  "gpt-4.1": 1047576,
  "gpt-4o-mini": 131073,
  "gpt-4o": 131073,
  "gpt-4o-mini-search-preview": 128000,
  "gpt-4o-search-preview": 128000,
  "o4-mini": 200000,
  o3: 200000,
  "o3-pro": 200000,
  "o3-mini": 200000,
  "claude-3-haiku-20240307": 200000,
  "claude-3-5-haiku-20241022": 200000,
  "claude-haiku-4-5-20251001": 200000,
  "claude-3-5-sonnet-20241022": 200000,
  "claude-3-7-sonnet-20250219": 200000,
  // "Claude Sonnet 3.7 Thinking": 200000,
  "claude-sonnet-4-20250514": 200000,
  "claude-sonnet-4-5-20250929": 200000,
  "claude-sonnet-4-5-20250929+thinking": 200000,
  "claude-opus-4-1-20250805": 200000,
  "deepseek-chat": 128000,
  "deepseek-reasoner": 128000,
  "grok-2-vision-1212": 32768,
  "grok-2-1212": 131072,
  "grok-3-mini": 131072,
  "grok-3-mini-fast": 131072,
  "grok-3-mini-high": 131072,
  "grok-3": 131072,
  "grok-3-fast": 131072,
  "grok-4": 256000,
  "grok-4-fast-reasoning": 2000000,
  "grok-4-fast-non-reasoning": 2000000,
  "gemini-2.5-flash-lite": 1048576,
  "gemini-2.5-flash": 1048576,
  "gemini-2.5-pro": 1048576,
  custom: undefined,
};

// pricing for 1M tokens
export const modelsPricing = {
  "gpt-5-nano": {
    input: 0.05,
    output: 0.4,
  },
  "gpt-5-mini": {
    input: 0.25,
    output: 2,
  },
  "gpt-5.1-mini": {
    input: 0.25,
    output: 2,
  },
  "gpt-5": {
    input: 1.25,
    output: 10,
  },
  "gpt-5.1": {
    input: 1.25,
    output: 10,
  },
  "gpt-5-chat-latest": {
    input: 1.25,
    output: 10,
  },
  "gpt-5.1-chat-latest": {
    input: 1.25,
    output: 10,
  },
  "gpt-5-search-api": {
    input: 1.25,
    output: 10,
  },
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
    input: 2,
    output: 8,
  },
  "o3-pro": {
    input: 20,
    output: 80,
  },
  "gpt-image-1-mini": {
    input: 2,
    input_image: 2.5,
    output: 8,
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
  "claude-haiku-4-5-20251001": {
    input: 1,
    output: 5,
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
  "claude-sonnet-4-5-20250929": {
    input: 3,
    output: 15,
  },
  "claude-opus-4-1-20250805": {
    input: 15,
    output: 75,
  },
  "deepseek-chat": {
    input: 0.28,
    output: 0.42,
  },
  "deepseek-chat": {
    input: 0.28,
    output: 0.42,
  },
  "grok-2-1212": {
    input: 2,
    output: 10,
  },
  "grok-2-vision-1212": {
    input: 2,
    output: 10,
  },
  "grok-3-mini": {
    input: 0.3,
    output: 0.5,
  },
  "grok-3-mini-fast": {
    input: 0.6,
    output: 4,
  },
  "grok-3-mini-high": {
    input: 0.3,
    output: 0.5,
  },
  "grok-3": {
    input: 3,
    output: 15,
  },
  "grok-3-fast": {
    input: 5,
    output: 25,
  },
  "grok-4-fast-reasoning": {
    input: 0.2,
    output: 0.5,
  },
  "grok-4-fast-non-reasoning": {
    input: 0.2,
    output: 0.5,
  },
  "grok-4": {
    input: 3,
    output: 15,
  },
  "gemini-2.5-flash-lite": {
    input: 0.1,
    output: 0.4,
  },
  "gemini-2.5-flash": {
    input: 0.3,
    output: 2.5,
  },
  "gemini-2.5-pro": {
    input: 1.25,
    output: 10,
  },
  "gemini-2.5-flash-image": {
    input: 0.3,
    input_image: 0.3,
    output: 39000, // $0.039 per image = $39 per 1000 images
  },
  "imagen-4.0-fast-generate-001": {
    input: 0,
    output: 20000, // $0.02 per image = $20 per 1000 images
  },
  "imagen-4.0-generate-001": {
    input: 0,
    output: 40000, // $0.04 per image = $40 per 1000 images
  },
  "imagen-4.0-ultra-generate-001": {
    input: 0,
    output: 60000, // $0.06 per image = $60 per 1000 images
  },
};

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

export function normalizeClaudeModel(model, getShortName) {
  switch (model.toLowerCase()) {
    case "claude-4.1-opus":
    case "claude-opus-4-1-20250805":
    case "claude opus":
    case "claude opus 4.1":
      model = getShortName ? "Claude Opus 4.1" : "claude-opus-4-1-20250805";
      break;
    case "claude-sonnet":
    case "claude-sonnet-4.5":
    case "claude-sonnet-4-5":
    case "claude-sonnet-4-5-20250929":
    case "claude sonnet 4.5":
      model = getShortName ? "Claude Sonnet 4.5" : "claude-sonnet-4-5-20250929";
      break;
    case "claude-sonnet-4-5-20250929+thinking":
    case "claude-sonnet-4.5+thinking":
    case "claude sonnet 4.5 thinking":
    case "claude sonnet 4 thinking":
      model = getShortName
        ? "Claude Sonnet 4.5 Thinking"
        : "claude-sonnet-4-5-20250929+thinking";
      break;
    case "claude-sonnet-4":
    case "claude-sonnet-4-20250514":
    case "claude sonnet 4":
      model = getShortName ? "Claude Sonnet 4" : "claude-sonnet-4-20250514";
      break;
    // claude-3-7-sonnet-latest
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
    case "claude-haiku-4-5-20251001":
    case "claude haiku 4.5":
    case "claude-haiku-4.5":
      model = getShortName ? "Claude Haiku 4.5" : "claude-haiku-4-5-20251001";
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
