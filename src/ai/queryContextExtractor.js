import { getFlattenedContentFromTree } from "./dataExtraction";
import { maxCapturingDepth } from "../index";
import { resolveReferences } from "../utils/roamAPI";

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
 * Execute a Roam query expression via roamAlphaAPI.data.roamQuery().
 * Returns formatted text with results.
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
      pull: "[:block/string :node/title :block/uid {:block/page [:node/title]} {:block/parents [:block/uid :block/string {:block/children [:block/uid]}]}]",
      limit: null,
    });
    const results = queryResponse?.results;
    if (!results || !Array.isArray(results) || results.length === 0) {
      return `(no results)`;
    }

    // Reconstruct ordered parent path (closest first) from flat :block/parents list.
    // Strategy: walk up by finding which parent has the current uid in its children.
    const getParentPath = (node) => {
      const parents = node?.[":block/parents"];
      if (!Array.isArray(parents) || parents.length === 0) return [];
      // Walk up: find the parent whose children contain currentUid
      const path = [];
      let currentUid = node[":block/uid"];
      while (currentUid) {
        const directParent = parents.find((p) =>
          p[":block/children"]?.some((c) => c[":block/uid"] === currentUid),
        );
        if (!directParent) break;
        const s = directParent[":block/string"];
        if (s) path.push(s); // skip page nodes (no :block/string)
        currentUid = directParent[":block/uid"];
      }
      return path; // [immediate parent, grandparent, ..., root block]
    };

    const truncate = (s, len) => (s.length > len ? s.slice(0, len) + "…" : s);

    const lines = [];
    let nb = 1;
    for (const result of results) {
      const content = result?.[":block/string"];
      const pageTitle = result?.[":block/page"]?.[":node/title"];

      if (!content) continue;

      // Parent path: root → immediate parent, each truncated to 50 chars
      const parentPath = getParentPath(result);
      const parentStr =
        parentPath.length > 0
          ? `${[...parentPath]
              .reverse()
              .map((s) => truncate(s, 50))
              .join(" > ")}`
          : "";

      // Children content up to maxCapturingDepth.refs levels (default 1)
      const uid = result?.[":block/uid"];
      const childDepth = maxCapturingDepth?.refs ?? 1;
      const childrenOutline = uid
        ? getFlattenedContentFromTree({
            parentUid: uid,
            maxCapturing: childDepth,
            withDash: true,
            isParentToIgnore: true,
            initialLeftShift: "  ",
          })
        : "";

      console.log("childrenOutline :>> ", childrenOutline);

      lines.push(
        `${nb++}. (uid: ${uid}) "${resolveReferences(content)}"\nPath: ${pageTitle ? `[[${pageTitle}]] > ` : ""}${parentStr}${childrenOutline.trim() ? `\nChildren blocks:\n${childrenOutline}` : "\n"}`,
      );
    }

    return lines.length ? lines.join("\n") : `(no results)`;
  } catch (error) {
    console.warn(
      `[QueryContext] Failed to execute Roam query "${queryExpression.slice(0, 60)}":`,
      error,
    );
    return `(query execution failed: ${error.message})`;
  }
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
    if (!results || results.length === 0) return `(no results)`;

    const varNames = parseFindVariables(datalogQuery);
    const lines = results.map((row, i) => {
      const enriched = enrichResultRow(
        Array.isArray(row) ? row : [row],
        varNames,
      );
      return `${i + 1}. ${enriched}`;
    });

    return `${results.length} result(s):\n${lines.join("\n")}`;
  } catch (error) {
    console.warn(
      `[QueryContext] Failed to execute :q Datomic query "${qQuery.slice(0, 60)}":`,
      error,
    );
    return `(query execution failed: ${error.message})`;
  }
};

/**
 * Scan prompt and context text for Roam queries and :q Datomic queries,
 * execute them, and return an additional context string with the results.
 */
export const getContextFromQueries = async ({
  prompt,
  context,
  model: _model,
  rootUid: _rootUid,
}) => {
  const textToScan = [
    typeof prompt === "string" ? prompt : JSON.stringify(prompt),
    context,
  ]
    .filter(Boolean)
    .join("\n\n");

  const resultParts = [];

  // 1. Handle Roam {{query:...}} blocks
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

  // 2. Handle :q Datomic queries
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

  // if (datomicQueries)
  //   resultParts.push("Extracting :q query results is not yet supported.");

  if (!resultParts.length) return null;

  return `Results from queries in context:\n\n${resultParts.join("\n\n")}`;
};
