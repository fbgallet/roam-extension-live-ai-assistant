import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  executeDatomicQuery,
  isDailyNote,
  filterByDateRange,
  createToolResult,
  generateSemanticExpansions,
  generateFuzzyRegex,
  getBlockChildren,
  getBlockParents,
  DatomicQueryBuilder,
  SearchCondition,
  processEnhancedResults,
  getEnhancedLimits,
  fuzzyMatch,
  extractUidsFromResults,
  sanitizeRegexForDatomic,
  parseSemanticExpansion,
} from "../helpers/searchUtils";
import {
  baseConditionSchema,
  conditionGroupSchema,
  extendedConditionsSchema,
  processConditionGroups,
  applyORToRegexConversion,
  hasGroupedConditions,
  hasSimpleConditions,
  validateConditionInput,
  convertSimpleToGrouped,
} from "./conditionGroupsUtils";
import { dnpUidRegex } from "../../../../utils/regex.js";
import { updateAgentToaster } from "../../shared/agentsUtils";

// Extract user-requested limit from query (e.g., "2 random results", "first 5 pages", "show me 10 blocks")
const extractUserRequestedLimit = (userQuery: string): number | null => {
  const query = userQuery.toLowerCase();

  // Pattern 1: "N results", "N random results", "N pages", "N blocks"
  const numberResultsMatch = query.match(
    /(\d+)\s+(random\s+)?(results?|pages?|blocks?)/
  );
  if (numberResultsMatch) {
    const num = parseInt(numberResultsMatch[1], 10);
    if (num > 0 && num <= 500) {
      // Reasonable bounds
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

// Use the shared base condition schema, extending it for content-specific types
const contentConditionSchema = baseConditionSchema.extend({
  type: z
    .enum(["text", "page_ref", "block_ref", "regex", "page_ref_or"])
    .default("text"),
});

const schema = extendedConditionsSchema.extend({
  // Override conditions to use content-specific schema
  conditions: z
    .array(contentConditionSchema)
    .optional()
    .describe(
      "SIMPLE: List of conditions for basic logic. Use this OR conditionGroups, not both."
    ),
  conditionGroups: z
    .array(
      conditionGroupSchema.extend({
        conditions: z
          .array(contentConditionSchema)
          .min(1, "At least one condition required in group"),
      })
    )
    .optional()
    .describe(
      "GROUPED: Groups of conditions for complex logic like ((A|B) AND NOT C). Use this OR conditions, not both."
    ),
  includeChildren: z
    .boolean()
    .default(false)
    .describe(
      "Include child blocks (expensive for large result sets - only use when exploring specific blocks)"
    ),
  childDepth: z.number().min(1).max(5).default(2),
  includeParents: z
    .boolean()
    .default(false)
    .describe(
      "Include parent blocks (expensive - only use when exploring specific blocks)"
    ),
  parentDepth: z.number().min(1).max(3).default(1),
  includeDaily: z.boolean().default(true),
  dailyNotesOnly: z
    .boolean()
    .default(false)
    .describe("Search ONLY in daily notes (overrides includeDaily when true)"),
  dateRange: z
    .object({
      start: z.union([z.date(), z.string()]).optional(),
      end: z.union([z.date(), z.string()]).optional(),
      filterMode: z.enum(["created", "modified"]).optional(),
    })
    .optional(),
  // Enhanced sorting and sampling options
  sortBy: z
    .enum(["relevance", "creation", "modification", "alphabetical", "random"])
    .default("relevance"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  limit: z.number().min(1).max(50000).default(500), // Increased default and max limits

  // Random sampling for large datasets
  randomSample: z
    .object({
      enabled: z.boolean().default(false),
      size: z.number().min(1).max(10000).default(100),
      seed: z
        .number()
        .optional()
        .describe("Seed for reproducible random sampling"),
    })
    .optional(),

  // Result modes for controlling data transfer
  resultMode: z
    .enum(["full", "summary", "uids_only"])
    .default("summary")
    .describe(
      "full=all data, summary=essential fields only, uids_only=just UIDs and basic metadata"
    ),
  summaryLimit: z
    .number()
    .min(1)
    .max(50)
    .default(20)
    .describe(
      "Maximum results to return in summary mode to prevent token bloat"
    ),

  // Security mode
  secureMode: z
    .boolean()
    .default(false)
    .describe(
      "If true, excludes full block content from results (UIDs and metadata only)"
    ),

  // Result lifecycle management
  purpose: z
    .enum(["final", "intermediate", "replacement", "completion"])
    .optional()
    .describe(
      "Purpose: 'final' for user response data, 'intermediate' for exploration, 'replacement' to replace previous results, 'completion' to add to previous results"
    ),
  replacesResultId: z
    .string()
    .optional()
    .describe(
      "If purpose is 'replacement', specify which result ID to replace (e.g., 'findBlocksByContent_001')"
    ),
  completesResultId: z
    .string()
    .optional()
    .describe(
      "If purpose is 'completion', specify which result ID this completes (e.g., 'findPagesByTitle_002')"
    ),

  // Block UID exclusion (replaces userQuery-based exclusion)
  excludeBlockUid: z
    .string()
    .optional()
    .describe(
      "Block UID to exclude from results (typically the user's query block)"
    ),
  userQuery: z
    .string()
    .optional()
    .describe("The original user query text (for context, not for exclusion)"),

  // Page scope limitation
  limitToPages: z
    .array(z.string())
    .optional()
    .describe(
      "Limit search to blocks within specific pages (by exact page title). Use for 'in page [[X]]' queries."
    ),

  // UID-based filtering for optimization
  fromResultId: z
    .string()
    .optional()
    .describe(
      "Limit search to blocks/pages from previous result (e.g., 'findBlocksByContent_001'). Dramatically improves performance for large databases."
    ),
  limitToBlockUids: z
    .array(z.string())
    .optional()
    .describe("Limit search to specific block UIDs (user-provided list)"),
  limitToPageUids: z
    .array(z.string())
    .optional()
    .describe("Limit search to blocks within specific page UIDs"),

  // Fuzzy matching for typos and approximate matches
  fuzzyMatching: z
    .boolean()
    .default(false)
    .describe(
      "Enable typo tolerance and approximate matching for search terms"
    ),
  fuzzyThreshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.8)
    .describe("Similarity threshold for fuzzy matches (0=exact, 1=very loose)"),

  // Expansion level for ranking (injected by agent state wrapper)
  expansionLevel: z
    .number()
    .optional()
    .describe(
      "Current expansion level for ranking (0=exact, 1-3=expansion levels)"
    ),
});

// LLM-facing schema with minimal required fields
const llmFacingSchema = z.object({
  // Simple conditions (backward compatible)
  conditions: z
    .array(
      z.object({
        text: z.string().min(1, "Search text is required"),
        type: z
          .enum(["text", "page_ref", "block_ref", "regex", "page_ref_or"])
          .default("text")
          .describe(
            "text=content search, page_ref=[[page]] reference, regex=pattern matching"
          ),
        matchType: z
          .enum(["exact", "contains", "regex"])
          .default("contains")
          .describe("contains=phrase within block, exact=entire block matches"),
        negate: z
          .boolean()
          .default(false)
          .describe("Exclude blocks matching this condition"),
      })
    )
    .optional()
    .describe(
      "SIMPLE: List of conditions for basic logic. Use this OR conditionGroups, not both."
    ),
  combineConditions: z
    .enum(["AND", "OR"])
    .default("AND")
    .describe("How to combine simple conditions"),

  // Grouped conditions (new advanced feature)
  conditionGroups: z
    .array(
      z.object({
        conditions: z
          .array(
            z.object({
              text: z.string().min(1, "Search text is required"),
              type: z
                .enum(["text", "page_ref", "block_ref", "regex", "page_ref_or"])
                .default("text"),
              matchType: z
                .enum(["exact", "contains", "regex"])
                .default("contains"),
              negate: z.boolean().default(false),
            })
          )
          .min(1, "At least one condition required in group"),
        combination: z
          .enum(["AND", "OR"])
          .default("AND")
          .describe("How to combine conditions within this group"),
      })
    )
    .optional()
    .describe(
      "GROUPED: Groups of conditions for complex logic like ((A|B) AND NOT C). Use this OR conditions, not both."
    ),
  groupCombination: z
    .enum(["AND", "OR"])
    .default("AND")
    .describe("How to combine condition groups"),
  includeChildren: z
    .boolean()
    .default(false)
    .describe(
      "Include child blocks in results (use sparingly for performance)"
    ),
  includeParents: z
    .boolean()
    .default(false)
    .describe("Include parent blocks for context"),
  limitToPages: z
    .array(z.string())
    .optional()
    .describe("Search only within these specific pages (by exact title)"),
  fromResultId: z
    .string()
    .optional()
    .describe(
      "Limit to results from previous search (e.g., 'findBlocksByContent_001') - major performance boost"
    ),
  limitToBlockUids: z
    .array(z.string())
    .optional()
    .describe("Limit to specific block UIDs"),
  limitToPageUids: z
    .array(z.string())
    .optional()
    .describe("Limit to blocks within specific page UIDs"),
  fuzzyMatching: z
    .boolean()
    .default(false)
    .describe("Enable typo tolerance and approximate matching"),
});

const findBlocksByContentImpl = async (
  input: z.infer<typeof schema>,
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
    console.log("🔧 Processing grouped conditions in findBlocksByContent");
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

    console.log(
      `🚀 Converted ${conditionGroups!.length} condition groups to ${
        finalConditions.length
      } optimized conditions with ${finalCombineConditions} logic`
    );
  } else {
    console.log("🔧 Processing simple conditions in findBlocksByContent");
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
    console.log("📅 [findBlocksByContent] Parsed dateRange:", {
      original: input.dateRange,
      parsed: parsedDateRange,
      startType: typeof parsedDateRange.start,
      endType: typeof parsedDateRange.end,
    });
  } else {
    console.log(
      "📅 [findBlocksByContent] No dateRange provided or invalid:",
      input.dateRange
    );
    console.log(
      "📅 [findBlocksByContent] Full input received:",
      JSON.stringify(input, null, 2)
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
    updateAgentToaster(`🔍 Expanding search with related terms...`);
  }

  // Step 2: Build and execute search query

  console.log(
    `🔍 [DEBUG] Expanded conditions for Datomic:`,
    expandedConditions.map((c) => ({
      type: c.type,
      text: c.text,
      matchType: c.matchType,
      semanticExpansion: c.semanticExpansion,
      negate: c.negate,
    }))
  );

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
      `🔗 Adding context to ${fuzzyFilteredResults.length} results...`
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
  console.log("📅 [findBlocksByContent] About to check date filtering:", {
    hasParsedDateRange: !!parsedDateRange,
    parsedDateRange: parsedDateRange,
    enrichedResultsCount: enrichedResults.length,
  });

  if (parsedDateRange) {
    console.log("📅 [findBlocksByContent] Applying date range filter...");
    const filterMode = input.dateRange.filterMode || "modified";
    filteredResults = filterByDateRange(
      filteredResults,
      parsedDateRange,
      filterMode
    );
    console.log("📅 [findBlocksByContent] Date filtering completed:", {
      originalCount: enrichedResults.length,
      filteredCount: filteredResults.length,
      filterMode,
    });
  } else {
    console.log(
      "📅 [findBlocksByContent] Skipping date filtering - no parsedDateRange"
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
      `⚡ Limiting to 500 of ${finalResults.length} results (max for popup)`
    );
    finalResults = finalResults.slice(0, 500);
    wasLimited = true;
  } else if (
    resultMode === "uids_only" &&
    securityMode === "full" &&
    finalResults.length > 100
  ) {
    // Only limit UIDs mode in full access mode where content goes to LLM
    updateAgentToaster(
      `⚡ Limiting to 100 of ${finalResults.length} results for analysis`
    );
    finalResults = finalResults.slice(0, 100);
    wasLimited = true;
  } else if (resultMode === "full" && finalResults.length > 300) {
    // EMERGENCY SAFEGUARD: Full mode should NEVER return unlimited results
    updateAgentToaster(
      `🚨 Showing first 300 of ${finalResults.length} results (maximum allowed)`
    );
    finalResults = finalResults.slice(0, 300);
    wasLimited = true;
  } else if (finalResults.length > limit) {
    updateAgentToaster(
      `⚡ Showing top ${limit} of ${finalResults.length} results`
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

/**
 * Create regex pattern for page references that matches Roam syntax but not plain text
 * Supports: [[title]], #title, title:: but NOT plain "title"
 */
const createPageRefRegexPattern = (pageTitle: string): string => {
  // Escape special regex characters in the page title
  const escapedTitle = pageTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Optimized pattern: [[title]], #title, or title::
  return `(?:\\[\\[${escapedTitle}\\]\\]|#${escapedTitle}(?!\\w)|${escapedTitle}::)`;
};

/**
 * Create optimized regex pattern for multiple page reference variations
 * Creates a single efficient OR pattern instead of multiple separate patterns
 */
const createMultiPageRefRegexPattern = (pageNames: string[]): string => {
  if (pageNames.length === 0) return "";
  if (pageNames.length === 1) return createPageRefRegexPattern(pageNames[0]);

  // Escape and prepare all page names
  const escapedNames = pageNames.map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );

  // Create alternation of just the terms
  const termAlternation = escapedNames.join("|");

  // Single optimized pattern: factors out common Roam syntax structures
  return `(?:\\[\\[(?:${termAlternation})\\]\\]|#(?:${termAlternation})(?!\\w)|(?:${termAlternation})::)`;
};

/**
 * Expand search conditions with semantic terms using LLM
 * Only expands when explicitly requested
 */
const expandConditions = async (
  conditions: z.infer<typeof contentConditionSchema>[],
  state?: any
): Promise<z.infer<typeof contentConditionSchema>[]> => {
  const expandedConditions = [...conditions];
  const expansionLevel = state?.expansionLevel || 0;

  // Check if semantic expansion is needed - either globally or per-condition
  const hasGlobalExpansion = state?.isExpansionGlobal === true;

  // Check if any condition has symbols that require expansion
  const hasSymbolExpansion = conditions.some(
    (c) => c.text.endsWith("*") || c.text.endsWith("~")
  );

  if (!hasGlobalExpansion && !hasSymbolExpansion) {
    console.log(
      `⏭️ [ContentTool] Skipping semantic expansion (no global flag or symbols)`
    );
    return expandedConditions;
  }

  console.log(
    `🧠 [ContentTool] Applying semantic expansion at level ${expansionLevel}`
  );

  for (const condition of conditions) {
    // Skip regex conditions - user wants exact results for regex
    if (condition.type === "regex") {
      continue;
    }

    // Parse semantic expansion from condition text using our new parser
    const { cleanText, expansionType } = parseSemanticExpansion(
      condition.text,
      state?.semanticExpansion
    );

    console.log(`🔍 [DEBUG] Conditions received:`, condition);

    // Determine final expansion strategy: per-condition > global
    let effectiveExpansionStrategy = expansionType;
    if (!effectiveExpansionStrategy && hasGlobalExpansion) {
      effectiveExpansionStrategy = state?.semanticExpansion || "synonyms";
    }

    console.log("🔍 [DEBUG] expansionType :>> ", expansionType);

    // Handle text conditions with semantic expansion
    if (effectiveExpansionStrategy && condition.type === "text") {
      try {
        const customStrategy =
          effectiveExpansionStrategy === "custom"
            ? state?.customSemanticExpansion
            : undefined;

        // BACKUP: Old fuzzy regex approach using generateFuzzyRegex (kept for reference)
        // Now using unified generateSemanticExpansions for all strategies including fuzzy

        // Use generateSemanticExpansions for all expansion strategies (including fuzzy)
        const expansionTerms = await generateSemanticExpansions(
          cleanText, // Use clean text for expansion
          effectiveExpansionStrategy as
            | "fuzzy"
            | "synonyms"
            | "related_concepts"
            | "broader_terms"
            | "custom"
            | "all",
          state?.userQuery,
          state?.model,
          state?.language,
          customStrategy,
          "text" // Allow regex patterns for text content search
        );

        // Show semantic variations to user
        if (expansionTerms.length > 0) {
          updateAgentToaster(
            `🔍 Semantic expansion: "${cleanText}" → ${expansionTerms.join(
              ", "
            )}`
          );
        }

        // Create language-agnostic disjunctive regex with smart word boundaries
        if (expansionTerms.length > 0) {
          const smartPatterns = [cleanText, ...expansionTerms].map((term) => {
            const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

            // Multi-word terms: preserve spaces, add boundaries
            if (term.includes(" ")) {
              const spacedPattern = escapedTerm.replace(/\s+/g, "\\s+");
              return `\\b${spacedPattern}\\b`;
            }

            // Single words: use word boundaries for short terms to avoid false positives
            if (term.length <= 3) {
              return `\\b${escapedTerm}\\b`;
            } else {
              // Longer terms: no boundaries to catch morphological variations (plurals, etc.)
              return escapedTerm;
            }
          });

          const disjunctivePattern = `(?:${smartPatterns.join("|")})`;

          // Replace original condition with expanded regex
          condition.type = "regex";
          condition.text = disjunctivePattern;
          condition.matchType = "regex";
          condition.semanticExpansion = undefined;
          condition.weight = condition.weight * 0.7;
        } else {
          // Fallback: just update with clean text
          condition.text = cleanText;
        }
      } catch (error) {
        console.warn(`Failed to expand condition "${condition.text}":`, error);
        // Fallback: just update with clean text
        condition.text = cleanText;
      }
    } else {
      // No expansion needed, just update with clean text (remove symbols)
      condition.text = cleanText;
    }

    // Handle page_ref conditions with semantic expansion
    if (condition.type === "page_ref" && effectiveExpansionStrategy) {
      try {
        const customStrategy =
          effectiveExpansionStrategy === "custom"
            ? state?.customSemanticExpansion
            : undefined;

        // For all page_ref expansions (including fuzzy), use generateSemanticExpansions
        const expansionTerms = await generateSemanticExpansions(
          cleanText, // Use clean text for expansion
          effectiveExpansionStrategy as
            | "synonyms"
            | "related_concepts"
            | "broader_terms"
            | "custom"
            | "all",
          state?.userQuery,
          state?.model,
          state?.language,
          customStrategy,
          "page_ref" // Generate simple text variations for page references
        );

        console.log(
          `🔗 Expanding page reference "${condition.text}" with ${expansionTerms.length} semantic variations`
        );

        // Show semantic variations to user
        if (expansionTerms.length > 0) {
          updateAgentToaster(
            `🔗 Page reference expansion: "${cleanText}" → ${expansionTerms.join(
              ", "
            )}`
          );
        }

        if (expansionTerms.length > 0) {
          // Create page reference syntax pattern (line 634 style)
          const optimizedRegexPattern =
            createMultiPageRefRegexPattern(expansionTerms);

          // Replace original page_ref condition with expanded regex
          condition.type = "regex";
          condition.text = optimizedRegexPattern;
          condition.matchType = "regex";
          condition.semanticExpansion = undefined;
          condition.weight = condition.weight * 0.7;

          console.log(
            `  ✅ Created optimized pattern for ${
              expansionTerms.length
            } expansion terms: ${expansionTerms.join(", ")}`
          );
        } else {
          // Fallback: just update with clean text
          condition.text = cleanText;
        }
      } catch (error) {
        console.warn(
          `Failed to expand page_ref condition "${condition.text}":`,
          error
        );
        // Fallback: just update with clean text
        condition.text = cleanText;
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
      const orClauses = limitToPages.map(
        (page) => `[?page :node/title "${page}"]`
      );
      query += `\n                (or ${orClauses.join(" ")})`;
    }
  }

  // Add UID-based filtering for optimization
  if (limitToBlockUids && limitToBlockUids.length > 0) {
    if (limitToBlockUids.length === 1) {
      query += `\n                [?b :block/uid "${limitToBlockUids[0]}"]`;
    } else {
      const uidsSet = limitToBlockUids.map((uid) => `"${uid}"`).join(" ");
      query += `\n                [(contains? #{${uidsSet}} ?uid)]`;
    }
  }

  if (limitToPageUids && limitToPageUids.length > 0) {
    console.log(
      `⚡ Optimizing: Filtering to blocks within ${limitToPageUids.length} specific page UIDs`
    );
    if (limitToPageUids.length === 1) {
      query += `\n                [?page :block/uid "${limitToPageUids[0]}"]`;
    } else {
      const uidsSet = limitToPageUids.map((uid) => `"${uid}"`).join(" ");
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
  const searchConditions: SearchCondition[] = conditions.map((cond) => ({
    type: cond.type as any,
    text: cond.text,
    matchType: cond.matchType as any,
    semanticExpansion: cond.semanticExpansion,
    weight: cond.weight,
    negate: cond.negate,
  }));

  const queryBuilder = new DatomicQueryBuilder(searchConditions, combineLogic);
  const { patternDefinitions, conditionClauses } =
    queryBuilder.buildConditionClauses("?content");

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
      const sanitizedRegex = sanitizeRegexForDatomic(condition.text);
      const regexWithFlags = sanitizedRegex.isCaseInsensitive
        ? sanitizedRegex.pattern
        : `(?i)${sanitizedRegex.pattern}`;
      clause = `\n${indent}[(re-pattern "${regexWithFlags}") ?pattern${index}]
${indent}[(re-find ?pattern${index} ?content)]`;
      break;

    case "text":
    default:
      if (condition.matchType === "exact") {
        clause = `\n${indent}[(= ?content "${condition.text}")]`;
      } else if (condition.matchType === "regex") {
        const sanitizedTextRegex = sanitizeRegexForDatomic(condition.text);
        const textRegexWithFlags = sanitizedTextRegex.isCaseInsensitive
          ? sanitizedTextRegex.pattern
          : `(?i)${sanitizedTextRegex.pattern}`;
        clause = `\n${indent}[(re-pattern "${textRegexWithFlags}") ?pattern${index}]
${indent}[(re-find ?pattern${index} ?content)]`;
      } else {
        // Use case-insensitive regex without problematic escape characters
        // Remove any special regex characters to prevent escape issues
        const cleanText = condition.text.replace(/[.*+?^${}()|[\]\\]/g, "");
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
  secureMode: boolean = false,
  expansionLevel: number = 0
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
      isPage: false,
      // Add expansion level for ranking
      expansionLevel: expansionLevel,
    };

    // Get children if requested
    if (includeChildren) {
      blockResult.children = await getBlockChildren(
        uid,
        childDepth,
        secureMode
      );
    }

    // Get parents if requested
    if (includeParents) {
      blockResult.parents = await getBlockParents(uid, parentDepth, secureMode);
    }

    enrichedResults.push(blockResult);
    console.log(
      `🔧 enrichWithHierarchy: Added block ${uid}, total: ${enrichedResults.length}`
    );
  }

  console.log(
    `🔧 enrichWithHierarchy: Returning ${enrichedResults.length} enriched results`
  );
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
  const textConditions = conditions.filter((cond) => cond.type === "text");
  if (!textConditions.length) return searchResults;

  return searchResults.filter(([uid, content, time, pageTitle, pageUid]) => {
    // Apply fuzzy matching to block content
    const blockContent = content?.toLowerCase() || "";

    // Check if all text conditions match (considering AND/OR logic would be complex here, so we use ANY match)
    return textConditions.some((condition) => {
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
          matches = searchWords.some((searchWord) =>
            contentWords.some((contentWord) =>
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
      // Extract state from config to access injected parameters
      const state = config?.configurable?.state;

      // Auto-enrich with internal parameters from agent state
      const enrichedInput = {
        ...llmInput,
        // Internal parameters injected from agent state (not from LLM)
        resultMode: state?.privateMode
          ? ("uids_only" as const)
          : ("summary" as const),
        secureMode: state?.privateMode || false,
        userQuery: state?.userQuery || "",
        excludeBlockUid: state?.rootUid || "",
        expansionLevel: state?.expansionLevel || 0,
        // Internal defaults not exposed to LLM
        purpose: "final" as const,
        sortBy: "relevance" as const,
        sortOrder: "desc" as const,
        limit: 500,
        summaryLimit: 20,
        childDepth: 2,
        parentDepth: 1,
        includeDaily: true,
        dailyNotesOnly: false,
        // Inject dateRange from agent state (not from LLM call)
        dateRange: state?.searchDetails?.timeRange,
        randomSample: { enabled: false, size: 100 },
        fuzzyThreshold: 0.8,
      };
      const { results, metadata } = await findBlocksByContentImpl(
        enrichedInput,
        state
      );
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
      "Find blocks by content, page references, or regex patterns. SIMPLE: Use 'conditions' array for basic AND/OR logic. GROUPED: Use 'conditionGroups' for complex logic like ((A|B) AND NOT C). Supports semantic expansion, date ranges, and hierarchical context.",
    schema: llmFacingSchema, // Use minimal schema for LLM
  }
);
