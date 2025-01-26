import { extensionStorage, openRouterModels, openRouterModelsInfo } from "..";
import axios from "axios";

export const tokensLimit = {
  "gpt-4o-mini": 131073,
  "gpt-4o": 131073,
  "o1-mini": 131073,
  o1: 200000,
  "Claude Haiku": 200000,
  "Claude Haiku 3.5": 200000,
  "Claude Sonnet 3.5": 200000,
  "Claude Opus": 200000,
  "deepseek-chat": 64000,
  "deepseek-reasoner": 64000,
  custom: undefined,
};

export const modelsPricing = {
  "gpt-4o-mini": {
    input: 0.00015, //  /1K tokens
    output: 0.0006,
  },
  "gpt-4o": {
    input: 0.0025,
    output: 0.01,
  },
  "o1-mini": {
    input: 0.003,
    output: 0.012,
  },
  "o1-preview": {
    input: 0.015,
    output: 0.06,
  },
  o1: {
    input: 0.015,
    output: 0.06,
  },
  "claude-3-haiku-20240307": {
    input: 0.00025,
    output: 0.00125,
  },
  "claude-3-5-haiku-20241022": {
    input: 0.0008,
    output: 0.004,
  },
  "claude-3-5-sonnet-20241022": {
    input: 0.003,
    output: 0.015,
  },
  "claude-3-opus-20240229": {
    input: 0.015,
    output: 0.075,
  },
  "deepseek-chat": {
    input: 0.00027,
    output: 0.0011,
  },
  "deepseek-reasoner": {
    input: 0.00055,
    output: 0.00219,
  },
};

export function openRouterModelPricing(model, inOrOut) {
  const modelInfo = openRouterModelsInfo.find((mdl) => mdl.id === model);
  if (modelInfo)
    return (
      modelInfo[inOrOut === "input" ? "promptPricing" : "completionPricing"] /
      1000
    );
  return null;
}

export async function getModelsInfo() {
  try {
    const { data } = await axios.get("https://openrouter.ai/api/v1/models");
    // console.log("data", data.data);
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

export function normalizeClaudeModel(model) {
  switch (model.toLowerCase()) {
    case "claude-3-opus":
    case "claude-3-opus-20240229":
    case "claude opus":
      model = "claude-3-opus-20240229";
      break;
    case "claude-sonnet-3.5":
    case "claude-3-5-sonnet-20241022":
    case "claude sonnet 3.5":
      model = "claude-3-5-sonnet-20241022";
      // model = "claude-3-5-sonnet-20240620"; previous version
      // model = "claude-3-sonnet-20240229"; previous version
      break;
    case "claude-haiku-3.5":
    case "claude-3-5-haiku-20241022":
    case "claude haiku 3.5":
      model = "claude-3-5-haiku-20241022";
      break;
    case "claude-haiku":
    case "claude-3-haiku-20240307":
    case "claude haiku":
      model = "claude-3-haiku-20240307";
      break;
    default:
      model = "claude-3-5-haiku-20241022";
  }
  return model;
}

export const updateTokenCounter = (
  model = "gpt-4o-mini",
  { input_tokens, output_tokens }
) => {
  let tokensCounter = extensionStorage.get("tokensCounter");
  if (!tokensCounter) {
    tokensCounter = {
      total: {},
    };
  }
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

  tokensCounter.total[model].input += input_tokens || 0;
  tokensCounter.total[model].output += output_tokens || 0;
  tokensCounter.monthly[model].input += input_tokens || 0;
  tokensCounter.monthly[model].output += output_tokens || 0;
  if (input_tokens && output_tokens) {
    tokensCounter.lastRequest = {
      model,
      input: input_tokens,
      output: output_tokens,
    };
  }
  extensionStorage.set("tokensCounter", { ...tokensCounter });
};
