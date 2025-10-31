import React, { useState, useRef, useEffect, useMemo } from "react";
import { invokeChatAgent } from "../../../../ai/agents/chat-agent/chat-agent-invoke";
import { Result, ChatMessage, ChatMode } from "../../types/types";
import { performAdaptiveExpansion } from "../../../../ai/agents/search-agent/helpers/contextExpansion";
import {
  extensionStorage,
  defaultModel,
  defaultStyle,
  chatRoles,
  getInstantAssistantRole,
} from "../../../..";
import {
  getBlockContentByUid,
  getPageUidByPageName,
  insertBlockInCurrentView,
  createChildBlock,
  createSiblingBlock,
  hasBlockChildren,
  updateBlock,
} from "../../../../utils/roamAPI";
import { modelAccordingToProvider } from "../../../../ai/aiAPIsHub";
import { parseAndCreateBlocks } from "../../../../utils/format";
import { insertCompletion } from "../../../../ai/responseInsertion";
import { AppToaster } from "../../../Toaster";
import { extractConversationFromLiveAIChat } from "../../index";
import { getChatTitleFromUid } from "../../utils/chatStorage";
import {
  calculateTotalTokens,
  convertMarkdownToRoamFormat,
} from "../../utils/chatMessageUtils";
import { ChatHeader } from "./ChatHeader";
import { ChatMessagesDisplay } from "./ChatMessagesDisplay";
import { ChatInputArea } from "./ChatInputArea";
import { BUILTIN_COMMANDS } from "../../../../ai/prebuildCommands";
import { getOrderedCustomPromptBlocks } from "../../../../ai/dataExtraction";

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
  // Page autocomplete props
  availablePages: string[];
  isLoadingPages: boolean;
  queryAvailablePages: (query: string) => void;
  // Agent callbacks
  onAddResults: (results: Result[]) => void;
  onSelectResultsByUids: (uids: string[]) => void;
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
  availablePages,
  isLoadingPages,
  queryAvailablePages,
  onAddResults,
  onSelectResultsByUids,
}) => {
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [loadedChatTitle, setLoadedChatTitle] = useState<string | null>(null);
  const [loadedChatUid, setLoadedChatUid] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<string>(() => {
    // Load style from window object (whether pinned or not), or use initialStyle/defaultStyle
    const sessionStyle = (window as any).__currentChatStyle;
    return sessionStyle || initialStyle || defaultStyle || "Normal";
  });
  const [isPinnedStyle, setIsPinnedStyle] = useState<boolean>(() => {
    // Check if style is pinned in window object
    return !!(window as any).__pinnedChatStyle;
  });
  const [toolUsageHistory, setToolUsageHistory] = useState<
    Array<{
      toolName: string;
      details: string;
      response?: string; // Tool's response/feedback
      timestamp: number;
      intermediateMessage?: string;
    }>
  >([]);

  const targetRef = useRef<string | undefined>(targetUid);

  // Ref to track current context results for expansion callback
  // This allows the callback to access the latest results even during agent execution
  const currentContextResultsRef = useRef<Result[]>([]);

  // Ref to track current tool usage - avoids stale closure issues
  const toolUsageHistoryRef = useRef<
    Array<{
      toolName: string;
      details: string;
      response?: string;
      timestamp: number;
      intermediateMessage?: string;
    }>
  >([]);

  // Get custom style titles
  const customStyleTitles = useMemo(() => {
    try {
      if (typeof getOrderedCustomPromptBlocks === "function") {
        return getOrderedCustomPromptBlocks("liveai/style").map(
          (custom: any) => custom.content
        );
      }
    } catch (error) {
      console.warn("Failed to load custom styles:", error);
    }
    return [];
  }, []);

  // Track command context for auto-execution
  const [commandContext, setCommandContext] = useState<{
    commandPrompt?: string;
    commandName?: string;
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

      setChatMessages(messagesCopy);

      // Store count of initial messages to exclude from Roam insertion later
      initialMessagesCountRef.current = messagesCopy.length;
    }
    if (initialChatPrompt) {
      // Ensure initialChatPrompt is a string
      const promptString =
        typeof initialChatPrompt === "string"
          ? initialChatPrompt
          : String(initialChatPrompt || "");
      setChatInput(promptString);
    }
    // If initialLoadedChatUid is provided, set the loaded chat info
    if (initialLoadedChatUid) {
      setLoadedChatUid(initialLoadedChatUid);
      const title = getChatTitleFromUid(initialLoadedChatUid);
      setLoadedChatTitle(title);
    }

    // Initialize command context if provided
    let commandName: string;
    if (initialCommandPrompt || initialCommandId || initialStyle) {
      // Get command name from BUILTIN_COMMANDS
      if (initialCommandId) {
        const command = BUILTIN_COMMANDS.find(
          (cmd) => cmd.id === initialCommandId
        );
        if (command) {
          commandName = command.name;
        }

        setCommandContext({
          commandPrompt: initialCommandPrompt,
          commandName,
        });
      }
    } else {
      setCommandContext({
        commandPrompt: initialCommandPrompt,
        commandName,
      });
    }
    // }
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

      hasAutoExecutedRef.current = true;

      // Update the last message to include command info if it doesn't have it yet
      if (!lastMessage.commandName && commandContext?.commandName) {
        setChatMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...lastMessage,
            commandName: commandContext?.commandName,
            commandPrompt: commandContext?.commandPrompt,
          };
          return updated;
        });
      }

      // Trigger the chat submission with the user's message
      setIsTyping(true);
      setIsStreaming(true);
      setStreamingContent("");
      setToolUsageHistory([]);
      toolUsageHistoryRef.current = []; // Sync ref

      try {
        const contextResults = getSelectedResultsForChat();
        if (commandContext?.commandPrompt === "prompt") {
          await processChatMessage(
            lastMessage.content,
            contextResults,
            undefined,
            undefined,
            undefined,
            selectedStyle
          );
        } else
          await processChatMessageWithCommand(
            lastMessage.content,
            contextResults,
            commandContext?.commandPrompt,
            commandContext?.commandName,
            undefined,
            selectedStyle
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
      // Don't clear tool usage history - it should persist to show user what tools were used

      // Reset command context after processing
      setCommandContext(null);
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

  // Create lookup maps for performance optimization
  const { uidToIndexMap, pageTitleToIndexMap } = useMemo(() => {
    const allAvailableResults =
      selectedResults.length > 0 ? selectedResults : allResults;

    const uidMap = new Map<string, number>();
    const pageMap = new Map<string, number>();

    allAvailableResults.forEach((result, index) => {
      if (result.uid) {
        uidMap.set(result.uid, index);
      }
      if (result.pageTitle) {
        // Store first occurrence of each page title
        if (!pageMap.has(result.pageTitle)) {
          pageMap.set(result.pageTitle, index);
        }
      }
    });

    return { uidToIndexMap: uidMap, pageTitleToIndexMap: pageMap };
  }, [selectedResults, allResults]);

  // Shared helper to navigate to a different page with forced re-render
  const navigateToPage = (targetPage: number, onComplete?: () => void) => {
    if (targetPage === currentPage) {
      // Already on the right page, just execute callback
      if (onComplete) {
        setTimeout(onComplete, 50);
      }
      return;
    }

    // Force re-render: briefly set to a different page, then to target page
    const tempPage = targetPage === 1 ? 2 : 1;
    setCurrentPage(tempPage);

    // Small delay then set to actual target page
    setTimeout(() => {
      setCurrentPage(targetPage);
      if (onComplete) {
        setTimeout(onComplete, 50);
      }
    }, 10);
  };

  // Handle block reference and page reference hover for navigation and highlighting
  useEffect(() => {
    const handleBlockRefHover = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Handle block references
      if (target.classList.contains("roam-block-ref-chat")) {
        const blockUid = target.getAttribute("data-block-uid");
        if (!blockUid) return;

        // Only highlight on hover if NOT in chat-only mode
        if (!chatOnlyMode) {
          // Hover: Highlight and scroll to result in popup
          highlightAndScrollToResult(blockUid);
        }
      }

      // Handle page references and tags
      if (
        target.classList.contains("rm-page-ref") ||
        target.classList.contains("roam-page-ref-chat") ||
        target.classList.contains("roam-tag-ref-chat")
      ) {
        const pageTitle = target.getAttribute("data-page-title");
        if (!pageTitle) return;

        // Only highlight on hover if NOT in chat-only mode
        if (!chatOnlyMode) {
          // Check if page exists in results
          const allAvailableResults =
            selectedResults.length > 0 ? selectedResults : allResults;
          const pageExistsInResults = allAvailableResults.some(
            (result) => result.pageTitle === pageTitle
          );

          if (pageExistsInResults) {
            // Hover: Highlight and scroll to page result in popup (blue theme)
            highlightAndScrollToPageResult(pageTitle);
          }
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
          .then(() => {
            console.log(
              "[Chat Link Click] Copied to clipboard:",
              clipboardText
            );
          })
          .catch((err) => {
            console.warn("[Chat Link Click] Failed to copy to clipboard:", err);
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
          // Regular click: Check if block exists in results
          const allAvailableResults =
            selectedResults.length > 0 ? selectedResults : allResults;
          const blockExistsInResults = allAvailableResults.some(
            (result) => result.uid === blockUid
          );

          if (blockExistsInResults) {
            // Block exists in results - show it
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
            console.warn(
              "[Chat Link Click] Could not find page UID for:",
              pageTitle,
              pageUid
            );
          }
        } else if (event.altKey || event.metaKey) {
          // Alt/Option+click: Open page in main window
          const pageUid = getPageUidByPageName(pageTitle);
          if (pageUid) {
            window.roamAlphaAPI.ui.mainWindow.openPage({
              page: { uid: pageUid },
            });
          } else {
            console.warn(
              "[Chat Link Click] Could not find page UID for:",
              pageTitle,
              pageUid
            );
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
  }, [chatOnlyMode, uidToIndexMap, pageTitleToIndexMap]); // Only re-attach when dependencies that affect behavior change

  // Function to highlight and scroll to a result by UID (with cross-page navigation)
  const highlightAndScrollToResult = (blockUid: string) => {
    // Use lookup map for O(1) performance instead of O(n) findIndex
    const targetResultIndex = uidToIndexMap.get(blockUid);

    if (targetResultIndex === undefined) {
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
      // Navigate to the correct page and highlight after navigation
      setPendingHighlight(blockUid);
      navigateToPage(targetPage);
    }
  };

  // Helper function to highlight element on the current page
  const highlightElementOnCurrentPage = (blockUid: string) => {
    const targetElement = document.querySelector(
      `.full-results-result-item[data-uid="${blockUid}"]`
    ) as HTMLElement;

    if (targetElement) {
      // Remove any existing highlights first
      document
        .querySelectorAll(".highlighted-result, .highlighted-page-result")
        .forEach((el) => {
          el.classList.remove("highlighted-result", "highlighted-page-result");
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

  // Function to highlight and scroll to a page result by title
  const highlightAndScrollToPageResult = (pageTitle: string) => {
    // Use lookup map for O(1) performance instead of O(n) findIndex
    const targetResultIndex = pageTitleToIndexMap.get(pageTitle);

    if (targetResultIndex === undefined) {
      console.warn(`Page "${pageTitle}" not found in current results`);
      return;
    }

    // Get the result to access its UID
    const allAvailableResults =
      selectedResults.length > 0 ? selectedResults : allResults;
    const targetResult = allAvailableResults[targetResultIndex];
    const resultUid = targetResult.uid;

    if (!resultUid) {
      console.warn(`Page "${pageTitle}" found but has no UID`);
      return;
    }

    // Calculate which page the target result is on
    const targetPage = Math.floor(targetResultIndex / resultsPerPage) + 1;

    // Check if the page is already visible in DOM
    const pageAlreadyVisible = document.querySelector(
      `.full-results-result-item[data-uid="${resultUid}"]`
    );

    if (pageAlreadyVisible) {
      highlightPageElementOnCurrentPage(resultUid);
    } else {
      // Navigate to the correct page and highlight after navigation
      navigateToPage(targetPage, () => {
        highlightPageElementOnCurrentPage(resultUid);
      });
    }
  };

  // Helper function to highlight page element on the current page (blue theme)
  const highlightPageElementOnCurrentPage = (pageUid: string) => {
    const targetElement = document.querySelector(
      `.full-results-result-item[data-uid="${pageUid}"]`
    ) as HTMLElement;

    if (targetElement) {
      // Remove any existing highlights first
      document
        .querySelectorAll(".highlighted-result, .highlighted-page-result")
        .forEach((el) => {
          el.classList.remove("highlighted-result", "highlighted-page-result");
        });

      // Add temporary highlight with blue theme
      targetElement.classList.add("highlighted-page-result");

      // Scroll to the element
      targetElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      // Remove highlight after 3 seconds
      setTimeout(() => {
        targetElement?.classList.remove("highlighted-page-result");
      }, 3000);
    } else {
      console.warn(
        `❌ DOM element for page ${pageUid} not found on current page`
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

  // Track enabled/disabled state for each tool
  const [enabledTools, setEnabledTools] = useState<Set<string>>(() => {
    // Try to load from storage first
    const storedTools = extensionStorage.get("chatEnabledTools");
    if (storedTools && Array.isArray(storedTools)) {
      return new Set(storedTools);
    }

    // Initialize with all tools enabled by default
    const allTools = new Set<string>();
    Object.keys(
      require("../../../../ai/agents/chat-agent/tools/chatToolsRegistry")
        .CHAT_TOOLS
    ).forEach((toolName) => {
      allTools.add(toolName);
    });

    // Also enable all skills by default
    const skills =
      require("../../../../ai/agents/chat-agent/tools/skillsUtils").extractAllSkills();
    skills.forEach((skill: any) => {
      allTools.add(`skill:${skill.name}`);
    });

    return allTools;
  });

  // Save enabled tools to storage whenever they change
  useEffect(() => {
    extensionStorage.set("chatEnabledTools", Array.from(enabledTools));
  }, [enabledTools]);

  // Handler to toggle individual tool
  const handleToggleTool = (toolName: string) => {
    setEnabledTools((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(toolName)) {
        newSet.delete(toolName);
      } else {
        newSet.add(toolName);
      }
      return newSet;
    });
  };

  // Handler to toggle all tools on/off
  const handleToggleAllTools = (enable: boolean) => {
    if (enable) {
      // Enable all tools
      const allTools = new Set<string>();
      Object.keys(
        require("../../../../ai/agents/chat-agent/tools/chatToolsRegistry")
          .CHAT_TOOLS
      ).forEach((toolName) => {
        allTools.add(toolName);
      });
      // Also enable all skills
      const skills =
        require("../../../../ai/agents/chat-agent/tools/skillsUtils").extractAllSkills();
      skills.forEach((skill: any) => {
        allTools.add(`skill:${skill.name}`);
      });
      setEnabledTools(allTools);
    } else {
      // Disable all tools
      setEnabledTools(new Set());
    }
  };

  // Handler for pinned style change
  const handlePinnedStyleChange = (isPinned: boolean) => {
    setIsPinnedStyle(isPinned);
    if (isPinned) {
      // Save current style as pinned
      (window as any).__pinnedChatStyle = selectedStyle;
    } else {
      // Clear pinned style from window object
      delete (window as any).__pinnedChatStyle;
      // Keep the current style (don't reset to default when unpinning)
    }
  };

  // Always save current style to window object (for session persistence across view switches)
  useEffect(() => {
    (window as any).__currentChatStyle = selectedStyle;

    // Also update pinned style if pinned
    if (isPinnedStyle) {
      (window as any).__pinnedChatStyle = selectedStyle;
    }
  }, [selectedStyle, isPinnedStyle]);

  // Automatically set chat mode based on enabled tools
  useEffect(() => {
    if (enabledTools.size > 0) {
      // If any tools are enabled, switch to agent mode
      if (chatMode !== "agent") {
        setChatMode("agent");
      }
    } else {
      // If no tools are enabled, switch to simple mode
      if (chatMode !== "simple") {
        setChatMode("simple");
      }
    }
  }, [enabledTools.size, chatMode]);

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
    initialMessagesCountRef.current = 0;
    targetRef.current = undefined;
    // Clear tool usage history
    setToolUsageHistory([]);
    toolUsageHistoryRef.current = [];
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  const insertConversationInRoam = async () => {
    if (!loadedChatUid) {
      let focusedUid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
      if (
        !focusedUid &&
        targetRef.current &&
        hasBlockChildren(targetRef.current)
      ) {
        targetRef.current = await createSiblingBlock(targetRef.current);
      }
      targetRef.current =
        focusedUid || targetRef.current || (await insertBlockInCurrentView(""));
    } else {
      targetRef.current = loadedChatUid;
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
        const targetContent = getBlockContentByUid(targetRef.current);

        if (targetContent.trim()) {
          let firstMsg = newMessages.shift();
          if (firstMsg?.content && !firstMsg?.content?.includes("liveai/chat"))
            firstMsg.content += " #liveai/chat";
          updateBlock({
            blockUid: targetRef.current,
            newContent: firstMsg?.content,
          });
        } else {
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
            targetUid: targetRef.current,
            target: "replace",
            isButtonToInsert: false,
          });
        }
        setLoadedChatUid(
          targetContent.trim() || getBlockContentByUid(targetRef.current)
        );
        setLoadedChatUid(targetRef.current);
      }

      // Insert each message separately to properly handle markdown structure
      // For each message: create role block, then parse content as children
      let currentTargetUid = targetRef.current;
      let isFirstMessage = true;

      for (const msg of newMessages) {
        const rolePrefix =
          msg.role === "user" ? chatRoles.user : chatRoles.assistant;

        // Build the full content including command name if present
        const shouldShowCommandName =
          msg.role === "user" &&
          msg.commandName &&
          msg.commandPrompt !== "prompt";

        let fullContent = "";
        if (shouldShowCommandName) {
          fullContent = msg.content
            ? `**[${msg.commandName}]**\n\n${msg.content}`
            : `**[${msg.commandName}]**`;
        } else {
          fullContent = msg.content || "";
        }

        // Convert markdown formatting to Roam-native formatting
        // This converts: *italic* → __italic__, ==highlight== → ^^highlight^^, and markdown tables → Roam tables
        fullContent = convertMarkdownToRoamFormat(fullContent);

        // Create the role block
        let roleBlockUid: string;
        if (
          isFirstMessage &&
          (initialMessagesCountRef.current === 0 || !isFirstInsertion)
        ) {
          // First message - create as child of title block
          roleBlockUid = await createChildBlock(currentTargetUid, rolePrefix);
          isFirstMessage = false;
        } else {
          // Subsequent messages - create as siblings
          roleBlockUid = await createSiblingBlock(
            currentTargetUid,
            undefined,
            rolePrefix
          );
        }

        // Parse and insert the message content as children of the role block
        // parseAndCreateBlocks will handle markdown structure (lists, headers, etc.)
        if (fullContent.trim()) {
          await parseAndCreateBlocks(roleBlockUid, fullContent, false);
        }

        // Update target for next message
        currentTargetUid = roleBlockUid;
      }

      // Update the count to reflect that these messages are now in Roam
      // This prevents re-inserting the same messages if the button is clicked again
      initialMessagesCountRef.current = chatMessages.length;
    } catch (error) {
      console.error("Failed to insert conversation in Roam:", error);
      alert("❌ Failed to insert conversation. Check console for details.");
    }
  };

  const copyAssistantMessage = async (messageContent: string) => {
    // Keep markdown formatting but remove HTML tags
    const cleanText = messageContent.replace(/<[^>]*>/g, "").trim();
    await copyToClipboard(cleanText);
  };

  const copyFullConversation = async () => {
    const assistantRole = getInstantAssistantRole(selectedModel);
    const conversationText = chatMessages
      .map((msg, index) => {
        // Build the full content including command name if present
        const shouldShowCommandName =
          msg.role === "user" &&
          msg.commandName &&
          msg.commandPrompt !== "prompt";

        let fullContent = "";
        if (shouldShowCommandName) {
          fullContent = msg.content
            ? `**[${msg.commandName}]**\n\n${msg.content}`
            : `**[${msg.commandName}]**`;
        } else {
          fullContent = msg.content;
        }

        // Keep markdown formatting but remove HTML tags
        const cleanContent = fullContent.replace(/<[^>]*>/g, "").trim();

        // Indent ALL lines with 2 spaces to maintain structure under the role
        const indentedContent = cleanContent
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n");

        const role = msg.role === "user" ? chatRoles.user : assistantRole;
        return `${role}\n${indentedContent}`;
      })
      .join("\n\n");

    await copyToClipboard(conversationText);
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

  /**
   * Handle command selection from ChatCommandSuggest
   * Instantly execute the command by creating a user message and setting command context
   */
  const handleCommandSelect = async (
    command: any,
    isFromSlashCommand: boolean = false,
    instantModel: string = ""
  ) => {
    console.log(
      "🎯 Command selected:",
      command,
      "fromSlash:",
      isFromSlashCommand
    );

    if (isTyping) {
      console.warn("⚠️ Cannot execute command while agent is responding");
      return;
    }

    // Mark as auto-executed to prevent the auto-execution effect from running
    hasAutoExecutedRef.current = true;

    // Determine the content to process:
    // When from slash command, extract the content BEFORE the slash command
    // Example: "analyze this text /summarize" -> content = "analyze this text"
    let contentToProcess = chatInput.trim();

    if (isFromSlashCommand) {
      // Find the last "/" and extract everything before it
      const lastSlashIndex = contentToProcess.lastIndexOf("/");
      if (lastSlashIndex !== -1) {
        contentToProcess = contentToProcess.substring(0, lastSlashIndex).trim();
      } else {
        // No slash found (shouldn't happen, but handle gracefully)
        contentToProcess = "";
      }
    }

    // Create user message with command info attached
    const userMessage: ChatMessage = {
      role: "user",
      content: contentToProcess || "", // Empty content means analyzing search results
      timestamp: new Date(),
      commandName: command.name, // Display name (e.g., "Summarize")
      commandPrompt: command.prompt, // This is the key in completionCommands (e.g., "summarize") or custom prompt UID
    };

    // Set command context for processing (will be reset after)
    setCommandContext({
      commandPrompt: command.prompt,
      commandName: command.name,
    });

    // Add user message to chat
    setChatMessages((prev) => [...prev, userMessage]);

    // Clear input
    setChatInput("");

    // Set typing state
    setIsTyping(true);
    setIsStreaming(true);
    setStreamingContent("");
    setToolUsageHistory([]);
    toolUsageHistoryRef.current = []; // Sync ref

    if (command.name?.slice(0, 16) === "Image generation") {
      command.prompt = command.name;
    }

    // Execute the command immediately
    try {
      const contextResults = getSelectedResultsForChat();

      await processChatMessageWithCommand(
        contentToProcess, // The actual user input content (or empty if analyzing results)
        contextResults,
        command.prompt, // The command prompt key (e.g., "summarize")
        command.name,
        instantModel,
        selectedStyle // Pass the selected style
      );
    } catch (error) {
      console.error("Error executing command:", error);
      const errorMessage: ChatMessage = {
        role: "assistant",
        content:
          "I encountered an error processing your request. Please try again.",
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    }

    // Clear typing state after completion
    setIsTyping(false);
    setIsStreaming(false);
    setStreamingContent("");
    // Don't clear tool usage history - it should persist to show user what tools were used

    // Reset command context after processing
    setCommandContext(null);
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
    setToolUsageHistory([]);
    toolUsageHistoryRef.current = []; // Sync ref

    try {
      const contextResults = getSelectedResultsForChat();
      await processChatMessage(
        userMessage.content,
        contextResults,
        undefined,
        undefined,
        undefined,
        selectedStyle
      );
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
    // Don't clear tool usage history - it should persist to show user what tools were used
  };

  // Handler for help buttons
  const handleHelpButtonClick = async (
    type: "chat" | "liveai" | "tip" | "helpabout",
    promptOrContent: string
  ) => {
    if (isTyping) return;

    // Special case: "helpabout" just inserts text in the input
    if (type === "helpabout") {
      setChatInput(promptOrContent);
      return;
    }

    // All help messages are inserted as assistant messages (no LLM call)
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: promptOrContent,
      timestamp: new Date(),
      isHelpMessage: true, // Mark as help message for special rendering
      helpType: type, // Store the type to know which buttons to show
    };

    setChatMessages((prev) => {
      // Help messages always replace the previous help message if it exists
      if (prev.length > 0) {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage.role === "assistant" && lastMessage.isHelpMessage) {
          // Replace the last help message with the new one
          return [...prev.slice(0, -1), assistantMessage];
        }
      }
      // Otherwise, append the new message
      return [...prev, assistantMessage];
    });
  };

  const processChatMessage = async (
    message: string,
    contextResults: Result[],
    commandPromptFromCall?: string,
    commandNameFromCall?: string,
    commandModelFromCall?: string,
    styleFromCall?: string
  ) => {
    try {
      // Update the ref with current context results for expansion callback
      currentContextResultsRef.current = contextResults;

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
      let commandName: string | undefined =
        commandNameFromCall || commandContext?.commandName;

      if (commandPromptFromCall) {
        // Handle <language> placeholder for translate commands
        if (commandPromptFromCall === "translate") {
          // Get the language from the commandLabel (label contains the language name)
          // }
          commandPromptFromCall += `:${
            commandName?.includes("Translate to")
              ? commandName?.split("(")[1]?.slice(0, -1)
              : commandName
          }`;
          // console.log("commandPrompt after :>> ", commandPrompt);
        }
      }

      // Invoke the chat agent
      const agentResult = await invokeChatAgent({
        model: modelAccordingToProvider(commandModelFromCall || selectedModel),
        userMessage: message,

        // Results context - pass the expanded results directly
        resultsContext: expandedResults,
        resultsDescription,

        // Configuration
        style: styleFromCall,
        commandPrompt: commandPromptFromCall,
        toolsEnabled: chatMode === "agent", // Enable tools only in agent mode
        enabledTools: enabledTools, // Pass the set of enabled tools
        accessMode: chatAccessMode,
        isAgentMode: chatMode === "agent",

        // Permissions
        permissions: { contentAccess: chatAccessMode === "Full Access" },

        // Conversation state from previous turns
        conversationHistory: currentConversationHistory,
        conversationSummary:
          chatAgentData?.conversationSummary ||
          loadedChatTitle?.replace("#liveai/chat", ""),
        exchangesSinceLastSummary:
          chatAgentData?.exchangesSinceLastSummary || 0,

        // Active skill instructions from previous turns
        activeSkillInstructions: chatAgentData?.activeSkillInstructions,

        // Tool results cache from previous turns (for deduplication)
        toolResultsCache: chatAgentData?.toolResultsCache,

        // Streaming
        streamingCallback: (content: string) => {
          setStreamingContent((prev) => prev + content);
        },

        // Tool usage callback
        toolUsageCallback: (toolInfo: {
          toolName: string;
          args?: Record<string, any>;
        }) => {
          // Capture any intermediate message that was streamed before the tool call
          const intermediateMessage = streamingContent.trim();

          // Build detailed description based on tool name and args
          let details = "";

          if (toolInfo.toolName === "live_ai_skills") {
            const skillName = toolInfo.args?.skill_name || "unknown skill";
            const resourceTitle = toolInfo.args?.resource_title;

            if (resourceTitle) {
              details = `Loading deeper resource: "${resourceTitle}" from skill "${skillName}"`;
            } else {
              details = `Loading skill: "${skillName}"`;
            }
          } else {
            // For other tools, show arguments only (tool name is already in the title)
            if (toolInfo.args) {
              const argsSummary = Object.entries(toolInfo.args)
                .map(([key, value]) => {
                  // Show full value without truncation - important for user transparency
                  return `${key}: ${JSON.stringify(value)}`;
                })
                .join(", ");
              details = argsSummary || "No arguments";
            } else {
              details = "No arguments";
            }
          }

          // Add new tool usage to history (stacking them)
          const newToolUsage = {
            toolName: toolInfo.toolName,
            details,
            timestamp: Date.now(),
            intermediateMessage: intermediateMessage || undefined,
          };

          // Update both state and ref
          setToolUsageHistory((prev) => {
            const updated = [...prev, newToolUsage];
            toolUsageHistoryRef.current = updated;
            return updated;
          });
        },

        // Tool response callback - updates the tool usage with the response
        toolResponseCallback: (toolInfo: {
          toolName: string;
          response: string;
        }) => {
          // Find the most recent tool usage for this tool and update it with the response
          setToolUsageHistory((prev) => {
            const updatedHistory = [...prev];
            // Find the last occurrence of this tool (most recent)
            for (let i = updatedHistory.length - 1; i >= 0; i--) {
              if (
                updatedHistory[i].toolName === toolInfo.toolName &&
                !updatedHistory[i].response
              ) {
                updatedHistory[i] = {
                  ...updatedHistory[i],
                  response: toolInfo.response,
                };
                break;
              }
            }
            // Update ref immediately to avoid closure issues
            toolUsageHistoryRef.current = updatedHistory;
            return updatedHistory;
          });
        },

        // Agent callbacks
        // Track tool-added results during this agent invocation
        addResultsCallback: (results: Result[]) => {
          // Update parent state
          onAddResults(results);
          // Also track locally for expansion callback
          currentContextResultsRef.current = [
            ...currentContextResultsRef.current,
            ...results,
          ];
        },
        selectResultsCallback: (uids: string[]) => {
          onSelectResultsByUids(uids);
        },
        expandedResultsCallback: async (originalResults: Result[]) => {
          // Re-expand all results (including newly added ones) and return them
          // This happens synchronously during the agent's tool execution phase
          console.log(
            "🔄 [Chat] Re-expanding context with newly added results"
          );

          // The ref has been accumulating tool-added results via addResultsCallback
          // So currentContextResultsRef.current = original + tool-added results
          const allResults = currentContextResultsRef.current;

          console.log(
            `📊 [Chat] Expanding ${allResults.length} results (${
              originalResults.length
            } original + ${
              allResults.length - originalResults.length
            } tool-added)`
          );

          // Perform expansion with the same budget as initial expansion
          const expansionBudget =
            chatAccessMode === "Full Access"
              ? modelTokensLimit * 3
              : modelTokensLimit * 2;

          const newExpandedResults = await performAdaptiveExpansion(
            allResults.map((result) => ({ ...result })),
            expansionBudget,
            0,
            chatAccessMode
          );

          // Update the cached expanded results
          setChatExpandedResults(newExpandedResults);

          console.log(
            `📝 [Chat] Re-expanded ${newExpandedResults.length} results after tool additions`
          );

          return newExpandedResults;
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
        activeSkillInstructions: agentResult.activeSkillInstructions,
        tokensUsage: agentResult.tokensUsage,
      };

      setChatAgentData(newAgentData);

      // Debug conversation state
      // console.log(`💬 [Chat] Agent returned conversation state:`, {
      //   conversationHistoryLength: agentResult.conversationHistory?.length || 0,
      //   hasSummary: !!agentResult.conversationSummary,
      //   hasActiveSkillInstructions: !!agentResult.activeSkillInstructions,
      //   tokensUsage: agentResult.tokensUsage,
      // });

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
        // Use ref to get the current tool usage (avoids stale closure)
        toolUsage:
          toolUsageHistoryRef.current.length > 0
            ? [...toolUsageHistoryRef.current]
            : undefined,
      };

      // Update chat messages first - use functional update to avoid stale closure
      let updatedChatMessages: ChatMessage[] = [];
      setChatMessages((prevMessages) => {
        updatedChatMessages = [...prevMessages, assistantMessage];
        return updatedChatMessages;
      });

      // Clear tool usage history now that it's attached to the message
      setToolUsageHistory([]);
      toolUsageHistoryRef.current = [];

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
    commandName?: string,
    commandModel?: string,
    styleKey?: string
  ) => {
    try {
      // Call processChatMessage with command and style parameters
      // The chat agent will handle command prompt loading and application
      await processChatMessage(
        message,
        contextResults,
        commandPromptKey,
        commandName,
        commandModel,
        styleKey
      );
    } catch (error) {
      console.error("Error processing command:", error);
      throw error;
    }
  };

  // Tool usage messages are now permanent - they provide valuable feedback to users
  // about what actions the agent is taking. No auto-cleanup needed.

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
        isTyping={isTyping}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
        toolUsageHistory={toolUsageHistory}
        modelTokensLimit={modelTokensLimit}
        chatAccessMode={chatAccessMode}
        chatMode={chatMode}
        hasSearchResults={allResults.length > 0}
        onCopyMessage={copyAssistantMessage}
        onSuggestionClick={setChatInput}
        onHelpButtonClick={handleHelpButtonClick}
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
        onCommandSelect={handleCommandSelect}
        availablePages={availablePages}
        isLoadingPages={isLoadingPages}
        onQueryPages={queryAvailablePages}
        enabledTools={enabledTools}
        onToggleTool={handleToggleTool}
        onToggleAllTools={handleToggleAllTools}
        selectedStyle={selectedStyle}
        onStyleChange={setSelectedStyle}
        customStyleTitles={customStyleTitles}
        isPinnedStyle={isPinnedStyle}
        onPinnedStyleChange={handlePinnedStyleChange}
      />
    </div>
  );
};
