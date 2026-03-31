/**
 * Run SmartBlock Tool
 *
 * Tool for triggering SmartBlock workflows defined in the user's Roam graph.
 * Uses the roamjs SmartBlocks extension API to run workflows by name or UID,
 * targeting a specific page or block.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { parseISODateLocal } from "./dateUtils";
import { getDNPTitleFromDate, getPageUidByPageName } from "../../../../utils/roamAPI";

/**
 * Check if a SmartBlock with the given name exists in the graph.
 * SmartBlocks are blocks that reference the [[roam/js/smartblocks]] page
 * (or simply contain "SmartBlock" page ref) and have a matching name.
 */
function findSmartBlock(
  srcName: string,
): { found: boolean; uid?: string; name?: string } {
  const roamAPI = (window as any).roamAlphaAPI;
  if (!roamAPI?.q) {
    return { found: false };
  }

  // Search for blocks whose string matches the srcName and that reference the SmartBlock page
  // SmartBlocks are typically: "workflow name #SmartBlock" or children of SmartBlock-tagged blocks
  const results = roamAPI.q(
    `[:find ?uid ?str
      :where
      [?sb :node/title "roam/js/smartblocks"]
      [?b :block/refs ?sb]
      [?b :block/uid ?uid]
      [?b :block/string ?str]
      [(clojure.string/includes? ?str "${srcName.replace(/"/g, '\\"')}")]]`,
  );

  if (results && results.length > 0) {
    return { found: true, uid: results[0][0], name: results[0][1] };
  }

  // Also try searching with just "SmartBlock" page reference
  const altResults = roamAPI.q(
    `[:find ?uid ?str
      :where
      [?sb :node/title "SmartBlock"]
      [?b :block/refs ?sb]
      [?b :block/uid ?uid]
      [?b :block/string ?str]
      [(clojure.string/includes? ?str "${srcName.replace(/"/g, '\\"')}")]]`,
  );

  if (altResults && altResults.length > 0) {
    return { found: true, uid: altResults[0][0], name: altResults[0][1] };
  }

  return { found: false };
}

/**
 * Resolve the target page name from a date parameter.
 * Converts ISO date to DNP title and creates the page if it doesn't exist.
 * Returns the resolved page title or an error message.
 */
async function resolveTargetFromDate(
  date: string,
): Promise<{ targetName: string } | { error: string }> {
  const dateObj = parseISODateLocal(date);
  if (!dateObj) {
    return {
      error: `Invalid date format: "${date}". Please provide an ISO date (YYYY-MM-DD format, e.g., "2024-01-15").`,
    };
  }

  const dnpTitle = getDNPTitleFromDate(dateObj);

  // Check if the DNP page exists
  const pageUid = getPageUidByPageName(dnpTitle);
  if (pageUid) {
    return { targetName: dnpTitle };
  }

  // DNP doesn't exist yet — create it
  try {
    const roamAPI = (window as any).roamAlphaAPI;
    const dnpUid = roamAPI.util.dateToPageUid(dateObj);
    await roamAPI.createPage({ page: { title: dnpTitle, uid: dnpUid } });
    console.log(`Created DNP "${dnpTitle}" with UID: ${dnpUid}`);
    return { targetName: dnpTitle };
  } catch (err) {
    console.error("Error creating DNP:", err);
    return {
      error: `Page "${dnpTitle}" was not found and could not be created. ${err instanceof Error ? err.message : ""}`,
    };
  }
}

export const runSmartBlockTool = tool(
  async (
    input: {
      src_name?: string;
      src_uid?: string;
      target_name?: string;
      target_uid?: string;
      date?: string;
      variables?: Record<string, string>;
    },
    config,
  ) => {
    const { src_name, src_uid, target_uid, variables } = input;
    let { target_name, date } = input;

    console.log("runSmartBlockTool input :>> ", {
      src_name,
      src_uid,
      target_name,
      target_uid,
      date,
      variables,
    });

    // Validate: at least one source identifier
    if (!src_name && !src_uid) {
      return "⚠️ Either src_name (SmartBlock workflow name) or src_uid (block UID) must be provided.";
    }

    // Validate: at least one target identifier
    if (!target_name && !target_uid && !date) {
      return "⚠️ Either target_name (page title), target_uid (block UID), or date (ISO format) must be provided.";
    }

    // Check if SmartBlocks extension is available
    const smartblocks = (window as any).roamjs?.extension?.smartblocks;
    if (!smartblocks?.triggerSmartblock) {
      return "❌ SmartBlocks extension is not installed or not loaded. Please install the roamjs SmartBlocks extension to use this tool.";
    }

    // Verify the SmartBlock exists if searching by name
    if (src_name) {
      const found = findSmartBlock(src_name);
      if (!found.found) {
        return `⚠️ No SmartBlock workflow named "${src_name}" was found in your graph. Please verify the name. SmartBlocks are blocks that reference the [[roam/js/smartblocks]] page.`;
      }
    }

    // Resolve date to DNP title if provided (takes priority over target_name)
    if (date && !target_uid) {
      const resolved = await resolveTargetFromDate(date);
      if ("error" in resolved) {
        return `⚠️ ${resolved.error}`;
      }
      target_name = resolved.targetName;
    }

    // If target_name provided, verify the page exists
    if (target_name && !target_uid) {
      const pageUid = getPageUidByPageName(target_name);
      if (!pageUid) {
        return `⚠️ Page "${target_name}" was not found in your graph. Please verify the page title.`;
      }
    }

    // If target_uid provided, verify it exists
    if (target_uid) {
      const roamAPI = (window as any).roamAlphaAPI;
      const exists = roamAPI?.data?.pull("[:block/uid]", [
        ":block/uid",
        target_uid,
      ]);
      if (!exists) {
        return `⚠️ Block with UID "${target_uid}" was not found. Please verify the UID exists in your graph.`;
      }
    }

    // === CONFIRMATION FLOW ===
    const toolConfirmationCallback =
      config?.configurable?.toolConfirmationCallback;
    const alwaysApprovedTools = config?.configurable?.alwaysApprovedTools as
      | Set<string>
      | undefined;
    const isAlwaysApproved = alwaysApprovedTools?.has("run_smartblock");

    if (toolConfirmationCallback && !isAlwaysApproved) {
      const toolCallId = `run_smartblock_${Date.now()}`;

      const confirmationResult = await toolConfirmationCallback({
        toolName: "run_smartblock",
        toolCallId,
        args: {
          src_name,
          src_uid,
          target_name,
          target_uid,
          date,
          variables,
        },
      });

      if (!confirmationResult.approved) {
        const reason = confirmationResult.declineReason
          ? `\n\nUser's feedback: "${confirmationResult.declineReason}"`
          : "";
        return `⚠️ SmartBlock execution was declined by the user.${reason}`;
      }
    }

    try {
      // Build the trigger parameters
      const triggerParams: Record<string, any> = {};

      if (src_name) triggerParams.srcName = src_name;
      if (src_uid) triggerParams.srcUid = src_uid;
      if (target_name) triggerParams.targetName = target_name;
      if (target_uid) triggerParams.targetUid = target_uid;
      if (variables) triggerParams.variables = variables;

      const targetDesc = target_name ? `[[${target_name}]]` : `((${target_uid}))`;
      const result = await smartblocks.triggerSmartblock(triggerParams);

      if (result === 0) {
        return `✅ SmartBlock "${src_name || src_uid}" executed successfully on ${targetDesc}. No blocks were outputted.`;
      }

      if (typeof result === "string") {
        return `✅ SmartBlock "${src_name || src_uid}" executed successfully on ${targetDesc}. First output block: ((${result}))`;
      }

      return `✅ SmartBlock "${src_name || src_uid}" executed on ${targetDesc}.`;
    } catch (error) {
      console.error("Error running SmartBlock:", error);
      return `❌ Failed to run SmartBlock. ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
    }
  },
  {
    name: "run_smartblock",
    description: `Trigger a SmartBlock workflow defined in the user's Roam graph. SmartBlocks are automated workflows created with the roamjs SmartBlocks extension. Users may refer to SmartBlocks as "Sb" or "SB" (e.g., "run Sb Daily" means "run the SmartBlock named Daily").

Provide either src_name (workflow name) or src_uid (block UID) to identify the SmartBlock.
For the target location, provide one of: target_name (page title), target_uid (block UID), or date (ISO format for Daily Notes Pages).

IMPORTANT: When the user mentions "today", "today's page", "today's DNP", "tomorrow", "yesterday", or any relative/absolute date as a target, you MUST use the "date" parameter with the resolved ISO date (YYYY-MM-DD) from the current date provided in the system prompt. Do NOT pass a page title like "April 1st, 2026" — use date: "2026-04-01" instead.
Optionally pass variables accessible by variable-related SmartBlock commands.

The tool verifies the SmartBlock exists before running and requires user confirmation.`,
    schema: z.object({
      src_name: z
        .string()
        .optional()
        .describe(
          "The name of the SmartBlock workflow to trigger. Either src_name or src_uid must be provided.",
        ),
      src_uid: z
        .string()
        .optional()
        .describe(
          "The block UID of the SmartBlock workflow to trigger. Either src_name or src_uid must be provided.",
        ),
      target_name: z
        .string()
        .optional()
        .describe(
          "The title of the page where the SmartBlock will run. By default, content is added at the bottom of the page. Use this for regular pages. For Daily Notes Pages, prefer the 'date' parameter.",
        ),
      target_uid: z
        .string()
        .optional()
        .describe(
          "The block UID where the SmartBlock will run. Use when targeting a specific block rather than a page.",
        ),
      date: z
        .string()
        .optional()
        .describe(
          "ISO date format (YYYY-MM-DD) to target a Daily Notes Page. MUST be used whenever the user mentions 'today', 'today's page', 'today's DNP', 'tomorrow', 'yesterday', or any date expression. Convert relative dates using the current date from the system prompt. Example: if today is 2026-04-01 and user says 'today', use '2026-04-01'. The DNP will be created if it doesn't exist.",
        ),
      variables: z
        .record(z.string())
        .optional()
        .describe(
          "Key-value pairs of variables to define at the start of the workflow, accessible by variable-related SmartBlock commands.",
        ),
    }),
  },
);
