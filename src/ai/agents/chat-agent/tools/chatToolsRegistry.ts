/**
 * Chat Agent Tools Registry
 *
 * Registry of tools specific to the chat agent (separate from search agent tools)
 */

import { addPagesByTitleTool } from "./addPagesByTitleTool";
import { addLinkedReferencesByTitleTool } from "./addLinkedReferencesByTitleTool";
import { selectResultsByCriteriaTool } from "./selectResultsByCriteriaTool";
import { createHelpTool } from "./helpTool";
import { liveaiSkillsTool } from "./liveaiSkillsTool";
import { askYourGraphTool } from "./askYourGraphTool";

export interface ChatToolInfo {
  tool: any;
  securityLevel: "secure" | "content";
  description: string;
}

/**
 * Gets all chat-specific tools with their security levels
 * Recreates dynamic tools (like get_help) to pick up latest configuration
 */
function getChatToolsRegistry(): Record<string, ChatToolInfo> {
  return {
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
    ask_your_graph: {
      tool: askYourGraphTool,
      securityLevel: "secure",
      description:
        "Execute complex natural language queries in the user roam's knowledge graph using Ask Your Graph agent to find matching pages or blocks to add to context. Supports pattern matching, semantic search, boolean logic, date ranges, and advanced filtering. Use ONLY for genuinely database queries, not common questions - and prefer add_pages_by_title or add_linked_references_by_title for simple lookups.",
    },
    get_help: {
      tool: createHelpTool(), // Create fresh tool with current enabled topics
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
}

// Static registry for UI purposes (tool names, descriptions, etc.)
// For actual tool instances, use getChatToolsFromRegistry which calls getChatToolsRegistry()
// NOTE: This doesn't include actual tool instances, just metadata
export const CHAT_TOOLS: Record<string, ChatToolInfo> = {
  add_pages_by_title: {
    tool: null, // Will be created on-demand
    securityLevel: "secure",
    description:
      "Add one or more pages to the chat context by their titles. Optionally includes first-level child blocks. Use when user asks about pages not currently in the conversation.",
  },
  add_linked_references_by_title: {
    tool: null,
    securityLevel: "secure",
    description:
      "Add all blocks that reference a given page to the chat context. Use when user wants to see what mentions or references a particular page/topic.",
  },
  select_results_by_criteria: {
    tool: null,
    securityLevel: "secure",
    description:
      "Select (check) results based on various criteria like date ranges, content patterns, or intelligent semantic analysis. Use when user wants to filter or focus on specific results or ask to select only some items to reduce the context.",
  },
  ask_your_graph: {
    tool: null,
    securityLevel: "secure",
    description:
      "Execute complex natural language queries using the full search agent. Supports pattern matching, semantic search, boolean logic, date ranges, and advanced filtering. Use ONLY for genuinely complex queries - prefer add_pages_by_title or add_linked_references_by_title for simple lookups.",
  },
  get_help: {
    tool: null,
    securityLevel: "secure",
    description:
      "Fetch Live AI extension documentation when users ask for help about features, pricing, agents, or how to use the extension. Automatically retrieves relevant .md files from GitHub.",
  },
  live_ai_skills: {
    tool: null,
    securityLevel: "secure",
    description:
      "Access specialized skills stored in Roam with #liveai/skill tag. Skills provide instructions and resources for specific tasks/workflows. Load progressively: start with core instructions, then request deeper resources only when needed.",
  },
};

/**
 * Get available chat tools based on security permissions
 * Recreates the registry each time to pick up latest tool configurations
 */
export const getChatToolsFromRegistry = (permissions: {
  contentAccess: boolean;
}) => {
  // Get fresh registry with updated tool instances
  const registry = getChatToolsRegistry();
  const availableTools = [];

  for (const [, info] of Object.entries(registry)) {
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
