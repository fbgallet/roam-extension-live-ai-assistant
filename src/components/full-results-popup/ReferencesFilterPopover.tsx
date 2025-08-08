import React, { useState, useMemo } from "react";
import { InputGroup, Button, Popover, Icon, Portal } from "@blueprintjs/core";
import { PageReference } from "./utils/resultProcessing";

interface ReferencesFilterPopoverProps {
  availableReferences: PageReference[];
  includedReferences: string[];
  excludedReferences: string[];
  onIncludeToggle: (reference: string) => void;
  onExcludeToggle: (reference: string) => void;
  onClearAll: () => void;
}

export const ReferencesFilterPopover: React.FC<ReferencesFilterPopoverProps> = ({
  availableReferences,
  includedReferences,
  excludedReferences,
  onIncludeToggle,
  onExcludeToggle,
  onClearAll,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  // Add/remove CSS class to modal when popover opens/closes
  React.useEffect(() => {
    const modal = document.querySelector('.full-results-modal');
    if (modal) {
      if (isOpen) {
        modal.classList.add('references-filter-active');
      } else {
        modal.classList.remove('references-filter-active');
      }
    }
    
    // Cleanup on unmount
    return () => {
      const modal = document.querySelector('.full-results-modal');
      if (modal) {
        modal.classList.remove('references-filter-active');
      }
    };
  }, [isOpen]);

  // Filter available references based on search term
  const filteredReferences = useMemo(() => {
    if (!searchTerm) return availableReferences;
    const searchLower = searchTerm.toLowerCase();
    return availableReferences.filter(ref => 
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

  const renderReferenceButton = (ref: PageReference) => {
    const isIncluded = includedReferences.includes(ref.title);
    const isExcluded = excludedReferences.includes(ref.title);
    
    let className = "reference-button";
    if (isIncluded) className += " included";
    if (isExcluded) className += " excluded";

    // Special handling for "All Daily Notes" button
    if (ref.title === "All Daily Notes") {
      return (
        <button
          key={ref.title}
          className={`${className} daily-notes-button`}
          onClick={(e) => handleReferenceClick(ref.title, e)}
          title="Click to Add • Shift-Click to Remove"
        >
          <Icon icon="calendar" size={12} />
          <span>{ref.title}</span>
          <span className="reference-count">{ref.count}</span>
        </button>
      );
    }

    return (
      <button
        key={ref.title}
        className={className}
        onClick={(e) => handleReferenceClick(ref.title, e)}
        title="Click to Add • Shift-Click to Remove"
      >
        <span className="reference-title">{ref.title}</span>
        <span className="reference-count">{ref.count}</span>
      </button>
    );
  };

  // Create unified list with "All Daily Notes" entry
  const dailyNotes = filteredReferences.filter(ref => ref.isDaily);
  const regularPages = filteredReferences.filter(ref => !ref.isDaily);
  
  // Create "All Daily Notes" synthetic entry if there are daily notes
  const allReferencesWithDNP = useMemo(() => {
    const refs = [...filteredReferences];
    if (dailyNotes.length > 0) {
      refs.unshift({
        title: "All Daily Notes",
        count: dailyNotes.length,
        isDaily: true,
        isResultPage: false,
        isReferencedPage: false
      });
    }
    return refs;
  }, [filteredReferences, dailyNotes.length]);

  const hasActiveFilters = includedReferences.length > 0 || excludedReferences.length > 0;

  const popoverContent = (
    <div className="roam-references-filter-popover">
      {/* Fixed Includes/Removes Structure - Always Visible */}
      <div className="active-filters-section">
        {/* Includes */}
        <div className="filter-group">
          <div className="filter-label">Includes <span className="filter-hint">Click to Add</span></div>
          {includedReferences.length > 0 && (
            <div className="filter-buttons">
              {includedReferences.map(refTitle => {
                const ref = availableReferences.find(r => r.title === refTitle) || 
                          { title: refTitle, count: 0, isDaily: false };
                return (
                  <button
                    key={ref.title}
                    className="reference-button included active"
                    onClick={() => onIncludeToggle(ref.title)}
                  >
                    {ref.title === "All Daily Notes" && <Icon icon="calendar" size={12} />}
                    <span className="reference-title">{ref.title}</span>
                    {ref.count > 0 && <span className="reference-count">{ref.count}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Removes */}
        <div className="filter-group">
          <div className="filter-label">Removes <span className="filter-hint">Shift-click to Add</span></div>
          {excludedReferences.length > 0 && (
            <div className="filter-buttons">
              {excludedReferences.map(refTitle => {
                const ref = availableReferences.find(r => r.title === refTitle) ||
                          { title: refTitle, count: 0, isDaily: false };
                return (
                  <button
                    key={ref.title}
                    className="reference-button excluded active"
                    onClick={() => onExcludeToggle(ref.title)}
                  >
                    {ref.title === "All Daily Notes" && <Icon icon="calendar" size={12} />}
                    <span className="reference-title">{ref.title}</span>
                    {ref.count > 0 && <span className="reference-count">{ref.count}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Search Input */}
      <InputGroup
        leftIcon="search"
        placeholder="Find or Create Page"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="references-search"
      />

      {/* Available References as buttons */}
      <div className="references-buttons-container">
        {allReferencesWithDNP.length > 0 ? (
          allReferencesWithDNP.map(renderReferenceButton)
        ) : (
          <div className="no-references">
            {searchTerm ? `No references found matching "${searchTerm}"` : "No references available"}
          </div>
        )}
      </div>

      {/* Instructions at the bottom */}
      {allReferencesWithDNP.length > 0 && (
        <div className="filter-instructions">
          Click to Add • Shift-Click to Remove
        </div>
      )}
    </div>
  );

  return (
    <Popover
      content={popoverContent}
      isOpen={isOpen}
      onInteraction={setIsOpen}
      position="bottom-left"
      className="references-filter-popover-container"
      portalClassName="references-filter-portal"
      usePortal={true}
      popoverClassName="references-filter-popover-overlay"
      modifiers={{
        preventOverflow: { enabled: true },
        flip: { enabled: true },
        offset: { enabled: true }
      }}
    >
      <Button
        icon="filter"
        minimal
        title="Filter by References"
        className={`references-filter-trigger ${hasActiveFilters ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      />
    </Popover>
  );
};