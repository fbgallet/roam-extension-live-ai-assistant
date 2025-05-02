# Live AI Assistant

**Powerful and versatile AI Assistant tailor-made for Roam. Rely on efficient and smart built-in prompts, create rich custom prompts or use voice, image or any part of your graph as prompt or context, change the style of the AI responses or create your custom styles !**

**Unlock the full power of advanced Roam queries using simple natural language queries with NL Query Agents! Discover a new way to interact with your graph with Live Outliner Agent, and structure AI responses exactly as you need. Support up-to-date models, and most of existing models through OpenRouter and local ones through Ollama.**

### 🆕 New in v.18

- Generate or edit images with OpenAI gpt-image-1 model (see [instructions here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#images-generation))
- OpenAI gpt-4.1, o3 & o4-mini models support
- Generate any Mermaid diagrams (and argument map using Mermaid)
- Generate or update Roam table or kanban (using 'table' or 'kanban' keyword in your prompt)
- Text to Speech (using OpenAI gpt-4o-mini-tts) & speech transcription supporting gpt-4o-transcribe models (Whisper remains default model)
- :q Datomic query Agent now support the new native rules and variables (usefull for time ranges)

### 🆕 New in v.17

- Web search OpenAI models support
- force the LLM to 'think' and improve its previous response (with click + `Alt` on retry button)
- suggestions to continue a conversation (with `Alt` key)
- switch model with keyboard only
- switch model during conversation, or even have multiple AI discuss with each other
- text selection with whole block as context (e.g. to define a word in context)

(See changelog [here](https://github.com/fbgallet/roam-extension-speech-to-roam/blob/main/CHANGELOG.md))

![Live AI Demo q](https://github.com/user-attachments/assets/e7fee859-df46-44a7-a4ba-3b638314e26c)

Left sidebar or topbar controls:

![image](https://github.com/user-attachments/assets/29af805f-6122-4443-b4fc-023e4615763f)

## **GETTING STARTED**

Choose the LLM provider(s) that will provide you with an API key to use their services at will and copy your API key in the extension settings.

OpenAI and Anthropic currently provide the most tested models for Live AI Assistant, but many other options are available. For paid models, you will be billed for each request based on the number of tokens used, which in practice is **very much cheaper** than existing subscriptions, and without the specific limitations of these subscriptions (you don't need any subscription to use Live AI Assistant, do not confuse the paid use of the API with, for example, ChatGPT Plus). Be aware that OpenAI API key is required for specific features: voice transcription, text-to-speech, Web search and Image generation.

Obtaining an API key is a simple operation, accessible to any user. Follow the [instructions provided here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md) if you do not already have API keys and see [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#main-models-pricing-per-million-tokens) current API pricing.

### Simple prompt

Just write some basic prompt in a block (or press the microphone button and provide vocal instructions), keep the cursor focus in this block and click on the AI Generation button (lightning bolt icon). That's all !

You can change the **default model** in the extension settings or in the Live AI context menu, by right-clicking on a command to display the available models, and right-clicking on a model to set it as default model.

You can easily use **structured prompts** by selecting multiple blocks (including images with models supporting image recognition). Note that block references will be resolved and remplaced by the corresponding block content.

You can easily **improve the response**: click + `Alt` on 'Generate a response again' button `⟳` and the previous result will be taken into account to be improved. You can even add feedback on the errors or shortcomings of the previous result: place the focus in the block with your correction instructions before clicking the retry button.

You can easily **compare AI models** responses: right click on 'Generate a response again' button `⟳` appearing on the right of the AI response and choose another model. The new response will be inserted just above the first one.

### Chat with your AI Assistant

You can easily continue any conversation with an AI Assistant:

![Live AI chat demo 2](https://github.com/user-attachments/assets/db9582f1-9db5-4c21-954a-eab5a21aa030)

- click on the conversation icon on the right of the last AI response block (if generated recently) or simply insert a block as next sibling of an AI response block (the one that contains it's role description, provided in settings, by default: `AI Assistant (<model>):`). It is not necessary to insert your role (such as "Me:") but more convenient in terms of readability.
- write or dictate your prompt (it can include children blocks),
- click on the button to continue the conversation, or run the usual AI generation command, or click on "Continue the conversation" command in Live AI context menu (all previous sibling blocks and their children will be taken into account).
  - click + `Alt` on the button to continue conversation will insert **suggestions**. Only the selected one will be used as prompt.
- you can easily switch model during the conversation, just `right-click` on the conversation icon and choose another model
- You can even ask one AI to respond to another and follow the conversation between two AIs: `right-click` on the conversation icon at the level of the last AI's response to choose the model that will respond.

### Apply built-in prompts to existing content

Often, you will ask your assistant to process information already available in your graph, such as translating or summarizing a set of blocks. You could write instructions and copy the blocks to process to use them as a big prompt, but to make the most common tasks easier, Live AI Assistant offers a set of built-in prompts (around fifty) designed to be effective, rigorous, and tailored to Roam's specific constraints. You simply need, either:

- to select (by multi-block selection) the content to process and choose the built-in prompt from the context menu.
- open the context menu, select some context element to use as input content and choose the built-in prompt to apply.

To open the **context menu**, the most efficient way is to use the `Live AI Assistant: Open commands context menu` command from the Command Palette (Cmd/Ctrl + p), or even better, use the shortcut (default is `Cmd + Ctrl + a`, which you can modify as you wish). Two other very simple options: right-click on the AI completion icon, or Cmd/Ctrl + right-click anywhere on the page where right-clicking does not have a specific function in Roam.

⚡️ **In practice, all you need is a hotkey and a few letters to quickly find a command. For example, to translate a block into French, you just need to press 'cmd + Ctrl + a', type 'fre' and press Enter! It's almost instant !**

You can add specific instructions to built-in prompts simply by clicking the '+' button on the left of the prompt search box.

You can view the exact content of each of these prompts [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/428602f8a383b46425a80f6e63ec2ef3af05d1b8/src/ai/prompts.js#L112).

### Create & apply custom prompts

Create your custom prompts simply by inserting `#liveai/prompt` in some block. The content of this block will be used as title of your custom prompt and all its children will be used as a structured prompt (block references will be resolved). They will appear in the "custom prompts" section of the context menu.
In the title block of your custom prompt, you can define an inline context, see the syntax [here]((https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#3-context-definition-and-inline-context).

### Providing rich context

You can easily **add context** to your prompt, that is, a large set of data from your graph that will serve either as resources or as data to be processed, depending on the nature of your prompt and whether you have selected a set of blocks to process or not. In the first case, the context will be added to the system prompt and not as content to be processed. In the second case, the context will be inserted into the user prompt, to be processed directly.

To define the context, you can either check the corresponding box in the context menu or press the corresponding modifier keys to catch all the content of the following elements (at different children depths depending on the element type and settings):

- **Page** (click +`Alt`): the current page zoom where the focus block or selected blocks are inserted, or by default, the main page zoom (at the center of the display)
- **LinkedRefs** (click +`Ctrl`): the linked references of the current page
- **Sidebar** (click +`Shift`): all the content of the sidebar
- **DNPs** (click +`Ctrl`): if you are in Daily Notes, the last DNPs (7 by default, you can increase the limit in the options)

See more details on context definition and inline context [here]((https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#3-context-definition-and-inline-context)

### Web search (or web as context)

The knowledge base used for the LLM responses can be the web itself if you use `gpt-4o-search` or `gpt-4o-mini-search` models. It's useful if you're looking for information that requires recent data or practical questions, for example, organizing a trip.

The models don't just summarize different relevant content found on the internet. You can use a rich prompt that requests all types of advanced and structured content processing that the LLM will gather.

Web search context option (in extension settings): you can choose the context size extracted from relevant websites. Low: fastest, cheaper. High: slower, higher cost. See pricing [here](https://platform.openai.com/docs/pricing#web-search)

### Styles

A style describes the way the generative AIs will write in all their responses, regardless of the specific prompt used (but some built-in prompts, like translation or correction, are incompatible with a style, it won't apply). A set of built-in styles are offered:

- **Concise**: for shorter responses, often limited to a few sentences
- **Conversational**: the AI will adopt a more oral style and encourage continuing the conversation, in a similar way to ChatGPT
- **No bullet points**: responses will ideally take the form of one (or a few) paragraph, to avoid the multiplication of bullet points (which is suitable for Roam but not always desirable)
- **Atomic**: on the other hand, will emphasize the tendency of generative AIs to break down their responses into bullet points, with simple content in each block
- **Quiz**: instead of providing a direct answer, the LLM will offer multiple-choice responses to exercise your judgment, and if you can't identify the correct answer, it will give hints
- **Socratic**: responses in the style of the famous philosopher Socrates (in the dialogues written by Plato). Socrates, not claiming to know the truth about the subject being asked, raises questions himself to encourage thinking, particularly about the meaning of key concepts, involved values, implicit beliefs, etc.

You can read the detailed system prompts defining each built-in style [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/ff8fd131e1f893982f2206b1390d5e0e4bddd3a1/src/ai/prompts.js#L861).

You can add your own custom style, using `#liveai/style` tag. See [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#5-custom-styles) for detailed documentation.

## Images generation

You can generate images directly embedded in Roam using a prompt (written in a block, or a block selection, optionally including a context) with the `Image generation` command. This feature requires an OpenAI API key and your organization’s authentication (identity verification).

- **Image quality** (low, medium or high): the low level is usually enough, the image generates faster (about fifteen seconds for a simple prompt) and costs much less (around 15 times cheaper than high quality, see the [pricing doc] for details).
- **Image format**: if you want a square (1024x1024), portrait (1024*1536), or landscape format (1536x1024), or a transparent background, you have to specify it in your prompt (or the model will choose by itself)
- **Image in prompt**: the image generation can rely on existing images (as inspiration or source to edit). Simply insert one or multiple images in your prompt (by selecting the corresponding blocks or putting them in the choosen context). Be aware that each input image will add input tokens cost.
- **Image edition with mask**: you can target the image edition to a specific part of an image by attaching a copy of the initial image with a transparent area (alpha channel) to indicate where the requested change should be made without altering the rest. The image used as a mask will only be recognized as such if you add the keyword `mask` in the markdown link to the image, e.g.: `![mask](url)`

## Query Agents

Currently, 4 complementary AI Agents can help users to find precise information in their Roam Graph through natural language queries. The first three do not send any data from your graph to the LLM, they simply interpret the user's request to transform it into native Roam database queries. In contrast, the "Ask to your graph..." agent will have access to the data extracted by the queries to answer your question or proceed with the required processing.

- **Natural language query**: transform the user request in a properly formatted Roam query. It supports period range and semantic variations, [see details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#natural-language-query-agent). Very reliable.
- **Natural language :q Datomic query**: transform the user request in a Datalog Datomic query using the native `:q` query syntax. The results are less reliable than with the previous agent because the syntax is much more complex. It works very well for fairly simple queries, more randomly for complex ones. [See details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#natural-language-q-datomic-agent).
- **Smart Search Agent**: transform the user requests in a set of Datomic queries relying on .q Roam API, to support more complexe queries with hierarchical conditions. In principle allows for more precise results than previous agents, but it can be slow or even cause momentary freezing for large graphs. ⚠️ Use with caution, knowing that this is an experimental feature 🧪. [See details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#smart-search-agent).
- **Ask to your graph...**: relying on the results of the SmartSearch Agent, proceed to post-processing expressed in the user instructions or question. ⚠️ Use with caution, knowing that this is an experimental feature 🧪. [See details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#ask-to-your-graph).

## Live Outliner Agent

This is another way of using AI, an alternative to the "Chat" format. It involves an Agent that autonomously chooses to modify an outline, that is, a set of blocks located under a given parent block, based on user requests. Instead of generating a series of content one after another as in a chat, the Live Outliner Agent modifies, adds, or removes specific blocks in the outline, while maintaining the same structure. In other words, the generation is inserted into a pre-existing structure (similar to a template) and acts only surgically, modifying only the necessary elements, which reduces the number of output tokens.
It's a powerful and innovative feature, still experimental 🧪. [See details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/live-outliner.md).

## Security concerns

Sending personal data to a LLMs is not trivial and should always be done with caution. The only completely safe method is to use local models (accessible via Ollama in Live AI Assistant), but the most powerful ones require very powerful computers and are generally slower than online models. It's therefore useful to be able to clearly identify which data from your graph will be sent to the LLMs.

With Live AI Assistant, you generally have control over what you decide to send or not to the LLMs, except in the case of the `Ask to my graph...` agent. Here's what's sent to the LLM based on the type of command used:

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
  - `Ask to your graph`, on the other hand, sends the results of Smart Search (blocks that match the conditions + their direct parent + their first child for pre-selection, and all children up to 3 levels for pre-selected blocks, up to 20). Here, the user has no control over what is sent to the LLM, since the data captured depends on how the agent interprets the user's initial query.
  - `Live Outliner Agent` only sends the content of the active Live Outline.

## Detailed documentation

- **Generative AI**

1. [Voice transcription](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#1-voice-transcription)
2. [Built-in prompts](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#2-built-in-prompts)
3. [Context definition and inline context](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#3-context-definition-and-inline-context)
4. [Custom prompts](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#4-custom-prompts)
5. [Custom styles](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#5-custom-styles)
6. [Using SmartBlocks commands](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#6-smartblocks-commands)

- **AI Agents**

1. [Query Agents](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md)
2. [Live Outliner Agent](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/live-outliner.md)

- **LLM Providers**

1. [Get API Keys](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#get-api-keys)
2. [Models pricing](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#main-models-pricing-per-million-tokens)
3. [Ollama to run local models](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#using-ollama-to-run-local-models)

## Support my work

This extension requires a lot of work in my free time. If you want to encourage me to develop further and enhance it, you can [buy me a coffee ☕ here](https://buymeacoffee.com/fbgallet) or [sponsor me on Github](https://github.com/sponsors/fbgallet). Thanks in advance for your support! 🙏

---

For any question or suggestion, DM me on **X/Twitter** and follow me to be informed of updates and new extensions : [@fbgallet](https://x.com/fbgallet).

Please report any issue [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/issues).
