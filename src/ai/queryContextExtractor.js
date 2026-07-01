import { getFlattenedContentFromTree } from "./dataExtraction";
import { maxCapturingDepth } from "../index";
import {
  resolveReferences,
  getTreeByUid,
  getBlockContentByUid,
} from "../utils/roamAPI";
import { roamQueryRegex } from "../utils/regex";
import {
  extractDatomicQueryFromContent,
  rewriteCurrentVarsForProgrammaticExec,
} from "../utils/datomicQuery";

/**
 * Extract all Roam {{query:...}} / {{[[query]]:...}} full matches from text.
 * Returns array of full query strings (the entire {{query: ...}} block).
 */
export const extractRoamQueryBlocks = (text) => {
  if (!text) return [];
  const blocks = [];
  // Match {{query: ...}} or {{[[query]]: ...}} — find each occurrence
  // Use the roamQueryRegex just to find positions, then extract to matching }}
  const startRegex = /\{\{\s*(?:\[\[query\]\]|query)\s*:/gi;
  let match;
  while ((match = startRegex.exec(text)) !== null) {
    const start = match.index;
    // Find the closing }} by tracking brace depth
    let depth = 0;
    let i = start;
    let found = false;
    while (i < text.length) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) {
          // Check if it ends with }}
          if (text[i - 1] === "}") {
            blocks.push(text.slice(start, i + 1));
          }
          found = true;
          break;
        }
      }
      i++;
    }
    if (!found && depth > 0) {
      // Unclosed — skip
    }
  }
  return blocks;
};

/**
 * Extract the query expression from a full {{query: ...}} block string.
 * Returns just the content after "query:".
 */
export const extractQueryExpression = (queryBlock) => {
  const match = queryBlock
    .trim()
    .match(/\{\{\s*(?:\[\[query\]\]|query)\s*:\s*([\s\S]*)\}\}$/);
  return match ? match[1].trim() : null;
};

/**
 * Extract all :q [...] Datomic queries from text.
 * Returns array of :q query strings.
 *
 * Uses bracket-depth tracking to capture the full query vector,
 * so multi-line queries and blank lines within the vector are handled correctly.
 */
export const extractDatomicQQueries = (text) => {
  if (!text) return [];
  const queries = [];

  // Find each ":q " occurrence and extract the bracket-balanced vector that follows.
  const markerRegex = /:q\s+/g;
  let m;
  while ((m = markerRegex.exec(text)) !== null) {
    const start = m.index + m[0].length;
    // Skip whitespace to find the opening bracket
    let i = start;
    while (i < text.length && text[i] !== "[") {
      if (text[i] !== " " && text[i] !== "\t" && text[i] !== "\n") break;
      i++;
    }
    if (i >= text.length || text[i] !== "[") continue;

    // Track bracket depth to find the end of the query vector
    let depth = 0;
    const vectorStart = i;
    while (i < text.length) {
      if (text[i] === "[") depth++;
      else if (text[i] === "]") {
        depth--;
        if (depth === 0) {
          const vector = text.slice(vectorStart, i + 1);
          const q = `:q ${vector}`;
          if (!queries.includes(q)) queries.push(q);
          break;
        }
      }
      i++;
    }
  }

  return queries;
};

/**
 * Format the results array returned by roamAlphaAPI.data.roamQuery() into text.
 * roamQuery does NOT honor a custom `pull` argument, so results only carry the
 * default fields; we pull each result block separately for its details (same
 * pattern as loadQueryResults / executeRoamNativeQuery in the results popup).
 */
const formatRoamQueryResults = (results) => {
  if (!results || !Array.isArray(results) || results.length === 0) {
    return `(no results)`;
  }

  const truncate = (s, len) => (s.length > len ? s.slice(0, len) + "…" : s);

  const lines = [];
  let nb = 1;
  for (const result of results) {
    const uid = result?.[":block/uid"];
    if (!uid) continue;

    // Pull the full block data per result (parents are ordered root → leaf).
    const blockData = window.roamAlphaAPI.pull(
      "[:block/uid :block/string {:block/page [:node/title]} {:block/parents [:block/uid :block/string]}]",
      [":block/uid", uid],
    );
    const content = blockData?.[":block/string"];
    const pageTitle = blockData?.[":block/page"]?.[":node/title"];

    if (!content) continue;

    // Parent path: root → immediate parent, each truncated to 50 chars
    const parentPath = (blockData?.[":block/parents"] || [])
      .map((p) => p?.[":block/string"])
      .filter(Boolean);
    const parentStr =
      parentPath.length > 0
        ? `${parentPath.map((s) => truncate(s, 50)).join(" > ")}`
        : "";

    // Children content up to maxCapturingDepth.refs levels (default 1)
    const childDepth = maxCapturingDepth?.refs ?? 1;
    const childrenOutline = getFlattenedContentFromTree({
      parentUid: uid,
      maxCapturing: childDepth,
      withDash: true,
      isParentToIgnore: true,
      initialLeftShift: "  ",
    });

    lines.push(
      `${nb++}. (uid: ${uid}) "${resolveReferences(content)}"\nPath: ${pageTitle ? `[[${pageTitle}]] > ` : ""}${parentStr}${childrenOutline.trim() ? `\nChildren blocks:\n${childrenOutline}` : "\n"}`,
    );
  }

  return lines.length ? lines.join("\n") : `(no results)`;
};

/**
 * Execute a Roam query given the UID of the block that holds it. This is the
 * robust path: Roam parses the block itself, so labelled queries (e.g.
 * {{[[query]]: "My recipes" {and: [[recipe]]}}}) and bare-reference queries all
 * work. Prefer this over executeRoamQueryExpression whenever the block UID is
 * known (mirrors loadQueryResults / roamContextLoader in the results popup).
 */
export const executeRoamQueryByUid = async (uid) => {
  try {
    console.log("[QueryContext] Executing Roam query by uid:", uid);
    if (!window.roamAlphaAPI?.data?.roamQuery) {
      console.warn("[QueryContext] roamAlphaAPI.data.roamQuery not available");
      return `(Roam query API not available)`;
    }
    const queryResponse = await window.roamAlphaAPI.data.roamQuery({
      uid,
      limit: null,
    });
    return formatRoamQueryResults(queryResponse?.results);
  } catch (error) {
    console.warn(
      `[QueryContext] Failed to execute Roam query for uid "${uid}":`,
      error,
    );
    return `(query execution failed: ${error.message})`;
  }
};

/**
 * Execute a Roam query expression (the string after "query:") via
 * roamAlphaAPI.data.roamQuery(). Fallback for when no block UID is available;
 * a leading label/text before the query clause will make Roam return no
 * results, so executeRoamQueryByUid should be preferred when possible.
 */
export const executeRoamQueryExpression = async (queryExpression) => {
  try {
    console.log(
      "[QueryContext] Executing Roam query:",
      queryExpression.slice(0, 80),
    );
    if (!window.roamAlphaAPI?.data?.roamQuery) {
      console.warn("[QueryContext] roamAlphaAPI.data.roamQuery not available");
      return `(Roam query API not available)`;
    }
    const queryResponse = await window.roamAlphaAPI.data.roamQuery({
      query: queryExpression,
      limit: null,
    });
    return formatRoamQueryResults(queryResponse?.results);
  } catch (error) {
    console.warn(
      `[QueryContext] Failed to execute Roam query "${queryExpression.slice(0, 60)}":`,
      error,
    );
    return `(query execution failed: ${error.message})`;
  }
};

/**
 * Walk a block subtree (given its root UID) and collect the UIDs + strings of
 * every block whose content is a Roam {{query:...}} / {{[[query]]:...}} block.
 * Used to resolve queries nested in a style by their block UID (robust) rather
 * than by re-parsing flattened text (which can mangle labelled queries).
 */
export const collectRoamQueryBlockUids = (rootUid) => {
  const tree = getTreeByUid(rootUid);
  const root = Array.isArray(tree) ? tree[0] : tree;
  if (!root) return [];
  const found = [];
  const walk = (node) => {
    if (!node) return;
    if (node.string && roamQueryRegex.test(node.string)) {
      found.push({ uid: node.uid, string: node.string });
    }
    (node.children || []).forEach(walk);
  };
  walk(root);
  return found;
};

/**
 * Parse the :find clause of a Datalog query and return an array of variable names.
 * e.g. "[:find ?b ?s :where ...]" → ["b", "s"]
 */
const parseFindVariables = (query) => {
  const findMatch = query.match(
    /:find\s+(.*?)(?=\s*:(?:where|in|with)|\s*\])/s,
  );
  if (!findMatch) return null;
  const vars = findMatch[1].match(/\?[\w-]+/g);
  return vars ? vars.map((v) => v.slice(1)) : null; // strip leading "?"
};

/**
 * Given a variable name, guess its semantic type from naming conventions.
 * Returns "block-uid" | "page-uid" | "string" | "title" | "unknown"
 */
const guessVarType = (varName) => {
  const v = varName.toLowerCase();
  if (
    /\buid\b/.test(v) ||
    v === "b" ||
    v === "e" ||
    v === "entity" ||
    v === "block"
  )
    return "block-uid";
  if (/\bpage\b/.test(v) && !/uid/.test(v)) return "page-uid";
  if (/\b(string|content|text|s)\b/.test(v)) return "string";
  if (/\btitle\b/.test(v) || v === "t") return "title";
  return "unknown";
};

/**
 * Enrich a raw result row (array of values) using the variable names from :find.
 * - Values that look like block UIDs get resolved to their :block/string
 * - Values that look like page UIDs get resolved to their :node/title
 * Returns a human-readable line.
 */
const enrichResultRow = (row, varNames) => {
  const parts = row.map((value, i) => {
    const varName = varNames ? varNames[i] : null;
    const label = varName ? `?${varName}` : `col${i}`;

    if (value === null || value === undefined) return `${label}: (null)`;

    // If it's a number that could be an entity ID, or a 9-char UID string, try to resolve
    const type = varName ? guessVarType(varName) : "unknown";

    if (
      type === "block-uid" ||
      (typeof value === "string" &&
        /^[a-zA-Z0-9_-]{9}$/.test(value) &&
        type !== "title" &&
        type !== "string")
    ) {
      // Try to resolve as block UID → string
      try {
        const blockStr = window.roamAlphaAPI.q(
          `[:find ?s . :where [?e :block/uid "${value}"] [?e :block/string ?s]]`,
        );
        if (blockStr) return `(uid: ${value}) "${blockStr}" (${label})`;
        // Not a block, try page
        const pageTitle = window.roamAlphaAPI.q(
          `[:find ?t . :where [?e :block/uid "${value}"] [?e :node/title ?t]]`,
        );
        if (pageTitle) return `[[${pageTitle}]] (${label})`;
      } catch (_) {
        /* fall through */
      }
    }

    if (type === "page-uid" && typeof value === "string") {
      try {
        const pageTitle = window.roamAlphaAPI.q(
          `[:find ?t . :where [?e :block/uid "${value}"] [?e :node/title ?t]]`,
        );
        if (pageTitle) return `[[${pageTitle}]] (${label})`;
      } catch (_) {
        /* fall through */
      }
    }

    return `${label}: ${JSON.stringify(value)}`;
  });
  return parts.join(", ");
};

/**
 * Execute a :q Datomic query directly via roamAlphaAPI.q() and return
 * a formatted text summary of the results (for LLM context injection).
 * No Roam blocks are written.
 */
export const executeDatomicQueryViaAgent = async (qQuery) => {
  try {
    const datalogQuery = qQuery.replace(/^:q\s+/, "").trim();
    console.log(
      "[QueryContext] Executing :q Datomic query:",
      datalogQuery.slice(0, 80),
    );

    if (!window.roamAlphaAPI?.q) return `(roamAlphaAPI.q not available)`;

    const results = window.roamAlphaAPI.q(datalogQuery);
    return formatDatomicResults(results, datalogQuery);
  } catch (error) {
    console.warn(
      `[QueryContext] Failed to execute :q Datomic query "${qQuery.slice(0, 60)}":`,
      error,
    );
    return `(query execution failed: ${error.message})`;
  }
};

/**
 * Format raw rows returned by roamAlphaAPI.q() into a text summary, using the
 * :find variable names to label/resolve each column.
 */
const formatDatomicResults = (results, datalogQuery) => {
  if (!results || results.length === 0) return `(no results)`;
  const varNames = parseFindVariables(datalogQuery);
  const lines = results.map((row, i) => {
    const enriched = enrichResultRow(Array.isArray(row) ? row : [row], varNames);
    return `${i + 1}. ${enriched}`;
  });
  return `${results.length} result(s):\n${lines.join("\n")}`;
};

/**
 * Execute a :q Datomic query given the UID of the block that holds it. This is
 * the robust path: it reads the block content, extracts the [:find ...] vector,
 * and rewrites Roam's auto-bound `current/*` symbols into :in parameters (which
 * roamAlphaAPI.q() does not bind on its own). Mirrors chatWithDatomicQuery in
 * the results popup, but returns a text summary for LLM context injection.
 */
export const executeDatomicQueryByUid = async (uid) => {
  try {
    if (!window.roamAlphaAPI?.q) return `(roamAlphaAPI.q not available)`;
    const content = getBlockContentByUid(uid);
    const datalogQuery = extractDatomicQueryFromContent(content);
    if (!datalogQuery) return `(no valid :q query found)`;

    console.log(
      "[QueryContext] Executing :q Datomic query by uid:",
      uid,
      datalogQuery.slice(0, 80),
    );

    // Roam auto-binds current/* symbols when rendering a :q block, but
    // roamAlphaAPI.q() does not — rewrite them into :in parameters + args.
    const { query: execQuery, args: execArgs } =
      await rewriteCurrentVarsForProgrammaticExec(datalogQuery, uid);

    const results = window.roamAlphaAPI.q(execQuery, ...execArgs);
    return formatDatomicResults(results, datalogQuery);
  } catch (error) {
    console.warn(
      `[QueryContext] Failed to execute :q Datomic query for uid "${uid}":`,
      error,
    );
    return `(query execution failed: ${error.message})`;
  }
};

/**
 * Walk a block subtree (given its root UID) and collect the UIDs + strings of
 * every block that holds a :q Datomic query. Used to resolve :q queries nested
 * in a style by their block UID (robust — the block content is read verbatim
 * and current/* vars are rewritten) rather than by re-parsing flattened text.
 */
export const collectDatomicQueryBlockUids = (rootUid) => {
  const tree = getTreeByUid(rootUid);
  const root = Array.isArray(tree) ? tree[0] : tree;
  if (!root) return [];
  const found = [];
  const walk = (node) => {
    if (!node) return;
    if (node.string && extractDatomicQueryFromContent(node.string)) {
      found.push({ uid: node.uid, string: node.string });
    }
    (node.children || []).forEach(walk);
  };
  walk(root);
  return found;
};

/**
 * Scan prompt and context text for Roam queries and :q Datomic queries,
 * execute them, and return an additional context string with the results.
 */
export const getContextFromQueries = async ({
  prompt,
  context,
  model: _model = null,
  rootUid: _rootUid = null,
  queryBlockUids = null,
  datomicBlockUids = null,
}) => {
  const textToScan = [
    typeof prompt === "string" ? prompt : JSON.stringify(prompt),
    context,
  ]
    .filter(Boolean)
    .join("\n\n");

  const resultParts = [];

  // 1. Handle Roam {{query:...}} blocks.
  // When the query block UIDs are known (e.g. queries nested in a style), resolve
  // by UID so Roam parses each block itself — this handles labelled queries and
  // bare-reference queries that a text-only expression can't. Otherwise fall back
  // to scanning the text and executing the extracted query expression.
  if (Array.isArray(queryBlockUids) && queryBlockUids.length) {
    console.log(
      `[QueryContext] Resolving ${queryBlockUids.length} Roam query block(s) by uid`,
    );
    for (const { uid, string } of queryBlockUids) {
      const results = await executeRoamQueryByUid(uid);
      const label = string || uid;
      const shortBlock = label.slice(0, 60) + (label.length > 60 ? "..." : "");
      resultParts.push(`Results from Roam query "${shortBlock}":\n${results}`);
    }
  } else {
    const roamQueryBlocks = extractRoamQueryBlocks(textToScan);
    console.log(
      `[QueryContext] Found ${roamQueryBlocks.length} Roam query block(s)`,
    );
    for (const block of roamQueryBlocks) {
      const expr = extractQueryExpression(block);
      if (!expr) continue;
      const results = await executeRoamQueryExpression(expr);
      const shortBlock = block.slice(0, 60) + (block.length > 60 ? "..." : "");
      resultParts.push(`Results from Roam query "${shortBlock}":\n${results}`);
    }
  }

  // 2. Handle :q Datomic queries.
  // When the query block UIDs are known (e.g. queries nested in a style), resolve
  // by UID: the block content is read verbatim and Roam's auto-bound current/*
  // symbols are rewritten into :in parameters (which roamAlphaAPI.q() needs).
  // Otherwise fall back to extracting the :q vector from the scanned text.
  if (Array.isArray(datomicBlockUids) && datomicBlockUids.length) {
    console.log(
      `[QueryContext] Resolving ${datomicBlockUids.length} :q Datomic query block(s) by uid`,
    );
    for (const { uid } of datomicBlockUids) {
      const results = await executeDatomicQueryByUid(uid);
      resultParts.push(`Results from :q query (Datomic):\n${results}`);
    }
  } else {
    const datomicQueries = extractDatomicQQueries(textToScan);
    console.log(
      `[QueryContext] Found ${datomicQueries.length} :q Datomic query/queries`,
    );
    for (const qQuery of datomicQueries) {
      const results = await executeDatomicQueryViaAgent(qQuery);
      resultParts.push(
        `Results from :q query (converted to Datomic):\n${results}`,
      );
    }
  }

  if (!resultParts.length) return null;

  return `Results from queries in context:\n\n${resultParts.join("\n\n")}`;
};
