import { invokeNLDatomicQueryInterpreter } from "./agents/nl-datomic-query";
import { invokeNLQueryInterpreter } from "./agents/nl-query";
import {
  invokeAskAgent,
  invokeSearchAgent,
} from "./agents/search-agent/invoke-search-agent";
import { languages } from "./languagesSupport";

export const CATEGORY_ICON = {
  "OUTLINER AGENT": "properties",
  "QUERY AGENTS": "filter",
  "CONTENT ANALYSIS": "path-search", // "intelligence", //
  ACTION: "tick-circle",
  CREATION: "new-drawing",
  REPHRASING: "automatic-updates",
  TRANSLATION: "translate",
  "CRITICAL REASONING TOOLKIT": "predictive-analysis",
  "CUSTOM PROMPTS": "user",
};

export const BUILTIN_COMMANDS = [
  { id: 0, name: "Use this custom prompt", category: "", onlyGen: true },
  {
    id: 1,
    name: "Selected blocks as prompt",
    category: "",
    includeUids: true,
  },
  {
    id: 10,
    name: "Continue the conversation",
    isIncompatibleWith: {
      outliner: true,
    },
    category: "",
  },
  {
    id: 100,
    name: "Selected blocks as prompt",
    category: "",
    includeUids: true,
  },
  // OUTLINER AGENT COMMANDS
  {
    id: 2,
    name: "Apply custom prompt to Live Outline",
    category: "OUTLINER AGENT",
    isIncompatibleWith: {
      completion: true,
    },
  },
  {
    id: 21,
    name: "Apply selected blocks as prompt",
    prompt: "",
    category: "OUTLINER AGENT",
    isIncompatibleWith: {
      completion: true,
    },
  },
  {
    id: 20,
    name: "Set as active Live Outline",
    prompt: "",
    category: "OUTLINER AGENT",
    isIncompatibleWith: {
      completion: true,
    },
  },
  // {
  //   id: 22,
  //   name: "Set as active outline",
  //   prompt: "",
  //   category: "OUTLINER AGENT",
  //   onlyOutliner: true,
  // },
  // AGENTS,
  {
    id: 22,
    name: "Create new Live Outline",
    prompt: "",
    category: "OUTLINER AGENT",
    isIncompatibleWith: {
      completion: true,
    },
  },
  {
    id: 80,
    name: "Natural language query",
    callback: invokeNLQueryInterpreter,
    target: "new",
    category: "QUERY AGENTS",
    isIncompatibleWith: {
      outliner: true,
      style: true,
    },
  },
  {
    id: 81,
    name: "Natural language :q Datomic query",
    callback: invokeNLDatomicQueryInterpreter,
    target: "new",
    category: "QUERY AGENTS",
    isIncompatibleWith: {
      outliner: true,
      style: true,
    },
  },
  {
    id: 82,
    name: "Smart Search Agent",
    callback: invokeSearchAgent,
    category: "QUERY AGENTS",
    target: "new",
    keyWords: "Natural language Agent",
    isIncompatibleWith: {
      outliner: true,
      style: true,
    },
  },
  {
    id: 83,
    name: "Ask to your graph...",
    callback: invokeAskAgent,
    category: "QUERY AGENTS",
    isIncompatibleWith: {
      outliner: true,
    },
    target: "new",
    keyWords: "Natural language Agent, post-processing",
  },

  // CONTENT ANALYSIS
  {
    id: 130,
    name: "Summarize",
    prompt: "summarize",
    category: "CONTENT ANALYSIS",
    target: "new w/o",
  },
  {
    id: 131,
    name: "Extract key insights",
    prompt: "keyInsights",
    category: "CONTENT ANALYSIS",
    includeUids: true,
    target: "new",
    submenu: [1310, 1311],
  },
  {
    id: 1310,
    name: "Extract actionable items",
    prompt: "keyInsights",
    category: "CONTENT ANALYSIS",
    isIncompatibleWith: {
      specificStyles: ["Quiz"],
    },
    includeUids: true,
    isSub: true,
  },
  {
    id: 1311,
    name: "Extract highlighted text",
    prompt: "extractHighlights",
    category: "CONTENT ANALYSIS",
    target: "new w/o",
    includeUids: true,
    isSub: true,
  },
  {
    id: 132,
    name: "Extract reasoning structure",
    prompt: "reasoningAnalysis",
    category: "CONTENT ANALYSIS",
    target: "new",
    submenu: [1320, 1321],
  },
  {
    id: 1320,
    name: "Sentiment Analysis",
    prompt: "sentimentAnalysis",
    category: "CONTENT ANALYSIS",
    target: "new",
    isSub: true,
  },
  {
    id: 1321,
    name: "Value Analysis",
    prompt: "valueAnalysis",
    category: "CONTENT ANALYSIS",
    target: "new",
    isSub: true,
  },
  {
    id: 133,
    name: "Extract text from image",
    prompt: "imageOCR",
    category: "CONTENT ANALYSIS",
    keyWords: "OCR",
    target: "new",
    submenu: [1330],
  },
  {
    id: 1330,
    name: "Image Analysis",
    prompt: "imageAnalysis",
    category: "CONTENT ANALYSIS",
    isIncompatibleWith: {
      outliner: true,
    },
    keyWords: "visual art, painting",
    isSub: true,
  },

  // CONTENT CREATION
  {
    id: 140,
    name: "Complete sentence",
    prompt: "sentenceCompletion",
    category: "CREATION",
    target: "append",
    isIncompatibleWith: {
      specificStyles: ["Atomic", "Quiz"],
    },
    submenu: [1400],
  },
  {
    id: 1400,
    name: "Complete paragraph",
    prompt: "paragraphCompletion",
    category: "CREATION",
    target: "append",
    isIncompatibleWith: {
      specificStyles: ["Atomic", "Quiz"],
    },
    isSub: true,
  },
  {
    id: 142,
    name: "Short message for social network",
    prompt: "socialNetworkPost",
    category: "CREATION",
    keyWords: "post, X, Twitter, BlueSky, Threads, Mastodon",
    target: "new",
    submenu: [1420],
  },
  {
    id: 1420,
    name: "Thread for social network",
    prompt: "socialNetworkThread",
    category: "CREATION",
    keyWords: "post, X, Twitter, BlueSky, Threads, Mastodon",
    target: "new",
    isSub: true,
  },
  {
    id: 143,
    name: "Quiz on provided content",
    prompt: "quiz",
    category: "CREATION",
    keyWords: "active learning, question, test",
    isIncompatibleWith: {
      outliner: true,
      style: true,
    },
    target: "new",
  },
  {
    id: 144,
    name: "Another similar content",
    prompt: "similarContent",
    category: "CREATION",
    keyWords: "extend, variant, clone",
    isIncompatibleWith: {
      style: true,
    },
    target: "new w/o",
  },

  // REPHRASING
  {
    id: 120,
    name: "Fix spelling & grammar",
    prompt: "correctWording",
    category: "REPHRASING",
    target: "new w/o",
    isIncompatibleWith: {
      style: true,
    },
    submenu: [1200, 1201, 1202],
  },
  {
    id: 1200,
    name: "Fix spelling & grammar + explain",
    prompt: "correctWordingAndExplain",
    category: "REPHRASING",
    target: "new w/o",
    isSub: true,
  },
  {
    id: 1201,
    name: "Fix spelling & grammar / suggestions",
    prompt: "correctWordingAndSuggestions",
    category: "REPHRASING",
    withSuggestions: true,
    target: "replace",
    includeUids: true,
    isIncompatibleWith: {
      style: true,
    },
    isSub: true,
  },
  {
    id: 1202,
    name: "Accept corrections/suggestions",
    prompt: "acceptSuggestions",
    category: "REPHRASING",
    withSuggestions: true,
    target: "replace",
    includeUids: true,
    isIncompatibleWith: {
      style: true,
    },
    isSub: true,
  },
  {
    id: 121,
    name: "Rephrase",
    prompt: "rephrase",
    category: "REPHRASING",
    target: "new w/o",
    submenu: [1210, 1211, 1212, 1213, 1214, 1215, 1216, 1217],
  },
  {
    id: 1210,
    name: "Shorter",
    prompt: "shorten",
    category: "REPHRASING",
    target: "new w/o",
    isSub: true,
  },
  {
    id: 1211,
    name: "More accessible",
    prompt: "accessible",
    category: "REPHRASING",
    target: "new w/o",
    isSub: true,
  },
  {
    id: 1212,
    name: "Clearer and more explicit",
    prompt: "clearer",
    category: "REPHRASING",
    target: "new w/o",
    isSub: true,
  },
  {
    id: 1213,
    name: "More formal",
    prompt: "formal",
    category: "REPHRASING",
    target: "new w/o",
    isSub: true,
  },
  {
    id: 1214,
    name: "More casual",
    prompt: "casual",
    category: "REPHRASING",
    target: "new w/o",
    isSub: true,
  },
  {
    id: 1215,
    name: "More engaging",
    prompt: "enhance",
    category: "REPHRASING",
    keyWords: "enhance, synonym",
    target: "new w/o",
    isSub: true,
  },
  {
    id: 1216,
    name: "More engaging with suggestions",
    prompt: "enhanceWithSuggestions",
    category: "REPHRASING",
    keyWords: "enhance, synonym",
    withSuggestions: true,
    target: "replace",
    includeUids: true,
    isSub: true,
  },
  {
    id: 1217,
    name: "Vocabulary suggestions",
    prompt: "vocabularySuggestions",
    category: "REPHRASING",
    keyWords: "enhance, synonym",
    withSuggestions: true,
    target: "replace",
    includeUids: true,
    isIncompatibleWith: {
      style: true,
    },
    isSub: true,
  },
  {
    id: 122,
    name: "Outline to Paragraph",
    prompt: "linearParagraph",
    category: "REPHRASING",
    isIncompatibleWith: {
      specificStyles: ["Atomic"],
    },
    target: "new w/o",
    submenu: [1220],
  },
  {
    id: 1220,
    name: "Paragraph to Outline",
    prompt: "outline",
    category: "REPHRASING",
    isIncompatibleWith: {
      specificStyles: ["No bullet points"],
    },
    target: "new w/o",
    isSub: true,
  },

  // TRANSLATION
  {
    id: 11,
    name: "Translate to... (<default>)",
    prompt: "translate",
    category: "TRANSLATION",
    target: "new w/o",
    isIncompatibleWith: {
      style: true,
    },
    submenu: [
      1100, 1101, 1102, 1103, 1104, 1105, 1106, 1107, 1108, 1109, 1110, 1111,
      1112, 1113, 1114, 1115, 1116, 1199,
    ],
  },
  {
    id: 1199,
    name: "User defined",
    prompt: "translate",
    category: "TRANSLATATION",
    target: "new w/o",
    isSub: true,
  },

  // ACTION
  {
    id: 145,
    name: "Action plan for a project",
    prompt: "actionPlan",
    category: "ACTION",
    keyWords: "task",
    target: "new",
    submenu: [1450, 1451, 1452],
  },
  {
    id: 1450,
    name: "How to... (active learning)",
    prompt: "howTo",
    category: "ACTION",
    keyWords: "help, self discovery, problem-solving, step",
    target: "new",
    isSub: true,
  },
  {
    id: 1451,
    name: "Roadmap to achieve a goal",
    prompt: "guidanceToGoal",
    category: "ACTION",
    keyWords: "coach",
    target: "new",
    isSub: true,
  },
  {
    id: 1452,
    name: "Practical tip",
    prompt: "practicalTip",
    category: "ACTION",
    keyWords: "advice, value, principle",
    target: "new w/o",
    isSub: true,
  },
  {
    id: 146,
    name: "Help to make a choice",
    prompt: "choice",
    category: "ACTION",
    keyword: "choose, decision",
    target: "new",
  },

  // CRITICAL REASONING TOOLKIT
  {
    id: 151,
    name: "Argument",
    prompt: "argument",
    category: "CRITICAL REASONING TOOLKIT",
    submenu: [1511, 1512, 1513, 1514],
  },
  {
    id: 1511,
    name: "Consolidate or base on evidence",
    prompt: "consolidate",
    category: "CRITICAL REASONING TOOLKIT",
    keyWords: "argument",
    isSub: true,
  },
  {
    id: 1512,
    name: "Objection, counterargument",
    prompt: "objection",
    category: "CRITICAL REASONING TOOLKIT",
    isSub: true,
  },
  {
    id: 1513,
    name: "Counterexample",
    prompt: "counterExample",
    category: "CRITICAL REASONING TOOLKIT",
    isSub: true,
  },
  {
    id: 1514,
    name: "Logical fallacy challenge",
    prompt: "fallacy",
    category: "CRITICAL REASONING TOOLKIT",
    isIncompatibleWith: {
      outliner: true,
    },
    keyWords: "cognitive biases",
    isSub: true,
  },
  {
    id: 154,
    name: "Explanation",
    prompt: "explanation",
    category: "CRITICAL REASONING TOOLKIT",
    submenu: [1540, 1541, 1542, 1543],
  },
  {
    id: 1540,
    name: "Definition, meaning",
    prompt: "meaning",
    category: "CRITICAL REASONING TOOLKIT",
    keyWords: "explanation",
    target: "new w/o",
    isSub: true,
  },
  {
    id: 1541,
    name: "Example",
    prompt: "example",
    category: "CRITICAL REASONING TOOLKIT",
    isSub: true,
  },
  {
    id: 1542,
    name: "Causal explanation",
    prompt: "causalExplanation",
    category: "CRITICAL REASONING TOOLKIT",
    isSub: true,
  },
  {
    id: 1543,
    name: "Explanation by analogy",
    prompt: "analogicalExplanation",
    category: "CRITICAL REASONING TOOLKIT",
    isSub: true,
  },
  {
    id: 156,
    name: "Challenge my ideas!",
    prompt: "challengeMyIdeas",
    category: "CRITICAL REASONING TOOLKIT",
    submenu: [1561, 1562, 1563],
    includeUids: true,
  },
  {
    id: 1561,
    name: "Raise questions",
    prompt: "raiseQuestions",
    category: "CRITICAL REASONING TOOLKIT",
    includeUids: true,
    isSub: true,
  },
  {
    id: 1562,
    name: "Perspective shift",
    prompt: "perspectiveShift",
    category: "CRITICAL REASONING TOOLKIT",
    keyWords: "change, view, frame, reframing",
    isSub: true,
  },
  {
    id: 1563,
    name: "Brainstorming",
    prompt: "brainstorming",
    category: "CRITICAL REASONING TOOLKIT",
    isSub: true,
  },
].concat(
  languages.map((lgg, index) => {
    return {
      id: 1100 + index,
      name: lgg[0],
      label: lgg[1],
      prompt: "translate",
      category: "TRANSLATION",
      target: "new w/o",
      isIncompatibleWith: {
        style: true,
      },
      isSub: true,
    };
  })
);
