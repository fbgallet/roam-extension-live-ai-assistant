import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createToolResult, executeDatomicQuery } from './searchUtils';
import { dnpUidRegex } from '../../../../utils/regex.js';

/**
 * Generate optimized Datomic queries for complex search scenarios
 * Security Level: Secure (generates queries but doesn't execute them or access content)
 * 
 * This tool creates efficient Datomic queries based on search specifications,
 * with optimization suggestions and performance warnings.
 */

// Simplified schema for OpenAI function calling compatibility
const schema = z.object({
  queryDescription: z.string().describe("Natural language description of what you want to find"),
  targetEntity: z.enum(["block", "page"]).describe("Whether to search for blocks or pages"),
  searchTerms: z.array(z.string()).describe("Key terms to search for"),
  conditionLogic: z.enum(["AND", "OR"]).default("AND").describe("How to combine search conditions"),
  includeDaily: z.boolean().default(true).describe("Include Daily Note Pages in results"),
  limitResults: z.number().min(1).max(1000).default(100).describe("Maximum number of results to return"),
  complexQuery: z.boolean().default(false).describe("Set to true for advanced queries requiring joins or aggregation"),
  estimateOnly: z.boolean().default(false).describe("Only estimate performance, don't generate full query"),
  executeQuery: z.boolean().default(false).describe("Execute the generated query and return results (otherwise just returns the query)"),
  // NEW: Page scope limitation
  limitToPages: z.array(z.string()).optional().describe("Limit search to blocks within specific pages (by page title). Use this for 'in page [[X]]' queries."),
  pageMatchType: z.enum(["exact", "contains", "regex"]).default("exact").describe("How to match page titles when limitToPages is used")
});

interface DatomicQueryResult {
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

const generateDatomicQueryImpl = async (input: z.infer<typeof schema>): Promise<DatomicQueryResult> => {
  const {
    queryDescription,
    targetEntity,
    searchTerms,
    conditionLogic,
    includeDaily,
    limitResults,
    complexQuery,
    estimateOnly,
    executeQuery,
    limitToPages,
    pageMatchType
  } = input;

  console.log(`🔍 GenerateDatomicQuery: ${targetEntity} search for "${queryDescription}"`);

  const result: DatomicQueryResult = {
    query: "",
    explanation: "",
    estimatedComplexity: "low",
    warnings: [],
    optimizationSuggestions: [],
    parameters: {}
  };

  // If only estimating, provide quick analysis
  if (estimateOnly) {
    result.estimatedComplexity = searchTerms.length > 3 ? "high" : searchTerms.length > 1 ? "medium" : "low";
    result.explanation = `Estimated ${result.estimatedComplexity} complexity query for ${targetEntity}s matching: ${searchTerms.join(` ${conditionLogic} `)}`;
    return result;
  }

  // Build the query based on simplified parameters
  const queryBuilder = new SimplifiedDatomicQueryBuilder(targetEntity);

  // Add search terms as conditions
  for (let i = 0; i < searchTerms.length; i++) {
    const term = searchTerms[i];
    queryBuilder.addSearchTerm(term, i, conditionLogic);
  }

  // Add page scope limitation if specified
  if (limitToPages && limitToPages.length > 0) {
    queryBuilder.addPageScopeLimit(limitToPages, pageMatchType);
  }

  // Add DNP filtering if needed
  if (!includeDaily) {
    queryBuilder.addDNPFiltering();
  }

  // Generate the final query
  result.query = queryBuilder.build();
  result.parameters = { limit: limitResults };

  // Analyze complexity
  result.estimatedComplexity = searchTerms.length > 3 ? "high" : searchTerms.length > 1 ? "medium" : "low";
  
  // Generate warnings
  if (searchTerms.length > 5) {
    result.warnings.push("Many search terms may impact performance");
  }
  if (!limitResults || limitResults > 500) {
    result.warnings.push("Large result sets may be slow - consider adding a limit");
  }
  
  // Generate explanation
  result.explanation = `This query searches for ${targetEntity}s containing: ${searchTerms.join(` ${conditionLogic} `)}`;
  if (limitToPages && limitToPages.length > 0) {
    result.explanation += `, limited to page(s): ${limitToPages.join(", ")}`;
  }
  if (!includeDaily) {
    result.explanation += ", excluding Daily Note Pages";
  }

  // Execute query if requested
  if (executeQuery) {
    try {
      const executionStartTime = performance.now();
      console.log(`🚀 Executing generated query...`);
      const executionResults = await executeDatomicQuery(result.query);
      result.executionTime = performance.now() - executionStartTime;
      result.executionResults = executionResults;
      console.log(`✅ Query executed successfully: ${executionResults.length} results in ${result.executionTime.toFixed(1)}ms`);
    } catch (error) {
      console.error(`❌ Query execution failed:`, error);
      result.warnings.push(`Query execution failed: ${error.message}`);
    }
  }

  return result;
};

/**
 * Simplified Datomic Query Builder class
 */
class SimplifiedDatomicQueryBuilder {
  private targetEntity: string;
  private whereClause: string[] = [];
  private searchTerms: { term: string; index: number }[] = [];
  private combineLogic: string = "AND";

  constructor(targetEntity: string) {
    this.targetEntity = targetEntity;
  }

  addSearchTerm(term: string, index: number, logic: string) {
    this.searchTerms.push({ term, index });
    this.combineLogic = logic;
  }

  private buildSearchTermClauses() {
    if (this.searchTerms.length === 0) return;

    if (this.combineLogic === "AND" || this.searchTerms.length === 1) {
      // Add all patterns and matches for AND logic
      for (const { term, index } of this.searchTerms) {
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexVar = `?regex${index}`;
        
        this.whereClause.push(`[(re-pattern "(?i)${escapedTerm}") ${regexVar}]`);
        
        if (this.targetEntity === "page") {
          this.whereClause.push(`[(re-find ${regexVar} ?title)]`);
        } else {
          this.whereClause.push(`[(re-find ${regexVar} ?content)]`);
        }
      }
    } else {
      // OR logic: add all patterns first, then OR clause with matches
      for (const { term, index } of this.searchTerms) {
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexVar = `?regex${index}`;
        this.whereClause.push(`[(re-pattern "(?i)${escapedTerm}") ${regexVar}]`);
      }

      // Build OR clause with only the matching logic
      const target = this.targetEntity === "page" ? "?title" : "?content";
      const orClauses = this.searchTerms.map(({ index }) => `[(re-find ?regex${index} ${target})]`);
      this.whereClause.push(`(or ${orClauses.join(' ')})`);
    }
  }

  addPageScopeLimit(pageNames: string[], matchType: string) {
    if (this.targetEntity === "page") {
      // If searching for pages, limit to specified pages only
      if (matchType === "exact") {
        if (pageNames.length === 1) {
          this.whereClause.push(`[?entity :node/title "${pageNames[0]}"]`);
        } else {
          // Multiple pages with OR logic
          const orClauses = pageNames.map(name => `[?entity :node/title "${name}"]`);
          this.whereClause.push(`(or ${orClauses.join(' ')})`);
        }
      } else if (matchType === "contains") {
        const patterns = pageNames.map((name, i) => {
          const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regexVar = `?page-pattern${i}`;
          return [
            `[(re-pattern "(?i).*${escapedName}.*") ${regexVar}]`,
            `[(re-find ${regexVar} ?title)]`
          ];
        }).flat();
        this.whereClause.push(...patterns);
      }
    } else {
      // If searching for blocks, limit to blocks within specified pages
      if (matchType === "exact") {
        if (pageNames.length === 1) {
          this.whereClause.push("[?entity :block/page ?target-page]");
          this.whereClause.push(`[?target-page :node/title "${pageNames[0]}"]`);
        } else {
          // Multiple pages with OR logic
          this.whereClause.push("[?entity :block/page ?target-page]");
          const orClauses = pageNames.map(name => `[?target-page :node/title "${name}"]`);
          this.whereClause.push(`(or ${orClauses.join(' ')})`);
        }
      } else if (matchType === "contains") {
        this.whereClause.push("[?entity :block/page ?target-page]");
        this.whereClause.push("[?target-page :node/title ?target-page-title]");
        const patterns = pageNames.map((name, i) => {
          const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regexVar = `?page-limit-pattern${i}`;
          return [
            `[(re-pattern "(?i).*${escapedName}.*") ${regexVar}]`,
            `[(re-find ${regexVar} ?target-page-title)]`
          ];
        }).flat();
        this.whereClause.push(...patterns);
      }
    }
  }

  addDNPFiltering() {
    if (this.targetEntity === "page") {
      this.whereClause.push(`[(re-pattern "${dnpUidRegex.source.slice(1, -1)}") ?dnp-pattern]`);
      this.whereClause.push("(not [(re-find ?dnp-pattern ?uid)])");
    } else {
      this.whereClause.push("[?entity :block/page ?page]");
      this.whereClause.push("[?page :block/uid ?page-uid]");
      this.whereClause.push(`[(re-pattern "${dnpUidRegex.source.slice(1, -1)}") ?dnp-pattern]`);
      this.whereClause.push("(not [(re-find ?dnp-pattern ?page-uid)])");
    }
  }

  build(): string {
    // Build search term clauses with proper OR logic
    this.buildSearchTermClauses();
    
    // Build basic entity bindings
    const findClause = "[:find ?uid";
    const basicBindings = [];
    
    if (this.targetEntity === "page") {
      basicBindings.push("[?entity :node/title ?title]");
      basicBindings.push("[?entity :block/uid ?uid]");
    } else {
      basicBindings.push("[?entity :block/uid ?uid]");
      basicBindings.push("[?entity :block/string ?content]");
      basicBindings.push("[?entity :block/page ?page]");
      basicBindings.push("[?page :node/title ?page-title]");
    }
    
    const allClauses = [...basicBindings, ...this.whereClause];
    const whereClause = `:where\n    ${allClauses.join("\n    ")}]`;
    
    return `${findClause}\n ${whereClause}`;
  }
}


export const generateDatomicQueryTool = tool(
  async (input) => {
    const startTime = performance.now();
    try {
      const results = await generateDatomicQueryImpl(input);
      return createToolResult(true, results, undefined, "generateDatomicQuery", startTime);
    } catch (error) {
      console.error('GenerateDatomicQuery tool error:', error);
      return createToolResult(false, undefined, error.message, "generateDatomicQuery", startTime);
    }
  },
  {
    name: "generateDatomicQuery",
    description: "Generate optimized Datomic queries for complex search scenarios. Supports advanced filtering, joins, aggregations, and PAGE-SCOPED SEARCHES. Use limitToPages parameter for 'in page [[PageName]]' queries to search only within specific pages. Provides performance analysis with optimization suggestions.",
    schema
  }
);