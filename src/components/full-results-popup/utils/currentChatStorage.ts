/**
 * Current Chat Storage
 *
 * Persists the *current* chat conversation to localStorage so it survives a
 * browser refresh (the in-memory `window.lastChat*` persistence is wiped on
 * reload). A SINGLE localStorage key is used and updated via merge-patch, so we
 * only ever keep one conversation around — no accumulation of past chats.
 *
 * The entry is cleared on demand (new chat / clear conversation) or whenever the
 * conversation no longer has any real messages.
 */

import { ChatMessage } from "../types/types";

const STORAGE_KEY = "liveai-current-chat";

export interface CurrentChatSnapshot {
  messages: ChatMessage[];
  agentData?: any;
  accessMode?: "Balanced" | "Full Access";
  noTruncation?: boolean;
  loadedChatUid?: string | null;
  loadedChatTitle?: string | null;
  insertedMessagesCount?: number;
  selectedModel?: string;
  savedAt?: number;
}

// JSON serialization turns `timestamp` Date objects into strings; rehydrate them
// so consumers (e.g. `message.timestamp.toLocaleTimeString()`) keep working.
const reviveMessages = (messages: any[]): ChatMessage[] =>
  (Array.isArray(messages) ? messages : []).map((m) => ({
    ...m,
    timestamp: m?.timestamp ? new Date(m.timestamp) : new Date(),
  }));

/**
 * Load the persisted current chat, or null if there's nothing meaningful stored.
 */
export const loadCurrentChat = (): CurrentChatSnapshot | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      !Array.isArray(parsed.messages) ||
      parsed.messages.length === 0
    ) {
      return null;
    }
    return { ...parsed, messages: reviveMessages(parsed.messages) };
  } catch (error) {
    console.warn("[currentChatStorage] Failed to load current chat:", error);
    return null;
  }
};

// Compare two epoch-ms timestamps by local calendar day.
const isSameCalendarDay = (ms: number, now: Date): boolean => {
  const d = new Date(ms);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
};

/**
 * Snapshot to AUTO-restore on open: only when it was last saved on the same
 * calendar day. Older conversations are not auto-loaded (so the landing screen
 * still shows); they remain available for on-demand restore via loadCurrentChat.
 */
export const loadAutoRestoreChat = (): CurrentChatSnapshot | null => {
  const stored = loadCurrentChat();
  if (!stored || !stored.savedAt) return null;
  return isSameCalendarDay(stored.savedAt, new Date()) ? stored : null;
};

export interface StoredChatInfo {
  savedAt: number;
  isFromToday: boolean;
  messageCount: number;
  title?: string;
}

/**
 * Lightweight info about the stored conversation, for the "restore previous
 * conversation" prompt on the landing screen. Null if nothing is stored.
 */
export const getStoredChatInfo = (): StoredChatInfo | null => {
  const stored = loadCurrentChat();
  if (!stored) return null;
  const savedAt = stored.savedAt || 0;
  return {
    savedAt,
    isFromToday: savedAt ? isSameCalendarDay(savedAt, new Date()) : false,
    messageCount: stored.messages.length,
    title: stored.loadedChatTitle || undefined,
  };
};

/**
 * Merge-patch the single stored conversation. Different callers contribute
 * different slices (messages vs. loaded-chat metadata) into the same entry, so
 * we read-merge-write rather than overwrite.
 */
export const saveCurrentChat = (patch: Partial<CurrentChatSnapshot>): void => {
  try {
    let existing: Record<string, any> = {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        existing = JSON.parse(raw) || {};
      } catch {
        existing = {};
      }
    }
    const merged = { ...existing, ...patch, savedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch (error) {
    // Most likely a quota error (e.g. large multimodal conversation). Degrade
    // gracefully — losing persistence is better than breaking the chat.
    console.warn("[currentChatStorage] Failed to save current chat:", error);
  }
};

/**
 * Remove the persisted current chat (new chat / clear conversation).
 */
export const clearCurrentChat = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("[currentChatStorage] Failed to clear current chat:", error);
  }
};
