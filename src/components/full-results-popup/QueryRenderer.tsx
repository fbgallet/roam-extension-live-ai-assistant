import React, { useState, useRef, useEffect } from "react";
import { Button, Collapse, Icon } from "@blueprintjs/core";
import { StoredQuery } from "../../ai/agents/search-agent/helpers/queryStorage";

// Simple component to render queries using renderString API for clickable links
const RoamQueryRenderer: React.FC<{ query: string }> = ({ query }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      try {
        (window as any).roamAlphaAPI.ui.components.renderString({
          el: containerRef.current,
          string: query,
        });
      } catch (error) {
        console.warn("Failed to render query with renderString:", error);
        // Fallback to plain text
        containerRef.current.textContent = query;
      }
    }
  }, [query]);

  return <div ref={containerRef} style={{ flex: 1, display: "inline" }} />;
};

interface QueryRendererProps {
  query: string;
  formalQuery?: string;
  metadata?: {
    timestamp?: Date;
    resultCount?: number;
    dateRange?: string;
    isComposed?: boolean;
    querySteps?: any[];
  };
  showLabel?: boolean;
  label?: string;
  compact?: boolean;
}

export const QueryRenderer: React.FC<QueryRendererProps> = ({
  query,
  formalQuery,
  metadata,
  showLabel = true,
  label = "Query",
  compact = true,
}) => {
  const [showDetails, setShowDetails] = useState(false);

  const hasDetails = formalQuery && formalQuery !== query;
  const hasMetadata = metadata && (metadata.timestamp || metadata.resultCount || metadata.dateRange);

  return (
    <div className="query-renderer">
      <div className="query-renderer-main">
        <div className="query-renderer-content">
          {showLabel && (
            <span className="query-renderer-label">
              <strong>{label}:</strong>{" "}
            </span>
          )}
          <RoamQueryRenderer query={query} />

          {(hasDetails || hasMetadata) && (
            <Button
              minimal
              small
              icon={showDetails ? "chevron-up" : "chevron-down"}
              onClick={() => setShowDetails(!showDetails)}
              className="query-renderer-toggle"
              title="Show/hide details"
            />
          )}
        </div>
      </div>

      <Collapse isOpen={showDetails}>
        <div className="query-renderer-details">
          {hasDetails && (
            <div className="query-renderer-formal">
              <strong>Formal:</strong>{" "}
              <RoamQueryRenderer query={formalQuery!} />
            </div>
          )}

          {hasMetadata && (
            <div className="query-renderer-metadata">
              {metadata.timestamp && (
                <span className="query-metadata-item">
                  <Icon icon="time" size={12} />{" "}
                  {metadata.timestamp.toLocaleDateString()}
                </span>
              )}
              {metadata.resultCount !== undefined && (
                <span className="query-metadata-item">
                  <Icon icon="numerical" size={12} />{" "}
                  {metadata.resultCount} results
                </span>
              )}
              {metadata.dateRange && (
                <span className="query-metadata-item">
                  <Icon icon="calendar" size={12} />{" "}
                  {metadata.dateRange}
                </span>
              )}
              {metadata.isComposed && (
                <span className="query-metadata-item">
                  <Icon icon="layers" size={12} />{" "}
                  Composed ({(metadata.querySteps?.length || 0) + 1} parts)
                </span>
              )}
            </div>
          )}
        </div>
      </Collapse>
    </div>
  );
};

// Convenience component for StoredQuery objects
interface StoredQueryRendererProps {
  storedQuery: StoredQuery;
  showLabel?: boolean;
  label?: string;
  resultCount?: number;
}

export const StoredQueryRenderer: React.FC<StoredQueryRendererProps> = ({
  storedQuery,
  showLabel = true,
  label = "Query",
  resultCount,
}) => {
  return (
    <QueryRenderer
      query={storedQuery.userQuery}
      formalQuery={storedQuery.formalQuery}
      metadata={{
        timestamp: storedQuery.timestamp,
        resultCount: resultCount,
        isComposed: storedQuery.isComposed,
        querySteps: storedQuery.querySteps,
      }}
      showLabel={showLabel}
      label={label}
    />
  );
};

export default QueryRenderer;