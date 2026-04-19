/**
 * LLM Council Types
 *
 * Interfaces and types for the multi-LLM deliberation system.
 * Two modes: Iterative Refinement and Parallel Competition.
 */

export type CouncilMode = "iterative" | "parallel" | "debate";

export type DebateSubMode = "autonomous" | "human-in-loop";

export type BuiltInDebateRoleId =
  | "none"
  | "white-hat"
  | "red-hat"
  | "black-hat"
  | "yellow-hat"
  | "green-hat"
  | "blue-hat"
  | "socrates"
  | "devils-advocate"
  | "synthesizer-role"
  | "pragmatist"
  | "visionary";

export interface DebateRoleRef {
  kind: "builtin" | "custom-graph" | "custom-inline";
  builtinId?: BuiltInDebateRoleId;
  graphUid?: string;
  graphLabel?: string;
  inlineText?: string;
  /**
   * Optional display name for this participant. When set, this overrides the
   * auto-generated `{RoleLabel} (model)` speaker name. Primarily used with the
   * "No role" built-in to give participants a human name (Alice, Bob…) or the
   * name of a known thinker / fictional character to embody (see
   * `embodyNamedFigure`).
   */
  customName?: string;
  /**
   * When a `customName` is set, controls whether the model is instructed to
   * embody the named figure if that name refers to an identifiable thinker,
   * historical figure or fictional character. Default: true. Neutral labels
   * like "Alice" are handled gracefully by the guardrail in the prompt.
   */
  embodyNamedFigure?: boolean;
  /**
   * Optional free-form extra instructions appended to the resolved role's
   * system fragment. Lets users specialise built-in roles (e.g. tell the
   * Black Hat to focus specifically on ethical risks) or add flavour to any
   * role kind without editing the built-in definitions.
   */
  extraInstructions?: string;
  /**
   * Optional per-participant temperature override (0.0 – 1.5). Undefined = use
   * the model's default. Higher for creative roles (Green Hat, Visionary),
   * lower for factual ones (White Hat).
   */
  temperature?: number;
}

export interface DebateParticipant {
  modelId: string;
  role: DebateRoleRef;
}

export interface DebateTurn {
  participantIndex: number; // -1 for human
  modelId: string; // "__human__" for human turns
  speakerName: string;
  roleLabel: string;
  round: number;
  content: string;
  concluded: boolean;
  tokensIn: number;
  tokensOut: number;
  timestamp: Date;
  // v2: realism features
  isPass?: boolean;
  isReaction?: boolean;
  reactorOf?: string; // speakerName of the main turn this reacts to
  invitedReactors?: string[]; // speakerNames parsed from >>> react: (main turns only)
  nextSuggestion?: string; // speakerName parsed from >>> next: (main turns only)
}

export type DebateStatus =
  | "running"
  | "paused-round-limit"
  | "paused-human"
  | "stopped"
  | "concluded";

export type DebateOrdering = "fixed" | "random";

export interface DebateState {
  participants: DebateParticipant[];
  speakerNames: string[]; // stable, index-aligned with participants
  subMode: DebateSubMode;
  turns: DebateTurn[];
  currentRound: number;
  nextParticipantIndex: number;
  maxRounds: number;
  wordLimitPerTurn: number;
  allowConclude: boolean;
  topic: string;
  conversationContext?: string;
  // Reference blocks from the user's Roam graph (selected results). Rendered as
  // a separate section in every turn's user prompt so participants can ground
  // claims and cite blocks inline with ((uid)). Stored as a pre-rendered string.
  referenceBlocks?: string;
  status: DebateStatus;
  // v2: realism snapshot (copied from config at init, stable across a debate)
  ordering: DebateOrdering;
  allowReactions: boolean;
  // Display name used for human turns in human-in-loop mode. Snapshotted from
  // config at init. Defaults to "Human" if unset.
  humanName: string;
}

export interface DebatePreset {
  uid: string;
  name: string;
  participants: DebateParticipant[];
  subMode?: DebateSubMode;
  maxRounds?: number;
  wordLimitPerTurn?: number;
  allowConclude?: boolean;
}

export interface CouncilConfig {
  mode: CouncilMode;
  // Iterative mode
  generatorModel: string; // model identifier for the generator
  evaluatorModels: string[]; // 1-4 evaluator model identifiers
  maxReEvaluations: number; // max evaluate+regenerate cycles after first generation (default 2)
  scoreThreshold: number; // default 8 (0-10)
  // Parallel mode
  competitorModels: string[]; // 2-5 competitor model identifiers
  synthesizerModel: string; // model identifier for the synthesizer
  // Shared
  evaluationCriteria: string; // custom criteria text, or empty for defaults
  evaluationWordLimit: number; // max words for evaluation feedback (default 400)
  // Parallel mode: cross-evaluation options
  fullCrossEvaluation: boolean; // each model evaluates all others (default false)
  includeSelfEvaluation: boolean; // include self-evaluation in cross-eval (default false)
  // Debate mode
  debateSubMode: DebateSubMode;
  debateParticipants: DebateParticipant[]; // 2-6
  debateMaxRounds: number; // default 3
  debateWordLimitPerTurn: number; // default 250
  debateAllowConclude: boolean; // default true
  debateOrdering: DebateOrdering; // default "fixed"
  debateAllowReactions: boolean; // default false (token-cost aware)
  // Human-in-loop only. Display name the human wants to be addressed as.
  // Empty / unset → "Human".
  debateHumanName?: string;
}

export interface CouncilEvaluation {
  evaluatorModel: string;
  evaluatorModelDisplayName: string;
  score: number;
  criteriaScores?: Record<string, number>; // per-criterion scores (key → 0-10)
  criteriaNames?: string[]; // ordered display names matching criteriaScores keys
  strengths: string;
  weaknesses: string;
  unexaminedAssumptions: string;
  suggestions: string;
  overallFeedback: string;
  tokensIn: number;
  tokensOut: number;
}

export interface CouncilGeneration {
  model: string;
  modelDisplayName: string;
  content: string;
  iteration: number;
  tokensIn: number;
  tokensOut: number;
}

export interface CouncilStepInfo {
  type:
    | "generation"
    | "evaluation"
    | "synthesis"
    | "status"
    | "debate-turn"
    | "debate-reaction"
    | "debate-continue"
    | "debate-speaker-picker";
  councilMode: CouncilMode;
  iteration?: number;
  totalIterations?: number;
  model?: string;
  modelDisplayName?: string;
  score?: number;
  criteriaScores?: Record<string, number>; // per-criterion scores (key → 0-10)
  criteriaNames?: string[]; // ordered display names for criteriaScores keys
  averageScore?: number;
  scoreThreshold?: number;
  isIntermediate: boolean; // true = collapsible intermediate step
  // For parallel mode: which response was evaluated (blind label)
  blindLabel?: string; // "Response A", "Response B", etc.
  // For parallel mode: the actual model that produced the evaluated response
  evaluatedModel?: string;
  evaluatedModelDisplayName?: string;
  // Debate mode
  turnId?: string;
  round?: number;
  participantIndex?: number;
  roleLabel?: string;
  speakerName?: string;
  isHuman?: boolean;
  isConclusion?: boolean;
  isComplete?: boolean;
  isPass?: boolean;
  reactorOf?: string;
}

export interface CouncilResult {
  finalAnswer: string;
  generations: CouncilGeneration[];
  evaluations: CouncilEvaluation[][]; // grouped by iteration/round
  totalTokensIn: number;
  totalTokensOut: number;
  duration: number;
  iterationsUsed: number;
  mode: CouncilMode;
  // Debate mode only
  debateState?: DebateState;
  debateTurns?: DebateTurn[];
}

export const DEFAULT_COUNCIL_CONFIG: CouncilConfig = {
  mode: "iterative",
  generatorModel: "", // defaults to selectedModel at runtime
  evaluatorModels: [], // defaults to 2 diverse models at runtime
  maxReEvaluations: 2,
  scoreThreshold: 8,
  competitorModels: [], // defaults to 3 diverse models at runtime
  synthesizerModel: "", // defaults to selectedModel at runtime
  evaluationCriteria: "",
  evaluationWordLimit: 400,
  fullCrossEvaluation: false,
  includeSelfEvaluation: false,
  debateSubMode: "autonomous",
  debateParticipants: [],
  debateMaxRounds: 3,
  debateWordLimitPerTurn: 150,
  debateAllowConclude: true,
  debateOrdering: "fixed",
  debateAllowReactions: false,
  debateHumanName: "",
};

export const BLIND_LABELS = [
  "Response A",
  "Response B",
  "Response C",
  "Response D",
  "Response E",
];
