// Import necessary types and utilities
import type { SearchCondition } from "../../helpers/searchUtils";
import {
  executeDatomicQuery,
  isDailyNote,
  filterByDateRange,
  getFlattenedDescendants,
  getFlattenedAncestors,
  DatomicQueryBuilder,
  extractUidsFromResults,
  deduplicateResultsByUid,
  sanitizeRegexForDatomic,
} from "../../helpers/searchUtils";
import { updateAgentToaster } from "../../../shared/agentsUtils";
import { dnpUidRegex } from "../../../../../utils/regex.js";
import {
  expandConditions,
  applyHierarchyFilters,
  enrichWithFullHierarchy,
  sortHierarchyResults,
} from "./processors";
import { findBlocksByContentTool } from "../findBlocksByContentTool";
import { extractChildUids } from "./findBlocksWithHierarchyTool";
import { combineResultsTool } from "../combineResultsTool";

/**
 * Execute structured strict hierarchy search: left > right (left parent, right child)
 */
export const executeStructuredStrictHierarchySearch = async (
  leftConditions: any[],
  rightConditions: any[],
  leftCombination: string,
  rightCombination: string,
  options: any,
  state?: any
): Promise<any[]> => {
  // Convert structured conditions to SearchCondition format
  const convertToSearchConditions = (conditions: any[]): SearchCondition[] => {
    return conditions.map((cond) => ({
      type: cond.type,
      text: cond.text,
      matchType: cond.matchType || "contains",
      semanticExpansion: cond.semanticExpansion,
      weight: cond.weight || 1,
      negate: cond.negate || false,
    }));
  };

  const leftSearchConditions = convertToSearchConditions(leftConditions);
  const rightSearchConditions = convertToSearchConditions(rightConditions);

  // Use existing strict hierarchy search function
  const resultSets = await executeStrictHierarchySearch(
    leftSearchConditions,
    rightSearchConditions,
    leftCombination as "AND" | "OR",
    rightCombination as "AND" | "OR",
    options,
    state
  );

  // Flatten result sets array into single array
  return resultSets.flat();
};

/**
 * Execute strict hierarchy search: A > B (A parent, B child)
 */
export const executeStrictHierarchySearch = async (
  leftConditions: SearchCondition[],
  rightConditions: SearchCondition[],
  leftCombineLogic: "AND" | "OR",
  rightCombineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {

  // Show search terms without extra queries (for performance)
  // const leftTermText = leftConditions
  //   .map((c) => c.text)
  //   .join(leftCombineLogic === "OR" ? " | " : " + ");
  // const rightTermText = rightConditions
  //   .map((c) => c.text)
  //   .join(rightCombineLogic === "OR" ? " | " : " + ");

  // Use direct content-filtered hierarchy search (like deep search does)
  console.log(
    `🔍 Building single Datomic query for parent→child with content filtering`
  );

  const results = await executeDirectHierarchySearch(
    leftConditions,
    leftCombineLogic,
    rightConditions,
    rightCombineLogic,
    options,
    state
  );

  if (results.length > 0) {
    updateAgentToaster(
      `🏗️ Parent→child search: ${results.length} hierarchy relationships found`
    );
  }

  return [results]; // Return as array of result sets
};

/**
 * Execute structured bidirectional search: left <=> right (either direction)
 */
export const executeStructuredBidirectionalSearch = async (
  leftConditions: any[],
  rightConditions: any[],
  leftCombination: string,
  rightCombination: string,
  options: any,
  state?: any
): Promise<any[]> => {
  // Convert structured conditions to SearchCondition format
  const convertToSearchConditions = (conditions: any[]): SearchCondition[] => {
    return conditions.map((cond) => ({
      type: cond.type,
      text: cond.text,
      matchType: cond.matchType || "contains",
      semanticExpansion: cond.semanticExpansion,
      weight: cond.weight || 1,
      negate: cond.negate || false,
    }));
  };

  const leftSearchConditions = convertToSearchConditions(leftConditions);
  const rightSearchConditions = convertToSearchConditions(rightConditions);

  // Use existing bidirectional search function
  const resultSets = await executeBidirectionalSearch(
    leftSearchConditions,
    rightSearchConditions,
    leftCombination as "AND" | "OR",
    rightCombination as "AND" | "OR",
    options,
    state
  );

  // Flatten result sets array into single array
  return resultSets.flat();
};

/**
 * Execute structured flexible hierarchy search: left => right (same block OR left parent of right)
 */
export const executeStructuredFlexibleHierarchySearch = async (
  leftConditions: any[],
  rightConditions: any[],
  leftCombination: string,
  rightCombination: string,
  options: any,
  state?: any
): Promise<any[]> => {
  // Convert structured conditions to SearchCondition format
  const convertToSearchConditions = (conditions: any[]): SearchCondition[] => {
    return conditions.map((cond) => ({
      type: cond.type,
      text: cond.text,
      matchType: cond.matchType || "contains",
      semanticExpansion: cond.semanticExpansion,
      weight: cond.weight || 1,
      negate: cond.negate || false,
    }));
  };

  const leftSearchConditions = convertToSearchConditions(leftConditions);
  const rightSearchConditions = convertToSearchConditions(rightConditions);

  // Use existing flexible hierarchy search function
  const resultSets = await executeFlexibleHierarchySearch(
    leftSearchConditions,
    rightSearchConditions,
    leftCombination as "AND" | "OR",
    rightCombination as "AND" | "OR",
    options,
    state
  );

  // Flatten result sets array into single array
  return resultSets.flat();
};

/**
 * Execute structured deep flexible hierarchy search: left =>> right (left ancestor, right descendant with flexibility, deep)
 */
export const executeStructuredDeepFlexibleHierarchySearch = async (
  leftConditions: any[],
  rightConditions: any[],
  leftCombination: string,
  rightCombination: string,
  options: any,
  state?: any
): Promise<any[]> => {
  // Convert structured conditions to SearchCondition format
  const convertToSearchConditions = (conditions: any[]): SearchCondition[] => {
    return conditions.map((cond) => ({
      type: cond.type,
      text: cond.text,
      matchType: cond.matchType || "contains",
      semanticExpansion: cond.semanticExpansion,
      weight: cond.weight || 1,
      negate: cond.negate || false,
    }));
  };

  const leftSearchConditions = convertToSearchConditions(leftConditions);
  const rightSearchConditions = convertToSearchConditions(rightConditions);

  // For =>> operator, we need flexible search with max depth instead of levels: 1
  // Step 1: Same-block search (A + B) - like flexible hierarchy
  console.log(`📝 Step 1: Same-block search (A + B)`);
  const sameBlockConditions = [
    ...leftSearchConditions,
    ...rightSearchConditions,
  ];
  const sameBlockSearch = await executeContentSearch(
    sameBlockConditions,
    "AND", // For flexible hierarchy, both terms must appear
    options,
    state
  );

  // Step 2: Deep hierarchy search (A =>> B) - use max depth
  console.log(`🌳 Step 2: Deep flexible hierarchy search (A =>> B, max depth)`);
  const hierarchyResults = await searchBlocksWithHierarchicalConditions(
    leftSearchConditions,
    leftCombination as "AND" | "OR",
    [
      {
        direction: "descendants" as const,
        levels: options.maxHierarchyDepth, // Use max depth for =>> operator
        conditions: rightSearchConditions.map((cond) => ({
          type: cond.type as any,
          text: cond.text,
          matchType: cond.matchType,
          semanticExpansion: cond.semanticExpansion,
          weight: cond.weight,
          negate: cond.negate,
        })),
        combineLogic: rightCombination as "AND" | "OR",
      },
    ],
    "AND",
    options,
    state
  );

  // Combine results with same-block priority (like flexible hierarchy)
  const resultSets = [sameBlockSearch.results, hierarchyResults];

  // Flatten result sets and ensure expansionLevel is set
  const flatResults = resultSets.flat();
  const expansionLevel = state?.expansionLevel || 0;

  return flatResults.map((result) => ({
    ...result,
    expansionLevel: result.expansionLevel || expansionLevel,
  }));
};

/**
 * Execute structured deep bidirectional search: left <<=>> right (either direction, any depth)
 */
export const executeStructuredDeepBidirectionalSearch = async (
  leftConditions: any[],
  rightConditions: any[],
  leftCombination: string,
  rightCombination: string,
  options: any,
  state?: any
): Promise<any[]> => {
  console.log("🔄🌳 Executing structured deep bidirectional search");

  // Convert structured conditions to SearchCondition format
  const convertToSearchConditions = (conditions: any[]): SearchCondition[] => {
    return conditions.map((cond) => ({
      type: cond.type,
      text: cond.text,
      matchType: cond.matchType || "contains",
      semanticExpansion: cond.semanticExpansion,
      weight: cond.weight || 1,
      negate: cond.negate || false,
    }));
  };

  const leftSearchConditions = convertToSearchConditions(leftConditions);
  const rightSearchConditions = convertToSearchConditions(rightConditions);

  // Use existing deep bidirectional search function
  const resultSets = await executeDeepBidirectionalSearch(
    leftSearchConditions,
    rightSearchConditions,
    leftCombination as "AND" | "OR",
    rightCombination as "AND" | "OR",
    options,
    state
  );

  // Flatten result sets and ensure expansionLevel is set
  const flatResults = resultSets.flat();
  const expansionLevel = state?.expansionLevel || 0;

  return flatResults.map((result) => ({
    ...result,
    expansionLevel: result.expansionLevel || expansionLevel,
  }));
};

/**
 * Execute structured deep strict hierarchy search: left >> right (left ancestor, right descendant)
 */
export const executeStructuredDeepStrictHierarchySearch = async (
  leftConditions: any[],
  rightConditions: any[],
  leftCombination: string,
  rightCombination: string,
  options: any,
  state?: any
): Promise<any[]> => {
  console.log("🌳 Executing structured deep strict hierarchy search");

  // Convert structured conditions to SearchCondition format
  const convertToSearchConditions = (conditions: any[]): SearchCondition[] => {
    return conditions.map((cond) => ({
      type: cond.type,
      text: cond.text,
      matchType: cond.matchType || "contains",
      semanticExpansion: cond.semanticExpansion,
      weight: cond.weight || 1,
      negate: cond.negate || false,
    }));
  };

  const leftSearchConditions = convertToSearchConditions(leftConditions);
  const rightSearchConditions = convertToSearchConditions(rightConditions);

  // Use existing deep hierarchy search function
  const resultSets = await executeDeepStrictHierarchySearch(
    leftSearchConditions,
    rightSearchConditions,
    leftCombination as "AND" | "OR",
    rightCombination as "AND" | "OR",
    options,
    state
  );

  // Flatten result sets array into single array
  return resultSets.flat();
};

/**
 * Execute content search using findBlocksByContent
 */
export const executeContentSearch = async (
  conditions: SearchCondition[],
  combineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<{ results: any[]; totalFound: number }> => {
  // If no conditions, return empty results instead of calling findBlocksByContent
  if (!conditions || conditions.length === 0) {
    return { results: [], totalFound: 0 };
  }

  try {
    const toolInput = {
      conditions: conditions.map((cond) => ({
        text: cond.text,
        type: cond.type || "text",
        matchType: cond.matchType || "contains",
        negate: cond.negate || false,
        semanticExpansion: null, // Force disable expansion for sub-calls
      })),
      combineConditions: combineLogic,
      includeDaily: options.includeDaily,
      dateRange: options.dateRange,
      limit: options.limit,
      secureMode: options.secureMode,
    };

    // Call the tool with minimal context to avoid serialization issues
    const result = await findBlocksByContentTool.invoke(toolInput, {
      configurable: { state },
      runName: "internal_call",
    });
    const parsedResult =
      typeof result === "string" ? JSON.parse(result) : result;

    if (parsedResult.success && Array.isArray(parsedResult.data)) {
      // Return both results and metadata for real counts
      return {
        results: parsedResult.data,
        totalFound:
          parsedResult.metadata?.totalFound || parsedResult.data.length,
      };
    } else {
      console.warn(
        `⚠️ Content search failed or returned no data:`,
        parsedResult.error
      );
      return { results: [], totalFound: 0 };
    }
  } catch (error) {
    console.error(`❌ Error in content search:`, error);
    return { results: [], totalFound: 0 };
  }
};

/**
 * Execute inverse strict hierarchy search: A < B (A child, B parent) - returns child blocks
 * Just swap the roles in the existing direct hierarchy search but return child blocks
 */
export const executeInverseStrictHierarchySearch = async (
  childConditions: SearchCondition[], // Conditions for blocks to return (children)
  parentConditions: SearchCondition[], // Conditions for parent blocks (filter)
  childCombineLogic: "AND" | "OR",
  parentCombineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  console.log(
    `🏗️ Executing inverse strict hierarchy search (returning children)`
  );

  // Call executeDirectHierarchySearch but we need to extract child blocks from the query results
  // This is much simpler than my previous overcomplicated approach
  const hierarchyResults = await executeDirectHierarchySearchAndReturnChildren(
    parentConditions, // Parent conditions (for filtering)
    parentCombineLogic,
    childConditions, // Child conditions (for results)
    childCombineLogic,
    options,
    state
  );

  if (hierarchyResults.length > 0) {
    updateAgentToaster(
      `🏗️ Child←parent search: ${hierarchyResults.length} hierarchy relationships found`
    );
  }

  return [hierarchyResults]; // Return as array of result sets
};

/**
 * Execute the same direct hierarchy search as executeDirectHierarchySearch but return child blocks instead of parent blocks
 * This is a minimal modification - same efficient Datomic query, just different result mapping
 */
export const executeDirectHierarchySearchAndReturnChildren = async (
  parentConditions: SearchCondition[],
  parentCombineLogic: "AND" | "OR",
  childConditions: SearchCondition[],
  childCombineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  // Apply semantic expansion (same as original)
  const shouldExpand =
    parentConditions.some((c) => c.semanticExpansion) ||
    childConditions.some((c) => c.semanticExpansion);
  const expandedParentConditions = shouldExpand
    ? await expandConditions(parentConditions, state)
    : parentConditions;
  const expandedChildConditions = shouldExpand
    ? await expandConditions(childConditions, state)
    : childConditions;

  // Build Datomic query - structure depends on child combination logic
  let query;

  if (childCombineLogic === "AND" && expandedChildConditions.length > 1) {
    // For hierarchical AND: use separate child variables for each condition
    console.log(
      `🔧 [HierarchyAND] Building query with separate child variables for ${expandedChildConditions.length} AND conditions`
    );

    query = `[:find ?parent-uid ?parent-content ?parent-page-title ?parent-page-uid 
                     ?child-uid ?child-content ?child-page-title ?child-page-uid
              :where
              ;; Parent block structure
              [?parent :block/uid ?parent-uid]
              [?parent :block/string ?parent-content]
              [?parent :block/page ?parent-page]
              [?parent-page :node/title ?parent-page-title]
              [?parent-page :block/uid ?parent-page-uid]
              
              ;; Representative child for results (any child for display)
              [?parent :block/children ?child]
              [?child :block/uid ?child-uid]
              [?child :block/string ?child-content]  
              [?child :block/page ?child-page]
              [?child-page :node/title ?child-page-title]
              [?child-page :block/uid ?child-page-uid]`;

    // Add separate child variables for each condition
    for (let i = 0; i < expandedChildConditions.length; i++) {
      const childVar = `?child${i + 1}`;
      const childContentVar = `${childVar}-content`;

      query += `
              
              ;; Child ${i + 1} for condition ${i + 1}
              [?parent :block/children ${childVar}]
              [${childVar} :block/string ${childContentVar}]`;
    }
  } else {
    // For OR logic or single condition: use original single-child approach
    query = `[:find ?parent-uid ?parent-content ?parent-page-title ?parent-page-uid 
                     ?child-uid ?child-content ?child-page-title ?child-page-uid
              :where
              ;; Parent block structure
              [?parent :block/uid ?parent-uid]
              [?parent :block/string ?parent-content]
              [?parent :block/page ?parent-page]
              [?parent-page :node/title ?parent-page-title]
              [?parent-page :block/uid ?parent-page-uid]
              
              ;; Child block structure  
              [?child :block/uid ?child-uid]
              [?child :block/string ?child-content]
              [?child :block/page ?child-page]
              [?child-page :node/title ?child-page-title]
              [?child-page :block/uid ?child-page-uid]
              
              ;; Hierarchy relationship (parent -> child)
              [?parent :block/children ?child]`;
  }

  // Add parent content filtering (same as original)
  const parentQueryBuilder = new DatomicQueryBuilder(
    expandedParentConditions,
    parentCombineLogic
  );
  const {
    patternDefinitions: parentPatterns,
    conditionClauses: parentClauses,
  } = parentQueryBuilder.buildConditionClauses("?parent-content");
  query += parentPatterns;
  query += parentClauses;

  // Handle child content filtering based on combination logic
  if (childCombineLogic === "AND" && expandedChildConditions.length > 1) {
    // For hierarchical AND: apply each condition to its separate child variable
    let allChildPatterns = "";
    let allChildClauses = "";

    for (let i = 0; i < expandedChildConditions.length; i++) {
      const childVar = `?child${i + 1}`;
      const childContentVar = `${childVar}-content`;
      const condition = expandedChildConditions[i];

      // Build condition clauses for this specific child
      const singleConditionBuilder = new DatomicQueryBuilder(
        [condition],
        "AND"
      );
      const { patternDefinitions, conditionClauses } =
        singleConditionBuilder.buildConditionClauses(childContentVar);

      // Fix pattern variable conflicts
      const offsetPatterns = patternDefinitions.replace(
        /\?pattern(\d+)/g,
        (_, num) =>
          `?pattern${parseInt(num) + expandedParentConditions.length + i * 10}`
      );
      const offsetClauses = conditionClauses.replace(
        /\?pattern(\d+)/g,
        (_, num) =>
          `?pattern${parseInt(num) + expandedParentConditions.length + i * 10}`
      );

      allChildPatterns += offsetPatterns;
      allChildClauses += offsetClauses;
    }

    // Note: Representative child (?child) doesn't need to match any specific condition
    // It's just used for result formatting and will be one of the matching children

    query += allChildPatterns;
    query += allChildClauses;
  } else {
    // For OR logic or single condition: use original single-child approach
    const childQueryBuilder = new DatomicQueryBuilder(
      expandedChildConditions,
      childCombineLogic
    );
    const {
      patternDefinitions: childPatterns,
      conditionClauses: childClauses,
    } = childQueryBuilder.buildConditionClauses("?child-content");

    // Fix pattern variable conflicts by replacing pattern indices in child patterns
    const offsetChildPatterns = childPatterns.replace(
      /\?pattern(\d+)/g,
      (_, num) => `?pattern${parseInt(num) + expandedParentConditions.length}`
    );
    const offsetChildClauses = childClauses.replace(
      /\?pattern(\d+)/g,
      (_, num) => `?pattern${parseInt(num) + expandedParentConditions.length}`
    );

    query += offsetChildPatterns;
    query += offsetChildClauses;
  }

  // Exclude specific block if provided (same as original)
  if (options.excludeBlockUid) {
    query += `\n                [(not= ?child-uid "${options.excludeBlockUid}")]`;
  }

  query += `]`;

  const hierarchyResults = await executeDatomicQuery(query);

  // Transform results to return CHILD blocks instead of parent blocks (only difference from original)
  const childBlocks = hierarchyResults.map(
    ([
      parentUid,
      parentContent,
      parentPageTitle,
      parentPageUid,
      childUid,
      childContent,
      childPageTitle,
      childPageUid,
    ]) => ({
      uid: childUid, // Return child UID instead of parent UID
      content: childContent, // Return child content instead of parent content
      pageTitle: childPageTitle,
      pageUid: childPageUid,
      created: new Date(),
      modified: new Date(),
      isDaily: false,
      children: [],
      parents: [],
      isPage: false,
      // Add hierarchy context for debugging
      parentInfo: {
        uid: parentUid,
        content: parentContent,
        pageTitle: parentPageTitle,
        pageUid: parentPageUid,
      },
    })
  );

  return childBlocks;
};

/**
 * Execute deep strict hierarchy search: A >> B (A ancestor, B descendant, any depth)
 */
export const executeDeepStrictHierarchySearch = async (
  leftConditions: SearchCondition[],
  rightConditions: SearchCondition[],
  leftCombineLogic: "AND" | "OR",
  rightCombineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  console.log(`🌳 Executing deep strict hierarchy search (>> operator)`);

  // Show search terms without extra queries (for performance)
  // const leftTermText = leftConditions
  //   .map((c) => c.text)
  //   .join(leftCombineLogic === "OR" ? " | " : " + ");
  // const rightTermText = rightConditions
  //   .map((c) => c.text)
  //   .join(rightCombineLogic === "OR" ? " | " : " + ");

  // Use deep hierarchy search functionality with maxHierarchyDepth
  const results = await searchBlocksWithHierarchicalConditions(
    leftConditions,
    leftCombineLogic,
    [
      {
        direction: "descendants" as const,
        levels: options.maxHierarchyDepth, // Use max depth for deep search
        conditions: rightConditions.map((cond) => ({
          type: cond.type as any,
          text: cond.text,
          matchType: cond.matchType as any,
          weight: cond.weight || 1,
          negate: cond.negate || false,
        })),
      },
    ],
    rightCombineLogic,
    options,
    state
  );

  if (results.length > 0) {
    updateAgentToaster(
      `🌳 Ancestor→descendant search (depth ${options.maxHierarchyDepth}): ${results.length} hierarchy relationships found`
    );
  }
  return [results]; // Return as array of result sets
};

/**
 * Execute combineResults tool internally
 */
export const executeCombineResults = async (
  resultSets: any[],
  operation: "union" | "intersection"
): Promise<any[]> => {
  if (resultSets.length === 0) {
    return [];
  }

  if (resultSets.length === 1) {
    return resultSets[0];
  }

  try {
    // Prepare result sets for combineResults tool
    const combineInput = {
      resultSets: resultSets.map((results, index) => ({
        name: `strategy_${index + 1}`,
        uids: results
          .map((result: any) => result.uid)
          .filter((uid: string) => uid),
        type: "blocks" as const,
      })),
      operation: operation,
    };

    const result = await combineResultsTool.invoke(combineInput, {
      runName: "internal_call",
    });
    const parsedResult =
      typeof result === "string" ? JSON.parse(result) : result;

    if (parsedResult.success && parsedResult.data) {
      const combinedUids = parsedResult.data.uids || [];

      // Map UIDs back to full result objects
      const uidToResult = new Map<string, any>();
      for (const resultSet of resultSets) {
        for (const result of resultSet) {
          if (result.uid) {
            uidToResult.set(result.uid, result);
          }
        }
      }

      return combinedUids
        .map((uid: string) => uidToResult.get(uid))
        .filter(Boolean);
    } else {
      console.warn(`⚠️ Combine results failed:`, parsedResult.error);
      return [];
    }
  } catch (error) {
    console.error(`❌ Error in combine results:`, error);
    // Fallback: simple deduplication union
    const allResults = resultSets.flat();
    return deduplicateResultsByUid(allResults, "hierarchical_fallback");
  }
};

/**
 * Search blocks with content conditions
 */
export const searchBlocksWithConditions = async (
  conditions: any[],
  combineLogic: "AND" | "OR",
  includeDaily: boolean,
  limitToBlockUids?: string[],
  limitToPageUids?: string[]
): Promise<any[]> => {
  let query = `[:find ?uid ?content ?time ?page-title ?page-uid
                :where 
                [?b :block/uid ?uid]
                [?b :block/string ?content]
                [?b :block/page ?page]
                [?page :node/title ?page-title]
                [?page :block/uid ?page-uid]
                [?b :edit/time ?time]`;

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
    if (limitToPageUids.length === 1) {
      query += `\n                [?page :block/uid "${limitToPageUids[0]}"]`;
    } else {
      const uidsSet = limitToPageUids.map((uid) => `"${uid}"`).join(" ");
      query += `\n                [(contains? #{${uidsSet}} ?page-uid)]`;
    }
  }

  if (!includeDaily) {
    query += `\n                [(re-pattern "${dnpUidRegex.source.slice(
      1,
      -1
    )}") ?dnp-pattern]
                (not [(re-find ?dnp-pattern ?page-uid)])`;
  }

  // Add condition matching using shared query builder with regex optimization
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

  const results = await executeDatomicQuery(query);
  // Format conditions display with correct logic
  const conditionsDisplay = conditions
    .map((c) => c.text)
    .join(combineLogic === "OR" ? " | " : " + ");

  // Store count globally so flexible hierarchy search can access it
  if (!globalThis.hierarchyCounts) globalThis.hierarchyCounts = {};
  globalThis.hierarchyCounts[conditionsDisplay] = results.length;

  return results;
};

/**
 * Execute bidirectional search: A <=> B (A parent of B OR B parent of A)
 * Implements parent-priority deduplication to prevent duplicate relationships
 */
export const executeBidirectionalSearch = async (
  leftConditions: SearchCondition[],
  rightConditions: SearchCondition[],
  leftCombineLogic: "AND" | "OR",
  rightCombineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  const allResults = new Map<string, any>(); // uid -> result object
  const parentList = new Set<string>(); // UIDs of A-containing blocks
  const child1List = new Set<string>(); // UIDs of B-containing blocks (children of parentList)

  // Step 1: Same-block results (highest priority) - A + B in same block
  console.log(`📝 Step 1: Same-block search (A + B)`);
  const sameBlockConditions = [...leftConditions, ...rightConditions];
  const sameBlockSearch = await executeContentSearch(
    sameBlockConditions,
    "AND", // Both A and B must be in same block
    options,
    state
  );
  const sameBlockResults = sameBlockSearch.results;

  sameBlockResults.forEach((result) => {
    allResults.set(result.uid, result);
  });

  console.log(
    `📊 Same-block strategy found: ${sameBlockResults.length} results`
  );

  // Show search terms and get real counts from individual searches
  const leftTermText = leftConditions
    .map((c) => c.text)
    .join(leftCombineLogic === "OR" ? " | " : " + ");
  const rightTermText = rightConditions
    .map((c) => c.text)
    .join(rightCombineLogic === "OR" ? " | " : " + ");

  // Get real individual counts in parallel
  const [leftSearch, rightSearch] = await Promise.all([
    executeContentSearch(leftConditions, leftCombineLogic, options, state),
    executeContentSearch(rightConditions, rightCombineLogic, options, state),
  ]);

  updateAgentToaster(
    `🔍 Found ${leftSearch.totalFound} blocks with '${leftTermText}', ${rightSearch.totalFound} with '${rightTermText}' - analyzing hierarchy...`
  );

  // Step 2: Forward hierarchy (A > B) - A parent, B child
  console.log(`➡️ Step 2: Forward hierarchy search (A > B)`);
  const forwardResults = await searchBlocksWithHierarchicalConditions(
    leftConditions,
    leftCombineLogic,
    [
      {
        direction: "descendants" as const,
        levels: 1, // Direct children for bidirectional
        conditions: rightConditions.map((cond) => ({
          type: cond.type as any,
          text: cond.text,
          matchType: cond.matchType as any,
          weight: cond.weight || 1,
          negate: cond.negate || false,
        })),
      },
    ],
    rightCombineLogic,
    options,
    state
  );

  forwardResults.forEach((result) => {
    if (!allResults.has(result.uid)) {
      allResults.set(result.uid, result);
      parentList.add(result.uid);

      // Track child UIDs containing B
      const matchingChildUids = extractChildUids(
        result,
        rightConditions,
        rightCombineLogic
      );
      matchingChildUids.forEach((childUid) => child1List.add(childUid));
    }
  });

  // Step 3: Reverse hierarchy (B > A) with smart filtering
  console.log(`⬅️ Step 3: Reverse hierarchy search (B > A) with filtering`);
  const reverseResults = await searchBlocksWithHierarchicalConditions(
    rightConditions,
    rightCombineLogic,
    [
      {
        direction: "descendants" as const,
        levels: 1, // Direct children for bidirectional
        conditions: leftConditions.map((cond) => ({
          type: cond.type as any,
          text: cond.text,
          matchType: cond.matchType as any,
          weight: cond.weight || 1,
          negate: cond.negate || false,
        })),
      },
    ],
    leftCombineLogic,
    options,
    state
  );

  let replacements = 0;
  let skipped = 0;

  reverseResults.forEach((bBlock) => {
    // Skip if this B-block is already in child1List (already covered by forward search)
    if (child1List.has(bBlock.uid)) {
      skipped++;
      return;
    }

    // Check if any children of this B-block are in parentList
    const matchingChildUids = extractChildUids(
      bBlock,
      leftConditions,
      leftCombineLogic
    );
    let foundReplacement = false;

    matchingChildUids.forEach((aChildUid) => {
      if (parentList.has(aChildUid)) {
        // Replace parent with this B-block (parent priority: B-block is higher up)
        allResults.delete(aChildUid);
        parentList.delete(aChildUid);
        allResults.set(bBlock.uid, bBlock);

        replacements++;
        foundReplacement = true;
      }
    });

    // If no replacement was made but this is a valid B-block result, add it
    if (!foundReplacement && !allResults.has(bBlock.uid)) {
      allResults.set(bBlock.uid, bBlock);
    }
  });

  const finalResults = Array.from(allResults.values());

  // Show concise hierarchy summary
  const totalHierarchyMatches = forwardResults.length + reverseResults.length;

  if (totalHierarchyMatches > 0) {
    updateAgentToaster(
      `↔️ Bidirectional search: ${totalHierarchyMatches} hierarchy relationships found → ${finalResults.length} total results`
    );
  }

  return [finalResults]; // Return as single result set (already deduplicated)
};

/**
 * Execute deep bidirectional search: A <<=>> B (A ancestor/descendant of B, any depth)
 * Uses similar parent-priority deduplication logic as regular bidirectional search
 */
export const executeDeepBidirectionalSearch = async (
  leftConditions: SearchCondition[],
  rightConditions: SearchCondition[],
  leftCombineLogic: "AND" | "OR",
  rightCombineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  console.log(
    `🌊 Executing deep bidirectional search with parent-priority deduplication`
  );

  // Show search terms and get real counts from individual searches
  const leftTermText = leftConditions
    .map((c) => c.text)
    .join(leftCombineLogic === "OR" ? " | " : " + ");
  const rightTermText = rightConditions
    .map((c) => c.text)
    .join(rightCombineLogic === "OR" ? " | " : " + ");

  // Get real individual counts in parallel (these searches will be needed anyway)
  const [leftSearch, rightSearch] = await Promise.all([
    executeContentSearch(leftConditions, leftCombineLogic, options, state),
    executeContentSearch(rightConditions, rightCombineLogic, options, state),
  ]);

  updateAgentToaster(
    `🔍 Found ${leftSearch.totalFound} blocks with '${leftTermText}', ${rightSearch.totalFound} with '${rightTermText}' - analyzing hierarchy...`
  );

  const allResults = new Map<string, any>(); // uid -> result object
  const ancestorList = new Set<string>(); // UIDs of A-containing blocks (ancestors)
  const descendantList = new Set<string>(); // UIDs of B-containing blocks (descendants)

  // Step 1: Same-block results (highest priority)
  console.log(`📝 Step 1: Same-block search (A + B)`);
  const sameBlockConditions = [...leftConditions, ...rightConditions];
  const sameBlockSearch = await executeContentSearch(
    sameBlockConditions,
    "AND",
    options,
    state
  );
  const sameBlockResults = sameBlockSearch.results;

  sameBlockResults.forEach((result) => {
    allResults.set(result.uid, result);
  });

  // Step 2: Deep forward (A ancestor of B) - A parent, B descendant
  console.log(`🔽 Step 2: Deep forward search (A >> B)`);
  const forwardResults = await searchBlocksWithHierarchicalConditions(
    leftConditions,
    leftCombineLogic,
    [
      {
        direction: "descendants" as const,
        levels: options.maxHierarchyDepth, // Use max depth
        conditions: rightConditions.map((cond) => ({
          type: cond.type as any,
          text: cond.text,
          matchType: cond.matchType as any,
          weight: cond.weight || 1,
          negate: cond.negate || false,
        })),
      },
    ],
    rightCombineLogic,
    options,
    state
  );

  forwardResults.forEach((result) => {
    if (!allResults.has(result.uid)) {
      allResults.set(result.uid, result);
      ancestorList.add(result.uid);

      // Track descendant UIDs containing B (recursive through all levels)
      const matchingDescendantUids = extractChildUids(
        result,
        rightConditions,
        rightCombineLogic
      );
      matchingDescendantUids.forEach((descendantUid) =>
        descendantList.add(descendantUid)
      );
    }
  });

  // Step 3: Deep reverse (B ancestor of A) with smart filtering
  console.log(`🔼 Step 3: Deep reverse search (B >> A) with filtering`);
  const reverseResults = await searchBlocksWithHierarchicalConditions(
    rightConditions,
    rightCombineLogic,
    [
      {
        direction: "descendants" as const,
        levels: options.maxHierarchyDepth, // Use max depth
        conditions: leftConditions.map((cond) => ({
          type: cond.type as any,
          text: cond.text,
          matchType: cond.matchType as any,
          weight: cond.weight || 1,
          negate: cond.negate || false,
        })),
      },
    ],
    leftCombineLogic,
    options,
    state
  );

  let replacements = 0;
  let skipped = 0;

  reverseResults.forEach((bAncestor) => {
    // Skip if this B-block is already in descendantList
    if (descendantList.has(bAncestor.uid)) {
      skipped++;
      return;
    }

    // Check if any descendants of this B-ancestor are in ancestorList
    const matchingDescendantUids = extractChildUids(
      bAncestor,
      leftConditions,
      leftCombineLogic
    );
    let foundReplacement = false;

    matchingDescendantUids.forEach((aDescendantUid) => {
      if (ancestorList.has(aDescendantUid)) {
        // Replace ancestor with this B-ancestor (higher up in hierarchy)
        allResults.delete(aDescendantUid);
        ancestorList.delete(aDescendantUid);
        allResults.set(bAncestor.uid, bAncestor);

        replacements++;
        foundReplacement = true;
      }
    });

    // If no replacement but valid result, add it
    if (!foundReplacement && !allResults.has(bAncestor.uid)) {
      allResults.set(bAncestor.uid, bAncestor);
    }
  });

  const finalResults = Array.from(allResults.values());

  // Show concise hierarchy summary with batch processing info
  const totalHierarchyMatches = forwardResults.length + reverseResults.length;
  const maxDepth = options.maxHierarchyDepth;
  const parentsAnalyzed = leftSearch.totalFound; // Real count of parent blocks analyzed

  if (totalHierarchyMatches > 0) {
    updateAgentToaster(
      `🌊 Processed ${parentsAnalyzed} parent blocks (depth ${maxDepth}): ${totalHierarchyMatches} hierarchy connections → ${finalResults.length} results`
    );
  } else if (parentsAnalyzed > 0) {
    updateAgentToaster(
      `🌊 Processed ${parentsAnalyzed} parent blocks (depth ${maxDepth}): no hierarchy connections found`
    );
  }

  return [finalResults]; // Return as single result set (already deduplicated)
};

/**
 * Execute flexible hierarchy search: A => B (same block OR A parent of B)
 * Implements same-block priority to prevent duplication
 */
export const executeFlexibleHierarchySearch = async (
  leftConditions: SearchCondition[],
  rightConditions: SearchCondition[],
  leftCombineLogic: "AND" | "OR",
  rightCombineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  console.log(
    `🔀 Executing flexible hierarchy search with same-block priority`
  );

  // Show search terms (will get counts from searches that already happen)
  const leftTermText = leftConditions
    .map((c) => c.text)
    .join(leftCombineLogic === "OR" ? " | " : " + ");
  const rightTermText = rightConditions
    .map((c) => c.text)
    .join(rightCombineLogic === "OR" ? " | " : " + ");

  const allResults = new Map<string, any>(); // uid -> result object

  // Step 1: Same block search (highest priority) - A AND B in same block
  console.log(`📝 Step 1: Same-block search (A + B)`);
  const sameBlockConditions = [...leftConditions, ...rightConditions];
  const sameBlockSearch = await executeContentSearch(
    sameBlockConditions,
    "AND", // For flexible hierarchy, both terms must appear
    options,
    state
  );
  const sameBlockResults = sameBlockSearch.results;

  sameBlockResults.forEach((result) => {
    allResults.set(result.uid, result);
  });

  console.log(
    `📊 Same-block strategy found: ${sameBlockResults.length} results`
  );

  // Step 2: Hierarchy search (A > B) - only add if not already covered
  // For flexible hierarchy (=>), only search 1 level deep (direct children)
  console.log(`🏗️ Step 2: Direct hierarchy search (A > B, depth=1)`);
  const hierarchyResults = await searchBlocksWithHierarchicalConditions(
    leftConditions,
    leftCombineLogic,
    [
      {
        direction: "descendants" as const,
        levels: 1, // Only direct children for => operator
        conditions: rightConditions.map((cond) => ({
          type: cond.type as any,
          text: cond.text,
          matchType: cond.matchType as any,
          weight: cond.weight || 1,
          negate: cond.negate || false,
        })),
      },
    ],
    rightCombineLogic,
    options,
    state
  );

  let hierarchyAdded = 0;
  let hierarchySkipped = 0;

  hierarchyResults.forEach((result) => {
    if (!allResults.has(result.uid)) {
      allResults.set(result.uid, result);
      hierarchyAdded++;
      console.log(`➕ Added hierarchy result: ${result.uid}`);
    } else {
      hierarchySkipped++;
      console.log(
        `⏭️ Skipped hierarchy result ${result.uid} (already covered by same-block)`
      );
    }
  });

  console.log(
    `📊 Hierarchy strategy processed: ${hierarchyResults.length} results, ${hierarchyAdded} added, ${hierarchySkipped} skipped`
  );

  const finalResults = Array.from(allResults.values());
  console.log(
    `✅ Final flexible hierarchy results: ${finalResults.length} unique blocks (${sameBlockResults.length} same-block + ${hierarchyAdded} hierarchy)`
  );

  // Show counts from already-executed searches (no extra queries)
  const leftCount = globalThis.hierarchyCounts?.[leftTermText] || "?";
  const rightCount = globalThis.hierarchyCounts?.[rightTermText] || "?";

  if (leftCount !== "?" && rightCount !== "?") {
    updateAgentToaster(
      `🔍 Found ${leftCount} blocks with '${leftTermText}', ${rightCount} with '${rightTermText}'`
    );
  }

  updateAgentToaster(
    `🔀 Flexible search: ${hierarchyResults.length} hierarchy relationships found → ${finalResults.length} total results`
  );

  return [finalResults]; // Return as single result set (already deduplicated)
};

/**
 * Search blocks with hierarchical conditions (restored to original efficient implementation)
 */
export const searchBlocksWithHierarchicalConditions = async (
  contentConditions: SearchCondition[],
  combineConditions: "AND" | "OR",
  hierarchyConditions: any[],
  combineHierarchy: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  // Use the direct hierarchy search functions that support separate child variables
  // This ensures AND conditions like (B + D) use different child variables

  if (!hierarchyConditions || hierarchyConditions.length === 0) {
    return [];
  }

  const hierarchyCondition = hierarchyConditions[0]; // Use first hierarchy condition

  if (hierarchyCondition.direction === "descendants") {
    // For parent > children relationship, use executeDirectHierarchySearch

    // Convert parent conditions (empty in this case, using contentConditions as parents)
    const parentConditions: SearchCondition[] = [];

    // Convert child conditions from hierarchy condition
    const childConditions = hierarchyCondition.conditions.map((cond: any) => ({
      type: cond.type as any,
      text: cond.text,
      matchType: cond.matchType || "contains",
      semanticExpansion: cond.semanticExpansion,
      weight: cond.weight || 1,
      negate: cond.negate || false,
    }));

    return await executeDirectHierarchySearch(
      contentConditions, // These become the parent conditions
      combineConditions, // How to combine parent conditions
      childConditions, // These are the child conditions from hierarchy
      combineHierarchy, // How to combine child conditions (this should be "AND" for B + D)
      options,
      state
    );
  }

  // Fallback to original implementation for other cases

  const input = {
    contentConditions: contentConditions.map((cond) => ({
      type: cond.type as any,
      text: cond.text,
      matchType: cond.matchType as any,
      semanticExpansion: cond.semanticExpansion,
      weight: cond.weight || 1,
      negate: cond.negate || false,
    })),
    hierarchyConditions,
    combineConditions,
    combineHierarchy,
    expansionStrategy: options.expansionStrategy || "related_concepts",
    includeChildren: options.includeChildren === true,
    childDepth: options.childDepth || 3,
    includeParents: options.includeParents === true,
    parentDepth: options.parentDepth || 2,
    includeDaily: options.includeDaily,
    dateRange: options.dateRange,
    sortBy: options.sortBy,
    limit: options.limit,
    secureMode: options.secureMode,
    fromResultId: options.fromResultId,
    limitToBlockUids: options.limitToBlockUids,
    limitToPageUids: options.limitToPageUids,
    excludeBlockUid: options.excludeBlockUid,
  };

  // Extract UIDs for this call
  const { blockUids: finalBlockUids, pageUids: finalPageUids } =
    extractUidsFromResults(
      input.fromResultId,
      input.limitToBlockUids,
      input.limitToPageUids,
      state
    );

  // Call the original implementation logic
  const expandedContentConditions = await expandConditions(
    input.contentConditions
  );

  const contentMatches = await searchBlocksWithConditions(
    expandedContentConditions,
    input.combineConditions,
    input.includeDaily,
    finalBlockUids.length > 0 ? finalBlockUids : undefined,
    finalPageUids.length > 0 ? finalPageUids : undefined
  );

  let hierarchyFilteredBlocks = contentMatches;
  if (input.hierarchyConditions?.length > 0) {
    hierarchyFilteredBlocks = await applyHierarchyFilters(
      contentMatches,
      input.hierarchyConditions,
      input.combineHierarchy
    );
  }

  const enrichedResults = await enrichWithFullHierarchy(
    hierarchyFilteredBlocks,
    input.includeChildren,
    input.childDepth,
    input.includeParents,
    input.parentDepth,
    input.secureMode
  );

  // Apply date range filtering
  let filteredResults = enrichedResults;
  if (input.dateRange && (input.dateRange.start || input.dateRange.end)) {
    const parsedDateRange = {
      start:
        typeof input.dateRange.start === "string"
          ? new Date(input.dateRange.start)
          : input.dateRange.start,
      end:
        typeof input.dateRange.end === "string"
          ? new Date(input.dateRange.end)
          : input.dateRange.end,
    };
    const filterMode = input.dateRange.filterMode || "modified";
    filteredResults = filterByDateRange(
      enrichedResults,
      parsedDateRange,
      filterMode
    );
  }

  // Sort and limit results
  filteredResults = sortHierarchyResults(
    filteredResults,
    input.sortBy,
    input.contentConditions
  );

  if (filteredResults.length > input.limit) {
    filteredResults = filteredResults.slice(0, input.limit);
  }

  return filteredResults;
};

/**
 * Apply final processing (sorting, limiting) to combined results
 */
export const applyFinalProcessing = (results: any[], options: any): any[] => {
  if (!results || results.length === 0) {
    return [];
  }

  // Sort results
  let sortedResults = sortHierarchyResults(results, options.sortBy, []);

  // Apply final limit
  if (sortedResults.length > options.limit) {
    sortedResults = sortedResults.slice(0, options.limit);
    console.log(`✂️ Limited results to ${options.limit}`);
  }

  return sortedResults;
};

/**
 * Check if content matches a condition
 */
export const matchesCondition = (content: string, condition: any): boolean => {
  let matches = false;

  switch (condition.type) {
    case "page_ref":
      const pageRefPattern = new RegExp(
        `\\[\\[${condition.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]`,
        "i"
      );
      matches = pageRefPattern.test(content);
      break;

    case "block_ref":
      const blockRefPattern = new RegExp(
        `\\(\\(${condition.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)\\)`,
        "i"
      );
      matches = blockRefPattern.test(content);
      break;

    case "regex":
      try {
        // Use custom flags if provided, otherwise default to case-insensitive
        const flags =
          condition.regexFlags !== undefined ? condition.regexFlags : "i";
        const regex = new RegExp(condition.text, flags);
        matches = regex.test(content);
      } catch {
        matches = false;
      }
      break;

    case "text":
    default:
      if (condition.matchType === "exact") {
        matches = content === condition.text;
      } else if (condition.matchType === "regex") {
        try {
          // Use custom flags if provided, otherwise default to case-insensitive
          const flags =
            condition.regexFlags !== undefined ? condition.regexFlags : "i";
          const regex = new RegExp(condition.text, flags);
          matches = regex.test(content);
        } catch {
          matches = false;
        }
      } else {
        matches = content.toLowerCase().includes(condition.text.toLowerCase());
      }
      break;
  }

  return condition.negate ? !matches : matches;
};

/**
 * Execute direct hierarchy search with single content-filtered Datomic query
 * This replaces the inefficient JavaScript post-processing approach
 */
export const executeDirectHierarchySearch = async (
  parentConditions: SearchCondition[],
  parentCombineLogic: "AND" | "OR",
  childConditions: SearchCondition[],
  childCombineLogic: "AND" | "OR",
  options: any,
  state?: any
): Promise<any[]> => {
  // Apply semantic expansion if requested and at appropriate level
  const shouldExpand =
    parentConditions.some((c) => c.semanticExpansion) ||
    childConditions.some((c) => c.semanticExpansion);
  const expandedParentConditions = shouldExpand
    ? await expandConditions(parentConditions, state)
    : parentConditions;
  const expandedChildConditions = shouldExpand
    ? await expandConditions(childConditions, state)
    : childConditions;

  // Build Datomic query - structure depends on child combination logic
  let query;

  if (childCombineLogic === "AND" && expandedChildConditions.length > 1) {
    // For hierarchical AND: use separate child variables for each condition
    console.log(
      `🔧 [executeDirectHierarchySearch] Using optimized separate child variables for ${expandedChildConditions.length} AND conditions`
    );

    query = `[:find ?parent-uid ?parent-content ?parent-page-title ?parent-page-uid 
                     ?child1-uid ?child1-content ?child1-page-title ?child1-page-uid
              :where`;

    // Add separate child variables for each condition (optimized data fetching)
    for (let i = 0; i < expandedChildConditions.length; i++) {
      const childVar = `?child${i + 1}`;
      const childContentVar = `${childVar}-content`;

      if (i === 0) {
        // First child: fetch full data for results
        query += `
              
              ;; Child ${i + 1} (result child) with full data
              [?parent :block/children ${childVar}]
              [${childVar} :block/uid ${childVar}-uid]
              [${childVar} :block/string ${childContentVar}]
              [${childVar} :block/page ${childVar}-page]
              [${childVar}-page :node/title ${childVar}-page-title]
              [${childVar}-page :block/uid ${childVar}-page-uid]`;
      } else {
        // Other children: minimal data for conditions only
        query += `
              
              ;; Child ${i + 1} (condition only - minimal data)
              [?parent :block/children ${childVar}]
              [${childVar} :block/string ${childContentVar}]`;
      }
    }
  } else {
    // For OR logic or single condition: use original single-child approach
    query = `[:find ?parent-uid ?parent-content ?parent-page-title ?parent-page-uid 
                     ?child-uid ?child-content ?child-page-title ?child-page-uid
              :where
              ;; Parent block structure
              [?parent :block/uid ?parent-uid]
              [?parent :block/string ?parent-content]
              [?parent :block/page ?parent-page]
              [?parent-page :node/title ?parent-page-title]
              [?parent-page :block/uid ?parent-page-uid]
              
              ;; Child block structure  
              [?child :block/uid ?child-uid]
              [?child :block/string ?child-content]
              [?child :block/page ?child-page]
              [?child-page :node/title ?child-page-title]
              [?child-page :block/uid ?child-page-uid]
              
              ;; Hierarchy relationship (parent -> child)
              [?parent :block/children ?child]`;
  }

  // Add parent block structure (bind ?parent-content variable)
  query += `
              ;; Parent block structure
              [?parent :block/uid ?parent-uid]
              [?parent :block/string ?parent-content]
              [?parent :block/page ?parent-page]
              [?parent-page :node/title ?parent-page-title]
              [?parent-page :block/uid ?parent-page-uid]`;

  // Add most selective conditions first (parent conditions)
  const parentClauses = buildHierarchyConditionClauses(
    expandedParentConditions,
    parentCombineLogic,
    "?parent",
    "?parent-content",
    0
  );
  query += parentClauses;

  // Add child conditions
  if (childCombineLogic === "AND" && expandedChildConditions.length > 1) {
    // For hierarchical AND: apply each condition to its separate child variable
    for (let i = 0; i < expandedChildConditions.length; i++) {
      const childVar = `?child${i + 1}`;
      const childContentVar = `${childVar}-content`;
      const condition = expandedChildConditions[i];

      // Build condition clauses for this specific child
      const childClauses = buildHierarchyConditionClauses(
        [condition],
        "AND",
        childVar,
        childContentVar,
        expandedParentConditions.length + i * 10
      );
      query += childClauses;
    }
  } else {
    // For OR logic or single condition: use original single-child approach
    const childClauses = buildHierarchyConditionClauses(
      expandedChildConditions,
      childCombineLogic,
      "?child",
      "?child-content",
      expandedParentConditions.length
    );
    query += childClauses;
  }



  // Add exclusion logic for user query block
  if (options.excludeBlockUid) {
    if (childCombineLogic === "AND" && expandedChildConditions.length > 1) {
      // For optimized AND query: exclude from parent and first child
      query += `\n                ;; Exclude user query block from both parent and child results
                [(not= ?parent-uid "${options.excludeBlockUid}")]
                [(not= ?child1-uid "${options.excludeBlockUid}")]`;
    } else {
      // For regular query: exclude from parent and representative child
      query += `\n                ;; Exclude user query block from both parent and child results
                [(not= ?parent-uid "${options.excludeBlockUid}")]
                [(not= ?child-uid "${options.excludeBlockUid}")]`;
    }
  }

  query += `]`;

  const hierarchyResults = await executeDatomicQuery(query);

  // Transform results to expected format (return parent blocks with child info)
  const parentBlocks = hierarchyResults.map(
    ([
      parentUid,
      parentContent,
      parentPageTitle,
      parentPageUid,
      childUid,
      childContent,
      childPageTitle,
      childPageUid,
    ]) => ({
      uid: parentUid,
      content: parentContent,
      pageTitle: parentPageTitle,
      pageUid: parentPageUid,
      created: new Date(), // We don't get timestamps from this query, use current time
      modified: new Date(),
      isDaily: false, // TODO: Could be enhanced to check DNP pattern
      children: [],
      parents: [],
      isPage: false,
      // Add hierarchy context
      childUid,
      childContent,
      childPageTitle,
      childPageUid,
      hierarchyRelationship: "direct_parent",
    })
  );

  // Apply hierarchy enrichment if requested
  // Note: Direct hierarchy search already provides the direct parent-child relationship,
  // so additional enrichment may not be necessary for most use cases
  if (
    (options.includeChildren === true && options.childDepth > 1) ||
    (options.includeParents === true && options.parentDepth > 1)
  ) {
    try {
      // Convert to format expected by enrichWithFullHierarchy (array format)
      const arrayFormat = parentBlocks.map((block) => [
        block.uid,
        block.content,
        block.pageTitle,
        block.pageUid,
      ]);
      const enrichedResults = await enrichWithFullHierarchy(
        arrayFormat,
        options.includeChildren === true,
        options.childDepth || 3,
        options.includeParents === true,
        options.parentDepth || 2
      );
      return enrichedResults;
    } catch (error) {
      return parentBlocks;
    }
  }

  return parentBlocks;
};

/**
 * Build condition clauses for hierarchy search with custom block variables
 * This fixes the issue where DatomicQueryBuilder hardcodes ?b for all block references
 */
const buildHierarchyConditionClauses = (
  conditions: SearchCondition[],
  combineLogic: "AND" | "OR",
  blockVariable: string,
  contentVariable: string,
  patternOffset: number
): string => {
  if (conditions.length === 0) return "";

  let clauses = "";

  // For AND logic or single condition
  if (combineLogic === "AND" || conditions.length === 1) {
    // Check if we have mixed logic that can be converted to regex
    const hasNegatedConditions = conditions.some((c) => c.negate === true);
    const hasPositiveConditions = conditions.some((c) => c.negate !== true);

    // If we have both positive and negative conditions, we might be able to use OR-to-regex conversion
    // But for now, process normally - OR-to-regex will be handled at a higher level
    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];
      const patternIndex = i + patternOffset;
      clauses += buildSingleHierarchyConditionClause(
        condition,
        blockVariable,
        contentVariable,
        patternIndex
      );
    }
  } else {
    // For OR logic, separate preparation clauses from OR clauses
    let preparationClauses: string[] = [];
    let orClauses: string[] = [];

    // Process each condition and separate preparation from OR clauses
    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];
      const patternIndex = i + patternOffset;

      switch (condition.type) {
        case "page_ref":
          // Preparation clauses outside OR
          preparationClauses.push(
            `\n                [(ground "${condition.text}") ?page-title${patternIndex}]`
          );
          preparationClauses.push(
            `\n                [?ref-page${patternIndex} :node/title ?page-title${patternIndex}]`
          );
          // Only the actual matching clause inside OR
          orClauses.push(
            `\n                  [${blockVariable} :block/refs ?ref-page${patternIndex}]`
          );
          break;

        case "text":
          let pattern: string;
          if (condition.matchType === "regex") {
            const sanitizedRegex = sanitizeRegexForDatomic(condition.text);
            pattern = sanitizedRegex.isCaseInsensitive
              ? sanitizedRegex.pattern
              : `(?i)${sanitizedRegex.pattern}`;
          } else {
            pattern = `(?i).*${condition.text.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&"
            )}.*`;
          }
          // Preparation clauses outside OR
          preparationClauses.push(
            `\n                [(re-pattern "${pattern}") ?pattern${patternIndex}]`
          );
          // Only the actual matching clause inside OR
          orClauses.push(
            `\n                  [(re-find ?pattern${patternIndex} ${contentVariable})]`
          );
          break;

        case "block_ref":
          // Block refs don't need preparation, can go directly in OR
          orClauses.push(`\n                  [?ref-block${patternIndex} :block/uid "${condition.text}"]
                  [${blockVariable} :block/refs ?ref-block${patternIndex}]`);
          break;

        default:
          console.warn(
            `Unsupported condition type for hierarchy: ${condition.type}`
          );
      }
    }

    // Add preparation clauses first (outside OR)
    clauses += preparationClauses.join("");

    // Then add OR clause
    if (orClauses.length > 0) {
      clauses += `\n                (or${orClauses.join(
        ""
      )}\n                )`;
    }
  }

  return clauses;
};

/**
 * Build a single condition clause for hierarchy search
 */
const buildSingleHierarchyConditionClause = (
  condition: SearchCondition,
  blockVariable: string,
  contentVariable: string,
  patternIndex: number
): string => {
  let clause = "";

  switch (condition.type) {
    case "page_ref":
      const pageRefClause = `\n                [?ref-page${patternIndex} :node/title "${condition.text}"]
                [${blockVariable} :block/refs ?ref-page${patternIndex}]`;
      // Apply negation if needed - only negate the matching part
      if (condition.negate) {
        clause = `\n                [?ref-page${patternIndex} :node/title "${condition.text}"]
                (not [${blockVariable} :block/refs ?ref-page${patternIndex}])`;
      } else {
        clause = pageRefClause;
      }
      break;

    case "text":
      let pattern: string;
      if (condition.matchType === "regex") {
        const sanitizedRegex = sanitizeRegexForDatomic(condition.text);
        pattern = sanitizedRegex.isCaseInsensitive
          ? sanitizedRegex.pattern
          : `(?i)${sanitizedRegex.pattern}`;
      } else {
        pattern = `(?i).*${condition.text.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        )}.*`;
      }
      
      // For negated text conditions, bind pattern outside and only negate the matching
      if (condition.negate) {
        clause = `\n                [(re-pattern "${pattern}") ?pattern${patternIndex}]
                (not [(re-find ?pattern${patternIndex} ${contentVariable})])`;
      } else {
        clause = `\n                [(re-pattern "${pattern}") ?pattern${patternIndex}]
                [(re-find ?pattern${patternIndex} ${contentVariable})]`;
      }
      break;

    case "block_ref":
      const blockRefClause = `\n                [?ref-block${patternIndex} :block/uid "${condition.text}"]
                [${blockVariable} :block/refs ?ref-block${patternIndex}]`;
      // Apply negation if needed - only negate the matching part  
      if (condition.negate) {
        clause = `\n                [?ref-block${patternIndex} :block/uid "${condition.text}"]
                (not [${blockVariable} :block/refs ?ref-block${patternIndex}])`;
      } else {
        clause = blockRefClause;
      }
      break;

    default:
      console.warn(
        `Unsupported condition type for hierarchy: ${condition.type}`
      );
      return "";
  }

  return clause;
};

/**
 * Build page reference OR clause
 */
const buildPageRefOrClause = (
  condition: SearchCondition,
  blockVariable: string,
  patternIndex: number
): string => {
  return `\n                  [(ground "${condition.text}") ?page-title${patternIndex}]
                  [?ref-page${patternIndex} :node/title ?page-title${patternIndex}]
                  [${blockVariable} :block/refs ?ref-page${patternIndex}]`;
};

/**
 * Build text OR clause
 */
const buildTextOrClause = (
  condition: SearchCondition,
  contentVariable: string,
  patternIndex: number
): string => {
  const pattern =
    condition.matchType === "regex"
      ? condition.text
      : `(?i).*${condition.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*`;
  return `\n                  [(re-pattern "${pattern}") ?pattern${patternIndex}]
                  [(re-find ?pattern${patternIndex} ${contentVariable})]`;
};
