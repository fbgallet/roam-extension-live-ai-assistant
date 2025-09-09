import type { SearchCondition } from "../../helpers/searchUtils";
import type { HierarchicalExpression, SearchTerm, CompoundExpression, ParsedExpression } from "./schemas";

/**
 * Parse simple compound condition from string expressions like "(A + B)", "(A | B | C)", "(A + B - C)"
 * Returns null if the expression is too complex for simple path
 */
export const parseSimpleCompoundCondition = (expression: string): any | null => {
  const trimmed = expression.trim();

  // Must be wrapped in parentheses for compound conditions
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) {
    return null;
  }

  const inner = trimmed.slice(1, -1).trim();

  // Check for mixed operators (complex case - return null)
  const hasAnd = inner.includes("+");
  const hasOr = inner.includes("|");

  if (hasAnd && hasOr) {
    return null;
  }

  let operator: "AND" | "OR";
  let delimiter: string;

  if (hasOr) {
    operator = "OR";
    delimiter = "|";
  } else if (hasAnd) {
    operator = "AND";
    delimiter = "+";
  } else {
    // Single term in parentheses - treat as simple condition
    return parseSimpleSearchCondition(inner);
  }

  // Split and parse individual conditions
  const terms = inner.split(delimiter).map((t) => t.trim());
  const conditions: any[] = [];

  for (const term of terms) {
    // Handle NOT logic: terms starting with "-"
    let negate = false;
    let cleanTerm = term;

    if (term.startsWith("-")) {
      negate = true;
      cleanTerm = term.slice(1).trim();
    }

    const condition = parseSimpleSearchCondition(cleanTerm);
    if (condition) {
      condition.negate = negate;
      conditions.push(condition);
    } else {
      // If any term is too complex, fallback to LLM decomposition
      return null;
    }
  }

  return {
    operator,
    conditions,
  };
};

/**
 * Parse simple search condition from string like "Machine Learning", "ref:AI", "regex:pattern"
 */
export const parseSimpleSearchCondition = (text: string): any | null => {
  const trimmed = text.trim();

  // Remove quotes if present
  let cleanText = trimmed;
  if (
    (cleanText.startsWith('"') && cleanText.endsWith('"')) ||
    (cleanText.startsWith("'") && cleanText.endsWith("'"))
  ) {
    cleanText = cleanText.slice(1, -1).trim();
  }

  // Check for type prefixes
  if (cleanText.startsWith("ref:")) {
    return {
      type: "page_ref",
      text: cleanText.slice(4).trim(),
      matchType: "contains",
    };
  }

  if (cleanText.startsWith("regex:")) {
    const regexPattern = cleanText.slice(6).trim();
    // Handle regex:/pattern/[flags] format
    const regexMatch = regexPattern.match(/^\/(.+)\/([gimuy]*)$/);
    if (regexMatch) {
      return {
        type: "regex",
        text: regexMatch[1],
        matchType: "regex",
      };
    } else {
      return {
        type: "regex",
        text: regexPattern,
        matchType: "regex",
      };
    }
  }

  if (cleanText.startsWith("text:")) {
    return {
      type: "text",
      text: cleanText.slice(5).trim(),
      matchType: "contains",
    };
  }

  // Default to text condition
  return {
    type: "text",
    text: cleanText,
    matchType: "contains",
  };
};

/**
 * Parse hierarchical expressions like "A => B", "A <=> (B + C)", etc.
 */
export const parseHierarchicalExpression = (
  expression: string
): ParsedExpression | null => {
  try {
    // Clean up the expression
    const cleanExpr = expression.trim();

    // Check for hierarchical operators (in order of specificity)
    const hierarchicalOperators = [
      {
        pattern: /<<=>>/,
        type: "deep_bidirectional" as const,
        operator: "<<=>>" as const,
      },
      {
        pattern: /<=>/,
        type: "bidirectional" as const,
        operator: "<=>" as const,
      },
      {
        pattern: /<<=/,
        type: "deep_flexible_hierarchy" as const,
        operator: "<<=" as const,
      },
      {
        pattern: /=>>/,
        type: "flexible_hierarchy_right" as const,
        operator: "=>>" as const,
      },
      {
        pattern: />>/,
        type: "deep_strict_hierarchy" as const,
        operator: ">>" as const,
      },
      {
        pattern: /<</,
        type: "deep_strict_hierarchy_left" as const,
        operator: "<<" as const,
      },
      {
        pattern: /=>/,
        type: "flexible_hierarchy" as const,
        operator: "=>" as const,
      },
      {
        pattern: /<=/,
        type: "flexible_hierarchy_left" as const,
        operator: "<=" as const,
      },
      {
        pattern: />/,
        type: "strict_hierarchy" as const,
        operator: ">" as const,
      },
      {
        pattern: /</,
        type: "strict_hierarchy_left" as const,
        operator: "<" as const,
      },
    ];

    for (const { pattern, type, operator } of hierarchicalOperators) {
      const match = cleanExpr.match(
        new RegExp(`^(.+?)\\s*${pattern.source}\\s*(.+)$`)
      );
      if (match) {
        const [, leftPart, rightPart] = match;

        return {
          type,
          operator,
          leftOperand: parseOperand(leftPart.trim()),
          rightOperand: parseOperand(rightPart.trim()),
          maxDepth: type === "deep_bidirectional" ? 5 : 3,
        };
      }
    }

    // If no hierarchical operators found, treat as simple search term
    return parseOperand(cleanExpr);
  } catch (error) {
    console.error("Error parsing hierarchical expression:", error);
    return null;
  }
};

/**
 * Parse individual operands (supports parentheses and AND/OR logic)
 */
export const parseOperand = (operand: string): SearchTerm | CompoundExpression => {
  const trimmed = operand.trim();

  // Handle parentheses
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return parseOperand(trimmed.slice(1, -1));
  }

  // Check for AND/OR operators
  const orMatch = trimmed.split(/\s*\|\s*/);
  if (orMatch.length > 1) {
    return {
      type: "compound",
      operator: "OR",
      operands: orMatch.map((term) => parseOperand(term.trim())),
    };
  }

  const andMatch = trimmed.split(/\s*\+\s*/);
  if (andMatch.length > 1) {
    return {
      type: "compound",
      operator: "AND",
      operands: andMatch.map((term) => parseOperand(term.trim())),
    };
  }

  // Simple search term - strip multiple layers of quotes if they exist
  let cleanText = trimmed;

  // ENHANCED: Remove multiple layers of quotes that might come from ReAct parsing
  // Handle patterns like: ""Machine Learning"" or '"AI"' or "'Neural Networks'"
  while (
    (cleanText.startsWith('"') && cleanText.endsWith('"')) ||
    (cleanText.startsWith("'") && cleanText.endsWith("'"))
  ) {
    const before = cleanText;
    cleanText = cleanText.slice(1, -1).trim();
    if (before === cleanText) break; // Prevent infinite loop
  }

  // Parse special patterns: ref:, regex:
  if (cleanText.startsWith("ref:")) {
    const pageTitle = cleanText.slice(4).trim();
    return {
      type: "term",
      text: pageTitle,
      searchType: "page_ref",
    };
  }

  if (cleanText.startsWith("regex:")) {
    const regexPattern = cleanText.slice(6).trim();
    // Handle regex:/pattern/[flags] format
    const regexMatch = regexPattern.match(/^\/(.+)\/([gimuy]*)$/);
    if (regexMatch) {
      return {
        type: "term",
        text: regexMatch[1], // Pattern without slashes
        searchType: "regex",
        regexFlags: regexMatch[2] || "",
      };
    } else {
      // Plain regex pattern without slashes
      return {
        type: "term",
        text: regexPattern,
        searchType: "regex",
      };
    }
  }

  // Handle text:(term1 | term2 | term3) syntax for text content search
  if (cleanText.startsWith("text:")) {
    const textContent = cleanText.slice(5).trim();

    // Handle text:(term1 | term2 | term3) and text:(term1 + term2 + term3) syntax
    if (textContent.startsWith("(") && textContent.endsWith(")")) {
      const innerTerms = textContent.slice(1, -1).trim();

      // Check for OR logic first
      const orTerms = innerTerms.split(/\s*\|\s*/);
      if (orTerms.length > 1) {
        return {
          type: "compound",
          operator: "OR",
          operands: orTerms.map((term) => ({
            type: "term",
            text: term.trim(),
            searchType: "text",
          })),
        };
      }

      // Check for AND logic
      const andTerms = innerTerms.split(/\s*\+\s*/);
      if (andTerms.length > 1) {
        return {
          type: "compound",
          operator: "AND",
          operands: andTerms.map((term) => ({
            type: "term",
            text: term.trim(),
            searchType: "text",
          })),
        };
      }
    }

    return {
      type: "term",
      text: textContent,
      searchType: "text",
    };
  }

  return {
    type: "term",
    text: cleanText,
    searchType: "text",
  };
};