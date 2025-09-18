import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  executeDatomicQuery,
  truncateContent,
  extractUidsFromResults,
} from "../../helpers/searchUtils";
import { createToolResult } from "../../helpers/semanticExpansion";
import { schema, BlockNode, HierarchyContent } from "./schemas";

/**
 * Extract and format hierarchical content from specific blocks
 * Security Level: Content (accesses full block content and hierarchy for formatting)
 *
 * This tool takes block UIDs and extracts their complete hierarchical content,
 * formatted for presentation with support for different output formats and filtering.
 */

const extractHierarchyContentImpl = async (
  input: z.infer<typeof schema>,
  state?: any
): Promise<HierarchyContent[]> => {
  const {
    blockUids,
    fromResultId,
    extractOptions,
    formatOptions,
    excludeEmpty,
    includeParents,
    includeChildren,
    resolveReferences,
    maxReferenceDepth,
  } = input;

  // Extract block UIDs from previous results and user input
  const { blockUids: finalBlockUids } = extractUidsFromResults(
    fromResultId,
    blockUids,
    undefined, // No page UIDs for this tool
    state
  );

  console.log(
    `🔍 ExtractHierarchyContent: Processing ${finalBlockUids.length} block UIDs`
  );

  const results: HierarchyContent[] = [];
  const processedPages = new Set<string>();

  for (const rootUid of finalBlockUids) {
    try {
      // Get the root block info
      const rootBlock = await getBlockInfo(rootUid);
      if (!rootBlock) {
        console.warn(`Block ${rootUid} not found, skipping`);
        continue;
      }

      // Skip if we've already processed this page and separatePages is false
      if (
        !formatOptions.separatePages &&
        processedPages.has(rootBlock.pageUid)
      ) {
        continue;
      }
      processedPages.add(rootBlock.pageUid);

      // Build the hierarchy structure
      const structure = await buildHierarchyStructure(
        rootUid,
        extractOptions,
        includeParents,
        includeChildren,
        0
      );

      // Resolve references if requested
      if (resolveReferences) {
        await resolveBlockReferences(structure, maxReferenceDepth);
      }

      // Extract all references
      const references = extractAllReferences(structure);

      // Format the content
      const formattedContent = formatHierarchyContent(
        structure,
        formatOptions,
        extractOptions
      );

      // Calculate statistics
      const stats = calculateHierarchyStats(structure, extractOptions);

      results.push({
        rootUid,
        content: formattedContent,
        structure,
        references,
        stats,
      });
    } catch (error) {
      console.error(`Error processing block ${rootUid}:`, error);
    }
  }

  return results;
};

/**
 * Get basic information about a block
 */
const getBlockInfo = async (uid: string): Promise<any> => {
  const query = `[:find ?content ?created ?modified ?page-title ?page-uid
                  :where
                  [?b :block/uid "${uid}"]
                  [?b :block/string ?content]
                  [?b :create/time ?created]
                  [?b :edit/time ?modified]
                  [?b :block/page ?page]
                  [?page :node/title ?page-title]
                  [?page :block/uid ?page-uid]]`;

  const result = await executeDatomicQuery(query);
  if (result.length === 0) return null;

  const [content, created, modified, pageTitle, pageUid] = result[0];
  return {
    uid,
    content,
    created: new Date(created),
    modified: new Date(modified),
    pageTitle,
    pageUid,
  };
};

/**
 * Build complete hierarchy structure from a root block
 */
const buildHierarchyStructure = async (
  rootUid: string,
  extractOptions: any,
  includeParents: boolean,
  includeChildren: boolean,
  currentLevel: number
): Promise<BlockNode[]> => {
  // If we've reached max depth, stop
  if (currentLevel >= extractOptions.maxDepth) {
    return [];
  }

  const structure: BlockNode[] = [];

  // Get the root block
  const rootInfo = await getBlockInfo(rootUid);
  if (!rootInfo) return structure;

  // Create the root node
  const rootNode = {
    uid: rootUid,
    content: rootInfo.content,
    level: currentLevel,
    children: [],
    created: rootInfo.created,
    modified: rootInfo.modified,
    page: rootInfo.pageTitle,
    pageUid: rootInfo.pageUid,
    references: extractReferencesFromContent(rootInfo.content),
    // Explicit type flag (isPage: false means it's a block)
    isPage: false,
  } as any;

  // Add parent context if requested
  if (includeParents && currentLevel === 0) {
    const parents = await getBlockParents(rootUid);
    // Add parents as context at the beginning
    for (let i = parents.length - 1; i >= 0; i--) {
      const parent = parents[i];
      const parentNode = {
        uid: parent.uid,
        content: `[Parent] ${truncateContent(
          parent.content,
          extractOptions.truncateLength
        )}`,
        level: currentLevel - (i + 1),
        children: [],
        references: extractReferencesFromContent(parent.content),
        // Explicit type flags
        isBlock: true,
        isPage: false,
      } as any;
      structure.push(parentNode);
    }
  }

  // Add the main block
  structure.push(rootNode);

  // Get children if requested
  if (includeChildren) {
    const children = await getBlockChildren(rootUid);

    for (const child of children) {
      const childStructure = await buildHierarchyStructure(
        child.uid,
        extractOptions,
        false, // Don't include parents for children
        true, // Include children recursively
        currentLevel + 1
      );

      rootNode.children.push(...childStructure);
    }
  }

  return structure;
};

/**
 * Get block children with order
 */
const getBlockChildren = async (parentUid: string): Promise<any[]> => {
  const query = `[:find ?uid ?content ?order
                  :where
                  [?parent :block/uid "${parentUid}"]
                  [?parent :block/children ?child]
                  [?child :block/uid ?uid]
                  [?child :block/string ?content]
                  [?child :block/order ?order]]`;

  const results = await executeDatomicQuery(query);
  return results
    .sort((a, b) => a[2] - b[2]) // Sort by order
    .map(([uid, content, order]) => ({ uid, content, order }));
};

/**
 * Get block parents
 */
const getBlockParents = async (childUid: string): Promise<any[]> => {
  const query = `[:find ?uid ?content
                  :where
                  [?child :block/uid "${childUid}"]
                  [?parent :block/children ?child]
                  [?parent :block/uid ?uid]
                  [?parent :block/string ?content]]`;

  const results = await executeDatomicQuery(query);
  return results.map(([uid, content]) => ({ uid, content }));
};

/**
 * Extract references from block content
 */
const extractReferencesFromContent = (content: string): string[] => {
  const references: string[] = [];

  // Extract page references [[...]]
  const pageRefs = content.match(/\[\[([^\]]+)\]\]/g);
  if (pageRefs) {
    references.push(...pageRefs.map((ref) => ref.slice(2, -2)));
  }

  // Extract block references ((...))
  const blockRefs = content.match(/\(\(([^)]+)\)\)/g);
  if (blockRefs) {
    references.push(...blockRefs.map((ref) => ref.slice(2, -2)));
  }

  return references;
};

/**
 * Resolve references to their actual content
 */
const resolveBlockReferences = async (
  structure: BlockNode[],
  maxDepth: number
): Promise<void> => {
  if (maxDepth <= 0) return;

  for (const node of structure) {
    if (node.references && node.references.length > 0) {
      for (const ref of node.references) {
        // Try to resolve as block reference first (9 characters)
        if (ref.length === 9) {
          const blockInfo = await getBlockInfo(ref);
          if (blockInfo) {
            node.content += `\n  → Block: ${truncateContent(
              blockInfo.content,
              100
            )}`;
          }
        } else {
          // Try to resolve as page reference
          const pageQuery = `[:find ?uid ?title
                             :where
                             [?page :node/title "${ref}"]
                             [?page :block/uid ?uid]]`;

          const pageResult = await executeDatomicQuery(pageQuery);
          if (pageResult.length > 0) {
            node.content += `\n  → Page: [[${ref}]]`;
          }
        }
      }
    }

    // Recursively resolve children
    if (node.children.length > 0) {
      await resolveBlockReferences(node.children, maxDepth - 1);
    }
  }
};

/**
 * Extract all references from the hierarchy structure
 */
const extractAllReferences = (
  structure: BlockNode[]
): Array<{ type: "page" | "block"; uid: string; title?: string }> => {
  const references: Array<{
    type: "page" | "block";
    uid: string;
    title?: string;
  }> = [];

  const processNode = (node: BlockNode) => {
    if (node.references) {
      for (const ref of node.references) {
        const type = ref.length === 9 ? "block" : "page";
        references.push({
          type,
          uid: ref,
          title: type === "page" ? ref : undefined,
        });
      }
    }

    node.children.forEach(processNode);
  };

  structure.forEach(processNode);

  // Remove duplicates
  const unique = references.filter(
    (ref, index, arr) =>
      arr.findIndex((r) => r.type === ref.type && r.uid === ref.uid) === index
  );

  return unique;
};

/**
 * Format hierarchy content based on output format
 */
const formatHierarchyContent = (
  structure: BlockNode[],
  formatOptions: any,
  extractOptions: any
): string => {
  let output = "";

  const formatNode = (node: BlockNode, isLast: boolean = false): string => {
    let result = "";
    const indent = " ".repeat(node.level * extractOptions.indentSize);

    // Format bullet based on style
    let bullet = "";
    switch (extractOptions.bulletStyle) {
      case "dash":
        bullet = node.level === 0 ? "# " : "- ";
        break;
      case "bullet":
        bullet = "• ";
        break;
      case "number":
        bullet = "1. "; // Could be enhanced to track actual numbers
        break;
      case "none":
        bullet = "";
        break;
    }

    // Format content based on output format
    let content = node.content;
    if (
      extractOptions.truncateLength &&
      content.length > extractOptions.truncateLength
    ) {
      content = truncateContent(content, extractOptions.truncateLength);
    }

    // Handle link formatting
    if (formatOptions.linkFormat === "markdown") {
      content = content
        .replace(/\[\[([^\]]+)\]\]/g, "[$1]($1)")
        .replace(/\(\(([^)]+)\)\)/g, "[Block $1]($1)");
    } else if (formatOptions.linkFormat === "plain") {
      content = content
        .replace(/\[\[([^\]]+)\]\]/g, "$1")
        .replace(/\(\(([^)]+)\)\)/g, "Block $1");
    }

    // Build the line
    result += indent + bullet + content;

    // Add metadata if requested
    if (formatOptions.includeBlockUIDs) {
      result += ` \`${node.uid}\``;
    }

    if (formatOptions.addTimestamps && node.modified) {
      result += ` _(${node.modified.toISOString().split("T")[0]})_`;
    }

    result += "\n";

    // Add children
    node.children.forEach((child, index) => {
      result += formatNode(child, index === node.children.length - 1);
    });

    return result;
  };

  // Add page context if requested
  if (formatOptions.includePageContext && structure.length > 0) {
    const firstNode = structure[0];
    if (firstNode.page) {
      output += `## Page: ${firstNode.page}\n\n`;
    }
  }

  // Format all nodes
  structure.forEach((node, index) => {
    output += formatNode(node, index === structure.length - 1);
  });

  return output;
};

/**
 * Calculate hierarchy statistics
 */
const calculateHierarchyStats = (
  structure: BlockNode[],
  extractOptions: any
) => {
  let totalBlocks = 0;
  let maxDepth = 0;
  let totalCharacters = 0;
  let truncated = false;

  const processNode = (node: BlockNode) => {
    totalBlocks++;
    maxDepth = Math.max(maxDepth, node.level);
    totalCharacters += node.content.length;

    if (node.content.length > extractOptions.truncateLength) {
      truncated = true;
    }

    node.children.forEach(processNode);
  };

  structure.forEach(processNode);

  return {
    totalBlocks,
    maxDepth,
    totalCharacters,
    truncated,
  };
};

export const extractHierarchyContentTool = tool(
  async (input, config) => {
    const startTime = performance.now();
    try {
      // Extract state from config
      const state = config?.configurable?.state;
      const results = await extractHierarchyContentImpl(input, state);
      return createToolResult(
        true,
        results,
        undefined,
        "extractHierarchyContent",
        startTime
      );
    } catch (error) {
      console.error("ExtractHierarchyContent tool error:", error);
      return createToolResult(
        false,
        undefined,
        error.message,
        "extractHierarchyContent",
        startTime
      );
    }
  },
  {
    name: "extractHierarchyContent",
    description:
      "Extract and format hierarchical content from specific blocks. Supports multiple output formats (markdown, plain, roam), reference resolution, and detailed content statistics.",
    schema,
  }
);