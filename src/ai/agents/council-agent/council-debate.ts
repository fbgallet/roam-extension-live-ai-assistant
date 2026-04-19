/**
 * Debate Orchestrator
 *
 * Runs a multi-LLM debate: 2-6 participants take turns in a fixed rotation
 * (autonomous mode) or one turn at a time with user control (human-in-loop).
 *
 * Each LLM turn streams into its OWN chat bubble via intermediateCallback +
 * turn-id-keyed content updates — unlike iterative/parallel modes where only
 * the final answer streams into the shared streaming area.
 */

import {
  CouncilConfig,
  CouncilResult,
  DebateParticipant,
  DebateState,
  DebateTurn,
} from "./council-types";
import {
  BUILTIN_ROLE_DEFINITIONS,
  buildDebateSystemPrompt,
  buildDebateUserPrompt,
  buildConcludeVoteUserPrompt,
  buildReactionSystemPrompt,
  buildReactionUserPrompt,
  buildSpeakerName,
  detectConcludeSignal,
  detectPassSignal,
  isOnlyConcludeVote,
  parseNextSuggestion,
  parseReactInvitations,
  stripSuffixMarkers,
} from "./council-debate-prompts";
import { resolveRole } from "./debate-roles";
import { generateResponse } from "./council-orchestrator";
import { getDisplayName } from "../../modelRegistry";
import { ChatMessage } from "../../../components/full-results-popup/types/types";

export interface DebateInvokeOptions {
  config: CouncilConfig;
  userMessage: string;
  conversationContext?: string;
  referenceBlocks?: string;
  resumeState?: DebateState;
  additionalRounds?: number; // Continue button: how many more rounds to run
  forcedNextParticipantIndex?: number; // human-in-loop: user picked speaker
  humanMessage?: string; // human-in-loop: user speaks
  singleTurnOnly?: boolean; // human-in-loop: one turn then pause
  streamingCallback?: (content: string) => void; // unused for debate (per-turn streaming instead)
  intermediateCallback?: (message: ChatMessage) => void;
  updateTurnCallback?: (turnId: string, content: string) => void; // per-turn stream updates
  finalizeTurnCallback?: (
    turnId: string,
    content: string,
    tokensIn: number,
    tokensOut: number,
    concluded: boolean,
    extras?: { isPass?: boolean }
  ) => void;
  abortSignal?: AbortSignal;
}

export interface DebateInvokeResult extends CouncilResult {
  state: DebateState;
}

// ==================== Init ====================

function buildSpeakerNames(participants: DebateParticipant[]): string[] {
  const names: string[] = [];
  for (const p of participants) {
    const customName = p.role.customName?.trim();
    if (customName) {
      // Disambiguate if the custom name collides with an existing one.
      let candidate = customName;
      let i = 2;
      while (names.includes(candidate)) {
        candidate = `${customName} #${i}`;
        i += 1;
      }
      names.push(candidate);
      continue;
    }
    const roleLabel =
      p.role.kind === "builtin"
        ? BUILTIN_ROLE_DEFINITIONS[p.role.builtinId || "none"]?.label ||
          "Participant"
        : p.role.kind === "custom-graph"
          ? p.role.graphLabel || "Custom role"
          : "Custom";
    const name = buildSpeakerName(roleLabel, p.modelId, names);
    names.push(name);
  }
  return names;
}

function initDebateState(
  config: CouncilConfig,
  topic: string,
  conversationContext?: string,
  referenceBlocks?: string
): DebateState {
  const participants = config.debateParticipants;
  return {
    participants,
    speakerNames: buildSpeakerNames(participants),
    subMode: config.debateSubMode,
    turns: [],
    currentRound: 1,
    nextParticipantIndex: 0,
    maxRounds: config.debateMaxRounds,
    wordLimitPerTurn: config.debateWordLimitPerTurn,
    allowConclude: config.debateAllowConclude,
    topic,
    conversationContext,
    referenceBlocks,
    status: "running",
    ordering: participants.length >= 3 ? config.debateOrdering : "fixed",
    allowReactions: config.debateAllowReactions,
    humanName: (config.debateHumanName && config.debateHumanName.trim()) || "Human",
  };
}

// ==================== Next-speaker picker ====================

/**
 * Returns the last non-reaction, non-pass main turn — the "live" turn whose
 * addressee override (if any) should decide the next speaker.
 */
function lastMainTurn(turns: DebateTurn[]): DebateTurn | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const t = turns[i];
    if (t.isReaction) continue;
    return t;
  }
  return null;
}

/**
 * Counts participants (by index) who have already spoken a main turn in the
 * current round. Reactions, passes, and human turns do not count.
 */
function speakersInCurrentRound(state: DebateState): Set<number> {
  const set = new Set<number>();
  for (const t of state.turns) {
    if (t.round !== state.currentRound) continue;
    if (t.isReaction) continue;
    if (t.isPass) continue;
    if (t.participantIndex < 0) continue;
    set.add(t.participantIndex);
  }
  return set;
}

/**
 * Picks the next speaker index. Precedence:
 *  1. Addressee override (`>>> next: X`) from the most recent main turn, if it
 *     resolves to a valid participant index ≠ the speaker who just spoke.
 *  2. Ordering mode:
 *     - `fixed` → state.nextParticipantIndex
 *     - `random` (fair-rotation) → pick at random among participants who
 *       haven't yet spoken this round, excluding the last speaker. If only the
 *       last speaker remains eligible, pick them (round is effectively over).
 *
 * When called with `forcedIndex`, always returns that index (used for
 * human-in-loop speaker-picking).
 */
function pickNextSpeaker(
  state: DebateState,
  forcedIndex?: number
): number {
  const N = state.participants.length;
  if (forcedIndex !== undefined) return forcedIndex;

  // Addressee override.
  const last = lastMainTurn(state.turns);
  if (last && last.nextSuggestion) {
    const idx = state.speakerNames.indexOf(last.nextSuggestion);
    if (idx >= 0 && idx !== last.participantIndex) return idx;
  }

  if (state.ordering === "fixed") {
    return state.nextParticipantIndex;
  }

  // Random fair rotation.
  const lastIdx = last?.participantIndex ?? -1;
  const spoken = speakersInCurrentRound(state);
  const eligible: number[] = [];
  for (let idx = 0; idx < N; idx += 1) {
    if (idx === lastIdx) continue; // no immediate repeat
    if (spoken.has(idx)) continue; // has already spoken this round
    eligible.push(idx);
  }
  if (eligible.length === 0) {
    // Every other participant has spoken this round — start a fresh round by
    // picking randomly from everyone except the last speaker.
    const fresh: number[] = [];
    for (let idx = 0; idx < N; idx += 1) {
      if (idx !== lastIdx) fresh.push(idx);
    }
    if (fresh.length === 0) return lastIdx >= 0 ? lastIdx : 0; // N=1 edge case
    return fresh[Math.floor(Math.random() * fresh.length)];
  }
  return eligible[Math.floor(Math.random() * eligible.length)];
}

/**
 * Advances rotation state after a main (non-reaction) turn. For `fixed`
 * ordering, rolls `nextParticipantIndex` one step. For `random`, increments
 * the round whenever every participant has spoken once.
 */
function advanceRotation(state: DebateState, spokenIdx: number): void {
  const N = state.participants.length;
  if (state.ordering === "fixed") {
    state.nextParticipantIndex = (spokenIdx + 1) % N;
    if (state.nextParticipantIndex === 0) {
      state.currentRound += 1;
    }
    return;
  }
  // Random: increment round when all participants have spoken this round.
  const spoken = speakersInCurrentRound(state);
  if (spoken.size >= N) {
    state.currentRound += 1;
  }
  // nextParticipantIndex still tracks "the index to try first in fixed mode".
  // Keep it advanced for compatibility with human-in-loop displays.
  state.nextParticipantIndex = (spokenIdx + 1) % N;
}

// ==================== Intermediate message helpers ====================

function turnStartMessage(
  turnId: string,
  state: DebateState,
  participantIndex: number,
  round: number,
  isHuman: boolean
): ChatMessage {
  const humanLabel = state.humanName || "Human";
  const speakerName =
    participantIndex === -1 ? humanLabel : state.speakerNames[participantIndex];
  const roleLabel =
    participantIndex === -1
      ? humanLabel
      : (() => {
          const p = state.participants[participantIndex];
          if (p.role.kind === "builtin") {
            return (
              BUILTIN_ROLE_DEFINITIONS[p.role.builtinId || "none"]?.label ||
              "Participant"
            );
          }
          if (p.role.kind === "custom-graph")
            return p.role.graphLabel || "Custom role";
          return "Custom";
        })();
  const modelId =
    participantIndex === -1 ? "__human__" : state.participants[participantIndex].modelId;
  return {
    role: "assistant",
    content: "",
    timestamp: new Date(),
    model: modelId,
    councilStep: {
      type: "debate-turn",
      councilMode: "debate",
      turnId,
      round,
      participantIndex,
      speakerName,
      roleLabel,
      model: modelId,
      modelDisplayName: isHuman ? humanLabel : getDisplayName(modelId) || modelId,
      isIntermediate: false,
      isHuman,
      isComplete: false,
    },
  };
}

// ==================== Main orchestrator ====================

export async function runDebateCouncil(
  opts: DebateInvokeOptions
): Promise<DebateInvokeResult> {
  const startTime = Date.now();

  let state: DebateState =
    opts.resumeState ??
    initDebateState(
      opts.config,
      opts.userMessage,
      opts.conversationContext,
      opts.referenceBlocks,
    );

  // Reset transient status when resuming.
  if (
    state.status === "paused-round-limit" ||
    state.status === "paused-human" ||
    state.status === "stopped"
  ) {
    state = { ...state, status: "running" };
  }

  let totalTokensIn = state.turns.reduce((s, t) => s + t.tokensIn, 0);
  let totalTokensOut = state.turns.reduce((s, t) => s + t.tokensOut, 0);

  // ---- Handle a human message contribution (no LLM call) ----
  if (opts.humanMessage && opts.humanMessage.trim()) {
    const content = opts.humanMessage.trim();
    const turnId = `turn-${Date.now()}-human`;
    const humanLabel = state.humanName || "Human";
    const humanTurn: DebateTurn = {
      participantIndex: -1,
      modelId: "__human__",
      speakerName: humanLabel,
      roleLabel: humanLabel,
      round: state.currentRound,
      content,
      concluded: false,
      tokensIn: 0,
      tokensOut: 0,
      timestamp: new Date(),
    };
    state.turns.push(humanTurn);
    const msg = turnStartMessage(turnId, state, -1, state.currentRound, true);
    msg.content = content;
    if (msg.councilStep) msg.councilStep.isComplete = true;
    opts.intermediateCallback?.(msg);
  }

  // ---- Compute target round ----
  const N = state.participants.length;
  if (N < 2) {
    state.status = "stopped";
    return buildResult(state, totalTokensIn, totalTokensOut, startTime);
  }

  const additional =
    opts.additionalRounds ??
    (opts.resumeState ? 0 : state.maxRounds - state.currentRound + 1);
  // When resuming with no additional specified, we simply run one more turn (single-turn mode) OR nothing.
  const targetRound = state.currentRound + Math.max(0, additional) - 1;
  // If additional === 0 and we're in single-turn mode, we still want to run exactly one turn.
  const runAtLeastOneTurn = opts.singleTurnOnly || opts.forcedNextParticipantIndex !== undefined;

  let forcedIndex = opts.forcedNextParticipantIndex;
  let turnsRun = 0;

  while (true) {
    if (opts.abortSignal?.aborted) {
      state.status = "stopped";
      break;
    }

    // Round-limit check (skip if we're forced to run at least one turn for human-in-loop).
    if (state.currentRound > targetRound && !(runAtLeastOneTurn && turnsRun === 0)) {
      state.status = "paused-round-limit";
      break;
    }

    const i = pickNextSpeaker(state, forcedIndex);
    const p = state.participants[i];
    const speakerName = state.speakerNames[i];
    const resolvedRole = await resolveRole(p.role);

    const peers = state.participants.map((pp, idx) => ({
      name: state.speakerNames[idx],
      roleLabel:
        pp.role.kind === "builtin"
          ? BUILTIN_ROLE_DEFINITIONS[pp.role.builtinId || "none"]?.label ||
            "Participant"
          : pp.role.kind === "custom-graph"
            ? pp.role.graphLabel || "Custom role"
            : "Custom",
      modelId: pp.modelId,
    }));

    const systemPrompt = buildDebateSystemPrompt({
      participant: p,
      speakerName,
      roleLabel: resolvedRole.label,
      roleFragment: resolvedRole.fragment,
      allPeers: peers,
      subMode: state.subMode,
      allowConclude: state.allowConclude,
      allowReactions: state.allowReactions,
      wordLimit: state.wordLimitPerTurn,
      hasReferenceBlocks: !!state.referenceBlocks,
      humanName: state.humanName,
    });
    const userPrompt = buildDebateUserPrompt({
      topic: state.topic,
      turns: state.turns,
      conversationContext: state.conversationContext,
      referenceBlocks: state.referenceBlocks,
      speakerName,
      wordLimit: state.wordLimitPerTurn,
    });

    const turnId = `turn-${Date.now()}-${i}-${state.currentRound}`;
    const startMsg = turnStartMessage(turnId, state, i, state.currentRound, false);
    opts.intermediateCallback?.(startMsg);

    const wrappedStream = (accumulated: string) => {
      opts.updateTurnCallback?.(turnId, accumulated);
    };

    let result: { content: string; tokensIn: number; tokensOut: number } | null =
      null;
    try {
      result = await generateResponse(
        p.modelId,
        systemPrompt,
        userPrompt,
        wrappedStream,
        p.role.temperature
      );
    } catch (err: any) {
      if (err?.name === "AbortError" || opts.abortSignal?.aborted) {
        state.status = "stopped";
        break;
      }
      throw err;
    }

    if (!result) {
      // API key missing / model unavailable — stop gracefully.
      state.status = "stopped";
      break;
    }

    if (opts.abortSignal?.aborted) {
      state.status = "stopped";
      break;
    }

    // ---- Parse suffix markers & detect PASS / CONCLUDE ----
    const rawContent = result.content;
    const isPass = detectPassSignal(rawContent);
    const nextSuggestion = isPass
      ? undefined
      : parseNextSuggestion(rawContent, state.speakerNames) || undefined;
    const invitedReactors = isPass
      ? []
      : parseReactInvitations(rawContent, state.speakerNames, 2);
    const displayedContent = isPass
      ? "*(passed this turn)*"
      : stripSuffixMarkers(rawContent);

    const rawConcludeSignal =
      !isPass && state.allowConclude && detectConcludeSignal(rawContent);
    const canPropose =
      rawConcludeSignal &&
      state.currentRound >= 2 &&
      state.subMode === "autonomous";

    const turn: DebateTurn = {
      participantIndex: i,
      modelId: p.modelId,
      speakerName,
      roleLabel: resolvedRole.label,
      round: state.currentRound,
      content: displayedContent,
      concluded: canPropose,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      timestamp: new Date(),
      isPass: isPass || undefined,
      nextSuggestion,
      invitedReactors: invitedReactors.length ? invitedReactors : undefined,
    };
    state.turns.push(turn);
    totalTokensIn += result.tokensIn;
    totalTokensOut += result.tokensOut;

    opts.finalizeTurnCallback?.(
      turnId,
      displayedContent,
      result.tokensIn,
      result.tokensOut,
      canPropose,
      { isPass }
    );

    // ---- Reactions (autonomous main turn, not pass, not conclude-vote-proposer) ----
    if (
      !isPass &&
      !canPropose &&
      state.allowReactions &&
      invitedReactors.length > 0
    ) {
      const reactionTokens = await runReactions({
        state,
        mainSpeakerName: speakerName,
        mainTurnContent: displayedContent,
        invitedReactors,
        peers,
        intermediateCallback: opts.intermediateCallback,
        updateTurnCallback: opts.updateTurnCallback,
        finalizeTurnCallback: opts.finalizeTurnCallback,
        abortSignal: opts.abortSignal,
      });
      totalTokensIn += reactionTokens.tokensIn;
      totalTokensOut += reactionTokens.tokensOut;
      if (reactionTokens.aborted) {
        state.status = "stopped";
        break;
      }
    }

    advanceRotation(state, i);
    forcedIndex = undefined;
    turnsRun += 1;

    if (canPropose) {
      // Run the conclusion-confirmation vote inline.
      const voteResult = await runConcludeVote({
        state,
        proposerIndex: i,
        proposerSpeakerName: speakerName,
        totalTokensIn,
        totalTokensOut,
        peers,
        intermediateCallback: opts.intermediateCallback,
        updateTurnCallback: opts.updateTurnCallback,
        finalizeTurnCallback: opts.finalizeTurnCallback,
        abortSignal: opts.abortSignal,
      });
      totalTokensIn = voteResult.totalTokensIn;
      totalTokensOut = voteResult.totalTokensOut;
      if (voteResult.aborted) {
        state.status = "stopped";
        break;
      }
      if (voteResult.allAgreed) {
        state.status = "concluded";
        break;
      }
      // Someone disagreed — their response has already been posted as a turn
      // and the rotation has been advanced. Continue the loop.
      if (opts.singleTurnOnly) {
        state.status = "paused-human";
        break;
      }
      continue;
    }

    if (opts.singleTurnOnly) {
      state.status = "paused-human";
      break;
    }
  }

  // If loop broke naturally at round boundary and status is still "running", set paused-round-limit.
  if ((state.status as string) === "running" && state.currentRound > targetRound) {
    state.status = "paused-round-limit";
  }

  return buildResult(state, totalTokensIn, totalTokensOut, startTime);
}

// ==================== Conclusion vote ====================

interface RunConcludeVoteArgs {
  state: DebateState;
  proposerIndex: number;
  proposerSpeakerName: string;
  totalTokensIn: number;
  totalTokensOut: number;
  peers: { name: string; roleLabel: string; modelId: string }[];
  intermediateCallback?: (message: ChatMessage) => void;
  updateTurnCallback?: (turnId: string, content: string) => void;
  finalizeTurnCallback?: (
    turnId: string,
    content: string,
    tokensIn: number,
    tokensOut: number,
    concluded: boolean,
    extras?: { isPass?: boolean }
  ) => void;
  abortSignal?: AbortSignal;
}

interface RunConcludeVoteResult {
  allAgreed: boolean;
  aborted: boolean;
  totalTokensIn: number;
  totalTokensOut: number;
}

async function runConcludeVote(
  args: RunConcludeVoteArgs
): Promise<RunConcludeVoteResult> {
  const { state, proposerIndex, proposerSpeakerName, peers } = args;
  let { totalTokensIn, totalTokensOut } = args;
  const N = state.participants.length;

  // Post a status card announcing the vote.
  args.intermediateCallback?.({
    role: "assistant",
    content: `**${proposerSpeakerName}** proposed to conclude. Asking the other participants to confirm…`,
    timestamp: new Date(),
    councilStep: {
      type: "status",
      councilMode: "debate",
      isIntermediate: false,
    },
  });

  // Voter order: start from nextParticipantIndex (already advanced past proposer),
  // walk around the ring exactly N-1 times.
  let voterIdx = state.nextParticipantIndex;
  for (let step = 0; step < N - 1; step += 1) {
    if (args.abortSignal?.aborted) {
      return { allAgreed: false, aborted: true, totalTokensIn, totalTokensOut };
    }
    const voter = state.participants[voterIdx];
    const voterName = state.speakerNames[voterIdx];
    const resolvedRole = await resolveRole(voter.role);

    const systemPrompt = buildDebateSystemPrompt({
      participant: voter,
      speakerName: voterName,
      roleLabel: resolvedRole.label,
      roleFragment: resolvedRole.fragment,
      allPeers: peers,
      subMode: state.subMode,
      allowConclude: state.allowConclude,
      allowReactions: false, // no reactions during a conclude vote
      wordLimit: state.wordLimitPerTurn,
      hasReferenceBlocks: !!state.referenceBlocks,
      humanName: state.humanName,
    });
    const userPrompt = buildConcludeVoteUserPrompt({
      topic: state.topic,
      turns: state.turns,
      conversationContext: state.conversationContext,
      referenceBlocks: state.referenceBlocks,
      speakerName: voterName,
      proposerName: proposerSpeakerName,
      wordLimit: state.wordLimitPerTurn,
    });

    const turnId = `vote-${Date.now()}-${voterIdx}-${state.currentRound}`;
    const startMsg = turnStartMessage(turnId, state, voterIdx, state.currentRound, false);
    args.intermediateCallback?.(startMsg);

    const wrappedStream = (accumulated: string) => {
      args.updateTurnCallback?.(turnId, accumulated);
    };

    let result: { content: string; tokensIn: number; tokensOut: number } | null = null;
    try {
      result = await generateResponse(
        voter.modelId,
        systemPrompt,
        userPrompt,
        wrappedStream,
        voter.role.temperature
      );
    } catch (err: any) {
      if (err?.name === "AbortError" || args.abortSignal?.aborted) {
        return { allAgreed: false, aborted: true, totalTokensIn, totalTokensOut };
      }
      throw err;
    }
    if (!result) {
      return { allAgreed: false, aborted: true, totalTokensIn, totalTokensOut };
    }

    totalTokensIn += result.tokensIn;
    totalTokensOut += result.tokensOut;

    const agreed = isOnlyConcludeVote(result.content);
    if (agreed) {
      // Collapse the vote message into a compact agreement marker.
      args.finalizeTurnCallback?.(
        turnId,
        `*✓ **${voterName}** agrees to conclude.*`,
        result.tokensIn,
        result.tokensOut,
        true
      );
      // Do NOT push this into state.turns — it's meta, not a debate contribution.
      // Advance voter pointer.
      voterIdx = (voterIdx + 1) % N;
      continue;
    }

    // Dissent: finalize as a real turn, push into state, advance rotation from voter,
    // and return allAgreed:false so the main loop continues from voter+1.
    args.finalizeTurnCallback?.(
      turnId,
      result.content,
      result.tokensIn,
      result.tokensOut,
      false
    );
    state.turns.push({
      participantIndex: voterIdx,
      modelId: voter.modelId,
      speakerName: voterName,
      roleLabel: resolvedRole.label,
      round: state.currentRound,
      content: result.content,
      concluded: false,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      timestamp: new Date(),
    });
    state.nextParticipantIndex = (voterIdx + 1) % N;
    if (state.nextParticipantIndex === 0) {
      state.currentRound += 1;
    }
    return { allAgreed: false, aborted: false, totalTokensIn, totalTokensOut };
  }

  // Every other participant agreed.
  return { allAgreed: true, aborted: false, totalTokensIn, totalTokensOut };
}

// ==================== Reactions ====================

interface RunReactionsArgs {
  state: DebateState;
  mainSpeakerName: string;
  mainTurnContent: string;
  invitedReactors: string[];
  peers: { name: string; roleLabel: string; modelId: string }[];
  intermediateCallback?: (message: ChatMessage) => void;
  updateTurnCallback?: (turnId: string, content: string) => void;
  finalizeTurnCallback?: (
    turnId: string,
    content: string,
    tokensIn: number,
    tokensOut: number,
    concluded: boolean,
    extras?: { isPass?: boolean }
  ) => void;
  abortSignal?: AbortSignal;
}

async function runReactions(args: RunReactionsArgs): Promise<{
  tokensIn: number;
  tokensOut: number;
  aborted: boolean;
}> {
  const { state, mainSpeakerName, mainTurnContent, invitedReactors } = args;
  let tokensIn = 0;
  let tokensOut = 0;

  for (const reactorName of invitedReactors) {
    if (args.abortSignal?.aborted) {
      return { tokensIn, tokensOut, aborted: true };
    }
    const reactorIdx = state.speakerNames.indexOf(reactorName);
    if (reactorIdx < 0) continue;
    // Skip self-reactions.
    if (reactorName === mainSpeakerName) continue;

    const reactor = state.participants[reactorIdx];
    const resolvedRole = await resolveRole(reactor.role);

    const systemPrompt = buildReactionSystemPrompt({
      speakerName: reactorName,
      roleLabel: resolvedRole.label,
      roleFragment: resolvedRole.fragment,
      mainSpeakerName,
      mainTurnContent,
    });
    const userPrompt = buildReactionUserPrompt({
      speakerName: reactorName,
      roleLabel: resolvedRole.label,
      roleFragment: resolvedRole.fragment,
      mainSpeakerName,
      mainTurnContent,
    });

    const turnId = `reaction-${Date.now()}-${reactorIdx}-${state.currentRound}`;
    // Emit a reaction placeholder message.
    const msg: ChatMessage = {
      role: "assistant",
      content: "",
      timestamp: new Date(),
      model: reactor.modelId,
      councilStep: {
        type: "debate-reaction",
        councilMode: "debate",
        turnId,
        round: state.currentRound,
        participantIndex: reactorIdx,
        speakerName: reactorName,
        roleLabel: resolvedRole.label,
        model: reactor.modelId,
        modelDisplayName: getDisplayName(reactor.modelId) || reactor.modelId,
        reactorOf: mainSpeakerName,
        isIntermediate: false,
        isComplete: false,
      },
    };
    args.intermediateCallback?.(msg);

    const wrappedStream = (accumulated: string) => {
      args.updateTurnCallback?.(turnId, accumulated);
    };

    let result: { content: string; tokensIn: number; tokensOut: number } | null =
      null;
    try {
      result = await generateResponse(
        reactor.modelId,
        systemPrompt,
        userPrompt,
        wrappedStream,
        reactor.role.temperature
      );
    } catch (err: any) {
      if (err?.name === "AbortError" || args.abortSignal?.aborted) {
        return { tokensIn, tokensOut, aborted: true };
      }
      throw err;
    }
    if (!result) {
      // Quietly skip if the model is unavailable — don't fail the whole debate.
      args.finalizeTurnCallback?.(
        turnId,
        "*(unavailable)*",
        0,
        0,
        false,
        { isPass: true }
      );
      continue;
    }
    tokensIn += result.tokensIn;
    tokensOut += result.tokensOut;

    const passed = detectPassSignal(result.content);
    // Strip any suffix markers the reactor might have emitted despite the
    // instructions — reactions are terminal.
    const stripped = passed
      ? "*(no reaction)*"
      : stripSuffixMarkers(result.content).trim();

    args.finalizeTurnCallback?.(
      turnId,
      stripped,
      result.tokensIn,
      result.tokensOut,
      false,
      { isPass: passed }
    );

    if (!passed) {
      state.turns.push({
        participantIndex: reactorIdx,
        modelId: reactor.modelId,
        speakerName: reactorName,
        roleLabel: resolvedRole.label,
        round: state.currentRound,
        content: stripped,
        concluded: false,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        timestamp: new Date(),
        isReaction: true,
        reactorOf: mainSpeakerName,
      });
    }
  }

  return { tokensIn, tokensOut, aborted: false };
}

function buildResult(
  state: DebateState,
  totalTokensIn: number,
  totalTokensOut: number,
  startTime: number
): DebateInvokeResult {
  const lastTurn = state.turns[state.turns.length - 1];
  return {
    finalAnswer: lastTurn?.content || "",
    generations: [],
    evaluations: [],
    totalTokensIn,
    totalTokensOut,
    duration: Date.now() - startTime,
    iterationsUsed: state.turns.length,
    mode: "debate",
    debateState: state,
    debateTurns: state.turns,
    state,
  };
}
