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
  descendantRule,
  getBlocksMatchingRegexQuery,
  getDNPTitleFromDate,
  getDateStringFromDnpUid,
  getMultipleMatchingRegexInTreeQuery,
  getPageUidByBlockUid,
  isExistingBlock,
  updateBlock,
} from "../../utils/roamAPI";
import {
  roamQuerySystemPrompt,
  searchAgentSystemPrompt,
} from "./agent-prompts";
import { LlmInfos, modelViaLanggraph } from "./langraphModelsLoader";
import { balanceBraces, sanitizeClaudeJSON } from "../../utils/format";
import {
  displaySpinner,
  insertInstantButtons,
  removeSpinner,
} from "../../utils/domElts";
import { modelAccordingToProvider } from "../aiAPIsHub";
import { dnpUidRegex } from "../../utils/regex";
import { excludeItemsInArray } from "../../utils/dataProcessing";

interface PeriodType {
  begin: string;
  end: string;
  relative?: {
    begin: string;
    end: string;
  };
}

const SearchAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  model: Annotation<string>,
  rootUid: Annotation<string>,
  targetUid: Annotation<string>,
  userNLQuery: Annotation<string>,
  llmResponse: Annotation<any>,
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
const searchFiltersSchema = z.object({
  filters: z
    .array(
      z.object({
        regexString: z
          .string()
          .describe(
            "Regex string (eventually with disjonctive logic) to search"
          ),
        isToExclude: z
          .boolean()
          .describe("True if this regexString is to exclude"),
      })
    )
    .describe("Array of conjuctive (AND) filters defining the search"),
  // period: z
  //   .object({
  //     begin: z
  //       .string()
  //       .describe(
  //         "Date of the beginning of the period, in the format yyyy/mm/dd"
  //       ),
  //     end: z
  //       .string()
  //       .describe("Date of the end of the period, in the format yyyy/mm/dd"),
  //     relative: z
  //       .object({
  //         begin: z.enum(RoamRelativeDates).catch(undefined),
  //         end: z.enum(RoamRelativeDates).catch(undefined),
  //       })
  //       .optional()
  //       .nullable()
  //       .describe(
  //         "Relative dates, only if corresponding to one the available item"
  //       ),
  //   })
  //   .optional()
  //   .nullable()
  //   .describe(
  //     "Restricted period of the request, only if mentioned by the user"
  //   ),
  // values are \
});

let llm: StructuredOutputType;

/*********/
// NODES //
/*********/

const loadModel = async (state: typeof SearchAgentState.State) => {
  let modelShortcut: string = state.model || defaultModel;
  let llmInfos: LlmInfos = modelAccordingToProvider(modelShortcut);
  llm = modelViaLanggraph(llmInfos);
  return {
    model: llmInfos.id,
  };
};

const interpreter = async (state: typeof SearchAgentState.State) => {
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
  const structuredLlm = llm.withStructuredOutput(
    searchFiltersSchema,
    rawOption
  );
  const sys_msg = new SystemMessage({
    content: searchAgentSystemPrompt.replace("<CURRENT_DATE>", currentDate),
  });
  // console.log("sys_msg :>> ", sys_msg);
  let messages = [sys_msg].concat([
    new HumanMessage(
      // !state.roamQuery
      // ?
      state.userNLQuery
      //     : `Here is the user request in natural language: ${state.userNLQuery}

      // Here is the way this request has alreedy been transcribed by an AI assistant in a Roam Research query: ${state.roamQuery}

      // The user is requesting a new and, if possible, better transcription. Do it by meticulously respecting the whole indications and syntax rules provided above in the conversation. Do your best not to disappoint!`
    ),
  ]);
  let response = await structuredLlm.invoke(messages);

  return {
    llmResponse: response,
  };
};

const formatChecker = async (state: typeof SearchAgentState.State) => {
  let query = state.llmResponse.roamQuery;
  const isClaudeModel = state.model.toLowerCase().includes("claude");
  if (isClaudeModel) {
    const raw = state.llmResponse.raw.content[0];
    if (!state.llmResponse.parsed) {
      console.log("raw: ", raw);
      if (raw?.input?.period && raw?.input?.roamQuery) {
        // console.log("raw period: ", raw?.input?.period);
        state.llmResponse.period = JSON.parse(
          balanceBraces(sanitizeClaudeJSON(raw.input.period))
        );
        query = raw?.input?.roamQuery;
      }
    } else {
      state.llmResponse = state.llmResponse.parsed;
    }
  }
  const correctedQuery = balanceBraces(query);
  // console.log("Query after correction :>> ", correctedQuery);
  return {
    roamQuery: correctedQuery,
    period: state.llmResponse.period || null,
  };
};

const periodFormater = async (state: typeof SearchAgentState.State) => {
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
  // const formatedQuery = roamQuery
  //   .replace("<begin>", begin)
  //   .replace("<end>", end);
  return state;
};

const queryRunner = async (state: typeof SearchAgentState.State) => {
  console.log("llmResponse :>> ", state.llmResponse);
  const toExcludeFilter = state.llmResponse.filters.find(
    (f: any) => f.isToExclude
  );
  const formatedRegexToExclude =
    toExcludeFilter &&
    (toExcludeFilter.caseSensitive ? "" : "(?i)" + toExcludeFilter.regexString);

  const allFormatedRegex: string[] = state.llmResponse.filters
    .filter((f: any) => !f.isToExclude)
    .map((f: any) => (f.caseSensitive ? "" : "(?i)") + f.regexString);
  const neededRegexNumber = allFormatedRegex.length - 1;

  let blocksMatchingAllFilters: string[] = [];
  if (allFormatedRegex.length > 1) {
    let totalRegexControl = "^";
    for (let i = 0; i < allFormatedRegex.length; i++) {
      totalRegexControl += `(?=.*${allFormatedRegex[i].replace("(?i)", "")})`;
    }
    totalRegexControl += ".*";
    let params = [totalRegexControl];
    if (toExcludeFilter) params.push(formatedRegexToExclude);
    blocksMatchingAllFilters =
      (window as any).roamAlphaAPI.q(
        getBlocksMatchingRegexQuery(toExcludeFilter),
        ...params
      ) || [];
  }
  // console.log("blocks matching all filters :>>", blocksMatchingAllFilters);

  let allMatchingUids = blocksMatchingAllFilters.map((elt: any) => elt[0]);
  let matchingBlocks = blocksMatchingAllFilters;

  allFormatedRegex.forEach((filter: any) => {
    let params = [filter];
    if (toExcludeFilter) params.push(formatedRegexToExclude);
    let uidsMatchingOneFilter = (window as any).roamAlphaAPI
      .q(getBlocksMatchingRegexQuery(toExcludeFilter), ...params)
      .map((elt: any) => elt[0]);

    uidsMatchingOneFilter = excludeItemsInArray(
      uidsMatchingOneFilter,
      allMatchingUids
    );

    const otherRegexString = allFormatedRegex.filter((f) => f !== filter);

    let blocksAndChildrenMatchingAllFilters;

    const additionalRegex = toExcludeFilter
      ? otherRegexString.concat(formatedRegexToExclude)
      : otherRegexString;
    // console.log("additionalRegex :>> ", additionalRegex);
    if (additionalRegex.length) {
      blocksAndChildrenMatchingAllFilters =
        (window as any).roamAlphaAPI.q(
          getMultipleMatchingRegexInTreeQuery(
            neededRegexNumber,
            toExcludeFilter
          ),
          descendantRule,
          uidsMatchingOneFilter,
          ...additionalRegex
        ) || [];
    }
    // console.log("resultInChildren :>> ", blocksAndChildrenMatchingAllFilters);
    matchingBlocks = matchingBlocks.concat(blocksAndChildrenMatchingAllFilters);
    allMatchingUids = allMatchingUids.concat(
      blocksAndChildrenMatchingAllFilters.map((elt: any) => elt[0])
    );
  });
  console.log("matchingBlocks :>> ", matchingBlocks);
};

/*********/
// EDGES //
/*********/

const hasPeriod = (state: typeof SearchAgentState.State) => {
  if (state.period) return "periodFormater";
  return "queryRunner";
};

// const isToCheck = (state: typeof SearchAgentState.State) => {
//   if (state.period) return "formatChecker";
//   return "queryRunner";
// };

// Build graph
const builder = new StateGraph(SearchAgentState);
builder
  .addNode("loadModel", loadModel)
  .addNode("interpreter", interpreter)
  .addNode("checker", formatChecker)
  .addNode("periodFormater", periodFormater)
  .addNode("queryRunner", queryRunner)

  .addEdge(START, "loadModel")
  .addEdge("loadModel", "interpreter")
  .addEdge("interpreter", "checker")
  .addConditionalEdges("checker", hasPeriod)
  .addEdge("periodFormater", "queryRunner");

// Compile graph
export const SearchAgent = builder.compile();

interface AgentInvoker {
  model: string;
  currentUid: string;
  targetUid?: string;
  prompt: string;
  previousResponse?: string;
}
// Invoke graph
export const invokeSearchAgent = async ({
  model = defaultModel,
  currentUid,
  targetUid,
  prompt,
  previousResponse,
}: AgentInvoker) => {
  const spinnerId = displaySpinner(currentUid);
  const response = await SearchAgent.invoke({
    model,
    rootUid: currentUid,
    userNLQuery: prompt,
    targetUid,
    // roamQuery: previousResponse,
  });
  removeSpinner(spinnerId);
  if (response) {
    setTimeout(() => {
      insertInstantButtons({
        model: response.model,
        prompt: response.userNLQuery,
        currentUid,
        targetUid: response.targetUid,
        responseFormat: "text",
        // response: response.roamQuery,
        aiCallback: invokeSearchAgent,
      });
    }, 100);
  }
  console.log("Agent response:>>", response);
};
