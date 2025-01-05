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
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { arrayOutputType, z } from "zod";
import {
  OPENAI_API_KEY,
  defaultModel,
  extensionStorage,
  groqLibrary,
  openaiLibrary,
} from "../..";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import {
  createChildBlock,
  deleteBlock,
  extractNormalizedUidFromRef,
  getBlockContentByUid,
  getFocusAndSelection,
  getResolvedContentFromBlocks,
  getTreeByUid,
  moveBlock,
  reorderBlocks,
  replaceChildrenByNewTree,
  updateBlock,
  updateTokenCounter,
} from "../../utils/utils";
import {
  insertStructuredAIResponse,
  sanitizeJSONstring,
} from "../../utils/format";
import {
  getTemplateForPostProcessing,
  modelAccordingToProvider,
} from "../aiCommands";
import { CallbackManager } from "@langchain/core/callbacks/manager";
import { outlinerAgentSystemPrompt } from "./agent-prompts";
import { LlmInfos, modelViaLanggraph } from "./langraphModelsLoader";
import {
  highlightHtmlElt,
  insertInstantButtons,
  toggleOutlinerSelection,
} from "../../utils/domElts";
import { AppToaster } from "../../components/VoiceRecorder";

const outlinerAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  model: Annotation<string>,
  rootUid: Annotation<String>,
  remainingOperations: Annotation<string>,
  notCompletedOperations: Annotation<string>,
  lastTurn: Annotation<boolean>,
  treeSnapshot: Annotation<Array<any>>,
  treeTarget: Annotation<Array<any>>,
  historyCommand: Annotation<string>,
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
    blockUid &&
      blockUid !== "root" &&
      blockUid !== "root" &&
      (blockUid = extractNormalizedUidFromRef(blockUid, false));
    targetParentUid &&
      targetParentUid !== "root" &&
      targetParentUid !== "root" &&
      (targetParentUid = extractNormalizedUidFromRef(targetParentUid, false));
    newChildren && (newChildren = sanitizeJSONstring(newChildren));
    newOrder &&
      newOrder.length &&
      (newOrder = newOrder.map((item: string) => sanitizeJSONstring(item)));
    try {
      switch (action) {
        case "update":
          console.log("update! :>> ");
          updateBlock({
            blockUid,
            newContent,
            format,
          });
          if (newChildren)
            await insertStructuredAIResponse(blockUid, newChildren);
          break;
        case "append":
          console.log("append! :>> ");
          await insertStructuredAIResponse(
            blockUid,
            sanitizeJSONstring(newContent),
            false,
            format
          );
          if (newChildren)
            await insertStructuredAIResponse(blockUid, newChildren);
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
              await insertStructuredAIResponse(newBlockUid, newChildren, true);
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
          updateBlock({ blockUid, newContent: undefined, format });
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
  state.treeSnapshot = getTreeByUid(state.rootUid);
  if (state.historyCommand === "undo") {
    await replaceChildrenByNewTree(state.rootUid, state.treeTarget);
    updateInstantButtons(state);
  }
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

const continueOperations = (state: typeof outlinerAgentState.State) => {
  if (state.remainingOperations) return "sequentialAPIrunner";
  else if (state.notCompletedOperations) return "operationsPlanner";
  updateInstantButtons(state);
  return "__end__";
};

// other functions
const updateInstantButtons = (state: typeof outlinerAgentState.State) => {
  insertInstantButtons({
    model: state.model,
    targetUid: state.rootUid,
    isOutlinerAgent: true,
    treeSnapshot: state.treeSnapshot,
  });
};

// Build graph
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
  .addEdge("timeTraveler", END);

// Compile graph
export const outlinerAgent = builder.compile();

// Invoke graph
interface AgentInvoker {
  rootUid?: string;
  model?: string;
  prompt?: string;
  context?: string;
  treeSnapshot?: any[];
}

export const invokeOutlinerAgent = async ({
  rootUid,
  prompt,
  context,
  model,
  treeSnapshot,
}: AgentInvoker) => {
  let outline;
  if (!rootUid) rootUid = await extensionStorage.get("outlinerRootUid");
  console.log("rootUid :>> ", rootUid);
  if (!rootUid) return;

  if (!treeSnapshot) {
    let { currentUid, currentBlockContent, selectionUids, position } =
      getFocusAndSelection();
    await checkOutlineAvailability(rootUid, position);
    if (!rootUid) {
      AppToaster.show({
        message: `An outline has to be set as target for Outliner Agent`,
      });
      return;
    }

    if (!prompt && !treeSnapshot) {
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
    }
    outline = await getTemplateForPostProcessing(rootUid, 99, [], false, false);
  } else return;
  console.log("defaultModel :>> ", defaultModel);

  // highlightHtmlElt({ eltUid: rootUid, color: "blue" });

  const begin = performance.now();
  const response = await outlinerAgent.invoke({
    rootUid,
    messages: [
      {
        role: "user",
        content: !treeSnapshot
          ? `${prompt}

            Input outline:
            ${outline.stringified}
            `
          : "",
      },
    ],
    historyCommand: treeSnapshot ? "undo" : ",",
    treeTarget: treeSnapshot,
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
    console.log("updatedTree :>> ", updatedTree);
  }, 200);
};

const checkOutlineAvailability = async (
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
