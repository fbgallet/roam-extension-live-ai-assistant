/**
 * File Converter for Vector Store
 *
 * Handles conversion of Roam pages to markdown and indexing into
 * both OpenAI and Local vector store providers.
 *
 * - OpenAI: Bundles pages into ~500KB files for upload
 * - Local: Passes individual pages for per-page embedding
 *
 * Modes:
 * - Mode A: Live Roam graph indexing via roamAlphaAPI
 * - Mode B: Roam export parsing (msgpack/JSON)
 * - Mode C: Regular file pass-through
 */

import {
  VectorStoreManifest,
  ProgressCallback,
  IndexingProgress,
  PageDocument,
  RoamExportPage,
  RoamExportBlock,
} from "./types";
import {
  getOrCreateVectorStore,
  uploadRoamBundles,
  getManifest,
  getDatabaseProvider,
  getDatabaseEmbeddingModel,
  saveLocalIndexState,
} from "./vectorStoreService";
import { indexPages } from "./providers/local/localProvider";

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

/** Index the Roam graph — routes to OpenAI (bundled) or Local (per-page) */
export async function indexRoamGraph(
  onProgress?: ProgressCallback,
  databaseId?: string,
  signal?: AbortSignal
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

  // Step 3: Convert ALL pages to markdown
  progress.phase = "converting";
  progress.total = pages.length;
  progress.processed = 0;
  onProgress?.(progress);

  const pageDocuments: PageDocument[] = [];
  const dnpEntries: Array<{ doc: PageDocument; sortKey: number }> = [];
  const regularMarkdown: string[] = [];
  const dnpMarkdown: Array<{ md: string; uid: string }> = [];

  for (const page of pages) {
    progress.currentPage = page.title;
    progress.processed++;
    if (progress.processed % 50 === 0) onProgress?.(progress);

    try {
      const tree = getTreeByUid(page.uid);
      if (!tree || !tree[0]) continue;

      const md = pageTreeToMarkdown(page.title, tree[0]);
      if (hasSubstantialContent(md)) {
        const isDnp = isDailyNoteUid(page.uid) || isDailyNoteTitle(page.title);

        // Collect for both providers
        pageDocuments.push({
          title: page.title,
          uid: page.uid,
          markdown: md,
          isDnp,
        });

        if (isDnp) {
          dnpMarkdown.push({ md, uid: page.uid });
        } else {
          regularMarkdown.push(md);
        }
      }
    } catch {
      // Skip problematic pages
    }
  }

  onProgress?.(progress);

  // Determine provider and route accordingly
  const provider = getDatabaseProvider(databaseId);

  if (provider === "local") {
    // Local provider: pass individual pages for per-page embedding
    const embeddingModel = getDatabaseEmbeddingModel(databaseId);
    await indexPages(
      databaseId!,
      pageDocuments,
      oldManifest,
      newManifest,
      onProgress,
      embeddingModel,
      signal
    );
    if (!signal?.aborted) {
      await saveLocalIndexState(newManifest, databaseId!);
    }
  } else {
    // OpenAI provider: bundle and upload
    // Sort DNPs reverse-chronologically
    dnpMarkdown.sort((a, b) => parseDnpUid(b.uid) - parseDnpUid(a.uid));
    const sortedDnpMd = dnpMarkdown.map((e) => e.md);

    const bundles = [
      ...bundleMarkdown(regularMarkdown, "roam-pages"),
      ...bundleMarkdown(sortedDnpMd, "roam-dnp"),
    ];

    progress.phase = "uploading";
    progress.total = bundles.length;
    progress.processed = 0;
    progress.currentPage = undefined;
    onProgress?.(progress);

    await getOrCreateVectorStore(databaseId);
    await uploadRoamBundles(bundles, newManifest, (uploaded, _total) => {
      progress.processed = uploaded;
      onProgress?.(progress);
    }, databaseId);

    progress.phase = "done";
    onProgress?.(progress);
  }
}

// ============================================================
// Mode B: Roam Export Upload (msgpack/JSON)
// ============================================================

/** Parse a Roam export file and index */
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

  progress.phase = "converting";
  progress.total = pages.length;
  progress.processed = 0;
  onProgress?.(progress);

  const pageDocuments: PageDocument[] = [];
  const dnpEntries: Array<{ md: string; title: string }> = [];
  const pageMarkdown: string[] = [];

  for (const page of pages) {
    progress.processed++;
    if (progress.processed % 50 === 0) onProgress?.(progress);

    const md = exportPageToMarkdown(page);
    if (hasSubstantialContent(md)) {
      const isDnp = isDailyNoteTitle(page.title);

      pageDocuments.push({
        title: page.title,
        uid: page.children?.[0]?.uid || page.title,
        markdown: md,
        isDnp,
      });

      if (isDnp) {
        dnpEntries.push({ md, title: page.title });
      } else {
        pageMarkdown.push(md);
      }
    }
  }

  const provider = getDatabaseProvider(databaseId);

  if (provider === "local") {
    const embeddingModel = getDatabaseEmbeddingModel(databaseId);
    await indexPages(
      databaseId!,
      pageDocuments,
      oldManifest,
      newManifest,
      onProgress,
      embeddingModel,
      undefined // no cancel support for export
    );
    await saveLocalIndexState(newManifest, databaseId!);
  } else {
    // Sort DNPs reverse-chronologically
    dnpEntries.sort((a, b) => parseDnpTitle(b.title) - parseDnpTitle(a.title));
    const dnpMarkdown = dnpEntries.map((e) => e.md);

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

/**
 * Check if a page markdown has meaningful content beyond just the header.
 * Strips PAGE markers, title heading, uid markers, and whitespace,
 * then checks if anything substantial remains.
 * Filters out empty pages used only as tags/references in Roam.
 */
function hasSubstantialContent(md: string): boolean {
  const stripped = md
    .replace(/<!-- PAGE: .+? -->\n?/g, "")
    .replace(/^#\s+.+\n*/m, "")
    .replace(/\[uid:[^\]]+\]\s*/g, "")
    .replace(/^[\s\-]*/gm, "")
    .trim();
  return stripped.length > 0;
}

// ============================================================
// Bundling (OpenAI provider only)
// ============================================================

/** Preamble headers for bundle files — helps OpenAI's chunker understand the structure */
const BUNDLE_PREAMBLE: Record<string, string> = {
  "roam-pages": `# Roam Research Graph — Pages

This file contains pages from a Roam Research knowledge graph.
Each page starts with a <!-- PAGE: Title --> marker followed by a # heading.
Blocks are listed as bullet points with [uid:xxx] markers for traceability.
Indented bullets are child blocks. Pages are separated by double --- lines.
IMPORTANT: Each page is a self-contained document. Do NOT merge content across --- separators.

---

`,
  "roam-dnp": `# Roam Research Graph — Daily Notes

This file contains Daily Note Pages (DNPs) from a Roam Research knowledge graph, sorted from most recent to oldest.
Each daily note starts with a <!-- PAGE: Date --> marker followed by a # heading with the date.
Blocks are listed as bullet points with [uid:xxx] markers for traceability.
Indented bullets are child blocks. Daily notes are separated by double --- lines.
IMPORTANT: Each daily note is a self-contained document. Do NOT merge content across --- separators.

---

`,
};

function bundleMarkdown(
  markdownPages: string[],
  prefix: string = "roam-graph"
): Array<{ content: string; name: string }> {
  const bundles: Array<{ content: string; name: string }> = [];
  const preamble = BUNDLE_PREAMBLE[prefix] || "";
  let current = preamble;
  let bundleIndex = 1;

  for (const md of markdownPages) {
    if (current.length + md.length > BUNDLE_TARGET_SIZE && current.length > preamble.length) {
      bundles.push({
        content: current,
        name: `${prefix}-${bundleIndex}.md`,
      });
      bundleIndex++;
      current = preamble;
    }
    current += md + "\n\n---\n\n---\n\n";
  }

  if (current.length > preamble.length) {
    bundles.push({
      content: current,
      name: `${prefix}-${bundleIndex}.md`,
    });
  }

  return bundles;
}

// ============================================================
// Markdown Conversion (shared by both providers)
// ============================================================

/** Convert a live Roam page tree to Markdown */
function pageTreeToMarkdown(title: string, tree: any): string {
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

/** Convert a block and its children to Markdown */
function blockToMarkdown(
  block: any,
  depth: number,
  isLiveApi: boolean
): string {
  const content = isLiveApi
    ? block[":block/string"] || block.string || ""
    : block.string || "";

  const excludeList: string[] = exclusionStrings || [];
  if (excludeList.length > 0 && excludeList.some((str: string) => content.includes(str))) {
    return "";
  }

  const indent = "  ".repeat(depth);
  const uid = isLiveApi
    ? block[":block/uid"] || block.uid
    : block.uid;

  const resolved = cleanForIndexing(
    isLiveApi
      ? resolveBlockRefsLive(content)
      : resolveBlockRefsExport(content)
  );

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

/**
 * Clean block content for vector indexing:
 * - Remove #c:COLOR styling tags (e.g. #c:red, #c:blue)
 * - Remove #.xxx formatting tags (e.g. #.bg-red, #.bg-ch-blue, #.box-green)
 * - Remove code blocks (triple backtick fenced blocks)
 * - Remove inline code backticks wrapper (keep the text inside)
 */
function cleanForIndexing(text: string): string {
  // Skip blocks that are datalog queries (start with :q )
  if (text.trimStart().startsWith(":q ")) return "";

  return text
    // Remove fenced code blocks (``` ... ```) including content
    .replace(/```[\s\S]*?```/g, "")
    // Remove {{[[query]]: ...}} blocks
    .replace(/\{\{\[\[query\]\]\s*:.*?\}\}/g, "")
    // Remove #c:COLOR tags
    .replace(/#c:\w+/g, "")
    // Remove #.xxx formatting tags (e.g. #.bg-red, #.bg-ch-blue, #.box-green, #.box-ch-red)
    .replace(/#\.\S+/g, "")
    // Remove URLs (keep link text from markdown links [text](url))
    .replace(/\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    // Collapse multiple spaces left by removals
    .replace(/  +/g, " ")
    .trim();
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
