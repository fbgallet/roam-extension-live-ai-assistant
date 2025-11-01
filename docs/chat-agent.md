# Chat Agent - Comprehensive Documentation

The Chat Agent is a powerful conversational interface that combines the simplicity of a chat interface with the intelligence of an AI agent capable of querying your Roam Research graph and providing deep insights into your notes.

## Table of Contents

- [Overview](#overview)
- [Simple Chat Mode](#simple-chat-mode)
- [Agent Chat Mode](#agent-chat-mode)
- [Context Management](#context-management)
- [Available Tools](#available-tools)
- [Chat Persistence](#chat-persistence)
- [Built-in Features](#built-in-features)
- [Best Practices](#best-practices)

---

## Overview

The Chat panel offers two distinct modes of operation:

1. **Simple Chat**: Standard conversational mode without tool access - fast and efficient for straightforward questions
2. **Agent Chat**: Advanced mode with tool access - enables the agent to search your graph, load pages, and intelligently manage context

The mode automatically switches based on whether you have tools enabled. With any tools enabled, the chat becomes an agent; with no tools, it operates in simple mode.

---

## Simple Chat Mode

### Features

**Ephemeral Conversations**

- By default, conversations exist only in the chat panel
- No data is stored in your Roam graph unless you explicitly insert it
- Perfect for quick questions and temporary discussions

**Flexible Positioning**

- Position the chat panel as: **right panel** (default), **left panel**, **bottom panel**, or **modal**
- Resize the panel to your preference
- All positioning preferences are stored and restored on reopen

**Model and Style Selection**

- Switch between different AI models with one click
- Apply built-in or custom styles (via `#liveai/style`) to format responses
- Rapid model switching: type the first letters of the provider name in the context menu

**Prompt Integration**

- Use built-in prompts or custom prompts (created with `#liveai/prompt`)
- Prompts are applied in order of priority:
  1. To the text in the bottom input box (if provided)
  2. To the context (if input is empty but context exists)
  3. To the conversation history (if no input and no context)

---

## Agent Chat Mode

Agent mode is automatically enabled when you enable at least one tool in the chat interface. This transforms the chat into an intelligent agent capable of:

- Querying your Roam graph
- Loading pages and blocks dynamically
- Managing context intelligently
- Executing complex multi-step workflows

### Access Modes

The agent operates in two access modes that control how deeply it expands context:

#### 🛡️ Balanced Mode (Default)

- **Context Window**: Limited to 50% of model's context window
- **Response Speed**: Faster responses due to smaller context
- **Block Depth**: Adaptive based on result count (0-4 levels)
  - 1-10 results: max 4 levels deep
  - 11-25 results: max 3 levels deep
  - 26-50 results: max 2 levels deep
  - 51-200 results: max 1 level deep
  - 200+ results: no expansion (block content only)
- **Page Depth**: Fixed at 4 levels regardless of result count
- **Best for**: Quick analyses, exploring multiple topics, cost-conscious usage

#### 🔓 Full Access Mode

- **Context Window**: Up to 75% of model's context window
- **Response Speed**: Slower due to larger context
- **Block Depth**: Adaptive based on result count (0-99 levels)
  - 1-10 results: unlimited depth (practical limit: 99 levels)
  - 11-20 results: max 5 levels deep
  - 21-100 results: max 4 levels deep
  - 101-200 results: max 3 levels deep
  - 201-300 results: max 2 levels deep
  - 301-500 results: max 1 level deep
  - 500+ results: no expansion
- **Page Depth**: Unlimited (practical limit: 999 levels)
- **Best for**: Deep analysis, comprehensive research, complex queries

### Adaptive Context Expansion

The agent uses an intelligent context expansion system that adapts to the number of results and the type of content:

**For Blocks** (content in your graph):

- Includes the block's original content (always fully preserved)
- Adds parent block for context (100-500 characters, 20% of budget)
- Expands children recursively with degressive limits:
  - First level: 100-500 chars per child
  - Each deeper level: 70% of previous level's limit
  - Adapts to result count: fewer results = more content per child

**For Pages** (page references):

- Page title is always included
- Children content expanded based on access mode (see depth limits above)
- No parent context (pages are root-level entities)

**Content Budget Allocation**:

- Balanced mode: ~30% of context window (e.g., 60k tokens for 200k model)
- Full Access mode: ~75% of context window (e.g., 150k tokens for 200k model)
- Budget is distributed proportionally across all results
- Remaining space reserved for conversation history and instructions

**Reference Resolution**:

- All block references `((uid))` are automatically resolved to actual content

### Results Panel & Query Manager

The chat integrates seamlessly with the Results Panel and Query Manager:

**Switch Views**

- Toggle between chat view and context/results view
- Context view shows all items currently in the chat's context
- Results view displays query results and allows manual selection

**Run and Compose Queries**

- Execute saved queries directly from the panel
- Compose multiple queries with boolean operators (AND, OR, NOT)
- Query results are automatically available as context

**Manual Context Management**

- Add/remove pages and blocks manually via checkboxes
- Select specific results to focus the conversation
- Clear selection to reset context

**Cross-Page Navigation**

- Click on block references `((uid))` in chat to:
  - Regular click: Show the block in results view (if in context)
  - Shift+click: Open block in right sidebar
  - Alt/Cmd+click: Open block in main window
  - Automatically copies `((uid))` to clipboard
- Click on page references `[[Page]]` or tags `#tag` to:
  - Regular click: Filter results to show that page
  - Shift+click: Open page in right sidebar
  - Alt/Cmd+click: Open page in main window
- Hover over references to highlight them in the results panel (blue for pages, yellow for blocks)

---

## Available Tools

When agent mode is enabled, you can select which tools the agent can use. Each tool serves a specific purpose:

### `add_pages_by_title`

**Purpose**: Add one or more pages to the chat context by their titles
**Use when**:

- User mentions page titles in their questions
- Need to load page content into conversation
- Exploring specific pages or topics

**Options**: Can include first-level child blocks

**Example**: "Tell me about my [[Project Planning]] page"

### `add_linked_references_by_title`

**Purpose**: Add all blocks that reference a given page
**Use when**:

- Need to see what mentions or links to a page
- Analyzing connections and relationships
- Finding all usages of a concept

**Example**: "Show me all blocks that reference [[Machine Learning]]"

### `select_results_by_criteria`

**Purpose**: Intelligently select (check) results based on criteria
**Use when**:

- User wants to filter or focus on specific results
- Need to reduce context size
- Analyzing results matching patterns or date ranges

**Criteria support**:

- Date ranges
- Content patterns
- Semantic analysis (similarity, relevance)

**Example**: "Select only the blocks from last week that mention tasks"

### `ask_your_graph`

**Purpose**: Execute complex natural language queries
**Capabilities**:

- Pattern matching with wildcards
- Semantic search (`~word` finds similar concepts)
- Fuzzy search (`word*` finds variations)
- Boolean logic (AND `+`, OR `|`, NOT `-`)
- Date ranges and filters
- Advanced Roam query syntax

**Use when**: User asks genuinely complex questions requiring search
**Prefer other tools** for simple page/reference lookups

**Example**: "Find all meeting notes from last month that mention budget -personal"

### `get_help`

**Purpose**: Fetch Live AI extension documentation
**Topics covered**:

- Feature guides (Ask Your Graph, custom prompts, etc.)
- API keys and pricing information
- Agents documentation
- Roam & Roam Depot Extension help (depending on community contribution)

**Use when**: User asks how to use features, requests pricing info, or needs help with the extension

**Example**: "How do I set up custom prompts?"

### `live_ai_skills`

**Purpose**: Access specialized skill instructions stored in Roam
**How it works**:

- Skills are stored in Roam with `#liveai/skill` tag
- Each skill contains instructions and optional deeper resources
- Agent loads skills progressively (core instructions first, then deeper resources if needed)
- Skills provide comprehensive guidance without overloading the LLM

**Use when**: User's request matches a specialized workflow or task covered by a skill

**Example**: "Help me plan my weekly review" (loads the Weekly Planning skill)

### Tool Token Overhead

**Important**: Tools add tokens to each message, affecting responsiveness:

- All tools combined: ~3000 tokens per message
- This reduces available context for conversation
- For faster responses: disable tools when not needed
- For brief chats without graph access: turn off tools entirely

---

## Context Management

### Initial Context Setting

**When Opening Chat**:

1. **From selected blocks**: Select blocks in Roam, then open chat - they become initial context
2. **Via "Open chat panel" command**: Opens chat with the current page/sidebar as context
3. **One-click context**: Use buttons to set context to sidebar, current page, or other sources

### Dynamic Context Enrichment

The agent can enrich context on-the-fly:

**Explicit mentions**:

- Mention a page in your prompt: "What does [[My Research]] say about...?"
- Agent decides whether to load the page content based on relevance

**Tool-based loading** (if tools are enabled):

- Agent automatically loads pages when needed for answering
- Fetches linked references when analyzing connections
- Executes queries to find relevant information

**Context View**:

- Switch to context view to see exactly what's in the agent's context
- Manually add/remove items via checkboxes
- Context updates in real-time as agent loads more content

---

## Chat Persistence

### Saving Conversations

**Tag any block** with `#liveai/chat` to create a saveable chat:

```
My Project Discussion #liveai/chat
  - User
    What are the main challenges?
  - Assistant
    Based on your notes, the main challenges are...
  - User
    How can we address them?
  - Assistant
    Here are some approaches...
```

**Structure**:

- Parent block: Chat title with `#liveai/chat` tag
- Child blocks: Alternating conversation turns
- First turn: User (by default, unless role placeholder is used)
- Role indicators: `- User` and `- Assistant` (or custom roles defined in extension settings)

**Creating Chats**:

1. Have a conversation in the chat panel
2. Click "Insert in Roam" button
3. First insertion: Creates a new chat block with auto-generated title
4. Subsequent insertions: Appends only new messages to the existing chat

### Loading Conversations

**From Roam blocks**:

- Open any `#liveai/chat` block in the chat panel
- Conversation history loads automatically
- Continue where you left off seamlessly

**Editing in Roam**:

- Modify messages directly in Roam blocks
- Add your own turns manually
- Next load: Changes are reflected in the chat

### Switching Between Chat and Roam

The integration is bidirectional:

**Chat => Roam**:

- Insert button: Copy conversation to Roam
- Preserves markdown formatting (converted to Roam syntax)
- Nested lists, tables, highlights all properly formatted
- Command context preserved (shows which prompt was used)

**Roam => Chat**:

- Load saved chats by clicking `#liveai/chat` blocks
- Edit in Roam, reload in chat to continue
- Incremental saving: only new messages are inserted on subsequent saves

**Benefits**:

- Use Roam's outline structure for complex, lengthy conversations
- Navigate conversation history easily in Roam
- Leverage Roam's linking and tagging
- Chat panel for real-time conversation, Roam for organization

---

## Built-in Features

### Markdown Support

Chat responses support rich markdown formatting:

- **Headers**: `## Heading`
- **Lists**: Bulleted and numbered
- **Highlights**: `==highlighted text==` (converts to `^^text^^` in Roam)
- **Tables**: Full table support
- **Code blocks**: Inline and multiline code
- **Emphasis**: Bold, italic, strikethrough
- **Images and links**

**Auto-conversion**: When copying or inserting messages, markdown is automatically converted to Roam-native format

### Message Management

**Per-Message Actions** (via dropdown menu):

- **Copy**: Copy message content to clipboard (markdown preserved)
- **Retry**: Regenerate the assistant's response
- **Text-to-Speech**: Have OpenAI read the message aloud (Esc to stop)
- **Delete**: Remove the chat turn (both user message and assistant response)

**Full Conversation**:

- Copy entire conversation with proper role formatting
- Shows command context where applicable
- Preserves conversation structure with indentation

### Token Usage Tracking

Each assistant message displays:

- Input tokens (context sent to model)
- Output tokens (response generated)
- Timestamp of response

**Total conversation tokens** shown in header:

- Cumulative input tokens
- Cumulative output tokens
- Helps track costs and context usage

### Tool Usage Visibility

When the agent uses tools, they're displayed in the conversation:

- Tool name and arguments shown inline
- Intermediate thinking displayed before tool calls
- Tool responses shown (what data was retrieved)
- Stacked display for multiple tool uses
- Tool results are cached for next turns in the conversation

---

## Best Practices

### For Faster Responses

1. **Disable tools** when not needed
   - Tools add ~3000 tokens per message
   - Use simple chat mode for basic questions
2. **Use Balanced mode** for quick analyses
   - Smaller context = faster responses
   - Switch to Full Access only when needed
3. **Combine multiple questions** in one message
   - Context is sent on each turn
   - Batching saves tokens and time
4. **Start a new chat** when switching topics
   - Avoids carrying irrelevant conversation history
   - Reduces token usage

### For Better Tool Utilization

1. **Use powerful models** for agent mode
   - Tools work better with capable models (Claude Sonnet, GPT-4.1, etc.)
   - Lighter models may struggle with tool selection
2. **Be specific** about what you need
   - "Load the Project Planning page" => clear tool usage
   - "Tell me about planning" => agent must infer
3. **Monitor tool usage** in the conversation
   - See what the agent is doing
   - Adjust your questions if needed

### For Complex Tasks

1. **Use Full Access mode** for deep analysis
   - More context = better understanding
   - Worth the slower response time
2. **Load relevant context upfront**
   - Select key blocks/pages before opening chat
   - Reduces need for tool calls during conversation
3. **Leverage Live AI Skills** for workflows
   - Skills provide comprehensive, task-specific guidance
   - Agent loads them automatically when relevant

### Choosing: Inline Ask AI or Chat Panel?

**Use Inline Ask AI** when:

- You need structured outputs in Roam's outline format
- Working with complex, lengthy content
- Want to leverage Roam's navigation and linking
- Need features not supported in chat: Mermaid diagrams, PDF analysis

**Use Chat Panel** when:

- You want conversational, back-and-forth interaction
- Analyzing search results from queries
- Need quick answers without creating Roam blocks
- Want to use agent tools dynamically
- Exploring ideas before committing to Roam structure

### Model Selection Tips

**For bulk work** (cheap, fast):

- DeepSeek ($0.14/$0.28 per 1M tokens)
- Google Gemini Flash

**For quality** (accurate, thoughtful):

- Claude Sonnet or Haiku
- GPT-4.1 or GPT-5

**For speed** (quick responses):

- GPT-4.1-mini
- Gemini Flash

**Switching models**: Type the first letters of the provider name in the context menu for instant switching

---

## Additional Resources

- **Getting Started**: [Main README](https://github.com/fbgallet/roam-extension-live-ai-assistant#1-getting-started)
- **Ask Your Graph Agent**: [Detailed documentation](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#ask-your-graph-agent)
- **Live AI Skills System**: [Skills documentation](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/liveai-skills-system.md)
- **Custom Prompts**: [Prompt creation guide](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#3-custom-prompts)
- **API Keys & Pricing**: [Setup and costs](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md)

---

_Made with joy and perseverance by [Fabrice Gallet](https://github.com/sponsors/fbgallet)_
