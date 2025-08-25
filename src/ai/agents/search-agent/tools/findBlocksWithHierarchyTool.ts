import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Global type declaration for hierarchy counts
declare global {
  var hierarchyCounts: Record<string, number> | undefined;
}
import {
  executeDatomicQuery,
  isDailyNote,
  filterByDateRange,
  createToolResult,
  generateSemanticExpansions,
  parseSemanticExpansion,
  getFlattenedDescendants,
  getFlattenedAncestors,
  DatomicQueryBuilder,
  SearchCondition,
  extractUidsFromResults,
  deduplicateResultsByUid,
  sanitizeRegexForDatomic,
} from "./searchUtils";
import type {
  SearchCondition as StructuredSearchCondition,
  CompoundCondition,
  HierarchyCondition,
  StructuredHierarchyQuery,
} from "./types/index";
import { findBlocksByContentTool } from "./findBlocksByContentTool";
import { findPagesByTitleTool } from "./findPagesByTitleTool";
import { combineResultsTool } from "./combineResultsTool";
import { updateAgentToaster } from "../../shared/agentsUtils";
import { dnpUidRegex } from "../../../../utils/regex.js";

/**
 * Find blocks with hierarchical context using content and structure conditions
 * Security Level: Flexible (secure mode = UIDs/metadata only, content mode = includes full hierarchy)
 *
 * PREFERRED USAGE: Use the modern `hierarchyCondition` parameter for type-safe, structured hierarchy queries.
 * This provides better reliability and clearer semantics than string-based expressions.
 *
 * Example structured hierarchy condition:
 * {
 *   operator: ">",
 *   leftCondition: {type: "page_ref", text: "Machine Learning"},
 *   rightCondition: {type: "page_ref", text: "AI Fundamentals"}
 * }
 *
 * Supported operators: >, <, >>, <<, =>, <=, =>>, <<=, <=>, <<=>
 * - > : A is direct parent of B
 * - < : A is direct child of B  
 * - >> : A is ancestor of B (any depth)
 * - << : A is descendant of B (any depth)
 * - => : A is same block OR parent of B
 * - <= : A is same block OR child of B
 * - <=> : A and B have bidirectional relationship
 *
 * Use secureMode=true to exclude full block content from results (UIDs and metadata only).
 */

const hierarchyConditionSchema = z.object({
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

const contentConditionSchema = z.object({
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
      z.null()
    ])
    .default(null)
    .describe(
      "Semantic expansion strategy to apply. Use 'fuzzy' for typos, 'synonyms' for alternatives, 'related_concepts' for associated terms, 'all' for chained expansion"
    ),
  weight: z.number().min(0).max(10).default(1.0),
  negate: z.boolean().default(false),
});

/**
 * Hierarchical expression types for enhanced search capabilities
 */
interface HierarchicalExpression {
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
  operator: ">" | ">>" | "=>" | "<=>" | "<<=>>" | "<" | "<<" | "<=" | "=>>" | "<<=";
  leftOperand: SearchTerm | CompoundExpression;
  rightOperand: SearchTerm | CompoundExpression;
  maxDepth?: number;
}

interface SearchTerm {
  type: "term";
  text: string;
  searchType?: "text" | "page_ref" | "regex";
  regexFlags?: string;
  conditions?: SearchCondition[];
}

interface CompoundExpression {
  type: "compound";
  operator: "AND" | "OR";
  operands: (SearchTerm | CompoundExpression)[];
}

type ParsedExpression =
  | HierarchicalExpression
  | SearchTerm
  | CompoundExpression;

// OpenAI-compatible schema following the array pattern used by working tools
const hierarchySearchConditionSchema = z.object({
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
      z.null()
    ])
    .default(null),
  weight: z.number().min(0).max(10).default(1.0),
  negate: z.boolean().default(false),
});

// Condition group schema for complex logic like ((A|B) AND NOT C)
const conditionGroupSchema = z.object({
  conditions: z.array(hierarchySearchConditionSchema).min(1).max(5),
  combination: z.enum(["AND", "OR"]).default("AND"),
});

// OpenAI-compatible hierarchy condition using arrays instead of complex unions
const openaiHierarchyConditionSchema = z.object({
  operator: z.enum([">", "<", ">>", "<<", "=>", "<=", "=>>", "<<=", "<=>", "<<=>>"]),
  
  // Simple conditions (existing - backward compatible)
  leftConditions: z.array(hierarchySearchConditionSchema).min(1).max(10).optional(),
  leftCombination: z.enum(["AND", "OR"]).default("AND"),
  rightConditions: z.array(hierarchySearchConditionSchema).min(1).max(10).optional(),
  rightCombination: z.enum(["AND", "OR"]).default("AND"),
  
  // Grouped conditions (new - for complex logic)
  leftConditionGroups: z.array(conditionGroupSchema).min(1).max(5).optional(),
  leftGroupCombination: z.enum(["AND", "OR"]).default("AND"),
  rightConditionGroups: z.array(conditionGroupSchema).min(1).max(5).optional(),
  rightGroupCombination: z.enum(["AND", "OR"]).default("AND"),
  
  maxDepth: z.union([z.number().min(1).max(10), z.null()]).default(null),
});

const schema = z.object({
  contentConditions: z
    .array(contentConditionSchema)
    .default([])
    .describe("Content conditions for blocks. Can be empty when using hierarchyCondition."),
  hierarchyConditions: z.union([z.array(hierarchyConditionSchema), z.null()]).default(null),
  combineConditions: z.enum(["AND", "OR"]).default("AND"),
  combineHierarchy: z.enum(["AND", "OR"]).default("OR"),
  includeChildren: z.boolean().default(false),
  childDepth: z.number().min(1).max(5).default(1),
  includeParents: z.boolean().default(false),
  parentDepth: z.number().min(1).max(3).default(1),
  includeDaily: z.boolean().default(true),
  dateRange: z.union([
    z.object({
      start: z.union([z.string(), z.null()]).default(null),
      end: z.union([z.string(), z.null()]).default(null),
      filterMode: z.enum(["created", "modified"]).optional(),
    }),
    z.null()
  ]).default(null),
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

  // Legacy internal parameters (kept for backward compatibility)
  // structuredHierarchyCondition: z.any().optional(),
  // structuredSearchConditions: z.any().optional(),
});

// Minimal LLM-facing schema for token optimization
const llmFacingSchema = z.object({
  // Core hierarchy functionality - simplified condition schemas
  hierarchyCondition: z.object({
    operator: z.enum([">", "<", ">>", "<<", "=>", "<=", "=>>", "<<=", "<=>", "<<=>>"]),
    
    // Simple conditions (basic logic)
    leftConditions: z.array(z.object({
      text: z.string().min(1, "Search text is required"),
      type: z.enum(["text", "page_ref", "block_ref", "regex"]).default("text"),
      negate: z.boolean().default(false)
    })).optional().describe("Left side conditions for hierarchy relationship"),
    leftCombination: z.enum(["AND", "OR"]).default("AND"),
    rightConditions: z.array(z.object({
      text: z.string().min(1, "Search text is required"), 
      type: z.enum(["text", "page_ref", "block_ref", "regex"]).default("text"),
      negate: z.boolean().default(false)
    })).optional().describe("Right side conditions for hierarchy relationship"),
    rightCombination: z.enum(["AND", "OR"]).default("AND"),
    
    // Grouped conditions (complex logic)
    leftConditionGroups: z.array(z.object({
      conditions: z.array(z.object({
        text: z.string().min(1),
        type: z.enum(["text", "page_ref", "block_ref", "regex"]).default("text"),
        negate: z.boolean().default(false)
      })).min(1).max(5),
      combination: z.enum(["AND", "OR"]).default("AND")
    })).optional().describe("Left side condition groups for complex logic like ((A|B) AND NOT C)"),
    leftGroupCombination: z.enum(["AND", "OR"]).default("AND"),
    rightConditionGroups: z.array(z.object({
      conditions: z.array(z.object({
        text: z.string().min(1),
        type: z.enum(["text", "page_ref", "block_ref", "regex"]).default("text"),
        negate: z.boolean().default(false)
      })).min(1).max(5),
      combination: z.enum(["AND", "OR"]).default("AND")
    })).optional().describe("Right side condition groups for complex logic"),
    rightGroupCombination: z.enum(["AND", "OR"]).default("AND")
  }).optional().describe("Structured hierarchy condition with operator and left/right conditions"),
  
  // Essential options only
  limit: z.number().min(1).max(500).default(50).describe("Maximum number of results"),
  sortBy: z.enum(["relevance", "recent", "page_title", "hierarchy_depth"]).default("relevance"),
  maxDepth: z.number().min(1).max(10).default(3).describe("Maximum hierarchy traversal depth"),
  
  // Optional filtering (advanced users)
  excludeBlockUid: z.string().optional().describe("Block UID to exclude from results")
});

/**
 * Convert hierarchicalExpression string to structured HierarchyCondition
 * This provides backward compatibility while enabling the new structured approach
 */
const convertHierarchicalExpressionToStructured = (
  expression: string
): HierarchyCondition | null => {
  try {
    const parsed = parseHierarchicalExpression(expression);
    console.log(`🔍 [DEBUG] parseHierarchicalExpression result for "${expression}":`, parsed);
    
    if (!parsed || parsed.type === "term" || parsed.type === "compound") {
      console.log(`🚫 [DEBUG] Conversion failed - parsed type: ${parsed?.type || 'null'}`);
      return null;
    }

    const hierarchicalParsed = parsed as HierarchicalExpression;

    // Convert old operator format to new operator format
    const operatorMap: Record<string, HierarchyCondition["operator"]> = {
      ">": ">",
      "<": "<",
      ">>": ">>",
      "<<": "<<",
      "=>": "=>",
      "<=": "<=",
      "=>>": "=>>",
      "<<=": "<<=",
      "<=>": "<=>",
      "<<=>>": "<<=>>",
    };

    const newOperator = operatorMap[hierarchicalParsed.operator];
    if (!newOperator) {
      console.warn(`Unknown operator: ${hierarchicalParsed.operator}`);
      return null;
    }

    return {
      operator: newOperator,
      leftCondition: convertParsedExpressionToSearchCondition(
        hierarchicalParsed.leftOperand
      ),
      rightCondition: convertParsedExpressionToSearchCondition(
        hierarchicalParsed.rightOperand
      ),
      maxDepth: hierarchicalParsed.maxDepth,
    };
  } catch (error) {
    console.error("Failed to convert hierarchical expression:", error);
    return null;
  }
};

/**
 * Convert ParsedExpression (old format) to SearchCondition or CompoundCondition (new format)
 */
const convertParsedExpressionToSearchCondition = (
  expression: SearchTerm | CompoundExpression
): StructuredSearchCondition | CompoundCondition => {
  if (expression.type === "term") {
    return {
      type:
        expression.searchType === "page_ref"
          ? "page_ref"
          : expression.searchType === "regex"
          ? "regex"
          : "text",
      text: expression.text,
      matchType: expression.searchType === "regex" ? "regex" : "contains",
      weight: 1.0,
      negate: false,
    };
  } else if (expression.type === "compound") {
    return {
      operator: expression.operator,
      conditions: expression.operands.map(
        convertParsedExpressionToSearchCondition
      ),
    };
  }

  throw new Error(`Unsupported expression type: ${(expression as any).type}`);
};

/**
 * Parse simple compound condition from string expressions like "(A + B)", "(A | B | C)", "(A + B - C)"
 * Returns null if the expression is too complex for simple path
 */
const parseSimpleCompoundCondition = (expression: string): any | null => {
  const trimmed = expression.trim();
  
  // Must be wrapped in parentheses for compound conditions
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) {
    return null;
  }
  
  const inner = trimmed.slice(1, -1).trim();
  
  // Check for mixed operators (complex case - return null)
  const hasAnd = inner.includes("+");
  const hasOr = inner.includes("|");
  
  if (hasAnd && hasOr) {
    console.log("🚫 Complex mixed operators detected, requires LLM decomposition");
    return null;
  }
  
  let operator: "AND" | "OR";
  let delimiter: string;
  
  if (hasOr) {
    operator = "OR";
    delimiter = "|";
  } else if (hasAnd) {
    operator = "AND";
    delimiter = "+";
  } else {
    // Single term in parentheses - treat as simple condition
    return parseSimpleSearchCondition(inner);
  }
  
  // Split and parse individual conditions
  const terms = inner.split(delimiter).map(t => t.trim());
  const conditions: any[] = [];
  
  for (const term of terms) {
    // Handle NOT logic: terms starting with "-" 
    let negate = false;
    let cleanTerm = term;
    
    if (term.startsWith("-")) {
      negate = true;
      cleanTerm = term.slice(1).trim();
    }
    
    const condition = parseSimpleSearchCondition(cleanTerm);
    if (condition) {
      condition.negate = negate;
      conditions.push(condition);
    } else {
      // If any term is too complex, fallback to LLM decomposition
      console.log(`🚫 Complex term "${term}" detected, requires LLM decomposition`);
      return null;
    }
  }
  
  return {
    operator,
    conditions,
  };
};

/**
 * Parse simple search condition from string like "Machine Learning", "ref:AI", "regex:pattern"
 */
const parseSimpleSearchCondition = (text: string): any | null => {
  const trimmed = text.trim();
  
  // Remove quotes if present
  let cleanText = trimmed;
  if ((cleanText.startsWith('"') && cleanText.endsWith('"')) || 
      (cleanText.startsWith("'") && cleanText.endsWith("'"))) {
    cleanText = cleanText.slice(1, -1).trim();
  }
  
  // Check for type prefixes
  if (cleanText.startsWith("ref:")) {
    return {
      type: "page_ref",
      text: cleanText.slice(4).trim(),
      matchType: "contains",
    };
  }
  
  if (cleanText.startsWith("regex:")) {
    const regexPattern = cleanText.slice(6).trim();
    // Handle regex:/pattern/[flags] format
    const regexMatch = regexPattern.match(/^\/(.+)\/([gimuy]*)$/);
    if (regexMatch) {
      return {
        type: "regex",
        text: regexMatch[1],
        matchType: "regex",
      };
    } else {
      return {
        type: "regex", 
        text: regexPattern,
        matchType: "regex",
      };
    }
  }
  
  if (cleanText.startsWith("text:")) {
    return {
      type: "text",
      text: cleanText.slice(5).trim(),
      matchType: "contains",
    };
  }
  
  // Default to text condition
  return {
    type: "text",
    text: cleanText,
    matchType: "contains",
  };
};

/**
 * Process OpenAI-compatible hierarchy condition with array-based structure
 * Converts arrays to internal compound structures while maintaining full semantic expansion
 */
const processOpenAIHierarchyCondition = async (
  hierarchyCondition: any,
  options: any,
  state?: any
): Promise<any> => {
  console.log("🔍 Processing OpenAI-compatible hierarchy condition:", hierarchyCondition);
  
  // Step 1: Convert array-based conditions to internal compound structures
  const internalHierarchyCondition = await convertArraysToInternalFormat(
    hierarchyCondition,
    state
  );
  
  // Step 2: Apply semantic expansion to the converted condition
  const expandedHierarchyCondition = await expandHierarchyConditionSemantics(
    internalHierarchyCondition,
    state
  );
  
  const structuredQuery = {
    hierarchyCondition: expandedHierarchyCondition,
    searchConditions: [],
    combineConditions: "AND" as const,
  };
  
  return await processStructuredHierarchyQuery(structuredQuery, options, state);
};

/**
 * Convert OpenAI array-based format to internal compound condition format
 */
const convertArraysToInternalFormat = async (
  hierarchyCondition: any,
  state?: any
): Promise<any> => {
  console.log("🔧 Converting arrays to internal format:", hierarchyCondition);
  
  const convertConditionArray = (conditions: any[], combination: string) => {
    if (!conditions || conditions.length === 0) {
      console.warn("⚠️ Empty or undefined conditions array passed to convertConditionArray");
      return null;
    }
    if (conditions.length === 1) {
      // Single condition - return directly
      return conditions[0];
    } else {
      // Multiple conditions - create compound
      return {
        operator: combination,
        conditions: conditions,
      };
    }
  };
  
  const leftCondition = convertConditionArray(
    hierarchyCondition.leftConditions,
    hierarchyCondition.leftCombination || "AND"
  );
  
  const rightCondition = convertConditionArray(
    hierarchyCondition.rightConditions,
    hierarchyCondition.rightCombination || "AND"
  );
  
  // Handle case where conditions are invalid
  if (!leftCondition && !rightCondition) {
    throw new Error("Both left and right conditions are invalid or empty");
  }
  
  return {
    operator: hierarchyCondition.operator,
    leftCondition: leftCondition,
    rightCondition: rightCondition,
    maxDepth: hierarchyCondition.maxDepth,
  };
};

/**
 * Process enhanced hierarchy condition with two-step approach
 * Simple path: Handle simple conditions and single-operator compounds directly
 * Complex path: Use LLM decomposition for nested conditions (future enhancement)
 */
const processEnhancedHierarchyCondition = async (
  hierarchyCondition: any, // Will be typed properly
  options: any,
  state?: any
): Promise<any> => {
  console.log("🔍 Processing enhanced hierarchy condition:", hierarchyCondition);
  
  // Step 1: Convert any string expressions to structured conditions
  const normalizedHierarchyCondition = await normalizeHierarchyCondition(
    hierarchyCondition,
    state
  );
  
  // Step 2: Apply semantic expansion to the normalized condition
  const expandedHierarchyCondition = await expandHierarchyConditionSemantics(
    normalizedHierarchyCondition,
    state
  );
  
  const structuredQuery = {
    hierarchyCondition: expandedHierarchyCondition,
    searchConditions: [],
    combineConditions: "AND" as const,
  };
  
  return await processStructuredHierarchyQuery(structuredQuery, options, state);
};

/**
 * Normalize hierarchy condition: handle both structured objects and string expressions
 * This bridges the gap between LLM-generated structured conditions and string expressions
 */
const normalizeHierarchyCondition = async (
  hierarchyCondition: any,
  state?: any
): Promise<any> => {
  console.log("🔧 Normalizing hierarchy condition:", hierarchyCondition);
  
  // If already fully structured, return as-is
  if (isFullyStructured(hierarchyCondition)) {
    return hierarchyCondition;
  }
  
  // Handle mixed cases where leftCondition or rightCondition might be strings
  const normalizedLeft = await normalizeCondition(hierarchyCondition.leftCondition, state);
  const normalizedRight = await normalizeCondition(hierarchyCondition.rightCondition, state);
  
  return {
    ...hierarchyCondition,
    leftCondition: normalizedLeft,
    rightCondition: normalizedRight,
  };
};

/**
 * Normalize a single condition (left or right side of hierarchy)
 */
const normalizeCondition = async (condition: any, state?: any): Promise<any> => {
  // If it's already a structured object, return as-is
  if (typeof condition === "object" && condition.type) {
    return condition;
  }
  
  // If it's already a structured compound, return as-is  
  if (typeof condition === "object" && condition.operator && condition.conditions) {
    return condition;
  }
  
  // If it's a string, try to parse it with simple path first
  if (typeof condition === "string") {
    console.log(`🔍 Parsing string condition: "${condition}"`);
    
    // Try simple compound parsing first (covers 95% of cases)
    const simpleCompound = parseSimpleCompoundCondition(condition);
    if (simpleCompound) {
      console.log(`✅ Parsed as simple compound:`, simpleCompound);
      return simpleCompound;
    }
    
    // Try simple search condition
    const simpleCondition = parseSimpleSearchCondition(condition);
    if (simpleCondition) {
      console.log(`✅ Parsed as simple condition:`, simpleCondition);
      return simpleCondition;
    }
    
    // Complex case - fall back to LLM decomposition (future enhancement)
    console.log(`🚫 Complex condition detected, using fallback parsing for: "${condition}"`);
    return await fallbackComplexConditionParsing(condition, state);
  }
  
  // Unknown format - return as-is and let downstream handle it
  console.warn("⚠️ Unknown condition format:", condition);
  return condition;
};

/**
 * Check if hierarchy condition is fully structured (no string expressions)
 */
const isFullyStructured = (hierarchyCondition: any): boolean => {
  const leftIsStructured = isConditionStructured(hierarchyCondition.leftCondition);
  const rightIsStructured = isConditionStructured(hierarchyCondition.rightCondition);
  
  return leftIsStructured && rightIsStructured;
};

/**
 * Check if a single condition is structured (not a string)
 */
const isConditionStructured = (condition: any): boolean => {
  if (typeof condition === "string") {
    return false;
  }
  
  if (typeof condition === "object") {
    // Simple structured condition
    if (condition.type && condition.text) {
      return true;
    }
    
    // Compound structured condition
    if (condition.operator && Array.isArray(condition.conditions)) {
      return condition.conditions.every((c: any) => isConditionStructured(c));
    }
  }
  
  return false;
};

/**
 * Fallback for complex conditions that can't be parsed with simple path
 * For now, convert to simple text condition - can be enhanced with LLM decomposition later
 */
const fallbackComplexConditionParsing = async (
  condition: string,
  state?: any
): Promise<any> => {
  console.log(`🔄 Using fallback parsing for complex condition: "${condition}"`);
  
  // For now, treat as simple text condition
  // This can be enhanced later with LLM decomposition for truly complex cases
  return {
    type: "text",
    text: condition,
    matchType: "contains",
  };
};

/**
 * Apply semantic expansion to hierarchy condition (both left and right conditions)
 */
const expandHierarchyConditionSemantics = async (
  hierarchyCondition: any,
  state?: any
): Promise<any> => {
  const expandedLeftCondition = await expandConditionSemantics(
    hierarchyCondition.leftCondition,
    state
  );
  const expandedRightCondition = await expandConditionSemantics(
    hierarchyCondition.rightCondition,
    state
  );
  
  return {
    ...hierarchyCondition,
    leftCondition: expandedLeftCondition,
    rightCondition: expandedRightCondition,
  };
};

/**
 * Apply semantic expansion to a single condition (simple or compound)
 */
const expandConditionSemantics = async (
  condition: any,
  state?: any
): Promise<any> => {
  if (condition.operator) {
    // Compound condition - expand each sub-condition
    const expandedConditions = await Promise.all(
      condition.conditions.map((c: any) => expandConditionSemantics(c, state))
    );
    
    return {
      ...condition,
      conditions: expandedConditions.flat(), // Flatten in case expansion creates multiple conditions
    };
  } else {
    // Simple condition - apply semantic expansion 
    const expandedConditions = await expandSingleCondition(condition, state);
    
    // If only one condition returned, return it directly
    // If multiple returned (semantic expansion), wrap in OR compound
    if (expandedConditions.length === 1) {
      return expandedConditions[0];
    } else {
      return {
        operator: "OR",
        conditions: expandedConditions,
      };
    }
  }
};

/**
 * Apply semantic expansion to structured search conditions
 */
const expandStructuredConditions = async (
  conditions: (StructuredSearchCondition | CompoundCondition)[],
  state?: any
): Promise<(StructuredSearchCondition | CompoundCondition)[]> => {
  // Handle undefined or empty conditions array
  if (!conditions || !Array.isArray(conditions)) {
    console.warn("⚠️ expandStructuredConditions called with invalid conditions:", conditions);
    return [];
  }

  const expandedConditions: (StructuredSearchCondition | CompoundCondition)[] =
    [];

  for (const condition of conditions) {
    // Skip undefined or null conditions
    if (!condition) {
      console.warn("⚠️ Skipping undefined condition in expandStructuredConditions");
      continue;
    }
    
    if ("operator" in condition) {
      // CompoundCondition - recursively expand nested conditions
      expandedConditions.push({
        operator: condition.operator,
        conditions: await expandStructuredConditions(
          condition.conditions,
          state
        ),
      });
    } else {
      // SearchCondition - apply semantic expansion
      const expandedCondition = await expandSingleCondition(condition, state);
      expandedConditions.push(...expandedCondition);
    }
  }

  return expandedConditions;
};

/**
 * Apply semantic expansion to a single SearchCondition
 */
const expandSingleCondition = async (
  condition: StructuredSearchCondition,
  state?: any
): Promise<StructuredSearchCondition[]> => {
  // Check if semantic expansion is needed - either globally or per-condition
  const hasGlobalExpansion = state?.isExpansionGlobal === true;

  // Parse semantic expansion from condition text using parseSemanticExpansion
  const { cleanText, expansionType } = parseSemanticExpansion(
    condition.text,
    state?.semanticExpansion
  );

  // Determine final expansion strategy: per-condition > global
  let effectiveExpansionStrategy = expansionType || condition.semanticExpansion;
  if (!effectiveExpansionStrategy && hasGlobalExpansion) {
    effectiveExpansionStrategy = state?.semanticExpansion || "synonyms";
  }

  // Start with the cleaned condition
  const expandedConditions: StructuredSearchCondition[] = [
    {
      ...condition,
      text: cleanText,
      semanticExpansion: undefined, // Remove expansion flag from final condition
    },
  ];

  // Apply semantic expansion if needed
  if (effectiveExpansionStrategy && condition.type !== "regex") {
    try {
      const customStrategy =
        effectiveExpansionStrategy === "custom"
          ? state?.customSemanticExpansion
          : undefined;

      // Determine the mode based on condition type
      const expansionMode = condition.type === "page_ref" ? "page_ref" : "text";

      // Use generateSemanticExpansions
      const expansionTerms = await generateSemanticExpansions(
        cleanText,
        effectiveExpansionStrategy as any,
        state?.userQuery,
        state?.model,
        state?.language,
        customStrategy,
        expansionMode
      );

      console.log(
        `🔍 Expanding condition "${cleanText}" (${condition.type}) with ${expansionTerms.length} semantic variations`
      );

      // Add expanded terms as additional conditions
      for (const term of expansionTerms) {
        expandedConditions.push({
          ...condition,
          text: term,
          semanticExpansion: undefined,
          weight: (condition.weight || 1.0) * 0.8, // Reduce weight for expanded terms
        });
      }
    } catch (error) {
      console.warn(`Failed to expand condition "${condition.text}":`, error);
    }
  }

  return expandedConditions;
};

/**
 * Parse hierarchical expressions like "A => B", "A <=> (B + C)", etc.
 */
const parseHierarchicalExpression = (
  expression: string
): ParsedExpression | null => {
  try {
    // Clean up the expression
    const cleanExpr = expression.trim();

    // Check for hierarchical operators (in order of specificity)
    const hierarchicalOperators = [
      {
        pattern: /<<=>>/,
        type: "deep_bidirectional" as const,
        operator: "<<=>>" as const,
      },
      {
        pattern: /<=>/,
        type: "bidirectional" as const,
        operator: "<=>" as const,
      },
      {
        pattern: /<<=/, 
        type: "deep_flexible_hierarchy" as const,
        operator: "<<=" as const,
      },
      {
        pattern: /=>>/,
        type: "flexible_hierarchy_right" as const,
        operator: "=>>" as const,
      },
      {
        pattern: />>/,
        type: "deep_strict_hierarchy" as const,
        operator: ">>" as const,
      },
      {
        pattern: /<</,
        type: "deep_strict_hierarchy_left" as const,
        operator: "<<" as const,
      },
      {
        pattern: /=>/,
        type: "flexible_hierarchy" as const,
        operator: "=>" as const,
      },
      {
        pattern: /<=/,
        type: "flexible_hierarchy_left" as const,
        operator: "<=" as const,
      },
      {
        pattern: />/,
        type: "strict_hierarchy" as const,
        operator: ">" as const,
      },
      {
        pattern: /</,
        type: "strict_hierarchy_left" as const,
        operator: "<" as const,
      },
    ];

    for (const { pattern, type, operator } of hierarchicalOperators) {
      const match = cleanExpr.match(
        new RegExp(`^(.+?)\\s*${pattern.source}\\s*(.+)$`)
      );
      if (match) {
        const [, leftPart, rightPart] = match;

        console.log(
          `🔍 Parsed hierarchical expression: ${leftPart} ${operator} ${rightPart}`
        );

        return {
          type,
          operator,
          leftOperand: parseOperand(leftPart.trim()),
          rightOperand: parseOperand(rightPart.trim()),
          maxDepth: type === "deep_bidirectional" ? 5 : 3,
        };
      }
    }

    // If no hierarchical operators found, treat as simple search term
    return parseOperand(cleanExpr);
  } catch (error) {
    console.error("Error parsing hierarchical expression:", error);
    return null;
  }
};

/**
 * Parse individual operands (supports parentheses and AND/OR logic)
 */
const parseOperand = (operand: string): SearchTerm | CompoundExpression => {
  const trimmed = operand.trim();

  // Handle parentheses
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return parseOperand(trimmed.slice(1, -1));
  }

  // Check for AND/OR operators
  const orMatch = trimmed.split(/\s*\|\s*/);
  if (orMatch.length > 1) {
    return {
      type: "compound",
      operator: "OR",
      operands: orMatch.map((term) => parseOperand(term.trim())),
    };
  }

  const andMatch = trimmed.split(/\s*\+\s*/);
  if (andMatch.length > 1) {
    return {
      type: "compound",
      operator: "AND",
      operands: andMatch.map((term) => parseOperand(term.trim())),
    };
  }

  // Simple search term - strip multiple layers of quotes if they exist
  let cleanText = trimmed;

  // ENHANCED: Remove multiple layers of quotes that might come from ReAct parsing
  // Handle patterns like: ""Machine Learning"" or '"AI"' or "'Neural Networks'"
  while (
    (cleanText.startsWith('"') && cleanText.endsWith('"')) ||
    (cleanText.startsWith("'") && cleanText.endsWith("'"))
  ) {
    const before = cleanText;
    cleanText = cleanText.slice(1, -1).trim();
    console.log(`🧹 Stripped quotes layer: "${before}" → "${cleanText}"`);
    if (before === cleanText) break; // Prevent infinite loop
  }

  // Parse special patterns: ref:, regex:
  if (cleanText.startsWith("ref:")) {
    const pageTitle = cleanText.slice(4).trim();
    return {
      type: "term",
      text: pageTitle,
      searchType: "page_ref",
    };
  }

  if (cleanText.startsWith("regex:")) {
    const regexPattern = cleanText.slice(6).trim();
    // Handle regex:/pattern/[flags] format
    const regexMatch = regexPattern.match(/^\/(.+)\/([gimuy]*)$/);
    if (regexMatch) {
      return {
        type: "term",
        text: regexMatch[1], // Pattern without slashes
        searchType: "regex",
        regexFlags: regexMatch[2] || "",
      };
    } else {
      // Plain regex pattern without slashes
      return {
        type: "term",
        text: regexPattern,
        searchType: "regex",
      };
    }
  }

  // Handle text:(term1 | term2 | term3) syntax for text content search
  if (cleanText.startsWith("text:")) {
    const textContent = cleanText.slice(5).trim();

    // Handle text:(term1 | term2 | term3) and text:(term1 + term2 + term3) syntax
    if (textContent.startsWith("(") && textContent.endsWith(")")) {
      const innerTerms = textContent.slice(1, -1).trim();

      // Check for OR logic first
      const orTerms = innerTerms.split(/\s*\|\s*/);
      if (orTerms.length > 1) {
        return {
          type: "compound",
          operator: "OR",
          operands: orTerms.map((term) => ({
            type: "term",
            text: term.trim(),
            searchType: "text",
          })),
        };
      }

      // Check for AND logic
      const andTerms = innerTerms.split(/\s*\+\s*/);
      if (andTerms.length > 1) {
        return {
          type: "compound",
          operator: "AND",
          operands: andTerms.map((term) => ({
            type: "term",
            text: term.trim(),
            searchType: "text",
          })),
        };
      }
    }

    return {
      type: "term",
      text: textContent,
      searchType: "text",
    };
  }

  return {
    type: "term",
    text: cleanText,
    searchType: "text",
  };
};

/**
 * Extract search conditions from parsed expressions with compound structure preservation
 */
const extractSearchConditions = (
  expression: SearchTerm | CompoundExpression,
  globalSemanticExpansion?:
    | "fuzzy"
    | "synonyms"
    | "related_concepts"
    | "broader_terms"
    | "custom"
    | "all"
): SearchCondition[] => {
  if (expression.type === "term") {
    const searchType = expression.searchType || "text";
    const matchType = searchType === "regex" ? "regex" : "contains";

    const condition: SearchCondition = {
      type: searchType,
      text: expression.text,
      matchType,
      semanticExpansion:
        globalSemanticExpansion &&
        (searchType === "page_ref" || searchType === "text")
          ? globalSemanticExpansion
          : undefined,
      weight: 1.0,
      negate: false,
    };

    // Add regex flags if present
    if (expression.regexFlags) {
      condition.regexFlags = expression.regexFlags;
    }

    return [condition];
  }

  if (expression.type === "compound") {
    // For page reference OR compounds, create a special combined condition
    if (
      expression.operator === "OR" &&
      expression.operands.every(
        (op) => op.type === "term" && op.searchType === "page_ref"
      )
    ) {
      // Create a single condition that represents the OR of page references
      const pageNames = expression.operands.map(
        (op) => (op as SearchTerm).text
      );

      return [
        {
          type: "page_ref_or",
          text: pageNames.join("|"), // Store as pipe-separated for Datomic OR handling
          matchType: "contains",
          semanticExpansion: undefined,
          weight: 1.0,
          negate: false,
          pageNames: pageNames, // Store original array for proper query building
        } as any,
      ]; // Cast to any since we're extending the SearchCondition type
    }

    // For other compounds, flatten as before
    return expression.operands.flatMap((operand) =>
      extractSearchConditions(operand, globalSemanticExpansion)
    );
  }

  return [];
};

/**
 * Get combine logic from compound expressions
 */
const getCombineLogic = (
  expression: SearchTerm | CompoundExpression
): "AND" | "OR" => {
  if (expression.type === "compound") {
    return expression.operator;
  }
  return "AND"; // Default for simple terms
};

/**
 * Format expression for display (preserves actual AND/OR logic)
 */
const formatExpressionForDisplay = (
  expression: SearchTerm | CompoundExpression
): string => {
  if (expression.type === "term") {
    return expression.text;
  }

  if (expression.type === "compound") {
    const operator = expression.operator === "OR" ? " | " : " + ";
    return expression.operands
      .map((operand) => {
        const formatted = formatExpressionForDisplay(operand);
        // Add parentheses for nested compound expressions
        return operand.type === "compound" ? `(${formatted})` : formatted;
      })
      .join(operator);
  }

  return String(expression);
};

/**
 * Process structured hierarchy query with semantic expansion support
 */
const processStructuredHierarchyQuery = async (
  query: StructuredHierarchyQuery,
  options: {
    maxHierarchyDepth: number;
    strategyCombination: "union" | "intersection";
    includeChildren?: boolean;
    childDepth?: number;
    includeParents?: boolean;
    parentDepth?: number;
    includeDaily: boolean;
    dateRange?: any;
    sortBy: string;
    limit: number;
    secureMode: boolean;
    fromResultId?: string;
    limitToBlockUids?: string[];
    limitToPageUids?: string[];
    excludeBlockUid?: string;
  },
  state?: any
): Promise<any[]> => {
  console.log(
    "🚀 Processing structured hierarchy query with semantic expansion"
  );

  // Apply semantic expansion to hierarchy condition if present (legacy format only)
  // Skip this for grouped conditions as they handle expansion in processStructuredHierarchyCondition
  if (query.hierarchyCondition && query.hierarchyCondition.leftCondition && query.hierarchyCondition.rightCondition) {
    const expandedLeftConditions = await expandStructuredConditions(
      [query.hierarchyCondition.leftCondition],
      state
    );
    const expandedRightConditions = await expandStructuredConditions(
      [query.hierarchyCondition.rightCondition],
      state
    );

    // For now, use the first expanded condition (could be enhanced to handle multiple)
    query.hierarchyCondition.leftCondition = expandedLeftConditions[0];
    query.hierarchyCondition.rightCondition = expandedRightConditions[0];
  }

  // Apply semantic expansion to additional search conditions if present
  if (query.searchConditions && query.searchConditions.length > 0) {
    const expandedSearchConditions = await expandStructuredConditions(
      query.searchConditions,
      state
    );
    query.searchConditions = expandedSearchConditions.filter(
      (cond): cond is StructuredSearchCondition => !("operator" in cond)
    );
  }

  // Process structured hierarchy condition natively (preferred approach)
  if (query.hierarchyCondition) {
    console.log("🚀 Processing structured hierarchy condition natively");
    return await processStructuredHierarchyCondition(
      query.hierarchyCondition,
      options,
      state
    );
  }

  // If no hierarchy condition, fall back to regular content search
  if (query.searchConditions && query.searchConditions.length > 0) {
    // Convert structured conditions to legacy format and use existing logic
    const legacyConditions = query.searchConditions.map(
      convertStructuredToLegacyCondition
    );

    // Use findBlocksByContentTool for pure content search
    const result: any = await findBlocksByContentTool.invoke({
      conditions: legacyConditions,
      combineConditions: query.combineConditions || "AND",
      includeChildren: options.includeChildren,
      includeParents: options.includeParents,
      limit: options.limit,
      secureMode: options.secureMode,
    });

    // Parse the result if it's a string
    if (typeof result === "string") {
      try {
        const parsed = JSON.parse(result);
        return parsed.success ? parsed.data : [];
      } catch (e) {
        console.error("Failed to parse findBlocksByContent result:", e);
        return [];
      }
    }

    // Handle object result
    if (result && typeof result === "object") {
      return result.data || [];
    }

    return [];
  }

  return [];
};

/**
 * Process structured hierarchy condition natively without converting to legacy string
 */
const processStructuredHierarchyCondition = async (
  hierarchyCondition: any,
  options: any,
  state?: any
): Promise<any[]> => {
  console.log("🔧 Processing structured hierarchy condition:", hierarchyCondition);
  
  // Validate that operator is defined
  if (!hierarchyCondition || !hierarchyCondition.operator) {
    console.error("❌ Invalid hierarchy condition - missing operator:", hierarchyCondition);
    return [];
  }
  
  // Extract and process left and right conditions with backward compatibility
  let leftConditions: any[], leftCombination: string;
  let rightConditions: any[], rightCombination: string;
  
  // Handle grouped conditions (new)
  if (hierarchyCondition.leftConditionGroups) {
    const processedGroups = await processConditionGroups(
      hierarchyCondition.leftConditionGroups,
      hierarchyCondition.leftGroupCombination || "AND",
      state
    );
    leftConditions = processedGroups.conditions;
    leftCombination = processedGroups.combination;
  } else {
    // Handle simple conditions (existing - backward compatible)
    leftConditions = Array.isArray(hierarchyCondition.leftConditions) 
      ? hierarchyCondition.leftConditions 
      : hierarchyCondition.leftCondition?.conditions || (hierarchyCondition.leftCondition ? [hierarchyCondition.leftCondition] : []);
    leftCombination = hierarchyCondition.leftCombination || hierarchyCondition.leftCondition?.operator || "AND";
  }
  
  if (hierarchyCondition.rightConditionGroups) {
    const processedGroups = await processConditionGroups(
      hierarchyCondition.rightConditionGroups,
      hierarchyCondition.rightGroupCombination || "AND", 
      state
    );
    rightConditions = processedGroups.conditions;
    rightCombination = processedGroups.combination;
  } else {
    // Handle simple conditions (existing - backward compatible)
    rightConditions = Array.isArray(hierarchyCondition.rightConditions)
      ? hierarchyCondition.rightConditions
      : hierarchyCondition.rightCondition?.conditions || (hierarchyCondition.rightCondition ? [hierarchyCondition.rightCondition] : []);
    rightCombination = hierarchyCondition.rightCombination || hierarchyCondition.rightCondition?.operator || "AND";
  }
  
  console.log(`🔄 Processing ${hierarchyCondition.operator} with left: ${leftConditions.length} conditions (${leftCombination}), right: ${rightConditions.length} conditions (${rightCombination})`);

  // Apply semantic expansion to conditions
  const expandedLeftConditions = await expandStructuredConditions(leftConditions, state);
  const expandedRightConditions = await expandStructuredConditions(rightConditions, state);

  // Apply OR-to-regex conversion for mixed logic cases (Tier 2)
  const processedLeftConditions = applyORToRegexConversion(expandedLeftConditions, leftCombination);
  const processedRightConditions = applyORToRegexConversion(expandedRightConditions, rightCombination);

  // Execute hierarchy search based on operator
  switch (hierarchyCondition.operator) {
    case ">":
      // Strict hierarchy: left > right (left parent, right child)
      return await executeStructuredStrictHierarchySearch(
        processedLeftConditions.conditions,
        processedRightConditions.conditions,
        processedLeftConditions.combination,
        processedRightConditions.combination,
        options,
        state
      );
      
    case ">>":
      // Deep strict hierarchy: left >> right (left ancestor, right descendant)
      return await executeStructuredDeepStrictHierarchySearch(
        processedLeftConditions.conditions,
        processedRightConditions.conditions,
        processedLeftConditions.combination,
        processedRightConditions.combination,
        options,
        state
      );
      
    case "<=>":
      // Bidirectional: left <=> right (either direction)
      return await executeStructuredBidirectionalSearch(
        processedLeftConditions.conditions,
        processedRightConditions.conditions,
        processedLeftConditions.combination,
        processedRightConditions.combination,
        options,
        state
      );
      
    case "=>":
      // Flexible hierarchy: left => right (same block OR left parent of right)
      return await executeStructuredFlexibleHierarchySearch(
        processedLeftConditions.conditions,
        processedRightConditions.conditions,
        processedLeftConditions.combination,
        processedRightConditions.combination,
        options,
        state
      );
      
    case "=>>":
      // Right flexible hierarchy: left =>> right (left ancestor, right descendant with flexibility, deep)
      return await executeStructuredDeepFlexibleHierarchySearch(
        processedLeftConditions.conditions,
        processedRightConditions.conditions,
        processedLeftConditions.combination,
        processedRightConditions.combination,
        options,
        state
      );
      
    case "<<=>>":
      // Deep bidirectional: left <<=>> right (either direction, any depth)
      return await executeStructuredDeepBidirectionalSearch(
        processedLeftConditions.conditions,
        processedRightConditions.conditions,
        processedLeftConditions.combination,
        processedRightConditions.combination,
        options,
        state
      );
      
    default:
      console.warn(`⚠️ Unsupported structured operator: ${hierarchyCondition.operator}`);
      return [];
  }
};

/**
 * Process condition groups for complex logic like ((A|B) AND NOT C)
 * Converts groups into flat conditions for existing OR-to-regex processing
 */
const processConditionGroups = async (
  conditionGroups: any[],
  groupCombination: string,
  state?: any
): Promise<{ conditions: any[], combination: string }> => {
  console.log(`📦 Processing ${conditionGroups.length} condition groups with ${groupCombination} combination`);
  
  const allConditions: any[] = [];
  let hasMultipleGroups = conditionGroups.length > 1;
  let hasORGroups = conditionGroups.some(group => group.combination === "OR");
  
  // Process each group
  for (const group of conditionGroups) {
    const groupConditions = group.conditions || [];
    const groupCombination = group.combination || "AND";
    
    // If this is an OR group with multiple conditions, we may need OR-to-regex conversion
    if (groupCombination === "OR" && groupConditions.length > 1) {
      // Check if this group has negated conditions mixed with positive ones
      const hasNegated = groupConditions.some(c => c.negate === true);
      const hasPositive = groupConditions.some(c => c.negate !== true);
      
      if (hasNegated && hasPositive) {
        // This is a complex case that needs OR-to-regex conversion
        // For now, add all conditions and let OR-to-regex conversion handle it
        allConditions.push(...groupConditions);
      } else {
        // Simple OR group - add all conditions
        allConditions.push(...groupConditions);
      }
    } else {
      // AND group or single condition - add all conditions
      allConditions.push(...groupConditions);
    }
  }
  
  // Determine final combination logic
  let finalCombination: string;
  
  if (hasMultipleGroups && groupCombination === "AND") {
    // Multiple groups combined with AND
    finalCombination = "AND";
  } else if (hasORGroups && !hasMultipleGroups) {
    // Single OR group
    finalCombination = "OR";
  } else if (hasMultipleGroups && groupCombination === "OR") {
    // This is complex - multiple groups with OR between them
    // For now, treat as OR and let OR-to-regex conversion handle it
    finalCombination = "OR";
  } else {
    // Default to AND
    finalCombination = "AND";
  }
  
  console.log(`📦 Processed groups: ${allConditions.length} total conditions, final combination: ${finalCombination}`);
  
  return {
    conditions: allConditions,
    combination: finalCombination
  };
};

/**
 * Apply OR-to-regex conversion for mixed logic cases (Tier 2)
 * Detects AND-dominant logic with OR sub-groups and converts OR groups to regex
 */
const applyORToRegexConversion = (
  conditions: any[],
  combination: string
): { conditions: any[], combination: string } => {
  // Only apply conversion for AND-dominant logic with potential OR sub-groups
  if (combination !== "AND" && combination !== "OR") {
    return { conditions, combination };
  }

  // Check if this is a mixed logic case that benefits from OR-to-regex conversion
  const hasNegatedConditions = conditions.some(c => c.negate === true);
  const hasPositiveConditions = conditions.some(c => c.negate !== true);
  
  // For pure OR without negation, keep current OR clause logic
  if (combination === "OR" && !hasNegatedConditions) {
    return { conditions, combination };
  }
  
  // For AND logic with mixed positive/negative, or OR with negation, apply conversion
  if ((combination === "AND" && hasNegatedConditions && hasPositiveConditions) || 
      (combination === "OR" && hasNegatedConditions)) {
    
    // Group positive conditions for potential OR-to-regex conversion
    const positiveConditions = conditions.filter(c => c.negate !== true);
    const negativeConditions = conditions.filter(c => c.negate === true);
    
    // Convert multiple positive conditions to a single regex condition
    if (positiveConditions.length > 1) {
      const regexCondition = convertConditionsToRegex(positiveConditions);
      const newConditions = [regexCondition, ...negativeConditions];
      console.log(`🔄 Converted ${positiveConditions.length} positive conditions to regex, keeping ${negativeConditions.length} negative conditions`);
      return { conditions: newConditions, combination: "AND" };
    }
  }
  
  return { conditions, combination };
};

/**
 * Convert multiple conditions to a single regex condition
 */
const convertConditionsToRegex = (conditions: any[]): any => {
  const regexParts: string[] = [];
  
  for (const condition of conditions) {
    switch (condition.type) {
      case "text":
        if (condition.matchType === "regex") {
          // Keep existing regex as-is (don't double-wrap)
          regexParts.push(condition.text);
        } else {
          // Wrap text in .* for partial matching  
          const escapedText = condition.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          regexParts.push(`.*${escapedText}.*`);
        }
        break;
        
      case "page_ref":
        // Convert page reference to multiple syntax patterns
        const escapedPage = condition.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pagePattern = `.*(\\[\\[${escapedPage}\\]\\]|#${escapedPage}|${escapedPage}::).*`;
        regexParts.push(pagePattern);
        break;
        
      case "block_ref":
        // Convert block reference to pattern (less common, but include for completeness)
        const escapedBlock = condition.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        regexParts.push(`.*\\(\\(${escapedBlock}\\)\\).*`);
        break;
        
      default:
        console.warn(`Unsupported condition type for OR-to-regex conversion: ${condition.type}`);
        // Fallback: treat as text
        const escapedFallback = condition.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        regexParts.push(`.*${escapedFallback}.*`);
    }
  }
  
  // Combine all patterns with OR - this will be sanitized when used in Datomic query
  const combinedRegex = `(?i)(${regexParts.join("|")})`;
  
  return {
    type: "text",
    text: combinedRegex,
    matchType: "regex",
    semanticExpansion: false, // Already expanded
    weight: 1,
    negate: false
  };
};

/**
 * Convert structured HierarchyCondition back to legacy expression string
 * This is a temporary bridge function
 */
const convertStructuredToLegacyExpression = (
  condition: HierarchyCondition
): string => {
  const leftExpr = convertConditionToString(condition.leftCondition);
  const rightExpr = convertConditionToString(condition.rightCondition);
  return `${leftExpr} ${condition.operator} ${rightExpr}`;
};

/**
 * Execute structured strict hierarchy search: left > right (left parent, right child)
 */
const executeStructuredStrictHierarchySearch = async (
  leftConditions: any[],
  rightConditions: any[],
  leftCombination: string,
  rightCombination: string,
  options: any,
  state?: any
): Promise<any[]> => {
  console.log("🏗️ Executing structured strict hierarchy search");
  
  // Convert structured conditions to SearchCondition format
  const convertToSearchConditions = (conditions: any[]): SearchCondition[] => {
    return conditions.map(cond => ({
      type: cond.type,
      text: cond.text,
      matchType: cond.matchType || "contains",
      semanticExpansion: cond.semanticExpansion,
      weight: cond.weight || 1,
      negate: cond.negate || false,
    }));
  };
  
  const leftSearchConditions = convertToSearchConditions(leftConditions);
  const rightSearchConditions = convertToSearchConditions(rightConditions);
  
  // Use existing strict hierarchy search function
  const resultSets = await executeStrictHierarchySearch(
    leftSearchConditions,
    rightSearchConditions,
    leftCombination as "AND" | "OR",
    rightCombination as "AND" | "OR",
    options,
    state
  );
  
  // Flatten result sets array into single array
  return resultSets.flat();
};

/**
 * Execute structured bidirectional search: left <=> right (either direction)
 */
const executeStructuredBidirectionalSearch = async (
  leftConditions: any[],
  rightConditions: any[],
  leftCombination: string,
  rightCombination: string,
  options: any,
  state?: any
): Promise<any[]> => {
  console.log("🔄 Executing structured bidirectional search");
  
  // Convert structured conditions to SearchCondition format
  const convertToSearchConditions = (conditions: any[]): SearchCondition[] => {
    return conditions.map(cond => ({
      type: cond.type,
      text: cond.text,
      matchType: cond.matchType || "contains",
      semanticExpansion: cond.semanticExpansion,
      weight: cond.weight || 1,
      negate: cond.negate || false,
    }));
  };
  
  const leftSearchConditions = convertToSearchConditions(leftConditions);
  const rightSearchConditions = convertToSearchConditions(rightConditions);
  
  // Use existing bidirectional search function
  const resultSets = await executeBidirectionalSearch(
    leftSearchConditions,
    rightSearchConditions,
    leftCombination as "AND" | "OR",
    rightCombination as "AND" | "OR",
    options,
    state
  );
  
  // Flatten result sets array into single array
  return resultSets.flat();
};

/**
 * Execute structured flexible hierarchy search: left => right (same block OR left parent of right)
 */
const executeStructuredFlexibleHierarchySearch = async (
  leftConditions: any[],
  rightConditions: any[],
  leftCombination: string,
  rightCombination: string,
  options: any,
  state?: any
): Promise<any[]> => {
  console.log("🔧 Executing structured flexible hierarchy search");
  
  // Convert structured conditions to SearchCondition format
  const convertToSearchConditions = (conditions: any[]): SearchCondition[] => {
    return conditions.map(cond => ({
      type: cond.type,
      text: cond.text,
      matchType: cond.matchType || "contains",
      semanticExpansion: cond.semanticExpansion,
      weight: cond.weight || 1,
      negate: cond.negate || false,
    }));
  };
  
  const leftSearchConditions = convertToSearchConditions(leftConditions);
  const rightSearchConditions = convertToSearchConditions(rightConditions);
  
  // Use existing flexible hierarchy search function
  const resultSets = await executeFlexibleHierarchySearch(
    leftSearchConditions,
    rightSearchConditions,
    leftCombination as "AND" | "OR",
    rightCombination as "AND" | "OR",
    options,
    state
  );
  
  // Flatten result sets array into single array
  return resultSets.flat();
};

/**
 * Execute structured deep flexible hierarchy search: left =>> right (left ancestor, right descendant with flexibility, deep)
 */
const executeStructuredDeepFlexibleHierarchySearch = async (
  leftConditions: any[],
  rightConditions: any[],
  leftCombination: string,
  rightCombination: string,
  options: any,
  state?: any
): Promise<any[]> => {
  console.log("🌳🔧 Executing structured deep flexible hierarchy search");
  
  // Convert structured conditions to SearchCondition format
  const convertToSearchConditions = (conditions: any[]): SearchCondition[] => {
    return conditions.map(cond => ({
      type: cond.type,
      text: cond.text,
      matchType: cond.matchType || "contains",
      semanticExpansion: cond.semanticExpansion,
      weight: cond.weight || 1,
      negate: cond.negate || false,
    }));
  };
  
  const leftSearchConditions = convertToSearchConditions(leftConditions);
  const rightSearchConditions = convertToSearchConditions(rightConditions);
  
  // For =>> operator, we need flexible search with max depth instead of levels: 1
  // Step 1: Same-block search (A + B) - like flexible hierarchy
  console.log(`📝 Step 1: Same-block search (A + B)`);
  const sameBlockConditions = [...leftSearchConditions, ...rightSearchConditions];
  const sameBlockSearch = await executeContentSearch(
    sameBlockConditions,
    "AND", // For flexible hierarchy, both terms must appear
    options,
    state
  );

  // Step 2: Deep hierarchy search (A =>> B) - use max depth
  console.log(`🌳 Step 2: Deep flexible hierarchy search (A =>> B, max depth)`);
  const hierarchyResults = await searchBlocksWithHierarchicalConditions(
    leftSearchConditions,
    leftCombination as "AND" | "OR",
    [
      {
        direction: "descendants" as const,
        levels: options.maxHierarchyDepth, // Use max depth for =>> operator
        conditions: rightSearchConditions.map((cond) => ({
          type: cond.type as any,
          text: cond.text,
          matchType: cond.matchType,
          semanticExpansion: cond.semanticExpansion,
          weight: cond.weight,
          negate: cond.negate,
        })),
        combineLogic: rightCombination as "AND" | "OR",
      },
    ],
    "AND",
    options,
    state
  );

  // Combine results with same-block priority (like flexible hierarchy)
  const resultSets = [sameBlockSearch.results, hierarchyResults];
  
  // Flatten result sets and ensure expansionLevel is set
  const flatResults = resultSets.flat();
  const expansionLevel = state?.expansionLevel || 0;
  
  return flatResults.map(result => ({
    ...result,
    expansionLevel: result.expansionLevel || expansionLevel
  }));
};

/**
 * Execute structured deep bidirectional search: left <<=>> right (either direction, any depth)
 */
const executeStructuredDeepBidirectionalSearch = async (
  leftConditions: any[],
  rightConditions: any[],
  leftCombination: string,
  rightCombination: string,
  options: any,
  state?: any
): Promise<any[]> => {
  console.log("🔄🌳 Executing structured deep bidirectional search");
  
  // Convert structured conditions to SearchCondition format
  const convertToSearchConditions = (conditions: any[]): SearchCondition[] => {
    return conditions.map(cond => ({
      type: cond.type,
      text: cond.text,
      matchType: cond.matchType || "contains",
      semanticExpansion: cond.semanticExpansion,
      weight: cond.weight || 1,
      negate: cond.negate || false,
    }));
  };
  
  const leftSearchConditions = convertToSearchConditions(leftConditions);
  const rightSearchConditions = convertToSearchConditions(rightConditions);
  
  // Use existing deep bidirectional search function
  const resultSets = await executeDeepBidirectionalSearch(
    leftSearchConditions,
    rightSearchConditions,
    leftCombination as "AND" | "OR",
    rightCombination as "AND" | "OR",
    options,
    state
  );
  
  // Flatten result sets and ensure expansionLevel is set
  const flatResults = resultSets.flat();
  const expansionLevel = state?.expansionLevel || 0;
  
  return flatResults.map(result => ({
    ...result,
    expansionLevel: result.expansionLevel || expansionLevel
  }));
};

/**
 * Execute structured deep strict hierarchy search: left >> right (left ancestor, right descendant)
 */
const executeStructuredDeepStrictHierarchySearch = async (
  leftConditions: any[],
  rightConditions: any[],
  leftCombination: string,
  rightCombination: string,
  options: any,
  state?: any
): Promise<any[]> => {
  console.log("🌳 Executing structured deep strict hierarchy search");
  
  // Convert structured conditions to SearchCondition format
  const convertToSearchConditions = (conditions: any[]): SearchCondition[] => {
    return conditions.map(cond => ({
      type: cond.type,
      text: cond.text,
      matchType: cond.matchType || "contains",
      semanticExpansion: cond.semanticExpansion,
      weight: cond.weight || 1,
      negate: cond.negate || false,
    }));
  };
  
  const leftSearchConditions = convertToSearchConditions(leftConditions);
  const rightSearchConditions = convertToSearchConditions(rightConditions);
  
  // Use existing deep hierarchy search function
  const resultSets = await executeDeepStrictHierarchySearch(
    leftSearchConditions,
    rightSearchConditions,
    leftCombination as "AND" | "OR",
    rightCombination as "AND" | "OR",
    options,
    state
  );
  
  // Flatten result sets array into single array
  return resultSets.flat();
};



/**
 * Build condition clauses for hierarchy search with custom block variables
 * This fixes the issue where DatomicQueryBuilder hardcodes ?b for all block references
 */
const buildHierarchyConditionClauses = (
  conditions: SearchCondition[],
  combineLogic: "AND" | "OR",
  blockVariable: string,
  contentVariable: string,
  patternOffset: number
): string => {
  if (conditions.length === 0) return "";

  let clauses = "";
  
  // For AND logic or single condition
  if (combineLogic === "AND" || conditions.length === 1) {
    // Check if we have mixed logic that can be converted to regex
    const hasNegatedConditions = conditions.some(c => c.negate === true);
    const hasPositiveConditions = conditions.some(c => c.negate !== true);
    
    // If we have both positive and negative conditions, we might be able to use OR-to-regex conversion
    // But for now, process normally - OR-to-regex will be handled at a higher level
    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];
      const patternIndex = i + patternOffset;
      clauses += buildSingleHierarchyConditionClause(
        condition,
        blockVariable,
        contentVariable,
        patternIndex
      );
    }
  } else {
    // For OR logic, separate preparation clauses from OR clauses
    let preparationClauses: string[] = [];
    let orClauses: string[] = [];
    
    // Process each condition and separate preparation from OR clauses
    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];
      const patternIndex = i + patternOffset;
      
      switch (condition.type) {
        case "page_ref":
          // Preparation clauses outside OR
          preparationClauses.push(`\n                [(ground "${condition.text}") ?page-title${patternIndex}]`);
          preparationClauses.push(`\n                [?ref-page${patternIndex} :node/title ?page-title${patternIndex}]`);
          // Only the actual matching clause inside OR
          orClauses.push(`\n                  [${blockVariable} :block/refs ?ref-page${patternIndex}]`);
          break;
          
        case "text":
          let pattern: string;
          if (condition.matchType === "regex") {
            const sanitizedRegex = sanitizeRegexForDatomic(condition.text);
            pattern = sanitizedRegex.isCaseInsensitive 
              ? sanitizedRegex.pattern 
              : `(?i)${sanitizedRegex.pattern}`;
          } else {
            pattern = `(?i).*${condition.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*`;
          }
          // Preparation clauses outside OR
          preparationClauses.push(`\n                [(re-pattern "${pattern}") ?pattern${patternIndex}]`);
          // Only the actual matching clause inside OR
          orClauses.push(`\n                  [(re-find ?pattern${patternIndex} ${contentVariable})]`);
          break;
          
        case "block_ref":
          // Block refs don't need preparation, can go directly in OR
          orClauses.push(`\n                  [?ref-block${patternIndex} :block/uid "${condition.text}"]
                  [${blockVariable} :block/refs ?ref-block${patternIndex}]`);
          break;
          
        default:
          console.warn(`Unsupported condition type for hierarchy: ${condition.type}`);
      }
    }
    
    // Add preparation clauses first (outside OR)
    clauses += preparationClauses.join("");
    
    // Then add OR clause
    if (orClauses.length > 0) {
      clauses += `\n                (or${orClauses.join("")}\n                )`;
    }
  }
  
  return clauses;
};

/**
 * Build a single condition clause for hierarchy search
 */
const buildSingleHierarchyConditionClause = (
  condition: SearchCondition,
  blockVariable: string,
  contentVariable: string,
  patternIndex: number
): string => {
  let clause = "";
  
  switch (condition.type) {
    case "page_ref":
      clause = `\n                [?ref-page${patternIndex} :node/title "${condition.text}"]
                [${blockVariable} :block/refs ?ref-page${patternIndex}]`;
      break;
    
    case "text":
      let pattern: string;
      if (condition.matchType === "regex") {
        const sanitizedRegex = sanitizeRegexForDatomic(condition.text);
        pattern = sanitizedRegex.isCaseInsensitive 
          ? sanitizedRegex.pattern 
          : `(?i)${sanitizedRegex.pattern}`;
      } else {
        pattern = `(?i).*${condition.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*`;
      }
      clause = `\n                [(re-pattern "${pattern}") ?pattern${patternIndex}]
                [(re-find ?pattern${patternIndex} ${contentVariable})]`;
      break;
    
    case "block_ref":
      clause = `\n                [?ref-block${patternIndex} :block/uid "${condition.text}"]
                [${blockVariable} :block/refs ?ref-block${patternIndex}]`;
      break;
    
    default:
      console.warn(`Unsupported condition type for hierarchy: ${condition.type}`);
      return "";
  }
  
  // Apply negation if needed
  if (condition.negate) {
    clause = `\n                (not ${clause.trim()})`;
  }
  
  return clause;
};

/**
 * Build page reference OR clause
 */
const buildPageRefOrClause = (
  condition: SearchCondition,
  blockVariable: string,
  patternIndex: number
): string => {
  return `\n                  [(ground "${condition.text}") ?page-title${patternIndex}]
                  [?ref-page${patternIndex} :node/title ?page-title${patternIndex}]
                  [${blockVariable} :block/refs ?ref-page${patternIndex}]`;
};

/**
 * Build text OR clause
 */
const buildTextOrClause = (
  condition: SearchCondition,
  contentVariable: string,
  patternIndex: number
): string => {
  const pattern = condition.matchType === "regex" 
    ? condition.text 
    : `(?i).*${condition.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*`;
  return `\n                  [(re-pattern "${pattern}") ?pattern${patternIndex}]
                  [(re-find ?pattern${patternIndex} ${contentVariable})]`;
};

/**
 * Convert SearchCondition or CompoundCondition to string representation
 */
const convertConditionToString = (
  condition: StructuredSearchCondition | CompoundCondition
): string => {
  if ("operator" in condition) {
    // CompoundCondition
    const operatorSymbol = condition.operator === "AND" ? " + " : " | ";
    const conditionStrings = condition.conditions.map(convertConditionToString);
    return `(${conditionStrings.join(operatorSymbol)})`;
  } else {
    // SearchCondition
    return condition.text;
  }
};

/**
 * Convert structured SearchCondition to legacy condition format
 */
const convertStructuredToLegacyCondition = (
  condition: StructuredSearchCondition
) => ({
  type: condition.type,
  text: condition.text,
  matchType: condition.matchType,
  weight: condition.weight,
  negate: condition.negate,
});

const findBlocksWithHierarchyImpl = async (
  input: z.infer<typeof schema>,
  state?: any
) => {
  const {
    contentConditions,
    hierarchyConditions,
    combineConditions,
    combineHierarchy,
    includeChildren,
    childDepth,
    includeParents,
    parentDepth,
    includeDaily,
    dateRange,
    sortBy,
    limit,
    secureMode,
    fromResultId,
    limitToBlockUids,
    limitToPageUids,
    hierarchicalExpression,
    hierarchyCondition,
    maxHierarchyDepth,
    strategyCombination,
  } = input;

  // Log all tool arguments for debugging
  console.log("🔍 [TOOL CALL] findBlocksWithHierarchy called with arguments:", {
    contentConditions: contentConditions?.length || 0,
    hierarchyConditions: hierarchyConditions?.length || 0,
    hierarchicalExpression: hierarchicalExpression || null,
    hierarchyCondition: hierarchyCondition ? {
      operator: hierarchyCondition.operator,
      leftConditions: hierarchyCondition.leftConditions,
      rightConditions: hierarchyCondition.rightConditions,
      leftCombination: hierarchyCondition.leftCombination,
      rightCombination: hierarchyCondition.rightCombination,
      maxDepth: hierarchyCondition.maxDepth,
    } : null,
    combineConditions,
    limit,
    secureMode,
    fromResultId: fromResultId || null,
  });

  // Validation: Prevent using both legacy and modern APIs simultaneously
  if (hierarchicalExpression && hierarchyCondition) {
    throw new Error(
      "Cannot use both 'hierarchicalExpression' (legacy) and 'hierarchyCondition' (modern) simultaneously. Please use only 'hierarchyCondition' for better reliability."
    );
  }

  // Handle modern structured hierarchy condition (PREFERRED API - OpenAI compatible)
  if (hierarchyCondition) {
    console.log(
      `🚀 Processing hierarchyCondition with operator: "${hierarchyCondition.operator}"`
    );
    
    // Check if this is a grouped condition (new format)
    if (hierarchyCondition.leftConditionGroups || hierarchyCondition.rightConditionGroups) {
      console.log("🔧 Detected grouped conditions, using structured processing");
      const structuredQuery = {
        hierarchyCondition: hierarchyCondition,
        searchConditions: [],
        combineConditions: "AND" as const,
      };
      
      return await processStructuredHierarchyCondition(
        structuredQuery.hierarchyCondition,
        {
          maxHierarchyDepth,
          strategyCombination,
          includeChildren,
          childDepth,
          includeParents,
          parentDepth,
          includeDaily,
          dateRange,
          sortBy,
          limit,
          secureMode,
          fromResultId,
          limitToBlockUids,
          limitToPageUids,
          excludeBlockUid: input.excludeBlockUid,
        },
        state
      );
    }
    
    // Handle simple array-based conditions (backward compatibility)
    console.log("🔧 Using legacy OpenAI array processing for simple conditions");
    return await processOpenAIHierarchyCondition(
      hierarchyCondition,
      {
        maxHierarchyDepth,
        strategyCombination,
        includeChildren,
        childDepth,
        includeParents,
        parentDepth,
        includeDaily,
        dateRange,
        sortBy,
        limit,
        secureMode,
        fromResultId,
        limitToBlockUids,
        limitToPageUids,
        excludeBlockUid: input.excludeBlockUid,
      },
      state
    );
  }

  // Debug logging for hierarchyConditions parameter
  console.log(`🔍 [DEBUG] findBlocksWithHierarchy called with hierarchyConditions:`, {
    hierarchyConditions,
    hierarchyConditionsCount: hierarchyConditions?.length || 0,
    hierarchyConditionsDetails: hierarchyConditions?.map((hc, i) => ({
      index: i,
      direction: hc.direction,
      levels: hc.levels,
      conditionsCount: hc.conditions?.length || 0,
      conditions: hc.conditions?.map(c => ({ text: c.text, type: c.type, matchType: c.matchType }))
    }))
  });

  // Legacy structured format handling removed for simplification

  console.log(
    `🔍 FindBlocksWithHierarchy: ${
      hierarchicalExpression
        ? 'hierarchical expression: "' + hierarchicalExpression + '"'
        : contentConditions.length +
          " content conditions, " +
          (hierarchyConditions?.length || 0) +
          " hierarchy conditions"
    }`
  );

  // Handle hierarchical expressions if provided
  if (hierarchicalExpression) {
    console.log(
      `🚀 Processing hierarchical expression: "${hierarchicalExpression}" with semantic expansion`
    );

    // Convert to structured format for semantic expansion support
    const structuredCondition = convertHierarchicalExpressionToStructured(
      hierarchicalExpression
    );

    console.log(`🔍 [DEBUG] Converted hierarchical expression to structured:`, {
      originalExpression: hierarchicalExpression,
      structuredCondition: structuredCondition ? {
        operator: structuredCondition.operator,
        leftCondition: structuredCondition.leftCondition,
        rightCondition: structuredCondition.rightCondition,
        maxDepth: structuredCondition.maxDepth
      } : null
    });

    if (structuredCondition) {
      console.log(
        "🔄 Converted to structured format, applying semantic expansion"
      );
      return await processStructuredHierarchyQuery(
        {
          hierarchyCondition: structuredCondition,
          searchConditions: [],
          combineConditions: "AND",
        },
        {
          maxHierarchyDepth,
          strategyCombination,
                includeChildren,
          childDepth,
          includeParents,
          parentDepth,
          includeDaily,
          dateRange,
          sortBy,
          limit,
          secureMode,
          fromResultId,
          limitToBlockUids,
          limitToPageUids,
          excludeBlockUid: input.excludeBlockUid,
        },
        state
      );
    } else {
      // Fallback to original processing if conversion fails
      console.log(
        "⚠️ Failed to convert to structured format, using legacy processing"
      );
      return await processHierarchicalExpression(
        hierarchicalExpression,
        {
          maxHierarchyDepth,
          strategyCombination,
                includeChildren,
          childDepth,
          includeParents,
          parentDepth,
          includeDaily,
          dateRange,
          sortBy,
          limit,
          secureMode,
          fromResultId,
          limitToBlockUids,
          limitToPageUids,
          excludeBlockUid: input.excludeBlockUid,
        },
        state
      );
    }
  }

  // UID-based filtering for optimization
  const { blockUids: finalBlockUids, pageUids: finalPageUids } =
    extractUidsFromResults(
      fromResultId,
      limitToBlockUids,
      limitToPageUids,
      state
    );

  // Step 1: Process content conditions with semantic expansion
  const expandedContentConditions = await expandConditions(
    contentConditions,
    state
  );

  // Step 2: Find blocks matching content conditions
  const contentMatches = await searchBlocksWithConditions(
    expandedContentConditions,
    combineConditions,
    includeDaily,
    finalBlockUids.length > 0 ? finalBlockUids : undefined,
    finalPageUids.length > 0 ? finalPageUids : undefined
  );

  console.log(
    `📊 Found ${contentMatches.length} blocks matching content conditions`
  );

  // Step 3: Apply hierarchy conditions if specified
  let hierarchyFilteredBlocks = contentMatches;
  if (hierarchyConditions?.length > 0) {
    hierarchyFilteredBlocks = await applyHierarchyFilters(
      contentMatches,
      hierarchyConditions,
      combineHierarchy
    );
    console.log(
      `📊 After hierarchy filtering: ${hierarchyFilteredBlocks.length} blocks`
    );
  }

  // Step 4: Enrich with full hierarchical context (only if explicitly requested)
  let enrichedResults = hierarchyFilteredBlocks;
  if (includeChildren === true || includeParents === true) {
    enrichedResults = await enrichWithFullHierarchy(
      hierarchyFilteredBlocks,
      includeChildren,
      childDepth,
      includeParents,
      parentDepth,
      secureMode
    );
    console.log(
      `🔧 Enriched ${hierarchyFilteredBlocks.length} blocks with hierarchical context`
    );
  } else {
    console.log(
      `⚡ Skipping enrichment (not explicitly requested) - performance optimized`
    );
  }

  // Step 5: Apply date range filtering
  let filteredResults = enrichedResults;
  if (dateRange && (dateRange.start || dateRange.end)) {
    const parsedDateRange = {
      start:
        typeof dateRange.start === "string"
          ? new Date(dateRange.start)
          : dateRange.start,
      end:
        typeof dateRange.end === "string"
          ? new Date(dateRange.end)
          : dateRange.end,
    };
    const filterMode = dateRange.filterMode || "modified";
    filteredResults = filterByDateRange(enrichedResults, parsedDateRange, filterMode);
  }

  // Step 5.5: Exclude user query block from results by UID
  if (input.excludeBlockUid) {
    const originalCount = filteredResults.length;
    filteredResults = filteredResults.filter(
      (result) => result.uid !== input.excludeBlockUid
    );
    const excludedCount = originalCount - filteredResults.length;
    if (excludedCount > 0) {
      console.log(
        `🚫 [Hierarchy] Excluded ${excludedCount} user query block(s) (UID: ${input.excludeBlockUid})`
      );
    }
  }

  // Step 6: Sort results
  filteredResults = sortHierarchyResults(
    filteredResults,
    sortBy,
    contentConditions
  );

  // Step 7: Limit results
  if (filteredResults.length > limit) {
    filteredResults = filteredResults.slice(0, limit);
  }

  return filteredResults;
};

/**
 * Process hierarchical expressions by decomposing into multiple search strategies
 */
const processHierarchicalExpression = async (
  expression: string,
  options: {
    maxHierarchyDepth: number;
    strategyCombination: "union" | "intersection";
    includeChildren?: boolean;
    childDepth?: number;
    includeParents?: boolean;
    parentDepth?: number;
    includeDaily: boolean;
    dateRange?: any;
    sortBy: string;
    limit: number;
    secureMode: boolean;
    fromResultId?: string;
    limitToBlockUids?: string[];
    limitToPageUids?: string[];
    excludeBlockUid?: string;
  },
  state?: any
): Promise<any[]> => {
  const parsedExpression = parseHierarchicalExpression(expression);
  if (!parsedExpression) {
    throw new Error(`Failed to parse hierarchical expression: "${expression}"`);
  }

  console.log(`🧩 Parsed expression type: ${parsedExpression.type}`);

  // If it's just a simple term, fall back to basic content search
  if (parsedExpression.type === "term") {
    console.log(`📝 Simple term detected, using findBlocksByContent`);
    const searchResult = await executeContentSearch(
      [
        {
          type: "text",
          text: parsedExpression.text,
          matchType: "contains",
          semanticExpansion: undefined,
          weight: 1.0,
          negate: false,
        },
      ],
      "AND",
      options,
      state
    );
    return searchResult.results;
  }

  // Handle hierarchical expressions
  if (
    parsedExpression.type === "strict_hierarchy" ||
    parsedExpression.type === "deep_strict_hierarchy" ||
    parsedExpression.type === "flexible_hierarchy" ||
    parsedExpression.type === "bidirectional" ||
    parsedExpression.type === "deep_bidirectional" ||
    parsedExpression.type === "strict_hierarchy_left" ||
    parsedExpression.type === "deep_strict_hierarchy_left" ||
    parsedExpression.type === "flexible_hierarchy_left" ||
    parsedExpression.type === "flexible_hierarchy_right" ||
    parsedExpression.type === "deep_flexible_hierarchy"
  ) {
    return await processHierarchicalQuery(parsedExpression, options, state);
  }

  if (parsedExpression.type === "compound") {
    return await processCompoundQuery(parsedExpression, options, state);
  }

  throw new Error(`Unsupported expression type: ${parsedExpression.type}`);
};

/**
 * Process different types of hierarchical queries
 */
const processHierarchicalQuery = async (
  expr: HierarchicalExpression,
  options: any,
  state?: any
): Promise<any[]> => {
  const expansionLevel = state?.expansionLevel || 0;
  const globalSemanticExpansion =
    options.semanticExpansion || expansionLevel >= 2;
  const leftConditions = extractSearchConditions(
    expr.leftOperand,
    globalSemanticExpansion
  );
  const rightConditions = extractSearchConditions(
    expr.rightOperand,
    globalSemanticExpansion
  );
  const leftCombineLogic = getCombineLogic(expr.leftOperand);
  const rightCombineLogic = getCombineLogic(expr.rightOperand);

  const leftDisplay = formatExpressionForDisplay(expr.leftOperand);
  const rightDisplay = formatExpressionForDisplay(expr.rightOperand);
  console.log(
    `🔄 Processing ${expr.operator} with left: ${leftDisplay} (${leftCombineLogic}), right: ${rightDisplay} (${rightCombineLogic})`
  );

  // Show concise search info (no extra queries for performance)
  // const leftTerms = formatExpressionForDisplay(expr.leftOperand);
  // const rightTerms = formatExpressionForDisplay(expr.rightOperand);

  // updateAgentToaster(`🔍 Searching: ${leftTerms} ${expr.operator} ${rightTerms}`);

  let resultSets: any[] = [];

  switch (expr.operator) {
    case ">":
      // Strict hierarchy: A > B (A parent, B child)
      resultSets = await executeStrictHierarchySearch(
        leftConditions,
        rightConditions,
        leftCombineLogic,
        rightCombineLogic,
        options,
        state
      );
      break;

    case ">>":
      // Deep strict hierarchy: A >> B (A ancestor, B descendant, any depth)
      resultSets = await executeDeepStrictHierarchySearch(
        leftConditions,
        rightConditions,
        leftCombineLogic,
        rightCombineLogic,
        options,
        state
      );
      break;

    case "=>":
      // Flexible hierarchy: A => B (same block OR A parent of B)
      resultSets = await executeFlexibleHierarchySearch(
        leftConditions,
        rightConditions,
        leftCombineLogic,
        rightCombineLogic,
        options,
        state
      );
      break;

    case "<=>":
      // Bidirectional: A <=> B (A parent of B OR B parent of A)
      resultSets = await executeBidirectionalSearch(
        leftConditions,
        rightConditions,
        leftCombineLogic,
        rightCombineLogic,
        options,
        state
      );
      break;

    case "<<=>>":
      // Deep bidirectional: A <<=>> B (A ancestor/descendant of B, any depth)
      resultSets = await executeDeepBidirectionalSearch(
        leftConditions,
        rightConditions,
        leftCombineLogic,
        rightCombineLogic,
        options,
        state
      );
      break;

    case "<":
      // Inverse strict hierarchy: A < B (A child, B parent) - return child blocks
      resultSets = await executeInverseStrictHierarchySearch(
        leftConditions,  // A (child condition to return)
        rightConditions, // B (parent condition to filter)
        leftCombineLogic,
        rightCombineLogic,
        options,
        state
      );
      break;

    case "<<":
      // Inverse deep strict hierarchy: A << B (A descendant, B ancestor) - swap the conditions
      resultSets = await executeDeepStrictHierarchySearch(
        rightConditions, // B becomes ancestor
        leftConditions,  // A becomes descendant
        rightCombineLogic,
        leftCombineLogic,
        options,
        state
      );
      break;

    case "<=":
      // Inverse flexible hierarchy: A <= B (same block OR A child of B) - swap the conditions
      resultSets = await executeFlexibleHierarchySearch(
        rightConditions, // B becomes parent
        leftConditions,  // A becomes child
        rightCombineLogic,
        leftCombineLogic,
        options,
        state
      );
      break;

    case "=>>":
      // Right flexible hierarchy: A =>> B (A ancestor, B descendant with flexibility)
      resultSets = await executeFlexibleHierarchySearch(
        leftConditions,
        rightConditions,
        leftCombineLogic,
        rightCombineLogic,
        options,
        state
      );
      break;

    case "<<=":
      // Left deep flexible hierarchy: A <<= B (A descendant, B ancestor with flexibility) - swap the conditions
      resultSets = await executeFlexibleHierarchySearch(
        rightConditions, // B becomes ancestor
        leftConditions,  // A becomes descendant
        rightCombineLogic,
        leftCombineLogic,
        options,
        state
      );
      break;

    default:
      throw new Error(`Unsupported hierarchical operator: ${expr.operator}`);
  }

  // Combine all result sets
  if (resultSets.length === 0) {
    return [];
  }

  if (resultSets.length === 1) {
    return resultSets[0];
  }

  // Use combineResults to merge multiple result sets
  const combinedResults = await executeCombineResults(
    resultSets,
    options.strategyCombination
  );

  // Apply final sorting and limiting
  return applyFinalProcessing(combinedResults, options);
};

/**
 * Process compound queries (AND/OR operations) with proper structure preservation
 * This handles queries like "(A | A') + (B | B')" correctly by preserving grouping
 */
const processCompoundQuery = async (
  expr: CompoundExpression,
  options: any,
  state?: any
): Promise<any[]> => {
  console.log(
    `🔍 Processing compound ${expr.operator} query with ${expr.operands.length} operands`
  );

  // Check if this is a mixed structure that needs special handling
  const hasNestedCompounds = expr.operands.some((op) => op.type === "compound");

  if (hasNestedCompounds && expr.operator === "AND") {
    // Handle complex structures like (A | A') + (B | B')
    console.log(`🧩 Processing nested compound structure with AND operator`);

    const groupResults: any[] = [];

    // Process each operand group separately
    for (const operand of expr.operands) {
      if (operand.type === "compound") {
        // Process nested compound (like A | A')
        const groupConditions = extractSearchConditions(operand);
        const groupLogic = getCombineLogic(operand);

        console.log(
          `  📁 Processing ${operand.operator} group with ${groupConditions.length} conditions`
        );

        const groupResult = await executeContentSearch(
          groupConditions,
          groupLogic,
          options,
          state
        );

        groupResults.push(groupResult.results || []);
      } else {
        // Process single term
        const termConditions = extractSearchConditions(operand);
        const termResult = await executeContentSearch(
          termConditions,
          "AND",
          options,
          state
        );

        groupResults.push(termResult.results || []);
      }
    }

    // Intersect all group results (AND operation between groups)
    if (groupResults.length === 0) return [];
    if (groupResults.length === 1) return groupResults[0];

    console.log(`🔗 Intersecting ${groupResults.length} result groups`);

    // Find UIDs that appear in ALL groups
    const allUIDs = groupResults.map(
      (group) => new Set(group.map((item: any) => item.uid || item[0]))
    );
    const intersection = allUIDs[0];

    for (let i = 1; i < allUIDs.length; i++) {
      for (const uid of intersection) {
        if (!allUIDs[i].has(uid)) {
          intersection.delete(uid);
        }
      }
    }

    console.log(`📊 Intersection found ${intersection.size} common results`);

    // Return results from first group that match intersection
    return groupResults[0].filter((item: any) =>
      intersection.has(item.uid || item[0])
    );
  } else {
    // Simple compound - use flat processing
    const globalSemanticExpansion = options.semanticExpansion;
    const allConditions = extractSearchConditions(
      expr,
      globalSemanticExpansion
    );
    const combineLogic = getCombineLogic(expr);

    console.log(
      `🔍 Simple compound query: ${allConditions.length} conditions with ${combineLogic} logic`
    );

    const searchResult = await executeContentSearch(
      allConditions,
      combineLogic,
      options,
      state
    );

    return searchResult.results || [];
  }
};

/**
 * Execute content search using findBlocksByContent
 */
const executeContentSearch = async (
  conditions: SearchCondition[],
  combineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<{ results: any[]; totalFound: number }> => {
  console.log(
    `🔍 Executing content search with ${conditions.length} conditions (${combineLogic})`
  );

  try {
    const toolInput = {
      conditions: conditions.map((cond) => ({
        text: cond.text,
        type: cond.type || "text",
        matchType: cond.matchType || "contains",
        negate: cond.negate || false,
      })),
      combineConditions: combineLogic,
      includeDaily: options.includeDaily,
      dateRange: options.dateRange,
      limit: options.limit,
      secureMode: options.secureMode,
    };

    // Call the tool with minimal context to avoid serialization issues
    const result = await findBlocksByContentTool.invoke(toolInput, {
      configurable: { state },
      runName: "internal_call",
    });
    const parsedResult =
      typeof result === "string" ? JSON.parse(result) : result;

    if (parsedResult.success && Array.isArray(parsedResult.data)) {
      console.log(
        `✅ Content search returned ${parsedResult.data.length} results`
      );
      // Return both results and metadata for real counts
      return {
        results: parsedResult.data,
        totalFound:
          parsedResult.metadata?.totalFound || parsedResult.data.length,
      };
    } else {
      console.warn(
        `⚠️ Content search failed or returned no data:`,
        parsedResult.error
      );
      return { results: [], totalFound: 0 };
    }
  } catch (error) {
    console.error(`❌ Error in content search:`, error);
    return { results: [], totalFound: 0 };
  }
};

/**
 * Execute strict hierarchy search: A > B (A parent, B child)
 */
const executeStrictHierarchySearch = async (
  leftConditions: SearchCondition[],
  rightConditions: SearchCondition[],
  leftCombineLogic: "AND" | "OR",
  rightCombineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  console.log(`🏗️ Executing strict hierarchy search`);

  // Show search terms without extra queries (for performance)
  // const leftTermText = leftConditions
  //   .map((c) => c.text)
  //   .join(leftCombineLogic === "OR" ? " | " : " + ");
  // const rightTermText = rightConditions
  //   .map((c) => c.text)
  //   .join(rightCombineLogic === "OR" ? " | " : " + ");

  // Use direct content-filtered hierarchy search (like deep search does)
  console.log(
    `🔍 Building single Datomic query for parent→child with content filtering`
  );

  const results = await executeDirectHierarchySearch(
    leftConditions,
    leftCombineLogic,
    rightConditions,
    rightCombineLogic,
    options,
    state
  );

  if (results.length > 0) {
    updateAgentToaster(
      `🏗️ Parent→child search: ${results.length} hierarchy relationships found`
    );
  }

  return [results]; // Return as array of result sets
};

/**
 * Execute inverse strict hierarchy search: A < B (A child, B parent) - returns child blocks
 * Just swap the roles in the existing direct hierarchy search but return child blocks
 */
const executeInverseStrictHierarchySearch = async (
  childConditions: SearchCondition[], // Conditions for blocks to return (children)
  parentConditions: SearchCondition[], // Conditions for parent blocks (filter)
  childCombineLogic: "AND" | "OR",
  parentCombineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  console.log(`🏗️ Executing inverse strict hierarchy search (returning children)`);

  // Call executeDirectHierarchySearch but we need to extract child blocks from the query results
  // This is much simpler than my previous overcomplicated approach
  const hierarchyResults = await executeDirectHierarchySearchAndReturnChildren(
    parentConditions, // Parent conditions (for filtering)
    parentCombineLogic,
    childConditions, // Child conditions (for results)
    childCombineLogic,
    options,
    state
  );
  
  if (hierarchyResults.length > 0) {
    updateAgentToaster(
      `🏗️ Child←parent search: ${hierarchyResults.length} hierarchy relationships found`
    );
  }

  return [hierarchyResults]; // Return as array of result sets
};

/**
 * Execute the same direct hierarchy search as executeDirectHierarchySearch but return child blocks instead of parent blocks
 * This is a minimal modification - same efficient Datomic query, just different result mapping
 */
const executeDirectHierarchySearchAndReturnChildren = async (
  parentConditions: SearchCondition[],
  parentCombineLogic: "AND" | "OR",
  childConditions: SearchCondition[],
  childCombineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  // Apply semantic expansion (same as original)
  const shouldExpand =
    parentConditions.some((c) => c.semanticExpansion) ||
    childConditions.some((c) => c.semanticExpansion);
  const expandedParentConditions = shouldExpand
    ? await expandConditions(parentConditions, state)
    : parentConditions;
  const expandedChildConditions = shouldExpand
    ? await expandConditions(childConditions, state)
    : childConditions;

  // Build the exact same Datomic query as executeDirectHierarchySearch
  let query = `[:find ?parent-uid ?parent-content ?parent-page-title ?parent-page-uid 
                       ?child-uid ?child-content ?child-page-title ?child-page-uid
                :where
                ;; Parent block structure
                [?parent :block/uid ?parent-uid]
                [?parent :block/string ?parent-content]
                [?parent :block/page ?parent-page]
                [?parent-page :node/title ?parent-page-title]
                [?parent-page :block/uid ?parent-page-uid]
                
                ;; Child block structure  
                [?child :block/uid ?child-uid]
                [?child :block/string ?child-content]
                [?child :block/page ?child-page]
                [?child-page :node/title ?child-page-title]
                [?child-page :block/uid ?child-page-uid]
                
                ;; Hierarchy relationship (parent -> child)
                [?parent :block/children ?child]`;

  // Add parent content filtering (same as original)
  const parentQueryBuilder = new DatomicQueryBuilder(
    expandedParentConditions,
    parentCombineLogic
  );
  const {
    patternDefinitions: parentPatterns,
    conditionClauses: parentClauses,
  } = parentQueryBuilder.buildConditionClauses("?parent-content");
  query += parentPatterns;
  query += parentClauses;

  // Add child content filtering (same as original)
  const childQueryBuilder = new DatomicQueryBuilder(
    expandedChildConditions,
    childCombineLogic
  );
  const {
    patternDefinitions: childPatterns,
    conditionClauses: childClauses,
  } = childQueryBuilder.buildConditionClauses("?child-content");

  // Fix pattern variable conflicts by replacing pattern indices in child patterns
  const offsetChildPatterns = childPatterns.replace(
    /\?pattern(\d+)/g,
    (_, num) => `?pattern${parseInt(num) + expandedParentConditions.length}`
  );
  const offsetChildClauses = childClauses.replace(
    /\?pattern(\d+)/g,
    (_, num) => `?pattern${parseInt(num) + expandedParentConditions.length}`
  );
  
  query += offsetChildPatterns;
  query += offsetChildClauses;

  // Exclude specific block if provided (same as original)
  if (options.excludeBlockUid) {
    query += `\n                [(not= ?child-uid "${options.excludeBlockUid}")]`;
  }

  query += `]`;

  const hierarchyResults = await executeDatomicQuery(query);

  // Transform results to return CHILD blocks instead of parent blocks (only difference from original)
  const childBlocks = hierarchyResults.map(
    ([
      parentUid,
      parentContent,
      parentPageTitle,
      parentPageUid,
      childUid,
      childContent,
      childPageTitle,
      childPageUid,
    ]) => ({
      uid: childUid, // Return child UID instead of parent UID
      content: childContent, // Return child content instead of parent content
      pageTitle: childPageTitle,
      pageUid: childPageUid,
      created: new Date(),
      modified: new Date(),
      isDaily: false,
      children: [],
      parents: [],
      isPage: false,
      // Add hierarchy context for debugging
      parentInfo: {
        uid: parentUid,
        content: parentContent,
        pageTitle: parentPageTitle,
        pageUid: parentPageUid,
      }
    })
  );

  return childBlocks;
};

/**
 * Execute deep strict hierarchy search: A >> B (A ancestor, B descendant, any depth)
 */
const executeDeepStrictHierarchySearch = async (
  leftConditions: SearchCondition[],
  rightConditions: SearchCondition[],
  leftCombineLogic: "AND" | "OR",
  rightCombineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  console.log(`🌳 Executing deep strict hierarchy search (>> operator)`);

  // Show search terms without extra queries (for performance)
  // const leftTermText = leftConditions
  //   .map((c) => c.text)
  //   .join(leftCombineLogic === "OR" ? " | " : " + ");
  // const rightTermText = rightConditions
  //   .map((c) => c.text)
  //   .join(rightCombineLogic === "OR" ? " | " : " + ");

  // Use deep hierarchy search functionality with maxHierarchyDepth
  const results = await searchBlocksWithHierarchicalConditions(
    leftConditions,
    leftCombineLogic,
    [
      {
        direction: "descendants" as const,
        levels: options.maxHierarchyDepth, // Use max depth for deep search
        conditions: rightConditions.map((cond) => ({
          type: cond.type as any,
          text: cond.text,
          matchType: cond.matchType as any,
          weight: cond.weight || 1,
          negate: cond.negate || false,
        })),
      },
    ],
    rightCombineLogic,
    options,
    state
  );

  if (results.length > 0) {
    updateAgentToaster(
      `🌳 Ancestor→descendant search (depth ${options.maxHierarchyDepth}): ${results.length} hierarchy relationships found`
    );
  }
  return [results]; // Return as array of result sets
};

/**
 * Execute flexible hierarchy search: A => B (same block OR A parent of B)
 * Implements same-block priority to prevent duplication
 */
const executeFlexibleHierarchySearch = async (
  leftConditions: SearchCondition[],
  rightConditions: SearchCondition[],
  leftCombineLogic: "AND" | "OR",
  rightCombineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  console.log(
    `🔀 Executing flexible hierarchy search with same-block priority`
  );

  // Show search terms (will get counts from searches that already happen)
  const leftTermText = leftConditions
    .map((c) => c.text)
    .join(leftCombineLogic === "OR" ? " | " : " + ");
  const rightTermText = rightConditions
    .map((c) => c.text)
    .join(rightCombineLogic === "OR" ? " | " : " + ");

  const allResults = new Map<string, any>(); // uid -> result object

  // Step 1: Same block search (highest priority) - A AND B in same block
  console.log(`📝 Step 1: Same-block search (A + B)`);
  const sameBlockConditions = [...leftConditions, ...rightConditions];
  const sameBlockSearch = await executeContentSearch(
    sameBlockConditions,
    "AND", // For flexible hierarchy, both terms must appear
    options,
    state
  );
  const sameBlockResults = sameBlockSearch.results;

  sameBlockResults.forEach((result) => {
    allResults.set(result.uid, result);
    console.log(`✅ Same-block priority: ${result.uid}`);
  });

  console.log(
    `📊 Same-block strategy found: ${sameBlockResults.length} results`
  );

  // Step 2: Hierarchy search (A > B) - only add if not already covered
  // For flexible hierarchy (=>), only search 1 level deep (direct children)
  console.log(`🏗️ Step 2: Direct hierarchy search (A > B, depth=1)`);
  const hierarchyResults = await searchBlocksWithHierarchicalConditions(
    leftConditions,
    leftCombineLogic,
    [
      {
        direction: "descendants" as const,
        levels: 1, // Only direct children for => operator
        conditions: rightConditions.map((cond) => ({
          type: cond.type as any,
          text: cond.text,
          matchType: cond.matchType as any,
          weight: cond.weight || 1,
          negate: cond.negate || false,
        })),
      },
    ],
    rightCombineLogic,
    options,
    state
  );

  let hierarchyAdded = 0;
  let hierarchySkipped = 0;

  hierarchyResults.forEach((result) => {
    if (!allResults.has(result.uid)) {
      allResults.set(result.uid, result);
      hierarchyAdded++;
      console.log(`➕ Added hierarchy result: ${result.uid}`);
    } else {
      hierarchySkipped++;
      console.log(
        `⏭️ Skipped hierarchy result ${result.uid} (already covered by same-block)`
      );
    }
  });

  console.log(
    `📊 Hierarchy strategy processed: ${hierarchyResults.length} results, ${hierarchyAdded} added, ${hierarchySkipped} skipped`
  );

  const finalResults = Array.from(allResults.values());
  console.log(
    `✅ Final flexible hierarchy results: ${finalResults.length} unique blocks (${sameBlockResults.length} same-block + ${hierarchyAdded} hierarchy)`
  );

  // Show counts from already-executed searches (no extra queries)
  const leftCount = globalThis.hierarchyCounts?.[leftTermText] || "?";
  const rightCount = globalThis.hierarchyCounts?.[rightTermText] || "?";

  if (leftCount !== "?" && rightCount !== "?") {
    updateAgentToaster(
      `🔍 Found ${leftCount} blocks with '${leftTermText}', ${rightCount} with '${rightTermText}'`
    );
  }

  updateAgentToaster(
    `🔀 Flexible search: ${hierarchyResults.length} hierarchy relationships found → ${finalResults.length} total results`
  );

  return [finalResults]; // Return as single result set (already deduplicated)
};

/**
 * Execute bidirectional search: A <=> B (A parent of B OR B parent of A)
 * Implements parent-priority deduplication to prevent duplicate relationships
 */
const executeBidirectionalSearch = async (
  leftConditions: SearchCondition[],
  rightConditions: SearchCondition[],
  leftCombineLogic: "AND" | "OR",
  rightCombineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  console.log(
    `↔️ Executing bidirectional search with parent-priority deduplication`
  );

  const allResults = new Map<string, any>(); // uid -> result object
  const parentList = new Set<string>(); // UIDs of A-containing blocks
  const child1List = new Set<string>(); // UIDs of B-containing blocks (children of parentList)

  // Step 1: Same-block results (highest priority) - A + B in same block
  console.log(`📝 Step 1: Same-block search (A + B)`);
  const sameBlockConditions = [...leftConditions, ...rightConditions];
  const sameBlockSearch = await executeContentSearch(
    sameBlockConditions,
    "AND", // Both A and B must be in same block
    options,
    state
  );
  const sameBlockResults = sameBlockSearch.results;

  sameBlockResults.forEach((result) => {
    allResults.set(result.uid, result);
    console.log(`✅ Same-block priority: ${result.uid}`);
  });

  console.log(
    `📊 Same-block strategy found: ${sameBlockResults.length} results`
  );

  // Show search terms and get real counts from individual searches
  const leftTermText = leftConditions
    .map((c) => c.text)
    .join(leftCombineLogic === "OR" ? " | " : " + ");
  const rightTermText = rightConditions
    .map((c) => c.text)
    .join(rightCombineLogic === "OR" ? " | " : " + ");

  // Get real individual counts in parallel
  const [leftSearch, rightSearch] = await Promise.all([
    executeContentSearch(leftConditions, leftCombineLogic, options, state),
    executeContentSearch(rightConditions, rightCombineLogic, options, state),
  ]);

  updateAgentToaster(
    `🔍 Found ${leftSearch.totalFound} blocks with '${leftTermText}', ${rightSearch.totalFound} with '${rightTermText}' - analyzing hierarchy...`
  );

  // Step 2: Forward hierarchy (A > B) - A parent, B child
  console.log(`➡️ Step 2: Forward hierarchy search (A > B)`);
  const forwardResults = await searchBlocksWithHierarchicalConditions(
    leftConditions,
    leftCombineLogic,
    [
      {
        direction: "descendants" as const,
        levels: 1, // Direct children for bidirectional
        conditions: rightConditions.map((cond) => ({
          type: cond.type as any,
          text: cond.text,
          matchType: cond.matchType as any,
          weight: cond.weight || 1,
          negate: cond.negate || false,
        })),
      },
    ],
    rightCombineLogic,
    options,
    state
  );

  forwardResults.forEach((result) => {
    if (!allResults.has(result.uid)) {
      allResults.set(result.uid, result);
      parentList.add(result.uid);

      // Track child UIDs containing B
      const matchingChildUids = extractChildUids(
        result,
        rightConditions,
        rightCombineLogic
      );
      matchingChildUids.forEach((childUid) => child1List.add(childUid));

      console.log(
        `⬆️ Forward: Parent ${
          result.uid
        }, children B: [${matchingChildUids.join(", ")}]`
      );
    }
  });

  console.log(
    `📊 Forward hierarchy found: ${forwardResults.length} results (parentList: ${parentList.size}, child1List: ${child1List.size})`
  );

  // Step 3: Reverse hierarchy (B > A) with smart filtering
  console.log(`⬅️ Step 3: Reverse hierarchy search (B > A) with filtering`);
  const reverseResults = await searchBlocksWithHierarchicalConditions(
    rightConditions,
    rightCombineLogic,
    [
      {
        direction: "descendants" as const,
        levels: 1, // Direct children for bidirectional
        conditions: leftConditions.map((cond) => ({
          type: cond.type as any,
          text: cond.text,
          matchType: cond.matchType as any,
          weight: cond.weight || 1,
          negate: cond.negate || false,
        })),
      },
    ],
    leftCombineLogic,
    options,
    state
  );

  let replacements = 0;
  let skipped = 0;

  reverseResults.forEach((bBlock) => {
    // Skip if this B-block is already in child1List (already covered by forward search)
    if (child1List.has(bBlock.uid)) {
      console.log(`⏭️ Skipping B-block ${bBlock.uid} (already in child1List)`);
      skipped++;
      return;
    }

    // Check if any children of this B-block are in parentList
    const matchingChildUids = extractChildUids(
      bBlock,
      leftConditions,
      leftCombineLogic
    );
    let foundReplacement = false;

    matchingChildUids.forEach((aChildUid) => {
      if (parentList.has(aChildUid)) {
        // Replace parent with this B-block (parent priority: B-block is higher up)
        allResults.delete(aChildUid);
        parentList.delete(aChildUid);
        allResults.set(bBlock.uid, bBlock);
        console.log(
          `🔄 Replaced A-parent ${aChildUid} with B-parent ${bBlock.uid}`
        );
        replacements++;
        foundReplacement = true;
      }
    });

    // If no replacement was made but this is a valid B-block result, add it
    if (!foundReplacement && !allResults.has(bBlock.uid)) {
      allResults.set(bBlock.uid, bBlock);
      console.log(`➕ Added new B-block ${bBlock.uid} (no conflicts)`);
    }
  });

  console.log(
    `📊 Reverse hierarchy processed: ${reverseResults.length} results, ${replacements} replacements, ${skipped} skipped`
  );

  const finalResults = Array.from(allResults.values());
  console.log(
    `✅ Final bidirectional results: ${finalResults.length} unique blocks (${
      sameBlockResults.length
    } same-block + ${finalResults.length - sameBlockResults.length} hierarchy)`
  );

  // Show concise hierarchy summary
  const totalHierarchyMatches = forwardResults.length + reverseResults.length;

  if (totalHierarchyMatches > 0) {
    updateAgentToaster(
      `↔️ Bidirectional search: ${totalHierarchyMatches} hierarchy relationships found → ${finalResults.length} total results`
    );
  }

  return [finalResults]; // Return as single result set (already deduplicated)
};

/**
 * Execute deep bidirectional search: A <<=>> B (A ancestor/descendant of B, any depth)
 * Uses similar parent-priority deduplication logic as regular bidirectional search
 */
const executeDeepBidirectionalSearch = async (
  leftConditions: SearchCondition[],
  rightConditions: SearchCondition[],
  leftCombineLogic: "AND" | "OR",
  rightCombineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  console.log(
    `🌊 Executing deep bidirectional search with parent-priority deduplication`
  );

  // Show search terms and get real counts from individual searches
  const leftTermText = leftConditions
    .map((c) => c.text)
    .join(leftCombineLogic === "OR" ? " | " : " + ");
  const rightTermText = rightConditions
    .map((c) => c.text)
    .join(rightCombineLogic === "OR" ? " | " : " + ");

  // Get real individual counts in parallel (these searches will be needed anyway)
  const [leftSearch, rightSearch] = await Promise.all([
    executeContentSearch(leftConditions, leftCombineLogic, options, state),
    executeContentSearch(rightConditions, rightCombineLogic, options, state),
  ]);

  updateAgentToaster(
    `🔍 Found ${leftSearch.totalFound} blocks with '${leftTermText}', ${rightSearch.totalFound} with '${rightTermText}' - analyzing hierarchy...`
  );

  const allResults = new Map<string, any>(); // uid -> result object
  const ancestorList = new Set<string>(); // UIDs of A-containing blocks (ancestors)
  const descendantList = new Set<string>(); // UIDs of B-containing blocks (descendants)

  // Step 1: Same-block results (highest priority)
  console.log(`📝 Step 1: Same-block search (A + B)`);
  const sameBlockConditions = [...leftConditions, ...rightConditions];
  const sameBlockSearch = await executeContentSearch(
    sameBlockConditions,
    "AND",
    options,
    state
  );
  const sameBlockResults = sameBlockSearch.results;

  sameBlockResults.forEach((result) => {
    allResults.set(result.uid, result);
    console.log(`✅ Same-block priority: ${result.uid}`);
  });

  console.log(
    `📊 Same-block strategy found: ${sameBlockResults.length} results`
  );

  // Step 2: Deep forward (A ancestor of B) - A parent, B descendant
  console.log(`🔽 Step 2: Deep forward search (A >> B)`);
  const forwardResults = await searchBlocksWithHierarchicalConditions(
    leftConditions,
    leftCombineLogic,
    [
      {
        direction: "descendants" as const,
        levels: options.maxHierarchyDepth, // Use max depth
        conditions: rightConditions.map((cond) => ({
          type: cond.type as any,
          text: cond.text,
          matchType: cond.matchType as any,
          weight: cond.weight || 1,
          negate: cond.negate || false,
        })),
      },
    ],
    rightCombineLogic,
    options,
    state
  );

  forwardResults.forEach((result) => {
    if (!allResults.has(result.uid)) {
      allResults.set(result.uid, result);
      ancestorList.add(result.uid);

      // Track descendant UIDs containing B (recursive through all levels)
      const matchingDescendantUids = extractChildUids(
        result,
        rightConditions,
        rightCombineLogic
      );
      matchingDescendantUids.forEach((descendantUid) =>
        descendantList.add(descendantUid)
      );

      console.log(
        `⬇️ Forward: Ancestor ${
          result.uid
        }, descendants B: [${matchingDescendantUids.join(", ")}]`
      );
    }
  });

  console.log(
    `📊 Deep forward found: ${forwardResults.length} results (ancestorList: ${ancestorList.size}, descendantList: ${descendantList.size})`
  );

  // Step 3: Deep reverse (B ancestor of A) with smart filtering
  console.log(`🔼 Step 3: Deep reverse search (B >> A) with filtering`);
  const reverseResults = await searchBlocksWithHierarchicalConditions(
    rightConditions,
    rightCombineLogic,
    [
      {
        direction: "descendants" as const,
        levels: options.maxHierarchyDepth, // Use max depth
        conditions: leftConditions.map((cond) => ({
          type: cond.type as any,
          text: cond.text,
          matchType: cond.matchType as any,
          weight: cond.weight || 1,
          negate: cond.negate || false,
        })),
      },
    ],
    leftCombineLogic,
    options,
    state
  );

  let replacements = 0;
  let skipped = 0;

  reverseResults.forEach((bAncestor) => {
    // Skip if this B-block is already in descendantList
    if (descendantList.has(bAncestor.uid)) {
      console.log(
        `⏭️ Skipping B-ancestor ${bAncestor.uid} (already in descendantList)`
      );
      skipped++;
      return;
    }

    // Check if any descendants of this B-ancestor are in ancestorList
    const matchingDescendantUids = extractChildUids(
      bAncestor,
      leftConditions,
      leftCombineLogic
    );
    let foundReplacement = false;

    matchingDescendantUids.forEach((aDescendantUid) => {
      if (ancestorList.has(aDescendantUid)) {
        // Replace ancestor with this B-ancestor (higher up in hierarchy)
        allResults.delete(aDescendantUid);
        ancestorList.delete(aDescendantUid);
        allResults.set(bAncestor.uid, bAncestor);
        console.log(
          `🔄 Replaced A-ancestor ${aDescendantUid} with B-ancestor ${bAncestor.uid}`
        );
        replacements++;
        foundReplacement = true;
      }
    });

    // If no replacement but valid result, add it
    if (!foundReplacement && !allResults.has(bAncestor.uid)) {
      allResults.set(bAncestor.uid, bAncestor);
      console.log(`➕ Added new B-ancestor ${bAncestor.uid} (no conflicts)`);
    }
  });

  console.log(
    `📊 Deep reverse processed: ${reverseResults.length} results, ${replacements} replacements, ${skipped} skipped`
  );

  const finalResults = Array.from(allResults.values());
  console.log(
    `✅ Final deep bidirectional results: ${finalResults.length} unique blocks`
  );

  // Show concise hierarchy summary with batch processing info
  const totalHierarchyMatches = forwardResults.length + reverseResults.length;
  const maxDepth = options.maxHierarchyDepth;
  const parentsAnalyzed = leftSearch.totalFound; // Real count of parent blocks analyzed

  if (totalHierarchyMatches > 0) {
    updateAgentToaster(
      `🌊 Processed ${parentsAnalyzed} parent blocks (depth ${maxDepth}): ${totalHierarchyMatches} hierarchy connections → ${finalResults.length} results`
    );
  } else if (parentsAnalyzed > 0) {
    updateAgentToaster(
      `🌊 Processed ${parentsAnalyzed} parent blocks (depth ${maxDepth}): no hierarchy connections found`
    );
  }

  return [finalResults]; // Return as single result set (already deduplicated)
};

/**
 * Execute direct hierarchy search with single content-filtered Datomic query
 * This replaces the inefficient JavaScript post-processing approach
 */
const executeDirectHierarchySearch = async (
  parentConditions: SearchCondition[],
  parentCombineLogic: "AND" | "OR",
  childConditions: SearchCondition[],
  childCombineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  // Apply semantic expansion if requested and at appropriate level
  const shouldExpand =
    parentConditions.some((c) => c.semanticExpansion) ||
    childConditions.some((c) => c.semanticExpansion);
  const expandedParentConditions = shouldExpand
    ? await expandConditions(
        parentConditions,
        state
      )
    : parentConditions;
  const expandedChildConditions = shouldExpand
    ? await expandConditions(childConditions, state)
    : childConditions;

  // Build single Datomic query with parent and child content filtering
  let query = `[:find ?parent-uid ?parent-content ?parent-page-title ?parent-page-uid 
                       ?child-uid ?child-content ?child-page-title ?child-page-uid
                :where
                ;; Parent block structure
                [?parent :block/uid ?parent-uid]
                [?parent :block/string ?parent-content]
                [?parent :block/page ?parent-page]
                [?parent-page :node/title ?parent-page-title]
                [?parent-page :block/uid ?parent-page-uid]
                
                ;; Child block structure  
                [?child :block/uid ?child-uid]
                [?child :block/string ?child-content]
                [?child :block/page ?child-page]
                [?child-page :node/title ?child-page-title]
                [?child-page :block/uid ?child-page-uid]
                
                ;; Hierarchy relationship (parent -> child)
                [?parent :block/children ?child]`;

  // Add parent content filtering with custom block variable
  const parentClauses = buildHierarchyConditionClauses(
    expandedParentConditions,
    parentCombineLogic,
    "?parent",
    "?parent-content",
    0
  );
  query += parentClauses;

  // Add child content filtering with custom block variable
  const childClauses = buildHierarchyConditionClauses(
    expandedChildConditions,
    childCombineLogic,
    "?child",
    "?child-content",
    expandedParentConditions.length
  );
  query += childClauses;

  // Add exclusion logic for user query block
  if (options.excludeBlockUid) {
    query += `\n                ;; Exclude user query block from both parent and child results
                [(not= ?parent-uid "${options.excludeBlockUid}")]
                [(not= ?child-uid "${options.excludeBlockUid}")]`;
  }

  query += `]`;

  const hierarchyResults = await executeDatomicQuery(query);

  // Transform results to expected format (return parent blocks with child info)
  const parentBlocks = hierarchyResults.map(
    ([
      parentUid,
      parentContent,
      parentPageTitle,
      parentPageUid,
      childUid,
      childContent,
      childPageTitle,
      childPageUid,
    ]) => ({
      uid: parentUid,
      content: parentContent,
      pageTitle: parentPageTitle,
      pageUid: parentPageUid,
      created: new Date(), // We don't get timestamps from this query, use current time
      modified: new Date(),
      isDaily: false, // TODO: Could be enhanced to check DNP pattern
      children: [],
      parents: [],
      isPage: false,
      // Add hierarchy context
      childUid,
      childContent,
      childPageTitle,
      childPageUid,
      hierarchyRelationship: "direct_parent",
    })
  );

  // Apply hierarchy enrichment if requested
  // Note: Direct hierarchy search already provides the direct parent-child relationship,
  // so additional enrichment may not be necessary for most use cases
  if (
    (options.includeChildren === true && options.childDepth > 1) ||
    (options.includeParents === true && options.parentDepth > 1)
  ) {
    try {
      // Convert to format expected by enrichWithFullHierarchy (array format)
      const arrayFormat = parentBlocks.map((block) => [
        block.uid,
        block.content,
        block.pageTitle,
        block.pageUid,
      ]);
      const enrichedResults = await enrichWithFullHierarchy(
        arrayFormat,
        options.includeChildren === true,
        options.childDepth || 3,
        options.includeParents === true,
        options.parentDepth || 2
      );
      return enrichedResults;
    } catch (error) {
      return parentBlocks;
    }
  }

  return parentBlocks;
};

/**
 * Search blocks with hierarchical conditions (reuse existing logic)
 */
const searchBlocksWithHierarchicalConditions = async (
  contentConditions: SearchCondition[],
  combineConditions: "AND" | "OR",
  hierarchyConditions: any[],
  combineHierarchy: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  // Reuse the existing findBlocksWithHierarchyImpl logic
  const input = {
    contentConditions: contentConditions.map((cond) => ({
      type: cond.type as any,
      text: cond.text,
      matchType: cond.matchType as any,
      semanticExpansion: cond.semanticExpansion,
      weight: cond.weight || 1,
      negate: cond.negate || false,
    })),
    hierarchyConditions,
    combineConditions,
    combineHierarchy,
    expansionStrategy: options.expansionStrategy || "related_concepts",
    includeChildren: options.includeChildren === true,
    childDepth: options.childDepth || 3,
    includeParents: options.includeParents === true,
    parentDepth: options.parentDepth || 2,
    includeDaily: options.includeDaily,
    dateRange: options.dateRange,
    sortBy: options.sortBy,
    limit: options.limit,
    secureMode: options.secureMode,
    fromResultId: options.fromResultId,
    limitToBlockUids: options.limitToBlockUids,
    limitToPageUids: options.limitToPageUids,
    excludeBlockUid: options.excludeBlockUid,
  };

  // Extract UIDs for this call
  const { blockUids: finalBlockUids, pageUids: finalPageUids } =
    extractUidsFromResults(
      input.fromResultId,
      input.limitToBlockUids,
      input.limitToPageUids,
      state
    );

  // Call the original implementation logic
  const expandedContentConditions = await expandConditions(
    input.contentConditions
  );

  const contentMatches = await searchBlocksWithConditions(
    expandedContentConditions,
    input.combineConditions,
    input.includeDaily,
    finalBlockUids.length > 0 ? finalBlockUids : undefined,
    finalPageUids.length > 0 ? finalPageUids : undefined
  );

  let hierarchyFilteredBlocks = contentMatches;
  if (input.hierarchyConditions?.length > 0) {
    hierarchyFilteredBlocks = await applyHierarchyFilters(
      contentMatches,
      input.hierarchyConditions,
      input.combineHierarchy
    );
  }

  const enrichedResults = await enrichWithFullHierarchy(
    hierarchyFilteredBlocks,
    input.includeChildren,
    input.childDepth,
    input.includeParents,
    input.parentDepth,
    input.secureMode
  );

  // Apply date range filtering
  let filteredResults = enrichedResults;
  if (
    input.dateRange &&
    (input.dateRange.start || input.dateRange.end)
  ) {
    const parsedDateRange = {
      start:
        typeof input.dateRange.start === "string"
          ? new Date(input.dateRange.start)
          : input.dateRange.start,
      end:
        typeof input.dateRange.end === "string"
          ? new Date(input.dateRange.end)
          : input.dateRange.end,
    };
    const filterMode = input.dateRange.filterMode || "modified";
    filteredResults = filterByDateRange(enrichedResults, parsedDateRange, filterMode);
  }

  // Sort and limit results
  filteredResults = sortHierarchyResults(
    filteredResults,
    input.sortBy,
    input.contentConditions
  );

  if (filteredResults.length > input.limit) {
    filteredResults = filteredResults.slice(0, input.limit);
  }

  return filteredResults;
};

/**
 * Execute combineResults tool internally
 */
const executeCombineResults = async (
  resultSets: any[],
  operation: "union" | "intersection"
): Promise<any[]> => {
  if (resultSets.length === 0) {
    return [];
  }

  if (resultSets.length === 1) {
    return resultSets[0];
  }

  console.log(
    `🔗 Combining ${resultSets.length} result sets with ${operation} operation`
  );

  try {
    // Prepare result sets for combineResults tool
    const combineInput = {
      resultSets: resultSets.map((results, index) => ({
        name: `strategy_${index + 1}`,
        uids: results
          .map((result: any) => result.uid)
          .filter((uid: string) => uid),
        type: "blocks" as const,
      })),
      operation: operation,
    };

    const result = await combineResultsTool.invoke(combineInput, {
      runName: "internal_call",
    });
    const parsedResult =
      typeof result === "string" ? JSON.parse(result) : result;

    if (parsedResult.success && parsedResult.data) {
      const combinedUids = parsedResult.data.uids || [];
      console.log(`✅ Combined results: ${combinedUids.length} unique UIDs`);

      // Map UIDs back to full result objects
      const uidToResult = new Map<string, any>();
      for (const resultSet of resultSets) {
        for (const result of resultSet) {
          if (result.uid) {
            uidToResult.set(result.uid, result);
          }
        }
      }

      return combinedUids
        .map((uid: string) => uidToResult.get(uid))
        .filter(Boolean);
    } else {
      console.warn(`⚠️ Combine results failed:`, parsedResult.error);
      return [];
    }
  } catch (error) {
    console.error(`❌ Error in combine results:`, error);
    // Fallback: simple deduplication union
    const allResults = resultSets.flat();
    return deduplicateResultsByUid(allResults, "hierarchical_fallback");
  }
};

/**
 * Apply final processing (sorting, limiting) to combined results
 */
const applyFinalProcessing = (results: any[], options: any): any[] => {
  if (!results || results.length === 0) {
    return [];
  }

  console.log(`🎯 Applying final processing to ${results.length} results`);

  // Sort results
  let sortedResults = sortHierarchyResults(results, options.sortBy, []);

  // Apply final limit
  if (sortedResults.length > options.limit) {
    sortedResults = sortedResults.slice(0, options.limit);
    console.log(`✂️ Limited results to ${options.limit}`);
  }

  return sortedResults;
};

/**
 * Helper functions for parent-priority deduplication
 */

/**
 * Check if a block contains conditions (matches search terms)
 */
const containsConditions = (
  block: any,
  conditions: SearchCondition[],
  combineLogic: "AND" | "OR" = "AND"
): boolean => {
  if (!block || !block.content) return false;

  const content = block.content.toLowerCase();

  // Use appropriate logic based on combineLogic parameter
  const checkFunction =
    combineLogic === "OR" ? conditions.some : conditions.every;

  return checkFunction.call(conditions, (condition: SearchCondition) => {
    const searchTerm = condition.text.toLowerCase();

    switch (condition.type) {
      case "text":
        if (condition.matchType === "exact") {
          return content === searchTerm;
        } else if (condition.matchType === "regex") {
          try {
            const regex = new RegExp(condition.text, "i");
            return regex.test(content);
          } catch {
            return false;
          }
        } else {
          // Contains match
          const matches = content.includes(searchTerm);
          return condition.negate ? !matches : matches;
        }

      case "page_ref":
        const pageRefPattern = new RegExp(
          `\\[\\[${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]`,
          "i"
        );
        const pageMatches = pageRefPattern.test(content);
        return condition.negate ? !pageMatches : pageMatches;

      case "block_ref":
        const blockRefPattern = new RegExp(
          `\\(\\(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)\\)`,
          "i"
        );
        const blockMatches = blockRefPattern.test(content);
        return condition.negate ? !blockMatches : blockMatches;

      default:
        return false;
    }
  });
};

/**
 * Extract child UIDs from a parent result that match given conditions
 */
const extractChildUids = (
  parentResult: any,
  conditions: SearchCondition[],
  combineLogic: "AND" | "OR" = "AND"
): string[] => {
  if (!parentResult.children || parentResult.children.length === 0) {
    return [];
  }

  const matchingChildUids: string[] = [];

  const checkChildRecursively = (children: any[]) => {
    for (const child of children) {
      if (containsConditions(child, conditions, combineLogic)) {
        matchingChildUids.push(child.uid);
      }

      // Check nested children if they exist
      if (child.children && child.children.length > 0) {
        checkChildRecursively(child.children);
      }
    }
  };

  checkChildRecursively(parentResult.children);
  return matchingChildUids;
};

// /**
//  * Build parent-child relationship mapping from results
//  */
// const buildParentChildMapping = (results: any[]): Map<string, string[]> => {
//   const parentToChildren = new Map<string, string[]>();
//
//   for (const result of results) {
//     if (result.children && result.children.length > 0) {
//       const childUids: string[] = [];
//
//       const collectChildUids = (children: any[]) => {
//         for (const child of children) {
//           childUids.push(child.uid);
//           if (child.children && child.children.length > 0) {
//             collectChildUids(child.children);
//           }
//         }
//       };
//
//       collectChildUids(result.children);
//       parentToChildren.set(result.uid, childUids);
//     }
//   }
//
//   return parentToChildren;
// };

/**
 * Create regex pattern for page references that matches Roam syntax but not plain text
 * Supports: [[title]], #title, title:: but NOT plain "title"
 */
// const createPageRefRegexPattern = (pageTitle: string): string => {
//   // Escape special regex characters in the page title
//   const escapedTitle = pageTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

//   // Optimized pattern: [[title]], #title, or title::
//   return `(?:\\[\\[${escapedTitle}\\]\\]|#${escapedTitle}(?!\\w)|${escapedTitle}::)`;
// };

// /**
//  * Create optimized regex pattern for multiple page reference variations
//  * Creates a single efficient OR pattern instead of multiple separate patterns
//  */
// const createMultiPageRefRegexPattern = (pageNames: string[]): string => {
//   if (pageNames.length === 0) return "";
//   if (pageNames.length === 1) return createPageRefRegexPattern(pageNames[0]);
//
//   // Escape and prepare all page names
//   const escapedNames = pageNames.map((name) =>
//     name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
//   );
//
//   // Create alternation of just the terms
//   const termAlternation = escapedNames.join("|");
//
//   // Single optimized pattern: factors out common Roam syntax structures
//   return `(?:\\[\\[(?:${termAlternation})\\]\\]|#(?:${termAlternation})(?!\\w)|(?:${termAlternation})::)`;
// };

/**
 * Check for existing similar pages using findPagesByTitleTool
 * Returns existing page titles that match the search pattern
 */
// const findExistingSimilarPages = async (
//   pageTitle: string
// ): Promise<string[]> => {
//   try {
//     // Use more precise patterns to avoid overly broad matches
//     const patterns = [
//       `^${pageTitle}$`, // Exact match (case-insensitive handled by tool)
//       `^${pageTitle}\\W.*`, // Word boundary: "pend " or "pend-" etc.
//       `^${pageTitle}[A-Z].*`, // CamelCase: "pendingSomething"
//       `.*\\W${pageTitle}$`, // End with word: "something-pend"
//       `.*\\W${pageTitle}\\W.*`, // Word in middle: "my-pend-list"
//     ];

//     console.log(
//       `🔍 Checking for existing pages similar to "${pageTitle}" with refined patterns`
//     );

//     const allFoundPages = [];

//     // Try each pattern to get comprehensive but precise results
//     for (const pattern of patterns) {
//       try {
//         const result = await findPagesByTitleTool.invoke({
//           conditions: [
//             {
//               text: pattern,
//               matchType: "regex" as const,
//               negate: false,
//             },
//           ],
//           combineConditions: "AND" as const,
//           includeDaily: false,
//           limit: 5, // Smaller limit per pattern
//         });

//         const parsedResult =
//           typeof result === "string" ? JSON.parse(result) : result;
//         const existingPages = parsedResult.success
//           ? parsedResult.data || []
//           : [];

//         const pageNames = existingPages
//           .map((page: any) => page.title || page.name || page)
//           .filter((name: any) => typeof name === "string");

//         allFoundPages.push(...pageNames);
//       } catch (patternError) {
//         console.warn(`Pattern ${pattern} failed:`, patternError);
//       }
//     }

//     // Remove duplicates and filter with LLM relevance check
//     const uniquePages = [...new Set(allFoundPages)];
//     console.log(`📋 Found ${uniquePages.length} candidate pages:`, uniquePages);

//     if (uniquePages.length > 1) {
//       // Use LLM to filter relevant pages
//       const relevantPages = await filterRelevantPages(pageTitle, uniquePages);
//       console.log(
//         `🎯 Filtered to ${relevantPages.length} relevant pages:`,
//         relevantPages
//       );
//       return relevantPages;
//     }

//     return uniquePages;
//   } catch (error) {
//     console.warn(`Failed to find existing pages for "${pageTitle}":`, error);
//     return [];
//   }
// };

/**
 * Use LLM to filter pages that are actually relevant to the search term
 */
// const filterRelevantPages = async (
//   searchTerm: string,
//   candidatePages: string[]
// ): Promise<string[]> => {
//   try {
//     const prompt = `Given the search term "${searchTerm}", which of these page titles are semantically related and would be relevant for a search?
//
// Page titles: ${candidatePages.join(", ")}
//
// Return only the relevant page titles, one per line. Consider:
// - Semantic similarity (not just string matching)
// - Whether the page would contain content related to "${searchTerm}"
// - Exclude pages that just happen to contain the letters but are unrelated concepts
//
// For example:
// - "pending" is relevant to "pend" (related concept)
// - "testNotPending" is NOT relevant to "pend" (contains letters but opposite meaning)
// - "expenditure" is NOT relevant to "pend" (contains letters but unrelated concept)`;
//
//     const llm = await import("../../langraphModelsLoader").then(
//       (m) => m.modelViaLanggraph
//     );
//     const modelInfo = await import("../../../..").then((m) => m.defaultModel);
//     const HumanMessage = await import("@langchain/core/messages").then(
//       (m) => m.HumanMessage
//     );
//
//     const model = llm(modelInfo, { input_tokens: 0, output_tokens: 0 }, false);
//
//     const response = await model.invoke([new HumanMessage(prompt)]);
//     const relevantPages = response.content
//       .toString()
//       .split("\n")
//       .map((line: string) => line.trim())
//       .filter((line: string) => line.length > 0 && candidatePages.includes(line));
//
//     return relevantPages.length > 0 ? relevantPages : [searchTerm]; // Fallback to original term
//   } catch (error) {
//     console.warn(`LLM relevance filtering failed for "${searchTerm}":`, error);
//     return candidatePages; // Fallback to all candidates
//   }
// };

/**
 * Expand content conditions with semantic terms
 * Only expands when explicitly requested (expansion level 2+)
 */
const expandConditions = async (
  conditions: any[],
  state?: any
): Promise<any[]> => {
  const expandedConditions = [];
  const expansionLevel = state?.expansionLevel || 0;

  console.log(`🔍 [DEBUG] expandConditions called with:`, {
    expansionLevel,
    conditionsCount: conditions.length,
    conditionsWithSemantic: conditions.filter(
      (c) => c.semanticExpansion === true
    ).length,
    conditions: conditions.map((c) => ({
      type: c.type,
      text: c.text,
      semanticExpansion: c.semanticExpansion,
    })),
  });

  // Check if any conditions request semantic expansion
  const hasSemanticRequest = conditions.some(
    (c) => c.semanticExpansion === true
  );

  // Only apply semantic expansion if:
  // 1. Conditions explicitly request it, OR
  // 2. We're at expansion level 2+ (automatic expansion)
  if (expansionLevel < 2 && !hasSemanticRequest) {
    console.log(
      `⏭️ Skipping semantic expansion (level ${expansionLevel} < 2, no explicit request)`
    );
    return conditions; // Return original conditions, not empty array
  }

  if (hasSemanticRequest && expansionLevel < 2) {
    console.log(
      `🧠 Applying user-requested semantic expansion at level ${expansionLevel}`
    );
  } else {
    console.log(
      `🧠 Applying automatic semantic expansion at level ${expansionLevel}`
    );
  }

  // Group conditions that need expansion to avoid duplicate toaster messages
  const conditionsToExpand = conditions.filter(
    (c) =>
      (c.semanticExpansion && c.type === "text") ||
      (c.type === "page_ref" && c.semanticExpansion)
  );

  if (conditionsToExpand.length > 0) {
    updateAgentToaster(`🔍 Expanding search with related terms...`);
  }

  for (const condition of conditions) {
    let conditionWasExpanded = false;

    // Handle text conditions with semantic expansion
    if (condition.semanticExpansion && condition.type === "text") {
      try {
        const expansionTerms = await generateSemanticExpansions(
          condition.text,
          condition.semanticExpansion, // Use strategy directly from condition
          state?.userQuery, // Pass original query for better context
          state?.modelInfo, // Pass model from execution context
          state?.language, // Pass user language for language-aware expansion
          undefined // No custom strategy here - would come from state.expansionGuidance if needed
        );

        if (expansionTerms.length > 0) {
          // Add original term + expansions as separate conditions
          expandedConditions.push(condition); // Keep original
          for (const term of expansionTerms) {
            expandedConditions.push({
              ...condition,
              text: term,
              semanticExpansion: undefined,
              weight: condition.weight * 0.8,
            });
          }
          conditionWasExpanded = true;
        }
      } catch (error) {
        console.warn(`Failed to expand condition "${condition.text}":`, error);
      }
    }

    // Handle page_ref conditions with smart expansion using findPagesByTitleTool
    if (condition.type === "page_ref" && condition.semanticExpansion) {
      try {
        console.log(
          `🔗 Smart expansion for page reference "${condition.text}" using findPagesByTitleTool`
        );

        // Use the smart expansion feature of findPagesByTitleTool
        const result = await findPagesByTitleTool.invoke({
          conditions: [
            {
              text: condition.text,
              matchType: "exact",
              negate: false,
            },
          ],
          combineConditions: "OR",
          includeDaily: false,
          smartExpansion: true,
          expansionInstruction: state?.userQuery
            ? `Find pages related to "${condition.text}" in context: ${state.userQuery}`
            : undefined,
        });

        const parsedResult =
          typeof result === "string" ? JSON.parse(result) : result;
        const expandedPages = parsedResult.success
          ? parsedResult.data || []
          : [];

        if (expandedPages.length > 0) {
          const pageNames = expandedPages
            .map((page: any) => page.title)
            .filter((name: any) => typeof name === "string");

          if (pageNames.length === 1) {
            // Single page - use simple page_ref condition
            expandedConditions.push({
              type: "page_ref",
              text: pageNames[0],
              matchType: "exact",
              semanticExpansion: undefined,
              weight: condition.weight,
              negate: condition.negate || false,
            });
          } else if (pageNames.length > 1) {
            // Multiple pages - use page_ref_or condition for optimal Datomic query
            expandedConditions.push({
              type: "page_ref_or",
              text: pageNames.join("|"),
              matchType: "exact",
              semanticExpansion: undefined,
              weight: condition.weight,
              negate: condition.negate || false,
              pageNames: pageNames,
            } as any);
          }

          console.log(
            `  ✅ Smart expansion found ${
              pageNames.length
            } existing pages: ${pageNames.join(", ")}`
          );
          conditionWasExpanded = true;
        }
      } catch (error) {
        console.warn(
          `Failed to expand page_ref condition "${condition.text}":`,
          error
        );
      }
    }

    // If condition wasn't expanded, keep the original
    if (!conditionWasExpanded) {
      expandedConditions.push(condition);
    }
  }

  return expandedConditions;
};

/**
 * Search blocks with content conditions
 */
const searchBlocksWithConditions = async (
  conditions: any[],
  combineLogic: "AND" | "OR",
  includeDaily: boolean,
  limitToBlockUids?: string[],
  limitToPageUids?: string[]
): Promise<any[]> => {
  let query = `[:find ?uid ?content ?time ?page-title ?page-uid
                :where 
                [?b :block/uid ?uid]
                [?b :block/string ?content]
                [?b :block/page ?page]
                [?page :node/title ?page-title]
                [?page :block/uid ?page-uid]
                [?b :edit/time ?time]`;

  // Add UID-based filtering for optimization
  if (limitToBlockUids && limitToBlockUids.length > 0) {
    console.log(
      `⚡ Optimizing: Filtering to ${limitToBlockUids.length} specific block UIDs`
    );
    if (limitToBlockUids.length === 1) {
      query += `\n                [?b :block/uid "${limitToBlockUids[0]}"]`;
    } else {
      const uidsSet = limitToBlockUids.map((uid) => `"${uid}"`).join(" ");
      query += `\n                [(contains? #{${uidsSet}} ?uid)]`;
    }
  }

  if (limitToPageUids && limitToPageUids.length > 0) {
    console.log(
      `⚡ Optimizing: Filtering to blocks within ${limitToPageUids.length} specific page UIDs`
    );
    if (limitToPageUids.length === 1) {
      query += `\n                [?page :block/uid "${limitToPageUids[0]}"]`;
    } else {
      const uidsSet = limitToPageUids.map((uid) => `"${uid}"`).join(" ");
      query += `\n                [(contains? #{${uidsSet}} ?page-uid)]`;
    }
  }

  if (!includeDaily) {
    query += `\n                [(re-pattern "${dnpUidRegex.source.slice(
      1,
      -1
    )}") ?dnp-pattern]
                (not [(re-find ?dnp-pattern ?page-uid)])`;
  }

  // Add condition matching using shared query builder with regex optimization
  const searchConditions: SearchCondition[] = conditions.map((cond) => ({
    type: cond.type as any,
    text: cond.text,
    matchType: cond.matchType as any,
    semanticExpansion: cond.semanticExpansion,
    weight: cond.weight,
    negate: cond.negate,
  }));

  const queryBuilder = new DatomicQueryBuilder(searchConditions, combineLogic);
  const { patternDefinitions, conditionClauses } =
    queryBuilder.buildConditionClauses("?content");

  query += patternDefinitions;
  query += conditionClauses;

  query += `]`;

  const results = await executeDatomicQuery(query);
  // Format conditions display with correct logic
  const conditionsDisplay = conditions
    .map((c) => c.text)
    .join(combineLogic === "OR" ? " | " : " + ");
  console.log(
    `🔍 Search found ${results.length} blocks for conditions: ${conditionsDisplay}`
  );

  // Store count globally so flexible hierarchy search can access it
  if (!globalThis.hierarchyCounts) globalThis.hierarchyCounts = {};
  globalThis.hierarchyCounts[conditionsDisplay] = results.length;

  return results;
};

/**
 * Build condition clause for content matching
 */
// const buildConditionClause = (
//   condition: any,
//   index: number,
//   isInOr: boolean = false
// ): string => {
//   const indent = isInOr ? "                  " : "                ";
//   let clause = "";

//   switch (condition.type) {
//     case "page_ref":
//       // Use proper Roam :block/refs attribute instead of regex
//       clause = `\n${indent}[?ref-page${index} :node/title "${condition.text}"]
// ${indent}[?b :block/refs ?ref-page${index}]`;
//       break;

//     case "block_ref":
//       // Use proper Roam :block/refs attribute for block references
//       clause = `\n${indent}[?ref-block${index} :block/uid "${condition.text}"]
// ${indent}[?b :block/refs ?ref-block${index}]`;
//       break;

//     case "regex":
//       const sanitizedRegex = sanitizeRegexForDatomic(condition.text);
//       const regexWithFlags = sanitizedRegex.isCaseInsensitive
//         ? sanitizedRegex.pattern
//         : `(?i)${sanitizedRegex.pattern}`;
//       clause = `\n${indent}[(re-pattern "${regexWithFlags}") ?pattern${index}]
// ${indent}[(re-find ?pattern${index} ?content)]`;
//       break;

//     case "text":
//     default:
//       if (condition.matchType === "exact") {
//         clause = `\n${indent}[(= ?content "${condition.text}")]`;
//       } else if (condition.matchType === "regex") {
//         const sanitizedTextRegex = sanitizeRegexForDatomic(condition.text);
//         const textRegexWithFlags = sanitizedTextRegex.isCaseInsensitive
//           ? sanitizedTextRegex.pattern
//           : `(?i)${sanitizedTextRegex.pattern}`;
//         clause = `\n${indent}[(re-pattern "${textRegexWithFlags}") ?pattern${index}]
// ${indent}[(re-find ?pattern${index} ?content)]`;
//       } else {
//         // Use case-insensitive regex without problematic escape characters
//         // Remove any special regex characters to prevent escape issues
//         const cleanText = condition.text.replace(/[.*+?^${}()|[\]\\]/g, "");
//         if (cleanText === condition.text) {
//           // No special characters, can use regex safely
//           clause = `\n${indent}[(re-pattern "(?i).*${condition.text}.*") ?pattern${index}]
// ${indent}[(re-find ?pattern${index} ?content)]`;
//         } else {
//           // Has special characters, use case-sensitive includes as fallback
//           clause = `\n${indent}[(clojure.string/includes? ?content "${condition.text}")]`;
//         }
//       }
//       break;
//   }

//   if (condition.negate) {
//     clause = `\n${indent}(not ${clause.trim()})`;
//   }

//   return clause;
// };

/**
 * Apply hierarchy conditions to filter blocks
 */
const applyHierarchyFilters = async (
  blocks: any[],
  hierarchyConditions: any[],
  combineLogic: "AND" | "OR"
): Promise<any[]> => {
  // OPTIMIZATION: Batch hierarchy queries by direction and depth
  const descendantsQueries: {
    [key: string]: { uids: string[]; levels: number };
  } = {};
  const ancestorsQueries: {
    [key: string]: { uids: string[]; levels: number };
  } = {};

  // Group blocks by hierarchy condition requirements
  const blockUids = blocks.map((block) => block[0]); // Extract UIDs

  for (const hierarchyCondition of hierarchyConditions) {
    const { direction, levels } = hierarchyCondition;
    const maxLevels = levels === "all" ? 10 : levels;
    const queryKey = `${direction}_${maxLevels}`;

    if (direction === "descendants") {
      if (!descendantsQueries[queryKey]) {
        descendantsQueries[queryKey] = { uids: blockUids, levels: maxLevels };
      }
    } else {
      if (!ancestorsQueries[queryKey]) {
        ancestorsQueries[queryKey] = { uids: blockUids, levels: maxLevels };
      }
    }
  }

  // Execute batched queries
  const descendantsResults: { [queryKey: string]: { [uid: string]: any[] } } =
    {};
  const ancestorsResults: { [queryKey: string]: { [uid: string]: any[] } } = {};

  // Batch descendants queries using FLATTENED approach
  for (const [queryKey, { uids, levels }] of Object.entries(
    descendantsQueries
  )) {
    descendantsResults[queryKey] = await getFlattenedDescendants(
      uids,
      levels,
      false
    );
  }

  // Batch ancestors queries using FLATTENED approach
  for (const [queryKey, { uids, levels }] of Object.entries(ancestorsQueries)) {
    ancestorsResults[queryKey] = await getFlattenedAncestors(
      uids,
      levels,
      false
    );
  }

  // Now process blocks with pre-fetched hierarchy data
  const filteredBlocks = [];

  for (const block of blocks) {
    const [uid] = block;

    let hierarchyMatches = [];

    for (const hierarchyCondition of hierarchyConditions) {
      const { direction, levels, conditions } = hierarchyCondition;
      const maxLevels = levels === "all" ? 10 : levels;
      const queryKey = `${direction}_${maxLevels}`;

      // Get pre-fetched hierarchy blocks
      let hierarchyBlocks = [];
      if (direction === "descendants") {
        hierarchyBlocks = descendantsResults[queryKey]?.[uid] || [];
      } else {
        hierarchyBlocks = ancestorsResults[queryKey]?.[uid] || [];
      }

      // Check if hierarchy blocks match the conditions (same logic as before)

      const hierarchyMatch = hierarchyBlocks.some((hierarchyBlock) => {
        const blockContent = hierarchyBlock.content || "";
        const conditionResults = conditions.map((condition: SearchCondition) => {
          return matchesCondition(blockContent, condition);
        });
        return conditionResults.every((r: boolean) => r);
      });

      hierarchyMatches.push(hierarchyMatch);
    }

    // Apply combine logic for hierarchy conditions
    const passesHierarchyFilter =
      combineLogic === "AND"
        ? hierarchyMatches.every((match) => match)
        : hierarchyMatches.some((match) => match);

    if (passesHierarchyFilter) {
      filteredBlocks.push(block);
    }
  }

  return filteredBlocks;
};

/**
 * Check if content matches a condition
 */
const matchesCondition = (content: string, condition: any): boolean => {
  let matches = false;

  switch (condition.type) {
    case "page_ref":
      const pageRefPattern = new RegExp(
        `\\[\\[${condition.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]`,
        "i"
      );
      matches = pageRefPattern.test(content);
      break;

    case "block_ref":
      const blockRefPattern = new RegExp(
        `\\(\\(${condition.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)\\)`,
        "i"
      );
      matches = blockRefPattern.test(content);
      break;

    case "regex":
      try {
        // Use custom flags if provided, otherwise default to case-insensitive
        const flags =
          condition.regexFlags !== undefined ? condition.regexFlags : "i";
        const regex = new RegExp(condition.text, flags);
        matches = regex.test(content);
      } catch {
        matches = false;
      }
      break;

    case "text":
    default:
      if (condition.matchType === "exact") {
        matches = content === condition.text;
      } else if (condition.matchType === "regex") {
        try {
          // Use custom flags if provided, otherwise default to case-insensitive
          const flags =
            condition.regexFlags !== undefined ? condition.regexFlags : "i";
          const regex = new RegExp(condition.text, flags);
          matches = regex.test(content);
        } catch {
          matches = false;
        }
      } else {
        matches = content.toLowerCase().includes(condition.text.toLowerCase());
      }
      break;
  }

  return condition.negate ? !matches : matches;
};

/**
 * Enrich results with full hierarchical context
 */
const enrichWithFullHierarchy = async (
  results: any[],
  includeChildren: boolean,
  childDepth: number,
  includeParents: boolean,
  parentDepth: number,
  secureMode: boolean = false
): Promise<any[]> => {
  const blockUids = results.map((result) => result[0]); // Extract UIDs

  // Batch fetch all children and parents using flattened approach
  let allChildren: { [uid: string]: any[] } = {};
  let allParents: { [uid: string]: any[] } = {};

  if (includeChildren && blockUids.length > 0) {
    allChildren = await getFlattenedDescendants(
      blockUids,
      childDepth,
      secureMode
    );
  }

  if (includeParents && blockUids.length > 0) {
    allParents = await getFlattenedAncestors(
      blockUids,
      parentDepth,
      secureMode
    );
  }

  // Build enriched results using pre-fetched data
  const enrichedResults = [];

  for (const [uid, content, time, pageTitle, pageUid] of results) {
    const children = allChildren[uid] || [];
    const parents = allParents[uid] || [];

    const blockResult = {
      uid,
      content: secureMode ? undefined : content,
      created: new Date(time),
      modified: new Date(time),
      pageTitle,
      pageUid,
      isDaily: isDailyNote(pageUid),
      children,
      parents,
      hierarchyDepth:
        children.length > 0
          ? Math.max(...children.map((c) => c.level || 1))
          : 0,
      // Explicit type flag (isPage: false means it's a block)
      isPage: false,
    };

    enrichedResults.push(blockResult);
  }

  return enrichedResults;
};

/**
 * Calculate maximum depth of hierarchy
 */
const getMaxDepth = (children: any[], currentDepth: number = 0): number => {
  if (!children || children.length === 0) return currentDepth;

  let maxDepth = currentDepth;
  for (const child of children) {
    if (child.children) {
      maxDepth = Math.max(
        maxDepth,
        getMaxDepth(child.children, currentDepth + 1)
      );
    }
  }

  return maxDepth;
};

/**
 * Sort hierarchy results
 */
const sortHierarchyResults = (
  results: any[],
  sortBy: string,
  originalConditions: any[]
): any[] => {
  return results.sort((a, b) => {
    switch (sortBy) {
      case "recent":
        return b.modified.getTime() - a.modified.getTime();

      case "page_title":
        return a.pageTitle.localeCompare(b.pageTitle);

      case "hierarchy_depth":
        return b.hierarchyDepth - a.hierarchyDepth;

      case "relevance":
      default:
        const scoreA = calculateHierarchyRelevanceScore(a, originalConditions);
        const scoreB = calculateHierarchyRelevanceScore(b, originalConditions);

        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }

        return b.modified.getTime() - a.modified.getTime();
    }
  });
};

/**
 * Calculate relevance score including hierarchy context
 */
const calculateHierarchyRelevanceScore = (
  result: any,
  conditions: any[]
): number => {
  let score = 0;
  const content = (result.content || "").toLowerCase();

  // Score based on main content
  for (const condition of conditions) {
    if (condition.type === "text" && condition.text) {
      const text = condition.text.toLowerCase();
      const weight = condition.weight || 1;

      if (condition.matchType === "exact" && content === text) {
        score += 10 * weight;
      } else if (content.includes(text)) {
        const exactWordMatch = new RegExp(
          `\\b${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`
        ).test(content);
        score += exactWordMatch ? 5 * weight : 2 * weight;
      }
    }
  }

  // Bonus for hierarchy depth (more context = higher relevance)
  score += (result.hierarchyDepth || 0) * 0.5;

  // Bonus for having both children and parents
  if ((result.children || []).length > 0 && (result.parents || []).length > 0) {
    score += 1;
  }

  return score;
};

/**
 * Transform llmFacingSchema input to full internal schema with defaults
 */
const transformLlmInputToInternalSchema = (llmInput: z.infer<typeof llmFacingSchema>, state?: any): z.infer<typeof schema> => {
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
    maxHierarchyDepth: llmInput.maxDepth || 3,
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
    hierarchicalExpression: null
  };
};

export const findBlocksWithHierarchyTool = tool(
  async (input, config) => {
    const startTime = performance.now();
    
    
    // Extract state from config first
    const state = config?.configurable?.state;
    
    // Transform LLM input to internal schema format with state injection
    const internalInput = transformLlmInputToInternalSchema(input, state);
    const isPrivateMode = state?.privateMode || internalInput.secureMode;

    // Override enrichment parameters in private mode for performance and privacy
    const finalInput = isPrivateMode
      ? {
          ...internalInput,
          includeChildren: false,
          includeParents: false,
          childDepth: 1,
          parentDepth: 1,
          secureMode: true,
        }
      : internalInput;

    try {
      const results = await findBlocksWithHierarchyImpl(finalInput, state);
      return createToolResult(
        true,
        results,
        undefined,
        "findBlocksWithHierarchy",
        startTime
      );
    } catch (error) {
      console.error("FindBlocksWithHierarchy tool error:", error);
      return createToolResult(
        false,
        undefined,
        error.message,
        "findBlocksWithHierarchy",
        startTime
      );
    }
  },
  {
    name: "findBlocksWithHierarchy", 
    description:
      "Find blocks using hierarchical parent-child relationships. Use 'hierarchyCondition' with operator (>, >>, <=>, etc.) and left/right conditions. SIMPLE: Use leftConditions/rightConditions arrays for basic logic. GROUPED: Use leftConditionGroups/rightConditionGroups for complex logic like ((A|B) AND NOT C). Supports all hierarchy operators and semantic expansion.",
    schema: llmFacingSchema, // Use minimal schema for token optimization
  }
);
