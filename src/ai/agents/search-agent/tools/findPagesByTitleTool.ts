import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  executeDatomicQuery,
  isDailyNote,
  filterByDateRange,
  createToolResult,
  generateSemanticExpansions,
  parseSemanticExpansion,
} from "./searchUtils";
import { dnpUidRegex } from "../../../../utils/regex.js";

/**
 * Find pages by title conditions with flexible matching
 * Security Level: Secure (only accesses UIDs, titles, metadata)
 */

const titleConditionSchema = z.object({
  text: z.string().min(1, "Search text is required"),
  matchType: z.enum(["exact", "contains", "regex"]).default("contains"),
  weight: z.number().min(0).max(10).default(1.0),
  negate: z.boolean().default(false),
  isSemanticPage: z.boolean().optional(), // Flag for exact titles found via semantic expansion
  fuzzyMatching: z.boolean().optional(), // Flag for fuzzy matching enabled via '*' suffix
  semanticExpansion: z.enum(["fuzzy", "synonyms", "related_concepts", "broader_terms", "custom", "all"]).optional(), // Semantic expansion type from '~' suffix
  forceSemanticExpansion: z.boolean().optional(), // Force semantic expansion
  expansionLevel: z.number().optional(), // Track expansion level for relevance scoring
});

const schema = z.object({
  conditions: z
    .array(titleConditionSchema)
    .min(1, "At least one condition is required"),
  combineConditions: z.enum(["AND", "OR"]).default("AND"),
  includeDaily: z.boolean().default(false),
  dateRange: z
    .object({
      start: z.union([z.date(), z.string()]).optional(),
      end: z.union([z.date(), z.string()]).optional(),
    })
    .optional(),
  limit: z.number().min(1).max(1000).default(100),

  // Fuzzy matching for typos and approximate matches
  fuzzyMatching: z
    .boolean()
    .default(false)
    .describe("Enable typo tolerance for page title matching"),
  fuzzyThreshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.8)
    .describe("Similarity threshold for fuzzy matches (0=exact, 1=very loose)"),

  // Smart expansion feature
  smartExpansion: z
    .boolean()
    .default(false)
    .describe(
      "Enable smart page expansion - finds similar existing pages + semantic variations"
    ),
  semanticMode: z
    .boolean()
    .default(false)
    .describe(
      "Force semantic expansion - runs both regex + semantic steps (for user requests with ~ symbol)"
    ),
  expansionInstruction: z
    .string()
    .optional()
    .describe(
      "Optional instruction for LLM-guided expansion (e.g., 'find antagonist pages', 'all colors', etc.)"
    ),
});

// Minimal LLM-facing schema
const llmFacingSchema = z.object({
  conditions: z
    .array(
      z.object({
        text: z.string().min(1, "Page title or pattern to search for. For regex patterns, use clean pattern syntax (e.g., 'test.*page' or '(?i)status|state') without /regex:/ or /pattern/flags wrapper"),
        matchType: z
          .enum(["exact", "contains", "regex"])
          .default("contains")
          .describe(
            "exact=exact title match, contains=partial title match, regex=pattern matching. For regex: use matchType='regex' and put just the pattern in text field (e.g., text='test.*page', not 'regex:/test.*page/i')"
          ),
        negate: z
          .boolean()
          .default(false)
          .describe("Exclude pages matching this condition"),
      })
    )
    .min(1, "At least one search condition required"),
  combineConditions: z
    .enum(["AND", "OR"])
    .default("AND")
    .describe("AND=all conditions must match, OR=any condition matches"),
  includeDaily: z
    .boolean()
    .default(false)
    .describe("Include Daily Note Pages in results"),
  dateRange: z
    .object({
      start: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      end: z.string().optional().describe("End date (YYYY-MM-DD)"),
    })
    .optional()
    .describe("Limit to pages created within date range"),
  smartExpansion: z
    .boolean()
    .default(false)
    .describe(
      "Enable smart expansion: finds similar existing pages + generates semantic variations if needed"
    ),
  semanticMode: z
    .boolean()
    .default(false)
    .describe(
      "Force semantic expansion: runs both regex + semantic steps (use when user requests semantic variations with ~ symbol)"
    ),
  expansionInstruction: z
    .string()
    .optional()
    .describe(
      "Optional instruction for LLM-guided expansion (e.g., 'find antagonist pages', 'all colors', etc.)"
    ),
});

/**
 * Parse and clean regex patterns from user input
 * Handles formats like: regex:/pattern/flags, /pattern/flags, or plain patterns
 */
const parseRegexPattern = (text: string): { pattern: string, matchType: "exact" | "contains" | "regex", hasFlags: boolean } => {
  // Check for regex:/pattern/flags format
  const regexColonMatch = text.match(/^regex:\/(.+?)\/([gimuy]*)$/i);
  if (regexColonMatch) {
    const [, pattern, flags] = regexColonMatch;
    const hasIFlag = flags.includes('i');
    const cleanPattern = hasIFlag ? `(?i)${pattern}` : pattern;
    return { pattern: cleanPattern, matchType: "regex", hasFlags: true };
  }
  
  // Check for /pattern/flags format
  const slashMatch = text.match(/^\/(.+?)\/([gimuy]*)$/);
  if (slashMatch) {
    const [, pattern, flags] = slashMatch;
    const hasIFlag = flags.includes('i');
    const cleanPattern = hasIFlag ? `(?i)${pattern}` : pattern;
    return { pattern: cleanPattern, matchType: "regex", hasFlags: true };
  }
  
  // Check if it looks like a regex pattern (contains regex special chars)
  const regexChars = /[.*+?^${}()|[\]\\]/;
  if (regexChars.test(text)) {
    return { pattern: text, matchType: "regex", hasFlags: false };
  }
  
  // Default: treat as literal text
  return { pattern: text, matchType: "contains", hasFlags: false };
};

/**
 * Build expansion options specific to page title searches
 * Based on currently applied expansions and available options
 */
const buildPageTitleExpansionOptions = (
  appliedExpansions: string[] = [],
  hasResults: boolean = false,
  automaticExpansionEnabled: boolean = false
): string => {
  const options: string[] = [];

  // If automatic expansion is disabled and no results, suggest enabling it
  if (!hasResults && !automaticExpansionEnabled) {
    options.push("🤖 Enable automatic expansion (progressive levels)");
  }

  // Check what expansions haven't been applied yet
  const availableExpansions = [
    { key: "fuzzy", label: "🔍 Fuzzy matching (typos, morphological variations)", strategy: "fuzzy" },
    { key: "synonyms", label: "📝 Synonyms and alternative terms", strategy: "synonyms" },
    { key: "related", label: "🧠 Related concepts and associated terms", strategy: "related_concepts" },
    { key: "broader", label: "🌐 Broader terms and categories", strategy: "broader_terms" },
    { key: "all", label: "⚡ All at once (complete semantic expansion)", strategy: "all" }
  ];

  for (const expansion of availableExpansions) {
    if (!appliedExpansions.includes(expansion.strategy)) {
      options.push(expansion.label);
    }
  }

  // Always offer more targeted options
  if (hasResults) {
    options.push("🎯 Try more specific variations");
    options.push("🔄 Search with different title patterns");
  } else {
    options.push("🔍 Search page content instead of titles");
    options.push("📚 Look in hierarchical relationships");
  }

  return options.join("\n");
};

/**
 * Perform complete semantic expansion using all strategies
 * Always runs all expansion levels without stopping early
 */
const performCompleteExpansion = async (
  pageTitle: string,
  matchType: "exact" | "contains" | "regex" = "contains",
  instruction?: string,
  modelInfo?: any,
  userLanguage?: string,
  userQuery?: string,
  includeDaily: boolean = false
): Promise<{ conditions: any[], level: number, totalFound: number }> => {
  console.log(`🤖 [Complete] Starting complete expansion for "${pageTitle}" (${matchType})`);
  
  try {
    // Use "all" strategy to get comprehensive results
    const mode = matchType === "exact" ? "page_ref" : "text";
    const allVariations = await generateSemanticExpansions(
      pageTitle,
      "all", // This runs fuzzy -> synonyms -> related_concepts -> broader_terms
      userQuery || instruction || `Find pages with complete expansion of "${pageTitle}"`,
      modelInfo,
      userLanguage,
      undefined,
      mode
    );
    
    console.log(`🤖 [Complete] Generated ${allVariations.length} variations from all strategies:`, allVariations);
    
    let finalConditions: any[];
    
    if (matchType === "exact") {
      // For exact: create semantic page conditions
      finalConditions = [
        { text: pageTitle, matchType: "exact", isSemanticPage: false },
        ...allVariations.map((term, index) => ({
          text: term,
          matchType: "exact" as const,
          isSemanticPage: true,
          expansionLevel: Math.floor(index / 5) + 1 // Group variations by level
        }))
      ];
    } else {
      // For contains/regex: create composite regex with all variations
      const regexParts = [];
      
      // Add original page title (needs escaping since it's literal text)
      const escapedPageTitle = pageTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&");
      regexParts.push(`.*${escapedPageTitle}.*`);
      
      // Add variations (already regex patterns from mode="text", don't escape)
      allVariations.forEach(variation => {
        // Variations from mode="text" are already regex patterns, just wrap with .*
        regexParts.push(`.*${variation}.*`);
      });
      
      const compositeRegex = `(?i)(${regexParts.join("|")})`;
      
      finalConditions = [{
        text: compositeRegex,
        matchType: "regex" as const,
        expansionLevel: 4 // Highest level since it includes all strategies
      }];
    }
    
    // Test final results
    const totalFound = await testConditionsExistence(finalConditions, includeDaily);
    console.log(`🤖 [Complete] Complete expansion found ${totalFound} pages with ${allVariations.length} variations`);
    
    return { conditions: finalConditions, level: 4, totalFound };
    
  } catch (error) {
    console.warn(`🤖 [Complete] Complete expansion failed:`, error);
    // Fallback to original
    return { 
      conditions: [{ text: pageTitle, matchType, expansionLevel: 0 }], 
      level: 0, 
      totalFound: 0 
    };
  }
};

/**
 * Perform progressive semantic expansion with existence validation
 * Tests multiple expansion levels and validates page existence at each level
 */
const performProgressiveExpansion = async (
  pageTitle: string,
  matchType: "exact" | "contains" | "regex" = "contains",
  instruction?: string,
  modelInfo?: any,
  userLanguage?: string,
  userQuery?: string,
  includeDaily: boolean = false
): Promise<{ conditions: any[], level: number, totalFound: number }> => {
  console.log(`🤖 [Progressive] Starting progressive expansion for "${pageTitle}" (${matchType})`);
  
  // Define expansion levels to test progressively
  const expansionLevels = [
    { strategy: "fuzzy", label: "fuzzy variations" },
    { strategy: "synonyms", label: "synonyms" },
    { strategy: "related_concepts", label: "related concepts" },
    { strategy: "broader_terms", label: "broader terms" }
  ] as const;
  
  let bestConditions: any[] = [];
  let bestLevel = 0;
  let bestCount = 0;
  
  // Test each expansion level
  for (let level = 0; level < expansionLevels.length; level++) {
    const { strategy, label } = expansionLevels[level];
    
    console.log(`🤖 [Progressive] Testing level ${level + 1}: ${label}`);
    
    try {
      // Generate variations for this level
      const mode = matchType === "exact" ? "page_ref" : "text";
      const variations = await generateSemanticExpansions(
        pageTitle,
        strategy,
        userQuery || instruction || `Find pages with ${label} of "${pageTitle}"`,
        modelInfo,
        userLanguage,
        undefined,
        mode
      );
      
      console.log(`🤖 [Progressive] Generated ${variations.length} ${label}:`, variations);
      
      // Create test conditions
      let testConditions: any[];
      
      if (matchType === "exact") {
        // For exact: create semantic page conditions
        testConditions = [
          { text: pageTitle, matchType: "exact", isSemanticPage: false },
          ...variations.map(term => ({
            text: term,
            matchType: "exact" as const,
            isSemanticPage: true,
            expansionLevel: level + 1
          }))
        ];
      } else {
        // For contains/regex: create composite regex
        const allTerms = [pageTitle, ...variations];
        const regexParts = allTerms.map(term => {
          const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&");
          return `.*${escapedTerm}.*`;
        });
        const compositeRegex = `(?i)(${regexParts.join("|")})`;
        
        testConditions = [{
          text: compositeRegex,
          matchType: "regex" as const,
          expansionLevel: level + 1
        }];
      }
      
      // Test existence by running a quick query
      const testCount = await testConditionsExistence(testConditions, includeDaily);
      console.log(`🤖 [Progressive] Level ${level + 1} found ${testCount} pages`);
      
      // Update best result if this level found more pages
      if (testCount > bestCount) {
        bestConditions = testConditions;
        bestLevel = level + 1;
        bestCount = testCount;
      }
      
      // If we found a good number of results, we can stop (configurable threshold)
      if (testCount >= 3) {
        console.log(`🤖 [Progressive] Found sufficient results (${testCount}) at level ${level + 1}, stopping`);
        break;
      }
      
    } catch (error) {
      console.warn(`🤖 [Progressive] Level ${level + 1} failed:`, error);
      continue;
    }
  }
  
  // If no expansion found results, use original
  if (bestCount === 0) {
    console.log(`🤖 [Progressive] No expansions found results, using original`);
    bestConditions = [{ text: pageTitle, matchType, expansionLevel: 0 }];
    bestLevel = 0;
  }
  
  console.log(`🤖 [Progressive] Best result: level ${bestLevel} with ${bestCount} pages`);
  return { conditions: bestConditions, level: bestLevel, totalFound: bestCount };
};

/**
 * Test existence of page conditions by running lightweight queries
 */
const testConditionsExistence = async (
  conditions: any[],
  includeDaily: boolean
): Promise<number> => {
  try {
    // Separate semantic pages from regular conditions
    const semanticPages = conditions.filter(c => c.isSemanticPage);
    const regularConditions = conditions.filter(c => !c.isSemanticPage);
    
    let totalCount = 0;
    
    // Test semantic pages with exact matching
    if (semanticPages.length > 0) {
      const semanticTitles = semanticPages.map(c => c.text);
      const testQuery = `[:find (count ?page)
                         :where 
                         [?page :node/title ?title]
                         [(contains? #{${semanticTitles
                           .map(t => `"${t.replace(/"/g, '\\"')}"`)
                           .join(" ")}} ?title)]${
        !includeDaily
          ? `
                         [?page :block/uid ?uid]
                         [(re-pattern "${dnpUidRegex.source.slice(1, -1)}") ?dnp-pattern]
                         (not [(re-find ?dnp-pattern ?uid)])`
          : ""
      }]`;
      
      const semanticResults = await executeDatomicQuery(testQuery);
      totalCount += semanticResults[0]?.[0] || 0;
    }
    
    // Test regular conditions
    for (const condition of regularConditions) {
      const count = await testSingleConditionExistence(condition, includeDaily);
      totalCount += count;
    }
    
    return totalCount;
  } catch (error) {
    console.warn("Failed to test conditions existence:", error);
    return 0;
  }
};

/**
 * Test existence of a single condition
 */
const testSingleConditionExistence = async (
  condition: any,
  includeDaily: boolean
): Promise<number> => {
  try {
    let testQuery = `[:find (count ?page)
                     :where 
                     [?page :node/title ?title]`;
    
    // Add title filtering based on match type
    switch (condition.matchType) {
      case "exact":
        testQuery += `\n                     [(= ?title "${condition.text}")]`;
        break;
      case "regex":
        // Check if the regex already has case-insensitive flag and double-escape
        const testRegexPattern = condition.text.startsWith("(?i)") 
          ? condition.text.replace(/\\/g, "\\\\") // Double-escape for Datomic
          : `(?i)${condition.text.replace(/\\/g, "\\\\")}`;
        testQuery += `\n                     [(re-pattern "${testRegexPattern}") ?pattern]
                     [(re-find ?pattern ?title)]`;
        break;
      case "contains":
      default:
        const cleanText = condition.text.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&");
        testQuery += `\n                     [(re-pattern "(?i).*${cleanText}.*") ?pattern]
                     [(re-find ?pattern ?title)]`;
        break;
    }
    
    // Add DNP filtering if needed
    if (!includeDaily) {
      testQuery += `\n                     [?page :block/uid ?uid]
                     [(re-pattern "${dnpUidRegex.source.slice(1, -1)}") ?dnp-pattern]
                     (not [(re-find ?dnp-pattern ?uid)])`;
    }
    
    testQuery += `]`;
    
    const results = await executeDatomicQuery(testQuery);
    return results[0]?.[0] || 0;
  } catch (error) {
    console.warn(`Failed to test condition existence:`, error);
    return 0;
  }
};



/**
 * Execute efficient Datomic query for a single page title condition
 */
const executePageTitleQuery = async (
  condition: any,
  includeDaily: boolean
): Promise<any[]> => {
  let query = `[:find ?uid ?title ?created ?modified
                :where 
                [?page :node/title ?title]
                [?page :block/uid ?uid]
                [?page :create/time ?created]
                [?page :edit/time ?modified]`;

  // Add title filtering based on match type
  switch (condition.matchType) {
    case "exact":
      query += `\n                [(= ?title "${condition.text}")]`;
      break;

    case "regex":
      // Check if the regex already has case-insensitive flag
      const regexPattern = condition.text.startsWith("(?i)") 
        ? condition.text.replace(/\\/g, "\\\\") // Double-escape for Datomic
        : `(?i)${condition.text.replace(/\\/g, "\\\\")}`;
      query += `\n                [(re-pattern "${regexPattern}") ?pattern]
                [(re-find ?pattern ?title)]`;
      break;

    case "contains":
    default:
      // Use case-insensitive contains  
      query += `\n                [(re-pattern "(?i).*${condition.text.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\\\$&"
      )}.*") ?pattern]
                [(re-find ?pattern ?title)]`;
      break;
  }

  // Add DNP filtering if needed
  if (!includeDaily) {
    query += `\n                [(re-pattern "${dnpUidRegex.source.slice(
      1,
      -1
    )}") ?dnp-pattern]
                (not [(re-find ?dnp-pattern ?uid)])`;
  }

  query += `]`;

  const results = await executeDatomicQuery(query);

  // Apply negation if specified (easier to do in memory for this case)
  if (condition.negate) {
    // For negation, we'd need a different approach - get all pages and exclude matches
    // This is a more complex case that might require the old pattern for now
    console.warn(`Negation not optimized for condition: ${condition.text}`);
    return [];
  }

  return results;
};

const findPagesByTitleImpl = async (
  input: z.infer<typeof schema>,
  state?: any
) => {
  const {
    conditions,
    combineConditions,
    includeDaily,
    dateRange,
    limit,
    smartExpansion,
    expansionInstruction,
  } = input;

  // Parse suffix operators (* for fuzzy, ~ for semantic) and generate expansions directly
  let processedConditions: any[] = [];
  
  for (const condition of conditions) {
    // First check if the condition has an explicit semanticExpansion from IntentParser
    const intentParserExpansion = condition.semanticExpansion;
    
    const { cleanText, expansionType: suffixExpansionType } = parseSemanticExpansion(
      condition.text,
      state?.globalSemanticExpansion || "synonyms"
    );
    
    // Priority: explicit condition.semanticExpansion > suffix operator > global setting
    const expansionType = intentParserExpansion || suffixExpansionType;
    
    // Debug log to show expansion type selection
    if (expansionType && intentParserExpansion) {
      console.log(`🎯 [TitleTool] Using IntentParser expansion: "${expansionType}" for "${cleanText}"`);
    } else if (expansionType && suffixExpansionType) {
      console.log(`🎯 [TitleTool] Using suffix operator expansion: "${expansionType}" for "${cleanText}"`);
    }
    
    if (expansionType === "fuzzy") {
      console.log(`🔍 [TitleTool] Fuzzy expansion requested for: "${cleanText}"`);
      
      if (condition.matchType === "exact") {
        // For exact matches: use sophisticated pattern with page_ref mode (existing logic)
        try {
          const fuzzyTerms = await generateSemanticExpansions(
            cleanText,
            "fuzzy",
            state?.userQuery || `Find pages with fuzzy variations of "${cleanText}"`,
            state?.modelInfo,
            state?.language,
            undefined,
            "page_ref"
          );
          
          console.log(`🔍 [TitleTool] Generated ${fuzzyTerms.length} fuzzy variations for exact match:`, fuzzyTerms);
          
          // Add original condition plus fuzzy variations as semantic pages (exact matching)
          processedConditions.push({ ...condition, text: cleanText });
          fuzzyTerms.forEach(term => {
            processedConditions.push({
              ...condition,
              text: term,
              matchType: "exact" as const,
              expansionLevel: 1,
              isSemanticPage: true,
            });
          });
        } catch (error) {
          console.warn(`Failed to generate fuzzy terms for "${cleanText}":`, error);
          processedConditions.push({ ...condition, text: cleanText });
        }
      } else {
        // For contains/regex matches: use text mode and create composite regex
        try {
          const fuzzyTerms = await generateSemanticExpansions(
            cleanText,
            "fuzzy",
            state?.userQuery || `Find pages with fuzzy variations of "${cleanText}"`,
            state?.modelInfo,
            state?.language,
            undefined,
            "text" // Use text mode for regex patterns
          );
          
          console.log(`🔍 [TitleTool] Generated ${fuzzyTerms.length} fuzzy regex variations:`, fuzzyTerms);
          
          // Create composite regex pattern: (.*original.*|.*variation1.*|.*variation2.*)
          const regexParts = [];
          
          // Add original text (needs escaping since it's literal text)
          const escapedCleanText = cleanText.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&");
          regexParts.push(`.*${escapedCleanText}.*`);
          
          // Add fuzzy variations (already regex patterns from mode="text", don't escape)
          fuzzyTerms.forEach(term => {
            // Variations from mode="text" are already regex patterns, just wrap with .*
            regexParts.push(`.*${term}.*`);
          });
          
          const compositeRegex = `(?i)(${regexParts.join("|")})`;
          
          console.log(`🔍 [TitleTool] Created composite fuzzy regex:`, compositeRegex);
          
          // Add single condition with composite regex
          processedConditions.push({
            ...condition,
            text: compositeRegex,
            matchType: "regex" as const,
            expansionLevel: 1,
          });
        } catch (error) {
          console.warn(`Failed to generate fuzzy terms for "${cleanText}":`, error);
          processedConditions.push({ ...condition, text: cleanText });
        }
      }
      
    } else if (expansionType === "all") {
      console.log(`🔍 [TitleTool] Complete expansion requested for: "${cleanText}"`);
      
      // Use complete expansion that runs all strategies without early stopping
      try {
        const completeResult = await performCompleteExpansion(
          cleanText,
          condition.matchType,
          state?.userQuery || `Find pages with complete expansion of "${cleanText}"`,
          state?.modelInfo,
          state?.language,
          state?.userQuery,
          includeDaily
        );
        
        // Add all conditions from complete expansion
        processedConditions.push(...completeResult.conditions);
        
        console.log(`🔍 [TitleTool] Complete expansion added ${completeResult.conditions.length} conditions with ${completeResult.totalFound} potential pages`);
      } catch (error) {
        console.warn(`Failed to generate complete expansion for "${cleanText}":`, error);
        processedConditions.push({ ...condition, text: cleanText });
      }
      
    } else if (expansionType && expansionType !== "fuzzy") {
      console.log(`🔍 [TitleTool] Semantic expansion requested for: "${cleanText}" (${expansionType})`);
      
      if (condition.matchType === "exact") {
        // For exact matches: use sophisticated pattern with page_ref mode (existing logic)
        try {
          const semanticTerms = await generateSemanticExpansions(
            cleanText,
            expansionType as "synonyms" | "related_concepts" | "broader_terms" | "custom" | "all",
            state?.userQuery || `Find pages with ${expansionType} variations of "${cleanText}"`,
            state?.modelInfo,
            state?.language,
            undefined,
            "page_ref"
          );
          
          console.log(`🔍 [TitleTool] Generated ${semanticTerms.length} ${expansionType} variations for exact match:`, semanticTerms);
          
          // Add original condition plus semantic variations as semantic pages (exact matching)
          processedConditions.push({ ...condition, text: cleanText });
          semanticTerms.forEach(term => {
            processedConditions.push({
              ...condition,
              text: term,
              matchType: "exact" as const,
              expansionLevel: 1,
              isSemanticPage: true,
            });
          });
        } catch (error) {
          console.warn(`Failed to generate ${expansionType} terms for "${cleanText}":`, error);
          processedConditions.push({ ...condition, text: cleanText });
        }
      } else {
        // For contains/regex matches: use text mode and create composite regex
        try {
          const semanticTerms = await generateSemanticExpansions(
            cleanText,
            expansionType as "synonyms" | "related_concepts" | "broader_terms" | "custom" | "all",
            state?.userQuery || `Find pages with ${expansionType} variations of "${cleanText}"`,
            state?.modelInfo,
            state?.language,
            undefined,
            "text" // Use text mode for regex patterns
          );
          
          console.log(`🔍 [TitleTool] Generated ${semanticTerms.length} ${expansionType} regex variations:`, semanticTerms);
          
          // Create composite regex pattern: (.*original.*|.*variation1.*|.*variation2.*)
          const regexParts = [];
          
          // Add original text (needs escaping since it's literal text)
          const escapedCleanText = cleanText.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&");
          regexParts.push(`.*${escapedCleanText}.*`);
          
          // Add semantic variations (already regex patterns from mode="text", don't escape)
          semanticTerms.forEach(term => {
            // Variations from mode="text" are already regex patterns, just wrap with .*
            regexParts.push(`.*${term}.*`);
          });
          const compositeRegex = `(?i)(${regexParts.join("|")})`;
          
          console.log(`🔍 [TitleTool] Created composite ${expansionType} regex:`, compositeRegex);
          
          // Add single condition with composite regex
          processedConditions.push({
            ...condition,
            text: compositeRegex,
            matchType: "regex" as const,
            expansionLevel: 1,
          });
        } catch (error) {
          console.warn(`Failed to generate ${expansionType} terms for "${cleanText}":`, error);
          processedConditions.push({ ...condition, text: cleanText });
        }
      }
      
    } else {
      // No expansion operator - use original condition
      processedConditions.push({ ...condition, text: cleanText });
    }
  }

  // Check if we already processed expansions via suffix operators
  const hasOperatorExpansions = processedConditions.length > conditions.length;
  console.log(`🔍 [TitleTool] Processed ${processedConditions.length} conditions from ${conditions.length} original (hasOperatorExpansions: ${hasOperatorExpansions})`);
  
  // Handle smart expansion for conditions without suffix operators, or if explicitly enabled
  let expandedConditions = [...processedConditions];

  if ((smartExpansion || state?.automaticExpansion) && !hasOperatorExpansions) {
    console.log(`🤖 [TitleTool] Running progressive expansion for conditions without suffix operators`);
    
    for (const condition of processedConditions) {
      if (
        condition.matchType === "contains" ||
        condition.matchType === "exact"
      ) {
        const progressiveResult = await performProgressiveExpansion(
          condition.text,
          condition.matchType,
          expansionInstruction || `Find pages with progressive expansion of "${condition.text}"`,
          state?.modelInfo,
          state?.language,
          state?.userQuery,
          includeDaily
        );

        // Replace original condition with progressive expansion results
        expandedConditions = expandedConditions.filter((c) => c !== condition);
        expandedConditions.push(...progressiveResult.conditions);
        
        console.log(`🤖 [TitleTool] Progressive expansion found ${progressiveResult.totalFound} pages at level ${progressiveResult.level}`);
      }
    }
  }

  // Check if we have semantic pages (exact titles already found)
  // This includes both smart expansion results AND suffix operator generated variations
  const semanticPages = expandedConditions.filter((c) => c.isSemanticPage);

  // Separate semantic pages from regular conditions
  const regularConditions = expandedConditions.filter((c) => !c.isSemanticPage);

  // Optimize: Build efficient Datomic queries instead of loading all pages
  let results: any[] = [];

  // Handle semantic pages with direct exact title queries (most efficient)
  if (semanticPages.length > 0) {
    const semanticTitles = semanticPages.map((c) => c.text);
    const batchSemanticQuery = `[:find ?uid ?title ?created ?modified
                                :where 
                                [?page :node/title ?title]
                                [?page :block/uid ?uid]
                                [?page :create/time ?created]
                                [?page :edit/time ?modified]
                                [(contains? #{${semanticTitles
                                  .map((t) => `"${t.replace(/"/g, '\\"')}"`)
                                  .join(" ")}} ?title)]${
      !includeDaily
        ? `
                                [(re-pattern "${dnpUidRegex.source.slice(
                                  1,
                                  -1
                                )}") ?dnp-pattern]
                                (not [(re-find ?dnp-pattern ?uid)])`
        : ""
    }]`;

    try {
      const semanticResults = await executeDatomicQuery(batchSemanticQuery);
      results.push(...semanticResults);
      console.log(
        `✅ Found ${semanticResults.length} semantic pages via direct title matching`
      );
    } catch (error) {
      console.warn(
        `Batch semantic query failed, falling back to individual queries:`,
        error
      );

      // Fallback to individual exact queries
      for (const title of semanticTitles) {
        const exactQuery = `[:find ?uid ?title ?created ?modified
                           :where 
                           [?page :node/title ?title]
                           [?page :block/uid ?uid]
                           [?page :create/time ?created]
                           [?page :edit/time ?modified]
                           [(= ?title "${title.replace(/"/g, '\\"')}")]${
          !includeDaily
            ? `
                           [(re-pattern "${dnpUidRegex.source.slice(
                             1,
                             -1
                           )}") ?dnp-pattern]
                           (not [(re-find ?dnp-pattern ?uid)])`
            : ""
        }]`;

        try {
          const titleResults = await executeDatomicQuery(exactQuery);
          results.push(...titleResults);
        } catch (error) {
          console.warn(`Exact query for "${title}" failed:`, error);
        }
      }
    }
  }

  // Handle regular conditions
  if (regularConditions.length > 0) {
    if (combineConditions === "OR") {
      // For OR logic, run separate queries and combine results
      const allConditionResults = new Set();
      const existingUIDs = new Set(results.map((r) => r[0])); // Track existing UIDs

      for (const condition of regularConditions) {
        const conditionResults = await executePageTitleQuery(
          condition,
          includeDaily
        );
        conditionResults.forEach((result) => {
          const key = result[0]; // UID as unique key
          if (!allConditionResults.has(key) && !existingUIDs.has(key)) {
            allConditionResults.add(key);
            results.push(result);
          }
        });
      }
    } else {
      // For AND logic with single condition, use efficient query
      if (regularConditions.length === 1) {
        const conditionResults = await executePageTitleQuery(
          regularConditions[0],
          includeDaily
        );
        const existingUIDs = new Set(results.map((r) => r[0]));

        // Add non-duplicate results
        conditionResults.forEach((result) => {
          if (!existingUIDs.has(result[0])) {
            results.push(result);
          }
        });
      } else {
        // For multiple AND conditions, use the most selective condition and filter others in memory
        const firstCondition = regularConditions[0];
        const allCandidates = await executePageTitleQuery(
          firstCondition,
          includeDaily
        );
        const existingUIDs = new Set(results.map((r) => r[0]));

        const filteredResults = allCandidates.filter(([uid, title]) => {
          if (existingUIDs.has(uid)) return false; // Skip duplicates

          return regularConditions.slice(1).every((condition) => {
            let matches = false;
            switch (condition.matchType) {
              case "exact":
                matches = title === condition.text;
                break;
              case "regex":
                try {
                  const regex = new RegExp(condition.text, "i");
                  matches = regex.test(title);
                } catch (error) {
                  throw new Error(`Invalid regex pattern: ${condition.text}`);
                }
                break;
              case "contains":
              default:
                matches = title
                  .toLowerCase()
                  .includes(condition.text.toLowerCase());
                break;
            }
            return condition.negate ? !matches : matches;
          });
        });

        results.push(...filteredResults);
      }
    }
  }

  // Convert to structured results with relevance scoring
  let structuredResults = results.map(([uid, title, created, modified]) => {
    // Calculate relevance score based on condition weights and matches
    let relevanceScore = 0;
    const titleLower = title.toLowerCase();

    for (const condition of conditions) {
      const textLower = condition.text.toLowerCase();
      let conditionScore = 0;

      if (condition.matchType === "exact" && title === condition.text) {
        conditionScore = 10;
      } else if (titleLower.includes(textLower)) {
        // Boost score for exact word matches vs partial matches
        const exactWordMatch = new RegExp(
          `\\b${textLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`
        ).test(titleLower);
        conditionScore = exactWordMatch ? 5 : 2;
      }

      relevanceScore += conditionScore * condition.weight;
    }

    return {
      uid,
      title,
      created: new Date(created),
      modified: new Date(modified),
      isDaily: isDailyNote(uid),
      relevanceScore,
      matchedConditions: conditions.map((c) => c.text),
      // Explicit type flag
      isPage: true,
    };
  });

  // Apply date range filtering if specified
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
    structuredResults = filterByDateRange(structuredResults, parsedDateRange);
  }

  // Sort by relevance score first, then by modification time
  structuredResults.sort((a, b) => {
    if (a.relevanceScore !== b.relevanceScore) {
      return b.relevanceScore - a.relevanceScore; // Higher score first
    }
    return b.modified.getTime() - a.modified.getTime(); // Most recent first
  });

  // Limit results
  const wasLimited = structuredResults.length > limit;
  if (wasLimited) {
    structuredResults = structuredResults.slice(0, limit);
  }

  // Track applied expansions for expansion options
  const appliedExpansions: string[] = [];
  
  // Track expansions that were actually executed in this query
  processedConditions.forEach(condition => {
    if (condition.expansionLevel && condition.expansionLevel > 0) {
      // This condition was expanded, check what type
      if (condition.isSemanticPage) {
        // This is a semantic page from exact matching expansion
        appliedExpansions.push("exact_semantic");
      } else if (condition.matchType === "regex" && condition.text.includes("(?i)(")) {
        // This is a composite regex from fuzzy/semantic expansion
        // Try to determine which type based on the condition context
        const originalCondition = conditions.find(c => 
          condition.text.includes(c.text.replace(/[.*+?^${}()|[\]\\*~]/g, ""))
        );
        if (originalCondition) {
          const { expansionType } = parseSemanticExpansion(
            originalCondition.text,
            state?.globalSemanticExpansion || "synonyms"
          );
          if (expansionType && !appliedExpansions.includes(expansionType)) {
            appliedExpansions.push(expansionType);
          }
        }
      }
    }
  });
  
  // Track IntentParser or state-based expansions
  if (state?.semanticExpansion && state?.isExpansionGlobal) {
    if (!appliedExpansions.includes(state.semanticExpansion)) {
      appliedExpansions.push(state.semanticExpansion);
    }
  }
  
  // Check if we used smart/automatic expansion without specific operators
  if ((smartExpansion || state?.automaticExpansion) && !hasOperatorExpansions && processedConditions.some(c => c.expansionLevel > 0)) {
    appliedExpansions.push("progressive_expansion");
  }
  
  console.log(`🎯 [TitleTool] Applied expansions tracked:`, appliedExpansions);
  
  // Store expansion metadata for tool result
  const expansionMetadata = {
    appliedExpansions,
    hasResults: structuredResults.length > 0,
    automaticExpansionEnabled: !!state?.automaticExpansion,
    wasLimited,
    totalFound: structuredResults.length + (wasLimited ? (limit || 100) : 0)
  };

  return { results: structuredResults, metadata: expansionMetadata };
};

export const findPagesByTitleTool = tool(
  async (llmInput, config) => {
    const startTime = performance.now();
    try {
      // Auto-enrich with internal parameters
      const enrichedInput = {
        ...llmInput,
        // Add default values for parameters hidden from LLM
        limit: 100,
        fuzzyMatching: false,
        fuzzyThreshold: 0.8,
        // Add weight defaults
        conditions: llmInput.conditions.map((cond: any) => ({
          ...cond,
          weight: 1.0,
        })),
      };

      // Extract state from config
      const state = config?.configurable?.state;
      
      // Inject dateRange from agent state
      enrichedInput.dateRange = state?.searchDetails?.timeRange;
      
      // Enrich conditions with IntentParser semantic expansion if available
      if (state?.semanticExpansion && state?.isExpansionGlobal) {
        enrichedInput.conditions = enrichedInput.conditions.map((cond: any) => ({
          ...cond,
          // Only add semanticExpansion if not already specified
          semanticExpansion: cond.semanticExpansion || state.semanticExpansion,
        }));
        console.log(`🎯 [TitleTool] Enriched conditions with IntentParser semanticExpansion: "${state.semanticExpansion}"`);
      }
      
      const { results, metadata } = await findPagesByTitleImpl(enrichedInput, state);
      
      // Generate expansion options if needed
      const expansionOptions = buildPageTitleExpansionOptions(
        metadata.appliedExpansions,
        metadata.hasResults,
        metadata.automaticExpansionEnabled
      );
      
      // Add expansion options to metadata if results are sparse
      const enhancedMetadata = {
        ...metadata,
        expansionOptions: metadata.hasResults && results.length >= 3 ? undefined : expansionOptions,
        showExpansionButton: !metadata.hasResults || results.length < 3
      };
      
      return createToolResult(
        true,
        results,
        undefined,
        "findPagesByTitle",
        startTime,
        enhancedMetadata
      );
    } catch (error) {
      console.error("FindPagesByTitle tool error:", error);
      return createToolResult(
        false,
        undefined,
        error.message,
        "findPagesByTitle",
        startTime
      );
    }
  },
  {
    name: "findPagesByTitle",
    description:
      "Find pages by title using exact, partial, or regex matching. Supports AND/OR logic and date ranges. For regex: set matchType='regex' and provide clean pattern in text field (e.g., 'test.*page', not '/test.*page/i'). Patterns are case-insensitive by default.",
    schema: llmFacingSchema, // Use minimal schema
  }
);
