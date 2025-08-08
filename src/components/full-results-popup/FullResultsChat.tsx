import React, { useState } from "react";
import { Button, InputGroup, TextArea } from "@blueprintjs/core";
import { invokeSearchAgent } from "../../ai/agents/search-agent/ask-your-graph-invoke";
import { Result, ChatMessage, ChatMode } from "./types";
import { createChildBlock, getBlockContentByUid } from "../../utils/roamAPI";
import { buildAgentConversationState } from "../../ai/agents/shared/agentsUtils";
import { modelAccordingToProvider } from "../../ai/aiAPIsHub";

interface FullResultsChatProps {
  isOpen: boolean;
  selectedResults: Result[];
  allResults: Result[];
  privateMode: boolean;
  permissions: { contentAccess: boolean };
  targetUid?: string;
  onClose: () => void;
}

// Convert results to agent conversation context with full content
const buildResultsContext = (results: Result[]): string => {
  if (!results || results.length === 0) {
    return "No results available for context.";
  }

  return results.map((result, index) => {
    const parts = [];
    
    // Always include UID for embed syntax
    if (result.uid) parts.push(`UID: ${result.uid}`);
    
    // Include page context
    if (result.pageTitle) parts.push(`Page: [[${result.pageTitle}]]`);
    
    // Fetch actual block content if not already available
    let content = result.content || result.text || "";
    if (!content && result.uid) {
      try {
        content = getBlockContentByUid(result.uid);
      } catch (error) {
        console.warn(`Failed to fetch content for UID ${result.uid}:`, error);
      }
    }
    
    // Include full content when available (don't truncate for chat context)
    if (content) {
      parts.push(`Content: ${content}`);
    } else {
      parts.push(`Content: [Block content not available]`);
    }
    
    // Include additional metadata if available
    if (result.created) parts.push(`Created: ${result.created}`);
    if (result.modified) parts.push(`Modified: ${result.modified}`);
    
    return `Result ${index + 1}:\n${parts.join('\n')}`;
  }).join('\n\n---\n\n');
};

// Convert chat messages to agent conversation history
const buildConversationHistory = (chatMessages: ChatMessage[]) => {
  return chatMessages.map(msg => ({
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp
  }));
};

// Simple markdown renderer for chat messages
const renderMarkdown = (text: string): string => {
  if (!text) return '';
  
  let rendered = text;
  
  // Bold text **text** (do this early to avoid conflicts)
  rendered = rendered.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Headers - handle ### first, then ##, then # (process before line break conversion)
  rendered = rendered.replace(/(^|\n)### (.+?)(?=\n|$)/gm, '$1<h4>$2</h4>');
  rendered = rendered.replace(/(^|\n)## (.+?)(?=\n|$)/gm, '$1<h3>$2</h3>');
  rendered = rendered.replace(/(^|\n)# (.+?)(?=\n|$)/gm, '$1<h2>$2</h2>');
  
  // Bullet points - item (before line break processing)
  rendered = rendered.replace(/(^|\n)- (.+?)(?=\n|$)/gm, '$1<li>$2</li>');
  
  // Numbered lists 1. item (before line break processing)
  rendered = rendered.replace(/(^|\n)\d+\.\s(.+?)(?=\n|$)/gm, '$1<li>$2</li>');
  
  // Wrap consecutive li elements in ul
  rendered = rendered.replace(/(<li>.*?<\/li>)(\s*<li>)/gs, '$1$2');
  rendered = rendered.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');
  rendered = rendered.replace(/<\/ul>\s*<ul>/g, '');
  
  // Convert double line breaks to paragraph breaks
  rendered = rendered.replace(/\n\n/g, '</p><p>');
  
  // Convert remaining single line breaks to br tags (but not around headers)
  rendered = rendered.replace(/\n(?!<\/?(h[1-6]|li|ul))/g, '<br>');
  
  // Clean up line breaks around headers and lists
  rendered = rendered.replace(/(<br>)*(<\/?(h[1-6]|ul)>)(<br>)*/g, '$2');
  
  // Convert Roam embed syntax to clickable links
  rendered = rendered.replace(/\{\{\[\[(.*?)\]\]:\s*\(\((.*?)\)\)\}\}/g, 
    '<a href="#" onclick="window.roamAlphaAPI.ui.setBlockFocusAndSelection({location: {\'block-uid\': \'$2\', \'window-id\': \'main-window\'}}); return false;" class="roam-embed-link" title="Go to block">📄 $1</a>');
  
  // Simple block reference ((uid))
  rendered = rendered.replace(/\(\((.*?)\)\)/g, 
    '<a href="#" onclick="window.roamAlphaAPI.ui.setBlockFocusAndSelection({location: {\'block-uid\': \'$1\', \'window-id\': \'main-window\'}}); return false;" class="roam-block-ref" title="Go to block">((§))</a>');
  
  // Wrap in paragraphs (but not if it starts with a header or list)
  if (!rendered.match(/^<(h[1-6]|ul)/)) {
    rendered = '<p>' + rendered + '</p>';
  }
  rendered = rendered.replace(/<p><\/p>/g, '');
  
  return rendered;
};

export const FullResultsChat: React.FC<FullResultsChatProps> = ({
  isOpen,
  selectedResults,
  allResults,
  privateMode,
  permissions,
  targetUid,
  onClose,
}) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("simple");
  const [agentData, setAgentData] = useState<any>(null); // Store agent conversation state
  const [hasExpandedResults, setHasExpandedResults] = useState(false); // Track if results have been expanded

  const getSelectedResultsForChat = () => {
    return selectedResults.length > 0 ? selectedResults : allResults;
  };

  const canUseChat = () => {
    return !privateMode || permissions.contentAccess;
  };

  const handleChatSubmit = async () => {
    if (!chatInput.trim() || isTyping) return;
    
    const userMessage: ChatMessage = {
      role: 'user',
      content: chatInput.trim(),
      timestamp: new Date()
    };
    
    setChatMessages(prev => [...prev, userMessage]);
    setChatInput("");
    setIsTyping(true);
    
    try {
      const contextResults = getSelectedResultsForChat();
      // Enrich results with actual block content before processing
      const enrichedResults = contextResults.map(result => {
        if (!result.content && !result.text && result.uid) {
          try {
            const blockContent = getBlockContentByUid(result.uid);
            return { ...result, content: blockContent };
          } catch (error) {
            console.warn(`Failed to fetch content for UID ${result.uid}:`, error);
            return result;
          }
        }
        return result;
      });
      
      await processChatMessage(userMessage.content, enrichedResults);
    } catch (error) {
      console.error("Chat error:", error);
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: "Sorry, I encountered an error processing your request. Please try again.",
        timestamp: new Date()
      };
      setChatMessages(prev => [...prev, errorMessage]);
    }
    
    setIsTyping(false);
  };

  const processChatMessage = async (message: string, contextResults: Result[]) => {
    try {
      console.log("🔍 Processing chat message with search agent");
      console.log(`💬 Chat mode: ${chatMode}, isDirectChat: ${chatMode === "simple"}`);
      
      // Build conversation context from results
      const resultsContext = buildResultsContext(contextResults);
      
      // Create chat-optimized prompt that prioritizes provided content
      const chatPrompt = `You are having a conversation about search results. Here are the complete results with their content:

${resultsContext}

User message: ${message}

🎯 RESPONSE PRIORITY:
1. **FIRST**: Answer using the provided content above - you have the full text of each block
2. **THEN**: Only if the provided content is insufficient and Deep Analysis is enabled, use search tools

${chatMode === "agent" ? `🔍 DEEP ANALYSIS MODE:
- If the provided content fully answers the question, respond directly without searching
- Only search if you need additional context, related content, or hierarchical information
- When searching, use specific UIDs from above: getBlockContent with uid parameter
- Use purpose: "completion" for expanding context, "final" for new results to show user
- Use fromResultId: "external_context_001" to reference the provided results
- extractPageReferences and combineResults can help analyze the provided data` : `💬 CHAT MODE:
- Focus on analyzing and discussing the provided content
- The complete block content is available above - no need to search for it
- If you need more context, explain what additional information would be helpful`}

IMPORTANT GUIDELINES:
- Use the embed syntax {{[[embed-path]]: ((uid))}} with the actual UIDs from above
- The content is already provided - don't search for basic information that's available
- Be conversational and engaging while staying focused on the provided results
- For questions about content, themes, connections - analyze what you can see directly

AVAILABLE CONTENT: You have ${contextResults.length} complete result(s) with full content above.`;

      // Prepare agent data with conversation state
      const conversationHistory = buildConversationHistory(chatMessages);
      const agentOptions = {
        model: "gpt-4o-mini", // TODO: Use user's preferred model
        rootUid: targetUid || await createChildBlock("", "Chat Session"),
        targetUid: targetUid,
        target: "new",
        prompt: chatPrompt,
        permissions: permissions || { contentAccess: !privateMode },
        privateMode: privateMode || false,
        // Enable direct chat mode for simple chat to bypass RequestAnalyzer
        isDirectChat: chatMode === "simple",
        agentData: {
          isConversationMode: true,
          conversationHistory: conversationHistory,
          conversationSummary: chatMessages.length > 0 ? 
            `Chatting about ${contextResults.length} search results` : undefined,
          ...agentData // Include any previous agent state
        },
        // NEW: Pass external context from search results with enriched content
        externalContext: {
          results: contextResults, // This will now include the actual block content
          contextType: "search_results" as const,
          description: `Search results being discussed (${contextResults.length} items with full content)`
        }
      };

      const agentResult = await invokeSearchAgent(agentOptions);
      
      // Update agent data for next conversation turn and extract any new results
      const newAgentData = {
        toolResultsCache: agentResult.toolResultsCache,
        cachedFullResults: agentResult.cachedFullResults,
        hasLimitedResults: agentResult.hasLimitedResults,
        resultSummaries: agentResult.resultSummaries,
        resultStore: agentResult.resultStore,
        nextResultId: agentResult.nextResultId
      };
      
      setAgentData(newAgentData);
      
      // Log live result updates for debugging
      const previousResultCount = Object.keys(agentData?.resultStore || {}).length;
      const newResultCount = Object.keys(agentResult.resultStore || {}).length;
      
      if (newResultCount > previousResultCount) {
        console.log(`🔄 Live results updated: ${newResultCount - previousResultCount} new result sets added during conversation`);
        setHasExpandedResults(true);
        
        // Count total expanded results
        const expandedResults = [];
        if (agentResult.resultStore) {
          Object.values(agentResult.resultStore).forEach((resultEntry: any) => {
            if (resultEntry && resultEntry.data && Array.isArray(resultEntry.data)) {
              expandedResults.push(...resultEntry.data.filter((r: any) => r && (r.uid || r.pageUid || r.pageTitle)));
            }
          });
        }
        
        console.log(`🔍 Chat conversation now has access to ${expandedResults.length} total results (${contextResults.length} original + ${expandedResults.length - contextResults.length} new)`);
        
        // TODO: Could emit an event to parent component about expanded results
        // This would allow FullResultsPopup to update its result count or show new results
      }

      const aiResponse = agentResult.finalAnswer || "I couldn't analyze the results. Please try rephrasing your question.";

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: aiResponse,
        timestamp: new Date()
      };
      
      // Update chat messages first  
      const newChatMessages = [...chatMessages, assistantMessage];
      setChatMessages(newChatMessages);
      
      // Update conversation state with summarization (every 3 exchanges)
      try {
        const llmInfos = modelAccordingToProvider("gpt-4o-mini"); // Use for summarization
        const conversationState = await buildAgentConversationState(
          buildConversationHistory(chatMessages), // Use the previous messages (userMessage was already added earlier)
          agentData?.conversationSummary,
          message,
          aiResponse,
          llmInfos,
          { input_tokens: 0, output_tokens: 0 }, // We don't track tokens for chat
          (agentData?.exchangesSinceLastSummary || 0) + 1,
          "search"
        );
        
        // Update agent data with new conversation state
        setAgentData(prev => ({
          ...prev,
          conversationHistory: conversationState.conversationHistory,
          conversationSummary: conversationState.conversationSummary,
          exchangesSinceLastSummary: conversationState.exchangesSinceLastSummary
        }));
        
        console.log(`💬 [ChatSummarizer] Updated conversation state: ${conversationState.conversationHistory.length} messages, summary: ${conversationState.conversationSummary ? 'yes' : 'no'}`);
        
      } catch (error) {
        console.warn("Failed to update conversation state:", error);
      }
      
    } catch (error) {
      console.error("Chat processing error:", error);
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: "I encountered an error processing your request. Please try again.",
        timestamp: new Date()
      };
      setChatMessages(prev => [...prev, errorMessage]);
    }
  };


  if (!isOpen) return null;

  return (
    <div className="full-results-chat-panel">
      <div className="full-results-chat-header">
        <h4>💬 Chat Assistant</h4>
        <div className="full-results-chat-info">
          {selectedResults.length > 0 ? (
            <span>Chatting about {selectedResults.length} selected results</span>
          ) : (
            <span>Chatting about {allResults.length} visible results</span>
          )}
          {hasExpandedResults && (
            <span className="full-results-chat-expansion-badge">
              📈 Results expanded during conversation
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
              Hi! I can help you analyze and understand your search results. What would you like to know?
              <div className="full-results-chat-suggestions">
                <button onClick={() => setChatInput("What are the main themes in these results?")}>Main themes</button>
                <button onClick={() => setChatInput("Summarize these results for me")}>Summarize</button>
                <button onClick={() => setChatInput("What connections exist between these items?")}>Find connections</button>
                {chatMode === "agent" && (
                  <button onClick={() => setChatInput("Can you find related results that might expand on these topics?")}>🔍 Expand results</button>
                )}
              </div>
              <div className="full-results-chat-feature-hint">
                {chatMode === "agent" ? (
                  <>💡 <strong>Deep Analysis mode</strong>: I'll analyze your results first, then search for related content if needed!</>
                ) : (
                  <>💡 <strong>Chat mode</strong>: I'll focus on analyzing the content you've selected without additional searches.</>
                )}
              </div>
            </div>
          </div>
        ) : (
          chatMessages.map((message, index) => (
            <div key={index} className={`full-results-chat-message ${message.role}`}>
              <div className="full-results-chat-avatar">
                {message.role === 'user' ? '👤' : '🤖'}
              </div>
              <div className="full-results-chat-content">
                <div 
                  className="full-results-chat-text" 
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                />
                <div className="full-results-chat-timestamp">
                  {message.timestamp.toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))
        )}
        
        {isTyping && (
          <div className="full-results-chat-message assistant">
            <div className="full-results-chat-avatar">🤖</div>
            <div className="full-results-chat-content">
              <div className="full-results-chat-typing">Thinking...</div>
            </div>
          </div>
        )}
      </div>

      <div className="full-results-chat-input-area">
        <div className="full-results-chat-mode-toggle">
          <label>
            <input
              type="radio"
              name="chatMode"
              value="simple"
              checked={chatMode === "simple"}
              onChange={() => setChatMode("simple")}
            />
            💬 Chat Mode (Focus on provided results)
          </label>
          <label>
            <input
              type="radio"
              name="chatMode"
              value="agent"
              checked={chatMode === "agent"}
              onChange={() => setChatMode("agent")}
              disabled={privateMode}
            />
            🔍 Deep Analysis (Can explore with search tools)
            {privateMode && <span className="disabled-hint">(Full mode only)</span>}
          </label>
        </div>
        
        <div className="full-results-chat-input-container">
          <InputGroup
            placeholder="Ask me about your results..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleChatSubmit()}
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