/**
 * Result types for search operations
 * Shared across all search tools for consistent result structures
 */

export interface DateRange {
  start: Date;
  end: Date;
}

export interface Reference {
  type: "page" | "block";
  uid: string;
  title?: string; // For page references
}

export interface PageResult {
  uid: string;
  title: string;
  created: Date;
  modified: Date;
  isDaily: boolean;
}

export interface SemanticSearchResult extends PageResult {
  matchedTerm: string; // Which expansion term matched
  expansionUsed: string[]; // All terms that were tested
  relevanceScore?: number; // If fallback filtering was used
}

export interface PageContentResult extends PageResult {
  blockCount: number;
  maxDepth: number;
  referenceCount: number;
  hasAttributes: boolean;
  matchedAttributes?: string[];
}

export interface BlockResult {
  uid: string;
  content: string;
  pageUid: string;
  pageTitle: string;
  parentUid?: string;
  created: Date;
  modified: Date;
  isDaily: boolean;
  children: any[]; // Child blocks with hierarchy
  parents: any[]; // Parent blocks with context
  matchedConditions?: string[]; // Which conditions/expansions matched
  expansionLevel?: number; // For ranking expanded results
}

export interface BlockNode {
  uid: string;
  content: string;
  level: number; // Indentation level
  children: BlockNode[];
  references: string[]; // Referenced UIDs in this block
}

export interface HierarchyContent {
  rootUid: string;
  content: string; // Formatted content
  structure: BlockNode[]; // Tree structure
  references: Reference[]; // Found references
  truncated: boolean; // True if maxBlocks limit was hit
}

export interface CombinedResult {
  uids: string[];
  operationApplied: string;
  originalCounts: number[]; // Counts from each input set
  finalCount: number;
}

export interface DatomicQueryResult {
  query: string; // Generated Datomic query
  explanation: string; // Human-readable explanation
  estimatedComplexity: "low" | "medium" | "high";
  warnings?: string[]; // Potential performance issues
  parameters?: Record<string, any>; // Query parameters
}

// Tool execution result
export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  toolName: string;
  executionTime: number;
  tokensUsed?: number;
  metadata?: {
    totalFound?: number;
    returnedCount?: number;
    wasLimited?: boolean;
    sortedBy?: string;
    sampled?: boolean;
    availableCount?: number;
    searchGuidance?: any;
  };
}

// ReAct agent state
export interface ReActState {
  userQuery: string;
  currentStep: number;
  executedTools: ToolExecutionResult[];
  reasoning: string[];
  finalResult?: any;
  conversationHistory?: any[];
  permissions: {
    contentAccess: boolean;
  };
  // Semantic expansion state
  isExpansionGlobal?: boolean;
  semanticExpansion?: string;
  customSemanticExpansion?: string;
  model?: any;
  language?: string;
  expansionLevel?: number;
}