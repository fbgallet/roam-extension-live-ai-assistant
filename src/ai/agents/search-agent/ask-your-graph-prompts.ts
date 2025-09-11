/**
 * System prompts for the Ask Your Graph ReAct Search Agent
 * Separated from main agent file for better maintainability
 */

import { listAvailableToolNames } from "./tools/toolsRegistry";
import {
  getPageUidByBlockUid,
  getDateStringFromDnpUid,
} from "../../../utils/roamAPI";
import { dnpUidRegex } from "../../../utils/regex";
import { getEnhancedLimits } from "./helpers/searchUtils";
import { applyLinearContentTruncation } from "./helpers/contentTruncation";

const ROAM_SEARCH_QUICK_DESCRIPTION = `typically this consist of finding blocks and/or pages that meet certain conditions, or requesting specific processing (analysis, summary, reflection, retrieval...) that requires first extracting a set of blocks and/or pages. In Roam, pages have a UID, a title and contain a hierarchical set of blocks. Each block is defined by its UID, its context (children and parents blocks) and a string content where it can reference/mention pages via '[[page references]]', '#tags' or 'attributes::', or reference other blocks via '((block references))'`;

/**
 * Detects if a user query contains a Datomic query that should be executed directly
 */
export const isDatomicQuery = (userQuery: string): boolean => {
  const query = userQuery.toLowerCase().trim();

  // Check for key Datomic patterns
  const hasFindClause = query.includes("[:find") || query.includes("[: find");
  const hasWhereClause = query.includes(":where");

  // Also check for common Datomic variable patterns
  const hasDatomicVariables = /\?\w+/.test(userQuery); // ?variable syntax

  return hasFindClause && hasWhereClause && hasDatomicVariables;
};

/**
 * Extracts the actual Datomic query from user input (removes quotes, code blocks, etc.)
 */
export const extractDatomicQuery = (userQuery: string): string => {
  let query = userQuery.trim();

  // Remove common prefixes like "Execute this query:", "Run:", "Results of:", etc.
  query = query.replace(
    /^(execute|run|results?\s+of|summarize\s+the\s+results?\s+of)\s*(:|\s)\s*/i,
    ""
  );

  // Remove quotes if the query is wrapped in them
  if (
    (query.startsWith('"') && query.endsWith('"')) ||
    (query.startsWith("'") && query.endsWith("'"))
  ) {
    query = query.slice(1, -1);
  }

  // Remove code block markers
  query = query.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "");
  query = query.replace(/^`/, "").replace(/`$/, "");

  // Remove Roam inline query prefix ':q ' if present
  query = query.replace(/^:q\s+/, "");

  // Find the actual Datomic query boundaries
  // Look for [:find or [: find pattern and extract from there to the last ]
  const findMatch = query.match(/(\[:\s*find.*)/i);
  if (findMatch) {
    const fromFind = findMatch[1];

    // Find the last closing bracket that balances the opening bracket
    let bracketCount = 0;
    let lastValidIndex = -1;

    for (let i = 0; i < fromFind.length; i++) {
      if (fromFind[i] === "[") {
        bracketCount++;
      } else if (fromFind[i] === "]") {
        bracketCount--;
        if (bracketCount === 0) {
          lastValidIndex = i;
        }
      }
    }

    if (lastValidIndex !== -1) {
      query = fromFind.substring(0, lastValidIndex + 1);
    } else {
      // If no balanced brackets found, take the whole string from [:find
      query = fromFind;
    }
  }

  return query.trim();
};

/**
 * Builds a specialized system prompt for Datomic query requests
 */
export const buildDatomicQueryPrompt = (state: {
  userQuery: string;
  conversationHistory?: any[];
  conversationSummary?: string;
  permissions: { contentAccess: boolean };
  privateMode: boolean;
}): string => {
  const datomicQuery = extractDatomicQuery(state.userQuery);

  return `You are processing a user request that contains a Datomic query for a Roam Research database.

USER REQUEST: "${state.userQuery}"
DETECTED DATOMIC QUERY: ${datomicQuery}

## ANALYSIS REQUEST DETECTION:

**Your task is to determine if the user wants:**
1. **Direct execution only**: Just run the query and return results
2. **Analysis/Summary**: Execute query AND provide analysis, summary, explanation, or processing of results

**Look for analysis indicators in ANY language:**
- Words meaning: summarize, analyze, explain, describe, count, compare, what, how many, why, etc.
- Questions about the results: "What do these show?", "How many?", "Explain these results"
- Request for insights: "What can you tell me about...", "Give me insights from..."
- Processing requests: "Group by...", "Show patterns...", "Find trends..."

## CRITICAL INSTRUCTIONS:

**RESPOND WITH EXACTLY THIS JSON FORMAT (no explanations or additional text):**

{
  "routingDecision": "direct_datomic",
  "datomicQuery": "${datomicQuery.replace(/"/g, '\\"')}",
  "userIntent": "your analysis of what the user wants (in their language if not English)",
  "needsPostProcessing": true/false (based on your analysis),
  "postProcessingType": "summary"/"analysis"/"count"/"compare"/null (choose appropriate type or null for direct execution),
  "confidence": 1.0
}

**DO NOT:**
- Parse this as a symbolic query
- Convert to search conditions  
- Modify the Datomic query syntax, unless it's requested by the user
- Add any explanatory text

**ALWAYS:**
- Use "routingDecision": "direct_datomic" 
- Include the exact Datomic query
- Set needsPostProcessing: true if user wants analysis/summary of results`;
};

const ROAM_REFERENCES_PARSING = `### Roam Element Parsing (CRITICAL: Only apply ref: prefix when EXPLICITLY formatted as references)
- '[[page title]]': 'ref:page title' (references TO) or 'in:page title' (content WITHIN)
- '#tag' or '#[[long tag]]': 'ref:tag' (references TO)
- 'attribute::': 'ref:attribute' (reference TO)
- '((uid))': 'bref:uid' (direct block reference)

**ATTRIBUTE BLOCKS**: For attribute-value searches (e.g., "author set to Victor Hugo", "books with status completed"):
- Convert to regex patterns: 'regex:/^attribute::.*value.*/i'
- Examples: "author:: Victor Hugo" → 'regex:/^author::.*victor hugo.*/i'
- This matches blocks starting with the attribute key followed by any content containing the value

**ROAM NATIVE QUERY PARSING**: User may provide Roam native queries in these formats:
- '{{[[query]]: logical conditions...}}' or '{{query: logical conditions...}}'
- **CRITICAL**: Ignore the 'query' keyword/page reference - it's just syntax, not a search condition
- **Parse logical conditions**: Convert nested logical structure to symbolic query
- **Key term**: '{search: some text...}' → convert to 'text:some text' condition
- **Example**: '{{[[query]]: {and: {search: productivity} {or: [[project]] [[work]]}}}}' → 'text:productivity + (ref:project | ref:work)'

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
4. **Use parentheses for multiple conditions**: page:(target:(A + B)) for consistency

**Page Search Strategy Priority (use in this order):**
1. **'page:(title:(pattern))'** - PRIMARY: page titles matching pattern (text or regex)
   Use when: "pages about X", "X pages", "find pages with X in title"
2. **'page:(content:(pattern))'** - SECONDARY: page content matching pattern (text/regex/references)
   Use when: "pages containing X", "pages that mention X", "pages with X content"  
3. **'page:(attr:key:type:(value))'** - SPECIFIC: attribute-value metadata searches (essentially content search)
   Use when: "pages of type X", "pages with X property", "pages where attribute Y is Z"
   - 'page:(attr:key:type:(A + B - C))' complex attribute queries with logical operators

**🎯 NEW: Page Search Scope Semantics (CRITICAL for page:(content:(...)) searches)**

**Content-Wide vs Same-Block Search:**
- **'page:(content:(A + B))'** - DEFAULT: Content-wide AND (A in some block, B in same/different block)
- **'page:(block:(A + B))'** - EXPLICIT: Same-block AND (A and B must be in same blocks)

**When to Use Each Scope:**
- **Content-wide scope** (default): "pages discussing A and B", "pages about A and B topics"
  → Conditions can match across different blocks in the same page
- **Same-block scope**: "pages with blocks containing both A and B", "A and B in same context"
  → All conditions must match within individual blocks

**Syntax Examples:**
- "Pages discussing AI and neural networks" → 'page:(content:(text:AI + text:neural networks))' (content-wide)
- "Pages with blocks mentioning both AI and neural networks together" → 'page:(block:(text:AI + text:neural networks))' (same-block)
- "Pages about machine learning or deep learning" → 'page:(content:(text:machine learning | text:deep learning))' (scope doesn't matter for OR)

**Examples:**
- "Pages about status" → 'page:(title:(text:status))' (search titles)
- "Pages containing status" → 'page:(content:(text:status))' (search content)  
- "Pages of type book" → 'page:(attr:type:text:(book))' (attribute search in content)
- "Pages discussing AI and ethics" → 'page:(content:(text:AI + text:ethics))' (content-wide AND)
- "Pages with AI ethics mentioned together" → 'page:(block:(text:AI + text:ethics))' (same-block AND)
- "Pages with AI or ML in title" → 'page:(title:(text:AI | text:ML))' (title search with OR)

**INVALID Examples:**
- 'page:(title:A) + page:(content:B)' ❌ (multiple page operators)
- 'page:status' ❌ (missing title/content/attr specification)
- 'page:(content:A + B)' ❌ (missing inner parentheses for multiple conditions)

### Scope Operators:
- 'in:scope' search WITHIN specific page scope (e.g., in:work, in:dnp, in:attr:title:value)

### Hierarchical Operators:

**STRICT RULES:**
1. **Only ONE hierarchical operator per query** (never combine: text:A <=> text:B > text:C ❌)
2. **Always between TWO conditions** (never dangling: <=> text:A ❌, text:A <=> ❌)  
3. **Higher precedence than +/|** (evaluated before logical operators)

**Operators** (A and B are any condition: text:, ref:, regex:, etc.):
- 'A > B' - direct child (A has direct child B)
- 'A >> B' - deep descendants (A has B somewhere in descendants)
- 'A < B' - direct parent (A has direct parent B)
- 'A << B' - deep ancestors (A has B somewhere in ancestors)
- 'A => B' - flexible hierarchy (A with B in descendants OR same block)
- 'A =>> B' - flexible deep hierarchy (A with B in descendants OR same block)
- 'A <= B' or 'A <<= B' - flexible ascendant hierarchy (or deep hierarchy)
- 'A <=> B' - bidirectional direct (A > B OR B > A)
- 'A <<=>> B' - bidirectional deep hierarchy

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
4. **STRUCTURED FORMAT**: ALWAYS use hierarchyCondition parameter (NOT hierarchicalExpression) - see examples below
5. **COMPLEX LOGIC**: When you have mixed OR/AND with NOT (like (A|B) AND NOT C), or nested groupings like (A+B)|(C-D), ALWAYS use leftConditionGroups/rightConditionGroups instead of simple leftConditions/rightConditions. DETECT: parentheses with different operators inside and outside, OR combined with NOT.

**TOOL EXECUTION PATTERNS:**

**HIERARCHICAL SEARCH (DEFAULT for multi-condition AND queries):**
- 'text:A + text:B' → findBlocksWithHierarchy with hierarchyCondition={operator: '<=>', leftConditions: [...], rightConditions: [...]}
- 'ref:page + text:content' → findBlocksWithHierarchy with hierarchyCondition structure

**AUTOMATIC COMBINATION TESTING (3+ positive AND conditions):**
- The system automatically tests all hierarchical combinations when appropriate
- For simple AND queries converted to hierarchical search, combination testing happens automatically
- No special parameters needed - the system detects this from IntentParser analysis

**COMPLEX LOGIC (mixed OR/AND with NOT - USE GROUPS):**
- '((ref:A | text:B) - text:exclude) > text:C' → findBlocksWithHierarchy with leftConditionGroups/rightConditionGroups
- '(ref:Machine Learning - text:deep) + (ref:AI Fundamentals - text:deep)' → findBlocksWithHierarchy with:
  leftConditionGroups: [{conditions: [{text:"Machine Learning", type:"page_ref", negate:false}, {text:"deep", type:"text", negate:true}], combination:"AND"}]
  rightConditionGroups: [{conditions: [{text:"AI Fundamentals", type:"page_ref", negate:false}, {text:"deep", type:"text", negate:true}], combination:"AND"}]

**WHEN TO USE GROUPS vs SIMPLE:**
- SIMPLE: Pure OR (A|B|C) or pure AND (A+B+C) without parentheses around individual sides
- GROUPS: ANY condition with parentheses containing mixed operators: (A+B), (A-C), (A|B), or multiple logical levels
- **CRITICAL**: Distributed NOT conditions like "(ref:A - text:C) + (ref:B - text:C)" ALWAYS use conditionGroups because each side has mixed positive/negative conditions within parentheses

**🎯 PAGE SEARCH SCOPE (CRITICAL: Parse page:(content:(...)) and page:(block:(...)) syntax)**

**SYNTAX PARSING RULES:**
1. **'page:(content:(...))'** → findPagesByContent with searchScope: "content" (content-wide AND)
2. **'page:(block:(...))'** → findPagesByContent with searchScope: "block" (same-block AND)
3. **Extract conditions from inside the parentheses** and convert to proper tool parameters

**PAGE SEARCH SCOPE EXAMPLES:**
- 'page:(content:(text:A + text:B))' → findPagesByContent with searchScope: "content", combineConditions: "AND"
- 'page:(block:(text:A + text:B))' → findPagesByContent with searchScope: "block", combineConditions: "AND"  
- 'page:(title:(text:keyword))' → findPagesByTitle (no searchScope needed)

**SCOPE SEMANTICS:**
- **searchScope: "content"**: Conditions can match across different blocks in the same page (A in block 1, B in block 2)
- **searchScope: "block"**: All conditions must match within individual blocks (A and B both in same block)

**CORE TOOL SELECTION RULES:**
- **Hierarchical patterns** (A + B, A > B, A <=> B) → findBlocksWithHierarchy
- **Simple conditions** (single term, OR logic) → findBlocksByContent  
- **Same-block override** (depth=0, 'in same block') → findBlocksByContent with depthLimit=0
- **Page searches** → findPagesByTitle or findPagesByContent based on scope

**EXPANSION PATTERNS:**
- 'text:term*' → fuzzy expansion
- 'text:term~' → semantic expansion  
- 'regex:/\\bterm\\b/i' → exact word boundaries`;

// Shared Roam formatting instructions
export const ROAM_FORMATTING_INSTRUCTIONS = `ROAM-SPECIFIC FORMATTING - MANDATORY:
- ALWAYS format page names as [[Page Name]] (double brackets) - NEVER use quotes around page names, user they are not existing

BLOCK EMBEDDING vs REFERENCING:
- For EMBEDDING blocks (shows content + children): Use {{[[embed-path]]: ((block-uid))}}
  * CRITICAL: 'embed-path' is a reserved Roam keyword - use it exactly as shown
  * EMBEDDING RULE: Embedded blocks should always be alone on their line, typically as a sub-bullet
  * Example: "- **Recipe Name**: Description\n  - {{[[embed-path]]: ((block-uid))}}"
- For REFERENCING blocks (just links to the block): Use ((block-uid)) or "source: ((block-uid))"
  * Use references when you just want to cite or link to a block without showing its full content
  * Example: "This recipe is great (source: ((block-uid)))"

FORMATTING RULES:
- NEVER format block content in code blocks (\`\`\` syntax) - use block embeds instead
- NEVER display raw block content - always use embed or reference syntax for blocks
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
  forceHierarchical?: boolean;
  analysisType?: "count" | "compare" | "connections" | "summary";
  language?: string;
  datomicQuery?: string;
  needsPostProcessing?: boolean;
  postProcessingType?: string;
  // Semantic expansion: simplified boolean flag + strategy
  isExpansionGlobal?: boolean;
  semanticExpansion?:
    | "fuzzy"
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
  // Alternative strategies support
  needsAlternativeStrategies?: boolean;
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
  \nSince a Datomic query is provided by the user, use executeDatomicQuery directly${
    state.needsPostProcessing
      ? `, then ${
          state.postProcessingType === "summary"
            ? "provide analysis and summary"
            : "process the results as requested"
        } of the results`
      : ""
  }`
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

## PRECISE TOOL SELECTION PATTERNS:

**TOOL SELECTION REFERENCE:**
- **Single/OR conditions**: findBlocksByContent
- **Multi-condition AND**: findBlocksWithHierarchy (unless depth=0)
- **Page searches**: findPagesByTitle or findPagesByContent (with searchScope)
- **Same-block constraints**: findBlocksByContent with depthLimit=0

**OPERATOR REFERENCE:**
- **<=>** (bidirectional), **>** (parent-child), **=>** (flexible) → findBlocksWithHierarchy
- **+** (AND), **|** (OR), **-** (NOT) → logical operators

**SPECIAL PATTERNS:**
- **Expansion symbols**: 'text:car*' → condition: {text: 'car*', type: 'text'} (preserve symbols exactly)
- **Regex patterns**: 'regex:/pattern/i' → condition: {text: '/pattern/i', type: 'regex'}
- **Page references**: 'ref:title' → condition: {text: 'title', type: 'page_ref'}

## AVAILABLE TOOLS
${toolNames.map((name) => `- ${name}`).join("\n")}

## EXECUTION STRATEGY
1. **Decode Query**: '${state.formalQuery || state.userQuery}' 
2. **Select Tool**: Match pattern above to choose correct tool
3. **Execute**: Transform conditions using exact parameter structure shown

## KEY RULES
- Execute SYMBOLIC QUERY as primary strategy, follow strictly its logic to transform conditions into tool parameters, calling the right tool
- **SEMANTIC EXPANSION TRACKING**: 
  * **CRITICAL: DO NOT expand symbols yourself - tools handle expansion internally**
  * **ALWAYS preserve * and ~ symbols exactly as they appear in formalQuery**
  * **Example**: formalQuery "text:color~" → create condition {text: "color~", type: "text"} (NOT individual colors)
  * **Example**: formalQuery "text:car*" → create condition {text: "car*", type: "text"} (NOT car variations)
  * **Example**: formalQuery "ref:pend*" → create condition {text: "pend*", type: "page_ref"} (NOT page variations)${
    state.isExpansionGlobal && state.semanticExpansion
      ? `\n  * **GLOBAL SEMANTIC EXPANSION**: "${state.semanticExpansion}" strategy will be applied to ALL conditions automatically`
      : `\n  * **NO SEMANTIC EXPANSION**: Do not add semanticExpansion parameter to tool calls unless explicitly instructed above`
  }
- Use 'in:scope' for limitToPages parameter only
- Default to 'summary' result mode for efficiency
- **ZERO RESULTS HANDLING**: If a tool call returns zero results, you MUST either:
  1. Make NEW tool calls with different parameters/approaches, OR
  2. Respond with text stating no results were found and stop searching
  - Do NOT make the same tool calls repeatedly
  - Do NOT respond with just explanations without action${
    state.searchDetails?.timeRange
      ? `\n- **DATE FILTERING**: Results will be automatically filtered by date range ${JSON.stringify(
          state.searchDetails.timeRange
        )} (handled by agent state, do not pass dateRange parameter)`
      : ""
  }

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
${
  state.datomicQuery
    ? `DATOMIC QUERY: ${state.datomicQuery}${
        state.needsPostProcessing
          ? `\n🔄 POST-PROCESSING REQUIRED: After executing the Datomic query, ${
              state.postProcessingType === "summary"
                ? "provide analysis and summary"
                : "process the results as requested"
            } of the results.`
          : ""
      }`
    : ""
}
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
    state.isExpansionGlobal && state.semanticExpansion
      ? `\n  * **GLOBAL SEMANTIC EXPANSION**: "${state.semanticExpansion}" strategy will be applied to ALL conditions automatically`
      : `\n  * **NO SEMANTIC EXPANSION**: Do not add semanticExpansion parameter to tool calls unless explicitly instructed above`
  }
- Chain multi-step queries with intermediate results
- Apply analysis tools when specified
${
  state.searchDetails?.depthLimit === 0
    ? `\n🔒 **CRITICAL OVERRIDE**: User requested depth=0 (same-block search). MUST use findBlocksByContent, NOT findBlocksWithHierarchy.\n`
    : ""
}${
    state.searchDetails?.timeRange
      ? `\n📅 **DATE FILTERING**: Results will be automatically filtered by date range ${JSON.stringify(
          state.searchDetails.timeRange
        )} (handled by agent state, do not pass dateRange parameter)`
      : ""
  }

${
  state.needsAlternativeStrategies
    ? `${buildAlternativeStrategiesGuidance(
        state.userQuery || "",
        state.formalQuery || ""
      )}\n\nRETRY THE SEARCH: Apply the alternative strategies above and search again with modified parameters.`
    : "Execute the complex symbolic query now."
}`;
};

// Alternative strategies guidance when automatic expansion fails
export const buildAlternativeStrategiesGuidance = (
  userQuery: string,
  formalQuery: string
): string => {
  return `
## 🔄 ALTERNATIVE SEARCH STRATEGIES

**CRITICAL: Automatic semantic expansion failed to find results.**

### 🎯 FIRST: RE-EVALUATE THE ORIGINAL USER QUERY

**ORIGINAL USER REQUEST:** "${userQuery}"
**INTERPRETED IN THIS SYMBOLIC QUERY:** "${formalQuery}"

**CRITICAL ANALYSIS REQUIRED:**
1. **Check for over-interpretation**: Did you add conditions that weren't explicitly stated?
2. **Identify meta-comments vs actual search conditions**: User requests often mix:
   - **Search conditions** (what to find): "recipes with sugar"
   - **Meta-comments** (context/explanation): "I want to bake cookies"
   - **Instructions** (what to do with results): "show me the best ones"

3. **Question your current symbolic query**: Is it too complex for the natural language request?

### 🔧 CONSTRAINT RELAXATION STRATEGIES

**PRIORITY 1: Remove Over-Interpreted Conditions**
- Remove conditions that were inferred but not explicitly stated
- Focus only on the core, explicit search terms from the original request

**PRIORITY 2: Convert Strict AND to OR Logic**
- If you used: \`text:(A + B)\` → Try: \`text:(A | B)\`
- If you used: \`ref:pageA + ref:pageB\` → Try: \`ref:(pageA | pageB)\`
- AND is often too restrictive - OR finds more results

**PRIORITY 3: Simplify Complex Conditions**
- Remove secondary/supporting conditions
- Focus on the main concept or primary search term
- Try single-condition searches instead of multi-condition ones

### 🛠️ DIFFERENT TOOL COMBINATIONS

**Try completely different approaches:**
- **Switch tools**, or try **Multi-step approach**
- **Try page searches**: If searching blocks failed, search page titles/content
- **Use extractHierarchyContent**: For broader context discovery
- **Try extractPageReferences**: Find content by what it references
- **Consider multi-step workflow**: Find related content, then narrow down

**Remember**: Better to find something relevant than nothing at all.

### 🛑 WHAT TO DO NEXT

**YOU MUST choose ONE of these actions:**

1. **MAKE NEW TOOL CALLS**: If you have a different approach to try based on the strategies above
   - Use different search terms, conditions, or tools
   - Try simpler queries with relaxed constraints
   - Attempt different tool combinations

2. **STOP SEARCHING**: If you believe the content truly doesn't exist in the database
   - Respond with: "I couldn't find any blocks matching your criteria. The content may not exist in your Roam database."
   - Do NOT make the same tool calls again

**CRITICAL**: Do not respond with just explanations or analysis. Either make new tool calls with different parameters, or clearly state that no results were found and stop searching.
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
    isPopupExecution?: boolean;
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
            securityMode,
            state.isPopupExecution
          )}\n`
        : "";

    // Only log when there's an issue (no results when expected)
    if (!externalContextPrompt && state.isConversationMode) {
      console.log(
        `⚠️ [DirectChat] No results in system prompt - resultStore keys:`,
        state.resultStore ? Object.keys(state.resultStore) : []
      );
    }

    return `You are a helpful AI assistant having a conversation about search results from a Roam Research database.

CONVERSATION CONTEXT:
User Query: ${state.userQuery}

CONVERSATION HISTORY:
${
  state.conversationHistory?.length
    ? state.conversationHistory
        .map((msg) => {
          if (typeof msg === "string") return msg;
          if (msg.role && msg.content) return `${msg.role}: ${msg.content}`;
          return String(msg);
        })
        .join("\n")
    : "No previous conversation"
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
    securityMode,
    state.isPopupExecution
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
    isPopupExecution?: boolean;
  },
  cacheProcessorResponse: string,
  securityMode: "private" | "balanced" | "full"
): string => {
  return `You are generating a final response using cached search results.

USER QUERY: "${state.userQuery}"
CACHE PROCESSOR ANALYSIS: "${cacheProcessorResponse}"

AVAILABLE RESULT DATA:
${extractResultDataForPrompt(
  state.resultStore || {},
  securityMode,
  state.isPopupExecution
)}

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
  securityMode: "private" | "balanced" | "full",
  isPopupExecution?: boolean
): string => {
  if (!resultStore || Object.keys(resultStore).length === 0) {
    return "No result data available.";
  }

  // Debug: Check content lengths before processing
  Object.entries(resultStore).forEach(([key, result]) => {
    if (result.data && Array.isArray(result.data)) {
      result.data.forEach((item: any, i: number) => {
        const content = item.content || item.text || "";
        console.log(
          `📝 [ExtractResultData] ${key}[${i}]: UID=${
            item.uid
          }, content length=${content.length} chars - "${content.substring(
            0,
            100
          )}${content.length > 100 ? "..." : ""}"`
        );
      });
    }
  });

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

  // DEDUPLICATION: Combine all result data and deduplicate by UID, preferring context-expanded items
  const allResultData: any[] = [];
  const seenItems = new Map<string, any>();

  for (const [resultId, result] of relevantEntries) {
    // Extract data from new or legacy structure
    const data = result?.data || result;
    if (!Array.isArray(data) || data.length === 0) continue;

    // Add items to combined list, deduplicating by UID but preferring context-expanded items
    for (const item of data) {
      const itemUid = item.uid || item.pageUid;
      if (itemUid) {
        const existingItem = seenItems.get(itemUid);
        const isContextExpanded =
          item.metadata?.contextExpansion || item.expandedBlock;
        const existingIsExpanded =
          existingItem?.metadata?.contextExpansion ||
          existingItem?.expandedBlock;

        // Keep this item if:
        // - We haven't seen this UID before, OR
        // - This item is context-expanded and the existing one isn't
        if (!existingItem || (isContextExpanded && !existingIsExpanded)) {
          const enrichedItem = {
            ...item,
            sourceResultId: resultId, // Track which tool found this result
          };
          seenItems.set(itemUid, enrichedItem);

          // Update allResultData array
          if (!existingItem) {
            allResultData.push(enrichedItem);
          } else {
            // Replace existing item with context-expanded version
            const index = allResultData.findIndex(
              (existing) => (existing.uid || existing.pageUid) === itemUid
            );
            if (index >= 0) {
              allResultData[index] = enrichedItem;
            }
          }
        }
      }
    }
  }

  // Convert Map values to final array (not needed since we maintain allResultData directly)
  // allResultData is already populated correctly

  console.log(
    `🎯 [ExtractResultData] Deduplicated ${relevantEntries.length} result sets into ${allResultData.length} unique items`
  );

  // Check if context expansion was applied
  const contextExpansionResults = relevantEntries.filter(
    ([, result]) => result?.metadata?.contextExpansion
  );

  const hasContextExpansion = contextExpansionResults.length > 0;
  let contextItems: any[] = [];
  let mainResults: any[] = [];

  if (hasContextExpansion) {
    // Separate context items from main results
    for (const [, result] of relevantEntries) {
      const data = result?.data || [];
      if (!Array.isArray(data) || data.length === 0) continue;

      if (result?.metadata?.contextExpansion) {
        // These are context items (parents/children)
        contextItems.push(
          ...data.map((item) => ({
            ...item,
            isContextItem: true,
          }))
        );
      } else {
        // These are original search results
        mainResults.push(...data);
      }
    }
    console.log(
      `🌳 [ExtractResultData] Context expansion detected: ${mainResults.length} main results + ${contextItems.length} context items`
    );
  }

  // Now process the deduplicated data as a single combined result
  let formattedResults: string[] = [];

  // Skip redundant result formatting in popup execution mode since detailed results are already provided above
  if (isPopupExecution) {
    console.log(
      "🎯 [ExtractResultData] Skipping redundant result formatting for popup execution mode"
    );
    return ""; // Return empty string since detailed results are already included in the conversation context
  }

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
        // UIDs, titles, basic metadata with progressive content limits
        if (data.length > 150) {
          // Apply linear content truncation to stay under 100k chars
          console.log(
            `🎯 [ExtractResultData] Balanced mode: High result count (${data.length}), applying linear truncation (100k char limit)`
          );
          limitedData = applyLinearContentTruncation(data, 100000);
        } else {
          // Use existing progressive limits (context expansion may have been applied for ≤150 results)
          const enhancedLimits = getEnhancedLimits("balanced");
          const contentLimit = enhancedLimits.getContentLimit
            ? enhancedLimits.getContentLimit(data.length)
            : 200;

          limitedData = data.slice(0, 100).map((item) => ({
            uid: item.uid,
            pageUid: item.pageUid, // For extractPageReferences results
            pageTitle: item.pageTitle || item.title,
            count: item.count, // Preserve count for references
            content:
              item.metadata?.contextExpansion || item.expandedBlock
                ? item.content // Context-expanded content is already optimally truncated - use as-is
                : item.content && contentLimit
                ? item.content.substring(0, contentLimit) +
                  (item.content.length > contentLimit ? "..." : "")
                : item.content, // Apply progressive limits only to non-expanded content
          }));

          const expandedCount = data.filter(
            (item) => item.metadata?.contextExpansion || item.expandedBlock
          ).length;

          console.log(
            `🎯 [ExtractResultData] Balanced mode: ${expandedCount} context-expanded items preserved, progressive limit (${
              contentLimit || "full"
            } chars) applied to ${data.length - expandedCount} regular items`
          );
        }
        break;

      case "full":
        // Complete data access for full analysis
        if (data.length > 150) {
          // Apply linear content truncation to stay under 200k chars
          console.log(
            `🎯 [ExtractResultData] Full mode: High result count (${data.length}), applying linear truncation (200k char limit)`
          );
          limitedData = applyLinearContentTruncation(data, 200000);
        } else {
          // Use existing limits (context expansion may have been applied for ≤150 results)
          limitedData = data.slice(0, 200);
        }
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

  // Add transparency messaging about applied limits and context expansion
  const transparencyMessages: string[] = [];

  if (hasContextExpansion && securityMode === "balanced") {
    const contextConfig = contextExpansionResults[0]?.[1]?.metadata?.config;
    const contextDescription = [];

    if (contextConfig?.includeParents) {
      contextDescription.push("parent blocks");
    }
    if (contextConfig?.includeChildren) {
      const depth = contextConfig.maxDepth || 2;
      contextDescription.push(
        `${depth} level${depth > 1 ? "s" : ""} of children`
      );
    }

    if (contextDescription.length > 0) {
      transparencyMessages.push(
        `🌳 **Context Enhancement Applied**: Balanced mode intelligently expanded ${
          mainResults.length
        } core results with ${
          contextItems.length
        } contextual items (${contextDescription.join(
          ", "
        )}) based on content analysis.`
      );
    }
  }

  if (securityMode === "balanced" && allResultData.length > 0) {
    const resultCount = allResultData.length;
    let contentLimitMessage = "";

    if (resultCount < 10) {
      contentLimitMessage = "full content provided";
    } else if (resultCount <= 50) {
      contentLimitMessage = "content limited to 500 characters per result";
    } else {
      contentLimitMessage =
        "content limited to 250 characters per result for efficiency";
    }

    transparencyMessages.push(
      `📊 **Progressive Limits Applied**: Found ${resultCount} results in balanced mode - ${contentLimitMessage}.`
    );
  }

  if (transparencyMessages.length > 0) {
    formattedResults.push(
      "\n---\n**SYSTEM INFO:**\n" + transparencyMessages.join("\n")
    );
  }

  return formattedResults.join("\n\n");
};

// Intent Parser prompt with symbolic language
export const buildIntentParserPrompt = (state: {
  userQuery: string;
  conversationHistory?: any[];
  conversationSummary?: string;
  dateContext?: string;
  permissions: { contentAccess: boolean };
  privateMode: boolean;
  rootUid?: string;
  skipPrivacyAnalysis?: boolean; // Skip privacy mode analysis when privacy mode is forced
}): string => {
  // Pre-check for Datomic queries - if detected, use specialized prompt
  if (isDatomicQuery(state.userQuery)) {
    return buildDatomicQueryPrompt(state);
  }
  // Build date context - use daily note date if rootUid is in a DNP, otherwise use system date
  let referenceDate = new Date();
  let contextNote = "";

  if (state.rootUid) {
    try {
      const pageUid = getPageUidByBlockUid(state.rootUid);
      if (pageUid && dnpUidRegex.test(pageUid)) {
        // We're in a daily note page, use that date as "today"
        const dnpDate = getDateStringFromDnpUid(pageUid);
        if (dnpDate && dnpDate instanceof Date) {
          referenceDate = dnpDate;
          contextNote = " (based on current daily note page)";
        }
      }
    } catch (error) {
      // If there's any error accessing the page, fall back to system date
      console.log(
        "🗓️ [IntentParser] Could not determine daily note context, using system date:",
        error
      );
    }
  }

  const dateStr = referenceDate.toISOString().split("T")[0]; // YYYY-MM-DD format
  const dayName = referenceDate.toLocaleDateString("en-US", {
    weekday: "long",
  });
  const monthName = referenceDate.toLocaleDateString("en-US", {
    month: "long",
  });
  const dateContext = `Today is ${dayName}, ${monthName} ${referenceDate.getDate()}, ${referenceDate.getFullYear()} (${dateStr})${contextNote}`;

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

### **DATE FILTERING MODE DETECTION** → **Detect creation vs modification keywords** (default is "modified", last edited time)
- **Examples**:
  - "blocks created since one month" → timeRange: {..., "filterMode": "created"}
  - "blocks since one week" → timeRange: {..., "filterMode": "modified"} (default)

### **CAREFUL DATE RANGE INTERPRETATION** → **Parse temporal expressions precisely**:
- **Be very careful with natural language date expressions - they have nuanced meanings**. When in doubt, favor the more inclusive interpretation
Examples:
- **"since one month"** = last 30 days from today (rolling window, not calendar month)
- **"during last month"** = previous calendar month only (e.g., if today is Feb 15, means January 1-31)
- **"since last month"** = from start of previous month until today (e.g., if today is Feb 15, means January 1 - February 15)  
- **Consider user's language and cultural context** for date expressions

### Intent Parser Examples (organized by parsing challenge):

**CRITICAL: Never use quotes in symbolic queries - multi-word terms are written without quotes**

**1. OVER-INTERPRETATION PREVENTION:**
- "Find my productivity tips" → 'text:productivity' (NOT 'text:productivity + text:tips')
- "Show me AI research notes" → 'text:AI' (NOT 'text:AI + text:research + text:notes')
- "Blocks about car prices, not motorcycles" → 'text:car + text:price - text:motorcycle'

**2. QUOTED PHRASE HANDLING:**
- "Pages containing 'Live AI' content" → 'page:(content:(text:Live AI))' (quoted phrase = single term)
- "Find blocks with 'machine learning algorithms'" → 'text:machine learning algorithms' (quoted multi-word phrase)

**3. REFERENCE FORMAT PARSING:**
- "[[book]] I want #[[to read]]" → 'ref:book + ref:to read' (also works: 'ref:(book + to read)')
- "important tasks under [[budget planning]]" → '(ref:TODO + text:important) << ref:budget planning'

**3.5. NOT CONDITION HANDLING FOR HIERARCHICAL SEARCHES:**
CRITICAL: For multi-condition AND queries with NOT conditions that will be converted to hierarchical search:

**When forceHierarchical will be TRUE (3+ AND conditions):**
- "Find [[A]] and [[B]] and [[C]] but not [[D]]" → 'ref:A + ref:B + ref:C - ref:D' (keep NOT conditions separate)
- "Blocks with recipe and sugar and spice, but not chocolate" → 'ref:recipe + text:sugar + text:spice - text:chocolate'
- Reason: The combination testing phase will automatically distribute NOT conditions to all tested combinations

**When forceHierarchical will be FALSE (2 AND conditions or explicit hierarchical relationships):**
- "Find [[Machine Learning]] and [[AI Fundamentals]] but not deep learning" → '(ref:Machine Learning - text:deep) + (ref:AI Fundamentals - text:deep)' 
- Reason: Traditional hierarchical searches need explicit NOT distribution since no combination testing occurs

**4. HIERARCHICAL RELATIONSHIPS:**
- "Find my #recipe with sugar in descendants" → 'ref:recipe >> text:sugar'
- "[[book]] notes with justice in main block or descendants" → 'ref:book =>> text:justice'

**5. SCOPE AND EXPANSION:**
- "Blocks about AI in my [[work]] page" → 'in:work + text:AI~' (scope + semantic expansion)
- "Blocks containing words starting with 'work'" → 'text:work*' (fuzzy expansion)

**6. PAGE SEARCH SCOPE DISTINCTIONS:**
- "Pages matching /lib.*/i in their title" → 'page:(title:(regex:/lib.*/i))'
- "Pages discussing AI and machine learning" → 'page:(content:(text:AI + text:machine learning))' (content-wide AND)
- "Pages with AI and ML mentioned together" → 'page:(block:(text:AI + text:ML))' (same-block AND)
- "Pages about AI or ML topics" → 'page:(content:(text:AI | text:machine learning))' (OR logic)

**7. ATTRIBUTE PATTERN CONVERSION:**
- "Blocks with 'author' set to [[Victor Hugo]]" → 'regex:/^author::.*victor hugo.*/i'
- "Pages with status completed or done" → 'regex:/^status::.*(completed|done).*/i'
- "Pages with author Victor Hugo and type book" → 'page:(attr:author:page_ref:Victor Hugo + attr:type:page_ref:book)'

## EXPANSION INTENT DETECTION:

**Critical**: Detect user's expansion preference to apply appropriate search strategies, by interpreting its natural language request.

By default, strict search without expansion will be applied.

**CRITICAL DISTINCTION - Quoted terms vs Explicit exact keywords:**

### **QUOTED PHRASES** → **Keep as single text search terms**:
- **CRITICAL**: When user quotes a multi-word phrase, treat it as a SINGLE search term, do NOT decompose into separate terms
- 'blocks containing "Live AI"' → 'text:Live AI' (single phrase search, NOT text:Live + text:AI)
- 'pages with "machine learning concepts"' → 'text:machine learning concepts' (single phrase)
- 'find "artificial intelligence" discussions' → 'text:artificial intelligence' (single phrase)

### **QUOTED SINGLE WORDS** (casual usage) → **Simple text search**:
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

**CRITICAL**: User requests often mix three different types of content that must be carefully separated:

### 🎯 **CONTENT TYPE IDENTIFICATION:**
1. **Search Conditions** (what to find): "recipes with sugar", "blocks about AI", "pages mentioning productivity"
2. **Meta-Comments** (context/explanation): "I want to bake cookies", "for my research", "I'm writing a report"
3. **Post-Processing Instructions** (what to do with results): "show me the best ones", "summarize them", "count how many"

### ⚠️ **CRITICAL PARSING RULES:**
- **ONLY extract explicit search conditions** - ignore meta-comments and instructions
- **Don't infer conditions from context** unless they're explicitly stated
- **Separate analysis requests** from search conditions (e.g., "best" → analysisType: "compare", not search condition)

### 🔍 **QUESTION-TO-SEARCH CONVERSION:**
When user asks a question without explicit search conditions, infer the **minimum necessary conditions** to find relevant results:

**Examples:**
- "What's the best recipe?" → Search: 'text:recipe', Analysis: compare/evaluate
- "How many tasks do I have?" → Search: 'ref:TODO', Analysis: count  
- "What did I write about AI yesterday?" → Search: 'text:AI', Constraint: timeRange yesterday
- "Which pages mention productivity most?" → Search: 'text:productivity', Analysis: count/rank

### 📏 **CONDITION RESTRAINT PRINCIPLE:**
**When in doubt, prefer FEWER and MORE RELAXED conditions:**
- ✅ **Good**: 'text:recipe' (broad, will find results)
- ❌ **Over-interpretation**: 'text:recipe + text:sugar + text:easy + ref:cooking' (too restrictive)
- **Exception**: Only be strict when user is very explicit and clear about multiple conditions

**Examples of restraint:**
- "I need some productivity tips" → 'text:productivity' (NOT 'text:productivity + text:tips')
- "Find my AI research notes" → 'text:AI' (NOT 'text:AI + text:research + text:notes')
- "Show me recipes I can make quickly" → 'text:recipe' (NOT 'text:recipe + text:quick + text:easy')

### 🎯 **EXPLICIT vs IMPLICIT CONDITIONS:**
- **Explicit**: "Find blocks with AI AND machine learning" → 'text:(AI + machine learning)'
- **Implicit**: "Find blocks about AI research" → 'text:AI' (research is descriptive context, not a required condition)

### Question/Demand Pattern Recognition:
- **Evaluative words** ("best", "worst", "most important", "wrong") → remove from query, add to analysis
- **Quantitative words** ("how many", "count", "total") → 'analyze:count'
- **Comparative words** ("compare", "versus", "difference") → 'analyze:compare'
- **Connection words** ("related to", "connected", "links") → 'analyze:connections'
- **Summary words** ("summarize", "overview", "what about") → 'analyze:summary'

### Search Strategy Selection:
- "direct": Simple single keyword/reference searches
- "hierarchical": **DEFAULT for multi-condition AND queries** (leverages Roam's hierarchical inheritance)

**Note**: Semantic expansion strategies are handled via globalSemanticHint field.

**CRITICAL: Set searchStrategy to "hierarchical" by DEFAULT when:**
- **Multi-condition AND queries** (e.g., "productivity + tools", "ref:recipe + sugar") 
- **Explicit hierarchical operators**: >, =>, <=>, <<=>>
- **Parent-child relationship expressions**
- **Phrases like "X has Y in children", "X contains Y", "Y under X"**

**CRITICAL: Set forceHierarchical to true ONLY when:**
- Converting simple AND queries to hierarchical (not explicitly hierarchical requests)
- Examples: "blocks with A and B and C" → searchStrategy: "hierarchical", forceHierarchical: true
- Counter-examples: "children of A" → searchStrategy: "hierarchical", forceHierarchical: false

**ONLY use "direct" when:**
- Single condition queries (e.g., "text:productivity" alone)
- OR logic queries (e.g., "text:productivity | text:tools")  
- User explicitly requests same-block search (e.g., "depth=0", "same block")

**Examples:**
- "text:productivity + text:tools" → searchStrategy: "hierarchical" (multi-condition AND)
- "text:productivity | text:tools" → searchStrategy: "direct" (OR logic)  
- "text:productivity" → searchStrategy: "direct" (single condition)
- "text:Machine Learning > text:Deep Learning" → searchStrategy: "hierarchical" (explicit hierarchy)

${
  !state.skipPrivacyAnalysis
    ? `
## PRIVACY MODE ANALYSIS

**CRITICAL**: Analyze if the current privacy mode is sufficient for the user's request:

### Current Mode: ${state.privateMode ? "Private" : "Balanced/Full"}
${
  state.privateMode
    ? `**Private Mode Limitations**: Only UIDs returned, no content analysis, no summaries, no insights`
    : `**Current Mode Capabilities**: Can process content for analysis and insights`
}

### Analysis Required:
1. **Does this request need content analysis?** (summarize, analyze, compare, find best, evaluate, etc.)
2. **Does this request need AI insights beyond simple search?** (recommendations, explanations, patterns)
3. **Is simple UID/reference finding sufficient?** (basic search, list results)

### Privacy Escalation Rules:
- **Request needs content analysis + current mode is Private** → suggest "Balanced" or "Full Access"
- **Request needs deep analysis/comparison + current mode is Private/Balanced** → suggest "Full Access"  
- **Simple search requests** → current mode is fine`
    : ""
}

## YOUR TASK

Parse this user request: "${state.userQuery}"

Respond with only valid JSON, no explanations or any additional comment.

## OUTPUT FORMAT (JSON):
{
  "userIntent": "Clear description of what user wants to accomplish",
  "formalQuery": "symbolic query using the operators above (NEVER use quotes around terms)",
  "constraints": {
    "timeRange": null | {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "filterMode": "modified" | "created"},
    "maxResults": null | number,
    "requireRandom": false | true,
    "depthLimit": null
  },
  "searchStrategy": "direct" | "hierarchical",
  "forceHierarchical": false | true,
  "analysisType": null | "count" | "compare" | "connections" | "summary",
  "isExpansionGlobal": false | true,
  "semanticExpansion": null | "fuzzy" | "synonyms" | "related_concepts" | "broader_terms" | "all" | "custom",
  "customSemanticExpansion": null | string,
  "suggestedMode": ${
    !state.skipPrivacyAnalysis ? 'null | "Balanced" | "Full Access"' : "null"
  },
  "language": "detected language in full name (e.g., 'English', 'français', 'español', 'deutsch')",
  "confidence": 0.1-1.0
}

Focus on creating precise symbolic queries that will find the most relevant data to fulfill the user's actual intent.`;
};
