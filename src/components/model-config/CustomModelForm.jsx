import React, { useState, useMemo } from "react";
import {
  InputGroup,
  NumericInput,
  Button,
  Intent,
  HTMLSelect,
} from "@blueprintjs/core";
import axios from "axios";
import "./CustomModelForm.css";

/**
 * CustomModelForm component - compact form for adding custom models
 * @param {Object} props
 * @param {Array} props.availableProviders - List of available providers with {value, label}
 * @param {string} props.defaultProvider - Default provider to select
 * @param {Object} props.allCustomModels - All custom models across all providers (for global duplicate check)
 * @param {Function} props.onAdd - Callback when model is added (provider, newModel)
 * @param {Function} props.onCancel - Callback when form is cancelled
 */
export const CustomModelForm = ({
  availableProviders = [],
  defaultProvider = "",
  allCustomModels = null,
  onAdd,
  onCancel
}) => {
  const [selectedProvider, setSelectedProvider] = useState(defaultProvider || availableProviders[0]?.value || "");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [contextLength, setContextLength] = useState(null);
  const [inputPricing, setInputPricing] = useState("");
  const [outputPricing, setOutputPricing] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [fetchMessage, setFetchMessage] = useState(null); // { text, intent }

  // Check for duplicate IDs across ALL providers
  const isDuplicate = useMemo(() => {
    const trimmedId = id.trim();
    if (!trimmedId) return false;

    if (allCustomModels) {
      const allModels = Object.values(allCustomModels).flat();
      return allModels.some((m) => m.id === trimmedId);
    }

    return false;
  }, [allCustomModels, id]);

  const handleAdd = () => {
    if (!id.trim() || isDuplicate || !selectedProvider) {
      return;
    }

    const newModel = {
      id: id.trim(),
      name: name.trim() || id.trim(), // Use ID as name if name not provided
      contextLength: contextLength || null,
      pricing:
        inputPricing || outputPricing
          ? {
              input: parseFloat(inputPricing) || 0,
              output: parseFloat(outputPricing) || 0,
            }
          : null,
    };

    onAdd(selectedProvider, newModel);

    // Reset form
    setName("");
    setId("");
    setContextLength(null);
    setInputPricing("");
    setOutputPricing("");
    setFetchMessage(null);
  };

  const handleAutoFetch = async () => {
    if (!id.trim()) {
      setFetchMessage({ text: "Please enter a model ID first", intent: Intent.WARNING });
      setTimeout(() => setFetchMessage(null), 3000);
      return;
    }

    setIsFetching(true);
    setFetchMessage(null);
    try {
      const { data } = await axios.get("https://openrouter.ai/api/v1/models");

      // Search for matching model ID
      const modelId = id.trim();
      const match = data.data.find(
        (m) =>
          m.id === modelId ||
          m.id.endsWith(`/${modelId}`) ||
          m.name.toLowerCase().includes(modelId.toLowerCase())
      );

      if (match) {
        setContextLength(match.context_length);
        setInputPricing((match.pricing.prompt * 1000000).toFixed(2));
        setOutputPricing((match.pricing.completion * 1000000).toFixed(2));
        setName(match.name);

        setFetchMessage({ text: `Found: "${match.name}"`, intent: Intent.SUCCESS });
        setTimeout(() => setFetchMessage(null), 4000);
      } else {
        setFetchMessage({ text: "Model not found in OpenRouter", intent: Intent.WARNING });
        setTimeout(() => setFetchMessage(null), 4000);
      }
    } catch (error) {
      console.error("Failed to fetch from OpenRouter:", error);
      setFetchMessage({ text: "Failed to fetch from OpenRouter", intent: Intent.DANGER });
      setTimeout(() => setFetchMessage(null), 4000);
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <div className="custom-model-form-compact">
      {/* Row 0: Provider Selector */}
      <div className="form-row">
        <div className="form-field">
          <label>Provider <span className="required">*</span></label>
          <HTMLSelect
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            options={availableProviders}
            fill
            small
          />
        </div>
      </div>

      {/* Row 1: Model ID + Fetch button */}
      <div className="form-row">
        <div className="form-field id-field">
          <label>Model ID <span className="required">*</span></label>
          <div className="input-with-button">
            <InputGroup
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="e.g., claude-3-5-sonnet-20241022"
              small
            />
            <Button
              icon="cloud-download"
              onClick={handleAutoFetch}
              disabled={isFetching || !id.trim()}
              loading={isFetching}
              small
              minimal
              title="Fetch metadata from OpenRouter"
            />
          </div>
        </div>
      </div>

      {/* Row 2: Display Name */}
      <div className="form-row">
        <div className="form-field">
          <label>Display Name <span className="optional">(optional)</span></label>
          <InputGroup
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Defaults to Model ID"
            small
          />
        </div>
      </div>

      {/* Row 3: Context + Pricing (compact) */}
      <div className="form-row metadata-row">
        <div className="form-field context-field">
          <label>Context</label>
          <NumericInput
            value={contextLength}
            onValueChange={(value) => setContextLength(value)}
            placeholder="128000"
            min={0}
            buttonPosition="none"
            small
          />
        </div>
        <div className="form-field price-field">
          <label>$/M In</label>
          <InputGroup
            placeholder="0.00"
            value={inputPricing}
            onChange={(e) => setInputPricing(e.target.value)}
            type="number"
            step="0.01"
            small
          />
        </div>
        <div className="form-field price-field">
          <label>$/M Out</label>
          <InputGroup
            placeholder="0.00"
            value={outputPricing}
            onChange={(e) => setOutputPricing(e.target.value)}
            type="number"
            step="0.01"
            small
          />
        </div>
      </div>

      {/* Messages */}
      {fetchMessage && (
        <div className={`form-message ${fetchMessage.intent}`}>
          {fetchMessage.text}
        </div>
      )}
      {isDuplicate && (
        <div className="form-message warning">
          Model ID already exists
        </div>
      )}

      {/* Actions */}
      <div className="form-actions-compact">
        <Button
          small
          minimal
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          icon="add"
          intent="primary"
          onClick={handleAdd}
          disabled={!id.trim() || isDuplicate || isFetching}
          small
        >
          Add
        </Button>
      </div>
    </div>
  );
};

export default CustomModelForm;
