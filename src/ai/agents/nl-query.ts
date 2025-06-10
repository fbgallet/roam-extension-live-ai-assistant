import {
  Annotation,
  MessagesAnnotation,
  StateGraph,
  START,
} from "@langchain/langgraph/web";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { defaultModel } from "../..";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import {
  createChildBlock,
  getCurrentOrRelativeDateString,
  getDNPTitleFromDate,
  isExistingBlock,
  updateBlock,
} from "../../utils/roamAPI";
import { roamQuerySystemPrompt } from "./agent-prompts";
import {
  LlmInfos,
  TokensUsage,
  getLlmSuitableOptions,
  modelViaLanggraph,
} from "./langraphModelsLoader";
import { balanceBraces, sanitizeClaudeJSON } from "../../utils/format";
import {
  displaySpinner,
  insertInstantButtons,
  removeSpinner,
} from "../../utils/domElts";
import { modelAccordingToProvider } from "../aiAPIsHub";
import { AppToaster } from "../../components/Toaster";
import { streamClaudeThinkingModel } from "./thinkingStreaming";
import { replaceStringNullWithActualNull } from "./tools";

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
        // .optional()
        .nullable()
        .describe(
          "Relative dates, only if corresponding to one the available item, otherwise null"
        ),
    })
    // .optional()
    .nullable()
    .describe(
      "Restricted period of the request, only if mentioned by the user, otherwise set to null"
    ),
});

let llm: StructuredOutputType;
let turnTokensUsage: TokensUsage;

/*********/
// NODES //
/*********/

const loadModel = async (state: typeof QueryAgentState.State) => {
  llm = modelViaLanggraph(state.model, turnTokensUsage);
};

const interpreter = async (state: typeof QueryAgentState.State) => {
  const currentDate = getCurrentOrRelativeDateString(state.rootUid);

  const structuredLlm = llm.withStructuredOutput(
    querySchema,
    getLlmSuitableOptions(state.model, "query", 0) // temperature = 0
  );
  const sys_msg = new SystemMessage({
    content: roamQuerySystemPrompt.replace("<CURRENT_DATE>", currentDate),
  });
  // console.log("sys_msg :>> ", sys_msg);
  let messages = [sys_msg].concat([
    new HumanMessage(
      !state.roamQuery
        ? state.userNLQuery
        : `Here is the user request in natural language: ${state.userNLQuery}
    
    Here is the way this request has alreedy been transcribed by an AI assistant in a Roam Research query: ${state.roamQuery}
    
    The user is requesting a new and, if possible, better transcription. Do it by meticulously respecting the whole indications and syntax rules provided above in the conversation. Do your best not to disappoint!`
    ),
  ]);
  let response;
  try {
    // if (!state.model.id.includes("+thinking")) {
    response = await structuredLlm.invoke(messages);
    // Extended thinking not compatible with structured output yet
    // } else {
    //   response = await streamClaudeThinkingModel(
    //     structuredLlm,
    //     messages,
    //     turnTokensUsage
    //   );
    // }
  } catch (error) {
    AppToaster.show({ message: error.message });
  }

  return {
    llmResponse: response,
  };
};

const formatChecker = async (state: typeof QueryAgentState.State) => {
  let query = state.llmResponse.roamQuery;
  const isClaudeModel = state.model.id.toLowerCase().includes("claude");
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
      query = state.llmResponse.roamQuery;
    }
  }
  const correctedQuery = balanceBraces(query);
  state.llmResponse = replaceStringNullWithActualNull(state.llmResponse);
  // console.log("Query after correction :>> ", correctedQuery);
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
  if (state.targetUid && isExistingBlock(state.targetUid)) {
    await updateBlock({
      blockUid: state.targetUid,
      newContent: state.roamQuery,
    });
  } else {
    state.targetUid = await createChildBlock(
      state.rootUid,
      state.roamQuery,
      "last"
    );
  }
  return {
    targetUid: state.targetUid,
  };
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

interface AgentInvoker {
  model: string;
  rootUid: string;
  targetUid?: string;
  target?: string;
  prompt: string;
  previousResponse?: string;
}
// Invoke graph
export const invokeNLQueryInterpreter = async ({
  model = defaultModel,
  rootUid,
  targetUid,
  target,
  prompt,
  previousResponse,
}: AgentInvoker) => {
  let llmInfos: LlmInfos = modelAccordingToProvider(model);
  const spinnerId = displaySpinner(rootUid);
  const response = await NLQueryInterpreter.invoke({
    model: llmInfos,
    rootUid,
    userNLQuery: prompt,
    targetUid: target && target.includes("new") ? undefined : targetUid,
    roamQuery: previousResponse,
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
        response: response.roamQuery,
        aiCallback: invokeNLQueryInterpreter,
      });
    }, 100);
  }
  console.log("Agent response:>>", response);
};
