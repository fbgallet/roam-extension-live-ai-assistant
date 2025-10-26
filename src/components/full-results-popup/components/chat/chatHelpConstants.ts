/**
 * Chat Help Constants
 *
 * Pre-written help responses and tips for the chat interface
 */

export const CHAT_HELP_RESPONSE = `## Chat Agent Quick Guide

The Chat agent helps you analyze and interact with your search results:

**Main Features:**
- 💬 **Analyze results**: Ask questions about your search results, get summaries, insights, connections
- ➕ **Add context**: Add pages by title or explore linked references to expand your context
- 🎯 **Filter results**: Select specific results based on criteria (dates, content, semantic analysis)
- 🔄 **Agentic mode**: Enable tools for advanced features like fetching help documentation

**How to use:**
1. Select results from your search
2. Ask questions or use suggestion buttons (Summarize, Key insights, etc.)
3. Toggle between "Simple" and "Agent" mode in the header
4. Switch between "Balanced" and "Full Access" for different context depths

**Access modes:**
- 🛡️ **Balanced**: Limited context, faster responses
- 🔓 **Full Access**: Deeper context, more detailed analysis

For more details, enable Agentic mode and ask for help!`;

export const LIVE_AI_HELP_RESPONSE = `## Live AI Extension - Quick Overview

**Live AI** v.22 (Nov 2025) brings powerful LLMs directly into Roam Research!

**Main Features:**
- 🔍 **Ask Your Graph**: Deep semantic search across your entire graph
- 💬 **Chat & Query agents**: Natural language queries and conversations
- ✍️ **Custom prompts**: Create reusable prompts with \`#liveai/prompt\`
- 🎨 **Custom styles**: Define output formats with \`#liveai/style\`
- 🎤 **Voice input**: Dictate notes and commands
- 🔌 **MCP integration**: Connect to Model Context Protocol servers
- 📝 **Live Outliner**: AI-assisted outlining and content generation

**Supported LLM Providers:**
OpenAI (GPT-4, GPT-5), Anthropic (Claude), Google (Gemini), xAI (Grok), DeepSeek, Ollama (local models), and more!

**Quick Tips:**
- Set hotkeys for Context Menu and Ask AI commands
- Use \`#liveai/chat\` to store conversations
- Enable Agentic mode for advanced help and documentation

Made with ❤️ by [Fabrice Gallet](https://github.com/sponsors/fbgallet)`;

export const TIPS = [
  "💡 **Hotkey tip**: Set a hotkey for 'Context Menu' (default: Cmd/Ctrl+Alt+A) to access Live AI quickly from any block! ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant#1-getting-started))",
  "💡 **Custom prompts**: Create reusable prompts by tagging a page with `#liveai/prompt` - add child blocks with your prompt template and use `<target content>` placeholder ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#3-custom-prompts))",
  "💡 **Voice commands**: While recording, press 'A' to Ask AI, 'G' for Ask Your Graph, or 'O' for Live Outliner ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant#2-model-specific-features-voice-web-search-image))",
  "💡 **Query syntax**: Use `&` for AND, `|` for OR, `-` for NOT, `*` for fuzzy search, and `~` for semantic search in natural language queries ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md))",
  "💡 **Chat storage**: Tag any page with `#liveai/chat` to save and continue conversations - perfect for ongoing projects or research! ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant#chat-with-your-ai-assistant))",
  "💡 **Custom styles**: Define output formats with `#liveai/style` (e.g., 'Socratic', 'Bullet points', 'Tweet') to get consistently formatted responses ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#4-custom-styles))",
  "💡 **Inline context**: Use `{{context: page([[Page Title]])+dnp(7)+sidebar}}` in any prompt to precisely define what context the AI should use ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#inline-context-definition))",
  "💡 **SmartBlocks integration**: Use `<%LIVEAIGEN:prompt,context,target%>` in SmartBlocks templates to automate AI-powered workflows ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#5-smartblocks-commands))",
  "💡 **Modifier keys**: Hold `Cmd/Ctrl` for linked refs, `Alt` for full page, or `Shift` for sidebar as context when clicking AI buttons ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#2-context-definition-and-inline-context))",
  "💡 **Critical thinking**: Explore the 'Critical reasoning toolkit' prompts to analyze arguments, challenge assumptions, and cultivate critical thinking with AI assistance ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#1-built-in-prompts))",
  "💡 **MCP integration**: Connect external tools via MCP - use 'All Servers' agent to orchestrate complex workflows across multiple services ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/mcp-agent.md))",
  "💡 **Cost optimization**: Combine multiple questions in one request to save tokens! Also, prompts use cache for repeated context, reducing costs by ~50% ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md))",
  "💡 **Local models**: Run free local models with Ollama (no API key needed) - great for privacy-sensitive notes or offline work ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md))",
  "💡 **Query agents**: Write natural language like 'meetings with John about frontend -DONE' and let the agent build the proper Roam query ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#natural-language-query-agent))",
  "💡 **Block depth limits**: Configure max block depth for linked refs/DNPs in settings to control context size and costs (default: 2-3 levels) ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#2-context-definition-and-inline-context))",
  "💡 **Built-in prompts**: Insert built-in prompts in your custom prompts with `<built-in:summarize>` or `<built-in:translate:Spanish>` ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#3-custom-prompts))",
  "💡 **Multiple models**: Mix providers! Use DeepSeek-V3 for cheap bulk work ($0.28/1M tokens), Claude Sonnet for quality, and GPT-4o-mini for speed ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#main-models-pricing-per-million-tokens))",
  "💡 **OpenRouter access**: Get 100+ models with one API key via OpenRouter - perfect for testing different models without multiple accounts ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#get-api-keys))",
  "💡 **Exclude private blocks**: Set blocks with specific tags (like `#private`) to be automatically excluded from AI context in settings ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#2-context-definition-and-inline-context))",
  "💡 **Fuzzy & semantic search**: End a word with `*` for fuzzy (practice* → practise, practicing) or `~` for semantic (practice~ → workout, exercise) ([more details](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md#natural-language-query-agent))",
  "💡 **Did you know?** You can create **Mermaid diagrams** directly! Just select your content and choose 'Mermaid diagram' - the AI will generate flowcharts, timelines, mindmaps, and more in Roam-compatible format",
  "💡 **Did you know?** Live AI can **extract text from images** (OCR) or analyze artwork! Use 'Extract text from image' or 'Image Analysis' commands on blocks containing images",
  "💡 **Did you know?** The **Critical Reasoning Toolkit** can help you think better: get counterarguments, challenge fallacies, analyze reasoning structure, or shift perspectives on any idea!",
  "💡 **Did you know?** You can get **vocabulary suggestions** inline! The AI will propose better word choices wrapped in `{{or: best | alternative | ~~original~~}}` - just accept the first suggestion",
  "💡 **Did you know?** Live AI can **create quizzes** from your notes! Use the 'Quiz on provided content' command for active learning and knowledge testing",
  "💡 **Did you know?** You can **fix spelling & grammar** with explanations! The 'Fix spelling & grammar + explain' command teaches you the rules, not just the corrections",
  "💡 **Did you know?** The **Socratic style** transforms AI into a philosophy teacher who guides you to discover answers through questioning instead of lecturing ([Socratic mode](https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md#4-custom-styles))",
  "💡 **Did you know?** You can **convert between formats** easily: 'Outline to Paragraph' or 'Paragraph to Outline' commands restructure your content while preserving meaning",
  "💡 **Did you know?** Live AI can **generate action plans** with `{{[[TODO]]}}` checkboxes! Use 'Action plan for a project' to break down goals into trackable, time-estimated tasks",
  "💡 **Did you know?** You can **ask for counterexamples** to test your ideas! The 'Counterexample' command finds concrete cases that challenge your statements",
  "💡 **Did you know?** The **'Similar content' command** generates new examples matching your pattern - great for creating consistent series of notes, arguments, or tips!",
  "💡 **Did you know?** Live AI supports **sentiment & value analysis**! Discover implicit emotions, ethical principles, and cultural values embedded in your notes",
];

export const getRandomTip = (): string => {
  return TIPS[Math.floor(Math.random() * TIPS.length)];
};

// Prompts for agentic mode (to trigger Help tool)
export const AGENTIC_CHAT_HELP_PROMPT =
  "Tell me about the Chat agent: what tools are available and how to use them. Keep it brief, mention key features, and provide a link to complete documentation.";

export const AGENTIC_LIVE_AI_HELP_PROMPT =
  "Give me a brief overview of Live AI extension's main features and recent updates. Include links to key documentation (getting started, API keys, Ask Your Graph, custom prompts). Keep it concise.";
