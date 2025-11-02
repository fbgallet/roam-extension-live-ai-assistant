/**
 * Select Results by Criteria Tool
 *
 * Allows the chat agent to select (check) results based on various criteria:
 * - Simple hardcoded filters: date ranges, regex patterns, page titles
 * - Intelligent content analysis: using LLM to evaluate complex criteria
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// Helper to parse dates flexibly
const parseDate = (dateStr: string): Date | null => {
  try {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
};

// Helper to check if a date is within a range
const isDateInRange = (
  date: Date | string | undefined,
  after?: string,
  before?: string
): boolean => {
  if (!date) return false;

  const dateObj = typeof date === "string" ? parseDate(date) : date;
  if (!dateObj) return false;

  const afterDate = after ? parseDate(after) : null;
  const beforeDate = before ? parseDate(before) : null;

  if (afterDate && dateObj < afterDate) return false;
  if (beforeDate && dateObj > beforeDate) return false;

  return true;
};

// Helper to build regex for attribute matching
const buildAttributeRegex = (
  attribute: string,
  values?: string[]
): RegExp | null => {
  try {
    if (!values || values.length === 0) {
      // Match any value for this attribute
      // Format: attribute:: anything
      return new RegExp(`${attribute}::\\s*(.+?)(?:\\n|$)`, "i");
    }

    // Normalize values to match different formats:
    // - Tags: #tag or [[tag]]
    // - Pages: [[page]]
    // - Plain text: word
    const normalizedValues = values.map((value) => {
      // Remove tag/page syntax to get core content
      const normalized = value
        .replace(/^#/, "") // Remove leading #
        .replace(/^\[\[/, "") // Remove leading [[
        .replace(/\]\]$/, "") // Remove trailing ]]
        .trim();

      // Escape special regex characters except those we want to match flexibly
      const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Build flexible pattern that matches:
      // - #tag or [[tag]] or plain tag
      // Allow optional [[, ]], or # before/after
      return `(?:#|\\[\\[)?${escaped}(?:\\]\\])?`;
    });

    // Match attribute:: followed by any of the values
    const valuesPattern = normalizedValues.join("|");
    return new RegExp(
      `${attribute}::\\s*(?:${valuesPattern})`,
      "i" // case insensitive
    );
  } catch (error) {
    console.error("Error building attribute regex:", error);
    return null;
  }
};

// Helper for intelligent content analysis using LLM
const analyzeResultWithLLM = async (
  result: any,
  criteria: string,
  model: any
): Promise<boolean> => {
  const systemPrompt = `You are analyzing a block/page from a Roam Research knowledge graph to determine if it matches specific criteria.

Your task is to evaluate if the content meets the given criteria and respond with ONLY "YES" or "NO" (nothing else).

Be strict and precise in your evaluation. Only return YES if the content clearly matches the criteria.`;

  const resultDescription = `
UID: ${result.uid || result.blockUid || "N/A"}
Content: ${result.content || result.text || ""}
Page: ${result.pageTitle || "N/A"}
${result.parentText ? `Parent: ${result.parentText}` : ""}
${result.created ? `Created: ${result.created}` : ""}
${result.modified ? `Modified: ${result.modified}` : ""}
`;

  const userPrompt = `Criteria: ${criteria}

Result to evaluate:
${resultDescription}

Does this result match the criteria? Answer ONLY with YES or NO.`;

  try {
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    const answer = response.content.toString().trim().toUpperCase();
    return answer === "YES";
  } catch (error) {
    console.error("Error analyzing result with LLM:", error);
    return false;
  }
};

export const selectResultsByCriteriaTool = tool(
  async (input, config) => {
    const {
      criteria_description,
      created_after,
      created_before,
      modified_after,
      modified_before,
      content_regex,
      page_title_regex,
      page_titles,
      attribute_name,
      attribute_values,
      use_llm_analysis,
    } = input;

    const currentContext = config?.configurable?.currentResultsContext || [];
    const selectResultsCallback = config?.configurable?.selectResultsCallback;
    const llm = config?.configurable?.llm; // Get the LLM instance from chat agent

    if (!selectResultsCallback) {
      return "Error: Selection callback not available. This tool requires proper integration with the UI.";
    }

    if (currentContext.length === 0) {
      return "No results available to select from. Please perform a search first or add some results to the context.";
    }

    // Check if LLM is available for intelligent analysis
    if (use_llm_analysis && criteria_description && !llm) {
      return "Error: LLM analysis requested but no model available. This may be a configuration issue.";
    }

    let matchedResults: any[] = [];

    // Filter results based on criteria
    for (const result of currentContext) {
      let matches = true;

      // Date filters - created
      if (created_after || created_before) {
        if (!isDateInRange(result.created, created_after, created_before)) {
          matches = false;
        }
      }

      // Date filters - modified
      if (matches && (modified_after || modified_before)) {
        if (!isDateInRange(result.modified, modified_after, modified_before)) {
          matches = false;
        }
      }

      // Content regex filter
      if (matches && content_regex) {
        try {
          const regex = new RegExp(content_regex, "i");
          const contentToSearch = result.content || result.text || "";
          if (!regex.test(contentToSearch)) {
            matches = false;
          }
        } catch (error) {
          console.error("Invalid content regex:", error);
          matches = false;
        }
      }

      // Page title regex filter
      if (matches && page_title_regex) {
        try {
          const regex = new RegExp(page_title_regex, "i");
          const pageTitle = result.pageTitle || "";
          if (!regex.test(pageTitle)) {
            matches = false;
          }
        } catch (error) {
          console.error("Invalid page title regex:", error);
          matches = false;
        }
      }

      // Specific page titles filter
      if (matches && page_titles && page_titles.length > 0) {
        const pageTitle = result.pageTitle || "";
        if (!page_titles.some((title) => title === pageTitle)) {
          matches = false;
        }
      }

      // Attribute filter
      if (matches && attribute_name) {
        const attributeRegex = buildAttributeRegex(
          attribute_name,
          attribute_values
        );
        if (attributeRegex) {
          const contentToSearch = result.content || result.text || "";
          if (!attributeRegex.test(contentToSearch)) {
            matches = false;
          }
        } else {
          // If regex building failed, fall back to LLM if available
          console.warn(
            `Failed to build regex for attribute "${attribute_name}", falling back to LLM analysis if available`
          );
          if (llm) {
            // Build criteria description for LLM
            const attributeCriteria = attribute_values
              ? `has attribute "${attribute_name}" with value(s): ${attribute_values.join(
                  ", "
                )}`
              : `has attribute "${attribute_name}"`;
            try {
              matches = await analyzeResultWithLLM(
                result,
                attributeCriteria,
                llm
              );
            } catch (error) {
              console.error("Error in LLM analysis for attribute:", error);
              matches = false;
            }
          } else {
            matches = false;
          }
        }
      }

      // LLM-based intelligent analysis
      if (matches && use_llm_analysis && criteria_description && llm) {
        try {
          matches = await analyzeResultWithLLM(
            result,
            criteria_description,
            llm
          );
        } catch (error) {
          console.error("Error in LLM analysis:", error);
          matches = false;
        }
      }

      if (matches) {
        matchedResults.push(result);
      }
    }

    // Get UIDs of matched results
    const selectedUids = matchedResults
      .map((r) => r.uid || r.blockUid || r.pageUid)
      .filter(Boolean);

    if (selectedUids.length === 0) {
      return `No results matched the criteria. Evaluated ${currentContext.length} results but none met the specified conditions.`;
    }

    // Call the selection callback to update UI
    selectResultsCallback(selectedUids);

    console.log(
      `✅ Selected ${selectedUids.length} results out of ${currentContext.length} total results`
    );

    // Build detailed report
    let report = `Successfully selected ${selectedUids.length} out of ${currentContext.length} results.\n\n`;

    report += `Applied filters:\n`;
    if (created_after || created_before) {
      report += `- Created date: ${
        created_after ? `after ${created_after}` : ""
      } ${created_before ? `before ${created_before}` : ""}\n`;
    }
    if (modified_after || modified_before) {
      report += `- Modified date: ${
        modified_after ? `after ${modified_after}` : ""
      } ${modified_before ? `before ${modified_before}` : ""}\n`;
    }
    if (content_regex) {
      report += `- Content matches regex: ${content_regex}\n`;
    }
    if (page_title_regex) {
      report += `- Page title matches regex: ${page_title_regex}\n`;
    }
    if (page_titles && page_titles.length > 0) {
      report += `- Page titles: ${page_titles.join(", ")}\n`;
    }
    if (attribute_name) {
      if (attribute_values && attribute_values.length > 0) {
        report += `- Attribute "${attribute_name}" with values: ${attribute_values.join(
          ", "
        )}\n`;
      } else {
        report += `- Has attribute "${attribute_name}" (any value)\n`;
      }
    }
    if (use_llm_analysis && criteria_description) {
      report += `- Intelligent analysis: ${criteria_description}\n`;
    }

    report += `\nThe ${selectedUids.length} matching results are now checked/selected in the UI.`;

    return report;
  },
  {
    name: "select_results_by_criteria",
    description: `Select (check) results in the UI based on various criteria. This tool filters the current results and marks matching ones as selected.

Use hardcoded filters when possible (faster):
- Date ranges (created_after, created_before, modified_after, modified_before) - use ISO date format like "2024-01-01"
- Content matching patterns (content_regex) - for text pattern matching in block content
- Page title patterns (page_title_regex) - for text pattern matching in page titles
- Specific page titles (page_titles) - exact page title matches
- Roam attributes (attribute_name, attribute_values) - filter by attributes like "author:: [[Victor Hugo]]" or "status:: #done"
  - Handles multiple value formats: tags (#ethics), page links ([[page]]), or plain text
  - Case-insensitive matching
  - Leave attribute_values empty to match any value for the attribute

Use LLM analysis for complex semantic criteria:
- Set use_llm_analysis=true and provide criteria_description
- Examples: "blocks about machine learning", "action items", "questions", "blocks with positive sentiment"
- LLM analysis is slower but handles nuanced criteria
- Automatically used as fallback for complex attribute value matching

You can combine multiple filters - all must match for a result to be selected.`,
    schema: z.object({
      criteria_description: z
        .string()
        .optional()
        .describe(
          "Natural language description of the selection criteria. Used for LLM-based intelligent analysis when use_llm_analysis is true."
        ),
      created_after: z
        .string()
        .optional()
        .describe(
          'Only select results created after this date. Use ISO format: "2024-01-01" or "2024-01-01T10:00:00"'
        ),
      created_before: z
        .string()
        .optional()
        .describe(
          'Only select results created before this date. Use ISO format: "2024-01-01" or "2024-01-01T10:00:00"'
        ),
      modified_after: z
        .string()
        .optional()
        .describe(
          'Only select results modified after this date. Use ISO format: "2024-01-01" or "2024-01-01T10:00:00"'
        ),
      modified_before: z
        .string()
        .optional()
        .describe(
          'Only select results modified before this date. Use ISO format: "2024-01-01" or "2024-01-01T10:00:00"'
        ),
      content_regex: z
        .string()
        .optional()
        .describe(
          'Regular expression to match against block content. Case-insensitive. Example: "meeting|discussion" or "TODO.*urgent"'
        ),
      page_title_regex: z
        .string()
        .optional()
        .describe(
          'Regular expression to match against page titles. Case-insensitive. Example: "project.*2024" or "daily.*notes"'
        ),
      page_titles: z
        .array(z.string())
        .optional()
        .describe(
          "Array of exact page titles to match. Only results from these pages will be selected."
        ),
      attribute_name: z
        .string()
        .optional()
        .describe(
          'Roam attribute name to filter by (e.g., "author", "status", "related concepts"). Matches blocks/pages with this attribute using the format "attribute:: value".'
        ),
      attribute_values: z
        .array(z.string())
        .optional()
        .describe(
          "Array of values to match for the attribute. Handles different formats: tags (#ethics), page links ([[Victor Hugo]]), or plain text. Case-insensitive. Leave empty to match any value for the attribute."
        ),
      use_llm_analysis: z
        .boolean()
        .optional()
        .describe(
          "Set to true to use LLM for intelligent content analysis based on criteria_description. Slower but handles complex semantic criteria."
        ),
    }),
  }
);
