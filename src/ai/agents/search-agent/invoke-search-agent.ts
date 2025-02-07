import { defaultModel } from "../../..";
import { TokensUsage } from "../langraphModelsLoader";
import { insertInstantButtons } from "../../../utils/domElts";
import { getFocusAndSelection } from "../../dataExtraction";
import { AgentToaster, AppToaster } from "../../../components/Toaster";
import { updateTokenCounter } from "../../modelsInfo";
import { SearchAgent } from "./search-agent";

export let toasterInstance: string;
export let turnTokensUsage: TokensUsage;

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
          depthLimitation: response.depthLimitation,
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
