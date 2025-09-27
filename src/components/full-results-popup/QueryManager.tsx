import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Button,
  Dialog,
  Classes,
  InputGroup,
  MenuItem,
  Collapse,
  Popover,
  Position,
  Menu,
} from "@blueprintjs/core";
import { Select, ItemRenderer } from "@blueprintjs/select";
import {
  StoredQuery,
  getStoredQueries,
  saveQuery,
  renameSavedQuery,
  deleteSavedQuery,
  getCurrentQueryInfo,
} from "../../ai/agents/search-agent/helpers/queryStorage";
import QueryComposer from "./QueryComposer";
import DirectContentSelector from "./DirectContentSelector";
import { QueryRenderer, StoredQueryRenderer } from "./QueryRenderer";
import "./QueryRenderer.css";

// Types for the Select component
interface QuerySelectItem {
  id: string;
  type: "current" | "recent" | "saved";
  query?: StoredQuery;
  label: string;
  description?: string;
  group: string;
}

const QuerySelect = Select.ofType<QuerySelectItem>();

interface QueryManagerProps {
  currentUserQuery?: string;
  currentFormalQuery?: string;
  onQuerySelect: (query: StoredQuery | "current") => void;
  disabled?: boolean;
  executionProgress?: string;
  onQueriesUpdate?: () => void; // Callback to notify when queries are updated
  onClearAll?: () => void; // Callback to clear results and query context for fresh start

  // Two-section composition UI
  originalQueryForComposition?: {
    userQuery: string;
    formalQuery: string;
  };
  loadedQuery?: StoredQuery;

  // Query Composer props
  composerQuery: string;
  isComposingQuery: boolean;
  onQueryChange: (query: string) => void;
  onExecuteQuery: (mode: "add" | "replace", model?: string) => Promise<void>;

  // Direct Content Selector props
  selectedPages: string[];
  includePageContent: boolean;
  includeLinkedRefs: boolean;
  dnpPeriod: number;
  isAddingDirectContent: boolean;
  availablePages: string[];
  isLoadingPages: boolean;
  currentPageContext: { uid: string | null; title: string | null };

  // Direct Content Selector handlers
  setSelectedPages: (pages: string[]) => void;
  setIncludePageContent: (include: boolean) => void;
  setIncludeLinkedRefs: (include: boolean) => void;
  setDNPPeriod: (period: number) => void;
  handleDirectContentAdd: (
    currentResults: any[],
    setCurrentResults: (results: any[]) => void
  ) => void;
  queryAvailablePages: (query?: string) => void;

  // Results management for DirectContentSelector
  currentResults: any[];
  setCurrentResults: (results: any[]) => void;
}

export const QueryManager: React.FC<QueryManagerProps> = ({
  currentUserQuery,
  currentFormalQuery,
  onQuerySelect,
  disabled = false,
  executionProgress,
  onQueriesUpdate,
  onClearAll,

  // Two-section composition UI
  originalQueryForComposition,
  loadedQuery,

  // Query Composer props
  composerQuery,
  isComposingQuery,
  onQueryChange,
  onExecuteQuery,

  // Direct Content Selector props
  selectedPages,
  includePageContent,
  includeLinkedRefs,
  dnpPeriod,
  isAddingDirectContent,
  availablePages,
  isLoadingPages,
  currentPageContext,

  // Direct Content Selector handlers
  setSelectedPages,
  setIncludePageContent,
  setIncludeLinkedRefs,
  setDNPPeriod,
  handleDirectContentAdd,
  queryAvailablePages,

  // Results management
  currentResults,
  setCurrentResults,
}) => {
  const [queries, setQueries] = useState(getStoredQueries());

  // Helper function to get initial selected value
  const getInitialSelectedValue = () => {
    if (currentUserQuery) return "current";
    const allQueries = getStoredQueries();
    if (allQueries.recent.length > 0) return allQueries.recent[0].id;
    if (allQueries.saved.length > 0) return allQueries.saved[0].id;
    return "";
  };

  // State declarations
  const [selectedValue, setSelectedValue] = useState<string>(
    getInitialSelectedValue()
  );
  const [isExpanded, setIsExpanded] = useState(!currentUserQuery); // Auto-expand when no current query
  const [isLoading, setIsLoading] = useState(false);

  // Function to refresh queries from storage
  const refreshQueries = useCallback(() => {
    const storedQueries = getStoredQueries();
    setQueries(storedQueries);

    // Log composed queries for debugging
    const composedQueries = [...storedQueries.recent, ...storedQueries.saved].filter(q => q.isComposed);
    if (composedQueries.length > 0) {
      console.log("🔗 [QueryManager] Composed queries in storage:", composedQueries.map(q => ({
        id: q.id,
        userQuery: q.userQuery,
        isComposed: q.isComposed,
        querySteps: q.querySteps?.length || 0,
        queryStepsDetails: q.querySteps?.map(step => step.userQuery) || [],
        pageSelections: q.pageSelections?.length || 0,
        pageSelectionsDetails: q.pageSelections?.map(page => page.title) || []
      })));
    } else {
      console.log("📋 [QueryManager] No composed queries found in storage");
    }

    // Log all queries for debugging
    console.log("📋 [QueryManager] All queries in storage:", {
      recent: storedQueries.recent.map(q => ({ id: q.id, userQuery: q.userQuery, isComposed: q.isComposed })),
      saved: storedQueries.saved.map(q => ({ id: q.id, userQuery: q.userQuery, isComposed: q.isComposed }))
    });

    // If we have a current query but selectedValue is not "current", switch to current
    // This handles the case after composition where we want to show the composed query
    if (currentUserQuery && selectedValue !== "current") {
      setSelectedValue("current");
    }
  }, [currentUserQuery, selectedValue]);

  // Expose refresh function to parent component
  useEffect(() => {
    if (onQueriesUpdate) {
      (window as any).__queryManagerRefresh = refreshQueries;
    }
  }, [refreshQueries, onQueriesUpdate]);

  // Query Tools section state

  // Track loaded query for UI feedback
  const [uiLoadedQuery, setUILoadedQuery] = useState<StoredQuery | null>(null);

  // Dialogs
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);
  const [renameQueryId, setRenameQueryId] = useState<string>("");
  const [saveQueryName, setSaveQueryName] = useState("");
  const [renameValue, setRenameValue] = useState("");

  // Refresh queries when component mounts or updates
  useEffect(() => {
    setQueries(getStoredQueries());
  }, []);

  // Watch for changes in currentUserQuery and switch to "current" when it updates
  // This ensures that after composition, we show the composed query as "current"
  // Also handle clearing by resetting selectedValue when query is cleared
  useEffect(() => {
    // Only switch to "current" if:
    // 1. We have a current query
    // 2. We're not already on "current"
    // 3. We're not actively viewing a stored query (selectedValue should stay as the query ID)
    const isViewingStoredQuery = selectedValue !== "current" && selectedValue !== "";
    const allQueryIds = [...queries.recent, ...queries.saved].map(q => q.id);
    const isValidStoredQuerySelected = isViewingStoredQuery && allQueryIds.includes(selectedValue);

    if (currentUserQuery && selectedValue !== "current" && !isValidStoredQuerySelected) {
      // Only switch to current if we're not viewing a valid stored query
      console.log("🔄 [QueryManager] useEffect switching to current from:", selectedValue);
      setSelectedValue("current");
    } else if (!currentUserQuery && selectedValue === "current") {
      // When currentUserQuery is cleared, reset to empty selection
      console.log("🔄 [QueryManager] useEffect clearing selection");
      setSelectedValue("");
    }
  }, [currentUserQuery, selectedValue, queries.recent, queries.saved]);

  // Format timestamp helper function
  const formatTimestamp = (timestamp: Date): string => {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return "Today";
    } else if (days === 1) {
      return "Yesterday";
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      return timestamp.toLocaleDateString();
    }
  };

  // Convert queries to select items
  const createSelectItems = (): QuerySelectItem[] => {
    const items: QuerySelectItem[] = [];

    // Add current query if available
    if (currentUserQuery) {
      items.push({
        id: "current",
        type: "current",
        label: "🔍 Last Query",
        description:
          currentUserQuery.length > 70
            ? currentUserQuery.substring(0, 67) + "..."
            : currentUserQuery,
        group: "", // No group - standalone item
      });
    }

    // Add recent queries
    queries.recent.forEach((query) => {
      const truncatedQuery =
        query.userQuery.length > 70
          ? query.userQuery.substring(0, 67) + "..."
          : query.userQuery;

      items.push({
        id: query.id,
        type: "recent",
        query: query,
        label: truncatedQuery,
        description: formatTimestamp(query.timestamp), // Timestamp as description/label
        group: "📅 Recent Queries",
      });
    });

    // Add saved queries
    queries.saved.forEach((query) => {
      const displayLabel = query.name || query.userQuery;
      const truncatedLabel =
        displayLabel.length > 70
          ? displayLabel.substring(0, 67) + "..."
          : displayLabel;

      items.push({
        id: query.id,
        type: "saved",
        query: query,
        label: truncatedLabel,
        description: query.name
          ? query.userQuery.length > 70
            ? query.userQuery.substring(0, 67) + "..."
            : query.userQuery
          : undefined,
        group: "⭐ Saved Queries",
      });
    });

    return items;
  };

  // Group items by their group property with smart filtering support
  const groupedItems = (
    items: QuerySelectItem[],
    filterQuery: string = ""
  ): QuerySelectItem[] => {
    // First, filter items if there's a filter query
    const filteredItems = filterQuery.trim()
      ? items.filter((item) => {
          const lowerQuery = filterQuery.toLowerCase();
          return (
            item.label.toLowerCase().includes(lowerQuery) ||
            (item.description &&
              item.description.toLowerCase().includes(lowerQuery))
          );
        })
      : items;

    // Group the filtered items
    const groups: { [key: string]: QuerySelectItem[] } = {};

    filteredItems.forEach((item) => {
      if (!groups[item.group]) {
        groups[item.group] = [];
      }
      groups[item.group].push(item);
    });

    const result: QuerySelectItem[] = [];

    // Add items with group headers (only if group has items)
    Object.entries(groups).forEach(([groupName, groupItems], groupIndex) => {
      // Only add group header if there are items in this group
      if (groupItems.length > 0) {
        // Add a virtual group header item (if there are multiple groups with items AND the group has a name)
        if (Object.keys(groups).length > 1 && groupName.trim() !== "") {
          result.push({
            id: `__group_${groupIndex}`,
            type: "current", // dummy type
            label: groupName,
            group: groupName,
            description: `${groupItems.length} item${
              groupItems.length !== 1 ? "s" : ""
            }`,
          } as QuerySelectItem);
        }

        // Add the actual items
        result.push(...groupItems);
      }
    });

    return result;
  };

  // Render individual select items with group support
  const renderQueryItem: ItemRenderer<QuerySelectItem> = (
    item,
    { handleClick, modifiers, index }
  ) => {
    if (!modifiers.matchesPredicate) {
      return null;
    }

    // Check if this is a group header
    const isGroupHeader = item.id.startsWith("__group_");

    if (isGroupHeader) {
      return (
        <MenuItem
          key={item.id}
          text={
            <div
              style={{
                fontWeight: "bold",
                fontSize: "0.9em",
                color: "#5C7080",
                paddingTop: index === 0 ? "0" : "6px",
                paddingBottom: "4px",
                borderBottom: "1px solid #E1E8ED",
                marginBottom: "4px",
              }}
            >
              {item.label}
              <span
                style={{
                  fontWeight: "normal",
                  marginLeft: "8px",
                  fontSize: "0.85em",
                }}
              >
                {item.description}
              </span>
            </div>
          }
          disabled={true}
          shouldDismissPopover={false}
        />
      );
    }

    return (
      <MenuItem
        key={item.id}
        text={
          item.type === "recent" ? (
            // Recent queries: timestamp on the same line as query
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
              }}
            >
              <div
                style={{
                  fontWeight: "normal",
                  fontSize: "0.9em",
                  color: "#5C7080",
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </div>
              {item.description && (
                <div
                  style={{
                    fontSize: "0.8em",
                    color: "#8A9BA8",
                    marginLeft: "12px",
                    fontWeight: "normal",
                    flexShrink: 0,
                  }}
                >
                  {item.description}
                </div>
              )}
            </div>
          ) : // Saved queries: show timestamp on same line, description below
          item.type === "saved" ? (
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    fontWeight: "bold",
                    fontSize: "1em",
                    color: "#182026",
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.label}
                </div>
                {item.query && (
                  <div
                    style={{
                      fontSize: "0.8em",
                      color: "#8A9BA8",
                      marginLeft: "12px",
                      fontWeight: "normal",
                      flexShrink: 0,
                    }}
                  >
                    {formatTimestamp(item.query.timestamp)}
                  </div>
                )}
              </div>
              {item.description && (
                <div
                  style={{
                    fontSize: "0.85em",
                    color: "#666",
                    marginTop: "2px",
                  }}
                >
                  {item.description}
                </div>
              )}
            </div>
          ) : (
            // Other queries (current): description below label (original layout)
            <div>
              <div
                style={{
                  fontWeight: "bold",
                  fontSize: "1em",
                  color: "#182026",
                }}
              >
                {item.label}
              </div>
              {item.description && (
                <div
                  style={{
                    fontSize: "0.85em",
                    color: "#666",
                    marginTop: "2px",
                  }}
                >
                  {item.description}
                </div>
              )}
            </div>
          )
        }
        onClick={handleClick}
        active={modifiers.active}
        disabled={modifiers.disabled}
      />
    );
  };

  // Filter predicate for search with smart grouping
  const filterPredicate = (query: string, item: QuerySelectItem): boolean => {
    // If it's a group header, check if any item in its group matches the filter
    if (item.id.startsWith("__group_")) {
      // For group headers, we need to check if any items in this group would match
      const baseItems = createSelectItems();
      const itemsInThisGroup = baseItems.filter(
        (baseItem) => baseItem.group === item.group
      );

      if (!query.trim()) return true; // Show all group headers when no filter

      const lowerQuery = query.toLowerCase();
      return itemsInThisGroup.some(
        (baseItem) =>
          baseItem.label.toLowerCase().includes(lowerQuery) ||
          (baseItem.description &&
            baseItem.description.toLowerCase().includes(lowerQuery))
      );
    }

    // For regular items, normal filtering
    const lowerQuery = query.toLowerCase();
    return (
      item.label.toLowerCase().includes(lowerQuery) ||
      (item.description && item.description.toLowerCase().includes(lowerQuery))
    );
  };

  // Get all select items with grouping (now using basic grouping, filtering handled by predicate)
  const baseSelectItems = createSelectItems();
  const groupedSelectItems = groupedItems(baseSelectItems);

  // Find currently selected item (search in base items, not grouped items with headers)
  const currentSelectedItem = baseSelectItems.find(
    (item) => item.id === selectedValue
  );

  const handleSelectionChange = (item: QuerySelectItem) => {
    if (disabled || isLoading) return;

    // Don't allow selection of group headers
    if (item.id.startsWith("__group_")) {
      return;
    }

    console.log("🔄 [QueryManager] Setting selectedValue to:", item.id);
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
        fullQuery: item.query // Log the full object to inspect its structure
      });

      if (item.query.isComposed) {
        console.log("🔗 [QueryManager] >>> COMPOSED query details:", {
          querySteps: item.query.querySteps?.map(step => step.userQuery) || [],
          pageSelections: item.query.pageSelections?.map(page => page.title) || []
        });
      } else {
        console.log("📝 [QueryManager] >>> SIMPLE query");
      }

      // Only trigger composition logic if there's already a current query
      // Otherwise, just load the query into the interface without executing
      if (currentUserQuery) {
        console.log("🔄 [QueryManager] Current query exists - triggering composition logic");
        onQuerySelect(item.query);
      } else {
        console.log("📋 [QueryManager] No current query - just loading into interface");
        // Don't call onQuerySelect to avoid automatic execution
      }
    }

    // Auto-load query into composer when selected (except for "current")
    if (item.id !== "current" && item.query) {
      // Load the query text into the composer
      onQueryChange(item.query.userQuery);

      // Store the loaded query for UI feedback
      setUILoadedQuery(item.query);

      // Expand the section so user can see the execution buttons
      setIsExpanded(true);

      // If no current query, show helpful message
      if (!currentUserQuery) {
        console.log("💡 [QueryManager] Query loaded into composer - user can choose to execute, modify, or load another");
      }
    }
  };

  const handleDeleteQuery = (queryId: string) => {
    console.log("🗑️ [QueryManager] Attempting to delete query:", queryId);

    // Try to delete from saved queries first
    let deleted = deleteSavedQuery(queryId);

    if (!deleted) {
      // If not found in saved queries, delete from recent queries
      const currentQueries = getStoredQueries();
      const recentIndex = currentQueries.recent.findIndex(q => q.id === queryId);

      if (recentIndex !== -1) {
        currentQueries.recent.splice(recentIndex, 1);
        // Save the updated queries
        const { saveQueries } = require("../../ai/agents/search-agent/helpers/queryStorage");
        try {
          localStorage.setItem('askYourGraphQueries', JSON.stringify(currentQueries));
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
          console.log("🧹 [QueryManager] Clearing results after deleting current query");
          onClearAll();
        } else {
          setCurrentResults([]);
        }
      }
    } else {
      console.warn("🗑️ [QueryManager] Query not found for deletion:", queryId);
    }
  };

  const handleClearResults = () => {
    console.log("🧹 [QueryManager] Clearing results - resetting query selection");

    if (onClearAll) {
      // Use parent's clear all function for complete reset
      onClearAll();
    } else {
      // Fallback to just clearing results
      setCurrentResults([]);
    }

    // Reset query selection to avoid showing stale query information
    setSelectedValue("");

    // Clear any loaded query state to remove query descriptions
    setUILoadedQuery(null);

    // Clear the composer query text
    onQueryChange("");
  };

  const handleSaveQuery = () => {
    const currentInfo = getCurrentQueryInfo();

    if (!currentInfo.userQuery || !currentInfo.intentParserResult) {
      console.warn("No current query to save");
      return;
    }

    const queryName =
      saveQueryName.trim() || generateDefaultName(currentInfo.userQuery);

    // Check if current query is a composed query in storage or recent queries
    const allQueries = [...queries.recent, ...queries.saved];

    // First, try to find by currentUserQuery (the displayed query)
    let currentStoredQuery = allQueries.find(q => q.userQuery === currentUserQuery);

    // If not found by currentUserQuery, try currentInfo.userQuery
    if (!currentStoredQuery && currentInfo.userQuery !== currentUserQuery) {
      currentStoredQuery = allQueries.find(q => q.userQuery === currentInfo.userQuery);
    }

    // Look specifically for composed queries that match the current query
    if (!currentStoredQuery && currentUserQuery) {
      currentStoredQuery = allQueries.find(q => q.isComposed && q.userQuery === currentUserQuery);
    }

    // Look for recently added composed queries (which might have gotten a new ID)
    if (!currentStoredQuery && currentUserQuery) {
      // Check recent queries for composed ones with matching base query
      currentStoredQuery = queries.recent.find(q =>
        q.isComposed &&
        q.userQuery === currentUserQuery &&
        q.querySteps &&
        q.querySteps.length > 0
      );
    }

    // As last resort, check temporary composed query in window globals
    if (!currentStoredQuery) {
      const tempComposedQuery = (window as any).__currentComposedQuery;
      if (tempComposedQuery && tempComposedQuery.userQuery === currentUserQuery) {
        currentStoredQuery = tempComposedQuery;
        console.log("💾 [QueryManager] Using temporary composed query from memory");
      }
    }

    console.log("💾 [QueryManager] Saving query debug:", {
      currentInfoUserQuery: currentInfo.userQuery,
      currentUserQueryProp: currentUserQuery,
      foundStoredQuery: !!currentStoredQuery,
      storedQueryId: currentStoredQuery?.id,
      isComposed: currentStoredQuery?.isComposed,
      hasQuerySteps: !!currentStoredQuery?.querySteps,
      queryStepsCount: currentStoredQuery?.querySteps?.length || 0,
      queryStepsDetails: currentStoredQuery?.querySteps?.map(step => step.userQuery) || [],
      tempComposedInWindow: !!(window as any).__currentComposedQuery,
      allQueriesUserQueries: allQueries.map(q => ({ id: q.id, userQuery: q.userQuery, isComposed: q.isComposed }))
    });

    if (currentStoredQuery?.isComposed) {
      // Save as composed query with full structure using the original base query
      const { saveComposedQuery } = require("../../ai/agents/search-agent/helpers/queryStorage");

      console.log("💾 [QueryManager] Saving as composed query with:", {
        baseUserQuery: currentStoredQuery.userQuery,
        baseFormalQuery: currentStoredQuery.formalQuery,
        querySteps: currentStoredQuery.querySteps,
        pageSelections: currentStoredQuery.pageSelections,
        isFromTempQuery: currentStoredQuery.id?.startsWith('temp_'),
        fullStructure: currentStoredQuery
      });

      saveComposedQuery(
        {
          userQuery: currentStoredQuery.userQuery, // Use the original base query, not currentInfo
          formalQuery: currentStoredQuery.formalQuery || currentStoredQuery.userQuery,
          intentParserResult: currentStoredQuery.intentParserResult || currentInfo.intentParserResult,
        },
        currentStoredQuery.querySteps || [],
        currentStoredQuery.pageSelections || [],
        queryName
      );
    } else {
      // Save as simple query
      console.log("💾 [QueryManager] Saving as simple query");
      saveQuery(
        {
          userQuery: currentInfo.userQuery,
          formalQuery: currentInfo.formalQuery || currentInfo.userQuery,
          intentParserResult: currentInfo.intentParserResult,
        },
        queryName
      );
    }

    setQueries(getStoredQueries());
    setShowSaveDialog(false);
    setSaveQueryName("");
  };

  const handleRenameQuery = () => {
    if (renameQueryId && renameValue.trim()) {
      renameSavedQuery(renameQueryId, renameValue.trim());
      setQueries(getStoredQueries());
    }
    setShowRenameDialog(false);
    setRenameQueryId("");
    setRenameValue("");
  };

  const handleClearAllQueries = () => {
    console.log("🗑️ [QueryManager] Clearing all stored queries");

    // Clear all queries from localStorage
    try {
      localStorage.removeItem('askYourGraphQueries');
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
  };

  const generateDefaultName = (userQuery: string): string => {
    const cleaned = userQuery.trim().replace(/\s+/g, " ");
    return cleaned.length <= 80 ? cleaned : cleaned.substring(0, 77) + "...";
  };

  const canSaveCurrent = () => {
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
  };

  // Memoize the actions menu content to prevent excessive re-renders
  const actionsMenuContent = useMemo(() => {
    const hasResults = currentResults && currentResults.length > 0;
    const hasStoredQuery =
      selectedValue !== "current" &&
      [...queries.recent, ...queries.saved].some((q) => q.id === selectedValue);

    // Debug the delete option logic when there are saved queries
    if (queries.saved.length > 0 || queries.recent.length > 0) {
      console.log("🔍 [QueryManager] Delete option debug:", {
        selectedValue,
        isNotCurrent: selectedValue !== "current",
        allQueryIds: [...queries.recent, ...queries.saved].map(q => q.id),
        hasStoredQuery,
        recentCount: queries.recent.length,
        savedCount: queries.saved.length
      });
    }

    return (
      <Menu>
        {/* Clear results option - show if there are results */}
        {hasResults && (
          <MenuItem
            icon="clean"
            text="Clear results"
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
            // intent="danger"
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
    currentResults.length,
    selectedValue,
    queries.recent.length,
    queries.saved.length,
    handleClearResults,
    handleDeleteQuery
  ]);

  return (
    <div className="query-manager-expandable">
      {/* Compact header - always visible */}
      <div
        className="query-manager-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="query-manager-current-query">
          <span className="query-manager-current-text">
            {selectedValue === "current"
              ? currentUserQuery
                ? `Last query: ${
                    currentUserQuery.length > 80
                      ? currentUserQuery.substring(0, 77) + "..."
                      : currentUserQuery
                  }`
                : "Last query:"
              : selectedValue === "" || !selectedValue
              ? "No query selected - click to load saved queries"
              : (() => {
                  const allQueries = [...queries.recent, ...queries.saved];
                  const selectedQuery = allQueries.find(
                    (q) => q.id === selectedValue
                  );
                  const queryName =
                    selectedQuery?.name ||
                    selectedQuery?.userQuery ||
                    "Unknown query";
                  const displayName =
                    queryName.length > 80
                      ? queryName.substring(0, 77) + "..."
                      : queryName;
                  return `Loaded query: ${displayName}`;
                })()}
          </span>
        </div>
        <div className="query-manager-header-actions">
          {/* Load stored queries button */}
          <QuerySelect
            items={groupedSelectItems}
            itemRenderer={renderQueryItem}
            itemPredicate={filterPredicate}
            onItemSelect={handleSelectionChange}
            activeItem={currentSelectedItem}
            disabled={disabled || isLoading || baseSelectItems.length === 0}
            filterable={true}
            resetOnClose={false}
            resetOnSelect={false}
            inputProps={{
              placeholder: "Search queries...",
            }}
            popoverProps={{
              minimal: true,
              position: Position.BOTTOM_RIGHT,
              onInteraction: (
                _nextOpenState: boolean,
                e?: React.SyntheticEvent<HTMLElement>
              ) => {
                if (e) {
                  e.stopPropagation();
                }
              },
            }}
          >
            <Button
              icon="upload"
              minimal
              small
              disabled={disabled || baseSelectItems.length === 0}
              title="Load stored query"
            />
          </QuerySelect>

          {/* Save current query button */}
          <Button
            icon="floppy-disk"
            minimal
            small
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              setShowSaveDialog(true);
            }}
            disabled={!canSaveCurrent() || disabled}
            title={
              loadedQuery
                ? "Save modified query (disabled for unchanged loaded queries)"
                : "Save current query"
            }
          />

          {/* Rename button for saved queries */}
          {selectedValue !== "current" &&
            queries.saved.some((q) => q.id === selectedValue) && (
              <Button
                icon="edit"
                minimal
                small
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  const query = queries.saved.find(
                    (q) => q.id === selectedValue
                  );
                  if (query) {
                    setRenameQueryId(selectedValue);
                    setRenameValue(query.name || query.userQuery);
                    setShowRenameDialog(true);
                  }
                }}
                disabled={disabled}
                title="Rename query"
              />
            )}

          {/* Actions menu button */}
          {(currentResults && currentResults.length > 0) ||
          (selectedValue !== "current" &&
            queries.saved.some((q) => q.id === selectedValue)) ? (
            <div
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
              style={{ display: "inline-block" }}
            >
              <Popover
                content={actionsMenuContent}
                position={Position.BOTTOM_RIGHT}
                minimal
              >
                <Button
                  icon="trash"
                  minimal
                  small
                  disabled={disabled}
                  title="Actions menu"
                  intent="danger"
                />
              </Popover>
            </div>
          ) : null}

          {/* Expand/collapse caret */}
          <Button
            icon={isExpanded ? "chevron-up" : "chevron-down"}
            minimal
            small
            disabled={disabled}
          />
        </div>
      </div>

      {/* Expanded content */}
      <Collapse isOpen={isExpanded}>
        <div className="query-manager-expanded">
          {/* Query Information */}
          <div className="query-manager-query-details">
            {(() => {
              // Check if we're in composition mode (have both original and loaded query)
              const isCompositionMode =
                originalQueryForComposition && loadedQuery;

              if (isCompositionMode) {
                // Two-section UI: Active Query + Loaded Query
                return (
                  <div className="composition-mode">
                    {/* Active Query Section */}
                    <div className="active-query-section">
                      <h4 className="section-header">
                        🔵 Active Query
                        <small> (base for composition)</small>
                      </h4>
                      <div className="query-manager-query-content user-query">
                        <QueryRenderer
                          query={originalQueryForComposition.userQuery}
                          formalQuery={originalQueryForComposition.formalQuery}
                          showLabel={false}
                        />
                      </div>
                    </div>

                    {/* Loaded Query Section */}
                    <div className="loaded-query-section">
                      <h4 className="section-header">
                        📋 Loaded Query
                        <small> ({loadedQuery.isComposed ? `composed - ${(loadedQuery.querySteps?.length || 0) + 1} components` : 'simple'}) (ready to compose)</small>
                      </h4>
                      {loadedQuery.isComposed ? (
                        <div className="composed-series">
                          {(() => {
                            console.log("🔗 [QueryManager] Displaying composed loaded query in composition mode:", {
                              id: loadedQuery.id,
                              userQuery: loadedQuery.userQuery,
                              querySteps: loadedQuery.querySteps?.length || 0,
                              pageSelections: loadedQuery.pageSelections?.length || 0
                            });
                            return null;
                          })()}
                          {/* Initial Query */}
                          <div className="query-manager-query-content user-query">
                            <QueryRenderer
                              query={loadedQuery.userQuery}
                              formalQuery={loadedQuery.formalQuery}
                              label="Query 1"
                              showLabel={true}
                            />
                          </div>

                          {/* Additional Query Steps */}
                          {loadedQuery.querySteps?.map((step, index) => (
                            <div key={index} className="query-with-plus">
                              <div className="query-plus">+</div>
                              <div className="query-plus-content">
                                <div className="query-manager-query-content user-query">
                                  <QueryRenderer
                                    query={step.userQuery}
                                    formalQuery={step.formalQuery}
                                    label={`Query ${index + 2}`}
                                    showLabel={true}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}

                          {/* Page Selections if any */}
                          {loadedQuery.pageSelections?.map((page, index) => (
                            <div key={`page-${index}`} className="query-with-plus">
                              <div className="query-plus">+</div>
                              <div className="query-plus-content">
                                <div className="query-manager-query-content user-query">
                                  <QueryRenderer
                                    query={`Page: ${page.title}`}
                                    label={`Query ${(loadedQuery.querySteps?.length || 0) + index + 2}`}
                                    showLabel={true}
                                    metadata={{
                                      resultCount: undefined,
                                      dateRange: page.includeContent ? "with content" : "title only"
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="query-manager-query-content user-query">
                          <QueryRenderer
                            query={loadedQuery.userQuery}
                            formalQuery={loadedQuery.formalQuery}
                            showLabel={false}
                          />
                        </div>
                      )}
                      <div className="composition-actions">
                        <small className="composition-hint">
                          Use "Add to results" below to compose Active + Loaded queries
                        </small>
                      </div>
                    </div>
                  </div>
                );
              } else if (selectedValue === "current" && currentUserQuery) {
                // Regular current query display
                const allQueries = [...queries.recent, ...queries.saved];
                const currentStoredQuery = allQueries.find(
                  (q) => q.userQuery === currentUserQuery
                );

                if (currentStoredQuery && currentStoredQuery.isComposed) {
                  // Log composed query display for debugging
                  console.log("🔗 [QueryManager] Displaying composed current query:", {
                    id: currentStoredQuery.id,
                    userQuery: currentStoredQuery.userQuery,
                    querySteps: currentStoredQuery.querySteps?.length || 0,
                    pageSelections: currentStoredQuery.pageSelections?.length || 0
                  });

                  // Show composed query as series of QueryRenderer components with + symbols
                  return (
                    <div className="composed-query-display">
                      <h4 className="section-header">
                        🔗 Composed Query
                        <small>
                          {" "}
                          ({(currentStoredQuery.querySteps?.length || 0) +
                            1}{" "}
                          components)
                        </small>
                      </h4>
                      <div className="composed-series">
                        {/* Initial Query */}
                        <div className="query-manager-query-content user-query">
                          <QueryRenderer
                            query={currentStoredQuery.userQuery}
                            formalQuery={currentStoredQuery.formalQuery}
                            label="Query 1"
                            showLabel={true}
                          />
                        </div>

                        {/* Additional Query Steps */}
                        {currentStoredQuery.querySteps?.map((step, index) => (
                          <div key={index} className="query-with-plus">
                            <div className="query-plus">+</div>
                            <div className="query-plus-content">
                              <div className="query-manager-query-content user-query">
                                <QueryRenderer
                                  query={step.userQuery}
                                  formalQuery={step.formalQuery}
                                  label={`Query ${index + 2}`}
                                  showLabel={true}
                                />
                              </div>
                            </div>
                          </div>
                        ))}

                        {/* Page Selections if any */}
                        {currentStoredQuery.pageSelections?.map(
                          (page, index) => (
                            <div
                              key={`page-${index}`}
                              className="query-with-plus"
                            >
                              <div className="query-plus">+</div>
                              <div className="query-plus-content">
                                <div className="query-manager-query-content user-query">
                                  <QueryRenderer
                                    query={`Page: ${page.title}`}
                                    label={`Query ${
                                      (currentStoredQuery.querySteps?.length ||
                                        0) +
                                      index +
                                      2
                                    }`}
                                    showLabel={true}
                                    metadata={{
                                      resultCount: undefined,
                                      dateRange: page.includeContent
                                        ? "with content"
                                        : "title only",
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  );
                } else {
                  // Show simple current query
                  return (
                    <div className="simple-query-display">
                      <div className="query-manager-query-content user-query">
                        <QueryRenderer
                          query={currentUserQuery}
                          formalQuery={currentFormalQuery}
                          showLabel={false}
                        />
                      </div>
                    </div>
                  );
                }
              } else if (selectedValue && selectedValue !== "current") {
                // Show details of selected stored query using select items
                const selectedItem = baseSelectItems.find(
                  (item) => item.id === selectedValue
                );
                if (selectedItem && selectedItem.query) {
                  const selectedQuery = selectedItem.query;
                  return (
                    <div className="stored-query-details">
                      {selectedQuery.isComposed ? (
                        <div className="composed-query-display">
                          {(() => {
                            console.log("🔗 [QueryManager] Displaying composed stored query:", {
                              id: selectedQuery.id,
                              userQuery: selectedQuery.userQuery,
                              querySteps: selectedQuery.querySteps?.length || 0,
                              pageSelections: selectedQuery.pageSelections?.length || 0
                            });
                            return null;
                          })()}
                          <h4 className="section-header">
                            🔗 Composed Query
                            <small>
                              {" "}
                              ({(selectedQuery.querySteps?.length || 0) +
                                1}{" "}
                              components)
                            </small>
                          </h4>
                          <div className="composed-series">
                            {/* Initial Query */}
                            <div className="query-manager-query-content user-query">
                              <QueryRenderer
                                query={selectedQuery.userQuery}
                                formalQuery={selectedQuery.formalQuery}
                                label="Query 1"
                                showLabel={true}
                              />
                            </div>

                            {/* Additional Query Steps */}
                            {selectedQuery.querySteps?.map((step, index) => (
                              <div key={index} className="query-with-plus">
                                <div className="query-plus">+</div>
                                <div className="query-plus-content">
                                  <div className="query-manager-query-content user-query">
                                    <QueryRenderer
                                      query={step.userQuery}
                                      formalQuery={step.formalQuery}
                                      label={`Query ${index + 2}`}
                                      showLabel={true}
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}

                            {/* Page Selections if any */}
                            {selectedQuery.pageSelections?.map(
                              (page, index) => (
                                <div
                                  key={`page-${index}`}
                                  className="query-with-plus"
                                >
                                  <div className="query-plus">+</div>
                                  <div className="query-plus-content">
                                    <div className="query-manager-query-content user-query">
                                      <QueryRenderer
                                        query={`Page: ${page.title}`}
                                        label={`Query ${
                                          (selectedQuery.querySteps?.length ||
                                            0) +
                                          index +
                                          2
                                        }`}
                                        showLabel={true}
                                        metadata={{
                                          resultCount: undefined,
                                          dateRange: page.includeContent
                                            ? "with content"
                                            : "title only",
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="simple-query-display">
                          <div className="query-manager-query-content user-query">
                            <QueryRenderer
                              query={selectedQuery.userQuery}
                              formalQuery={selectedQuery.formalQuery}
                              showLabel={false}
                            />
                          </div>
                        </div>
                      )}

                      <div className="stored-query-metadata">
                        <small>
                          <strong>Created:</strong>{" "}
                          {formatTimestamp(selectedQuery.timestamp)}
                          {selectedQuery.name && (
                            <span>
                              {" "}
                              • <strong>Name:</strong> {selectedQuery.name}
                            </span>
                          )}
                        </small>
                      </div>
                    </div>
                  );
                }
              }

              // Default message when no query available
              return (
                <div className="no-current-query-message">
                  <p>
                    📝 No last query available. Use the load button in the
                    header to select a stored query, or compose a new one below.
                  </p>
                </div>
              );
            })()}
          </div>

          {/* Execution Progress */}
          {executionProgress && (
            <div className="query-manager-execution-progress">
              {executionProgress}
            </div>
          )}

          {/* Query Composer Section */}
          <div className="query-composer-section">
            <QueryComposer
              composerQuery={composerQuery}
              isComposingQuery={isComposingQuery}
              onQueryChange={(newQuery) => {
                onQueryChange(newQuery);
                // Clear loaded query if user modifies the text
                if (loadedQuery && newQuery !== loadedQuery.userQuery) {
                  setUILoadedQuery(null);
                }
              }}
              onExecuteQuery={(mode, model) => {
                // Always go through IntentParser for proper dynamic interpretation
                return onExecuteQuery(mode, model);
              }}
              hasActiveQuery={!!(currentUserQuery && currentUserQuery.trim())}
            />
          </div>

          {/* Direct Content Selector Section */}
          <div className="direct-content-section">
            <DirectContentSelector
              selectedPages={selectedPages}
              includePageContent={includePageContent}
              includeLinkedRefs={includeLinkedRefs}
              dnpPeriod={dnpPeriod}
              isAddingDirectContent={isAddingDirectContent}
              availablePages={availablePages}
              isLoadingPages={isLoadingPages}
              currentPageContext={currentPageContext}
              onPageSelectionChange={setSelectedPages}
              onContentTypeChange={(type, checked) => {
                if (type === "content") {
                  setIncludePageContent(checked);
                } else if (type === "linkedRefs") {
                  setIncludeLinkedRefs(checked);
                }
              }}
              onDNPPeriodChange={setDNPPeriod}
              onAddContent={() =>
                handleDirectContentAdd(currentResults, setCurrentResults)
              }
              onQueryPages={queryAvailablePages}
            />
          </div>
        </div>
      </Collapse>

      {/* Save Query Dialog */}
      <Dialog
        isOpen={showSaveDialog}
        onClose={() => setShowSaveDialog(false)}
        title="Save Query"
        className="save-query-dialog"
      >
        <div className={Classes.DIALOG_BODY}>
          <p>Save the current query for later use:</p>
          <div className="current-query-preview">
            <strong>Query:</strong>{" "}
            <QueryRenderer query={currentUserQuery || ""} />
          </div>
          {currentFormalQuery && currentFormalQuery !== currentUserQuery && (
            <div className="current-formal-query-preview">
              <strong>Formal Query:</strong>{" "}
              <QueryRenderer query={currentFormalQuery} />
            </div>
          )}
          <InputGroup
            placeholder="Enter a name for this query (optional)"
            value={saveQueryName}
            onChange={(e) => setSaveQueryName(e.target.value)}
            autoFocus
          />
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={() => setShowSaveDialog(false)}>Cancel</Button>
            <Button intent="primary" onClick={handleSaveQuery}>
              Save Query
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Rename Query Dialog */}
      <Dialog
        isOpen={showRenameDialog}
        onClose={() => setShowRenameDialog(false)}
        title="Rename Query"
        className="rename-query-dialog"
      >
        <div className={Classes.DIALOG_BODY}>
          <p>Enter a new name for this query:</p>
          <InputGroup
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            autoFocus
          />
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={() => setShowRenameDialog(false)}>Cancel</Button>
            <Button intent="primary" onClick={handleRenameQuery}>
              Rename
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Clear All Queries Dialog */}
      <Dialog
        isOpen={showClearAllDialog}
        onClose={() => setShowClearAllDialog(false)}
        title="Clear All Stored Queries"
        className="clear-all-queries-dialog"
      >
        <div className={Classes.DIALOG_BODY}>
          <p>⚠️ This will permanently delete all stored queries (both recent and saved).</p>
          <p>
            <strong>Current stored queries:</strong>
          </p>
          <ul>
            <li>Recent queries: {queries.recent.length}</li>
            <li>Saved queries: {queries.saved.length}</li>
          </ul>
          <p><strong>This action cannot be undone.</strong></p>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={() => setShowClearAllDialog(false)}>Cancel</Button>
            <Button intent="danger" onClick={handleClearAllQueries}>
              Clear All Queries
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
