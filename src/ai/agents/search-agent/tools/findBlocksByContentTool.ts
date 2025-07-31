import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  executeDatomicQuery,
  isDailyNote,
  filterByDateRange,
  createToolResult,
  generateSemanticExpansions,
  getBlockChildren,
  getBlockParents,
  DatomicQueryBuilder,
  SearchCondition,
} from "./searchUtils";
import { dnpUidRegex } from "../../../../utils/regex.js";
import { updateAgentToaster } from "../../shared/agentsUtils";

/**
 * Find blocks by content conditions with semantic expansion and hierarchy support
 * Security Level: Flexible (secure mode = UIDs/metadata only, content mode = includes full content)
 * 
 * This tool searches for blocks by content conditions with support for semantic expansion
 * and hierarchy context. Use secureMode=true to exclude full block content from results.
 */

const contentConditionSchema = z.object({
  type: z.enum(["text", "page_ref", "block_ref", "regex"]).default("text"),
  text: z.string().min(1, "Search text is required"),
  matchType: z.enum(["exact", "contains", "regex"]).default("contains"),
  semanticExpansion: z.boolean().default(false).describe("Only use when few results or user requests semantic search"),
  weight: z.number().min(0).max(10).default(1.0),
  negate: z.boolean().default(false),
});

const schema = z.object({
  conditions: z
    .array(contentConditionSchema)
    .min(1, "At least one condition is required"),
  combineConditions: z.enum(["AND", "OR"]).default("AND"),
  maxExpansions: z.number().min(1).max(10).default(3),
  expansionStrategy: z
    .enum(["synonyms", "related_concepts", "broader_terms"])
    .default("related_concepts"),
  includeChildren: z.boolean().default(false).describe("Include child blocks (expensive for large result sets - only use when exploring specific blocks)"),
  childDepth: z.number().min(1).max(5).default(2),
  includeParents: z.boolean().default(false).describe("Include parent blocks (expensive - only use when exploring specific blocks)"),
  parentDepth: z.number().min(1).max(3).default(1),
  includeDaily: z.boolean().default(true),
  dailyNotesOnly: z.boolean().default(false).describe("Search ONLY in daily notes (overrides includeDaily when true)"),
  dateRange: z
    .object({
      start: z.union([z.date(), z.string()]).optional(),
      end: z.union([z.date(), z.string()]).optional(),
    })
    .optional(),
  sortBy: z.enum(["relevance", "recent", "page_title"]).default("relevance"),
  limit: z.number().min(1).max(1000).default(100),
  
  // Result modes for controlling data transfer
  resultMode: z.enum(["full", "summary", "uids_only"]).default("summary").describe("full=all data, summary=essential fields only, uids_only=just UIDs and basic metadata"),
  summaryLimit: z.number().min(1).max(50).default(20).describe("Maximum results to return in summary mode to prevent token bloat"),
  
  // Security mode
  secureMode: z.boolean().default(false).describe("If true, excludes full block content from results (UIDs and metadata only)"),
  
  // User query exclusion
  userQuery: z.string().optional().describe("The original user query to exclude from results"),
  
  // Page scope limitation
  limitToPages: z.array(z.string()).optional().describe("Limit search to blocks within specific pages (by exact page title). Use for 'in page [[X]]' queries.")
});

const findBlocksByContentImpl = async (input: z.infer<typeof schema>) => {
  console.log(`🔧 findBlocksByContentImpl input:`, input);
  const {
    conditions,
    combineConditions,
    maxExpansions,
    expansionStrategy,
    includeChildren,
    childDepth,
    includeParents,
    parentDepth,
    includeDaily,
    dailyNotesOnly,
    sortBy,
    limit,
    resultMode,
    summaryLimit,
    secureMode,
    userQuery,
    limitToPages,
  } = input;

  // Parse dateRange if provided as strings
  let parsedDateRange;
  console.log(`🔧 input.dateRange:`, input.dateRange);
  if (input.dateRange && (input.dateRange.start || input.dateRange.end)) {
    parsedDateRange = {
      start: typeof input.dateRange.start === 'string' ? new Date(input.dateRange.start) : input.dateRange.start,
      end: typeof input.dateRange.end === 'string' ? new Date(input.dateRange.end) : input.dateRange.end,
    };
    console.log(`🔧 parsedDateRange created:`, parsedDateRange);
  } else {
    console.log(`🔧 No valid dateRange provided, parsedDateRange remains undefined`);
  }

  // Step 1: Process conditions with semantic expansion if needed
  const expandedConditions = await expandConditions(
    conditions,
    expansionStrategy,
    maxExpansions
  );

  const hasExpansions = expandedConditions.length > conditions.length;
  if (hasExpansions) {
    updateAgentToaster(`🔍 Expanding search with related terms...`);
  }

  console.log(
    `🔍 Searching with ${expandedConditions.length} total conditions (${conditions.length} original + expansions)`
  );

  // Step 2: Build and execute search query
  
  const searchResults = await searchBlocksWithConditions(
    expandedConditions,
    combineConditions,
    includeDaily,
    dailyNotesOnly,
    limitToPages
  );

  console.log(`📊 Found ${searchResults.length} matching blocks`);

  // Step 3: Smart hierarchy enrichment optimization
  let optimizedIncludeChildren = includeChildren;
  let optimizedIncludeParents = includeParents;
  let enrichedResults: any[];
  
  // Optimization: Skip expensive hierarchy enrichment for large result sets unless explicitly needed
  if (searchResults.length > 100) {
    if (includeChildren && !userQuery?.match(/context|hierarchy|structure|children|explore/i)) {
      console.log(`⚡ Optimization: Skipping children enrichment for ${searchResults.length} results (use includeChildren=false for large analytical queries)`);
      optimizedIncludeChildren = false;
    }
    if (includeParents && !userQuery?.match(/context|hierarchy|structure|parents|explore/i)) {
      console.log(`⚡ Optimization: Skipping parents enrichment for ${searchResults.length} results`);
      optimizedIncludeParents = false;
    }
  }
  
  // Step 3: Only call enrichWithHierarchy if we actually need hierarchy data
  if (optimizedIncludeChildren || optimizedIncludeParents) {
    console.log(`🔧 About to enrich ${searchResults.length} results with hierarchy context (children: ${optimizedIncludeChildren}, parents: ${optimizedIncludeParents})`);
    updateAgentToaster(`🔗 Adding context to ${searchResults.length} results...`);
    
    enrichedResults = await enrichWithHierarchy(
      searchResults,
      optimizedIncludeChildren,
      childDepth,
      optimizedIncludeParents,
      parentDepth,
      secureMode
    );
    console.log(`🔧 Enrichment completed, got ${enrichedResults.length} enriched results`);
  } else {
    // Fast path: Create basic block structure without expensive hierarchy queries
    console.log(`⚡ Fast path: Creating basic block structure for ${searchResults.length} results without hierarchy enrichment`);
    
    enrichedResults = searchResults.map(([uid, content, time, pageTitle, pageUid]) => ({
      uid,
      content: secureMode ? undefined : content,
      created: new Date(time),
      modified: new Date(time),
      pageTitle,
      pageUid,
      isDaily: isDailyNote(pageUid),
      children: [],
      parents: [],
    }));
    console.log(`⚡ Fast path completed for ${enrichedResults.length} results`);
  }

  // Step 4: Apply date range filtering for DNPs if specified
  let filteredResults = enrichedResults;
  console.log(`🔧 About to apply date filtering. parsedDateRange:`, parsedDateRange, `includeDaily:`, includeDaily);
  if (parsedDateRange && includeDaily) {
    console.log(`🔧 Applying date range filter to ${enrichedResults.length} results`);
    filteredResults = filterByDateRange(filteredResults, parsedDateRange);
    console.log(`🔧 After date filtering: ${filteredResults.length} results`);
  } else {
    console.log(`🔧 Skipping date filtering`);
  }

  // Step 4.5: Exclude user query block from results
  if (userQuery) {
    const beforeUserQueryFilter = filteredResults.length;
    filteredResults = filteredResults.filter(result => {
      // Exclude blocks whose content exactly matches the user query
      return result.content !== userQuery;
    });
    if (beforeUserQueryFilter !== filteredResults.length) {
      console.log(`🔧 Excluded user query block, ${beforeUserQueryFilter} -> ${filteredResults.length} results`);
    }
  }

  // Step 5: Sort results
  console.log(`🔧 Before sorting: ${filteredResults.length} results`);
  filteredResults = sortResults(filteredResults, sortBy, conditions);
  console.log(`🔧 After sorting: ${filteredResults.length} results`);

  // Step 6: Apply result mode and limiting
  let finalResults = filteredResults;
  let wasLimited = false;
  let originalCount = filteredResults.length;

  // Store full results in console for power users, even when truncated for LLM
  if (filteredResults.length > 10) {
    console.log(`📊 FULL RESULTS FOR CONSOLE (${filteredResults.length} items):`, {
      totalCount: filteredResults.length,
      results: filteredResults.map(r => ({
        uid: r.uid,
        content: r.content?.substring(0, 200) + (r.content?.length > 200 ? "..." : ""),
        pageTitle: r.pageTitle,
        pageUid: r.pageUid,
        modified: r.modified,
      })),
      truncatedForLLM: resultMode !== "full",
      resultMode,
    });
  }

  // Apply smart limiting based on result mode  
  // CRITICAL SAFEGUARDS: Always enforce limits to prevent 120k+ token costs
  console.log(`🔧 Limiting check: mode=${resultMode}, results=${finalResults.length}, limit=${limit}, summaryLimit=${summaryLimit}`);
  if (resultMode === "summary" && finalResults.length > summaryLimit) {
    console.log(`⚡ Summary mode: Limiting ${finalResults.length} results to ${summaryLimit} to prevent token bloat`);
    updateAgentToaster(`⚡ Showing top ${summaryLimit} of ${finalResults.length} results`);
    finalResults = finalResults.slice(0, summaryLimit);
    wasLimited = true;
  } else if (resultMode === "uids_only" && finalResults.length > 100) {
    // Force UIDs mode to max 100 results to prevent token bloat
    console.log(`⚡ UIDs mode: Limiting ${finalResults.length} results to 100 to prevent bloat`);
    updateAgentToaster(`⚡ Limiting to 100 of ${finalResults.length} results for analysis`);
    finalResults = finalResults.slice(0, 100);
    wasLimited = true;
  } else if (resultMode === "full" && finalResults.length > 300) {
    // EMERGENCY SAFEGUARD: Full mode should NEVER return unlimited results
    console.log(`🚨 EMERGENCY LIMIT: Full mode limiting ${finalResults.length} results to 300 to prevent massive token cost`);
    updateAgentToaster(`🚨 Showing first 300 of ${finalResults.length} results (maximum allowed)`);
    finalResults = finalResults.slice(0, 300);
    wasLimited = true;
  } else if (finalResults.length > limit) {
    updateAgentToaster(`⚡ Showing top ${limit} of ${finalResults.length} results`);
    finalResults = finalResults.slice(0, limit);
    wasLimited = true;
  }
  
  // FINAL SAFEGUARD: Any result set > 200 should be marked as limited for caching
  if (finalResults.length > 200 && !wasLimited) {
    console.log(`🚨 FINAL SAFEGUARD: Marking ${finalResults.length} results as limited for caching`);
    wasLimited = true;
  }

  // Format results based on result mode
  if (resultMode === "uids_only") {
    console.log(`⚡ UIDs only mode: Returning minimal data for ${finalResults.length} results`);
    finalResults = finalResults.map(result => ({
      uid: result.uid,
      pageTitle: result.pageTitle,
      pageUid: result.pageUid,
      isDaily: result.isDaily,
      modified: result.modified,
    }));
  } else if (resultMode === "summary") {
    console.log(`⚡ Summary mode: Returning essential data for ${finalResults.length} results`);
    finalResults = finalResults.map(result => ({
      uid: result.uid,
      content: secureMode ? undefined : (result.content?.length > 100 ? result.content.substring(0, 100) + "..." : result.content),
      pageTitle: result.pageTitle,
      pageUid: result.pageUid,
      isDaily: result.isDaily,
      modified: result.modified,
      // Exclude children/parents in summary mode to save tokens
    }));
  }
  // For "full" mode, return complete results as-is

  // Add metadata about truncation for agent awareness
  const resultMetadata = {
    resultMode,
    returnedCount: finalResults.length,
    totalFound: originalCount,
    wasLimited,
    canExpandResults: wasLimited && resultMode !== "full",
  };

  console.log(`🔧 Final results (${resultMode} mode): ${finalResults.length}/${originalCount} items`, resultMetadata);
  
  return {
    results: finalResults,
    metadata: resultMetadata,
  };
};


/**
 * Expand search conditions with semantic terms using LLM
 */
const expandConditions = async (
  conditions: z.infer<typeof contentConditionSchema>[],
  strategy: string,
  maxExpansions: number
): Promise<z.infer<typeof contentConditionSchema>[]> => {
  const expandedConditions = [...conditions];

  for (const condition of conditions) {
    if (condition.semanticExpansion) {
      try {
        const expansionTerms = await generateSemanticExpansions(
          condition.text,
          strategy as any,
          maxExpansions
        );

        // Add expanded conditions
        for (const term of expansionTerms) {
          expandedConditions.push({
            text: term,
            matchType: condition.matchType,
            semanticExpansion: false, // Don't expand expansions
            weight: condition.weight * 0.8, // Lower weight for expansions
            negate: condition.negate,
          });
        }
      } catch (error) {
        console.warn(`Failed to expand condition "${condition.text}":`, error);
      }
    }
  }

  return expandedConditions;
};

/**
 * Search blocks with conditions using Datomic queries
 */
const searchBlocksWithConditions = async (
  conditions: z.infer<typeof contentConditionSchema>[],
  combineLogic: "AND" | "OR",
  includeDaily: boolean,
  dailyNotesOnly: boolean = false,
  limitToPages?: string[]
): Promise<any[]> => {
  // Build base query for all blocks
  let query = `[:find ?uid ?content ?time ?page-title ?page-uid
                :where 
                [?b :block/uid ?uid]
                [?b :block/string ?content]
                [?b :block/page ?page]
                [?page :node/title ?page-title]
                [?page :block/uid ?page-uid]
                [?b :edit/time ?time]`;

  // Add page scope limitation if specified
  if (limitToPages && limitToPages.length > 0) {
    if (limitToPages.length === 1) {
      query += `\n                [?page :node/title "${limitToPages[0]}"]`;
    } else {
      const orClauses = limitToPages.map(page => `[?page :node/title "${page}"]`);
      query += `\n                (or ${orClauses.join(' ')})`;
    }
  }

  // Add DNP filtering logic
  if (dailyNotesOnly) {
    // Search ONLY in daily notes
    query += `\n                [(re-pattern "${dnpUidRegex.source.slice(
      1,
      -1
    )}") ?dnp-pattern]
                [(re-find ?dnp-pattern ?page-uid)]`;
  } else if (!includeDaily) {
    // Exclude daily notes
    query += `\n                [(re-pattern "${dnpUidRegex.source.slice(
      1,
      -1
    )}") ?dnp-pattern]
                (not [(re-find ?dnp-pattern ?page-uid)])`;
  }

  // Add condition matching using shared query builder
  const searchConditions: SearchCondition[] = conditions.map(cond => ({
    type: cond.type as any,
    text: cond.text,
    matchType: cond.matchType as any,
    semanticExpansion: cond.semanticExpansion,
    weight: cond.weight,
    negate: cond.negate,
  }));

  const queryBuilder = new DatomicQueryBuilder(searchConditions, combineLogic);
  const { patternDefinitions, conditionClauses } = queryBuilder.buildConditionClauses("?content");
  
  query += patternDefinitions;
  query += conditionClauses;

  query += `]`;

  console.log("🔍 Executing block search query...");
  return await executeDatomicQuery(query);
};

/**
 * Build a condition clause for the query (legacy function for AND logic)
 */
const buildConditionClause = (
  condition: z.infer<typeof contentConditionSchema>,
  index: number,
  isInOr: boolean = false
): string => {
  const indent = isInOr ? "                  " : "                ";
  let clause = "";

  switch (condition.type) {
    case "page_ref":
      // Use proper Roam :block/refs attribute instead of regex
      clause = `\n${indent}[?ref-page${index} :node/title "${condition.text}"]
${indent}[?b :block/refs ?ref-page${index}]`;
      break;

    case "block_ref":
      // Use proper Roam :block/refs attribute for block references
      clause = `\n${indent}[?ref-block${index} :block/uid "${condition.text}"]
${indent}[?b :block/refs ?ref-block${index}]`;
      break;

    case "regex":
      clause = `\n${indent}[(re-pattern "${condition.text}") ?pattern${index}]
${indent}[(re-find ?pattern${index} ?content)]`;
      break;

    case "text":
    default:
      if (condition.matchType === "exact") {
        clause = `\n${indent}[(= ?content "${condition.text}")]`;
      } else if (condition.matchType === "regex") {
        clause = `\n${indent}[(re-pattern "${condition.text}") ?pattern${index}]
${indent}[(re-find ?pattern${index} ?content)]`;
      } else {
        // Use case-insensitive regex without problematic escape characters
        // Remove any special regex characters to prevent escape issues
        const cleanText = condition.text.replace(/[.*+?^${}()|[\]\\]/g, '');
        if (cleanText === condition.text) {
          // No special characters, can use regex safely
          clause = `\n${indent}[(re-pattern "(?i).*${condition.text}.*") ?pattern${index}]
${indent}[(re-find ?pattern${index} ?content)]`;
        } else {
          // Has special characters, use case-sensitive includes as fallback
          clause = `\n${indent}[(clojure.string/includes? ?content "${condition.text}")]`;
        }
      }
      break;
  }

  // Apply negation if needed
  if (condition.negate) {
    clause = `\n${indent}(not ${clause.trim()})`;
  }

  return clause;
};

/**
 * Enrich results with hierarchy context (children and parents)
 */
const enrichWithHierarchy = async (
  results: any[],
  includeChildren: boolean,
  childDepth: number,
  includeParents: boolean,
  parentDepth: number,
  secureMode: boolean = false
): Promise<any[]> => {
  console.log(`🔧 enrichWithHierarchy: Processing ${results.length} results`);
  const enrichedResults: any[] = [];

  for (const [uid, content, time, pageTitle, pageUid] of results) {
    const blockResult = {
      uid,
      content: secureMode ? undefined : content,
      created: new Date(time),
      modified: new Date(time),
      pageTitle,
      pageUid,
      isDaily: isDailyNote(pageUid),
      children: [],
      parents: [],
    };

    // Get children if requested
    if (includeChildren) {
      blockResult.children = await getBlockChildren(uid, childDepth, secureMode);
    }

    // Get parents if requested
    if (includeParents) {
      blockResult.parents = await getBlockParents(uid, parentDepth, secureMode);
    }

    enrichedResults.push(blockResult);
    console.log(`🔧 enrichWithHierarchy: Added block ${uid}, total: ${enrichedResults.length}`);
  }

  console.log(`🔧 enrichWithHierarchy: Returning ${enrichedResults.length} enriched results`);
  return enrichedResults;
};

/**
 * Sort results by the specified criteria
 */
const sortResults = (
  results: any[],
  sortBy: string,
  originalConditions: z.infer<typeof contentConditionSchema>[]
): any[] => {
  return results.sort((a, b) => {
    switch (sortBy) {
      case "recent":
        return b.modified.getTime() - a.modified.getTime();

      case "page_title":
        return a.pageTitle.localeCompare(b.pageTitle);

      case "relevance":
      default:
        // Calculate relevance score based on exact matches to original conditions
        const scoreA = calculateRelevanceScore(a, originalConditions);
        const scoreB = calculateRelevanceScore(b, originalConditions);

        if (scoreA !== scoreB) {
          return scoreB - scoreA; // Higher score first
        }

        // Tie-breaker: modification time
        return b.modified.getTime() - a.modified.getTime();
    }
  });
};

/**
 * Calculate relevance score for a block result
 */
const calculateRelevanceScore = (
  result: any,
  conditions: z.infer<typeof contentConditionSchema>[]
): number => {
  let score = 0;
  const content = result.content.toLowerCase();

  for (const condition of conditions) {
    const text = condition.text.toLowerCase();
    const weight = condition.weight;

    if (condition.matchType === "exact" && content === text) {
      score += 10 * weight;
    } else if (content.includes(text)) {
      // Boost score for exact word matches vs partial matches
      const exactWordMatch = new RegExp(
        `\\b${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`
      ).test(content);
      score += exactWordMatch ? 5 * weight : 2 * weight;
    }
  }

  return score;
};

export const findBlocksByContentTool = tool(
  async (input) => {
    const startTime = performance.now();
    try {
      const { results, metadata } = await findBlocksByContentImpl(input);
      return createToolResult(
        true,
        results,
        undefined,
        "findBlocksByContent",
        startTime,
        metadata
      );
    } catch (error) {
      console.error("FindBlocksByContent tool error:", error);
      return createToolResult(
        false,
        undefined,
        error.message,
        "findBlocksByContent",
        startTime
      );
    }
  },
  {
    name: "findBlocksByContent",
    description:
      "Find blocks by content using direct literal search with multiple conditions and AND/OR logic. Supports text search, page references [[Page]], block references ((uid)), regex patterns. Use semanticExpansion=true only when initial search returns few results or user requests semantic/related search. RESULT MODES: Use resultMode='summary' (default, max 20 results) for analytical queries to prevent token bloat, 'uids_only' for just UIDs when feeding other tools, 'full' only when user explicitly needs comprehensive results. For analytical queries, use includeChildren=false and includeParents=false for performance.",
    schema,
  }
);
