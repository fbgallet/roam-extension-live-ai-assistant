# Live AI Assistant

**Powerful and versatile AI Assistant tailor-made for Roam. Rely on efficient and smart built-in prompts, create rich custom prompts or use voice, image or any part of your graph as prompt or context, change the style of the AI responses or create your custom styles !**

**Unlock the full power of advanced Roam queries using simple natural language queries with NL Query Agents! Discover a new way to interact with your graph with Live Outliner Agent, and structure AI responses exactly as you need. Support up-to-date models, and most of existing models through OpenRouter and local ones through Ollama.**

### 🆕 New in v.12 (MAJOR UPDATE)

- New context menu with a large set of built-in prompts and better way to handle custom prompts
- AI Agents to convert natural language requests in Roam queries or :q queries, search and ask question to your graph
- Live Outliner Agent, a brand new way to apply generative AI to any given part of your Roam graph (an AI canva tailored for Roam)
- Tokens and pricing counter
- Recent models support, including DeepSeek, o3-mini (avaible only if you are tier 3 minimum currently)...

(See changelog [here](https://github.com/fbgallet/roam-extension-speech-to-roam/blob/main/CHANGELOG.md))

![Live AI Demo q](https://github.com/user-attachments/assets/e7fee859-df46-44a7-a4ba-3b638314e26c)

Left sidebar or topbar controls:

![image](https://github.com/user-attachments/assets/29af805f-6122-4443-b4fc-023e4615763f)

## **GETTING STARTED**

Choose the LLM provider(s) that will provide you with an API key to use their services at will and copy your API key in the extension settings.

OpenAI and Anthropic currently provide the most suitable and widely tested models for Live AI Assistant, but many other options are available. For paid models, you will be billed for each request based on the number of tokens used, which in practice is **very much cheaper** than existing subscriptions, and without the specific limitations of these subscriptions (you don't need any subscription to use Live AI Assistant, do not confuse the paid use of the API with, for example, ChatGPT Plus).

Obtaining an API key is a simple operation, accessible to any user. Follow the [instructions provided here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md) if you do not already have API keys and see [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#main-models-pricing-per-million-tokens) current API pricing.

### Simple prompt

Just write some basic prompt in a block (or press the microphone button and provide vocal instructions), keep the cursor focus in this block and click on the AI Generation button (lightning bolt icon). That's all !

You can change the **default model** in the extension settings or in the Live AI context menu, by right-clicking on a command to display the available models, and right-clicking on a model to set it as default model.

You can easily use **structured prompts** by selecting multiple blocks (including images with models supporting image recognition). Note that block references will be resolved and remplaced by the corresponding block content.

You can easily **compare AI models** responses: right click on 'Generate a response again' button `⟳` appearing on the right of the AI response and choose another model. The new response will be inserted just above the first one.

### Chat with your AI Assistant

You can easily continue any conversation with an AI Assistant:

![Live AI chat demo 2](https://github.com/user-attachments/assets/db9582f1-9db5-4c21-954a-eab5a21aa030)

- click on the conversation icon on the right of the last AI response block (if generated recently) or simply insert a block as next sibling of an AI response block (the one that contains it's role description, provided in settings, by default: `AI Assistant (<model>):`). It is not necessary to insert your role (such as "Me:") but more convenient in terms of readability.
- write or dictate your prompt (it can include children blocks),
- click on the button to continue the conversation, or run the usual AI generation command, or click on "Continue the conversation" command in Live AI context menu (all previous sibling blocks and their children will be taken into account).

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

### Query Agents

Currently, 4 complementary AI Agents can help users to find precise information in their Roam Graph through natural language queries. The first three do not send any data from your graph to the LLM, they simply interpret the user's request to transform it into native Roam database queries. In contrast, the "Ask to your graph..." agent will have access to the data extracted by the queries to answer your question or proceed with the required processing.

- **Natural language query**: transform the user request in a properly formatted Roam query. It supports period range and semantic variations, [see details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#natural-language-query-agent). Very reliable.
- **Natural language :q Datomic query**: transform the user request in a Datalog Datomic query using the native `:q` query syntax. The results are less reliable than with the previous agent because the syntax is much more complex. It works very well for fairly simple queries, more randomly for complex ones. [See details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#natural-language-q-datomic-agent).
- **Smart Search Agent**: transform the user requests in a set of Datomic queries relying on .q Roam API, to support more complexe queries with hierarchical conditions. In principle allows for more precise results than previous agents, but it can be slow or even cause momentary freezing for large graphs. ⚠️ Use with caution, knowing that this is an experimental feature 🧪. [See details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#smart-search-agent).
- **Ask to your graph...**: relying on the results of the SmartSearch Agent, proceed to post-processing expressed in the user instructions or question. ⚠️ Use with caution, knowing that this is an experimental feature 🧪. [See details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#ask-to-your-graph).

### Live Outliner Agent

This is another way of using AI, an alternative to the "Chat" format. It involves an Agent that autonomously chooses to modify an outline, that is, a set of blocks located under a given parent block, based on user requests. Instead of generating a series of content one after another as in a chat, the Live Outliner Agent modifies, adds, or removes specific blocks in the outline, while maintaining the same structure. In other words, the generation is inserted into a pre-existing structure (similar to a template) and acts only surgically, modifying only the necessary elements, which reduces the number of output tokens.
It's a powerful and innovative feature, still experimental 🧪. [See details here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/live-outliner.md).

### Detailed documentation

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

### For any question or suggestion, DM me on **X/Twitter** and follow me to be informed of updates and new extensions : [@fbgallet](https://x.com/fbgallet).

Please report any issue [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/issues).
