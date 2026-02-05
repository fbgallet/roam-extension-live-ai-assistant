import { Result, ViewMode, SortBy, SortOrder, DNPFilter, SelectionFilter } from "../types/types";

export interface FilterAndSortOptions {
  searchFilter: string;
  pageFilter: string;
  sortBy: SortBy;
  sortOrder: SortOrder;
  viewMode: ViewMode;
  dnpFilter: DNPFilter;
  selectionFilter?: SelectionFilter;
  selectedIndices?: Set<number>;
  allResults?: Result[]; // Original results array needed to map indices
}

export const filterAndSortResults = async (
  results: Result[],
  options: FilterAndSortOptions,
  blockContentMap?: Map<string, string>,
  childrenContentMap?: Map<string, string[]>
): Promise<Result[]> => {
  const { searchFilter, pageFilter, sortBy, sortOrder, viewMode, dnpFilter, selectionFilter, selectedIndices, allResults } =
    options;

  let filtered = results.filter((result) => {
    // View mode filter - use same logic as detection
    const isBlock = result.uid && result.pageUid;
    const isPage = result.uid && !result.pageUid;

    if (viewMode === "blocks" && !isBlock) return false;
    if (viewMode === "pages" && !isPage) return false;
    // "mixed" shows both

    // DNP filter
    if (dnpFilter !== "all") {
      const resultIsDNP =
        result.isDaily !== undefined
          ? result.isDaily
          : isDailyNotePage(result.pageTitle || "");

      if (dnpFilter === "dnp-only" && !resultIsDNP) return false;
      if (dnpFilter === "no-dnp" && resultIsDNP) return false;
    }

    // Enhanced search filter - includes actual block content and children content
    if (searchFilter) {
      const searchLower = searchFilter.toLowerCase();

      // Check actual block content from Roam API
      let blockContent = "";
      if (blockContentMap && result.uid) {
        blockContent = blockContentMap.get(result.uid) || "";
      }
      // Fallback to result content fields (probably empty based on debug)
      const fallbackContent =
        result.content || result.text || result.string || "";
      const actualContent = blockContent || fallbackContent;

      const matchesContent = actualContent.toLowerCase().includes(searchLower);

      // Check page title
      const matchesPage = result.pageTitle?.toLowerCase().includes(searchLower);

      // Check children content if available
      let matchesChildren = false;
      if (childrenContentMap && result.uid) {
        const childrenTexts = childrenContentMap.get(result.uid) || [];
        matchesChildren = childrenTexts.some((childText) =>
          childText.toLowerCase().includes(searchLower)
        );
      }

      if (!matchesContent && !matchesPage && !matchesChildren) return false;
    }

    // Page filter
    if (pageFilter !== "all" && result.pageTitle !== pageFilter) {
      return false;
    }

    return true;
  });

  // Apply selection filter
  if (selectionFilter === "selected-only" && selectedIndices && allResults) {
    filtered = filtered.filter((result) => {
      const originalIndex = allResults.indexOf(result);
      return selectedIndices.has(originalIndex);
    });
  }

  // Sort results
  filtered.sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "selection":
        // Sort by selection status (selected items first)
        if (selectedIndices && allResults) {
          const indexA = allResults.indexOf(a);
          const indexB = allResults.indexOf(b);
          const isSelectedA = selectedIndices.has(indexA);
          const isSelectedB = selectedIndices.has(indexB);

          if (isSelectedA && !isSelectedB) return -1;
          if (!isSelectedA && isSelectedB) return 1;
          // If both selected or both unselected, maintain original order
          return indexA - indexB;
        }
        comparison = 0;
        break;
      case "date":
        const dateA = new Date(a.modified || a.created || 0);
        const dateB = new Date(b.modified || b.created || 0);
        comparison = dateA.getTime() - dateB.getTime();
        break;
      case "page":
        comparison = (a.pageTitle || "").localeCompare(b.pageTitle || "");
        break;
      case "content-alpha":
        // Get actual content from the content map and sort alphabetically
        const contentAlphaA =
          blockContentMap?.get(a.uid || "") || a.content || a.text || "";
        const contentAlphaB =
          blockContentMap?.get(b.uid || "") || b.content || b.text || "";
        // Extract only alphanumeric characters for sorting comparison
        const alphaOnlyA = contentAlphaA.replace(/[^a-zA-Z0-9\s]/g, "").trim();
        const alphaOnlyB = contentAlphaB.replace(/[^a-zA-Z0-9\s]/g, "").trim();
        comparison = alphaOnlyA.localeCompare(alphaOnlyB);
        break;
      case "content-length":
        // Get actual content from the content map and sort by length
        const contentLengthA =
          blockContentMap?.get(a.uid || "") || a.content || a.text || "";
        const contentLengthB =
          blockContentMap?.get(b.uid || "") || b.content || b.text || "";
        comparison = contentLengthA.length - contentLengthB.length;
        break;
      case "relevance":
      default:
        // For relevance, maintain original order (ignore sortOrder)
        const indexA = results.indexOf(a);
        const indexB = results.indexOf(b);
        // Return directly without sortOrder reversal - relevance preserves original order
        return indexA - indexB;
    }

    return sortOrder === "desc" ? -comparison : comparison;
  });

  return filtered;
};

export const paginateResults = (
  results: Result[],
  currentPage: number,
  resultsPerPage: number
): Result[] => {
  const startIndex = (currentPage - 1) * resultsPerPage;
  return results.slice(startIndex, startIndex + resultsPerPage);
};

export const calculateTotalPages = (
  totalResults: number,
  resultsPerPage: number
): number => {
  return Math.ceil(totalResults / resultsPerPage);
};

export const getUniquePages = (results: Result[]): Set<string> => {
  const pages = new Set<string>();
  results.forEach((result) => {
    if (result.pageTitle) {
      pages.add(result.pageTitle);
    }
  });
  return pages;
};

export const detectResultTypes = (
  results: Result[]
): { hasBlocks: boolean; hasPages: boolean } => {
  let hasBlocks = false;
  let hasPages = false;

  results.forEach((result) => {
    // Detect if this is a block result or page result
    // Block: has both uid AND pageUid (block is inside a page)
    // Page: has uid but NO pageUid (page itself doesn't have a parent page)
    const isBlockResult = result.uid && result.pageUid;
    const isPageResult = result.uid && !result.pageUid;

    if (isBlockResult) {
      hasBlocks = true;
    } else if (isPageResult) {
      hasPages = true;
    }
  });

  return { hasBlocks, hasPages };
};

// Function to check if a page title is a Daily Notes Page
export const isDailyNotePage = (pageTitle: string): boolean => {
  if (!pageTitle) return false;

  // Common DNP patterns:
  // MM-dd-yyyy (e.g., "12-25-2023")
  // MMMM do, yyyy (e.g., "December 25th, 2023")
  // Other date formats that Roam might use
  const patterns = [
    /^\d{1,2}-\d{1,2}-\d{4}$/, // MM-dd-yyyy or M-d-yyyy
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(st|nd|rd|th),\s+\d{4}$/, // Full month name
    /^\d{4}-\d{1,2}-\d{1,2}$/, // yyyy-MM-dd
    /^\d{1,2}\/\d{1,2}\/\d{4}$/, // MM/dd/yyyy
  ];

  return patterns.some((pattern) => pattern.test(pageTitle));
};

// Function to detect DNP distribution in results
export const detectDNPDistribution = (
  results: Result[]
): { hasDNP: boolean; hasNonDNP: boolean; shouldShowDNPFilter: boolean } => {
  let hasDNP = false;
  let hasNonDNP = false;

  results.forEach((result) => {
    if (result.pageTitle) {
      if (isDailyNotePage(result.pageTitle)) {
        hasDNP = true;
      } else {
        hasNonDNP = true;
      }
    } else if (result.isDaily !== undefined) {
      // Use explicit isDaily property if available
      if (result.isDaily) {
        hasDNP = true;
      } else {
        hasNonDNP = true;
      }
    } else {
      // If no page title and no isDaily info, assume non-DNP
      hasNonDNP = true;
    }
  });

  // Only show DNP filter if there's a mix of both DNP and non-DNP
  const shouldShowDNPFilter = hasDNP && hasNonDNP;

  return { hasDNP, hasNonDNP, shouldShowDNPFilter };
};

// Text highlighting utility
export const highlightSearchTerm = (
  text: string,
  searchTerm: string
): string => {
  if (!searchTerm || !text) return text;

  const regex = new RegExp(
    `(${searchTerm.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")})`,
    "gi"
  );
  return text.replace(regex, '<mark class="search-highlight">$1</mark>');
};

// Function to get highlighted content for rendering
export const getHighlightedContent = (
  result: Result,
  searchFilter: string
): { content: string; hasHighlight: boolean } => {
  if (!searchFilter) {
    return {
      content: result.content || result.text || "",
      hasHighlight: false,
    };
  }

  const originalContent = result.content || result.text || "";
  const highlightedContent = highlightSearchTerm(originalContent, searchFilter);
  const hasHighlight = highlightedContent !== originalContent;

  return { content: highlightedContent, hasHighlight };
};

// Reference extraction utilities
export interface PageReference {
  title: string;
  count: number;
  isDaily?: boolean;
  isResultPage?: boolean; // True if this page contains result blocks
  isReferencedPage?: boolean; // True if this page is referenced by result blocks
}

// Separate queries for each type of reference to avoid binding issues

// Query 1: References from the target blocks themselves
const SELF_REFERENCES_QUERY = `
  [:find ?page-title ?block-uid
   :in $ [?block-uid ...]
   :where
   [?block :block/uid ?block-uid]
   [?block :block/refs ?page]
   [?page :node/title ?page-title]]
`;

// Query 2: References from children of target blocks
const CHILDREN_REFERENCES_QUERY = `
  [:find ?page-title ?parent-uid
   :in $ [?parent-uid ...]
   :where
   [?parent :block/uid ?parent-uid]
   [?child :block/parents ?parent]
   [?child :block/refs ?page]
   [?page :node/title ?page-title]]
`;

// Query 3: References from direct parents of target blocks
const PARENT_REFERENCES_QUERY = `
  [:find ?page-title ?child-uid
   :in $ [?child-uid ...]
   :where
   [?child :block/uid ?child-uid]
   [?child :block/parents ?parent]
   [?parent :block/refs ?page]
   [?page :node/title ?page-title]]
`;

// Query 4: Get children content for search functionality
const CHILDREN_CONTENT_QUERY = `
  [:find ?child-content ?parent-uid
   :in $ [?parent-uid ...]
   :where
   [?parent :block/uid ?parent-uid]
   [?child :block/parents ?parent]
   [?child :block/string ?child-content]]
`;

// Query 5: Get block content for search functionality
const BLOCK_CONTENT_QUERY = `
  [:find ?block-content ?block-uid
   :in $ [?block-uid ...]
   :where
   [?block :block/uid ?block-uid]
   [?block :block/string ?block-content]]
`;

// Cache for children content and block content to avoid repeated queries
let childrenContentCache = new Map<string, string[]>();
let blockContentCache = new Map<string, string>();
let lastCacheUpdate = 0;
const CACHE_DURATION = 30000; // 30 seconds

// Performance limit: Skip children content for large result sets
const MAX_BLOCKS_FOR_CHILDREN_CONTENT = 500;

// Function to get both block content and children content for search
export const getBlockAndChildrenContent = async (
  results: Result[]
): Promise<{
  blockContent: Map<string, string>;
  childrenContent: Map<string, string[]>;
}> => {
  const now = Date.now();

  // Check if cache is still valid
  if (
    now - lastCacheUpdate < CACHE_DURATION &&
    blockContentCache.size > 0 &&
    childrenContentCache.size > 0
  ) {
    return {
      blockContent: blockContentCache,
      childrenContent: childrenContentCache,
    };
  }

  const blockUids = results
    .filter((result) => result.uid)
    .map((result) => result.uid);

  if (blockUids.length === 0) {
    return {
      blockContent: new Map(),
      childrenContent: new Map(),
    };
  }

  const shouldFetchChildren =
    blockUids.length <= MAX_BLOCKS_FOR_CHILDREN_CONTENT;

  try {
    // Always fetch block content, conditionally fetch children content
    const queries = [window.roamAlphaAPI.q(BLOCK_CONTENT_QUERY, blockUids)];

    if (shouldFetchChildren) {
      queries.push(window.roamAlphaAPI.q(CHILDREN_CONTENT_QUERY, blockUids));
    }

    const [blockContentResults, childrenContentResults] = await Promise.all(
      queries
    );

    // Clear and populate block content cache
    blockContentCache.clear();
    if (blockContentResults && Array.isArray(blockContentResults)) {
      blockContentResults.forEach(([content, blockUid]) => {
        if (
          content &&
          blockUid &&
          typeof content === "string" &&
          typeof blockUid === "string"
        ) {
          blockContentCache.set(blockUid, content);
        }
      });
    }

    // Clear and populate children content cache (only if fetched)
    childrenContentCache.clear();
    if (
      shouldFetchChildren &&
      childrenContentResults &&
      Array.isArray(childrenContentResults)
    ) {
      childrenContentResults.forEach(([content, parentUid]) => {
        if (
          content &&
          parentUid &&
          typeof content === "string" &&
          typeof parentUid === "string"
        ) {
          if (!childrenContentCache.has(parentUid)) {
            childrenContentCache.set(parentUid, []);
          }
          childrenContentCache.get(parentUid)!.push(content);
        }
      });
    }

    lastCacheUpdate = now;

    return {
      blockContent: blockContentCache,
      childrenContent: childrenContentCache,
    };
  } catch (error) {
    console.warn("Failed to query block and children content:", error);
    return {
      blockContent: new Map(),
      childrenContent: new Map(),
    };
  }
};

// Legacy function for backward compatibility
export const getChildrenContent = async (
  results: Result[]
): Promise<Map<string, string[]>> => {
  const { childrenContent } = await getBlockAndChildrenContent(results);
  return childrenContent;
};

// Extract all page references and their counts from results
export const extractPageReferences = async (
  results: Result[]
): Promise<PageReference[]> => {
  const referenceMap = new Map<string, PageReference>();

  // First, add all page titles where blocks are located (result pages)
  results.forEach((result) => {
    if (result.pageTitle) {
      const existing = referenceMap.get(result.pageTitle);
      if (existing) {
        existing.count++;
        existing.isResultPage = true; // Mark as containing results
      } else {
        referenceMap.set(result.pageTitle, {
          title: result.pageTitle,
          count: 1,
          isDaily: result.isDaily || isDailyNotePage(result.pageTitle),
          isResultPage: true, // This page contains result blocks
          isReferencedPage: false,
        });
      }
    }
  });

  // Extract all block UIDs from the results
  const blockUids = results
    .filter((result) => result.uid && !result.isPage)
    .map((result) => result.uid);

  // Extract all page UIDs from the results
  const pageUids = results
    .filter((result) => result.isPage)
    .map((result) => result.uid);

  if (blockUids.length === 0 && pageUids.length === 0) {
    return Array.from(referenceMap.values());
  }

  try {
    // Run all three queries in parallel
    const [selfRefs, childrenRefs, parentRefs, pageContentRefs] =
      await Promise.all([
        window.roamAlphaAPI.q(SELF_REFERENCES_QUERY, blockUids),
        window.roamAlphaAPI.q(CHILDREN_REFERENCES_QUERY, blockUids),
        window.roamAlphaAPI.q(PARENT_REFERENCES_QUERY, blockUids),
        window.roamAlphaAPI.q(CHILDREN_REFERENCES_QUERY, pageUids),
      ]);

    // Helper function to process referenced pages
    const processReferences = (refs: any[]) => {
      if (refs && Array.isArray(refs)) {
        refs.forEach(([pageTitle]) => {
          if (pageTitle && typeof pageTitle === "string") {
            const existing = referenceMap.get(pageTitle);
            if (existing) {
              existing.count++;
              existing.isReferencedPage = true; // Mark as referenced
            } else {
              // Check if it's a daily note format
              const isDaily = isDailyNotePage(pageTitle);

              referenceMap.set(pageTitle, {
                title: pageTitle,
                count: 1,
                isDaily: isDaily,
                isResultPage: false, // This page doesn't contain results
                isReferencedPage: true, // This page is referenced by results
              });
            }
          }
        });
      }
    };

    // Process all reference types
    processReferences(selfRefs);
    processReferences(childrenRefs);
    processReferences(parentRefs);
    processReferences(pageContentRefs);
  } catch (error) {
    console.warn(
      "Failed to query block references using Roam API, falling back to text parsing:",
      error
    );

    // Fallback to text parsing if the API query fails
    results.forEach((result) => {
      const content = result.content || result.text || "";

      // Extract [[page]] references
      const pageMatches = content.match(/\[\[([^\]]+)\]\]/g);
      if (pageMatches) {
        pageMatches.forEach((match) => {
          const pageTitle = match.slice(2, -2);
          const existing = referenceMap.get(pageTitle);
          if (existing) {
            existing.count++;
            existing.isReferencedPage = true;
          } else {
            referenceMap.set(pageTitle, {
              title: pageTitle,
              count: 1,
              isDaily: isDailyNotePage(pageTitle),
              isResultPage: false,
              isReferencedPage: true,
            });
          }
        });
      }

      // Extract #tag references
      const tagMatches = content.match(/#([a-zA-Z0-9\-_\/]+)/g);
      if (tagMatches) {
        tagMatches.forEach((match) => {
          const pageTitle = match.slice(1);
          const existing = referenceMap.get(pageTitle);
          if (existing) {
            existing.count++;
            existing.isReferencedPage = true;
          } else {
            referenceMap.set(pageTitle, {
              title: pageTitle,
              count: 1,
              isDaily: false,
              isResultPage: false,
              isReferencedPage: true,
            });
          }
        });
      }
    });
  }

  // Convert to array and sort by count (descending) then by title
  return Array.from(referenceMap.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.title.localeCompare(b.title);
  });
};

// Filter results based on included and excluded references using Roam API
export const filterResultsByReferences = async (
  results: Result[],
  includedRefs: string[],
  excludedRefs: string[]
): Promise<Result[]> => {
  if (includedRefs.length === 0 && excludedRefs.length === 0) {
    return results;
  }

  // Handle "All Daily Notes" special filter
  const processedIncludedRefs = [...includedRefs];
  const processedExcludedRefs = [...excludedRefs];
  let includeOnlyDNP = false;
  let excludeAllDNP = false;

  // Check for "All Daily Notes" in includes
  const dnpIncludeIndex = processedIncludedRefs.indexOf("All Daily Notes");
  if (dnpIncludeIndex !== -1) {
    includeOnlyDNP = true;
    processedIncludedRefs.splice(dnpIncludeIndex, 1); // Remove from array to avoid API queries
  }

  // Check for "All Daily Notes" in excludes
  const dnpExcludeIndex = processedExcludedRefs.indexOf("All Daily Notes");
  if (dnpExcludeIndex !== -1) {
    excludeAllDNP = true;
    processedExcludedRefs.splice(dnpExcludeIndex, 1); // Remove from array to avoid API queries
  }

  // If only DNP filtering is needed, handle it directly
  if (
    processedIncludedRefs.length === 0 &&
    processedExcludedRefs.length === 0
  ) {
    return results.filter((result) => {
      const resultIsDNP =
        result.isDaily !== undefined
          ? result.isDaily
          : isDailyNotePage(result.pageTitle || "");

      if (includeOnlyDNP && !resultIsDNP) return false;
      if (excludeAllDNP && resultIsDNP) return false;

      return true;
    });
  }

  // Get block UIDs for API query
  const blockUids = results
    .filter((result) => result.uid)
    .map((result) => result.uid);

  if (blockUids.length === 0) {
    return results; // No blocks to filter
  }

  try {
    // Create a map to store which references each block has
    const blockRefMap = new Map<string, Set<string>>();

    // Initialize with page titles
    results.forEach((result) => {
      if (result.uid && result.pageTitle) {
        if (!blockRefMap.has(result.uid)) {
          blockRefMap.set(result.uid, new Set());
        }
        blockRefMap.get(result.uid)!.add(result.pageTitle);
      }
    });

    // Run all three queries in parallel for filtering
    const [selfRefs, childrenRefs, parentRefs] = await Promise.all([
      window.roamAlphaAPI.q(SELF_REFERENCES_QUERY, blockUids),
      window.roamAlphaAPI.q(CHILDREN_REFERENCES_QUERY, blockUids),
      window.roamAlphaAPI.q(PARENT_REFERENCES_QUERY, blockUids),
    ]);

    // Process self references
    if (selfRefs && Array.isArray(selfRefs)) {
      selfRefs.forEach(([pageTitle, blockUid]) => {
        if (
          pageTitle &&
          blockUid &&
          typeof pageTitle === "string" &&
          typeof blockUid === "string"
        ) {
          if (!blockRefMap.has(blockUid)) {
            blockRefMap.set(blockUid, new Set());
          }
          blockRefMap.get(blockUid)!.add(pageTitle);
        }
      });
    }

    // Process children references (associate with parent block)
    if (childrenRefs && Array.isArray(childrenRefs)) {
      childrenRefs.forEach(([pageTitle, parentUid]) => {
        if (
          pageTitle &&
          parentUid &&
          typeof pageTitle === "string" &&
          typeof parentUid === "string"
        ) {
          if (!blockRefMap.has(parentUid)) {
            blockRefMap.set(parentUid, new Set());
          }
          blockRefMap.get(parentUid)!.add(pageTitle);
        }
      });
    }

    // Process parent references (associate with child block)
    if (parentRefs && Array.isArray(parentRefs)) {
      parentRefs.forEach(([pageTitle, childUid]) => {
        if (
          pageTitle &&
          childUid &&
          typeof pageTitle === "string" &&
          typeof childUid === "string"
        ) {
          if (!blockRefMap.has(childUid)) {
            blockRefMap.set(childUid, new Set());
          }
          blockRefMap.get(childUid)!.add(pageTitle);
        }
      });
    }

    // Filter results based on references and DNP
    return results.filter((result) => {
      if (!result.uid) return true; // Keep results without UIDs

      const resultRefs = blockRefMap.get(result.uid) || new Set();
      const resultIsDNP =
        result.isDaily !== undefined
          ? result.isDaily
          : isDailyNotePage(result.pageTitle || "");

      // Check DNP exclusions first
      if (excludeAllDNP && resultIsDNP) return false;

      // Check standard exclusions (exclusions take priority)
      for (const excludedRef of processedExcludedRefs) {
        if (resultRefs.has(excludedRef)) {
          return false;
        }
      }

      // Check inclusions
      let hasRequiredIncludes = true;

      // If "All Daily Notes" is included, result must be DNP
      if (includeOnlyDNP && !resultIsDNP) {
        hasRequiredIncludes = false;
      }

      // Check standard inclusions (if any are specified, at least one must match)
      if (processedIncludedRefs.length > 0) {
        hasRequiredIncludes =
          hasRequiredIncludes &&
          processedIncludedRefs.some((includedRef) =>
            resultRefs.has(includedRef)
          );
      }

      return hasRequiredIncludes;
    });
  } catch (error) {
    console.warn(
      "Failed to filter using Roam API, falling back to text parsing:",
      error
    );

    // Fallback to text-based filtering
    return results.filter((result) => {
      const content = result.content || result.text || "";
      const pageTitle = result.pageTitle || "";
      const resultIsDNP =
        result.isDaily !== undefined
          ? result.isDaily
          : isDailyNotePage(pageTitle);

      // Check DNP exclusions first
      if (excludeAllDNP && resultIsDNP) return false;

      // Get all references in this result
      const resultRefs = new Set<string>();

      // Add page title
      if (pageTitle) resultRefs.add(pageTitle);

      // Add [[page]] references from content
      const pageMatches = content.match(/\[\[([^\]]+)\]\]/g);
      if (pageMatches) {
        pageMatches.forEach((match) => {
          resultRefs.add(match.slice(2, -2));
        });
      }

      // Add #tag references from content
      const tagMatches = content.match(/#([a-zA-Z0-9\-_\/]+)/g);
      if (tagMatches) {
        tagMatches.forEach((match) => {
          resultRefs.add(match.slice(1));
        });
      }

      // Check standard exclusions (exclusions take priority)
      for (const excludedRef of processedExcludedRefs) {
        if (resultRefs.has(excludedRef)) {
          return false;
        }
      }

      // Check inclusions
      let hasRequiredIncludes = true;

      // If "All Daily Notes" is included, result must be DNP
      if (includeOnlyDNP && !resultIsDNP) {
        hasRequiredIncludes = false;
      }

      // Check standard inclusions (if any are specified, at least one must match)
      if (processedIncludedRefs.length > 0) {
        hasRequiredIncludes =
          hasRequiredIncludes &&
          processedIncludedRefs.some((includedRef) =>
            resultRefs.has(includedRef)
          );
      }

      return hasRequiredIncludes;
    });
  }
};
