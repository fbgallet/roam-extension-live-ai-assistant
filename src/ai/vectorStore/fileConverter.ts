/**
 * File Converter for Vector Store
 *
 * Performance-optimized approach:
 * 1. Convert all pages to markdown locally (fast, synchronous)
 * 2. Bundle pages into a few large files (~500KB each)
 * 3. Upload just those few files (5-10 API calls instead of thousands)
 *
 * Handles:
 * - Mode A: Live Roam graph indexing via roamAlphaAPI
 * - Mode B: Roam export parsing (msgpack/JSON)
 * - Mode C: Regular file pass-through
 */

import {
  VectorStoreManifest,
  ProgressCallback,
  IndexingProgress,
  RoamExportPage,
  RoamExportBlock,
} from "./types";
import {
  getOrCreateVectorStore,
  uploadRoamBundles,
  getManifest,
} from "./vectorStoreService";

// @ts-ignore - JS module
import { getTreeByUid, getBlockContentByUid } from "../../utils/roamAPI";
// @ts-ignore - JS module
import { exclusionStrings } from "../../index";

// Regex matching Roam block references ((uid)) — 9-char UIDs
const BLOCK_REF_REGEX = /\(\(([^\)\s]{9})\)\)/g;

// Target bundle size in characters (~500KB, well under OpenAI's limits)
const BUNDLE_TARGET_SIZE = 500_000;

/** Detect DNP by page UID format: MM-DD-YYYY (e.g. "03-29-2026") */
function isDailyNoteUid(pageUid: string): boolean {
  return /^\d{2}-\d{2}-\d{4}$/.test(pageUid);
}

/** Detect DNP by page title matching Roam date format (e.g. "February 26th, 2026") */
function isDailyNoteTitle(title: string): boolean {
  return /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(st|nd|rd|th),\s+\d{4}$/.test(title);
}

/** Parse DNP UID (MM-DD-YYYY) to timestamp for chronological sorting */
function parseDnpUid(uid: string): number {
  const match = uid.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (match) return new Date(+match[3], +match[1] - 1, +match[2]).getTime();
  return 0;
}

const MONTH_MAP: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
};

/** Parse DNP title (e.g. "February 26th, 2026") to timestamp for sorting */
function parseDnpTitle(title: string): number {
  const match = title.match(/^(\w+)\s+(\d+)\w+,\s+(\d{4})$/);
  if (match) return new Date(+match[3], MONTH_MAP[match[1]] ?? 0, +match[2]).getTime();
  return 0;
}

// ============================================================
// Mode A: Live Roam Graph Indexing
// ============================================================

/** Query all pages with max edit time across page + all descendant blocks */
function queryAllPages(): Array<{
  title: string;
  uid: string;
  editTime: number;
}> {
  // Use (max ?edit-time) to capture edits to any block on the page,
  // not just changes to the page entity itself.
  const results = (window as any).roamAlphaAPI.q(`
    [:find ?title ?uid (max ?edit-time)
     :where
       [?page :node/title ?title]
       [?page :block/uid ?uid]
       (or-join [?page ?edit-time]
         (and [?page :edit/time ?edit-time])
         (and [?b :block/page ?page]
              [?b :edit/time ?edit-time]))]
  `);

  return (results || []).map((r: any[]) => ({
    title: r[0],
    uid: r[1],
    editTime: r[2] || 0,
  }));
}

/** Index the Roam graph into the vector store (bundled, fast) */
export async function indexRoamGraph(
  onProgress?: ProgressCallback,
  databaseId?: string
): Promise<void> {
  const progress: IndexingProgress = {
    phase: "querying",
    total: 0,
    processed: 0,
    newPages: 0,
    updatedPages: 0,
    unchangedPages: 0,
    deletedPages: 0,
  };
  onProgress?.(progress);

  // Step 1: Query all pages
  const pages = queryAllPages();
  const oldManifest = getManifest(databaseId);

  progress.phase = "diffing";
  progress.total = pages.length;
  onProgress?.(progress);

  // Step 2: Check what changed
  let hasChanges = false;
  const newManifest: VectorStoreManifest = {};

  for (const page of pages) {
    const existing = oldManifest[page.title];
    if (!existing) {
      hasChanges = true;
      progress.newPages++;
    } else if (page.editTime > existing.lastEditTime) {
      hasChanges = true;
      progress.updatedPages++;
    } else {
      progress.unchangedPages++;
    }
    newManifest[page.title] = {
      lastEditTime: page.editTime,
      pageUid: page.uid,
    };
  }

  // Check for deleted pages
  for (const title of Object.keys(oldManifest)) {
    if (!newManifest[title]) {
      hasChanges = true;
      progress.deletedPages++;
    }
  }

  if (!hasChanges) {
    progress.phase = "done";
    onProgress?.(progress);
    return;
  }

  // Step 3: Convert ALL pages to markdown (local, fast)
  // Separate DNP (daily notes) from regular pages for distinct bundles
  progress.phase = "converting";
  progress.total = pages.length;
  progress.processed = 0;
  onProgress?.(progress);

  const dnpEntries: Array<{ md: string; uid: string }> = [];
  const pageMarkdown: string[] = [];

  for (const page of pages) {
    progress.currentPage = page.title;
    progress.processed++;
    if (progress.processed % 50 === 0) onProgress?.(progress);

    try {
      const tree = getTreeByUid(page.uid);
      if (!tree || !tree[0]) continue;

      const md = pageTreeToMarkdown(page.title, tree[0]);
      if (md.trim().split("\n").length > 1) {
        if (isDailyNoteUid(page.uid) || isDailyNoteTitle(page.title)) {
          dnpEntries.push({ md, uid: page.uid });
        } else {
          pageMarkdown.push(md);
        }
      }
    } catch {
      // Skip problematic pages
    }
  }

  // Sort DNPs chronologically so bundles contain contiguous date ranges
  dnpEntries.sort((a, b) => parseDnpUid(a.uid) - parseDnpUid(b.uid));
  const dnpMarkdown = dnpEntries.map((e) => e.md);

  onProgress?.(progress);

  // Step 4: Bundle into large files (DNP and pages separately)
  const bundles = [
    ...bundleMarkdown(pageMarkdown, "roam-pages"),
    ...bundleMarkdown(dnpMarkdown, "roam-dnp"),
  ];

  // Step 5: Upload bundles (replaces previous Roam bundles)
  progress.phase = "uploading";
  progress.total = bundles.length;
  progress.processed = 0;
  onProgress?.(progress);

  await getOrCreateVectorStore(databaseId);
  await uploadRoamBundles(bundles, newManifest, (uploaded, _total) => {
    progress.processed = uploaded;
    onProgress?.(progress);
  }, databaseId);

  progress.phase = "done";
  onProgress?.(progress);
}

// ============================================================
// Mode B: Roam Export Upload (msgpack/JSON)
// ============================================================

/** Parse a Roam export file and index (bundled) */
export async function indexRoamExport(
  file: File,
  onProgress?: ProgressCallback,
  databaseId?: string
): Promise<void> {
  const progress: IndexingProgress = {
    phase: "querying",
    total: 0,
    processed: 0,
    newPages: 0,
    updatedPages: 0,
    unchangedPages: 0,
    deletedPages: 0,
  };
  onProgress?.(progress);

  let pages: RoamExportPage[];

  if (file.name.endsWith(".msgpack")) {
    const { decode } = await import("@msgpack/msgpack");
    const buffer = await file.arrayBuffer();
    pages = decode(new Uint8Array(buffer)) as RoamExportPage[];
  } else {
    const text = await file.text();
    pages = JSON.parse(text) as RoamExportPage[];
  }

  if (!Array.isArray(pages)) {
    throw new Error(
      "Invalid Roam export: expected an array of pages at the top level."
    );
  }

  // Build manifest and check changes
  const oldManifest = getManifest(databaseId);
  const newManifest: VectorStoreManifest = {};
  let hasChanges = false;

  for (const page of pages) {
    const maxEditTime = getMaxEditTime(page);
    const existing = oldManifest[page.title];
    if (!existing) {
      hasChanges = true;
      progress.newPages++;
    } else if (maxEditTime > existing.lastEditTime) {
      hasChanges = true;
      progress.updatedPages++;
    } else {
      progress.unchangedPages++;
    }
    newManifest[page.title] = {
      lastEditTime: maxEditTime,
      pageUid: page.children?.[0]?.uid || page.title,
    };
  }

  for (const title of Object.keys(oldManifest)) {
    if (!newManifest[title]) {
      hasChanges = true;
      progress.deletedPages++;
    }
  }

  if (!hasChanges) {
    progress.phase = "done";
    onProgress?.(progress);
    return;
  }

  // Convert all pages to markdown, separating DNP from regular pages
  progress.phase = "converting";
  progress.total = pages.length;
  progress.processed = 0;
  onProgress?.(progress);

  const dnpEntries: Array<{ md: string; title: string }> = [];
  const pageMarkdown: string[] = [];

  for (const page of pages) {
    progress.processed++;
    if (progress.processed % 50 === 0) onProgress?.(progress);

    const md = exportPageToMarkdown(page);
    if (md.trim().split("\n").length > 1) {
      if (isDailyNoteTitle(page.title)) {
        dnpEntries.push({ md, title: page.title });
      } else {
        pageMarkdown.push(md);
      }
    }
  }

  // Sort DNPs chronologically so bundles contain contiguous date ranges
  dnpEntries.sort((a, b) => parseDnpTitle(a.title) - parseDnpTitle(b.title));
  const dnpMarkdown = dnpEntries.map((e) => e.md);

  // Bundle and upload (DNP and pages separately)
  const bundles = [
    ...bundleMarkdown(pageMarkdown, "roam-pages"),
    ...bundleMarkdown(dnpMarkdown, "roam-dnp"),
  ];

  progress.phase = "uploading";
  progress.total = bundles.length;
  progress.processed = 0;
  onProgress?.(progress);

  await getOrCreateVectorStore(databaseId);
  await uploadRoamBundles(bundles, newManifest, (uploaded) => {
    progress.processed = uploaded;
    onProgress?.(progress);
  }, databaseId);

  progress.phase = "done";
  onProgress?.(progress);
}

// ============================================================
// Mode C: Detect file format
// ============================================================

const DIRECT_UPLOAD_EXTENSIONS = new Set([
  ".pdf", ".docx", ".doc", ".txt", ".md", ".html", ".csv", ".json",
  ".js", ".ts", ".py", ".c", ".cpp", ".java", ".go", ".rb", ".php",
  ".sh", ".tex", ".css", ".pptx",
]);

export type FileFormat = "roam-msgpack" | "roam-json" | "direct" | "unsupported";

export function detectFormat(file: File): FileFormat {
  const name = file.name.toLowerCase();
  if (name.endsWith(".msgpack")) return "roam-msgpack";
  for (const ext of DIRECT_UPLOAD_EXTENSIONS) {
    if (name.endsWith(ext)) return "direct";
  }
  return "unsupported";
}

export async function isRoamJsonExport(file: File): Promise<boolean> {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    return (
      Array.isArray(data) &&
      data.length > 0 &&
      typeof data[0].title === "string"
    );
  } catch {
    return false;
  }
}

// ============================================================
// Bundling
// ============================================================

/**
 * Bundle markdown strings into ~500KB chunks.
 * @param prefix - file name prefix, e.g. "roam-pages" or "roam-dnp"
 */
function bundleMarkdown(
  markdownPages: string[],
  prefix: string = "roam-graph"
): Array<{ content: string; name: string }> {
  const bundles: Array<{ content: string; name: string }> = [];
  let current = "";
  let bundleIndex = 1;

  for (const md of markdownPages) {
    if (current.length + md.length > BUNDLE_TARGET_SIZE && current.length > 0) {
      bundles.push({
        content: current,
        name: `${prefix}-${bundleIndex}.md`,
      });
      bundleIndex++;
      current = "";
    }
    current += md + "\n\n---\n\n";
  }

  if (current.length > 0) {
    bundles.push({
      content: current,
      name: `${prefix}-${bundleIndex}.md`,
    });
  }

  return bundles;
}

// ============================================================
// Markdown Conversion
// ============================================================

/** Convert a live Roam page tree to Markdown */
function pageTreeToMarkdown(title: string, tree: any): string {
  // PAGE marker allows reliable title extraction even after OpenAI chunking
  let md = `<!-- PAGE: ${title} -->\n# ${title}\n\n`;
  const children = tree[":block/children"] || tree.children;
  if (!children || !Array.isArray(children)) return md;

  const sorted = [...children].sort(
    (a: any, b: any) =>
      (a[":block/order"] ?? a.order ?? 0) -
      (b[":block/order"] ?? b.order ?? 0)
  );

  const excludeList: string[] = exclusionStrings || [];

  for (const child of sorted) {
    // If a top-level block matches an exclusion string and has no children,
    // treat it as a "stop marker": ignore it and all following siblings.
    if (excludeList.length > 0) {
      const blockContent = child[":block/string"] || child.string || "";
      const blockChildren = child[":block/children"] || child.children;
      const hasChildren = blockChildren && Array.isArray(blockChildren) && blockChildren.length > 0;
      if (!hasChildren && excludeList.some((str: string) => blockContent.includes(str))) {
        break;
      }
    }
    md += blockToMarkdown(child, 0, true);
  }

  return md;
}

/** Convert a block and its children to Markdown.
 *  Skips blocks (and all their children) that match any exclusionStrings. */
function blockToMarkdown(
  block: any,
  depth: number,
  isLiveApi: boolean
): string {
  const content = isLiveApi
    ? block[":block/string"] || block.string || ""
    : block.string || "";

  // Check exclusion: if block content contains any exclusion string, skip it and all children
  const excludeList: string[] = exclusionStrings || [];
  if (excludeList.length > 0 && excludeList.some((str: string) => content.includes(str))) {
    return "";
  }

  const indent = "  ".repeat(depth);
  const uid = isLiveApi
    ? block[":block/uid"] || block.uid
    : block.uid;

  const resolved = isLiveApi
    ? resolveBlockRefsLive(content)
    : resolveBlockRefsExport(content);

  let md = `${indent}- [uid:${uid}] ${resolved}\n`;

  const children = isLiveApi
    ? block[":block/children"] || block.children
    : block.children;

  if (children && Array.isArray(children)) {
    const sorted = [...children].sort(
      (a: any, b: any) =>
        (isLiveApi
          ? (a[":block/order"] ?? 0) - (b[":block/order"] ?? 0)
          : (a.order ?? 0) - (b.order ?? 0))
    );
    for (const child of sorted) {
      md += blockToMarkdown(child, depth + 1, isLiveApi);
    }
  }

  return md;
}

/** Resolve ((uid)) block references using live Roam API — one level only */
function resolveBlockRefsLive(content: string): string {
  return content.replace(BLOCK_REF_REGEX, (match, uid) => {
    try {
      const resolved = getBlockContentByUid(uid);
      if (resolved) return resolved;
    } catch {
      // Fallback
    }
    return match;
  });
}

/** Resolve block refs in export data */
function resolveBlockRefsExport(content: string): string {
  if ((window as any).roamAlphaAPI) {
    return resolveBlockRefsLive(content);
  }
  return content;
}

/** Convert an export page to Markdown */
function exportPageToMarkdown(page: RoamExportPage): string {
  let md = `<!-- PAGE: ${page.title} -->\n# ${page.title}\n\n`;
  if (!page.children || page.children.length === 0) return md;

  const sorted = [...page.children].sort(
    (a, b) => ((a as any).order ?? 0) - ((b as any).order ?? 0)
  );

  const excludeList: string[] = exclusionStrings || [];

  for (const child of sorted) {
    // Stop marker: top-level childless block matching exclusion string
    if (excludeList.length > 0) {
      const blockContent = child.string || "";
      const hasChildren = child.children && child.children.length > 0;
      if (!hasChildren && excludeList.some((str: string) => blockContent.includes(str))) {
        break;
      }
    }
    md += blockToMarkdown(child, 0, false);
  }

  return md;
}

/** Get the maximum edit-time across a page and all descendant blocks */
function getMaxEditTime(page: RoamExportPage): number {
  let maxTime = page["edit-time"] || 0;

  function walkBlocks(blocks?: RoamExportBlock[]) {
    if (!blocks) return;
    for (const block of blocks) {
      if (block["edit-time"] && block["edit-time"] > maxTime) {
        maxTime = block["edit-time"];
      }
      walkBlocks(block.children);
    }
  }

  walkBlocks(page.children);
  return maxTime;
}
