/**
 * Chat Help Constants
 *
 * Pre-written help responses and tips for the chat interface
 */

export const CHAT_HELP_RESPONSE = `### Chat Panel Quick Guide

Easy to use like a simple chat but with the power of an agent capable of querying your Roam graph and giving you fresh insights through its integration with the context panel!

#### **Simple and Smooth Chat**
- **Ephemeral** conversations by default - nothing saved unless you click "Insert in Roam"
- **Save & Continue**: Tag blocks with #liveai/chat to save conversations and reload them later
- **Flexible Layout**: Position as right/left/bottom panel or modal - preferences auto-saved
- **Prompts & Styles**: Use built-in or custom prompts (#liveai/prompt) and styles (#liveai/style)
- **Rich Markdown**: Headers, lists, tables, highlights - auto-converted to Roam format
- Support images, .pdf (with most models) and even audio or video analysis (with Gemini models)
- **Slash Commands**: Type / to access quick commands (clear, close, change mode, save, switch model)
- **Edit Messages**: Click to edit previous messages, rendered as Roam blocks

#### **Context panel**
- **Easy access**: switch to a detailed context view (click on the vertical button on the left of chat panel) or split view
- **Easy set up**: add pages/blocks manually, by loading saved queries, or by creating new ones, or simply drag&drop block(s)
- **Precise control**: filter, sort and select the most relevant data for your chat

#### **Chat Agent: Intelligent Context & Tools**
- **Agent/Chat Modes**: Switch between Agent mode (with tools) and simple Chat mode (no tools) anytime
- **Access Modes**: adaptative depth of pages/blocks in the context
  - 🛡️ **Balanced**: 50% context window, faster responses, adaptive depth (0-4 levels for blocks, 4 for pages)
  - 🔓 **Full Access**: 90% context window, deeper analysis, unlimited depth + "No truncation" option
- **Powerful Tools**: Add To Context, Select By Criteria, Ask Your Graph, Get Help, Skills, Edition tools (create/update/delete blocks & pages), Interaction tools (Ask User Choice, Random Pick)
- **Smart Context**: Agent loads pages/blocks dynamically based on mentions and needs
- **Query Integration**: Run queries, compose searches, manage results directly in the panel

#### **Key Features**
- **Bidirectional Roam Integration**: Chat → Roam (insert button), Roam → Chat (load #liveai/chat blocks)
- **Interactive References**: Hover over [block refs](((block-refs))) or [[page-refs]] to highlight them in the result view (Shift/Alt modifiers supported so open them)
- **Tool Visibility**: Watch agent actions in real-time with tool usage display
- **Generate Documents**: Export to PDF, DOCX, PPTX directly from chat (Anthropic API Key requested)

#### **Recommendations**
- **For Speed**: Disable tools (~3000 tokens saved per message), use Balanced mode, combine questions
- **For Quality**: use Full Access mode and powerful models (Claude Opus 4.6, GPT-5.2, Gemini 3 Pro...)
- **For Cost**: Disable tools, use Balanced mode, cheaper models, batch questions, start new chats when switching topics
- **Inline vs Chat**: Use inline for Roam structure, Mermaid, PDFs; use chat for conversation, search analysis

**📖 Complete Guide**: [Chat Agent Documentation](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/chat-agent.md) - includes detailed tool descriptions, depth strategies, and workflows

**💡 Agentic Help**: Enable tools and ask questions - the agent will use get_help tool to fetch relevant docs!

#### **How to support my work ?**
Become a [Github sponsor](https://github.com/sponsors/fbgallet), [buy me a coffee](https://buymeacoffee.com/fbgallet) or follow me on [X](https://x.com/fbgallet) or [Bluesky](https://bsky.app/profile/fbgallet.bsky.social) @fbgallet`;

export const LIVE_AI_HELP_RESPONSE = `### Live AI - Quick Overview

**Live AI** v.27 (Feb 2026) brings powerful multimodal LLMs directly into Roam Research!

#### **Main Features:**
- ⚡️ **Ask AI**: instant AI request from your Roam blocks: focused or selected blocks are the prompt.
- 💥 **Context menu**: Access all Live AI features from anywhere in Roam by just pressing 'Cmd-Ctrl-A' or 'Cmd+Right click': define context, select prompts, call natural language query agents, search on the web, generate images...
- ✍️ **Custom prompts**: Create reusable prompts with \`#liveai/prompt\`
- 🎨 **Custom styles**: Define output formats with \`#liveai/style\`
- 💬 **Chat panel**: chat with your notes, linked references or any other query result
- 🛠️ **Live AI Skills**: Advanced automated workflows with instructions, resources and records ([doc](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/liveai-skills.md))

#### **Multimodal features**
- 🎤 **Voice**: Dictate notes and commands, Text-to-speech
- 🌁 **Image**: analysis and generation
- 📑 **Pdf**: extract or analyze documents
- 🕸️ **Web search**: Ask AI to find up-to-date or precise informations on the web!
- 📄 **Document generation**: Export to PDF, DOCX, PPTX

#### **Explore and leverage your Roam graph**
- 🔍 **Query agents and Ask Your Graph**: Deep semantic search across your entire graph
- 📝 **Live Outliner**: AI-assisted outlining and content updated/generation
- 💬 **Chat with query results**: Instantly chat with native query results or linked references

#### **Supported LLM Providers:**
OpenAI (GPT-5.2), Anthropic (Claude Opus 4.6, Sonnet 4.5), Google (Gemini 3), xAI (Grok), DeepSeek, Ollama (local models), and more via OpenRouter!

#### **How to support my work ?**
Become a [Github sponsor](https://github.com/sponsors/fbgallet), [buy me a coffee](https://buymeacoffee.com/fbgallet) or follow @fbgallet on [X](https://x.com/fbgallet), on [Bluesky](https://bsky.app/profile/fbgallet.bsky.social) or on [Mastodon](https://mastodon.social/@fbgallet)`;

export const WHATS_NEW_RESPONSE = `### What's New in Live AI v.27 🎉

#### **Chat Panel**
- **Slash Commands**: Type / to quickly clear, close, change mode, save, or search & switch models
- **Edit Messages**: Click any message to edit it, rendered as a Roam block
- **Agent/Chat Toggle**: Easily switch between Agent mode (with tools) and simple Chat mode
- **No Truncation Option**: In Full Access mode, disable truncation for complete context

#### **Chat Agent Tools**
- **Edition Tools**: Create pages or blocks, update or delete blocks (with human validation)
- **Interaction Tools**: Ask User Choice (for polls, QCM) and Random Pick (from context or any list)

#### **Live AI Skills — Major Update**
- **Records**: Skills can now write output to any defined place in your graph ([detailed doc](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/liveai-skills.md))
- **SmartBlocks Integration**: Run skills from SmartBlocks with \`<%LIVEAIGEN:prompt,context,{chat:skill:skill_name}%>\`
- **Relative Dates**: Resources and records support relative date keywords (today, last week, in 3 days...)
- **Improved Structure**: Description supports children blocks, singular/plural tags, page embeds, bold flags

#### **Models & UI**
- Models menu & customization entirely revamped with many new models (GPT-5.2, Claude Opus 4.6, Gemini Flash 3, GPT Image 1.5, Grok Imagine)
- New button and dropdown to handle thinking effort of reasoning models
- Chat with native query results button

#### **Context Menu**
- New context options: 'Siblings', 'Path' (ancestors) and Queries (Roam queries and :q queries)

#### **Document Generation**
- Generate PDF, DOCX, PPTX documents directly (Anthropic API Key requested)

📖 [Full Changelog](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/CHANGELOG.md)

#### **How to support my work ?**
Become a [Github sponsor](https://github.com/sponsors/fbgallet), [buy me a coffee](https://buymeacoffee.com/fbgallet) or follow me on [X](https://x.com/fbgallet) or [Bluesky](https://bsky.app/profile/fbgallet.bsky.social) @fbgallet`;

// Tips specific to Live AI (context menu, inline commands)
export const LIVE_AI_TIPS = [
  "**Did you know?** You can **convert between formats** easily: 'Outline to Paragraph' or 'Paragraph to Outline' commands restructure your content while preserving meaning",
  "**Hotkey tip**: Set a hotkey for 'Context Menu' (default: Cmd/Ctrl+Alt+A) to access Live AI quickly from any block! ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant#1-getting-started))",
  "**SmartBlocks integration**: Use `<%LIVEAIGEN:prompt,context,target%>` in SmartBlocks templates to automate AI-powered workflows ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#5-smartblocks-commands))",
  "**Query agents**: Write natural language like 'meetings with John about frontend -DONE' and let the agent build the proper Roam query or :q Datomic query (only available via the corresponding commands in Live AI context menu, not in chat) ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#natural-language-query-agent))",
  "**Fuzzy & semantic search**: Using query agents or Ask Your Graph agent, end a word with `*` for fuzzy (practice* → practise, practicing) or `~` for semantic (practice~ → workout, exercise) ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#natural-language-query-agent))",
  "**Did you know?** You can create **Mermaid diagrams** directly! Just select your content and choose 'Mermaid diagram' - the AI will generate flowcharts, timelines, mindmaps, and more in Roam-compatible format",
  "**Did you know?** You can get **vocabulary suggestions** inline (works only in Roam blocks, not in chat currently)! The AI will propose better word choices wrapped in `{{or: best | alternative | ~~original~~}}` - just accept the first suggestion",
  "**New context options**: In the context menu, use 'Siblings' to include sibling blocks, 'Path' for ancestors, or 'Queries' to include Roam native queries and :q Datomic query results as context!",
  "**Document generation**: Generate PDF, DOCX, or PPTX documents directly from your content or chat — great for sharing polished output outside Roam! (Anthropic API Key requested)",
];

// Tips specific to Chat
export const CHAT_TIPS = [
  "**Chat storage**: Tag any block with `#liveai/chat` to save and continue conversations later. Direct child blocks are chat turn, beginning with the user if no role placeholder is used ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant#chat-with-your-ai-assistant))",
  "**Tokens optimization**: When working with large contexts, combine multiple questions in one request to save tokens (context is sent to the LLM on each conversation turn). For brief conversations that don't need your graph data, switch to Chat mode (no tools). When you switch to a different topic, start a completely new chat session.",
  "**Set the chat context on opening**: Select blocks and open the chat to use them as context! Or use 'Open chat panel' in the Live AI context menu, or you can set the context with one click (sidebar, current page, etc.)",
  "**Markdown style**: Chat responses support a wide variety of markdown styles, including headers, lists, highlights, and tables—don't hesitate to ask the AI to use them. They will be automatically converted to Roam format if you copy or insert the messages.",
  "**Live AI Skills**: Advanced automated workflows with instructions, resources and records. Skills can read context, follow instructions, and write structured output to any place in your graph! ([detailed doc](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/liveai-skills.md))",
  "**Enrich context on the fly**: Add pages or blocks to the context just by asking in natural language (if tools are enabled), or simply mention pages in your prompt, the agent will decide if it's needed to load their content or reference in the context.",
  "**Slash commands**: Type / in the chat input to access quick commands: clear chat, close panel, switch between Agent/Chat mode, save conversation, or search and switch models — all without leaving the keyboard!",
  "**Edit messages**: You can edit any previous message in the chat by clicking on it. The message is rendered as a Roam block for easy editing.",
  "**Skills with Records**: Skills can now write output directly to your graph using Records — define a target page or block, and the agent will create or update content there. Use relative dates like \\`[[today]]\\` or \\`[[last week]]\\` for dynamic targets ([doc](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/liveai-skills.md))",
  "**Skills via SmartBlocks**: Trigger specific skills from SmartBlocks with \\`<%LIVEAIGEN:prompt,context,{chat:skill:skill_name}%>\\` — great for automated workflows and repeatable processes!",
  "**Edit images**: Once you generate an image, you can choose to switch to Edit image mode (available with Gemini, GPT 1.5 Image & Grok Imagine): any further prompt will be used to apply modification to the previously generated image! Use /exit-edit to come back to conversation mode.",
];

// Tips applicable to both Live AI and Chat
export const BOTH_TIPS = [
  "**Did you know?** Live AI supports **sentiment & value analysis**! Discover implicit emotions, ethical principles, and cultural values embedded in your notes",
  "**Did you know?** The **'Similar content' command** generates new examples matching your pattern - great for creating consistent series of notes, arguments, or tips!",
  "**Did you know?** You can **ask for counterexamples** to test your ideas! The 'Counterexample' command finds concrete cases that challenge your statements",
  "**Did you know?** Live AI can **generate action plans**. Use 'Action plan for a project' to break down goals into trackable, time-estimated tasks",
  "**Did you know?** The **Socratic** style transforms AI into a philosophy mentor who guides you to discover answers through questioning instead of lecturing ([Socratic mode](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#4-custom-styles))",
  "**Did you know?** You can **fix spelling & grammar** with explanations! The 'Fix spelling & grammar + explain' command teaches you the rules, not just the corrections",
  "**Custom styles**: Define output formats with `#liveai/style` (e.g., 'Socratic', 'Tweet', 'In one sentence') to get consistently formatted responses ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#4-custom-styles))",
  "**Custom prompts**: Create reusable prompts by tagging a block with `#liveai/prompt`. This block is the prompt title, all children blocks are the instructions. You can use `<target content>` placeholder, it will be replaced by the focused/ selected block(s) to which is applied the prompt ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#3-custom-prompts))",
  "**Voice commands**: While recording, press 'T' for Transcribe, 'A' to Ask AI, 'C' for Chat, or 'O' for Live Outliner ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant#2-model-specific-features-voice-web-search-image))",
  "**Query syntax**: To write quicker natural language queries for Ask Your Graph or query interpreters, you can use use `+` for AND, `|` for OR, `-` for NOT, and at the end of a word:`*` for fuzzy search, and `~` for semantic search ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md))",
  "**Critical thinking**: Explore the 'Critical reasoning toolkit' built-in prompts to analyze arguments, challenge assumptions, and cultivate critical thinking with AI assistance ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#1-built-in-prompts))",
  "**Inline context**: You can define what context the AI should use by inserting this kind of instruction `{{context: page([[Page Title]])+dnp(7)+sidebar}}` in the top block of your custom prompt ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#inline-context-definition))",
  "**Modifier keys**: Define what context the AI should use when clicking AI buttons by pressing `Alt` for full current page, `Shift` for sidebar or `Cmd/Ctrl` for linked refs ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#2-context-definition-and-inline-context))",
  "**Local models**: Run free local models with Ollama (no API key needed) - great for privacy-sensitive notes or offline work. But know that they are generally slower and will struggle more with complex tasks, particularly agents like Ask your graph or tools in chat ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md))",
  "**Built-in prompts**: You can insert built-in prompts in your custom prompts with `<built-in:summarize>` or `<built-in:translate:Spanish>` to rely on their instructions and adapt them to your specific needs ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#3-custom-prompts))",
  "**Multiple models**: Mix providers and LLMs! Use DeepSeek or Google for cheap bulk work, Claude Sonnet or GPT-5.2 for quality, GPT-4.1-mini or Gemini Flash 3 for speed. Switching is almost instant — use / in chat to search and switch models! ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#main-models-pricing-per-million-tokens))",
  "**OpenRouter access**: Get 100+ models and the most recent ones with one API key via OpenRouter - perfect for testing different models without multiple accounts ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#get-api-keys))",
  "**Did you know?** Live AI can **extract text from images** (OCR) or analyze artwork! Use 'Extract text from image' or 'Image Analysis' commands on blocks containing images",
  "**Did you know?** Live AI can **create quizzes** from your notes! Use the 'Quiz on provided content' command or use 'Quiz' style for active learning and knowledge testing",
  "**Did you know?** You can **analyze or transcribe audio files** with Gemini models! Just include audio URLs (`{{[[audio]]: url}}`) in your prompt or context. Use `start:` and `end:` to analyze specific segments (e.g., 'Transcribe this audio start: 2:00 end: 5:30')",
  "**Did you know?** You can **analyze videos** (including YouTube) with Gemini models! Insert video URLs in your prompt or context, and use `start:`/`end:` keywords to focus on specific segments (e.g., 'Summarize this video start: 1:30 end: 4:00')",
];

// Legacy: Combined tips array for backward compatibility
export const TIPS = [...LIVE_AI_TIPS, ...CHAT_TIPS, ...BOTH_TIPS];

/**
 * Get a random tip based on context
 * @param context - "liveai" for Live AI tips, "chat" for Chat tips, "both" for both contexts, or undefined for all tips
 * @returns A random tip string
 */
export const getRandomTip = (context?: "liveai" | "chat" | "both"): string => {
  let tipsArray: string[];

  switch (context) {
    case "liveai":
      tipsArray = [...LIVE_AI_TIPS, ...BOTH_TIPS];
      break;
    case "chat":
      tipsArray = [...CHAT_TIPS, ...BOTH_TIPS];
      break;
    case "both":
      tipsArray = BOTH_TIPS;
      break;
    default:
      tipsArray = TIPS;
  }

  return tipsArray[Math.floor(Math.random() * tipsArray.length)];
};

// Prompts for agentic mode (to trigger Help tool)
export const AGENTIC_CHAT_HELP_PROMPT =
  "Tell me about the Chat agent: what tools are available and how to use them. Keep it brief, mention key features, and provide a link to complete documentation.";

export const AGENTIC_LIVE_AI_HELP_PROMPT =
  "Give me a brief overview of Live AI extension's main features and recent updates. Include links to key documentation (getting started, API keys, Ask Your Graph, custom prompts). Keep it concise.";
