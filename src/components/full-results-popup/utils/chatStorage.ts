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
 * Extract and clean a chat title from a block UID
 * Removes [[liveai/chat]] tags and keeps only the assistant's response part
 * @param uid - The block UID
 * @param maxLength - Maximum length for the title (default 50)
 * @returns Cleaned title string
 */
export const getChatTitleFromUid = (uid: string, maxLength: number = 50): string => {
  if (!uid) return "Untitled Chat";

  let title = getBlockContentByUid(uid) || "Untitled Chat";

  // Remove [[liveai/chat]] tags and variations
  title = title
    .replace(/\[\[liveai\/chat\]\]/gi, "")
    .replace(/\[\[liveai chat\]\]/gi, "")
    .replace(/#liveai\/chat/gi, "")
    .replace(/#liveai-chat/gi, "")
    .trim();

  // If chatRoles.genericAssistantRegex exists, split by assistant role and keep the right part
  if (chatRoles?.genericAssistantRegex && chatRoles.genericAssistantRegex.test(title)) {
    const parts = title.split(chatRoles.genericAssistantRegex);
    if (parts.length > 1) {
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

  // Truncate if too long
  if (title.length > maxLength) {
    title = title.substring(0, maxLength - 3) + "...";
  }

  return title;
};

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

  // Format each chat item using the reusable helper
  return uniqueChats
    .map((chat) => ({
      uid: chat.uid,
      title: getChatTitleFromUid(chat.uid, 50), // Max 50 chars for menu display
    }))
    .sort((a, b) => {
      // Sort alphabetically by title for now
      // TODO: Could add timestamp-based sorting if needed
      return a.title.localeCompare(b.title);
    });
};
