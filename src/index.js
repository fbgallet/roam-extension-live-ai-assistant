import React from "react";
import ReactDOM from "react-dom";
import App from "./App";
import {
  getTemplateForPostProcessing,
  gptCompletion,
  gptPostProcessing,
  initializeOpenAIAPI,
  insertCompletion,
  supportedLanguage,
} from "./openai";
import { getSpeechRecognitionAPI, webLangCodes } from "./audio";
import {
  createChildBlock,
  getAndNormalizeContext,
  getBlockContentByUid,
  getFirstChildUid,
  getFlattenedContentFromLinkedReferences,
  getFlattenedContentFromSidebar,
  getFocusAndSelection,
  getMainPageUid,
  getRoamContextFromPrompt,
  insertBlockInCurrentView,
  isLogView,
  resolveReferences,
  simulateClick,
  uidRegex,
} from "./utils/utils";
import {
  contextAsPrompt,
  defaultAssistantCharacter,
  defaultContextInstructions,
  specificContentPromptBeforeTemplate,
} from "./utils/prompts";

export const tokensLimit = {
  "gpt-3.5-turbo": 16385,
  "gpt-4-turbo-preview": 131073,
  custom: undefined,
};

let OPENAI_API_KEY = "";
export let isUsingWhisper;
export let transcriptionLanguage;
export let speechLanguage;
export let whisperPrompt;
export let isTranslateIconDisplayed;
export let gptModel;
export let gptCustomModel;
export let chatRoles;
export let assistantCharacter = defaultAssistantCharacter;
export let contextInstruction = defaultContextInstructions;
export let userContextInstructions;
export let isMobileViewContext;
export let isResponseToSplit;
let isComponentAlwaysVisible;
let isComponentVisible;
let position;
let openai;
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
      openai={openai}
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

function getRolesFromString(str) {
  let splittedStr = str ? str.split(",") : [];
  return {
    user: splittedStr[0],
    assistant:
      splittedStr.length > 1 ? splittedStr[1].trimStart() : "AI assistant: ",
  };
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
      tabTitle: "Speech-to-Roam",
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
          name: "OpenAI API Key",
          description: (
            <>
              <span>Copy here your OpenAI API key </span>
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
                openai = initializeOpenAIAPI(OPENAI_API_KEY);
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
              const lgg = evt.target.value.toLowerCase().trim();
              transcriptionLanguage = supportedLanguage.includes(lgg)
                ? lgg
                : "";
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
          id: "gptModel",
          name: "OpenAI Chat Completion Model",
          description:
            "Choose a model or 'custom model' to be specified below:",
          action: {
            type: "select",
            items: ["gpt-3.5-turbo", "gpt-4-turbo-preview", "custom model"],
            onChange: (evt) => {
              gptModel = evt;
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
          id: "chatRoles",
          name: "Chat roles",
          description:
            "Roles name (or header) inserted, in Roam blocks, before your prompt and GPT model answer, separated by a coma:",
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
    if (extensionAPI.settings.get("transcriptionLgg") === null)
      await extensionAPI.settings.set("transcriptionLgg", "");
    transcriptionLanguage = extensionAPI.settings.get("transcriptionLgg");
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
      extensionAPI.settings.get("gptModel") === null ||
      extensionAPI.settings.get("gptModel") === "gpt-3.5-turbo-1106"
    )
      await extensionAPI.settings.set("gptModel", "gpt-3.5-turbo");
    gptModel = extensionAPI.settings.get("gptModel");
    if (extensionAPI.settings.get("gptCustomModel") === null)
      await extensionAPI.settings.set("gptCustomModel", "");
    gptCustomModel = extensionAPI.settings.get("gptCustomModel");
    if (extensionAPI.settings.get("chatRoles") === null)
      await extensionAPI.settings.set("chatRoles", "Me: ,AI assistant: ");
    const chatRolesStr =
      extensionAPI.settings.get(chatRoles) || "Me: ,AI assistant: ";
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
    if (OPENAI_API_KEY) openai = initializeOpenAIAPI(OPENAI_API_KEY);
    createContainer();

    await extensionAPI.settings.panel.create(panelConfig);

    extensionAPI.ui.commandPalette.addCommand({
      label: "Speech-to-Roam: Start/Pause recording your vocal note",
      callback: () => {
        simulateClickOnRecordingButton();
      },
    });
    extensionAPI.ui.commandPalette.addCommand({
      label: `Speech-to-Roam: Transcribe your vocal note${
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
      label: "Speech-to-Roam: Translate to English",
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
      label: "Speech-to-Roam: Transcribe & send as prompt for GPT assistant",
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

    // extensionAPI.ui.commandPalette.addCommand({
    //   label: "Speech-to-Roam: insert inline Speech-to-Roam component",
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
        "Speech-to-Roam: Toggle visibility of the button (not permanently)",
      callback: () => {
        isComponentVisible = !isComponentVisible;
        unmountComponent();
        mountComponent();
        toggleComponentVisibility();
      },
    });

    extensionAPI.ui.commandPalette.addCommand({
      label:
        "Speech-to-Roam: (text only) AI completion of current block as prompt & selection as context",
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
        const inlineContext = getRoamContextFromPrompt(currentBlockContent);
        if (inlineContext) prompt = inlineContext.updatedPrompt;
        let context = await getAndNormalizeContext(
          currentUid & selectionUids.length ? null : currentUid,
          selectionUids,
          inlineContext?.roamContext
        );
        insertCompletion(prompt, openai, targetUid, context);
      },
    });

    extensionAPI.ui.commandPalette.addCommand({
      label:
        "Speech-to-Roam: (text only) template-based AI completion with children blocks as prompt & current block as content",
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
        let targetUid = getFirstChildUid(currentUid);
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

        insertCompletion(
          prompt,
          openai,
          targetUid,
          context,
          template.isInMultipleBlocks ? gptPostProcessing : gptCompletion,
          true
        );
      },
    });

    extensionAPI.ui.commandPalette.addCommand({
      label: "Speech-to-Roam: Get linked refs",
      callback: async () => {
        const pageUid = await getMainPageUid();
        getFlattenedContentFromLinkedReferences(pageUid);
      },
    });

    extensionAPI.ui.commandPalette.addCommand({
      label: "Speech-to-Roam: Get sidebar content",
      callback: () => {
        getFlattenedContentFromSidebar();
      },
    });

    extensionAPI.ui.commandPalette.addCommand({
      label: "Speech-to-Roam: Get DNPs",
      callback: async () => {
        // getFlattenedContentFromLog();
        isLogView();
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
