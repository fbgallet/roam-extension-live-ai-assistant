import React, { useState, useEffect, useCallback } from "react";
import {
  Button,
  HTMLSelect,
  InputGroup,
  Checkbox,
  Icon,
} from "@blueprintjs/core";
import { createChildBlock } from "../../utils/roamAPI.js";
import { FullResultsPopupProps, Result } from "./types";
import { FullResultsChat } from "./FullResultsChat";
import { ResultContent, ResultMetadata } from "./ResultRenderer";
import { useFullResultsState } from "./hooks/useFullResultsState";
import { canUseChat } from "./utils/chatHelpers";
import { ReferencesFilterPopover } from "./ReferencesFilterPopover";
import { QueryManager } from "./QueryManager";
import { StoredQuery } from "../../ai/agents/search-agent/helpers/queryStorage";
import { executeQueryWithLiveUpdates } from "../../ai/agents/search-agent/helpers/livePopupExecution";

const FullResultsPopup: React.FC<FullResultsPopupProps> = ({
  results,
  isOpen,
  title = "Ask your graph: full results view",
  targetUid,
  privateMode = false,
  permissions = { contentAccess: false },
  userQuery,
  formalQuery,
}) => {
  // Query execution state
  const [isExecutingQuery, setIsExecutingQuery] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<string>("");
  const [currentResults, setCurrentResults] = useState(results);
  const [currentUserQuery, setCurrentUserQuery] = useState(userQuery);
  const [currentFormalQuery, setCurrentFormalQuery] = useState(formalQuery);
  const {
    // State
    selectedResults,
    dropdownStates,
    isClosing,
    searchFilter,
    pageFilter,
    dnpFilter,
    sortBy,
    sortOrder,
    resultsPerPage,
    currentPage,
    showMetadata,
    showPaths,
    viewMode,
    pageDisplayMode,
    expanded,
    showChat,
    chatMessages,
    chatAccessMode,
    chatAgentData,
    chatExpandedResults,
    isFullscreen,
    chatOnlyMode,
    mainContentWidth,
    isResizing,

    // Setters
    setSelectedResults,
    setDropdownStates,
    setSearchFilter,
    setPageFilter,
    setDNPFilter,
    setSortBy,
    setSortOrder,
    setResultsPerPage,
    setCurrentPage,
    setShowMetadata,
    setShowPaths,
    setViewMode,
    setExpanded,
    setChatMessages,
    setChatAccessMode,
    setChatAgentData,
    setChatExpandedResults,
    setIsFullscreen,
    setChatOnlyMode,
    setMainContentWidth,
    setIsResizing,

    // Computed values
    uniquePages,
    hasBlocks,
    hasPages,
    shouldShowDNPFilter,
    availableReferences,
    includedReferences,
    excludedReferences,
    filteredAndSortedResults,
    totalPages,
    paginatedResults,

    // Handlers
    handleCheckboxChange,
    handleSelectAll,
    handleSelectAllResults,
    getSelectedResultsArray,
    handleClose,
    toggleChat,
    handleIncludeReference,
    handleExcludeReference,
    handleClearAllReferences,
    resetChatConversation,
    handleExpandedToggle,
  } = useFullResultsState(currentResults, isOpen);

  // Query selection handler
  const handleQuerySelect = async (query: StoredQuery | "current") => {
    if (query === "current") {
      // Reset to original results
      setCurrentResults(results);
      setCurrentUserQuery(userQuery);
      setCurrentFormalQuery(formalQuery);
      setExecutionProgress("");
      resetChatConversation(); // Reset chat when switching back to original query
      return;
    }

    // Execute stored query
    setIsExecutingQuery(true);
    setExecutionProgress("Running query with Ask your Graph agent...");
    setCurrentUserQuery(query.userQuery);
    setCurrentFormalQuery(query.formalQuery);

    // Clear previous results immediately when starting new query
    setCurrentResults([]);
    resetChatConversation(); // Reset chat when executing a new stored query

    try {
      await executeQueryWithLiveUpdates({
        intentParserResult: query.intentParserResult,
        userQuery: query.userQuery,
        formalQuery: query.formalQuery,
        onProgress: (message: string) => {
          setExecutionProgress(
            `Running query with Ask your Graph agent... ${message}`
          );
        },
        onResults: (partialResults: any[], isPartial?: boolean) => {
          if (!isPartial) {
            setCurrentResults(partialResults);
          }
        },
        onComplete: (finalResults: any[]) => {
          setCurrentResults(finalResults);
          setExecutionProgress(
            `✅ Query completed - ${finalResults.length} results found`
          );
          setTimeout(() => setExecutionProgress(""), 3000);
        },
        onError: (error: string) => {
          setExecutionProgress(`❌ Query failed: ${error}`);
          setTimeout(() => setExecutionProgress(""), 5000);
        },
      });
    } catch (error) {
      console.error("Query execution failed:", error);
    } finally {
      setIsExecutingQuery(false);
    }
  };

  const handleInsertAtDNPEnd = async () => {
    try {
      const selectedResultsList = getSelectedResultsArray();
      if (selectedResultsList.length === 0) return;

      // Determine insertion location: targetUid if available, otherwise current DNP
      let insertionParentUid: string;
      if (targetUid) {
        insertionParentUid = targetUid;
      } else {
        // Get today's DNP
        const today = new Date();
        insertionParentUid = `${String(today.getMonth() + 1).padStart(
          2,
          "0"
        )}-${String(today.getDate()).padStart(2, "0")}-${today.getFullYear()}`;
      }

      // Create blocks with appropriate references
      for (const result of selectedResultsList) {
        // Use explicit isPage flag when available, fallback to legacy detection, default to block
        const isPage =
          result.isPage !== undefined
            ? result.isPage
            : result.uid && !result.pageUid; // Legacy: if has uid but no pageUid, assume page
        let insertText: string;

        if (isPage) {
          // For page results, use page reference
          const pageTitle =
            result.pageTitle ||
            result.content ||
            result.text ||
            result.title ||
            "Untitled Page";
          insertText = `[[${pageTitle}]]`;
        } else {
          // For block results, use block embed
          insertText = `((${result.uid}))`;
        }

        await createChildBlock(insertionParentUid, insertText);
      }

      alert(
        `✅ Inserted ${selectedResultsList.length} selected results into blocks`
      );
    } catch (error) {
      alert("❌ Error inserting results: " + error.message);
    }
  };

  const handleInsertInSidebar = () => {
    try {
      const selectedResultsList = getSelectedResultsArray();
      if (selectedResultsList.length === 0) return;

      selectedResultsList.forEach((result) => {
        if (result.uid) {
          window.roamAlphaAPI.ui.rightSidebar.addWindow({
            window: { type: "block", "block-uid": result.uid },
          });
        }
      });

      alert(
        `✅ Opened ${selectedResultsList.length} selected results in sidebar`
      );
    } catch (error) {
      alert("❌ Error opening in sidebar: " + error.message);
    }
  };

  const handleCopyEmbeds = () => {
    const selectedResultsList = getSelectedResultsArray();
    if (selectedResultsList.length === 0) return;

    const embeds = selectedResultsList
      .map((result) => {
        // Use explicit isPage flag when available, fallback to legacy detection, default to block
        const isPage =
          result.isPage !== undefined
            ? result.isPage
            : result.uid && !result.pageUid; // Legacy: if has uid but no pageUid, assume page

        if (isPage) {
          // For page results, use page embed syntax
          const pageTitle =
            result.pageTitle ||
            result.content ||
            result.text ||
            result.title ||
            "Untitled Page";
          return `{{[[embed]]: [[${pageTitle}]]}}`;
        } else {
          // For block results, use block embed
          return `((${result.uid}))`;
        }
      })
      .join("\n");

    navigator.clipboard.writeText(embeds);
    alert(
      `✅ Copied ${selectedResultsList.length} embed references to clipboard`
    );
  };

  const handleCopyReferences = () => {
    const selectedResultsList = getSelectedResultsArray();
    if (selectedResultsList.length === 0) return;

    const references = selectedResultsList
      .map((result) => {
        // Use explicit isPage flag when available, fallback to legacy detection, default to block
        const isPage =
          result.isPage !== undefined
            ? result.isPage
            : result.uid && !result.pageUid; // Legacy: if has uid but no pageUid, assume page

        if (isPage) {
          // For page results, use page reference
          const pageTitle =
            result.pageTitle ||
            result.content ||
            result.text ||
            result.title ||
            "Untitled Page";
          return `[[${pageTitle}]]`;
        } else {
          // For block results, use page reference where the block is located
          return `[[${result.pageTitle || result.uid}]]`;
        }
      })
      .join("\n");

    navigator.clipboard.writeText(references);
    alert(
      `✅ Copied ${selectedResultsList.length} page references to clipboard`
    );
  };

  const DropdownButton: React.FC<{
    mainText: string;
    mainAction: () => void;
    dropdownOptions: Array<{ text: string; action: () => void }>;
    disabled?: boolean;
    dropdownKey: string;
  }> = ({
    mainText,
    mainAction,
    dropdownOptions,
    disabled = false,
    dropdownKey,
  }) => {
    const isOpen = dropdownStates[dropdownKey] || false;

    const toggleDropdown = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isClosing) return; // Prevent state updates if closing
      setDropdownStates((prev) => ({
        ...prev,
        [dropdownKey]: !prev[dropdownKey],
      }));
    };

    return (
      <div className="full-results-simple-dropdown">
        <Button
          intent="primary"
          text={mainText}
          onClick={mainAction}
          disabled={disabled}
        />
        <Button
          icon="caret-down"
          intent="primary"
          disabled={disabled}
          onClick={toggleDropdown}
          aria-label="More options"
        />
        {isOpen && (
          <div className="full-results-simple-dropdown-menu">
            {dropdownOptions.map((option, idx) => (
              <button
                key={idx}
                className="full-results-simple-dropdown-item"
                onClick={() => {
                  option.action();
                  if (!isClosing) {
                    setDropdownStates((prev) => ({
                      ...prev,
                      [dropdownKey]: false,
                    }));
                  }
                }}
              >
                {option.text}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Advanced UI handlers
  const handleFullscreenToggle = () => {
    setIsFullscreen(!isFullscreen);
  };

  const handleChatOnlyToggle = () => {
    setChatOnlyMode(!chatOnlyMode);
    if (!chatOnlyMode && !showChat) {
      toggleChat(); // Auto-enable chat when switching to chat-only mode
    }
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleResizeMove = useCallback(
    (e: MouseEvent) => {
      if (isResizing) {
        e.preventDefault();
        const containerRect = document
          .querySelector(".full-results-content-container")
          ?.getBoundingClientRect();
        if (containerRect) {
          const relativeX = e.clientX - containerRect.left;
          const percentage = Math.max(
            20,
            Math.min(80, (relativeX / containerRect.width) * 100)
          );

          // Use requestAnimationFrame for smoother updates
          requestAnimationFrame(() => {
            setMainContentWidth(percentage);
          });
        }
      }
    },
    [isResizing]
  );

  const handleResizeEnd = () => {
    setIsResizing(false);
  };

  // Mouse event listeners for resize
  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleResizeMove);
      document.addEventListener("mouseup", handleResizeEnd);
      return () => {
        document.removeEventListener("mousemove", handleResizeMove);
        document.removeEventListener("mouseup", handleResizeEnd);
      };
    }
  }, [isResizing]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
      if (e.key === "F11") {
        e.preventDefault();
        handleFullscreenToggle();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, isFullscreen]);

  if (!isOpen) return null;

  return (
    <div
      id="full-results-popup-container"
      className={`full-results-overlay ${isFullscreen ? "fullscreen" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        className={`full-results-modal ${showChat ? "chat-open" : ""} ${
          chatOnlyMode ? "chat-only" : ""
        } ${isFullscreen ? "fullscreen" : ""} ${isResizing ? "resizing" : ""}`}
      >
        <div className="full-results-header">
          <h3 className="full-results-title">{title}</h3>
          <div className="full-results-header-controls">
            {showChat && (
              <button
                className="full-results-control-button"
                onClick={handleChatOnlyToggle}
                title={chatOnlyMode ? "Show results" : "Chat only"}
              >
                <Icon icon={chatOnlyMode ? "chart" : "chat"} size={16} />
              </button>
            )}
            <button
              className="full-results-control-button"
              onClick={handleFullscreenToggle}
              title={
                isFullscreen ? "Exit fullscreen (ESC)" : "Fullscreen (F11)"
              }
            >
              <Icon icon={isFullscreen ? "minimize" : "maximize"} size={16} />
            </button>
            <button className="full-results-close-button" onClick={handleClose}>
              <Icon icon="cross" size={16} />
            </button>
          </div>
        </div>

        <div className="full-results-content-container">
          <div
            className="full-results-main-content"
            style={{
              width: showChat ? `${mainContentWidth}%` : "100%",
              display: chatOnlyMode ? "none" : "flex",
            }}
          >
            {/* Query Management */}
            <QueryManager
              currentUserQuery={currentUserQuery}
              currentFormalQuery={currentFormalQuery}
              onQuerySelect={handleQuerySelect}
              disabled={isExecutingQuery}
              executionProgress={executionProgress}
            />

            {/* Enhanced Controls */}
            <div className="full-results-controls">
              <div className="full-results-filters-and-sorts">
                <div className="full-results-search-filters">
                  <InputGroup
                    leftIcon="search"
                    placeholder={
                      results.length > 300
                        ? "Search within blocks or page titles..."
                        : "Search within blocks/children or page titles..."
                    }
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="full-results-search-input"
                  />

                  <ReferencesFilterPopover
                    availableReferences={availableReferences}
                    includedReferences={includedReferences}
                    excludedReferences={excludedReferences}
                    onIncludeToggle={handleIncludeReference}
                    onExcludeToggle={handleExcludeReference}
                    onClearAll={handleClearAllReferences}
                  />
                </div>

                <div className="full-results-sort-controls">
                  <HTMLSelect
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="full-results-sort-select"
                  >
                    <option value="relevance">Sort: Relevance</option>
                    <option value="date">Sort: Date</option>
                    <option value="page">Sort: Page</option>
                    {viewMode !== "pages" && (
                      <>
                        <option value="content-alpha">
                          Sort: Content (A-Z)
                        </option>
                        <option value="content-length">
                          Sort: Content Length
                        </option>
                      </>
                    )}
                  </HTMLSelect>

                  <Button
                    icon={sortOrder === "desc" ? "sort-desc" : "sort-asc"}
                    onClick={() =>
                      setSortOrder(sortOrder === "desc" ? "asc" : "desc")
                    }
                    title={`Sort ${
                      sortOrder === "desc" ? "Descending" : "Ascending"
                    }`}
                  />

                  <Checkbox
                    checked={showMetadata}
                    onChange={() => setShowMetadata(!showMetadata)}
                    label="Metadata"
                    className="full-results-metadata-toggle"
                  />
                  {hasBlocks && (
                    <Checkbox
                      checked={showPaths}
                      onChange={() => setShowPaths(!showPaths)}
                      label="Path"
                      className="full-results-paths-toggle"
                    />
                  )}

                  <Button
                    icon={expanded ? "expand-all" : "collapse-all"}
                    onClick={handleExpandedToggle}
                    title={expanded ? "Collapse all" : "Expand all"}
                    minimal
                    small
                  />

                  {hasBlocks && hasPages && (
                    <HTMLSelect
                      value={viewMode}
                      onChange={(e) => setViewMode(e.target.value as any)}
                      className="full-results-view-mode-select"
                    >
                      <option value="mixed">All Types</option>
                      <option value="blocks">Blocks Only</option>
                      <option value="pages">Pages Only</option>
                    </HTMLSelect>
                  )}
                </div>
              </div>

              <div className="full-results-pagination-info">
                <span>
                  {filteredAndSortedResults.length} of {currentResults.length}{" "}
                  results
                </span>
                {selectedResults.size > 0 && (
                  <span className="full-results-selection-info">
                    ({selectedResults.size} selected)
                  </span>
                )}

                {/* Integrated Pagination Controls */}
                {totalPages > 1 && (
                  <div className="full-results-pagination-compact">
                    <Button
                      icon="chevron-left"
                      minimal
                      small
                      disabled={currentPage === 1}
                      onClick={() =>
                        setCurrentPage(Math.max(1, currentPage - 1))
                      }
                      title="Previous page"
                    />
                    <span className="full-results-page-info-compact">
                      {currentPage}/{totalPages}
                    </span>
                    <Button
                      icon="chevron-right"
                      minimal
                      small
                      disabled={currentPage === totalPages}
                      onClick={() =>
                        setCurrentPage(Math.min(totalPages, currentPage + 1))
                      }
                      title="Next page"
                    />
                    <HTMLSelect
                      value={resultsPerPage}
                      onChange={(e) =>
                        setResultsPerPage(Number(e.target.value))
                      }
                      className="full-results-per-page-compact"
                      minimal
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </HTMLSelect>
                  </div>
                )}
              </div>
            </div>

            {/* Results and Actions Container */}
            <div className="full-results-scrollable-content">
              {/* Results */}
              <div className="full-results-list">
                {paginatedResults && paginatedResults.length > 0 ? (
                  paginatedResults.map((result, index) => {
                    const originalIndex = currentResults.indexOf(result);
                    return (
                      <div
                        key={`${originalIndex}-${expanded}`}
                        className="full-results-result-item"
                        data-uid={result.uid}
                      >
                        <input
                          type="checkbox"
                          checked={selectedResults.has(originalIndex)}
                          onChange={() => handleCheckboxChange(index)}
                          className="full-results-checkbox"
                        />
                        <div className="full-results-block-container">
                          <ResultMetadata
                            result={result}
                            showMetadata={showMetadata}
                            sortBy={sortBy}
                            sortOrder={sortOrder}
                            onSortByDate={(order) => {
                              setSortBy("date");
                              setSortOrder(order);
                            }}
                          />
                          <ResultContent
                            result={result}
                            index={index}
                            pageDisplayMode={pageDisplayMode}
                            showPaths={showPaths}
                            searchFilter={searchFilter}
                            expanded={expanded}
                          />
                        </div>
                      </div>
                    );
                  })
                ) : filteredAndSortedResults.length === 0 ? (
                  <div className="full-results-no-results">
                    {searchFilter || pageFilter !== "all"
                      ? "No results match current filters"
                      : "No detailed results available"}
                  </div>
                ) : (
                  <div className="full-results-no-results">
                    No results on current page
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Resize Handle */}
          {showChat && !chatOnlyMode && (
            <div
              className="full-results-resize-handle"
              onMouseDown={handleResizeStart}
              title="Drag to resize"
            >
              <div className="resize-handle-bar"></div>
            </div>
          )}

          {/* Chat Panel */}
          {showChat && (
            <div
              className="full-results-chat-container"
              style={{
                width: chatOnlyMode ? "100%" : `${100 - mainContentWidth}%`,
              }}
            >
              <FullResultsChat
                isOpen={showChat}
                selectedResults={getSelectedResultsArray()}
                allResults={filteredAndSortedResults} // Pass filtered results to scope chat automatically
                paginatedResults={paginatedResults}
                privateMode={privateMode}
                targetUid={targetUid}
                onClose={() => toggleChat()}
                chatMessages={chatMessages}
                setChatMessages={setChatMessages}
                chatAccessMode={chatAccessMode}
                setChatAccessMode={setChatAccessMode}
                chatAgentData={chatAgentData}
                setChatAgentData={setChatAgentData}
                chatExpandedResults={chatExpandedResults}
                setChatExpandedResults={setChatExpandedResults}
                // Pagination props for cross-page navigation
                currentPage={currentPage}
                setCurrentPage={setCurrentPage}
                resultsPerPage={resultsPerPage}
                // View mode props for ((uid)) click handling
                chatOnlyMode={chatOnlyMode}
                handleChatOnlyToggle={handleChatOnlyToggle}
                // References filtering
                handleIncludeReference={handleIncludeReference}
              />
            </div>
          )}
        </div>

        {/* Action Bar - Outside content container */}
        <div className="full-results-action-bar">
          <div className="full-results-selection-controls">
            <label className="full-results-select-all-checkbox">
              <input
                type="checkbox"
                checked={
                  paginatedResults.length > 0 &&
                  paginatedResults.every((result) =>
                    selectedResults.has(currentResults.indexOf(result))
                  )
                }
                onChange={handleSelectAll}
                className="full-results-checkbox"
              />
              Page ({paginatedResults.length})
            </label>

            <Button
              text={`All Filtered (${filteredAndSortedResults.length})`}
              onClick={handleSelectAllResults}
              small
              minimal
              disabled={filteredAndSortedResults.length === 0}
            />

            {selectedResults.size > 0 && (
              <Button
                text="Clear Selection"
                onClick={() => setSelectedResults(new Set())}
                small
                minimal
                intent="warning"
              />
            )}
          </div>

          <div className="full-results-buttons-container">
            <DropdownButton
              mainText={
                targetUid ? "Append to last response" : "Append to today's DNP"
              }
              mainAction={handleInsertAtDNPEnd}
              disabled={selectedResults.size === 0}
              dropdownKey="insert"
              dropdownOptions={[
                {
                  text: "Open in Sidebar",
                  action: handleInsertInSidebar,
                },
              ]}
            />

            <DropdownButton
              mainText="Copy Embeds"
              mainAction={handleCopyEmbeds}
              disabled={selectedResults.size === 0}
              dropdownKey="copy"
              dropdownOptions={[
                {
                  text: "Copy References",
                  action: handleCopyReferences,
                },
              ]}
            />

            <Button
              text={showChat ? "Hide Chat" : "Chat"}
              onClick={toggleChat}
              intent={showChat ? "warning" : "success"}
              icon={showChat ? "cross" : "chat"}
              disabled={!canUseChat(privateMode, permissions) && !showChat}
              title={
                !canUseChat(privateMode, permissions)
                  ? "Requires Balanced or Full access mode"
                  : "Chat about selected results"
              }
            />

            <Button text="Close" onClick={handleClose} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default FullResultsPopup;

// Shared utility function for opening last Ask Your Graph results
// Used by both command palette and context menu
export const openLastAskYourGraphResults = () => {
  const lastResults = (window as any).lastAskYourGraphResults || [];

  // Import and use the popup function - open even with empty results
  import("../Toaster.js")
    .then(({ openFullResultsPopup }) => {
      if (openFullResultsPopup) {
        const targetUid = (window as any).lastAgentResponseTargetUid || null;
        const userQuery = (window as any).lastUserQuery || null;
        const formalQuery = (window as any).lastFormalQuery || null;
        openFullResultsPopup(lastResults, targetUid, userQuery, formalQuery);
      }
    })
    .catch(() => {
      // Fallback for environments where dynamic import doesn't work
      if (
        (window as any).LiveAI &&
        (window as any).LiveAI.openFullResultsPopup
      ) {
        (window as any).LiveAI.openFullResultsPopup(lastResults);
      } else {
        if (lastResults.length > 0) {
          alert(
            `Found ${lastResults.length} results, but popup functionality is not available. Results are stored in window.lastAskYourGraphResults`
          );
        } else {
          alert(
            "Opening full results popup - you can load previous queries from the query manager."
          );
        }
      }
    });
};

// Function to check if results are available (for conditional command display)
export const hasLastAskYourGraphResults = (): boolean => {
  const results = (window as any).lastAskYourGraphResults;
  return results && Array.isArray(results) && results.length > 0;
};

// Hook for easy usage
export const useFullResultsPopup = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  const openPopup = (resultsData: Result[]) => {
    setResults(resultsData);
    setIsOpen(true);
  };

  const closePopup = () => {
    setIsOpen(false);
    setResults([]);
  };

  return {
    isOpen,
    results,
    openPopup,
    closePopup,
    FullResultsPopup: (
      props: Omit<FullResultsPopupProps, "results" | "isOpen" | "onClose">
    ) => <FullResultsPopup {...props} results={results} isOpen={isOpen} />,
  };
};
