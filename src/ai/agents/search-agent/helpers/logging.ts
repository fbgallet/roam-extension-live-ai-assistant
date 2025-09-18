/**
 * Logging utilities for the search agent
 * Provides structured logging with debug levels
 */

// Environment check for debug mode
const isDebugMode = (typeof process !== 'undefined' && (process.env.NODE_ENV === 'development' || process.env.DEBUG_SEARCH_AGENT === 'true')) || false;

export const logger = {
  // Always shown - important info
  info: (message: string, ...args: any[]) => {
    console.log(`🔍 [SearchAgent] ${message}`, ...args);
  },

  // Only in debug mode - detailed tracing
  debug: (message: string, ...args: any[]) => {
    if (isDebugMode) {
      console.log(`🔧 [SearchAgent:Debug] ${message}`, ...args);
    }
  },

  // Always shown - warnings
  warn: (message: string, ...args: any[]) => {
    console.warn(`⚠️ [SearchAgent] ${message}`, ...args);
  },

  // Always shown - errors
  error: (message: string, ...args: any[]) => {
    console.error(`❌ [SearchAgent] ${message}`, ...args);
  },

  // Flow control logging - only in debug mode
  flow: (node: string, message: string, ...args: any[]) => {
    if (isDebugMode) {
      console.log(`🔀 [${node}] ${message}`, ...args);
    }
  },

  // Performance/timing - only in debug mode
  perf: (message: string, ...args: any[]) => {
    if (isDebugMode) {
      console.log(`⏱️ [SearchAgent:Perf] ${message}`, ...args);
    }
  },

  // Tool execution - only in debug mode
  tool: (toolName: string, message: string, ...args: any[]) => {
    if (isDebugMode) {
      console.log(`🛠️ [${toolName}] ${message}`, ...args);
    }
  }
};