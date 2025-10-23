export interface Result {
  uid?: string;
  content?: string;
  text?: string;
  pageTitle?: string;
  pageUid?: string;
  isDaily?: boolean;
  modified?: Date | string;
  created?: Date | string;
  count?: number;
  [key: string]: any;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  tokensIn?: number;
  tokensOut?: number;
  commandName?: string;
  commandPrompt?: string;
}

export interface FullResultsPopupProps {
  results: Result[];
  isOpen: boolean;
  title?: string;
  targetUid?: string;
  // Privacy mode props for chat functionality
  privateMode?: boolean;
  permissions?: { contentAccess: boolean };
  // Query information for display
  userQuery?: string;
  formalQuery?: string;
  intentParserResult?: any; // IntentParserResult from queryStorage
  // Force chat to open initially
  forceOpenChat?: boolean;
  // Initial chat state for continuing conversations
  initialChatMessages?: ChatMessage[];
  initialChatPrompt?: string;
  initialChatModel?: string;
  initialLoadedChatUid?: string; // UID of loaded chat from [[liveai/chat]]
  // Command context for enriching chat prompts
  initialStyle?: string; // Style to apply to chat messages
  initialCommandId?: number; // Command ID from BUILTIN_COMMANDS
  initialCommandPrompt?: string; // Key in completionCommands
}

export type ViewMode = "blocks" | "pages" | "mixed";
export type PageDisplayMode = "metadata" | "embed";
export type SortBy = "relevance" | "date" | "page" | "content-alpha" | "content-length";
export type SortOrder = "asc" | "desc";
export type ChatMode = "simple" | "agent";
export type DNPFilter = "all" | "dnp-only" | "no-dnp";

/**
 * View mode for FullResultsPopup - determines what panels are shown
 */
export type PopupViewMode = "both" | "results-only" | "chat-only";