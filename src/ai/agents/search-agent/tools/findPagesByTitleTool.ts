import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  executeDatomicQuery,
  isDailyNote,
  filterByDateRange,
  createToolResult,
} from "./searchUtils";
import { dnpUidRegex } from "../../../../utils/regex.js";

/**
 * Find pages by title conditions with flexible matching
 * Security Level: Secure (only accesses UIDs, titles, metadata)
 */

const titleConditionSchema = z.object({
  text: z.string().min(1, "Search text is required"),
  matchType: z.enum(["exact", "contains", "regex"]).default("contains"),
  weight: z.number().min(0).max(10).default(1.0),
  negate: z.boolean().default(false)
});

const schema = z.object({
  conditions: z.array(titleConditionSchema).min(1, "At least one condition is required"),
  combineConditions: z.enum(["AND", "OR"]).default("AND"),
  includeDaily: z.boolean().default(false),
  dateRange: z
    .object({
      start: z.union([z.date(), z.string()]).optional(),
      end: z.union([z.date(), z.string()]).optional(),
    })
    .optional(),
  limit: z.number().min(1).max(1000).default(100),
});

const findPagesByTitleImpl = async (input: z.infer<typeof schema>) => {
  const { conditions, combineConditions, includeDaily, dateRange, limit } = input;

  // Build base query for all pages
  let query = `[:find ?uid ?title ?created ?modified
                :where 
                [?page :node/title ?title]
                [?page :block/uid ?uid]
                [?page :create/time ?created]
                [?page :edit/time ?modified]`;

  // Add DNP filtering if needed
  if (!includeDaily) {
    query += `\n                [(re-pattern "${dnpUidRegex.source.slice(
      1,
      -1
    )}") ?dnp-pattern]
                (not [(re-find ?dnp-pattern ?uid)])`;
  }

  query += `]`;

  // Get all pages and filter in memory for better performance with different match types
  const allPages = await executeDatomicQuery(query);

  // Apply multi-condition filtering
  const filteredPages = allPages.filter(([uid, title]) => {
    const conditionResults = conditions.map(condition => {
      let matches = false;
      
      switch (condition.matchType) {
        case "exact":
          matches = title === condition.text;
          break;
        
        case "regex":
          try {
            const regex = new RegExp(condition.text, "i");
            matches = regex.test(title);
          } catch (error) {
            throw new Error(`Invalid regex pattern: ${condition.text}`);
          }
          break;
        
        case "contains":
        default:
          matches = title.toLowerCase().includes(condition.text.toLowerCase());
          break;
      }
      
      // Apply negation if specified
      return condition.negate ? !matches : matches;
    });

    // Combine conditions based on logic
    if (combineConditions === "AND") {
      return conditionResults.every(result => result);
    } else {
      return conditionResults.some(result => result);
    }
  });

  // Convert to structured results with relevance scoring
  let results = filteredPages.map(([uid, title, created, modified]) => {
    // Calculate relevance score based on condition weights and matches
    let relevanceScore = 0;
    const titleLower = title.toLowerCase();
    
    for (const condition of conditions) {
      const textLower = condition.text.toLowerCase();
      let conditionScore = 0;
      
      if (condition.matchType === 'exact' && title === condition.text) {
        conditionScore = 10;
      } else if (titleLower.includes(textLower)) {
        // Boost score for exact word matches vs partial matches
        const exactWordMatch = new RegExp(`\\b${textLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(titleLower);
        conditionScore = exactWordMatch ? 5 : 2;
      }
      
      relevanceScore += conditionScore * condition.weight;
    }
    
    return {
      uid,
      title,
      created: new Date(created),
      modified: new Date(modified),
      isDaily: isDailyNote(uid),
      relevanceScore,
      matchedConditions: conditions.map(c => c.text)
    };
  });

  // Apply date range filtering for DNPs if specified
  if (dateRange && (dateRange.start || dateRange.end) && includeDaily) {
    const parsedDateRange = {
      start: typeof dateRange.start === 'string' ? new Date(dateRange.start) : dateRange.start,
      end: typeof dateRange.end === 'string' ? new Date(dateRange.end) : dateRange.end
    };
    results = filterByDateRange(results, parsedDateRange);
  }

  // Sort by relevance score first, then by modification time
  results.sort((a, b) => {
    if (a.relevanceScore !== b.relevanceScore) {
      return b.relevanceScore - a.relevanceScore; // Higher score first
    }
    return b.modified.getTime() - a.modified.getTime(); // Most recent first
  });

  // Limit results
  if (results.length > limit) {
    results = results.slice(0, limit);
  }

  return results;
};

export const findPagesByTitleTool = tool(
  async (input) => {
    const startTime = performance.now();
    try {
      const results = await findPagesByTitleImpl(input);
      return createToolResult(
        true,
        results,
        undefined,
        "findPagesByTitle",
        startTime
      );
    } catch (error) {
      console.error("FindPagesByTitle tool error:", error);
      return createToolResult(
        false,
        undefined,
        error.message,
        "findPagesByTitle",
        startTime
      );
    }
  },
  {
    name: "findPagesByTitle",
    description:
      "Find pages by title using multiple conditions with AND/OR logic. Supports exact, contains, or regex matching, condition weights, negation, DNP filtering and date ranges.",
    schema,
  }
);
