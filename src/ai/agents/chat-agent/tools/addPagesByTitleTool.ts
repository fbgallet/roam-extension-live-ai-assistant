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
} from "../../../../utils/roamAPI";
import { Result } from "../../../../components/full-results-popup/types/types";

export const addPagesByTitleTool = tool(
  async (
    input: {
      page_titles: string[];
      include_children?: boolean;
    },
    config
  ) => {
    const { page_titles, include_children = false } = input;

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
      "Add one or more pages to the chat context by their titles. By default, only adds the page itself. Set include_children=true to also add first-level child blocks. Use this when the user asks about pages not currently in context.",
    schema: z.object({
      page_titles: z
        .array(z.string())
        .describe(
          "Array of page titles to add to the context. Use exact page titles as they appear in Roam."
        ),
      include_children: z
        .boolean()
        .optional()
        .describe(
          "If true, also adds first-level child blocks of the pages. Default is false."
        ),
    }),
  }
);
