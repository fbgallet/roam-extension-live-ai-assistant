import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { 
  executeDatomicQuery, 
  isDailyNote, 
  filterByDateRange, 
  createToolResult, 
  generateSemanticExpansions,
  DatomicQueryBuilder,
  SearchCondition,
  processEnhancedResults,
  getEnhancedLimits,
} from './searchUtils';
import { dnpUidRegex } from '../../../../utils/regex.js';

/**
 * Find pages by analyzing their content blocks with aggregation and filtering
 * Security Level: Flexible (secure mode = UIDs/metadata only, content mode = includes block samples)
 * 
 * This tool searches pages based on the content of their blocks, with support for
 * content aggregation, statistical analysis, and intelligent page-level filtering.
 * Use secureMode=true to exclude block content from results (UIDs and metadata only).
 */

const contentConditionSchema = z.object({
  type: z.enum(["text", "page_ref", "block_ref", "regex"]).default("text"),
  text: z.string().min(1, "Search text is required"),
  matchType: z.enum(["exact", "contains", "regex"]).default("contains"),
  semanticExpansion: z.boolean().default(false).describe("Only use when few results or user requests semantic search"),
  weight: z.number().min(0).max(10).default(1.0),
  negate: z.boolean().default(false)
});

const schema = z.object({
  conditions: z.array(contentConditionSchema).min(1, "At least one condition is required"),
  combineConditions: z.enum(["AND", "OR"]).default("AND"),
  maxExpansions: z.number().min(1).max(10).default(3),
  expansionStrategy: z.enum(["synonyms", "related_concepts", "broader_terms"]).default("related_concepts"),
  
  // Page-level filtering
  minBlockCount: z.number().min(1).default(1).describe("Minimum blocks that must match per page"),
  maxBlockCount: z.number().optional().describe("Maximum blocks that can match per page"),
  minTotalBlocks: z.number().min(1).default(1).describe("Minimum total blocks page must have"),
  maxTotalBlocks: z.number().optional().describe("Maximum total blocks page can have"),
  
  // Content analysis
  includeBlockCount: z.boolean().default(true).describe("Include matching block count in results"),
  includeBlockSamples: z.boolean().default(true).describe("Include sample matching blocks"),
  maxSamples: z.number().min(1).max(20).default(5).describe("Max sample blocks per page"),
  includeContentStats: z.boolean().default(false).describe("Include content statistics"),
  
  // Filtering
  includeDaily: z.boolean().default(true),
  dateRange: z.object({
    start: z.union([z.date(), z.string()]).optional(),
    end: z.union([z.date(), z.string()]).optional()
  }).optional(),
  // Enhanced sorting and sampling options
  sortBy: z.enum(["relevance", "creation", "modification", "alphabetical", "random", "block_count", "total_blocks"]).default("relevance"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  limit: z.number().min(1).max(10000).default(200), // Increased limits
  
  // Random sampling for large datasets
  randomSample: z.object({
    enabled: z.boolean().default(false),
    size: z.number().min(1).max(5000).default(100),
    seed: z.number().optional().describe("Seed for reproducible random sampling")
  }).optional(),
  
  // Security mode
  secureMode: z.boolean().default(false).describe("If true, excludes block content from results (UIDs and metadata only)")
});

const findPagesByContentImpl = async (input: z.infer<typeof schema>) => {
  const {
    conditions,
    combineConditions,
    maxExpansions,
    expansionStrategy,
    minBlockCount,
    maxBlockCount,
    minTotalBlocks,
    maxTotalBlocks,
    includeBlockCount,
    includeBlockSamples,
    maxSamples,
    includeContentStats,
    includeDaily,
    dateRange,
    sortBy,
    limit,
    secureMode
  } = input;

  console.log(`🔍 FindPagesByContent: Analyzing pages with ${conditions.length} content conditions`);

  // Step 1: Expand conditions with semantic terms
  const expandedConditions = await expandConditions(
    conditions,
    expansionStrategy,
    maxExpansions
  );

  // Step 2: Find all blocks matching conditions
  const matchingBlocks = await findMatchingBlocks(
    expandedConditions,
    combineConditions,
    includeDaily
  );

  console.log(`📊 Found ${matchingBlocks.length} matching blocks across pages`);

  // Step 3: Group blocks by page and analyze
  const pageAnalysis = await analyzePagesByBlocks(
    matchingBlocks,
    minBlockCount,
    maxBlockCount,
    minTotalBlocks,
    maxTotalBlocks
  );

  console.log(`📊 Analyzed ${pageAnalysis.length} pages meeting criteria`);

  // Step 4: Enrich page results with content analysis
  let enrichedResults = await enrichPageResults(
    pageAnalysis,
    includeBlockCount,
    includeBlockSamples && !secureMode,  // Disable block samples in secure mode
    maxSamples,
    includeContentStats,
    expandedConditions
  );

  // Step 5: Apply date filtering
  if (dateRange && (dateRange.start || dateRange.end) && includeDaily) {
    const parsedDateRange = {
      start: typeof dateRange.start === 'string' ? new Date(dateRange.start) : dateRange.start,
      end: typeof dateRange.end === 'string' ? new Date(dateRange.end) : dateRange.end
    };
    enrichedResults = filterByDateRange(enrichedResults, parsedDateRange);
  }

  // Step 6: Sort results
  enrichedResults = sortPageResults(enrichedResults, sortBy, conditions);

  // Step 7: Limit results
  if (enrichedResults.length > limit) {
    enrichedResults = enrichedResults.slice(0, limit);
  }

  return enrichedResults;
};

/**
 * Expand conditions with semantic terms
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
 * Find all blocks matching the conditions
 */
const findMatchingBlocks = async (
  conditions: any[],
  combineLogic: "AND" | "OR",
  includeDaily: boolean
): Promise<any[]> => {
  let query = `[:find ?uid ?content ?time ?page-title ?page-uid ?page-created ?page-modified
                :where 
                [?b :block/uid ?uid]
                [?b :block/string ?content]
                [?b :block/page ?page]
                [?page :node/title ?page-title]
                [?page :block/uid ?page-uid]
                [?page :create/time ?page-created]
                [?page :edit/time ?page-modified]
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
 * Analyze pages by grouping their matching blocks
 */
const analyzePagesByBlocks = async (
  matchingBlocks: any[],
  minBlockCount: number,
  maxBlockCount?: number,
  minTotalBlocks?: number,
  maxTotalBlocks?: number
): Promise<any[]> => {
  // Group blocks by page
  const pageMap = new Map();
  
  for (const block of matchingBlocks) {
    const [blockUid, content, time, pageTitle, pageUid, pageCreated, pageModified] = block;
    
    if (!pageMap.has(pageUid)) {
      // Get total block count for this page
      const totalBlocksQuery = `[:find (count ?b)
                                :where 
                                [?page :block/uid "${pageUid}"]
                                [?page :block/children ?b]]`;
      
      const totalBlocksResult = await executeDatomicQuery(totalBlocksQuery);
      const totalBlocks = totalBlocksResult[0]?.[0] || 0;
      
      pageMap.set(pageUid, {
        pageUid,
        pageTitle,
        pageCreated: new Date(pageCreated),
        pageModified: new Date(pageModified),
        isDaily: isDailyNote(pageUid),
        matchingBlocks: [],
        totalBlocks
      });
    }
    
    const pageData = pageMap.get(pageUid);
    pageData.matchingBlocks.push({
      uid: blockUid,
      content,
      modified: new Date(time)
    });
  }

  // Filter pages based on criteria
  const qualifyingPages = [];
  
  for (const pageData of pageMap.values()) {
    const matchingCount = pageData.matchingBlocks.length;
    const totalCount = pageData.totalBlocks;
    
    // Check block count criteria
    if (matchingCount < minBlockCount) continue;
    if (maxBlockCount && matchingCount > maxBlockCount) continue;
    if (minTotalBlocks && totalCount < minTotalBlocks) continue;
    if (maxTotalBlocks && totalCount > maxTotalBlocks) continue;
    
    qualifyingPages.push(pageData);
  }

  return qualifyingPages;
};

/**
 * Enrich page results with detailed content analysis
 */
const enrichPageResults = async (
  pageAnalysis: any[],
  includeBlockCount: boolean,
  includeBlockSamples: boolean,
  maxSamples: number,
  includeContentStats: boolean,
  conditions: any[]
): Promise<any[]> => {
  const enrichedResults = [];

  for (const pageData of pageAnalysis) {
    const result: any = {
      uid: pageData.pageUid,
      title: pageData.pageTitle,
      created: pageData.pageCreated,
      modified: pageData.pageModified,
      isDaily: pageData.isDaily,
      totalBlocks: pageData.totalBlocks
    };

    if (includeBlockCount) {
      result.matchingBlockCount = pageData.matchingBlocks.length;
      result.matchRatio = (pageData.matchingBlocks.length / pageData.totalBlocks).toFixed(3);
    }

    if (includeBlockSamples) {
      // Sort blocks by relevance and modification time
      const sortedBlocks = pageData.matchingBlocks
        .sort((a, b) => {
          // Simple relevance: prefer longer content
          const scoreA = a.content.length;
          const scoreB = b.content.length;
          
          if (scoreA !== scoreB) {
            return scoreB - scoreA;
          }
          
          return b.modified.getTime() - a.modified.getTime();
        })
        .slice(0, maxSamples);
      
      result.sampleBlocks = sortedBlocks.map(block => ({
        uid: block.uid,
        content: block.content.length > 200 ? block.content.substring(0, 200) + '...' : block.content,
        modified: block.modified
      }));
    }

    if (includeContentStats) {
      const allContent = pageData.matchingBlocks.map(b => b.content).join(' ');
      
      result.contentStats = {
        totalCharacters: allContent.length,
        averageBlockLength: Math.round(allContent.length / pageData.matchingBlocks.length),
        uniqueWords: new Set(allContent.toLowerCase().split(/\s+/)).size,
        hasReferences: /\[\[[^\]]+\]\]|\(\([^)]+\)\)/.test(allContent)
      };
    }

    // Calculate relevance score
    result.relevanceScore = calculatePageRelevanceScore(pageData, conditions);

    enrichedResults.push(result);
  }

  return enrichedResults;
};

/**
 * Calculate relevance score for a page based on its content matches
 */
const calculatePageRelevanceScore = (pageData: any, conditions: any[]): number => {
  let score = 0;

  // Base score from number of matching blocks
  score += pageData.matchingBlocks.length * 2;

  // Bonus for match ratio (higher ratio = more relevant page)
  const matchRatio = pageData.matchingBlocks.length / pageData.totalBlocks;
  score += matchRatio * 10;

  // Score based on content quality
  for (const block of pageData.matchingBlocks) {
    const content = block.content.toLowerCase();
    
    for (const condition of conditions) {
      if (condition.type === 'text') {
        const text = condition.text.toLowerCase();
        const weight = condition.weight;

        if (condition.matchType === 'exact' && content === text) {
          score += 5 * weight;
        } else if (content.includes(text)) {
          const exactWordMatch = new RegExp(`\\b${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(content);
          score += exactWordMatch ? 3 * weight : 1 * weight;
        }
      }
    }
    
    // Bonus for longer, more substantial blocks
    if (block.content.length > 100) {
      score += 1;
    }
  }

  return score;
};

/**
 * Sort page results
 */
const sortPageResults = (results: any[], sortBy: string, originalConditions: any[]): any[] => {
  return results.sort((a, b) => {
    switch (sortBy) {
      case 'recent':
        return b.modified.getTime() - a.modified.getTime();
      
      case 'page_title':
        return a.title.localeCompare(b.title);
      
      case 'block_count':
        return b.matchingBlockCount - a.matchingBlockCount;
      
      case 'total_blocks':
        return b.totalBlocks - a.totalBlocks;
      
      case 'relevance':
      default:
        if (a.relevanceScore !== b.relevanceScore) {
          return b.relevanceScore - a.relevanceScore;
        }
        return b.modified.getTime() - a.modified.getTime();
    }
  });
};

export const findPagesByContentTool = tool(
  async (input) => {
    const startTime = performance.now();
    try {
      const results = await findPagesByContentImpl(input);
      return createToolResult(true, results, undefined, "findPagesByContent", startTime);
    } catch (error) {
      console.error('FindPagesByContent tool error:', error);
      return createToolResult(false, undefined, error.message, "findPagesByContent", startTime);
    }
  },
  {
    name: "findPagesByContent",
    description: "Find pages by analyzing their block content with aggregation and filtering. Supports content analysis, block counting, statistical analysis, and page-level filtering based on content patterns.",
    schema
  }
);