/**
 * Ask Your Graph Tool - Invokes the powerful search agent for complex queries
 *
 * This tool provides access to the full search agent with pattern matching,
 * semantic search, and advanced filtering capabilities. It's slower than
 * simple page/reference tools but much more powerful for complex queries.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const askYourGraphTool = tool(
  async (
    input: {
      query: string;
      reason?: string;
    },
    config
  ): Promise<string> => {
    const { query, reason } = input;

    console.log(
      `🔍 [askYourGraphTool] Executing search agent query: "${query}"`
    );
    if (reason) {
      console.log(`   Reason: ${reason}`);
    }

    console.log("🔍 [askYourGraphTool] Config received:", {
      hasConfig: !!config,
      configType: typeof config,
      hasConfigurable: !!(config as any)?.configurable,
    });

    const configurable = (config as any)?.configurable || {};
    const addResultsCallback = configurable.addResultsCallback;
    const model = configurable.model;

    console.log("🔍 [askYourGraphTool] Configurable contents:", {
      hasAddResultsCallback: !!addResultsCallback,
      hasModel: !!model,
      configurableKeys: Object.keys(configurable),
    });

    if (!addResultsCallback) {
      console.error("❌ [askYourGraphTool] addResultsCallback not found in config");
      console.error("Config object:", config);
      console.error("Configurable object:", configurable);
      return "❌ Error: addResultsCallback not available in tool configuration";
    }

    try {
      // Import the search agent invoke function
      const { invokeSearchAgentSecure } = await import(
        "../../search-agent/ask-your-graph-invoke"
      );

      // Store previous global results to restore them later
      const previousResults = (window as any).lastAskYourGraphResults;
      const previousUserQuery = (window as any).lastUserQuery;
      const previousFormalQuery = (window as any).lastFormalQuery;
      const previousIntentResult = (window as any).lastIntentParserResult;

      const startTime = Date.now();

      // Execute the search agent
      await invokeSearchAgentSecure({
        model: model?.id || "claude-3-5-sonnet-20241022",
        rootUid: "chat-agent-tool",
        targetUid: "chat-agent-tool",
        target: "add", // Always add mode - don't replace existing results
        prompt: query,
        permissions: { contentAccess: false },
        privateMode: true, // Only UIDs, no content processing
        previousAgentState: {
          forcePopupOnly: true, // Results only, no block insertion
        },
      });

      const executionTime = ((Date.now() - startTime) / 1000).toFixed(1);

      // Get results from global state
      const newResults = (window as any).lastAskYourGraphResults || [];
      const intentResult = (window as any).lastIntentParserResult;

      // Get token usage from search agent execution
      const tokensUsed = (window as any).lastAgentTokensUsage || null;

      // Restore previous global state (don't interfere with main popup or recent queries)
      (window as any).lastAskYourGraphResults = previousResults;
      (window as any).lastUserQuery = previousUserQuery;
      (window as any).lastFormalQuery = previousFormalQuery;
      (window as any).lastIntentParserResult = previousIntentResult;

      if (newResults && newResults.length > 0) {
        // Add results via callback (they will be expanded automatically via our expansion mechanism)
        addResultsCallback(newResults);

        const formalQuery = intentResult?.formalQuery || query;

        // Format token usage if available
        const tokenInfo = tokensUsed
          ? ` | 🪙 ${tokensUsed.input_tokens?.toLocaleString() || 0} in / ${tokensUsed.output_tokens?.toLocaleString() || 0} out`
          : "";

        return `**🔍 Search Query Executed**

📝 **Your Query:** "${query}"
🔎 **Formal Query:** "${formalQuery}"
✅ **Results:** ${newResults.length} items added to context
⏱️ **Time:** ${executionTime}s${tokenInfo}

All results have been expanded with their hierarchical context and are ready for analysis.`;
      } else {
        return `ℹ️ Search completed in ${executionTime}s but found no results for query: "${query}"

Consider:
- Broadening your search terms
- Checking spelling and page names
- Using simpler queries
- Trying semantic expansion if available`;
      }
    } catch (error: any) {
      console.error("[askYourGraphTool] Search agent execution failed:", error);
      return `❌ Search agent execution failed: ${error.message || "Unknown error"}

The query "${query}" could not be executed. Try:
- Simplifying the query
- Using add_pages_by_title or add_linked_references_by_title for simpler lookups
- Checking your query syntax`;
    }
  },
  {
    name: "ask_your_graph",
    description: `Execute a complex natural language query against the Roam graph using the full search agent.

This tool is the MOST POWERFUL search capability available, supporting:
- Pattern matching and regex
- Semantic search and concept expansion
- Complex boolean logic (AND, OR, NOT)
- Date ranges and temporal queries
- Block properties and attributes
- Tag and page filtering
- Content analysis and relationships

When to use:
- Complex queries with multiple conditions (e.g., "blocks tagged with #todo created last week containing 'meeting'")
- Pattern-based searches (e.g., "blocks with links to people pages")
- Semantic queries (e.g., "concepts related to machine learning")
- Temporal queries (e.g., "pages modified in the last month")
- When add_pages_by_title and add_linked_references_by_title are insufficient

When NOT to use:
- Simple page lookups → use add_pages_by_title instead
- Simple linked references → use add_linked_references_by_title instead
- This tool is SLOWER - only use for genuinely complex queries

Example queries:
- "blocks containing TODO items from last week"
- "all pages about project management with recent updates"
- "blocks linking to [[John Doe]] that mention meetings"
- "pages tagged with #research created this month"

The results will be added to your current context (not replacing existing results).`,
    schema: z.object({
      query: z
        .string()
        .describe(
          "Natural language query describing what to search for. Be specific and include relevant conditions, time ranges, tags, patterns, etc."
        ),
      reason: z
        .string()
        .optional()
        .describe(
          "Brief explanation of why this complex search is needed (helps with debugging and user transparency)"
        ),
    }),
  }
);
