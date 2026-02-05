/**
 * Delete Block Tool
 *
 * Tool for deleting blocks in Roam Research.
 * Supports:
 * - Deleting a block by UID (also deletes all children)
 * - Two-call pattern: browse first (mode: "browse") to identify target block(s), then delete (mode: "delete")
 * - User confirmation with children count warning
 * - Batch mode: delete multiple blocks in a single call
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  getBlockContentByUid,
  isExistingBlock,
  deleteBlock,
  getTreeByUid,
  getParentBlock,
} from "../../../../utils/roamAPI";
import { resolveContainerUid, evaluateOutline } from "./outlineEvaluator";

/**
 * Counts the total number of descendant blocks in a tree.
 */
function countDescendants(tree: any): number {
  if (!tree) return 0;
  const root = Array.isArray(tree) ? tree[0] : tree;
  if (!root || !root[":block/children"]) return 0;

  let count = 0;
  const countChildren = (children: any[]) => {
    for (const child of children) {
      count++;
      if (child[":block/children"]) {
        countChildren(child[":block/children"]);
      }
    }
  };
  countChildren(root[":block/children"]);
  return count;
}

/**
 * Compute the depth of a block in the graph (number of ancestors).
 * Used to sort blocks deepest-first for batch deletion.
 */
function getBlockDepth(uid: string): number {
  let depth = 0;
  let current = uid;
  while (true) {
    const parent = getParentBlock(current);
    if (!parent) break;
    depth++;
    current = parent;
  }
  return depth;
}

/**
 * Build block info for confirmation preview.
 */
function getBlockDeletePreview(uid: string): {
  block_uid: string;
  content: string;
  descendant_count: number;
} {
  const content = getBlockContentByUid(uid);
  const tree = getTreeByUid(uid);
  const descendantCount = countDescendants(tree);
  return {
    block_uid: uid,
    content: content?.substring(0, 100) || "(empty)",
    descendant_count: descendantCount,
  };
}

/**
 * Execute a batch of delete operations sequentially.
 * Blocks are sorted deepest-first to avoid deleting parents before children
 * when multiple blocks in the same subtree are selected.
 */
async function executeBatchDelete(
  blockUids: string[],
  config: any,
): Promise<string> {
  // 1. Validate all UIDs upfront
  const valid: { uid: string; index: number }[] = [];
  const skipped: { index: number; uid: string; reason: string }[] = [];

  for (let i = 0; i < blockUids.length; i++) {
    const uid = blockUids[i];
    if (!uid || !/^[\w-]{9}$/.test(uid)) {
      skipped.push({ index: i, uid: uid || "(missing)", reason: "Invalid UID format" });
      continue;
    }
    if (!isExistingBlock(uid)) {
      skipped.push({ index: i, uid, reason: "Block not found" });
      continue;
    }
    valid.push({ uid, index: i });
  }

  if (valid.length === 0) {
    const skipDetails = skipped
      .map((s) => `  ${s.index + 1}. ((${s.uid})) - SKIPPED: ${s.reason}`)
      .join("\n");
    return `⚠️ Batch delete: all ${blockUids.length} operations were skipped.\n${skipDetails}`;
  }

  // 2. Get block info for confirmation preview
  const blockPreviews = valid.map(({ uid }) => getBlockDeletePreview(uid));
  const totalDescendants = blockPreviews.reduce(
    (sum, b) => sum + b.descendant_count,
    0,
  );

  // 3. Sort by depth (deepest first) to avoid parent-before-child deletion
  const withDepth = valid.map(({ uid, index }) => ({
    uid,
    index,
    depth: getBlockDepth(uid),
  }));
  withDepth.sort((a, b) => b.depth - a.depth);

  // 4. Confirmation
  const toolConfirmationCallback =
    config?.configurable?.toolConfirmationCallback;
  const alwaysApprovedTools = config?.configurable?.alwaysApprovedTools as
    | Set<string>
    | undefined;
  const isAlwaysApproved = alwaysApprovedTools?.has("delete_block");

  if (toolConfirmationCallback && !isAlwaysApproved) {
    const toolCallId = `delete_block_batch_${Date.now()}`;
    const confirmationResult = await toolConfirmationCallback({
      toolName: "delete_block",
      toolCallId,
      args: {
        operation_count: valid.length,
        total_descendants: totalDescendants,
        blocks: blockPreviews,
      },
    });

    if (!confirmationResult.approved) {
      const reason = confirmationResult.declineReason
        ? `\n\nUser's feedback: "${confirmationResult.declineReason}"`
        : "";
      return `⚠️ Batch block deletion was declined by the user.${reason}\n\nPlease ask the user if they'd like to proceed differently.`;
    }
  }

  // 5. Execute deletions sequentially (deepest first)
  const results: { index: number; uid: string; status: string }[] = [];

  for (const { uid, index } of withDepth) {
    try {
      // Re-check existence (may have been deleted as descendant of previous op)
      if (!isExistingBlock(uid)) {
        results.push({
          index,
          uid,
          status: "SKIPPED: Already deleted (was descendant of another deleted block)",
        });
        continue;
      }
      await deleteBlock(uid);
      const preview = blockPreviews.find((b) => b.block_uid === uid);
      let status = "Deleted";
      if (preview && preview.descendant_count > 0) {
        status += ` (${preview.descendant_count} descendants also removed)`;
      }
      results.push({ index, uid, status });
    } catch (error) {
      results.push({
        index,
        uid,
        status: `FAILED: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  // 6. Build result string (sorted by original index for readability)
  results.sort((a, b) => a.index - b.index);
  const succeeded = results.filter(
    (r) => !r.status.startsWith("FAILED") && !r.status.startsWith("SKIPPED"),
  );
  const failed = results.filter((r) => r.status.startsWith("FAILED"));
  const alreadyDeleted = results.filter((r) => r.status.startsWith("SKIPPED"));

  let output = `Batch delete results (${blockUids.length} operations):\n`;
  for (const r of results) {
    output += `  ${r.index + 1}. ((${r.uid})) - ${r.status}\n`;
  }
  for (const s of skipped) {
    output += `  ${s.index + 1}. ((${s.uid})) - SKIPPED: ${s.reason}\n`;
  }
  output += `Summary: ${succeeded.length} deleted, ${failed.length} failed, ${skipped.length + alreadyDeleted.length} skipped.`;

  return output;
}

export const deleteBlockTool = tool(
  async (
    input: {
      mode?: "browse" | "delete";
      block_uid?: string;
      parent_uid?: string;
      page_title?: string;
      date?: string;
      use_main_view?: boolean;
      batch_block_uids?: string[];
    },
    config,
  ) => {
    // === BATCH MODE ===
    if (input.batch_block_uids && input.batch_block_uids.length > 0) {
      console.log(
        "deleteBlockTool BATCH mode :>> ",
        input.batch_block_uids.length,
        "blocks",
      );
      return await executeBatchDelete(input.batch_block_uids, config);
    }

    const { mode, block_uid, parent_uid, page_title, date, use_main_view } = input;

    console.log("deleteBlockTool input :>> ", {
      mode,
      block_uid,
      parent_uid,
      page_title,
      use_main_view,
    });

    const llm = config?.configurable?.llm;

    // Use explicit mode flag to determine browse vs delete
    // Fallback: infer from block_uid presence (backwards compat)
    const isBrowseMode = mode === "browse" || (!mode && !block_uid);

    // === BROWSE MODE ===
    if (isBrowseMode) {
      // Default to main view if no location specified
      const useMainView = use_main_view || (!parent_uid && !page_title && !date);
      const resolved = await resolveContainerUid({ parent_uid, page_title, date, use_main_view: useMainView });
      if ("error" in resolved) {
        return `⚠️ ${resolved.error}`;
      }

      const evalResult = await evaluateOutline({
        containerUid: resolved.uid,
        llm,
        mode: "analyze_outline",
      });

      if (!evalResult || !evalResult.outlineContent) {
        return `📄 ${resolved.description} is empty. No blocks to delete.`;
      }

      const truncatedOutline =
        evalResult.outlineContent.length > 3000
          ? evalResult.outlineContent.substring(0, 3000) + "\n... (truncated)"
          : evalResult.outlineContent;

      return `📄 Outline of ${resolved.description}:\n\n${truncatedOutline}\n\nIdentify the block UID(s) you want to delete and call delete_block with mode "delete" and block_uid. To delete multiple blocks, use batch_block_uids.`;
    }

    // === DELETE MODE ===
    if (!block_uid) {
      return `⚠️ block_uid is required in "delete" mode. First call with mode "browse" to identify the target block, then call again with mode "delete" and block_uid.`;
    }

    // Validate UID format
    if (!/^[\w-]{9}$/.test(block_uid)) {
      return `⚠️ Invalid block_uid format: "${block_uid}". A valid Roam block UID is exactly 9 characters (alphanumeric and hyphens).`;
    }

    if (!isExistingBlock(block_uid)) {
      return `⚠️ Block with UID "${block_uid}" was not found in your graph.`;
    }

    // Get block info for structured confirmation preview
    const preview = getBlockDeletePreview(block_uid);

    // === CONFIRMATION FLOW (always required for deletion) ===
    const toolConfirmationCallback =
      config?.configurable?.toolConfirmationCallback;
    const alwaysApprovedTools = config?.configurable?.alwaysApprovedTools as
      | Set<string>
      | undefined;
    const isAlwaysApproved = alwaysApprovedTools?.has("delete_block");

    if (toolConfirmationCallback && !isAlwaysApproved) {
      const toolCallId = `delete_block_${Date.now()}`;

      const confirmationResult = await toolConfirmationCallback({
        toolName: "delete_block",
        toolCallId,
        args: {
          operation_count: 1,
          total_descendants: preview.descendant_count,
          blocks: [preview],
        },
      });

      if (!confirmationResult.approved) {
        const reason = confirmationResult.declineReason
          ? `\n\nUser's feedback: "${confirmationResult.declineReason}"`
          : "";
        return `⚠️ Block deletion was declined by the user.${reason}\n\nPlease ask the user if they'd like to proceed differently.`;
      }
    }

    try {
      await deleteBlock(block_uid);

      let result = `✅ Block ((${block_uid})) has been deleted.`;
      if (preview.descendant_count > 0) {
        result += ` (${preview.descendant_count} descendant block(s) were also removed)`;
      }
      return result;
    } catch (error) {
      console.error("Error deleting block:", error);
      return `Error: Failed to delete block. ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
    }
  },
  {
    name: "delete_block",
    description: `Delete blocks from Roam (and all their children). Uses explicit mode flag. Deletion is irreversible.

**PREFERRED: BATCH MODE** (use batch_block_uids array):
-> If the outline/page is already in your context, extract the 9-character UIDs directly from the ((uid)) references you can see, then provide an array of UIDs. No prior browse call needed. Blocks are automatically sorted deepest-first. A single confirmation covers the entire batch. Maximum 20 blocks.

**SINGLE BLOCK - TWO CALLS** (when UIDs are not in context):

**CALL 1 - BROWSE** (mode: "browse"):
-> Provide a container (page_title/parent_uid/date) to browse the outline and see block UIDs. If no location is specified, defaults to the user's currently open page/block in the main view.

**CALL 2 - DELETE** (mode: "delete" + block_uid):
-> Provide the block_uid to delete.

When the outline is already in your context (e.g., from add_to_context), skip Call 1 and go directly to batch_block_uids or Call 2 with the UIDs you can see.`,
    schema: z.object({
      mode: z
        .enum(["browse", "delete"])
        .optional()
        .describe(
          'Explicit mode flag. "browse": view outline to identify block UIDs. "delete": delete a block by UID. Not needed when using batch_block_uids.',
        ),
      block_uid: z
        .string()
        .optional()
        .describe(
          'The 9-character UID of the block to delete. Required in "delete" mode.',
        ),
      parent_uid: z
        .string()
        .optional()
        .describe(
          "UID of the container to browse the outline in browse mode.",
        ),
      page_title: z
        .string()
        .optional()
        .describe(
          "Page title to browse the outline in browse mode.",
        ),
      date: z
        .string()
        .optional()
        .describe(
          "Date for Daily Notes Page lookup in browse mode.",
        ),
      use_main_view: z
        .boolean()
        .optional()
        .describe(
          "Use the currently open page/block in the main view as the target. Defaults to true in browse mode if no other location is specified.",
        ),
      batch_block_uids: z
        .array(z.string())
        .max(20)
        .optional()
        .describe(
          "Array of block UIDs to delete in a single batch. Each must be a valid 9-character Roam block UID. All UIDs must be known from a prior analysis call. Blocks are automatically sorted deepest-first. A single confirmation covers the entire batch.",
        ),
    }),
  },
);
