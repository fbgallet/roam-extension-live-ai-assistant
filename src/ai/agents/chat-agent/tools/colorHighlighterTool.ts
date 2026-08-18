/**
 * Color Highlighter Tool
 *
 * Applies / extracts / removes the text conventions of the "Color Highlighter"
 * Roam Depot extension (highlight, text color, underline, inline box, block
 * background, block border, card grid).
 *
 * Design note — this tool edits blocks IN PLACE and never asks the LLM to
 * re-emit block content. Block text reaching the model has been through
 * `resolveReferences()`, which expands `((uid))` and `{{embed}}`; writing that
 * expanded text back would permanently destroy the block references. The model
 * only says WHAT to color, never the resulting string.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  getBlockContentByUid,
  isExistingBlock,
  updateBlock,
} from "../../../../utils/roamAPI";
import {
  confirmOutsideContext,
  expandWithReferences,
  resolveTargets,
  type ChatTarget,
} from "../targetScope";
import { truncateText } from "./toolUtils";
import {
  colorHighlighterWarning,
  detectColorHighlighter,
} from "./colorHighlighter/detect";
import {
  buildBlockTag,
  buildCardGridTag,
  buildInlineMarkup,
  buildNativeMarkup,
  NATIVE_FORMAT_LABEL,
  parseNativeSpans,
  CH_COLOR_NAMES,
  hasColorSyntax,
  isBlockFormat,
  isInlineFormat,
  parseBlockColors,
  parseColoredSpans,
  renderingCaveat,
  stripColorSyntax,
  type ChBlockFormat,
  type ChColor,
  type ChFormat,
  type ChInlineFormat,
  type ChVariant,
} from "./colorHighlighter/syntax";
import {
  extractColoredContent,
  type ChScope,
  type ExtractedItem,
} from "./colorHighlighter/query";

// ===========================================================================
// Schema
// ===========================================================================

const COLOR_ENUM = z.enum([
  "blue",
  "fuchsia",
  "green",
  "orange",
  "silver",
  "red",
  "teal",
  "yellow",
  "black",
]);

const FORMAT_ENUM = z.enum([
  "highlight",
  "text_color",
  "underline",
  "inline_box",
  "background",
  "block_box",
  "card_grid",
]);

const operationSchema = z
  .object({
    block_uid: z
      .string()
      .optional()
      .describe(
        "The 9-character UID of the block to format. OMIT it to let the tool find, within apply_scope, every block containing target_text.",
      ),
    format: FORMAT_ENUM.optional().describe(
      "Formatting to apply. Required for action 'apply'. For action 'remove': give a format to strip it (both the colored AND the plain Roam version of it), or omit it to strip only the color tags.",
    ),
    color: COLOR_ENUM.optional().describe(
      "Required for background and block_box. For the inline formats, OMIT it to write plain Roam markup with no color (e.g. ^^highlight^^).",
    ),
    variant: z
      .enum(["light", "dark"])
      .optional()
      .describe(
        '"light" (default, pastel) or "dark" (vivid). Dark is written as an UPPERCASE color tag.',
      ),
    target_text: z
      .string()
      .optional()
      .describe(
        "EXACT substring of the block to wrap (inline formats only). Omit to format the WHOLE block content. Ignored by background / block_box / card_grid.",
      ),
    occurrence: z
      .enum(["first", "all"])
      .optional()
      .describe(
        'Which occurrence(s) of target_text to wrap WITHIN each block. Default "first".',
      ),
    case_sensitive: z
      .boolean()
      .optional()
      .describe(
        'Default false: "live" also matches "Live". Set true only when the user explicitly asks for exact casing.',
      ),
    include_children: z
      .boolean()
      .optional()
      .describe(
        "background / block_box only: also style the block's children (#.bg-ch-* / #.box-ch-*)",
      ),
    keep_markup: z
      .boolean()
      .optional()
      .describe(
        "action 'remove' only: true (default) removes the color but keeps the ^^ ** __ ~~ formatting; false removes both.",
      ),
  })
  .passthrough();

const schema = z.object({
  action: z
    .enum(["apply", "extract", "remove"])
    .describe(
      "'apply': add color formatting to existing blocks. 'extract': find blocks already color-formatted. 'remove': strip color formatting.",
    ),

  // --- apply / remove ---
  operations: z
    .array(operationSchema)
    .max(20)
    .optional()
    .describe(
      "For 'apply' and 'remove': one entry per block (with block_uid), or one entry per text to color (with target_text and no block_uid). Maximum 20.",
    ),
  apply_scope: z
    .enum(["context", "main_view", "sidebar", "chat_response"])
    .optional()
    .describe(
      "Where to look for the text when operations omit block_uid. 'context': the blocks currently loaded in the chat context. 'main_view': the page or zoomed block currently open in Roam, and its descendants. 'sidebar': the contents of the right sidebar. 'chat_response': nothing is written to Roam, you re-emit the passage colored in your answer. OMIT it unless the user was explicit: the Context & target selector then decides, and may combine several sources.",
    ),

  // --- extract ---
  colors: z
    .array(COLOR_ENUM)
    .optional()
    .describe("Filter by color(s). Omit for any color."),
  formats: z
    .array(FORMAT_ENUM)
    .optional()
    .describe("Filter by format(s). Omit for any format."),
  variant_filter: z
    .enum(["light", "dark", "any"])
    .optional()
    .describe("Filter by light or dark variant. Default 'any'."),
  scope: z
    .enum(["current_context", "block_subtree", "page", "dnp_range", "graph"])
    .optional()
    .describe(
      "Where to search. Always choose the NARROWEST scope that answers the question. 'graph' scans the entire graph and requires explicit user confirmation — use it only when the user clearly asks for a graph-wide search.",
    ),
  page_title: z.string().optional().describe("Required when scope is 'page'."),
  block_uid: z
    .string()
    .optional()
    .describe("Root block UID, required when scope is 'block_subtree'."),
  dnp_start: z
    .string()
    .optional()
    .describe("ISO date YYYY-MM-DD, inclusive. Required when scope is 'dnp_range'."),
  dnp_end: z
    .string()
    .optional()
    .describe("ISO date YYYY-MM-DD, inclusive. Required when scope is 'dnp_range'."),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Maximum items returned. Default 50."),
  add_to_context: z
    .boolean()
    .optional()
    .describe(
      "Default true: push the extracted blocks into the results panel so you can comment on them.",
    ),
});

type Operation = z.infer<typeof operationSchema>;

// ===========================================================================
// target_text matching
// ===========================================================================

/** Strip Roam syntax that the LLM may not see verbatim, keeping an offset map. */
function normalizeForMatch(raw: string): { text: string; map: number[] } {
  const text: string[] = [];
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      lastWasSpace = true;
      text.push(" ");
      map.push(i);
      continue;
    }
    lastWasSpace = false;
    text.push(ch);
    map.push(i);
  }
  return { text: text.join(""), map };
}

export interface Match {
  start: number;
  end: number;
}

/**
 * Locate every occurrence of `needle` inside the RAW block string.
 *
 * Matching is CASE-INSENSITIVE by default (asking to highlight "live" should
 * also catch "Live"), and tolerant of whitespace differences. Tiers, in order,
 * first one that hits wins:
 *   1. literal match
 *   2. case-insensitive match
 *   3. whitespace-normalised match, mapped back to raw offsets
 *   4. whitespace-normalised + case-insensitive
 *
 * Returns [] rather than guessing, so the caller can report the raw content and
 * let the model retry with a literal substring.
 */
export function locateAllTargets(
  raw: string,
  needle: string,
  caseSensitive = false,
): Match[] {
  if (!needle) return [];

  const scan = (hay: string, nee: string): number[] => {
    const out: number[] = [];
    if (!nee) return out;
    let from = 0;
    for (;;) {
      const i = hay.indexOf(nee, from);
      if (i === -1) break;
      out.push(i);
      from = i + nee.length;
    }
    return out;
  };

  // Tier 1 & 2 — direct scan of the raw string
  const direct = caseSensitive
    ? scan(raw, needle)
    : scan(raw.toLowerCase(), needle.toLowerCase());
  if (direct.length)
    return direct.map((i) => ({ start: i, end: i + needle.length }));

  // Tier 3 & 4 — whitespace-normalised, mapped back to raw offsets
  const hay = normalizeForMatch(raw);
  const nee = normalizeForMatch(needle);
  const hits = caseSensitive
    ? scan(hay.text, nee.text)
    : scan(hay.text.toLowerCase(), nee.text.toLowerCase());

  return hits.map((i) => ({
    start: hay.map[i],
    end: hay.map[i + nee.text.length - 1] + 1,
  }));
}

/** First occurrence only. Kept for callers that need a single hit. */
export function locateTarget(
  raw: string,
  needle: string,
  caseSensitive = false,
): Match | null {
  return locateAllTargets(raw, needle, caseSensitive)[0] ?? null;
}

// ===========================================================================
// Pure transforms
// ===========================================================================

interface ApplyResult {
  next: string;
  note: string;
}

export function computeApply(
  current: string,
  op: Operation,
): ApplyResult | { error: string } {
  const format = op.format as ChFormat;
  const color = op.color as ChColor | undefined;
  const variant = (op.variant ?? "light") as ChVariant;

  // ---- card grid -------------------------------------------------------
  if (format === "card_grid") {
    if (variant === "dark" && color)
      return {
        error:
          "card_grid has no dark variant. Use color with the default light variant, or omit the color.",
      };
    if (color === "black")
      return { error: "card_grid has no black variant." };
    const tag = buildCardGridTag(color ?? "plain");
    if (current.includes(tag))
      return { next: current, note: `already carries ${tag}` };
    return { next: `${current.trim()} ${tag}`.trim(), note: `appended ${tag}` };
  }

  // ---- block-level formats --------------------------------------------
  if (isBlockFormat(format)) {
    const tag = buildBlockTag(
      format as ChBlockFormat,
      color,
      variant,
      !!op.include_children,
    );
    const existing = parseBlockColors(current).find((b) => b.format === format);
    if (existing) {
      if (existing.raw === tag)
        return { next: current, note: `already carries ${tag}` };
      // Replace the same-family tag rather than appending a second one,
      // mirroring the companion extension (src/index.js:918-927).
      return {
        next: current.split(existing.raw).join(tag).trim(),
        note: `replaced ${existing.raw} with ${tag}`,
      };
    }
    return { next: `${current.trim()} ${tag}`.trim(), note: `appended ${tag}` };
  }

  // ---- inline formats --------------------------------------------------
  const inline = format as ChInlineFormat;
  const existingSpans = parseColoredSpans(current);

  // Whole-block wrap
  if (!op.target_text) {
    if (existingSpans.length)
      return {
        error:
          "This block already contains color formatting. Provide target_text to color a specific part of it, or use action 'remove' first.",
      };
    const body = stripBlockTags(current);
    if (!body.text.trim())
      return { error: "The block is empty; there is nothing to color." };
    const wrapped = color
      ? buildInlineMarkup(body.text.trim(), inline, color, variant)
      : buildNativeMarkup(body.text.trim(), inline);
    return {
      next: `${wrapped}${body.trailing}`,
      note: "wrapped the whole block content",
    };
  }

  const all = locateAllTargets(current, op.target_text, !!op.case_sensitive);
  if (!all.length)
    return {
      error:
        `target_text was not found in the stored block content. The RAW content is: "${truncateText(
          current,
          250,
        )}". ` +
        "Note that block references appear expanded in your context but are stored as raw ((uid)) — retry with a substring copied from the raw content above.",
    };

  // Skip hits that fall inside an existing colored span (nesting is
  // unsupported upstream) rather than failing the whole operation.
  const usable = all.filter(
    (h) => !existingSpans.some((s) => h.start < s.end && h.end > s.start),
  );
  if (!usable.length)
    return {
      error:
        "That text is already inside a colored span. Color Highlighter does not support nested formatting — use action 'remove' on this block first.",
    };

  const targets = op.occurrence === "all" ? usable : [usable[0]];

  for (const t of targets) {
    if (/\^\^|\*\*|__|~~/.test(current.slice(t.start, t.end)))
      return {
        error:
          "target_text overlaps existing Roam formatting markup (^^, **, __ or ~~). Color Highlighter does not support nested markup — pick a plain-text substring.",
      };
  }

  // Splice from the end so earlier offsets stay valid.
  let next = current;
  for (const t of [...targets].sort((a, b) => b.start - a.start)) {
    const matched = current.slice(t.start, t.end);
    next =
      next.slice(0, t.start) +
      (color
        ? buildInlineMarkup(matched, inline, color, variant)
        : buildNativeMarkup(matched, inline)) +
      next.slice(t.end);
  }

  const firstMatch = current.slice(targets[0].start, targets[0].end);
  const caseNote =
    firstMatch !== op.target_text ? ` (matched "${firstMatch}")` : "";

  return {
    next,
    note: `wrapped "${truncateText(op.target_text, 40)}"${caseNote}${
      targets.length > 1 ? ` — ${targets.length} occurrences` : ""
    }`,
  };
}

/**
 * Split trailing block-level tags off the block body, so wrapping the "whole
 * block" does not swallow `#.bg-red` into the highlighted span.
 */
function stripBlockTags(content: string): { text: string; trailing: string } {
  const tags = parseBlockColors(content);
  if (!tags.length) return { text: content, trailing: "" };
  let text = content;
  const trailing: string[] = [];
  for (const t of tags) {
    text = text.split(t.raw).join("");
    trailing.push(t.raw);
  }
  return { text: text.trim(), trailing: ` ${trailing.join(" ")}` };
}

export function computeRemove(
  current: string,
  op: Operation,
): ApplyResult | { error: string } {
  const keepMarkup = op.keep_markup !== false;

  // ---- targeted removal of one format ----------------------------------
  if (op.format) {
    let next = current;
    const notes: string[] = [];

    if (isBlockFormat(op.format)) {
      const found = parseBlockColors(current).filter(
        (b) => b.format === op.format,
      );
      if (!found.length)
        return { error: `This block has no ${op.format} formatting.` };
      for (const b of found) next = next.split(b.raw).join("");
      notes.push(`removed ${op.format}`);
    } else if (isInlineFormat(op.format)) {
      const colored = parseColoredSpans(current).filter(
        (s) => s.format === op.format,
      );
      // Roam-native markup of the same kind: "clean the highlights" means all
      // of them, and an uncoloured one has nothing but its markup to remove.
      const native = parseNativeSpans(current, op.format);

      if (!colored.length && !native.length)
        return { error: `This block has no ${op.format} formatting.` };

      // Both sets are indexed against the ORIGINAL string and cannot overlap
      // (parseNativeSpans skips colour-tagged pairs). Splice from the end so
      // earlier offsets stay valid — and so a span that was merely DEcoloured
      // is not then mistaken for plain markup and stripped a second time.
      const edits = [
        ...colored.map((s) => ({
          start: s.start,
          end: s.end,
          replacement: keepMarkup
            ? s.raw.slice(s.raw.indexOf(" ") + 1)
            : s.text,
        })),
        ...native.map((s) => ({
          start: s.start,
          end: s.end,
          replacement: s.text,
        })),
      ].sort((a, b) => b.start - a.start);

      for (const e of edits) {
        next = next.slice(0, e.start) + e.replacement + next.slice(e.end);
      }

      if (colored.length) notes.push(`${colored.length} colored`);
      if (native.length)
        notes.push(`${native.length} native ${NATIVE_FORMAT_LABEL[op.format]}`);
    }

    return {
      next: next.replace(/[ \t]{2,}/g, " ").trim(),
      note: `removed ${notes.join(" + ")}`,
    };
  }

  // ---- no format given: strip the Color Highlighter syntax --------------
  if (!hasColorSyntax(current)) {
    const native = parseNativeSpans(current);
    if (!native.length)
      return { error: "This block carries no formatting to remove." };
    const kinds = [...new Set(native.map((s) => NATIVE_FORMAT_LABEL[s.format]))];
    return {
      error:
        `This block has no Color Highlighter formatting, but it does carry plain Roam ${kinds.join(", ")}. ` +
        `Call again with format set (e.g. "highlight") to remove that as well.`,
    };
  }

  return {
    next: stripColorSyntax(current, keepMarkup),
    note: keepMarkup
      ? "removed color tags (text formatting kept)"
      : "removed color tags and text formatting",
  };
}

// ===========================================================================
// Target resolution — when operations omit block_uid
// ===========================================================================

type ApplyScope = "context" | "main_view" | "sidebar" | "chat_response";

/**
 * Where to look for the text.
 *
 * Priority: what the model explicitly asked for > the user's Target selector in
 * the chat toolbar > "context" when the context holds blocks, else "main_view".
 * The user's explicit selector choice wins over the "auto" fallback but never
 * over an explicit apply_scope, so "highlight X in the current page" still works
 * while the selector says Context.
 */
function resolveApplySources(
  explicit: ApplyScope | undefined,
  chatTargets: ChatTarget[],
  contextUids: string[],
): ChatTarget[] {
  // An explicit apply_scope from the model always wins, so "highlight X in the
  // current page" still works while the selector says Context.
  if (explicit && explicit !== "chat_response") return [explicit as ChatTarget];
  if (chatTargets.length) return chatTargets;
  return contextUids.length ? ["context"] : ["main_view"];
}

/**
 * Expand operations without block_uid into one operation per matching block,
 * searching the blocks of the resolved scope.
 */
export function expandOperations(
  operations: Operation[],
  candidateUids: string[],
  followRefs = true,
): { expanded: Operation[]; notFound: string[] } {
  const expanded: Operation[] = [];
  const notFound: string[] = [];

  const matches = (uid: string, op: Operation) =>
    locateAllTargets(
      getBlockContentByUid(uid),
      op.target_text!,
      !!op.case_sensitive,
    ).length > 0;

  for (const op of operations) {
    // A named block whose text isn't actually in it: the passage the user sees
    // may live in a block it references or embeds, so look there before failing.
    if (op.block_uid) {
      if (!op.target_text || matches(op.block_uid, op) || !followRefs) {
        expanded.push(op);
        continue;
      }
      const behind = expandWithReferences([op.block_uid]).filter(
        (uid) => uid !== op.block_uid && matches(uid, op),
      );
      if (behind.length) {
        for (const uid of behind) expanded.push({ ...op, block_uid: uid });
      } else {
        // Keep the original so the caller reports the usual "not found" error
        expanded.push(op);
      }
      continue;
    }

    if (!op.target_text) {
      notFound.push(
        "an operation has neither block_uid nor target_text — one of them is required",
      );
      continue;
    }

    const hits = candidateUids.filter((uid) => matches(uid, op));
    if (!hits.length) {
      notFound.push(`"${truncateText(op.target_text, 60)}" was not found`);
      continue;
    }
    for (const uid of hits) expanded.push({ ...op, block_uid: uid });
  }

  return { expanded, notFound };
}

// ===========================================================================
// apply / remove handler
// ===========================================================================

async function runMutations(
  action: "apply" | "remove",
  operations: Operation[],
  applyScope: ApplyScope | undefined,
  config: any,
  warning: string | null,
): Promise<string> {
  if (!operations.length)
    return `⚠️ No operations provided. For action '${action}', pass an 'operations' array with at least one entry.`;

  const skipped: string[] = [];
  // Set when the tool acted outside the loaded context, so the write
  // confirmation can show WHERE it is about to write.
  let targetDescription: string | null = null;

  // Resolve operations that did not name a block.
  if (operations.some((op) => !op.block_uid)) {
    const contextUids = ((config?.configurable?.currentResultsContext ||
      []) as any[])
      .map((r) => r?.uid || r?.blockUid)
      .filter(Boolean);

    const chatTargets = (config?.configurable?.chatTargets || []) as ChatTarget[];
    const followRefs = config?.configurable?.followRefs !== false;
    const scope = applyScope;
    const sources = resolveApplySources(applyScope, chatTargets, contextUids);
    console.log(
      `[color_highlighter] apply_scope=${applyScope ?? "(unset)"} chatTargets=[${chatTargets.join(", ")}] contextUids=${contextUids.length} -> sources=[${sources.join(", ")}]`,
    );

    if (scope === "chat_response") {
      const wanted = operations
        .filter((op) => op.target_text)
        .map(
          (op) =>
            `- "${op.target_text}" -> ${buildInlineMarkup(
              op.target_text!,
              (op.format ?? "highlight") as ChInlineFormat,
              (op.color ?? "yellow") as ChColor,
              (op.variant ?? "light") as ChVariant,
            )}`,
        )
        .join("\n");
      return (
        "The user chose to color your CHAT ANSWER rather than their Roam graph, so nothing was written to the graph.\n\n" +
        "Rewrite the relevant passage in your reply using this syntax:\n" +
        wanted +
        "\n\nNote: colored rendering inside the chat panel is not available yet, so the syntax will show as raw tags for now. Mention this briefly to the user and offer to apply the colors in Roam instead."
      );
    }

    const resolution = await resolveTargets(sources, contextUids);
    const candidateUids = resolution.uids;
    const scopeLabel = resolution.description;

    // Acting outside the loaded context needs the user's agreement, unless they
    // pinned that target themselves in the Target selector.
    //
    // A per-operation write confirmation (with a before/after diff) normally
    // follows, and it now carries the target — so a separate dialog would just
    // double-prompt. Only ask standalone when that write dialog is suppressed.
    const writeConfirmWillFollow =
      !!config?.configurable?.toolConfirmationCallback &&
      !(config?.configurable?.alwaysApprovedTools as Set<string> | undefined)?.has(
        "color_highlighter",
      );
    if (
      resolution.outsideContext &&
      !chatTargets.length &&
      !applyScope &&
      !writeConfirmWillFollow
    ) {
      const denied = await confirmOutsideContext(config, resolution.description);
      if (denied) return denied;
    }
    if (resolution.outsideContext) targetDescription = resolution.description;

    if (!candidateUids.length)
      return sources.length === 1 && sources[0] === "context"
        ? "⚠️ The chat context is empty, so there is nothing to color. Ask the user to add the relevant blocks to the context, or call again with apply_scope: 'main_view'."
        : `⚠️ ${scopeLabel} has no blocks to color.`;

    // Content behind ((refs)) and {{embeds}} is part of what the user sees in
    // these blocks, so it is a legitimate target unless they opted out.
    const searchUids = followRefs
      ? expandWithReferences(candidateUids)
      : candidateUids;
    const { expanded, notFound } = expandOperations(
      operations,
      searchUids,
      followRefs,
    );
    console.log(
      `[color_highlighter] searched ${searchUids.length} block(s) in ${scopeLabel} for ${operations.length} target(s) -> ${expanded.length} match(es), ${notFound.length} not found`,
    );
    skipped.push(...notFound.map((n) => `${n} in the ${scopeLabel}`));
    operations = expanded;

    if (!operations.length)
      return (
        `⚠️ Nothing to color in ${scopeLabel}.\n${skipped.map((s) => `- ${s}`).join("\n")}\n\n` +
        "Tell the user what was searched, and ask whether they meant a different target " +
        (sources.length === 1 && sources[0] === "context"
          ? "(e.g. the page currently open — call again with apply_scope: 'main_view')."
          : "(e.g. blocks they could add to the chat context).")
      );
  }

  const valid: { op: Operation; index: number; current: string; next: string; note: string }[] = [];
  const caveats = new Set<string>();

  operations.forEach((op, index) => {
    const label = `#${index + 1} (${op.block_uid || "no uid"})`;

    if (!op.block_uid || !isExistingBlock(op.block_uid)) {
      skipped.push(`${label}: block not found in the graph.`);
      return;
    }
    if (action === "apply") {
      if (!op.format) {
        skipped.push(`${label}: 'format' is required for action 'apply'.`);
        return;
      }
      // Colour is only mandatory for block-level formats; an inline format
      // without a colour writes plain Roam markup (e.g. ^^highlight^^).
      if (
        !op.color &&
        (op.format === "background" || op.format === "block_box")
      ) {
        skipped.push(`${label}: 'color' is required for format ${op.format}.`);
        return;
      }
    }

    const current = getBlockContentByUid(op.block_uid);
    const result =
      action === "apply" ? computeApply(current, op) : computeRemove(current, op);

    if ("error" in result) {
      skipped.push(`${label}: ${result.error}`);
      return;
    }
    if (result.next === current) {
      skipped.push(`${label}: no change needed (${result.note}).`);
      return;
    }

    if (action === "apply" && op.format && op.color) {
      const caveat = renderingCaveat(
        op.format as ChFormat,
        op.color as ChColor,
        (op.variant ?? "light") as ChVariant,
      );
      if (caveat) caveats.add(caveat);
    }

    valid.push({ op, index, current, next: result.next, note: result.note });
  });

  if (!valid.length)
    return `⚠️ All ${operations.length} operation(s) were skipped.\n${skipped
      .map((s) => `- ${s}`)
      .join("\n")}`;

  // Confirmation — same args shape as update_block so the existing diff
  // preview in ChatMessagesDisplay can render it.
  const toolConfirmationCallback = config?.configurable?.toolConfirmationCallback;
  const alwaysApprovedTools = config?.configurable?.alwaysApprovedTools as
    | Set<string>
    | undefined;

  if (toolConfirmationCallback && !alwaysApprovedTools?.has("color_highlighter")) {
    const confirmationResult = await toolConfirmationCallback({
      toolName: "color_highlighter",
      toolCallId: `color_highlighter_${action}_${Date.now()}`,
      args: {
        operation_count: valid.length,
        operations: valid.map((v) => ({
          block_uid: v.op.block_uid,
          current_content: v.current,
          new_content: v.next,
        })),
        non_atomic: valid.length > 1,
        ...(targetDescription ? { target: targetDescription } : {}),
      },
    });
    if (!confirmationResult.approved) {
      const reason = confirmationResult.declineReason
        ? `\n\nUser's feedback: "${confirmationResult.declineReason}"`
        : "";
      return `⚠️ Color formatting was declined by the user.${reason}\n\nPlease ask the user what they would like to change.`;
    }
  }

  const done: string[] = [];
  const failed: string[] = [];
  for (const v of valid) {
    try {
      await updateBlock({ blockUid: v.op.block_uid, newContent: v.next });
      done.push(`((${v.op.block_uid})) — ${v.note}`);
    } catch (e: any) {
      failed.push(`((${v.op.block_uid})) — FAILED: ${e?.message || String(e)}`);
    }
  }

  const parts: string[] = [];
  parts.push(
    `✅ ${action === "apply" ? "Applied color formatting to" : "Removed color formatting from"} ${done.length} block(s).`,
  );
  if (done.length) parts.push(done.map((d) => `- ${d}`).join("\n"));
  if (failed.length) parts.push(`❌ ${failed.length} failed:\n${failed.map((f) => `- ${f}`).join("\n")}`);
  if (skipped.length) parts.push(`⚠️ ${skipped.length} skipped:\n${skipped.map((s) => `- ${s}`).join("\n")}`);
  if (caveats.size) parts.push([...caveats].map((c) => `ℹ️ ${c}`).join("\n"));
  if (warning) parts.push(warning);

  return parts.join("\n\n");
}

// ===========================================================================
// extract handler
// ===========================================================================

async function runExtract(
  input: z.infer<typeof schema>,
  config: any,
  warning: string | null,
): Promise<string> {
  const currentResults = (config?.configurable?.currentResultsContext ||
    []) as any[];
  const contextUids = currentResults
    .map((r) => r?.uid || r?.blockUid)
    .filter(Boolean);

  const scope: ChScope =
    input.scope ?? (contextUids.length ? "current_context" : "page");

  if (scope === "page" && !input.page_title)
    return "⚠️ scope 'page' requires page_title. Alternatively use scope 'block_subtree' with a block_uid, 'dnp_range' with dnp_start/dnp_end, or 'current_context' if results are already loaded.";

  // Whole-graph scans are expensive and flood the context: confirm first.
  if (scope === "graph") {
    const toolConfirmationCallback =
      config?.configurable?.toolConfirmationCallback;
    const alwaysApprovedTools = config?.configurable?.alwaysApprovedTools as
      | Set<string>
      | undefined;
    if (toolConfirmationCallback && !alwaysApprovedTools?.has("color_highlighter")) {
      const filterLabel = [
        input.colors?.length ? input.colors.join(", ") : "any color",
        input.formats?.length ? input.formats.join(", ") : "any format",
      ].join(" / ");
      const confirmationResult = await toolConfirmationCallback({
        toolName: "color_highlighter",
        toolCallId: `color_highlighter_graph_scan_${Date.now()}`,
        args: {
          operation: "graph-wide color extraction",
          scope: "entire graph",
          filters: filterLabel,
          warning:
            "This scans every block in your graph and may return a large amount of content.",
        },
      });
      if (!confirmationResult.approved) {
        const reason = confirmationResult.declineReason
          ? ` User's feedback: "${confirmationResult.declineReason}"`
          : "";
        return `⚠️ The graph-wide color extraction was declined by the user.${reason}\n\nAsk the user which page, block or date range to search instead.`;
      }
    } else if (!toolConfirmationCallback) {
      return "⚠️ Graph-wide extraction requires user confirmation, which is not available right now. Ask the user which page, block or date range to search instead, and call again with a narrower scope.";
    }
  }

  const { items, error } = extractColoredContent({
    scope,
    filters: {
      colors: input.colors as ChColor[] | undefined,
      formats: input.formats as ChFormat[] | undefined,
      variant: input.variant_filter,
    },
    pageTitle: input.page_title,
    blockUid: input.block_uid,
    dnpStart: input.dnp_start,
    dnpEnd: input.dnp_end,
    contextUids,
  });

  if (error) return `⚠️ ${error}`;

  if (!items.length) {
    const what = [
      input.colors?.length ? input.colors.join("/") : null,
      input.formats?.length ? input.formats.join("/") : null,
    ]
      .filter(Boolean)
      .join(" ");
    return `No color-formatted content found${what ? ` for ${what}` : ""} in scope '${scope}'.${
      warning ? `\n\n${warning}` : ""
    }`;
  }

  const max = input.max_results ?? 50;
  const shown = items.slice(0, max);

  if (input.add_to_context !== false) {
    const addResultsCallback = config?.configurable?.addResultsCallback;
    if (addResultsCallback) {
      const seen = new Set<string>();
      const results = shown
        .filter((it) => !seen.has(it.uid) && seen.add(it.uid))
        .map((it) => ({
          uid: it.uid,
          text: it.blockContent,
          pageTitle: it.pageTitle || "",
          pageUid: it.pageUid || it.uid,
          blockUid: it.uid,
          parentText: "",
          ancestorTexts: [] as string[],
          isPage: false,
          addedByAgent: true,
          addedAt: new Date().toISOString(),
        }));
      addResultsCallback(results);
    }
  }

  const lines = shown.map((it: ExtractedItem, i: number) => {
    const variantLabel = it.variant === "dark" ? `${it.color.toUpperCase()}/dark` : `${it.color}/light`;
    return (
      `${i + 1}. ((${it.uid})) [[${it.pageTitle}]] · ${variantLabel} · ${it.format}\n` +
      `   "${truncateText(it.text.trim(), 300)}"`
    );
  });

  const parts: string[] = [];
  parts.push(
    `🎨 Found ${items.length} color-formatted item(s) (scope: ${scope}${
      input.page_title ? ` — [[${input.page_title}]]` : ""
    }).`,
  );
  parts.push(lines.join("\n"));
  if (items.length > shown.length)
    parts.push(
      `Showing ${shown.length} of ${items.length}. Narrow the filters or raise max_results to see the rest.`,
    );
  if (input.add_to_context !== false)
    parts.push("These blocks were added to the results context.");
  if (warning) parts.push(warning);

  return parts.join("\n\n");
}

// ===========================================================================
// Description
// ===========================================================================

const COLOR_HIGHLIGHTER_DESCRIPTION = `Apply or extract COLOR FORMATTING in Roam, using the "Color Highlighter" extension conventions.

Use this tool when the user asks to highlight / colorize / underline / box / set a background on Roam content, or to find, gather or comment on content already formatted in a given color (e.g. "highlight the key sentence in green", "extract and comment everything highlighted in blue").

=== ACTIONS ===
- "apply"   -> add formatting to EXISTING blocks (batch, max 20 operations)
- "extract" -> find blocks already color-formatted, filtered by color / format / scope
- "remove"  -> strip formatting from blocks

PLAIN ROAM FORMATTING: the four inline formats also exist WITHOUT a color.
- apply with no "color" writes plain markup: ^^highlight^^, **bold**, __italic__, ~~strikethrough~~.
- remove with a "format" strips BOTH the colored and the plain version of it. So "clean up the highlights on this page" works whether or not the highlights were colored — always pass format: "highlight" for that request.
- remove without a "format" only strips color tags; if the block has plain formatting instead, the tool says so and asks you to re-call with the format.

=== SYNTAX CHEAT-SHEET (write it yourself when CREATING new content) ===
This tool only formats blocks that ALREADY exist. When you are creating new content with create_block or create_page, embed the syntax directly in your markdown instead of calling this tool afterwards.

INLINE — the hidden tag "#c:<color>", then EXACTLY ONE SPACE, then native Roam markup:
  highlight    #c:green ^^important text^^
  text color   #c:blue **colored text**
  underline    #c:red __underlined text__
  inline box   #c:teal ~~boxed text~~
The single space between the tag and the markup is MANDATORY — without it nothing renders.
To color a page reference, wrap it like any other text: #c:blue ^^[[Some Page]]^^

BLOCK-LEVEL — a hidden tag appended at the END of the block text, after one space:
  background            block text #.bg-red
  background + children block text #.bg-ch-red
  block border box      block text #.box-blue
  box + children        block text #.box-ch-blue
  card grid (on parent) #.card-grid   #.card-grid-light   #.card-grid-dark   #.card-grid-blue
One #.bg-* and one #.box-* per block maximum; they may coexist.

COLORS: ${CH_COLOR_NAMES.join(", ")}.
VARIANTS: lowercase = light/pastel (default). UPPERCASE = dark/vivid (#c:BLUE, #.bg-RED).
card_grid has no dark variant and no black.

=== APPLY RULES ===
- If you already know which blocks to color, give the 9-character block_uid of each (read them from the ((uid)) references in your context).
- Otherwise send one operation per text to color, with target_text and NO block_uid. Never guess a uid, and never search the whole graph for it.
- target_text matching is CASE-INSENSITIVE and whitespace-tolerant by default, so "live" also matches "Live". Set case_sensitive: true only if the user asks for exact casing.
- REFERENCES AND EMBEDS: what a Roam user sees in a block includes the content behind its ((block refs)) and {{embeds}}, and the tool follows them by default — so a passage that lives in a referenced block IS reachable, and the edit is applied there, in the block that really owns the text. You don't need to resolve references yourself. (The user can switch this off in the Context & target menu.)
- target_text must exist in the STORED text of some reachable block: block content shown to you may have references expanded. If the tool reports it was not found, it returns the raw content — retry with a substring copied from there.
- Omit target_text to color the ENTIRE block content (inline formats only). This requires block_uid.

=== WHERE THE COLORS ARE APPLIED (apply_scope) ===
When operations have no block_uid, the tool searches for target_text inside one of these:
  "context"       the blocks currently loaded in the chat context
  "main_view"     the page or zoomed block currently open in Roam, and its descendants
  "sidebar"       the contents of the right sidebar
  "chat_response" nothing is written to Roam; you re-emit the passage colored in your own answer

NEVER refuse to act because nothing is loaded in the chat context. The main view is always a legitimate target and the tool reads it directly — do not ask the user to load their page first.

Decide as follows:
1. The user was explicit -> set apply_scope yourself. "in this page" / "in what's open" / "here" -> "main_view". "in what I loaded" / "in these blocks" / "in the results" -> "context". "in the sidebar" -> "sidebar". "in your answer" / "just show me" -> "chat_response".
2. Otherwise -> OMIT apply_scope. The user's Context & target selector next to the chat input decides, and several sources can be ticked at once (they are searched together). With nothing ticked it falls back to the loaded context, or the main view when the context is empty. Just call the tool and let that happen.
Only ask the user yourself when the request stays genuinely ambiguous AFTER a call came back empty — the tool then tells you what was searched, so suggest another target rather than asking a generic question.
- background / block_box / card_grid ignore target_text: they always apply to the whole block.
- Do NOT read ~~text~~ as strikethrough here: preceded by a #c: tag it means "inline box".
- Nested formatting is not supported: color a plain-text substring, not one that already carries markup.

=== EXTRACT RULES ===
- Always choose the NARROWEST scope that answers the question: current_context < block_subtree < page < dnp_range < graph.
- scope "graph" scans every block and REQUIRES explicit user confirmation — only use it when the user clearly asks for a graph-wide search. Prefer asking which page or period to search.
- Combine filters when the user is specific ("everything highlighted in blue" -> colors:["blue"], formats:["highlight"]).
- Results come back with their ((uid)), page, color, format and the colored text itself, and are added to the results panel unless add_to_context is false.

This tool requires the user's "Color Highlighter" Roam Depot extension for the colors to RENDER. If it is missing, the syntax is still written correctly but shows as plain tags; the tool will say so.`;

// ===========================================================================
// Tool
// ===========================================================================

export const colorHighlighterTool = tool(
  async (input: z.infer<typeof schema>, config) => {
    try {
      const status = detectColorHighlighter();
      const warning = colorHighlighterWarning(status);

      if (input.action === "extract") {
        return await runExtract(input, config, warning);
      }
      return await runMutations(
        input.action,
        (input.operations ?? []) as Operation[],
        input.apply_scope as ApplyScope | undefined,
        config,
        warning,
      );
    } catch (error: any) {
      console.error("[color_highlighter] error:", error);
      return `❌ Color Highlighter tool error: ${error?.message || String(error)}`;
    }
  },
  {
    name: "color_highlighter",
    description: COLOR_HIGHLIGHTER_DESCRIPTION,
    schema,
  },
);
