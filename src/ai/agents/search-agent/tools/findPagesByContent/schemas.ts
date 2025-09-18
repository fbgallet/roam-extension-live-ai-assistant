import { z } from "zod";
import {
  baseConditionSchema,
  conditionGroupSchema,
  extendedConditionsSchema,
} from "../../helpers/conditionGroupsUtils";

/**
 * Content condition schema for pages-by-content specific search conditions
 */
export const contentConditionSchema = baseConditionSchema.extend({
  type: z
    .enum(["text", "page_ref", "block_ref", "regex", "page_ref_or"])
    .default("text")
    .describe(
      "text=content search, page_ref=[[page]] reference, regex=pattern matching"
    ),
  text: z
    .string()
    .min(1, "Search text is required")
    .describe(
      "Search text, page name, or regex pattern. For attributes use format: attr:key:type:value or attr:key:type:(A + B - C)"
    ),
});

/**
 * LLM-facing schema with both simple and grouped conditions support
 */
export const llmFacingSchema = z.object({
  // Simple conditions (backward compatible)
  conditions: z
    .array(
      z.object({
        text: z
          .string()
          .min(1, "Search text is required")
          .describe(
            "Search text, page name, or regex pattern. For attributes use format: attr:key:type:value"
          ),
        type: z
          .enum(["text", "page_ref", "block_ref", "regex", "page_ref_or"])
          .default("text")
          .describe(
            "text=content search, page_ref=[[page]] reference, regex=pattern matching"
          ),
        matchType: z
          .enum(["exact", "contains", "regex"])
          .default("contains")
          .describe(
            "contains=phrase within content, exact=entire content matches"
          ),
        semanticExpansion: z
          .enum([
            "fuzzy",
            "synonyms",
            "related_concepts",
            "broader_terms",
            "custom",
            "all",
          ])
          .optional()
          .describe(
            "Semantic expansion strategy to apply. Use 'fuzzy' for typos, 'synonyms' for alternatives, 'related_concepts' for associated terms, 'all' for chained expansion"
          ),
        negate: z
          .boolean()
          .default(false)
          .describe("Exclude content matching this condition"),
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

  // Search scope specification - CRITICAL for Assistant LLM
  searchScope: z
    .enum(["content", "block"])
    .default("block")
    .describe(
      "SCOPE: 'content' = conditions can match across different blocks in page (content-wide AND), 'block' = all conditions must match within same blocks"
    ),

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
  minBlockCount: z
    .number()
    .min(1)
    .default(1)
    .describe("Minimum blocks that must match per page"),
  maxBlockCount: z
    .union([z.number().min(1), z.null()])
    .default(null)
    .describe("Maximum blocks that can match per page (null = unlimited)"),
  includeBlockSamples: z
    .boolean()
    .default(true)
    .describe("Include sample matching blocks in results"),
  maxSamples: z
    .number()
    .min(1)
    .max(20)
    .default(5)
    .describe("Max sample blocks per page"),
  sortBy: z
    .enum([
      "relevance",
      "creation",
      "modification",
      "recent",
      "random",
      "alphabetical",
      "block_count",
      "total_blocks",
    ])
    .default("relevance")
    .describe("Sort pages by this criteria"),
  limit: z
    .number()
    .min(1)
    .max(1000)
    .default(200)
    .describe("Maximum pages to return"),
  fromResultId: z
    .string()
    .optional()
    .describe(
      "Limit to pages from previous result (e.g., 'findPagesByTitle_001') - major performance boost"
    ),
  excludeBlockUid: z
    .string()
    .optional()
    .describe(
      "Block UID to exclude from search (typically the user's query block)"
    ),
});

/**
 * Main schema extending extendedConditionsSchema with content-specific features
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
  maxExpansions: z.number().min(1).max(10).default(3),

  // Search scope specification
  searchScope: z
    .enum(["content", "block"])
    .default("block")
    .describe(
      "SCOPE: 'content' = conditions can match across different blocks in page (page-wide AND), 'block' = all conditions must match within same blocks"
    ),

  // Page-level filtering
  minBlockCount: z
    .number()
    .min(1)
    .default(1)
    .describe("Minimum blocks that must match per page"),
  maxBlockCount: z
    .union([z.number().min(1), z.null()])
    .default(null)
    .describe("Maximum blocks that can match per page (null = unlimited)"),
  minTotalBlocks: z
    .number()
    .min(1)
    .default(1)
    .describe("Minimum total blocks page must have"),
  maxTotalBlocks: z
    .number()
    .optional()
    .describe("Maximum total blocks page can have"),

  // Content analysis
  includeBlockCount: z
    .boolean()
    .default(true)
    .describe("Include matching block count in results"),
  includeBlockSamples: z
    .boolean()
    .default(true)
    .describe("Include sample matching blocks"),
  maxSamples: z
    .number()
    .min(1)
    .max(20)
    .default(5)
    .describe("Max sample blocks per page"),
  includeContentStats: z
    .boolean()
    .default(false)
    .describe("Include content statistics"),

  // Filtering
  includeDaily: z.boolean().default(true),
  dateRange: z
    .object({
      start: z.union([z.date(), z.string()]).optional(),
      end: z.union([z.date(), z.string()]).optional(),
      filterMode: z.enum(["created", "modified"]).optional(),
    })
    .optional(),
  // Enhanced sorting and sampling options
  sortBy: z
    .enum([
      "relevance",
      "creation",
      "modification",
      "alphabetical",
      "recent",
      "random",
      "block_count",
      "total_blocks",
    ])
    .default("relevance"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  limit: z.number().min(1).max(10000).default(200), // Increased limits

  // Random sampling for large datasets
  randomSample: z
    .object({
      enabled: z.boolean().default(false),
      size: z.number().min(1).max(5000).default(100),
      seed: z
        .number()
        .optional()
        .describe("Seed for reproducible random sampling"),
    })
    .optional(),

  // Security mode
  secureMode: z
    .boolean()
    .default(false)
    .describe(
      "If true, excludes block content from results (UIDs and metadata only)"
    ),

  // UID-based filtering for optimization
  fromResultId: z
    .string()
    .optional()
    .describe(
      "Limit search to pages from previous result (e.g., 'findBlocksByContent_001')"
    ),
  limitToPageUids: z
    .array(z.string())
    .optional()
    .describe("Limit search to specific page UIDs"),

  // Block UID exclusion - exclude blocks (and thus their pages) from search
  excludeBlockUid: z
    .string()
    .optional()
    .describe(
      "Block UID to exclude from search (typically the user's query block)"
    ),
});

/**
 * Attribute condition interfaces for handling structured attribute searches
 */
export interface AttributeValue {
  value: string;
  operator: "+" | "|" | "-"; // AND, OR, NOT
}

export interface AttributeCondition {
  attributeKey: string;
  valueType: "text" | "page_ref" | "regex";
  values: AttributeValue[];
}

// Export schema type for use in other modules
export type FindPagesByContentInput = z.infer<typeof schema>;
