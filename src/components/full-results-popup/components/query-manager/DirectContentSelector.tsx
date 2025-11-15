import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Button, Icon, Tag, NumericInput } from "@blueprintjs/core";
import { MultiSelect, ItemRenderer, Select } from "@blueprintjs/select";
import {
  getBlockContentByUid,
  getMainViewUid,
} from "../../../../utils/roamAPI.js";
import { uidRegex } from "../../../../utils/regex.js";

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
  uid?: string; // Store the actual UID for regular pages or blocks
  isBlock?: boolean; // Whether this is a block (not a page)
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
  onAddContent: (livePageContext?: {
    uid: string | null;
    title: string | null;
  }) => void;
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

  // State for current page/block context - refreshed when menu opens
  const [livePageContext, setLivePageContext] = useState(currentPageContext);
  const [currentBlockContext, setCurrentBlockContext] = useState<{
    uid: string;
    title: string;
  } | null>(null);

  // State for pasted block UID detection
  const [pastedBlockUid, setPastedBlockUid] = useState<string | null>(null);
  const [pastedBlockContent, setPastedBlockContent] = useState<string | null>(
    null
  );
  const [currentQuery, setCurrentQuery] = useState<string>("");

  // Refresh current page and block context when popover opens
  const refreshContexts = useCallback(async () => {
    try {
      const mainViewUid = await getMainViewUid();

      if (!mainViewUid) {
        setLivePageContext({ uid: null, title: null });
        setCurrentBlockContext(null);
        return;
      }

      // Check if mainViewUid is a page or a block
      const pageData = window.roamAlphaAPI.pull("[:node/title]", [
        ":block/uid",
        mainViewUid,
      ]);

      if (pageData && pageData[":node/title"]) {
        // It's a page - set as current page
        const pageTitle = pageData[":node/title"];
        setLivePageContext({
          uid: mainViewUid,
          title: pageTitle,
        });
        setCurrentBlockContext(null);
      } else {
        // It's a zoomed block - set as current block and find its page
        const blockContent = getBlockContentByUid(mainViewUid);
        if (blockContent) {
          const blockTitle =
            blockContent.length > 50
              ? blockContent.substring(0, 50) + "..."
              : blockContent;
          setCurrentBlockContext({
            uid: mainViewUid,
            title: blockTitle,
          });

          // Also get the page this block belongs to
          const blockFullData = window.roamAlphaAPI.pull(
            "[{:block/page [:block/uid :node/title]}]",
            [":block/uid", mainViewUid]
          );

          if (blockFullData?.[":block/page"]) {
            const pageUid = blockFullData[":block/page"][":block/uid"];
            const pageTitle = blockFullData[":block/page"][":node/title"];
            setLivePageContext({
              uid: pageUid,
              title: pageTitle,
            });
          }
        }
      }
    } catch (error) {
      console.error(
        "❌ [DirectContentSelector] Error refreshing contexts:",
        error
      );
    }
  }, []);

  // Detect block UID from pasted text
  const detectBlockUid = useCallback((query: string) => {
    try {
      // Reset regex lastIndex before using it
      uidRegex.lastIndex = 0;

      // Match ((uid)) pattern using the existing regex
      const blockRefMatch = uidRegex.exec(query);

      if (blockRefMatch) {
        // Extract UID from ((uid)) - remove (( and ))
        const fullMatch = blockRefMatch[0];
        const uid = fullMatch.substring(2, fullMatch.length - 2);

        const blockContent = getBlockContentByUid(uid);

        if (blockContent) {
          setPastedBlockUid(uid);
          setPastedBlockContent(blockContent);
          return;
        }
      }
    } catch (error) {
      console.error("❌ [DirectContentSelector] Error fetching block:", error);
    }
    // Clear if no valid block UID found
    setPastedBlockUid(null);
    setPastedBlockContent(null);
  }, []);

  // Get current page title from live context
  const getCurrentPageTitle = (): string | null => {
    if (livePageContext?.title) {
      return livePageContext.title;
    }
    return null;
  };

  // Create page options combining special options with available pages
  // Use useMemo to re-create options when contexts or availablePages change
  const pageOptions = useMemo(() => {
    const currentPageTitle = getCurrentPageTitle();
    const specialOptions: PageOption[] = [];

    // Add "Current Page" if we have a current page
    if (currentPageTitle && livePageContext?.uid) {
      specialOptions.push({
        value: currentPageTitle, // Use the actual page title as value so each page is unique
        label: `Current Page: ${currentPageTitle}`,
        isSpecial: true,
        uid: livePageContext.uid,
      });
    }

    // Add "Current Block" if we're zoomed on a block (not the main page)
    if (currentBlockContext?.uid) {
      specialOptions.push({
        value: `block:${currentBlockContext.uid}`,
        label: `Current Block: ${currentBlockContext.title}`,
        isSpecial: true,
        uid: currentBlockContext.uid,
        isBlock: true,
      });
    }

    // Add "Sidebar" option
    specialOptions.push({
      value: "sidebar",
      label: "Sidebar",
      isSpecial: true,
    });

    // Add "Daily Notes Pages"
    specialOptions.push({
      value: "dnp",
      label: "Daily Notes Pages",
      isSpecial: true,
    });

    // Add pasted block option if detected (only if it's not the current block)
    if (
      pastedBlockUid &&
      pastedBlockContent &&
      pastedBlockUid !== currentBlockContext?.uid
    ) {
      const blockPreview =
        pastedBlockContent.length > 50
          ? pastedBlockContent.substring(0, 50) + "..."
          : pastedBlockContent;
      specialOptions.push({
        value: `block:${pastedBlockUid}`,
        label: `Add this block: ${blockPreview}`,
        isSpecial: true,
        uid: pastedBlockUid,
        isBlock: true,
      });
    }

    const regularPageOptions: PageOption[] = availablePages.map((page) => ({
      value: page,
      label: page,
      isSpecial: false,
    }));

    return [...specialOptions, ...regularPageOptions];
  }, [
    livePageContext,
    currentBlockContext,
    pastedBlockUid,
    pastedBlockContent,
    availablePages,
  ]); // Re-create when these change

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

    // Check if query contains a block UID pattern
    const hasBlockUid = query.includes("((") && query.includes("))");

    // If query contains a block UID, only show the pasted block option
    if (hasBlockUid) {
      // Only show options that are blocks (pasted or current block with matching UID)
      return option.isBlock && option.uid && query.includes(option.uid);
    }

    // Always show special options for regular queries
    if (option.isSpecial) return true;

    // Filter regular page options by query
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
    // For blocks, show "Block: [content]" instead of the full label
    if (item.isBlock && item.uid) {
      const blockContent = getBlockContentByUid(item.uid);
      if (blockContent) {
        const preview =
          blockContent.length > 30
            ? blockContent.substring(0, 30) + "..."
            : blockContent;
        return `Block: ${preview}`;
      }
    }
    return item.label;
  };

  // Handle search query for pages and detect block UIDs
  const handlePageQuery = useCallback(
    (query: string) => {
      setCurrentQuery(query);

      // Detect block UID in the query
      detectBlockUid(query);

      // Call parent query handler for page search ONLY if it's not a block UID pattern
      // Block UIDs will be handled by the detected option instead
      if (onQueryPages && query.length > 0 && !query.includes("((")) {
        onQueryPages(query);
      }
    },
    [onQueryPages, detectBlockUid]
  );

  // Refresh contexts when component mounts or when requested
  useEffect(() => {
    refreshContexts();
  }, [refreshContexts]);

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
      <h6>Complete results with selected Pages or Blocks</h6>

      <div className="direct-content-page-selector">
        <div className="direct-content-input-row">
          <div className="direct-content-multiselect-wrapper">
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
                placement: "bottom-end",
                popoverClassName: "direct-content-popover-multiselect",
                usePortal: true,
                enforceFocus: false,
                onOpened: () => {
                  // Refresh contexts when popover opens
                  refreshContexts();
                },
              }}
              fill={true}
              placeholder="Search pages or paste ((block ref))..."
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
          </div>
          <Button
            icon={isAddingDirectContent ? "refresh" : "plus"}
            intent="primary"
            onClick={() => {
              // Pass the live page context to ensure we use the current page
              onAddContent(livePageContext);
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

      {selectedPages.length > 0 && (
        <div className="direct-content-types">
          <label className="bp3-control bp3-checkbox direct-content-checkbox">
            <input
              type="checkbox"
              checked={includePageContent}
              onChange={(e) => onContentTypeChange("content", e.target.checked)}
              disabled={isAddingDirectContent}
            />
            <span className="bp3-control-indicator"></span>
            Content
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
