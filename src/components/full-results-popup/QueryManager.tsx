import React, { useState, useEffect } from "react";
import {
  Button,
  HTMLSelect,
  Dialog,
  Classes,
  InputGroup,
  Menu,
  MenuItem,
  Popover,
  Position,
  Collapse,
} from "@blueprintjs/core";
import {
  StoredQuery,
  getStoredQueries,
  saveQuery,
  deleteSavedQuery,
  renameSavedQuery,
  getCurrentQueryInfo,
} from "../../ai/agents/search-agent/helpers/queryStorage";

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

  const handleSelectionChange = (value: string) => {
    if (disabled || isLoading) return;
    setSelectedValue(value);
    // Just update selection, don't execute query yet
  };

  const handleLoadQuery = async () => {
    if (disabled || isLoading || selectedValue === "current" || !selectedValue)
      return;

    // Find the selected query
    const allQueries = [...queries.recent, ...queries.saved];
    const selectedQuery = allQueries.find((q) => q.id === selectedValue);

    if (selectedQuery) {
      setIsLoading(true);
      try {
        onQuerySelect(selectedQuery);
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
                // Show details of selected stored query
                const allQueries = [...queries.recent, ...queries.saved];
                const selectedQuery = allQueries.find(
                  (q) => q.id === selectedValue
                );
                if (selectedQuery) {
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
                    📝 No last query available. Select a query from the
                    dropdown below to view its details.
                  </p>
                </div>
              );
            })()}
          </div>

          {/* Query Selector */}
          <div className="query-manager-selector">
            <div className="query-manager-selector-main">
              <HTMLSelect
                value={selectedValue}
                onChange={(e) => handleSelectionChange(e.target.value)}
                disabled={disabled || isLoading}
                className="query-manager-dropdown"
              >
                {/* Current Query - only show if there is one */}
                {currentUserQuery && (
                  <option value="current">🔍 Last Query</option>
                )}

                {/* Recent Queries */}
                {queries.recent.length > 0 && (
                  <optgroup label="📅 Recent Queries">
                    {queries.recent.map((query) => (
                      <option key={query.id} value={query.id}>
                        {formatTimestamp(query.timestamp)} -{" "}
                        {query.userQuery.length > 40
                          ? query.userQuery.substring(0, 40) + "..."
                          : query.userQuery}
                      </option>
                    ))}
                  </optgroup>
                )}

                {/* Saved Queries */}
                {queries.saved.length > 0 && (
                  <optgroup label="⭐ Saved Queries">
                    {queries.saved.map((query) => (
                      <option key={query.id} value={query.id}>
                        {query.name || query.userQuery}
                      </option>
                    ))}
                  </optgroup>
                )}

                {/* Show placeholder when no queries available */}
                {!currentUserQuery &&
                  queries.recent.length === 0 &&
                  queries.saved.length === 0 && (
                    <option value="" disabled>
                      No saved queries available
                    </option>
                  )}
              </HTMLSelect>

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
