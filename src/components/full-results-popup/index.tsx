import React from "react";
import ReactDOM from "react-dom";
import FullResultsPopupComponent from "./FullResultsPopup";
import { ChatMessage, PopupViewMode } from "./types/types";
import {
  getMainViewUid,
  getPageNameByPageUid,
  getUidAndTitleOfMentionedPagesInBlock,
  getTreeByUid,
  getBlockContentByUid,
  getParentBlock,
} from "../../utils/roamAPI.js";
import { RoamContext } from "../../ai/agents/types";
import { loadResultsFromRoamContext } from "./utils/roamContextLoader";
import { chatRoles } from "../..";
import {
  getFlattenedContentFromTree,
  getRoamContextFromPrompt,
  getUnionContext,
} from "../../ai/dataExtraction.js";
import { convertRoamToMarkdownFormat } from "./utils/chatMessageUtils";

// Main component and utilities
export {
  default as FullResultsPopup,
  openLastAskYourGraphResults,
  hasLastAskYourGraphResults,
  useFullResultsPopup,
} from "./FullResultsPopup";

// Sub-components
export { FullResultsChat } from "./components/chat/FullResultsChat";
export {
  BlockRenderer,
  ResultContent,
  ResultMetadata,
} from "./components/results/ResultRenderer";

// Hooks
export { useFullResultsState } from "./hooks/useFullResultsState";

// Utilities
export * from "./utils/resultProcessing";
export * from "./utils/chatHelpers";

// Types
export * from "./types/types";

/**
 * Helper function to detect if a block is part of a liveai/chat conversation
 * and extract the conversation history from it.
 *
 * @param rootUid - The block UID to check
 * @returns Conversation history array or null if not a chat conversation
 */
export const extractConversationFromLiveAIChat = (
  rootUid: string
): Array<{
  role: "user" | "assistant";
  content: string;
  roamBlockUid?: string;
}> | null => {
  if (!rootUid) return null;

  // Function to check if a block has [[liveai/chat]] reference
  const hasLiveAIChatReference = (uid: string): boolean => {
    const mentionedPages = getUidAndTitleOfMentionedPagesInBlock(uid);
    if (!mentionedPages) return false;
    return mentionedPages.some(
      (page) => page.title === "liveai/chat" || page.title === "liveai chat"
    );
  };

  // Check if rootUid has #liveai/chat reference
  let chatRootUid = rootUid;
  let hasChatReference = hasLiveAIChatReference(rootUid);

  // If not, check if parent has #liveai/chat reference
  if (!hasChatReference) {
    const parentUid = getParentBlock(rootUid);
    if (parentUid && hasLiveAIChatReference(parentUid)) {
      chatRootUid = parentUid;
      hasChatReference = true;
    }
  }

  // If no chat reference found, return null
  if (!hasChatReference) {
    console.log("📝 No #liveai/chat reference found");
    return null;
  }

  console.log("📝 Found #liveai/chat reference in block:", chatRootUid);

  // Get the tree of children blocks
  const tree = getTreeByUid(chatRootUid);

  if (!tree || !tree[0]?.children || tree[0].children.length === 0) {
    console.log("📝 No children blocks found for conversation");
    return null;
  }

  // Extract conversation from children blocks
  const conversation: Array<{
    role: "user" | "assistant";
    content: string;
    roamBlockUid?: string;
  }> = [];
  const children = tree[0].children.sort(
    (a: any, b: any) => (a.order || 0) - (b.order || 0)
  );

  for (const child of children) {
    const blockContent = getBlockContentByUid(child.uid);
    if (!blockContent || !blockContent.trim()) continue;

    // Get the full flattened content including children blocks
    const turnFlattenedContent = getFlattenedContentFromTree({
      parentUid: child.uid,
      maxCapturing: 99,
      maxUid: null,
      withDash: true,
    });

    if (!turnFlattenedContent || !turnFlattenedContent.trim()) continue;

    // Determine role based on chatRoles prefix (only check the parent block content)
    let role: "user" | "assistant";
    let content = turnFlattenedContent;

    // Check if block starts with assistant role prefix
    if (
      chatRoles?.genericAssistantRegex &&
      chatRoles.genericAssistantRegex.test(blockContent)
    ) {
      role = "assistant";
      // Remove the assistant prefix from content (only from the first line)
      if (chatRoles.assistant) {
        content = turnFlattenedContent.replace(chatRoles.assistant, "").trim();
      }
    } else if (chatRoles?.user && blockContent.startsWith(chatRoles.user)) {
      role = "user";
      // Remove the user prefix from content (only from the first line)
      content = turnFlattenedContent.replace(chatRoles.user, "").trim();
    } else {
      // If no role prefix detected, alternate between user and assistant
      // Starting with user if this is the first message, otherwise alternate
      role =
        conversation.length === 0 ||
        conversation[conversation.length - 1].role === "assistant"
          ? "user"
          : "assistant";
    }

    // Remove the leading "- " from the first line (added by getFlattenedContentFromTree with withDash: true)
    // The first line of content shouldn't have a bullet point in chat display
    if (content.startsWith("- ")) {
      content = content.substring(2);
    }

    // Convert Roam-native formatting to markdown before storing in conversation
    // This ensures the chat displays properly with markdown formatting
    const markdownContent = convertRoamToMarkdownFormat(content);

    conversation.push({
      role,
      content: markdownContent,
      roamBlockUid: child.uid, // Include the block UID for in-place editing
    });
  }

  return conversation.length > 0 ? conversation : null;
};

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
  initialLoadedChatUid?: string | null; // UID of loaded chat from [[liveai/chat]]

  // UI customization
  style?: string; // Custom style identifier for future use

  // Command context (for enriching chat prompts)
  commandId?: number; // Command ID from BUILTIN_COMMANDS
  commandPrompt?: string; // Key in completionCommands (e.g., "summarize", "keyInsights")

  // Initial filter state
  initialIncludedReferences?: string[]; // Pre-populate included references filter
  initialExcludedReferences?: string[]; // Pre-populate excluded references filter
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
    initialLoadedChatUid = null,
    style = null,
    commandId = null,
    commandPrompt = null,
    initialIncludedReferences = null,
    initialExcludedReferences = null,
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
      if (!userQuery && results.length) {
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

  // if (!results.length) userQuery = undefined;

  const PopupWrapper = () => {
    return (
      <FullResultsPopupComponent
        results={results || []}
        isOpen={true}
        title={
          viewMode === "chat-only"
            ? results?.length
              ? "Live AI: Chat with context"
              : "Live AI Chat"
            : "Ask your graph: full results view"
        }
        targetUid={targetUid || rootUid}
        userQuery={userQuery}
        formalQuery={formalQuery}
        intentParserResult={intentParserResult}
        forceOpenChat={effectiveForceOpenChat}
        initialChatMessages={initialChatMessages}
        initialChatPrompt={initialChatPrompt}
        initialChatModel={initialChatModel}
        initialLoadedChatUid={initialLoadedChatUid}
        initialStyle={style}
        initialCommandId={commandId}
        initialCommandPrompt={commandPrompt}
        initialIncludedReferences={initialIncludedReferences}
        initialExcludedReferences={initialExcludedReferences}
      />
    );
  };

  ReactDOM.render(<PopupWrapper />, container);
};

/**
 * Options for opening chat popup
 */
export interface OpenChatPopupOptions {
  conversationHistory?: Array<{
    role: "user" | "assistant";
    content: string;
    roamBlockUid?: string;
  }>;
  model?: string;
  rootUid?: string;
  roamContext?: RoamContext;
  viewMode?: PopupViewMode; // "chat-only" | "both" - defaults based on roamContext
  style?: string;
  commandId?: number; // Command ID from BUILTIN_COMMANDS
  commandPrompt?: string; // Key in completionCommands (e.g., "summarize", "keyInsights")
}

/**
 * Opens FullResultsPopup with chat panel (optionally with results from RoamContext).
 * Used to start a blank chat or continue an existing conversation.
 *
 * @param options - Configuration options
 */
export const openChatPopup = async ({
  conversationHistory,
  model,
  rootUid,
  roamContext,
  viewMode,
  style,
  commandId,
  commandPrompt,
}: OpenChatPopupOptions = {}) => {
  try {
    // Get the CURRENT page UID for context
    const currentPageUid = await getMainViewUid();

    // Use rootUid if provided, otherwise use current page UID
    let targetUid = rootUid;

    // Test if the focused current block contains some inline context
    let effectiveRoamContext = roamContext || {};
    let cleanedBlockContent: string | null = null;
    if (rootUid) {
      const blockContent = getBlockContentByUid(rootUid);
      if (blockContent) {
        const inlineContext = getRoamContextFromPrompt(blockContent, false);
        if (inlineContext) {
          console.log("Inline context extracted from focused block :>> ", inlineContext);
          // Merge inline context with existing roamContext
          effectiveRoamContext = getUnionContext(effectiveRoamContext, inlineContext.roamContext);
          // Store the cleaned prompt without context metadata
          cleanedBlockContent = inlineContext.updatedPrompt;
        }
      }
    }

    // Determine viewMode: if roamContext provided, default to "both", otherwise "chat-only"
    const effectiveViewMode = viewMode || (effectiveRoamContext && Object.keys(effectiveRoamContext).length > 0 ? "both" : "chat-only");

    // Prepare chat messages from conversation history if provided
    let initialChatMessages: ChatMessage[] | undefined = undefined;
    let initialChatPrompt: string | undefined = undefined;

    // If no conversationHistory provided, try to extract from [[liveai/chat]] blocks
    let effectiveConversationHistory = conversationHistory;
    let loadedChatUid: string | undefined = undefined;

    if (!effectiveConversationHistory && rootUid) {
      const extractedConversation = extractConversationFromLiveAIChat(rootUid);
      if (extractedConversation) {
        effectiveConversationHistory = extractedConversation;
        loadedChatUid = rootUid; // Store the rootUid for displaying the chat title
        console.log(
          "📝 Using conversation history from [[liveai/chat]] blocks"
        );
      } else {
        // Use cleaned block content if available (context metadata removed),
        // otherwise get the full flattened content
        let rootContent = cleanedBlockContent;
        if (!rootContent) {
          rootContent = getFlattenedContentFromTree({
            parentUid: rootUid,
            maxCapturing: 99,
            maxUid: 0,
            withDash: true,
            isParentToIgnore: false,
          });
        }
        if (rootContent?.trim())
          effectiveConversationHistory = [
            { role: "user", content: rootContent },
          ];
      }
    }

    // Ensure conversationHistory is a valid array
    if (
      effectiveConversationHistory &&
      Array.isArray(effectiveConversationHistory) &&
      effectiveConversationHistory.length > 0
    ) {
      // Check if last message is from user - if so, put it in the input field
      const lastMessage =
        effectiveConversationHistory[effectiveConversationHistory.length - 1];
      const isLastMessageFromUser = lastMessage?.role === "user";

      // If we have command context (commandId or commandPrompt), keep the user message
      // in the chat history so FullResultsChat can process it with the command
      const hasCommandContext = !!(commandId || commandPrompt);

      if (isLastMessageFromUser && !hasCommandContext) {
        // Put last user message in input field (normal chat continuation)
        initialChatPrompt = lastMessage.content;

        // Convert all previous messages (excluding the last one) to chat messages
        if (effectiveConversationHistory.length > 1) {
          initialChatMessages = effectiveConversationHistory
            .slice(0, -1) // Exclude the last message
            .filter((msg) => msg && msg.role && msg.content) // Filter out invalid messages
            .map((msg) => ({
              role: msg.role,
              content: msg.content,
              timestamp: new Date(),
              roamBlockUid: msg.roamBlockUid, // Preserve block UID for in-place editing
            }));
        }
      } else {
        // All messages go into chat history
        // (either command context or last message is from assistant)
        initialChatMessages = effectiveConversationHistory
          .filter((msg) => msg && msg.role && msg.content) // Filter out invalid messages
          .map((msg) => ({
            role: msg.role,
            content: msg.content,
            timestamp: new Date(),
            roamBlockUid: msg.roamBlockUid, // Preserve block UID for in-place editing
          }));
      }
    }

    // Open popup using the updated openFullResultsPopup
    await openFullResultsPopup({
      roamContext: effectiveRoamContext, // Can include inline context merged with passed roamContext
      results: Object.keys(effectiveRoamContext).length > 0 ? undefined : [], // Empty results if no roamContext
      targetUid,
      rootUid,
      viewMode: effectiveViewMode,
      initialChatMessages,
      initialChatPrompt,
      initialChatModel: model,
      initialLoadedChatUid: loadedChatUid,
      style,
      commandId,
      commandPrompt,
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

    // Extract linked references filters from Roam's native UI
    let linkedRefsFilters: { includes: string[]; removes: string[] } = {
      includes: [],
      removes: [],
    };

    try {
      // Use Roam API to get current linked refs filters
      if (pageName) {
        linkedRefsFilters = window.roamAlphaAPI.ui.filters.getPageLinkedRefsFilters({
          page: { title: pageName },
        });
      }
    } catch (error) {
      console.warn(
        "⚠️ [chatWithLinkedRefs] Failed to retrieve linked refs filters:",
        error
      );
      // Continue with empty filters if API call fails
    }

    // Create RoamContext for linked references
    const roamContext: RoamContext = {
      linkedRefs: true,
      pageViewUid: currentPageUid,
    };

    // Use currentPageUid as rootUid if not provided
    const effectiveRootUid = rootUid || currentPageUid;
    const effectiveTargetUid = targetUid || currentPageUid;

    // Open popup - skip if called from query composer
    if (rootUid !== "query-composer") {
      console.log(
        `🚀 [chatWithLinkedRefs] Opening popup with linked references for: ${
          pageName || currentPageUid
        }`
      );

      await openFullResultsPopup({
        roamContext,
        rootUid: effectiveRootUid,
        targetUid: effectiveTargetUid,
        viewMode: "chat-only",
        initialChatModel: model,
        initialIncludedReferences: linkedRefsFilters.includes || [],
        initialExcludedReferences: linkedRefsFilters.removes || [],
      });
    } else {
      console.log(
        "🔧 [chatWithLinkedRefs] Skipping popup opening - called from query composer"
      );
    }

    // Return a minimal response object for compatibility with old invokeCurrentPageReferences callers
    return {
      userQuery: pageName
        ? `Linked references of [[${pageName}]]`
        : `Linked references of ((${pageName})) block`,
      formalQuery: pageName ? `ref:${pageName}` : undefined,
      searchStrategy: "direct" as const,
      analysisType: "simple",
      confidence: 1.0,
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

/**
 * Opens FullResultsPopup with query results from a Roam query block.
 * Similar to chatWithLinkedRefs but for query results.
 *
 * @param options - Configuration options
 * @param options.queryBlockUid - UID of the query block
 * @param options.model - AI model to use for chat
 */
export const chatWithQuery = async ({
  queryBlockUid,
  model,
}: {
  queryBlockUid: string;
  model?: string;
}) => {
  try {
    if (!queryBlockUid) {
      throw new Error("No query block UID provided");
    }

    // Create RoamContext for query results
    const roamContext: RoamContext = {
      query: true,
      queryBlockUid,
    };

    console.log(
      `🚀 [chatWithQuery] Opening popup with query results for: ${queryBlockUid}`
    );

    await openFullResultsPopup({
      roamContext,
      rootUid: queryBlockUid,
      targetUid: queryBlockUid,
      viewMode: "chat-only",
      initialChatModel: model,
    });

    return {
      userQuery: `Query results from ((${queryBlockUid}))`,
      searchStrategy: "direct" as const,
      confidence: 1.0,
      forceOpenChat: true,
      directToolExecution: true,
    };
  } catch (error) {
    console.error("Error in chatWithQuery:", error);
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
  (window as any).LiveAI.chatWithQuery = chatWithQuery;
  console.log("✅ Full Results Popup functions registered on window.LiveAI");
}
