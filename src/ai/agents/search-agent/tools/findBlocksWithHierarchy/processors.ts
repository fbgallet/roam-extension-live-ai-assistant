import {
  isDailyNote,
  getFlattenedDescendants,
  getFlattenedAncestors,
  SearchCondition,
} from "../../helpers/searchUtils";

import { updateAgentToaster } from "../../../shared/agentsUtils";

import { matchesCondition } from "./executors";
import { calculateHierarchyRelevanceScore, expandSingleCondition } from "./findBlocksWithHierarchyTool";

/**
 * Expand content conditions with semantic terms
 * Uses expandSingleCondition for consistency and to avoid code duplication
 */
export const expandConditions = async (
  conditions: any[],
  state?: any
): Promise<any[]> => {
  const expansionLevel = state?.expansionLevel || 0;

  // SAFETY: Prevent infinite recursion by limiting expansion depth
  if (expansionLevel > 4) {
    console.warn(
      "⚠️ Maximum expansion level reached, preventing infinite loop"
    );
    return conditions;
  }

  // Initialize expansion cache if not exists
  if (!state?.expansionCache) {
    state = { ...state, expansionCache: new Map() };
  }

  // Check if any conditions request semantic expansion
  const hasSemanticRequest = conditions.some(
    (c) => c.semanticExpansion // Check for any truthy value, not just === true
  );

  // Check for global semantic expansion (automatic expansion sets this)
  const hasGlobalExpansion = state?.isExpansionGlobal && state?.semanticExpansion;

  // Only apply semantic expansion if:
  // 1. Conditions explicitly request it, OR
  // 2. We're at expansion level 2+ (user-triggered expansion), OR  
  // 3. Global expansion is enabled (automatic expansion at level 0)
  if (expansionLevel < 2 && !hasSemanticRequest && !hasGlobalExpansion) {
    return conditions; // Return original conditions, not empty array
  }

  // Group conditions that need expansion to avoid duplicate toaster messages (unless disabled for combination testing)
  const conditionsToExpand = conditions.filter(
    (c) =>
      !state?.disableSemanticExpansion &&
      ((c.semanticExpansion && (c.type === "text" || c.type === "page_ref")) ||
        (hasGlobalExpansion && (c.type === "text" || c.type === "page_ref")))
  );

  if (conditionsToExpand.length > 0 && !state?.expansionToasterShown) {
    updateAgentToaster(`🔍 Hierarchy Search: Expanding search with related terms...`);
    // Mark that we've shown the toaster to prevent repeated messages
    if (state) {
      state.expansionToasterShown = true;
    }
  }

  const expandedConditions = [];
  
  for (const condition of conditions) {
    // Convert legacy condition format to StructuredSearchCondition format
    const structuredCondition = {
      type: condition.type,
      text: condition.text,
      matchType: condition.matchType || "contains",
      semanticExpansion: condition.semanticExpansion,
      weight: condition.weight || 1.0,
      negate: condition.negate || false,
    };

    // Use expandSingleCondition for consistent expansion logic
    // This now returns a single condition (original or regex/page_ref_or)
    const expandedConditionsForThis = await expandSingleCondition(structuredCondition, state);
    
    // Add all expanded conditions to results
    expandedConditions.push(...expandedConditionsForThis);
  }

  return expandedConditions;
};

/**
 * Apply hierarchy conditions to filter blocks
 */
export const applyHierarchyFilters = async (
  blocks: any[],
  hierarchyConditions: any[],
  combineLogic: "AND" | "OR"
): Promise<any[]> => {
  // OPTIMIZATION: Batch hierarchy queries by direction and depth
  const descendantsQueries: {
    [key: string]: { uids: string[]; levels: number };
  } = {};
  const ancestorsQueries: {
    [key: string]: { uids: string[]; levels: number };
  } = {};

  // Group blocks by hierarchy condition requirements
  const blockUids = blocks.map((block) => block[0]); // Extract UIDs

  for (const hierarchyCondition of hierarchyConditions) {
    const { direction, levels } = hierarchyCondition;
    const maxLevels = levels === "all" ? 10 : levels;
    const queryKey = `${direction}_${maxLevels}`;

    if (direction === "descendants") {
      if (!descendantsQueries[queryKey]) {
        descendantsQueries[queryKey] = { uids: blockUids, levels: maxLevels };
      }
    } else {
      if (!ancestorsQueries[queryKey]) {
        ancestorsQueries[queryKey] = { uids: blockUids, levels: maxLevels };
      }
    }
  }

  // Execute batched queries
  const descendantsResults: { [queryKey: string]: { [uid: string]: any[] } } =
    {};
  const ancestorsResults: { [queryKey: string]: { [uid: string]: any[] } } = {};

  // Batch descendants queries using FLATTENED approach
  for (const [queryKey, { uids, levels }] of Object.entries(
    descendantsQueries
  )) {
    descendantsResults[queryKey] = await getFlattenedDescendants(
      uids,
      levels,
      false
    );
  }

  // Batch ancestors queries using FLATTENED approach
  for (const [queryKey, { uids, levels }] of Object.entries(ancestorsQueries)) {
    ancestorsResults[queryKey] = await getFlattenedAncestors(
      uids,
      levels,
      false
    );
  }

  // Now process blocks with pre-fetched hierarchy data
  const filteredBlocks = [];

  for (const block of blocks) {
    const [uid] = block;

    let hierarchyMatches = [];

    for (const hierarchyCondition of hierarchyConditions) {
      const { direction, levels, conditions } = hierarchyCondition;
      const maxLevels = levels === "all" ? 10 : levels;
      const queryKey = `${direction}_${maxLevels}`;

      // Get pre-fetched hierarchy blocks
      let hierarchyBlocks = [];
      if (direction === "descendants") {
        hierarchyBlocks = descendantsResults[queryKey]?.[uid] || [];
      } else {
        hierarchyBlocks = ancestorsResults[queryKey]?.[uid] || [];
      }

      // Check if hierarchy blocks match the conditions (same logic as before)

      const hierarchyMatch = hierarchyBlocks.some((hierarchyBlock) => {
        const blockContent = hierarchyBlock.content || "";
        const conditionResults = conditions.map(
          (condition: SearchCondition) => {
            return matchesCondition(blockContent, condition);
          }
        );
        return conditionResults.every((r: boolean) => r);
      });

      hierarchyMatches.push(hierarchyMatch);
    }

    // Apply combine logic for hierarchy conditions
    const passesHierarchyFilter =
      combineLogic === "AND"
        ? hierarchyMatches.every((match) => match)
        : hierarchyMatches.some((match) => match);

    if (passesHierarchyFilter) {
      filteredBlocks.push(block);
    }
  }

  return filteredBlocks;
};

/**
 * Enrich results with full hierarchical context
 */
export const enrichWithFullHierarchy = async (
  results: any[],
  includeChildren: boolean,
  childDepth: number,
  includeParents: boolean,
  parentDepth: number,
  secureMode: boolean = false
): Promise<any[]> => {
  const blockUids = results.map((result) => result[0]); // Extract UIDs

  // Batch fetch all children and parents using flattened approach
  let allChildren: { [uid: string]: any[] } = {};
  let allParents: { [uid: string]: any[] } = {};

  if (includeChildren && blockUids.length > 0) {
    allChildren = await getFlattenedDescendants(
      blockUids,
      childDepth,
      secureMode
    );
  }

  if (includeParents && blockUids.length > 0) {
    allParents = await getFlattenedAncestors(
      blockUids,
      parentDepth,
      secureMode
    );
  }

  // Build enriched results using pre-fetched data
  const enrichedResults = [];

  for (const [uid, content, time, pageTitle, pageUid] of results) {
    const children = allChildren[uid] || [];
    const parents = allParents[uid] || [];

    const blockResult = {
      uid,
      content: secureMode ? undefined : content,
      created: new Date(time),
      modified: new Date(time),
      pageTitle,
      pageUid,
      isDaily: isDailyNote(pageUid),
      children,
      parents,
      hierarchyDepth:
        children.length > 0
          ? Math.max(...children.map((c) => c.level || 1))
          : 0,
      // Explicit type flag (isPage: false means it's a block)
      isPage: false,
    };

    enrichedResults.push(blockResult);
  }

  return enrichedResults;
};

/**
 * Sort hierarchy results
 */
export const sortHierarchyResults = (
  results: any[],
  sortBy: string,
  originalConditions: any[]
): any[] => {
  return results.sort((a, b) => {
    switch (sortBy) {
      case "recent":
        return b.modified.getTime() - a.modified.getTime();

      case "page_title":
        return a.pageTitle.localeCompare(b.pageTitle);

      case "hierarchy_depth":
        return b.hierarchyDepth - a.hierarchyDepth;

      case "relevance":
      default:
        const scoreA = calculateHierarchyRelevanceScore(a, originalConditions);
        const scoreB = calculateHierarchyRelevanceScore(b, originalConditions);

        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }

        return b.modified.getTime() - a.modified.getTime();
    }
  });
};
