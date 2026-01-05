import React, { useState, useEffect } from "react";
import { InputGroup, Switch, Callout } from "@blueprintjs/core";
import "./ProviderEndpointConfig.css";

/**
 * ProviderEndpointConfig - Configure custom endpoint for providers
 * Only used for OpenAI-compatible and Ollama providers
 *
 * @param {Object} props
 * @param {string} props.provider - Provider name ('openai' or 'ollama')
 * @param {Object} props.endpoint - Current endpoint configuration {baseURL, enabled}
 * @param {Function} props.onChange - Callback when configuration changes
 */
export const ProviderEndpointConfig = ({ provider, endpoint, onChange }) => {
  const [baseURL, setBaseURL] = useState(
    endpoint?.baseURL || getDefaultEndpoint(provider)
  );
  const [enabled, setEnabled] = useState(endpoint?.enabled ?? false);

  // Sync with prop changes
  useEffect(() => {
    setBaseURL(endpoint?.baseURL || getDefaultEndpoint(provider));
    setEnabled(endpoint?.enabled ?? false);
  }, [endpoint, provider]);

  const handleBaseURLChange = (e) => {
    const newURL = e.target.value;
    setBaseURL(newURL);
    onChange({ baseURL: newURL, enabled });
  };

  const handleBaseURLBlur = () => {
    // Clean up URL on blur (remove trailing slash)
    const cleanedURL = baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
    if (cleanedURL !== baseURL) {
      setBaseURL(cleanedURL);
      onChange({ baseURL: cleanedURL, enabled });
    }
  };

  const handleEnabledToggle = () => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);
    onChange({ baseURL, enabled: newEnabled });
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
        label="Enable endpoint"
        small
        className="endpoint-switch"
      />
      <Callout intent="primary" className="endpoint-hint">
        {getEndpointHint(provider)}
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
 */
function getEndpointHint(provider) {
  if (provider === "openai") {
    return "For LM Studio, text-generation-webui, vLLM, or other OpenAI-compatible servers. Enable this to use custom models with your local endpoint.";
  } else {
    return "Ensure OLLAMA_ORIGINS environment variable is configured correctly to allow browser access.";
  }
}

export default ProviderEndpointConfig;
