import {
  initializeAnthropicAPI,
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
} from "./utils/domElts";
import { loadRoamExtensionCommands } from "./utils/roamExtensionCommands";
import { getModelsInfo, updateTokenCounter } from "./ai/modelsInfo";
import {
  BUILTIN_STYLES,
  cleanupContextMenu,
  customStyleTitles,
  initializeContextMenu,
} from "./components/ContextMenu";
import { getValidLanguageCode } from "./ai/languagesSupport";
import {
  getArrayFromList,
  getMaxDephObjectFromList,
} from "./ai/dataExtraction";
import { uidRegex } from "./utils/regex";

export let OPENAI_API_KEY = "";
export let ANTHROPIC_API_KEY = "";
export let DEEPSEEK_API_KEY = "";
export let GOOGLE_API_KEY = "";
export let OPENROUTER_API_KEY = "";
export let GROQ_API_KEY = "";
export let isUsingWhisper;
export let isUsingGroqWhisper;
export let transcriptionLanguage;
export let speechLanguage;
export let whisperPrompt;
export let isTranslateIconDisplayed;
export let defaultModel;
export let customBaseURL;
export let modelTemperature;
export let openRouterOnly;
export let ollamaModels = [];
export let ollamaServer;
export let groqModels = [];
export let chatRoles;
export let assistantCharacter = defaultAssistantCharacter;
export let defaultStyle;
export let contextInstruction = defaultContextInstructions;
export let userContextInstructions;
// export let isMobileViewContext;
export let isResponseToSplit;
export let logPagesNbDefault;
export let maxCapturingDepth = {};
export let maxUidDepth = {};
export let exclusionStrings = [];
// export let defaultTemplate;
export let streamResponse;
export let maxImagesNb;
export let openAiCustomModels = [];
export let openRouterModelsInfo = [];
export let openRouterModels = [];
export let isComponentAlwaysVisible;
export let isComponentVisible;
export let resImages;
export let position;
export let openaiLibrary,
  anthropicLibrary,
  openrouterLibrary,
  groqLibrary,
  deepseekLibrary,
  googleLibrary;
export let isSafari =
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ||
  window.roamAlphaAPI.platform.isIOS;

export let extensionStorage;

export function setDefaultModel(str) {
  defaultModel = str;
  extensionStorage.set("defaultModel", str);
  chatRoles = getRolesFromString(
    extensionStorage.get("chatRoles"),
    defaultModel.includes("first") ? undefined : defaultModel
  );
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
      model = defaultModel.includes("first") ? "gpt-4o-mini" : defaultModel;
    }
  }
  model = modelAccordingToProvider(model);
  return {
    model,
    defaultStr: str,
    user: splittedStr[0],
    assistant:
      splittedStr.length > 1
        ? splittedStr[1].trimStart().replace("<model>", model?.name || "")
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
  let conversationHistory = extensionStorage.get("conversationHistory");
  if (conversationHistory.find((conv) => conv.uid === uid)) return;
  // conversation storage is limited to 30
  if (conversationHistory.length > 30) {
    conversationHistory = conversationHistory.shift();
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

export async function incrementCommandCounter(commandId) {
  const commandUsage = extensionStorage.get("commandCounter");
  const existingCommand = commandUsage?.counter?.find(
    (cmd) => cmd.id === commandId
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

export default {
  onload: async ({ extensionAPI }) => {
    extensionStorage = extensionAPI.settings;
    const panelConfig = {
      tabTitle: "Live AI Assistant",
      settings: [
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
          id: "defaultModel",
          name: "Default AI assistant model",
          description:
            "Choose the default model for AI completion with simple click or hotkeys:",
          action: {
            type: "select",
            items: [
              "gpt-4o-mini",
              "gpt-4o",
              "o3-mini",
              "Claude Haiku",
              "Claude Haiku 3.5",
              "Claude Sonnet 3.5",
              "deepseek-chat",
              "first custom OpenAI model",
              "first OpenRouter model",
              "first Ollama local model",
              "first Groq model",
            ],
            onChange: (evt) => {
              setDefaultModel(evt);
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
            items: BUILTIN_STYLES.concat(customStyleTitles),
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
          id: "openaiapi",
          name: "OpenAI API Key (GPT)",
          description: (
            <>
              <span>
                Copy here your OpenAI API key for Whisper & GPT models
              </span>
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
                if (extensionAPI.settings.get("whisper") === true)
                  isUsingWhisper = true;
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
                  "https://api.deepseek.com"
                );
              }, 200);
              setTimeout(() => {
                mountComponent(position);
              }, 200);
            },
          },
        },
        // {
        //   id: "googleapi",
        //   name: "Google API Key",
        //   description: (
        //     <>
        //       <span>Copy here your Google Gemini API key</span>
        //       <br></br>
        //       <a href="https://aistudio.google.com/app/apikey" target="_blank">
        //         (Follow this link to generate a new one)
        //       </a>
        //       <br></br>
        //     </>
        //   ),
        //   action: {
        //     type: "input",
        //     onChange: async (evt) => {
        //       unmountComponent(position);
        //       setTimeout(() => {
        //         GOOGLE_API_KEY = evt.target.value;
        //         googleLibrary = initializeOpenAIAPI(
        //           GOOGLE_API_KEY,
        //           "https://generativelanguage.googleapis.com/v1beta/openai/"
        //         );
        //       }, 200);
        //       setTimeout(() => {
        //         mountComponent(position);
        //       }, 200);
        //     },
        //   },
        // },
        {
          id: "whisper",
          name: "Use Whisper API",
          description:
            "Use Whisper API (paid service) for transcription. If disabled, free system speech recognition will be used:",
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
          id: "transcriptionLgg",
          name: "Transcription language",
          className: "liveai-settings-smallinput",
          description: (
            <>
              <span>
                Your language code for better transcription (optional)
              </span>
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
          name: "Prompt for Whisper",
          className: "liveai-settings-largeinput",
          description:
            "You can enter a list of specific words or proper nouns for better recognition and spelling:",
          action: {
            type: "input",
            onChange: (evt) => {
              whisperPrompt = evt.target.value.trim();
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
        // DEPRECATED IN V.12
        // {
        //   id: "mobileContext",
        //   name: "View is context on mobile",
        //   description:
        //     "On mobile, the content of all blocks in current view is provided to ChatGPT as the context:",
        //   action: {
        //     type: "switch",
        //     onChange: (evt) => {
        //       isMobileViewContext = !isMobileViewContext;
        //     },
        //   },
        // },
        {
          id: "chatRoles",
          name: "Chat roles",
          description:
            "Roles name inserted before your prompt and AI assistant answer, separated by a coma. Use <model> as placeholder for AI model name:",
          action: {
            type: "input",
            onChange: (evt) => {
              if (evt.target.value)
                chatRoles = getRolesFromString(evt.target.value);
            },
          },
        },
        {
          id: "assistantCharacter",
          name: "Assistant's character",
          className: "liveai-settings-largeinput",
          description:
            "(DEPRECATED, WILL BE REMOVED IN NEXT UPDATE, replace it by a custom style) You can describe here the character and tone of the AI assistant (text or ((block-ref))):",
          action: {
            type: "input",
            onChange: (evt) => {
              // if (evt.target.value) {
              //   let input = evt.target.value;
              //   uidRegex.lastIndex = 0;
              //   assistantCharacter = uidRegex.test(input)
              //     ? resolveReferences(getBlockContentByUid(input.slice(2, -2)))
              //     : input;
              //   console.log(assistantCharacter);
              // }
            },
          },
        },
        // DEPRECATED IN V.12
        // {
        //   id: "defaultTemplate",
        //   name: "Default template for post-processing",
        //   description:
        //     "If no template is provide in the block or in children, follow this template for GPT model response (copy its parent ((block reference))):",
        //   action: {
        //     type: "input",
        //     onChange: (evt) => {
        //       let input = evt.target.value;
        //       uidRegex.lastIndex = 0;
        //       if (uidRegex.test(input)) {
        //         let templateUid = input.replace("((", "").replace("))", "");
        //         if (!isExistingBlock(templateUid)) {
        //           AppToaster.show({
        //             message: "This block doesn't exist !",
        //             timeout: 5000,
        //           });
        //           defaultTemplate = "";
        //           extensionAPI.settings.set("defaultTemplate", "");
        //         } else defaultTemplate = templateUid;
        //       } else {
        //         if (input.trim())
        //           AppToaster.show({
        //             message:
        //               "You have to enter a ((block reference)) of an existing block.",
        //             timeout: 5000,
        //           });
        //         extensionAPI.settings.set("defaultTemplate", "");
        //         defaultTemplate = "";
        //       }
        //     },
        //   },
        // },
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
            "Maximum number of images to process by models supporting Vision (e.g. GPT-4o):",
          action: {
            type: "input",
            onChange: (evt) => {
              maxImagesNb = evt.target.value;
            },
          },
        },
        {
          id: "resImages",
          name: "Images resolution",
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
          id: "customBaseUrl",
          name: "Custom OpenAI baseURL",
          description:
            "Use your own API baseURL instead of default OpenAI URL (namely: https://api.openai.com/v1)",
          action: {
            type: "input",
            onChange: (evt) => {
              customBaseURL = evt.target.value;
              openaiLibrary = initializeOpenAIAPI(
                OPENAI_API_KEY,
                customBaseURL
              );
              unmountComponent(position);
              mountComponent(position);
            },
          },
        },
        {
          id: "customModel",
          name: "Custom OpenAI models",
          className: "liveai-settings-largeinput",
          description:
            "List of models, separated by a command (e.g.: o1-preview):",
          action: {
            type: "input",
            onChange: (evt) => {
              openAiCustomModels = getArrayFromList(evt.target.value);
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
                  "https://openrouter.ai/api/v1"
                );
                openRouterModelsInfo = await getModelsInfo();
              }, 200);
              setTimeout(() => {
                mountComponent(position);
              }, 200);
            },
          },
        },
        {
          id: "openrouterOnly",
          name: "OpenRouter Only",
          description:
            "Display only models provided by OpenRouter in context menu (OpenAI API Key is still needed for Whisper):",
          action: {
            type: "switch",
            onChange: (evt) => {
              openRouterOnly = !openRouterOnly;
              unmountComponent(position);
              mountComponent(position);
            },
          },
        },
        {
          id: "openRouterModels",
          name: "Models via OpenRouter",
          className: "liveai-settings-largeinput",
          description: (
            <>
              <span>
                List of models ID to query through OpenRouter, separated by a
                comma. E.g: google/gemini-pro,mistralai/mistral-7b-instruct
              </span>
              <br></br>
              <a href="https://openrouter.ai/docs#models" target="_blank">
                List of supported models here
              </a>
            </>
          ),
          action: {
            type: "input",
            onChange: async (evt) => {
              openRouterModels = getArrayFromList(evt.target.value);
              openRouterModelsInfo = await getModelsInfo();
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
                  "https://api.groq.com/openai/v1"
                );
              }, 200);
              setTimeout(() => {
                mountComponent(position);
              }, 200);
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
              isUsingGroqWhisper = !isUsingGroqWhisper;
              unmountComponent(position);
              mountComponent(position);
            },
          },
        },
        {
          id: "groqModels",
          name: "Models via Groq API",
          className: "liveai-settings-largeinput",
          description: (
            <>
              <span>
                List of models ID to query through Groq API, separated by a
                comma.
              </span>
              <br></br>
              <a href="https://console.groq.com/docs/models" target="_blank">
                List of supported models here
              </a>
            </>
          ),
          action: {
            type: "input",
            onChange: async (evt) => {
              groqModels = getArrayFromList(evt.target.value);
            },
          },
        },
        {
          id: "ollamaModels",
          name: "Ollama local models",
          className: "liveai-settings-largeinput",
          description:
            "Models on local server, separated by a comma. E.g: llama2,llama3",
          action: {
            type: "input",
            onChange: (evt) => {
              ollamaModels = getArrayFromList(evt.target.value);
            },
          },
        },
        {
          id: "ollamaServer",
          name: "Ollama server",
          description:
            "You can customize your server's local address here. Default (blank input) is http://localhost:11434",
          action: {
            type: "input",
            onChange: (evt) => {
              ollamaServer =
                evt.target.value.at(-1) === "/"
                  ? evt.target.value.slice(0, -1)
                  : evt.target.value;
            },
          },
        },
      ],
    };

    await extensionAPI.settings.panel.create(panelConfig);
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
    if (extensionAPI.settings.get("temperature") === null)
      await extensionAPI.settings.set("temperature", "models default");
    modelTemperature =
      extensionAPI.settings.get("temperature") === "models default"
        ? null
        : parseInt(extensionAPI.settings.get("temperature"));
    if (extensionAPI.settings.get("whisper") === null)
      await extensionAPI.settings.set("whisper", true);
    isUsingWhisper = extensionAPI.settings.get("whisper");
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
    // if (extensionAPI.settings.get("googleapi") === null)
    //   await extensionAPI.settings.set("googleapi", "");
    // GOOGLE_API_KEY = extensionAPI.settings.get("googleapi");
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
      extensionAPI.settings.get("transcriptionLgg")
    );
    if (extensionAPI.settings.get("speechLgg") === null)
      await extensionAPI.settings.set("speechLgg", "Browser default");
    speechLanguage = extensionAPI.settings.get("speechLgg");
    if (extensionAPI.settings.get("prompt") === null)
      await extensionAPI.settings.set("prompt", "");
    whisperPrompt = extensionAPI.settings.get("prompt");
    if (extensionAPI.settings.get("translateIcon") === null)
      await extensionAPI.settings.set("translateIcon", true);
    isTranslateIconDisplayed = extensionAPI.settings.get("translateIcon");
    if (
      extensionAPI.settings.get("defaultModel") === null ||
      extensionAPI.settings.get("defaultModel") === "gpt-3.5-turbo"
    )
      await extensionAPI.settings.set("defaultModel", "gpt-4o-mini");
    defaultModel = extensionAPI.settings.get("defaultModel");
    if (extensionAPI.settings.get("customBaseUrl") === null)
      await extensionAPI.settings.set("customBaseUrl", "");
    customBaseURL = extensionAPI.settings.get("customBaseUrl");
    if (extensionAPI.settings.get("customModel") === null)
      await extensionAPI.settings.set("customModel", "");
    openAiCustomModels = getArrayFromList(
      extensionAPI.settings.get("customModel")
    );
    if (extensionAPI.settings.get("openRouterModels") === null)
      await extensionAPI.settings.set("openRouterModels", "");
    openRouterModels = getArrayFromList(
      extensionAPI.settings.get("openRouterModels")
    );
    if (extensionAPI.settings.get("groqModels") === null)
      await extensionAPI.settings.set("groqModels", "");
    groqModels = getArrayFromList(extensionAPI.settings.get("groqModels"));
    if (extensionAPI.settings.get("ollamaModels") === null)
      await extensionAPI.settings.set("ollamaModels", "");
    ollamaModels = getArrayFromList(extensionAPI.settings.get("ollamaModels"));
    if (extensionAPI.settings.get("ollamaServer") === null)
      await extensionAPI.settings.set("ollamaServer", "");
    ollamaServer = extensionAPI.settings.get("ollamaServer");
    if (extensionAPI.settings.get("chatRoles") === null)
      await extensionAPI.settings.set(
        "chatRoles",
        "Me: ,AI assistant (<model>): "
      );
    const chatRolesStr = extensionAPI.settings.get("chatRoles");
    //if (extensionAPI.settings.get("assistantCharacter") === null)
    //   await extensionAPI.settings.set("assistantCharacter", assistantCharacter);
    // assistantCharacter = extensionAPI.settings.get("assistantCharacter");
    if (extensionAPI.settings.get("defaultStyle") === null)
      await extensionAPI.settings.set("defaultStyle", "Normal");
    defaultStyle = extensionAPI.settings.get("defaultStyle");
    if (extensionAPI.settings.get("contextInstructions") === null)
      await extensionAPI.settings.set("contextInstructions", "");
    userContextInstructions = extensionAPI.settings.get("contextInstructions");
    // if (extensionAPI.settings.get("mobileContext") === null)
    //   await extensionAPI.settings.set("mobileContext", false);
    // isMobileViewContext = extensionAPI.settings.get("mobileContext");
    if (extensionAPI.settings.get("splitResponse") === null)
      await extensionAPI.settings.set("splitResponse", true);
    isResponseToSplit = extensionAPI.settings.get("splitResponse");
    if (extensionAPI.settings.get("streamResponse") === null)
      await extensionAPI.settings.set("streamResponse", true);
    streamResponse = extensionAPI.settings.get("streamResponse");
    if (extensionAPI.settings.get("maxImages") === null)
      await extensionAPI.settings.set("maxImages", "3");
    maxImagesNb = extensionAPI.settings.get("maxImages");
    // if (extensionAPI.settings.get("defaultTemplate") === null)
    //   await extensionAPI.settings.set("defaultTemplate", "");
    // let templateInput = extensionAPI.settings.get("defaultTemplate");
    // uidRegex.lastIndex = 0;
    // if (uidRegex.test(templateInput))
    //   defaultTemplate = templateInput.replace("((", "").replace("))", "");
    // else {
    //   defaultTemplate = "";
    //   extensionAPI.settings.set("defaultTemplate", "");
    // }
    if (extensionAPI.settings.get("logPagesNbDefault") === null)
      await extensionAPI.settings.set("logPagesNbDefault", 7);
    logPagesNbDefault = extensionAPI.settings.get("logPagesNbDefault");
    if (extensionAPI.settings.get("maxCapturingDepth") === null)
      await extensionAPI.settings.set("maxCapturingDepth", "99,3,3");
    maxCapturingDepth = getMaxDephObjectFromList(
      extensionAPI.settings.get("maxCapturingDepth")
    );
    if (extensionAPI.settings.get("maxUidDepth") === null)
      await extensionAPI.settings.set("maxUidDepth", "99,2,2");
    maxUidDepth = getMaxDephObjectFromList(
      extensionAPI.settings.get("maxUidDepth")
    );
    if (extensionAPI.settings.get("exclusionStrings") === null)
      await extensionAPI.settings.set("exclusionStrings", "");
    exclusionStrings = getArrayFromList(
      extensionAPI.settings.get("exclusionStrings")
    );
    if (extensionAPI.settings.get("resImages") === null)
      await extensionAPI.settings.set("resImages", "auto");
    resImages = extensionAPI.settings.get("resImages");

    // persistant variables for context menu
    if (extensionAPI.settings.get("translationCustomLgg") === null)
      await extensionAPI.settings.set("translationCustomLgg", "");
    if (extensionAPI.settings.get("translationDefaultLgg") === null)
      await extensionAPI.settings.set("translationDefaultLgg", "English");

    if (extensionAPI.settings.get("tokensCounter") === null)
      updateTokenCounter(undefined, {});
    console.log(
      "Tokens usage :>> ",
      extensionAPI.settings.get("tokensCounter")
    );
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

    createContainer();

    if (OPENAI_API_KEY)
      openaiLibrary = initializeOpenAIAPI(OPENAI_API_KEY, customBaseURL);
    if (ANTHROPIC_API_KEY)
      anthropicLibrary = initializeAnthropicAPI(ANTHROPIC_API_KEY);
    if (DEEPSEEK_API_KEY)
      deepseekLibrary = initializeOpenAIAPI(
        DEEPSEEK_API_KEY,
        "https://api.deepseek.com"
      );
    // if (GOOGLE_API_KEY)
    //   googleLibrary = initializeOpenAIAPI(
    //     GOOGLE_API_KEY,
    //     "https://generativelanguage.googleapis.com/v1beta/openai/"
    //   );
    if (OPENROUTER_API_KEY) {
      openrouterLibrary = initializeOpenAIAPI(
        OPENROUTER_API_KEY,
        "https://openrouter.ai/api/v1"
      );
      openRouterModelsInfo = await getModelsInfo();
    }
    if (GROQ_API_KEY) {
      groqLibrary = initializeOpenAIAPI(
        GROQ_API_KEY,
        "https://api.groq.com/openai/v1"
      );
    }
    chatRoles = getRolesFromString(chatRolesStr, defaultModel);

    console.log("defaultModel :>> ", defaultModel);

    loadRoamExtensionCommands(extensionAPI);

    mountComponent(position);
    if (!isComponentAlwaysVisible) toggleComponentVisibility();

    window.LiveAI = {};
    initializeContextMenu();

    console.log("Extension loaded.");
  },
  onunload: async () => {
    unmountComponent(position);
    removeContainer(position);

    cleanupContextMenu();

    console.log("Extension unloaded");
  },
};
