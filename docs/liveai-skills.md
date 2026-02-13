# Live AI Skills

Live AI Skills, inspired by Anthropic Claude Skills, are advanced but easy-to-use automated workflows stored in your Roam graph that combine three elements:

- **Instructions** — step-by-step guidance the agent follows
- **Resources** — reference content or detailed instructions the agent reads on demand (documentation, specific procedures, examples)
- **Records** — outlines the agent can read _and write to_ (logs, trackers, drafts, databases)

By combining these, a skill can go beyond answering questions: it can follow a complete workflow — reading context from resources, applying instructions, and producing structured output into records. This enables repeatable processes like meeting note-taking, content pipelines, research logging, review checklists, or any routine where the agent both reads and writes in your graph.

Skills load progressively: core instructions first, then resources and records only when needed, keeping context lean.

## How Skills Work

1. **Discovery**: Agent matches the user's request to available skills
2. **Core Loading**: Agent loads instructions and sees available resources/records
3. **Deep Loading**: Agent loads specific resources or records on demand
4. **Execution**: Agent follows instructions, reads resources, writes to records

## Creating a Skill

### Basic Structure

```
- Skill Name #liveai/skill
  - Description: Brief description of what this skill helps accomplish
    - Optional additional description details (children are included)
  - Core instruction 1
  - Core instruction 2
    - Sub-instruction
```

The **first child** block starting with `Description:` (case-insensitive) is the skill's description. Its children are included in the description text.

### Skill Elements

Skills support three types of special blocks. Each can be identified either by a **tag** or a **prefix** (case-insensitive):

| Element  | Tag                      | Prefix alternative | Purpose                                          |
| -------- | ------------------------ | ------------------ | ------------------------------------------------ |
| Resource | `#liveai/skill-resource` | `Resource:`        | Read-only reference content, loaded on demand    |
| Records  | `#liveai/skill-records`  | `Records:`         | Editable outline the agent can read and write to |

Both resources and records follow the same pattern: the block text (after tag/prefix) is the title, and children are the content loaded on demand.

### Instructions Block and Permanent Context

You can optionally group your instructions under an `Instructions:` prefix block. Beyond being a structural marker, this block unlocks **permanent context**: any `[[page]]` or `((block-ref))` mentioned directly in the `Instructions:` block text is **always loaded with the skill**, every time it is invoked.

This is useful for skills that rely on living reference material — notes, guidelines, templates, or any page that evolves over time. The content is fetched fresh on each skill load.

```
- Skill Name #liveai/skill
  - Description: ...
  - Instructions: [[My Style Guide]] [[Team Conventions]]
    - Step 1 — agent already has the style guide in context
    - Step 2
    - Step 3
```

In this example, the full content of `[[My Style Guide]]` and `[[Team Conventions]]` is automatically injected before the instruction steps each time the skill is loaded — no need to embed them manually or load them as a separate resource.

**Rules:**
- Any `[[page]]` reference → full page content is fetched and included
- Any `((block-uid))` reference → the block and its children are fetched and included
- Any remaining text in the `Instructions:` block (after stripping the prefix and references) is kept as an instruction line
- Children of the `Instructions:` block become the regular instruction steps, as usual
- If there is no `Instructions:` block, all children after the description are treated as instructions (unchanged behavior)

### Resources

Resources provide deeper reference content that the agent loads only when needed. Children of resource blocks are **not** included in core instructions — the agent must explicitly request them.

Two equivalent ways to declare a resource:

```
- Using tag:
  - SEO techniques #liveai/skill-resource
    - Keyword placement guidelines
    - Meta description best practices

- Using prefix:
  - Resource: SEO techniques
    - Keyword placement guidelines
    - Meta description best practices
```

You can reference existing pages or blocks in a resource title using `[[page]]` or `((block-ref))` syntax. Their content is automatically included when the resource is loaded:

```
- Security standards from [[OWASP Top 10]] #liveai/skill-resource
  - Additional context-specific notes here
```

```
- Resource: Security standards from [[OWASP Top 10]]
  - Additional context-specific notes here
```

Both tag-based and prefix-based resources support page and block references this way. The referenced content is fetched live when the resource is loaded, so it always reflects the current state of the page.

#### Relative Date References in Resources

Resources also support **relative date keywords** inside `[[...]]`. These are resolved at invocation time to the corresponding Roam daily note pages (DNPs). Range keywords expand to multiple daily note pages, so all of them are fetched and combined.

| Keyword | Resolves to |
| ------- | ----------- |
| `[[today]]` | Today's daily note |
| `[[yesterday]]` | Yesterday's daily note |
| `[[tomorrow]]` | Tomorrow's daily note |
| `[[next week]]` | Same day next week |
| `[[next month]]` | Same day next month |
| `[[in X days]]` | Daily note X days from today |
| `[[in X weeks]]` | Daily note X weeks from today |
| `[[in X months]]` | Daily note X months from today |
| `[[last week]]` | The 7 daily notes ending yesterday |
| `[[last month]]` | The 30 daily notes ending yesterday |
| `[[last X days]]` | The X daily notes ending yesterday |
| `[[this week]]` | Daily notes from last Monday through today |
| `[[this month]]` | Daily notes from the 1st of this month through today |

Examples:

```
- Today's journal #liveai/skill-resource
  - Resource: my notes from [[today]]

- Resource: context from [[last week]]

- Recent activity from [[last 3 days]] #liveai/skill-resource
```

### Records

Records define **editable outlines** where the agent can add, update, or remove content using `create_block`, `update_block`, and `delete_block` tools. The agent receives the records' UID and current content.

```
- Using tag:
  - Meeting notes #liveai/skill-records
    - {{[[embed]]: ((block-uid))}}

- Using prefix:
  - Records: Meeting notes
    - {{[[embed]]: ((block-uid))}}
```

**Target resolution**: The agent determines where to write records using this priority:

1. **Embed child** (explicit): If the first child of a records block is an embed (`{{[[embed]]: ((uid))}}`), the agent writes to the embedded outline. This lets you point a skill at any existing outline in your graph.
2. **Page reference in title** (shorthand): If the records title contains a `[[page]]` reference (e.g., `Records: Tweet drafts — prepend new entries on [[my tweet drafts]]`), the agent writes to that page. This is a convenient shorthand — no embed child needed.
3. **Records block itself** (default): If neither of the above is present, the records block itself is the writable container, records will be written as children of this block.

#### Relative Date References in Records

The **page reference in title** shorthand (option 2) supports **single-day relative date keywords**, letting you target today's (or another day's) daily note as the write destination:

| Keyword | Resolves to |
| ------- | ----------- |
| `[[today]]` | Today's daily note |
| `[[yesterday]]` | Yesterday's daily note |
| `[[tomorrow]]` | Tomorrow's daily note |
| `[[next week]]` | Same day next week |
| `[[next month]]` | Same day next month |
| `[[in X days]]` | X days from today |
| `[[in X weeks]]` | X weeks from today |
| `[[in X months]]` | X months from today |

Range keywords (`[[last week]]`, `[[this month]]`, etc.) are not supported for Records since a single write target is required.

Example:

```
- Records: Daily standup notes — append to [[today]]
- Records: Weekly review — write to [[next week]]
- Records: Follow-up tasks — log on [[in 3 days]]
```

```
- Explicit embed (option 1):
  - Records: Meeting notes
    - {{[[embed]]: ((block-uid))}}

- Page reference shorthand (option 2):
  - Records: Tweet drafts — prepend new entries on [[my tweet drafts]]

- Default (option 3):
  - Records: Action items
```

#### Describing how records should be written

The records block title (the text after `Records:` or the tag) serves as a description for the agent. You should use it — or the skill's core instructions — to communicate how the agent should interact with these records. Here are some aspects you may want to describe, in whatever way feels natural:

- **When to add records**: e.g., "only after user confirms", "for each identified issue", "when new data is available"
- **Format and structure**: e.g., "each record is a bullet with date prefix", "use H2 headings for categories", "follow the template: `**Name** - description - status`"
- **Positioning**: e.g., "add new entries at the top", "append at the end", "use smart insertion to find the right section"
- **What to update vs. create**: e.g., "update existing entries if a match is found, otherwise create new ones"
- **Templates or examples**: you can put a template as a child of the records block (alongside the embed if any) to show the expected format

These are just examples — there's no mandatory structure. Describe your expectations however makes sense. The key principle is that **conditions and format should be described in the records title or in the skill's core instructions**, not inside the records outline itself, since the agent reads the description before loading the records content.

## Complete Example

```
- Content Production #liveai/skill
  - Description: Workflow for producing and publishing blog content
    - Covers research, writing, editing, and SEO
  - Instructions: [[Brand Voice Guidelines]] [[Editorial Calendar]]
    - Research the topic thoroughly before writing
    - Structure with clear headings and short paragraphs
    - Resource: SEO optimization checklist
      - Keyword density: 1-2% for primary keyword
      - Include meta description (155 chars max)
      - Add internal links to related posts
    - Style guide from [[Company Style Guide]] #liveai/skill-resource
    - Review and edit before publishing
    - Records: Published articles — append new entries with date, title, and URL #liveai/skill-records
      - {{[[embed]]: ((articles-list-uid))}}
```

In this example:

- **Description** includes children ("Covers research, writing...")
- **`Instructions:`** loads `[[Brand Voice Guidelines]]` and `[[Editorial Calendar]]` as permanent context on every skill invocation — their live content is injected before the instruction steps
- **"SEO optimization checklist"** is a resource using `Resource:` prefix
- **"Style guide..."** is a resource using `#liveai/skill-resource` tag with a page reference
- **"Published articles..."** is an editable records outline; the description itself tells the agent to append entries with date/title/URL format

## Best Practices

1. **Clear Descriptions**: Write concise, searchable descriptions; add detail as children
2. **Progressive Depth**: Essential info in core instructions, details in resources
3. **Focused Resources**: Each resource covers one specific topic
4. **Leverage Existing Pages**: Use `[[page]]` references in the `Instructions:` block for living context that should always be available, or in resource titles for content loaded on demand
5. **Use Records for Output**: When the skill should produce or maintain structured content, define records with clear expectations about format and conditions

### Naming Conventions

- **Skill Names**: Task-oriented (e.g., "Blog Post Writing", "Code Review")
- **Resource/Records Names**: Specific (e.g., "SEO checklist", "Meeting notes")

### Structure Guidelines

1. **First Child = Description** starting with `Description:`
2. **Optional `Instructions:` block** — groups instruction steps and carries permanent context via page/block references in its text
3. **Remaining Children = Instructions**, resources, and records in logical order
4. **Resource/Records Placement**: Place them inline where they're most relevant in the workflow

## Technical Details

### Tags and Prefixes

| Tag                      | Prefix         | Purpose                                                        |
| ------------------------ | -------------- | -------------------------------------------------------------- |
| `#liveai/skill`          | —              | Marks the root block of a skill                                |
| —                        | `Instructions:` | Optional grouping block; inline page/block refs become permanent context |
| `#liveai/skill-resource` | `Resource:`    | Deeper resource (children + referenced pages loaded on demand) |
| `#liveai/skill-records`  | `Records:`     | Editable outline (agent can read and write)                    |

All prefix matching is **case-insensitive** and supports both single colon (`Records:`) and double colon (`Records::`) Roam attribute syntax.

### Relative Date Resolution

Relative date keywords in `[[...]]` syntax are resolved at invocation time — no LLM call required, no token cost. Keywords are matched case-insensitively.

- **Resources** support both single-day keywords and range keywords. Range keywords (e.g. `[[last week]]`) expand to multiple `[[DNP page]]` references so all matching daily notes are fetched and combined.
- **Records** support single-day keywords only (e.g. `[[today]]`), since a write target must be a single page.
- Keywords are resolved relative to the current local date at the moment the skill is invoked.

Plural forms of tags are also supported (`#liveai/skills`, `#liveai/skill-resources`, `#liveai/skill-records`) but the **singular form is recommended** for skill and resource tags, and the **plural form is recommended** for records.

### Permanent Context (Instructions block)

When the agent loads a skill that has an `Instructions:` block, the following happens automatically:

1. All `[[page]]` references in the `Instructions:` block text → full page content fetched via `getFlattenedContentFromTree`
2. All `((block-uid))` references → that block and its children are fetched
3. The fetched content is prepended to the instruction steps under a **Permanent context** header
4. The remaining text of the `Instructions:` block (after removing the prefix and references) is kept as an instruction line if non-empty
5. Children of the `Instructions:` block become the regular instruction steps

This content is **always loaded** with the skill (not on demand), and is **fetched live** every time — so it reflects the current state of the referenced pages or blocks.

### Progressive Loading Flow

1. Agent calls `live_ai_skills` with `skill_name` → gets core instructions (including permanent context) + list of resources/records
2. Agent calls with `resource_title` → gets resource content (including any referenced page content)
3. Agent calls with `records_title` → gets records' current content + writable UID
4. Agent uses `create_block`/`update_block` with the records UID to add or edit content

### Context Optimization

- Core instructions: typically 100-300 tokens (permanent context adds to this proportionally)
- Resources/records: loaded only when needed
- Agent is autonomous: loads resources/records without asking the user
- Use permanent context for material the agent always needs; use resources for deeper reference loaded on demand

## Troubleshooting

**Skill not found**: Verify the block has `#liveai/skill` tag. Skill name matching is case-insensitive.

**Resource not loading**: Check it has `#liveai/skill-resource` tag or starts with `Resource:`, and is within the skill's block hierarchy.

**Permanent context not appearing**: Ensure the `Instructions:` block is the first child after the description, and that the `[[page]]` or `((uid))` references in its text are valid (the page must exist in your graph).

**Records not resolving embed**: Ensure the embed syntax is correct (`{{[[embed]]: ((uid))}}`) and the referenced block exists.

**Skill not being used**: Improve the description to match likely user requests, or mention the skill name explicitly.

## Related Documentation

- [Chat Agent Documentation](./chat-agent.md)
- [Live AI Extension Overview](../README.md)
- [Custom Prompts](./generative-ai.md)
