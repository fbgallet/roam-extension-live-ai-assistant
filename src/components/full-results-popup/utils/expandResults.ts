/**
 * Utility functions for expanding results with related content
 */

import { Result } from "../types/types";
import {
  getOrderedDirectChildren,
  getBlocksMentioningTitle,
  getPageUidByBlockUid,
  getPageNameByPageUid,
  getTreeByUid,
  treeToUidArray,
} from "../../../utils/roamAPI.js";
import {
  getBlocksFromPageUids,
  extractReferencesFromBlocks,
} from "../../../ai/agents/search-agent/tools/extractPagesReferences/executors";

export interface ExpandResultsResponse {
  newResults: Result[];
  uidsToRemove?: string[]; // UIDs of results that should be removed
  stats: {
    pages: number;
    blocks: number;
  };
}

/**
 * Get all child block UIDs from a block UID (recursively)
 */
export const getChildrenBlockUids = (blockUid: string): string[] => {
  const tree = getTreeByUid(blockUid);
  if (!tree) return [];

  return treeToUidArray(tree, true); // isParentToIgnore=true to exclude the parent block itself
};

/**
 * Replace selected items by their first children
 */
export const replaceByFirstChildren = (
  selectedResults: Result[]
): ExpandResultsResponse => {
  const newResults: Result[] = [];
  const uidsToRemove: string[] = [];

  selectedResults.forEach((result) => {
    const uid = result.blockUid || result.uid;
    if (!uid) return;

    // Track this UID for removal
    uidsToRemove.push(uid);

    const children = getOrderedDirectChildren(uid);
    if (children && children.length > 0) {
      children.forEach((child: any) => {
        const pageUid = getPageUidByBlockUid(child.uid) || undefined;
        newResults.push({
          uid: child.uid,
          content: child.string || "",
          text: child.string || "",
          blockUid: child.uid,
          pageUid,
          pageTitle: pageUid ? getPageNameByPageUid(pageUid) : undefined,
        });
      });
    }
  });

  return {
    newResults,
    uidsToRemove,
    stats: {
      pages: 0,
      blocks: newResults.length,
    },
  };
};

/**
 * Add linked references for selected pages
 */
export const addLinkedReferences = (
  selectedResults: Result[]
): ExpandResultsResponse => {
  const newResults: Result[] = [];
  const processedPages = new Set<string>();

  selectedResults.forEach((result) => {
    const pageTitle = result.pageTitle;
    if (!pageTitle || processedPages.has(pageTitle)) return;

    processedPages.add(pageTitle);
    const linkedRefs = getBlocksMentioningTitle(pageTitle);

    if (linkedRefs && linkedRefs.length > 0) {
      linkedRefs.forEach((ref: any) => {
        const pageUid = getPageUidByBlockUid(ref.uid);
        const refPageTitle = pageUid ? getPageNameByPageUid(pageUid) : undefined;
        newResults.push({
          uid: ref.uid,
          content: ref.content || "",
          text: ref.content || "",
          blockUid: ref.uid,
          pageUid: pageUid || undefined,
          pageTitle: refPageTitle || undefined,
        });
      });
    }
  });

  return {
    newResults,
    stats: {
      pages: processedPages.size,
      blocks: newResults.length,
    },
  };
};

/**
 * Add mentioned pages from selected items (blocks with children, or entire pages)
 */
export const addMentionedPages = async (
  selectedResults: Result[]
): Promise<ExpandResultsResponse> => {
  // Collect block UIDs and page UIDs
  const blockUids: string[] = [];
  const pageUids: string[] = [];

  selectedResults.forEach((result) => {
    if (result.blockUid || (result.uid && result.pageUid)) {
      // It's a block - we need all its children too
      const blockUid = result.blockUid || result.uid!;
      blockUids.push(blockUid);
      // Get all children blocks
      const childrenUids = getChildrenBlockUids(blockUid);
      blockUids.push(...childrenUids);
    } else if (result.uid && !result.pageUid) {
      // It's a page
      pageUids.push(result.uid);
    }
  });

  // Get all blocks from pages
  if (pageUids.length > 0) {
    const pageBlocks = await getBlocksFromPageUids(pageUids);
    blockUids.push(...pageBlocks);
  }

  // Extract references from all blocks
  const references = await extractReferencesFromBlocks(blockUids);

  // Create Result objects for each referenced page
  const newResults: Result[] = references.map((ref) => ({
    uid: ref.pageUid,
    content: ref.pageTitle,
    text: ref.pageTitle,
    pageTitle: ref.pageTitle,
  }));

  return {
    newResults,
    stats: {
      pages: newResults.length,
      blocks: 0,
    },
  };
};

/**
 * Add mentioned pages AND their linked references
 */
export const addMentionedPagesAndLinkedRefs = async (
  selectedResults: Result[]
): Promise<ExpandResultsResponse> => {
  // First, get mentioned pages
  const mentionedPagesResponse = await addMentionedPages(selectedResults);

  // Then get linked references for those mentioned pages
  const linkedRefsResponse = addLinkedReferences(mentionedPagesResponse.newResults);

  // Combine both
  return {
    newResults: [...mentionedPagesResponse.newResults, ...linkedRefsResponse.newResults],
    stats: {
      pages: mentionedPagesResponse.stats.pages,
      blocks: linkedRefsResponse.stats.blocks,
    },
  };
};

/**
 * Deduplicate results by UID
 */
export const deduplicateResults = (
  existingResults: Result[],
  newResults: Result[]
): Result[] => {
  const existingUids = new Set(
    existingResults.map((r) => r.blockUid || r.uid).filter(Boolean)
  );

  return newResults.filter((r) => {
    const uid = r.blockUid || r.uid;
    return uid && !existingUids.has(uid);
  });
};
