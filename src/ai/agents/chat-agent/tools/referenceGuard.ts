/**
 * Guard against silently destroying block references and embeds.
 *
 * Every path that shows block content to the model resolves references first
 * (contextExpansion.ts:265 and :571 for the chat context,
 * getFlattenedContentFromTree for update_block's browse mode), so the model
 * only ever sees `((uid))` and `{{embed}}` already expanded to their text.
 *
 * If it then sends that text back as new_content, Roam stores the copy and the
 * reference is gone for good. These helpers detect that before the write.
 *
 * Pure string functions, no Roam API — kept separate so they stay trivially
 * testable and reusable by any tool that rewrites block content.
 */

/**
 * Matches a block reference `((uid))` or an embed component.
 *
 * The uid branch requires 6+ non-space, non-paren characters so ordinary
 * double parentheses in prose — "f((x))", "a (nested (aside))" — don't trip it.
 */
export const REFERENCE_TOKEN_RE =
  /\(\([^()\s]{6,}\)\)|\{\{\[\[embed(?:-path|-children)?\]\]\s*:[\s\S]*?\}\}|\{\{embed(?:-path|-children)?\s*:[\s\S]*?\}\}/g;

/**
 * References present in the stored block but missing from the proposed content.
 * Empty when nothing would be lost.
 *
 * Order-insensitive: reordering a block's references is fine, only losing one
 * is reported.
 */
export function findDroppedReferences(
  rawCurrent: string,
  newContent: string,
): string[] {
  const present = rawCurrent.match(REFERENCE_TOKEN_RE);
  if (!present?.length) return [];
  return [...new Set(present.filter((token) => !newContent.includes(token)))];
}

/** `((uid))` occurrences, including those inside `{{embed}}` components. */
const BLOCK_REF_RE = /\(\(([^()\s]{6,})\)\)/g;

/** `{{[[embed]]: [[Some Page]]}}` — an embedded PAGE rather than a block. */
const EMBEDDED_PAGE_RE =
  /\{\{\[?\[?embed(?:-path|-children)?\]?\]?\s*:\s*\[\[([^\]]+)\]\]\s*\}\}/g;

/**
 * Block uids this block points at through references or embeds.
 *
 * What a Roam user SEES in a block includes the content behind these, so a tool
 * acting on "what is displayed here" should be able to reach them.
 */
export function extractReferencedUids(content: string): string[] {
  if (!content) return [];
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  BLOCK_REF_RE.lastIndex = 0;
  while ((m = BLOCK_REF_RE.exec(content))) out.add(m[1]);
  return [...out];
}

/** Page titles embedded in this block, e.g. `{{[[embed]]: [[Some Page]]}}`. */
export function extractEmbeddedPageTitles(content: string): string[] {
  if (!content) return [];
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  EMBEDDED_PAGE_RE.lastIndex = 0;
  while ((m = EMBEDDED_PAGE_RE.exec(content))) out.add(m[1].trim());
  return [...out];
}

/**
 * Explanation handed back to the model when an edit would drop references.
 * Includes the RAW string so it can retry against what is really stored.
 */
export function referenceLossMessage(
  dropped: string[],
  rawContent: string,
): string {
  return (
    `this edit would destroy ${dropped.length} block reference/embed: ${dropped.join(", ")}. ` +
    `The content you were shown had them expanded to their text, but the block actually stores them as-is. ` +
    `RAW content: "${rawContent}". ` +
    `Retry with new_content built from this raw string, keeping the reference(s) verbatim — ` +
    `or set allow_removing_refs: true if the user really asked to remove them.`
  );
}
