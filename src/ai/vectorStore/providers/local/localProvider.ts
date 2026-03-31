/**
 * Local Vector Store Provider — Orama + Transformers.js
 *
 * Stores vectors and text locally using Orama (in-browser search engine)
 * with IndexedDB persistence. Embeddings generated locally via Transformers.js.
 * No API key, no external service, completely free.
 *
 * Key features:
 * - Contextual chunking: pages split into ~400-token chunks at block boundaries
 * - Each chunk carries a context prefix: [Page: Title > top block]
 * - Clean text for embedding/BM25, raw markdown preserved for UID extraction
 * - Hybrid search: BM25 keyword + vector similarity
 * - True incremental updates (insert/update/delete individual pages)
 * - Zero configuration for users
 */

import {
  create,
  insertMultiple,
  removeMultiple,
  search as oramaSearch,
  save,
  load,
  count,
} from "@orama/orama";
import type { AnyOrama } from "@orama/orama";

import {
  embedTexts,
  embedQuery,
  dispose as disposeEmbedding,
  EMBEDDING_DIMENSIONS,
} from "./embeddingService";

import type {
  VectorSearchResult,
  VectorSearchSource,
  VectorSearchOptions,
  VectorStoreManifest,
  PageDocument,
  LocalEmbeddingModel,
  ProgressCallback,
  IndexingProgress,
} from "../../types";

// ============================================================
// Constants
// ============================================================

const IDB_NAME = "liveai-vectorstore";
const IDB_STORE = "orama-dbs";
const IDB_VERSION = 1;

/** Approximate token budget per chunk (bge-small-en-v1.5 has 512 token window) */
const CHUNK_TOKEN_BUDGET = 400;

// ============================================================
// Orama schema
// ============================================================

const ORAMA_SCHEMA = {
  title: "string" as const,
  /** Clean text for BM25 search (no uid markers, no PAGE comments) */
  content: "string" as const,
  /** Comma-separated block UIDs contained in this chunk */
  chunkUids: "string" as const,
  pageUid: "string" as const,
  /** UID of the top-level block this chunk belongs to */
  blockUid: "string" as const,
  source: "string" as const,
  isDnp: "boolean" as const,
  embedding: `vector[${EMBEDDING_DIMENSIONS}]` as const,
};

// ============================================================
// Chunking
// ============================================================

interface ChunkDoc {
  title: string;
  pageUid: string;
  blockUid: string;
  content: string;
  /** Comma-separated block UIDs in this chunk */
  chunkUids: string;
  isDnp: boolean;
}

/** Rough token estimate: ~4 characters per token for English text */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Extract all [uid:xxx] from raw markdown lines */
function extractUids(rawLines: string[]): string {
  const uids: string[] = [];
  for (const line of rawLines) {
    const m = line.match(/\[uid:([^\]]+)\]/);
    if (m) uids.push(m[1]);
  }
  return uids.join(",");
}

/**
 * Strip Roam syntax noise from markdown for clean embedding/BM25 text.
 * Preserves the semantic content while removing formatting artifacts.
 */
function cleanText(md: string): string {
  return md
    // Internal markers
    .replace(/<!-- PAGE: .+? -->\n?/g, "")
    .replace(/^#\s+.+\n*/m, "")
    .replace(/\[uid:[^\]]+\]\s*/g, "")
    // Roam page refs: [[page name]] → page name
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    // Roam tags: #[[multi word]] → multi word, #tag → tag
    .replace(/#\[\[([^\]]+)\]\]/g, "$1")
    .replace(/#(\w+)/g, "$1")
    // Roam TODO/DONE macros
    .replace(/\{\{\[\[TODO\]\]\}\}/g, "TODO")
    .replace(/\{\{\[\[DONE\]\]\}\}/g, "DONE")
    // Roam video embeds
    .replace(/\{\{\[\[video\]\]:.*?\}\}/g, "")
    // SmartBlock commands
    .replace(/\{\{[^}]*:SmartBlock:[^}]*\}\}/g, "")
    // Roam layout macros (no semantic value)
    .replace(/\{\{\[\[(table|kanban|embed|diagram|slider|word-count|date|calc)\]\](:.*?)?\}\}/g, "")
    // Roam embeds: {{embed: ((uid))}} — already resolved, strip wrapper
    .replace(/\{\{embed:\s*\(\([^\)]+\)\)\s*\}\}/g, "")
    // Roam attributes: Key:: Value → Key: Value
    .replace(/::/g, ":")
    // Markdown bold/italic/highlight
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\^\^(.+?)\^\^/g, "$1")
    // Markdown links: [text](url) → text
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    // Markdown images (no text value)
    .replace(/!\[([^\]]*)\]\([^\)]+\)/g, "$1")
    // Bullet list prefixes
    .replace(/^\s*-\s/gm, "")
    // Clean up multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Split a page into contextual chunks at block boundaries.
 *
 * Strategy:
 * 1. Group content by top-level block (depth 0) + its children
 * 2. Each section gets a context prefix: [Page: Title > top block text]
 * 3. If a section fits within CHUNK_TOKEN_BUDGET → one chunk
 * 4. If too large → split at child block boundaries with same prefix
 * 5. If a single block exceeds the budget → split mid-text with overlap
 */
function chunkPage(page: PageDocument): ChunkDoc[] {
  const chunks: ChunkDoc[] = [];
  const lines = page.markdown.split("\n");

  // Find where blocks start (skip <!-- PAGE --> and # Title lines)
  let contentStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("- [uid:")) {
      contentStart = i;
      break;
    }
  }
  if (contentStart < 0) return chunks;

  // Parse into top-level sections
  const sections: Array<{ uid: string; text: string; lines: string[] }> = [];
  let curUid = "";
  let curLines: string[] = [];

  for (let i = contentStart; i < lines.length; i++) {
    const line = lines[i];
    const topMatch = line.match(/^- \[uid:([^\]]+)\]/);
    if (topMatch) {
      if (curUid) sections.push({ uid: curUid, text: curLines.join("\n"), lines: curLines });
      curUid = topMatch[1];
      curLines = [line];
    } else if (curUid) {
      curLines.push(line);
    }
  }
  if (curUid) sections.push({ uid: curUid, text: curLines.join("\n"), lines: curLines });

  for (const section of sections) {
    // Build context prefix from top-level block text
    const topBlockText = cleanText(section.lines[0] || "").slice(0, 80);
    const prefix = `[Page: ${page.title} > ${topBlockText}]\n`;
    const prefixTokens = estimateTokens(prefix);
    const availableTokens = CHUNK_TOKEN_BUDGET - prefixTokens;

    const sectionClean = cleanText(section.text);
    const sectionTokens = estimateTokens(sectionClean);

    if (sectionTokens <= availableTokens) {
      // Fits in one chunk
      chunks.push({
        title: page.title,
        pageUid: page.uid,
        blockUid: section.uid,
        content: prefix + sectionClean,
        chunkUids: extractUids(section.lines),
        isDnp: page.isDnp,
      });
    } else {
      // Split at child block boundaries
      splitSectionIntoChunks(
        section, page, prefix, availableTokens, chunks
      );
    }
  }

  // Merge small adjacent chunks to reduce total embedding count
  return mergeSmallChunks(chunks);
}

/** Minimum token threshold — chunks smaller than this get merged with neighbors */
const MIN_CHUNK_TOKENS = 80;

/**
 * Merge adjacent small chunks from the same page into fewer, larger chunks.
 * Keeps chunks under CHUNK_TOKEN_BUDGET.
 */
function mergeSmallChunks(chunks: ChunkDoc[]): ChunkDoc[] {
  if (chunks.length <= 1) return chunks;

  const merged: ChunkDoc[] = [];
  let acc = chunks[0];
  let accTokens = estimateTokens(acc.content);

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i];
    const nextTokens = estimateTokens(next.content);

    // Only merge if both are small and combined fits in budget
    if (
      accTokens < MIN_CHUNK_TOKENS &&
      accTokens + nextTokens <= CHUNK_TOKEN_BUDGET
    ) {
      acc = {
        ...acc,
        content: acc.content + "\n" + next.content,
        chunkUids: acc.chunkUids + (next.chunkUids ? "," + next.chunkUids : ""),
      };
      accTokens += nextTokens;
    } else {
      merged.push(acc);
      acc = next;
      accTokens = nextTokens;
    }
  }
  merged.push(acc);
  return merged;
}

/**
 * Split an oversized section into multiple chunks at child block boundaries.
 * Each child block (depth 1 line: "  - [uid:xxx]") is a split candidate.
 * If a single child subtree is still too large, split mid-text with overlap.
 */
function splitSectionIntoChunks(
  section: { uid: string; text: string; lines: string[] },
  page: PageDocument,
  prefix: string,
  availableTokens: number,
  chunks: ChunkDoc[]
): void {
  // Group lines into child subtrees
  const childGroups: string[][] = [];
  let currentGroup: string[] = [];

  for (let i = 0; i < section.lines.length; i++) {
    const line = section.lines[i];
    // A line at depth 0 (top-level) or depth 1 (direct child "  - [uid:") starts a new group
    // Skip the first line (top-level block itself) — it's always included as context
    if (i === 0) {
      currentGroup.push(line);
      continue;
    }
    const isChildBoundary = line.match(/^  - \[uid:/);
    if (isChildBoundary && currentGroup.length > 1) {
      childGroups.push(currentGroup);
      currentGroup = [section.lines[0]]; // carry the top-level block as context
    }
    currentGroup.push(line);
  }
  if (currentGroup.length > 0) childGroups.push(currentGroup);

  // Now merge child groups into chunks that fit the budget
  let accLines: string[] = [];
  let accTokens = 0;

  const flushAcc = () => {
    if (accLines.length === 0) return;
    const clean = cleanText(accLines.join("\n"));
    if (clean.length > 0) {
      chunks.push({
        title: page.title,
        pageUid: page.uid,
        blockUid: section.uid,
        content: prefix + clean,
        chunkUids: extractUids(accLines),
        isDnp: page.isDnp,
      });
    }
    accLines = [];
    accTokens = 0;
  };

  for (const group of childGroups) {
    const groupClean = cleanText(group.join("\n"));
    const groupTokens = estimateTokens(groupClean);

    if (groupTokens > availableTokens) {
      // This single child subtree is too large — flush accumulator, then split mid-text
      flushAcc();
      splitLargeText(
        prefix, groupClean, extractUids(group),
        section.uid, page, availableTokens, chunks
      );
    } else if (accTokens + groupTokens > availableTokens) {
      // Adding this group would exceed budget — flush first
      flushAcc();
      accLines = group.slice();
      accTokens = groupTokens;
    } else {
      // Merge: add lines (but avoid duplicating the top-level block line)
      if (accLines.length === 0) {
        accLines = group.slice();
      } else {
        // Skip the repeated top-level block line (index 0 of each group)
        for (let i = 1; i < group.length; i++) {
          accLines.push(group[i]);
        }
      }
      accTokens += groupTokens;
    }
  }
  flushAcc();
}

/**
 * Split a single large text block mid-text with ~50 token overlap.
 */
function splitLargeText(
  prefix: string,
  cleanedText: string,
  uids: string,
  blockUid: string,
  page: PageDocument,
  availableTokens: number,
  chunks: ChunkDoc[]
): void {
  const OVERLAP_CHARS = 200; // ~50 tokens overlap
  const chunkSize = availableTokens * 4; // convert tokens back to chars
  let start = 0;

  while (start < cleanedText.length) {
    const end = Math.min(start + chunkSize, cleanedText.length);
    const slice = cleanedText.slice(start, end);
    chunks.push({
      title: page.title,
      pageUid: page.uid,
      blockUid,
      content: prefix + slice,
      chunkUids: uids,
      isDnp: page.isDnp,
    });
    if (end >= cleanedText.length) break;
    start = end - OVERLAP_CHARS;
  }
}

// ============================================================
// IndexedDB helpers
// ============================================================

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key: string): Promise<any> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbSet(key: string, value: any): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    store.put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    store.delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

// ============================================================
// In-memory Orama instance cache
// ============================================================

const oramaInstances = new Map<string, AnyOrama>();

/** Create a fresh Orama instance */
async function createOramaDb(): Promise<AnyOrama> {
  return create({
    schema: ORAMA_SCHEMA,
    components: {
      tokenizer: {
        stemming: true,
      },
    },
  });
}

/** Get or restore an Orama instance for a database */
async function getOramaInstance(databaseId: string): Promise<AnyOrama> {
  let instance = oramaInstances.get(databaseId);
  if (instance) return instance;

  // Create a fresh instance first
  instance = await createOramaDb();

  // Try to restore from IndexedDB
  const serialized = await idbGet(databaseId);
  if (serialized) {
    try {
      load(instance, serialized);
    } catch (e) {
      console.warn(
        `[LocalVectorStore] Failed to restore DB "${databaseId}", using empty:`,
        e
      );
    }
  }

  oramaInstances.set(databaseId, instance);
  return instance;
}

/** Persist an Orama instance to IndexedDB */
async function persistOrama(databaseId: string): Promise<void> {
  const instance = oramaInstances.get(databaseId);
  if (!instance) return;

  const serialized = await save(instance);
  await idbSet(databaseId, serialized);
}

// ============================================================
// Public API
// ============================================================

/**
 * Index Roam pages into a local Orama database.
 * Pages are split into contextual chunks at block boundaries before embedding.
 * Supports true incremental updates: only re-embeds new/updated pages.
 */
export async function indexPages(
  databaseId: string,
  allPages: PageDocument[],
  oldManifest: VectorStoreManifest,
  newManifest: VectorStoreManifest,
  onProgress?: ProgressCallback,
  modelId: LocalEmbeddingModel = "bge-small-en",
  signal?: AbortSignal
): Promise<void> {
  const progress: IndexingProgress = {
    phase: "embedding",
    total: 0,
    processed: 0,
    newPages: 0,
    updatedPages: 0,
    unchangedPages: 0,
    deletedPages: 0,
  };

  const db = await getOramaInstance(databaseId);

  // Compute diff
  const toInsert: PageDocument[] = [];
  const toRemoveUids: string[] = [];

  for (const page of allPages) {
    const old = oldManifest[page.title];
    const current = newManifest[page.title];
    if (!old) {
      // New page
      toInsert.push(page);
      progress.newPages++;
    } else if (current && current.lastEditTime > old.lastEditTime) {
      // Updated — remove old, then insert new
      toRemoveUids.push(page.uid);
      toInsert.push(page);
      progress.updatedPages++;
    } else {
      progress.unchangedPages++;
    }
  }

  // Detect deleted pages
  const currentUids = new Set(allPages.map((p) => p.uid));
  for (const title of Object.keys(oldManifest)) {
    const entry = oldManifest[title];
    if (!currentUids.has(entry.pageUid)) {
      toRemoveUids.push(entry.pageUid);
      progress.deletedPages++;
    }
  }

  // Remove outdated/deleted docs
  if (toRemoveUids.length > 0) {
    try {
      const removeSet = new Set(toRemoveUids);
      const idsToRemove: string[] = [];
      for (const uid of removeSet) {
        const results = await oramaSearch(db, {
          term: uid,
          properties: ["pageUid"],
          limit: 10000,
          threshold: 0,
        });
        for (const hit of results.hits) {
          idsToRemove.push(hit.id);
        }
      }
      if (idsToRemove.length > 0) {
        await removeMultiple(db, idsToRemove);
      }
    } catch (e) {
      console.warn("[LocalVectorStore] Error removing old docs:", e);
    }
  }

  if (toInsert.length === 0) {
    progress.phase = "done";
    onProgress?.(progress);
    await persistOrama(databaseId);
    return;
  }

  // Chunk all pages into section-level documents
  progress.phase = "converting";
  progress.total = toInsert.length;
  progress.processed = 0;
  onProgress?.(progress);

  const allChunks: ChunkDoc[] = [];
  for (let i = 0; i < toInsert.length; i++) {
    const pageChunks = chunkPage(toInsert[i]);
    allChunks.push(...pageChunks);
    progress.processed = i + 1;
    progress.currentPage = toInsert[i].title;
    if ((i + 1) % 50 === 0) onProgress?.(progress);
  }

  console.log(`[LocalVectorStore] ${toInsert.length} pages → ${allChunks.length} chunks (${(allChunks.length / toInsert.length).toFixed(1)}x)`);

  if (signal?.aborted) {
    await persistOrama(databaseId);
    return;
  }

  // Embed and insert in streaming batches (allows cancellation between batches)
  progress.phase = "embedding";
  progress.total = allChunks.length;
  progress.processed = 0;
  progress.currentPage = undefined;
  onProgress?.(progress);

  let isFirstModel = !oramaInstances.has("_model_loaded");
  const EMBED_BATCH = 50; // embed+insert N chunks at a time
  let totalProcessed = 0;

  for (let i = 0; i < allChunks.length; i += EMBED_BATCH) {
    if (signal?.aborted) {
      console.log(`[LocalVectorStore] Cancelled at chunk ${i}/${allChunks.length}`);
      break;
    }

    const batchChunks = allChunks.slice(i, i + EMBED_BATCH);
    const batchTexts = batchChunks.map((c) => c.content);

    const batchEmbeddings = await embedTexts(
      batchTexts,
      modelId,
      (done) => {
        progress.processed = totalProcessed + done;
        progress.currentPage = batchChunks[Math.min(done, batchChunks.length) - 1]?.title;
        onProgress?.(progress);
      },
      isFirstModel && i === 0
        ? (mp) => {
            if (mp.status === "downloading" && mp.progress != null) {
              progress.currentPage = `Downloading model: ${Math.round(mp.progress)}%`;
              onProgress?.(progress);
            }
          }
        : undefined
    );

    // Mark model as loaded after first batch
    if (i === 0) oramaInstances.set("_model_loaded", true as any);

    // Insert this batch into Orama immediately
    const docs = batchChunks.map((chunk, j) => ({
      title: chunk.title,
      content: chunk.content,
      chunkUids: chunk.chunkUids,
      pageUid: chunk.pageUid,
      blockUid: chunk.blockUid,
      source: chunk.isDnp ? "roam-dnp" : "roam-pages",
      isDnp: chunk.isDnp,
      embedding: batchEmbeddings[j],
    }));
    await insertMultiple(db, docs);

    totalProcessed += batchChunks.length;
  }

  // Persist to IndexedDB (saves whatever was inserted, even if cancelled)
  await persistOrama(databaseId);

  progress.phase = signal?.aborted ? "done" : "done";
  if (signal?.aborted) {
    progress.currentPage = `Cancelled — ${totalProcessed}/${allChunks.length} chunks indexed`;
  }
  onProgress?.(progress);
}

/**
 * Search across a local Orama database using hybrid search (BM25 + vector).
 */
export async function localSearch(
  databaseId: string,
  query: string,
  options: VectorSearchOptions = {},
  modelId: LocalEmbeddingModel = "bge-small-en"
): Promise<VectorSearchResult[]> {
  const db = await getOramaInstance(databaseId);
  const maxResults = options.maxResults || 10;

  // Embed the query
  const queryEmbedding = await embedQuery(query, modelId);

  // Run hybrid search: combine BM25 keyword + vector similarity
  const results = await oramaSearch(db, {
    term: query,
    vector: {
      value: queryEmbedding,
      property: "embedding",
    },
    mode: "hybrid",
    limit: maxResults,
    similarity: 0.3,
  });

  // Map to VectorSearchResult format
  const mapped: VectorSearchResult[] = results.hits.map((hit: any) => {
    const doc = hit.document;
    // Block UIDs stored as comma-separated string
    const chunkUids = (doc.chunkUids as string) || "";
    const blockUids = chunkUids ? chunkUids.split(",") : [];

    return {
      content: doc.content as string,
      score: hit.score,
      fileName: `local-${databaseId}`,
      source: doc.source as VectorSearchSource,
      blockUids,
      pageTitle: doc.title as string,
      // Pass blockUid from schema for "Add to context"
      firstBlockUid: doc.blockUid as string,
    };
  });

  // Apply source filter
  if (options.sourceFilter && options.sourceFilter !== "all") {
    const filter = options.sourceFilter;
    if (filter === "roam") {
      return mapped.filter(
        (r) => r.source === "roam-pages" || r.source === "roam-dnp"
      );
    }
    if (filter === "roam-pages" || filter === "roam-dnp") {
      return mapped.filter((r) => r.source === filter);
    }
    if (filter === "uploads") {
      return mapped.filter((r) => r.source === "user-upload");
    }
  }

  return mapped;
}

/**
 * Delete a local Orama database from memory and IndexedDB.
 */
export async function deleteLocalDatabase(databaseId: string): Promise<void> {
  oramaInstances.delete(databaseId);
  await idbDelete(databaseId);
}

/**
 * Get the document count for a local database.
 */
export async function getLocalDocCount(databaseId: string): Promise<number> {
  try {
    const db = await getOramaInstance(databaseId);
    return await count(db);
  } catch {
    return 0;
  }
}

/** Release embedding model memory */
export async function disposeLocal(): Promise<void> {
  await disposeEmbedding();
}
