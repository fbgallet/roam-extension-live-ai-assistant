/**
 * Runtime detection of the "Color Highlighter" Roam Depot extension.
 *
 * The color syntax is plain text, so writing it never fails — but without the
 * companion extension installed the tags stay visible and uncolored. We detect
 * it to warn the user, never to block the tool.
 *
 * Imported by both the tool handler and the React tools menu, so it must not
 * import anything from the tool itself.
 */

export interface ChStatus {
  installed: boolean;
  /** installed AND enabled AND adminEnabled */
  enabled: boolean;
  id?: string;
  name?: string;
  version?: string;
}

/** Matches "Color Highlighter", "color-highlighter", "…+roam-extension-color-highlighter". */
const NAME_RE = /color[\s_+-]*highlighter/i;

const TTL_MS = 30_000;
let cache: { at: number; value: ChStatus } | null = null;

/**
 * @param force skip the cache (use when reopening the tools menu, so a
 *              just-installed extension is picked up immediately)
 */
export function detectColorHighlighter(force = false): ChStatus {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;

  let value: ChStatus = { installed: false, enabled: false };
  try {
    const installed = (window as any).roamAlphaAPI?.depot?.getInstalledExtensions?.();
    for (const [key, ext] of Object.entries<any>(installed ?? {})) {
      // ids look like "fbgallet+roam-extension-color-highlighter"
      const idHay = String(ext?.id ?? key).replace(/[+_-]/g, " ");
      const nameHay = String(ext?.name ?? "").replace(/[+_-]/g, " ");
      if (NAME_RE.test(idHay) || NAME_RE.test(nameHay)) {
        // Only `enabled` reflects whether the extension is running.
        // `adminEnabled` is an independent graph-admin flag and is commonly
        // false on a normally installed personal extension — do NOT test it.
        value = {
          installed: true,
          enabled: ext?.enabled !== false,
          id: ext?.id ?? key,
          name: ext?.name,
          version: ext?.version,
        };
        break;
      }
    }
  } catch (e) {
    console.warn("[color_highlighter] Roam Depot detection failed:", e);
    // Fail OPEN: a false "missing" warning on every turn is worse than a
    // missing one, and the depot API shape is not contractually stable.
    value = { installed: true, enabled: true };
  }

  cache = { at: Date.now(), value };
  return value;
}

/** Advisory message appended to tool results. Null when everything is fine. */
export function colorHighlighterWarning(status: ChStatus): string | null {
  if (!status.installed)
    return '⚠️ The "Color Highlighter" extension does not appear to be installed (Roam Depot). The color syntax was written correctly but will show up as plain text tags until you install it.';
  if (!status.enabled)
    return '⚠️ The "Color Highlighter" extension is installed but disabled. Colors will not render until you re-enable it in Roam Depot.';
  return null;
}
