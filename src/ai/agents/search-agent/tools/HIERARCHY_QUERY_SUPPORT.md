# Hierarchy Query Support Documentation

This document describes the current state of hierarchy query support in the `findBlocksWithHierarchy` tool, including supported patterns and limitations.

## Architecture Overview

The hierarchy query system uses a **three-tier architecture** to handle queries of varying complexity:

### **Tier 1: Simple Conditions** ✅ 
- **Single Datomic query generation**
- **Pure logic**: Either pure AND or pure OR (no mixing)
- **Examples**:
  - `ref:ML > text:AI` (pure AND)
  - `(text:deep | text:neural) > ref:Learning` (pure OR)
  - `ref:ML > (text:AI + text:fundamentals)` (pure AND)

### **Tier 2: Mixed Logic (AND-dominant)** ✅ 
- **Smart OR-to-regex conversion**
- **AND-dominant with OR sub-groups**
- **Applied after semantic expansion**
- **Examples**:
  - `((ref:ML | text:AI) AND NOT text:outdated) > text:fundamentals`
  - `(text:deep + (ref:Learning | ref:AI)) > text:concepts`
  - `ref:ML > ((text:neural | text:deep) + NOT text:deprecated)`

### **Tier 3: Complex Logic (OR-dominant)** ⚠️ Not Yet Implemented
- **Multi-step decomposition approach**
- **OR-dominant with AND sub-groups** 
- **Examples**:
  - `((text:A + text:B) | text:C) > text:D` 
  - `text:A > ((text:B + text:C) | text:D)`

## Supported Hierarchy Operators

All operators support both Tiers 1 and 2:

| Operator | Description | Example |
|----------|-------------|---------|
| `>` | Strict parent-child | `ref:ML > text:AI` |
| `>>` | Deep ancestor-descendant | `ref:ML >> text:concepts` |
| `<` | Strict child-parent | `text:AI < ref:ML` |
| `<<` | Deep descendant-ancestor | `text:concepts << ref:ML` |
| `=>` | Flexible hierarchy (1 level) | `ref:ML => text:AI` |
| `=>>` | Deep flexible hierarchy | `ref:ML =>> text:concepts` |
| `<=` | Flexible inverse (1 level) | `text:AI <= ref:ML` |
| `<<=` | Deep flexible inverse | `text:concepts <<= ref:ML` |
| `<=>` | Bidirectional (1 level) | `ref:ML <=> text:AI` |
| `<<=>>` | Deep bidirectional | `ref:ML <<=>> text:concepts` |

## Condition Types

### Text Conditions
```typescript
{
  type: "text",
  text: "machine learning",
  matchType: "contains" | "exact" | "regex",
  negate: false | true
}
```

### Page Reference Conditions
```typescript
{
  type: "page_ref", 
  text: "Machine Learning",
  matchType: "contains" | "exact",
  negate: false | true
}
```

### Block Reference Conditions
```typescript
{
  type: "block_ref",
  text: "block-uid-here", 
  matchType: "exact",
  negate: false | true
}
```

## Tier 2: OR-to-Regex Conversion

### When Applied
- **Mixed logic detected**: AND-dominant logic with OR sub-groups
- **OR with negation**: `(A | B | NOT C)` patterns
- **After semantic expansion**: Ensures all expansions are included

### Conversion Examples

#### Text Conditions
- `(text:AI | text:ML)` → `(?i)(.*AI.*|.*ML.*)`

#### Page References  
- `(ref:AI | ref:ML)` → `(?i)(.*(\[\[AI\]\]|#AI|AI::).*|.*(\[\[ML\]\]|#ML|ML::).*)`

#### Mixed Types
- `(text:deep | ref:Learning)` → `(?i)(.*deep.*|.*(\[\[Learning\]\]|#Learning|Learning::).*)`

#### With Existing Regex
- `(text:neural | /^Important:/)` → `(?i)(.*neural.*|^Important:)`

### Benefits
- ✅ **Avoids Datomic OR complexity**: No variable scope issues
- ✅ **Supports logical grouping**: `((A | B) AND NOT C)` patterns  
- ✅ **More efficient**: Single regex vs multiple OR branches
- ✅ **Handles page reference syntax**: `[[page]]`, `#page`, `page::`

## Currently Supported Patterns

### ✅ Simple Logic (Tier 1)
```
ref:ML > text:AI                           // Simple parent-child
(text:deep | text:neural) > ref:Learning   // Pure OR in child
ref:ML > (text:AI + text:concepts)         // Pure AND in child
```

### ✅ Mixed AND-Dominant Logic (Tier 2)  
```
((ref:ML | text:AI) + NOT text:outdated) > text:fundamentals
ref:ML > ((text:neural | text:deep) + NOT text:deprecated)  
(text:concepts + (ref:AI | ref:ML)) > text:examples
```

### ✅ Negation Support
```
ref:ML > (text:AI + NOT text:outdated)     // AND with negation
NOT ref:ML > text:AI                       // Negated parent
ref:ML > NOT text:deprecated               // Negated child  
```

### ✅ All Hierarchy Operators
```
ref:ML >> text:concepts                    // Deep search
ref:ML <=> text:AI                        // Bidirectional
ref:ML =>> (text:neural | text:deep)      // Deep flexible with OR
```

## Not Yet Supported (Tier 3)

### ❌ OR-Dominant Mixed Logic
```
((text:A + text:B) | text:C) > text:D      // OR of AND groups
text:A > ((text:B + text:C) | text:D)      // OR with AND sub-groups  
(ref:ML | (text:AI + NOT text:old)) > text:new  // Complex nesting
```

### ❌ Complex Nested Conditions
```
(((A | B) + C) | (D + (E | F))) > G        // Deep nesting
A > (B | (C + (D | E)))                    // Recursive structures
```

## Error Handling

### Graceful Fallbacks
- **Unsupported operators**: Warning logged, returns empty results
- **Invalid conditions**: Skipped with warning  
- **Regex errors**: Falls back to text matching
- **Complex patterns**: Will route to multi-step approach (Tier 3, future)

### Debug Information
- **Conversion logging**: Shows when OR-to-regex is applied
- **Condition tracking**: Logs processed vs original conditions  
- **Query inspection**: Generated Datomic queries are logged

## Future Enhancements (Tier 3)

### Planned Features
- **Multi-step decomposition**: Break complex queries into separate searches
- **Set operations**: Use `combineResultsTool` for union/intersection/difference
- **Recursive processing**: Handle deeply nested logical structures
- **Performance optimization**: Intelligent query planning

### Implementation Strategy
1. **Detect OR-dominant patterns** that can't be converted to regex
2. **Decompose into sub-queries** using existing tools
3. **Apply set operations** to combine results  
4. **Constraint application** using results as filters for hierarchy search

## Usage Examples

### Simple Hierarchy
```typescript
{
  operator: ">",
  leftConditions: [{ type: "page_ref", text: "Machine Learning" }],
  rightConditions: [{ type: "text", text: "neural networks" }],
  leftCombination: "AND",
  rightCombination: "AND"
}
```

### Mixed Logic (Tier 2)
```typescript  
{
  operator: ">",
  leftConditions: [
    { type: "page_ref", text: "ML", negate: false },
    { type: "text", text: "AI", negate: false },
    { type: "text", text: "outdated", negate: true }
  ],
  leftCombination: "AND",  // Will convert first two to regex, keep negation
  rightConditions: [{ type: "text", text: "fundamentals" }],
  rightCombination: "AND"
}
```

This documentation will be updated as Tier 3 support is implemented.