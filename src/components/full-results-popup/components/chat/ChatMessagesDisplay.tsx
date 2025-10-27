/**
 * Chat Messages Display Component
 *
 * Renders the chat message list including welcome state, message history, and streaming indicator
 */

import React from "react";
import { Button, Tooltip, Icon } from "@blueprintjs/core";
import { ChatMessage, ChatMode } from "../../types/types";
import { renderMarkdown } from "../../utils/chatMessageUtils";
import {
  CHAT_HELP_RESPONSE,
  LIVE_AI_HELP_RESPONSE,
  getRandomTip,
} from "./chatHelpConstants";

interface ChatMessagesDisplayProps {
  chatMessages: ChatMessage[];
  isTyping: boolean;
  isStreaming: boolean;
  streamingContent: string;
  toolUsageHistory: Array<{
    toolName: string;
    details: string;
    timestamp: number;
  }>;
  modelTokensLimit: number;
  chatAccessMode: "Balanced" | "Full Access";
  chatMode: ChatMode;
  hasSearchResults: boolean;
  onCopyMessage: (content: string) => void;
  onSuggestionClick: (suggestion: string) => void;
  onHelpButtonClick: (
    type: "chat" | "liveai" | "tip" | "helpabout",
    promptOrContent: string
  ) => void;
  messagesContainerRef: React.RefObject<HTMLDivElement>;
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
  onSuggestionClick,
  onHelpButtonClick,
  messagesContainerRef,
}) => {
  // Memoize the initial random tip so it doesn't change on every render
  const [initialTip] = React.useState(() => getRandomTip());

  // Function to render help buttons based on help type
  const renderHelpButtons = (helpType?: "chat" | "liveai" | "tip") => {
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
                  "Help me about By using the help tool, help me understand and use the following feature in a simple and guided way:"
                )
              }
              disabled={isTyping}
            >
              <Icon icon="help" size={12} style={{ marginRight: "4px" }} />
              Help about...
            </button>
          )}
          <button
            onClick={() => onHelpButtonClick("tip", getRandomTip())}
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
                        "Give me a short, clear summary of these results highlighting the most important points"
                      )
                    }
                  >
                    Summarize
                  </button>
                  <button
                    onClick={() =>
                      onSuggestionClick(
                        "What are the key insights and takeaways from these results?"
                      )
                    }
                  >
                    Key insights
                  </button>
                  <button
                    onClick={() =>
                      onSuggestionClick(
                        "What connections exist between these items? Look for page references, tags, block references, and thematic links"
                      )
                    }
                  >
                    Find connections
                  </button>
                  <button
                    onClick={() =>
                      onSuggestionClick(
                        "Help me find specific information about [topic] that might be buried in these results"
                      )
                    }
                  >
                    Retrieval
                  </button>
                  <button
                    onClick={() =>
                      onSuggestionClick(
                        "What patterns or recurring themes can you extract from these results?"
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
                        (modelTokensLimit * 0.5) / 1000
                      )}k tokens (50% of model context window, approx. ${Math.floor(
                        (modelTokensLimit * 2) / 1000 / 6
                      )}k words)`
                    : `up to 4 children levels in blocks, full content of pages and broader context up to ${Math.floor(
                        (modelTokensLimit * 0.75) / 1000
                      )}k tokens (75% of model context window, approx. ${Math.floor(
                        (modelTokensLimit * 3) / 1000 / 6
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

          return (
            <div
              key={index}
              className={`full-results-chat-message ${message.role}`}
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
                {isHelpMsg ? (
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
                              displayContent.replace(/^💡\s*/, "")
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
                  <div
                    className="full-results-chat-text"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(displayContent),
                    }}
                  />
                )}
                <div className="full-results-chat-message-footer">
                  {message.role === "assistant" && (
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

                      <span
                        className="full-results-chat-copy-link"
                        title="Copy message to clipboard"
                      >
                        <Tooltip content="Copy message to clipboard">
                          <Button
                            icon="clipboard"
                            onClick={() => onCopyMessage(message.content)}
                            minimal
                            small
                          />
                        </Tooltip>
                      </span>
                    </>
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
                    <div className="full-results-chat-tool-name">
                      🛠️ {toolUsage.toolName}
                    </div>
                    <div className="full-results-chat-tool-details">
                      {toolUsage.details}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Display streaming content or typing indicator */}
            {isStreaming && streamingContent ? (
              <div
                className="full-results-chat-text streaming"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(streamingContent),
                }}
              />
            ) : (isTyping || isStreaming) && toolUsageHistory.length === 0 ? (
              <div className="full-results-chat-typing">Thinking...</div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
