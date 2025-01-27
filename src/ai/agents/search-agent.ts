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
  searchAgentListToFiltersSystemPrompt,
  searchAgentNLtoKeywordsSystempPrompt,
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
import {
  concatWithoutDuplicates,
  excludeItemsInArray,
} from "../../utils/dataProcessing";
import { insertStructuredAIResponse } from "../responseInsertion";

interface PeriodType {
  begin: string;
  end: string;
}

const SearchAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  model: Annotation<string>,
  rootUid: Annotation<string>,
  targetUid: Annotation<string>,
  userNLQuery: Annotation<string>,
  llmResponse: Annotation<any>,
  searchLists: Annotation<any>,
  isQuestion: Annotation<boolean>,
  nbOfResults: Annotation<number>,
  matchingBlocks: Annotation<any>,
  remainingQueryFilters: Annotation<any>,
  period: Annotation<PeriodType>,
});

const searchListSchema = z.object({
  isQuestion: z
    .boolean()
    .optional()
    .describe(
      "True if the user query ask not only for a search but also for processing of the search results"
    ),
  nbOfResults: z
    .number()
    .optional()
    .nullable()
    .describe("Number of requested results, otherwise null"),
  directList: z
    .string()
    .describe("Search list of key terms directly extracted from user query"),
  alternativeList: z
    .string()
    .optional()
    .nullable()
    .describe(
      "Alternative search list if key terms in user query are likely to be too limited"
    ),
  period: z
    .object({
      begin: z
        .string()
        .optional()
        .nullable()
        .describe(
          "Date of the beginning of the period (older than the end), in the format yyyy/mm/dd"
        ),
      end: z
        .string()
        .optional()
        .nullable()
        .describe("Date of the end of the period, in the format yyyy/mm/dd"),
    })
    .optional()
    .nullable()
    .describe(
      "Restricted period of the request, only if mentioned by the user"
    ),
});

const filtersArray = z
  .array(
    z.object({
      regexString: z
        .string()
        .describe("Regex string (eventually with disjonctive logic) to search"),
      isToExclude: z
        .boolean()
        .describe("True if this regexString is to exclude"),
    })
  )
  .nullable()
  .describe(
    "Array of filters defining the search, to be combined conjunctively"
  );

const searchFiltersSchema = z
  .object({
    firstListFilters: filtersArray,
    alternativeListFilters: filtersArray,
  })
  .describe(
    "Each search list converted in an array of filters. If no alternative list, set corresponding property to null"
  );

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

const nlQueryInterpreter = async (state: typeof SearchAgentState.State) => {
  const currentPageUid = getPageUidByBlockUid(state.rootUid);
  const currentDate = dnpUidRegex.test(currentPageUid)
    ? getDateStringFromDnpUid(currentPageUid)
    : getDateStringFromDnpUid(new Date());

  const isClaudeModel = state.model.toLowerCase().includes("claude");
  const rawOption = isClaudeModel
    ? {
        includeRaw: true,
      }
    : {};
  const structuredLlm = llm.withStructuredOutput(searchListSchema, rawOption);
  const sys_msg = new SystemMessage({
    content: searchAgentNLtoKeywordsSystempPrompt.replace(
      "<CURRENT_DATE>",
      currentDate
    ),
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
    isQuestion: response.isQuestion,
    nbOfResults: response.nbOfResults,
    period: response.period,
  };
};

const searchlistConverter = async (state: typeof SearchAgentState.State) => {
  console.log("llmResponse after step1 :>> ", state.llmResponse);
  state.searchLists = [state.llmResponse?.directList];
  if (state.llmResponse?.alternativeList)
    state.searchLists.push(state.llmResponse?.alternativeList);

  const isClaudeModel = state.model.toLowerCase().includes("claude");
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
    content: searchAgentListToFiltersSystemPrompt,
  });
  // console.log("sys_msg :>> ", sys_msg);
  let messages = [sys_msg].concat([
    new HumanMessage(
      // !state.roamQuery
      // ?
      "First search list: " +
        state.searchLists[0] +
        (state.searchLists.length > 1
          ? "\nAlternative search list: " + state.searchLists
          : "")
      //     : `Here is the user request in natural language: ${state.userNLQuery}

      // Here is the way this request has alreedy been transcribed by an AI assistant in a Roam Research query: ${state.roamQuery}

      // The user is requesting a new and, if possible, better transcription. Do it by meticulously respecting the whole indications and syntax rules provided above in the conversation. Do your best not to disappoint!`
    ),
  ]);
  let response = await structuredLlm.invoke(messages);
  console.log("response after step 2 :>> ", response);
  state.llmResponse = response;
  state.remainingQueryFilters = [state.llmResponse.firstListFilters];
  state.llmResponse?.alternativeListFilters &&
    state.remainingQueryFilters.push(state.llmResponse?.alternativeListFilters);
  return state;
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
    period: state.period || state.llmResponse.period || null,
  };
};

const periodFormater = async (state: typeof SearchAgentState.State) => {
  let begin = getDNPTitleFromDate(new Date(state.period.begin));
  let end = getDNPTitleFromDate(new Date(state.period.end));

  console.log("begin :>> ", begin);
  console.log("end :>> ", end);

  return state;
};

const queryRunner = async (state: typeof SearchAgentState.State) => {
  const currentFilter = state.remainingQueryFilters.shift();
  console.log("currentFilter :>> ", currentFilter);

  const toExcludeFilter = currentFilter.find((f: any) => f.isToExclude);
  const regexToExclude = toExcludeFilter && toExcludeFilter.regexString;

  const allIncludeRegex: string[] = currentFilter
    .filter((f: any) => !f.isToExclude)
    .map((f: any) => f.regexString);
  const neededRegexNumber = allIncludeRegex.length - 1;

  let blocksMatchingAllFilters: any[] = [];
  if (allIncludeRegex.length > 1) {
    let totalRegexControl = "^";
    for (let i = 0; i < allIncludeRegex.length; i++) {
      totalRegexControl += `(?=.*${allIncludeRegex[i].replaceAll("(?i)", "")})`;
    }
    totalRegexControl += ".*";
    let params = [totalRegexControl];
    if (toExcludeFilter) params.push(regexToExclude);
    blocksMatchingAllFilters =
      (window as any).roamAlphaAPI.q(
        getBlocksMatchingRegexQuery(toExcludeFilter),
        ...params
      ) || [];
    blocksMatchingAllFilters = blocksMatchingAllFilters.map((block) => {
      return { uid: block[0], content: block[1], editTime: block[2] };
    });
    blocksMatchingAllFilters = excludeItemsInArray(blocksMatchingAllFilters, [
      state.rootUid,
    ]);
  }
  // console.log("blocks matching all filters :>>", blocksMatchingAllFilters);

  let allMatchingUids = blocksMatchingAllFilters.map((elt: any) => elt.uid);
  let matchingBlocks = blocksMatchingAllFilters;

  console.log("allIncludeRegex :>> ", allIncludeRegex);
  allIncludeRegex.forEach((filter: any) => {
    let params = [filter];
    if (toExcludeFilter) params.push(regexToExclude);
    let blocksMatchingOneFilter: any[] =
      (window as any).roamAlphaAPI.q(
        getBlocksMatchingRegexQuery(toExcludeFilter),
        ...params
      ) || [];
    blocksMatchingOneFilter = blocksMatchingOneFilter.map((block) => {
      return { uid: block[0], content: block[1], editTime: block[2] };
    });
    console.log("blocksMatchingOneFilter :>> ", blocksMatchingOneFilter);
    if (blocksMatchingOneFilter.length) {
      let uidsMatchingOneFilter = blocksMatchingOneFilter.map(
        (elt: any) => elt.uid
      );

      uidsMatchingOneFilter = excludeItemsInArray(
        uidsMatchingOneFilter,
        allMatchingUids
      );

      const otherRegexString = allIncludeRegex.filter((f) => f !== filter);
      console.log("otherRegexString :>> ", otherRegexString);

      let blocksAndChildrenMatchingAllFilters: any[] = [];

      const additionalRegex = toExcludeFilter
        ? otherRegexString.concat(regexToExclude)
        : otherRegexString;
      console.log("additionalRegex :>> ", additionalRegex);
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
        blocksAndChildrenMatchingAllFilters =
          blocksAndChildrenMatchingAllFilters.map((block) => {
            return {
              uid: block[0],
              content: block[1],
              editTime: block[2],
              childMatchingContent:
                block.length > 2
                  ? block
                      .slice(3)
                      .reduce(
                        (
                          result: any[],
                          _: string,
                          index: number,
                          original: string[]
                        ) => {
                          if (index % 2 === 0) {
                            result.push({
                              uid: original[index],
                              content: original[index + 1],
                            });
                          }
                          return result;
                        },
                        []
                      )
                  : null,
            };
          });
      } else
        blocksAndChildrenMatchingAllFilters = blocksMatchingOneFilter || [];
      // console.log("resultInChildren :>> ", blocksAndChildrenMatchingAllFilters);

      matchingBlocks = concatWithoutDuplicates(
        matchingBlocks,
        blocksAndChildrenMatchingAllFilters,
        "uid"
      );
      allMatchingUids = concatWithoutDuplicates(
        allMatchingUids,
        blocksAndChildrenMatchingAllFilters.map((elt: any) => elt.uid) || []
      );
    }
  });
  console.log("matchingBlocks :>> ", matchingBlocks);

  return {
    remainingQueryFilters: state.remainingQueryFilters,
    matchingBlocks:
      matchingBlocks && matchingBlocks.length
        ? concatWithoutDuplicates(state.matchingBlocks, matchingBlocks, "uid")
        : matchingBlocks,
  };
};

const limitAndOrder = async (state: typeof SearchAgentState.State) => {
  console.log("state :>> ", state);
  let filteredBlocks = state.matchingBlocks;
  if (state.period) {
    let begin = state.period.begin ? new Date(state.period.begin) : null;
    console.log("begin :>> ", begin);
    let end = state.period.end ? new Date(state.period.end) : null;
    console.log("end :>> ", end);
    filteredBlocks = filteredBlocks.filter(
      (block: any) =>
        (!begin || block.editTime > begin.getTime()) &&
        (!end || block.editTime < end.getTime())
    );
  }
  filteredBlocks = filteredBlocks.sort(
    (a: any, b: any) => a.editTime < b.editTime
  );
  let requestedNb = state.nbOfResults
    ? state.nbOfResults * (state.isQuestion ? 5 : 1)
    : null;
  let maxNumber = requestedNb && requestedNb < 100 ? requestedNb : 100;
  maxNumber;
  if (maxNumber < filteredBlocks.length)
    filteredBlocks = filteredBlocks.slice(0, maxNumber);
  console.log("filteredBlocks & sorted :>> ", filteredBlocks);
};

const preselection = async (state: typeof SearchAgentState.State) => {
  console.log("Preselection Node");
};

const processResults = async (state: typeof SearchAgentState.State) => {
  console.log("Process results");
  const results = state.matchingBlocks;
  const sys_msg = new SystemMessage({
    content: searchAgentListToFiltersSystemPrompt,
  });
  // console.log("sys_msg :>> ", sys_msg);
  let messages = [sys_msg].concat([
    new HumanMessage(`Here is the user's initial request:
Here is the content of the main blocks that match with this request:`),
  ]);
  let response = await llm.invoke(messages);
  console.log("AI results processed response :>> ", response);
};

const displayResults = async (state: typeof SearchAgentState.State) => {
  console.log("Display results !");

  let resultStringified = "";

  if (!state.matchingBlocks.length) {
    resultStringified = "No result !";
  } else {
    state.matchingBlocks.forEach((block: any) => {
      resultStringified += `- ((${block.uid}))\n`;
      if (block.childMatchingContent) {
        let children = block.childMatchingContent;
        for (let i = 0; i < children.length; i++) {
          resultStringified += `  - ((${children[i].uid}))\n`;
        }
      }
    });
  }
  await insertStructuredAIResponse({
    targetUid: state.rootUid,
    content: resultStringified.trim(),
    forceInChildren: true,
  });
};

/*********/
// EDGES //
/*********/

const afterCheckRouter = (state: typeof SearchAgentState.State) => {
  if ("directList" in state.llmResponse) return "searchlist-converter";
  return "queryRunner";
};

const alternativeQuery = (state: typeof SearchAgentState.State) => {
  console.log("state.remainingQueryFilters :>> ", state.remainingQueryFilters);
  if (state.remainingQueryFilters.length) return "queryRunner";
  return "limitAndOrder";
};

const processOrDisplay = (state: typeof SearchAgentState.State) => {
  if (state.isQuestion) {
    if (
      state.matchingBlocks.length < 11 ||
      (state.nbOfResults && state.matchingBlocks.length < state.nbOfResults * 3)
    )
      return "results-processor";
    return "preselection-filter";
  }
  return "output";
};
// const isToCheck = (state: typeof SearchAgentState.State) => {
//   if (state.period) return "formatChecker";
//   return "queryRunner";
// };

// Build graph
const builder = new StateGraph(SearchAgentState);
builder
  .addNode("loadModel", loadModel)
  .addNode("nl-query-interpreter", nlQueryInterpreter)
  .addNode("searchlist-converter", searchlistConverter)
  .addNode("checker", formatChecker)
  .addNode("periodFormater", periodFormater)
  .addNode("queryRunner", queryRunner)
  .addNode("limitAndOrder", limitAndOrder)
  .addNode("preselection-filter", preselection)
  .addNode("results-processor", processResults)
  .addNode("output", displayResults)

  .addEdge(START, "loadModel")
  .addEdge("loadModel", "nl-query-interpreter")
  .addEdge("nl-query-interpreter", "checker")
  .addEdge("searchlist-converter", "checker")
  .addConditionalEdges("checker", afterCheckRouter)
  .addEdge("periodFormater", "queryRunner")
  .addConditionalEdges("queryRunner", alternativeQuery)
  .addConditionalEdges("limitAndOrder", processOrDisplay);

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
