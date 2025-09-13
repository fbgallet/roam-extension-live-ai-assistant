import { z } from "zod";
import {
  executeDatomicQuery,
  DatomicQueryBuilder,
  SearchCondition,
  sanitizeRegexForDatomic,
} from "../../helpers/searchUtils";
import { dnpUidRegex } from "../../../../../utils/regex.js";
import { contentConditionSchema } from "./schemas";

/**
 * Search blocks with conditions using Datomic queries
 */
export const searchBlocksWithConditions = async (
  conditions: z.infer<typeof contentConditionSchema>[],
  combineLogic: "AND" | "OR",
  includeDaily: boolean,
  dailyNotesOnly: boolean = false,
  limitToPages?: string[],
  limitToBlockUids?: string[],
  limitToPageUids?: string[]
): Promise<any[]> => {
  // Build base query for all blocks
  let query = `[:find ?uid ?content ?time ?page-title ?page-uid
                :where 
                [?b :block/uid ?uid]
                [?b :block/string ?content]
                [?b :block/page ?page]
                [?page :node/title ?page-title]
                [?page :block/uid ?page-uid]
                [?b :edit/time ?time]`;

  // Add page scope limitation if specified
  if (limitToPages && limitToPages.length > 0) {
    if (limitToPages.length === 1) {
      query += `\n                [?page :node/title "${limitToPages[0]}"]`;
    } else {
      const orClauses = limitToPages.map(
        (page) => `[?page :node/title "${page}"]`
      );
      query += `\n                (or ${orClauses.join(" ")})`;
    }
  }

  // Add UID-based filtering for optimization
  if (limitToBlockUids && limitToBlockUids.length > 0) {
    if (limitToBlockUids.length === 1) {
      query += `\n                [?b :block/uid "${limitToBlockUids[0]}"]`;
    } else {
      const uidsSet = limitToBlockUids.map((uid) => `"${uid}"`).join(" ");
      query += `\n                [(contains? #{${uidsSet}} ?uid)]`;
    }
  }

  if (limitToPageUids && limitToPageUids.length > 0) {
    console.log(
      `⚡ Optimizing: Filtering to blocks within ${limitToPageUids.length} specific page UIDs`
    );
    if (limitToPageUids.length === 1) {
      query += `\n                [?page :block/uid "${limitToPageUids[0]}"]`;
    } else {
      const uidsSet = limitToPageUids.map((uid) => `"${uid}"`).join(" ");
      query += `\n                [(contains? #{${uidsSet}} ?page-uid)]`;
    }
  }

  // Add DNP filtering logic
  if (dailyNotesOnly) {
    // Search ONLY in daily notes
    query += `\n                [(re-pattern "${dnpUidRegex.source.slice(
      1,
      -1
    )}") ?dnp-pattern]
                [(re-find ?dnp-pattern ?page-uid)]`;
  } else if (!includeDaily) {
    // Exclude daily notes
    query += `\n                [(re-pattern "${dnpUidRegex.source.slice(
      1,
      -1
    )}") ?dnp-pattern]
                (not [(re-find ?dnp-pattern ?page-uid)])`;
  }

  // Add condition matching using shared query builder
  const searchConditions: SearchCondition[] = conditions.map((cond) => ({
    type: cond.type as any,
    text: cond.text,
    matchType: cond.matchType as any,
    semanticExpansion: cond.semanticExpansion,
    weight: cond.weight,
    negate: cond.negate,
  }));

  const queryBuilder = new DatomicQueryBuilder(searchConditions, combineLogic);
  const { patternDefinitions, conditionClauses } =
    queryBuilder.buildConditionClauses("?content");

  query += patternDefinitions;
  query += conditionClauses;

  query += `]`;

  console.log("🔍 Executing block search query...");
  return await executeDatomicQuery(query);
};

/**
 * Build a condition clause for the query (legacy function for AND logic)
 */
export const buildConditionClause = (
  condition: z.infer<typeof contentConditionSchema>,
  index: number,
  isInOr: boolean = false
): string => {
  const indent = isInOr ? "                  " : "                ";
  let clause = "";

  switch (condition.type) {
    case "page_ref":
      // Use proper Roam :block/refs attribute instead of regex
      clause = `\n${indent}[?ref-page${index} :node/title "${condition.text}"]
${indent}[?b :block/refs ?ref-page${index}]`;
      break;

    case "block_ref":
      // Use proper Roam :block/refs attribute for block references
      clause = `\n${indent}[?ref-block${index} :block/uid "${condition.text}"]
${indent}[?b :block/refs ?ref-block${index}]`;
      break;

    case "regex":
      const sanitizedRegex = sanitizeRegexForDatomic(condition.text);
      const regexWithFlags = sanitizedRegex.isCaseInsensitive
        ? sanitizedRegex.pattern
        : `(?i)${sanitizedRegex.pattern}`;
      clause = `\n${indent}[(re-pattern "${regexWithFlags}") ?pattern${index}]
${indent}[(re-find ?pattern${index} ?content)]`;
      break;

    case "text":
    default:
      if (condition.matchType === "exact") {
        clause = `\n${indent}[(= ?content "${condition.text}")]`;
      } else if (condition.matchType === "regex") {
        const sanitizedTextRegex = sanitizeRegexForDatomic(condition.text);
        const textRegexWithFlags = sanitizedTextRegex.isCaseInsensitive
          ? sanitizedTextRegex.pattern
          : `(?i)${sanitizedTextRegex.pattern}`;
        clause = `\n${indent}[(re-pattern "${textRegexWithFlags}") ?pattern${index}]
${indent}[(re-find ?pattern${index} ?content)]`;
      } else {
        // Use case-insensitive regex without problematic escape characters
        // Remove any special regex characters to prevent escape issues
        const cleanText = condition.text.replace(/[.*+?^${}()|[\]\\]/g, "");
        if (cleanText === condition.text) {
          // No special characters, can use regex safely
          clause = `\n${indent}[(re-pattern "(?i).*${condition.text}.*") ?pattern${index}]
${indent}[(re-find ?pattern${index} ?content)]`;
        } else {
          // Has special characters, use case-sensitive includes as fallback
          clause = `\n${indent}[(clojure.string/includes? ?content "${condition.text}")]`;
        }
      }
      break;
  }

  // Apply negation if needed
  if (condition.negate) {
    clause = `\n${indent}(not ${clause.trim()})`;
  }

  return clause;
};