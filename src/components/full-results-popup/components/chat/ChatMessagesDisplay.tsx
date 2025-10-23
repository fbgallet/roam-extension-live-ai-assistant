/**
 * Chat Messages Display Component
 *
 * Renders the chat message list including welcome state, message history, and streaming indicator
 */

import React from "react";
import { Button, Tooltip } from "@blueprintjs/core";
import { ChatMessage } from "../../types/types";
import { renderMarkdown } from "../../utils/chatMessageUtils";

interface ChatMessagesDisplayProps {
  chatMessages: ChatMessage[];
  isTyping: boolean;
  isStreaming: boolean;
  streamingContent: string;
  currentToolUsage: string | null;
  modelTokensLimit: number;
  chatAccessMode: "Balanced" | "Full Access";
  hasSearchResults: boolean;
  onCopyMessage: (content: string) => void;
  onSuggestionClick: (suggestion: string) => void;
  messagesContainerRef: React.RefObject<HTMLDivElement>;
}

export const ChatMessagesDisplay: React.FC<ChatMessagesDisplayProps> = ({
  chatMessages,
  isTyping,
  isStreaming,
  streamingContent,
  currentToolUsage,
  modelTokensLimit,
  chatAccessMode,
  hasSearchResults,
  onCopyMessage,
  onSuggestionClick,
  messagesContainerRef,
}) => {
  return (
    <div className="full-results-chat-messages" ref={messagesContainerRef}>
      {chatMessages.length === 0 ? (
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

          return (
            <div
              key={index}
              className={`full-results-chat-message ${message.role}`}
            >
              <div className="full-results-chat-avatar">
                {message.role === "user" ? "👤" : "🤖"}
              </div>
              <div className="full-results-chat-content">
                <div
                  className="full-results-chat-text"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(displayContent),
                  }}
                />
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

      {(isTyping || isStreaming) && (
        <div className="full-results-chat-message assistant">
          <div className="full-results-chat-avatar">🤖</div>
          <div className="full-results-chat-content">
            {isStreaming && streamingContent ? (
              <div
                className="full-results-chat-text streaming"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(streamingContent),
                }}
              />
            ) : currentToolUsage ? (
              <div className="full-results-chat-typing">
                Using tool: {currentToolUsage}...
              </div>
            ) : (
              <div className="full-results-chat-typing">Thinking...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
