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
}

export type ViewMode = "blocks" | "pages" | "mixed";
export type PageDisplayMode = "metadata" | "embed";
export type SortBy = "relevance" | "date" | "page" | "content-alpha" | "content-length";
export type SortOrder = "asc" | "desc";
export type ChatMode = "simple" | "agent";
export type DNPFilter = "all" | "dnp-only" | "no-dnp";