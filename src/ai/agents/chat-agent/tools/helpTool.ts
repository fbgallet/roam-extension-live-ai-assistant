/**
 * Help Tool
 *
 * Fetches relevant documentation from GitHub to help users with Live AI extension questions.
 * Automatically selects the appropriate documentation based on the user's question topic.
 * Supports both built-in Live AI docs and user-enabled third-party topics from helpDepot.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getEnabledTopics,
  convertGithubUrlToRaw,
} from "./helpDepotUtils";

// Base URL for raw GitHub content
const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/fbgallet/roam-extension-live-ai-assistant/main";

// Documentation mapping
const DOC_URLS: Record<string, string> = {
  overview: `${GITHUB_RAW_BASE}/README.md`,
  pricing: `${GITHUB_RAW_BASE}/docs/api-keys-and-pricing.md`,
  "generative-ai": `${GITHUB_RAW_BASE}/docs/generative-ai.md`,
  "mcp-agent": `${GITHUB_RAW_BASE}/docs/mcp-agent.md`,
  "query-agents": `${GITHUB_RAW_BASE}/docs/query-agents.md`,
  "live-outliner": `${GITHUB_RAW_BASE}/docs/live-outliner.md`,
  // chat-agent documentation (to be added later)
  "chat-agent": `${GITHUB_RAW_BASE}/docs/chat-agent.md`,
  "official-roam-faq": `${GITHUB_RAW_BASE}/docs/roam-help/official-roam-faq.md`,
};

export const helpTool = tool(
  async (input: { topic: string }, config) => {
    const { topic } = input;

    // Check if topic is from depot (third-party docs)
    const enabledTopics = getEnabledTopics();
    const depotTopic = enabledTopics.find((t) => t.id === topic);

    let rawUrl: string;
    let publicUrl: string;

    if (depotTopic) {
      // Handle depot topic
      rawUrl = convertGithubUrlToRaw(depotTopic.url);
      publicUrl = depotTopic.url;
    } else if (DOC_URLS[topic]) {
      // Handle built-in Live AI docs
      rawUrl = DOC_URLS[topic];
      publicUrl = DOC_URLS[topic]
        .replace("raw.githubusercontent.com", "github.com")
        .replace("/main/", "/blob/main/");
    } else {
      // Unknown topic
      const availableTopics = [
        ...Object.keys(DOC_URLS),
        ...enabledTopics.map((t) => t.id),
      ];
      return `[DISPLAY]Error: Unknown documentation topic "${topic}". Available topics: ${availableTopics.join(
        ", "
      )}[/DISPLAY]`;
    }

    // Check if this documentation was already fetched using the tool results cache
    const toolResultsCache = config?.configurable?.toolResultsCache || {};
    const docAlreadyFetched = Object.values(toolResultsCache).some(
      (cached: any) =>
        cached.tool_name === "get_help" &&
        cached.content &&
        typeof cached.content === "string" &&
        cached.content.includes(`# Documentation: ${topic}`)
    );

    if (docAlreadyFetched) {
      return `[DISPLAY]Documentation for "${topic}" was already provided earlier in this conversation.

Source: ${publicUrl}[/DISPLAY]`;
    }

    try {
      // Fetch the documentation from GitHub
      const response = await fetch(rawUrl);

      if (!response.ok) {
        if (response.status === 404) {
          return `[DISPLAY]Documentation not yet available for "${topic}". This documentation may be coming soon.[/DISPLAY]`;
        }
        return `[DISPLAY]Error fetching documentation: ${response.status} ${response.statusText}[/DISPLAY]`;
      }

      const content = await response.text();

      // Build topic display name
      const topicDisplayName = depotTopic
        ? `${depotTopic.topic} (by ${depotTopic.author})`
        : topic;

      // Return the documentation content with source URL
      // Format: [DISPLAY]...[/DISPLAY] for UI callback, then full content for agent context
      return `[DISPLAY]Source: ${publicUrl}[/DISPLAY]

# Documentation: ${topicDisplayName}

---

${content}

---
`;
    } catch (error) {
      console.error("Error fetching documentation:", error);
      return `[DISPLAY]Error fetching documentation: ${
        error instanceof Error ? error.message : String(error)
      }[/DISPLAY]`;
    }
  },
  {
    name: "get_help",
    description: `Fetch documentation about Live AI extension features or Roam Research app when the user asks for help.

Topics:
- "overview": General introduction and getting started with Live AI extension
- "pricing": LLM providers, API keys, and pricing information
- "generative-ai": Advanced generative AI features (custom prompts, inline context, smartblocks, etc.)
- "mcp-agent": MCP agent documentation
- "query-agents": Query agents including Ask Your Graph
- "live-outliner": Live Outliner features
- "chat-agent": Chat agent documentation (coming soon)
- "official-roam-faq": FAQ about Roam Research

Use this tool when users ask questions about:
- How to use Live AI extension or any of its features
- Pricing or API keys
- Ask Your Graph agent
- Chat agent
- MCP integration
- Custom prompts or advanced features
- Any other extension functionality
- Roam Research app`,
    schema: z.object({
      topic: z
        .enum([
          "overview",
          "pricing",
          "generative-ai",
          "mcp-agent",
          "query-agents",
          "live-outliner",
          "chat-agent",
          "official-roam-faq",
        ])
        .describe(
          "The documentation topic to fetch. Choose based on what the user is asking about."
        ),
    }),
  }
);
