/**
 * Extraction queries for the Color Highlighter tool.
 *
 * Strategy: `#c:blue` and `#.bg-red` are genuine Roam tags, so colored blocks
 * can be found through `:block/refs` on the corresponding tag pages — far
 * cheaper than scanning every `:block/string`.
 *
 * IMPORTANT: Roam resolves page references case-insensitively but stores a
 * single canonical casing. `#c:blue` and `#c:BLUE` are therefore the SAME page
 * entity, whose `:node/title` may be stored as either. An exact-title lookup
 * (the `getBlocksMentioningTitle` pattern) can silently return zero results, so
 * tag pages are resolved with a case-insensitive `re-find` instead.
 */

import { getPageUidByPageName } from "../../../../../utils/roamAPI";
import {
  parseBlockColors,
  parseColoredSpans,
  TAG_PAGE_TITLE_PATTERN,
  type ChColor,
  type ChFormat,
  type ChVariant,
} from "./syntax";

export type ChScope =
  | "current_context"
  | "block_subtree"
  | "page"
  | "dnp_range"
  | "graph";

export interface ExtractFilters {
  colors?: ChColor[];
  formats?: ChFormat[];
  variant?: ChVariant | "any";
}

export interface ExtractedItem {
  uid: string;
  pageTitle: string;
  pageUid: string;
  color: ChColor;
  variant: ChVariant;
  format: ChFormat;
  /** The colored text itself (inline formats) or the whole block (block formats). */
  text: string;
  /** Raw block string, for context. */
  blockContent: string;
}

interface Row {
  uid: string;
  content: string;
  pageUid: string;
  pageTitle: string;
}

const q = (query: string): any[] => {
  try {
    return (window as any).roamAlphaAPI.q(query) || [];
  } catch (e) {
    console.warn("[color_highlighter] query failed:", e, query);
    return [];
  }
};

/** Escape a string for safe inclusion in an EDN string literal. */
const edn = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

// ===========================================================================
// Scope clauses
// ===========================================================================

interface Scope {
  /** Extra `:where` clauses constraining `?b`. */
  where: string;
  /** Optional post-filter on the page uid (used for DNP ranges). */
  pageUids?: Set<string>;
  /** Block uid to include explicitly on top of its descendants. */
  rootUid?: string;
  error?: string;
}

export function buildScope(opts: {
  scope: ChScope;
  pageTitle?: string;
  blockUid?: string;
  dnpStart?: string;
  dnpEnd?: string;
}): Scope {
  switch (opts.scope) {
    case "graph":
      return { where: "" };

    case "page": {
      if (!opts.pageTitle)
        return { where: "", error: "page_title is required when scope is 'page'." };
      const pageUid = getPageUidByPageName(opts.pageTitle);
      if (!pageUid)
        return {
          where: "",
          error: `Page "${opts.pageTitle}" was not found in your graph.`,
        };
      return {
        where: `[?b :block/page ?scopePg] [?scopePg :block/uid "${edn(pageUid)}"]`,
      };
    }

    case "block_subtree": {
      if (!opts.blockUid)
        return {
          where: "",
          error: "block_uid is required when scope is 'block_subtree'.",
        };
      return {
        where: `[?b :block/parents ?scopeRoot] [?scopeRoot :block/uid "${edn(
          opts.blockUid,
        )}"]`,
        rootUid: opts.blockUid,
      };
    }

    case "dnp_range": {
      const uids = dnpUidsBetween(opts.dnpStart, opts.dnpEnd);
      if ("error" in uids) return { where: "", error: uids.error };
      return { where: "", pageUids: uids.set };
    }

    default:
      return { where: "" };
  }
}

/**
 * Enumerate daily-note page uids between two ISO dates, in JS rather than in
 * Datalog — Roam stores DNP uids as MM-DD-YYYY strings, which cannot be range
 * compared in a query.
 */
function dnpUidsBetween(
  start?: string,
  end?: string,
): { set: Set<string> } | { error: string } {
  if (!start || !end)
    return { error: "dnp_start and dnp_end (YYYY-MM-DD) are required when scope is 'dnp_range'." };
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  if (isNaN(from.getTime()) || isNaN(to.getTime()))
    return { error: "dnp_start and dnp_end must be ISO dates (YYYY-MM-DD)." };
  if (from > to) return { error: "dnp_start must be before or equal to dnp_end." };

  const MAX_DAYS = 400;
  const set = new Set<string>();
  const cursor = new Date(from);
  let guard = 0;
  while (cursor <= to && guard++ < MAX_DAYS) {
    set.add((window as any).roamAlphaAPI.util.dateToPageUid(new Date(cursor)));
    cursor.setDate(cursor.getDate() + 1);
  }
  if (guard >= MAX_DAYS)
    return { error: `The daily notes range is too wide (max ${MAX_DAYS} days).` };
  return { set };
}

// ===========================================================================
// Phase A — resolve the tag pages that actually exist (case-insensitively)
// ===========================================================================

export function resolveTagPages(colors?: ChColor[]): { title: string; uid: string }[] {
  const pattern = TAG_PAGE_TITLE_PATTERN(colors);
  const rows = q(`[:find ?title ?uid
    :where
    [(re-pattern "${edn(pattern)}") ?pat]
    [?p :node/title ?title]
    [(re-find ?pat ?title)]
    [?p :block/uid ?uid]]`);
  return rows.map(([title, uid]: [string, string]) => ({ title, uid }));
}

// ===========================================================================
// Phase B — blocks referencing a tag page, within scope
// ===========================================================================

const ROW_FIND = `[:find ?uid ?str ?pageUid ?pageTitle`;
const ROW_TAIL = `[?b :block/uid ?uid]
    [?b :block/string ?str]
    [?b :block/page ?pg]
    [?pg :block/uid ?pageUid]
    [?pg :node/title ?pageTitle]]`;

const toRows = (rows: any[]): Row[] =>
  rows.map(([uid, content, pageUid, pageTitle]: any[]) => ({
    uid,
    content,
    pageUid,
    pageTitle,
  }));

function blocksReferencingTag(tagUid: string, scope: Scope): Row[] {
  return toRows(
    q(`${ROW_FIND}
    :where
    [?tag :block/uid "${edn(tagUid)}"]
    [?b :block/refs ?tag]
    ${scope.where}
    ${ROW_TAIL}`),
  );
}

/** Fallback: scan block strings for the literal markers. */
function blocksContainingMarker(marker: string, scope: Scope): Row[] {
  return toRows(
    q(`${ROW_FIND}
    :where
    [?b :block/string ?str]
    [(clojure.string/includes? ?str "${edn(marker)}")]
    ${scope.where}
    ${ROW_TAIL}`),
  );
}

function blockRowByUid(uid: string): Row | null {
  const rows = toRows(
    q(`${ROW_FIND}
    :where
    [?b :block/uid "${edn(uid)}"]
    ${ROW_TAIL}`),
  );
  return rows[0] ?? null;
}

// ===========================================================================
// Phase C — parse and filter
// ===========================================================================

function matchesFilters(
  color: ChColor,
  variant: ChVariant,
  format: ChFormat,
  f: ExtractFilters,
): boolean {
  if (f.colors?.length && !f.colors.includes(color)) return false;
  if (f.formats?.length && !f.formats.includes(format)) return false;
  if (f.variant && f.variant !== "any" && f.variant !== variant) return false;
  return true;
}

function itemsFromRow(row: Row, filters: ExtractFilters): ExtractedItem[] {
  const out: ExtractedItem[] = [];
  const base = {
    uid: row.uid,
    pageTitle: row.pageTitle,
    pageUid: row.pageUid,
    blockContent: row.content,
  };

  for (const span of parseColoredSpans(row.content)) {
    if (!matchesFilters(span.color, span.variant, span.format, filters)) continue;
    out.push({ ...base, color: span.color, variant: span.variant, format: span.format, text: span.text });
  }
  for (const bc of parseBlockColors(row.content)) {
    if (!matchesFilters(bc.color, bc.variant, bc.format, filters)) continue;
    out.push({
      ...base,
      color: bc.color,
      variant: bc.variant,
      format: bc.format,
      text: row.content.replace(bc.raw, "").trim(),
    });
  }
  return out;
}

// ===========================================================================
// Public entry point
// ===========================================================================

export function extractColoredContent(opts: {
  scope: ChScope;
  filters: ExtractFilters;
  pageTitle?: string;
  blockUid?: string;
  dnpStart?: string;
  dnpEnd?: string;
  /** Block uids of the current chat results, for scope "current_context". */
  contextUids?: string[];
}): { items: ExtractedItem[]; error?: string } {
  const scope = buildScope(opts);
  if (scope.error) return { items: [], error: scope.error };

  let rows: Row[] = [];

  if (opts.scope === "current_context") {
    for (const uid of opts.contextUids ?? []) {
      const row = blockRowByUid(uid);
      if (row) rows.push(row);
    }
  } else {
    // Primary path: :block/refs on the resolved tag pages.
    for (const page of resolveTagPages(opts.filters.colors)) {
      rows.push(...blocksReferencingTag(page.uid, scope));
    }

    // Fallback string scan. Always run for narrow scopes (cheap, and it catches
    // blocks whose refs were not indexed); graph-wide only when refs found
    // nothing, since an unbounded `includes?` scan is the expensive path.
    const narrow = opts.scope !== "graph" && opts.scope !== "dnp_range";
    if (narrow || rows.length === 0) {
      for (const marker of ["#c:", "#.bg-", "#.box-"]) {
        rows.push(...blocksContainingMarker(marker, scope));
      }
    }

    if (scope.rootUid) {
      const root = blockRowByUid(scope.rootUid);
      if (root) rows.push(root);
    }
  }

  // Dedupe by uid, then restrict to the DNP page set when relevant.
  const byUid = new Map<string, Row>();
  for (const r of rows) {
    if (scope.pageUids && !scope.pageUids.has(r.pageUid)) continue;
    byUid.set(r.uid, r);
  }

  const items: ExtractedItem[] = [];
  for (const row of byUid.values()) items.push(...itemsFromRow(row, opts.filters));

  return { items };
}
