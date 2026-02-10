/**
 * Update Block Tool
 *
 * Tool for updating, moving, and modifying blocks in Roam Research.
 * Supports:
 * - Updating block content (text)
 * - Changing block properties (heading level, open/collapsed state)
 * - Moving a block to a new parent with order control
 * - Smart move using LLM to find best location in destination
 * - Two-call pattern: browse first (mode: "browse") to identify target block(s), then apply (mode: "apply")
 * - Batch mode: update multiple blocks in a single call
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  getBlockContentByUid,
  isExistingBlock,
  updateBlock,
  moveBlock,
  hasBlockChildren,
  getParentBlock,
  getOrderedDirectChildren,
  getTreeByUid,
  getPageNameByPageUid,
} from "../../../../utils/roamAPI";
import { resolveContainerUid, evaluateOutline } from "./outlineEvaluator";

/**
 * Truncate text to a maximum length, adding ellipsis if needed.
 */
function truncateText(text: string, maxLength: number): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

/**
 * Normalize a new_order value from LLM input.
 * LLMs sometimes send "" for optional fields; treat as "last".
 */
function normalizeOrder(
  value: "first" | "last" | "" | number | undefined,
): "first" | "last" | number {
  if (value === "first" || value === "last") return value;
  if (typeof value === "number") return value;
  return "last";
}

/**
 * Fetch current block state for confirmation preview.
 * Returns an object with current content, heading, open state, and position context.
 */
function getBlockPreviewState(blockUid: string): {
  current_content: string;
  current_heading?: number;
  current_open?: boolean;
  position_context?: string;
} {
  const content = getBlockContentByUid(blockUid);
  const tree = getTreeByUid(blockUid);
  const blockData = Array.isArray(tree) ? tree[0] : tree;

  const state: ReturnType<typeof getBlockPreviewState> = {
    current_content: content || "(empty)",
  };

  if (blockData) {
    if (":block/heading" in blockData)
      state.current_heading = blockData[":block/heading"] || 0;
    if (":block/open" in blockData)
      state.current_open = blockData[":block/open"] !== false;
  }

  // Get position context: parent + surrounding siblings
  const parentUid = getParentBlock(blockUid);
  if (parentUid) {
    const parentPageName = getPageNameByPageUid(parentUid);
    const parentContent = parentPageName ? null : getBlockContentByUid(parentUid);
    const siblings = getOrderedDirectChildren(parentUid);
    if (siblings) {
      const idx = siblings.findIndex(
        (s: { uid: string }) => s.uid === blockUid,
      );
      const prev =
        idx > 0
          ? siblings[idx - 1].string?.substring(0, 40)
          : null;
      const next =
        idx < siblings.length - 1
          ? siblings[idx + 1].string?.substring(0, 40)
          : null;
      let ctx = parentPageName
        ? `top-level on [[${parentPageName}]]`
        : `under "${parentContent?.substring(0, 50) || "(empty)"}"`;
      if (prev || next) {
        ctx += ` (between ${prev ? `"${prev}"` : "start"} | ${next ? `"${next}"` : "end"})`;
      }
      state.position_context = ctx;
    }
  }

  return state;
}

/**
 * Build a single operation preview for the confirmation dialog.
 */
function buildOperationPreview(
  blockUid: string,
  op: {
    new_content?: string;
    heading?: number;
    open?: boolean;
    new_parent_uid?: string;
    new_parent_page_title?: string;
    new_order?: "first" | "last" | "" | number;
    smart_move?: boolean;
  },
): Record<string, any> {
  const state = getBlockPreviewState(blockUid);
  const preview: Record<string, any> = {
    block_uid: blockUid,
    current_content: state.current_content,
  };

  if (state.position_context) {
    preview.position_context = state.position_context;
  }

  if (op.new_content !== undefined && op.new_content !== state.current_content) {
    preview.new_content = op.new_content;
  }
  if (op.heading !== undefined && op.heading !== (state.current_heading ?? 0)) {
    preview.current_heading = state.current_heading ?? 0;
    preview.new_heading = op.heading;
  }
  if (op.open !== undefined && op.open !== (state.current_open ?? true)) {
    preview.current_open = state.current_open ?? true;
    preview.new_open = op.open;
  }
  if (op.new_parent_uid || op.new_parent_page_title) {
    preview.move_from = state.position_context || "unknown position";
    const dest = op.new_parent_page_title || `((${op.new_parent_uid}))`;
    const pos = op.new_order ?? "last";
    preview.move_to = `${dest} (position: ${pos})${op.smart_move ? " [smart]" : ""}`;
  }

  return preview;
}

interface BatchOperation {
  block_uid: string;
  new_content?: string;
  heading?: 0 | 1 | 2 | 3;
  open?: boolean;
  new_parent_uid?: string;
  new_parent_page_title?: string;
  new_order?: "first" | "last" | "" | number;
  smart_move?: boolean;
}

/**
 * Execute a batch of update operations sequentially.
 */
async function executeBatchUpdate(
  operations: BatchOperation[],
  config: any,
): Promise<string> {
  const llm = config?.configurable?.llm;

  // 1. Validate all UIDs upfront
  const valid: { op: BatchOperation; index: number }[] = [];
  const skipped: { index: number; uid: string; reason: string }[] = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (!op.block_uid || !/^[\w-]{9}$/.test(op.block_uid)) {
      skipped.push({
        index: i,
        uid: op.block_uid || "(missing)",
        reason: "Invalid UID format",
      });
      continue;
    }
    if (!isExistingBlock(op.block_uid)) {
      skipped.push({
        index: i,
        uid: op.block_uid,
        reason: "Block not found",
      });
      continue;
    }
    // Normalize empty strings to undefined
    if (op.new_content === "") op.new_content = undefined;
    if (op.new_parent_uid === "") op.new_parent_uid = undefined;
    if (op.new_parent_page_title === "") op.new_parent_page_title = undefined;

    // Guard: reject content that looks like a tree/outline dumped into one block
    if (op.new_content && /\n\s+[-*]/.test(op.new_content)) {
      skipped.push({
        index: i,
        uid: op.block_uid,
        reason:
          "new_content appears to contain a tree/outline with children. Each block must be updated individually with its own block_uid. Do not merge multiple blocks into one.",
      });
      continue;
    }

    // Normalize heading/open by comparing to current block state
    // LLMs send heading: 0, open: true as defaults — strip if unchanged
    const currentState = getBlockPreviewState(op.block_uid);
    if (
      op.heading !== undefined &&
      op.heading === (currentState.current_heading ?? 0)
    ) {
      op.heading = undefined;
    }
    if (
      op.open !== undefined &&
      op.open === (currentState.current_open ?? true)
    ) {
      op.open = undefined;
    }

    // Check that at least one mutation field is present after normalization
    const hasMutation =
      op.new_content !== undefined ||
      op.heading !== undefined ||
      op.open !== undefined ||
      op.new_parent_uid !== undefined ||
      op.new_parent_page_title !== undefined;
    if (!hasMutation) {
      skipped.push({
        index: i,
        uid: op.block_uid,
        reason: "No mutation fields provided",
      });
      continue;
    }
    valid.push({ op, index: i });
  }

  if (valid.length === 0) {
    const skipDetails = skipped
      .map((s) => `  ${s.index + 1}. ((${s.uid})) - SKIPPED: ${s.reason}`)
      .join("\n");
    return `⚠️ Batch update: all ${operations.length} operations were skipped.\n${skipDetails}`;
  }

  // 2. Build confirmation preview for all valid operations
  const operationPreviews = valid.map(({ op }) =>
    buildOperationPreview(op.block_uid, op),
  );

  // 3. Confirmation
  const toolConfirmationCallback =
    config?.configurable?.toolConfirmationCallback;
  const alwaysApprovedTools = config?.configurable?.alwaysApprovedTools as
    | Set<string>
    | undefined;
  const isAlwaysApproved = alwaysApprovedTools?.has("update_block");

  if (toolConfirmationCallback && !isAlwaysApproved) {
    const toolCallId = `update_block_batch_${Date.now()}`;
    const confirmationResult = await toolConfirmationCallback({
      toolName: "update_block",
      toolCallId,
      args: {
        operation_count: valid.length,
        operations: operationPreviews,
      },
    });

    if (!confirmationResult.approved) {
      const reason = confirmationResult.declineReason
        ? `\n\nUser's feedback: "${confirmationResult.declineReason}"`
        : "";
      return `⚠️ Batch block update was declined by the user.${reason}\n\nPlease ask the user what changes they'd like you to make, or if they'd like to proceed differently.`;
    }
  }

  // 4. Execute operations sequentially
  const results: { index: number; uid: string; status: string }[] = [];

  for (const { op, index } of valid) {
    try {
      const parts: string[] = [];

      // Content / format update
      if (
        op.new_content !== undefined ||
        op.heading !== undefined ||
        op.open !== undefined
      ) {
        const format: Record<string, any> = {};
        if (op.heading !== undefined) format.heading = op.heading;
        if (op.open !== undefined) format.open = op.open;

        await updateBlock({
          blockUid: op.block_uid,
          newContent: op.new_content,
          format,
        });

        if (op.new_content !== undefined) parts.push("content");
        if (op.heading !== undefined)
          parts.push(`heading (H${op.heading === 0 ? "none" : op.heading})`);
        if (op.open !== undefined)
          parts.push(`state (${op.open ? "expanded" : "collapsed"})`);
      }

      // Move
      if (op.new_parent_uid || op.new_parent_page_title) {
        let destUid: string | null = op.new_parent_uid || null;

        if (!destUid && op.new_parent_page_title) {
          const resolved = await resolveContainerUid({
            page_title: op.new_parent_page_title,
          });
          if ("error" in resolved) {
            results.push({
              index,
              uid: op.block_uid,
              status: `FAILED: Move - ${resolved.error}`,
            });
            continue;
          }
          destUid = resolved.uid;
        }

        if (!destUid) {
          results.push({
            index,
            uid: op.block_uid,
            status: "FAILED: Could not resolve move destination",
          });
          continue;
        }

        let finalDestUid = destUid;
        let finalOrder: "first" | "last" | number = normalizeOrder(op.new_order);

        if (op.smart_move && llm) {
          const currentContent =
            op.new_content !== undefined
              ? op.new_content
              : getBlockContentByUid(op.block_uid) || "";
          const evalResult = await evaluateOutline({
            containerUid: destUid,
            llm,
            mode: "find_insertion_location",
            contentToInsert: currentContent,
          });
          if (evalResult?.location) {
            finalDestUid = evalResult.location.parentUid;
            finalOrder = evalResult.location.order;
          }
        }

        moveBlock({
          blockUid: op.block_uid,
          targetParentUid: finalDestUid,
          order: finalOrder,
        });

        const moveDesc = op.new_parent_page_title
          ? `[[${op.new_parent_page_title}]]`
          : `((${finalDestUid}))`;
        parts.push(`moved to ${moveDesc} at position ${finalOrder}`);
      }

      results.push({
        index,
        uid: op.block_uid,
        status: `Updated ${parts.join(", ")}`,
      });
    } catch (error) {
      results.push({
        index,
        uid: op.block_uid,
        status: `FAILED: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  // 5. Build result string
  const succeeded = results.filter((r) => !r.status.startsWith("FAILED"));
  const failed = results.filter((r) => r.status.startsWith("FAILED"));

  let output = `Batch update results (${operations.length} operations):\n`;
  for (const r of results) {
    const content = getBlockContentByUid(r.uid);
    const contentPreview = content ? `"${truncateText(content, 40)}" ` : "";
    output += `  ${r.index + 1}. ${contentPreview}((${r.uid})) - ${r.status}\n`;
  }
  for (const s of skipped) {
    output += `  ${s.index + 1}. ((${s.uid})) - SKIPPED: ${s.reason}\n`;
  }
  output += `Summary: ${succeeded.length} succeeded, ${failed.length} failed, ${skipped.length} skipped.`;

  return output;
}

export const updateBlockTool = tool(
  async (
    input: {
      mode?: "browse" | "apply";
      block_uid?: string;
      parent_uid?: string;
      page_title?: string;
      date?: string;
      use_main_view?: boolean;
      new_content?: string;
      heading?: 0 | 1 | 2 | 3;
      open?: boolean;
      new_parent_uid?: string;
      new_parent_page_title?: string;
      new_order?: "first" | "last" | number;
      smart_move?: boolean;
      batch_operations?: BatchOperation[];
    },
    config,
  ) => {
    // === BATCH MODE ===
    if (input.batch_operations && input.batch_operations.length > 0) {
      console.log(
        "updateBlockTool BATCH mode :>> ",
        input.batch_operations.length,
        "operations",
      );
      return await executeBatchUpdate(input.batch_operations, config);
    }

    const {
      mode,
      block_uid,
      parent_uid,
      page_title,
      date,
      use_main_view,
      new_content,
      heading,
      open,
      new_parent_uid,
      new_parent_page_title,
      new_order: rawNewOrder,
      smart_move = false,
    } = input;
    const new_order = normalizeOrder(rawNewOrder);

    console.log("updateBlockTool input :>> ", {
      mode,
      block_uid,
      parent_uid,
      page_title,
      use_main_view,
      new_content: new_content?.substring(0, 100),
      heading,
      open,
      new_parent_uid,
      new_parent_page_title,
      new_order,
      smart_move,
    });

    const llm = config?.configurable?.llm;

    // Normalize empty strings to undefined (LLMs often send "" for omitted fields)
    const effectiveNewContent =
      new_content !== undefined && new_content !== "" ? new_content : undefined;
    const effectiveHeading = heading;
    const effectiveOpen = open;
    const effectiveNewParentUid =
      new_parent_uid && new_parent_uid !== "" ? new_parent_uid : undefined;
    const effectiveNewParentPageTitle =
      new_parent_page_title && new_parent_page_title !== ""
        ? new_parent_page_title
        : undefined;

    // Use explicit mode flag to determine browse vs apply
    // Fallback: infer from presence of mutation fields (backwards compat for edge cases)
    const hasMutationFields =
      effectiveNewContent !== undefined ||
      effectiveHeading !== undefined ||
      effectiveOpen !== undefined ||
      effectiveNewParentUid !== undefined ||
      effectiveNewParentPageTitle !== undefined;
    const isBrowseMode = mode === "browse" || (!mode && !hasMutationFields);

    // === BROWSE MODE ===
    if (isBrowseMode) {
      // If block_uid is provided, return its current content and context
      if (block_uid) {
        if (!isExistingBlock(block_uid)) {
          return `⚠️ Block with UID "${block_uid}" was not found in your graph.`;
        }
        const content = getBlockContentByUid(block_uid);
        const hasChildren = hasBlockChildren(block_uid);
        const contentPreview = truncateText(content || "(empty)", 100);
        return `📄 Block "${contentPreview}" ((${block_uid}))\nHas children: ${hasChildren ? "yes" : "no"}\n\nYou can now call update_block with mode "apply", block_uid, and the fields you want to change. To update multiple blocks at once, use batch_operations.`;
      }

      // Return container outline for browsing
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
        return `📄 ${resolved.description} is empty. No blocks to update.`;
      }

      const truncatedOutline =
        evalResult.outlineContent.length > 3000
          ? evalResult.outlineContent.substring(0, 3000) + "\n... (truncated)"
          : evalResult.outlineContent;

      return `📄 Outline of ${resolved.description}:\n\n${truncatedOutline}\n\nIdentify the block UID(s) you want to update and call update_block with mode "apply" and block_uid + changes. To update multiple blocks at once, use batch_operations.`;
    }

    // === APPLY MODE (single block) ===
    if (!block_uid) {
      return `⚠️ block_uid is required in "apply" mode. First call with mode "browse" to identify the target block, then call again with mode "apply", block_uid, and the desired changes.`;
    }

    // Validate UID format
    if (!/^[\w-]{9}$/.test(block_uid)) {
      return `⚠️ Invalid block_uid format: "${block_uid}". A valid Roam block UID is exactly 9 characters (alphanumeric and hyphens).`;
    }

    if (!isExistingBlock(block_uid)) {
      return `⚠️ Block with UID "${block_uid}" was not found in your graph.`;
    }

    // Build structured confirmation preview (using effective values)
    const preview = buildOperationPreview(block_uid, {
      new_content: effectiveNewContent,
      heading: effectiveHeading,
      open: effectiveOpen,
      new_parent_uid: effectiveNewParentUid,
      new_parent_page_title: effectiveNewParentPageTitle,
      new_order,
      smart_move,
    });

    // === CONFIRMATION FLOW ===
    const toolConfirmationCallback =
      config?.configurable?.toolConfirmationCallback;
    const alwaysApprovedTools = config?.configurable?.alwaysApprovedTools as
      | Set<string>
      | undefined;
    const isAlwaysApproved = alwaysApprovedTools?.has("update_block");

    if (toolConfirmationCallback && !isAlwaysApproved) {
      const toolCallId = `update_block_${Date.now()}`;

      const confirmationResult = await toolConfirmationCallback({
        toolName: "update_block",
        toolCallId,
        args: {
          operation_count: 1,
          operations: [preview],
        },
      });

      if (!confirmationResult.approved) {
        const reason = confirmationResult.declineReason
          ? `\n\nUser's feedback: "${confirmationResult.declineReason}"`
          : "";
        return `⚠️ Block update was declined by the user.${reason}\n\nPlease ask the user what changes they'd like you to make, or if they'd like to proceed differently.`;
      }
    }

    try {
      const results: string[] = [];

      // --- Content / format update ---
      if (
        effectiveNewContent !== undefined ||
        effectiveHeading !== undefined ||
        effectiveOpen !== undefined
      ) {
        const format: Record<string, any> = {};
        if (effectiveHeading !== undefined) format.heading = effectiveHeading;
        if (effectiveOpen !== undefined) format.open = effectiveOpen;

        await updateBlock({
          blockUid: block_uid,
          newContent: effectiveNewContent,
          format,
        });

        const updatedParts: string[] = [];
        if (effectiveNewContent !== undefined) updatedParts.push("content");
        if (effectiveHeading !== undefined)
          updatedParts.push(
            `heading (H${effectiveHeading === 0 ? "none" : effectiveHeading})`,
          );
        if (effectiveOpen !== undefined)
          updatedParts.push(`state (${effectiveOpen ? "expanded" : "collapsed"})`);
        results.push(`Updated ${updatedParts.join(", ")}`);
      }

      // --- Move block ---
      if (effectiveNewParentUid || effectiveNewParentPageTitle) {
        // Resolve destination
        let destUid: string | null = effectiveNewParentUid || null;

        if (!destUid && effectiveNewParentPageTitle) {
          const resolved = await resolveContainerUid({
            page_title: effectiveNewParentPageTitle,
          });
          if ("error" in resolved) {
            return `⚠️ Move failed: ${resolved.error}`;
          }
          destUid = resolved.uid;
        }

        if (!destUid) {
          return "⚠️ Move failed: could not resolve destination.";
        }

        // Validate destination UID format
        if (effectiveNewParentUid && !/^[\w-]{9}$/.test(effectiveNewParentUid)) {
          return `⚠️ Invalid new_parent_uid format: "${effectiveNewParentUid}". A valid Roam block UID is exactly 9 characters.`;
        }

        let finalDestUid = destUid;
        let finalOrder: "first" | "last" | number = new_order;

        // Smart move: use LLM to find best location in destination
        if (smart_move) {
          if (!llm) {
            return "⚠️ Smart move requested but no LLM is available. Please provide explicit new_parent_uid and new_order instead.";
          }

          const currentContent =
            effectiveNewContent !== undefined
              ? effectiveNewContent
              : getBlockContentByUid(block_uid) || "";
          const evalResult = await evaluateOutline({
            containerUid: destUid,
            llm,
            mode: "find_insertion_location",
            contentToInsert: currentContent,
          });

          if (evalResult?.location) {
            finalDestUid = evalResult.location.parentUid;
            finalOrder = evalResult.location.order;
          }
        }

        moveBlock({
          blockUid: block_uid,
          targetParentUid: finalDestUid,
          order: finalOrder,
        });

        let moveDesc: string;
        if (effectiveNewParentPageTitle && finalDestUid === destUid) {
          moveDesc = `[[${effectiveNewParentPageTitle}]]`;
        } else {
          // Show parent block content for context
          const destContent = getBlockContentByUid(finalDestUid);
          moveDesc = destContent
            ? `"${truncateText(destContent, 50)}" ((${finalDestUid}))`
            : `((${finalDestUid}))`;
        }
        if (smart_move && finalDestUid !== destUid) {
          moveDesc += " (smart move)";
        }
        results.push(`Moved to ${moveDesc} at position ${finalOrder}`);
      }

      // Get updated content for feedback
      const updatedContent = getBlockContentByUid(block_uid);
      const contentPreview = truncateText(updatedContent || "(empty)", 60);
      return `✅ Block "${contentPreview}" ((${block_uid})) updated successfully.\n${results.join("\n")}`;
    } catch (error) {
      console.error("Error updating block:", error);
      return `Error: Failed to update block. ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
    }
  },
  {
    name: "update_block",
    description: `Update, modify, or move existing blocks in Roam. Uses explicit mode flag to control behavior.

**IMPORTANT**: Each operation targets ONE INDIVIDUAL BLOCK by its 9-character UID. Never combine multiple blocks' content into a single operation. Each block in Roam has its own UID — update each one separately with only the fields that actually change for that block.

**PREFERRED: BATCH MODE** (use batch_operations array):
-> Extract the 9-character UIDs from ((uid)) references in your context. Provide an array where EACH item targets a DIFFERENT block_uid with ONLY the fields that change for that specific block. Omit fields you don't want to change (don't send heading: 0 or open: true as defaults). Maximum 20 operations.

**SINGLE BLOCK - TWO CALLS** (when UIDs are not in context):

**CALL 1 - BROWSE** (mode: "browse"):
-> Provide a container (page_title/parent_uid/date) to browse the outline and see block UIDs. If no location is specified, defaults to the user's currently open page/block in the main view.

**CALL 2 - APPLY** (mode: "apply" + block_uid + mutation fields):
-> Provide block_uid with ONLY the fields you want to change.

When the outline is already in your context (e.g., from add_to_context), skip Call 1 and go directly to batch_operations or Call 2 with the UIDs you can see.`,
    schema: z.object({
      mode: z
        .enum(["browse", "apply"])
        .optional()
        .describe(
          'Explicit mode flag. "browse": view outline/block state to identify UIDs. "apply": execute mutations on a block. Not needed when using batch_operations.',
        ),
      block_uid: z
        .string()
        .optional()
        .describe(
          'The 9-character UID of the block to update. Required in "apply" mode. In "browse" mode, optionally provide to inspect a specific block\'s current state.',
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
          "ISO date format (YYYY-MM-DD) to target a Daily Notes Page in browse mode. Example: '2024-01-15'.",
        ),
      use_main_view: z
        .boolean()
        .optional()
        .describe(
          "Use the currently open page/block in the main view as the target. Defaults to true in browse mode if no other location is specified. The user's current view becomes the context.",
        ),
      new_content: z
        .string()
        .optional()
        .describe(
          "New text content for the block. Replaces the entire block content. Omit to keep current content unchanged.",
        ),
      heading: z
        .number()
        .int()
        .min(0)
        .max(3)
        .optional()
        .describe(
          "Set heading level: 0 (normal text), 1 (H1), 2 (H2), 3 (H3). Omit to keep current heading.",
        ),
      open: z
        .boolean()
        .optional()
        .describe(
          "Set block expanded/collapsed state. true = expanded (children visible), false = collapsed. Omit to keep current state.",
        ),
      new_parent_uid: z
        .string()
        .optional()
        .describe(
          "UID of the new parent block to move this block under. Triggers a move operation. Omit to keep current position.",
        ),
      new_parent_page_title: z
        .string()
        .optional()
        .describe(
          "Page title to move the block to (alternative to new_parent_uid). The page must exist.",
        ),
      new_order: z
        .union([z.enum(["first", "last"]), z.number().int().min(0)])
        .optional()
        .describe(
          'Position among new siblings after move: "first", "last" (default), or 0-indexed non-negative integer.',
        ),
      smart_move: z
        .boolean()
        .optional()
        .describe(
          "Use LLM to find the best location within the destination parent. Only applies when moving (new_parent_uid or new_parent_page_title is provided).",
        ),
      batch_operations: z
        .array(
          z.object({
            block_uid: z
              .string()
              .describe("The 9-character UID of the block to update"),
            new_content: z
              .string()
              .optional()
              .describe("New text content for THIS specific block only. Must be the content of a single block, not a tree/outline. Omit if content doesn't change."),
            heading: z
              .number()
              .int()
              .min(0)
              .max(3)
              .optional()
              .describe("Set heading level: 0 (normal), 1 (H1), 2 (H2), 3 (H3)"),
            open: z
              .boolean()
              .optional()
              .describe("Set expanded (true) or collapsed (false)"),
            new_parent_uid: z
              .string()
              .optional()
              .describe("UID of new parent block to move under"),
            new_parent_page_title: z
              .string()
              .optional()
              .describe("Page title to move the block to"),
            new_order: z
              .union([z.enum(["first", "last"]), z.number().int().min(0)])
              .optional()
              .describe('Position among siblings after move: "first", "last", or 0-indexed integer'),
            smart_move: z
              .boolean()
              .optional()
              .describe("Use LLM to find best location within destination"),
          }).passthrough(),
        )
        .max(20)
        .optional()
        .describe(
          "Array of individual block updates. EACH item targets ONE specific block by its 9-character UID — never put multiple blocks' content into one item. Include ONLY fields that change for each block (omit heading, open, etc. if unchanged). Example: [{block_uid: 'abc123def', new_content: 'updated text'}, {block_uid: 'ghi456jkl', heading: 2}].",
        ),
    }),
  },
);
