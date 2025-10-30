import { z } from "zod";
import type { SearchCondition } from "../../helpers/searchUtils";

/**
 * Hierarchical expression types for enhanced search capabilities
 */
export interface HierarchicalExpression {
  type:
    | "simple"
    | "strict_hierarchy"
    | "deep_strict_hierarchy"
    | "flexible_hierarchy"
    | "bidirectional"
    | "deep_bidirectional"
    | "strict_hierarchy_left"
    | "deep_strict_hierarchy_left"
    | "flexible_hierarchy_left"
    | "flexible_hierarchy_right"
    | "deep_flexible_hierarchy";
  operator:
    | ">"
    | ">>"
    | "=>"
    | "<=>"
    | "<<=>>"
    | "<"
    | "<<"
    | "<="
    | "=>>"
    | "<<=";
  leftOperand: SearchTerm | CompoundExpression;
  rightOperand: SearchTerm | CompoundExpression;
  maxDepth?: number;
}

export interface SearchTerm {
  type: "term";
  text: string;
  searchType?: "text" | "page_ref" | "regex";
  regexFlags?: string;
  conditions?: SearchCondition[];
}

export interface CompoundExpression {
  type: "compound";
  operator: "AND" | "OR";
  operands: (SearchTerm | CompoundExpression)[];
}

export type ParsedExpression =
  | HierarchicalExpression
  | SearchTerm
  | CompoundExpression;

// Schema definitions
export const hierarchyConditionSchema = z.object({
  direction: z
    .enum(["descendants", "ancestors"])
    .describe("Search in descendants (children) or ancestors (parents)"),
  levels: z.number().min(1).max(10).default(3),
  conditions: z
    .array(
      z.object({
        type: z
          .enum(["text", "page_ref", "block_ref", "regex"])
          .default("text"),
        text: z.string().min(1),
        matchType: z.enum(["exact", "contains", "regex"]).default("contains"),
        weight: z.number().min(0).max(10).default(1.0),
        negate: z.boolean().default(false),
      })
    )
    .min(1),
});

export const contentConditionSchema = z.object({
  type: z
    .enum(["text", "page_ref", "block_ref", "regex", "page_ref_or"])
    .default("text"),
  text: z.string().min(1, "Search text is required"),
  matchType: z.enum(["exact", "contains", "regex"]).default("contains"),
  semanticExpansion: z
    .union([
      z.enum([
        "fuzzy",
        "synonyms",
        "related_concepts",
        "broader_terms",
        "custom",
        "all",
      ]),
      z.null(),
    ])
    .default(null)
    .describe(
      "Semantic expansion strategy to apply. Use 'fuzzy' for typos, 'synonyms' for alternatives, 'related_concepts' for associated terms, 'all' for chained expansion"
    ),
  weight: z.number().min(0).max(10).default(1.0),
  negate: z.boolean().default(false),
});

// OpenAI-compatible schema following the array pattern used by working tools
export const hierarchySearchConditionSchema = z.object({
  type: z.enum(["text", "page_ref", "block_ref", "regex"]).default("text"),
  text: z.string().min(1),
  matchType: z.enum(["exact", "contains", "regex"]).default("contains"),
  semanticExpansion: z
    .union([
      z.enum([
        "fuzzy",
        "synonyms",
        "related_concepts",
        "broader_terms",
        "custom",
        "all",
      ]),
      z.null(),
    ])
    .default(null),
  weight: z.number().min(0).max(10).default(1.0),
  negate: z.boolean().default(false),
});

// Condition group schema for complex logic like ((A|B) AND NOT C)
export const conditionGroupSchema = z.object({
  conditions: z.array(hierarchySearchConditionSchema).min(1).max(5),
  combination: z.enum(["AND", "OR"]).default("AND"),
});

// OpenAI-compatible hierarchy condition using arrays instead of complex unions
export const openaiHierarchyConditionSchema = z.object({
  operator: z.enum([
    ">",
    "<",
    ">>",
    "<<",
    "=>",
    "<=",
    "=>>",
    "<<=",
    "<=>",
    "<<=>>",
  ]),

  // Simple conditions (existing - backward compatible)
  leftConditions: z
    .array(hierarchySearchConditionSchema)
    .min(1)
    .max(10)
    .optional()
    .nullable(),
  leftCombination: z.enum(["AND", "OR"]).default("AND"),
  rightConditions: z
    .array(hierarchySearchConditionSchema)
    .min(1)
    .max(10)
    .optional()
    .nullable(),
  rightCombination: z.enum(["AND", "OR"]).default("AND"),

  // Grouped conditions (new - for complex logic)
  leftConditionGroups: z
    .array(conditionGroupSchema)
    .min(1)
    .max(5)
    .optional()
    .nullable(),
  leftGroupCombination: z.enum(["AND", "OR"]).default("AND"),
  rightConditionGroups: z
    .array(conditionGroupSchema)
    .min(1)
    .max(5)
    .optional()
    .nullable(),
  rightGroupCombination: z.enum(["AND", "OR"]).default("AND"),

  maxDepth: z.union([z.number().min(1).max(10), z.null()]).default(null),
});

export const schema = z.object({
  contentConditions: z
    .array(contentConditionSchema)
    .default([])
    .describe(
      "Content conditions for blocks. Can be empty when using hierarchyCondition."
    ),
  hierarchyConditions: z
    .union([z.array(hierarchyConditionSchema), z.null()])
    .default(null),
  combineConditions: z.enum(["AND", "OR"]).default("AND"),
  combineHierarchy: z.enum(["AND", "OR"]).default("OR"),
  includeChildren: z.boolean().default(false),
  childDepth: z.number().min(1).max(5).default(1),
  includeParents: z.boolean().default(false),
  parentDepth: z.number().min(1).max(3).default(1),
  includeDaily: z.boolean().default(true),
  dateRange: z
    .union([
      z.object({
        start: z.union([z.string(), z.null()]).default(null),
        end: z.union([z.string(), z.null()]).default(null),
        filterMode: z.enum(["created", "modified"]).optional().nullable(),
      }),
      z.null(),
    ])
    .default(null),
  sortBy: z
    .enum(["relevance", "recent", "page_title", "hierarchy_depth"])
    .default("relevance"),
  limit: z.number().min(1).max(500).default(50),

  // Security mode
  secureMode: z
    .boolean()
    .default(false)
    .describe(
      "If true, excludes full block content from results (UIDs and metadata only)"
    ),

  // Modern structured hierarchy condition - OpenAI-compatible with nullable union
  hierarchyCondition: z
    .union([openaiHierarchyConditionSchema, z.null()])
    .default(null)
    .describe(
      "PREFERRED: Structured hierarchy condition. SIMPLE: Use leftConditions/rightConditions for basic logic. GROUPED: Use leftConditionGroups/rightConditionGroups for complex logic like ((A|B) AND NOT C). Example simple: {operator: '>', leftConditions: [...], leftCombination: 'AND', rightConditions: [...]}. Example grouped: {operator: '>', leftConditionGroups: [{conditions: [...], combination: 'OR'}, {conditions: [{...negate:true}], combination: 'AND'}], leftGroupCombination: 'AND', rightConditions: [...]}."
    ),

  // Hierarchical search capabilities
  hierarchicalExpression: z
    .union([z.string(), z.null()])
    .default(null)
    .describe(
      "LEGACY: String-based hierarchical query syntax (less reliable than hierarchyCondition). Use 'hierarchyCondition' instead. Format: 'A > B' (strict hierarchy), 'A => B' (flexible), 'A <=> B' (bidirectional). Cannot be used with hierarchyCondition simultaneously."
    ),
  maxHierarchyDepth: z
    .number()
    .min(1)
    .max(5)
    .default(3)
    .describe("Maximum depth for hierarchy traversal with >> operator"),
  strategyCombination: z
    .enum(["union", "intersection"])
    .default("union")
    .describe("How to combine results from different search strategies"),

  // UID-based filtering for optimization
  fromResultId: z
    .union([z.string(), z.null()])
    .default(null)
    .describe(
      "Limit search to blocks/pages from previous result (e.g., 'findBlocksByContent_001')"
    ),
  limitToBlockUids: z
    .union([z.array(z.string()), z.null()])
    .default(null)
    .describe("Limit search to specific block UIDs"),
  limitToPageUids: z
    .union([z.array(z.string()), z.null()])
    .default(null)
    .describe("Limit search to blocks within specific page UIDs"),

  // Block UID exclusion
  excludeBlockUid: z
    .union([z.string(), z.null()])
    .default(null)
    .describe(
      "Block UID to exclude from results (typically the user's query block)"
    ),

  // Result lifecycle management
  purpose: z
    .enum(["final", "intermediate", "replacement", "completion"])
    .optional()
    .nullable()
    .describe(
      "Purpose: 'final' for user response data, 'intermediate' for non-final multi-step, 'replacement' to replace previous results, 'completion' to add to previous results"
    ),

  // Legacy internal parameters (kept for backward compatibility)
  // structuredHierarchyCondition: z.any().optional().nullable(),
  // structuredSearchConditions: z.any().optional().nullable(),
});

// Minimal LLM-facing schema for token optimization
export const llmFacingSchema = z.object({
  // Core hierarchy functionality - simplified condition schemas
  hierarchyCondition: z
    .object({
      operator: z.enum([
        ">",
        "<",
        ">>",
        "<<",
        "=>",
        "<=",
        "=>>",
        "<<=",
        "<=>",
        "<<=>>",
      ]),

      // Simple conditions (basic logic)
      leftConditions: z
        .array(
          z.object({
            text: z.string().min(1, "Search text is required"),
            type: z
              .enum(["text", "page_ref", "block_ref", "regex"])
              .default("text"),
            negate: z.boolean().default(false),
          })
        )
        .optional()
        .nullable()
        .describe("Left side conditions for hierarchy relationship"),
      leftCombination: z.enum(["AND", "OR"]).default("AND"),
      rightConditions: z
        .array(
          z.object({
            text: z.string().min(1, "Search text is required"),
            type: z
              .enum(["text", "page_ref", "block_ref", "regex"])
              .default("text"),
            negate: z.boolean().default(false),
          })
        )
        .optional()
        .nullable()
        .describe("Right side conditions for hierarchy relationship"),
      rightCombination: z.enum(["AND", "OR"]).default("AND"),

      // Grouped conditions (complex logic)
      leftConditionGroups: z
        .array(
          z.object({
            conditions: z
              .array(
                z.object({
                  text: z.string().min(1),
                  type: z
                    .enum(["text", "page_ref", "block_ref", "regex"])
                    .default("text"),
                  negate: z.boolean().default(false),
                })
              )
              .min(1)
              .max(5),
            combination: z.enum(["AND", "OR"]).default("AND"),
          })
        )
        .optional()
        .nullable()
        .describe(
          "Left side condition groups for complex logic like ((A|B) AND NOT C)"
        ),
      leftGroupCombination: z.enum(["AND", "OR"]).default("AND"),
      rightConditionGroups: z
        .array(
          z.object({
            conditions: z
              .array(
                z.object({
                  text: z.string().min(1),
                  type: z
                    .enum(["text", "page_ref", "block_ref", "regex"])
                    .default("text"),
                  negate: z.boolean().default(false),
                })
              )
              .min(1)
              .max(5),
            combination: z.enum(["AND", "OR"]).default("AND"),
          })
        )
        .optional()
        .nullable()
        .describe("Right side condition groups for complex logic"),
      rightGroupCombination: z.enum(["AND", "OR"]).default("AND"),
    })
    .optional()
    .nullable()
    .describe(
      "Structured hierarchy condition with operator and left/right conditions"
    ),

  // Result lifecycle management
  purpose: z
    .enum(["final", "intermediate", "replacement", "completion"])
    .optional()
    .nullable()
    .describe(
      "Purpose: 'final' for user response data, 'intermediate' for non-final multi-step, 'replacement' to replace previous results, 'completion' to add to previous results"
    ),

  // Essential options only
  limit: z
    .number()
    .min(1)
    .max(500)
    .default(50)
    .describe("Maximum number of results"),
  sortBy: z
    .enum(["relevance", "recent", "page_title", "hierarchy_depth"])
    .default("relevance"),
  maxDepth: z
    .number()
    .min(1)
    .max(10)
    .optional()
    .nullable()
    .describe(
      "ONLY specify if user explicitly requests depth (e.g. 'depth=3'). Otherwise OMIT this field to use automatic depth based on operators."
    ),

  // Optional filtering (advanced users)
  excludeBlockUid: z
    .string()
    .optional()
    .nullable()
    .describe("Block UID to exclude from results"),
});

/**
 * Transform llmFacingSchema input to full internal schema with defaults
 */
export const transformLlmInputToInternalSchema = (
  llmInput: z.infer<typeof llmFacingSchema>,
  state?: any
): z.infer<typeof schema> => {
  return {
    // Legacy properties (now unused but required by internal schema)
    contentConditions: [],
    hierarchyConditions: null,
    combineConditions: "AND" as const,
    combineHierarchy: "OR" as const,

    // Essential properties from LLM input
    hierarchyCondition: llmInput.hierarchyCondition || null,
    limit: llmInput.limit || 50,
    sortBy: llmInput.sortBy || "relevance",
    maxHierarchyDepth: (() => {
      // First check for state-level depth override (for direct expansion)
      if (
        state?.maxDepthOverride !== null &&
        state?.maxDepthOverride !== undefined
      ) {
        console.log(
          `🏗️ [Schema] Using maxDepthOverride from state: ${state.maxDepthOverride}`
        );
        return state.maxDepthOverride;
      }

      // If maxDepth was explicitly set by LLM, use it
      if (llmInput.maxDepth !== undefined) {
        return llmInput.maxDepth;
      }

      // Intelligent defaults based on operator type
      const hierarchyCondition = llmInput.hierarchyCondition;
      if (hierarchyCondition?.operator) {
        const op = hierarchyCondition.operator;

        // Deep operators should default to depth=2
        if (op.includes(">>") || op.includes("<<") || op === "=>>") {
          return 2;
        }

        // Shallow operators should default to depth=1
        if (
          op === ">" ||
          op === "<" ||
          op === "=>" ||
          op === "<=" ||
          op === "<=>"
        ) {
          return 1;
        }
      }

      // Fallback: if no hierarchy condition or unrecognized operator, use depth=1
      return 1;
    })(),
    excludeBlockUid: llmInput.excludeBlockUid || null,

    // Default properties not exposed to LLM
    includeChildren: false,
    childDepth: 1,
    includeParents: false,
    parentDepth: 1,
    includeDaily: true,
    dateRange: state?.searchDetails?.timeRange || null,
    strategyCombination: "union" as const,
    fromResultId: null,
    limitToBlockUids: null,
    limitToPageUids: null,
    secureMode: false,
    hierarchicalExpression: null,
  };
};
