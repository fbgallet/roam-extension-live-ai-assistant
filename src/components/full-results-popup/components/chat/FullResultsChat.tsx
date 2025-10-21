import React, { useState, useRef, useEffect, useMemo } from "react";
import { invokeChatAgent } from "../../../../ai/agents/chat-agent/chat-agent-invoke";
import { Result, ChatMessage, ChatMode } from "../../types/types";
import { performAdaptiveExpansion } from "../../../../ai/agents/search-agent/helpers/contextExpansion";
import { extensionStorage, defaultModel, chatRoles } from "../../../..";
import {
  getBlockContentByUid,
  getPageUidByPageName,
  insertBlockInCurrentView,
} from "../../../../utils/roamAPI";
import { modelAccordingToProvider } from "../../../../ai/aiAPIsHub";
import { parseAndCreateBlocks } from "../../../../utils/format";
import { insertCompletion } from "../../../../ai/responseInsertion";
import { AppToaster } from "../../../Toaster";
import { extractConversationFromLiveAIChat } from "../../index";
import { getChatTitleFromUid } from "../../utils/chatStorage";
import { calculateTotalTokens } from "../../utils/chatMessageUtils";
import { ChatHeader } from "./ChatHeader";
import { ChatMessagesDisplay } from "./ChatMessagesDisplay";
import { ChatInputArea } from "./ChatInputArea";

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
  // Loaded chat UID (when opened via [[liveai/chat]])
  initialLoadedChatUid?: string;
  // Command context for enriching chat prompts
  initialStyle?: string;
  initialCommandId?: number;
  initialCommandPrompt?: string;
}

// Utility functions moved to ./utils/chatMessageUtils.ts

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
  initialLoadedChatUid,
  initialStyle,
  initialCommandId,
  initialCommandPrompt,
}) => {
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [loadedChatTitle, setLoadedChatTitle] = useState<string | null>(null);
  const [loadedChatUid, setLoadedChatUid] = useState<string | null>(null);
  const [currentToolUsage, setCurrentToolUsage] = useState<string | null>(null);

  // Track command context for auto-execution
  const [commandContext, setCommandContext] = useState<{
    commandPrompt?: string;
    commandName?: string;
    style?: string;
  } | null>(null);

  // Track the number of initial messages loaded from Roam
  // This helps us exclude them when inserting the conversation back
  const initialMessagesCountRef = useRef<number>(0);
  const hasAutoExecutedRef = useRef(false); // Prevent double execution

  // Initialize chat from provided initial state
  useEffect(() => {
    console.log("🔍 FullResultsChat initializing with:", {
      initialChatMessages,
      initialChatPrompt,
      initialLoadedChatUid,
      initialCommandPrompt,
      initialCommandId,
      initialStyle,
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
      console.log(
        "📝 Setting chat input:",
        initialChatPrompt,
        "type:",
        typeof initialChatPrompt
      );
      // Ensure initialChatPrompt is a string
      const promptString =
        typeof initialChatPrompt === "string"
          ? initialChatPrompt
          : String(initialChatPrompt || "");
      setChatInput(promptString);
    }
    // If initialLoadedChatUid is provided, set the loaded chat info
    if (initialLoadedChatUid) {
      console.log("📝 Setting loaded chat UID:", initialLoadedChatUid);
      setLoadedChatUid(initialLoadedChatUid);
      const title = getChatTitleFromUid(initialLoadedChatUid);
      setLoadedChatTitle(title);
    }

    // Initialize command context if provided
    if (initialCommandPrompt || initialCommandId || initialStyle) {
      // Get command name from BUILTIN_COMMANDS
      let commandName = "Custom Command";
      if (initialCommandId) {
        // Import BUILTIN_COMMANDS to get the command name
        import("../../../../ai/prebuildCommands").then(
          ({ BUILTIN_COMMANDS }) => {
            const command = BUILTIN_COMMANDS.find(
              (cmd) => cmd.id === initialCommandId
            );
            if (command) {
              commandName = command.name;
            }

            console.log("📝 Setting command context:", {
              commandPrompt: initialCommandPrompt,
              commandName,
              style: initialStyle,
            });

            setCommandContext({
              commandPrompt: initialCommandPrompt,
              commandName,
              style: initialStyle,
            });
          }
        );
      } else {
        setCommandContext({
          commandPrompt: initialCommandPrompt,
          commandName,
          style: initialStyle,
        });
      }
    }
  }, [
    initialChatMessages,
    initialChatPrompt,
    initialLoadedChatUid,
    initialCommandPrompt,
    initialCommandId,
    initialStyle,
  ]);

  // Auto-execute command when chat opens with command context
  useEffect(() => {
    const autoExecuteCommand = async () => {
      // Only execute once
      if (hasAutoExecutedRef.current) return;

      // Need command context and at least one user message
      if (!commandContext || !commandContext.commandPrompt) return;
      if (chatMessages.length === 0) return;

      // Check if last message is from user
      const lastMessage = chatMessages[chatMessages.length - 1];
      if (lastMessage.role !== "user") return;

      console.log("🚀 Auto-executing command:", commandContext);
      hasAutoExecutedRef.current = true;

      // Trigger the chat submission with the user's message
      setIsTyping(true);
      setIsStreaming(true);
      setStreamingContent("");
      setCurrentToolUsage(null);

      try {
        const contextResults = getSelectedResultsForChat();
        await processChatMessageWithCommand(
          lastMessage.content,
          contextResults,
          commandContext.commandPrompt,
          commandContext.style
        );
      } catch (error) {
        console.error("Auto-execution error:", error);
        const errorMessage: ChatMessage = {
          role: "assistant",
          content:
            "Sorry, I encountered an error processing your request with the command. Please try again.",
          timestamp: new Date(),
        };
        setChatMessages((prev) => [...prev, errorMessage]);
      }

      setIsTyping(false);
      setIsStreaming(false);
      setStreamingContent("");
      setCurrentToolUsage(null);
    };

    if (isOpen && commandContext) {
      autoExecuteCommand();
    }
  }, [isOpen, commandContext, chatMessages]);

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
        } else if (event.altKey || event.metaKey) {
          // Alt/Option+click: Open in main window
          window.roamAlphaAPI.ui.mainWindow.openBlock({
            block: { uid: blockUid },
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
        } else if (event.altKey || event.metaKey) {
          // Alt/Option+click: Open page in main window
          const pageUid = getPageUidByPageName(pageTitle);
          if (pageUid) {
            window.roamAlphaAPI.ui.mainWindow.openPage({
              page: { uid: pageUid },
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
  const [chatMode, setChatMode] = useState<ChatMode>("simple");
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
    setLoadedChatTitle(null);
    setLoadedChatUid(null);
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

        const titlePrompt = `Based on this conversation summary, generate a very short (max 15 words) descriptive title starting with "Chat with ${chatRoles.assistant}" and ending with "#liveai/chat". Be concise and specific.\n\nConversation:\n${conversationSummary}`;

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

  // Model selection is now handled by ChatInputArea component

  // Handler for clicking on loaded chat title to open the block
  const handleLoadedChatClick = (event: React.MouseEvent) => {
    event.preventDefault();
    if (!loadedChatUid) return;

    // Copy ((uid)) to clipboard
    const clipboardText = `((${loadedChatUid}))`;
    navigator.clipboard
      .writeText(clipboardText)
      .then(() => {})
      .catch((err) => {
        console.warn("Failed to copy to clipboard:", err);
      });

    if (event.shiftKey) {
      // Shift+click: Open in sidebar
      window.roamAlphaAPI.ui.rightSidebar.addWindow({
        window: { type: "block", "block-uid": loadedChatUid },
      });
    } else if (event.altKey || event.metaKey) {
      // Alt/Option+click: Open in main window
      window.roamAlphaAPI.ui.mainWindow.openBlock({
        block: { uid: loadedChatUid },
      });
    } else {
      // Regular click: Just copy to clipboard (already done above)
      AppToaster.show({
        message: `Copied ((${loadedChatUid})) to clipboard`,
        intent: "success",
        timeout: 2000,
      });
    }
  };

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

      // Get the chat title using the helper function
      const chatTitle = getChatTitleFromUid(chatUid);

      // Store the loaded chat info
      setLoadedChatTitle(chatTitle);
      setLoadedChatUid(chatUid);

      // Check if last message is from user - if so, put it in the input field
      const lastMessage = conversation[conversation.length - 1];
      const isLastMessageFromUser = lastMessage?.role === "user";

      if (isLastMessageFromUser && conversation.length > 1) {
        // Put last user message in input field
        setChatInput(lastMessage.content);

        // Load all previous messages into chat history
        const previousMessages = conversation.slice(0, -1).map((msg) => ({
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
    setCurrentToolUsage(null);

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
    setCurrentToolUsage(null);
  };

  const processChatMessage = async (
    message: string,
    contextResults: Result[],
    commandPromptFromCall?: string,
    styleFromCall?: string
  ) => {
    try {
      console.log(`💬 Access mode: ${chatAccessMode}, using new chat-agent`);

      // Check if result selection has changed
      const currentResultIds = contextResults
        .map((r) => r.uid || r.pageUid || r.pageTitle)
        .filter(Boolean);
      const selectionChanged =
        JSON.stringify(currentResultIds.sort()) !==
        JSON.stringify(lastSelectedResultIds.sort());

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
          expansionBudget,
          0,
          chatAccessMode // Pass access mode to influence depth strategy
        );
        setChatExpandedResults(expandedResults);

        // Log expansion details
        expandedResults.forEach((result, index) => {
          if (result.metadata?.contextExpansion) {
            console.log(
              `📝 [Chat] Result ${index + 1} expanded: ${
                result.metadata.originalLength
              } → ${result.metadata.expandedLength} chars`
            );
          }
        });
      } else {
        // Reuse cached expanded objects
        expandedResults = chatExpandedResults;
      }

      console.log(
        `📝 [Chat] Using ${
          expandedResults.length
        } expanded results with avg ${Math.round(
          expandedResults.reduce(
            (sum, r) => sum + (r.content?.length || 0),
            0
          ) / expandedResults.length
        )} chars per result`
      );

      // Build results description for context
      const resultsDescription = selectionChanged
        ? `🔄 IMPORTANT: The user has changed their result selection since the last message. The results below represent the NEW selection (${expandedResults.length} items).`
        : `You are analyzing search results extracted from a Roam Research graph database. The user can already see the raw content and metadata - your job is to provide INSIGHTS, ANALYSIS, and UNDERSTANDING.`;

      // Build conversation history from chat messages
      const currentConversationHistory = chatMessages.map((msg) => {
        const role = msg.role === "user" ? "User" : "Assistant";
        return `${role}: ${msg.content}`;
      });

      // Get command prompt if provided
      let commandPrompt: string | undefined = undefined;
      if (commandPromptFromCall) {
        const { completionCommands } = await import("../../../../ai/prompts");
        commandPrompt = completionCommands[commandPromptFromCall];
      }

      // Invoke the chat agent
      const agentResult = await invokeChatAgent({
        model: modelAccordingToProvider(selectedModel),
        userMessage: message,

        // Results context - pass the expanded results directly
        resultsContext: expandedResults,
        resultsDescription,

        // Configuration
        style: styleFromCall,
        commandPrompt: commandPrompt,
        toolsEnabled: chatMode === "agent", // Enable tools only in agent mode
        accessMode: chatAccessMode,
        isAgentMode: chatMode === "agent",

        // Permissions
        permissions: { contentAccess: chatAccessMode === "Full Access" },

        // Conversation state from previous turns
        conversationHistory: currentConversationHistory,
        conversationSummary: chatAgentData?.conversationSummary,
        exchangesSinceLastSummary:
          chatAgentData?.exchangesSinceLastSummary || 0,

        // Streaming
        streamingCallback: (content: string) => {
          setStreamingContent((prev) => prev + content);
        },

        // Tool usage callback
        toolUsageCallback: (toolName: string) => {
          setCurrentToolUsage(toolName);
        },

        // Token usage from previous turns
        tokensUsage: chatAgentData?.tokensUsage,
      });

      // Update agent data for next conversation turn
      const newAgentData = {
        conversationHistory: agentResult.conversationHistory,
        conversationSummary: agentResult.conversationSummary,
        exchangesSinceLastSummary: agentResult.exchangesSinceLastSummary,
        toolResultsCache: agentResult.toolResultsCache,
        tokensUsage: agentResult.tokensUsage,
      };

      setChatAgentData(newAgentData);

      // Debug conversation state
      console.log(`💬 [Chat] Agent returned conversation state:`, {
        conversationHistoryLength: agentResult.conversationHistory?.length || 0,
        hasSummary: !!agentResult.conversationSummary,
        tokensUsage: agentResult.tokensUsage,
      });

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

  // Process chat message with command context (for auto-execution)
  const processChatMessageWithCommand = async (
    message: string,
    contextResults: Result[],
    commandPromptKey?: string,
    styleKey?: string
  ) => {
    try {
      console.log("🎯 Executing with command instruction:", {
        commandPromptKey,
        styleKey,
      });

      // Call processChatMessage with command and style parameters
      // The chat agent will handle command prompt loading and application
      await processChatMessage(
        message,
        contextResults,
        commandPromptKey,
        styleKey
      );
    } catch (error) {
      console.error("Error processing command:", error);
      throw error;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="full-results-chat-panel">
      <ChatHeader
        selectedResults={selectedResults}
        allResults={allResults}
        totalIn={totalIn}
        totalOut={totalOut}
        hasExpandedResults={hasExpandedResults}
        chatMessages={chatMessages}
        loadedChatTitle={loadedChatTitle}
        loadedChatUid={loadedChatUid}
        privateMode={privateMode}
        isTyping={isTyping}
        onInsertConversation={insertConversationInRoam}
        onCopyFullConversation={copyFullConversation}
        onResetChat={resetChat}
        onLoadChatHistory={handleLoadChatHistory}
        onLoadedChatClick={handleLoadedChatClick}
      />

      <ChatMessagesDisplay
        chatMessages={chatMessages}
        commandContext={commandContext}
        isTyping={isTyping}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
        currentToolUsage={currentToolUsage}
        modelTokensLimit={modelTokensLimit}
        chatAccessMode={chatAccessMode}
        hasSearchResults={allResults.length > 0}
        onCopyMessage={copyAssistantMessage}
        onSuggestionClick={setChatInput}
        messagesContainerRef={messagesContainerRef}
      />

      <ChatInputArea
        chatInput={chatInput}
        onChatInputChange={setChatInput}
        onSubmit={handleChatSubmit}
        isTyping={isTyping}
        chatAccessMode={chatAccessMode}
        onAccessModeChange={setChatAccessMode}
        chatMode={chatMode}
        onChatModeChange={setChatMode}
        selectedModel={selectedModel}
        onModelSelect={setSelectedModel}
        chatInputRef={chatInputRef}
      />
    </div>
  );
};
