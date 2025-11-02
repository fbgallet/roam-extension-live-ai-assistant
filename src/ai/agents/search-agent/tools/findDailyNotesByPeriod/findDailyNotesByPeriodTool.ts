import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { schema, llmFacingSchema } from "./schemas";
import {
  generateDNPUidsForRange,
  queryDNPsByUids,
  filterResultsByDateRange,
} from "./executors";
import { withAutomaticExpansion } from "../../helpers/semanticExpansion";
import { updateAgentToaster } from "../../../shared/agentsUtils";

/**
 * Find Daily Notes Pages by time period
 * Security Level: Secure (only accesses UIDs, titles, metadata)
 */

export const findDailyNotesByPeriodImpl = async (
  input: z.infer<typeof schema>
): Promise<any[]> => {
  const { timeRange, limit } = input;

  // Parse dates
  const startDate =
    typeof timeRange.start === "string"
      ? new Date(timeRange.start)
      : timeRange.start;
  const endDate =
    typeof timeRange.end === "string" ? new Date(timeRange.end) : timeRange.end;

  // Validate dates
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Error(
      "Invalid date format. Please use YYYY-MM-DD format or Date objects."
    );
  }

  if (startDate > endDate) {
    throw new Error("Start date must be before or equal to end date.");
  }

  updateAgentToaster(
    `🔍 Daily Notes Search: Finding daily notes from ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}...`
  );

  console.log(
    `🗓️ [findDailyNotesByPeriod] Searching DNPs from ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`
  );

  // Step 1: Generate all DNP UIDs in the range
  const dnpUids = generateDNPUidsForRange(startDate, endDate);

  console.log(
    `📋 [findDailyNotesByPeriod] Generated ${dnpUids.length} DNP UIDs to query`
  );

  // Step 2: Query Datomic for these DNPs (efficient batch query)
  let results = await queryDNPsByUids(dnpUids, timeRange.filterMode || "modified");

  console.log(
    `✅ [findDailyNotesByPeriod] Found ${results.length} existing DNPs in database`
  );

  // Step 3: Filter by date range if filterMode is specified
  if (timeRange.filterMode) {
    const originalCount = results.length;
    results = filterResultsByDateRange(
      results,
      startDate,
      endDate,
      timeRange.filterMode
    );
    console.log(
      `🔍 [findDailyNotesByPeriod] Filtered by ${timeRange.filterMode} date: ${results.length}/${originalCount} DNPs match`
    );
  }

  // Sort by date (most recent first)
  results.sort((a, b) => {
    const dateA = a.modified || a.created;
    const dateB = b.modified || b.created;
    return dateB.getTime() - dateA.getTime();
  });

  // Apply limit
  const limitedResults = results.slice(0, limit);

  updateAgentToaster(`✅ Daily Notes Search: Found ${limitedResults.length} daily note pages`);

  console.log(
    `🎉 [findDailyNotesByPeriod] Returning ${limitedResults.length} DNP pages (out of ${results.length} total)`
  );

  return limitedResults;
};

export const findDailyNotesByPeriodTool = tool(
  async (input: z.infer<typeof llmFacingSchema>, config) => {
    return withAutomaticExpansion(
      "findDailyNotesByPeriod",
      findDailyNotesByPeriodImpl,
      input as z.infer<typeof schema>,
      config
    );
  },
  {
    name: "findDailyNotesByPeriod",
    description:
      "Find Daily Notes Pages (DNPs) within a specific time period. Efficiently queries all DNPs between start and end dates using batch Datomic queries. Returns ONLY the DNP pages themselves (not their content). Supports filtering by creation or modification date. Perfect for temporal queries like 'daily notes from last week', 'DNPs in January 2024', or 'recent daily note pages'.",
    schema: llmFacingSchema,
  }
);
