import React, { useState, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import {
  Button,
  HTMLSelect,
  InputGroup,
  Checkbox,
  Icon,
} from "@blueprintjs/core";
import { Select } from "@blueprintjs/select";
import { createChildBlock } from "../../utils/roamAPI.js";
import { FullResultsPopupProps, Result } from "./types";
import { FullResultsChat } from "./FullResultsChat";
import { ResultContent, ResultMetadata } from "./ResultRenderer";
import { useFullResultsState } from "./hooks/useFullResultsState";
import { canUseChat } from "./utils/chatHelpers";
import { ReferencesFilterPopover } from "./ReferencesFilterPopover";
import { QueryManager } from "./QueryManager";
import { StoredQuery } from "./utils/queryStorage";
import {
  UnifiedQuery,
  createSimpleQuery,
  storedQueryToUnified,
  unifiedQueryToStored,
} from "./types/QueryTypes";
import {
  executeQueryWithLiveUpdates,
  executeComposedQuery,
  executeComposedQueryParallel,
} from "../../ai/agents/search-agent/helpers/livePopupExecution";

const FullResultsPopup: React.FC<FullResultsPopupProps> = ({
  results,
  isOpen,
  title = "Ask your graph: full results view",
  targetUid,
  privateMode = false,
  permissions = { contentAccess: false },
  userQuery,
  formalQuery,
  forceOpenChat = false,
}) => {
  // Query execution state
  const [isExecutingQuery, setIsExecutingQuery] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<string>("");

  // Per-query progress tracking for composed queries
  const [queryProgress, setQueryProgress] = useState<
    Record<string, { status: string; count?: number }>
  >({});

  // Use internal state - initialize ONCE from props, NEVER sync after that
  const [currentResults, setCurrentResults] = useState<any[]>(results);

  const [pendingQueryExecution, setPendingQueryExecution] = useState<{
    query: StoredQuery;
    mode: "replace";
  } | null>(null);

  const [currentUserQuery, setCurrentUserQuery] = useState(userQuery);
  const [currentFormalQuery, setCurrentFormalQuery] = useState(formalQuery);

  // Execute composed query with visual feedback
  useEffect(() => {
    if (!pendingQueryExecution) return;

    const { query } = pendingQueryExecution;
    setPendingQueryExecution(null);

    console.log("🎯 [useEffect] Composed query execution triggered");

    const execute = async () => {
      try {
        console.log("🚀 [useEffect execute] Starting composed query execution");

        // Set initial progress message
        setExecutionProgress(`🔄 Running composed query: ${query.querySteps.length + 1} queries in parallel...`);

        // Initialize progress tracking for each query
        const initialProgress: Record<string, {status: string, count?: number}> = {};
        initialProgress['base'] = { status: '⏳ Queued...' };
        query.querySteps.forEach((_, i) => {
          initialProgress[`step${i + 1}`] = { status: '⏳ Queued...' };
        });
        setQueryProgress(initialProgress);

        // Execute with progress callbacks
        console.log("📞 [useEffect execute] Calling executeComposedQueryParallel");
        const finalResults = await executeComposedQueryParallel(query, {
          onProgress: (queryId: string, message: string) => {
            setQueryProgress(prev => ({
              ...prev,
              [queryId]: { status: message }
            }));
          },
          onQueryComplete: (queryId: string, results: any[], resultCount: number) => {
            setQueryProgress(prev => ({
              ...prev,
              [queryId]: { status: '✅ Completed', count: resultCount }
            }));
          },
          onAllComplete: (results: any[], summary: Array<{id: string, query: string, count: number}>, executionTime?: string, tokens?: any) => {
            const totalBefore = summary.reduce((sum, s) => sum + s.count, 0);
            let message = `✅ Composed query completed - ${results.length} results (from ${totalBefore} before deduplication)`;
            if (executionTime) {
              message += ` • ${executionTime}`;
            }
            if (tokens && (tokens.input_tokens > 0 || tokens.output_tokens > 0)) {
              message += ` • ${tokens.input_tokens + tokens.output_tokens} tokens`;
            }
            setExecutionProgress(message);
            setTimeout(() => {
              setExecutionProgress("");
              setQueryProgress({});
            }, 5000);
          },
          onError: (error: string) => {
            setExecutionProgress(`❌ Composed query failed: ${error}`);
            setQueryProgress({});
            setTimeout(() => setExecutionProgress(""), 5000);
          }
        });

        console.log("✅ [useEffect execute] Execute Complete -", finalResults.length, "results");
        console.log("📝 [useEffect execute] Setting currentResults to", finalResults.length, "results");

        // Update ALL state at once AFTER execution completes
        setCurrentResults(finalResults);
        setCurrentUserQuery(query.userQuery);
        setCurrentFormalQuery(query.formalQuery);
        (window as any).lastAskYourGraphResults = finalResults;
        console.log("✓ [useEffect execute] All state updated, clearing isExecutingQuery");
        setIsExecutingQuery(false);
      } catch (error) {
        console.error("Execution failed:", error);
        setExecutionProgress(`❌ Execution error: ${error instanceof Error ? error.message : String(error)}`);
        setQueryProgress({});
        setTimeout(() => setExecutionProgress(""), 5000);
        setIsExecutingQuery(false);
      }
    };

    execute();
  }, [pendingQueryExecution]);

  // Store the currently active query with full structure (eliminates need for storage lookups)
  // This is the SOURCE OF TRUTH for the current query
  const [currentActiveQuery, setCurrentActiveQuery] =
    useState<StoredQuery | null>(null);

  // Track temporary composed query (before saving to permanent storage)
  const [tempComposedQuery, setTempComposedQuery] =
    useState<StoredQuery | null>(null);

  // Track if we're currently composing to prevent duplicate compositions
  const [isComposingNow, setIsComposingNow] = useState(false);

  // Ref to track the last loaded query - persists and doesn't get cleared like loadedQuery state
  // This allows us to preserve the full query structure when executing via Run button
  const lastLoadedQueryRef = useRef<StoredQuery | null>(null);

  // Clear temporary storage when popup opens to prevent accumulation
  React.useEffect(() => {
    if (isOpen) {
      // Clear React state for temporary composed query
      setTempComposedQuery(null);

      // Clear ALL window query state that might cause accumulation
      delete (window as any).__currentComposedQuery;
      delete (window as any).__currentComposedQueryId;
      delete (window as any).__originalQueryForComposition;
      delete (window as any).lastUserQuery;
      delete (window as any).lastFormalQuery;
      delete (window as any).lastIntentParserResult;
      delete (window as any).lastAskYourGraphResults;
      delete (window as any).previousUserQuery;
      delete (window as any).previousFormalQuery;
      delete (window as any).previousIntentParserResult;
      delete (window as any).lastAgentResponseTargetUid;
      console.log(
        "🧹 [FullResultsPopup] Cleared ALL temporary storage on popup open"
      );
    }
  }, [isOpen]);

  // Two-section composition UI state
  // External state management for query composition (accessed by multiple modules)
  const [originalQueryForComposition, setOriginalQueryForComposition] =
    useState<
      | UnifiedQuery
      | StoredQuery
      | {
          userQuery: string;
          formalQuery: string;
        }
      | null
    >(null);

  // Convert originalQueryForComposition to UnifiedQuery
  const originalQueryAsUnified: UnifiedQuery | null = React.useMemo(() => {
    if (!originalQueryForComposition) return null;

    if (
      "isComposed" in originalQueryForComposition &&
      typeof originalQueryForComposition.isComposed === "boolean"
    ) {
      // It's already a UnifiedQuery (has required isComposed boolean)
      return originalQueryForComposition as UnifiedQuery;
    } else if ("id" in originalQueryForComposition) {
      // It's a StoredQuery
      return storedQueryToUnified(originalQueryForComposition as StoredQuery);
    } else {
      // It's a simple object with userQuery and formalQuery
      return createSimpleQuery(
        originalQueryForComposition.userQuery,
        originalQueryForComposition.formalQuery
      );
    }
  }, [originalQueryForComposition]);

  // Convert current user/formal query to UnifiedQuery with composed query detection
  const [currentQueryAsUnified, setCurrentQueryAsUnified] =
    useState<UnifiedQuery | null>(null);

  React.useEffect(() => {
    const updateCurrentQuery = async () => {
      if (!currentUserQuery?.trim()) {
        setCurrentQueryAsUnified(null);
        return;
      }

      // Priority 1: Use currentActiveQuery (SOURCE OF TRUTH)
      if (currentActiveQuery) {
        setCurrentQueryAsUnified(storedQueryToUnified(currentActiveQuery));
        return;
      }

      // Priority 2: Use tempComposedQuery (for just-composed queries)
      if (
        tempComposedQuery &&
        tempComposedQuery.userQuery === currentUserQuery
      ) {
        setCurrentQueryAsUnified(storedQueryToUnified(tempComposedQuery));
        return;
      }

      // Priority 3: Fall back to storage lookup
      try {
        const { getStoredQueries } = await import("./utils/queryStorage");
        const queries = getStoredQueries();
        const allQueries = [...queries.recent, ...queries.saved];
        const matchingComposedQuery = allQueries.find(
          (q) => q.userQuery === currentUserQuery && q.isComposed
        );

        if (matchingComposedQuery) {
          setCurrentQueryAsUnified(storedQueryToUnified(matchingComposedQuery));
          return;
        }
      } catch (error) {
        console.warn("Could not check for composed query:", error);
      }

      // Default to simple query
      setCurrentQueryAsUnified(
        createSimpleQuery(
          currentUserQuery,
          currentFormalQuery || currentUserQuery
        )
      );
    };

    updateCurrentQuery();
  }, [
    currentUserQuery,
    currentFormalQuery,
    currentActiveQuery,
    tempComposedQuery,
  ]);

  const [loadedQuery, setLoadedQuery] = useState<StoredQuery | null>(null);
  const [originalLoadedQuery, setOriginalLoadedQuery] = useState<StoredQuery | null>(null); // Track original before edits

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
    forceUIRefresh,
    handleClose,
    toggleChat,
    handleIncludeReference,
    handleExcludeReference,
    handleClearAllReferences,
    resetChatConversation,
    handleExpandedToggle,

    // Query Composer state and handlers
    composerQuery,
    isComposingQuery,
    setComposerQuery,
    handleComposerExecute,

    // Direct Content Selector state and handlers
    selectedPages,
    includePageContent,
    includeLinkedRefs,
    dnpPeriod,
    isAddingDirectContent,
    availablePages,
    isLoadingPages,
    currentPageContext,
    setSelectedPages,
    setIncludePageContent,
    setIncludeLinkedRefs,
    setDNPPeriod,
    handleDirectContentAdd,
    queryAvailablePages,
  } = useFullResultsState(currentResults, isOpen, forceOpenChat, targetUid);

  // Query selection handler
  // Clear all results and query context for fresh start
  const handleClearAll = () => {
    console.log(
      "🧹 [FullResultsPopup] Clearing all - results and query context"
    );

    // Clear results
    setCurrentResults([]);

    // Clear query context
    setCurrentUserQuery("");
    setCurrentFormalQuery("");

    // Clear composition context
    setOriginalQueryForComposition(null);
    setLoadedQuery(null);
    setOriginalLoadedQuery(null);
    setTempComposedQuery(null);

    // Clear ALL window query state that can cause accumulation
    delete (window as any).__currentComposedQuery;
    delete (window as any).__currentComposedQueryId;
    delete (window as any).__originalQueryForComposition;
    delete (window as any).lastUserQuery;
    delete (window as any).lastFormalQuery;
    delete (window as any).lastIntentParserResult;
    delete (window as any).lastAskYourGraphResults;
    delete (window as any).previousUserQuery;
    delete (window as any).previousFormalQuery;
    delete (window as any).previousIntentParserResult;
    delete (window as any).lastAgentResponseTargetUid;

    // Clear composer state
    setComposerQuery("");

    // Clear execution state
    setExecutionProgress("");

    forceUIRefresh();
    resetChatConversation();
  };

  const handleQuerySelect = async (query: StoredQuery | "current") => {
    if (query === "current") {
      // Reset to original results with full state clearing
      setCurrentResults(results);
      setCurrentUserQuery(userQuery);
      setCurrentFormalQuery(formalQuery);
      setExecutionProgress("");
      resetChatConversation(); // Reset chat when switching back to original query

      // Clear composition context
      setOriginalQueryForComposition(null);
      setLoadedQuery(null);

      // DON'T clear currentComposedQuery automatically - it should preserve if current query is actually composed
      // Only clear it if userQuery/formalQuery don't match any composed query
      // This preserves the composed query structure when returning to "current"

      // Clear all UI state to ensure clean display
      forceUIRefresh();
      return;
    }

    // If we currently have an active query, don't execute immediately - set up for composition
    if (currentUserQuery && currentUserQuery.trim()) {
      // Check if there's a current composed query that should be preserved entirely
      let originalQueryInfo:
        | UnifiedQuery
        | StoredQuery
        | { userQuery: string; formalQuery: string };

      // Priority 1: Use currentQueryAsUnified if it's already composed
      if (currentQueryAsUnified && currentQueryAsUnified.isComposed) {
        originalQueryInfo = currentQueryAsUnified;
      }
      // Priority 2: Check storage for composed query matching current userQuery
      else {
        const { getStoredQueries } = await import("./utils/queryStorage");
        const queries = getStoredQueries();
        const allQueries = [...queries.recent, ...queries.saved];
        const currentStoredQuery = allQueries.find(
          (q) => q.userQuery === currentUserQuery && q.isComposed
        );

        if (currentStoredQuery) {
          originalQueryInfo = storedQueryToUnified(currentStoredQuery);
        } else {
          originalQueryInfo = {
            userQuery: currentUserQuery,
            formalQuery: currentFormalQuery,
          };
        }
      }

      // Store the original query information and loaded query for two-section UI
      setOriginalQueryForComposition(originalQueryInfo);
      setLoadedQuery(query);

      // Clear tempComposedQuery to prevent it from being used incorrectly
      // (tempComposedQuery is only valid immediately after composition, not when loading new queries)
      setTempComposedQuery(null);

      // Store the FULL original query (composed or simple) for composition logic
      (window as any).__originalQueryForComposition = originalQueryInfo;

      return; // Don't execute the query yet - wait for "Add to results"
    }

    // If no current results, execute the stored query normally
    setIsExecutingQuery(true);
    setExecutionProgress("Running query with Ask your Graph agent...");

    // Store the FULL query structure as the current active query (SOURCE OF TRUTH)
    setCurrentActiveQuery(query);
    setCurrentUserQuery(query.userQuery);
    setCurrentFormalQuery(query.formalQuery);

    console.log("🚀 [FullResultsPopup] Executing stored query:", {
      userQuery: query.userQuery,
      isComposed: query.isComposed,
      queryStepsLength: query.querySteps?.length || 0,
      willUseComposedExecution: query.isComposed && query.querySteps.length > 0,
    });

    // Clear all state immediately when starting new query to ensure clean UI
    setCurrentResults([]);
    forceUIRefresh();
    resetChatConversation(); // Reset chat when executing a new stored query

    try {
      // Check if this is a composed query that needs multi-step execution
      if (query.isComposed && query.querySteps.length > 0) {
        console.log(
          "🚀 [handleQuerySelect] Scheduling parallel execution for composed query:",
          {
            isComposed: query.isComposed,
            queryStepsLength: query.querySteps.length,
            baseQuery: query.userQuery,
            steps: query.querySteps.map((s) => s.userQuery),
          }
        );

        // Use the parallel execution via effect (same as onExecuteQuery path)
        setPendingQueryExecution({ query, mode: "replace" });
        console.log(
          "✅ [handleQuerySelect] setPendingQueryExecution called, returning early"
        );
        return; // Exit early - effect will handle execution
      }

      // Simple query - execute normally
      console.log("📝 [handleQuerySelect] Simple query - executing directly");
      await executeQueryWithLiveUpdates({
        intentParserResult: query.intentParserResult!,
        userQuery: query.userQuery,
        formalQuery: query.formalQuery,
        onProgress: (message: string) => {
          setExecutionProgress(`🔍 ${message}`);
        },
        onResults: (partialResults: any[], isPartial?: boolean) => {
          if (!isPartial) {
            setCurrentResults(partialResults);
          }
        },
        onComplete: (finalResults: any[], executionTime?: string, tokens?: any) => {
          setCurrentResults(finalResults);
          let message = `✅ Query completed - ${finalResults.length} results found`;
          if (executionTime) {
            message += ` • ${executionTime}`;
          }
          if (tokens && (tokens.input_tokens > 0 || tokens.output_tokens > 0)) {
            message += ` • ${tokens.input_tokens + tokens.output_tokens} tokens`;
          }
          setExecutionProgress(message);
          setTimeout(() => setExecutionProgress(""), 5000);
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
          <div className="full-results-simple-dropdown-menu bp3-menu">
            {dropdownOptions.map((option, idx) => (
              <button
                key={idx}
                className="full-results-simple-dropdown-item bp3-menu-item"
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
        className={`bp3-dialog full-results-modal ${
          showChat ? "chat-open" : ""
        } ${chatOnlyMode ? "chat-only" : ""} ${
          isFullscreen ? "fullscreen" : ""
        } ${isResizing ? "resizing" : ""}`}
      >
        <div className="full-results-header bp3-dialog-header">
          <h3 className="full-results-title bp3-heading">{title}</h3>
          <div className="full-results-header-controls">
            {showChat && (
              <button
                className="full-results-control-button bp3-button bp3-minimal"
                onClick={handleChatOnlyToggle}
                title={chatOnlyMode ? "Show results" : "Chat only"}
              >
                <Icon icon={chatOnlyMode ? "chart" : "chat"} size={16} />
              </button>
            )}
            <button
              className="full-results-control-button bp3-button bp3-minimal"
              onClick={handleFullscreenToggle}
              title={
                isFullscreen ? "Exit fullscreen (ESC)" : "Fullscreen (F11)"
              }
            >
              <Icon icon={isFullscreen ? "minimize" : "maximize"} size={16} />
            </button>
            <button
              className="full-results-close-button bp3-button bp3-minimal bp3-dialog-close-button"
              onClick={handleClose}
            >
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
            <div className="query-manager-container">
              <div className="query-manager-wrapper">
                <QueryManager
                  currentQuery={currentQueryAsUnified}
                  onQuerySelect={handleQuerySelect}
                  onQueryLoadedIntoComposer={(query: StoredQuery, forceResetOriginal?: boolean) => {
                    console.log("📥 [onQueryLoadedIntoComposer] Loading query into composer:", {
                      userQuery: query.userQuery,
                      isComposed: query.isComposed,
                      stepsCount: query.querySteps?.length || 0,
                      id: query.id,
                      forceResetOriginal,
                    });
                    console.log("📥 [onQueryLoadedIntoComposer] Setting lastLoadedQueryRef and loadedQuery state");
                    lastLoadedQueryRef.current = query;
                    setLoadedQuery(query);
                    // Track original query for detecting edits (only if not already editing)
                    if (forceResetOriginal || !originalLoadedQuery || originalLoadedQuery.id !== query.id) {
                      setOriginalLoadedQuery(query);
                    }
                    console.log("📥 [onQueryLoadedIntoComposer] State updated");
                  }}
                  disabled={isExecutingQuery}
                  executionProgress={executionProgress}
                  queryProgress={queryProgress}
                  onQueriesUpdate={() => {
                    // Refresh mechanism enabled
                  }}
                  onClearAll={handleClearAll}
                  // Two-section composition UI
                  originalQueryForComposition={originalQueryAsUnified}
                  loadedQuery={loadedQuery}
                  originalLoadedQuery={originalLoadedQuery}
                  tempComposedQuery={tempComposedQuery}
                  // Query Composer props
                  composerQuery={composerQuery}
                  isComposingQuery={isComposingQuery}
                  onQueryChange={setComposerQuery}
                  onExecuteQuery={async (
                    mode: "add" | "replace",
                    model?: string
                  ) => {
                    // Prevent concurrent executions
                    if (isExecutingQuery) {
                      console.warn(
                        "⚠️ [FullResultsPopup] Query already executing, skipping"
                      );
                      return;
                    }

                    setIsExecutingQuery(true);

                    try {
                      // IMPORTANT: Check if we're executing a loaded composed query
                      const queryToExecute = lastLoadedQueryRef.current;

                      console.log("🔎 [New Query Button] Checking execution path:", {
                        mode,
                        hasQueryToExecute: !!queryToExecute,
                        queryToExecuteUserQuery: queryToExecute?.userQuery,
                        composerQuery,
                        queriesMatch: queryToExecute?.userQuery === composerQuery,
                        isComposed: queryToExecute?.isComposed,
                        stepsCount: queryToExecute?.querySteps?.length || 0,
                      });

                      if (
                        mode === "replace" &&
                        queryToExecute &&
                        (queryToExecute.userQuery === composerQuery || (!composerQuery.trim() && loadedQuery))
                      ) {
                        // This is a loaded query being executed (either matches composer or loaded without composer text)
                        console.log(
                          "✅ [FullResultsPopup] Executing loaded query:",
                          {
                            userQuery: queryToExecute.userQuery,
                            isComposed: queryToExecute.isComposed,
                            stepsCount: queryToExecute.querySteps?.length || 0,
                          }
                        );

                        setCurrentActiveQuery(queryToExecute);

                        // Check if it's a composed query that needs multi-step execution
                        if (
                          queryToExecute.isComposed &&
                          queryToExecute.querySteps.length > 0
                        ) {
                          console.log(
                            "🚀 [FullResultsPopup] Scheduling COMPOSED query execution in effect:",
                            {
                              querySteps: queryToExecute.querySteps.length,
                              currentResultsLength: currentResults.length,
                            }
                          );

                          // Clear results and set progress BEFORE execution starts
                          setExecutionProgress(`🔄 Preparing composed query: ${queryToExecute.querySteps.length + 1} queries...`);
                          console.log("🧹 [FullResultsPopup] Clearing results before composed execution");
                          setCurrentResults([]);
                          forceUIRefresh(); // Force immediate UI update to show empty state

                          // Clear state
                          setOriginalQueryForComposition(null);
                          setLoadedQuery(null);
                          lastLoadedQueryRef.current = null;

                          // Trigger execution in effect (allows React to re-render between updates)
                          console.log("⚡ [FullResultsPopup] Setting pendingQueryExecution to trigger useEffect");
                          setPendingQueryExecution({
                            query: queryToExecute,
                            mode: "replace",
                          });

                          return; // Don't continue with normal execution
                        }
                      } else if (mode === "replace") {
                        setCurrentActiveQuery(null);
                        lastLoadedQueryRef.current = null;
                      }

                      // For replace mode, clear results immediately to show empty state
                      if (mode === "replace") {
                        setOriginalQueryForComposition(null);
                        setLoadedQuery(null);
                        delete (window as any).__originalQueryForComposition;
                        delete (window as any).lastUserQuery;
                        delete (window as any).lastFormalQuery;
                        delete (window as any).lastIntentParserResult;
                        delete (window as any).previousUserQuery;
                        delete (window as any).previousFormalQuery;
                        delete (window as any).previousIntentParserResult;
                        delete (window as any).lastAgentResponseTargetUid;

                        setCurrentResults([]);
                        forceUIRefresh(); // Force immediate UI update to show empty state
                      }

                      // Set execution progress for simple queries
                      const queryText = composerQuery.trim() || queryToExecute?.userQuery || '';
                      setExecutionProgress(`🔄 Executing query: ${queryText.substring(0, 50)}${queryText.length > 50 ? '...' : ''}`);

                      const newResults = await handleComposerExecute(
                        currentResults,
                        mode,
                        model,
                        queryText // Pass the query text (either from composer or loaded query)
                      );

                      if (newResults && newResults.length > 0) {
                        // Update current query context with the executed query
                        if (mode === "replace") {
                          const executedQuery = composerQuery.trim() || queryToExecute?.userQuery || '';
                          setCurrentUserQuery(executedQuery);
                          setCurrentFormalQuery(executedQuery);

                          // Clear loadedQuery since it's now the active query
                          if (loadedQuery) {
                            setLoadedQuery(null);
                          }

                          setCurrentResults([...newResults]);
                          // Force refresh AFTER setting new results
                          forceUIRefresh();
                        } else {
                          // Add mode - combine with existing AND create composed query
                          const existingUids = new Set(
                            currentResults.map((r) => r.uid)
                          );
                          const uniqueNewResults = newResults.filter(
                            (r) => !existingUids.has(r.uid)
                          );
                          setCurrentResults([
                            ...currentResults,
                            ...uniqueNewResults,
                          ]);

                          // Create composed query if there's a current query
                          if (currentQueryAsUnified && !isComposingNow) {
                            console.log(
                              "🔍 [FullResultsPopup] Checking for duplicate before composition:",
                              {
                                composerQuery,
                                currentSteps:
                                  currentQueryAsUnified.querySteps?.map(
                                    (s) => s.userQuery
                                  ) || [],
                                isComposed: currentQueryAsUnified.isComposed,
                              }
                            );

                            // Check if we're already adding this exact query (prevent duplicates)
                            const alreadyHasThisStep =
                              currentQueryAsUnified.querySteps?.some(
                                (step) => step.userQuery === composerQuery
                              );

                            if (alreadyHasThisStep) {
                              console.warn(
                                "⚠️ [FullResultsPopup] Query already in steps, skipping composition:",
                                composerQuery
                              );
                            } else {
                              setIsComposingNow(true); // Set flag to prevent re-entry

                              console.log(
                                "🔗 [FullResultsPopup] Creating composed query from:",
                                {
                                  current: currentQueryAsUnified.userQuery,
                                  additional: composerQuery,
                                  currentSteps:
                                    currentQueryAsUnified.querySteps?.length ||
                                    0,
                                }
                              );

                              const { composeQueries } = await import(
                                "./utils/queryStorage"
                              );
                              const currentIntentParser = (window as any)
                                .lastIntentParserResult;

                              // Check if we're adding a loaded query (which may be composed) or a typed query
                              let additionalQueryToCompose: any;

                              if (
                                loadedQuery &&
                                (loadedQuery.userQuery === composerQuery || !composerQuery.trim())
                              ) {
                                // We're adding a loaded query - use its full structure (may include steps)
                                console.log(
                                  "📚 [FullResultsPopup] Adding loaded query with full structure:",
                                  {
                                    userQuery: loadedQuery.userQuery,
                                    isComposed: loadedQuery.isComposed,
                                    steps: loadedQuery.querySteps?.length || 0,
                                    hasIntentParserResult:
                                      !!loadedQuery.intentParserResult,
                                  }
                                );
                                additionalQueryToCompose = loadedQuery;
                              } else {
                                // We're adding a typed query - create simple step
                                console.log(
                                  "✏️ [FullResultsPopup] Adding typed query as simple step"
                                );
                                additionalQueryToCompose = {
                                  userQuery: composerQuery,
                                  formalQuery:
                                    currentIntentParser?.formalQuery ||
                                    composerQuery,
                                  intentParserResult: currentIntentParser,
                                };
                              }

                              // Convert UnifiedQuery to StoredQuery format for composition
                              const baseQueryForComposition =
                                unifiedQueryToStored(currentQueryAsUnified);

                              // Compose with current query
                              const composedQuery = composeQueries(
                                baseQueryForComposition,
                                additionalQueryToCompose
                              );

                              console.log(
                                "🔗 [FullResultsPopup] Composed query:",
                                {
                                  userQuery: composedQuery.userQuery,
                                  stepsCount:
                                    composedQuery.querySteps?.length || 0,
                                  isComposed: composedQuery.isComposed,
                                }
                              );

                              // Store in React state as temporary composed query
                              const tempQuery = {
                                ...composedQuery,
                                id: `temp_${Date.now()}`,
                                timestamp: new Date(),
                              };

                              // Set the composed query as the current active query (SOURCE OF TRUTH)
                              setCurrentActiveQuery(tempQuery);
                              setTempComposedQuery(tempQuery);
                              setCurrentUserQuery(composedQuery.userQuery);
                              setCurrentFormalQuery(composedQuery.formalQuery);

                              // Add to recent queries
                              const { getStoredQueries, saveQueries } =
                                await import("./utils/queryStorage");
                              const queries = getStoredQueries();
                              queries.recent = [
                                tempQuery,
                                ...queries.recent,
                              ].slice(0, 10);
                              saveQueries(queries);

                              console.log(
                                "✅ [FullResultsPopup] Composed query created and set as currentActiveQuery:",
                                {
                                  id: tempQuery.id,
                                  steps: tempQuery.querySteps?.length || 0,
                                }
                              );

                              // Clear the loaded query and composition context to switch UI to composed view
                              setLoadedQuery(null);
                              setOriginalQueryForComposition(null);

                              // Reset composing flag after a short delay to prevent immediate re-entry
                              setTimeout(() => setIsComposingNow(false), 100);
                            }
                          } else if (!currentQueryAsUnified) {
                            console.log(
                              "ℹ️ [FullResultsPopup] No current query - just adding results without composition"
                            );
                          }

                          forceUIRefresh();
                        }
                      }

                      // Clear progress message after successful execution
                      setExecutionProgress(`✅ Query completed - ${newResults?.length || 0} results`);
                      setTimeout(() => setExecutionProgress(""), 3000);
                    } finally {
                      setIsExecutingQuery(false);
                    }
                  }}
                  // Direct Content Selector props
                  selectedPages={selectedPages}
                  includePageContent={includePageContent}
                  includeLinkedRefs={includeLinkedRefs}
                  dnpPeriod={dnpPeriod}
                  isAddingDirectContent={isAddingDirectContent}
                  availablePages={availablePages}
                  isLoadingPages={isLoadingPages}
                  currentPageContext={currentPageContext}
                  // Direct Content Selector handlers
                  setSelectedPages={setSelectedPages}
                  setIncludePageContent={setIncludePageContent}
                  setIncludeLinkedRefs={setIncludeLinkedRefs}
                  setDNPPeriod={setDNPPeriod}
                  handleDirectContentAdd={handleDirectContentAdd}
                  queryAvailablePages={queryAvailablePages}
                  // Results management
                  currentResults={currentResults}
                  setCurrentResults={setCurrentResults}
                  // External state management callback
                  onOriginalQueryForCompositionChange={(query) => {
                    console.log(
                      "🔄 [FullResultsPopup] QueryManager updating original query state:",
                      query
                    );
                    setOriginalQueryForComposition(query);
                  }}
                />
              </div>
            </div>

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
                        className="full-results-result-item bp3-card"
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
        <div className="full-results-action-bar bp3-dialog-footer">
          <div className="full-results-selection-controls">
            <label className="full-results-select-all-checkbox bp3-control bp3-checkbox">
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
              <span className="bp3-control-indicator"></span>
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
        // Only use window query state if there are actual results, otherwise use null
        // This prevents stale query state from appearing when opening popup fresh
        const hasActualResults = lastResults && lastResults.length > 0;
        const userQuery = hasActualResults
          ? (window as any).lastUserQuery || null
          : null;
        const formalQuery = hasActualResults
          ? (window as any).lastFormalQuery || null
          : null;
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
