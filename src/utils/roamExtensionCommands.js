import { chatRoles, getInstantAssistantRole, isUsingWhisper } from "..";
import {
  copyTemplate,
  getTemplateForPostProcessing,
  insertCompletion,
  isPromptInConversation,
  lastCompletion,
} from "../ai/aiCommands";
import {
  contextAsPrompt,
  specificContentPromptBeforeTemplate,
} from "../ai/prompts";
import {
  mountComponent,
  simulateClickOnRecordingButton,
  toggleComponentVisibility,
  unmountComponent,
} from "./domElts";
import {
  addContentToBlock,
  createChildBlock,
  createSiblingBlock,
  extractNormalizedUidFromRef,
  flexibleUidRegex,
  getAndNormalizeContext,
  getBlockContentByUid,
  getContextFromSbCommand,
  getFirstChildUid,
  getFlattenedContentFromTree,
  getFocusAndSelection,
  getParentBlock,
  getResolvedContentFromBlocks,
  getRoamContextFromPrompt,
  getTemplateFromPrompt,
  insertBlockInCurrentView,
  resolveReferences,
  sbParamRegex,
  simulateClick,
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
      let prompt, targetUid;
      let { currentUid, currentBlockContent, selectionUids } =
        getFocusAndSelection();
      if (!currentUid && !selectionUids.length) return;

      const isInConversation = currentUid
        ? isPromptInConversation(currentUid)
        : false;
      if (
        !currentUid &&
        selectionUids.length &&
        document.querySelector(".block-highlight-blue")
      ) {
        targetUid = await createSiblingBlock(selectionUids[0]);
        await addContentToBlock(targetUid, chatRoles.assistant);
        prompt = getResolvedContentFromBlocks(selectionUids, false);
        selectionUids = [];
      } else {
        targetUid = currentUid
          ? await createChildBlock(
              isInConversation ? getParentBlock(currentUid) : currentUid,
              chatRoles.assistant
            )
          : await insertBlockInCurrentView(
              chatRoles.user + " a selection of blocks"
            );
        prompt = currentBlockContent ? currentBlockContent : contextAsPrompt;
      }

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
      insertCompletion({
        prompt,
        targetUid,
        context,
        typeOfCompletion: "gptCompletion",
        isInConversation,
      });
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
      let uidsToExclude = [];
      if (currentBlockContent) {
        let inlineTemplate = getTemplateFromPrompt(
          getBlockContentByUid(currentUid)
        );
        // console.log("inlineTemplate :>> ", inlineTemplate);
        if (inlineTemplate) {
          uidsToExclude = await copyTemplate(
            currentUid,
            inlineTemplate.templateUid
          );
          currentBlockContent = resolveReferences(inlineTemplate.updatedPrompt);
          waitForBlockCopy = true;
        } else {
          targetUid = getFirstChildUid(currentUid);
          if (!targetUid) {
            uidsToExclude = await copyTemplate(currentUid);
            waitForBlockCopy = true;
          }
        }
      }
      setTimeout(
        async () => {
          let template = await getTemplateForPostProcessing(
            currentUid,
            99,
            uidsToExclude
          );
          if (!template.isInMultipleBlocks) {
            targetUid = await createChildBlock(
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

          insertCompletion({
            prompt,
            // waitForBlockCopy ? currentUid : targetUid,
            targetUid,
            context,
            typeOfCompletion: template.isInMultipleBlocks
              ? "gptPostProcessing"
              : "gptCompletion",
          });
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
        insertCompletion({
          prompt: lastCompletion.prompt,
          targetUid,
          context: lastCompletion.context,
          typeOfCompletion: lastCompletion.typeOfCompletion,
          instantModel: lastCompletion.instantModel,
          isRedone: true,
        });
      }
    },
  });

  // Add SmartBlock command
  const speechCmd = {
    text: "LIVEAIVOICE",
    help: "Start recording a vocal note using Speech-to-Roam extension",
    handler: (context) => () => {
      simulateClickOnRecordingButton();
      return [""];
    },
  };
  const chatCmd = {
    text: "LIVEAIGEN",
    help: `Live AI Assistant text generation and chat.
      \nArguments:
      \n1: prompt (text | block ref | {current} | {ref1+ref2+...}, default: {current} block content)
      \n2: context or content to apply the prompt to (text or block ref or {current} block content or defined context, ex. {page(name)+ref(name)})
      \n3: target block reference | {replace[-]} | {append} (default: first child)
      \n4: model (default Live AI model or model ID)
      \n5: levels within the refs/log to include in the context (number, default fixed in settings)
      \n6: includes all block references in context (true/false, default: false)`,
    handler:
      (sbContext) =>
      async (
        prompt = "{current}",
        context,
        target,
        model,
        //  includeChildren = "true",
        contextDepth,
        includeRefs = "false"
      ) => {
        const assistantRole = model
          ? getInstantAssistantRole(model)
          : chatRoles.assistant;
        const currentUid = sbContext.currentUid;
        let { currentBlockContent, selectionUids } =
          getFocusAndSelection(currentUid);

        let targetUid;
        let isContentToReplace = false;

        let stringifiedPrompt = "";
        if (sbParamRegex.test(prompt) || flexibleUidRegex.test(prompt)) {
          if (sbParamRegex.test(prompt)) prompt = prompt.slice(1, -1);
          const splittedPrompt = prompt.split("+");
          splittedPrompt.forEach((subPrompt) => {
            console.log("subPrompt :>> ", subPrompt);
            if (subPrompt === "current")
              stringifiedPrompt +=
                (stringifiedPrompt ? "\n\n" : "") + currentBlockContent;
            else {
              const promptUid = extractNormalizedUidFromRef(subPrompt);
              if (promptUid) {
                stringifiedPrompt +=
                  (stringifiedPrompt ? "\n\n" : "") +
                  getFlattenedContentFromTree(
                    promptUid,
                    99,
                    // includeChildren === "false"
                    //   ? 1
                    //   : isNaN(parseInt(includeChildren))
                    //   ? 99
                    //   : parseInt(includeChildren),
                    0
                  );
              } else
                stringifiedPrompt +=
                  (stringifiedPrompt ? "\n\n" : "") + subPrompt;
            }
          });
        } else stringifiedPrompt = resolveReferences(prompt);
        prompt = stringifiedPrompt;

        context =
          context === "{current}"
            ? currentBlockContent
            : await getContextFromSbCommand(
                context,
                currentUid,
                selectionUids,
                contextDepth,
                includeRefs,
                model
              );

        if ((!target && !currentBlockContent.trim()) || target === "{current}")
          target = "{replace}";

        switch (target) {
          case "{replace}":
          case "{replace-}":
            isContentToReplace = true;
          case "{append}":
            targetUid = currentUid;
            break;
          default:
            const uid = target
              ? extractNormalizedUidFromRef(target.trim())
              : "";
            targetUid =
              uid ||
              (await createChildBlock(
                currentUid,
                model ? getInstantAssistantRole(model) : chatRoles.assistant
              ));
        }
        if (isContentToReplace) {
          simulateClick(document.querySelector(".roam-body-main"));
          await window.roamAlphaAPI.updateBlock({
            block: {
              uid: currentUid,
              string: target === "{replace-}" ? "" : assistantRole,
            },
          });
        }

        insertCompletion({
          prompt: prompt,
          targetUid,
          context,
          instantModel: model,
          typeOfCompletion: "gptCompletion",
          isInConversation: false,
        });
        return [""];
      },
  };

  const templateCmd = {
    text: "LIVEAITEMPLATE",
    help: `Live AI Assistant response following a template.
      \nArguments:
      \n1: template ({children} or block ref, default: children blocks)
      \n2: context or content to apply the template to (text or block ref or {current} block content or defined context, ex. {page(name)+ref(name)})
      \n3: target block reference (default: first child)
      \n4: model (default Live AI model or model ID)
      \n5: levels within the template to include (number, default: all)
      \n6: levels within the refs/log to include in the context (number, default fixed in settings)
      \n7: includes all block references in context (true/false, default: false)`,
    handler:
      (sbContext) =>
      async (
        template = "{children}",
        context,
        target,
        model,
        depth,
        contextDepth,
        includeRefs = "false"
      ) => {
        const assistantRole = model
          ? getInstantAssistantRole(model)
          : chatRoles.assistant;
        const currentUid = sbContext.currentUid;
        let { currentBlockContent, selectionUids } =
          getFocusAndSelection(currentUid);
        let targetUid;
        let uidsToExclude = [];
        depth = depth && !isNaN(depth) ? parseInt(depth) : undefined;

        if (target) targetUid = extractNormalizedUidFromRef(target.trim());

        let delay = 0;

        if (template.trim() && template !== "{children}") {
          const templateUid = extractNormalizedUidFromRef(template.trim());
          uidsToExclude = await copyTemplate(
            targetUid || currentUid,
            templateUid,
            depth
          );
          delay = 100;
        }

        console.log("uidsToExclude :>> ", uidsToExclude);

        setTimeout(async () => {
          template = await getTemplateForPostProcessing(
            targetUid || currentUid,
            depth,
            uidsToExclude
          );
          template =
            specificContentPromptBeforeTemplate +
            currentBlockContent +
            "\n\n" +
            template.stringified;

          context = await getContextFromSbCommand(
            context,
            currentUid,
            selectionUids,
            contextDepth,
            includeRefs
          );

          if (!targetUid) targetUid = getFirstChildUid(currentUid);

          insertCompletion({
            prompt: template,
            targetUid,
            context,
            instantModel: model,
            typeOfCompletion: "gptPostProcessing",
            isInConversation: false,
          });
        }, delay);
        return [currentBlockContent ? "" : assistantRole];
      },
  };

  if (window.roamjs?.extension?.smartblocks) {
    window.roamjs.extension.smartblocks.registerCommand(speechCmd);
    window.roamjs.extension.smartblocks.registerCommand(chatCmd);
    window.roamjs.extension.smartblocks.registerCommand(templateCmd);
  } else {
    document.body.addEventListener(`roamjs:smartblocks:loaded`, () => {
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(speechCmd);
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(chatCmd);
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(templateCmd);
    });
  }
};
