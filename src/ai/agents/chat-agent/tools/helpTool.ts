/**
 * Help Tool
 *
 * Fetches relevant documentation from GitHub to help users with Live AI extension questions.
 * Automatically selects the appropriate documentation based on the user's question topic.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

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

    // Validate topic
    if (!DOC_URLS[topic]) {
      return `Error: Unknown documentation topic "${topic}". Available topics: ${Object.keys(
        DOC_URLS
      ).join(", ")}`;
    }

    // Build the public GitHub URL for linking
    const publicUrl = DOC_URLS[topic]
      .replace("raw.githubusercontent.com", "github.com")
      .replace("/main/", "/blob/main/");

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
      return `Documentation for "${topic}" was already provided earlier in this conversation. Please refer to the previously fetched content.

Source: ${publicUrl}`;
    }

    try {
      // Fetch the documentation from GitHub
      const response = await fetch(DOC_URLS[topic]);

      if (!response.ok) {
        if (response.status === 404) {
          return `Documentation not yet available for "${topic}". This documentation may be coming soon.`;
        }
        return `Error fetching documentation: ${response.status} ${response.statusText}`;
      }

      const content = await response.text();

      // Return the documentation content with source URL
      return `# Documentation: ${topic}

Source: ${publicUrl}

---

${content}

---

**When referencing this documentation to the user, provide the source link above so they can access the full documentation online.**`;
    } catch (error) {
      console.error("Error fetching documentation:", error);
      return `Error fetching documentation: ${
        error instanceof Error ? error.message : String(error)
      }`;
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
- Any other extension functionality`,
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
