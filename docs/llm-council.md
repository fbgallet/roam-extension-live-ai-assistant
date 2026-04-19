# LLM Council Mode

The **LLM Council** is a chat mode that leverages multiple AI models working together to produce higher-quality, more robust answers than any single model alone. Instead of relying on one LLM, the Council orchestrates a deliberation process where models generate, evaluate, refine — or debate — responses, reducing blind spots, biases, and hallucinations.

Switch to Council mode from the chat mode selector in the Chat panel.

## Why use a Council?

A single LLM can be confidently wrong. It has its own biases, knowledge gaps, and reasoning patterns. The Council addresses this by introducing **adversarial evaluation**: responses are scrutinized by independent models that actively try to find flaws, unsupported claims, and unexamined assumptions (Popperian falsification approach). The result is an answer that has survived genuine scrutiny from diverse perspectives.

## Three modes

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

### Debate

**Multiple participants take turns in a live, oral-style conversation — each with their own role, perspective, or persona.**

Unlike Iterative Refinement (feedback loop on a single answer) or Parallel Competition (independent answers merged), Debate is a genuine multi-turn dialogue: participants react to what was just said, address each other by name, and advance the discussion one step at a time.

**How it works:**

1. Configure 2–6 **participants**: each gets a model, a role (or persona), and optionally a display name and per-participant temperature.
2. Participants speak in turn (fixed or random order). Each turn reacts to the most recent contributions — no restating positions from scratch.
3. The debate runs for a capped number of rounds, or until a participant proposes `[CONCLUDE]` and the others confirm.

**Roles** drive what each participant contributes:

- **De Bono's Six Thinking Hats** — White (facts), Red (feelings), Black (risks), Yellow (benefits), Green (creativity), Blue (process meta-view).
- **Characters** — Socrates (probing questions), Devil's Advocate (steelman opposition), Synthesizer (find convergence), Pragmatist (actionable now), Visionary (long horizon).
- **Custom roles from your graph** — any block tagged `#liveai/role` becomes a selectable role.
- **Custom styles from your graph** — any block tagged `#liveai/style` is also selectable as a role (a style is a way of writing; a role is a position to adopt — both work as debate system fragments).
- **Custom inline role** — write the role description directly in the panel.
- **No preset role — or name-driven persona** — give the participant a display name (e.g. `Alice`, `Nietzsche`, `Spock`). If the name refers to an identifiable thinker or fictional character, the model will embody them (characteristic style, concerns, habits of thought). Neutral names like "Alice" are treated as plain labels. Toggle with the **In-character** switch next to the name (on by default).

**Sub-modes:**

- **Autonomous**: participants keep taking turns until the round limit or `[CONCLUDE]` is reached.
- **Human-in-the-loop**: you can inject messages between turns, steering the debate.

**Dynamics options:**

- **Order**: Fixed (speak in listed order) or Random (fair rotation, shuffled each round).
- **Allow short reactions**: a speaker can end with `>>> react: Name[, Name]` to invite a one-liner (≤30 words) from specific participants before the next full turn. Off by default (uses extra tokens).
- **Allow [CONCLUDE] proposal**: when a participant genuinely thinks the debate has reached a sound conclusion, they end with `[CONCLUDE]` on its own line; the others are asked to confirm.
- **Direct next speaker**: a speaker can end with `>>> next: Name` to hand off to a specific participant.
- **Pass**: a participant may reply with `[PASS]` if they have nothing new to add.

**Presets:**

- **Six Thinking Hats** — all six De Bono hats, 2 rounds, temperatures tuned per hat (White low, Red/Green high).
- **Socratic Dialogue** — Socrates probes, Pragmatist answers, 4 rounds.
- **Red Team / Blue Team** — Devil's Advocate vs. Synthesizer, 3 rounds.
- **My presets** — save the current configuration to your graph as `#liveai/debate-preset` and reuse it later.

**Configuration:**
| Setting | Description | Default |
|---|---|---|
| Participants | 2–6 (model + role + optional name & temperature) | 2 |
| Max rounds | Hard cap on debate length (1–10) | 3 |
| Word limit / turn | Per-turn word cap (50–500) | 150 |
| Order | Fixed or Random | Fixed |
| Allow reactions | Enable `>>> react:` invitations | Off |
| Allow [CONCLUDE] | Enable end-of-debate proposal | On |

**Best for:** Exploring a topic from multiple angles (using the Six Hats), stress-testing a plan (Red Team / Blue Team), producing insight through dialectic (Socratic), or running a panel of named thinkers on the same question.

## Shared settings

- **Evaluation criteria** (Iterative & Parallel): Leave empty to use defaults (accuracy, completeness & relevance, reasoning robustness, unexamined assumptions) or provide your own custom criteria.
- **Evaluation word limit** (Iterative & Parallel): Controls the length of evaluation feedback (default: 400 words). Lower values reduce cost and latency; higher values give more detailed critiques.

## When to use which mode?

| | Iterative Refinement | Parallel Competition | Debate |
|---|---|---|---|
| **Approach** | Depth — one answer refined multiple times | Breadth — multiple independent answers merged | Dialogue — multi-turn conversation between roles |
| **Output** | A single polished answer | A single merged answer | A transcript of reasoning from diverse perspectives |
| **Speed** | Sequential (slower, scales with iterations) | Parallel generation (faster initial phase) | Sequential (one turn at a time) |
| **Strength** | Produces a deeply polished answer | Captures diverse perspectives and approaches | Reveals tensions, surfaces hidden assumptions, explores a topic |
| **Cost** | Lower per iteration, but compounds | Higher upfront (N models generating), but single round | Scales with participants × rounds |
| **Use when** | You need precision and thoroughness | You want the best of multiple viewpoints | You want to think through a topic, stress-test a plan, or hear a panel |
