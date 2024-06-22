## v.7 (June 22nd, 2024) Easily chat

**New features:**
- continue easily a chat with an AI Assistant: all the previous messages will be taken into account

**Updated**
- better support of Markdown syntax of model responses (especially GPT-4o)
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
