import { z } from "zod";

export const schema = z.object({
  // Input source - either direct UIDs/titles OR result references
  blockUids: z
    .array(z.string())
    .optional()
    .nullable()
    .describe("Array of block UIDs to extract references from"),
  pageUids: z
    .array(z.string())
    .optional()
    .nullable()
    .describe(
      "Array of page UIDs - will extract references from all blocks in these pages"
    ),
  pageTitles: z
    .array(z.string())
    .optional()
    .nullable()
    .describe(
      "Array of page titles - will extract references from all blocks in these pages"
    ),

  // NEW: Reference previous results by ID
  fromResultId: z
    .string()
    .optional()
    .nullable()
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
    .nullable()
    .describe(
      "Purpose: 'final' for user response data, 'intermediate' for non-final multi-step, 'replacement' to replace previous results, 'completion' to add to previous results"
    ),
  replacesResultId: z
    .string()
    .optional()
    .nullable()
    .describe(
      "If purpose is 'replacement', specify which result ID to replace (e.g., 'extractPageReferences_001')"
    ),
  completesResultId: z
    .string()
    .optional()
    .nullable()
    .describe(
      "If purpose is 'completion', specify which result ID this completes (e.g., 'findBlocksByContent_002')"
    ),
});

// Minimal LLM-facing schema - only essential parameters
export const llmFacingSchema = z.object({
  blockUids: z
    .array(z.string())
    .optional()
    .nullable()
    .describe("Block UIDs to analyze"),
  pageUids: z
    .array(z.string())
    .optional()
    .nullable()
    .describe("Page UIDs to analyze"),
  pageTitles: z
    .array(z.string())
    .optional()
    .nullable()
    .describe("Page titles to analyze"),
  fromResultId: z
    .string()
    .optional()
    .nullable()
    .describe(
      "Extract from previous search result (e.g., 'findBlocksByContent_001')"
    ),
  excludePages: z
    .array(z.string())
    .optional()
    .nullable()
    .describe("Page titles to exclude"),
  excludeDaily: z.boolean().default(false).describe("Exclude daily note pages"),
  // Result lifecycle management
  purpose: z
    .enum(["final", "intermediate", "replacement", "completion"])
    .optional()
    .nullable()
    .describe(
      "Purpose: 'final' for user response data, 'intermediate' for non-final multi-step, 'replacement' to replace previous results, 'completion' to add to previous results"
    ),
});
