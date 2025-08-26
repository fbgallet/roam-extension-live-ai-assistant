import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  executeDatomicQuery,
  isDailyNote,
  createToolResult,
  extractUidsFromResults,
} from "../helpers/searchUtils";

/**
 * Get detailed information about specific nodes (blocks or pages)
 * Security Level: Content (includes full content when requested)
 *
 * This tool fetches detailed information about specific nodes when needed,
 * allowing other tools to return minimal data and fetch details on demand.
 */

const schema = z
  .object({
    // Input - what to fetch details for
    blockUids: z
      .array(z.string())
      .optional()
      .describe("Array of block UIDs to get details for"),
    pageUids: z
      .array(z.string())
      .optional()
      .describe("Array of page UIDs to get details for"),
    fromResultId: z
      .string()
      .optional()
      .describe(
        "Get details for blocks/pages from previous result (e.g., 'findBlocksByContent_001')"
      ),

    // What details to include
    includeContent: z
      .boolean()
      .default(true)
      .describe("Include full block content (secure mode: false)"),
    includeMetadata: z
      .boolean()
      .default(true)
      .describe("Include creation/modification dates"),
    includeHierarchy: z
      .boolean()
      .default(false)
      .describe("Include parent/child information"),

    // Limiting
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum number of nodes to fetch details for"),
  })
  .refine(
    (data) =>
      data.blockUids?.length > 0 ||
      data.pageUids?.length > 0 ||
      data.fromResultId,
    { message: "Either blockUids, pageUids, or fromResultId must be provided" }
  );

const getNodeDetailsImpl = async (
  input: z.infer<typeof schema>,
  state?: any
) => {
  console.log(`🔧 getNodeDetailsImpl input:`, input);
  const {
    blockUids,
    pageUids,
    fromResultId,
    includeContent,
    includeMetadata,
    includeHierarchy,
    limit,
  } = input;

  // Extract UIDs from previous results and user input
  const { blockUids: finalBlockUids, pageUids: finalPageUids } =
    extractUidsFromResults(fromResultId, blockUids, pageUids, state);

  // Validate we have something to work with
  if (!finalBlockUids.length && !finalPageUids.length) {
    throw new Error(
      "Must provide at least one of: blockUids, pageUids, or fromResultId with valid results"
    );
  }

  let allResults: any[] = [];

  // Fetch block details
  if (finalBlockUids.length) {
    const blockDetails = await fetchBlockDetails(
      finalBlockUids.slice(0, limit),
      includeContent,
      includeMetadata,
      includeHierarchy
    );
    allResults.push(...blockDetails);
  }

  // Fetch page details
  if (finalPageUids.length && allResults.length < limit) {
    const remainingLimit = limit - allResults.length;
    const pageDetails = await fetchPageDetails(
      finalPageUids.slice(0, remainingLimit),
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

  const uidsClause = blockUids.map((uid) => `"${uid}"`).join(" ");

  // Base query for block details
  let queryFields = ["?uid"];
  let queryWhere = `[?b :block/uid ?uid]
                    [(contains? #{${uidsClause}} ?uid)]
                    [?b :block/page ?page]
                    [?page :node/title ?page-title]
                    [?page :block/uid ?page-uid]`;

  if (includeContent) {
    queryFields.push("?content");
    queryWhere += `\n                    [?b :block/string ?content]`;
  }

  if (includeMetadata) {
    queryFields.push("?created", "?modified");
    queryWhere += `\n                    [?b :create/time ?created]
                    [?b :edit/time ?modified]`;
  }

  queryFields.push("?page-title", "?page-uid");

  const query = `[:find ${queryFields.join(" ")}
                  :where
                  ${queryWhere}]`;

  console.log(`🔍 Fetching details for ${blockUids.length} blocks...`);
  const results = await executeDatomicQuery(query);

  return results.map((result) => {
    let index = 0;
    const blockDetail: any = {
      type: "block",
      uid: result[index++],
      // Explicit type flag (isPage: false means it's a block)
      isPage: false,
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

  const uidsClause = pageUids.map((uid) => `"${uid}"`).join(" ");

  let queryFields = ["?page-uid", "?page-title"];
  let queryWhere = `[?page :block/uid ?page-uid]
                    [(contains? #{${uidsClause}} ?page-uid)]
                    [?page :node/title ?page-title]`;

  if (includeMetadata) {
    queryFields.push("?created", "?modified");
    queryWhere += `\n                    [?page :create/time ?created]
                    [?page :edit/time ?modified]`;
  }

  const query = `[:find ${queryFields.join(" ")}
                  :where
                  ${queryWhere}]`;

  console.log(`🔍 Fetching details for ${pageUids.length} pages...`);
  const results = await executeDatomicQuery(query);

  return results.map((result) => {
    let index = 0;
    const pageDetail: any = {
      type: "page",
      pageUid: result[index++],
      pageTitle: result[index++],
      // Explicit type flag
      isPage: true,
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
  async (input, config) => {
    const startTime = performance.now();
    try {
      // Extract state from config
      const state = config?.configurable?.state;
      const results = await getNodeDetailsImpl(input, state);
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
