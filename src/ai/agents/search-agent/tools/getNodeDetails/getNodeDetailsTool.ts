import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { extractUidsFromResults } from "../../helpers/searchUtils";
import { createToolResult } from "../../helpers/semanticExpansion";
import { schema } from "./schemas";
import { fetchBlockDetails, fetchPageDetails } from "./executors";
import { updateAgentToaster } from "../../../shared/agentsUtils";

/**
 * Get detailed information about specific nodes (blocks or pages)
 * Security Level: Content (includes full content when requested)
 *
 * This tool fetches detailed information about specific nodes when needed,
 * allowing other tools to return minimal data and fetch details on demand.
 */

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

  updateAgentToaster(`✅ Get Details: Retrieved details for ${allResults.length} nodes`);

  console.log(`📊 Returning details for ${allResults.length} nodes`);
  return allResults;
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