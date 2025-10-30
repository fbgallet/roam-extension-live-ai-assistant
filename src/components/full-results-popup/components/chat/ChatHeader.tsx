/**
 * Chat Header Component
 *
 * Renders the chat header with info badge, action buttons, loaded chat title, and warnings
 */

import React from "react";
import { Button, Icon, Tooltip } from "@blueprintjs/core";
import { Result, ChatMessage } from "../../types/types";
import { ChatHistorySelect } from "./ChatHistorySelect";

interface ChatHeaderProps {
  selectedResults: Result[];
  allResults: Result[];
  totalIn: number;
  totalOut: number;
  hasExpandedResults: boolean;
  chatMessages: ChatMessage[];
  loadedChatTitle: string | null;
  loadedChatUid: string | null;
  privateMode: boolean;
  isTyping: boolean;
  onInsertConversation: () => void;
  onCopyFullConversation: () => void;
  onResetChat: () => void;
  onLoadChatHistory: (uid: string) => void;
  onLoadedChatClick: (e: React.MouseEvent) => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  selectedResults,
  allResults,
  totalIn,
  totalOut,
  hasExpandedResults,
  chatMessages,
  loadedChatTitle,
  loadedChatUid,
  privateMode,
  isTyping,
  onInsertConversation,
  onCopyFullConversation,
  onResetChat,
  onLoadChatHistory,
  onLoadedChatClick,
}) => {
  return (
    <div className="full-results-chat-header">
      <div className="full-results-chat-info">
        <div className="full-results-chat-info-text">
          <span>
            {selectedResults.length > 0 ? (
              <>Chatting about {selectedResults.length} selected results</>
            ) : allResults.length > 0 ? (
              <>Chatting about {allResults.length} visible results</>
            ) : (
              <>No context loaded</>
            )}
            {(totalIn > 0 || totalOut > 0) && (
              <span className="full-results-chat-total-tokens">
                {" "}
                • Total tokens: {totalIn.toLocaleString()} in,{" "}
                {totalOut.toLocaleString()} out
              </span>
            )}
          </span>
        </div>
        <div className="full-results-chat-header-controls">
          {hasExpandedResults && (
            <Tooltip content="Results expanded during conversation">
              <span className="full-results-chat-expansion-badge">
                <Icon icon="trending-up" size={12} />
              </span>
            </Tooltip>
          )}
          {chatMessages.length > 0 && (
            <>
              {
                <Tooltip
                  openOnTargetFocus={false}
                  content="Insert conversation in Roam at focused block or append to current page/daily note"
                >
                  <Button
                    icon="insert"
                    onClick={onInsertConversation}
                    minimal
                    small
                    intent="success"
                  />
                </Tooltip>
              }
              <Tooltip
                openOnTargetFocus={false}
                content="Copy full conversation to clipboard"
              >
                <Button
                  icon="clipboard"
                  onClick={onCopyFullConversation}
                  minimal
                  small
                />
              </Tooltip>
              <Tooltip content="Reset chat conversation">
                <Button icon="trash" onClick={onResetChat} minimal small />
              </Tooltip>
            </>
          )}
          <Tooltip
            openOnTargetFocus={false}
            content="Load chat history from #liveai/chat blocks"
          >
            <ChatHistorySelect
              onChatSelect={onLoadChatHistory}
              disabled={isTyping}
            />
          </Tooltip>
        </div>
      </div>
      {loadedChatTitle && loadedChatUid && (
        <div className="full-results-chat-loaded-title">
          <Tooltip
            content={
              <p>
                • Click: Copy ((reference)) to clipboard
                <br />• Alt+click: Open in main window
                <br />• Shift+click: Open in sidebar
              </p>
            }
          >
            <a
              href="#"
              onClick={onLoadedChatClick}
              className="roam-block-ref-chat"
              style={{
                fontSize: "0.9em",
                color: "#5c7080",
                textDecoration: "none",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                paddingTop: "4px",
              }}
            >
              <Icon icon="history" size={12} />
              {loadedChatTitle} (Source block <Icon icon="flow-end" size={10} />
              )
            </a>
          </Tooltip>
        </div>
      )}
      {privateMode && (
        <div className="full-results-chat-warning">
          🔒 Limited functionality in Private mode
        </div>
      )}
    </div>
  );
};
