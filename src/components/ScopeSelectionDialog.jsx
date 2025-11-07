import React from "react";
import { Dialog, Button, Classes, Icon } from "@blueprintjs/core";

const ScopeSelectionDialog = ({
  isOpen,
  onClose,
  scopeOptions,
  recommendedStrategy,
  userQuery,
  onScopeSelect,
  onSkip,
  onCancel,
  forceScopeSelection,
}) => {
  const handleScopeSelect = (strategy) => {
    onScopeSelect(strategy);
    onClose();
  };

  const handleSkip = () => {
    if (onSkip) {
      onSkip();
    }
    onClose();
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
    onClose();
  };

  const getStrategyIcon = (strategy) => {
    switch (strategy) {
      case "all_page_titles":
        return "list";
      case "recent_dnp":
        return "calendar";
      case "random_pages":
        return "random";
      case "recent_modified":
        return "edit";
      case "topic_filtered":
        return "filter";
      default:
        return "search";
    }
  };

  const getStrategyColor = (strategy, isRecommended) => {
    if (isRecommended) return "primary";
    switch (strategy) {
      case "all_page_titles":
        return "success";
      case "recent_dnp":
        return "warning";
      case "random_pages":
        return "none";
      case "recent_modified":
        return "none";
      default:
        return "none";
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="🔍 Choose Data Sampling Strategy"
      className="laia-scope-selection-dialog"
    >
      <div
        className={`${Classes.DIALOG_BODY} laia-scope-selection-dialog-body`}
      >
        <p className="laia-scope-user-query">
          <strong>Your question:</strong> "{userQuery}"
        </p>
        <p className="laia-scope-explanation">
          I detected that you're looking for broad patterns or themes. To
          provide meaningful analysis, I need to sample your data. Please choose
          a strategy:
        </p>

        <div className="laia-scope-options">
          {scopeOptions &&
            scopeOptions.map((option, idx) => {
              const isRecommended = option.strategy === recommendedStrategy;
              return (
                <div key={option.strategy} className="laia-scope-option">
                  <Button
                    fill
                    onClick={() => handleScopeSelect(option.strategy)}
                    className={`laia-scope-button ${
                      isRecommended ? "laia-scope-button-recommended" : ""
                    }`}
                  >
                    <Icon
                      icon={getStrategyIcon(option.strategy)}
                      className="laia-scope-icon"
                    />
                    <div className="laia-scope-content">
                      <div className="laia-scope-title">
                        <strong>
                          {idx + 1}. {option.strategy.replace(/_/g, " ")}
                        </strong>
                        {isRecommended && (
                          <span className="laia-scope-badge">Recommended</span>
                        )}
                      </div>
                      <div className="laia-scope-description">
                        {option.description}
                      </div>
                      <div className="laia-scope-best-for">
                        <em>Best for: {option.bestFor}</em>
                      </div>
                      <div className="laia-scope-count">
                        Estimated: ~{option.estimatedCount} pages
                      </div>
                    </div>
                  </Button>
                </div>
              );
            })}
        </div>

        <p className="laia-scope-tip">
          <Icon icon="lightbulb" size={14} /> <strong>Tip:</strong> Start with "
          {recommendedStrategy.replace(/_/g, " ")}" for a quick overview, then
          drill down into specific areas if needed.
        </p>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={handleCancel} intent="none">
            Cancel
          </Button>
          {!forceScopeSelection && (
            <Button onClick={handleSkip} intent="primary">
              Skip scope analysis
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
};

export default ScopeSelectionDialog;
