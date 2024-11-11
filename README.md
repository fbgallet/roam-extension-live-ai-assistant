# Live AI Assistant (former Speech-to-Roam)

### Voice transcription and AI Assistant supporting text, voice or images as prompt. Easy-to-define context and templated post-processing for response structured exactly as you want. Support up-to-date GPT or Claude models, and most of existing models through OpenRouter and local models through Ollama.

### 🆕 New in v.11:

- New versions of Claude 3.5 Sonnet and Haiku (training data cut-off: Apr 2024 and July 2024)
- New SmartBlocks commands to run Live AI assistant from your templates: LIVEAIGEN and LIVEAITEMPLATE (see ["Using the SmartBlock commands" section](https://github.com/fbgallet/roam-extension-speech-to-roam?tab=readme-ov-file#using-the-smartblocks-commands))
- `{text}` keyword to insert in any block of a template that should not be processed as a part of the prompt, but only as text.

### 🆕 New in v.10:

- possibility to customize baseURL for OpenAI API, and add OpenAI models (like o1-preview or your own fine-tuned ones)
- GPT-4o is now 50% cheaper

(See changelog [here](https://github.com/fbgallet/roam-extension-speech-to-roam/blob/main/CHANGELOG.md))

![Live AI Demo 3](https://github.com/fbgallet/roam-extension-speech-to-roam/assets/74436347/fc35b01c-3172-4763-a4a2-2aa23e290dd9)

Controls including vocal transcription:

<img width="1130" alt="Formes 24 avril 17h45" src="https://github.com/fbgallet/roam-extension-speech-to-roam/assets/74436347/d4ab0756-2f55-4226-9cdd-758ec5ac5f1b">

## **GETTING STARTED**

### Provide API Keys

- To use voice transcription and GPT models, provide an OpenAI API key (by copying/pasting an existing key or generating a new one via [this link](https://platform.openai.com/api-keys)). You need an account on OpenAI to benefit from Whisper transcriptions, and a payment method has to be defined in API > Settings > Billing > [Payment methods](https://platform.openai.com/account/billing/payment-methods). OpenAI API usage is a paid service, see API usage fees section at the bottom of this documentation.

NB: API fees should not be confused with the ChatGPT Plus subscription; they are strictly separate. You do not need the ChatGPT plus subscription to use Live AI Assistant.

- To use Claude models, provide your Anthropic API key (by copying/pasting an existing key or generating a new one via [this link](https://console.anthropic.com/settings/keys)).

- To use [other existing models](https://openrouter.ai/docs#models), you can provide an OpenRouter API Key or a Groq API Key. You can define OpenRouter as your default model provider or use it as a complement to direct access to OpenAI and Anthropic API. Using Groq, you can also replace default Whisper model by `whisper-large-v3` model!

- To use local models with Ollama, see 'Use Ollama to run local models' section below.

## Your first prompt to Live AI Assistant

Just press the microphone button and provide vocal instructions, or place the cursor focus in a block where you have written your prompt, then click on the AI completion button (OpenAI Logo). That's all !

You can easily use **structured prompts** by selecting multiple blocks (including images with models supporting image recognition). Create your own Roam template to have a set of ready-to-use advanced prompts !

You can easily **add context** to your prompt: by pressing `Shift` while clicking on the AI completion button, all the content in the sidebar will be sent as context (for example, ask to resume some content provided in the context). See 'AI Assistant' section below for more details and possibilities about context.

You can easily **compare AI models** responses: right click on 'Generate a response again' button `⟳` appearing on the right of the AI response and choose another model. The new response will be inserted just above the first one.

## Chat with your AI Assistant

You can easily continue any conversation with an AI Assistant:

![Live AI chat demo 2](https://github.com/user-attachments/assets/db9582f1-9db5-4c21-954a-eab5a21aa030)

- click on the conversation icon on the right of the last AI response block (if generated recently) or simply insert a block as next sibling of an AI response block (the one that contains it's role description, provided in settings, by default: `AI Assistant (<model>):`). It is not necessary to insert your role (such as "Me:") but more convenient in terms of readability.
- write or dictate your prompt (it can include children blocks),
- click on the button to continue the conversation or run the usual AI completion command.

Previous messages (including children blocks) will be automatically taken into account. About the context:

- with the conversation button, the context remains the same as that defined in the first prompt
- with usual AI completion command (button or command palette), the context needs to be redefined at each turn of the conversation, allowing you to modify or ignore it.

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
- if you have not entered any OpenAI API Key or Groq API Key, or if you disable Whisper, the free Web Speech API will be used to transcribe audio (⚠️ not available in Electron Desktop app and Firefox or Arc browser)
- if you have entered a Groq API Key, you can define Groq as default provider for the audio transcription model, user the powerful `whisper-large-v3` model.

## Translation

A large number of [source languages are supported](https://platform.openai.com/docs/guides/speech-to-text/supported-languages), but the target language is currently limited to English. This limitation can be easily overcome through post-processing using a GPT model, as it only requires asking it to translate into almost any language.

## AI Assistant (OpenAI GPT models, Anthropic Claude models and other models throught OpenRouter or Ollama server)

- ask any question (by speaking or writing, focusing on a block or selecting one or more blocks as prompt), rephrasing, completion, translation... The more precise your instructions are (especially with examples and context), the more accurate and satisfying the responses will be.
- assistant response is inserted as child of prompt block (by default, the answer is splitted in as many blocks as it contains paragraphs. There is an option to always limit the response to a block.). The assistant name is inserted before its response and include by default the AI model name. The template can be changed in the settings.
- 🆕 in v.4: subtle buttons appear to the right of the first block of the assistant's response. They allow to stop the streamed response, to generate again the response (possibly with a different AI model by selecting it from the context menu accessed by right-clicking) and to copy the response to clipboard. These are temporary buttons that disappear when changing the page or if the block is collapsed.

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

- on mobile (selection being not possible), place the cursor in a block to use its content as context, or enable the option to use the whole current view as context (unless you place the cursor in a blank block). You can also insert in a block a command to define the context, see below the section "Keyboard & text only AI completion and post-processing".

- you can customize the AI assistants's "character", its default character is defined this way (you can add your own definition of its character, see settings):

  > _"You are a smart, rigorous and concise assistant. You always respond in the same language as the user's prompt unless specified otherwise in the prompt itself."_

- model by default is currently `gpt-4o-mini` (pointing to the latest model version). You can change the default model or choose any other model (among GPT 4 and Claude models) for each request by right-clicking on the completion button (just like for Post-processing button and Generate again button)
- you can try other chat completion model, or your own fine-tuned models (only OpenAI chat completion).

## AI Post-processing following exactly your templates structure

- You can ask your AI assistant to follow exactly a template composed of a set of blocks and children, each containing instructions, placeholders, or questions. The AI assistant's response will be inserted into these different blocks, fitting exactly the requested output.
- Here's how to proceed:
  1. create a prompt template anywhere in your graph. (consider using the native `/Template` command, but it's not required)
  2. insert a copy of the template (eventualy with `;;` command) as a child of a given block or insert the block reference of the template following this syntax: `((template: ((block-reference))))`.
  3. then place your cursor in this block (the parent of the template), and write some information to be processed following the template, or some instructions, or record your voice note (that will be "post-processed" following the template),
  4. click on the post-processing button (after optionally specifying the context)
     => the template will be automatically filled in (this may take time depending on the amount of information to process).
- Some blocks of the context can be excluded of the prompt and only used as text: just insert `{text}` in the corresping blocks
- You can specify a default template in the settings. It will be automatically inserted as child of the focused block when you run post-processing if there is currently no child. Copy the block reference of the root block of your template. The root or parent block is only the title, it will not be inserted nor used as an instruction. If no user default template is defined, a predefined template will be used, just try it !

## Use models throught OpenRouter

OpenRouter is an unified API routing requests to [wide range of models](https://openrouter.ai/docs#models). The benefit is having a single account to access to most of existing and up-to-date models. You pay as you go: after purchasing credit (you can test without credit), your credit is debited on each request. OpenRouter also offers a continuously updated [ranking](https://openrouter.ai/rankings) of the most popular models.

In the settings, provide the list of IDs of the models you want to use in LiveAI. They will appear in the context menu in a dedicated section or replace the native models if you check the corresponding option. The first model in your list can be selected as your default model.

By default, logging of your inputs & outputs in OpenRouter's settings is enabled, you can disable it from your OpenRouter account.

## Use Ollama to run local models

[Ollama](https://ollama.com/) allows you to run local models like Llama3, so all your data shared with the AI assistant is processed entirely locally and is not sent to a third party like OpenAI or Anthropic. (Please note: a local model is typically slower than a remote model and requires a machine with a lot of RAM. E.g a 7B model may require 7GB of RAM to work properly)
Install Ollama, install a model (ex. `ollama run llama3`), add the model name in the settings above (e.g. `llama3`), and follow the instructions below:

To use Ollama in Roam, you have also to set OLLAMA_ORIGINS environment variable to `https://roamresearch.com` (by default, Ollama CORS is restricted to local origins). See [Ollama documentation here](https://github.com/ollama/ollama/blob/main/docs/faq.md#how-do-i-configure-ollama-server) or proceed this way, according to your operating system:

### on MacOS

- Edit `~/.zshrc` file and add `export OLLAMA_ORIGINS="https://roamresearch.com"` command. The environment variable will be set at OS startup or when opening the zsh terminal. (To edit a file, open the terminal and run a text editor, e.g. `nano ~/.zshrc`. Save changes with Ctrl+x, Y and Enter). Close and open again the terminal. (You can also set this variable temporarily using the command `launchctl setenv OLLAMA_ORIGINS "https://roamresearch.com"` and restart the terminal)
- Then, stop Ollama.app and run "ollama serve" in the terminal

⚠️ In my experience, MacOS Ollama.app doesn't take into account OLLAMA_ORIGINS variable change. After Ollama installation, Ollapa.app will be loaded in the background. You need to close it (using, e.g., the activity monitor), then launch "ollama serve" from the terminal. It may also be necessary to disable the automatic startup of Ollama.app when your OS starts by going to System Preferences > General > Startup > Open at login: select Ollama.app and click on the minus sign (-).

### on Windows

- Close Ollama app (with Task manager).
- Open the Control Panel and navigate to “Edit system environment variables.”
- Choose to edit or create a new system environment variable named OLLAMA_ORIGINS and define it to `https://roamresearch.com`
- Apply the changes and close the control panel.
- Run 'ollama serve' from a new terminal window to ensure it picks up the updated environment variables. If ollama serve return an error message, it probably means that you have to stop Ollama app running in the background (with Task manager).

### on Linux

- Run `systemctl edit ollama.service` to open the service file in an editor.
- In the `[Service]` section, add: `Environment="OLLAMA_ORIGINS=https://roamresearch.com"`
- Save your changes, then reload systemd and restart Ollama with: `systemctl daemon-reload` and `systemctl restart ollama` commands

## Keyboard & text only AI completion and post-processing

You can also use AI assistant feature without vocal note, just using text content of some blocks in your graph and the dedicated command in command palette (see above).

- Focus your cursor in a block and run one of the AI completion command:
  - the content of the focused block will be used as prompt and the AI response will be inserted as child blocks, if you run the simple completion command,
  - the children structure will be used as prompt template, and the focused block as specific content to apply to the template, if your run the post-processing command
- You can define the context with the following command, notifying one or more of the following items: `((context: linkedRefs, sidebar, mainPage, logPages))`.
  - `logPages` means daily log. You can specify the number of DNP to take process (a default limit is fixed to 7 in the settings), this way: `((context: logPages(31)))`.
- You can specify which template to use without having to copy it into the child blocks, using this command (or a block reference to this command), mentionning the block ref. of the root block of the template: `((template: ((block-reference))))`.
- You can relauch the last AI completion. If no block is focused or if it was template-based post-processing, the new response will replace the precedent response. If a block is focused and it was a simple completion, the new response will be inserted in the focused block.

## Using the SmartBlocks commands

You can insert the following commands in your SmartBlocks template to use or run Live AI Assistant directly from your templates:

### <%SPEECHTOROAM%>

**Purpose**: start recording a vocal note in a specific context.

**Example**: `<%SPEECHTOROAM%><%CURSOR%>`

The SmartBlock button will be `{{🎙️:SmartBlock:Speech-to-Roam}}` (can be used once), or to have a permanent button in a given block, and automatically insert the transcription in the children blocks: `{{🎙️:SmartBlock:Speech-to-Roam:RemoveButton=false}}`

### <%LIVEAIGEN:prompt,context,target,model,context levels,context uids%>

**Purpose**: text generation following a given prompt (from one or multiple block(s)) and context

**Parameters**: (all optional)

1. Prompt: text or `{current}` block content or block reference in `uid` or `((uid))` format or list of block refs separated by a `+`: `{uid1+uid2+...}` between brackets. Default: {current}
2. Context or content to apply the prompt to: text or `{current}` block content or block reference or `[[page title]]` (context will be page content + linked references) or a list, between braces, of the following possible contexts, separated by any character except a comma (e.g.: {page,sidebar}):
   - `{uid1+uid2+...}` or `{block(uid1+uid2+...)}`: a list of block references in `uid` or `((uid))` format (only the second syntax can be used in combination with with other elements to add to the context)
   - `{sidebar}`: all the content (including children blocks) of the right sidebar.
   - `{page}` or `{page([[title]])}` or `{mainPage}`: the current page view in the main window or the specified page between parentheses.
   - `{ref}` or `{ref([[title]])}` or `{linkedRefs}`: the current or specified page linked references.
   - `{log(nb)}` or `{logPages(nb)}`: the daily log, with 'nb' for the number of last DNP to include from the current date or the current DNP.
3. Block reference of the target block (in `uid` or `((uid))` format), where the response will be inserted (Default: new direct child block) or one of the following instruction, only usefull for short response (not parsed in multiple blocks):
   - `{replace}`: replace the current block content, preceded by the assistant name (as defined in role setting)
   - `{replace-}`: replace the current block content, without assistant name, only the response
   - `{append}`: append the response to the current block content
4. AI model to query: exact model ID from OpenAI or Anthropic, or `claude-sonnet-3.5`, `claude-haiku-3.5` or `claude-haiku`, or `openRouter`, `groq`, `ollama` for first model using these APIs, or the exact model ID after `openRouter/`, `groq/` or `ollama/`. Default: default model defined in extension settings.
5. Levels within the linked references or DNP to include in the context: number, default fixed in settings.
6. Insert or not ((uid)) of each block in the context: `true` or `false` or nb of levels to insert block refs from. Default: default defined in extension settings.

**Examples**:

`<%LIVEAIGEN:Summarize the content provided in context,{current},{append}` => text prompt applied to the current block content, AI response appended to the current block content

### <%LIVEAITEMPLATE:template,context,target,model,template levels,context levels,context uids%>`

**Purpose**: response exactly following the provided template, where each block provides instructions and will be the sole receptacle for the response to those instructions. If you want a block in the template to not be used as a prompt but only reproduced identically as a text, add `{text}` in the block.

**Parameters**: (all optional)

1. Template: block reference of the parent block of the template, or `{children}` blocks. Default: {children}.
2. Context or content to apply the templated prompt to: text or `{current}` block content or block reference or a list, between braces, of the following possible contexts, separated by any character except a comma: `{sidebar}`, `{page(title)}`, `{ref(title)}`, `{log(nb)}` (see above in LIVEAIGEN command for details)) NB: the current block content is always included in the context (as a way to provide some instruction to the AI model on how to complete the template).
3. Block reference of the target block (in `uid` or `((uid))` format), where the templated response will be inserted. Default: first child of the current block
4. AI model to query (see above in LIVEAIGEN command for details)
5. Levels within the template to include: number. Default: all.
6. Levels within the linked ref or DNP to include in the context: number. Default fixed in extension settings.
7. insert or not ((uid)) of each block in the context: `true` or `false` or nb of levels to insert block refs from. Default: default defined in extension settings.

**Examples**:

`<%LIVEAITEMPLATE:((kCa_QzkZh)),{ref(my last article)},,gpt-4o,,4,true%>` => following the mentionned template, use all the linked references to [[my last article]] as context (for example to extract some key points), insert the template by default as direct children, use gpt-4o as model, copy all the levels of the template, limit to 4 levels in the linked references and insert before each block its ((uid)), so some of these blocks can be quoted (or referenced as 'source block') in the AI response.

NB: To complete the context used in these SmartBlocks, you can also select some blocks with the single block multiselect feature (native) (Warning: the basic blue multi-select will not work, because running a SmartBlock cancel the selection)

## API usage fees

Moderate but regular use should only cost a few tens of cents per month (costs may increase if you use GPT-4 (default is GPT-3.5), think to set a maximum monthly limit). You can check the detailed daily cost of your usage of Whisper and other OpenAI models [here](https://platform.openai.com/usage), update is almost instantaneous.

_OpenAI Whisper API pricing:_

- `$0.006/minute` (rounded to the nearest second)

To give you an idea, using Whisper for 10 minutes a day for a month equates to 1.80 $

_OpenAI GPT API pricing:_

The prices are for 1000 tokens. For comparison, this documentation is equivalent to about 3500 tokens (2000 words).

- gpt-4o-mini (128k context) (**cheapest model**)
  - input: `$0.00015` / 1K tokens
  - output: `$0.0006` / 1K tokens
- gpt-4o (128k context)
  - input: `$0.0025` / 1K tokens
  - output: `$0.010` / 1K tokens
- gpt-4-turbo-preview (128k context)
  - input: `$0.01` / 1K tokens
  - output: `$0.03` / 1K tokens

See updated OpenAI API pricing [here](https://openai.com/pricing).

_Claude API pricing:_

- Haiku:
  - Input: `$0.00025` / 1K tokens
  - Output: `$0.00125` / 1K tokens
- Haiku 3.5
  - input: `$0.001` / 1K tokens
  - output: `$0.005` / 1K tokens
- Sonnet 3.5
  - input: `$0.003` / 1K tokens
  - output: `$0.015` / 1K tokens
- Opus
  - input: `$0.015` / 1K tokens
  - output: `$0.075` / 1K tokens

See updated Anthropic Claude API pricing [here](https://www.anthropic.com/api).

## Support my work

This extension represents a significant amount of work. If you want to encourage me to develop further and enhance it, you can [buy me a coffee ☕ here](https://buymeacoffee.com/fbgallet) or [sponsor me on Github](https://github.com/sponsors/fbgallet). Thanks in advance for your support! 🙏

---

### For any question or suggestion, DM me on **Twitter** and follow me to be informed of updates and new extensions : [@fbgallet](https://twitter.com/fbgallet).

Please report any issue [here](https://github.com/fbgallet/roam-extension-speech-to-roam/issues).
