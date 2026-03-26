/**
 * Council Agent Prompts
 *
 * Prompt templates for evaluation, re-generation, and synthesis
 * in the LLM Council system.
 */

import { z } from "zod";
import { CouncilEvaluation } from "./council-types";

// ==================== STRUCTURED OUTPUT SCHEMA ====================

export function buildEvaluationSchema(wordLimit: number = 400) {
  // Distribute word budget: strengths & overall get ~15% each, main 3 fields share the rest
  const fieldLimit = Math.floor(wordLimit / 3 / 10) * 10; // rounded down to nearest 10
  const briefLimit = Math.floor(fieldLimit / 2 / 10) * 10;

  return z.object({
    score: z
      .number()
      .min(0)
      .max(10)
      .describe("Overall score from 0 to 10"),
    strengths: z
      .string()
      .describe(`1-2 sentences: what the response does well. Keep this brief (max ~${briefLimit} words).`),
    weaknesses: z
      .string()
      .describe(
        `Key flaws, errors, unsupported claims, and logical gaps — be specific but concise (max ~${fieldLimit} words)`,
      ),
    unexaminedAssumptions: z
      .string()
      .describe(
        `Implicit premises, unstated constraints, or framing biases that could undermine the conclusion — concise (max ~${fieldLimit} words)`,
      ),
    suggestions: z
      .string()
      .describe(`Specific actionable suggestions for improvement — concise (max ~${fieldLimit} words)`),
    overallFeedback: z
      .string()
      .describe(`1 sentence overall assessment (max ~${briefLimit} words)`),
  });
}

// Default schema for fallback/typing
export const evaluationSchema = buildEvaluationSchema(400);

export type EvaluationOutput = z.infer<typeof evaluationSchema>;

// ==================== DEFAULT CRITERIA ====================

export const DEFAULT_EVALUATION_CRITERIA = `Evaluate the response based on these criteria:
1. **Accuracy**: Is the information factually correct and reliable? Are claims properly supported?
2. **Completeness & Relevance**: Does it fully address the question while staying focused on what was asked?
3. **Reasoning robustness**: Are arguments logically sound, free of fallacies, and resistant to counterexamples?
4. **Unexamined assumptions**: What does the response take for granted? Are there implicit premises, unstated constraints, or framing biases that could undermine the conclusions?

Approach this evaluation as a falsification attempt (in the Popperian sense): actively try to find what is wrong, misleading, or unjustified. A response that survives rigorous scrutiny deserves a high score.

Provide an overall score from 0 to 10.`;

// ==================== EVALUATION PROMPTS ====================

export function buildEvaluationSystemPrompt(
  customCriteria: string,
  wordLimit: number = 400,
): string {
  const criteria = customCriteria?.trim() || DEFAULT_EVALUATION_CRITERIA;
  const concisionInstruction = `\n\nBe concise: keep your total evaluation under ${wordLimit} words. Focus your detail on **weaknesses**, **unexamined assumptions**, and **suggestions** — these are the most valuable parts. Keep **strengths** and **overall feedback** brief (1-2 sentences each).`;
  return `You are an expert critical evaluator. Your task is to rigorously assess an AI-generated response to a user's request.

${criteria}

Be rigorous and intellectually honest. A score of 10 means the response survives all attempts at falsification — reserve it for truly exceptional responses. A score of 5 means adequate but with significant flaws or gaps. A score below 3 means the response is fundamentally flawed or misleading.

Focus your feedback on what is wrong and how to fix it. Be specific, be harsh where warranted, and always explain why.${concisionInstruction}

IMPORTANT: Write your evaluation in the SAME language as the user's original prompt.`;
}

export function buildEvaluationUserPrompt(
  userMessage: string,
  response: string,
  blindLabel?: string,
): string {
  const label = blindLabel ? `[${blindLabel}]\n\n` : "";
  return `## User's original request:
${userMessage}

## Response to evaluate:
${label}${response}

Evaluate this response according to the criteria provided. Actively attempt to falsify its claims and expose its weaknesses. Provide your score and detailed feedback.`;
}

// ==================== ITERATIVE RE-GENERATION PROMPTS ====================

export function buildIterativeRegenerationSystemPrompt(): string {
  return `You are regenerating a response to the user's original request, informed by evaluator feedback.

CRITICAL INSTRUCTIONS:
- Your output must be a DIRECT, STANDALONE response to the user's original request — as if you were answering it fresh.
- Do NOT write a meta-commentary about what you improved or what feedback you incorporated.
- Do NOT conflate all suggestions into a bloated response. Use the feedback to make your answer more accurate and precise, but keep it focused on what the user actually asked.
- The evaluator feedback is for YOUR eyes only — use it to inform your thinking, but the user should never see traces of the evaluation process in your response.

Use the feedback to:
- Fix factual errors, logical gaps, and weaknesses
- Address unexamined assumptions where relevant
- Incorporate valuable suggestions that improve the answer
- But DISCARD suggestions that would dilute or derail the response from the user's actual question

IMPORTANT: Write your response in the SAME language as the user's original prompt.`;
}

export function buildIterativeRegenerationUserPrompt(
  userMessage: string,
  previousResponse: string,
  evaluations: CouncilEvaluation[],
  iteration: number,
  scoreThreshold: number,
): string {
  let feedbackSection = "";
  for (const evaluation of evaluations) {
    feedbackSection += `\n### Evaluator (${evaluation.evaluatorModelDisplayName}) — Score: ${evaluation.score}/10
- **Strengths**: ${evaluation.strengths}
- **Weaknesses**: ${evaluation.weaknesses}
- **Unexamined assumptions**: ${evaluation.unexaminedAssumptions}
- **Suggestions**: ${evaluation.suggestions}
- **Overall**: ${evaluation.overallFeedback}
`;
  }

  const avgScore =
    evaluations.reduce((sum, e) => sum + e.score, 0) / evaluations.length;

  return `## Original user request:
${userMessage}

## Your previous response (iteration ${iteration}):
${previousResponse}

## Evaluator feedback (average score: ${avgScore.toFixed(1)}/10, target: ${scoreThreshold}/10):
${feedbackSection}

Now write a new response to the ORIGINAL USER REQUEST above. Your response must read as a direct answer to their question — not as a revision document. Use the feedback to improve accuracy and precision, but do not let it inflate or derail your answer.`;
}

// ==================== PARALLEL SYNTHESIS PROMPTS ====================

export function buildSynthesisSystemPrompt(): string {
  return `You are a synthesis expert. Multiple AI models have responded to a user's request, and each response has been independently evaluated with a falsification-oriented approach. Your task is to create the best possible final response by:

1. Incorporating the strongest elements from each response
2. Addressing all weaknesses and unexamined assumptions raised in the evaluations
3. Resolving any contradictions between responses
4. Producing the most complete, accurate, and well-structured answer possible

Your output must be a DIRECT response to the user's original request. Do not mention the other models, the evaluation process, or the synthesis. Do not add commentary unless the user explicitly asked for it. Simply produce the best answer.

IMPORTANT: Write your response in the SAME language as the user's original prompt.`;
}

export function buildSynthesisUserPrompt(
  userMessage: string,
  responses: Array<{
    blindLabel: string;
    content: string;
    evaluation: CouncilEvaluation;
  }>,
): string {
  let responsesSection = "";
  for (const { blindLabel, content, evaluation } of responses) {
    responsesSection += `\n## ${blindLabel} (Score: ${evaluation.score}/10)

${content}

### Evaluation:
- **Strengths**: ${evaluation.strengths}
- **Weaknesses**: ${evaluation.weaknesses}
- **Unexamined assumptions**: ${evaluation.unexaminedAssumptions}
- **Suggestions**: ${evaluation.suggestions}
`;
  }

  return `## User's original request:
${userMessage}

## Responses and their evaluations:
${responsesSection}

Create a final, synthesized response that combines the best elements of all responses while addressing all criticisms and unexamined assumptions.`;
}

// ==================== FALLBACK PARSING ====================

/**
 * Fallback parser for when structured output fails.
 * Attempts to extract a score from plain text evaluation.
 */
export function parseEvaluationFromText(text: string): EvaluationOutput {
  // Try to extract score from patterns like "Score: 7/10", "7/10", "score of 7"
  const scorePatterns = [
    /(?:overall\s+)?score[:\s]*(\d+(?:\.\d+)?)\s*\/\s*10/i,
    /(\d+(?:\.\d+)?)\s*\/\s*10/,
    /(?:overall\s+)?score[:\s]*(\d+(?:\.\d+)?)/i,
  ];

  let score = 5; // default fallback
  for (const pattern of scorePatterns) {
    const match = text.match(pattern);
    if (match) {
      const parsed = parseFloat(match[1]);
      if (parsed >= 0 && parsed <= 10) {
        score = parsed;
        break;
      }
    }
  }

  // Try to extract sections
  const strengths =
    extractSection(text, "strengths") || "See overall feedback.";
  const weaknesses =
    extractSection(text, "weaknesses") || "See overall feedback.";
  const unexaminedAssumptions =
    extractSection(text, "unexamined assumptions") ||
    extractSection(text, "assumptions") ||
    "Not identified.";
  const suggestions =
    extractSection(text, "suggestions") || "See overall feedback.";

  return {
    score,
    strengths,
    weaknesses,
    unexaminedAssumptions,
    suggestions,
    overallFeedback: text.slice(0, 500),
  };
}

function extractSection(text: string, sectionName: string): string | null {
  const pattern = new RegExp(
    `\\*\\*${sectionName}\\*\\*[:\\s]*([\\s\\S]*?)(?=\\*\\*|$)`,
    "i",
  );
  const match = text.match(pattern);
  return match ? match[1].trim().slice(0, 500) : null;
}
