import {
  initializeAnthropicAPI,
  initializeGoogleAPI,
  initializeOpenAIAPI,
  modelAccordingToProvider,
} from "./ai/aiAPIsHub";
import { webLangCodes } from "./audio/audio";
import { getBlockContentByUid, resolveReferences } from "./utils/roamAPI";
import {
  defaultAssistantCharacter,
  defaultContextInstructions,
} from "./ai/prompts";
import {
  createContainer,
  mountComponent,
  removeContainer,
  toggleComponentVisibility,
  unmountComponent,
  addPageNavigationListeners,
  removePageNavigationListeners,
  onPageLoad,
  displayModelConfigDialog,
  displayMCPConfigDialog,
  connectQueryObserver,
  disconnectQueryObserver,
} from "./utils/domElts";
import { loadRoamExtensionCommands } from "./utils/roamExtensionCommands";
import {
  getModelsInfo,
  imageGenerationModels,
  liveTranscriptionModels,
  transcriptionModels,
  updateTokenCounter,
} from "./ai/modelsInfo";
import {
  loadRemoteModelUpdates,
  registerOpenRouterModels,
  registerCustomModelThinking,
  getModelByIdentifier,
  getDefaultModelCandidates,
} from "./ai/modelRegistry";
import {
  migrateModelConfig,
  getModelConfig,
  saveModelConfig,
  checkModelUpdates,
  applyModelMigrations,
  getProviderModels,
  isModelVisible,
  getOrderedProviders,
} from "./utils/modelConfigHelpers";
import { displayModelMigrationDialog } from "./utils/domElts";
import { BUILTIN_STYLES } from "./ai/styleConstants";
import {
  cleanupContextMenu,
  initializeContextMenu,
} from "./components/contextMenu";
import { getValidLanguageCode } from "./ai/languagesSupport";
import {
  LIVE_AUTO_STOP_DELAYS,
  LIVE_SILENCE_TIMEOUTS,
  LIVE_VOICE_SENSITIVITY,
  stopLiveTranscription,
} from "./ai/liveTranscription";
import {
  getArrayFromList,
  getCustomStyles,
  getFlattenedContentFromTree,
  getMaxDephObjectFromList,
  getOrderedCustomPromptBlocks,
} from "./ai/dataExtraction";
import { uidRegex } from "./utils/regex";
import MCPConfigComponent from "./components/MCPConfigComponent";
import { mcpManager } from "./ai/agents/mcp-agent/mcpManager";
import React from "react";
import "./components/full-results-popup/index.tsx"; // Register window.LiveAI.openFullResultsPopup
import { initializeHelpDepot } from "./ai/agents/chat-agent/tools/helpDepotUtils";
import { AppToaster } from "./components/Toaster";
import { cleanupAllWindowStorage } from "./components/full-results-popup/utils/windowStorage";
import { initPublicApi, cleanupPublicApi } from "./api/publicApi";
import { disposeLocal } from "./ai/vectorStore/providers/local/localProvider";

export let OPENAI_API_KEY = "";
export let ANTHROPIC_API_KEY = "";
export let DEEPSEEK_API_KEY = "";
export let GOOGLE_API_KEY = "";
export let GROK_API_KEY = "";
export let OPENROUTER_API_KEY = "";
export let GROQ_API_KEY = "";
export let menuModifierKey;
export let isUsingWhisper;
export let transcriptionModel;
// Live (streaming) transcription: separate model & settings, see liveTranscription.js
export let isLiveTranscriptionEnabled;
export let liveTranscriptionModel;
export let liveTranscriptionDelay;
export let liveSilenceTimeout;
export let liveVoiceSensitivity;
export let liveAutoStopDelay;
export let isUsingGroqWhisper;
export let transcriptionLanguage;
export let speechLanguage;
export let whisperPrompt;
export let isTranslateIconDisplayed;
export let isOutlinerIconDisplayed;
export let defaultModel;
export let reasoningEffort;
export let availableModels = [];
export let customBaseURL;
export let customEndpointEnabled; // Whether custom OpenAI endpoint is enabled for custom models
export let customOpenAIOnly; // Whether to use custom endpoint EXCLUSIVELY for all OpenAI API calls
export let modelTemperature;
export let openRouterOnly;
export let ollamaModels = [];
export let ollamaServer;
export let groqModels = [];
export let chatRoles;
export let assistantCharacter = defaultAssistantCharacter;
export let defaultStyle;
export let ttsVoice;
export let voiceInstructions;
export let contextInstruction = defaultContextInstructions;
export let userContextInstructions;
// export let isMobileViewContext;
export let isResponseToSplit;
export let logPagesNbDefault;
export let maxCapturingDepth = {};
export let maxUidDepth = {};
export let automaticSemanticExpansionMode;
export let exclusionStrings = [];
export let websearchContext;
export let askGraphMode;
// export let defaultTemplate;
export let streamResponse;
export let isTitleToAdd;
export let includeChildrenByDefault;
export let uidsInPrompt;
export let maxImagesNb;
export let openAiCustomModels = [];
export let openRouterModelsInfo = [];
export let openRouterModels = [];
export let isComponentAlwaysVisible;
export let isComponentVisible;
export let resImages;
export let defaultImageModel;
export let position;
export let openaiLibrary,
  customOpenaiLibrary,
  anthropicLibrary,
  openrouterLibrary,
  groqLibrary,
  deepseekLibrary,
  grokLibrary,
  googleLibrary;
export let isSafari =
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ||
  window.roamAlphaAPI.platform.isIOS;
export let customStyles;
export let isThinkingProcessToDisplay;
export let alwaysExtractPdf;
export let alwaysExtractQuery;

const modeMap = {
  "Always ask user": "ask_user",
  "Automatic until result": "auto_until_result",
  "Always with fuzzy": "always_fuzzy",
  "Always with synonyms": "always_synonyms",
  "Always with all": "always_all",
};

export let extensionStorage;

// Does the given provider have a usable API key (or, for dynamic providers,
// user-declared models) right now?
export function hasProviderApiKey(provider) {
  switch (provider) {
    case "OpenAI":
      return !!OPENAI_API_KEY;
    case "Anthropic":
      return !!ANTHROPIC_API_KEY;
    case "DeepSeek":
      return !!DEEPSEEK_API_KEY;
    case "Google":
      return !!GOOGLE_API_KEY;
    case "Grok":
      return !!GROK_API_KEY;
    case "OpenRouter":
      return (
        !!OPENROUTER_API_KEY ||
        getModelConfig().customModels?.openrouter?.length > 0
      );
    case "Groq":
      return !!GROQ_API_KEY || getModelConfig().customModels?.groq?.length > 0;
    case "Ollama":
      return getModelConfig().customModels?.ollama?.length > 0;
    default:
      return false;
  }
}

// Prefix used to disambiguate models of dynamic providers in model identifiers.
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

// Canonical `availableModels` string for a registry entry — native providers key
// on display name, dynamic ones on their raw API id.
const toModelString = (entry) => {
  const isDynamic = ["OpenRouter", "Groq", "Ollama"].includes(entry.provider);
  return (
    getProviderPrefix(entry.provider) + (isDynamic ? entry.id : entry.name)
  );
};

/**
 * Model to use as default when the user has none yet (fresh install) or when no
 * model at all is available. OpenAI comes first — it's the most common setup —
 * then the other providers in the user's order, keeping only those with an API
 * key. Within a provider, the model flagged `preferredDefault` in the registry
 * wins, otherwise its cheapest chat model. Promoting another model is thus a
 * one-line change in modelRegistry.js.
 */
export function getInitialDefaultModel() {
  const providers = [
    "OpenAI",
    ...getOrderedProviders().filter((p) => p !== "OpenAI"),
  ];
  for (const provider of providers) {
    if (!hasProviderApiKey(provider)) continue;
    const best = getDefaultModelCandidates(provider)[0];
    if (best) return toModelString(best);
  }
  // No key set yet: still point to OpenAI's recommended model, so the setting
  // is meaningful as soon as the user pastes an OpenAI key.
  const openAiBest = getDefaultModelCandidates("OpenAI")[0];
  return openAiBest ? toModelString(openAiBest) : "gpt-5.1";
}

export function setDefaultModel(str = getInitialDefaultModel()) {
  defaultModel = str;
  extensionStorage.set("defaultModel", str);
  chatRoles = getRolesFromString(
    extensionStorage.get("chatRoles"),
    defaultModel.includes("first") ? undefined : defaultModel,
  );
}

export function setTranscriptionModel(modelId) {
  transcriptionModel = modelId;
  extensionStorage.set("transcriptionModel", modelId);
}

export function updateAvailableModels() {
  availableModels = [];

  // Refresh dynamic model lists from current config so stale exports are updated
  const currentConfig = getModelConfig();
  openAiCustomModels =
    currentConfig.customModels?.openai?.map((m) => m.id) || [];
  openRouterModels =
    currentConfig.customModels?.openrouter?.map((m) => m.id) || [];
  groqModels = currentConfig.customModels?.groq?.map((m) => m.id) || [];
  ollamaModels = currentConfig.customModels?.ollama?.map((m) => m.id) || [];

  // Refresh which custom models are user-declared reasoning models (full replace)
  registerCustomModelThinking(
    Object.values(currentConfig.customModels || {}).flat(),
    { replace: true },
  );

  // Refresh custom endpoint settings from config
  const openaiEndpoint = currentConfig.providerEndpoints?.openai;
  if (openaiEndpoint) {
    customBaseURL = openaiEndpoint.baseURL || customBaseURL;
    customEndpointEnabled = openaiEndpoint.enabled ?? customEndpointEnabled;
    customOpenAIOnly = openaiEndpoint.exclusive ?? customOpenAIOnly;
  }

  // Re-initialize OpenAI libraries if endpoint settings changed
  if (OPENAI_API_KEY || (customBaseURL && customOpenAIOnly)) {
    openaiLibrary = initializeOpenAIAPI(
      OPENAI_API_KEY,
      customOpenAIOnly ? customBaseURL : null,
    );
  }
  if (customBaseURL && customEndpointEnabled && !customOpenAIOnly) {
    customOpenaiLibrary = initializeOpenAIAPI(OPENAI_API_KEY, customBaseURL);
  }

  // Use ordered providers and respect visibility settings like ModelsMenu
  const providers = getOrderedProviders();

  for (const provider of providers) {
    if (!hasProviderApiKey(provider)) continue;

    const models = getProviderModels(provider);
    const prefix = getProviderPrefix(provider);

    // Filter by visibility (respects user settings from ModelConfigDialog)
    // Note: We don't filter out image generation models here - that's for display purposes only
    const visibleModels = models.filter((m) => isModelVisible(m.id));

    availableModels.push(...visibleModels.map((m) => prefix + m.id));
  }

  if (!availableModels.length) {
    setDefaultModel();
    return;
  }
  if (!availableModels.includes(defaultModel)) {
    const savedEntry = getModelByIdentifier(defaultModel);

    // A model that still exists AND whose provider has an API key is USABLE as
    // the default even when it isn't in the visible list — the user may simply
    // have hidden it from the quick menu (hidden ≠ unusable). In that case we
    // never force a switch or show a notification.
    if (savedEntry && hasProviderApiKey(savedEntry.provider)) {
      // If the visible list carries the same model under a drifted identifier
      // (rename / alias / casing change between versions), quietly adopt that
      // canonical string. Otherwise keep the (possibly hidden) default as-is.
      const equivalent = availableModels.find(
        (m) => getModelByIdentifier(m) === savedEntry,
      );
      if (equivalent && equivalent !== defaultModel) {
        console.log(
          `Default model identifier "${defaultModel}" drifted; adopting "${equivalent}".`,
        );
        setDefaultModel(equivalent);
      }
    } else {
      // Genuinely unavailable: the provider's API key is gone, or the model was
      // removed from the registry. Switch to the provider's `preferredDefault`
      // model if one is available, otherwise to the CHEAPEST available (visible +
      // keyed) non-image model of the same provider — not the flagship — then
      // notify the user. Capture the old value BEFORE setDefaultModel mutates
      // the module-level `defaultModel`, so the toast reports it correctly.
      const previousDefault = defaultModel;

      const low = (previousDefault || "").toLowerCase();
      let provider = savedEntry?.provider;
      if (!provider) {
        if (low.includes("openrouter")) provider = "OpenRouter";
        else if (low.includes("groq")) provider = "Groq";
        else if (low.includes("ollama")) provider = "Ollama";
        else provider = "OpenAI";
      }

      // Best available replacement for a provider: its `preferredDefault` model
      // when that one is available, otherwise the cheapest chat model
      // (image-generation models are excluded so they can never become the text
      // default). Ordering lives in the registry, so promoting another model only
      // means moving the `preferredDefault` flag there.
      const bestOf = (prov) =>
        getDefaultModelCandidates(prov)
          .map(toModelString)
          .find((str) => availableModels.includes(str));

      const replacement =
        bestOf(provider) ||
        getOrderedProviders()
          .map((p) => bestOf(p))
          .find(Boolean) ||
        availableModels[0];

      setDefaultModel(replacement);

      if (replacement && replacement !== previousDefault) {
        const replacementEntry = getModelByIdentifier(replacement);
        const replacementName = replacementEntry?.name || replacement;
        const qualifier = replacementEntry?.preferredDefault
          ? "the recommended default model"
          : "the cheapest available model";
        AppToaster.show({
          message: `Live AI – Your default model "${previousDefault}" is no longer available (its provider API key is missing, or the model was removed). Default switched to ${qualifier}, "${replacementName}".`,
          timeout: 12000,
        });
      }
    }
  }
  extensionStorage.panel.create(getPanelConfig());
}

function getRolesFromString(str, model) {
  let splittedStr = str ? str.split(",") : [];
  if (!model) {
    if (
      defaultModel === "first custom OpenAI model" &&
      openAiCustomModels.length
    ) {
      model = openAiCustomModels[0];
    } else if (
      defaultModel === "first OpenRouter model" &&
      openRouterModels.length
    ) {
      model = openRouterModels[0];
    } else if (
      defaultModel === "first Ollama local model" &&
      ollamaModels.length
    ) {
      model = ollamaModels[0];
    } else if (defaultModel === "first Groq model" && groqModels.length) {
      model = groqModels[0];
    } else {
      model = defaultModel.includes("first")
        ? getInitialDefaultModel()
        : defaultModel;
    }
  }
  model = modelAccordingToProvider(model);
  // console.log("model :>> ", model);
  return {
    model,
    defaultStr: str,
    user: splittedStr[0],
    assistant:
      splittedStr.length > 1
        ? splittedStr[1]
            .trimStart()
            .replace("<model>", model?.name || "default model")
        : str && str.trim()
          ? "AI assistant: "
          : "",
    genericAssistantRegex:
      splittedStr.length > 1 && splittedStr[1]
        ? getAssistantRoleRegex(splittedStr[1].trim())
        : null,
  };
}

export function getInstantAssistantRole(instantModel) {
  const { assistant } = getRolesFromString(chatRoles.defaultStr, instantModel);
  return assistant;
}

function getAssistantRoleRegex(assistantRoleStr) {
  if (assistantRoleStr)
    return new RegExp(assistantRoleStr.replace("<model>", ".*"));
  return null;
}

export async function addToConversationHistory({
  uid,
  command,
  style,
  selectedUids,
  context,
}) {
  if (!uid && !selectedUids) return;
  let conversationHistory = extensionStorage.get("conversationHistory") || [];
  if (conversationHistory.find((conv) => conv.uid === uid)) return;
  // conversation storage is limited to 30
  if (conversationHistory.length > 30) {
    conversationHistory.shift(); // Remove the first (oldest) element
  }
  const params = { uid: uid };
  if (command) params.command = command;
  if (style && style !== "Normal") params.style = style;
  if (selectedUids) params.selectedUids = selectedUids;
  if (context) params.context = context;
  conversationHistory.push(params);
  await extensionStorage.set("conversationHistory", conversationHistory);
}

export function getConversationParamsFromHistory(uid) {
  if (!uid) return null;
  let conversationHistory = extensionStorage.get("conversationHistory");
  // console.log("conversationHistory :>> ", conversationHistory);
  if (!conversationHistory || !conversationHistory.length) return null;
  let conversationParams = conversationHistory.find((conv) => conv.uid === uid);
  return conversationParams;
}

// Check if first time dialog should be shown
export function shouldShowFirstTimeDialog() {
  return extensionStorage.get("askGraphFirstTime") === true;
}

// Mark first time dialog as shown
export async function markFirstTimeDialogShown() {
  await extensionStorage.set("askGraphFirstTime", false);
}

export async function incrementCommandCounter(commandId) {
  const commandUsage = extensionStorage.get("commandCounter");
  const existingCommand = commandUsage?.counter?.find(
    (cmd) => cmd.id === commandId,
  );
  if (existingCommand) {
    existingCommand.count += 1;
  } else {
    commandUsage.counter.push({ id: commandId, count: 1 });
  }
  commandUsage.counter = commandUsage.counter.sort((a, b) => a.count < b.count);
  if (commandId > 10) commandUsage.last = commandId;
  await extensionStorage.set("commandCounter", commandUsage);
}

function getPanelConfig() {
  const panelConfig = {
    tabTitle: "Live AI",
    settings: [
      {
        id: "openaiapi",
        name: "OpenAI API Key (GPT)",
        description: (
          <>
            <span>Copy here your OpenAI API key for Whisper & GPT models</span>
            <br></br>
            <a href="https://platform.openai.com/api-keys" target="_blank">
              (Follow this link to generate a new one)
            </a>
          </>
        ),
        action: {
          type: "input",
          onChange: async (evt) => {
            unmountComponent(position);
            setTimeout(() => {
              OPENAI_API_KEY = evt.target.value;
              openaiLibrary = initializeOpenAIAPI(OPENAI_API_KEY);
              if (extensionStorage.get("whisper") === true)
                isUsingWhisper = true;
              updateAvailableModels();
            }, 200);
            setTimeout(() => {
              mountComponent(position);
            }, 200);
          },
        },
      },
      {
        id: "anthropicapi",
        name: "Anthropic API Key (Claude)",
        description: (
          <>
            <span>Copy here your Anthropic API key for Claude models</span>
            <br></br>
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
            >
              (Follow this link to generate a new one)
            </a>
            <br></br>
          </>
        ),
        action: {
          type: "input",
          onChange: async (evt) => {
            unmountComponent(position);
            setTimeout(() => {
              ANTHROPIC_API_KEY = evt.target.value;
              anthropicLibrary = initializeAnthropicAPI(ANTHROPIC_API_KEY);
              updateAvailableModels();
            }, 200);
            setTimeout(() => {
              mountComponent(position);
            }, 200);
          },
        },
      },
      {
        id: "googleapi",
        name: "Google API Key",
        description: (
          <>
            <span>Copy here your Google Gemini API key</span>
            <br></br>
            <a href="https://aistudio.google.com/app/apikey" target="_blank">
              (Follow this link to generate a new one)
            </a>
            <br></br>
          </>
        ),
        action: {
          type: "input",
          onChange: async (evt) => {
            unmountComponent(position);
            setTimeout(() => {
              GOOGLE_API_KEY = evt.target.value;
              googleLibrary = initializeGoogleAPI(GOOGLE_API_KEY);
              updateAvailableModels();
            }, 200);
            setTimeout(() => {
              mountComponent(position);
            }, 200);
          },
        },
      },
      {
        id: "deepseekapi",
        name: "DeepSeek API Key",
        description: (
          <>
            <span>Copy here your DeepSeek API key</span>
            <br></br>
            <a href="https://platform.deepseek.com/api_keys" target="_blank">
              (Follow this link to generate a new one)
            </a>
            <br></br>
          </>
        ),
        action: {
          type: "input",
          onChange: async (evt) => {
            unmountComponent(position);
            setTimeout(() => {
              DEEPSEEK_API_KEY = evt.target.value;
              deepseekLibrary = initializeOpenAIAPI(
                DEEPSEEK_API_KEY,
                "https://api.deepseek.com",
              );
              updateAvailableModels();
            }, 200);
            setTimeout(() => {
              mountComponent(position);
            }, 200);
          },
        },
      },
      {
        id: "grokapi",
        name: "Grok API Key",
        description: (
          <>
            <span>Copy here your Grok API key</span>
            <br></br>
            <a href="https://console.x.ai/" target="_blank">
              (Follow this link to generate a new one)
            </a>
            <br></br>
          </>
        ),
        action: {
          type: "input",
          onChange: async (evt) => {
            unmountComponent(position);
            setTimeout(() => {
              GROK_API_KEY = evt.target.value;
              grokLibrary = initializeOpenAIAPI(
                GROK_API_KEY,
                "https://api.x.ai/v1",
              );
              updateAvailableModels();
            }, 200);
            setTimeout(() => {
              mountComponent(position);
            }, 200);
          },
        },
      },
      {
        id: "openrouterapi",
        name: "OpenRouter API Key",
        description: (
          <>
            <span>Copy here your OpenRouter API key</span>
            <br></br>
            <a href="https://openrouter.ai/keys" target="_blank">
              (Follow this link to generate a new one)
            </a>
          </>
        ),
        action: {
          type: "input",
          onChange: async (evt) => {
            unmountComponent(position);
            setTimeout(async () => {
              OPENROUTER_API_KEY = evt.target.value;
              openrouterLibrary = initializeOpenAIAPI(
                OPENROUTER_API_KEY,
                "https://openrouter.ai/api/v1",
              );
              openRouterModelsInfo = await getModelsInfo();
              registerOpenRouterModels(openRouterModelsInfo);
              updateAvailableModels();
            }, 200);
            setTimeout(() => {
              mountComponent(position);
            }, 200);
          },
        },
      },
      {
        id: "groqapi",
        name: "Groq API Key",
        description: (
          <>
            <span>Copy here your Groq API key:</span>
            <br></br>
            <a href="https://console.groq.com/keys" target="_blank">
              (Follow this link to generate a new one)
            </a>
          </>
        ),
        action: {
          type: "input",
          onChange: async (evt) => {
            unmountComponent(position);
            setTimeout(() => {
              GROQ_API_KEY = evt.target.value;
              groqLibrary = initializeOpenAIAPI(
                GROQ_API_KEY,
                "https://api.groq.com/openai/v1",
              );
              updateAvailableModels();
            }, 200);
            setTimeout(() => {
              mountComponent(position);
            }, 200);
          },
        },
      },
      {
        id: "modelMenuCustomization",
        name: "Customize Models",
        description:
          "Hide/show/reorder models in menu, pin favorites, set default, and manage custom models & endpoints.",
        action: {
          type: "button",
          onClick: () => {
            displayModelConfigDialog();
          },
          content: "Customize Models...",
        },
      },
      {
        id: "visibility",
        name: "Button visibility",
        description:
          "Button always visible (if not, you have to use commande palette or hotkeys, except on Mobile)",
        action: {
          type: "switch",
          onChange: (evt) => {
            isComponentAlwaysVisible = !isComponentAlwaysVisible;
            unmountComponent(position);
            mountComponent(position);
            if (
              window.innerWidth >= 500 &&
              ((isComponentAlwaysVisible && !isComponentVisible) ||
                (!isComponentAlwaysVisible && isComponentVisible))
            ) {
              toggleComponentVisibility();
              isComponentVisible = isComponentAlwaysVisible;
            }
          },
        },
      },
      {
        id: "position",
        name: "Button position",
        description: "Where do you want to display Assistant button ?",
        action: {
          type: "select",
          items: ["topbar", "left sidebar"],
          onChange: (evt) => {
            unmountComponent(position);
            removeContainer(position);
            position = evt === "topbar" ? "top" : "left";
            createContainer(position);
            mountComponent(position);
            if (!isComponentVisible) toggleComponentVisibility();
          },
        },
      },
      {
        id: "menuModKey",
        name: "Context menu",
        description:
          "Key to press while right-clicking to open Context menu (no needed when hover Live IA icons):",
        action: {
          type: "select",
          items: ["Meta", "Control", "Shift", "Alt", "disabled"],
          onChange: (evt) => {
            menuModifierKey = evt;
          },
        },
      },
      {
        id: "reasoningEffort",
        name: "Reasoning effort",
        description:
          "Default reasoning effort for thinking models (higher = more tokens & time). " +
          "Not every level is valid for every model — it is mapped per provider " +
          '("minimal" falls back to "low" on adaptive/Gemini/Grok models; "xhigh" ' +
          'is only distinct on GPT-5.6 and folds to "high" elsewhere). The ' +
          "in-chat thinking picker shows the exact levels for the selected model:",
        action: {
          type: "select",
          items: ["minimal", "low", "medium", "high", "xhigh", "max"],
          onChange: (evt) => {
            reasoningEffort = evt;
          },
        },
      },
      {
        id: "displayThinkingProcess",
        name: "Display thinking process",
        description:
          "Show the thinking process in a toast when using reasoning models (inline Ask AI only):",
        action: {
          type: "switch",
          onChange: () => {
            isThinkingProcessToDisplay = !isThinkingProcessToDisplay;
          },
        },
      },
      {
        id: "defaultStyle",
        name: "Default AI Style",
        description:
          "Choose the AI assistant character/style applied by default to each response",
        action: {
          type: "select",
          items: BUILTIN_STYLES.concat(customStyles.map((s) => s.title)),
          onChange: (evt) => {
            defaultStyle = evt;
          },
        },
      },
      {
        id: "temperature",
        name: "Temperature",
        description:
          "Customize the temperature (randomness) of models responses (0 is the most deterministic, 1 the most creative)",
        action: {
          type: "select",
          items: [
            "models default",
            "0",
            "0.1",
            "0.2",
            "0.3",
            "0.4",
            "0.5",
            "0.6",
            "0.7",
            "0.8",
            "0.9",
            "1",
          ],
          onChange: (evt) => {
            modelTemperature =
              evt === "models default" ? null : parseFloat(evt);
          },
        },
      },
      {
        id: "multiModal",
        name: "Multimodal AI (audio, images, video...)",
      },
      {
        id: "defaultImageModel",
        name: "Default image generation model",
        description:
          "Choose the default model for image generation. Falls back to gpt-image-1-mini if Google API key is missing:",
        action: {
          type: "select",
          items: imageGenerationModels,
          onChange: (evt) => {
            defaultImageModel = evt;
          },
        },
      },
      // Removed: Web search model is now automatically determined based on:
      // 1. If default model supports web search, use it
      // 2. Otherwise, use first visible web search model from same provider
      // 3. Otherwise, use first visible web search model from any provider
      {
        id: "transcriptionModel",
        name: "Voice transcription model",
        description:
          "Choose which voice transcription model to use. OpenAI models (gpt-transcribe, whisper-1…) need an OpenAI key; Gemini models need a Google key (the provider is selected automatically from the model). gpt-transcribe is recommended: more accurate and cheaper ($0.0045/min) than whisper-1 ($0.006/min): ",
        action: {
          type: "select",
          items: transcriptionModels,
          onChange: (evt) => {
            setTranscriptionModel(evt);
          },
        },
      },
      {
        id: "liveTranscription",
        name: "Live transcription (dictation on the go)",
        description: (
          <>
            <span>
              Add a button to transcribe your voice continuously and{" "}
              <b>insert the text as you speak in the focused block</b> (press
              Enter or click in another block to continue there). Requires an
              OpenAI API key.
            </span>
            <br></br>
            ⚠️ <b>More expensive</b>: billed per minute of microphone streaming,
            about 4x the cost of basic transcription (gpt-live-transcribe:
            ~$0.017/min, so ~$1 per hour). Don't forget to stop it when you're
            done !
          </>
        ),
        action: {
          type: "switch",
          onChange: () => {
            isLiveTranscriptionEnabled = !isLiveTranscriptionEnabled;
            if (!isLiveTranscriptionEnabled) stopLiveTranscription();
            unmountComponent(position);
            mountComponent(position);
          },
        },
      },
      {
        id: "liveTranscriptionModel",
        name: "Live transcription model",
        description: "Model used for live (streaming) transcription:",
        action: {
          type: "select",
          items: liveTranscriptionModels,
          onChange: (evt) => {
            liveTranscriptionModel = evt;
          },
        },
      },
      {
        id: "liveSilenceTimeout",
        name: "Pause live transcription on silence",
        description:
          "A live session is billed for every minute of audio streamed, silences included. After this much silence, the microphone stops being streamed (and resumes automatically as soon as you speak again, without reconnecting). 'Never' streams continuously until you stop it:",
        action: {
          type: "select",
          items: Object.keys(LIVE_SILENCE_TIMEOUTS),
          onChange: (evt) => {
            liveSilenceTimeout = evt;
          },
        },
      },
      {
        id: "liveAutoStopDelay",
        name: "Stop live transcription when unused",
        description:
          "Close the session after this long without a word dictated (counted from your last words, not from the pause, so reading for a while then dictating stays possible). Being paused costs nothing, but this avoids leaving the microphone open on a session you have forgotten — and a much later conversation waking it up:",
        action: {
          type: "select",
          items: Object.keys(LIVE_AUTO_STOP_DELAYS),
          onChange: (evt) => {
            liveAutoStopDelay = evt;
          },
        },
      },
      {
        id: "liveVoiceSensitivity",
        name: "Voice detection sensitivity",
        description:
          "How easily the microphone comes back on after a pause on silence. Lower it if typing on the keyboard or a background noise is enough to resume, raise it if you have to speak twice to be heard:",
        action: {
          type: "select",
          items: Object.keys(LIVE_VOICE_SENSITIVITY),
          onChange: (evt) => {
            liveVoiceSensitivity = evt;
          },
        },
      },
      {
        id: "liveTranscriptionDelay",
        name: "Live transcription latency",
        description:
          "Trade-off between how fast the text appears and how accurate it is ('minimal' is the fastest, 'xhigh' the most accurate):",
        action: {
          type: "select",
          items: ["minimal", "low", "medium", "high", "xhigh"],
          onChange: (evt) => {
            liveTranscriptionDelay = evt;
          },
        },
      },
      {
        id: "whisper",
        name: "Use AI transcription (cloud)",
        description:
          "Use a cloud AI speech-to-text model (paid service, OpenAI or Gemini depending on the selected transcription model) instead of the free system speech recognition:",
        action: {
          type: "switch",
          onChange: (evt) => {
            isUsingWhisper = !isUsingWhisper;
            unmountComponent(position);
            mountComponent(position);
          },
        },
      },
      {
        id: "groqwhisper",
        name: "Use Whisper via Groq",
        description:
          "If you have provided a Groq API key, `whisper-large-v3` model will replace `whisper-v1` for transcription.",
        action: {
          type: "switch",
          onChange: (evt) => {
            unmountComponent(position);
            isUsingGroqWhisper = !isUsingGroqWhisper;
            setTimeout(() => {
              mountComponent(position);
            }, 200);
          },
        },
      },
      {
        id: "transcriptionLgg",
        name: "Transcription language",
        className: "liveai-settings-smallinput",
        description: (
          <>
            <span>Your language code for better transcription (optional)</span>
            <br></br>
            e.g.: en, es, fr...{" "}
            <a
              href="https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes"
              target="_blank"
            >
              (See ISO 639-1 codes here)
            </a>
          </>
        ),
        action: {
          type: "input",
          onChange: (evt) => {
            transcriptionLanguage = getValidLanguageCode(evt.target.value);
          },
        },
      },
      {
        id: "speechLgg",
        name: "Language for browser recognition",
        description:
          "Applied when Whisper is disable. By default, it should be the language of your browser",
        action: {
          type: "select",
          items: webLangCodes,
          onChange: (evt) => {
            speechLanguage = evt;
            unmountComponent(position);
            mountComponent(position);
          },
        },
      },
      {
        id: "prompt",
        name: "Vocabulary for transcription",
        className: "liveai-settings-largeinput",
        description:
          "You can enter a list of specific words or proper nouns for better recognition and spelling (comma separated). With gpt-transcribe and live transcription, they are sent as `keywords` hints:",
        action: {
          type: "input",
          onChange: (evt) => {
            whisperPrompt = evt.target.value.trim();
          },
        },
      },
      {
        id: "ttsVoice",
        name: "Text to Speech voice",
        description: (
          <>
            <span>Choose the voice for OpenAI Text to Speech:"</span>
            <br></br>
            <a href="https://www.openai.fm/" target="_blank">
              (Test the available voices here on openai.fm)
            </a>
          </>
        ),
        action: {
          type: "select",
          items: [
            "alloy",
            "ash",
            "ballad",
            "coral",
            "echo",
            "fable",
            "onyx",
            "nova",
            "sage",
            "shimmer",
            "verse",
          ],
          onChange: (evt) => {
            ttsVoice = evt;
          },
        },
      },
      {
        id: "voiceInstructions",
        name: "Instructions for Speech to Text",
        className: "liveai-settings-largeinput",
        description:
          "Prompt to control aspects of speech, including: Accent, Emotional range, Intonation, Impressions, Speed of speech, Tone, Whispering: (text or ((block-ref))):",
        action: {
          type: "input",
          onChange: (evt) => {
            if (evt.target.value) {
              let input = evt.target.value;
              voiceInstructions = uidRegex.test(input)
                ? getFlattenedContentFromTree({
                    parentUid: input.slice(2, -2),
                    maxUid: 0,
                    withDash: false,
                  })
                : input;
              console.log(voiceInstructions);
            }
          },
        },
      },
      {
        id: "translateIcon",
        name: "Translate Icon",
        description: "Always display translate icon:",
        action: {
          type: "switch",
          onChange: (evt) => {
            isTranslateIconDisplayed = !isTranslateIconDisplayed;
            unmountComponent(position);
            mountComponent(position);
          },
        },
      },
      {
        id: "outlinerIcon",
        name: "Outliner Agent Icon",
        description:
          "Always display the Outliner Agent icon (it remains available with the 'O' key and in the Live AI context menu):",
        action: {
          type: "switch",
          onChange: () => {
            isOutlinerIconDisplayed = !isOutlinerIconDisplayed;
            unmountComponent(position);
            mountComponent(position);
          },
        },
      },
      {
        id: "inlineAI",
        name: "Options for inline AI",
      },
      {
        id: "chatRoles",
        name: "Chat roles",
        description:
          "Roles name inserted before your prompt and AI assistant answer, separated by a comma. Use <model> as placeholder for AI model name:",
        action: {
          type: "input",
          onChange: (evt) => {
            chatRoles = getRolesFromString(evt.target.value || "Me: ,AI: ");
          },
        },
      },
      {
        id: "streamResponse",
        name: "Stream response",
        description:
          "Stream responses of GPT models and OpenRouter streamable models:",
        action: {
          type: "switch",
          onChange: (evt) => {
            streamResponse = !streamResponse;
          },
        },
      },
      {
        id: "addTitleToResponse",
        name: "Add response title",
        description:
          "In the AI response header, add a title summarizing multi-line responses:",
        action: {
          type: "switch",
          onChange: (evt) => {
            isTitleToAdd = !isTitleToAdd;
          },
        },
      },
      {
        id: "splitResponse",
        name: "Split response in multiple blocks",
        description:
          "Divide the responses of the AI assistant into as many blocks as paragraphs",
        action: {
          type: "switch",
          onChange: (evt) => {
            isResponseToSplit = !isResponseToSplit;
          },
        },
      },
      {
        id: "includeChildrenByDefault",
        name: "Include children in prompt",
        description: "By default, include children of focused block in prompt:",
        action: {
          type: "switch",
          onChange: (evt) => {
            includeChildrenByDefault = !includeChildrenByDefault;
            unmountComponent(position);
            mountComponent(position);
          },
        },
      },
      {
        id: "alwaysExtractPdf",
        name: "Always extract attached files content",
        description:
          "Automatically extract and include the content of files found in the prompt or context (PDF, .md, .txt, .csv, code files, and .docx/.pptx with OpenAI models), without needing to check the Files checkbox each time",
        action: {
          type: "switch",
          onChange: () => {
            alwaysExtractPdf = !alwaysExtractPdf;
          },
        },
      },
      {
        id: "alwaysExtractQuery",
        name: "Always extract query results",
        description:
          "Automatically execute Roam queries and Datomic :q queries found in prompt/context and add results, without needing to check the Queries checkbox each time",
        action: {
          type: "switch",
          onChange: () => {
            alwaysExtractQuery = !alwaysExtractQuery;
          },
        },
      },
      {
        id: "uidsInPrompt",
        name: "Uids of blocks in promt/context",
        description:
          "Provide the uid of each block in multi-blocks or context to the LLM (default): ",
        action: {
          type: "switch",
          onChange: (evt) => {
            uidsInPrompt = !uidsInPrompt;
            unmountComponent(position);
            mountComponent(position);
          },
        },
      },
      {
        id: "contextInstructions",
        name: "Instructions on context",
        className: "liveai-settings-largeinput",
        description:
          "You can add some general instructions about how to use the context made by the selected notes: (text or ((block-ref))):",
        action: {
          type: "input",
          onChange: (evt) => {
            if (evt.target.value) {
              let input = evt.target.value;
              userContextInstructions = uidRegex.test(input)
                ? resolveReferences(getBlockContentByUid(input.slice(2, -2)))
                : input;
              console.log(userContextInstructions);
            }
          },
        },
      },
      {
        id: "exclusionStrings",
        name: "Blocks to exclude from context",
        description:
          "If blocks contain one of the following list (e.g.: #private, [[secret]]), " +
          "they and all their children are excluded from the context:",
        action: {
          type: "input",
          onChange: (evt) => {
            exclusionStrings = getArrayFromList(evt.target.value.trim());
          },
        },
      },
      {
        id: "maxCapturingDepth",
        name: "Maximum depth level",
        className: "liveai-settings-smallinput",
        description:
          "Maximum number of block levels to capture in context (one or three numbers separated by a comma respectively: " +
          "in pages, in linked ref., in DNP. 99 = no limit)",
        action: {
          type: "input",
          onChange: (evt) => {
            maxCapturingDepth = getMaxDephObjectFromList(evt.target.value);
          },
        },
      },
      {
        id: "maxUidDepth",
        name: "Maximum level with block ref.",
        className: "liveai-settings-smallinput",
        description:
          "Maximum level at which the block ref. is copied in the context (one or three numbers. 0 = no ref, 99 = not limit)",
        action: {
          type: "input",
          onChange: (evt) => {
            maxUidDepth = getMaxDephObjectFromList(evt.target.value);
          },
        },
      },
      {
        id: "logPagesNbDefault",
        name: "Number of previous days",
        className: "liveai-settings-smallinput",
        description:
          "Default number of previous daily note pages (DNP) used as context from Daily notes or any DNP",
        action: {
          type: "input",
          onChange: (evt) => {
            logPagesNbDefault = evt.target.value;
          },
        },
      },
      {
        id: "maxImages",
        name: "Images limit",
        className: "liveai-settings-smallinput",
        description:
          "Maximum number of images to process by models supporting Vision (e.g. GPT-4.1):",
        action: {
          type: "input",
          onChange: (evt) => {
            maxImagesNb = evt.target.value;
          },
        },
      },
      {
        id: "resImages",
        name: "Images input resolution",
        description:
          "Low resolution limits tokens/image to 85 with. Default: let the model choose:",
        action: {
          type: "select",
          items: ["auto", "high", "low"],
          onChange: (evt) => {
            resImages = evt;
          },
        },
      },
      {
        id: "aiAgents",
        name: "AI Agents",
      },
      {
        id: "askGraphMode",
        name: "Ask Your Graph privacy mode",
        description: (
          <>
            <span>
              Default privacy mode for "Ask your graph" Agent searches:
            </span>
            <br />
            <strong>Private:</strong> Only UIDs returned (no personal content
            processing by LLMs)
            <br />
            <strong>Balanced:</strong> Agent tools handle only UIDs +
            post-processing (only matching blocks processed by LLMs for final
            response)
            <br />
            <strong>Full Access:</strong> More complete content access for
            in-depth analysis
          </>
        ),
        action: {
          type: "select",
          items: ["Private", "Balanced", "Full Access"],
          onChange: (evt) => {
            askGraphMode = evt;
          },
        },
      },
      {
        id: "automaticSemanticExpansionMode",
        name: "Ask You Graph semantic expansion",
        description:
          "Default 'Ask your graph' Agent semantic expansion behavior:",
        action: {
          type: "select",
          items: [
            "Always ask user",
            "Automatic until result",
            "Always with fuzzy",
            "Always with synonyms",
            "Always with all",
          ],
          onChange: (evt) => {
            automaticSemanticExpansionMode = modeMap[evt];
          },
        },
      },
      {
        id: "mcpServers",
        name: "MCP Servers",
        description:
          "Configure MCP servers for external tools and capabilities.",
        action: {
          type: "button",
          onClick: () => {
            displayMCPConfigDialog();
          },
          content: "Configure MCP Servers...",
        },
      },
      {
        id: "enableLiveAI_API",
        name: "Enable Public API (window.LiveAI_API)",
        description:
          "Allow other Roam extensions to use Live AI models via window.LiveAI_API. API keys are never exposed.",
        action: {
          type: "switch",
          onChange: (evt) => {
            if (evt.target.checked) {
              initPublicApi();
            } else {
              cleanupPublicApi();
            }
          },
        },
      },
    ],
  };
  return panelConfig;
}

export default {
  onload: async ({ extensionAPI }) => {
    extensionStorage = extensionAPI.settings;

    // Initialize help depot after extensionStorage is ready
    initializeHelpDepot();

    // await extensionAPI.settings.panel.create(panelConfig);
    // get settings from setting panel
    if (extensionAPI.settings.get("visibility") === null)
      await extensionAPI.settings.set("visibility", true);
    isComponentAlwaysVisible = extensionAPI.settings.get("visibility");
    isComponentVisible =
      window.innerWidth < 500 ? true : isComponentAlwaysVisible;
    if (extensionAPI.settings.get("position") === null)
      await extensionAPI.settings.set("position", "left sidebar");
    position =
      extensionAPI.settings.get("position") === "topbar" ? "top" : "left";
    if (extensionAPI.settings.get("menuModKey") === null)
      await extensionAPI.settings.set("menuModKey", "Meta");
    menuModifierKey = extensionAPI.settings.get("menuModKey");
    if (extensionAPI.settings.get("temperature") === null)
      await extensionAPI.settings.set("temperature", "models default");
    modelTemperature =
      extensionAPI.settings.get("temperature") === "models default"
        ? null
        : parseInt(extensionAPI.settings.get("temperature"));
    if (extensionAPI.settings.get("whisper") === null)
      await extensionAPI.settings.set("whisper", true);
    isUsingWhisper = extensionAPI.settings.get("whisper");
    if (extensionAPI.settings.get("transcriptionModel") === null)
      await extensionAPI.settings.set("transcriptionModel", "gpt-transcribe");
    // One-time migration to gpt-transcribe: whisper-1 was the historical
    // default, inherited rather than chosen by most users, and the new model is
    // both more accurate and cheaper. Guarded by a flag so that re-selecting
    // whisper-1 afterwards is respected instead of being reset at each load.
    else if (!extensionAPI.settings.get("gptTranscribeMigration")) {
      if (extensionAPI.settings.get("transcriptionModel") === "whisper-1")
        await extensionAPI.settings.set("transcriptionModel", "gpt-transcribe");
    }
    if (!extensionAPI.settings.get("gptTranscribeMigration"))
      await extensionAPI.settings.set("gptTranscribeMigration", true);
    transcriptionModel = extensionAPI.settings.get("transcriptionModel");
    if (extensionAPI.settings.get("liveTranscription") === null)
      await extensionAPI.settings.set("liveTranscription", true);
    isLiveTranscriptionEnabled = extensionAPI.settings.get("liveTranscription");
    if (extensionAPI.settings.get("liveTranscriptionModel") === null)
      await extensionAPI.settings.set(
        "liveTranscriptionModel",
        liveTranscriptionModels[0],
      );
    liveTranscriptionModel = extensionAPI.settings.get(
      "liveTranscriptionModel",
    );
    if (extensionAPI.settings.get("liveTranscriptionDelay") === null)
      await extensionAPI.settings.set("liveTranscriptionDelay", "low");
    liveTranscriptionDelay = extensionAPI.settings.get(
      "liveTranscriptionDelay",
    );
    if (extensionAPI.settings.get("liveSilenceTimeout") === null)
      await extensionAPI.settings.set("liveSilenceTimeout", "10 sec.");
    liveSilenceTimeout = extensionAPI.settings.get("liveSilenceTimeout");
    if (extensionAPI.settings.get("liveVoiceSensitivity") === null)
      await extensionAPI.settings.set("liveVoiceSensitivity", "Medium");
    liveVoiceSensitivity = extensionAPI.settings.get("liveVoiceSensitivity");
    if (extensionAPI.settings.get("liveAutoStopDelay") === null)
      await extensionAPI.settings.set("liveAutoStopDelay", "30 min.");
    liveAutoStopDelay = extensionAPI.settings.get("liveAutoStopDelay");
    if (extensionAPI.settings.get("groqwhisper") === null)
      await extensionAPI.settings.set("groqwhisper", false);
    isUsingGroqWhisper = extensionAPI.settings.get("groqwhisper");
    if (extensionAPI.settings.get("openaiapi") === null)
      await extensionAPI.settings.set("openaiapi", "");
    OPENAI_API_KEY = extensionAPI.settings.get("openaiapi");
    if (!OPENAI_API_KEY) isUsingWhisper = false;
    if (extensionAPI.settings.get("openrouterapi") === null)
      await extensionAPI.settings.set("openrouterapi", "");
    OPENROUTER_API_KEY = extensionAPI.settings.get("openrouterapi");
    if (extensionAPI.settings.get("deepseekapi") === null)
      await extensionAPI.settings.set("deepseekapi", "");
    DEEPSEEK_API_KEY = extensionAPI.settings.get("deepseekapi");
    if (extensionAPI.settings.get("grokapi") === null)
      await extensionAPI.settings.set("grokapi", "");
    GROK_API_KEY = extensionAPI.settings.get("grokapi");
    if (extensionAPI.settings.get("googleapi") === null)
      await extensionAPI.settings.set("googleapi", "");
    GOOGLE_API_KEY = extensionAPI.settings.get("googleapi");
    if (extensionAPI.settings.get("openrouterOnly") === null)
      await extensionAPI.settings.set("openrouterOnly", false);
    openRouterOnly = extensionAPI.settings.get("openrouterOnly");
    if (extensionAPI.settings.get("anthropicapi") === null)
      await extensionAPI.settings.set("anthropicapi", "");
    ANTHROPIC_API_KEY = extensionAPI.settings.get("anthropicapi");
    if (extensionAPI.settings.get("groqapi") === null)
      await extensionAPI.settings.set("groqapi", "");
    GROQ_API_KEY = extensionAPI.settings.get("groqapi");
    if (extensionAPI.settings.get("transcriptionLgg") === null)
      await extensionAPI.settings.set("transcriptionLgg", "");
    transcriptionLanguage = getValidLanguageCode(
      extensionAPI.settings.get("transcriptionLgg"),
    );
    if (extensionAPI.settings.get("speechLgg") === null)
      await extensionAPI.settings.set("speechLgg", "Browser default");
    speechLanguage = extensionAPI.settings.get("speechLgg");
    if (extensionAPI.settings.get("prompt") === null)
      await extensionAPI.settings.set("prompt", "");
    whisperPrompt = extensionAPI.settings.get("prompt");
    if (extensionAPI.settings.get("translateIcon") === null)
      await extensionAPI.settings.set("translateIcon", false);
    isTranslateIconDisplayed = extensionAPI.settings.get("translateIcon");
    if (extensionAPI.settings.get("outlinerIcon") === null)
      await extensionAPI.settings.set("outlinerIcon", false);
    isOutlinerIconDisplayed = extensionAPI.settings.get("outlinerIcon");
    if (extensionAPI.settings.get("ttsVoice") === null)
      await extensionAPI.settings.set("ttsVoice", "Ash");
    ttsVoice = extensionAPI.settings.get("ttsVoice");
    if (extensionAPI.settings.get("voiceInstructions") === null)
      await extensionAPI.settings.set("voiceInstructions", "");
    voiceInstructions = extensionAPI.settings.get("voiceInstructions");
    if (extensionAPI.settings.get("defaultModel") === null)
      // Fresh install: no stored default yet. Derive it from the registry
      // (OpenAI's `preferredDefault` model, or another keyed provider's).
      await extensionAPI.settings.set("defaultModel", getInitialDefaultModel());
    else if (
      extensionAPI.settings.get("defaultModel") === "gemini-3-pro-preview"
    )
      await extensionAPI.settings.set("defaultModel", "gemini-3.1-pro-preview");
    defaultModel = extensionAPI.settings.get("defaultModel");
    if (extensionAPI.settings.get("reasoningEffort") === null)
      await extensionAPI.settings.set("reasoningEffort", "low");
    reasoningEffort = extensionAPI.settings.get("reasoningEffort");
    if (extensionAPI.settings.get("displayThinkingProcess") === null)
      await extensionAPI.settings.set("displayThinkingProcess", false);
    isThinkingProcessToDisplay = extensionAPI.settings.get(
      "displayThinkingProcess",
    );
    if (extensionAPI.settings.get("alwaysExtractPdf") === null)
      await extensionAPI.settings.set("alwaysExtractPdf", false);
    alwaysExtractPdf = extensionAPI.settings.get("alwaysExtractPdf");
    if (extensionAPI.settings.get("alwaysExtractQuery") === null)
      await extensionAPI.settings.set("alwaysExtractQuery", false);
    alwaysExtractQuery = extensionAPI.settings.get("alwaysExtractQuery");
    if (extensionAPI.settings.get("customBaseUrl") === null)
      await extensionAPI.settings.set("customBaseUrl", "");
    customBaseURL = extensionAPI.settings.get("customBaseUrl");
    if (extensionAPI.settings.get("customOpenAIOnly") === null)
      await extensionAPI.settings.set("customOpenAIOnly", true);
    customOpenAIOnly = extensionAPI.settings.get("customOpenAIOnly");
    // Initialize customEndpointEnabled based on legacy settings (customBaseURL + customOpenAIOnly)
    // This will be overridden by model config if available
    customEndpointEnabled = !!customBaseURL;
    // Migrate to new model configuration system (now includes V2 migration)
    await migrateModelConfig();

    // Get model config for reading new V2 settings
    const modelConfig = getModelConfig();

    // Read endpoint configurations from V2 config (with fallback to settings panel for backward compat)
    const openaiEndpoint = modelConfig.providerEndpoints?.openai;
    if (openaiEndpoint && openaiEndpoint.baseURL) {
      customBaseURL = openaiEndpoint.baseURL;
      // enabled: makes custom endpoint available for custom models
      // exclusive: route ALL OpenAI-compatible calls through custom endpoint (replaces official API)
      customEndpointEnabled = openaiEndpoint.enabled ?? false;
      customOpenAIOnly = openaiEndpoint.exclusive ?? false;
    }

    const ollamaEndpoint = modelConfig.providerEndpoints?.ollama;
    if (ollamaEndpoint && ollamaEndpoint.baseURL) {
      ollamaServer = ollamaEndpoint.baseURL;
    }

    // Check for model updates (deprecated models, new models)
    const updateInfo = checkModelUpdates();
    if (updateInfo.deprecatedInUse.length > 0) {
      // Show migration dialog after a short delay to let the UI settle
      setTimeout(() => {
        displayModelMigrationDialog(
          updateInfo.deprecatedInUse,
          async (migrations) => {
            await applyModelMigrations(migrations);
          },
        );
      }, 2000);
    }

    // Update model lists from new config (migration has already run, so modelConfig is authoritative)
    openAiCustomModels =
      modelConfig.customModels?.openai?.map((m) => m.id) || [];
    openRouterModels =
      modelConfig.customModels?.openrouter?.map((m) => m.id) || [];
    groqModels = modelConfig.customModels?.groq?.map((m) => m.id) || [];
    ollamaModels = modelConfig.customModels?.ollama?.map((m) => m.id) || [];

    if (extensionAPI.settings.get("ollamaServer") === null)
      await extensionAPI.settings.set("ollamaServer", "");
    ollamaServer = extensionAPI.settings.get("ollamaServer");
    if (extensionAPI.settings.get("chatRoles") === null)
      await extensionAPI.settings.set(
        "chatRoles",
        "Me: ,AI assistant (<model>): ",
      );
    const chatRolesStr = extensionAPI.settings.get("chatRoles");
    if (extensionAPI.settings.get("defaultStyle") === null)
      await extensionAPI.settings.set("defaultStyle", "Normal");
    defaultStyle = extensionAPI.settings.get("defaultStyle");
    if (extensionAPI.settings.get("contextInstructions") === null)
      await extensionAPI.settings.set("contextInstructions", "");
    userContextInstructions = extensionAPI.settings.get("contextInstructions");
    if (extensionAPI.settings.get("streamResponse") === null)
      await extensionAPI.settings.set("streamResponse", true);
    streamResponse = extensionAPI.settings.get("streamResponse");
    if (extensionAPI.settings.get("addTitleToResponse") === null)
      await extensionAPI.settings.set("addTitleToResponse", true);
    isTitleToAdd = extensionAPI.settings.get("addTitleToResponse");
    if (extensionAPI.settings.get("splitResponse") === null)
      await extensionAPI.settings.set("splitResponse", true);
    isResponseToSplit = extensionAPI.settings.get("splitResponse");
    if (extensionAPI.settings.get("includeChildrenByDefault") === null)
      await extensionAPI.settings.set("includeChildrenByDefault", false);
    includeChildrenByDefault = extensionAPI.settings.get(
      "includeChildrenByDefault",
    );
    if (extensionAPI.settings.get("uidsInPrompt") === null)
      await extensionAPI.settings.set("uidsInPrompt", true);
    uidsInPrompt = extensionAPI.settings.get("uidsInPrompt");
    if (extensionAPI.settings.get("maxImages") === null)
      await extensionAPI.settings.set("maxImages", "3");
    maxImagesNb = extensionAPI.settings.get("maxImages");
    if (extensionAPI.settings.get("logPagesNbDefault") === null)
      await extensionAPI.settings.set("logPagesNbDefault", 7);
    logPagesNbDefault = extensionAPI.settings.get("logPagesNbDefault");

    // Semantic expansion mode setting for search agent
    if (extensionAPI.settings.get("automaticSemanticExpansionMode") === null)
      await extensionAPI.settings.set(
        "automaticSemanticExpansionMode",
        "auto_until_result",
      );
    const rawExpansionMode = extensionAPI.settings.get(
      "automaticSemanticExpansionMode",
    );
    automaticSemanticExpansionMode =
      modeMap[rawExpansionMode] || rawExpansionMode;
    if (extensionAPI.settings.get("maxCapturingDepth") === null)
      await extensionAPI.settings.set("maxCapturingDepth", "99,3,4");
    maxCapturingDepth = getMaxDephObjectFromList(
      extensionAPI.settings.get("maxCapturingDepth"),
    );
    if (extensionAPI.settings.get("maxUidDepth") === null)
      await extensionAPI.settings.set("maxUidDepth", "99,2,3");
    maxUidDepth = getMaxDephObjectFromList(
      extensionAPI.settings.get("maxUidDepth"),
    );
    if (extensionAPI.settings.get("exclusionStrings") === null)
      await extensionAPI.settings.set("exclusionStrings", "");
    exclusionStrings = getArrayFromList(
      extensionAPI.settings.get("exclusionStrings"),
    );
    if (extensionAPI.settings.get("resImages") === null)
      await extensionAPI.settings.set("resImages", "auto");
    resImages = extensionAPI.settings.get("resImages");
    if (extensionAPI.settings.get("defaultImageModel") === null)
      await extensionAPI.settings.set(
        "defaultImageModel",
        "gemini-3.1-flash-image-preview",
      );
    defaultImageModel = extensionAPI.settings.get("defaultImageModel");
    // Removed: webModel is now automatically determined based on default model and configuration
    // if (extensionAPI.settings.get("webContext") === null)
    //   await extensionAPI.settings.set("webContext", "medium");
    // websearchContext = extensionAPI.settings.get("webContext");
    if (extensionAPI.settings.get("askGraphMode") === null)
      await extensionAPI.settings.set("askGraphMode", "Balanced");
    askGraphMode = extensionAPI.settings.get("askGraphMode");

    // Initialize Ask your graph session
    const { initializeAskGraphSession } =
      await import("./ai/agents/search-agent/ask-your-graph");
    initializeAskGraphSession();

    // Check if first time using Ask your graph
    if (extensionAPI.settings.get("askGraphFirstTime") === null) {
      await extensionAPI.settings.set("askGraphFirstTime", true);
    }

    // persistant variables for context menu
    if (extensionAPI.settings.get("translationCustomLgg") === null)
      await extensionAPI.settings.set("translationCustomLgg", "");
    if (extensionAPI.settings.get("translationDefaultLgg") === null)
      await extensionAPI.settings.set("translationDefaultLgg", "English");

    // await extensionAPI.settings.set("tokensCounter", null);
    if (extensionAPI.settings.get("tokensCounter") === null)
      updateTokenCounter(undefined, {});

    extensionStorage.set("outlinerRootUid", null);

    // extensionAPI.settings.set("conversationHistory", null);
    if (extensionAPI.settings.get("conversationHistory") === null)
      await extensionAPI.settings.set("conversationHistory", []);

    // extensionAPI.settings.set("commandCounter", null);
    if (extensionAPI.settings.get("commandCounter") === null)
      await extensionAPI.settings.set("commandCounter", {
        counter: [],
        last: null,
      });

    // set FullResultsPopup as side panel by default
    if (extensionAPI.settings.get("fullResultsPopup_sidePanelMode") === null)
      await extensionAPI.settings.set("fullResultsPopup_sidePanelMode", "true");

    // Initialize chat enabled tools (first install only)
    if (extensionAPI.settings.get("chatEnabledTools") === null)
      await extensionAPI.settings.set("chatEnabledTools", ["add_to_context"]);

    createContainer();

    // Initialize OpenAI library:
    // - If exclusive mode: all OpenAI API calls use custom endpoint
    // - Otherwise: use official OpenAI API
    if (OPENAI_API_KEY || (customBaseURL && customOpenAIOnly))
      openaiLibrary = initializeOpenAIAPI(
        OPENAI_API_KEY,
        customOpenAIOnly ? customBaseURL : null,
      );
    // Initialize custom OpenAI library for custom models (only if enabled and NOT exclusive)
    // When exclusive is true, all calls already go through custom endpoint via openaiLibrary
    if (customBaseURL && customEndpointEnabled && !customOpenAIOnly)
      customOpenaiLibrary = initializeOpenAIAPI(OPENAI_API_KEY, customBaseURL);
    if (ANTHROPIC_API_KEY)
      anthropicLibrary = initializeAnthropicAPI(ANTHROPIC_API_KEY);
    if (DEEPSEEK_API_KEY)
      deepseekLibrary = initializeOpenAIAPI(
        DEEPSEEK_API_KEY,
        "https://api.deepseek.com/v1",
      );
    if (GROK_API_KEY)
      grokLibrary = initializeOpenAIAPI(GROK_API_KEY, "https://api.x.ai/v1");
    if (GOOGLE_API_KEY) {
      googleLibrary = initializeGoogleAPI(GOOGLE_API_KEY);
    }

    if (OPENROUTER_API_KEY) {
      openrouterLibrary = initializeOpenAIAPI(
        OPENROUTER_API_KEY,
        "https://openrouter.ai/api/v1",
      );
      openRouterModelsInfo = await getModelsInfo();
      registerOpenRouterModels(openRouterModelsInfo);
    }
    if (GROQ_API_KEY) {
      groqLibrary = initializeOpenAIAPI(
        GROQ_API_KEY,
        "https://api.groq.com/openai/v1",
      );
    }
    chatRoles = getRolesFromString(chatRolesStr, defaultModel);

    customStyles = getCustomStyles();

    // Load remote model updates from GitHub
    await loadRemoteModelUpdates();

    updateAvailableModels();
    // console.log("availableModels :>> ", availableModels);

    console.log("defaultModel :>> ", defaultModel);

    loadRoamExtensionCommands(extensionAPI);

    // mcpManager.initialize(extensionStorage);

    mountComponent(position);
    if (!isComponentAlwaysVisible) toggleComponentVisibility();

    // Initialize window.LiveAI if it doesn't exist (don't overwrite existing functions)
    if (!window.LiveAI) window.LiveAI = {};

    // Initialize public API if enabled in settings
    if (extensionAPI.settings.get("enableLiveAI_API")) {
      initPublicApi();
    }

    initializeContextMenu();

    // Add navigation listeners for Ask Linked References button
    addPageNavigationListeners();
    // Initial call to insert button on current page
    onPageLoad();

    // Connect query observer for Ask Query buttons
    connectQueryObserver();

    await extensionAPI.settings.panel.create(getPanelConfig());

    console.log("Extension loaded.");
  },
  onunload: async () => {
    // Close the microphone & the Realtime socket first: they would otherwise
    // outlive the extension (and keep being billed).
    await stopLiveTranscription();

    unmountComponent(position);
    removeContainer(position);

    cleanupContextMenu();

    // Remove navigation listeners
    removePageNavigationListeners();

    // Disconnect query observer
    disconnectQueryObserver();

    // Disconnect all MCP servers (close WebSocket/SSE connections)
    await mcpManager.disconnectAll();

    // Clean up public API
    cleanupPublicApi();

    // Clean up all window object properties (prevent memory leaks)
    cleanupAllWindowStorage();

    // Terminate local embedding worker and release model memory
    await disposeLocal();

    console.log("Extension unloaded");
  },
};
