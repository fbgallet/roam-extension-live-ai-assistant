/**
 * Parsing and pattern creation utilities for blocks-by-content searches
 */

/**
 * Extract user-requested limit from query (e.g., "2 random results", "first 5 pages", "show me 10 blocks")
 */
export const extractUserRequestedLimit = (userQuery: string): number | null => {
  const query = userQuery.toLowerCase();

  // Pattern 1: "N results", "N random results", "N pages", "N blocks"
  const numberResultsMatch = query.match(
    /(\d+)\s+(random\s+)?(results?|pages?|blocks?)/
  );
  if (numberResultsMatch) {
    const num = parseInt(numberResultsMatch[1], 10);
    if (num > 0 && num <= 500) {
      // Reasonable bounds
      return num;
    }
  }

  // Pattern 2: "first N", "top N", "show me N"
  const firstNMatch = query.match(/(first|top|show me)\s+(\d+)/);
  if (firstNMatch) {
    const num = parseInt(firstNMatch[2], 10);
    if (num > 0 && num <= 500) {
      return num;
    }
  }

  // Pattern 3: "limit to N", "max N", "up to N"
  const limitMatch = query.match(/(limit to|max|up to)\s+(\d+)/);
  if (limitMatch) {
    const num = parseInt(limitMatch[2], 10);
    if (num > 0 && num <= 500) {
      return num;
    }
  }

  return null; // No specific limit found
};

/**
 * Create regex pattern for page references that matches Roam syntax but not plain text
 * Supports: [[title]], #title, title:: but NOT plain "title"
 */
export const createPageRefRegexPattern = (pageTitle: string): string => {
  // Escape special regex characters in the page title
  const escapedTitle = pageTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Optimized pattern: [[title]], #title, or title::
  return `(?:\\[\\[${escapedTitle}\\]\\]|#${escapedTitle}(?!\\w)|${escapedTitle}::)`;
};

/**
 * Create optimized regex pattern for multiple page reference variations
 * Creates a single efficient OR pattern instead of multiple separate patterns
 */
export const createMultiPageRefRegexPattern = (pageNames: string[]): string => {
  if (pageNames.length === 0) return "";
  if (pageNames.length === 1) return createPageRefRegexPattern(pageNames[0]);

  // Escape and prepare all page names
  const escapedNames = pageNames.map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );

  // Create alternation of just the terms
  const termAlternation = escapedNames.join("|");

  // Single optimized pattern: factors out common Roam syntax structures
  return `(?:\\[\\[(?:${termAlternation})\\]\\]|#(?:${termAlternation})(?!\\w)|(?:${termAlternation})::)`;
};