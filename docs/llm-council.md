# LLM Council Mode

The **LLM Council** is a chat mode that leverages multiple AI models working together to produce higher-quality, more robust answers than any single model alone. Instead of relying on one LLM, the Council orchestrates a deliberation process where models generate, evaluate, and refine responses — reducing blind spots, biases, and hallucinations.

Switch to Council mode from the chat mode selector in the Chat panel.

## Why use a Council?

A single LLM can be confidently wrong. It has its own biases, knowledge gaps, and reasoning patterns. The Council addresses this by introducing **adversarial evaluation**: responses are scrutinized by independent models that actively try to find flaws, unsupported claims, and unexamined assumptions (Popperian falsification approach). The result is an answer that has survived genuine scrutiny from diverse perspectives.

## Two modes

### Iterative Refinement

**One model generates, others critique, the generator improves — repeat until quality is reached.**

This mode is a feedback loop:

1. A **Generator** model produces an initial response.
2. One or more **Evaluator** models (1–4) independently score and critique it, looking for weaknesses, logical gaps, and unexamined assumptions.
3. The Generator receives the feedback and produces an improved version.
4. Steps 2–3 repeat until the average score meets the **score threshold** (default: 8/10) or the **max iterations** limit is reached (default: 3).

**Best for:** Deep, nuanced questions where you want a single well-refined answer — research questions, complex analysis, writing that needs to be accurate and thorough.

**Configuration:**
| Setting | Description | Default |
|---|---|---|
| Generator | The model that writes the response | Current chat model |
| Evaluators | 1–4 models that critique each iteration | 2 diverse models |
| Max iterations | Maximum generate→evaluate cycles | 3 |
| Score threshold | Target average score to stop early (0–10) | 8 |

### Parallel Competition

**Multiple models answer independently, then a synthesizer picks the best elements from all.**

This mode is a competition:

1. Multiple **Competitor** models (2–5) independently generate a response to the same prompt.
2. Responses are **blind-labeled** (Response A, Response B, etc.) and evaluated — evaluators don't know which model produced which response, preventing brand bias.
3. A **Synthesizer** model reviews all responses and evaluations, then produces a final answer that combines the strongest elements.

**Best for:** Questions where different models might have complementary strengths — factual lookups, creative brainstorming, or any case where you want to see how different models approach the same problem before getting a unified answer.

**Configuration:**
| Setting | Description | Default |
|---|---|---|
| Competitors | 2–5 models that answer independently | 3 diverse models |
| Synthesizer | The model that produces the final merged answer | Current chat model |
| Full cross-evaluation | Each competitor model evaluates all others | Off |
| Include self-evaluation | Models also evaluate their own response | Off |

## Shared settings

- **Evaluation criteria**: Leave empty to use defaults (accuracy, completeness & relevance, reasoning robustness, unexamined assumptions) or provide your own custom criteria.
- **Evaluation word limit**: Controls the length of evaluation feedback (default: 400 words). Lower values reduce cost and latency; higher values give more detailed critiques.

## When to use which mode?

| | Iterative Refinement | Parallel Competition |
|---|---|---|
| **Approach** | Depth — one answer refined multiple times | Breadth — multiple independent answers merged |
| **Speed** | Sequential (slower, scales with iterations) | Parallel generation (faster initial phase) |
| **Strength** | Produces a deeply polished answer | Captures diverse perspectives and approaches |
| **Cost** | Lower per iteration, but compounds | Higher upfront (N models generating), but single round |
| **Use when** | You need precision and thoroughness | You want the best of multiple viewpoints |
