import { z } from "zod";
import { expandConditionsShared } from "../../helpers/semanticExpansion";
import { updateAgentToaster } from "../../../shared/agentsUtils";
import { contentConditionSchema } from "./schemas";
import { createMultiPageRefRegexPattern } from "./parsers";

/**
 * Expand search conditions with semantic terms using the shared expansion logic
 * This replaces the original expandConditions function with shared implementation
 */
export const expandConditions = async (
  conditions: z.infer<typeof contentConditionSchema>[],
  state?: any
): Promise<z.infer<typeof contentConditionSchema>[]> => {
  console.log(`🧠 [ContentTool] Using shared expansion logic for ${conditions.length} conditions`);
  
  // Use shared expansion function for consistency across tools
  return expandConditionsShared(conditions, state);
};

/**
 * Apply fuzzy matching post-processing to search results
 * This provides an additional layer of fuzzy matching on top of the database search
 */
export const applyFuzzyFiltering = (
  searchResults: any[],
  conditions: z.infer<typeof contentConditionSchema>[],
  threshold: number
): any[] => {
  if (!searchResults.length) return searchResults;

  // Extract text conditions for fuzzy matching
  const textConditions = conditions.filter((cond) => cond.type === "text");
  if (!textConditions.length) return searchResults;

  const { fuzzyMatch } = require("../../helpers/searchUtils");

  return searchResults.filter(([uid, content, time, pageTitle, pageUid]) => {
    // Apply fuzzy matching to block content
    const blockContent = content?.toLowerCase() || "";

    // Check if all text conditions match (considering AND/OR logic would be complex here, so we use ANY match)
    return textConditions.some((condition) => {
      const searchTerm = condition.text.toLowerCase();

      let matches = false;

      // For exact matches, skip fuzzy logic
      if (condition.matchType === "exact") {
        matches = blockContent === searchTerm;
      } else {
        // For contains/regex, apply fuzzy matching to improve recall
        if (blockContent.includes(searchTerm)) {
          matches = true; // Exact substring match always passes
        } else {
          // Apply fuzzy matching to individual words in content
          const contentWords = blockContent.split(/\s+/);
          const searchWords = searchTerm.split(/\s+/);

          // Check if any search word fuzzy matches any content word
          matches = searchWords.some((searchWord) =>
            contentWords.some((contentWord) =>
              fuzzyMatch(searchWord, contentWord, threshold)
            )
          );
        }
      }

      // Apply negation if specified for this condition
      return condition.negate ? !matches : matches;
    });
  });
};

/**
 * Enrich results with hierarchy context (children and parents)
 */
export const enrichWithHierarchy = async (
  results: any[],
  includeChildren: boolean,
  childDepth: number,
  includeParents: boolean,
  parentDepth: number,
  secureMode: boolean = false,
  expansionLevel: number = 0
): Promise<any[]> => {
  console.log(`🔧 enrichWithHierarchy: Processing ${results.length} results`);
  
  const { isDailyNote, getBlockChildren, getBlockParents } = await import("../../helpers/searchUtils");
  const enrichedResults: any[] = [];

  for (const [uid, content, time, pageTitle, pageUid] of results) {
    const blockResult = {
      uid,
      content: secureMode ? undefined : content,
      created: new Date(time),
      modified: new Date(time),
      pageTitle,
      pageUid,
      isDaily: isDailyNote(pageUid),
      children: [],
      parents: [],
      // Explicit type flag (isPage: false means it's a block)
      isPage: false,
      // Add expansion level for ranking
      expansionLevel: expansionLevel,
    };

    // Get children if requested
    if (includeChildren) {
      blockResult.children = await getBlockChildren(
        uid,
        childDepth,
        secureMode
      );
    }

    // Get parents if requested
    if (includeParents) {
      blockResult.parents = await getBlockParents(uid, parentDepth, secureMode);
    }

    enrichedResults.push(blockResult);
    console.log(
      `🔧 enrichWithHierarchy: Added block ${uid}, total: ${enrichedResults.length}`
    );
  }

  console.log(
    `🔧 enrichWithHierarchy: Returning ${enrichedResults.length} enriched results`
  );
  return enrichedResults;
};