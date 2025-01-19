import {
  Annotation,
  MessagesAnnotation,
  StateGraph,
  START,
  END,
} from "@langchain/langgraph/web";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { arrayOutputType, z } from "zod";
import { defaultModel, extensionStorage } from "../..";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import {
  createChildBlock,
  deleteBlock,
  extractNormalizedUidFromRef,
  getBlockContentByUid,
  getTreeByUid,
  insertBlockInCurrentView,
  moveBlock,
  reorderBlocks,
  replaceChildrenByNewTree,
  updateBlock,
} from "../../utils/roamAPI";
import { sanitizeJSONstring } from "../../utils/format";

import { CallbackManager } from "@langchain/core/callbacks/manager";
import { outlinerAgentSystemPrompt } from "./agent-prompts";
import { LlmInfos, modelViaLanggraph } from "./langraphModelsLoader";
import {
  highlightHtmlElt,
  insertInstantButtons,
  toggleOutlinerSelection,
} from "../../utils/domElts";
import { AppToaster } from "../../components/VoiceRecorder";
import { modelAccordingToProvider } from "../aiAPIsHub";
import {
  getAndNormalizeContext,
  getFlattenedContentFromTree,
  getFocusAndSelection,
  getResolvedContentFromBlocks,
  getTemplateForPostProcessing,
  handleModifierKeys,
} from "../dataExtraction";
import {
  aiCompletionRunner,
  copyTemplate,
  insertStructuredAIResponse,
} from "../responseInsertion";
import { updateTokenCounter } from "../modelsInfo";
import { customTagRegex } from "../../utils/regex";

const outlinerAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  model: Annotation<string>,
  rootUid: Annotation<String>,
  humanPrompt: Annotation<String>,
  remainingOperations: Annotation<string>,
  notCompletedOperations: Annotation<string>,
  lastTurn: Annotation<boolean>,
  treeSnapshot: Annotation<Array<any>>,
  treeTarget: Annotation<Array<any>>,
  uidsInOutline: Annotation<Array<string>>,
  historyCommand: Annotation<string>,
  retry: Annotation<boolean>,
});

// Tools

//   const tools = [];

const planerSchema = z.object({
  message: z
    .string()
    .describe(
      "Answer to a question about the content in the outline, or notes about difficulties encountered regarding the user's request. A message should only be provided if information is requested or something go wrong and some instruction has to be sent to the user. Otherwise, simply say 'N/A'"
    ),
  operations: z
    .array(
      z.object({
        action: z
          .string()
          .describe(
            "Operation to perform on the block: update|append|move|create|reorder|delete"
          ),
        blockUid: z
          .string()
          .optional()
          .nullable()
          .describe(
            "The unique UID of the existing block being updated, completed or moved (make sure that it's strickly 9-characters) (optional)"
          ),
        newContent: z
          .string()
          .optional()
          .nullable()
          .describe(
            "The new content to create or to insert in the block, replacing or appended to the former (optional)"
          ),
        newChildren: z
          .string()
          .optional()
          .nullable()
          .describe(
            "If the block created has to be the parent of a rich content to be insert as children, provide its this content here. (optional)"
          ),
        targetParentUid: z
          .string()
          .optional()
          .nullable()
          .describe(
            "If action is 'create', 'move' or 'reorder', the unique AND existing UID (make sure that it's strickly 9-characters) of the parent block where this block should be created or inserted or reordered, or 'root' if the first level blocks are concerned. If target has no existing identifier, set to 'new', NEVER make up any identifier ! (optional)"
          ),
        newOrder: z
          .array(z.string())
          .optional()
          .nullable()
          .describe(
            "If action is 'reorder', an array of the UIDs (only provided ones, and make sure that it's strickly 9-characters, without parentheses!) representing the new order of the concerned blocks (optional)"
          ),
        position: z
          .number()
          .optional()
          .nullable()
          .describe(
            "Position (as a number) of a created or moved block in its new level. 0 is first, ignore this key to append as last block (optional)"
          ),
        format: z
          .object({
            open: z
              .boolean()
              .optional()
              .nullable()
              .describe("block is expanded (true) or collapsed (false)"),
            heading: z
              .number()
              .optional()
              .nullable()
              .describe("normal text is 0 (default), heading is 1|2|3"),
            "children-view-type": z
              .string()
              .optional()
              .nullable()
              .describe("bullet|numbered|document"),
          })
          .optional()
          .nullable()
          .describe(
            "Block format options: needed if action is 'format', optional if 'update', 'append' or 'create'"
          ),
      })
    )
    .describe("Array of all the operations to perform on the affected blocks"),
});

// System message
const sys_msg = new SystemMessage({
  content: outlinerAgentSystemPrompt,
});

let llm: StructuredOutputType;

/*********/
// NODES //
/*********/

const loadModel = async (state: typeof outlinerAgentState.State) => {
  let modelShortcut: string = state.model || defaultModel;
  let llmInfos: LlmInfos = modelAccordingToProvider(modelShortcut);
  llm = modelViaLanggraph(llmInfos);
  return {
    model: llmInfos.id,
  };
};

const operationsPlanner = async (state: typeof outlinerAgentState.State) => {
  state.treeSnapshot = getTreeByUid(state.rootUid);

  let notCompletedOperations = state.notCompletedOperations || "";
  let lastTurn = state.lastTurn || false;
  // LLM with bound tool

  const tokensUsageCallback = CallbackManager.fromHandlers({
    async handleLLMEnd(output: any) {
      console.log("Used tokens", output.llmOutput?.tokenUsage);
      const usage = {
        input_tokens: output.llmOutput?.tokenUsage?.promptTokens,
        output_tokens: output.llmOutput?.tokenUsage?.completionTokens,
      };
      updateTokenCounter("gpt-4o", usage);
    },
  });

  const isClaudeModel = state.model.toLowerCase().includes("claude");
  const rawOption = isClaudeModel
    ? {
        includeRaw: true,
      }
    : {};
  llm = llm.withStructuredOutput(planerSchema);
  let messages = [sys_msg].concat(state["messages"]);
  if (notCompletedOperations) {
    const outlineCurrentState = await getTemplateForPostProcessing(
      state.rootUid,
      99,
      [],
      false
    );
    messages = messages.concat(
      new HumanMessage(`Based on initial user request and the current state of the outliner provided below (potentially new blocks created), propose again, with complete information (e.g. replacing "new" in 'targetParentUid' key by an existing 9-character identifier), the following remaining operations:
    ${notCompletedOperations}
    Here is the current state of the outliner:
    ${outlineCurrentState.stringified}`)
    );
    console.log("messages :>> ", messages);
    lastTurn = true;
    notCompletedOperations = "";
    state.uidsInOutline = outlineCurrentState.allBlocks;
  }
  const begin = performance.now();
  const response = await llm.invoke(messages);
  const end = performance.now();
  console.log("LLM response :>> ", response);
  console.log(
    "operationsPlanner request duration: ",
    `${((end - begin) / 1000).toFixed(2)}s`
  );

  return {
    messages: [new AIMessage(response.message)],
    remainingOperations:
      response.operations && response.operations.length
        ? JSON.stringify(response.operations)
        : "",
    notCompletedOperations,
    lastTurn,
    treeSnapshot: state.treeSnapshot,
    uidsInOutline: state.uidsInOutline,
  };
};

// const formatChecker = async (state: typeof outlinerAgentState.State) => {
//   const isClaudeModel = state.model.toLowerCase().includes("claude");
//   if (isClaudeModel) {
//     const raw = state.remainingOperations.raw.content[0];
//     if (!state.llmResponse.parsed) {
//       console.log("raw: ", raw);
//       if (raw?.input?.period && raw?.input?.roamQuery) {
//         // console.log("raw period: ", raw?.input?.period);
//         state.llmResponse.period = JSON.parse(
//           balanceBraces(sanitizeClaudeJSON(raw.input.period))
//         );
//         query = raw?.input?.roamQuery;
//       }
//     } else {
//       state.llmResponse = state.llmResponse.parsed;
//     }
//   }
//   const correctedQuery = balanceBraces(query);
//   // console.log("Query after correction :>> ", correctedQuery);
//   return {
//     roamQuery: correctedQuery,
//     period: state.llmResponse.period || null,
//   };
// };

const sequentialAPIrunner = async (state: typeof outlinerAgentState.State) => {
  let notCompletedOperations = state.notCompletedOperations;
  let operations = JSON.parse(state.remainingOperations);
  const nextOperation = operations && operations.length ? operations[0] : null;
  if (nextOperation) {
    let {
      action,
      blockUid,
      targetParentUid,
      newContent,
      newChildren,
      newOrder,
      position,
      format,
    } = nextOperation;
    let isBlockInOutline = true;
    if (blockUid) {
      if (blockUid !== "root" && blockUid !== "new") {
        blockUid = extractNormalizedUidFromRef(blockUid, false);
        isBlockInOutline = state.uidsInOutline.includes(blockUid);
      }
    }
    if (targetParentUid) {
      if (targetParentUid !== "root" && targetParentUid !== "new") {
        targetParentUid = extractNormalizedUidFromRef(targetParentUid, false);
        isBlockInOutline = state.uidsInOutline.includes(targetParentUid);
      }
    }
    newChildren && (newChildren = sanitizeJSONstring(newChildren));
    newOrder &&
      newOrder.length &&
      (newOrder = newOrder.map((item: string) => sanitizeJSONstring(item)));
    try {
      if (!isBlockInOutline) {
        throw new Error(
          `Targeted block (${blockUid ? "blockUid: " + blockUid : ""} ${
            targetParentUid ? "targetParentUid:" + targetParentUid : ""
          }) not included in the Outline !`
        );
      }
      switch (action) {
        case "update":
          console.log("update! :>> ");
          if (!state.uidsInOutline.includes(blockUid)) break;
          await updateBlock({
            blockUid,
            newContent,
            format,
          });
          if (newChildren)
            await insertStructuredAIResponse({
              targetUid: blockUid,
              content: newChildren,
            });
          break;
        case "append":
          console.log("append! :>> ");
          await insertStructuredAIResponse({
            targetUid: blockUid,
            content: sanitizeJSONstring(newContent),
            format,
          });
          if (newChildren)
            await insertStructuredAIResponse({
              targetUid: blockUid,
              content: newChildren,
            });
          break;
        case "move":
          console.log("move! :>> ");
          if (!targetParentUid || targetParentUid === "new")
            notCompletedOperations += JSON.stringify(nextOperation) + "\n";
          else
            moveBlock({
              blockUid,
              targetParentUid,
              order: position,
            });
          break;
        case "create":
          console.log("create block! :>> ");
          if (!targetParentUid || targetParentUid === "new")
            notCompletedOperations += JSON.stringify(nextOperation) + "\n";
          else {
            const newBlockUid = await createChildBlock(
              targetParentUid === "root" ? state.rootUid : targetParentUid,
              newContent,
              position,
              format?.open,
              format?.heading
            );
            if (newChildren)
              await insertStructuredAIResponse({
                targetUid: newBlockUid,
                content: newChildren,
                forceInChildren: true,
              });
          }
          break;
        case "reorder":
          console.log("targetParentUid :>> ", targetParentUid);
          console.log("newOrder :>> ", newOrder);
          if (!targetParentUid || targetParentUid === "new")
            notCompletedOperations += JSON.stringify(nextOperation) + "\n";
          else
            reorderBlocks({
              parentUid:
                !targetParentUid || targetParentUid === "root"
                  ? state.rootUid
                  : targetParentUid,
              newOrder,
            });
          console.log("reorder! :>> ");
          break;
        case "format":
          await updateBlock({ blockUid, newContent: undefined, format });
          break;
        case "delete":
          console.log("reorder! :>> ");
          deleteBlock(blockUid);
          break;
      }
      const toHighlight = targetParentUid || blockUid;
      toHighlight &&
        action !== "delete" &&
        toHighlight !== "new" &&
        toHighlight !== "root" &&
        highlightHtmlElt({
          eltUid: toHighlight,
          onlyChildren: action === "create" ? true : false,
          isInset: true,
          color: "orange",
        });
    } catch (error) {
      console.log("error with Roam API call :>> ", error);
    } finally {
      console.log("finally");
      operations.shift();
      return {
        remainingOperations: operations.length
          ? JSON.stringify(operations)
          : "",
        notCompletedOperations,
      };
    }
  } else {
    operations = [];
  }
  // if (!operations.length && !notCompletedOperations)
  // setTimeout(() => {
  //   state.treeUpdated =
  // }, 100);
  // await new Promise((resolve) => setTimeout(resolve, 500));
  return {
    remainingOperations: operations.length ? JSON.stringify(operations) : "",
    notCompletedOperations,
  };
};

const timeTraveler = async (state: typeof outlinerAgentState.State) => {
  state.treeSnapshot = state.retry
    ? state.treeTarget
    : getTreeByUid(state.rootUid);
  console.log(
    "state.historyCommand in timeTraveler :>> ",
    state.historyCommand
  );
  // if (state.historyCommand === "undo" || state.historyCommand === "redo") {
  await replaceChildrenByNewTree(state.rootUid, state.treeTarget);
  if (!state.retry) updateInstantButtons(state);
  // }
  return {
    treeSnapshot: state.treeSnapshot,
  };
};

/*********/
// EDGES //
/*********/

const updateOrTravel = (state: typeof outlinerAgentState.State) => {
  if (
    state.treeTarget &&
    state.treeTarget.length &&
    (state.historyCommand === "undo" || state.historyCommand === "redo")
  )
    return "timeTraveler";
  else return "loadModel";
};

const retryOrEnd = (state: typeof outlinerAgentState.State) => {
  if (state.retry) return "loadModel";
  else return END;
};

const continueOperations = (state: typeof outlinerAgentState.State) => {
  if (state.remainingOperations) return "sequentialAPIrunner";
  else if (state.notCompletedOperations) return "operationsPlanner";
  updateInstantButtons(state);
  return END;
};

// other functions
const updateInstantButtons = (state: typeof outlinerAgentState.State) => {
  insertInstantButtons({
    model: state.model,
    targetUid: state.rootUid,
    isOutlinerAgent: true,
    prompt: state.humanPrompt,
    treeSnapshot: state.treeSnapshot,
    historyCommand:
      !state.historyCommand || state.historyCommand === "redo"
        ? "undo"
        : "redo",
  });
};

/**************** */
/*  Build graph   */
/**************** */

const builder = new StateGraph(outlinerAgentState);
builder
  .addNode("loadModel", loadModel)
  .addNode("operationsPlanner", operationsPlanner)
  .addNode("sequentialAPIrunner", sequentialAPIrunner)
  .addNode("timeTraveler", timeTraveler)

  .addConditionalEdges(START, updateOrTravel)
  .addEdge("loadModel", "operationsPlanner")
  .addEdge("operationsPlanner", "sequentialAPIrunner")
  .addConditionalEdges("sequentialAPIrunner", continueOperations)
  .addConditionalEdges("timeTraveler", retryOrEnd);

// Compile graph
export const outlinerAgent = builder.compile();

/**************** */
/*  Invoke graph  */
/**************** */

interface AgentInvoker {
  e?: MouseEvent;
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
  if (!rootUid) rootUid = await extensionStorage.get("outlinerRootUid");
  if (!rootUid) return;
  console.log("rootUid :>> ", rootUid);
  console.log("treeSnapshot :>> ", treeSnapshot);

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
  console.log("defaultModel :>> ", defaultModel);

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

    retryPrompt = `CONTEXT:
The user has already asked an LLM to modify a structured content (in the form of an outline) according to their instructions, but the result is not satisfactory ${
      retryReasons ? "for the following reason:\n'" + retryReasons + "'" : ""
    }.
    
YOUR JOB:
The user request needs to be carefully reexamined and the requested operations must be carried out while taking into account previous errors, in order to produce the most satisfactory result possible. Make sure to evaluate the relevant and necessary operations to meet the user's request.
IMPORTANT: you must perform your modifications starting from the initial state provided below, and understand the errors in the modified state provided later. BUT only the content, blocks, and identifiers of the initial state are to be considered for your modification operations!

Here is their INITIAL USER REQUEST:
${prompt}

Here is the outline in its INITIAL STATE, before any modification:
${initialOutlineState}

Here is the outline after the first modification by an LLM, a state which does not satisfy the user:
${outline.stringified}`;
  }

  console.log("retryPrompt :>> ", retryPrompt);

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
    model,
    retry,
  });

  highlightHtmlElt({
    eltUid: rootUid,
    color: "blue",
    isToRemove: true,
  });

  const end = performance.now();
  console.log("response from command:>> ", response);
  const message = response.messages.length > 1 && response.messages[1].content;
  message && console.log("operations :>> ", message);
  if (message && message !== "N/A") {
    AppToaster.show({
      message: "Outliner Agent: " + message,
    });
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
  if (!templateUid) return;
  if (!currentUid)
    currentUid = await insertBlockInCurrentView("Live AI Outliner Agent");
  const commandsUid = await createChildBlock(currentUid, "");
  let templateTitle = getBlockContentByUid(templateUid);
  const rootUid = await createChildBlock(
    currentUid,
    templateTitle.replace(customTagRegex["liveai/template"], "").trim()
  );
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
    await copyTemplate(rootUid, templateUid);
    checkOutlineAvailabilityOrOpen(rootUid, position);
    const firstCommandBlockUid = await createChildBlock(commandsUid, "");
    // (window as any).roamAlphaAPI.ui.mainWindow.focusFirstBlock();
  }, 200);
};
