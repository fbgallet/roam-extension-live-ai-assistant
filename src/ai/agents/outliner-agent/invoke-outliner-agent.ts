import { defaultModel, extensionStorage } from "../../..";
import {
  createChildBlock,
  getBlockContentByUid,
  getTreeByUid,
  insertBlockInCurrentView,
  updateBlock,
} from "../../../utils/roamAPI";

import {
  highlightHtmlElt,
  insertInstantButtons,
  toggleOutlinerSelection,
} from "../../../utils/domElts";
import {
  getAndNormalizeContext,
  getFlattenedContentFromTree,
  getFocusAndSelection,
  getResolvedContentFromBlocks,
  getTemplateForPostProcessing,
  handleModifierKeys,
} from "../../dataExtraction";
import {
  aiCompletionRunner,
  copyTemplate,
  insertStructuredAIResponse,
} from "../../responseInsertion";
import { customTagRegex } from "../../../utils/regex";
import { AppToaster } from "../../../components/Toaster";
import { outlinerAgent } from "./outliner-agent";
import { genericRetryPrompt } from "./outliner-prompts";
import { LlmInfos, TokensUsage } from "../langraphModelsLoader";
import { modelAccordingToProvider } from "../../aiAPIsHub";

export let turnTokensUsage: TokensUsage;

interface AgentInvoker {
  e?: MouseEvent;
  sourceUid?: string;
  rootUid?: string;
  model?: string;
  prompt?: string;
  context?: string;
  treeSnapshot?: any[];
  style?: string;
  historyCommand?: string;
  retry?: boolean;
}

export const invokeOutlinerAgent = async ({
  e,
  sourceUid,
  rootUid,
  prompt,
  context,
  model,
  treeSnapshot,
  style,
  historyCommand,
  retry,
}: AgentInvoker) => {
  let outline, roamContextFromKeys, retryPrompt, retryReasons;
  let llmInfos: LlmInfos = modelAccordingToProvider(model || defaultModel);
  turnTokensUsage = { input_tokens: 0, output_tokens: 0 };
  if (!rootUid) rootUid = await extensionStorage.get("outlinerRootUid");
  if (!rootUid) return;
  //   console.log("rootUid :>> ", rootUid);
  //   console.log("treeSnapshot :>> ", treeSnapshot);

  if (!treeSnapshot || retry) {
    let { currentUid, currentBlockContent, selectionUids, position } =
      getFocusAndSelection();
    await checkOutlineAvailabilityOrOpen(rootUid, position);
    if (!rootUid) {
      AppToaster.show({
        message: `An outline has to be set as target for Outliner Agent`,
      });
      return;
    }

    if (!prompt && !treeSnapshot && !retry) {
      if (currentUid && !selectionUids.length) {
        prompt = currentBlockContent;
      } else if (selectionUids.length) {
        prompt = getResolvedContentFromBlocks(selectionUids, false);
        selectionUids = [];
      } else {
        AppToaster.show({
          message: `Some block as to be focused or selected to be used as prompt sent to Outliner Agent`,
        });
        return;
      }
    } else if (retry) {
      retryReasons = currentBlockContent;
    }
    outline = await getTemplateForPostProcessing(rootUid, 99, [], false, false);
    roamContextFromKeys = await handleModifierKeys(e);
    context = await getAndNormalizeContext({
      roamContext: roamContextFromKeys,
      model,
      uidToExclude: rootUid,
    });
    console.log("context :>> ", context);

    if (!outline || !outline?.stringified?.trim()) {
      await aiCompletionRunner({
        e,
        sourceUid: rootUid,
        prompt,
        instantModel: model,
        target: "new w/o",
        roamContext: roamContextFromKeys,
        style,
        isButtonToInsert: false,
      });
      return;
    }
  } else {
    insertInstantButtons({
      targetUid: rootUid,
      isOutlinerAgent: true,
      isToRemove: true,
    });
  }

  if (retry && treeSnapshot) {
    historyCommand = null;
    const initialOutlineState = getFlattenedContentFromTree({
      parentUid: undefined,
      maxCapturing: 99,
      maxUid: 99,
      withDash: true,
      isParentToIgnore: true,
      tree: treeSnapshot,
    });

    retryPrompt = genericRetryPrompt
      .replace(
        "<retry-reasons>",
        retryReasons ? " for the following reason:\n'" + retryReasons + "'" : ""
      )
      .replace("<user-request>", prompt)
      .replace("<initialt-state>", initialOutlineState)
      .replace("<modified-state>", outline.stringified);
  }

  //   console.log("retryPrompt :>> ", retryPrompt);

  highlightHtmlElt({ eltUid: rootUid, color: "blue" });

  const begin = performance.now();
  const response = await outlinerAgent.invoke({
    rootUid,
    messages: [
      {
        role: "user",
        content: !treeSnapshot
          ? `${prompt}
  
              Input outline:
              ${outline?.stringified}
              `
          : retry
          ? retryPrompt
          : "",
      },
    ],
    humanPrompt: prompt,
    uidsInOutline: outline?.allBlocks,
    historyCommand,
    treeTarget: treeSnapshot,
    model: llmInfos,
    retry,
  });

  highlightHtmlElt({
    eltUid: rootUid,
    color: "blue",
    isToRemove: true,
  });

  const end = performance.now();
  console.log("response from command:>> ", response);
  const message =
    response.messages.length > 1 && response.messages.at(-1).content;
  message && console.log("Agent response:>> ", message);
  if (message && message !== "N/A") {
    if (message.toLowerCase().includes("warning:")) {
      AppToaster.show({
        message: "Outliner Agent - " + message,
      });
    } else {
      console.log("sourceUid :>> ", sourceUid);
      let targetUid = sourceUid;
      if (getBlockContentByUid(sourceUid))
        targetUid = await createChildBlock(sourceUid);
      insertStructuredAIResponse({
        targetUid,
        content: message,
        target: "new w/o",
      });
    }
  }
  console.log(
    "Total Agent request duration: ",
    `${((end - begin) / 1000).toFixed(2)}s`
  );

  setTimeout(() => {
    const updatedTree = getTreeByUid(rootUid);
  }, 200);
};

export const checkOutlineAvailabilityOrOpen = async (
  rootUid: string,
  position: string | null
) => {
  const isOutlineHighlighted = document.querySelector(
    ".fixed-highlight-elt-blue"
  )
    ? true
    : false;
  if (!isOutlineHighlighted) {
    let delay = 0;

    const outlineInstances = document.querySelectorAll(
      `.roam-block[id$="${rootUid}"]`
    );
    const isOutlineVisible = outlineInstances.length ? true : false;

    if (!isOutlineVisible) {
      if (position === "sidebar") {
        (window as any).roamAlphaAPI.ui.mainWindow.openBlock({
          block: { uid: rootUid },
        });
      } else {
        if (!document.querySelector("#roam-right-sidebar-content")) {
          (window as any).roamAlphaAPI.ui.rightSidebar.open();
        }
        setTimeout(() => {
          if (
            document.querySelector(
              `div[id="sidebar-window-sidebar-block-${rootUid}"`
            )
          ) {
            (window as any).roamAlphaAPI.ui.rightSidebar.expandWindow({
              window: { type: "block", "block-uid": rootUid },
            });
          } else {
            (window as any).roamAlphaAPI.ui.rightSidebar.addWindow({
              window: { type: "block", "block-uid": rootUid },
            });
          }
        }, 100);
      }
      delay = 100;
    }
    setTimeout(() => {
      toggleOutlinerSelection(rootUid, true);
    }, delay);
  }
};

export const insertNewOutline = async (
  currentUid: string,
  templateUid: string,
  position: string = "sidebar"
) => {
  // TODO if no template, insert default template ?
  // or blank outline ?
  // if (!templateUid) return;
  if (!currentUid)
    currentUid = await insertBlockInCurrentView("Live AI Outliner Agent");
  const commandsUid = await createChildBlock(currentUid, "");
  let templateTitle = templateUid
    ? getBlockContentByUid(templateUid)
    : "New Outline";
  const rootUid = await createChildBlock(
    currentUid,
    templateTitle.replace(customTagRegex["liveai/template"], "").trim()
  );
  extensionStorage.set("outlinerRootUid", rootUid);
  updateBlock({
    blockUid: commandsUid,
    newContent: `Prompts to update Live Outline ((${rootUid}))`,
  });
  setTimeout(async () => {
    (window as any).roamAlphaAPI.ui.mainWindow.openBlock({
      block: { uid: position === "sidebar" ? rootUid : commandsUid },
    });
    if (position === "sidebar")
      updateBlock({ blockUid: rootUid, format: { open: false } });
    else
      (window as any).roamAlphaAPI.ui.rightSidebar.addWindow({
        window: {
          type: "block",
          "block-uid": rootUid,
        },
      });
    templateUid
      ? await copyTemplate(rootUid, templateUid)
      : await createChildBlock(rootUid, "Insert content here...");
    checkOutlineAvailabilityOrOpen(rootUid, position);
    const firstCommandBlockUid = await createChildBlock(
      commandsUid,
      "Enter your prompts here..."
    );
    // (window as any).roamAlphaAPI.ui.mainWindow.focusFirstBlock();
  }, 200);
};
