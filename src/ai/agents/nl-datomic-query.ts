import {
  Annotation,
  MessagesAnnotation,
  StateGraph,
  START,
} from "@langchain/langgraph/web";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
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
import {
  LlmInfos,
  TokensUsage,
  modelViaLanggraph,
} from "./langraphModelsLoader";
import { balanceBraces } from "../../utils/format";
import {
  displaySpinner,
  insertInstantButtons,
  removeSpinner,
} from "../../utils/domElts";
import { AppToaster } from "../../components/Toaster";
import { modelAccordingToProvider } from "../aiAPIsHub";
import { aiCompletion } from "../responseInsertion";
import { streamClaudeThinkingModel } from "./thinkingStreaming";

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
  model: Annotation<LlmInfos>,
  rootUid: Annotation<string>,
  targetUid: Annotation<string>,
  userNLQuery: Annotation<string>,
  llmResponse: Annotation<any>,
  datomicQuery: Annotation<string>,
  // period: Annotation<PeriodType>,
});

let llm: StructuredOutputType;
let turnTokensUsage: TokensUsage;

/*********/
// NODES //
/*********/

const loadModel = async (state: typeof QueryAgentState.State) => {
  llm = modelViaLanggraph(state.model, turnTokensUsage, false);
};

const interpreter = async (state: typeof QueryAgentState.State) => {
  const currentPageUid = getPageUidByBlockUid(state.rootUid);
  const currentDate = getCurrentOrRelativeDateString(state.rootUid);

  // const structuredLlm = llm.withStructuredOutput(querySchema, rawOption);
  const sysMsgStr = datomicQuerySystemPrompt.replace(
    "<CURRENT_DATE>",
    currentDate,
  );
  const sys_msg = new SystemMessage({
    content: sysMsgStr,
  });
  const humanMsgStr = !state.datomicQuery
    ? state.userNLQuery
    : `Here is the user request in natural language: ${state.userNLQuery}

Here is the way this request has alreedy been transcribed by an AI assistant in a Roam :q Datomic query: ${state.datomicQuery}

The user is requesting a new and, if possible, better transcription. Do it by meticulously respecting the whole indications and syntax rules provided above in the conversation. Do your best not to disappoint!`;
  // console.log("sys_msg :>> ", sys_msg);
  let messages = [sys_msg].concat([new HumanMessage(humanMsgStr)]);
  let response: any;
  try {
    if (!state.model.id.includes("+thinking")) {
      response =
        state.model.provider == "openRouter" &&
        state.model.id.includes("gemini")
          ? await aiCompletion({
              instantModel: state.model.prefix + state.model.id,
              systemPrompt: sysMsgStr,
              prompt: [{ role: "user", content: humanMsgStr }],
              isButtonToInsert: false,
            })
          : await llm.invoke(messages);
    } else {
      response = await streamClaudeThinkingModel(
        llm,
        messages,
        turnTokensUsage,
      );
    }
  } catch (error) {
    AppToaster.show({ message: error.message });
    return;
  }
  console.log("response :>> ", response);

  return {
    datomicQuery: response?.content || response,
  };
};

const formatChecker = async (state: typeof QueryAgentState.State) => {
  let query = state.datomicQuery;
  const correctedQuery = balanceBraces(query);
  // console.log("Query after correction :>> ", correctedQuery);
  return {
    datomicQuery: correctedQuery,
  };
};

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
      "last",
    );
  }
  return {
    targetUid: state.targetUid,
  };
};

/*********/
// EDGES //
/*********/

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

// Chat-mode graph: same pipeline but WITHOUT insertQuery (returns query string only)
const chatBuilder = new StateGraph(QueryAgentState);
chatBuilder
  .addNode("loadModel", loadModel)
  .addNode("interpreter", interpreter)
  .addNode("checker", formatChecker)
  .addEdge(START, "loadModel")
  .addEdge("loadModel", "interpreter")
  .addEdge("interpreter", "checker")
  .addEdge("checker", "__end__");

export const NLDatomicQueryInterpreterChatMode = chatBuilder.compile();

// Chat-friendly invocation: returns query string without writing to blocks
export const generateNLDatomicQuery = async ({
  model = defaultModel,
  prompt,
  rootUid,
  previousResponse,
}: {
  model: string;
  prompt: string;
  rootUid?: string;
  previousResponse?: string;
}): Promise<{ datomicQuery: string } | null> => {
  const llmModel: LlmInfos = modelAccordingToProvider(model || defaultModel);
  const response = await NLDatomicQueryInterpreterChatMode.invoke({
    model: llmModel,
    rootUid: rootUid || "",
    userNLQuery: prompt,
    datomicQuery: previousResponse || "",
  });
  if (response?.datomicQuery) {
    return { datomicQuery: response.datomicQuery };
  }
  return null;
};

interface AgentInvoker {
  model: string;
  rootUid: string;
  targetUid?: string;
  target?: string;
  prompt: string;
  previousResponse?: string;
}
// Invoke graph
export const invokeNLDatomicQueryInterpreter = async ({
  model = defaultModel,
  rootUid,
  targetUid,
  prompt,
  target,
  previousResponse,
}: AgentInvoker) => {
  const spinnerId = displaySpinner(rootUid);
  const llmModel: LlmInfos = modelAccordingToProvider(model || defaultModel);
  const response = await NLDatomicQueryInterpreter.invoke({
    model: llmModel,
    rootUid,
    userNLQuery: prompt,
    targetUid: target && target.includes("new") ? undefined : targetUid,
    datomicQuery: previousResponse,
  });
  removeSpinner(spinnerId);
  if (response) {
    setTimeout(() => {
      insertInstantButtons({
        model: response.model.id,
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
