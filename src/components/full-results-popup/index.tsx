import React from "react";
import ReactDOM from "react-dom";
import FullResultsPopupComponent from "./FullResultsPopup";
import { ChatMessage } from "./types";
import { getMainViewUid } from "../../utils/roamAPI.js";

// Main component and utilities
export {
  default as FullResultsPopup,
  openLastAskYourGraphResults,
  hasLastAskYourGraphResults,
  useFullResultsPopup,
} from "./FullResultsPopup";

// Sub-components
export { FullResultsChat } from "./FullResultsChat";
export { BlockRenderer, ResultContent, ResultMetadata } from "./ResultRenderer";

// Hooks
export { useFullResultsState } from "./hooks/useFullResultsState";

// Utilities
export * from "./utils/resultProcessing";
export * from "./utils/chatHelpers";

// Types
export * from "./types";

// Options interface for openFullResultsPopup
export interface OpenFullResultsPopupOptions {
  results?: any[];
  targetUid?: string | null;
  userQuery?: string | null;
  formalQuery?: string | null;
  forceOpenChat?: boolean;
  intentParserResult?: any | null;
  initialChatMessages?: ChatMessage[] | null;
  initialChatPrompt?: string | null;
  initialChatModel?: string | null;
}

// React component for popup functionality
// Accepts an options object with all parameters
export const openFullResultsPopup = (
  options: OpenFullResultsPopupOptions = {}
) => {
  const {
    results = [],
    targetUid = null,
    userQuery = null,
    formalQuery = null,
    forceOpenChat = false,
    intentParserResult = null,
    initialChatMessages = null,
    initialChatPrompt = null,
    initialChatModel = null,
  } = options;

  // Remove any existing popup first
  const existingContainer = document.getElementById(
    "full-results-popup-container"
  );
  if (existingContainer) {
    try {
      ReactDOM.unmountComponentAtNode(existingContainer);
      document.body.removeChild(existingContainer);
    } catch (error) {
      console.warn("Error cleaning up existing popup:", error);
    }
  }

  // Create a container for the React component
  const container = document.createElement("div");
  container.id = "full-results-popup-container";
  document.body.appendChild(container);

  console.log("📊 Opening FullResultsPopup with:", {
    resultsCount: results?.length || 0,
    hasTargetUid: !!targetUid,
    hasUserQuery: !!userQuery,
    forceOpenChat,
    hasInitialChatMessages: !!initialChatMessages,
    hasInitialChatPrompt: !!initialChatPrompt,
  });

  const PopupWrapper = () => {
    return (
      <FullResultsPopupComponent
        results={results || []}
        isOpen={true}
        title="Ask your graph: full results view"
        targetUid={targetUid}
        userQuery={userQuery}
        formalQuery={formalQuery}
        intentParserResult={intentParserResult}
        forceOpenChat={forceOpenChat}
        initialChatMessages={initialChatMessages}
        initialChatPrompt={initialChatPrompt}
        initialChatModel={initialChatModel}
      />
    );
  };

  ReactDOM.render(<PopupWrapper />, container);
};

// Function to open FullResultsPopup with chat panel only
// Used to start a blank chat or continue an existing conversation
// conversationHistory format: Array<{ role: "user" | "assistant", content: string }>
export const openChatPopup = async (
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>,
  model?: string,
  parentBlockUid?: string
) => {
  try {
    // Get the CURRENT page UID for context
    const currentPageUid = await getMainViewUid();

    // Use parentBlockUid if provided, otherwise use current page UID
    const targetUid = parentBlockUid || currentPageUid || null;

    // Prepare chat messages from conversation history if provided
    let initialChatMessages: ChatMessage[] | undefined = undefined;
    let initialChatPrompt: string | undefined = undefined;
    let initialChatModel: string | undefined = model;

    // Ensure conversationHistory is a valid array
    if (
      conversationHistory &&
      Array.isArray(conversationHistory) &&
      conversationHistory.length > 0
    ) {
      // Check if last message is from user - if so, put it in the input field
      const lastMessage = conversationHistory[conversationHistory.length - 1];
      const isLastMessageFromUser = lastMessage?.role === "user";

      if (isLastMessageFromUser) {
        // Put last user message in input field
        initialChatPrompt = lastMessage.content;

        // Convert all previous messages (excluding the last one) to chat messages
        if (conversationHistory.length > 1) {
          initialChatMessages = conversationHistory
            .slice(0, -1) // Exclude the last message
            .filter((msg) => msg && msg.role && msg.content) // Filter out invalid messages
            .map((msg) => ({
              role: msg.role,
              content: msg.content,
              timestamp: new Date(),
            }));
        }
      } else {
        // All messages go into chat history
        initialChatMessages = conversationHistory
          .filter((msg) => msg && msg.role && msg.content) // Filter out invalid messages
          .map((msg) => ({
            role: msg.role,
            content: msg.content,
            timestamp: new Date(),
          }));
      }
    }

    // Open popup with empty results, forcing chat panel open in chat-only mode
    openFullResultsPopup({
      results: [], // Empty results
      targetUid,
      userQuery: null,
      formalQuery: null,
      forceOpenChat: true, // Force chat open
      intentParserResult: null,
      initialChatMessages,
      initialChatPrompt,
      initialChatModel,
    });
  } catch (error) {
    console.error("Error opening chat popup:", error);
    alert(
      "Failed to open chat popup. Please check the console for more details."
    );
  }
};

// Make it globally accessible for command palette
if (typeof window !== "undefined") {
  if (!(window as any).LiveAI) (window as any).LiveAI = {};
  (window as any).LiveAI.openFullResultsPopup = openFullResultsPopup;
  (window as any).LiveAI.openChatPopup = openChatPopup;
}
