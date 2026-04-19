/**
 * Council Step Display Component
 *
 * Renders council intermediate steps (generations, evaluations, status, synthesis)
 * with collapsible sections, score badges, and model tags.
 */

import React, { useState } from "react";
import { Tag, Collapse, Icon, Button } from "@blueprintjs/core";
import { CouncilStepInfo } from "../../../../ai/agents/council-agent/council-types";
import { criterionNameToKey } from "../../../../ai/agents/council-agent/council-prompts";
import { renderMarkdown } from "../../utils/chatMessageUtils";

interface CouncilStepDisplayProps {
  content: string;
  councilStep: CouncilStepInfo;
  tokensIn?: number;
  tokensOut?: number;
}

function getScoreColor(score: number): string {
  if (score >= 8) return "#0f9960"; // green
  if (score >= 5) return "#d9822b"; // orange
  return "#d13913"; // red
}

function getScoreIntent(
  score: number,
): "success" | "warning" | "danger" {
  if (score >= 8) return "success";
  if (score >= 5) return "warning";
  return "danger";
}

function getStepIcon(
  type: CouncilStepInfo["type"],
):
  | "document"
  | "comparison"
  | "merge-columns"
  | "info-sign"
  | "chat"
  | "people"
  | "comment" {
  switch (type) {
    case "generation":
      return "document";
    case "evaluation":
      return "comparison";
    case "synthesis":
      return "merge-columns";
    case "status":
      return "info-sign";
    case "debate-turn":
      return "chat";
    case "debate-reaction":
      return "comment";
    case "debate-continue":
    case "debate-speaker-picker":
      return "people";
  }
}

function debateDisplayName(step: CouncilStepInfo): string {
  const speaker = step.speakerName;
  if (!speaker) return "Participant";
  if (
    step.roleLabel &&
    speaker.startsWith(`${step.roleLabel} (`) &&
    speaker.endsWith(")")
  ) {
    return step.roleLabel;
  }
  return speaker.replace(/\s+\([^()]*\)(\s*#\d+)?$/, "");
}

function getStepLabel(step: CouncilStepInfo): string {
  switch (step.type) {
    case "generation":
      if (step.councilMode === "iterative") {
        return `Generation #${step.iteration || 1}`;
      }
      return step.blindLabel || "Generation";
    case "evaluation":
      return "Evaluation";
    case "synthesis":
      return "Final Synthesis";
    case "status":
      return "Status";
    case "debate-turn":
      return `R${step.round || 1} · ${debateDisplayName(step)}`;
    case "debate-reaction":
      return `↪ ${debateDisplayName(step)} reacts`;
    case "debate-continue":
      return "Continue debate";
    case "debate-speaker-picker":
      return "Pick next speaker";
  }
}

export const CouncilStepDisplay: React.FC<CouncilStepDisplayProps> = ({
  content,
  councilStep,
  tokensIn,
  tokensOut,
}) => {
  const [isExpanded, setIsExpanded] = useState(!councilStep.isIntermediate);

  // Status messages are always shown inline, not collapsible
  if (councilStep.type === "status") {
    return (
      <div className="council-step council-step-status">
        <div className="council-step-status-content">
          <Icon icon="info-sign" size={14} />
          <span
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        </div>
      </div>
    );
  }

  // Synthesis (final answer) renders like a normal message, with a tag
  if (councilStep.type === "synthesis") {
    return (
      <div className="council-step council-step-synthesis">
        <div className="council-step-header">
          <Tag intent="primary" icon="merge-columns" minimal>
            Final Synthesis
          </Tag>
          {councilStep.modelDisplayName && (
            <Tag minimal className="council-model-tag">
              {councilStep.modelDisplayName}
            </Tag>
          )}
        </div>
        <div
          className="council-step-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
      </div>
    );
  }

  // Collapsible intermediate steps (generations and evaluations)
  const stepLabel = getStepLabel(councilStep);
  const stepIcon = getStepIcon(councilStep.type);

  return (
    <div
      className={`council-step council-step-${councilStep.type} ${councilStep.isIntermediate ? "council-step-intermediate" : ""}`}
    >
      <div
        className="council-step-header council-step-header-clickable"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <Button
          icon={isExpanded ? "chevron-down" : "chevron-right"}
          minimal
          small
          className="council-step-toggle"
        />
        <Tag
          icon={stepIcon}
          minimal
          intent={councilStep.type === "evaluation" ? "none" : "none"}
        >
          {stepLabel}
        </Tag>
        {councilStep.modelDisplayName && (
          <Tag minimal className="council-model-tag">
            {councilStep.modelDisplayName}
          </Tag>
        )}
        {councilStep.type === "evaluation" && councilStep.score != null && (
          <Tag
            intent={getScoreIntent(councilStep.score)}
            className="council-score-tag"
            round
          >
            {councilStep.score}/10
          </Tag>
        )}
        {councilStep.type === "evaluation" &&
          councilStep.criteriaScores &&
          councilStep.criteriaNames &&
          councilStep.criteriaNames.length > 0 && (
            <span className="council-criteria-scores">
              {councilStep.criteriaNames.map((name) => {
                const key = criterionNameToKey(name);
                const val = councilStep.criteriaScores?.[key];
                if (val == null) return null;
                return (
                  <Tag
                    key={key}
                    minimal
                    round
                    intent={getScoreIntent(val)}
                    className="council-criterion-tag"
                    title={name}
                  >
                    {name}: {val}/10
                  </Tag>
                );
              })}
            </span>
          )}
        {councilStep.type === "evaluation" &&
          councilStep.evaluatedModelDisplayName && (
            <span className="council-eval-target">
              evaluated{" "}
              <strong>{councilStep.evaluatedModelDisplayName}</strong>
              {councilStep.blindLabel && (
                <span className="council-blind-label">
                  {" "}
                  ({councilStep.blindLabel})
                </span>
              )}
            </span>
          )}
        {councilStep.type === "generation" &&
          councilStep.councilMode === "parallel" &&
          councilStep.blindLabel && (
            <span className="council-blind-label">
              {councilStep.blindLabel}
            </span>
          )}
        {tokensIn != null && tokensOut != null && (
          <span className="council-step-tokens">
            {tokensIn + tokensOut} tokens
          </span>
        )}
      </div>
      <Collapse isOpen={isExpanded}>
        <div
          className="council-step-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
      </Collapse>
    </div>
  );
};
