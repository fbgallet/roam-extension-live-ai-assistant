import React from "react";
import ReactDOM from "react-dom";
import App from "./App";
import { initializeOpenAIAPI, supportedLanguage } from "./openai";
import { getSpeechRecognitionAPI, webLangCodes } from "./audio";

export let OPENAI_API_KEY = "";
export let isUsingWhisper;
export let transcriptionLanguage;
export let speechLanguage;
export let whisperPrompt;
export let isTranslateIconDisplayed;
export let gptModel;
export let gptCustomModel;
export let chatRoles;
let position;

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
  // Web API speech recognition doesn't work on Electron app nor Firefox browser
  props.position = position;
  props.mic =
    !window.roamAlphaAPI.platform.isDesktop &&
    navigator.userAgent.indexOf("Firefox") === -1
      ? getSpeechRecognitionAPI()
      : null;

  console.log("container", container);
  ReactDOM.render(<App blockUid={currentBlockUid} {...props} />, container);
}

function unmountComponent() {
  const node = document.querySelector(`.speech-to-roam-container-${position}`);
  if (node) ReactDOM.unmountComponentAtNode(node);
}

function createContainer(isInline, activeElement) {
  // console.log("activeElement:", activeElement);
  if (isInline)
    activeElement = document.getElementById(
      "block-input-Ex3lB2F6lbcG2lBxdsJzPNzQXn53-body-outline-12-08-2023-HzvQSfNhv"
    );
  console.log(activeElement);
  const rootPosition = isInline
    ? activeElement
    : position === "top"
    ? document.querySelector(".rm-topbar")
    : document.querySelector(".roam-sidebar-content");
  const newElt = document.createElement("span");
  newElt.classList.add(
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
      : document.querySelector(".starred-pages-wrapper")
  );
}

function removeContainer() {
  const container = document.querySelector(
    `.speech-to-roam-container-${position}`
  );
  if (container) container.remove();
}

const panelConfig = {
  tabTitle: "___",
  settings: [
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
            (Follow this link to retrieve it or create a new one.)
          </a>
        </>
      ),
      action: {
        type: "input",
        onChange: (evt) => {
          OPENAI_API_KEY = evt.target.value;
          initializeOpenAIAPI();
          unmountComponent();
          mountComponent();
        },
      },
    },
    {
      id: "transcriptionLgg",
      name: "Transcription language",
      description:
        "You can enter your language code (ISO 639-1) for better transcription (option):",
      action: {
        type: "input",
        onChange: (evt) => {
          const lgg = evt.target.value.toLowerCase().trim();
          transcriptionLanguage = supportedLanguage.includes(lgg) ? lgg : "";
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
      description: "Choose a model or 'custom model' to be specified below:",
      action: {
        type: "select",
        items: [
          "gpt-3.5-turbo-1106",
          "gpt-4-1106-preview",
          "gpt-4",
          "custom model",
        ],
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
  ],
};

function getRolesFromString(str) {
  let splittedStr = str ? str.split(",") : [];
  return {
    user: splittedStr[0],
    assistant:
      splittedStr.length > 1 ? splittedStr[1].trimStart() : "AI assistant: ",
  };
}

export default {
  onload: async ({ extensionAPI }) => {
    extensionAPI.settings.panel.create(panelConfig);

    // get settings from setting panel
    if (extensionAPI.settings.get("position") === null)
      extensionAPI.settings.set("position", "left");
    position =
      (await extensionAPI.settings.get("position")) === "topbar"
        ? "top"
        : "left";
    if (extensionAPI.settings.get("whisper") === null)
      extensionAPI.settings.set("whisper", true);
    isUsingWhisper = await extensionAPI.settings.get("whisper");
    if (extensionAPI.settings.get("openaiapi") === null)
      extensionAPI.settings.set("openaiapi", "");
    OPENAI_API_KEY = await extensionAPI.settings.get("openaiapi");
    if (extensionAPI.settings.get("transcriptionLgg") === null)
      extensionAPI.settings.set("transcriptionLgg", "");
    transcriptionLanguage = await extensionAPI.settings.get("transcriptionLgg");
    if (extensionAPI.settings.get("speechLgg") === null)
      extensionAPI.settings.set("speechLgg", "Browser default");
    speechLanguage = await extensionAPI.settings.get("speechLgg");
    if (extensionAPI.settings.get("prompt") === null)
      extensionAPI.settings.set("prompt", "");
    whisperPrompt = await extensionAPI.settings.get("prompt");
    if (extensionAPI.settings.get("translateIcon") === null)
      extensionAPI.settings.set("translateIcon", true);
    isTranslateIconDisplayed = await extensionAPI.settings.get("translateIcon");
    if (extensionAPI.settings.get("gptModel") === null)
      extensionAPI.settings.set("gptModel", "gpt-3.5-turbo-1106");
    gptModel = await extensionAPI.settings.get("gptModel");
    if (extensionAPI.settings.get("gptCustomModel") === null)
      extensionAPI.settings.set("gptCustomModel", "");
    gptCustomModel = await extensionAPI.settings.get("gptCustomModel");
    if (extensionAPI.settings.get("chatRoles") === null)
      await extensionAPI.settings.set("chatRoles", "Me: ,AI assistant: ");
    const chatRolesStr =
      (await extensionAPI.settings.get(chatRoles)) || "Me: ,AI assistant: ";
    chatRoles = getRolesFromString(chatRolesStr);
    initializeOpenAIAPI();
    createContainer();

    extensionAPI.ui.commandPalette.addCommand({
      label: "Speech-to-Roam: record & transcribe voice",
      callback: () => {
        document.getElementsByClassName("speech-record-button")
          ? (unmountComponent(),
            mountComponent({ startRecording: true, transcribeOnly: true }))
          : mountComponent();
      },
    });
    extensionAPI.ui.commandPalette.addCommand({
      label: "Speech-to-Roam: translate to english",
      callback: () => {
        document.getElementsByClassName("speech-record-button")
          ? (unmountComponent(),
            mountComponent({ startRecording: true, translateOnly: true }))
          : mountComponent();
      },
    });
    extensionAPI.ui.commandPalette.addCommand({
      label: "Speech-to-Roam: speak to GPT assistant",
      callback: () => {
        document.getElementsByClassName("speech-record-button")
          ? (unmountComponent(),
            mountComponent({ startRecording: true, completionOnly: true }))
          : mountComponent();
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
      label: "Speech-to-Roam: toggle button visible/hidden",
      callback: () => {
        let recordingButtonElts = document.getElementsByClassName(
          "speech-record-button"
        );
        recordingButtonElts.length !== 0
          ? unmountComponent()
          : mountComponent();
      },
    });

    // Add SmartBlock command
    // const insertCmd = {
    //   text: "INSERTFOOTNOTE",
    //   help: "Insert automatically numbered footnote (requires the Footnotes extension)",
    //   handler: (context) => () => {
    //     noteInline = null;
    //     currentPos = new position();
    //     currentPos.s = context.currentContent.length;
    //     currentPos.e = currentPos.s;
    //     insertOrRemoveFootnote(context.targetUid);
    //     return "";
    //   },
    // };
    // if (window.roamjs?.extension?.smartblocks) {
    //   window.roamjs.extension.smartblocks.registerCommand(insertCmd);
    // } else {
    //   document.body.addEventListener(`roamjs:smartblocks:loaded`, () => {
    //     window.roamjs?.extension.smartblocks &&
    //       window.roamjs.extension.smartblocks.registerCommand(insertCmd);
    //   });
    // }

    mountComponent();

    console.log("Extension loaded.");
    //return;
  },
  onunload: () => {
    removeContainer();
    // disconnectObserver();
    console.log("Extension unloaded");
  },
};
