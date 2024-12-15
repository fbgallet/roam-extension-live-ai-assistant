import {
  Annotation,
  MessagesAnnotation,
  StateGraph,
  START,
} from "@langchain/langgraph/web";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
} from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { arrayOutputType, z } from "zod";
import { OPENAI_API_KEY, groqLibrary, openaiLibrary } from "../..";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import {
  createChildBlock,
  dnpUidRegex,
  getDNPTitleFromDate,
  getDateStringFromDnpUid,
  getPageUidByBlockUid,
  updateTokenCounter,
} from "../../utils/utils";
import { CallbackManager } from "@langchain/core/callbacks/manager";
import { interpreterSystemPrompt } from "./agent-prompts";

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
  rootUid: Annotation<string>,
  userNLQuery: Annotation<string>,
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
  const tokensUsageCallback = CallbackManager.fromHandlers({
    async handleLLMEnd(output: any) {
      console.log("Used tokens", output.llmOutput?.tokenUsage);
      const usage = {
        input_tokens: output.llmOutput?.tokenUsage?.promptTokens,
        output_tokens: output.llmOutput?.tokenUsage?.completionTokens,
      };
      updateTokenCounter("gpt-4o", usage);
    },
  });
  // llm = new ChatOpenAI({
  //   model: "gpt-4o",
  //   apiKey: openaiLibrary.apiKey,
  //   configuration: {
  //     baseURL: openaiLibrary.baseURL,
  //   },
  //   callbackManager: tokensUsageCallback,
  // });
  // Using Groq:
  llm = new ChatOpenAI({
    model: "llama-3.3-70b-versatile",
    apiKey: groqLibrary.apiKey,
    configuration: {
      baseURL: groqLibrary.baseURL,
    },
    callbackManager: tokensUsageCallback,
  });
  return state;
};

const interpreter = async (state: typeof QueryAgentState.State) => {
  // let llm: StructuredOutputType;

  const currentPageUid = getPageUidByBlockUid(state.rootUid);
  const currentDate = dnpUidRegex.test(currentPageUid)
    ? getDateStringFromDnpUid(currentPageUid)
    : getDateStringFromDnpUid(new Date());

  // const tokensUsageCallback = CallbackManager.fromHandlers({
  //   async handleLLMEnd(output: any) {
  //     console.log("Used tokens", output.llmOutput?.tokenUsage);
  //     const usage = {
  //       input_tokens: output.llmOutput?.tokenUsage?.promptTokens,
  //       output_tokens: output.llmOutput?.tokenUsage?.completionTokens,
  //     };
  //     updateTokenCounter("gpt-4o", usage);
  //   },
  // });

  // llm = new ChatOpenAI({
  //   model: "gpt-4o",
  //   apiKey: openaiLibrary.apiKey,
  //   configuration: {
  //     baseURL: openaiLibrary.baseURL,
  //   },
  //   callbackManager: tokensUsageCallback,
  // });
  // Using Groq:
  // llm = new ChatOpenAI({
  //   model: "llama-3.3-70b-versatile",
  //   apiKey: groqLibrary.apiKey,
  //   configuration: {
  //     baseURL: groqLibrary.baseURL,
  //   },
  //   callbackManager: tokensUsageCallback,
  // });
  const structuredLlm = llm.withStructuredOutput(querySchema);
  const sys_msg = new SystemMessage({
    content: interpreterSystemPrompt.replace("<CURRENT_DATE>", currentDate),
  });
  let messages = [sys_msg].concat([new HumanMessage(state.userNLQuery)]);
  const response = await structuredLlm.invoke(messages);
  console.log(response);
  return {
    roamQuery: response.roamQuery,
    period: response.period || null,
  };
};
const periodFormater = async (state: typeof QueryAgentState.State) => {
  const relative = state.period.relative;
  let begin =
    relative && relative.begin
      ? relative.begin
      : getDNPTitleFromDate(new Date(state.period.begin));
  let end =
    relative && relative.end
      ? relative.end
      : getDNPTitleFromDate(new Date(state.period.end));
  let roamQuery = state.roamQuery;
  const formatedQuery = roamQuery
    .replace("<begin>", begin)
    .replace("<end>", end);
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
  return {
    roamQuery: formatedQuery,
  };
};

const formatChecker = async (state: typeof QueryAgentState.State) => {
  const queryCheckerSysPrompt = new SystemMessage({
    content: `You are a very precise and rigorous AI assistant, requested to check if the syntax of a Roam Research query is correct and if it properly follows the logic expressed by the user in natural language, and to provide a correct query as output.
    Here are the points to meticulously check:
    - the query express properly the logical structure of the user request. Check that logical condition expressed and that there are no unnecessary condition components.
    - pay attention to subtleties in the natural language request, such as comma positioning, to correctly identify elements to be articulated with a conjunctive (and) or disjunctive (or) logic, and their correct nesting in the query, otherwise correct it.
    - check if condition components like {and: }, {or: } and {not: } have as conditions only a) [[page titles]], inserted between 2 brackets, or b) other condition components, including also {search: } and {between: }.
    - check if there is one and only one main nesting condition components (only {and: } or {or: } are possible main component) so the general structure is something like {{[[query]]: {and: <conditons or nested components>}}}.
    - check if {between: } component is nested in a {and: } component, as it should always be.
    - check if {seach: } component has only strings as conditions, without brackets neither quotation mark.
    - IMPORTANT: count the opening braces as closing braces and make sure they are strictly equal in number (some AI models often 'forgot' the last closing brace), otherwise remove or add a braces as needed.

    IMPORTANT: your output will be nothing other than the corrected request, without the slightest comment or introductory elements, as it must be able to be directly inserted into Roam and used, respecting the format: {{[[query]]: ...}}
    
    EXAMPLE:
    If the user request was: Blocks where [[A]] or [[B]] were mentionned, and always [[C]], but not [[E]]
    The current transcription: {{[[query]]: {and: {or: [[A]] [[B]]} [[C]] {not: [[E]]}}}}
    This request does not correctly transcribe the conjunctive logic expressed after the comma by "and always [[C]]" since it is transcribed as a disjunction by placing A, B, and C at the same level.
    The correct query should be: {{[[query]]: {and: [[C]] {or: [[A]] [[B]]} {not: [[E]]}}}}
    `,
  });
  let messages = [queryCheckerSysPrompt].concat([
    new HumanMessage(
      `Here is the initial user request: ${state.userNLQuery}
    Here's how it is currently transcribed in Roam query syntax: ${state.roamQuery}`
    ),
  ]);
  const response = await llm.invoke(messages);
  const correctedQuery = balanceBraces(response.content);
  console.log("Query before correction :>>", state.roamQuery);
  console.log("Query after correction :>> ", correctedQuery);
  return {
    roamQuery: correctedQuery,
  };
};

function balanceBraces(str: string): string {
  str = str.trim();
  const openBraces = (str.match(/{/g) || []).length;
  const closeBraces = (str.match(/}/g) || []).length;
  if (openBraces === closeBraces) return str;
  // if (!str.startsWith('{') || !str.endsWith('}')) {
  //   throw new Error('str has to begin and end with braces');
  // }
  const diff = openBraces - closeBraces;
  if (diff > 0) {
    return str + "}".repeat(diff);
  } else if (diff < 0) {
    return str + "{".repeat(Math.abs(diff));
  }
  return str;
}

const insertQuery = async (state: typeof QueryAgentState.State) => {
  createChildBlock(state.rootUid, state.roamQuery, "first");
  return state;
};

/*********/
// EDGES //
/*********/

const hasPeriod = (state: typeof QueryAgentState.State) => {
  if (state.period) return "periodFormater";
  return "checker";
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
  .addNode("periodFormater", periodFormater)
  .addNode("checker", formatChecker)
  .addNode("insertQuery", insertQuery)

  .addEdge(START, "loadModel")
  .addEdge("loadModel", "interpreter")
  .addConditionalEdges("interpreter", hasPeriod)
  .addEdge("periodFormater", "checker")
  .addEdge("checker", "insertQuery");

// Compile graph
export const NLQueryInterpreter = builder.compile();
