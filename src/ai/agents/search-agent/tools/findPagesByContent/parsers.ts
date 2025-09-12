import type { AttributeCondition, AttributeValue } from "./schemas";

/**
 * Parse attribute condition from string format:
 * - attr:key:type:value or attr:key:type:(A + B - C)
 * - attr:key:value (defaults to page_ref type for backward compatibility)
 */
export const parseAttributeCondition = (text: string): AttributeCondition | null => {
  // Try full format first: attr:key:type:value
  let match = text.match(/^attr:([^:]+):([^:]+):(.+)$/);
  if (match) {
    const [, attributeKey, valueType, valueExpression] = match;

    // Normalize and validate value type
    let normalizedValueType = valueType;
    if (valueType === "ref") {
      normalizedValueType = "page_ref"; // Allow 'ref' as shorthand for 'page_ref'
    }

    if (!["text", "page_ref", "regex"].includes(normalizedValueType)) {
      console.warn(`Invalid attribute value type: ${valueType}`);
      return null;
    }

    // Parse logical expression: (A + B - C) or (A | B | C)
    if (valueExpression.startsWith("(") && valueExpression.endsWith(")")) {
      const expression = valueExpression.slice(1, -1);
      const values = parseLogicalExpression(expression);
      return { attributeKey, valueType: normalizedValueType as any, values };
    }

    // Simple single value
    return {
      attributeKey,
      valueType: normalizedValueType as any,
      values: [{ value: valueExpression, operator: "+" }],
    };
  }

  // Try short format: attr:key:value (assume page_ref type)
  match = text.match(/^attr:([^:]+):(.+)$/);
  if (match) {
    const [, attributeKey, valueExpression] = match;

    // Parse logical expression: (A + B - C) or (A | B | C)
    if (valueExpression.startsWith("(") && valueExpression.endsWith(")")) {
      const expression = valueExpression.slice(1, -1);
      const values = parseLogicalExpression(expression);
      return { attributeKey, valueType: "page_ref", values };
    }

    // Simple single value
    return {
      attributeKey,
      valueType: "page_ref",
      values: [{ value: valueExpression, operator: "+" }],
    };
  }

  return null;
};

/**
 * Parse logical expression like "A + B - C" or "A | B | C"
 */
export const parseLogicalExpression = (expr: string): AttributeValue[] => {
  const tokens = expr.split(/(\s*[+|\-]\s*)/).filter((t) => t.trim());
  const values: AttributeValue[] = [];
  let currentOp: "+" | "|" | "-" = "+"; // default to AND

  for (const token of tokens) {
    const trimmed = token.trim();
    if (["+", "|", "-"].includes(trimmed)) {
      currentOp = trimmed as any;
    } else if (trimmed) {
      values.push({ value: trimmed, operator: currentOp });
    }
  }

  // Special case: if the first value doesn't have an explicit operator,
  // and we have OR values, make the first value part of the OR group
  if (values.length > 1) {
    const hasOr = values.some((v) => v.operator === "|");
    if (hasOr && values[0].operator === "+") {
      // Check if this is a pure OR expression (like "A | B | C")
      const hasExplicitAnd = expr.includes("+");
      if (!hasExplicitAnd) {
        values[0].operator = "|"; // Make first value part of OR group
      }
    }
  }

  return values;
};

/**
 * Escape regex special characters for safe pattern building
 */
export const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/**
 * Escape regex for Datomic - requires doubling backslashes
 */
export const escapeForDatomic = (pattern: string): string => {
  return pattern.replace(/\\/g, "\\\\");
};

/**
 * Build value pattern based on type (text, page_ref, regex)
 */
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

export const buildValuePattern = (value: string, type: string): string => {
  switch (type) {
    case "page_ref": {
      // Handle all Roam page reference formats:
      // [[page ref]], #[[page ref]], #page
      const cleanValue = value.replace(/^#/, ""); // Remove leading # if present
      const escapedValue = escapeRegex(cleanValue);

      // For Datomic: need to escape brackets as \\\\[ and \\\\] (quadruple backslash)
      // Simplified pattern: #?\\[\\[title\\]\\] covers both [[title]] and #[[title]]
      // Also handle simple #tag format for single words
      if (cleanValue.includes(" ")) {
        // Multi-word: must use [[]] format, optionally with #
        return escapeForDatomic(`#?\\[\\[${escapedValue}\\]\\]`);
      } else {
        // Single word: can be [[word]], #[[word]], or #word
        return escapeForDatomic(
          `(?:#?\\[\\[${escapedValue}\\]\\]|#${escapedValue}(?!\\w))`
        );
      }
    }
    case "text":
      return escapeForDatomic(escapeRegex(value));
    case "regex":
      return escapeForDatomic(value); // Apply Datomic escaping to user regex
    default:
      return escapeForDatomic(escapeRegex(value));
  }
};