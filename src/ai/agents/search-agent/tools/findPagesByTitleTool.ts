import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  executeDatomicQuery,
  isDailyNote,
  filterByDateRange,
  createToolResult,
  generateSemanticExpansions,
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
        text: z.string().min(1, "Page title to search for"),
        matchType: z
          .enum(["exact", "contains", "regex"])
          .default("contains")
          .describe(
            "exact=exact title match, contains=partial title match, regex=pattern matching"
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
 * Perform smart expansion for a page title:
 * 1. Find existing similar pages with refined patterns
 * 2. If not enough found, generate semantic variations and validate them
 * 3. If forceSemanticExpansion=true, always run both regex + semantic steps
 */
const performSmartExpansion = async (
  pageTitle: string,
  instruction?: string,
  modelInfo?: any,
  forceSemanticExpansion: boolean = false,
  userLanguage?: string,
  userQuery?: string
): Promise<string[]> => {
  try {
    console.log(
      `🔍 Smart expansion for "${pageTitle}"${
        instruction ? ` with instruction: "${instruction}"` : ""
      }`
    );

    // Step 1: Look for existing similar pages with refined patterns
    const escapedPageTitle = pageTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      `^${escapedPageTitle}$`, // Exact match
      `^${escapedPageTitle}[ -].*`, // Word boundary: "pend " or "pend-"
      `^${escapedPageTitle}[A-Z].*`, // CamelCase: "pendingSomething"
      `.*[ -]${escapedPageTitle}$`, // End with word: "something-pend"
      `.*[ -]${escapedPageTitle}[ -].*`, // Word in middle: "my-pend-list"
    ];

    const existingPages = new Set<string>();

    // Batch all patterns into a single query
    try {
      const combinedPattern = `(${patterns.join("|")})`;
      const batchQuery = `[:find ?title
                         :where 
                         [?page :node/title ?title]
                         [(re-pattern "(?i)${combinedPattern}") ?pattern]
                         [(re-find ?pattern ?title)]]`;

      const results = await executeDatomicQuery(batchQuery);
      results.forEach(([title]) => existingPages.add(title));
    } catch (error) {
      console.warn(
        `Batch regex pattern failed, falling back to individual patterns:`,
        error
      );

      // Fallback to individual patterns if batch fails
      for (const pattern of patterns) {
        try {
          const query = `[:find ?title
                         :where 
                         [?page :node/title ?title]
                         [(re-pattern "(?i)${pattern}") ?pattern]
                         [(re-find ?pattern ?title)]]`;

          const results = await executeDatomicQuery(query);
          results.forEach(([title]) => existingPages.add(title));
        } catch (error) {
          console.warn(`Pattern ${pattern} failed:`, error);
        }
      }
    }

    console.log(
      `📋 Found ${existingPages.size} existing similar pages:`,
      Array.from(existingPages)
    );

    // Step 2: If we have good existing pages, filter them with LLM for relevance
    let regexBasedPages: string[] = [];
    if (existingPages.size > 0) {
      const relevantPages = await filterRelevantPages(
        pageTitle,
        Array.from(existingPages),
        instruction,
        modelInfo
      );

      if (relevantPages.length > 0) {
        regexBasedPages = relevantPages;
        console.log(
          `📋 Found ${relevantPages.length} regex-based similar pages`
        );

        // If not forcing semantic expansion, return regex results
        if (!forceSemanticExpansion) {
          console.log(
            `✅ Using ${relevantPages.length} relevant existing pages (regex-only)`
          );
          return relevantPages;
        }
      }
    }

    // Step 3: Generate semantic variations (always run when forceSemanticExpansion=true or no regex results)
    const shouldRunSemantic =
      forceSemanticExpansion || regexBasedPages.length === 0;
    let semanticBasedPages: string[] = [];

    if (shouldRunSemantic) {
      console.log(
        `🧠 Generating semantic variations for "${pageTitle}"${
          forceSemanticExpansion ? " (forced)" : ""
        }`
      );

      const baseStrategy = instruction ? "broader_terms" : "related_concepts";
      const semanticTerms = await generateSemanticExpansions(
        pageTitle,
        baseStrategy,
        userQuery || instruction || `Find pages related to "${pageTitle}"`,
        modelInfo,
        userLanguage, // Pass user language for context
        undefined // No custom strategy here
      );

      // Step 4: Find actual page titles matching semantic variations
      const foundPageTitles = [];

      // Only validate semantic terms, not the original (already covered by regex)
      const termsToValidate =
        forceSemanticExpansion && regexBasedPages.length > 0
          ? semanticTerms // Skip original term if we have regex results
          : [pageTitle, ...semanticTerms]; // Include original if no regex results

      if (termsToValidate.length > 0) {
        // Batch query with regex patterns (same as used in regex step)
        const patterns = termsToValidate
          .map(
            (term) =>
              `(^${term.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
              )}$|^${term.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
              )}[ -].*|^${term.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
              )}[A-Z].*|.*[ -]${term.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
              )}$|.*[ -]${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ -].*)`
          )
          .join("|");

        const batchQuery = `[:find ?title
                           :where 
                           [?page :node/title ?title]
                           [(re-pattern "(?i)${patterns}") ?pattern]
                           [(re-find ?pattern ?title)]]`;

        try {
          const foundPages = await executeDatomicQuery(batchQuery);

          // Collect the exact page titles found (not just semantic terms)
          foundPageTitles.push(...foundPages.map(([title]) => title));
        } catch (error) {
          console.warn(
            `Batch semantic validation failed, falling back to individual queries:`,
            error
          );

          // Fallback to individual queries with regex patterns
          for (const term of termsToValidate) {
            const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pattern = `^${escapedTerm}$|^${escapedTerm}[ -].*|^${escapedTerm}[A-Z].*|.*[ -]${escapedTerm}$|.*[ -]${escapedTerm}[ -].*`;

            const termQuery = `[:find ?title
                             :where 
                             [?page :node/title ?title]
                             [(re-pattern "(?i)${pattern}") ?pattern]
                             [(re-find ?pattern ?title)]]`;

            const results = await executeDatomicQuery(termQuery);
            foundPageTitles.push(...results.map(([title]) => title));
          }
        }
      }

      // Remove duplicates and store exact page titles
      semanticBasedPages = [...new Set(foundPageTitles)];
      console.log(
        `🎯 Found ${semanticBasedPages.length} semantic pages from ${
          termsToValidate.length
        } term candidates (${
          forceSemanticExpansion && regexBasedPages.length > 0
            ? "excluding original term"
            : "including original term"
        })`
      );
    }

    // Step 5: Combine results (deduplicate)
    const allResults = [
      ...new Set([...regexBasedPages, ...semanticBasedPages]),
    ];

    if (allResults.length > 0) {
      console.log(
        `✅ Combined results: ${regexBasedPages.length} regex + ${semanticBasedPages.length} semantic = ${allResults.length} total pages`
      );
      return allResults;
    }

    return [pageTitle]; // Fallback to original
  } catch (error) {
    console.warn(`Smart expansion failed for "${pageTitle}":`, error);
    return [pageTitle]; // Fallback to original term
  }
};

/**
 * Filter pages for relevance using LLM
 */
const filterRelevantPages = async (
  searchTerm: string,
  candidatePages: string[],
  instruction?: string,
  modelInfo?: any
): Promise<string[]> => {
  try {
    const basePrompt = `Given the search term "${searchTerm}", which of these page titles are semantically related and relevant?

Page titles: ${candidatePages.join(", ")}

Return only relevant page titles, one per line.`;

    const instructionPrompt = instruction
      ? `${basePrompt}\n\nSpecial instruction: ${instruction}`
      : `${basePrompt}\n\nConsider semantic similarity and exclude unrelated concepts (e.g., "testNotPending" is NOT relevant to "pend").`;

    // Use provided model or fall back to defaultModel if not provided
    let processedModel = modelInfo;
    if (!processedModel) {
      const { defaultModel } = await import("../../../..");
      if (!defaultModel) {
        console.warn(
          `LLM filtering skipped for "${searchTerm}": no model available`
        );
        return candidatePages.slice(0, 3); // Fallback to first few candidates
      }
      processedModel = defaultModel;
    }

    // Import required modules and process the model
    const { modelViaLanggraph } = await import("../../langraphModelsLoader");
    const { modelAccordingToProvider } = await import("../../../aiAPIsHub");
    const { HumanMessage } = await import("@langchain/core/messages");

    // Process the model to ensure it has the correct structure
    const modelForLanggraph = modelAccordingToProvider(processedModel);
    if (!modelForLanggraph || !modelForLanggraph.id) {
      console.warn(
        `LLM filtering skipped for "${searchTerm}": invalid model structure`
      );
      return candidatePages.slice(0, 3); // Fallback to first few candidates
    }

    const model = modelViaLanggraph(
      modelForLanggraph,
      { input_tokens: 0, output_tokens: 0 },
      false
    );
    const response = await model.invoke([new HumanMessage(instructionPrompt)]);

    const relevantPages = response.content
      .toString()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && candidatePages.includes(line));

    return relevantPages.length > 0
      ? relevantPages
      : candidatePages.slice(0, 3); // Fallback to first few
  } catch (error) {
    console.warn(`LLM filtering failed for "${searchTerm}":`, error);
    return candidatePages; // Fallback to all candidates
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
      query += `\n                [(re-pattern "(?i)${condition.text}") ?pattern]
                [(re-find ?pattern ?title)]`;
      break;

    case "contains":
    default:
      // Use case-insensitive contains
      query += `\n                [(re-pattern "(?i).*${condition.text.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
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
    semanticMode,
    expansionInstruction,
  } = input;

  // Handle smart expansion first if enabled
  let expandedConditions = [...conditions];

  if (smartExpansion) {
    for (const condition of conditions) {
      if (
        condition.matchType === "contains" ||
        condition.matchType === "exact"
      ) {
        const expandedTerms = await performSmartExpansion(
          condition.text,
          expansionInstruction,
          state?.modelInfo,
          semanticMode,
          state?.language,
          state?.userQuery
        );

        // Replace original condition with expanded conditions
        expandedConditions = expandedConditions.filter((c) => c !== condition);

        expandedConditions.push(
          ...expandedTerms.map((term, index) => ({
            ...condition,
            text: term,
            matchType: index === 0 ? condition.matchType : ("exact" as const), // First term keeps original type, semantic pages use exact
            isSemanticPage: index > 0, // Mark all terms after the first as semantic pages (exact titles found)
          }))
        );
      }
    }
  }

  // Check if we have semantic pages (exact titles already found)
  const semanticPages = smartExpansion
    ? expandedConditions.filter((c) => c.isSemanticPage)
    : [];

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

  // Apply date range filtering for DNPs if specified
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
  if (structuredResults.length > limit) {
    structuredResults = structuredResults.slice(0, limit);
  }

  return structuredResults;
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
      const results = await findPagesByTitleImpl(enrichedInput, state);
      return createToolResult(
        true,
        results,
        undefined,
        "findPagesByTitle",
        startTime
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
      "Find pages by title using exact, partial, or regex matching. Supports AND/OR logic and date ranges.",
    schema: llmFacingSchema, // Use minimal schema
  }
);
