import { z } from "zod";
import {
  isDailyNote,
  filterByDateRange,
  DatomicQueryBuilder,
  SearchCondition,
  extractUidsFromResults,
  sanitizeRegexForDatomic,
  PageWideQueryBuilder,
  processConditionGroupsForPageWide,
  parsePageSearchSyntax,
  executeDatomicQuery,
  expandConditionsShared,
  parseSemanticExpansion,
  generateSemanticExpansions,
} from "../../helpers/searchUtils";
import { dnpUidRegex } from "../../../../../utils/regex.js";
import {
  searchAttributeBlocksWithCapture,
  checkValueMatches,
  getDirectChildrenBatch,
  searchChildrenWithLogic,
} from "./executors";
import { parseAttributeCondition, createPageRefRegexPattern } from "./parsers";
import type { AttributeCondition, AttributeValue } from "./schemas";

/**
 * Create optimized regex pattern for multiple page reference variations
 * Creates a single efficient OR pattern instead of multiple separate patterns
 */
export const createMultiPageRefRegexPattern = (pageNames: string[]): string => {
  if (pageNames.length === 0) return "";
  if (pageNames.length === 1) return createPageRefRegexPattern(pageNames[0]);

  // Escape and prepare all page names
  const escapedNames = pageNames.map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );

  // Create alternation of just the terms
  const termAlternation = escapedNames.join("|");

  // Single optimized pattern: factors out common Roam syntax structures
  return `(?:\\[\\[(?:${termAlternation})\\]\\]|#(?:${termAlternation})(?!\\w)|(?:${termAlternation})::)`;
};

/**
 * Expand conditions with semantic terms using comprehensive approach from blocks tool
 */
export const expandConditions = async (
  conditions: any[],
  maxExpansions: number,
  state?: any
): Promise<any[]> => {
  // Use shared expansion logic for most conditions (text, etc.)
  const expandedConditions = await expandConditionsShared(conditions, state);

  // Additional page_ref expansion logic specific to pages tool (not in shared function yet)
  const hasGlobalExpansion = state?.isExpansionGlobal === true;

  if (!hasGlobalExpansion || !state?.semanticExpansion) {
    return expandedConditions; // No additional page_ref expansion needed
  }

  // Handle page_ref conditions that need semantic expansion
  for (const condition of expandedConditions) {
    if (
      condition.type === "page_ref" &&
      hasGlobalExpansion &&
      state?.semanticExpansion
    ) {
      try {
        const { parseSemanticExpansion, generateSemanticExpansions } =
          await import("../../helpers/searchUtils");
        const { cleanText } = parseSemanticExpansion(
          condition.text,
          state?.semanticExpansion
        );

        const customStrategy =
          state.semanticExpansion === "custom"
            ? state?.customSemanticExpansion
            : undefined;

        // For page_ref expansions, use generateSemanticExpansions
        const expansionTerms = await generateSemanticExpansions(
          cleanText,
          state.semanticExpansion as any,
          state?.userQuery,
          state?.model,
          state?.language,
          customStrategy,
          "page_ref" // Generate simple text variations for page references
        );

        console.log(
          `🔗 Expanding page reference "${condition.text}" with ${expansionTerms.length} semantic variations`
        );

        if (expansionTerms.length > 0) {
          // Create page reference syntax pattern
          const optimizedRegexPattern =
            createMultiPageRefRegexPattern(expansionTerms);

          // Replace original page_ref condition with expanded regex
          condition.type = "regex";
          condition.text = optimizedRegexPattern;
          condition.matchType = "regex";
          condition.semanticExpansion = undefined;
          condition.weight = (condition.weight || 1.0) * 0.7;

          console.log(
            `  ✅ Created optimized pattern for ${
              expansionTerms.length
            } expansion terms: ${expansionTerms.join(", ")}`
          );
        }
      } catch (error) {
        console.warn(
          `Failed to expand page_ref condition "${condition.text}":`,
          error
        );
      }
    }
  }

  return expandedConditions;
};

/**
 * Expand attribute condition with semantic terms if needed
 */
export const expandAttributeCondition = async (
  condition: AttributeCondition,
  state?: any
): Promise<AttributeCondition> => {
  const expandedValues: AttributeValue[] = [];

  for (const value of condition.values) {
    expandedValues.push(value);

    // Only expand text-type attribute values
    if (condition.valueType === "text" && value.value) {
      const { cleanText, expansionType } = parseSemanticExpansion(value.value);

      let effectiveStrategy = expansionType;
      if (!effectiveStrategy && state?.isExpansionGlobal) {
        effectiveStrategy = state?.semanticExpansion || "synonyms";
      }

      if (effectiveStrategy) {
        try {
          const expansionTerms = await generateSemanticExpansions(
            cleanText,
            effectiveStrategy as any,
            state?.userQuery,
            state?.model,
            state?.language,
            undefined,
            "text"
          );

          for (const term of expansionTerms) {
            if (term !== cleanText) {
              expandedValues.push({
                ...value,
                value: term,
              });
            }
          }
        } catch (error) {
          console.warn(
            `⚠️ Failed to expand attribute value "${value.value}":`,
            error.message
          );
        }
      }
    }
  }

  return { ...condition, values: expandedValues };
};

/**
 * Process page-wide conditions (conditions can match across different blocks)
 * Using the sophisticated implementation from the original tool
 */
export const processPageWideConditions = async (
  conditions: any[],
  includeDaily: boolean,
  limitToPageUids?: string[],
  excludeBlockUid?: string,
  state?: any
): Promise<any[]> => {
  // Separate attribute conditions from regular conditions
  const attributeConditions: AttributeCondition[] = [];
  const regularConditions: any[] = [];

  for (const condition of conditions) {
    if (condition.text?.startsWith("attr:")) {
      const parsed = parseAttributeCondition(condition.text);
      if (parsed) {
        // Apply semantic expansion to attribute values if needed
        const expandedAttrCondition = await expandAttributeCondition(
          parsed,
          state
        );
        attributeConditions.push(expandedAttrCondition);
      } else {
        console.warn(`Failed to parse attribute condition: ${condition.text}`);
      }
    } else {
      regularConditions.push(condition);
    }
  }

  let attributeResults: any[] = [];

  // Process attribute conditions (same as block-level for now - attributes are inherently page-wide)
  for (const attrCondition of attributeConditions) {
    // Use same attribute processing as block-level search
    const attributeBlocks = await searchAttributeBlocksWithCapture(
      attrCondition.attributeKey,
      includeDaily,
      limitToPageUids
    );

    if (attributeBlocks.length === 0) {
      continue;
    }

    let matches: any[] = [];

    // Separate empty and non-empty attribute blocks
    const emptyBlocks = attributeBlocks.filter((block) => block.isEmpty);
    const nonEmptyBlocks = attributeBlocks.filter((block) => !block.isEmpty);

    // Process non-empty blocks
    for (const block of nonEmptyBlocks) {
      const valueMatches = checkValueMatches(
        block.valueContent,
        attrCondition.values,
        attrCondition.valueType
      );
      if (valueMatches) {
        matches.push(block.pageData);
      }
    }

    // Process empty blocks (check their children)
    if (emptyBlocks.length > 0) {
      const emptyBlockUids = emptyBlocks.map((block) => block.uid);
      const childrenUids = await getDirectChildrenBatch(emptyBlockUids);

      if (childrenUids.length > 0) {
        const childrenMatches = await searchChildrenWithLogic(
          childrenUids,
          attrCondition.values,
          attrCondition.valueType,
          state
        );

        // Get matching page UIDs
        const matchingPageUids = new Set();
        for (const childMatch of childrenMatches) {
          const pageUid = childMatch[4];
          if (pageUid) {
            matchingPageUids.add(pageUid);
          }
        }

        // Return the empty attribute blocks whose children matched
        for (const block of emptyBlocks) {
          const blockPageUid = block.pageData[4];
          if (matchingPageUids.has(blockPageUid)) {
            matches.push(block.pageData);
          }
        }
      }
    }

    attributeResults = attributeResults.concat(matches);
  }

  // Process regular conditions with page-wide logic using PageWideQueryBuilder
  let regularResults: any[] = [];
  if (regularConditions.length > 0) {
    console.log(
      `🌐 Building page-wide query for ${regularConditions.length} conditions`
    );
    console.log(`🔧 [DEBUG] includeDaily value:`, includeDaily);

    // Convert conditions to SearchCondition format
    const searchConditions: SearchCondition[] = regularConditions.map(
      (cond) => ({
        type: cond.type as any,
        text: cond.text,
        matchType: cond.matchType as any,
        negate: cond.negate || false,
      })
    );

    // Build base query with correct format for page results
    const baseQuery = `[:find ?page-uid ?page-title ?page-created ?page-modified
                :where
                [?page :node/title ?page-title]
                [?page :block/uid ?page-uid]
                [?page :create/time ?page-created]
                [?page :edit/time ?page-modified]`;

    const queryBuilder = new PageWideQueryBuilder(
      searchConditions,
      "AND",
      baseQuery,
      excludeBlockUid
    );
    const pageWideQuery = queryBuilder.buildPageWideQuery();

    // Add additional constraints for includeDaily, limitToPageUids, excludeBlockUid
    let finalQuery = pageWideQuery.query;

    console.log(`🔧 [DEBUG] Raw query before modifications:`, finalQuery);

    // Remove any existing closing bracket to add our constraints
    if (finalQuery.endsWith("]")) {
      finalQuery = finalQuery.slice(0, -1);
    }

    // Add constraints one by one
    if (!includeDaily) {
      finalQuery += `\n                [(re-pattern "${dnpUidRegex.source.slice(
        1,
        -1
      )}") ?dnp-pattern]
                (not [(re-find ?dnp-pattern ?page-uid)])`;
    }

    if (limitToPageUids && limitToPageUids.length > 0) {
      if (limitToPageUids.length === 1) {
        finalQuery += `\n                [?page :block/uid "${limitToPageUids[0]}"]`;
      } else {
        const uidsSet = limitToPageUids.map((uid) => `"${uid}"`).join(" ");
        finalQuery += `\n                [(contains? #{${uidsSet}} ?page-uid)]`;
      }
    }

    // Close the query
    finalQuery += "]";

    console.log(`🔧 [DEBUG] Final query after modifications:`, finalQuery);

    console.log(
      `🔍 Executing page-wide query: ${finalQuery.substring(0, 200)}...`
    );
    const queryResults = await executeDatomicQuery(finalQuery);

    // Convert results to the expected format for further processing
    regularResults = queryResults.map(
      ([pageUid, pageTitle, pageCreated, pageModified]) => [
        pageUid, // Block UID (using page UID as placeholder)
        pageTitle, // Content (using page title as placeholder)
        pageModified, // Time
        pageTitle, // Page title
        pageUid, // Page UID
        pageCreated, // Page created
        pageModified, // Page modified
      ]
    );
    console.log(
      `🎯 Found ${regularResults.length} pages with page-wide matches`
    );
  }

  // Combine results based on combination logic (always AND for page-wide)
  let finalResults: any[] = [];
  if (attributeResults.length > 0 && regularResults.length > 0) {
    // Pages must have both attribute and regular matches
    finalResults = combineResultsByPageIntersection(
      attributeResults,
      regularResults
    );
    console.log(
      `🤝 Combined attribute + regular results: ${finalResults.length} pages`
    );
  } else if (attributeResults.length > 0) {
    finalResults = attributeResults;
    console.log(
      `🏷️ Using attribute results only: ${finalResults.length} pages`
    );
  } else {
    finalResults = regularResults;
    console.log(`📝 Using regular results only: ${finalResults.length} pages`);
  }

  return finalResults;
};

/**
 * Process all conditions (attribute and regular) with combination logic
 */
export const processAllConditions = async (
  conditions: any[],
  combineLogic: "AND" | "OR",
  includeDaily: boolean,
  limitToPageUids?: string[],
  excludeBlockUid?: string,
  state?: any
): Promise<any[]> => {
  // Separate attribute and regular conditions
  const attributeConditions: AttributeCondition[] = [];
  const regularConditions = [];

  for (const condition of conditions) {
    if (condition.text?.startsWith("attr:")) {
      const parsed = parseAttributeCondition(condition.text);
      if (parsed) {
        // Apply semantic expansion to attribute values if needed
        const expandedAttrCondition = await expandAttributeCondition(
          parsed,
          state
        );
        attributeConditions.push(expandedAttrCondition);
      } else {
        console.warn(`Failed to parse attribute condition: ${condition.text}`);
      }
    } else {
      regularConditions.push(condition);
    }
  }

  let attributeResults: any[] = [];

  // Process each attribute condition with intelligent capture-based strategy
  for (const attrCondition of attributeConditions) {
    // Step 1: Get ALL attribute blocks with capture group to analyze value content
    const attributeBlocks = await searchAttributeBlocksWithCapture(
      attrCondition.attributeKey,
      includeDaily,
      limitToPageUids
    );

    if (attributeBlocks.length === 0) {
      continue;
    }

    let matches: any[] = [];

    // Separate empty and non-empty attribute blocks
    const emptyBlocks = attributeBlocks.filter((block) => block.isEmpty);
    const nonEmptyBlocks = attributeBlocks.filter((block) => !block.isEmpty);

    // Step 2: Process non-empty blocks (check if they match the values directly)
    for (const block of nonEmptyBlocks) {
      const valueMatches = checkValueMatches(
        block.valueContent,
        attrCondition.values,
        attrCondition.valueType
      );
      if (valueMatches) {
        matches.push(block.pageData);
      }
    }

    // Step 3: Process empty blocks (check their children)
    if (emptyBlocks.length > 0) {
      const emptyBlockUids = emptyBlocks.map((block) => block.uid);
      const childrenUids = await getDirectChildrenBatch(emptyBlockUids);

      if (childrenUids.length > 0) {
        const childrenMatches = await searchChildrenWithLogic(
          childrenUids,
          attrCondition.values,
          attrCondition.valueType,
          state
        );

        // For children matches, we need to create block results that represent the attribute blocks
        // The parent empty attribute blocks should be returned, not the children
        // Get the unique page UIDs from children that matched
        const matchingPageUids = new Set();
        for (const childMatch of childrenMatches) {
          const pageUid = childMatch[4]; // pageUid is at index 4 in the array
          if (pageUid) {
            matchingPageUids.add(pageUid);
          }
        }

        // Return the empty attribute blocks (parents) whose children matched
        for (const block of emptyBlocks) {
          const blockPageUid = block.pageData[4]; // pageUid from pageData
          if (matchingPageUids.has(blockPageUid)) {
            matches.push(block.pageData); // This is already in the correct block format
          }
        }
      }
    }

    attributeResults = attributeResults.concat(matches);
  }

  // Process regular conditions normally
  let regularResults: any[] = [];
  if (regularConditions.length > 0) {
    regularResults = await findMatchingBlocks(
      regularConditions,
      combineLogic,
      includeDaily,
      limitToPageUids,
      excludeBlockUid
    );
  }

  // Combine results based on combination logic
  let finalResults: any[] = [];
  if (attributeResults.length > 0 && regularResults.length > 0) {
    if (combineLogic === "AND") {
      // Pages must have both attribute and regular matches
      finalResults = combineResultsByPageIntersection(
        attributeResults,
        regularResults
      );
    } else {
      // Pages can have either attribute or regular matches
      finalResults = combineResultsByPageUnion(
        attributeResults,
        regularResults
      );
    }
  } else if (attributeResults.length > 0) {
    finalResults = attributeResults;
  } else {
    finalResults = regularResults;
  }

  return finalResults;
};

/**
 * Combine results by page intersection (AND logic)
 */
export const combineResultsByPageIntersection = (
  results1: any[],
  results2: any[]
): any[] => {
  const pages1 = new Set(results1.map(([, , , , pageUid]) => pageUid));
  return results2.filter(([, , , , pageUid]) => pages1.has(pageUid));
};

/**
 * Combine results by page union (OR logic)
 */
export const combineResultsByPageUnion = (
  results1: any[],
  results2: any[]
): any[] => {
  const seenPages = new Set();
  const combined = [];

  // Add all results, avoiding page duplicates (keep first occurrence)
  for (const result of [...results1, ...results2]) {
    const pageUid = result[4]; // pageUid is at index 4
    if (!seenPages.has(pageUid)) {
      seenPages.add(pageUid);
      combined.push(result);
    }
  }

  return combined;
};

/**
 * Find all blocks matching the conditions (legacy function for regular conditions)
 */
export const findMatchingBlocks = async (
  conditions: any[],
  combineLogic: "AND" | "OR",
  includeDaily: boolean,
  limitToPageUids?: string[],
  excludeBlockUid?: string
): Promise<any[]> => {
  // Convert conditions to SearchCondition format
  const searchConditions: SearchCondition[] = conditions.map((cond) => ({
    type: cond.type as any,
    text: cond.text,
    matchType: cond.matchType as any,
    semanticExpansion: cond.semanticExpansion,
    weight: cond.weight,
    negate: cond.negate || false,
  }));

  // Use DatomicQueryBuilder with proper constructor
  const queryBuilder = new DatomicQueryBuilder(searchConditions, combineLogic);

  const { patternDefinitions, conditionClauses } =
    queryBuilder.buildConditionClauses();

  // Build the complete query
  let query = `[:find ?uid ?content ?time ?page-title ?page-uid ?page-created ?page-modified
                :where 
                [?b :block/uid ?uid]
                [?b :block/string ?content]
                [?b :block/page ?page]
                [?page :node/title ?page-title]
                [?page :block/uid ?page-uid]
                [?page :create/time ?page-created]
                [?page :edit/time ?page-modified]
                [?b :edit/time ?time]`;

  // Add pattern definitions
  if (patternDefinitions) {
    query += "\n                " + patternDefinitions;
  }

  // Add condition clauses
  if (conditionClauses) {
    query += "\n                " + conditionClauses;
  }

  // Add additional filtering
  if (limitToPageUids && limitToPageUids.length > 0) {
    if (limitToPageUids.length === 1) {
      query += `\n                [?page :block/uid "${limitToPageUids[0]}"]`;
    } else {
      const uidsSet = limitToPageUids.map((uid) => `"${uid}"`).join(" ");
      query += `\n                [(contains? #{${uidsSet}} ?page-uid)]`;
    }
  }

  if (!includeDaily) {
    const dnpPattern = dnpUidRegex.source.slice(1, -1);
    query += `\n                [(re-pattern "${dnpPattern}") ?dnp-pattern]
                (not [(re-find ?dnp-pattern ?page-uid)])`;
  }

  if (excludeBlockUid) {
    query += `\n                [(not= ?uid "${excludeBlockUid}")]`;
  }

  query += `]`;

  return await executeDatomicQuery(query);
};
