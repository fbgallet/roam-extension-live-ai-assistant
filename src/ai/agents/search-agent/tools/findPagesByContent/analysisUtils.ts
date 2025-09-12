import { executeDatomicQuery, isDailyNote } from "../../helpers/searchUtils";

/**
 * Analyze pages by grouping their matching blocks
 */
export const analyzePagesByBlocks = async (
  matchingBlocks: any[],
  minBlockCount: number,
  maxBlockCount?: number | null,
  minTotalBlocks?: number,
  maxTotalBlocks?: number
): Promise<any[]> => {
  // Group blocks by page
  const pageMap = new Map();

  for (const block of matchingBlocks) {
    const [
      blockUid,
      content,
      time,
      pageTitle,
      pageUid,
      pageCreated,
      pageModified,
    ] = block;

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
        totalBlocks,
      });
    }

    const pageData = pageMap.get(pageUid);
    pageData.matchingBlocks.push({
      uid: blockUid,
      content,
      modified: new Date(time),
    });
  }

  // Filter pages based on criteria
  const qualifyingPages = [];

  for (const pageData of Array.from(pageMap.values())) {
    const matchingCount = pageData.matchingBlocks.length;
    const totalCount = pageData.totalBlocks;

    // Check block count criteria
    if (matchingCount < minBlockCount) continue;
    if (maxBlockCount !== null && maxBlockCount !== undefined && matchingCount > maxBlockCount) continue;
    if (minTotalBlocks && totalCount < minTotalBlocks) continue;
    if (maxTotalBlocks && totalCount > maxTotalBlocks) continue;

    qualifyingPages.push(pageData);
  }

  return qualifyingPages;
};

/**
 * Enrich page results with detailed content analysis
 */
export const enrichPageResults = async (
  pageAnalysis: any[],
  includeBlockCount: boolean,
  includeBlockSamples: boolean,
  maxSamples: number,
  includeContentStats: boolean,
  conditions?: any[]
): Promise<any[]> => {
  const enrichedResults = [];

  for (const pageData of pageAnalysis) {
    const result: any = {
      uid: pageData.pageUid,
      title: pageData.pageTitle,
      created: pageData.pageCreated,
      modified: pageData.pageModified,
      isDaily: pageData.isDaily,
      totalBlocks: pageData.totalBlocks,
      // Explicit type flag
      isPage: true,
    };

    if (includeBlockCount) {
      result.matchingBlockCount = pageData.matchingBlocks.length;
      result.matchRatio = (
        pageData.matchingBlocks.length / pageData.totalBlocks
      ).toFixed(3);
    }

    if (includeBlockSamples) {
      // Sort blocks by relevance and modification time
      const sortedBlocks = pageData.matchingBlocks
        .sort((a: any, b: any) => {
          // Simple relevance: prefer longer content
          const scoreA = a.content.length;
          const scoreB = b.content.length;

          if (scoreA !== scoreB) {
            return scoreB - scoreA;
          }

          return b.modified.getTime() - a.modified.getTime();
        })
        .slice(0, maxSamples);

      result.sampleBlocks = sortedBlocks.map((block: any) => ({
        uid: block.uid,
        content:
          block.content.length > 200
            ? block.content.substring(0, 200) + "..."
            : block.content,
        modified: block.modified,
      }));
    }

    if (includeContentStats) {
      const allContent = pageData.matchingBlocks
        .map((b: any) => b.content)
        .join(" ");

      result.contentStats = {
        totalCharacters: allContent.length,
        averageBlockLength: Math.round(
          allContent.length / pageData.matchingBlocks.length
        ),
        uniqueWords: new Set(allContent.toLowerCase().split(/\s+/)).size,
        hasReferences: /\[\[[^\]]+\]\]|\(\([^)]+\)\)/.test(allContent),
      };
    }

    // Calculate relevance score
    result.relevanceScore = calculatePageRelevanceScore(pageData, conditions || []);

    enrichedResults.push(result);
  }

  return enrichedResults;
};

/**
 * Calculate relevance score for a page based on its content matches
 */
export const calculatePageRelevanceScore = (
  pageData: any,
  conditions: any[]
): number => {
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
      if (condition.type === "text") {
        const text = condition.text.toLowerCase();
        const weight = condition.weight || 1;

        if (condition.matchType === "exact" && content === text) {
          score += 5 * weight;
        } else if (content.includes(text)) {
          const exactWordMatch = new RegExp(
            `\\b${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`
          ).test(content);
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
export const sortPageResults = (
  results: any[],
  sortBy: string,
  _originalConditions?: any[]
): any[] => {
  return results.sort((a, b) => {
    switch (sortBy) {
      case "recent":
        return b.modified.getTime() - a.modified.getTime();

      case "page_title":
      case "alphabetical":
        return a.title.localeCompare(b.title);

      case "block_count":
        return (b.matchingBlockCount || 0) - (a.matchingBlockCount || 0);

      case "total_blocks":
        return (b.totalBlocks || 0) - (a.totalBlocks || 0);

      case "creation":
        return b.created.getTime() - a.created.getTime();

      case "modification":
        return b.modified.getTime() - a.modified.getTime();

      case "relevance":
      default:
        if (a.relevanceScore !== b.relevanceScore) {
          return b.relevanceScore - a.relevanceScore;
        }
        return b.modified.getTime() - a.modified.getTime();
    }
  });
};