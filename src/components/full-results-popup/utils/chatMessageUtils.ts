/**
 * Chat Message Utilities
 *
 * Pure utility functions for chat message processing and rendering
 */

import DOMPurify from "dompurify";
import { ChatMessage } from "../types/types";

// Helper function to escape HTML characters in code blocks
const escapeHtml = (text: string): string => {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
};

// Helper function to parse markdown tables
const parseMarkdownTable = (tableText: string): string => {
  const lines = tableText.trim().split('\n').map(line => line.trim());

  if (lines.length < 2) return tableText; // Need at least header and separator

  // Parse header row
  const headerCells = lines[0]
    .split('|')
    .map(cell => cell.trim())
    .filter(cell => cell.length > 0);

  // Check separator row (should contain dashes and optional colons for alignment)
  const separatorRow = lines[1];
  if (!separatorRow.match(/^\|?[\s:-]+\|[\s:-]+/)) {
    return tableText; // Not a valid table
  }

  // Parse alignment from separator row
  const alignments = separatorRow
    .split('|')
    .map(cell => cell.trim())
    .filter(cell => cell.length > 0)
    .map(cell => {
      if (cell.match(/^:-+:$/)) return 'center';
      if (cell.match(/^-+:$/)) return 'right';
      if (cell.match(/^:-+$/)) return 'left';
      return '';
    });

  // Build HTML table
  let html = '<table class="markdown-table">';

  // Header
  html += '<thead><tr>';
  headerCells.forEach((cell, i) => {
    const align = alignments[i] ? ` style="text-align: ${alignments[i]}"` : '';
    html += `<th${align}>${cell}</th>`;
  });
  html += '</tr></thead>';

  // Body rows
  html += '<tbody>';
  for (let i = 2; i < lines.length; i++) {
    const cells = lines[i]
      .split('|')
      .map(cell => cell.trim())
      .filter(cell => cell.length > 0);

    if (cells.length > 0) {
      html += '<tr>';
      cells.forEach((cell, j) => {
        const align = alignments[j] ? ` style="text-align: ${alignments[j]}"` : '';
        html += `<td${align}>${cell}</td>`;
      });
      html += '</tr>';
    }
  }
  html += '</tbody></table>';

  return html;
};

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

  // console.log("text before renderMarkdown:>> ", text);

  let rendered = text;

  // STEP 1: Handle code blocks FIRST to protect their content from other transformations
  // Store code blocks temporarily to prevent interference with other patterns
  // Use CODEBLOCK-x format to avoid conflicts with markdown syntax
  const codeBlocks: string[] = [];
  const codeBlockPlaceholder = "CODEBLOCK-";

  // Multi-line code blocks ```language\ncode\n```
  rendered = rendered.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, language, code) => {
    const index = codeBlocks.length;
    const langClass = language ? ` class="language-${language}"` : "";
    codeBlocks.push(`<pre><code${langClass}>${escapeHtml(code.trim())}</code></pre>`);
    return `${codeBlockPlaceholder}${index}`;
  });

  // STEP 2: Extract URLs, images, and inline code BEFORE text formatting
  // This protects them from being mangled by bold/italic processing

  // 2.1: Extract markdown images ![alt](url) and markdown links [text](url)
  const links: string[] = [];
  const linkPlaceholder = "LINK-";

  // Images: ![alt](url) - process BEFORE regular links
  rendered = rendered.replace(/!\[([^\]]*)\]\(((?:https?:\/\/|www\.)[^\s\)]+)\)/g, (_match, alt, url) => {
    const index = links.length;
    links.push(`<img src="${url}" alt="${alt}" style="max-width: 100%; height: auto; border-radius: 4px; margin: 8px 0;" />`);
    return `${linkPlaceholder}${index}`;
  });

  // Regular links: [text](url)
  rendered = rendered.replace(/\[([^\[\]]+?)\]\(((?:https?:\/\/|www\.)[^\s\)]+)\)/g, (_match, text, url) => {
    const index = links.length;
    const href = url.startsWith('www.') ? `https://${url}` : url;
    links.push(`<a href="${href}" target="_blank" rel="noopener" class="external-link">${text}</a>`);
    return `${linkPlaceholder}${index}`;
  });

  // 2.2: Process inline code (including double backticks)
  const inlineCodes: string[] = [];
  const inlineCodePlaceholder = "INLINECODE-";

  // First, handle double backticks `` `` (for displaying literal backticks or code with backticks)
  rendered = rendered.replace(/``(.*?)``/g, (_match, code) => {
    const index = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `${inlineCodePlaceholder}${index}`;
  });

  // Then handle single backticks ` ` (normal inline code)
  rendered = rendered.replace(/`([^`]+?)`/g, (_match, code) => {
    const index = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `${inlineCodePlaceholder}${index}`;
  });

  // STEP 3: Process text formatting (bold, italic, strikethrough, highlight)
  // Bold text **text** (do this before italic to handle ***text*** correctly)
  rendered = rendered.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>"); // Bold + Italic ***text***
  rendered = rendered.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"); // Bold **text**

  // Strikethrough ~~text~~
  rendered = rendered.replace(/~~(.+?)~~/g, "<del>$1</del>"); // ~~strikethrough~~

  // Highlight - support both Roam style ^^text^^ and markdown style ==text==
  rendered = rendered.replace(/\^\^(.+?)\^\^/g, '<mark>$1</mark>'); // ^^highlight^^ (Roam style)
  rendered = rendered.replace(/==(.+?)==/g, '<mark>$1</mark>'); // ==highlight== (markdown style)

  // Italic text *text* or _text_
  rendered = rendered.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>"); // *text* (not preceded/followed by *)
  rendered = rendered.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<em>$1</em>"); // _text_ (not preceded/followed by _)

  // STEP 4: Process markdown tables AFTER inline code and text formatting
  // At this point, backticks are replaced with INLINECODE-x placeholders that won't interfere
  // Match tables: header row, separator row, and body rows
  rendered = rendered.replace(
    /((?:^|\n)(?:\|[^\n]+\|(?:\n|$))+)/gm,
    (match) => {
      // Check if this looks like a table (has a separator row with dashes)
      if (match.match(/\|[\s:-]+\|/)) {
        return parseMarkdownTable(match);
      }
      return match;
    }
  );

  // STEP 3: Headers - handle ###### first (most specific), then decreasing
  // Note: We map # -> h2, ## -> h3, etc. (h1 reserved for page titles in Roam)
  rendered = rendered.replace(/(^|\n)###### (.+?)(?=\n|$)/gm, "$1<h6>$2</h6>"); // ###### -> h6
  rendered = rendered.replace(/(^|\n)##### (.+?)(?=\n|$)/gm, "$1<h5>$2</h5>");   // ##### -> h5
  rendered = rendered.replace(/(^|\n)#### (.+?)(?=\n|$)/gm, "$1<h4>$2</h4>");    // #### -> h4
  rendered = rendered.replace(/(^|\n)### (.+?)(?=\n|$)/gm, "$1<h3>$2</h3>");     // ### -> h3
  rendered = rendered.replace(/(^|\n)## (.+?)(?=\n|$)/gm, "$1<h2>$2</h2>");      // ## -> h2
  rendered = rendered.replace(/(^|\n)# (.+?)(?=\n|$)/gm, "$1<h2>$2</h2>");       // # -> h2 (h1 reserved)

  // STEP 3.5: Horizontal rules - --- or *** or ___ (3 or more characters, on their own line)
  // Process BEFORE list items to avoid conflicts with - for bullets
  rendered = rendered.replace(/(^|\n)([-*_])\2{2,}(?:\s*)(?=\n|$)/gm, "$1<hr>");

  // STEP 3.6: Blockquotes - > quote text (process before line break conversion)
  // Handle multi-line blockquotes
  rendered = rendered.replace(/(^|\n)((?:>\s?.+(?:\n|$))+)/gm, (_match, prefix, quoteBlock) => {
    // Remove the > prefix from each line and trim
    const quoteContent = quoteBlock
      .split('\n')
      .map((line: string) => line.replace(/^>\s?/, '').trim())
      .filter((line: string) => line.length > 0)
      .join('<br>');
    return `${prefix}<blockquote>${quoteContent}</blockquote>`;
  });

  // STEP 4: Lists - Bullet points and numbered lists with proper nesting/indentation
  // Process lists line by line to handle indentation properly
  const lines = rendered.split('\n');
  const processedLines: string[] = [];
  let listStack: Array<{ indent: number; type: 'ul' | 'ol' }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match list items with indentation
    // Capture: (spaces)(bullet/number)(space)(content)
    const bulletMatch = line.match(/^(\s*)([-*•])\s(.+)$/);
    const numberedMatch = line.match(/^(\s*)(\d+\.)\s(.+)$/);

    if (bulletMatch || numberedMatch) {
      const match = bulletMatch || numberedMatch;
      const indent = match![1].length;
      const content = match![3];
      const listType = bulletMatch ? 'ul' : 'ol';

      // Calculate indent level (every 2 spaces = 1 level)
      const level = Math.floor(indent / 2);

      // Close lists if we've decreased indentation (only if STRICTLY greater, not equal)
      while (listStack.length > 0 && listStack[listStack.length - 1].indent > level) {
        const closingList = listStack.pop()!;
        processedLines.push(`</${closingList.type}>`);
      }

      // Check if we need to open a new list or switch list type at same level
      const topList = listStack.length > 0 ? listStack[listStack.length - 1] : null;

      if (!topList || topList.indent < level) {
        // Need to open a new nested list
        processedLines.push(`<${listType}>`);
        listStack.push({ indent: level, type: listType });
      } else if (topList.indent === level && topList.type !== listType) {
        // Same level but different list type - close old and open new
        listStack.pop();
        processedLines.push(`</${topList.type}>`);
        processedLines.push(`<${listType}>`);
        listStack.push({ indent: level, type: listType });
      }
      // else: same level and same type - just add the item to existing list

      processedLines.push(`<li>${content}</li>`);
    } else {
      // Not a list item - close all open lists
      while (listStack.length > 0) {
        const closingList = listStack.pop()!;
        processedLines.push(`</${closingList.type}>`);
      }
      processedLines.push(line);
    }
  }

  // Close any remaining open lists
  while (listStack.length > 0) {
    const closingList = listStack.pop()!;
    processedLines.push(`</${closingList.type}>`);
  }

  rendered = processedLines.join('\n');

  // Convert double line breaks to paragraph breaks
  rendered = rendered.replace(/\n\n/g, "</p><p>");

  // Convert remaining single line breaks to br tags (but not around headers, lists, hr, blockquote)
  // Exclude line breaks that come:
  // - Before opening/closing tags: <h1-6>, <li>, <ul>, <ol>, <hr>, <blockquote>
  // - After closing tags: </h1-6>, </li>, </ul>, </ol>, <hr>, </blockquote>
  rendered = rendered.replace(/(?<!<\/(h[1-6]|li|ul|ol|blockquote)>|<hr>)\n(?!<\/?(h[1-6]|li|ul|ol|blockquote|hr)>)/g, "<br>");

  // Clean up any remaining line breaks around headers, lists, hr, and blockquotes
  rendered = rendered.replace(/(<br>)*(<\/?(h[1-6]|ul|ol|li|blockquote)|<hr\/?>)(<br>)*/g, "$2");

  // Process bare URLs (markdown links already processed as LINK-x placeholders)
  // Bare URLs - https://... or http://...
  // Avoid matching URLs already in href attributes or inside tags
  rendered = rendered.replace(
    /(?<!["'=])(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener" class="external-link">$1</a>'
  );

  // Bare www. URLs (add https:// protocol)
  // Avoid matching www already in href or after a protocol
  rendered = rendered.replace(
    /(?<!["'=:\/])(www\.[^\s<>"]+)/g,
    '<a href="https://$1" target="_blank" rel="noopener" class="external-link">$1</a>'
  );

  // Page references [[page title]] - make clickable
  rendered = rendered.replace(
    /\[\[(?!\<)([^\]]+)(?!<\>)\]\]/g,
    `<span class="rm-page-ref__brackets">[[</span><a href="#" data-page-title="$1" data-page-uid="$1" class="rm-page-ref rm-page-ref--link" title="Click: Filter by this page. Shift+click: Open in sidebar. Alt+click: Open in main window">$1</a><span class="rm-page-ref__brackets">]]</span>`
  );

  // Convert Roam embed syntax to clickable links
  rendered = rendered.replace(
    /\{\{\[\[(.*?)\]\]:\s*\(\(([^\(]{9})\)\)\}\}/g,
    '<a href="#" data-block-uid="$2" class="roam-block-ref-chat roam-embed-link" title="Click: Copy block reference & show result. Shift+click: Open in sidebar. Alt+click: Open in main window">📄 {{[[embed-path]]: (($2))}}]</a>'
  );

  // IMPORTANT: Process [description](((uid))) BEFORE ((uid)) to prevent conflicts
  // Convert [description](((uid))) to clickable link with description
  rendered = rendered.replace(
    /\[([^\[\]]+?)\]\(\(\(([^\(]{9})\)\)\)/g,
    `<a href="#" data-block-uid="$2" class="roam-block-ref-chat" title="Click: Copy block reference & show result. Shift+click: Open in sidebar. Alt+click: Open in main window">$1</a>`
  );

  // Simple block reference ((uid)) - process AFTER [description](((uid)))
  rendered = rendered.replace(
    /(?<!\]\()\(\(([^\(]{9})\)\)(?!\}\})/g,
    `<a href="#" data-block-uid="$1" class="roam-block-ref-chat" title="Click: Copy block reference & show result. Shift+click: Open in sidebar. Alt+click: Open in main window"><span class="bp3-icon bp3-icon-flow-end"></span></a>`
  );

  // Tag references #tag - make clickable
  // Use negative lookbehind to avoid matching # in URLs (e.g., https://example.com#anchor)
  rendered = rendered.replace(
    /(?<!\w|\/)#([a-zA-Z0-9\/_-]+)/g,
    '<a href="#" data-page-title="$1" class="rm-page-ref rm-page-ref--tag" title="Click: Filter by this tag. Shift+click: Open in sidebar. Alt+click: Open in main window">#$1</a>'
  );

  // STEP 5: Restore code blocks, links, and inline code BEFORE wrapping in paragraphs or sanitizing
  // Use split/join approach for reliable placeholder replacement (replaceAll not available in all environments)

  // Restore multi-line code blocks
  codeBlocks.forEach((codeBlock, index) => {
    const placeholder = `${codeBlockPlaceholder}${index}`;
    rendered = rendered.split(placeholder).join(codeBlock);
  });

  // Restore links and images
  links.forEach((link, index) => {
    const placeholder = `${linkPlaceholder}${index}`;
    rendered = rendered.split(placeholder).join(link);
  });

  // Restore inline code
  inlineCodes.forEach((inlineCode, index) => {
    const placeholder = `${inlineCodePlaceholder}${index}`;
    rendered = rendered.split(placeholder).join(inlineCode);
  });

  // Wrap in paragraphs (but not if it starts with a header, list, blockquote, hr, or table)
  if (!rendered.match(/^<(h[1-6]|ul|ol|pre|blockquote|hr|table)/)) {
    rendered = "<p>" + rendered + "</p>";
  }
  rendered = rendered.replace(/<p><\/p>/g, "");

  // Configure DOMPurify to allow target="_blank" on links and all formatting tags including tables and images
  return DOMPurify.sanitize(rendered, {
    ADD_ATTR: ["target", "rel", "class", "data-block-uid", "data-page-title", "data-page-uid", "style", "src", "alt"],
    ADD_TAGS: ["code", "pre", "blockquote", "hr", "del", "mark", "table", "thead", "tbody", "tr", "th", "td", "h5", "h6", "img"],
  });
};
