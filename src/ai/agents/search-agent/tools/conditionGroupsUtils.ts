import { z } from "zod";
import { SearchCondition } from "../helpers/searchUtils";

/**
 * Shared utilities for grouped conditions across search tools
 * Extracted from findBlocksWithHierarchy for reuse in findBlocksByContent and findPagesByTitle
 */

// ==================== SCHEMA DEFINITIONS ====================

/**
 * Base condition schema - shared by all search tools
 */
export const baseConditionSchema = z.object({
  type: z
    .enum(["text", "page_ref", "block_ref", "regex", "page_ref_or"])
    .default("text"),
  text: z.string().min(1, "Search text is required"),
  matchType: z.enum(["exact", "contains", "regex"]).default("contains"),
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
      "Semantic expansion strategy. Use 'fuzzy' for typos, 'synonyms' for alternatives, 'related_concepts' for associated terms, 'all' for chained expansion, 'automatic' for progressive expansion until results"
    ),
  weight: z.number().min(0).max(10).default(1.0),
  negate: z.boolean().default(false),
});

/**
 * Condition group schema for complex logic like ((A|B) AND NOT C)
 */
export const conditionGroupSchema = z.object({
  conditions: z
    .array(baseConditionSchema)
    .min(1, "At least one condition required in group"),
  combination: z
    .enum(["AND", "OR"])
    .default("AND")
    .describe("How to combine conditions within this group"),
});

/**
 * Extended schema that supports both simple conditions and grouped conditions
 * This provides backward compatibility while enabling complex logic
 */
export const extendedConditionsSchema = z.object({
  // Simple conditions (backward compatible)
  conditions: z
    .array(baseConditionSchema)
    .optional()
    .describe("Simple list of conditions for basic logic"),
  combineConditions: z
    .enum(["AND", "OR"])
    .default("AND")
    .describe("How to combine simple conditions"),

  // Grouped conditions (new advanced feature)
  conditionGroups: z
    .array(conditionGroupSchema)
    .optional()
    .describe("Groups of conditions for complex logic like ((A|B) AND NOT C)"),
  groupCombination: z
    .enum(["AND", "OR"])
    .default("AND")
    .describe("How to combine condition groups"),
});

// ==================== PROCESSING FUNCTIONS ====================

/**
 * Process condition groups into flat conditions with combined logic
 * Converts grouped structure to flat array that existing tools can process
 */
export const processConditionGroups = async (
  conditionGroups: any[],
  groupCombination: "AND" | "OR",
  state?: any
): Promise<{ conditions: any[]; combination: "AND" | "OR" }> => {
  if (!conditionGroups || conditionGroups.length === 0) {
    return { conditions: [], combination: "AND" };
  }

  // If single group, just return its conditions
  if (conditionGroups.length === 1) {
    const group = conditionGroups[0];
    return { conditions: group.conditions, combination: group.combination };
  }

  // Multiple groups - need to combine them based on groupCombination
  if (groupCombination === "AND") {
    // For AND combination, we need to flatten all conditions and apply OR-to-regex conversion
    const allConditions: any[] = [];

    for (const group of conditionGroups) {
      if (group.combination === "OR" && group.conditions.length > 1) {
        // Convert OR group to single regex condition
        const regexCondition = convertConditionsToRegex(group.conditions);
        allConditions.push(regexCondition);
      } else {
        // Add individual conditions
        allConditions.push(...group.conditions);
      }
    }

    return { conditions: allConditions, combination: "AND" };
  } else {
    // For OR combination between groups, we need a more complex approach
    // For now, flatten all conditions and use OR
    // TODO: This could be enhanced with more sophisticated logic
    const allConditions = conditionGroups.flatMap((group) => group.conditions);
    return { conditions: allConditions, combination: "OR" };
  }
};

/**
 * Apply OR-to-regex conversion for OR logic with negation (Tier 2 support)
 * Only converts when we have OR combination with negated conditions.
 * Pure AND logic (even with negation) should remain as separate AND clauses.
 */
export const applyORToRegexConversion = (
  conditions: any[],
  combination: "AND" | "OR"
): { conditions: any[]; combination: "AND" | "OR" } => {
  if (!conditions || conditions.length === 0) {
    return { conditions: [], combination };
  }

  // Check if this is a mixed logic case that benefits from OR-to-regex conversion
  const hasNegatedConditions = conditions.some((c) => c.negate === true);
  const hasPositiveConditions = conditions.some((c) => c.negate !== true);

  // For pure OR without negation, keep current logic
  if (combination === "OR" && !hasNegatedConditions) {
    return { conditions, combination };
  }

  // Only apply OR-to-regex conversion for actual OR logic with negation
  // NOT for pure AND logic (even with negation)
  if (combination === "OR" && hasNegatedConditions) {
    // Group positive conditions for OR-to-regex conversion
    const positiveConditions = conditions.filter((c) => c.negate !== true);
    const negativeConditions = conditions.filter((c) => c.negate === true);

    // Convert multiple positive conditions to a single regex condition for OR logic
    if (positiveConditions.length > 1) {
      const regexCondition = convertConditionsToRegex(positiveConditions);
      const newConditions = [regexCondition, ...negativeConditions];
      console.log(
        `🔄 Converted ${positiveConditions.length} positive conditions to regex for OR logic, keeping ${negativeConditions.length} negative conditions`
      );
      return { conditions: newConditions, combination: "AND" };
    }
  }

  return { conditions, combination };
};

/**
 * Convert multiple conditions to a single regex condition
 * Combines different condition types into unified regex pattern
 */
export const convertConditionsToRegex = (conditions: any[]): any => {
  const regexParts: string[] = [];

  for (const condition of conditions) {
    switch (condition.type) {
      case "text":
        if (condition.matchType === "regex") {
          // Keep existing regex as-is (don't double-wrap)
          regexParts.push(condition.text);
        } else {
          // Wrap text in .* for partial matching
          const escapedText = condition.text.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );
          regexParts.push(`.*${escapedText}.*`);
        }
        break;

      case "page_ref":
        // Convert page reference to multiple syntax patterns with proper escaping
        const escapedPage = condition.text.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );
        const pagePattern = `.*(\\[\\[${escapedPage}\\]\\]|#${escapedPage}|${escapedPage}::).*`;
        regexParts.push(pagePattern);
        break;

      case "block_ref":
        // Convert block reference to pattern
        const escapedBlock = condition.text.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );
        regexParts.push(`.*\\(\\(${escapedBlock}\\)\\).*`);
        break;

      default:
        console.warn(
          `Unsupported condition type for OR-to-regex conversion: ${condition.type}`
        );
        // Fallback: treat as text
        const escapedFallback = condition.text.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );
        regexParts.push(`.*${escapedFallback}.*`);
    }
  }

  // Combine all patterns with OR
  const combinedRegex = `(?i)(${regexParts.join("|")})`;

  return {
    type: "text",
    text: combinedRegex,
    matchType: "regex",
    semanticExpansion: false, // Already expanded
    weight: 1,
    negate: false,
  };
};

// ==================== UTILITY FUNCTIONS ====================

/**
 * Check if input uses grouped conditions format
 */
export const hasGroupedConditions = (input: any): boolean => {
  return !!(input.conditionGroups && Array.isArray(input.conditionGroups) && input.conditionGroups.length > 0);
};

/**
 * Check if input uses simple conditions format
 */
export const hasSimpleConditions = (input: any): boolean => {
  return !!(input.conditions && Array.isArray(input.conditions) && input.conditions.length > 0);
};

/**
 * Validate that input has either simple or grouped conditions (not both)
 */
export const validateConditionInput = (input: any): void => {
  const hasGrouped = hasGroupedConditions(input);
  const hasSimple = hasSimpleConditions(input);

  if (hasGrouped && hasSimple) {
    console.warn(
      "⚠️ Both 'conditions' and 'conditionGroups' provided. Using 'conditionGroups' (more advanced format) and ignoring 'conditions'."
    );
    // Remove simple conditions to avoid confusion in downstream processing
    delete input.conditions;
    delete input.combineConditions;
  }

  if (!hasGrouped && !hasSimple) {
    throw new Error(
      "Must provide either 'conditions' (simple) or 'conditionGroups' (grouped) for search."
    );
  }
};

/**
 * Convert simple conditions to grouped format for unified processing
 */
export const convertSimpleToGrouped = (
  conditions: any[],
  combineConditions: "AND" | "OR"
): { conditionGroups: any[]; groupCombination: "AND" | "OR" } => {
  return {
    conditionGroups: [
      {
        conditions: conditions,
        combination: combineConditions,
      },
    ],
    groupCombination: "AND",
  };
};

// ==================== DOCUMENTATION HELPERS ====================

/**
 * Generate examples for tool descriptions
 */
export const getSimpleConditionExample = () => ({
  conditions: [
    { text: "machine learning", matchType: "contains", negate: false },
    { text: "deprecated", matchType: "contains", negate: true },
  ],
  combineConditions: "AND",
});

export const getGroupedConditionExample = () => ({
  conditionGroups: [
    {
      conditions: [
        { type: "page_ref", text: "AI", negate: false },
        { type: "text", text: "neural", negate: false },
      ],
      combination: "OR",
    },
    {
      conditions: [{ type: "text", text: "outdated", negate: true }],
      combination: "AND",
    },
  ],
  groupCombination: "AND",
});
