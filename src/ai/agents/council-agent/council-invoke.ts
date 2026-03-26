/**
 * Council Agent Invocation Wrapper
 *
 * Provides a simple interface for invoking the LLM Council system.
 * Dispatches to iterative or parallel mode based on configuration.
 */

import { CouncilConfig, CouncilResult } from "./council-types";
import {
  runIterativeCouncil,
  runParallelCouncil,
} from "./council-orchestrator";
import { ChatMessage } from "../../../components/full-results-popup/types/types";

export interface CouncilInvokeOptions {
  config: CouncilConfig;
  userMessage: string;
  // Multi-turn conversation context
  conversationContext?: string;
  // Results context (from search results in the popup)
  resultsContext?: any[];
  resultsDescription?: string;
  // Style
  style?: string;
  // Streaming callback for the final response
  streamingCallback?: (content: string) => void;
  // Intermediate callback: pushes intermediate ChatMessage objects into the UI
  intermediateCallback?: (message: ChatMessage) => void;
  // Abort signal for cancellation
  abortSignal?: AbortSignal;
}

export async function invokeCouncil(
  options: CouncilInvokeOptions,
): Promise<CouncilResult> {
  const { config } = options;

  // Build results context string if provided
  let conversationContext = options.conversationContext || "";
  if (options.resultsContext && options.resultsContext.length > 0) {
    const resultsText = options.resultsContext
      .map(
        (r: any) =>
          r.content || r.text || (r.uid ? `((${r.uid}))` : ""),
      )
      .filter(Boolean)
      .join("\n\n");
    if (resultsText) {
      const desc = options.resultsDescription || "Search results context";
      conversationContext += `\n\n## ${desc}:\n${resultsText}`;
    }
  }

  const commonOptions = {
    config,
    userMessage: options.userMessage,
    conversationContext: conversationContext || undefined,
    style: options.style,
    streamingCallback: options.streamingCallback,
    intermediateCallback: options.intermediateCallback,
    abortSignal: options.abortSignal,
  };

  if (config.mode === "iterative") {
    return runIterativeCouncil(commonOptions);
  } else {
    return runParallelCouncil(commonOptions);
  }
}
