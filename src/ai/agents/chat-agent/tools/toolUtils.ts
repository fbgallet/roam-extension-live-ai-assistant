/**
 * Shared utilities for Roam chat agent tools.
 *
 * Common helpers used across createBlock, updateBlock, deleteBlock, and createPage tools.
 */

import {
  getParentBlock,
  getPageNameByPageUid,
} from "../../../../utils/roamAPI";

/**
 * Truncate text to a maximum length, adding ellipsis if needed.
 */
export function truncateText(text: string, maxLength: number): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

/**
 * Walk up the block tree to find the containing page name.
 * Returns undefined if no page is found.
 */
export function findContainingPageName(startUid: string): string | undefined {
  let current: string | null = startUid;
  while (current) {
    const pName = getPageNameByPageUid(current);
    if (pName) return pName;
    current = getParentBlock(current);
  }
  return undefined;
}

/**
 * Parse a JSON object from an LLM response string.
 * Handles nested objects, markdown code fences, and other common LLM output quirks.
 * Returns null if no valid JSON object is found.
 */
export function parseJsonFromLLMResponse(responseText: string): any | null {
  // Strip markdown code fences if present
  let cleaned = responseText.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Try parsing the entire cleaned string first
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    // Fall through to bracket matching
  }

  // Find the outermost { ... } using bracket counting
  const startIdx = cleaned.indexOf("{");
  if (startIdx === -1) return null;

  let depth = 0;
  for (let i = startIdx; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.substring(startIdx, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}
