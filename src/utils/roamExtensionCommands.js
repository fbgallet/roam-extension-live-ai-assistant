import { chatRoles, isUsingWhisper } from "..";
import {
  copyTemplate,
  getTemplateForPostProcessing,
  insertCompletion,
  lastCompletion,
} from "../ai/aiCommands";
import { contextAsPrompt } from "../ai/prompts";
import {
  mountComponent,
  simulateClickOnRecordingButton,
  toggleComponentVisibility,
  unmountComponent,
} from "./domElts";
import {
  createChildBlock,
  getAndNormalizeContext,
  getBlockContentByUid,
  getFirstChildUid,
  getFocusAndSelection,
  getRoamContextFromPrompt,
  getTemplateFromPrompt,
  insertBlockInCurrentView,
  resolveReferences,
} from "./utils";

export const loadRoamExtensionCommands = (extensionAPI) => {
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

  extensionAPI.ui.commandPalette.addCommand({
    label:
      "Live AI Assistant: Toggle visibility of the button (not permanently)",
    callback: () => {
      isComponentVisible = !isComponentVisible;
      unmountComponent(position);
      mountComponent(position);
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
      let prompt = currentBlockContent ? currentBlockContent : contextAsPrompt;
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
          currentBlockContent = resolveReferences(inlineTemplate.updatedPrompt);
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
            template.isInMultipleBlocks ? "gptPostProcessing" : "gptCompletion"
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
};
