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
  condition: string; // Search term or regex pattern
  matchType: "exact" | "regex" | "contains";
  includeDaily: boolean; // Include Daily Note Pages (DNP)
  dateRange?: DateRange; // Filter DNPs by date range
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

### 2. `findPagesSemantically` (Secure Level + LLM Expansion)

**Purpose**: Semantic page search through term expansion, with fallback strategies.

```typescript
interface FindPagesSemanticallyParams {
  query: string; // Natural language query
  maxExpansions?: number; // Max expansion terms (default: 5)
  expansionStrategy?: "synonyms" | "related_concepts" | "broader_terms";
  includeExact?: boolean; // Include exact query term (default: true)
  minResultsThreshold?: number; // Trigger expansion if results < threshold
  fallbackToFiltering?: boolean; // Use filtering approach if expansion fails
}

interface SemanticSearchResult extends PageResult {
  matchedTerm: string; // Which expansion term matched
  expansionUsed: string[]; // All terms that were tested
  relevanceScore?: number; // If fallback filtering was used
}
```

### 3. `findPagesByContent` (Secure Level)

**Purpose**: Find pages based on their content structure and characteristics.

```typescript
interface FindPagesByContentParams {
  conditions?: ContentCondition[]; // Text/reference conditions
  structuralFilters?: {
    requireEmpty?: boolean; // Pages with no content
    minBlocks?: number; // Minimum block count
    maxBlocks?: number; // Maximum block count
    minDepth?: number; // Min hierarchical depth
    minReferences?: number; // Min incoming references
    hasAttributes?: boolean; // Contains attributes (::)
    attributePatterns?: string[]; // Specific attribute patterns
  };
  includeDaily?: boolean;
  dateRange?: DateRange;
  limit?: number;
}

interface PageContentResult extends PageResult {
  blockCount: number;
  maxDepth: number;
  referenceCount: number;
  hasAttributes: boolean;
  matchedAttributes?: string[];
}
```

### 4. `findBlocksByContent` (Secure Level)

**Purpose**: Find blocks by content conditions with semantic expansion support.

```typescript
interface ContentCondition {
  type: "text" | "block_ref" | "page_ref" | "regex";
  value: string;
  negate?: boolean; // NOT condition
  expandSemantically?: boolean; // Trigger semantic expansion for this condition
}

interface FindBlocksByContentParams {
  conditions: ContentCondition[]; // AND logic between conditions
  pageFilter?: string[]; // Limit to specific page UIDs
  dateRange?: DateRange;
  semanticExpansion?: {
    enabled: boolean;
    onlyIfInsufficient?: boolean; // Only expand if results < threshold
    minResultsThreshold?: number; // Threshold to trigger expansion
    maxExpansions?: number; // Max terms per condition
  };
  limit?: number;
}

interface BlockResult {
  uid: string;
  pageUid: string;
  pageTitle: string;
  parentUid?: string;
  created: Date;
  modified: Date;
  matchedConditions?: string[]; // Which conditions/expansions matched
}
```

### 5. `findBlocksWithHierarchy` (Secure Level)

**Purpose**: Find blocks with hierarchical relationship conditions (parent/child logic).

```typescript
interface HierarchyCondition {
  direction: "descendants" | "ancestors";
  levels: number | "all"; // 1, 2, 3... or 'all'
  conditions: ContentCondition[]; // Conditions to match in hierarchy
}

interface FindBlocksWithHierarchyParams {
  blockConditions: ContentCondition[]; // Conditions on the block itself
  hierarchyCondition: HierarchyCondition; // Conditions on hierarchy
  pageFilter?: string[];
  semanticExpansion?: {
    enabled: boolean;
    onlyIfInsufficient?: boolean;
    minResultsThreshold?: number;
    maxExpansions?: number;
  };
  limit?: number;
}
```

### 6. `extractHierarchyContent` (Content Level - Requires Permission)

**Purpose**: Extract and format the hierarchical content around blocks/pages.

```typescript
interface ExtractHierarchyParams {
  rootUid: string; // Block UID or page UID
  direction: "descendants" | "ancestors" | "both";
  levels: number | "all";
  includeRefs: boolean; // Include [[page]] and ((block)) references
  format: "plain" | "markdown" | "structured";
  maxBlocks?: number; // Limit for performance
}

interface HierarchyContent {
  rootUid: string;
  content: string; // Formatted content
  structure: BlockNode[]; // Tree structure
  references: Reference[]; // Found references
  truncated: boolean; // True if maxBlocks limit was hit
}

interface BlockNode {
  uid: string;
  content: string;
  level: number; // Indentation level
  children: BlockNode[];
  references: string[]; // Referenced UIDs in this block
}
```

### 7. `combineResults` (Secure Level)

**Purpose**: Perform set operations on search results.

```typescript
interface CombineResultsParams {
  operation: "intersect" | "union" | "subtract";
  resultSets: string[][]; // Arrays of UIDs to combine
  preserveOrder?: boolean; // Maintain order from first set
  removeDuplicates?: boolean; // Remove duplicate UIDs (default: true)
}

interface CombinedResult {
  uids: string[];
  operationApplied: string;
  originalCounts: number[]; // Counts from each input set
  finalCount: number;
}
```

### 8. `generateDatomicQuery` (Secure Level - Fallback Tool)

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

1. **Secure Level Tools** (1-5, 7-8): Only access UIDs, titles, metadata. Safe to use without explicit permission.
2. **Content Level Tools** (6): Access actual text content. Require explicit user consent.

### Semantic Expansion Logic

- **Trigger**: When `semanticExpansion.enabled = true` AND results < `minResultsThreshold`
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

1. Each tool should be implemented as a separate function with clear TypeScript interfaces
2. Implement proper error handling and timeout mechanisms
3. Semantic expansion should be implemented as a helper function usable by multiple tools
4. The ReAct agent should automatically choose and combine tools based on user requests
5. Always respect the security levels - never access content without explicit permission
