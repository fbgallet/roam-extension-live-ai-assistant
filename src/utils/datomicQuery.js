import {
  getPageUidByBlockUid,
  getPageNameByPageUid,
  getMainViewUid,
  getMainPageUid,
} from "./roamAPI";

/**
 * Extract the Datomic query ([:find ... :where ...]) from a block's content.
 * Roam's :q query blocks store the datalog vector inline; return it verbatim,
 * or null when the content holds no query.
 */
export const extractDatomicQueryFromContent = (content) => {
  if (!content) return null;
  const match = content.match(/(\[:find[\s\S]*\])/);
  return match ? match[1] : null;
};

/**
 * Roam's :q block rendering auto-binds `current/*` symbols (current page/block,
 * main-window page/block, and their entity ids), but roamAlphaAPI.q() does NOT.
 * Rewrite every referenced `current/*` symbol into an :in parameter and return
 * the rewritten query together with the resolved argument list, so the query can
 * be executed programmatically via roamAlphaAPI.q(query, ...args).
 */
export const rewriteCurrentVarsForProgrammaticExec = async (
  query,
  queryBlockUid
) => {
  const entityIdFor = (uid) => {
    if (!uid) return null;
    const r = window.roamAlphaAPI.pull("[:db/id]", [":block/uid", uid]);
    return r?.[":db/id"] ?? null;
  };

  const resolvers = {
    "current/block-uid": () => queryBlockUid,
    "current/page-uid": () => getPageUidByBlockUid(queryBlockUid) || null,
    "current/page-title": () => {
      const pageUid = getPageUidByBlockUid(queryBlockUid);
      return pageUid ? getPageNameByPageUid(pageUid) ?? null : null;
    },
    "current/block-id": () => entityIdFor(queryBlockUid),
    "current/page-id": () => entityIdFor(getPageUidByBlockUid(queryBlockUid)),
    "current/main-window-block-uid": async () =>
      (await getMainViewUid()) || null,
    "current/main-window-page-uid": async () => (await getMainPageUid()) || null,
    "current/main-window-page-title": async () => {
      const uid = await getMainPageUid();
      return uid ? getPageNameByPageUid(uid) ?? null : null;
    },
    "current/main-window-block-id": async () =>
      entityIdFor(await getMainViewUid()),
    "current/main-window-page-id": async () =>
      entityIdFor(await getMainPageUid()),
  };

  const found = new Set();
  const varRegex = /:?\bcurrent\/[a-z][a-z-]*/g;
  let m;
  while ((m = varRegex.exec(query)) !== null) {
    const name = m[0].replace(/^:/, "");
    if (name in resolvers) found.add(name);
  }
  if (found.size === 0) return { query, args: [] };

  const orderedNames = Array.from(found);
  const args = [];
  for (const name of orderedNames) args.push(await resolvers[name]());

  const symbolFor = (name) => `?__${name.replace(/\//g, "-")}`;

  let rewritten = query;
  for (const name of orderedNames) {
    const esc = name.replace(/[\/\-]/g, (c) => "\\" + c);
    const re = new RegExp(`:?\\b${esc}\\b`, "g");
    rewritten = rewritten.replace(re, symbolFor(name));
  }

  const inParams = orderedNames.map(symbolFor).join(" ");
  if (/:in\s+\$/.test(rewritten)) {
    rewritten = rewritten.replace(/:in\s+\$/, `:in $ ${inParams}`);
  } else {
    rewritten = rewritten.replace(/:where\b/, `:in $ ${inParams} :where`);
  }

  return { query: rewritten, args };
};
