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

import { defaultModel } from "../../..";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import {
  createChildBlock,
  deleteBlock,
  extractNormalizedUidFromRef,
  getTreeByUid,
  moveBlock,
  reorderBlocks,
  replaceChildrenByNewTree,
  updateBlock,
} from "../../../utils/roamAPI";
import {
  balanceBraces,
  sanitizeClaudeJSON,
  sanitizeJSONstring,
  splitParagraphs,
} from "../../../utils/format";

import { outlinerAgentSystemPrompt } from "./outliner-prompts";
import { LlmInfos, modelViaLanggraph } from "../langraphModelsLoader";
import { highlightHtmlElt, insertInstantButtons } from "../../../utils/domElts";
import { modelAccordingToProvider } from "../../aiAPIsHub";
import { getTemplateForPostProcessing } from "../../dataExtraction";
import { insertStructuredAIResponse } from "../../responseInsertion";
import { planerSchema } from "./outliner-schema";
import { turnTokensUsage } from "../search-agent/invoke-search-agent";

const outlinerAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  model: Annotation<LlmInfos>,
  rootUid: Annotation<String>,
  humanPrompt: Annotation<String>,
  // context: Annotation<String>,
  llmResponse: Annotation<any>,
  remainingOperations: Annotation<string>,
  notCompletedOperations: Annotation<string>,
  lastTurn: Annotation<boolean>,
  treeSnapshot: Annotation<Array<any>>,
  treeTarget: Annotation<Array<any>>,
  uidsInOutline: Annotation<Array<string>>,
  historyCommand: Annotation<string>,
  retry: Annotation<boolean>,
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
  llm = modelViaLanggraph(state.model, turnTokensUsage);
};

const operationsPlanner = async (state: typeof outlinerAgentState.State) => {
  let notCompletedOperations = state.notCompletedOperations || "";
  let lastTurn = state.lastTurn || false;

  if (!notCompletedOperations) state.treeSnapshot = getTreeByUid(state.rootUid);

  const isClaudeModel = state.model.id.toLowerCase().includes("claude");
  const rawOption = isClaudeModel
    ? {
        includeRaw: true,
      }
    : {};
  const structuredLlm = llm.withStructuredOutput(planerSchema, rawOption);
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
    lastTurn = true;
    notCompletedOperations = "";
    state.uidsInOutline = outlineCurrentState.allBlocks;
  }
  const begin = performance.now();
  console.log("messages :>> ", messages);
  const response = await structuredLlm.invoke(messages);
  const end = performance.now();
  console.log("LLM response :>> ", response);
  console.log(
    "operationsPlanner request duration: ",
    `${((end - begin) / 1000).toFixed(2)}s`
  );

  return {
    llmResponse: response,
    notCompletedOperations,
    lastTurn,
    treeSnapshot: state.treeSnapshot,
    uidsInOutline: state.uidsInOutline,
  };
};

const formatChecker = async (state: typeof outlinerAgentState.State) => {
  const isClaudeModel = state.model.id.toLowerCase().includes("claude");
  if (isClaudeModel) {
    const raw = state.llmResponse.raw.content[0];
    if (!state.llmResponse.parsed) {
      console.log("raw: ", raw);
      if (raw?.input?.operations) {
        state.llmResponse.operations = JSON.parse(
          balanceBraces(sanitizeClaudeJSON(raw.input.operations))
        );
        state.llmResponse.message = balanceBraces(raw?.input?.message);
      }
    } else {
      state.llmResponse = state.llmResponse.parsed;
    }
  }
  return {
    messages: [new AIMessage(state.llmResponse.message)],
    remainingOperations:
      state.llmResponse.operations && state.llmResponse.operations.length
        ? JSON.stringify(state.llmResponse.operations)
        : "",
  };
};

const sequentialAPIrunner = async (state: typeof outlinerAgentState.State) => {
  let notCompletedOperations = state.notCompletedOperations;
  let operations = state.remainingOperations?.length
    ? JSON.parse(state.remainingOperations)
    : null;
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
    // newChildren && (newChildren = sanitizeJSONstring(newChildren));
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
            insertStructuredAIResponse({
              targetUid: blockUid,
              content: newChildren,
            });
          break;
        case "append":
          console.log("append! :>> ");
          await insertStructuredAIResponse({
            targetUid: blockUid,
            content: newContent,
            format,
          });
          if (newChildren)
            insertStructuredAIResponse({
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
            console.log("newChildren :>> ", newChildren);
            console.log("newBlockUid :>> ", newBlockUid);
            if (newChildren)
              setTimeout(async () => {
                await insertStructuredAIResponse({
                  targetUid: newBlockUid,
                  content: newChildren,
                  forceInChildren: true,
                });
              }, 200);
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
  .addNode("formatChecker", formatChecker)
  .addNode("sequentialAPIrunner", sequentialAPIrunner)
  .addNode("timeTraveler", timeTraveler)

  .addConditionalEdges(START, updateOrTravel)
  .addEdge("loadModel", "operationsPlanner")
  .addEdge("operationsPlanner", "formatChecker")
  .addEdge("formatChecker", "sequentialAPIrunner")
  .addConditionalEdges("sequentialAPIrunner", continueOperations)
  .addConditionalEdges("timeTraveler", retryOrEnd);

// Compile graph
export const outlinerAgent = builder.compile();
