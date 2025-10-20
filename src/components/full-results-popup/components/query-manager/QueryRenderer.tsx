import React, { useState, useRef, useEffect } from "react";
import { Button, Collapse, Icon } from "@blueprintjs/core";
import { StoredQuery, IntentParserResult } from "../../utils/queryStorage";
import { UnifiedQuery } from "../../types/QueryTypes";
import EditableQueryText from "../query-manager/EditableQueryText";

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
  intentParserResult?: IntentParserResult;
  showLabel?: boolean;
  label?: string;
  compact?: boolean;
  // New props for unified query support
  unifiedQuery?: UnifiedQuery;
  visualComposed?: boolean; // Whether to show composed structure visually
  skipStylingWrapper?: boolean; // Whether to skip the blue background wrapper (when parent provides it)
  // Edit functionality
  onEdit?: (newQuery: string, context?: { stepIndex?: number }) => void; // Callback when query is edited (stepIndex for composed queries)
  editable?: boolean; // Whether to show edit button
}

export const QueryRenderer: React.FC<QueryRendererProps> = ({
  query,
  formalQuery,
  metadata,
  intentParserResult,
  showLabel = true,
  label = "Query",
  compact = true,
  unifiedQuery,
  visualComposed = false,
  skipStylingWrapper = false,
  onEdit,
  editable = false,
}) => {
  const [showDetails, setShowDetails] = useState(false);

  // Determine if we should show visual composed structure
  const effectiveUnifiedQuery =
    unifiedQuery ||
    (metadata?.isComposed
      ? ({
          userQuery: query,
          formalQuery: formalQuery || query,
          isComposed: true,
          querySteps: metadata.querySteps || [],
          pageSelections: [],
        } as UnifiedQuery)
      : null);

  const shouldShowVisualComposed =
    visualComposed &&
    effectiveUnifiedQuery?.isComposed &&
    (effectiveUnifiedQuery.querySteps.length > 0 ||
      effectiveUnifiedQuery.pageSelections?.length > 0);

  const hasDetails = formalQuery && formalQuery !== query;
  const hasMetadata =
    metadata &&
    (metadata.timestamp || metadata.resultCount || metadata.dateRange);
  const hasSearchDetails =
    intentParserResult?.searchDetails &&
    (intentParserResult.searchDetails.timeRange ||
      intentParserResult.searchDetails.depthLimit ||
      intentParserResult.searchDetails.maxResults ||
      intentParserResult.searchDetails.requireRandom);

  // If showing visual composed structure, render it differently
  if (shouldShowVisualComposed) {
    return (
      <div className="query-renderer composed-visual">
        <div className="composed-series">
          {/* Base Query */}
          <div className="query-manager-query-content user-query">
            {effectiveUnifiedQuery.userQuery ? (
              <QueryRenderer
                query={effectiveUnifiedQuery.userQuery}
                formalQuery={effectiveUnifiedQuery.formalQuery}
                intentParserResult={effectiveUnifiedQuery.intentParserResult}
                label="Query 1"
                showLabel={true}
                skipStylingWrapper={true}
                editable={editable}
                onEdit={
                  onEdit
                    ? (newQuery) => {
                        // Edit base query (no stepIndex means base query)
                        onEdit(newQuery);
                      }
                    : undefined
                }
              />
            ) : (
              <div className="query-renderer-content">
                <span
                  className="query-renderer-label"
                  style={{ color: "#999", fontStyle: "italic" }}
                >
                  No natural language query, page selection only
                </span>
              </div>
            )}
          </div>

          {/* Query Steps */}
          {effectiveUnifiedQuery.querySteps.map((step, index) => (
            <div key={index} className="query-with-plus">
              <div className="query-plus">+</div>
              <div className="query-plus-content">
                <div className="query-manager-query-content user-query">
                  {step.isComposed ? (
                    // If step itself is composed, use UnifiedQueryRenderer with recursion
                    <UnifiedQueryRenderer
                      unifiedQuery={{
                        userQuery: step.userQuery,
                        formalQuery: step.formalQuery,
                        intentParserResult: step.intentParserResult,
                        isComposed: step.isComposed,
                        querySteps: step.querySteps || [],
                        pageSelections: step.pageSelections || [],
                      }}
                      label={`Query ${index + 2}`}
                      showLabel={true}
                      visualComposed={true}
                      skipStylingWrapper={true}
                    />
                  ) : (
                    // Simple step
                    <QueryRenderer
                      query={step.userQuery}
                      formalQuery={step.formalQuery}
                      intentParserResult={step.intentParserResult}
                      label={`Query ${index + 2}`}
                      showLabel={true}
                      skipStylingWrapper={true}
                      editable={editable}
                      onEdit={
                        onEdit
                          ? (newQuery) => {
                              // Edit step (pass stepIndex)
                              onEdit(newQuery, { stepIndex: index });
                            }
                          : undefined
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Page Selections - Now displayed in dedicated .query-page-selections section in QueryManager */}
          {/* Removed duplicate display here - page selections are shown as tags in QueryManager */}
        </div>
      </div>
    );
  }

  // Standard single query rendering

  const content = (
    <>
      <div className="query-renderer-content">
        {!query ? (
          <span
            className="query-renderer-label"
            style={{ color: "#999", fontStyle: "italic" }}
          >
            No natural language query, page selection only
          </span>
        ) : editable && onEdit ? (
          <EditableQueryText
            query={query}
            onSave={onEdit}
            label={showLabel ? label : undefined}
          />
        ) : (
          <>
            {showLabel && (
              <span className="query-renderer-label">
                <strong>{label}:</strong>{" "}
              </span>
            )}
            <RoamQueryRenderer query={query} />
          </>
        )}

        {(hasDetails || hasMetadata || hasSearchDetails) && (
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
                  <Icon icon="numerical" size={12} /> {metadata.resultCount}{" "}
                  results
                </span>
              )}
              {metadata.dateRange && (
                <span className="query-metadata-item">
                  <Icon icon="calendar" size={12} /> {metadata.dateRange}
                </span>
              )}
              {metadata.isComposed && (
                <span className="query-metadata-item">
                  <Icon icon="layers" size={12} /> Composed (
                  {(metadata.querySteps?.length || 0) + 1} parts)
                </span>
              )}
            </div>
          )}

          {hasSearchDetails && (
            <div className="query-renderer-search-details">
              <div className="query-search-details-header">
                <strong>Search Parameters:</strong>
              </div>
              {intentParserResult?.searchDetails?.timeRange && (
                <span className="query-metadata-item">
                  <Icon icon="calendar" size={12} />{" "}
                  {new Date(
                    intentParserResult.searchDetails.timeRange.start
                  ).toLocaleDateString()}
                  {" → "}
                  {new Date(
                    intentParserResult.searchDetails.timeRange.end
                  ).toLocaleDateString()}
                </span>
              )}
              {intentParserResult?.searchDetails?.depthLimit && (
                <span className="query-metadata-item">
                  <Icon icon="diagram-tree" size={12} /> Depth:{" "}
                  {intentParserResult.searchDetails.depthLimit}
                </span>
              )}
              {intentParserResult?.searchDetails?.maxResults && (
                <span className="query-metadata-item">
                  <Icon icon="numerical" size={12} /> Max:{" "}
                  {intentParserResult.searchDetails.maxResults} results
                </span>
              )}
              {intentParserResult?.searchDetails?.requireRandom && (
                <span className="query-metadata-item">
                  <Icon icon="random" size={12} /> Random sampling
                </span>
              )}
            </div>
          )}
        </div>
      </Collapse>
    </>
  );

  // Apply wrapper conditionally
  return skipStylingWrapper ? (
    content
  ) : (
    <div className="query-manager-query-content user-query">{content}</div>
  );
};

// Convenience component for StoredQuery objects
interface StoredQueryRendererProps {
  storedQuery: StoredQuery;
  showLabel?: boolean;
  label?: string;
  resultCount?: number;
  visualComposed?: boolean;
  editable?: boolean;
  onEdit?: (newQuery: string, context?: { stepIndex?: number }) => void;
}

export const StoredQueryRenderer: React.FC<StoredQueryRendererProps> = ({
  storedQuery,
  showLabel = true,
  label = "Query",
  resultCount,
  visualComposed = true,
  editable = false,
  onEdit,
}) => {
  return (
    <QueryRenderer
      query={storedQuery.userQuery}
      formalQuery={storedQuery.formalQuery}
      intentParserResult={storedQuery.intentParserResult}
      metadata={{
        timestamp: storedQuery.timestamp,
        resultCount: resultCount,
        isComposed: storedQuery.isComposed,
        querySteps: storedQuery.querySteps,
      }}
      showLabel={showLabel}
      label={label}
      editable={editable}
      onEdit={onEdit}
      unifiedQuery={{
        userQuery: storedQuery.userQuery,
        formalQuery: storedQuery.formalQuery,
        intentParserResult: storedQuery.intentParserResult,
        isComposed: storedQuery.isComposed || false,
        querySteps: storedQuery.querySteps || [],
        pageSelections: storedQuery.pageSelections || [],
        id: storedQuery.id,
        timestamp: storedQuery.timestamp,
        name: storedQuery.name,
      }}
      visualComposed={visualComposed}
    />
  );
};

// Convenience component for UnifiedQuery objects with visual composed display
interface UnifiedQueryRendererProps {
  unifiedQuery: UnifiedQuery;
  showLabel?: boolean;
  label?: string;
  resultCount?: number;
  visualComposed?: boolean;
  skipStylingWrapper?: boolean;
  editable?: boolean;
  onEdit?: (newQuery: string, context?: { stepIndex?: number }) => void;
}

export const UnifiedQueryRenderer: React.FC<UnifiedQueryRendererProps> = ({
  unifiedQuery,
  showLabel = true,
  label = "Query",
  resultCount,
  visualComposed = true,
  skipStylingWrapper = false,
  editable = false,
  onEdit,
}) => {
  return (
    <QueryRenderer
      query={unifiedQuery.userQuery}
      formalQuery={unifiedQuery.formalQuery}
      intentParserResult={unifiedQuery.intentParserResult}
      metadata={{
        timestamp: unifiedQuery.timestamp,
        resultCount: resultCount,
        isComposed: unifiedQuery.isComposed,
        querySteps: unifiedQuery.querySteps,
      }}
      showLabel={showLabel}
      editable={editable}
      onEdit={onEdit}
      label={label}
      unifiedQuery={unifiedQuery}
      visualComposed={visualComposed}
      skipStylingWrapper={skipStylingWrapper}
    />
  );
};

export default QueryRenderer;
