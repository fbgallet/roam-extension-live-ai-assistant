/**
 * Query storage utilities for Ask Your Graph agent
 * Manages recent and saved queries with IntentParser output
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
  searchDetails?: {
    timeRange?: {
      start: string;
      end: string;
    };
    semanticExpansion?: {
      enabled: boolean;
      strategy?: string;
    };
  };
}

export interface StoredQuery {
  id: string;
  timestamp: Date;
  userQuery: string;
  formalQuery: string;
  intentParserResult: IntentParserResult;
  name?: string; // For saved queries
}

export interface QueryStorage {
  recent: StoredQuery[]; // Last 3 queries (excluding current)
  saved: StoredQuery[];  // User-saved queries
}

const STORAGE_KEY = 'askYourGraphQueries';
const MAX_RECENT_QUERIES = 3;

/**
 * Get all stored queries from localStorage
 */
export const getStoredQueries = (): QueryStorage => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { recent: [], saved: [] };
    }
    
    const parsed = JSON.parse(stored);
    
    // Convert timestamps back to Date objects
    return {
      recent: (parsed.recent || []).map((q: any) => ({
        ...q,
        timestamp: new Date(q.timestamp)
      })),
      saved: (parsed.saved || []).map((q: any) => ({
        ...q,
        timestamp: new Date(q.timestamp)
      }))
    };
  } catch (error) {
    console.warn('Error loading stored queries:', error);
    return { recent: [], saved: [] };
  }
};

/**
 * Save queries to localStorage
 */
const saveQueries = (queries: QueryStorage): void => {
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
  return `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
 * Get current query info (from global storage)
 */
export const getCurrentQueryInfo = (): { userQuery?: string; formalQuery?: string; intentParserResult?: IntentParserResult } => {
  return {
    userQuery: (window as any).lastUserQuery || undefined,
    formalQuery: (window as any).lastFormalQuery || undefined,
    intentParserResult: (window as any).lastIntentParserResult || undefined
  };
};