import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  executeDatomicQuery,
  isDailyNote,
  createToolResult,
} from "./searchUtils";

/**
 * Get detailed information about specific nodes (blocks or pages)
 * Security Level: Content (includes full content when requested)
 * 
 * This tool fetches detailed information about specific nodes when needed,
 * allowing other tools to return minimal data and fetch details on demand.
 */

const schema = z.object({
  // Input - what to fetch details for
  blockUids: z.array(z.string()).optional().describe("Array of block UIDs to get details for"),
  pageUids: z.array(z.string()).optional().describe("Array of page UIDs to get details for"),
  
  // What details to include
  includeContent: z.boolean().default(true).describe("Include full block content (secure mode: false)"),
  includeMetadata: z.boolean().default(true).describe("Include creation/modification dates"),
  includeHierarchy: z.boolean().default(false).describe("Include parent/child information"),
  
  // Limiting
  limit: z.number().min(1).max(100).default(50).describe("Maximum number of nodes to fetch details for"),
});

const getNodeDetailsImpl = async (input: z.infer<typeof schema>) => {
  console.log(`🔧 getNodeDetailsImpl input:`, input);
  const {
    blockUids,
    pageUids,
    includeContent,
    includeMetadata,
    includeHierarchy,
    limit,
  } = input;

  // Validate input
  if (!blockUids?.length && !pageUids?.length) {
    throw new Error("Must provide at least one of: blockUids or pageUids");
  }

  let allResults: any[] = [];

  // Fetch block details
  if (blockUids?.length) {
    const blockDetails = await fetchBlockDetails(
      blockUids.slice(0, limit),
      includeContent,
      includeMetadata,
      includeHierarchy
    );
    allResults.push(...blockDetails);
  }

  // Fetch page details
  if (pageUids?.length && allResults.length < limit) {
    const remainingLimit = limit - allResults.length;
    const pageDetails = await fetchPageDetails(
      pageUids.slice(0, remainingLimit),
      includeMetadata
    );
    allResults.push(...pageDetails);
  }

  // Apply final limit
  if (allResults.length > limit) {
    allResults = allResults.slice(0, limit);
  }

  console.log(`📊 Returning details for ${allResults.length} nodes`);
  return allResults;
};

/**
 * Fetch detailed information about blocks
 */
const fetchBlockDetails = async (
  blockUids: string[],
  includeContent: boolean,
  includeMetadata: boolean,
  includeHierarchy: boolean
): Promise<any[]> => {
  if (blockUids.length === 0) return [];

  const uidsClause = blockUids.map(uid => `"${uid}"`).join(' ');
  
  // Base query for block details
  let queryFields = ['?uid'];
  let queryWhere = `[?b :block/uid ?uid]
                    [(contains? #{${uidsClause}} ?uid)]
                    [?b :block/page ?page]
                    [?page :node/title ?page-title]
                    [?page :block/uid ?page-uid]`;

  if (includeContent) {
    queryFields.push('?content');
    queryWhere += `\n                    [?b :block/string ?content]`;
  }

  if (includeMetadata) {
    queryFields.push('?created', '?modified');
    queryWhere += `\n                    [?b :create/time ?created]
                    [?b :edit/time ?modified]`;
  }

  queryFields.push('?page-title', '?page-uid');

  const query = `[:find ${queryFields.join(' ')}
                  :where
                  ${queryWhere}]`;

  console.log(`🔍 Fetching details for ${blockUids.length} blocks...`);
  const results = await executeDatomicQuery(query);

  return results.map(result => {
    let index = 0;
    const blockDetail: any = {
      type: 'block',
      uid: result[index++],
    };

    if (includeContent) {
      blockDetail.content = result[index++];
    }

    if (includeMetadata) {
      blockDetail.created = new Date(result[index++]);
      blockDetail.modified = new Date(result[index++]);
    }

    blockDetail.pageTitle = result[index++];
    blockDetail.pageUid = result[index++];
    blockDetail.isDaily = isDailyNote(blockDetail.pageUid);

    // TODO: Add hierarchy fetching if includeHierarchy is true
    if (includeHierarchy) {
      blockDetail.children = [];
      blockDetail.parents = [];
      // This would require additional queries similar to enrichWithHierarchy
    }

    return blockDetail;
  });
};

/**
 * Fetch detailed information about pages
 */
const fetchPageDetails = async (
  pageUids: string[],
  includeMetadata: boolean
): Promise<any[]> => {
  if (pageUids.length === 0) return [];

  const uidsClause = pageUids.map(uid => `"${uid}"`).join(' ');
  
  let queryFields = ['?page-uid', '?page-title'];
  let queryWhere = `[?page :block/uid ?page-uid]
                    [(contains? #{${uidsClause}} ?page-uid)]
                    [?page :node/title ?page-title]`;

  if (includeMetadata) {
    queryFields.push('?created', '?modified');
    queryWhere += `\n                    [?page :create/time ?created]
                    [?page :edit/time ?modified]`;
  }

  const query = `[:find ${queryFields.join(' ')}
                  :where
                  ${queryWhere}]`;

  console.log(`🔍 Fetching details for ${pageUids.length} pages...`);
  const results = await executeDatomicQuery(query);

  return results.map(result => {
    let index = 0;
    const pageDetail: any = {
      type: 'page',
      pageUid: result[index++],
      pageTitle: result[index++],
    };

    if (includeMetadata) {
      pageDetail.created = new Date(result[index++]);
      pageDetail.modified = new Date(result[index++]);
    }

    pageDetail.isDaily = isDailyNote(pageDetail.pageUid);

    return pageDetail;
  });
};

export const getNodeDetailsTool = tool(
  async (input) => {
    const startTime = performance.now();
    try {
      const results = await getNodeDetailsImpl(input);
      return createToolResult(
        true,
        results,
        undefined,
        "getNodeDetails",
        startTime
      );
    } catch (error) {
      console.error("GetNodeDetails tool error:", error);
      return createToolResult(
        false,
        undefined,
        error.message,
        "getNodeDetails",
        startTime
      );
    }
  },
  {
    name: "getNodeDetails",
    description:
      "Fetch detailed information about specific blocks or pages when you need more context than what other tools provide. Use this after getting UIDs from other tools when you need full content, metadata, or hierarchy information. Supports up to 50 nodes per call to prevent token bloat.",
    schema,
  }
);