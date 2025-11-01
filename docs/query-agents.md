# Query Agents in Live AI Assistant

Live AI provides four powerful agents that make Roam's advanced features accessible to all users by interpreting queries in natural language (eventually with a few simple symbols) into properly formatted queries.

Ideally, users simply need to write their request in natural language. The agents will identify the relevant elements and query logic. The user will only need to learn to recognize which agent will best respond to their expectations in different situations. But in practice, it is also useful to know a bit more about the main features offered in order to write simpler queries that provide more reliable results.

## Table of Contents

- [Natural Language Query Agent](#natural-language-query-agent)
- [Natural Language :q Datomic Agent](#natural-language-q-datomic-agent)
- [Ask Your Graph Agent](#ask-your-graph-agent)

---

## Natural Language Query Agent

This agent generates native Roam queries of the type `{{[[query]]: {and: [[ex-A]] [[ex-B]]}}}`, which allow combining searches on page titles, text, time periods, and create/edit user. Roam queries capture results that meet conditions across their entire path (including parents and children), not just within the same block.

### Key Features

- To differentiate between search on page title and simple text search, use the standard syntax to mention a [[page title]] and write simple text directly without quotes. E.g.: 'Which [[meeting]] with [[John]], about frontend or UX, is not [[DONE]]?'
- In natural language, clearly express logical articulations (and, or, not...) or use the following symbols:
  - space or `&` or `+` as and,
  - `|` as or,
  - `-`as not.
    For example: [[meeting]] & [[John]] & frontend|UX -[[DONE]]
- Text search will work better if you target multiple words separately rather than a whole expression (Smart Search is more suitable for searching expressions).
- **Fuzzy search**: to search for different grammatical variants of a word, request a fuzzy search or add the `*` symbol at the end of the word. E.g. 'practice\*' will search also for 'practise', 'practising'
- **Semantic search**: to expand the search to synonymous or related terms, add the `~` symbol, or a double `~~` for a broader semantic search. E.g.: 'practice~' can search also for 'workout', 'exercise', 'drill'...
- To delimit a time period, you can express any relative period in natural language (e.g., "last month") or with specific dates.

### Model Recommendations

Currently, the most reliable results are obtained with OpenAI `gpt-4o` and Groq `llama-3.3-70b-versatile` (Anthropic seems less reliable here)

---

## Natural Language :q Datomic Agent

This agent generates Datalog Datomic queries in the :q format whose results are displayed in a sortable table. They allow for expressing a more complex and specific logic related to Roam's database structure, as you can target database attributes concerning different properties of blocks and pages and their hierarchical relationships.

### Limitations & Best Practices

However, this makes their format much more complex, and generative AIs will have more difficulty producing satisfactory results, especially as the required logic becomes more complex. In case of failure, it is recommended to retry once or twice. Otherwise, you should simplify the query or make its logic more explicit.

Another problem with their complexity is that users who have not learned Datalog query logic will not be able to correct or improve the results of generative AIs, unlike what can be easily done with Roam queries.

To make your requests as clear and effective as possible, use as keywords the concepts that designate the main components of Roam: block, page, title, content, parent, child, attribute, etc.

### Example

**Natural language request**: Blocks starting with 'Once upon a time' in pages with 'story' in title

**Result**:

```
:q "Blocks starting with 'Once upon a time' in pages with 'story' in title"
[:find ?block-uid ?page-title
 :where
 [?page :node/title ?page-title]
 [(clojure.string/includes? ?page-title "story")]
 [?block :block/page ?page]
 [?block :block/string ?block-string]
 [(clojure.string/starts-with? ?block-string "Once upon a time")]
 [?block :block/uid ?block-uid]]
```

---

## Ask Your Graph Agent

Ask Your Graph agent is a sophisticated ReAct (Reasoning + Acting) agent that intelligently searches your Roam graph using natural language queries. It combines the power of LLMs with specialized search tools to find blocks and pages matching complex criteria.

### Overview

The agent works by:

1. **Parsing** your natural language request into a symbolic query language
2. **Planning** the optimal search strategy (direct, hierarchical, or multi-step)
3. **Executing** specialized search tools to find matching results
4. **Formatting** results with adaptive context expansion based on your access mode

### Access Modes

The agent operates in three access modes that control content visibility:

#### 🔒 Private Mode (Secure)

- **Content Access**: UIDs and titles only - NO content processing
- **Speed**: Fastest responses
- **Use Case**: When you only need to find blocks/pages by metadata (titles, references, dates)
- **Privacy**: Maximum - LLM never sees your actual note content
- **Tools**: All secure-level tools available

#### 🛡️ Balanced Mode (Default)

- **Content Access**: Limited content processing (50% of context window)
- **Speed**: Fast responses with content understanding
- **Context Depth**: Adaptive (0-4 levels for blocks, 4 levels for pages)
- **Use Case**: Most common searches requiring content analysis
- **Tools**: All secure-level tools + selected content tools

#### 🔓 Full Access Mode

- **Content Access**: Full content processing (75% of context window)
- **Speed**: Slower due to larger context
- **Context Depth**: Deep adaptive (0-99 levels for blocks, unlimited for pages)
- **Use Case**: Complex research, deep analysis, comprehensive understanding
- **Tools**: All secure and content-level tools

### Natural Language Query Syntax

The agent understands natural language with optional symbolic shortcuts:

#### Basic Syntax

```
# Simple search
"blocks about machine learning"

# With page references
"[[meeting]] notes with [[John]]"

# Logical operators (natural or symbolic)
"productivity AND tools" or "productivity + tools"
"project OR task" or "project | task"
"meeting NOT cancelled" or "meeting - cancelled"

# Time ranges
"blocks from last week"
"notes created since January"
"pages modified in the last month"
```

#### Advanced Operators

**Fuzzy Search** (`*` suffix):

```
"practice*"  # Finds: practice, practise, practicing, practiced
"analy*"     # Finds: analyze, analyse, analysis, analytical
```

**Semantic Search** (`~` suffix):

```
"practice~"   # Finds: workout, exercise, drill, training
"happy~"      # Finds: joyful, cheerful, pleased, content
"meeting~~"   # Broader: conference, discussion, gathering, session
```

**Hierarchical Search**:

```
# Direct parent/child
"[[TODO]] under [[Project Planning]]"  # > operator
"task below project"                    # > operator

# Deep hierarchy
"notes deep under [[Research]]"         # >> operator
"content anywhere in project tree"      # >> operator

# Flexible hierarchy (same block OR descendants)
"[[TODO]] with [[urgent]]"              # => operator
```

#### Date Expressions

The agent understands natural date expressions:

```
# Relative periods
"since yesterday"
"last week"
"past 3 months"
"this year"

# Specific dates
"after January 15"
"between March 1 and March 31"
"before 2024-01-01"

# Creation vs modification
"blocks created last month"     # Created date
"blocks modified since Monday"  # Modified date (default)
"pages edited today"            # Modified date
```

#### Result Limits & Sampling

```
# Limit results
"5 random blocks about AI"
"first 10 pages tagged project"
"3 meeting notes"

# Random sampling
"random block from my journal"
"2 random pages about books"
```

### Available Search Tools

The agent has access to 10 specialized tools organized by security level:

#### Secure-Level Tools (Always Available)

**1. findPagesByTitle**

- **Purpose**: Find pages matching title patterns
- **Supports**: Exact match, contains, regex patterns
- **Smart Expansion**: Finds similar page titles + semantic variations with existence validation
- **Use when**: "pages about X", "X pages", "find pages with X in title"

**2. findDailyNotesByPeriod**

- **Purpose**: Find Daily Notes Pages within time periods
- **Features**: Efficient batch queries, creation/modification filtering
- **Options**: Include page content, linked references
- **Use when**: "Daily notes since n days", "this week's DNPs"

**3. findBlocksByContent**

- **Purpose**: Find blocks by content conditions
- **Features**: Semantic expansion, hierarchy support, fuzzy matching
- **Use when**: Simple content searches without complex hierarchy

**4. findBlocksWithHierarchy**

- **Purpose**: Find blocks with hierarchical context
- **Features**: Content + structural conditions, parent/child relationships
- **Flexibility**: Secure mode parameter available
- **Use when**: "blocks under X", "TODO with parent Y", hierarchical searches

**5. findPagesByContent**

- **Purpose**: Find pages by analyzing block content
- **Features**: Aggregation, filtering, secure mode option
- **Use when**: "pages containing X", "pages discussing Y and Z"

**6. combineResults**

- **Purpose**: Combine and deduplicate results from multiple searches
- **Operations**: Union (OR), Intersection (AND), Difference (NOT)
- **Essential for**: Complex OR queries - run separate searches then combine
- **Use when**: Multi-step queries requiring set operations

**7. executeDatomicQuery**

- **Purpose**: Execute custom Datalog queries
- **Features**: User-provided queries, auto-generation, parameterized queries
- **Use when**: Complex database queries beyond standard tools

**8. extractPageReferences**

- **Purpose**: Extract and count page references
- **Features**: Fast database queries, analytical tasks
- **Use when**: "which pages are referenced most", "reference counts"

#### Content-Level Tools (Require Permission)

**9. extractHierarchyContent**

- **Purpose**: Extract and format hierarchical content
- **Output Formats**: Multiple formatting options
- **Requires**: Balanced or Full Access mode
- **Use when**: Need to see full block hierarchy with content

**10. getNodeDetails**

- **Purpose**: Fetch detailed information about specific blocks/pages
- **Features**: Full content access, metadata
- **Requires**: Balanced or Full Access mode
- **Use when**: Need deep context about specific nodes

### Query Complexity & Strategy

The agent automatically detects query complexity and chooses the optimal strategy:

#### Simple Queries

- **Pattern**: Single condition, no logic
- **Example**: "blocks about AI"
- **Strategy**: Direct search with one tool
- **Tools Used**: 1

#### Logical Queries

- **Pattern**: Multiple conditions with AND/OR/NOT
- **Example**: "meetings with John about frontend - cancelled"
- **Strategy**: Hierarchical search if 3+ AND conditions, otherwise direct
- **Tools Used**: 1-2

#### Multi-Step Queries

- **Pattern**: UNION, INTERSECTION, DIFFERENCE, PIPE operations
- **Example**: "pages about AI OR machine learning, then filter for recent"
- **Strategy**: Sequential tool execution with result combination
- **Tools Used**: 2-5

### Symbolic Query Language (Advanced)

For power users, the agent also accepts queries in a symbolic language for precise control:

```
# Basic conditions
text:term           # Text content search
ref:title           # Page reference
regex:/pattern/i    # Regex matching
bref:uid            # Block reference

# Logic operators
+                   # AND
|                   # OR
-                   # NOT

# Hierarchical operators
>                   # Direct child
>>                  # Deep descendants
<                   # Direct parent
<<                  # Deep ancestors
=>                  # Flexible (same or descendants)
<=>                 # Bidirectional

# Grouping
(...)               # Group conditions
text:(A + B)        # Group same-type conditions

# Examples
text:AI + ref:research - text:draft
(text:meeting | text:call) >> ref:project
page:(title:(text:status))
page:(content:(text:AI + text:ethics))
```

### Context Expansion

Results are automatically expanded with adaptive depth based on:

#### For Blocks

- **Original content**: Always fully preserved
- **Parent context**: 100-500 characters (20% of budget)
- **Children hierarchy**: Recursive with degressive limits
  - Level 1: 100-500 chars per child
  - Level 2: 70 chars per child (70% reduction)
  - Level 3+: Continue 70% reduction per level

**Depth Limits** (based on result count):

**Balanced Mode**:

- 1-10 results: max 4 levels
- 11-25 results: max 3 levels
- 26-50 results: max 2 levels
- 51-200 results: max 1 level
- 200+ results: no expansion

**Full Access Mode**:

- 1-10 results: unlimited (99 levels)
- 11-20 results: max 5 levels
- 21-100 results: max 4 levels
- 101-200 results: max 3 levels
- 201-300 results: max 2 levels
- 301-500 results: max 1 level
- 500+ results: no expansion

#### For Pages

- **Page title**: Always included
- **Children content**: Expanded based on access mode
  - **Balanced**: 4 levels max
  - **Full Access**: Unlimited (999 levels practical limit)
- **No parent context**: Pages are root-level entities

### Intelligent Features

#### Reference Resolution

- All block references `((uid))` automatically resolved to content
- Page references `[[title]]` display page names
- Prevents infinite recursion while maintaining clarity

#### Result Lifecycle Management

- Results tagged as "final", "intermediate", "replacement", or "completion"
- Automatic deduplication by UID
- Smart superseding: new results replace outdated ones
- Maintains result history for conversation context

#### Token Optimization

- Metadata sent to LLM (summaries, counts, samples)
- Full results stored separately for tool access
- Reduces context usage by ~70% for large result sets
- Enables handling thousands of results efficiently

#### Progressive Expansion

- Zero results → automatic semantic expansion
- Low results → suggests expansion strategies
- User consent required for expensive expansions
- Max 5 automatic retry attempts (safety limit)

#### Conversation Mode

- Maintains chat history across turns
- Summarizes long conversations (> 8 exchanges)
- Caches results for follow-up questions
- Smart routing: detects when to use cache vs new search

### Usage Examples

#### Basic Searches

```
# Simple content search
"blocks about productivity"

# Page references
"notes in [[Project Alpha]]"

# With tags
"tasks tagged #urgent"

# Date filtering
"notes from last week"
```

#### Logical Combinations

```
# AND
"meetings with John about frontend"
"[[TODO]] and [[urgent]] and [[project]]"

# OR
"blocks about AI or machine learning"
"meeting | call | discussion"

# NOT
"project notes - archived"
"meetings with John - cancelled"

# Combined
"(meeting | call) with John about (frontend | backend) - cancelled"
```

#### Hierarchical Searches

```
# Direct children
"TODO under Project Planning"
"tasks below [[Sprint 1]]"

# Deep descendants
"notes anywhere under Research"
"content deep in [[Archive]]"

# Bidirectional
"[[TODO]] connected to [[urgent]]"
```

#### Advanced Searches

```
# Fuzzy + semantic
"analy* about practice~"  # analyze/analysis + workout/exercise

# Attribute search
"pages of type book"
"blocks with status completed"

# Daily notes
"daily notes from last month"
"this week's DNPs mentioning project"

# Random sampling
"5 random blocks about inspiration"
"3 random pages tagged idea"
```

#### Analytical Queries

```
# Counting
"how many meetings with John"
"count of blocks tagged TODO"

# Connections
"which pages reference [[AI]]"
"what connects [[Research]] and [[Project]]"

# Patterns
"most referenced pages in my notes"
"common themes in my journal"
```

### Best Practices

#### For Better Results

1. **Be specific with page references**: Use `[[Page Title]]` syntax
2. **Separate concerns**: "meetings with John" vs "John in meetings"
3. **Use semantic search for essays**: "write about X~" finds comprehensive content
4. **Combine operators thoughtfully**: Too many conditions = complex hierarchy search
5. **Test incrementally**: Start simple, add complexity gradually

#### For Performance

1. **Use Private mode** when possible (fastest)
2. **Limit results** for large searches: "first 10 pages about X"
3. **Use direct conditions** instead of analysis: "blocks about AI" vs "analyze my AI notes"
4. **Enable Full Access** only when needed
5. **Start new conversations** for different topics

#### For Accuracy

1. **Disambiguate terms**: "practice\*" for variants, "practice~" for synonyms
2. **Use quotes for phrases**: "machine learning" stays together
3. **Specify time filter mode**: "created" vs "modified" (default)
4. **Test date expressions**: "since last month" vs "during last month"
5. **Retry with expansion**: Agent suggests strategies when results are low

### Common Patterns

#### Finding Tasks

```
"[[TODO]] tasks not [[DONE]]"
"urgent tasks under [[Project]]"
"tasks created this week"
"overdue tasks with [[high priority]]"
```

#### Meeting Notes

```
"[[meeting]] with [[John]] - [[cancelled]]"
"meetings about (frontend | backend)"
"meeting notes from last month"
"calls deep under [[Client Work]]"
```

#### Research & Learning

```
"notes about AI~ and ethics~"
"pages discussing [[Philosophy]]"
"highlights from [[Book:*]]"
"daily notes mentioning learning"
```

#### Project Management

```
"[[Project Alpha]] status pages"
"blocks under projects tagged #urgent"
"project notes modified this week"
"pages of type project with status active"
```

### Troubleshooting

**No Results Found?**

- Try semantic expansion: add `~` to key terms
- Check page reference syntax: `[[Page]]` not `Page`
- Verify date ranges: "since" vs "during"
- Simplify logic: break complex queries into steps

**Too Many Results?**

- Add more specific conditions: use `+` for AND
- Limit output: "first 10" or "5 random"
- Use hierarchical search: "under [[Specific Page]]"
- Add NOT conditions: `- excluded_term`

**Wrong Results?**

- Check operator precedence: use `(...)` for grouping
- Specify search type: "pages about X" vs "blocks about X"
- Disambiguate terms: "meeting" might match "meet", use exact match
- Use regex for precision: `/^exact match$/i`

**Slow Responses?**

- Switch to Private or Balanced mode
- Limit result count
- Avoid deep hierarchy searches when possible
- Use direct queries instead of analytical ones

### Privacy & Security

**Data Protection**:

- Private mode: LLM never sees content, only UIDs/titles
- Balanced mode: Limited content sampling
- Full mode: Comprehensive but with user consent

**Tool Security Levels**:

- Secure tools: Always safe, no content exposure in Private mode
- Content tools: Require Balanced/Full Access

**Conversation Privacy**:

- No data sent to external servers beyond LLM provider
- Results cached locally in session only
- Chat history optional, user-controlled

### Advanced Topics

#### Multi-Query Combinations

For complex searches that can be decomposed:

```
# UNION (OR at query level)
UNION(ref:finance, page:(attr:status:ref:pending))

# INTERSECTION (AND at query level)
INTERSECTION(ref:AI, page:(content:(ref:research)))

# PIPE (sequential narrowing)
PIPE(page:(dnp), ref:project + text:task)

# DIFFERENCE (exclusion at query level)
DIFFERENCE(ref:project, text:archived)
```

#### Custom Datomic Queries

For ultra-precise database queries:

```
# Agent can generate or execute Datomic queries
"Execute Datomic query to find..."
"Generate :q query for blocks with..."
```

#### Page vs Block Scope

```
# Page-wide search (conditions across different blocks)
page:(content:(text:AI + text:ethics))

# Same-block search (conditions in same blocks)
page:(block:(text:AI + text:ethics))
```

---

## Comparison Matrix

| Feature            | Query Agent | Datomic Agent | Ask Your Graph |
| ------------------ | ----------- | ------------- | -------------- |
| **Ease of Use**    | ⭐⭐⭐⭐⭐  | ⭐⭐          | ⭐⭐⭐⭐       |
| **Power**          | ⭐⭐⭐      | ⭐⭐⭐⭐⭐    | ⭐⭐⭐⭐⭐     |
| **Flexibility**    | ⭐⭐⭐      | ⭐⭐⭐⭐⭐    | ⭐⭐⭐⭐       |
| **Speed**          | ⭐⭐⭐⭐    | ⭐⭐⭐        | ⭐⭐           |
| **Accuracy**       | ⭐⭐⭐⭐    | ⭐⭐⭐        | ⭐⭐⭐⭐⭐     |
| **Context**        | Limited     | Limited       | Adaptive       |
| **Learning Curve** | Low         | High          | Medium         |

### When to Use Which Agent

- **Query Agent**: Simple searches with page/text/time filters
- **Datomic Agent**: Complex database queries, precise attribute searches, learning Datalog Datomic syntax and Roam specific attributes and variables...
- **Ask Your Graph**: Most use cases - intelligent, adaptive, conversational

---

## Additional Resources

- **Getting Started**: [Main README](https://github.com/fbgallet/roam-extension-live-ai-assistant#1-getting-started)
- **Chat Agent**: [Chat documentation](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/chat-agent.md)
- **Custom Prompts**: [Prompt creation guide](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#3-custom-prompts)
- **API Keys & Pricing**: [Setup and costs](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md)

---

_Made with joy and perseverance by [Fabrice Gallet](https://github.com/sponsors/fbgallet)_
