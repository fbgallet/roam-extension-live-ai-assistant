import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Result,
  ViewMode,
  PageDisplayMode,
  SortBy,
  SortOrder,
  ChatMessage,
  DNPFilter,
} from "../types";
import { StoredQuery } from "../../../ai/agents/search-agent/helpers/queryStorage";
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
import { getSelectedResultsList } from "../utils/chatHelpers";
import { defaultModel, extensionStorage } from "../../..";

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

  // Filtering and sorting state
  const [searchFilter, setSearchFilter] = useState("");
  const [pageFilter, setPageFilter] = useState("all");
  const [dnpFilter, setDNPFilter] = useState<DNPFilter>("all");
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
    console.log("🔄 [useFullResultsState] Forcing UI refresh for new results");
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
          // Import helper function to determine if targetUid is a page
          const { getPageUidByBlockUid } = await import(
            "../../../utils/roamAPI.js"
          );

          // Check if targetUid is itself a page UID or get its page
          const pageUidFromTarget = getPageUidByBlockUid(targetUid);
          if (pageUidFromTarget) {
            pageUid = pageUidFromTarget;
            pageTitle =
              window.roamAlphaAPI?.util?.getPageTitleByPageUid?.(pageUid) ||
              null;
          } else {
            // targetUid might be a page UID itself
            pageTitle =
              window.roamAlphaAPI?.util?.getPageTitleByPageUid?.(targetUid) ||
              null;
            if (pageTitle) {
              pageUid = targetUid;
            }
          }
        }

        // Second priority: Use currently opened page if no valid targetUid context
        if (!pageUid || !pageTitle) {
          const currentOpenUid =
            window.roamAlphaAPI?.ui?.mainWindow?.getOpenPageOrBlockUid?.();
          if (currentOpenUid) {
            // Import helper to get page UID from potentially block UID
            const { getPageUidByBlockUid } = await import(
              "../../../utils/roamAPI.js"
            );

            // Get the actual page UID (in case currentOpenUid is a block UID)
            const actualPageUid =
              getPageUidByBlockUid(currentOpenUid) || currentOpenUid;
            const actualPageTitle =
              window.roamAlphaAPI?.util?.getPageTitleByPageUid?.(actualPageUid);

            if (actualPageTitle) {
              pageUid = actualPageUid;
              pageTitle = actualPageTitle;
            }
          }
        }

        setCurrentPageContext({ uid: pageUid, title: pageTitle });
        console.log(
          `📄 [CurrentPageContext] Initialized: ${
            pageTitle || "No page context"
          } (${pageUid || "No UID"})`
        );
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

      console.log("🔍 Analyzing results structure:", results);
      console.log(
        `🔍 [useFullResultsState] Processing ${results.length} results for UI calculations`
      );
      console.log(
        `Found ${hasBlocks ? "blocks" : "no blocks"} and ${
          hasPages ? "pages" : "no pages"
        }`
      );
      console.log(
        `DNP filter should ${
          shouldShowDNPFilter ? "be shown" : "be hidden"
        } (mixed DNP/non-DNP: ${shouldShowDNPFilter})`
      );

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
          },
          blockContentMap,
          childrenContentMap
        );

        const references = await extractPageReferences(baseFiltered);
        console.log(
          `Extracted ${references.length} page references from filtered results:`,
          references
        );
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
    console.log("💬 [Hook] Reset chat conversation");
  };

  const handleExpandedToggle = () => {
    const newExpanded = !expanded;
    setExpanded(newExpanded);

    // For pages, toggle pageDisplayMode based on expanded state
    if (hasPages && viewMode !== "blocks") {
      setPageDisplayMode(newExpanded ? "metadata" : "embed");
    }
  };

  // Query Composer handlers
  // Toggle query composer visibility
  const toggleQueryComposer = useCallback(() => {
    setShowQueryComposer((prev) => !prev);
  }, []);

  const handleComposerExecute = useCallback(
    async (
      currentResults: any[],
      mode: "add" | "replace",
      model?: string
    ): Promise<any[] | null> => {
      if (!composerQuery.trim()) return null;

      setIsComposingQuery(true);

      try {
        console.log(
          `🔧 [QueryComposer] Executing query: "${composerQuery}" in mode: ${mode}`
        );

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
          prompt: composerQuery, // Natural language query for IntentParser
          permissions: { contentAccess: false }, // Secure mode - no content processing
          privateMode: true, // Private mode - only UIDs, no content processing
          previousAgentState: {
            forcePopupOnly: true, // Prevent block insertion - results only for composer
          },
        });

        // Get the results from the global state (where the agent stores them)
        const newResults = (window as any).lastAskYourGraphResults || [];
        console.log(
          `✅ [QueryComposer] Query executed, got ${newResults.length} results`
        );

        // Restore the previous results to avoid interfering with the main popup
        (window as any).lastAskYourGraphResults = previousResults;

        if (newResults && Array.isArray(newResults) && newResults.length > 0) {
          console.log(
            `✅ [QueryComposer] Query executed successfully, returning ${newResults.length} results`
          );

          if (mode === "replace") {
            // For replace mode, save as a new query (not composed) and update global state
            const { addRecentQuery } = await import(
              "../../../ai/agents/search-agent/helpers/queryStorage"
            );
            const currentInfo = (window as any).lastIntentParserResult;
            if (currentInfo) {
              addRecentQuery({
                userQuery: composerQuery,
                formalQuery: currentInfo.formalQuery || composerQuery,
                intentParserResult: currentInfo,
              });

              // Update global state so QueryManager shows the new query
              (window as any).lastUserQuery = composerQuery;
              (window as any).lastFormalQuery =
                currentInfo.formalQuery || composerQuery;
              // lastIntentParserResult is already set by the agent execution above
            }
          } else {
            // Add mode: Create or update composed query
            console.log(
              `🔍 [QueryComposer] ADD MODE - Current results: ${currentResults.length}, New results: ${newResults.length}`
            );

            // For add mode, update the current query to be composed or add to existing composed query
            const { updateToComposedQuery, getStoredQueries } = await import(
              "../../../ai/agents/search-agent/helpers/queryStorage"
            );

            // For add mode: check if we have original query context for composition
            const originalQueryInfo = (window as any)
              .__originalQueryForComposition;
            const queries = getStoredQueries();
            console.log(`🔍 [QueryComposer] Current stored queries:`, {
              recentCount: queries.recent.length,
              savedCount: queries.saved.length,
              recentQueries: queries.recent.map((q) => ({
                id: q.id,
                userQuery: q.userQuery,
                isComposed: q.isComposed,
              })),
              hasOriginalContext: !!originalQueryInfo,
            });

            let targetQuery: StoredQuery | null = null;

            if (originalQueryInfo) {
              // We have original query context - find the original query to compose with
              const allQueries = [...queries.recent, ...queries.saved];
              targetQuery = allQueries.find(
                (q) => q.userQuery === originalQueryInfo.userQuery
              );

              console.log(
                `🔗 [QueryComposer] Using original query for composition:`,
                {
                  originalQueryText: originalQueryInfo.userQuery,
                  foundInStorage: !!targetQuery,
                  newQueryToAdd: composerQuery,
                }
              );

              // Clear the original query context after using it
              (window as any).__originalQueryForComposition = null;
            } else if (queries.recent.length > 0) {
              // Fallback: use the most recent query as the base for composition
              targetQuery = queries.recent[0];
              console.log(
                `🔍 [QueryComposer] No original context - using most recent query:`,
                {
                  baseQueryId: targetQuery.id,
                  baseQueryText: targetQuery.userQuery,
                  baseQueryIsComposed: targetQuery.isComposed,
                  existingSteps: targetQuery.querySteps?.length || 0,
                  newQueryToAdd: composerQuery,
                }
              );
            }

            if (targetQuery) {
              const currentInfo = (window as any).lastIntentParserResult;

              if (currentInfo) {
                // Create a temporary composed query structure in memory (NOT saved to storage)

                console.log(
                  `🔗 [QueryComposer] Creating temporary composed query from:`,
                  {
                    baseQuery: targetQuery.userQuery,
                    addedQuery: composerQuery,
                    originalQueryId: targetQuery.id,
                  }
                );

                // Create temporary composed query structure
                const tempComposedQuery = {
                  id: `temp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
                  timestamp: new Date(),
                  userQuery: targetQuery.userQuery, // Use original base query
                  formalQuery: targetQuery.formalQuery || targetQuery.userQuery,
                  intentParserResult: targetQuery.intentParserResult,
                  isComposed: true,
                  querySteps: [
                    {
                      userQuery: composerQuery,
                      formalQuery: currentInfo.formalQuery || composerQuery,
                    },
                  ],
                  pageSelections: [], // No page selections for now
                };

                console.log(
                  `✅ [QueryComposer] Created temporary composed query (NOT saved to storage)`,
                  {
                    id: tempComposedQuery.id,
                    baseQuery: tempComposedQuery.userQuery,
                    querySteps: tempComposedQuery.querySteps.length,
                    isComposed: tempComposedQuery.isComposed
                  }
                );

                // Store the temporary composed query in window for current session
                (window as any).__currentComposedQuery = tempComposedQuery;

                // Return special flag to indicate composed query was created
                (newResults as any).__composedQueryCreated = true;
                (newResults as any).__composedQueryId = tempComposedQuery.id;
                (newResults as any).__tempComposedQuery = tempComposedQuery;
              } else {
                console.warn(
                  `⚠️ [QueryComposer] No IntentParser result available for composition`
                );
              }
            } else {
              console.warn(
                `⚠️ [QueryComposer] No recent queries available for composition`
              );
            }
          }

          return newResults;
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

        console.log(
          `🔍 [PageQuery] Executing query for "${query}":`,
          regexQuery
        );

        const searchResults = await window.roamAlphaAPI.q(regexQuery);
        console.log(`🔍 [PageQuery] Raw results:`, searchResults);

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
      console.log(
        `✅ [PageQuery] Found ${sortedPages.length} pages matching "${query}"`
      );
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
    setCurrentResults: (results: any[]) => void
  ) => {
    if (!includePageContent && !includeLinkedRefs) {
      console.warn("⚠️ [DirectContent] No content types selected");
      return;
    }

    setIsAddingDirectContent(true);
    const newResults: any[] = [];

    try {
      console.log(
        `🔧 [DirectContent] Adding content from: ${selectedPages.length} selected pages`
      );
      console.log(
        `📋 [DirectContent] Selected pages: ${selectedPages.join(", ")}`
      );
      console.log(
        `📋 [DirectContent] Content types: ${
          includePageContent ? "content" : ""
        } ${includeLinkedRefs ? "linkedRefs" : ""}`
      );

      let targetPageTitle = `${selectedPages.length} selected pages`;
      let pageData: Array<{ title: string; uid: string | null }> = [];

      // Process each selected page - keep both title and UID
      for (const pageSelection of selectedPages) {
        if (pageSelection === "current") {
          // Use current page context established when popup opened
          if (currentPageContext.uid && currentPageContext.title) {
            pageData.push({
              title: currentPageContext.title,
              uid: currentPageContext.uid,
            });
          } else {
            console.warn(
              "⚠️ [DirectContent] No current page context available"
            );
          }
        } else if (pageSelection === "dnp") {
          // Get Daily Notes Pages for the specified period using getYesterdayDate utility
          const { getYesterdayDate } = await import(
            "../../../utils/roamAPI.js"
          );

          console.log(
            `🗓️ [DirectContent] Getting DNPs for last ${dnpPeriod} days`
          );

          let currentDate = new Date(); // Start from today
          let foundDnpCount = 0;

          for (let i = 0; i < dnpPeriod; i++) {
            // Get previous date for each iteration (going backwards in time)
            if (i > 0) {
              currentDate = getYesterdayDate(currentDate);
            }

            // Generate the DNP UID format (MM-DD-YYYY)
            const dnpUid = `${String(currentDate.getMonth() + 1).padStart(
              2,
              "0"
            )}-${String(currentDate.getDate()).padStart(
              2,
              "0"
            )}-${currentDate.getFullYear()}`;

            // Convert to proper page title using Roam's dateToPageTitle API
            const pageTitle =
              window.roamAlphaAPI?.util?.dateToPageTitle?.(currentDate);

            console.log(
              `🗓️ [DirectContent] Checking DNP: ${dnpUid} -> "${pageTitle}"`
            );

            // Check if the DNP page exists using the UID (which we already have)
            const pageExists =
              window.roamAlphaAPI?.util?.getPageUidByPageTitle?.(pageTitle);

            if (pageExists || pageTitle) {
              // We can use the dnpUid directly as the page UID, and pageTitle as the display title
              pageData.push({
                title: pageTitle || dnpUid, // Use proper title if available, fallback to UID
                uid: dnpUid, // The DNP UID is the page UID
              });
              foundDnpCount++;
              console.log(
                `✅ [DirectContent] Found DNP: "${pageTitle}" (UID: ${dnpUid})`
              );
            } else {
              console.log(
                `⚠️ [DirectContent] DNP not found: ${dnpUid} -> "${pageTitle}"`
              );
            }
          }

          console.log(
            `🗓️ [DirectContent] Found ${foundDnpCount} out of ${dnpPeriod} DNPs`
          );

          if (foundDnpCount === 0) {
            console.warn(
              `⚠️ [DirectContent] No Daily Notes Pages found for the last ${dnpPeriod} days. Make sure you have created some DNPs.`
            );
          }
        } else {
          // Specific page selected from autocomplete - we already have the title!
          const { getPageUidByPageName } = await import(
            "../../../utils/roamAPI.js"
          );
          const pageUid = getPageUidByPageName(pageSelection);
          if (pageUid) {
            pageData.push({
              title: pageSelection, // Use the original title from selection
              uid: pageUid,
            });
            console.log(
              `✅ [DirectContent] Found UID for "${pageSelection}": ${pageUid}`
            );
          } else {
            console.warn(
              `⚠️ [DirectContent] Could not find UID for page: "${pageSelection}"`
            );
          }
        }
      }

      console.log(
        `🔍 [DirectContent] Found ${pageData.length} page(s) for ${targetPageTitle}`
      );

      // Process each page using both title and UID
      for (const { title: pageTitle, uid: pageUid } of pageData) {
        if (!pageUid) {
          console.warn(
            `⚠️ [DirectContent] Skipping page "${pageTitle}" - no UID found`
          );
          continue;
        }

        if (includePageContent) {
          // Add page content directly with full metadata consistent with normal queries
          try {
            const pageQuery = `[:find ?page-uid ?page-title ?page-created ?page-modified (pull ?page [:block/uid :block/string :node/title {:block/children ...}])
              :where
              [?page :block/uid ?page-uid]
              [?page :node/title ?page-title]
              [?page :create/time ?page-created]
              [?page :edit/time ?page-modified]
              [(= ?page-uid "${pageUid}")]]`;

            const pageData = await window.roamAlphaAPI.q(pageQuery);

            if (pageData && pageData.length > 0) {
              const [pageUid, pageTitle, pageCreated, pageModified, pullData] =
                pageData[0];
              const { isDailyNote } = await import(
                "../../../ai/agents/search-agent/helpers/searchUtils"
              );

              // Add the page itself as a result with full metadata
              newResults.push({
                uid: pageUid,
                title: pageTitle,
                content: pullData[":block/string"] || `Page: ${pageTitle}`,
                created: new Date(pageCreated),
                modified: new Date(pageModified),
                pageTitle: pageTitle,
                pageUid: pageUid,
                isDaily: isDailyNote(pageUid),
                totalBlocks: pullData[":block/children"]?.length || 0,
                isPage: true,
                children: [],
                parents: [],
                expansionLevel: 0,
              });

              // Add children blocks recursively with consistent metadata
              const addChildrenBlocks = (
                children: any[],
                parentPageTitle: string,
                parentPageUid: string
              ) => {
                if (!children || !Array.isArray(children)) return;

                children.forEach((child) => {
                  if (child[":block/uid"] && child[":block/string"]) {
                    newResults.push({
                      uid: child[":block/uid"],
                      content: child[":block/string"],
                      created: new Date(pageCreated), // Use page creation date as fallback
                      modified: new Date(pageModified), // Use page modification date as fallback
                      pageTitle: parentPageTitle,
                      pageUid: parentPageUid,
                      isDaily: isDailyNote(parentPageUid),
                      children: [],
                      parents: [],
                      isPage: false,
                      expansionLevel: 0,
                    });
                  }

                  // Recursively add children
                  if (child[":block/children"]) {
                    addChildrenBlocks(
                      child[":block/children"],
                      parentPageTitle,
                      parentPageUid
                    );
                  }
                });
              };

              if (pullData[":block/children"]) {
                addChildrenBlocks(
                  pullData[":block/children"],
                  pageTitle,
                  pageUid
                );
              }
            }
          } catch (error) {
            console.error(
              `❌ [DirectContent] Error adding page content for ${pageTitle}:`,
              error
            );
          }
        }

        if (includeLinkedRefs) {
          // Add linked references using findBlocksByContent tool with consistent metadata
          try {
            // Import the tool
            const { findBlocksByContentImpl } = await import(
              "../../../ai/agents/search-agent/tools/findBlocksByContent/findBlocksByContentTool"
            );

            const linkedRefs = await findBlocksByContentImpl({
              conditions: [
                {
                  type: "page_ref",
                  text: pageTitle,
                  matchType: "contains",
                },
              ],
              includeChildren: true,
              includeParents: false,
              includeDaily: true, // Include Daily Notes in linked references search
              resultMode: "full",
              limit: 1000,
              secureMode: false,
            });

            // Process linked references results - they already have full metadata
            if (
              linkedRefs &&
              linkedRefs.results &&
              Array.isArray(linkedRefs.results)
            ) {
              linkedRefs.results.forEach((ref: any) => {
                // The results from findBlocksByContentImpl already have consistent metadata
                if (ref.uid && ref.content) {
                  newResults.push({
                    ...ref, // Use the full metadata structure from the tool
                    referenceContext: `References: ${pageTitle}`,
                  });
                }
              });
            }
          } catch (error) {
            console.error(
              `❌ [DirectContent] Error adding linked references for ${pageTitle}:`,
              error
            );
          }
        }
      }

      console.log(
        `✅ [DirectContent] Collected ${newResults.length} results from ${targetPageTitle}`
      );

      // Add to current results if we have new content
      if (newResults.length > 0) {
        const existingUids = new Set(
          currentResults.map((r) => r.uid).filter(Boolean)
        );
        let addedCount = 0;
        const combinedResults = [...currentResults];

        for (const newResult of newResults) {
          if (newResult.uid && !existingUids.has(newResult.uid)) {
            combinedResults.push(newResult);
            existingUids.add(newResult.uid);
            addedCount++;
          }
        }

        console.log(
          `📊 [DirectContent] Added ${addedCount} new results (${
            newResults.length - addedCount
          } duplicates filtered)`
        );
        setCurrentResults([...combinedResults]);

        // Clear filtered results to trigger re-filtering
        setFilteredAndSortedResults([]);

        // Success feedback
        console.log(
          `✨ [DirectContent] Successfully added content from ${targetPageTitle}`
        );
      } else {
        console.warn(
          `⚠️ [DirectContent] No content found for ${targetPageTitle}`
        );
      }
    } catch (error) {
      console.error("❌ [DirectContent] Failed to add direct content:", error);
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
