import { findPagesByTitleTool } from "./findPagesByTitleTool";
// import { findPagesSemanticallyTool } from './findPagesSemanticallyTool'; // DEPRECATED: Use findPagesByTitle with smartExpansion
import { findBlocksByContentTool } from "./findBlocksByContentTool";
import { findBlocksWithHierarchyTool } from "./findBlocksWithHierarchy/findBlocksWithHierarchyTool";
import { findPagesByContentTool } from "./findPagesByContentTool";
import { extractHierarchyContentTool } from "./extractHierarchyContentTool";
import { combineResultsTool } from "./combineResultsTool";
import { executeDatomicQueryTool } from "./executeDatomicQueryTool";
import { extractPageReferencesTool } from "./extractPageReferencesTool";
import { getNodeDetailsTool } from "./getNodeDetailsTool";

/**
 * Registry of all ReAct Search Agent tools with security levels
 * Provides easy filtering based on permissions
 */

export interface ToolInfo {
  tool: any;
  securityLevel: "secure" | "content";
  description: string;
}

// Define all tools with their security levels
export const SEARCH_TOOLS: Record<string, ToolInfo> = {
  findPagesByTitle: {
    tool: findPagesByTitleTool,
    securityLevel: "secure",
    description:
      "Find pages by title conditions with exact, contains, or regex matching. Supports smart expansion - finds similar existing pages + semantic variations with existence validation",
  },

  // findPagesSemantically: {
  //   tool: findPagesSemanticallyTool,
  //   securityLevel: "secure",
  //   description: "Find pages using semantic search with AI-powered term expansion - DEPRECATED: Use findPagesByTitle with smartExpansion instead"
  // },

  findBlocksByContent: {
    tool: findBlocksByContentTool,
    securityLevel: "secure",
    description:
      "Find blocks by content conditions with semantic expansion and hierarchy support",
  },

  findBlocksWithHierarchy: {
    tool: findBlocksWithHierarchyTool,
    securityLevel: "secure", // Flexible: secure mode available via secureMode parameter
    description:
      "Find blocks with hierarchical context using content and structural conditions (flexible security via secureMode)",
  },

  findPagesByContent: {
    tool: findPagesByContentTool,
    securityLevel: "secure", // Flexible: secure mode available via secureMode parameter
    description:
      "Find pages by analyzing their block content with aggregation and filtering (flexible security via secureMode)",
  },

  extractHierarchyContent: {
    tool: extractHierarchyContentTool,
    securityLevel: "content",
    description:
      "Extract and format hierarchical content from specific blocks with multiple output formats",
  },

  combineResults: {
    tool: combineResultsTool,
    securityLevel: "secure",
    description:
      "Combine and deduplicate results from multiple search operations using set operations (union, intersection, difference) - ESSENTIAL for complex OR queries by running separate searches then combining",
  },

  executeDatomicQuery: {
    tool: executeDatomicQueryTool,
    securityLevel: "secure",
    description:
      "Execute Datalog queries against Roam database - supports user-provided queries, auto-generation from criteria, and parameterized queries with variables",
  },

  extractPageReferences: {
    tool: extractPageReferencesTool,
    securityLevel: "secure",
    description:
      "Extract and count page references from blocks or pages using fast database queries - perfect for analytical tasks",
  },

  getNodeDetails: {
    tool: getNodeDetailsTool,
    securityLevel: "content",
    description:
      "Fetch detailed information about specific blocks or pages when you need more context - includes full content",
  },
};

/**
 * Get available tools based on security permissions
 */
export const getAvailableTools = (permissions: { contentAccess: boolean }) => {
  const availableTools = [];

  for (const [name, info] of Object.entries(SEARCH_TOOLS)) {
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
export const getToolInfo = (toolName: string): ToolInfo | undefined => {
  return SEARCH_TOOLS[toolName];
};

/**
 * Get all secure-level tools (always available)
 */
export const getSecureTools = () => {
  return Object.values(SEARCH_TOOLS)
    .filter((info) => info.securityLevel === "secure")
    .map((info) => info.tool);
};

/**
 * Get all content-level tools (require permission)
 */
export const getContentTools = () => {
  return Object.values(SEARCH_TOOLS)
    .filter((info) => info.securityLevel === "content")
    .map((info) => info.tool);
};

/**
 * List available tool names based on permissions
 */
export const listAvailableToolNames = (permissions: {
  contentAccess: boolean;
}): string[] => {
  const names = [];

  for (const [name, info] of Object.entries(SEARCH_TOOLS)) {
    if (
      info.securityLevel === "secure" ||
      (info.securityLevel === "content" && permissions.contentAccess)
    ) {
      names.push(name);
    }
  }

  return names;
};
