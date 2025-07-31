import React, { useState, useEffect } from "react";
import { Button } from "@blueprintjs/core";
import { createChildBlock } from "../utils/roamAPI.js";

interface Result {
  uid?: string;
  content?: string;
  text?: string;
  [key: string]: any;
}

interface FullResultsPopupProps {
  results: Result[];
  isOpen: boolean;
  title?: string;
  targetUid?: string;
}

const FullResultsPopup: React.FC<FullResultsPopupProps> = ({
  results,
  isOpen,
  title = "Ask your graph: last request full results",
  targetUid,
}) => {
  const [selectedResults, setSelectedResults] = useState<Set<number>>(
    new Set()
  );
  const [dropdownStates, setDropdownStates] = useState<Record<string, boolean>>(
    {}
  );
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedResults(new Set());
    }
  }, [isOpen]);

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);

    // Remove the popup container directly
    setTimeout(() => {
      const container = document.getElementById("full-results-popup-container");
      if (container) {
        document.body.removeChild(container);
      }
    }, 100);
  };

  const handleCheckboxChange = (index: number) => {
    if (isClosing) return; // Prevent state updates if closing
    const newSelected = new Set(selectedResults);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedResults(newSelected);
  };

  const handleSelectAll = () => {
    if (isClosing) return; // Prevent state updates if closing
    if (selectedResults.size === results.length) {
      setSelectedResults(new Set());
    } else {
      setSelectedResults(new Set(results.map((_, index) => index)));
    }
  };

  const getSelectedResultsList = () => {
    return Array.from(selectedResults).map((index) => results[index]);
  };

  const handleInsertAtDNPEnd = async () => {
    try {
      const selectedResultsList = getSelectedResultsList();
      if (selectedResultsList.length === 0) return;

      // Determine insertion location: targetUid if available, otherwise current DNP
      let insertionParentUid: string;
      if (targetUid) {
        insertionParentUid = targetUid;
      } else {
        // Get today's DNP
        const today = new Date();
        insertionParentUid = `${String(today.getMonth() + 1).padStart(
          2,
          "0"
        )}-${String(today.getDate()).padStart(2, "0")}-${today.getFullYear()}`;
      }

      // First, create the "Selected results:" header block using your custom function
      const headerUid = await createChildBlock(
        insertionParentUid,
        "Selected results:",
        "last"
      );

      if (headerUid) {
        // Create all embed blocks under the header
        for (let idx = 0; idx < selectedResultsList.length; idx++) {
          const result = selectedResultsList[idx];
          if (result && result.uid) {
            const embedText = `{{[[embed-path]]: ((${result.uid}))}}`;
            await createChildBlock(
              headerUid,
              embedText,
              "last"
            );
          }
        }
      }

      handleClose();
    } catch (error) {
      console.error("Failed to insert results:", error);
    }
  };

  const handleInsertInSidebar = () => {
    try {
      const selectedResultsList = getSelectedResultsList();
      if (selectedResultsList.length === 0) return;

      selectedResultsList.forEach((result) => {
        if (result.uid) {
          // Open in sidebar
          (window as any).roamAlphaAPI.ui.rightSidebar.addWindow({
            window: {
              type: "block",
              "block-uid": result.uid,
            },
          });
        }
      });
      // Don't close popup for dropdown actions
    } catch (error) {
      console.error("Failed to insert in sidebar:", error);
    }
  };

  const handleCopyEmbeds = () => {
    const selectedResultsList = getSelectedResultsList();
    if (selectedResultsList.length === 0) return;

    const embedTexts = selectedResultsList
      .filter((result) => result.uid)
      .map((result) => `{{[[embed-path]]: ((${result.uid}))}}`)
      .join("\n");

    navigator.clipboard.writeText(embedTexts);
    handleClose();
  };

  const handleCopyReferences = () => {
    const selectedResultsList = getSelectedResultsList();
    if (selectedResultsList.length === 0) return;

    const references = selectedResultsList
      .filter((result) => result.uid)
      .map((result) => `((${result.uid}))`)
      .join("\n");

    navigator.clipboard.writeText(references);
    // Don't close popup for dropdown actions
  };

  // Simple custom dropdown that definitely works
  const DropdownButton: React.FC<{
    mainText: string;
    mainAction: () => void;
    dropdownOptions: Array<{ text: string; action: () => void }>;
    disabled?: boolean;
    dropdownKey: string;
  }> = ({
    mainText,
    mainAction,
    dropdownOptions,
    disabled = false,
    dropdownKey,
  }) => {
    const isOpen = dropdownStates[dropdownKey] || false;

    const toggleDropdown = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isClosing) return; // Prevent state updates if closing
      setDropdownStates((prev) => ({
        ...prev,
        [dropdownKey]: !prev[dropdownKey],
      }));
    };

    return (
      <div className="full-results-simple-dropdown">
        <Button
          intent="primary"
          text={mainText}
          onClick={mainAction}
          disabled={disabled}
        />
        <Button
          icon="caret-down"
          intent="primary"
          disabled={disabled}
          onClick={toggleDropdown}
          aria-label="More options"
        />
        {isOpen && (
          <div className="full-results-simple-dropdown-menu">
            {dropdownOptions.map((option, idx) => (
              <button
                key={idx}
                className="full-results-simple-dropdown-item"
                onClick={() => {
                  option.action();
                  if (!isClosing) {
                    setDropdownStates((prev) => ({
                      ...prev,
                      [dropdownKey]: false,
                    }));
                  }
                }}
              >
                {option.text}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderBlockContent = (result: Result) => {
    const containerRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
      if (containerRef.current && result.uid) {
        try {
          (window as any).roamAlphaAPI.ui.components.renderBlock({
            uid: result.uid,
            "zoom-path?": true,
            el: containerRef.current,
          });
        } catch (error) {
          console.warn("Failed to render block:", error);
          if (containerRef.current) {
            containerRef.current.textContent =
              result.content || result.text || "Unable to render block";
          }
        }
      } else if (containerRef.current) {
        containerRef.current.textContent =
          result.content || result.text || JSON.stringify(result);
      }
    }, [result]);

    return <div ref={containerRef} style={{ flex: 1 }} />;
  };

  return !isOpen ? null : (
    <div
      className="full-results-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      <div className="full-results-modal">
        {/* Header */}
        <div className="full-results-header">
          <h3 className="full-results-title">{title}</h3>
          <button className="full-results-close-button" onClick={handleClose}>
            ×
          </button>
        </div>

        {/* Results */}
        <div>
          {results && results.length > 0 ? (
            results.map((result, index) => (
              <div key={index} className="full-results-result-item">
                <input
                  type="checkbox"
                  checked={selectedResults.has(index)}
                  onChange={() => handleCheckboxChange(index)}
                  className="full-results-checkbox"
                />
                <div className="full-results-block-container">
                  {renderBlockContent(result)}
                </div>
              </div>
            ))
          ) : (
            <div>No detailed results available</div>
          )}
        </div>

        {/* Action Bar */}
        <div className="full-results-action-bar">
          <label className="full-results-select-all-checkbox">
            <input
              type="checkbox"
              checked={
                selectedResults.size === results.length && results.length > 0
              }
              onChange={handleSelectAll}
              className="full-results-checkbox"
            />
            All
          </label>

          <div className="full-results-buttons-container">
            <DropdownButton
              mainText={
                targetUid ? "Append to last response" : "Append to today's DNP"
              }
              mainAction={handleInsertAtDNPEnd}
              disabled={selectedResults.size === 0}
              dropdownKey="insert"
              dropdownOptions={[
                {
                  text: "Open in Sidebar",
                  action: handleInsertInSidebar,
                },
              ]}
            />

            <DropdownButton
              mainText="Copy Embeds"
              mainAction={handleCopyEmbeds}
              disabled={selectedResults.size === 0}
              dropdownKey="copy"
              dropdownOptions={[
                {
                  text: "Copy References",
                  action: handleCopyReferences,
                },
              ]}
            />

            <Button text="Close" onClick={handleClose} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default FullResultsPopup;

// Shared utility function for opening last Ask Your Graph results
// Used by both command palette and context menu
export const openLastAskYourGraphResults = () => {
  const lastResults = (window as any).lastAskYourGraphResults;
  if (lastResults && lastResults.length > 0) {
    // Import and use the popup function
    import("./Toaster.js").then(({ openFullResultsPopup }) => {
      if (openFullResultsPopup) {
        const targetUid = (window as any).lastAgentResponseTargetUid || null;
        openFullResultsPopup(lastResults, targetUid);
      }
    }).catch(() => {
      // Fallback for environments where dynamic import doesn't work
      if ((window as any).LiveAI && (window as any).LiveAI.openFullResultsPopup) {
        (window as any).LiveAI.openFullResultsPopup(lastResults);
      } else {
        alert(`Found ${lastResults.length} results, but popup functionality is not available. Results are stored in window.lastAskYourGraphResults`);
      }
    });
  } else {
    console.warn("No Ask Your Graph results available to display");
  }
};

// Function to check if results are available (for conditional command display)
export const hasLastAskYourGraphResults = (): boolean => {
  const results = (window as any).lastAskYourGraphResults;
  return results && Array.isArray(results) && results.length > 0;
};

// Hook for easy usage
export const useFullResultsPopup = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  const openPopup = (resultsData: Result[]) => {
    setResults(resultsData);
    setIsOpen(true);
  };

  const closePopup = () => {
    setIsOpen(false);
    setResults([]);
  };

  return {
    isOpen,
    results,
    openPopup,
    closePopup,
    FullResultsPopup: (
      props: Omit<FullResultsPopupProps, "results" | "isOpen" | "onClose">
    ) => <FullResultsPopup {...props} results={results} isOpen={isOpen} />,
  };
};
