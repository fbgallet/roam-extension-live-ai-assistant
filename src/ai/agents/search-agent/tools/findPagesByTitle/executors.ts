import { executeDatomicQuery } from "../../helpers/searchUtils";
import { dnpUidRegex } from "../../../../../utils/regex.js";

/**
 * Execute efficient Datomic query for a single page title condition
 */
export const executePageTitleQuery = async (
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