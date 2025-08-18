/**
 * Centralized export for all search agent types
 * Import from this file to get access to all type definitions
 */

// Search condition types
export type {
  SearchCondition,
  CompoundCondition,
  HierarchyCondition,
  AttributeCondition,
  AttributeValue,
  StructuredHierarchyQuery,
  StructuredContentQuery,
} from "./conditions";

export {
  isSearchCondition,
  isCompoundCondition,
  isHierarchyCondition,
  isAttributeCondition,
} from "./conditions";

// Result types
export type {
  DateRange,
  Reference,
  PageResult,
  SemanticSearchResult,
  PageContentResult,
  BlockResult,
  BlockNode,
  HierarchyContent,
  CombinedResult,
  DatomicQueryResult,
  ToolExecutionResult,
  ReActState,
} from "./results";

// Legacy types from original types.ts (for backward compatibility)
// These will be gradually migrated to the new structure

// Base tool interface
export interface SearchTool {
  name: string;
  description: string;
  securityLevel: "secure" | "content";
  execute(params: any): Promise<any>;
}

// Legacy content condition (to be replaced by SearchCondition)
export interface ContentCondition {
  text: string;
  matchType?: "exact" | "contains" | "regex";
  semanticExpansion?: "fuzzy" | "synonyms" | "related_concepts" | "broader_terms" | "custom" | "all";
  weight?: number;
  negate?: boolean;
}

// Legacy hierarchy condition (to be replaced by HierarchyCondition)
export interface LegacyHierarchyCondition {
  direction: "descendants" | "ancestors";
  levels: number | "all";
  conditions: ContentCondition[];
}