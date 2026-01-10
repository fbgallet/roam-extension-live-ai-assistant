import React from "react";
import { Icon, Switch, Button, Tag, Tooltip } from "@blueprintjs/core";
import {
  formatContextLength,
  formatPricing,
  getPricingTooltip,
  getModelCapabilities,
} from "../../utils/modelConfigHelpers";
import "./ModelCard.css";

/**
 * ModelCard component - displays a model with visibility toggle, favorite star, and drag-drop
 * @param {Object} props
 * @param {Object} props.model - Model object with id, name, contextLength, pricing
 * @param {boolean} props.isVisible - Whether model is visible in menu
 * @param {boolean} props.isFavorite - Whether model is favorited
 * @param {boolean} props.isDraggable - Whether drag-drop is enabled
 * @param {boolean} props.isNew - Whether model has "NEW" badge
 * @param {boolean} props.isCustom - Whether model is a custom (user-added) model
 * @param {Function} props.onToggleVisibility - Callback when visibility toggled
 * @param {Function} props.onToggleFavorite - Callback when favorite toggled
 * @param {Function} props.onDragStart - Drag start handler
 * @param {Function} props.onDragOver - Drag over handler
 * @param {Function} props.onDrop - Drop handler
 * @param {Function} props.onDragEnd - Drag end handler
 */
export const ModelCard = ({
  model,
  isVisible,
  isFavorite,
  isDraggable = true,
  isNew = false,
  isCustom = false,
  onToggleVisibility,
  onToggleFavorite,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) => {
  const [isDragging, setIsDragging] = React.useState(false);
  const [isDragOver, setIsDragOver] = React.useState(false);

  const handleDragStart = (e) => {
    setIsDragging(true);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", model.id);
    if (onDragStart) {
      onDragStart(e, model.id);
    }
  };

  const handleDragOver = (e) => {
    if (!isDraggable) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
    if (onDragOver) {
      onDragOver(e, model.id);
    }
  };

  const handleDragLeave = (e) => {
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (onDrop) {
      onDrop(e, model.id);
    }
  };

  const handleDragEnd = (e) => {
    setIsDragging(false);
    if (onDragEnd) {
      onDragEnd(e);
    }
  };

  // Get model capabilities
  const capabilities = getModelCapabilities(model.id);

  const className = [
    "model-card",
    isDragging && "dragging",
    isDragOver && "drag-over",
  ]
    .filter(Boolean)
    .join(" ");

  // Render capability badge
  const renderCapabilityBadge = (capability) => {
    switch (capability) {
      case "search":
        return (
          <Tooltip key="search" content="Supports web search" position="top">
            <Tag minimal intent="primary" className="capability-badge">
              🔍
            </Tag>
          </Tooltip>
        );
      case "image":
        return (
          <Tooltip key="image" content="Image generation model" position="top">
            <Tag minimal intent="warning" className="capability-badge">
              🎨
            </Tag>
          </Tooltip>
        );
      case "reasoning":
        return (
          <Tooltip key="reasoning" content="Reasoning/thinking model" position="top">
            <Tag minimal intent="success" className="capability-badge">
              🧠
            </Tag>
          </Tooltip>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className={className}
      draggable={isDraggable}
      data-model-id={model.id}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
    >
      {isDraggable && (
        <Icon icon="drag-handle-vertical" className="drag-handle" />
      )}

      <Switch
        checked={isVisible}
        onChange={(e) => onToggleVisibility(model.id, e.target.checked)}
        alignIndicator="left"
      />

      <div className="model-info">
        <h5 className="model-name">
          {model.name}
          {isNew && (
            <Tag intent="success" minimal className="new-badge">
              NEW
            </Tag>
          )}
          {isCustom && (
            <Tag intent="primary" minimal className="custom-badge">
              CUSTOM
            </Tag>
          )}
          {capabilities.map(renderCapabilityBadge)}
        </h5>
        <div className="model-metadata">
          {model.contextLength && (
            <Tag minimal icon="database">
              {formatContextLength(model.contextLength)}
            </Tag>
          )}
          {model.pricing && model.pricing.input > 0 && model.pricing.output > 0 && (
            <>
              <Tag minimal className="pricing-tag price-in">
                In: ${model.pricing.input.toFixed(2)}
              </Tag>
              <Tag minimal className="pricing-tag price-out">
                Out: ${model.pricing.output.toFixed(2)}
              </Tag>
            </>
          )}
        </div>
      </div>

      <Button
        icon={isFavorite ? "star" : "star-empty"}
        minimal
        intent={isFavorite ? "warning" : "none"}
        onClick={() => onToggleFavorite(model.id)}
        title={isFavorite ? "Remove from favorites" : "Add to favorites"}
      />
    </div>
  );
};

export default ModelCard;
