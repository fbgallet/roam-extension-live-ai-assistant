/**
 * Chat Message Utilities
 *
 * Pure utility functions for chat message processing and rendering
 */

import DOMPurify from "dompurify";
import { ChatMessage } from "../types/types";

// Convert chat messages to agent conversation history
export const buildConversationHistory = (chatMessages: ChatMessage[]) => {
  return chatMessages.map((msg) => ({
    role: msg.role === "user" ? "User" : "Assistant",
    content: msg.content,
  }));
};

// Calculate total tokens used in the conversation
export const calculateTotalTokens = (chatMessages: ChatMessage[]) => {
  let totalIn = 0;
  let totalOut = 0;

  chatMessages.forEach((msg) => {
    if (msg.tokensIn !== undefined) totalIn += msg.tokensIn;
    if (msg.tokensOut !== undefined) totalOut += msg.tokensOut;
  });

  return { totalIn, totalOut };
};

// Simple markdown renderer for chat messages
export const renderMarkdown = (text: string): string => {
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
    '<a href="#" data-block-uid="$2" class="roam-block-ref-chat roam-embed-link" title="Click: Copy ((uid)) & show result • Shift+click: Open in sidebar • Alt+click: Open in main window">📄 {{[[embed-path]]: (($2))}}]</a>'
  );

  // Simple block reference ((uid))
  rendered = rendered.replace(
    /\(\(([^\(].*?)\)\)/g,
    `<a href="#" data-block-uid="$1" class="roam-block-ref-chat" title="Click: Copy ((uid)) & show result • Shift+click: Open in sidebar • Alt+click: Open in main window"><span class="bp3-icon bp3-icon-flow-end"></span></a>`
  );

  // convert to [link](((uid)))
  rendered = rendered.replace(
    /\[([^\]].*?)\]\(\((.*)\)\)/g,
    `<a href="#" data-block-uid="$2" class="roam-block-ref-chat" title="Click: Copy ((uid)) & show result • Shift+click: Open in sidebar • Alt+click: Open in main window">$1<span class="bp3-icon bp3-icon-flow-end"></span></a>`
  );

  // Page references [[page title]] - make clickable
  rendered = rendered.replace(
    /\[\[([^\]]+)\]\]/g,
    `<span class="rm-page-ref__brackets">[[</span><a href="#" data-page-title="$1" data-page-uid="$1" class="rm-page-ref rm-page-ref--link" title="Click: Filter by this page • Shift+click: Open in sidebar • Alt+click: Open in main window">$1</a><span class="rm-page-ref__brackets">]]</span>`
  );

  // Tag references #tag - make clickable
  rendered = rendered.replace(
    /#([a-zA-Z0-9_-]+)/g,
    '<a href="#" data-page-title="$1" class="rm-page-ref rm-page-ref--tag" title="Click: Filter by this tag • Shift+click: Open in sidebar • Alt+click: Open in main window">#$1</a>'
  );

  // Wrap in paragraphs (but not if it starts with a header or list)
  if (!rendered.match(/^<(h[1-6]|ul)/)) {
    rendered = "<p>" + rendered + "</p>";
  }
  rendered = rendered.replace(/<p><\/p>/g, "");

  return DOMPurify.sanitize(rendered);
};
