import { executeDatomicQuery, isDailyNote } from "../../helpers/searchUtils";

/**
 * Generate Daily Notes Page UIDs for a date range
 * DNP UIDs follow the format: MM-DD-YYYY
 */
export function generateDNPUidsForRange(
  startDate: Date,
  endDate: Date
): string[] {
  const dnpUids: string[] = [];
  const currentDate = new Date(startDate);

  // Ensure we don't go beyond the end date
  while (currentDate <= endDate) {
    const month = String(currentDate.getMonth() + 1).padStart(2, "0");
    const day = String(currentDate.getDate()).padStart(2, "0");
    const year = currentDate.getFullYear();

    const dnpUid = `${month}-${day}-${year}`;
    dnpUids.push(dnpUid);

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dnpUids;
}

/**
 * Query Daily Notes Pages by UIDs using efficient Datomic batch query
 * Returns structured results with metadata
 */
export async function queryDNPsByUids(
  dnpUids: string[],
  filterMode: "created" | "modified" = "modified"
): Promise<any[]> {
  if (dnpUids.length === 0) {
    return [];
  }

  // Build efficient Datomic query with set membership test
  // This is much more efficient than looping through UIDs
  const uidSet = dnpUids.map((uid) => `"${uid}"`).join(" ");

  const query = `[:find ?uid ?title ?created ?modified
    :where
    [?page :block/uid ?uid]
    [?page :node/title ?title]
    [?page :create/time ?created]
    [?page :edit/time ?modified]
    [(contains? #{${uidSet}} ?uid)]]`;

  try {
    const results = await executeDatomicQuery(query);

    // Convert to structured format
    return results.map(([uid, title, created, modified]) => ({
      uid,
      title,
      created: new Date(created),
      modified: new Date(modified),
      isDaily: true, // All results are DNPs
      isPage: true,
    }));
  } catch (error) {
    console.error("❌ [findDailyNotesByPeriod] Datomic query failed:", error);
    throw error;
  }
}

/**
 * Add full page content for DNPs
 * Uses efficient batch query to get all blocks for multiple pages
 */
export async function addDNPContent(
  dnpResults: any[],
  limit: number
): Promise<any[]> {
  if (dnpResults.length === 0) {
    return [];
  }

  const allResults: any[] = [];

  // Add the page entries themselves
  allResults.push(...dnpResults);

  // Get all blocks for these pages in a batch query
  const pageUids = dnpResults.map(dnp => dnp.uid);
  const uidSet = pageUids.map((uid) => `"${uid}"`).join(" ");

  const blocksQuery = `[:find ?block-uid ?block-string ?page-uid ?page-title ?block-created ?block-modified
    :where
    [?page :block/uid ?page-uid]
    [?page :node/title ?page-title]
    [(contains? #{${uidSet}} ?page-uid)]
    [?page :block/children ?block]
    [?block :block/uid ?block-uid]
    [?block :block/string ?block-string]
    [?block :create/time ?block-created]
    [?block :edit/time ?block-modified]]`;

  try {
    const blockResults = await executeDatomicQuery(blocksQuery);

    // Convert blocks to structured format
    const blocks = blockResults.map(([blockUid, blockString, pageUid, pageTitle, blockCreated, blockModified]) => ({
      uid: blockUid,
      content: blockString,
      created: new Date(blockCreated),
      modified: new Date(blockModified),
      pageTitle: pageTitle,
      pageUid: pageUid,
      isDaily: true,
      children: [],
      parents: [],
      isPage: false,
      expansionLevel: 0,
    }));

    // Apply limit per page if needed
    if (limit && limit < blocks.length) {
      // Sort by modified date (most recent first) and limit
      blocks.sort((a, b) => b.modified.getTime() - a.modified.getTime());
      allResults.push(...blocks.slice(0, limit));
    } else {
      allResults.push(...blocks);
    }

    return allResults;
  } catch (error) {
    console.error("❌ [findDailyNotesByPeriod] Failed to fetch DNP content:", error);
    // Return at least the page entries
    return allResults;
  }
}

/**
 * Add linked references for DNPs
 * Finds all blocks that reference these Daily Notes Pages
 */
export async function addDNPLinkedRefs(
  dnpResults: any[],
  limit: number
): Promise<any[]> {
  if (dnpResults.length === 0) {
    return [];
  }

  // Import the findBlocksByContent implementation
  const { findBlocksByContentImpl } = await import(
    "../findBlocksByContent/findBlocksByContentTool"
  );

  const allReferences: any[] = [];

  // Query references for each DNP title
  // We do this in batches to avoid overwhelming the system
  for (const dnp of dnpResults) {
    try {
      const linkedRefs = await findBlocksByContentImpl({
        conditions: [
          {
            type: "page_ref",
            text: dnp.title,
            matchType: "contains",
          },
        ],
        includeChildren: true,
        includeParents: false,
        includeDaily: true,
        resultMode: "full",
        limit: limit,
        secureMode: false,
      });

      if (linkedRefs && linkedRefs.results && Array.isArray(linkedRefs.results)) {
        linkedRefs.results.forEach((ref: any) => {
          if (ref.uid && ref.content) {
            allReferences.push({
              ...ref,
              referenceContext: `References: ${dnp.title}`,
            });
          }
        });
      }
    } catch (error) {
      console.warn(`⚠️ [findDailyNotesByPeriod] Failed to get linked refs for ${dnp.title}:`, error);
    }
  }

  return allReferences;
}

/**
 * Filter results by date range (creation or modification date)
 */
export function filterResultsByDateRange(
  results: any[],
  startDate: Date,
  endDate: Date,
  filterMode: "created" | "modified"
): any[] {
  const dateField = filterMode === "created" ? "created" : "modified";

  return results.filter(result => {
    const date = result[dateField];
    if (!date) return true; // Include if date is missing

    return date >= startDate && date <= endDate;
  });
}
