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
  BUILTIN_LIVEAI_TOPICS,
} from "./helpDepotUtils";

/**
 * Builds the help tool description dynamically based on enabled topics
 */
function buildHelpToolDescription(): string {
  // Get enabled topics at call time (dynamic)
  const enabledTopics = getEnabledTopics();

  // Group topics by category
  const topicsByCategory: Record<string, string[]> = {};

  // Add built-in Live AI topics
  topicsByCategory["Live AI Extension"] = BUILTIN_LIVEAI_TOPICS.map(
    (t) => `  - "${t.id}": ${t.shortDescription}`
  );

  // Add depot topics grouped by category
  const depotTopics = enabledTopics.filter(
    (t) => !BUILTIN_LIVEAI_TOPICS.some((bt) => bt.id === t.id)
  );

  depotTopics.forEach((t) => {
    const categoryName = t.category || "Other";
    if (!topicsByCategory[categoryName]) {
      topicsByCategory[categoryName] = [];
    }
    topicsByCategory[categoryName].push(
      `  - "${t.id}": ${t.shortDescription} (by ${t.author})`
    );
  });

  // Build the description
  const categorySections = Object.entries(topicsByCategory)
    .map(([category, topics]) => `${category}:\n${topics.join("\n")}`)
    .join("\n\n");

  return `Fetch documentation when user asks for help about Live AI features or other enabled topics.

Available Topics:
${categorySections}

Choose the most relevant topic based on the user's question.`;
}

/**
 * Creates the help tool with current enabled topics
 * Should be called each time tools are loaded to get fresh topic list
 */
export function createHelpTool() {
  return tool(
    async (input: { topic: string }, config) => {
      const { topic } = input;

      // Check enabled topics (includes both built-in and depot topics)
      const enabledTopics = getEnabledTopics();
      const selectedTopic = enabledTopics.find((t) => t.id === topic);

      if (!selectedTopic) {
        // Unknown topic
        const availableTopics = enabledTopics.map((t) => t.id);
        return `[DISPLAY]Error: Unknown documentation topic "${topic}". Available topics: ${availableTopics.join(
          ", "
        )}[/DISPLAY]`;
      }

      // Get URLs from the topic
      const rawUrl = convertGithubUrlToRaw(selectedTopic.url);
      const publicUrl = selectedTopic.url;

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

        // Build topic display name with author if not a built-in topic
        const isBuiltIn = BUILTIN_LIVEAI_TOPICS.some(
          (bt) => bt.id === selectedTopic.id
        );
        const topicDisplayName = isBuiltIn
          ? selectedTopic.topic
          : `${selectedTopic.topic} (by ${selectedTopic.author})`;

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
      description: buildHelpToolDescription(),
      schema: z.object({
        topic: z
          .string()
          .describe(
            "The documentation topic ID to fetch. Must be one of the available topic IDs listed in the description. Choose based on what the user is asking about."
          ),
      }),
    }
  );
}
