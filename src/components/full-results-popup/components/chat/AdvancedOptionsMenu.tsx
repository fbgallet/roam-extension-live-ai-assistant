/**
 * Advanced Options Menu Component
 *
 * Provides per-session advanced model parameters (max_tokens, temperature, top_p, presence_penalty)
 * and a PDF extraction toggle, accessible via a "..." button in the chat controls bar.
 */

import React, { useState } from "react";
import {
  Button,
  Popover,
  Menu,
  MenuItem,
  MenuDivider,
  Switch,
  NumericInput,
  Slider,
} from "@blueprintjs/core";
import { AdvancedModelParams } from "../../../../ai/agents/langraphModelsLoader";
import { getTemperatureConfig } from "../../../../ai/modelRegistry";

export interface AdvancedOptionsState {
  // Model parameters with enable/disable switches
  maxTokensEnabled: boolean;
  maxTokens: number;
  temperatureEnabled: boolean;
  temperature: number;
  topPEnabled: boolean;
  topP: number;
  presencePenaltyEnabled: boolean;
  presencePenalty: number;
  // PDF extraction
  includePdfEnabled: boolean;
  includePdf: boolean;
}

export function getDefaultAdvancedOptions(
  globalAlwaysExtractPdf: boolean,
): AdvancedOptionsState {
  return {
    maxTokensEnabled: false,
    maxTokens: 400,
    temperatureEnabled: false,
    temperature: 0.7,
    topPEnabled: false,
    topP: 0.9,
    presencePenaltyEnabled: false,
    presencePenalty: 0,
    includePdfEnabled: false,
    includePdf: globalAlwaysExtractPdf,
  };
}

/** Extract AdvancedModelParams from options state (only enabled params) */
export function getActiveAdvancedParams(
  state: AdvancedOptionsState,
): AdvancedModelParams | undefined {
  const params: AdvancedModelParams = {};
  let hasAny = false;

  if (state.maxTokensEnabled) {
    params.maxTokens = state.maxTokens;
    hasAny = true;
  }
  if (state.temperatureEnabled) {
    params.temperature = state.temperature;
    hasAny = true;
  }
  if (state.topPEnabled) {
    params.topP = state.topP;
    hasAny = true;
  }
  if (state.presencePenaltyEnabled) {
    params.presencePenalty = state.presencePenalty;
    hasAny = true;
  }

  return hasAny ? params : undefined;
}

/** Get per-session includePdf override, or undefined if not overridden */
export function getIncludePdfOverride(
  state: AdvancedOptionsState,
): boolean | undefined {
  return state.includePdfEnabled ? state.includePdf : undefined;
}

interface AdvancedOptionsMenuProps {
  options: AdvancedOptionsState;
  onOptionsChange: (options: AdvancedOptionsState) => void;
  selectedModel: string;
}

export const AdvancedOptionsMenu: React.FC<AdvancedOptionsMenuProps> = ({
  options,
  onOptionsChange,
  selectedModel,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // OpenAI models support temperature 0-2, all others 0-1
  const tempConfig = getTemperatureConfig(selectedModel);
  const maxTemperature = tempConfig.scale;

  const update = (partial: Partial<AdvancedOptionsState>) => {
    onOptionsChange({ ...options, ...partial });
  };

  const handleTemperatureEnable = (enabled: boolean) => {
    const changes: Partial<AdvancedOptionsState> = {
      temperatureEnabled: enabled,
    };
    // Mutual exclusion: disable top_p when enabling temperature
    if (enabled && options.topPEnabled) {
      changes.topPEnabled = false;
    }
    update(changes);
  };

  const handleTopPEnable = (enabled: boolean) => {
    const changes: Partial<AdvancedOptionsState> = { topPEnabled: enabled };
    // Mutual exclusion: disable temperature when enabling top_p
    if (enabled && options.temperatureEnabled) {
      changes.temperatureEnabled = false;
    }
    update(changes);
  };

  const hasActiveOverrides =
    options.maxTokensEnabled ||
    options.temperatureEnabled ||
    options.topPEnabled ||
    options.presencePenaltyEnabled ||
    options.includePdfEnabled;

  return (
    <Popover
      isOpen={isOpen}
      onInteraction={(nextOpenState, event) => {
        // When closing, only prevent if the click is inside the popover content
        if (!nextOpenState) {
          const target = event?.target as HTMLElement;
          const isInsidePopover =
            target?.closest(".advanced-options-menu") !== null;
          if (isInsidePopover) return;
        }
        setIsOpen(nextOpenState);
      }}
      content={
        <div
          className="advanced-options-menu"
          style={{ padding: "8px", minWidth: 260 }}
        >
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>
            Advanced Options
          </div>

          {/* Max Tokens */}
          <div className="advanced-option-row">
            <Switch
              checked={options.maxTokensEnabled}
              label="Max output tokens"
              onChange={(e) =>
                update({ maxTokensEnabled: e.currentTarget.checked })
              }
              alignIndicator="right"
              style={{ marginBottom: 0, fontSize: 12 }}
            />
            {options.maxTokensEnabled && (
              <NumericInput
                value={options.maxTokens}
                onValueChange={(val) => {
                  if (!isNaN(val) && val > 0) update({ maxTokens: val });
                }}
                min={1}
                max={200000}
                stepSize={512}
                majorStepSize={4096}
                fill={true}
                small={true}
                style={{ marginTop: 4 }}
              />
            )}
          </div>

          <MenuDivider />

          {/* Temperature */}
          <div className="advanced-option-row">
            <Switch
              checked={options.temperatureEnabled}
              label="Temperature"
              onChange={(e) => handleTemperatureEnable(e.currentTarget.checked)}
              alignIndicator="right"
              style={{ marginBottom: 0, fontSize: 12 }}
            />
            {options.temperatureEnabled && (
              <div style={{ padding: "4px 4px 0" }}>
                <Slider
                  min={0}
                  max={maxTemperature}
                  stepSize={0.1}
                  labelStepSize={maxTemperature / 4}
                  value={Math.min(options.temperature, maxTemperature)}
                  onChange={(val) => update({ temperature: val })}
                  labelRenderer={(val) => val.toFixed(1)}
                />
              </div>
            )}
          </div>

          <MenuDivider />

          {/* Top P */}
          <div className="advanced-option-row">
            <Switch
              checked={options.topPEnabled}
              label="Top P"
              onChange={(e) => handleTopPEnable(e.currentTarget.checked)}
              alignIndicator="right"
              style={{ marginBottom: 0, fontSize: 12 }}
            />
            {options.topPEnabled && (
              <div style={{ padding: "4px 4px 0" }}>
                <Slider
                  min={0}
                  max={1}
                  stepSize={0.05}
                  labelStepSize={0.25}
                  value={options.topP}
                  onChange={(val) => update({ topP: val })}
                  labelRenderer={(val) => val.toFixed(2)}
                />
              </div>
            )}
          </div>

          <MenuDivider />

          {/* Presence Penalty */}
          <div className="advanced-option-row">
            <Switch
              checked={options.presencePenaltyEnabled}
              label="Presence penalty"
              onChange={(e) =>
                update({ presencePenaltyEnabled: e.currentTarget.checked })
              }
              alignIndicator="right"
              style={{ marginBottom: 0, fontSize: 12 }}
            />
            {options.presencePenaltyEnabled && (
              <div style={{ padding: "4px 4px 0" }}>
                <Slider
                  min={-2}
                  max={2}
                  stepSize={0.1}
                  labelStepSize={1}
                  value={options.presencePenalty}
                  onChange={(val) => update({ presencePenalty: val })}
                  labelRenderer={(val) => val.toFixed(1)}
                />
              </div>
            )}
          </div>

          <MenuDivider />

          {/* Include PDF */}
          <div className="advanced-option-row">
            <Switch
              checked={options.includePdfEnabled}
              label="Override PDF setting"
              onChange={(e) =>
                update({ includePdfEnabled: e.currentTarget.checked })
              }
              alignIndicator="right"
              style={{ marginBottom: 0, fontSize: 12 }}
            />
            {options.includePdfEnabled && (
              <div style={{ paddingLeft: 8, paddingTop: 2 }}>
                <Switch
                  checked={options.includePdf}
                  label="Include PDF content"
                  onChange={(e) =>
                    update({ includePdf: e.currentTarget.checked })
                  }
                  style={{ marginBottom: 0, fontSize: 12 }}
                />
              </div>
            )}
          </div>
        </div>
      }
      placement="top"
    >
      <Button
        minimal
        small
        icon="more"
        intent={hasActiveOverrides ? "primary" : "none"}
      />
    </Popover>
  );
};
