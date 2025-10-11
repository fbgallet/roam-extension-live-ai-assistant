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
 * Process Daily Notes Pages for a specified period
 */
async function processDNPPages(
  dnpDays: number,
  addContent: boolean,
  addRefs: boolean
): Promise<{
  pageData: Array<{ title: string; uid: string | null }>;
  pageSelection: PageSelection | null;
}> {
  const { getYesterdayDate } = await import("../../../utils/roamAPI.js");

  let currentDate = new Date();
  let foundDnpCount = 0;
  const pageData: Array<{ title: string; uid: string | null }> = [];

  for (let i = 0; i < dnpDays; i++) {
    if (i > 0) {
      currentDate = getYesterdayDate(currentDate);
    }

    const dnpUid = `${String(currentDate.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(currentDate.getDate()).padStart(
      2,
      "0"
    )}-${currentDate.getFullYear()}`;

    const pageTitle =
      window.roamAlphaAPI?.util?.dateToPageTitle?.(currentDate);

    const pageExists =
      window.roamAlphaAPI?.util?.getPageUidByPageTitle?.(pageTitle);

    if (pageExists || pageTitle) {
      pageData.push({
        title: pageTitle || dnpUid,
        uid: dnpUid,
      });
      foundDnpCount++;
    } else {
      console.log(
        `⚠️ [DirectContent] DNP not found: ${dnpUid} -> "${pageTitle}"`
      );
    }
  }

  if (foundDnpCount === 0) {
    console.warn(
      `⚠️ [DirectContent] No Daily Notes Pages found for the last ${dnpDays} days.`
    );
  }

  const pageSelection =
    foundDnpCount > 0
      ? {
          title: `Daily Notes (${dnpDays} days)`,
          uid: "dnp",
          includeContent: addContent,
          includeLinkedRefs: addRefs,
          dnpPeriod: dnpDays,
        }
      : null;

  return { pageData, pageSelection };
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
      } else if (pageSelection === "dnp") {
        const dnpResult = await processDNPPages(
          dnpPeriod,
          includePageContent,
          includeLinkedRefs
        );
        pageData.push(...dnpResult.pageData);
        if (dnpResult.pageSelection) {
          addedPageSelections.push(dnpResult.pageSelection);
        }
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
