import React from "react";
import { Button, HTMLSelect, Tooltip } from "@blueprintjs/core";
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

  const handleEffortChange = async (value) => {
    // e.stopPropagation();
    const effort = value;
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
        marginLeft: "5px",
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
        />
      </Tooltip>
      {thinkingEnabled && (
        <HTMLSelect
          options={["minimal", "low", "medium", "high"]}
          value={reasoningEffort}
          minimal={true}
          onChange={(e) => handleEffortChange(e.currentTarget.value)}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
};

export default ThinkingControls;
