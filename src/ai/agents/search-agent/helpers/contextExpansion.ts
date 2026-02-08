/**
 * Context Expansion Module
 *
 * This module handles the adaptive context expansion functionality for the search agent.
 * It provides intelligent hierarchy expansion with adaptive depth and content limits,
 * reference resolution, and budget-aware truncation strategies.
 */

import { executeDatomicQuery } from "./searchUtils";
import {
  getBlockContentByUid,
  resolveReferences,
} from "../../../../utils/roamAPI";

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
  accessMode?: string,
  noTruncation: boolean = false
): Promise<any[]> {
  if (!results || results.length === 0) return [];

  // Check if these are metadata-only results (title-only, no UIDs)
  // These cannot be expanded because we don't have UIDs to fetch content
  const isMetadataOnly = results.every((r) => !r.uid && !r.pageUid && r.title);

  if (isMetadataOnly) {
    console.log(
      `📋 [AdaptiveExpansion] Metadata-only results detected (${results.length} items), skipping expansion`
    );
    // Return results as-is, formatted for display
    return results.map((r) => ({
      ...r,
      pageTitle: r.title,
      // Mark as already formatted so chat agent uses them directly
      isMetadataOnly: true,
    }));
  }

  const resultCount = results.length;
  const availableBudget = Math.max(0, charLimit - currentContentLength);

  // Use smaller budget between available and access mode limit
  const modeBudget = noTruncation
    ? Number.MAX_SAFE_INTEGER
    : accessMode === "Full Access"
      ? EXPANSION_BUDGETS.full
      : EXPANSION_BUDGETS.balanced;
  const expansionBudget = noTruncation
    ? Number.MAX_SAFE_INTEGER
    : Math.min(availableBudget, modeBudget);

  console.log(`🌳 [AdaptiveExpansion] Budget calculation:`, {
    charLimit,
    currentContentLength,
    availableBudget,
    modeBudget,
    expansionBudget,
    accessMode,
  });

  // Separate pages from blocks
  const pages = results.filter((r) => r.isPage === true);
  const blocks = results.filter((r) => !r.isPage);

  console.log(`🌳 [AdaptiveExpansion] Separated results:`, {
    totalResults: results.length,
    pages: pages.length,
    blocks: blocks.length,
  });

  // Extract block UIDs for hierarchy queries (only for blocks, pages don't have parents)
  const blockUids = blocks
    .filter((r) => r.uid && r.uid.length === 9) // 9-char UIDs are blocks
    .map((r) => r.uid);

  // Extract page UIDs for children queries
  const pageUids = pages.filter((r) => r.uid).map((r) => r.uid);

  console.log(`🌳 [AdaptiveExpansion] Extracted UIDs:`, {
    blockUids: blockUids.length,
    pageUids: pageUids.length,
    pageUidsSample: pageUids.slice(0, 3),
  });

  let expandedResults: any[] = [];

  // Process blocks with hierarchy data
  if (blockUids.length > 0) {
    const hierarchyData = await fetchHierarchyData(blockUids);

    const expandedBlocks = await createExpandedBlocks(
      [...blocks],
      hierarchyData,
      expansionBudget,
      accessMode,
      noTruncation
    );
    expandedResults.push(...expandedBlocks);
  }

  // Process pages separately (no parent context, different depth limits)
  if (pageUids.length > 0) {
    const expandedPages = await createExpandedPages(
      [...pages],
      expansionBudget,
      accessMode
    );
    expandedResults.push(...expandedPages);
  }

  // Apply intelligent truncation based on budget
  const finalExpandedBlocks = applyIntelligentTruncation(
    expandedResults,
    expansionBudget,
    noTruncation
  );

  console.log(
    `🌳 [AdaptiveExpansion] Created ${finalExpandedBlocks.length} expanded results (${blocks.length} blocks, ${pages.length} pages)`
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
  accessMode?: string,
  noTruncation: boolean = false
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

      // Distinguish between blocks and pages
      // Blocks have pageUid property (they are IN a page), pages don't
      const isBlock = result.pageUid !== undefined;
      let originalContent = "";

      if (isBlock) {
        // For blocks: always fetch fresh block content (ignore result.content as it may be pre-expanded)
        originalContent = getBlockContentByUid(result.uid) || "";
      } else {
        // For pages: use page title as content
        originalContent = result.pageTitle || "";
      }

      // RESOLVE REFERENCES in original content
      try {
        if (originalContent) {
          originalContent = resolveReferences(originalContent, [], true);
        }
      } catch (error) {
        console.warn(
          `Failed to resolve references in ${isBlock ? "block" : "page"} ${
            result.uid
          }:`,
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
      if (resultCount > 500) {
        maxDepth = 0; // No expansion for very large result sets
      } else if (resultCount <= 10) {
        maxDepth = 99; // Full exploration for small result sets
      } else if (resultCount <= 20) {
        maxDepth = 5; // Deep exploration for small result sets
      } else if (resultCount <= 100) {
        maxDepth = 4; // Deep exploration for small result sets
      } else if (resultCount <= 200) {
        maxDepth = 3; // Moderate depth for medium result sets
      } else if (resultCount <= 300) {
        maxDepth = 2; // Standard depth for larger result sets
      } else {
        // 300 < resultCount <= 500
        maxDepth = 1; // Shallow for large result sets
      }

      // Then apply additional restrictions for Balanced mode
      if (accessMode === "Balanced") {
        if (resultCount > 200) {
          maxDepth = Math.min(maxDepth, 0); // No expansion level for >200 results in Balanced
        } else if (resultCount <= 10) {
          maxDepth = Math.min(maxDepth, 4);
        } else if (resultCount <= 25) {
          maxDepth = Math.min(maxDepth, 3);
        } else if (resultCount <= 50) {
          maxDepth = Math.min(maxDepth, 2);
        } else {
          maxDepth = Math.min(maxDepth, 1);
        }
      }

      // Only expand children if we have budget and depth allowed
      // For pages, always try to expand children. For blocks, check hierarchy
      expandedBlock.childrenOutline =
        maxDepth > 0
          ? await buildRecursiveChildrenOutline(
              result.uid,
              availableBudgetForChildren,
              maxDepth,
              resultCount, // Pass result count for degressive content limits
              1, // currentLevel
              "  ", // indent
              false, // isPageExpansion
              noTruncation
            )
          : ""; // No children expansion for >150 results

      // Stringify the expanded block
      const stringifiedBlock = stringifyExpandedBlock(
        expandedBlock,
        budgetPerResult,
        noTruncation
      );

      expandedBlocks.push({
        ...result,
        originalContent: originalContent, // Preserve the fresh original content
        content: stringifiedBlock,
        expandedBlock: expandedBlock,
        metadata: {
          ...result.metadata,
          contextExpansion: true,
          originalLength: originalContent.length,
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
 * Creates expanded pages with children content (no parent context for pages)
 * Pages have different depth limits: balanced mode = 4 levels, full mode = unlimited
 */
async function createExpandedPages(
  originalPages: any[],
  budget: number,
  accessMode?: string
): Promise<any[]> {
  const expandedPages: any[] = [];

  // For pages, we don't strictly divide budget - each page gets the full budget
  // This allows full page content to be loaded without artificial limits

  for (const page of originalPages) {
    try {
      // Pages use title as content
      let originalContent = page.pageTitle || page.title || "";

      // RESOLVE REFERENCES in page title
      try {
        if (originalContent) {
          originalContent = resolveReferences(originalContent, [], true);
        }
      } catch (error) {
        console.warn(
          `Failed to resolve references in page ${page.uid}:`,
          error
        );
      }

      const expandedPage = {
        uid: page.uid,
        original: originalContent,
        pageTitle: originalContent,
        parent: "", // Pages don't have parent blocks
        childrenOutline: "",
      };

      // Add recursive children outline with page-specific depth limits
      // Pages use the full budget - no artificial restrictions
      const availableBudgetForChildren = budget;

      // PAGE-SPECIFIC DEPTH STRATEGY
      // Pages are less restrictive than blocks:
      // - Balanced mode: limit to 4 levels
      // - Full mode: unlimited (set to 999 as practical limit)
      const maxDepth = accessMode === "Full Access" ? 999 : 4;

      // Extract children content for page
      // Pass isPageExpansion=true to disable degressive limits for page content
      expandedPage.childrenOutline = await buildRecursiveChildrenOutline(
        page.uid,
        availableBudgetForChildren,
        maxDepth,
        originalPages.length, // Pass page count for context
        1, // currentLevel
        "  ", // indent
        true // isPageExpansion - disable degressive limits for pages
      );

      // Stringify the expanded page (no budget limit - pages are not truncated)
      const stringifiedPage = stringifyExpandedPage(expandedPage);

      expandedPages.push({
        ...page,
        originalContent: originalContent,
        content: stringifiedPage,
        expandedBlock: expandedPage, // Keep same property name for consistency
        metadata: {
          ...page.metadata,
          contextExpansion: true,
          originalLength: originalContent.length,
          expandedLength: stringifiedPage.length,
          isPage: true,
        },
      });
    } catch (error) {
      console.error(
        `🌳 [CreateExpandedPages] Error processing page ${page.uid}:`,
        error
      );
      // Fallback to original page
      expandedPages.push(page);
    }
  }

  return expandedPages;
}

/**
 * Stringifies expanded page with proper formatting (no parent context)
 * Pages are NOT truncated - we load their full content
 */
function stringifyExpandedPage(expandedPage: any): string {
  const parts: string[] = [];

  // Always include page title
  if (expandedPage.original) {
    parts.push(`Page: ${expandedPage.original}`);
  }

  // Add children outline if available (pages don't have parent context)
  // NO TRUNCATION for pages - include full content
  if (expandedPage.childrenOutline) {
    parts.push(`Content:\n${expandedPage.childrenOutline}`);
  }

  return parts.join("\n");
}

/**
 * Builds recursive children outline with proper indentation (inspired by convertTreeToLinearArray)
 * NEW STRATEGY: Extract full content first, only truncate if budget is exceeded
 */
async function buildRecursiveChildrenOutline(
  parentUid: string,
  budget: number,
  maxDepth: number = 2,
  resultCount: number = 50, // Total result count for degressive limits
  currentLevel: number = 1,
  indent: string = "  ",
  isPageExpansion: boolean = false, // If true, use full content limits for pages
  noTruncation: boolean = false
): Promise<string> {
  if (currentLevel > maxDepth) return ""; // Only check depth, not budget yet

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

    // NEW STRATEGY: Extract ALL content first without truncation
    const outlineLines: string[] = [];

    // Limit to reasonable number of children to prevent infinite expansion
    const maxChildren = isPageExpansion ? 100 : 10; // Pages can have more children shown

    for (const [childUid, childContent] of sortedChildren.slice(0, maxChildren)) {
      // Format child content + REFERENCE RESOLUTION
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

      // NO TRUNCATION YET - extract full content
      // Add current level with indentation
      outlineLines.push(`${indent}- ${formattedContent}`);

      // Recursively get children of this child if we have depth remaining
      if (currentLevel < maxDepth) {
        const nestedOutline = await buildRecursiveChildrenOutline(
          childUid,
          budget, // Pass same budget (will be checked at the end)
          maxDepth,
          resultCount,
          currentLevel + 1,
          indent + "  ", // Increase indentation
          isPageExpansion,
          noTruncation
        );

        if (nestedOutline) {
          outlineLines.push(nestedOutline);
        }
      }
    }

    const fullContent = outlineLines.join("\n");

    // NOW check if we need to truncate based on budget
    // For pages: no truncation unless budget is explicitly exceeded
    // For blocks: truncate if we exceed budget
    if (!noTruncation && !isPageExpansion && fullContent.length > budget && budget > 0) {
      // Need to truncate - apply intelligent truncation
      const truncatedContent = fullContent.substring(0, budget) + "\n    ...[content truncated to fit budget]";
      console.log(
        `🌳 [BuildRecursiveOutline] Truncated content from ${fullContent.length} to ${budget} chars at level ${currentLevel}`
      );
      return truncatedContent;
    }

    return fullContent;
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
  budgetLimit: number,
  noTruncation: boolean = false
): string {
  const parts: string[] = [];

  // Always include original content (NEVER truncated) - UID is handled by the extraction function
  if (expandedBlock.original) {
    parts.push(expandedBlock.original);
  }

  // Page title is already shown by extraction function as "(in [[PageTitle]])", so skip it to avoid duplication

  if (noTruncation) {
    // No truncation: include parent and children as-is
    if (expandedBlock.parent) {
      parts.push(`Parent: ${expandedBlock.parent}`);
    }
    if (expandedBlock.childrenOutline) {
      parts.push(`Children:\n${expandedBlock.childrenOutline}`);
    }
    return parts.join("\n");
  }

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
 * NEW: Pages are NEVER truncated, only blocks are truncated when budget is exceeded
 */
function applyIntelligentTruncation(
  expandedBlocks: any[],
  totalBudget: number,
  noTruncation: boolean = false
): any[] {
  if (noTruncation) {
    console.log(
      `🌳 [IntelligentTruncation] noTruncation enabled, skipping truncation for ${expandedBlocks.length} blocks`
    );
    return expandedBlocks;
  }

  // Separate pages from blocks
  const pages = expandedBlocks.filter((item) => item.isPage === true || item.metadata?.isPage === true);
  const blocks = expandedBlocks.filter((item) => !(item.isPage === true || item.metadata?.isPage === true));

  // Calculate total content length for blocks only (pages are exempt)
  const blocksLength = blocks.reduce((sum, block) => sum + block.content.length, 0);
  const pagesLength = pages.reduce((sum, page) => sum + page.content.length, 0);
  const totalLength = blocksLength + pagesLength;

  console.log(
    `🌳 [IntelligentTruncation] Total ${totalLength} chars (${blocksLength} blocks + ${pagesLength} pages), budget: ${totalBudget}`
  );

  if (totalLength <= totalBudget) {
    console.log(`🌳 [IntelligentTruncation] Within budget, no truncation needed`);
    return expandedBlocks; // No truncation needed
  }

  // Budget exceeded - but we NEVER truncate pages
  // Only truncate blocks to fit remaining budget after pages
  const remainingBudgetForBlocks = Math.max(0, totalBudget - pagesLength);

  if (remainingBudgetForBlocks === 0 || blocks.length === 0) {
    console.log(
      `🌳 [IntelligentTruncation] Pages use full budget (${pagesLength} chars), no room for blocks`
    );
    // Return only pages if no budget left for blocks
    return pages;
  }

  console.log(
    `🌳 [IntelligentTruncation] Truncating blocks from ${blocksLength} to ${remainingBudgetForBlocks} chars to fit budget`
  );

  // Calculate truncation ratio for blocks only
  const truncationRatio = remainingBudgetForBlocks / blocksLength;
  const maxBlockLimit = Math.floor((remainingBudgetForBlocks / blocks.length) * 0.9); // 90% of average budget per block

  const truncatedBlocks = blocks.map((block) => {
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

  // Return pages (untruncated) + truncated blocks
  return [...pages, ...truncatedBlocks];
}
