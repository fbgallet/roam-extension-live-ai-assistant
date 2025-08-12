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
} from "./searchUtils";
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

const contentConditionSchema = z.object({
  type: z.enum(["text", "page_ref", "block_ref", "regex"]).default("text").describe("text=content search, page_ref=[[page]] reference, regex=pattern matching"),
  text: z
    .string()
    .min(1, "Search text is required")
    .describe("Search text, page name, or regex pattern. For attributes use format: attr:key:type:value or attr:key:type:(A + B - C)"),
  matchType: z.enum(["exact", "contains", "regex"]).default("contains").describe("contains=phrase within content, exact=entire content matches"),
  semanticExpansion: z
    .boolean()
    .default(false)
    .describe("Only use when few results or user requests semantic search"),
  weight: z.number().min(0).max(10).default(1.0),
  negate: z.boolean().default(false).describe("Exclude content matching this condition"),
});

// Minimal LLM-facing schema - only essential user-controllable parameters
const llmFacingSchema = z.object({
  conditions: z.array(z.object({
    text: z.string().min(1, "Search text is required").describe("Search text, page name, or regex pattern. For attributes use format: attr:key:type:value"),
    type: z.enum(["text", "page_ref", "block_ref", "regex"]).default("text").describe("text=content search, page_ref=[[page]] reference, regex=pattern matching"),
    matchType: z.enum(["exact", "contains", "regex"]).default("contains").describe("contains=phrase within content, exact=entire content matches"),
    negate: z.boolean().default(false).describe("Exclude content matching this condition")
  })).min(1, "At least one search condition required"),
  combineConditions: z.enum(["AND", "OR"]).default("AND").describe("AND=all conditions must match, OR=any condition matches"),
  minBlockCount: z.number().min(1).default(1).describe("Minimum blocks that must match per page"),
  maxBlockCount: z.number().optional().describe("Maximum blocks that can match per page"),
  includeBlockSamples: z.boolean().default(true).describe("Include sample matching blocks in results"),
  maxSamples: z.number().min(1).max(20).default(5).describe("Max sample blocks per page"),
  sortBy: z.enum(["relevance", "creation", "modification", "alphabetical", "block_count", "total_blocks"]).default("relevance").describe("Sort pages by this criteria"),
  limit: z.number().min(1).max(1000).default(200).describe("Maximum pages to return"),
  fromResultId: z.string().optional().describe("Limit to pages from previous result (e.g., 'findPagesByTitle_001') - major performance boost")
});

const schema = z.object({
  conditions: z
    .array(contentConditionSchema)
    .min(1, "At least one condition is required"),
  combineConditions: z.enum(["AND", "OR"]).default("AND"),
  maxExpansions: z.number().min(1).max(10).default(3),
  expansionStrategy: z
    .enum(["synonyms", "related_concepts", "broader_terms"])
    .default("related_concepts"),

  // Page-level filtering
  minBlockCount: z
    .number()
    .min(1)
    .default(1)
    .describe("Minimum blocks that must match per page"),
  maxBlockCount: z
    .number()
    .optional()
    .describe("Maximum blocks that can match per page"),
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
    })
    .optional(),
  // Enhanced sorting and sampling options
  sortBy: z
    .enum([
      "relevance",
      "creation",
      "modification",
      "alphabetical",
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
      [...resultUids].filter((uid) => allOrMatches.has(uid))
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
      resultUids = new Set([...resultUids].filter((uid) => !notUids.has(uid)));
    }
  }

  // Convert back to the expected format for page analysis
  const finalResults = [];
  for (const uid of resultUids) {
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
    maxExpansions,
    expansionStrategy,
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
  } = input;


  // UID-based filtering for optimization
  const { pageUids: finalPageUids } = extractUidsFromResults(
    fromResultId,
    undefined, // No block UIDs for page content search
    limitToPageUids,
    state
  );

  // Step 1: Expand conditions with semantic terms
  const expandedConditions = await expandConditions(
    conditions,
    expansionStrategy,
    maxExpansions
  );

  // Step 2: Process all conditions (attribute and regular)
  const matchingBlocks = await processAllConditions(
    expandedConditions,
    combineConditions,
    includeDaily,
    finalPageUids.length > 0 ? finalPageUids : undefined,
    state
  );

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
  if (dateRange && (dateRange.start || dateRange.end) && includeDaily) {
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
    enrichedResults = filterByDateRange(enrichedResults, parsedDateRange);
  }

  // Step 6: Sort results
  enrichedResults = sortPageResults(enrichedResults, sortBy, conditions);

  // Step 7: Limit results
  if (enrichedResults.length > limit) {
    enrichedResults = enrichedResults.slice(0, limit);
  }

  return enrichedResults;
};

/**
 * Expand conditions with semantic terms
 */
const expandConditions = async (
  conditions: any[],
  strategy: string,
  maxExpansions: number
): Promise<any[]> => {
  const expandedConditions = [...conditions];

  for (const condition of conditions) {
    if (condition.semanticExpansion && condition.type === "text") {
      try {
        const expansionTerms = await generateSemanticExpansions(
          condition.text,
          strategy as any,
          maxExpansions
        );

        for (const term of expansionTerms) {
          expandedConditions.push({
            ...condition,
            text: term,
            semanticExpansion: false,
            weight: condition.weight * 0.8,
          });
        }
      } catch (error) {
        console.warn(`Failed to expand condition "${condition.text}":`, error);
      }
    }
  }

  return expandedConditions;
};

/**
 * Process all conditions (attribute and regular) with two-step fallback strategy
 */
const processAllConditions = async (
  conditions: any[],
  combineLogic: "AND" | "OR",
  includeDaily: boolean,
  limitToPageUids?: string[],
  state?: any
): Promise<any[]> => {

  // Separate attribute conditions from regular conditions
  const attributeConditions: AttributeCondition[] = [];
  const regularConditions: any[] = [];

  for (const condition of conditions) {
    if (condition.text?.startsWith("attr:")) {
      const parsed = parseAttributeCondition(condition.text);
      if (parsed) {
        attributeConditions.push(parsed);
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
      limitToPageUids
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
  const pages1 = new Set(
    results1.map(([, , , , pageUid]) => pageUid)
  );
  return results2.filter(([, , , , pageUid]) =>
    pages1.has(pageUid)
  );
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

  for (const pageData of pageMap.values()) {
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
      // Auto-enrich with internal parameters (will be set by agent state)
      const enrichedInput = {
        ...llmInput,
        // These will be injected by the agent wrapper - preserve if already set
        maxExpansions: 3,
        expansionStrategy: "related_concepts" as const,
        includeDaily: true,
        dateRange: undefined, // Only set if explicitly provided by LLM
        sortOrder: "desc" as const,
        randomSample: { enabled: false, size: 100 },
        secureMode: false,
        includeContentStats: false,
        minTotalBlocks: 1,
        maxTotalBlocks: undefined,
        // Ensure conditions have all required fields
        conditions: llmInput.conditions.map(cond => ({
          ...cond,
          semanticExpansion: false,
          weight: 1.0
        }))
      };

      // Extract state from config
      const state = config?.configurable?.state;
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
    description: "Find pages by analyzing their block content. Search for pages containing specific text, page references, or attributes. Supports block counting, content filtering, and result aggregation. Use for 'pages that contain X' or 'pages with attributes' queries.",
    schema: llmFacingSchema, // Use minimal schema for better LLM experience
  }
);
