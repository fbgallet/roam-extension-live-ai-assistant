/**
 * Council Orchestrator
 *
 * Core orchestration logic for both council modes:
 * - Iterative Refinement: generate → evaluate → refine loop
 * - Parallel Competition: parallel generation → blind cross-evaluation → synthesis
 */

import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import {
  modelViaLanggraph,
  getLlmSuitableOptions,
  TokensUsage,
  LlmInfos,
} from "../langraphModelsLoader";
import {
  modelAccordingToProvider,
  isAPIKeyNeeded,
} from "../../aiAPIsHub";
import { getDisplayName } from "../../modelRegistry";
import { updateTokenCounter } from "../../modelsInfo";
import {
  CouncilConfig,
  CouncilEvaluation,
  CouncilGeneration,
  CouncilResult,
  CouncilStepInfo,
  BLIND_LABELS,
} from "./council-types";
import {
  buildEvaluationSchema,
  EvaluationOutput,
  buildEvaluationSystemPrompt,
  buildEvaluationUserPrompt,
  buildIterativeRegenerationSystemPrompt,
  buildIterativeRegenerationUserPrompt,
  buildSynthesisSystemPrompt,
  buildSynthesisUserPrompt,
  parseEvaluationFromText,
} from "./council-prompts";
import { ChatMessage } from "../../../components/full-results-popup/types/types";

// ==================== HELPER: Instantiate LLM ====================

function instantiateModel(
  modelId: string,
  tokensUsage: TokensUsage,
): { llm: any; llmInfos: LlmInfos } | null {
  const llmInfos = modelAccordingToProvider(modelId, false);
  if (isAPIKeyNeeded(llmInfos)) return null;
  const llm = modelViaLanggraph(llmInfos, tokensUsage);
  return { llm, llmInfos };
}

// ==================== HELPER: Call LLM for generation ====================

async function generateResponse(
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  streamingCallback?: (content: string) => void,
): Promise<{
  content: string;
  tokensIn: number;
  tokensOut: number;
} | null> {
  const tokensUsage: TokensUsage = { input_tokens: 0, output_tokens: 0 };
  const instance = instantiateModel(modelId, tokensUsage);
  if (!instance) return null;

  const { llm, llmInfos } = instance;
  const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt),
  ];

  let content: string;
  if (streamingCallback) {
    // Stream the response
    let accumulated = "";
    const stream = await llm.stream(messages);
    for await (const chunk of stream) {
      const text =
        typeof chunk.content === "string"
          ? chunk.content
          : Array.isArray(chunk.content)
            ? chunk.content
                .filter((p: any) => p.type === "text")
                .map((p: any) => p.text)
                .join("")
            : "";
      accumulated += text;
      streamingCallback(accumulated);
    }
    content = accumulated;
  } else {
    const result = await llm.invoke(messages);
    content =
      typeof result.content === "string"
        ? result.content
        : Array.isArray(result.content)
          ? result.content
              .filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join("")
          : String(result.content);
  }

  updateTokenCounter(llmInfos.id, tokensUsage);

  return {
    content,
    tokensIn: tokensUsage.input_tokens,
    tokensOut: tokensUsage.output_tokens,
  };
}

// ==================== HELPER: Call LLM for evaluation ====================

/**
 * Ensures a value is a plain string. Handles objects, arrays, and nested structures
 * that some models return instead of plain strings in structured output.
 * Filters out thinking blocks (Claude extended thinking) and extracts only text content.
 */
function ensureString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .filter((item) => {
        // Filter out thinking blocks entirely
        if (typeof item === "object" && item !== null && item.type === "thinking") return false;
        return true;
      })
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null) {
          // Extract text content from content blocks
          if (item.type === "text" && typeof item.text === "string") return item.text;
          if (typeof item.text === "string") return item.text;
          if (typeof item.content === "string") return item.content;
          // Last resort: stringify, but skip thinking-like objects
          return JSON.stringify(item);
        }
        return String(item);
      })
      .join("\n");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Skip thinking blocks
    if (obj.type === "thinking") return "";
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Sanitizes all string fields of an evaluation output to ensure no [object Object] rendering.
 */
function sanitizeEvaluation(evaluation: EvaluationOutput): EvaluationOutput {
  return {
    score: typeof evaluation.score === "number" ? evaluation.score : 5,
    strengths: ensureString(evaluation.strengths),
    weaknesses: ensureString(evaluation.weaknesses),
    unexaminedAssumptions: ensureString(evaluation.unexaminedAssumptions),
    suggestions: ensureString(evaluation.suggestions),
    overallFeedback: ensureString(evaluation.overallFeedback),
  };
}

async function evaluateResponse(
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  wordLimit: number = 400,
): Promise<{
  evaluation: EvaluationOutput;
  tokensIn: number;
  tokensOut: number;
} | null> {
  const tokensUsage: TokensUsage = { input_tokens: 0, output_tokens: 0 };
  const instance = instantiateModel(modelId, tokensUsage);
  if (!instance) return null;

  const { llm, llmInfos } = instance;
  const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt),
  ];

  let evaluation: EvaluationOutput;
  try {
    const schema = buildEvaluationSchema(wordLimit);
    const structuredLlm = llm.withStructuredOutput(
      schema,
      getLlmSuitableOptions(llmInfos, "council_evaluation", 0.3),
    );
    const raw = await structuredLlm.invoke(messages);
    // Some models with includeRaw return { raw, parsed }
    evaluation = sanitizeEvaluation(raw?.parsed || raw);
  } catch (err) {
    console.warn(
      `Council: structured output failed for ${modelId}, falling back to text parsing`,
      err,
    );
    try {
      const result = await llm.invoke(messages);
      const text =
        typeof result.content === "string"
          ? result.content
          : Array.isArray(result.content)
            ? result.content
                .filter((p: any) => p.type !== "thinking") // Skip Claude thinking blocks
                .map((p: any) =>
                  typeof p === "string" ? p : p.text || p.content || JSON.stringify(p),
                )
                .join("")
            : String(result.content);
      evaluation = parseEvaluationFromText(text);
    } catch (fallbackErr) {
      console.error(
        `Council: evaluation completely failed for ${modelId}`,
        fallbackErr,
      );
      return null;
    }
  }

  updateTokenCounter(llmInfos.id, tokensUsage);

  return {
    evaluation,
    tokensIn: tokensUsage.input_tokens,
    tokensOut: tokensUsage.output_tokens,
  };
}

// ==================== HELPER: Create intermediate ChatMessage ====================

function createIntermediateMessage(
  content: string,
  councilStep: CouncilStepInfo,
  tokensIn?: number,
  tokensOut?: number,
): ChatMessage {
  return {
    role: "assistant",
    content,
    timestamp: new Date(),
    tokensIn,
    tokensOut,
    model: councilStep.model,
    councilStep,
  };
}

// ==================== HELPER: Stagger parallel calls to same provider ====================

async function staggeredParallel<T>(
  tasks: Array<{ modelId: string; fn: () => Promise<T> }>,
  staggerMs: number = 200,
): Promise<Array<T | null>> {
  // Group by provider to stagger same-provider calls
  const providerSeen = new Map<string, number>();
  const delayedTasks = tasks.map((task) => {
    const llmInfos = modelAccordingToProvider(task.modelId, false);
    const provider = llmInfos.provider;
    const count = providerSeen.get(provider) || 0;
    providerSeen.set(provider, count + 1);
    const delay = count * staggerMs;
    return new Promise<T | null>(async (resolve) => {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      try {
        resolve(await task.fn());
      } catch (err) {
        console.error(
          `Council: task failed for model ${task.modelId}`,
          err,
        );
        resolve(null);
      }
    });
  });
  return Promise.all(delayedTasks);
}

// ==================== ITERATIVE REFINEMENT ====================

export interface IterativeCouncilOptions {
  config: CouncilConfig;
  userMessage: string;
  conversationContext?: string; // multi-turn context
  style?: string;
  streamingCallback?: (content: string) => void;
  intermediateCallback?: (message: ChatMessage) => void;
  abortSignal?: AbortSignal;
}

export async function runIterativeCouncil(
  options: IterativeCouncilOptions,
): Promise<CouncilResult> {
  const {
    config,
    userMessage,
    conversationContext,
    style,
    streamingCallback,
    intermediateCallback,
    abortSignal,
  } = options;
  const startTime = Date.now();
  const allGenerations: CouncilGeneration[] = [];
  const allEvaluations: CouncilEvaluation[][] = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  const generatorModel = config.generatorModel;
  const evaluatorModels = config.evaluatorModels;
  const evaluationSystemPrompt = buildEvaluationSystemPrompt(
    config.evaluationCriteria,
    config.evaluationWordLimit || 400,
  );

  let currentResponse = "";
  let lastEvaluations: CouncilEvaluation[] = [];

  for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
    if (abortSignal?.aborted) break;

    const isLastIteration = iteration === config.maxIterations;

    // --- GENERATION ---
    let systemPrompt: string;
    let userPrompt: string;

    if (iteration === 1) {
      systemPrompt = style
        ? `Respond to the user's request. Apply this style: ${style}`
        : "Respond to the user's request.";
      userPrompt = conversationContext
        ? `${conversationContext}\n\n${userMessage}`
        : userMessage;
    } else {
      systemPrompt = buildIterativeRegenerationSystemPrompt();
      userPrompt = buildIterativeRegenerationUserPrompt(
        userMessage,
        currentResponse,
        lastEvaluations,
        iteration - 1,
        config.scoreThreshold,
      );
      if (conversationContext) {
        userPrompt = `${conversationContext}\n\n${userPrompt}`;
      }
    }

    // Post status
    intermediateCallback?.(
      createIntermediateMessage(
        iteration === 1
          ? `Generating initial response with **${getDisplayName(generatorModel)}**...`
          : `Re-generating response (iteration ${iteration}/${config.maxIterations}) with **${getDisplayName(generatorModel)}**...`,
        {
          type: "status",
          councilMode: "iterative",
          iteration,
          totalIterations: config.maxIterations,
          isIntermediate: true,
        },
      ),
    );

    // Stream only the final iteration (or if it will pass threshold)
    const shouldStream = isLastIteration;
    const genResult = await generateResponse(
      generatorModel,
      systemPrompt,
      userPrompt,
      shouldStream ? streamingCallback : undefined,
    );

    if (!genResult) {
      throw new Error(
        `Generation failed for model ${getDisplayName(generatorModel)}`,
      );
    }

    currentResponse = genResult.content;
    totalTokensIn += genResult.tokensIn;
    totalTokensOut += genResult.tokensOut;

    const generation: CouncilGeneration = {
      model: generatorModel,
      modelDisplayName: getDisplayName(generatorModel),
      content: currentResponse,
      iteration,
      tokensIn: genResult.tokensIn,
      tokensOut: genResult.tokensOut,
    };
    allGenerations.push(generation);

    // Post generation as intermediate message
    intermediateCallback?.(
      createIntermediateMessage(
        currentResponse,
        {
          type: "generation",
          councilMode: "iterative",
          iteration,
          totalIterations: config.maxIterations,
          model: generatorModel,
          modelDisplayName: getDisplayName(generatorModel),
          isIntermediate: !isLastIteration,
        },
        genResult.tokensIn,
        genResult.tokensOut,
      ),
    );

    // If this is the last iteration, skip evaluation
    if (isLastIteration) break;

    if (abortSignal?.aborted) break;

    // --- EVALUATION ---
    intermediateCallback?.(
      createIntermediateMessage(
        `Evaluating response with ${evaluatorModels.length} evaluator${evaluatorModels.length > 1 ? "s" : ""}...`,
        {
          type: "status",
          councilMode: "iterative",
          iteration,
          isIntermediate: true,
        },
      ),
    );

    const evalUserPrompt = buildEvaluationUserPrompt(
      userMessage,
      currentResponse,
    );

    const evalResults = await staggeredParallel(
      evaluatorModels.map((modelId) => ({
        modelId,
        fn: () =>
          evaluateResponse(modelId, evaluationSystemPrompt, evalUserPrompt, config.evaluationWordLimit || 400),
      })),
    );

    // Collect successful evaluations
    lastEvaluations = [];
    for (let i = 0; i < evaluatorModels.length; i++) {
      const result = evalResults[i];
      if (!result) {
        intermediateCallback?.(
          createIntermediateMessage(
            `Evaluation failed for **${getDisplayName(evaluatorModels[i])}** — skipping this evaluator.`,
            {
              type: "status",
              councilMode: "iterative",
              iteration,
              isIntermediate: true,
            },
          ),
        );
        continue;
      }

      const evaluation: CouncilEvaluation = {
        evaluatorModel: evaluatorModels[i],
        evaluatorModelDisplayName: getDisplayName(evaluatorModels[i]),
        score: result.evaluation.score,
        strengths: result.evaluation.strengths,
        weaknesses: result.evaluation.weaknesses,
        unexaminedAssumptions: result.evaluation.unexaminedAssumptions,
        suggestions: result.evaluation.suggestions,
        overallFeedback: result.evaluation.overallFeedback,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      };
      lastEvaluations.push(evaluation);
      totalTokensIn += result.tokensIn;
      totalTokensOut += result.tokensOut;

      // Post evaluation
      const evalContent = `**Score: ${evaluation.score}/10**\n\n**Strengths:** ${evaluation.strengths}\n\n**Weaknesses:** ${evaluation.weaknesses}\n\n**Unexamined assumptions:** ${evaluation.unexaminedAssumptions}\n\n**Suggestions:** ${evaluation.suggestions}\n\n**Overall:** ${evaluation.overallFeedback}`;
      intermediateCallback?.(
        createIntermediateMessage(
          evalContent,
          {
            type: "evaluation",
            councilMode: "iterative",
            iteration,
            model: evaluatorModels[i],
            modelDisplayName: getDisplayName(evaluatorModels[i]),
            score: evaluation.score,
            isIntermediate: true,
          },
          result.tokensIn,
          result.tokensOut,
        ),
      );
    }

    allEvaluations.push(lastEvaluations);

    // Compute average score
    if (lastEvaluations.length === 0) {
      // All evaluators failed — use current response as final
      break;
    }

    const avgScore =
      lastEvaluations.reduce((sum, e) => sum + e.score, 0) /
      lastEvaluations.length;

    // Post average score status
    intermediateCallback?.(
      createIntermediateMessage(
        `**Average score: ${avgScore.toFixed(1)}/10** (threshold: ${config.scoreThreshold}/10)${avgScore >= config.scoreThreshold ? " ✓ Threshold reached!" : ""}`,
        {
          type: "status",
          councilMode: "iterative",
          iteration,
          averageScore: avgScore,
          scoreThreshold: config.scoreThreshold,
          isIntermediate: true,
        },
      ),
    );

    // Check if threshold is met
    if (avgScore >= config.scoreThreshold) {
      break;
    }
  }

  return {
    finalAnswer: currentResponse,
    generations: allGenerations,
    evaluations: allEvaluations,
    totalTokensIn,
    totalTokensOut,
    duration: Date.now() - startTime,
    iterationsUsed: allGenerations.length,
    mode: "iterative",
  };
}

// ==================== PARALLEL COMPETITION ====================

export interface ParallelCouncilOptions {
  config: CouncilConfig;
  userMessage: string;
  conversationContext?: string;
  style?: string;
  streamingCallback?: (content: string) => void;
  intermediateCallback?: (message: ChatMessage) => void;
  abortSignal?: AbortSignal;
}

export async function runParallelCouncil(
  options: ParallelCouncilOptions,
): Promise<CouncilResult> {
  const {
    config,
    userMessage,
    conversationContext,
    style,
    streamingCallback,
    intermediateCallback,
    abortSignal,
  } = options;
  const startTime = Date.now();
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  const competitorModels = config.competitorModels;
  const isCrossEval = config.fullCrossEvaluation || false;
  const includeSelf = config.includeSelfEvaluation || false;
  // Use tighter word limit for full cross-evaluation (more evaluations = more concise each)
  const evalWordLimit = isCrossEval
    ? Math.min(config.evaluationWordLimit || 400, 200)
    : config.evaluationWordLimit || 400;
  const evaluationSystemPrompt = buildEvaluationSystemPrompt(
    config.evaluationCriteria,
    evalWordLimit,
  );

  // --- PARALLEL GENERATION ---
  intermediateCallback?.(
    createIntermediateMessage(
      `Generating responses in parallel with ${competitorModels.length} models...`,
      {
        type: "status",
        councilMode: "parallel",
        isIntermediate: true,
      },
    ),
  );

  const generationSystemPrompt = style
    ? `Respond to the user's request. Apply this style: ${style}`
    : "Respond to the user's request.";
  const generationUserPrompt = conversationContext
    ? `${conversationContext}\n\n${userMessage}`
    : userMessage;

  const genResults = await staggeredParallel(
    competitorModels.map((modelId) => ({
      modelId,
      fn: () =>
        generateResponse(modelId, generationSystemPrompt, generationUserPrompt),
    })),
  );

  if (abortSignal?.aborted)
    return emptyResult("parallel", startTime, totalTokensIn, totalTokensOut);

  // Collect successful generations
  const generations: Array<{
    modelId: string;
    blindLabel: string;
    content: string;
    tokensIn: number;
    tokensOut: number;
  }> = [];

  for (let i = 0; i < competitorModels.length; i++) {
    const result = genResults[i];
    if (!result) {
      intermediateCallback?.(
        createIntermediateMessage(
          `Generation failed for **${getDisplayName(competitorModels[i])}** — skipping.`,
          {
            type: "status",
            councilMode: "parallel",
            isIntermediate: true,
          },
        ),
      );
      continue;
    }

    const blindLabel = BLIND_LABELS[generations.length] || `Response ${generations.length + 1}`;
    generations.push({
      modelId: competitorModels[i],
      blindLabel,
      content: result.content,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });
    totalTokensIn += result.tokensIn;
    totalTokensOut += result.tokensOut;

    // Post generation
    intermediateCallback?.(
      createIntermediateMessage(
        result.content,
        {
          type: "generation",
          councilMode: "parallel",
          iteration: 1,
          model: competitorModels[i],
          modelDisplayName: getDisplayName(competitorModels[i]),
          blindLabel,
          isIntermediate: true,
        },
        result.tokensIn,
        result.tokensOut,
      ),
    );
  }

  if (generations.length < 2) {
    throw new Error(
      "At least 2 successful generations are required for parallel council mode.",
    );
  }

  if (abortSignal?.aborted)
    return emptyResult("parallel", startTime, totalTokensIn, totalTokensOut);

  // --- CROSS-EVALUATION ---
  // Full cross-eval: each model evaluates all others (+ optionally itself)
  // Default (round-robin): model[i] evaluates model[(i+1) % n]
  const evalModeLabel = isCrossEval ? "full cross-evaluation" : "blind cross-evaluation";
  intermediateCallback?.(
    createIntermediateMessage(
      `Cross-evaluating responses (${evalModeLabel})...`,
      {
        type: "status",
        councilMode: "parallel",
        isIntermediate: true,
      },
    ),
  );

  // Build evaluation task pairs
  const evaluationTasks: Array<{
    modelId: string;
    fn: () => ReturnType<typeof evaluateResponse>;
    targetGenIndex: number;
    evaluatorGenIndex: number;
  }> = [];

  if (isCrossEval) {
    // Full cross-evaluation: each model evaluates every other model
    for (let evalIdx = 0; evalIdx < generations.length; evalIdx++) {
      for (let targetIdx = 0; targetIdx < generations.length; targetIdx++) {
        if (targetIdx === evalIdx && !includeSelf) continue;
        const evaluatorModelId = generations[evalIdx].modelId;
        const targetGen = generations[targetIdx];
        evaluationTasks.push({
          modelId: evaluatorModelId,
          fn: () =>
            evaluateResponse(
              evaluatorModelId,
              evaluationSystemPrompt,
              buildEvaluationUserPrompt(
                userMessage,
                targetGen.content,
                targetGen.blindLabel,
              ),
              evalWordLimit,
            ),
          targetGenIndex: targetIdx,
          evaluatorGenIndex: evalIdx,
        });
      }
    }
  } else {
    // Round-robin: model[i] evaluates model[(i+1) % n]
    for (let i = 0; i < generations.length; i++) {
      const evaluatorIdx = (i + 1) % generations.length;
      const evaluatorModelId = generations[evaluatorIdx].modelId;
      const targetGen = generations[i];
      evaluationTasks.push({
        modelId: evaluatorModelId,
        fn: () =>
          evaluateResponse(
            evaluatorModelId,
            evaluationSystemPrompt,
            buildEvaluationUserPrompt(
              userMessage,
              targetGen.content,
              targetGen.blindLabel,
            ),
            evalWordLimit,
          ),
        targetGenIndex: i,
        evaluatorGenIndex: evaluatorIdx,
      });
    }
  }

  const evalResults = await staggeredParallel(
    evaluationTasks.map((t) => ({ modelId: t.modelId, fn: t.fn })),
  );

  const allEvaluations: CouncilEvaluation[] = [];
  // For synthesis: aggregate evaluations per response (average scores, combine feedback)
  const evalsByTarget = new Map<number, CouncilEvaluation[]>();

  for (let i = 0; i < evaluationTasks.length; i++) {
    const task = evaluationTasks[i];
    const result = evalResults[i];
    const targetGen = generations[task.targetGenIndex];
    const evaluatorGen = generations[task.evaluatorGenIndex];

    if (!result) {
      const placeholderEval: CouncilEvaluation = {
        evaluatorModel: evaluatorGen.modelId,
        evaluatorModelDisplayName: getDisplayName(evaluatorGen.modelId),
        score: 5,
        strengths: "Evaluation failed — using default score.",
        weaknesses: "Evaluation failed.",
        unexaminedAssumptions: "N/A",
        suggestions: "N/A",
        overallFeedback: "Evaluation failed for this evaluator.",
        tokensIn: 0,
        tokensOut: 0,
      };
      allEvaluations.push(placeholderEval);
      if (!evalsByTarget.has(task.targetGenIndex)) evalsByTarget.set(task.targetGenIndex, []);
      evalsByTarget.get(task.targetGenIndex)!.push(placeholderEval);

      intermediateCallback?.(
        createIntermediateMessage(
          `Evaluation by **${getDisplayName(evaluatorGen.modelId)}** failed — using default score.`,
          {
            type: "status",
            councilMode: "parallel",
            isIntermediate: true,
          },
        ),
      );
      continue;
    }

    const evaluation: CouncilEvaluation = {
      evaluatorModel: evaluatorGen.modelId,
      evaluatorModelDisplayName: getDisplayName(evaluatorGen.modelId),
      score: result.evaluation.score,
      strengths: result.evaluation.strengths,
      weaknesses: result.evaluation.weaknesses,
      unexaminedAssumptions: result.evaluation.unexaminedAssumptions,
      suggestions: result.evaluation.suggestions,
      overallFeedback: result.evaluation.overallFeedback,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
    allEvaluations.push(evaluation);
    if (!evalsByTarget.has(task.targetGenIndex)) evalsByTarget.set(task.targetGenIndex, []);
    evalsByTarget.get(task.targetGenIndex)!.push(evaluation);
    totalTokensIn += result.tokensIn;
    totalTokensOut += result.tokensOut;

    // Post evaluation
    const selfTag = task.targetGenIndex === task.evaluatorGenIndex ? " *(self-evaluation)*" : "";
    const evalContent = `**${targetGen.blindLabel}** evaluated by **${getDisplayName(evaluatorGen.modelId)}**${selfTag} — **Score: ${evaluation.score}/10**\n\n**Strengths:** ${evaluation.strengths}\n\n**Weaknesses:** ${evaluation.weaknesses}\n\n**Unexamined assumptions:** ${evaluation.unexaminedAssumptions}\n\n**Suggestions:** ${evaluation.suggestions}\n\n**Overall:** ${evaluation.overallFeedback}`;
    intermediateCallback?.(
      createIntermediateMessage(
        evalContent,
        {
          type: "evaluation",
          councilMode: "parallel",
          iteration: 1,
          model: evaluatorGen.modelId,
          modelDisplayName: getDisplayName(evaluatorGen.modelId),
          score: evaluation.score,
          blindLabel: targetGen.blindLabel,
          evaluatedModel: targetGen.modelId,
          evaluatedModelDisplayName: getDisplayName(targetGen.modelId),
          isIntermediate: true,
        },
        result.tokensIn,
        result.tokensOut,
      ),
    );
  }

  // Build responsesWithEvals for synthesis — aggregate per response
  const responsesWithEvals: Array<{
    blindLabel: string;
    content: string;
    evaluation: CouncilEvaluation;
  }> = [];

  for (let i = 0; i < generations.length; i++) {
    const gen = generations[i];
    const evals = evalsByTarget.get(i) || [];
    if (evals.length === 0) continue;
    // For synthesis, merge multiple evaluations into a single aggregate
    if (evals.length === 1) {
      responsesWithEvals.push({
        blindLabel: gen.blindLabel,
        content: gen.content,
        evaluation: evals[0],
      });
    } else {
      // Aggregate: average score, concatenate feedback from all evaluators
      const avgScore = evals.reduce((s, e) => s + e.score, 0) / evals.length;
      const mergedEval: CouncilEvaluation = {
        evaluatorModel: "aggregate",
        evaluatorModelDisplayName: `${evals.length} evaluators`,
        score: Math.round(avgScore * 10) / 10,
        strengths: evals.map((e) => `[${e.evaluatorModelDisplayName}] ${e.strengths}`).join("\n"),
        weaknesses: evals.map((e) => `[${e.evaluatorModelDisplayName}] ${e.weaknesses}`).join("\n"),
        unexaminedAssumptions: evals.map((e) => `[${e.evaluatorModelDisplayName}] ${e.unexaminedAssumptions}`).join("\n"),
        suggestions: evals.map((e) => `[${e.evaluatorModelDisplayName}] ${e.suggestions}`).join("\n"),
        overallFeedback: evals.map((e) => `[${e.evaluatorModelDisplayName}] ${e.overallFeedback}`).join("\n"),
        tokensIn: evals.reduce((s, e) => s + e.tokensIn, 0),
        tokensOut: evals.reduce((s, e) => s + e.tokensOut, 0),
      };
      responsesWithEvals.push({
        blindLabel: gen.blindLabel,
        content: gen.content,
        evaluation: mergedEval,
      });
    }
  }

  if (abortSignal?.aborted)
    return emptyResult("parallel", startTime, totalTokensIn, totalTokensOut);

  // --- SYNTHESIS ---
  intermediateCallback?.(
    createIntermediateMessage(
      `Synthesizing final response with **${getDisplayName(config.synthesizerModel)}**...`,
      {
        type: "status",
        councilMode: "parallel",
        isIntermediate: true,
      },
    ),
  );

  const synthesisResult = await generateResponse(
    config.synthesizerModel,
    buildSynthesisSystemPrompt(),
    buildSynthesisUserPrompt(userMessage, responsesWithEvals),
    streamingCallback,
  );

  if (!synthesisResult) {
    throw new Error(
      `Synthesis failed for model ${getDisplayName(config.synthesizerModel)}`,
    );
  }

  totalTokensIn += synthesisResult.tokensIn;
  totalTokensOut += synthesisResult.tokensOut;

  // Post synthesis as final message
  intermediateCallback?.(
    createIntermediateMessage(
      synthesisResult.content,
      {
        type: "synthesis",
        councilMode: "parallel",
        model: config.synthesizerModel,
        modelDisplayName: getDisplayName(config.synthesizerModel),
        isIntermediate: false,
      },
      synthesisResult.tokensIn,
      synthesisResult.tokensOut,
    ),
  );

  const allGens: CouncilGeneration[] = generations.map((g, i) => ({
    model: g.modelId,
    modelDisplayName: getDisplayName(g.modelId),
    content: g.content,
    iteration: 1,
    tokensIn: g.tokensIn,
    tokensOut: g.tokensOut,
  }));

  return {
    finalAnswer: synthesisResult.content,
    generations: allGens,
    evaluations: [allEvaluations],
    totalTokensIn,
    totalTokensOut,
    duration: Date.now() - startTime,
    iterationsUsed: 1,
    mode: "parallel",
  };
}

// ==================== HELPER ====================

function emptyResult(
  mode: "iterative" | "parallel",
  startTime: number,
  tokensIn: number,
  tokensOut: number,
): CouncilResult {
  return {
    finalAnswer: "",
    generations: [],
    evaluations: [],
    totalTokensIn: tokensIn,
    totalTokensOut: tokensOut,
    duration: Date.now() - startTime,
    iterationsUsed: 0,
    mode,
  };
}
