# LangChain / LangGraph 1.0 Migration — Scoped Plan

> Status: **planned, not started.** The urgent gpt-5.6 chat bug was fixed
> separately (see "Context" below) so this migration is *not* on the critical
> path and can be scheduled deliberately.

## Context — why this came up

While fixing gpt-5.6 in the chat panel we discovered that **LangChain 0.4.x
silently ignores the `reasoning` object** we pass to `ChatOpenAI`. Proof
(captured request bodies for `gpt-5.6-luna`):

| Loader input | Request sent |
|---|---|
| `reasoning: { effort, summary }` (object) | *nothing* — dropped |
| `reasoningEffort: "high"` (string) | `reasoning_effort` on `/v1/chat/completions` |
| `reasoningEffort: "high"` + `useResponsesApi: true` | `reasoning: { effort }` on `/v1/responses` |

Consequences:
- OpenAI reasoning effort has **never actually applied** in any langgraph agent
  (chat, search, outliner, council, nl-query, …). The `// Reasoning not working
  with current version of langchain/openai` comment in `chat-agent.ts` is this bug.
- The interim fix ([src/ai/agents/langraphModelsLoader.ts](../src/ai/agents/langraphModelsLoader.ts),
  `openai-reasoning` branch) now passes the **string** `reasoningEffort` and sets
  `useResponsesApi: true` for real OpenAI, so effort works *and* is compatible
  with function tools (gpt-5.6 rejects `reasoning_effort` + function tools on
  chat completions). **Revisit this workaround during the migration** —
  @langchain/openai 1.x honors `reasoning: { effort, summary }` directly and can
  restore reasoning *summaries* (thinking display), which 0.4.x cannot.

## Current vs target versions

| Package | Current | Target (latest) | Jump |
|---|---|---|---|
| `@langchain/core` | 0.3.78 | 1.2.2 | major |
| `@langchain/openai` | 0.4.9 | 1.5.5 | major |
| `@langchain/langgraph` | 0.2.46 | 1.4.7 | major |
| `@langchain/anthropic` | 0.3.31 | 1.5.1 | major |
| `@langchain/google-genai` | 0.1.12 | 2.2.0 | **two majors** |
| `@langchain/deepseek` | 0.0.1 | 1.1.5 | major |
| `@langchain/ollama` | 0.2.0 | 1.3.0 | major |

**All-or-nothing:** every `@langchain/*` 1.x peers on `@langchain/core` 1.x, so
core + all provider packages + langgraph must bump in a single step. No partial
upgrade is possible.

## Blast radius (measured)

- **43 files** import `@langchain/*`.
- **8 StateGraph agents:** `chat-agent`, `ask-your-graph-agent`, `outliner-agent`,
  `graph-explorer`, `mcp-agent`, `nl-query`, `nl-datomic-query`, `calcul-agent`.
- API usage counts: `Annotation` ×181, `Command` ×57, `MessagesAnnotation` ×17,
  `StateGraph` ×18, `ToolNode` ×12, `interrupt` ×18 (human-in-the-loop),
  `bindTools` ×8, `withStructuredOutput` ×5.
- Message classes: `HumanMessage` ×50, `SystemMessage` ×40, `AIMessage` ×32,
  `ToolMessage` ×9.
- Uses the **browser** entrypoint `@langchain/langgraph/web` (×8) and
  `dangerouslyAllowBrowser` — bundled by `roamjs-scripts` (esbuild) into a Roam
  extension. Browser bundling is a first-class risk here.

## Known breaking-change themes to expect (verify each against upstream 1.0 notes)

1. **`@langchain/core` 1.0 — message content blocks.** `message.content` can be
   an array of typed blocks, not just a string. Audit every place that reads
   `.content` as a string or does `.content.at(-1)`. `chat-agent.ts` already
   handles the array case (good precedent) — extend that everywhere.
2. **Streaming + `concat()` of chunks.** Tool-call chunk accumulation
   (`concat(gathered, chunk)`) and `usage_metadata` shape may change. Token
   counting in `langraphModelsLoader.ts` `handleLLMEnd` reads
   `output.llmOutput.{tokenUsage,usage,usage_metadata}` — re-verify all three.
3. **`@langchain/openai` 1.x** — `reasoning: { effort, summary }` object is now
   honored; the Responses API may become default for reasoning models. Re-decide
   whether to keep the manual `useResponsesApi` flag and restore reasoning
   summaries. Also re-check `max_completion_tokens` vs `max_tokens` mapping.
4. **`@langchain/google-genai` 0.1 → 2.2 (biggest risk).** Constructor options
   likely renamed (`thinkingLevel` / `includeThoughts` / `maxOutputTokens`).
   Re-validate the `gemini` branch of the loader end-to-end.
5. **`@langchain/anthropic` 1.x** — thinking / `output_config` (adaptive effort)
   and `invocationKwargs.top_p` handling. Re-validate adaptive + budget schemes.
6. **LangGraph 1.0** — `StateGraph`/`Annotation`/`Command`/`interrupt` are
   largely stable, but `ToolNode` and prebuilt imports (`/prebuilt`) and the
   checkpoint/interrupt semantics should be spot-checked. Note langchain 1.0 also
   introduces a new `createAgent` in the `langchain` package — **not required**;
   we keep our explicit StateGraphs.

## Staged execution

**Stage 0 — Prep (0.5 day)**
- Branch `chore/langchain-1.0`. Snapshot `package-lock`/`yarn.lock`.
- Read the official LangChain JS 1.0 + LangGraph 1.0 migration guides; note each
  breaking change that maps to a theme above.
- Confirm all providers we use have a 1.x package (they do — table above).

**Stage 1 — Bump & compile (1 day)**
- Bump core + all 7 provider/langgraph packages together to their 1.x.
- `npx tsc --noEmit` → triage import/type errors. Expect churn in message types
  and provider constructor option types. Fix mechanically; defer behavior changes.

**Stage 2 — Loader re-validation (1 day)** — [langraphModelsLoader.ts](../src/ai/agents/langraphModelsLoader.ts)
- Per provider (OpenAI, Anthropic, Google, DeepSeek, Ollama, Grok/custom/groq):
  confirm the resolved thinking params still reach the wire. Reuse the
  request-capture harness (monkeypatch `llm.client`) used to diagnose the
  original bug — it's the fastest oracle.
- Reconsider the OpenAI `useResponsesApi` workaround; switch to the object form
  if 1.x default behavior is cleaner, and re-enable reasoning summaries.

**Stage 3 — Per-agent runtime tests (1.5–2 days)**
- Drive each of the 8 graphs in a real Roam session: chat (streaming + tools +
  the gpt-5.6 case that started this), ask-your-graph, outliner, graph-explorer,
  mcp, nl-query, nl-datomic-query, calcul. Exercise `interrupt`
  (human-in-the-loop) paths explicitly.
- Verify token counting still accrues per model.

**Stage 4 — Cleanup & release (0.5 day)**
- Remove now-dead 0.4.x workarounds and stale comments.
- Full regression pass across providers × thinking on/off × tools on/off.
- Changelog entry.

**Rough total: ~5–6 focused days**, dominated by Google GenAI (two majors) and
the 8-graph runtime test matrix. Not a hotfix — schedule as its own block.

## Definition of done
- All 8 agents run green in a real session, streaming + tools + interrupts.
- Reasoning effort verifiably reaches the wire for every reasoning provider
  (capture-harness check), and OpenAI reasoning summaries display again.
- No `@langchain/*` package left on a 0.x line.
