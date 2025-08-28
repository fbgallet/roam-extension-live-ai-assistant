import React from "react";
import { Result, PageDisplayMode } from "./types";
import { getHighlightedContent } from "./utils/resultProcessing";

// Separate component to handle block/page rendering with hooks
export const BlockRenderer: React.FC<{
  result: Result;
  index?: number;
  showPaths?: boolean;
  searchFilter?: string;
}> = ({ result, showPaths = false, searchFilter = "" }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (containerRef.current && result.uid) {
      try {
        (window as any).roamAlphaAPI.ui.components.renderBlock({
          uid: result.uid,
          "zoom-path?": showPaths,
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
  }, [result, showPaths, searchFilter]);

  return (
    <div
      className="full-result-renderer"
      ref={containerRef}
      style={{ flex: 1 }}
    />
  );
};

interface ResultContentProps {
  result: Result;
  index: number;
  pageDisplayMode: PageDisplayMode;
  showPaths?: boolean;
  searchFilter?: string;
}

export const ResultContent: React.FC<ResultContentProps> = ({
  result,
  index,
  pageDisplayMode,
  showPaths = false,
  searchFilter = "",
}) => {
  // Use explicit isPage flag when available, fallback to legacy detection, default to block
  const isPage =
    result.isPage !== undefined ? result.isPage : result.uid && !result.pageUid; // Legacy: if has uid but no pageUid, assume page

  if (isPage && pageDisplayMode === "metadata") {
    // Simple page title view - just show the title cleanly
    // Use 'title' field which is the actual field name for page results
    const pageTitle =
      result.title ||
      result.pageTitle ||
      result.content ||
      result.text ||
      "Untitled Page";

    return (
      <div className="full-results-page-metadata-view">
        <div className="full-results-page-title">
          📄 {pageTitle}
          {result.isDaily && " 📅"}
        </div>
      </div>
    );
  }

  // For blocks or page embeds, use the BlockRenderer component
  return (
    <BlockRenderer
      result={result}
      showPaths={showPaths}
      searchFilter={searchFilter}
      key={`${result.uid}-${index}`}
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
