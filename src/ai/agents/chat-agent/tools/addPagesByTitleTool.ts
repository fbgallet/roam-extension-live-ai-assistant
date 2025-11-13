/**
 * Add Pages by Title Tool
 *
 * Adds one or more pages to the chat context by their titles.
 * By default, adds only the page itself.
 * Optionally can include first-level child blocks.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getPageUidByPageName,
  getOrderedDirectChildren,
  getMainPageUid,
  getPageNameByPageUid,
} from "../../../../utils/roamAPI";
import { Result } from "../../../../components/full-results-popup/types/types";

export const addPagesByTitleTool = tool(
  async (
    input: {
      page_titles: string[];
      include_children?: boolean;
      use_current_page?: boolean;
    },
    config
  ) => {
    const { page_titles, include_children = false, use_current_page = false } = input;

    // Get current context and callback from config
    const currentContext = config?.configurable?.currentResultsContext || [];
    const addResultsCallback = config?.configurable?.addResultsCallback;

    if (!addResultsCallback) {
      return "Error: Cannot add pages - callback not available. This tool requires proper integration with the chat interface.";
    }

    // Check which pages are already in context
    const existingPageUids = new Set(
      currentContext.map((result: Result) => result.pageUid)
    );

    const pagesToAdd: Array<{ title: string; uid: string }> = [];
    const alreadyInContext: string[] = [];
    const notFound: string[] = [];

    // If use_current_page is true, add the current/main page
    if (use_current_page) {
      try {
        const currentPageUid = await getMainPageUid();
        if (currentPageUid) {
          const currentPageTitle = getPageNameByPageUid(currentPageUid);
          if (currentPageTitle) {
            if (existingPageUids.has(currentPageUid)) {
              alreadyInContext.push(currentPageTitle);
            } else {
              pagesToAdd.push({ title: currentPageTitle, uid: currentPageUid });
            }
          } else {
            // If no page title found, user is likely in Daily Notes (log) view
            return "⚠️ You appear to be in the Daily Notes (log) view. Please ask the user to specify a time period for the daily notes they want to analyze (e.g., 'last 7 days', 'this week', 'last month'). You can then use the appropriate tool to retrieve daily notes context.";
          }
        } else {
          return "⚠️ Could not detect a current page. If you're in the Daily Notes view, please ask the user to specify a time period for the daily notes they want to analyze.";
        }
      } catch (error) {
        console.error("Error getting current page:", error);
        return "Error: Could not retrieve the current page. Make sure you have a page open in Roam.";
      }
    }

    // Process explicitly provided page titles
    for (const title of page_titles) {
      const pageUid = getPageUidByPageName(title);

      if (!pageUid) {
        notFound.push(title);
      } else if (existingPageUids.has(pageUid)) {
        alreadyInContext.push(title);
      } else {
        pagesToAdd.push({ title, uid: pageUid });
      }
    }

    // Fetch and add new pages
    const newResults: Result[] = [];

    for (const page of pagesToAdd) {
      try {
        if (!include_children) {
          // Add the page itself as a Result
          const pageResult: Result = {
            uid: page.uid,
            text: `[[${page.title}]]`, // Page reference
            pageTitle: page.title,
            pageUid: page.uid,
            blockUid: page.uid, // Page UID is also the block UID
            parentText: "",
            ancestorTexts: [],
            isPage: true, // Mark as page so expansion treats it correctly
            addedByAgent: true,
            addedAt: new Date().toISOString(),
          };
          newResults.push(pageResult);
        }
        // Optionally add first-level children
        else {
          const children = getOrderedDirectChildren(page.uid);

          for (const child of children) {
            const childResult: Result = {
              uid: child.uid,
              text: child.string || "",
              pageTitle: page.title,
              pageUid: page.uid,
              blockUid: child.uid,
              parentText: `[[${page.title}]]`,
              ancestorTexts: [page.title],
              addedByAgent: true,
              addedAt: new Date().toISOString(),
            };
            newResults.push(childResult);
          }
        }
      } catch (error) {
        console.error(`Error fetching page "${page.title}":`, error);
        notFound.push(page.title);
      }
    }

    // Add new results via callback
    if (newResults.length > 0) {
      addResultsCallback(newResults);
    }

    // Build response message
    const messages: string[] = [];

    if (newResults.length > 0) {
      const blockInfo = include_children
        ? ` (${newResults.length} total blocks including children)`
        : "";
      messages.push(
        `✅ Added ${pagesToAdd.length} page(s) to context: ${pagesToAdd
          .map((p) => p.title)
          .join(", ")}${blockInfo}`
      );
    }

    if (alreadyInContext.length > 0) {
      messages.push(`ℹ️  Already in context: ${alreadyInContext.join(", ")}`);
    }

    if (notFound.length > 0) {
      messages.push(`❌ Not found: ${notFound.join(", ")}`);
    }

    if (messages.length === 0) {
      messages.push("No changes made to context.");
    }

    return messages.join("\n");
  },
  {
    name: "add_pages_by_title",
    description:
      "Add one or more pages to the chat context by their titles. By default, only adds the page itself. Set include_children=true to also add first-level child blocks. Use this when the user asks about pages not currently in context. If the user refers to the current/main/active/opened page (in any language), set use_current_page=true to automatically retrieve it.",
    schema: z.object({
      page_titles: z
        .array(z.string())
        .describe(
          "Array of page titles to add to the context. Use exact page titles as they appear in Roam. Can be empty if only use_current_page is needed."
        ),
      include_children: z
        .boolean()
        .optional()
        .describe(
          "If true, also adds first-level child blocks of the pages. Default is false."
        ),
      use_current_page: z
        .boolean()
        .optional()
        .describe(
          "If true, adds the currently open/main/active page in Roam to the context. Use this when the user refers to 'current page', 'this page', 'main page', 'active page', or similar references in any language. Default is false."
        ),
    }),
  }
);
