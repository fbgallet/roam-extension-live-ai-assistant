import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { isDailyNote } from "../../helpers/searchUtils";
import { createToolResult } from "../../helpers/semanticExpansion";
import { schema, llmFacingSchema } from "./schemas";
import {
  getTargetBlockUids,
  extractReferencesFromBlocks,
} from "./executors";

/**
 * Extract page references from blocks or pages
 * Security Level: Secure (only extracts page references, no block content)
 *
 * This tool efficiently extracts all page references from a given set of blocks or pages
 * using Roam's :block/refs attribute. Perfect for analytical queries after getting search results.
 */

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
    return [];
  }

  // Step 2: Extract page references using :block/refs
  const pageReferences = await extractReferencesFromBlocks(targetBlockUids);

  // Step 3: Process, deduplicate, and count
  const processedReferences = processAndCountReferences(
    pageReferences,
    excludePages,
    excludeDaily,
    includeCount
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

  return limitedResults;
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