import {
  Annotation,
  MessagesAnnotation,
  StateGraph,
  START,
  END,
} from "@langchain/langgraph/web";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { arrayOutputType, z } from "zod";
import { defaultModel } from "../..";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import {
  descendantRule,
  getBlocksMatchingRegexQuery,
  getDNPTitleFromDate,
  getDateStringFromDnpUid,
  getFirstChildContent,
  getFormattedPath,
  getMultipleMatchingRegexInTreeQuery,
  getPageUidByBlockUid,
  getPathOfBlock,
  getSiblingsParentMatchingRegexQuery,
} from "../../utils/roamAPI";
import {
  searchAgentListToFiltersSystemPrompt,
  searchtAgentPreselectionPrompt,
  searchtAgentPostProcessingPrompt,
  searchAgentNLtoKeywordsSearchOnlyPrompt,
  searchAgentNLtoKeywordsPostProPrompt,
} from "./agent-prompts";
import { LlmInfos, modelViaLanggraph } from "./langraphModelsLoader";
import { balanceBraces, sanitizeClaudeJSON } from "../../utils/format";
import {
  displaySpinner,
  insertInstantButtons,
  removeSpinner,
} from "../../utils/domElts";
import { modelAccordingToProvider } from "../aiAPIsHub";
import { dnpUidRegex, getConjunctiveRegex } from "../../utils/regex";
import {
  concatWithoutDuplicates,
  excludeItemsInArray,
  getRandomElements,
  removeDuplicatesByProperty,
  sliceByWordLimit,
} from "../../utils/dataProcessing";
import { insertStructuredAIResponse } from "../responseInsertion";
import { getFlattenedContentFromTree } from "../dataExtraction";
import { AgentToaster, AppToaster } from "../../components/Toaster";
import { Intent, ProgressBar } from "@blueprintjs/core";

interface PeriodType {
  begin: string;
  end: string;
}

let beginPerf: number, endPerf: number;

const SearchAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  model: Annotation<string>,
  rootUid: Annotation<string>,
  targetUid: Annotation<string>,
  userNLQuery: Annotation<string>,
  llmResponse: Annotation<any>,
  searchLists: Annotation<any>,
  isPostProcessingNeeded: Annotation<boolean>,
  nbOfResults: Annotation<number>,
  matchingBlocks: Annotation<any>,
  filteredBlocks: Annotation<any>,
  filters: Annotation<any>,
  remainingQueryFilters: Annotation<any>,
  period: Annotation<PeriodType>,
  pagesLimitation: Annotation<string>,
  isRandom: Annotation<boolean>,
  strigifiedResultToDisplay: Annotation<string>,
});

const searchListSchema = z.object({
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
  isPostProcessingNeeded: z
    .boolean()
    .optional()
    .nullable()
    .describe(
      "True if the user query ask not only for a search but also for post-processing search results"
    ),
  pagesLimitation: z
    .string()
    .optional()
    .nullable()
    .describe(
      "Limitation to a set of pages: 'dnp' or expression to be matched by the page titles"
    ),
  nbOfResults: z
    .number()
    .optional()
    .nullable()
    .describe("Number of requested results, otherwise null"),
  isRandom: z.boolean().optional().describe("Is a random result requested"),
  isDirectedFilter: z
    .boolean()
    .optional()
    .describe(
      "Is filter directed from parent meeting a conditon to children meeting other conditions"
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
    z
      .object({
        regexString: z
          .string()
          .describe(
            "Regex string (eventually with disjonctive logic) to search"
          ),
        isToExclude: z
          .boolean()
          .optional()
          .nullable()
          .describe("True if this regexString is to exclude"),
        isParentFilter: z
          .boolean()
          .optional()
          .nullable()
          .describe(
            "True if this filter is to apply to parent blocks in the case of a hierarchically directed search"
          ),
      })
      .describe("Filter object")
  )
  .nullable()
  .describe(
    "Array of filter objects defining conjunctively combined search conditions"
  );

const searchFiltersSchema = z
  .object({
    firstListFilters: filtersArray,
    alternativeListFilters: filtersArray,
  })
  .describe(
    "Each search list converted in an array of filters. If no alternative list, set corresponding property to null"
  );

const preselectionSchema = z.object({
  relevantUids: z
    .array(z.string().describe("uid without parentheses, exactly 9 characters"))
    .describe("Array of relevant uids only"),
});

let llm: StructuredOutputType;
let toasterInstance: string;

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
  displayAgentStatus(state, "nl-query-interpreter");

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
    content:
      state.isPostProcessingNeeded === false
        ? searchAgentNLtoKeywordsSearchOnlyPrompt.replace(
            "<CURRENT_DATE>",
            currentDate
          )
        : searchAgentNLtoKeywordsPostProPrompt.replace(
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

  state.searchLists = [response?.directList];
  if (response?.alternativeList)
    state.searchLists.push(response?.alternativeList);

  return {
    llmResponse: response,
    searchLists: state.searchLists,
    isPostProcessingNeeded:
      state.isPostProcessingNeeded === false
        ? false
        : response.isPostProcessingNeeded,
    nbOfResults: response.nbOfResults
      ? response.nbOfResults
      : response.isRandom
      ? 1
      : undefined,
    period: response.period,
    pagesLimitation: response.pagesLimitation,
    isRandom: response.isRandom,
  };
};

const searchlistConverter = async (state: typeof SearchAgentState.State) => {
  console.log("state.searchLists :>> ", state.searchLists);
  displayAgentStatus(state, "searchlist-converter");

  console.log("llmResponse after step1 :>> ", state.llmResponse);

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
          ? "\nAlternative search list: " + state.searchLists[1]
          : "") +
        `\n\nInitial user request from which the search list(s) is(are) extracted, provided only as context and for a better indication of the language to use in the semantic variations (e.g. if the user request is in french, write only variations in french): ${state.userNLQuery}`

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
  state.filters = [...state.remainingQueryFilters];
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
  displayAgentStatus(state, "queryRunner");
  beginPerf = performance.now();

  const currentFilter = state.remainingQueryFilters.shift();
  console.log("currentFilter :>> ", currentFilter);
  const parentFilterNb = currentFilter.reduce((count: number, item: any) => {
    return item.isParentFilter ? count + 1 : count;
  }, 0);
  console.log("parentFilterNb :>> ", parentFilterNb);
  const isDirectedFilter = parentFilterNb ? true : false;

  const toExcludeFilter = currentFilter.find((f: any) => f.isToExclude);
  const regexToExclude = toExcludeFilter && toExcludeFilter.regexString;

  const allIncludeRegex: string[] = currentFilter
    .filter((f: any) => !f.isToExclude)
    .map((f: any) => f.regexString);
  console.log("allIncludeRegex :>> ", allIncludeRegex);

  let blocksMatchingAllFilters: any[] = [];
  if (allIncludeRegex.length > 1 && !isDirectedFilter) {
    let totalRegexControl = getConjunctiveRegex(allIncludeRegex);
    let params = [totalRegexControl];
    if (toExcludeFilter) params.push(regexToExclude);
    blocksMatchingAllFilters =
      (window as any).roamAlphaAPI.q(
        getBlocksMatchingRegexQuery(toExcludeFilter, state.pagesLimitation),
        ...params
      ) || [];
    blocksMatchingAllFilters = parseQueryResults(blocksMatchingAllFilters);
    //    console.log("blocksMatchingAllFilters :>> ", blocksMatchingAllFilters);
    blocksMatchingAllFilters = excludeItemsInArray(
      blocksMatchingAllFilters,
      [{ uid: state.rootUid }],
      "uid"
    );
  }
  // console.log("blocks matching all filters :>>", blocksMatchingAllFilters);

  let allMatchingUids = blocksMatchingAllFilters.map((elt: any) => elt.uid);
  let matchingBlocks = blocksMatchingAllFilters;

  //console.log("allIncludeRegex :>> ", allIncludeRegex);
  allIncludeRegex.forEach((filter: any, index: number) => {
    if (!isDirectedFilter || index === 0) {
      let params =
        isDirectedFilter && parentFilterNb > 1
          ? [getConjunctiveRegex(allIncludeRegex.slice(0, parentFilterNb))]
          : [filter];
      if (toExcludeFilter) params.push(regexToExclude);
      let blocksMatchingOneFilter: any[] =
        (window as any).roamAlphaAPI.q(
          getBlocksMatchingRegexQuery(toExcludeFilter, state.pagesLimitation),
          ...params
        ) || [];
      blocksMatchingOneFilter = parseQueryResults(blocksMatchingOneFilter);
      console.log("blocksMatchingOneFilter :>> ", blocksMatchingOneFilter);

      if (blocksMatchingOneFilter.length) {
        let uidsMatchingOneFilter = blocksMatchingOneFilter.map(
          (elt: any) => elt.uid
        );
        uidsMatchingOneFilter = excludeItemsInArray(
          uidsMatchingOneFilter,
          allMatchingUids.concat(state.rootUid)
        );

        let blocksAndChildrenMatchingAllFilters: any[] = [];
        const otherRegexString =
          !isDirectedFilter || parentFilterNb <= 1
            ? allIncludeRegex.filter((f) => f !== filter)
            : allIncludeRegex.slice(parentFilterNb);
        const additionalRegex = toExcludeFilter
          ? otherRegexString.concat(regexToExclude)
          : otherRegexString;

        if (additionalRegex.length) {
          blocksAndChildrenMatchingAllFilters =
            (window as any).roamAlphaAPI.q(
              getMultipleMatchingRegexInTreeQuery(
                otherRegexString.length,
                toExcludeFilter,
                state.pagesLimitation
              ),
              descendantRule,
              uidsMatchingOneFilter,
              ...additionalRegex
            ) || [];
          blocksAndChildrenMatchingAllFilters = parseQueryResults(
            blocksAndChildrenMatchingAllFilters
          );
        } else
          blocksAndChildrenMatchingAllFilters = blocksMatchingOneFilter || [];
        console.log(
          "resultInChildren :>> ",
          blocksAndChildrenMatchingAllFilters
        );

        matchingBlocks = concatWithoutDuplicates(
          matchingBlocks,
          blocksAndChildrenMatchingAllFilters,
          "uid"
        );

        if (!isDirectedFilter && otherRegexString.length) {
          const potentialSiblingMatches = excludeItemsInArray(
            blocksMatchingOneFilter,
            blocksAndChildrenMatchingAllFilters,
            "uid"
          );
          console.log("potentialSiblingMatches :>> ", potentialSiblingMatches);
          if (potentialSiblingMatches.length) {
            let params = allIncludeRegex;
            if (toExcludeFilter) params.push(regexToExclude);
            let parentsWithMatchingSiblings =
              (window as any).roamAlphaAPI.q(
                getSiblingsParentMatchingRegexQuery(
                  allIncludeRegex.length,
                  toExcludeFilter,
                  state.pagesLimitation
                ),
                potentialSiblingMatches.map((elt: any) => elt.uid),
                ...params
              ) || [];
            parentsWithMatchingSiblings = parseQueryResults(
              parentsWithMatchingSiblings
            );
            parentsWithMatchingSiblings = removeDuplicatesByProperty(
              parentsWithMatchingSiblings,
              "uid"
            );
            console.log(
              "parentsWithMatchingSiblings :>> ",
              parentsWithMatchingSiblings
            );
            matchingBlocks = concatWithoutDuplicates(
              matchingBlocks,
              parentsWithMatchingSiblings,
              "uid"
            );
            blocksAndChildrenMatchingAllFilters.push(
              ...parentsWithMatchingSiblings
            );
          }
        }

        allMatchingUids = concatWithoutDuplicates(
          allMatchingUids,
          blocksAndChildrenMatchingAllFilters.map((elt: any) => elt.uid) || []
        );
      }
    }
  });
  console.log("matchingBlocks :>> ", matchingBlocks);

  const allMatchingBlocks =
    state.matchingBlocks && state.matchingBlocks.length
      ? concatWithoutDuplicates(state.matchingBlocks, matchingBlocks, "uid")
      : matchingBlocks;

  endPerf = performance.now();
  console.log(
    "Datomic query delay :>> ",
    ((endPerf - beginPerf) / 1000).toFixed(2) + "s"
  );

  return {
    remainingQueryFilters: state.remainingQueryFilters,
    matchingBlocks: removeDuplicatesByProperty(allMatchingBlocks, "uid"),
  };
};

const limitAndOrder = async (state: typeof SearchAgentState.State) => {
  const rootPath = getPathOfBlock(state.rootUid);
  const rootPathUids = rootPath ? rootPath.map((elt: any) => elt.uid) : [];
  let filteredBlocks = excludeItemsInArray(
    state.matchingBlocks,
    [state.rootUid].concat(rootPathUids),
    "uid",
    false
  );

  displayAgentStatus(state, "limitAndOrder");

  if (state.period) {
    let begin = state.period.begin ? new Date(state.period.begin) : null;
    let end = state.period.end ? new Date(state.period.end) : null;
    filteredBlocks = filteredBlocks.filter(
      (block: any) =>
        (!begin || block.editTime > begin.getTime()) &&
        (!end || block.editTime < end.getTime() + 24 * 60 * 60 * 1000)
    );
  }
  filteredBlocks = filteredBlocks.sort(
    (a: any, b: any) => a.editTime < b.editTime
  );

  let requestedNb = state.nbOfResults
    ? state.nbOfResults * (state.isPostProcessingNeeded ? 5 : 1)
    : null;
  // Arbitrary limit to 100 blocks before preselection (approx. 100 * 200 words maximum => approx. 30 000 tokens)
  let maxNumber = requestedNb && requestedNb < 100 ? requestedNb : 100;

  if (state.isRandom)
    filteredBlocks = getRandomElements(filteredBlocks, maxNumber);
  else if (maxNumber < filteredBlocks.length)
    filteredBlocks = filteredBlocks.slice(0, maxNumber);
  console.log("filteredBlocks & sorted :>> ", filteredBlocks);
  return {
    filteredBlocks,
  };
};

const preselection = async (state: typeof SearchAgentState.State) => {
  console.log("Preselection Node");
  displayAgentStatus(state, "preselection-filter");
  let flattenedQueryResults = "";
  state.filteredBlocks.forEach((block: any, index: number) => {
    const path = getPathOfBlock(block.uid);
    const directParent = path ? sliceByWordLimit(path.at(-1).string, 20) : null;
    let flattenedBlockContent = `${index}) Block ((${block.uid})) in page [[${
      block.pageTitle
    }]]${directParent ? '. Direct parent is: "' + directParent + '"' : ""}\n`;
    flattenedBlockContent += `Content:\n${sliceByWordLimit(
      block.content,
      100
    )}\n`; // TODO: normalize uids

    // add matching children blocks if not present in 3 level children
    if (block.childMatchingContent) {
      block.childMatchingContent.forEach((child: any) => {
        if (!flattenedBlockContent.includes(child.content))
          flattenedBlockContent +=
            "  - " + sliceByWordLimit(child.content, 100) + "\n";
      });
    } else {
      let firstChildContent = getFirstChildContent(block.uid);
      firstChildContent &&
        (flattenedBlockContent +=
          " - " + sliceByWordLimit(firstChildContent, 100));
    }
    flattenedQueryResults += flattenedBlockContent + "\n\n";
  });

  flattenedQueryResults = flattenedQueryResults.trim();
  console.log("flattenedQueryResults :>> ", flattenedQueryResults);

  const sys_msg = new SystemMessage({
    content: searchtAgentPreselectionPrompt.replace(
      "<MAX_NUMBER>",
      state.nbOfResults ? Math.min(20, state.nbOfResults * 3).toString() : "20"
    ),
  });
  // console.log("sys_msg :>> ", sys_msg);
  let messages = [sys_msg].concat([
    new HumanMessage(`Here is the user's initial request: ${state.userNLQuery}

Here are the blocks in Roam graph database that match with this request:
${flattenedQueryResults}`),
  ]);
  const structuredLlm = llm.withStructuredOutput(preselectionSchema);
  let response = await structuredLlm.invoke(messages);
  console.log("AI preselection :>> ", response);

  const preselectedBlocks = state.filteredBlocks.filter((block: any) =>
    response.relevantUids?.includes(block.uid)
  );

  return {
    filteredBlocks: preselectedBlocks,
  };
};

const postProcessing = async (state: typeof SearchAgentState.State) => {
  console.log("Process results");
  // const results = state.matchingBlocks;
  displayAgentStatus(state, "post-processing");
  let flattenedDetailedResults = "";
  state.filteredBlocks.forEach((block: any, index: number) => {
    let pathString = getFormattedPath(block.uid, 6, 30);
    let flattenedBlockContent = `${index}) Block ((${block.uid})) in page [[${
      block.pageTitle
    }]]${pathString ? '. Parent blocks: "' + pathString + '"' : ""}\n`;
    flattenedBlockContent += `Content:\n${block.content}`; // TODO: normalize uids
    flattenedBlockContent +=
      getFlattenedContentFromTree({
        parentUid: block.uid,
        maxCapturing: 3,
        maxUid: 0,
        withDash: true,
      }) + "\n";
    // arbitrary limit to 1000 words by block + 3 level children
    flattenedBlockContent = sliceByWordLimit(flattenedBlockContent, 1000);
    // add matching children blocks if not present in 3 level children
    if (block.childMatchingContent) {
      block.childMatchingContent.forEach((child: any) => {
        if (!flattenedBlockContent.includes(child.content))
          flattenedBlockContent += "  - " + child.content + "\n";
      });
    }
    flattenedDetailedResults += flattenedBlockContent + "\n\n";
  });

  flattenedDetailedResults = flattenedDetailedResults.trim();
  console.log("flattenedDetailedResults :>> ", flattenedDetailedResults);

  const sys_msg = new SystemMessage({
    content: searchtAgentPostProcessingPrompt,
  });
  // console.log("sys_msg :>> ", sys_msg);
  let messages = [sys_msg].concat([
    new HumanMessage(`Here is the user's initial request: ${state.userNLQuery}

Here are the main blocks in Roam graph database that match with this request:
${flattenedDetailedResults}`),
  ]);
  let response = await llm.invoke(messages);
  console.log("AI results processed response :>> ", response);
  return {
    strigifiedResultToDisplay: response.content,
  };
};

const displayResults = async (state: typeof SearchAgentState.State) => {
  displayAgentStatus(state, "output");
  console.log(
    "state.strigifiedResultToDisplay :>> ",
    state.strigifiedResultToDisplay
  );

  if (!state.strigifiedResultToDisplay) {
    state.strigifiedResultToDisplay = "";
    if (!state.filteredBlocks.length) {
      state.strigifiedResultToDisplay = "No matching blocks";
    } else {
      // Limit to 10 the number of displayed blocks
      const filteredBlocks = state.filteredBlocks.slice(
        0,
        state.nbOfResults || 10
      );
      filteredBlocks.forEach((block: any) => {
        state.strigifiedResultToDisplay += `- {{embed-path: ((${block.uid}))}}\n`;
      });
    }
  }

  await insertStructuredAIResponse({
    targetUid: state.rootUid,
    content: state.strigifiedResultToDisplay.trim(),
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
  if (state.remainingQueryFilters.length) return "queryRunner";
  return "limitAndOrder";
};

const processOrDisplay = (state: typeof SearchAgentState.State) => {
  if (state.isPostProcessingNeeded) {
    if (
      state.filteredBlocks.length <= 20 ||
      (state.nbOfResults &&
        state.filteredBlocks.length < Math.min(20, state.nbOfResults * 3))
    )
      return "post-processing";
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
  .addNode("post-processing", postProcessing)
  .addNode("output", displayResults)

  .addEdge(START, "loadModel")
  .addEdge("loadModel", "nl-query-interpreter")
  .addEdge("nl-query-interpreter", "checker")
  .addEdge("searchlist-converter", "checker")
  .addConditionalEdges("checker", afterCheckRouter)
  .addEdge("periodFormater", "queryRunner")
  .addConditionalEdges("queryRunner", alternativeQuery)
  .addConditionalEdges("limitAndOrder", processOrDisplay)
  .addConditionalEdges("preselection-filter", processOrDisplay)
  .addEdge("post-processing", "output")
  .addEdge("output", END);

// Compile graph
export const SearchAgent = builder.compile();

interface AgentInvoker {
  model: string;
  currentUid: string;
  targetUid?: string;
  prompt: string;
  previousResponse?: string;
  onlySearch?: boolean;
}
// Invoke graph
export const invokeSearchAgent = async ({
  model = defaultModel,
  currentUid,
  targetUid,
  prompt,
  previousResponse,
}: AgentInvoker) => {
  invokeAskAgent({
    model,
    currentUid,
    targetUid,
    prompt,
    previousResponse,
    onlySearch: true,
  });
};

export const invokeAskAgent = async ({
  model = defaultModel,
  currentUid,
  targetUid,
  prompt,
  previousResponse,
  onlySearch,
}: AgentInvoker) => {
  let begin = performance.now();

  toasterInstance = AgentToaster.show({
    message: "",
    // icon: "form",
    // intent: Intent.SUCCESS,
    // className: "search-agent-toaster",
  });

  const spinnerId = displaySpinner(currentUid);
  const response = await SearchAgent.invoke({
    model,
    rootUid: currentUid,
    userNLQuery: prompt,
    targetUid,
    isPostProcessingNeeded: false,
    // roamQuery: previousResponse,
  });

  let end = performance.now();
  console.log(
    "Search Agent delay :>> ",
    ((end - begin) / 1000).toFixed(2) + "s"
  );

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
};

const parseQueryResults = (queryResults: any[]) => {
  const parsed = queryResults.map((block: any) => {
    return {
      uid: block[0],
      content: block[1],
      editTime: block[2],
      pageTitle: block[3],
      childMatchingContent:
        block.length > 4
          ? block
              .slice(4)
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
  return parsed;
};

const displayAgentStatus = (
  state: typeof SearchAgentState.State,
  status: string
) => {
  let completion = 0;
  switch (status) {
    case "searchlist-converter":
      completion = 0.2;
      break;
    case "queryRunner":
      completion = 0.4;
      break;
    case "limitAndOrder":
      completion = 0.5;
      break;
    case "preselection-filter":
      completion = 0.6;
      break;
    case "post-processing":
      completion = 0.8;
      break;
    case "output":
      completion = 1;
      break;
  }
  if (completion >= 0.4) {
    console.log("state.filters :>> ", state.filters);
  }
  console.log("toasterInstance :>> ", toasterInstance);
  AgentToaster.show(
    {
      message: (
        <>
          {progressBarDisplay(
            state.isPostProcessingNeeded ? completion : completion + 0.2
          )}
          <ul>
            {completion === 0 && (
              <li>Interpreting natural language query..."</li>
            )}
            {completion >= 0.2 && (
              <li>
                ✔️ Search list(s) interpreted:
                <ol>
                  {state.searchLists.map((list: string, index: number) => (
                    <li>
                      <code>{list}</code>
                      {completion >= 0.4 && (
                        <ul>
                          <li>
                            ✔️ Regex filters:
                            <ol>
                              {state.filters.length > index &&
                                state.filters[index].map((elt: any) => (
                                  <li>
                                    <code>{elt.regexString}</code>
                                  </li>
                                ))}
                            </ol>
                          </li>
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              </li>
            )}
            {completion === 0.2 && (
              <li>Converting search list to Regex filters...</li>
            )}
            {completion === 0.4 && <li>Running Roam database queries...</li>}
            {completion >= 0.5 && (
              <li>
                ✔️ Roam database queries: {state.matchingBlocks.length} matching
                blocks
              </li>
            )}
            {completion === 0.6 && (
              <li>Preselection of most relevant blocks...</li>
            )}
            {completion === 0.8 && (
              <li>Post-processing {state.filteredBlocks.length} blocks...</li>
            )}
            {completion === 1 && (
              <li>
                ✔️ Insert {state.nbOfResults || state.filteredBlocks.length}{" "}
                results in your graph.
              </li>
            )}
          </ul>
        </>
      ),
      timeout: 20000,
    },
    toasterInstance
  );
};

const progressBarDisplay = (value: number) => {
  if (value > 1) value = 1;
  return (
    <ProgressBar
      value={value}
      className="laia-progressbar"
      intent={value < 1 ? Intent.PRIMARY : Intent.SUCCESS}
      animate={value < 1 ? true : false}
      stripes={value < 1 ? true : false}
    />
  );
};
