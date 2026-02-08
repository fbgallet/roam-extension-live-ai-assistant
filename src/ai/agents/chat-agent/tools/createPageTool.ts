/**
 * Create Page Tool
 *
 * Tool for creating pages in Roam from markdown content.
 * Uses the Roam Alpha API's page.fromMarkdown method.
 *
 * Special handling:
 * - If the user requests a date page (DNP), converts ISO date to Roam's DNP format
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

export const createPageTool = tool(
  async (
    input: { page_title?: string; date?: string; markdown_content: string },
    config,
  ) => {
    const { page_title, date, markdown_content } = input;

    console.log("createPageTool input :>> ", {
      page_title,
      date,
      markdown_content: markdown_content?.substring(0, 100),
    });

    // Determine the final page title
    let finalTitle: string;
    let isDNP = false;

    if (date) {
      // Parse ISO date format (YYYY-MM-DD)
      const dateObj = new Date(date);
      if (isNaN(dateObj.getTime())) {
        return `⚠️ Invalid date format: "${date}". Please provide a valid ISO date (YYYY-MM-DD format, e.g., "2024-01-15").`;
      }
      finalTitle = getDNPTitleFromDate(dateObj);
      isDNP = true;
      console.log(`Converted ISO date "${date}" to DNP format: "${finalTitle}"`);
    } else if (page_title && page_title.trim().length > 0) {
      finalTitle = page_title.trim();
    } else {
      return "⚠️ Either page_title or date must be provided. Use page_title for regular pages, or date (ISO format YYYY-MM-DD) for Daily Notes Pages.";
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
          is_new_page: true,
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
        const dateNote = isDNP && date
          ? ` (Daily Notes Page for ${date})`
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

FOR DAILY NOTES PAGES (DNP):
- Use the "date" parameter with ISO format (YYYY-MM-DD), e.g., "2024-01-15"
- The date will be converted to Roam's DNP title format automatically

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
        .optional()
        .describe(
          "The title of the page to create. Use this for regular pages. For Daily Notes Pages, use the 'date' parameter instead."
        ),
      date: z
        .string()
        .optional()
        .describe(
          "ISO date format (YYYY-MM-DD) to create a Daily Notes Page. Example: '2024-01-15' creates the DNP for January 15th, 2024. Use this instead of page_title for date-based pages."
        ),
      markdown_content: z
        .string()
        .describe(
          "The markdown content to add to the page. Supports headings, lists (nested become nested blocks), code blocks, bold, italic, links, etc. Can be empty if you just want to create an empty page."
        ),
    }),
  }
);
