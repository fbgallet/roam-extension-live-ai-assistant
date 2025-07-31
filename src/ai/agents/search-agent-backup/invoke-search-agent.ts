import { defaultModel } from "../../..";
import { LlmInfos, TokensUsage } from "../langraphModelsLoader";
import { insertInstantButtons } from "../../../utils/domElts";
import { getFocusAndSelection } from "../../dataExtraction";
import { AgentToaster, AppToaster } from "../../../components/Toaster";
import { updateTokenCounter } from "../../modelsInfo";
import { SearchAgent } from "./search-agent";
import { modelAccordingToProvider } from "../../aiAPIsHub";

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
  console.log("defaultModel in invokeAskAgent:>> ", defaultModel);
  let llmInfos: LlmInfos = modelAccordingToProvider(model || defaultModel);

  toasterInstance = AgentToaster.show({
    message: "",
  });

  console.log("🔍 invokeAskAgent received prompt:", prompt);
  console.log("🔍 previousAgentState:", previousAgentState?.conversationHistory?.length || 0, "messages");
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
    model: llmInfos,
    rootUid,
    target,
    targetUid,
    isPostProcessingNeeded: onlySearch ? false : undefined,
    // Spread previousAgentState first, then override with current values
    ...previousAgentState,
    ...options,
    // Conversation mode support - these should override previousAgentState
    isConversationMode: previousAgentState?.isConversationMode || false,
    conversationHistory: previousAgentState?.conversationHistory || [],
    conversationSummary: previousAgentState?.conversationSummary,
    previousSearchResults: previousAgentState?.previousSearchResults,
    // MOST IMPORTANT: userNLQuery should be the current prompt, not from previousAgentState
    userNLQuery: prompt,
  });

  let end = performance.now();
  console.log(
    "Search Agent delay :>> ",
    ((end - begin) / 1000).toFixed(2) + "s"
  );
  console.log("Global turnTokensUsage :>> ", turnTokensUsage);
  updateTokenCounter(llmInfos.id, turnTokensUsage);

  console.log("Agent response :>> ", response);

  if (response) {
    setTimeout(() => {
      insertInstantButtons({
        model: llmInfos.id,
        prompt: [{ role: "user", content: response.userNLQuery }],
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
          pagesLimitation: response.pagesLimitation,
          shiftDisplay:
            response.shiftDisplay < response.filteredBlocks?.length &&
            response.shiftDisplay,
          // Conversation mode fields
          conversationHistory: response.conversationHistory || [],
          conversationSummary: response.conversationSummary,
          previousSearchResults: response.previousSearchResults,
          isConversationMode: true, // Enable conversation mode for subsequent interactions
        },
        aiCallback: onlySearch ? invokeSearchAgent : invokeAskAgent,
      });
    }, 200);
  }
};
