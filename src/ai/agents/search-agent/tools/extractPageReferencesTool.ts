import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { executeDatomicQuery, isDailyNote } from "../helpers/searchUtils";
import { createToolResult } from "../helpers/semanticExpansion";

/**
 * Extract page references from blocks or pages
 * Security Level: Secure (only extracts page references, no block content)
 *
 * This tool efficiently extracts all page references from a given set of blocks or pages
 * using Roam's :block/refs attribute. Perfect for analytical queries after getting search results.
 */

const schema = z.object({
  // Input source - either direct UIDs/titles OR result references
  blockUids: z
    .array(z.string())
    .optional()
    .describe("Array of block UIDs to extract references from"),
  pageUids: z
    .array(z.string())
    .optional()
    .describe(
      "Array of page UIDs - will extract references from all blocks in these pages"
    ),
  pageTitles: z
    .array(z.string())
    .optional()
    .describe(
      "Array of page titles - will extract references from all blocks in these pages"
    ),

  // NEW: Reference previous results by ID
  fromResultId: z
    .string()
    .optional()
    .describe(
      "Extract references from blocks/pages in a previous search result (e.g., 'findBlocksByContent_001')"
    ),

  // Filtering options
  excludePages: z
    .array(z.string())
    .default([])
    .describe("Page titles to exclude from results"),
  excludeDaily: z
    .boolean()
    .default(false)
    .describe("Exclude daily note pages from results"),

  // Output options
  includeCount: z
    .boolean()
    .default(true)
    .describe("Include reference count for each page"),
  sortBy: z
    .enum(["count", "alphabetical", "none"])
    .default("count")
    .describe("How to sort results"),
  limit: z
    .number()
    .min(1)
    .max(500)
    .default(100)
    .describe("Maximum number of referenced pages to return"),
  minCount: z
    .number()
    .min(1)
    .default(1)
    .describe("Minimum reference count to include in results"),

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
      "If purpose is 'replacement', specify which result ID to replace (e.g., 'extractPageReferences_001')"
    ),
  completesResultId: z
    .string()
    .optional()
    .describe(
      "If purpose is 'completion', specify which result ID this completes (e.g., 'findBlocksByContent_002')"
    ),
});

// Minimal LLM-facing schema - only essential parameters
const llmFacingSchema = z.object({
  blockUids: z.array(z.string()).optional().describe("Block UIDs to analyze"),
  pageUids: z.array(z.string()).optional().describe("Page UIDs to analyze"),
  pageTitles: z.array(z.string()).optional().describe("Page titles to analyze"),
  fromResultId: z
    .string()
    .optional()
    .describe(
      "Extract from previous search result (e.g., 'findBlocksByContent_001')"
    ),
  excludePages: z
    .array(z.string())
    .optional()
    .describe("Page titles to exclude"),
  excludeDaily: z.boolean().default(false).describe("Exclude daily note pages"),
});

const extractPageReferencesImpl = async (
  input: z.infer<typeof schema>,
  state?: any
) => {
  const {
    blockUids,
    pageUids,
    pageTitles,
    fromResultId,
    excludePages,
    excludeDaily,
    includeCount,
    sortBy,
    limit,
    minCount,
  } = input;

  let finalBlockUids = blockUids || [];
  let finalPageUids = pageUids || [];
  let finalPageTitles = pageTitles || [];

  // Handle result ID reference - access previous results from state
  if (fromResultId && state) {
    const resultEntry = state.resultStore?.[fromResultId];
    if (!resultEntry) {
      const availableResults = Object.keys(state.resultStore || {});
      // Try to suggest a similar result ID
      const suggestedResult =
        availableResults.find((id) =>
          id.includes(fromResultId.split("_")[0])
        ) || availableResults[availableResults.length - 1];
      throw new Error(
        `Previous result ${fromResultId} not found. Available results: ${availableResults.join(
          ", "
        )}. Did you mean: ${suggestedResult}?`
      );
    }

    // Extract data from new or legacy structure
    const previousResult = resultEntry?.data || resultEntry;

    // Ensure previousResult is iterable (array)
    if (!Array.isArray(previousResult)) {
      throw new Error(
        `Previous result ${fromResultId} is not an array. Type: ${typeof previousResult}, Value: ${JSON.stringify(
          previousResult
        )}`
      );
    }

    // Extract UIDs and titles from previous result data
    for (const item of previousResult) {
      if (item.uid) {
        // Determine if this is a block or page based on data structure
        if (item.content !== undefined || item.pageTitle) {
          // This is a block result
          finalBlockUids.push(item.uid);
        } else if (item.title) {
          // This is a page result with title
          finalPageTitles.push(item.title);
        } else {
          // Fallback: treat as page UID
          finalPageUids.push(item.uid);
        }
      }

      if (item.pageUid && !finalPageUids.includes(item.pageUid)) {
        finalPageUids.push(item.pageUid);
      }

      if (item.pageTitle && !finalPageTitles.includes(item.pageTitle)) {
        finalPageTitles.push(item.pageTitle);
      }
    }
  }

  // FALLBACK: If no explicit input provided, try to auto-detect compatible previous results
  let fallbackResultId = fromResultId;
  if (
    !finalBlockUids.length &&
    !finalPageUids.length &&
    !finalPageTitles.length &&
    !fallbackResultId &&
    state?.resultStore
  ) {
    console.log(
      `No explicit input provided, attempting auto-fallback to recent compatible results`
    );

    const compatibleResultId = findMostRecentCompatibleResult(
      state.resultStore,
      ["blocks", "pages"]
    );
    if (compatibleResultId) {
      fallbackResultId = compatibleResultId;

      // Process the fallback result
      const resultEntry = state.resultStore[compatibleResultId];
      // Extract data from new or legacy structure
      const previousResult = resultEntry?.data || resultEntry;
      if (Array.isArray(previousResult)) {
        for (const item of previousResult) {
          if (item.uid) {
            if (item.content !== undefined || item.pageTitle) {
              finalBlockUids.push(item.uid);
            } else if (item.title) {
              finalPageTitles.push(item.title);
            } else {
              finalPageUids.push(item.uid);
            }
          }
          if (item.pageUid && !finalPageUids.includes(item.pageUid)) {
            finalPageUids.push(item.pageUid);
          }
          if (item.pageTitle && !finalPageTitles.includes(item.pageTitle)) {
            finalPageTitles.push(item.pageTitle);
          }
        }
        console.log(
          `🔄 Auto-extracted from fallback: ${finalBlockUids.length} blockUids, ${finalPageUids.length} pageUids, ${finalPageTitles.length} pageTitles`
        );
      }
    }
  }

  // Validate input - at least one source must be provided
  if (
    !finalBlockUids.length &&
    !finalPageUids.length &&
    !finalPageTitles.length
  ) {
    if (fallbackResultId) {
      throw new Error(
        `No valid UIDs or titles found in previous result ${fallbackResultId}`
      );
    } else {
      const availableResults = Object.keys(state?.resultStore || {});
      const compatibleResults = availableResults.filter((id) => {
        const result = state.resultStore[id];
        // Handle both new and legacy structure
        const data = result?.data || result;
        return Array.isArray(data) && data.length > 0;
      });

      throw new Error(
        `Must provide at least one of: blockUids, pageUids, pageTitles, or fromResultId. Available result IDs with data: ${compatibleResults.join(
          ", "
        )}. Use fromResultId: "RESULT_ID" to reference previous search results.`
      );
    }
  }

  // Step 1: Get all target block UIDs to analyze
  const targetBlockUids = await getTargetBlockUids(
    finalBlockUids,
    finalPageUids,
    finalPageTitles
  );

  if (targetBlockUids.length === 0) {
    console.log("📊 No target blocks found");
    return [];
  }

  console.log(`📊 Analyzing references from ${targetBlockUids.length} blocks`);

  // Step 2: Extract page references using :block/refs
  const pageReferences = await extractReferencesFromBlocks(targetBlockUids);

  console.log(`📊 Found ${pageReferences.length} raw page references`);

  // Step 3: Process, deduplicate, and count
  const processedReferences = processAndCountReferences(
    pageReferences,
    excludePages,
    excludeDaily,
    includeCount
  );

  console.log(
    `📊 After filtering: ${processedReferences.length} unique page references`
  );

  // Step 4: Filter by minimum count
  const filteredReferences = processedReferences.filter(
    (ref) => !includeCount || ref.count >= minCount
  );

  // Step 5: Sort results
  if (sortBy !== "none") {
    filteredReferences.sort((a, b) => {
      if (sortBy === "count" && includeCount) {
        return b.count - a.count; // Descending by count
      } else {
        return a.pageTitle.localeCompare(b.pageTitle); // Alphabetical
      }
    });
  }

  // Step 6: Limit results
  const limitedResults = filteredReferences.slice(0, limit);

  console.log(`📊 Returning ${limitedResults.length} page references`);
  return limitedResults;
};

/**
 * Get all target block UIDs from various input sources
 */
const getTargetBlockUids = async (
  blockUids?: string[],
  pageUids?: string[],
  pageTitles?: string[]
): Promise<string[]> => {
  let allBlockUids: string[] = [];

  // Add direct block UIDs
  if (blockUids?.length) {
    allBlockUids.push(...blockUids);
  }

  // Get blocks from page UIDs
  if (pageUids?.length) {
    const blocksFromPageUids = await getBlocksFromPageUids(pageUids);
    allBlockUids.push(...blocksFromPageUids);
  }

  // Get blocks from page titles
  if (pageTitles?.length) {
    const blocksFromPageTitles = await getBlocksFromPageTitles(pageTitles);
    allBlockUids.push(...blocksFromPageTitles);
  }

  // Remove duplicates
  return [...new Set(allBlockUids)];
};

/**
 * Get all block UIDs from pages by their UIDs
 */
const getBlocksFromPageUids = async (pageUids: string[]): Promise<string[]> => {
  const uidsClause = pageUids.map((uid) => `"${uid}"`).join(" ");

  const query = `[:find ?block-uid
                  :where
                  [?page :block/uid ?page-uid]
                  [(contains? #{${uidsClause}} ?page-uid)]
                  [?page :block/children ?block]
                  [?block :block/uid ?block-uid]]`;

  console.log("🔍 Getting blocks from page UIDs...");
  const results = await executeDatomicQuery(query);
  return results.map(([blockUid]) => blockUid as string);
};

/**
 * Get all block UIDs from pages by their titles
 */
const getBlocksFromPageTitles = async (
  pageTitles: string[]
): Promise<string[]> => {
  const titlesClause = pageTitles.map((title) => `"${title}"`).join(" ");

  const query = `[:find ?block-uid
                  :where
                  [?page :node/title ?page-title]
                  [(contains? #{${titlesClause}} ?page-title)]
                  [?page :block/children ?block]
                  [?block :block/uid ?block-uid]]`;

  console.log("🔍 Getting blocks from page titles...");
  const results = await executeDatomicQuery(query);
  return results.map(([blockUid]) => blockUid as string);
};

/**
 * Extract page references from blocks using :block/refs
 */
const extractReferencesFromBlocks = async (
  blockUids: string[]
): Promise<Array<{ pageTitle: string; pageUid: string }>> => {
  if (blockUids.length === 0) return [];

  // Split into chunks to avoid query size limits
  const chunkSize = 100;
  const chunks = [];
  for (let i = 0; i < blockUids.length; i += chunkSize) {
    chunks.push(blockUids.slice(i, i + chunkSize));
  }

  let allReferences: Array<{ pageTitle: string; pageUid: string }> = [];

  for (const chunk of chunks) {
    const uidsClause = chunk.map((uid) => `"${uid}"`).join(" ");

    const query = `[:find ?page-title ?page-uid
                    :where
                    [?block :block/uid ?block-uid]
                    [(contains? #{${uidsClause}} ?block-uid)]
                    [?block :block/refs ?ref-page]
                    [?ref-page :node/title ?page-title]
                    [?ref-page :block/uid ?page-uid]]`;

    console.log(`🔍 Extracting references from ${chunk.length} blocks...`);
    const results = await executeDatomicQuery(query);

    const chunkReferences = results.map(([pageTitle, pageUid]) => ({
      pageTitle: pageTitle as string,
      pageUid: pageUid as string,
    }));

    allReferences.push(...chunkReferences);
  }

  return allReferences;
};

/**
 * Find the most recent compatible result for auto-fallback
 */
const findMostRecentCompatibleResult = (
  resultStore: Record<string, any>,
  compatibleTypes: string[]
): string | null => {
  const resultEntries = Object.entries(resultStore)
    .filter(([id, result]) => {
      // Handle both new and legacy structure
      const data = result?.data || result;

      // Skip empty results
      if (!Array.isArray(data) || data.length === 0) {
        return false;
      }

      // Check if result contains blocks or pages
      const hasBlocks = data.some(
        (item) => item.content !== undefined || item.pageTitle
      );
      const hasPages = data.some((item) => item.title && !item.content);

      return (
        (compatibleTypes.includes("blocks") && hasBlocks) ||
        (compatibleTypes.includes("pages") && hasPages)
      );
    })
    .sort((a, b) => {
      // Sort by result ID (higher numbers = more recent)
      const idA = parseInt(a[0].split("_")[1] || "0");
      const idB = parseInt(b[0].split("_")[1] || "0");
      return idB - idA;
    });

  return resultEntries[0]?.[0] || null;
};

/**
 * Process references: deduplicate, count, and filter
 */
const processAndCountReferences = (
  references: Array<{ pageTitle: string; pageUid: string }>,
  excludePages: string[],
  excludeDaily: boolean,
  includeCount: boolean
): Array<{
  pageTitle: string;
  pageUid: string;
  count: number;
  isDaily: boolean;
}> => {
  // Count occurrences
  const countMap = new Map<
    string,
    { pageTitle: string; pageUid: string; count: number; isDaily: boolean }
  >();

  for (const ref of references) {
    const key = ref.pageUid;
    const isDaily = isDailyNote(ref.pageUid);

    // Apply filters
    if (excludePages.includes(ref.pageTitle)) continue;
    if (excludeDaily && isDaily) continue;

    if (countMap.has(key)) {
      countMap.get(key)!.count++;
    } else {
      countMap.set(key, {
        pageTitle: ref.pageTitle,
        pageUid: ref.pageUid,
        count: 1,
        isDaily,
        // Explicit type flag
        isPage: true,
      } as any);
    }
  }

  return Array.from(countMap.values());
};

export const extractPageReferencesTool = tool(
  async (llmInput, config) => {
    const startTime = performance.now();
    try {
      // Auto-enrich with internal parameters
      const enrichedInput = {
        ...llmInput,
        // Add default values for parameters hidden from LLM
        includeCount: true,
        sortBy: "count" as const,
        limit: 100,
        minCount: 1,
        excludePages: llmInput.excludePages || [],
        purpose: (llmInput as any).purpose || ("final" as const), // Preserve LLM's intent, default to final
      };

      // Extract state from config - passed via configurable.state
      const state = config?.configurable?.state;
      const results = await extractPageReferencesImpl(enrichedInput, state);
      return createToolResult(
        true,
        results,
        undefined,
        "extractPageReferences",
        startTime
      );
    } catch (error) {
      console.error("ExtractPageReferences tool error:", error);
      return createToolResult(
        false,
        undefined,
        error.message,
        "extractPageReferences",
        startTime
      );
    }
  },
  {
    name: "extractPageReferences",
    description:
      "Extract and count page references from blocks or pages. Perfect for analytical tasks after search results.",
    schema: llmFacingSchema, // Use minimal schema
  }
);
