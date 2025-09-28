import { useState, useCallback, useMemo } from "react";
import { UnifiedQuery, QueryContext, createSimpleQuery, storedQueryToUnified, unifiedQueryToStored, queriesEqual } from "../types/QueryTypes";
import { StoredQuery } from "../utils/queryStorage";

interface UseUnifiedQueryManagerProps {
  currentQuery?: UnifiedQuery;
  originalQueryForComposition?: UnifiedQuery;
  loadedQuery?: StoredQuery;
  onQuerySelect: (query: StoredQuery | "current") => void;
}

export interface UseUnifiedQueryManagerReturn {
  queryContext: QueryContext;

  // Query operations
  setCurrentQuery: (query: UnifiedQuery | null) => void;
  setOriginalQuery: (query: UnifiedQuery | null) => void;
  setLoadedQuery: (query: UnifiedQuery | null) => void;

  // Composition mode
  enterCompositionMode: (original: UnifiedQuery, loaded: UnifiedQuery) => void;
  exitCompositionMode: () => void;
  composeQueries: (original: UnifiedQuery, additional: UnifiedQuery) => UnifiedQuery;

  // Utilities
  getCurrentUnifiedQuery: () => UnifiedQuery | null;
  getOriginalUnifiedQuery: () => UnifiedQuery | null;
  getLoadedUnifiedQuery: () => UnifiedQuery | null;

  // State management
  clearAllQueries: () => void;
  setSelectedQueryId: (id: string) => void;
}

export const useUnifiedQueryManager = ({
  currentQuery,
  originalQueryForComposition,
  loadedQuery,
  onQuerySelect,
}: UseUnifiedQueryManagerProps): UseUnifiedQueryManagerReturn => {

  // Core unified query state
  const [queryContext, setQueryContext] = useState<QueryContext>({
    currentQuery: null,
    originalQuery: null,
    loadedQuery: null,
    isCompositionMode: false,
    selectedQueryId: "",
  });

  // Use provided UnifiedQuery directly

  // Convert loaded query
  const loadedUnifiedQuery = useMemo(() => {
    if (!loadedQuery) return null;
    return storedQueryToUnified(loadedQuery);
  }, [loadedQuery]);

  // Update context when props change
  useState(() => {
    setQueryContext(prev => ({
      ...prev,
      currentQuery: currentQuery || null,
      originalQuery: originalQueryForComposition || null,
      loadedQuery: loadedUnifiedQuery,
      isCompositionMode: !!(originalQueryForComposition && loadedUnifiedQuery),
    }));
  });

  // Query operations
  const setCurrentQuery = useCallback((query: UnifiedQuery | null) => {
    setQueryContext(prev => ({ ...prev, currentQuery: query }));
  }, []);

  const setOriginalQuery = useCallback((query: UnifiedQuery | null) => {
    setQueryContext(prev => ({ ...prev, originalQuery: query }));
  }, []);

  const setLoadedQuery = useCallback((query: UnifiedQuery | null) => {
    setQueryContext(prev => ({ ...prev, loadedQuery: query }));
  }, []);

  const setSelectedQueryId = useCallback((id: string) => {
    setQueryContext(prev => ({ ...prev, selectedQueryId: id }));
  }, []);

  // Composition mode management
  const enterCompositionMode = useCallback((original: UnifiedQuery, loaded: UnifiedQuery) => {
    setQueryContext(prev => ({
      ...prev,
      originalQuery: original,
      loadedQuery: loaded,
      isCompositionMode: true,
    }));
  }, []);

  const exitCompositionMode = useCallback(() => {
    setQueryContext(prev => ({
      ...prev,
      originalQuery: null,
      loadedQuery: null,
      isCompositionMode: false,
    }));
  }, []);

  // Query composition logic
  const composeQueries = useCallback((original: UnifiedQuery, additional: UnifiedQuery): UnifiedQuery => {
    const composedQuery: UnifiedQuery = {
      userQuery: original.userQuery,
      formalQuery: original.formalQuery,
      intentParserResult: original.intentParserResult,
      isComposed: true,
      querySteps: [
        ...original.querySteps,
        {
          userQuery: additional.userQuery,
          formalQuery: additional.formalQuery,
        },
        ...additional.querySteps,
      ],
      pageSelections: [
        ...original.pageSelections,
        ...additional.pageSelections,
      ],
    };

    return composedQuery;
  }, []);

  // Clear all queries and state
  const clearAllQueries = useCallback(() => {
    setQueryContext({
      currentQuery: null,
      originalQuery: null,
      loadedQuery: null,
      isCompositionMode: false,
      selectedQueryId: "",
    });
  }, []);

  // Utility getters
  const getCurrentUnifiedQuery = useCallback(() => queryContext.currentQuery, [queryContext.currentQuery]);
  const getOriginalUnifiedQuery = useCallback(() => queryContext.originalQuery, [queryContext.originalQuery]);
  const getLoadedUnifiedQuery = useCallback(() => queryContext.loadedQuery, [queryContext.loadedQuery]);

  return {
    queryContext,
    setCurrentQuery,
    setOriginalQuery,
    setLoadedQuery,
    enterCompositionMode,
    exitCompositionMode,
    composeQueries,
    getCurrentUnifiedQuery,
    getOriginalUnifiedQuery,
    getLoadedUnifiedQuery,
    clearAllQueries,
    setSelectedQueryId,
  };
};