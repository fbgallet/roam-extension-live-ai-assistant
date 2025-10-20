/**
 * ChatHistorySelect Component
 *
 * A simple select component for loading saved chat conversations
 * from blocks with [[liveai/chat]] page references.
 */

import React, { useState, useEffect } from "react";
import { Button, MenuItem } from "@blueprintjs/core";
import { Select, ItemRenderer } from "@blueprintjs/select";
import { getAllLiveAIChats, ChatHistoryItem } from "./utils/chatStorage";

const ChatSelect = Select.ofType<ChatHistoryItem>();

interface ChatHistorySelectProps {
  onChatSelect: (chatUid: string) => void;
  disabled?: boolean;
}

export const ChatHistorySelect: React.FC<ChatHistorySelectProps> = ({
  onChatSelect,
  disabled = false,
}) => {
  const [chatHistories, setChatHistories] = useState<ChatHistoryItem[]>([]);

  // Load chat histories on mount and when button is clicked
  const loadChatHistories = () => {
    const chats = getAllLiveAIChats();
    setChatHistories(chats);
  };

  useEffect(() => {
    loadChatHistories();
  }, []);

  // Item renderer for chat history items
  const renderChatItem: ItemRenderer<ChatHistoryItem> = (
    chat,
    { handleClick, modifiers }
  ) => {
    if (!modifiers.matchesPredicate) {
      return null;
    }

    return (
      <MenuItem
        key={chat.uid}
        text={chat.title}
        onClick={handleClick}
        active={modifiers.active}
      />
    );
  };

  // Filter predicate for search
  const filterPredicate = (query: string, chat: ChatHistoryItem) => {
    return chat.title.toLowerCase().includes(query.toLowerCase());
  };

  // Handle chat selection
  const handleChatSelect = (chat: ChatHistoryItem) => {
    onChatSelect(chat.uid);
  };

  return (
    <ChatSelect
      items={chatHistories}
      itemRenderer={renderChatItem}
      itemPredicate={filterPredicate}
      onItemSelect={handleChatSelect}
      disabled={disabled || chatHistories.length === 0}
      filterable={true}
      resetOnClose={true}
      resetOnSelect={true}
      inputProps={{
        placeholder: "Search chat histories...",
      }}
      popoverProps={{
        minimal: true,
        onOpening: loadChatHistories, // Refresh list when opening
      }}
      noResults={<MenuItem disabled={true} text="No chat histories found" />}
    >
      <Button
        icon="upload"
        minimal
        small
        disabled={disabled || chatHistories.length === 0}
        title={
          chatHistories.length === 0
            ? "No chat histories found"
            : `Load chat history (${chatHistories.length} available)`
        }
      />
    </ChatSelect>
  );
};
