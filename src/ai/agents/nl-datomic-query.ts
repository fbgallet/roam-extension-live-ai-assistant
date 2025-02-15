import {
  Annotation,
  MessagesAnnotation,
  StateGraph,
  START,
} from "@langchain/langgraph/web";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { arrayOutputType, z } from "zod";
import { defaultModel } from "../..";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import {
  createChildBlock,
  getCurrentOrRelativeDateString,
  getPageUidByBlockUid,
  isExistingBlock,
  updateBlock,
} from "../../utils/roamAPI";
import { datomicQuerySystemPrompt } from "./agent-prompts";
import { LlmInfos, modelViaLanggraph } from "./langraphModelsLoader";
import { balanceBraces, sanitizeClaudeJSON } from "../../utils/format";
import {
  displaySpinner,
  insertInstantButtons,
  removeSpinner,
} from "../../utils/domElts";
import { modelAccordingToProvider } from "../aiAPIsHub";

interface PeriodType {
  begin: string;
  end: string;
  relative?: {
    begin: string;
    end: string;
  };
}

const QueryAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  model: Annotation<string>,
  rootUid: Annotation<string>,
  targetUid: Annotation<string>,
  userNLQuery: Annotation<string>,
  llmResponse: Annotation<any>,
  datomicQuery: Annotation<string>,
  // period: Annotation<PeriodType>,
});

// const RoamRelativeDates = [
//   "last month",
//   "last week",
//   "yesterday",
//   "today",
//   "tomorrow",
//   "next week",
//   "next month",
// ] as const;
// const querySchema = z.object({
//   datomicQuery: z
//     .string()
//     .describe(
//       "The query following the precise Roam Research native queries syntax."
//     ),
//   period: z
//     .object({
//       begin: z
//         .string()
//         .describe(
//           "Date of the beginning of the period, in the format yyyy/mm/dd"
//         ),
//       end: z
//         .string()
//         .describe("Date of the end of the period, in the format yyyy/mm/dd"),
//       relative: z
//         .object({
//           begin: z.enum(RoamRelativeDates).catch(undefined),
//           end: z.enum(RoamRelativeDates).catch(undefined),
//         })
//         .optional()
//         .nullable()
//         .describe(
//           "Relative dates, only if corresponding to one the available item"
//         ),
//     })
//     .optional()
//     .nullable()
//     .describe(
//       "Restricted period of the request, only if mentioned by the user"
//     ),
// });

let llm: StructuredOutputType;

/*********/
// NODES //
/*********/

const loadModel = async (state: typeof QueryAgentState.State) => {
  let modelShortcut: string = state.model || defaultModel;
  let llmInfos: LlmInfos = modelAccordingToProvider(modelShortcut);
  llm = modelViaLanggraph(llmInfos);
  return {
    model: llmInfos.id,
  };
};

const interpreter = async (state: typeof QueryAgentState.State) => {
  const isClaudeModel = state.model.toLowerCase().includes("claude");
  const currentPageUid = getPageUidByBlockUid(state.rootUid);
  const currentDate = getCurrentOrRelativeDateString(state.rootUid);

  const rawOption = isClaudeModel
    ? {
        includeRaw: true,
      }
    : {};
  // const structuredLlm = llm.withStructuredOutput(querySchema, rawOption);
  const sys_msg = new SystemMessage({
    content: datomicQuerySystemPrompt.replace("<CURRENT_DATE>", currentDate),
  });
  // console.log("sys_msg :>> ", sys_msg);
  let messages = [sys_msg].concat([
    new HumanMessage(
      !state.datomicQuery
        ? state.userNLQuery
        : `Here is the user request in natural language: ${state.userNLQuery}
    
    Here is the way this request has alreedy been transcribed by an AI assistant in a Roam :q Datomic query: ${state.datomicQuery}
    
    The user is requesting a new and, if possible, better transcription. Do it by meticulously respecting the whole indications and syntax rules provided above in the conversation. Do your best not to disappoint!`
    ),
  ]);
  let response = await llm.invoke(messages);
  console.log("response :>> ", response);

  return {
    datomicQuery: response.content,
  };
};

const formatChecker = async (state: typeof QueryAgentState.State) => {
  let query = state.datomicQuery;
  const isClaudeModel = state.model.toLowerCase().includes("claude");
  // if (isClaudeModel && state.llmResponse.raw?.content) {
  //   const raw = state.llmResponse.raw.content[0];
  //   if (!state.llmResponse.parsed) {
  //     console.log("raw: ", raw);
  //     if (raw?.input?.period && raw?.input?.datomicQuery) {
  //       // console.log("raw period: ", raw?.input?.period);
  //       state.llmResponse.period = JSON.parse(
  //         balanceBraces(sanitizeClaudeJSON(raw.input.period))
  //       );
  //       query = raw?.input?.datomicQuery;
  //     }
  //   } else {
  //     state.llmResponse = state.llmResponse.parsed;
  //   }
  // }
  const correctedQuery = balanceBraces(query);
  // console.log("Query after correction :>> ", correctedQuery);
  return {
    datomicQuery: correctedQuery,
    // period: state.llmResponse.period || null,
  };
};

// const periodFormater = async (state: typeof QueryAgentState.State) => {
//   const relative = state.period.relative;
//   let begin =
//     relative &&
//     relative.begin &&
//     RoamRelativeDates.includes(
//       state.period.begin as (typeof RoamRelativeDates)[number]
//     )
//       ? relative.begin
//       : getDNPTitleFromDate(new Date(state.period.begin));
//   let end =
//     relative &&
//     relative.end &&
//     RoamRelativeDates.includes(
//       state.period.end as (typeof RoamRelativeDates)[number]
//     )
//       ? relative.end
//       : getDNPTitleFromDate(new Date(state.period.end));
//   let datomicQuery = state.datomicQuery;

//   if (
//     (begin === "last week" && end === "last week") ||
//     (begin === "last month" && end === "last month")
//   ) {
//     end = "today";
//   } else if (
//     (begin === "next week" && end === "next week") ||
//     (begin === "next month" && end === "next month")
//   ) {
//     begin = "today";
//   }
//   // if (begin && !RoamRelativeDates.includes(begin)) begin = state.begin;
//   const formatedQuery = datomicQuery
//     .replace("<begin>", begin)
//     .replace("<end>", end);
//   return {
//     datomicQuery: formatedQuery,
//   };
// };

const insertQuery = async (state: typeof QueryAgentState.State) => {
  console.log("state.datomicQuery :>> ", state.datomicQuery);
  if (state.targetUid && isExistingBlock(state.targetUid)) {
    await updateBlock({
      blockUid: state.targetUid,
      newContent: state.datomicQuery,
    });
  } else {
    state.targetUid = await createChildBlock(
      state.rootUid,
      state.datomicQuery,
      "first"
    );
  }
  return {
    targetUid: state.targetUid,
  };
};

/*********/
// EDGES //
/*********/

// const hasPeriod = (state: typeof QueryAgentState.State) => {
//   if (state.period) return "periodFormater";
//   return "insertQuery";
// };

// const isToCheck = (state: typeof QueryAgentState.State) => {
//   if (state.period) return "formatChecker";
//   return "insertQuery";
// };

// Build graph
const builder = new StateGraph(QueryAgentState);
builder
  .addNode("loadModel", loadModel)
  .addNode("interpreter", interpreter)
  .addNode("checker", formatChecker)
  // .addNode("periodFormater", periodFormater)
  .addNode("insertQuery", insertQuery)

  .addEdge(START, "loadModel")
  .addEdge("loadModel", "interpreter")
  .addEdge("interpreter", "checker")
  // .addConditionalEdges("checker", hasPeriod)
  .addEdge("checker", "insertQuery");

// Compile graph
export const NLDatomicQueryInterpreter = builder.compile();

interface AgentInvoker {
  model: string;
  rootUid: string;
  targetUid?: string;
  prompt: string;
  previousResponse?: string;
}
// Invoke graph
export const invokeNLDatomicQueryInterpreter = async ({
  model = defaultModel,
  rootUid,
  targetUid,
  prompt,
  previousResponse,
}: AgentInvoker) => {
  const spinnerId = displaySpinner(rootUid);
  const response = await NLDatomicQueryInterpreter.invoke({
    model,
    rootUid,
    userNLQuery: prompt,
    targetUid,
    datomicQuery: previousResponse,
  });
  removeSpinner(spinnerId);
  if (response) {
    setTimeout(() => {
      insertInstantButtons({
        model: response.model,
        prompt: response.userNLQuery,
        currentUid: rootUid,
        targetUid: response.targetUid,
        responseFormat: "text",
        response: response.datomicQuery,
        aiCallback: invokeNLDatomicQueryInterpreter,
      });
    }, 100);
  }
  console.log("Agent response:>>", response);
};
