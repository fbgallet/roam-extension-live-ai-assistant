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
  getBlockChildren,
  getBlockParents,
  getBatchBlockChildren,
  getBatchBlockParents,
  getFlattenedDescendants,
  getFlattenedAncestors,
  DatomicQueryBuilder,
  SearchCondition,
  extractUidsFromResults,
  sanitizeRegexForDatomic,
  deduplicateResultsByUid,
} from "./searchUtils";
import { findBlocksByContentTool } from "./findBlocksByContentTool";
import { combineResultsTool } from "./combineResultsTool";
import { updateAgentToaster } from "../../shared/agentsUtils";
import { dnpUidRegex } from "../../../../utils/regex.js";

/**
 * Find blocks with hierarchical context using content and structure conditions
 * Security Level: Flexible (secure mode = UIDs/metadata only, content mode = includes full hierarchy)
 *
 * This tool searches for blocks and enriches results with hierarchical context,
 * supporting complex conditions on both content and structural relationships.
 * Use secureMode=true to exclude full block content from results (UIDs and metadata only).
 */

const hierarchyConditionSchema = z.object({
  direction: z
    .enum(["descendants", "ancestors"])
    .describe("Search in descendants (children) or ancestors (parents)"),
  levels: z.union([z.number().min(1).max(10), z.literal("all")]).default("all"),
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
  type: z.enum(["text", "page_ref", "block_ref", "regex"]).default("text"),
  text: z.string().min(1, "Search text is required"),
  matchType: z.enum(["exact", "contains", "regex"]).default("contains"),
  semanticExpansion: z
    .boolean()
    .default(false)
    .describe("Only use when few results or user requests semantic search"),
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
    | "deep_bidirectional";
  operator: ">" | ">>" | "=>" | "<=>" | "<<=>>";
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

const schema = z.object({
  contentConditions: z
    .array(contentConditionSchema)
    .min(1, "At least one content condition is required"),
  hierarchyConditions: z.array(hierarchyConditionSchema).optional(),
  combineConditions: z.enum(["AND", "OR"]).default("AND"),
  combineHierarchy: z.enum(["AND", "OR"]).default("OR"),
  maxExpansions: z.number().min(1).max(10).default(3),
  expansionStrategy: z
    .enum(["synonyms", "related_concepts", "broader_terms"])
    .default("related_concepts"),
  includeChildren: z.boolean().default(false),
  childDepth: z.number().min(1).max(5).default(1),
  includeParents: z.boolean().default(false),
  parentDepth: z.number().min(1).max(3).default(1),
  includeDaily: z.boolean().default(true),
  dateRange: z
    .object({
      start: z.union([z.date(), z.string()]).optional(),
      end: z.union([z.date(), z.string()]).optional(),
    })
    .optional(),
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

  // Enhanced hierarchical search capabilities
  hierarchicalExpression: z
    .string()
    .optional()
    .describe(
      "Advanced hierarchical query syntax: 'A > B' (strict hierarchy), 'A => B' (flexible: same block OR hierarchy), 'A <=> B' (bidirectional), 'A <<=>> B' (deep bidirectional). Supports complex expressions like 'A <=> (B + C)' or '(A | D) => B'"
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
    .string()
    .optional()
    .describe(
      "Limit search to blocks/pages from previous result (e.g., 'findBlocksByContent_001')"
    ),
  limitToBlockUids: z
    .array(z.string())
    .optional()
    .describe("Limit search to specific block UIDs"),
  limitToPageUids: z
    .array(z.string())
    .optional()
    .describe("Limit search to blocks within specific page UIDs"),
});

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
        pattern: />>/,
        type: "deep_strict_hierarchy" as const,
        operator: ">>" as const,
      },
      {
        pattern: /=>/,
        type: "flexible_hierarchy" as const,
        operator: "=>" as const,
      },
      {
        pattern: />/,
        type: "strict_hierarchy" as const,
        operator: ">" as const,
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

  return {
    type: "term",
    text: cleanText,
    searchType: "text",
  };
};

/**
 * Extract search conditions from parsed expressions
 */
const extractSearchConditions = (
  expression: SearchTerm | CompoundExpression
): SearchCondition[] => {
  if (expression.type === "term") {
    const searchType = expression.searchType || "text";
    const matchType = searchType === "regex" ? "regex" : "contains";

    const condition: SearchCondition = {
      type: searchType,
      text: expression.text,
      matchType,
      semanticExpansion: false,
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
    return expression.operands.flatMap((operand) =>
      extractSearchConditions(operand)
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
      .map(operand => {
        const formatted = formatExpressionForDisplay(operand);
        // Add parentheses for nested compound expressions
        return operand.type === "compound" ? `(${formatted})` : formatted;
      })
      .join(operator);
  }
  
  return String(expression);
};

const findBlocksWithHierarchyImpl = async (
  input: z.infer<typeof schema>,
  state?: any
) => {
  const {
    contentConditions,
    hierarchyConditions,
    combineConditions,
    combineHierarchy,
    maxExpansions,
    expansionStrategy,
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
    maxHierarchyDepth,
    strategyCombination,
  } = input;

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
      `🚀 Processing hierarchical expression: "${hierarchicalExpression}"`
    );
    return await processHierarchicalExpression(
      hierarchicalExpression,
      {
        maxHierarchyDepth,
        strategyCombination,
        maxExpansions,
        expansionStrategy,
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
      },
      state
    );
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
    expansionStrategy,
    maxExpansions
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
    console.log(`🔧 Enriched ${hierarchyFilteredBlocks.length} blocks with hierarchical context`);
  } else {
    console.log(`⚡ Skipping enrichment (not explicitly requested) - performance optimized`);
  }

  // Step 5: Apply date range filtering
  let filteredResults = enrichedResults;
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
    filteredResults = filterByDateRange(enrichedResults, parsedDateRange);
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
    maxExpansions?: number;
    expansionStrategy?: string;
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
          semanticExpansion: false,
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
    parsedExpression.type === "deep_bidirectional"
  ) {
    return await processHierarchicalQuery(parsedExpression, options, state);
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
  const leftConditions = extractSearchConditions(expr.leftOperand);
  const rightConditions = extractSearchConditions(expr.rightOperand);
  const leftCombineLogic = getCombineLogic(expr.leftOperand);
  const rightCombineLogic = getCombineLogic(expr.rightOperand);

  const leftDisplay = formatExpressionForDisplay(expr.leftOperand);
  const rightDisplay = formatExpressionForDisplay(expr.rightOperand);
  console.log(
    `🔄 Processing ${expr.operator} with left: ${leftDisplay} (${leftCombineLogic}), right: ${rightDisplay} (${rightCombineLogic})`
  );

  // Show concise search info (no extra queries for performance)
  const leftTerms = formatExpressionForDisplay(expr.leftOperand);
  const rightTerms = formatExpressionForDisplay(expr.rightOperand);

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
      fromResultId: options.fromResultId,
      limitToBlockUids: options.limitToBlockUids,
      limitToPageUids: options.limitToPageUids,
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
  const leftTermText = leftConditions.map(c => c.text).join(leftCombineLogic === "OR" ? " | " : " + ");
  const rightTermText = rightConditions.map(c => c.text).join(rightCombineLogic === "OR" ? " | " : " + ");

  // Use direct content-filtered hierarchy search (like deep search does)
  console.log(`🔍 Building single Datomic query for parent→child with content filtering`);
  
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
  const leftTermText = leftConditions.map(c => c.text).join(leftCombineLogic === "OR" ? " | " : " + ");
  const rightTermText = rightConditions.map(c => c.text).join(rightCombineLogic === "OR" ? " | " : " + ");

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
  const leftTermText = leftConditions.map(c => c.text).join(leftCombineLogic === "OR" ? " | " : " + ");
  const rightTermText = rightConditions.map(c => c.text).join(rightCombineLogic === "OR" ? " | " : " + ");

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

  // Step 2: Hierarchy search (A parent of B) - only add if not already covered
  console.log(`🏗️ Step 2: Hierarchy search (A > B)`);
  const hierarchyResults = await searchBlocksWithHierarchicalConditions(
    leftConditions,
    leftCombineLogic,
    [
      {
        direction: "descendants" as const,
        levels: options.maxHierarchyDepth,
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
  const leftTermText = leftConditions.map(c => c.text).join(leftCombineLogic === "OR" ? " | " : " + ");
  const rightTermText = rightConditions.map(c => c.text).join(rightCombineLogic === "OR" ? " | " : " + ");

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
      const matchingChildUids = extractChildUids(result, rightConditions, rightCombineLogic);
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
    const matchingChildUids = extractChildUids(bBlock, leftConditions, leftCombineLogic);
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
  const leftTermText = leftConditions.map(c => c.text).join(leftCombineLogic === "OR" ? " | " : " + ");
  const rightTermText = rightConditions.map(c => c.text).join(rightCombineLogic === "OR" ? " | " : " + ");

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
      const matchingDescendantUids = extractChildUids(result, rightConditions, rightCombineLogic);
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
    const matchingDescendantUids = extractChildUids(bAncestor, leftConditions, leftCombineLogic);
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

  // Apply semantic expansion if requested
  const shouldExpand = parentConditions.some(c => c.semanticExpansion) || childConditions.some(c => c.semanticExpansion);
  const expandedParentConditions = shouldExpand 
    ? await expandConditions(parentConditions, options.expansionStrategy || "related_concepts", options.maxExpansions || 3)
    : parentConditions;
  const expandedChildConditions = shouldExpand
    ? await expandConditions(childConditions, options.expansionStrategy || "related_concepts", options.maxExpansions || 3)  
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

  // Add parent content filtering using DatomicQueryBuilder
  const parentQueryBuilder = new DatomicQueryBuilder(expandedParentConditions, parentCombineLogic);
  const { patternDefinitions: parentPatterns, conditionClauses: parentClauses } = 
    parentQueryBuilder.buildConditionClauses("?parent-content");
  query += parentPatterns;
  query += parentClauses;

  // Add child content filtering using DatomicQueryBuilder  
  const childQueryBuilder = new DatomicQueryBuilder(expandedChildConditions, childCombineLogic);
  const { patternDefinitions: childPatterns, conditionClauses: childClauses } = 
    childQueryBuilder.buildConditionClauses("?child-content");
  
  // Fix pattern variable conflicts by replacing pattern indices in child patterns
  const offsetChildPatterns = childPatterns.replace(/\?pattern(\d+)/g, (match, num) => 
    `?pattern${parseInt(num) + expandedParentConditions.length}`);
  const offsetChildClauses = childClauses.replace(/\?pattern(\d+)/g, (match, num) => 
    `?pattern${parseInt(num) + expandedParentConditions.length}`);
    
  query += offsetChildPatterns;
  query += offsetChildClauses;

  query += `]`;

  const hierarchyResults = await executeDatomicQuery(query);

  // Transform results to expected format (return parent blocks with child info)
  const parentBlocks = hierarchyResults.map(([
    parentUid, parentContent, parentPageTitle, parentPageUid,
    childUid, childContent, childPageTitle, childPageUid
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
    hierarchyRelationship: "direct_parent"
  }));

  // Apply hierarchy enrichment if requested
  // Note: Direct hierarchy search already provides the direct parent-child relationship,
  // so additional enrichment may not be necessary for most use cases
  if ((options.includeChildren === true && options.childDepth > 1) || 
      (options.includeParents === true && options.parentDepth > 1)) {
    try {
      // Convert to format expected by enrichWithFullHierarchy (array format)
      const arrayFormat = parentBlocks.map(block => [
        block.uid, block.content, block.pageTitle, block.pageUid
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
      semanticExpansion: cond.semanticExpansion || false,
      weight: cond.weight || 1,
      negate: cond.negate || false,
    })),
    hierarchyConditions,
    combineConditions,
    combineHierarchy,
    maxExpansions: options.maxExpansions || 3,
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
    input.contentConditions,
    input.expansionStrategy,
    input.maxExpansions
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
    (input.dateRange.start || input.dateRange.end) &&
    input.includeDaily
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
    filteredResults = filterByDateRange(enrichedResults, parsedDateRange);
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
  const checkFunction = combineLogic === "OR" ? conditions.some : conditions.every;
  
  return checkFunction.call(conditions, (condition) => {
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

/**
 * Build parent-child relationship mapping from results
 */
const buildParentChildMapping = (results: any[]): Map<string, string[]> => {
  const parentToChildren = new Map<string, string[]>();

  for (const result of results) {
    if (result.children && result.children.length > 0) {
      const childUids: string[] = [];

      const collectChildUids = (children: any[]) => {
        for (const child of children) {
          childUids.push(child.uid);
          if (child.children && child.children.length > 0) {
            collectChildUids(child.children);
          }
        }
      };

      collectChildUids(result.children);
      parentToChildren.set(result.uid, childUids);
    }
  }

  return parentToChildren;
};

/**
 * Expand content conditions with semantic terms
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
const buildConditionClause = (
  condition: any,
  index: number,
  isInOr: boolean = false
): string => {
  const indent = isInOr ? "                  " : "                ";
  let clause = "";

  switch (condition.type) {
    case "page_ref":
      // Use proper Roam :block/refs attribute instead of regex
      clause = `\n${indent}[?ref-page${index} :node/title "${condition.text}"]
${indent}[?b :block/refs ?ref-page${index}]`;
      break;

    case "block_ref":
      // Use proper Roam :block/refs attribute for block references
      clause = `\n${indent}[?ref-block${index} :block/uid "${condition.text}"]
${indent}[?b :block/refs ?ref-block${index}]`;
      break;

    case "regex":
      const sanitizedRegex = sanitizeRegexForDatomic(condition.text);
      const regexWithFlags = sanitizedRegex.isCaseInsensitive
        ? sanitizedRegex.pattern
        : `(?i)${sanitizedRegex.pattern}`;
      clause = `\n${indent}[(re-pattern "${regexWithFlags}") ?pattern${index}]
${indent}[(re-find ?pattern${index} ?content)]`;
      break;

    case "text":
    default:
      if (condition.matchType === "exact") {
        clause = `\n${indent}[(= ?content "${condition.text}")]`;
      } else if (condition.matchType === "regex") {
        const sanitizedTextRegex = sanitizeRegexForDatomic(condition.text);
        const textRegexWithFlags = sanitizedTextRegex.isCaseInsensitive
          ? sanitizedTextRegex.pattern
          : `(?i)${sanitizedTextRegex.pattern}`;
        clause = `\n${indent}[(re-pattern "${textRegexWithFlags}") ?pattern${index}]
${indent}[(re-find ?pattern${index} ?content)]`;
      } else {
        // Use case-insensitive regex without problematic escape characters
        // Remove any special regex characters to prevent escape issues
        const cleanText = condition.text.replace(/[.*+?^${}()|[\]\\]/g, "");
        if (cleanText === condition.text) {
          // No special characters, can use regex safely
          clause = `\n${indent}[(re-pattern "(?i).*${condition.text}.*") ?pattern${index}]
${indent}[(re-find ?pattern${index} ?content)]`;
        } else {
          // Has special characters, use case-sensitive includes as fallback
          clause = `\n${indent}[(clojure.string/includes? ?content "${condition.text}")]`;
        }
      }
      break;
  }

  if (condition.negate) {
    clause = `\n${indent}(not ${clause.trim()})`;
  }

  return clause;
};

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
    const [uid, content, time, pageTitle, pageUid] = block;

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
        const conditionResults = conditions.map((condition) => {
          return matchesCondition(blockContent, condition);
        });
        return conditionResults.every((r) => r);
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

export const findBlocksWithHierarchyTool = tool(
  async (input, config) => {
    const startTime = performance.now();
    // Extract state from config  
    const state = config?.configurable?.state;
    const isPrivateMode = state?.privateMode || input.secureMode;
    
    // Override enrichment parameters in private mode for performance and privacy
    const finalInput = isPrivateMode ? {
      ...input,
      includeChildren: false,
      includeParents: false,
      childDepth: 1,
      parentDepth: 1,
      secureMode: true
    } : input;
    
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
      "Find blocks using hierarchical expressions that define parent-child relationships. PERFECT for queries with expressions like 'Machine Learning > Deep Learning', 'AI Fundamentals >> Machine Learning', etc. Hierarchical operators: '>' (strict child), '>>' (deep descendants), '=>' (flexible: same block OR child), '<=>' (bidirectional), '<<=>> (deep bidirectional). Handles quoted terms correctly by automatically stripping quotes. Use hierarchicalExpression parameter with the exact expression from user query.",
    schema,
  }
);
