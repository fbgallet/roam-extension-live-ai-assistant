import React, { useState } from "react";
import { Button, InputGroup, Icon, Tooltip } from "@blueprintjs/core";
import { invokeSearchAgent } from "../../ai/agents/search-agent/ask-your-graph-invoke";
import { Result, ChatMessage, ChatMode } from "./types";
import { createChildBlock } from "../../utils/roamAPI";
import { performAdaptiveExpansion } from "../../ai/agents/search-agent/helpers/contextExpansion";
import { extensionStorage } from "../..";

interface FullResultsChatProps {
  isOpen: boolean;
  selectedResults: Result[];
  allResults: Result[];
  privateMode: boolean;
  permissions: { contentAccess: boolean };
  targetUid?: string;
  onClose: () => void;
}

// Convert chat messages to agent conversation history
const buildConversationHistory = (chatMessages: ChatMessage[]) => {
  return chatMessages.map((msg) => ({
    role: msg.role === "user" ? "User" : "Assistant",
    content: msg.content,
  }));
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
    "<a href=\"#\" onclick=\"window.roamAlphaAPI.ui.setBlockFocusAndSelection({location: {'block-uid': '$2', 'window-id': 'main-window'}}); return false;\" class=\"roam-embed-link\" title=\"Go to block\">📄 $1</a>"
  );

  // Simple block reference ((uid))
  rendered = rendered.replace(
    /\(\((.*?)\)\)/g,
    "<a href=\"#\" onclick=\"window.roamAlphaAPI.ui.setBlockFocusAndSelection({location: {'block-uid': '$1', 'window-id': 'main-window'}}); return false;\" class=\"roam-block-ref\" title=\"Go to block\">((§))</a>"
  );

  // Wrap in paragraphs (but not if it starts with a header or list)
  if (!rendered.match(/^<(h[1-6]|ul)/)) {
    rendered = "<p>" + rendered + "</p>";
  }
  rendered = rendered.replace(/<p><\/p>/g, "");

  return rendered;
};

export const FullResultsChat: React.FC<FullResultsChatProps> = ({
  isOpen,
  selectedResults,
  allResults,
  privateMode,
  permissions,
  targetUid,
}) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("simple"); // TODO: Future evolution - Chat Mode vs Deep Analysis
  const [accessMode, setAccessMode] = useState<"Balanced" | "Full Access">(
    () => {
      const defaultMode = extensionStorage.get("askGraphMode") || "Balanced";
      return defaultMode === "Private"
        ? "Balanced"
        : (defaultMode as "Balanced" | "Full Access");
    }
  );
  const [agentData, setAgentData] = useState<any>(null); // Store agent conversation state
  const [hasExpandedResults, setHasExpandedResults] = useState(false); // Track if agent found additional results during conversation
  const [lastSelectedResultIds, setLastSelectedResultIds] = useState<string[]>(
    []
  ); // Track result selection changes
  const [expandedResultsObjects, setExpandedResultsObjects] = useState<
    Result[] | null
  >(null); // Cache expanded result objects

  // Reset cache when chat is closed/reopened
  React.useEffect(() => {
    if (!isOpen) {
      setExpandedResultsObjects(null);
      setLastSelectedResultIds([]);
    }
  }, [isOpen]);

  const getSelectedResultsForChat = () => {
    return selectedResults.length > 0 ? selectedResults : allResults;
  };

  const resetChat = () => {
    setChatMessages([]);
    setAgentData(null);
    setExpandedResultsObjects(null);
    setLastSelectedResultIds([]);
    setHasExpandedResults(false);
    console.log("💬 [Chat] Reset chat conversation");
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      console.log("📋 Copied to clipboard");
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
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
      console.log(`💬 Access mode: ${accessMode}, using simple chat mode`);

      // Check if result selection has changed
      const currentResultIds = contextResults
        .map((r) => r.uid || r.pageUid || r.pageTitle)
        .filter(Boolean);
      const selectionChanged =
        JSON.stringify(currentResultIds.sort()) !==
        JSON.stringify(lastSelectedResultIds.sort());

      let resultsContext: string;

      let expandedResults: Result[];

      if (selectionChanged || !expandedResultsObjects) {
        console.log(
          `📊 ${
            selectionChanged ? "Result selection changed" : "First turn"
          }: ${lastSelectedResultIds.length} → ${
            currentResultIds.length
          } results`
        );
        setLastSelectedResultIds(currentResultIds);

        // Perform expansion once and cache the expanded objects
        // Use proper expansion budgets based on access mode
        const expansionBudget = accessMode === "Full Access" ? 200000 : 100000; // ~50k vs ~25k tokens
        const charLimit = Math.min(
          expansionBudget,
          Math.max(50000, contextResults.length * 2000)
        );
        expandedResults = await performAdaptiveExpansion(
          contextResults,
          charLimit,
          0,
          accessMode // Pass access mode to influence depth strategy
        );
        setExpandedResultsObjects(expandedResults);
        console.log(
          `📝 [Chat] Cached ${expandedResults.length} expanded result objects`
        );
      } else {
        // Reuse cached expanded objects
        expandedResults = expandedResultsObjects;
        console.log(
          `📝 [Chat] Reusing cached ${expandedResults.length} expanded result objects`
        );
      }

      // Build string context from expanded objects (only when needed for prompts)
      resultsContext = expandedResults
        .map((result, index) => {
          const parts = [];
          if (result.uid) parts.push(`UID: ${result.uid}`);
          if (result.pageTitle) parts.push(`Page: [[${result.pageTitle}]]`);
          if (result.content) {
            parts.push(`Content: ${result.content}`);
          } else {
            parts.push(`Content: [Block content not available]`);
          }
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

      // Build conversation history from chat messages
      const currentConversationHistory = buildConversationHistory(chatMessages);

      // For popup execution with conversation history, don't duplicate results in the prompt
      // The agent's system prompt already includes the results context
      const hasConversationHistory = currentConversationHistory.length > 0;

      let chatPrompt: string;
      if (hasConversationHistory && !selectionChanged) {
        // For continuing conversations, just send the user message
        chatPrompt = message;
      } else {
        // For first turn or when selection changes, include results context
        const selectionChangeNotice = selectionChanged
          ? `\n🔄 IMPORTANT: The user has changed their result selection since the last message. The results below represent the NEW selection.\n`
          : ``;

        chatPrompt = `You are an intelligent assistant analyzing search results. The user can already see the raw content and metadata - your job is to provide INSIGHTS, ANALYSIS, and UNDERSTANDING.${selectionChangeNotice}

SEARCH RESULTS DATA:
${resultsContext}

User request: ${message}

🎯 YOUR ROLE - PROVIDE VALUE BEYOND RAW DATA:
- **DON'T repeat** content/metadata the user already sees
- **DO provide** insights, patterns, connections, themes, implications
- **Focus on** what the content MEANS, not what it SAYS
- **Be concise** - give key insights first, elaborate only when asked
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
    : `💬 CHAT MODE (${accessMode}):
- Analyze and synthesize the provided content
- Provide insights, not repetition
${
  accessMode === "Full Access"
    ? "- Full access: Can access complete content and context for deeper analysis"
    : "- Balanced access: Focus on provided results with secure processing"
}`
}

RESPONSE GUIDELINES:
- **Be concise and focused** - 2-3 key insights, not lengthy explanations (unless user asks for detail)
- **Leverage hierarchical context** - use Parent context, Children outline, and Page context to understand each block's true meaning and purpose
- **Conversational and insightful** - like a thoughtful colleague reviewing the data
- **Reference specific results** using block reference syntax ((UID)) when relevant
- **Avoid summarizing** - instead analyze, connect, and provide perspective
- **Focus on user's specific question** while bringing broader insights

Remember: The user wants concise understanding and analysis, not lengthy recaps. Use the rich context (parent/children/page) to truly understand what each block represents.`;
      }

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
        hasAgentData: !!agentData,
        chatMessagesCount: chatMessages.length,
        conversationHistoryFromChat: currentConversationHistory,
        conversationHistoryLength: currentConversationHistory.length,
        agentConversationSummary: agentData?.conversationSummary,
      });

      // Build the agent state object with embedded external context using expanded results
      const previousAgentState = {
        ...agentData, // Include any previous agent state from the search agent (results, etc.) FIRST
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
        model: "gpt-4o-mini", // TODO: Use user's preferred model
        rootUid: chatRootUid,
        targetUid: undefined, // Chat mode doesn't write to Roam
        target: "new",
        prompt: chatPrompt,
        permissions: { contentAccess: accessMode === "Full Access" },
        privateMode: accessMode === "Balanced",
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
      };

      const agentResult = await invokeSearchAgent(agentOptions);

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
      };

      setAgentData(newAgentData);

      // Debug conversation state
      console.log(`💬 [Chat] Agent returned conversation state:`, {
        hasConversationHistory: !!agentResult.conversationHistory,
        conversationHistoryLength: agentResult.conversationHistory?.length || 0,
        hasSummary: !!agentResult.conversationSummary,
        conversationSummary: agentResult.conversationSummary,
      });

      // Log live result updates for debugging
      const previousResultCount = Object.keys(
        agentData?.resultStore || {}
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
        <div className="full-results-chat-header-main">
          <h4>
            <Icon icon="chat" size={16} style={{ marginRight: "6px" }} />
            Chat Assistant
          </h4>
          {chatMessages.length > 0 && (
            <div className="full-results-chat-header-controls">
              <Tooltip content="Reset chat conversation">
                <Button icon="trash" onClick={resetChat} minimal small />
              </Tooltip>
              <Tooltip content="Copy full conversation to clipboard">
                <Button
                  icon="clipboard"
                  onClick={copyFullConversation}
                  minimal
                  small
                />
              </Tooltip>
            </div>
          )}
        </div>
        <div className="full-results-chat-info">
          {selectedResults.length > 0 ? (
            <span>
              Chatting about {selectedResults.length} selected results
            </span>
          ) : (
            <span>Chatting about {allResults.length} visible results</span>
          )}
          {hasExpandedResults && (
            <span className="full-results-chat-expansion-badge">
              <Icon
                icon="trending-up"
                size={12}
                style={{ marginRight: "4px" }}
              />
              Results expanded during conversation
            </span>
          )}
        </div>
        {privateMode && (
          <div className="full-results-chat-warning">
            🔒 Limited functionality in Private mode
          </div>
        )}
      </div>

      <div className="full-results-chat-messages">
        {chatMessages.length === 0 ? (
          <div className="full-results-chat-welcome">
            <div className="full-results-chat-assistant-avatar">🤖</div>
            <div className="full-results-chat-assistant-message">
              Hi! I can help you analyze and understand your search results.
              What would you like to know?
              <div className="full-results-chat-suggestions">
                <button
                  onClick={() =>
                    setChatInput("What are the main themes in these results?")
                  }
                >
                  Main themes
                </button>
                <button
                  onClick={() => setChatInput("Summarize these results for me")}
                >
                  Summarize
                </button>
                <button
                  onClick={() =>
                    setChatInput("What connections exist between these items?")
                  }
                >
                  Find connections
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
                💡 <strong>Chat mode</strong>: I'll focus on analyzing the
                content you've selected. Use{" "}
                {accessMode === "Balanced" ? "🛡️ Balanced" : "🔓 Full Access"}{" "}
                mode above for different levels of context.
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
                  </span>
                  {message.role === "assistant" && (
                    <span
                      className="full-results-chat-copy-link"
                      onClick={() => copyAssistantMessage(message.content)}
                      title="Copy message to clipboard"
                    >
                      📋 copy
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
        <div className="full-results-chat-access-mode">
          <Tooltip
            content={
              accessMode === "Balanced"
                ? "Balanced Mode: Secure tools with final summary"
                : "Full Access Mode: Complete content access with expanded context"
            }
          >
            <Button
              className="full-results-chat-access-button"
              minimal
              small
              onClick={() =>
                setAccessMode(
                  accessMode === "Balanced" ? "Full Access" : "Balanced"
                )
              }
            >
              <Icon
                icon={accessMode === "Balanced" ? "shield" : "unlock"}
                size={12}
                style={{ marginRight: '4px' }}
              />
              <span style={{ fontWeight: 'bold' }}>{accessMode}</span>
              <Icon icon="chevron-right" size={10} style={{ margin: '0 2px', opacity: 0.6 }} />
              <span style={{ fontSize: '11px', opacity: 0.7 }}>
                {accessMode === "Balanced" ? "Full Access" : "Balanced"}
              </span>
            </Button>
          </Tooltip>
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
          <InputGroup
            placeholder="Ask me about your results..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && !e.shiftKey && handleChatSubmit()
            }
            disabled={isTyping}
            className="full-results-chat-input"
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
