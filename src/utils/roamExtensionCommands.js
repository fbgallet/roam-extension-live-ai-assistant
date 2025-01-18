import { faLessThanEqual } from "@fortawesome/free-solid-svg-icons";
import { chatRoles, getInstantAssistantRole, isUsingWhisper } from "..";
import {
  copyTemplate,
  insertCompletion,
  lastCompletion,
} from "../ai/responseInsertion";
import { specificContentPromptBeforeTemplate } from "../ai/prompts";
import {
  displayTokensDialog,
  mountComponent,
  simulateClick,
  simulateClickOnRecordingButton,
  toggleComponentVisibility,
  unmountComponent,
} from "./domElts";
import {
  cleanFlagFromBlocks,
  createChildBlock,
  extractNormalizedUidFromRef,
  getBlockContentByUid,
  getFirstChildUid,
  resolveReferences,
} from "./roamAPI";
import { queryAgent } from "../ai/agents/query-agent";
import {
  NLQueryInterpreter,
  invokeNLQueryInterpreter,
} from "../ai/agents/nl-query";
import { invokeNLDatomicQueryInterpreter } from "../ai/agents/nl-datomic-query";
import { invokeOutlinerAgent } from "../ai/agents/outliner-agent";
import {
  getAndNormalizeContext,
  getContextFromSbCommand,
  getFlattenedContentFromTree,
  getFocusAndSelection,
  getRoamContextFromPrompt,
  getTemplateForPostProcessing,
  getTemplateFromPrompt,
} from "../ai/dataExtraction";
import { flexibleUidRegex, sbParamRegex } from "./regex";

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
    callback: async (test) => {
      console.log("test :>> ", test);
      aiCompletionRunner();
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
          withAssistantRole: lastCompletion.withAssistantRole,
          withSuggestions: lastCompletion.withSuggestions,
          target: lastCompletion.target,
          selectionUids: lastCompletion.selectionUids,
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

  const openContextMenu = (blockUid) => {
    setTimeout(() => {
      const centerX = window.innerWidth / 2 - 250;
      const centerY = window.innerHeight / 5;
      window.LiveAI.toggleContextMenu({
        e: { clientX: centerX, clientY: centerY },
        focusUid: blockUid ? [blockUid] : undefined,
      });
    }, 50);
  };

  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI Assistant: Open commands context Menu",
    callback: (e) => openContextMenu(),
  });

  window.roamAlphaAPI.ui.blockContextMenu.addCommand({
    label: "Live AI Assistant: Open context Menu",
    callback: (e) => openContextMenu(e["block-uid"]),
  });

  // Not reliable enought for prompting since it's not properly ordered
  // ****
  // window.roamAlphaAPI.ui.msContextMenu.addCommand({
  //   label: "Live AI Assistant: Open context Menu",
  //   callback: (e) => {
  //     let selectionUids = e["blocks"].map((b) => b["block-uid"]); // not ordered !
  //     const topParent = getTopParentAmongBlocks(selectionUids);
  //     selectionUids.splice(selectionUids.indexOf(topParent), 1);
  //     selectionUids = selectionUids.unshift(topParent);
  //     openContextMenu(undefined, selectionUids.length ? selectionUids : null);
  //   },
  // });

  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI Assistant: Set as target for Outliner Agent",
    callback: async () => {
      setAsOutline();
    },
  });

  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI Assistant: Send this prompt to Outliner Agent",
    callback: async () => {
      invokeOutlinerAgent();
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

  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI Assistant: Natural language Datomic :q Agent",
    callback: async () => {
      let { currentUid, currentBlockContent, selectionUids } =
        getFocusAndSelection();
      await invokeNLDatomicQueryInterpreter({
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
  const menuCmd = {
    text: "LIVEAIMENU",
    help: "Open Live AI Assisant menu",
    handler: (sbContext) => () => {
      const centerX = window.innerWidth / 2 - 250;
      const centerY = window.innerHeight / 5;
      window.LiveAI.toggleContextMenu({
        e: { clientX: centerX, clientY: centerY },
        focusUid: sbContext.currentUid,
      });
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
        let {
          stringifiedPrompt,
          targetUid,
          stringifiedContext,
          instantModel,
          toAppend,
        } = await getInfosFromSmartBlockParams({
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

  if (window.roamjs?.extension?.smartblocks) {
    window.roamjs.extension.smartblocks.registerCommand(speechCmd);
    window.roamjs.extension.smartblocks.registerCommand(menuCmd);
    window.roamjs.extension.smartblocks.registerCommand(chatCmd);
    window.roamjs.extension.smartblocks.registerCommand(templateCmd);
    window.roamjs.extension.smartblocks.registerCommand(agentCmd);
  } else {
    document.body.addEventListener(`roamjs:smartblocks:loaded`, () => {
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(speechCmd);
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(menuCmd);
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(chatCmd);
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(templateCmd);
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(agentCmd);
    });
  }
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
    toAppend,
  };
};
