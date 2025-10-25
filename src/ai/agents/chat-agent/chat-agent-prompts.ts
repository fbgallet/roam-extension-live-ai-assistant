/**
 * Chat Agent Prompt Templates
 *
 * System prompts and templates for the chat agent
 */

import { completionCommands, defaultAssistantCharacter } from "../../prompts";

// Base system prompt for chat agent
export const buildChatSystemPrompt = ({
  lastMessage,
  style,
  commandPrompt,
  toolsEnabled,
  conversationContext,
  resultsContext,
  accessMode,
  isAgentMode,
}: {
  lastMessage: string;
  style?: string;
  commandPrompt?: string;
  toolsEnabled: boolean;
  conversationContext?: string;
  resultsContext?: string;
  accessMode: "Balanced" | "Full Access";
  isAgentMode?: boolean;
}): string => {
  // Different base prompt depending on whether we have search results context
  let systemPrompt =
    defaultAssistantCharacter +
    (resultsContext.length
      ? `Your main purpose is to help users analyze and interact with their Roam Research knowledge graph through the selection of pages or blocks available in the context, thanks to Live AI interface and Ask 'Your Graph' agent queries.`
      : `You can help with various tasks, answer questions, provide information, assist with problem-solving and follow a large set of built-in or custom prompts.`);

  // Add command-specific instructions if provided
  let completeCommandPrompt = buildCompleteCommandPrompt(
    commandPrompt,
    lastMessage || resultsContext
  );
  if (completeCommandPrompt)
    systemPrompt += `\n\n## Task Instructions\n${completeCommandPrompt}`;
  console.log("systemPrompt :>> ", systemPrompt);

  // Add results context if available
  if (resultsContext) {
    systemPrompt += `\n\n## Available Context\n${resultsContext}`;
  }

  // Add conversation context if available
  if (conversationContext) {
    systemPrompt += `\n\n## Conversation Context\n${conversationContext}`;
  }

  // Add tool usage guidance - DON'T include tool descriptions when using bindTools
  // LangChain's bindTools handles tool schemas automatically via the API
  if (toolsEnabled) {
    // Just add general guidance, no specific tool descriptions
    systemPrompt += `\n\n## Tool Usage
You have access to tools that can help analyze and search the knowledge graph. Use them when needed.`;

    // Add agent mode specific guidance
    //     if (isAgentMode) {
    //       systemPrompt += `\n\n### Deep Analysis Mode
    // - Analyze the provided content first, then search only if you need additional context
    // - When searching: use specific UIDs, purpose: "completion" for expanding context
    // - Use fromResultId: "external_context_001" to reference the provided results
    // - Focus on synthesis and deeper understanding`;
    //     }
  } else {
    systemPrompt += `\n\n## Response Mode\nYou are operating in direct chat mode without access to search tools. Respond based on the provided context and your general knowledge.`;
  }

  // Add response guidelines - different based on context
  if (resultsContext) {
    // Guidelines for analyzing search results
    systemPrompt += `\n\n## Response Guidelines

### Your Role - Provide Value Beyond Raw Data
The user can already see the raw content and metadata - your job is to provide INSIGHTS, ANALYSIS, and UNDERSTANDING.

- **Focus on the user request in its last message** to provide the most relevant response as possible
- **DON'T repeat** content/metadata the user already sees
- **Focus on** what the content MEANS, not what it SAYS
- **Use the full context** - leverage parent blocks, page context, and children to understand meaning
- **Identify** relationships, contradictions, common themes, or missing pieces
- **Be analytical** - help the user understand significance and context

### Roam Formatting
IMPORTTANT: When referencing content from the knowledge graph, use Roam's syntax correctly and respect it STRICTLY:
- **Reference specific blocks** - Most of the time PREFER the descriptive link format '[description](((uid)))' where description is a brief, meaningful phrase that flows naturally in your text (e.g., '[this analysis](((abc123)))' or '[the key finding](((xyz789)))') (IMPORTANT, respect this syntax STRICTLY, the bracket and 3 parentheses are crucial). This creates a clean, readable response with clickable references. ONLY use bare '((uid))' syntax when you need to reference a block without integrating it into flowing text, e.g. for citation: '(source: ((uid)))'.
- **Multiple block references** - For citing multiple sources, use: '[source 1](((uid1))), [source 2](((uid2))), [source 3](((uid3)))' instead of '((uid1)), ((uid2)), ((uid3))'.
- **Reference pages** - Always use the syntax '[[page title]]' or #tag (where tag is a page title without space) when you have to mention page titles.

### Analysis Approach
- When provided with search results, analyze their meaning and relationships
- **Leverage hierarchical context** - use Parent context, Children outline, and Page context to understand each block's true meaning and purpose
- Point out connections and patterns across results
- Use the rich context (parent/children/page) to truly understand what each block represents

Remember: The user wants concise understanding and analysis, not lengthy recaps.`;
  } else {
    // General conversation guidelines
    systemPrompt += `\n\n## Response Guidelines

### Conversation Style
- **Be helpful and clear** - provide accurate, useful information
- **Be concise** - get to the point quickly unless more detail is requested
- **Be conversational** - friendly and approachable tone
- Build on previous conversation context when relevant

### Response Approach
- Focus on understanding the user's actual need
- Provide practical, actionable information
- Ask clarifying questions when needed
- Be honest about limitations

Remember: Be helpful, clear, and concise.`;
  }

  // Add style-specific formatting if provided
  if (style) {
    systemPrompt += `\n\n## Response Style\nFormat your response using the following style: ${style}`;
  }

  // Add access mode context only when we have search results
  if (resultsContext) {
    systemPrompt += `\n\n## Access Mode\nCurrent access mode: ${accessMode}`;
    if (accessMode === "Balanced") {
      systemPrompt += `\nYou have access to metadata and structure. For detailed content analysis, tools may be needed.`;
    } else {
      systemPrompt += `\nYou have full access to content and can perform detailed analysis.`;
    }
  }

  return systemPrompt;
};

// Build command instructions
export const buildCompleteCommandPrompt = (
  commandPrompt: string | undefined,
  content: string | undefined
): string => {
  let commandInstructions = "";
  if (commandPrompt) {
    const splittedCommand = commandPrompt.split(":");
    commandInstructions = completionCommands[splittedCommand[0]];

    commandInstructions = commandInstructions.replace(
      "<target content>",
      content
    );

    if (splittedCommand.length > 1)
      commandInstructions = commandInstructions.replace(
        "<language>",
        splittedCommand[1]
      );
  }
  return commandInstructions;
};

// Build conversation context string
export const buildConversationContext = (
  conversationHistory: string[] | undefined,
  conversationSummary: string | undefined
): string | undefined => {
  if (!conversationHistory && !conversationSummary) {
    return undefined;
  }

  let context = "";

  if (conversationSummary) {
    context += `Previous conversation summary:\n${conversationSummary}\n\n`;
  }

  if (conversationHistory && conversationHistory.length > 0) {
    context += `Recent conversation:\n${conversationHistory.join("\n")}`;
  }

  return context || undefined;
};

// Build results context string - matches FullResultsChat format exactly
export const buildResultsContext = (
  results: any[],
  contextDescription?: string
): string => {
  if (!results || results.length === 0) {
    return "";
  }

  let context =
    contextDescription ||
    `You are analyzing ${results.length} search result(s).`;

  context += `\n\nSEARCH RESULTS DATA:\n`;

  // Format results exactly as FullResultsChat does
  const formattedResults = results
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
        if (result.pageTitle) parts.push(`In page: [[${result.pageTitle}]]`);
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

      return `Result ${index + 1}:\n${parts.join("\n")}`;
    })
    .join("\n\n---\n\n");

  context += formattedResults;

  return context;
};

// Build tool descriptions for system prompt
export const buildToolDescriptions = (tools: any[]): string => {
  if (!tools || tools.length === 0) {
    return "No tools available.";
  }

  let descriptions =
    "Available tools for searching and analyzing the knowledge graph:\n\n";

  tools.forEach((tool) => {
    descriptions += `- **${tool.name}**: ${
      tool.description || "No description"
    }\n`;
  });

  return descriptions;
};

// Template for conversation summarization
export const SUMMARIZATION_PROMPT = `Summarize the following conversation between a user and assistant. Focus on:
- Key topics discussed
- Important findings or insights
- User's goals or questions
- Relevant context for future turns

Keep the summary concise (2-3 paragraphs maximum).

Conversation:
{conversation}

Summary:`;
