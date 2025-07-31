import { dnpUidRegex } from "../../../../utils/regex.js";
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

  constructor(conditions: SearchCondition[], combineLogic: "AND" | "OR" = "AND") {
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
      const textConditions = this.conditions.filter(c => c.type === "text" && c.matchType !== "exact");
      const pageRefConditions = this.conditions.filter(c => c.type === "page_ref");
      const otherConditions = this.conditions.filter(c => 
        c.type !== "text" && c.type !== "page_ref" || (c.type === "text" && c.matchType === "exact")
      );

      if (textConditions.length > 1 && otherConditions.length === 0 && pageRefConditions.length === 0) {
        // Pure text OR - optimize with single regex pattern
        return this.buildOptimizedTextOr(textConditions, contentVariable);
      } else if (pageRefConditions.length > 1 && otherConditions.length === 0 && textConditions.length === 0) {
        // Pure page_ref OR - can potentially optimize, but for now use standard OR
        // TODO: Implement page_ref regex optimization in future
        return this.buildStandardOr(contentVariable);
      } else if (textConditions.length > 1) {
        // Mixed conditions - optimize text part, keep others separate
        return this.buildMixedConditions(textConditions, otherConditions.concat(pageRefConditions), contentVariable);
      } else {
        // Standard OR logic for non-optimizable conditions
        return this.buildStandardOr(contentVariable);
      }
    }
  }

  /**
   * Build optimized OR for pure text conditions using single regex
   */
  private buildOptimizedTextOr(textConditions: SearchCondition[], contentVariable: string): {
    patternDefinitions: string;
    conditionClauses: string;
  } {
    // Combine all text patterns into single regex with | (OR)
    const patterns = textConditions.map(cond => {
      const cleanText = cond.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex chars
      return cond.matchType === "regex" ? cond.text : `.*${cleanText}.*`;
    });

    const combinedPattern = `(?i)(${patterns.join('|')})`;
    const patternDefinitions = `\n                [(re-pattern "${combinedPattern}") ?combined-pattern]`;
    const conditionClauses = `\n                [(re-find ?combined-pattern ${contentVariable})]`;

    console.log(`🚀 Optimized ${textConditions.length} text OR conditions into single regex: ${combinedPattern}`);
    
    return { patternDefinitions, conditionClauses };
  }

  /**
   * Build mixed conditions (optimized text OR + other conditions)
   */
  private buildMixedConditions(textConditions: SearchCondition[], otherConditions: SearchCondition[], contentVariable: string): {
    patternDefinitions: string;
    conditionClauses: string;
  } {
    let patternDefinitions = "";
    let orClauses: string[] = [];

    // Add optimized text OR as one clause
    if (textConditions.length > 1) {
      const patterns = textConditions.map(cond => {
        const cleanText = cond.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return cond.matchType === "regex" ? cond.text : `.*${cleanText}.*`;
      });
      const combinedPattern = `(?i)(${patterns.join('|')})`;
      patternDefinitions += `\n                [(re-pattern "${combinedPattern}") ?combined-pattern]`;
      orClauses.push(`\n                  [(re-find ?combined-pattern ${contentVariable})]`);
    }

    // Add other conditions
    for (let i = 0; i < otherConditions.length; i++) {
      const condition = otherConditions[i];
      const adjustedIndex = i + 1000; // Avoid conflicts with combined pattern
      patternDefinitions += this.buildPatternDefinition(condition, adjustedIndex);
      orClauses.push(this.buildMatchClause(condition, adjustedIndex, contentVariable, true));
    }

    const conditionClauses = `\n                (or${orClauses.join('')}\n                )`;
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
      orClauses.push(this.buildMatchClause(condition, i, contentVariable, true));
    }

    const conditionClauses = `\n                (or${orClauses.join('')}\n                )`;
    return { patternDefinitions, conditionClauses };
  }

  /**
   * Build pattern definitions (re-pattern clauses) that need to be outside OR
   */
  private buildPatternDefinition(condition: SearchCondition, index: number): string {
    switch (condition.type) {
      case "regex":
        return `\n                [(re-pattern "${condition.text}") ?pattern${index}]`;

      case "text":
        if (condition.matchType === "regex") {
          return `\n                [(re-pattern "${condition.text}") ?pattern${index}]`;
        } else if (condition.matchType === "contains") {
          const cleanText = condition.text.replace(/[.*+?^${}()|[\]\\]/g, '');
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
          const cleanText = condition.text.replace(/[.*+?^${}()|[\]\\]/g, '');
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
    console.log("🔍 Query result:", result ? result.length + " results" : "No results");
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

Requirements:
- Return only the terms themselves, one per line
- No explanations, numbers, or bullet points
- Focus on terms that would likely appear in page titles or content
- Avoid very generic terms like "thing", "stuff", "item"
- Consider both single words and short phrases (2-4 words max)
- Terms should be relevant for knowledge management and note-taking

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
      .slice(0, maxExpansions);

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
 * Create standardized tool execution result
 */
export const createToolResult = (
  success: boolean,
  data?: any,
  error?: string,
  toolName?: string,
  startTime?: number,
  metadata?: any
) => {
  const result = {
    success,
    data,
    error,
    toolName,
    executionTime: startTime ? performance.now() - startTime : 0,
    ...(metadata && { metadata }),
  };
  
  console.log(`🔧 ${toolName} result:`, {
    success,
    dataType: data ? typeof data : 'none',
    dataSize: Array.isArray(data) ? data.length : data ? 1 : 0,
    error: error || 'none',
    executionTime: result.executionTime
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
      executionTime: result.executionTime
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
        const grandchildren = await getBlockChildren(child[0], maxDepth - 1, secureMode);
        child.push(grandchildren);
      }
    }

    return children.map(([uid, content, order, pageTitle, pageUid, grandchildren]) => ({
      uid,
      content: secureMode ? undefined : content,
      order,
      pageTitle,
      pageUid,
      isDaily: isDailyNote(pageUid),
      children: grandchildren || [],
    }));
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
      const grandparents = await getBlockParents(parents[0][0], maxDepth - 1, secureMode);
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
