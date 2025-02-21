## 1) Voice transcription

You need either an account on OpenAI to benefit from Whisper transcriptions, or a Groq one since you can define Groq as default provider for the audio transcription model and user the powerful `whisper-large-v3` model.

⚠️ _Currently, voice recording isn't possible on either the MacOS desktop app or the Mobile app : microphone is not yet supported, so vocal notes transcription can't be achieved. But all commands relying only on text (like AI completion or post-processing) are available. The extensions works properly on all browsers (desktop and mobile, MacOs, iOS, Windows or Android) and on Windows desktop app._

- the transcribed text will be inserted by default at the **bottom of the current page** (or page view) or **appended to the current focused block** (so exactly where you want, you have just to place the cursor anywhere just before clicking the button or running the transcription command).
- by default, the language should be automatically detected, but you can specify it for better results, using the [ISO 639-1 codes](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)
- You can specify a list of words to be spelled in a specific way (e.g. proper nouns, acronyms, technical terms, etc.), see the Whisper prompt option in the settings.
- if you have not entered any OpenAI API Key or Groq API Key, or if you disable Whisper, the free Web Speech API will be used to transcribe audio (⚠️ not available in Electron Desktop app and Firefox or Arc browser)

### Direct translation of vocal recording

A large number of [source languages are supported](https://platform.openai.com/docs/guides/speech-to-text/supported-languages), but the target language is currently limited to English. This limitation can be easily overcome through post-processing using a generative AI, as it only requires asking it to translate into almost any language.

## 2) Built-in prompts

## 3) Custom prompts

## 4) Custom styles

## 5) SmartBlocks commands

You can insert the following commands in your SmartBlocks template to use or run Live AI Assistant directly from your templates:

### <%SPEECHTOROAM%>

**Purpose**: start recording a vocal note in a specific context.

**Example**: `<%SPEECHTOROAM%><%CURSOR%>`

The SmartBlock button will be `{{🎙️:SmartBlock:Speech-to-Roam}}` (can be used once), or to have a permanent button in a given block, and automatically insert the transcription in the children blocks: `{{🎙️:SmartBlock:Speech-to-Roam:RemoveButton=false}}`

### <%LIVEAIGEN:prompt,context,target,model,context levels,context uids%>

**Purpose**: text generation following a given prompt (from one or multiple block(s)) and context

**Parameters**: (all optional)

1. Prompt: text (without comma, or escaped with `\`) or `{current}` block content or block reference in `uid` or `((uid))` format or list of block refs separated by a `+`: `{uid1+uid2+...}` between brackets. Default: {current}
2. Context or content to apply the prompt to: text or `{current}` block content or block reference or `[[page title]]` (context will be page content + linked references) or a list, between braces, of the following possible contexts, separated by any character except a comma (e.g.: {page+sidebar}):
   - `{uid1+uid2+...}` or `{block(uid1+uid2+...)}`: a list of block references in `uid` or `((uid))` format (only the second syntax can be used in combination with with other elements to add to the context)
   - `{sidebar}`: all the content (including children blocks) of the right sidebar.
   - `{page}` or `{page([[title1]]+[[title2]]+...)}`: the current page view in the main window or the specified list of pages between parentheses separated by `+`, title with or without brackets.
   - `{ref}` or `{ref([[title1]]+[[title2]]+...)}` or `{linkedRefs}`: the current page linked references or the linked references of the specified list of pages.
   - `{log(nb)}` or `{logPages(nb)}`: the daily log, with 'nb' for the number of last DNP to include from the current date or the current DNP.
3. Block reference of the target block (in `uid` or `((uid))` format), where the response will be inserted (Default: new direct child block) or one of the following instruction, only usefull for short response (not parsed in multiple blocks):
   - `{replace}`: replace the current block content, preceded by the assistant name (as defined in role setting)
   - `{replace-}`: replace the current block content, without assistant name, only the response
   - `{append}`: append the response to the current block content
4. AI model to query: exact model ID from OpenAI or Anthropic, or `claude-sonnet-3.5`, `claude-haiku-3.5` or `claude-haiku`, or `openRouter`, `groq`, `ollama` for first model using these APIs, or the exact model ID after `openRouter/`, `groq/` or `ollama/`. Default: default model defined in extension settings.
5. Levels within the linked references or DNP to include in the context: number, default fixed in settings.
6. Insert or not ((uid)) of each block in the context: `true` or `false` or nb of levels to insert block refs from. Default: default defined in extension settings.

**Examples**:

`<%LIVEAIGEN:Summarize the content provided in context,{current},{append}%>` => text prompt applied to the current block content, AI response appended to the current block content.

`<%LIVEAIGEN:{((cSoBrilIU))+((Iuq6UTY5C))},[[my last article]],,,4%>` => prompt in the first referenced block (and children) and instructions (for example about the output format) in the second referenced block, will be applied to the content of 'my last article' page and all its linked references (including up to the 4 levels).

### <%LIVEAITEMPLATE:template,context,target,model,template levels,context levels,context uids%>`

**Purpose**: response exactly following the provided template, where each block provides instructions and will be the sole receptacle for the response to those instructions. If you want a block in the template to not be used as a prompt but only reproduced identically as a text, add `{text}` in the block.

**Parameters**: (all optional)

1. Template: block reference of the parent block of the template, or `{children}` blocks. Default: {children}.
2. Context or content to apply the templated prompt to: text or `{current}` block content or block reference, or a list of block references `{uid1+uid2+...}` or a list, between braces, of the following possible contexts, separated by any character except a comma: `{sidebar}`, `{block(uid1+...)`, `{page(title1+...)}`, `{ref(title1+...)}`, `{log(nb)}` (see above in LIVEAIGEN command for details) NB: the current block content is always included in the context (as a way to provide some instruction to the AI model on how to complete the template).
3. Block reference of the target block (in `uid` or `((uid))` format), where the templated response will be inserted. Default: first child of the current block
4. AI model to query (see above in LIVEAIGEN command for details)
5. Levels within the linked ref or DNP to include in the context: number. Default fixed in extension settings.
6. insert or not ((uid)) of each block in the context: `true` or `false` or nb of levels to insert block refs from. Default: default defined in extension settings.

**Examples**:

`<%LIVEAITEMPLATE:((kCa_QzkZh)),{ref(my last article)},,gpt-4o,,4,true%>` => following the mentionned template, use all the linked references to [[my last article]] as context (for example to extract some key points), insert the template by default as direct children, use gpt-4o as model, copy all the levels of the template, limit to 4 levels in the linked references and insert before each block its ((uid)), so some of these blocks can be quoted (or referenced as 'source block') in the AI response.

NB: To complete the context used in these SmartBlocks, you can also select some blocks with the single block multiselect feature (native) (Warning: the basic blue multi-select will not work, because running a SmartBlock cancel the selection)
