import { openRouterModels, openRouterModelsInfo } from "..";
import axios from "axios";

export const tokensLimit = {
  "gpt-4o-mini": 131073,
  "gpt-4o": 131073,
  "o1-mini": 131073,
  "o1-preview": 131073,
  "Claude Haiku": 200000,
  "Claude Haiku 3.5": 200000,
  "Claude Sonnet 3.5": 200000,
  "Claude Opus": 200000,
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
  "claude-3-haiku-20240307": {
    input: 0.00025,
    output: 0.00125,
  },
  "claude-3-5-haiku-20241022": {
    input: 0.001,
    output: 0.005,
  },
  "claude-3-5-sonnet-20241022": {
    input: 0.003,
    output: 0.015,
  },
  "claude-3-opus-20240229": {
    input: 0.015,
    output: 0.075,
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
