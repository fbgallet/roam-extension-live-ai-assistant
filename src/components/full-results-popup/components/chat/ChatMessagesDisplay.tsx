/**
 * Chat Messages Display Component
 *
 * Renders the chat message list including welcome state, message history, and streaming indicator
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Button,
  Icon,
  Menu,
  MenuItem,
  Popover,
  Position,
} from "@blueprintjs/core";
import { ChatMessage, ChatMode } from "../../types/types";
import { renderMarkdown } from "../../utils/chatMessageUtils";
import {
  CHAT_HELP_RESPONSE,
  LIVE_AI_HELP_RESPONSE,
  WHATS_NEW_RESPONSE,
  getRandomTip,
} from "./chatHelpConstants";
import { textToSpeech } from "../../../../ai/multimodalAI";

// Helper function to detect if content contains KaTeX formulas
const containsKaTeX = (content: string): boolean => {
  return /\$\$.+?\$\$/s.test(content);
};

// Helper component to render message content with KaTeX formulas
// Renders markdown structure normally, but uses Roam API for KaTeX formulas
const MessageContent: React.FC<{ content: string; className?: string }> = ({
  content,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Check if content has special Roam elements that need renderString
    const hasRoamElements =
      containsKaTeX(content) ||
      /\{\{\[\[(?:audio|video|youtube)\]\]:\s*https?:[^\s}]+\}\}/i.test(
        content,
      );

    if (hasRoamElements) {
      // First, render the markdown structure normally
      containerRef.current.innerHTML = renderMarkdown(content);

      // Then, find all text nodes and render any Roam-specific elements with Roam API
      const textNodes: Node[] = [];
      const walker = document.createTreeWalker(
        containerRef.current,
        NodeFilter.SHOW_TEXT,
        null,
      );

      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (
          node.textContent &&
          (/\$\$.+?\$\$/s.test(node.textContent) ||
            /\{\{\[\[(?:audio|video|youtube)\]\]:/i.test(node.textContent))
        ) {
          textNodes.push(node);
        }
      }

      // Replace text nodes containing Roam elements with Roam-rendered spans
      textNodes.forEach((textNode) => {
        const text = textNode.textContent || "";
        const parent = textNode.parentNode;

        if (!parent) return;

        // Split by KaTeX formulas and media embeds
        const parts = text.split(
          /(\$\$.+?\$\$|\{\{\[\[(?:audio|video|youtube)\]\]:\s*https?:[^\s}]+\}\})/is,
        );
        const fragment = document.createDocumentFragment();

        parts.forEach((part) => {
          if (/^\$\$.+?\$\$$/s.test(part)) {
            // This is a KaTeX formula - render with Roam API
            const span = document.createElement("span");
            try {
              window.roamAlphaAPI?.ui.components.renderString({
                el: span,
                string: part,
              });
            } catch (error) {
              console.error("Failed to render KaTeX:", error);
              span.textContent = part; // Fallback to showing raw formula
            }
            fragment.appendChild(span);
          } else if (/^\{\{\[\[(?:audio|video|youtube)\]\]:/i.test(part)) {
            // This is an audio or video embed - render with Roam API
            const div = document.createElement("div");
            div.style.display = "block";
            div.style.margin = "8px 0";
            try {
              window.roamAlphaAPI?.ui.components.renderString({
                el: div,
                string: part,
              });
            } catch (error) {
              console.error("Failed to render media embed:", error);
              div.textContent = part; // Fallback to showing raw embed syntax
            }
            fragment.appendChild(div);
          } else if (part) {
            // Regular text
            fragment.appendChild(document.createTextNode(part));
          }
        });

        parent.replaceChild(fragment, textNode);
      });
    } else {
      // No special Roam elements - just use regular markdown rendering
      containerRef.current.innerHTML = renderMarkdown(content);
    }
  }, [content]);

  return <div ref={containerRef} className={className} />;
};

// Helper component for editing a message using Roam's native block editor
const EditableMessage: React.FC<{
  blockUid: string;
  onSave: () => void;
  onCancel: () => void;
}> = ({ blockUid, onSave, onCancel }) => {
  const editorContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editorContainerRef.current || !blockUid) return;

    // Clear any existing content
    editorContainerRef.current.innerHTML = "";

    // Use Roam's renderBlock API to render the editable block
    try {
      window.roamAlphaAPI.ui.components.renderBlock({
        uid: blockUid,
        el: editorContainerRef.current,
        "zoom-path?": true,
      });
    } catch (error) {
      console.error("Failed to render block for editing:", error);
      editorContainerRef.current.innerHTML =
        '<div class="chat-message-edit-error">Failed to load editor</div>';
    }

    return () => {
      // Cleanup on unmount
      if (editorContainerRef.current) {
        editorContainerRef.current.innerHTML = "";
      }
    };
  }, [blockUid]);

  // Handle Escape key to cancel editing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="chat-message-edit-wrapper">
      <div ref={editorContainerRef} className="chat-message-edit-container" />
      <div className="chat-message-edit-actions">
        <Button
          icon="tick"
          intent="success"
          small
          onClick={onSave}
          title="Save changes"
        >
          Save
        </Button>
        <Button
          icon="cross"
          minimal
          small
          onClick={onCancel}
          title="Cancel (Esc)"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
};

// Helper component for expandable content in confirmation preview
const ExpandableContent: React.FC<{
  content: string;
  truncateAt?: number;
  className?: string;
}> = ({ content, truncateAt = 80, className }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const needsTruncation = content.length > truncateAt;

  if (!needsTruncation) {
    return <span className={className}>{content || "(empty)"}</span>;
  }

  return (
    <span className={className}>
      {isExpanded ? content : content.substring(0, truncateAt) + "..."}
      <button
        className="tool-confirmation-expand-btn"
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
        title={isExpanded ? "Show less" : "Show full content"}
      >
        {isExpanded ? "▲" : "▼"}
      </button>
    </span>
  );
};

interface PendingToolConfirmation {
  toolName: string;
  toolCallId: string;
  args: Record<string, any>;
  timestamp: number;
}

export interface PendingUserChoice {
  commandId: string;
  title: string;
  hintsEnabled?: boolean;
  options: Array<{
    id: string;
    label: string;
    type: "radio" | "checkbox" | "text" | "slider";
    choices?: Array<{ value: string; label: string; hint?: string }>;
    defaultValue?: string;
    placeholder?: string;
    min?: number;
    max?: number;
    step?: number;
  }>;
  timestamp: number;
}

/**
 * Inline choice form component — used by both ask_user_choice tool and PDF export bypass
 */
/**
 * Renders a single choice item (radio or checkbox) with optional hint tooltip
 */
const ChoiceItem: React.FC<{
  choice: { value: string; label: string; hint?: string };
  hintsVisible: boolean;
  children: React.ReactNode;
}> = ({ choice, hintsVisible, children }) => {
  if (hintsVisible && choice.hint) {
    return (
      <Popover
        content={
          <div className="user-choice-hint-popover">{choice.hint}</div>
        }
        interactionKind="hover"
        position={Position.RIGHT}
        hoverOpenDelay={200}
        hoverCloseDelay={100}
        minimal
      >
        {children as React.ReactElement}
      </Popover>
    );
  }
  return <>{children}</>;
};

const UserChoiceForm: React.FC<{
  pendingChoice: PendingUserChoice;
  onSubmit: (selectedOptions: Record<string, string>) => void;
  onCancel: () => void;
}> = ({ pendingChoice, onSubmit, onCancel }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selections, setSelections] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    pendingChoice.options.forEach((opt) => {
      if (opt.type === "text") {
        defaults[opt.id] = opt.defaultValue || "";
      } else if (opt.type === "checkbox") {
        defaults[opt.id] = "";
      } else if (opt.type === "slider") {
        const min = opt.min ?? 0;
        const max = opt.max ?? 10;
        defaults[opt.id] =
          opt.defaultValue || String(Math.round((min + max) / 2));
      } else {
        defaults[opt.id] = opt.defaultValue || opt.choices?.[0]?.value || "";
      }
    });
    return defaults;
  });
  const [hintsVisible, setHintsVisible] = useState(false);

  // Auto-focus and scroll into view on mount
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
      containerRef.current.focus();
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
      e.preventDefault();
      onSubmit(selections);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    // Number keys 1-9 for quick radio/checkbox selection
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9) {
      // Don't intercept when typing in text inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") {
        const inputType = (e.target as HTMLInputElement).type;
        if (inputType === "text" || inputType === "number" || tag === "TEXTAREA") return;
      }
      // Find radio/checkbox groups
      const choiceGroups = pendingChoice.options.filter(
        (opt) => (opt.type === "radio" || opt.type === "checkbox" || !opt.type) && opt.choices
      );
      if (choiceGroups.length === 0) return;
      // Apply to first (or only) choice group
      const group = choiceGroups[0];
      const idx = num - 1;
      if (group.choices && idx < group.choices.length) {
        e.preventDefault();
        const choiceValue = group.choices[idx].value;
        if (group.type === "checkbox") {
          toggleCheckbox(group.id, choiceValue);
        } else {
          setSelections((prev) => ({ ...prev, [group.id]: choiceValue }));
        }
      }
    }
  };

  // Check if any choice has a hint
  const hasHints =
    pendingChoice.hintsEnabled &&
    pendingChoice.options.some(
      (opt) => opt.choices?.some((c) => c.hint)
    );

  const toggleCheckbox = (groupId: string, value: string) => {
    setSelections((prev) => {
      const current = prev[groupId]
        ? prev[groupId].split(",").filter(Boolean)
        : [];
      const updated = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [groupId]: updated.join(",") };
    });
  };

  return (
    <div
      className="full-results-chat-user-choice"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="user-choice-header">
        <Icon icon="info-sign" size={14} />
        <span>{pendingChoice.title}</span>
        {hasHints && (
          <Button
            minimal
            small
            icon="lightbulb"
            intent={hintsVisible ? "warning" : "none"}
            className="user-choice-hint-toggle"
            title={hintsVisible ? "Hide hints" : "Show hints"}
            onClick={() => setHintsVisible(!hintsVisible)}
          />
        )}
      </div>
      {pendingChoice.options.map((optGroup) => (
        <div key={optGroup.id} className="user-choice-group">
          <div className="user-choice-label">{optGroup.label}</div>

          {/* Radio: single choice */}
          {(optGroup.type === "radio" || !optGroup.type) &&
            optGroup.choices && (
              <div className="user-choice-options">
                {optGroup.choices.map((choice) => (
                  <ChoiceItem
                    key={choice.value}
                    choice={choice}
                    hintsVisible={hintsVisible}
                  >
                    <label className="user-choice-radio">
                      <input
                        type="radio"
                        name={`user-choice-${pendingChoice.commandId}-${optGroup.id}`}
                        value={choice.value}
                        checked={selections[optGroup.id] === choice.value}
                        onChange={() =>
                          setSelections((prev) => ({
                            ...prev,
                            [optGroup.id]: choice.value,
                          }))
                        }
                      />
                      <span>{choice.label}</span>
                      {hintsVisible && choice.hint && (
                        <Icon
                          icon="lightbulb"
                          size={11}
                          className="user-choice-hint-icon"
                        />
                      )}
                    </label>
                  </ChoiceItem>
                ))}
              </div>
            )}

          {/* Checkbox: multiple choice */}
          {optGroup.type === "checkbox" && optGroup.choices && (
            <div className="user-choice-options">
              {optGroup.choices.map((choice) => {
                const selectedValues = selections[optGroup.id]
                  ? selections[optGroup.id].split(",").filter(Boolean)
                  : [];
                return (
                  <ChoiceItem
                    key={choice.value}
                    choice={choice}
                    hintsVisible={hintsVisible}
                  >
                    <label className="user-choice-checkbox">
                      <input
                        type="checkbox"
                        value={choice.value}
                        checked={selectedValues.includes(choice.value)}
                        onChange={() =>
                          toggleCheckbox(optGroup.id, choice.value)
                        }
                      />
                      <span>{choice.label}</span>
                      {hintsVisible && choice.hint && (
                        <Icon
                          icon="lightbulb"
                          size={11}
                          className="user-choice-hint-icon"
                        />
                      )}
                    </label>
                  </ChoiceItem>
                );
              })}
            </div>
          )}

          {/* Text: free-form input */}
          {optGroup.type === "text" && (
            <div className="user-choice-text-wrapper">
              <textarea
                className="user-choice-text-input"
                placeholder={optGroup.placeholder || "Type your answer..."}
                value={selections[optGroup.id] || ""}
                onChange={(e) =>
                  setSelections((prev) => ({
                    ...prev,
                    [optGroup.id]: e.target.value,
                  }))
                }
                rows={2}
              />
            </div>
          )}

          {/* Slider: range value */}
          {optGroup.type === "slider" && (() => {
            const min = optGroup.min ?? 0;
            const max = optGroup.max ?? 10;
            const step = optGroup.step ?? 1;
            const currentVal = selections[optGroup.id] || String(Math.round((min + max) / 2));
            return (
              <div className="user-choice-slider-wrapper">
                <input
                  type="range"
                  className="user-choice-slider"
                  min={min}
                  max={max}
                  step={step}
                  value={currentVal}
                  onChange={(e) =>
                    setSelections((prev) => ({
                      ...prev,
                      [optGroup.id]: e.target.value,
                    }))
                  }
                />
                <div className="user-choice-slider-labels">
                  <span className="user-choice-slider-min">{min}</span>
                  <span className="user-choice-slider-value">{currentVal}</span>
                  <span className="user-choice-slider-max">{max}</span>
                </div>
              </div>
            );
          })()}
        </div>
      ))}
      <div className="user-choice-buttons">
        <Button
          intent="primary"
          icon="tick"
          small
          onClick={() => onSubmit(selections)}
        >
          Confirm
        </Button>
        <Button intent="none" icon="cross" small onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

interface ChatMessagesDisplayProps {
  chatMessages: ChatMessage[];
  isTyping: boolean;
  isStreaming: boolean;
  streamingContent: string;
  toolUsageHistory: Array<{
    toolName: string;
    details: string;
    timestamp: number;
    intermediateMessage?: string;
  }>;
  modelTokensLimit: number;
  chatAccessMode: "Balanced" | "Full Access";
  chatMode: ChatMode;
  hasSearchResults: boolean;
  onCopyMessage: (content: string) => void;
  onDeleteMessage: (index: number) => void;
  onRetryMessage: (index: number) => void;
  onSuggestionClick: (suggestion: string) => void;
  onHelpButtonClick: (
    type: "chat" | "liveai" | "tip" | "helpabout" | "whatsnew",
    promptOrContent: string,
  ) => void;
  messagesContainerRef: React.RefObject<HTMLDivElement>;
  // Tool confirmation props
  pendingToolConfirmation: PendingToolConfirmation | null;
  onToolConfirmationResponse: (
    approved: boolean,
    alwaysApprove?: boolean,
    declineReason?: string,
  ) => void;
  declineReasonInput: string;
  setDeclineReasonInput: (value: string) => void;
  // User choice props
  pendingUserChoice: PendingUserChoice | null;
  onUserChoiceResponse: (selectedOptions: Record<string, string>) => void;
  onUserChoiceCancelled: () => void;
  // Edit message props
  editingMessageIndex: number | null;
  onEditMessage: (index: number) => void;
  onSaveEdit: (index: number) => void;
  onCancelEdit: (index: number) => void;
}

export const ChatMessagesDisplay: React.FC<ChatMessagesDisplayProps> = ({
  chatMessages,
  isTyping,
  isStreaming,
  streamingContent,
  toolUsageHistory,
  modelTokensLimit,
  chatAccessMode,
  chatMode,
  hasSearchResults,
  onCopyMessage,
  onDeleteMessage,
  onRetryMessage,
  onSuggestionClick,
  onHelpButtonClick,
  messagesContainerRef,
  pendingToolConfirmation,
  onToolConfirmationResponse,
  declineReasonInput,
  setDeclineReasonInput,
  pendingUserChoice,
  onUserChoiceResponse,
  onUserChoiceCancelled,
  editingMessageIndex,
  onEditMessage,
  onSaveEdit,
  onCancelEdit,
}) => {
  // Memoize the initial random tip so it doesn't change on every render
  const [initialTip] = React.useState(() => getRandomTip("chat"));

  // Keyboard shortcuts for tool confirmation (Enter = Accept, Escape = Decline)
  useEffect(() => {
    if (!pendingToolConfirmation) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in the decline reason input
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;

      if (e.key === "Enter") {
        e.preventDefault();
        onToolConfirmationResponse(true, false);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onToolConfirmationResponse(false, false, declineReasonInput);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingToolConfirmation, onToolConfirmationResponse, declineReasonInput]);

  // Function to render help buttons based on help type
  const renderHelpButtons = (
    helpType?: "chat" | "liveai" | "tip" | "whatsnew",
  ) => {
    const showHelpAbout = helpType === "chat" || helpType === "liveai";

    return (
      <>
        {chatMode === "agent" && !helpType && (
          <div
            style={{ fontSize: "12px", color: "#5c7080", marginBottom: "4px" }}
          >
            For more detailed help, ask your question with the{" "}
            <strong>Help tool</strong> enabled in{" "}
            <Icon icon="wrench" size={12} style={{ marginRight: "4px" }} />{" "}
            Agent mode.
          </div>
        )}
        <div className="full-results-chat-suggestions">
          {helpType !== "whatsnew" && (
            <button
              onClick={() => onHelpButtonClick("whatsnew", WHATS_NEW_RESPONSE)}
              disabled={isTyping}
            >
              <Icon icon="star" size={12} style={{ marginRight: "4px" }} />
              What's New
            </button>
          )}
          {helpType !== "chat" && (
            <button
              onClick={() => onHelpButtonClick("chat", CHAT_HELP_RESPONSE)}
              disabled={isTyping}
            >
              <Icon icon="chat" size={12} style={{ marginRight: "4px" }} />
              About this chat
            </button>
          )}
          {helpType !== "liveai" && (
            <button
              onClick={() => onHelpButtonClick("liveai", LIVE_AI_HELP_RESPONSE)}
              disabled={isTyping}
            >
              <Icon icon="lightning" size={12} style={{ marginRight: "4px" }} />
              About Live AI
            </button>
          )}
          {showHelpAbout && (
            <button
              onClick={() =>
                onHelpButtonClick(
                  "helpabout",
                  "Help me about By using the help tool, help me understand and use the following feature in a simple and guided way:",
                )
              }
              disabled={isTyping}
            >
              <Icon icon="help" size={12} style={{ marginRight: "4px" }} />
              Help about...
            </button>
          )}
          <button
            onClick={() => onHelpButtonClick("tip", getRandomTip("chat"))}
            disabled={isTyping}
          >
            <Icon icon="lightbulb" size={12} style={{ marginRight: "4px" }} />
            Random Tip
          </button>
        </div>
      </>
    );
  };

  // Initial help buttons for welcome screen (without helpType)
  const helpButtons = renderHelpButtons();

  return (
    <div className="full-results-chat-messages" ref={messagesContainerRef}>
      {chatMessages.length === 0 ? (
        <>
          {/* Help message with icon and random tip */}
          <div className="full-results-chat-welcome">
            <div className="full-results-chat-help-avatar">
              <Icon icon="help" size={18} intent="primary" />
            </div>
            <div className="full-results-chat-assistant-message chat-help">
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                }}
              >
                <Icon
                  icon="lightbulb"
                  size={14}
                  intent="warning"
                  style={{ marginTop: "2px", flexShrink: 0 }}
                />
                <div
                  style={{ flex: 1 }}
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(initialTip.replace(/^💡\s*/, "")),
                  }}
                />
              </div>
              {helpButtons}
            </div>
          </div>

          {/* Main welcome message */}
          <div className="full-results-chat-welcome">
            <div className="full-results-chat-assistant-avatar">🤖</div>
            <div className="full-results-chat-assistant-message">
              {hasSearchResults ? (
                <>
                  Hi! I can help you analyze and understand your search results.
                  What would you like to know?
                </>
              ) : (
                <>Hi! I'm here to help. What can I assist you with today?</>
              )}
              {hasSearchResults && (
                <div className="full-results-chat-suggestions">
                  <button
                    onClick={() =>
                      onSuggestionClick(
                        "Give me a short, clear summary of these results highlighting the most important points",
                      )
                    }
                  >
                    Summarize
                  </button>
                  <button
                    onClick={() =>
                      onSuggestionClick(
                        "What are the key insights and takeaways from these results?",
                      )
                    }
                  >
                    Key insights
                  </button>
                  <button
                    onClick={() =>
                      onSuggestionClick(
                        "What connections exist between these items? Look for page references, tags, block references, and thematic links",
                      )
                    }
                  >
                    Find connections
                  </button>
                  <button
                    onClick={() =>
                      onSuggestionClick(
                        "Help me find specific information about [topic] that might be buried in these results",
                      )
                    }
                  >
                    Retrieval
                  </button>
                  <button
                    onClick={() =>
                      onSuggestionClick(
                        "What patterns or recurring themes can you extract from these results?",
                      )
                    }
                  >
                    Extract patterns
                  </button>
                  {/* TODO: Future evolution - Deep Analysis mode
                {chatMode === "agent" && (
                  <button
                    onClick={() =>
                      onSuggestionClick(
                        "Can you find related results that might expand on these topics?"
                      )
                    }
                  >
                    <Icon icon="search" size={12} style={{marginRight: '4px'}} />Expand results
                  </button>
                )}
                */}
                </div>
              )}
              {hasSearchResults && (
                <div className="full-results-chat-feature-hint">
                  <strong>
                    {(chatAccessMode === "Balanced" ? "🛡️ " : "🔓 ") +
                      chatAccessMode}
                  </strong>{" "}
                  mode:{" "}
                  {chatAccessMode === "Balanced"
                    ? `2 children levels maximum in blocks, 4 levels in pages, and context limited to ${Math.floor(
                        (modelTokensLimit * 0.5) / 1000,
                      )}k tokens (50% of model context window, approx. ${Math.floor(
                        (modelTokensLimit * 2) / 1000 / 6,
                      )}k words)`
                    : `up to 4 children levels in blocks, full content of pages and broader context up to ${Math.floor(
                        (modelTokensLimit * 0.9) / 1000,
                      )}k tokens (90% of model context window, approx. ${Math.floor(
                        (modelTokensLimit * 3.8) / 1000 / 6,
                      )}k words)`}{" "}
                  {/* TODO: Future evolution - Deep Analysis mode
                  {chatMode === "agent" ? (
                    <>
                      💡 <strong>Deep Analysis mode</strong>: I'll analyze your
                      results first, then search for related content if needed!
                    </>
                  ) : (
                    <>
                      💡 <strong>Chat mode</strong>: I'll focus on analyzing the
                      content you've selected without additional searches.
                    </>
                  )}
                  */}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        chatMessages.map((message, index) => {
          const shouldShowCommandName =
            message.role === "user" &&
            message.commandName &&
            message.commandPrompt !== "prompt";

          // If message has no content but has a command, display just the command name
          const displayContent = shouldShowCommandName
            ? message.content
              ? `**[${message.commandName}]**\n\n${message.content}`
              : `**[${message.commandName}]**`
            : message.content;

          // Check if this is a help message
          const isHelpMsg = message.isHelpMessage;
          const isTipMessage = message.content.startsWith("💡");

          // Check if this message is being edited
          const isEditing = editingMessageIndex === index;

          return (
            <div
              key={index}
              className={`full-results-chat-message ${message.role}${isEditing ? " editing" : ""}`}
            >
              {/* Use help avatar for help messages */}
              <div
                className={
                  isHelpMsg
                    ? "full-results-chat-help-avatar"
                    : "full-results-chat-avatar"
                }
              >
                {message.role === "user" ? (
                  "👤"
                ) : isHelpMsg ? (
                  <Icon icon="help" size={18} intent="primary" />
                ) : (
                  "🤖"
                )}
              </div>
              <div className="full-results-chat-content">
                {/* Display tool usage if attached to this message */}
                {message.toolUsage && message.toolUsage.length > 0 && (
                  <div className="full-results-chat-tool-history">
                    {message.toolUsage.map((toolUsage, index) => (
                      <div
                        key={`${toolUsage.timestamp}-${index}`}
                        className="full-results-chat-tool-usage-item"
                      >
                        {/* Display intermediate message if present */}
                        {toolUsage.intermediateMessage && (
                          <div
                            className="full-results-chat-intermediate-message"
                            dangerouslySetInnerHTML={{
                              __html: renderMarkdown(
                                toolUsage.intermediateMessage,
                              ),
                            }}
                          />
                        )}
                        <div className="full-results-chat-tool-name">
                          <Icon icon="wrench" size={12} /> {toolUsage.toolName}
                        </div>
                        <div
                          className="full-results-chat-tool-details"
                          dangerouslySetInnerHTML={{
                            __html: renderMarkdown(toolUsage.details),
                          }}
                        />
                        {/* Display tool response/feedback if available */}
                        {toolUsage.response && (
                          <div
                            className="full-results-chat-tool-response"
                            dangerouslySetInnerHTML={{
                              __html: renderMarkdown(toolUsage.response),
                            }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {isEditing && message.roamBlockUid ? (
                  // Editing mode - use Roam's block editor
                  <EditableMessage
                    blockUid={message.roamBlockUid}
                    onSave={() => onSaveEdit(index)}
                    onCancel={() => onCancelEdit(index)}
                  />
                ) : isHelpMsg ? (
                  // Help message with special styling and buttons inside
                  <div className="full-results-chat-assistant-message chat-help">
                    {isTipMessage ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "8px",
                        }}
                      >
                        <Icon
                          icon="lightbulb"
                          size={16}
                          style={{ marginTop: "2px", flexShrink: 0 }}
                        />
                        <div
                          style={{ flex: 1 }}
                          dangerouslySetInnerHTML={{
                            __html: renderMarkdown(
                              displayContent.replace(/^💡\s*/, ""),
                            ),
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(displayContent),
                        }}
                      />
                    )}
                    {renderHelpButtons(message.helpType)}
                  </div>
                ) : (
                  // Regular message
                  <MessageContent
                    content={displayContent}
                    className="full-results-chat-text"
                  />
                )}
                <div className="full-results-chat-message-footer">
                  {message.role === "assistant" && !isEditing && (
                    <>
                      <span className="full-results-chat-timestamp">
                        {message.timestamp.toLocaleTimeString()}
                        {message.tokensIn !== undefined &&
                          message.tokensOut !== undefined && (
                            <span className="full-results-chat-tokens">
                              {" "}
                              • Tokens in: {message.tokensIn.toLocaleString()},
                              out: {message.tokensOut.toLocaleString()}
                            </span>
                          )}
                      </span>

                      <span className="full-results-chat-copy-link">
                        <Popover
                          content={
                            <Menu>
                              <MenuItem
                                icon="edit"
                                text="Edit message"
                                onClick={() => onEditMessage(index)}
                                disabled={
                                  isTyping || editingMessageIndex !== null
                                }
                              />
                              <MenuItem
                                icon="clipboard"
                                text="Copy to clipboard"
                                onClick={() => onCopyMessage(message.content)}
                              />
                              <MenuItem
                                icon="refresh"
                                text="Retry"
                                onClick={() => onRetryMessage(index)}
                              />
                              <MenuItem
                                icon="volume-up"
                                text="Text to Speech (via OpenAI)"
                                title="Esc or click again to stop"
                                onClick={async () => {
                                  await textToSpeech(
                                    message.content,
                                    undefined,
                                  );
                                }}
                              />
                              <MenuItem
                                icon="trash"
                                text="Delete chat turn"
                                intent="danger"
                                onClick={() => onDeleteMessage(index)}
                              />
                            </Menu>
                          }
                          position={Position.BOTTOM_RIGHT}
                        >
                          <Button icon="more" minimal small />
                        </Popover>
                      </span>
                    </>
                  )}
                  {message.role === "user" && !isEditing && !isHelpMsg && (
                    <span className="full-results-chat-user-actions">
                      <Popover
                        content={
                          <Menu>
                            <MenuItem
                              icon="edit"
                              text="Edit message"
                              onClick={() => onEditMessage(index)}
                              disabled={
                                isTyping || editingMessageIndex !== null
                              }
                            />
                            <MenuItem
                              icon="clipboard"
                              text="Copy to clipboard"
                              onClick={() => onCopyMessage(message.content)}
                            />
                          </Menu>
                        }
                        position={Position.BOTTOM_RIGHT}
                      >
                        <Button icon="more" minimal small />
                      </Popover>
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}

      {(isTyping || isStreaming || toolUsageHistory.length > 0) && (
        <div className="full-results-chat-message assistant">
          <div className="full-results-chat-avatar">🤖</div>
          <div className="full-results-chat-content">
            {/* Display tool usage history (stacked) */}
            {toolUsageHistory.length > 0 && (
              <div className="full-results-chat-tool-history">
                {toolUsageHistory.map((toolUsage, index) => (
                  <div
                    key={`${toolUsage.timestamp}-${index}`}
                    className="full-results-chat-tool-usage-item"
                  >
                    {/* Display intermediate message if present */}
                    {toolUsage.intermediateMessage && (
                      <div
                        className="full-results-chat-intermediate-message"
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(toolUsage.intermediateMessage),
                        }}
                      />
                    )}
                    <div className="full-results-chat-tool-name">
                      <Icon icon="wrench" size={12} /> {toolUsage.toolName}
                    </div>
                    <div
                      className="full-results-chat-tool-details"
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(toolUsage.details),
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Display streaming content or typing indicator */}
            {isStreaming && streamingContent ? (
              <MessageContent
                content={streamingContent}
                className="full-results-chat-text streaming"
              />
            ) : (isTyping || isStreaming) && toolUsageHistory.length === 0 ? (
              <div className="full-results-chat-typing">Thinking...</div>
            ) : null}

            {/* Tool confirmation UI */}
            {pendingToolConfirmation && (
              <div className="full-results-chat-tool-confirmation">
                <div className="tool-confirmation-header">
                  <Icon icon="warning-sign" size={14} intent="warning" />
                  <span>
                    Confirm{" "}
                    {(() => {
                      const opCount =
                        pendingToolConfirmation.args?.operation_count;
                      const label =
                        {
                          create_block: "block insertion",
                          create_page: "page creation",
                          update_block: "block update",
                          delete_block: "block deletion",
                        }[pendingToolConfirmation.toolName] || "operation";
                      return opCount > 1
                        ? `batch ${label} (${opCount} blocks)`
                        : label;
                    })()}
                    ?
                  </span>
                </div>

                {/* Preview for update_block */}
                {pendingToolConfirmation.toolName === "update_block" &&
                  pendingToolConfirmation.args?.operations && (
                    <div className="tool-confirmation-preview">
                      {pendingToolConfirmation.args.operations.map(
                        (op: any, i: number) => (
                          <div key={i} className="tool-confirmation-diff-item">
                            <div className="tool-confirmation-diff-block-header">
                              Block (({op.block_uid}))
                              {op.current_content && (
                                <span className="tool-confirmation-diff-context">
                                  : {op.current_content.substring(0, 60)}
                                  {op.current_content.length > 60 ? "..." : ""}
                                </span>
                              )}
                            </div>
                            {op.new_content !== undefined && (
                              <div className="tool-confirmation-diff-row">
                                <span className="tool-confirmation-diff-label">
                                  Content:
                                </span>
                                <ExpandableContent
                                  content={op.current_content || "(empty)"}
                                  className="tool-confirmation-diff-old"
                                />
                                <span className="tool-confirmation-diff-arrow">
                                  &rarr;
                                </span>
                                <ExpandableContent
                                  content={op.new_content}
                                  className="tool-confirmation-diff-new"
                                />
                              </div>
                            )}
                            {op.new_heading !== undefined && (
                              <div className="tool-confirmation-diff-row">
                                <span className="tool-confirmation-diff-label">
                                  Heading:
                                </span>
                                <span className="tool-confirmation-diff-old">
                                  {op.current_heading === 0
                                    ? "none"
                                    : `H${op.current_heading}`}
                                </span>
                                <span className="tool-confirmation-diff-arrow">
                                  &rarr;
                                </span>
                                <span className="tool-confirmation-diff-new">
                                  {op.new_heading === 0
                                    ? "none"
                                    : `H${op.new_heading}`}
                                </span>
                              </div>
                            )}
                            {op.new_open !== undefined && (
                              <div className="tool-confirmation-diff-row">
                                <span className="tool-confirmation-diff-label">
                                  State:
                                </span>
                                <span className="tool-confirmation-diff-old">
                                  {op.current_open ? "expanded" : "collapsed"}
                                </span>
                                <span className="tool-confirmation-diff-arrow">
                                  &rarr;
                                </span>
                                <span className="tool-confirmation-diff-new">
                                  {op.new_open ? "expanded" : "collapsed"}
                                </span>
                              </div>
                            )}
                            {op.move_to && (
                              <div className="tool-confirmation-diff-row">
                                <span className="tool-confirmation-diff-label">
                                  Position:
                                </span>
                                <span className="tool-confirmation-diff-old">
                                  {op.move_from || "current"}
                                </span>
                                <span className="tool-confirmation-diff-arrow">
                                  &rarr;
                                </span>
                                <span className="tool-confirmation-diff-new">
                                  {op.move_to}
                                </span>
                              </div>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  )}

                {/* Preview for delete_block */}
                {pendingToolConfirmation.toolName === "delete_block" &&
                  pendingToolConfirmation.args?.blocks && (
                    <div className="tool-confirmation-preview">
                      {pendingToolConfirmation.args.blocks.map(
                        (block: any, i: number) => (
                          <div
                            key={i}
                            className="tool-confirmation-diff-item tool-confirmation-diff-delete"
                          >
                            <div className="tool-confirmation-diff-block-header">
                              Block (({block.block_uid})):
                              <ExpandableContent
                                content={block.content || "(empty)"}
                                className="tool-confirmation-diff-context"
                              />
                            </div>
                            {block.descendant_count > 0 && (
                              <div className="tool-confirmation-diff-row tool-confirmation-diff-warning">
                                + {block.descendant_count} descendant block(s)
                                will also be deleted
                              </div>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  )}

                {/* Preview for create_block */}
                {(pendingToolConfirmation.toolName === "create_block" ||
                  pendingToolConfirmation.toolName === "create_page") &&
                  pendingToolConfirmation.args?.markdown_content && (
                    <div className="tool-confirmation-preview">
                      {/* Parent and insertion context with integrated marker */}
                      {pendingToolConfirmation.args.outline_preview && (
                        <div className="tool-confirmation-insertion-context">
                          <div className="tool-confirmation-section-label">
                            Insertion location:
                          </div>
                          <pre
                            className="tool-confirmation-outline-preview"
                            dangerouslySetInnerHTML={{
                              __html:
                                pendingToolConfirmation.args.outline_preview.replace(
                                  /{{MARKER}}(.*?){{\/MARKER}}/g,
                                  '<span style="color: #28a745; font-weight: 600;">$1</span>',
                                ),
                            }}
                          />
                        </div>
                      )}

                      {/* Content to insert */}
                      {/* <div className="tool-confirmation-content-to-insert">
                        <div className="tool-confirmation-section-label">Content to insert:</div>
                        <ExpandableContent
                          content={pendingToolConfirmation.args.markdown_content}
                          className="tool-confirmation-diff-new"
                        />
                      </div> */}
                    </div>
                  )}

                <div className="tool-confirmation-buttons">
                  <Button
                    intent="success"
                    icon="tick"
                    small
                    onClick={() => onToolConfirmationResponse(true, false)}
                  >
                    Accept
                  </Button>
                  <Button
                    intent="primary"
                    icon="tick-circle"
                    small
                    onClick={() => onToolConfirmationResponse(true, true)}
                  >
                    Always in this chat
                  </Button>
                  <Button
                    intent="danger"
                    icon="cross"
                    small
                    onClick={() =>
                      onToolConfirmationResponse(
                        false,
                        false,
                        declineReasonInput,
                      )
                    }
                  >
                    Decline
                  </Button>
                </div>
                <div className="tool-confirmation-feedback">
                  <input
                    type="text"
                    placeholder="Optional: explain why you're declining..."
                    value={declineReasonInput}
                    onChange={(e) => setDeclineReasonInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onToolConfirmationResponse(
                          false,
                          false,
                          declineReasonInput,
                        );
                      }
                    }}
                    className="tool-confirmation-input"
                  />
                </div>
              </div>
            )}

            {/* User choice form UI */}
            {pendingUserChoice && (
              <UserChoiceForm
                pendingChoice={pendingUserChoice}
                onSubmit={onUserChoiceResponse}
                onCancel={onUserChoiceCancelled}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
