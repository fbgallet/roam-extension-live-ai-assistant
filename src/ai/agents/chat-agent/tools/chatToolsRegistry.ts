/**
 * Chat Agent Tools Registry
 *
 * Registry of tools specific to the chat agent (separate from search agent tools)
 */

import { addPagesByTitleTool } from "./addPagesByTitleTool";
import { addLinkedReferencesByTitleTool } from "./addLinkedReferencesByTitleTool";
import { selectResultsByCriteriaTool } from "./selectResultsByCriteriaTool";
import { helpTool } from "./helpTool";
import { liveaiSkillsTool } from "./liveaiSkillsTool";

export interface ChatToolInfo {
  tool: any;
  securityLevel: "secure" | "content";
  description: string;
}

// Define all chat-specific tools with their security levels
export const CHAT_TOOLS: Record<string, ChatToolInfo> = {
  add_pages_by_title: {
    tool: addPagesByTitleTool,
    securityLevel: "secure",
    description:
      "Add one or more pages to the chat context by their titles. Optionally includes first-level child blocks. Use when user asks about pages not currently in the conversation.",
  },
  add_linked_references_by_title: {
    tool: addLinkedReferencesByTitleTool,
    securityLevel: "secure",
    description:
      "Add all blocks that reference a given page to the chat context. Use when user wants to see what mentions or references a particular page/topic.",
  },
  select_results_by_criteria: {
    tool: selectResultsByCriteriaTool,
    securityLevel: "secure",
    description:
      "Select (check) results based on various criteria like date ranges, content patterns, or intelligent semantic analysis. Use when user wants to filter or focus on specific results or ask to select only some items to reduce the context.",
  },
  get_help: {
    tool: helpTool,
    securityLevel: "secure",
    description:
      "Fetch Live AI extension documentation when users ask for help about features, pricing, agents, or how to use the extension. Automatically retrieves relevant .md files from GitHub.",
  },
  live_ai_skills: {
    tool: liveaiSkillsTool,
    securityLevel: "secure",
    description:
      "Access specialized skills stored in Roam with #liveai/skill tag. Skills provide instructions and resources for specific tasks/workflows. Load progressively: start with core instructions, then request deeper resources only when needed.",
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
