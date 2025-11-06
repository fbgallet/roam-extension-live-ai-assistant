import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  filterByDateRange,
  processEnhancedResults,
  extractUidsFromResults,
} from "../../helpers/searchUtils";
import { withAutomaticExpansion } from "../../helpers/semanticExpansion";
import {
  processConditionGroups,
  applyORToRegexConversion,
  hasGroupedConditions,
  validateConditionInput,
} from "../../helpers/conditionGroupsUtils";
import { updateAgentToaster } from "../../../shared/agentsUtils";

import { schema, llmFacingSchema, FindBlocksByContentInput } from "./schemas";
import { extractUserRequestedLimit } from "./parsers";
import {
  expandConditions,
  applyFuzzyFiltering,
  enrichWithHierarchy,
} from "./processors";
import { searchBlocksWithConditions } from "./executors";

/**
 * Core implementation of findBlocksByContent functionality
 */
export const findBlocksByContentImpl = async (
  input: FindBlocksByContentInput,
  state?: any
) => {
  const {
    conditions,
    combineConditions,
    conditionGroups,
    groupCombination,
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
    excludeBlockUid,
    limitToPages,
    fromResultId,
    limitToBlockUids,
    limitToPageUids,
    fuzzyMatching,
    fuzzyThreshold,
    expansionLevel,
  } = input;

  // Handle grouped conditions vs simple conditions
  let finalConditions: any[];
  let finalCombineConditions: "AND" | "OR";

  // Validate input format
  try {
    validateConditionInput(input);
  } catch (error) {
    console.error("❌ Invalid condition input:", error.message);
    throw error; // Let the wrapper handle this with createToolResult
  }

  if (hasGroupedConditions(input)) {
    // Process grouped conditions
    const processedGroups = await processConditionGroups(
      conditionGroups!,
      groupCombination || "AND",
      state
    );

    // Apply OR-to-regex conversion for mixed logic cases
    const optimizedGroups = applyORToRegexConversion(
      processedGroups.conditions,
      processedGroups.combination
    );

    finalConditions = optimizedGroups.conditions;
    finalCombineConditions = optimizedGroups.combination;
  } else {
    // Use simple conditions (backward compatibility)
    finalConditions = conditions!;
    finalCombineConditions = combineConditions || "AND";
  }

  // Parse dateRange if provided as strings
  let parsedDateRange;
  if (input.dateRange && (input.dateRange.start || input.dateRange.end)) {
    parsedDateRange = {
      start:
        typeof input.dateRange.start === "string"
          ? new Date(input.dateRange.start)
          : input.dateRange.start,
      end:
        typeof input.dateRange.end === "string"
          ? new Date(input.dateRange.end)
          : input.dateRange.end,
    };
  } else {
    console.log(
      "📅 [findBlocksByContent] No dateRange provided or invalid:",
      input.dateRange
    );
  }

  // UID-based filtering for optimization
  const { blockUids: finalBlockUids, pageUids: finalPageUids } =
    extractUidsFromResults(
      fromResultId,
      limitToBlockUids,
      limitToPageUids,
      state
    );

  // Step 1: Process conditions with semantic expansion if needed
  const expandedConditions = await expandConditions(finalConditions, state);

  const hasExpansions = expandedConditions.length > finalConditions.length;
  if (hasExpansions) {
    updateAgentToaster(
      `🔍 Content Search: Expanding search with related terms...`
    );
  }

  // Step 2: Build and execute search query

  const searchResults = await searchBlocksWithConditions(
    expandedConditions,
    finalCombineConditions,
    includeDaily,
    dailyNotesOnly,
    limitToPages,
    finalBlockUids.length > 0 ? finalBlockUids : undefined,
    finalPageUids.length > 0 ? finalPageUids : undefined
  );

  // Step 2.5: Apply fuzzy matching post-processing if enabled
  let fuzzyFilteredResults = searchResults;
  if (fuzzyMatching && fuzzyThreshold && finalConditions.length > 0) {
    fuzzyFilteredResults = applyFuzzyFiltering(
      searchResults,
      finalConditions,
      fuzzyThreshold || 0.8
    );
  }

  // Step 3: Smart hierarchy enrichment optimization
  let optimizedIncludeChildren = includeChildren;
  let optimizedIncludeParents = includeParents;
  let enrichedResults: any[];

  // Optimization: Skip expensive hierarchy enrichment for large result sets unless explicitly needed
  if (fuzzyFilteredResults.length > 100) {
    if (
      includeChildren &&
      !userQuery?.match(/context|hierarchy|structure|children|explore/i)
    ) {
      optimizedIncludeChildren = false;
    }
    if (
      includeParents &&
      !userQuery?.match(/context|hierarchy|structure|parents|explore/i)
    ) {
      optimizedIncludeParents = false;
    }
  }

  // Step 3: Only call enrichWithHierarchy if we actually need hierarchy data
  if (optimizedIncludeChildren || optimizedIncludeParents) {
    updateAgentToaster(
      `🔗 Content Search: Adding parent/child blocks to ${fuzzyFilteredResults.length} results...`
    );

    enrichedResults = await enrichWithHierarchy(
      fuzzyFilteredResults,
      optimizedIncludeChildren,
      childDepth,
      optimizedIncludeParents,
      parentDepth,
      secureMode,
      expansionLevel || 0
    );
  } else {
    // Fast path: Create basic block structure without expensive hierarchy queries
    const { isDailyNote } = await import("../../helpers/searchUtils");
    enrichedResults = fuzzyFilteredResults.map(
      ([uid, content, time, pageTitle, pageUid]) => ({
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
        isPage: false,
        // Add expansion level for ranking
        expansionLevel: expansionLevel || 0,
      })
    );
  }

  // Step 4: Apply date range filtering if specified
  let filteredResults = enrichedResults;

  if (parsedDateRange) {
    console.log("📅 [findBlocksByContent] Applying date range filter...");
    const filterMode = input.dateRange.filterMode || "modified";
    filteredResults = filterByDateRange(
      filteredResults,
      parsedDateRange,
      filterMode
    );
  }

  // Step 4.5: Exclude user query block from results by UID
  if (excludeBlockUid) {
    const originalCount = filteredResults.length;
    filteredResults = filteredResults.filter(
      (result) => result.uid !== excludeBlockUid
    );
    const excludedCount = originalCount - filteredResults.length;
  }

  // Step 5: Apply enhanced sorting, sampling, and limiting
  // Determine security mode for limits
  const securityMode = secureMode
    ? "private"
    : resultMode === "full"
    ? "full"
    : "balanced";

  const processedResults = processEnhancedResults(filteredResults, {
    sortBy: sortBy as any, // Type is already validated by schema
    sortOrder,
    limit,
    randomSample: randomSample
      ? {
          enabled: randomSample.enabled || false,
          size: randomSample.size || 100,
          seed: randomSample.seed,
        }
      : undefined,
    securityMode,
  });

  let finalResults = processedResults.data;
  let wasLimited = processedResults.metadata.wasLimited;
  let originalCount = processedResults.metadata.totalFound;

  // Step 6: Apply result mode filtering

  // Apply smart limiting based on result mode
  // CRITICAL SAFEGUARDS: Always enforce limits to prevent 120k+ token costs

  // Extract user-requested limit from query before applying tool defaults
  const userRequestedLimit = extractUserRequestedLimit(userQuery || "");

  // CRITICAL DISTINCTION:
  // - User-requested limits: Always respected (user asked for specific number)
  // - Summary mode limits: Only for LLM processing, not for Full Results storage
  // - Full Results should get up to 500 results, display gets limited later

  if (userRequestedLimit) {
    // User specifically requested a certain number - respect it completely
    finalResults = finalResults.slice(0, userRequestedLimit);
    wasLimited = finalResults.length < originalCount;
  } else if (resultMode === "summary" && finalResults.length > 500) {
    // Summary mode: Allow up to 500 for Full Results popup, but warn about costs
    updateAgentToaster(
      `⚡ Content Search: Limiting to 500 of ${finalResults.length} results (max for popup)`
    );
    finalResults = finalResults.slice(0, 500);
    wasLimited = true;
  } else if (
    resultMode === "uids_only" &&
    securityMode === "full" &&
    finalResults.length > 300
  ) {
    // Only limit UIDs mode in full access mode where content goes to LLM
    updateAgentToaster(
      `⚡ Content Search: Limiting to 300 of ${finalResults.length} results for analysis`
    );
    finalResults = finalResults.slice(0, 300);
    wasLimited = true;
  } else if (resultMode === "uids_only" && finalResults.length > 3000) {
    // General limit for uids_only mode for popup display (independent of security mode)
    updateAgentToaster(
      `⚡ Content Search: Limiting to 3000 of ${finalResults.length} results for popup display`
    );
    finalResults = finalResults.slice(0, 3000);
    wasLimited = true;
  } else if (resultMode === "full" && finalResults.length > 300) {
    // EMERGENCY SAFEGUARD: Full mode should NEVER return unlimited results
    updateAgentToaster(
      `🚨 Content Search: Showing first 300 of ${finalResults.length} results (maximum allowed)`
    );
    finalResults = finalResults.slice(0, 300);
    wasLimited = true;
  } else if (finalResults.length > limit) {
    updateAgentToaster(
      `⚡ Content Search: Showing top ${limit} of ${finalResults.length} results`
    );
    finalResults = finalResults.slice(0, limit);
    wasLimited = true;
  }

  // FINAL SAFEGUARD: Any result set > 200 should be marked as limited for caching
  if (finalResults.length > 200 && !wasLimited) {
    wasLimited = true;
  }

  // Format results based on result mode
  if (resultMode === "uids_only") {
    finalResults = finalResults.map((result) => ({
      uid: result.uid,
      pageTitle: result.pageTitle,
      pageUid: result.pageUid,
      isDaily: result.isDaily,
      modified: result.modified,
    }));
  } else if (resultMode === "summary") {
    finalResults = finalResults.map((result) => ({
      uid: result.uid,
      content: secureMode
        ? undefined
        : result.content?.length > 100
        ? result.content.substring(0, 100) + "..."
        : result.content,
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

  return {
    results: finalResults,
    metadata: resultMetadata,
  };
};

// Main tool export using shared automatic expansion wrapper
export const findBlocksByContentTool = tool(
  async (input: z.infer<typeof schema>, config) => {
    return withAutomaticExpansion(
      "findBlocksByContent",
      findBlocksByContentImpl,
      input,
      config
    );
  },
  {
    name: "findBlocksByContent",
    description:
      "Find blocks by content, page references, or regex patterns. SIMPLE: Use 'conditions' array for basic AND/OR logic. GROUPED: Use 'conditionGroups' for complex logic like ((A|B) AND NOT C). Supports semantic expansion, date ranges, and hierarchical context.",
    schema: llmFacingSchema, // Use minimal schema for LLM
  }
);
