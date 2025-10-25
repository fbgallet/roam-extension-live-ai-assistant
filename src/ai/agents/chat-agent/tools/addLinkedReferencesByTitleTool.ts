/**
 * Add Linked References by Title Tool
 *
 * Adds all blocks that reference a given page to the chat context.
 * Similar to what happens when opening chat with linked references.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getBlocksMentioningTitle,
  getPageUidByBlockUid,
  getPageNameByPageUid,
  getPathOfBlock,
} from "../../../../utils/roamAPI.js";
import { Result } from "../../../../components/full-results-popup/types/types";

export const addLinkedReferencesByTitleTool = tool(
  async (
    input: {
      page_titles: string[];
    },
    config
  ) => {
    const { page_titles } = input;

    // Get current context and callback from config
    const currentContext = config?.configurable?.currentResultsContext || [];
    const addResultsCallback = config?.configurable?.addResultsCallback;

    if (!addResultsCallback) {
      return "Error: Cannot add linked references - callback not available. This tool requires proper integration with the chat interface.";
    }

    // Track existing block UIDs to avoid duplicates
    const existingBlockUids = new Set(
      currentContext.map((result: Result) => result.blockUid || result.uid)
    );

    const pagesProcessed: Array<{ title: string; refsCount: number }> = [];
    const notFound: string[] = [];
    const newResults: Result[] = [];

    for (const title of page_titles) {
      try {
        // Get blocks mentioning this page title
        const linkedRefs = getBlocksMentioningTitle(title);

        if (!linkedRefs || linkedRefs.length === 0) {
          notFound.push(title);
          continue;
        }

        let addedCount = 0;

        for (const ref of linkedRefs) {
          // Skip if already in context
          if (existingBlockUids.has(ref.uid)) {
            continue;
          }

          // Enrich block data with page info and path
          const pageUid = getPageUidByBlockUid(ref.uid);
          const pageTitle = pageUid ? getPageNameByPageUid(pageUid) : undefined;
          const path = getPathOfBlock(ref.uid);

          // Extract parent text and ancestor texts from path
          let parentText = "";
          const ancestorTexts: string[] = [];

          if (path && path.length > 0) {
            // Last item in path is the direct parent
            parentText = path[path.length - 1]?.string || "";
            // All items in path are ancestors (from root to parent)
            ancestorTexts.push(
              ...path
                .map((p: { uid: string; string: string }) => p.string || "")
                .filter(Boolean)
            );
          }

          const result: Result = {
            uid: ref.uid,
            content: ref.content || "",
            text: ref.content || "",
            pageTitle: pageTitle || "",
            pageUid: pageUid || "",
            blockUid: ref.uid,
            parentText,
            ancestorTexts,
            // Mark as added by agent
            addedByAgent: true,
            addedAt: new Date().toISOString(),
            // Indicate this is a linked reference
            linkedReferenceTo: title,
          };

          newResults.push(result);
          existingBlockUids.add(ref.uid); // Track to avoid duplicates within this batch
          addedCount++;
        }

        pagesProcessed.push({ title, refsCount: addedCount });
      } catch (error) {
        console.error(`Error fetching linked references for "${title}":`, error);
        notFound.push(title);
      }
    }

    // Add new results via callback
    if (newResults.length > 0) {
      addResultsCallback(newResults);
    }

    // Build response message
    const messages: string[] = [];

    if (pagesProcessed.length > 0) {
      messages.push(
        `✅ Added linked references for ${pagesProcessed.length} page(s):`
      );
      for (const page of pagesProcessed) {
        messages.push(`   - [[${page.title}]]: ${page.refsCount} references added`);
      }
      messages.push(`   Total blocks added: ${newResults.length}`);
    }

    if (notFound.length > 0) {
      messages.push(`❌ Not found or no references: ${notFound.join(", ")}`);
    }

    if (messages.length === 0) {
      messages.push("No linked references found or all were already in context.");
    }

    return messages.join("\n");
  },
  {
    name: "add_linked_references_by_title",
    description:
      "Add all blocks that reference a given page to the chat context. Use this when the user asks about what references a page, or wants to see all mentions of a topic. This adds blocks from across the graph that link to the specified page(s).",
    schema: z.object({
      page_titles: z
        .array(z.string())
        .describe(
          "Array of page titles whose linked references should be added to the context. Use exact page titles as they appear in Roam."
        ),
    }),
  }
);
