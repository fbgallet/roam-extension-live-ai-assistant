/**
 * Help Depot Utilities
 *
 * Manages the extended help topics from helpDepot.json and user-selected topic preferences.
 */

import { extensionStorage } from "../../../../index";

export interface HelpTopic {
  id: string;
  topic: string;
  author: string;
  url: string; // User-friendly GitHub URL (blob format)
  shortDescription: string;
  category: string;
}

export interface HelpDepot {
  topics: HelpTopic[];
  categories: Record<string, string>;
}

// Maximum number of topics that can be enabled at once
export const MAX_ENABLED_TOPICS = 16;

// URL for the help depot JSON file
const HELP_DEPOT_URL =
  "https://raw.githubusercontent.com/fbgallet/roam-extension-live-ai-assistant/main/src/ai/agents/chat-agent/tools/helpDepot.json";

// Built-in Live AI topics (always available, hardcoded)
export const BUILTIN_LIVEAI_TOPICS: HelpTopic[] = [
  {
    id: "overview",
    topic: "Live AI overview",
    author: "fbgallet",
    url: "https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md",
    shortDescription:
      "Readme: Overview of Live AI extension: installation, features, API setup, and getting started guide",
    category: "extension-liveai",
  },
  {
    id: "pricing",
    topic: "API Keys & Pricing",
    author: "fbgallet",
    url: "https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md",
    shortDescription:
      "Guide to setting up API keys for different providers, pricing information, and cost management",
    category: "extension-liveai",
  },
  {
    id: "generative-ai",
    topic: "Generative AI Features",
    author: "fbgallet",
    url: "https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md",
    shortDescription:
      "Text generation, completion, and AI-powered writing features in Live AI",
    category: "extension-liveai",
  },
  {
    id: "mcp-agent",
    topic: "MCP Agent",
    author: "fbgallet",
    url: "https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/mcp-agent.md",
    shortDescription:
      "Model Context Protocol agent for advanced AI integrations and custom tools",
    category: "extension-liveai",
  },
  {
    id: "query-agents",
    topic: "Query Agents",
    author: "fbgallet",
    url: "https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md",
    shortDescription:
      "Intelligent query agents for searching and analyzing your Roam graph",
    category: "extension-liveai",
  },
  {
    id: "live-outliner",
    topic: "Live Outliner",
    author: "fbgallet",
    url: "https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/live-outliner.md",
    shortDescription:
      "Real-time AI assistance while outlining and writing in Roam",
    category: "extension-liveai",
  },
  {
    id: "chat-agent",
    topic: "Chat Agent",
    author: "fbgallet",
    url: "https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/chat-agent.md",
    shortDescription: "Chat agent documentation (coming soon)",
    category: "extension-liveai",
  },
];

/**
 * Converts a GitHub blob URL to a raw content URL
 * @param blobUrl - User-friendly GitHub URL (e.g., github.com/user/repo/blob/main/file.md)
 * @returns Raw content URL (e.g., raw.githubusercontent.com/user/repo/main/file.md)
 */
export function convertGithubUrlToRaw(blobUrl: string): string {
  return blobUrl
    .replace("github.com", "raw.githubusercontent.com")
    .replace("/blob/", "/");
}

/**
 * Converts a raw GitHub URL back to a user-friendly blob URL
 * @param rawUrl - Raw content URL
 * @returns User-friendly GitHub URL
 */
export function convertRawUrlToBlob(rawUrl: string): string {
  return rawUrl
    .replace("raw.githubusercontent.com", "github.com")
    .replace(/\/([^/]+)\/([^/]+)\//, "/$1/$2/blob/");
}

/**
 * Fetches the help depot from GitHub
 * @returns Promise resolving to the help depot data
 */
export async function fetchHelpDepot(): Promise<HelpDepot> {
  try {
    const response = await fetch(HELP_DEPOT_URL);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch help depot: ${response.status} ${response.statusText}`
      );
    }
    const depot: HelpDepot = await response.json();
    return depot;
  } catch (error) {
    console.error("Error fetching help depot:", error);
    throw error;
  }
}

/**
 * Gets enabled topic IDs from extension storage
 * If no topics are enabled yet, returns all built-in topic IDs by default
 * @returns Array of enabled topic IDs
 */
export function getEnabledTopicIds(): string[] {
  const stored = extensionStorage.get("help-enabled-topics");
  if (stored) {
    return JSON.parse(stored);
  }

  // First time: enable all built-in topics by default
  const defaultIds = BUILTIN_LIVEAI_TOPICS.map((t) => t.id);
  setEnabledTopicIds(defaultIds);
  return defaultIds;
}

/**
 * Sets enabled topic IDs in extension storage
 * @param topicIds - Array of topic IDs to enable
 */
export function setEnabledTopicIds(topicIds: string[]): void {
  // Enforce maximum limit
  const limited = topicIds.slice(0, MAX_ENABLED_TOPICS);
  extensionStorage.set("help-enabled-topics", JSON.stringify(limited));
}

/**
 * Gets the cached help depot from extension storage
 * @returns Cached help depot or null
 */
export function getCachedDepot(): HelpDepot | null {
  const stored = extensionStorage.get("help-depot-cache");
  return stored ? JSON.parse(stored) : null;
}

/**
 * Caches the help depot in extension storage
 * @param depot - Help depot to cache
 */
export function setCachedDepot(depot: HelpDepot): void {
  extensionStorage.set("help-depot-cache", JSON.stringify(depot));
}

/**
 * Gets enabled topics with their full data
 * @returns Array of enabled topics with full data
 */
export function getEnabledTopics(): HelpTopic[] {
  const depot = getCachedDepot();

  // If no cached depot, return built-in topics by default
  if (!depot) {
    return BUILTIN_LIVEAI_TOPICS;
  }

  const enabledIds = getEnabledTopicIds();
  return depot.topics.filter((topic) => enabledIds.includes(topic.id));
}

/**
 * Loads depot from cache or fetches from GitHub if needed
 * Always includes built-in Live AI topics even if fetch fails
 * @param forceRefresh - Force fetch from GitHub even if cached
 * @returns Promise resolving to help depot
 */
export async function loadDepot(
  forceRefresh: boolean = false
): Promise<HelpDepot> {
  // Try to load from cache first (unless forcing refresh)
  if (!forceRefresh) {
    const cached = getCachedDepot();
    if (cached) return cached;
  }

  // Try to fetch from GitHub
  try {
    const depot = await fetchHelpDepot();

    // Merge built-in topics with fetched topics
    const mergedTopics = [...BUILTIN_LIVEAI_TOPICS, ...depot.topics];
    const mergedDepot = {
      ...depot,
      topics: mergedTopics,
    };

    setCachedDepot(mergedDepot);
    return mergedDepot;
  } catch (error) {
    console.warn(
      "Failed to fetch help depot from GitHub, using built-in topics only:",
      error
    );

    // If fetch fails, return depot with only built-in topics
    const fallbackDepot: HelpDepot = {
      topics: BUILTIN_LIVEAI_TOPICS,
      categories: {
        "extension-liveai": "Live AI extension docs",
        "roam-core": "Roam Research documentation and tips",
      },
    };

    // Cache the fallback depot
    setCachedDepot(fallbackDepot);
    return fallbackDepot;
  }
}

/**
 * Fetches documentation from a help topic
 * @param topic - Help topic to fetch
 * @returns Promise resolving to the documentation content
 */
export async function fetchTopicDocumentation(
  topic: HelpTopic
): Promise<string> {
  const rawUrl = convertGithubUrlToRaw(topic.url);
  const response = await fetch(rawUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch documentation: ${response.status} ${response.statusText}`
    );
  }

  return await response.text();
}

/**
 * Initializes the help depot system
 * Should be called once after extensionStorage is initialized
 * Loads depot from cache or fetches from GitHub in background
 */
export async function initializeHelpDepot(): Promise<void> {
  try {
    // Load depot in background (don't await to avoid blocking extension load)
    loadDepot().catch((error) => {
      console.warn("Failed to initialize help depot:", error);
    });
  } catch (error) {
    console.error("Error initializing help depot:", error);
  }
}
