/**
 * Chat Agent Tools
 *
 * Tool definitions and management for the chat agent
 */

import {
  SEARCH_TOOLS,
  getAvailableTools,
  listAvailableToolNames,
} from "../search-agent/tools/toolsRegistry";
import {
  CHAT_TOOLS,
  getChatToolsFromRegistry,
  listChatToolNames,
} from "./tools/chatToolsRegistry";

/**
 * Get tools for chat agent based on permissions and tool enablement
 */
export const getChatTools = (
  toolsEnabled: boolean,
  permissions: { contentAccess: boolean }
): any[] => {
  if (!toolsEnabled) {
    return [];
  }

  // For now, only return chat-specific tools (multiply) for testing
  // TODO: Re-enable search tools once multiply tool is working
  // const searchTools = getAvailableTools(permissions);
  const chatTools = getChatToolsFromRegistry(permissions);

  return chatTools; // Only chat-specific tools for now
  // return [...searchTools, ...chatTools]; // Full set when ready
};

/**
 * Get tool descriptions for system prompt
 */
export const getChatToolDescriptions = (
  toolsEnabled: boolean,
  permissions: { contentAccess: boolean }
): string => {
  if (!toolsEnabled) {
    return "";
  }

  // For now, only show chat-specific tools (multiply) for testing
  // TODO: Re-enable search tools once multiply tool is working
  // const searchToolNames = listAvailableToolNames(permissions);
  const chatToolNames = listChatToolNames(permissions);

  const descriptions = chatToolNames.map((name) => {
    const toolInfo = CHAT_TOOLS[name];
    return `- **${name}**: ${toolInfo.description}`;
  });

  // Full set when ready:
  // const descriptions = [
  //   ...searchToolNames.map((name) => {
  //     const toolInfo = SEARCH_TOOLS[name];
  //     return `- **${name}**: ${toolInfo.description}`;
  //   }),
  //   ...chatToolNames.map((name) => {
  //     const toolInfo = CHAT_TOOLS[name];
  //     return `- **${name}**: ${toolInfo.description}`;
  //   }),
  // ];

  return descriptions.join("\n");
};

/**
 * Check if tools are available based on permissions
 */
export const hasToolAccess = (permissions: { contentAccess: boolean }): boolean => {
  // At minimum, secure tools are always available
  return true;
};

/**
 * Get tool names available to the chat agent
 */
export const getAvailableToolNames = (permissions: {
  contentAccess: boolean;
}): string[] => {
  return listAvailableToolNames(permissions);
};
