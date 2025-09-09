import {
  isDailyNote,
  generateSemanticExpansions,
  getFlattenedDescendants,
  getFlattenedAncestors,
  SearchCondition,
} from "../../helpers/searchUtils";
import { findPagesByTitleTool } from "../findPagesByTitleTool";

import { updateAgentToaster } from "../../../shared/agentsUtils";

import { matchesCondition } from "./executors";
import { calculateHierarchyRelevanceScore } from "./findBlocksWithHierarchyTool";

/**
 * Expand content conditions with semantic terms
 * Only expands when explicitly requested
 */
export const expandConditions = async (
  conditions: any[],
  state?: any
): Promise<any[]> => {
  const expandedConditions = [];
  const expansionLevel = state?.expansionLevel || 0;

  // Check if any conditions request semantic expansion
  const hasSemanticRequest = conditions.some(
    (c) => c.semanticExpansion === true
  );

  // Only apply semantic expansion if:
  // 1. Conditions explicitly request it, OR
  // 2. We're at expansion level 2+ (automatic expansion)
  if (expansionLevel < 2 && !hasSemanticRequest) {
    return conditions; // Return original conditions, not empty array
  }

  // Group conditions that need expansion to avoid duplicate toaster messages (unless disabled for combination testing)
  const conditionsToExpand = conditions.filter(
    (c) =>
      !state?.disableSemanticExpansion &&
      ((c.semanticExpansion && c.type === "text") ||
        (c.type === "page_ref" && c.semanticExpansion))
  );

  if (conditionsToExpand.length > 0) {
    updateAgentToaster(`🔍 Expanding search with related terms...`);
  }

  for (const condition of conditions) {
    let conditionWasExpanded = false;

    // Handle text conditions with semantic expansion (unless disabled for combination testing)
    if (
      condition.semanticExpansion &&
      condition.type === "text" &&
      !state?.disableSemanticExpansion
    ) {
      try {
        const expansionTerms = await generateSemanticExpansions(
          condition.text,
          condition.semanticExpansion, // Use strategy directly from condition
          state?.userQuery, // Pass original query for better context
          state?.modelInfo, // Pass model from execution context
          state?.language, // Pass user language for language-aware expansion
          undefined // No custom strategy here - would come from state.expansionGuidance if needed
        );

        if (expansionTerms.length > 0) {
          // Add original term + expansions as separate conditions
          expandedConditions.push(condition); // Keep original
          for (const term of expansionTerms) {
            expandedConditions.push({
              ...condition,
              text: term,
              semanticExpansion: undefined,
              weight: condition.weight * 0.8,
            });
          }
          conditionWasExpanded = true;
        }
      } catch (error) {
        console.warn(`Failed to expand condition "${condition.text}":`, error);
      }
    }

    // Handle page_ref conditions with smart expansion using findPagesByTitleTool (unless disabled for combination testing)
    if (
      condition.type === "page_ref" &&
      condition.semanticExpansion &&
      !state?.disableSemanticExpansion
    ) {
      try {
        // Use the smart expansion feature of findPagesByTitleTool
        const result = await findPagesByTitleTool.invoke({
          conditions: [
            {
              text: condition.text,
              matchType: "exact",
              negate: false,
            },
          ],
          combineConditions: "OR",
          includeDaily: false,
          smartExpansion: true,
          expansionInstruction: state?.userQuery
            ? `Find pages related to "${condition.text}" in context: ${state.userQuery}`
            : undefined,
        });

        const parsedResult =
          typeof result === "string" ? JSON.parse(result) : result;
        const expandedPages = parsedResult.success
          ? parsedResult.data || []
          : [];

        if (expandedPages.length > 0) {
          const pageNames = expandedPages
            .map((page: any) => page.title)
            .filter((name: any) => typeof name === "string");

          if (pageNames.length === 1) {
            // Single page - use simple page_ref condition
            expandedConditions.push({
              type: "page_ref",
              text: pageNames[0],
              matchType: "exact",
              semanticExpansion: undefined,
              weight: condition.weight,
              negate: condition.negate || false,
            });
          } else if (pageNames.length > 1) {
            // Multiple pages - use page_ref_or condition for optimal Datomic query
            expandedConditions.push({
              type: "page_ref_or",
              text: pageNames.join("|"),
              matchType: "exact",
              semanticExpansion: undefined,
              weight: condition.weight,
              negate: condition.negate || false,
              pageNames: pageNames,
            } as any);
          }

          conditionWasExpanded = true;
        }
      } catch (error) {
        console.warn(
          `Failed to expand page_ref condition "${condition.text}":`,
          error
        );
      }
    }

    // If condition wasn't expanded, keep the original
    if (!conditionWasExpanded) {
      expandedConditions.push(condition);
    }
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
