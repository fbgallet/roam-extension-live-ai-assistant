import React, { useState, useEffect, useRef } from "react";
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

// Component to render queries using renderString API for clickable links
const QueryRenderer: React.FC<{ query: string; prefix?: string }> = ({
  query,
  prefix = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      try {
        (window as any).roamAlphaAPI.ui.components.renderString({
          el: containerRef.current,
          string: prefix + query,
        });
      } catch (error) {
        console.warn("Failed to render query with renderString:", error);
        // Fallback to plain text
        containerRef.current.textContent = prefix + query;
      }
    }
  }, [query, prefix]);

  return <div ref={containerRef} style={{ flex: 1, display: "inline" }} />;
};

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
  const getInitialSelectedValue = () => {
    if (currentUserQuery) return "current";
    const allQueries = getStoredQueries();
    if (allQueries.recent.length > 0) return allQueries.recent[0].id;
    if (allQueries.saved.length > 0) return allQueries.saved[0].id;
    return "";
  };

  const [selectedValue, setSelectedValue] = useState<string>(
    getInitialSelectedValue()
  );
  const [isExpanded, setIsExpanded] = useState(!currentUserQuery); // Auto-expand when no current query
  const [isLoading, setIsLoading] = useState(false);

  // Query Tools section state

  // Track loaded query for UI feedback
  const [loadedQuery, setLoadedQuery] = useState<StoredQuery | null>(null);

  // Dialogs
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameQueryId, setRenameQueryId] = useState<string>("");
  const [saveQueryName, setSaveQueryName] = useState("");
  const [renameValue, setRenameValue] = useState("");

  // Refresh queries when component mounts or updates
  useEffect(() => {
    setQueries(getStoredQueries());
  }, []);

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

    setSelectedValue(item.id);

    // Auto-load query into composer when selected (except for "current")
    if (item.id !== "current" && item.query) {
      // Load the query text into the composer
      onQueryChange(item.query.userQuery);

      // Store the loaded query for UI feedback
      setLoadedQuery(item.query);

      // Expand the section so user can see the execution buttons
      setIsExpanded(true);

      console.log(
        `📥 [QueryManager] Auto-loaded query into composer: "${item.query.userQuery}"`
      );
    }
  };

  const handleDeleteQuery = (queryId: string) => {
    if (deleteSavedQuery(queryId)) {
      setQueries(getStoredQueries());

      // If the deleted query was selected, switch back to current
      if (selectedValue === queryId) {
        setSelectedValue("current");
        onQuerySelect("current");
      }
    }
  };

  const handleSaveQuery = () => {
    const currentInfo = getCurrentQueryInfo();

    if (!currentInfo.userQuery || !currentInfo.intentParserResult) {
      console.warn("No current query to save");
      return;
    }

    const queryName =
      saveQueryName.trim() || generateDefaultName(currentInfo.userQuery);

    saveQuery(
      {
        userQuery: currentInfo.userQuery,
        formalQuery: currentInfo.formalQuery || currentInfo.userQuery,
        intentParserResult: currentInfo.intentParserResult,
      },
      queryName
    );

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

  const generateDefaultName = (userQuery: string): string => {
    const cleaned = userQuery.trim().replace(/\s+/g, " ");
    return cleaned.length <= 80 ? cleaned : cleaned.substring(0, 77) + "...";
  };

  const canSaveCurrent = () => {
    const currentInfo = getCurrentQueryInfo();

    // Must have a valid query
    if (!currentInfo.userQuery || !currentInfo.intentParserResult) {
      console.log(
        "🔒 [QueryManager] Save disabled: No valid query or intent parser result"
      );
      return false;
    }

    // If there's a loaded query, only allow saving if the current query is different
    if (loadedQuery) {
      const isDifferent =
        currentInfo.userQuery.trim() !== loadedQuery.userQuery.trim();
      console.log("🔒 [QueryManager] Save check for loaded query:", {
        currentQuery: currentInfo.userQuery.trim(),
        loadedQuery: loadedQuery.userQuery.trim(),
        isDifferent,
      });
      return isDifferent;
    }

    // If no loaded query, can save
    console.log("✅ [QueryManager] Save enabled: No loaded query");
    return true;
  };

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

          {/* Delete button for saved queries */}
          {selectedValue !== "current" &&
            queries.saved.some((q) => q.id === selectedValue) && (
              <Button
                icon="trash"
                minimal
                small
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  handleDeleteQuery(selectedValue);
                }}
                disabled={disabled}
                title="Delete query"
                intent="danger"
              />
            )}

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
              if (selectedValue === "current" && currentUserQuery) {
                return (
                  <>
                    <div className="current-query-preview">
                      <strong>Query:</strong>{" "}
                      <QueryRenderer query={currentUserQuery} />
                    </div>
                    {currentFormalQuery &&
                      currentFormalQuery !== currentUserQuery && (
                        <div className="current-formal-query-preview">
                          <strong>Formal Query:</strong>{" "}
                          <QueryRenderer query={currentFormalQuery} />
                        </div>
                      )}
                  </>
                );
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
                        <div className="composed-query-details">
                          <div className="composed-query-header">
                            <strong>Composed Query</strong>
                            <small>
                              {" "}
                              (
                              {(selectedQuery.querySteps?.length || 0) +
                                (selectedQuery.pageSelections?.length ||
                                  0)}{" "}
                              components)
                            </small>
                          </div>

                          {/* Initial Query */}
                          <div className="query-step">
                            <div className="query-step-header">
                              <span className="query-step-label">
                                1. Initial Query:
                              </span>
                            </div>
                            <div className="query-step-content">
                              <QueryRenderer query={selectedQuery.userQuery} />
                            </div>
                            {selectedQuery.formalQuery &&
                              selectedQuery.formalQuery !==
                                selectedQuery.userQuery && (
                                <div className="query-step-formal">
                                  <small>
                                    <strong>Formal:</strong>{" "}
                                    <QueryRenderer
                                      query={selectedQuery.formalQuery}
                                    />
                                  </small>
                                </div>
                              )}
                          </div>

                          {/* Additional Query Steps */}
                          {selectedQuery.querySteps?.map((step, index) => (
                            <div key={index} className="query-step">
                              <div className="query-step-header">
                                <span className="query-step-label">
                                  {index + 2}. Added Query:
                                </span>
                              </div>
                              <div className="query-step-content">
                                <QueryRenderer query={step.userQuery} />
                              </div>
                              {step.formalQuery &&
                                step.formalQuery !== step.userQuery && (
                                  <div className="query-step-formal">
                                    <small>
                                      <strong>Formal:</strong>{" "}
                                      <QueryRenderer query={step.formalQuery} />
                                    </small>
                                  </div>
                                )}
                            </div>
                          ))}

                          {/* Page Selections */}
                          {selectedQuery.pageSelections?.map((page, index) => (
                            <div key={index} className="page-selection">
                              <div className="query-step-header">
                                <span className="query-step-label">
                                  {(selectedQuery.querySteps?.length || 0) +
                                    index +
                                    2}
                                  . Added Pages:
                                </span>
                              </div>
                              <div className="page-selection-content">
                                <QueryRenderer query={`[[${page.title}]]`} />
                                <small className="page-selection-options">
                                  {page.includeContent && page.includeLinkedRefs
                                    ? " (content + linked refs)"
                                    : page.includeContent
                                    ? " (content only)"
                                    : " (linked refs only)"}
                                  {page.dnpPeriod &&
                                    ` • ${page.dnpPeriod} days`}
                                </small>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="simple-query-details">
                          <div className="stored-query-preview">
                            <strong>Query:</strong>{" "}
                            <QueryRenderer query={selectedQuery.userQuery} />
                          </div>
                          {selectedQuery.formalQuery &&
                            selectedQuery.formalQuery !==
                              selectedQuery.userQuery && (
                              <div className="stored-formal-query-preview">
                                <strong>Formal Query:</strong>{" "}
                                <QueryRenderer
                                  query={selectedQuery.formalQuery}
                                />
                              </div>
                            )}
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
                    📝 No last query available. Use the load button (📤) in the
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
                  setLoadedQuery(null);
                }
              }}
              onExecuteQuery={(mode, model) => {
                // Always go through IntentParser for proper dynamic interpretation
                return onExecuteQuery(mode, model);
              }}
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
    </div>
  );
};
