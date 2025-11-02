import React from "react";
import { Button, Dialog, Classes } from "@blueprintjs/core";
import { ChatMessage } from "../../types/types";
import { countRealMessages } from "../../utils/chatMessageUtils";

interface ClearChatDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onClearChat: () => void;
  chatMessages: ChatMessage[];
  insertedMessages: number;
}

export const ClearChatDialog: React.FC<ClearChatDialogProps> = ({
  isOpen,
  onClose,
  onClearChat,
  chatMessages,
  insertedMessages,
}) => {
  // Only count real messages (exclude help messages like tips and help docs)
  const totalMessages = countRealMessages(chatMessages);
  const uninsertedMessages = totalMessages - insertedMessages;
  const hasUninsertedMessages = uninsertedMessages > 0;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Clear Chat Conversation?"
      className="clear-chat-dialog"
    >
      <div className={Classes.DIALOG_BODY}>
        {hasUninsertedMessages ? (
          <>
            <p style={{ color: "#d9822b", fontWeight: "bold" }}>
              ⚠️ Warning: You have {uninsertedMessages} message
              {uninsertedMessages !== 1 ? "s" : ""} that {uninsertedMessages !== 1 ? "have" : "has"} not been inserted into Roam!
            </p>
            <p>
              Messages are only temporary unless they are:
            </p>
            <ul>
              <li>Inserted into Roam (using the insert button)</li>
              <li>Copied to clipboard and saved elsewhere</li>
            </ul>
            <p>
              <strong>
                Clearing the chat will permanently delete {uninsertedMessages} unsaved message
                {uninsertedMessages !== 1 ? "s" : ""}.
              </strong>
            </p>
          </>
        ) : (
          <p>
            Are you sure you want to clear this chat conversation?
          </p>
        )}
        <p style={{ marginTop: "12px", fontSize: "0.9em", color: "#5c7080" }}>
          Total messages: {totalMessages} | Inserted in Roam: {insertedMessages}
        </p>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            intent={hasUninsertedMessages ? "danger" : "warning"}
            onClick={() => {
              onClearChat();
              onClose();
            }}
          >
            Clear Chat
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
