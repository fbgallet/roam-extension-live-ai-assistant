# Live AI Assistant (former Speech-to-Roam)

### Reliable voice transcription using Whisper API and vocal or text prompts to an AI assistant with easy-to-define context and templated post-processing, using GPT or Claude models.

### 🆕 New in v.4:

- Claude AI models support
- Straightforward UI for text-only prompts to AI assistant with easy-to-define context
- Context menu for easily switching models and compare their answers
- Streamed responses: no more waiting time before reading the AI assistant response, and possibility to interrupt it (GPT models only)

See changelog [here](https://github.com/fbgallet/roam-extension-speech-to-roam/blob/main/CHANGELOG.md) for a more complete list of the updates and fixes.

<img width="1130" alt="Speech-to-Roam Visual" src="https://github.com/fbgallet/roam-extension-speech-to-roam/assets/74436347/e4e54f87-0af6-4406-b566-dff9959d00af">

## **GETTING STARTED**

### Provoide API Keys

To use voice transcription and GPT models, provide an OpenAI API key (by copying/pasting an existing key or generating a new one via [this link](https://platform.openai.com/api-keys)). You need an account on OpenAI to benefit from Whisper transcriptions, and a payment method has to be defined in API > Settings > Billing > [Payment methods](https://platform.openai.com/account/billing/payment-methods).

⚠️ _OpenAI API is a paid service_. See API usage fees section at the bottom of this documentation.

NB: API usage fees should not be confused with the ChatGPT Plus subscription; they are strictly separate. You do not need the ChatGPT plus subscription to use Live AI Assistant.

To use Claude models, provide your Anthropic API key (by copying/pasting an existing key or generating a new one via [this link](https://console.anthropic.com/settings/keys)).

⚠️ Be aware that your data (your API key, your prompt, and the selected context) are sent to Anthropic API via a remote server that I had to set up to communicate with the API from Roam (which is not necessary for the OpenAI API). The code of this server is open source and can be viewed [here](https://github.com/fbgallet/ai-api-back). Your data is not stored on the server; it is sent directly to the Anthropic API.

## Your first prompt to Live AI Assistant

Just press the microphone button and provide vocal instructions, or place the cursor focus in a block where you have written your prompt, then click on the AI completion button (OpenAI Logo). That's all !

You can easily compare AI models responses: right click on 'Generate a response again' button `⟳` appearing on the right of the AI response and choose another model. The new response will be inserted just above the first one.

<img width="1050" alt="compare AI models" src="https://github.com/fbgallet/roam-extension-speech-to-roam/assets/74436347/296a0a66-77d4-4ebd-98c8-e707503125f7">


### **Keyboard hotkeys** (⚠️ available only when the voice recording has been started by a mouse click):

- Pause/Resume: `Spacebar`
- Stop and rewind: `Escape` or `Backspace`
- Transcribe: `T or Enter`
- Translate (in English): `E`
- AI Completion of vocal or text prompt: `C`
- Template-based Post-processing: `P`

### **Commands** (in command palette - I recommand to set up hotkeys for them)

Trigger controls concerning vocal notes:

- Start/Pause recording your vocal note
- Transcribe your vocal note
- Translate to English
- Transcribe & send as prompt to AI assistant
- Transcribe & send as content for templated-based AI post-processing

Keyboard-only (no vocal) interactions with the AI assistantAI features and other commands:

- (text) AI completion of focused block as prompt & selection as context
- (text) template-based AI post-processing, children as prompt template & focused block as content
- Redo last AI completion (update response)
- Toggle visibility of the button (not permanently) => if hidden, the controls will only appear during the recording, which will necessarily be initiated by the above command

A SmartBlock command is also provided: `<%SPEECHTOROAM%>`, see the example of SmartBlock at the end of this doc.

## **DETAILED INSTRUCTIONS**

## Voice transcription

⚠️ _Currently, voice recording isn't possible on either the MacOS desktop app or the Mobile app : microphone is not yet supported, so vocal notes transcription can't be achieved. But all commands relying only on text (like AI completion or post-processing) are available. The extensions works properly on all browsers (desktop and mobile, MacOs, iOS, Windows or Android) and on Windows desktop app._

- the transcribed text will be inserted by default at the **bottom of the current page** (or page view) or **appended to the current focused block** (so exactly where you want, you have just to place the cursor anywhere just before clicking the button or running the transcription command).
- by default, the language should be automatically detected, but you can specify it for better results, using the [ISO 639-1 codes](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)
- You can specify a list of words to be spelled in a specific way (e.g. proper nouns, acronyms, technical terms, etc.), see the Whisper prompt option in the settings.
- if you have not entered any OpenAI API Key, or if you disable Whisper, the free Web Speech API will be used to transcribe audio (⚠️ not available in Electron Desktop app and Firefox or Arc browser)

## Translation

A large number of [source languages are supported](https://platform.openai.com/docs/guides/speech-to-text/supported-languages), but the target language is currently limited to English. This limitation can be easily overcome through post-processing using a GPT model, as it only requires asking it to translate into almost any language.

## AI Assistant (OpenAI GPT models and Anthropic Claude models)

- ask any question (by speaking or writing, focusing on a block or selecting one or more blocks as prompt), rephrasing, completion, translation... The more precise your instructions are (especially with examples and context), the more accurate and satisfying the responses will be.
- assistant response is inserted as child of prompt block (by default, the answer is splitted in as many blocks as it contains paragraphs. There is an option to always limit the response to a block.). The assistant name is inserted before its response and include by default the AI model name. The template can be changed in the settings.
- 🆕 in v.4: subtle buttons appear to the right of the first block of the assistant's response. They allow to stop the streamed response (for GPT models only), to generate again the response (possibly with a different AI model by selecting it from the context menu accessed by right-clicking) and to copy the response to clipboard. These are temporary buttons that disappear when changing the page or if the block is collapsed.

- you can easily **provide context** to your prompt, to process the information contained in this context (e.g. to summarize it or have a conversation with your own notes 🚀) or to provide resources to the AI for the required text generation:

  - Since v.3: main UI elements of Roam can easily be designated as the context using key modifiers when clicking on the AI assistant buttons:
    - `Command/Control`: use linked references (backlinks) of the current page or, if the page is a DNP or the daily notes log (journal), the previous DNP. Important limitation for linked refs: currently, the applied filters (including or excluding some reference) are not taken into account.
    - `Alt`: use the whole main page (more precisely: its current zoomed view) as context
    - `Shift`: use all the content in the right sidebar (pages, blocks, linked references)

  ⚠️ Attention, be aware that using linked refs or DNPs as context can easily reach the model's maximum token limit and quickly become costly. I highly recommend combining multiple questions or instructions into a single request, as the entire context needs to be sent with each request. That can be facilitated by the template-based prompt functionality presented below. To reduce costs and increase the usable context window, the following options can be configured:

  - default number of previous DNPs (default is 7)
  - maximum block depth level, distinctively defined for pages, linked refs, and DNPs (default is no limit for page, and limit to 2 levers for linked refs and 3 for DNPs)
  - maximum level where block references (uid) are copied in the context sent to the AI assistant (so he can refer to them, make some citaiton...). When many blocks have very brief content, the ((uid)) occupies a significant proportion of space in the context. (default: not limit for pages, limit to 1 and 2 levels for linked refs and DNPs)
  - blocks (and their children) to exclude if they contain a given string (like a tag `#private`)
  - ⚠️ with the current pricing (02-2024), each request that reaches the token limit for GPT-3.5 cost $0.08, but up to $1.30 with GPT-4 !

- for a more "surgical" defined context, simply select the required blocks. Using the native multi-select blocks feature to choose multiple separate blocks. The selection can be done before recording or updated just before sending the transcription to the GPT model. The block content of the initial focused block provide the initial context if no selection is made subsequently. As for simple transcription, the focused block right before completion is the target where your prompt and the answer will be inserted.

- the context provided by selected blocks is handled with the following instructions (you can add your own instructions, see settings):

  > _"Below is the context of your response, it can consist of data to rely on, a conversation to be continued, or other instructions, depending on the user's prompt. The user can refer to it as 'these blocks' or 'the selected blocks' among other possibilities. The ((9-characters code)) within double parentheses preceding each piece of content (or block) in the context is its id in the database and is called 'block reference'. In your response, you can refer to an existing block reference (and only existing one) if needed, using the syntax [*](((9-characters code))) to refer to it as a note or citation. Example: [\*](<((kVZwmFnFF))>). If you need reproduce the entire and exact content of a block in your response, only put its ((9-characters code)) instead, but it's preferable to prioritize a citation with [*](((9-char code))) syntax most of the time. Expressions within double brackets such as [[my page]] or preceded by a '#' like #tag or #[[my tag]] should be reused with the exact same syntax as in the source text, keeping the original double brackets and/or hashtag: e.g. [[my page]], #tag, #[[my tag]]."_

- on mobile (selection being not possible), place the cursor in a block to use its content as context, or enable the option to use the whole current view as context (unless you place the cursor in a blank block). You can also insert in a block a command to define the context, see below the section "Keyboard & text only AI completion and post-processing".
- you can customize the AI assistants's "character", its default character is defined this way (you can add your own definition of its character, see settings):

  > _"You are a smart, rigorous and concise assistant. You always respond in the same language as the user's prompt unless specified otherwise in the prompt itself."_

- model by default is currently `gpt-3.5-turbo` (pointing to the latest model version). You can change the default model or, 🆕 in v.4, choose any other model (among GPT 4 and Claude models) for each request by right-clicking on the completion button (just like for Post-processing button and Generate again button)
- you can try other chat completion model, or your own fine-tuned models (only OpenAI chat completion).

## AI Post-processing of vocal notes following your templates

- You can ask your AI assistant to follow a template composed of a set of blocks and children, each containing instructions, placeholders, or questions. The AI assistant's response will be inserted into these different blocks ! This feature is experimental, it often requires several attempts and more specific instructions for the result to be entirely satisfactory.
- Here's how to proceed:
  1. create a prompt template anywhere in your graph. (consider using the native `/Template` command, but it's not required)
  2. insert a copy of the template (eventualy with `;;` command) as a child of a given block.
  3. then place your cursor in this block (the parent of the template), and record your voice note,
  4. click on the post-processing button (after optionally specifying the context)
     => the template will be automatically filled in (this may take time depending on the amount of information to process).
- You can specify a default template in the settings. It will be automatically inserted as child of the focused block when you run post-processing if there is currently no child. Copy the block reference of the root block of your template. The root or parent block is only the title, it will not be inserted nor used as an instruction. If no user default template is defined, a predefined template will be used, just try it !

## Keyboard & text only AI completion and post-processing

You can also use AI assistant feature without vocal note, just using text content of some blocks in your graph and the dedicated command in command palette (see above).

- Focus your cursor in a block and run one of the AI completion command:
  - the content of the focused block will be used as prompt and the AI response will be inserted as child blocks, if you run the simple completion command,
  - the children structure will be used as prompt template, and the focused block as specific content to apply to the template, if your run the post-processing command
- You can define the context with the following command, notifying one or more of the following items: `((context: linkedRefs, sidebar, mainPage, logPages))`.
  - `logPages` means daily log. You can specify the number of DNP to take process (a default limit is fixed to 7 in the settings), this way: `((context: logPages(31)))`.
- You can specify which template to use without having to copy it into the child blocks, using this command (or a block reference to this command), mentionning the block ref. of the root block of the template: `((template: ((block-reference))))`.
- You can relauch the last AI completion. If no block is focused or if it was template-based post-processing, the new response will replace the precedent response. If a block is focused and it was a simple completion, the new response will be inserted in the focused block.

### Using the SmartBlock command

You can insert `<%SPEECHTOROAM%>` command in your SmartBlocks template (using the corresponding extension) to start recording a vocal note in a specific context. You can for example create a very simple SmartBlock and call it with a button:

```
- #SmartBlock Speech-to-Roam
    - <%SPEECHTOROAM%><%CURSOR%>
```

The SmartBlock button will be `{{🎙️:SmartBlock:Speech-to-Roam}}` (can be used once), or to have a permanent button in a given block, and automatically insert the transcription in the children blocks: `{{🎙️:SmartBlock:Speech-to-Roam:RemoveButton=false}}`

### API usage fees

Moderate but regular use should only cost a few tens of cents per month (costs may increase if you use GPT-4 (default is GPT-3.5), think to set a maximum monthly limit). You can check the detailed daily cost of your usage of Whisper and other OpenAI models [here](https://platform.openai.com/usage), update is almost instantaneous.

_OpenAI Whisper API pricing:_

- `$0.006/minute` (rounded to the nearest second)

To give you an idea, using Whisper for 10 minutes a day for a month equates to 1.80 $

_OpenAI GPT API pricing:_

The prices are for 1000 tokens. For comparison, this documentation is equivalent to about 3500 tokens (2000 words).

- gpt-3.5-turbo (16k context)
  - Input: `$0.0005` / 1K tokens
  - Output: `$0.0010` / 1K tokens
- gpt-4-turbo-preview (128k context)
  - input: `$0.01` / 1K tokens
  - output: `$0.03` / 1K tokens

See updated OpenAI API pricing [here](https://openai.com/pricing).

_Claude API pricing:_

- Haiku:
  - Input: `$0.00025` / 1K tokens
  - Output: `$0.00125` / 1K tokens
- Sonnet
  - input: `$0.003` / 1K tokens
  - output: `$0.015` / 1K tokens
- Opus
  - input: `$0.015` / 1K tokens
  - output: `$0.075` / 1K tokens

See updated Anthropic Claude API pricing [here](https://www.anthropic.com/api).

---

### For any question or suggestion, DM me on **Twitter** and follow me to be informed of updates and new extensions : [@fbgallet](https://twitter.com/fbgallet).
