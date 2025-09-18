# Search Agent Access Modes Implementation Plan

## Overview

This document outlines the complete implementation plan for enhancing "Balanced" and "Full" access modes in the search agent, making them more useful and differentiated for end users.

## Current State Analysis

### Private Mode (`privateMode: true`)

- **Purpose**: Strict privacy, no content processing
- **Tools**: All secure-level tools only (Datomic queries, UIDs only)
- **Content**: No block/page content access, UIDs only
- **Usage**: Pure reference discovery without content analysis

### Balanced Mode (`contentAccess: false, privateMode: false`)

- **Current**: 10,000 max, 500 default, content truncated to 200 chars
- **Available Tools**: All secure-level tools (no getNodeDetails, no extractHierarchyContent)
- **Philosophy**: "Find first, analyze last" - Datomic-based search with final content access only

### Full Mode (`contentAccess: true, privateMode: false`)

- **Current**: 3,000 max, 300 default (needs rebalancing)
- **Available Tools**: All tools including getNodeDetails and extractHierarchyContent
- **Philosophy**: "Smart search with content awareness" - Content-aware search with intermediate access

## Phase 1: Enhanced Balanced Mode Implementation

### 1.1 Progressive Content Limits

**Update `getEnhancedLimits` in searchUtils.ts:**

```typescript
case "balanced":
  return {
    maxResults: 10000,
    defaultLimit: 500,
    summaryLimit: 50,
    // NEW: Progressive content limits
    getContentLimit: (resultCount: number) => {
      if (resultCount < 10) return null; // Full content
      if (resultCount <= 50) return 500;
      return 250; // >50 results
    }
  };
```

**Update `extractResultDataForPrompt` in ask-your-graph-prompts.ts:**

- Apply progressive content truncation based on result count
- Full content for <10 results, 500 chars for 10-50, 250 chars for >50

### 1.2 Smart Context Expansion Strategy

**Progressive Context Expansion Rules:**

- **<10 results**: Include parent + 2 levels children (250 char limit each)
- **10-50 results**: Include immediate children only
- **>50 results**: No context expansion

**Context Expansion Triggers:**

- Short matching content (<50 chars)
- Technical content (code, APIs, functions)
- User requests context explicitly ("context", "children", "hierarchy")
- Content seems incomplete without hierarchy

**Implementation:**

- Add `shouldExpandContextInBalanced()` function
- Add `getHierarchyExpansionConfig()` function
- Create new `contextExpansion` node in graph
- Implement `expandHierarchyWithDatomic()` using existing query infrastructure

### 1.3 Enhanced Final Processing

**Update `directFormat` function:**

- Detect context expansion results
- Merge original results with hierarchical context
- Format with hierarchy indicators
- Add transparency messaging about applied limits

## Phase 2: Enhanced Full Mode Implementation

### 2.1 Rebalance Limits and Add Progressive Strategy

**Update limits in `getEnhancedLimits`:**

```typescript
case "full":
  return {
    maxResults: 10000, // Match balanced mode
    defaultLimit: 500,  // Match balanced mode
    summaryLimit: 20,   // Keep lower due to richer content
    getContentStrategy: (resultCount: number) => {
      if (resultCount < 30) return "rich_content_with_hierarchy";
      if (resultCount <= 100) return "full_content_selected";
      return "summary_with_expansion_options";
    }
  };
```

### 2.2 Implement Explorative Strategy Detection

**Exploration Triggers:**

- Analytical queries: "compare", "analyze", "relationship", "approach"
- Multi-context results: Results span different pages/topics
- Reference-rich content: Results contain many [[page references]]
- User requests deep understanding: "explain", "how", "why"

**Content Access Patterns:**

- **<30 results**: Rich content + hierarchy for each result
- **30-100 results**: Full content for pre-selected most relevant (30-50)
- **>100 results**: Smart pre-selection (30) + expansion options for user

**Implementation:**

- Add `shouldUseExplorativeStrategy()` function
- Add `getExplorationStrategy()` function
- Update system prompts with full mode guidance
- Implement exploration decision logic

### 2.3 Smart Pre-Selection for Large Results

**When results > 30:**

- Trigger `smartPreSelection` node
- Use content analysis to select most relevant
- Enrich selected results with detailed content
- Store as new final results, mark originals as superseded

**Pre-Selection Strategies:**

- `comparative_analysis`: Deep dive into multiple pages
- `reference_following`: Follow page references with getNodeDetails
- `relationship_mapping`: Use hierarchy tools for connections
- `content_deepening`: General content exploration

---

_This plan transforms the modes from similar experiences with different limits into genuinely different search strategies optimized for their respective use cases._
