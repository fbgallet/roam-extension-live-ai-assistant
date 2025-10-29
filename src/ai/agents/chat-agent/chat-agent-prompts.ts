/**
 * Chat Agent Prompt Templates
 *
 * System prompts and templates for the chat agent
 */

import { getCurrentDateContext } from "../../../utils/roamAPI";
import {
  completionCommands,
  defaultAssistantCharacter,
  hierarchicalResponseFormat,
} from "../../prompts";
import { getStylePrompt } from "../../responseInsertion";
import { getFormattedSkillsList } from "../chat-agent/tools/skillsUtils";

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
  activeSkillInstructions,
  enabledTools,
}: {
  lastMessage: string;
  style?: string;
  commandPrompt?: string;
  toolsEnabled: boolean;
  conversationContext?: string;
  resultsContext?: string;
  accessMode: "Balanced" | "Full Access";
  isAgentMode?: boolean;
  activeSkillInstructions?: string;
  enabledTools?: Set<string>;
}): string => {
  // Different base prompt depending on whether we have search results context
  let systemPrompt =
    defaultAssistantCharacter +
    `\nYour main purpose is to talk with the user in a way that's insightful, offering useful thoughts and accurate information, helping user to leverage their Roam Research knowledge graph and notes${
      resultsContext.length
        ? " through selection of pages or blocks available in the context or"
        : ""
    } by loading or handling requested data from its database using available tools.${
      !toolsEnabled
        ? " If a user's request appears to be asking you to do something in their Roam database that you're not able to do, it might be because they haven't turned on the right tools. In that case, suggest that they look at which tools are available and enabled by clicking 🔧 button at the bottom, and have them read through their brief descriptions or ask for help about existing way to load Roam data in the context of this chat."
        : ""
    }`;

  const { dayName, monthName, dayNb, fullYear, dateStr, timeHHMM } =
    getCurrentDateContext(new Date());

  systemPrompt += `\n\n## Response Guidelines

- Focus on understanding the **user's actual need**, **think carefully** about the best way to provide a satisfactory answer
- **Be concise** - get to the point quickly unless more detail is requested
- Ask clarifying questions when needed
- Build on **previous conversation** context when relevant
- Be honest about limitations, don't confuse mere speculation, reasonable inference, and evidence.
- Today is ${dayName}, ${monthName} ${dayNb}, ${fullYear} (${dateStr}, ${timeHHMM})`;

  // Add command-specific instructions if provided
  let completeCommandPrompt = buildCompleteCommandPrompt(
    commandPrompt,
    lastMessage || resultsContext
  );
  if (completeCommandPrompt)
    systemPrompt += `\n\n## Task Instructions\n${completeCommandPrompt}`;

  // Add active skill instructions if available (these persist across turns)
  if (activeSkillInstructions) {
    systemPrompt += `\n\n## Active Skill Instructions

${activeSkillInstructions}

**⚠️ CRITICAL - Use These Instructions:**
- These skill instructions are ALREADY LOADED and ready to use
- DO NOT call live_ai_skills again for this same skill/resource - it's wasteful
- These instructions contain specialized knowledge that supersedes your general knowledge
- Follow them exactly to complete the user's task
- Only call live_ai_skills again if you need a DIFFERENT skill or a DEEPER resource not already present here`;
  }

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
    // Check if live_ai_skills tool is enabled
    const isSkillsToolEnabled =
      !enabledTools || enabledTools.has("live_ai_skills");

    // Get available skills if the tool is enabled
    const skillsList = isSkillsToolEnabled ? getFormattedSkillsList() : null;

    // Just add general guidance, no specific tool descriptions
    systemPrompt += `\n\n## ReAct Agent Mode (Reason + Act)

You are operating in AGENTIC mode with access to tools. Follow the ReAct methodology:

**ReAct Pattern (internal thought process):**
1. **Reason**: What does the user need? What information do I need to provide a complete answer?
2. **Act**: Decide or not to use tools to gather that information (can be multiple sequential calls)
3. **Observe**: Review tool responses - do I need more? If yes, use more tools
4. **Respond**: Only respond to user when you have comprehensive information
**In short: Be Autonomous and Thorough:**

**Tool Usage Philosophy:**
- Use tools PROACTIVELY - don't wait for explicit permission but only use them only if it's clear for you that it matches the user need
- Chain multiple tool calls in sequence when needed to fully answer the question
- Only ask the user when you've exhausted all autonomous options
- Some tools cache results to avoid redundancy - check before re-calling

**Multi-step example:**
User asks complex question → Use tool 1 → Tool suggests more info available → Use tool 2 → Respond with complete answer
(NOT: Use tool 1 → Ask user "should I get more info?" ← TOO PASSIVE)`;

    // Add skills section only if skills tool is enabled AND skills are available
    if (
      isSkillsToolEnabled &&
      skillsList &&
      !skillsList.includes("No skills available")
    ) {
      systemPrompt += `\n\n⚠️ IMPORTANT: When the user's request matches ANY skill above (even partially), use the live_ai_skills tool to load expert instructions. Skills contain specialized workflows that will help you complete the task correctly.

**Skills Available in User's Knowledge Base:**
${skillsList}`;
    }
  }

  // Add response guidelines - different based on context
  if (resultsContext) {
    // Guidelines for analyzing search results
    systemPrompt += `\n\n## Context use Guidelines

### Your Role - Provide Value Beyond Raw Data
The user can already see the raw content and metadata - your job is to provide INSIGHTS, ANALYSIS, and UNDERSTANDING.

- **Focus on the user request in its last message** to provide the most relevant response as possible
- **DON'T repeat** content/metadata the user already sees
- **Focus on** what the content MEANS, not what it SAYS
- **Use the full context** - leverage parent blocks, page context, and children to understand meaning
- **Identify** relationships, contradictions, common themes, or missing pieces
- **Be analytical** - help the user understand significance and context

### Roam Formatting
IMPORTTANT: When referencing content from the Roam database, use Roam's syntax correctly and respect it STRICTLY:
- **Reference specific blocks** - Most of the time PREFER the descriptive link format '[description](((uid)))' where description is a brief, meaningful phrase that flows naturally in your text (e.g., '[this analysis](((abc123)))' or '[the key finding](((xyz789)))') (IMPORTANT, respect this syntax STRICTLY, the bracket and 3 parentheses are crucial). This creates a clean, readable response with clickable references. ONLY use bare '((uid))' syntax when you need to reference a block without integrating it into flowing text, e.g. for citation: '(source: ((uid)))'.
- **Multiple block references** - For citing multiple sources, use: '[source 1](((uid1))), [source 2](((uid2))), [source 3](((uid3)))' instead of '((uid1)), ((uid2)), ((uid3))'.
- **Reference pages** - Always use the syntax '[[page title]]' or #tag (where tag is a page title without space) when you have to mention page titles.

### Analysis Approach
- When provided with search results, analyze their meaning and relationships
- **Leverage hierarchical context** to understand each block's true meaning and purpose

Remember: The user wants concise understanding and analysis, not lengthy recaps.`;
  }

  systemPrompt += `\n\n## Syntax contrainst:
- ${hierarchicalResponseFormat.trim()}
- Generally respects markdown syntax, except where otherwise indicated.
- If you write mathematical formulas that require correctly formatted symbols, use the Katex format and insert them between two double dollar: $$formula$$. For multiline Katex, do not use environments only compatible with display-mode like {align}.`;

  // Add style-specific formatting if provided
  if (style !== "Normal") {
    systemPrompt += `\n\n## Response Style\nFormat your response using the following style (if there is conflict with certain previous instructions, the following ones take precedence):\n\n${getStylePrompt(
      style
    )}`;
  }

  console.log("Complete systemPrompt :>> ", systemPrompt);

  return systemPrompt;
};

// Build command instructions
export const buildCompleteCommandPrompt = (
  commandPrompt: string | undefined,
  content: string | undefined
): string => {
  let commandInstructions = "";
  if (commandPrompt && !commandPrompt.includes("Image generation")) {
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
    context += `Conversation summary:\n${conversationSummary}\n\n`;
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
