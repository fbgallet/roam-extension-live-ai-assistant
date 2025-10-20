import React, { useState, useMemo } from "react";
import { InputGroup, Button } from "@blueprintjs/core";
import { PageReference } from "../../utils/resultProcessing";

interface ReferencesFilterProps {
  availableReferences: PageReference[];
  includedReferences: string[];
  excludedReferences: string[];
  onIncludeToggle: (reference: string) => void;
  onExcludeToggle: (reference: string) => void;
  onClearAll: () => void;
}

export const ReferencesFilter: React.FC<ReferencesFilterProps> = ({
  availableReferences,
  includedReferences,
  excludedReferences,
  onIncludeToggle,
  onExcludeToggle,
  onClearAll,
}) => {
  const [searchTerm, setSearchTerm] = useState("");

  // Filter available references based on search term
  const filteredReferences = useMemo(() => {
    if (!searchTerm) return availableReferences;
    const searchLower = searchTerm.toLowerCase();
    return availableReferences.filter((ref) =>
      ref.title.toLowerCase().includes(searchLower)
    );
  }, [availableReferences, searchTerm]);

  const handleReferenceClick = (reference: string, event: React.MouseEvent) => {
    if (event.shiftKey) {
      // Shift-click to exclude
      onExcludeToggle(reference);
    } else {
      // Regular click to include
      onIncludeToggle(reference);
    }
  };

  const renderReferenceItem = (ref: PageReference) => {
    const isIncluded = includedReferences.includes(ref.title);
    const isExcluded = excludedReferences.includes(ref.title);

    let className = "reference-item";
    if (isIncluded) className += " included";
    if (isExcluded) className += " excluded";

    return (
      <div
        key={ref.title}
        className={className}
        onClick={(e) => handleReferenceClick(ref.title, e)}
        title="Click to Add • Shift-Click to Add"
      >
        <span className="reference-icon">{ref.isDaily ? "📅" : "📄"}</span>
        <span className="reference-title">{ref.title}</span>
        <span className="reference-count">{ref.count}</span>
      </div>
    );
  };

  // Separate daily notes and regular pages
  const dailyNotes = filteredReferences.filter((ref) => ref.isDaily);
  const regularPages = filteredReferences.filter((ref) => !ref.isDaily);

  const hasActiveFilters =
    includedReferences.length > 0 || excludedReferences.length > 0;

  return (
    <div className="roam-references-filter">
      {/* Search Input */}
      <InputGroup
        leftIcon="search"
        placeholder="Search References"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="references-search"
      />

      {/* Includes Section */}
      {includedReferences.length > 0 && (
        <div className="filter-section">
          <div className="section-header">
            <span className="section-title">Includes</span>
            <span className="section-subtitle">Click to Add</span>
          </div>
          <div className="references-list">
            {includedReferences.map((refTitle) => {
              const ref = availableReferences.find((r) => r.title === refTitle);
              return ref ? (
                <div
                  key={ref.title}
                  className="reference-item included active"
                  onClick={() => onIncludeToggle(ref.title)}
                >
                  <span className="reference-icon">
                    {ref.isDaily ? "📅" : "📄"}
                  </span>
                  <span className="reference-title">{ref.title}</span>
                  <span className="reference-count">{ref.count}</span>
                </div>
              ) : null;
            })}
          </div>
        </div>
      )}

      {/* Removes Section */}
      {excludedReferences.length > 0 && (
        <div className="filter-section">
          <div className="section-header">
            <span className="section-title">Removes</span>
            <span className="section-subtitle">Shift-Click to Add</span>
          </div>
          <div className="references-list">
            {excludedReferences.map((refTitle) => {
              const ref = availableReferences.find((r) => r.title === refTitle);
              return ref ? (
                <div
                  key={ref.title}
                  className="reference-item excluded active"
                  onClick={() => onExcludeToggle(ref.title)}
                >
                  <span className="reference-icon">
                    {ref.isDaily ? "📅" : "📄"}
                  </span>
                  <span className="reference-title">{ref.title}</span>
                  <span className="reference-count">{ref.count}</span>
                </div>
              ) : null;
            })}
          </div>
        </div>
      )}

      {/* Available References */}
      <div className="filter-section">
        <div className="section-header">
          <span className="section-title">
            {hasActiveFilters ? "Available References" : "All References"}
          </span>
          <span className="section-subtitle">
            Click to Add • Shift-Click to Add
          </span>
          {hasActiveFilters && (
            <Button
              text="Clear All"
              minimal
              small
              intent="warning"
              onClick={onClearAll}
              className="clear-button"
            />
          )}
        </div>

        {/* Daily Notes */}
        {dailyNotes.length > 0 && (
          <div className="references-group">
            <div className="group-title">
              📅 All Daily Notes ({dailyNotes.length})
            </div>
            <div className="references-list">
              {dailyNotes.map(renderReferenceItem)}
            </div>
          </div>
        )}

        {/* Regular Pages */}
        {regularPages.length > 0 && (
          <div className="references-group">
            <div className="group-title">📄 Pages ({regularPages.length})</div>
            <div className="references-list">
              {regularPages.map(renderReferenceItem)}
            </div>
          </div>
        )}

        {filteredReferences.length === 0 && searchTerm && (
          <div className="no-references">
            No references found matching "{searchTerm}"
          </div>
        )}
      </div>
    </div>
  );
};
