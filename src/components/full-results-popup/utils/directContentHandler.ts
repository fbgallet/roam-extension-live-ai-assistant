import { PageSelection } from "./queryStorage";

export interface DirectContentOptions {
  selectedPages: string[];
  includePageContent: boolean;
  includeLinkedRefs: boolean;
  dnpPeriod: number;
  currentPageContext: {
    uid: string | null;
    title: string | null;
  };
}

export interface DirectContentResult {
  addedPageSelections: PageSelection[];
  newResults: any[];
}

/**
 * Add page content with full metadata
 */
async function addPageContent(
  pageUid: string,
  newResults: any[]
): Promise<void> {
  const pageQuery = `[:find ?page-uid ?page-title ?page-created ?page-modified (pull ?page [:block/uid :block/string :node/title {:block/children ...}])
    :where
    [?page :block/uid ?page-uid]
    [?page :node/title ?page-title]
    [?page :create/time ?page-created]
    [?page :edit/time ?page-modified]
    [(= ?page-uid "${pageUid}")]]`;

  const pageData = await window.roamAlphaAPI.q(pageQuery);

  if (pageData && pageData.length > 0) {
    const [pageUid, pageTitle, pageCreated, pageModified, pullData] =
      pageData[0];
    const { isDailyNote } = await import(
      "../../../ai/agents/search-agent/helpers/searchUtils"
    );

    // Add the page itself
    newResults.push({
      uid: pageUid,
      title: pageTitle,
      content: pullData[":block/string"] || `Page: ${pageTitle}`,
      created: new Date(pageCreated),
      modified: new Date(pageModified),
      pageTitle: pageTitle,
      pageUid: pageUid,
      isDaily: isDailyNote(pageUid),
      totalBlocks: pullData[":block/children"]?.length || 0,
      isPage: true,
      children: [],
      parents: [],
      expansionLevel: 0,
    });

    // Add children blocks recursively
    const addChildrenBlocks = (
      children: any[],
      parentPageTitle: string,
      parentPageUid: string
    ) => {
      if (!children || !Array.isArray(children)) return;

      children.forEach((child) => {
        if (child[":block/uid"] && child[":block/string"]) {
          newResults.push({
            uid: child[":block/uid"],
            content: child[":block/string"],
            created: new Date(pageCreated),
            modified: new Date(pageModified),
            pageTitle: parentPageTitle,
            pageUid: parentPageUid,
            isDaily: isDailyNote(parentPageUid),
            children: [],
            parents: [],
            isPage: false,
            expansionLevel: 0,
          });
        }

        if (child[":block/children"]) {
          addChildrenBlocks(
            child[":block/children"],
            parentPageTitle,
            parentPageUid
          );
        }
      });
    };

    if (pullData[":block/children"]) {
      addChildrenBlocks(pullData[":block/children"], pageTitle, pageUid);
    }
  }
}

/**
 * Add linked references for a page
 */
async function addLinkedReferences(
  pageTitle: string,
  newResults: any[]
): Promise<void> {
  const { findBlocksByContentImpl } = await import(
    "../../../ai/agents/search-agent/tools/findBlocksByContent/findBlocksByContentTool"
  );

  const linkedRefs = await findBlocksByContentImpl({
    conditions: [
      {
        type: "page_ref",
        text: pageTitle,
        matchType: "contains",
      },
    ],
    includeChildren: true,
    includeParents: false,
    includeDaily: true,
    resultMode: "full",
    limit: 1000,
    secureMode: false,
  });

  if (linkedRefs && linkedRefs.results && Array.isArray(linkedRefs.results)) {
    linkedRefs.results.forEach((ref: any) => {
      if (ref.uid && ref.content) {
        newResults.push({
          ...ref,
          referenceContext: `References: ${pageTitle}`,
        });
      }
    });
  }
}

/**
 * Execute page selections from a stored query
 * This is used when running saved queries that include page selections
 */
export async function executeStoredPageSelections(
  pageSelections: PageSelection[],
  baseResults: any[],
  onProgress?: (message: string) => void
): Promise<{ finalResults: any[]; addedCount: number }> {
  let accumulatedResults = [...baseResults];

  for (let i = 0; i < pageSelections.length; i++) {
    const pageSelection = pageSelections[i];
    const pagesToAdd = pageSelection.uid === "dnp" ? ["dnp"] : [pageSelection.title];

    if (onProgress) {
      onProgress(
        `📄 Adding page ${i + 1}/${pageSelections.length}: ${pageSelection.title}...`
      );
    }

    console.log(
      `📋 [PageSelectionExecutor] Adding page selection: ${pageSelection.title}`,
      {
        includeContent: pageSelection.includeContent,
        includeLinkedRefs: pageSelection.includeLinkedRefs,
      }
    );

    // Use handleDirectContentAdd to process the page
    const result = await handleDirectContentAdd(accumulatedResults, {
      selectedPages: pagesToAdd,
      includePageContent: pageSelection.includeContent,
      includeLinkedRefs: pageSelection.includeLinkedRefs,
      dnpPeriod: pageSelection.dnpPeriod || 7,
      currentPageContext: { uid: null, title: null }, // Not applicable for stored queries
    });

    // Add new results to accumulated results (with deduplication)
    if (result.newResults.length > 0) {
      const existingUids = new Set(
        accumulatedResults.map((r) => r.uid).filter(Boolean)
      );

      for (const newResult of result.newResults) {
        if (newResult.uid && !existingUids.has(newResult.uid)) {
          accumulatedResults.push(newResult);
          existingUids.add(newResult.uid);
        }
      }
    }
  }

  const addedCount = accumulatedResults.length - baseResults.length;
  return { finalResults: accumulatedResults, addedCount };
}

/**
 * Main handler for adding direct content
 */
export async function handleDirectContentAdd(
  currentResults: any[],
  options: DirectContentOptions
): Promise<DirectContentResult> {
  const { selectedPages, includePageContent, includeLinkedRefs, dnpPeriod, currentPageContext } = options;

  if (!includePageContent && !includeLinkedRefs) {
    console.warn("⚠️ [DirectContent] No content types selected");
    return { addedPageSelections: [], newResults: [] };
  }

  const newResults: any[] = [];
  const addedPageSelections: PageSelection[] = [];
  let pageData: Array<{ title: string; uid: string | null }> = [];

  try {
    // Process each selected page
    for (const pageSelection of selectedPages) {
      if (pageSelection === "current") {
        if (currentPageContext.uid && currentPageContext.title) {
          pageData.push({
            title: currentPageContext.title,
            uid: currentPageContext.uid,
          });
          addedPageSelections.push({
            title: currentPageContext.title,
            uid: currentPageContext.uid,
            includeContent: includePageContent,
            includeLinkedRefs: includeLinkedRefs,
          });
        } else {
          console.warn(
            "⚠️ [DirectContent] No current page context available"
          );
        }
      } else if (pageSelection === "sidebar") {
        // Load sidebar content using roamContextLoader
        const { loadResultsFromRoamContext } = await import(
          "./roamContextLoader"
        );

        console.log("📂 [DirectContent] Loading sidebar content...");

        // Load sidebar blocks/pages
        if (includePageContent) {
          const sidebarResults = await loadResultsFromRoamContext({
            roamContext: { sidebar: true },
          });

          newResults.push(...sidebarResults.results);

          console.log(
            `✅ [DirectContent] Added ${sidebarResults.results.length} items from sidebar`
          );
        }

        // Add linked references for each page/block in the sidebar
        if (includeLinkedRefs) {
          console.log("🔗 [DirectContent] Loading linked references for sidebar items...");

          // Get sidebar windows to extract UIDs
          const sidebarWindows = window.roamAlphaAPI.ui.rightSidebar.getWindows();
          const sidebarUids: string[] = [];

          for (const windowConfig of sidebarWindows) {
            const type = windowConfig.type;

            if (type === "block" && windowConfig["block-uid"]) {
              sidebarUids.push(windowConfig["block-uid"]);
            } else if (type === "outline" && windowConfig["page-uid"]) {
              sidebarUids.push(windowConfig["page-uid"]);
            }
            // For 'mentions' type, the linked refs are already shown, so we skip
          }

          console.log(`🔗 [DirectContent] Found ${sidebarUids.length} sidebar items for linked refs`);

          // Load linked references for each sidebar item
          for (const uid of sidebarUids) {
            const linkedRefsResults = await loadResultsFromRoamContext({
              roamContext: {
                linkedRefs: true,
                pageViewUid: uid,
              },
            });

            newResults.push(...linkedRefsResults.results);

            console.log(
              `✅ [DirectContent] Added ${linkedRefsResults.results.length} linked refs for sidebar item ${uid}`
            );
          }
        }

        addedPageSelections.push({
          title: "Sidebar",
          uid: "sidebar",
          includeContent: includePageContent,
          includeLinkedRefs: includeLinkedRefs,
        });

        console.log(
          `✅ [DirectContent] Completed sidebar loading (${newResults.length} total items added)`
        );
      } else if (pageSelection.startsWith("block:")) {
        // Handle block selection using roamContextLoader
        const blockUid = pageSelection.substring(6); // Remove "block:" prefix

        const { loadResultsFromRoamContext } = await import(
          "./roamContextLoader"
        );
        const { getBlockContentByUid } = await import(
          "../../../utils/roamAPI.js"
        );

        console.log(`📦 [DirectContent] Loading block: ${blockUid}`);

        // Load block content
        const blockResults = await loadResultsFromRoamContext({
          roamContext: {
            block: true,
            blockArgument: [blockUid],
          },
        });

        newResults.push(...blockResults.results);

        // Add linked references if requested
        if (includeLinkedRefs) {
          console.log(`🔗 [DirectContent] Loading linked references for block: ${blockUid}`);

          // Use pageViewUid to specify which block to find linked references for
          const linkedRefsResults = await loadResultsFromRoamContext({
            roamContext: {
              linkedRefs: true,
              pageViewUid: blockUid, // This will be added to linkedRefUids
            },
          });

          newResults.push(...linkedRefsResults.results);

          console.log(
            `✅ [DirectContent] Added ${linkedRefsResults.results.length} linked references for block`
          );
        }

        const blockContent = getBlockContentByUid(blockUid);
        const blockPreview =
          blockContent && blockContent.length > 50
            ? blockContent.substring(0, 50) + "..."
            : blockContent || blockUid;

        addedPageSelections.push({
          title: `Block: ${blockPreview}`,
          uid: blockUid,
          includeContent: true,
          includeLinkedRefs: includeLinkedRefs,
        });

        console.log(
          `✅ [DirectContent] Added block with ${blockResults.results.length} item(s)`
        );
      } else if (pageSelection === "dnp") {
        // Load DNP content using roamContextLoader
        const { loadResultsFromRoamContext } = await import(
          "./roamContextLoader"
        );

        console.log(
          `📅 [DirectContent] Loading Daily Notes Pages (${dnpPeriod} days)...`
        );

        const dnpResults = await loadResultsFromRoamContext({
          roamContext: {
            logPages: true,
            logPagesArgument: dnpPeriod,
          },
        });

        // Add DNP results - handle based on includePageContent setting
        if (includePageContent) {
          newResults.push(...dnpResults.results);
        }

        // Add linked references if requested
        if (includeLinkedRefs && dnpResults.results.length > 0) {
          // Get UIDs of all DNP pages
          const dnpPageUids = dnpResults.results
            .filter((r) => r.isPage)
            .map((r) => r.uid);

          console.log(
            `🔗 [DirectContent] Loading linked references for ${dnpPageUids.length} DNP pages...`
          );

          // Load linked references for these pages
          const linkedRefsResults = await loadResultsFromRoamContext({
            roamContext: {
              linkedRefs: true,
              linkedRefsArgument: dnpPageUids.map(
                (uid) => dnpResults.results.find((r) => r.uid === uid)?.pageTitle
              ).filter(Boolean) as string[],
            },
          });

          newResults.push(...linkedRefsResults.results);

          console.log(
            `✅ [DirectContent] Added ${linkedRefsResults.results.length} linked references`
          );
        }

        addedPageSelections.push({
          title: `Daily Notes (${dnpPeriod} days)`,
          uid: "dnp",
          includeContent: includePageContent,
          includeLinkedRefs: includeLinkedRefs,
          dnpPeriod: dnpPeriod,
        });

        console.log(
          `✅ [DirectContent] Added ${dnpResults.results.length} DNP items`
        );
      } else {
        // Specific page selected
        const { getPageUidByPageName } = await import(
          "../../../utils/roamAPI.js"
        );
        const pageUid = getPageUidByPageName(pageSelection);
        if (pageUid) {
          pageData.push({
            title: pageSelection,
            uid: pageUid,
          });
          addedPageSelections.push({
            title: pageSelection,
            uid: pageUid,
            includeContent: includePageContent,
            includeLinkedRefs: includeLinkedRefs,
          });
        } else {
          console.warn(
            `⚠️ [DirectContent] Could not find UID for page: "${pageSelection}"`
          );
        }
      }
    }

    // Process each page
    for (const { title: pageTitle, uid: pageUid } of pageData) {
      if (!pageUid) {
        console.warn(
          `⚠️ [DirectContent] Skipping page "${pageTitle}" - no UID found`
        );
        continue;
      }

      if (includePageContent) {
        try {
          await addPageContent(pageUid, newResults);
        } catch (error) {
          console.error(
            `❌ [DirectContent] Error adding page content for ${pageTitle}:`,
            error
          );
        }
      }

      if (includeLinkedRefs) {
        try {
          await addLinkedReferences(pageTitle, newResults);
        } catch (error) {
          console.error(
            `❌ [DirectContent] Error adding linked references for ${pageTitle}:`,
            error
          );
        }
      }
    }

    if (newResults.length === 0) {
      console.warn(
        `⚠️ [DirectContent] No content found for ${selectedPages.length} selected pages`
      );
    }

    return { addedPageSelections, newResults };
  } catch (error) {
    console.error("❌ [DirectContent] Failed to add direct content:", error);
    return { addedPageSelections: [], newResults: [] };
  }
}
