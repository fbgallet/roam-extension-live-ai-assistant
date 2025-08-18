/**
 * System prompts for the Ask Your Graph ReAct Search Agent
 * Separated from main agent file for better maintainability
 */

import { listAvailableToolNames } from "./tools/toolsRegistry";

const ROAM_SEARCH_QUICK_DESCRIPTION = `typically this consist of finding blocks and/or pages that meet certain conditions, or requesting specific processing (analysis, summary, reflection, retrieval...) that requires first extracting a set of blocks and/or pages. In Roam, pages have a UID, a title and contain a hierarchical set of blocks. Each block is defined by its UID, its context (children and parents blocks) and a string content where it can reference/mention pages via '[[page references]]', '#tags' or 'attributes::', or reference other blocks via '((block references))'`;

const ROAM_REFERENCES_PARSING = `### Roam Element Parsing (CRITICAL: Only apply ref: prefix when EXPLICITLY formatted as references)
- '[[page title]]': 'ref:page title' (references TO) or 'in:page title' (content WITHIN)
- '#tag' or '#[[long tag]]': 'ref:tag' (references TO)
- 'attribute::': 'ref:attribute' (reference TO)
- '((uid))': 'bref:uid' (direct block reference)

**ATTRIBUTE BLOCKS**: For attribute-value searches (e.g., "author set to Victor Hugo", "books with status completed"):
- Convert to regex patterns: 'regex:/^attribute::.*value.*/i'
- Examples: "author:: Victor Hugo" → 'regex:/^author::.*victor hugo.*/i'
- This matches blocks starting with the attribute key followed by any content containing the value

**IMPORTANT**: Do NOT add 'ref:' prefix to plain text terms like "Machine Learning" - only when they appear as [[Machine Learning]] or #tag format. Plain text should remain as content search terms.`;

// Shared symbolic query language definition
export const SYMBOLIC_QUERY_LANGUAGE = `## SYMBOLIC QUERY LANGUAGE

We have defined a formal language to express search queries in a precise and unambiguous way, using symbolic operators to combine search conditions. All conditions must use explicit type prefixes for clarity. By default the search targets blocks that meet conditions, but if the search targets pages it must be wrapped in the 'page:(...query...)' operator.

### Condition Types (ALWAYS use explicit prefixes):
- 'text:term' - text content search (ALWAYS use text: prefix)
- 'ref:title' - page reference (parsed from [[title]], #title, title::)
- 'regex:/pattern/[i]' - regex pattern matching
- 'bref:uid' - block reference by UID

### Logic Operators:
- '+' AND (conjunction)
- '|' OR (disjunction) 
- '-' NOT (exclusion, applies only to individual conditions)

### Grouping Syntax (both forms valid):
- **Explicit**: 'text:term1 + text:term2 + ref:page1' (for mixed types)
- **Grouped**: 'text:(term1 + term2) + ref:page1' (for same-type conditions)

### Operator Precedence:
1. **Parentheses**: () - highest precedence
2. **Hierarchical**: <=> > => >> << < - between two conditions only
3. **AND**: + - conjunction
4. **OR**: | - disjunction  
5. **NOT**: - - lowest precedence, individual conditions only

### Search Expansion Operators:
Following operators are used as suffix to text condition, keep them as they are and do not confuse with markdown syntax:
- '*' fuzzy search/wildcard (e.g., 'text:term*')
- '~' semantic expansion (e.g., 'text:term~')

### Reference Examples:
- 'ref:project | ref:status | ref:meeting' - multiple page reference OR
- 'ref:project + ref:status' - multiple page reference AND  
- 'text:productivity | text:tools | text:methods' - multiple text content OR
- 'text:productivity + text:tools' - multiple text content AND
- 'text:(productivity + tools) | ref:(project + status)' - grouped syntax

### Attribute Search Strategy:
For attribute searches in blocks, convert to regex patterns:
- "author set to Victor Hugo" → 'regex:/^author::.*victor hugo.*/i' 
- "status completed or done" → 'regex:/^status::.*(completed|done).*/i'
The pattern '^attribute::.*value.*' matches blocks starting with 'attribute::' followed by any text containing the value (case insensitive).
For attribute in page searches, see below, operators are defined precisely.

### Page Operators (when searching for pages):

**CRITICAL CONSTRAINTS:**
1. **Only ONE page:() operator per query** - tools cannot handle multiple page searches simultaneously
2. **Always specify search target**: page:(title:...), page:(content:...), or page:(attr:...)
3. **Never use bare page:pattern** - must specify title/content/attr

**Page Search Strategy Priority (use in this order):**
1. **'page:(title:pattern)'** - PRIMARY: page titles matching pattern (text or regex)
   Use when: "pages about X", "X pages", "find pages with X in title"
2. **'page:(content:pattern)'** - SECONDARY: page content matching pattern (text/regex/references)
   Use when: "pages containing X", "pages that mention X", "pages with X content"  
3. **'page:(attr:key:type:value)'** - SPECIFIC: attribute-value metadata searches (essentially content search)
   Use when: "pages of type X", "pages with X property", "pages where attribute Y is Z"
   - 'page:(attr:key:type:(A + B - C))' complex attribute queries with logical operators

**Examples:**
- "Pages about status" → 'page:(title:text:status)' (search titles)
- "Pages containing status" → 'page:(content:text:status)' (search content)  
- "Pages of type book" → 'page:(attr:type:text:book)' (attribute search in content)

**INVALID Examples:**
- 'page:(title:A) + page:(content:B)' ❌ (multiple page operators)
- 'page:status' ❌ (missing title/content/attr specification)

### Scope Operators:
- 'in:scope' search WITHIN specific page scope (e.g., in:work, in:dnp, in:attr:title:value)

### Hierarchical Operators:

**STRICT RULES:**
1. **Only ONE hierarchical operator per query** (never combine: text:A <=> text:B > text:C ❌)
2. **Always between TWO conditions** (never dangling: <=> text:A ❌, text:A <=> ❌)  
3. **Higher precedence than +/|** (evaluated before logical operators)

**Operators** (A and B are any condition: text:, ref:, regex:, etc.):
- 'text:A > ref:B' - direct child (A has direct child B)
- 'text:A >> ref:B' - deep descendants (A has B somewhere in descendants)
- 'text:A < ref:B' - direct parent (A has direct parent B)
- 'text:A << ref:B' - deep ancestors (A has B somewhere in ancestors)
- 'text:A => ref:B' - flexible hierarchy (A with B in descendants OR same block)
- 'text:A <=> ref:B' - bidirectional direct (A > B OR B > A)
- 'text:A <<=>> ref:B' - bidirectional deep hierarchy

**Examples:**
- 'text:project <=> ref:status' ✅ (one operator, between conditions)
- 'text:A <=> text:B > text:C' ❌ (multiple operators)
- '<=> text:project' ❌ (dangling operator)

### Advanced Operators:
- '(...)' use parentheses to group similar conditions and reduce ambiguity (e.g., ref:(Project A | Mission B), text:(deep + learning))
- '→' sequential/temporal relationships (when complex queries have to be sequenced in multiple simpler queries)
- 'analyze:type' analysis requests (connections, patterns, summary, count)`;

const QUERY_TOOL_PATTERN_EXAMPLES = `## EXECUTION EXAMPLES:

**CRITICAL DECISION RULES:**
1. **SAME-BLOCK REQUESTS**: If user says "depth=0", "same block", "in same block" → ALWAYS use findBlocksByContent with depthLimit=0
2. **HIERARCHICAL SEARCH**: For A + B patterns → convert to A <=> B and use findBlocksWithHierarchy (unless rule 1 applies)
3. **HIERARCHY OPERATORS**: Use <=> (bidirectional), > (strict parent-child), => (flexible) based on context

**HIERARCHICAL SEARCH (DEFAULT for multi-condition AND queries):**
- 'ref:Machine Learning + ref:AI Fundamentals' → findBlocksWithHierarchy with hierarchicalExpression="ref:Machine Learning <=> ref:AI Fundamentals" (convert + to <=> for hierarchical relationships)
- 'text:productivity + text:tools' → findBlocksWithHierarchy with hierarchicalExpression="text:productivity <=> text:tools" (searches hierarchical connections, not same-block)  
- 'ref:recipe + text:sugar' → findBlocksWithHierarchy with hierarchicalExpression="ref:recipe <=> text:sugar" (sugar might be in child blocks of recipe references)

**MULTIPLE REFERENCE OR/AND SYNTAX:**
- 'ref:pending | ref:waiting | ref:pause + ref:status' → findBlocksWithHierarchy with hierarchicalExpression="ref:pending | ref:waiting | ref:pause + ref:status" (blocks with status AND any pending variant - tools automatically expand with semantic variations)
- 'text:machine | text:AI | text:neural + ref:learning' → findBlocksWithHierarchy with hierarchicalExpression="text:machine | text:AI | text:neural <=> ref:learning" (blocks with learning page AND any ML text terms)
- 'ref:project + ref:status' → findBlocksWithHierarchy (blocks referencing BOTH project AND status pages)  
- 'text:deep + text:learning' → findBlocksByContent (blocks containing BOTH "deep" AND "learning" text)
- 'text:Machine Learning > text:Deep Learning' → findBlocksWithHierarchy with hierarchicalExpression="text:Machine Learning > text:Deep Learning" (explicit hierarchy)
- 'text:AI => text:neural networks' → findBlocksWithHierarchy with hierarchicalExpression="text:AI => text:neural networks" (flexible hierarchy)

**FLAT SEARCH (for single conditions, OR logic, or explicit same-block requests):**
- 'text:productivity | text:tools' → findBlocksByContent (OR logic works better with flat search)
- 'text:productivity' → findBlocksByContent (single condition, no hierarchy needed)  
- 'ref:meeting + in:Project A + depth=0' → findBlocksByContent with depthLimit=0 (user explicitly requests same-block search)
- 'ref:Machine Learning + ref:AI Fundamentals depth=0' → findBlocksByContent with depthLimit=0 (force same-block search)
- 'text:A + text:B in same block' → findBlocksByContent with depthLimit=0 (same-block constraint)

**SYMBOLIC QUERY PATTERNS:**
- 'text:strategy' → findBlocksByContent with text condition (normal text search, allows expansion)
- 'regex:/\\\\bstrategy\\\\b/i' → findBlocksByContent with regex condition (exact word boundaries)
- 'text:strategy*' → findBlocksByContent with fuzzy expansion
- 'text:strategy~' → findBlocksByContent with semantic expansion
- 'text:A + text:B same block' → findBlocksByContent with depthLimit=0 (same-block constraint)
- 'text:A + text:B exact' → findBlocksByContent (keep + when user requests exact same-block matches)

**SEMANTIC SEARCH:**
- 'page:(title:AI~) → analyze:connections' → Find pages about AI or relative concepts using findPagesByTitle with smartExpansion:true`;

// Shared Roam formatting instructions
export const ROAM_FORMATTING_INSTRUCTIONS = `ROAM-SPECIFIC FORMATTING - MANDATORY:
- ALWAYS format page names as [[Page Name]] (double brackets) - NEVER use quotes around page names, user they are not existing
- When referencing specific blocks found in results, ALWAYS embed them using the following syntaxe (with embed-path being a Roam native key-word, reproduce it strickly): {{[[embed-path]]: ((block-uid))}}.
- NEVER format block content in code blocks (\`\`\` syntax) - use block embeds instead
- NEVER display raw block content - always use the embed syntax for blocks, unless you are just quoting a very small part of this block content on purpose
- Use Roam-compatible markdown syntax throughout your response
- RESPECT USER LANGUAGE: Always respond in the same language as the user's request`;

// Conditional Roam formatting based on view mode
export const getFormattingInstructions = (isDirectChat?: boolean): string => {
  // In direct chat mode (full results popup), we don't need Roam-specific formatting
  // since the response is displayed in the chat interface, not inserted into Roam blocks
  if (isDirectChat) {
    return `RESPONSE FORMATTING:
- Use clear, readable markdown formatting
- Format page names as **Page Name** (bold) for readability
- Use standard markdown lists and formatting
- RESPECT USER LANGUAGE: Always respond in the same language as the user's request`;
  }

  // Regular mode: response will be inserted into Roam, so use Roam formatting
  return ROAM_FORMATTING_INSTRUCTIONS;
};

// Private mode instructions
export const buildPrivateModeInstructions = (privateMode: boolean): string => {
  if (!privateMode) return "";

  return `

🔒 PRIVATE MODE - CRITICAL INSTRUCTIONS:
- You are in STRICT PRIVATE MODE - you must NEVER process or analyze block content
- Your ONLY job is to find matching blocks (or pages) and return their UIDs, without analysis, explanation or content processing
- ALWAYS use resultMode='uids_only' in ALL tool calls
`;
};

// Agent introduction based on mode
export const buildAgentIntro = (isConversationMode: boolean): string => {
  if (isConversationMode) {
    return `You are a conversational AI assistant helping users explore their Roam Research database. You're having a friendly, helpful conversation where you can analyze, discuss, and explore their knowledge base.

🎯 CONVERSATION PRIORITY:
- FIRST: Use any content provided in the user's message context - it contains complete information
- SECOND: Only use search tools if the provided content is insufficient for the user's question
- Be engaging and conversational while avoiding unnecessary searches when you have the needed information

Maintain a warm, helpful tone and ask follow-up questions when appropriate.`;
  }

  return `You are a ReAct agent helping users search their Roam Research database. You can reason about what the user wants and use appropriate tools to find the information.`;
};

// Function removed - was part of abandoned streamlined optimization strategy

// Token-optimized prompt builder - Simple vs Complex queries
export const buildSystemPrompt = (state: {
  permissions: { contentAccess: boolean };
  privateMode?: boolean;
  isConversationMode?: boolean;
  // Symbolic query support
  queryComplexity?: "simple" | "logical" | "multi-step";
  userIntent?: string;
  userQuery?: string;
  formalQuery?: string;
  searchStrategy?: "direct" | "hierarchical";
  analysisType?: "count" | "compare" | "connections" | "summary";
  language?: string;
  datomicQuery?: string;
  // Semantic expansion: simplified boolean flag + strategy
  isExpansionGlobal?: boolean;
  semanticExpansion?:
    | "synonyms"
    | "related_concepts"
    | "broader_terms"
    | "all"
    | "custom";
  strategicGuidance?: {
    approach?: string;
    recommendedSteps?: string[];
  };
  searchDetails?: {
    timeRange?: { start: string; end: string };
    maxResults?: number;
    requireRandom?: boolean;
    depthLimit?: number;
  };
  // Expansion support
  shouldAddExpansionStrategies?: boolean;
  currentExpansionLevel?: number;
}): string => {
  // Determine if this is a simple query for token optimization
  const isSimpleQuery =
    state.queryComplexity === "simple" &&
    !state.analysisType &&
    !state.datomicQuery &&
    !state.formalQuery?.includes("→") &&
    state.searchStrategy !== "hierarchical"; // Always use complex prompt for hierarchical

  if (isSimpleQuery) {
    return buildSimpleQueryPrompt(state);
  } else {
    return buildComplexQueryPrompt(state);
  }
};

// Simple query prompt - optimized for basic searches (~1800 tokens)
const buildSimpleQueryPrompt = (state: any): string => {
  const toolNames = listAvailableToolNames(state.permissions);
  const agentIntro = buildAgentIntro(state.isConversationMode || false);
  const privateModeInstructions = buildPrivateModeInstructions(
    state.privateMode || false
  );

  return `${agentIntro}${privateModeInstructions}

## SIMPLE QUERY EXECUTION

USER INTENT: ${state.userIntent || "Execute search"}
SYMBOLIC QUERY: '${state.formalQuery || state.userQuery}
'${
    state.datomicQuery
      ? `\nDATOMIC QUERY: ${state.datomicQuery}
  \nSince a Datomic queries is provided by the user, use executeDatomicQuery directly`
      : ""
  }

## CORE SYMBOLIC OPERATORS:

### Condition Types (ALWAYS use explicit prefixes):
- 'text:term' - text content search (ALWAYS use text: prefix)
- 'ref:title' - page references 
- 'regex:/pattern/[i]' - regex patterns
- 'bref:uid' - block references

### Logic & Expansion:
- '+' = AND , '|' = OR , '-' = NOT (individual conditions only)
- '*' = fuzzy/wildcard , '~' = semantic expansion (suffixes: text:term*, text:term~)
- 'text:(A + B)' = grouped syntax for same-type conditions

### Hierarchical (only ONE per query, between TWO conditions):
- 'text:A <=> ref:B' = bidirectional , 'text:A > ref:B' = parent-child
- Precedence: () > hierarchical > + > | > -

### Page Search (only ONE page:() per query):
- 'page:(title:pattern)' - search page titles
- 'page:(content:pattern)' - search page content  
- 'page:(attr:key:type:value)' - attribute searches (also content search)

${QUERY_TOOL_PATTERN_EXAMPLES}

## AVAILABLE TOOLS
${toolNames.map((name) => `- ${name}`).join("\n")}

## EXECUTION STRATEGY
1. **Decode Query**: '${state.formalQuery || state.userQuery}' 
2. **Select Tool**: Choose most appropriate tool for query type
3. **Execute**: Use decoded parameters from symbolic query

## KEY RULES
- Execute SYMBOLIC QUERY as primary strategy, follow strictly its logic to transform conditions into tool parameters, calling the right tool
- **SEMANTIC EXPANSION TRACKING**: 
  * **CRITICAL: DO NOT expand symbols yourself - tools handle expansion internally**
  * **ALWAYS preserve * and ~ symbols exactly as they appear in formalQuery**
  * **Example**: formalQuery "text:color~" → create condition {text: "color~", type: "text"} (NOT individual colors)
  * **Example**: formalQuery "text:car*" → create condition {text: "car*", type: "text"} (NOT car variations)
  * **Example**: formalQuery "ref:pend*" → create condition {text: "pend*", type: "page_ref"} (NOT page variations)${
    state.isExpansionGlobal
      ? `\n  * **GLOBAL SEMANTIC EXPANSION**: "${
          state.semanticExpansion || "synonyms"
        }" strategy will be applied to ALL conditions automatically`
      : ""
  }
- Use 'in:scope' for limitToPages parameter only
- Default to 'summary' result mode for efficiency

Execute the symbolic query now.`;
};

// Complex query prompt - full featured for advanced searches (~3200 tokens)
const buildComplexQueryPrompt = (state: any): string => {
  const toolNames = listAvailableToolNames(state.permissions);
  const agentIntro = buildAgentIntro(state.isConversationMode || false);
  const privateModeInstructions = buildPrivateModeInstructions(
    state.privateMode || false
  );

  return `${agentIntro}${privateModeInstructions}

## COMPLEX QUERY EXECUTION

USER REQUEST: "${state.userQuery}"
USER INTENT: ${state.userIntent || "Execute advanced search"}
${state.formalQuery ? `SYMBOLIC QUERY: '${state.formalQuery}'` : ""}
${state.datomicQuery ? `DATOMIC QUERY: ${state.datomicQuery}` : ""}
COMPLEXITY: ${state.queryComplexity || "multi-step"}
${state.analysisType ? `ANALYSIS: ${state.analysisType}` : ""}
${
  state.isExpansionGlobal
    ? `GLOBAL SEMANTIC EXPANSION: ${state.semanticExpansion || "synonyms"}`
    : ""
}

## AVAILABLE TOOLS
${toolNames.map((name) => `- ${name}`).join("\n")}

${SYMBOLIC_QUERY_LANGUAGE}

IMPORTANT: fuzzy and semantic expansion have to be done in ${
    state.language ? ` in ${state.language}` : "the user request language"
  })

${QUERY_TOOL_PATTERN_EXAMPLES}

## EXECUTION STRATEGY
${
  state.strategicGuidance?.recommendedSteps
    ?.map((step) => `- ${step}`)
    .join("\n") || "- Execute the symbolic query systematically"
}

## TOKEN OPTIMIZATION:
- Use 'summary' mode for initial searches
- Use 'uids_only' for chaining/analysis
- Apply fromResultId for multi-step efficiency

## CRITICAL RULES:
- Execute SYMBOLIC QUERY as primary strategy, follow strictly its logic to transform conditions into tool parameters, calling the right tool
- **SEMANTIC EXPANSION TRACKING**: 
  * **Semantic expansion is handled automatically by the tool** - you just need to create conditions with the exact text from formalQuery (including symbols)
  * **Example**: formalQuery "pend*" → create condition {text: "pend*", type: "text"}
  * **Example**: formalQuery "car~" → create condition {text: "car~", type: "text"}
  * **Example**: formalQuery "ref:pend*" → create condition {text: "pend*", type: "page_ref"}${
    state.isExpansionGlobal
      ? `\n  * **GLOBAL SEMANTIC EXPANSION**: "${
          state.semanticExpansion || "synonyms"
        }" strategy will be applied to ALL conditions automatically`
      : ""
  }
- Chain multi-step queries with intermediate results
- Apply analysis tools when specified

${buildExpansionGuidanceSection(state)}
${
  state.searchDetails?.depthLimit === 0
    ? `\n🔒 **CRITICAL OVERRIDE**: User requested depth=0 (same-block search). MUST use findBlocksByContent, NOT findBlocksWithHierarchy.\n`
    : ""
}
Execute the complex symbolic query now.`;
};

// Build expansion guidance section for ReAct Assistant (dynamic based on level and search type)
const buildExpansionGuidanceSection = (state: any): string => {
  // Only include expansion strategies when explicitly requested (zero results)
  if (
    !state.shouldAddExpansionStrategies ||
    state.searchStrategy === "direct"
  ) {
    return "";
  }

  const currentLevel = state.currentExpansionLevel || 0;
  const userQuery = state.userQuery || "";
  const isPageSearch =
    userQuery.toLowerCase().includes("page") ||
    state.formalQuery?.includes("page:");

  console.log(
    `🔧 [buildExpansionGuidanceSection] Building guidance for level ${currentLevel}, isPageSearch: ${isPageSearch}, query: "${userQuery}"`
  );

  if (currentLevel <= 0) {
    console.warn(
      `🔧 [buildExpansionGuidanceSection] Unexpected level ${currentLevel} <= 0, should not show expansion guidance yet`
    );
    return "";
  }

  if (currentLevel === 1) {
    return buildLevel1Guidance(isPageSearch, userQuery);
  } else if (currentLevel === 2) {
    return buildLevel2Guidance(isPageSearch, userQuery);
  } else if (currentLevel === 3) {
    return buildLevel3Guidance(isPageSearch, userQuery);
  } else if (currentLevel >= 4) {
    return buildLevel4Guidance(isPageSearch, userQuery);
  }

  return "";
};

// Level 1: Fuzzy matching + hierarchy for blocks
const buildLevel1Guidance = (
  isPageSearch: boolean,
  userQuery: string
): string => {
  if (isPageSearch) {
    return `
## 🔍 LEVEL 1: FUZZY MATCHING

**PAGE SEARCH - Level 1 Strategy:**
- **Use semanticExpansion: "fuzzy"** for typo correction and morphological variations
- **Focus**: Handle typos, plural/singular, verb forms, alternative spellings

**ACTION**: Set semanticExpansion: "fuzzy" on key conditions
`;
  } else {
    return `
## 🔍 LEVEL 1: FUZZY + HIERARCHY

**BLOCK SEARCH - Level 1 Strategy:**
- **Use semanticExpansion: "fuzzy"** for typo correction and morphological variations  
- **Try hierarchy exploration**: Use findBlocksWithHierarchy for parent/child relationships
- **Focus**: Handle typos + explore hierarchical context

**ACTION**: Set semanticExpansion: "fuzzy" and use hierarchy tools as needed
`;
  }
};

// Level 2: Synonyms expansion
const buildLevel2Guidance = (
  isPageSearch: boolean,
  userQuery: string
): string => {
  return `
## 📝 LEVEL 2: SYNONYMS

**STRATEGY:**
- **Use semanticExpansion: "synonyms"** for finding alternative terms
- **Focus**: Words that mean the same thing or are used interchangeably

**ACTION**: Set semanticExpansion: "synonyms" on key conditions
`;
};

// Level 3: Related concepts expansion
const buildLevel3Guidance = (
  isPageSearch: boolean,
  userQuery: string
): string => {
  return `
## 🧠 LEVEL 3: RELATED CONCEPTS

**STRATEGY:**
- **Use semanticExpansion: "related_concepts"** for finding associated terms
- **Focus**: Related ideas, associated concepts, terms commonly found together

**ACTION**: Set semanticExpansion: "related_concepts" on key conditions
`;
};

// Level 4: Different tool strategies
const buildLevel4Guidance = (
  isPageSearch: boolean,
  userQuery: string
): string => {
  return `
## 🔄 LEVEL 4: NEW TOOL STRATEGIES

**STRATEGY:**
- **Try completely different tool approaches**
- **Use different tool sequences and combinations**
- **Consider multi-step workflows**

**ACTION**: Use different tools or tool combinations than previously attempted
`;
};

// Request analysis system prompt
export const buildRequestAnalysisPrompt = (state: {
  userQuery: string;
  conversationHistory?: any[];
  cachedFullResults?: Record<string, any>;
}): string => {
  const conversationContext = state.conversationHistory?.length
    ? state.conversationHistory
        .slice(-4)
        .map((msg) => {
          if (typeof msg === "string") return msg;
          if (msg.role && msg.content) return `${msg.role}: ${msg.content}`;
          return String(msg);
        })
        .join("\n")
    : "";

  const cachedResultsMetadata = Object.keys(state.cachedFullResults || {}).map(
    (key) => {
      const cached = state.cachedFullResults![key];
      return `- ${cached.toolName}: ${
        cached.fullResults?.metadata?.totalFound || "unknown"
      } results for "${cached.userQuery}"`;
    }
  );

  const hasCachedResults = cachedResultsMetadata.length > 0;

  return `You are a request analyzer for a search system. Your job is to:

1. DECIDE if the current user request can be satisfied with cached results from previous searches OR if new searches are needed
2. REFORMULATE the user request to be completely explicit and context-independent
3. RESPOND with ONLY valid JSON - no explanations, observations, or additional text

CURRENT REQUEST: "${state.userQuery}"

CONVERSATION HISTORY:
${conversationContext || "No previous conversation"}

AVAILABLE CACHED RESULTS:
${
  hasCachedResults
    ? cachedResultsMetadata.join("\n")
    : "No cached results available"
}

DECISION CRITERIA:
- Use cached results if: 
  * User asks for "more details", "comprehensive results", "show more", "deeper analysis"
  * User asks about a RELATED or MORE SPECIFIC aspect of previously searched topics
  * The cached results likely contain the information needed (even if more specific)
- Need new search if: 
  * Request is about a completely DIFFERENT topic with no overlap to cached results
  * User asks for entirely new information unrelated to previous searches

IMPORTANT: If the current request is asking for MORE SPECIFIC information about concepts already found in cached results, prefer using cache first. For example:
- Previous search: "justice AND equality" 
- Current request: "distributive justice" 
- Decision: USE_CACHE (distributive justice is a specific type of justice, likely mentioned in justice results)

REFORMULATION RULES:
- Make the request completely explicit and self-contained
- Include the original search topic/context if using cached results
- Preserve the user's language preference
- Remove vague references like "this", "that", "more details about it"

RESPONSE FORMAT:
Respond with ONLY a JSON object, no additional text or explanations:
{
  "decision": "use_cache" | "need_new_search",
  "reformulatedQuery": "Complete, explicit version of the request",
  "originalSearchContext": "Original search topic if using cache, null otherwise"
}

CRITICAL: Your response must contain ONLY the JSON object above. Do not add any explanatory text, observations, or comments before or after the JSON.

Examples:
- User: "show me more details" after searching "test" → {"decision": "use_cache", "reformulatedQuery": "Show comprehensive details about test", "originalSearchContext": "test"}
- User: "what about distribute justice" after searching "justice and equality" → {"decision": "use_cache", "reformulatedQuery": "Find specific information about distributive justice (justice par répartition) from justice and equality results", "originalSearchContext": "justice et égalité"}
- User: "find information about cats" → {"decision": "need_new_search", "reformulatedQuery": "find information about cats", "originalSearchContext": null}`;
};

// Final response system prompt builder
export const buildFinalResponseSystemPrompt = (
  state: {
    userQuery: string;
    resultStore?: Record<string, any>;
    isDirectChat?: boolean;
    isConversationMode?: boolean;
    conversationHistory?: any[];
    conversationSummary?: string;
    permissions?: { contentAccess: boolean };
    privateMode?: boolean;
  },
  securityMode: "private" | "balanced" | "full"
): string => {
  // Direct chat mode - simple conversational prompt without complex result processing
  if (state.isDirectChat) {
    // Extract external context results if available
    const externalContextPrompt =
      state.resultStore && Object.keys(state.resultStore).length > 0
        ? `\n\nAVAILABLE SEARCH RESULTS:\n${extractResultDataForPrompt(
            state.resultStore,
            securityMode
          )}\n`
        : "";

    return `You are a helpful AI assistant having a conversation about search results from a Roam Research database.

CONVERSATION CONTEXT:
User Query: ${state.userQuery}

CONVERSATION HISTORY:
${
  state.conversationHistory
    ?.map((msg) => `${msg.role}: ${msg.content}`)
    .join("\n") || "No previous conversation"
}

PERMISSIONS: ${
      state.permissions?.contentAccess ? "Full access" : "Limited access"
    } | ${
      state.privateMode ? "Private mode" : "Standard mode"
    }${externalContextPrompt}

GUIDELINES:
- Focus on analyzing and discussing the provided content above
- Be conversational and engaging  
- Use ((uid)) syntax when referencing specific blocks from the results
- The search results above contain the actual block content you can analyze
- If you need additional information beyond the provided results, explain what would be helpful
- Keep responses well-structured and easy to read
- For questions about content, themes, connections - analyze what you can see directly in the results

FORMATTING REQUIREMENTS:
- Use clear paragraph breaks (double line breaks) between main ideas
- Use ## for section headers when organizing complex responses  
- Use **bold** for emphasis on key concepts or terms
- Use bullet points (-) for lists rather than numbers for better readability
- Keep bullet points concise and well-spaced
- Structure longer responses with clear sections (e.g., ## Key Insights, ## Relevance Today)

STYLE: Natural dialogue - feel free to use phrases like "I can see in your results...", "Looking at these blocks...", "From what you've shared..."`;
  }

  // Regular agent mode - extract result data for complex processing
  const resultDataForPrompt = extractResultDataForPrompt(
    state.resultStore || {},
    securityMode
  );

  // Chat-friendly conversation context
  const conversationContext = state.isConversationMode
    ? `You are having a conversation about Roam Research data. This is a conversational interaction where you should be friendly, helpful, and engaging.

CONVERSATION CONTEXT: ${
        state.conversationHistory?.length || 0
      } previous exchanges in this chat session.
${
  state.conversationSummary
    ? `Previous context: ${state.conversationSummary}`
    : ""
}

TONE: Conversational, helpful, and interactive. You can ask follow-up questions or suggest related explorations.
STYLE: Natural dialogue - feel free to use phrases like "I found...", "Looking at these results...", "You might also be interested in..."
INTERACTIVITY: If appropriate, suggest follow-up questions or related searches the user might find interesting.

`
    : `You are generating a search result response for a Roam Research query.

`;

  const baseInstructions = `${conversationContext}USER QUERY: "${
    state.userQuery
  }"

AVAILABLE RESULT DATA:
${resultDataForPrompt}

🚨 CRITICAL - READ CAREFULLY:
- The AVAILABLE RESULT DATA above contains PRE-VALIDATED results that already match the user's query
- Do NOT re-evaluate or filter these results - they are already correct matches
- EVERY UID listed has been confirmed to match the search criteria
- Your job is to FORMAT and DISPLAY these results, not to judge their relevance
- Display ALL UIDs listed - each represents a valid result that matches "${
    state.userQuery
  }"

${getFormattingInstructions(state.isDirectChat)}`;

  // Private mode: Strict formatting with hard limits
  if (securityMode === "private") {
    return `${baseInstructions}

🔒 PRIVATE MODE - STRICT REQUIREMENTS:
- DISTINGUISH result types: Look for "Type: Page" in the data to identify pages vs blocks
- For PAGES (when data shows "Type: Page"): Use [[Page Title]] syntax - NO embed syntax for pages  
- For BLOCKS (when no "Type: Page" marker): Use {{[[embed-path]]: ((real-uid))}} syntax for EVERY UID
- For PAGE REFERENCES (with counts): List as [[Page Title]] (count references)
- NO content analysis, summaries, or explanations - ONLY list the results
- NO fake UIDs - only use real data from above
- MANDATORY: Display all items shown in the data (up to 20 maximum)

DISPLAY RULES:
- ALWAYS display exactly the number of results shown in the data above (up to 20 items maximum)
- If the original search found more results than shown, mention "Click the **View Full Results** button to see all [original total] results"
- Count the exact number of items in the data and report appropriately: "Found X matching blocks/pages/results"

EXACT FORMAT REQUIRED:
For BLOCKS:
Found [original total] matching blocks [here are the first 20]:
- {{[[embed-path]]: ((first-uid))}}
- {{[[embed-path]]: ((second-uid))}}

For PAGES:
Found [original total] matching pages [here are the first 20]:
- [[First Page Title]]
- [[Second Page Title]]

For MIXED RESULTS:
Found [original total] matching results:
- [[Page Title]] (page)
- {{[[embed-path]]: ((block-uid))}} (block)
`;
  }

  // Balanced & Full modes: Intelligent analysis
  const analysisInstructions = state.isConversationMode
    ? `🧠 CONVERSATIONAL ANALYSIS MODE:
- Engage in friendly dialogue about the search results
- Provide thoughtful analysis while maintaining a conversational tone
- Use natural language: "I notice that...", "It looks like...", "Based on what I'm seeing..."
- For small result sets (≤15): Show results with conversational commentary
- For larger result sets: Highlight the most interesting findings and ask if they want to explore specific areas
- Use block embeds {{[[embed-path]]: ((real-uid))}} for key examples you're discussing
- Group results by themes with conversational explanations
- End with engaging follow-up suggestions: "Would you like me to explore...", "I could also look into...", "Anything specific you'd like me to focus on?"

CONVERSATION FORMATTING:
- Use clear paragraph breaks (double line breaks) between main ideas
- Use ## headers to organize complex responses into sections
- Use **bold** for key terms and important concepts
- Use bullet points (-) for lists, keep them concise and well-spaced
- Structure longer responses clearly: ## Key Findings, ## Themes, ## Next Steps
- Keep the tone warm and helpful, like you're discussing findings with a colleague`
    : `🧠 INTELLIGENT RESPONSE MODE:
- Provide thoughtful analysis and organization of search results
- Use your judgment to select most relevant results to display
- For small result sets (≤15): Usually show all results with analysis
- For larger result sets: Show most relevant results, summarize patterns and key insights
- Use block embeds {{[[embed-path]]: ((real-uid))}} for key examples
- For PAGE REFERENCES: List as [[Page Title]] (count references) with context
- Add contextual comments, group by themes, and provide insights based on the data
- When not showing all results, explain your selection approach and mention total count
- Make your response valuable by highlighting patterns, connections, and key findings`;

  return `${baseInstructions}

${analysisInstructions}`;
};

// Cache processing system prompt
export const buildCacheProcessingPrompt = (state: {
  userQuery: string;
  reformulatedQuery?: string;
  originalSearchContext?: string;
  resultSummaries?: Record<string, any>;
  cachedFullResults?: Record<string, any>;
  isDirectChat?: boolean;
}): string => {
  // Build optimized cache results summary
  const summaries: string[] = [];

  // NEW: Use token-optimized result summaries (preferred)
  if (state.resultSummaries && Object.keys(state.resultSummaries).length > 0) {
    Object.entries(state.resultSummaries).forEach(([resultId, summary]) => {
      // Only include active results (not superseded ones) - simplified for prompts file
      const summaryText = `${summary.totalCount} ${summary.resultType} found`;
      summaries.push(`${resultId}: ${summaryText}`);
    });
  }

  // LEGACY: Fall back to old cachedFullResults for backward compatibility
  if (summaries.length === 0 && state.cachedFullResults) {
    Object.entries(state.cachedFullResults).forEach(([cacheId, cached]) => {
      const results = cached.fullResults;
      const dataCount = results?.data?.length || 0;
      const toolName = cached.toolName || "unknown";
      summaries.push(`${cacheId}: ${dataCount} ${toolName} results available`);
    });
  }

  const cacheResultsSummary =
    summaries.length > 0 ? summaries.join("\n") : "No cached results available";

  return `You are processing a user request using cached search results. Your job is to:

1. Analyze the cached search results to answer the user's request
2. Determine if the cached results are sufficient or if additional searches are needed
3. Provide a comprehensive response based on the available data

USER REQUEST: "${state.reformulatedQuery || state.userQuery}"
ORIGINAL SEARCH CONTEXT: "${state.originalSearchContext || "unknown"}"

AVAILABLE CACHED RESULTS:
${cacheResultsSummary}

INSTRUCTIONS:
You have three strategic options for handling this conversation turn:

1. **SUFFICIENT_CACHE**: If cached results fully answer the user's request
   → Respond directly with your complete answer using the cached data

2. **HYBRID_APPROACH**: If cached results provide foundation but new searches could enhance the response
   → Respond with: "HYBRID: [explanation]"
   → Example: "HYBRID: Cached results show 15 project blocks, but could search for recent updates or related discussions"

3. **INSUFFICIENT_CACHE**: If cached results don't help with this specific request
   → Respond with: "INSUFFICIENT_CACHE: [brief explanation]"

Examples:

HYBRID response:
"HYBRID: I have cached results with 20 blocks about project management, but the user is asking specifically about recent updates. I can use the cached foundation and search for blocks modified in the last month."

INSUFFICIENT_CACHE response:
"INSUFFICIENT_CACHE: User is asking about a completely different topic than what's in the cached results. Need fresh searches on the new topic."

${getFormattingInstructions(state.isDirectChat)}
- If providing comprehensive results, mention these are from previous searches
- Focus on the user's specific request`;
};

// Cache system prompt builder for final response generation
export const buildCacheSystemPrompt = (
  state: {
    userQuery: string;
    resultStore?: Record<string, any>;
    isDirectChat?: boolean;
  },
  cacheProcessorResponse: string,
  securityMode: "private" | "balanced" | "full"
): string => {
  return `You are generating a final response using cached search results.

USER QUERY: "${state.userQuery}"
CACHE PROCESSOR ANALYSIS: "${cacheProcessorResponse}"

AVAILABLE RESULT DATA:
${extractResultDataForPrompt(state.resultStore || {}, securityMode)}

INSTRUCTIONS:
- Use the CACHE PROCESSOR ANALYSIS as your guide for what to include
- Format the results properly using the AVAILABLE RESULT DATA above
- Use real UIDs and page titles from the data
- Mention that results are from previous searches
- Focus on answering the user's specific request

${getFormattingInstructions(state.isDirectChat)}`;
};

/**
 * Extract and format result data for system prompt based on security mode
 */
export const extractResultDataForPrompt = (
  resultStore: Record<string, any>,
  securityMode: "private" | "balanced" | "full"
): string => {
  if (!resultStore || Object.keys(resultStore).length === 0) {
    return "No result data available.";
  }

  // Filter to only include final and active results for the final response
  const relevantEntries = Object.entries(resultStore).filter(([, result]) => {
    // Handle both new structure and legacy structure for backward compatibility
    if (result && typeof result === "object" && "purpose" in result) {
      // New structure: only include final/completion results that are active
      return (
        (result.purpose === "final" || result.purpose === "completion") &&
        result.status === "active"
      );
    } else {
      // Legacy structure: include all (for backward compatibility)
      return true;
    }
  });

  // Fallback: if no results marked as final, include the most recent results with actual data
  if (relevantEntries.length === 0) {
    console.log(
      "🎯 [ExtractResultData] No final results found, using fallback to most recent results with data"
    );
    const allEntries = Object.entries(resultStore);

    // Filter out entries with empty data first
    const entriesWithData = allEntries.filter(([_, result]) => {
      const data = result?.data || result;
      return Array.isArray(data) && data.length > 0;
    });

    if (entriesWithData.length > 0) {
      // Sort by timestamp (if available) or by ID and take the most recent ones
      const sortedEntries = entriesWithData.sort((a, b) => {
        const aTime = a[1]?.timestamp || 0;
        const bTime = b[1]?.timestamp || 0;
        return bTime - aTime; // Most recent first
      });
      relevantEntries.push(...sortedEntries.slice(0, 3)); // Include up to 3 most recent with data
    }
  }

  console.log(
    `🎯 [ExtractResultData] Using ${relevantEntries.length} relevant results for final response`
  );

  // DEDUPLICATION: Combine all result data and deduplicate by UID
  const allResultData: any[] = [];
  const seenUids = new Set<string>();

  for (const [resultId, result] of relevantEntries) {
    // Extract data from new or legacy structure
    const data = result?.data || result;
    if (!Array.isArray(data) || data.length === 0) continue;

    // Add items to combined list, deduplicating by UID
    for (const item of data) {
      const itemUid = item.uid || item.pageUid;
      if (itemUid && !seenUids.has(itemUid)) {
        seenUids.add(itemUid);
        allResultData.push({
          ...item,
          sourceResultId: resultId, // Track which tool found this result
        });
      }
    }
  }

  console.log(
    `🎯 [ExtractResultData] Deduplicated ${relevantEntries.length} result sets into ${allResultData.length} unique items`
  );

  // Now process the deduplicated data as a single combined result
  let formattedResults: string[] = [];

  // Process the deduplicated data directly
  if (allResultData.length > 0) {
    const data = allResultData;

    let limitedData: any[];

    switch (securityMode) {
      case "private":
        // Only UIDs and page titles for embed syntax
        limitedData = data.slice(0, 20).map((item) => ({
          uid: item.uid,
          pageUid: item.pageUid, // For extractPageReferences results
          pageTitle: item.pageTitle || item.title,
          count: item.count, // Preserve count for references
          isPage: !!item.title && !item.content, // Detect if this is a page vs block
        }));
        console.log(
          `🎯 [ExtractResultData] Private mode data sample:`,
          limitedData.slice(0, 3)
        );
        break;

      case "balanced":
        // UIDs, titles, basic metadata, limited content
        limitedData = data.slice(0, 100).map((item) => ({
          uid: item.uid,
          pageUid: item.pageUid, // For extractPageReferences results
          pageTitle: item.pageTitle || item.title,
          count: item.count, // Preserve count for references
          content: item.content
            ? item.content.substring(0, 200) + "..."
            : undefined,
        }));
        break;

      case "full":
        // Complete data access for full analysis
        limitedData = data.slice(0, 200);
        break;
    }

    const dataString = limitedData
      .map((item) => {
        const parts = [];

        // Handle different result types - check both uid and pageUid
        if (item.uid) {
          parts.push(`UID: ${item.uid}`);
        } else if (item.pageUid) {
          parts.push(`PageUID: ${item.pageUid}`);
        }

        // For block results, show page context more subtly to avoid confusion
        if (item.pageTitle && item.uid) {
          // This is a block result - show page as context, not main result
          parts.push(`(in [[${item.pageTitle}]])`);
        } else if (item.pageTitle) {
          // This is a page result - show title prominently
          parts.push(`Title: [[${item.pageTitle}]]`);
        }

        // Add count if available (for extractPageReferences results)
        if (item.count !== undefined) {
          parts.push(`Count: ${item.count}`);
        }

        if (item.content && securityMode !== "private") {
          parts.push(`Content: ${item.content}`);
        }

        if (item.isPage) {
          parts.push(`Type: Page`);
        }

        return `  - ${parts.join(", ")}`;
      })
      .join("\n");

    // Calculate total count from original results
    const originalTotal = relevantEntries.reduce((total, [, result]) => {
      const resultData = result?.data || result;
      return total + (Array.isArray(resultData) ? resultData.length : 0);
    }, 0);

    const countDisplay =
      originalTotal > limitedData.length
        ? `${limitedData.length} of ${originalTotal} items (deduplicated)`
        : `${limitedData.length} items`;

    formattedResults.push(`combined_results (${countDisplay}):\n${dataString}`);

    console.log(
      `🎯 [ExtractResultData] Formatted combined results:`,
      dataString.substring(0, 200)
    );
  } else {
    // No results found - explicitly indicate this to prevent hallucination
    console.log("🎯 [ExtractResultData] No results with data found");
    formattedResults.push("No matching results found.");
  }

  return formattedResults.join("\n\n");
};

// Build available tools section based on permissions
const buildAvailableToolsSection = (
  hasContentAccess: boolean,
  isPrivateMode: boolean
): string => {
  const coreTools = `**Core Search Tools:**
- findBlocksByContent: Search text, content (via regex) or page reference within blocks
- findBlocksWithHierarchy: Search blocks matching conditions in them and in their parents or children
- findPagesByTitle: Search pages by title with exact, contains, or regex matching. Supports smart expansion - finds similar existing pages + semantic variations with existence validation
- findPagesByContent: Search pages whose content matches some criteria

**Analysis Tools:**
- extractPageReferences: get and count page mentionned in blocks (essential for "most mentioned/referenced" queries)`;

  const contentTools =
    hasContentAccess && !isPrivateMode
      ? `
- getNodeDetails: Retrieve detailed information for pages or blocks (content, metadata, properties)
- extractHierarchyContent: Extract and format hierarchical block structures (children or parents)`
      : "";

  const advancedTools = `

**Advanced Query Tools:**
- executeDatomicQuery: Execute Datalog queries against Roam database (supports user-provided queries, auto-generated from criteria, or parameterized queries with variables from previous results)

**Utility Tools:**
- combineResults: Union/Intersection/Difference of multiple search results (essential for OR logic)`;

  return `## AVAILABLE TOOLS (Brief Descriptions)

${coreTools}${contentTools}${advancedTools}

${
  !hasContentAccess || isPrivateMode
    ? `**NOTE:** Content extraction tools (getNodeDetails, extractHierarchyContent) are ${
        isPrivateMode
          ? "disabled in private mode"
          : "restricted - limited access"
      }. Focus on search and reference analysis tools.`
    : ""
}`;
};

// Intent Parser prompt with symbolic language
export const buildIntentParserPrompt = (state: {
  userQuery: string;
  conversationHistory?: any[];
  conversationSummary?: string;
  dateContext?: string;
  permissions: { contentAccess: boolean };
  privateMode: boolean;
}): string => {
  // Build date context
  const today = new Date();
  const dateStr = today.toISOString().split("T")[0]; // YYYY-MM-DD format
  const dayName = today.toLocaleDateString("en-US", { weekday: "long" });
  const monthName = today.toLocaleDateString("en-US", { month: "long" });
  const dateContext = `Today is ${dayName}, ${monthName} ${today.getDate()}, ${today.getFullYear()} (${dateStr})`;

  return `You are an Intent Parser for a Roam Research search system. Your job is to analyze user requests and convert them into symbolic queries that can be efficiently executed by search tools (note that the user could himself try to write symbolic queries or using /regex/[i]).

## CONTEXT
- Database: Roam Research graph with pages, blocks, hierarchical relationships
- Date: ${dateContext}
- Access Level: ${state.privateMode ? "Private" : "Balanced/Full"}
${
  state.conversationSummary
    ? `\n- Previous Context: ${state.conversationSummary}`
    : ""
}
${
  state.conversationHistory?.length
    ? `\n- Recent Conversation:\n${state.conversationHistory
        .slice(-4)
        .join("\n")}`
    : ""
}

${SYMBOLIC_QUERY_LANGUAGE}

${ROAM_REFERENCES_PARSING}

Rule specific to Roam:
- if user ask for tasks (only if unquoted), you should replace task keyword by 'ref:TODO' (default) or 'ref:DONE' depending on the user demand

### Intent Parser Examples:
- "Blocks about car prices, not motorcycles" → 'text:car + text:price - text:motorcycle'
- "[[book]] I want #[[to read]]" → 'ref:book + ref:to read' (it works also with 'ref:(book + to read) )
- "Find my #recipe with sugar or vanilla (in descendants)" → 'ref:recipe >> text:sugar|text:vanilla'
- "important tasks to do with 'important' tag under [[budget planning]]" → '(ref:TODO + text:important) << ref:budget planning'
- "[[book]] notes tagged with "justice" in main block or in descendants" → 'ref:book =>> text:justice'
- "Blocks about AI in my [[work]] page" → 'in:work + text:AI~'
- "Find productivity #tips or similar concepts" → 'text:productivity~ + ref:tips'
- "Blocks containing words starting with 'work'" → 'text:work*'
- "Pages matching /lib.*/i in their title" → 'page:(title:regex:/lib.*/i)
- "All 'status' pages in title (with semantic variations)" → 'page:(title:status)' (let tools handle semantic expansion)
- "Pages about productivity or similar concepts in title" → 'page:(title:productivity)' (tools will find related page titles)
- "Pages with attribute 'status' set to #completed or #archived" → 'page:(attr:status:ref:(completed | archived))
- "Pages with author Victor Hugo and type book" → 'page:(attr:author:page_ref:Victor Hugo + attr:type:page_ref:book)'
- "Blocks with 'author' set to [[Victor Hugo]]" → 'regex:/^author::.*victor hugo.*/i'
- "Blocks with 'type' attribute set to [[book]] and #toRead in 'status'" → 'regex:/^type::.*book.*/i + regex:/^status::.*toread.*/i'
- "Find books by Victor Hugo" → 'regex:/^author::.*victor hugo.*/i'
- "Pages with status completed or done" → 'regex:/^status::.*(completed|done).*/i'
- "All content with 'priority' set to 'high'" → 'regex:/^priority::.*high.*/i'
- "Machine Learning => Deep Learning" → 'Machine Learning => Deep Learning' (keep plain text as-is for content search since there is not page ref syntax or mention)

## SPECIAL CASE - DIRECT DATOMIC QUERIES:
If the user provides a Datomic query (starts with patterns like \`[:find\`, \`[:find ?e\`, etc.), respond with:
{
  "routingDecision": "direct_datomic",
  "datomicQuery": "user's exact query",
  "userIntent": "Execute user-provided Datomic query",
  "confidence": 1.0
}

## EXPANSION INTENT DETECTION:

**Critical**: Detect user's expansion preference to apply appropriate search strategies, by interpreting its natural language request.

By default, strict search without expansion will be applied.

**CRITICAL DISTINCTION - Quoted terms vs Explicit exact keywords:**

### **QUOTED TERMS** (casual usage) → **Simple text search** (users often quote terms casually - treat as normal search terms):
- 'blocks mentioning "strategy"' → 'text:strategy' (normal text search)

### **EXPLICIT EXACT KEYWORDS** → **Regex with word boundaries**:
- 'exact word strategy' or 'blocks with "strategy" (exact)' → 'regex:/\\bstrategy\\b/i' (case-insensitive word boundaries)
- **Only when user explicitly uses keywords: "exact", "strict", "precise", "literally"**

### **EXACT BLOCK CONTENT** (very rare):
- 'blocks with exactly "Hello world"' → matchType: "exact" (entire block content equals "Hello world")

### User Expansion Intent:
- **fuzzy**: User wants variations/typos/morphological forms (keywords: "fuzzy", "typos", "variations", "spelling", "forms", or '*' operator appended to terms like "word*")
  → Examples: "fuzzy search", "find typos", "word* variations", "blocks starting with pend*"
  → Set semanticExpansion: "fuzzy"
- **synonyms**: user wants related concepts, using keyword like "similar", "related", "semantic", "alternatives", etc., or appending '~' operator to some term (→ in this case, apply it to it in the symbolic query)
  → For PAGE TITLE searches: Use 'page:(title:keyword~)'
  → For BLOCK CONTENT: 
- Detect if possible other specific type to apply: "synonyms" (same meaning, by default), "related_concepts" (associated concepts), "broader_terms" (categories), "all" (comprehensive), or, if the semantic expansion is very specific, set semanticExpansion to "custom" and reproduce the specific user demand in the 'customSemanticExpansion" field

### 🎯 ADVANCED: Implicit Custom Expansion Detection
**CRITICAL**: Look for implicit enumeration/listing patterns that should trigger custom expansion:

**Pattern 1: "most/common/popular/typical/main [category] [type]"**
- "blocks matching the most common color names" → extract "color", custom: "generate common color names"
- "find typical programming languages" → extract "programming", custom: "generate popular programming languages"
- "main European countries" → extract "Europe~", custom: "generate major European countries"

**Pattern 2: Quantified categories (numbers + categories)**
- "top 10 project management tools" → extract "project management~", custom: "generate top project management tools"
- "5 main meditation techniques" → extract "meditation~", custom: "generate meditation techniques"

**Pattern 3: "examples of [category]" or "list of [category]"**  
- "examples of machine learning algorithms" → extract "algorithm", custom: "generate machine learning algorithm examples"
- "list of healthy foods" → extract "food~", custom: "generate healthy food examples"

**How to apply:**
1. **Extract the core concept** (color, language, country, etc.)
2. **Set semanticExpansion: "custom"**
3. **Set customSemanticExpansion: "generate [specific enumeration request]"**
4. **ALWAYS use ~ symbol** on the core concept term (e.g., "color~", "programming~")
5. **ALWAYS set isExpansionGlobal: false** (let the ~ symbol handle per-term expansion)

### 🚨 CRITICAL: Global Semantic Expansion Rules:

**RULE 1: ALWAYS check for * or ~ symbols in the query**
- **IF query contains * or ~ symbols → ALWAYS set isExpansionGlobal: false**
- **These symbols indicate per-term expansion, NOT global expansion**

**RULE 2: Natural language semantic requests → set isExpansionGlobal: true**
- **IF user requests semantic expansion in natural language WITHOUT symbols → set isExpansionGlobal: true**
- Examples: "fuzzy search for pend", "find similar concepts", "semantic search for project"

**RULE 3: Per-term expansion in parentheses → add symbol, keep isExpansionGlobal: false**
- **IF expansion is specified for specific terms in parentheses → add * or ~ symbol, set isExpansionGlobal: false**
- Examples: "pend (fuzzy) and archived" → "pend* + archived", isExpansionGlobal: false

**Examples requiring isExpansionGlobal: false**:
  - "pend*" → isExpansionGlobal: false (symbol controls expansion)
  - "car~ and project" → isExpansionGlobal: false  
  - "pend (fuzzy) and test" → "pend* + test", isExpansionGlobal: false

**Examples requiring isExpansionGlobal: true**:
  - "fuzzy search for pend" → isExpansionGlobal: true, semanticExpansion: "fuzzy"
  - "find similar concepts to productivity" → isExpansionGlobal: true, semanticExpansion: "synonyms"
  - "semantic search with related terms" → isExpansionGlobal: true, semanticExpansion: "related_concepts"

## INTENT vs QUERY DISTINCTION:

**Critical**: User requests fall into two categories:
1. **Direct Search**: "Find recipes with sugar" → query matches intent
2. **Analytical Questions**: "What's the best recipe?" → query finds recipes, analysis evaluates "best"

### Question/Demand Pattern Recognition:
- **Evaluative words** ("best", "worst", "most important", "wrong") → remove from query, add to analysis
- **Quantitative words** ("how many", "count", "total") → \`analyze:count\`
- **Comparative words** ("compare", "versus", "difference") → \`analyze:compare\`
- **Connection words** ("related to", "connected", "links") → \`analyze:connections\`
- **Summary words** ("summarize", "overview", "what about") → \`analyze:summary\`

### Search Strategy Selection:
- "direct": Simple single keyword/reference searches
- "hierarchical": **DEFAULT for multi-condition AND queries** (leverages Roam's hierarchical inheritance)

**Note**: Semantic expansion strategies are handled via globalSemanticHint field.

**CRITICAL: Set searchStrategy to "hierarchical" by DEFAULT when:**
- **Multi-condition AND queries** (e.g., "productivity + tools", "ref:recipe + sugar") 
- **Explicit hierarchical operators**: >, =>, <=>, <<=>>
- **Parent-child relationship expressions**
- **Phrases like "X has Y in children", "X contains Y", "Y under X"**

**ONLY use "direct" when:**
- Single condition queries (e.g., "text:productivity" alone)
- OR logic queries (e.g., "text:productivity | text:tools")  
- User explicitly requests same-block search (e.g., "depth=0", "same block")

**Examples:**
- "text:productivity + text:tools" → searchStrategy: "hierarchical" (multi-condition AND)
- "text:productivity | text:tools" → searchStrategy: "direct" (OR logic)  
- "text:productivity" → searchStrategy: "direct" (single condition)
- "text:Machine Learning > text:Deep Learning" → searchStrategy: "hierarchical" (explicit hierarchy)

## YOUR TASK

Parse this user request: "${state.userQuery}"

Respond with only valid JSON, no explanations or any additional comment.

## OUTPUT FORMAT (JSON):
{
  "userIntent": "Clear description of what user wants to accomplish",
  "formalQuery": "symbolic query using the operators above",
  "constraints": {
    "timeRange": null | {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"},
    "maxResults": null | number,
    "requireRandom": false | true,
    "depthLimit": null
  },
  "searchStrategy": "direct" | "hierarchical",
  "analysisType": null | "count" | "compare" | "connections" | "summary",
  "isExpansionGlobal": false | true,
  "semanticExpansion": null | "synonyms" | "related_concepts" | "broader_terms" | "all" | "custom",
  "customSemanticExpansion": null | string,
  "language": "detected language in full name (e.g., 'English', 'français', 'español', 'deutsch')",
  "confidence": 0.1-1.0
}

Focus on creating precise symbolic queries that will find the most relevant data to fulfill the user's actual intent.`;
};
