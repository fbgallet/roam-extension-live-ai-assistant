## v.23 (November 13th, 2025) Small fixes

**Updates**

- Grok-4-fast support
- `addToContext` tool replace `addPages...` and `addLinkedRef...` tools in Chat agent, more flexibile (add blocks, current page, sidebar...)
- `{chat}` target in LIVEAIGEN SmartBlock command
- Custom prompt block reference will be inserted in the chat history if chat is inserted in Roam or copied to clipboard
- Inline context of custom prompt will be loaded in the Context panel

**Fixed**

- Custom prompts were broken in Chat panel
- Custom styles were not available in Default style extension settings
- When inserting a chat in Roam, the default model was always replacing currently used model

## v.22 (November 10th, 2025) Major update, Chat panel & Chat agent

**New features**

- **Chat panel** (left/right/bottom panel, modal or full screen) + switch with Context panel
- **Chat agent** with tools to handle context, get help, load Skills
- **Query composer** in Context panel: save/load queries, add pages or blocks, combine multiple queries
- `Ask Your Graph - Pattern analysis` command and dialog when user is too broad
- New models supported natively: Gemini models (including Imagen-4 and 'nano banana'), Claude Sonnet 4.5 & Haiku 4.5 (supporting web fetching), gpt-5-search-api
- Get help about Live AI (and more...) by asking the Chat agent

**Updates**

- Better support of sequences of queries by Ask Your Graph (using new formal query operator: UNION/INTERSECTION/DIFFERENCE and PIPE)
- FindDailyNotesByPeriod tool for Ask Your Graph to extract DNPs
- Added 'Pdf' checkbox in Context menu + .pdf support by OpenRouter models
- Added 'Chat' as possible target in Context menu
- blocks/pages embed are now resolved (supported in prompt or context or custom prompt/style)
- custom style support inline context
- complete Markdown support in Chat (including tables, images, links...)
- load chat tagged with `#liveai/chat`, insert current chat in Roam blocks
- Balanced/Full mode in Chat now adjust their limit to model context window (no arbitrary limit)
- Results in Context panel: optimized rendering, each item can be removed or replaced by..., sort by selection
- Better design for Context and Chat popup/panel, better dark themes compatibility

**Fixed**

- More reliable use of Regex by Ask Your Graph agent
- "Include Children" option was still not reliable
- In Chat:
  - highlighting block/pages in context on hover in chat messages was not reliable
  - expand/collapse blocks/pages works better
- In Context panel (full results view):
  - filter by string search or by reference was not working on pages
- Ask Linked Reference button doesn't appear anymore on Daily log
- Default style was overriding choosen style
- When "gpt-5 (non reasoning)" was choosen by default, it was replaced by gpt-5 nano
- `{replace}` option in smartblocks was not working properly

## v.21 (September 23th, 2025) Major update of Ask Your Graph agent

**New features**

- Ask Your Graph agent (replace previous Smart Search and Ask your Graph): retrieve, process or chat with results
- Ask Linked References button: instant chat with linked refs (relying on Ask Your Graph)
- MCP Agent: turn Roam into MCP Client for local or remote (HTTP) MCP servers
- PDF supported in prompt or context for OpenAI or Anthropic models supporting image as input

**Updates**

- gpt-5, Grok 4 and DeepSeek V3.1 native support
- reasoning effort setting for OpenAI/Anthropic/Grok thinking models (minimal/low/medium/high)
- Added `{children}` option for inline context definition (can be used with Live AI SmartBlocks commands)
- Optimized :q queries generation (removing :block/uid clause when not needed) ?
- DNP context: don't include anymore today page (unless from a non-dnp), respecting "previous DNP" indication
- LIVEAIAGENT SmartBlock now support datomic, askyourgraph and mcp:server agents

**Fixed**

- "Include Children" option in Live AI context menu is now working properly
- Inline context is now properly taken into account (e.g. including children of mentioned blocks)
- Better CSS compatibility with Roam Studio & Blueprint extensions
- Block ref as prompt, {page} as context and default style where broken for LIVEAIGEN Smartblock command
- OpenRouter models now work with :q Datomic agent and Gemini with Query agent

## v.20 (June 10th, 2025) DNPs context range

**New features**

- Easily use a given range of previous Daily Notes as context
- Each LLM response has now a title that summarizes its content (option)
- Instant tokens estimation & pricing for the selected context
- Checkbox to include children blocks in prompt (& option to enable it by default)

**Updates**

- Claude Sonnet 4, Grok 3, OpenAI o3-pro support
- Page/Zoom context fit to the current status (zoomed, focused block or not)
- More reliable block sourcing (ask for block source or block-uid)
- Better support of custom baseURL for OpenAI compatible server (no API key needed)
- [[pages]] context now apply also to Page used as context
- selection of blocks (blue selection) now include collapsed blocks

**Fixed**

- still better parser (for codeblocks in lists, Katex multiline, etc.)
- continue conversation was sometime using default model instead of current one
- changing default model instantly update context menu
- Image in context with Anthropic model was broken
- Query Agents & Outliner agent now support multi-blocks prompt

## v.19 (May 15th, 2025) small fixes

**Updates**

- Way better (almost perfect ?) parsing of highly hierarchical and structured LLM responses
- Better system prompt to handle block references from multi-block prompts or context (you can now mention "block uid" or "block reference" in your prompts to encourage the AI to insert them in some way)
- Added option to disable insertion of uids of each block in multi-blocks prompts & context (inserted by default in most built-in prompts & in custom prompts)

**Fixed**

- retry button & right-click on retry or conversation to change model were broken since last update
- support of multi-lines Katex formula between $$

## v.18 (May 10th, 2025) Image generation, Mermaid, advanced :q queries & fixes

**New features**

- Generate or edit images with OpenAI gpt-image-1 model
- Generate any Mermaid diagrams (and argument map using Mermaid)
- Text to Speech (using OpenAI gpt-4o-mini-tts)
- LLMs can generate Roam table or kanban (using 'table' or 'kanban' keyword in your prompt)

**Updates**

- Web search support for Anthropic models
- Added a Web search command
- OpenAI gpt-4.1, o3 & o4-mini models support
- OpenAI gpt-4o[-mini]-transcribe models support for voice transcription
- :q Datomic query Agent now support the new native rules and variables
- list of sources at the end of Web search response
- Added 'Current Page/Zoom content as prompt' command when no block is selected
- Prompt command adapting to block/text focus/selection (or none)
- Modifier key to open context menu is customizable (default is Meta/Win) and can be disabled
- New command to use focused block & all its children as prompt (without selection)
- Main command adapts to block selection (focused, selected, text selection)
- extension renammed to Live AI

**Fixed**

- Smart search Agent was often returning only 1 result and other small issues
- OpenRouter & Ollama first model was always used
- Clearer "Getting started" instructions
- Clearer commands names in Command palette

## v.17 (March 14th, 2025) Web search, generation improvements & fixes

**New features**

- Web search OpenAI models support
- force the LLM to 'think' and improve its previous response (with click + `Alt` on retry button)
- suggestions to continue a conversation (with click + `Alt` on conversation button)

**Updates**

- find models by typing their name in the context menu input
- text selection as prompt or content to process, with whole block as context
- roam dates support (DNP title)
- more complete default model definition (all models available)
- switch model during conversation, or even have multiple AI discuss with each other

**Fixed**

- paragraph order in long responses in multiple blocks was not always correct
- Smart Search & Query Agent 'null' error with some models
- OpenRouter models were not correctly taken into account in tokens counter
- issue with creation of children blocks in Live Outliner
- other small fixes

## v.16 (February 28th, 2025) New models & [[pages]] as context

**Updates**

- Claude Sonnet 3.7 and Grok support (not GPT-4.5 because so expensive !)
- The thinking process of Sonnet 3.7 Extended thinking and DeepSeek-R1 appears in a popup
- Added mentioned [[pages]] as option to define the context
- Vision support for Claude models & Grok-2 Vision
- More complete readme and quickreminder

**Fixed**

- For Groq & Ollama, the first model in the list was always used
- "Extract actianable items" built-in prompt was pointing to "Extract key insights"
- Proper names for DeepSeek models (instead of their API id)

## v.12-15 (February 22th, 2025) Major update, Query Agents and Live Outliner

**New features**

- New context menu with a large set of built-in prompts
- NL query Agents
- Live Outliner Agent, replacing templated post-processing
- Custom prompts, custom styles
- Tokens and pricing counter

**Update**

- DeepSeek support, o3-mini (for tier 3 currently)
- AI character setting replaced by styles
- Full support of inline context, inclusing blocks, pages, DNPs...

**Fixed**

- Haiku 3.5 was pointing to Haiku 3
- block refs were not always properly replaced by block content
- a lot of the small fixes

## v.11 (November 9th, 2024) SmartBlocks and new models

**New feature**

- New SmartBlocks commands to run Live AI assistant from your templates: LIVEAIGEN and LIVEAITEMPLATE

**Updated**

- Support of Claude 3.5 Haiku and last version of Claude 3.5 Sonnet (claude-3-5-sonnet-20241022)
- Added `{text}` keyword to insert in any block of a template that should not be processed as a part of the prompt, but only as text.

## v.10 (October 5th, 2024) Small fixes

**New option**

- possibility to customize baseURL for OpenAI API, and add OpenAI models (like o1-preview or your own fine-tuned ones)

**Fixed**

- indentation in code blocks (all was flattened since the last update)
- Post-processing command from Command palette was broken
- Post-processing was broken for Claude 3.5 (small typo in instruction to generate a JSON response)

## v.9 (August 16th, 2024) Groq & important fixes

**New feature**

- Support Groq API, both for text generation and for audio transcription (using 'whisper-large-v3' model)

**Updated**

- hierarchy in AI responses is now much better interpreted and reproduced within a set of hierarchically arranged blocks
- requests to Anthropic API (Claude models) are now directly sent to Anthropic (no more server-side request needed, so it's faster) and the responses can be streamed
- when selecting a multiple blocks as prompt (with basic 'blue' selection), they are used as prompt (not context) and response is inserted in the next sibling block of the first block of the selection

**Fixed**

- Post-processing following a template was broken since last update, now working again !
- fixed the issue preventing GPT-4o & GPT-4o-mini to work on Sarafi browser (and iOS)
- fixing default model as first model of OpenRouter/Groq/Ollama is now working properly
- image(s) in multi-selected blocks are now correctly taken into account
- using button to continue a conversation send the request to the model used in this conversation, not the default one

## v.8 (July 19th, 2024) New model

**New features**

- GPT-4o-mini (3x cheaper) replace by default GPT-3.5, and it includes Vision
- easily chat with your AI assistant with the button on the right of your prompt to continue a conversation

**Updated**

- option to set image resolution for Vision to low or high

**Fixed**

- code blocks where not always properly rendered (simple backticks were misinterpreted by the regex)
- chat roles setting can be let blank if you don't want "AI assistant: " inserted before each response. In this case, chat remains possible, but only with the dedicated button to continue conversation.

## v.7 (June 22nd, 2024) Easily chat

**New features:**

- continue easily a chat with an AI Assistant: all the previous messages will be taken into account

**Updated**

- better support of Markdown syntax of model responses (especially GPT-4o)
- Claude Sonnet 3.5 support
- option to customize temperature of model responses
- option to customize Ollama server address and port

## v.6 (May 12th, 2024) New models available

**New features:**

- GPT-4o support, including Vision
- OpenRouter support to access most of existing models (including Vision for some models)
- Ollama support to use local models

**Updated**

- Added option to set number of images limit for Vision and to toggle stream mode
- Claude API error messages are clearly displayed in a toast
- On mobile, controls in topbar are shifted to top right

**Fixed**

- Using linked references or past DNPs as context was not working properly
- (on server side) Server can now support the entire Claude token window (200,000 tokens). Until now, by mistake, it did not support messages longer than 100,000 characters (approximately 30,000 tokens).

## v.5 (May 4th, 2024) Small fixes

**Fixed**

- Wrong size of ocons on mobile
- On mobile, controls in topbar are shifted just below the topbar to remain visible

## v.4 (May 3rd, 2024) Important update

**New features:**

- Claude models support
- Context menu to choose model
- Streamed response (only for GPT models)
- Subtle buttons for generating again AI response & copy to clipboard

**Updated**

- Easier support for text-only prompts (using the same buttons as for voice prompts)
- Roles template (for user and AI) support a placeholder for AI model
- Selected block(s) can be used as prompt (previously, focus in a block was needed)
- Better tooltips
- Name change: from "Speech-to-Roam" to "Contextual AI Assistant"

**Fixed**

- Codeblocks were broken in case of line breaks, now they are properly parsed

## v.3 (February 26th, 2024)

**Major new features:**

- linked refs, sidebar, main page or daily log used as the context for your prompt to the AI assistant !
- use multiple-blocks templates as prompt to be completed by AI assistant !

**Added**

- Option to set blocks to exclude from context if they contain some given words (like #private)
- Redo command for AI completion

**Updated**

- update to the latest GPT-4-turbo-preview & GPT-3.5-turbo models
- "⚠️ no recording" message if Whisper did not detect a vocal note (in most cases, not deterministic)
- more explicit error messages (e.g. in case of billing issue with OpenAI API)

**Fixed**

- block references were not resolved in focused block prompt
- compatibility with Roam Studio is better
- verification of the transcription language code (no more error if it's not properly set)

## v.2 (January 29th, 2024)

**Added:**

- Commands in command palette for transcription, translation & send prompt to AI assistant
- Command for sending prompt to AI assistant without vocal note but only blocks content
- Option to insert AI assistant response in multiple blocks if multiple paragraphs (by default)
- Option & command to hide controls and make them only visible when recording a note
- Option to add instructions for context use by AI assistant
- SmartBlock command

**Fixed:**

- Reference to focused block to append transcription or use as context was not working
- Block selection was not taken into account if made after start of recording
- Default settings were not visible on installation
