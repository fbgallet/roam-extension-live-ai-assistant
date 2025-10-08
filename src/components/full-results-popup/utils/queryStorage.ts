/**
 * Query Storage Utilities for Ask Your Graph Agent
 *
 * CLEAN QUERY STRUCTURE:
 * ======================
 *
 * StoredQuery {
 *   // Identification
 *   id: string                    // Unique identifier
 *   timestamp: Date               // When query was created/saved
 *   name?: string                 // Optional custom name (for saved queries)
 *
 *   // Base Query (the primary/first query)
 *   userQuery: string             // Natural language query from user
 *   formalQuery: string           // Formal/structured query (defaults to userQuery)
 *   intentParserResult?: {...}    // Optional AI parser output with search strategy, etc.
 *
 *   // Composition (for both simple and composed queries)
 *   isComposed: boolean           // true if has querySteps or pageSelections
 *   querySteps: QueryStep[]       // Additional queries composed with base (empty for simple)
 *   pageSelections: PageSelection[] // Pages added directly (empty if none)
 * }
 *
 * IMPORTANT:
 * - All queries (simple and composed) have the SAME structure
 * - Simple queries have isComposed=false, querySteps=[], pageSelections=[]
 * - Composed queries have isComposed=true with non-empty querySteps or pageSelections
 * - The base query (userQuery/formalQuery) is NEVER duplicated in querySteps
 * - intentParserResult is preserved and used for re-execution with same strategy
 */

export interface IntentParserResult {
  formalQuery: string;
  searchStrategy?: "direct" | "hierarchical";
  analysisType?: "count" | "compare" | "connections" | "summary";
  language?: string;
  confidence?: number;
  datomicQuery?: string;
  needsPostProcessing?: boolean;
  postProcessingType?: string;
  isExpansionGlobal?: boolean;
  semanticExpansion?: "fuzzy" | "synonyms" | "related_concepts" | "broader_terms" | "all" | "custom";
  customSemanticExpansion?: string;
  preferredModel?: string; // Model to use for this query execution
  searchDetails?: {
    timeRange?: {
      start: string;
      end: string;
    };
    semanticExpansion?: {
      enabled: boolean;
      strategy?: string;
    };
    depthLimit?: number;
    maxResults?: number;
    requireRandom?: boolean;
  };
}

export interface PageSelection {
  title: string;
  uid: string;
  includeContent: boolean;
  includeLinkedRefs: boolean;
  dnpPeriod?: number; // For DNP pages
}

// Storage types for unified system
export type StorageType = 'temporary' | 'recent' | 'saved';

// Unified storage options
export interface UnifiedStorageOptions {
  type: StorageType;
  customName?: string; // For saved queries
}

export interface QueryStep {
  userQuery: string;
  formalQuery: string;
  intentParserResult?: IntentParserResult;
  isComposed?: boolean;
  querySteps?: QueryStep[]; // Recursive - steps can have their own steps
  pageSelections?: PageSelection[];
}

/**
 * Core structure for storing queries
 * This is the single source of truth for both simple and composed queries
 */
export interface StoredQuery {
  // Core identification
  id: string;
  timestamp: Date;
  name?: string; // Optional custom name for saved queries

  // Base query (the first/primary query)
  userQuery: string;
  formalQuery: string;
  intentParserResult?: IntentParserResult; // Optional - may not exist for older queries or manually typed queries

  // Composition structure
  isComposed: boolean; // True if this query has additional steps or page selections
  querySteps: QueryStep[]; // Additional query steps (empty array for simple queries)
  pageSelections: PageSelection[]; // Page selections (empty array if none)
}

export interface QueryStorage {
  recent: StoredQuery[]; // Last 3 queries (excluding current)
  saved: StoredQuery[];  // User-saved queries
}

const STORAGE_KEY = 'askYourGraphQueries';
const MAX_RECENT_QUERIES = 3;

/**
 * Sanitize a query object to ensure it has all required fields with proper defaults
 */
const sanitizeQuery = (q: any): StoredQuery => ({
  id: q.id,
  timestamp: new Date(q.timestamp),
  name: q.name,
  userQuery: q.userQuery,
  formalQuery: q.formalQuery || q.userQuery,
  intentParserResult: q.intentParserResult, // Preserve as-is (can be undefined)
  isComposed: q.isComposed ?? false,
  querySteps: q.querySteps ?? [],
  pageSelections: q.pageSelections ?? [],
});

/**
 * Get all stored queries from localStorage
 * Automatically sanitizes queries to ensure consistent structure
 */
export const getStoredQueries = (): QueryStorage => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { recent: [], saved: [] };
    }

    const parsed = JSON.parse(stored);

    // Convert timestamps and sanitize structure
    return {
      recent: (parsed.recent || []).map(sanitizeQuery),
      saved: (parsed.saved || []).map(sanitizeQuery)
    };
  } catch (error) {
    console.warn('Error loading stored queries:', error);
    return { recent: [], saved: [] };
  }
};

/**
 * Save queries to localStorage
 */
export const saveQueries = (queries: QueryStorage): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
  } catch (error) {
    console.error('Error saving queries:', error);
  }
};

/**
 * Add a query to recent list (automatically manages the 3-query limit)
 */
export const addRecentQuery = (query: Omit<StoredQuery, 'id' | 'timestamp'>): void => {
  const queries = getStoredQueries();
  
  const newQuery: StoredQuery = {
    ...query,
    id: generateQueryId(),
    timestamp: new Date()
  };
  
  // Add to front and limit to MAX_RECENT_QUERIES
  queries.recent = [newQuery, ...queries.recent].slice(0, MAX_RECENT_QUERIES);
  
  saveQueries(queries);
};

/**
 * Save a query permanently with optional custom name
 */
export const saveQuery = (query: Omit<StoredQuery, 'id' | 'timestamp'>, customName?: string): string => {
  const queries = getStoredQueries();

  const newQuery: StoredQuery = {
    ...query,
    id: generateQueryId(),
    timestamp: new Date(),
    name: customName || generateQueryName(query.userQuery)
  };

  queries.saved.push(newQuery);
  saveQueries(queries);

  return newQuery.id;
};

/**
 * Save a composed query with query steps and page selections
 */
export const saveComposedQuery = (
  baseQuery: Omit<StoredQuery, 'id' | 'timestamp' | 'isComposed' | 'querySteps' | 'pageSelections'>,
  querySteps: QueryStep[],
  pageSelections: PageSelection[],
  customName?: string
): string => {
  const queries = getStoredQueries();

  const composedQuery: StoredQuery = {
    ...baseQuery,
    id: generateQueryId(),
    timestamp: new Date(),
    name: customName || generateComposedQueryName(baseQuery.userQuery, querySteps, pageSelections),
    isComposed: true,
    querySteps,
    pageSelections
  };

  queries.saved.push(composedQuery);
  saveQueries(queries);

  return composedQuery.id;
};

/**
 * Update an existing query to make it composed by adding query steps or page selections
 */
export const updateToComposedQuery = (
  queryId: string,
  newQuerySteps?: QueryStep[],
  newPageSelections?: PageSelection[]
): boolean => {
  const queries = getStoredQueries();

  // Look in both recent and saved queries
  const allQueries = [...queries.recent, ...queries.saved];
  const existingQuery = allQueries.find(q => q.id === queryId);

  if (!existingQuery) {
    return false;
  }

  // Update the query to be composed
  existingQuery.isComposed = true;
  existingQuery.querySteps = [
    ...(existingQuery.querySteps || []),
    ...(newQuerySteps || [])
  ];
  existingQuery.pageSelections = [
    ...(existingQuery.pageSelections || []),
    ...(newPageSelections || [])
  ];

  // Update the name to reflect it's composed
  if (!existingQuery.name?.includes('(Composed)')) {
    existingQuery.name = (existingQuery.name || generateQueryName(existingQuery.userQuery)) + ' (Composed)';
  }

  saveQueries(queries);
  return true;
};

/**
 * Update an existing query in storage (saved or recent)
 */
export const updateQuery = (id: string, updates: Partial<StoredQuery>): boolean => {
  const queries = getStoredQueries();

  // Try to find in saved queries first
  let queryIndex = queries.saved.findIndex(q => q.id === id);
  let isSaved = true;

  // If not found, try recent queries
  if (queryIndex === -1) {
    queryIndex = queries.recent.findIndex(q => q.id === id);
    isSaved = false;
  }

  // Query not found
  if (queryIndex === -1) {
    return false;
  }

  // Update the query
  const targetArray = isSaved ? queries.saved : queries.recent;
  targetArray[queryIndex] = {
    ...targetArray[queryIndex],
    ...updates,
    // Preserve id and timestamp unless explicitly updated
    id: targetArray[queryIndex].id,
    timestamp: updates.timestamp || targetArray[queryIndex].timestamp,
  };

  saveQueries(queries);
  return true;
};

/**
 * Clean up broken queries with undefined or empty userQuery (TEMPORARY)
 */
export const cleanupBrokenQueries = (): { removedCount: number; queries: string[] } => {
  const queries = getStoredQueries();
  const removedIds: string[] = [];

  const initialSavedLength = queries.saved.length;
  const initialRecentLength = queries.recent.length;

  // Filter out queries with invalid userQuery
  queries.saved = queries.saved.filter(q => {
    if (!q.userQuery || q.userQuery.trim() === '') {
      removedIds.push(q.id);
      console.warn('🗑️ [Cleanup] Removing broken saved query:', q.id, q);
      return false;
    }
    return true;
  });

  queries.recent = queries.recent.filter(q => {
    if (!q.userQuery || q.userQuery.trim() === '') {
      removedIds.push(q.id);
      console.warn('🗑️ [Cleanup] Removing broken recent query:', q.id, q);
      return false;
    }
    return true;
  });

  const totalRemoved = (initialSavedLength - queries.saved.length) + (initialRecentLength - queries.recent.length);

  if (totalRemoved > 0) {
    saveQueries(queries);
    console.log(`✅ [Cleanup] Removed ${totalRemoved} broken queries`);
  } else {
    console.log('✅ [Cleanup] No broken queries found');
  }

  return {
    removedCount: totalRemoved,
    queries: removedIds
  };
};

/**
 * Delete a saved query by ID
 */
export const deleteSavedQuery = (id: string): boolean => {
  const queries = getStoredQueries();
  const initialLength = queries.saved.length;

  queries.saved = queries.saved.filter(q => q.id !== id);

  if (queries.saved.length < initialLength) {
    saveQueries(queries);
    return true;
  }

  return false;
};

/**
 * Rename a saved query
 */
export const renameSavedQuery = (id: string, newName: string): boolean => {
  const queries = getStoredQueries();
  const query = queries.saved.find(q => q.id === id);
  
  if (query) {
    query.name = newName.trim() || generateQueryName(query.userQuery);
    saveQueries(queries);
    return true;
  }
  
  return false;
};

/**
 * Get a specific query by ID from both recent and saved
 */
export const getQueryById = (id: string): StoredQuery | null => {
  const queries = getStoredQueries();
  
  return [...queries.recent, ...queries.saved].find(q => q.id === id) || null;
};

/**
 * Clear all stored queries (for maintenance/debugging)
 */
export const clearAllQueries = (): void => {
  localStorage.removeItem(STORAGE_KEY);
};

/**
 * Generate a unique ID for queries
 */
const generateQueryId = (): string => {
  return `query_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/**
 * Generate a readable name for a query
 */
const generateQueryName = (userQuery: string): string => {
  // Truncate and clean up the query for display
  const cleaned = userQuery.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= 50) {
    return cleaned;
  }

  return cleaned.substring(0, 47) + '...';
};

/**
 * Generate a readable name for a composed query
 */
const generateComposedQueryName = (
  baseQuery: string,
  querySteps: QueryStep[],
  pageSelections: PageSelection[]
): string => {
  const baseName = generateQueryName(baseQuery);
  const stepCount = querySteps.length;
  const pageCount = pageSelections.length;

  const components = [];
  if (stepCount > 0) {
    components.push(`${stepCount} additional ${stepCount === 1 ? 'query' : 'queries'}`);
  }
  if (pageCount > 0) {
    components.push(`${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`);
  }

  if (components.length > 0) {
    return `${baseName} (+ ${components.join(', ')})`;
  }

  return `${baseName} (Composed)`;
};

/**
 * Get current query info (from window - only for initial popup state)
 * This should only be used when opening the popup from external triggers
 */
export const getCurrentQueryInfo = (): { userQuery?: string; formalQuery?: string; intentParserResult?: IntentParserResult } => {
  return {
    userQuery: (window as any).lastUserQuery || undefined,
    formalQuery: (window as any).lastFormalQuery || undefined,
    intentParserResult: (window as any).lastIntentParserResult || undefined
  };
};

/**
 * Get query execution plan for a composed query
 */
export const getComposedQueryExecutionPlan = (query: StoredQuery): {
  initialQuery: { userQuery: string; formalQuery: string; intentParserResult: IntentParserResult };
  additionalSteps: Array<{
    type: 'query' | 'pages';
    data: QueryStep | PageSelection[];
  }>;
} | null => {
  if (!query.isComposed) {
    return null;
  }

  const plan = {
    initialQuery: {
      userQuery: query.userQuery,
      formalQuery: query.formalQuery,
      intentParserResult: query.intentParserResult
    },
    additionalSteps: [] as Array<{
      type: 'query' | 'pages';
      data: QueryStep | PageSelection[];
    }>
  };

  // Add query steps
  if (query.querySteps) {
    query.querySteps.forEach(step => {
      plan.additionalSteps.push({
        type: 'query',
        data: step
      });
    });
  }

  // Add page selections (group them together for efficiency)
  if (query.pageSelections && query.pageSelections.length > 0) {
    plan.additionalSteps.push({
      type: 'pages',
      data: query.pageSelections
    });
  }

  return plan;
};

// =============================================================================
// UNIFIED QUERY SYSTEM
// =============================================================================

/**
 * FIXED: Robust query composition function that handles all composition scenarios correctly
 */
export const composeQueries = (
  baseQuery: StoredQuery | Omit<StoredQuery, 'id' | 'timestamp'>,
  additionalQuery: StoredQuery | Omit<StoredQuery, 'id' | 'timestamp'> | QueryStep
): Omit<StoredQuery, 'id' | 'timestamp'> => {

  // Extract steps from base query (NEVER include the base query itself as a step)
  const baseSteps: QueryStep[] = [];

  // If base query is composed, extract ONLY its additional steps (not the base)
  if ('isComposed' in baseQuery && baseQuery.isComposed && baseQuery.querySteps) {
    baseSteps.push(...baseQuery.querySteps);
  }

  // Extract steps from additional query
  const additionalSteps: QueryStep[] = [];

  if ('userQuery' in additionalQuery && 'formalQuery' in additionalQuery) {
    // Check if it's a QueryStep (just has userQuery and formalQuery)
    if (!('isComposed' in additionalQuery)) {
      // It's a pure QueryStep - add it directly with all its properties
      additionalSteps.push({
        userQuery: additionalQuery.userQuery,
        formalQuery: additionalQuery.formalQuery || additionalQuery.userQuery,
        intentParserResult: (additionalQuery as any).intentParserResult,
        isComposed: (additionalQuery as any).isComposed,
        querySteps: (additionalQuery as any).querySteps,
        pageSelections: (additionalQuery as any).pageSelections,
      });
    } else if (additionalQuery.isComposed && additionalQuery.querySteps) {
      // It's a composed query - add its base as a step PLUS all its steps
      additionalSteps.push({
        userQuery: additionalQuery.userQuery,
        formalQuery: additionalQuery.formalQuery || additionalQuery.userQuery,
        intentParserResult: additionalQuery.intentParserResult,
        isComposed: false, // The base becomes a simple step
        querySteps: [],
        pageSelections: [],
      });
      additionalSteps.push(...additionalQuery.querySteps);
    } else {
      // It's a simple query - add as single step with all available metadata
      additionalSteps.push({
        userQuery: additionalQuery.userQuery,
        formalQuery: additionalQuery.formalQuery || additionalQuery.userQuery,
        intentParserResult: additionalQuery.intentParserResult,
        isComposed: false,
        querySteps: [],
        pageSelections: [],
      });
    }
  }

  // Combine page selections
  const basePageSelections = ('isComposed' in baseQuery && baseQuery.isComposed) ? (baseQuery.pageSelections || []) : [];
  const additionalPageSelections = ('isComposed' in additionalQuery && additionalQuery.isComposed) ? (additionalQuery.pageSelections || []) : [];

  // Create the composed query - base query stays as userQuery, everything else becomes steps
  const composedQuery: Omit<StoredQuery, 'id' | 'timestamp'> = {
    userQuery: baseQuery.userQuery,
    formalQuery: baseQuery.formalQuery || baseQuery.userQuery,
    intentParserResult: baseQuery.intentParserResult,
    isComposed: true,
    querySteps: [...baseSteps, ...additionalSteps],
    pageSelections: [...basePageSelections, ...additionalPageSelections],
    name: ('name' in baseQuery) ? baseQuery.name : undefined
  };

  return composedQuery;
};

/**
 * Unified function to store queries with different storage types
 * Note: For temporary storage, caller should use React state instead of this function
 */
export const storeQuery = (
  query: Omit<StoredQuery, 'id' | 'timestamp'>,
  options: UnifiedStorageOptions,
  onTemporaryStore?: (query: StoredQuery) => void
): string => {
  const queryWithMetadata: StoredQuery = {
    ...query,
    id: generateQueryId(),
    timestamp: new Date(),
    name: options.customName || (query.isComposed ?
      generateComposedQueryName(query.userQuery, query.querySteps || [], query.pageSelections || []) :
      undefined)
  };

  switch (options.type) {
    case 'temporary':
      // Use callback to store in React state instead of window
      if (onTemporaryStore) {
        onTemporaryStore(queryWithMetadata);
      } else {
        // Fallback to window for backward compatibility
        console.warn('Temporary storage without callback - consider using React state');
        (window as any).__currentComposedQuery = queryWithMetadata;
        (window as any).__currentComposedQueryId = queryWithMetadata.id;
      }
      return queryWithMetadata.id;

    case 'recent':
      const queries = getStoredQueries();
      queries.recent = [queryWithMetadata, ...queries.recent].slice(0, MAX_RECENT_QUERIES);
      saveQueries(queries);
      return queryWithMetadata.id;

    case 'saved':
      const savedQueries = getStoredQueries();
      savedQueries.saved.push(queryWithMetadata);
      saveQueries(savedQueries);
      return queryWithMetadata.id;

    default:
      throw new Error(`Unknown storage type: ${options.type}`);
  }
};