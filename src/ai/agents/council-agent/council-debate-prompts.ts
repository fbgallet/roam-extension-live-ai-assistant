/**
 * Debate Prompts
 *
 * Role definitions and prompt builders for the multi-LLM debate mode.
 * The framing emphasises *oral-style* concision and explicit addressing:
 * participants respond to what was just said and name who they're addressing.
 */

import {
  BuiltInDebateRoleId,
  DebateParticipant,
  DebateSubMode,
  DebateTurn,
} from "./council-types";

export interface BuiltInDebateRoleDefinition {
  label: string;
  systemFragment: string;
}

export const BUILTIN_ROLE_DEFINITIONS: Record<
  BuiltInDebateRoleId,
  BuiltInDebateRoleDefinition
> = {
  none: {
    label: "Participant",
    systemFragment: "",
  },
  "white-hat": {
    label: "White Hat",
    systemFragment:
      "Focus on verifiable facts, data, and information gaps. Do not opine, emote, or speculate. If a claim lacks evidence, say so.",
  },
  "red-hat": {
    label: "Red Hat",
    systemFragment:
      "Express intuitions and emotional reactions openly, without justifying them. Gut feelings, hunches, concerns, enthusiasms. Trust the feeling.",
  },
  "black-hat": {
    label: "Black Hat",
    systemFragment:
      "Rigorously examine risks, flaws, and failure modes. Challenge claims with specific counter-examples. Play devil's advocate when the group drifts toward consensus.",
  },
  "yellow-hat": {
    label: "Yellow Hat",
    systemFragment:
      "Seek benefits, opportunities, and feasibility. Look for why something could work. Remain grounded — optimism, not fantasy.",
  },
  "green-hat": {
    label: "Green Hat",
    systemFragment:
      "Generate novel ideas, alternatives, and lateral connections. Go beyond what's been said. Propose angles others haven't considered.",
  },
  "blue-hat": {
    label: "Blue Hat",
    systemFragment:
      "Operate at the process meta-level. Summarise progress, redirect when the debate stalls, name what has been decided vs. what remains open.",
  },
  socrates: {
    label: "Socrates",
    systemFragment:
      "Adopt the stance of Socrates in Plato's dialogues: reflective and questioning rather than assertive. Use the elenctic method — probe others' claims with questions that expose hidden assumptions (in their preconceptions, expectations, or values) and let their own answers lead them toward contradictions. Invite others to define key terms; if they struggle, offer a simple definition to be tested against counterexamples and refined. Focus on the points that most deserve reflection because understanding them is central to the matter at hand. You may use a mildly ironic, playful tone — sometimes exaggeratedly agreeing with what is simplistic to bring contradictions to the surface — while remaining kind. Use striking images or concrete examples to sharpen a point. Address one point at a time, seeking agreement before moving on.",
  },
  "devils-advocate": {
    label: "Devil's Advocate",
    systemFragment:
      "Take the strongest opposing position to the emerging consensus, even if you don't personally believe it. Steelman dissent with rigorous argument.",
  },
  "synthesizer-role": {
    label: "Synthesizer",
    systemFragment:
      "Find convergence across prior turns. Integrate differences into a coherent position. Name what everyone actually agrees on beneath surface disagreement.",
  },
  pragmatist: {
    label: "Pragmatist",
    systemFragment:
      "Focus on what is actionable now, given real-world constraints. Translate abstract points into concrete next steps. Push past theory toward decision.",
  },
  visionary: {
    label: "Visionary",
    systemFragment:
      "Resist short-termism: frame the discussion at a long horizon appropriate to the topic — a few years for some debates, decades for others. The point is not a fixed timescale but refusing to stay confined to immediate constraints. Ask what becomes possible if current constraints fall away, and connect present choices to long-term trajectories.",
  },
};

export const CONCLUDE_TAG = "[CONCLUDE]";
export const PASS_TAG = "[PASS]";

export function detectConcludeSignal(content: string): boolean {
  if (!content) return false;
  const tail = content.slice(-400);
  // Must appear on its own line (possibly with whitespace), not embedded in prose.
  return /^\s*\[CONCLUDE\]\s*$/im.test(tail);
}

/**
 * True when the message is ONLY the [PASS] tag (possibly with trivial
 * whitespace/punctuation). A genuine pass — the participant has nothing to add.
 */
export function detectPassSignal(content: string): boolean {
  if (!content) return false;
  const stripped = content
    .replace(/\[PASS\]/gi, "")
    .replace(/\s+/g, "")
    .replace(/[.!?,;:'"\-–—]/g, "");
  return stripped.length === 0 && /\[PASS\]/i.test(content);
}

// ==================== Suffix markers (>>> next: / >>> react:) ====================

const NEXT_RE = /^\s*>>>\s*next:\s*(.+?)\s*$/im;
const REACT_RE = /^\s*>>>\s*react:\s*(.+?)\s*$/im;

/**
 * Strips `>>> next:` and `>>> react:` suffix lines from displayed content.
 * These markers are metadata for the orchestrator, not user-facing text.
 */
export function stripSuffixMarkers(content: string): string {
  if (!content) return content;
  return content
    .replace(/^\s*>>>\s*next:.*$/gim, "")
    .replace(/^\s*>>>\s*react:.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

/**
 * Matches a raw name token (from `>>> next:` or `>>> react:`) against the
 * list of participant speaker names. Returns the matched speaker name, or null.
 *
 * - Tries case-insensitive exact match first.
 * - Falls back to case-insensitive startsWith match (e.g. "Alice" matches
 *   "Alice (gpt-4o)" if that's the full speaker name).
 * - Falls back to case-insensitive substring match only if exactly one name
 *   matches (prevents ambiguity).
 */
function resolveNameToken(raw: string, validNames: string[]): string | null {
  const token = raw.trim().replace(/[.,;:!?]+$/, "");
  if (!token) return null;
  const lower = token.toLowerCase();
  const exact = validNames.find((n) => n.toLowerCase() === lower);
  if (exact) return exact;
  const starts = validNames.filter((n) => n.toLowerCase().startsWith(lower));
  if (starts.length === 1) return starts[0];
  const sub = validNames.filter((n) => n.toLowerCase().includes(lower));
  if (sub.length === 1) return sub[0];
  return null;
}

/**
 * Parses a `>>> next: {Name}` suffix from the content. Returns the resolved
 * speaker name, or null if no valid suffix / name.
 */
export function parseNextSuggestion(
  content: string,
  validNames: string[],
): string | null {
  if (!content) return null;
  const m = content.match(NEXT_RE);
  if (!m) return null;
  return resolveNameToken(m[1], validNames);
}

/**
 * Parses a `>>> react: {Name}[, {Name}]` suffix. Returns up to `max` resolved
 * speaker names, in listed order, deduplicated.
 */
export function parseReactInvitations(
  content: string,
  validNames: string[],
  max: number,
): string[] {
  if (!content) return [];
  const m = content.match(REACT_RE);
  if (!m) return [];
  const parts = m[1]
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const resolved = resolveNameToken(p, validNames);
    if (resolved && !out.includes(resolved)) out.push(resolved);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Returns true when the message is an agreement vote — i.e. ONLY the
 * `[CONCLUDE]` tag (possibly with minor whitespace / punctuation), with no
 * real response content. Used during the conclusion-confirmation vote.
 */
export function isOnlyConcludeVote(content: string): boolean {
  if (!content) return false;
  const stripped = content
    .replace(/\[CONCLUDE\]/gi, "")
    .replace(/\s+/g, "")
    .replace(/[.!?,;:'"\-–—]/g, "");
  // If after removing the tag + trivial punctuation/whitespace nothing meaningful remains,
  // it's a pure vote.
  return stripped.length === 0 && /\[CONCLUDE\]/i.test(content);
}

function shortModelName(modelId: string): string {
  // Best effort: trim vendor prefixes and trailing dates/versions.
  const withoutPrefix = modelId.replace(
    /^(openai\/|anthropic\/|google\/|xai\/|groq\/|openrouter\/)/i,
    "",
  );
  return withoutPrefix
    .replace(/-\d{4}-\d{2}-\d{2}$/, "") // drop trailing -YYYY-MM-DD
    .replace(/-latest$/, "")
    .replace(/^models\//, "");
}

export function buildSpeakerName(
  roleLabel: string,
  modelId: string,
  existingNames: string[],
): string {
  const base = `${roleLabel} (${shortModelName(modelId)})`;
  if (!existingNames.includes(base)) return base;
  let i = 2;
  while (existingNames.includes(`${base} #${i}`)) i += 1;
  return `${base} #${i}`;
}

// ==================== Token budget helpers ====================

const CHAR_PER_TOKEN = 4;
const SUMMARIZE_THRESHOLD_TOKENS = 20000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHAR_PER_TOKEN);
}

function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ") + "…";
}

function renderTurn(turn: DebateTurn): string {
  return `[Round ${turn.round} — ${turn.speakerName}]: ${turn.content.trim()}`;
}

/**
 * Renders the transcript. When the full transcript would exceed ~20k tokens,
 * keep the last `keepLastRounds` full rounds verbatim and reduce older turns
 * to their first 40 words each.
 */
export function renderTranscript(
  turns: DebateTurn[],
  keepLastRounds: number = 2,
): string {
  if (turns.length === 0) return "(no turns yet)";

  const fullRendered = turns.map(renderTurn).join("\n\n");
  if (estimateTokens(fullRendered) <= SUMMARIZE_THRESHOLD_TOKENS) {
    return fullRendered;
  }

  const latestRound = turns[turns.length - 1].round;
  const cutoffRound = Math.max(1, latestRound - keepLastRounds + 1);

  const parts: string[] = [];
  for (const t of turns) {
    if (t.round >= cutoffRound) {
      parts.push(renderTurn(t));
    } else {
      parts.push(
        `[Round ${t.round} — ${t.speakerName}] (summarised): ${truncateWords(t.content, 40)}`,
      );
    }
  }
  return parts.join("\n\n");
}

// ==================== System prompt ====================

interface SpeakerInfo {
  name: string;
  roleLabel: string;
  modelId: string;
}

interface BuildSystemPromptArgs {
  participant: DebateParticipant;
  speakerName: string;
  roleLabel: string;
  roleFragment: string;
  allPeers: SpeakerInfo[]; // all participants including self
  subMode: DebateSubMode;
  allowConclude: boolean;
  allowReactions: boolean;
  wordLimit: number;
  hasReferenceBlocks?: boolean;
  humanName?: string; // display name for the human participant (human-in-loop)
}

export function buildDebateSystemPrompt(args: BuildSystemPromptArgs): string {
  const {
    participant,
    speakerName,
    roleLabel,
    roleFragment,
    allPeers,
    subMode,
    allowConclude,
    allowReactions,
    wordLimit,
    hasReferenceBlocks,
    humanName,
  } = args;
  const resolvedHumanName =
    (humanName && humanName.trim()) || "Human";

  const customName = participant.role.customName?.trim();
  const embodyEnabled = participant.role.embodyNamedFigure !== false;
  // Named-persona guardrail: only kicks in if the user gave a custom name,
  // left the "Embody named figure" switch on, AND the role has no explicit
  // systemFragment (i.e. "No role" built-in — otherwise a hat/character role
  // already drives the behaviour and persona-embodiment would clash).
  const personaSection =
    customName && embodyEnabled && !roleFragment
      ? `\n\n## Persona\nYour display name is **${customName}**. If — and only if — this name clearly refers to an identifiable real thinker (philosopher, scientist, author, historical figure…) or a well-known fictional character, speak as that figure: adopt their characteristic style, concerns, habits of thought, and the positions they are known for. Draw on their actual ideas, not caricature. If the name is neutral or ambiguous (e.g. Alice, Bob, a generic first name, an unclear label), treat it as a plain label and simply speak as yourself with that name — do NOT invent a persona.`
      : "";

  const aiPeers = allPeers
    .filter((p) => p.name !== speakerName)
    .map((p) => `- ${p.name} (${p.roleLabel})`);
  if (subMode === "human-in-loop") {
    aiPeers.push(`- ${resolvedHumanName} (human participant)`);
  }
  const peerList = aiPeers.join("\n");

  const humanNote =
    subMode === "human-in-loop"
      ? `\n- **${resolvedHumanName}** is a human participant who may speak between turns. When they ask you something or make a claim worth engaging, address them by name — just like any other participant.`
      : "";

  const concludeNote = allowConclude
    ? `\n- **Conclusion**: If you genuinely believe the debate has reached a sound conclusion, OR the original request has been fully addressed, end your message with \`[CONCLUDE]\` on its own line. Do NOT use this tag lightly — only when real convergence has been reached. The other participants will then be asked to confirm.`
    : "";

  const referenceBlocksNote = hasReferenceBlocks
    ? `\n- **Reference blocks from the user's Roam graph**: the user has attached specific blocks as reference material (see the \`## Reference blocks\` section in the prompt). Ground your claims in them when relevant, quote or paraphrase what they actually say rather than speculating, and cite the source inline with the Roam block-reference syntax \`((uid))\` — e.g. "as noted in ((abc123XYZ))". Do not fabricate UIDs; only cite UIDs that appear in the provided reference blocks.`
    : "";

  const roleSection = roleFragment
    ? `\n\n## Your role: ${roleLabel}\n${roleFragment}`
    : `\n\n## Your role\nSpeak as yourself. Bring your own perspective and critical thinking.`;

  const reactBullet = allowReactions
    ? `\n- **Invite brief reactions** (optional, max 2 names): if a one-liner from one or two named participants would sharpen the discussion before the next full turn, end with \`>>> react: {Name}[, {Name}]\` on its own line. Use rarely — only when a specific voice would genuinely enrich.`
    : "";

  const optionalMoves = `

## Optional conversational moves

These are **optional**. Use only when it genuinely makes the debate sharper. Do NOT use them by default.

- **Direct next speaker** (optional): if you are asking a specific participant a direct question and really want *them* to answer next (not just naming them in passing), end your message with \`>>> next: {ExactSpeakerName}\` on its own line. Naming someone in your argument is NOT the same as addressing them — only use this when you actually want them to answer next.${reactBullet}
- **Pass** (optional): if you genuinely have nothing new to add and any response would be filler, reply with exactly \`[PASS]\` — nothing else. Use sparingly.

Place any of these markers on their own line at the very end of your message. They are not displayed to the other participants as prose.`;

  return `You are **${speakerName}**, participating in a **live, oral-style debate** with other AI participants${subMode === "human-in-loop" ? " and possibly a human" : ""}. This is a real conversation, not a collection of essays.

## The other participants
${peerList || "(you are alone)"}

## Rules of engagement
- **Be concise.** Write like someone speaking aloud — a few sentences to a short paragraph. Hard cap: ${wordLimit} words.
- **Respond as one voice, not a roll-call.** Reply primarily to the most recent turn. Do NOT open your message with a sequential roll-call like *"Alice, you said…; Bob, you said…; Carol, you said…"* — that is robotic and unreadable. Instead, write one cohesive contribution that moves the discussion forward. If two prior points genuinely need to be woven together, do it in a single flowing paragraph, not as a numbered list of mini-replies.
- **Only name someone when it clarifies.** Mention a participant by name only when it's genuinely needed — typically to resolve who you're pushing back on, to credit a specific insight, or to ask them a direct question. When you do name them, wrap it in markdown bold (e.g. "**Alice**"). If context already makes it clear who you're responding to, let the argument stand on its own — repeating everyone's name sounds mechanical. One, at most two names per turn, and inserted naturally into a sentence (e.g. "…which is where **Alice**'s point falls short."), not as a sentence-opening label.
- **One focused contribution per turn.** Don't try to cover everything. Advance the discussion by one clear step.
- **Apply strong critical thinking.** Challenge weak reasoning, expose hidden assumptions, offer counter-examples.
- **Write in the SAME language as the user's original request / the debate topic.** Even though these instructions are in English, if the user wrote their topic in French, German, Spanish, Japanese, etc., reply in that language. Match the other participants' language too. Participant names and the suffix markers (\`>>> next:\`, \`>>> react:\`, \`[CONCLUDE]\`, \`[PASS]\`) always stay as-is regardless of language.${humanNote}${concludeNote}${referenceBlocksNote}${roleSection}${personaSection}${optionalMoves}

Do not narrate meta-commentary ("As the Black Hat, I will now…"). Just speak.`;
}

// ==================== Reaction prompts ====================

interface BuildReactionPromptArgs {
  speakerName: string;
  roleLabel: string;
  roleFragment: string;
  mainSpeakerName: string;
  mainTurnContent: string; // stripped of suffix markers
}

export function buildReactionSystemPrompt(
  args: BuildReactionPromptArgs,
): string {
  const { speakerName, roleLabel, roleFragment, mainSpeakerName } = args;
  const roleNote = roleFragment
    ? `Stay in character as **${roleLabel}**: ${roleFragment}`
    : "Speak as yourself.";
  return `You are **${speakerName}** in a multi-LLM debate. **${mainSpeakerName}** just asked for a quick reaction from you.

Give a **terse, one-line reaction — 30 words MAXIMUM**. This is an interjection, not a full turn. Examples of good reactions: an "actually, wait…", a pointed one-liner question, a sharp "yes, but notice that…", a concise counterexample.

Do NOT:
- Write a full paragraph
- Use \`>>> next:\` or \`>>> react:\` markers (reactions are terminal)
- Restate the debate context

If you genuinely have nothing sharp to say in one line, reply with exactly \`[PASS]\` and nothing else.

**Write in the SAME language as the main speaker's message.** These instructions are in English, but your reaction must match the debate's language.

${roleNote}`;
}

export function buildReactionUserPrompt(args: BuildReactionPromptArgs): string {
  const { mainSpeakerName, mainTurnContent } = args;
  return `**${mainSpeakerName}** just said:

> ${mainTurnContent.trim().split("\n").join("\n> ")}

React in ≤30 words, or \`[PASS]\`.`;
}

// ==================== User prompt ====================

interface BuildUserPromptArgs {
  topic: string;
  turns: DebateTurn[];
  conversationContext?: string;
  referenceBlocks?: string;
  speakerName: string;
  wordLimit: number;
}

export function buildDebateUserPrompt(args: BuildUserPromptArgs): string {
  const { topic, turns, conversationContext, referenceBlocks, speakerName, wordLimit } = args;

  const contextSection = conversationContext
    ? `## Prior conversation context\n${conversationContext}\n\n`
    : "";

  const referenceSection = referenceBlocks
    ? `## Reference blocks (from the user's Roam graph)\nEach line starts with the block's ((uid)) — cite them inline when you draw on their content.\n\n${referenceBlocks}\n\n`
    : "";

  const transcript = renderTranscript(turns);

  return `${contextSection}${referenceSection}## Debate topic
${topic}

## Transcript so far
${transcript}

## Your turn
You are **${speakerName}**. Respond now, in character. Stay under ${wordLimit} words. Be conversational, address others by name when relevant, and move the discussion forward by one clear step.`;
}

// ==================== Conclusion-vote prompt ====================

interface BuildConcludeVotePromptArgs {
  topic: string;
  turns: DebateTurn[];
  conversationContext?: string;
  referenceBlocks?: string;
  speakerName: string;
  proposerName: string;
  wordLimit: number;
}

export function buildConcludeVoteUserPrompt(
  args: BuildConcludeVotePromptArgs,
): string {
  const {
    topic,
    turns,
    conversationContext,
    referenceBlocks,
    speakerName,
    proposerName,
    wordLimit,
  } = args;

  const contextSection = conversationContext
    ? `## Prior conversation context\n${conversationContext}\n\n`
    : "";

  const referenceSection = referenceBlocks
    ? `## Reference blocks (from the user's Roam graph)\n${referenceBlocks}\n\n`
    : "";

  const transcript = renderTranscript(turns);

  return `${contextSection}${referenceSection}## Debate topic
${topic}

## Transcript so far
${transcript}

## Conclusion vote
**${proposerName}** just proposed to conclude the debate (their turn ended with \`[CONCLUDE]\`).

You are **${speakerName}**. You have two choices:

1. **Agree to conclude** — if you genuinely believe the debate has reached a sound conclusion OR the original request is fully addressed, respond with ONLY \`[CONCLUDE]\` on a single line. Nothing else. Your agreement will be recorded but your message will not be displayed.

2. **Disagree and continue** — if you still have something substantive to add, a concern to raise, or a counter-point to make, respond normally (${wordLimit} words max). Your response will be displayed and the debate will continue. **Do NOT include \`[CONCLUDE]\` in a normal response** — it will be treated as a vote to end.

Choose one path. Be honest: if you truly have nothing more to add, vote to conclude — don't pad with filler.

If you choose to continue, write in the SAME language as the debate so far.`;
}
