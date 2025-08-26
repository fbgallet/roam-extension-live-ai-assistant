import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  executeDatomicQuery,
  isDailyNote,
  filterByDateRange,
  createToolResult,
  generateSemanticExpansions,
} from "../helpers/searchUtils";
import { dnpUidRegex } from "../../../../utils/regex.js";

/**
 * Find pages using semantic search with LLM-powered term expansion
 * Security Level: Secure (only accesses UIDs, titles, metadata)
 */

const schema = z.object({
  query: z.string().min(1, "Search query is required"),
  maxExpansions: z.number().min(1).max(20).default(5),
  expansionStrategy: z
    .enum(["synonyms", "related_concepts", "broader_terms"])
    .default("related_concepts"),
  includeExact: z.boolean().default(true),
  minResultsThreshold: z.number().min(0).default(3),
  fallbackToFiltering: z.boolean().default(true),
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

const findPagesSemanticallyImpl = async (input: z.infer<typeof schema>) => {
  const {
    query,
    maxExpansions,
    expansionStrategy,
    includeExact,
    minResultsThreshold,
    fallbackToFiltering,
    includeDaily,
    dateRange,
    limit,
  } = input;

  // Get all pages
  let pagesQuery = `[:find ?uid ?title ?created ?modified
                    :where 
                    [?page :node/title ?title]
                    [?page :block/uid ?uid]
                    [?page :create/time ?created]
                    [?page :edit/time ?modified]`;

  // Add DNP filtering if needed
  if (!includeDaily) {
    pagesQuery += `\n                    [(re-pattern "${dnpUidRegex.source.slice(
      1,
      -1
    )}") ?dnp-pattern]
                    (not [(re-find ?dnp-pattern ?uid)])`;
  }

  pagesQuery += `]`;

  const allPages = await executeDatomicQuery(pagesQuery);

  // Step 1: Try exact search first (if enabled)
  let results: any[] = [];
  let expansionTermsUsed: string[] = [];

  if (includeExact) {
    const exactResults = filterPagesByTerm(
      allPages,
      query.trim(),
      query.trim()
    );
    results.push(...exactResults);
    expansionTermsUsed.push(query.trim());
  }

  // Step 2: Check if we need semantic expansion
  const needsExpansion = results.length < minResultsThreshold;

  if (needsExpansion) {
    try {
      // Generate semantic expansions using LLM
      const expansionTerms = await generateSemanticExpansions(
        query.trim(),
        expansionStrategy,
        undefined, // No original query context in this tool
        undefined, // No model info in this tool
        undefined, // No language context in this tool
        undefined // No custom strategy here
      );

      console.log(
        `🔍 Semantic expansion generated ${expansionTerms.length} terms:`,
        expansionTerms
      );

      // Search with each expansion term
      for (const term of expansionTerms) {
        const termResults = filterPagesByTerm(allPages, term, term);

        // Avoid duplicates by checking UIDs
        const newResults = termResults.filter(
          (newResult) =>
            !results.some(
              (existingResult) => existingResult.uid === newResult.uid
            )
        );

        results.push(...newResults);
        expansionTermsUsed.push(term);

        // Stop if we have enough results
        if (results.length >= limit) break;
      }
    } catch (error) {
      console.warn("Semantic expansion failed:", error);

      // Fallback to simple filtering if enabled
      if (fallbackToFiltering && results.length === 0) {
        const fallbackResults = filterPagesByTerm(
          allPages,
          query.trim(),
          query.trim()
        );
        results.push(...fallbackResults);
        expansionTermsUsed = [query.trim()];
      }
    }
  }

  // Step 3: Apply date range filtering if specified
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
    results = filterByDateRange(results, parsedDateRange, filterMode);
  }

  // Step 4: Sort by relevance (exact matches first, then by modification time)
  results.sort((a, b) => {
    // Exact matches first
    if (a.matchedTerm === query.trim() && b.matchedTerm !== query.trim())
      return -1;
    if (b.matchedTerm === query.trim() && a.matchedTerm !== query.trim())
      return 1;

    // Then by modification time (most recent first)
    return b.modified.getTime() - a.modified.getTime();
  });

  // Step 5: Limit results
  if (results.length > limit) {
    results = results.slice(0, limit);
  }

  // Step 6: Add expansion metadata
  results.forEach((result) => {
    result.expansionUsed = expansionTermsUsed;
  });

  return results;
};

/**
 * Filter pages by a search term using case-insensitive contains matching
 */
const filterPagesByTerm = (
  allPages: any[],
  searchTerm: string,
  matchedTerm: string
): any[] => {
  const lowerSearchTerm = searchTerm.toLowerCase();

  return allPages
    .filter(([uid, title]) => title.toLowerCase().includes(lowerSearchTerm))
    .map(([uid, title, created, modified]) => ({
      uid,
      title,
      created: new Date(created),
      modified: new Date(modified),
      isDaily: isDailyNote(uid),
      matchedTerm,
      expansionUsed: [], // Will be populated later
      // Explicit type flag
      isPage: true,
    }));
};

export const findPagesSemanticallyTool = tool(
  async (input) => {
    const startTime = performance.now();
    try {
      const results = await findPagesSemanticallyImpl(input);
      return createToolResult(
        true,
        results,
        undefined,
        "findPagesSemantically",
        startTime
      );
    } catch (error) {
      console.error("FindPagesSemantically tool error:", error);
      return createToolResult(
        false,
        undefined,
        error.message,
        "findPagesSemantically",
        startTime
      );
    }
  },
  {
    name: "findPagesSemantically",
    description:
      "Find pages using semantic/conceptual search with AI-powered term expansion. Best for exploratory searches when you need to discover related concepts, not exact matches. Automatically generates synonyms, related concepts, or broader terms to find pages the user might not have thought to search for explicitly.",
    schema,
  }
);
