import { executeDatomicQuery, isDailyNote } from "../../helpers/searchUtils";

/**
 * Fetch detailed information about blocks
 */
export const fetchBlockDetails = async (
  blockUids: string[],
  includeContent: boolean,
  includeMetadata: boolean,
  includeHierarchy: boolean
): Promise<any[]> => {
  if (blockUids.length === 0) return [];

  const uidsClause = blockUids.map((uid) => `"${uid}"`).join(" ");

  // Base query for block details
  let queryFields = ["?uid"];
  let queryWhere = `[?b :block/uid ?uid]
                    [(contains? #{${uidsClause}} ?uid)]
                    [?b :block/page ?page]
                    [?page :node/title ?page-title]
                    [?page :block/uid ?page-uid]`;

  if (includeContent) {
    queryFields.push("?content");
    queryWhere += `\n                    [?b :block/string ?content]`;
  }

  if (includeMetadata) {
    queryFields.push("?created", "?modified");
    queryWhere += `\n                    [?b :create/time ?created]
                    [?b :edit/time ?modified]`;
  }

  queryFields.push("?page-title", "?page-uid");

  const query = `[:find ${queryFields.join(" ")}
                  :where
                  ${queryWhere}]`;

  const results = await executeDatomicQuery(query);

  return results.map((result) => {
    let index = 0;
    const blockDetail: any = {
      type: "block",
      uid: result[index++],
      // Explicit type flag (isPage: false means it's a block)
      isPage: false,
    };

    if (includeContent) {
      blockDetail.content = result[index++];
    }

    if (includeMetadata) {
      blockDetail.created = new Date(result[index++]);
      blockDetail.modified = new Date(result[index++]);
    }

    blockDetail.pageTitle = result[index++];
    blockDetail.pageUid = result[index++];
    blockDetail.isDaily = isDailyNote(blockDetail.pageUid);

    // TODO: Add hierarchy fetching if includeHierarchy is true
    if (includeHierarchy) {
      blockDetail.children = [];
      blockDetail.parents = [];
      // This would require additional queries similar to enrichWithHierarchy
    }

    return blockDetail;
  });
};

/**
 * Fetch detailed information about pages
 */
export const fetchPageDetails = async (
  pageUids: string[],
  includeMetadata: boolean
): Promise<any[]> => {
  if (pageUids.length === 0) return [];

  const uidsClause = pageUids.map((uid) => `"${uid}"`).join(" ");

  let queryFields = ["?page-uid", "?page-title"];
  let queryWhere = `[?page :block/uid ?page-uid]
                    [(contains? #{${uidsClause}} ?page-uid)]
                    [?page :node/title ?page-title]`;

  if (includeMetadata) {
    queryFields.push("?created", "?modified");
    queryWhere += `\n                    [?page :create/time ?created]
                    [?page :edit/time ?modified]`;
  }

  const query = `[:find ${queryFields.join(" ")}
                  :where
                  ${queryWhere}]`;

  const results = await executeDatomicQuery(query);

  return results.map((result) => {
    let index = 0;
    const pageDetail: any = {
      type: "page",
      pageUid: result[index++],
      pageTitle: result[index++],
      // Explicit type flag
      isPage: true,
    };

    if (includeMetadata) {
      pageDetail.created = new Date(result[index++]);
      pageDetail.modified = new Date(result[index++]);
    }

    pageDetail.isDaily = isDailyNote(pageDetail.pageUid);

    return pageDetail;
  });
};