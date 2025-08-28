import React, { useState, useEffect } from "react";
import {
  Button,
  Dialog,
  Classes,
  InputGroup,
  Menu,
  MenuItem,
  Popover,
  Position,
  Collapse,
} from "@blueprintjs/core";
import { Select, ItemRenderer } from "@blueprintjs/select";
import {
  StoredQuery,
  getStoredQueries,
  saveQuery,
  deleteSavedQuery,
  renameSavedQuery,
  getCurrentQueryInfo,
} from "../../ai/agents/search-agent/helpers/queryStorage";

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
}

export const QueryManager: React.FC<QueryManagerProps> = ({
  currentUserQuery,
  currentFormalQuery,
  onQuerySelect,
  disabled = false,
  executionProgress,
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
          ) : (
            // Saved queries: show timestamp on same line, description below
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
                    style={{ fontSize: "0.85em", color: "#666", marginTop: "2px" }}
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
                    style={{ fontSize: "0.85em", color: "#666", marginTop: "2px" }}
                  >
                    {item.description}
                  </div>
                )}
              </div>
            )
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
    // Just update selection, don't execute query yet
  };

  const handleLoadQuery = async () => {
    if (disabled || isLoading || selectedValue === "current" || !selectedValue)
      return;

    // Find the selected item
    const selectedItem = baseSelectItems.find(
      (item) => item.id === selectedValue
    );

    if (selectedItem && selectedItem.query) {
      setIsLoading(true);
      try {
        onQuerySelect(selectedItem.query);
      } finally {
        setIsLoading(false);
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

  const openRenameDialog = (queryId: string) => {
    const query = queries.saved.find((q) => q.id === queryId);
    if (query) {
      setRenameQueryId(queryId);
      setRenameValue(query.name || query.userQuery);
      setShowRenameDialog(true);
    }
  };

  const generateDefaultName = (userQuery: string): string => {
    const cleaned = userQuery.trim().replace(/\s+/g, " ");
    return cleaned.length <= 80 ? cleaned : cleaned.substring(0, 77) + "...";
  };

  const canSaveCurrent = () => {
    const currentInfo = getCurrentQueryInfo();
    return currentInfo.userQuery && currentInfo.intentParserResult;
  };

  const renderQueryActions = (query: StoredQuery) => {
    if (!queries.saved.some((q) => q.id === query.id)) return null;

    return (
      <Popover
        content={
          <Menu>
            <MenuItem
              icon="edit"
              text="Rename"
              onClick={() => openRenameDialog(query.id)}
            />
            <MenuItem
              icon="trash"
              text="Delete"
              intent="danger"
              onClick={() => handleDeleteQuery(query.id)}
            />
          </Menu>
        }
        position={Position.BOTTOM_RIGHT}
        minimal
      >
        <Button icon="more" minimal small disabled={disabled} />
      </Popover>
    );
  };

  return (
    <div className="query-manager-container">
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
                      <strong>Query:</strong> {currentUserQuery}
                    </div>
                    {currentFormalQuery &&
                      currentFormalQuery !== currentUserQuery && (
                        <div className="current-formal-query-preview">
                          <strong>Formal Query:</strong> {currentFormalQuery}
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
                      <div className="stored-query-preview">
                        <strong>Query:</strong> {selectedQuery.userQuery}
                      </div>
                      {selectedQuery.formalQuery &&
                        selectedQuery.formalQuery !==
                          selectedQuery.userQuery && (
                          <div className="stored-formal-query-preview">
                            <strong>Formal Query:</strong>{" "}
                            {selectedQuery.formalQuery}
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
                    📝 No last query available. Select a query from the dropdown
                    below to view its details.
                  </p>
                </div>
              );
            })()}
          </div>

          {/* Query Selector */}
          <div className="query-manager-selector">
            <div className="query-manager-selector-main">
              <QuerySelect
                items={groupedSelectItems}
                itemRenderer={renderQueryItem}
                itemPredicate={filterPredicate}
                onItemSelect={handleSelectionChange}
                activeItem={currentSelectedItem}
                disabled={disabled || isLoading}
                filterable={true}
                resetOnClose={false}
                resetOnSelect={false}
                inputProps={{
                  placeholder: "Search queries...",
                }}
                popoverProps={{
                  minimal: true,
                }}
              >
                <Button
                  text={
                    currentSelectedItem
                      ? currentSelectedItem.label
                      : baseSelectItems.length === 0
                      ? "No queries available"
                      : "Select a query..."
                  }
                  rightIcon="caret-down"
                  disabled={
                    disabled || isLoading || baseSelectItems.length === 0
                  }
                  fill
                  className="query-manager-dropdown"
                  style={{ textAlign: "left", justifyContent: "flex-start" }}
                />
              </QuerySelect>

              {isLoading && (
                <span className="query-manager-loading">⏳ Loading...</span>
              )}
            </div>

            <div className="query-manager-selector-actions">
              {selectedValue && selectedValue !== "current" && (
                <Button
                  text="Run"
                  icon="play"
                  intent="primary"
                  small
                  onClick={handleLoadQuery}
                  disabled={disabled || isLoading}
                  title="Execute the selected query"
                />
              )}

              <Button
                icon="floppy-disk"
                minimal
                small
                onClick={() => setShowSaveDialog(true)}
                disabled={!canSaveCurrent() || disabled}
                title="Save last query"
              />

              {selectedValue !== "current" &&
                queries.saved.some((q) => q.id === selectedValue) && (
                  <div className="query-manager-query-actions">
                    {renderQueryActions(
                      queries.saved.find((q) => q.id === selectedValue)!
                    )}
                  </div>
                )}
            </div>
          </div>

          {/* Execution Progress */}
          {executionProgress && (
            <div className="query-manager-execution-progress">
              {executionProgress}
            </div>
          )}
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
            <strong>Query:</strong> {currentUserQuery}
          </div>
          {currentFormalQuery && currentFormalQuery !== currentUserQuery && (
            <div className="current-formal-query-preview">
              <strong>Formal Query:</strong> {currentFormalQuery}
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
