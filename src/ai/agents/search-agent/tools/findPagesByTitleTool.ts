import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  executeDatomicQuery,
  isDailyNote,
  filterByDateRange,
} from "../helpers/searchUtils";
import {
  automaticSemanticExpansion,
  generateSemanticExpansions,
  getExpansionStrategyLabel,
  parseSemanticExpansion,
  createToolResult,
} from "../helpers/semanticExpansion";
import { baseConditionSchema } from "../helpers/conditionGroupsUtils";
import { dnpUidRegex } from "../../../../utils/regex.js";
import { updateAgentToaster } from "../../shared/agentsUtils";

/**
 * Find pages by title conditions with flexible matching
 * Security Level: Secure (only accesses UIDs, titles, metadata)
 */

// Extend base condition schema for page title specific needs
const titleConditionSchema = baseConditionSchema.extend({
  isSemanticPage: z.boolean().optional(), // Flag for exact titles found via semantic expansion
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
      filterMode: z.enum(["created", "modified"]).optional(),
    })
    .optional(),
  limit: z.number().min(1).max(1000).default(100),
});

// LLM-facing schema with semantic expansion support
const llmFacingSchema = z.object({
  conditions: z
    .array(
      z.object({
        text: z
          .string()
          .min(
            1,
            "Page title or pattern to search for. For regex patterns, use clean pattern syntax (e.g., 'test.*page' or '(?i)status|state') without /regex:/ or /pattern/flags wrapper. Add '*' suffix for fuzzy matching or '~' suffix for semantic expansion."
          ),
        matchType: z
          .enum(["exact", "contains", "regex"])
          .default("contains")
          .describe(
            "exact=exact title match, contains=partial title match, regex=pattern matching. For regex: use matchType='regex' and put just the pattern in text field (e.g., text='test.*page', not 'regex:/test.*page/i')"
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
          .default(undefined)
          .describe(
            "Semantic expansion strategy (only when explicitly requested): fuzzy=typos/variations, synonyms=alternative terms, related_concepts=associated terms, broader_terms=categories, all=comprehensive expansion (use sparingly)"
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
      filterMode: z.enum(["created", "modified"]).optional(),
    })
    .optional()
    .describe("Limit to pages created within date range"),
});

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
    {
      key: "fuzzy",
      label: "🔍 Fuzzy matching (typos, morphological variations)",
      strategy: "fuzzy",
    },
    {
      key: "synonyms",
      label: "📝 Synonyms and alternative terms",
      strategy: "synonyms",
    },
    {
      key: "related",
      label: "🧠 Related concepts and associated terms",
      strategy: "related_concepts",
    },
    {
      key: "broader",
      label: "🌐 Broader terms and categories",
      strategy: "broader_terms",
    },
    {
      key: "all",
      label: "⚡ All at once (complete semantic expansion)",
      strategy: "all",
    },
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
 * Expand page title conditions with semantic terms (simplified approach based on findBlocksByContent)
 * Only expands when explicitly requested
 */
const expandPageTitleConditions = async (
  conditions: z.infer<typeof titleConditionSchema>[],
  state?: any
): Promise<z.infer<typeof titleConditionSchema>[]> => {
  const expandedConditions = [...conditions];

  // Check if semantic expansion is needed - either globally or per-condition
  const hasGlobalExpansion = state?.isExpansionGlobal === true;

  // Check if any condition has symbols that require expansion or explicit semanticExpansion
  const hasExpansionRequest = conditions.some(
    (c) => c.text.endsWith("*") || c.text.endsWith("~") || c.semanticExpansion
  );

  if (!hasGlobalExpansion && !hasExpansionRequest) {
    console.log(
      `⏭️ [TitleTool] Skipping semantic expansion (no global flag or explicit requests)`
    );
    return expandedConditions;
  }

  console.log(`🧠 [TitleTool] Applying semantic expansion`);

  for (const condition of conditions) {
    // Parse semantic expansion from condition text using our parser
    const { cleanText, expansionType: suffixExpansionType } =
      parseSemanticExpansion(condition.text, state?.semanticExpansion);

    // Determine final expansion strategy: explicit > suffix > global
    let effectiveExpansionStrategy =
      condition.semanticExpansion || suffixExpansionType;
    if (!effectiveExpansionStrategy && hasGlobalExpansion) {
      effectiveExpansionStrategy = state?.semanticExpansion || "synonyms";
    }

    // Handle page title expansion
    if (effectiveExpansionStrategy) {
      try {
        console.log(
          `🔍 [TitleTool] Expanding "${cleanText}" with ${effectiveExpansionStrategy} strategy`
        );

        // Use page_ref mode for semantic expansion to get clean page titles
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
          undefined,
          "page_ref" // Use page_ref mode for clean titles
        );

        if (expansionTerms.length > 0) {
          console.log(
            `✅ [TitleTool] Generated ${
              expansionTerms.length
            } variations: ${expansionTerms.join(", ")}`
          );

          // Show user-friendly expansion message
          const strategyLabel = getExpansionStrategyLabel(
            effectiveExpansionStrategy
          );
          updateAgentToaster(
            `📄 Expanded "${cleanText}" (${strategyLabel}) → ${cleanText}, ${expansionTerms.join(
              ", "
            )}`
          );

          // For exact matching, add each variation as a separate semantic page condition
          if (condition.matchType === "exact") {
            // Keep original condition
            condition.text = cleanText;

            // Add semantic variations
            expansionTerms.forEach((term) => {
              expandedConditions.push({
                ...condition,
                text: term,
                isSemanticPage: true,
                expansionLevel: 1,
              });
            });
          } else {
            // For contains/regex, create a composite pattern
            const allTerms = [cleanText, ...expansionTerms];
            const escapedTerms = allTerms.map((term) =>
              term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            );
            const compositePattern = `(?i)(${escapedTerms
              .map((term) => `.*${term}.*`)
              .join("|")})`;

            // Replace condition with composite regex
            condition.text = compositePattern;
            condition.matchType = "regex";
            condition.expansionLevel = 1;
          }
        } else {
          // No expansions found, just use clean text
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
  }

  return expandedConditions;
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
  const { conditions, combineConditions, includeDaily, dateRange, limit } =
    input;

  // Process conditions with semantic expansion (simplified approach)
  const processedConditions = await expandPageTitleConditions(
    conditions,
    state
  );

  console.log(
    `🔍 [TitleTool] Processed ${processedConditions.length} conditions from ${conditions.length} original`
  );

  const expandedConditions = processedConditions;

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
    const filterMode = dateRange.filterMode || "modified";
    structuredResults = filterByDateRange(
      structuredResults,
      parsedDateRange,
      filterMode
    );
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
  processedConditions.forEach((condition) => {
    if (condition.expansionLevel && condition.expansionLevel > 0) {
      // This condition was expanded, check what type
      if (condition.isSemanticPage) {
        // This is a semantic page from exact matching expansion
        appliedExpansions.push("exact_semantic");
      } else if (
        condition.matchType === "regex" &&
        condition.text.includes("(?i)(")
      ) {
        // This is a composite regex from fuzzy/semantic expansion
        // Try to determine which type based on the condition context
        const originalCondition = conditions.find((c) =>
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

  // Check if we used automatic expansion
  if (
    state?.automaticExpansion &&
    processedConditions.some((c) => c.expansionLevel > 0)
  ) {
    appliedExpansions.push("automatic_expansion");
  }

  console.log(`🎯 [TitleTool] Applied expansions tracked:`, appliedExpansions);

  // Store expansion metadata for tool result
  const expansionMetadata = {
    appliedExpansions,
    hasResults: structuredResults.length > 0,
    automaticExpansionEnabled: !!state?.automaticExpansion,
    wasLimited,
    totalFound: structuredResults.length + (wasLimited ? limit || 100 : 0),
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
        // Add weight defaults
        conditions: llmInput.conditions.map((cond: any) => ({
          ...cond,
          weight: 1.0,
        })),
      };

      // Extract state from config
      const state = config?.configurable?.state;

      // Check if we should use automatic semantic expansion (ONLY for auto_until_result)
      if (state?.automaticExpansionMode === "auto_until_result") {
        console.log(
          `🔧 [FindPagesByTitle] Using automatic expansion for auto_until_result mode`
        );

        // Use automatic expansion starting from fuzzy
        const expansionResult = await automaticSemanticExpansion(
          enrichedInput,
          (params: any, state?: any) => findPagesByTitleImpl(params, state),
          state
        );

        // Log expansion results
        if (expansionResult.expansionUsed) {
          console.log(
            `✅ [FindPagesByTitle] Found results with ${expansionResult.expansionUsed} expansion`
          );
        } else {
          console.log(
            `😟 [FindPagesByTitle] No expansion found results, tried: ${expansionResult.expansionAttempts.join(
              ", "
            )}`
          );
        }

        // Generate expansion options if needed (using existing logic)
        const expansionOptions = buildPageTitleExpansionOptions(
          expansionResult.results.metadata?.appliedExpansions || [],
          expansionResult.results.results?.length > 0,
          false // automaticExpansionEnabled - false since we handled it
        );

        // Add expansion options to metadata if results are sparse
        const enhancedMetadata = {
          ...expansionResult.results.metadata,
          automaticExpansion: {
            used: expansionResult.expansionUsed,
            attempts: expansionResult.expansionAttempts,
            finalAttempt: expansionResult.finalAttempt,
          },
          expansionOptions:
            expansionResult.results.results?.length >= 3
              ? undefined
              : expansionOptions,
          showExpansionButton:
            !expansionResult.results.results?.length ||
            expansionResult.results.results.length < 3,
        };

        return createToolResult(
          true,
          expansionResult.results.results,
          undefined,
          "findPagesByTitle",
          startTime,
          enhancedMetadata
        );
      }

      // Handle other expansion modes (always_fuzzy, always_synonyms, always_all, etc.)
      let expansionStates = {
        isExpansionGlobal: state?.isExpansionGlobal || false,
        semanticExpansion: state?.semanticExpansion || null,
      };

      if (state?.automaticExpansionMode) {
        const expansionMode = state.automaticExpansionMode;
        console.log(
          `🔧 [FindPagesByTitle] Checking expansion mode: ${expansionMode}`
        );

        // Set expansion states based on mode (only if not already set by user actions)
        if (!state?.isExpansionGlobal) {
          switch (expansionMode) {
            case "always_fuzzy":
            case "Always with fuzzy":
              expansionStates.isExpansionGlobal = true;
              expansionStates.semanticExpansion = "fuzzy";
              console.log(
                `🔧 [FindPagesByTitle] Auto-enabling fuzzy expansion due to mode: ${expansionMode}`
              );
              break;
            case "always_synonyms":
            case "Always with synonyms":
              expansionStates.isExpansionGlobal = true;
              expansionStates.semanticExpansion = "synonyms";
              console.log(
                `🔧 [FindPagesByTitle] Auto-enabling synonyms expansion due to mode: ${expansionMode}`
              );
              break;
            case "always_all":
            case "Always with all":
              expansionStates.isExpansionGlobal = true;
              expansionStates.semanticExpansion = "all";
              console.log(
                `🔧 [FindPagesByTitle] Auto-enabling all expansions due to mode: ${expansionMode}`
              );
              break;
          }
        }
      }

      // Inject dateRange from agent state
      enrichedInput.dateRange = state?.searchDetails?.timeRange;

      // Enrich conditions with IntentParser semantic expansion if available
      if (state?.semanticExpansion && state?.isExpansionGlobal) {
        enrichedInput.conditions = enrichedInput.conditions.map(
          (cond: any) => ({
            ...cond,
            // Only add semanticExpansion if not already specified
            semanticExpansion:
              cond.semanticExpansion || state.semanticExpansion,
          })
        );
        console.log(
          `🎯 [TitleTool] Enriched conditions with IntentParser semanticExpansion: "${state.semanticExpansion}"`
        );
      }

      const { results, metadata } = await findPagesByTitleImpl(enrichedInput, {
        ...state,
        ...expansionStates,
      });

      // Generate expansion options if needed
      const expansionOptions = buildPageTitleExpansionOptions(
        metadata.appliedExpansions,
        metadata.hasResults,
        metadata.automaticExpansionEnabled
      );

      // Add expansion options to metadata if results are sparse
      const enhancedMetadata = {
        ...metadata,
        expansionOptions:
          metadata.hasResults && results.length >= 3
            ? undefined
            : expansionOptions,
        showExpansionButton: !metadata.hasResults || results.length < 3,
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
      "Find pages by title using exact, partial, or regex matching. Supports semantic expansion (fuzzy, synonyms, related concepts, broader terms), AND/OR logic, and date ranges. Use 'semanticExpansion' parameter or add '*' (fuzzy) or '~' (semantic) suffix to text. For regex: set matchType='regex' and provide clean pattern in text field (e.g., 'test.*page', not '/test.*page/i'). Patterns are case-insensitive by default.",
    schema: llmFacingSchema, // Use minimal schema
  }
);
