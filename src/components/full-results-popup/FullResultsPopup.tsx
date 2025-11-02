import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Button,
  HTMLSelect,
  InputGroup,
  Checkbox,
  Icon,
  Popover,
  Menu,
  MenuItem,
  Tooltip,
} from "@blueprintjs/core";

import { createChildBlock } from "../../utils/roamAPI.js";
import { FullResultsPopupProps, Result } from "./types/types.js";
import { FullResultsChat } from "./components/chat/FullResultsChat";
import {
  ResultContent,
  ResultMetadata,
} from "./components/results/ResultRenderer";
import { useFullResultsState } from "./hooks/useFullResultsState";
import { canUseChat, getSelectedResultsList } from "./utils/chatHelpers";
import { ReferencesFilterPopover } from "./components/results/ReferencesFilterPopover";
import { QueryManager } from "./components/query-manager/QueryManager";
import {
  StoredQuery,
  getStoredQueries,
  composeQueries,
  saveQueries,
} from "./utils/queryStorage";
import {
  updateWindowQueryStorage,
  captureWindowQueryState,
} from "./utils/windowStorage";
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
import { executeStoredPageSelections } from "./utils/directContentHandler";
import { ProgressMessages } from "./utils/progressMessages";
import {
  replaceByFirstChildren,
  addLinkedReferences,
  addMentionedPages,
  addMentionedPagesAndLinkedRefs,
  deduplicateResults,
} from "./utils/expandResults";

const FullResultsPopup: React.FC<FullResultsPopupProps> = ({
  results,
  isOpen,
  title = "Ask your graph: full results view",
  targetUid,
  privateMode = false,
  permissions = { contentAccess: false },
  userQuery,
  formalQuery,
  intentParserResult,
  forceOpenChat = false,
  initialChatMessages,
  initialChatPrompt,
  initialChatModel,
  initialLoadedChatUid,
  initialStyle,
  initialCommandId,
  initialCommandPrompt,
}) => {
  // Query execution state
  const [isExecutingQuery, setIsExecutingQuery] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<string>("");

  // Per-query progress tracking for composed queries
  const [queryProgress, setQueryProgress] = useState<
    Record<string, { status: string; count?: number }>
  >({});

  // Side panel mode state with localStorage persistence
  const [isSidePanelMode, setIsSidePanelMode] = useState(() => {
    const saved = localStorage.getItem("fullResultsPopup_sidePanelMode");
    return saved === "true";
  });

  const [sidePanelWidth, setSidePanelWidth] = useState(() => {
    const saved = localStorage.getItem("fullResultsPopup_sidePanelWidth");
    return saved ? parseInt(saved, 10) : 500;
  });

  const [sidePanelHeight, setSidePanelHeight] = useState(() => {
    const saved = localStorage.getItem("fullResultsPopup_sidePanelHeight");
    return saved ? parseInt(saved, 10) : 400;
  });

  const [sidePanelPosition, setSidePanelPosition] = useState<
    "right" | "left" | "bottom"
  >(() => {
    const saved = localStorage.getItem("fullResultsPopup_sidePanelPosition");
    return (saved as "right" | "left" | "bottom") || "right";
  });

  const [isResizingSidePanel, setIsResizingSidePanel] = useState(false);

  // Temporary message state for expand actions
  const [tempMessage, setTempMessage] = useState<string | null>(null);

  // Layout mode state: "split" (A), "results-only" (B), "chat-only" (C)
  const [layoutMode, setLayoutMode] = useState<
    "split" | "results-only" | "chat-only"
  >(() => {
    // Determine initial layout based on what content is available
    const hasResults = results && results.length > 0;
    const shouldOpenChat = forceOpenChat;

    // If we have results but chat is forced open, use split or chat-only based on saved preference
    if (hasResults && shouldOpenChat) {
      const saved = localStorage.getItem("fullResultsPopup_layoutMode");
      // Prefer split if available, otherwise use saved
      if (saved === "results-only") return "split"; // Override results-only when chat is forced
      return (saved as "split" | "chat-only") || "split";
    }

    // If only chat is requested (no results), force chat-only
    if (!hasResults && shouldOpenChat) {
      return "chat-only";
    }

    // If only results (no chat), use results-only or split
    if (hasResults && !shouldOpenChat) {
      const saved = localStorage.getItem("fullResultsPopup_layoutMode");
      // Don't use chat-only mode when we have results but chat is not requested
      if (saved === "chat-only") return "results-only";
      return (saved as "split" | "results-only") || "results-only";
    }

    // Fallback: check saved preference or use split
    const saved = localStorage.getItem("fullResultsPopup_layoutMode");
    if (saved) return saved as "split" | "results-only" | "chat-only";

    // Initialize from legacy chatOnlyMode state for backward compatibility
    const legacyChatOnly = localStorage.getItem(
      "fullResultsPopup_chatOnlyMode"
    );
    if (legacyChatOnly === "true") return "chat-only";

    return "split";
  });

  // Track dialog/panel width for responsive layout constraints
  const [dialogWidth, setDialogWidth] = useState<number>(0);
  const dialogRef = useRef<HTMLDivElement>(null);

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

    const execute = async () => {
      try {
        // Set initial progress message
        setExecutionProgress(
          `🔄 Running composed query: ${
            query.querySteps.length + 1
          } queries in parallel...`
        );

        // Initialize progress tracking for each query
        const initialProgress: Record<
          string,
          { status: string; count?: number }
        > = {};
        initialProgress["base"] = { status: "⏳ Queued..." };
        query.querySteps.forEach((_, i) => {
          initialProgress[`step${i + 1}`] = { status: "⏳ Queued..." };
        });
        setQueryProgress(initialProgress);

        // Execute with progress callbacks

        const finalResults = await executeComposedQueryParallel(query, {
          onProgress: (queryId: string, message: string) => {
            setQueryProgress((prev) => ({
              ...prev,
              [queryId]: { status: message },
            }));
          },
          onQueryComplete: (
            queryId: string,
            results: any[],
            resultCount: number
          ) => {
            setQueryProgress((prev) => ({
              ...prev,
              [queryId]: { status: "✅ Completed", count: resultCount },
            }));
          },
          onAllComplete: async (
            results: any[],
            summary: Array<{ id: string; query: string; count: number }>,
            executionTime?: string,
            tokens?: any
          ) => {
            const totalBefore = summary.reduce((sum, s) => sum + s.count, 0);
            let message = ProgressMessages.composedQueryComplete(
              results.length,
              totalBefore,
              executionTime,
              tokens
            );
            setExecutionProgress(message);

            // Execute page selections if they exist in the query
            if (query.pageSelections && query.pageSelections.length > 0) {
              const pageSelectionResult = await executeStoredPageSelections(
                query.pageSelections,
                results,
                (progressMsg) => setExecutionProgress(progressMsg)
              );

              // Update results with page selection results
              setCurrentResults(pageSelectionResult.finalResults);

              // Update final message with page selections info
              message = ProgressMessages.pageSelectionComplete(
                pageSelectionResult.finalResults.length,
                results.length,
                pageSelectionResult.addedCount
              );
              if (executionTime) {
                message += ` • ${executionTime}`;
              }
              if (
                tokens &&
                (tokens.input_tokens > 0 || tokens.output_tokens > 0)
              ) {
                message += ` • ${
                  tokens.input_tokens + tokens.output_tokens
                } tokens`;
              }
              setExecutionProgress(message);
            }

            setTimeout(() => {
              setExecutionProgress("");
              setQueryProgress({});
            }, 6000);
          },
          onError: (error: string) => {
            setExecutionProgress(ProgressMessages.composedQueryFailed(error));
            setQueryProgress({});
            setTimeout(() => setExecutionProgress(""), 6000);
          },
        });

        // Update ALL state at once AFTER execution completes
        setCurrentResults(finalResults);
        setCurrentUserQuery(query.userQuery);
        setCurrentFormalQuery(query.formalQuery);

        // Update window storage with complete query structure
        // This ensures reopening popup shows this query with all its steps/pageSelections
        updateWindowQueryStorage(finalResults, query, targetUid);

        setIsExecutingQuery(false);
      } catch (error) {
        console.error("Execution failed:", error);
        setExecutionProgress(
          ProgressMessages.executionError(
            error instanceof Error ? error.message : String(error)
          )
        );
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

  // Capture and preserve complete window query state before clearing
  // This ensures we can restore full state (including steps/pageSelections) when reopening
  const [preservedQueryState] = React.useState(() => {
    return captureWindowQueryState();
  });

  // Clear ONLY temporary composition storage when popup opens
  // DO NOT clear lastAskYourGraphResults and lastQuery - they should persist across open/close cycles!
  React.useEffect(() => {
    if (isOpen) {
      // Clear React state for temporary composed query
      setTempComposedQuery(null);

      // Clear ONLY composition-related temporary storage (not the main query/results storage)
      delete (window as any).__currentComposedQuery;
      delete (window as any).__currentComposedQueryId;
      delete (window as any).__originalQueryForComposition;
      delete (window as any).previousUserQuery;
      delete (window as any).previousFormalQuery;
      delete (window as any).previousIntentParserResult;
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
  const [originalLoadedQuery, setOriginalLoadedQuery] =
    useState<StoredQuery | null>(null); // Track original before edits

  // Handler to add results from agent tools with deduplication
  const handleAddResults = (newResults: Result[]) => {
    setCurrentResults((prev) => {
      // Deduplicate by block UID or general UID
      const existingUids = new Set(
        prev.map((r) => r.blockUid || r.uid).filter(Boolean)
      );

      const uniqueNewResults = newResults.filter((r) => {
        const uid = r.blockUid || r.uid;
        if (!uid || existingUids.has(uid)) {
          return false;
        }
        existingUids.add(uid);
        return true;
      });

      if (uniqueNewResults.length > 0) {
        console.log(
          `🤖 Agent added ${uniqueNewResults.length} new results to context (${
            newResults.length - uniqueNewResults.length
          } duplicates filtered)`
        );
        return [...prev, ...uniqueNewResults];
      } else {
        console.log(
          `ℹ️  All ${newResults.length} results were already in context`
        );
        return prev;
      }
    });
  };

  // Handler to select results by UIDs from agent tools
  const handleSelectResultsByUids = (uids: string[]) => {
    const newSelected = new Set<number>();

    // Find indices of results matching the UIDs
    currentResults.forEach((result, index) => {
      const resultUid = result.blockUid || result.uid || result.pageUid;
      if (resultUid && uids.includes(resultUid)) {
        newSelected.add(index);
      }
    });

    setSelectedResults(newSelected);

    // Auto-enable "selected-only" filter when agent selects results
    if (newSelected.size > 0) {
      setSelectionFilter("selected-only");
    }
  };

  const {
    // State
    selectedResults,
    searchFilter,
    pageFilter,
    dnpFilter,
    selectionFilter,
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
    setSearchFilter,
    setPageFilter,
    setDNPFilter,
    setSelectionFilter,
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
    delete (window as any).lastQuery;
    delete (window as any).previousUserQuery;
    delete (window as any).previousFormalQuery;
    delete (window as any).previousIntentParserResult;
    delete (window as any).lastAgentResponseTargetUid;

    // Clear composer state
    setComposerQuery("");

    // Clear execution state
    setExecutionProgress("");

    forceUIRefresh();
    // resetChatConversation();
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

    // Clear all state immediately when starting new query to ensure clean UI
    setCurrentResults([]);
    forceUIRefresh();
    resetChatConversation(); // Reset chat when executing a new stored query

    try {
      // Check if this is a composed query that needs multi-step execution
      if (query.isComposed && query.querySteps.length > 0) {
        // Use the parallel execution via effect (same as onExecuteQuery path)
        setPendingQueryExecution({ query, mode: "replace" });

        return; // Exit early - effect will handle execution
      }

      // Simple query - execute normally

      await executeQueryWithLiveUpdates({
        intentParserResult: query.intentParserResult!,
        userQuery: query.userQuery,
        formalQuery: query.formalQuery,
        onProgress: (message: string) => {
          setExecutionProgress(ProgressMessages.queryRunning(message));
        },
        onResults: (partialResults: any[], isPartial?: boolean) => {
          if (!isPartial) {
            setCurrentResults(partialResults);
          }
        },
        onComplete: async (
          finalResults: any[],
          executionTime?: string,
          tokens?: any
        ) => {
          setCurrentResults(finalResults);
          let message = ProgressMessages.simpleQueryComplete(
            finalResults.length,
            executionTime,
            tokens
          );
          setExecutionProgress(message);

          // Execute page selections if they exist in the query
          if (query.pageSelections && query.pageSelections.length > 0) {
            const pageSelectionResult = await executeStoredPageSelections(
              query.pageSelections,
              finalResults,
              (progressMsg) => setExecutionProgress(progressMsg)
            );

            // Update results with page selection results
            setCurrentResults(pageSelectionResult.finalResults);

            // Update final message with page selections info
            message = ProgressMessages.pageSelectionComplete(
              pageSelectionResult.finalResults.length,
              finalResults.length,
              pageSelectionResult.addedCount
            );
            if (executionTime) {
              message += ` • ${executionTime}`;
            }
            if (
              tokens &&
              (tokens.input_tokens > 0 || tokens.output_tokens > 0)
            ) {
              message += ` • ${
                tokens.input_tokens + tokens.output_tokens
              } tokens`;
            }
            setExecutionProgress(message);

            // Update window storage with page selection results
            updateWindowQueryStorage(
              pageSelectionResult.finalResults,
              query,
              targetUid
            );
          } else {
            // Update window storage with query results (no page selections)
            updateWindowQueryStorage(finalResults, query, targetUid);
          }

          setTimeout(() => setExecutionProgress(""), 5000);
        },
        onError: (error: string) => {
          setExecutionProgress(ProgressMessages.simpleQueryFailed(error));
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

  // Helper to show temporary message
  const showTempMessage = (message: string, duration = 3000) => {
    setTempMessage(message);
    setTimeout(() => setTempMessage(null), duration);
  };

  // More actions handlers
  const handleReplaceByFirstChildren = () => {
    const selectedResultsList = getSelectedResultsList(
      selectedResults,
      currentResults
    );

    const { newResults, uidsToRemove } =
      replaceByFirstChildren(selectedResultsList);

    // Remove the original items
    let updatedResults = currentResults;
    if (uidsToRemove && uidsToRemove.length > 0) {
      updatedResults = currentResults.filter((result) => {
        const uid = result.blockUid || result.uid;
        return !uid || !uidsToRemove.includes(uid);
      });
    }

    // Add new children
    const uniqueResults = deduplicateResults(updatedResults, newResults);

    if (uniqueResults.length > 0) {
      setCurrentResults([...updatedResults, ...uniqueResults]);
      setSelectedResults(new Set()); // Clear selection
      showTempMessage(
        `✅ Replaced ${uidsToRemove?.length || 0} items with ${
          uniqueResults.length
        } children`
      );
    } else {
      showTempMessage("ℹ️ No children found to replace with", 2000);
    }
  };

  const handleAddLinkedReferences = () => {
    const selectedResultsList = getSelectedResultsList(
      selectedResults,
      currentResults
    );

    const { newResults, stats } = addLinkedReferences(selectedResultsList);
    const uniqueResults = deduplicateResults(currentResults, newResults);

    if (uniqueResults.length > 0) {
      setCurrentResults([...currentResults, ...uniqueResults]);
      showTempMessage(
        `✅ Added ${uniqueResults.length} linked references from ${stats.pages} page(s)`
      );
    } else {
      showTempMessage("ℹ️ No new linked references found", 2000);
    }
  };

  const handleAddMentionedPages = async () => {
    const selectedResultsList = getSelectedResultsList(
      selectedResults,
      currentResults
    );

    const { newResults, stats } = await addMentionedPages(selectedResultsList);
    const uniqueResults = deduplicateResults(currentResults, newResults);

    if (uniqueResults.length > 0) {
      setCurrentResults([...currentResults, ...uniqueResults]);
      showTempMessage(`✅ Added ${uniqueResults.length} mentioned pages`);
    } else {
      showTempMessage("ℹ️ No new mentioned pages found", 2000);
    }
  };

  const handleAddMentionedPagesAndLinkedRefs = async () => {
    const selectedResultsList = getSelectedResultsList(
      selectedResults,
      currentResults
    );

    const { newResults, stats } = await addMentionedPagesAndLinkedRefs(
      selectedResultsList
    );
    const uniqueResults = deduplicateResults(currentResults, newResults);

    if (uniqueResults.length > 0) {
      setCurrentResults([...currentResults, ...uniqueResults]);
      showTempMessage(
        `✅ Added ${stats.pages} pages and ${stats.blocks} linked references`
      );
    } else {
      showTempMessage("ℹ️ No new content found", 2000);
    }
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

  // Helper to get current position display info
  const getCurrentPositionInfo = () => {
    if (!isSidePanelMode) {
      return { icon: "applications", label: "Overlay" };
    }
    switch (sidePanelPosition) {
      case "right":
        return { icon: "panel-stats", label: "Right Panel" };
      case "left":
        return { icon: "panel-stats", label: "Left Panel" };
      case "bottom":
        return { icon: "menu", label: "Bottom Panel" };
      default:
        return { icon: "applications", label: "Overlay" };
    }
  };

  const handlePositionChange = (
    position: "overlay" | "right" | "left" | "bottom"
  ) => {
    if (position === "overlay") {
      setIsSidePanelMode(false);
      localStorage.setItem("fullResultsPopup_sidePanelMode", "false");
    } else {
      if (!isSidePanelMode) {
        setIsSidePanelMode(true);
        localStorage.setItem("fullResultsPopup_sidePanelMode", "true");
      }
      setSidePanelPosition(position);
      localStorage.setItem("fullResultsPopup_sidePanelPosition", position);
    }
  };

  // Side panel resize handlers
  const handleSidePanelResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidePanel(true);
  };

  const handleSidePanelResizeMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizingSidePanel) return;

      e.preventDefault();

      if (sidePanelPosition === "bottom") {
        // Resize height for bottom panel
        const newHeight = window.innerHeight - e.clientY;
        const constrainedHeight = Math.max(
          300,
          Math.min(window.innerHeight - 100, newHeight)
        );
        requestAnimationFrame(() => {
          setSidePanelHeight(constrainedHeight);
        });
      } else {
        // Resize width for left/right panels
        let newWidth: number;
        if (sidePanelPosition === "right") {
          newWidth = window.innerWidth - e.clientX;
        } else {
          newWidth = e.clientX;
        }
        const constrainedWidth = Math.max(
          300,
          Math.min(window.innerWidth - 200, newWidth)
        );
        requestAnimationFrame(() => {
          setSidePanelWidth(constrainedWidth);
        });
      }
    },
    [isResizingSidePanel, sidePanelPosition]
  );

  const handleSidePanelResizeEnd = () => {
    setIsResizingSidePanel(false);
    if (sidePanelPosition === "bottom") {
      localStorage.setItem(
        "fullResultsPopup_sidePanelHeight",
        String(sidePanelHeight)
      );
    } else {
      localStorage.setItem(
        "fullResultsPopup_sidePanelWidth",
        String(sidePanelWidth)
      );
    }
  };

  // Mouse event listeners for side panel resize
  useEffect(() => {
    if (isResizingSidePanel) {
      document.addEventListener("mousemove", handleSidePanelResizeMove);
      document.addEventListener("mouseup", handleSidePanelResizeEnd);
      return () => {
        document.removeEventListener("mousemove", handleSidePanelResizeMove);
        document.removeEventListener("mouseup", handleSidePanelResizeEnd);
      };
    }
  }, [isResizingSidePanel, handleSidePanelResizeMove]);

  // Save panel dimensions and position to localStorage whenever they change
  // BUT skip saving during active resize (to avoid writing on every mouse move)
  useEffect(() => {
    // Don't save during active resizing - handleSidePanelResizeEnd will save when done
    if (isResizingSidePanel) return;

    if (isSidePanelMode) {
      // Save position
      localStorage.setItem(
        "fullResultsPopup_sidePanelPosition",
        sidePanelPosition
      );

      // Save dimensions based on position
      if (sidePanelPosition === "bottom") {
        localStorage.setItem(
          "fullResultsPopup_sidePanelHeight",
          String(sidePanelHeight)
        );
      } else {
        localStorage.setItem(
          "fullResultsPopup_sidePanelWidth",
          String(sidePanelWidth)
        );
      }
    }
  }, [
    sidePanelWidth,
    sidePanelHeight,
    sidePanelPosition,
    isSidePanelMode,
    isResizingSidePanel,
  ]);

  // Track dialog width for responsive layout constraints
  useEffect(() => {
    const updateWidth = () => {
      if (dialogRef.current) {
        const width = dialogRef.current.offsetWidth;
        setDialogWidth(width);
      }
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);

    // Use ResizeObserver for better tracking
    const resizeObserver = new ResizeObserver(updateWidth);
    if (dialogRef.current) {
      resizeObserver.observe(dialogRef.current);
    }

    return () => {
      window.removeEventListener("resize", updateWidth);
      resizeObserver.disconnect();
    };
  }, [isSidePanelMode, sidePanelWidth, sidePanelHeight, sidePanelPosition]);

  // Check if split view is allowed based on width
  const canUseSplitView = dialogWidth >= 600;

  // Layout mode helpers
  const handleLayoutChange = useCallback(
    (newMode: "split" | "results-only" | "chat-only") => {
      // If trying to switch to split but width is too narrow, prevent it
      if (newMode === "split" && !canUseSplitView) {
        return;
      }

      setLayoutMode(newMode);
      localStorage.setItem("fullResultsPopup_layoutMode", newMode);

      // When switching to split mode, center the divider
      if (newMode === "split") {
        setMainContentWidth(50);
      }

      // Update legacy state for backward compatibility
      if (newMode === "chat-only") {
        setChatOnlyMode(true);
        if (!showChat) {
          toggleChat();
        }
      } else {
        setChatOnlyMode(false);
        if (newMode === "results-only" && showChat) {
          toggleChat(); // Close chat
        } else if (newMode === "split" && !showChat) {
          toggleChat(); // Open chat (always open chat when entering split mode)
        }
      }
    },
    [
      canUseSplitView,
      showChat,
      chatMessages.length,
      setChatOnlyMode,
      toggleChat,
      setMainContentWidth,
    ]
  );

  // Get available layout options based on current mode and width
  const getAvailableLayoutOptions = useCallback(() => {
    const options: Array<{
      mode: "split" | "results-only" | "chat-only";
      icon: string;
      label: string;
    }> = [];

    if (layoutMode !== "split" && canUseSplitView) {
      options.push({ mode: "split", icon: "panel-table", label: "Split View" });
    }
    if (layoutMode !== "results-only") {
      options.push({
        mode: "results-only",
        icon: "th-list",
        label: "Results Only",
      });
    }
    if (layoutMode !== "chat-only") {
      options.push({ mode: "chat-only", icon: "chat", label: "Chat Only" });
    }

    return options;
  }, [layoutMode, canUseSplitView]);

  // Get current layout info for button display
  const getCurrentLayoutInfo = useCallback(() => {
    switch (layoutMode) {
      case "split":
        return { icon: "panel-table", label: "Split View" };
      case "results-only":
        return { icon: "th-list", label: "Results Only" };
      case "chat-only":
        return { icon: "chat", label: "Chat Only" };
    }
  }, [layoutMode]);

  // Automatically constrain layout when width becomes too narrow
  useEffect(() => {
    if (!canUseSplitView && layoutMode === "split") {
      // Switch to chat-only if chat is active, otherwise results-only
      handleLayoutChange(showChat ? "chat-only" : "results-only");
    }
  }, [canUseSplitView, layoutMode, showChat, handleLayoutChange]);

  // Adjust Roam app margin dynamically based on side panel size and position
  useEffect(() => {
    const roamApp = document.getElementById("app");
    if (!roamApp) return;

    if (isSidePanelMode) {
      if (sidePanelPosition === "right") {
        roamApp.style.marginRight = `${sidePanelWidth}px`;
        roamApp.style.marginLeft = "0";
        roamApp.style.marginBottom = "0";
      } else if (sidePanelPosition === "left") {
        roamApp.style.marginLeft = `${sidePanelWidth}px`;
        roamApp.style.marginRight = "0";
        roamApp.style.marginBottom = "0";
      } else if (sidePanelPosition === "bottom") {
        roamApp.style.marginBottom = `${sidePanelHeight}px`;
        roamApp.style.marginRight = "0";
        roamApp.style.marginLeft = "0";
      }
    } else {
      roamApp.style.marginRight = "0";
      roamApp.style.marginLeft = "0";
      roamApp.style.marginBottom = "0";
    }

    return () => {
      roamApp.style.marginRight = "0";
      roamApp.style.marginLeft = "0";
      roamApp.style.marginBottom = "0";
    };
  }, [isSidePanelMode, sidePanelPosition, sidePanelWidth, sidePanelHeight]);

  // Auto-hide logic for narrow panels (only for side panels, not bottom)
  // Legacy auto-switch logic - now handled by layoutMode
  // Kept for backward compatibility but should always be false
  const shouldAutoSwitchChatResults = false;

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
          const rawPercentage = (relativeX / containerRect.width) * 100;
          const percentage = Math.max(20, Math.min(80, rawPercentage));

          // Use requestAnimationFrame for smoother updates
          requestAnimationFrame(() => {
            setMainContentWidth(percentage);
          });
        }
      }
    },
    [isResizing]
  );

  const handleResizeEnd = useCallback(() => {
    if (!isResizing) return;
    setIsResizing(false);
  }, [isResizing]);

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

  // Calculate dynamic styles for side panel
  const sidePanelStyle = isSidePanelMode
    ? sidePanelPosition === "bottom"
      ? { height: `${sidePanelHeight}px`, width: "100vw" }
      : { width: `${sidePanelWidth}px`, height: "100vh" }
    : {};

  const overlayPositionClass = isSidePanelMode
    ? `side-panel-${sidePanelPosition}`
    : "";

  return (
    <div
      id="full-results-popup-container"
      className={`full-results-overlay ${isFullscreen ? "fullscreen" : ""} ${
        isSidePanelMode ? "side-panel-mode" : ""
      } ${overlayPositionClass}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSidePanelMode) {
          handleClose();
        }
      }}
    >
      {/* Side panel resize handle */}
      {isSidePanelMode && (
        <div
          className={`side-panel-resize-handle side-panel-resize-${sidePanelPosition}`}
          onMouseDown={handleSidePanelResizeStart}
          title="Drag to resize"
        >
          <div className="resize-handle-bar"></div>
        </div>
      )}
      <div
        ref={dialogRef}
        className={`bp3-dialog full-results-modal ${
          showChat ? "chat-open" : ""
        } ${chatOnlyMode ? "chat-only" : ""} ${
          isFullscreen ? "fullscreen" : ""
        } ${isResizing ? "resizing" : ""} ${
          isSidePanelMode ? "side-panel" : ""
        } ${
          shouldAutoSwitchChatResults ? "auto-switch-mode" : ""
        } layout-${layoutMode}`}
        style={sidePanelStyle}
      >
        <div className="full-results-header bp3-dialog-header">
          <h3 className="full-results-title bp3-heading">{title}</h3>
          <div className="full-results-header-controls">
            {/* Layout mode menu - Show when chat is available or open */}
            {(canUseChat(privateMode, permissions) || showChat) && (
              <Popover
                content={
                  <Menu>
                    {getAvailableLayoutOptions().map((option) => (
                      <MenuItem
                        key={option.mode}
                        icon={option.icon as any}
                        text={option.label}
                        onClick={() => handleLayoutChange(option.mode)}
                      />
                    ))}
                  </Menu>
                }
                position="bottom-right"
              >
                <button
                  className="full-results-control-button bp3-button bp3-minimal"
                  title={`Layout: ${getCurrentLayoutInfo().label}`}
                >
                  <Icon icon={getCurrentLayoutInfo().icon as any} size={12} />
                </button>
              </Popover>
            )}
            {/* Position menu */}
            <Popover
              content={
                <Menu>
                  <MenuItem
                    icon="applications"
                    text="Overlay (Center)"
                    onClick={() => handlePositionChange("overlay")}
                    active={!isSidePanelMode}
                  />
                  <MenuItem
                    icon="arrow-right"
                    text="Right Panel"
                    onClick={() => handlePositionChange("right")}
                    active={isSidePanelMode && sidePanelPosition === "right"}
                  />
                  <MenuItem
                    icon="arrow-left"
                    text="Left Panel"
                    onClick={() => handlePositionChange("left")}
                    active={isSidePanelMode && sidePanelPosition === "left"}
                  />
                  <MenuItem
                    icon="arrow-down"
                    text="Bottom Panel"
                    onClick={() => handlePositionChange("bottom")}
                    active={isSidePanelMode && sidePanelPosition === "bottom"}
                  />
                </Menu>
              }
              position="bottom-right"
            >
              <button
                className="full-results-control-button bp3-button bp3-minimal"
                title={`Display: ${getCurrentPositionInfo().label}`}
              >
                <Icon icon={getCurrentPositionInfo().icon as any} size={12} />
              </button>
            </Popover>
            <button
              className="full-results-control-button bp3-button bp3-minimal"
              onClick={handleFullscreenToggle}
              title={
                isFullscreen ? "Exit fullscreen (ESC)" : "Fullscreen (F11)"
              }
            >
              <Icon icon={isFullscreen ? "minimize" : "maximize"} size={12} />
            </button>
            <button
              className="full-results-close-button bp3-button bp3-minimal bp3-dialog-close-button"
              onClick={handleClose}
            >
              <Icon icon="cross" size={12} />
            </button>
          </div>
        </div>

        <div className="full-results-content-container">
          {/* Edge Hover Buttons for Quick Layout Switching */}

          {/* Left Edge Button */}
          {layoutMode === "chat-only" && (
            <Tooltip
              minimal
              hoverOpenDelay={500}
              usePortal={false}
              placement="right"
              content={
                canUseSplitView
                  ? "Click: Show split view | Shift+click: Results only"
                  : "Switch to query manager & results"
              }
            >
              <div
                className="edge-hover-button edge-hover-left"
                onClick={(e) => {
                  if (e.shiftKey) {
                    handleLayoutChange("results-only");
                    return;
                  }
                  if (canUseSplitView) {
                    handleLayoutChange("split");
                  } else {
                    handleLayoutChange("results-only");
                  }
                }}
                onDoubleClick={() => handleLayoutChange("results-only")}
              >
                <Icon icon="chevron-right" size={16} />
              </div>
            </Tooltip>
          )}
          {layoutMode === "split" && (
            <Tooltip
              hoverOpenDelay={500}
              minimal
              usePortal={false}
              placement="right"
              content="Close results panel (chat only)"
            >
              <div
                className="edge-hover-button edge-hover-left edge-hover-split"
                onClick={() => handleLayoutChange("chat-only")}
              >
                <Icon icon="cross" size={14} />
              </div>
            </Tooltip>
          )}

          {/* Right Edge Button */}
          {layoutMode === "results-only" && (
            <Tooltip
              minimal
              hoverOpenDelay={500}
              usePortal={false}
              placement="right"
              content={
                canUseSplitView
                  ? "Click: Show split view. Shift+Click: Chat only"
                  : "Switch to chat"
              }
            >
              <div
                className="edge-hover-button edge-hover-right"
                onClick={(e) => {
                  if (e.shiftKey) {
                    handleLayoutChange("chat-only");
                    return;
                  }
                  if (canUseSplitView) {
                    handleLayoutChange("split");
                  } else {
                    handleLayoutChange("chat-only");
                  }
                }}
              >
                <Icon icon="chevron-left" size={16} />
              </div>
            </Tooltip>
          )}
          {layoutMode === "split" && (
            <Tooltip
              minimal
              hoverOpenDelay={500}
              usePortal={false}
              placement="right"
              content="Close chat panel (results only)"
            >
              <div
                className="edge-hover-button edge-hover-right edge-hover-split"
                onClick={() => handleLayoutChange("results-only")}
              >
                <Icon icon="cross" size={14} />
              </div>
            </Tooltip>
          )}

          {/* Results Panel */}
          {layoutMode !== "chat-only" && (
            <div
              className="full-results-main-content"
              style={{
                width: layoutMode === "split" ? `${mainContentWidth}%` : "100%",
                display: "flex",
              }}
            >
              {/* Query Management */}
              <div className="query-manager-container">
                <div className="query-manager-wrapper">
                  <QueryManager
                    currentQuery={currentQueryAsUnified}
                    onQuerySelect={handleQuerySelect}
                    onQueryLoadedIntoComposer={(
                      query: StoredQuery,
                      forceResetOriginal?: boolean
                    ) => {
                      lastLoadedQueryRef.current = query;
                      setLoadedQuery(query);
                      // Track original query for detecting edits (only if not already editing)
                      if (
                        forceResetOriginal ||
                        !originalLoadedQuery ||
                        originalLoadedQuery.id !== query.id
                      ) {
                        setOriginalLoadedQuery(query);
                      }
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

                        if (
                          mode === "replace" &&
                          queryToExecute &&
                          (queryToExecute.userQuery === composerQuery ||
                            (!composerQuery.trim() && loadedQuery) ||
                            (!queryToExecute.userQuery &&
                              queryToExecute.pageSelections &&
                              queryToExecute.pageSelections.length > 0))
                        ) {
                          // This is a loaded query being executed (either matches composer or loaded without composer text)

                          // IMPORTANT: Set as current active query so page selections persist in UI
                          setCurrentActiveQuery(queryToExecute);

                          // Check if it's a composed query that needs multi-step execution
                          if (
                            queryToExecute.isComposed &&
                            queryToExecute.querySteps.length > 0
                          ) {
                            // Clear results and set progress BEFORE execution starts
                            setExecutionProgress(
                              `🔄 Preparing composed query: ${
                                queryToExecute.querySteps.length + 1
                              } queries...`
                            );

                            setCurrentResults([]);
                            forceUIRefresh(); // Force immediate UI update to show empty state

                            // Clear state
                            setOriginalQueryForComposition(null);
                            setLoadedQuery(null);
                            lastLoadedQueryRef.current = null;

                            // Trigger execution in effect (allows React to re-render between updates)

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

                          // DON'T clear loadedQuery if we're executing it - keep it visible during execution
                          // Only clear if it's NOT the query being executed
                          if (
                            !queryToExecute ||
                            queryToExecute.userQuery !== loadedQuery?.userQuery
                          ) {
                            setLoadedQuery(null);
                          }

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
                        const queryText =
                          composerQuery.trim() ||
                          queryToExecute?.userQuery ||
                          "";

                        // Handle pageSelections-only queries (no userQuery)
                        let newResults: any[] = [];
                        let executionTime: string | undefined;
                        let tokens: any | undefined;

                        if (queryText) {
                          setExecutionProgress(
                            `🔄 Executing query: ${queryText.substring(0, 50)}${
                              queryText.length > 50 ? "..." : ""
                            }`
                          );
                          const executionResult = await handleComposerExecute(
                            currentResults,
                            mode,
                            model,
                            queryText // Pass the query text (either from composer or loaded query)
                          );
                          if (executionResult) {
                            newResults = executionResult.results;
                            executionTime = executionResult.executionTime;
                            tokens = executionResult.tokens;
                          }
                        } else if (
                          queryToExecute?.pageSelections &&
                          queryToExecute.pageSelections.length > 0
                        ) {
                          // PageSelections-only query - skip the query execution step
                          setExecutionProgress(
                            `📄 Loading ${queryToExecute.pageSelections.length} page selection(s)...`
                          );
                        }

                        // Handle results or pageSelections-only queries
                        if (
                          newResults.length > 0 ||
                          (queryToExecute?.pageSelections &&
                            queryToExecute.pageSelections.length > 0)
                        ) {
                          // Update current query context with the executed query
                          if (mode === "replace") {
                            const executedQuery =
                              composerQuery.trim() ||
                              queryToExecute?.userQuery ||
                              "";
                            setCurrentUserQuery(executedQuery);
                            setCurrentFormalQuery(executedQuery);

                            if (newResults.length > 0) {
                              setCurrentResults([...newResults]);
                              // Force refresh AFTER setting new results
                              forceUIRefresh();
                            }

                            // Execute page selections if they exist in the loaded query
                            if (
                              queryToExecute?.pageSelections &&
                              queryToExecute.pageSelections.length > 0
                            ) {
                              const pageSelectionResult =
                                await executeStoredPageSelections(
                                  queryToExecute.pageSelections,
                                  newResults,
                                  (progressMsg) =>
                                    setExecutionProgress(progressMsg)
                                );

                              // Update results with page selection results
                              setCurrentResults(
                                pageSelectionResult.finalResults
                              );

                              // Update final progress message
                              if (newResults.length > 0) {
                                setExecutionProgress(
                                  ProgressMessages.pageSelectionComplete(
                                    pageSelectionResult.finalResults.length,
                                    newResults.length,
                                    pageSelectionResult.addedCount
                                  )
                                );
                              } else {
                                // PageSelections-only: count pages and blocks
                                const pageCount =
                                  pageSelectionResult.finalResults.filter(
                                    (r: any) => r.isPage === true
                                  ).length;
                                const blockCount =
                                  pageSelectionResult.finalResults.filter(
                                    (r: any) => r.isPage !== true
                                  ).length;
                                setExecutionProgress(
                                  ProgressMessages.pageSelectionWithCounts(
                                    pageCount,
                                    blockCount
                                  )
                                );
                              }

                              // Update window storage with page selection results
                              // Case: Query executed from INSIDE FullResultsPopup (QueryManager)
                              if (queryToExecute) {
                                updateWindowQueryStorage(
                                  pageSelectionResult.finalResults,
                                  queryToExecute,
                                  targetUid
                                );
                              }
                            } else {
                              // Update window storage with query results (no page selections)
                              // Case: Query executed from INSIDE FullResultsPopup (QueryManager)
                              if (queryToExecute) {
                                updateWindowQueryStorage(
                                  newResults,
                                  queryToExecute,
                                  targetUid
                                );
                              }
                            }

                            // Clear loadedQuery AFTER execution completes (including page selections)
                            // This ensures page selections remain visible during execution
                            if (loadedQuery) {
                              setLoadedQuery(null);
                            }
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

                                const currentIntentParser = (window as any)
                                  .lastIntentParserResult;

                                // Check if we're adding a loaded query (which may be composed) or a typed query
                                let additionalQueryToCompose: any;

                                if (
                                  loadedQuery &&
                                  (loadedQuery.userQuery === composerQuery ||
                                    !composerQuery.trim())
                                ) {
                                  // We're adding a loaded query - use its full structure (may include steps)

                                  additionalQueryToCompose = loadedQuery;
                                } else {
                                  // We're adding a typed query - create simple step

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
                                setCurrentFormalQuery(
                                  composedQuery.formalQuery
                                );

                                // Add to recent queries
                                const queries = getStoredQueries();
                                queries.recent = [
                                  tempQuery,
                                  ...queries.recent,
                                ].slice(0, 10);
                                saveQueries(queries);

                                // Clear the loaded query and composition context to switch UI to composed view
                                setLoadedQuery(null);
                                setOriginalQueryForComposition(null);

                                // Reset composing flag after a short delay to prevent immediate re-entry
                                setTimeout(() => setIsComposingNow(false), 100);
                              }
                            }

                            forceUIRefresh();
                          }
                        }

                        // Clear progress message after successful execution
                        if (
                          queryToExecute?.pageSelections &&
                          queryToExecute.pageSelections.length > 0 &&
                          (!newResults || newResults.length === 0)
                        ) {
                          // PageSelections-only query - don't show misleading "0 results" message
                          // Message already set by pageSelections execution logic above
                        } else {
                          setExecutionProgress(
                            ProgressMessages.simpleQueryComplete(
                              newResults?.length || 0,
                              executionTime,
                              tokens
                            )
                          );
                        }
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
                      <option value="selection">Sort: Selection</option>
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
                    <span
                      className="full-results-selection-info"
                      onClick={() =>
                        setSelectionFilter(
                          selectionFilter === "selected-only"
                            ? "all"
                            : "selected-only"
                        )
                      }
                      title={
                        selectionFilter === "selected-only"
                          ? "Click to show all results"
                          : "Click to show only selected results"
                      }
                      style={{ cursor: "pointer" }}
                    >
                      <Icon
                        icon={
                          selectionFilter === "selected-only"
                            ? "filter-remove"
                            : "filter-keep"
                        }
                        size={12}
                        style={{ marginRight: "4px" }}
                      />
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
                {/* Temporary Message */}
                {tempMessage && (
                  <div
                    className="full-results-temp-message"
                    style={{
                      padding: "12px",
                      margin: "8px 0",
                      backgroundColor: "#F5F8FA",
                      border: "1px solid #CED9E0",
                      borderRadius: "4px",
                      fontSize: "14px",
                      textAlign: "center",
                    }}
                  >
                    {tempMessage}
                  </div>
                )}

                {/* Results */}
                <div className="full-results-list">
                  {paginatedResults && paginatedResults.length > 0 ? (
                    paginatedResults.map((result, index) => {
                      const originalIndex = currentResults.indexOf(result);
                      return (
                        <div
                          key={result.uid || originalIndex}
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

              {/* Action Bar - Fixed at bottom of results panel */}
              <div className="full-results-action-bar">
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
                    text={`All (${filteredAndSortedResults.length})`}
                    onClick={handleSelectAllResults}
                    small
                    minimal
                    disabled={filteredAndSortedResults.length === 0}
                  />

                  {selectedResults.size > 0 && (
                    <>
                      <Button
                        icon="cross"
                        onClick={() => {
                          setSelectedResults(new Set());
                          setSelectionFilter("all");
                        }}
                        small
                        minimal
                        intent="warning"
                        title="Unselect all"
                      />
                      <Button
                        icon="trash"
                        onClick={() => {
                          // Remove selected results from currentResults
                          const newResults = currentResults.filter(
                            (_, index) => !selectedResults.has(index)
                          );
                          setCurrentResults(newResults);
                          setSelectedResults(new Set());
                          setSelectionFilter("all");
                        }}
                        small
                        minimal
                        intent="danger"
                        title="Remove selected from results"
                      />
                      <Popover
                        content={
                          <Menu>
                            <MenuItem
                              icon="inheritance"
                              text="Replace by first children"
                              onClick={handleReplaceByFirstChildren}
                            />
                            <MenuItem
                              icon="flows"
                              text="Add linked references"
                              onClick={handleAddLinkedReferences}
                            />
                            <MenuItem
                              icon="tag"
                              text="Add mentioned pages"
                              onClick={handleAddMentionedPages}
                            />
                            <MenuItem
                              icon="graph"
                              text="Add mentioned pages & linked refs"
                              onClick={handleAddMentionedPagesAndLinkedRefs}
                            />
                          </Menu>
                        }
                        position="bottom-right"
                      >
                        <Button
                          icon="more"
                          small
                          minimal
                          title="More actions"
                        />
                      </Popover>
                    </>
                  )}
                </div>

                <div className="full-results-buttons-container">
                  <Popover
                    content={
                      <Menu>
                        <MenuItem
                          icon="insert"
                          text="Insert in focused block"
                          onClick={handleInsertAtDNPEnd}
                          disabled={selectedResults.size === 0}
                        />
                        <MenuItem
                          icon="calendar"
                          text={
                            targetUid
                              ? "Append to last response"
                              : "Append to today's DNP"
                          }
                          onClick={handleInsertAtDNPEnd}
                          disabled={selectedResults.size === 0}
                        />
                        <MenuItem
                          icon="menu-open"
                          text="Open in Sidebar"
                          onClick={handleInsertInSidebar}
                          disabled={selectedResults.size === 0}
                        />
                      </Menu>
                    }
                    position="bottom-right"
                  >
                    <Button
                      icon="insert"
                      minimal
                      small
                      disabled={selectedResults.size === 0}
                      title="Insert results"
                    />
                  </Popover>

                  <Popover
                    content={
                      <Menu>
                        <MenuItem
                          icon="duplicate"
                          text="Copy Embeds"
                          onClick={handleCopyEmbeds}
                          disabled={selectedResults.size === 0}
                        />
                        <MenuItem
                          icon="link"
                          text="Copy References"
                          onClick={handleCopyReferences}
                          disabled={selectedResults.size === 0}
                        />
                      </Menu>
                    }
                    position="bottom-right"
                  >
                    <Button
                      icon="clipboard"
                      minimal
                      small
                      disabled={selectedResults.size === 0}
                      title="Copy to clipboard"
                    />
                  </Popover>
                </div>
              </div>
            </div>
          )}

          {/* Resize Handle */}
          {layoutMode === "split" && (
            <div
              className="full-results-resize-handle"
              onMouseDown={handleResizeStart}
              title="Drag to resize"
            >
              <div className="resize-handle-bar"></div>
            </div>
          )}

          {/* Chat Panel */}
          {layoutMode !== "results-only" && showChat && (
            <div
              className="full-results-chat-container"
              style={{
                width:
                  layoutMode === "split"
                    ? `${100 - mainContentWidth}%`
                    : "100%",
                display: "flex",
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
                // Initial chat state for continuing conversations
                initialChatMessages={initialChatMessages}
                initialChatPrompt={initialChatPrompt}
                initialChatModel={initialChatModel}
                initialLoadedChatUid={initialLoadedChatUid}
                // Command context for auto-execution
                initialStyle={initialStyle}
                initialCommandId={initialCommandId}
                initialCommandPrompt={initialCommandPrompt}
                // Page autocomplete
                availablePages={availablePages}
                isLoadingPages={isLoadingPages}
                queryAvailablePages={queryAvailablePages}
                // Agent callbacks
                onAddResults={handleAddResults}
                onSelectResultsByUids={handleSelectResultsByUids}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FullResultsPopup;

// Shared utility function for opening last Ask Your Graph results
// Used by both command palette and context menu
export const openLastAskYourGraphResults = async () => {
  const lastResults = (window as any).lastAskYourGraphResults || [];

  // Get the CURRENT page UID (not the stored one from when query was originally run)
  const { getMainViewUid } = await import("../../utils/roamAPI.js");
  const currentPageUid = await getMainViewUid();

  // Use the global window function to avoid circular imports
  // (index.tsx registers this function globally)
  const openFullResultsPopup = (window as any).LiveAI?.openFullResultsPopup;

  if (openFullResultsPopup) {
    // Use current page UID so DirectContentSelector shows the actual current page
    const targetUid = currentPageUid || null;
    // Only use window query state if there are actual results, otherwise use null
    // This prevents stale query state from appearing when opening popup fresh
    const hasActualResults = lastResults && lastResults.length > 0;
    const userQuery = hasActualResults
      ? (window as any).lastUserQuery || null
      : null;
    const formalQuery = hasActualResults
      ? (window as any).lastFormalQuery || null
      : null;
    const intentParserResult = hasActualResults
      ? (window as any).lastIntentParserResult || null
      : null;
    openFullResultsPopup({
      results: lastResults,
      targetUid,
      userQuery,
      formalQuery,
      forceOpenChat: false,
      intentParserResult,
    });
  } else {
    // Fallback if function not yet registered
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
