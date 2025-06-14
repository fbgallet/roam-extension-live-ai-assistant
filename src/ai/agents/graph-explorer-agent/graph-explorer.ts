import {
  MessagesAnnotation,
  StateGraph,
  START,
  Annotation,
} from "@langchain/langgraph/web";
import { SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { defaultModel } from "../../..";
import {
  LlmInfos,
  modelViaLanggraph,
  TokensUsage,
} from "../langraphModelsLoader";
import { modelAccordingToProvider } from "../../aiAPIsHub";
import {
  displaySpinner,
  insertInstantButtons,
  removeSpinner,
} from "../../../utils/domElts";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import {
  createChildBlock,
  getAllPagesTitle,
  isExistingBlock,
  searchPagesByRegex,
  updateBlock,
} from "../../../utils/roamAPI";
import { roamBasicsFormat } from "../../prompts";

const GraphExplorerAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  model: Annotation<LlmInfos>,
  rootUid: Annotation<string>,
  targetUid: Annotation<string>,
  userPrompt: Annotation<string>,
  llmResponse: Annotation<any>,
});

// Tools
const getAllPagesTitleTool = tool(
  (input) => {
    return getAllPagesTitle(input.excludeDNP);
  },
  {
    name: "get_all_pages_title",
    description:
      "Get all pages titles existing in the current Roam graph database if no relevant Regex can help to filter the request",
    schema: z.object({
      excludeDNP: z
        .boolean()
        .default(true)
        .describe(
          "Exclude daily notes pages (DNP), whose title is a date, when user request doesn't concern dates"
        ),
    }),
  }
);

const searchPagesByTitleTool = tool(
  (input) => {
    return searchPagesByRegex(input.regex, input.excludeDNP);
  },
  {
    name: "query_pages_in_db_matching_regex",
    description:
      "Get a list of page titles by querying the Roam graph database: get only page titles matching conditions expressed in a Regex, only if it can interpret precisely the natural language user request.",
    schema: z.object({
      regex: z
        .string()
        .describe(
          "Regex string formatted so that it's compatible with Datalog Datomic query format in Clojure re-pattern argument. E.g. symbols like '\\b' or '\\d' are not compatible."
        ),
      excludeDNP: z
        .boolean()
        .default(true)
        .describe(
          "Exclude daily notes pages (DNP), whose title is a date, when user request doesn't concern dates"
        ),
    }),
  }
);

const multiply = tool(
  (input) => {
    return input.a * input.b;
  },
  {
    name: "multiply_tool",
    description: "Multiply two numbers a and b",
    schema: z.object({
      a: z.number().describe("number a"),
      b: z.number().describe("number b"),
    }),
  }
);

const divide = tool(
  (input) => {
    return input.a / input.b;
  },
  {
    name: "divide_tool",
    description: "Divide two numbers a and b",
    schema: z.object({
      a: z.number().describe("number a"),
      b: z.number().describe("number b"),
    }),
  }
);

const tools = [getAllPagesTitleTool, searchPagesByTitleTool];

// LLM with bound tool
let llm: StructuredOutputType;
// let llm_with_tools: StructuredOutputType;
let turnTokensUsage: TokensUsage;
let sys_msg: SystemMessage;

// System message
let system_prompt: string = `You are a helpful assistant for users in Roam Research app, using if needed a set of tools to explore and retrieve relevant data in the Roam graph (a graph made of connectes pages and blocks).

Intructions to format some possible parts of your response:
${roamBasicsFormat}

IMPORTANT:
If you have to write some specific Roam elements and they are not already properly formatted, writte always:
- page name or page title in double bracket: [[page name]]
- block reference or block-uid in double parentheses: ((block-uid))
    
Here is the user request to process with, eventually using the available tools:
<USER_PROMPT>`;

// Node
const loadModel = async (state: typeof GraphExplorerAgentState.State) => {
  llm = modelViaLanggraph(state.model, turnTokensUsage);
  sys_msg = new SystemMessage({
    content: system_prompt.replace("<USER_PROMPT>", state.userPrompt),
  });
};

const assistant = async (state: typeof GraphExplorerAgentState.State) => {
  const llm_with_tools = llm.bindTools(tools);
  const response = await llm_with_tools.invoke(
    [sys_msg].concat(state["messages"])
  );
  return {
    messages: [response],
  };
};

const insertResponse = async (state: typeof GraphExplorerAgentState.State) => {
  const lastMessage: string = state.messages.at(-1).content.toString();
  if (state.targetUid && isExistingBlock(state.targetUid)) {
    await updateBlock({
      blockUid: state.targetUid,
      newContent: lastMessage,
    });
  } else {
    state.targetUid = await createChildBlock(
      state.rootUid,
      lastMessage,
      "last"
    );
  }
  return {
    targetUid: state.targetUid,
  };
};

// Edge
const shouldContinue = (state: typeof GraphExplorerAgentState.State) => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];
  if (
    "tool_calls" in lastMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls?.length
  ) {
    return "tools";
  }
  return "insertResponse";
};

// Build graph
const builder = new StateGraph(GraphExplorerAgentState);
builder
  .addNode("loadModel", loadModel)
  .addNode("assistant", assistant)
  .addNode("tools", new ToolNode(tools))
  .addNode("insertResponse", insertResponse)

  .addEdge(START, "loadModel")
  .addEdge("loadModel", "assistant")
  .addConditionalEdges("assistant", shouldContinue)
  .addEdge("tools", "assistant")
  .addEdge("insertResponse", "__end__");

// Compile graph
export const graphExplorer = builder.compile();

interface AgentInvoker {
  model: string;
  rootUid: string;
  targetUid?: string;
  target?: string;
  prompt: string;
  previousResponse?: string;
}

// Invoke graph
export const invokeGraphExplorer = async ({
  model = defaultModel,
  rootUid,
  targetUid,
  target,
  prompt,
  previousResponse,
}: AgentInvoker) => {
  console.log("prompt :>> ", prompt);
  let llmInfos: LlmInfos = modelAccordingToProvider(model);
  const spinnerId = displaySpinner(rootUid);
  const response = await graphExplorer.invoke({
    model: llmInfos,
    rootUid,
    userPrompt: prompt,
    targetUid: target && target.includes("new") ? undefined : targetUid,
  });
  removeSpinner(spinnerId);
  // if (response) {
  //   setTimeout(() => {
  //     insertInstantButtons({
  //       model: response.model.id,
  //       prompt: response.userNLQuery,
  //       currentUid: rootUid,
  //       targetUid: response.targetUid,
  //       responseFormat: "text",
  //       response: response.roamQuery,
  //       aiCallback: graphExplorer,
  //     });
  //   }, 100);
  // }
  console.log("Agent response:>>", response);
};
