/**
 * Create Block Tool
 *
 * Tool for creating blocks in Roam from markdown content.
 * Uses the Roam Alpha API's fromMarkdown method to parse markdown
 * and insert blocks at a specified location.
 *
 * Supports:
 * - Standard markdown: headings, lists, code blocks, bold, italic, links, etc.
 * - Nested lists become nested blocks
 * - Insertion at specific parent with order control (first, last, or specific index)
 * - Page title as alternative to parent_uid
 * - Smart insertion using LLM to find the best location within an outline
 * - Analysis mode: when markdown_content is omitted, returns page style analysis
 *   to help generate content matching the existing format
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { resolveContainerUid, evaluateOutline } from "./outlineEvaluator";
import { getBlockContentByUid } from "../../../../utils/roamAPI";

/**
 * Truncate text to a maximum length, adding ellipsis if needed.
 */
function truncateText(text: string, maxLength: number): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

/**
 * Format a block reference with its content for display.
 * Returns: "block content..." ((uid))
 */
function formatBlockReference(uid: string, maxContentLength: number = 60): string {
  const content = getBlockContentByUid(uid);
  if (content) {
    return `"${truncateText(content, maxContentLength)}" ((${uid}))`;
  }
  return `((${uid}))`;
}

export const createBlockTool = tool(
  async (
    input: {
      parent_uid?: string;
      page_title?: string;
      date?: string;
      use_main_view?: boolean;
      markdown_content?: string;
      order?: "first" | "last" | number;
      smart_insertion?: boolean;
    },
    config,
  ) => {
    const {
      parent_uid,
      page_title,
      date,
      use_main_view,
      markdown_content,
      order = "last",
      smart_insertion = false,
    } = input;

    console.log("createBlockTool input :>> ", {
      parent_uid,
      page_title,
      use_main_view,
      order,
      smart_insertion,
      markdown_content: markdown_content?.substring(0, 100),
    });

    // Get LLM from config for smart insertion
    const llm = config?.configurable?.llm;
    console.log("createBlockTool llm available :>> ", !!llm);

    // Resolve the target UID using shared helper
    // Default to main view if no location specified
    const useMainView = use_main_view || (!parent_uid && !page_title && !date);
    const resolved = await resolveContainerUid({ parent_uid, page_title, date, use_main_view: useMainView });
    if ("error" in resolved) {
      return `⚠️ ${resolved.error}`;
    }

    const { uid: targetUid, description: targetDescription } = resolved;

    // ANALYSIS MODE: If no markdown_content, return page outline and style for content generation
    if (!markdown_content || markdown_content.trim().length === 0) {
      const result = await evaluateOutline({
        containerUid: targetUid,
        llm,
        mode: "analyze_outline",
      });

      if (!result || !result.outlineContent) {
        return `📄 Analyzed ${targetDescription} (empty). Target UID: ((${targetUid})) - ready for content insertion.`;
      }

      const truncatedOutline =
        result.outlineContent.length > 3000
          ? result.outlineContent.substring(0, 3000) + "\n... (truncated)"
          : result.outlineContent;

      // The response includes the outline for the LLM, but UI will filter it to show only the first line
      return `📄 Analyzed ${targetDescription}. Target UID: ((${targetUid}))\n\n${truncatedOutline}`;
    }

    // === CONFIRMATION FLOW FOR INSERTION MODE ===
    // When markdown_content is provided, we need user confirmation before inserting
    const toolConfirmationCallback = config?.configurable?.toolConfirmationCallback;
    const alwaysApprovedTools = config?.configurable?.alwaysApprovedTools as Set<string> | undefined;

    // Check if this tool has been "always approved" for this session
    const isAlwaysApproved = alwaysApprovedTools?.has("create_block");

    if (toolConfirmationCallback && !isAlwaysApproved) {
      // Generate a unique tool call ID for this confirmation
      const toolCallId = `create_block_${Date.now()}`;

      // Build rich target description for UI display
      const targetDisplay = resolved.pageName
        ? `[[${resolved.pageName}]]`
        : formatBlockReference(targetUid, 80);

      // Request confirmation from the user
      const confirmationResult = await toolConfirmationCallback({
        toolName: "create_block",
        toolCallId,
        args: {
          target: targetDisplay,
          target_uid: targetUid,
          target_description: targetDescription,
          markdown_content,
          smart_insertion,
        },
      });

      if (!confirmationResult.approved) {
        // User declined - return a message that the LLM can process
        const reason = confirmationResult.declineReason
          ? `\n\nUser's feedback: "${confirmationResult.declineReason}"`
          : "";
        return `⚠️ Block insertion was declined by the user.${reason}\n\nPlease ask the user what changes they'd like you to make to the content, or if they'd like to proceed differently.`;
      }

      // Note: If alwaysApprove was set, the UI layer will update alwaysApprovedTools
      // for subsequent calls in this session
    }

    try {
      // Check if the Roam API is available
      const roamAPI = (window as any).roamAlphaAPI;
      if (!roamAPI?.data?.block?.fromMarkdown) {
        return "Error: Roam Alpha API (fromMarkdown) is not available. This tool requires Roam Research with the Alpha API enabled.";
      }

      // Verify the target block/page exists
      const targetExists = roamAPI.data.pull("[:block/uid]", [
        ":block/uid",
        targetUid,
      ]);
      if (!targetExists) {
        return `⚠️ Target with UID "${targetUid}" was not found. Please verify the UID exists in your graph.`;
      }

      // Determine final insertion location
      let finalParentUid = targetUid;
      let finalOrder: "first" | "last" | number = order;

      // Smart insertion: use LLM to find best location
      if (smart_insertion) {
        if (!llm) {
          return "⚠️ Smart insertion requested but no LLM is available. Please use explicit parent_uid and order instead, or ensure the chat agent has access to an LLM.";
        }

        const evalResult = await evaluateOutline({
          containerUid: targetUid,
          llm,
          mode: "find_insertion_location",
          contentToInsert: markdown_content,
        });

        console.log("evalResult :>> ", evalResult);

        if (evalResult?.location) {
          finalParentUid = evalResult.location.parentUid;
          finalOrder = evalResult.location.order;
        } else {
          // Fallback to direct insertion at target
          console.warn(
            "Smart insertion failed to determine location, using target directly",
          );
        }
      }

      // Create blocks from markdown
      const result = await roamAPI.data.block.fromMarkdown({
        location: { "parent-uid": finalParentUid, order: finalOrder },
        "markdown-string": markdown_content,
      });

      console.log("result :>> ", result);
      // Handle different return formats from the API
      // The API may return an array of UIDs, an object with uids, or just success/failure
      let topUidsArray: string[] = [];

      if (Array.isArray(result)) {
        topUidsArray = result;
      } else if (result && typeof result === "object") {
        // Could be { uids: [...] } or similar
        if (Array.isArray(result.uids)) {
          topUidsArray = result.uids;
        } else if (Array.isArray(result["block-uids"])) {
          topUidsArray = result["block-uids"];
        }
      }

      // Build location description with content context
      let locationDesc: string;
      if (page_title && finalParentUid === targetUid) {
        locationDesc = `[[${page_title}]]`;
      } else if (resolved.pageName && finalParentUid === targetUid) {
        locationDesc = `[[${resolved.pageName}]]`;
      } else {
        // Show block content for context
        locationDesc = formatBlockReference(finalParentUid, 60);
      }
      if (smart_insertion && finalParentUid !== targetUid) {
        locationDesc += " (smart insertion)";
      }

      // If we couldn't get UIDs but the API didn't throw, assume success
      // The fromMarkdown API sometimes returns undefined but still creates blocks
      if (topUidsArray.length === 0) {
        // Check if blocks were actually created by verifying the parent has new children
        const parentCheck = roamAPI.data.pull("[:block/children]", [
          ":block/uid",
          finalParentUid,
        ]);

        if (parentCheck && parentCheck[":block/children"]) {
          return `✅ Blocks successfully created as children of ${locationDesc}. The content has been inserted into your graph - you can view it there directly.`;
        }

        return "⚠️ No blocks were created. The markdown content may be empty or invalid.";
      }

      const createdCount = topUidsArray.length;
      const uidList =
        createdCount <= 5
          ? topUidsArray.map((uid: string) => `((${uid}))`).join(", ")
          : `${topUidsArray
              .slice(0, 3)
              .map((uid: string) => `((${uid}))`)
              .join(", ")} ... and ${createdCount - 3} more`;

      return `✅ Created ${createdCount} top-level block(s) as children of ${locationDesc}.\nBlock UIDs: ${uidList}\n\nThe content has been inserted into your graph - no need to copy it again.`;
    } catch (error) {
      console.error("Error creating blocks from markdown:", error);
      return `Error: Failed to create blocks. ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
    }
  },
  {
    name: "create_block",
    description: `Create blocks in Roam. REQUIRES TWO CALLS:

**CALL 1 - MANDATORY ANALYSIS** (omit markdown_content):
→ Returns the target's current outline so you can match its style

**CALL 2 - INSERTION** (include markdown_content):
→ Inserts your content formatted to match the existing style

⚠️ NEVER provide markdown_content on the first call. You MUST see the existing outline first to match its formatting, structure, tags, and logic.

Location options: parent_uid (block UID), page_title (page name), or date (for DNP). If no location is specified, defaults to the user's currently open page/block in the main view.
smart_insertion: Set true to auto-find best location within the outline.`,
    schema: z.object({
      parent_uid: z
        .string()
        .optional()
        .describe(
          "The UID of the parent block where new blocks will be inserted as children. Must be a valid 9-character Roam block UID. Either parent_uid or page_title must be provided.",
        ),
      page_title: z
        .string()
        .optional()
        .describe(
          "The title of a page where new blocks will be inserted as children. Use this instead of parent_uid when you know the page name. The page must exist in the graph.",
        ),
      date: z
        .string()
        .optional()
        .describe(
          "A date to insert content into the corresponding Daily Notes Page (DNP). Will be converted to Roam's DNP format. Accepts ISO format (2024-01-15) or standard date formats (January 15, 2024). Use this instead of page_title for date-based pages.",
        ),
      use_main_view: z
        .boolean()
        .optional()
        .describe(
          "Use the currently open page/block in the main view as the target. Defaults to true if no other location (parent_uid, page_title, date) is specified.",
        ),
      markdown_content: z
        .string()
        .optional()
        .describe(
          "⚠️ DO NOT provide on first call. First call without this to see the outline. Then call again WITH this, formatted to match the existing style you observed.",
        ),
      order: z
        .union([z.literal("first"), z.literal("last"), z.number()])
        .optional()
        .describe(
          'Where to insert the new blocks among siblings: "first" (at the beginning), "last" (at the end, default), or a number for specific position (0-indexed). Ignored if smart_insertion is true.',
        ),
      smart_insertion: z
        .boolean()
        .optional()
        .describe(
          "DEFAULT TO TRUE when inserting into a page without explicit position. Uses LLM to analyze the existing outline and automatically determine the best location for the new content based on logical structure and topic relevance. Only set to false if user explicitly specifies position or provides exact parent_uid.",
        ),
    }),
  },
);
