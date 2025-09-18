import { executeDatomicQuery } from "../../helpers/searchUtils";

/**
 * Get all target block UIDs from various input sources
 */
export const getTargetBlockUids = async (
  blockUids?: string[],
  pageUids?: string[],
  pageTitles?: string[]
): Promise<string[]> => {
  let allBlockUids: string[] = [];

  // Add direct block UIDs
  if (blockUids?.length) {
    allBlockUids.push(...blockUids);
  }

  // Get blocks from page UIDs
  if (pageUids?.length) {
    const blocksFromPageUids = await getBlocksFromPageUids(pageUids);
    allBlockUids.push(...blocksFromPageUids);
  }

  // Get blocks from page titles
  if (pageTitles?.length) {
    const blocksFromPageTitles = await getBlocksFromPageTitles(pageTitles);
    allBlockUids.push(...blocksFromPageTitles);
  }

  // Remove duplicates
  return [...new Set(allBlockUids)];
};

/**
 * Get all block UIDs from pages by their UIDs
 */
export const getBlocksFromPageUids = async (pageUids: string[]): Promise<string[]> => {
  const uidsClause = pageUids.map((uid) => `"${uid}"`).join(" ");

  const query = `[:find ?block-uid
                  :where
                  [?page :block/uid ?page-uid]
                  [(contains? #{${uidsClause}} ?page-uid)]
                  [?page :block/children ?block]
                  [?block :block/uid ?block-uid]]`;

  const results = await executeDatomicQuery(query);
  return results.map(([blockUid]) => blockUid as string);
};

/**
 * Get all block UIDs from pages by their titles
 */
export const getBlocksFromPageTitles = async (
  pageTitles: string[]
): Promise<string[]> => {
  const titlesClause = pageTitles.map((title) => `"${title}"`).join(" ");

  const query = `[:find ?block-uid
                  :where
                  [?page :node/title ?page-title]
                  [(contains? #{${titlesClause}} ?page-title)]
                  [?page :block/children ?block]
                  [?block :block/uid ?block-uid]]`;

  const results = await executeDatomicQuery(query);
  return results.map(([blockUid]) => blockUid as string);
};

/**
 * Extract page references from blocks using :block/refs
 */
export const extractReferencesFromBlocks = async (
  blockUids: string[]
): Promise<Array<{ pageTitle: string; pageUid: string }>> => {
  if (blockUids.length === 0) return [];

  // Split into chunks to avoid query size limits
  const chunkSize = 100;
  const chunks = [];
  for (let i = 0; i < blockUids.length; i += chunkSize) {
    chunks.push(blockUids.slice(i, i + chunkSize));
  }

  let allReferences: Array<{ pageTitle: string; pageUid: string }> = [];

  for (const chunk of chunks) {
    const uidsClause = chunk.map((uid) => `"${uid}"`).join(" ");

    const query = `[:find ?page-title ?page-uid
                    :where
                    [?block :block/uid ?block-uid]
                    [(contains? #{${uidsClause}} ?block-uid)]
                    [?block :block/refs ?ref-page]
                    [?ref-page :node/title ?page-title]
                    [?ref-page :block/uid ?page-uid]]`;

    const results = await executeDatomicQuery(query);

    const chunkReferences = results.map(([pageTitle, pageUid]) => ({
      pageTitle: pageTitle as string,
      pageUid: pageUid as string,
    }));

    allReferences.push(...chunkReferences);
  }

  return allReferences;
};