import { useState, useEffect, useMemo } from "react";
import {
  Result,
  ViewMode,
  PageDisplayMode,
  SortBy,
  SortOrder,
  ChatMessage,
  ChatMode,
  DNPFilter,
} from "../types";
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
import { extensionStorage } from "../../..";

export const useFullResultsState = (results: Result[], isOpen: boolean) => {
  // Selection state
  const [selectedResults, setSelectedResults] = useState<Set<number>>(
    new Set()
  );
  const [dropdownStates, setDropdownStates] = useState<Record<string, boolean>>(
    {}
  );
  const [isClosing, setIsClosing] = useState(false);

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
    };
  };

  const [showMetadata, setShowMetadata] = useState(
    () => getStoredPreferences().showMetadata
  );
  const [showPaths, setShowPaths] = useState(
    () => getStoredPreferences().showPaths
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
    };
    extensionStorage.set("fullResultsPreferences", preferences);
  }, [showMetadata, showPaths]);

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

  // Reset state when popup opens
  useEffect(() => {
    if (isOpen) {
      setSelectedResults(new Set());
      setSearchFilter("");
      setPageFilter("all");
      setDNPFilter("all");
      setCurrentPage(1);
      setViewMode("mixed"); // Always show mixed view by default

      // Reset chat state only on popup open (not just toggle)
      setShowChat(false);

      // Reset references filters
      setIncludedReferences([]);
      setExcludedReferences([]);
      setAvailableReferences([]);
      setFilteredAndSortedResults([]);
      setBlockContentMap(new Map());
      setChildrenContentMap(new Map());
    }
  }, [isOpen]);

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

  // Apply filtering and sorting asynchronously
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
    setShowChat,
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
  };
};
