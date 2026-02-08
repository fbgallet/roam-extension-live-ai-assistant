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
  model?: string; // Model used for this assistant message (for proper role prefix when re-inserting)
  isHelpMessage?: boolean;
  helpType?: "chat" | "liveai" | "tip" | "whatsnew";
  toolUsage?: Array<{
    toolName: string;
    details: string;
    response?: string; // Tool's response/feedback
    timestamp: number;
    intermediateMessage?: string;
  }>;
  roamBlockUid?: string; // UID of this message's block in Roam (if saved)
  isTemporaryBlock?: boolean; // True if block was created just for editing
  // Query-specific fields (for NL query command results)
  queryContent?: string; // The generated query string ({{query:...}} or :q [...])
  queryType?: "roam" | "datomic"; // Type of query
  queryResultCount?: number; // Number of results from executing the query
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
  // Initial filter state
  initialIncludedReferences?: string[]; // Pre-populate included references filter
  initialExcludedReferences?: string[]; // Pre-populate excluded references filter
}

export type ViewMode = "blocks" | "pages" | "mixed";
export type PageDisplayMode = "metadata" | "embed";
export type SortBy = "relevance" | "date" | "page" | "content-alpha" | "content-length" | "selection";
export type SortOrder = "asc" | "desc";
export type ChatMode = "simple" | "agent";
export type DNPFilter = "all" | "dnp-only" | "no-dnp";
export type SelectionFilter = "all" | "selected-only";

/**
 * View mode for FullResultsPopup - determines what panels are shown
 */
export type PopupViewMode = "both" | "results-only" | "chat-only";

/**
 * Pending tool confirmation for sensitive operations like block/page creation
 */
export interface PendingToolConfirmation {
  toolName: string;
  toolCallId: string;
  args: Record<string, any>;
  timestamp: number;
  // Resolve function to continue tool execution
  resolve: (result: ToolConfirmationResult) => void;
}

export interface ToolConfirmationResult {
  approved: boolean;
  alwaysApprove?: boolean; // "Always accept in this session"
  declineReason?: string; // User's explanation for declining
}