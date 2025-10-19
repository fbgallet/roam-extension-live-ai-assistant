/**
 * Chat Storage Utilities for LiveAI Chat History
 *
 * Provides functions to find and manage chat conversations stored in Roam
 * blocks with [[liveai/chat]] page references.
 */

import {
  getBlocksMentioningTitle,
  getBlockContentByUid,
} from "../../../utils/roamAPI.js";
import { chatRoles } from "../../..";

export interface ChatHistoryItem {
  uid: string;
  title: string;
  timestamp?: Date;
}

/**
 * Get all blocks that mention [[liveai/chat]]
 * @returns Array of chat blocks with uid and title (block content without the tag)
 */
export const getAllLiveAIChats = (): ChatHistoryItem[] => {
  // Try both "liveai/chat" and "liveai chat" page titles
  const chatsWithSlash = getBlocksMentioningTitle("liveai/chat") || [];
  const chatsWithSpace = getBlocksMentioningTitle("liveai chat") || [];

  // Combine and deduplicate by uid
  const allChats = [...chatsWithSlash, ...chatsWithSpace];
  const uniqueChats = Array.from(
    new Map(allChats.map((chat) => [chat.uid, chat])).values()
  );

  // Format each chat item
  return uniqueChats
    .map((chat) => {
      let title = chat.content || "Untitled Chat";

      // Remove [[liveai/chat]] or #liveai/chat from the title
      title = title
        .replace(/\[\[liveai\/chat\]\]/gi, "")
        .replace(/\[\[liveai chat\]\]/gi, "")
        .replace(/#liveai\/chat/gi, "")
        .replace(/#liveai-chat/gi, "")
        .trim();

      // If chatRoles.genericAssistantRegex exists, split by assistant role and keep the right part
      if (chatRoles?.genericAssistantRegex && chatRoles.genericAssistantRegex.test(title)) {
        // Split by the assistant role pattern
        const parts = title.split(chatRoles.genericAssistantRegex);
        if (parts.length > 1) {
          // Take the part after the assistant role prefix
          title = parts[parts.length - 1].trim();
        }
      } else if (chatRoles?.assistant) {
        // Fallback: simple split by assistant role string
        const parts = title.split(chatRoles.assistant);
        if (parts.length > 1) {
          title = parts[parts.length - 1].trim();
        }
      }

      // If title is empty after processing, use a default
      if (!title) {
        title = "Untitled Chat";
      }

      return {
        uid: chat.uid,
        title,
      };
    })
    .sort((a, b) => {
      // Sort alphabetically by title for now
      // TODO: Could add timestamp-based sorting if needed
      return a.title.localeCompare(b.title);
    });
};
