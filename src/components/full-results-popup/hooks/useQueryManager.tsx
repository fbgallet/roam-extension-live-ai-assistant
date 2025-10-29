import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Menu, MenuItem } from "@blueprintjs/core";
import { Result } from "../types/types";
import {
  StoredQuery,
  QueryStorage,
  getStoredQueries,
  deleteSavedQuery,
  renameSavedQuery,
  getCurrentQueryInfo,
  storeQuery,
} from "../utils/queryStorage";
import { UnifiedQuery, createSimpleQuery } from "../types/QueryTypes";

interface UseQueryManagerProps {
  currentResults: Result[];
  currentUserQuery?: string;
  currentFormalQuery?: string;
  onQuerySelect: (query: StoredQuery | "current") => void;
  onQueryLoadedIntoComposer?: (
    query: StoredQuery,
    forceResetOriginal?: boolean
  ) => void;
  onQueryChange: (query: string) => void;
  onClearAll?: () => void;
  disabled?: boolean;
  originalQueryForComposition?: UnifiedQuery; // Changed to support full composed queries
  loadedQuery?: StoredQuery;
  originalLoadedQuery?: StoredQuery | null; // Original query before edits, for detecting changes
  tempComposedQuery?: StoredQuery | null; // NEW: Temporary composed query from React state
  sessionPageSelections?: import("../utils/queryStorage").PageSelection[]; // NEW: Page selections in current session

  // NEW: Callbacks for external state management
  onOriginalQueryForCompositionChange?: (query: UnifiedQuery | null) => void;
}

export interface UseQueryManagerReturn {
  // State
  queries: QueryStorage;
  selectedValue: string;
  isExpanded: boolean;

  // Dialogs
  showSaveDialog: boolean;
  showRenameDialog: boolean;
  showClearAllDialog: boolean;
  saveQueryName: string;
  renameValue: string;
  renameQueryId: string;

  // Handlers
  handleSelectionChange: (item: any) => void;
  handleDeleteQuery: (queryId: string) => void;
  handleClearResults: () => void;
  handleSaveQuery: () => void;
  handleRenameQuery: () => void;
  handleClearAllQueries: () => void;
  refreshQueries: () => void;

  // Setters
  setSelectedValue: (value: string) => void;
  setIsExpanded: (expanded: boolean) => void;
  setShowSaveDialog: (show: boolean) => void;
  setShowRenameDialog: (show: boolean) => void;
  setShowClearAllDialog: (show: boolean) => void;
  setSaveQueryName: (name: string) => void;
  setRenameValue: (value: string) => void;
  setRenameQueryId: (id: string) => void;

  // Computed
  canSaveCurrent: () => boolean;
  generateDefaultName: (userQuery: string) => string;
  actionsMenuContent: JSX.Element;

  // Query utilities (callback-based external state)
  getCurrentUnifiedQuery: () => UnifiedQuery | null;
}

export const useQueryManager = ({
  currentResults,
  currentUserQuery,
  currentFormalQuery,
  onQuerySelect,
  onQueryLoadedIntoComposer,
  onQueryChange,
  onClearAll,
  disabled,
  originalQueryForComposition,
  loadedQuery,
  originalLoadedQuery,
  tempComposedQuery,
  sessionPageSelections = [],
  onOriginalQueryForCompositionChange,
}: UseQueryManagerProps): UseQueryManagerReturn => {
  // State
  const [queries, setQueries] = useState<QueryStorage>({
    recent: [],
    saved: [],
  });
  const [selectedValue, setSelectedValue] = useState<string>(
    currentUserQuery ? "current" : ""
  );
  const [isExpanded, setIsExpanded] = useState(
    !currentUserQuery && !currentResults?.length
  );

  // Dialogs
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);
  const [renameQueryId, setRenameQueryId] = useState<string>("");
  const [saveQueryName, setSaveQueryName] = useState("");
  const [renameValue, setRenameValue] = useState("");

  // Track loaded query for UI feedback
  const [uiLoadedQuery, setUILoadedQuery] = useState<StoredQuery | null>(null);

  // External state management: Query context is managed by FullResultsPopup
  // useQueryManager provides logic and calls callbacks to update external state

  // Function to refresh queries from storage
  const refreshQueries = useCallback(() => {
    const storedQueries = getStoredQueries();
    setQueries(storedQueries);

    // Log composed queries for debugging
    const composedQueries = [
      ...storedQueries.recent,
      ...storedQueries.saved,
    ].filter((q) => q.isComposed);

    // If we have a current query but selectedValue is not "current", switch to current
    // This handles the case after composition where we want to show the composed query
    if (currentUserQuery && selectedValue !== "current") {
      setSelectedValue("current");
    }
  }, [currentUserQuery, selectedValue]);

  // Load queries from storage on mount
  useEffect(() => {
    refreshQueries();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Query Management Functions (callback-based for external state)
  const getCurrentUnifiedQuery = useCallback((): UnifiedQuery | null => {
    if (currentUserQuery) {
      return createSimpleQuery(
        currentUserQuery,
        currentFormalQuery,
        (window as any).lastIntentParserResult
      );
    }
    return null;
  }, [currentUserQuery, currentFormalQuery]);

  const notifyOriginalQueryChange = useCallback(
    (query: UnifiedQuery | null) => {
      // Notify external state manager (FullResultsPopup)
      if (onOriginalQueryForCompositionChange) {
        onOriginalQueryForCompositionChange(query);
      }

      // Maintain backward compatibility by setting window variable for external components
      if (query) {
        (window as any).__originalQueryForComposition = {
          userQuery: query.userQuery,
          formalQuery: query.formalQuery,
          intentParserResult: query.intentParserResult,
          isComposed: query.isComposed,
          querySteps: query.querySteps || [],
          pageSelections: query.pageSelections || [],
        };
      } else {
        delete (window as any).__originalQueryForComposition;
      }
    },
    [onOriginalQueryForCompositionChange]
  );

  // Watch for changes in currentUserQuery and switch to "current" when it updates
  // This ensures that after composition, we show the composed query as "current"
  // Also handle clearing by resetting selectedValue when query is cleared
  useEffect(() => {
    // Only switch to "current" if:
    // 1. We have a current query
    // 2. We're not already on "current"
    // 3. We're not actively viewing a stored query (selectedValue should stay as the query ID)
    const isViewingStoredQuery =
      selectedValue !== "current" && selectedValue !== "";
    const allQueryIds = [...queries.recent, ...queries.saved].map((q) => q.id);
    const isValidStoredQuerySelected =
      isViewingStoredQuery && allQueryIds.includes(selectedValue);

    if (
      currentUserQuery &&
      selectedValue !== "current" &&
      !isValidStoredQuerySelected
    ) {
      // Only switch to current if we're not viewing a valid stored query

      setSelectedValue("current");
    } else if (!currentUserQuery && selectedValue === "current") {
      // When currentUserQuery is cleared, reset to empty selection
      setSelectedValue("");
    }
  }, [currentUserQuery, selectedValue, queries.recent, queries.saved]);

  // Refresh queries when tempComposedQuery changes (e.g., after composition)
  useEffect(() => {
    if (tempComposedQuery) {
      refreshQueries();
    }
  }, [tempComposedQuery, refreshQueries]);

  const handleSelectionChange = useCallback(
    (item: any) => {
      if (disabled) return;

      // Don't allow selection of group headers
      if (item.id.startsWith("__group_")) {
        return;
      }

      setSelectedValue(item.id);

      // Call parent's query selection handler to trigger composition logic
      if (item.id === "current") {
        onQuerySelect("current");
      } else if (item.query) {
        // ALWAYS notify parent that query was loaded (so it can store the full structure in lastLoadedQueryRef)
        if (onQueryLoadedIntoComposer) {
          onQueryLoadedIntoComposer(item.query);
        }

        // Only trigger onQuerySelect (which may execute) if there's already a current query
        // Otherwise, just load the query into the composer
        if (currentUserQuery) {
          onQuerySelect(item.query);
        }
      }

      // Track loaded query for UI display (but don't auto-fill composer)
      if (item.id !== "current" && item.query) {
        setUILoadedQuery(item.query);
        setIsExpanded(true);
      }
    },
    [
      disabled,
      currentUserQuery,
      currentFormalQuery,
      tempComposedQuery,
      queries.recent,
      queries.saved,
      onQuerySelect,
      onQueryChange,
      notifyOriginalQueryChange,
    ]
  );

  const handleDeleteQuery = useCallback(
    (queryId: string) => {
      // Try to delete from saved queries first
      let deleted = deleteSavedQuery(queryId);

      if (!deleted) {
        // If not found in saved queries, delete from recent queries
        const currentQueries = getStoredQueries();
        const recentIndex = currentQueries.recent.findIndex(
          (q) => q.id === queryId
        );

        if (recentIndex !== -1) {
          currentQueries.recent.splice(recentIndex, 1);
          // Save the updated queries
          try {
            localStorage.setItem(
              "askYourGraphQueries",
              JSON.stringify(currentQueries)
            );
            deleted = true;
          } catch (error) {
            console.error("Error saving queries after deletion:", error);
          }
        }
      }

      if (deleted) {
        setQueries(getStoredQueries());

        // If the deleted query was selected, switch back to current and clear results
        if (selectedValue === queryId) {
          setSelectedValue("current");
          onQuerySelect("current");

          // Clear results when deleting the currently viewed query
          if (onClearAll) {
            onClearAll();
          }
        }
      } else {
        console.warn(
          "🗑️ [QueryManager] Query not found for deletion:",
          queryId
        );
      }
    },
    [selectedValue, onQuerySelect, onClearAll]
  );

  const handleClearResults = useCallback(() => {
    if (onClearAll) {
      // Use parent's clear all function for complete reset
      onClearAll();
    }

    // Reset query selection to avoid showing stale query information
    setSelectedValue("");

    // Clear any loaded query state to remove query descriptions
    setUILoadedQuery(null);

    // Clear the composer query text
    onQueryChange("");
  }, [onClearAll, onQueryChange]);

  const handleSaveQuery = useCallback(async () => {
    // PRIORITY 1: Check if we have a stored query with page selections added
    // This happens when user runs query A, then adds pages to it
    if (sessionPageSelections.length > 0 && currentUserQuery) {
      // Find the stored query that matches current query
      const allQueries = [...queries.recent, ...queries.saved];
      const storedQuery = allQueries.find(
        (q) => q.userQuery === currentUserQuery
      );

      if (storedQuery) {
        // Saving existing query with added page selections as new
        const queryName =
          saveQueryName.trim() || generateDefaultName(storedQuery.userQuery);
        const { id, timestamp, ...queryWithoutMeta } = storedQuery;

        const queryToSave = {
          ...queryWithoutMeta,
          pageSelections: [
            ...(queryWithoutMeta.pageSelections || []),
            ...sessionPageSelections,
          ],
          isComposed: true,
        };

        storeQuery(queryToSave, { type: "saved", customName: queryName });

        setQueries(getStoredQueries());
        setShowSaveDialog(false);
        setSaveQueryName("");
        return;
      }
    }

    // PRIORITY 2: Check if we're saving a loaded query with modifications (text edits or page selections)
    if (
      loadedQuery &&
      (originalLoadedQuery?.userQuery !== loadedQuery.userQuery ||
        sessionPageSelections.length > 0)
    ) {
      // Saving loaded query with modifications as new
      const queryName =
        saveQueryName.trim() || generateDefaultName(loadedQuery.userQuery);
      const { id, timestamp, ...queryWithoutMeta } = loadedQuery;

      // Add session page selections to the query
      const queryToSave = {
        ...queryWithoutMeta,
        pageSelections: [
          ...(queryWithoutMeta.pageSelections || []),
          ...sessionPageSelections,
        ],
        isComposed:
          (queryWithoutMeta.pageSelections?.length || 0) +
            sessionPageSelections.length >
            0 || queryWithoutMeta.isComposed,
      };

      storeQuery(queryToSave, { type: "saved", customName: queryName });

      setQueries(getStoredQueries());
      setShowSaveDialog(false);
      setSaveQueryName("");
      return;
    }

    // PRIORITY 3: Standard save for new queries
    const currentInfo = getCurrentQueryInfo();

    // Allow saving if we have either a userQuery OR pageSelections
    if (!currentInfo.userQuery && sessionPageSelections.length === 0) {
      console.warn("No current query to save");
      return;
    }

    // Only require intentParserResult if we have a userQuery
    if (currentInfo.userQuery && !currentInfo.intentParserResult) {
      console.warn("No intent parser result for current query");
      return;
    }

    const queryName =
      saveQueryName.trim() ||
      (currentInfo.userQuery
        ? generateDefaultName(currentInfo.userQuery)
        : (() => {
            const pageNames = sessionPageSelections.map((p) => p.title);
            const firstPages = pageNames.slice(0, 3).join(", ");
            const remaining = pageNames.length - 3;
            return remaining > 0
              ? `${firstPages}, +${remaining} more`
              : firstPages;
          })());

    // storeQuery already imported at the top of this function
    let queryToSave;

    // Check if there's a temporary composed query that matches (from React state)
    if (tempComposedQuery && tempComposedQuery.userQuery === currentUserQuery) {
      // Use the temporary composed query structure, adding session page selections
      const { id, timestamp, ...queryWithoutMeta } = tempComposedQuery;
      queryToSave = {
        ...queryWithoutMeta,
        pageSelections: [
          ...(queryWithoutMeta.pageSelections || []),
          ...sessionPageSelections,
        ],
        isComposed:
          queryWithoutMeta.isComposed || sessionPageSelections.length > 0,
      };
    } else {
      // Check if current query is in storage
      const allQueries = [...queries.recent, ...queries.saved];
      const currentStoredQuery =
        allQueries.find(
          (q) => q.userQuery === currentUserQuery && q.isComposed
        ) || allQueries.find((q) => q.userQuery === currentInfo.userQuery);

      if (currentStoredQuery?.isComposed) {
        // Save existing composed query structure, adding session page selections
        const { id, timestamp, ...queryWithoutMeta } = currentStoredQuery;
        queryToSave = {
          ...queryWithoutMeta,
          pageSelections: [
            ...(queryWithoutMeta.pageSelections || []),
            ...sessionPageSelections,
          ],
        };
      } else {
        // Create simple query structure, adding session page selections
        queryToSave = {
          userQuery: currentInfo.userQuery || "", // Can be empty for pageSelections-only queries
          formalQuery: currentInfo.formalQuery || currentInfo.userQuery || "",
          intentParserResult: currentInfo.intentParserResult,
          isComposed: sessionPageSelections.length > 0,
          querySteps: [],
          pageSelections: sessionPageSelections,
        };
      }
    }

    // Save using unified system
    storeQuery(queryToSave, { type: "saved", customName: queryName });

    setQueries(getStoredQueries());
    setShowSaveDialog(false);
    setSaveQueryName("");
  }, [
    queries,
    currentUserQuery,
    tempComposedQuery,
    saveQueryName,
    loadedQuery,
    originalLoadedQuery,
    sessionPageSelections,
  ]);

  const handleRenameQuery = useCallback(() => {
    if (renameQueryId && renameValue.trim()) {
      renameSavedQuery(renameQueryId, renameValue.trim());
      setQueries(getStoredQueries());
    }
    setShowRenameDialog(false);
    setRenameQueryId("");
    setRenameValue("");
  }, [renameQueryId, renameValue]);

  const handleClearAllQueries = useCallback(() => {
    console.log("🗑️ [QueryManager] Clearing all stored queries");

    // Clear all queries from localStorage
    try {
      localStorage.removeItem("askYourGraphQueries");
    } catch (error) {
      console.error("Error clearing stored queries:", error);
    }

    // Refresh the queries state
    setQueries(getStoredQueries());

    // Reset selected value to avoid referencing deleted queries
    setSelectedValue("");
    onQuerySelect("current");

    // Close the dialog
    setShowClearAllDialog(false);
  }, [onQuerySelect]);

  const generateDefaultName = useCallback((userQuery: string): string => {
    const cleaned = userQuery.trim().replace(/\s+/g, " ");
    return cleaned.length <= 80 ? cleaned : cleaned.substring(0, 77) + "...";
  }, []);

  const canSaveCurrent = useCallback(() => {
    const currentInfo = getCurrentQueryInfo();

    // Must have a valid query OR session page selections
    if (!currentInfo.userQuery && sessionPageSelections.length === 0) {
      return false;
    }

    // If there are session page selections, enable save (query has been modified with page additions)
    if (sessionPageSelections && sessionPageSelections.length > 0) {
      return true;
    }

    // If loaded query has been edited (different from original), enable save
    if (loadedQuery && originalLoadedQuery) {
      const hasBeenEdited =
        loadedQuery.userQuery.trim() !== originalLoadedQuery.userQuery.trim();

      if (hasBeenEdited) {
        return true;
      }
    }

    // Must have intentParserResult for new queries
    if (!currentInfo.intentParserResult) {
      return false;
    }

    // If there's a loaded query, only allow saving if the current query is different
    if (loadedQuery) {
      const isDifferent =
        currentInfo.userQuery.trim() !== loadedQuery.userQuery.trim();
      return isDifferent;
    }

    // If no loaded query, can save
    return true;
  }, [loadedQuery, originalLoadedQuery, sessionPageSelections]);

  // Memoize the actions menu content to prevent excessive re-renders
  const actionsMenuContent = useMemo(() => {
    const hasResults = currentResults && currentResults.length > 0;
    const hasCurrentQuery = currentUserQuery && currentUserQuery.trim() !== "";
    const hasLoadedQuery = selectedValue && selectedValue !== "";
    const hasStoredQuery =
      selectedValue !== "current" &&
      [...queries.recent, ...queries.saved].some((q) => q.id === selectedValue);

    return (
      <Menu>
        {/* Clear query and results option - show if there are results OR current query OR any loaded query */}
        {(hasResults || hasCurrentQuery || hasLoadedQuery) && (
          <MenuItem
            icon="clean"
            text="Clear query and results"
            onClick={() => {
              handleClearResults();
            }}
          />
        )}

        {/* Delete stored query option - show if a saved query is loaded */}
        {hasStoredQuery && (
          <MenuItem
            icon="trash"
            text="Delete this stored query"
            onClick={() => {
              handleDeleteQuery(selectedValue);
            }}
          />
        )}

        {/* Clear all queries option - show if there are any stored queries */}
        {(queries.recent.length > 0 || queries.saved.length > 0) && (
          <MenuItem
            icon="trash"
            text="Delete ALL stored queries ⚠️"
            intent="danger"
            onClick={() => {
              setShowClearAllDialog(true);
            }}
          />
        )}
      </Menu>
    );
  }, [
    currentResults?.length,
    selectedValue,
    queries.recent.length,
    queries.saved.length,
    handleClearResults,
    handleDeleteQuery,
    setShowClearAllDialog,
  ]);

  return {
    // State
    queries,
    selectedValue,
    isExpanded,

    // Dialogs
    showSaveDialog,
    showRenameDialog,
    showClearAllDialog,
    saveQueryName,
    renameValue,
    renameQueryId,

    // Handlers
    handleSelectionChange,
    handleDeleteQuery,
    handleClearResults,
    handleSaveQuery,
    handleRenameQuery,
    handleClearAllQueries,
    refreshQueries,

    // Setters
    setSelectedValue,
    setIsExpanded,
    setShowSaveDialog,
    setShowRenameDialog,
    setShowClearAllDialog,
    setSaveQueryName,
    setRenameValue,
    setRenameQueryId,

    // Computed
    canSaveCurrent,
    generateDefaultName,
    actionsMenuContent,

    // Query utilities (callback-based external state)
    getCurrentUnifiedQuery,
  };
};
