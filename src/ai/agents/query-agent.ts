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
import { tool } from "@langchain/core/tools";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { arrayOutputType, z } from "zod";
import { OPENAI_API_KEY, groqLibrary, openaiLibrary } from "../..";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import {
  getDateStringFromDnpUid,
  getPageUidByBlockUid,
} from "../../utils/roamAPI";
import { sanitizeJSONstring } from "../../utils/format";
import { CallbackManager } from "@langchain/core/callbacks/manager";
import { updateTokenCounter } from "../modelsInfo";
import { dnpUidRegex } from "../../utils/regex";

const QueryAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  userNLQuery: Annotation<string>,
  rootUid: Annotation<string>,
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
  filters: z
    .array(
      z.object({
        titles: z
          .array(z.string().describe("Page title"))
          .describe(
            "Page titles array (disjonctive logic), void array [] if only strings"
          ),
        strings: z
          .array(z.string().optional().nullable().describe("Search string"))
          .describe("Strings array (disjonctive logic)"),
        isToInclude: z.boolean().describe("true if include, false if exclude"),
      })
    )
    .describe("Array of items defining the query (conjonctive logic)"),
  roamQuery: z
    .string()
    .describe(
      "How the query would be written in Roam Research, using a combination (eventually nested) of: {and: }, {or: }, {not: }, {search: string}, and {between: }. IMPORTANT: if {between: ...} is used, do not provide real date but only the following placeholders: [[<begin>]] [[<end>]]."
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
  // values are \
});

const interpreterSystemPrompt = `You are a powerful agent that breaks down a natural language query into a set of filters that define a precise query to be sent to a database.
  
    INPUT: the user request to be interpreted as a database query.
    To transcribe a conjunctive logic, you'll need to create multiple filters, with each filter being conjoint with the others. Disjunctive logic will be translated through page titles arrays in the relevant filters. For example, [[A]] and ([[B]] or [[C]]) will be transcribed into 2 filters, one to include ["A"], the other ["B","C"].
    In their request, the user identifies page titles by inserting them between double square brackets, for example [[page title]]. The title should be saved without the outer brackets, in this example: "page title". Be careful, page titles can be nested, for example [[page title [[nested]]]]. In this case, the most encompassing page title should be retained for the filter, in our example this would be "page title [[nested]]" (keeping the double brackets that are inside the title, only those on the outside are removed). Relevant key terms formulated without double square brackets will be used as simple strings in the query (unless user mention tasks to do or done, to interpret as [[TODO]] and [[DONE]] or explictly indicate that certain terms should be interpreted as page titles)
    You must interpret the structure of the query that will be necessary to answer the user's request, even if the question is not directly formulated as a logical query (since the user asks for a result but is not necessarily aware of the logical constraints of a query). Be aware that the database query will first provide all the relevant data to prepare a response to the user's request, and these data will be evaluated, at a subsequent stage, to precisely answer their request. Set aside everything that is not meaningful for the query to be prepared.

    OUTPUT: a JSON following the provided schema, defining an array of filters.
    A filter is defined by three elements:
    - titles: an array of page titles to be filtered, case sensitive. The logic will be: 'titles[0]' OR 'title[1]' OR ... (maximum 2 titles if they are to exclude)
    - strings: an array of strings to be searched if there is important content not mentionned by the user as a page title but only some content/
    - isToInclude: true if the filter will be used to get all items including the page title, false if it's used to filter out, excluding items mentionning the page title.
    Additionally, you will formulate a query compatible with the formatting supported in Roam Research, and if mentioned in the user's request, you will interpret the start and end periods concerned, knowing that today's date is <CURRENT_DATE>. In 'period' key, complete the 'relative' key object only if the dates or indications provided by the user can be exactly interpreted as one of the following available relative period: 'last month|last week|yesterday|today|tomorrow|next week|next month'. In the Roam Research query, if a between period is defined, the will be completed later, just write [[<begin>]] and [[<end>]].
    If a key is optional and your response would be 'null', just IGNORE this key!

    EXAMPLES:
    1. "I want to find all the [[meeting]] where [[John]] or [[Tony]] were present."
    Your response should be:
    {filters: [{title: ["meeting"], isToInclude: true}, {titles: ["John","Tony"], isToInclude: true}], roamQuery: "{{[[query]]: {and: [[meeting]] {or: [[John]] [[Tony]]}}}}"}

    2. "Which [[meeting]] with [[John]], about frontend or UX, is not yet marked as [[DONE]] ?"
    Your response should be:
    {filters: [{title: ["meeting"], isToInclude: true}, {title: ["John"], isToInclude:true}, {title: [],strings: ["frontend","UX"]} {title: ["DONE"], isToInclude: false}], roamQuery: "{{[[query]]: {and: [[meeting]] [[John]] {or: {search: frontend} {search: UX} {not: [[DONE]]}}}}"}

    3. "Every tasks to do today"
    Your response should be:
    {filters: [{title: ["TODO"], isToInclude: true}], roamQuery: "{{[[query]]: {and: [[TODO]] {between: [[<begin>]] [[<end>]]}}}}", period: {begin: "2024/12/13", end: "2024/12/13", relative: {begin: "today",end: "today"}}
    `;

const interpreter = async (state: typeof QueryAgentState.State) => {
  let llm: StructuredOutputType;

  const currentPageUid = getPageUidByBlockUid(state.rootUid);
  const currentDate = dnpUidRegex.test(currentPageUid)
    ? getDateStringFromDnpUid(currentPageUid)
    : getDateStringFromDnpUid(new Date());
  console.log("currentDate :>> ", currentDate);

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

  llm = new ChatOpenAI({
    model: "gpt-4o",
    apiKey: openaiLibrary.apiKey,
    configuration: {
      baseURL: openaiLibrary.baseURL,
    },
    callbackManager: tokensUsageCallback,
  });
  llm = llm.withStructuredOutput(querySchema);
  const sys_msg = new SystemMessage({
    content: interpreterSystemPrompt.replace("<CURRENT_DATE>", currentDate),
  });
  let messages = [sys_msg].concat([new HumanMessage(state.userNLQuery)]);
  const response = await llm.invoke(messages);
  console.log(response);
  return state;
};
const queryTools = async (state: typeof QueryAgentState.State) => {
  return state;
};
const responsesSelector = async (state: typeof QueryAgentState.State) => {
  return state;
};
const selectionSynthesis = async (state: typeof QueryAgentState.State) => {
  return state;
};

// Build graph
const builder = new StateGraph(QueryAgentState);
builder
  .addNode("interpreter", interpreter)
  .addNode("queryTools", queryTools)
  .addNode("selector", responsesSelector)
  .addNode("synthetiser", selectionSynthesis)

  .addEdge(START, "interpreter")
  .addEdge("interpreter", "queryTools")
  .addEdge("queryTools", "selector")
  .addEdge("selector", "synthetiser");
//  .addConditionalEdges("agent", continueOperations);
//   // If the latest message (result) from assistant is a tool call -> tools_condition routes to tools
//   // If the latest message (result) from assistant is a not a tool call -> tools_condition routes to END
//   toolsCondition
// )

// Compile graph

export const queryAgent = builder.compile();
