import React from "react";
import { Button, Tooltip } from "@blueprintjs/core";
import { extensionStorage } from "../../..";
import { isThinkingModel, hasThinkingDefault } from "../../../ai/modelRegistry";
import { AppToaster } from "../../Toaster";

/**
 * ThinkingControls Component for Context Menu
 *
 * Displays thinking mode controls inline with the default model display.
 * Shows:
 * - A toggle button (brain icon) to enable/disable thinking
 * - A native select for effort level (minimal, low, medium, high)
 *
 * The controls are always accessible but visually greyed if the default model
 * doesn't support thinking. When a command is run with a different model that
 * supports thinking, the settings will still apply.
 */
const ThinkingControls = ({
  defaultModel,
  thinkingEnabled,
  setThinkingEnabled,
  reasoningEffort,
  setReasoningEffort,
  inputRef,
}) => {
  // Check if the default model supports thinking
  const defaultModelSupportsThinking = isThinkingModel(defaultModel);
  const isAlwaysOn = hasThinkingDefault(defaultModel);

  const handleThinkingToggle = (e) => {
    e.stopPropagation();
    const newValue = !thinkingEnabled;
    setThinkingEnabled(newValue);

    // Show toast if trying to disable for a model that always uses thinking
    if (!newValue && isAlwaysOn) {
      AppToaster.show({
        message: "Note: Current default model always uses thinking mode",
        timeout: 3000,
      });
    }
    inputRef?.current?.focus();
  };

  const handleEffortChange = async (e) => {
    e.stopPropagation();
    const effort = e.target.value;
    setReasoningEffort(effort);
    await extensionStorage.set("reasoningEffort", effort);
    inputRef?.current?.focus();
  };

  return (
    <div
      className="thinking-controls-inline"
      style={{
        display: "inline-flex",
        alignItems: "center",
        marginLeft: "8px",
        opacity: defaultModelSupportsThinking ? 1 : 0.5,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <Tooltip
        content={
          thinkingEnabled
            ? "Thinking mode enabled (click to disable)"
            : "Enable thinking mode"
        }
        hoverOpenDelay={400}
        disabled={window.roamAlphaAPI?.platform?.isMobile}
      >
        <Button
          minimal
          small
          icon="predictive-analysis"
          intent={thinkingEnabled ? "primary" : "none"}
          onClick={handleThinkingToggle}
          style={{ marginRight: "4px" }}
        />
      </Tooltip>
      {thinkingEnabled && (
        <select
          value={reasoningEffort}
          onChange={handleEffortChange}
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: "11px",
            padding: "2px 4px",
            border: "1px solid #ccc",
            borderRadius: "3px",
            background: "white",
            cursor: "pointer",
          }}
        >
          <option value="minimal">Minimal</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      )}
    </div>
  );
};

export default ThinkingControls;
