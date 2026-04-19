/**
 * Debate Roles & Presets
 *
 * Loaders for custom roles (#liveai/role) and debate presets (#liveai/debate-preset)
 * from the user's Roam graph, plus role resolution used by the orchestrator.
 *
 * Mirrors the pattern of getCustomStyles/getCustomStyleByUid in dataExtraction.js.
 */

// @ts-ignore - JS module, untyped
import {
  getOrderedCustomPromptBlocks,
  getCustomStyleByUid,
} from "../../dataExtraction";
import {
  getTreeByUid,
  createChildBlock,
  getBlockContentByUid,
} from "../../../utils/roamAPI";
import {
  DebateParticipant,
  DebatePreset,
  DebateRoleRef,
  DebateSubMode,
} from "./council-types";
import {
  BUILTIN_ROLE_DEFINITIONS,
  BuiltInDebateRoleDefinition,
} from "./council-debate-prompts";

// ==================== Custom roles (liveai/role) ====================

export function getCustomRoles(): Array<{ uid: string; title: string }> {
  const ordered = getOrderedCustomPromptBlocks("liveai/role");
  if (!ordered) return [];
  return ordered.map((r: { uid: string; content: string }) => ({
    uid: r.uid,
    title: r.content,
  }));
}

// Reuses the same reader as custom styles: flattens the child tree and
// handles any inline roam-context references.
export async function getCustomRoleByUid(uid: string): Promise<string> {
  return await getCustomStyleByUid(uid);
}

// ==================== Role resolution ====================

function appendExtra(fragment: string, extra?: string): string {
  const trimmed = (extra || "").trim();
  if (!trimmed) return fragment;
  if (!fragment) return trimmed;
  return `${fragment}\n\nAdditional instructions for this participant: ${trimmed}`;
}

export async function resolveRole(
  ref: DebateRoleRef
): Promise<{ label: string; fragment: string }> {
  if (ref.kind === "builtin") {
    const def: BuiltInDebateRoleDefinition | undefined =
      BUILTIN_ROLE_DEFINITIONS[ref.builtinId || "none"];
    if (!def) return { label: "Participant", fragment: appendExtra("", ref.extraInstructions) };
    return {
      label: def.label,
      fragment: appendExtra(def.systemFragment, ref.extraInstructions),
    };
  }
  if (ref.kind === "custom-graph" && ref.graphUid) {
    const fragment = await getCustomRoleByUid(ref.graphUid);
    return {
      label: ref.graphLabel || "Custom role",
      fragment: appendExtra(fragment || "", ref.extraInstructions),
    };
  }
  if (ref.kind === "custom-inline") {
    return {
      label: "Custom",
      fragment: appendExtra(
        (ref.inlineText || "").trim(),
        ref.extraInstructions
      ),
    };
  }
  return { label: "Participant", fragment: appendExtra("", ref.extraInstructions) };
}

// ==================== Debate presets (liveai/debate-preset) ====================

/**
 * Preset block layout in Roam:
 *
 *   My team preset #liveai/debate-preset
 *     sub-mode:: autonomous
 *     max-rounds:: 4
 *     word-limit:: 220
 *     allow-conclude:: true
 *     participant:: {"modelId":"gpt-4o","role":{"kind":"builtin","builtinId":"black-hat"}}
 *     participant:: {"modelId":"claude-3-5-sonnet-latest","role":{"kind":"builtin","builtinId":"green-hat"}}
 */

export function getDebatePresets(): Array<{ uid: string; name: string }> {
  const ordered = getOrderedCustomPromptBlocks("liveai/debate-preset");
  if (!ordered) return [];
  return ordered.map((p: { uid: string; content: string }) => ({
    uid: p.uid,
    name: p.content,
  }));
}

function parseParticipantLine(raw: string): DebateParticipant | null {
  const cleaned = raw.replace(/^participant::\s*/i, "").trim();
  if (!cleaned) return null;
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.modelId || !parsed.role) return null;
    return parsed as DebateParticipant;
  } catch {
    return null;
  }
}

function readAttributeValue(raw: string, attr: string): string | null {
  const re = new RegExp(`^${attr}::\\s*(.+)$`, "i");
  const m = raw.match(re);
  return m ? m[1].trim() : null;
}

export async function getDebatePresetByUid(
  uid: string
): Promise<DebatePreset | null> {
  const tree = getTreeByUid(uid);
  if (!tree) return null;
  const root = Array.isArray(tree) ? tree[0] : tree;
  if (!root) return null;

  const nameRaw: string = root.string || "";
  const name = nameRaw
    .replace(/\#?\[?\[?liveai\/debate-preset\]?\]?/i, "")
    .trim();

  const children: Array<{ string: string; order: number }> = (
    root.children || []
  )
    .slice()
    .sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

  const participants: DebateParticipant[] = [];
  let subMode: DebateSubMode | undefined;
  let maxRounds: number | undefined;
  let wordLimitPerTurn: number | undefined;
  let allowConclude: boolean | undefined;

  for (const c of children) {
    const s = (c.string || "").trim();
    if (!s) continue;
    const sub = readAttributeValue(s, "sub-mode");
    if (sub) {
      subMode = sub === "human-in-loop" ? "human-in-loop" : "autonomous";
      continue;
    }
    const mr = readAttributeValue(s, "max-rounds");
    if (mr) {
      const n = parseInt(mr, 10);
      if (!isNaN(n)) maxRounds = n;
      continue;
    }
    const wl = readAttributeValue(s, "word-limit");
    if (wl) {
      const n = parseInt(wl, 10);
      if (!isNaN(n)) wordLimitPerTurn = n;
      continue;
    }
    const ac = readAttributeValue(s, "allow-conclude");
    if (ac !== null) {
      allowConclude = ac.toLowerCase() === "true";
      continue;
    }
    if (/^participant::/i.test(s)) {
      const p = parseParticipantLine(s);
      if (p) participants.push(p);
    }
  }

  return {
    uid,
    name,
    participants,
    subMode,
    maxRounds,
    wordLimitPerTurn,
    allowConclude,
  };
}

export async function saveDebatePreset(
  name: string,
  participants: DebateParticipant[],
  subMode: DebateSubMode,
  maxRounds: number,
  wordLimitPerTurn: number,
  allowConclude: boolean
): Promise<string> {
  const today = window.roamAlphaAPI.util.dateToPageUid(new Date());
  // Ensure the daily note page exists.
  if (!getBlockContentByUid(today)) {
    await window.roamAlphaAPI.createPage({
      page: { title: window.roamAlphaAPI.util.dateToPageTitle(new Date()) },
    });
  }
  const presetUid = await createChildBlock(
    today,
    `${name} #[[liveai/debate-preset]]`,
    "first"
  );
  await createChildBlock(presetUid, `sub-mode:: ${subMode}`);
  await createChildBlock(presetUid, `max-rounds:: ${maxRounds}`);
  await createChildBlock(presetUid, `word-limit:: ${wordLimitPerTurn}`);
  await createChildBlock(presetUid, `allow-conclude:: ${allowConclude}`);
  for (const p of participants) {
    await createChildBlock(presetUid, `participant:: ${JSON.stringify(p)}`);
  }
  return presetUid;
}

// ==================== Built-in (non-graph) presets ====================

export interface BuiltInPreset {
  id: string;
  name: string;
  description: string;
  build: (defaultModel: string) => DebateParticipant[];
  subMode?: DebateSubMode;
  maxRounds?: number;
}

export const BUILTIN_DEBATE_PRESETS: BuiltInPreset[] = [
  {
    id: "six-hats",
    name: "Six Thinking Hats",
    description: "De Bono's six perspectives: facts, feelings, risks, benefits, creativity, process.",
    build: (m) => [
      // White Hat: lower temp — stick to facts, no speculation
      {
        modelId: m,
        role: { kind: "builtin", builtinId: "white-hat", temperature: 0.3 },
      },
      // Red Hat: higher temp — emotional reactions should feel spontaneous
      {
        modelId: m,
        role: { kind: "builtin", builtinId: "red-hat", temperature: 0.8 },
      },
      { modelId: m, role: { kind: "builtin", builtinId: "black-hat" } },
      { modelId: m, role: { kind: "builtin", builtinId: "yellow-hat" } },
      // Green Hat: higher temp — needs divergent, creative output
      {
        modelId: m,
        role: { kind: "builtin", builtinId: "green-hat", temperature: 0.9 },
      },
      { modelId: m, role: { kind: "builtin", builtinId: "blue-hat" } },
    ],
    subMode: "autonomous",
    maxRounds: 2,
  },
  {
    id: "socratic",
    name: "Socratic Dialogue",
    description: "Socrates probes; a Pragmatist answers.",
    build: (m) => [
      { modelId: m, role: { kind: "builtin", builtinId: "socrates" } },
      { modelId: m, role: { kind: "builtin", builtinId: "pragmatist" } },
    ],
    subMode: "autonomous",
    maxRounds: 4,
  },
  {
    id: "red-blue",
    name: "Red Team / Blue Team",
    description: "Devil's Advocate vs. Synthesizer.",
    build: (m) => [
      { modelId: m, role: { kind: "builtin", builtinId: "devils-advocate" } },
      { modelId: m, role: { kind: "builtin", builtinId: "synthesizer-role" } },
    ],
    subMode: "autonomous",
    maxRounds: 3,
  },
];
