/**
 * Create Page Tool
 *
 * Tool for creating pages in Roam from markdown content.
 * Uses the Roam Alpha API's page.fromMarkdown method.
 *
 * Special handling:
 * - If the user requests a date page (DNP), converts to Roam's DNP format
 * - Checks if page already exists before creating
 * - If page exists, offers to append content using createBlock
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  getPageUidByPageName,
  getDNPTitleFromDate,
  isExistingBlock,
} from "../../../../utils/roamAPI";

/**
 * Attempts to parse a date from various formats and return the DNP title
 */
const parseDateToRoamDNP = (input: string): string | null => {
  // Common date patterns to try
  const datePatterns = [
    // "today", "tomorrow", "yesterday"
    /^today$/i,
    /^tomorrow$/i,
    /^yesterday$/i,
    // "January 15, 2024" or "January 15th, 2024"
    /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}$/i,
    // "15 January 2024" or "15th January 2024"
    /^\d{1,2}(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december),?\s*\d{4}$/i,
    // "2024-01-15" ISO format
    /^\d{4}-\d{2}-\d{2}$/,
    // "01/15/2024" or "15/01/2024"
    /^\d{1,2}\/\d{1,2}\/\d{4}$/,
    // "next monday", "last friday", etc.
    /^(next|last)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i,
  ];

  const lowerInput = input.toLowerCase().trim();

  // Handle relative dates
  if (lowerInput === "today") {
    return getDNPTitleFromDate(new Date());
  }
  if (lowerInput === "tomorrow") {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return getDNPTitleFromDate(tomorrow);
  }
  if (lowerInput === "yesterday") {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return getDNPTitleFromDate(yesterday);
  }

  // Handle "next/last weekday"
  const relativeWeekdayMatch = lowerInput.match(
    /^(next|last)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i
  );
  if (relativeWeekdayMatch) {
    const direction = relativeWeekdayMatch[1].toLowerCase();
    const targetDay = relativeWeekdayMatch[2].toLowerCase();
    const dayMap: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    const targetDayNum = dayMap[targetDay];
    const today = new Date();
    const currentDay = today.getDay();
    let diff: number;

    if (direction === "next") {
      diff = targetDayNum - currentDay;
      if (diff <= 0) diff += 7;
    } else {
      diff = targetDayNum - currentDay;
      if (diff >= 0) diff -= 7;
    }

    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + diff);
    return getDNPTitleFromDate(targetDate);
  }

  // Try to parse as a regular date
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime())) {
    // Check if the input looks like a date (matches any date pattern)
    const looksLikeDate = datePatterns.some((pattern) => pattern.test(input));
    if (looksLikeDate) {
      return getDNPTitleFromDate(parsed);
    }
  }

  // Not a date
  return null;
};

export const createPageTool = tool(
  async (
    input: { page_title: string; markdown_content: string },
    config,
  ) => {
    const { page_title, markdown_content } = input;

    console.log("createPageTool input :>> ", {
      page_title,
      markdown_content: markdown_content?.substring(0, 100),
    });

    if (!page_title || page_title.trim().length === 0) {
      return "⚠️ No page title provided. Please provide a title for the page.";
    }

    // Check if the title is a date and convert to DNP format if needed
    let finalTitle = page_title.trim();
    const dnpTitle = parseDateToRoamDNP(page_title);
    if (dnpTitle) {
      finalTitle = dnpTitle;
      console.log(`Converted date "${page_title}" to DNP format: "${dnpTitle}"`);
    }

    // === CONFIRMATION FLOW FOR PAGE CREATION ===
    const toolConfirmationCallback = config?.configurable?.toolConfirmationCallback;
    const alwaysApprovedTools = config?.configurable?.alwaysApprovedTools as Set<string> | undefined;

    // Check if this tool has been "always approved" for this session
    const isAlwaysApproved = alwaysApprovedTools?.has("create_page");

    if (toolConfirmationCallback && !isAlwaysApproved) {
      // Generate a unique tool call ID for this confirmation
      const toolCallId = `create_page_${Date.now()}`;

      // Request confirmation from the user
      const confirmationResult = await toolConfirmationCallback({
        toolName: "create_page",
        toolCallId,
        args: {
          page_title: finalTitle,
          markdown_content,
        },
      });

      if (!confirmationResult.approved) {
        // User declined - return a message that the LLM can process
        const reason = confirmationResult.declineReason
          ? `\n\nUser's feedback: "${confirmationResult.declineReason}"`
          : "";
        return `⚠️ Page creation was declined by the user.${reason}\n\nPlease ask the user what changes they'd like you to make, or if they'd like to proceed differently.`;
      }

      // Note: If alwaysApprove was set, the UI layer will update alwaysApprovedTools
      // for subsequent calls in this session
    }

    try {
      // Check if the Roam API is available
      const roamAPI = (window as any).roamAlphaAPI;
      if (!roamAPI?.data?.page?.fromMarkdown) {
        return "Error: Roam Alpha API (page.fromMarkdown) is not available. This tool requires Roam Research with the Alpha API enabled.";
      }

      // Check if page already exists
      const existingPageUid = getPageUidByPageName(finalTitle);
      if (existingPageUid && isExistingBlock(existingPageUid)) {
        // Page exists - return a message with the option to append
        return `⚠️ Page "[[${finalTitle}]]" already exists (UID: ${existingPageUid}).\n\nTo add this content to the existing page, use the create_block tool with:\n- page_title: "${finalTitle}"\n- markdown_content: (your content)\n\nWould you like me to append the content to the existing page instead?`;
      }

      // Create the page with markdown content
      const result = await roamAPI.data.page.fromMarkdown({
        page: {
          title: finalTitle,
        },
        "markdown-string": markdown_content || "",
      });

      console.log("createPageTool result :>> ", result);

      // Get the new page UID
      const newPageUid = getPageUidByPageName(finalTitle);

      if (newPageUid) {
        const dateNote =
          dnpTitle && dnpTitle !== page_title
            ? ` (converted from "${page_title}" to Roam DNP format)`
            : "";
        return `✅ Page "[[${finalTitle}]]" created successfully${dateNote}.\nPage UID: ${newPageUid}\n\nThe page has been created in your graph with the provided content.`;
      }

      return `✅ Page "[[${finalTitle}]]" creation initiated. The page should now be available in your graph.`;
    } catch (error) {
      console.error("Error creating page from markdown:", error);
      return `Error: Failed to create page. ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
    }
  },
  {
    name: "create_page",
    description: `Create a new page in Roam from markdown content. The markdown content will be parsed and converted into blocks on the page.

IMPORTANT: After successfully using this tool, DO NOT repeat the content in your response. Simply confirm the page was created. The user can view the content directly in their graph.

SPECIAL HANDLING FOR DATES:
- If the user asks to create a page for a date (e.g., "today", "tomorrow", "January 15, 2024", "next Monday"), the title will be automatically converted to Roam's Daily Notes Page (DNP) format.
- Examples: "today" → "January 31, 2024", "tomorrow" → "February 1, 2024"

PAGE EXISTENCE CHECK:
- Before creating, the tool checks if the page already exists.
- If it exists, it will NOT create a duplicate but will suggest using create_block to append content to the existing page.

Use this tool when:
- User wants to create a new page with specific content
- User wants to create a daily note page with content
- User explicitly asks to "create a page" or "make a new page"`,
    schema: z.object({
      page_title: z
        .string()
        .describe(
          "The title of the page to create. For date pages (DNPs), you can use natural language like 'today', 'tomorrow', 'January 15, 2024', 'next Monday' - it will be converted to Roam's DNP format automatically."
        ),
      markdown_content: z
        .string()
        .describe(
          "The markdown content to add to the page. Supports headings, lists (nested become nested blocks), code blocks, bold, italic, links, etc. Can be empty if you just want to create an empty page."
        ),
    }),
  }
);
