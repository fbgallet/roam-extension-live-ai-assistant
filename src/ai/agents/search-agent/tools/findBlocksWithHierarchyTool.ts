import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { 
  executeDatomicQuery, 
  isDailyNote, 
  filterByDateRange, 
  createToolResult, 
  generateSemanticExpansions,
  getBlockChildren,
  getBlockParents,
  DatomicQueryBuilder,
  SearchCondition,
} from './searchUtils';
import { dnpUidRegex } from '../../../../utils/regex.js';

/**
 * Find blocks with hierarchical context using content and structure conditions
 * Security Level: Flexible (secure mode = UIDs/metadata only, content mode = includes full hierarchy)
 * 
 * This tool searches for blocks and enriches results with hierarchical context,
 * supporting complex conditions on both content and structural relationships.
 * Use secureMode=true to exclude full block content from results (UIDs and metadata only).
 */

const hierarchyConditionSchema = z.object({
  direction: z.enum(["descendants", "ancestors"]).describe("Search in descendants (children) or ancestors (parents)"),
  levels: z.union([z.number().min(1).max(10), z.literal("all")]).default("all"),
  conditions: z.array(z.object({
    type: z.enum(["text", "page_ref", "block_ref", "regex"]).default("text"),
    text: z.string().min(1),
    matchType: z.enum(["exact", "contains", "regex"]).default("contains"),
    weight: z.number().min(0).max(10).default(1.0),
    negate: z.boolean().default(false)
  })).min(1)
});

const contentConditionSchema = z.object({
  type: z.enum(["text", "page_ref", "block_ref", "regex"]).default("text"),
  text: z.string().min(1, "Search text is required"),
  matchType: z.enum(["exact", "contains", "regex"]).default("contains"),
  semanticExpansion: z.boolean().default(false).describe("Only use when few results or user requests semantic search"),
  weight: z.number().min(0).max(10).default(1.0),
  negate: z.boolean().default(false)
});

const schema = z.object({
  contentConditions: z.array(contentConditionSchema).min(1, "At least one content condition is required"),
  hierarchyConditions: z.array(hierarchyConditionSchema).optional(),
  combineConditions: z.enum(["AND", "OR"]).default("AND"),
  combineHierarchy: z.enum(["AND", "OR"]).default("OR"),
  maxExpansions: z.number().min(1).max(10).default(3),
  expansionStrategy: z.enum(["synonyms", "related_concepts", "broader_terms"]).default("related_concepts"),
  includeChildren: z.boolean().default(true),
  childDepth: z.number().min(1).max(5).default(3),
  includeParents: z.boolean().default(true),
  parentDepth: z.number().min(1).max(3).default(2),
  includeDaily: z.boolean().default(true),
  dateRange: z.object({
    start: z.union([z.date(), z.string()]).optional(),
    end: z.union([z.date(), z.string()]).optional()
  }).optional(),
  sortBy: z.enum(["relevance", "recent", "page_title", "hierarchy_depth"]).default("relevance"),
  limit: z.number().min(1).max(500).default(50),
  
  // Security mode
  secureMode: z.boolean().default(false).describe("If true, excludes full block content from results (UIDs and metadata only)")
});

const findBlocksWithHierarchyImpl = async (input: z.infer<typeof schema>) => {
  const {
    contentConditions,
    hierarchyConditions,
    combineConditions,
    combineHierarchy,
    maxExpansions,
    expansionStrategy,
    includeChildren,
    childDepth,
    includeParents,
    parentDepth,
    includeDaily,
    dateRange,
    sortBy,
    limit,
    secureMode
  } = input;

  console.log(`🔍 FindBlocksWithHierarchy: ${contentConditions.length} content conditions, ${hierarchyConditions?.length || 0} hierarchy conditions`);

  // Step 1: Process content conditions with semantic expansion
  const expandedContentConditions = await expandConditions(
    contentConditions,
    expansionStrategy,
    maxExpansions
  );

  // Step 2: Find blocks matching content conditions
  const contentMatches = await searchBlocksWithConditions(
    expandedContentConditions,
    combineConditions,
    includeDaily
  );

  console.log(`📊 Found ${contentMatches.length} blocks matching content conditions`);

  // Step 3: Apply hierarchy conditions if specified
  let hierarchyFilteredBlocks = contentMatches;
  if (hierarchyConditions?.length > 0) {
    hierarchyFilteredBlocks = await applyHierarchyFilters(
      contentMatches,
      hierarchyConditions,
      combineHierarchy
    );
    console.log(`📊 After hierarchy filtering: ${hierarchyFilteredBlocks.length} blocks`);
  }

  // Step 4: Enrich with full hierarchical context
  const enrichedResults = await enrichWithFullHierarchy(
    hierarchyFilteredBlocks,
    includeChildren,
    childDepth,
    includeParents,
    parentDepth,
    secureMode
  );

  // Step 5: Apply date range filtering
  let filteredResults = enrichedResults;
  if (dateRange && (dateRange.start || dateRange.end) && includeDaily) {
    const parsedDateRange = {
      start: typeof dateRange.start === 'string' ? new Date(dateRange.start) : dateRange.start,
      end: typeof dateRange.end === 'string' ? new Date(dateRange.end) : dateRange.end
    };
    filteredResults = filterByDateRange(enrichedResults, parsedDateRange);
  }

  // Step 6: Sort results
  filteredResults = sortHierarchyResults(filteredResults, sortBy, contentConditions);

  // Step 7: Limit results
  if (filteredResults.length > limit) {
    filteredResults = filteredResults.slice(0, limit);
  }

  return filteredResults;
};

/**
 * Expand content conditions with semantic terms
 */
const expandConditions = async (
  conditions: any[],
  strategy: string,
  maxExpansions: number
): Promise<any[]> => {
  const expandedConditions = [...conditions];

  for (const condition of conditions) {
    if (condition.semanticExpansion && condition.type === 'text') {
      try {
        const expansionTerms = await generateSemanticExpansions(
          condition.text,
          strategy as any,
          maxExpansions
        );

        for (const term of expansionTerms) {
          expandedConditions.push({
            ...condition,
            text: term,
            semanticExpansion: false,
            weight: condition.weight * 0.8
          });
        }
      } catch (error) {
        console.warn(`Failed to expand condition "${condition.text}":`, error);
      }
    }
  }

  return expandedConditions;
};

/**
 * Search blocks with content conditions
 */
const searchBlocksWithConditions = async (
  conditions: any[],
  combineLogic: "AND" | "OR",
  includeDaily: boolean
): Promise<any[]> => {
  let query = `[:find ?uid ?content ?time ?page-title ?page-uid
                :where 
                [?b :block/uid ?uid]
                [?b :block/string ?content]
                [?b :block/page ?page]
                [?page :node/title ?page-title]
                [?page :block/uid ?page-uid]
                [?b :edit/time ?time]`;

  if (!includeDaily) {
    query += `\n                [(re-pattern "${dnpUidRegex.source.slice(1, -1)}") ?dnp-pattern]
                (not [(re-find ?dnp-pattern ?page-uid)])`;
  }

  // Add condition matching using shared query builder with regex optimization
  const searchConditions: SearchCondition[] = conditions.map(cond => ({
    type: cond.type as any,
    text: cond.text,
    matchType: cond.matchType as any,
    semanticExpansion: cond.semanticExpansion,
    weight: cond.weight,
    negate: cond.negate,
  }));

  const queryBuilder = new DatomicQueryBuilder(searchConditions, combineLogic);
  const { patternDefinitions, conditionClauses } = queryBuilder.buildConditionClauses("?content");
  
  query += patternDefinitions;
  query += conditionClauses;

  query += `]`;

  return await executeDatomicQuery(query);
};

/**
 * Build condition clause for content matching
 */
const buildConditionClause = (condition: any, index: number, isInOr: boolean = false): string => {
  const indent = isInOr ? '                  ' : '                ';
  let clause = '';

  switch (condition.type) {
    case 'page_ref':
      // Use proper Roam :block/refs attribute instead of regex
      clause = `\n${indent}[?ref-page${index} :node/title "${condition.text}"]
${indent}[?b :block/refs ?ref-page${index}]`;
      break;
    
    case 'block_ref':
      // Use proper Roam :block/refs attribute for block references
      clause = `\n${indent}[?ref-block${index} :block/uid "${condition.text}"]
${indent}[?b :block/refs ?ref-block${index}]`;
      break;
    
    case 'regex':
      clause = `\n${indent}[(re-pattern "${condition.text}") ?pattern${index}]
${indent}[(re-find ?pattern${index} ?content)]`;
      break;
    
    case 'text':
    default:
      if (condition.matchType === 'exact') {
        clause = `\n${indent}[(= ?content "${condition.text}")]`;
      } else if (condition.matchType === 'regex') {
        clause = `\n${indent}[(re-pattern "${condition.text}") ?pattern${index}]
${indent}[(re-find ?pattern${index} ?content)]`;
      } else {
        // Use case-insensitive regex without problematic escape characters
        // Remove any special regex characters to prevent escape issues
        const cleanText = condition.text.replace(/[.*+?^${}()|[\]\\]/g, '');
        if (cleanText === condition.text) {
          // No special characters, can use regex safely
          clause = `\n${indent}[(re-pattern "(?i).*${condition.text}.*") ?pattern${index}]
${indent}[(re-find ?pattern${index} ?content)]`;
        } else {
          // Has special characters, use case-sensitive includes as fallback
          clause = `\n${indent}[(clojure.string/includes? ?content "${condition.text}")]`;
        }
      }
      break;
  }

  if (condition.negate) {
    clause = `\n${indent}(not ${clause.trim()})`;
  }

  return clause;
};

/**
 * Apply hierarchy conditions to filter blocks
 */
const applyHierarchyFilters = async (
  blocks: any[],
  hierarchyConditions: any[],
  combineLogic: "AND" | "OR"
): Promise<any[]> => {
  const filteredBlocks = [];

  for (const block of blocks) {
    const [uid, content, time, pageTitle, pageUid] = block;
    
    let hierarchyMatches = [];
    
    for (const hierarchyCondition of hierarchyConditions) {
      const { direction, levels, conditions } = hierarchyCondition;
      
      let hierarchyBlocks = [];
      if (direction === 'descendants') {
        const maxLevels = levels === 'all' ? 10 : levels;
        hierarchyBlocks = await getBlockChildren(uid, maxLevels, false); // Always get content for filtering
      } else {
        const maxLevels = levels === 'all' ? 10 : levels;
        hierarchyBlocks = await getBlockParents(uid, maxLevels, false); // Always get content for filtering
      }
      
      // Check if hierarchy blocks match the conditions
      const hierarchyMatch = hierarchyBlocks.some(hierarchyBlock => {
        return conditions.every(condition => {
          const blockContent = hierarchyBlock.content || '';
          return matchesCondition(blockContent, condition);
        });
      });
      
      hierarchyMatches.push(hierarchyMatch);
    }
    
    // Apply combine logic for hierarchy conditions
    const passesHierarchyFilter = combineLogic === "AND" 
      ? hierarchyMatches.every(match => match)
      : hierarchyMatches.some(match => match);
    
    if (passesHierarchyFilter) {
      filteredBlocks.push(block);
    }
  }

  return filteredBlocks;
};

/**
 * Check if content matches a condition
 */
const matchesCondition = (content: string, condition: any): boolean => {
  let matches = false;
  
  switch (condition.type) {
    case 'page_ref':
      const pageRefPattern = new RegExp(`\\[\\[${condition.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`, 'i');
      matches = pageRefPattern.test(content);
      break;
    
    case 'block_ref':
      const blockRefPattern = new RegExp(`\\(\\(${condition.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\)`, 'i');
      matches = blockRefPattern.test(content);
      break;
    
    case 'regex':
      try {
        const regex = new RegExp(condition.text, 'i');
        matches = regex.test(content);
      } catch {
        matches = false;
      }
      break;
    
    case 'text':
    default:
      if (condition.matchType === 'exact') {
        matches = content === condition.text;
      } else if (condition.matchType === 'regex') {
        try {
          const regex = new RegExp(condition.text, 'i');
          matches = regex.test(content);
        } catch {
          matches = false;
        }
      } else {
        matches = content.toLowerCase().includes(condition.text.toLowerCase());
      }
      break;
  }
  
  return condition.negate ? !matches : matches;
};

/**
 * Enrich results with full hierarchical context
 */
const enrichWithFullHierarchy = async (
  results: any[],
  includeChildren: boolean,
  childDepth: number,
  includeParents: boolean,
  parentDepth: number,
  secureMode: boolean = false
): Promise<any[]> => {
  const enrichedResults = [];

  for (const [uid, content, time, pageTitle, pageUid] of results) {
    const blockResult = {
      uid,
      content: secureMode ? undefined : content,
      created: new Date(time),
      modified: new Date(time),
      pageTitle,
      pageUid,
      isDaily: isDailyNote(pageUid),
      children: [],
      parents: [],
      hierarchyDepth: 0
    };

    // Get full hierarchy context
    if (includeChildren) {
      blockResult.children = await getBlockChildren(uid, childDepth, secureMode);
      blockResult.hierarchyDepth = Math.max(blockResult.hierarchyDepth, getMaxDepth(blockResult.children));
    }

    if (includeParents) {
      blockResult.parents = await getBlockParents(uid, parentDepth, secureMode);
    }

    enrichedResults.push(blockResult);
  }

  return enrichedResults;
};

/**
 * Calculate maximum depth of hierarchy
 */
const getMaxDepth = (children: any[], currentDepth: number = 0): number => {
  if (!children || children.length === 0) return currentDepth;
  
  let maxDepth = currentDepth;
  for (const child of children) {
    if (child.children) {
      maxDepth = Math.max(maxDepth, getMaxDepth(child.children, currentDepth + 1));
    }
  }
  
  return maxDepth;
};

/**
 * Sort hierarchy results
 */
const sortHierarchyResults = (results: any[], sortBy: string, originalConditions: any[]): any[] => {
  return results.sort((a, b) => {
    switch (sortBy) {
      case 'recent':
        return b.modified.getTime() - a.modified.getTime();
      
      case 'page_title':
        return a.pageTitle.localeCompare(b.pageTitle);
      
      case 'hierarchy_depth':
        return b.hierarchyDepth - a.hierarchyDepth;
      
      case 'relevance':
      default:
        const scoreA = calculateHierarchyRelevanceScore(a, originalConditions);
        const scoreB = calculateHierarchyRelevanceScore(b, originalConditions);
        
        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }
        
        return b.modified.getTime() - a.modified.getTime();
    }
  });
};

/**
 * Calculate relevance score including hierarchy context
 */
const calculateHierarchyRelevanceScore = (result: any, conditions: any[]): number => {
  let score = 0;
  const content = result.content.toLowerCase();

  // Score based on main content
  for (const condition of conditions) {
    if (condition.type === 'text') {
      const text = condition.text.toLowerCase();
      const weight = condition.weight;

      if (condition.matchType === 'exact' && content === text) {
        score += 10 * weight;
      } else if (content.includes(text)) {
        const exactWordMatch = new RegExp(`\\b${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(content);
        score += exactWordMatch ? 5 * weight : 2 * weight;
      }
    }
  }

  // Bonus for hierarchy depth (more context = higher relevance)
  score += result.hierarchyDepth * 0.5;

  // Bonus for having both children and parents
  if (result.children.length > 0 && result.parents.length > 0) {
    score += 1;
  }

  return score;
};

export const findBlocksWithHierarchyTool = tool(
  async (input) => {
    const startTime = performance.now();
    try {
      const results = await findBlocksWithHierarchyImpl(input);
      return createToolResult(true, results, undefined, "findBlocksWithHierarchy", startTime);
    } catch (error) {
      console.error('FindBlocksWithHierarchy tool error:', error);
      return createToolResult(false, undefined, error.message, "findBlocksWithHierarchy", startTime);
    }
  },
  {
    name: "findBlocksWithHierarchy",
    description: "Find blocks with hierarchical context using content and structural conditions. Supports text search, references, hierarchy filtering (descendants/ancestors), and enriched results with parent/child context. Use secureMode=true for UIDs/metadata only.",
    schema
  }
);