# Roam Research ReAct Agent - Core Tools Specification

## Overview

This ReAct agent provides intelligent search capabilities for Roam Research graphs through a set of elementary tools. The architecture follows a security-tiered approach:

- **Secure Level**: Tools that only access UIDs, titles, and metadata (no content reading)
- **Content Level**: Tools that access actual block/page content (requires explicit permission)

## Core Tools (TypeScript Implementation)

### 1. `findPagesByTitle` (Secure Level)

**Purpose**: Find pages by exact title matching, regex, or contains logic.

```typescript
interface FindPagesByTitleParams {
  conditions: {
    text: string; // Page title or pattern to search for
    matchType: "exact" | "contains" | "regex";
    semanticExpansion?: "fuzzy" | "synonyms" | "related_concepts" | "broader_terms" | "custom" | "all" | "automatic";
    negate?: boolean; // Exclude pages matching this condition
  }[];
  combineConditions: "AND" | "OR";
  includeDaily: boolean; // Include Daily Note Pages
  dateRange?: {
    start?: string; // YYYY-MM-DD
    end?: string; // YYYY-MM-DD
    filterMode?: "created" | "modified";
  };
  limit?: number; // Max results (default: 100)
}

interface PageResult {
  uid: string;
  title: string;
  created: Date;
  modified: Date;
  isDaily: boolean;
}
```


### 2. `findPagesByContent` (Secure Level)

**Purpose**: Find pages based on their content structure and characteristics.

```typescript
interface ContentCondition {
  text: string; // Search text, page name, or regex pattern
  type: "text" | "page_ref" | "block_ref" | "regex" | "page_ref_or";
  matchType: "exact" | "contains" | "regex";
  semanticExpansion?: "fuzzy" | "synonyms" | "related_concepts" | "broader_terms" | "custom" | "all";
  negate?: boolean; // Exclude content matching this condition
}

interface FindPagesByContentParams {
  conditions?: ContentCondition[];
  conditionGroups?: {
    conditions: ContentCondition[];
    combination: "AND" | "OR";
  }[];
  searchScope: "content" | "block"; // How to apply conditions
  combineConditions?: "AND" | "OR";
  groupCombination?: "AND" | "OR";
  minBlockCount?: number; // Min blocks that must match per page
  maxBlockCount?: number | null; // Max blocks that can match per page
  includeBlockSamples?: boolean; // Include sample matching blocks
  maxSamples?: number; // Max sample blocks per page
  sortBy?: "relevance" | "creation" | "modification" | "recent" | "random" | "alphabetical" | "block_count" | "total_blocks";
  limit?: number;
  fromResultId?: string; // Limit to pages from previous result
  excludeBlockUid?: string; // Block UID to exclude from search
}

interface PageContentResult extends PageResult {
  blockCount?: number;
  totalBlocks?: number;
  matchedSamples?: Array<{
    uid: string;
    content: string;
    created: Date;
    modified: Date;
  }>;
}
```

### 3. `findBlocksByContent` (Secure Level)

**Purpose**: Find blocks by content conditions with semantic expansion support.

```typescript
interface ContentCondition {
  text: string; // Search text is required
  type: "text" | "page_ref" | "block_ref" | "regex" | "page_ref_or";
  matchType: "exact" | "contains" | "regex";
  negate?: boolean; // Exclude blocks matching this condition
}

interface FindBlocksByContentParams {
  conditions?: ContentCondition[];
  conditionGroups?: {
    conditions: ContentCondition[];
    combination: "AND" | "OR";
  }[];
  combineConditions?: "AND" | "OR";
  groupCombination?: "AND" | "OR";
  includeChildren?: boolean; // Include child blocks (expensive)
  childDepth?: number;
  includeParents?: boolean; // Include parent blocks (expensive)
  parentDepth?: number;
  includeDaily?: boolean;
  dailyNotesOnly?: boolean; // Search ONLY in daily notes
  dateRange?: {
    start?: Date | string;
    end?: Date | string;
    filterMode?: "created" | "modified";
  };
  sortBy?: "relevance" | "creation" | "modification" | "alphabetical" | "random";
  sortOrder?: "asc" | "desc";
  limit?: number;
  resultMode?: "full" | "summary" | "uids_only";
  summaryLimit?: number;
  secureMode?: boolean; // Exclude content from results
  excludeBlockUid?: string; // Block UID to exclude
  limitToPages?: string[]; // Limit to specific pages by title
  fromResultId?: string; // Limit to previous result
  limitToBlockUids?: string[];
  limitToPageUids?: string[];
  fuzzyMatching?: boolean; // Enable typo tolerance
  fuzzyThreshold?: number; // Similarity threshold
}

interface BlockResult {
  uid: string;
  content: string;
  pageUid: string;
  pageTitle: string;
  parentUid?: string;
  created: Date;
  modified: Date;
  children?: BlockResult[]; // If includeChildren = true
  parents?: BlockResult[]; // If includeParents = true
}
```

### 4. `findBlocksWithHierarchy` (Secure Level)

**Purpose**: Find blocks with hierarchical relationship conditions (parent/child logic).

```typescript
interface FindBlocksWithHierarchyParams {
  // Block-level conditions (what the block itself must match)
  blockConditions?: ContentCondition[];
  blockConditionGroups?: {
    conditions: ContentCondition[];
    combination: "AND" | "OR";
  }[];
  blockCombination?: "AND" | "OR";

  // Hierarchy conditions (what must exist in ancestors/descendants)
  hierarchyDirection: "ancestors" | "descendants" | "siblings";
  hierarchyDepth?: number; // How many levels to search
  hierarchyConditions?: ContentCondition[];
  hierarchyConditionGroups?: {
    conditions: ContentCondition[];
    combination: "AND" | "OR";
  }[];
  hierarchyCombination?: "AND" | "OR";

  // Options
  includeHierarchyInResults?: boolean;
  limitToPageUids?: string[];
  fromResultId?: string;
  semanticExpansion?: {
    enabled: boolean;
    strategies: string[];
    maxExpansions: number;
  };
  limit?: number;
}
```

### 5. `extractHierarchyContent` (Content Level - Requires Permission)

**Purpose**: Extract and format the hierarchical content around blocks/pages.

```typescript
interface ExtractHierarchyParams {
  blockUids?: string[]; // Block UIDs to extract content from
  fromResultId?: string; // Extract from previous search result
  extractOptions?: {
    maxBlocks?: number; // Max blocks to include
    maxDepth?: number; // Max hierarchy depth
    includeReferences?: boolean; // Include page/block references
    includeMetadata?: boolean; // Include creation/modification dates
    truncateLength?: number; // Max characters per block
    indentSize?: number; // Spaces per indentation level
    bulletStyle?: "dash" | "bullet" | "number" | "none";
  };
  formatOptions?: {
    outputFormat?: "markdown" | "plain" | "roam" | "outline";
    includeBlockUIDs?: boolean;
    includePageContext?: boolean;
    separatePages?: boolean;
    addTimestamps?: boolean;
    linkFormat?: "roam" | "markdown" | "plain";
  };
  excludeEmpty?: boolean; // Exclude empty blocks
  includeParents?: boolean; // Include parent blocks for context
  includeChildren?: boolean; // Include child blocks
  resolveReferences?: boolean; // Resolve page/block references to content
  maxReferenceDepth?: number; // Max depth for reference resolution
}

interface HierarchyContent {
  rootUid: string;
  content: string; // Formatted content
  structure: BlockNode[]; // Tree structure
  references: Array<{ type: "page" | "block"; uid: string; title?: string }>;
  stats: {
    totalBlocks: number;
    maxDepth: number;
    totalCharacters: number;
    truncated: boolean;
  };
}

interface BlockNode {
  uid: string;
  content: string;
  level: number; // Indentation level
  children: BlockNode[];
  created?: Date;
  modified?: Date;
  page?: string;
  pageUid?: string;
  references?: string[];
}
```

### 6. `combineResults` (Secure Level)

**Purpose**: Perform set operations on search results.

```typescript
interface ResultSet {
  name: string; // Name identifier for this result set
  uids: string[]; // Array of UIDs (blocks or pages)
  type: "pages" | "blocks"; // Type of entities
  metadata?: Record<string, any>; // Additional metadata
}

interface CombineResultsParams {
  resultSets: ResultSet[]; // At least two result sets required
  operation: "union" | "intersection" | "difference" | "symmetric_difference";
  deduplicateWithin?: boolean; // Remove duplicates within each set
  deduplicateAcross?: boolean; // Remove duplicates across sets
  preserveOrder?: boolean; // Attempt to preserve original ordering
  orderBy?: "first_appearance" | "alphabetical" | "frequency" | "reverse_frequency";
  minAppearances?: number; // Min times UID must appear across sets
  maxAppearances?: number; // Max times UID can appear across sets
  includeStats?: boolean; // Include operation statistics
  includeSourceInfo?: boolean; // Include source set information
  limit?: number; // Max results to return
}

interface CombinedResult {
  uids: string[];
  type: "pages" | "blocks";
  operation: string;
  stats: {
    totalInputUids: number;
    uniqueInputUids: number;
    finalCount: number;
    duplicatesRemoved: number;
    operationCounts: Record<string, number>;
  };
  sourceInfo?: Record<string, string[]>; // UID -> source set names
  metadata?: Record<string, any>;
}
```

### 7. `executeDatomicQuery` (Secure Level - Fallback Tool)

**Purpose**: Execute custom Datomic queries for edge cases not covered by elementary tools.

```typescript
interface ExecuteDatomicQueryParams {
  query: string; // Datomic query string
  explanation?: string; // Human-readable explanation of what the query does
  expectedResultType?: "blocks" | "pages" | "custom";
  limit?: number; // Max results to return
  timeout?: number; // Query timeout in milliseconds
}

interface DatomicQueryResult {
  success: boolean;
  data: any[]; // Query results
  explanation?: string;
  queryTime?: number; // Execution time
  resultCount: number;
}
```

### 8. `extractPagesReferences` (Secure Level)

**Purpose**: Extract page references from blocks or pages.

```typescript
interface ExtractPagesReferencesParams {
  blockUids?: string[]; // Block UIDs to extract references from
  pageUids?: string[]; // Page UIDs to extract references from
  pageTitles?: string[]; // Page titles to extract references from
  fromResultId?: string; // Extract from previous search result
  excludePages?: string[]; // Page titles to exclude
  excludeDaily?: boolean; // Exclude daily note pages
  sortBy?: "count" | "alphabetical" | "none";
  limit?: number; // Max referenced pages to return
  minCount?: number; // Min reference count to include
}

interface PageReferenceResult {
  pageTitle: string;
  pageUid: string;
  referenceCount: number;
  isDaily: boolean;
}
```

### 9. `getNodeDetails` (Secure Level)

**Purpose**: Get detailed information about specific blocks or pages.

```typescript
interface GetNodeDetailsParams {
  blockUids?: string[]; // Block UIDs to get details for
  pageUids?: string[]; // Page UIDs to get details for
  fromResultId?: string; // Get details from previous result
  includeContent?: boolean; // Include full content
  includeMetadata?: boolean; // Include dates
  includeHierarchy?: boolean; // Include parent/child info
  limit?: number; // Max nodes to fetch
}

interface NodeDetailsResult {
  uid: string;
  type: "block" | "page";
  content?: string;
  title?: string; // For pages
  pageUid?: string; // For blocks
  pageTitle?: string; // For blocks
  created?: Date;
  modified?: Date;
  parentUid?: string; // For blocks
  childrenCount?: number;
}
```

### 10. `generateDatomicQuery` (Deprecated - Use executeDatomicQuery instead)

**Purpose**: Generate custom Datomic queries for edge cases not covered by elementary tools.

```typescript
interface GenerateDatomicQueryParams {
  description: string; // Natural language description
  expectedResultType: "blocks" | "pages" | "references";
  safetyMode: boolean; // Limit complexity to prevent graph freeze
  templateHints?: string[]; // Suggest query patterns to try
  maxComplexity?: "low" | "medium" | "high";
}

interface DatomicQueryResult {
  query: string; // Generated Datomic query
  explanation: string; // Human-readable explanation
  estimatedComplexity: "low" | "medium" | "high";
  warnings?: string[]; // Potential performance issues
  parameters?: Record<string, any>; // Query parameters
}
```

## Common Types

```typescript
interface DateRange {
  start: Date;
  end: Date;
}

interface Reference {
  type: "page" | "block";
  uid: string;
  title?: string; // For page references
}
```

## Implementation Guidelines

### Security Architecture

1. **Secure Level Tools** (1-4, 6-9): Only access UIDs, titles, metadata. Safe to use without explicit permission.
2. **Content Level Tools** (5): Access actual text content. Require explicit user consent.

### Semantic Expansion Logic

- **Trigger**: When `semanticExpansion` parameter is specified in tool conditions
- **Strategies**: "fuzzy" (typos), "synonyms" (alternatives), "related_concepts" (associated terms), "broader_terms" (categories), "all" (comprehensive)
- **Process**: LLM generates expansion terms → test each with original tool → combine results
- **Fallback**: If expansion fails, continue with original results

### ReAct Flow

The agent should naturally discover the right combination of tools:

1. **Start simple**: Try the most direct tool for the user's request
2. **Observe results**: Check if results are sufficient/relevant
3. **Expand or combine**: Use semantic expansion or combine multiple tools
4. **Extract content**: Only if user needs actual content and permission is granted

### Error Handling

- **Invalid queries**: Use `generateDatomicQuery` as fallback
- **Performance issues**: Implement timeouts and result limits
- **Empty results**: Suggest semantic expansion or alternative approaches

### Optimization

- **Caching**: Cache page titles and basic metadata
- **Query complexity**: Monitor and warn about expensive operations
- **Result limits**: Default to reasonable limits, allow user override

## Usage Notes for Claude Code

1. Each tool is implemented in its own modular folder with separate schemas and executors
2. All tools support result chaining via `fromResultId` for performance optimization
3. Tools support both simple conditions and grouped conditions for complex logic
4. Semantic expansion is available on individual conditions in findPagesByTitle and findPagesByContent
5. The ReAct agent should automatically choose and combine tools based on user requests
6. Always respect the security levels - never access content without explicit permission
7. Use `secureMode` flag when content access is not needed
8. Prefer `resultMode: 'summary'` for large datasets to prevent token bloat
