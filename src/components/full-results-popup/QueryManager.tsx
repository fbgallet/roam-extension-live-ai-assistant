import React from "react";
import {
  Button,
  Dialog,
  Classes,
  InputGroup,
  MenuItem,
  Collapse,
  Popover,
  Position,
} from "@blueprintjs/core";
import { Select, ItemRenderer } from "@blueprintjs/select";
import { StoredQuery } from "./utils/queryStorage";
import { UnifiedQuery } from "./types/QueryTypes";
import QueryComposer from "./QueryComposer";
import DirectContentSelector from "./DirectContentSelector";
import {
  QueryRenderer,
  UnifiedQueryRenderer,
  StoredQueryRenderer,
} from "./QueryRenderer";
import "./QueryRenderer.css";
import { useQueryManager } from "./hooks/useQueryManager";

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
  currentQuery?: UnifiedQuery;
  onQuerySelect: (query: StoredQuery | "current") => void;
  onQueryLoadedIntoComposer?: (
    query: StoredQuery,
    forceResetOriginal?: boolean
  ) => void; // Callback when query is loaded into composer (not executed)
  disabled?: boolean;
  executionProgress?: string;
  queryProgress?: Record<string, { status: string; count?: number }>; // Per-query progress for composed queries
  onQueriesUpdate?: () => void; // Callback to notify when queries are updated
  onClearAll?: () => void; // Callback to clear results and query context for fresh start

  // Two-section composition UI
  originalQueryForComposition?: UnifiedQuery;
  loadedQuery?: StoredQuery;
  originalLoadedQuery?: StoredQuery | null; // Original query before edits, for detecting changes
  tempComposedQuery?: StoredQuery | null; // Temporary composed query from React state

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

  // External state management callback
  onOriginalQueryForCompositionChange?: (query: UnifiedQuery | null) => void;
}

export const QueryManager: React.FC<QueryManagerProps> = ({
  currentQuery,
  onQuerySelect,
  onQueryLoadedIntoComposer,
  disabled = false,
  executionProgress,
  queryProgress,
  onQueriesUpdate,
  onClearAll,

  // Two-section composition UI
  originalQueryForComposition,
  loadedQuery,
  originalLoadedQuery,
  tempComposedQuery,

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

  // External state management callback
  onOriginalQueryForCompositionChange,
}) => {
  console.log("🚀 [QueryManager] Component rendering - VERSION 2.0");

  // Composer UI state
  const [isComposerExpanded, setIsComposerExpanded] = React.useState(
    !currentQuery
  ); // Expanded when no query
  const [executingMode, setExecutingMode] = React.useState<
    "add" | "replace" | null
  >(null);
  const previousQueryRef = React.useRef(currentQuery);

  // Auto-expand/collapse based on query state
  React.useEffect(() => {
    const hadQuery = !!previousQueryRef.current;
    const hasQuery = !!currentQuery;

    // Auto-expand when going from "has query" to "no query"
    if (hadQuery && !hasQuery) {
      setIsComposerExpanded(true);
    }
    // Auto-collapse when a query is loaded
    else if (!hadQuery && hasQuery) {
      setIsComposerExpanded(false);
    }

    previousQueryRef.current = currentQuery;
  }, [currentQuery]);

  // Auto-collapse/expand based on loaded query and whether it's been run
  React.useEffect(() => {
    console.log(
      "📋 [QueryManager] loadedQuery changed:",
      loadedQuery ? loadedQuery.userQuery : "null"
    );
    console.log("📋 [QueryManager] currentQuery:", currentQuery?.userQuery);
    console.log("📋 [QueryManager] hasLoadedQuery will be:", !!loadedQuery);

    if (loadedQuery) {
      // Check if loaded query has been run (matches currentQuery)
      const isLoadedQueryRun = currentQuery &&
        currentQuery.userQuery === loadedQuery.userQuery;

      if (isLoadedQueryRun) {
        // Loaded query has been run - expand for composition
        console.log("📋 [QueryManager] Loaded query has been run - expanding composer for composition");
        setIsComposerExpanded(true);
      } else {
        // Loaded query not yet run - collapse composer
        console.log("📋 [QueryManager] Loaded query not run - collapsing composer");
        setIsComposerExpanded(false);
      }
    } else {
      // No loaded query - expand if no current query
      if (!currentQuery) {
        console.log("📋 [QueryManager] No loaded query or current query - expanding composer");
        setIsComposerExpanded(true);
      }
    }
  }, [loadedQuery, currentQuery]);

  // Use the extracted hook for all state and logic
  const {
    queries,
    selectedValue,
    isExpanded,
    showSaveDialog,
    showRenameDialog,
    showClearAllDialog,
    saveQueryName,
    renameValue,
    handleSelectionChange,
    handleDeleteQuery,
    handleClearResults,
    handleSaveQuery,
    handleRenameQuery,
    handleClearAllQueries,
    refreshQueries,
    setSelectedValue,
    setIsExpanded,
    setShowSaveDialog,
    setShowRenameDialog,
    setShowClearAllDialog,
    setSaveQueryName,
    setRenameValue,
    setRenameQueryId,
    canSaveCurrent,
    actionsMenuContent,
  } = useQueryManager({
    currentResults,
    currentUserQuery: currentQuery?.userQuery,
    currentFormalQuery: currentQuery?.formalQuery,
    onQuerySelect,
    onQueryLoadedIntoComposer,
    onQueryChange,
    onClearAll,
    disabled,
    originalQueryForComposition,
    loadedQuery,
    originalLoadedQuery,
    tempComposedQuery,
    onOriginalQueryForCompositionChange,
  });

  // Handler for editing loaded query
  const handleEditLoadedQuery = React.useCallback(
    (newQuery: string, context?: { stepIndex?: number }) => {
      if (!loadedQuery) return;

      console.log("✏️ [QueryManager] Editing loaded query:", {
        newQuery,
        context,
      });

      let updatedQuery: StoredQuery;

      if (context?.stepIndex !== undefined && loadedQuery.isComposed) {
        // Editing a step in a composed query
        const updatedSteps = [...(loadedQuery.querySteps || [])];
        updatedSteps[context.stepIndex] = {
          ...updatedSteps[context.stepIndex],
          userQuery: newQuery,
          intentParserResult: undefined, // Force re-parsing
        };

        updatedQuery = {
          ...loadedQuery,
          querySteps: updatedSteps,
        };
        console.log(
          "✏️ [QueryManager] Updated step",
          context.stepIndex,
          "in composed query"
        );
      } else {
        // Editing base query (simple or base of composed)
        updatedQuery = {
          ...loadedQuery,
          userQuery: newQuery,
          intentParserResult: undefined, // Force re-parsing on next execution
        };
        console.log("✏️ [QueryManager] Updated base query");
      }

      // Update the loaded query state (don't save to storage yet - user will save manually)
      if (onQueryLoadedIntoComposer) {
        onQueryLoadedIntoComposer(updatedQuery);
      }
    },
    [loadedQuery, refreshQueries, onQueryLoadedIntoComposer]
  );

  // Expose refresh function to parent component
  React.useEffect(() => {
    if (onQueriesUpdate) {
      (window as any).__queryManagerRefresh = refreshQueries;
    }
  }, [refreshQueries, onQueriesUpdate]);

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

    // Safety check: if queries is undefined, return empty array
    if (!queries) {
      console.error(
        "❌ [QueryManager] queries is undefined in createSelectItems"
      );
      return items;
    }

    console.log("✅ [QueryManager] queries in createSelectItems:", queries);

    // Add current query if available
    if (currentQuery?.userQuery) {
      items.push({
        id: "current",
        type: "current",
        label: "🔍 Last Query",
        description:
          currentQuery.userQuery.length > 70
            ? currentQuery.userQuery.substring(0, 67) + "..."
            : currentQuery.userQuery,
        group: "", // No group - standalone item
      });
    }

    // Add recent queries
    if (queries?.recent) {
      queries.recent.forEach((query) => {
        // Skip queries with invalid userQuery
        if (!query.userQuery) {
          console.warn(
            "⚠️ [QueryManager] Skipping query with undefined userQuery:",
            query
          );
          return;
        }

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
    }

    // Add saved queries
    if (queries?.saved) {
      queries.saved.forEach((query) => {
        // Skip queries with invalid userQuery
        if (!query.userQuery) {
          console.warn(
            "⚠️ [QueryManager] Skipping saved query with undefined userQuery:",
            query
          );
          return;
        }

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
    }

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

    if (filteredItems.length)
      filteredItems.forEach((item) => {
        if (!groups[item.group]) {
          groups[item.group] = [];
        }
        groups[item.group].push(item);
      });

    const result: QuerySelectItem[] = [];

    // Add items with group headers (only if group has items)
    if (Object.entries(groups).length)
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
              ? currentQuery?.userQuery
                ? `Last query: ${
                    currentQuery.userQuery.length > 80
                      ? currentQuery.userQuery.substring(0, 77) + "..."
                      : currentQuery.userQuery
                  }`
                : "Last query:"
              : selectedValue === "" || !selectedValue
              ? "No query selected - click to load saved queries or compose a new one below"
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
            disabled={disabled || baseSelectItems.length === 0}
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
                console.log(
                  "🔍 [QueryManager] Composition mode - displaying:",
                  {
                    original: {
                      userQuery: originalQueryForComposition.userQuery,
                      isComposed: originalQueryForComposition.isComposed,
                      steps:
                        originalQueryForComposition.querySteps?.map(
                          (s) => s.userQuery
                        ) || [],
                    },
                    loaded: {
                      userQuery: loadedQuery.userQuery,
                      isComposed: loadedQuery.isComposed,
                      steps:
                        loadedQuery.querySteps?.map((s) => s.userQuery) || [],
                    },
                  }
                );

                return (
                  <div className="composition-mode">
                    {/* Active Query Section */}
                    <div className="active-query-section">
                      <h4 className="section-header">
                        🔵 Active Query
                        <small> (base for composition)</small>
                      </h4>
                      <UnifiedQueryRenderer
                        unifiedQuery={originalQueryForComposition}
                        showLabel={false}
                        visualComposed={true}
                      />
                    </div>

                    {/* Loaded Query Section */}
                    <div className="loaded-query-section">
                      <h4 className="section-header">
                        📋 Loaded Query
                        <small>
                          {" "}
                          (
                          {loadedQuery.isComposed
                            ? `composed - ${
                                (loadedQuery.querySteps?.length || 0) + 1
                              } components`
                            : "simple"}
                          ) (ready to compose)
                        </small>
                      </h4>
                      <StoredQueryRenderer
                        storedQuery={loadedQuery}
                        showLabel={false}
                        visualComposed={true}
                        editable={true}
                        onEdit={handleEditLoadedQuery}
                      />
                      <div className="composition-actions">
                        <small className="composition-hint">
                          Use "Add to results" below to compose Active + Loaded
                          queries
                        </small>
                      </div>
                    </div>
                  </div>
                );
              } else if (
                selectedValue === "current" &&
                currentQuery?.userQuery
              ) {
                // Regular current query display
                console.log("🔍 [QueryManager] Rendering current query:", {
                  userQuery: currentQuery.userQuery,
                  isComposed: currentQuery.isComposed,
                  queryStepsCount: currentQuery.querySteps?.length || 0,
                  hasTempComposedQuery: !!tempComposedQuery,
                });

                // Check if current query is composed (either from UnifiedQuery or tempComposedQuery)
                if (
                  currentQuery.isComposed &&
                  (currentQuery.querySteps?.length || 0) > 0
                ) {
                  console.log(
                    "🔗 [QueryManager] Displaying composed query from currentQuery"
                  );

                  // Use tempComposedQuery if available, otherwise convert UnifiedQuery to StoredQuery
                  const queryToDisplay =
                    tempComposedQuery &&
                    tempComposedQuery.userQuery === currentQuery.userQuery
                      ? tempComposedQuery
                      : ({
                          ...currentQuery,
                          id: currentQuery.id || `current_${Date.now()}`,
                          timestamp: currentQuery.timestamp || new Date(),
                        } as StoredQuery);

                  return (
                    <StoredQueryRenderer
                      storedQuery={queryToDisplay}
                      showLabel={false}
                      visualComposed={true}
                    />
                  );
                } else {
                  // Show simple current query
                  console.log("📝 [QueryManager] Displaying simple query");
                  return (
                    <div className="simple-query-display">
                      <UnifiedQueryRenderer
                        unifiedQuery={currentQuery}
                        showLabel={false}
                        visualComposed={false}
                      />
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

                  const handleEditSelectedQuery = (
                    newQuery: string,
                    context?: { stepIndex?: number }
                  ) => {
                    console.log("✏️ [QueryManager] Editing selected query:", {
                      newQuery,
                      context,
                    });

                    // Use loadedQuery if available (it has the latest edits), otherwise use selectedQuery
                    const baseQuery = loadedQuery || selectedQuery;
                    let updatedQuery: StoredQuery;

                    if (
                      context?.stepIndex !== undefined &&
                      baseQuery.isComposed
                    ) {
                      // Editing a step in a composed query
                      const updatedSteps = [...(baseQuery.querySteps || [])];
                      updatedSteps[context.stepIndex] = {
                        ...updatedSteps[context.stepIndex],
                        userQuery: newQuery,
                        intentParserResult: undefined, // Force re-parsing
                      };

                      updatedQuery = {
                        ...baseQuery,
                        querySteps: updatedSteps,
                      };
                      console.log(
                        "✏️ [QueryManager] Updated step",
                        context.stepIndex,
                        "in selected composed query"
                      );
                    } else {
                      // Editing base query (simple or base of composed)
                      updatedQuery = {
                        ...baseQuery,
                        userQuery: newQuery,
                        intentParserResult: undefined, // Force re-parsing
                      };
                      console.log(
                        "✏️ [QueryManager] Updated base of selected query"
                      );
                    }

                    // Update the loaded query state (don't save to storage yet - user will save manually)
                    if (onQueryLoadedIntoComposer) {
                      onQueryLoadedIntoComposer(updatedQuery);
                    }
                  };

                  return (
                    <div className="stored-query-details">
                      <StoredQueryRenderer
                        storedQuery={loadedQuery || selectedQuery}
                        showLabel={false}
                        visualComposed={true}
                        editable={true}
                        onEdit={handleEditSelectedQuery}
                      />

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
              // return (
              //   <div className="no-current-query-message">
              //     <p>
              //       No last query available. Use the load button in the header
              //       to select a stored query, or compose a new one below.
              //     </p>
              //   </div>
              // );
            })()}
          </div>

          {/* Unified Execution Progress - shows after query display, before composer */}
          {(executionProgress ||
            (queryProgress && Object.keys(queryProgress).length > 0)) && (
            <div className="query-progress-tracker">
              {executionProgress && (
                <div className="query-progress-message">
                  {executionProgress}
                </div>
              )}
              {queryProgress && Object.keys(queryProgress).length > 0 && (
                <>
                  <div className="query-progress-title">
                    Parallel execution:
                  </div>
                  {Object.entries(queryProgress).map(([queryId, info]) => (
                    <div key={queryId} className="query-progress-item">
                      <span className="query-progress-status">
                        <strong>{queryId}:</strong> {info.status}
                      </span>
                      {info.count !== undefined && (
                        <span className="query-progress-count">
                          ({info.count} results)
                        </span>
                      )}
                    </div>
                  ))}
                </>
              )}
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
                // Note: loaded query state is managed internally by the hook
              }}
              onExecuteQuery={async (mode, model) => {
                // Set executing mode for button-specific loading state
                setExecutingMode(mode);

                try {
                  // Execute the query - composition logic is handled in FullResultsPopup
                  const result = await onExecuteQuery(mode, model);

                  // Clear the composer input after execution
                  onQueryChange("");

                  return result;
                } finally {
                  // Clear executing mode when done
                  setExecutingMode(null);
                }
              }}
              hasActiveQuery={
                !!(currentQuery?.userQuery && currentQuery.userQuery.trim())
              }
              hasLoadedQuery={!!loadedQuery}
              isExpanded={isComposerExpanded}
              onToggleExpanded={() => {
                console.log(
                  "🔄 [QueryComposer] Toggling expansion:",
                  !isComposerExpanded
                );
                setIsComposerExpanded(!isComposerExpanded);
              }}
              executingMode={executingMode}
              showInputSection={
                !disabled && // Don't show during execution
                (currentResults.length > 0 || !currentQuery) && // Show when results exist OR no active query (fresh start)
                (!loadedQuery || (currentQuery && currentQuery.userQuery === loadedQuery.userQuery))
              }
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
        title={
          loadedQuery &&
          originalLoadedQuery &&
          loadedQuery.userQuery !== originalLoadedQuery.userQuery
            ? "Save Edited Query"
            : "Save Query"
        }
        className="save-query-dialog"
      >
        <div className={Classes.DIALOG_BODY}>
          {loadedQuery &&
          originalLoadedQuery &&
          loadedQuery.userQuery !== originalLoadedQuery.userQuery ? (
            <>
              <p>
                The loaded query has been edited. How would you like to save it?
              </p>
              <div className="current-query-preview">
                <strong>Edited Query:</strong>{" "}
                <QueryRenderer query={loadedQuery.userQuery} />
              </div>
              <div
                style={{ marginTop: "10px", fontSize: "0.9em", color: "#666" }}
              >
                <strong>Original:</strong> {originalLoadedQuery.userQuery}
              </div>
              <InputGroup
                placeholder="Enter a name for the new query (if saving as new)"
                value={saveQueryName}
                onChange={(e) => setSaveQueryName(e.target.value)}
                autoFocus
                style={{ marginTop: "15px" }}
              />
            </>
          ) : (
            <>
              <p>Save the current query for later use:</p>
              <div className="current-query-preview">
                <strong>Query:</strong>{" "}
                <QueryRenderer query={currentQuery?.userQuery || ""} />
              </div>
              {currentQuery?.formalQuery &&
                currentQuery.formalQuery !== currentQuery.userQuery && (
                  <div className="current-formal-query-preview">
                    <strong>Formal Query:</strong>{" "}
                    <QueryRenderer query={currentQuery?.formalQuery || ""} />
                  </div>
                )}
              <InputGroup
                placeholder="Enter a name for this query (optional)"
                value={saveQueryName}
                onChange={(e) => setSaveQueryName(e.target.value)}
                autoFocus
              />
            </>
          )}
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={() => setShowSaveDialog(false)}>Cancel</Button>
            {loadedQuery &&
            originalLoadedQuery &&
            loadedQuery.userQuery !== originalLoadedQuery.userQuery ? (
              <>
                <Button
                  intent="warning"
                  onClick={() => {
                    // Replace existing query
                    const { updateQuery } = require("./utils/queryStorage");
                    if (loadedQuery.id) {
                      updateQuery(loadedQuery.id, {
                        userQuery: loadedQuery.userQuery,
                        intentParserResult: undefined,
                      });
                      // Update originalLoadedQuery to match so it's no longer "edited"
                      if (onQueryLoadedIntoComposer) {
                        onQueryLoadedIntoComposer(loadedQuery, true); // Force reset original
                      }
                      refreshQueries();
                    }
                    setShowSaveDialog(false);
                    setSaveQueryName("");
                  }}
                >
                  Replace Existing
                </Button>
                <Button intent="primary" onClick={handleSaveQuery}>
                  Save as New
                </Button>
              </>
            ) : (
              <Button intent="primary" onClick={handleSaveQuery}>
                Save Query
              </Button>
            )}
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
        title="Delete All Stored Queries ⚠️"
        className="clear-all-queries-dialog"
      >
        <div className={Classes.DIALOG_BODY}>
          <p>
            ⚠️ This will permanently delete all stored queries (both recent and
            saved).
          </p>
          <p>
            <strong>Current stored queries:</strong>
          </p>
          <ul>
            <li>Recent queries: {queries.recent.length}</li>
            <li>Saved queries: {queries.saved.length}</li>
          </ul>
          <p>
            <strong>This action cannot be undone.</strong>
          </p>
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
