/**
 * Target scope — WHERE the agent's tools act.
 *
 * This is deliberately distinct from the chat CONTEXT, which is what the agent
 * READS. Before this existed, the only way to designate something to act on was
 * to load it as context, which is wrong for editing (you may want to edit a
 * large page without pouring it into the prompt) and confusing for the user.
 *
 * "context"   -> the blocks currently loaded in the chat context
 * "main_view" -> the page or zoomed block open in Roam, and its descendants
 * "sidebar"   -> the contents of the right sidebar
 *
 * Several may be ticked at once. Whatever is ticked is both ADDED to what the
 * agent reads and used as the TARGET when a request names no page or block.
 * Nothing ticked falls back to the loaded context, or the main view when the
 * context is empty.
 */

import {
  getPageUidByPageName,
  getPageNameByPageUid,
  getPageUidByBlockUid,
  getBlockContentByUid,
  isExistingBlock,
  getDNPTitleFromDate,
  getTreeByUid,
  treeToUidArray,
} from "../../../utils/roamAPI";
import {
  extractEmbeddedPageTitles,
  extractReferencedUids,
} from "./tools/referenceGuard";

/** A single selectable source. Several may be active at once. */
export type ChatTarget = "context" | "main_view" | "sidebar";

/** Concrete place a tool ended up acting on. */
export type ResolvedTarget = ChatTarget;

export const CHAT_TARGETS: {
  value: ChatTarget;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    value: "context",
    label: "Loaded context (default)",
    icon: "database",
    description:
      "The blocks you loaded into this chat's results panel. A fixed selection: it only changes when you add or remove results.",
  },
  {
    value: "main_view",
    label: "Main view",
    icon: "document",
    description:
      "The page or zoomed block open in Roam, with all its descendants. Re-read before every request, so it always reflects what you are looking at right now — change page or zoom in, and the next request follows you there.",
  },
  {
    value: "sidebar",
    label: "Sidebar",
    icon: "panel-stats",
    description:
      "Everything open in the right sidebar. Re-read before every request, so opening or closing a sidebar window is taken into account immediately.",
  },
];

/**
 * A source can be READ (added to what the agent sees), ACTED ON (where editing
 * tools apply changes), or both — the two are independent.
 */
export interface TargetConfig {
  read: ChatTarget[];
  act: ChatTarget[];
  /**
   * Follow `((block refs))` and `{{embeds}}` when acting. Default true: what a
   * Roam user sees in a block includes the content behind them, so editing
   * "what is shown here" is expected to reach it.
   */
  followRefs?: boolean;
}

/**
 * Reset state when nothing is pinned: read the loaded context, and let the act
 * target resolve automatically (context if any, else main view).
 */
export const DEFAULT_TARGET_CONFIG: TargetConfig = {
  read: ["context"],
  act: [],
  followRefs: true,
};

export const targetLabel = (t: ChatTarget): string =>
  CHAT_TARGETS.find((o) => o.value === t)?.label ?? t;

/**
 * Tooltip summary for the toolbar button.
 *
 * `withAct` is false outside agent mode: no tool runs then, so mentioning a
 * write target would describe something that cannot happen.
 */
export function targetsButtonLabel(
  config: TargetConfig,
  withAct = true,
): string {
  const read = config.read.length
    ? config.read.map(targetLabel).join(" + ")
    : "nothing";
  if (!withAct) return `reads ${read}`;
  const act = config.act.length
    ? config.act.map(targetLabel).join(" + ")
    : "auto (loaded context, else main view)";
  return `reads ${read} · acts on ${act}`;
}

/**
 * Main view resolution that also covers the daily-notes LOG view, where
 * `getOpenPageOrBlockUid()` returns nothing. Mirrors getMainViewContainer()
 * in tools/outlineEvaluator.ts.
 */
export async function getMainViewRootUid(): Promise<{
  uid: string;
  description: string;
} | null> {
  try {
    const openView = await (window as any).roamAlphaAPI?.ui?.mainWindow?.getOpenView?.();
    console.log("[target] getOpenView() ->", openView);
    if (!openView) return null;

    if (openView.type === "log") {
      const title = getDNPTitleFromDate(new Date());
      const uid = getPageUidByPageName(title);
      return uid ? { uid, description: `today's daily note [[${title}]]` } : null;
    }

    const uid = openView.uid || openView["page-uid"] || openView["block-uid"];
    if (!uid) return null;
    return {
      uid,
      description: openView.title
        ? `page [[${openView.title}]]`
        : "the block open in the main view",
    };
  } catch (e) {
    console.warn("[targetScope] could not read the main view:", e);
    return null;
  }
}

/** Root uids currently displayed in the right sidebar. */
export function getSidebarRootUids(): string[] {
  try {
    const windows =
      (window as any).roamAlphaAPI?.ui?.rightSidebar?.getWindows?.() || [];
    const uids: string[] = [];
    for (const w of windows) {
      const uid =
        w?.type === "block"
          ? w["block-uid"]
          : w?.type === "outline"
            ? w["page-uid"]
            : w?.type === "mentions"
              ? w["page-uid"] || w["mentions-uid"]
              : null;
      if (uid) uids.push(uid);
    }
    return uids;
  } catch (e) {
    console.warn("[targetScope] could not read the sidebar:", e);
    return [];
  }
}

/**
 * All block uids under a root. treeToUidArray only keeps nodes carrying a
 * :block/string, so a page root is skipped while a zoomed block root is kept.
 */
export const blockUidsUnder = (rootUid: string): string[] =>
  treeToUidArray(getTreeByUid(rootUid)) || [];

export interface TargetResolution {
  target: ResolvedTarget;
  uids: string[];
  /** Human-readable, for confirmation dialogs and tool results. */
  description: string;
  /** True when the resolved target is NOT the loaded context. */
  outsideContext: boolean;
}

/** Blocks of ONE source. */
async function resolveSingle(
  target: ChatTarget,
  contextUids: string[],
): Promise<TargetResolution> {
  if (target === "context")
    return {
      target: "context",
      uids: contextUids,
      description: `the ${contextUids.length} block(s) loaded in the chat context`,
      outsideContext: false,
    };

  if (target === "sidebar") {
    const roots = getSidebarRootUids();
    // blockUidsUnder keeps a zoomed-block root but skips a page root, so the
    // roots must NOT be prepended: a page uid is not a block.
    const uids = [...new Set(roots.flatMap((uid) => blockUidsUnder(uid)))];
    console.log(`[target] resolved "sidebar" -> ${roots.length} window(s), ${uids.length} block(s)`);
    return {
      target: "sidebar",
      uids,
      description: "the right sidebar",
      outsideContext: true,
    };
  }

  const root = await getMainViewRootUid();
  const uids = root ? blockUidsUnder(root.uid) : [];
  console.log(
    `[target] resolved "main_view" -> root=${root?.uid ?? "none"} (${root?.description ?? "?"}), ${uids.length} block(s)`,
  );
  return {
    target: "main_view",
    uids,
    description: root ? root.description : "the main view",
    outsideContext: true,
  };
}

/**
 * Union of every selected source.
 *
 * An empty selection is NOT an error state: it falls back to the loaded context
 * when there is one, otherwise the main view — so unchecking everything degrades
 * to something sensible instead of dead-ending every action.
 */
export async function resolveTargets(
  targets: ChatTarget[],
  contextUids: string[],
): Promise<TargetResolution> {
  const effective: ChatTarget[] = targets.length
    ? targets
    : contextUids.length
      ? ["context"]
      : ["main_view"];

  const parts: TargetResolution[] = [];
  for (const t of effective) parts.push(await resolveSingle(t, contextUids));

  const uids = [...new Set(parts.flatMap((p) => p.uids))];
  return {
    target: parts[0].target,
    uids,
    description: parts.map((p) => p.description).join(" and "),
    outsideContext: parts.some((p) => p.outsideContext),
  };
}

/** Back-compat single-target resolution, used where only one source applies. */
export const resolveTarget = (target: ChatTarget, contextUids: string[]) =>
  resolveSingle(target, contextUids);

// ===========================================================================
// Read context — selected sources also feed what the agent READS
// ===========================================================================

export interface ReadContextBlock {
  uid: string;
  text: string;
  pageTitle: string;
  pageUid: string;
}

/** Walk a pulled tree once, collecting uid + string (skips string-less roots). */
function flattenTree(node: any, out: { uid: string; text: string }[]): void {
  if (!node) return;
  if (node.uid && node.string) out.push({ uid: node.uid, text: node.string });
  const children = node.children;
  if (Array.isArray(children)) {
    [...children]
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .forEach((c) => flattenTree(c, out));
  }
}

function blocksUnderRoot(rootUid: string): ReadContextBlock[] {
  const tree = getTreeByUid(rootUid);
  const root = Array.isArray(tree) ? tree[0] : tree;
  const flat: { uid: string; text: string }[] = [];
  flattenTree(root, flat);

  const pageUid = getPageNameByPageUid(rootUid)
    ? rootUid
    : getPageUidByBlockUid(rootUid) || rootUid;
  const pageTitle = getPageNameByPageUid(pageUid) || "";

  return flat.map((b) => ({ ...b, pageTitle, pageUid }));
}

/**
 * Every uid already covered by the loaded context — the results themselves AND
 * their descendants.
 *
 * The descendants matter: a context result is serialised with a
 * `childrenOutline`, so its whole subtree is already in the prompt even though
 * only the root uid appears in the results array. Without this, a page loaded
 * in the context and also open in the sidebar would be sent twice in full.
 *
 * One Datalog query for all roots, rather than one per result.
 */
function expandCoveredUids(rootUids: string[]): Set<string> {
  const covered = new Set(rootUids);
  if (!rootUids.length) return covered;
  try {
    // :block/parents holds every ancestor, the page entity included, so this
    // covers descendants of page results as well as of block results.
    const rows =
      (window as any).roamAlphaAPI.q(
        `[:find ?uid
          :in $ [?root-uid ...]
          :where
          [?root :block/uid ?root-uid]
          [?b :block/parents ?root]
          [?b :block/uid ?uid]]`,
        rootUids,
      ) || [];
    for (const [uid] of rows) covered.add(uid);
  } catch (e) {
    console.warn("[targetScope] could not expand the loaded context:", e);
  }
  return covered;
}

/**
 * Content of the selected sources, to be appended to the agent's read context.
 *
 * "context" is skipped: those blocks are already the chat context. Anything
 * already covered by the context — or already collected from another source —
 * is skipped too, so nothing is sent twice.
 */
export async function loadTargetReadContext(
  targets: ChatTarget[],
  alreadyLoadedUids: string[],
): Promise<ReadContextBlock[]> {
  const wanted = targets.filter((t) => t !== "context");
  if (!wanted.length) return [];

  const seen = expandCoveredUids(alreadyLoadedUids);
  const skippedPerSource: Record<string, number> = {};
  const out: ReadContextBlock[] = [];

  for (const target of wanted) {
    const roots: string[] = [];
    if (target === "main_view") {
      const root = await getMainViewRootUid();
      if (root) roots.push(root.uid);
    } else {
      roots.push(...getSidebarRootUids());
    }
    let skipped = 0;
    for (const rootUid of roots) {
      for (const b of blocksUnderRoot(rootUid)) {
        if (seen.has(b.uid)) {
          skipped++;
          continue;
        }
        seen.add(b.uid);
        out.push(b);
      }
    }
    if (skipped) skippedPerSource[target] = skipped;
  }

  const dupNote = Object.keys(skippedPerSource).length
    ? ` (skipped as already present: ${Object.entries(skippedPerSource)
        .map(([t, n]) => `${t} ${n}`)
        .join(", ")})`
    : "";
  console.log(
    `[target] read context from [${wanted.join(", ")}] -> ${out.length} extra block(s)${dupNote}`,
  );
  return out;
}

/**
 * Ask the user, ONCE per session, before a tool acts outside the loaded
 * context. Returns a message to hand back to the model when refused, or null
 * when the tool may proceed.
 *
 * Picking a target explicitly in the Target selector already counts as
 * authorisation, so callers only invoke this while the selector is on "auto".
 */
export async function confirmOutsideContext(
  config: any,
  description: string,
): Promise<string | null> {
  const approvedRef = config?.configurable?.outsideContextApprovedRef as
    | { current: boolean }
    | undefined;
  if (approvedRef?.current) return null;

  const toolConfirmationCallback = config?.configurable?.toolConfirmationCallback;
  // No confirmation channel available: proceed rather than dead-end the user.
  if (!toolConfirmationCallback) return null;

  const result = await toolConfirmationCallback({
    toolName: "target_outside_context",
    toolCallId: `target_outside_context_${Date.now()}`,
    args: {
      operation: "act outside the loaded context",
      target: description,
      note: `Nothing is loaded in this chat's context, so the agent would act on ${description}. Approving allows it for the rest of this chat session; you can also pin a target with the Target button next to the input.`,
    },
  });

  if (!result?.approved) {
    const reason = result?.declineReason
      ? ` User's feedback: "${result.declineReason}"`
      : "";
    return `⚠️ The user declined to act on ${description}.${reason}\n\nAsk them which page or blocks to work on, or suggest adding the content to the chat context.`;
  }

  if (approvedRef) approvedRef.current = true;
  return null;
}


// ===========================================================================
// Following references and embeds
// ===========================================================================

/** Depth of reference-following. 2 covers a ref pointing at a block that
 *  itself embeds something, without risking runaway traversal on cyclic refs. */
const MAX_REF_DEPTH = 2;

/**
 * Extend a set of candidate blocks with whatever their references and embeds
 * point at — the content a Roam user actually SEES in those blocks.
 *
 * Cycles are safe: a uid is never visited twice.
 */
export function expandWithReferences(
  uids: string[],
  maxDepth: number = MAX_REF_DEPTH,
): string[] {
  const seen = new Set(uids);
  let frontier = uids;

  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const uid of frontier) {
      const content = getBlockContentByUid(uid);
      if (!content) continue;

      for (const ref of extractReferencedUids(content)) {
        if (seen.has(ref) || !isExistingBlock(ref)) continue;
        seen.add(ref);
        next.push(ref);
      }

      // {{[[embed]]: [[Page]]}} pulls in the whole page
      for (const title of extractEmbeddedPageTitles(content)) {
        const pageUid = getPageUidByPageName(title);
        if (!pageUid) continue;
        for (const b of blockUidsUnder(pageUid)) {
          if (seen.has(b)) continue;
          seen.add(b);
          next.push(b);
        }
      }
    }
    frontier = next;
  }

  const out = [...seen];
  if (out.length !== uids.length) {
    console.log(
      `[target] following refs/embeds: ${uids.length} -> ${out.length} block(s)`,
    );
  }
  return out;
}
