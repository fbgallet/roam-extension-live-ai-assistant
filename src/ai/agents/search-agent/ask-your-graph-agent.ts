import {
  MessagesAnnotation,
  StateGraph,
  START,
  Annotation,
} from "@langchain/langgraph/web";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  LlmInfos,
  modelViaLanggraph,
  TokensUsage,
} from "../langraphModelsLoader";
import { StructuredOutputType } from "@langchain/core/language_models/base";
import { createChildBlock } from "../../../utils/roamAPI";
import { insertStructuredAIResponse } from "../../responseInsertion";
import { chatRoles, getInstantAssistantRole, defaultModel } from "../../..";
import { modelAccordingToProvider } from "../../aiAPIsHub";
import {
  updateAgentToaster,
  getAgentToasterStream,
  parseJSONWithFields,
} from "../shared/agentsUtils";

// Import our tools registry
import {
  getAvailableTools,
  listAvailableToolNames,
} from "./tools/toolsRegistry";

const ReactSearchAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  model: Annotation<LlmInfos>,
  rootUid: Annotation<string>,
  targetUid: Annotation<string>,
  userQuery: Annotation<string>,
  searchTools: Annotation<any[]>,
  // Conversation state
  conversationHistory: Annotation<any[]>,
  conversationSummary: Annotation<string | undefined>,
  isConversationMode: Annotation<boolean>,
  // Permissions
  permissions: Annotation<{ contentAccess: boolean }>,
  privateMode: Annotation<boolean>, // Strict Private mode - only UIDs, no content processing
  // Results tracking and caching (following MCP agent pattern)
  toolResults: Annotation<Record<string, any>>,
  toolResultsCache: Annotation<Record<string, any>>, // Cache for comprehensive follow-ups
  cachedFullResults: Annotation<Record<string, any>>, // Store full results even when truncated for LLM
  hasLimitedResults: Annotation<boolean>, // Flag to indicate results were truncated
  finalAnswer: Annotation<string | undefined>,
  // Request analysis and routing
  routingDecision: Annotation<"use_cache" | "need_new_search">,
  reformulatedQuery: Annotation<string | undefined>,
  originalSearchContext: Annotation<string | undefined>,
  // Timing and cancellation
  startTime: Annotation<number>,
  abortSignal: Annotation<AbortSignal | undefined>,
});

// Global variables for the agent
let llm: StructuredOutputType;
let turnTokensUsage: TokensUsage;
let searchTools: any[] = [];

// Initialize and get all available tools
const initializeTools = (permissions: { contentAccess: boolean }) => {
  // Get tools based on permissions using the registry
  searchTools = getAvailableTools(permissions);

  console.log(
    `🔧 Initialized ${searchTools.length} tools:`,
    listAvailableToolNames(permissions)
  );

  return searchTools;
};

// Shared Roam formatting instructions
const ROAM_FORMATTING_INSTRUCTIONS = `ROAM-SPECIFIC FORMATTING - MANDATORY:
- ALWAYS format page names as [[Page Name]] (double brackets) - NEVER use quotes around page names, user they are not existing
- When referencing specific blocks found in results, ALWAYS embed them using: {{[[embed-path]]: ((block-uid))}}
- NEVER format block content in code blocks (\`\`\` syntax) - use block embeds instead
- NEVER display raw block content - always use the embed syntax for blocks, unless you are just quoting a very small part of this block content on purpose
- Use Roam-compatible markdown syntax throughout your response
- RESPECT USER LANGUAGE: Always respond in the same language as the user's request`;

// Clean system prompt for the ReAct agent (no conversation history or cache handling)
const buildSystemPrompt = (
  state: typeof ReactSearchAgentState.State
): string => {
  const toolNames = listAvailableToolNames(state.permissions);
  const availableTools = toolNames
    .map((name) => `- ${name}: Available for searching`)
    .join("\n");

  // Private mode instructions
  const privateModeInstructions = state.privateMode
    ? `

🔒 PRIVATE MODE - CRITICAL INSTRUCTIONS:
- You are in STRICT PRIVATE MODE - you must NEVER process or analyze block content
- Your ONLY job is to find matching blocks and return their UIDs
- ALWAYS use resultMode='uids_only' in ALL tool calls
- NEVER read block content or provide summaries/analysis
- Your final response must be ONLY a list of block UIDs in this format ([[embed-path]] is a Roam native syntax, let it exactly as it is!). If page names are available (and if there is multiple source pages), regroup blocks under their page name:
  "Found [N] matching blocks:
  - [N] blocks on [[page name A]]:
   - {{[[embed-path]]: ((uid1))}}
   - {{[[embed-path]]: ((uid2))}}
  - [N] blocks on [[page name B]]:
   - {{[[embed-path]]: ((uid3))}}"
- Do NOT provide any analysis, explanation, or content processing
- The user will see the actual content via the embed syntax

`
    : "";

  return `You are a ReAct agent helping users search their Roam Research database. You can reason about what the user wants and use appropriate tools to find the information.${privateModeInstructions}

AVAILABLE TOOLS:
${availableTools}

CAPABILITIES:
- Use tools to search for pages and blocks in the user's Roam graph
- Interpret logical symbols and operators in search queries
- Combine results from multiple tools if needed
- Provide clear, helpful answers based on search results
- Ask for clarification if the query is ambiguous

LOGICAL SYMBOLS INTERPRETATION:
You can interpret these symbols in user queries:
- '&' or 'AND' = intersection (both conditions must match)
- '|' or 'OR' = union (either condition can match)
- '-' or 'NOT' (before a term) = exclusion (must not match)
- '+' = emphasis (must be included)
- '[]' = page references [[Page Name]]
- '()' = block references ((block-uid))
- '*' = fuzzy/wildcard search
- '~' = semantic expansion (find related concepts)

ROAM REFERENCE PATTERNS - CRITICAL PARSING RULES:
When you see these patterns in user queries, treat them as page references (type: "page_ref"):

🚨 MANDATORY PARSING EXAMPLES:
- #test → type: "page_ref", text: "test" (REMOVE the # symbol)
- #[[long tag name]] → type: "page_ref", text: "long tag name" (REMOVE # and brackets)
- [[page name]] → type: "page_ref", text: "page name" (REMOVE brackets)
- attribute:: → type: "page_ref", text: "attribute" (also search for "attribute::" as text)
- plain_word → type: "text", text: "plain_word" (regular text search)

⚠️ CRITICAL: ALL # patterns are page references, NOT text searches (unless explicitly requested otherwise by the user or if they are between backticks)
⚠️ ALWAYS remove # and [] symbols from the text value!

WRONG: #test → type: "page_ref", text: "#test"
CORRECT: #test → type: "page_ref", text: "test"

PAGE SCOPE vs PAGE REFERENCE DISTINCTION:
- "in page [[X]], find Y" → Use findBlocksByContent with limitToPages=["X"] and text conditions for Y (search WITHIN page)
- "find Y that mentions [[X]]" → Use findBlocksByContent with page_ref condition for X (search FOR page references)
- For complex page-scoped queries → Use generateDatomicQuery with executeQuery=true and limitToPages

INSTRUCTIONS:
1. Parse the user's query for logical symbols and convert them to appropriate tool parameters
2. Choose the most appropriate tool(s) to find the information
3. Use AND/OR logic with multiple conditions when symbols are present
4. Use semantic expansion when ~ symbol is detected OR when initial searches return few/no results
5. Use the tools step by step, reasoning about the results
6. Provide a helpful response based on what you find
7. If the user query contains guidance from cache analysis, use that guidance to focus your search

SEARCH STRATEGY:
- ALWAYS start with direct, literal searches (semanticExpansion: false)
- Only use semantic expansion (semanticExpansion: true) when:
  * User explicitly uses ~ symbol for semantic search
  * Initial direct search returns fewer than 3-5 results
  * User asks for "related" or "similar" content
- Use findPagesSemantically tool ONLY when user specifically wants semantic/conceptual search
- For most queries, use findBlocksByContent or findPagesByTitle with semanticExpansion: false
- Prefer exact matches over expanded terms
- Try simpler tools before complex ones

COMPLEX OR QUERY FALLBACK STRATEGY:
When OR queries fail or for very complex multi-condition searches:
1. Break into multiple simpler searches (without OR)
2. Use combineResults tool to union/intersection the results
3. Example: Instead of "A OR B OR C", do three searches then combine
- Search 1: find blocks with "A" 
- Search 2: find blocks with "B"
- Search 3: find blocks with "C" 
- Use combineResults with operation="union" to merge all results

HIERARCHY OPTIMIZATION:
- For ANALYTICAL queries (statistics, counts, "most mentioned", "which pages", etc.), set includeChildren=false and includeParents=false to avoid expensive processing
- For EXPLORATORY queries (user wants to see context, relationships, explore specific blocks), use includeChildren=true
- When expecting large result sets (>100 blocks), default to includeChildren=false unless user specifically needs context
- Only include hierarchy when the user actually needs to see the block structure and relationships

ANALYTICAL WORKFLOW:
- For analytical queries like "most mentioned pages", "page reference counts", etc.:
  1. First use findBlocksByContent with includeChildren=false, includeParents=false, resultMode='uids_only' to get block UIDs efficiently
  2. Then use extractPageReferences tool with the block UIDs to get page reference counts efficiently
  3. This avoids processing thousands of blocks in the LLM context and uses fast database queries instead

RESULT MODE SELECTION - COST PROTECTION:
- ALWAYS use resultMode='summary' (max 20 results) as DEFAULT to prevent token bloat
- Use resultMode='uids_only' ONLY when feeding results to other tools (extractPageReferences, etc.) - limited to 100 UIDs
- Use resultMode='full' ONLY when user explicitly needs comprehensive results - limited to 300 results max
- CRITICAL: Never allow unlimited results that could cost 120k+ tokens

${ROAM_FORMATTING_INSTRUCTIONS}

Remember:
- Start with simple, direct searches before trying complex approaches
- When logical symbols are used, respect the intended logic structure
- If no results are found, then suggest alternative search strategies or semantic expansion
- Format all responses in Roam-compatible markdown with proper page and block references
- Be concise but helpful in your responses
- When providing summary results (due to limits), offer to provide more comprehensive results if the user wants them`;
};

// Request analysis system prompt
const buildRequestAnalysisPrompt = (
  state: typeof ReactSearchAgentState.State
): string => {
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
      const cached = state.cachedFullResults[key];
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
  "originalSearchContext": "Original search topic if using cache, null otherwise",
  "reasoning": "Brief explanation of your decision"
}

CRITICAL: Your response must contain ONLY the JSON object above. Do not add any explanatory text, observations, or comments before or after the JSON.

Examples:
- User: "show me more details" after searching "test" → {"decision": "use_cache", "reformulatedQuery": "Show comprehensive details about test", "originalSearchContext": "test"}
- User: "what about distribute justice" after searching "justice and equality" → {"decision": "use_cache", "reformulatedQuery": "Find specific information about distributive justice (justice par répartition) from justice and equality results", "originalSearchContext": "justice et égalité"}
- User: "find information about cats" → {"decision": "need_new_search", "reformulatedQuery": "find information about cats", "originalSearchContext": null}`;
};

// Nodes
const requestAnalyzer = async (state: typeof ReactSearchAgentState.State) => {
  console.log(`🧠 [RequestAnalyzer] Analyzing request: "${state.userQuery}"`);
  console.log(
    `🧠 [RequestAnalyzer] Conversation mode: ${
      state.isConversationMode
    }, Cached results: ${Object.keys(state.cachedFullResults || {}).length}`
  );

  // Skip analysis if not in conversation mode or no cached results
  if (
    !state.isConversationMode ||
    !Object.keys(state.cachedFullResults || {}).length
  ) {
    console.log(
      `🧠 [RequestAnalyzer] → Routing to NEW SEARCH (no conversation or cache)`
    );
    return {
      routingDecision: "need_new_search" as const,
      reformulatedQuery: state.userQuery,
      originalSearchContext: undefined,
    };
  }

  updateAgentToaster("🧠 Analyzing your request...");

  const analysisPrompt = buildRequestAnalysisPrompt(state);
  const analysisLlm = modelViaLanggraph(state.model, turnTokensUsage);

  try {
    const response = await analysisLlm.invoke([
      new SystemMessage({ content: analysisPrompt }),
      new HumanMessage({ content: state.userQuery }),
    ]);

    const responseContent = response.content.toString();

    // Use shared JSON parsing with field mappings
    const analysis = parseJSONWithFields<{
      decision: "use_cache" | "need_new_search";
      reformulatedQuery: string;
      originalSearchContext: string | null;
      reasoning: string;
    }>(responseContent, {
      decision: ["decision"],
      reformulatedQuery: ["reformulatedQuery", "reformulated_query", "query"],
      originalSearchContext: [
        "originalSearchContext",
        "original_search_context",
        "context",
      ],
      reasoning: ["reasoning", "reason"],
    });

    if (!analysis) {
      console.warn(
        "Failed to parse analysis response, defaulting to new search"
      );
      return {
        routingDecision: "need_new_search" as const,
        reformulatedQuery: state.userQuery,
        originalSearchContext: undefined,
      };
    }

    console.log(
      `🧠 [RequestAnalyzer] Decision: ${analysis.decision}, Reformulated: "${analysis.reformulatedQuery}"`
    );
    console.log(
      `🧠 [RequestAnalyzer] → Routing to ${
        analysis.decision === "use_cache" ? "CACHE PROCESSOR" : "NEW SEARCH"
      }`
    );

    return {
      routingDecision: analysis.decision as "use_cache" | "need_new_search",
      reformulatedQuery: analysis.reformulatedQuery || state.userQuery,
      originalSearchContext: analysis.originalSearchContext,
    };
  } catch (error) {
    console.error("Request analysis failed:", error);
    // Fallback to new search on error
    return {
      routingDecision: "need_new_search" as const,
      reformulatedQuery: state.userQuery,
      originalSearchContext: undefined,
    };
  }
};

const cacheProcessor = async (state: typeof ReactSearchAgentState.State) => {
  console.log(
    `💾 [CacheProcessor] Processing request: "${
      state.reformulatedQuery || state.userQuery
    }"`
  );
  console.log(
    `💾 [CacheProcessor] Available cached results: ${
      Object.keys(state.cachedFullResults || {}).length
    }`
  );
  updateAgentToaster("💾 Processing cached results...");

  // In Private mode, don't process cached content - route to new search
  if (state.privateMode) {
    console.log(
      `💾 [CacheProcessor] → Routing to NEW SEARCH (Private mode - no cache processing)`
    );
    return {
      routingDecision: "need_new_search" as const,
      messages: [new HumanMessage(state.reformulatedQuery || state.userQuery)],
    };
  }

  // Build system prompt for cache processing
  const cacheProcessingPrompt = `You are processing a user request using cached search results. Your job is to:

1. Analyze the cached search results to answer the user's request
2. Determine if the cached results are sufficient or if additional searches are needed
3. Provide a comprehensive response based on the available data

USER REQUEST: "${state.reformulatedQuery || state.userQuery}"
ORIGINAL SEARCH CONTEXT: "${state.originalSearchContext || "unknown"}"

AVAILABLE CACHED RESULTS:
${Object.entries(state.cachedFullResults || {})
  .map(([, cached]) => {
    const results = cached.fullResults;
    return `
Tool: ${cached.toolName}
Original Query: "${cached.userQuery}"
Complete Results:
${JSON.stringify(results, null, 2)}
`;
  })
  .join("\n---\n")}

INSTRUCTIONS:
1. If the cached results contain sufficient information to answer the user's request completely, provide a comprehensive response
2. If the cached results are insufficient, provide simple guidance for what additional information is needed

For SUFFICIENT cache, respond directly with your complete answer.

For INSUFFICIENT cache, respond with:
"INSUFFICIENT_CACHE: [brief explanation]

ADDITIONAL_INFO_NEEDED:
- [Natural language description of what to search for]
- [Another thing that needs to be found]

SPECIFIC_TARGETS: [if applicable]
- Block UIDs: uid1, uid2...
- Page titles: "Page Name 1", "Page Name 2"...
"

Example:
"INSUFFICIENT_CACHE: Need more details about the implementation methods

ADDITIONAL_INFO_NEEDED:
- Get full content of the implementation blocks mentioned in results
- Search for examples or usage patterns of these methods

SPECIFIC_TARGETS:
- Block UIDs: ((abc123)), ((def456))
- Page titles: "Implementation Guide", "Usage Examples"
"

${ROAM_FORMATTING_INSTRUCTIONS}
- If providing comprehensive results, mention these are from previous searches
- Focus on the user's specific request`;

  try {
    const cacheProcessingLlm = modelViaLanggraph(state.model, turnTokensUsage);
    const response = await cacheProcessingLlm.invoke([
      new SystemMessage({ content: cacheProcessingPrompt }),
      new HumanMessage({ content: state.reformulatedQuery || state.userQuery }),
    ]);

    const responseContent = response.content.toString();

    // Check if cache was insufficient
    if (responseContent.startsWith("INSUFFICIENT_CACHE:")) {
      console.log(
        `💾 [CacheProcessor] → Routing to NEW SEARCH (cache insufficient)`
      );
      console.log(
        `💾 [CacheProcessor] Guidance provided: ${responseContent.substring(
          0,
          100
        )}...`
      );

      // Pass the guidance to ReAct assistant
      const enhancedQuery =
        (state.reformulatedQuery || state.userQuery) + "\n\n" + responseContent;

      return {
        routingDecision: "need_new_search" as const,
        messages: [new HumanMessage(enhancedQuery)],
      };
    }

    // Cache was sufficient, prepare final response
    console.log(`💾 [CacheProcessor] → FINAL RESPONSE (cache sufficient)`);
    return {
      messages: [...state.messages, response],
      finalAnswer: responseContent,
    };
  } catch (error) {
    console.error("Cache processing failed:", error);
    // Fallback to new search on error
    return {
      routingDecision: "need_new_search" as const,
      messages: [new HumanMessage(state.reformulatedQuery || state.userQuery)],
    };
  }
};

const loadModel = async (state: typeof ReactSearchAgentState.State) => {
  const startTime = state.startTime || Date.now();

  // Initialize LLM
  llm = modelViaLanggraph(state.model, turnTokensUsage);

  // Set default permissions (secure level only unless specified)
  const permissions = state.permissions || { contentAccess: false };

  // Initialize tools based on permissions
  const tools = initializeTools(permissions);

  return {
    searchTools: tools,
    startTime,
    permissions,
    privateMode: state.privateMode || false,
    // Preserve existing cached state if it exists, otherwise initialize empty
    toolResults: state.toolResults || {},
    toolResultsCache: state.toolResultsCache || {},
    cachedFullResults: state.cachedFullResults || {},
    hasLimitedResults: state.hasLimitedResults || false,
  };
};

const assistant = async (state: typeof ReactSearchAgentState.State) => {
  // Check for cancellation
  if (state.abortSignal?.aborted) {
    throw new Error("Operation cancelled by user");
  }

  // Tools are already filtered by permissions in loadModel
  const llm_with_tools = llm.bindTools(state.searchTools);

  // Build clean system prompt
  const systemPrompt = buildSystemPrompt(state);

  // Add user query exclusion instruction
  const contextInstructions = `

CRITICAL INSTRUCTION: 
When using findBlocksByContent, always include userQuery parameter set to: "${state.userQuery}" to exclude the user's request block from results.`;

  // Combine system prompt with context instructions
  const combinedSystemPrompt = systemPrompt + contextInstructions;
  const sys_msg = new SystemMessage({ content: combinedSystemPrompt });

  updateAgentToaster("🤖 Understanding your request...");

  const messages = [sys_msg, ...state.messages];
  const llmStartTime = Date.now();

  // Check for cancellation before LLM call
  if (state.abortSignal?.aborted) {
    throw new Error("Operation cancelled by user");
  }

  // Create a promise that will reject if aborted
  const abortPromise = new Promise((_, reject) => {
    if (state.abortSignal) {
      const abortHandler = () =>
        reject(new Error("Operation cancelled by user"));
      state.abortSignal.addEventListener("abort", abortHandler, { once: true });
    }
  });

  // Race between the LLM call and the abort signal
  const response = await Promise.race([
    llm_with_tools.invoke(messages),
    abortPromise,
  ]);

  const llmDuration = ((Date.now() - llmStartTime) / 1000).toFixed(1);

  if (response.tool_calls && response.tool_calls.length > 0) {
    // Generate user-friendly explanations for tool calls
    const toolExplanations = response.tool_calls.map((tc: any) => {
      const toolName = tc.name;
      const args = tc.args || {};

      // Generate brief, user-friendly explanations based on tool and arguments
      switch (toolName) {
        case "findBlocksByContent":
          if (args.conditions && Array.isArray(args.conditions)) {
            const searchTerms = args.conditions.map((c: any) => {
              if (c.type === "page_ref") {
                // For display, show page_ref as [[text]] (the text should already be clean without # or [])
                return `[[${c.text}]]`;
              }
              if (c.type === "text") return `"${c.text}"`;
              return `"${c.text}"`;
            });
            const combineLogic =
              args.combineConditions === "OR" ? " OR " : " AND ";
            return `searching for ${searchTerms.join(combineLogic)} in blocks`;
          }
          const searchText =
            args.conditions?.find((c: any) => c.type === "text")?.text ||
            args.conditions?.find((c: any) => c.type === "page_ref")
              ?.pageTitle ||
            "content";
          return `searching for "${searchText}" in blocks`;

        case "findPagesByContent":
          if (args.conditions && Array.isArray(args.conditions)) {
            const searchTerms = args.conditions.map((c: any) => {
              if (c.type === "page_ref") {
                // For display, show page_ref as [[text]] (the text should already be clean without # or [])
                return `[[${c.text}]]`;
              }
              if (c.type === "text") return `"${c.text}"`;
              return `"${c.text}"`;
            });
            const combineLogic =
              args.combineConditions === "OR" ? " OR " : " AND ";
            return `searching pages containing ${searchTerms.join(
              combineLogic
            )}`;
          }
          const pageSearchText = args.searchText || args.query || "content";
          return `searching pages containing "${pageSearchText}"`;

        case "findPagesByTitle":
          return `looking for pages titled "${
            args.pageTitle || args.searchText || "pages"
          }"`;

        case "findPagesSemantically":
          return `finding pages related to "${args.query || "concept"}"`;

        case "extractPageReferences":
          const blockCount = Array.isArray(args.blockUids)
            ? args.blockUids.length
            : "some";
          return `analyzing ${blockCount} blocks for page references`;

        case "getPageContent":
          return `retrieving content from "${args.pageTitle || "page"}"`;

        case "getBlockContent":
          return `getting block content and context`;

        default:
          return `using ${toolName.replace(/([A-Z])/g, " $1").toLowerCase()}`;
      }
    });

    const explanation =
      toolExplanations.length === 1
        ? toolExplanations[0]
        : `${toolExplanations.length} searches: ${toolExplanations.join(", ")}`;

    updateAgentToaster(`🔍 ${explanation} (${llmDuration}s)`);
  } else {
    updateAgentToaster(`✅ Analysis complete (${llmDuration}s)`);
  }

  return {
    messages: [...state.messages, response],
  };
};

const toolsWithResults = async (state: typeof ReactSearchAgentState.State) => {
  // Check for cancellation
  if (state.abortSignal?.aborted) {
    throw new Error("Operation cancelled by user");
  }

  // Don't overwrite the LLM-generated tool explanation from assistant function
  const toolNode = new ToolNode(state.searchTools);

  try {
    const toolStartTime = Date.now();

    // Check for cancellation before tool execution
    if (state.abortSignal?.aborted) {
      throw new Error("Operation cancelled by user");
    }

    // Create abort promise for tool execution
    const abortPromise = new Promise((_, reject) => {
      if (state.abortSignal) {
        const abortHandler = () =>
          reject(new Error("Operation cancelled by user"));
        state.abortSignal.addEventListener("abort", abortHandler, {
          once: true,
        });
      }
    });

    // Race between tool execution and abort signal
    const result = await Promise.race([toolNode.invoke(state), abortPromise]);

    // Track tool results for potential reuse (following MCP agent pattern)
    const toolMessages = result.messages.filter(
      (msg: any) => msg._getType() === "tool"
    );

    const toolDuration = ((Date.now() - toolStartTime) / 1000).toFixed(1);

    // Count actual results from tool responses, not just tool calls
    let totalResults = 0;
    toolMessages.forEach((msg: any) => {
      try {
        const parsed = JSON.parse(msg.content);

        if (parsed.data && Array.isArray(parsed.data)) {
          totalResults += parsed.data.length;
        } else if (parsed.metadata?.returnedCount) {
          totalResults += parsed.metadata.returnedCount;
        } else if (parsed.success && parsed.data) {
          totalResults += 1; // Single result
        }
      } catch (e) {
        totalResults += 1; // Fallback for non-JSON content
      }
    });

    const resultText = totalResults === 1 ? "result" : "results";
    updateAgentToaster(
      `✅ Found ${totalResults} ${resultText} (${toolDuration}s)`
    );

    const updatedResults = { ...state.toolResults };
    const updatedCache = { ...state.toolResultsCache };
    const updatedFullResults = { ...state.cachedFullResults };
    let hasLimitedResults = state.hasLimitedResults;

    // Process each tool result
    toolMessages.forEach((msg: any) => {
      if (msg.tool_call_id && msg.content) {
        try {
          const parsed = JSON.parse(msg.content);

          // Store in regular results
          updatedResults[msg.tool_call_id] = {
            content: msg.content,
            timestamp: Date.now(),
            tool_name: msg.name,
          };

          // Cache results for comprehensive follow-ups (MCP pattern)
          updatedCache[msg.tool_call_id] = {
            content: msg.content,
            timestamp: Date.now(),
            tool_name: msg.name,
            type: "tool",
          };

          // Cache all results for potential follow-ups (not just limited ones)
          if (
            parsed.data &&
            Array.isArray(parsed.data) &&
            parsed.data.length > 0
          ) {
            const totalFound =
              parsed.metadata?.totalFound || parsed.data.length;
            console.log(
              `💾 [Caching] Storing ${totalFound} results for follow-up (tool: ${msg.name})`
            );
            updatedFullResults[`${msg.name}_${Date.now()}`] = {
              toolName: msg.name,
              fullResults: parsed,
              userQuery: state.userQuery,
              timestamp: Date.now(),
              canExpand: parsed.metadata?.canExpandResults || false,
            };

            // Mark as limited only if explicitly limited
            if (parsed.metadata?.wasLimited) {
              hasLimitedResults = true;
            }
          }
        } catch (e) {
          // Store raw content even if not JSON
          updatedResults[msg.tool_call_id] = {
            content: msg.content,
            timestamp: Date.now(),
            tool_name: msg.name,
          };
        }
      }
    });

    return {
      ...result,
      toolResults: updatedResults,
      toolResultsCache: updatedCache,
      cachedFullResults: updatedFullResults,
      hasLimitedResults,
    };
  } catch (error) {
    console.error("🔧 Tool execution error:", error);
    updateAgentToaster("❌ Search failed - please try again");
    throw error;
  }
};

const insertResponse = async (state: typeof ReactSearchAgentState.State) => {
  const lastMessage: string = state.messages.at(-1).content.toString();

  updateAgentToaster("📝 Preparing your results...");

  // Calculate total execution time
  if (state.startTime) {
    const totalDuration = ((Date.now() - state.startTime) / 1000).toFixed(1);
    console.log(`⏱️ Total ReAct search time: ${totalDuration}s`);
  }

  const assistantRole = state.model.id
    ? getInstantAssistantRole(state.model.id)
    : chatRoles?.assistant || "";

  // Create response block
  const targetUid = await createChildBlock(state.rootUid, assistantRole);

  await insertStructuredAIResponse({
    targetUid,
    content: lastMessage,
    forceInChildren: true,
  });

  console.log("✅ ReAct Search Agent completed");

  return {
    targetUid,
    finalAnswer: lastMessage,
    // Return cached results for conversation continuity (MCP pattern)
    toolResultsCache: state.toolResultsCache,
    cachedFullResults: state.cachedFullResults,
    hasLimitedResults: state.hasLimitedResults,
  };
};

// Edges
const shouldContinue = (state: typeof ReactSearchAgentState.State) => {
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

// Routing logic for request analysis
const routeAfterAnalysis = (state: typeof ReactSearchAgentState.State) => {
  const route =
    state.routingDecision === "use_cache" ? "cacheProcessor" : "assistant";
  console.log(`🔀 [Graph] RequestAnalyzer → ${route.toUpperCase()}`);
  return route;
};

// Routing logic for cache processor
const routeAfterCache = (state: typeof ReactSearchAgentState.State) => {
  // If cache processor set routingDecision to need_new_search, go to assistant
  if (state.routingDecision === "need_new_search") {
    console.log(`🔀 [Graph] CacheProcessor → ASSISTANT (cache insufficient)`);
    return "assistant";
  }
  // Otherwise, cache was sufficient, go directly to insertResponse
  console.log(`🔀 [Graph] CacheProcessor → INSERT RESPONSE (cache sufficient)`);
  return "insertResponse";
};

// Build the ReAct Search Agent graph
const builder = new StateGraph(ReactSearchAgentState);
builder
  .addNode("loadModel", loadModel)
  .addNode("requestAnalyzer", requestAnalyzer)
  .addNode("cacheProcessor", cacheProcessor)
  .addNode("assistant", assistant)
  .addNode("tools", toolsWithResults)
  .addNode("insertResponse", insertResponse)

  .addEdge(START, "loadModel")
  .addEdge("loadModel", "requestAnalyzer")
  .addConditionalEdges("requestAnalyzer", routeAfterAnalysis)
  .addConditionalEdges("cacheProcessor", routeAfterCache)
  .addConditionalEdges("assistant", shouldContinue)
  .addEdge("tools", "assistant")
  .addEdge("insertResponse", "__end__");

export const ReactSearchAgent = builder.compile();

// NOTE: Invoke functions are in ask-your-graph-invoke.ts
// This file contains only the core ReAct agent implementation
