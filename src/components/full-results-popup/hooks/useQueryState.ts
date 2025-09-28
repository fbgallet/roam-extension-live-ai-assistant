/**
 * Core Query State Management Hook
 *
 * This hook provides unified state management for all query contexts:
 * - currentQuery: The actively executed query
 * - originalQuery: Query being composed from (in composition mode)
 * - loadedQuery: Query being loaded for composition
 *
 * Replaces the fragmented state approach with a single source of truth.
 */

import { useState, useCallback } from 'react';
import { UnifiedQuery, QueryContext, QueryActions, createComposedQuery, queriesEqual } from '../types/QueryTypes';

export interface UseQueryStateReturn {
  context: QueryContext;
  actions: QueryActions;
}

export const useQueryState = (): UseQueryStateReturn => {
  // Unified state - single source of truth for each query context
  const [currentQuery, setCurrentQuery] = useState<UnifiedQuery | null>(null);
  const [originalQuery, setOriginalQuery] = useState<UnifiedQuery | null>(null);
  const [loadedQuery, setLoadedQuery] = useState<UnifiedQuery | null>(null);
  const [selectedQueryId, setSelectedQueryId] = useState<string>("");

  // Derived state
  const isCompositionMode = originalQuery !== null && loadedQuery !== null;

  // Core state setters
  const handleSetCurrentQuery = useCallback((query: UnifiedQuery | null) => {
    setCurrentQuery(query);
    // When setting a new current query, update selection to reflect it
    if (query) {
      setSelectedQueryId(query.id || "current");
    }
  }, []);

  const handleSetOriginalQuery = useCallback((query: UnifiedQuery | null) => {
    setOriginalQuery(query);
  }, []);

  const handleSetLoadedQuery = useCallback((query: UnifiedQuery | null) => {
    setLoadedQuery(query);
  }, []);

  // Convenience methods
  const clearAllQueries = useCallback(() => {
    setCurrentQuery(null);
    setOriginalQuery(null);
    setLoadedQuery(null);
    setSelectedQueryId("");
  }, []);

  const enterCompositionMode = useCallback((original: UnifiedQuery, loaded: UnifiedQuery) => {
    setOriginalQuery(original);
    setLoadedQuery(loaded);
  }, []);

  const exitCompositionMode = useCallback(() => {
    setOriginalQuery(null);
    setLoadedQuery(null);
  }, []);

  // Query operations
  const executeQuery = useCallback(async (query: UnifiedQuery) => {
    // Set as current query when executed
    handleSetCurrentQuery(query);
    // Exit composition mode since we're executing a specific query
    exitCompositionMode();
  }, [handleSetCurrentQuery, exitCompositionMode]);

  const composeQueries = useCallback((original: UnifiedQuery, additional: UnifiedQuery): UnifiedQuery => {
    return createComposedQuery(original, [additional]);
  }, []);

  // Context object
  const context: QueryContext = {
    currentQuery,
    originalQuery,
    loadedQuery,
    isCompositionMode,
    selectedQueryId,
  };

  // Actions object
  const actions: QueryActions = {
    setCurrentQuery: handleSetCurrentQuery,
    setOriginalQuery: handleSetOriginalQuery,
    setLoadedQuery: handleSetLoadedQuery,
    clearAllQueries,
    enterCompositionMode,
    exitCompositionMode,
    executeQuery,
    composeQueries,
  };

  return {
    context,
    actions,
  };
};

/**
 * Helper hook for derived query state
 */
export const useQueryStateHelpers = (context: QueryContext) => {
  const hasCurrentQuery = context.currentQuery !== null;
  const hasCompositionContext = context.isCompositionMode;
  const canClearQueries = hasCurrentQuery || hasCompositionContext;

  // Get display query for the selected context
  const getDisplayQuery = (): UnifiedQuery | null => {
    if (context.selectedQueryId === "current") {
      return context.currentQuery;
    }
    // For loaded queries, we'd need to fetch from storage based on ID
    return context.currentQuery; // Fallback
  };

  return {
    hasCurrentQuery,
    hasCompositionContext,
    canClearQueries,
    getDisplayQuery,
  };
};