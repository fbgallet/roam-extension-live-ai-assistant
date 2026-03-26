/**
 * LLM Council Types
 *
 * Interfaces and types for the multi-LLM deliberation system.
 * Two modes: Iterative Refinement and Parallel Competition.
 */

export type CouncilMode = "iterative" | "parallel";

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
  type: "generation" | "evaluation" | "synthesis" | "status";
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
};

export const BLIND_LABELS = [
  "Response A",
  "Response B",
  "Response C",
  "Response D",
  "Response E",
];
