/**
 * Chat Agent Tools Registry
 *
 * Registry of tools specific to the chat agent (separate from search agent tools)
 */

import { multiplyTool } from "./multiplyTool";

export interface ChatToolInfo {
  tool: any;
  securityLevel: "secure" | "content";
  description: string;
}

// Define all chat-specific tools with their security levels
export const CHAT_TOOLS: Record<string, ChatToolInfo> = {
  multiply: {
    tool: multiplyTool,
    securityLevel: "secure",
    description:
      "Multiply two numbers together - simple test tool for demonstrating tool usage",
  },
};

/**
 * Get available chat tools based on security permissions
 */
export const getChatToolsFromRegistry = (permissions: {
  contentAccess: boolean;
}) => {
  const availableTools = [];

  for (const [, info] of Object.entries(CHAT_TOOLS)) {
    // Always include secure tools
    if (info.securityLevel === "secure") {
      availableTools.push(info.tool);
    }
    // Only include content tools if permission is granted
    else if (info.securityLevel === "content" && permissions.contentAccess) {
      availableTools.push(info.tool);
    }
  }

  return availableTools;
};

/**
 * Get tool info by name
 */
export const getChatToolInfo = (toolName: string): ChatToolInfo | undefined => {
  return CHAT_TOOLS[toolName];
};

/**
 * List available chat tool names based on permissions
 */
export const listChatToolNames = (permissions: {
  contentAccess: boolean;
}): string[] => {
  const names = [];

  for (const [name, info] of Object.entries(CHAT_TOOLS)) {
    if (
      info.securityLevel === "secure" ||
      (info.securityLevel === "content" && permissions.contentAccess)
    ) {
      names.push(name);
    }
  }

  return names;
};
