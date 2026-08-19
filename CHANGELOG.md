### v.35 (August, 2026) Color Highlighter tool & Context/target selector

**New features**

- 🎨 **Color Highlighter tool** in the Chat agent: **apply colors** to your notes — highlight, text color, underline, box, block background, card grid — or **extract content by color** ("extract and comment everything highlighted in blue"). It follows the conventions of the [Color Highlighter](https://github.com/fbgallet/roam-extension-color-highlighter) extension, required from Roam Depot for the colors to render (the tool tells you if it isn't installed or is disabled). Plain Roam formatting is handled too, so "clean up the highlights of this page" works whether they are colored or not. Blocks are edited in place, and content behind `((block refs))` and `{{embeds}}` can be colored as well — the edit is applied where the text really lives.
- 🎯 **Context & target selector**, next to the chat input: choose which sources the agent **reads** (loaded context, main view, sidebar) and, independently, which ones it **acts on** with the edition tools — so you can read what you loaded while editing the page you are looking at. Main view and sidebar are re-read before each request, so they follow you when you change page or zoom. A pin keeps your setup across sessions; otherwise it resets to the loaded context. The agent no longer asks you to load the current page before editing it.

**Updates**

- New models support: Gemini 3.7 Flash (replacing 3.6 Flash).
- Deepseek and Open AI models pricing update.
- The "Button visibility" setting becomes a three-option selector: `Always` (default), `Mobile only` — for those who use Live AI mainly to dictate on their phone — and `No`. Your previous choice is preserved, and the mode follows the window width, so it applies immediately in a narrow window without reloading.

**Fixed**

- Context was broken on inline AI generation (via Context Menu) on multi-turn conversation.
- A source was sent **twice** when it was already loaded in the context (a page both loaded in the context and open in the main view or sidebar was duplicated in full, children included).
- **Editing a block containing a `((block reference))` or an `{{embed}}` silently destroyed it**: the AI is shown these resolved into their text, and wrote that text back in place of the reference. Such edits are now refused, with the raw content returned so the AI can retry — or target the referenced block instead.
- **The chat froze when a single turn needed several confirmations**: the tools of one turn run in parallel, and their confirmation dialogs overwrote each other, leaving the agent waiting forever for an answer that could no longer be given. Dialogs are now shown one after the other. Stopping the generation properly ends such a pending request, and the tools already run stay listed on the interrupted message. "Always approve" now also takes effect immediately, instead of only from the next turn.

### v.34 (August, 2026) Attached files as input: Markdown, text & Office documents

**New features**

- **Attached files as input**, in your prompt or in your context, in addition to `.pdf`:
  - **Plain-text formats** — `.md`, `.txt`, `.csv`, `.tsv`, `.json`, `.xml`, `.yaml`, `.org` and the most common code files — their content is read and inserted directly in the request, so **every model can use them**, whatever its provider: this includes local Ollama models and text-only models that don't support .pdf.
  - **Office documents** — `.docx`, `.pptx`, `.xlsx`, `.rtf`, `.odt`… — are sent to **OpenAI models**, currently the only ones able to parse them. With any other model, a clear warning invites you to switch model or to export your file to PDF, instead of letting the AI invent content from a file name it can't open.
  - Files are recognized both as Roam attachments (`[my-notes.md](firebase url)`) and as direct web urls. Ordinary links are left alone: a file name is only recognized in the last segment of a url path, so a link like `https://en.wikipedia.org/wiki/Roam` is never mistaken for an org-mode file. In a bare external url, extensions that usually end a web page or a page asset (`.php`, `.js`, `.css`…) are ignored too — write them as `[name.js](url)` if you really mean the file.
  - Reading a file is skipped, with a clear message, beyond a total volume of inlined content, so a context holding many attachments can't fill the context window nor trigger a download per link. The same file referenced in both your prompt and your context is downloaded and sent only once.
  - The `PDF` checkbox in the Context menu becomes `Files`, and the "Always extract PDF content" setting becomes "Always extract attached files content": both now cover every supported format. In the Chat panel, the same choice is available per conversation in the "..." (advanced options) menu — and **files present in the context are only read if you enable it**, while a file you write yourself in your prompt is always read.

- **Voice transcription with OpenAI's new models**:
  - **`gpt-transcribe`** becomes the default model for vocal notes: more accurate and **cheaper** than whisper-1 ($0.0045/min vs $0.006/min). It replaces Whisper's free-form prompt by structured hints. Users still on `whisper-1` (the historical default) are switched over automatically, once: whisper-1 remains available in the settings and in the Models dialog if you prefer it, and your choice is then respected.
  - 🆕 **Live transcription** — a new button next to the recorder (shown when you have an OpenAI API key, and removable in the settings): dictate continuously and **your words are inserted in the focused block as you speak**. Press `Enter` or click in another block, and what follows goes there. Since the target is simply whichever block has the focus, this works anywhere a block can be edited — including **inside a Roam table cell or a diagram**, filling a table or drawing a map of ideas by voice. Also available **in the Chat panel** (button to enable in the "..." advanced options menu): your words fill the input, you still validate them with `Enter`, and the microphone pauses while the answer is generated, then waits for your voice to resume.
  - ⚠️ A live session is billed per minute of streamed audio (`gpt-live-transcribe`: ~$0.017/min, so ~$1 per hour), **silences included** — so the microphone stops being streamed after a configurable silence (10 seconds by default) and starts again on your first word, without reconnecting. Coming back on the air takes an **actual voice**, not just a sound: the detection looks for the periodicity of vocal cords and a sustained loudness, so typing on your keyboard or a noise in the room doesn't wake up the microphone. Leaving Roam for another window pauses the streaming at once, and nothing can restart it from there: no word is ever dictated into a block you aren't looking at. A "Voice detection sensitivity" setting adjusts how strict this is, from `High` (any sound, the only level where a whisper is enough) to `Low` for a noisy room. A session you forget about closes on its own after 30 minutes without a word dictated (configurable), so the microphone is never left open for hours.

**Updates**

- New models support: Claude Opus 5, Gemini 3.6 Flash & 3.5 Flash Lite
- The **Outliner Agent icon is now hidden by default** (a setting brings it back): it remains available with the `O` key while recording and in the Live AI context menu, and reappears as soon as an outline is set as active.
- **New `-latest` model aliases**: each main model family now has a stable alias always pointing to its most recent supported model — `gpt-sol-latest`, `gpt-terra-latest`, `gpt-luna-latest`, `opus-latest`, `sonnet-latest`, `haiku-latest`, `fable-latest`, `gemini-pro-latest`, `gemini-flash-latest`, `gemini-lite-latest`, `grok-latest`, `deepseek-pro-latest`, `deepseek-flash-latest`. Use them as the model parameter in your SmartBlocks (`<%LIVEAIGEN%>`, `<%LIVEAITEMPLATE%>`…) so your templates don't need to be updated at each new model release.

**Fixed**

- **OpenAI models with thinking enabled were ignoring all their instructions** — and, in the Chat panel, the whole conversation: every turn was answered as if it were the first. Their requests go through OpenAI's Responses API since reasoning effort was repaired (v.33), and the system prompt was silently dropped on that route.
- In the Chat panel, an **attached file's content was kept in the conversation history** and resent at every following turn, quickly saturating the context window. An image in a message was stored unreadable, breaking follow-up questions about it.
- **Gemini models were ignoring a .pdf provided in the context as soon as the thinking level was raised** (it only worked at "low"): the PDF was properly attached, but its url was also left in the context, so the more the model reasoned, the more likely it was to try to fetch it — which Google can't do — and to answer that no PDF was provided.
- A .pdf that failed to upload to Gemini was silently ignored: failures are now reported, and the extension waits for Google to finish processing the file. Gemini also warns you when it has spent its whole output budget on reasoning and returned an empty answer.
- **.pdf support repaired for several providers**: Groq, DeepSeek, custom OpenAI-compatible endpoints, OpenRouter and Grok, each sending the file in a format their API doesn't accept.
- With Claude models, a .pdf placed in the prompt disabled its own processing (its url was treated as a web page to fetch), and images and .pdf files were silently ignored when thinking mode was enabled.
- In the Chat panel, a .pdf could only be read by a Gemini model — every other model answered that PDF analysis requires Gemini, although OpenAI, Anthropic and OpenRouter models read PDFs perfectly well. The chat now uses the capabilities of the selected model, and a Roam-hosted PDF is properly uploaded instead of being handed to the model as a url it can't open.

### v.33 (July 14th, 2026) AI table auto-complete & reasoning effort that actually works

**New features**

- **Roam table auto-complete** options: click a Roam table's row or column handle (or Right-Click its "+" add-row / add-col buttons) to reveal new **Live AI** options:
  - **Auto-complete/update** a row or a column: fills only the empty cells or the `[bracketed instructions]` (e.g. `[city]`, `[a short bio of this author]`), guided by the column headers, an example row/value and your optional instructions. An **Overwrite** toggle updates already-filled cells instead (e.g. "translate this column to French", "round to 1 decimal").
  - **Multi-rows** and **multi-column** auto-complete: generate any number of new rows or columns filled by AI using the whole table as context (new column titles are proposed and set in **bold**, like native headers).
  - Everything is controllable from the dialog: pick the **model** (left/right-click the option or the in-dialog picker), toggle **thinking mode & reasoning effort**, choose a **style**, and add **context** — sidebar, current page, mentioned `[[pages]]`, or **inline instructions** written right after the `{{[[table]]}}` component in the same block.

**Updates**

- GPT 5.6 models now support the full reasoning effort range, including the new "xhigh" level and a distinct "max". Disabling thinking sends an explicit "none", which keeps function tools working.
- The chat panel now remembers your choices: thinking on/off is kept per model for the session (survives closing the panel), and your Chat/Agent mode is persisted across sessions.

**Fixed**

- Reasoning effort is now properly actually applied in the chat panel. LangChain was silently dropping the reasoning parameters, so the chosen effort never reached the API — both for OpenAI models (gpt-5.x, o-series) and for Claude "adaptive" thinking models (Opus 4.6/4.7/4.8, Sonnet 5, Fable/Mythos 5)..
- GPT 5.6 models no longer fail when thinking mode is disabled.

### v.32 (July 9th, 2026) More reliable Voice transcription

**Updates**

- New models support: OpenAI GPT 5.6 Sol, Terra & Luna, Claude Sonnet 5, Grok 4.5
- New image generation model: Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image) — a faster, cheaper variant supporting all aspect ratios (1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9) at 1K resolution.
- Voice transcription now supports Gemini (Google) and Grok (xAI) models, in addition to OpenAI Whisper / gpt-4o-transcribe models.
- The transcription model can now also be chosen from the Models customization dialog (new "Transcription" selector), alongside the existing setting in the extension settings.
- New per-model "🧠 Think by default" switch in the Models customization dialog: choose whether thinking/reasoning mode starts enabled for each model (you can still toggle it per conversation from the chat or context menu).
- Custom models can now be flagged as reasoning models when added (new "Reasoning model" option in the custom model form, with a choice of thinking API style) — thinking toggle, per-model default and effort control then work for them too. OpenRouter reasoning models are auto-detected, and Ollama local reasoning models (think on/off) are supported.
- The "Reasoning effort" setting now offers a "max" level (in addition to minimal/low/medium/high); the in-chat thinking picker shows the exact levels supported by the selected model.

**Fixed**

- Thinking mode can now actually be disabled for reasoning models that support it (Claude Sonnet 5, Opus 4.6/4.7/4.8…). The toggle was previously hidden or forced on. Models that can only run with thinking (Claude Fable 5, OpenAI o-series, Gemini 3, DeepSeek Reasoner) correctly stay always-on.
- Reasoning effort is now mapped consistently per provider and model, fixing cases where an unsupported level (e.g. "max" or "minimal") could be sent to a model that rejects it.
- Pausing and resuming a recording multiple times no longer drops the audio recorded after the last pause.
- OpenAI Whisper (whisper-1) no longer occasionally replaces the transcription with a repeated stray sentence: instruction text is no longer sent in the Whisper prompt (it was treated as content to echo on low-confidence audio).
- Silent or non-speech recordings are now detected and skipped with a clear warning, instead of producing hallucinated text; for Whisper models, hallucinated/non-speech segments are also filtered out from the result.

### v.31 (June 10th, 2026)

**Updates**

- New models support: Claude Fable 5, Opus 4.8, Gemini 3.5 Flash, Grok 4.3
- Chat conversation is now saved locally and restored after a browser refresh (same-day auto-restore, with a button to restore a previous-day conversation)
- In Context menu, new pin button for the context selection (keeps your context choices across runs instead of resetting each time)
- Roam queries and :q queries nested in a Style are now executed automatically whenever the style is applied (dynamic, deterministic query context)

**Fixed**

- Roam tables shared as context (chat or inline) are now always read in full, all rows captured regardless of depth/access settings
- Long chats: recent turns are now always kept verbatim when older history is summarized (less context loss), summarization cost is counted, and per-message token counts are accurate (running total shown in the header)

### v.30 (April 27th, 2026) Debate mode

**New features**

- **Debate mode** in LLM Council: autonomous or human-in-the-loop

**Updates**

- New models support: GPT 5.5, Opus 4.7, DeepSeek V4, GPT Image 2.

**Fixed**

- Chat with :q query works with relative variables (like current-page...)

### v.29 (April 2026) LLM council & Vector search (experimental)

**New features**

- LLM Council mode in Chat: orchestrate multiple models to generate, evaluate and refine answers
- Vector Search tool (experimental): choose between a free local models or OpenAI's vector store.
- Chat with :q Datomic query results (new button in query menu)
- Run SmartBlock tool: trigger any SmartBlock workflow directly from chat
- Public API for developers (`window.LiveAI_API`) available to other Roam extensions

**Updates**

- New models support: GPT-5.4-mini, Gemini 3.1 Flash Lite, Nano Banana 2, Grok 4.20
- Anthropic models have now 1M context window
- Stop button in Chat panel
- Slash commands to force-use tools in Chat panel
- /clear slash command -> then just press enter to confirm
- Tool usage display shows more human-readable summaries
- Advanced parameters in '...' menu in Chat panel (including temperature, top_p, presence_penalty)
- "What's new" more visible until first click
- Options in extension settings to always extract PDF or Query content
- Button to copy codeblocks in Chat messages
- More consistent icons in Chat panel

**Fixed**

- Better parsing of complexe content including, regex or hashtag in inline codeblock
- Prevent LLM to use format like `#1` to number things !
- Better handling of numbered list
- Hallucinations on UIDs should be dramatically reduced

### v.28 (February 19th, 2026) Small fixes

- Fixes for custom models duplication
- Button to remove OpenRouter models and display only added models
- Gemini 3.1 Pro support

## v.27 (February 18th, 2026) Chat with queries, edition agentic features...

**New features**

- New button to instantly Chat with native query results (similar to Chat with linked references).
- New dialog for Models & models menus customization (select models to display in the menu, favorites, add custom models...)
- New tools for Chat agent (in chat panel):
  - Edition: create Page or blocks, update or delete blocks (with human validation)
  - Interaction: Ask user choice (for poll, QCM...) and Random pick (from context or any list)
- New context options in Context menu: 'Siblings', 'Path' (ancestors) and 'Queries' (Roam querie and :q queries)
- Commands to generate PDF/DOCX/PPTX documents via Claude Skills (Anthropic API Key requested)
- New button and dropdown to handle thinking effort of reasoning models.
- Any message in Chat panel is editable (rendered as Roam blocks)
- Skills now support 'Records', capacity to write output at any defined place in your graph

**Updates**

- New models available: GPT-5.2, Claude Opus 4.6 & Sonnet 4.6, Gemini 3 Flash, GPT Image 1.5, Grok Imagine. DeepSeek models are back.
- New Outline Roam feature supported (inline and in chat panel)
- Skills resources support relative dates
- Natural language query and :q interpreter now supported in Chat panel (and instantly loading results in context)
- No truncation (infinite) mode, in Full Access mode
- Image edit mode in Chat panel
- Slash commands dedicated to Chat panel (/clear, /exit, /save...)
- In chat panel, Build-in prompt menu and Page autocompletion support Vim shortcut (ctrl+p or j / ctrl+n or k)

**Fixed**

- Grok API was not working any more (due to API change)
- Edit image with Gemini model was causing an OpenAI error
- Retry & Delete chat turn command were not properly removing corresponding messages from the at history
- Tokens count from chat panel not always recorded in Tokens count dialog
- "Include children" in prompt wasn't working reliably
- Topbar buttons were hiding back/forward arrows in Roam desktop app
- "Chat with [assistant header]" was not parsed from #liveai/chat titles
- Always default model name was displayed when inserting chat in Roam blocks

## v.26 (December 10th, 2025) Fixes

**Fixes**

- Voice transcription was broken in the previous version!
- Just after updating Google API Key, Gemini models were not accessible

**Limitation**

- DeepSeek endpoint CORS policy has changed and doesn't work anymore from frontend like other OpenAI compatible models. So i've temporarily made DeepSeek model unavailable from the models menu. DeepSeek models can still be used via OpenRouter.

## v.25 (November 25th, 2025) Better multimodal support

**New features**

- Audio and Video analysis with Gemini models
- Audio file transcription with OpenAI or Gemini models

**Updates**

- New models support: Gemini 3 Pro and Nano banana Pro, Claude Opus 4.5
- Drag & drop block(s) to Chat panel to add them to the context
- Pdf, image, audio, video and web search supported in Chat panel
- Direct image edition (with Nano banana) in child block or in chat
- Added an option to hide thinking process of reasoning models

**Fixed**

- In Chat context: page content was truncated (now: only if exceeding context window)
- More reliable blocks or pages mention in LLM responses in chat + click on page open it, click on block copy it to clipboard
- When using addToContext tool, chat agent was unable to instantly rely on added nodes
- Disabling all tools was still not persistent (addToContext was always enabled by default)

## v.24 (November 15th, 2025) Critical fixes

**Updates**

- Chat with linked references button: now apply the existing filters
- Chat agent system prompt optimization: 50% less tokens when no tools, approx. 20% less with tools

**Fixed**

- ⚠️ Wrong designed CSS rules were causing general slowdown of Roam since v.22 ⚠️
- Disabling all tools of the chat agent was not persisting between session
- It's now possible to scroll when LLM is streaming its response
- Adding successive "current page" from Content selector now works
- "chat" target in Context menu trigger the LLM response in chat

## v.23 (November 13th, 2025) Small fixes

**Updates**

- GPT-5.1 and Grok-4-fast support
- `addToContext` tool replace `addPages...` and `addLinkedRef...` tools in Chat agent (support add blocks by ref, current page, sidebar...)
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
