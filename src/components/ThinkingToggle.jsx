import React, { useState } from "react";
import { Button, Popover, Menu, MenuItem, Switch, MenuDivider } from "@blueprintjs/core";
import { extensionStorage } from "..";

/**
 * ThinkingToggle Component
 *
 * Displays a button to toggle thinking mode for models that support it.
 * Shows a popover with:
 * - Switch to enable/disable thinking
 * - Selector for thinking effort level (minimal, low, medium, high)
 *
 * @param {Object} props
 * @param {string} props.modelId - Current model identifier
 * @param {boolean} props.supportsThinking - Whether the model supports thinking
 * @param {boolean} props.thinkingDefault - Whether thinking is on by default for this model
 * @param {boolean} props.thinkingEnabled - Current thinking state
 * @param {function} props.onThinkingChange - Callback when thinking state changes
 */
export const ThinkingToggle = ({
  modelId,
  supportsThinking,
  thinkingDefault,
  thinkingEnabled,
  onThinkingChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // Get stored reasoning effort (global setting)
  const [reasoningEffort, setReasoningEffort] = useState(
    extensionStorage.get("reasoningEffort") || "low"
  );

  // Don't render if model doesn't support thinking
  if (!supportsThinking) return null;

  const handleThinkingToggle = (checked) => {
    onThinkingChange(checked);
    // If model has thinkingDefault=true, we can't disable it (always-on models)
    // This UI shouldn't allow toggle in that case
  };

  const handleEffortChange = async (effort) => {
    setReasoningEffort(effort);
    // Persist globally
    await extensionStorage.set("reasoningEffort", effort);
  };

  const effortOptions = [
    { value: "minimal", label: "Minimal", icon: "small-tick" },
    { value: "low", label: "Low (default)", icon: "tick" },
    { value: "medium", label: "Medium", icon: "double-chevron-up" },
    { value: "high", label: "High", icon: "double-chevron-up" },
  ];

  // If model always has thinking (thinkingDefault), show indicator but no toggle
  const alwaysOn = thinkingDefault;

  return (
    <div className="thinking-toggle">
      <Popover
        isOpen={isOpen}
        onInteraction={(nextOpenState) => setIsOpen(nextOpenState)}
        content={
          <Menu>
            {!alwaysOn && (
              <>
                <div style={{ padding: "8px 12px" }}>
                  <Switch
                    label="Enable thinking mode"
                    checked={thinkingEnabled}
                    onChange={(e) => handleThinkingToggle(e.currentTarget.checked)}
                    style={{ marginBottom: 0 }}
                  />
                </div>
                <MenuDivider />
              </>
            )}
            {alwaysOn && (
              <>
                <MenuDivider title="Thinking always enabled" />
                <div style={{ padding: "4px 12px 8px", fontSize: "11px", color: "#5c7080" }}>
                  This model uses thinking by default
                </div>
              </>
            )}
            <MenuDivider title="Thinking effort" />
            {effortOptions.map((option) => (
              <MenuItem
                key={option.value}
                text={option.label}
                icon={reasoningEffort === option.value ? "tick" : "blank"}
                onClick={() => handleEffortChange(option.value)}
                disabled={!thinkingEnabled && !alwaysOn}
              />
            ))}
          </Menu>
        }
        placement="top"
      >
        <Button
          minimal
          small
          icon="predictive-analysis"
          intent={thinkingEnabled || alwaysOn ? "primary" : "none"}
          title={
            alwaysOn
              ? "Thinking mode (always on)"
              : thinkingEnabled
              ? "Thinking mode enabled"
              : "Enable thinking mode"
          }
        />
      </Popover>
    </div>
  );
};
