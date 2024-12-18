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
  dnpUidRegex,
  getDNPTitleFromDate,
  getDateStringFromDnpUid,
  getPageUidByBlockUid,
  updateTokenCounter,
} from "../../utils/utils";
import { interpreterSystemPrompt } from "./agent-prompts";
import { modelAccordingToProvider } from "../aiCommands";
import { LlmInfos, modelViaLanggraph } from "./langraphModelsLoader";
import { balanceBraces, sanitizeClaudeJSON } from "../../utils/format";

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
  userNLQuery: Annotation<string>,
  llmResponse: Annotation<any>,
  roamQuery: Annotation<string>,
  period: Annotation<PeriodType>,
});

const RoamRelativeDates = [
  "last month",
  "last week",
  "yesterday",
  "today",
  "tomorrow",
  "next week",
  "next month",
] as const;
const querySchema = z.object({
  roamQuery: z
    .string()
    .describe(
      "The query following the precise Roam Research native queries syntax."
    ),
  period: z
    .object({
      begin: z
        .string()
        .describe(
          "Date of the beginning of the period, in the format yyyy/mm/dd"
        ),
      end: z
        .string()
        .describe("Date of the end of the period, in the format yyyy/mm/dd"),
      relative: z
        .object({
          begin: z.enum(RoamRelativeDates).catch(undefined),
          end: z.enum(RoamRelativeDates).catch(undefined),
        })
        .optional()
        .nullable()
        .describe(
          "Relative dates, only if corresponding to one the available item"
        ),
    })
    .optional()
    .nullable()
    .describe(
      "Restricted period of the request, only if mentioned by the user"
    ),
});

let llm: StructuredOutputType;

/*********/
// NODES //
/*********/

const loadModel = async (state: typeof QueryAgentState.State) => {
  let modelShortcut: string = state.model || defaultModel;
  let llmInfos: LlmInfos = modelAccordingToProvider(modelShortcut);
  console.log("llmInfos :>> ", llmInfos);
  llm = modelViaLanggraph(llmInfos);
  return {
    model: llmInfos.id,
  };
};

const interpreter = async (state: typeof QueryAgentState.State) => {
  const isClaudeModel = state.model.toLowerCase().includes("claude");
  const currentPageUid = getPageUidByBlockUid(state.rootUid);
  const currentDate = dnpUidRegex.test(currentPageUid)
    ? getDateStringFromDnpUid(currentPageUid)
    : getDateStringFromDnpUid(new Date());

  const rawOption = isClaudeModel
    ? {
        includeRaw: true,
      }
    : {};
  const structuredLlm = llm.withStructuredOutput(querySchema, rawOption);
  const sys_msg = new SystemMessage({
    content: interpreterSystemPrompt.replace("<CURRENT_DATE>", currentDate),
  });
  // console.log("sys_msg :>> ", sys_msg);
  let messages = [sys_msg].concat([new HumanMessage(state.userNLQuery)]);
  let response = await structuredLlm.invoke(messages);

  return {
    llmResponse: response,
  };
};

const formatChecker = async (state: typeof QueryAgentState.State) => {
  // let messages = [new SystemMessage({ content: queryCheckerSysPrompt })].concat(
  //   [
  //     new HumanMessage(
  //       `Here is the initial user request: ${state.userNLQuery}
  //   Here's how it is currently transcribed in Roam query syntax: ${state.roamQuery}`
  //     ),
  //   ]
  // );
  // const response = await llm.invoke(messages);
  console.log("Query before correction :>>", state.llmResponse.roamQuery);
  const isClaudeModel = state.model.toLowerCase().includes("claude");
  if (isClaudeModel) {
    const raw = state.llmResponse.raw.content[0];
    if (!state.llmResponse.parsed) {
      console.log("raw: ", raw);
      if (raw?.input?.period && raw?.input?.roamQuery) {
        console.log("raw period: ", raw?.input?.period);
        state.llmResponse.period = JSON.parse(
          balanceBraces(sanitizeClaudeJSON(raw.input.period))
        );
        console.log("parsed period :>> ", state.llmResponse.period);
        state.llmResponse.roamQuery = raw?.input?.roamQuery;
      }
    } else {
      state.llmResponse = state.llmResponse.parsed;
    }
  }
  const correctedQuery = balanceBraces(state.llmResponse.roamQuery);
  console.log("Query after correction :>> ", correctedQuery);
  return {
    roamQuery: correctedQuery,
    period: state.llmResponse.period || null,
  };
};

const periodFormater = async (state: typeof QueryAgentState.State) => {
  const relative = state.period.relative;
  let begin =
    relative &&
    relative.begin &&
    RoamRelativeDates.includes(
      state.period.begin as (typeof RoamRelativeDates)[number]
    )
      ? relative.begin
      : getDNPTitleFromDate(new Date(state.period.begin));
  let end =
    relative &&
    relative.end &&
    RoamRelativeDates.includes(
      state.period.end as (typeof RoamRelativeDates)[number]
    )
      ? relative.end
      : getDNPTitleFromDate(new Date(state.period.end));
  let roamQuery = state.roamQuery;

  if (
    (begin === "last week" && end === "last week") ||
    (begin === "last month" && end === "last month")
  ) {
    end = "today";
  } else if (
    (begin === "next week" && end === "next week") ||
    (begin === "next month" && end === "next month")
  ) {
    begin = "today";
  }
  // if (begin && !RoamRelativeDates.includes(begin)) begin = state.begin;
  const formatedQuery = roamQuery
    .replace("<begin>", begin)
    .replace("<end>", end);
  return {
    roamQuery: formatedQuery,
  };
};

const insertQuery = async (state: typeof QueryAgentState.State) => {
  createChildBlock(state.rootUid, state.roamQuery, "first");
  return state;
};

/*********/
// EDGES //
/*********/

const hasPeriod = (state: typeof QueryAgentState.State) => {
  if (state.period) return "periodFormater";
  return "insertQuery";
};

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
  .addNode("periodFormater", periodFormater)
  .addNode("insertQuery", insertQuery)

  .addEdge(START, "loadModel")
  .addEdge("loadModel", "interpreter")
  .addEdge("interpreter", "checker")
  .addConditionalEdges("checker", hasPeriod)
  .addEdge("periodFormater", "insertQuery");

// Compile graph
export const NLQueryInterpreter = builder.compile();
