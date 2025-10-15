import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Button,
  MenuItem,
  Collapse,
  Popover,
  Position,
  Icon,
} from "@blueprintjs/core";
import { Select, ItemRenderer } from "@blueprintjs/select";
import { StoredQuery } from "./utils/queryStorage";
import { UnifiedQuery } from "./types/QueryTypes";
import QueryComposer from "./QueryComposer";
import DirectContentSelector from "./DirectContentSelector";
import { UnifiedQueryRenderer, StoredQueryRenderer } from "./QueryRenderer";
import "./style/queryManager.css";
import "./style/queryRenderer.css";
import { useQueryManager } from "./hooks/useQueryManager";
import {
  QuerySelectItem,
  formatTimestamp,
  createSelectItems,
  groupedItems,
} from "./utils/querySelectItems";
import { updateQuery } from "./utils/queryStorage";
import { SaveQueryDialog } from "./dialogs/SaveQueryDialog";
import { RenameQueryDialog } from "./dialogs/RenameQueryDialog";
import { ClearAllQueriesDialog } from "./dialogs/ClearAllQueriesDialog";

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
  ) => Promise<import("./utils/queryStorage").PageSelection[]>;
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
  // Composer UI state
  const [isComposerExpanded, setIsComposerExpanded] = useState(!currentQuery); // Expanded when no query
  const [executingMode, setExecutingMode] = useState<"add" | "replace" | null>(
    null
  );
  const previousQueryRef = useRef(currentQuery);

  // Track page selections added in current session (not saved yet)
  const [sessionPageSelections, setSessionPageSelections] = useState<
    import("./utils/queryStorage").PageSelection[]
  >([]);

  // Clear session page selections when a DIFFERENT query is loaded
  // Track previous loaded query ID to detect actual changes
  const previousLoadedQueryIdRef = useRef<string | null>(null);

  useEffect(() => {
    const currentId = loadedQuery?.id || null;
    const previousId = previousLoadedQueryIdRef.current;

    // Only clear if we're loading a DIFFERENT query (not null, and different from previous)
    if (currentId && currentId !== previousId) {
      setSessionPageSelections([]);
    }

    previousLoadedQueryIdRef.current = currentId;
  }, [loadedQuery?.id]);

  // Session page selections are cleared when:
  // 1. A new query is loaded (line 158-165)
  // 2. User explicitly clears via handleClearAll (passed from parent)
  // DO NOT clear on query/results changes as that happens during normal execution

  // Auto-expand/collapse based on query state
  useEffect(() => {
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
  useEffect(() => {
    if (loadedQuery) {
      // Check if loaded query has been run (matches currentQuery)
      const isLoadedQueryRun =
        currentQuery && currentQuery.userQuery === loadedQuery.userQuery;

      if (isLoadedQueryRun) {
        // Loaded query has been run - keep composer collapsed

        setIsComposerExpanded(false);
      } else {
        // Loaded query not yet run - collapse composer

        setIsComposerExpanded(false);
      }
    } else {
      // No loaded query - expand if no current query
      if (!currentQuery) {
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
    onClearAll: () => {
      // Clear session page selections before calling parent's onClearAll
      setSessionPageSelections([]);
      onClearAll?.();
    },
    disabled,
    originalQueryForComposition,
    loadedQuery,
    originalLoadedQuery,
    tempComposedQuery,
    sessionPageSelections,
    onOriginalQueryForCompositionChange,
  });

  // Check if current query exists in storage and has been modified
  const storedQueryToReplace = React.useMemo(() => {
    // We need the current query's ID to find the correct stored query
    // If currentQuery has an ID, use it. Otherwise, check loadedQuery.
    const queryId = currentQuery?.id || loadedQuery?.id;

    if (!queryId || sessionPageSelections.length === 0) {
      return null;
    }

    // Find matching query in storage by ID (reliable)
    const allQueries = [...queries.recent, ...queries.saved];
    const stored = allQueries.find((q) => q.id === queryId);

    return stored || null;
  }, [currentQuery?.id, loadedQuery?.id, queries, sessionPageSelections]);

  // Generic handler for editing any query (loaded or selected)
  const handleEditQuery = useCallback(
    (
      baseQuery: StoredQuery,
      newQuery: string,
      context?: { stepIndex?: number }
    ) => {
      let updatedQuery: StoredQuery;

      if (context?.stepIndex !== undefined && baseQuery.isComposed) {
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
      } else {
        // Editing base query (simple or base of composed)
        updatedQuery = {
          ...baseQuery,
          userQuery: newQuery,
          intentParserResult: undefined, // Force re-parsing on next execution
        };
      }

      // Update the loaded query state (don't save to storage yet - user will save manually)
      if (onQueryLoadedIntoComposer) {
        onQueryLoadedIntoComposer(updatedQuery);
      }
    },
    [onQueryLoadedIntoComposer]
  );

  // Handler for editing loaded query (wrapper for backward compatibility)
  const handleEditLoadedQuery = useCallback(
    (newQuery: string, context?: { stepIndex?: number }) => {
      if (!loadedQuery) return;
      handleEditQuery(loadedQuery, newQuery, context);
    },
    [loadedQuery, handleEditQuery]
  );

  // Expose refresh function to parent component
  useEffect(() => {
    if (onQueriesUpdate) {
      (window as any).__queryManagerRefresh = refreshQueries;
    }
  }, [refreshQueries, onQueriesUpdate]);

  // Get all select items with grouping (using imported utilities)
  const baseSelectItems = createSelectItems(queries, currentQuery);
  const groupedSelectItems = groupedItems(baseSelectItems);

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
      const itemsInThisGroup = baseSelectItems.filter(
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
                // Check if current query is composed (either from UnifiedQuery or tempComposedQuery)
                if (
                  currentQuery.isComposed &&
                  (currentQuery.querySteps?.length || 0) > 0
                ) {
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

                  return (
                    <div className="stored-query-details">
                      <StoredQueryRenderer
                        storedQuery={loadedQuery || selectedQuery}
                        showLabel={false}
                        visualComposed={true}
                        editable={true}
                        onEdit={(newQuery, context) => {
                          // Use loadedQuery if available (it has the latest edits), otherwise use selectedQuery
                          const baseQuery = loadedQuery || selectedQuery;
                          handleEditQuery(baseQuery, newQuery, context);
                        }}
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

              // Default: return null when no query to display
              return null;
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
                setIsComposerExpanded(!isComposerExpanded);
              }}
              executingMode={executingMode}
              showInputSection={
                !disabled && // Don't show during execution
                (currentResults.length > 0 || !currentQuery) && // Show when results exist OR no active query (fresh start)
                (!loadedQuery ||
                  (currentQuery &&
                    currentQuery.userQuery === loadedQuery.userQuery))
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
              onAddContent={async () => {
                const addedPageSelections = await handleDirectContentAdd(
                  currentResults,
                  setCurrentResults
                );

                // Add to session state for UI display (NO auto-save)
                if (addedPageSelections.length > 0) {
                  setSessionPageSelections((prev) => [
                    ...prev,
                    ...addedPageSelections,
                  ]);
                }
              }}
              onQueryPages={queryAvailablePages}
            />
            {/* Page Selections Display */}
            {(() => {
              // Combine current query page selections + loaded query page selections + session page selections
              // After execution, currentQuery will have the page selections from the executed query
              const currentPageSelections = currentQuery?.pageSelections || [];
              const loadedPageSelections = loadedQuery?.pageSelections || [];
              const allPageSelections = [
                ...currentPageSelections,
                ...loadedPageSelections,
                ...sessionPageSelections,
              ];

              // Remove duplicates by title
              const uniquePageSelections = allPageSelections.filter(
                (page, index, self) =>
                  index === self.findIndex((p) => p.title === page.title)
              );

              if (uniquePageSelections.length === 0) return null;

              return (
                <div className="query-page-selections">
                  <div className="page-selections-tags">
                    {uniquePageSelections.map((pageSelection, index) => {
                      const isFromSession = sessionPageSelections.some(
                        (sp) => sp.title === pageSelection.title
                      );
                      return (
                        <span
                          key={`${pageSelection.uid}-${index}`}
                          className={`bp3-tag ${
                            isFromSession ? "bp3-intent-success" : "bp3-minimal"
                          }`}
                        >
                          {pageSelection.includeContent && (
                            <Icon
                              icon="document"
                              size={12}
                              title="Page content included"
                              style={{ marginRight: 4 }}
                            />
                          )}
                          {pageSelection.includeLinkedRefs && (
                            <Icon
                              icon="link"
                              size={12}
                              title="Linked references included"
                              style={{ marginRight: 4 }}
                            />
                          )}
                          {pageSelection.title.length > 30 // Limit arbitrarily set at approximately 12,500 tokens (for English)
                            ? pageSelection.title.substring(0, 30) + "..."
                            : pageSelection.title}
                          {pageSelection.dnpPeriod && (
                            <span style={{ opacity: 0.7, fontSize: "11px" }}>
                              {" "}
                              ({pageSelection.dnpPeriod}d)
                            </span>
                          )}
                          {isFromSession && (
                            <button
                              className="bp3-tag-remove"
                              onClick={() => {
                                const sessionIndex =
                                  index - loadedPageSelections.length;
                                setSessionPageSelections((prev) =>
                                  prev.filter((_, i) => i !== sessionIndex)
                                );
                              }}
                              title="Remove"
                            />
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </Collapse>

      {/* Save Query Dialog */}
      <SaveQueryDialog
        isOpen={showSaveDialog}
        onClose={() => setShowSaveDialog(false)}
        onSave={handleSaveQuery}
        onReplaceExisting={() => {
          // Replace existing query with page selections
          const queryToReplace = storedQueryToReplace || loadedQuery;

          if (queryToReplace?.id) {
            updateQuery(queryToReplace.id, {
              userQuery: loadedQuery?.userQuery || queryToReplace.userQuery,
              formalQuery:
                loadedQuery?.formalQuery || queryToReplace.formalQuery,
              intentParserResult:
                loadedQuery?.intentParserResult ||
                queryToReplace.intentParserResult,
              pageSelections: [
                ...(queryToReplace.pageSelections || []),
                ...sessionPageSelections,
              ],
              isComposed: true,
            });

            refreshQueries();
            setSessionPageSelections([]);
          } else {
            console.warn("⚠️ [QueryManager] No queryToReplace.id found!");
          }
          setShowSaveDialog(false);
          setSaveQueryName("");
        }}
        saveQueryName={saveQueryName}
        onSaveQueryNameChange={setSaveQueryName}
        currentQuery={currentQuery}
        loadedQuery={loadedQuery}
        originalLoadedQuery={originalLoadedQuery}
        storedQueryToReplace={storedQueryToReplace}
        sessionPageSelections={sessionPageSelections}
      />

      {/* Rename Query Dialog */}
      <RenameQueryDialog
        isOpen={showRenameDialog}
        onClose={() => setShowRenameDialog(false)}
        onRename={handleRenameQuery}
        renameValue={renameValue}
        onRenameValueChange={setRenameValue}
      />

      {/* Clear All Queries Dialog */}
      <ClearAllQueriesDialog
        isOpen={showClearAllDialog}
        onClose={() => setShowClearAllDialog(false)}
        onClearAll={handleClearAllQueries}
        recentCount={queries.recent.length}
        savedCount={queries.saved.length}
      />
    </div>
  );
};
