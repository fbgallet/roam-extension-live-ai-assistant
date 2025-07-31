import React from "react";
import { Icon, Button, Tooltip } from "@blueprintjs/core";

const AskGraphModeIndicator = ({
  currentMode,
  onModeChange,
  showChangeOption = true,
  iconOnly = true, // New prop for icon-only display
}) => {
  const getModeIcon = (mode) => {
    switch (mode) {
      case "Private":
        return "lock";
      case "Balanced":
        return "shield";
      case "Full Access":
        return "unlock";
      default:
        return "help";
    }
  };

  const getModeClass = (mode) => {
    switch (mode) {
      case "Private":
        return "laia-askgraph-mode-private";
      case "Balanced":
        return "laia-askgraph-mode-balanced";
      case "Full Access":
        return "laia-askgraph-mode-full";
      default:
        return "laia-askgraph-mode-default";
    }
  };

  const getModeTooltip = (mode, showChangeOption, iconOnly) => {
    const baseTooltips = {
      Private: "Private Mode: Only UIDs returned, no content processing",
      Balanced: "Balanced Mode: Secure tools with final summary",
      "Full Access": "Full Access Mode: Complete content access",
    };

    const tooltipContent = (
      <p>
        Ask Your Graph Agent
        <br></br>
        {baseTooltips[mode] || "Unknown mode"}
        <br></br>
        Click to cycle through modes
      </p>
    );

    return tooltipContent;
  };

  const getNextMode = (currentMode) => {
    switch (currentMode) {
      case "Private":
        return "Balanced";
      case "Balanced":
        return "Full Access";
      case "Full Access":
        return "Private";
      default:
        return "Balanced";
    }
  };

  const handleClick = (e) => {
    e.stopPropagation();
    if (showChangeOption && onModeChange) {
      const nextMode = getNextMode(currentMode);
      onModeChange(nextMode);
    }
  };

  return (
    <Tooltip content={getModeTooltip(currentMode, showChangeOption, iconOnly)}>
      {showChangeOption ? (
        <Icon
          icon={getModeIcon(currentMode)}
          size={12}
          className={`laia-askgraph-mode-icon ${
            iconOnly ? "laia-askgraph-mode-icon-only" : ""
          }`}
          onClick={handleClick}
        />
      ) : (
        <span
          className={`laia-askgraph-mode-span ${getModeClass(currentMode)} ${
            iconOnly ? "laia-askgraph-mode-span-icon-only" : ""
          }`}
        >
          <Icon
            icon={getModeIcon(currentMode)}
            size={12}
            className={`laia-askgraph-mode-icon ${
              iconOnly ? "laia-askgraph-mode-icon-only" : ""
            }`}
          />
          {!iconOnly && (
            <span className="laia-askgraph-mode-text">{currentMode}</span>
          )}
        </span>
      )}
    </Tooltip>
  );
};

export default AskGraphModeIndicator;
