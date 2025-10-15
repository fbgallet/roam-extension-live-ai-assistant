import React, { useState, useMemo } from "react";
import { Button, Icon, Tag, NumericInput } from "@blueprintjs/core";
import { MultiSelect, ItemRenderer, Select } from "@blueprintjs/select";

// DNP period options similar to ContextSelectionPanel
const DNP_PERIOD_OPTIONS = [
  { value: "1", label: "Today", days: 1 },
  { value: "2", label: "Today+Yesterday", days: 2 },
  { value: "1 W", label: "1 week", days: 7 },
  { value: "2 W", label: "2 weeks", days: 14 },
  { value: "1 M", label: "1 month", days: 30 },
  { value: "1 Q", label: "1 quarter", days: 92 },
  { value: "1 Y", label: "1 year", days: 365 },
  { value: "Custom", label: "Custom" },
];

// Page selection options for Blueprint Select
interface PageOption {
  value: string;
  label: string;
  isSpecial?: boolean;
  uid?: string; // Store the actual UID for regular pages
}

interface DirectContentSelectorProps {
  selectedPages: string[];
  includePageContent: boolean;
  includeLinkedRefs: boolean;
  dnpPeriod: number;
  isAddingDirectContent: boolean;
  availablePages: string[];
  isLoadingPages: boolean;
  currentPageContext?: {
    uid: string | null;
    title: string | null;
  };
  onPageSelectionChange: (selectedPages: string[]) => void;
  onContentTypeChange: (
    type: "content" | "linkedRefs",
    checked: boolean
  ) => void;
  onDNPPeriodChange: (period: number) => void;
  onAddContent: () => void;
  onQueryPages?: (query: string) => void;
}

// Create Blueprint Select for Pages

const DirectContentSelector: React.FC<DirectContentSelectorProps> = ({
  selectedPages,
  includePageContent,
  includeLinkedRefs,
  dnpPeriod,
  isAddingDirectContent,
  availablePages,
  isLoadingPages,
  currentPageContext,
  onPageSelectionChange,
  onContentTypeChange,
  onDNPPeriodChange,
  onAddContent,
  onQueryPages,
}) => {
  // Local state for custom DNP days and period selection
  const [customDays, setCustomDays] = useState<number>(dnpPeriod);
  const [selectedDnpPeriod, setSelectedDnpPeriod] = useState<string>(() => {
    // Initialize with the current dnpPeriod value
    const matchingOption = DNP_PERIOD_OPTIONS.find(
      (opt) => opt.days === dnpPeriod
    );
    return matchingOption ? matchingOption.value : "Custom";
  });

  // Get current page title from context
  const getCurrentPageTitle = (): string | null => {
    if (currentPageContext?.title) {
      console.log(
        "✅ [DirectContentSelector] Using currentPageContext:",
        currentPageContext
      );
      return currentPageContext.title;
    }

    console.warn("⚠️ [DirectContentSelector] No currentPageContext provided");
    return null;
  };

  // Create page options combining special options with available pages
  // Use useMemo to re-create options when currentPageContext or availablePages change
  const pageOptions = useMemo(() => {
    const currentPageTitle = getCurrentPageTitle();
    const specialOptions: PageOption[] = [];

    // Only add "Current Page" if we have a current page
    if (currentPageTitle) {
      console.log(
        "✅ [DirectContentSelector] Adding 'Current Page' option:",
        currentPageTitle
      );
      specialOptions.push({
        value: "current",
        label: `Current Page: ${currentPageTitle}`,
        isSpecial: true,
      });
    } else {
      console.warn(
        "⚠️ [DirectContentSelector] No current page title - 'Current Page' option not added"
      );
    }

    specialOptions.push({
      value: "dnp",
      label: "Daily Notes Pages",
      isSpecial: true,
    });

    const regularPageOptions: PageOption[] = availablePages.map((page) => ({
      value: page,
      label: page,
      isSpecial: false,
    }));

    return [...specialOptions, ...regularPageOptions];
  }, [currentPageContext, availablePages]); // Re-create when these change

  // Blueprint Select item renderer
  const renderPageOption: ItemRenderer<PageOption> = (
    option,
    { handleClick, modifiers }
  ) => {
    if (!modifiers.matchesPredicate) return null;

    return (
      <div
        key={option.value}
        className={`page-select-option ${
          option.isSpecial ? "special-option" : ""
        } ${modifiers.active ? "active" : ""}`}
        onClick={handleClick}
        role="option"
      >
        <span className="page-option-label">{option.label}</span>
        {option.isSpecial && <Icon icon="star" size={12} />}
      </div>
    );
  };

  // Filter predicate for Blueprint Select
  const filterPageOption = (query: string, option: PageOption) => {
    if (!query) return true;
    return option.label.toLowerCase().includes(query.toLowerCase());
  };

  // Handle page selection/deselection
  const handlePageSelect = (option: PageOption) => {
    if (selectedPages.includes(option.value)) {
      // Remove from selection
      onPageSelectionChange(
        selectedPages.filter((page) => page !== option.value)
      );
    } else {
      // Add to selection
      onPageSelectionChange([...selectedPages, option.value]);
    }

    // Query will be cleared automatically by resetOnSelect prop
  };

  // Handle page removal from tags
  const handlePageRemove = (pageToRemove: string) => {
    onPageSelectionChange(
      selectedPages.filter((page) => page !== pageToRemove)
    );
  };

  // Get selected page options
  const getSelectedPageOptions = (): PageOption[] => {
    return selectedPages.map(
      (pageName) =>
        pageOptions.find((opt) => opt.value === pageName) || {
          value: pageName,
          label: pageName,
          isSpecial: false,
        }
    );
  };

  // Tag renderer for selected pages - required by MultiSelect
  const renderTag = (item: PageOption) => {
    return item.label;
  };

  // Handle search query for pages
  const handlePageQuery = (query: string) => {
    if (onQueryPages && query.length > 0) {
      onQueryPages(query);
    }
  };

  // DNP period item renderer
  const renderDnpPeriodItem = (
    item: (typeof DNP_PERIOD_OPTIONS)[0],
    { handleClick }: any
  ) => (
    <div
      onClick={handleClick}
      style={{ padding: "8px 12px", cursor: "pointer" }}
    >
      {item.label}
    </div>
  );

  // Handle DNP period change
  const handleDnpPeriodChange = (
    selectedOption: (typeof DNP_PERIOD_OPTIONS)[0]
  ) => {
    setSelectedDnpPeriod(selectedOption.value);
    if (selectedOption.value === "Custom") {
      onDNPPeriodChange(customDays);
    } else {
      onDNPPeriodChange(selectedOption.days);
    }
  };

  const isToDisable =
    selectedPages.length === 0 ||
    (!includePageContent && !includeLinkedRefs) ||
    isAddingDirectContent;

  return (
    <div className="query-tool-section">
      <h6>Complete results with selected Pages or their linked references</h6>

      <div className="direct-content-page-selector">
        <div className="direct-content-input-row">
          <MultiSelect<PageOption>
            items={pageOptions}
            itemRenderer={renderPageOption}
            itemPredicate={filterPageOption}
            onItemSelect={handlePageSelect}
            onQueryChange={handlePageQuery}
            tagRenderer={renderTag}
            selectedItems={getSelectedPageOptions()}
            popoverProps={{
              minimal: true,
              position: "bottom-right",
            }}
            fill={true}
            placeholder="Select pages..."
            disabled={isAddingDirectContent}
            resetOnSelect={true}
            className="direct-content-page-multiselect"
            tagInputProps={{
              onRemove: (_value: React.ReactNode, index: number) => {
                // Extract the actual page value from selectedPages by index
                const pageToRemove = selectedPages[index];
                if (pageToRemove) {
                  handlePageRemove(pageToRemove);
                }
              },
              disabled: isAddingDirectContent,
              tagProps: (value: string) => {
                const pageOption = pageOptions.find(
                  (opt) => opt.value === value
                );
                return {
                  intent: pageOption?.isSpecial ? "primary" : "none",
                  minimal: true,
                };
              },
            }}
          />
          <Button
            icon={isAddingDirectContent ? "refresh" : "plus"}
            intent="primary"
            onClick={() => {
              onAddContent();
              // Clear selection after adding content
              onPageSelectionChange([]);
            }}
            disabled={isToDisable}
            loading={isAddingDirectContent}
            text={isAddingDirectContent ? "Adding..." : "Add to results"}
            title={
              selectedPages.length === 0
                ? "Select pages to add content"
                : isAddingDirectContent
                ? "Adding content..."
                : `Add content from ${selectedPages.length} page${
                    selectedPages.length === 1 ? "" : "s"
                  }`
            }
            className="direct-content-add-button"
          />
        </div>
      </div>

      {!isToDisable && (
        <div className="direct-content-types">
          <label className="bp3-control bp3-checkbox direct-content-checkbox">
            <input
              type="checkbox"
              checked={includePageContent}
              onChange={(e) => onContentTypeChange("content", e.target.checked)}
              disabled={isAddingDirectContent}
            />
            <span className="bp3-control-indicator"></span>
            Page
          </label>
          <label className="bp3-control bp3-checkbox direct-content-checkbox">
            <input
              type="checkbox"
              checked={includeLinkedRefs}
              onChange={(e) =>
                onContentTypeChange("linkedRefs", e.target.checked)
              }
              disabled={isAddingDirectContent}
            />
            <span className="bp3-control-indicator"></span>
            Linked references
          </label>

          {/* Inline DNP Period Selector (conditional) */}
          {selectedPages.includes("dnp") && (
            <div className="direct-content-dnp-inline">
              <span className="direct-content-dnp-separator">DNP Period</span>
              <Select
                items={DNP_PERIOD_OPTIONS}
                itemRenderer={renderDnpPeriodItem}
                onItemSelect={handleDnpPeriodChange}
                filterable={false}
                popoverProps={{
                  minimal: true,
                  position: "bottom-left",
                }}
                className="direct-content-dnp-select-inline"
                disabled={isAddingDirectContent}
              >
                <button
                  className="direct-content-dnp-button-inline"
                  disabled={isAddingDirectContent}
                >
                  {DNP_PERIOD_OPTIONS.find(
                    (opt) => opt.value === selectedDnpPeriod
                  )?.label || "1 week"}
                  <Icon icon="caret-down" size={10} />
                </button>
              </Select>

              {selectedDnpPeriod === "Custom" && (
                <>
                  <NumericInput
                    value={customDays}
                    min={1}
                    max={9999}
                    onValueChange={(value) => {
                      setCustomDays(value);
                      onDNPPeriodChange(value);
                    }}
                    placeholder="days"
                    className="direct-content-custom-days-inline"
                    disabled={isAddingDirectContent}
                    buttonPosition="none"
                  />
                  <>days</>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DirectContentSelector;
