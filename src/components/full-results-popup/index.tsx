import React from "react";
import ReactDOM from "react-dom";
import FullResultsPopupComponent from "./FullResultsPopup";
import { ChatMessage, PopupViewMode } from "./types";
import { getMainViewUid, getPageNameByPageUid } from "../../utils/roamAPI.js";
import { RoamContext } from "../../ai/agents/types";
import { loadResultsFromRoamContext } from "./utils/roamContextLoader";

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
  // Results can be provided directly OR via roamContext
  results?: any[];
  roamContext?: RoamContext | null; // Load results from RoamContext

  // Target and root UIDs
  targetUid?: string | null; // Where to insert results
  rootUid?: string | null; // Source block UID (to exclude from context results)

  // Query information
  userQuery?: string | null;
  formalQuery?: string | null;

  // View mode control
  viewMode?: PopupViewMode; // "both" | "results-only" | "chat-only"
  forceOpenChat?: boolean; // Legacy support - maps to viewMode

  // Intent parser result
  intentParserResult?: any | null;

  // Initial chat state
  initialChatMessages?: ChatMessage[] | null;
  initialChatPrompt?: string | null;
  initialChatModel?: string | null;

  // UI customization
  style?: string; // Custom style identifier for future use
}

// React component for popup functionality
// Accepts an options object with all parameters
export const openFullResultsPopup = async (
  options: OpenFullResultsPopupOptions = {}
) => {
  const {
    results: providedResults,
    roamContext = null,
    targetUid = null,
    rootUid = null,
    userQuery: providedUserQuery = null,
    formalQuery = null,
    viewMode = null,
    forceOpenChat = false,
    intentParserResult = null,
    initialChatMessages = null,
    initialChatPrompt = null,
    initialChatModel = null,
    style = null,
  } = options;

  // Handle loading results from RoamContext if provided
  let results = providedResults || [];
  let userQuery = providedUserQuery;

  if (roamContext && !providedResults) {
    try {
      const { results: contextResults, description } =
        await loadResultsFromRoamContext({
          roamContext,
          rootUid,
        });

      results = contextResults;
      // Use the generated description as userQuery if not provided
      if (!userQuery) {
        userQuery = description;
      }
    } catch (error) {
      console.error("Error loading results from RoamContext:", error);
      // Fall back to empty results on error
      results = [];
    }
  }

  // Determine the effective forceOpenChat based on viewMode
  let effectiveForceOpenChat = forceOpenChat;
  if (viewMode === "chat-only" || viewMode === "both") {
    effectiveForceOpenChat = true;
  }

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
    hasRootUid: !!rootUid,
    hasUserQuery: !!userQuery,
    viewMode,
    forceOpenChat: effectiveForceOpenChat,
    hasRoamContext: !!roamContext,
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
        forceOpenChat={effectiveForceOpenChat}
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

/**
 * Alias for openFullResultsPopup - provides a more descriptive name
 * for opening the popup with custom context configurations.
 *
 * This is essentially the same as openFullResultsPopup but with a name
 * that better describes its purpose when used with RoamContext.
 */
export const prepareFullResultsOrChatOpening = openFullResultsPopup;

/**
 * Opens FullResultsPopup with linked references of the current page.
 * This is a replacement for the deprecated invokeCurrentPageReferences function.
 *
 * @param options - Configuration options
 * @param options.model - AI model to use for chat
 * @param options.rootUid - Source block UID (to exclude from results)
 * @param options.targetUid - Target block for insertions
 * @param options.target - Target type (not used with new implementation)
 */
export const chatWithLinkedRefs = async ({
  model,
  rootUid,
  targetUid,
  target,
}: {
  model?: string;
  rootUid?: string;
  targetUid?: string;
  target?: string;
} = {}) => {
  try {
    // Get current page information
    const currentPageUid = await getMainViewUid();
    if (!currentPageUid) {
      throw new Error("No current page found");
    }

    // Get page name

    const pageName = getPageNameByPageUid(currentPageUid);
    if (!pageName || pageName === "undefined") {
      throw new Error("Could not get page name");
    }

    // Create RoamContext for linked references
    const roamContext: RoamContext = {
      linkedRefs: true,
      linkedRefsArgument: [pageName],
      pageViewUid: currentPageUid,
    };

    // Use currentPageUid as rootUid if not provided
    const effectiveRootUid = rootUid || currentPageUid;
    const effectiveTargetUid = targetUid || currentPageUid;

    // Open popup - skip if called from query composer
    if (rootUid !== "query-composer") {
      console.log(
        `🚀 [chatWithLinkedRefs] Opening popup with linked references for: ${pageName}`
      );

      await openFullResultsPopup({
        roamContext,
        rootUid: effectiveRootUid,
        targetUid: effectiveTargetUid,
        viewMode: "chat-only",
        initialChatModel: model,
      });
    } else {
      console.log(
        "🔧 [chatWithLinkedRefs] Skipping popup opening - called from query composer"
      );
    }

    // Return a minimal response object for compatibility with old invokeCurrentPageReferences callers
    return {
      userQuery: `Linked references of [[${pageName}]]`,
      formalQuery: `ref:${pageName}`,
      searchStrategy: "direct" as const,
      analysisType: "simple",
      language: "English",
      confidence: 1.0,
      datomicQuery: `ref:${pageName}`,
      needsPostProcessing: false,
      postProcessingType: undefined,
      isExpansionGlobal: false,
      semanticExpansion: undefined,
      customSemanticExpansion: undefined,
      searchDetails: { maxResults: 3000 },
      forceOpenChat: true,
      directToolExecution: true,
    };
  } catch (error) {
    console.error("Error in chatWithLinkedRefs:", error);
    throw error;
  }
};

// Make it globally accessible for command palette
if (typeof window !== "undefined") {
  if (!(window as any).LiveAI) (window as any).LiveAI = {};
  (window as any).LiveAI.openFullResultsPopup = openFullResultsPopup;
  (window as any).LiveAI.openChatPopup = openChatPopup;
  (window as any).LiveAI.prepareFullResultsOrChatOpening =
    prepareFullResultsOrChatOpening;
  (window as any).LiveAI.chatWithLinkedRefs = chatWithLinkedRefs;
}
