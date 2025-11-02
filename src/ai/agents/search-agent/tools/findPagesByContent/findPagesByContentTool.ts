import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  filterByDateRange,
  extractUidsFromResults,
  parsePageSearchSyntax,
  processConditionGroupsForPageWide,
} from "../../helpers/searchUtils";
import {
  hasGroupedConditions,
  hasSimpleConditions,
  validateConditionInput,
  processConditionGroups,
  applyORToRegexConversion,
} from "../../helpers/conditionGroupsUtils";
import { schema, llmFacingSchema, FindPagesByContentInput } from "./schemas";
import {
  expandConditions,
  processPageWideConditions,
  processAllConditions,
} from "./processors";
import {
  analyzePagesByBlocks,
  enrichPageResults,
  sortPageResults,
} from "./analysisUtils";
import {
  withAutomaticExpansion,
  createToolResult,
} from "../../helpers/semanticExpansion";
import { updateAgentToaster } from "../../../shared/agentsUtils";

/**
 * Find pages by analyzing their content blocks with aggregation and filtering
 * Security Level: Flexible (secure mode = UIDs/metadata only, content mode = includes block samples)
 *
 * This tool searches pages based on the content of their blocks, with support for
 * content aggregation, statistical analysis, and intelligent page-level filtering.
 * Use secureMode=true to exclude block content from results (UIDs and metadata only).
 */

const findPagesByContentImpl = async (
  input: FindPagesByContentInput,
  state?: any
) => {
  const {
    conditions,
    combineConditions,
    conditionGroups,
    groupCombination,
    searchScope = "block",
    maxExpansions,
    minBlockCount,
    maxBlockCount,
    minTotalBlocks,
    maxTotalBlocks,
    includeBlockCount,
    includeBlockSamples,
    maxSamples,
    includeContentStats,
    includeDaily,
    dateRange,
    sortBy,
    limit,
    fromResultId,
    limitToPageUids,
    excludeBlockUid,
  } = input;

  console.log(
    `🔧 [DEBUG] includeDaily from input destructuring:`,
    includeDaily
  );
  console.log(`🔧 [DEBUG] Full input object:`, JSON.stringify(input, null, 2));

  // Ensure includeDaily defaults to true if undefined
  const finalIncludeDaily = includeDaily !== undefined ? includeDaily : true;
  console.log(`🔧 [DEBUG] Final includeDaily value:`, finalIncludeDaily);

  // Parse syntax and detect search scope from condition text
  let finalSearchScope = searchScope;
  let rawConditions: any[] = conditions || [];

  if (hasSimpleConditions(input) && conditions && conditions.length > 0) {
    // Check for page:(content:...) or page:(block:(...)) syntax in condition text
    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];
      const syntaxResult = parsePageSearchSyntax(condition.text);

      // Only update if the extractedQuery is different (i.e., syntax was found)
      if (syntaxResult.extractedQuery !== condition.text) {
        console.log(
          `🎯 Detected explicit syntax: ${syntaxResult.searchScope} search for "${syntaxResult.extractedQuery}"`
        );
        finalSearchScope = syntaxResult.searchScope;
        // Update condition with clean text
        rawConditions[i] = { ...condition, text: syntaxResult.extractedQuery };
      }
    }
  }

  // Handle grouped conditions vs simple conditions
  let finalConditions: any[];
  let finalCombineConditions: "AND" | "OR";

  // Validate input format
  try {
    validateConditionInput(input);
  } catch (error) {
    console.error("❌ Invalid condition input:", error.message);
    return createToolResult(false, undefined, error.message);
  }

  if (hasGroupedConditions(input)) {
    console.log("🔧 Processing grouped conditions in findPagesByContent");

    // For page-wide search with grouped conditions, use special processing
    if (finalSearchScope === "content" && groupCombination === "AND") {
      console.log(
        "🌍 Using content-wide processing for complex condition groups"
      );
      const processedGroups = processConditionGroupsForPageWide(
        conditionGroups!,
        groupCombination || "AND"
      );
      finalConditions = processedGroups.conditions;
      finalCombineConditions = processedGroups.combination;
    } else {
      // Standard grouped processing for block-level search
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
    }

    console.log(
      `🚀 Converted ${conditionGroups!.length} condition groups to ${
        finalConditions.length
      } optimized conditions with ${finalCombineConditions} logic (${finalSearchScope} scope)`
    );
  } else {
    console.log(
      `🔧 Processing simple conditions in findPagesByContent (${finalSearchScope} scope)`
    );
    // Use simple conditions (backward compatibility)
    finalConditions = rawConditions;
    finalCombineConditions = combineConditions || "AND";
  }

  // UID-based filtering for optimization
  const { pageUids: finalPageUids } = extractUidsFromResults(
    fromResultId,
    undefined, // No block UIDs for page content search
    limitToPageUids,
    state
  );

  // Step 1: Expand conditions with semantic terms
  const expandedConditions = await expandConditions(
    finalConditions,
    maxExpansions,
    state
  );

  // Step 2: Process all conditions (attribute and regular)
  let matchingBlocks: any[];
  if (finalSearchScope === "content" && finalCombineConditions === "AND") {
    console.log("🌍 Using content-wide AND processing");
    matchingBlocks = await processPageWideConditions(
      expandedConditions,
      finalIncludeDaily,
      finalPageUids.length > 0 ? finalPageUids : undefined,
      excludeBlockUid,
      state
    );
  } else {
    console.log(`📚 Using block-level processing (${finalSearchScope} scope)`);
    matchingBlocks = await processAllConditions(
      expandedConditions,
      finalCombineConditions,
      finalIncludeDaily,
      finalPageUids.length > 0 ? finalPageUids : undefined,
      excludeBlockUid,
      state
    );
  }

  // Step 3: Analyze pages by grouping blocks
  const pageAnalysis = await analyzePagesByBlocks(
    matchingBlocks,
    minBlockCount,
    maxBlockCount,
    minTotalBlocks,
    maxTotalBlocks
  );

  // Step 4: Enrich page results with detailed analysis
  let enrichedResults = await enrichPageResults(
    pageAnalysis,
    includeBlockCount,
    includeBlockSamples,
    maxSamples,
    includeContentStats,
    conditions
  );

  // Step 5: Apply date filtering
  if (dateRange && (dateRange.start || dateRange.end)) {
    const parsedDateRange = {
      start:
        typeof dateRange.start === "string"
          ? new Date(dateRange.start)
          : dateRange.start,
      end:
        typeof dateRange.end === "string"
          ? new Date(dateRange.end)
          : dateRange.end,
    };
    const filterMode = dateRange.filterMode || "modified";
    enrichedResults = filterByDateRange(
      enrichedResults,
      parsedDateRange,
      filterMode
    );
  }

  // Step 6: Sort results
  enrichedResults = sortPageResults(enrichedResults, sortBy, finalConditions);

  // Step 7: Limit results
  const wasLimited = enrichedResults.length > limit;
  if (wasLimited) {
    updateAgentToaster(
      `⚡ Page Content Search: Showing top ${limit} of ${enrichedResults.length} pages`
    );
    enrichedResults = enrichedResults.slice(0, limit);
  } else if (enrichedResults.length > 0) {
    updateAgentToaster(
      `✅ Page Content Search: Found ${enrichedResults.length} page${enrichedResults.length > 1 ? 's' : ''}`
    );
  }

  return enrichedResults;
};

export const findPagesByContentTool = tool(
  async (input: z.infer<typeof schema>, config) => {
    return withAutomaticExpansion(
      "findPagesByContent",
      findPagesByContentImpl,
      input,
      config
    );
  },
  {
    name: "findPagesByContent",
    description:
      "Find pages by analyzing their block content. SIMPLE: Use 'conditions' array for basic AND/OR logic. GROUPED: Use 'conditionGroups' for complex logic like ((A|B) AND NOT C). SCOPE: Use 'searchScope=content' for content-wide AND (conditions across different blocks) or 'block' for same-block matching. Supports syntax: page:(content:term) or page:(block:(term)). Use for 'pages that contain X' or 'pages with attributes' queries.",
    schema: llmFacingSchema, // Use minimal schema for better LLM experience
  }
);
