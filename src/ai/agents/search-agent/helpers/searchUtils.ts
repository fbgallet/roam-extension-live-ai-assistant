import { dnpUidRegex } from "../../../../utils/regex.js";
import { normalizePageTitle } from "../../../../utils/roamAPI.js";
import { modelViaLanggraph } from "../../langraphModelsLoader";
import { HumanMessage } from "@langchain/core/messages";
import { modelAccordingToProvider } from "../../../aiAPIsHub.js";
import { defaultModel } from "../../../../index.js";

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
 * Parse semantic expansion from condition text based on suffix symbols
 * @param text - The condition text (e.g., "pend*", "car~", "hello")
 * @param globalSemanticExpansion - The global semantic expansion strategy (excluding "fuzzy")
 * @returns Object with cleanText and expansionType
 */
export function parseSemanticExpansion(
  text: string,
  globalSemanticExpansion?: string
): { cleanText: string; expansionType: string | null } {
  // Check for '*' suffix (fuzzy expansion)
  if (text.endsWith("*")) {
    return {
      cleanText: text.replace(/\*+$/, ""), // Remove trailing *
      expansionType: "fuzzy",
    };
  }

  // Check for '~all' suffix (all semantic strategies)
  if (text.endsWith("~all")) {
    return {
      cleanText: text.replace(/~all$/, ""), // Remove trailing ~all
      expansionType: "all",
    };
  }

  // Check for '~' suffix (use global semantic expansion, but not fuzzy)
  if (text.endsWith("~")) {
    return {
      cleanText: text.replace(/~+$/, ""), // Remove trailing ~
      expansionType: globalSemanticExpansion || "synonyms", // Default to synonyms if no global strategy
    };
  }

  // No suffix - no semantic expansion for this condition
  return {
    cleanText: text,
    expansionType: null,
  };
}

/**
 * Shared condition types for consistent handling across tools
 */
export interface SearchCondition {
  type: "text" | "page_ref" | "block_ref" | "regex" | "page_ref_or";
  text: string;
  matchType?: "exact" | "contains" | "regex";
  semanticExpansion?:
    | "fuzzy"
    | "synonyms"
    | "related_concepts"
    | "broader_terms"
    | "custom"
    | "all";
  weight?: number;
  negate?: boolean;
  regexFlags?: string;
  pageNames?: string[]; // For page_ref_or type - array of page names
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
   * Build mixed conditions (optimized text OR + other conditions) with consistent variable naming
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
    let conditionClauses = "";
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

    // Group other conditions by type to use consistent variable names
    const pageRefConditions = otherConditions.filter(
      (c) => c.type === "page_ref"
    );
    const blockRefConditions = otherConditions.filter(
      (c) => c.type === "block_ref"
    );
    const remainingConditions = otherConditions.filter(
      (c) => c.type !== "page_ref" && c.type !== "block_ref"
    );

    // Handle page references with consistent variable naming
    if (pageRefConditions.length > 0) {
      // Add the common block reference constraint outside the OR
      conditionClauses += `\n                [?b :block/refs ?ref-page]`;

      // Add page title constraints inside the OR
      for (const condition of pageRefConditions) {
        orClauses.push(this.buildPageRefClause(condition, contentVariable));
      }
    }

    // Handle block references with consistent variable naming
    if (blockRefConditions.length > 0) {
      // Add the common block reference constraint outside the OR
      conditionClauses += `\n                [?b :block/refs ?ref-block]`;

      // Add block UID constraints inside the OR
      for (const condition of blockRefConditions) {
        orClauses.push(this.buildBlockRefClause(condition, contentVariable));
      }
    }

    // Handle remaining conditions with individual indices
    for (let i = 0; i < remainingConditions.length; i++) {
      const condition = remainingConditions[i];
      const adjustedIndex = i + 1000; // Avoid conflicts with combined pattern
      patternDefinitions += this.buildPatternDefinition(
        condition,
        adjustedIndex
      );
      orClauses.push(
        this.buildMatchClause(condition, adjustedIndex, contentVariable, true)
      );
    }

    // Add the OR clause if we have any conditions
    if (orClauses.length > 0) {
      conditionClauses += `\n                (or${orClauses.join(
        ""
      )}\n                )`;
    }

    return { patternDefinitions, conditionClauses };
  }

  /**
   * Build standard OR clause with consistent variable naming
   */
  private buildStandardOr(contentVariable: string): {
    patternDefinitions: string;
    conditionClauses: string;
  } {
    let patternDefinitions = "";
    let conditionClauses = "";
    let orClauses: string[] = [];

    // Group conditions by type to use consistent variable names
    const pageRefConditions = this.conditions.filter(
      (c) => c.type === "page_ref"
    );
    const blockRefConditions = this.conditions.filter(
      (c) => c.type === "block_ref"
    );
    const otherConditions = this.conditions.filter(
      (c) => c.type !== "page_ref" && c.type !== "block_ref"
    );

    // Handle page references with consistent variable naming
    if (pageRefConditions.length > 0) {
      // Add the common block reference constraint outside the OR
      conditionClauses += `\n                [?b :block/refs ?ref-page]`;

      // Add page title constraints inside the OR
      for (let i = 0; i < pageRefConditions.length; i++) {
        const condition = pageRefConditions[i];
        orClauses.push(this.buildPageRefClause(condition, contentVariable));
      }
    }

    // Handle block references with consistent variable naming
    if (blockRefConditions.length > 0) {
      // Add the common block reference constraint outside the OR
      conditionClauses += `\n                [?b :block/refs ?ref-block]`;

      // Add block UID constraints inside the OR
      for (let i = 0; i < blockRefConditions.length; i++) {
        const condition = blockRefConditions[i];
        orClauses.push(this.buildBlockRefClause(condition, contentVariable));
      }
    }

    // Handle other conditions with individual indices
    for (let i = 0; i < otherConditions.length; i++) {
      const condition = otherConditions[i];
      const adjustedIndex = i + 2000; // High index to avoid conflicts
      patternDefinitions += this.buildPatternDefinition(
        condition,
        adjustedIndex
      );
      orClauses.push(
        this.buildMatchClause(condition, adjustedIndex, contentVariable, true)
      );
    }

    // Add the OR clause if we have any conditions
    if (orClauses.length > 0) {
      conditionClauses += `\n                (or${orClauses.join(
        ""
      )}\n                )`;
    }

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
      case "page_ref_or":
        // No pattern definition needed for page reference OR - handled directly in match clause
        return "";
      case "regex":
        const sanitizedRegex = sanitizeRegexForDatomic(condition.text);
        // Use custom flags if provided, otherwise fall back to case-insensitive default
        let regexWithFlags;
        if (condition.regexFlags !== undefined) {
          regexWithFlags = condition.regexFlags
            ? `(?${condition.regexFlags})${sanitizedRegex.pattern}`
            : sanitizedRegex.pattern;
        } else {
          regexWithFlags = sanitizedRegex.isCaseInsensitive
            ? sanitizedRegex.pattern
            : `(?i)${sanitizedRegex.pattern}`;
        }
        return `\n                [(re-pattern "${regexWithFlags}") ?pattern${index}]`;

      case "text":
        if (condition.matchType === "regex") {
          const sanitizedTextRegex = sanitizeRegexForDatomic(condition.text);
          const textRegexWithFlags = sanitizedTextRegex.isCaseInsensitive
            ? sanitizedTextRegex.pattern
            : `(?i)${sanitizedTextRegex.pattern}`;
          return `\n                [(re-pattern "${textRegexWithFlags}") ?pattern${index}]`;
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
      case "page_ref_or":
        // Handle OR of multiple page references
        const pageNames =
          (condition as any).pageNames || condition.text.split("|");
        const orClauses = pageNames
          .map(
            (pageName: string, i: number) =>
              `\n${indent}  [?ref-page${index}-${i} :node/title "${pageName.trim()}"]
${indent}  [?b :block/refs ?ref-page${index}-${i}]`
          )
          .join("");
        clause = `\n${indent}(or${orClauses}
${indent})`;
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

  /**
   * Build page reference clause with consistent variable naming for OR queries
   */
  private buildPageRefClause(
    condition: SearchCondition,
    _contentVariable: string
  ): string {
    const indent = "                  ";
    // For OR context, only include the page title constraint
    // The block reference constraint will be added outside the OR
    let clause = `\n${indent}[?ref-page :node/title "${condition.text}"]`;

    // Apply negation if needed
    if (condition.negate) {
      clause = `\n${indent}(not ${clause.trim()})`;
    }

    return clause;
  }

  /**
   * Build block reference clause with consistent variable naming for OR queries
   */
  private buildBlockRefClause(
    condition: SearchCondition,
    _contentVariable: string
  ): string {
    const indent = "                  ";
    // For OR context, only include the block UID constraint
    // The block reference constraint will be added outside the OR
    let clause = `\n${indent}[?ref-block :block/uid "${condition.text}"]`;

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
  strategy:
    | "fuzzy"
    | "synonyms"
    | "related_concepts"
    | "broader_terms"
    | "custom"
    | "all",
  originalQuery?: string,
  modelInfo?: any, // Pass model from execution context instead of using defaultModel
  userLanguage?: string, // User's language for language-aware expansion
  customStrategy?: string, // Custom strategy description from expansionGuidance
  mode: "text" | "page_ref" = "text" // text=allow regex patterns, page_ref=simple text only
): Promise<string[]> => {
  let nbOfVariations =
    strategy === "all"
      ? "3-5"
      : strategy !== "custom"
      ? "5-8"
      : "as many as needed";
  const contextualInfo =
    originalQuery && originalQuery !== text
      ? `\n\nContext: This term appears in the user query: "${originalQuery}". Consider this context when generating expansions.`
      : "";

  const languageInfo = userLanguage
    ? `\n\nLanguage: The user is working in ${userLanguage}. Generate terms appropriate for this language and consider language-specific morphological patterns.`
    : "";

  // Shared requirements for all prompts to avoid duplication
  const buildCommonRequirements = (
    text: string,
    nbOfVariations: string,
    mode: "text" | "page_ref",
    isAllStrategy: boolean = false,
    currentStrategy?: string,
    previousTerms?: string[]
  ) => {
    const modeGuidance =
      mode === "text"
        ? `
If relevant for some variation, you can use regex patterns to match most common and meaningful morphological variations:
- Examples: analyz(?:e|es|ed|ing), categor(?:y|ies), manage(?:s|d|ment)`
        : `
If some variations have distinct morphological variaton (plural, verbal...), generate also the most common with simple text only (no regex patterns):
- Examples: For "analyze" → analysis, analyzing, analyzer`;

    const strategyText = isAllStrategy
      ? ` for ${currentStrategy} expansion`
      : "";
    const originalTermText = isAllStrategy
      ? `- Do NOT include the original term "${text}" or any previously found variations`
      : `- Prioritize terms that would help find related content in a knowledge base`;

    return `IMPORTANT: Respond in the SAME LANGUAGE as the input term "${text}".
Requirements:
- Generate if possible ${nbOfVariations} high-quality, relevant terms${strategyText}
- Return only the terms themselves, one per line  
- No explanations, numbers, or bullet points
- PRIORITIZE simple words over phrases - single words are preferred
- Focus on terms likely to appear in page titles or block content
- Avoid very generic terms (like "thing", "item", "stuff")
- Terms should be relevant for knowledge management and note-taking
${originalTermText}${modeGuidance}${
      previousTerms
        ? "\n- Generate completely NEW terms that complement but do not repeat the previous variations"
        : ""
    }`;
  };

  const strategyPrompts = {
    synonyms:
      mode === "text"
        ? `Generate synonyms and alternative terms for: "${text}". Focus on words that mean the same thing or are used interchangeably.

Examples for "analyze":
exampl(?:e|es|ed|ing)
study
review
investigat(?:e|es|ed|ing)
assess

Examples for "task":
job
assignment
work
duty${contextualInfo}${languageInfo}`
        : `Generate synonyms and alternative terms for: "${text}" that could be page titles.

Examples for "analyze":
analysis
analyzing
examination
study
review
investigation
assessment

Examples for "task":
tasks
job
jobs
assignment
assignments
work
duty${contextualInfo}${languageInfo}`,

    related_concepts:
      mode === "text"
        ? `Generate closely related concepts for: "${text}". Include associated ideas and terms commonly found together.

Examples for "project":
planning
manag(?:e|es|ed|ing|ement)
timeline
milestone
deliverable
team

Examples for "write":
writ(?:e|es|ing|ten)
document
draft
content
publish${contextualInfo}${languageInfo}`
        : `Generate closely related concepts for: "${text}" that could be page titles.

Examples for "project":
projects
planning
management
managing
timeline
milestones
deliverables
team

Examples for "write":
writing
written
writer
document
documents
draft
drafts
content
publishing${contextualInfo}${languageInfo}`,

    broader_terms:
      mode === "text"
        ? `Generate broader, more general terms that encompass: "${text}". Think of parent categories and umbrella terms.

Examples for "meeting":
meet(?:s|ing|ings)
event
gathering
session
discussion

Examples for "car":
vehicl(?:e|es)
transport(?:ation)?
automobile${contextualInfo}${languageInfo}`
        : `Generate broader, more general terms that encompass: "${text}" that could be page titles.

Examples for "meeting":
meetings
event
events
gathering
gatherings
session
sessions
discussions

Examples for "car":
cars
vehicle
vehicles
transportation
automobile
automobiles${contextualInfo}${languageInfo}`,

    fuzzy:
      mode === "text"
        ? `Generate fuzzy variations for: "${text}". Include morphological variations, common typos, alternative spellings, and word completion for partial words.

Examples for "pend" (incomplete word):
pending
pend(?:s|ing|ed)?
pendin
pendng
pening

Examples for "analyze" (complete word):
analyz(?:e|es|ed|ing|sis)
analize
analise
analisys${contextualInfo}${languageInfo}`
        : `Generate fuzzy variations for: "${text}" that could be actual page titles. Include word completion for partial words.

Examples for "pend" (incomplete word):
pending
pended
pends
pendin
pendng
pening

Examples for "analyze" (complete word):
analysis
analyzing
analyzed
analize
analise${contextualInfo}${languageInfo}`,

    custom: customStrategy
      ? `Apply the following custom strategy to generate semantic variations for: "${text}"

Strategy: ${customStrategy}

Generate variations based on this specific strategy. Each variation should be on a separate line.${contextualInfo}${languageInfo}`
      : `Generate variations for: "${text}" using a custom approach.${contextualInfo}${languageInfo}`,
    all: `This is handled by chained expansion - not used directly`,
  };

  // Handle "all" strategy by chaining fuzzy -> synonyms -> related_concepts with context awareness
  if (strategy === "all") {
    const chainedStrategies = ["fuzzy", "synonyms", "related_concepts"];
    const allExpansions: string[] = [];

    for (let i = 0; i < chainedStrategies.length; i++) {
      const currentStrategy = chainedStrategies[i] as any;
      const previousTerms =
        allExpansions.length > 0
          ? `\n\nPrevious variations already found: ${allExpansions.join(
              ", "
            )}\nDo NOT repeat these terms. Generate NEW variations that are different and complementary.`
          : "";

      // Build context-aware prompt for current strategy
      const contextualPrompt =
        strategyPrompts[currentStrategy as keyof typeof strategyPrompts] +
        previousTerms;

      try {
        const commonRequirements = buildCommonRequirements(
          text,
          nbOfVariations,
          mode,
          true, // isAllStrategy
          currentStrategy,
          allExpansions.length > 0 ? allExpansions : undefined
        );

        const prompt = `${contextualPrompt}

${commonRequirements}`;

        // Use provided model or fall back to defaultModel
        let processedModel = modelInfo;
        if (!processedModel) {
          if (!defaultModel) {
            console.warn(
              `Semantic expansion skipped for "${text}": no model available`
            );
            continue;
          }
          processedModel = defaultModel;
        }

        // Process the model to ensure it has the correct structure
        // If processedModel is an LlmInfos object, pass the name field
        const modelName =
          typeof processedModel === "string"
            ? processedModel
            : processedModel?.name || processedModel?.id;
        const modelForLanggraph = modelAccordingToProvider(modelName);
        if (!modelForLanggraph || !modelForLanggraph.id) {
          console.warn(
            `${currentStrategy} expansion skipped for "${text}": invalid model structure`
          );
          continue;
        }

        const llm = modelViaLanggraph(
          modelForLanggraph,
          { input_tokens: 0, output_tokens: 0 },
          false
        );
        const response = await llm.invoke([new HumanMessage(prompt)]);

        const expansions = response.content
          .toString()
          .split("\n")
          .map((line: any) => line.trim())
          .filter((line: any) => line && !line.match(/^\d+\.?\s*/))
          .map((term: any) => term.replace(/^[•\-\*]\s*/, "").trim())
          .filter(
            (term: any) =>
              term &&
              term.toLowerCase() !== text.toLowerCase() &&
              !allExpansions.some(
                (existing) => existing.toLowerCase() === term.toLowerCase()
              )
          );

        allExpansions.push(...expansions);
        console.log(
          `🔍 ${currentStrategy} expansion for "${text}": ${expansions.join(
            ", "
          )}`
        );
      } catch (error) {
        console.warn(
          `Failed ${currentStrategy} expansion for "${text}":`,
          error
        );
      }
    }

    console.log(
      `🔍 Generated ${
        allExpansions.length
      } total chained expansions for "${text}": ${allExpansions.join(", ")}`
    );
    return allExpansions;
  }

  // - CRITICAL: Do NOT include terms that contain the original word "${text}" - provide genuinely different alternatives

  const commonRequirements = buildCommonRequirements(
    text,
    nbOfVariations,
    mode,
    false, // isAllStrategy
    undefined,
    undefined
  );

  const prompt = `${strategyPrompts[strategy]}

${commonRequirements}`;

  // console.log(`🔍 [${strategy}] Prompt for "${text}":`, prompt);

  try {
    // Use provided model or fall back to defaultModel if not provided
    let processedModel = modelInfo;
    if (!processedModel) {
      if (!defaultModel) {
        console.warn(
          `Semantic expansion skipped for "${text}": no model available`
        );
        return [];
      }
      processedModel = defaultModel;
    }

    // Process the model to ensure it has the correct structure
    // If processedModel is an LlmInfos object, pass the name field
    const modelName =
      typeof processedModel === "string"
        ? processedModel
        : processedModel?.name || processedModel?.id;
    const modelForLanggraph = modelAccordingToProvider(modelName);
    if (!modelForLanggraph || !modelForLanggraph.id) {
      console.warn(
        `Semantic expansion skipped for "${text}": invalid model structure`
      );
      return [];
    }

    const llm = modelViaLanggraph(
      modelForLanggraph,
      { input_tokens: 0, output_tokens: 0 },
      false
    );

    const response = await llm.invoke([new HumanMessage(prompt)]);

    const lines = response.content
      .toString()
      .split("\n")
      .map((line) => line.trim());

    const filteredLines = lines.filter(
      (line) => line.length > 0 && !line.match(/^\d+\./) && line.length < 50
    );

    const terms = filteredLines.filter((term) => {
      // For fuzzy and custom strategies, keep all variations
      if (strategy === "fuzzy" || strategy === "custom") {
        return true;
      }

      // For other strategies, only filter out exact matches (not partial matches)
      // This allows "analysis" for "analyze" but filters out exact "analyze" repetitions
      const originalLower = text.toLowerCase();
      const termLower = term.toLowerCase();
      const shouldKeep = termLower !== originalLower; // Exact match only, not includes
      if (!shouldKeep) {
        console.log(`🔍 [${strategy}] Filtered out exact match "${term}"`);
      }
      return shouldKeep;
    }); // Return all generated terms without artificial limitation

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
 * Generate fuzzy regex pattern for typo-tolerant matching
 * Creates compact regex patterns based on word roots and common variations
 * More efficient than expanding to multiple search terms
 */
export const generateFuzzyRegex = async (
  text: string,
  originalQuery?: string,
  modelInfo?: any,
  userLanguage?: string // User's language for language-aware fuzzy patterns
): Promise<string> => {
  const contextualInfo =
    originalQuery && originalQuery !== text
      ? `\n\nContext: This term appears in the user query: "${originalQuery}".`
      : "";

  const languageInfo = userLanguage
    ? `\n\nLanguage: The user is working in ${userLanguage}. Consider language-specific morphological patterns, common typos, and character substitutions for this language.`
    : "";

  const prompt = `Generate a compact regex pattern for fuzzy matching of: "${text}". 
Create a pattern that catches morphological variations (plural, verb, adjective, etc.), common typos, and alternative spellings.

${contextualInfo}${languageInfo}

CRITICAL: Respond with ONLY the regex pattern - NO explanations, NO comments, NO additional text. Just the pattern itself (without delimiters). The pattern will be used as (?i)pattern.

Requirements:
- Use word boundaries and partial matching (.*word.* patterns)
- Focus on the word root when possible
- Include common character substitutions for typos
- Keep pattern concise but comprehensive
- Pattern should match the original word and its variations
- For SHORT TERMS (1-3 chars): Be restrictive to avoid false positives - use strict word boundaries and minimal variations
- KEEP STRUCTURE SIMPLE: Avoid nested alternatives (|) within groups - use flat patterns only

Examples:
- For "analytic": "analy[st]?[izt]?[cs]?[ae]?[l]?" (catches analytic, analysis, analyzing, analyst, analytical)
- For "manage": "manag[eming]?[ement]?[r]?" (catches manage, managing, management, manager)
- For "write" with alternatives: "(\\bwrit[eimg]?[ens]?\\b|\\btyp[eimg]?[ens]?\\b|\\bauthor[s]?\\b)"
- For "go" (short term): "\\bgo[nes]?\\b" (strict boundaries, only basic variations like "go", "goes", "gone" - avoid matching "logo", "argo", etc.)
- For "organization": "organi[sz]?[ae]?tion[al]?" (catches organization, organisation, organizational)

Generate pattern for "${text}":`;

  try {
    if (!modelInfo) {
      console.warn(
        `Fuzzy regex generation skipped for "${text}": no model available`
      );
      // Fallback: simple pattern
      return `.*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*`;
    }

    // Use provided model or fall back to defaultModel if not provided
    let processedModel = modelInfo;
    if (!processedModel) {
      if (!defaultModel) {
        console.warn(
          `Fuzzy regex generation skipped for "${text}": no model available`
        );
        return `.*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*`;
      }
      processedModel = defaultModel;
    }

    // Process the model to ensure it has the correct structure
    // If processedModel is an LlmInfos object, pass the name field
    const modelName =
      typeof processedModel === "string"
        ? processedModel
        : processedModel?.name || processedModel?.id;
    const modelForLanggraph = modelAccordingToProvider(modelName);
    if (!modelForLanggraph || !modelForLanggraph.id) {
      console.warn(
        `Fuzzy regex generation skipped for "${text}": invalid model structure`
      );
      return `.*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*`;
    }

    const llm = modelViaLanggraph(
      modelForLanggraph,
      { input_tokens: 0, output_tokens: 0 },
      false
    );
    const response = await llm.invoke([new HumanMessage(prompt)]);

    let pattern = response.content.toString().trim();

    // Clean up the pattern (remove any surrounding quotes or extra whitespace)
    pattern = pattern.replace(/^["'`]|["'`]$/g, "").trim();

    // Fix word boundaries for problematic patterns like: \bterm1|term2|term3\b
    // This specifically targets the pattern where \b is only at start and end
    const problematicPattern = /^\\b([^\\]+(?:\|[^\\]+)+)\\b$/;
    const match = pattern.match(problematicPattern);

    if (match && pattern.includes("|")) {
      // Only fix if it's the exact problematic pattern: \b...alternatives...\b
      const alternatives = match[1].split("|").map((alt) => alt.trim());
      const boundedAlternatives = alternatives.map((alt) => `\\b${alt}\\b`);
      pattern = `(${boundedAlternatives.join("|")})`;
    }

    // Validate that it's a reasonable pattern
    if (pattern.length < 3 || pattern.length > 200) {
      console.warn(
        `Generated pattern seems invalid: ${pattern}, using fallback`
      );
      return `.*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*`;
    }

    console.log(`🔍 Generated fuzzy regex for "${text}": ${pattern}`);
    return pattern;
  } catch (error) {
    console.error("Failed to generate fuzzy regex:", error);
    // Fallback to simple escaped pattern
    return `.*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*`;
  }
};

/**
 * Filter pages/blocks by date range using creation/modification times
 * Enhanced to use actual timestamps instead of just DNP UIDs
 */
export const filterByDateRange = <
  T extends {
    uid?: string;
    pageUid?: string;
    isDaily?: boolean;
    created?: Date;
    modified?: Date;
  }
>(
  results: T[],
  dateRange: { start?: Date; end?: Date },
  filterMode: "created" | "modified" | "either" | "dnp_only" = "modified"
): T[] => {
  // Filter results by date range

  let filteredCount = 0;

  const filteredResults = results.filter((result) => {
    const uid = result.pageUid || result.uid;
    const isDaily = result.isDaily ?? (uid ? isDailyNote(uid) : false);

    let targetDate: Date | null = null;

    // Determine which date to use based on filter mode
    switch (filterMode) {
      case "created":
        targetDate = result.created || null;
        break;

      case "modified":
        targetDate = result.modified || null;
        break;

      case "either":
        // Use modification date if available, fall back to creation date
        targetDate = result.modified || result.created || null;
        break;

      case "dnp_only":
        // Legacy behavior - only filter DNPs by UID parsing
        if (!isDaily) return true;
        targetDate = parseDNPDate(uid!);
        break;
    }

    // If no target date found and it's not DNP-only mode, keep the result
    if (!targetDate && filterMode !== "dnp_only") {
      console.debug(
        `🗓️ No ${filterMode} date found for UID ${uid}, keeping result`
      );
      return true;
    }

    // If still no date found, keep the result (conservative approach)
    if (!targetDate) {
      console.debug(
        `🗓️ No date found for filtering UID ${uid}, keeping result`
      );
      return true;
    }

    try {
      const isInRange =
        (!dateRange.start || targetDate >= dateRange.start) &&
        (!dateRange.end || targetDate <= dateRange.end);

      if (!isInRange) {
        // Item filtered out by date range
      } else {
        filteredCount++;
      }

      return isInRange;
    } catch (error) {
      console.warn("🗓️ Error filtering by date range for UID:", uid, error);
      return true; // Keep if there's an error
    }
  });

  console.log(
    `🗓️ Date filtering complete: ${filteredResults.length}/${results.length} results kept (${filteredCount} in range)`
  );

  return filteredResults;
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
export const deduplicateResultsByUid = (
  results: any[],
  debugContext = "unknown"
): any[] => {
  if (!Array.isArray(results)) return results;

  const seenUids = new Set<string>();
  const deduplicated = results.filter((result) => {
    const uid = result?.uid || result?.pageUid;
    if (!uid) return true; // Keep items without UIDs

    if (seenUids.has(uid)) {
      return false; // Skip duplicate
    }

    seenUids.add(uid);
    return true;
  });

  if (deduplicated.length !== results.length) {
    console.log(
      `🔄 [${debugContext}] Deduplicated ${results.length} results to ${deduplicated.length} unique items`
    );
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
 * Context expansion configuration for balanced mode
 * Based on result count, determines what hierarchy context to include
 */
export const getHierarchyExpansionConfig = (resultCount: number) => {
  if (resultCount < 10) {
    return {
      includeParents: true,
      includeChildren: true,
      maxDepth: 3, // parent + 2 levels children
      truncateLength: 250, // Limit context blocks to 250 chars
      expandContext: true,
    };
  } else if (resultCount <= 50) {
    return {
      includeParents: false,
      includeChildren: true,
      maxDepth: 1, // Only first level children
      truncateLength: 200,
      expandContext: true,
    };
  } else {
    // > 50
    return {
      includeParents: false,
      includeChildren: false,
      maxDepth: 0,
      expandContext: false, // No expansion - too many results
    };
  }
};

/**
 * Determine if balanced mode should expand context for given results
 */
export const shouldExpandContextInBalanced = (
  results: any[],
  userQuery: string
): boolean => {
  const resultCount = results.reduce(
    (sum, r) => sum + (r.data?.length || 0),
    0
  );
  const config = getHierarchyExpansionConfig(resultCount);

  if (!config.expandContext) return false;

  const allBlocks = results.flatMap((r) => r.data || []);

  // Triggers for context expansion
  const hasShortContent = allBlocks.some(
    (b) => b.content && b.content.trim().length < 50
  );

  const userRequestsContext =
    /\b(context|children|parent|around|under|hierarchy)\b/i.test(userQuery);

  const hasTechnicalContent = allBlocks.some(
    (b) =>
      b.content &&
      /\b(function|class|code|api|method|def|import|const|let|var)\b/i.test(
        b.content
      )
  );

  console.log(`🌳 [ContextExpansion] Analysis:`, {
    resultCount,
    hasShortContent,
    userRequestsContext,
    hasTechnicalContent,
    shouldExpand: hasShortContent || userRequestsContext || hasTechnicalContent,
  });

  return hasShortContent || userRequestsContext || hasTechnicalContent;
};

/**
 * Expand hierarchy context using Datomic queries (for balanced mode)
 * Since balanced mode doesn't have extractHierarchyContent, we use custom queries
 */
export const expandHierarchyWithDatomic = async (
  blockUids: string[],
  config: ReturnType<typeof getHierarchyExpansionConfig>
): Promise<any[]> => {
  if (!config.expandContext || blockUids.length === 0) {
    return [];
  }

  const hierarchyData: any[] = [];

  try {
    // Get parent context if requested
    if (config.includeParents) {
      const parentQuery = `[:find ?parent-uid ?parent-content ?page-title
                           :in $ [?block-uid ...]
                           :where
                           [?block :block/uid ?block-uid]
                           [?parent :block/children ?block]
                           [?parent :block/uid ?parent-uid]  
                           [?parent :block/string ?parent-content]
                           [?parent :block/page ?page]
                           [?page :node/title ?page-title]]`;

      const parentResults = await executeDatomicQuery(parentQuery, blockUids);

      parentResults.forEach(([parentUid, parentContent, pageTitle]) => {
        hierarchyData.push({
          uid: parentUid,
          content: truncateContent(parentContent, config.truncateLength),
          pageTitle,
          hierarchyType: "parent",
          originalBlockUids: blockUids,
        });
      });
    }

    // Get children context if requested
    if (config.includeChildren && config.maxDepth > 0) {
      const childrenQuery = `[:find ?child-uid ?child-content ?page-title ?order
                             :in $ [?parent-uid ...]
                             :where
                             [?parent :block/uid ?parent-uid]
                             [?parent :block/children ?child]
                             [?child :block/uid ?child-uid]
                             [?child :block/string ?child-content] 
                             [?child :block/order ?order]
                             [?child :block/page ?page]
                             [?page :node/title ?page-title]]`;

      const childResults = await executeDatomicQuery(childrenQuery, blockUids);

      // Sort by order and apply depth limits
      childResults
        .sort((a, b) => a[3] - b[3]) // Sort by order
        .slice(0, config.maxDepth * blockUids.length) // Limit total children
        .forEach(([childUid, childContent, pageTitle, order]) => {
          hierarchyData.push({
            uid: childUid,
            content: truncateContent(childContent, config.truncateLength),
            pageTitle,
            hierarchyType: "child",
            order,
            originalBlockUids: blockUids,
          });
        });
    }

    console.log(
      `🌳 [ExpandHierarchy] Expanded ${blockUids.length} blocks → ${hierarchyData.length} context items`
    );
  } catch (error) {
    console.error("🌳 [ExpandHierarchy] Error expanding hierarchy:", error);
    return [];
  }

  return hierarchyData;
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
 * OPTIMIZED: Get children blocks for multiple parents in batches (much faster than one-by-one)
 * This replaces the recursive approach with batched queries for better performance
 */
export const getBatchBlockChildren = async (
  parentUids: string[],
  maxDepth: number,
  secureMode: boolean = false
): Promise<{ [parentUid: string]: any[] }> => {
  console.log(
    `🚀 getBatchBlockChildren: Processing ${parentUids.length} parents, depth ${maxDepth}`
  );

  if (maxDepth <= 0 || parentUids.length === 0) {
    return {};
  }

  // Build batch query for all parent UIDs at once
  const uidsSet = parentUids.map((uid) => `"${uid}"`).join(" ");
  const query = `[:find ?parent-uid ?uid ?content ?order ?page-title ?page-uid
                 :where 
                 [?parent :block/uid ?parent-uid]
                 [(contains? #{${uidsSet}} ?parent-uid)]
                 [?parent :block/children ?child]
                 [?child :block/uid ?uid]
                 [?child :block/string ?content]
                 [?child :block/order ?order]
                 [?child :block/page ?page]
                 [?page :node/title ?page-title]
                 [?page :block/uid ?page-uid]]`;

  try {
    const allChildren = await executeDatomicQuery(query);
    console.log(
      `🚀 getBatchBlockChildren: Found ${allChildren.length} direct children`
    );

    // Group children by parent UID
    const childrenByParent: { [parentUid: string]: any[] } = {};

    // Initialize empty arrays for all parents
    parentUids.forEach((parentUid) => {
      childrenByParent[parentUid] = [];
    });

    // Sort and group results
    allChildren
      .sort((a, b) => a[3] - b[3]) // Sort by order
      .forEach(([parentUid, uid, content, order, pageTitle, pageUid]) => {
        childrenByParent[parentUid].push({
          uid,
          content: secureMode ? undefined : content,
          order,
          pageTitle,
          pageUid,
          isDaily: isDailyNote(pageUid),
          children: [], // Will be populated in next recursion
        });
      });

    // If we need more depth, recursively get grandchildren in batches
    if (maxDepth > 1) {
      console.log(
        `🚀 getBatchBlockChildren: Getting grandchildren (depth ${
          maxDepth - 1
        })`
      );

      // Collect all child UIDs for next batch
      const allChildUids: string[] = [];
      Object.values(childrenByParent).forEach((children) => {
        children.forEach((child) => {
          allChildUids.push(child.uid);
        });
      });

      if (allChildUids.length > 0) {
        // Batch query for grandchildren
        const grandchildrenByParent = await getBatchBlockChildren(
          allChildUids,
          maxDepth - 1,
          secureMode
        );

        // Attach grandchildren to their parents
        Object.values(childrenByParent).forEach((children) => {
          children.forEach((child) => {
            child.children = grandchildrenByParent[child.uid] || [];
          });
        });
      }
    }

    console.log(
      `🚀 getBatchBlockChildren: Completed, processed ${
        Object.keys(childrenByParent).length
      } parents`
    );
    return childrenByParent;
  } catch (error) {
    console.warn(`Failed to get batch children for parents:`, error);
    // Return empty arrays for all parents
    const emptyResult: { [parentUid: string]: any[] } = {};
    parentUids.forEach((parentUid) => {
      emptyResult[parentUid] = [];
    });
    return emptyResult;
  }
};

/**
 * OPTIMIZED: Get parent blocks for multiple children in batches
 */
export const getBatchBlockParents = async (
  childUids: string[],
  maxDepth: number,
  secureMode: boolean = false
): Promise<{ [childUid: string]: any[] }> => {
  console.log(
    `🚀 getBatchBlockParents: Processing ${childUids.length} children, depth ${maxDepth}`
  );

  if (maxDepth <= 0 || childUids.length === 0) {
    return {};
  }

  // Build batch query for all child UIDs at once
  const uidsSet = childUids.map((uid) => `"${uid}"`).join(" ");
  const query = `[:find ?child-uid ?uid ?content ?page-title ?page-uid
                 :where 
                 [?child :block/uid ?child-uid]
                 [(contains? #{${uidsSet}} ?child-uid)]
                 [?parent :block/children ?child]
                 [?parent :block/uid ?uid]
                 [?parent :block/string ?content]
                 [?parent :block/page ?page]
                 [?page :node/title ?page-title]
                 [?page :block/uid ?page-uid]]`;

  try {
    const allParents = await executeDatomicQuery(query);
    console.log(
      `🚀 getBatchBlockParents: Found ${allParents.length} direct parents`
    );

    // Group parents by child UID
    const parentsByChild: { [childUid: string]: any[] } = {};

    // Initialize empty arrays for all children
    childUids.forEach((childUid) => {
      parentsByChild[childUid] = [];
    });

    // Group results (no sorting needed for parents)
    allParents.forEach(([childUid, uid, content, pageTitle, pageUid]) => {
      parentsByChild[childUid].push({
        uid,
        content: secureMode ? undefined : truncateContent(content, 50),
        pageTitle,
        pageUid,
        isDaily: isDailyNote(pageUid),
      });
    });

    // If we need more depth, recursively get grandparents in batches
    if (maxDepth > 1) {
      console.log(
        `🚀 getBatchBlockParents: Getting grandparents (depth ${maxDepth - 1})`
      );

      // Collect all direct parent UIDs for next batch
      const allParentUids: string[] = [];
      Object.values(parentsByChild).forEach((parents) => {
        parents.forEach((parent) => {
          allParentUids.push(parent.uid);
        });
      });

      if (allParentUids.length > 0) {
        // Remove duplicates
        const uniqueParentUids = Array.from(new Set(allParentUids));

        // Batch query for grandparents (only need one representative per child)
        const grandparentsByParent = await getBatchBlockParents(
          uniqueParentUids,
          maxDepth - 1,
          secureMode
        );

        // Prepend grandparents to each child's parent list
        Object.keys(parentsByChild).forEach((childUid) => {
          const directParents = parentsByChild[childUid];
          if (directParents.length > 0) {
            // Get grandparents through first direct parent
            const grandparents =
              grandparentsByParent[directParents[0].uid] || [];
            parentsByChild[childUid] = [...grandparents, ...directParents];
          }
        });
      }
    }

    console.log(
      `🚀 getBatchBlockParents: Completed, processed ${
        Object.keys(parentsByChild).length
      } children`
    );
    return parentsByChild;
  } catch (error) {
    console.warn(`Failed to get batch parents for children:`, error);
    // Return empty arrays for all children
    const emptyResult: { [childUid: string]: any[] } = {};
    childUids.forEach((childUid) => {
      emptyResult[childUid] = [];
    });
    return emptyResult;
  }
};

/**
 * OPTIMIZED: Get ALL descendants for multiple parents in ONE flattened batch query
 * This is the most efficient approach - single query gets all levels at once
 */
export const getFlattenedDescendants = async (
  parentUids: string[],
  maxDepth: number,
  secureMode: boolean = false
): Promise<{ [parentUid: string]: any[] }> => {
  if (maxDepth <= 0 || parentUids.length === 0) {
    return {};
  }

  // Build single batch query for ALL descendants at ALL levels
  const uidsSet = parentUids.map((uid) => `"${uid}"`).join(" ");

  // Use recursive Datomic query to get all levels in one shot
  let query;
  if (maxDepth === 1) {
    // Simple case: only direct children
    query = `[:find ?parent-uid ?uid ?content ?page-title ?page-uid
             :where 
             [?parent :block/uid ?parent-uid]
             [(contains? #{${uidsSet}} ?parent-uid)]
             [?parent :block/children ?child]
             [?child :block/uid ?uid]
             [?child :block/string ?content]
             [?child :block/page ?page]
             [?page :node/title ?page-title]
             [?page :block/uid ?page-uid]]`;
  } else {
    // Complex case: get descendants up to maxDepth levels using or-join
    const orClauses = [];

    // Level 1: direct children
    orClauses.push(
      `(and [?parent :block/children ?descendant] [(ground 1) ?level])`
    );

    // Level 2: grandchildren
    if (maxDepth >= 2) {
      orClauses.push(`(and [?parent :block/children ?child1] 
                           [?child1 :block/children ?descendant] 
                           [(ground 2) ?level])`);
    }

    // Level 3: great-grandchildren
    if (maxDepth >= 3) {
      orClauses.push(`(and [?parent :block/children ?child1]
                           [?child1 :block/children ?child2] 
                           [?child2 :block/children ?descendant] 
                           [(ground 3) ?level])`);
    }

    // Additional levels if needed (up to maxDepth)
    for (let level = 4; level <= maxDepth; level++) {
      const childVars = Array.from(
        { length: level - 1 },
        (_, i) => `?child${i + 1}`
      ).join(" ");
      const childClauses = [];

      // Build chain: parent -> child1 -> child2 -> ... -> descendant
      childClauses.push(`[?parent :block/children ?child1]`);
      for (let i = 2; i < level; i++) {
        childClauses.push(`[?child${i - 1} :block/children ?child${i}]`);
      }
      childClauses.push(`[?child${level - 1} :block/children ?descendant]`);

      orClauses.push(
        `(and ${childClauses.join(" ")} [(ground ${level}) ?level])`
      );
    }

    query = `[:find ?parent-uid ?uid ?content ?page-title ?page-uid ?level
             :where 
             [?parent :block/uid ?parent-uid]
             [(contains? #{${uidsSet}} ?parent-uid)]
             (or-join [?parent ?descendant ?level]
               ${orClauses.join("\n               ")})
             [?descendant :block/uid ?uid]
             [?descendant :block/string ?content]
             [?descendant :block/page ?page]
             [?page :node/title ?page-title]
             [?page :block/uid ?page-uid]]`;
  }

  try {
    const startTime = performance.now();
    const allDescendants = await executeDatomicQuery(query);

    // Group descendants by parent UID (flattened - all levels together)
    const descendantsByParent: { [parentUid: string]: any[] } = {};

    // Initialize empty arrays for all parents
    parentUids.forEach((parentUid) => {
      descendantsByParent[parentUid] = [];
    });

    // Process results - all descendants flattened together
    allDescendants.forEach((result) => {
      const [parentUid, uid, content, pageTitle, pageUid, level] = result;

      descendantsByParent[parentUid].push({
        uid,
        content: secureMode ? undefined : content,
        pageTitle,
        pageUid,
        isDaily: isDailyNote(pageUid),
        level: level || 1, // Track which level this descendant is at
      });
    });

    return descendantsByParent;
  } catch (error) {
    console.warn(`Failed to get flattened descendants for parents:`, error);
    // Return empty arrays for all parents
    const emptyResult: { [parentUid: string]: any[] } = {};
    parentUids.forEach((parentUid) => {
      emptyResult[parentUid] = [];
    });
    return emptyResult;
  }
};

/**
 * OPTIMIZED: Get ALL ancestors for multiple children in ONE flattened batch query
 */
export const getFlattenedAncestors = async (
  childUids: string[],
  maxDepth: number,
  secureMode: boolean = false
): Promise<{ [childUid: string]: any[] }> => {
  if (maxDepth <= 0 || childUids.length === 0) {
    return {};
  }

  // Build single batch query for ALL ancestors at ALL levels
  const uidsSet = childUids.map((uid) => `"${uid}"`).join(" ");

  // Use recursive query for ancestors
  let query;
  if (maxDepth === 1) {
    query = `[:find ?child-uid ?uid ?content ?page-title ?page-uid
             :where 
             [?child :block/uid ?child-uid]
             [(contains? #{${uidsSet}} ?child-uid)]
             [?parent :block/children ?child]
             [?parent :block/uid ?uid]
             [?parent :block/string ?content]
             [?parent :block/page ?page]
             [?page :node/title ?page-title]
             [?page :block/uid ?page-uid]]`;
  } else {
    const orClauses = [];

    // Level 1: direct parents
    orClauses.push(
      `(and [?ancestor :block/children ?child] [(ground 1) ?level])`
    );

    // Level 2: grandparents
    if (maxDepth >= 2) {
      orClauses.push(`(and [?ancestor :block/children ?parent1]
                           [?parent1 :block/children ?child] 
                           [(ground 2) ?level])`);
    }

    // Level 3: great-grandparents
    if (maxDepth >= 3) {
      orClauses.push(`(and [?ancestor :block/children ?parent1]
                           [?parent1 :block/children ?parent2]
                           [?parent2 :block/children ?child] 
                           [(ground 3) ?level])`);
    }

    query = `[:find ?child-uid ?uid ?content ?page-title ?page-uid ?level
             :where 
             [?child :block/uid ?child-uid]
             [(contains? #{${uidsSet}} ?child-uid)]
             (or-join [?child ?ancestor ?level]
               ${orClauses.join("\n               ")})
             [?ancestor :block/uid ?uid]
             [?ancestor :block/string ?content]
             [?ancestor :block/page ?page]
             [?page :node/title ?page-title]
             [?page :block/uid ?page-uid]]`;
  }

  try {
    const allAncestors = await executeDatomicQuery(query);
    console.log(
      `🚀 getFlattenedAncestors: Single query found ${allAncestors.length} total ancestors`
    );

    // Group ancestors by child UID (flattened)
    const ancestorsByChild: { [childUid: string]: any[] } = {};

    childUids.forEach((childUid) => {
      ancestorsByChild[childUid] = [];
    });

    allAncestors.forEach(
      ([childUid, uid, content, pageTitle, pageUid, level]) => {
        ancestorsByChild[childUid].push({
          uid,
          content: secureMode ? undefined : truncateContent(content, 50),
          pageTitle,
          pageUid,
          isDaily: isDailyNote(pageUid),
          level: level || 1,
        });
      }
    );

    return ancestorsByChild;
  } catch (error) {
    console.warn(`Failed to get flattened ancestors:`, error);
    const emptyResult: { [childUid: string]: any[] } = {};
    childUids.forEach((childUid) => {
      emptyResult[childUid] = [];
    });
    return emptyResult;
  }
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
 * Calculate expansion-aware relevance score
 * Higher scores = better relevance (exact matches ranked highest)
 */
const calculateExpansionAwareRelevance = (result: any): number => {
  // Get base relevance score from existing algorithms
  const baseScore =
    result.relevanceScore || result.matchedConditions?.length || 0;

  // Expansion level bonuses (0 = exact match, higher = more expansion needed)
  const expansionLevel = result.expansionLevel || 0;
  const expansionBonus = {
    0: 100, // Exact match - highest priority
    1: 75, // Hierarchical expansion - high priority
    2: 50, // Fuzzy + semantic expansion - medium priority
    3: 25, // Multi-tool expansion - lower priority
  };

  // Calculate final score: base algorithm score + expansion bonus
  const finalScore = baseScore + (expansionBonus[expansionLevel] || 0);

  return finalScore;
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
        const aScore = calculateExpansionAwareRelevance(a);
        const bScore = calculateExpansionAwareRelevance(b);
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
        // NEW: Progressive content limits based on result count
        getContentLimit: (resultCount: number): number | null => {
          if (resultCount < 10) return null; // Full content
          if (resultCount <= 50) return 500; // Medium limit
          return 250; // >50 results - shorter for readability
        },
      };
    case "full":
      return {
        maxResults: 10000, // Match balanced mode - content richness is the differentiator
        defaultLimit: 500, // Match balanced mode
        summaryLimit: 20, // Keep lower due to richer content per item
        // Progressive content strategy for full mode
        getContentStrategy: (resultCount: number): string => {
          if (resultCount < 30) return "rich_content_with_hierarchy";
          if (resultCount <= 100) return "full_content_selected";
          return "summary_with_expansion_options";
        },
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
): { blockUids: string[]; pageUids: string[] } => {
  let finalBlockUids = limitToBlockUids || [];
  let finalPageUids = limitToPageUids || [];

  // Extract UIDs from previous results if fromResultId is provided
  if (fromResultId && state?.resultStore) {
    console.log(`🔍 Extracting UIDs from previous result: ${fromResultId}`);
    const resultEntry = state.resultStore[fromResultId];
    if (!resultEntry) {
      const availableResults = Object.keys(state.resultStore || {});
      throw new Error(
        `Previous result ${fromResultId} not found. Available results: ${availableResults.join(
          ", "
        )}`
      );
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
      console.log(
        `🔍 Extracted from previous result: ${finalBlockUids.length} blockUids, ${finalPageUids.length} pageUids`
      );
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
  finalBlockUids = Array.from(new Set(finalBlockUids));
  finalPageUids = Array.from(new Set(finalPageUids));

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
      text: normalizePageTitle(ref.text),
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
      conditions:
        query.conditions?.map((condition: any) =>
          condition.type === "page_ref"
            ? { ...condition, text: normalizePageTitle(condition.text) }
            : condition
        ) || [],
    }));
  }

  // CRITICAL FIX: Prevent double interpretation
  // If we have pageReferences, remove them from limitToPages to avoid double constraint
  if (
    sanitized.pageReferences?.length > 0 &&
    sanitized.constraints?.limitToPages?.length > 0
  ) {
    const referencedPages = sanitized.pageReferences.map((ref: any) =>
      ref.text.toLowerCase()
    );
    const originalLimitCount = sanitized.constraints.limitToPages.length;

    sanitized.constraints.limitToPages =
      sanitized.constraints.limitToPages.filter(
        (page: string) => !referencedPages.includes(page.toLowerCase())
      );

    const removedCount =
      originalLimitCount - sanitized.constraints.limitToPages.length;
    if (removedCount > 0) {
      console.log(
        `🧹 [PageRefSanitizer] Removed ${removedCount} duplicate pages from limitToPages to prevent double interpretation`
      );

      // If no pages left in limitToPages, remove the constraint entirely
      if (sanitized.constraints.limitToPages.length === 0) {
        delete sanitized.constraints.limitToPages;
      }
    }
  }

  return sanitized;
};

/**
 * Sanitize regex patterns for Datomic compatibility
 * Handles JavaScript /pattern/flags format and ensures proper escaping for Datomic
 */
export const sanitizeRegexForDatomic = (
  pattern: string
): { pattern: string; isCaseInsensitive: boolean } => {
  let sanitizedPattern = pattern.trim();
  let isCaseInsensitive = false;

  // Handle JavaScript /pattern/flags format
  const jsRegexMatch = sanitizedPattern.match(/^\/(.+)\/([gimuy]*)$/);
  if (jsRegexMatch) {
    sanitizedPattern = jsRegexMatch[1];
    const flags = jsRegexMatch[2];
    isCaseInsensitive = flags.includes("i");
    console.log(
      `🧹 Converted JavaScript regex /${jsRegexMatch[1]}/${flags} to Datomic format`
    );
  }

  // Check if pattern already has (?i) flag
  if (sanitizedPattern.startsWith("(?i)")) {
    isCaseInsensitive = true;
  }

  // Double-escape single backslashes for Datomic
  // This handles \s -> \\s, \b -> \\b, etc.
  const originalPattern = sanitizedPattern;

  // Replace single backslashes with double backslashes, but don't touch already double-escaped ones
  // First, temporarily replace existing double backslashes with a placeholder
  const placeholder = "___DOUBLE_BACKSLASH___";
  sanitizedPattern = sanitizedPattern.replace(/\\\\/g, placeholder);

  // Now double-escape remaining single backslashes
  sanitizedPattern = sanitizedPattern.replace(/\\/g, "\\\\");

  // Restore the original double backslashes
  sanitizedPattern = sanitizedPattern.replace(
    new RegExp(placeholder, "g"),
    "\\\\\\\\"
  );

  if (originalPattern !== sanitizedPattern) {
    console.log(
      `🧹 Double-escaped backslashes for Datomic: ${originalPattern} -> ${sanitizedPattern}`
    );
  }

  return {
    pattern: sanitizedPattern,
    isCaseInsensitive,
  };
};

/**
 * Page-wide query builder for findPagesByContent
 * Implements page-wide AND/OR semantics where conditions can match across different blocks
 */
export class PageWideQueryBuilder {
  constructor(
    private conditions: SearchCondition[],
    private combination: "AND" | "OR",
    private baseQuery: string = "[:find ?page-uid ?page-title :where [?page :node/title ?page-title] [?page :block/uid ?page-uid]",
    private excludeBlockUid?: string
  ) {}

  /**
   * Build page-wide query based on combination logic
   */
  buildPageWideQuery(): { query: string; patternDefinitions: string } {
    if (this.combination === "AND") {
      return this.buildPageWideAND();
    } else {
      return this.buildPageWideOR();
    }
  }

  /**
   * Build page-wide AND query: each condition can match in different blocks
   * A + B - C = page has A somewhere AND B somewhere AND NOT C anywhere
   */
  private buildPageWideAND(): { query: string; patternDefinitions: string } {
    const positiveConditions = this.conditions.filter((c) => !c.negate);
    const negativeConditions = this.conditions.filter((c) => c.negate);

    let query = this.baseQuery;
    let patternDefinitions = "";
    let patternIndex = 0;

    // Each positive condition gets its own block variable
    positiveConditions.forEach((condition, i) => {
      query += `\n                [?block-${i} :block/page ?page]`;

      // Exclude user query block if specified
      if (this.excludeBlockUid) {
        query += `\n                [?block-${i} :block/uid ?block-${i}-uid]`;
        query += `\n                [(not= ?block-${i}-uid "${this.excludeBlockUid}")]`;
      }

      // Only add :block/string for text/regex conditions
      if (condition.type === "text" || condition.type === "regex") {
        query += `\n                [?block-${i} :block/string ?content-${i}]`;
        const { clause, patterns } = this.buildConditionClause(
          condition,
          patternIndex,
          `?content-${i}`
        );
        query += clause;
        patternDefinitions += patterns;
      } else {
        // For page_ref/block_ref conditions, use block variable directly
        const { clause, patterns } = this.buildConditionClause(
          condition,
          patternIndex,
          `?content-${i}` // buildConditionClause will convert ?content to ?block internally
        );
        query += clause;
        patternDefinitions += patterns;
      }
      patternIndex++;
    });

    // Negative conditions use not-join to exclude entire pages
    negativeConditions.forEach((condition, i) => {
      query += `\n                (not-join [?page]`;
      query += `\n                  [?block-neg-${i} :block/page ?page]`;

      // Exclude user query block if specified
      if (this.excludeBlockUid) {
        query += `\n                  [?block-neg-${i} :block/uid ?block-neg-${i}-uid]`;
        query += `\n                  [(not= ?block-neg-${i}-uid "${this.excludeBlockUid}")]`;
      }

      // Only add :block/string for text/regex conditions
      if (condition.type === "text" || condition.type === "regex") {
        query += `\n                  [?block-neg-${i} :block/string ?content-neg-${i}]`;
        const { clause, patterns } = this.buildConditionClause(
          { ...condition, negate: false },
          patternIndex,
          `?content-neg-${i}`
        );
        query += clause.replace(/\n                /g, "\n                  ");
        patternDefinitions += patterns;
      } else {
        // For page_ref/block_ref conditions, use content variable (will be converted internally)
        const { clause, patterns } = this.buildConditionClause(
          { ...condition, negate: false },
          patternIndex,
          `?content-neg-${i}` // buildConditionClause will convert ?content to ?block internally
        );
        query += clause.replace(/\n                /g, "\n                  ");
        patternDefinitions += patterns;
      }
      query += `\n                )`;
      patternIndex++;
    });

    query += `]`;
    return { query, patternDefinitions };
  }

  /**
   * Build page-wide OR query: page matches if ANY condition matches in ANY block
   */
  private buildPageWideOR(): { query: string; patternDefinitions: string } {
    let query = this.baseQuery;
    let patternDefinitions = "";

    // For OR logic, we can use a single block variable with or-join
    query += `\n                [?block :block/page ?page]`;

    // Exclude user query block if specified
    if (this.excludeBlockUid) {
      query += `\n                [?block :block/uid ?block-uid]`;
      query += `\n                [(not= ?block-uid "${this.excludeBlockUid}")]`;
    }

    query += `\n                (or-join [?page]`;

    this.conditions.forEach((condition, i) => {
      const { clause, patterns } = this.buildConditionClause(
        condition,
        i,
        "?content"
      );

      if (condition.negate) {
        query += `\n                  (not`;
        query += clause.replace(
          /\n                /g,
          "\n                    "
        );
        query += `\n                  )`;
      } else {
        query += `\n                  (and`;
        query += clause.replace(
          /\n                /g,
          "\n                    "
        );
        query += `\n                  )`;
      }

      patternDefinitions += patterns;
    });

    query += `\n                )`;
    query += `]`;
    return { query, patternDefinitions };
  }

  /**
   * Build condition clause for a single condition
   */
  private buildConditionClause(
    condition: SearchCondition,
    patternIndex: number,
    contentVar: string
  ): { clause: string; patterns: string } {
    let clause = "";
    let patterns = "";

    switch (condition.type) {
      case "page_ref":
        // Use proper Roam :block/refs attribute
        clause = `\n                [?ref-page${patternIndex} :node/title "${condition.text}"]`;
        clause += `\n                [${contentVar.replace(
          "?content",
          "?block"
        )} :block/refs ?ref-page${patternIndex}]`;
        break;

      case "block_ref":
        // Use proper Roam :block/refs attribute for block references
        clause = `\n                [?ref-block${patternIndex} :block/uid "${condition.text}"]`;
        clause += `\n                [${contentVar.replace(
          "?content",
          "?block"
        )} :block/refs ?ref-block${patternIndex}]`;
        break;

      case "regex":
      case "text":
      default:
        // Use regex pattern matching
        const isRegex =
          condition.type === "regex" || condition.matchType === "regex";
        let pattern: string;

        if (isRegex) {
          const { pattern: sanitizedPattern } = sanitizeRegexForDatomic(
            condition.text
          );
          pattern = sanitizedPattern;
        } else {
          // Escape special regex characters for text matching
          const escapedText = condition.text.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );
          pattern =
            condition.matchType === "exact"
              ? `^${escapedText}$`
              : `(?i).*${escapedText}.*`;
        }

        clause = `\n                [(re-pattern "${pattern}") ?pattern${patternIndex}]`;
        clause += `\n                [(re-find ?pattern${patternIndex} ${contentVar})]`;
        break;
    }

    return { clause, patterns };
  }
}

/**
 * Process condition groups for page-wide search
 * Maps conditionGroups to appropriate page-wide query structure
 */
export const processConditionGroupsForPageWide = (
  conditionGroups: any[],
  groupCombination: "AND" | "OR"
): { conditions: SearchCondition[]; combination: "AND" | "OR" } => {
  // Convert grouped conditions to flat structure for page-wide processing
  // Each group will be handled as a single logical unit

  if (groupCombination === "AND") {
    // For AND between groups, we need each group to match in the page
    // This requires special handling for OR groups (convert to regex)
    const processedConditions: SearchCondition[] = [];

    conditionGroups.forEach((group) => {
      if (group.combination === "OR" && group.conditions.length > 1) {
        // Convert OR group to single regex condition for page-wide search
        const regexParts = group.conditions.map((c: any) => {
          if (c.type === "page_ref") {
            const escapedText = c.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return `.*(\\[\\[${escapedText}\\]\\]|#${escapedText}|${escapedText}::).*`;
          } else {
            const escapedText = c.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return `.*${escapedText}.*`;
          }
        });

        const combinedRegex = `(?i)(${regexParts.join("|")})`;
        processedConditions.push({
          type: "regex",
          text: combinedRegex,
          matchType: "regex",
          negate: false,
        } as SearchCondition);
      } else {
        // AND group or single condition - add all conditions
        processedConditions.push(...group.conditions);
      }
    });

    return { conditions: processedConditions, combination: "AND" };
  } else {
    // For OR between groups, flatten all conditions
    const allConditions = conditionGroups.flatMap((group) => group.conditions);
    return { conditions: allConditions, combination: "OR" };
  }
};

/**
 * Parse syntax patterns for page-wide vs same-block search
 * Supports: page:(content:...) for page-wide, page:(block:(...)) for same-block
 */
export const parsePageSearchSyntax = (
  query: string
): {
  searchScope: "content" | "block";
  extractedQuery: string;
} => {
  // Check for page:(block:(...)) pattern
  const blockScopeMatch = query.match(/page:\s*\(\s*block:\s*\((.*?)\)\s*\)/i);
  if (blockScopeMatch) {
    return {
      searchScope: "block",
      extractedQuery: blockScopeMatch[1],
    };
  }

  // Check for page:(content:...) pattern
  const contentScopeMatch = query.match(/page:\s*\(\s*content:\s*(.*?)\s*\)/i);
  if (contentScopeMatch) {
    return {
      searchScope: "content",
      extractedQuery: contentScopeMatch[1],
    };
  }

  // Default: assume content-wide search for findPagesByContent
  return {
    searchScope: "content",
    extractedQuery: query,
  };
};

/**
 * Automatic semantic expansion for search tools
 * Tries progressively more semantic expansions until results are found
 * 
 * @param originalParams - Original search parameters
 * @param searchFunction - Function to execute search (tool implementation)
 * @param state - Agent state containing automatic expansion settings
 * @param startingExpansion - Optional starting expansion type (defaults to first in sequence)
 * @returns Promise with results and expansion metadata
 */
export async function automaticSemanticExpansion<T, R>(
  originalParams: T,
  searchFunction: (params: T, state?: any) => Promise<R>,
  state?: any,
  startingExpansion?: string
): Promise<{
  results: R;
  expansionUsed: string | null;
  expansionAttempts: string[];
  finalAttempt: boolean;
}> {
  // Semantic expansion sequence: fuzzy -> synonyms -> related_concepts -> broader_terms
  const expansionSequence = ['fuzzy', 'synonyms', 'related_concepts', 'broader_terms'];
  
  // Determine starting point in sequence
  let startIndex = 0;
  if (startingExpansion) {
    const foundIndex = expansionSequence.indexOf(startingExpansion);
    if (foundIndex !== -1) {
      startIndex = foundIndex;
    }
  }
  
  const attemptedExpansions: string[] = [];
  let bestResults: R | null = null;
  let bestResultsExpansion: string | null = null;
  
  // Try original query first (no expansion)
  console.log(`🔍 [AutoExpansion] Trying original query (no expansion)`);
  attemptedExpansions.push('none');
  
  try {
    const originalResults = await searchFunction(originalParams, state);
    // Check if we got results (assuming results have a .data array or similar)
    const hasResults = (originalResults as any)?.data?.length > 0 || 
                      (originalResults as any)?.results?.length > 0 ||
                      (Array.isArray(originalResults) && originalResults.length > 0);
    
    if (hasResults) {
      console.log(`✅ [AutoExpansion] Original query found results, no expansion needed`);
      return {
        results: originalResults,
        expansionUsed: null,
        expansionAttempts: attemptedExpansions,
        finalAttempt: false
      };
    }
    
    bestResults = originalResults; // Keep as fallback
  } catch (error) {
    console.warn(`⚠️ [AutoExpansion] Original query failed:`, error);
  }
  
  // Try semantic expansions in sequence
  for (let i = startIndex; i < expansionSequence.length; i++) {
    const expansionType = expansionSequence[i];
    const isLastAttempt = i === expansionSequence.length - 1;
    
    console.log(`🔍 [AutoExpansion] Trying expansion: ${expansionType} ${isLastAttempt ? '(final attempt)' : ''}`);
    attemptedExpansions.push(expansionType);
    
    try {
      // Modify params to include semantic expansion
      const expandedParams = {
        ...originalParams,
        // Add semantic expansion to conditions if they exist
        ...(((originalParams as any)?.conditions) && {
          conditions: ((originalParams as any).conditions as any[]).map((condition: any) => ({
            ...condition,
            semanticExpansion: expansionType
          }))
        }),
        // Also set global semantic expansion for tools that use it
        semanticExpansion: expansionType,
      } as T;
      
      // Create expanded state with global expansion flag
      const expandedState = {
        ...state,
        isExpansionGlobal: true,
        semanticExpansion: expansionType,
      };
      
      const expandedResults = await searchFunction(expandedParams, expandedState);
      
      // Check if this expansion found results
      const hasResults = (expandedResults as any)?.data?.length > 0 || 
                        (expandedResults as any)?.results?.length > 0 ||
                        (Array.isArray(expandedResults) && expandedResults.length > 0);
      
      if (hasResults) {
        console.log(`✅ [AutoExpansion] Found results with ${expansionType} expansion`);
        return {
          results: expandedResults,
          expansionUsed: expansionType,
          expansionAttempts: attemptedExpansions,
          finalAttempt: isLastAttempt
        };
      }
      
      // Keep the latest results as fallback
      bestResults = expandedResults;
      bestResultsExpansion = expansionType;
      
    } catch (error) {
      console.warn(`⚠️ [AutoExpansion] Expansion ${expansionType} failed:`, error);
    }
  }
  
  // No expansion found results, return the best attempt we have
  console.log(`😟 [AutoExpansion] No expansion found results, returning best attempt (${bestResultsExpansion || 'original'})`);
  return {
    results: bestResults!,
    expansionUsed: bestResultsExpansion,
    expansionAttempts: attemptedExpansions,
    finalAttempt: true
  };
}
