/**
 * Outline Evaluator
 *
 * Generic outline evaluation utility for Roam Research chat agent tools.
 * Provides shared functionality for:
 * - Resolving container UIDs from parent_uid, page_title, or date
 * - Fetching and analyzing outlines with UIDs
 * - Using LLM to find best insertion locations
 * - Using LLM to find blocks matching natural language criteria
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  getPageUidByPageName,
  getPageNameByPageUid,
  getDNPTitleFromDate,
} from "../../../../utils/roamAPI";
import { getFlattenedContentFromTree } from "../../../dataExtraction";

// --- Types ---

export type EvaluationMode =
  | "find_insertion_location"
  | "find_blocks_by_criteria"
  | "analyze_outline";

export interface EvaluationResult {
  mode: EvaluationMode;
  outlineContent?: string;
  containerUid: string;
  isPage: boolean;
  /** For find_insertion_location mode */
  location?: { parentUid: string; order: "first" | "last" | number };
  /** For find_blocks_by_criteria mode */
  matchingBlocks?: Array<{ uid: string; content: string; reason: string }>;
}

export interface ResolvedContainer {
  uid: string;
  description: string;
  isPage: boolean;
  pageName?: string;
}

// --- Shared outline format explanation for LLM prompts ---

const OUTLINE_FORMAT_EXPLANATION = `OUTLINE FORMAT:
Each line shows a block with its UID at the START of the line in ((uid)) format, followed by the block's content.
Example:
  ((abc123def)) Philosophy
    - ((xyz789ghi)) Ethics
    - ((jkl456mno)) Logic

In this example:
- "abc123def" is the UID of the block containing "Philosophy"
- "xyz789ghi" is the UID of the block containing "Ethics" (child of Philosophy)
- "jkl456mno" is the UID of the block containing "Logic" (child of Philosophy)

Nested blocks are indented with "- " prefix.`;

// --- getMainViewContainer ---

/**
 * Gets the current main view container from Roam's UI.
 * Uses getOpenView() which returns a Promise resolving to:
 * - Page outline: { type: "outline", uid: "xxx", title: "Page Title" }
 * - Block outline (zoomed): { type: "outline", uid: "xxx", "block-string": "content" }
 * - Daily notes log: { type: "log" }
 */
export async function getMainViewContainer(): Promise<ResolvedContainer | { error: string }> {
  try {
    const openView = await (window as any).roamAlphaAPI?.ui?.mainWindow?.getOpenView?.();

    console.log("getMainViewContainer openView :>> ", openView);

    if (!openView) {
      return { error: "Could not determine the current main view. Please specify a page_title or parent_uid." };
    }

    // Daily notes log view - use today's DNP
    if (openView.type === "log") {
      const today = new Date();
      const todayTitle = getDNPTitleFromDate(today);
      const todayUid = getPageUidByPageName(todayTitle);
      if (todayUid) {
        return {
          uid: todayUid,
          description: `today's daily note [[${todayTitle}]]`,
          isPage: true,
          pageName: todayTitle,
        };
      }
      return { error: "Could not find today's daily note page. Please specify a page_title or parent_uid." };
    }

    // Outline view (page or zoomed block)
    // Check for uid in different possible locations
    const uid = openView.uid || openView["page-uid"] || openView["block-uid"];

    if (uid) {
      // If it has a title, it's a page
      if (openView.title) {
        return {
          uid,
          description: `page [[${openView.title}]]`,
          isPage: true,
          pageName: openView.title,
        };
      }

      // If it has block-string, it's a zoomed block
      if (openView["block-string"] !== undefined) {
        return {
          uid,
          description: `block ((${uid}))`,
          isPage: false,
        };
      }

      // Fallback: check if it's a page by querying
      const pageName = getPageNameByPageUid(uid);
      const isPage = pageName !== undefined;
      return {
        uid,
        description: isPage ? `page [[${pageName}]]` : `block ((${uid}))`,
        isPage,
        pageName: pageName || undefined,
      };
    }

    return { error: `Unsupported view type: ${JSON.stringify(openView)}. Please specify a page_title or parent_uid.` };
  } catch (error) {
    console.error("Error getting main view container:", error);
    return { error: "Could not access the main view. Please specify a page_title or parent_uid." };
  }
}

// --- resolveContainerUid ---

/**
 * Resolves a container UID from parent_uid, page_title, date, or main view.
 * Priority: parent_uid > page_title > date > use_main_view.
 */
export async function resolveContainerUid(params: {
  parent_uid?: string;
  page_title?: string;
  date?: string;
  use_main_view?: boolean;
}): Promise<ResolvedContainer | { error: string }> {
  const { parent_uid, page_title, date, use_main_view } = params;

  let targetUid: string | null = parent_uid || null;
  let resolvedPageTitle = page_title;

  // If date is provided, convert to DNP title
  if (!targetUid && date) {
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return {
        error: `Invalid date format: "${date}". Please provide a valid date (e.g., "2024-01-15", "January 15, 2024").`,
      };
    }
    resolvedPageTitle = getDNPTitleFromDate(dateObj);
  }

  // If page_title (or resolved DNP title) is provided, convert to UID
  if (!targetUid && resolvedPageTitle) {
    targetUid = getPageUidByPageName(resolvedPageTitle);
    if (!targetUid) {
      return {
        error: `Page "${resolvedPageTitle}" was not found in your graph. Please verify the page exists.`,
      };
    }
  }

  // If use_main_view is true and no other target specified, use main view
  if (!targetUid && use_main_view) {
    return await getMainViewContainer();
  }

  if (!targetUid) {
    return {
      error:
        "Either parent_uid, page_title, date, or use_main_view must be provided to specify a target location.",
    };
  }

  // Validate UID format for explicit parent_uid
  if (parent_uid && !/^[\w-]{9}$/.test(parent_uid)) {
    return {
      error: `Invalid parent_uid format: "${parent_uid}". A valid Roam block UID is exactly 9 characters (alphanumeric and hyphens).`,
    };
  }

  const pageName = getPageNameByPageUid(targetUid);
  const isPage = pageName !== undefined;
  const description = isPage
    ? `page [[${pageName}]]`
    : `block ((${targetUid}))`;

  return { uid: targetUid, description, isPage, pageName };
}

// --- getOutlineContent ---

/**
 * Fetches the flattened outline content for a container with UIDs.
 */
export function getOutlineContent(
  containerUid: string,
  isPage: boolean,
): string | null {
  const outlineContent = getFlattenedContentFromTree({
    parentUid: containerUid,
    maxCapturing: 99,
    maxUid: 99,
    withDash: true,
    isParentToIgnore: isPage,
    forceUids: true,
  });

  if (!outlineContent || outlineContent.trim().length === 0) {
    return null;
  }

  return outlineContent;
}

// --- evaluateOutline ---

/**
 * Generic outline evaluation function supporting multiple modes.
 *
 * Modes:
 * - "analyze_outline": Returns the outline content without LLM call (for analysis/browsing)
 * - "find_insertion_location": Uses LLM to find best parent UID + order for new content
 * - "find_blocks_by_criteria": Uses LLM to find blocks matching natural language criteria
 */
export async function evaluateOutline(params: {
  containerUid: string;
  llm: any;
  mode: EvaluationMode;
  /** Content to insert (for find_insertion_location) */
  contentToInsert?: string;
  /** Natural language search criteria (for find_blocks_by_criteria) */
  searchCriteria?: string;
  /** Max results for find_blocks_by_criteria (default: 5) */
  maxResults?: number;
}): Promise<EvaluationResult | null> {
  const {
    containerUid,
    llm,
    mode,
    contentToInsert,
    searchCriteria,
    maxResults = 5,
  } = params;

  const isPage = getPageNameByPageUid(containerUid) !== undefined;
  const outlineContent = getOutlineContent(containerUid, isPage);

  // --- analyze_outline mode: no LLM call needed ---
  if (mode === "analyze_outline") {
    return {
      mode,
      outlineContent: outlineContent || undefined,
      containerUid,
      isPage,
    };
  }

  // For LLM-based modes, we need both the outline and the LLM
  if (!outlineContent) {
    if (mode === "find_insertion_location") {
      return {
        mode,
        containerUid,
        isPage,
        location: { parentUid: containerUid, order: "first" },
      };
    }
    // Empty container, no blocks to find
    return {
      mode,
      containerUid,
      isPage,
      matchingBlocks: [],
      outlineContent: undefined,
    };
  }

  if (!llm) {
    console.error(
      `evaluateOutline: LLM required for mode "${mode}" but not available`,
    );
    return null;
  }

  // --- find_insertion_location mode ---
  if (mode === "find_insertion_location") {
    return findInsertionLocation(containerUid, outlineContent, contentToInsert || "", llm, isPage);
  }

  // --- find_blocks_by_criteria mode ---
  if (mode === "find_blocks_by_criteria") {
    return findBlocksByCriteria(
      containerUid,
      outlineContent,
      searchCriteria || "",
      maxResults,
      llm,
      isPage,
    );
  }

  return null;
}

// --- Internal: findInsertionLocation ---

async function findInsertionLocation(
  containerUid: string,
  outlineContent: string,
  contentToInsert: string,
  llm: any,
  isPage: boolean,
): Promise<EvaluationResult | null> {
  const systemPrompt = `You are analyzing a Roam Research outline to find the best location to insert new content.

${OUTLINE_FORMAT_EXPLANATION}

Your task is to:
1. Analyze the structure and content of the outline
2. Understand where the new content would fit best logically
3. Return the UID of the block that should become the PARENT of the new content
4. Specify the order: "first" (at beginning of children), "last" (at end of children), or a specific position number (0-indexed)

IMPORTANT:
- Return ONLY a valid JSON object with "parentUid" and "order" fields
- The parentUid must be one of the UIDs shown in ((uid)) format in the outline - this block will become the parent of the inserted content
- If the content should be at the top level of the container (not nested under any existing block), use the container UID provided
- Consider logical grouping, topic relevance, and hierarchical structure`;

  const userPrompt = `Container UID: ${containerUid}

Current outline structure:
${outlineContent}

New content to insert:
${contentToInsert}

Where should this new content be inserted? Return a JSON object like:
{"parentUid": "abc123def", "order": "last"}

Only return the JSON, nothing else.`;

  try {
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    const responseText = response.content.toString().trim();
    console.log("findInsertionLocation response :>> ", responseText);

    const jsonMatch = responseText.match(/\{[^}]+\}/);
    if (!jsonMatch) {
      console.error("LLM did not return valid JSON:", responseText);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.parentUid) {
      console.error("LLM response missing parentUid:", parsed);
      return null;
    }

    // Validate the UID exists in the outline
    if (
      !outlineContent.includes(`((${parsed.parentUid}))`) &&
      parsed.parentUid !== containerUid
    ) {
      console.warn(
        `LLM returned UID ${parsed.parentUid} not found in outline, falling back to container`,
      );
      return {
        mode: "find_insertion_location",
        containerUid,
        isPage,
        location: { parentUid: containerUid, order: "last" },
      };
    }

    return {
      mode: "find_insertion_location",
      containerUid,
      isPage,
      location: {
        parentUid: parsed.parentUid,
        order: parsed.order || "last",
      },
    };
  } catch (error) {
    console.error("Error in LLM analysis for insertion location:", error);
    return null;
  }
}

// --- Internal: findBlocksByCriteria ---

async function findBlocksByCriteria(
  containerUid: string,
  outlineContent: string,
  searchCriteria: string,
  maxResults: number,
  llm: any,
  isPage: boolean,
): Promise<EvaluationResult | null> {
  const systemPrompt = `You are analyzing a Roam Research outline to find blocks matching specific criteria.

${OUTLINE_FORMAT_EXPLANATION}

Your task is to:
1. Read the outline carefully
2. Find block(s) that match the user's description
3. Return a JSON object with a "matches" array

Each match should include:
- "uid": the 9-character UID of the matching block (from the ((uid)) format in the outline)
- "content": the first 100 characters of the block's text content
- "reason": a brief explanation of why this block matches the criteria

IMPORTANT:
- Return ONLY a valid JSON object
- The UIDs must be from the ((uid)) markers in the outline
- Return at most ${maxResults} matches, ordered by relevance
- If no blocks match, return: {"matches": []}`;

  const userPrompt = `Container UID: ${containerUid}

Current outline structure:
${outlineContent}

Search criteria: ${searchCriteria}

Find blocks matching these criteria. Return a JSON object like:
{"matches": [{"uid": "abc123def", "content": "Block content here...", "reason": "Matches because..."}]}

Only return the JSON, nothing else.`;

  try {
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    const responseText = response.content.toString().trim();
    console.log("findBlocksByCriteria response :>> ", responseText);

    // Parse JSON - handle potential nested objects
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("LLM did not return valid JSON:", responseText);
      return {
        mode: "find_blocks_by_criteria",
        containerUid,
        isPage,
        outlineContent,
        matchingBlocks: [],
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const matches = Array.isArray(parsed.matches) ? parsed.matches : [];

    // Validate UIDs exist in the outline
    const validatedMatches = matches
      .filter((match: any) => {
        if (!match.uid) return false;
        return outlineContent.includes(`((${match.uid}))`);
      })
      .slice(0, maxResults)
      .map((match: any) => ({
        uid: match.uid,
        content: String(match.content || "").substring(0, 100),
        reason: String(match.reason || ""),
      }));

    return {
      mode: "find_blocks_by_criteria",
      containerUid,
      isPage,
      outlineContent,
      matchingBlocks: validatedMatches,
    };
  } catch (error) {
    console.error("Error in LLM analysis for block search:", error);
    return null;
  }
}
