# Live AI Assistant

**Powerful and versatile AI Assistant supporting text, selection of structured blocks, voice or images as prompt. Pre-defined prompts adapted to Roam, natural language queries agent, custom prompts and templates, easy-to-define context and Live Outliner agent for response structured exactly as you want. Support up-to-date models, and most of existing models through OpenRouter and local ones through Ollama.**

### 🆕 New in v.12 (MAJOR UPDATE)

- New context menu with a large set of built-in prompts and better way to handle custom prompts
- AI Agents to convert natural language requests in Roam queries or :q queries, search and ask question to your graph
- Live Outliner Agent, a brand new way to apply generative AI to any given part of your Roam graph (an AI canva tailored for Roam)
- Tokens and pricing counter
- Recent models support, including DeepSeek, o3-mini...

(See changelog [here](https://github.com/fbgallet/roam-extension-speech-to-roam/blob/main/CHANGELOG.md))

![Live AI Demo 3](https://github.com/fbgallet/roam-extension-speech-to-roam/assets/74436347/fc35b01c-3172-4763-a4a2-2aa23e290dd9)

Left sidebar or topbar controls:

## **GETTING STARTED**

Choose the LLM provider(s) that will provide you with an API key to use their services at will and copy your API key in the extension settings.

OpenAI and Anthropic currently provide the most suitable and widely tested models for Live AI Assistant, but many other options are available. For paid models, you will be billed for each request based on the number of tokens used, which in practice is **very much cheaper** than existing subscriptions, and without the specific limitations of these subscriptions (you don't need any subscription to use Live AI Assistant, do not confuse the paid use of the API with, for example, ChatGPT Plus).

Obtaining an API key is a simple operation, accessible to any user. Consult page X for the procedure to follow if you do not already have API keys and see here current API pricing.

### Simple prompt

Just write some basic prompt in a block (or press the microphone button and provide vocal instructions) and, with the cursor focus in this block, click on the AI Generation button (lightning bolt icon). That's all !

You can easily use **structured prompts** by selecting multiple blocks (including images with models supporting image recognition). Note that block references will be resolved and remplaced by the corresponding block content.

You can easily **compare AI models** responses: right click on 'Generate a response again' button `⟳` appearing on the right of the AI response and choose another model. The new response will be inserted just above the first one.

### Chat with your AI Assistant

You can easily continue any conversation with an AI Assistant:

![Live AI chat demo 2](https://github.com/user-attachments/assets/db9582f1-9db5-4c21-954a-eab5a21aa030)

- click on the conversation icon on the right of the last AI response block (if generated recently) or simply insert a block as next sibling of an AI response block (the one that contains it's role description, provided in settings, by default: `AI Assistant (<model>):`). It is not necessary to insert your role (such as "Me:") but more convenient in terms of readability.
- write or dictate your prompt (it can include children blocks),
- click on the button to continue the conversation or run the usual AI generation command.

### Apply built-in prompts to existing content

Often, you will want your assistant to process information already available in your graph, such as translating or summarizing a set of blocks. You could write instructions to copy the blocks or their references and use them as a prompt, but to make the most common tasks easier, Live AI Assistant offers a set of built-in prompts (around fifty) designed to be effective, rigorous, and tailored to Roam's specific constraints. You simply need, either:

- to select (by multi-block selection) the content to process and choose the built-in prompt from the context menu.
- open the context menu, select some context element to use as input content (see CONTEXT SECTION FOR MORE DETAILS ON CONTEXT DEFINITION) and choose the built-in prompt to apply.

To open the **context menu**, the most efficient way is to use the `Live AI Assistant: Open commands context menu` command from the Command Palette (Cmd/Ctrl + p), or even better, use the shortcut (default is `Cmd + Ctrl + a`, which you can modify as you wish). Two other very simple options: right-click on the AI completion icon, or Cmd/Ctrl + right-click anywhere on the page where right-clicking does not have a specific function in Roam.

⚡️ In practice, all you need is a hotkey and a few letters to quickly find a command. For example, to translate a block into French, you just need to press 'cmd + Ctrl + a', type 'fre' and press Enter!

You can add specific instructions to built-in prompts simply by clicking the '+' button on the left of the prompt search box.

You can view the exact content of each of these prompts [here](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/428602f8a383b46425a80f6e63ec2ef3af05d1b8/src/ai/prompts.js#L112).

### Create & apply custom prompts

Create your custom prompts simply by inserting `#liveai/prompt` in some block. The content of this block will be used as title of your custom prompt and all its children will be used as a structured prompt (block references will be resolved). They will appear in the "custom prompts" section of the context menu.

### Providing rich context

You can easily **add context** to your prompt, that is, a large set of data from your graph that will serve either as resources or as data to be processed, depending on the nature of your prompt and whether you have selected a set of blocks to process or not. In the first case, the context will be added to the system prompt and not as content to be processed. In the second case, the context will be inserted into the user prompt, to be processed directly.

To define the context, you can either check the corresponding box in the context menu or press the corresponding modifier keys to catch all the content of the following elements (at different children depths depending on the element type and settings):

- **Page** (+ `Alt`): the current page zoom where the focus block or selected blocks are inserted, or by default, the main page zoom (at the center of the display)
- **LinkedRefs** (+ `Ctrl`): the linked references of the current page
- **Sidebar** (+ `Shift`): all the content of the sidebar
- **DNPs** (+ `Ctrl`): if you are in Daily Notes, the last DNPs (7 by default, you can increase the limit in the options)

### Query Agents

### Live Outliner Agent

### Detailed documentation

1. Built-in prompts and custom prompts
2. Custom styles
3. Query Agents
4. Live Outliner Agent
5. Voice transcription and limitations
6. Using SmartBlocks commands
7. API keys and pricing
8. Using Ollama to run local models

## Support my work

This extension requires a lot of work in my free time. If you want to encourage me to develop further and enhance it, you can [buy me a coffee ☕ here](https://buymeacoffee.com/fbgallet) or [sponsor me on Github](https://github.com/sponsors/fbgallet). Thanks in advance for your support! 🙏

---

### For any question or suggestion, DM me on **Twitter** and follow me to be informed of updates and new extensions : [@fbgallet](https://twitter.com/fbgallet).

Please report any issue [here](https://github.com/fbgallet/roam-extension-speech-to-roam/issues).
