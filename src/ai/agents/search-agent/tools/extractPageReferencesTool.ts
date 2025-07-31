import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  executeDatomicQuery,
  isDailyNote,
  createToolResult,
} from "./searchUtils";

/**
 * Extract page references from blocks or pages
 * Security Level: Secure (only extracts page references, no block content)
 * 
 * This tool efficiently extracts all page references from a given set of blocks or pages
 * using Roam's :block/refs attribute. Perfect for analytical queries after getting search results.
 */

const schema = z.object({
  // Input source - either block UIDs or page UIDs/titles
  blockUids: z.array(z.string()).optional().describe("Array of block UIDs to extract references from"),
  pageUids: z.array(z.string()).optional().describe("Array of page UIDs - will extract references from all blocks in these pages"),
  pageTitles: z.array(z.string()).optional().describe("Array of page titles - will extract references from all blocks in these pages"),
  
  // Filtering options
  excludePages: z.array(z.string()).default([]).describe("Page titles to exclude from results"),
  excludeDaily: z.boolean().default(false).describe("Exclude daily note pages from results"),
  
  // Output options
  includeCount: z.boolean().default(true).describe("Include reference count for each page"),
  sortBy: z.enum(["count", "alphabetical", "none"]).default("count").describe("How to sort results"),
  limit: z.number().min(1).max(500).default(100).describe("Maximum number of referenced pages to return"),
  minCount: z.number().min(1).default(1).describe("Minimum reference count to include in results"),
});

const extractPageReferencesImpl = async (input: z.infer<typeof schema>) => {
  console.log(`🔧 extractPageReferencesImpl input:`, input);
  const {
    blockUids,
    pageUids,
    pageTitles,
    excludePages,
    excludeDaily,
    includeCount,
    sortBy,
    limit,
    minCount,
  } = input;

  // Validate input - at least one source must be provided
  if (!blockUids?.length && !pageUids?.length && !pageTitles?.length) {
    throw new Error("Must provide at least one of: blockUids, pageUids, or pageTitles");
  }

  // Step 1: Get all target block UIDs to analyze
  const targetBlockUids = await getTargetBlockUids(blockUids, pageUids, pageTitles);
  
  if (targetBlockUids.length === 0) {
    console.log("📊 No target blocks found");
    return [];
  }

  console.log(`📊 Analyzing references from ${targetBlockUids.length} blocks`);

  // Step 2: Extract page references using :block/refs
  const pageReferences = await extractReferencesFromBlocks(targetBlockUids);

  console.log(`📊 Found ${pageReferences.length} raw page references`);

  // Step 3: Process, deduplicate, and count
  const processedReferences = processAndCountReferences(
    pageReferences,
    excludePages,
    excludeDaily,
    includeCount
  );

  console.log(`📊 After filtering: ${processedReferences.length} unique page references`);

  // Step 4: Filter by minimum count
  const filteredReferences = processedReferences.filter(ref => 
    !includeCount || ref.count >= minCount
  );

  // Step 5: Sort results
  if (sortBy !== "none") {
    filteredReferences.sort((a, b) => {
      if (sortBy === "count" && includeCount) {
        return b.count - a.count; // Descending by count
      } else {
        return a.pageTitle.localeCompare(b.pageTitle); // Alphabetical
      }
    });
  }

  // Step 6: Limit results
  const limitedResults = filteredReferences.slice(0, limit);

  console.log(`📊 Returning ${limitedResults.length} page references`);
  return limitedResults;
};

/**
 * Get all target block UIDs from various input sources
 */
const getTargetBlockUids = async (
  blockUids?: string[],
  pageUids?: string[],
  pageTitles?: string[]
): Promise<string[]> => {
  let allBlockUids: string[] = [];

  // Add direct block UIDs
  if (blockUids?.length) {
    allBlockUids.push(...blockUids);
  }

  // Get blocks from page UIDs
  if (pageUids?.length) {
    const blocksFromPageUids = await getBlocksFromPageUids(pageUids);
    allBlockUids.push(...blocksFromPageUids);
  }

  // Get blocks from page titles
  if (pageTitles?.length) {
    const blocksFromPageTitles = await getBlocksFromPageTitles(pageTitles);
    allBlockUids.push(...blocksFromPageTitles);
  }

  // Remove duplicates
  return [...new Set(allBlockUids)];
};

/**
 * Get all block UIDs from pages by their UIDs
 */
const getBlocksFromPageUids = async (pageUids: string[]): Promise<string[]> => {
  const uidsClause = pageUids.map(uid => `"${uid}"`).join(' ');
  
  const query = `[:find ?block-uid
                  :where
                  [?page :block/uid ?page-uid]
                  [(contains? #{${uidsClause}} ?page-uid)]
                  [?page :block/children ?block]
                  [?block :block/uid ?block-uid]]`;

  console.log("🔍 Getting blocks from page UIDs...");
  const results = await executeDatomicQuery(query);
  return results.map(([blockUid]) => blockUid as string);
};

/**
 * Get all block UIDs from pages by their titles
 */
const getBlocksFromPageTitles = async (pageTitles: string[]): Promise<string[]> => {
  const titlesClause = pageTitles.map(title => `"${title}"`).join(' ');
  
  const query = `[:find ?block-uid
                  :where
                  [?page :node/title ?page-title]
                  [(contains? #{${titlesClause}} ?page-title)]
                  [?page :block/children ?block]
                  [?block :block/uid ?block-uid]]`;

  console.log("🔍 Getting blocks from page titles...");
  const results = await executeDatomicQuery(query);
  return results.map(([blockUid]) => blockUid as string);
};

/**
 * Extract page references from blocks using :block/refs
 */
const extractReferencesFromBlocks = async (blockUids: string[]): Promise<Array<{pageTitle: string, pageUid: string}>> => {
  if (blockUids.length === 0) return [];

  // Split into chunks to avoid query size limits
  const chunkSize = 100;
  const chunks = [];
  for (let i = 0; i < blockUids.length; i += chunkSize) {
    chunks.push(blockUids.slice(i, i + chunkSize));
  }

  let allReferences: Array<{pageTitle: string, pageUid: string}> = [];

  for (const chunk of chunks) {
    const uidsClause = chunk.map(uid => `"${uid}"`).join(' ');
    
    const query = `[:find ?page-title ?page-uid
                    :where
                    [?block :block/uid ?block-uid]
                    [(contains? #{${uidsClause}} ?block-uid)]
                    [?block :block/refs ?ref-page]
                    [?ref-page :node/title ?page-title]
                    [?ref-page :block/uid ?page-uid]]`;

    console.log(`🔍 Extracting references from ${chunk.length} blocks...`);
    const results = await executeDatomicQuery(query);
    
    const chunkReferences = results.map(([pageTitle, pageUid]) => ({
      pageTitle: pageTitle as string,
      pageUid: pageUid as string,
    }));

    allReferences.push(...chunkReferences);
  }

  return allReferences;
};

/**
 * Process references: deduplicate, count, and filter
 */
const processAndCountReferences = (
  references: Array<{pageTitle: string, pageUid: string}>,
  excludePages: string[],
  excludeDaily: boolean,
  includeCount: boolean
): Array<{pageTitle: string, pageUid: string, count: number, isDaily: boolean}> => {
  // Count occurrences
  const countMap = new Map<string, {pageTitle: string, pageUid: string, count: number, isDaily: boolean}>();

  for (const ref of references) {
    const key = ref.pageUid;
    const isDaily = isDailyNote(ref.pageUid);
    
    // Apply filters
    if (excludePages.includes(ref.pageTitle)) continue;
    if (excludeDaily && isDaily) continue;

    if (countMap.has(key)) {
      countMap.get(key)!.count++;
    } else {
      countMap.set(key, {
        pageTitle: ref.pageTitle,
        pageUid: ref.pageUid,
        count: 1,
        isDaily,
      });
    }
  }

  return Array.from(countMap.values());
};

export const extractPageReferencesTool = tool(
  async (input) => {
    const startTime = performance.now();
    try {
      const results = await extractPageReferencesImpl(input);
      return createToolResult(
        true,
        results,
        undefined,
        "extractPageReferences",
        startTime
      );
    } catch (error) {
      console.error("ExtractPageReferences tool error:", error);
      return createToolResult(
        false,
        undefined,
        error.message,
        "extractPageReferences",
        startTime
      );
    }
  },
  {
    name: "extractPageReferences",
    description:
      "Extract and count page references from blocks or pages using database queries. Perfect for analytical tasks after getting search results - can analyze which pages are referenced in specific blocks/pages. Input can be block UIDs, page UIDs, or page titles. Returns deduplicated page references with counts, sorted by frequency or alphabetically. Very fast for large datasets since it uses database-level :block/refs queries.",
    schema,
  }
);