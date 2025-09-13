import { dnpUidRegex } from "../../../../utils/regex.js";
import { modelViaLanggraph } from "../../langraphModelsLoader";
import { HumanMessage } from "@langchain/core/messages";
import { modelAccordingToProvider } from "../../../aiAPIsHub.js";
import { defaultModel } from "../../../../index.js";
import { updateAgentToaster } from "../../shared/agentsUtils";

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
      ? "3-6"
      : strategy !== "custom"
      ? "6-12"
      : "as many as needed";
  const contextualInfo =
    originalQuery && originalQuery !== text
      ? `\n\nContext: This term appears in the user query: "${originalQuery}". Consider this context when generating expansions.`
      : "";

  const languageInfo = userLanguage
    ? `\n\nLanguage: The user is working in ${userLanguage}. Generate terms appropriate for this language and consider language-specific morphological patterns.`
    : "";

  // Common escaping instruction for text mode
  const textModeEscapingInfo =
    mode === "text"
      ? "\n\nIMPORTANT: Do NOT escape the ? character when used for optional matching (like word?). Only escape . * + ^ $ { } [ ] \\ ' in simple terms. Keep proper regex syntax like (?:) | completely unescaped."
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
${originalTermText}${modeGuidance}${
      previousTerms
        ? "\n- Generate completely NEW terms that complement but do not repeat the previous variations"
        : ""
    }`;
  };

  const strategyPrompts = {
    synonyms:
      mode === "text"
        ? `Generate synonyms and alternative terms for: "${text}". Include words with similar meanings (they don't need to be exact matches), and common morphological variations or alternative phrasings only when useful for broadening search, using regex syntax.

${textModeEscapingInfo.slice(2)}

Examples for "organize":
organiz(?:e|ing|ation)
structur(?:e|ing)
arrang(?:e|ing)
plan(?:ning)?
manag(?:e|ing)
sort(?:ed|ing)?

Examples for "task":
assignment
job
work
duty
activity
to-do
item${contextualInfo}${languageInfo}`
        : `Generate synonyms and alternative terms for: "${text}" that could be page titles. Include words with similar meanings and common morphological variations only when useful for broadening search.

Examples for "organize":
organizing
organized
organization
structure
structuring
arrange
arranging
plan
management
sorting

Examples for "task":
assignment
job
work
duty
activity
activities
to-do
items${contextualInfo}${languageInfo}`,

    related_concepts:
      mode === "text"
        ? `Generate related concepts for: "${text}". Go BEYOND synonyms - include terms from the same semantic domain, commonly co-occurring concepts, and contextually associated ideas. These should expand the semantic circle but stay within the conceptual field.

Examples for "project":
planning
manag(?:e|ing|ement)
timeline
milestone
deliverable
team
goal
task
budget
resource

Examples for "write":
writ(?:e|ing|ten)
document(?:s|ation)?
draft(?:s|ing)?
content
publish(?:ing|ed)?
article
note
edit(?:ing|or)?
revision${contextualInfo}${languageInfo}`
        : `Generate related concepts for: "${text}" that could be page titles. Go BEYOND synonyms - include terms from the same semantic domain and contextually associated ideas.

Examples for "project":
projects
planning
management
managing
timeline
milestones
deliverables
team
goals
tasks
budget
resources

Examples for "write":
writing
written
writer
document
draft
content
publishing
articles
notes
editing
editor
revision${contextualInfo}${languageInfo}`,

    broader_terms:
      mode === "text"
        ? `Generate broader, higher-level terms that encompass: "${text}". Think of parent categories, umbrella concepts, and abstract generalizations that SIGNIFICANTLY widen the semantic scope. These should represent conceptual hierarchies above the original term.

Examples for "meeting":
meet(?:s|ing)
event
gathering
session
discussion
communication
conferenc(?:e|ing)
collaboration
interaction
engagement

Examples for "car":
vehicle
transport(?:ation)?
automobile
mobilit(?:y|ies)
travel
commut(?:e|ing)
infrastructur(?:e)?
logistic${contextualInfo}${languageInfo}`
        : `Generate broader, higher-level terms that encompass: "${text}" that could be page titles. Think of parent categories and abstract generalizations that SIGNIFICANTLY widen the semantic scope.

Examples for "meeting":
event
gathering
session
discussions
communication
conference
collaboration
interaction
engagement

Examples for "car":
cars
vehicle
transportation
automobile
mobility
travel
commuting
infrastructure
logistic${contextualInfo}${languageInfo}`,

    fuzzy:
      mode === "text"
        ? `Generate fuzzy variations for: "${text}". Include morphological variations (systematic when they broaden search without false positives), common typos, alternative spellings, and word completion for partial words. Use regex format like organiz(?:e|es|ed|ing) when multiple variations exist.

IMPORTANT: Do NOT escape the ? character when used for optional matching (like word?). Only escape . * + ^ $ { } [ ] \ in simple terms. Keep proper regex syntax like (?:) | completely unescaped.

Examples for "pend" (incomplete word):
pend(?:s|ing|ed)?
pendin
pendng
pening

Examples for "organize" (complete word):
organiz(?:e|es|ed|ing|ation)
organis(?:e|es|ed|ing|ation)
orgnaiz
orgainze${contextualInfo}${languageInfo}`
        : `Generate fuzzy variations for: "${text}" that could be actual page titles. Include word completion for partial words and common typos.

Examples for "pend" (incomplete word):
pending
pended
pends
pendin
pendng
pening

Examples for "organize" (complete word):
organizing
organized
organization
organisation
orgnaize
orgainze${contextualInfo}${languageInfo}`,

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

    // CRITICAL: Remove duplicates to prevent Datomic set crashes
    const uniqueTerms = [...new Set(terms)] as string[];

    if (uniqueTerms.length !== terms.length) {
      console.log(
        `🔧 Removed ${
          terms.length - uniqueTerms.length
        } duplicate terms from semantic expansions`
      );
    }

    console.log(
      `🔍 Generated ${uniqueTerms.length} semantic expansions for "${text}":`,
      uniqueTerms
    );
    return uniqueTerms;
  } catch (error) {
    console.error("Failed to generate semantic expansions:", error);
    throw new Error(`Semantic expansion failed: ${error.message}`);
  }
};

/**
 * Shared expansion logic for all search tools
 * Handles semantic expansion with consistent caching and toaster updates
 */
export const expandConditionsShared = async (
  conditions: any[],
  state?: any
): Promise<any[]> => {
  const expandedConditions = [...conditions];

  // Check if semantic expansion is needed - either globally or per-condition
  const hasGlobalExpansion = state?.isExpansionGlobal === true;

  // Check if any condition has symbols that require expansion
  const hasSymbolExpansion = conditions.some(
    (c) => c.text.endsWith("*") || c.text.endsWith("~")
  );

  if (!hasGlobalExpansion && !hasSymbolExpansion) {
    return expandedConditions;
  }

  // Show expansion progress only once per session
  const conditionsToExpand = conditions.filter(
    (c) =>
      !state?.disableSemanticExpansion &&
      ((c.semanticExpansion && (c.type === "text" || c.type === "page_ref")) ||
        (hasGlobalExpansion && (c.type === "text" || c.type === "page_ref")))
  );

  if (conditionsToExpand.length > 0 && !state?.expansionToasterShown) {
    updateAgentToaster(`🔍 Expanding search with related terms...`);
    // Mark that we've shown the toaster to prevent repeated messages
    if (state) {
      state.expansionToasterShown = true;
    }
  }

  const finalExpandedConditions = [];

  for (const condition of conditions) {
    // Convert to structured condition format
    const structuredCondition = {
      type: condition.type,
      text: condition.text,
      matchType: condition.matchType || "contains",
      semanticExpansion: condition.semanticExpansion,
      weight: condition.weight || 1.0,
      negate: condition.negate || false,
    };

    // Apply semantic expansion if needed
    if (
      structuredCondition.type === "regex" ||
      (!hasGlobalExpansion && !structuredCondition.semanticExpansion)
    ) {
      // No expansion needed
      finalExpandedConditions.push(structuredCondition);
      continue;
    }

    // Parse semantic expansion from condition text
    const { cleanText, expansionType } = parseSemanticExpansion(
      structuredCondition.text,
      state?.semanticExpansion
    );

    // Determine final expansion strategy: per-condition > global
    let effectiveExpansionStrategy = expansionType;
    if (!effectiveExpansionStrategy && hasGlobalExpansion) {
      effectiveExpansionStrategy = state?.semanticExpansion || "synonyms";
    }

    if (effectiveExpansionStrategy && structuredCondition.type === "text") {
      try {
        const customStrategy =
          effectiveExpansionStrategy === "custom"
            ? state?.customSemanticExpansion
            : undefined;

        // Show expansion progress in toaster
        const strategyLabel = getExpansionStrategyLabel(
          effectiveExpansionStrategy
        );

        updateAgentToaster(`🔍 Expanding "${cleanText}" (${strategyLabel})...`);

        // Initialize expansion cache if not exists
        if (!state?.expansionCache) {
          state = { ...state, expansionCache: new Map() };
        }

        // Create cache key for this condition
        const cacheKey = `shared|${cleanText}|${effectiveExpansionStrategy}|text|${
          state?.userQuery || ""
        }`;

        let expansionTerms;
        if (state.expansionCache.has(cacheKey)) {
          // Reuse cached expansion results
          expansionTerms = state.expansionCache.get(cacheKey);
          console.log(
            `🔄 [SharedExpansion] Reusing cached expansion for "${cleanText}"`
          );
        } else {
          // Generate semantic expansions
          const userLanguage = state?.language || "English"; // Fallback to English if language not detected

          expansionTerms = await generateSemanticExpansions(
            cleanText,
            effectiveExpansionStrategy as any,
            state?.userQuery,
            state?.model,
            userLanguage,
            customStrategy,
            "text"
          );

          // Cache the results
          state.expansionCache.set(cacheKey, expansionTerms);
          console.log(
            `💾 [SharedExpansion] Cached expansion for "${cleanText}": ${expansionTerms.length} terms`
          );
        }

        // Create expanded regex condition
        if (expansionTerms.length > 0) {
          const allTerms = [cleanText, ...expansionTerms];
          const escapedTerms = allTerms.map(smartEscape);
          const regexPattern = `(${escapedTerms.join("|")})`;


          // Show completion in toaster
          updateAgentToaster(
            `🔍 Expanded "${cleanText}" (${strategyLabel}) → ${cleanText}, ${expansionTerms.join(
              ", "
            )}`
          );

          finalExpandedConditions.push({
            ...structuredCondition,
            type: "regex",
            text: regexPattern,
            matchType: "regex",
            semanticExpansion: undefined,
          });
        } else {
          // No expansion terms found, use clean text
          finalExpandedConditions.push({
            ...structuredCondition,
            text: cleanText,
            semanticExpansion: undefined,
          });
        }
      } catch (error) {
        console.warn(
          `Failed to expand condition "${structuredCondition.text}":`,
          error
        );
        finalExpandedConditions.push({
          ...structuredCondition,
          text: cleanText,
          semanticExpansion: undefined,
        });
      }
    } else {
      // Non-text condition or no expansion strategy
      finalExpandedConditions.push({
        ...structuredCondition,
        text: cleanText,
        semanticExpansion: undefined,
      });
    }
  }

  return finalExpandedConditions;
};

/**
 * Get user-friendly label for expansion strategy
 */
export const getExpansionStrategyLabel = (strategy: string): string => {
  switch (strategy) {
    case "fuzzy":
      return "fuzzy";
    case "synonyms":
      return "synonyms";
    case "related_concepts":
      return "related terms";
    case "broader_terms":
      return "broader terms";
    case "custom":
      return "custom";
    case "all":
      return "all types";
    default:
      return strategy || "unknown";
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
 * Smart escape function that only escapes simple text terms, not regex patterns
 * Detects if a term is already a regex pattern and avoids double-escaping
 */
const smartEscape = (term: string): string => {
  // Check if term contains regex syntax (non-capturing groups, character classes, etc.)
  const hasRegexSyntax = /\(\?[:!]|[\[\]{}]|\|/.test(term);

  // Check if term has already escaped characters (like statuse\\? instead of statuse?)
  const hasEscapedChars = /\\[.*+?^${}()|[\]\\]/.test(term);

  if (hasRegexSyntax) {
    // Term appears to be a regex pattern - don't escape regex syntax
    // Clean up any double-escaped question marks that shouldn't be escaped
    return term.replace(/\\\?(?![:=!])/g, "?"); // Un-escape ? unless it's part of (?:, (?=, etc.
  } else if (hasEscapedChars) {
    // Term has escaped chars but no regex syntax - clean up double escaping
    // Un-escape question marks that were incorrectly escaped
    let cleaned = term.replace(/\\\?/g, "?");
    // Then properly escape what should be escaped (but not ?)
    return cleaned.replace(/[.*+^${}()|[\]\\]/g, "\\$&");
  } else {
    // Simple text term - escape regex special characters except ?
    return term.replace(/[.*+^${}()|[\]\\]/g, "\\$&");
  }
};

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
  const expansionSequence = [
    "fuzzy",
    "synonyms",
    "related_concepts",
    "broader_terms",
  ];

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
  attemptedExpansions.push("none");

  try {
    const originalResults = await searchFunction(originalParams, state);
    // Check if we got results (handle different return formats)
    const hasResults =
      (originalResults as any)?.data?.length > 0 ||
      (originalResults as any)?.results?.length > 0 ||
      (Array.isArray(originalResults) && originalResults.length > 0);

    if (hasResults) {
      console.log(
        `✅ [AutoExpansion] Original query found results, no expansion needed`
      );
      return {
        results: originalResults,
        expansionUsed: null,
        expansionAttempts: attemptedExpansions,
        finalAttempt: false,
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

    console.log(
      `🔍 [AutoExpansion] Trying expansion: ${expansionType} ${
        isLastAttempt ? "(final attempt)" : ""
      }`
    );
    attemptedExpansions.push(expansionType);

    try {
      // Modify params to include semantic expansion
      const expandedParams = {
        ...originalParams,
        // Add semantic expansion to conditions if they exist
        ...((originalParams as any)?.conditions && {
          conditions: ((originalParams as any).conditions as any[]).map(
            (condition: any) => ({
              ...condition,
              semanticExpansion: expansionType,
            })
          ),
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

      const expandedResults = await searchFunction(
        expandedParams,
        expandedState
      );

      // Check if this expansion found results (handle different return formats)
      const dataLength = (expandedResults as any)?.data?.length || 0;
      const resultsLength = (expandedResults as any)?.results?.length || 0;
      const arrayLength = Array.isArray(expandedResults)
        ? expandedResults.length
        : 0;

      console.log(
        `🔍 [AutoExpansion] ${expansionType} results check: data=${dataLength}, results=${resultsLength}, array=${arrayLength}`
      );

      const hasResults = dataLength > 0 || resultsLength > 0 || arrayLength > 0;

      if (hasResults) {
        console.log(
          `✅ [AutoExpansion] Found results with ${expansionType} expansion`
        );
        return {
          results: expandedResults,
          expansionUsed: expansionType,
          expansionAttempts: attemptedExpansions,
          finalAttempt: isLastAttempt,
        };
      }

      // Keep the latest results as fallback
      bestResults = expandedResults;
      bestResultsExpansion = expansionType;
    } catch (error) {
      console.warn(
        `⚠️ [AutoExpansion] Expansion ${expansionType} failed:`,
        error
      );
    }
  }

  // No expansion found results, return the best attempt we have
  console.log(
    `😟 [AutoExpansion] No expansion found results, returning best attempt (${
      bestResultsExpansion || "original"
    })`
  );
  return {
    results: bestResults!,
    expansionUsed: bestResultsExpansion,
    expansionAttempts: attemptedExpansions,
    finalAttempt: true,
  };
}

/**
 * Shared automatic expansion wrapper for all search tools
 * Handles expansion state management, two-phase execution, and retry logic
 *
 * @param toolName - Name of the tool for logging and result metadata
 * @param toolImpl - The tool implementation function
 * @param input - Tool input parameters
 * @param config - LangChain config with state
 * @returns Promise with tool result including expansion metadata
 */
export async function withAutomaticExpansion<T, R>(
  toolName: string,
  toolImpl: (input: T, state?: any) => Promise<R>,
  input: T,
  config: any
): Promise<string> {
  const startTime = performance.now();

  // Extract state from config
  const state = config?.configurable?.state;
  console.log(
    `🔧 [${toolName}] Tool called with expansion mode: ${state?.automaticExpansionMode}`
  );

  // Auto-enrich input with internal parameters from agent state (shared logic across all tools)
  const inputAny = input as any; // Type assertion for enrichment
  const enrichedInput = {
    ...input,
    // Internal parameters injected from agent state (not from LLM)
    resultMode: state?.privateMode
      ? ("uids_only" as const)
      : ("summary" as const),
    secureMode: state?.privateMode || false,
    userQuery: state?.userQuery || "",
    excludeBlockUid: state?.rootUid || "",
    expansionLevel: state?.expansionLevel || 0,
    // Internal defaults not exposed to LLM (only set if not already provided)
    purpose: inputAny.purpose || ("final" as const),
    sortBy: inputAny.sortBy || ("relevance" as const),
    sortOrder: inputAny.sortOrder || ("desc" as const),
    limit: inputAny.limit || 500,
    summaryLimit: inputAny.summaryLimit || 20,
    childDepth: inputAny.childDepth || 2,
    parentDepth: inputAny.parentDepth || 1,
    includeDaily:
      inputAny.includeDaily !== undefined ? inputAny.includeDaily : true,
    dailyNotesOnly: inputAny.dailyNotesOnly || false,
    // Inject dateRange from agent state if not provided in input
    dateRange: inputAny.dateRange || state?.searchDetails?.timeRange,
    randomSample: inputAny.randomSample || { enabled: false, size: 100 },
    fuzzyThreshold: inputAny.fuzzyThreshold || 0.8,
  };

  // Check if we should use automatic semantic expansion (ONLY for auto_until_result)
  // Skip if disabled by hierarchy tool (which sets mode to "disabled_by_hierarchy")
  if (state?.automaticExpansionMode === "auto_until_result") {
    console.log(
      `🔧 [${toolName}] Using automatic expansion for auto_until_result mode`
    );

    // Use automatic expansion starting from fuzzy
    const expansionResult = await automaticSemanticExpansion(
      enrichedInput,
      (params: T, state?: any) => toolImpl(params, state),
      state
    );

    // Log expansion results
    if (expansionResult.expansionUsed) {
      console.log(
        `✅ [${toolName}] Found results with ${expansionResult.expansionUsed} expansion`
      );
    } else {
      console.log(
        `😟 [${toolName}] No expansion found results, tried: ${expansionResult.expansionAttempts.join(
          ", "
        )}`
      );
    }

    // For tools that return direct arrays (like findPagesByContent), expansionResult.results IS the array
    // For tools that return {results, metadata}, we need to extract accordingly
    const resultsData = expansionResult.results as any;
    const actualResults = Array.isArray(resultsData)
      ? resultsData
      : resultsData?.results || resultsData;
    const metadata = Array.isArray(resultsData)
      ? {}
      : resultsData?.metadata || {};

    return createToolResult(
      true,
      actualResults,
      undefined,
      toolName,
      startTime,
      {
        ...metadata,
        automaticExpansion: {
          used: expansionResult.expansionUsed,
          attempts: expansionResult.expansionAttempts,
          finalAttempt: expansionResult.finalAttempt,
        },
      }
    );
  }

  // Handle automatic expansion modes
  let expansionStates = {
    isExpansionGlobal: state?.isExpansionGlobal || false,
    semanticExpansion: state?.semanticExpansion || null,
  };

  if (state?.automaticExpansionMode) {
    const expansionMode = state.automaticExpansionMode;
    console.log(`🔧 [${toolName}] Checking expansion mode: ${expansionMode}`);

    // Set expansion states based on mode (only if not already set by user actions)
    if (!state?.isExpansionGlobal) {
      switch (expansionMode) {
        case "always_fuzzy":
        case "Always with fuzzy":
          expansionStates.isExpansionGlobal = true;
          expansionStates.semanticExpansion = "fuzzy";
          console.log(
            `🔧 [${toolName}] Auto-enabling fuzzy expansion due to mode: ${expansionMode}`
          );
          break;
        case "always_synonyms":
        case "Always with synonyms":
          expansionStates.isExpansionGlobal = true;
          expansionStates.semanticExpansion = "synonyms";
          console.log(
            `🔧 [${toolName}] Auto-enabling synonyms expansion due to mode: ${expansionMode}`
          );
          break;
        case "always_all":
        case "Always with all":
          expansionStates.isExpansionGlobal = true;
          expansionStates.semanticExpansion = "all";
          console.log(
            `🔧 [${toolName}] Auto-enabling all expansions due to mode: ${expansionMode}`
          );
          break;
      }
    }
  }

  // Store automatic expansion mode for later use
  const shouldUseAutomaticExpansion =
    state?.automaticExpansionMode === "auto_until_result";

  try {
    // First attempt: Execute without expansion for auto_until_result mode
    // For other modes (always_*), expansion is already enabled in expansionStates
    const initialState = shouldUseAutomaticExpansion
      ? {
          ...state,
          // Disable expansion for initial attempt in auto_until_result mode
          isExpansionGlobal: false,
          semanticExpansion: null,
          automaticExpansionMode: null, // Prevent sub-tools from triggering their own expansion
        }
      : {
          ...state,
          ...expansionStates,
          // Keep original automaticExpansionMode for this tool
        };

    const results = await toolImpl(enrichedInput, initialState);

    // Check if we got results
    const hasResults = Array.isArray(results) && results.length > 0;

    // If we have results from initial attempt, return them
    if (hasResults) {
      return createToolResult(true, results, undefined, toolName, startTime);
    }

    // No results - try expansion if auto_until_result or if always_* modes are enabled
    const shouldExpandAfterNoResults =
      shouldUseAutomaticExpansion || expansionStates.isExpansionGlobal;

    if (shouldExpandAfterNoResults) {
      console.log(
        `🔄 [${toolName}] No initial results, trying with semantic expansion...`
      );

      if (shouldUseAutomaticExpansion) {
        // Use automatic expansion starting from fuzzy
        const expansionResult = await automaticSemanticExpansion(
          input,
          (params: T, state?: any) => toolImpl(params, state),
          {
            ...state,
            ...expansionStates,
          }
        );

        return createToolResult(
          true,
          expansionResult.results,
          undefined,
          toolName,
          startTime,
          {
            automaticExpansion: {
              used: expansionResult.expansionUsed,
              attempts: expansionResult.expansionAttempts,
              finalAttempt: expansionResult.finalAttempt,
            },
          }
        );
      } else {
        // For always_* modes, try with expansion enabled
        const expandedResults = await toolImpl(enrichedInput, {
          ...state,
          ...expansionStates,
          // Keep original automaticExpansionMode
        });

        return createToolResult(
          true,
          expandedResults,
          undefined,
          toolName,
          startTime
        );
      }
    }

    // No expansion needed or available, return original results
    return createToolResult(true, results, undefined, toolName, startTime);
  } catch (error) {
    console.error(`${toolName} tool error:`, error);
    return createToolResult(
      false,
      undefined,
      error.message,
      toolName,
      startTime
    );
  }
}

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
  }
  // else if (toolName === "findPagesByTitle" && resultCount < 5) {
  //   suggestions.push("try_findPagesSemantically_for_discovery");
  // }

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
