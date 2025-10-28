import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Result,
  ViewMode,
  PageDisplayMode,
  SortBy,
  SortOrder,
  ChatMessage,
  DNPFilter,
  SelectionFilter,
} from "../types/types";
import { StoredQuery, PageSelection } from "../utils/queryStorage";
import {
  UnifiedQuery,
  QueryContext,
  storedQueryToUnified,
  createSimpleQuery,
} from "../types/QueryTypes";
import { getCurrentTokenUsage } from "../../../ai/agents/search-agent/ask-your-graph-agent";
import {
  filterAndSortResults,
  paginateResults,
  calculateTotalPages,
  getUniquePages,
  detectResultTypes,
  extractPageReferences,
  filterResultsByReferences,
  PageReference,
  getBlockAndChildrenContent,
  detectDNPDistribution,
} from "../utils/resultProcessing";
import {
  getPageUidByBlockUid,
  getPageNameByPageUid,
  getMainViewUid,
} from "../../../utils/roamAPI.js";
import { getSelectedResultsList } from "../utils/chatHelpers";
import { defaultModel, extensionStorage } from "../../..";
import { handleDirectContentAdd as directContentHandler } from "../utils/directContentHandler";
import { addRecentQuery } from "../utils/queryStorage";

export const useFullResultsState = (
  results: Result[],
  isOpen: boolean,
  forceOpenChat: boolean = false,
  targetUid?: string | null
) => {
  // Selection state
  const [selectedResults, setSelectedResults] = useState<Set<number>>(
    new Set()
  );
  const [dropdownStates, setDropdownStates] = useState<Record<string, boolean>>(
    {}
  );
  const [isClosing, setIsClosing] = useState(false);

  // Current page context state
  const [currentPageContext, setCurrentPageContext] = useState<{
    uid: string | null;
    title: string | null;
  }>({ uid: null, title: null });

  // Query Composer state
  const [composerQuery, setComposerQuery] = useState("");
  const [isComposingQuery, setIsComposingQuery] = useState(false);
  const [showQueryComposer, setShowQueryComposer] = useState(false);

  // Unified Query State (replaces fragmented window-based state)
  const [queryContext, setQueryContext] = useState<QueryContext>({
    currentQuery: null,
    originalQuery: null,
    loadedQuery: null,
    isCompositionMode: false,
    selectedQueryId: "",
  });

  // Filtering and sorting state
  const [searchFilter, setSearchFilter] = useState("");
  const [pageFilter, setPageFilter] = useState("all");
  const [dnpFilter, setDNPFilter] = useState<DNPFilter>("all");
  const [selectionFilter, setSelectionFilter] = useState<SelectionFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("relevance");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [resultsPerPage, setResultsPerPage] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);

  // Load preferences from storage or use defaults
  const getStoredPreferences = () => {
    const stored = extensionStorage.get("fullResultsPreferences") || {};
    return {
      showMetadata: stored.showMetadata ?? true, // Default to true
      showPaths: stored.showPaths ?? false, // Default to false
      expanded: stored.expanded ?? true, // Default to true
    };
  };

  const [showMetadata, setShowMetadata] = useState(
    () => getStoredPreferences().showMetadata
  );
  const [showPaths, setShowPaths] = useState(
    () => getStoredPreferences().showPaths
  );
  const [expanded, setExpanded] = useState(
    () => getStoredPreferences().expanded
  );

  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>("mixed");
  const [pageDisplayMode, setPageDisplayMode] =
    useState<PageDisplayMode>("metadata");

  // Save preferences to storage when they change
  useEffect(() => {
    const preferences = {
      showMetadata,
      showPaths,
      expanded,
    };
    extensionStorage.set("fullResultsPreferences", preferences);
  }, [showMetadata, showPaths, expanded]);

  // Auto-adjust sorting when switching to pages-only view
  const handleViewModeChange = (newViewMode: ViewMode) => {
    setViewMode(newViewMode);

    // If switching to pages-only and current sort is content-based, switch to page sorting
    if (
      newViewMode === "pages" &&
      (sortBy === "content-alpha" || sortBy === "content-length")
    ) {
      setSortBy("page");
    }
  };

  // Chat state
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatAccessMode, setChatAccessMode] = useState<
    "Balanced" | "Full Access"
  >(() => {
    const defaultMode = extensionStorage.get("askGraphMode") || "Balanced";
    return defaultMode === "Private"
      ? "Balanced"
      : (defaultMode as "Balanced" | "Full Access");
  });
  const [chatAgentData, setChatAgentData] = useState<any>(null);
  const [chatExpandedResults, setChatExpandedResults] = useState<
    Result[] | null
  >(null);

  // Advanced UI state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chatOnlyMode, setChatOnlyMode] = useState(false);
  const [mainContentWidth, setMainContentWidth] = useState(50); // percentage
  const [isResizing, setIsResizing] = useState(false);

  // References filtering state
  const [includedReferences, setIncludedReferences] = useState<string[]>([]);
  const [excludedReferences, setExcludedReferences] = useState<string[]>([]);

  // Direct Content Selector state
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [includePageContent, setIncludePageContent] = useState(true);
  const [includeLinkedRefs, setIncludeLinkedRefs] = useState(true);
  const [dnpPeriod, setDNPPeriod] = useState<number>(7); // Default to last 7 days
  const [isAddingDirectContent, setIsAddingDirectContent] = useState(false);
  const [availablePages, setAvailablePages] = useState<string[]>([]);
  const [isLoadingPages, setIsLoadingPages] = useState(false);

  // Force refresh mechanism - This is the key fix for the UI refresh issue
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Function to force UI refresh when new results are set
  const forceUIRefresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
    // Reset pagination to first page
    setCurrentPage(1);
    // Clear selected results
    setSelectedResults(new Set());
  }, []);

  // Reset state when popup opens
  useEffect(() => {
    if (isOpen) {
      setSelectedResults(new Set());
      setSearchFilter("");
      setPageFilter("all");
      setDNPFilter("all");
      setCurrentPage(1);
      setViewMode("mixed"); // Always show mixed view by default

      // Set chat state based on forceOpenChat flag
      setShowChat(forceOpenChat);

      // Reset references filters
      setIncludedReferences([]);
      setExcludedReferences([]);
      setAvailableReferences([]);
      setFilteredAndSortedResults([]);
      setBlockContentMap(new Map());
      setChildrenContentMap(new Map());

      // Reset refresh trigger
      setRefreshTrigger(0);

      // Reset query composer state
      setShowQueryComposer(false);
      setComposerQuery("");
      setIsComposingQuery(false);

      // Reset direct content selector state
      setSelectedPages([]);
      setIncludePageContent(true);
      setIncludeLinkedRefs(true);
      setDNPPeriod(7);
      setIsAddingDirectContent(false);
      setAvailablePages([]);
      setIsLoadingPages(false);
    }
  }, [isOpen, forceOpenChat]);

  // Initialize current page context when popup opens
  useEffect(() => {
    if (!isOpen) return;

    const initializeCurrentPageContext = async () => {
      let pageUid: string | null = null;
      let pageTitle: string | null = null;

      try {
        // First priority: Use targetUid if it represents a page context
        if (targetUid) {
          // Check if targetUid is itself a page UID or get its page
          const pageUidFromTarget = getPageUidByBlockUid(targetUid);
          if (pageUidFromTarget) {
            pageUid = pageUidFromTarget;
            pageTitle = getPageNameByPageUid(pageUid);
            if (pageTitle === "undefined") pageTitle = null;
          } else {
            // targetUid might be a page UID itself
            pageTitle = getPageNameByPageUid(targetUid);
            if (pageTitle === "undefined") {
              pageTitle = null;
            } else {
              pageUid = targetUid;
            }
          }
        }

        // Second priority: Use currently opened page if no valid targetUid context
        if (!pageUid || !pageTitle) {
          // Await the async call to get the current open UID
          const currentOpenUid = await getMainViewUid();
          if (currentOpenUid) {
            // Get the actual page UID (in case currentOpenUid is a block UID)
            const actualPageUid =
              getPageUidByBlockUid(currentOpenUid) || currentOpenUid;
            const actualPageTitle = getPageNameByPageUid(actualPageUid);

            if (actualPageTitle && actualPageTitle !== "undefined") {
              pageUid = actualPageUid;
              pageTitle = actualPageTitle;
            }
          }
        }

        setCurrentPageContext({ uid: pageUid, title: pageTitle });
      } catch (error) {
        console.warn("⚠️ [CurrentPageContext] Error initializing:", error);
        setCurrentPageContext({ uid: null, title: null });
      }
    };

    initializeCurrentPageContext();
  }, [isOpen, targetUid]);

  // References state
  const [availableReferences, setAvailableReferences] = useState<
    PageReference[]
  >([]);

  // Content maps for enhanced search
  const [blockContentMap, setBlockContentMap] = useState<Map<string, string>>(
    new Map()
  );
  const [childrenContentMap, setChildrenContentMap] = useState<
    Map<string, string[]>
  >(new Map());

  // Compute unique pages for filter dropdown and detect result types
  const { uniquePages, hasBlocks, hasPages, shouldShowDNPFilter } =
    useMemo(() => {
      const pages = getUniquePages(results);
      const { hasBlocks, hasPages } = detectResultTypes(results);
      const { shouldShowDNPFilter } = detectDNPDistribution(results);

      return {
        uniquePages: pages,
        hasBlocks,
        hasPages,
        shouldShowDNPFilter,
      };
    }, [results]);

  // Extract block/children content from original results (this doesn't need to change with filters)
  useEffect(() => {
    const extractContentData = async () => {
      try {
        const contentData = await getBlockAndChildrenContent(results);

        setBlockContentMap(contentData.blockContent);
        setChildrenContentMap(contentData.childrenContent);
      } catch (error) {
        console.error("Failed to extract content:", error);
        setBlockContentMap(new Map());
        setChildrenContentMap(new Map());
      }
    };

    if (results.length > 0) {
      extractContentData();
    } else {
      console.log(
        `⚠️ [useFullResultsState] No results to extract content from (length: ${results.length})`
      );
      setBlockContentMap(new Map());
      setChildrenContentMap(new Map());
    }
  }, [results]);

  // Extract references from filtered results (updates when filters change)
  useEffect(() => {
    const extractFilteredReferences = async () => {
      try {
        // Apply base filtering (DNP, view mode, search, page) but not references filtering
        // to get the results that should be considered for reference extraction
        const baseFiltered = await filterAndSortResults(
          results,
          {
            searchFilter,
            pageFilter,
            sortBy: "relevance", // Sort doesn't matter for reference extraction
            sortOrder: "desc",
            viewMode,
            dnpFilter,
            selectionFilter: "all", // Don't filter by selection for reference extraction
          },
          blockContentMap,
          childrenContentMap
        );

        const references = await extractPageReferences(baseFiltered);

        setAvailableReferences(references);
      } catch (error) {
        console.error(
          "Failed to extract references from filtered results:",
          error
        );
        setAvailableReferences([]);
      }
    };

    if (results.length > 0 && blockContentMap.size > 0) {
      extractFilteredReferences();
    } else {
      setAvailableReferences([]);
    }
  }, [
    results,
    searchFilter,
    pageFilter,
    viewMode,
    dnpFilter,
    blockContentMap,
    childrenContentMap,
  ]);

  // Filtered results state (for async filtering)
  const [filteredAndSortedResults, setFilteredAndSortedResults] = useState<
    Result[]
  >([]);

  // Apply filtering and sorting asynchronously - INCLUDES REFRESH TRIGGER FIX
  useEffect(() => {
    const applyFiltering = async () => {
      try {
        // First apply references filtering
        const referencesFiltered = await filterResultsByReferences(
          results,
          includedReferences,
          excludedReferences
        );

        // Then apply standard filtering and sorting with block and children content
        const finalResults = await filterAndSortResults(
          referencesFiltered,
          {
            searchFilter,
            pageFilter,
            sortBy,
            sortOrder,
            viewMode,
            dnpFilter,
            selectionFilter,
            selectedIndices: selectedResults,
            allResults: results,
          },
          blockContentMap,
          childrenContentMap
        );

        setFilteredAndSortedResults(finalResults);
      } catch (error) {
        console.error("Failed to filter results:", error);
        // Fallback to just applying standard filtering without references
        const fallbackResults = await filterAndSortResults(
          results,
          {
            searchFilter,
            pageFilter,
            sortBy,
            sortOrder,
            viewMode,
            dnpFilter,
            selectionFilter,
            selectedIndices: selectedResults,
            allResults: results,
          },
          blockContentMap,
          childrenContentMap
        );
        setFilteredAndSortedResults(fallbackResults);
      }
    };

    applyFiltering();
  }, [
    results,
    includedReferences,
    excludedReferences,
    searchFilter,
    pageFilter,
    sortBy,
    sortOrder,
    viewMode,
    dnpFilter,
    selectionFilter,
    selectedResults,
    blockContentMap,
    childrenContentMap,
    refreshTrigger, // CRITICAL: Include refreshTrigger to force re-filtering when new results are set
  ]);

  // Pagination
  const totalPages = calculateTotalPages(
    filteredAndSortedResults.length,
    resultsPerPage
  );
  const paginatedResults = useMemo(() => {
    return paginateResults(
      filteredAndSortedResults,
      currentPage,
      resultsPerPage
    );
  }, [filteredAndSortedResults, currentPage, resultsPerPage]);

  // Update currentPage if it exceeds totalPages
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages]);

  // Selection handlers
  const handleCheckboxChange = (resultIndex: number) => {
    if (isClosing) return;
    const newSelected = new Set(selectedResults);
    const originalIndex = results.indexOf(paginatedResults[resultIndex]);
    if (newSelected.has(originalIndex)) {
      newSelected.delete(originalIndex);
    } else {
      newSelected.add(originalIndex);
    }
    setSelectedResults(newSelected);
  };

  const handleSelectAll = () => {
    if (isClosing) return; // Prevent state updates if closing
    const currentPageIndices = paginatedResults.map((result) =>
      results.indexOf(result)
    );
    const allCurrentSelected = currentPageIndices.every((idx) =>
      selectedResults.has(idx)
    );

    const newSelected = new Set(selectedResults);
    if (allCurrentSelected) {
      // Deselect all current page results
      currentPageIndices.forEach((idx) => newSelected.delete(idx));
    } else {
      // Select all current page results
      currentPageIndices.forEach((idx) => newSelected.add(idx));
    }
    setSelectedResults(newSelected);
  };

  const handleSelectAllResults = () => {
    if (isClosing) return;
    if (selectedResults.size === filteredAndSortedResults.length) {
      setSelectedResults(new Set());
    } else {
      const allFilteredIndices = filteredAndSortedResults.map((result) =>
        results.indexOf(result)
      );
      setSelectedResults(new Set(allFilteredIndices));
    }
  };

  const getSelectedResultsArray = () => {
    return getSelectedResultsList(selectedResults, results);
  };

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);

    // Clear unpinned chat style from window object
    // Only clear if not pinned - pinned styles should persist across popup closes
    if (!(window as any).__pinnedChatStyle) {
      delete (window as any).__currentChatStyle;
    }

    // Remove the popup container directly
    setTimeout(() => {
      const container = document.getElementById("full-results-popup-container");
      if (container) {
        container.remove();
      }
    }, 300);
  };

  const toggleChat = () => {
    if (chatOnlyMode) setChatOnlyMode(false);
    setShowChat(!showChat);
  };

  // References filter handlers
  const handleIncludeReference = (reference: string) => {
    setIncludedReferences((prev) => {
      if (prev.includes(reference)) {
        return prev.filter((ref) => ref !== reference);
      } else {
        // Remove from excluded if it was there
        setExcludedReferences((prevExcluded) =>
          prevExcluded.filter((ref) => ref !== reference)
        );
        return [...prev, reference];
      }
    });
  };

  const handleExcludeReference = (reference: string) => {
    setExcludedReferences((prev) => {
      if (prev.includes(reference)) {
        return prev.filter((ref) => ref !== reference);
      } else {
        // Remove from included if it was there
        setIncludedReferences((prevIncluded) =>
          prevIncluded.filter((ref) => ref !== reference)
        );
        return [...prev, reference];
      }
    });
  };

  const handleClearAllReferences = () => {
    setIncludedReferences([]);
    setExcludedReferences([]);
  };

  const resetChatConversation = () => {
    setChatMessages([]);
    setChatAgentData(null);
    setChatExpandedResults(null);
  };

  const handleExpandedToggle = () => {
    const newExpanded = !expanded;
    setExpanded(newExpanded);

    // For pages, toggle pageDisplayMode based on expanded state
    if (hasPages && viewMode !== "blocks") {
      setPageDisplayMode(newExpanded ? "metadata" : "embed");
    }
  };

  // Unified Query Management Functions
  const updateQueryContext = useCallback((updates: Partial<QueryContext>) => {
    setQueryContext((prev) => ({ ...prev, ...updates }));
  }, []);

  const setCurrentQuery = useCallback(
    (query: UnifiedQuery | null) => {
      updateQueryContext({ currentQuery: query });
    },
    [updateQueryContext]
  );

  const setOriginalQuery = useCallback(
    (query: UnifiedQuery | null) => {
      updateQueryContext({ originalQuery: query });
    },
    [updateQueryContext]
  );

  const setLoadedQuery = useCallback(
    (query: UnifiedQuery | null) => {
      updateQueryContext({ loadedQuery: query });
    },
    [updateQueryContext]
  );

  const enterCompositionMode = useCallback(
    (original: UnifiedQuery, loaded: UnifiedQuery) => {
      updateQueryContext({
        originalQuery: original,
        loadedQuery: loaded,
        isCompositionMode: true,
      });
    },
    [updateQueryContext]
  );

  const exitCompositionMode = useCallback(() => {
    updateQueryContext({
      originalQuery: null,
      loadedQuery: null,
      isCompositionMode: false,
    });
  }, [updateQueryContext]);

  // Helper to get current query from window state (for external component integration)
  const getCurrentQueryFromWindow = useCallback((): UnifiedQuery | null => {
    const userQuery = (window as any).lastUserQuery;
    const formalQuery = (window as any).lastFormalQuery;
    const intentParserResult = (window as any).lastIntentParserResult;

    if (!userQuery) return null;

    return createSimpleQuery(userQuery, formalQuery, intentParserResult);
  }, []);

  // Query Composer handlers
  // Toggle query composer visibility
  const toggleQueryComposer = useCallback(() => {
    setShowQueryComposer((prev) => !prev);
  }, []);

  const handleComposerExecute = useCallback(
    async (
      currentResults: any[],
      mode: "add" | "replace",
      model?: string,
      queryToExecute?: string
    ): Promise<{
      results: any[];
      executionTime?: string;
      tokens?: any;
    } | null> => {
      const queryText = queryToExecute || composerQuery;
      if (!queryText.trim()) return null;

      setIsComposingQuery(true);
      const startTime = Date.now();

      try {
        // Import the search agent invoke function
        const { invokeSearchAgentSecure } = await import(
          "../../../ai/agents/search-agent/ask-your-graph-invoke"
        );

        // Store the current window.lastAskYourGraphResults to restore it later
        const previousResults = (window as any).lastAskYourGraphResults;

        // Execute the new query - let IntentParser process the natural language
        await invokeSearchAgentSecure({
          model: model || defaultModel,
          rootUid: "query-composer", // Unique identifier for composer queries
          targetUid: "query-composer",
          target: mode === "add" ? "add" : "replace", // Use target to indicate mode
          prompt: queryText, // Natural language query for IntentParser
          permissions: { contentAccess: false }, // Secure mode - no content processing
          privateMode: true, // Private mode - only UIDs, no content processing
          previousAgentState: {
            forcePopupOnly: true, // Prevent block insertion - results only for composer
          },
        });

        // Get the results from the global state (where the agent stores them)
        const newResults = (window as any).lastAskYourGraphResults || [];

        // Capture execution metadata
        const executionTime =
          ((Date.now() - startTime) / 1000).toFixed(1) + "s";
        const tokens = getCurrentTokenUsage();

        // Restore the previous results to avoid interfering with the main popup
        (window as any).lastAskYourGraphResults = previousResults;

        if (newResults && Array.isArray(newResults) && newResults.length > 0) {
          if (mode === "replace") {
            // For replace mode, save as a new query (not composed) and update global state
            const currentInfo = (window as any).lastIntentParserResult;
            if (currentInfo && composerQuery.trim()) {
              addRecentQuery({
                userQuery: composerQuery,
                formalQuery: currentInfo.formalQuery || composerQuery,
                intentParserResult: currentInfo,
                isComposed: false,
                querySteps: [],
                pageSelections: [],
              });

              // Update global state so QueryManager shows the new query
              (window as any).lastUserQuery = composerQuery;
              (window as any).lastFormalQuery =
                currentInfo.formalQuery || composerQuery;
              // lastIntentParserResult is already set by the agent execution above
            }
          } else {
            // Add mode: Delegate composition to the QueryManager

            // NOTE: The actual composition logic is now handled by useQueryManager
            // through its unified query state management system. useFullResultsState
            // only handles query execution, not composition state management.

            // The QueryManager will have already set up the composition state properly
            // via setOriginalQueryForComposition() when queries were loaded/selected.

            // Just return the results with a flag to indicate this was an add mode execution
            (newResults as any).__isAddModeExecution = true;
          }

          return { results: newResults, executionTime, tokens };
        } else {
          console.warn(
            `⚠️ [QueryComposer] Query returned no valid results:`,
            newResults
          );
        }
      } catch (error) {
        console.error("Query composer execution failed:", error);
      } finally {
        setIsComposingQuery(false);
      }

      return null;
    },
    [composerQuery]
  );

  // Page querying functionality - optimized to query only matching pages
  const queryAvailablePages = async (query: string = "") => {
    if (isLoadingPages) return;

    setIsLoadingPages(true);
    try {
      let matchingPages: string[] = [];

      if (!query || query.trim().length === 0) {
        // If no query, show some recent or commonly used pages instead of all pages
        const recentPagesQuery = `[:find ?title :where [?page :node/title ?title] :limit 30]`;
        const recentResults = await window.roamAlphaAPI.q(recentPagesQuery);

        if (recentResults && Array.isArray(recentResults)) {
          matchingPages = recentResults
            .map((result) => (Array.isArray(result) ? result[0] : result))
            .filter(
              (title) => typeof title === "string" && title.trim().length > 0
            );
        }
      } else {
        // Use re-pattern syntax and exclude daily notes (MM-DD-YYYY format)
        const escapedQuery = query.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
        const dnpPattern =
          "^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])-(19|20)[0-9][0-9]$";

        const regexQuery = `[:find ?title :where
          [?page :node/title ?title]
          [(re-pattern "(?i)${escapedQuery}") ?search-pattern]
          [(re-find ?search-pattern ?title)]
          [(re-pattern "${dnpPattern}") ?dnp-pattern]
          (not [(re-find ?dnp-pattern ?title)])
        ]`;

        const searchResults = await window.roamAlphaAPI.q(regexQuery);

        if (searchResults && Array.isArray(searchResults)) {
          matchingPages = searchResults
            .map((result) => (Array.isArray(result) ? result[0] : result))
            .filter(
              (title) => typeof title === "string" && title.trim().length > 0
            );
        }
      }

      // Sort by relevance: exact match → starts with → contains (case-insensitive)
      const sortedPages = matchingPages
        .sort((a, b) => {
          const lowerA = a.toLowerCase();
          const lowerB = b.toLowerCase();
          const lowerQuery = query.toLowerCase();

          // Priority scoring (lower score = higher priority)
          const getScore = (title: string) => {
            const lowerTitle = title.toLowerCase();
            if (lowerTitle === lowerQuery) return 0; // Exact match
            if (lowerTitle.startsWith(lowerQuery)) return 1; // Starts with
            return 2; // Contains elsewhere
          };

          const scoreA = getScore(lowerA);
          const scoreB = getScore(lowerB);

          // First sort by relevance score
          if (scoreA !== scoreB) {
            return scoreA - scoreB;
          }

          // If same relevance, sort alphabetically
          return a.localeCompare(b);
        })
        .slice(0, 30); // Limit to 30 results

      setAvailablePages(sortedPages);
    } catch (error) {
      console.error(`❌ [PageQuery] Error querying pages:`, error);
      setAvailablePages([]);
    } finally {
      setIsLoadingPages(false);
    }
  };

  // Load available pages on component mount
  useEffect(() => {
    if (isOpen && availablePages.length === 0) {
      queryAvailablePages();
    }
  }, [isOpen]);

  // Direct Content Selector handlers
  const handleDirectContentAdd = async (
    currentResults: any[],
    setCurrentResults: (results: any[]) => void,
    // Optional parameters - if not provided, use state values
    pagesToAdd?: string[],
    includeContent?: boolean,
    includeRefs?: boolean,
    dnpPeriodDays?: number
  ): Promise<PageSelection[]> => {
    // Use parameters or fall back to state
    const pages = pagesToAdd ?? selectedPages;
    const addContent = includeContent ?? includePageContent;
    const addRefs = includeRefs ?? includeLinkedRefs;
    const dnpDays = dnpPeriodDays ?? dnpPeriod;

    setIsAddingDirectContent(true);

    try {
      // Call the extracted handler
      const result = await directContentHandler(currentResults, {
        selectedPages: pages,
        includePageContent: addContent,
        includeLinkedRefs: addRefs,
        dnpPeriod: dnpDays,
        currentPageContext,
      });

      // Add new results to current results if we have any
      if (result.newResults.length > 0) {
        const existingUids = new Set(
          currentResults.map((r) => r.uid).filter(Boolean)
        );
        const combinedResults = [...currentResults];

        for (const newResult of result.newResults) {
          if (newResult.uid && !existingUids.has(newResult.uid)) {
            combinedResults.push(newResult);
            existingUids.add(newResult.uid);
          }
        }

        setCurrentResults([...combinedResults]);

        // Clear filtered results to trigger re-filtering
        setFilteredAndSortedResults([]);
      }

      return result.addedPageSelections;
    } catch (error) {
      console.error("❌ [DirectContent] Failed to add direct content:", error);
      return [];
    } finally {
      setIsAddingDirectContent(false);
    }
  };

  return {
    // State
    selectedResults,
    dropdownStates,
    isClosing,
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

    // Direct Content Selector state
    selectedPages,
    includePageContent,
    includeLinkedRefs,
    dnpPeriod,
    isAddingDirectContent,
    availablePages,
    isLoadingPages,
    currentPageContext,

    // Setters
    setSelectedResults,
    setDropdownStates,
    setIsClosing,
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
    setViewMode: handleViewModeChange,
    setPageDisplayMode,
    setExpanded,
    setShowChat,
    setChatMessages,
    setChatAccessMode,
    setChatAgentData,
    setChatExpandedResults,
    setIsFullscreen,
    setChatOnlyMode,
    setMainContentWidth,
    setIsResizing,

    // Query Composer setters
    setShowQueryComposer,
    setComposerQuery,
    setIsComposingQuery,

    // Direct Content Selector setters
    setSelectedPages,
    setIncludePageContent,
    setIncludeLinkedRefs,
    setDNPPeriod,
    setIsAddingDirectContent,
    setAvailablePages,
    setIsLoadingPages,

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

    // Query Composer state and handlers
    composerQuery,
    isComposingQuery,
    showQueryComposer,
    handleComposerExecute,
    toggleQueryComposer,

    // Direct Content Selector handlers
    handleDirectContentAdd,
    queryAvailablePages,

    // UI refresh function for external components
    forceUIRefresh,
  };
};
