import { dnpUidRegex } from "../../../../utils/regex.js";
import { normalizePageTitle } from "../../../../utils/roamAPI.js";
import { modelViaLanggraph } from "../../langraphModelsLoader";
import { HumanMessage } from "@langchain/core/messages";
import { modelAccordingToProvider } from "../../../aiAPIsHub";
import { defaultModel } from "../../../..";

// Extend Window interface for TypeScript
declare global {
  interface Window {
    roamAlphaAPI: any;
  }
}

/**
 * Common utilities for ReAct Search Agent tools
 * Shared functions to reduce code duplication
 */

/**
 * Shared condition types for consistent handling across tools
 */
export interface SearchCondition {
  type: "text" | "page_ref" | "block_ref" | "regex";
  text: string;
  matchType?: "exact" | "contains" | "regex";
  semanticExpansion?: boolean;
  weight?: number;
  negate?: boolean;
}

/**
 * Shared Datomic Query Builder for search conditions
 * Handles proper OR clause structure to avoid "different free vars" errors
 */
export class DatomicQueryBuilder {
  private conditions: SearchCondition[] = [];
  private combineLogic: "AND" | "OR" = "AND";

  constructor(
    conditions: SearchCondition[],
    combineLogic: "AND" | "OR" = "AND"
  ) {
    this.conditions = conditions;
    this.combineLogic = combineLogic;
  }

  /**
   * Build condition clauses with proper OR structure and regex optimization
   * Returns: { patternDefinitions: string, conditionClauses: string }
   */
  buildConditionClauses(contentVariable: string = "?content"): {
    patternDefinitions: string;
    conditionClauses: string;
  } {
    if (this.combineLogic === "AND" || this.conditions.length === 1) {
      // For AND logic, combine both patterns and matches
      let combined = "";
      for (let i = 0; i < this.conditions.length; i++) {
        const condition = this.conditions[i];
        combined += this.buildPatternDefinition(condition, i);
        combined += this.buildMatchClause(condition, i, contentVariable);
      }
      return { patternDefinitions: "", conditionClauses: combined };
    } else {
      // For OR logic, check if we can optimize with regex
      const textConditions = this.conditions.filter(
        (c) => c.type === "text" && c.matchType !== "exact"
      );
      const pageRefConditions = this.conditions.filter(
        (c) => c.type === "page_ref"
      );
      const otherConditions = this.conditions.filter(
        (c) =>
          (c.type !== "text" && c.type !== "page_ref") ||
          (c.type === "text" && c.matchType === "exact")
      );

      if (
        textConditions.length > 1 &&
        otherConditions.length === 0 &&
        pageRefConditions.length === 0
      ) {
        // Pure text OR - optimize with single regex pattern
        return this.buildOptimizedTextOr(textConditions, contentVariable);
      } else if (
        pageRefConditions.length > 1 &&
        otherConditions.length === 0 &&
        textConditions.length === 0
      ) {
        // Pure page_ref OR - can potentially optimize, but for now use standard OR
        // TODO: Implement page_ref regex optimization in future
        return this.buildStandardOr(contentVariable);
      } else if (textConditions.length > 1) {
        // Mixed conditions - optimize text part, keep others separate
        return this.buildMixedConditions(
          textConditions,
          otherConditions.concat(pageRefConditions),
          contentVariable
        );
      } else {
        // Standard OR logic for non-optimizable conditions
        return this.buildStandardOr(contentVariable);
      }
    }
  }

  /**
   * Build optimized OR for pure text conditions using single regex
   */
  private buildOptimizedTextOr(
    textConditions: SearchCondition[],
    contentVariable: string
  ): {
    patternDefinitions: string;
    conditionClauses: string;
  } {
    // Combine all text patterns into single regex with | (OR)
    const patterns = textConditions.map((cond) => {
      const cleanText = cond.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // Escape regex chars
      return cond.matchType === "regex" ? cond.text : `.*${cleanText}.*`;
    });

    const combinedPattern = `(?i)(${patterns.join("|")})`;
    const patternDefinitions = `\n                [(re-pattern "${combinedPattern}") ?combined-pattern]`;
    const conditionClauses = `\n                [(re-find ?combined-pattern ${contentVariable})]`;

    console.log(
      `🚀 Optimized ${textConditions.length} text OR conditions into single regex: ${combinedPattern}`
    );

    return { patternDefinitions, conditionClauses };
  }

  /**
   * Build mixed conditions (optimized text OR + other conditions)
   */
  private buildMixedConditions(
    textConditions: SearchCondition[],
    otherConditions: SearchCondition[],
    contentVariable: string
  ): {
    patternDefinitions: string;
    conditionClauses: string;
  } {
    let patternDefinitions = "";
    let orClauses: string[] = [];

    // Add optimized text OR as one clause
    if (textConditions.length > 1) {
      const patterns = textConditions.map((cond) => {
        const cleanText = cond.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return cond.matchType === "regex" ? cond.text : `.*${cleanText}.*`;
      });
      const combinedPattern = `(?i)(${patterns.join("|")})`;
      patternDefinitions += `\n                [(re-pattern "${combinedPattern}") ?combined-pattern]`;
      orClauses.push(
        `\n                  [(re-find ?combined-pattern ${contentVariable})]`
      );
    }

    // Add other conditions
    for (let i = 0; i < otherConditions.length; i++) {
      const condition = otherConditions[i];
      const adjustedIndex = i + 1000; // Avoid conflicts with combined pattern
      patternDefinitions += this.buildPatternDefinition(
        condition,
        adjustedIndex
      );
      orClauses.push(
        this.buildMatchClause(condition, adjustedIndex, contentVariable, true)
      );
    }

    const conditionClauses = `\n                (or${orClauses.join(
      ""
    )}\n                )`;
    return { patternDefinitions, conditionClauses };
  }

  /**
   * Build standard OR clause (fallback)
   */
  private buildStandardOr(contentVariable: string): {
    patternDefinitions: string;
    conditionClauses: string;
  } {
    let patternDefinitions = "";
    let orClauses: string[] = [];

    for (let i = 0; i < this.conditions.length; i++) {
      const condition = this.conditions[i];
      patternDefinitions += this.buildPatternDefinition(condition, i);
      orClauses.push(
        this.buildMatchClause(condition, i, contentVariable, true)
      );
    }

    const conditionClauses = `\n                (or${orClauses.join(
      ""
    )}\n                )`;
    return { patternDefinitions, conditionClauses };
  }

  /**
   * Build pattern definitions (re-pattern clauses) that need to be outside OR
   */
  private buildPatternDefinition(
    condition: SearchCondition,
    index: number
  ): string {
    switch (condition.type) {
      case "regex":
        return `\n                [(re-pattern "${condition.text}") ?pattern${index}]`;

      case "text":
        if (condition.matchType === "regex") {
          return `\n                [(re-pattern "${condition.text}") ?pattern${index}]`;
        } else if (condition.matchType === "contains") {
          const cleanText = condition.text.replace(/[.*+?^${}()|[\]\\]/g, "");
          if (cleanText === condition.text) {
            return `\n                [(re-pattern "(?i).*${condition.text}.*") ?pattern${index}]`;
          }
        }
        return "";

      default:
        return "";
    }
  }

  /**
   * Build the matching clause (for use inside or outside OR)
   */
  private buildMatchClause(
    condition: SearchCondition,
    index: number,
    contentVariable: string,
    isInOr: boolean = false
  ): string {
    const indent = isInOr ? "                  " : "                ";
    let clause = "";

    switch (condition.type) {
      case "page_ref":
        clause = `\n${indent}[?ref-page${index} :node/title "${condition.text}"]
${indent}[?b :block/refs ?ref-page${index}]`;
        break;

      case "block_ref":
        clause = `\n${indent}[?ref-block${index} :block/uid "${condition.text}"]
${indent}[?b :block/refs ?ref-block${index}]`;
        break;

      case "regex":
        clause = `\n${indent}[(re-find ?pattern${index} ${contentVariable})]`;
        break;

      case "text":
        if (condition.matchType === "exact") {
          clause = `\n${indent}[(= ${contentVariable} "${condition.text}")]`;
        } else if (condition.matchType === "regex") {
          clause = `\n${indent}[(re-find ?pattern${index} ${contentVariable})]`;
        } else {
          const cleanText = condition.text.replace(/[.*+?^${}()|[\]\\]/g, "");
          if (cleanText === condition.text) {
            clause = `\n${indent}[(re-find ?pattern${index} ${contentVariable})]`;
          } else {
            clause = `\n${indent}[(clojure.string/includes? ${contentVariable} "${condition.text}")]`;
          }
        }
        break;
    }

    // Apply negation if needed
    if (condition.negate) {
      clause = `\n${indent}(not ${clause.trim()})`;
    }

    return clause;
  }
}

/**
 * Execute Datomic queries safely with error handling
 */
export const executeDatomicQuery = async (
  query: string,
  ...params: any[]
): Promise<any[]> => {
  try {
    console.log("🔍 Executing Datomic query:", query);
    if (params.length > 0) {
      console.log("🔍 Query params:", params);
    }

    if (typeof window === "undefined" || !window.roamAlphaAPI) {
      throw new Error("Roam API not available");
    }

    const result = window.roamAlphaAPI.q(query, ...params);
    console.log(
      "🔍 Query result:",
      result ? result.length + " results" : "No results"
    );
    return result || [];
  } catch (error) {
    console.error("🔍 Datomic query error:", error);
    console.error("🔍 Query that failed:", query);
    throw new Error(`Query execution failed: ${error.message}`);
  }
};

/**
 * Check if a UID is a Daily Note Page
 */
export const isDailyNote = (uid: string): boolean => {
  const dnpPattern = /^\d{2}-\d{2}-\d{4}$/;
  return dnpPattern.test(uid);
};

/**
 * Parse DNP UID to date (MM-DD-YYYY format)
 */
export const parseDNPDate = (uid: string): Date | null => {
  const match = uid.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;

  const [, month, day, year] = match;
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
};

/**
 * Generate semantic expansion terms using LLM
 */
export const generateSemanticExpansions = async (
  text: string,
  strategy: "synonyms" | "related_concepts" | "broader_terms",
  maxExpansions: number
): Promise<string[]> => {
  const strategyPrompts = {
    synonyms: `Generate ${maxExpansions} synonyms and alternative terms for: "${text}". Focus on words that mean the same thing.`,
    related_concepts: `Generate ${maxExpansions} related concepts and terms that are conceptually connected to: "${text}". Include related ideas and associated concepts.`,
    broader_terms: `Generate ${maxExpansions} broader, more general terms that encompass: "${text}". Think of categories or higher-level concepts.`,
  };

  const prompt = `${strategyPrompts[strategy]}

IMPORTANT: Respond in the SAME LANGUAGE as the input term "${text}". If the input is in English, respond in English and so on for any other language.

Requirements:
- Return only the terms themselves, one per line
- No explanations, numbers, or bullet points
- Focus on terms that would likely appear in page titles or content
- Avoid very generic terms (like "thing", "item" or equivalent in other languages)
- Consider both single words and short phrases (2-4 words max)
- Terms should be relevant for knowledge management and note-taking
- CRITICAL: Do NOT include terms that contain the original word "${text}" - provide genuinely different alternatives

Example for "machine learning":
neural networks
artificial intelligence
data science
algorithms
predictive modeling`;

  try {
    const modelInfo = modelAccordingToProvider(defaultModel);
    const llm = modelViaLanggraph(
      modelInfo,
      { input_tokens: 0, output_tokens: 0 },
      false
    );

    const response = await llm.invoke([new HumanMessage(prompt)]);

    const terms = response.content
      .toString()
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) => line.length > 0 && !line.match(/^\d+\./) && line.length < 50
      )
      .filter((term) => {
        // Filter out terms that contain the original search word to avoid redundancy
        const originalLower = text.toLowerCase();
        const termLower = term.toLowerCase();
        return !termLower.includes(originalLower);
      })
      .slice(0, maxExpansions);

    console.log(
      `🔍 Generated ${terms.length} semantic expansions for "${text}":`,
      terms
    );
    return terms;
  } catch (error) {
    console.error("Failed to generate semantic expansions:", error);
    throw new Error(`Semantic expansion failed: ${error.message}`);
  }
};

/**
 * Filter pages/blocks by date range for DNPs
 */
export const filterByDateRange = <
  T extends { uid?: string; pageUid?: string; isDaily?: boolean }
>(
  results: T[],
  dateRange: { start?: Date; end?: Date }
): T[] => {
  return results.filter((result) => {
    const uid = result.pageUid || result.uid;
    const isDaily = result.isDaily ?? (uid ? isDailyNote(uid) : false);

    if (!isDaily) return true; // Keep non-DNPs

    try {
      const pageDate = parseDNPDate(uid!);
      if (!pageDate) return true; // Keep if we can't parse the date

      const isInRange =
        (!dateRange.start || pageDate >= dateRange.start) &&
        (!dateRange.end || pageDate <= dateRange.end);
      return isInRange;
    } catch (error) {
      console.warn("Error parsing DNP date for UID:", uid);
      return true; // Keep if there's an error
    }
  });
};

/**
 * Generate intelligent search guidance based on tool results
 */
const generateSearchGuidance = (
  data?: any,
  metadata?: any,
  toolName?: string
) => {
  if (!data || !Array.isArray(data)) return null;

  const resultCount = data.length;
  const suggestions: string[] = [];

  if (resultCount === 0) {
    suggestions.push(
      "try_semantic_expansion",
      "broaden_search_terms",
      "check_spelling"
    );
  } else if (resultCount < 3) {
    suggestions.push("consider_semantic_expansion", "try_related_concepts");
  } else if (resultCount > 50 && toolName === "findBlocksByContent") {
    suggestions.push("consider_extractPageReferences_for_analysis");
  } else if (
    resultCount > 20 &&
    (toolName === "findPagesByContent" || toolName === "findPagesByTitle")
  ) {
    suggestions.push("results_look_comprehensive");
  }

  // Add tool-specific suggestions based on current tool
  if (toolName === "findBlocksByContent" && resultCount > 5) {
    suggestions.push("try_combineResults_for_complex_queries");
  } else if (toolName === "findPagesByTitle" && resultCount < 5) {
    suggestions.push("try_findPagesSemantically_for_discovery");
  }

  return {
    resultQuality:
      resultCount === 0
        ? "no_results"
        : resultCount < 3
        ? "sparse"
        : resultCount < 20
        ? "good"
        : "abundant",
    nextSuggestions: suggestions,
    expandable: metadata?.wasLimited || false,
  };
};

/**
 * Deduplicate search results by UID to prevent duplicate entries
 * Essential for handling multiple tool calls that return overlapping results
 */
export const deduplicateResultsByUid = (results: any[], debugContext = "unknown"): any[] => {
  if (!Array.isArray(results)) return results;
  
  const seenUids = new Set<string>();
  const deduplicated = results.filter(result => {
    const uid = result?.uid || result?.pageUid;
    if (!uid) return true; // Keep items without UIDs
    
    if (seenUids.has(uid)) {
      console.log(`🔄 [${debugContext}] Deduplicating duplicate UID: ${uid}`);
      return false; // Skip duplicate
    }
    
    seenUids.add(uid);
    return true;
  });
  
  if (deduplicated.length !== results.length) {
    console.log(`🔄 [${debugContext}] Deduplicated ${results.length} results to ${deduplicated.length} unique items`);
  }
  
  return deduplicated;
};

/**
 * Create standardized tool execution result with enhanced guidance
 */
export const createToolResult = (
  success: boolean,
  data?: any,
  error?: string,
  toolName?: string,
  startTime?: number,
  metadata?: any
) => {
  // Generate intelligent search guidance
  const searchGuidance = success
    ? generateSearchGuidance(data, metadata, toolName)
    : null;

  const result = {
    success,
    data,
    error,
    toolName,
    executionTime: startTime ? performance.now() - startTime : 0,
    ...(metadata && { metadata: { ...metadata, searchGuidance } }),
  };

  console.log(`🔧 ${toolName} result:`, {
    success,
    dataType: data ? typeof data : "none",
    dataSize: Array.isArray(data) ? data.length : data ? 1 : 0,
    error: error || "none",
    executionTime: result.executionTime,
    guidance: searchGuidance?.resultQuality || "none",
  });

  // Return JSON string for LangGraph ToolNode compatibility
  try {
    return JSON.stringify(result, null, 2);
  } catch (jsonError) {
    console.error(`🔧 ${toolName} JSON serialization error:`, jsonError);
    return JSON.stringify({
      success: false,
      error: `Serialization failed: ${jsonError.message}`,
      toolName,
      executionTime: result.executionTime,
    });
  }
};

/**
 * Truncate content to specified length
 */
export const truncateContent = (content: string, maxLength: number): string => {
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength) + "...";
};

/**
 * Get child blocks up to specified depth
 */
export const getBlockChildren = async (
  parentUid: string,
  maxDepth: number,
  secureMode: boolean = false
): Promise<any[]> => {
  if (maxDepth <= 0) return [];

  const query = `[:find ?uid ?content ?order ?page-title ?page-uid
                 :where 
                 [?parent :block/uid "${parentUid}"]
                 [?parent :block/children ?child]
                 [?child :block/uid ?uid]
                 [?child :block/string ?content]
                 [?child :block/order ?order]
                 [?child :block/page ?page]
                 [?page :node/title ?page-title]
                 [?page :block/uid ?page-uid]]`;

  try {
    const children = await executeDatomicQuery(query);

    // Sort by order
    children.sort((a, b) => a[2] - b[2]);

    // If we need more depth, recursively get grandchildren
    if (maxDepth > 1) {
      for (const child of children) {
        const grandchildren = await getBlockChildren(
          child[0],
          maxDepth - 1,
          secureMode
        );
        child.push(grandchildren);
      }
    }

    return children.map(
      ([uid, content, order, pageTitle, pageUid, grandchildren]) => ({
        uid,
        content: secureMode ? undefined : content,
        order,
        pageTitle,
        pageUid,
        isDaily: isDailyNote(pageUid),
        children: grandchildren || [],
      })
    );
  } catch (error) {
    console.warn(`Failed to get children for block ${parentUid}:`, error);
    return [];
  }
};

/**
 * Get parent blocks up to specified depth
 */
export const getBlockParents = async (
  childUid: string,
  maxDepth: number,
  secureMode: boolean = false
): Promise<any[]> => {
  if (maxDepth <= 0) return [];

  const query = `[:find ?uid ?content ?page-title ?page-uid
                 :where 
                 [?child :block/uid "${childUid}"]
                 [?parent :block/children ?child]
                 [?parent :block/uid ?uid]
                 [?parent :block/string ?content]
                 [?parent :block/page ?page]
                 [?page :node/title ?page-title]
                 [?page :block/uid ?page-uid]]`;

  try {
    const parents = await executeDatomicQuery(query);

    // If we need more depth, recursively get grandparents
    if (maxDepth > 1 && parents.length > 0) {
      const grandparents = await getBlockParents(
        parents[0][0],
        maxDepth - 1,
        secureMode
      );
      return [
        ...grandparents,
        ...parents.map(([uid, content, pageTitle, pageUid]) => ({
          uid,
          content: secureMode ? undefined : truncateContent(content, 50),
          pageTitle,
          pageUid,
          isDaily: isDailyNote(pageUid),
        })),
      ];
    }

    return parents.map(([uid, content, pageTitle, pageUid]) => ({
      uid,
      content: secureMode ? undefined : truncateContent(content, 50),
      pageTitle,
      pageUid,
      isDaily: isDailyNote(pageUid),
    }));
  } catch (error) {
    console.warn(`Failed to get parents for block ${childUid}:`, error);
    return [];
  }
};

/**
 * Fuzzy string matching utilities for typo tolerance
 */

/**
 * Calculate Levenshtein distance between two strings
 */
const levenshteinDistance = (str1: string, str2: string): number => {
  const matrix = Array(str2.length + 1)
    .fill(null)
    .map(() => Array(str1.length + 1).fill(0));

  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // insertion
        matrix[j - 1][i] + 1, // deletion
        matrix[j - 1][i - 1] + cost // substitution
      );
    }
  }

  return matrix[str2.length][str1.length];
};

/**
 * Check if two strings match within a fuzzy threshold
 */
export const fuzzyMatch = (
  text1: string,
  text2: string,
  threshold: number = 0.8
): boolean => {
  const str1 = text1.toLowerCase().trim();
  const str2 = text2.toLowerCase().trim();

  // Quick exact match check
  if (str1 === str2) return true;

  // Calculate similarity based on Levenshtein distance
  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);

  // Handle edge case of empty strings
  if (maxLength === 0) return true;

  const similarity = 1 - distance / maxLength;
  return similarity >= threshold;
};

/**
 * Find fuzzy matches in an array of strings
 */
export const findFuzzyMatches = (
  searchTerm: string,
  candidates: string[],
  threshold: number = 0.8,
  maxResults: number = 10
): { text: string; score: number }[] => {
  const matches: { text: string; score: number }[] = [];

  for (const candidate of candidates) {
    const str1 = searchTerm.toLowerCase().trim();
    const str2 = candidate.toLowerCase().trim();

    if (str1 === str2) {
      matches.push({ text: candidate, score: 1.0 });
      continue;
    }

    const distance = levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);

    if (maxLength === 0) continue;

    const score = 1 - distance / maxLength;
    if (score >= threshold) {
      matches.push({ text: candidate, score });
    }
  }

  // Sort by score (highest first) and limit results
  return matches.sort((a, b) => b.score - a.score).slice(0, maxResults);
};

/**
 * Enhanced result processing utilities for token optimization
 */

// Seeded random number generator for reproducible sampling
export const createSeededRandom = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 0x100000000;
    return state / 0x100000000;
  };
};

/**
 * Random sampling utility with optional seeding
 */
export const sampleResults = <T>(
  results: T[],
  sampleSize: number,
  seed?: number
): T[] => {
  if (results.length <= sampleSize) return results;

  // Use seeded random for reproducible results
  const rng = seed ? createSeededRandom(seed) : Math.random;
  return results
    .map((item) => ({ item, sort: rng() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, sampleSize)
    .map(({ item }) => item);
};

/**
 * Universal sorting utility for blocks and pages
 */
export const sortResults = <T extends any>(
  results: T[],
  sortBy: "creation" | "modification" | "alphabetical" | "relevance" | "random",
  sortOrder: "asc" | "desc" = "desc",
  seed?: number
): T[] => {
  if (sortBy === "random") {
    return sampleResults(results, results.length, seed);
  }

  return results.sort((a: any, b: any) => {
    let comparison = 0;

    switch (sortBy) {
      case "creation":
        const aCreated = a.created || new Date(0);
        const bCreated = b.created || new Date(0);
        comparison = aCreated.getTime() - bCreated.getTime();
        break;

      case "modification":
        const aModified = a.modified || a.created || new Date(0);
        const bModified = b.modified || b.created || new Date(0);
        comparison = aModified.getTime() - bModified.getTime();
        break;

      case "alphabetical":
        const aText = a.title || a.content || a.pageTitle || "";
        const bText = b.title || b.content || b.pageTitle || "";
        comparison = aText.localeCompare(bText);
        break;

      case "relevance":
        const aScore = a.relevanceScore || a.matchedConditions?.length || 0;
        const bScore = b.relevanceScore || b.matchedConditions?.length || 0;
        comparison = bScore - aScore; // Higher relevance first
        break;

      default:
        comparison = 0;
    }

    return sortOrder === "desc" ? -comparison : comparison;
  });
};

/**
 * Apply enhanced limits based on security mode
 */
export const getEnhancedLimits = (
  securityMode: "private" | "balanced" | "full"
) => {
  switch (securityMode) {
    case "private":
      return {
        maxResults: 50000, // 10x increase from 5000
        defaultLimit: 1000, // 10x increase from 100
        summaryLimit: 100, // For LLM context
      };
    case "balanced":
      return {
        maxResults: 10000, // 10x increase from 1000
        defaultLimit: 500, // 5x increase from 100
        summaryLimit: 50, // For LLM context
      };
    case "full":
      return {
        maxResults: 3000, // 10x increase from 300
        defaultLimit: 300, // Same as before
        summaryLimit: 20, // For LLM context
      };
    default:
      return {
        maxResults: 1000,
        defaultLimit: 100,
        summaryLimit: 20,
      };
  }
};

/**
 * Process results with enhanced sorting, sampling, and limits
 */
export const processEnhancedResults = <T>(
  results: T[],
  options: {
    sortBy?:
      | "creation"
      | "modification"
      | "alphabetical"
      | "relevance"
      | "random";
    sortOrder?: "asc" | "desc";
    limit?: number;
    randomSample?: {
      enabled: boolean;
      size: number;
      seed?: number;
    };
    securityMode?: "private" | "balanced" | "full";
  } = {}
): {
  data: T[];
  metadata: {
    totalFound: number;
    returnedCount: number;
    wasLimited: boolean;
    sortedBy?: string;
    sampled?: boolean;
    availableCount: number;
  };
} => {
  const {
    sortBy = "relevance",
    sortOrder = "desc",
    limit,
    randomSample,
    securityMode = "balanced",
  } = options;

  let processedResults = [...results];
  const totalFound = results.length;

  // Apply sorting
  if (sortBy !== "random" || !randomSample?.enabled) {
    processedResults = sortResults(
      processedResults,
      sortBy,
      sortOrder,
      randomSample?.seed
    );
  }

  // Apply random sampling if requested
  let wasRandomSampled = false;
  if (randomSample?.enabled && randomSample.size < processedResults.length) {
    processedResults = sampleResults(
      processedResults,
      randomSample.size,
      randomSample.seed
    );
    wasRandomSampled = true;
  }

  // Apply final limit
  const enhancedLimits = getEnhancedLimits(securityMode);
  const finalLimit = limit || enhancedLimits.defaultLimit;
  const wasLimited = processedResults.length > finalLimit;

  if (wasLimited) {
    processedResults = processedResults.slice(0, finalLimit);
  }

  return {
    data: processedResults,
    metadata: {
      totalFound,
      returnedCount: processedResults.length,
      wasLimited: wasLimited || wasRandomSampled,
      sortedBy: sortBy,
      sampled: wasRandomSampled,
      availableCount: totalFound,
    },
  };
};

/**
 * Extract UIDs from previous results and user-provided arrays
 * Centralized utility to prevent code duplication across tools
 */
export const extractUidsFromResults = (
  fromResultId: string | undefined,
  limitToBlockUids: string[] | undefined,
  limitToPageUids: string[] | undefined,
  state: any
): { blockUids: string[], pageUids: string[] } => {
  let finalBlockUids = limitToBlockUids || [];
  let finalPageUids = limitToPageUids || [];
  
  // Extract UIDs from previous results if fromResultId is provided
  if (fromResultId && state?.resultStore) {
    console.log(`🔍 Extracting UIDs from previous result: ${fromResultId}`);
    const resultEntry = state.resultStore[fromResultId];
    if (!resultEntry) {
      const availableResults = Object.keys(state.resultStore || {});
      throw new Error(`Previous result ${fromResultId} not found. Available results: ${availableResults.join(', ')}`);
    }
    
    const previousResult = resultEntry?.data || resultEntry;
    if (Array.isArray(previousResult)) {
      for (const item of previousResult) {
        if (item.uid) {
          if (item.content !== undefined || item.pageTitle) {
            // This is a block result
            finalBlockUids.push(item.uid);
          } else if (item.title || item.isPage) {
            // This is a page result - convert to page UID for filtering
            finalPageUids.push(item.uid);
          }
        }
        if (item.pageUid && !finalPageUids.includes(item.pageUid)) {
          finalPageUids.push(item.pageUid);
        }
      }
      console.log(`🔍 Extracted from previous result: ${finalBlockUids.length} blockUids, ${finalPageUids.length} pageUids`);
    }
  }
  
  // Add user-provided UIDs
  if (limitToBlockUids) {
    console.log(`🔍 Added ${limitToBlockUids.length} user-provided block UIDs`);
  }
  if (limitToPageUids) {
    console.log(`🔍 Added ${limitToPageUids.length} user-provided page UIDs`);
  }
  
  // Remove duplicates
  finalBlockUids = [...new Set(finalBlockUids)];
  finalPageUids = [...new Set(finalPageUids)];

  return { blockUids: finalBlockUids, pageUids: finalPageUids };
};

/**
 * Sanitize page references to fix LLM parsing errors
 * LLMs sometimes add extra [[ ]] brackets or fail to remove them
 * Also fixes double interpretation (page_ref + limitToPages for same page)
 */
export const sanitizePageReferences = (parsedComponents: any): any => {
  if (!parsedComponents) return parsedComponents;
  
  const sanitized = { ...parsedComponents };
  
  // Fix page references
  if (sanitized.pageReferences?.length > 0) {
    sanitized.pageReferences = sanitized.pageReferences.map((ref: any) => ({
      ...ref,
      text: normalizePageTitle(ref.text)
    }));
  }
  
  // Fix limitToPages in constraints
  if (sanitized.constraints?.limitToPages?.length > 0) {
    sanitized.constraints.limitToPages = sanitized.constraints.limitToPages.map(
      (page: string) => normalizePageTitle(page)
    );
  }
  
  // Fix sub-queries page_ref conditions
  if (sanitized.subQueries?.length > 0) {
    sanitized.subQueries = sanitized.subQueries.map((query: any) => ({
      ...query,
      conditions: query.conditions?.map((condition: any) => 
        condition.type === 'page_ref' 
          ? { ...condition, text: normalizePageTitle(condition.text) }
          : condition
      ) || []
    }));
  }
  
  // CRITICAL FIX: Prevent double interpretation
  // If we have pageReferences, remove them from limitToPages to avoid double constraint
  if (sanitized.pageReferences?.length > 0 && sanitized.constraints?.limitToPages?.length > 0) {
    const referencedPages = sanitized.pageReferences.map((ref: any) => ref.text.toLowerCase());
    const originalLimitCount = sanitized.constraints.limitToPages.length;
    
    sanitized.constraints.limitToPages = sanitized.constraints.limitToPages.filter(
      (page: string) => !referencedPages.includes(page.toLowerCase())
    );
    
    const removedCount = originalLimitCount - sanitized.constraints.limitToPages.length;
    if (removedCount > 0) {
      console.log(`🧹 [PageRefSanitizer] Removed ${removedCount} duplicate pages from limitToPages to prevent double interpretation`);
      
      // If no pages left in limitToPages, remove the constraint entirely
      if (sanitized.constraints.limitToPages.length === 0) {
        delete sanitized.constraints.limitToPages;
      }
    }
  }
  
  return sanitized;
};
