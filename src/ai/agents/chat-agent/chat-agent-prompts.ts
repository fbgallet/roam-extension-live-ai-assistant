/**
 * Chat Agent Prompt Templates
 *
 * System prompts and templates for the chat agent
 */

import {
  getCurrentDateContext,
  resolveReferences,
} from "../../../utils/roamAPI";
import { getCustomPromptByUid } from "../../dataExtraction";
import {
  completionCommands,
  defaultAssistantCharacter,
  hierarchicalResponseFormat,
  roamKanbanFormat,
  roamTableFormat,
} from "../../prompts";
import { getStylePrompt } from "../../responseInsertion";
import { getFormattedSkillsList } from "../chat-agent/tools/skillsUtils";

// Base system prompt for chat agent
export const buildChatSystemPrompt = async ({
  lastMessage,
  style,
  toolsEnabled,
  conversationContext,
  resultsContext,
  activeSkillInstructions,
  enabledTools,
  hasAudioContent,
  hasVideoContent,
  hasPdfContent,
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
  hasAudioContent?: boolean;
  hasVideoContent?: boolean;
  hasPdfContent?: boolean;
}): Promise<string> => {
  // Different base prompt depending on whether we have search results context
  // Add results context if available

  const { dayName, monthName, dayNb, fullYear, dateStr, timeHHMM } =
    getCurrentDateContext(new Date());
  let systemPrompt = `**Current Date and Time**: ${dayName}, ${monthName} ${dayNb}, ${fullYear} (${dateStr}, ${timeHHMM})\n\n`;
  if (resultsContext) {
    systemPrompt += `## Available Context\n${resultsContext}
    
-- END of the Available Context --`;

    // Guidelines for analyzing search results
    systemPrompt += `\n\n## Context use Guidelines

### Your Role - Provide Value Beyond Raw Data
The user can already see the raw content and metadata - your job is to provide INSIGHTS, ANALYSIS, and UNDERSTANDING matching user needs.

- **Focus on the user request** to provide the most relevant response as possible
- **DON'T repeat** content/metadata the user already sees
- **Focus on** what the content MEANS, not what it SAYS
- **Use the full context** - leverage parent blocks, page context, and children to understand meaning
- **Identify** relationships, contradictions, common themes, or missing pieces
- **Be analytical** - help the user understand significance and context

### IMPORTTANT formatting contrainsts when referencing content from the Context. Respect them STRICTLY:
- **Reference blocks (<BLOCK> items in the context)** - When possible, use a short descriptive link format '[description](((UID)))' where description is a brief, meaningful phrase that flows naturally in your text (e.g., '[this analysis](((UID)))' or '[the key finding](((UID)))') (IMPORTANT, respect this syntax STRICTLY, the bracket and 3 parentheses are crucial). This creates a clean, readable response with clickable references. If description would be too long or it's simply requested to add a link to block source at the end of a sentence or paragraph, e.g. for citation, use the format '[*](((UID)))' (it will just display a clickable '*').
- **Multiple block references** - For citing multiple sources, use: '[1](((UID1))), [2](((UID2))), [3](((UID3)))' instead of '((UID1)), ((UID2)), ((UID3))'.
- **Reference pages** (<PAGE> items in the context) - Always use the syntax '[[page title]]' or '#title' for pages (where tag is a page title without space and has been used as tag in by the user, otherwise use '[[title]]' syntax) when you have to mention page titles. In this case, link format is not required since the title is supposed to be descriptive enough.\n\n`;
  }

  // Add conversation context if available
  if (conversationContext) {
    systemPrompt += `## Conversation Context

This section contains the history of your conversation with the user. Note that past task instructions shown here (marked with "[Built-in or custom instructions for this stored conversation turn]") are historical context - they applied to previous requests. Follow built-on or custom instructions that appear eventually below for the CURRENT request.

${conversationContext}

-- END of the Conversation Context --\n\n`;
  }

  systemPrompt +=
    "## General purpose Guidelines\n" +
    defaultAssistantCharacter +
    `\nYour main purpose is to talk with the user in a way that's insightful, offering useful thoughts and accurate information${
      resultsContext.length
        ? ", helping them to leverage their Roam Research knowledge graph and notes through selection of pages or blocks available in the 'Available Context' section or simply answering their request by relying on your own knwoledge base when their request doesn't seem related to the current context"
        : ""
    }. ${
      !toolsEnabled
        ? "If a user's request appears to be asking you to do something in their Roam database like loading some page or querying Help documents, it might be because they haven't turned on the agent tools. In that case, suggest them to enable corresponding tools."
        : ""
    }`;

  systemPrompt += `## Response Guidelines

- **Think carefully** about the best way to provide a satisfactory answer to the user need
- **Be concise** - get to the point quickly unless more detail is requested
- Ask clarifying questions when needed
- Build on 'Conversation Context' when relevant
- Be honest about limitations, don't confuse mere speculation, reasonable inference, and evidence.`;

  // Add tool usage guidance - DON'T include tool descriptions when using bindTools
  // LangChain's bindTools handles tool schemas automatically via the API
  if (toolsEnabled) {
    // Check if live_ai_skills tool is enabled
    const isSkillsToolEnabled =
      toolsEnabled && enabledTools.has("live_ai_skills");
    const isContextToolsEnabled =
      toolsEnabled &&
      (enabledTools.has("add_to_context") ||
        enabledTools.has("ask_your_graph"));
    const isHelpToolEnabled =
      toolsEnabled && enabledTools.has("live_ai_skills");
    const isEditToolsEnabled =
      toolsEnabled &&
      (enabledTools.has("create_block") ||
        enabledTools.has("create_page") ||
        enabledTools.has("update_block"));

    // Get available skills if the tool is enabled
    const skillsList = isSkillsToolEnabled ? getFormattedSkillsList() : null;

    // Just add general guidance, no specific tool descriptions
    systemPrompt += `\n\n## ReAct Agent Mode (Reason + Act)

You are operating in AGENTIC mode with access to tools. Follow the ReAct methodology:
1. **Reason**: What does the user need? What information do I need to provide a complete answer?
2. **Act**: Decide or not to use tools to gather that information (can be multiple sequential calls)
3. **Observe**: Review tool responses - do I need more? If yes, use more tools
4. **Respond**: Only respond to user when you have comprehensive information
**In short: Be Autonomous and Thorough**

**Tool Usage Philosophy:**
- Use tools proactively (but wisely) - don't wait for explicit permission but use them only if it's clear that it matches the user needs
- Some tools cache results to avoid redundancy - check before re-calling
- **Interactive choices**: You have an \`ask_user_choice\` tool to present inline interactive forms. Use it whenever the user should make an actual selection rather than just reading options as text. Examples: quizzes/QCM, polls, choosing between approaches, preference selection, step-by-step interactive workflows.
${
  isContextToolsEnabled
    ? `- If and only if the user explicitly requests or refers to data in their Roam database (specifically using 'page', or 'block', 'tag' or 'attribute' keywords or corresponding Roam syntax '[[page]]', #tag...) and their content is requested to provide a relevant response, first verify if it's already available in the 'Available Context' section, otherwise load the requested data from its database using available tools (unless it's mentioned as target for some content update or addition, in this case the corresponding tools will load themselves the corresponding content). But if their request is more general than something that could be find on a personal knowledge graph, proceed it as a normal request relying on your own knowledge base.`
    : ""
}
${
  isHelpToolEnabled
    ? `**IMPORTANT Instructions on how to handle fetched documentation with get_help and live_ai_skills**:
- Documentations are often very verbose, so make an effort to be concise and get straight to the point.
- Don't just repeat the resource, tailor your response to the user's specific request and provide a practical answer as possible, with clear steps if user action is needed.
- IMPORTANT: Provide images or urls in your response if some are available in the relevant section, in markdown format '![image](url)', '[link](url)'.`
    : ""
}
${
  isEditToolsEnabled
    ? `\n**Roam Research formatting rules for content written with edit tools (create_block, create_page, update_block):**
The content you provide to these tools is in markdown format, automatically converted to Roam blocks. However, some Roam-specific syntax elements are NOT standard markdown and must be used as-is:
- **Page references**: use \`[[page title]]\` syntax (double brackets), not markdown links
- **Block references**: use \`((block-uid))\` syntax (double parentheses)
- **Tags**: use \`#tag\` or \`#[[multi word tag]]\` syntax
- **Attributes**: use \`Attribute Name::\` syntax (double colon) for Roam attributes
- **Block embeds**: use \`{{[[embed]]: ((block-uid))}}\` syntax
- **TODO/DONE**: use \`{{[[TODO]]}}\` or \`{{[[DONE]]}}\` for task markers
- **Dates**: use Roam date format \`[[Month Dth, Year]]\` (e.g. \`[[January 5th, 2025]]\`) for date page references
- **Highlights**: use \`^^\` to surround highlighted text (e.g. \`^^important^^)\`
- Standard markdown (bold, italic, headings, lists, code blocks, links) is supported and will be converted automatically.
- Do NOT wrap Roam-specific syntax in markdown link format.${(() => {
        const combined = (lastMessage || "") + (resultsContext || "");
        const needsTable =
          combined.toLowerCase().includes("table") ||
          combined.includes("{{[[table]]}}") ||
          combined.includes("{{table}}");
        const needsKanban =
          combined.toLowerCase().includes("kanban") ||
          combined.includes("{{[[kanban]]}}") ||
          combined.includes("{{kanban}}");
        return (
          (needsTable ? "\n" + roamTableFormat : "") +
          (needsKanban ? "\n" + roamKanbanFormat : "")
        );
      })()}`
    : ""
}`;

    // Add skills section only if skills tool is enabled AND skills are available
    if (
      isSkillsToolEnabled &&
      skillsList &&
      !skillsList.includes("No skills available")
    ) {
      systemPrompt += `\n\n⚠️ IMPORTANT: When the user's request matches ANY skill above (even partially), use the live_ai_skills tool to load expert instructions. Skills contain specialized workflows that will help you complete the task correctly.

**Skills Available in User's Knowledge Base:**
${skillsList}`;

      // Add active skill instructions if available (these persist across turns)
      if (activeSkillInstructions) {
        systemPrompt += `\n\n## Active Skill Instructions

${activeSkillInstructions}

**⚠️ CRITICAL - Use These Instructions:**
- These skill instructions are ALREADY LOADED and ready to use
- DO NOT call live_ai_skills again for this same skill/resource - it's wasteful
- These instructions contain specialized knowledge that supersedes your general knowledge
- Follow them exactly to complete the user's task
- If records are listed with UIDs, use create_block/update_block with those UIDs to add or edit records
- Only call live_ai_skills again if you need a DIFFERENT skill or a DEEPER resource/records not already present here`;
      }
    }
  }

  // Add audio handling guidance only if audio is present in prompt or context
  if (hasAudioContent) {
    systemPrompt += `\n\n## Audio Analysis

When the user provides audio files (either directly in their message or in the context):
- Audio files are automatically transcribed before you receive them
- The transcription will be included in the user's message as "Audio [N] transcription:"
- You should respond naturally to the transcribed content
- If the user asks follow-up questions about the audio, the transcription is already available - just reference it

**Re-analyzing Audio:**
If you determine the user wants a NEW/DIFFERENT analysis of the audio (not just referencing the existing transcription), you can request fresh transcription by including the marker "🔄 REQUEST_FRESH_AUDIO_TRANSCRIPTION" at the very START of your response (before any other text). The system will:
1. Detect this marker
2. Re-transcribe the audio (potentially with different parameters based on user request)
3. Give you the fresh transcription
4. Remove the marker from your response before showing it to the user

**When to request fresh transcription:**
- User explicitly asks to "re-analyze", "analyze again", or wants a "different analysis"
- User mentions they want more detailed transcription, or transcription with different focus
- User asks about specific parts/timestamps that might need fresh analysis

**Important**: Only use this marker when you genuinely believe fresh transcription is needed. Normal follow-up questions can use the cached transcription.`;
  }

  // Add video handling guidance only if video is present in prompt or context
  if (hasVideoContent) {
    systemPrompt += `\n\n## Video Analysis

When the user provides video files or YouTube URLs (either directly in their message or in the context):
- Video content is automatically analyzed using Gemini's multimodal capabilities
- The analysis will be returned directly to the user
- **IMPORTANT**: Video analysis requires a Gemini model - if a non-Gemini model is selected, the user will be notified to switch models

**Supported video formats:**
- YouTube URLs (direct links like https://youtube.com/watch?v=... or https://youtu.be/...)
- Roam video syntax: {{[[video]]: url}} or {{[[youtube]]: url}}
- Direct video file URLs (mp4, webm, etc.)

**Note**: Video analysis happens automatically when video content is detected. You don't need to request or process videos - the system handles this before you see the message.`;
  }

  // Add PDF handling guidance only if PDF is present in prompt or context
  if (hasPdfContent) {
    systemPrompt += `\n\n## PDF Analysis

When the user provides PDF files (either directly in their message or in the context):
- PDF files are automatically analyzed using Gemini's multimodal capabilities
- The analysis will be returned directly to the user
- **IMPORTANT**: PDF analysis requires a Gemini model - if a non-Gemini model is selected, the user will be notified to switch models

**Supported PDF formats:**
- Direct PDF URLs (http://example.com/document.pdf)
- Roam PDF syntax: {{[[pdf]]: url}}
- Firebase-hosted PDFs (automatically decrypted)

**Note**: PDF analysis happens automatically when PDF content is detected. You don't need to request or process PDFs - the system handles this before you see the message.`;
  }

  systemPrompt += `\n\n## Basic syntax contrainsts:

- ${hierarchicalResponseFormat.trim()}
- Generally respects markdown syntax, except where otherwise indicated.
- You can use callouts sparingly to highlight key elements (warnings, tips, important notes, quotes, etc.), relying on Roam specific format: \`[[>]] [[!KEYWORD]] Optional title\` on the first line, followed by content lines (simple line returns, no indentation); a blank line ends the callout. Supported keywords: NOTE, INFO, SUMMARY (or ABSTRACT or TLDR), TIP (or HINT or IMPORTANT), SUCCESS, QUESTION (or HELP or FAQ), WARNING (or CAUTION or ATTENTION), FAILURE (or FAIL or MISSING), DANGER (or ERROR), BUG, EXAMPLE, QUOTE (for famous author quotes only).
- If you write mathematical or LaTex formulas that require correctly formatted symbols, use the Katex format and insert them between two double dollar: '$$formula$$'. For multiline Katex, do not use environments only compatible with display-mode like {align}.`;

  // Add style-specific formatting if provided
  if (style !== "Normal") {
    systemPrompt += `\n\n## Response Style\n\n${await getStylePrompt(style)}`;
  }

  // console.log("Complete systemPrompt :>> ", systemPrompt);

  return systemPrompt;
};

// Build command instructions
export const buildCompleteCommandPrompt = (
  commandPrompt: string | undefined,
  content: string | undefined,
  hasContext: boolean,
): string => {
  let commandInstructions = "";
  if (
    commandPrompt &&
    !commandPrompt.includes("Image generation") &&
    commandPrompt !== "Web search"
  ) {
    const splittedCommand = commandPrompt.split(":");
    commandInstructions = completionCommands[splittedCommand[0]];
    // If custom prompt
    if (!commandInstructions) {
      const customCommand = getCustomPromptByUid(commandPrompt);
      commandInstructions = customCommand?.prompt || " ";
    }

    if (commandInstructions.includes("<target content>"))
      commandInstructions = commandInstructions.replace(
        "<target content>",
        content ||
          (hasContext
            ? "Apply these instructions to the content of '## Available Context' section above"
            : ""),
      );
    else {
      if (content)
        commandInstructions = `Custom instructions: ${commandInstructions}\n\nUser message: ${content}`;
    }

    if (splittedCommand.length > 1)
      commandInstructions = commandInstructions.replace(
        "<language>",
        splittedCommand[1],
      );
  }
  // else if (command.category === "CUSTOM PROMPTS") {
  //   const customCommand = getCustomPromptByUid(command.prompt);
  //   prompt = customCommand.prompt;
  //   if (customCommand.context)
  //     customContext = getUnionContext(
  //       capturedRoamContext,
  //       customCommand.context
  //     );
  // }
  console.log("commandInstructions :>> ", commandInstructions);
  return commandInstructions;
};

// Build conversation context string
export const buildConversationContext = (
  conversationHistory: string[] | undefined,
  conversationSummary: string | undefined,
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
  contextDescription?: string,
): string => {
  if (!results || results.length === 0) {
    return "";
  }

  let context =
    contextDescription ||
    `You are analyzing ${results.length} search result(s).`;

  context += `\n\n`;

  // Format results exactly as FullResultsChat does
  const formattedResults = results
    .map((result, index) => {
      const parts = [];
      const isPage = !result.pageUid; // Pages don't have pageUid property

      // UID (if present)
      if (result.uid && !isPage) {
        parts.push(`<BLOCK>\nUID: ${result.uid}`);
        if (result.pageTitle || result.title) {
          parts.push(`In page: [[${result.pageTitle || result.title}]]`);
        }
        // Parent info (only for blocks that have parent context)
        if (result.expandedBlock?.parent) {
          parts.push(
            `Parent: ${resolveReferences(result.expandedBlock.parent)}`,
          );
        }
      } else
        parts.push(
          `<PAGE>\nTitle: ${
            result.pageTitle || result.title
              ? `[[${result.pageTitle || result.title}]]`
              : "no title found"
          }`,
        );

      // Timestamps - show only date, not time
      if (result.created) {
        const createdStr = String(result.created)
          .split(" ")
          .slice(0, 4)
          .join(" ");
        parts.push(`Created: ${createdStr}`);
      }
      if (result.modified) {
        const modifiedStr = String(result.modified)
          .split(" ")
          .slice(0, 4)
          .join(" ");
        parts.push(`Modified: ${modifiedStr}`);
      }

      // Content (if available)
      if (!isPage && (result.expandedBlock?.original || result.content)) {
        const content = result.expandedBlock?.original || result.content;
        parts.push(`Content:\n${content}`);
      }

      // Children info (if available)
      if (result.expandedBlock?.childrenOutline) {
        parts.push(
          `${isPage ? "Content:\n" : "Children:\n"}${
            result.expandedBlock.childrenOutline
          }`,
        );
      }

      // Only include result if it has at least one displayable field
      if (parts.length === 0) return null;

      return /*`Result ${index + 1}:\n */ `${parts.join("\n")}`;
    })
    .filter((r) => r !== null) // Remove empty results
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
