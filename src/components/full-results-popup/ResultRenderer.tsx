import React, { useRef, useEffect } from "react";
import { Result, PageDisplayMode } from "./types";
import { getHighlightedContent } from "./utils/resultProcessing";

// Separate component to handle block/page rendering with hooks
export const BlockRenderer: React.FC<{
  result: Result;
  index?: number;
  showPaths?: boolean;
  searchFilter?: string;
  expanded?: boolean;
}> = ({ result, showPaths = false, searchFilter = "", expanded = true }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
            containerRef.current.innerHTML = content;
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
  }, [result, showPaths, searchFilter, expanded]);

  return (
    <div
      className="full-result-renderer"
      ref={containerRef}
      style={{ flex: 1 }}
    />
  );
};

// Component to render page titles using renderString API
export const PageTitleRenderer: React.FC<{
  result: Result;
}> = ({ result }) => {
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
      const roamString = `📄 [[${pageTitle}]]${result.isDaily ? " 📅" : ""}`;

      try {
        (window as any).roamAlphaAPI.ui.components.renderString({
          el: containerRef.current,
          string: roamString,
        });
      } catch (error) {
        console.warn("Failed to render page title with renderString:", error);
        // Fallback to plain text
        containerRef.current.textContent = `📄 ${pageTitle}${result.isDaily ? " 📅" : ""}`;
      }
    }
  }, [result]);

  return (
    <div className="full-results-page-metadata-view">
      <div
        className="full-results-page-title"
        ref={containerRef}
        style={{ flex: 1 }}
      />
    </div>
  );
};

interface ResultContentProps {
  result: Result;
  index: number;
  pageDisplayMode: PageDisplayMode;
  showPaths?: boolean;
  searchFilter?: string;
  expanded?: boolean;
}

export const ResultContent: React.FC<ResultContentProps> = ({
  result,
  index,
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
  return (
    <BlockRenderer
      result={result}
      showPaths={showPaths}
      searchFilter={searchFilter}
      expanded={expanded}
      key={`${result.uid}-${index}-${expanded}`}
    />
  );
};

interface ResultMetadataProps {
  result: Result;
  showMetadata: boolean;
  sortBy?: string;
  sortOrder?: string;
  onSortByDate?: (order: "asc" | "desc") => void;
}

export const ResultMetadata: React.FC<ResultMetadataProps> = ({
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
        {isPage ? "📄 Page" : "📝 Block"}
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
          {result.pageTitle}
          {result.isDaily && " 📅"}
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
};
