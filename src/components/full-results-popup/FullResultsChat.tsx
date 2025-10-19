import React, { useState, useRef, useEffect } from "react";
import {
  Button,
  Icon,
  Tooltip,
  HTMLSelect,
  TextArea,
  Popover,
} from "@blueprintjs/core";
import DOMPurify from "dompurify";
import { invokeSearchAgent } from "../../ai/agents/search-agent/ask-your-graph-invoke";
import { Result, ChatMessage, ChatMode } from "./types";
import { performAdaptiveExpansion } from "../../ai/agents/search-agent/helpers/contextExpansion";
import { extensionStorage, defaultModel, chatRoles } from "../..";
import ModelsMenu from "../ModelsMenu";
import {
  getPageUidByPageName,
  insertBlockInCurrentView,
} from "../../utils/roamAPI";
import { modelAccordingToProvider } from "../../ai/aiAPIsHub";
import { parseAndCreateBlocks } from "../../utils/format";
import { insertCompletion } from "../../ai/responseInsertion";
import { AppToaster } from "../Toaster";
import { ChatHistorySelect } from "./ChatHistorySelect";
import { extractConversationFromLiveAIChat } from "./index";

interface FullResultsChatProps {
  isOpen: boolean;
  selectedResults: Result[];
  allResults: Result[]; // All available results
  paginatedResults: Result[]; // Currently displayed results
  privateMode: boolean;
  targetUid?: string;
  onClose: () => void;
  // Chat state from parent
  chatMessages: ChatMessage[];
  setChatMessages: (
    messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
  ) => void;
  chatAccessMode: "Balanced" | "Full Access";
  setChatAccessMode: (mode: "Balanced" | "Full Access") => void;
  chatAgentData: any;
  setChatAgentData: (data: any) => void;
  chatExpandedResults: Result[] | null;
  setChatExpandedResults: (results: Result[] | null) => void;
  // Pagination props for cross-page navigation
  currentPage: number;
  setCurrentPage: (page: number) => void;
  resultsPerPage: number;
  // View mode props for ((uid)) click handling
  chatOnlyMode: boolean;
  handleChatOnlyToggle: () => void;
  // References filtering
  handleIncludeReference: (reference: string) => void;
  // Initial chat state for continuing conversations
  initialChatMessages?: ChatMessage[];
  initialChatPrompt?: string;
  initialChatModel?: string;
}

// Convert chat messages to agent conversation history
const buildConversationHistory = (chatMessages: ChatMessage[]) => {
  return chatMessages.map((msg) => ({
    role: msg.role === "user" ? "User" : "Assistant",
    content: msg.content,
  }));
};

// Calculate total tokens used in the conversation
const calculateTotalTokens = (chatMessages: ChatMessage[]) => {
  let totalIn = 0;
  let totalOut = 0;

  chatMessages.forEach((msg) => {
    if (msg.tokensIn !== undefined) totalIn += msg.tokensIn;
    if (msg.tokensOut !== undefined) totalOut += msg.tokensOut;
  });

  return { totalIn, totalOut };
};

// Simple markdown renderer for chat messages
const renderMarkdown = (text: string): string => {
  if (!text) return "";

  let rendered = text;

  // Bold text **text** (do this early to avoid conflicts)
  rendered = rendered.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

  // Headers - handle ### first, then ##, then # (process before line break conversion)
  rendered = rendered.replace(/(^|\n)### (.+?)(?=\n|$)/gm, "$1<h4>$2</h4>");
  rendered = rendered.replace(/(^|\n)## (.+?)(?=\n|$)/gm, "$1<h3>$2</h3>");
  rendered = rendered.replace(/(^|\n)# (.+?)(?=\n|$)/gm, "$1<h2>$2</h2>");

  // Bullet points - item (before line break processing)
  rendered = rendered.replace(/(^|\n)- (.+?)(?=\n|$)/gm, "$1<li>$2</li>");

  // Numbered lists 1. item (before line break processing)
  rendered = rendered.replace(/(^|\n)\d+\.\s(.+?)(?=\n|$)/gm, "$1<li>$2</li>");

  // Wrap consecutive li elements in ul
  rendered = rendered.replace(/(<li>.*?<\/li>)(\s*<li>)/gs, "$1$2");
  rendered = rendered.replace(/(<li>.*?<\/li>)/gs, "<ul>$1</ul>");
  rendered = rendered.replace(/<\/ul>\s*<ul>/g, "");

  // Convert double line breaks to paragraph breaks
  rendered = rendered.replace(/\n\n/g, "</p><p>");

  // Convert remaining single line breaks to br tags (but not around headers)
  rendered = rendered.replace(/\n(?!<\/?(h[1-6]|li|ul))/g, "<br>");

  // Clean up line breaks around headers and lists
  rendered = rendered.replace(/(<br>)*(<\/?(h[1-6]|ul)>)(<br>)*/g, "$2");

  // Convert Roam embed syntax to clickable links
  rendered = rendered.replace(
    /\{\{\[\[(.*?)\]\]:\s*\(\((.*?)\)\)\}\}/g,
    '<a href="#" data-block-uid="$2" class="roam-block-ref-chat roam-embed-link" title="Click: Copy ((uid)) & show result • Shift+click: Open in sidebar">📄 {{[[embed-path]]: (($2))}}]</a>'
  );

  // Simple block reference ((uid))
  rendered = rendered.replace(
    /\(\(([^\(].*?)\)\)/g,
    `<a href="#" data-block-uid="$1" class="roam-block-ref-chat" title="Click: Copy ((uid)) & show result • Shift+click: Open in sidebar"><span class="bp3-icon bp3-icon-flow-end"></span></a>`
  );

  // convert to [link](((uid)))
  rendered = rendered.replace(
    /\[([^\]].*?)\]\(\((.*)\)\)/g,
    `<a href="#" data-block-uid="$2" class="roam-block-ref-chat" title="Click: Copy ((uid)) & show result • Shift+click: Open in sidebar">$1<span class="bp3-icon bp3-icon-flow-end"></span></a>`
  );

  // Page references [[page title]] - make clickable
  rendered = rendered.replace(
    /\[\[([^\]]+)\]\]/g,
    `<span class="rm-page-ref__brackets">[[</span><a href="#" data-page-title="$1" data-page-uid="$1" class="rm-page-ref rm-page-ref--link" title="Click: Filter by this page • Shift+click: Open in sidebar">$1</a><span class="rm-page-ref__brackets">]]</span>`
  );

  // Tag references #tag - make clickable
  rendered = rendered.replace(
    /#([a-zA-Z0-9_-]+)/g,
    '<a href="#" data-page-title="$1" class="rm-page-ref rm-page-ref--tag" title="Click: Filter by this tag • Shift+click: Open in sidebar">#$1</a>'
  );

  // Wrap in paragraphs (but not if it starts with a header or list)
  if (!rendered.match(/^<(h[1-6]|ul)/)) {
    rendered = "<p>" + rendered + "</p>";
  }
  rendered = rendered.replace(/<p><\/p>/g, "");

  return DOMPurify.sanitize(rendered);
};

export const FullResultsChat: React.FC<FullResultsChatProps> = ({
  isOpen,
  selectedResults,
  allResults,
  paginatedResults,
  privateMode,
  targetUid,
  onClose,
  chatMessages,
  setChatMessages,
  chatAccessMode,
  setChatAccessMode,
  chatAgentData,
  setChatAgentData,
  chatExpandedResults,
  setChatExpandedResults,
  currentPage,
  setCurrentPage,
  resultsPerPage,
  chatOnlyMode,
  handleChatOnlyToggle,
  handleIncludeReference,
  initialChatMessages,
  initialChatPrompt,
  initialChatModel,
}) => {
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  // Track the number of initial messages loaded from Roam
  // This helps us exclude them when inserting the conversation back
  const initialMessagesCountRef = useRef<number>(0);

  // Initialize chat from provided initial state
  useEffect(() => {
    console.log("🔍 FullResultsChat initializing with:", {
      initialChatMessages,
      initialChatPrompt,
    });

    if (
      initialChatMessages &&
      Array.isArray(initialChatMessages) &&
      initialChatMessages.length > 0
    ) {
      // Create a fresh copy to avoid mutation issues
      const messagesCopy = [...initialChatMessages];
      console.log("📝 Setting chat messages:", messagesCopy);
      setChatMessages(messagesCopy);

      // Store count of initial messages to exclude from Roam insertion later
      initialMessagesCountRef.current = messagesCopy.length;
    }
    if (initialChatPrompt) {
      console.log("📝 Setting chat input:", initialChatPrompt);
      setChatInput(initialChatPrompt);
    }
  }, [initialChatMessages, initialChatPrompt]);

  // Track if chat was previously closed to detect when it opens
  const prevIsOpenRef = useRef(isOpen);

  // Auto-focus chat input when in chat-only mode or when chat first opens
  // This effect runs whenever chatOnlyMode or isOpen changes
  useEffect(() => {
    const chatJustOpened = isOpen && !prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;

    // Focus if: switching to chat-only mode OR chat just opened
    if ((chatOnlyMode || chatJustOpened) && chatInputRef.current) {
      // Small delay to ensure DOM is ready
      const timeoutId = setTimeout(() => {
        console.log("🎯 Auto-focusing chat input:", {
          chatOnlyMode,
          chatJustOpened,
        });
        chatInputRef.current?.focus();
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [chatOnlyMode, isOpen]);

  // Track previous isTyping state to detect when assistant finishes responding
  const prevIsTypingRef = useRef(isTyping);

  // Auto-focus chat input when assistant finishes responding
  useEffect(() => {
    const assistantJustFinished = prevIsTypingRef.current && !isTyping;
    prevIsTypingRef.current = isTyping;

    // Focus input when assistant just finished responding
    if (assistantJustFinished && chatInputRef.current) {
      // Small delay to ensure streaming is fully complete
      const timeoutId = setTimeout(() => {
        console.log("🎯 Auto-focusing chat input after assistant response");
        chatInputRef.current?.focus();
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [isTyping]);

  // Additional effect to handle initial mount - runs once when component first appears
  // This is crucial for when the popup opens directly in chat-only mode via openChatPopup()
  const hasMounted = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;

      // Check if we should auto-focus on initial mount
      // Focus if: in chat-only mode OR if there are no results (which implies chat-only)
      const shouldFocus =
        chatOnlyMode ||
        (allResults.length === 0 && selectedResults.length === 0);

      if (shouldFocus && chatInputRef.current) {
        // Delay to ensure the component is fully rendered
        const timeoutId = setTimeout(() => {
          console.log("🎯 Auto-focusing chat input on mount");
          chatInputRef.current?.focus();
        }, 250);

        return () => clearTimeout(timeoutId);
      }
    }
  }, []); // Empty deps - only run once on mount

  // Ref for auto-scrolling to the latest message
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Ref for the chat input field
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  // State to track pending highlight after page change
  const [pendingHighlight, setPendingHighlight] = useState<string | null>(null);

  // Auto-scroll to the latest message when messages change
  useEffect(() => {
    if (chatMessages.length > 0 && messagesContainerRef.current) {
      // Find the last user message to position it at the top of the visible area
      const userMessages = messagesContainerRef.current.querySelectorAll(
        ".full-results-chat-message.user"
      );
      const lastUserMessage = userMessages[
        userMessages.length - 1
      ] as HTMLElement;

      if (lastUserMessage) {
        // Scroll so the last user message is at the top of the container
        lastUserMessage.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      } else {
        // If no user messages, scroll to the bottom to show the latest content
        messagesContainerRef.current.scrollTop =
          messagesContainerRef.current.scrollHeight;
      }
    }
  }, [chatMessages, streamingContent]);

  // Watch for page changes and handle pending highlights
  useEffect(() => {
    if (pendingHighlight) {
      // Small delay to ensure DOM is updated
      const timeoutId = setTimeout(() => {
        highlightElementOnCurrentPage(pendingHighlight);
        setPendingHighlight(null);
      }, 50);

      return () => clearTimeout(timeoutId);
    }
  }, [currentPage, pendingHighlight]);

  // Watch for chat-only mode changes and handle pending highlights
  useEffect(() => {
    if (pendingHighlight && !chatOnlyMode) {
      // When switching from chat-only mode to results view, handle pending highlight
      const timeoutId = setTimeout(() => {
        highlightAndScrollToResult(pendingHighlight);
        setPendingHighlight(null);
      }, 100); // Slightly longer delay for mode switch

      return () => clearTimeout(timeoutId);
    }
  }, [chatOnlyMode, pendingHighlight]);

  // Handle block reference hover for navigation and highlighting
  useEffect(() => {
    const handleBlockRefHover = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (target.classList.contains("roam-block-ref-chat")) {
        const blockUid = target.getAttribute("data-block-uid");
        if (!blockUid) return;

        // Only highlight on hover if NOT in chat-only mode
        if (!chatOnlyMode) {
          // Hover: Highlight and scroll to result in popup
          highlightAndScrollToResult(blockUid);
        }
      }
    };

    const handleBlockRefClick = (event: MouseEvent) => {
      event.preventDefault();
      const target = event.target as HTMLElement;

      if (target.classList.contains("roam-block-ref-chat")) {
        const blockUid = target.getAttribute("data-block-uid");
        if (!blockUid) return;

        // Always copy ((uid)) to clipboard
        const clipboardText = `((${blockUid}))`;
        navigator.clipboard
          .writeText(clipboardText)
          .then(() => {})
          .catch((err) => {
            console.warn("Failed to copy to clipboard:", err);
          });

        if (event.shiftKey) {
          // Shift+click: Open in sidebar
          window.roamAlphaAPI.ui.rightSidebar.addWindow({
            window: { type: "block", "block-uid": blockUid },
          });
        } else {
          // Regular click: Show results and highlight
          if (chatOnlyMode) {
            // Set pending highlight and switch mode - useEffect will handle the rest
            setPendingHighlight(blockUid);
            handleChatOnlyToggle(); // Use the proper handler instead of direct setter
          } else {
            // Highlight immediately if already in results view
            highlightAndScrollToResult(blockUid);
          }
        }
      }

      // Handle page references [[page]] and #tag clicks
      if (
        target.classList.contains("rm-page-ref") ||
        target.classList.contains("roam-page-ref-chat") ||
        target.classList.contains("roam-tag-ref-chat")
      ) {
        const pageTitle = target.getAttribute("data-page-title");
        if (!pageTitle) return;

        event.preventDefault(); // Prevent default link behavior

        if (event.shiftKey) {
          // Shift+click: Open page in sidebar
          const pageUid = getPageUidByPageName(pageTitle);
          if (pageUid) {
            window.roamAlphaAPI.ui.rightSidebar.addWindow({
              window: {
                type: "outline",
                "block-uid": pageUid,
              },
            });
          } else {
            console.warn(`Could not find page UID for: ${pageTitle}`);
          }
        } else {
          // Regular click: Add to included references filter
          handleIncludeReference(pageTitle);

          // Switch to results view if in chat-only mode
          if (chatOnlyMode) {
            handleChatOnlyToggle();
          }
        }
      }
    };

    // Add both hover and click listeners to the messages container
    if (messagesContainerRef.current) {
      messagesContainerRef.current.addEventListener(
        "mouseover",
        handleBlockRefHover
      );
      messagesContainerRef.current.addEventListener(
        "click",
        handleBlockRefClick
      );
    }

    // Cleanup
    return () => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.removeEventListener(
          "mouseover",
          handleBlockRefHover
        );
        messagesContainerRef.current.removeEventListener(
          "click",
          handleBlockRefClick
        );
      }
    };
  }, [chatMessages]); // Re-attach when messages change

  // Function to highlight and scroll to a result by UID (with cross-page navigation)
  const highlightAndScrollToResult = (blockUid: string) => {
    // Find the result in either selectedResults or allResults
    const allAvailableResults =
      selectedResults.length > 0 ? selectedResults : allResults;
    const targetResultIndex = allAvailableResults.findIndex(
      (result) => result.uid === blockUid
    );

    if (targetResultIndex === -1) {
      console.warn(`Block ${blockUid} not found in current results`);
      return;
    }

    // Calculate which page the target result is on
    const targetPage = Math.floor(targetResultIndex / resultsPerPage) + 1;

    // Always check if the block is actually visible in DOM first
    const blockAlreadyVisible = document.querySelector(
      `.full-results-result-item[data-uid="${blockUid}"]`
    );

    if (blockAlreadyVisible) {
      highlightElementOnCurrentPage(blockUid);
    } else {
      // Force navigation regardless of state (since state might be wrong)
      setPendingHighlight(blockUid);

      // Force re-render: briefly set to a different page, then to target page
      const tempPage = targetPage === 1 ? 2 : 1;
      setCurrentPage(tempPage);

      // Small delay then set to actual target page
      setTimeout(() => {
        setCurrentPage(targetPage);
      }, 10);
    }
  };

  // Helper function to highlight element on the current page
  const highlightElementOnCurrentPage = (blockUid: string) => {
    // Find target element for highlighting
    const allResultItems = document.querySelectorAll(
      ".full-results-result-item"
    );

    const targetElement = document.querySelector(
      `.full-results-result-item[data-uid="${blockUid}"]`
    ) as HTMLElement;

    if (targetElement) {
      // Remove any existing highlights first
      document.querySelectorAll(".highlighted-result").forEach((el) => {
        el.classList.remove("highlighted-result");
      });

      // Add temporary highlight
      targetElement.classList.add("highlighted-result");

      // Scroll to the element
      targetElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      // Remove highlight after 3 seconds
      setTimeout(() => {
        targetElement?.classList.remove("highlighted-result");
      }, 3000);
    } else {
      console.warn(
        `❌ DOM element for block ${blockUid} not found on current page`
      );
    }
  };
  const [chatMode] = useState<ChatMode>("simple"); // TODO: Future evolution - Chat Mode vs Deep Analysis
  const [hasExpandedResults, setHasExpandedResults] = useState(false); // Track if agent found additional results during conversation
  const [lastSelectedResultIds, setLastSelectedResultIds] = useState<string[]>(
    []
  ); // Track result selection changes
  const [selectedModel, setSelectedModel] = useState<string>(
    initialChatModel || defaultModel
  );
  const [modelTokensLimit, setModelTokensLimit] = useState<number>(
    modelAccordingToProvider(initialChatModel || defaultModel).tokensLimit ||
      128000
  );

  // Calculate total tokens used in the conversation
  const { totalIn, totalOut } = React.useMemo(
    () => calculateTotalTokens(chatMessages),
    [chatMessages]
  );

  // Reset cache when chat is closed/reopened
  useEffect(() => {
    if (!isOpen) {
      setChatExpandedResults(null);
      setLastSelectedResultIds([]);
    }
  }, [isOpen, setChatExpandedResults]);

  // Update tokensLimit when model is changed
  useEffect(() => {
    setModelTokensLimit(
      modelAccordingToProvider(selectedModel).tokensLimit || 32000
    );
  }, [selectedModel]);

  const getSelectedResultsForChat = () => {
    // Create copies to prevent mutation of shared objects from parent component
    const results = selectedResults.length > 0 ? selectedResults : allResults;
    return results.map((result) => ({ ...result }));
  };

  const resetChat = () => {
    setChatMessages([]);
    setChatAgentData(null);
    setChatExpandedResults(null);
    setLastSelectedResultIds([]);
    setHasExpandedResults(false);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  const insertConversationInRoam = async () => {
    if (!targetUid) {
      console.log("targetUid :>> ", targetUid);
      targetUid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
      if (!targetUid) {
        targetUid = await insertBlockInCurrentView("");
      }
    }

    try {
      // Get only NEW messages (exclude initial messages that came from Roam)
      const newMessages = chatMessages.slice(initialMessagesCountRef.current);

      if (newMessages.length === 0) {
        AppToaster.show({
          message:
            "No new messages to insert. All messages were already in Roam.",
          timeout: 6000,
        });
        return;
      }

      // If this is the first insertion (entire conversation), generate a title
      const isFirstInsertion = initialMessagesCountRef.current === 0;

      if (isFirstInsertion) {
        // Create a summary of the conversation for the LLM (first 50 chars of each message)
        const conversationSummary = newMessages
          .map((msg, idx) => {
            const roleLabel = msg.role === "user" ? "User" : "Assistant";
            const content = msg.content || "";
            const snippet = content.substring(0, 50).replace(/\n/g, " ");
            return `${idx + 1}. ${roleLabel}: ${snippet}...`;
          })
          .join("\n");

        console.log("conversationSummary :>> ", conversationSummary);

        const titlePrompt = `Based on this conversation summary, generate a very short (max 15 words) descriptive title starting with "Chat with ${chatRoles.assistant} about". Be concise and specific.\n\nConversation:\n${conversationSummary}`;

        // Generate title using insertCompletion
        // Type assertion needed because insertCompletion has many optional parameters
        await (insertCompletion as any)({
          instantModel: selectedModel,
          prompt: titlePrompt,
          targetUid,
          target: "replace",
          isButtonToInsert: false,
        });
      }

      // Build formatted conversation text with role prefixes (only for new messages)
      // If a message has multiple paragraphs, format them as children blocks
      let conversationText = "";
      newMessages.forEach((msg) => {
        const rolePrefix =
          msg.role === "user" ? chatRoles.user : chatRoles.assistant;

        // Ensure content exists
        const messageContent = msg.content || "";

        // Split content by double newlines (paragraph separator)
        const paragraphs = messageContent
          .split(/\n\n+/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        if (paragraphs.length > 1) {
          // Multiple paragraphs: create hierarchical structure
          conversationText += `${rolePrefix}\n`;
          paragraphs.forEach((paragraph) => {
            conversationText += `  - ${paragraph}\n`;
          });
          conversationText += "\n";
        } else {
          // Single paragraph: inline format
          conversationText += `${rolePrefix}${messageContent}\n\n`;
        }
      });

      // Remove trailing newlines
      conversationText = conversationText.trim();

      // Insert using parseAndCreateBlocks (as children if first insertion, otherwise siblings)
      await parseAndCreateBlocks(targetUid, conversationText, false);

      // Update the count to reflect that these messages are now in Roam
      // This prevents re-inserting the same messages if the button is clicked again
      initialMessagesCountRef.current = chatMessages.length;
    } catch (error) {
      console.error("Failed to insert conversation in Roam:", error);
      alert("❌ Failed to insert conversation. Check console for details.");
    }
  };

  const copyAssistantMessage = async (messageContent: string) => {
    // Remove HTML tags for clean text copy
    const cleanText = messageContent
      .replace(/<[^>]*>/g, "")
      .replace(/&[^;]+;/g, " ")
      .trim();
    await copyToClipboard(cleanText);
  };

  const copyFullConversation = async () => {
    const conversationText = chatMessages
      .map((msg, index) => {
        const cleanContent = msg.content
          .replace(/<[^>]*>/g, "")
          .replace(/&[^;]+;/g, " ")
          .trim();
        const role = msg.role === "user" ? "You" : "Assistant";
        const timestamp = msg.timestamp.toLocaleString();
        return `${index + 1}. ${role} (${timestamp}):\n${cleanContent}`;
      })
      .join("\n\n---\n\n");

    const header = `Chat conversation about ${
      getSelectedResultsForChat().length
    } search results\nExported: ${new Date().toLocaleString()}\n\n`;
    await copyToClipboard(header + conversationText);
  };

  const handleModelSelection = async ({ model }) => {
    setSelectedModel(model);
    setIsModelMenuOpen(false); // Close the popover after selection
  };

  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);

  // Handler for loading a chat history from [[liveai/chat]] blocks
  const handleLoadChatHistory = (chatUid: string) => {
    try {
      const conversation = extractConversationFromLiveAIChat(chatUid);

      if (!conversation || conversation.length === 0) {
        AppToaster.show({
          message: "No conversation found in this chat block",
          intent: "warning",
          timeout: 3000,
        });
        return;
      }

      // Check if last message is from user - if so, put it in the input field
      const lastMessage = conversation[conversation.length - 1];
      const isLastMessageFromUser = lastMessage?.role === "user";

      if (isLastMessageFromUser && conversation.length > 1) {
        // Put last user message in input field
        setChatInput(lastMessage.content);

        // Load all previous messages into chat history
        const previousMessages = conversation
          .slice(0, -1)
          .map((msg) => ({
            role: msg.role,
            content: msg.content,
            timestamp: new Date(),
          }));

        setChatMessages(previousMessages);
        initialMessagesCountRef.current = previousMessages.length;
      } else {
        // Load all messages into chat history
        const allMessages = conversation.map((msg) => ({
          role: msg.role,
          content: msg.content,
          timestamp: new Date(),
        }));

        setChatMessages(allMessages);
        initialMessagesCountRef.current = allMessages.length;
        setChatInput("");
      }

      // Reset agent data when loading a new conversation
      setChatAgentData(null);
      setChatExpandedResults(null);
      setLastSelectedResultIds([]);
      setHasExpandedResults(false);

      AppToaster.show({
        message: `Loaded conversation with ${conversation.length} messages`,
        intent: "success",
        timeout: 3000,
      });
    } catch (error) {
      console.error("Error loading chat history:", error);
      AppToaster.show({
        message: "Failed to load chat history",
        intent: "danger",
        timeout: 3000,
      });
    }
  };

  const handleChatSubmit = async () => {
    if (!chatInput.trim() || isTyping) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: chatInput.trim(),
      timestamp: new Date(),
    };

    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setIsTyping(true);
    setIsStreaming(true);
    setStreamingContent("");

    try {
      const contextResults = getSelectedResultsForChat();
      await processChatMessage(userMessage.content, contextResults);
    } catch (error) {
      console.error("Chat error:", error);
      const errorMessage: ChatMessage = {
        role: "assistant",
        content:
          "Sorry, I encountered an error processing your request. Please try again.",
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    }

    setIsTyping(false);
    setIsStreaming(false);
    setStreamingContent("");
  };

  const processChatMessage = async (
    message: string,
    contextResults: Result[]
  ) => {
    try {
      console.log("🔍 Processing chat message with search agent");
      console.log(`💬 Access mode: ${chatAccessMode}, using simple chat mode`);

      // Check if result selection has changed
      const currentResultIds = contextResults
        .map((r) => r.uid || r.pageUid || r.pageTitle)
        .filter(Boolean);
      const selectionChanged =
        JSON.stringify(currentResultIds.sort()) !==
        JSON.stringify(lastSelectedResultIds.sort());

      let resultsContext: string;

      let expandedResults: Result[];

      if (selectionChanged || !chatExpandedResults) {
        setLastSelectedResultIds(currentResultIds);

        // Perform expansion once and cache the expanded objects
        // Use proper expansion budgets based on access mode and model context window
        // expansionBudget is expressed in approx. maximum characters
        const expansionBudget =
          chatAccessMode === "Full Access"
            ? modelTokensLimit * 3
            : modelTokensLimit * 2; //  ~75% context window vs ~50% context window
        expandedResults = await performAdaptiveExpansion(
          contextResults.map((result) => ({ ...result })), // Pass deep copies to prevent any mutation
          // [...contextResults],
          expansionBudget,
          0,
          chatAccessMode // Pass access mode to influence depth strategy
        );
        setChatExpandedResults(expandedResults);
      } else {
        // Reuse cached expanded objects
        expandedResults = chatExpandedResults;
      }

      // Build string context from expanded objects (only when needed for prompts)
      resultsContext = expandedResults
        .map((result, index) => {
          const parts = [];
          const isPage = !result.pageUid; // Pages don't have pageUid property

          // UID (always present)
          if (result.uid) parts.push(`UID: ${result.uid}`);

          // Content first (most important)
          if (result.expandedBlock?.original || result.content) {
            const content = result.expandedBlock?.original || result.content;
            parts.push(`Content: ${content}`);
          } else {
            parts.push(`Content: [Content not available]`);
          }

          // Location info differs between pages and blocks
          if (isPage) {
            // For pages: just indicate it's a page
            if (result.pageTitle) parts.push(`Page: [[${result.pageTitle}]]`);
          } else {
            // For blocks: show which page they're in
            if (result.pageTitle)
              parts.push(`In page: [[${result.pageTitle}]]`);
          }

          // Parent info (only for blocks that have parent context)
          if (result.expandedBlock?.parent) {
            parts.push(`Parent: ${result.expandedBlock.parent}`);
          }

          // Children info (if available)
          if (result.expandedBlock?.childrenOutline) {
            parts.push(`Children:\n${result.expandedBlock.childrenOutline}`);
          }

          // Timestamps
          if (result.created) parts.push(`Created: ${result.created}`);
          if (result.modified) parts.push(`Modified: ${result.modified}`);

          if (result.metadata?.contextExpansion) {
            console.log(
              `📝 [Chat] Result ${index + 1} expanded: ${
                result.metadata.originalLength
              } → ${result.metadata.expandedLength} chars`
            );
          }

          return `Result ${index + 1}:\n${parts.join("\n")}`;
        })
        .join("\n\n---\n\n");

      console.log("Exact context used for the chat: ", resultsContext);

      // Build conversation history from chat messages
      const currentConversationHistory = buildConversationHistory(chatMessages);

      // For popup execution with conversation history, don't duplicate results in the prompt
      // The agent's system prompt already includes the results context
      const hasConversationHistory = currentConversationHistory.length > 0;

      // ALWAYS build the full system prompt with context - never just the user message
      // The user message will be passed separately as the user message
      const selectionChangeNotice = selectionChanged
        ? `\n🔄 IMPORTANT: The user has changed their result selection since the last message. The results below represent the NEW selection.\n`
        : ``;

      const chatPrompt = `You are an intelligent assistant analyzing search results extracted from a Roam Research graph databae. The user can already see the raw content and metadata - your job is to provide INSIGHTS, ANALYSIS, and UNDERSTANDING.${selectionChangeNotice}

SEARCH RESULTS DATA:
${resultsContext}

🎯 YOUR ROLE - PROVIDE VALUE BEYOND RAW DATA:
- **Focus on the user request in its last message** to provide the most relevant response as possible
- **DON'T repeat** content/metadata the user already sees
- **Focus on** what the content MEANS, not what it SAYS
- **Use the full context** - leverage parent blocks, page context, and children to understand meaning
- **Identify** relationships, contradictions, common themes, or missing pieces
- **Be analytical** - help the user understand significance and context

${
  chatMode === "agent"
    ? `🔍 DEEP ANALYSIS MODE:
- Analyze the provided content first, then search only if you need additional context
- When searching: use specific UIDs, purpose: "completion" for expanding context
- Use fromResultId: "external_context_001" to reference the provided results
- Focus on synthesis and deeper understanding`
    : ``
}

RESPONSE GUIDELINES:
- **Be concise and focused** - 2-3 key insights, not lengthy explanations (unless user asks for detail)
- **Conversational and insightful** - like a thoughtful colleague reviewing the data
- **Leverage hierarchical context** - use Parent context, Children outline, and Page context to understand each block's true meaning and purpose
- **Reference specific blocks** - ALWAYS use strict '((uid))' syntax when mentioning content from blocks (CRITICAL: always DOUBLE parentheses). For single block: '((uid))' or make a short part of your response a link to the source block using this syntax: '[part of your reponse](((uid)))', for multiple blocks: '[source blocks: ((uid1)), ((uid2)), ((uid3))]'.
- **Reference pages** - Always use the syntax '[[page title]]' or #tag (where tag is a page title without space) when you have to mention page titles.

Remember: The user wants concise understanding and analysis, not lengthy recaps. Use the rich context (parent/children/page) to truly understand what each block represents.`;

      // Prepare agent data with conversation state
      // Let the agent's built-in conversation management handle history and summarization
      // We just pass the current agentData which contains the conversation state

      // For chat mode, we don't need to create blocks in Roam
      // The chat is self-contained in the popup interface
      let chatRootUid = targetUid;
      if (!chatRootUid) {
        // Use a dummy UID since we won't be writing to Roam in chat mode
        chatRootUid = "chat-session-" + Date.now();
      }

      // Debug what we're passing to the agent
      console.log(`💬 [Chat] Passing agent data:`, {
        hasAgentData: !!chatAgentData,
        chatMessagesCount: chatMessages.length,
        conversationHistoryFromChat: currentConversationHistory,
        conversationHistoryLength: currentConversationHistory.length,
        agentConversationSummary: chatAgentData?.conversationSummary,
      });

      // Build the agent state object with embedded external context using expanded results
      const previousAgentState = {
        ...chatAgentData, // Include any previous agent state from the search agent (results, etc.) FIRST
        // Then override with popup-specific conversation state
        isConversationMode: true,
        conversationHistory: currentConversationHistory, // Use chat messages directly - this will override any stale conversationHistory from agentData
        conversationSummary:
          chatMessages.length > 0
            ? `Chatting about ${contextResults.length} search results${
                selectionChanged ? " (result selection changed)" : ""
              }`
            : undefined,
        // For popup execution, clear any conflicting internal caches to ensure our expanded results are used
        cachedFullResults: {}, // Clear to avoid duplicate context in system prompts
        toolResultsCache: {}, // Clear to avoid stale tool results
        // Embed external context directly in agent data - ALWAYS use expanded results for agent processing
        externalContext: {
          results: expandedResults, // Use the expanded objects with rich content
          contextType: "search_results" as const,
          description: `Search results being discussed (${expandedResults.length} items with expanded content)`,
        },
      };

      console.log(
        `📝 [Chat] Agent will receive ${
          expandedResults.length
        } expanded results with avg ${Math.round(
          expandedResults.reduce(
            (sum, r) => sum + (r.content?.length || 0),
            0
          ) / expandedResults.length
        )} chars per result`
      );

      // Debug agent state for resultStore issues
      if (
        chatMessages.length > 0 &&
        (!previousAgentState.resultStore ||
          Object.keys(previousAgentState.resultStore).length === 0)
      ) {
        console.log(
          `⚠️ [Chat] Turn ${chatMessages.length}: Missing resultStore in previousAgentState`
        );
      }

      const agentOptions = {
        model: selectedModel,
        rootUid: chatRootUid,
        targetUid: undefined, // Chat mode doesn't write to Roam
        target: "new",
        prompt: message, // The actual user message
        permissions: { contentAccess: chatAccessMode === "Full Access" },
        privateMode: chatAccessMode === "Balanced",
        // Enable direct chat mode to bypass RequestAnalyzer
        isDirectChat: true,
        // Enable popup execution to skip block creation and insertion
        isPopupExecution: true,
        // Provide streaming callback for chat interface
        streamingCallback: (content: string) => {
          setStreamingContent((prev) => prev + content);
        },
        // Pass the existing agent data which contains conversation state and external context
        // For popup execution, build conversation history directly from chat messages
        previousAgentState,
        // IMPORTANT: chatSystemPrompt must come AFTER previousAgentState to avoid being overwritten
        chatSystemPrompt: chatPrompt, // The system prompt for popup execution - always fresh
      };

      const agentResult = await invokeSearchAgent(agentOptions);

      // Debug token usage
      console.log(
        "🔍 [Chat] Agent result tokensUsage:",
        agentResult.tokensUsage
      );

      // Update agent data for next conversation turn and extract any new results
      const newAgentData = {
        toolResultsCache: agentResult.toolResultsCache,
        cachedFullResults: agentResult.cachedFullResults,
        hasLimitedResults: agentResult.hasLimitedResults,
        resultSummaries: agentResult.resultSummaries,
        resultStore: agentResult.resultStore,
        nextResultId: agentResult.nextResultId,
        // IMPORTANT: Include conversation state for next turn
        conversationHistory: agentResult.conversationHistory,
        conversationSummary: agentResult.conversationSummary,
        exchangesSinceLastSummary: agentResult.exchangesSinceLastSummary,
        isConversationMode: agentResult.isConversationMode,
        // CRITICAL: Do NOT persist chatSystemPrompt - it should be freshly generated each turn
        // chatSystemPrompt should never be carried over from previous turns
      };

      setChatAgentData(newAgentData);

      // Debug conversation state
      console.log(`💬 [Chat] Agent returned conversation state:`, {
        hasConversationHistory: !!agentResult.conversationHistory,
        conversationHistoryLength: agentResult.conversationHistory?.length || 0,
        hasSummary: !!agentResult.conversationSummary,
        conversationSummary: agentResult.conversationSummary,
      });

      // Log live result updates for debugging
      const previousResultCount = Object.keys(
        chatAgentData?.resultStore || {}
      ).length;
      const newResultCount = Object.keys(agentResult.resultStore || {}).length;

      if (newResultCount > previousResultCount) {
        console.log(
          `🔄 Live results updated: ${
            newResultCount - previousResultCount
          } new result sets added during conversation`
        );
        setHasExpandedResults(true);

        // Count total expanded results
        const expandedResults = [];
        if (agentResult.resultStore) {
          Object.values(agentResult.resultStore).forEach((resultEntry: any) => {
            if (
              resultEntry &&
              resultEntry.data &&
              Array.isArray(resultEntry.data)
            ) {
              expandedResults.push(
                ...resultEntry.data.filter(
                  (r: any) => r && (r.uid || r.pageUid || r.pageTitle)
                )
              );
            }
          });
        }

        console.log(
          `🔍 Chat conversation now has access to ${
            expandedResults.length
          } total results (${contextResults.length} original + ${
            expandedResults.length - contextResults.length
          } new)`
        );

        // TODO: Could emit an event to parent component about expanded results
        // This would allow FullResultsPopup to update its result count or show new results
      }

      const aiResponse =
        agentResult.finalAnswer ||
        "I couldn't analyze the results. Please try rephrasing your question.";

      // Finalize streaming content or use the final answer
      const finalContent = streamingContent || aiResponse;
      setIsStreaming(false);
      setStreamingContent("");

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: finalContent,
        timestamp: new Date(),
        tokensIn: agentResult.tokensUsage?.input_tokens,
        tokensOut: agentResult.tokensUsage?.output_tokens,
      };

      // Update chat messages first - use functional update to avoid stale closure
      let updatedChatMessages: ChatMessage[] = [];
      setChatMessages((prevMessages) => {
        updatedChatMessages = [...prevMessages, assistantMessage];
        return updatedChatMessages;
      });

      // The agent's built-in conversation management will handle history and summarization automatically
      // We just need to preserve the agent state for the next turn
    } catch (error) {
      console.error("Chat processing error:", error);
      setIsStreaming(false);
      setStreamingContent("");
      const errorMessage: ChatMessage = {
        role: "assistant",
        content:
          "I encountered an error processing your request. Please try again.",
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="full-results-chat-panel">
      <div className="full-results-chat-header">
        <div className="full-results-chat-info">
          <div className="full-results-chat-info-text">
            <span>
              {selectedResults.length > 0 ? (
                <>Chatting about {selectedResults.length} selected results</>
              ) : (
                <>Chatting about {allResults.length} visible results</>
              )}
              {(totalIn > 0 || totalOut > 0) && (
                <span className="full-results-chat-total-tokens">
                  {" "}
                  • Total tokens: {totalIn.toLocaleString()} in,{" "}
                  {totalOut.toLocaleString()} out
                </span>
              )}
            </span>
          </div>
          <div className="full-results-chat-header-controls">
            {hasExpandedResults && (
              <Tooltip content="Results expanded during conversation">
                <span className="full-results-chat-expansion-badge">
                  <Icon icon="trending-up" size={12} />
                </span>
              </Tooltip>
            )}
            <Tooltip content="Load chat history from [[liveai/chat]] blocks">
              <ChatHistorySelect
                onChatSelect={handleLoadChatHistory}
                disabled={isTyping}
              />
            </Tooltip>
            {chatMessages.length > 0 && (
              <>
                {
                  <Tooltip content="Insert conversation in Roam at focused block or append to current page/daily note">
                    <Button
                      icon="insert"
                      onClick={insertConversationInRoam}
                      minimal
                      small
                      intent="success"
                    />
                  </Tooltip>
                }
                <Tooltip content="Copy full conversation to clipboard">
                  <Button
                    icon="clipboard"
                    onClick={copyFullConversation}
                    minimal
                    small
                  />
                </Tooltip>
                <Tooltip content="Reset chat conversation">
                  <Button icon="trash" onClick={resetChat} minimal small />
                </Tooltip>
              </>
            )}
          </div>
        </div>
        {privateMode && (
          <div className="full-results-chat-warning">
            🔒 Limited functionality in Private mode
          </div>
        )}
      </div>

      <div className="full-results-chat-messages" ref={messagesContainerRef}>
        {chatMessages.length === 0 ? (
          <div className="full-results-chat-welcome">
            <div className="full-results-chat-assistant-avatar">🤖</div>
            <div className="full-results-chat-assistant-message">
              Hi! I can help you analyze and understand your search results.
              What would you like to know?
              <div className="full-results-chat-suggestions">
                <button
                  onClick={() =>
                    setChatInput(
                      "Give me a short, clear summary of these results highlighting the most important points"
                    )
                  }
                >
                  Summarize
                </button>
                <button
                  onClick={() =>
                    setChatInput(
                      "What are the key insights and takeaways from these results?"
                    )
                  }
                >
                  Key insights
                </button>
                <button
                  onClick={() =>
                    setChatInput(
                      "What connections exist between these items? Look for page references, tags, block references, and thematic links"
                    )
                  }
                >
                  Find connections
                </button>
                <button
                  onClick={() =>
                    setChatInput(
                      "Help me find specific information about [topic] that might be buried in these results"
                    )
                  }
                >
                  Retrieval
                </button>
                <button
                  onClick={() =>
                    setChatInput(
                      "What patterns or recurring themes can you extract from these results?"
                    )
                  }
                >
                  Extract patterns
                </button>
                {/* TODO: Future evolution - Deep Analysis mode
                {chatMode === "agent" && (
                  <button
                    onClick={() =>
                      setChatInput(
                        "Can you find related results that might expand on these topics?"
                      )
                    }
                  >
                    <Icon icon="search" size={12} style={{marginRight: '4px'}} />Expand results
                  </button>
                )}
                */}
              </div>
              <div className="full-results-chat-feature-hint">
                <strong>
                  {(chatAccessMode === "Balanced" ? "🛡️ " : "🔓 ") +
                    chatAccessMode}
                </strong>{" "}
                mode:{" "}
                {chatAccessMode === "Balanced"
                  ? `2 children levels maximum in blocks, 4 levels in pages, and context limited to ${Math.floor(
                      (modelTokensLimit * 0.5) / 1000
                    )}k tokens (50% of model context window, approx. ${Math.floor(
                      (modelTokensLimit * 2) / 1000 / 6
                    )}k words)`
                  : `up to 4 children levels in blocks, full content of pages and broader context up to ${Math.floor(
                      (modelTokensLimit * 0.75) / 1000
                    )}k tokens (75% of model context window, approx. ${Math.floor(
                      (modelTokensLimit * 3) / 1000 / 6
                    )}k words)`}{" "}
                {/* TODO: Future evolution - Deep Analysis mode
                {chatMode === "agent" ? (
                  <>
                    💡 <strong>Deep Analysis mode</strong>: I'll analyze your
                    results first, then search for related content if needed!
                  </>
                ) : (
                  <>
                    💡 <strong>Chat mode</strong>: I'll focus on analyzing the
                    content you've selected without additional searches.
                  </>
                )}
                */}
              </div>
            </div>
          </div>
        ) : (
          chatMessages.map((message, index) => (
            <div
              key={index}
              className={`full-results-chat-message ${message.role}`}
            >
              <div className="full-results-chat-avatar">
                {message.role === "user" ? "👤" : "🤖"}
              </div>
              <div className="full-results-chat-content">
                <div
                  className="full-results-chat-text"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(message.content),
                  }}
                />
                <div className="full-results-chat-message-footer">
                  <span className="full-results-chat-timestamp">
                    {message.timestamp.toLocaleTimeString()}
                    {message.tokensIn !== undefined &&
                      message.tokensOut !== undefined && (
                        <span className="full-results-chat-tokens">
                          {" "}
                          • Tokens in: {message.tokensIn.toLocaleString()}, out:{" "}
                          {message.tokensOut.toLocaleString()}
                        </span>
                      )}
                  </span>
                  {message.role === "assistant" && (
                    <span
                      className="full-results-chat-copy-link"
                      title="Copy message to clipboard"
                    >
                      <Tooltip content="Copy message to clipboard">
                        <Button
                          icon="clipboard"
                          onClick={() => copyAssistantMessage(message.content)}
                          minimal
                          small
                        />
                      </Tooltip>
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}

        {(isTyping || isStreaming) && (
          <div className="full-results-chat-message assistant">
            <div className="full-results-chat-avatar">🤖</div>
            <div className="full-results-chat-content">
              {isStreaming && streamingContent ? (
                <div
                  className="full-results-chat-text streaming"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(streamingContent),
                  }}
                />
              ) : (
                <div className="full-results-chat-typing">Thinking...</div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="full-results-chat-input-area">
        <div className="full-results-chat-controls">
          <div className="full-results-chat-access-mode">
            <HTMLSelect
              minimal={true}
              value={chatAccessMode}
              onChange={(e) =>
                setChatAccessMode(e.target.value as "Balanced" | "Full Access")
              }
              options={[
                { label: "🛡️ Balanced", value: "Balanced" },
                { label: "🔓 Full Access", value: "Full Access" },
              ]}
            />
          </div>
          <div className="full-results-chat-model-selector">
            <Popover
              isOpen={isModelMenuOpen}
              onInteraction={(nextOpenState) =>
                setIsModelMenuOpen(nextOpenState)
              }
              content={
                <ModelsMenu
                  callback={handleModelSelection}
                  setModel={setSelectedModel}
                  command={null}
                  prompt=""
                  isConversationToContinue={false}
                />
              }
              placement="top"
            >
              <Button
                minimal
                small
                icon="cog"
                text={selectedModel}
                title="Click to change AI model"
              />
            </Popover>
          </div>
        </div>

        {/* Future evolution: Chat Mode vs Deep Analysis - currently hidden
        <div className="full-results-chat-mode-toggle" style={{display: 'none'}}>
          <label>
            <input
              type="radio"
              name="chatMode"
              value="simple"
              checked={true}
              readOnly
            />
            <Icon icon="chat" size={12} style={{marginRight: '4px'}} />Chat Mode (Focus on provided results)
          </label>
          <label>
            <input
              type="radio"
              name="chatMode"
              value="agent"
              checked={false}
              disabled
            />
            <Icon icon="search" size={12} style={{marginRight: '4px'}} />Deep Analysis (Can explore with search tools)
          </label>
        </div>
        */}

        <div className="full-results-chat-input-container">
          <TextArea
            inputRef={chatInputRef}
            placeholder="Ask me about your results..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && !e.shiftKey && handleChatSubmit()
            }
            disabled={isTyping}
            className="full-results-chat-input"
            autoResize={true}
            // rows={1}
            fill={true}
          />
          <Button
            icon="send-message"
            onClick={handleChatSubmit}
            disabled={!chatInput.trim() || isTyping}
            intent="primary"
            className="full-results-chat-send"
          />
        </div>
      </div>
    </div>
  );
};
