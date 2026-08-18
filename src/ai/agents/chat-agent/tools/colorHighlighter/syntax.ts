/**
 * Color Highlighter syntax — encoder / decoder
 *
 * Mirrors the text conventions of the "Color Highlighter" Roam Depot extension
 * (https://github.com/fbgallet/roam-extension-color-highlighter), which stores
 * colors as plain text inside block strings:
 *
 *   inline : `#c:<color> ` + native Roam markup   e.g. `#c:green ^^highlighted^^`
 *   block  : a tag appended at the end of the block string, e.g. `#.bg-red`
 *
 * The single space between the `#c:<color>` tag and the markup is MANDATORY:
 * the companion extension styles the markup element through an adjacent-sibling
 * CSS selector, which only matches when the hidden tag directly precedes it.
 *
 * This module is intentionally free of any LangChain / Roam-write dependency so
 * that the chat message renderer can reuse it to display colors in the panel.
 */

export const CH_COLORS = [
  { name: "blue", light: "#cee9ff", dark: "#0254a0" },
  { name: "fuchsia", light: "#ffa0ea", dark: "#f012be" },
  { name: "green", light: "#d3f8d5", dark: "#439946" },
  { name: "orange", light: "#ffecd0", dark: "#ff851b" },
  { name: "silver", light: "#dddddd", dark: "#aaaaaa" },
  { name: "red", light: "#fcb8b8", dark: "#e51000" },
  { name: "teal", light: "#39cccc", dark: "#008080" },
  { name: "yellow", light: "#fff6b9", dark: "#ffdc00" },
  { name: "black", light: "#000000", dark: "#000000" },
] as const;

export type ChColor = (typeof CH_COLORS)[number]["name"];
export type ChVariant = "light" | "dark";

export const CH_COLOR_NAMES = CH_COLORS.map((c) => c.name) as ChColor[];

export type ChInlineFormat =
  | "highlight"
  | "text_color"
  | "underline"
  | "inline_box";
export type ChBlockFormat = "background" | "block_box";
export type ChFormat = ChInlineFormat | ChBlockFormat | "card_grid";

export const CH_INLINE_FORMATS: ChInlineFormat[] = [
  "highlight",
  "text_color",
  "underline",
  "inline_box",
];
export const CH_BLOCK_FORMATS: ChBlockFormat[] = ["background", "block_box"];

/** Native Roam markup used by each inline format. */
export const INLINE_MARKUP: Record<ChInlineFormat, string> = {
  highlight: "^^",
  text_color: "**",
  underline: "__",
  inline_box: "~~",
};

/** Tag prefix used by each block-level format. */
export const BLOCK_PREFIX: Record<ChBlockFormat, string> = {
  background: "#.bg-",
  block_box: "#.box-",
};

export const isInlineFormat = (f: string): f is ChInlineFormat =>
  (CH_INLINE_FORMATS as string[]).includes(f);
export const isBlockFormat = (f: string): f is ChBlockFormat =>
  (CH_BLOCK_FORMATS as string[]).includes(f);

/** Dark variant is expressed by an UPPERCASE color name (#c:BLUE, #.bg-RED). */
const casedColor = (color: ChColor, variant: ChVariant = "light"): string =>
  variant === "dark" ? color.toUpperCase() : color;

// ===========================================================================
// Builders — the ONLY place where the mandatory space is produced
// ===========================================================================

export function buildInlineMarkup(
  text: string,
  format: ChInlineFormat,
  color: ChColor,
  variant: ChVariant = "light",
): string {
  const m = INLINE_MARKUP[format];
  return `#c:${casedColor(color, variant)} ${m}${text}${m}`;
}

export function buildBlockTag(
  format: ChBlockFormat,
  color: ChColor,
  variant: ChVariant = "light",
  includeChildren = false,
): string {
  return `${BLOCK_PREFIX[format]}${includeChildren ? "ch-" : ""}${casedColor(
    color,
    variant,
  )}`;
}

/**
 * Card grid tag applied on a PARENT block to display its children as cards.
 * No uppercase (dark) variant and no black exist for this format.
 */
export function buildCardGridTag(
  kind: "plain" | "light" | "dark" | ChColor = "plain",
): string {
  return kind === "plain" ? "#.card-grid" : `#.card-grid-${kind}`;
}

// ===========================================================================
// Patterns
//
// NOTE: `[.]` is used instead of `\.` on purpose — these pattern sources are
// also embedded in Datalog `re-pattern` string literals, where `\.` is an
// illegal EDN escape that throws at query time.
// ===========================================================================

const COLOR_ALT = CH_COLOR_NAMES.join("|");

/** `#c:<color> ` + one of the four native markups. Groups 2..5 = inner text. */
const inlineRe = () =>
  new RegExp(
    `#c:(${COLOR_ALT}) (?:` +
      `\\^\\^([^^]*)\\^\\^` + // highlight
      `|\\*\\*([^*]*)\\*\\*` + // text color
      `|__([^_]*)__` + // underline
      `|~~([^~]*)~~` + // inline box
      `)`,
    "gi",
  );

/** `#.bg-red`, `#.bg-ch-RED`, `#.box-blue`, `#.box-ch-BLUE` */
export const BLOCK_TAG_PATTERN = `#[.](bg|box)-(ch-)?(${COLOR_ALT})\\b`;
const blockTagRe = () => new RegExp(BLOCK_TAG_PATTERN, "gi");

/** `#.card-grid`, `#.card-grid-light|dark|<color>` */
export const CARD_GRID_PATTERN = `#[.]card-grid(?:-(light|dark|${COLOR_ALT}))?\\b`;
const cardGridRe = () => new RegExp(CARD_GRID_PATTERN, "gi");

/** Datalog-safe pattern matching every tag page title used by the extension. */
export const TAG_PAGE_TITLE_PATTERN = (colors?: ChColor[]) =>
  `(?i)^(c:|[.](bg|box)-(ch-)?)(${(colors?.length ? colors : CH_COLOR_NAMES).join(
    "|",
  )})$`;

const variantOf = (rawColor: string): ChVariant =>
  rawColor === rawColor.toUpperCase() ? "dark" : "light";

// ===========================================================================
// Parsers
// ===========================================================================

export interface ColoredSpan {
  /** Inner text, markup and color tag stripped. */
  text: string;
  color: ChColor;
  variant: ChVariant;
  format: ChInlineFormat;
  /** Index of `#c:` in the source string. */
  start: number;
  /** Index just after the closing markup. */
  end: number;
  /** The full matched substring, including the color tag. */
  raw: string;
}

export function parseColoredSpans(content: string): ColoredSpan[] {
  if (!content) return [];
  const out: ColoredSpan[] = [];
  const re = inlineRe();
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const groups = [m[2], m[3], m[4], m[5]];
    const idx = groups.findIndex((g) => g !== undefined);
    if (idx === -1) continue;
    out.push({
      text: groups[idx] ?? "",
      color: m[1].toLowerCase() as ChColor,
      variant: variantOf(m[1]),
      format: CH_INLINE_FORMATS[idx],
      start: m.index,
      end: m.index + m[0].length,
      raw: m[0],
    });
  }
  return out;
}

export interface NativeSpan {
  text: string;
  format: ChInlineFormat;
  start: number;
  end: number;
  raw: string;
}

/**
 * Roam-native inline markup that carries NO Color Highlighter tag —
 * `^^plain highlight^^`, `**bold**`, `__italic__`, `~~strikethrough~~`.
 *
 * These are ordinary Roam formatting, not something this extension owns, but a
 * user asking to "clean the highlights" means all of them, coloured or not.
 */
export function parseNativeSpans(
  content: string,
  only?: ChInlineFormat,
): NativeSpan[] {
  if (!content) return [];
  const formats = only ? [only] : CH_INLINE_FORMATS;
  const colorTagTail = new RegExp(`#c:(?:${COLOR_ALT}) $`, "i");
  const out: NativeSpan[] = [];

  for (const format of formats) {
    const m = INLINE_MARKUP[format];
    const esc = m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const inner = `[^${m[0] === "^" ? "\\^" : `\\${m[0]}`}]*`;
    const re = new RegExp(`${esc}(${inner})${esc}`, "g");
    let hit: RegExpExecArray | null;
    while ((hit = re.exec(content))) {
      // Skip pairs introduced by a colour tag: those belong to parseColoredSpans
      if (colorTagTail.test(content.slice(0, hit.index))) continue;
      out.push({
        text: hit[1] ?? "",
        format,
        start: hit.index,
        end: hit.index + hit[0].length,
        raw: hit[0],
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Roam-native markup with no colour tag, e.g. `^^text^^`. */
export const buildNativeMarkup = (
  text: string,
  format: ChInlineFormat,
): string => `${INLINE_MARKUP[format]}${text}${INLINE_MARKUP[format]}`;

/** Human-readable name used in tool results. */
export const NATIVE_FORMAT_LABEL: Record<ChInlineFormat, string> = {
  highlight: "highlight",
  text_color: "bold",
  underline: "italic",
  inline_box: "strikethrough",
};

export interface BlockColor {
  format: ChBlockFormat;
  color: ChColor;
  variant: ChVariant;
  includeChildren: boolean;
  raw: string;
  start: number;
}

export function parseBlockColors(content: string): BlockColor[] {
  if (!content) return [];
  const out: BlockColor[] = [];
  const re = blockTagRe();
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    out.push({
      format: m[1].toLowerCase() === "bg" ? "background" : "block_box",
      color: m[3].toLowerCase() as ChColor,
      variant: variantOf(m[3]),
      includeChildren: !!m[2],
      raw: m[0],
      start: m.index,
    });
  }
  return out;
}

export function parseCardGrid(content: string): string | null {
  if (!content) return null;
  const m = cardGridRe().exec(content);
  return m ? m[0] : null;
}

/** True when the block carries any Color Highlighter syntax. */
export function hasColorSyntax(content: string): boolean {
  return (
    parseColoredSpans(content).length > 0 ||
    parseBlockColors(content).length > 0 ||
    parseCardGrid(content) !== null
  );
}

/**
 * Remove Color Highlighter syntax from a block string.
 * Mirrors `removeFromContent()` of the companion extension (src/index.js:799-840).
 *
 * @param keepMarkup true  -> `#c:green ^^x^^` becomes `^^x^^` (color removed, formatting kept)
 *                   false -> `#c:green ^^x^^` becomes `x`     (formatting removed too)
 */
export function stripColorSyntax(content: string, keepMarkup = false): string {
  if (!content) return "";
  let out = content;
  // Replace longest raw first so overlapping literals cannot shadow each other.
  const spans = parseColoredSpans(content).sort(
    (a, b) => b.raw.length - a.raw.length,
  );
  for (const s of spans) {
    const replacement = keepMarkup
      ? s.raw.slice(s.raw.indexOf(" ") + 1) // drop only the `#c:<color> ` tag
      : s.text;
    out = out.split(s.raw).join(replacement);
  }
  out = out.replace(blockTagRe(), "").replace(cardGridRe(), "");
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

/** Hex value the companion extension renders for a given color/variant. */
export function hexFor(color: ChColor, variant: ChVariant = "light"): string {
  const c = CH_COLORS.find((x) => x.name === color);
  if (!c) return "";
  return variant === "dark" ? c.dark : c.light;
}

/**
 * Known rendering gaps in the companion extension's CSS, surfaced to the user
 * so we never silently write something that will not render as expected.
 */
export function renderingCaveat(
  format: ChFormat,
  color: ChColor,
  variant: ChVariant,
): string | null {
  if (format === "background" && color === "yellow" && variant === "dark")
    return "Color Highlighter has no CSS rule for `#.bg-YELLOW`; the light yellow background is the only one that renders.";
  if (color === "yellow" && variant === "light" && isInlineFormat(format))
    return "Color Highlighter renders `#c:yellow` with its vivid yellow; light and dark yellow look identical inline.";
  if (color === "black")
    return "The `black` color follows your Roam theme variables rather than a fixed hex value.";
  return null;
}
