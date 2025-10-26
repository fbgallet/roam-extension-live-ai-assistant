# LiveAI Skills System

The LiveAI Skills system provides a powerful way to give your chat agent specialized knowledge and instructions stored directly in your Roam Research graph. Skills use progressive loading to avoid context overload while providing deep, detailed guidance when needed.

## Overview

**Skills** are sets of instructions and resources stored as blocks in your Roam graph that the chat agent can access when needed. They work similarly to Anthropic's Claude Skills but are stored in Roam blocks and pages rather than markdown files.

### Key Benefits

- **Context-efficient**: Core instructions load first; deeper resources only when needed
- **Roam-native**: Stored in your graph, editable like any other block
- **Flexible**: Can reference pages, blocks, and use all Roam formatting
- **Progressive**: Load broad instructions first, dive deeper on specific topics as required
- **Specialized**: Provide domain-specific knowledge, workflows, or best practices

## How Skills Work

1. **Discovery**: Agent scans available skills and their descriptions
2. **Selection**: Agent chooses relevant skill based on user's task
3. **Core Loading**: Agent loads basic instructions and sees available resources
4. **Progressive Loading**: Agent loads specific resources only when detailed info is needed
5. **Application**: Agent follows skill instructions to complete the task

## Creating a Skill

### Basic Structure

```
- Skill Name #liveai/skill
  - Description: Brief description of what this skill helps accomplish
  - Instructions:
    - Core instruction 1
    - Core instruction 2
      - Sub-instruction
    - Core instruction 3
```

### With Deeper Resources

```
- Skill Name #liveai/skill
  - Description: Brief description of what this skill helps accomplish
  - Instructions:
    - Core instruction 1
    - Core instruction 2
    - How to handle special cases #liveai/skill-resource
      - Detailed instruction for special cases
      - More details...
        - Even deeper details
    - Core instruction 3
    - Advanced techniques #liveai/skill-resource
      - Advanced technique 1
      - Advanced technique 2
```

## Example Skills

### Example 1: Content Writing Workflow

```
- Blog Post Writing #liveai/skill
  - Description: Complete workflow for creating engaging blog posts with proper structure and SEO optimization
  - Instructions:
    - Start with audience research and topic validation
    - Create compelling headline (use proven formulas)
    - Write introduction that hooks the reader
    - Structure body with clear sections and subheadings
    - SEO optimization techniques #liveai/skill-resource
      - Keyword research and placement
      - Meta description best practices
      - Internal linking strategy
      - Image alt text optimization
    - Conclude with clear call-to-action
    - Editing checklist #liveai/skill-resource
      - Grammar and clarity check
      - Remove redundant phrases
      - Verify all links work
      - Check mobile readability
```

### Example 2: Code Review Process

```
- Code Review Best Practices #liveai/skill
  - Description: Systematic approach to conducting thorough and constructive code reviews
  - Instructions:
    - Review PR description and linked issues first
    - Check overall architecture and design patterns
    - Look for security vulnerabilities
    - Security review checklist #liveai/skill-resource
      - Input validation and sanitization
      - Authentication and authorization checks
      - SQL injection prevention
      - XSS prevention
      - Sensitive data handling
    - Review test coverage
    - Check code style and consistency
    - Provide constructive feedback
    - Constructive feedback guidelines #liveai/skill-resource
      - Use "we" instead of "you"
      - Explain the "why" behind suggestions
      - Offer specific examples
      - Balance criticism with praise
      - Ask questions instead of making demands
```

### Example 3: Research Methodology

```
- Academic Research Workflow #liveai/skill
  - Description: Structured approach to conducting and documenting academic research
  - Instructions:
    - Define research question and hypothesis
    - Conduct literature review
    - Literature search strategies #liveai/skill-resource
      - Database selection (PubMed, Google Scholar, JSTOR)
      - Boolean operators and advanced search
      - Citation chaining techniques
      - Managing search results
    - Design methodology
    - Collect and organize data
    - Analyze results
    - Statistical analysis guidelines #liveai/skill-resource
      - Choosing appropriate tests
      - Sample size considerations
      - P-value interpretation
      - Common statistical mistakes to avoid
    - Write and format paper
    - Citation and formatting styles #liveai/skill-resource
      - APA 7th edition guidelines
      - Chicago style guidelines
      - IEEE format guidelines
```

## Usage Patterns

### Pattern 1: Simple Task (No Resources Needed)

**User request**: "Help me write a blog post about AI"

**Agent behavior**:
1. Loads "Blog Post Writing" skill core instructions
2. Has enough guidance from core instructions
3. Proceeds with task following the workflow

### Pattern 2: Complex Task (Resources Needed)

**User request**: "Review this code for security issues"

**Agent behavior**:
1. Loads "Code Review Best Practices" skill
2. Sees "Security review checklist" resource available
3. Loads security checklist resource for detailed guidance
4. Applies comprehensive security review

### Pattern 3: Multi-Resource Task

**User request**: "Write a research paper on climate change"

**Agent behavior**:
1. Loads "Academic Research Workflow" skill
2. During literature review phase, loads "Literature search strategies" resource
3. During analysis phase, loads "Statistical analysis guidelines" resource
4. For final formatting, loads "Citation and formatting styles" resource

## Best Practices

### Creating Effective Skills

1. **Clear Descriptions**: Write concise, searchable descriptions
2. **Progressive Depth**: Put essential info in core, details in resources
3. **Focused Resources**: Each resource should cover one specific topic
4. **Actionable Instructions**: Use clear, step-by-step guidance
5. **Reference Standards**: Link to pages/blocks with examples or templates

### Naming Conventions

- **Skill Names**: Clear, descriptive, task-oriented
  - ✅ "Blog Post Writing"
  - ✅ "Code Review Best Practices"
  - ❌ "Writing Stuff"
  - ❌ "My Process"

- **Resource Names**: Specific aspect or subtopic
  - ✅ "SEO optimization techniques"
  - ✅ "Security review checklist"
  - ❌ "More Info"
  - ❌ "Details"

### Structure Guidelines

1. **First Child = Description**: Always start with clear description block
2. **Second Child = Instructions**: Main instruction block or tree
3. **Logical Hierarchy**: Group related instructions together
4. **Resource Placement**: Place #liveai/skill-resource tags on parent blocks that contain detailed subtopic information

## Technical Details

### Tags Used

- `#liveai/skill`: Marks the root block of a skill
- `#liveai/skill-resource`: Marks blocks containing deeper resources (children are loaded on demand)

### Query Behavior

1. Extension indexes all `#liveai/skill` blocks at startup
2. Chat agent sees list of available skills in tool description
3. When skill is requested, core instructions load (excluding resource children)
4. When resource is requested, only that resource's children load

### Context Optimization

- Core instructions typically 100-300 tokens
- Resources typically 100-500 tokens each
- Agent only loads what it needs, when it needs it
- Prevents context bloat from loading entire skill trees upfront

## Troubleshooting

### Skill Not Found

**Problem**: Agent says skill doesn't exist
**Solutions**:
- Verify block has `#liveai/skill` tag
- Check skill name matches exactly (case-insensitive)
- Reload extension to re-index skills

### Resource Not Loading

**Problem**: Agent can't access a resource
**Solutions**:
- Verify resource has `#liveai/skill-resource` tag
- Check resource name matches exactly
- Ensure resource is within the correct skill block hierarchy

### Skill Not Being Used

**Problem**: Agent doesn't use relevant skill
**Solutions**:
- Improve skill description to be more discoverable
- Make description match likely user requests
- Explicitly mention the skill name in your request

## Future Enhancements

Potential additions to the skills system:

- Skill templates for common use cases
- Skill versioning and change tracking
- Skill sharing and import/export
- Analytics on skill usage
- Skill composition (skills that reference other skills)
- Conditional instructions based on context

## Related Documentation

- [Chat Agent Documentation](./chat-agent.md)
- [Live AI Extension Overview](../README.md)
- [Custom Prompts](./generative-ai.md)
