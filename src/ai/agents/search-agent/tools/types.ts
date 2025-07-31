// Common types for ReAct Search Agent Tools
// Based on react-agent-guidelines.md specification

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
}

export interface ContentCondition {
  text: string; // The search text
  matchType?: "exact" | "contains" | "regex"; // How to match the text (default: "contains")
  semanticExpansion?: boolean; // Enable semantic expansion for this condition (default: false)
  weight?: number; // Relevance weight for this condition (default: 1.0)
  negate?: boolean; // NOT condition (default: false)
}

export interface HierarchyCondition {
  direction: "descendants" | "ancestors";
  levels: number | "all"; // 1, 2, 3... or 'all'
  conditions: ContentCondition[]; // Conditions to match in hierarchy
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

// Base tool interface
export interface SearchTool {
  name: string;
  description: string;
  securityLevel: "secure" | "content";
  execute(params: any): Promise<any>;
}

// Tool execution result
export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  toolName: string;
  executionTime: number;
  tokensUsed?: number;
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
}