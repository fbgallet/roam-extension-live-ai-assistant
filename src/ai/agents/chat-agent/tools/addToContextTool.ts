/**
 * Add To Context Tool
 *
 * Unified tool for adding various Roam content to the chat context.
 * Leverages the roamContextLoader to handle:
 * - Pages (by title or current page)
 * - Blocks (by UID, focused block, or sidebar blocks)
 * - Linked references (by page title or current page)
 * - Daily notes (log pages)
 * - Sidebar content (blocks, pages, and mentions)
 *
 * This replaces individual tools (addPagesByTitle, addBlocksByUid, addLinkedReferencesByTitle)
 * with a single unified interface that uses the existing roamContextLoader infrastructure.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { loadResultsFromRoamContext } from "../../../../components/full-results-popup/utils/roamContextLoader";
import {
  getMainPageUid,
  getPageNameByPageUid,
} from "../../../../utils/roamAPI";
import { RoamContext } from "../../types";

export const addToContextTool = tool(
  async (
    input: {
      page_titles?: string[];
      use_current_page?: boolean;
      block_uids?: string[];
      use_focused_block?: boolean;
      use_sidebar?: boolean;
      linked_refs_page_titles?: string[];
      use_current_page_refs?: boolean;
      daily_notes_count?: number;
    },
    config
  ) => {
    const {
      page_titles = [],
      use_current_page = false,
      block_uids = [],
      use_focused_block = false,
      use_sidebar = false,
      linked_refs_page_titles = [],
      use_current_page_refs = false,
      daily_notes_count = 0,
    } = input;

    // Get current context and callback from config
    const addResultsCallback = config?.configurable?.addResultsCallback;

    if (!addResultsCallback) {
      return "Error: Cannot add to context - callback not available. This tool requires proper integration with the chat interface.";
    }

    // Build the RoamContext object
    const roamContext: RoamContext = {};

    // Handle pages
    let pageTitles = [...page_titles];
    if (use_current_page) {
      try {
        const currentPageUid = await getMainPageUid();
        if (currentPageUid) {
          const currentPageTitle = getPageNameByPageUid(currentPageUid);
          if (currentPageTitle) {
            pageTitles.push(currentPageTitle);
          } else {
            // If no page title found, user is likely in Daily Notes (log) view
            return "⚠️ You appear to be in the Daily Notes (log) view. Please ask the user to specify a time period for the daily notes they want to analyze (e.g., 'last 7 days', 'this week', 'last month'), or specify page titles explicitly.";
          }
        } else {
          return "⚠️ Could not detect a current page. If you're in the Daily Notes view, please ask the user to specify page titles or a time period for daily notes.";
        }
      } catch (error) {
        console.error("Error getting current page:", error);
        return "Error: Could not retrieve the current page.";
      }
    }

    if (pageTitles.length > 0) {
      roamContext.page = true;
      roamContext.pageArgument = pageTitles;
    }

    // Handle blocks
    let blockUids = [...block_uids];
    if (use_focused_block) {
      try {
        const focusedBlockUid = (
          window as any
        ).roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
        if (focusedBlockUid) {
          blockUids.push(focusedBlockUid);
        } else {
          return "⚠️ No block is currently focused in the main view. Please ask the user to focus on a block or provide specific block UIDs.";
        }
      } catch (error) {
        console.error("Error getting focused block:", error);
        return "Error: Could not retrieve the focused block.";
      }
    }

    if (blockUids.length > 0) {
      roamContext.block = true;
      roamContext.blockArgument = blockUids;
    }

    // Handle sidebar
    if (use_sidebar) {
      roamContext.sidebar = true;
    }

    // Handle linked references
    let linkedRefsTitles = [...linked_refs_page_titles];
    if (use_current_page_refs) {
      try {
        const currentPageUid = await getMainPageUid();
        if (currentPageUid) {
          const currentPageTitle = getPageNameByPageUid(currentPageUid);
          if (currentPageTitle) {
            linkedRefsTitles.push(currentPageTitle);
          } else {
            return "⚠️ You appear to be in the Daily Notes (log) view. Please ask the user to specify page titles for which they want to see linked references.";
          }
        } else {
          return "⚠️ Could not detect a current page. Please ask the user to specify page titles for linked references.";
        }
      } catch (error) {
        console.error("Error getting current page for refs:", error);
        return "Error: Could not retrieve the current page.";
      }
    }

    if (linkedRefsTitles.length > 0) {
      roamContext.linkedRefs = true;
      roamContext.linkedRefsArgument = linkedRefsTitles;
    }

    // Handle daily notes
    if (daily_notes_count > 0) {
      roamContext.logPages = true;
      roamContext.logPagesArgument = daily_notes_count;
    }

    // Check if we have anything to add
    if (
      !roamContext.page &&
      !roamContext.block &&
      !roamContext.sidebar &&
      !roamContext.linkedRefs &&
      !roamContext.logPages
    ) {
      return "⚠️ No content specified to add. Please provide page titles, block UIDs, or enable sidebar/focused block options.";
    }

    try {
      // Load results using the existing roamContextLoader
      const { results, description } = await loadResultsFromRoamContext({
        roamContext,
      });

      if (results.length === 0) {
        return "⚠️ No content found matching the specified criteria. The pages, blocks, or references may not exist.";
      }

      // Convert results to the Result format expected by the chat
      const chatResults = results.map((result) => ({
        uid: result.uid,
        text: result.content || `[[${result.pageTitle}]]`,
        pageTitle: result.pageTitle || "",
        pageUid: result.pageUid || result.uid,
        blockUid: result.uid,
        parentText: "",
        ancestorTexts: [],
        isPage: result.isPage,
        addedByAgent: true,
        addedAt: new Date().toISOString(),
      }));

      // Add results via callback
      addResultsCallback(chatResults);

      // Build response message
      const messages: string[] = [];
      messages.push(`✅ Added ${results.length} item(s) to context`);

      // Add specific details
      const details: string[] = [];
      if (roamContext.page && pageTitles.length > 0) {
        details.push(`${pageTitles.length} page(s): ${pageTitles.join(", ")}`);
      }
      if (roamContext.block && blockUids.length > 0) {
        details.push(`${blockUids.length} block(s)`);
      }
      if (roamContext.sidebar) {
        details.push("sidebar content");
      }
      if (roamContext.linkedRefs && linkedRefsTitles.length > 0) {
        details.push(`linked references for: ${linkedRefsTitles.join(", ")}`);
      }
      if (roamContext.logPages && daily_notes_count > 0) {
        details.push(`${daily_notes_count} daily notes`);
      }

      if (details.length > 0) {
        messages.push(`   Including: ${details.join(", ")}`);
      }

      return messages.join("\n");
    } catch (error) {
      console.error("Error loading context:", error);
      return `Error: Failed to load content. ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
    }
  },
  {
    name: "add_to_context",
    description:
      "Universal tool for adding Roam content to the chat context. Can add pages, blocks, linked references, sidebar content, and daily notes. Supports 'current page', 'focused block', and 'sidebar' references in any language. This is the primary tool for expanding chat context with Roam data.",
    schema: z.object({
      page_titles: z
        .array(z.string())
        .optional()
        .describe(
          "Array of page titles to add to the context. Use exact page titles as they appear in Roam."
        ),
      use_current_page: z
        .boolean()
        .optional()
        .describe(
          "If true, adds the currently open/main/active page. Use when user refers to 'current page', 'this page', 'main page', etc. in any language."
        ),
      block_uids: z
        .array(z.string())
        .optional()
        .describe(
          "Array of block UIDs to add. Extract UIDs from block references like ((uid))."
        ),
      use_focused_block: z
        .boolean()
        .optional()
        .describe(
          "If true, adds the currently focused block in the main view. Use when user refers to 'current block', 'this block', 'focused block', etc. in any language."
        ),
      use_sidebar: z
        .boolean()
        .optional()
        .describe(
          "If true, adds all content from the right sidebar (blocks, pages, and their mentions). Use when user refers to 'sidebar', 'sidebar content', etc. in any language."
        ),
      linked_refs_page_titles: z
        .array(z.string())
        .optional()
        .describe(
          "Array of page titles whose linked references (mentions) should be added to the context."
        ),
      use_current_page_refs: z
        .boolean()
        .optional()
        .describe(
          "If true, adds linked references for the currently open page. Use when user asks about 'what references this page', 'mentions of current page', etc. in any language."
        ),
      daily_notes_count: z
        .number()
        .optional()
        .describe(
          "Number of recent daily notes to add (e.g., 7 for last week, 30 for last month). Use when user asks about recent daily notes or a time period."
        ),
    }),
  }
);
