/**
 * Centralized progress messages for query execution
 * This ensures consistent messaging across the application
 */

export const ProgressMessages = {
  // Composed query messages
  composedQueryStart: (stepCount: number) =>
    `🔄 Running composed query: ${stepCount + 1} queries in parallel...`,

  composedQueryComplete: (
    resultCount: number,
    totalBefore: number,
    executionTime?: string,
    tokens?: { input_tokens: number; output_tokens: number }
  ) => {
    let message = `✅ Composed query completed - ${resultCount} results (from ${totalBefore} before deduplication)`;
    if (executionTime) {
      message += ` • ${executionTime}`;
    }
    if (tokens && (tokens.input_tokens > 0 || tokens.output_tokens > 0)) {
      message += ` • ${tokens.input_tokens + tokens.output_tokens} tokens`;
    }
    return message;
  },

  composedQueryFailed: (error: string) => `❌ Composed query failed: ${error}`,

  // Simple query messages
  simpleQueryStart: (queryText: string) => {
    const preview = queryText.substring(0, 50);
    return `🔄 Executing query: ${preview}${queryText.length > 50 ? "..." : ""}`;
  },

  simpleQueryComplete: (
    resultCount: number,
    executionTime?: string,
    tokens?: { input_tokens: number; output_tokens: number }
  ) => {
    let message = `✅ Query completed - ${resultCount} results found`;
    if (executionTime) {
      message += ` • ${executionTime}`;
    }
    if (tokens && (tokens.input_tokens > 0 || tokens.output_tokens > 0)) {
      message += ` • ${tokens.input_tokens + tokens.output_tokens} tokens`;
    }
    return message;
  },

  simpleQueryFailed: (error: string) => `❌ Query failed: ${error}`,

  // Page selection messages
  pageSelectionStart: (count: number) =>
    `📄 Adding ${count} page selection(s)...`,

  pageSelectionProgress: (current: number, total: number, pageTitle: string) =>
    `📄 Adding page ${current}/${total}: ${pageTitle}...`,

  pageSelectionComplete: (
    finalCount: number,
    queryResults: number,
    addedCount: number
  ) => {
    if (queryResults > 0) {
      return `✅ Query completed - ${finalCount} results (${queryResults} from query + ${addedCount} from pages)`;
    } else {
      // PageSelections-only query
      return `✅ Page selection complete - ${finalCount} results added`;
    }
  },

  pageSelectionWithCounts: (pageCount: number, blockCount: number) =>
    `✅ Page selection: ${pageCount} page(s) and ${blockCount} block(s) loaded`,

  // Loading messages
  loadingPages: (count: number) => `📄 Loading ${count} page selection(s)...`,

  // Parallel execution messages
  parallelExecutionStart: (queryCount: number) =>
    `🔄 Executing ${queryCount} queries in parallel...`,

  // Generic execution messages
  executionError: (error: string) => `❌ Execution error: ${error}`,

  // Query status indicators
  queryQueued: () => "⏳ Queued...",
  queryCompleted: () => "✅ Completed",
  queryRunning: (message: string) => `🔍 ${message}`,
};

/**
 * Format execution summary with optional execution time and token usage
 */
export function formatExecutionSummary(
  resultCount: number,
  executionTime?: string,
  tokens?: { input_tokens: number; output_tokens: number }
): string {
  let message = `${resultCount} results`;
  if (executionTime) {
    message += ` • ${executionTime}`;
  }
  if (tokens && (tokens.input_tokens > 0 || tokens.output_tokens > 0)) {
    message += ` • ${tokens.input_tokens + tokens.output_tokens} tokens`;
  }
  return message;
}
