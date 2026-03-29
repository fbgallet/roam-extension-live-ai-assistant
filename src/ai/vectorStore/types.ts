/**
 * Types for the Vector Store feature (OpenAI Vector Store integration)
 */

/** Per-page edit time tracking for incremental diffs */
export interface PageEditEntry {
  lastEditTime: number;
  pageUid: string;
}

/** Metadata for a non-Roam file uploaded to the vector store */
export interface VectorStoreFileEntry {
  openaiFileId: string;
  fileName: string;
  uploadTime: number;
  source: "user-upload";
}

/** Manifest tracking page edit times for incremental updates */
export type VectorStoreManifest = Record<string, PageEditEntry>;

/** A single named vector database backed by an OpenAI vector store */
export interface VectorDatabase {
  id: string;
  name: string;
  description?: string;
  vectorStoreId: string;
  enabled: boolean;
  createdAt: number;
  manifest: VectorStoreManifest;
  roamBundleFileIds: string[];
  files: VectorStoreFileEntry[];
}

/** Global persisted state for the vector store feature (multi-database) */
export interface VectorStoreGlobalState {
  databases: VectorDatabase[];
  defaultDatabaseId?: string;
}

/** @deprecated Legacy single-store state — used for migration only */
export interface VectorStoreState {
  vectorStoreId: string | null;
  manifest: VectorStoreManifest;
  /** OpenAI file IDs for the bundled Roam graph files */
  roamBundleFileIds: string[];
  files: VectorStoreFileEntry[];
}

/** Progress callback for indexing/upload operations */
export interface IndexingProgress {
  phase: "querying" | "diffing" | "converting" | "uploading" | "cleaning" | "done";
  total: number;
  processed: number;
  newPages: number;
  updatedPages: number;
  unchangedPages: number;
  deletedPages: number;
  currentPage?: string;
  error?: string;
}

export type ProgressCallback = (progress: IndexingProgress) => void;

/** Source type for vector search results */
export type VectorSearchSource = "roam-pages" | "roam-dnp" | "user-upload";

/** A single search result from the vector store */
export interface VectorSearchResult {
  content: string;
  score: number;
  fileName: string;
  source: VectorSearchSource;
  blockUids: string[];
  /** Page title extracted from <!-- PAGE: Title --> marker */
  pageTitle?: string;
  databaseName?: string;
  databaseId?: string;
}

/** Options for vector store search */
export interface VectorSearchOptions {
  maxResults?: number;
  sourceFilter?: "all" | "roam" | "roam-pages" | "roam-dnp" | "uploads";
  /** Search only in specific database IDs (empty/undefined = all enabled) */
  databaseIds?: string[];
}

/** Roam page data as returned by the export format (JSON/msgpack) */
export interface RoamExportPage {
  title: string;
  children?: RoamExportBlock[];
  "edit-time"?: number;
  "create-time"?: number;
  "edit-email"?: string;
  "create-email"?: string;
}

/** Roam block data as returned by the export format */
export interface RoamExportBlock {
  uid: string;
  string: string;
  children?: RoamExportBlock[];
  "edit-time"?: number;
  "create-time"?: number;
  heading?: number;
  "text-align"?: string;
}
