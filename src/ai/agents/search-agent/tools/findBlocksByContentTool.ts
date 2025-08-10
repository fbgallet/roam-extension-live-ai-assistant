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
  processEnhancedResults,
  getEnhancedLimits,
  fuzzyMatch,
  extractUidsFromResults,
} from "./searchUtils";
import { dnpUidRegex } from "../../../../utils/regex.js";
import { updateAgentToaster } from "../../shared/agentsUtils";

// Extract user-requested limit from query (e.g., "2 random results", "first 5 pages", "show me 10 blocks")
const extractUserRequestedLimit = (userQuery: string): number | null => {
  const query = userQuery.toLowerCase();
  
  // Pattern 1: "N results", "N random results", "N pages", "N blocks"
  const numberResultsMatch = query.match(/(\d+)\s+(random\s+)?(results?|pages?|blocks?)/);
  if (numberResultsMatch) {
    const num = parseInt(numberResultsMatch[1], 10);
    if (num > 0 && num <= 500) { // Reasonable bounds
      return num;
    }
  }
  
  // Pattern 2: "first N", "top N", "show me N"
  const firstNMatch = query.match(/(first|top|show me)\s+(\d+)/);
  if (firstNMatch) {
    const num = parseInt(firstNMatch[2], 10);
    if (num > 0 && num <= 500) {
      return num;
    }
  }
  
  // Pattern 3: "limit to N", "max N", "up to N"
  const limitMatch = query.match(/(limit to|max|up to)\s+(\d+)/);
  if (limitMatch) {
    const num = parseInt(limitMatch[2], 10);
    if (num > 0 && num <= 500) {
      return num;
    }
  }
  
  return null; // No specific limit found
};

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
  // Enhanced sorting and sampling options
  sortBy: z.enum(["relevance", "creation", "modification", "alphabetical", "random"]).default("relevance"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  limit: z.number().min(1).max(50000).default(500), // Increased default and max limits
  
  // Random sampling for large datasets
  randomSample: z.object({
    enabled: z.boolean().default(false),
    size: z.number().min(1).max(10000).default(100),
    seed: z.number().optional().describe("Seed for reproducible random sampling")
  }).optional(),
  
  // Result modes for controlling data transfer
  resultMode: z.enum(["full", "summary", "uids_only"]).default("summary").describe("full=all data, summary=essential fields only, uids_only=just UIDs and basic metadata"),
  summaryLimit: z.number().min(1).max(50).default(20).describe("Maximum results to return in summary mode to prevent token bloat"),
  
  // Security mode
  secureMode: z.boolean().default(false).describe("If true, excludes full block content from results (UIDs and metadata only)"),
  
  // Result lifecycle management
  purpose: z.enum(["final", "intermediate", "replacement", "completion"]).optional()
    .describe("Purpose: 'final' for user response data, 'intermediate' for exploration, 'replacement' to replace previous results, 'completion' to add to previous results"),
  replacesResultId: z.string().optional()
    .describe("If purpose is 'replacement', specify which result ID to replace (e.g., 'findBlocksByContent_001')"),
  completesResultId: z.string().optional() 
    .describe("If purpose is 'completion', specify which result ID this completes (e.g., 'findPagesByTitle_002')"),
  
  // User query exclusion
  userQuery: z.string().optional().describe("The original user query to exclude from results"),
  
  // Page scope limitation
  limitToPages: z.array(z.string()).optional().describe("Limit search to blocks within specific pages (by exact page title). Use for 'in page [[X]]' queries."),
  
  // UID-based filtering for optimization
  fromResultId: z.string().optional().describe("Limit search to blocks/pages from previous result (e.g., 'findBlocksByContent_001'). Dramatically improves performance for large databases."),
  limitToBlockUids: z.array(z.string()).optional().describe("Limit search to specific block UIDs (user-provided list)"),
  limitToPageUids: z.array(z.string()).optional().describe("Limit search to blocks within specific page UIDs"),
  
  // Fuzzy matching for typos and approximate matches
  fuzzyMatching: z.boolean().default(false).describe("Enable typo tolerance and approximate matching for search terms"),
  fuzzyThreshold: z.number().min(0).max(1).default(0.8).describe("Similarity threshold for fuzzy matches (0=exact, 1=very loose)")
});

// Minimal LLM-facing schema - only essential user-controllable parameters
const llmFacingSchema = z.object({
  conditions: z.array(z.object({
    text: z.string().min(1, "Search text is required"),
    type: z.enum(["text", "page_ref", "block_ref", "regex"]).default("text").describe("text=content search, page_ref=[[page]] reference, regex=pattern matching"),
    matchType: z.enum(["exact", "contains", "regex"]).default("contains").describe("contains=phrase within block, exact=entire block matches"),
    negate: z.boolean().default(false).describe("Exclude blocks matching this condition")
  })).min(1, "At least one search condition required"),
  combineConditions: z.enum(["AND", "OR"]).default("AND").describe("AND=all conditions must match, OR=any condition matches"),
  includeChildren: z.boolean().default(false).describe("Include child blocks in results (use sparingly for performance)"),
  includeParents: z.boolean().default(false).describe("Include parent blocks for context"),
  limitToPages: z.array(z.string()).optional().describe("Search only within these specific pages (by exact title)"),
  fromResultId: z.string().optional().describe("Limit to results from previous search (e.g., 'findBlocksByContent_001') - major performance boost"),
  limitToBlockUids: z.array(z.string()).optional().describe("Limit to specific block UIDs"),
  limitToPageUids: z.array(z.string()).optional().describe("Limit to blocks within specific page UIDs"),
  fuzzyMatching: z.boolean().default(false).describe("Enable typo tolerance and approximate matching")
});

const findBlocksByContentImpl = async (input: z.infer<typeof schema>, state?: any) => {
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
    sortOrder,
    limit,
    randomSample,
    resultMode,
    summaryLimit,
    secureMode,
    userQuery,
    limitToPages,
    fromResultId,
    limitToBlockUids,
    limitToPageUids,
    fuzzyMatching,
    fuzzyThreshold,
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

  // UID-based filtering for optimization
  const { blockUids: finalBlockUids, pageUids: finalPageUids } = extractUidsFromResults(
    fromResultId,
    limitToBlockUids,
    limitToPageUids,
    state
  );

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
    limitToPages,
    finalBlockUids.length > 0 ? finalBlockUids : undefined,
    finalPageUids.length > 0 ? finalPageUids : undefined
  );

  console.log(`📊 Found ${searchResults.length} matching blocks`);

  // Step 2.5: Apply fuzzy matching post-processing if enabled
  let fuzzyFilteredResults = searchResults;
  if (fuzzyMatching && fuzzyThreshold && conditions.length > 0) {
    console.log(`🔍 Applying fuzzy matching with threshold ${fuzzyThreshold}`);
    fuzzyFilteredResults = applyFuzzyFiltering(
      searchResults,
      conditions,
      fuzzyThreshold || 0.8
    );
    console.log(`📊 After fuzzy filtering: ${fuzzyFilteredResults.length} blocks`);
  }

  // Step 3: Smart hierarchy enrichment optimization
  let optimizedIncludeChildren = includeChildren;
  let optimizedIncludeParents = includeParents;
  let enrichedResults: any[];
  
  // Optimization: Skip expensive hierarchy enrichment for large result sets unless explicitly needed
  if (fuzzyFilteredResults.length > 100) {
    if (includeChildren && !userQuery?.match(/context|hierarchy|structure|children|explore/i)) {
      console.log(`⚡ Optimization: Skipping children enrichment for ${fuzzyFilteredResults.length} results (use includeChildren=false for large analytical queries)`);
      optimizedIncludeChildren = false;
    }
    if (includeParents && !userQuery?.match(/context|hierarchy|structure|parents|explore/i)) {
      console.log(`⚡ Optimization: Skipping parents enrichment for ${fuzzyFilteredResults.length} results`);
      optimizedIncludeParents = false;
    }
  }
  
  // Step 3: Only call enrichWithHierarchy if we actually need hierarchy data
  if (optimizedIncludeChildren || optimizedIncludeParents) {
    console.log(`🔧 About to enrich ${fuzzyFilteredResults.length} results with hierarchy context (children: ${optimizedIncludeChildren}, parents: ${optimizedIncludeParents})`);
    updateAgentToaster(`🔗 Adding context to ${fuzzyFilteredResults.length} results...`);
    
    enrichedResults = await enrichWithHierarchy(
      fuzzyFilteredResults,
      optimizedIncludeChildren,
      childDepth,
      optimizedIncludeParents,
      parentDepth,
      secureMode
    );
    console.log(`🔧 Enrichment completed, got ${enrichedResults.length} enriched results`);
  } else {
    // Fast path: Create basic block structure without expensive hierarchy queries
    console.log(`⚡ Fast path: Creating basic block structure for ${fuzzyFilteredResults.length} results without hierarchy enrichment`);
    
    enrichedResults = fuzzyFilteredResults.map(([uid, content, time, pageTitle, pageUid]) => ({
      uid,
      content: secureMode ? undefined : content,
      created: new Date(time),
      modified: new Date(time),
      pageTitle,
      pageUid,
      isDaily: isDailyNote(pageUid),
      children: [],
      parents: [],
      // Explicit type flag (isPage: false means it's a block)
      isPage: false
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
    console.log(`🔧 Attempting to exclude user query: "${userQuery}"`);
    filteredResults = filteredResults.filter(result => {
      // More flexible exclusion - check for exact match OR if the block contains the query and is similar length
      const exactMatch = result.content === userQuery;
      const containsAndSimilar = result.content && result.content.includes(userQuery) && 
                                Math.abs(result.content.length - userQuery.length) < 50;
      const shouldExclude = exactMatch || containsAndSimilar;
      
      if (shouldExclude) {
        console.log(`🔧 Excluding block ${result.uid}: "${result.content?.substring(0, 100)}..."`);
      }
      
      return !shouldExclude;
    });
    if (beforeUserQueryFilter !== filteredResults.length) {
      console.log(`🔧 Excluded user query block(s), ${beforeUserQueryFilter} -> ${filteredResults.length} results`);
    } else {
      console.log(`🔧 No user query blocks found to exclude`);
    }
  } else {
    console.log(`🔧 No userQuery provided for exclusion`);
  }

  // Step 5: Apply enhanced sorting, sampling, and limiting
  console.log(`🔧 Before enhanced processing: ${filteredResults.length} results`);
  
  // Determine security mode for limits
  const securityMode = secureMode ? "private" : (resultMode === "full" ? "full" : "balanced");
  
  const processedResults = processEnhancedResults(filteredResults, {
    sortBy: sortBy as any, // Type is already validated by schema
    sortOrder,
    limit,
    randomSample: randomSample ? {
      enabled: randomSample.enabled || false,
      size: randomSample.size || 100,
      seed: randomSample.seed
    } : undefined,
    securityMode
  });
  
  let finalResults = processedResults.data;
  let wasLimited = processedResults.metadata.wasLimited;
  let originalCount = processedResults.metadata.totalFound;
  
  console.log(`🔧 After enhanced processing: ${finalResults.length} results (sorted by ${processedResults.metadata.sortedBy}${processedResults.metadata.sampled ? ', sampled' : ''})`);

  // Step 6: Apply result mode filtering

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
  
  // Extract user-requested limit from query before applying tool defaults
  const userRequestedLimit = extractUserRequestedLimit(userQuery || "");
  
  // CRITICAL DISTINCTION: 
  // - User-requested limits: Always respected (user asked for specific number)
  // - Summary mode limits: Only for LLM processing, not for Full Results storage
  // - Full Results should get up to 500 results, display gets limited later
  
  if (userRequestedLimit) {
    // User specifically requested a certain number - respect it completely
    console.log(`🔧 User requested ${userRequestedLimit} results - applying strict limit`);
    finalResults = finalResults.slice(0, userRequestedLimit);
    wasLimited = finalResults.length < originalCount;
  } else if (resultMode === "summary" && finalResults.length > 500) {
    // Summary mode: Allow up to 500 for Full Results popup, but warn about costs
    console.log(`⚡ Summary mode: Limiting ${finalResults.length} results to 500 for storage (Full Results popup support)`);
    updateAgentToaster(`⚡ Limiting to 500 of ${finalResults.length} results (max for popup)`);
    finalResults = finalResults.slice(0, 500);
    wasLimited = true;
  } else if (resultMode === "uids_only" && securityMode === "full" && finalResults.length > 100) {
    // Only limit UIDs mode in full access mode where content goes to LLM
    console.log(`⚡ UIDs mode (full access): Limiting ${finalResults.length} results to 100 to prevent bloat`);
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

  // Add metadata about truncation and processing for agent awareness
  const resultMetadata = {
    resultMode,
    returnedCount: finalResults.length,
    totalFound: originalCount,
    wasLimited,
    canExpandResults: wasLimited && resultMode !== "full",
    // New enhanced metadata
    sortedBy: processedResults.metadata.sortedBy,
    sortOrder,
    sampled: processedResults.metadata.sampled,
    availableCount: processedResults.metadata.availableCount,
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
  limitToPages?: string[],
  limitToBlockUids?: string[],
  limitToPageUids?: string[]
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

  // Add UID-based filtering for optimization
  if (limitToBlockUids && limitToBlockUids.length > 0) {
    console.log(`⚡ Optimizing: Filtering to ${limitToBlockUids.length} specific block UIDs`);
    if (limitToBlockUids.length === 1) {
      query += `\n                [?b :block/uid "${limitToBlockUids[0]}"]`;
    } else {
      const uidsSet = limitToBlockUids.map(uid => `"${uid}"`).join(' ');
      query += `\n                [(contains? #{${uidsSet}} ?uid)]`;
    }
  }
  
  if (limitToPageUids && limitToPageUids.length > 0) {
    console.log(`⚡ Optimizing: Filtering to blocks within ${limitToPageUids.length} specific page UIDs`);
    if (limitToPageUids.length === 1) {
      query += `\n                [?page :block/uid "${limitToPageUids[0]}"]`;
    } else {
      const uidsSet = limitToPageUids.map(uid => `"${uid}"`).join(' ');
      query += `\n                [(contains? #{${uidsSet}} ?page-uid)]`;
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
      // Explicit type flag (isPage: false means it's a block)
      isPage: false
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
 * Apply fuzzy matching post-processing to search results
 * This provides an additional layer of fuzzy matching on top of the database search
 */
const applyFuzzyFiltering = (
  searchResults: any[],
  conditions: z.infer<typeof contentConditionSchema>[],
  threshold: number
): any[] => {
  if (!searchResults.length) return searchResults;
  
  // Extract text conditions for fuzzy matching
  const textConditions = conditions.filter(cond => cond.type === "text");
  if (!textConditions.length) return searchResults;
  
  return searchResults.filter(([uid, content, time, pageTitle, pageUid]) => {
    // Apply fuzzy matching to block content
    const blockContent = content?.toLowerCase() || "";
    
    // Check if all text conditions match (considering AND/OR logic would be complex here, so we use ANY match)
    return textConditions.some(condition => {
      const searchTerm = condition.text.toLowerCase();
      
      let matches = false;
      
      // For exact matches, skip fuzzy logic
      if (condition.matchType === "exact") {
        matches = blockContent === searchTerm;
      } else {
        // For contains/regex, apply fuzzy matching to improve recall
        if (blockContent.includes(searchTerm)) {
          matches = true; // Exact substring match always passes
        } else {
          // Apply fuzzy matching to individual words in content
          const contentWords = blockContent.split(/\s+/);
          const searchWords = searchTerm.split(/\s+/);
          
          // Check if any search word fuzzy matches any content word
          matches = searchWords.some(searchWord => 
            contentWords.some(contentWord => 
              fuzzyMatch(searchWord, contentWord, threshold)
            )
          );
        }
      }
      
      // Apply negation if specified for this condition
      return condition.negate ? !matches : matches;
    });
  });
};

// Old sorting functions removed - now using enhanced processEnhancedResults from searchUtils

// LLM-facing tool with minimal schema and auto-enrichment  
export const findBlocksByContentTool = tool(
  async (llmInput, config) => {
    const startTime = performance.now();
    try {
      // Auto-enrich with internal parameters (will be set by agent state)
      const enrichedInput = {
        ...llmInput,
        // These will be injected by the agent wrapper - preserve if already set
        resultMode: (llmInput as any).resultMode || "summary" as const,
        secureMode: (llmInput as any).secureMode || false,
        purpose: (llmInput as any).purpose || "final" as const, // Preserve LLM's intent, default to final
        userQuery: (llmInput as any).userQuery || "", // Preserve from state wrapper
        sortBy: "relevance" as const,
        sortOrder: "desc" as const,
        limit: 500,
        summaryLimit: 20,
        maxExpansions: 3,
        expansionStrategy: "related_concepts" as const,
        childDepth: 2,
        parentDepth: 1,
        includeDaily: true,
        dailyNotesOnly: false,
        dateRange: undefined, // Only set if explicitly provided by LLM
        randomSample: { enabled: false, size: 100 },
        fuzzyThreshold: 0.8
      };

      // Extract state from config
      const state = config?.configurable?.state;
      const { results, metadata } = await findBlocksByContentImpl(enrichedInput, state);
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
    description: "Find blocks by content, page references, or regex patterns. Supports AND/OR logic, date ranges, and hierarchical context.",
    schema: llmFacingSchema, // Use minimal schema
  }
);
