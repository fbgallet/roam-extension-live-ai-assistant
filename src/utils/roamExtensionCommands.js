import { faLessThanEqual } from "@fortawesome/free-solid-svg-icons";
import {
  chatRoles,
  defaultModel,
  extensionStorage,
  getInstantAssistantRole,
  isUsingWhisper,
} from "..";
import { calculAgent } from "../ai/agents/calcul-agent";
import { transformerAgent } from "../ai/agents/canvas-agent";
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
  displaySpinner,
  displayTokensDialog,
  insertInstantButtons,
  mountComponent,
  removeSpinner,
  simulateClickOnRecordingButton,
  toggleComponentVisibility,
  unmountComponent,
} from "./domElts";
import {
  addContentToBlock,
  cleanFlagFromBlocks,
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
import { AppToaster } from "../components/VoiceRecorder";
import { queryAgent } from "../ai/agents/query-agent";
import {
  NLQueryInterpreter,
  invokeNLQueryInterpreter,
} from "../ai/agents/nl-query";

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

          // remove {text} mentions from template
          if (template.excluded && template.excluded.length) {
            cleanFlagFromBlocks("{text}", template.excluded);
          }

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

  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI Assistant: Tokens usage and cost overview",
    callback: () => {
      setTimeout(() => {
        displayTokensDialog();
      }, 100);
    },
  });

  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI Assistant: Set as target for Outliner Agent",
    callback: async () => {
      let { currentUid, currentBlockContent, selectionUids } =
        getFocusAndSelection();
      await extensionStorage.set(
        "outlinerRootUid",
        currentUid || (selectionUids.length ? selectionUids[0] : undefined)
      );
      if (!extensionStorage.get("outlinerRootUid"))
        AppToaster.show({
          message: `A block has to be focused or an outline has to selected to be set as the target for Outliner Agent`,
        });
    },
  });

  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI Assistant: Send this prompt to Outliner Agent",
    callback: async () => {
      let { currentUid, currentBlockContent, selectionUids } =
        getFocusAndSelection();
      if (!extensionStorage.get("outlinerRootUid")) {
        AppToaster.show({
          message: `An outline has to be set as target for Outliner Agent`,
        });
        return;
      }
      let prompt;
      if (currentUid) {
        prompt = currentBlockContent;
      } else if (
        selectionUids.length &&
        document.querySelector(".block-highlight-blue")
      ) {
        prompt = getResolvedContentFromBlocks(selectionUids, false);
        selectionUids = [];
      } else {
        AppToaster.show({
          message: `Some block as to be focused or selected to be used as prompt sent to Outliner Agent`,
        });
        return;
      }
      let outline = await getTemplateForPostProcessing(
        extensionStorage.get("outlinerRootUid"),
        99,
        [],
        false
      );
      // console.log("outline :>> ", outline.stringified);
      console.log("defaultModel :>> ", defaultModel);
      const begin = performance.now();
      const response = await transformerAgent.invoke({
        rootUid: extensionStorage.get("outlinerRootUid"),
        messages: [
          {
            role: "user",
            content: `${prompt}

            Input outline:
            ${outline.stringified}
            `,
          },
        ],
      });
      // console.log("response from command:>> ", response);
      const end = performance.now();
      const message = response.messages[1].content;
      console.log("operations :>> ", message);
      if (message && message !== "N/A") {
        AppToaster.show({
          message: "Outliner Agent: " + message,
        });
      }
      console.log(
        "Total Agent request duration: ",
        `${((end - begin) / 1000).toFixed(2)}s`
      );
    },
  });

  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI Assistant: Natural language Query Agent",
    callback: async () => {
      let { currentUid, currentBlockContent, selectionUids } =
        getFocusAndSelection();
      await invokeNLQueryInterpreter({
        currentUid,
        prompt: currentBlockContent,
      });
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
      \nParameters:
      \n1: prompt (text | block ref | {current} | {ref1+ref2+...}, default: {current} block content)
      \n2: context or content to apply the prompt to (text | block ref | {current} | {ref1+ref2+...} | defined context, ex. {page(name)+ref(name)})
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
        contextDepth,
        includeRefs = "false"
      ) => {
        let { stringifiedPrompt, targetUid, stringifiedContext, instantModel } =
          await getInfosFromSmartBlockParams({
            sbContext,
            prompt,
            context,
            target,
            model,
            contextDepth,
            includeRefs,
          });

        insertCompletion({
          prompt: stringifiedPrompt,
          targetUid,
          context: stringifiedContext,
          instantModel: instantModel || model,
          typeOfCompletion: "gptCompletion",
          isInConversation: false,
        });
        return [toAppend];
      },
  };

  const templateCmd = {
    text: "LIVEAITEMPLATE",
    help: `Live AI Assistant response following a template.
      \nParameters:
      \n1: template ({children} or block ref, default: children blocks)
      \n2: context or content to apply the prompt to (text | block ref | {current} | {ref1+ref2+...} | defined context, ex. {page(name)+ref(name)})
      \n3: target block reference (default: first child)
      \n4: model (default Live AI model or model ID)
      \n5: levels within the refs/log to include in the context (number, default fixed in settings)
      \n6: includes all block references in context (true/false, default: false)`,
    handler:
      (sbContext) =>
      async (
        template = "{children}",
        context,
        target,
        model,
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
        // disabled option to extract only a limited amount of levels in the prompt
        // depth = depth && !isNaN(depth) ? parseInt(depth) : undefined;

        if (target) targetUid = extractNormalizedUidFromRef(target.trim());

        let delay = 0;

        if (template.trim() && template !== "{children}") {
          const templateUid = extractNormalizedUidFromRef(template.trim());
          uidsToExclude = await copyTemplate(
            targetUid || currentUid,
            templateUid,
            99 //depth
          );
          delay = 100;
        }

        setTimeout(async () => {
          template = await getTemplateForPostProcessing(
            targetUid || currentUid,
            99, //depth,
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

  const agentCmd = {
    text: "LIVEAIAGENT",
    help: `Live AI Assistant Agent calling.
      \nParameters:
      \n1: Agent name
      \n2: prompt (text | block ref | {current} | {ref1+ref2+...}, default: {current} block content)
      \n2: context or content to apply the prompt to (text | block ref | {current} | {ref1+ref2+...} | defined context, ex. {page(name)+ref(name)})
      \n3: target block reference (default: first child)
      \n4: model (default Live AI model or model ID)`,
    // \n5: levels within the refs/log to include in the context (number, default fixed in settings)
    // \n6: includes all block references in context (true/false, default: false),
    handler:
      (sbContext) =>
      async (agent, prompt = "{current}", context, target, model) => {
        const currentUid = sbContext.currentUid;
        let { stringifiedPrompt, targetUid, stringifiedContext, instantModel } =
          await getInfosFromSmartBlockParams({
            sbContext,
            prompt,
            context,
            target,
            model,
            isRoleToInsert: false,
          });
        const agentName = agent.toLowerCase().trim().replace("agent", "");
        switch (agentName) {
          case "nlquery":
            await invokeNLQueryInterpreter({
              model: instantModel || model,
              currentUid,
              targetUid,
              prompt: stringifiedPrompt,
            });
            break;
          default:
            return "ERROR: a correct agent name is needed as first parameter of this SmartBlock. Available agents: nlagent.";
        }
        return "";
      },
  };

  const getInfosFromSmartBlockParams = async ({
    sbContext,
    prompt,
    context,
    target,
    model,
    contextDepth,
    includeRefs,
    isRoleToInsert = true,
  }) => {
    const assistantRole = isRoleToInsert
      ? model
        ? getInstantAssistantRole(model)
        : chatRoles.assistant
      : "";
    const currentUid = sbContext.currentUid;
    let currentBlockContent = sbContext.currentContent;
    let { selectionUids } = getFocusAndSelection(currentUid);
    let toAppend = "";
    let targetUid;
    let isContentToReplace = false;

    let stringifiedPrompt = "";
    if (sbParamRegex.test(prompt) || flexibleUidRegex.test(prompt)) {
      if (sbParamRegex.test(prompt)) prompt = prompt.slice(1, -1);
      const splittedPrompt = prompt.split("+");
      splittedPrompt.forEach((subPrompt) => {
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
            stringifiedPrompt += (stringifiedPrompt ? "\n\n" : "") + subPrompt;
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

    if ((!target && !currentBlockContent.trim()) || target === "{current}") {
      target = "{replace}";
    }

    if (target && target.slice(0, 8) === "{append:") {
      toAppend = target.slice(8, -1);
      target = "{append}";
    }

    switch (target) {
      case "{replace}":
      case "{replace-}":
        isContentToReplace = true;
        simulateClick(document.querySelector(".roam-body-main"));
      case "{append}":
        targetUid = currentUid;
        break;
      default:
        const uid = target ? extractNormalizedUidFromRef(target.trim()) : "";
        targetUid = uid || (await createChildBlock(currentUid, assistantRole));
    }
    if (isContentToReplace) {
      await window.roamAlphaAPI.updateBlock({
        block: {
          uid: currentUid,
          string: target === "{replace-}" ? "" : assistantRole,
        },
      });
    }
    return {
      stringifiedPrompt: prompt,
      targetUid,
      stringifiedContext: context,
      instantModel: model,
    };
  };

  if (window.roamjs?.extension?.smartblocks) {
    window.roamjs.extension.smartblocks.registerCommand(speechCmd);
    window.roamjs.extension.smartblocks.registerCommand(chatCmd);
    window.roamjs.extension.smartblocks.registerCommand(templateCmd);
    window.roamjs.extension.smartblocks.registerCommand(agentCmd);
  } else {
    document.body.addEventListener(`roamjs:smartblocks:loaded`, () => {
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(speechCmd);
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(chatCmd);
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(templateCmd);
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(agentCmd);
    });
  }
};
