import React, { useState, useEffect } from "react";
import { InputGroup, Switch, Callout } from "@blueprintjs/core";
import "./ProviderEndpointConfig.css";

/**
 * ProviderEndpointConfig - Configure custom endpoint for providers
 * Only used for OpenAI-compatible and Ollama providers
 *
 * @param {Object} props
 * @param {string} props.provider - Provider name ('openai' or 'ollama')
 * @param {Object} props.endpoint - Current endpoint configuration {baseURL, enabled, exclusive}
 * @param {Function} props.onChange - Callback when configuration changes
 */
export const ProviderEndpointConfig = ({ provider, endpoint, onChange }) => {
  const [baseURL, setBaseURL] = useState(
    endpoint?.baseURL || getDefaultEndpoint(provider)
  );
  const [enabled, setEnabled] = useState(endpoint?.enabled ?? false);
  const [exclusive, setExclusive] = useState(endpoint?.exclusive ?? false);

  // Sync with prop changes
  useEffect(() => {
    setBaseURL(endpoint?.baseURL || getDefaultEndpoint(provider));
    setEnabled(endpoint?.enabled ?? false);
    setExclusive(endpoint?.exclusive ?? false);
  }, [endpoint, provider]);

  const handleBaseURLChange = (e) => {
    const newURL = e.target.value;
    setBaseURL(newURL);
    onChange({ baseURL: newURL, enabled, exclusive });
  };

  const handleBaseURLBlur = () => {
    // Clean up URL on blur (remove trailing slash)
    const cleanedURL = baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
    if (cleanedURL !== baseURL) {
      setBaseURL(cleanedURL);
      onChange({ baseURL: cleanedURL, enabled, exclusive });
    }
  };

  const handleEnabledToggle = () => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);
    // If disabling, also disable exclusive mode
    const newExclusive = newEnabled ? exclusive : false;
    if (!newEnabled) setExclusive(false);
    onChange({ baseURL, enabled: newEnabled, exclusive: newExclusive });
  };

  const handleExclusiveToggle = () => {
    const newExclusive = !exclusive;
    setExclusive(newExclusive);
    onChange({ baseURL, enabled, exclusive: newExclusive });
  };

  return (
    <div className="provider-endpoint-config">
      <div className="endpoint-field">
        <label className="endpoint-label">
          {provider === "openai" ? "Base URL" : "Server Address"}
        </label>
        <InputGroup
          value={baseURL}
          onChange={handleBaseURLChange}
          onBlur={handleBaseURLBlur}
          placeholder={getDefaultEndpoint(provider)}
          small
          className="endpoint-input"
        />
      </div>
      <Switch
        checked={enabled}
        onChange={handleEnabledToggle}
        label="Enable custom endpoint"
        small
        className="endpoint-switch"
      />
      {provider === "openai" && (
        <Switch
          checked={exclusive}
          onChange={handleExclusiveToggle}
          label="Use exclusively for all OpenAI models"
          disabled={!enabled}
          small
          className="endpoint-switch exclusive-switch"
        />
      )}
      <Callout intent="primary" className="endpoint-hint" icon={null}>
        {getEndpointHint(provider, enabled, exclusive)}
      </Callout>
    </div>
  );
};

/**
 * Get default endpoint URL for a provider
 */
function getDefaultEndpoint(provider) {
  return provider === "openai"
    ? "http://localhost:1234/v1"
    : "http://localhost:11434";
}

/**
 * Get helpful hint text for endpoint configuration
 * @param {string} provider - Provider name
 * @param {boolean} enabled - Whether endpoint is enabled
 * @param {boolean} exclusive - Whether exclusive mode is active
 */
function getEndpointHint(provider, enabled = false, exclusive = false) {
  if (provider === "openai") {
    if (!enabled) {
      return "For LM Studio, text-generation-webui, vLLM, or other OpenAI-compatible servers. Enable this to add custom models using your local endpoint.";
    } else if (exclusive) {
      return "Exclusive mode: ALL OpenAI-compatible API calls will be routed through your custom endpoint. Native OpenAI models will use this endpoint instead of the official API. Useful when you don't have an OpenAI API key or want to use a local server for everything.";
    } else {
      return "Custom endpoint enabled for custom models only. Native OpenAI models (GPT-4, etc.) will still use the official OpenAI API. Enable 'exclusive' mode to route all calls through your custom endpoint.";
    }
  } else {
    return "Ensure OLLAMA_ORIGINS environment variable is configured correctly to allow browser access.";
  }
}

export default ProviderEndpointConfig;
