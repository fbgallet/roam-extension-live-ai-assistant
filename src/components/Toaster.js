import { Button, Intent, Position, Toaster } from "@blueprintjs/core";
import ReactDOM from "react-dom";
import React from "react";
import FullResultsPopup from "./FullResultsPopup";

// Toaster configurations
const toasterConfigs = {
  AppToaster: {
    className: "color-toaster",
    position: Position.TOP,
    intent: Intent.WARNING,
    icon: "warning-sign",
    maxToasts: 1,
    timeout: 12000,
  },
  AgentToaster: {
    className: "search-agent-toaster",
    position: Position.TOP,
    intent: Intent.NONE,
    icon: "form",
    maxToasts: 1,
  },
  ThinkingToaster: {
    className: "thinking-toaster",
    position: Position.TOP,
    intent: Intent.NONE,
    isCloseButtonShown: false,
    canEscapeKeyClear: true,
    maxToasts: 1,
  },
  MCPToaster: {
    className: "mcp-toaster",
    position: Position.TOP_RIGHT,
    intent: Intent.NONE,
    isCloseButtonShown: false,
    canEscapeKeyClear: true,
    maxToasts: 1,
  },
};

// Create or recreate toaster
const createOrRecreateToaster = (name) => {
  return Toaster.create(toasterConfigs[name]);
};

// Initialize toasters
export let AppToaster = createOrRecreateToaster('AppToaster');
export let AgentToaster = createOrRecreateToaster('AgentToaster');
export let ThinkingToaster = createOrRecreateToaster('ThinkingToaster');
export let MCPToaster = createOrRecreateToaster('MCPToaster');

// Function to ensure toaster is functional, recreate if needed
export const ensureToaster = (name) => {
  const currentToaster = { AppToaster, AgentToaster, ThinkingToaster, MCPToaster }[name];
  try {
    currentToaster.getToasts();
    return currentToaster;
  } catch (error) {
    // Recreate and update the export
    const newToaster = createOrRecreateToaster(name);
    if (name === 'MCPToaster') MCPToaster = newToaster;
    else if (name === 'ThinkingToaster') ThinkingToaster = newToaster;
    else if (name === 'AgentToaster') AgentToaster = newToaster;
    else if (name === 'AppToaster') AppToaster = newToaster;
    return newToaster;
  }
};

export const displayThinkingToast = (message = "", options = {}) => {
  const toastId = ThinkingToaster.show({
    message,
    timeout: 0,
    isCloseButtonShown: false,
  });
  const thinkingToasterStream = document.querySelector(
    ".thinking-toaster .bp3-toast-message"
  );
  if (thinkingToasterStream) {
    thinkingToasterStream.innerText += `\n\n`;
    addButtonsToToaster(toastId, ".thinking-toaster", ThinkingToaster, options);
  }
  return thinkingToasterStream;
};

export const displayMCPToast = (message = "", options = {}) => {
  const toastId = MCPToaster.show({
    message,
    timeout: 0,
    isCloseButtonShown: false,
  });

  // Use requestAnimationFrame to wait for DOM update, then setTimeout for render completion
  setTimeout(() => {
    const mcpToasterStream = document.querySelector(
      ".mcp-toaster .bp3-toast-message"
    );
    if (mcpToasterStream) {
      // mcpToasterStream.innerText = message + `\n\n`;
      addButtonsToToaster(toastId, ".mcp-toaster", MCPToaster, options);

      // Store the element globally so it can be accessed later
      window.mcpToasterStreamElement = mcpToasterStream;
    }
  }, 50); // Slightly longer delay to ensure full render

  // Return a function that retrieves the element
  const getToasterElement = () => {
    return (
      window.mcpToasterStreamElement ||
      document.querySelector(".mcp-toaster .bp3-toast-message")
    );
  };

  return getToasterElement();
};

// Global state for agent cancellation - shared between MCP and Search agents
let currentAgentController = null;
let currentFullResults = null;
let isAgentStopped = false;

export const setAgentController = (controller) => {
  currentAgentController = controller;
  isAgentStopped = false;
};

export const clearAgentController = () => {
  currentAgentController = null;
  isAgentStopped = false;
};

export const setAgentFullResults = (results) => {
  currentFullResults = results;
};

export const clearAgentFullResults = () => {
  currentFullResults = null;
};

export const markAgentAsStopped = () => {
  isAgentStopped = true;
};

export const addButtonsToToaster = (
  _toastId,
  toasterSelector,
  toasterInstance,
  options = {}
) => {
  const toasterElt = document.querySelector(`${toasterSelector} .bp3-toast`);
  if (!toasterElt) return;
  const newDiv = document.createElement("div");
  newDiv.classList.add("buttons");
  toasterElt.appendChild(newDiv);

  const props = { minimal: true, size: "small" };

  const buttons = [];

  // Add copy button for non-agent toasters (or agents without full results)
  if (!options.showFullResultsButton) {
    buttons.push(
      <Button
        key="copy"
        text="Copy to clipboard"
        {...props}
        intent="primary"
        onClick={() => {
          const msgElt = toasterElt.querySelector(".bp3-toast-message");
          navigator.clipboard.writeText(msgElt.innerText);
        }}
      />
    );
  }

  // Add stop button for agent processing (available during execution)
  if (options.showStopButton && (currentAgentController || isAgentStopped)) {
    const handleStop = () => {
      if (currentAgentController && !isAgentStopped) {
        // Immediately abort the controller
        currentAgentController.abort();

        // Update the message immediately
        const msgElt = toasterElt.querySelector(".bp3-toast-message");
        if (msgElt) {
          msgElt.innerText += "\n🛑 Stopping agent...";
        }

        // Mark as stopped
        markAgentAsStopped();

        // Update button appearance using DOM manipulation
        setTimeout(() => {
          const stopBtn = toasterElt.querySelector(".agent-stop-button");
          if (stopBtn) {
            stopBtn.textContent = "Stopped";
            stopBtn.disabled = true;
            stopBtn.className = stopBtn.className.replace(
              "bp3-intent-danger",
              "bp3-intent-none"
            );
            // Remove stop icon
            const iconEl = stopBtn.querySelector(".bp3-icon-stop");
            if (iconEl) {
              iconEl.remove();
            }
          }
        }, 10);

        clearAgentController();
      }
    };

    buttons.unshift(
      <Button
        key="stop"
        className="agent-stop-button"
        text={isAgentStopped ? "Stopped" : "Stop"}
        {...props}
        intent={isAgentStopped ? "none" : "danger"}
        icon={isAgentStopped ? null : "stop"}
        disabled={isAgentStopped}
        onClick={handleStop}
      />
    );
  }

  // Add view full results button (available after completion)
  if (options.showFullResultsButton && currentFullResults) {
    const targetUid = window.lastAgentResponseTargetUid || null;
    
    buttons.push(
      <Button
        key="results"
        text="View Full Results"
        {...props}
        intent="primary"
        icon="list-detail-view"
        onClick={() => openFullResultsPopup(currentFullResults, targetUid)}
      />
    );
  }

  buttons.push(
    <Button
      key="close"
      text="Close"
      {...props}
      onClick={() => {
        if (toasterInstance) {
          toasterInstance.clear();
        } else {
          // Determine toaster name from selector and ensure it works
          const toasterName = toasterSelector === ".mcp-toaster" ? "MCPToaster" :
                             toasterSelector === ".thinking-toaster" ? "ThinkingToaster" :
                             toasterSelector === ".search-agent-toaster" ? "AgentToaster" :
                             toasterSelector === ".color-toaster" ? "AppToaster" : null;
          
          if (toasterName) {
            ensureToaster(toasterName).clear();
          }
        }
      }}
    />
  );

  const buttonSectionJSX = <>{buttons}</>;

  ReactDOM.render(buttonSectionJSX, newDiv);
};

// React component for popup functionality
export const openFullResultsPopup = (results, targetUid = null) => {
  // Remove any existing popup first
  const existingContainer = document.getElementById(
    "full-results-popup-container"
  );
  if (existingContainer) {
    try {
      ReactDOM.unmountComponentAtNode(existingContainer);
      document.body.removeChild(existingContainer);
    } catch (error) {
      console.warn("Error cleaning up existing popup:", error);
    }
  }

  // Create a container for the React component
  const container = document.createElement("div");
  container.id = "full-results-popup-container";
  document.body.appendChild(container);

  const PopupWrapper = () => {
    return React.createElement(FullResultsPopup, {
      results: results || [],
      isOpen: true,
      title: "Ask your graph: last request full results",
      targetUid: targetUid,
    });
  };

  ReactDOM.render(React.createElement(PopupWrapper), container);
};

// Make it globally accessible for command palette
if (typeof window !== "undefined") {
  if (!window.LiveAI) window.LiveAI = {};
  window.LiveAI.openFullResultsPopup = openFullResultsPopup;
}
