import React, { useState, useEffect, useMemo } from "react";
import {
  InputGroup,
  Button,
  Tag,
  Spinner,
  NonIdealState,
  HTMLSelect,
  Callout,
} from "@blueprintjs/core";
import axios from "axios";
import { AppToaster } from "../Toaster";
import { formatContextLength } from "../../utils/modelConfigHelpers";
import "./OpenRouterBrowser.css";

/**
 * OpenRouterBrowser component - browse and add models from OpenRouter catalog
 * @param {Object} props
 * @param {Array} props.existingModels - Already added OpenRouter models
 * @param {Function} props.onAddModel - Callback when model is added
 */
export const OpenRouterBrowser = ({ existingModels = [], onAddModel }) => {
  const [allModels, setAllModels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("date-new");
  const [filterBy, setFilterBy] = useState("all");

  // Fetch models from OpenRouter API
  useEffect(() => {
    const fetchModels = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const { data } = await axios.get("https://openrouter.ai/api/v1/models");
        setAllModels(data.data || []);
      } catch (err) {
        console.error("Failed to fetch OpenRouter models:", err);
        setError("Failed to load models from OpenRouter. Please try again.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchModels();
  }, []);

  // Get set of existing model IDs for quick lookup
  const existingModelIds = useMemo(() => {
    return new Set(existingModels.map((m) => m.id));
  }, [existingModels]);

  // Filter and sort models
  const filteredModels = useMemo(() => {
    let models = [...allModels];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      models = models.filter(
        (m) =>
          m.id.toLowerCase().includes(query) ||
          m.name.toLowerCase().includes(query) ||
          (m.description && m.description.toLowerCase().includes(query))
      );
    }

    // Apply category filter
    if (filterBy !== "all") {
      models = models.filter((m) => {
        const id = m.id.toLowerCase();
        switch (filterBy) {
          case "openai":
            return id.includes("openai") || id.includes("gpt");
          case "anthropic":
            return id.includes("anthropic") || id.includes("claude");
          case "google":
            return id.includes("google") || id.includes("gemini");
          case "meta":
            return id.includes("meta") || id.includes("llama");
          case "mistral":
            return id.includes("mistral") || id.includes("mixtral");
          case "deepseek":
            return id.includes("deepseek");
          case "moonshot":
            return id.includes("moonshot");
          case "qwen":
            return id.includes("qwen");
          case "free":
            return m.pricing?.prompt === "0" || m.pricing?.prompt === 0;
          default:
            return true;
        }
      });
    }

    // Apply sorting
    models.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "context":
          return (b.context_length || 0) - (a.context_length || 0);
        case "price-low":
          return (
            parseFloat(a.pricing?.prompt || 0) -
            parseFloat(b.pricing?.prompt || 0)
          );
        case "price-high":
          return (
            parseFloat(b.pricing?.prompt || 0) -
            parseFloat(a.pricing?.prompt || 0)
          );
        case "date-new":
          return (b.created || 0) - (a.created || 0); // Newest first
        case "date-old":
          return (a.created || 0) - (b.created || 0); // Oldest first
        default:
          return 0;
      }
    });

    return models;
  }, [allModels, searchQuery, sortBy, filterBy]);

  const handleAddModel = (model) => {
    const newModel = {
      id: model.id,
      name: model.name,
      contextLength: model.context_length,
      pricing: {
        input: parseFloat(model.pricing?.prompt || 0) * 1000000,
        output: parseFloat(model.pricing?.completion || 0) * 1000000,
      },
    };

    onAddModel(newModel);

    AppToaster.show({
      message: `Added "${model.name}" to OpenRouter models`,
      intent: "success",
      timeout: 2000,
    });
  };

  const formatPrice = (pricePerToken) => {
    if (!pricePerToken || pricePerToken === "0") return "Free";
    const pricePerMillion = parseFloat(pricePerToken) * 1000000;
    if (pricePerMillion < 0.01) return "<$0.01";
    return `$${pricePerMillion.toFixed(2)}`;
  };

  if (isLoading) {
    return (
      <div className="openrouter-browser-loading">
        <Spinner size={40} />
        <p>Loading models from OpenRouter...</p>
      </div>
    );
  }

  if (error) {
    return (
      <NonIdealState
        icon="error"
        title="Failed to Load Models"
        description={error}
        action={
          <Button icon="refresh" onClick={() => window.location.reload()}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div className="openrouter-browser">
      <Callout intent="primary" className="browser-info">
        Browse the OpenRouter model catalog. Adding a model here will make it
        available in your model menu when using OpenRouter.
      </Callout>

      <div className="browser-controls">
        <InputGroup
          leftIcon="search"
          placeholder="Search models..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="browser-search"
          rightElement={
            searchQuery ? (
              <Button icon="cross" minimal onClick={() => setSearchQuery("")} />
            ) : undefined
          }
        />

        <div className="browser-filters">
          <HTMLSelect
            value={filterBy}
            onChange={(e) => setFilterBy(e.target.value)}
            options={[
              { value: "all", label: "All Providers" },
              { value: "openai", label: "OpenAI" },
              { value: "anthropic", label: "Anthropic" },
              { value: "google", label: "Google" },
              { value: "deepseek", label: "DeepSeek" },
              { value: "meta", label: "Meta/Llama" },
              { value: "mistral", label: "Mistral" },
              { value: "moonshot", label: "MoonshotAI" },
              { value: "qwen", label: "Qwen" },
              { value: "free", label: "Free Models" },
            ]}
          />

          <HTMLSelect
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            options={[
              { value: "date-new", label: "Newest First" },
              { value: "date-old", label: "Oldest First" },
              { value: "name", label: "Sort by Name" },
              { value: "context", label: "Sort by Context" },
              { value: "price-low", label: "Price: Low to High" },
              { value: "price-high", label: "Price: High to Low" },
            ]}
          />
        </div>
      </div>

      <div className="browser-results-count">
        Showing {filteredModels.length} of {allModels.length} models
      </div>

      <div className="browser-models-list">
        {filteredModels.length === 0 ? (
          <NonIdealState
            icon="search"
            title="No Models Found"
            description="Try adjusting your search or filters"
          />
        ) : (
          filteredModels.map((model) => {
            const isAdded = existingModelIds.has(model.id);

            return (
              <div
                key={model.id}
                className={`or-model-item ${isAdded ? "already-added" : ""}`}
              >
                <div className="or-model-info">
                  <div className="or-model-name">
                    {model.name}
                    {isAdded && (
                      <Tag intent="success" minimal className="added-tag">
                        Added
                      </Tag>
                    )}
                  </div>
                  <div className="or-model-id">{model.id}</div>
                  <div className="or-model-meta">
                    {model.context_length && (
                      <span className="meta-item">
                        {formatContextLength(model.context_length)}
                      </span>
                    )}
                    <span className="meta-item price-in">
                      In: {formatPrice(model.pricing?.prompt)}
                    </span>
                    <span className="meta-item price-out">
                      Out: {formatPrice(model.pricing?.completion)}
                    </span>
                  </div>
                </div>
                <Button
                  icon={isAdded ? "tick" : "plus"}
                  intent={isAdded ? "success" : "primary"}
                  disabled={isAdded}
                  onClick={() => handleAddModel(model)}
                  small
                  minimal={isAdded}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default OpenRouterBrowser;
