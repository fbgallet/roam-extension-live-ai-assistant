/**
 * Chat Header Component
 *
 * Renders the chat header with info badge, action buttons, loaded chat title, and warnings
 */

import React from "react";
import { Button, Icon, Tooltip } from "@blueprintjs/core";
import { Result, ChatMessage } from "../../types/types";
import { ChatHistorySelect } from "./ChatHistorySelect";
import { ClearChatDialog } from "../dialogs/ClearChatDialog";
import { hasRealMessages } from "../../utils/chatMessageUtils";

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
  insertedMessagesCount: number;
  contextTokenEstimate: number;
  willContextBeTruncated: boolean;
  modelTokensLimit: number;
  chatAccessMode: "Balanced" | "Full Access";
  isExpandingForEstimate: boolean;
  isContextExpanded: boolean;
  hasCalculatedTokens: boolean;
  selectionChangedSinceCalculation: boolean;
  onExpandForEstimate: () => void;
  onInsertConversation: () => void;
  onCopyFullConversation: () => void;
  onResetChat: () => void;
  onLoadChatHistory: (uid: string) => void;
  onLoadedChatClick: (e: React.MouseEvent) => void;
  isClearDialogOpen: boolean;
  onSetClearDialogOpen: (open: boolean) => void;
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
  insertedMessagesCount,
  contextTokenEstimate,
  willContextBeTruncated,
  modelTokensLimit,
  chatAccessMode,
  isExpandingForEstimate,
  isContextExpanded,
  hasCalculatedTokens,
  selectionChangedSinceCalculation,
  onExpandForEstimate,
  onInsertConversation,
  onCopyFullConversation,
  onResetChat,
  onLoadChatHistory,
  onLoadedChatClick,
  isClearDialogOpen,
  onSetClearDialogOpen,
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
            )}{" "}
            {(selectedResults.length > 0 || allResults.length > 0) && (
              <Tooltip
                content={
                  !hasCalculatedTokens
                    ? isContextExpanded
                      ? "Click to calculate token count from expanded context (includes full page content)"
                      : "Click to expand context and calculate accurate token count (includes full page content)"
                    : selectionChangedSinceCalculation
                    ? "Selection changed - click to recalculate token count"
                    : willContextBeTruncated
                    ? `Full expanded context: ${contextTokenEstimate.toLocaleString()} tokens. Will be truncated to fit ${
                        chatAccessMode === "Full Access" ? "~90%" : "~50%"
                      } of ${modelTokensLimit.toLocaleString()} token context window.`
                    : `Accurate token count from expanded context (within ${modelTokensLimit.toLocaleString()} token limit). Click to recalculate.`
                }
                openOnTargetFocus={false}
              >
                <span
                  className="full-results-chat-context-tokens"
                  onClick={onExpandForEstimate}
                  style={{
                    cursor: "pointer",
                    textDecoration: "underline dotted",
                    color:
                      willContextBeTruncated && hasCalculatedTokens
                        ? "#d13913"
                        : undefined, // Red when truncation will occur
                    fontWeight:
                      willContextBeTruncated && hasCalculatedTokens
                        ? "600"
                        : undefined,
                  }}
                >
                  {isExpandingForEstimate ? (
                    <>(expanding...)</>
                  ) : !hasCalculatedTokens ? (
                    <>Click for token estimation ⟲</>
                  ) : (
                    <>
                      (~{contextTokenEstimate.toLocaleString()} tokens
                      {selectionChangedSinceCalculation && " ⟲"}
                      {!selectionChangedSinceCalculation &&
                        willContextBeTruncated &&
                        " ⚠️"}
                      )
                    </>
                  )}
                </span>
              </Tooltip>
            )}
            {(totalIn > 0 || totalOut > 0) && (
              <span className="full-results-chat-total-tokens">
                {" "}
                • Total: {totalIn.toLocaleString()} in,{" "}
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
          {hasRealMessages(chatMessages) && (
            <>
              {
                <Tooltip
                  openOnTargetFocus={false}
                  content={
                    insertedMessagesCount >= chatMessages.length
                      ? "All messages already inserted in Roam"
                      : "Insert conversation in Roam at focused block or append to current page/daily note"
                  }
                >
                  <Button
                    icon="insert"
                    onClick={onInsertConversation}
                    minimal
                    small
                    intent={
                      insertedMessagesCount >= chatMessages.length
                        ? undefined
                        : "success"
                    }
                    disabled={insertedMessagesCount >= chatMessages.length}
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
            </>
          )}
          {chatMessages.length > 0 && (
            <Tooltip content="Reset chat conversation">
              <Button
                icon="trash"
                onClick={() => {
                  // If only help messages, clear directly without confirmation
                  if (!hasRealMessages(chatMessages)) {
                    onResetChat();
                  } else {
                    onSetClearDialogOpen(true);
                  }
                }}
                minimal
                small
              />
            </Tooltip>
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
      <ClearChatDialog
        isOpen={isClearDialogOpen}
        onClose={() => onSetClearDialogOpen(false)}
        onClearChat={onResetChat}
        chatMessages={chatMessages}
        insertedMessages={insertedMessagesCount}
      />
    </div>
  );
};
