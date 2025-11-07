import { z } from "zod";
import { baseConditionSchema } from "../../helpers/conditionGroupsUtils";

/**
 * Schema definitions for findPagesByTitle tool
 * Security Level: Secure (only accesses UIDs, titles, metadata)
 */

// Extend base condition schema for page title specific needs
export const titleConditionSchema = baseConditionSchema.extend({
  isSemanticPage: z.boolean().optional().nullable(), // Flag for exact titles found via semantic expansion
  expansionLevel: z.number().optional().nullable(), // Track expansion level for relevance scoring
});

export const schema = z.object({
  conditions: z
    .array(titleConditionSchema)
    .min(1, "At least one condition is required"),
  combineConditions: z.enum(["AND", "OR"]).default("AND"),
  includeDaily: z.boolean().default(false),
  dateRange: z
    .object({
      start: z.union([z.date(), z.string()]).optional().nullable(),
      end: z.union([z.date(), z.string()]).optional().nullable(),
      filterMode: z.enum(["created", "modified"]).optional().nullable(),
    })
    .optional()
    .nullable(),
  limit: z.number().min(1).max(10000).optional().nullable(),
});

// LLM-facing schema with semantic expansion support
export const llmFacingSchema = z.object({
  conditions: z
    .array(
      z.object({
        text: z
          .string()
          .min(
            1,
            "Page title or pattern to search for. For regex patterns, use clean pattern syntax (e.g., 'test.*page' or '(?i)status|state') without /regex:/ or /pattern/flags wrapper. Add '*' suffix for fuzzy matching or '~' suffix for semantic expansion."
          ),
        matchType: z
          .enum(["exact", "contains", "regex"])
          .default("contains")
          .describe(
            "exact=exact title match, contains=partial title match, regex=pattern matching. For regex: use matchType='regex' and put just the pattern in text field (e.g., text='test.*page', not 'regex:/test.*page/i')"
          ),
        semanticExpansion: z
          .enum([
            "fuzzy",
            "synonyms",
            "related_concepts",
            "broader_terms",
            "custom",
            "all",
            "automatic",
          ])
          .optional()
          .describe(
            "Semantic expansion strategy (only when explicitly requested): fuzzy=typos/variations, synonyms=alternative terms, related_concepts=associated terms, broader_terms=categories, all=comprehensive expansion, automatic=progressive expansion until results (use sparingly)"
          ),
        negate: z
          .boolean()
          .default(false)
          .describe("Exclude pages matching this condition"),
      })
    )
    .min(1, "At least one search condition required"),
  combineConditions: z
    .enum(["AND", "OR"])
    .default("AND")
    .describe("AND=all conditions must match, OR=any condition matches"),
  includeDaily: z
    .boolean()
    .default(false)
    .describe("Include Daily Note Pages in results"),
  dateRange: z
    .object({
      start: z
        .string()
        .optional()
        .describe("Start date (YYYY-MM-DD)"),
      end: z.string().optional().describe("End date (YYYY-MM-DD)"),
      filterMode: z.enum(["created", "modified"]).optional(),
    })
    .optional()
    .describe("Limit to pages created/modified within date range"),
  limit: z
    .number()
    .min(1)
    .max(10000)
    .optional()
    .describe("Maximum number of results to return. If not specified, returns all matching pages. Results are sorted by relevance and modification date."),
  // Result lifecycle management
  purpose: z
    .enum(["final", "intermediate", "replacement", "completion"])
    .optional()
    .describe(
      "Purpose of these results: 'final' (default) for single-step queries where results go directly to user, 'intermediate' only for multi-step queries (PIPE/UNION/INTERSECTION), 'replacement' to replace previous results, 'completion' to add to previous results. IMPORTANT: Use 'final' or omit this parameter for normal queries."
    ),
});
