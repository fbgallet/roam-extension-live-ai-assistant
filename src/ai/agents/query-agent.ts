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
  createChildBlock,
  deleteBlock,
  extractNormalizedUidFromRef,
  getBlockContentByUid,
  moveBlock,
  reorderBlocks,
  updateBlock,
  updateTokenCounter,
} from "../../utils/utils";
import {
  insertStructuredAIResponse,
  sanitizeJSONstring,
} from "../../utils/format";
import { getTemplateForPostProcessing } from "../aiCommands";
import { CallbackManager } from "@langchain/core/callbacks/manager";

const QueryAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  userNLQuery: Annotation<String>,
  rootUid: Annotation<String>,
});

const querySchema = z.object({
  filters: z
    .array(
      z.object({
        title: z.string().describe("Page title"),
        alternativeTitle: z
          .string()
          .optional()
          .nullable()
          .describe("Alternative page title (disjonction"),
        isToInclude: z.boolean().describe("true if include, false if exclude"),
      })
    )
    .describe("Array of items defining the query (conjonction)"),
  roamQuery: z
    .string()
    .describe("How the query would be written in Roam Research"),
});

const sys_msg = new SystemMessage({
  content: `You are a powerful agent that breaks down a natural language query into a set of filters that define a precise query to be sent to a database. All filters to be identified will be combined according to conjunction (AND) logic.
    A filter is defined by three elements:
    - title: the page title to be filtered. It is case sensitive.
    - alternativeTitle: if the user's query expresses disjunctions (OR), the alternative page title that will serve as a filter in addition to title. The logic will be: 'title' OR 'alternativeTitle'. Only one alternative title per filter is possible.
    - isToInclude: true if the filter should include the page title, false if it should "exclude" it.
    In their request, the user identifies page titles by inserting them between double square brackets, for example [[page title]]. The title should be saved without the outer brackets, in this example: "page title". Be careful, page titles can be nested, for example [[page title [[nested]]]]. In this case, the most encompassing page title should be retained for the filter, in our example this would be "page title [[nested]]" (keeping the double brackets that are inside the title, only those on the outside are removed).
    You must interpret the structure of the query that will be necessary to answer the user's request, even if the question is not directly formulated as a query (since the user asks for a result but is not necessarily aware of the logical constraints of a query), and set aside everything that is not meaningful for the request to be prepared. Here are some examples:
    
    1. "I want to find all the [[meeting]] where [[John]] or [[Tony]] were present."
    Your response should be:
    {filters:[{title: "meeting", isToInclude: true}, {title:"John", alternativeTitle:"Tony", isToInclude:true}], roamQuery: "{{query: {and: [[meeting]] {or: [[John]] [[Tony]]}}}}"}

    2. "Which [[meeting]] avec [[John]] is not yet marked as [[DONE]] ?"
    Your response should be:
    {filters:[{title: "meeting", isToInclude: true}, {title:"John", isToInclude:true}, {title:"DONE", isToInclude:false}], roamQuery: "{{query: {and: [[meeting]] [[John]] {not: [[DONE]]}}}}"}

    Your precise response will be an JSON object, formatted according to the provided JSON schema. If a key is optional and your response would be 'null', just IGNORE this key!
    `,
});

const interpreter = async (state: typeof QueryAgentState.State) => {
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
