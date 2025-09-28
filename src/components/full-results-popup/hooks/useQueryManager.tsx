import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Menu, MenuItem } from "@blueprintjs/core";
import { Result } from "../types";
import {
  StoredQuery,
  QueryStorage,
  getStoredQueries,
  deleteSavedQuery,
  renameSavedQuery,
  getCurrentQueryInfo,
} from "../utils/queryStorage";

interface UseQueryManagerProps {
  currentResults: Result[];
  currentUserQuery?: string;
  currentFormalQuery?: string;
  onQuerySelect: (query: StoredQuery | "current") => void;
  onQueryChange: (query: string) => void;
  onClearAll?: () => void;
  disabled?: boolean;
  originalQueryForComposition?: {
    userQuery: string;
    formalQuery: string;
  };
  loadedQuery?: StoredQuery;
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
}

export const useQueryManager = ({
  currentResults,
  currentUserQuery,
  currentFormalQuery,
  onQuerySelect,
  onQueryChange,
  onClearAll,
  disabled,
  originalQueryForComposition,
  loadedQuery,
}: UseQueryManagerProps): UseQueryManagerReturn => {
  // State
  const [queries, setQueries] = useState<QueryStorage>({
    recent: [],
    saved: [],
  });
  const [selectedValue, setSelectedValue] = useState<string>(
    currentUserQuery ? "current" : ""
  );
  const [isExpanded, setIsExpanded] = useState(!currentUserQuery);

  // Dialogs
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);
  const [renameQueryId, setRenameQueryId] = useState<string>("");
  const [saveQueryName, setSaveQueryName] = useState("");
  const [renameValue, setRenameValue] = useState("");

  // Track loaded query for UI feedback
  const [uiLoadedQuery, setUILoadedQuery] = useState<StoredQuery | null>(null);

  // Function to refresh queries from storage
  const refreshQueries = useCallback(() => {
    const storedQueries = getStoredQueries();
    setQueries(storedQueries);

    // Log composed queries for debugging
    const composedQueries = [
      ...storedQueries.recent,
      ...storedQueries.saved,
    ].filter((q) => q.isComposed);
    if (composedQueries.length > 0) {
      console.log(
        "🔗 [QueryManager] Composed queries in storage:",
        composedQueries.map((q) => ({
          id: q.id,
          userQuery: q.userQuery,
          isComposed: q.isComposed,
          querySteps: q.querySteps?.length || 0,
          queryStepsDetails: q.querySteps?.map((step) => step.userQuery) || [],
          pageSelections: q.pageSelections?.length || 0,
          pageSelectionsDetails:
            q.pageSelections?.map((page) => page.title) || [],
        }))
      );
    } else {
    }


    // If we have a current query but selectedValue is not "current", switch to current
    // This handles the case after composition where we want to show the composed query
    if (currentUserQuery && selectedValue !== "current") {
      setSelectedValue("current");
    }
  }, [currentUserQuery, selectedValue]);

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
      console.log(
        "🔄 [QueryManager] useEffect switching to current from:",
        selectedValue
      );
      setSelectedValue("current");
    } else if (!currentUserQuery && selectedValue === "current") {
      // When currentUserQuery is cleared, reset to empty selection
      setSelectedValue("");
    }
  }, [currentUserQuery, selectedValue, queries.recent, queries.saved]);

  // Refresh queries when component mounts or updates
  useEffect(() => {
    setQueries(getStoredQueries());
  }, []);

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
        // Log all query loading for debugging (composed and simple)
        console.log("📋 [QueryManager] Loading query:", {
          id: item.query.id,
          userQuery: item.query.userQuery,
          isComposed: item.query.isComposed,
          hasQuerySteps: !!item.query.querySteps,
          queryStepsCount: item.query.querySteps?.length || 0,
          hasPageSelections: !!item.query.pageSelections,
          pageSelectionsCount: item.query.pageSelections?.length || 0,
          fullQuery: item.query, // Log the full object to inspect its structure
        });

        if (item.query.isComposed) {
          console.log("🔗 [QueryManager] >>> COMPOSED query details:", {
            querySteps:
              item.query.querySteps?.map((step) => step.userQuery) || [],
            pageSelections:
              item.query.pageSelections?.map((page) => page.title) || [],
          });
        } else {
          console.log("📝 [QueryManager] >>> SIMPLE query");
        }

        // Only trigger composition logic if there's already a current query
        // Otherwise, just load the query into the interface without executing
        if (currentUserQuery) {
          console.log(
            "🔄 [QueryManager] Current query exists - triggering composition logic"
          );
          onQuerySelect(item.query);
        } else {
          console.log(
            "📋 [QueryManager] No current query - just loading into interface"
          );
          // Don't call onQuerySelect to avoid automatic execution
        }
      }

      // Auto-load query into composer when selected (except for "current")
      if (item.id !== "current" && item.query) {
        // If there's a current query, store it as the original query for composition
        if (currentUserQuery && currentFormalQuery) {
          // First check if there's a current composed query ID that matches
          const currentComposedQueryId = (window as any).__currentComposedQueryId;
          const tempComposedQuery = (window as any).__currentComposedQuery;

          if (tempComposedQuery && tempComposedQuery.userQuery === currentUserQuery) {
            // Use the temporary composed query from memory, but create a fresh copy to prevent accumulation
            (window as any).__originalQueryForComposition = {
              userQuery: tempComposedQuery.userQuery,
              formalQuery: tempComposedQuery.formalQuery,
              intentParserResult: tempComposedQuery.intentParserResult,
              isComposed: tempComposedQuery.isComposed,
              querySteps: tempComposedQuery.querySteps || [],
              pageSelections: tempComposedQuery.pageSelections || [],
              id: tempComposedQuery.id,
              timestamp: tempComposedQuery.timestamp
            };
          } else if (currentComposedQueryId) {
            // Check if we can find the composed query by ID in storage
            const allQueries = [...queries.recent, ...queries.saved];
            const currentStoredQuery = allQueries.find(
              (q) => q.id === currentComposedQueryId
            );

            if (currentStoredQuery && currentStoredQuery.isComposed) {
              // Store the full composed query structure found by ID
              (window as any).__originalQueryForComposition = currentStoredQuery;
            } else {
              // Fallback: look by userQuery
              const queryByText = allQueries.find(
                (q) => q.userQuery === currentUserQuery && q.isComposed
              );

              (window as any).__originalQueryForComposition = queryByText || {
                userQuery: currentUserQuery,
                formalQuery: currentFormalQuery
              };
            }
          } else {
            // Check if the current query is a composed query in storage
            const allQueries = [...queries.recent, ...queries.saved];
            const currentStoredQuery = allQueries.find(
              (q) => q.userQuery === currentUserQuery
            );

            if (currentStoredQuery && currentStoredQuery.isComposed) {
              // Store the full composed query structure
              (window as any).__originalQueryForComposition = currentStoredQuery;
            } else {
              // Store as simple query
              (window as any).__originalQueryForComposition = {
                userQuery: currentUserQuery,
                formalQuery: currentFormalQuery
              };
            }
          }
        }

        // Load the query text into the composer
        onQueryChange(item.query.userQuery);

        // Store the loaded query for UI feedback
        setUILoadedQuery(item.query);

        // Expand the section so user can see the execution buttons
        setIsExpanded(true);

        // If no current query, show helpful message
        if (!currentUserQuery) {
          console.log(
            "💡 [QueryManager] Query loaded into composer - user can choose to execute, modify, or load another"
          );
        }
      }
    },
    [disabled, currentUserQuery, currentFormalQuery, onQuerySelect, onQueryChange]
  );

  const handleDeleteQuery = useCallback(
    (queryId: string) => {
      console.log("🗑️ [QueryManager] Attempting to delete query:", queryId);

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
            console.log("🗑️ [QueryManager] Deleted query from recent queries");
          } catch (error) {
            console.error("Error saving queries after deletion:", error);
          }
        }
      } else {
        console.log("🗑️ [QueryManager] Deleted query from saved queries");
      }

      if (deleted) {
        setQueries(getStoredQueries());

        // If the deleted query was selected, switch back to current and clear results
        if (selectedValue === queryId) {
          setSelectedValue("current");
          onQuerySelect("current");

          // Clear results when deleting the currently viewed query
          if (onClearAll) {
            console.log(
              "🧹 [QueryManager] Clearing results after deleting current query"
            );
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
    console.log(
      "🧹 [QueryManager] Clearing results - resetting query selection"
    );

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
    const currentInfo = getCurrentQueryInfo();

    if (!currentInfo.userQuery || !currentInfo.intentParserResult) {
      console.warn("No current query to save");
      return;
    }

    const queryName =
      saveQueryName.trim() || generateDefaultName(currentInfo.userQuery);

    // Use unified system to find and save the current query
    const { storeQuery } = await import("../utils/queryStorage");

    // Check if there's a temporary composed query that matches
    const tempComposedQuery = (window as any).__currentComposedQuery;

    let queryToSave;

    if (tempComposedQuery && tempComposedQuery.userQuery === currentUserQuery) {
      // Use the temporary composed query structure
      const { id, timestamp, ...queryWithoutMeta } = tempComposedQuery;
      queryToSave = queryWithoutMeta;
      console.log("💾 [QueryManager] Saving temporary composed query with unified system");
    } else {
      // Check if current query is in storage
      const allQueries = [...queries.recent, ...queries.saved];
      const currentStoredQuery = allQueries.find(
        (q) => q.userQuery === currentUserQuery && q.isComposed
      ) || allQueries.find(
        (q) => q.userQuery === currentInfo.userQuery
      );

      if (currentStoredQuery?.isComposed) {
        // Save existing composed query structure
        const { id, timestamp, ...queryWithoutMeta } = currentStoredQuery;
        queryToSave = queryWithoutMeta;
        console.log("💾 [QueryManager] Saving existing composed query with unified system");
      } else {
        // Create simple query structure
        queryToSave = {
          userQuery: currentInfo.userQuery,
          formalQuery: currentInfo.formalQuery || currentInfo.userQuery,
          intentParserResult: currentInfo.intentParserResult,
          isComposed: false,
          querySteps: [],
          pageSelections: []
        };
        console.log("💾 [QueryManager] Saving simple query with unified system");
      }
    }

    // Save using unified system
    storeQuery(queryToSave, { type: 'saved', customName: queryName });

    setQueries(getStoredQueries());
    setShowSaveDialog(false);
    setSaveQueryName("");
  }, [queries, currentUserQuery, saveQueryName]);

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
      console.log("✅ [QueryManager] All stored queries cleared");
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

    // Must have a valid query
    if (!currentInfo.userQuery || !currentInfo.intentParserResult) {
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
  }, [loadedQuery]);

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
            icon="clean"
            text="Clear all stored queries"
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
  };
};
