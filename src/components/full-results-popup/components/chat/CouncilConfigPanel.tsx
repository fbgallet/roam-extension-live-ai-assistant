/**
 * Council Configuration Panel
 *
 * BlueprintJS panel for configuring LLM Council sessions.
 * Shown when chatMode === "council", above the chat input area.
 */

import React, { useState, useEffect } from "react";
import {
  Button,
  Tag,
  Popover,
  Slider,
  NumericInput,
  TextArea,
  Tabs,
  Tab,
  Collapse,
  Icon,
  Switch,
} from "@blueprintjs/core";
import ModelsMenu from "../../../ModelsMenu";
import { getDisplayName } from "../../../../ai/modelRegistry";
import {
  CouncilConfig,
  CouncilMode,
} from "../../../../ai/agents/council-agent/council-types";
import { DebateConfigPanel } from "./DebateConfigPanel";

interface CouncilConfigPanelProps {
  config: CouncilConfig;
  onConfigChange: (config: CouncilConfig) => void;
  defaultModel: string; // currently selected model in chat
  isRunning?: boolean; // auto-collapse when council starts running
}

// Model selector row: shows a tag with the model name, click to change via ModelsMenu popover
const ModelSelector: React.FC<{
  modelId: string;
  role: string;
  onSelect: (modelId: string) => void;
  onRemove?: () => void;
}> = ({ modelId, role, onSelect, onRemove }) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleModelSelection = ({ model }: { model: string }) => {
    onSelect(model);
    setIsOpen(false);
  };

  return (
    <div className="council-config-model-row">
      <span className="council-config-model-role">{role}</span>
      <Popover
        isOpen={isOpen}
        onInteraction={(next) => setIsOpen(next)}
        content={
          <ModelsMenu
            callback={handleModelSelection}
            setModel={onSelect}
            command={null}
            prompt=""
            isConversationToContinue={false}
          />
        }
        placement="top"
      >
        <Tag interactive minimal icon="cog">
          {getDisplayName(modelId) || "Select model..."}
        </Tag>
      </Popover>
      {onRemove && (
        <Button
          icon="cross"
          minimal
          small
          onClick={onRemove}
          intent="danger"
        />
      )}
    </div>
  );
};

export const CouncilConfigPanel: React.FC<CouncilConfigPanelProps> = ({
  config,
  onConfigChange,
  defaultModel,
  isRunning,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  // Auto-collapse when council starts running
  useEffect(() => {
    if (isRunning) {
      setIsExpanded(false);
    }
  }, [isRunning]);

  const updateConfig = (partial: Partial<CouncilConfig>) => {
    onConfigChange({ ...config, ...partial });
  };

  const addEvaluator = () => {
    if (config.evaluatorModels.length < 4) {
      updateConfig({
        evaluatorModels: [...config.evaluatorModels, defaultModel],
      });
    }
  };

  const removeEvaluator = (index: number) => {
    if (config.evaluatorModels.length > 1) {
      updateConfig({
        evaluatorModels: config.evaluatorModels.filter((_, i) => i !== index),
      });
    }
  };

  const updateEvaluator = (index: number, modelId: string) => {
    const updated = [...config.evaluatorModels];
    updated[index] = modelId;
    updateConfig({ evaluatorModels: updated });
  };

  const addCompetitor = () => {
    if (config.competitorModels.length < 5) {
      updateConfig({
        competitorModels: [...config.competitorModels, defaultModel],
      });
    }
  };

  const removeCompetitor = (index: number) => {
    if (config.competitorModels.length > 2) {
      updateConfig({
        competitorModels: config.competitorModels.filter(
          (_, i) => i !== index,
        ),
      });
    }
  };

  const updateCompetitor = (index: number, modelId: string) => {
    const updated = [...config.competitorModels];
    updated[index] = modelId;
    updateConfig({ competitorModels: updated });
  };

  return (
    <div className="council-config-panel">
      {/* Header */}
      <div
        className="council-config-panel-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <h4>
          <Icon icon="people" size={14} />
          LLM Council Configuration
        </h4>
        <Icon icon={isExpanded ? "chevron-up" : "chevron-down"} />
      </div>

      <Collapse isOpen={isExpanded}>
        {/* Mode selector */}
        <div className="council-config-section council-config-mode-tabs">
          <Tabs
            id="council-mode-tabs"
            selectedTabId={config.mode}
            onChange={(newMode) =>
              updateConfig({ mode: newMode as CouncilMode })
            }
            animate={false}
            renderActiveTabPanelOnly
          >
            <Tab id="iterative" title="Iterative Refinement" />
            <Tab id="parallel" title="Parallel Competition" />
            <Tab id="debate" title="Debate" />
          </Tabs>
        </div>

        {/* Iterative mode config */}
        {config.mode === "iterative" && (
          <>
            {/* Generator */}
            <div className="council-config-section">
              <div className="council-config-section-label">Generator</div>
              <ModelSelector
                modelId={config.generatorModel || defaultModel}
                role="Generate"
                onSelect={(model) => updateConfig({ generatorModel: model })}
              />
            </div>

            {/* Evaluators */}
            <div className="council-config-section">
              <div className="council-config-section-label">
                Evaluators ({config.evaluatorModels.length}/4)
                {config.evaluatorModels.length < 4 && (
                  <Button
                    icon="plus"
                    minimal
                    small
                    onClick={addEvaluator}
                    style={{ marginLeft: 6 }}
                  />
                )}
              </div>
              {config.evaluatorModels.map((modelId, i) => (
                <ModelSelector
                  key={i}
                  modelId={modelId}
                  role={`Eval ${i + 1}`}
                  onSelect={(model) => updateEvaluator(i, model)}
                  onRemove={
                    config.evaluatorModels.length > 1
                      ? () => removeEvaluator(i)
                      : undefined
                  }
                />
              ))}
            </div>

            {/* Iteration settings */}
            <div className="council-config-section">
              <div className="council-config-row">
                <label>Max re-evaluations:</label>
                <NumericInput
                  value={config.maxReEvaluations}
                  onValueChange={(val) =>
                    updateConfig({
                      maxReEvaluations: Math.max(1, Math.min(10, val)),
                    })
                  }
                  min={1}
                  max={10}
                  minorStepSize={1}
                  stepSize={1}
                  fill={false}
                />
              </div>
              <div className="council-config-row">
                <label>Score threshold:</label>
                <Slider
                  min={1}
                  max={10}
                  stepSize={0.5}
                  value={config.scoreThreshold}
                  onChange={(val) =>
                    updateConfig({ scoreThreshold: val })
                  }
                  labelStepSize={2}
                />
                <Tag minimal round>
                  {config.scoreThreshold}/10
                </Tag>
              </div>
            </div>
          </>
        )}

        {/* Parallel mode config */}
        {config.mode === "parallel" && (
          <>
            {/* Competitors */}
            <div className="council-config-section">
              <div className="council-config-section-label">
                Competitors ({config.competitorModels.length}/5)
                {config.competitorModels.length < 5 && (
                  <Button
                    icon="plus"
                    minimal
                    small
                    onClick={addCompetitor}
                    style={{ marginLeft: 6 }}
                  />
                )}
              </div>
              {config.competitorModels.map((modelId, i) => (
                <ModelSelector
                  key={i}
                  modelId={modelId}
                  role={`Model ${i + 1}`}
                  onSelect={(model) => updateCompetitor(i, model)}
                  onRemove={
                    config.competitorModels.length > 2
                      ? () => removeCompetitor(i)
                      : undefined
                  }
                />
              ))}
            </div>

            {/* Synthesizer */}
            <div className="council-config-section">
              <div className="council-config-section-label">Synthesizer</div>
              <ModelSelector
                modelId={config.synthesizerModel || defaultModel}
                role="Synthesize"
                onSelect={(model) =>
                  updateConfig({ synthesizerModel: model })
                }
              />
            </div>

            {/* Cross-evaluation options */}
            <div className="council-config-section">
              <Switch
                checked={config.fullCrossEvaluation || false}
                label="Full cross-evaluation (each model evaluates all others)"
                onChange={(e) =>
                  updateConfig({
                    fullCrossEvaluation: (e.target as HTMLInputElement).checked,
                  })
                }
              />
              {config.fullCrossEvaluation && (
                <Switch
                  checked={config.includeSelfEvaluation || false}
                  label="Include self-evaluation"
                  onChange={(e) =>
                    updateConfig({
                      includeSelfEvaluation: (e.target as HTMLInputElement)
                        .checked,
                    })
                  }
                  style={{ marginLeft: 20 }}
                />
              )}
            </div>
          </>
        )}

        {/* Debate mode config */}
        {config.mode === "debate" && (
          <DebateConfigPanel
            config={config}
            onConfigChange={onConfigChange}
            defaultModel={defaultModel}
          />
        )}

        {/* Evaluation word limit (iterative + parallel) */}
        {config.mode !== "debate" && (
          <div className="council-config-section">
            <div className="council-config-row">
              <label>Evaluation word limit:</label>
              <Slider
                min={100}
                max={800}
                stepSize={50}
                value={config.evaluationWordLimit || 400}
                onChange={(val) => updateConfig({ evaluationWordLimit: val })}
                labelStepSize={200}
              />
              <Tag minimal round>
                {config.evaluationWordLimit || 400}
              </Tag>
            </div>
          </div>
        )}

        {/* Evaluation instructions (iterative + parallel) */}
        {config.mode !== "debate" && (
          <div className="council-config-section">
            <div className="council-config-section-label">
              Evaluation Instructions (optional)
            </div>
            <TextArea
              className="council-config-criteria-textarea"
              value={config.evaluationCriteria}
              onChange={(e) =>
                updateConfig({ evaluationCriteria: e.target.value })
              }
              placeholder="Custom instructions for the evaluation process. Any criteria you define here will replace the defaults. You can also provide general guidance to the evaluators. Leave empty to use the default criteria (accuracy, completeness & relevance, reasoning robustness, unexamined assumptions)."
              small
              fill
            />
          </div>
        )}
      </Collapse>
    </div>
  );
};
