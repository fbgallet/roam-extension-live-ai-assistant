# Advanced Query Support Documentation

This document describes the current state of advanced query support across search tools, including supported patterns and limitations.

## Tool Coverage

### findBlocksWithHierarchy ✅ Full Support
- **Grouped conditions**: Complex logic like `((A|B) AND NOT C) > D`
- **All hierarchy operators**: `>`, `>>`, `<=>`, `=>>`, etc.
- **OR-to-regex conversion**: Mixed logic optimization
- **Full semantic expansion**: Applied to structured conditions

### findBlocksByContent ✅ Full Support  
- **Grouped conditions**: Complex content search logic
- **All condition types**: text, page_ref, block_ref, regex
- **OR-to-regex conversion**: Performance optimization
- **Semantic expansion**: Compatible with grouped conditions

### findPagesByContent ✅ Full Support
- **Grouped conditions**: Complex page discovery logic
- **Content analysis**: Find pages containing matching blocks
- **OR-to-regex conversion**: Performance optimization  
- **Semantic expansion**: Compatible with grouped conditions
- **Aggregation features**: Block counting, content stats, samples

### findPagesByTitle ❌ Not Supported
- **Simple conditions only**: Basic AND/OR logic sufficient
- **Reason**: Page title search works differently, complex queries not needed

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
- **OR logic with negation**: `(A | B | NOT C)` patterns only
- **NOT for pure AND logic**: `A + B + NOT C` keeps separate AND clauses
- **After semantic expansion**: Ensures all expansions are included

### When NOT Applied
- **Pure AND logic**: `ref:ML + ref:AI - text:old` → separate AND clauses
- **Pure OR logic without negation**: `(A | B)` → standard OR clauses
- **Mixed AND with negation**: Keeps individual conditions separate

### Conversion Examples

#### ✅ OR Logic with Negation (Converted)
- `(text:AI | text:ML | NOT text:old)` → `(?i)(.*AI.*|.*ML.*) AND NOT text:old`
- `(ref:AI | ref:ML | NOT ref:deprecated)` → `(?i)(.*(\[\[AI\]\]|#AI|AI::).*|.*(\[\[ML\]\]|#ML|ML::).*) AND NOT ref:deprecated`

#### ❌ AND Logic with Negation (NOT Converted - Kept Separate)
- `ref:ML + ref:AI - text:old` → **Separate clauses**: `ref:ML AND ref:AI AND NOT text:old`
- `text:neural + text:network - regex:/\bold\b/` → **Separate clauses**: `text:neural AND text:network AND NOT regex`

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

### ✅ Simple Logic (Tier 1) - All Three Tools
```
// findBlocksWithHierarchy
ref:ML > text:AI                           // Simple parent-child
(text:deep | text:neural) > ref:Learning   // Pure OR in child
ref:ML > (text:AI + text:concepts)         // Pure AND in child

// findBlocksByContent  
text:AI AND ref:ML                         // Simple AND logic
text:neural OR text:deep                   // Simple OR logic
text:AI AND NOT text:outdated              // Simple negation

// findPagesByContent
text:concepts AND ref:AI                   // Find pages with both
text:tutorial OR text:guide                // Find pages with either
text:machine learning AND NOT text:old     // Find current ML pages
```

### ✅ Mixed AND-Dominant Logic (Tier 2) - All Three Tools
```
// findBlocksWithHierarchy
((ref:ML | text:AI) + NOT text:outdated) > text:fundamentals
ref:ML > ((text:neural | text:deep) + NOT text:deprecated)  
(text:concepts + (ref:AI | ref:ML)) > text:examples

// findBlocksByContent
(text:AI | ref:ML) AND NOT text:deprecated  // Mixed types with negation
(text:neural | text:deep) AND text:concept  // OR group with AND

// findPagesByContent  
(text:tutorial | text:guide) AND NOT text:outdated  // Current tutorials/guides
(ref:AI | ref:ML) AND text:advanced                 // Advanced AI/ML pages
```

### ✅ Grouped Conditions (Full Implementation) - All Three Tools
```
// findBlocksWithHierarchy - Hierarchy relationships
((ref:ML | text:HERE) AND NOT text:exclude) > text:AI     // Complex left side
ref:ML > ((text:concepts | text:ideas) AND NOT text:old)  // Complex right side  
((A | B) AND C) > ((D | E) AND NOT F)                    // Both sides grouped

// findBlocksByContent - Content search
((ref:AI | text:neural) AND NOT text:outdated)          // Complex content logic
((text:concept | text:idea) AND text:important)         // Multi-group content search

// findPagesByContent - Page discovery
((text:tutorial | text:guide) AND NOT text:draft)       // Published tutorials/guides  
((ref:AI | ref:ML) AND text:beginner)                   // Beginner AI/ML pages
```

### ✅ Negation Support - All Three Tools
```
// findBlocksWithHierarchy
ref:ML > (text:AI + NOT text:outdated)     // AND with negation
NOT ref:ML > text:AI                       // Negated parent
ref:ML > NOT text:deprecated               // Negated child  

// findBlocksByContent
NOT text:deprecated                        // Simple negation
(text:AI OR text:ML) AND NOT text:old     // OR group with negation

// findPagesByContent
NOT text:archive                           // Exclude archived pages
(text:project | text:task) AND NOT text:completed  // Active projects/tasks
```

### ✅ All Hierarchy Operators - findBlocksWithHierarchy Only
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

### findBlocksWithHierarchy Examples

#### Simple Hierarchy (Backward Compatible)
```typescript
{
  operator: ">",
  leftConditions: [{ type: "page_ref", text: "Machine Learning" }],
  rightConditions: [{ type: "text", text: "neural networks" }],
  leftCombination: "AND",
  rightCombination: "AND"
}
```

#### Grouped Conditions (Complex Logic)
For queries like `((Machine Learning | HERE) AND NOT exclude) > AI Fundamentals`:

```typescript  
{
  operator: ">",
  leftConditionGroups: [
    {
      conditions: [
        { type: "page_ref", text: "Machine Learning", negate: false },
        { type: "text", text: "HERE", negate: false }
      ],
      combination: "OR"
    },
    {
      conditions: [
        { type: "text", text: "exclude", negate: true }
      ],
      combination: "AND"
    }
  ],
  leftGroupCombination: "AND",  // (Group1) AND (Group2)
  rightConditions: [{ type: "text", text: "AI Fundamentals" }],
  rightCombination: "AND"
}
```

### findBlocksByContent Examples

#### Simple Conditions (Backward Compatible)
```typescript
{
  conditions: [
    { type: "text", text: "machine learning", negate: false },
    { type: "page_ref", text: "AI", negate: false },
    { type: "text", text: "deprecated", negate: true }
  ],
  combineConditions: "AND"
}
```

#### Grouped Conditions (Complex Content Logic)
For queries like `((AI | neural networks) AND NOT outdated)`:

```typescript
{
  conditionGroups: [
    {
      conditions: [
        { type: "page_ref", text: "AI", negate: false },
        { type: "text", text: "neural networks", negate: false }
      ],
      combination: "OR"
    },
    {
      conditions: [
        { type: "text", text: "outdated", negate: true }
      ],
      combination: "AND"
    }
  ],
  groupCombination: "AND"
}
```

### findPagesByContent Examples

#### Simple Conditions (Backward Compatible)
```typescript
{
  conditions: [
    { type: "text", text: "tutorial", negate: false },
    { type: "page_ref", text: "Programming", negate: false },
    { type: "text", text: "draft", negate: true }
  ],
  combineConditions: "AND",
  minBlockCount: 3  // Pages with at least 3 matching blocks
}
```

#### Grouped Conditions (Complex Page Discovery)
For queries like `((tutorial | guide) AND NOT draft)` to find published instructional pages:

```typescript
{
  conditionGroups: [
    {
      conditions: [
        { type: "text", text: "tutorial", negate: false },
        { type: "text", text: "guide", negate: false }
      ],
      combination: "OR"
    },
    {
      conditions: [
        { type: "text", text: "draft", negate: true }
      ],
      combination: "AND"
    }
  ],
  groupCombination: "AND",
  minBlockCount: 2,
  includeBlockSamples: true
}
```

### Choosing the Right Format

#### Use Simple Conditions When:
- Basic AND/OR logic: `A AND B`, `A OR B` 
- Single negation: `A AND NOT B`
- Straightforward queries with < 4 conditions

#### Use Grouped Conditions When:
- Mixed logic: `(A | B) AND NOT C`
- Multiple OR groups: `(A | B) AND (C | D)`
- Complex negation patterns: `((A | B) AND NOT C) AND NOT D`
- Need explicit logical grouping for clarity

This documentation will be updated as Tier 3 support is implemented.