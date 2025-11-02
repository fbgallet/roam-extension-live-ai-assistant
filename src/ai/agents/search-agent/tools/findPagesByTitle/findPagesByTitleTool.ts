import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  executeDatomicQuery,
  isDailyNote,
  filterByDateRange,
} from "../../helpers/searchUtils";
import {
  expandConditionsShared,
  withAutomaticExpansion,
} from "../../helpers/semanticExpansion";
import { schema, llmFacingSchema } from "./schemas";
import { executePageTitleQuery } from "./executors";
import { dnpUidRegex } from "../../../../../utils/regex.js";
import { updateAgentToaster } from "../../../shared/agentsUtils";

/**
 * Find pages by title conditions with flexible matching
 * Security Level: Secure (only accesses UIDs, titles, metadata)
 */

const findPagesByTitleImpl = async (
  input: z.infer<typeof schema>,
  state?: any
) => {
  const { conditions, combineConditions, includeDaily, dateRange, limit } =
    input;

  // Step 1: Adapt title conditions to work with shared expansion function
  // Map matchType -> type for compatibility with expandConditionsShared
  const adaptedConditions = conditions.map((condition) => ({
    ...condition,
    type: "text", // Title searches are text-based regex matching
  }));

  // Step 2: Expand conditions with semantic terms using shared function
  const expandedConditions = await expandConditionsShared(
    adaptedConditions,
    state
  );

  // Show expansion feedback if semantic expansion occurred
  const hasExpansions = expandedConditions.length > adaptedConditions.length;
  if (hasExpansions) {
    updateAgentToaster(`🔍 Page Title Search: Expanding search with related terms...`);
  }

  console.log(
    `🔍 [TitleTool] Processed ${expandedConditions.length} conditions from ${conditions.length} original`
  );

  // Check if we have semantic pages (exact titles already found)
  // This includes both smart expansion results AND suffix operator generated variations
  const semanticPages = expandedConditions.filter((c: any) => c.isSemanticPage);

  // Separate semantic pages from regular conditions
  const regularConditions = expandedConditions.filter((c: any) => !c.isSemanticPage);

  // Optimize: Build efficient Datomic queries instead of loading all pages
  let results: any[] = [];

  // Handle semantic pages with direct exact title queries (most efficient)
  if (semanticPages.length > 0) {
    const semanticTitles = semanticPages.map((c: any) => c.text);
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

      // Fallback to individual exact queries using executePageTitleQuery
      for (const title of semanticTitles) {
        try {
          const exactCondition = {
            text: title,
            matchType: "exact" as const,
            negate: false
          };
          const titleResults = await executePageTitleQuery(
            exactCondition,
            includeDaily
          );
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

          return regularConditions.slice(1).every((condition: any) => {
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

      relevanceScore += conditionScore * (condition.weight || 1);
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
    updateAgentToaster(
      `⚡ Page Title Search: Showing top ${limit} of ${structuredResults.length} pages`
    );
    structuredResults = structuredResults.slice(0, limit);
  } else if (structuredResults.length > 0) {
    updateAgentToaster(
      `✅ Page Title Search: Found ${structuredResults.length} page${structuredResults.length > 1 ? 's' : ''}`
    );
  }

  return structuredResults;
};

export const findPagesByTitleTool = tool(
  async (input: z.infer<typeof llmFacingSchema>, config) => {
    return withAutomaticExpansion(
      "findPagesByTitle",
      findPagesByTitleImpl,
      input,
      config
    );
  },
  {
    name: "findPagesByTitle",
    description:
      "Find pages by title using exact, partial, or regex matching. Supports semantic expansion (fuzzy, synonyms, related concepts, broader terms), AND/OR logic, and date ranges. Use 'semanticExpansion' parameter or add '*' (fuzzy) or '~' (semantic) suffix to text. For regex: set matchType='regex' and provide clean pattern in text field (e.g., 'test.*page', not '/test.*page/i'). Patterns are case-insensitive by default.",
    schema: llmFacingSchema, // Use minimal schema
  }
);