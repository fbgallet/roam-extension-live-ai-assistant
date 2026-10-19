import { useEffect, useState } from "react";
import { defaultModel, extensionStorage, openRouterOnly } from "..";
import {
  getFavoriteModels,
  getModelCapabilities,
  getProviderModels,
  isModelVisible,
} from "./modelConfigHelpers";

// Session-scoped "active model": switched from the context menu (selector or
// Alt+↑/↓) or the command palette, used instead of the default model until the
// end of the Roam session. It is never written to the extension settings.
let sessionModel = null;
const listeners = new Set();

const PROVIDERS = [
  "OpenAI",
  "Anthropic",
  "Google",
  "DeepSeek",
  "Grok",
  "OpenRouter",
  "Groq",
  "Ollama",
];

const getProviderPrefix = (provider) => {
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

// Read from storage to get the current value (not a stale import)
export const getDefaultModel = () =>
  extensionStorage.get("defaultModel") || defaultModel;

export const getActiveModel = () => sessionModel || getDefaultModel();

// Model explicitly switched for this session, null when the default is used
export const getActiveModelOverride = () =>
  sessionModel && sessionModel !== getDefaultModel() ? sessionModel : null;

export const isActiveModelDefault = () => !getActiveModelOverride();

export const setActiveModel = (model) => {
  sessionModel = !model || model === getDefaultModel() ? null : model;
  const active = getActiveModel();
  listeners.forEach((listener) => listener(active));
};

export const subscribeToActiveModel = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// React hook: current active model, re-rendering on every switch
export const useActiveModel = () => {
  const [activeModel, setActiveModelState] = useState(getActiveModel);
  useEffect(() => {
    setActiveModelState(getActiveModel());
    return subscribeToActiveModel(setActiveModelState);
  }, []);
  return activeModel;
};

// Visible favorite models (excluding image generation), as full model strings
// (with provider prefix), in the user's favorites order
export const getFavoriteModelStrings = () => {
  const providers = openRouterOnly ? ["OpenRouter"] : PROVIDERS;
  return getFavoriteModels()
    .filter(
      (modelId) =>
        isModelVisible(modelId) &&
        !getModelCapabilities(modelId).includes("image"),
    )
    .map((modelId) => {
      const provider = providers.find((p) =>
        getProviderModels(p).some((m) => m.id === modelId),
      );
      return provider ? getProviderPrefix(provider) + modelId : null;
    })
    .filter(Boolean);
};

// Models to cycle through: the default model (if not already a favorite),
// then the favorites
export const getModelsCycle = () => {
  const favorites = getFavoriteModelStrings();
  const defaultModelStr = getDefaultModel();
  return favorites.includes(defaultModelStr)
    ? favorites
    : [defaultModelStr, ...favorites].filter(Boolean);
};

// Next (step = 1) or previous (step = -1) model in the cycle from `current`.
// Returns null when there is nothing to cycle through.
export const getNextModelInCycle = (current, step = 1) => {
  const cycle = getModelsCycle();
  if (cycle.length < 2) return null;
  const index = cycle.indexOf(current);
  if (index === -1) return step > 0 ? cycle[0] : cycle[cycle.length - 1];
  return cycle[(index + step + cycle.length) % cycle.length];
};

export const cycleActiveModel = (step = 1) => {
  const next = getNextModelInCycle(getActiveModel(), step);
  if (next) setActiveModel(next);
  return next;
};

// Alt+↓ (next) / Alt+↑ (previous), layout-independent and free in Chrome & OS
export const getModelCycleStep = (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return 0;
  if (e.key === "ArrowDown") return 1;
  if (e.key === "ArrowUp") return -1;
  return 0;
};
