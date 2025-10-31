/**
 * Help Depot Utilities
 *
 * Manages the extended help topics from helpDepot.json and user-selected topic preferences.
 */

import { extensionStorage } from "../../../..";

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
export const MAX_ENABLED_TOPICS = 15;

// URL for the help depot JSON file
const HELP_DEPOT_URL =
  "https://raw.githubusercontent.com/fbgallet/roam-extension-live-ai-assistant/main/chat-agent/tools/helpDepot.json";

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
 * @returns Array of enabled topic IDs
 */
export function getEnabledTopicIds(): string[] {
  const stored = extensionStorage.get("help-enabled-topics");
  return stored ? JSON.parse(stored) : [];
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
  if (!depot) return [];

  const enabledIds = getEnabledTopicIds();
  return depot.topics.filter((topic) => enabledIds.includes(topic.id));
}

/**
 * Loads depot from cache or fetches from GitHub if needed
 * @param forceRefresh - Force fetch from GitHub even if cached
 * @returns Promise resolving to help depot
 */
export async function loadDepot(
  forceRefresh: boolean = false
): Promise<HelpDepot> {
  if (!forceRefresh) {
    const cached = getCachedDepot();
    if (cached) return cached;
  }

  const depot = await fetchHelpDepot();
  setCachedDepot(depot);
  return depot;
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
