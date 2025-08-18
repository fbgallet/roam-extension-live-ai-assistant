/**
 * Search condition types for structured queries across all search tools
 * These types provide a unified, type-safe approach to building complex search conditions
 */

/**
 * Base search condition with semantic expansion support
 * Used across all search tools for consistent condition handling
 */
export interface SearchCondition {
  type: "text" | "page_ref" | "block_ref" | "regex";
  text: string;
  matchType?: "exact" | "contains" | "regex";
  semanticExpansion?: "fuzzy" | "synonyms" | "related_concepts" | "broader_terms" | "custom" | "all";
  weight?: number;
  negate?: boolean;
}

/**
 * Compound condition for nested AND/OR logic
 * Enables complex query structures like "(A + B) | (C + D)"
 * Available for use across all search tools
 */
export interface CompoundCondition {
  operator: "AND" | "OR";
  conditions: (SearchCondition | CompoundCondition)[];
}

/**
 * Hierarchy condition for structured hierarchy operations
 * Supports all hierarchy operators with nested condition support
 */
export interface HierarchyCondition {
  operator: ">" | "<" | ">>" | "<<" | "=>" | "<=" | "=>>" | "<<=" | "<=>" | "<<=>>";
  leftCondition: SearchCondition | CompoundCondition;
  rightCondition: SearchCondition | CompoundCondition;
  maxDepth?: number;
}

/**
 * Attribute condition for attr:key:type:value searches
 * Used in page content searches with semantic expansion support
 */
export interface AttributeCondition {
  attributeKey: string;
  valueType: "text" | "page_ref" | "regex";
  values: AttributeValue[];
}

export interface AttributeValue {
  value: string;
  operator: "+" | "|" | "-"; // AND, OR, NOT
}

/**
 * Root level query structures for different search types
 */

// For hierarchy searches
export interface StructuredHierarchyQuery {
  hierarchyCondition?: HierarchyCondition;
  searchConditions?: SearchCondition[];
  combineConditions?: "AND" | "OR";
}

// For content searches with attribute support
export interface StructuredContentQuery {
  conditions: SearchCondition[];
  attributeConditions?: AttributeCondition[];
  combineConditions?: "AND" | "OR";
}

/**
 * Type guards for runtime type checking
 */
export function isSearchCondition(condition: any): condition is SearchCondition {
  return condition && typeof condition.type === "string" && typeof condition.text === "string";
}

export function isCompoundCondition(condition: any): condition is CompoundCondition {
  return condition && typeof condition.operator === "string" && Array.isArray(condition.conditions);
}

export function isHierarchyCondition(condition: any): condition is HierarchyCondition {
  return condition && typeof condition.operator === "string" && condition.leftCondition && condition.rightCondition;
}

export function isAttributeCondition(condition: any): condition is AttributeCondition {
  return condition && typeof condition.attributeKey === "string" && condition.valueType && Array.isArray(condition.values);
}