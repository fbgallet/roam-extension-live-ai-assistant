import { z } from "zod";

/**
 * Schema definitions for findDailyNotesByPeriod tool
 * Uses 'dateRange' parameter to match other search tools
 * Security Level: Secure (only accesses UIDs, titles, metadata)
 */

export const schema = z.object({
  dateRange: z.object({
    start: z.union([z.date(), z.string()]).describe("Start date (YYYY-MM-DD or Date object)"),
    end: z.union([z.date(), z.string()]).describe("End date (YYYY-MM-DD or Date object)"),
    filterMode: z.enum(["created", "modified"]).optional().default("modified").describe("Filter by creation or modification date"),
  }).describe("Date range to search for Daily Notes Pages"),
  limit: z.number().min(1).max(1000).default(1000).describe("Maximum number of DNP results to return"),
});

// LLM-facing schema with clearer descriptions
export const llmFacingSchema = z.object({
  dateRange: z.object({
    start: z.string().describe("Start date in YYYY-MM-DD format (e.g., '2024-01-01')"),
    end: z.string().describe("End date in YYYY-MM-DD format (e.g., '2024-12-31')"),
    filterMode: z.enum(["created", "modified"]).optional().default("modified").describe("Filter by 'created' (page creation date) or 'modified' (last edit date). Default: 'modified'"),
  }).describe("Date range for Daily Notes Pages. All DNPs between start and end dates (inclusive) will be retrieved."),
  limit: z.number().min(1).max(1000).default(1000).describe("Maximum number of DNP results to return. Default: 1000"),
  // Result lifecycle management
  purpose: z
    .enum(["final", "intermediate", "replacement", "completion"])
    .optional()
    .describe(
      "Purpose: 'final' for user response data, 'intermediate' for non-final multi-step, 'replacement' to replace previous results, 'completion' to add to previous results"
    ),
});
