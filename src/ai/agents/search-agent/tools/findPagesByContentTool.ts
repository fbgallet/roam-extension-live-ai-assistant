import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  executeDatomicQuery,
  isDailyNote,
  filterByDateRange,
  createToolResult,
  generateSemanticExpansions,
  DatomicQueryBuilder,
  SearchCondition,
  extractUidsFromResults,
  sanitizeRegexForDatomic,
  parseSemanticExpansion,
  PageWideQueryBuilder,
  processConditionGroupsForPageWide,
  parsePageSearchSyntax,
} from "../helpers/searchUtils";
import {
  baseConditionSchema,
  conditionGroupSchema,
  extendedConditionsSchema,
  processConditionGroups,
  applyORToRegexConversion,
  hasGroupedConditions,
  hasSimpleConditions,
  validateConditionInput,
  convertSimpleToGrouped,
} from "./conditionGroupsUtils";
import { dnpUidRegex } from "../../../../utils/regex.js";
import { findBlocksByContentTool } from "./findBlocksByContentTool";

/**
 * Find pages by analyzing their content blocks with aggregation and filtering
 * Security Level: Flexible (secure mode = UIDs/metadata only, content mode = includes block samples)
 *
 * This tool searches pages based on the content of their blocks, with support for
 * content aggregation, statistical analysis, and intelligent page-level filtering.
 * Use secureMode=true to exclude block content from results (UIDs and metadata only).
 */

// Use the shared base condition schema, extending it for pages-by-content specific needs
const contentConditionSchema = baseConditionSchema.extend({
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

// LLM-facing schema with both simple and grouped conditions support
const llmFacingSchema = z.object({
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

const schema = extendedConditionsSchema.extend({
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
interface AttributeValue {
  value: string;
  operator: "+" | "|" | "-"; // AND, OR, NOT
}

interface AttributeCondition {
  attributeKey: string;
  valueType: "text" | "page_ref" | "regex";
  values: AttributeValue[];
}

/**
 * Parse attribute condition from string format:
 * - attr:key:type:value or attr:key:type:(A + B - C)
 * - attr:key:value (defaults to page_ref type for backward compatibility)
 */
const parseAttributeCondition = (text: string): AttributeCondition | null => {
  // Try full format first: attr:key:type:value
  let match = text.match(/^attr:([^:]+):([^:]+):(.+)$/);
  if (match) {
    const [, attributeKey, valueType, valueExpression] = match;

    // Normalize and validate value type
    let normalizedValueType = valueType;
    if (valueType === "ref") {
      normalizedValueType = "page_ref"; // Allow 'ref' as shorthand for 'page_ref'
    }

    if (!["text", "page_ref", "regex"].includes(normalizedValueType)) {
      console.warn(`Invalid attribute value type: ${valueType}`);
      return null;
    }

    // Parse logical expression: (A + B - C) or (A | B | C)
    if (valueExpression.startsWith("(") && valueExpression.endsWith(")")) {
      const expression = valueExpression.slice(1, -1);
      const values = parseLogicalExpression(expression);
      return { attributeKey, valueType: normalizedValueType as any, values };
    }

    // Simple single value
    return {
      attributeKey,
      valueType: normalizedValueType as any,
      values: [{ value: valueExpression, operator: "+" }],
    };
  }

  // Try short format: attr:key:value (assume page_ref type)
  match = text.match(/^attr:([^:]+):(.+)$/);
  if (match) {
    const [, attributeKey, valueExpression] = match;

    // Parse logical expression: (A + B - C) or (A | B | C)
    if (valueExpression.startsWith("(") && valueExpression.endsWith(")")) {
      const expression = valueExpression.slice(1, -1);
      const values = parseLogicalExpression(expression);
      return { attributeKey, valueType: "page_ref", values };
    }

    // Simple single value
    return {
      attributeKey,
      valueType: "page_ref",
      values: [{ value: valueExpression, operator: "+" }],
    };
  }

  return null;
};

/**
 * Parse logical expression like "A + B - C" or "A | B | C"
 */
const parseLogicalExpression = (expr: string): AttributeValue[] => {
  const tokens = expr.split(/(\s*[+|\-]\s*)/).filter((t) => t.trim());
  const values: AttributeValue[] = [];
  let currentOp: "+" | "|" | "-" = "+"; // default to AND

  for (const token of tokens) {
    const trimmed = token.trim();
    if (["+", "|", "-"].includes(trimmed)) {
      currentOp = trimmed as any;
    } else if (trimmed) {
      values.push({ value: trimmed, operator: currentOp });
    }
  }

  // Special case: if the first value doesn't have an explicit operator,
  // and we have OR values, make the first value part of the OR group
  if (values.length > 1) {
    const hasOr = values.some((v) => v.operator === "|");
    if (hasOr && values[0].operator === "+") {
      // Check if this is a pure OR expression (like "A | B | C")
      const hasExplicitAnd = expr.includes("+");
      if (!hasExplicitAnd) {
        values[0].operator = "|"; // Make first value part of OR group
      }
    }
  }

  return values;
};

/**
 * Escape regex special characters for safe pattern building
 */
const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/**
 * Escape regex for Datomic - requires doubling backslashes
 */
const escapeForDatomic = (pattern: string): string => {
  return pattern.replace(/\\/g, "\\\\");
};

/**
 * Build value pattern based on type (text, page_ref, regex)
 */
const buildValuePattern = (value: string, type: string): string => {
  switch (type) {
    case "page_ref": {
      // Handle all Roam page reference formats:
      // [[page ref]], #[[page ref]], #page
      const cleanValue = value.replace(/^#/, ""); // Remove leading # if present
      const escapedValue = escapeRegex(cleanValue);

      // For Datomic: need to escape brackets as \\\\[ and \\\\] (quadruple backslash)
      // Simplified pattern: #?\\[\\[title\\]\\] covers both [[title]] and #[[title]]
      // Also handle simple #tag format for single words
      if (cleanValue.includes(" ")) {
        // Multi-word: must use [[]] format, optionally with #
        return escapeForDatomic(`#?\\[\\[${escapedValue}\\]\\]`);
      } else {
        // Single word: can be [[word]], #[[word]], or #word
        return escapeForDatomic(
          `(?:#?\\[\\[${escapedValue}\\]\\]|#${escapedValue}(?!\\w))`
        );
      }
    }
    case "text":
      return escapeForDatomic(escapeRegex(value));
    case "regex":
      return escapeForDatomic(value); // Apply Datomic escaping to user regex
    default:
      return escapeForDatomic(escapeRegex(value));
  }
};

/**
 * Search using regex pattern in block content
 */
const searchWithRegex = async (
  regexPattern: string,
  includeDaily: boolean = true,
  limitToPageUids?: string[]
): Promise<any[]> => {
  let query = `[:find ?uid ?content ?time ?page-title ?page-uid ?page-created ?page-modified
                :where 
                [?b :block/uid ?uid]
                [?b :block/string ?content]
                [?b :block/page ?page]
                [?page :node/title ?page-title]
                [?page :block/uid ?page-uid]
                [?page :create/time ?page-created]
                [?page :edit/time ?page-modified]
                [?b :edit/time ?time]
                [(re-pattern "(?i)${regexPattern}") ?pattern]
                [(re-find ?pattern ?content)]`;

  // Add UID-based filtering for optimization
  if (limitToPageUids && limitToPageUids.length > 0) {
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

  query += `]`;

  return await executeDatomicQuery(query);
};

/**
 * Search for attribute blocks with capture group to get the value part
 */
const searchAttributeBlocksWithCapture = async (
  attributeKey: string,
  includeDaily: boolean = true,
  limitToPageUids?: string[]
): Promise<
  {
    uid: string;
    content: string;
    valueContent: string;
    isEmpty: boolean;
    pageData: any;
  }[]
> => {
  const escapedKey = escapeRegex(attributeKey);
  // Capture everything after :: until end of line
  const regexPattern = escapeForDatomic(`^${escapedKey}::(.*)$`);

  let query = `[:find ?uid ?content ?time ?page-title ?page-uid ?page-created ?page-modified
                :where 
                [?b :block/uid ?uid]
                [?b :block/string ?content]
                [?b :block/page ?page]
                [?page :node/title ?page-title]
                [?page :block/uid ?page-uid]
                [?page :create/time ?page-created]
                [?page :edit/time ?page-modified]
                [?b :edit/time ?time]
                [(re-pattern "(?i)${regexPattern}") ?pattern]
                [(re-find ?pattern ?content)]`;

  // Add UID-based filtering for optimization
  if (limitToPageUids && limitToPageUids.length > 0) {
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

  query += `]`;

  const results = await executeDatomicQuery(query);

  // Process results to extract value content and determine if empty
  return results.map(
    ([uid, content, time, pageTitle, pageUid, pageCreated, pageModified]) => {
      // Extract the value part using the same regex
      const regex = new RegExp(`^${attributeKey}::(.*)$`, "i");
      const match = content.match(regex);
      const valueContent = match ? match[1].trim() : "";
      const isEmpty = valueContent === "";

      return {
        uid,
        content,
        valueContent,
        isEmpty,
        pageData: [
          uid,
          content,
          time,
          pageTitle,
          pageUid,
          pageCreated,
          pageModified,
        ],
      };
    }
  );
};

/**
 * Check if value content matches the logical conditions
 */
const checkValueMatches = (
  valueContent: string,
  values: AttributeValue[],
  valueType: string
): boolean => {
  const andValues = values.filter((v) => v.operator === "+");
  const orValues = values.filter((v) => v.operator === "|");
  const notValues = values.filter((v) => v.operator === "-");

  // Check AND conditions (all must be present)
  for (const andVal of andValues) {
    if (!checkSingleValueMatch(valueContent, andVal.value, valueType)) {
      return false;
    }
  }

  // Check OR conditions (at least one must be present)
  if (orValues.length > 0) {
    const hasOrMatch = orValues.some((orVal) =>
      checkSingleValueMatch(valueContent, orVal.value, valueType)
    );
    if (!hasOrMatch) {
      return false;
    }
  }

  // Check NOT conditions (none must be present)
  for (const notVal of notValues) {
    if (checkSingleValueMatch(valueContent, notVal.value, valueType)) {
      return false;
    }
  }

  return true;
};

/**
 * Check if a single value matches the content based on type
 */
const checkSingleValueMatch = (
  content: string,
  value: string,
  valueType: string
): boolean => {
  const cleanValue = value.replace(/^#/, ""); // Remove leading # if present

  switch (valueType) {
    case "page_ref": {
      // Check for [[page]], #[[page]], or #page formats
      const patterns = [
        `[[${cleanValue}]]`,
        `#[[${cleanValue}]]`,
        `#${cleanValue}`,
      ];
      return patterns.some((pattern) => content.includes(pattern));
    }
    case "text":
      return content.toLowerCase().includes(value.toLowerCase());
    case "regex":
      try {
        const regex = new RegExp(value, "i");
        return regex.test(content);
      } catch {
        return false;
      }
    default:
      return content.toLowerCase().includes(value.toLowerCase());
  }
};

/**
 * Get direct children UIDs for a batch of parent block UIDs
 */
const getDirectChildrenBatch = async (
  parentUids: string[]
): Promise<string[]> => {
  if (parentUids.length === 0) return [];

  const uidsSet = parentUids.map((uid) => `"${uid}"`).join(" ");
  const query = `[:find ?child-uid
                  :where
                  [?parent :block/uid ?parent-uid]
                  [(contains? #{${uidsSet}} ?parent-uid)]
                  [?parent :block/children ?child]
                  [?child :block/uid ?child-uid]]`;

  const results = await executeDatomicQuery(query);
  return results.map(([childUid]) => childUid);
};

/**
 * Search children blocks with logical conditions using findBlocksByContent
 */
const searchChildrenWithLogic = async (
  childrenUids: string[],
  values: AttributeValue[],
  valueType: string,
  state?: any
): Promise<any[]> => {
  if (childrenUids.length === 0) return [];

  const andValues = values.filter((v) => v.operator === "+");
  const orValues = values.filter((v) => v.operator === "|");
  const notValues = values.filter((v) => v.operator === "-");

  let resultUids = new Set(childrenUids);

  // AND logic: all conditions must match
  for (const andVal of andValues) {
    const matches = (await findBlocksByContentTool.invoke({
      conditions: [{ type: valueType as any, text: andVal.value }],
      limitToBlockUids: Array.from(resultUids),
      combineConditions: "AND",
    })) as any;

    // Parse JSON string if needed
    let parsedMatches = matches;
    if (typeof matches === "string") {
      try {
        parsedMatches = JSON.parse(matches);
      } catch (e) {
        console.warn(
          `🔍 Failed to parse tool result JSON for AND logic:`,
          e.message,
          "Raw result:",
          matches.substring(0, 300) + "..."
        );
        parsedMatches = { success: false, data: [] };
      }
    }

    if (
      parsedMatches.success === true &&
      parsedMatches.data &&
      Array.isArray(parsedMatches.data) &&
      parsedMatches.data.length > 0
    ) {
      resultUids = new Set(parsedMatches.data.map((m: any) => m.uid));
    } else {
      resultUids = new Set(); // No matches for this AND condition
    }
  }

  // OR logic: at least one condition must match
  if (orValues.length > 0) {
    const allOrMatches = new Set();
    for (const orVal of orValues) {
      const matches = (await findBlocksByContentTool.invoke({
        conditions: [{ type: valueType as any, text: orVal.value }],
        limitToBlockUids: childrenUids,
        combineConditions: "AND",
      })) as any;

      // Parse JSON string if needed
      let parsedMatches = matches;
      if (typeof matches === "string") {
        try {
          parsedMatches = JSON.parse(matches);
        } catch (e) {
          console.warn(
            `🔍 Failed to parse tool result JSON for OR logic:`,
            e.message,
            "Raw result:",
            matches.substring(0, 300) + "..."
          );
          parsedMatches = { success: false, data: [] };
        }
      }

      if (
        parsedMatches.success &&
        parsedMatches.data &&
        Array.isArray(parsedMatches.data)
      ) {
        parsedMatches.data.forEach((m: any) => allOrMatches.add(m.uid));
      }
    }
    resultUids = new Set(
      Array.from(resultUids).filter((uid) => allOrMatches.has(uid))
    );
  }

  // NOT logic: remove matches
  for (const notVal of notValues) {
    const matches = (await findBlocksByContentTool.invoke({
      conditions: [{ type: valueType as any, text: notVal.value }],
      limitToBlockUids: Array.from(resultUids),
      combineConditions: "AND",
    })) as any;

    // Parse JSON string if needed
    let parsedMatches = matches;
    if (typeof matches === "string") {
      try {
        parsedMatches = JSON.parse(matches);
      } catch (e) {
        console.warn(
          `🔍 Failed to parse tool result JSON for NOT logic:`,
          e.message,
          "Raw result:",
          matches.substring(0, 300) + "..."
        );
        parsedMatches = { success: false, data: [] };
      }
    }

    if (
      parsedMatches.success &&
      parsedMatches.data &&
      Array.isArray(parsedMatches.data)
    ) {
      const notUids = new Set(parsedMatches.data.map((m: any) => m.uid));
      resultUids = new Set(
        Array.from(resultUids).filter((uid) => !notUids.has(uid))
      );
    }
  }

  // Convert back to the expected format for page analysis
  const finalResults = [];
  for (const uid of Array.from(resultUids)) {
    // We need to get the actual block data - query it
    const blockQuery = `[:find ?uid ?content ?time ?page-title ?page-uid ?page-created ?page-modified
                        :where 
                        [?b :block/uid ?uid]
                        [(= ?uid "${uid}")]
                        [?b :block/string ?content]
                        [?b :block/page ?page]
                        [?page :node/title ?page-title]
                        [?page :block/uid ?page-uid]
                        [?page :create/time ?page-created]
                        [?page :edit/time ?page-modified]
                        [?b :edit/time ?time]]`;

    const blockData = await executeDatomicQuery(blockQuery);
    if (blockData.length > 0) {
      finalResults.push(blockData[0]);
    }
  }

  return finalResults;
};

const findPagesByContentImpl = async (
  input: z.infer<typeof schema>,
  state?: any
) => {
  const {
    conditions,
    combineConditions,
    conditionGroups,
    groupCombination,
    searchScope = "block",
    maxExpansions,
    minBlockCount,
    maxBlockCount,
    minTotalBlocks,
    maxTotalBlocks,
    includeBlockCount,
    includeBlockSamples,
    maxSamples,
    includeContentStats,
    includeDaily,
    dateRange,
    sortBy,
    limit,
    fromResultId,
    limitToPageUids,
    excludeBlockUid,
  } = input;

  // Parse syntax and detect search scope from condition text
  let finalSearchScope = searchScope;
  let rawConditions: any[] = conditions || [];

  if (hasSimpleConditions(input) && conditions && conditions.length > 0) {
    // Check for page:(content:...) or page:(block:(...)) syntax in condition text
    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];
      const syntaxResult = parsePageSearchSyntax(condition.text);

      // Only update if the extractedQuery is different (i.e., syntax was found)
      if (syntaxResult.extractedQuery !== condition.text) {
        console.log(
          `🎯 Detected explicit syntax: ${syntaxResult.searchScope} search for "${syntaxResult.extractedQuery}"`
        );
        finalSearchScope = syntaxResult.searchScope;
        // Update condition with clean text
        rawConditions[i] = { ...condition, text: syntaxResult.extractedQuery };
      }
    }
  }

  // Handle grouped conditions vs simple conditions
  let finalConditions: any[];
  let finalCombineConditions: "AND" | "OR";

  // Validate input format
  try {
    validateConditionInput(input);
  } catch (error) {
    console.error("❌ Invalid condition input:", error.message);
    return createToolResult(false, undefined, error.message);
  }

  if (hasGroupedConditions(input)) {
    console.log("🔧 Processing grouped conditions in findPagesByContent");

    // For page-wide search with grouped conditions, use special processing
    if (finalSearchScope === "content" && groupCombination === "AND") {
      console.log(
        "🌍 Using content-wide processing for complex condition groups"
      );
      const processedGroups = processConditionGroupsForPageWide(
        conditionGroups!,
        groupCombination || "AND"
      );
      finalConditions = processedGroups.conditions;
      finalCombineConditions = processedGroups.combination;
    } else {
      // Standard grouped processing for block-level search
      const processedGroups = await processConditionGroups(
        conditionGroups!,
        groupCombination || "AND",
        state
      );

      // Apply OR-to-regex conversion for mixed logic cases
      const optimizedGroups = applyORToRegexConversion(
        processedGroups.conditions,
        processedGroups.combination
      );

      finalConditions = optimizedGroups.conditions;
      finalCombineConditions = optimizedGroups.combination;
    }

    console.log(
      `🚀 Converted ${conditionGroups!.length} condition groups to ${
        finalConditions.length
      } optimized conditions with ${finalCombineConditions} logic (${finalSearchScope} scope)`
    );
  } else {
    console.log(
      `🔧 Processing simple conditions in findPagesByContent (${finalSearchScope} scope)`
    );
    // Use simple conditions (backward compatibility)
    finalConditions = rawConditions;
    finalCombineConditions = combineConditions || "AND";
  }

  // UID-based filtering for optimization
  const { pageUids: finalPageUids } = extractUidsFromResults(
    fromResultId,
    undefined, // No block UIDs for page content search
    limitToPageUids,
    state
  );

  // Step 1: Expand conditions with semantic terms
  const expandedConditions = await expandConditions(
    finalConditions,
    maxExpansions,
    state
  );

  // Step 2: Process all conditions (attribute and regular)
  let matchingBlocks: any[];
  if (finalSearchScope === "content" && finalCombineConditions === "AND") {
    console.log("🌍 Using content-wide AND processing");
    matchingBlocks = await processPageWideConditions(
      expandedConditions,
      includeDaily,
      finalPageUids.length > 0 ? finalPageUids : undefined,
      excludeBlockUid,
      state
    );
  } else {
    console.log(`📚 Using block-level processing (${finalSearchScope} scope)`);
    matchingBlocks = await processAllConditions(
      expandedConditions,
      finalCombineConditions,
      includeDaily,
      finalPageUids.length > 0 ? finalPageUids : undefined,
      excludeBlockUid,
      state
    );
  }

  // Step 3: Analyze pages by grouping blocks
  const pageAnalysis = await analyzePagesByBlocks(
    matchingBlocks,
    minBlockCount,
    maxBlockCount,
    minTotalBlocks,
    maxTotalBlocks
  );

  // Step 4: Enrich page results with detailed analysis
  let enrichedResults = await enrichPageResults(
    pageAnalysis,
    includeBlockCount,
    includeBlockSamples,
    maxSamples,
    includeContentStats,
    conditions
  );

  // Step 5: Apply date filtering
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
    enrichedResults = filterByDateRange(
      enrichedResults,
      parsedDateRange,
      filterMode
    );
  }

  // Step 6: Sort results
  enrichedResults = sortPageResults(enrichedResults, sortBy, finalConditions);

  // Step 7: Limit results
  if (enrichedResults.length > limit) {
    enrichedResults = enrichedResults.slice(0, limit);
  }

  return enrichedResults;
};

/**
 * Create optimized regex pattern for multiple page reference variations
 * Creates a single efficient OR pattern instead of multiple separate patterns
 */
const createMultiPageRefRegexPattern = (pageNames: string[]): string => {
  if (pageNames.length === 0) return "";
  if (pageNames.length === 1) return createPageRefRegexPattern(pageNames[0]);

  // Escape and prepare all page names
  const escapedNames = pageNames.map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );

  // Create alternation of just the terms
  const termAlternation = escapedNames.join("|");

  // Single optimized pattern: factors out common Roam syntax structures
  return `(?:\\[\\[(?:${termAlternation})\\]\\]|#(?:${termAlternation})(?!\\w)|(?:${termAlternation})::)`;
};

/**
 * Create regex pattern for page references that matches Roam syntax but not plain text
 * Supports: [[title]], #title, title:: but NOT plain "title"
 */
const createPageRefRegexPattern = (pageTitle: string): string => {
  // Escape special regex characters in the page title
  const escapedTitle = pageTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Optimized pattern: [[title]], #title, or title::
  return `(?:\\[\\[${escapedTitle}\\]\\]|#${escapedTitle}(?!\\w)|${escapedTitle}::)`;
};

/**
 * Expand conditions with semantic terms using comprehensive approach from blocks tool
 */
const expandConditions = async (
  conditions: any[],
  maxExpansions: number,
  state?: any
): Promise<any[]> => {
  const expandedConditions = [...conditions];
  const expansionLevel = state?.expansionLevel || 0;

  // Check if semantic expansion is needed - either globally or per-condition
  const hasGlobalExpansion = state?.isExpansionGlobal === true;

  // Check if any condition has symbols that require expansion
  const hasSymbolExpansion = conditions.some(
    (c) => c.text.endsWith("*") || c.text.endsWith("~")
  );

  if (!hasGlobalExpansion && !hasSymbolExpansion) {
    console.log(
      `⏭️ [PageContentTool] Skipping semantic expansion (no global flag or symbols)`
    );
    return expandedConditions;
  }

  console.log(
    `🧠 [PageContentTool] Applying semantic expansion at level ${expansionLevel}`
  );

  for (const condition of conditions) {
    // Skip regex conditions - user wants exact results for regex
    if (condition.type === "regex") {
      continue;
    }

    // Parse semantic expansion from condition text using our new parser
    const { cleanText, expansionType } = parseSemanticExpansion(
      condition.text,
      state?.semanticExpansion
    );

    console.log(`🔍 [DEBUG] Conditions received:`, condition);

    // Determine final expansion strategy: per-condition > global
    let effectiveExpansionStrategy = expansionType;
    if (!effectiveExpansionStrategy && hasGlobalExpansion) {
      effectiveExpansionStrategy = state?.semanticExpansion || "synonyms";
    }

    console.log("🔍 [DEBUG] expansionType :>> ", expansionType);

    // Handle text conditions with semantic expansion
    if (effectiveExpansionStrategy && condition.type === "text") {
      try {
        const customStrategy =
          effectiveExpansionStrategy === "custom"
            ? state?.customSemanticExpansion
            : undefined;

        // Use generateSemanticExpansions for all expansion strategies (including fuzzy)
        const expansionTerms = await generateSemanticExpansions(
          cleanText, // Use clean text for expansion
          effectiveExpansionStrategy as
            | "fuzzy"
            | "synonyms"
            | "related_concepts"
            | "broader_terms"
            | "custom"
            | "all",
          state?.userQuery,
          state?.model,
          state?.language,
          customStrategy,
          "text" // Allow regex patterns for text content search (since pages content is blocks)
        );

        // Create language-agnostic disjunctive regex with smart word boundaries
        if (expansionTerms.length > 0) {
          const smartPatterns = [cleanText, ...expansionTerms].map((term) => {
            const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

            // Multi-word terms: preserve spaces, add boundaries
            if (term.includes(" ")) {
              const spacedPattern = escapedTerm.replace(/\s+/g, "\\s+");
              return `\\b${spacedPattern}\\b`;
            }

            // Single words: use word boundaries for short terms to avoid false positives
            if (term.length <= 3) {
              return `\\b${escapedTerm}\\b`;
            } else {
              // Longer terms: no boundaries to catch morphological variations (plurals, etc.)
              return escapedTerm;
            }
          });

          const disjunctivePattern = `(?:${smartPatterns.join("|")})`;

          // Replace original condition with expanded regex
          condition.type = "regex";
          condition.text = disjunctivePattern;
          condition.matchType = "regex";
          condition.semanticExpansion = undefined;
          condition.weight = condition.weight * 0.7;
        } else {
          // Fallback: just update with clean text
          condition.text = cleanText;
        }
      } catch (error) {
        console.warn(`Failed to expand condition "${condition.text}":`, error);
        // Fallback: just update with clean text
        condition.text = cleanText;
      }
    } else {
      // No expansion needed, just update with clean text (remove symbols)
      condition.text = cleanText;
    }

    // Handle page_ref conditions with semantic expansion
    if (condition.type === "page_ref" && effectiveExpansionStrategy) {
      try {
        const customStrategy =
          effectiveExpansionStrategy === "custom"
            ? state?.customSemanticExpansion
            : undefined;

        // For all page_ref expansions (including fuzzy), use generateSemanticExpansions
        const expansionTerms = await generateSemanticExpansions(
          cleanText, // Use clean text for expansion
          effectiveExpansionStrategy as
            | "synonyms"
            | "related_concepts"
            | "broader_terms"
            | "custom"
            | "all",
          state?.userQuery,
          state?.model,
          state?.language,
          customStrategy,
          "page_ref" // Generate simple text variations for page references
        );

        console.log(
          `🔗 Expanding page reference "${condition.text}" with ${expansionTerms.length} semantic variations`
        );

        if (expansionTerms.length > 0) {
          // Create page reference syntax pattern
          const optimizedRegexPattern =
            createMultiPageRefRegexPattern(expansionTerms);

          // Replace original page_ref condition with expanded regex
          condition.type = "regex";
          condition.text = optimizedRegexPattern;
          condition.matchType = "regex";
          condition.semanticExpansion = undefined;
          condition.weight = condition.weight * 0.7;

          console.log(
            `  ✅ Created optimized pattern for ${
              expansionTerms.length
            } expansion terms: ${expansionTerms.join(", ")}`
          );
        } else {
          // Fallback: just update with clean text
          condition.text = cleanText;
        }
      } catch (error) {
        console.warn(
          `Failed to expand page_ref condition "${condition.text}":`,
          error
        );
        // Fallback: just update with clean text
        condition.text = cleanText;
      }
    }
  }

  return expandedConditions;
};

/**
 * Expand attribute condition values with semantic expansion if needed
 */
const expandAttributeCondition = async (
  attrCondition: AttributeCondition,
  state?: any
): Promise<AttributeCondition> => {
  // Check if semantic expansion is needed - either globally or per-value
  const hasGlobalExpansion = state?.isExpansionGlobal === true;

  // Check if any value has symbols that require expansion
  const hasSymbolExpansion = attrCondition.values.some(
    (v) => v.value.endsWith("*") || v.value.endsWith("~")
  );

  if (!hasGlobalExpansion && !hasSymbolExpansion) {
    return attrCondition; // No expansion needed
  }

  console.log(
    `🧠 [AttributeTool] Applying semantic expansion to attribute "${attrCondition.attributeKey}"`
  );

  const expandedValues: AttributeValue[] = [];

  for (const value of attrCondition.values) {
    // Parse semantic expansion from value text
    const { cleanText, expansionType } = parseSemanticExpansion(
      value.value,
      state?.semanticExpansion
    );

    // Determine final expansion strategy: per-value > global
    let effectiveExpansionStrategy = expansionType;
    if (!effectiveExpansionStrategy && hasGlobalExpansion) {
      effectiveExpansionStrategy = state?.semanticExpansion || "synonyms";
    }

    // Add the original clean value
    expandedValues.push({
      ...value,
      value: cleanText,
    });

    // Apply semantic expansion if needed
    if (effectiveExpansionStrategy && attrCondition.valueType !== "regex") {
      try {
        const customStrategy =
          effectiveExpansionStrategy === "custom"
            ? state?.customSemanticExpansion
            : undefined;

        // Determine the mode based on attribute value type
        const expansionMode =
          attrCondition.valueType === "page_ref" ? "page_ref" : "text";

        // Use generateSemanticExpansions for attribute values
        const expansionTerms = await generateSemanticExpansions(
          cleanText,
          effectiveExpansionStrategy as
            | "fuzzy"
            | "synonyms"
            | "related_concepts"
            | "broader_terms"
            | "custom"
            | "all",
          state?.userQuery,
          state?.model,
          state?.language,
          customStrategy,
          expansionMode
        );

        console.log(
          `🔍 Expanding attribute value "${cleanText}" (${attrCondition.valueType}) with ${expansionTerms.length} semantic variations`
        );

        // Add expanded terms with same operator but reduced weight
        for (const term of expansionTerms) {
          expandedValues.push({
            value: term,
            operator: value.operator, // Keep the same logical operator
          });
        }
      } catch (error) {
        console.warn(
          `Failed to expand attribute value "${value.value}":`,
          error
        );
      }
    }
  }

  return {
    ...attrCondition,
    values: expandedValues,
  };
};

/**
 * Process conditions with page-wide semantics using PageWideQueryBuilder
 * Each positive condition can match in different blocks across the page
 */
const processPageWideConditions = async (
  conditions: any[],
  includeDaily: boolean,
  limitToPageUids?: string[],
  excludeBlockUid?: string,
  state?: any
): Promise<any[]> => {
  // Separate attribute conditions from regular conditions
  const attributeConditions: AttributeCondition[] = [];
  const regularConditions: any[] = [];

  for (const condition of conditions) {
    if (condition.text?.startsWith("attr:")) {
      const parsed = parseAttributeCondition(condition.text);
      if (parsed) {
        // Apply semantic expansion to attribute values if needed
        const expandedAttrCondition = await expandAttributeCondition(
          parsed,
          state
        );
        attributeConditions.push(expandedAttrCondition);
      } else {
        console.warn(`Failed to parse attribute condition: ${condition.text}`);
      }
    } else {
      regularConditions.push(condition);
    }
  }

  let attributeResults: any[] = [];

  // Process attribute conditions (same as block-level for now - attributes are inherently page-wide)
  for (const attrCondition of attributeConditions) {
    // Use same attribute processing as block-level search
    const attributeBlocks = await searchAttributeBlocksWithCapture(
      attrCondition.attributeKey,
      includeDaily,
      limitToPageUids
    );

    if (attributeBlocks.length === 0) {
      continue;
    }

    let matches: any[] = [];

    // Separate empty and non-empty attribute blocks
    const emptyBlocks = attributeBlocks.filter((block) => block.isEmpty);
    const nonEmptyBlocks = attributeBlocks.filter((block) => !block.isEmpty);

    // Process non-empty blocks
    for (const block of nonEmptyBlocks) {
      const valueMatches = checkValueMatches(
        block.valueContent,
        attrCondition.values,
        attrCondition.valueType
      );
      if (valueMatches) {
        matches.push(block.pageData);
      }
    }

    // Process empty blocks (check their children)
    if (emptyBlocks.length > 0) {
      const emptyBlockUids = emptyBlocks.map((block) => block.uid);
      const childrenUids = await getDirectChildrenBatch(emptyBlockUids);

      if (childrenUids.length > 0) {
        const childrenMatches = await searchChildrenWithLogic(
          childrenUids,
          attrCondition.values,
          attrCondition.valueType,
          state
        );

        // Get matching page UIDs
        const matchingPageUids = new Set();
        for (const childMatch of childrenMatches) {
          const pageUid = childMatch[4];
          if (pageUid) {
            matchingPageUids.add(pageUid);
          }
        }

        // Return the empty attribute blocks whose children matched
        for (const block of emptyBlocks) {
          const blockPageUid = block.pageData[4];
          if (matchingPageUids.has(blockPageUid)) {
            matches.push(block.pageData);
          }
        }
      }
    }

    attributeResults = attributeResults.concat(matches);
  }

  // Process regular conditions with page-wide logic using PageWideQueryBuilder
  let regularResults: any[] = [];
  if (regularConditions.length > 0) {
    console.log(
      `🌐 Building page-wide query for ${regularConditions.length} conditions`
    );

    // Convert conditions to SearchCondition format
    const searchConditions: SearchCondition[] = regularConditions.map(
      (cond) => ({
        type: cond.type as any,
        text: cond.text,
        matchType: cond.matchType as any,
        negate: cond.negate || false,
      })
    );

    // Build base query with correct format for page results
    const baseQuery = `[:find ?page-uid ?page-title ?page-created ?page-modified
                :where
                [?page :node/title ?page-title]
                [?page :block/uid ?page-uid]
                [?page :create/time ?page-created]
                [?page :edit/time ?page-modified]`;

    const queryBuilder = new PageWideQueryBuilder(
      searchConditions,
      "AND",
      baseQuery,
      excludeBlockUid
    );
    const pageWideQuery = queryBuilder.buildPageWideQuery();

    // Add additional constraints for includeDaily, limitToPageUids, excludeBlockUid
    let finalQuery = pageWideQuery.query;

    if (!includeDaily) {
      finalQuery = finalQuery.replace(
        "]\n",
        `
                [(re-pattern "${dnpUidRegex.source.slice(1, -1)}") ?dnp-pattern]
                (not [(re-find ?dnp-pattern ?page-uid)])]\n`
      );
    }

    if (limitToPageUids && limitToPageUids.length > 0) {
      if (limitToPageUids.length === 1) {
        finalQuery = finalQuery.replace(
          "]\n",
          `
                [?page :block/uid "${limitToPageUids[0]}"]]
`
        );
      } else {
        const uidsSet = limitToPageUids.map((uid) => `"${uid}"`).join(" ");
        finalQuery = finalQuery.replace(
          "]\n",
          `
                [(contains? #{${uidsSet}} ?page-uid)]]
`
        );
      }
    }

    console.log(
      `🔍 Executing page-wide query: ${finalQuery.substring(0, 200)}...`
    );
    const queryResults = await executeDatomicQuery(finalQuery);

    // Convert results to the expected format for further processing
    regularResults = queryResults.map(
      ([pageUid, pageTitle, pageCreated, pageModified]) => [
        pageUid, // Block UID (using page UID as placeholder)
        pageTitle, // Content (using page title as placeholder)
        pageModified, // Time
        pageTitle, // Page title
        pageUid, // Page UID
        pageCreated, // Page created
        pageModified, // Page modified
      ]
    );
    console.log(
      `🎯 Found ${regularResults.length} pages with page-wide matches`
    );
  }

  // Combine results based on combination logic (always AND for page-wide)
  let finalResults: any[] = [];
  if (attributeResults.length > 0 && regularResults.length > 0) {
    // Pages must have both attribute and regular matches
    finalResults = combineResultsByPageIntersection(
      attributeResults,
      regularResults
    );
    console.log(
      `🤝 Combined attribute + regular results: ${finalResults.length} pages`
    );
  } else if (attributeResults.length > 0) {
    finalResults = attributeResults;
    console.log(
      `🏷️ Using attribute results only: ${finalResults.length} pages`
    );
  } else {
    finalResults = regularResults;
    console.log(`📝 Using regular results only: ${finalResults.length} pages`);
  }

  return finalResults;
};

/**
 * Process all conditions (attribute and regular) with two-step fallback strategy
 */
const processAllConditions = async (
  conditions: any[],
  combineLogic: "AND" | "OR",
  includeDaily: boolean,
  limitToPageUids?: string[],
  excludeBlockUid?: string,
  state?: any
): Promise<any[]> => {
  // Separate attribute conditions from regular conditions
  const attributeConditions: AttributeCondition[] = [];
  const regularConditions: any[] = [];

  for (const condition of conditions) {
    if (condition.text?.startsWith("attr:")) {
      const parsed = parseAttributeCondition(condition.text);
      if (parsed) {
        // Apply semantic expansion to attribute values if needed
        const expandedAttrCondition = await expandAttributeCondition(
          parsed,
          state
        );
        attributeConditions.push(expandedAttrCondition);
      } else {
        console.warn(`Failed to parse attribute condition: ${condition.text}`);
      }
    } else {
      regularConditions.push(condition);
    }
  }

  let attributeResults: any[] = [];

  // Process each attribute condition with intelligent capture-based strategy
  for (const attrCondition of attributeConditions) {
    // Step 1: Get ALL attribute blocks with capture group to analyze value content
    const attributeBlocks = await searchAttributeBlocksWithCapture(
      attrCondition.attributeKey,
      includeDaily,
      limitToPageUids
    );

    if (attributeBlocks.length === 0) {
      continue;
    }

    let matches: any[] = [];

    // Separate empty and non-empty attribute blocks
    const emptyBlocks = attributeBlocks.filter((block) => block.isEmpty);
    const nonEmptyBlocks = attributeBlocks.filter((block) => !block.isEmpty);

    // Step 2: Process non-empty blocks (check if they match the values directly)
    for (const block of nonEmptyBlocks) {
      const valueMatches = checkValueMatches(
        block.valueContent,
        attrCondition.values,
        attrCondition.valueType
      );
      if (valueMatches) {
        matches.push(block.pageData);
      }
    }

    // Step 3: Process empty blocks (check their children)
    if (emptyBlocks.length > 0) {
      const emptyBlockUids = emptyBlocks.map((block) => block.uid);
      const childrenUids = await getDirectChildrenBatch(emptyBlockUids);

      if (childrenUids.length > 0) {
        const childrenMatches = await searchChildrenWithLogic(
          childrenUids,
          attrCondition.values,
          attrCondition.valueType,
          state
        );

        // For children matches, we need to create block results that represent the attribute blocks
        // The parent empty attribute blocks should be returned, not the children
        // Get the unique page UIDs from children that matched
        const matchingPageUids = new Set();
        for (const childMatch of childrenMatches) {
          const pageUid = childMatch[4]; // pageUid is at index 4 in the array
          if (pageUid) {
            matchingPageUids.add(pageUid);
          }
        }

        // Return the empty attribute blocks (parents) whose children matched
        for (const block of emptyBlocks) {
          const blockPageUid = block.pageData[4]; // pageUid from pageData
          if (matchingPageUids.has(blockPageUid)) {
            matches.push(block.pageData); // This is already in the correct block format
          }
        }
      }
    }

    attributeResults = attributeResults.concat(matches);
  }

  // Process regular conditions normally
  let regularResults: any[] = [];
  if (regularConditions.length > 0) {
    regularResults = await findMatchingBlocks(
      regularConditions,
      combineLogic,
      includeDaily,
      limitToPageUids,
      excludeBlockUid
    );
  }

  // Combine results based on combination logic
  let finalResults: any[] = [];
  if (attributeResults.length > 0 && regularResults.length > 0) {
    if (combineLogic === "AND") {
      // Pages must have both attribute and regular matches
      finalResults = combineResultsByPageIntersection(
        attributeResults,
        regularResults
      );
    } else {
      // Pages can have either attribute or regular matches
      finalResults = combineResultsByPageUnion(
        attributeResults,
        regularResults
      );
    }
  } else if (attributeResults.length > 0) {
    finalResults = attributeResults;
  } else {
    finalResults = regularResults;
  }

  return finalResults;
};

/**
 * Combine results by page intersection (AND logic)
 */
const combineResultsByPageIntersection = (
  results1: any[],
  results2: any[]
): any[] => {
  const pages1 = new Set(results1.map(([, , , , pageUid]) => pageUid));
  return results2.filter(([, , , , pageUid]) => pages1.has(pageUid));
};

/**
 * Combine results by page union (OR logic)
 */
const combineResultsByPageUnion = (results1: any[], results2: any[]): any[] => {
  const seenPages = new Set();
  const combined = [];

  // Add all results, avoiding page duplicates (keep first occurrence)
  for (const result of [...results1, ...results2]) {
    const pageUid = result[4]; // pageUid is at index 4
    if (!seenPages.has(pageUid)) {
      seenPages.add(pageUid);
      combined.push(result);
    }
  }

  return combined;
};

/**
 * Find all blocks matching the conditions (legacy function for regular conditions)
 */
const findMatchingBlocks = async (
  conditions: any[],
  combineLogic: "AND" | "OR",
  includeDaily: boolean,
  limitToPageUids?: string[],
  excludeBlockUid?: string
): Promise<any[]> => {
  let query = `[:find ?uid ?content ?time ?page-title ?page-uid ?page-created ?page-modified
                :where 
                [?b :block/uid ?uid]
                [?b :block/string ?content]
                [?b :block/page ?page]
                [?page :node/title ?page-title]
                [?page :block/uid ?page-uid]
                [?page :create/time ?page-created]
                [?page :edit/time ?page-modified]
                [?b :edit/time ?time]`;

  // Add UID-based filtering for optimization
  if (limitToPageUids && limitToPageUids.length > 0) {
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

  // Add exclusion for specific block UID
  if (excludeBlockUid) {
    query += `\n                [(not= ?uid "${excludeBlockUid}")]`;
  }

  query += `]`;

  return await executeDatomicQuery(query);
};

/**
 * Analyze pages by grouping their matching blocks
 */
const analyzePagesByBlocks = async (
  matchingBlocks: any[],
  minBlockCount: number,
  maxBlockCount?: number,
  minTotalBlocks?: number,
  maxTotalBlocks?: number
): Promise<any[]> => {
  // Group blocks by page
  const pageMap = new Map();

  for (const block of matchingBlocks) {
    const [
      blockUid,
      content,
      time,
      pageTitle,
      pageUid,
      pageCreated,
      pageModified,
    ] = block;

    if (!pageMap.has(pageUid)) {
      // Get total block count for this page
      const totalBlocksQuery = `[:find (count ?b)
                                :where 
                                [?page :block/uid "${pageUid}"]
                                [?page :block/children ?b]]`;

      const totalBlocksResult = await executeDatomicQuery(totalBlocksQuery);
      const totalBlocks = totalBlocksResult[0]?.[0] || 0;

      pageMap.set(pageUid, {
        pageUid,
        pageTitle,
        pageCreated: new Date(pageCreated),
        pageModified: new Date(pageModified),
        isDaily: isDailyNote(pageUid),
        matchingBlocks: [],
        totalBlocks,
      });
    }

    const pageData = pageMap.get(pageUid);
    pageData.matchingBlocks.push({
      uid: blockUid,
      content,
      modified: new Date(time),
    });
  }

  // Filter pages based on criteria
  const qualifyingPages = [];

  for (const pageData of Array.from(pageMap.values())) {
    const matchingCount = pageData.matchingBlocks.length;
    const totalCount = pageData.totalBlocks;

    // Check block count criteria
    if (matchingCount < minBlockCount) continue;
    if (maxBlockCount && matchingCount > maxBlockCount) continue;
    if (minTotalBlocks && totalCount < minTotalBlocks) continue;
    if (maxTotalBlocks && totalCount > maxTotalBlocks) continue;

    qualifyingPages.push(pageData);
  }

  return qualifyingPages;
};

/**
 * Enrich page results with detailed content analysis
 */
const enrichPageResults = async (
  pageAnalysis: any[],
  includeBlockCount: boolean,
  includeBlockSamples: boolean,
  maxSamples: number,
  includeContentStats: boolean,
  conditions: any[]
): Promise<any[]> => {
  const enrichedResults = [];

  for (const pageData of pageAnalysis) {
    const result: any = {
      uid: pageData.pageUid,
      title: pageData.pageTitle,
      created: pageData.pageCreated,
      modified: pageData.pageModified,
      isDaily: pageData.isDaily,
      totalBlocks: pageData.totalBlocks,
      // Explicit type flag
      isPage: true,
    };

    if (includeBlockCount) {
      result.matchingBlockCount = pageData.matchingBlocks.length;
      result.matchRatio = (
        pageData.matchingBlocks.length / pageData.totalBlocks
      ).toFixed(3);
    }

    if (includeBlockSamples) {
      // Sort blocks by relevance and modification time
      const sortedBlocks = pageData.matchingBlocks
        .sort((a, b) => {
          // Simple relevance: prefer longer content
          const scoreA = a.content.length;
          const scoreB = b.content.length;

          if (scoreA !== scoreB) {
            return scoreB - scoreA;
          }

          return b.modified.getTime() - a.modified.getTime();
        })
        .slice(0, maxSamples);

      result.sampleBlocks = sortedBlocks.map((block) => ({
        uid: block.uid,
        content:
          block.content.length > 200
            ? block.content.substring(0, 200) + "..."
            : block.content,
        modified: block.modified,
      }));
    }

    if (includeContentStats) {
      const allContent = pageData.matchingBlocks
        .map((b) => b.content)
        .join(" ");

      result.contentStats = {
        totalCharacters: allContent.length,
        averageBlockLength: Math.round(
          allContent.length / pageData.matchingBlocks.length
        ),
        uniqueWords: new Set(allContent.toLowerCase().split(/\s+/)).size,
        hasReferences: /\[\[[^\]]+\]\]|\(\([^)]+\)\)/.test(allContent),
      };
    }

    // Calculate relevance score
    result.relevanceScore = calculatePageRelevanceScore(pageData, conditions);

    enrichedResults.push(result);
  }

  return enrichedResults;
};

/**
 * Calculate relevance score for a page based on its content matches
 */
const calculatePageRelevanceScore = (
  pageData: any,
  conditions: any[]
): number => {
  let score = 0;

  // Base score from number of matching blocks
  score += pageData.matchingBlocks.length * 2;

  // Bonus for match ratio (higher ratio = more relevant page)
  const matchRatio = pageData.matchingBlocks.length / pageData.totalBlocks;
  score += matchRatio * 10;

  // Score based on content quality
  for (const block of pageData.matchingBlocks) {
    const content = block.content.toLowerCase();

    for (const condition of conditions) {
      if (condition.type === "text") {
        const text = condition.text.toLowerCase();
        const weight = condition.weight;

        if (condition.matchType === "exact" && content === text) {
          score += 5 * weight;
        } else if (content.includes(text)) {
          const exactWordMatch = new RegExp(
            `\\b${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`
          ).test(content);
          score += exactWordMatch ? 3 * weight : 1 * weight;
        }
      }
    }

    // Bonus for longer, more substantial blocks
    if (block.content.length > 100) {
      score += 1;
    }
  }

  return score;
};

/**
 * Sort page results
 */
const sortPageResults = (
  results: any[],
  sortBy: string,
  _originalConditions: any[]
): any[] => {
  return results.sort((a, b) => {
    switch (sortBy) {
      case "recent":
        return b.modified.getTime() - a.modified.getTime();

      case "page_title":
        return a.title.localeCompare(b.title);

      case "block_count":
        return b.matchingBlockCount - a.matchingBlockCount;

      case "total_blocks":
        return b.totalBlocks - a.totalBlocks;

      case "relevance":
      default:
        if (a.relevanceScore !== b.relevanceScore) {
          return b.relevanceScore - a.relevanceScore;
        }
        return b.modified.getTime() - a.modified.getTime();
    }
  });
};

export const findPagesByContentTool = tool(
  async (llmInput, config) => {
    const startTime = performance.now();
    try {
      // Extract state from config to access injected parameters
      const state = config?.configurable?.state;

      // Auto-enrich with internal parameters from agent state
      const enrichedInput = {
        ...llmInput,
        // Internal parameters injected from agent state
        resultMode: state?.privateMode
          ? ("uids_only" as const)
          : ("summary" as const),
        secureMode: state?.privateMode || false,
        userQuery: state?.userQuery || "",
        excludeBlockUid: state?.rootUid || "",
        expansionLevel: state?.expansionLevel || 0,
        dateRange: state?.searchDetails?.timeRange,
        // Tool-specific defaults
        maxExpansions: 3,
        includeDaily: true,
        sortOrder: "desc" as const,
        randomSample: { enabled: false, size: 100 },
        includeContentStats: false,
        minTotalBlocks: 1,
        maxTotalBlocks: undefined,
        searchScope: llmInput.searchScope || "block",

        // Add missing schema properties with defaults
        minBlockCount: llmInput.minBlockCount || 1,
        includeBlockCount: true,
        includeBlockSamples: llmInput.includeBlockSamples !== false, // Default true
        maxSamples: llmInput.maxSamples || 5,
        sortBy: llmInput.sortBy || "relevance",
        limit: llmInput.limit || 200,
        fromResultId: llmInput.fromResultId,
        limitToPageUids: undefined, // Will be handled by agent
        groupCombination: llmInput.groupCombination || "AND",

        // Ensure conditions have all required fields
        conditions:
          llmInput.conditions?.map((cond) => ({
            ...cond,
            semanticExpansion: undefined,
            weight: 1.0,
          })) || [],
      };

      console.log(
        "🔍 [findPagesByContentTool] ENRICHED INPUT searchScope:",
        enrichedInput.searchScope
      );
      console.log(
        "🔍 [findPagesByContentTool] ENRICHED INPUT excludeBlockUid:",
        enrichedInput.excludeBlockUid
      );
      console.log(
        "🔍 [findPagesByContentTool] ENRICHED INPUT conditions:",
        JSON.stringify(enrichedInput.conditions, null, 2)
      );

      const results = await findPagesByContentImpl(enrichedInput, state);
      return createToolResult(
        true,
        results,
        undefined,
        "findPagesByContent",
        startTime
      );
    } catch (error) {
      console.error("FindPagesByContent tool error:", error);
      return createToolResult(
        false,
        undefined,
        error.message,
        "findPagesByContent",
        startTime
      );
    }
  },
  {
    name: "findPagesByContent",
    description:
      "Find pages by analyzing their block content. SIMPLE: Use 'conditions' array for basic AND/OR logic. GROUPED: Use 'conditionGroups' for complex logic like ((A|B) AND NOT C). SCOPE: Use 'searchScope=content' for content-wide AND (conditions across different blocks) or 'block' for same-block matching. Supports syntax: page:(content:term) or page:(block:(term)). Use for 'pages that contain X' or 'pages with attributes' queries.",
    schema: llmFacingSchema, // Use minimal schema for better LLM experience
  }
);
