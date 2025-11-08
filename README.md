# Live AI

**AI Assistant tailor-made for Roam: the power of all the latest LLMs instantly accessible in Roam. Interact with your favorite AI directly in Roam blocks, making the most of Roam’s interface to truly extend your thinking rather than just read answers! Or discover a new way to explore your graph in the agentic Chat interface. No usage limits, pay only for what you use (probably just a few dozen cents per month) or rely on free local models through Ollama or OpenAI compatible servers.**

**Leverage Roam's features to write simple or structured prompts, query specific parts of your graph (your latest DNPs over a given period, sidebar content, linked references, images, .pdf, etc.) and chat with this content or get directly structured responses, which can include tables, images, queries, Mermaid diagrams, code... Dictate, translate, transform, enrich or create structured content very easily thanks to a large set of built-in prompts or your own custom prompts relying on any defined and living context!**

**Ask your entire graph any question with Ask Your Graph agent or unlock the full power of advanced Roam queries using simple natural language queries with query agents, explore, filter and chat with the results!**

![Live AI chat Hello world](https://github.com/user-attachments/assets/735b589d-2249-4953-998d-bf879f253284)

## If you want to support my work

If you want to encourage me to develop further and enhance Live AI extension, you can [buy me a coffee ☕ here](https://buymeacoffee.com/fbgallet) or [sponsor me on Github](https://github.com/sponsors/fbgallet). Thanks in advance for your support! 🙏

For any question or suggestion, DM me on **X/Twitter** and follow me to be informed of updates and new extensions : [@fbgallet](https://x.com/fbgallet), or on Bluesky: [@fbgallet.bsky.social](https://bsky.app/profile/fbgallet.bsky.social)

Please report any issue [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/issues).

---

### 🆕 New in v.22 (November 2025)

- **Chat panel** for smooth conversations, can be displayed as a left/right panel or full screen, combined with a rich context panel
- **Chat agent**, relying on tools to query your graph, handle context, leverage rich instructions and resources with [Live AI Skills](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/liveai-skills-system.md) (inspired by Anthropic Agent Skills), chat with help documents...
- **Query composer** to compose natural language queries, combine them, add specific pages, etc., and save them to reuse them easily, providing a well defined context for Chat
- Ask Your Graph agent support now **sequences of queries** to better handle complexe queries and better handling of DNPs and attributes
- 'Ask Your Graph - Pattern analysis' command for quick overview of all pages in your graph or recent pages or Daily notes
- New models supported natively: Gemini models (including Imagen-4 and 'nano banana'), Claude Sonnet 4.5 & Haiku 4.5 (supporting web fetching), gpt-5-search-api
- Added 'Pdf' checkbox in Context menu

> [!NOTE]
> New OpenAI **GPT-5** model is by default a reasoning model and is quite slow, way slower than previous OpenAI non-reasoning models.
> The reasoning effort is set by default to "low" to make it more responsive; you can change this setting in the settings menu. Setting it to "minimal" will give it a reaction time close to a non-reasoning model.
> A non-reasoning version of GPT-5 is also available for more reactive generative AI use (but it will be automatically replaced by GPT-5 for agent, being not compatible with tools call)

(See complete changelog [here](https://github.com/fbgallet/roam-extension-speech-to-roam/blob/main/CHANGELOG.md))

## Summary

1. [GETTING STARTED](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#1-getting-started)
2. [Model-Specific Features (Voice, Web search, Image, PDF)](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#2-model-specific-features-voice-web-search-image)
3. [Going further to get better answers](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#3-going-further-to-get-better-answers)
4. [Agents (Query agents, Ask Your Graph and Live Outliner)](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#4-agents)
5. [Security concerns](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#5-security-concerns)
6. [Detailed documentation and advanced uses](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#6-detailed-documentation-for-advanced-uses)

## 1. **GETTING STARTED**

- [Get an API key](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#get-an-api-key)
- [Your first prompt](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#your-first-prompts-using-the-chat-panel)
- [Live AI context menu](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#live-ai-context-menu)
- [The basics of AI requests](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#the-basics-of-ai-requests)
- [Chat with your AI Assistant](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#chat-with-your-ai-assistant)
- [Apply built-in prompts to existing content](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#apply-built-in-prompts-to-existing-content)
- [Providing rich context](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#providing-rich-context)
- [About the cost](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#about-the-cost)

### Get an API key

Choose the AI models provider(s) that will provide you with an API key to use their services at will and copy your API key in the extension settings.

OpenAI and Anthropic currently provide the most tested models for Live AI, but many other options are available. For paid models, you will be billed for each request based on the number of tokens used, which in practice is **very much cheaper** than existing subscriptions, and without the specific limitations of these subscriptions (you don't need any subscription to use Live AI, do not confuse the paid use of the API with, for example, ChatGPT Plus). Be aware that OpenAI API key is required for specific features: voice transcription, text-to-speech and Image generation (now also supported by Google API). Web Search or PDF reading can be achieved both with specific OpenAI or Anthropic models.

Obtaining an API key is a simple operation, accessible to any user. Follow the [instructions provided here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md) if you do not already have API keys and see [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#main-models-pricing-per-million-tokens) current API pricing.

### Your first prompts using the Chat panel

🆕 You can simply click on the Chat icon in the left sidebar to start an ephemeral conversation right away in the new **Chat panel**! Just write your request and press Enter!

See the demo .gif [in the introduction section](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#live-ai). N.B.: in this demo the Live AI buttons are in the top bar instead of left sidebar (you can switch in the extension settings)

Since v.22, it's the easiest entry point to Live AI. You can set hotkeys via Roam command palette (`Cmd+p`) for `Live AI: Open Chat panel` command to open it still quicker!

> [!TIP]
> When opening the Chat panel, you can click on buttons to have help about the Chat, or Live AI in general, or get tips.
> You can even be guided by the Chat Agent to discover all the new features! Verify that 'Get help' tool is enabled, and just ask questions. The agent will rely on this help file and other Live AI detailed help file support you in learning how to use this extension!

### Your first prompts using buttons

You want still a smoother experience without breaking your flow in Roam ? Simply write some prompt in any block (or press the microphone button and provide vocal instructions) and click on the "Ask AI" button (⚡️ lightning bolt icon). That's all ! It will send your prompt to the default model and almost instantly insert the response in the children blocks of your prompt.

> [!TIP]
> For request to AI models directly from your notes, the **KEY PRINCIPLE** is simple:
>
> **The prompt is the focused or selected block(s)**

<img width="600" alt="Live AI sidebar buttons" src="https://github.com/user-attachments/assets/1bddaf8e-d9f9-452b-a048-34d4a85d323c" />

### Live AI context menu

> [!IMPORTANT]
> The context menu is the **main entry point to Live AI**, from where all features are accessible, including Chat panel, Tokens counter Query agents... Read the following instructions carrefuly:

This simple process - write and get instant response in Roam blocks - can be still more efficient with keyboard only, using `Live AI Context menu`, a rich context menu with a search box to access any Live AI command and context definition very quicky.

To open Live AI **context menu**, you can either:

- run `Live AI: Context menu` command from the Command Palette, using the hotkeys. Default hotkeys are `Cmd + Ctrl + a`, which you can modify as you wish (recommanded way, very efficient)
- right-click on the "Ask AI" button (⚡️ lightning bolt icon),
- `Cmd/Ctrl + right-click` anywhere on the page where right-clicking does not have a specific function in Roam (you can customize the key to press while right clicking in the settings).

Once the context menu is open, the first selected command is `Focused block as prompt` if a block is focused. Select this command to send your prompt to the default model.

> [!TIP]
> ⚡️ In practice, the process to send some prompt to your AI assistant is almost instant:
>
> - write your prompt and let the focus in the corresponding block
> - trigger hotkeys (`Cmd + Ctrl+ a` by default) to open the Live AI context menu
> - press `Enter` to run the first command: 'Focused block as prompt' or press down arrow to select the next command 'Focused block & all children as prompt' to include all the descendants of the focused block in the prompt

<img width="706" height="328" alt="Live AI context menu" src="https://github.com/user-attachments/assets/02af44cb-37cd-4a44-bf1b-daf495dcd869" />

> [!NOTE]
> This first command, used to send your own prompts to an AI model, will automatically adjust to the selection state: focus, blocks selection, text selection, entire page or zoom view if neither focus nor selection.
>
> You can also write a quick prompt directly in the search bar of the context menu and run the command "Use this custom prompt". The AI generated response will be inserted as last block of the current page/view.

### The basics of AI requests

The following 5 ingredients will be part of your requests (the last 3 are optional):

- **PROMPT**: your instructions to the AI model, available either in the currently focused block (and its children in option) or in a selection of blocks (using native Roam blocks selection), or only the selected text in a block. It can include images for models supporting image recognition (most of them) or .pdf files (only OpenAI and Anthropic models). Note that block references and block or page embed will be resolved and remplaced by the corresponding block content, unless they are inserted in inline code. Live AI provide also a large set of [built-in prompts](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#apply-built-in-prompts-to-existing-content) and you can create [custom prompts](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#3-custom-prompts) templates for prompts you use regularly.
- **MODEL**: the AI model (LLM) that will generate a response according to your instructions. In Live AI context menu, the submenu of `Focused block as prompt` command show the list of available models (for other commands, you have to right click on them to show this model submenu). Click on a model to use it for your current prompt. Right click on a model to set it as **default model**. You can also change the default model in the extension settings.
- **CONTEXT**: the data your instructions might refer to (e.g., an article to summarize or use as inspiration). Live AI lets you leverage Roam powerful graph structure by using content from different parts of the interface as context, like the sidebar, linked references, current page (or zoom), mentioned pages, previous daily notes, and so on. If no prompt is provided (neither focused nor selected block) the context content will directly be used as prompt. [See below](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#providing-rich-context) for more details.
- **OUTPUT TARGET**: the AI model response will be inserted directly in your graph (unless from the Chat panel, where you can insert responses or whole chat in your graph on demand). By default, it will be inserted as a block or hierarchy of blocks as direct child of the focused block, or as next sibling block of the top block of a selection of blocks. If a prompt is sent without block focused or selected (if the whole zoom view is used, or a custom prompt), the response will be inserted as last block of the current view or daily note. By default, a (customizable) header in the form of `AI Assistant (model):` will be inserted as parent block of the response. You can ask for a response without header by choosing `new w/o` (new block without header) in the target dropdown on the right of the context menu search box. `Replace` will insert the response directly into the selected blocks, what can be very useful to complete some template but you will loose a part or your whole prompt. `Append` maintains your prompt and add the response in the same block (in case of short response). `Chat` will open the chat panel and display the response of the LLM. Most of the time, `auto` mode is the better solution, adapted to the existing built-in prompts.
- **STYLE**: the output format of the AI model response. You can provide details on how the answer should be written as well as how it will be inserted into Roam, for example, whether it should be broken down into more or less blocks (by default, Live AI supports most Roam-specific formatting like bold or highlighted text, headings, and Katex...). Live AI provide a few predefined styles and you can create your own custom styles. [See below](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#styles) for more details.

### Chat inline (in blocks) with your AI Assistant

The Chat panel is now the easiest way to have ephemeral or deep conversations with your AI assistant and allow easily to switch from Chat interface to Roam blocks by saving current conversation in Roam blocks on demand, or continue any existing conversation. A saved conversation is just a block including `#liveai/chat`: direct children blocks are the conversation turns.

But you can also easily continue any conversation with an AI Assistant inline in Roam blocks (or switch at any moment to chat interface):

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
>
> The **KEY PRINCIPLE** for built-in or custom prompt is:
>
> **The focused or selected block(s) is the content to which the instructions are applied**

You can also add specific instructions to built-in prompts simply by clicking the `+` button on the left of the prompt search box !

You can view the exact content of each of these prompts [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/428602f8a383b46425a80f6e63ec2ef3af05d1b8/src/ai/prompts.js#L112).

### Providing rich context

You can easily **add context** to your prompt, that is, a large set of data from your graph that will serve either as resources or as data to be processed, depending on the nature of your prompt and whether you have selected a set of blocks to process or not. In the first case, the context will be added to the system prompt and not as content to be processed. In the second case, the context will be inserted into the user prompt, to be processed directly.

To define the context, you can either check the corresponding box in the context menu or press the corresponding modifier keys to catch all the content of the following elements (at different children depths depending on the element type and settings):

- **Page** (click +`Alt`): the current page or zoom where the focus block or selected blocks are inserted, or by default, the main page zoom (at the center of the display)
- **LinkedRefs** (click +`Ctrl`): the linked references of the current page
- **Sidebar** (click +`Shift`): all the content of the sidebar
- **DNPs** (click +`Ctrl`): a defined range of previous Daily notes (relative to the currently opened or focused DNP, but NOT including today or current day, unless triggered from a not-DNP)
- **[[page]]** mentions: the content and linked references of the mentioned pages (as [[page]], #tag or atttribute::)
- **Pdf**: if .pdf documents are present in your notes, as file or as web url, they can be processed by the AI model (OpenAI or Anthropic models)

> [!TIP]
> If a context is defined (or if you have selected multiple blocks as prompt) the uids (or block reference identifier) of all the corresponding blocks will be provided to the LLM, so it can refer to one of them if needed.
> Thanks to this, you can easily ask your LLMs to mention or cite relevant block uids or block references as sources (they will understand these terms).
> This is the default behavior but you can disable this feature if you feel that the uids are being handled improperly by your LLMs or are unnecessarily weighing down your prompts (more tokens)

See more details on context definition and inline context [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#3-context-definition-and-inline-context)

### About the cost

The cost of each request depends on the amount of information sent and generated, measured in tokens: one token in English is roughly 0.75 words. The cost of tokens for the input data (your prompt + context + style instructions) is on average 4 to 5 times lower than the cost for the text generated by the model.

To give you an idea, a request based on about 10 pages of text (4000 words) that generates 1 page of response (400 words) will cost around $0.0026 with OpenAI’s default model (gpt-4.1-mini). Making such a (large) request 10 times a day for a month would cost about $0.78.

You can track the cost of each request and the total per model for the current and past months by clicking the `$` button at the top of Live AI context menu popup. Learn more about models and providers pricing [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#main-models-pricing-per-million-tokens).

## 2. Model-Specific Features (Voice, Web search, Image, PDF)

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

You can have any selection read aloud (the focus block, part of the selected text in that block, or a set of selected blocks). You just need an active OpenAI key (since the `gpt-4o-mini-tts` model will be used) and run the `Text To Speech` command from Live AI context menu. Press `Escape` to stop the reading. It can take a few seconds for processing data before speaking. Estimated cost is $0.015/minute.

In the extension settings, you can change the voice and provide instructions to control aspects of speech, including: Accent, Emotional range, Intonation, Impressions, Speed of speech, Tone, Whispering...

### Web search (or web as context)

⚠️ Currently Web Search can only be achieved with OpenAI dedicated models, Anthropic models or Grok models.

The knowledge base used for the LLM responses can be the web itself if you use `Web search` command (or OpenAI `gpt-5-search-api`, `gpt-4o-search` or `gpt-4o-mini-search` models with basic prompt completion command) . It's useful if you're looking for information that requires recent data or practical questions, for example, organizing a trip.

The models don't just summarize different relevant content found on the internet. You can use a rich prompt that requests all types of advanced and structured content processing that the LLM will gather.

You can set the default model to use for Web search (OpenAI or Anthropic models) either in extension settings or by right-clicking on the choosen model in the submenu of `Web search` command.

> [!WARNING]
> ⚠️ To collect its data and prepare its response, the model will browse several sites: the input tokens used will be much higher than your prompt, leading to additional costs. Additionally, providers charge a fee per 1,000 queries: $10 for Anthropic, and between $25 and $50 for OpenAI, depending on the context size and model.

Web search context option (in extension settings) for OpenAI models: you can choose the context size extracted from relevant websites. Low: fastest, cheaper. High: slower, higher cost. See pricing [here](https://platform.openai.com/docs/pricing#web-search)

Now Anthropic models can even fetch specific web page if you insert the url in your prompt (if allowed by the web domain).

### Images generation

You can generate images directly embedded in Roam using a prompt (written in a block, or a block selection, optionally including a context) with the `Image generation` command. This feature requires an OpenAI API key (and your organization’s authentication (identity verification)) or Google API key.

See [best practices for Google gemini-2.5-flash-image 'nano banana' here](https://ai.google.dev/gemini-api/docs/image-generation#best-practices) (don't care about the code on this page, all is handled by Live AI)

In the built-in prompts menu, choose among three levels of **image quality** (except for gemini-2.5-flash-image): low, medium or high. The low level is usually enough, the image generates faster (about fifteen seconds for a simple prompt) and costs much less (around 15 times cheaper than high quality, see the [pricing doc](https://ai.google.dev/gemini-api/docs/image-generation#best-practices) for details).

In you prompt, you can provide:

- **Image format**: if you want a square (1024x1024), portrait (1024\*1536), or landscape format (1536x1024), or a transparent background (or the model will choose by itself). For Google models, you can specify ratio (e.g.: 1:1, 16:9, etc.)
- **Image in prompt**: the image generation can rely on existing images (as inspiration or source to edit). Simply insert one or multiple images in your prompt (by selecting the corresponding blocks or putting them in the choosen context). Be aware that each input image will add input tokens cost.
- **Image edition**: gemini-2.5-flash-image allows direct image edition without any mask: just insert the image to edit in your prompt and ask for modifications. Google Imagen-4 models doesn't support edit. For OpenAPI models you can target the image edition to a specific part of an image by attaching a copy of the initial image with a transparent area (alpha channel) to indicate where the requested change should be made without altering the rest. The image used as a mask will only be recognized as such if you add the keyword `mask` in the markdown link to the image, e.g.: `![mask](url)`

### Use PDF files as input

OpenAI and Anthropic models supporting images as input support also `.pdf` files in your prompt or in the context. You can insert them both as simple web url or as `{{[[pdf]]: ...}}` component specific to Roam (including the firebase url where your pdf is stored).

You have to know that for each page, text and an image of the page will be sent as input to the LLM: the total tokens count will be greater than for simple text input, even if there is no image in your .pdf.

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

**Live AI Skills**, inspired by Anthropic Agent Skills, provide a new way to rely on predefined and rich set of instructions and resources, see [detailed documentation here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/liveai-skills-system.md). It's only available in the Chat agent.

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

Currently, 3 complementary AI Agents can help users to find precise information in their Roam Graph through natural language queries. The first two do not send any data from your graph to the LLM, they simply interpret the user's request to transform it into native Roam database queries. In contrast, "Ask your graph" agent can have access to the data extracted by the queries to answer your question or proceed with the required processing (depending on privacy mode you choose).

- **Natural language query**: transform the user request in a properly formatted Roam query. It supports period range and semantic variations, [see details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#natural-language-query-agent). Very reliable.
- **Natural language :q Datomic query**: transform the user request in a Datalog Datomic query using the native `:q` query syntax, supporting more complexes and structured queries than the previous one. [See details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#natural-language-q-datomic-agent).

### Ask Your Graph (🆕 New in v.21)

Ask anything to your entire graph, the agent will find the most relevant data to answer your request. Then you can interact and chat with the results to get the best insights! And when no block is focused, "**Ask Linked References of current page**" command allow to chat with linked references!

#### **Versatile retrieval**:

Ask Your Graph is an agent with tools to search for nodes that meet the conditions you provide in natural language. Simply write your natural language query in any block and run Ask Your Graph agent from the Context menu or command panels. Or enable the corresponding tool in the Chat panel and the chat agent will recognize if your prompt is a graph query or not by itself!

The conditions in a query to Ask your graph can be:

- text or exact "quotes",
- page references,
- regex patterns,
- attributes and their values.
- time intervals,
- specific pages only, or DNP only/excluded,

Conditions can be combined logically in natural language or using symbols (+ for AND, | for OR, - for NOT). They can also be combined sequentially (Do this, then that...): it's often better to combine multiple simple queries than an complex query. You can also ask for a limited number of result and for **random** results!

> [!TIP]
> Stick to simple logic so as not to narrow down the search too much from start.
> You can add filters later in the full results view, select manually most relevant results or let an LLM do this for you as a next step.

The nodes matching these conditions can be:

- blocks and their children (default search: block + direct children), up to 3 levels deep, with optional conditions for both the parent and at least one child,
- pages based on their title or Daily notes based on a time range,
- blocks matching all conditions (specify "in same block" in your query),
- pages based on their full content,
- pages containing at least one block matching all conditions.

Examples of request:

- `blocks mentioning [[meeting]] and finance`
- `blocks mentioning [[meeting]] and #important, and John in one of its children`
- `2 random pages where attribute 'status' is #pending`
- `What are the main topics of my [[meeting]] since one month ?`

#### **Fuzzy search and semantic variations**:

For each condition, different variations can be tested to broaden the search:

- fuzzy search or syntactic variation using the `*` symbol after a word (or by explicit request),
- semantic variations with `~` after a mode (synonyms, related terms, broader terms, or a custom variation defined in your prompt).

These variations can be included in the initial query or applied after the first round of results via a menu. By default, if no results are found, the agent will first try fuzzy search, then semantic variations until at least one result is found. In settings, you can also force "always fuzzy", "always synonyms" or "always all semantic variations".

Examples of request:

- `[[meeting]] about finance~ since one week` (will search for finance and a list of synonyms)
- `All pages with design* in the title` (fuzzy search on 'design')
- `Pages with some color~ in the title (custom semantic variation: list most common colors)` (LLM generated list of common colors as search terms)

#### **Chat with query results**:

- Once your query returns results (by default inserted in your graph in Private mode, limited to 20, or selected and commented in Balanced/Full modes), you can view, filter, and sort them in the full results view.
- From there, you can chat directly with the results or with a selected subset of results. In its responses, the agent will reference the concerned results. You can instantly connect what the agent says with the related blocks just by hovering over them!
- <img width="800" alt="chat with results" src="https://github.com/user-attachments/assets/cfc9aff7-bf4c-4475-8032-f9872ded5ddd" />

- A new button on top-right of linked references allow to ""**Ask Linked References of current page**" (or if no block is focused, clicking on Ask Your Graph icon or running the corresponding command from the context menu): it opens linked references in the full view results, allowing to filter/select some of them and chat with them!
- You can also take an existing query or :q query (without dedicated rules or variables) as the base for new searches. Ask Your Graph will understand it, reproduce its results, and open new filtering and precision search possibilities.
- Each user query can be saved for further exploration and the 3 most recents queries remain available. Each query can also be combined with other queries or completed by specific pages or blocks. Run "Open results view" command to load and chat with saved queries.

#### **Control the privacy level of your agent usage**:

There are three privacy levels letting you decide what data may become accessible to the LLM when running Ask Your Graph from a Roam block:

- in "Private" mode, the LLM will never access block content, only their uid and page titles.
- in "Balanced" mode (and by default in the chat interface), the LLM receives block content only at the response synthesis stage; all intermediate steps rely only on uids and page titles.
- in "Full" mode, the agent may use the content and hierarchy of blocks and pages whenever needed for its search. Results can be more precise, but processing will take longer.

In Chat panel, by principle, all blocks and pages loaded in the context will be read (at least partially) by the LLM. If you want to prevent any distant LLM to acccess block or page content, disable tools allowing to load pages or blocks and don't add context to the chat.

Ask Your Graph offers many search options, from the simplest to the most complex. Just phrase your request in natural language (or use voice transcription!), the agent does the rest! But if you want to make the most of the agent’s capabilities, check out the detailed documentation: [See details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#ask-to-your-graph).

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
  - `NL query`, `NL: q Datomic query`, and `Ask Your Graph` in private mode only send the natural language query, no graph content is sent to the LLM API !
  - `Ask your graph` in chat or ballanced or full modes, on the other hand, sends to an LLM the results of queries (blocks that match the conditions + their direct parent + and all children up to 3 levels for pre-selected blocks). During the agentic processing of the user request, the user has no control over what is sent to the LLM, since the data captured depends on how the agent interprets the user's initial query. In the chat with results interface, the user can choose which result has to be sent to the LLM.
  - `Live Outliner Agent` only sends the content of the active Live Outline.

## 6. Detailed documentation and advanced uses

- **Generative AI**

1. [Built-in prompts](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#1-built-in-prompts)
2. [Context definition and inline context](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#2-context-definition-and-inline-context)
3. [Custom prompts](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#3-custom-prompts)
4. [Custom styles](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#4-custom-styles)
5. [Using SmartBlocks commands](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#5-smartblocks-commands)

- **AI Agents**

1. [Query Agents](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md)
2. [Live Outliner Agent](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/live-outliner.md)
3. [MCP Agent](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/mcp-agent.md)
4. [Chat Agent](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/chat-agent.md)
5. [Skills for Chat Agent](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/liveai-skills.md)

- **LLM Providers**

1. [Get API Keys](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#get-api-keys)
2. [Models pricing](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#main-models-pricing-per-million-tokens)
3. [Ollama to run local models](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#using-ollama-to-run-local-models)
