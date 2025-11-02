/**
 * Window Storage Utilities for Last Query Results
 *
 * Manages the window.lastAskYourGraphResults and related query metadata
 * to enable reopening the popup with the last executed query's full state.
 *
 * Handles two key use cases:
 * 1. Query executed from OUTSIDE FullResultsPopup (via Toaster/agent)
 * 2. Query executed from INSIDE FullResultsPopup (via QueryManager)
 *    - In this case, the new query REPLACES the previous "last" query
 */

import { StoredQuery } from "./queryStorage";

export interface WindowQueryState {
  results: any[];
  userQuery: string;
  formalQuery: string;
  intentParserResult?: any;
  targetUid?: string;
  // Complete query structure including steps and pageSelections
  query: StoredQuery;
}

/**
 * Update window storage with complete query structure and results
 * This is called whenever a query is executed (from inside or outside popup)
 * to ensure the "last query" state is always current
 */
export const updateWindowQueryStorage = (
  results: any[],
  query: StoredQuery,
  targetUid?: string
): void => {
  (window as any).lastAskYourGraphResults = results;
  (window as any).lastUserQuery = query.userQuery;
  (window as any).lastFormalQuery = query.formalQuery;
  (window as any).lastIntentParserResult = query.intentParserResult;
  // Store the complete query structure for full restoration
  (window as any).lastQuery = query;

  if (targetUid) {
    (window as any).lastAgentResponseTargetUid = targetUid;
  }
};

/**
 * Capture current window query state before clearing
 * This ensures we preserve the state when opening the popup
 */
export const captureWindowQueryState = (): Partial<WindowQueryState> | null => {
  const hasResults = (window as any).lastAskYourGraphResults;

  if (!hasResults) {
    return null;
  }

  return {
    results: (window as any).lastAskYourGraphResults || [],
    userQuery: (window as any).lastUserQuery,
    formalQuery: (window as any).lastFormalQuery,
    intentParserResult: (window as any).lastIntentParserResult,
    targetUid: (window as any).lastAgentResponseTargetUid,
    query: (window as any).lastQuery,
  };
};

/**
 * Get the last query from window storage
 */
export const getLastQuery = (): StoredQuery | null => {
  return (window as any).lastQuery || null;
};

/**
 * Get the last results from window storage
 */
export const getLastResults = (): any[] => {
  return (window as any).lastAskYourGraphResults || [];
};

/**
 * Clear all window query storage
 * Called when popup opens to prevent accumulation
 */
export const clearWindowQueryStorage = (): void => {
  delete (window as any).__currentComposedQuery;
  delete (window as any).__currentComposedQueryId;
  delete (window as any).__originalQueryForComposition;
  delete (window as any).lastUserQuery;
  delete (window as any).lastFormalQuery;
  delete (window as any).lastIntentParserResult;
  delete (window as any).lastAskYourGraphResults;
  delete (window as any).lastQuery;
  delete (window as any).previousUserQuery;
  delete (window as any).previousFormalQuery;
  delete (window as any).previousIntentParserResult;
  delete (window as any).lastAgentResponseTargetUid;
};
