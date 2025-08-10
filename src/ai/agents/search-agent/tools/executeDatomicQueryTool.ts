import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createToolResult, executeDatomicQuery, extractUidsFromResults } from './searchUtils';
import { dnpUidRegex } from '../../../../utils/regex.js';

/**
 * Execute Datomic/Datalog queries against the Roam Research database
 * Security Level: Secure (executes queries but doesn't expose raw content in limited access modes)
 * 
 * This tool supports three modes:
 * 1. Auto-generate queries from natural language criteria
 * 2. Execute user-provided Datalog queries directly  
 * 3. Execute parameterized queries with variables from previous results
 */

// Schema supporting multiple modes: auto-generate, user-provided, or parameterized queries
const schema = z.object({
  // Mode 1: Auto-generate from criteria (original functionality)
  queryDescription: z.string().optional().describe("Natural language description of what you want to find (for auto-generated queries)"),
  targetEntity: z.enum(["block", "page"]).optional().describe("Whether to search for blocks or pages (for auto-generated queries)"),
  searchTerms: z.array(z.string()).optional().describe("Key terms to search for (for auto-generated queries)"),
  conditionLogic: z.enum(["AND", "OR"]).default("AND").describe("How to combine search conditions"),
  includeDaily: z.boolean().default(true).describe("Include Daily Note Pages in results"),
  limitResults: z.number().min(1).max(1000).default(100).describe("Maximum number of results to return"),
  limitToPages: z.array(z.string()).optional().describe("Limit search to blocks within specific pages (by page title). Use this for 'in page [[X]]' queries."),
  pageMatchType: z.enum(["exact", "contains", "regex"]).default("exact").describe("How to match page titles when limitToPages is used"),
  
  // Mode 2: User-provided query
  query: z.string().optional().describe("Raw Datalog query to execute directly (alternative to auto-generation)"),
  
  // Mode 3: Parameterized queries  
  variables: z.record(z.string(), z.any()).optional().describe("Variables to substitute in parameterized queries (e.g. {'$page-title': 'ProjectAlpha'})"),
  
  // UID array support
  limitToBlockUids: z.array(z.string()).optional().describe("Inject block UID filtering into query (adds UID constraints automatically)"),
  limitToPageUids: z.array(z.string()).optional().describe("Inject page UID filtering into query (adds page UID constraints automatically)"),
  fromResultId: z.string().optional().describe("Extract UIDs from previous result and inject into query"),
  
  // Execution control
  estimateOnly: z.boolean().default(false).describe("Only estimate performance, don't execute query"),
  executeQuery: z.boolean().default(true).describe("Execute the query and return results (default: true since this tool is meant to execute)")
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

/**
 * Inject UID filtering constraints into a Datalog query
 */
const injectUidFiltering = (query: string, blockUids: string[], pageUids: string[]): string => {
  // Find the :where clause
  const whereMatch = query.match(/:where\s+(.*?)(?:\]|$)/s);
  if (!whereMatch) {
    console.warn('Could not find :where clause in query, skipping UID injection');
    return query;
  }
  
  const whereClause = whereMatch[1];
  let additionalClauses = '';
  
  // Add block UID filtering
  if (blockUids.length > 0) {
    if (blockUids.length === 1) {
      // Single UID - direct match
      if (query.includes('?b :block/uid') || query.includes('?uid')) {
        additionalClauses += `\n                [?b :block/uid "${blockUids[0]}"]`;
      }
    } else {
      // Multiple UIDs - use set contains
      const uidsSet = blockUids.map(uid => `"${uid}"`).join(' ');
      if (query.includes('?b :block/uid') || query.includes('?uid')) {
        additionalClauses += `\n                [(contains? #{${uidsSet}} ?uid)]`;
      }
    }
  }
  
  // Add page UID filtering  
  if (pageUids.length > 0) {
    if (pageUids.length === 1) {
      // Single page UID - direct match
      if (query.includes('?page') || query.includes('?page-uid')) {
        additionalClauses += `\n                [?page :block/uid "${pageUids[0]}"]`;
      }
    } else {
      // Multiple page UIDs - use set contains
      const uidsSet = pageUids.map(uid => `"${uid}"`).join(' ');
      if (query.includes('?page') || query.includes('?page-uid')) {
        additionalClauses += `\n                [(contains? #{${uidsSet}} ?page-uid)]`;
      }
    }
  }
  
  if (additionalClauses) {
    // Insert before the closing bracket
    const insertPoint = query.lastIndexOf(']');
    return query.slice(0, insertPoint) + additionalClauses + query.slice(insertPoint);
  }
  
  return query;
};

const generateDatomicQueryImpl = async (input: z.infer<typeof schema>, state?: any): Promise<DatomicQueryResult> => {
  const {
    queryDescription,
    targetEntity,
    searchTerms,
    conditionLogic,
    includeDaily,
    limitResults,
    estimateOnly,
    executeQuery,
    limitToPages,
    pageMatchType,
    query: userQuery,
    variables,
    limitToBlockUids,
    limitToPageUids,
    fromResultId
  } = input;

  console.log(`🔍 ExecuteDatomicQuery: ${userQuery ? 'user-provided query' : targetEntity + ' search for "' + queryDescription + '"'}`);

  // Extract UIDs from previous results and user input
  const { blockUids: finalBlockUids, pageUids: finalPageUids } = extractUidsFromResults(
    fromResultId,
    limitToBlockUids,
    limitToPageUids,
    state
  );

  const result: DatomicQueryResult = {
    query: "",
    explanation: "",
    estimatedComplexity: "low",
    warnings: [],
    optimizationSuggestions: [],
    parameters: {}
  };

  // Handle user-provided query mode
  if (userQuery) {
    result.query = userQuery;
    result.explanation = `User-provided Datalog query${variables ? ' with ' + Object.keys(variables).length + ' variables' : ''}`;
    result.estimatedComplexity = userQuery.length > 200 ? "high" : userQuery.includes("(or ") || userQuery.includes("(and ") ? "medium" : "low";
    
    // Apply variable substitution if provided
    if (variables && Object.keys(variables).length > 0) {
      let processedQuery = result.query;
      for (const [variable, value] of Object.entries(variables)) {
        processedQuery = processedQuery.replace(new RegExp(`\\${variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), `"${value}"`);
      }
      result.query = processedQuery;
      result.parameters = variables;
    }
    
    // Inject UID filtering into user query if UIDs provided
    if (finalBlockUids.length > 0 || finalPageUids.length > 0) {
      result.query = injectUidFiltering(result.query, finalBlockUids, finalPageUids);
      result.explanation += ` with UID filtering (${finalBlockUids.length} blocks, ${finalPageUids.length} pages)`;
      console.log(`⚡ Injected UID filtering into user query`);
    }
    
    // Execute if requested
    if (executeQuery) {
      try {
        const executionStartTime = performance.now();
        console.log(`🚀 Executing user-provided query...`);
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
  }

  // If only estimating, provide quick analysis
  if (estimateOnly) {
    result.estimatedComplexity = searchTerms?.length > 3 ? "high" : searchTerms?.length > 1 ? "medium" : "low";
    result.explanation = `Estimated ${result.estimatedComplexity} complexity query for ${targetEntity}s matching: ${searchTerms?.join(` ${conditionLogic} `)}`;
    return result;
  }

  // Validate required fields for auto-generation
  if (!targetEntity || !searchTerms) {
    throw new Error("Either provide a 'query' for direct execution, or 'targetEntity' and 'searchTerms' for auto-generation");
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

  // Add UID filtering if provided
  if (finalBlockUids.length > 0 || finalPageUids.length > 0) {
    queryBuilder.addUidFiltering(finalBlockUids, finalPageUids);
    result.explanation += ` with UID filtering (${finalBlockUids.length} blocks, ${finalPageUids.length} pages)`;
    console.log(`⚡ Added UID filtering to auto-generated query`);
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
 * Extract variable names from the :find clause of a Datalog query
 */
const extractFindVariables = (query: string): string[] => {
  try {
    // Match the :find clause and extract variables
    const findMatch = query.match(/:find\s+(.*?)(?:\s*:(?:where|in|with)|\s*\])/s);
    if (!findMatch) {
      console.warn('Could not parse :find clause from query:', query.slice(0, 100));
      return ['result']; // Fallback
    }
    
    const findClause = findMatch[1].trim();
    
    // Extract variables (anything starting with ? followed by valid identifier chars including hyphens)
    const variableMatches = findClause.match(/\?[\w-]+/g);
    if (!variableMatches) {
      console.warn('No variables found in :find clause:', findClause);
      return ['result']; // Fallback
    }
    
    // Clean up variable names (remove the ? prefix for cleaner property names)
    const cleanVariables = variableMatches.map(variable => variable.substring(1));
    
    console.log(`🔍 Parsed find variables from query:`, cleanVariables);
    return cleanVariables;
  } catch (error) {
    console.error('Error parsing :find variables:', error);
    return ['result']; // Fallback
  }
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

  addUidFiltering(blockUids: string[], pageUids: string[]) {
    // Add block UID filtering
    if (blockUids.length > 0 && this.targetEntity === "block") {
      if (blockUids.length === 1) {
        this.whereClause.push(`[?entity :block/uid "${blockUids[0]}"]`);
      } else {
        const uidsSet = blockUids.map(uid => `"${uid}"`).join(' ');
        this.whereClause.push(`[(contains? #{${uidsSet}} ?uid)]`);
      }
    }
    
    // Add page UID filtering  
    if (pageUids.length > 0) {
      if (this.targetEntity === "page") {
        // Filtering pages directly
        if (pageUids.length === 1) {
          this.whereClause.push(`[?entity :block/uid "${pageUids[0]}"]`);
        } else {
          const uidsSet = pageUids.map(uid => `"${uid}"`).join(' ');
          this.whereClause.push(`[(contains? #{${uidsSet}} ?uid)]`);
        }
      } else {
        // Filtering blocks by their parent pages
        if (pageUids.length === 1) {
          this.whereClause.push(`[?page :block/uid "${pageUids[0]}"]`);
        } else {
          const uidsSet = pageUids.map(uid => `"${uid}"`).join(' ');
          this.whereClause.push("[?entity :block/page ?page]");
          this.whereClause.push("[?page :block/uid ?page-uid]");
          this.whereClause.push(`[(contains? #{${uidsSet}} ?page-uid)]`);
        }
      }
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


export const executeDatomicQueryTool = tool(
  async (input, config) => {
    const startTime = performance.now();
    try {
      // Extract state from config
      const state = config?.configurable?.state;
      const queryResult = await generateDatomicQueryImpl(input, state);
      
      // If query was executed and has results, return them properly formatted
      if (queryResult.executionResults && Array.isArray(queryResult.executionResults)) {
        // Parse the :find clause to extract variable names
        const findVariables = extractFindVariables(queryResult.query);
        
        // Transform query results into structured objects
        const formattedResults = queryResult.executionResults.map((resultRow, index) => {
          const resultObject: any = {
            _resultIndex: index,
            _queryHash: queryResult.query.slice(0, 50), // First 50 chars as identifier
            type: "datalog-result",
            source: "executeDatomicQuery"
          };
          
          // Map each result value to its corresponding variable name
          findVariables.forEach((variable, colIndex) => {
            if (colIndex < resultRow.length) {
              resultObject[variable] = resultRow[colIndex];
            }
          });
          
          // CRITICAL: Smart property mapping for result system compatibility
          // Map variables to standard property names based on semantic patterns
          const propertyMappings = {
            // Block UID patterns
            blockUid: ['block-uid', 'blockuid', 'uid', 'block', 'entity', 'e'],
            // Page UID patterns  
            pageUid: ['page-uid', 'pageuid', 'page', 'p'],
            // Content patterns
            content: ['content', 'string', 'text', 'block-string'],
            // Title patterns
            title: ['title', 'page-title', 'pagetitle', 'node-title', 'name']
          };
          
          // Smart mapping with explicit type detection and proper UID handling
          let detectedType = null;
          let primaryUid = null;
          
          // First pass: identify data types and collect information
          const detectedData = {
            blockUids: [],
            pageUids: [], 
            contentFields: [],
            titleFields: [],
            otherFields: []
          };
          
          findVariables.forEach(variable => {
            const varLower = variable.toLowerCase();
            const value = resultObject[variable];
            
            if (propertyMappings.blockUid.some(pattern => varLower.includes(pattern))) {
              detectedData.blockUids.push({ variable, value });
            } else if (propertyMappings.pageUid.some(pattern => varLower.includes(pattern))) {
              detectedData.pageUids.push({ variable, value });
            } else if (propertyMappings.content.some(pattern => varLower.includes(pattern))) {
              detectedData.contentFields.push({ variable, value });
              resultObject.content = value;
            } else if (propertyMappings.title.some(pattern => varLower.includes(pattern))) {
              detectedData.titleFields.push({ variable, value });
              resultObject.pageTitle = value;
              resultObject.title = value;
            } else {
              detectedData.otherFields.push({ variable, value });
            }
          });
          
          // Second pass: determine entity type and set properties
          if (detectedData.blockUids.length > 0) {
            // Has block UID(s) - this is a block result
            detectedType = 'block';
            primaryUid = detectedData.blockUids[0].value;
            resultObject.uid = primaryUid;
            resultObject.isPage = false; // Explicit: this is a block
            
            // If we also have page UID, set it as pageUid (the page this block belongs to)
            if (detectedData.pageUids.length > 0) {
              resultObject.pageUid = detectedData.pageUids[0].value;
            }
          } else if (detectedData.pageUids.length > 0) {
            // Has page UID(s) but no block UID - this is a page result
            detectedType = 'page';
            primaryUid = detectedData.pageUids[0].value;
            resultObject.uid = primaryUid; // Pages use uid, not pageUid
            resultObject.isPage = true; // Explicit: this is a page
            // Note: pages don't have pageUid because they're not contained in other pages
          } else {
            // No explicit UID patterns - use inference
            if (detectedData.contentFields.length > 0) {
              // Has content - likely a block
              detectedType = 'block';
              primaryUid = resultObject[findVariables[0]];
              resultObject.uid = primaryUid;
              resultObject.isPage = false; // Inferred: this is a block
              console.log(`🔍 Inferred block type from content presence`);
            } else if (detectedData.titleFields.length > 0) {
              // Has title but no content - likely a page
              detectedType = 'page'; 
              primaryUid = resultObject[findVariables[0]];
              resultObject.uid = primaryUid;
              resultObject.isPage = true; // Inferred: this is a page
              console.log(`🔍 Inferred page type from title presence (no content)`);
            } else {
              // Ultimate fallback - assume block
              detectedType = 'block';
              primaryUid = resultObject[findVariables[0]];
              resultObject.uid = primaryUid;
              resultObject.isPage = false; // Fallback: assume block
              console.log(`⚠️ Fallback: assuming block type for variable '${findVariables[0]}'`);
            }
          }
          
          console.log(`🎯 ExecuteDatomicQuery result classified as: ${detectedType} (uid: ${primaryUid})`);
          console.log(`   Variables: ${findVariables.join(', ')}`);
          console.log(`   Properties: isPage=${resultObject.isPage}`);
        
          
          return resultObject;
        });
        
        // Return the formatted results directly as data, with metadata
        return createToolResult(
          true, 
          formattedResults, 
          undefined, 
          "executeDatomicQuery", 
          startTime,
          {
            totalFound: formattedResults.length,
            findVariables: findVariables,
            queryInfo: {
              originalQuery: queryResult.query,
              explanation: queryResult.explanation,
              estimatedComplexity: queryResult.estimatedComplexity,
              executionTime: queryResult.executionTime
            }
          }
        );
      } else {
        // No execution results (estimation only or query generation)  
        return createToolResult(true, queryResult, undefined, "executeDatomicQuery", startTime);
      }
    } catch (error) {
      console.error('ExecuteDatomicQuery tool error:', error);
      return createToolResult(false, undefined, error.message, "executeDatomicQuery", startTime);
    }
  },
  {
    name: "executeDatomicQuery", 
    description: "Execute Datalog queries against Roam database. Supports 3 modes: 1) Auto-generate from criteria (targetEntity + searchTerms), 2) Execute user-provided query directly (query parameter), 3) Parameterized queries with variable substitution (query + variables). UID array support: limitToBlockUids/limitToPageUids or fromResultId automatically inject UID constraints for performance optimization. Always executes and returns results unless estimateOnly=true.",
    schema
  }
);