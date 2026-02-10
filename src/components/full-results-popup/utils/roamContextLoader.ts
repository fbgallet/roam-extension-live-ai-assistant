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
  getRelativeCurrentDate,
  getYesterdayDate,
  getParentBlock,
  getOrderedDirectChildren,
} from "../../../utils/roamAPI";

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
  const linkedRefUids: string[] = []; // UIDs (pages or blocks) to find linked references for

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
        } else if (
          type === "mentions" &&
          (windowConfig["page-uid"] || windowConfig["mentions-uid"])
        ) {
          linkedRefUids.push(
            windowConfig["page-uid"] || windowConfig["mentions-uid"]
          );
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
    if (roamContext.linkedRefs) {
      // 4a. Add linked refs from linkedRefsArgument if provided
      if (roamContext.linkedRefsArgument?.length) {
        for (const pageTitle of roamContext.linkedRefsArgument) {
          const pageUid = window.roamAlphaAPI.q(
            `[:find ?uid . :where [?e :node/title "${pageTitle}"] [?e :block/uid ?uid]]`
          );
          if (pageUid) {
            linkedRefUids.push(pageUid);
          }
        }
      }

      // 4b. Add linked refs from current view (complementary to linkedRefsArgument)
      // Get current view UID (can be a page or a block)
      const currentViewUid =
        roamContext.pageViewUid || (await getMainViewUid());
      if (currentViewUid && !linkedRefUids.includes(currentViewUid)) {
        linkedRefUids.push(currentViewUid);
      }
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

    // 4c. Handle mainPage and pageViewUid
    if (roamContext.mainPage || roamContext.pageViewUid) {
      // Get the view UID (either from pageViewUid or current main view)
      let mainViewUid = roamContext.pageViewUid;
      if (!mainViewUid && roamContext.mainPage) {
        mainViewUid = await getMainViewUid();
      }

      if (mainViewUid) {
        // Test if it's a page or a block
        const viewData = window.roamAlphaAPI.pull("[*]", [
          ":block/uid",
          mainViewUid,
        ]);
        const isPage = !!viewData?.[":node/title"];

        if (isPage) {
          // It's a page - add to pageUids
          if (!pageUids.includes(mainViewUid)) {
            pageUids.push(mainViewUid);
          }
        } else {
          // It's a block - add to blockUids (or get its page if mainPage is true)
          if (roamContext.mainPage) {
            // For mainPage, we want the page, not the block
            const pageUid = viewData?.[":block/page"]?.[":block/uid"];
            if (pageUid && !pageUids.includes(pageUid)) {
              pageUids.push(pageUid);
            }
          } else {
            // For pageViewUid that's a block, add the block
            if (!blockUids.includes(mainViewUid)) {
              blockUids.push(mainViewUid);
            }
          }
        }
      }
    }

    // 4d. Handle logPages (daily notes)
    if (roamContext.logPages && roamContext.logPagesArgument > 0) {
      const daysToInclude = roamContext.logPagesArgument;
      let currentDay = await getRelativeCurrentDate(rootUid);

      // Get daily notes for the last N days
      for (let i = 0; i < daysToInclude; i++) {
        let dnpUid = window.roamAlphaAPI.util.dateToPageUid(currentDay);
        if (dnpUid && !pageUids.includes(dnpUid)) {
          pageUids.push(dnpUid);
        }
        currentDay = getYesterdayDate(currentDay);
      }
    }

    // 4e. Handle query results
    if (roamContext.query && roamContext.queryBlockUid) {
      try {
        // Use Roam's dedicated query API to get results
        // Returns {total: number, results: Array} where results use pull pattern
        // Default pull pattern: [:block/string :node/title :block/uid]
        // Pass limit: null to get all results (default is 20)
        const queryResponse = await (window as any).roamAlphaAPI.data.roamQuery({
          uid: roamContext.queryBlockUid,
          limit: null,
        });

        // Extract results array from the response
        const queryResults = queryResponse?.results;
        if (queryResults && Array.isArray(queryResults)) {
          // Each result has :block/uid from the pull pattern
          for (const result of queryResults) {
            const resultUid = result?.[":block/uid"];
            if (resultUid && !blockUids.includes(resultUid)) {
              blockUids.push(resultUid);
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to load query results for ${roamContext.queryBlockUid}:`, error);
      }
    }

    // 4f. Handle siblings context
    if (roamContext.siblings && rootUid) {
      const parentUid = getParentBlock(rootUid);
      if (parentUid) {
        const children = getOrderedDirectChildren(parentUid);
        if (children) {
          for (const child of children) {
            if (child.uid !== rootUid && !blockUids.includes(child.uid)) {
              blockUids.push(child.uid);
            }
          }
        }
      }
    }

    // Now we have 3 arrays: blockUids, pageUids, linkedRefPageUids
    const allResults: RoamContextResult[] = [];

    // 5. Add blocks to results (directly, no tool needed)
    for (const blockUid of blockUids) {
      if (blockUid === rootUid && blockUid !== roamContext.pageViewUid)
        continue; // Skip the root block

      const blockData = window.roamAlphaAPI.pull(
        "[:block/uid :block/string :block/page {:block/page [:block/uid]} :edit/time :create/time]",
        [":block/uid", blockUid]
      );
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

    // 6. Add linked references using Datomic query with :block/refs
    if (linkedRefUids.length > 0) {
      try {
        // Build Datomic query to find all blocks that reference any of these UIDs
        // The query finds blocks where [:block/refs] contains any of the target UIDs
        const refBlocks = linkedRefUids.flatMap((targetUid) => {
          const query = `[:find ?uid ?string ?page-uid ?modified ?created
                          :where
                          [?ref-block :block/refs ?target]
                          [?target :block/uid "${targetUid}"]
                          [?ref-block :block/uid ?uid]
                          [?ref-block :block/string ?string]
                          [?ref-block :block/page ?page]
                          [?page :block/uid ?page-uid]
                          [(get-else $ ?ref-block :edit/time 0) ?modified]
                          [(get-else $ ?ref-block :create/time 0) ?created]]`;

          const results = window.roamAlphaAPI.q(query);

          if (!results || !Array.isArray(results)) return [];

          return results
            .filter(([uid]) => uid !== rootUid) // Exclude root block
            .map(([uid, content, pageUid, modified, created]) => {
              const pageTitle = getPageNameByPageUid(pageUid);
              return {
                uid,
                content,
                pageUid,
                pageTitle,
                isPage: false,
                modified: modified ? new Date(modified) : undefined,
                created: created ? new Date(created) : undefined,
              };
            });
        });

        allResults.push(...refBlocks);
      } catch (error) {
        console.warn(`Failed to load linked references:`, error);
      }
    }

    // 7. Add pages to results (directly, no tool needed)
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
    const linkedRefCount = linkedRefUids.length;
    if (linkedRefCount > 0) {
      parts.push(
        `linked references of ${linkedRefCount} item${
          linkedRefCount > 1 ? "s" : ""
        }`
      );
    }

    // Add specific context mentions
    if (roamContext.query) {
      parts.push("query results");
    }
    if (roamContext.sidebar) {
      parts.push("sidebar");
    }
    if (roamContext.linkedPages) {
      parts.push("linked pages");
    }
    if (roamContext.siblings) {
      parts.push("sibling blocks");
    }
    if (roamContext.path) {
      parts.push(
        roamContext.pathDepth
          ? `block path (${roamContext.pathDepth} ancestors)`
          : "block path"
      );
    }
    if (roamContext.logPages && roamContext.logPagesArgument > 0) {
      parts.push(`${roamContext.logPagesArgument} daily notes`);
    }

    const description =
      parts.length > 0
        ? `Custom context with ${parts.join(", ")}`
        : uniqueResults.length
        ? "Custom context"
        : "";

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
