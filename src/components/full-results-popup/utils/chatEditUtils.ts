/**
 * Chat Edit Utilities
 *
 * Utilities for inline editing of chat messages using Roam's native block editor.
 * Handles temporary block creation, content extraction, and cleanup.
 */

import {
  getPageUidByPageName,
  createChildBlock,
  deleteBlock,
  getTreeByUid,
} from "../../../utils/roamAPI";
import { getFlattenedContentFromTree } from "../../../ai/dataExtraction";
import { parseAndCreateBlocks } from "../../../utils/format";
import {
  convertMarkdownToRoamFormat,
  convertRoamToMarkdownFormat,
} from "./chatMessageUtils";

const LIVEAI_PAGE_NAME = "liveai/chat";

/**
 * Ensure the [[liveai]] page exists and return its UID.
 * Creates the page if it doesn't exist.
 */
export const ensureLiveAIPage = async (): Promise<string> => {
  let pageUid = getPageUidByPageName(LIVEAI_PAGE_NAME);

  if (!pageUid) {
    // Create the page using Roam's API
    pageUid = window.roamAlphaAPI.util.generateUID();
    await window.roamAlphaAPI.createPage({
      page: {
        title: LIVEAI_PAGE_NAME,
        uid: pageUid,
      },
    });
  }

  return pageUid;
};

/**
 * Create a temporary block for editing on the [[liveai]] page.
 * The content is converted from markdown to Roam format and parsed into blocks.
 * The parent block contains a header with role prefix and a notice that it's temporary.
 *
 * @param content - The markdown content to edit
 * @param rolePrefix - The role prefix (e.g., "**User:**" or "**Assistant:**")
 * @returns The UID of the created temporary block
 */
export const createTemporaryEditBlock = async (
  content: string,
  rolePrefix: string,
): Promise<string> => {
  const pageUid = await ensureLiveAIPage();

  // Convert markdown to Roam format
  const roamContent = convertMarkdownToRoamFormat(content);

  // Create a container block with role header and temporary notice
  const headerText = `${rolePrefix} ^^(Temporary editing block - will be deleted when saved)^^`;
  const tempBlockUid = await createChildBlock(
    pageUid,
    headerText,
    "last",
    true, // open = true to show children
  );

  // Parse and create the content as children of the temp block
  if (roamContent.trim()) {
    await parseAndCreateBlocks(tempBlockUid, roamContent, false);
  }

  return tempBlockUid;
};

/**
 * Extract content from a block tree and convert back to markdown.
 * Flattens the block tree including all children.
 *
 * @param blockUid - The UID of the block to extract content from
 * @returns The markdown content
 */
export const extractContentFromBlock = (blockUid: string): string => {
  // Get flattened content from the block tree
  const flattenedContent = getFlattenedContentFromTree({
    parentUid: blockUid,
    maxCapturing: 99,
    maxUid: 0,
    withDash: true,
    isParentToIgnore: true, // Ignore the container block itself
  });

  // Convert Roam formatting back to markdown
  const markdownContent = convertRoamToMarkdownFormat(flattenedContent);

  return markdownContent.trim();
};

/**
 * Cleanup a temporary block by deleting it.
 *
 * @param blockUid - The UID of the temporary block to delete
 */
export const cleanupTemporaryBlock = async (
  blockUid: string,
): Promise<void> => {
  try {
    await deleteBlock(blockUid);
  } catch (error) {
    console.error("Failed to cleanup temporary edit block:", error);
  }
};

/**
 * Check if content contains special Roam elements that require renderBlock for editing.
 * These elements include queries, KaTeX formulas, and media embeds.
 *
 * @param content - The content to check
 * @returns true if content has special Roam elements
 */
export const hasSpecialRoamContent = (content: string): boolean => {
  // Roam queries: {{[[query]]: ...}} or {{query: ...}}
  const queryRegex = /\{\{\s*(\[\[query\]\]|query)\s*:/i;

  // Datomic/Datalog queries: :q prefix
  const datomicQueryRegex = /^:q\s/m;

  // KaTeX formulas: $$...$$
  const katexRegex = /\$\$.+?\$\$/s;

  // Media embeds: {{[[audio|video|youtube]]: url}}
  const mediaEmbedRegex =
    /\{\{\[\[(?:audio|video|youtube)\]\]:\s*https?:[^\s}]+\}\}/i;

  // Block embeds: {{[[embed]]: ((uid))}}
  const blockEmbedRegex = /\{\{\[\[embed\]\]:\s*\(\([^\)]+\)\)\}\}/i;

  // Page embeds: {{[[embed]]: [[page]]}}
  const pageEmbedRegex = /\{\{\[\[embed\]\]:\s*\[\[[^\]]+\]\]\}\}/i;

  return (
    queryRegex.test(content) ||
    datomicQueryRegex.test(content) ||
    katexRegex.test(content) ||
    mediaEmbedRegex.test(content) ||
    blockEmbedRegex.test(content) ||
    pageEmbedRegex.test(content)
  );
};

/**
 * Get the first child block UID from a parent block.
 * Used to focus the editor on the actual content block.
 *
 * @param parentUid - The UID of the parent block
 * @returns The UID of the first child, or the parent UID if no children
 */
export const getFirstChildBlockUid = (parentUid: string): string => {
  const tree = getTreeByUid(parentUid);
  if (tree && tree[0]?.children && tree[0].children.length > 0) {
    // Sort by order to get the first child
    const sortedChildren = [...tree[0].children].sort(
      (a: any, b: any) => (a.order || 0) - (b.order || 0),
    );
    return sortedChildren[0].uid;
  }
  return parentUid;
};
