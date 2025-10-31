import React, { useRef, useEffect, memo } from "react";
import DOMPurify from "dompurify";
import { Result, PageDisplayMode } from "../../types/types";
import { getHighlightedContent } from "../../utils/resultProcessing";

// Separate component to handle block/page rendering with hooks
// Memoized to prevent unnecessary re-renders when props haven't changed
export const BlockRenderer = memo<{
  result: Result;
  index?: number;
  showPaths?: boolean;
  searchFilter?: string;
  expanded?: boolean;
}>(({ result, showPaths = false, searchFilter = "", expanded = true }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTimeoutRef = useRef<number | null>(null);
  // Initialize with null to ensure first render is always detected as changed
  const previousPropsRef = useRef<{ uid: string; showPaths: boolean; expanded: boolean } | null>(null);

  useEffect(() => {
    // Clear any pending render timeout on unmount or before new render
    return () => {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
        renderTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    // Check if this is the first render (previousPropsRef is null) or if props changed
    const hasChanged =
      !previousPropsRef.current ||
      previousPropsRef.current.uid !== result.uid ||
      previousPropsRef.current.showPaths !== showPaths ||
      previousPropsRef.current.expanded !== expanded;

    if (!hasChanged) {
      // Skip re-render if props haven't changed
      return;
    }

    // Update previous props reference
    previousPropsRef.current = { uid: result.uid, showPaths, expanded };

    // Clear any pending render
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
      renderTimeoutRef.current = null;
    }

    // Debounce renderBlock calls to prevent race conditions on rapid toggling
    renderTimeoutRef.current = window.setTimeout(() => {
      if (containerRef.current && result.uid) {
        try {
          (window as any).roamAlphaAPI.ui.components.renderBlock({
            uid: result.uid,
            "zoom-path?": showPaths,
            "open?": expanded,
            el: containerRef.current,
          });
        } catch (error) {
          console.warn("Failed to render block:", error);
          if (containerRef.current) {
            const { content } = getHighlightedContent(result, searchFilter);
            if (content && content.includes("<mark")) {
              containerRef.current.innerHTML = DOMPurify.sanitize(content);
            } else {
              containerRef.current.textContent =
                result.content || result.text || "Unable to render block";
            }
          }
        }
      } else if (containerRef.current) {
        const { content } = getHighlightedContent(result, searchFilter);
        if (content && content.includes("<mark")) {
          containerRef.current.innerHTML = content;
        } else {
          containerRef.current.textContent =
            result.content || result.text || JSON.stringify(result);
        }
      }
      renderTimeoutRef.current = null;
    }, 50); // 50ms debounce - fast enough to feel instant, slow enough to batch rapid changes
  }, [result.uid, showPaths, expanded, searchFilter]);

  return (
    <div
      className="full-result-renderer"
      ref={containerRef}
      style={{ flex: 1 }}
    />
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for React.memo
  // Return true if props are equal (skip re-render), false if different (re-render)
  return (
    prevProps.result.uid === nextProps.result.uid &&
    prevProps.showPaths === nextProps.showPaths &&
    prevProps.searchFilter === nextProps.searchFilter &&
    prevProps.expanded === nextProps.expanded
  );
});

// Component to render page titles using renderString API
// Memoized to prevent unnecessary re-renders
export const PageTitleRenderer = memo<{
  result: Result;
}>(({ result }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      // Get the page title
      const pageTitle =
        result.title ||
        result.pageTitle ||
        result.content ||
        result.text ||
        "Untitled Page";

      // Create the Roam string with page reference
      const roamString = `{{embed: [[${pageTitle}]]}}`;

      try {
        (window as any).roamAlphaAPI.ui.components.renderString({
          el: containerRef.current,
          string: roamString,
        });
      } catch (error) {
        console.warn("Failed to render page title with renderString:", error);
        // Fallback to plain text
        containerRef.current.textContent = `📄 ${pageTitle}${
          result.isDaily ? " 📅" : ""
        }`;
      }
    }
  }, [result.uid, result.title, result.pageTitle]);

  return (
    <div className="full-results-page-metadata-view">
      <div
        className="full-results-page-title"
        ref={containerRef}
        style={{ flex: 1 }}
      />
    </div>
  );
}, (prevProps, nextProps) => {
  // Only re-render if the page title or uid changed
  const prevTitle = prevProps.result.title || prevProps.result.pageTitle;
  const nextTitle = nextProps.result.title || nextProps.result.pageTitle;
  return prevProps.result.uid === nextProps.result.uid && prevTitle === nextTitle;
});

interface ResultContentProps {
  result: Result;
  pageDisplayMode: PageDisplayMode;
  showPaths?: boolean;
  searchFilter?: string;
  expanded?: boolean;
}

// Memoized to prevent re-renders when props haven't changed
export const ResultContent = memo<ResultContentProps>(({
  result,
  pageDisplayMode,
  showPaths = false,
  searchFilter = "",
  expanded = true,
}) => {
  // Use explicit isPage flag when available, fallback to legacy detection, default to block
  const isPage =
    result.isPage !== undefined ? result.isPage : result.uid && !result.pageUid; // Legacy: if has uid but no pageUid, assume page

  if (isPage && pageDisplayMode === "metadata") {
    // Simple page title view using renderString for clickable links
    return <PageTitleRenderer result={result} />;
  }

  // For blocks or page embeds, use the BlockRenderer component
  // NOTE: We NEED expanded in the key because Roam's renderBlock API
  // does NOT respect "open?" parameter changes on re-renders.
  // The only way to change expand/collapse is to force a complete remount.
  return (
    <BlockRenderer
      key={`${result.uid}-${expanded}`}
      result={result}
      showPaths={showPaths}
      searchFilter={searchFilter}
      expanded={expanded}
    />
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if relevant props changed
  return (
    prevProps.result.uid === nextProps.result.uid &&
    prevProps.showPaths === nextProps.showPaths &&
    prevProps.searchFilter === nextProps.searchFilter &&
    prevProps.expanded === nextProps.expanded &&
    prevProps.pageDisplayMode === nextProps.pageDisplayMode
  );
});

interface ResultMetadataProps {
  result: Result;
  showMetadata: boolean;
  sortBy?: string;
  sortOrder?: string;
  onSortByDate?: (order: "asc" | "desc") => void;
}

// Memoized to prevent re-renders when props haven't changed
export const ResultMetadata = memo<ResultMetadataProps>(({
  result,
  showMetadata,
  sortBy,
  sortOrder,
  onSortByDate,
}) => {
  const handlePageTitleClick = (pageTitle: string) => {
    navigator.clipboard.writeText(`[[${pageTitle}]]`);
    console.log(`Copied page reference: [[${pageTitle}]]`);
  };

  const handleUidClick = (uid: string) => {
    navigator.clipboard.writeText(`((${uid}))`);
    console.log(`Copied block reference: ((${uid}))`);
  };

  const handleDateClick = () => {
    if (!onSortByDate) return;

    // If already sorting by date, reverse the order
    if (sortBy === "date") {
      const newOrder = sortOrder === "desc" ? "asc" : "desc";
      onSortByDate(newOrder);
    } else {
      // Default to descending (newest first)
      onSortByDate("desc");
    }
  };

  if (!showMetadata) return null;

  // Use explicit isPage flag when available, fallback to legacy detection, default to block
  const isPage =
    result.isPage !== undefined ? result.isPage : result.uid && !result.pageUid; // Legacy: if has uid but no pageUid, assume page

  return (
    <div className="full-results-metadata">
      <span className={`full-results-type-badge ${isPage ? "page" : "block"}`}>
        {isPage ? (result.isDaily ? "📅 Daily note" : "📄 Page") : "📝 Block"}
      </span>
      {result.modified && (
        <span
          className="full-results-date-info clickable"
          title="Last edition time - Click to sort by date"
          onClick={handleDateClick}
        >
          🕒 {new Date(result.modified).toLocaleDateString()}
        </span>
      )}
      {result.pageTitle && (
        <span
          className="full-results-page-info clickable"
          onClick={() => handlePageTitleClick(result.pageTitle!)}
          title="Click to copy page reference"
        >
          {result.pageTitle?.length > 40 // Limit arbitrarily set at approximately 12,500 tokens (for English)
            ? result.pageTitle.substring(0, 40) + "..."
            : result.pageTitle}
        </span>
      )}
      {result.count && (
        <span className="full-results-count-info">🔢 {result.count} refs</span>
      )}
      {result.uid && (
        <span
          className="full-results-uid-info clickable"
          onClick={() => handleUidClick(result.uid!)}
          title="Click to copy block reference"
        >
          🔗 {result.uid}
        </span>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if relevant props changed
  return (
    prevProps.result.uid === nextProps.result.uid &&
    prevProps.showMetadata === nextProps.showMetadata &&
    prevProps.sortBy === nextProps.sortBy &&
    prevProps.sortOrder === nextProps.sortOrder &&
    prevProps.result.modified === nextProps.result.modified &&
    prevProps.result.pageTitle === nextProps.result.pageTitle
  );
});
