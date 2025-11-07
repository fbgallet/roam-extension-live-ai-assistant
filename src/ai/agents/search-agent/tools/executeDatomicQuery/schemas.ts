import { z } from "zod";

// Schema supporting multiple modes: auto-generate, user-provided, or parameterized queries
export const schema = z.object({
  // Mode 1: Auto-generate from criteria (original functionality)
  queryDescription: z
    .string()
    .optional()
    .describe(
      "Natural language description of what you want to find (for auto-generated queries)"
    ),
  targetEntity: z
    .enum(["block", "page"])
    .optional()
    .describe(
      "Whether to search for blocks or pages (for auto-generated queries)"
    ),
  searchTerms: z
    .array(z.string())
    .optional()
    .describe("Key terms to search for (for auto-generated queries)"),
  conditionLogic: z
    .enum(["AND", "OR"])
    .default("AND")
    .describe("How to combine search conditions"),
  includeDaily: z
    .boolean()
    .default(true)
    .describe("Include Daily Note Pages in results"),
  limitResults: z
    .number()
    .min(1)
    .max(1000)
    .default(100)
    .describe("Maximum number of results to return"),
  limitToPages: z
    .array(z.string())
    .optional()
    .describe(
      "Limit search to blocks within specific pages (by page title). Use this for 'in page [[X]]' queries."
    ),
  pageMatchType: z
    .enum(["exact", "contains", "regex"])
    .default("exact")
    .describe("How to match page titles when limitToPages is used"),

  // Mode 2: User-provided query
  query: z
    .string()
    .optional()
    .describe(
      "Raw Datalog query to execute directly (alternative to auto-generation)"
    ),

  // Mode 3: Parameterized queries
  variables: z
    .object({})
    .passthrough()
    .optional()
    .describe(
      "Variables to substitute in parameterized queries (e.g. {'$page-title': 'ProjectAlpha'})"
    ),

  // UID array support
  limitToBlockUids: z
    .array(z.string())
    .optional()
    .describe(
      "Inject block UID filtering into query (adds UID constraints automatically)"
    ),
  limitToPageUids: z
    .array(z.string())
    .optional()
    .describe(
      "Inject page UID filtering into query (adds page UID constraints automatically)"
    ),
  fromResultId: z
    .string()
    .optional()
    .describe("Extract UIDs from previous result and inject into query"),

  // Execution control
  estimateOnly: z
    .boolean()
    .default(false)
    .describe("Only estimate performance, don't execute query"),
  executeQuery: z
    .boolean()
    .default(true)
    .describe(
      "Execute the query and return results (default: true since this tool is meant to execute)"
    ),
  // Result lifecycle management
  purpose: z
    .enum(["final", "intermediate", "replacement", "completion"])
    .optional()
    .describe(
      "Purpose: 'final' for user response data, 'intermediate' for non-final multi-step, 'replacement' to replace previous results, 'completion' to add to previous results"
    ),
});

export interface DatomicQueryResult {
  query: string;
  explanation: string;
  estimatedComplexity: "low" | "medium" | "high";
  warnings: string[];
  optimizationSuggestions: string[];
  parameters: Record<string, any>;
  estimatedResultCount?: string;
  executionResults?: any[];
  executionTime?: number;
}
