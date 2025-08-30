/**
 * Context Expansion Module
 *
 * This module handles the adaptive context expansion functionality for the search agent.
 * It provides intelligent hierarchy expansion with adaptive depth and content limits,
 * reference resolution, and budget-aware truncation strategies.
 */

import { executeDatomicQuery } from "./searchUtils";
import { resolveReferences } from "../../../../utils/roamAPI";

/**
 * Adaptive expansion budget limits by mode
 */
const EXPANSION_BUDGETS = {
  balanced: 80000, // ~20k tokens
  full: 200000, // ~50k tokens
};

/**
 * Performs adaptive context expansion based on result count and available budget
 */
export async function performAdaptiveExpansion(
  results: any[],
  charLimit: number,
  currentContentLength: number,
  accessMode?: string
): Promise<any[]> {
  if (!results || results.length === 0) return [];

  const resultCount = results.length;
  const availableBudget = Math.max(0, charLimit - currentContentLength);

  // Use smaller budget between available and access mode limit
  const modeBudget =
    accessMode === "Full Access"
      ? EXPANSION_BUDGETS.full
      : EXPANSION_BUDGETS.balanced;
  const expansionBudget = Math.min(availableBudget, modeBudget);

  console.log(
    `🌳 [AdaptiveExpansion] Expanding ${resultCount} blocks + 0 pages`
  );

  // Extract block UIDs for hierarchy queries
  const blockUids = results
    .filter((r) => r.uid && r.uid.length === 9) // 9-char UIDs are blocks
    .map((r) => r.uid);

  if (blockUids.length === 0) return results;

  // Fetch hierarchy data (parents and children)
  const hierarchyData = await fetchHierarchyData(blockUids);

  // Create expanded blocks with content + context
  const expandedBlocks = await createExpandedBlocks(
    results,
    hierarchyData,
    expansionBudget,
    accessMode
  );

  // Apply intelligent truncation based on budget
  const finalExpandedBlocks = applyIntelligentTruncation(
    expandedBlocks,
    expansionBudget
  );

  console.log(
    `🌳 [AdaptiveExpansion] Created ${finalExpandedBlocks.length} expanded blocks`
  );
  return finalExpandedBlocks;
}

/**
 * Fetches hierarchy data (parents and children) for given block UIDs
 */
async function fetchHierarchyData(blockUids: string[]): Promise<any[]> {
  try {
    const allHierarchyData: any[] = [];

    // Get basic block info
    const blockInfoQuery = `
      [:find ?uid ?content
       :where
       [?b :block/uid ?uid]
       [?b :block/string ?content]
       [(contains? #{${blockUids.map((uid) => `"${uid}"`).join(" ")}} ?uid)]]
    `;

    const blockResults = await executeDatomicQuery(blockInfoQuery);
    if (blockResults && Array.isArray(blockResults)) {
      allHierarchyData.push(...blockResults);
    }

    // Get parent blocks separately
    const parentsQuery = `
      [:find ?child-uid ?parent-uid ?parent-content
       :where
       [?child :block/uid ?child-uid]
       [?child :block/parents ?parent]
       [?parent :block/uid ?parent-uid]
       [?parent :block/string ?parent-content]
       [(contains? #{${blockUids
         .map((uid) => `"${uid}"`)
         .join(" ")}} ?child-uid)]]
    `;

    const parentResults = await executeDatomicQuery(parentsQuery);
    if (parentResults && Array.isArray(parentResults)) {
      // Merge parent data with existing block data
      for (const parentResult of parentResults) {
        const [childUid, parentUid, parentContent] = parentResult;
        // Find existing block data and add parent info
        const existingIndex = allHierarchyData.findIndex(
          (h) => h[0] === childUid
        );
        if (existingIndex >= 0) {
          allHierarchyData[existingIndex][2] = parentUid;
          allHierarchyData[existingIndex][3] = parentContent;
        } else {
          // Create new entry for this child-parent relationship
          allHierarchyData.push([childUid, "", parentUid, parentContent]);
        }
      }
    }

    // Get children blocks
    const childrenQuery = `
      [:find ?child-uid ?child-content ?parent-uid
       :where
       [?parent :block/uid ?parent-uid]
       [?parent :block/children ?child]
       [?child :block/uid ?child-uid]
       [?child :block/string ?child-content]
       [(contains? #{${blockUids
         .map((uid) => `"${uid}"`)
         .join(" ")}} ?parent-uid)]]
    `;

    const childrenResults = await executeDatomicQuery(childrenQuery);
    if (childrenResults && Array.isArray(childrenResults)) {
      allHierarchyData.push(...childrenResults);
    }

    return allHierarchyData;
  } catch (error) {
    console.error(`🌳 [FetchHierarchyData] Error:`, error);
    return [];
  }
}

/**
 * Creates expanded blocks with original content + hierarchical context
 */
async function createExpandedBlocks(
  originalResults: any[],
  hierarchyData: any[],
  budget: number,
  accessMode?: string
): Promise<any[]> {
  const expandedBlocks: any[] = [];

  // Create budget per result
  const budgetPerResult = Math.floor(budget / originalResults.length);

  for (const result of originalResults) {
    try {
      // Find hierarchy data for this result
      const resultHierarchy = hierarchyData.filter(
        (h) => h[0] === result.uid || h[2] === result.uid || h[1] === result.uid
      );

      // Create expanded block object
      let originalContent = result.content || result.pageTitle || "";

      // RESOLVE REFERENCES in original block content
      try {
        originalContent = resolveReferences(originalContent, [], true);
      } catch (error) {
        console.warn(
          `Failed to resolve references in original block ${result.uid}:`,
          error
        );
      }

      const expandedBlock = {
        uid: result.uid,
        original: originalContent,
        pageTitle: result.pageTitle || "",
        parent: "",
        childrenOutline: "",
      };

      // Add parent context
      const parentData = resultHierarchy.find((h) => h[0] === result.uid); // child-uid matches result.uid
      if (parentData && parentData[3]) {
        // h[3] is parent-content (h[2] is parent-uid)
        let parentContent = parentData[3];

        // RESOLVE REFERENCES in parent content too
        try {
          parentContent = resolveReferences(parentContent, [], true);
        } catch (error) {
          console.warn(
            `Failed to resolve references in parent content:`,
            error
          );
        }

        expandedBlock.parent = parentContent;
      }

      // Add recursive children outline with adaptive depth strategy
      const availableBudgetForChildren = Math.max(
        budgetPerResult - (expandedBlock.original?.length || 0) - 200,
        500
      );

      // ADAPTIVE DEPTH STRATEGY based on result count
      const resultCount = originalResults.length;
      let maxDepth: number;

      // First apply standard result count limits
      if (resultCount > 150) {
        maxDepth = 0; // No expansion for very large result sets
      } else if (resultCount <= 20) {
        maxDepth = 4; // Deep exploration for small result sets
      } else if (resultCount <= 50) {
        maxDepth = 3; // Moderate depth for medium result sets
      } else if (resultCount <= 100) {
        maxDepth = 2; // Standard depth for larger result sets
      } else {
        // 100 < resultCount <= 150
        maxDepth = 1; // Shallow for large result sets
      }

      // Then apply additional restrictions for Balanced mode
      if (accessMode === "Balanced") {
        if (resultCount > 50) {
          maxDepth = Math.min(maxDepth, 1); // Cap at 1 level for >50 results in Balanced
        } else {
          maxDepth = Math.min(maxDepth, 2); // Cap at 2 levels for ≤50 results in Balanced
        }
      }

      expandedBlock.childrenOutline =
        maxDepth > 0
          ? await buildRecursiveChildrenOutline(
              result.uid,
              availableBudgetForChildren,
              maxDepth,
              resultCount // Pass result count for degressive content limits
            )
          : ""; // No children expansion for >150 results

      // Stringify the expanded block
      const stringifiedBlock = stringifyExpandedBlock(
        expandedBlock,
        budgetPerResult
      );

      expandedBlocks.push({
        ...result,
        content: stringifiedBlock,
        expandedBlock: expandedBlock,
        metadata: {
          ...result.metadata,
          contextExpansion: true,
          originalLength: (result.content || "").length,
          expandedLength: stringifiedBlock.length,
        },
      });
    } catch (error) {
      console.error(
        `🌳 [CreateExpandedBlocks] Error processing ${result.uid}:`,
        error
      );
      // Fallback to original result
      expandedBlocks.push(result);
    }
  }

  return expandedBlocks;
}

/**
 * Builds recursive children outline with proper indentation (inspired by convertTreeToLinearArray)
 */
async function buildRecursiveChildrenOutline(
  parentUid: string,
  budget: number,
  maxDepth: number = 2,
  resultCount: number = 50, // Total result count for degressive limits
  currentLevel: number = 1,
  indent: string = "  "
): Promise<string> {
  if (currentLevel > maxDepth || budget <= 0) return "";

  // Query for direct children of the parent
  const childrenQuery = `
    [:find ?child-uid ?child-content ?order
     :where
     [?parent :block/uid "${parentUid}"]
     [?parent :block/children ?child]
     [?child :block/uid ?child-uid]
     [?child :block/string ?child-content]
     [?child :block/order ?order]]
  `;

  try {
    const childrenResults = await executeDatomicQuery(childrenQuery);
    if (!childrenResults || childrenResults.length === 0) {
      return "";
    }

    // Sort by order
    const sortedChildren = childrenResults.sort((a, b) => a[2] - b[2]);

    // ADAPTIVE 100-500 CHARACTER LIMITS with degressive limits for deeper levels
    const budgetPerChild = Math.floor(
      budget / Math.min(sortedChildren.length, 10)
    ); // Max 10 children

    // Base limits: 100-500 chars as requested
    let minContentPerChild = 100;
    let maxContentPerChild = 500;

    // DEGRESSIVE LIMITS: reduce content per child as we go deeper
    const depthFactor = Math.pow(0.7, currentLevel - 1); // 70% reduction per level
    minContentPerChild = Math.max(
      50,
      Math.floor(minContentPerChild * depthFactor)
    );
    maxContentPerChild = Math.max(
      100,
      Math.floor(maxContentPerChild * depthFactor)
    );

    // RESULT COUNT ADAPTATION: fewer results = more content per child
    const resultCountFactor =
      resultCount <= 20
        ? 1.5
        : resultCount <= 50
        ? 1.2
        : resultCount <= 100
        ? 1.0
        : 0.8;
    maxContentPerChild = Math.floor(maxContentPerChild * resultCountFactor);

    const targetContentPerChild = Math.max(
      minContentPerChild,
      Math.min(maxContentPerChild, budgetPerChild)
    );

    const outlineLines: string[] = [];
    let remainingBudget = budget;

    for (const [childUid, childContent] of sortedChildren.slice(0, 10)) {
      if (remainingBudget <= 0) break;

      // Format child content with adaptive truncation + REFERENCE RESOLUTION
      let formattedContent = childContent || "";

      // RESOLVE BLOCK REFERENCES: Replace ((uid)) with actual block content
      try {
        formattedContent = resolveReferences(formattedContent, [], true); // 'true' prevents deep recursion
      } catch (error) {
        console.warn(
          `Failed to resolve references in block ${childUid}:`,
          error
        );
        // Continue with unresolved content if resolution fails
      }

      // Apply content truncation after reference resolution
      if (formattedContent.length > targetContentPerChild) {
        formattedContent =
          formattedContent.substring(0, targetContentPerChild) + "...";
      }

      // Add current level with indentation
      outlineLines.push(`${indent}- ${formattedContent}`);
      remainingBudget -= formattedContent.length;

      // Recursively get children of this child if we have budget and depth remaining
      if (currentLevel < maxDepth && remainingBudget > 100) {
        // Need at least 100 chars for nested children
        const nestedBudget = Math.floor(remainingBudget * 0.3); // 30% of remaining budget for nested levels
        const nestedOutline = await buildRecursiveChildrenOutline(
          childUid,
          nestedBudget,
          maxDepth,
          resultCount, // Pass through result count
          currentLevel + 1,
          indent + "  " // Increase indentation
        );

        if (nestedOutline) {
          outlineLines.push(nestedOutline);
          remainingBudget -= nestedOutline.length;
        }
      }
    }

    const result = outlineLines.join("\n");
    return result;
  } catch (error) {
    console.error(`🌳 [BuildRecursiveOutline] Error for ${parentUid}:`, error);
    return "";
  }
}

/**
 * Stringifies expanded block with proper formatting
 */
function stringifyExpandedBlock(
  expandedBlock: any,
  budgetLimit: number
): string {
  const parts: string[] = [];

  // Always include original content (NEVER truncated) - UID is handled by the extraction function
  if (expandedBlock.original) {
    parts.push(expandedBlock.original);
  }

  // Page title is already shown by extraction function as "(in [[PageTitle]])", so skip it to avoid duplication

  // Calculate remaining budget after original content + fixed elements
  const fixedContentLength = expandedBlock.original.length + 30; // +30 for labels (no UID or page title in output now)
  const remainingBudget = Math.max(budgetLimit - fixedContentLength, 200); // Minimum 200 chars for context

  // Add parent context if available (fixed allocation: simple truncation)
  if (expandedBlock.parent) {
    const parentLimit = Math.min(
      500,
      Math.max(100, Math.floor(remainingBudget * 0.2))
    ); // Max 20% of remaining budget, 100-500 chars
    const truncatedParent =
      expandedBlock.parent.length > parentLimit
        ? expandedBlock.parent.substring(0, parentLimit) + "..."
        : expandedBlock.parent;
    parts.push(`Parent: ${truncatedParent}`);
  }

  // Add children outline if available (MAIN LINEAR ALLOCATION TARGET)
  if (expandedBlock.childrenOutline) {
    const parentUsed = expandedBlock.parent
      ? Math.min(500, Math.max(100, Math.floor(remainingBudget * 0.2)))
      : 0;
    const childrenBudget = remainingBudget - parentUsed; // Most of remaining budget goes to children

    // The children outline is already properly formatted and budgeted, but apply final safety limit if needed
    const childrenLimit = Math.max(300, childrenBudget); // Ensure minimum viable children content (increased for recursive format)
    const truncatedChildren =
      expandedBlock.childrenOutline.length > childrenLimit
        ? expandedBlock.childrenOutline.substring(0, childrenLimit) +
          "\n    ...[truncated]"
        : expandedBlock.childrenOutline;
    parts.push(`Children:\n${truncatedChildren}`);
  }

  return parts.join("\n");
}

/**
 * Applies intelligent truncation if total content exceeds budget
 */
function applyIntelligentTruncation(
  expandedBlocks: any[],
  totalBudget: number
): any[] {
  // Calculate total content length
  const totalLength = expandedBlocks.reduce(
    (sum, block) => sum + block.content.length,
    0
  );

  if (totalLength <= totalBudget) {
    return expandedBlocks; // No truncation needed
  }

  console.log(
    `🌳 [IntelligentTruncation] Total ${totalLength} chars > budget ${totalBudget}, applying proportional truncation`
  );

  // Calculate truncation ratio
  const truncationRatio = totalBudget / totalLength;
  const maxBlockLimit = Math.floor((totalBudget / expandedBlocks.length) * 0.9); // 90% of average budget per block

  return expandedBlocks.map((block) => {
    const targetLength = Math.min(
      Math.floor(block.content.length * truncationRatio),
      maxBlockLimit
    );

    if (block.content.length > targetLength) {
      return {
        ...block,
        content: block.content.substring(0, targetLength) + "...[truncated]",
        metadata: {
          ...block.metadata,
          truncated: true,
          originalLength: block.content.length,
          truncatedLength: targetLength,
        },
      };
    }

    return block;
  });
}
