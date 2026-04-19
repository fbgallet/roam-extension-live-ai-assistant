/**
 * Council Agent Invocation Wrapper
 *
 * Provides a simple interface for invoking the LLM Council system.
 * Dispatches to iterative, parallel, or debate mode based on configuration.
 */

import { CouncilConfig, CouncilResult, DebateState } from "./council-types";
import {
  runIterativeCouncil,
  runParallelCouncil,
} from "./council-orchestrator";
import { runDebateCouncil, DebateInvokeResult } from "./council-debate";
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
  // ---- Debate mode only ----
  resumeState?: DebateState;
  additionalRounds?: number;
  forcedNextParticipantIndex?: number;
  humanMessage?: string;
  singleTurnOnly?: boolean;
  updateTurnCallback?: (turnId: string, content: string) => void;
  finalizeTurnCallback?: (
    turnId: string,
    content: string,
    tokensIn: number,
    tokensOut: number,
    concluded: boolean,
    extras?: { isPass?: boolean }
  ) => void;
}

export async function invokeCouncil(
  options: CouncilInvokeOptions,
): Promise<CouncilResult | DebateInvokeResult> {
  const { config } = options;

  // Render selected Roam blocks as a separate reference section. Each block is
  // rendered as "- ((uid)) content" so participants can cite them inline with
  // the ((uid)) syntax if they want to ground a claim.
  const renderReferenceBlocks = (): string | undefined => {
    if (!options.resultsContext || options.resultsContext.length === 0) {
      return undefined;
    }
    const lines = options.resultsContext
      .map((r: any) => {
        const body = (r.content || r.text || "").trim();
        const uid = r.uid;
        if (!body && !uid) return null;
        if (uid && body) return `- ((${uid})) ${body}`;
        if (uid) return `- ((${uid}))`;
        return `- ${body}`;
      })
      .filter(Boolean);
    return lines.length > 0 ? lines.join("\n") : undefined;
  };

  const referenceBlocks = renderReferenceBlocks();

  // For iterative + parallel (non-debate) modes, keep the legacy behaviour of
  // concatenating results into conversationContext — their orchestrators don't
  // know about a separate referenceBlocks field.
  let conversationContext = options.conversationContext || "";
  if (config.mode !== "debate" && referenceBlocks) {
    const desc = options.resultsDescription || "Search results context";
    conversationContext += `\n\n## ${desc}:\n${referenceBlocks}`;
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
  }
  if (config.mode === "parallel") {
    return runParallelCouncil(commonOptions);
  }
  // Debate mode — pass referenceBlocks as its own field.
  return runDebateCouncil({
    ...commonOptions,
    referenceBlocks,
    resumeState: options.resumeState,
    additionalRounds: options.additionalRounds,
    forcedNextParticipantIndex: options.forcedNextParticipantIndex,
    humanMessage: options.humanMessage,
    singleTurnOnly: options.singleTurnOnly,
    updateTurnCallback: options.updateTurnCallback,
    finalizeTurnCallback: options.finalizeTurnCallback,
  });
}
