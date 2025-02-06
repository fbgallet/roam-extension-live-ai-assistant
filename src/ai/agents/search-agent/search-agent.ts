import {
  Annotation,
  MessagesAnnotation,
  StateGraph,
  START,
  END,
} from "@langchain/langgraph/web";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { chatRoles, defaultModel, getInstantAssistantRole } from "../../..";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import {
  createChildBlock,
  getDNPTitleFromDate,
  getDateStringFromDnpUid,
  getFirstChildContent,
  getFormattedPath,
  getPageUidByBlockUid,
  getParentBlock,
  getPathOfBlock,
} from "../../../utils/roamAPI";
import {
  searchAgentListToFiltersSystemPrompt,
  searchtAgentPreselectionPrompt,
  searchtAgentPostProcessingPrompt,
  semanticInstructions,
  hierarchyInstructions1,
  hierarchyInstructions2,
  searchAgentNLQueryEvaluationPrompt,
  postProcessingToNull,
  postProcessingProperty,
  periodProperty,
  inferenceNeededProperty,
  hierarchyNLInstructions,
  searchAgentNLInferenceFromQuestionPrompt,
} from "./search-agent-prompts";
import {
  LlmInfos,
  TokensUsage,
  modelViaLanggraph,
} from "../langraphModelsLoader";
import { balanceBraces, sanitizeClaudeJSON } from "../../../utils/format";
import { insertInstantButtons } from "../../../utils/domElts";
import { modelAccordingToProvider } from "../../aiAPIsHub";
import { dnpUidRegex, getConjunctiveRegex } from "../../../utils/regex";
import {
  concatWithoutDuplicates,
  excludeItemsInArray,
  getRandomElements,
  removeDuplicatesByProperty,
  sliceByWordLimit,
} from "../../../utils/dataProcessing";
import { insertStructuredAIResponse } from "../../responseInsertion";
import {
  getFlattenedContentFromTree,
  getFocusAndSelection,
} from "../../dataExtraction";
import { AgentToaster, AppToaster } from "../../../components/Toaster";
import { Intent, ProgressBar } from "@blueprintjs/core";
import {
  alternativeSearchListSchema,
  preselectionSchema,
  searchFiltersSchema,
  searchListSchema,
} from "../structuredOutput-schemas";
import { updateTokenCounter } from "../../modelsInfo";
import { displayAgentStatus } from "./status-toast";
import {
  descendantRule,
  getBlocksMatchingRegexQuery,
  getMultipleMatchingRegexInTreeQuery,
  getSiblingsParentMatchingRegexQuery,
  parseQueryResults,
} from "./datomicQueries";

interface PeriodType {
  begin: string;
  end: string;
}

let beginPerf: number, endPerf: number;
let llm: StructuredOutputType;
export let toasterInstance: string;
let turnTokensUsage: TokensUsage;

export const SearchAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  model: Annotation<string>,
  rootUid: Annotation<string>,
  targetUid: Annotation<string>,
  target: Annotation<string>,
  userNLQuery: Annotation<string>,
  llmResponse: Annotation<any>,
  searchLists: Annotation<any>,
  isPostProcessingNeeded: Annotation<boolean>,
  nbOfResults: Annotation<number>,
  getChildrenOnly: Annotation<boolean>,
  matchingBlocks: Annotation<any>,
  filteredBlocks: Annotation<any>,
  filters: Annotation<any>,
  remainingQueryFilters: Annotation<any>,
  period: Annotation<PeriodType>,
  pagesLimitation: Annotation<string>,
  isRandom: Annotation<boolean>,
  stringifiedResultToDisplay: Annotation<string>,
  shiftDisplay: Annotation<number>,
  nbOfResultsDisplayed: Annotation<number>,
  retryInstruction: Annotation<string>,
  errorInNode: Annotation<String>,
});

/*********/
// NODES //
/*********/

const loadModel = async (state: typeof SearchAgentState.State) => {
  let modelShortcut: string = state.model || defaultModel;
  let llmInfos: LlmInfos = modelAccordingToProvider(modelShortcut);
  llm = modelViaLanggraph(llmInfos, turnTokensUsage);
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

  let isDirected =
    state.userNLQuery.includes("<") || state.userNLQuery.includes(">");

  let systemPrompt =
    state.isPostProcessingNeeded === false
      ? searchAgentNLQueryEvaluationPrompt
          .replace("<POST_PROCESSING_PROPERTY>", postProcessingToNull)
          .replace("<PERIOD_PROPERTY>", "")
      : searchAgentNLQueryEvaluationPrompt
          .replace("<POST_PROCESSING_PROPERTY>", postProcessingProperty)
          .replace("<PERIOD_PROPERTY>", periodProperty)
          .replace("<CURRENT_DATE>", currentDate);

  systemPrompt = isDirected
    ? systemPrompt
        .replace("<INFERENCE_PROPERTY>", "")
        .replace("<HIERARCHY_NL>", "")
    : systemPrompt
        .replace("<INFERENCE_PROPERTY>", inferenceNeededProperty)
        .replace("<HIERARCHY_NL>", hierarchyNLInstructions);

  const sys_msg = new SystemMessage({
    content: systemPrompt,
  });
  // console.log("sys_msg :>> ", sys_msg);
  let messages = [sys_msg].concat([
    new HumanMessage(
      !state.retryInstruction || state.retryInstruction === state.userNLQuery
        ? state.userNLQuery
        : `Here is the initial user request in natural language: ${state.userNLQuery}

       Notice that the user is requesting a new and, if possible, better interpretation of its requests. Here is some modification or indication on what to do better or how to proceed to provide a more relevant result: ${state.retryInstruction}`
    ),
  ]);
  let llmResponse;
  try {
    llmResponse = await structuredLlm.invoke(messages);
    state.errorInNode = null;
  } catch (error) {
    console.log("error at nl-query-interpreter :>> ", error);
    state.errorInNode = "nl-query-interpreter";
  }

  console.log("llmResponse after basic interpreter :>> ", llmResponse);

  return {
    llmResponse,
    errorInNode: state.errorInNode,
  };
};

const nlQuestionInterpreter = async (state: typeof SearchAgentState.State) => {
  displayAgentStatus(state, "nl-question-interpreter");

  const isClaudeModel = state.model.toLowerCase().includes("claude");
  const rawOption = isClaudeModel
    ? {
        includeRaw: true,
      }
    : {};

  const structuredLlm = llm.withStructuredOutput(
    alternativeSearchListSchema,
    rawOption
  );
  const sys_msg = new SystemMessage({
    content: searchAgentNLInferenceFromQuestionPrompt,
  });
  // console.log("sys_msg :>> ", sys_msg);
  let messages = [sys_msg].concat([
    new HumanMessage(
      `Here is the initial user request in natural language: ${
        state.userNLQuery
      }
Here is the formatted search query generated with keywords from the previous user request: ${
        state.llmResponse.searchList
      }
${
  !state.retryInstruction || state.retryInstruction === state.userNLQuery
    ? ""
    : `Notice that the user is requesting a new and, if possible, better interpretation of its requests. Here is some modification or indication on what to do better or how to proceed to provide a more relevant result: ${state.retryInstruction}`
}`
    ),
  ]);
  let llmResponse;
  try {
    llmResponse = await structuredLlm.invoke(messages);
    state.errorInNode = null;
  } catch (error) {
    console.log("error at nl-question-interpreter :>> ", error);
    state.errorInNode = "nl-question-interpreter";
  }

  console.log("llmResponse after question interpreter :>> ", llmResponse);

  return {
    llmResponse,
    errorInNode: state.errorInNode,
  };
};

const searchlistConverter = async (state: typeof SearchAgentState.State) => {
  console.log("state.searchLists :>> ", state.searchLists);
  displayAgentStatus(state, "searchlist-converter");

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
  let systemPrompt = searchAgentListToFiltersSystemPrompt.replace(
    "<SEMANTINC-INSTRUCTIONS>",
    state.searchLists[0].includes("~") ? semanticInstructions : ""
  );
  if (state.searchLists[0].includes(">") || state.searchLists[0].includes("<"))
    systemPrompt = systemPrompt
      .replace("<HIERARCHY-INSTRUCTIONS-1>", hierarchyInstructions1)
      .replace("<HIERARCHY-INSTRUCTIONS-2>", hierarchyInstructions2);
  const sys_msg = new SystemMessage({
    content: systemPrompt,
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
        `\n\nInitial user request from which the search list(s) is(are) extracted, provided only as context and for a better indication of the language to use in the semantic variations (e.g. if the user request is in french, write only variations in french): ${state.userNLQuery}` +
        (state.retryInstruction && state.retryInstruction !== state.userNLQuery
          ? `\nNotice that the user is requesting a new and, if possible, better interpretation of its requests. Here is some modification or indication on what to do better or how to proceed to provide a more relevant result: ${state.retryInstruction}`
          : "")
    ),
  ]);
  let llmResponse;
  try {
    llmResponse = await structuredLlm.invoke(messages);
    state.errorInNode = null;
  } catch (error) {
    console.log("error at searchListConverter :>> ", error);
    state.errorInNode = "searchlist-converter";
  }
  console.log("response after step 2 (list converter) :>> ", llmResponse);

  return {
    llmResponse,
    errorInNode: state.errorInNode,
  };
};

const formatChecker = async (state: typeof SearchAgentState.State) => {
  if (state.errorInNode) return state;

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
      }
    } else {
      state.llmResponse = state.llmResponse.parsed;
    }
  }
  // console.log("llmResponse after check :>> ", state.llmResponse);

  // after "nlQueryInterpreter" node
  if ("searchList" in state.llmResponse) {
    let searchLists = [state.llmResponse?.searchList];
    state.getChildrenOnly = searchLists[0].includes(" < ") ? true : false;
    if (state.llmResponse?.alternativeList)
      searchLists.push(state.llmResponse?.alternativeList);
    state.searchLists = searchLists;
    state.isPostProcessingNeeded =
      state.isPostProcessingNeeded === false
        ? false
        : state.llmResponse.isPostProcessingNeeded;
    state.nbOfResults = state.llmResponse.nbOfResults
      ? state.llmResponse.nbOfResults
      : state.llmResponse.isRandom
      ? 1
      : undefined;
    state.period = state.llmResponse.period;
    state.pagesLimitation = state.llmResponse.pagesLimitation;
    state.isRandom = state.llmResponse.isRandom;
  }
  // after "nlQuestionInterpreter" node
  else if ("searchList" in state.llmResponse) {
    let alternativeSearchList = state.llmResponse.alternativeSearchList;
    alternativeSearchList && state.searchLists.push(alternativeSearchList);
  }
  // after "searchlistConverter" node
  else if ("firstListFilters" in state.llmResponse) {
    let filters = [state.llmResponse.firstListFilters];
    if (state.llmResponse.alternativeListFilters)
      filters.push(state.llmResponse.alternativeListFilters);
    state.filters = filters;
    state.remainingQueryFilters = [...filters];
  }

  console.log("searchLists :>> ", state.searchLists);
  console.log("state :>> ", state);

  return state;
  //   llmResponse: state.llmResponse,
  //   period: state.period || state.llmResponse.period || null,
  // };
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
  // small delay so the status toaster can be updated before running queries
  await new Promise((resolve) => setTimeout(resolve, 100));
  beginPerf = performance.now();

  console.log("state in queryRunner :>> ", state);
  let currentFilter = state.remainingQueryFilters.shift();
  if (state.getChildrenOnly)
    currentFilter = currentFilter.sort((a: any, b: any) => {
      if (a.isTopBlockFilter && !b.isTopBlockFilter) {
        return -1;
      }
      if (!a.isTopBlockFilter && b.isTopBlockFilter) {
        return 1;
      }
      return 0;
    });
  console.log("currentFilter :>> ", currentFilter);
  const parentFilterNb = currentFilter.reduce((count: number, item: any) => {
    return item.isTopBlockFilter ? count + 1 : count;
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
  if (
    allIncludeRegex.length > 1 &&
    !isDirectedFilter &&
    !state.getChildrenOnly
  ) {
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
        // to ignore if already matching all filters
        let uidsMatchingOneFilter = blocksMatchingOneFilter.map(
          (elt: any) => elt.uid
        );
        uidsMatchingOneFilter = excludeItemsInArray(
          uidsMatchingOneFilter,
          allMatchingUids.concat(state.rootUid)
        );

        // if a parent and a direct child match the same filter, ignore the parent
        let parentsToIgnore: any[] = [];
        for (let i = 0; i < blocksMatchingOneFilter.length; i++) {
          const directParentUid = getParentBlock(
            blocksMatchingOneFilter[i].uid
          );
          if (
            uidsMatchingOneFilter.includes(directParentUid) &&
            !parentsToIgnore.includes(directParentUid)
          )
            parentsToIgnore.push(directParentUid);
        }
        if (parentsToIgnore.length)
          uidsMatchingOneFilter = excludeItemsInArray(
            uidsMatchingOneFilter,
            parentsToIgnore
          );

        let blocksAndChildrenMatchingAllFilters: any[] = [];
        const otherRegexString =
          !isDirectedFilter || parentFilterNb <= 1
            ? allIncludeRegex.filter((f) => f !== filter)
            : allIncludeRegex.slice(parentFilterNb);
        const additionalRegex = toExcludeFilter
          ? otherRegexString.concat(regexToExclude)
          : otherRegexString;

        // if multiple filters, test if children (any level) includes remaining filters
        console.log("uidsMatchingOneFilter :>> ", uidsMatchingOneFilter);
        if (additionalRegex.length) {
          blocksAndChildrenMatchingAllFilters = state.getChildrenOnly
            ? (window as any).roamAlphaAPI.q(
                getBlocksMatchingRegexQuery(
                  toExcludeFilter,
                  state.pagesLimitation,
                  true
                ),
                descendantRule,
                uidsMatchingOneFilter,
                ...additionalRegex
              )
            : (window as any).roamAlphaAPI.q(
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

        if (
          !state.getChildrenOnly &&
          !isDirectedFilter &&
          otherRegexString.length
        ) {
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
  state.matchingBlocks = excludeItemsInArray(
    state.matchingBlocks,
    [state.rootUid].concat(rootPathUids),
    "uid",
    false
  );
  let filteredBlocks = state.matchingBlocks;
  console.log("matchingBlocks in limitAndOrder :>> ", filteredBlocks);

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

  if (state.isRandom) {
    state.matchingBlocks = filteredBlocks;
    filteredBlocks = getRandomElements(filteredBlocks, maxNumber);
  } else if (maxNumber < filteredBlocks.length)
    filteredBlocks = filteredBlocks.slice(0, maxNumber);
  console.log("filteredBlocks & sorted :>> ", filteredBlocks);
  return {
    matchingBlocks: state.matchingBlocks,
    filteredBlocks,
  };
};

const preselection = async (state: typeof SearchAgentState.State) => {
  console.log("Preselection Node");
  displayAgentStatus(state, "preselection-filter");
  let flattenedQueryResults = "";
  state.filteredBlocks.forEach((block: any, index: number) => {
    const path = getPathOfBlock(block.uid);
    const directParent =
      path && path.at(-1).string
        ? sliceByWordLimit(path.at(-1).string, 20)
        : null;
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

${
  state.retryInstruction && state.retryInstruction !== state.userNLQuery
    ? `\nNotice that the user is requesting a new and, if possible, better interpretation of its requests. Here is some modification or indication on what to do better or how to proceed to provide a more relevant result: ${state.retryInstruction}\n`
    : ""
}
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

${
  state.retryInstruction && state.retryInstruction !== state.userNLQuery
    ? `\nNotice that the user is requesting a new and, if possible, better interpretation of its requests. Here is some modification or indication on what to do better or how to proceed to provide a more relevant result: ${state.retryInstruction}\n`
    : ""
}
Here are the main blocks in Roam graph database that match with this request:
${flattenedDetailedResults}`),
  ]);
  let response = await llm.invoke(messages);
  console.log("AI results processed response :>> ", response);
  return {
    stringifiedResultToDisplay: response.content,
  };
};

const displayResults = async (state: typeof SearchAgentState.State) => {
  // console.log(
  //   "state.stringifiedResultToDisplay :>> ",
  //   state.stringifiedResultToDisplay
  // );

  state.nbOfResultsDisplayed = 0;
  let previousShiftDisplay = state.shiftDisplay || 0;

  if (!state.stringifiedResultToDisplay) {
    state.stringifiedResultToDisplay = "";
    if (!state.filteredBlocks.length) {
      state.stringifiedResultToDisplay = "No matching blocks";
    } else {
      // Limit to 10 the number of displayed blocks
      const nbToDisplay = state.nbOfResults || 10;
      const filteredBlocks = state.filteredBlocks.slice(
        state.shiftDisplay || 0,
        state.shiftDisplay ? nbToDisplay + state.shiftDisplay : nbToDisplay
      );
      filteredBlocks.forEach((block: any) => {
        state.stringifiedResultToDisplay += `- {{embed-path: ((${block.uid}))}}\n`;
      });
      state.shiftDisplay = (state.shiftDisplay || 0) + nbToDisplay;
      state.nbOfResultsDisplayed += Math.min(
        nbToDisplay,
        state.filteredBlocks.length - previousShiftDisplay
      );
      if (
        !previousShiftDisplay &&
        state.shiftDisplay >= state.filteredBlocks.length
      )
        state.shiftDisplay = null;
    }
  }
  displayAgentStatus(state, "output");

  const assistantRole = state.model
    ? getInstantAssistantRole(state.model)
    : chatRoles.assistant;
  let targetUid;
  if (state.target?.includes("new") || !state.target)
    targetUid = await createChildBlock(
      state.rootUid,
      (state.target === "new" || !state.target ? assistantRole : "") +
        (state.shiftDisplay
          ? `Results ${previousShiftDisplay + 1} to ${
              previousShiftDisplay + (state.nbOfResultsDisplayed || 10)
            }`
          : "")
    );

  console.log("state :>> ", state);

  await insertStructuredAIResponse({
    target: state.target,
    targetUid: targetUid || state.rootUid,
    content: state.stringifiedResultToDisplay.trim(),
    forceInChildren: state.shiftDisplay && true,
  });
  return {
    targetUid: targetUid || state.rootUid,
    stringifiedResultToDisplay: state.stringifiedResultToDisplay.trim(),
    nbOfResultsDisplayed: state.nbOfResultsDisplayed,
    shiftDisplay: !state.isRandom && state.shiftDisplay,
  };
};

/*********/
// EDGES //
/*********/

const turnRouter = (state: typeof SearchAgentState.State) => {
  if (state.filteredBlocks) {
    if (state.isPostProcessingNeeded) {
      if (
        state.filteredBlocks.length <= 20 ||
        (state.nbOfResults &&
          state.filteredBlocks.length < Math.min(20, state.nbOfResults * 3))
      )
        return "post-processing";
      return "preselection-filter";
    }
    if (state.isRandom) return "limitAndOrder";
    if (state.shiftDisplay) return "output";
  }
  return "nl-query-interpreter";
};

const afterCheckRouter = (state: typeof SearchAgentState.State) => {
  if (state.errorInNode) {
    switch (state.errorInNode) {
      case "nl-query-interpreter":
        return "nl-query-interpreter";
      case "nl-question-interpreter":
        return "nl-question-interpreter";
      case "searchlist-converter":
        return "searchlist-converter";
    }
  }
  if ("searchList" in state.llmResponse) {
    if (state.llmResponse.isInferenceNeeded && state.searchLists.length < 2)
      return "nl-question-interpreter";
    else return END; // "searchlist-converter";
  }
  if ("alternativeSearchList" in state.llmResponse) return END;
  return END;
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

/***************/
// BUILD GRAPH //
/***************/

const builder = new StateGraph(SearchAgentState);
builder
  .addNode("loadModel", loadModel)
  .addNode("nl-query-interpreter", nlQueryInterpreter)
  .addNode("nl-question-interpreter", nlQuestionInterpreter)
  .addNode("searchlist-converter", searchlistConverter)
  .addNode("checker", formatChecker)
  .addNode("periodFormater", periodFormater)
  .addNode("queryRunner", queryRunner)
  .addNode("limitAndOrder", limitAndOrder)
  .addNode("preselection-filter", preselection)
  .addNode("post-processing", postProcessing)
  .addNode("output", displayResults)

  .addEdge(START, "loadModel")
  .addConditionalEdges("loadModel", turnRouter)
  .addEdge("nl-query-interpreter", "checker")
  .addEdge("nl-question-interpreter", "checker")
  .addEdge("searchlist-converter", "checker")
  .addConditionalEdges("checker", afterCheckRouter)
  .addEdge("periodFormater", "queryRunner")
  .addConditionalEdges("queryRunner", alternativeQuery)
  .addConditionalEdges("limitAndOrder", processOrDisplay)
  .addConditionalEdges("preselection-filter", processOrDisplay)
  .addEdge("post-processing", "output")
  .addEdge("output", END);

/**************************/
// Compile & Invoke graph //
/**************************/

export const SearchAgent = builder.compile();

interface AgentInvoker {
  model: string;
  rootUid: string;
  target: string;
  targetUid?: string;
  prompt: string;
  previousAgentState?: any;
  onlySearch?: boolean;
  options?: any;
}

export const invokeSearchAgent = async ({
  model = defaultModel,
  rootUid,
  targetUid,
  target,
  prompt,
  previousAgentState,
  options,
}: AgentInvoker) => {
  invokeAskAgent({
    model,
    rootUid,
    target,
    targetUid,
    prompt,
    previousAgentState,
    onlySearch: true,
    options,
  });
};

export const invokeAskAgent = async ({
  model = defaultModel,
  rootUid,
  target,
  targetUid,
  prompt,
  previousAgentState,
  onlySearch,
  options = {},
}: AgentInvoker) => {
  let begin = performance.now();
  turnTokensUsage = { input_tokens: 0, output_tokens: 0 };

  toasterInstance = AgentToaster.show({
    message: "",
  });

  // console.log("options :>> ", options);
  // console.log("previousAgentState :>> ", previousAgentState);

  if (options?.isPostProcessingNeeded) {
    let { currentUid, currentBlockContent } = getFocusAndSelection();
    if (!currentBlockContent) {
      AppToaster.show({
        message:
          "You have to focus a block to provide instructions or question for post-processing",
      });
      return;
    }
    rootUid = currentUid;
    prompt = currentBlockContent;
  }

  const response = await SearchAgent.invoke({
    model,
    rootUid,
    userNLQuery: prompt,
    target,
    targetUid,
    isPostProcessingNeeded: !onlySearch,
    ...previousAgentState,
    ...options,
  });

  let end = performance.now();
  console.log(
    "Search Agent delay :>> ",
    ((end - begin) / 1000).toFixed(2) + "s"
  );
  console.log("Global turnTokensUsage :>> ", turnTokensUsage);
  updateTokenCounter(model, turnTokensUsage);

  console.log("Agent response :>> ", response);

  if (response) {
    setTimeout(() => {
      insertInstantButtons({
        model: response.model,
        prompt: response.userNLQuery,
        currentUid: rootUid,
        targetUid: response.shiftDisplay ? rootUid : response.targetUid,
        responseFormat: "text",
        response: response.stringifiedResultToDisplay,
        agentData: {
          userNLQuery: response.userNLQuery,
          searchLists: response.searchLists,
          filteredBlocks: response.filteredBlocks,
          matchingBlocks: response.isRandom && response.matchingBlocks,
          filters: response.filters,
          nbOfResults: response.nbOfResults,
          getChildrenOnly: response.getChildrenOnly,
          isRandom: response.isRandom,
          perdiod: response.period,
          pageLimitation: response.pageLimitation,
          shiftDisplay:
            response.shiftDisplay < response.filteredBlocks?.length &&
            response.shiftDisplay,
        },
        aiCallback: onlySearch ? invokeSearchAgent : invokeAskAgent,
      });
    }, 200);
  }
};
