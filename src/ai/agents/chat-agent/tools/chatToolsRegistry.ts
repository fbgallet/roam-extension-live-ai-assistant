/**
 * Chat Agent Tools Registry
 *
 * Registry of tools specific to the chat agent (separate from search agent tools)
 */

import { addToContextTool } from "./addToContextTool";
import { selectResultsByCriteriaTool } from "./selectResultsByCriteriaTool";
import { createHelpTool } from "./helpTool";
import { liveaiSkillsTool } from "./liveaiSkillsTool";
import { askYourGraphTool } from "./askYourGraphTool";
import { createBlockTool } from "./createBlockTool";
import { createPageTool } from "./createPageTool";
import { updateBlockTool } from "./updateBlockTool";
import { deleteBlockTool } from "./deleteBlockTool";
import { askUserChoiceTool } from "./askUserChoiceTool";
import { randomPickTool } from "./randomPickTool";

export type ToolCategory = "context" | "edit" | "skills" | "interaction";

// Edit tools that require the section master switch
export const EDIT_TOOL_NAMES = ["create_block", "create_page", "update_block", "delete_block"];
// Special key for the edit section master switch
export const EDIT_SECTION_KEY = "section:edit";

export interface ChatToolInfo {
  tool: any;
  securityLevel: "secure" | "content";
  description: string;
  category: ToolCategory;
}

/**
 * Gets all chat-specific tools with their security levels
 * Recreates dynamic tools (like get_help) to pick up latest configuration
 */
function getChatToolsRegistry(): Record<string, ChatToolInfo> {
  return {
    // Context tools
    add_to_context: {
      tool: addToContextTool,
      securityLevel: "secure",
      category: "context",
      description:
        "Universal tool for adding Roam content (pages, blocks, linked references, sidebar, daily notes) to the chat context. Supports 'current page', 'focused block', and 'sidebar' in any language. Primary tool for expanding context.",
    },
    select_results_by_criteria: {
      tool: selectResultsByCriteriaTool,
      securityLevel: "secure",
      category: "context",
      description:
        "Select (check) results based on various criteria like date ranges, content patterns, or intelligent semantic analysis. Use when user wants to filter or focus on specific results or ask to select only some items to reduce the context.",
    },
    ask_your_graph: {
      tool: askYourGraphTool,
      securityLevel: "secure",
      category: "context",
      description:
        "Execute complex natural language queries in the user roam's knowledge graph using Ask Your Graph agent to find matching pages or blocks to add to context. Supports pattern matching, semantic search, boolean logic, date ranges, and advanced filtering. Use ONLY for genuinely database queries, not common questions - prefer add_to_context for simple lookups.",
    },
    get_help: {
      tool: createHelpTool(), // Create fresh tool with current enabled topics
      securityLevel: "secure",
      category: "context",
      description:
        "Fetch Live AI extension documentation when users ask for help about features, pricing, agents, or how to use the extension. Automatically retrieves relevant .md files from GitHub.",
    },
    // Edit tools
    create_block: {
      tool: createBlockTool,
      securityLevel: "secure",
      category: "edit",
      description:
        "Create blocks in Roam. REQUIRES 2 CALLS: 1) First call WITHOUT markdown_content to see the outline and style, 2) Second call WITH markdown_content formatted to match. Never skip the analysis step.",
    },
    create_page: {
      tool: createPageTool,
      securityLevel: "secure",
      category: "edit",
      description:
        "Create a new page in Roam from markdown content. Automatically converts date expressions (today, tomorrow, January 15, etc.) to Roam DNP format. Checks if page exists before creating - if it does, suggests appending content instead.",
    },
    update_block: {
      tool: updateBlockTool,
      securityLevel: "secure",
      category: "edit",
      description:
        'Update, modify, or move blocks in Roam. Uses mode flag: "browse" to view outline, "apply" to mutate. Batch mode: use batch_operations array (max 20). Supports content, heading, open/collapsed, and move operations.',
    },
    delete_block: {
      tool: deleteBlockTool,
      securityLevel: "secure",
      category: "edit",
      description:
        'Delete blocks from Roam (and all their children). Uses mode flag: "browse" to view outline, "delete" to remove. Batch mode: use batch_block_uids array (max 20). Deletion is irreversible.',
    },
    // Skills tool
    live_ai_skills: {
      tool: liveaiSkillsTool,
      securityLevel: "secure",
      category: "skills",
      description:
        "Access specialized skills stored in Roam with #liveai/skill tag. Skills provide instructions and resources for specific tasks/workflows. Load progressively: start with core instructions, then request deeper resources only when needed.",
    },
    // Interaction tools
    ask_user_choice: {
      tool: askUserChoiceTool,
      securityLevel: "secure",
      category: "interaction",
      description:
        "Present the user with an interactive choice form inline in chat. Use for ambiguous requests, quizzes/QCM, polls, preference selection, multi-path decisions, or any interactive experience requiring user input.",
    },
    random_pick: {
      tool: randomPickTool,
      securityLevel: "secure",
      category: "interaction",
      description:
        "Randomly pick one or more unique items from a list. Works with context results, user-provided lists, or LLM-generated lists. Always build the complete items array before calling.",
    },
  };
}

// Static registry for UI purposes (tool names, descriptions, etc.)
// For actual tool instances, use getChatToolsFromRegistry which calls getChatToolsRegistry()
// NOTE: This doesn't include actual tool instances, just metadata
export const CHAT_TOOLS: Record<string, ChatToolInfo> = {
  // Context tools
  add_to_context: {
    tool: null, // Will be created on-demand
    securityLevel: "secure",
    category: "context",
    description:
      "Universal tool for adding Roam content (pages, blocks, linked references, sidebar, daily notes) to the chat context. Supports 'current page', 'focused block', and 'sidebar' in any language. Primary tool for expanding context.",
  },
  select_results_by_criteria: {
    tool: null,
    securityLevel: "secure",
    category: "context",
    description:
      "Select (check) results based on various criteria like date ranges, content patterns, or intelligent semantic analysis. Use when user wants to filter or focus on specific results or ask to select only some items to reduce the context.",
  },
  ask_your_graph: {
    tool: null,
    securityLevel: "secure",
    category: "context",
    description:
      "Execute complex natural language queries using the full search agent. Supports pattern matching, semantic search, boolean logic, date ranges, and advanced filtering. Use ONLY for genuinely complex queries - prefer add_to_context for simple lookups.",
  },
  get_help: {
    tool: null,
    securityLevel: "secure",
    category: "context",
    description:
      "Fetch Live AI extension documentation when users ask for help about features, pricing, agents, or how to use the extension. Automatically retrieves relevant .md files from GitHub.",
  },
  // Edit tools
  create_block: {
    tool: null,
    securityLevel: "secure",
    category: "edit",
    description:
      "Create blocks in Roam. REQUIRES 2 CALLS: 1) First call WITHOUT markdown_content to see the outline and style, 2) Second call WITH markdown_content formatted to match. Never skip the analysis step.",
  },
  create_page: {
    tool: null,
    securityLevel: "secure",
    category: "edit",
    description:
      "Create a new page in Roam from markdown content. Automatically converts date expressions (today, tomorrow, January 15, etc.) to Roam DNP format. Checks if page exists before creating - if it does, suggests appending content instead.",
  },
  update_block: {
    tool: null,
    securityLevel: "secure",
    category: "edit",
    description:
      'Update, modify, or move blocks in Roam. Uses mode flag: "browse" to view outline, "apply" to mutate. Batch mode: use batch_operations array (max 20). Supports content, heading, open/collapsed, and move operations.',
  },
  delete_block: {
    tool: null,
    securityLevel: "secure",
    category: "edit",
    description:
      'Delete blocks from Roam (and all their children). Uses mode flag: "browse" to view outline, "delete" to remove. Batch mode: use batch_block_uids array (max 20). Deletion is irreversible.',
  },
  // Skills tool
  live_ai_skills: {
    tool: null,
    securityLevel: "secure",
    category: "skills",
    description:
      "Access specialized skills stored in Roam with #liveai/skill tag. Skills provide instructions and resources for specific tasks/workflows. Load progressively: start with core instructions, then request deeper resources only when needed.",
  },
  // Interaction tools
  ask_user_choice: {
    tool: null,
    securityLevel: "secure",
    category: "interaction",
    description:
      "Present the user with an interactive choice form inline in chat. Use for ambiguous requests, quizzes/QCM, polls, preference selection, multi-path decisions, or any interactive experience requiring user input.",
  },
  random_pick: {
    tool: null,
    securityLevel: "secure",
    category: "interaction",
    description:
      "Randomly pick one or more unique items from a list. Works with context results, user-provided lists, or LLM-generated lists. Always build the complete items array before calling.",
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
