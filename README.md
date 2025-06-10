# Live AI

**Powerful and versatile AI Assistant tailor-made for Roam. Rely on efficient and smart built-in prompts, create rich custom prompts or use voice, image or any part of your graph as prompt or context, change the style of the AI responses or create your custom styles !**

**Unlock the full power of advanced Roam queries using simple natural language queries with NL Query Agents! Discover a new way to interact with your graph with Live Outliner Agent, and structure AI responses exactly as you need. Support up-to-date models, and most of existing models through OpenRouter and local ones through Ollama.**

## If you want to support my work

If you want to encourage me to develop further and enhance Live AI extension, you can [buy me a coffee ☕ here](https://buymeacoffee.com/fbgallet) or [sponsor me on Github](https://github.com/sponsors/fbgallet). Thanks in advance for your support! 🙏

For any question or suggestion, DM me on **X/Twitter** and follow me to be informed of updates and new extensions : [@fbgallet](https://x.com/fbgallet).

Please report any issue [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/issues).

---

### 🆕 New in v.20

- Easily use a given range of previous Daily Notes as context
- Each LLM response has now a title that summarizes its content (option)
- Instant tokens estimation & pricing for the selected context
- Checkbox to include children blocks in prompt (& option to enable it by default)
- Claude Sonnet 4 and Grok 3 support (including reasoning & live search)

### 🆕 New in v.18

- Generate or edit images with OpenAI gpt-image-1 model (see [instructions here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#images-generation))
- Web search support for Anthropic models & Web search command in context menu
- Generate any Mermaid diagrams (and argument map using Mermaid)
- Generate or update Roam table or kanban (using 'table' or 'kanban' keyword in your prompt)

(See complete changelog [here](https://github.com/fbgallet/roam-extension-speech-to-roam/blob/main/CHANGELOG.md))

## Summary

1. [GETTING STARTED](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#1-getting-started)
2. [Model-Specific Features (Voice, Web search, Image)](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#2-model-specific-features-voice-web-search-image)
3. [Going further to get better answers](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#3-going-further-to-get-better-answers)
4. [Agents (Query agents and Live Outliner)](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#4-agents)
5. [Security concerns](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#5-security-concerns)
6. [Detailed documentation for advanced uses](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#6-detailed-documentation-for-advanced-uses)

![Live AI Demo q](https://github.com/user-attachments/assets/e7fee859-df46-44a7-a4ba-3b638314e26c)

## 1. **GETTING STARTED**

- [Get an API key](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#get-an-api-key)
- [Your first prompt](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#your-first-prompts-using-buttons--live-ai-context-menu)
- [The basics of AI requests](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#the-basics-of-ai-requests)
- [Chat with your AI Assistant](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#chat-with-your-ai-assistant)
- [Apply built-in prompts to existing content](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#apply-built-in-prompts-to-existing-content)
- [Providing rich context](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#providing-rich-context)
- [About the cost](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#about-the-cost)

### Get an API key

Choose the AI models provider(s) that will provide you with an API key to use their services at will and copy your API key in the extension settings.

OpenAI and Anthropic currently provide the most tested models for Live AI, but many other options are available. For paid models, you will be billed for each request based on the number of tokens used, which in practice is **very much cheaper** than existing subscriptions, and without the specific limitations of these subscriptions (you don't need any subscription to use Live AI, do not confuse the paid use of the API with, for example, ChatGPT Plus). Be aware that OpenAI API key is required for specific features: voice transcription, text-to-speech and Image generation. Web Search can be achieved both with specific OpenAI or Anthropic models.

Obtaining an API key is a simple operation, accessible to any user. Follow the [instructions provided here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md) if you do not already have API keys and see [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#main-models-pricing-per-million-tokens) current API pricing.

### Your first prompts using buttons & Live AI context menu

Just write some basic prompt in a block (or press the microphone button and provide vocal instructions), keep the cursor focus in this block and click on the "Ask AI" button (⚡️ lightning bolt icon). That's all ! It will send your prompt to the default model and insert the response in the children blocks of your prompt.

<img width="600" alt="Live AI controls" src="https://github.com/user-attachments/assets/f0567cce-c0d0-4736-992b-65dbce441d62" />

This simple process can be still more efficient with keyboard only, using `Live AI context menu`, a rich context menu with a search box to access any Live AI command very quicky.

> [!IMPORTANT]
> The context menu is the main entry point to Live AI, read the following instructions carrefuly:

To open Live AI **context menu**, you can either:

- run `Live AI: Context menu` command from the Command Palette, using the hotkeys. Default hotkeys are `Cmd + Ctrl + a`, which you can modify as you wish (recommanded way, very efficient)
- right-click on the "Ask AI" button (⚡️ lightning bolt icon),
- `Cmd/Ctrl + right-click` anywhere on the page where right-clicking does not have a specific function in Roam (you can customize the key to press while right clicking in the settings).

Once the context menu is open, the first selected command is `Focused block as prompt` if a block is focused. Select this command to send your prompt to the default model.

> [!NOTE]
> This first command, used to send your own prompts to an AI model, will automatically adjust to the selection state: focus, blocks selection, text selection, entire page or zoom view if neither focus nor selection.
>
> You can also write a quick prompt directly in the search bar of the context menu and run the command "Use this custom prompt". The AI generated response will be inserted as last block of the current page/view.

<img width="800" alt="Live AI context menu" src="https://github.com/user-attachments/assets/ce558dd4-33f4-484b-bb65-7bd0aa794218" />

> [!TIP]
> ⚡️ In practice, the process to send some prompt to your AI assistant is almost instant:
>
> - write your prompt and let the focus in the corresponding block
> - trigger hotkeys (`Cmd + Ctrl+ a` by default) to open the Live AI context menu
> - press `Enter` to run the first command: 'Focused block as prompt' or press down arrow to select the next command 'Focused block & all children as prompt' to include all the descendants of the focused block in the prompt

### The basics of AI requests

The following 5 ingredients will be part of your requests (the last 3 are optional):

- **PROMPT**: your instructions to the AI model, available either in the currently focused block (and its children in option) or in a selection of blocks (using native Roam blocks selection), or only the selected text in a block. It can include images for models supporting image recognition (most of them). Note that block references will be resolved and remplaced by the corresponding block content, unless they are inserted in inline code. Live AI provide also a large set of [built-in prompts](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#apply-built-in-prompts-to-existing-content) and you can create [custom prompts](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#3-custom-prompts) templates for prompts you use regularly.
- **MODEL**: the AI model (LLM) that will generate a response according to your instructions. In Live AI context menu, the submenu of `Focused block as prompt` command show the list of available models (for other commands, you have to right click on them to show this model submenu). Click on a model to use it for your current prompt. Right click on a model to set it as **default model**. You can also change the default model in the extension settings.
- **CONTEXT**: the data your instructions might refer to (e.g., an article to summarize or use as inspiration). Live AI lets you leverage Roam powerful graph structure by using content from different parts of the interface as context, like the sidebar, linked references, current page (or zoom), mentioned pages, previous daily notes, and so on. If no prompt is provided (neither focused nor selected block) the context content will directly be used as prompt. [See below](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#providing-rich-context) for more details.
- **OUTPUT TARGET**: the AI model response will be inserted directly in your graph. By default, it will be inserted as a block or hierarchy of blocks as direct child of the focused block, or as next sibling block of the top block of a selection of blocks. If a prompt is sent without block focused or selected (if the whole zoom view is used, or a custom prompt), the response will be inserted as last block of the current view or daily note. By default, a (customizable) header in the form of `AI Assistant (model):` will be inserted as parent block of the response. You can ask for a response without header by choosing `new w/o` (new block without header) in the target dropdown on the right of the context menu search box. `Replace` will insert the response directly into the selected blocks, what can be very useful to complete some template but you will loose a part or your whole prompt. `Append` maintains your prompt and add the response in the same block (in case of short response). Most of the time, `auto` mode is the better solution, adapted to the existing built-in prompts.
- **STYLE**: the output format of the AI model response. You can provide details on how the answer should be written as well as how it will be inserted into Roam, for example, whether it should be broken down into more or less blocks (by default, Live AI supports most Roam-specific formatting like bold or highlighted text, headings, and Katex...). Live AI provide a few predefined styles and you can create your own custom styles. [See below](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#styles) for more details.

### Chat with your AI Assistant

You can easily continue and deepen any conversation with an AI Assistant:

![Live AI chat demo 2](https://github.com/user-attachments/assets/db9582f1-9db5-4c21-954a-eab5a21aa030)

- click on the conversation icon on the right of the last AI response block (if generated recently) or simply insert a block as next sibling of an AI response block (the one that contains it's role description, provided in settings, by default: `AI Assistant (<model>):`). It is not necessary to insert your role (such as "Me:") but more convenient in terms of readability.
- write or dictate your prompt (it can include children blocks),
- click on the button to continue the conversation, or run the usual AI generation command, or click on "Continue the conversation" command in Live AI context menu (all previous sibling blocks and their children will be taken into account).
  - click + `Alt` on the button to continue conversation will insert **suggestions**. Only the selected one will be used as prompt.
- you can easily switch model during the conversation, just `right-click` on the conversation icon and choose another model
- You can even ask one AI to respond to another and follow the conversation between two AIs: `right-click` on the conversation icon at the level of the last AI's response to choose the model that will respond.

### Apply built-in prompts to existing content

Often, you will ask your assistant to process information already available in your graph, such as translating or summarizing a set of blocks. You could write instructions and copy the blocks to process to use them as a big prompt, but to make the most common tasks easier, Live AI offers a set of built-in prompts (around fifty) designed to be effective, rigorous, and tailored to Roam's specific constraints. You simply need, either:

- to select (by multi-block selection) the content to process,
- open the Live AI context menu and choose a command to apply the corresponding built-in prompt
- eventually use a specific model (not the default one) by right-clicking on the command: a list of available models will appear in a submenu

> [!TIP]
> ⚡️ In practice, all you need is a hotkey and a few letters to quickly find a command.
> For example, to translate a block into French, you just need to press 'cmd + Ctrl + a', type 'fre' in the search bar of the context menu and press Enter! It's almost instant !

You can also add specific instructions to built-in prompts simply by clicking the `+` button on the left of the prompt search box !

You can view the exact content of each of these prompts [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/428602f8a383b46425a80f6e63ec2ef3af05d1b8/src/ai/prompts.js#L112).

### Providing rich context

You can easily **add context** to your prompt, that is, a large set of data from your graph that will serve either as resources or as data to be processed, depending on the nature of your prompt and whether you have selected a set of blocks to process or not. In the first case, the context will be added to the system prompt and not as content to be processed. In the second case, the context will be inserted into the user prompt, to be processed directly.

To define the context, you can either check the corresponding box in the context menu or press the corresponding modifier keys to catch all the content of the following elements (at different children depths depending on the element type and settings):

- **Page** (click +`Alt`): the current page or zoom where the focus block or selected blocks are inserted, or by default, the main page zoom (at the center of the display)
- **LinkedRefs** (click +`Ctrl`): the linked references of the current page
- **Sidebar** (click +`Shift`): all the content of the sidebar
- **DNPs** (click +`Ctrl`): a defined range of previous Daily notes (relative to the currently opened or focused DNP)
- **[[page]]** mentions: the content and linked references of the mentioned pages (as [[page]], #tag or atttribute::)

> [!TIP]
> If a context is defined (or if you have selected multiple blocks as prompt) the uids (or block reference identifier) of all the corresponding blocks will be provided to the LLM, so it can refer to one of them if needed.
> Thanks to this, you can easily ask your LLMs to mention or cite relevant block uids or block references as sources (they will understand these terms).
> This is the default behavior but you can disable this feature if you feel that the uids are being handled improperly by your LLMs or are unnecessarily weighing down your prompts (more tokens)

See more details on context definition and inline context [here]((https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#3-context-definition-and-inline-context)

### About the cost

The cost of each request depends on the amount of information sent and generated, measured in tokens: one token in English is roughly 0.75 words. The cost of tokens for the input data (your prompt + context + style instructions) is on average 4 to 5 times lower than the cost for the text generated by the model.

To give you an idea, a request based on about 10 pages of text (4000 words) that generates 1 page of response (400 words) will cost around $0.0026 with OpenAI’s default model (gpt-4.1-mini). Making such a (large) request 10 times a day for a month would cost about $0.78.

You can track the cost of each request and the total per model for the current and past months by clicking the `$` button at the top of Live AI context menu popup. Learn more about models and providers pricing [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#main-models-pricing-per-million-tokens).

## 2. Model-Specific Features (Voice, Web search, Image)

### Voice transcription

You need either an account on OpenAI to benefit from Whisper (or `gpt-4o-transcribe` models) transcriptions, or a Groq one since you can define Groq as default provider for the audio transcription model and user the powerful `whisper-large-v3` model. Estimated cost is $0.006/minute.

⚠️ _Currently, voice recording isn't possible on either the MacOS desktop app or the Mobile app : microphone is not yet supported, so vocal notes transcription can't be achieved._

- the transcribed text will be inserted by default at the **bottom of the current page** (or page view) or **appended to the current focused block** (so exactly where you want, you have just to place the cursor anywhere just before clicking the button or running the transcription command).
- by default, the language should be automatically detected, but you can specify it for better results, using the [ISO 639-1 codes](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)
- You can specify a list of words to be spelled in a specific way (e.g. proper nouns, acronyms, technical terms, etc.), see the Whisper prompt option in the settings.
- if you have not entered any OpenAI API Key or Groq API Key, or if you disable Whisper, the free Web Speech API will be used to transcribe audio (⚠️ not available in Electron Desktop app and Firefox or Arc browser)

- **Direct translation of vocal recording**:

A large number of [source languages are supported](https://platform.openai.com/docs/guides/speech-to-text/supported-languages), but the target language is currently limited to English. This limitation can be easily overcome through post-processing using a generative AI, as it only requires asking it to translate into almost any language.

### Text to speech (TTS)

You can have any selection read aloud (the focus block, part of the selected text in that block, or a set of selected blocks). You just need an active OpenAI key (since the `gpt-4o-mini-tts` model will be used) and run the `Text To Speech` command from Live AI context menu. Press `Escape` to stop the reading. Estimated cost is $0.015/minute.

In the extension settings, you can change the voice and provide instructions to control aspects of speech, including: Accent, Emotional range, Intonation, Impressions, Speed of speech, Tone, Whispering...

### Web search (or web as context)

⚠️ Currently Web Search can only be achieved with OpenAI dedicated models, Anthropic models or Grok models.

The knowledge base used for the LLM responses can be the web itself if you use `Web search` command (or OpenAI `gpt-4o-search` or `gpt-4o-mini-search` models with basic prompt completion command) . It's useful if you're looking for information that requires recent data or practical questions, for example, organizing a trip.

The models don't just summarize different relevant content found on the internet. You can use a rich prompt that requests all types of advanced and structured content processing that the LLM will gather.

You can set the default model to use for Web search (OpenAI or Anthropic models) either in extension settings or by right-clicking on the choosen model in the submenu of `Web search` command.

> [!WARNING]
> ⚠️ To collect its data and prepare its response, the model will browse several sites: the input tokens used will be much higher than your prompt, leading to additional costs. Additionally, providers charge a fee per 1,000 queries: $10 for Anthropic, and between $25 and $50 for OpenAI, depending on the context size and model.

Web search context option (in extension settings) for OpenAI models: you can choose the context size extracted from relevant websites. Low: fastest, cheaper. High: slower, higher cost. See pricing [here](https://platform.openai.com/docs/pricing#web-search)

### Images generation

You can generate images directly embedded in Roam using a prompt (written in a block, or a block selection, optionally including a context) with the `Image generation` command. This feature requires an OpenAI API key and your organization’s authentication (identity verification).

- **Image quality** (low, medium or high): the low level is usually enough, the image generates faster (about fifteen seconds for a simple prompt) and costs much less (around 15 times cheaper than high quality, see the [pricing doc] for details).
- **Image format**: if you want a square (1024x1024), portrait (1024\*1536), or landscape format (1536x1024), or a transparent background, you have to specify it in your prompt (or the model will choose by itself)
- **Image in prompt**: the image generation can rely on existing images (as inspiration or source to edit). Simply insert one or multiple images in your prompt (by selecting the corresponding blocks or putting them in the choosen context). Be aware that each input image will add input tokens cost.
- **Image edition with mask**: you can target the image edition to a specific part of an image by attaching a copy of the initial image with a transparent area (alpha channel) to indicate where the requested change should be made without altering the rest. The image used as a mask will only be recognized as such if you add the keyword `mask` in the markdown link to the image, e.g.: `![mask](url)`

## 3. Going further to get better answers

The most important thing is the precision of your prompt, which is why it can be helpful to create personalized or style-specific prompt templates to reuse instructions proven effective through experience. However, different LLMs respond very differently to instructions and vary in how sensitive they are to certain types of directions, so it can be very useful to compare their responses.

### Compare AI models

You can easily **compare AI models** responses: right click on 'Generate a response again' button `⟳` appearing on the right of the AI response and choose another model. The new response will be inserted just above the first one.

### Retry and provide feedback

You can **improve the response**: click + `Alt` on 'Generate a response again' button `⟳` and the previous result will be taken into account to be improved.

You can even add feedback on the errors or shortcomings of the previous result: place the focus in the block with your correction instructions before clicking the retry button.

### Create & apply custom prompts

Create your custom prompts simply by inserting `#liveai/prompt` in some block. The content of this block will be used as title of your custom prompt and all its children will be used as a structured prompt (block references will be resolved). They will appear in the "custom prompts" section of the context menu.
In the title block of your custom prompt, you can define an inline context, see the syntax [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#2-context-definition-and-inline-context).

### Styles

A style describes the way the generative AIs will write in all their responses, regardless of the specific prompt used (but some built-in prompts, like translation or correction, are incompatible with a style, it won't apply). A set of built-in styles are offered:

- **Concise**: for shorter responses, often limited to a few sentences
- **Conversational**: the AI will adopt a more oral style and encourage continuing the conversation, in a similar way to ChatGPT
- **No bullet points**: responses will ideally take the form of one (or a few) paragraph, to avoid the multiplication of bullet points (which is suitable for Roam but not always desirable)
- **Atomic**: on the other hand, will emphasize the tendency of generative AIs to break down their responses into bullet points, with simple content in each block
- **Quiz**: instead of providing a direct answer, the LLM will offer multiple-choice responses to exercise your judgment, and if you can't identify the correct answer, it will give hints
- **Socratic**: responses in the style of the famous philosopher Socrates (in the dialogues written by Plato). Socrates, not claiming to know the truth about the subject being asked, raises questions himself to encourage thinking, particularly about the meaning of key concepts, involved values, implicit beliefs, etc.

You can read the detailed system prompts defining each built-in style [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/ff8fd131e1f893982f2206b1390d5e0e4bddd3a1/src/ai/prompts.js#L861).

You can add your own custom style, using `#liveai/style` tag. See [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#4-custom-styles) for detailed documentation.

## 4. Agents

### Query Agents

Currently, 4 complementary AI Agents can help users to find precise information in their Roam Graph through natural language queries. The first three do not send any data from your graph to the LLM, they simply interpret the user's request to transform it into native Roam database queries. In contrast, the "Ask your graph" agent will have access to the data extracted by the queries to answer your question or proceed with the required processing.

- **Natural language query**: transform the user request in a properly formatted Roam query. It supports period range and semantic variations, [see details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#natural-language-query-agent). Very reliable.
- **Natural language :q Datomic query**: transform the user request in a Datalog Datomic query using the native `:q` query syntax. The results are less reliable than with the previous agent because the syntax is much more complex. It works very well for fairly simple queries, more randomly for complex ones. [See details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#natural-language-q-datomic-agent).
- **Smart Search Agent**: transform the user requests in a set of Datomic queries relying on .q Roam API, to support more complexe queries with hierarchical conditions. In principle allows for more precise results than previous agents, but it can be slow or even cause momentary freezing for large graphs. ⚠️ Use with caution, knowing that this is an experimental feature 🧪. [See details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#smart-search-agent).
- **Ask your graph**: relying on the results of the SmartSearch Agent, proceed to post-processing expressed in the user instructions or question. ⚠️ Use with caution, knowing that this is an experimental feature 🧪. [See details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#ask-to-your-graph).

### Live Outliner Agent

This is another way of using AI, an alternative to the "Chat" format. It involves an Agent that autonomously chooses to modify an outline, that is, a set of blocks located under a given parent block, based on user requests. Instead of generating a series of content one after another as in a chat, the Live Outliner Agent modifies, adds, or removes specific blocks in the outline, while maintaining the same structure. In other words, the generation is inserted into a pre-existing structure (similar to a template) and acts only surgically, modifying only the necessary elements, which reduces the number of output tokens.
It's a powerful and innovative feature, still experimental 🧪. [See details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/live-outliner.md).

## 5. Security concerns

Sending personal data to a LLMs is not trivial and should always be done with caution. The only completely safe method is to use local models (accessible via Ollama in Live AI), but the most powerful ones require very powerful computers and are generally slower than online models. It's therefore useful to be able to clearly identify which data from your graph will be sent to the LLMs.

With Live AI, you generally have control over what you decide to send or not to the LLMs, except in the case of the `Ask your graph` agent. Here's what's sent to the LLM based on the type of command used:

- when using the generative AI from a prompt, only the prompt (a block or the blocks selected by the user + the content of block refs without their children) is sent.
- when using `Continue the conversation` command: all previous sibling blocks and all their children are sent. `Selected blocks as prompt` command checks if the previous sibling blocks contain a specific header for an AI response, if so, it behaves the same as `Continue the conversation`. In other words, to ensure that previous sibling blocks are not sent to the API by mistake, it's enough to start any new request as the first child of a new block.
- when using a context, by default (customizable in the extension settings):
  - the current page sends all the content of the current zoom,
  - linked references send 3 levels of blocks (that means, 2 levels of children),
  - [[pages]] links send corresponding page content and its linked references on 3 levels
  - DNPs send 3 levels of blocks from the last 7 days (relative)
  - You can also set tags to exclude blocks (and their children) from context
- regarding agents:
  - `NL query`, `NL: q Datomic query`, and `Smart Search` only send the natural language query, no graph content is sent to the LLM API !
  - `Ask your graph`, on the other hand, sends the results of Smart Search (blocks that match the conditions + their direct parent + their first child for pre-selection, and all children up to 3 levels for pre-selected blocks, up to 20). Here, the user has no control over what is sent to the LLM, since the data captured depends on how the agent interprets the user's initial query.
  - `Live Outliner Agent` only sends the content of the active Live Outline.

## 6. Detailed documentation for advanced uses

- **Generative AI**

1. [Built-in prompts](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#1-built-in-prompts)
2. [Context definition and inline context](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#2-context-definition-and-inline-context)
3. [Custom prompts](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#3-custom-prompts)
4. [Custom styles](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#4-custom-styles)
5. [Using SmartBlocks commands](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#5-smartblocks-commands)

- **AI Agents**

1. [Query Agents](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md)
2. [Live Outliner Agent](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/live-outliner.md)

- **LLM Providers**

1. [Get API Keys](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#get-api-keys)
2. [Models pricing](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#main-models-pricing-per-million-tokens)
3. [Ollama to run local models](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#using-ollama-to-run-local-models)
