import { z } from "zod";
import {
  baseConditionSchema,
  conditionGroupSchema,
  extendedConditionsSchema,
} from "../conditionGroupsUtils";

/**
 * Content condition schema for blocks-by-content specific search conditions
 */
export const contentConditionSchema = baseConditionSchema.extend({
  type: z
    .enum(["text", "page_ref", "block_ref", "regex", "page_ref_or"])
    .default("text"),
});

/**
 * Main schema extending extendedConditionsSchema with blocks-specific features
 */
export const schema = extendedConditionsSchema.extend({
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

/**
 * LLM-facing schema with minimal required fields
 */
export const llmFacingSchema = z.object({
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

// Export schema type for use in other modules
export type FindBlocksByContentInput = z.infer<typeof schema>;