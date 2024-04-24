import React from "react";
import ReactDOM from "react-dom";
import App from "./App";
import {
  copyTemplate,
  getTemplateForPostProcessing,
  getValidLanguageCode,
  initializeAnthropicAPI,
  initializeOpenAIAPI,
  insertCompletion,
  lastCompletion,
} from "./ai/aiCommands";
import { getSpeechRecognitionAPI, webLangCodes } from "./audio/audio";
import {
  createChildBlock,
  getAndNormalizeContext,
  getArrayFromList,
  getBlockContentByUid,
  getFirstChildUid,
  getFocusAndSelection,
  getMaxDephObjectFromList,
  getRoamContextFromPrompt,
  getTemplateFromPrompt,
  insertBlockInCurrentView,
  isExistingBlock,
  resolveReferences,
  uidRegex,
} from "./utils/utils";
import {
  contextAsPrompt,
  defaultAssistantCharacter,
  defaultContextInstructions,
  specificContentPromptBeforeTemplate,
} from "./ai/prompts";
import { AppToaster } from "./components/VoiceRecorder";

export const tokensLimit = {
  "gpt-3.5-turbo": 16385,
  "gpt-4-turbo-preview": 131073,
  "Claude Haiku": 200000,
  "Claude Sonnet": 200000,
  "Claude Opus": 200000,
  custom: undefined,
};

let OPENAI_API_KEY = "";
export let ANTHROPIC_API_KEY = "";
export let isUsingWhisper;
export let transcriptionLanguage;
export let speechLanguage;
export let whisperPrompt;
export let isTranslateIconDisplayed;
export let defaultModel;
export let gptCustomModel;
export let chatRoles;
export let assistantCharacter = defaultAssistantCharacter;
export let contextInstruction = defaultContextInstructions;
export let userContextInstructions;
export let isMobileViewContext;
export let isResponseToSplit;
export let logPagesNbDefault;
export let maxCapturingDepth = {};
export let maxUidDepth = {};
export let exclusionStrings = [];
export let defaultTemplate;
export let streamResponse = true;
let isComponentAlwaysVisible;
let isComponentVisible;
let position;
export let openaiLibrary, anthropicLibrary;
export let isSafari =
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ||
  window.roamAlphaAPI.platform.isIOS;
console.log("isSafari :>> ", isSafari);

function mountComponent(props) {
  let currentBlockUid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
  let container = document.querySelector(
    `.speech-to-roam-container-${position}`
  );

  if (!container || props?.isInline) {
    createContainer(
      props?.isInline,
      currentBlockUid ? document.activeElement : null
    );
    if (!props?.isInline) return mountComponent();
    else container = document.querySelector(`.speech-to-roam-container-inline`);
  }
  if (!props) {
    props = {};
    // props.transcribeOnly = isTranslateIconDisplayed ? false : true;
  }
  // No access to microphone in mobile App and desktop App on MacOs
  // so speech-to-roam doesn't work at all in this context
  props.worksOnPlatform =
    (window.roamAlphaAPI.platform.isDesktop &&
      !window.roamAlphaAPI.platform.isPC) ||
    window.roamAlphaAPI.platform.isMobileApp
      ? false
      : true;

  // Web API speech recognition doesn't work on Electron app nor Firefox nor Arc browser
  props.position = position;
  props.mic =
    !window.roamAlphaAPI.platform.isDesktop &&
    navigator.userAgent.indexOf("Firefox") === -1 &&
    !getComputedStyle(document.documentElement).getPropertyValue(
      "--arc-palette-background"
    ) // specific to Arc browser
      ? getSpeechRecognitionAPI()
      : null;

  // isSafari = true;

  ReactDOM.render(
    <App
      blockUid={currentBlockUid}
      isVisible={isComponentVisible}
      {...props}
    />,
    container
  );
}

function unmountComponent() {
  const node = document.querySelector(`.speech-to-roam-container-${position}`);
  if (node) ReactDOM.unmountComponentAtNode(node);
}

function createContainer(isInline, activeElement) {
  // console.log("activeElement:", activeElement);
  // if (isInline)
  //   activeElement = document.getElementById(
  //     "block-input-Ex3lB2F6lbcG2lBxdsJzPNzQXn53-body-outline-12-08-2023-HzvQSfNhv"
  //   );
  const rootPosition = isInline
    ? activeElement
    : position === "top"
    ? document.querySelector(".rm-topbar")
    : document.querySelector(".roam-sidebar-content");
  const newElt = document.createElement("span");
  position === "left" && newElt.classList.add("log-button");
  newElt.classList.add(
    "speech-to-roam",
    `speech-to-roam-container-${isInline ? "inline" : position}`
  );
  if (isInline) {
    rootPosition.parentElement.insertBefore(newElt, rootPosition);
    return;
  }
  const todayTomorrowExtension = document.querySelector("#todayTomorrow");
  if (todayTomorrowExtension && position === "top")
    todayTomorrowExtension.insertAdjacentElement("afterend", newElt);
  else
    rootPosition.insertBefore(
      newElt,
      position === "top"
        ? rootPosition.firstChild
        : document.querySelector(".rm-left-sidebar__daily-notes").nextSibling
    );
}

function removeContainer() {
  const container = document.querySelector(
    `.speech-to-roam-container-${position}`
  );
  if (container) container.remove();
}

function getRolesFromString(str, model) {
  let splittedStr = str ? str.split(",") : [];
  return {
    defaultStr: str,
    user: splittedStr[0],
    assistant:
      splittedStr.length > 1
        ? splittedStr[1].trimStart().replace("<model>", model || defaultModel)
        : "AI assistant: ",
  };
}

export function getInstantAssistantRole(instantModel) {
  const { assistant } = getRolesFromString(chatRoles.defaultStr, instantModel);
  return assistant;
}

export function toggleComponentVisibility() {
  let componentElt = document.getElementsByClassName("speech-to-roam")[0];
  if (!componentElt) return;
  componentElt.style.display === "none"
    ? (componentElt.style.display = "inherit")
    : (componentElt.style.display = "none");
}

function simulateClickOnRecordingButton() {
  const button = document.getElementsByClassName("speech-record-button")[0];
  if (
    !isComponentVisible &&
    document.getElementsByClassName("speech-to-roam")[0]?.style.display ===
      "none"
  ) {
    toggleComponentVisibility();
    if (position === "left") window.roamAlphaAPI.ui.leftSidebar.open();
  }
  if (button) {
    button.focus();
    button.click();
  }
}

export default {
  onload: async ({ extensionAPI }) => {
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
              unmountComponent();
              mountComponent();
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
          description: "Where do you want to display Speech-to-Roam button ?",
          action: {
            type: "select",
            items: ["topbar", "left sidebar"],
            onChange: (evt) => {
              unmountComponent();
              removeContainer();
              position = evt === "topbar" ? "top" : "left";
              createContainer();
              mountComponent();
              if (!isComponentVisible) toggleComponentVisibility();
            },
          },
        },
        {
          id: "whisper",
          name: "Use Whisper API",
          description:
            "Use Whisper API (paid service) for transcription. If disabled, free system speech recognition will be used:",
          action: {
            type: "switch",
            onChange: (evt) => {
              isUsingWhisper = !isUsingWhisper;
              unmountComponent();
              mountComponent();
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
            onChange: (evt) => {
              unmountComponent();
              setTimeout(() => {
                OPENAI_API_KEY = evt.target.value;
                openaiLibrary = initializeOpenAIAPI(OPENAI_API_KEY);
                if (extensionAPI.settings.get("whisper") === true)
                  isUsingWhisper = true;
              }, 200);
              setTimeout(() => {
                mountComponent();
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
            </>
          ),
          action: {
            type: "input",
            onChange: (evt) => {
              unmountComponent();
              setTimeout(() => {
                ANTHROPIC_API_KEY = evt.target.value;
                anthropicLibrary = initializeAnthropicAPI(ANTHROPIC_API_KEY);
                // if (extensionAPI.settings.get("whisper") === true)
                //   isUsingWhisper = true;
              }, 200);
              setTimeout(() => {
                mountComponent();
              }, 200);
            },
          },
        },
        {
          id: "transcriptionLgg",
          name: "Transcription language",
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
              unmountComponent();
              mountComponent();
            },
          },
        },
        {
          id: "prompt",
          name: "Prompt for Whisper",
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
              unmountComponent();
              mountComponent();
            },
          },
        },
        {
          id: "defaultModel",
          name: "AI assistant Model",
          description:
            "Choose a model or 'custom model' to be specified below:",
          action: {
            type: "select",
            items: [
              "gpt-3.5-turbo",
              "gpt-4-turbo-preview",
              "Claude Haiku",
              "Claude Sonnet",
              "Claude Opus",
              "custom model",
            ],
            onChange: (evt) => {
              defaultModel = evt;
              chatRoles = getRolesFromString(
                extensionAPI.settings.get("chatRoles")
              );
            },
          },
        },
        {
          id: "customModel",
          name: "Custom model",
          description: "⚠️ Only OpenAI Chat completion models are compatible",
          action: {
            type: "input",
            onChange: (evt) => {
              gptCustomModel = evt;
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
          description:
            "You can describe here the character and tone of the AI assistant (text or ((block-ref))):",
          action: {
            type: "input",
            onChange: (evt) => {
              if (evt.target.value) {
                let input = evt.target.value;
                assistantCharacter = uidRegex.test(input)
                  ? resolveReferences(getBlockContentByUid(input.slice(2, -2)))
                  : input;
                console.log(assistantCharacter);
              }
            },
          },
        },
        {
          id: "defaultTemplate",
          name: "Default template for post-processing",
          description:
            "If no template is provide in the block or in children, follow this template for GPT model response (copy its parent ((block reference))):",
          action: {
            type: "input",
            onChange: (evt) => {
              let input = evt.target.value;
              uidRegex.lastIndex = 0;
              if (uidRegex.test(input)) {
                let templateUid = input.replace("((", "").replace("))", "");
                if (!isExistingBlock(templateUid)) {
                  AppToaster.show({
                    message: "This block doesn't exist !",
                    timeout: 5000,
                  });
                  defaultTemplate = "";
                  extensionAPI.settings.set("defaultTemplate", "");
                } else defaultTemplate = templateUid;
              } else {
                if (input.trim())
                  AppToaster.show({
                    message:
                      "You have to enter a ((block reference)) of an existing block.",
                    timeout: 5000,
                  });
                extensionAPI.settings.set("defaultTemplate", "");
                defaultTemplate = "";
              }
            },
          },
        },
        {
          id: "contextInstructions",
          name: "Instructions on context",
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
          description:
            "Maximum level at which the block ref. is copied in the context (one or three numbers. 0 = no ref, 99 = not limit)",
          action: {
            type: "input",
            onChange: (evt) => {
              maxUidDepth = getMaxDephObjectFromList(evt.target.value);
              console.log("maxUidDepth :>> ", maxUidDepth);
            },
          },
        },
        {
          id: "logPagesNbDefault",
          name: "Number of previous days",
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
          id: "mobileContext",
          name: "View is context on mobile",
          description:
            "On mobile, the content of all blocks in current view is provided to ChatGPT as the context:",
          action: {
            type: "switch",
            onChange: (evt) => {
              isMobileViewContext = !isMobileViewContext;
            },
          },
        },
      ],
    };

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
    if (extensionAPI.settings.get("whisper") === null)
      await extensionAPI.settings.set("whisper", true);
    isUsingWhisper = extensionAPI.settings.get("whisper");
    if (extensionAPI.settings.get("openaiapi") === null)
      await extensionAPI.settings.set("openaiapi", "");
    OPENAI_API_KEY = extensionAPI.settings.get("openaiapi");
    if (!OPENAI_API_KEY) isUsingWhisper = false;
    if (extensionAPI.settings.get("anthropicapi") === null)
      await extensionAPI.settings.set("anthropicapi", "");
    ANTHROPIC_API_KEY = extensionAPI.settings.get("anthropicapi");
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
      extensionAPI.settings.get("defaultModel") === "gpt-3.5-turbo-1106"
    )
      await extensionAPI.settings.set("defaultModel", "gpt-3.5-turbo");
    defaultModel = extensionAPI.settings.get("defaultModel");
    if (extensionAPI.settings.get("gptCustomModel") === null)
      await extensionAPI.settings.set("gptCustomModel", "");
    gptCustomModel = extensionAPI.settings.get("gptCustomModel");
    if (extensionAPI.settings.get("chatRoles") === null)
      await extensionAPI.settings.set(
        "chatRoles",
        "Me: ,AI assistant (<model>): "
      );
    const chatRolesStr =
      extensionAPI.settings.get(chatRoles) || "Me: ,AI assistant (<model>): ";
    chatRoles = getRolesFromString(chatRolesStr);
    if (extensionAPI.settings.get("assistantCharacter") === null)
      await extensionAPI.settings.set("assistantCharacter", assistantCharacter);
    assistantCharacter = extensionAPI.settings.get("assistantCharacter");
    if (extensionAPI.settings.get("contextInstructions") === null)
      await extensionAPI.settings.set("contextInstructions", "");
    userContextInstructions = extensionAPI.settings.get("contextInstructions");
    if (extensionAPI.settings.get("mobileContext") === null)
      await extensionAPI.settings.set("mobileContext", false);
    isMobileViewContext = extensionAPI.settings.get("mobileContext");
    if (extensionAPI.settings.get("splitResponse") === null)
      await extensionAPI.settings.set("splitResponse", true);
    isResponseToSplit = extensionAPI.settings.get("splitResponse");
    if (extensionAPI.settings.get("defaultTemplate") === null)
      await extensionAPI.settings.set("defaultTemplate", "");
    let templateInput = extensionAPI.settings.get("defaultTemplate");
    uidRegex.lastIndex = 0;
    if (uidRegex.test(templateInput))
      defaultTemplate = templateInput.replace("((", "").replace("))", "");
    else {
      defaultTemplate = "";
      extensionAPI.settings.set("defaultTemplate", "");
    }
    if (extensionAPI.settings.get("logPagesNbDefault") === null)
      await extensionAPI.settings.set("logPagesNbDefault", 7);
    logPagesNbDefault = extensionAPI.settings.get("logPagesNbDefault");
    if (extensionAPI.settings.get("maxCapturingDepth") === null)
      await extensionAPI.settings.set("maxCapturingDepth", "99,2,3");
    maxCapturingDepth = getMaxDephObjectFromList(
      extensionAPI.settings.get("maxCapturingDepth")
    );
    if (extensionAPI.settings.get("maxUidDepth") === null)
      await extensionAPI.settings.set("maxUidDepth", "99,1,2");
    maxUidDepth = getMaxDephObjectFromList(
      extensionAPI.settings.get("maxUidDepth")
    );
    if (extensionAPI.settings.get("exclusionStrings") === null)
      await extensionAPI.settings.set("exclusionStrings", "");
    exclusionStrings = getArrayFromList(
      extensionAPI.settings.get("exclusionStrings")
    );

    if (OPENAI_API_KEY) openaiLibrary = initializeOpenAIAPI(OPENAI_API_KEY);
    // if (ANTHROPIC_API_KEY) anthropicLibrary = initializeAnthropicAPI(ANTHROPIC_API_KEY);

    createContainer();

    await extensionAPI.settings.panel.create(panelConfig);

    extensionAPI.ui.commandPalette.addCommand({
      label: "Live AI Assistant: Start/Pause recording your vocal note",
      callback: () => {
        simulateClickOnRecordingButton();
      },
    });
    extensionAPI.ui.commandPalette.addCommand({
      label: `Live AI Assistant: Transcribe your vocal note${
        isUsingWhisper ? " with Whisper" : ""
      }`,
      callback: () => {
        const button = document.getElementsByClassName("speech-transcribe")[0];
        if (button) {
          button.focus();
          button.click();
          if (
            !isComponentVisible &&
            document.getElementsByClassName("speech-to-roam")[0]?.style
              .display !== "none"
          )
            toggleComponentVisibility();
        } else simulateClickOnRecordingButton();
      },
    });
    extensionAPI.ui.commandPalette.addCommand({
      label: "Live AI Assistant: Translate to English",
      callback: () => {
        const button = document.getElementsByClassName("speech-translate")[0];
        if (button) {
          button.focus();
          button.click();
          if (
            !isComponentVisible &&
            document.getElementsByClassName("speech-to-roam")[0]?.style
              .display !== "none"
          )
            toggleComponentVisibility();
        } else simulateClickOnRecordingButton();
      },
    });
    extensionAPI.ui.commandPalette.addCommand({
      label: "Live AI Assistant: Transcribe & send as prompt to AI assistant",
      callback: () => {
        const button = document.getElementsByClassName("speech-completion")[0];
        if (button) {
          button.focus();
          button.click();
          if (
            !isComponentVisible &&
            document.getElementsByClassName("speech-to-roam")[0]?.style
              .display !== "none"
          )
            toggleComponentVisibility();
        } else simulateClickOnRecordingButton();
      },
    });

    extensionAPI.ui.commandPalette.addCommand({
      label:
        "Live AI Assistant: Transcribe & send as content for templated-based AI post-processing",
      callback: () => {
        const button = document.getElementsByClassName(
          "speech-post-processing"
        )[0];
        if (button) {
          button.focus();
          button.click();
          if (
            !isComponentVisible &&
            document.getElementsByClassName("speech-to-roam")[0]?.style
              .display !== "none"
          )
            toggleComponentVisibility();
        } else simulateClickOnRecordingButton();
      },
    });

    // extensionAPI.ui.commandPalette.addCommand({
    //   label: "Live AI Assistant: insert inline Speech-to-Roam component",
    //   callback: () => {
    //     // console.log(document.activeElement);
    //     mountComponent({ isInline: true });
    //     // document.getElementsByClassName("speech-record-button")
    //     //   ? (unmountComponent(),
    //     //     mountComponent({ startRecording: true, completionOnly: true }))
    //     //   : mountComponent();
    //   },
    // });

    extensionAPI.ui.commandPalette.addCommand({
      label:
        "Live AI Assistant: Toggle visibility of the button (not permanently)",
      callback: () => {
        isComponentVisible = !isComponentVisible;
        unmountComponent();
        mountComponent();
        toggleComponentVisibility();
      },
    });

    extensionAPI.ui.commandPalette.addCommand({
      label:
        "Live AI Assistant: (text) AI completion of focused block as prompt & selection as context",
      callback: async () => {
        const { currentUid, currentBlockContent, selectionUids } =
          getFocusAndSelection();
        if (!currentUid && !selectionUids.length) return;
        let targetUid = currentUid
          ? await createChildBlock(currentUid, chatRoles.assistant)
          : await insertBlockInCurrentView(
              chatRoles.user + " a selection of blocks"
            );
        let prompt = currentBlockContent
          ? currentBlockContent
          : contextAsPrompt;
        console.log("currentBlockContent :>> ", currentBlockContent);
        const inlineContext = currentBlockContent
          ? getRoamContextFromPrompt(currentBlockContent)
          : null;
        if (inlineContext) prompt = inlineContext.updatedPrompt;
        console.log("inlineContext :>> ", inlineContext);
        let context = await getAndNormalizeContext(
          // currentUid && selectionUids.length ? null : currentUid,
          null,
          selectionUids,
          inlineContext?.roamContext,
          currentUid
        );
        insertCompletion(prompt, targetUid, context, "gptCompletion");
      },
    });

    extensionAPI.ui.commandPalette.addCommand({
      label:
        "Live AI Assistant: (text) template-based AI post-processing, children as prompt template & focused block as content",
      callback: async () => {
        let { currentUid, currentBlockContent, selectionUids } =
          getFocusAndSelection();
        if (!currentUid) {
          if (selectionUids.length) currentUid = selectionUids[0];
          else return;
        }

        const inlineContext = getRoamContextFromPrompt(currentBlockContent);
        if (inlineContext) currentBlockContent = inlineContext.updatedPrompt;
        let context = await getAndNormalizeContext(
          null,
          selectionUids,
          inlineContext?.roamContext
        );

        // simulateClick(document.querySelector(".roam-body-main"));
        let targetUid;
        let waitForBlockCopy = false;
        if (currentBlockContent) {
          let inlineTemplate = getTemplateFromPrompt(
            getBlockContentByUid(currentUid)
          );
          // console.log("inlineTemplate :>> ", inlineTemplate);
          if (inlineTemplate) {
            await copyTemplate(currentUid, inlineTemplate.templateUid);
            currentBlockContent = resolveReferences(
              inlineTemplate.updatedPrompt
            );
            waitForBlockCopy = true;
          } else {
            targetUid = getFirstChildUid(currentUid);
            if (!targetUid) {
              await copyTemplate(currentUid);
              waitForBlockCopy = true;
            }
          }
        }
        setTimeout(
          async () => {
            let template = await getTemplateForPostProcessing(currentUid);
            if (!template.isInMultipleBlocks) {
              targetUid = createChildBlock(
                targetUid ? targetUid : currentUid,
                chatRoles.assistant,
                inlineContext?.roamContext
              );
              currentUid = targetUid;
            }
            let prompt = template.isInMultipleBlocks
              ? specificContentPromptBeforeTemplate +
                currentBlockContent +
                "\n\n" +
                template.stringified
              : template.stringified;

            if (!targetUid) targetUid = getFirstChildUid(currentUid);

            insertCompletion(
              prompt,
              // waitForBlockCopy ? currentUid : targetUid,
              targetUid,
              context,
              template.isInMultipleBlocks
                ? "gptPostProcessing"
                : "gptCompletion"
            );
          },
          waitForBlockCopy ? 100 : 0
        );
      },
    });

    extensionAPI.ui.commandPalette.addCommand({
      label: "Live AI Assistant: Redo last AI completion (update response)",
      callback: () => {
        if (lastCompletion.prompt) {
          const focusUid =
            window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
          const targetUid = focusUid ? focusUid : lastCompletion.targetUid;
          console.log("lastCompletion :>> ", lastCompletion);
          insertCompletion(
            lastCompletion.prompt,
            targetUid,
            lastCompletion.context,
            lastCompletion.typeOfCompletion,
            lastCompletion.instantModel,
            true
          );
        }
      },
    });

    // Add SmartBlock command
    const insertCmd = {
      text: "SPEECHTOROAM",
      help: "Start recording a vocal note using Speech-to-Roam extension",
      handler: (context) => () => {
        simulateClickOnRecordingButton();
        return [""];
      },
    };
    if (window.roamjs?.extension?.smartblocks) {
      window.roamjs.extension.smartblocks.registerCommand(insertCmd);
    } else {
      document.body.addEventListener(`roamjs:smartblocks:loaded`, () => {
        window.roamjs?.extension.smartblocks &&
          window.roamjs.extension.smartblocks.registerCommand(insertCmd);
      });
    }

    mountComponent();
    if (!isComponentAlwaysVisible) toggleComponentVisibility();

    console.log("Extension loaded.");
    //return;
  },
  onunload: async () => {
    unmountComponent();
    removeContainer();
    // disconnectObserver();
    console.log("Extension unloaded");
  },
};
