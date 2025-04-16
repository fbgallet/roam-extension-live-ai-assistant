## v.18 (April 16th, 2025) Mermaid, advanced :q queries & fixes

**New features**

- Generate any Mermaid diagrams (and argument map using Mermaid)
- Text to Speech (using OpenAI gpt-4o-mini-tts)
- LLMs can generate Roam table or kanban (using 'table' or 'kanban' keyword in your prompt)

**Updates**

- OpenAI gpt-4.1, o3 & o4-mini models support
- OpenAI gpt-4o[-mini]-transcribe models support for voice transcription
- :q Datomic query Agent now support the new native rules and variables
- list of sources at the end of Web search response
- Modifier key to open context menu is customizable (default is Meta/Win) and can be disabled

**Fixed**

- Smart search Agent was often returning only 1 result and other small issues

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
