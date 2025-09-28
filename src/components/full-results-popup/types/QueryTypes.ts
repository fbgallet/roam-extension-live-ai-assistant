/**
 * Unified Query Type System
 *
 * This module defines a clean, unified approach to query management where:
 * - All queries (simple or composed) use the same base interface
 * - State is never fragmented across multiple variables
 * - Composition is handled through the querySteps array
 */

import { IntentParserResult, PageSelection, StoredQuery } from "../utils/queryStorage";

// Re-declare QueryStep here for consistency since we enhanced it
export interface QueryStep {
  userQuery: string;
  formalQuery: string;
  intentParserResult?: IntentParserResult;
  isComposed?: boolean;
  querySteps?: QueryStep[]; // Recursive - steps can have their own steps
  pageSelections?: PageSelection[];
}

/**
 * Unified query interface that handles both simple and composed queries
 * This replaces the fragmented state approach with a single source of truth
 */
export interface UnifiedQuery {
  userQuery: string;
  formalQuery: string;
  intentParserResult?: IntentParserResult;
  isComposed: boolean;
  querySteps: QueryStep[];
  pageSelections: PageSelection[];

  // Optional fields for saved queries
  id?: string;
  timestamp?: Date;
  name?: string;
}

/**
 * Query execution context - tracks which queries are in what state
 */
export interface QueryContext {
  // The currently active/executed query (what user sees results for)
  currentQuery: UnifiedQuery | null;

  // When in composition mode: the original query being composed with
  originalQuery: UnifiedQuery | null;

  // When in composition mode: the query being loaded for composition
  loadedQuery: UnifiedQuery | null;

  // UI state
  isCompositionMode: boolean;
  selectedQueryId: string; // "" = none, "current" = current query, or storage ID
}

/**
 * Actions for query state management
 */
export interface QueryActions {
  // Core state setters
  setCurrentQuery: (query: UnifiedQuery | null) => void;
  setOriginalQuery: (query: UnifiedQuery | null) => void;
  setLoadedQuery: (query: UnifiedQuery | null) => void;

  // Convenience methods
  clearAllQueries: () => void;
  enterCompositionMode: (original: UnifiedQuery, loaded: UnifiedQuery) => void;
  exitCompositionMode: () => void;

  // Query operations
  executeQuery: (query: UnifiedQuery) => Promise<void>;
  composeQueries: (original: UnifiedQuery, additional: UnifiedQuery) => UnifiedQuery;
}

/**
 * Convert between StoredQuery and UnifiedQuery formats
 */
export const storedQueryToUnified = (stored: StoredQuery): UnifiedQuery => ({
  userQuery: stored.userQuery,
  formalQuery: stored.formalQuery || stored.userQuery,
  intentParserResult: stored.intentParserResult,
  isComposed: stored.isComposed || false,
  querySteps: stored.querySteps || [],
  pageSelections: stored.pageSelections || [],
  id: stored.id,
  timestamp: stored.timestamp,
  name: stored.name,
});

export const unifiedQueryToStored = (unified: UnifiedQuery): Omit<StoredQuery, 'id' | 'timestamp'> => ({
  userQuery: unified.userQuery,
  formalQuery: unified.formalQuery,
  intentParserResult: unified.intentParserResult,
  isComposed: unified.isComposed,
  querySteps: unified.querySteps,
  pageSelections: unified.pageSelections,
  name: unified.name,
});

/**
 * Create a simple (non-composed) query
 */
export const createSimpleQuery = (
  userQuery: string,
  formalQuery?: string,
  intentParserResult?: IntentParserResult
): UnifiedQuery => ({
  userQuery,
  formalQuery: formalQuery || userQuery,
  intentParserResult,
  isComposed: false,
  querySteps: [],
  pageSelections: [],
});

/**
 * Create a composed query from a base query and additional steps
 */
export const createComposedQuery = (
  baseQuery: UnifiedQuery,
  additionalSteps: UnifiedQuery[]
): UnifiedQuery => ({
  userQuery: baseQuery.userQuery,
  formalQuery: baseQuery.formalQuery,
  intentParserResult: baseQuery.intentParserResult,
  isComposed: true,
  querySteps: [
    ...baseQuery.querySteps,
    ...additionalSteps.flatMap(step =>
      step.isComposed
        ? [{ userQuery: step.userQuery, formalQuery: step.formalQuery }, ...step.querySteps]
        : [{ userQuery: step.userQuery, formalQuery: step.formalQuery }]
    )
  ],
  pageSelections: [
    ...baseQuery.pageSelections,
    ...additionalSteps.flatMap(step => step.pageSelections)
  ],
});

/**
 * Check if two queries are equivalent
 */
export const queriesEqual = (a: UnifiedQuery | null, b: UnifiedQuery | null): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;

  return (
    a.userQuery === b.userQuery &&
    a.formalQuery === b.formalQuery &&
    a.isComposed === b.isComposed &&
    a.querySteps.length === b.querySteps.length &&
    a.querySteps.every((step, i) =>
      step.userQuery === b.querySteps[i]?.userQuery &&
      step.formalQuery === b.querySteps[i]?.formalQuery
    )
  );
};