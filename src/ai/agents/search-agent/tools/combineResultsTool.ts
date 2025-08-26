import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createToolResult } from "../helpers/searchUtils";

/**
 * Combine and deduplicate results from multiple search operations
 * Security Level: Secure (only manipulates UIDs and metadata, no content access)
 *
 * This tool performs set operations (union, intersection, difference) on search results
 * and provides intelligent deduplication and merging capabilities.
 */

const resultSetSchema = z.object({
  name: z.string().describe("Name identifier for this result set"),
  uids: z.array(z.string()).describe("Array of UIDs (blocks or pages)"),
  type: z
    .enum(["pages", "blocks"])
    .describe("Type of entities in this result set"),
  metadata: z
    .record(z.any())
    .optional()
    .describe("Additional metadata about the result set"),
});

const schema = z.object({
  resultSets: z
    .array(resultSetSchema)
    .min(2, "At least two result sets are required for combination"),
  operation: z
    .enum(["union", "intersection", "difference", "symmetric_difference"])
    .default("union")
    .describe("Set operation to perform"),

  // Deduplication options
  deduplicateWithin: z
    .boolean()
    .default(true)
    .describe("Remove duplicates within each result set before combining"),
  deduplicateAcross: z
    .boolean()
    .default(true)
    .describe("Remove duplicates across result sets after combining"),

  // Merging options
  preserveOrder: z
    .boolean()
    .default(false)
    .describe("Attempt to preserve original ordering where possible"),
  orderBy: z
    .enum([
      "first_appearance",
      "alphabetical",
      "frequency",
      "reverse_frequency",
    ])
    .default("first_appearance")
    .describe("How to order the final results"),

  // Filtering options
  minAppearances: z
    .number()
    .min(1)
    .default(1)
    .describe("Minimum times a UID must appear across all sets to be included"),
  maxAppearances: z
    .number()
    .optional()
    .describe("Maximum times a UID can appear across all sets"),

  // Output options
  includeStats: z
    .boolean()
    .default(true)
    .describe("Include statistics about the combination operation"),
  includeSourceInfo: z
    .boolean()
    .default(false)
    .describe("Include information about which sets each UID came from"),
  limit: z
    .number()
    .min(1)
    .max(10000)
    .default(1000)
    .describe("Maximum number of results to return"),
});

// Minimal LLM-facing schema - only essential parameters
const llmFacingSchema = z.object({
  resultSets: z
    .array(
      z.object({
        name: z.string().describe("Name identifier for this result set"),
        uids: z
          .array(z.string())
          .describe("Array of UIDs from previous search results"),
        type: z
          .enum(["pages", "blocks"])
          .describe("Type of entities (pages or blocks)"),
      })
    )
    .min(2, "At least two result sets required"),
  operation: z
    .enum(["union", "intersection", "difference", "symmetric_difference"])
    .default("union")
    .describe("union=A+B, intersection=A∩B, difference=A-B"),
});

interface CombinedResult {
  uids: string[];
  type: "pages" | "blocks";
  operation: string;
  stats: {
    totalInputUids: number;
    uniqueInputUids: number;
    finalCount: number;
    duplicatesRemoved: number;
    operationCounts: Record<string, number>;
  };
  sourceInfo?: Record<string, string[]>; // UID -> source set names
  metadata?: Record<string, any>;
}

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

  // Step 8: Apply limit
  if (combinedUids.length > limit) {
    combinedUids = combinedUids.slice(0, limit);
  }

  // Step 9: Calculate statistics
  const stats = calculateStats(processedSets, combinedUids, operation);

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

export const combineResultsTool = tool(
  async (llmInput) => {
    const startTime = performance.now();
    try {
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
        // Auto-enrich resultSets with metadata if missing
        resultSets: llmInput.resultSets.map((rs: any) => ({
          ...rs,
          metadata: rs.metadata || {},
        })),
      };

      const results = await combineResultsImpl(enrichedInput);
      return createToolResult(
        true,
        results,
        undefined,
        "combineResults",
        startTime
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
      "Combine and deduplicate results from multiple search operations using set operations (union, intersection, difference).",
    schema: llmFacingSchema, // Use minimal schema
  }
);
