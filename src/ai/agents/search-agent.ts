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
  getMultipleMatchingRegexInTreeQuery,
  getPageUidByBlockUid,
  getPathOfBlock,
} from "../../utils/roamAPI";
import {
  searchAgentListToFiltersSystemPrompt,
  searchAgentNLtoKeywordsSystempPrompt,
  searchtAgentPreselectionPrompt,
  searchtAgentPostProcessingPrompt,
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
  sliceByWordLimit,
} from "../../utils/dataProcessing";
import { insertStructuredAIResponse } from "../responseInsertion";
import { getFlattenedContentFromTree } from "../dataExtraction";

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
  isPostProcessingNeeded: Annotation<boolean>,
  nbOfResults: Annotation<number>,
  matchingBlocks: Annotation<any>,
  filteredBlocks: Annotation<any>,
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
  isRandom: z
    .boolean()
    .optional()
    .describe("Number of requested results, otherwise null"),
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
          .describe("True if this regexString is to exclude"),
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
    isPostProcessingNeeded: response.isPostProcessingNeeded,
    nbOfResults: response.nbOfResults,
    period: response.period,
    pagesLimitation: response.pagesLimitation,
    isRandom: response.isRandom,
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
        getBlocksMatchingRegexQuery(toExcludeFilter, state.pagesLimitation),
        ...params
      ) || [];
    console.log("blocksMatchingAllFilters :>> ", blocksMatchingAllFilters);
    blocksMatchingAllFilters = blocksMatchingAllFilters.map((block) => {
      return {
        uid: block[0],
        content: block[1],
        editTime: block[2],
        pageTitle: block[3],
      };
    });
    blocksMatchingAllFilters = excludeItemsInArray(
      blocksMatchingAllFilters,
      [{ uid: state.rootUid }],
      "uid"
    );
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
        getBlocksMatchingRegexQuery(toExcludeFilter, state.pagesLimitation),
        ...params
      ) || [];
    blocksMatchingOneFilter = blocksMatchingOneFilter.map((block) => {
      return {
        uid: block[0],
        content: block[1],
        editTime: block[2],
        pageTitle: block[3],
      };
    });

    if (blocksMatchingOneFilter.length) {
      let uidsMatchingOneFilter = blocksMatchingOneFilter.map(
        (elt: any) => elt.uid
      );

      uidsMatchingOneFilter = excludeItemsInArray(
        uidsMatchingOneFilter,
        allMatchingUids.concat(state.rootUid)
      );

      const otherRegexString = allIncludeRegex.filter((f) => f !== filter);

      let blocksAndChildrenMatchingAllFilters: any[] = [];

      const additionalRegex = toExcludeFilter
        ? otherRegexString.concat(regexToExclude)
        : otherRegexString;

      if (additionalRegex.length) {
        blocksAndChildrenMatchingAllFilters =
          (window as any).roamAlphaAPI.q(
            getMultipleMatchingRegexInTreeQuery(
              neededRegexNumber,
              toExcludeFilter,
              state.pagesLimitation
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
              pageTitle: block[3],
              childMatchingContent:
                block.length > 2
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
      state.matchingBlocks && state.matchingBlocks.length
        ? concatWithoutDuplicates(state.matchingBlocks, matchingBlocks, "uid")
        : matchingBlocks,
  };
};

const limitAndOrder = async (state: typeof SearchAgentState.State) => {
  console.log("state :>> ", state);
  let filteredBlocks = excludeItemsInArray(
    state.matchingBlocks,
    [{ uid: state.rootUid }],
    "uid"
  );
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
    ? state.nbOfResults * (state.isPostProcessingNeeded ? 5 : 1)
    : null;
  let maxNumber = requestedNb && requestedNb < 100 ? requestedNb : 100;
  maxNumber;
  if (maxNumber < filteredBlocks.length)
    filteredBlocks = filteredBlocks.slice(0, maxNumber);
  console.log("filteredBlocks & sorted :>> ", filteredBlocks);
  return {
    filteredBlocks,
  };
};

const preselection = async (state: typeof SearchAgentState.State) => {
  console.log("Preselection Node");
  let flattenedQueryResults = "";
  state.filteredBlocks.forEach((block: any, index: number) => {
    const path = getPathOfBlock(block.uid);
    const directParent = path ? sliceByWordLimit(path.at(-1), 20) : null;
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

  let flattenedDetailedResults = "";
  state.filteredBlocks.forEach((block: any, index: number) => {
    let path = getPathOfBlock(block.uid);
    let pathString = "";
    if (path)
      for (let i = 0; i < path.length; i++) {
        const isDirectParent = i === path.length - 1;
        pathString +=
          sliceByWordLimit(path[i], isDirectParent ? 6 : 30) +
          (isDirectParent ? "" : " > ");
      }
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
  console.log("Display results !");
  console.log(
    "state.strigifiedResultToDisplay :>> ",
    state.strigifiedResultToDisplay
  );

  if (!state.strigifiedResultToDisplay) {
    state.strigifiedResultToDisplay = "";
    if (!state.filteredBlocks.length) {
      state.strigifiedResultToDisplay = "No matching blocks";
    } else {
      // Limit to 20 the number of displayed blocks
      const filteredBlocks = state.filteredBlocks.slice(0, 20);
      filteredBlocks.forEach((block: any) => {
        state.strigifiedResultToDisplay += `- {{embed-path: ((${block.uid}))}}\n`;
        // if (block.childMatchingContent) {
        //   let children = block.childMatchingContent;
        //   for (let i = 0; i < children.length; i++) {
        //     state.strigifiedResultToDisplay += `  - ((${children[i].uid}))\n`;
        //   }
        // }
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
  // .addConditionalEdges("queryRunner", alternativeQuery)
  .addEdge("queryRunner", END)
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
