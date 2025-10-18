/**
 * roamContextLoader.ts
 *
 * Utility functions to load Roam graph results based on RoamContext configuration.
 * This allows the FullResultsPopup to be opened with various Roam contexts
 * (pages, blocks, linked references, sidebar, etc.) without going through the full agent.
 */

import { RoamContext } from "../../../ai/agents/types";
import {
  getPageNameByPageUid,
  getUidAndTitleOfMentionedPagesInBlock,
  treeToUidArray,
  getTreeByUid,
  getMainViewUid,
} from "../../../utils/roamAPI";
import { findBlocksByContentImpl } from "../../../ai/agents/search-agent/tools/findBlocksByContent/findBlocksByContentTool";

/**
 * Result interface matching the FullResultsPopup expected format
 */
export interface RoamContextResult {
  uid: string;
  content?: string;
  pageTitle?: string;
  pageUid?: string;
  isPage?: boolean;
  isDaily?: boolean;
  modified?: Date | string;
  created?: Date | string;
  [key: string]: any;
}

/**
 * Options for loading results from RoamContext
 */
export interface LoadRoamContextOptions {
  roamContext: RoamContext;
  rootUid?: string; // Source block UID to exclude from results
}

/**
 * Main function to load results from a RoamContext configuration.
 * Converts various Roam contexts (pages, blocks, linked refs, etc.) into
 * a unified array of results suitable for FullResultsPopup.
 */
export const loadResultsFromRoamContext = async ({
  roamContext,
  rootUid,
}: LoadRoamContextOptions): Promise<{
  results: RoamContextResult[];
  description: string;
}> => {
  const blockUids: string[] = [];
  const pageUids: string[] = [];
  const linkedRefPageUids: string[] = [];

  try {
    // 1. Extract elements from sidebar if needed
    if (roamContext.sidebar) {
      const sidebarWindows = window.roamAlphaAPI.ui.rightSidebar.getWindows();

      for (const windowConfig of sidebarWindows) {
        const type = windowConfig.type;

        if (type === "block" && windowConfig["block-uid"]) {
          blockUids.push(windowConfig["block-uid"]);
        } else if (type === "outline" && windowConfig["page-uid"]) {
          pageUids.push(windowConfig["page-uid"]);
        } else if (type === "mentions" && windowConfig["mentions-uid"]) {
          linkedRefPageUids.push(windowConfig["mentions-uid"]);
        }
        // Other types are ignored
      }
    }

    // 2. Add blocks from RoamContext.blockArgument
    if (roamContext.block && roamContext.blockArgument?.length) {
      blockUids.push(...roamContext.blockArgument);
    }

    // 3. Add pages from RoamContext.pageArgument
    if (roamContext.page && roamContext.pageArgument?.length) {
      // Convert page titles to UIDs
      for (const pageTitle of roamContext.pageArgument) {
        const pageUid = window.roamAlphaAPI.q(
          `[:find ?uid . :where [?e :node/title "${pageTitle}"] [?e :block/uid ?uid]]`
        );
        if (pageUid) {
          pageUids.push(pageUid);
        }
      }
    }

    // 4. Add linked references from RoamContext.linkedRefs
    if (roamContext.linkedRefs && roamContext.linkedRefsArgument?.length) {
      // Use the page titles from linkedRefsArgument
      for (const pageTitle of roamContext.linkedRefsArgument) {
        const pageUid = window.roamAlphaAPI.q(
          `[:find ?uid . :where [?e :node/title "${pageTitle}"] [?e :block/uid ?uid]]`
        );
        if (pageUid) {
          linkedRefPageUids.push(pageUid);
        }
      }
    } else if (roamContext.linkedRefs && roamContext.pageViewUid) {
      // Fallback to pageViewUid if no specific pages are provided
      linkedRefPageUids.push(roamContext.pageViewUid);
    }

    // 4b. Handle linkedPages (pages that are mentioned in the context)
    if (roamContext.linkedPages) {
      const sourceUid = roamContext.pageViewUid || rootUid;
      if (sourceUid) {
        // Get all UIDs in the tree if sourceUid is a page, or just use the block
        let uidsToCheck: string[] = [sourceUid];

        // If it's a page, get all blocks in the tree
        const sourceData = window.roamAlphaAPI.pull("[*]", [
          ":block/uid",
          sourceUid,
        ]);
        const isPage = !!sourceData?.[":node/title"];

        if (isPage) {
          const tree = getTreeByUid(sourceUid);
          if (tree) {
            uidsToCheck = treeToUidArray(tree);
          }
        }

        // Extract mentioned pages from all blocks
        for (const uid of uidsToCheck) {
          const mentionedPages = getUidAndTitleOfMentionedPagesInBlock(uid);
          if (mentionedPages && mentionedPages.length > 0) {
            for (const pageRef of mentionedPages) {
              if (pageRef.uid && !pageUids.includes(pageRef.uid)) {
                pageUids.push(pageRef.uid);
              }
            }
          }
        }
      }
    }

    // 4c. Handle mainPage (if used)
    if (roamContext.mainPage || roamContext.pageViewUid) {
      let mainViewUid = roamContext.pageViewUid;
      if (!mainViewUid) mainViewUid = await getMainViewUid();
      if (!pageUids.includes(mainViewUid)) {
        pageUids.push(roamContext.pageViewUid);
      }
    }

    // 4d. Handle logPages (daily notes)
    if (roamContext.logPages && roamContext.logPagesArgument > 0) {
      const daysToInclude = roamContext.logPagesArgument;

      // Get daily notes for the last N days
      const today = new Date();
      for (let i = 0; i < daysToInclude; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);

        // Format as MM-DD-YYYY for Roam
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const year = date.getFullYear();
        const dateTitle = `${month}-${day}-${year}`;

        const dailyPageUid = window.roamAlphaAPI.q(
          `[:find ?uid . :where [?e :node/title "${dateTitle}"] [?e :block/uid ?uid]]`
        );

        if (dailyPageUid && !pageUids.includes(dailyPageUid)) {
          pageUids.push(dailyPageUid);
        }
      }
    }

    // Now we have 3 arrays: blockUids, pageUids, linkedRefPageUids
    const allResults: RoamContextResult[] = [];

    // 5. Add blocks to results (directly, no tool needed)
    for (const blockUid of blockUids) {
      if (blockUid === rootUid) continue; // Skip the root block

      const blockData = window.roamAlphaAPI.pull("[*]", [
        ":block/uid",
        blockUid,
      ]);
      if (blockData) {
        const pageUid = blockData[":block/page"]?.[":block/uid"];
        const pageTitle = pageUid ? getPageNameByPageUid(pageUid) : undefined;

        allResults.push({
          uid: blockUid,
          content: blockData[":block/string"] || "",
          pageUid,
          pageTitle,
          isPage: false,
          modified: blockData[":edit/time"]
            ? new Date(blockData[":edit/time"])
            : undefined,
          created: blockData[":create/time"]
            ? new Date(blockData[":create/time"])
            : undefined,
        });
      }
    }

    // 6. Add pages to results (directly, no tool needed)
    for (const pageUid of pageUids) {
      const pageData = window.roamAlphaAPI.pull("[*]", [":block/uid", pageUid]);
      if (pageData) {
        const pageTitle =
          pageData[":node/title"] || getPageNameByPageUid(pageUid);
        const isDaily = !!pageData[":log/id"];

        allResults.push({
          uid: pageUid,
          pageTitle,
          isPage: true,
          isDaily,
          modified: pageData[":edit/time"]
            ? new Date(pageData[":edit/time"])
            : undefined,
          created: pageData[":create/time"]
            ? new Date(pageData[":create/time"])
            : undefined,
        });
      }
    }

    // 7. Add linked references using findBlocksByContentImpl (batch all pages with OR)
    if (linkedRefPageUids.length > 0) {
      // Get all page names
      const pageNames: string[] = [];
      for (const pageUid of linkedRefPageUids) {
        const pageName = getPageNameByPageUid(pageUid);
        if (pageName && pageName !== "undefined") {
          pageNames.push(pageName);
        }
      }

      if (pageNames.length > 0) {
        try {
          // Create conditions for all pages and combine with OR
          const conditions = pageNames.map((pageName) => ({
            type: "page_ref" as const,
            text: pageName,
          }));

          const toolResult = await findBlocksByContentImpl({
            conditions,
            combineConditions: "OR", // Use OR to get references to any of these pages
            includeChildren: false,
            includeParents: false,
            includeDaily: true,
            dailyNotesOnly: false,
            sortBy: "relevance",
            sortOrder: "desc",
            limit: 3000,
            resultMode: "uids_only",
            secureMode: true,
            userQuery:
              pageNames.length === 1
                ? `Linked references of [[${pageNames[0]}]]`
                : `Linked references of ${pageNames.length} pages`,
            excludeBlockUid: rootUid,
          });

          if (toolResult.results) {
            allResults.push(...toolResult.results);
          }
        } catch (error) {
          console.warn(`Failed to load linked references:`, error);
        }
      }
    }

    // 8. Deduplicate results by UID
    const uniqueResults = deduplicateByUid(allResults);

    // 9. Build description
    const parts: string[] = [];

    // Count blocks (excluding rootUid)
    const blockCount = blockUids.filter((uid) => uid !== rootUid).length;
    if (blockCount > 0) {
      parts.push(`${blockCount} block${blockCount > 1 ? "s" : ""}`);
    }

    // Count pages (excluding those from linkedRefs to avoid double counting)
    const regularPageCount = pageUids.length;
    if (regularPageCount > 0) {
      parts.push(`${regularPageCount} page${regularPageCount > 1 ? "s" : ""}`);
    }

    // Count linked references
    const linkedRefCount = linkedRefPageUids.length;
    if (linkedRefCount > 0) {
      parts.push(
        `linked references of ${linkedRefCount} page${
          linkedRefCount > 1 ? "s" : ""
        }`
      );
    }

    // Add specific context mentions
    if (roamContext.sidebar) {
      parts.push("sidebar");
    }
    if (roamContext.linkedPages) {
      parts.push("linked pages");
    }
    if (roamContext.logPages && roamContext.logPagesArgument > 0) {
      parts.push(`${roamContext.logPagesArgument} daily notes`);
    }

    const description =
      parts.length > 0
        ? `Custom context with ${parts.join(", ")}`
        : "Custom context";

    return {
      results: uniqueResults,
      description,
    };
  } catch (error) {
    console.error("Error loading results from RoamContext:", error);
    throw error;
  }
};

/**
 * Helper function to deduplicate results by UID
 */
function deduplicateByUid(results: RoamContextResult[]): RoamContextResult[] {
  const seen = new Set<string>();
  const deduplicated: RoamContextResult[] = [];

  for (const result of results) {
    if (result.uid && !seen.has(result.uid)) {
      seen.add(result.uid);
      deduplicated.push(result);
    }
  }

  return deduplicated;
}
