import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createToolResult } from "../../helpers/semanticExpansion";
import { schema, llmFacingSchema, CombinedResult } from "./schemas";

/**
 * Combine and deduplicate results from multiple search operations
 * Security Level: Secure (only manipulates UIDs and metadata, no content access)
 *
 * This tool performs set operations (union, intersection, difference) on search results
 * and provides intelligent deduplication and merging capabilities.
 */

const combineResultsImpl = async (
  input: z.infer<typeof schema>
): Promise<CombinedResult> => {
  const {
    resultSets,
    operation,
    deduplicateWithin,
    deduplicateAcross,
    preserveOrder,
    orderBy,
    minAppearances,
    maxAppearances,
    includeStats,
    includeSourceInfo,
    limit,
  } = input;

  console.log(
    `🔄 CombineResults: ${operation} operation on ${resultSets.length} result sets`
  );

  console.log("resultSets :>> ", resultSets);

  // Validate that all result sets are the same type
  const types = [...new Set(resultSets.map((set) => set.type))];
  if (types.length > 1) {
    throw new Error(
      `Cannot combine different types: ${types.join(
        ", "
      )}. All result sets must be the same type.`
    );
  }
  const resultType = types[0];

  // Step 1: Preprocess result sets (deduplicate if requested)
  let processedSets = resultSets.map((set) => ({
    ...set,
    uids: deduplicateWithin ? [...new Set(set.uids)] : set.uids,
  }));

  // Step 2: Track source information if requested
  const sourceTracking: Record<string, string[]> = {};
  if (includeSourceInfo) {
    for (const set of processedSets) {
      for (const uid of set.uids) {
        if (!sourceTracking[uid]) {
          sourceTracking[uid] = [];
        }
        sourceTracking[uid].push(set.name);
      }
    }
  }

  // Step 3: Calculate appearance frequency
  const uidFrequency: Record<string, number> = {};
  for (const set of processedSets) {
    for (const uid of set.uids) {
      uidFrequency[uid] = (uidFrequency[uid] || 0) + 1;
    }
  }

  // Step 4: Perform the set operation
  let combinedUids: string[] = [];

  switch (operation) {
    case "union":
      combinedUids = performUnion(processedSets);
      break;

    case "intersection":
      combinedUids = performIntersection(processedSets);
      break;

    case "difference":
      combinedUids = performDifference(processedSets);
      break;

    case "symmetric_difference":
      combinedUids = performSymmetricDifference(processedSets);
      break;
  }

  // Step 5: Apply frequency filtering
  combinedUids = combinedUids.filter((uid) => {
    const frequency = uidFrequency[uid];
    return (
      frequency >= minAppearances &&
      (maxAppearances === undefined || frequency <= maxAppearances)
    );
  });

  // Step 6: Deduplicate across sets if requested
  if (deduplicateAcross) {
    combinedUids = [...new Set(combinedUids)];
  }

  // Step 7: Apply ordering
  combinedUids = applyOrdering(
    combinedUids,
    orderBy,
    uidFrequency,
    processedSets,
    preserveOrder
  );

  console.log("combinedUids :>> ", combinedUids);

  // Step 8: Apply limit
  if (combinedUids.length > limit) {
    combinedUids = combinedUids.slice(0, limit);
  }

  // Step 9: Calculate statistics
  const stats = calculateStats(processedSets, combinedUids, operation);

  console.log("stats :>> ", stats);

  // Step 10: Build result
  const result: CombinedResult = {
    uids: combinedUids,
    type: resultType,
    operation,
    stats,
  };

  if (includeSourceInfo) {
    result.sourceInfo = Object.fromEntries(
      combinedUids.map((uid) => [uid, sourceTracking[uid] || []])
    );
  }

  return result;
};

/**
 * Perform union operation (combine all unique UIDs)
 */
const performUnion = (resultSets: any[]): string[] => {
  const allUids = resultSets.flatMap((set) => set.uids);
  return [...new Set(allUids)];
};

/**
 * Perform intersection operation (UIDs present in ALL sets)
 */
const performIntersection = (resultSets: any[]): string[] => {
  if (resultSets.length === 0) return [];
  if (resultSets.length === 1)
    return [...new Set(resultSets[0].uids as string[])];

  let intersection = new Set(resultSets[0].uids as string[]);

  for (let i = 1; i < resultSets.length; i++) {
    const currentSet = new Set(resultSets[i].uids as string[]);
    intersection = new Set(
      [...intersection].filter((uid) => currentSet.has(uid))
    );
  }

  return [...intersection];
};

/**
 * Perform difference operation (UIDs in first set but not in others)
 */
const performDifference = (resultSets: any[]): string[] => {
  if (resultSets.length === 0) return [];
  if (resultSets.length === 1)
    return [...new Set(resultSets[0].uids as string[])];

  let difference = new Set(resultSets[0].uids as string[]);

  for (let i = 1; i < resultSets.length; i++) {
    const currentSet = new Set(resultSets[i].uids as string[]);
    difference = new Set([...difference].filter((uid) => !currentSet.has(uid)));
  }

  return [...difference];
};

/**
 * Perform symmetric difference (UIDs in exactly one set)
 */
const performSymmetricDifference = (resultSets: any[]): string[] => {
  const uidCounts: Record<string, number> = {};

  for (const set of resultSets) {
    for (const uid of set.uids) {
      uidCounts[uid] = (uidCounts[uid] || 0) + 1;
    }
  }

  return Object.keys(uidCounts).filter((uid) => uidCounts[uid] === 1);
};

/**
 * Apply ordering to the combined results
 */
const applyOrdering = (
  uids: string[],
  orderBy: string,
  uidFrequency: Record<string, number>,
  processedSets: any[],
  preserveOrder: boolean
): string[] => {
  switch (orderBy) {
    case "alphabetical":
      return [...uids].sort();

    case "frequency":
      return [...uids].sort((a, b) => uidFrequency[b] - uidFrequency[a]);

    case "reverse_frequency":
      return [...uids].sort((a, b) => uidFrequency[a] - uidFrequency[b]);

    case "first_appearance":
    default:
      if (preserveOrder) {
        // Maintain the order from the first set where each UID appears
        const orderMap: Record<string, number> = {};
        let orderIndex = 0;

        for (const set of processedSets) {
          for (const uid of set.uids) {
            if (!(uid in orderMap)) {
              orderMap[uid] = orderIndex++;
            }
          }
        }

        return [...uids].sort(
          (a, b) => (orderMap[a] || 0) - (orderMap[b] || 0)
        );
      }
      return uids; // Return as-is
  }
};

/**
 * Calculate statistics about the combination operation
 */
const calculateStats = (
  processedSets: any[],
  combinedUids: string[],
  operation: string
) => {
  const totalInputUids = processedSets.reduce(
    (sum, set) => sum + set.uids.length,
    0
  );
  const allUniqueUids = new Set(processedSets.flatMap((set) => set.uids));
  const uniqueInputUids = allUniqueUids.size;
  const finalCount = combinedUids.length;
  const duplicatesRemoved = totalInputUids - uniqueInputUids;

  // Calculate operation-specific counts
  const operationCounts: Record<string, number> = {};
  operationCounts[`input_sets`] = processedSets.length;
  operationCounts[`total_input_uids`] = totalInputUids;
  operationCounts[`unique_input_uids`] = uniqueInputUids;
  operationCounts[`final_result_count`] = finalCount;

  // Add per-set counts
  processedSets.forEach((set, index) => {
    operationCounts[`set_${index + 1}_count`] = set.uids.length;
  });

  return {
    totalInputUids,
    uniqueInputUids,
    finalCount,
    duplicatesRemoved,
    operationCounts,
  };
};

/**
 * Helper function to create a result set from arrays (for convenience)
 */
export const createResultSet = (
  name: string,
  uids: string[],
  type: "pages" | "blocks",
  metadata?: Record<string, any>
) => ({
  name,
  uids,
  type,
  metadata,
});

/**
 * Helper function to resolve result IDs to actual result sets
 * Returns both the result sets (with UIDs) and a map of UIDs to full result objects
 */
const resolveResultSets = (
  resultSetsInput: any[],
  state?: any
): {
  resultSets: Array<{ name: string; uids: string[]; type: "pages" | "blocks"; metadata?: any }>;
  uidToResultMap: Record<string, any>;
} => {
  const resultSets: Array<{ name: string; uids: string[]; type: "pages" | "blocks"; metadata?: any }> = [];
  const uidToResultMap: Record<string, any> = {};

  for (const [index, item] of resultSetsInput.entries()) {
    // If it's already a full result set object, return it
    if (typeof item === "object" && item.uids && item.type) {
      resultSets.push({
        ...item,
        metadata: item.metadata || {},
      });
      continue;
    }

    // If it's a string (result ID), look it up in the resultStore
    if (typeof item === "string") {
      const resultId = item;

      if (!state?.resultStore) {
        throw new Error(
          `Cannot resolve result ID '${resultId}': No resultStore available in state`
        );
      }

      const resultEntry = state.resultStore[resultId];
      if (!resultEntry) {
        const availableResults = Object.keys(state.resultStore || {}).join(", ");
        throw new Error(
          `Result ID '${resultId}' not found in resultStore. Available results: ${availableResults || "none"}`
        );
      }

      // Extract the data from the stored result
      const storedData = resultEntry.data || resultEntry;
      if (!Array.isArray(storedData)) {
        throw new Error(
          `Result ID '${resultId}' does not contain an array of results`
        );
      }

      // Determine the type and build UID mapping
      let resultType: "pages" | "blocks" = "blocks";
      const uids: string[] = [];

      for (const result of storedData) {
        if (result.uid) {
          uids.push(result.uid);
          // Store the full result object in the map
          uidToResultMap[result.uid] = result;

          // Check if it's a page or block
          if (result.title !== undefined || result.isPage) {
            resultType = "pages";
          }
        }
      }

      resultSets.push({
        name: resultId,
        uids,
        type: resultType,
        metadata: resultEntry.metadata || {},
      });
      continue;
    }

    throw new Error(
      `Invalid result set at index ${index}: Expected a result ID string or a result set object`
    );
  }

  return { resultSets, uidToResultMap };
};

export const combineResultsTool = tool(
  async (llmInput, config) => {
    const startTime = performance.now();
    try {
      // Extract state from config
      const state = config?.configurable?.state;

      console.log(
        `🔧 [combineResults] Tool called with ${llmInput.resultSets.length} result sets`
      );

      // Resolve result IDs to actual result sets and get UID-to-result mapping
      const { resultSets: resolvedResultSets, uidToResultMap } =
        resolveResultSets(llmInput.resultSets, state);

      // Auto-enrich with internal parameters
      const enrichedInput = {
        ...llmInput,
        // Add default values for parameters hidden from LLM
        deduplicateWithin: true,
        deduplicateAcross: true,
        preserveOrder: false,
        orderBy: "first_appearance" as const,
        minAppearances: 1,
        includeStats: true,
        includeSourceInfo: false,
        limit: 1000,
        // Use resolved result sets
        resultSets: resolvedResultSets,
      };

      const combinedResults = await combineResultsImpl(enrichedInput);

      // Enrich the combined UIDs with full result objects
      const enrichedData = combinedResults.uids
        .map(uid => uidToResultMap[uid])
        .filter(result => result !== undefined); // Filter out any UIDs not found in the map

      console.log(
        `🔧 [combineResults] Enriched ${enrichedData.length} results with full data`
      );

      return createToolResult(
        true,
        enrichedData, // Return full result objects instead of just combinedResults
        undefined, // no error
        "combineResults",
        startTime,
        {
          ...combinedResults.stats,
          operation: combinedResults.operation,
          resultType: combinedResults.type,
        }
      );
    } catch (error) {
      console.error("CombineResults tool error:", error);
      return createToolResult(
        false,
        undefined,
        error.message,
        "combineResults",
        startTime
      );
    }
  },
  {
    name: "combineResults",
    description:
      "Combine and deduplicate results from multiple search operations using set operations (union, intersection, difference). Pass result IDs from previous searches (e.g., ['findPagesByTitle_001', 'findBlocksByContent_002']).",
    schema: llmFacingSchema, // Use minimal schema
  }
);
