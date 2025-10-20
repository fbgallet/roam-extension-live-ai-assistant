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

  return getAvailableTools(permissions);
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

  const toolNames = listAvailableToolNames(permissions);

  const descriptions = toolNames.map((name) => {
    const toolInfo = SEARCH_TOOLS[name];
    return `- **${name}**: ${toolInfo.description}`;
  });

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
