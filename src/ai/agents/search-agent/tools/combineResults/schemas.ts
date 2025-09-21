import { z } from "zod";

export const resultSetSchema = z.object({
  name: z.string().describe("Name identifier for this result set"),
  uids: z.array(z.string()).describe("Array of UIDs (blocks or pages)"),
  type: z
    .enum(["pages", "blocks"])
    .describe("Type of entities in this result set"),
  metadata: z
    .record(z.any())
    .optional().nullable()
    .describe("Additional metadata about the result set"),
});

export const schema = z.object({
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
    .optional().nullable()
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
export const llmFacingSchema = z.object({
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

export interface CombinedResult {
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