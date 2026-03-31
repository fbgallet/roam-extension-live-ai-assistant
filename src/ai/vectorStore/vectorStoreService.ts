/**
 * Vector Store Service
 *
 * Manages multiple vector databases with two provider backends:
 * - OpenAI: Remote vector store (requires API key, paid)
 * - Local: In-browser Orama + Transformers.js (free, zero config)
 *
 * Each database is backed by its provider and can be independently
 * enabled/disabled for search.
 */

import {
  VectorStoreState,
  VectorStoreGlobalState,
  VectorDatabase,
  VectorStoreManifest,
  VectorStoreFileEntry,
  VectorSearchResult,
  VectorSearchOptions,
  VectorSearchSource,
  VectorStoreProvider,
  LocalEmbeddingModel,
} from "./types";

import {
  localSearch,
  deleteLocalDatabase,
} from "./providers/local/localProvider";

// @ts-ignore - JS module
import { openaiLibrary, OPENAI_API_KEY, extensionStorage } from "../../index";

const STORAGE_KEY = "vectorStoreState";
const DEFAULT_EXPIRY_DAYS = 30;

// ============================================================
// State management with auto-migration
// ============================================================

/** Generate a simple unique ID */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Migrate legacy single-store state to multi-database format */
function migrateLegacyState(legacy: VectorStoreState): VectorStoreGlobalState {
  if (!legacy.vectorStoreId) {
    return { databases: [] };
  }
  const db: VectorDatabase = {
    id: generateId(),
    name: "Roam Graph",
    provider: "openai",
    vectorStoreId: legacy.vectorStoreId,
    enabled: true,
    createdAt: Date.now(),
    manifest: legacy.manifest,
    roamBundleFileIds: legacy.roamBundleFileIds,
    files: legacy.files,
  };
  return { databases: [db], defaultDatabaseId: db.id };
}

/** Get persisted global state, migrating from legacy format if needed */
function getGlobalState(): VectorStoreGlobalState {
  const stored = extensionStorage?.get(STORAGE_KEY);
  if (!stored || typeof stored !== "object") {
    return { databases: [] };
  }

  // Check if this is the new multi-database format
  if (Array.isArray((stored as any).databases)) {
    const state = stored as VectorStoreGlobalState;
    // Ensure all databases have a provider field (backfill legacy)
    for (const db of state.databases) {
      if (!db.provider) {
        (db as any).provider = "openai";
      }
    }
    return state;
  }

  // Legacy single-store format — migrate
  console.log("[VectorStore] Migrating legacy state to multi-database format");
  const migrated = migrateLegacyState(stored as VectorStoreState);
  extensionStorage?.set(STORAGE_KEY, migrated);
  return migrated;
}

/** Persist global state */
async function saveGlobalState(state: VectorStoreGlobalState): Promise<void> {
  await extensionStorage?.set(STORAGE_KEY, state);
}

/** Find a database by ID */
function findDatabase(
  state: VectorStoreGlobalState,
  databaseId: string
): VectorDatabase | undefined {
  return state.databases.find((db) => db.id === databaseId);
}

// ============================================================
// OpenAI client
// ============================================================

/** Get the native OpenAI client (not custom endpoint) */
function getOpenAIClient(): any {
  if (!OPENAI_API_KEY) {
    throw new Error(
      "OpenAI API key is required for vector search. Please configure it in the extension settings."
    );
  }
  if (openaiLibrary && !openaiLibrary._options?.baseURL) {
    return openaiLibrary;
  }
  const OpenAI = (openaiLibrary as any)?.constructor;
  if (OpenAI) {
    return new OpenAI({
      apiKey: OPENAI_API_KEY,
      dangerouslyAllowBrowser: true,
    });
  }
  throw new Error(
    "OpenAI SDK not available. Please ensure the OpenAI API key is configured."
  );
}

// ============================================================
// Database CRUD
// ============================================================

/** Create a new vector database (OpenAI or Local) */
export async function createDatabase(
  name: string,
  description?: string,
  provider: VectorStoreProvider = "openai",
  embeddingModel?: LocalEmbeddingModel
): Promise<VectorDatabase> {
  let vectorStoreId = "";

  if (provider === "openai") {
    const client = getOpenAIClient();
    const store = await client.vectorStores.create({
      name: `Live AI - ${name}`,
      expires_after: {
        anchor: "last_active_at",
        days: DEFAULT_EXPIRY_DAYS,
      },
    });
    vectorStoreId = store.id;
  } else {
    // Local: just generate an ID — Orama instance created on first use
    vectorStoreId = `local-${generateId()}`;
  }

  const db: VectorDatabase = {
    id: generateId(),
    name,
    description,
    provider,
    embeddingModel: provider === "local" ? (embeddingModel || "bge-small-en") : undefined,
    vectorStoreId,
    enabled: true,
    createdAt: Date.now(),
    manifest: {},
    roamBundleFileIds: [],
    files: [],
  };

  const state = getGlobalState();
  state.databases.push(db);
  if (!state.defaultDatabaseId) {
    state.defaultDatabaseId = db.id;
  }
  await saveGlobalState(state);
  return db;
}

/** Rename a database */
export async function renameDatabase(
  databaseId: string,
  newName: string
): Promise<void> {
  const state = getGlobalState();
  const db = findDatabase(state, databaseId);
  if (!db) throw new Error(`Database not found: ${databaseId}`);
  db.name = newName;
  await saveGlobalState(state);
}

/** Update a database description */
export async function updateDatabaseDescription(
  databaseId: string,
  description: string
): Promise<void> {
  const state = getGlobalState();
  const db = findDatabase(state, databaseId);
  if (!db) throw new Error(`Database not found: ${databaseId}`);
  db.description = description;
  await saveGlobalState(state);
}

/** Toggle a database enabled/disabled */
export async function toggleDatabase(
  databaseId: string,
  enabled?: boolean
): Promise<boolean> {
  const state = getGlobalState();
  const db = findDatabase(state, databaseId);
  if (!db) throw new Error(`Database not found: ${databaseId}`);
  db.enabled = enabled !== undefined ? enabled : !db.enabled;
  await saveGlobalState(state);
  return db.enabled;
}

/** Delete a database and its backing store */
export async function deleteDatabase(databaseId: string): Promise<void> {
  const state = getGlobalState();
  const db = findDatabase(state, databaseId);
  if (!db) return;

  if (db.provider === "openai") {
    try {
      const client = getOpenAIClient();
      const allFileIds = [
        ...db.roamBundleFileIds,
        ...db.files.map((f) => f.openaiFileId),
      ];
      if (allFileIds.length > 0) {
        await Promise.allSettled(
          allFileIds.map(async (fileId) => {
            try { await client.files.del(fileId); } catch { /* already deleted */ }
          })
        );
      }
      await client.vectorStores.del(db.vectorStoreId);
    } catch {
      // Already deleted on OpenAI side
    }
  } else {
    await deleteLocalDatabase(db.id);
  }

  state.databases = state.databases.filter((d) => d.id !== databaseId);
  if (state.defaultDatabaseId === databaseId) {
    state.defaultDatabaseId = state.databases[0]?.id;
  }
  await saveGlobalState(state);
}

/** Set the default database for new uploads */
export async function setDefaultDatabase(
  databaseId: string
): Promise<void> {
  const state = getGlobalState();
  const db = findDatabase(state, databaseId);
  if (!db) throw new Error(`Database not found: ${databaseId}`);
  state.defaultDatabaseId = databaseId;
  await saveGlobalState(state);
}

/** List all databases */
export function listDatabases(): VectorDatabase[] {
  return getGlobalState().databases;
}

/** Get default database ID */
export function getDefaultDatabaseId(): string | undefined {
  return getGlobalState().defaultDatabaseId;
}

// ============================================================
// Database-aware getOrCreate (OpenAI only)
// ============================================================

/**
 * Ensure an OpenAI database's vector store exists, or create one.
 * For local databases, this is a no-op.
 */
export async function getOrCreateVectorStore(
  databaseId?: string
): Promise<string> {
  const state = getGlobalState();

  let db: VectorDatabase | undefined;
  if (databaseId) {
    db = findDatabase(state, databaseId);
    if (!db) throw new Error(`Database not found: ${databaseId}`);
  } else {
    if (state.defaultDatabaseId) {
      db = findDatabase(state, state.defaultDatabaseId);
    }
    if (!db && state.databases.length > 0) {
      db = state.databases[0];
    }
  }

  if (db) {
    // Local databases don't need remote verification
    if (db.provider === "local") return db.vectorStoreId;

    // Verify the OpenAI store still exists
    try {
      const client = getOpenAIClient();
      await client.vectorStores.retrieve(db.vectorStoreId);
      return db.vectorStoreId;
    } catch (e: any) {
      console.log(
        `[VectorStore] Store for "${db.name}" not found, recreating:`,
        e.message
      );
      const client = getOpenAIClient();
      const store = await client.vectorStores.create({
        name: `Live AI - ${db.name}`,
        expires_after: { anchor: "last_active_at", days: DEFAULT_EXPIRY_DAYS },
      });
      db.vectorStoreId = store.id;
      db.manifest = {};
      db.roamBundleFileIds = [];
      db.files = [];
      await saveGlobalState(state);
      return store.id;
    }
  }

  // No databases at all — create the first one
  const newDb = await createDatabase("Roam Graph");
  return newDb.vectorStoreId;
}

// ============================================================
// File upload (OpenAI databases only)
// ============================================================

/** Upload a single file to an OpenAI database */
export async function uploadFile(
  blob: Blob,
  fileName: string,
  source: "roam-graph" | "user-upload",
  databaseId?: string
): Promise<string> {
  const client = getOpenAIClient();
  const resolvedDbId = await resolveAndEnsureDatabase(databaseId);
  const state = getGlobalState();
  const db = findDatabase(state, resolvedDbId)!;

  const file = new File([blob], fileName);
  const uploadedFile = await client.files.create({
    file,
    purpose: "assistants",
  });

  await client.vectorStores.files.create(db.vectorStoreId, {
    file_id: uploadedFile.id,
  });

  if (source === "user-upload") {
    db.files.push({
      openaiFileId: uploadedFile.id,
      fileName,
      uploadTime: Date.now(),
      source: "user-upload",
    });
    await saveGlobalState(state);
  }

  return uploadedFile.id;
}

/** Upload Roam graph bundles to an OpenAI database */
export async function uploadRoamBundles(
  bundles: Array<{ content: string; name: string }>,
  manifest: VectorStoreManifest,
  onProgress?: (uploaded: number, total: number) => void,
  databaseId?: string
): Promise<void> {
  const client = getOpenAIClient();
  const resolvedDbId = await resolveAndEnsureDatabase(databaseId);
  const state = getGlobalState();
  const db = findDatabase(state, resolvedDbId)!;

  // Step 1: Delete old Roam bundle files
  if (db.roamBundleFileIds.length > 0) {
    await Promise.allSettled(
      db.roamBundleFileIds.map(async (fileId) => {
        try {
          await client.vectorStores.files.del(db.vectorStoreId, fileId);
        } catch { /* Already removed */ }
        try {
          await client.files.del(fileId);
        } catch { /* Already deleted */ }
      })
    );
    db.roamBundleFileIds = [];
  }

  // Step 2: Upload new bundles
  const PARALLEL = 3;
  const newFileIds: string[] = [];

  for (let i = 0; i < bundles.length; i += PARALLEL) {
    const batch = bundles.slice(i, i + PARALLEL);
    const results = await Promise.all(
      batch.map(async (bundle) => {
        const file = new File(
          [new Blob([bundle.content], { type: "text/markdown" })],
          bundle.name
        );
        const uploaded = await client.files.create({
          file,
          purpose: "assistants",
        });
        await client.vectorStores.files.create(db.vectorStoreId, {
          file_id: uploaded.id,
        });
        return uploaded.id;
      })
    );
    newFileIds.push(...results);
    onProgress?.(Math.min(i + PARALLEL, bundles.length), bundles.length);
  }

  // Step 3: Save state
  db.roamBundleFileIds = newFileIds;
  db.manifest = manifest;
  db.lastIndexedAt = Date.now();
  await saveGlobalState(state);
}

/** Save manifest and timestamp for a local database after indexing */
export async function saveLocalIndexState(
  manifest: VectorStoreManifest,
  databaseId: string
): Promise<void> {
  const state = getGlobalState();
  const db = findDatabase(state, databaseId);
  if (!db) throw new Error(`Database not found: ${databaseId}`);
  db.manifest = manifest;
  db.lastIndexedAt = Date.now();
  await saveGlobalState(state);
}

/** Remove a user-uploaded file from a database */
export async function removeFile(
  openaiFileId: string,
  databaseId?: string
): Promise<void> {
  const client = getOpenAIClient();
  const state = getGlobalState();

  let db: VectorDatabase | undefined;
  if (databaseId) {
    db = findDatabase(state, databaseId);
  } else {
    db = state.databases.find((d) =>
      d.files.some((f) => f.openaiFileId === openaiFileId)
    );
  }

  if (db) {
    try {
      await client.vectorStores.files.del(db.vectorStoreId, openaiFileId);
    } catch { /* Already removed */ }
  }

  try {
    await client.files.del(openaiFileId);
  } catch { /* Already deleted */ }

  if (db) {
    db.files = db.files.filter((f) => f.openaiFileId !== openaiFileId);
    await saveGlobalState(state);
  }
}

// ============================================================
// Search (across multiple enabled databases, any provider)
// ============================================================

/** Search across all enabled databases (routes to correct provider) */
export async function search(
  query: string,
  options: VectorSearchOptions = {}
): Promise<VectorSearchResult[]> {
  const state = getGlobalState();
  const maxResults = options.maxResults || 10;

  let databasesToSearch: VectorDatabase[];
  if (options.databaseIds && options.databaseIds.length > 0) {
    databasesToSearch = state.databases.filter(
      (db) => options.databaseIds!.includes(db.id)
    );
  } else {
    databasesToSearch = state.databases.filter((db) => db.enabled);
  }

  if (databasesToSearch.length === 0) {
    throw new Error(
      "No vector store configured. Please create a database (Local or OpenAI) from the tools menu, then index your Roam graph."
    );
  }

  // Search all databases in parallel, routing to correct provider
  const searchPromises = databasesToSearch.map(async (db) => {
    try {
      if (db.provider === "local") {
        const results = await localSearch(db.id, query, {
          ...options,
          maxResults,
        }, db.embeddingModel || "bge-small-en");
        return results.map((r) => ({
          ...r,
          databaseName: db.name,
          databaseId: db.id,
        }));
      }

      // OpenAI provider
      return await searchOpenAI(db, query, maxResults);
    } catch (e: any) {
      console.warn(
        `[VectorStore] Search failed for "${db.name}" (${db.provider}):`,
        e.message
      );
      return [];
    }
  });

  const allResults = (await Promise.all(searchPromises)).flat();

  // Sort by score descending and take top maxResults
  allResults.sort((a, b) => b.score - a.score);
  let results = allResults.slice(0, maxResults);

  // Apply source filter
  if (options.sourceFilter && options.sourceFilter !== "all") {
    const filter = options.sourceFilter;
    if (filter === "roam") {
      results = results.filter(
        (r) => r.source === "roam-pages" || r.source === "roam-dnp"
      );
    } else if (filter === "roam-pages" || filter === "roam-dnp") {
      results = results.filter((r) => r.source === filter);
    } else if (filter === "uploads") {
      results = results.filter((r) => r.source === "user-upload");
    }
  }

  return results;
}

/** OpenAI-specific search implementation */
async function searchOpenAI(
  db: VectorDatabase,
  query: string,
  maxResults: number
): Promise<VectorSearchResult[]> {
  const client = getOpenAIClient();
  const searchResponse = await client.vectorStores.search(
    db.vectorStoreId,
    { query, max_num_results: maxResults }
  );

  const roamBundleIds = new Set(db.roamBundleFileIds);
  const results: VectorSearchResult[] = [];

  for (const item of searchResponse.data || []) {
    const fileName = item.filename || "unknown";
    const content =
      item.content?.map((c: any) => c.text).join("\n") || "";
    const score = item.score || 0;

    const isRoamBundle = roamBundleIds.has(item.file_id);

    let source: VectorSearchSource;
    if (!isRoamBundle) {
      source = "user-upload";
    } else if (fileName.startsWith("roam-dnp")) {
      source = "roam-dnp";
    } else {
      source = "roam-pages";
    }

    const uidMatches = content.match(/\[uid:([^\]]+)\]/g) || [];
    const blockUids = uidMatches.map((m: string) =>
      m.replace("[uid:", "").replace("]", "")
    );

    let pageTitle: string | undefined;
    const pageMarkers = content.match(/<!-- PAGE: (.+?) -->/g);
    if (pageMarkers && pageMarkers.length > 0) {
      const lastMarker = pageMarkers[pageMarkers.length - 1];
      const titleMatch = lastMarker.match(/<!-- PAGE: (.+?) -->/);
      if (titleMatch) pageTitle = titleMatch[1];
    }

    results.push({
      content,
      score,
      fileName,
      source,
      blockUids,
      pageTitle,
      databaseName: db.name,
      databaseId: db.id,
    });
  }
  return results;
}

// ============================================================
// Legacy-compatible delete (deletes ALL databases)
// ============================================================

/** Delete all vector databases and their stored files */
export async function deleteVectorStore(): Promise<void> {
  const state = getGlobalState();

  await Promise.allSettled(
    state.databases.map(async (db) => {
      if (db.provider === "local") {
        await deleteLocalDatabase(db.id);
        return;
      }
      // OpenAI cleanup
      try {
        const client = getOpenAIClient();
        const allFileIds = [
          ...db.roamBundleFileIds,
          ...db.files.map((f) => f.openaiFileId),
        ];
        await Promise.allSettled(
          allFileIds.map(async (fileId) => {
            try { await client.files.del(fileId); } catch { /* already deleted */ }
          })
        );
        await client.vectorStores.del(db.vectorStoreId);
      } catch { /* Already deleted */ }
    })
  );

  await saveGlobalState({ databases: [] });
}

// ============================================================
// Diagnostics
// ============================================================

/** Debug: list files in the OpenAI vector store and their status */
export async function debugListVectorStoreFiles(databaseId?: string): Promise<any> {
  const state = getGlobalState();
  const results: any[] = [];

  const dbsToCheck = databaseId
    ? state.databases.filter(db => db.id === databaseId)
    : state.databases;

  for (const db of dbsToCheck) {
    if (db.provider === "local") {
      results.push({
        dbName: db.name,
        dbId: db.id,
        provider: "local",
        localManifestSize: Object.keys(db.manifest).length,
      });
      continue;
    }

    try {
      const client = getOpenAIClient();
      const storeInfo = await client.vectorStores.retrieve(db.vectorStoreId);
      const filesResponse = await client.vectorStores.files.list(db.vectorStoreId);
      const files = filesResponse?.data || [];

      results.push({
        dbName: db.name,
        dbId: db.id,
        provider: "openai",
        vectorStoreId: db.vectorStoreId,
        storeStatus: storeInfo.status,
        fileCounts: storeInfo.file_counts,
        localManifestSize: Object.keys(db.manifest).length,
        localBundleIds: db.roamBundleFileIds?.length || 0,
        remoteFiles: files.map((f: any) => ({
          id: f.id,
          status: f.status,
          lastError: f.last_error,
        })),
      });
    } catch (e: any) {
      results.push({
        dbName: db.name,
        dbId: db.id,
        provider: "openai",
        vectorStoreId: db.vectorStoreId,
        error: e.message,
      });
    }
  }

  return { databases: state.databases.length, results };
}

/** Debug: raw search bypassing all filters */
export async function debugSearch(query: string, maxResults: number = 5): Promise<any> {
  const state = getGlobalState();
  const results: any[] = [];

  for (const db of state.databases.filter(d => d.enabled)) {
    try {
      if (db.provider === "local") {
        const localResults = await localSearch(db.id, query, { maxResults }, db.embeddingModel || "bge-small-en");
        for (const r of localResults) {
          results.push({
            db: db.name,
            provider: "local",
            score: r.score,
            pageTitle: r.pageTitle,
            contentPreview: r.content.slice(0, 300),
          });
        }
        continue;
      }

      const client = getOpenAIClient();
      const searchResponse = await client.vectorStores.search(
        db.vectorStoreId,
        { query, max_num_results: maxResults }
      );

      for (const item of searchResponse.data || []) {
        const content = item.content?.map((c: any) => c.text).join("\n") || "";
        results.push({
          db: db.name,
          provider: "openai",
          fileId: item.file_id,
          fileName: item.filename,
          score: item.score,
          contentPreview: content.slice(0, 300),
        });
      }
    } catch (e: any) {
      results.push({ db: db.name, error: e.message });
    }
  }

  return results;
}

// ============================================================
// Info helpers
// ============================================================

/** Get summary info across all databases */
export function getVectorStoreInfo(): {
  isConfigured: boolean;
  databaseCount: number;
  enabledCount: number;
  roamPageCount: number;
  uploadedFileCount: number;
} {
  const state = getGlobalState();
  const enabledDbs = state.databases.filter((db) => db.enabled);
  return {
    isConfigured: state.databases.length > 0,
    databaseCount: state.databases.length,
    enabledCount: enabledDbs.length,
    roamPageCount: state.databases.reduce(
      (sum, db) => sum + Object.keys(db.manifest).length,
      0
    ),
    uploadedFileCount: state.databases.reduce(
      (sum, db) => sum + db.files.length,
      0
    ),
  };
}

/** Get info for a specific database */
export function getDatabaseInfo(databaseId: string): {
  name: string;
  description?: string;
  enabled: boolean;
  roamPageCount: number;
  uploadedFileCount: number;
  files: VectorStoreFileEntry[];
} | null {
  const state = getGlobalState();
  const db = findDatabase(state, databaseId);
  if (!db) return null;
  return {
    name: db.name,
    description: db.description,
    enabled: db.enabled,
    roamPageCount: Object.keys(db.manifest).length,
    uploadedFileCount: db.files.length,
    files: db.files,
  };
}

/** Get list of uploaded (non-Roam) files across all databases */
export function getUploadedFiles(): VectorStoreFileEntry[] {
  return getGlobalState().databases.flatMap((db) => db.files);
}

/** Get the manifest for a specific database (for incremental updates) */
export function getManifest(databaseId?: string): VectorStoreManifest {
  const state = getGlobalState();
  if (databaseId) {
    const db = findDatabase(state, databaseId);
    return db?.manifest || {};
  }
  if (state.defaultDatabaseId) {
    const db = findDatabase(state, state.defaultDatabaseId);
    return db?.manifest || {};
  }
  return state.databases[0]?.manifest || {};
}

/** Get the provider type for a database */
export function getDatabaseProvider(databaseId?: string): VectorStoreProvider {
  const state = getGlobalState();
  if (databaseId) {
    const db = findDatabase(state, databaseId);
    return db?.provider || "openai";
  }
  if (state.defaultDatabaseId) {
    const db = findDatabase(state, state.defaultDatabaseId);
    return db?.provider || "openai";
  }
  return state.databases[0]?.provider || "openai";
}

/** Get the embedding model for a local database */
export function getDatabaseEmbeddingModel(databaseId?: string): LocalEmbeddingModel {
  const state = getGlobalState();
  if (databaseId) {
    const db = findDatabase(state, databaseId);
    return db?.embeddingModel || "bge-small-en";
  }
  if (state.defaultDatabaseId) {
    const db = findDatabase(state, state.defaultDatabaseId);
    return db?.embeddingModel || "bge-small-en";
  }
  return state.databases[0]?.embeddingModel || "bge-small-en";
}

// ============================================================
// Internal helpers
// ============================================================

async function resolveAndEnsureDatabase(
  databaseId?: string
): Promise<string> {
  const state = getGlobalState();

  if (databaseId) {
    const db = findDatabase(state, databaseId);
    if (!db) throw new Error(`Database not found: ${databaseId}`);
    if (db.provider === "openai") {
      await getOrCreateVectorStore(databaseId);
    }
    return databaseId;
  }

  if (state.defaultDatabaseId) {
    const db = findDatabase(state, state.defaultDatabaseId);
    if (db?.provider === "openai") {
      await getOrCreateVectorStore(state.defaultDatabaseId);
    }
    return state.defaultDatabaseId;
  }
  if (state.databases.length > 0) {
    const db = state.databases[0];
    if (db.provider === "openai") {
      await getOrCreateVectorStore(db.id);
    }
    return db.id;
  }

  const newDb = await createDatabase("Roam Graph");
  return newDb.id;
}
