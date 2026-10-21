import { AppToaster } from "../components/Toaster";
import { insertCompletion } from "../ai/responseInsertion.js";
import { llmConversationSystemPrompt } from "../ai/prompts.js";
import { isPromptInConversation } from "../ai/dataExtraction.js";
import {
  addToConversationHistory,
  chatRoles,
  defaultStyle,
  getConversationParamsFromHistory,
  getInstantAssistantRole,
  inlineChatAutoMode,
  inlineChatDisplay,
} from "../index.js";
import { getActiveModel } from "./activeModel";
import ReactDOM from "react-dom";
import { simulateClick } from "./domElts";
import {
  createChildBlock,
  deleteBlock,
  focusOnBlockInMainWindow,
  focusOnBlockInSidebar,
  foldBlockInMainWindow,
  getBlockContentByUid,
  getBlockOrderByUid,
  getChildrenUids,
  getPageNameByPageUid,
  getParentBlock,
  getSidebarWindowOfBlock,
  isExistingBlock,
  showConversationInSidebar,
  updateBlock,
} from "./roamAPI.js";

const {
  hasPromptText,
  isEnterAtEnd,
  hasOpenReference,
  findUserTurn,
  isLastTurn,
  getKeyAction,
  getFirstTurnKeyAction,
  planReplyPosition,
  planOutdent,
} = require("./inlineChatAuto.cjs");

const HINT_TIMEOUT = 10000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const graphDeps = {
  getContent: (uid) => getBlockContentByUid(uid) || "",
  getParent: getParentBlock,
  isPage: (uid) => !!getPageNameByPageUid(uid),
  getChildrenUids,
  getOrder: getBlockOrderByUid,
};

const isAssistantContent = (content) =>
  !!chatRoles.genericAssistantRegex?.test(content || "");

const isBlockTextarea = (elt) =>
  elt instanceof HTMLTextAreaElement && elt.classList.contains("rm-block-input");

// Roam block uids are 9 characters long, the textarea id ends with the uid
const getUidFromTextarea = (textarea) => textarea.id.slice(-9);

const getFocusedWindowId = () =>
  window.roamAlphaAPI.ui.getFocusedBlock()?.["window-id"] || "main-window";

const focusBlock = (uid, rootUid, windowId) => {
  if (windowId)
    window.roamAlphaAPI.ui.setBlockFocusAndSelection({
      location: { "block-uid": uid, "window-id": windowId },
    });
  else if (!getSidebarWindowOfBlock(rootUid) || !focusOnBlockInSidebar(uid, rootUid))
    focusOnBlockInMainWindow(uid);
};

// Focus with the cursor at the end of the block
const focusBlockAtEnd = (uid, rootUid) => {
  const length = (getBlockContentByUid(uid) || "").length;
  window.roamAlphaAPI.ui.setBlockFocusAndSelection({
    location: {
      "block-uid": uid,
      "window-id":
        getSidebarWindowOfBlock(rootUid)?.["window-id"] || "main-window",
    },
    selection: { start: length, end: length },
  });
};

/**
 * The AI answers the user turn: its response becomes the last child of the
 * conversation root, right after the turn.
 * - emptyUid: an already existing empty block to turn into the assistant
 *   turn (moved after the user turn if needed), otherwise a block is created.
 */
export async function replyToTurn({ turnUid, rootUid, emptyUid }) {
  const model = getActiveModel();
  // leave the edition mode, so that the text being typed is saved
  simulateClick();
  await sleep(100);

  const role = getInstantAssistantRole(model);
  let targetUid = emptyUid;
  if (targetUid) {
    const position = planReplyPosition(
      { turnUid, rootUid, emptyUid },
      graphDeps
    );
    if (position)
      await window.roamAlphaAPI.moveBlock({
        location: {
          "parent-uid": position.parentUid,
          order: position.order,
        },
        block: { uid: targetUid },
      });
    await updateBlock({ blockUid: targetUid, newContent: role });
  } else {
    targetUid = await createChildBlock(
      rootUid,
      role,
      getBlockOrderByUid(turnUid) + 1
    );
  }

  if (!getConversationParamsFromHistory(rootUid))
    await addToConversationHistory({ uid: rootUid });
  const convParams = getConversationParamsFromHistory(rootUid);

  // after the blocks have been moved / created (Roam may have re-rendered
  // them), remove the buttons of the previous turns, user turn included
  clearInstantButtons(rootUid);
  if (inlineChatDisplay === "right sidebar")
    await showConversationInSidebar(rootUid, targetUid);

  insertCompletion({
    prompt: "", // rebuilt from the conversation blocks
    systemPrompt: llmConversationSystemPrompt,
    targetUid,
    roamContext: convParams?.context,
    style: convParams?.style || defaultStyle,
    isInConversation: true,
    target: "new",
  });
}

// The buttons (regenerate, copy, chat...) of the previous turns are obsolete
// as soon as the conversation goes on
const clearInstantButtons = (rootUid) => {
  const turnUids = new Set(getChildrenUids(rootUid));
  document
    .querySelectorAll(".liveai-instant-btn-container")
    .forEach((container) => {
      const blockMain = container.closest(".rm-block-main");
      const blockId = blockMain?.querySelector(".roam-block")?.id;
      if (!blockId || !turnUids.has(blockId.slice(-9))) return;
      ReactDOM.unmountComponentAtNode(container);
      container.remove();
      const block = blockMain.closest(".rm-block");
      if (block) delete block.dataset.hasInstantBtn;
    });
};

// The user is still where the conversation is (or nowhere), not busy elsewhere
const isFocusInConversation = (rootUid) => {
  let uid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
  if (!uid) return true;
  for (let depth = 0; uid && depth < 8; depth++) {
    if (uid === rootUid) return true;
    uid = getParentBlock(uid);
  }
  return false;
};

// A user turn left with nothing but its role is removed when the user leaves
// it (Escape, click elsewhere...), so that it doesn't litter the page
const removeTurnIfLeftBare = (uid) => {
  const stopWatching = () => {
    document.removeEventListener("focusout", onFocusOut, true);
    clearTimeout(fallbackId);
  };
  const onFocusOut = (e) => {
    if (!isBlockTextarea(e.target) || getUidFromTextarea(e.target) !== uid)
      return;
    stopWatching();
    setTimeout(() => {
      const focusedUid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
      if (
        focusedUid !== uid &&
        isExistingBlock(uid) &&
        (getBlockContentByUid(uid) || "").trim() ===
          (chatRoles.user || "").trim()
      )
        deleteBlock(uid);
    }, 300);
  };
  const fallbackId = setTimeout(stopWatching, 60000);
  document.addEventListener("focusout", onFocusOut, true);
};

// Shift+Esc / Shift+Enter on the empty turn following the first response:
// delete that response (and the empty turn), or generate it again
const removeFirstResponse = async ({
  rootUid,
  assistantUid,
  bareTurnUid,
  generation,
}) => {
  const children = getChildrenUids(rootUid);
  const previousUid = children[children.indexOf(assistantUid) - 1];
  simulateClick();
  await sleep(100);
  if (isExistingBlock(bareTurnUid)) await deleteBlock(bareTurnUid);
  if (isExistingBlock(assistantUid)) await deleteBlock(assistantUid);
  if (generation) {
    const targetUid = await createChildBlock(
      rootUid,
      getInstantAssistantRole(generation.instantModel || getActiveModel())
    );
    insertCompletion({
      ...generation,
      targetUid,
      target: "new",
      withAssistantRole: true,
      // the query results are already part of the context
      includeQueryInContext: false,
    });
  } else {
    // back to the prompt: the block before the response, or the conversation
    // root itself when the response was its first child
    await sleep(100);
    focusBlockAtEnd(previousUid || rootUid, rootUid);
  }
};

/**
 * With the "right sidebar" display, the first response of a conversation is
 * generated in the sidebar: it has to be opened when the generation starts,
 * not once it is over. Same conditions as prepareNextUserTurn.
 */
export async function openFirstResponseInSidebar(rootUid, assistantUid) {
  if (
    !inlineChatAutoMode ||
    inlineChatDisplay !== "right sidebar" ||
    !rootUid ||
    graphDeps.isPage(rootUid) ||
    getChildrenUids(rootUid).at(-1) !== assistantUid ||
    !isFocusInConversation(rootUid)
  )
    return;
  await showConversationInSidebar(rootUid, assistantUid);
}

/**
 * Auto mode, after an AI response: the next user turn ("Me: ") is created
 * and focused, so the conversation can go on without clicking on anything.
 * - The response has to be the last turn (it isn't when it was regenerated or
 *   when the user has already written the next turn).
 * - Nothing is done if the user has moved on to another block meanwhile.
 * - firstTurn: the response is the first one of a conversation that starts
 *   now: { history: params recorded in the conversations history,
 *   generation: params to generate this response again }.
 */
export async function prepareNextUserTurn(rootUid, assistantUid, firstTurn) {
  if (!inlineChatAutoMode || !rootUid || graphDeps.isPage(rootUid)) return;
  // the user chose to continue conversations in the chat panel, not in blocks
  if (inlineChatDisplay === "chat panel") return;
  const children = getChildrenUids(rootUid);
  if (assistantUid && children[children.length - 1] !== assistantUid) return;
  if (!isFocusInConversation(rootUid)) return;

  if (firstTurn) await addToConversationHistory({ uid: rootUid, ...firstTurn.history });
  const nextUid = await createChildBlock(rootUid, chatRoles.user || "");
  if (inlineChatDisplay === "right sidebar") {
    await showConversationInSidebar(rootUid, nextUid, false);
    await sleep(300);
    // fold the conversation in the main window just before the focus
    await foldBlockInMainWindow(rootUid);
  } else await sleep(300);
  focusBlock(nextUid, rootUid);
  removeTurnIfLeftBare(nextUid);

  if (firstTurn) {
    await sleep(100);
    const textarea = document.activeElement;
    if (isBlockTextarea(textarea) && getUidFromTextarea(textarea) === nextUid)
      displayHint(textarea, FIRST_TURN_HINT, {
        getAction: getFirstTurnKeyAction,
        timeout: 30000,
        onAction: (action) =>
          removeFirstResponse({
            rootUid,
            assistantUid,
            bareTurnUid: nextUid,
            generation: action === "regenerate" ? firstTurn.generation : null,
          }),
      });
  }
}

// Command palette: answer the user turn the cursor is in, or, when the cursor
// is in an AI response, start the next user turn
export async function continueConversationFromFocus() {
  const focusedUid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
  const warn = (message) =>
    AppToaster.show({ message, intent: "warning", timeout: 5000 });
  if (!focusedUid)
    return warn("Place the cursor in one of your turns of the conversation.");

  const textarea = document.activeElement;
  const liveContent = (uid) =>
    isBlockTextarea(textarea) && getUidFromTextarea(textarea) === uid
      ? textarea.value
      : graphDeps.getContent(uid);

  if (isAssistantContent(liveContent(focusedUid))) {
    const rootUid = getParentBlock(focusedUid);
    const children = getChildrenUids(rootUid);
    if (!rootUid || graphDeps.isPage(rootUid) || children.at(-1) !== focusedUid)
      return warn("Only the last response of a conversation can be continued.");
    const nextUid = await createChildBlock(rootUid, chatRoles.user || "");
    if (inlineChatDisplay === "right sidebar") {
      await showConversationInSidebar(rootUid, nextUid, false);
      await sleep(300);
      await foldBlockInMainWindow(rootUid);
    } else await sleep(300);
    focusBlock(nextUid, rootUid);
    return;
  }

  const deps = { ...graphDeps, getContent: liveContent };
  const turn = findUserTurn(
    focusedUid,
    deps,
    chatRoles.user,
    isAssistantContent
  );
  if (!turn)
    return warn(
      `Place the cursor in one of your turns (starting with "${(
        chatRoles.user || ""
      ).trim()}") of a conversation.`
    );
  if (!hasPromptText(deps.getContent(turn.turnUid), chatRoles.user))
    return warn("Write your message first.");
  if (!isLastTurn(turn, deps))
    return warn("Only the last turn of a conversation can be answered.");
  await replyToTurn(turn);
}

// --- Auto mode: hint displayed after Enter at the end of a user turn ---

let hint = null;

const FIRST_TURN_HINT =
  "Type your reply &nbsp;·&nbsp; <kbd>Shift</kbd>+<kbd>Enter</kbd> Regenerate &nbsp;·&nbsp; <kbd>Shift</kbd>+<kbd>Esc</kbd> Delete this response &nbsp;·&nbsp; <kbd>Esc</kbd> Dismiss";

const REPLY_HINT =
  "<kbd>Space</kbd> AI reply &nbsp;·&nbsp; <kbd>Tab</kbd> Complete your prompt &nbsp;·&nbsp; <kbd>Enter</kbd> Leave the conversation &nbsp;·&nbsp; other key: keep writing";

const dismissHint = () => {
  if (!hint) return;
  clearTimeout(hint.timeoutId);
  document.removeEventListener("keydown", hint.onKeyDown, true);
  document.removeEventListener("mousedown", dismissHint, true);
  hint.element.remove();
  hint = null;
};

const PASS_THROUGH_ACTIONS = ["ignore", "dismiss", "indent"];

// onAction(action) is called, and the key is not passed to Roam, for the
// actions that are not in PASS_THROUGH_ACTIONS. Without onAction the hint is
// purely informative.
const displayHint = (
  textarea,
  html,
  { onAction, getAction = getKeyAction, timeout = HINT_TIMEOUT } = {}
) => {
  dismissHint();
  const element = document.createElement("div");
  element.className = "liveai-autochat-hint";
  element.innerHTML = html;
  const rect = textarea.getBoundingClientRect();
  Object.assign(element.style, {
    position: "fixed",
    zIndex: 9999,
    top: `${rect.bottom + 4}px`,
    left: `${Math.max(rect.left, 8)}px`,
    padding: "4px 10px",
    borderRadius: "4px",
    fontSize: "12px",
    background: "#394b59",
    color: "#f5f8fa",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    pointerEvents: "none",
  });
  element.querySelectorAll("kbd").forEach((kbd) =>
    Object.assign(kbd.style, {
      padding: "0 4px",
      borderRadius: "3px",
      background: "rgba(255,255,255,0.2)",
      fontFamily: "inherit",
      fontWeight: "bold",
    })
  );
  document.body.appendChild(element);

  const onKeyDown = (e) => {
    const action = getAction(e);
    if (action === "ignore") return;
    dismissHint();
    // Tab and any other key keep their usual effect in Roam
    if (onAction && !PASS_THROUGH_ACTIONS.includes(action)) {
      e.preventDefault();
      e.stopPropagation();
      onAction(action);
    }
  };
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("mousedown", dismissHint, true);
  hint = {
    element,
    onKeyDown,
    timeoutId: setTimeout(dismissHint, timeout),
  };
};

// Roam creates the next block asynchronously: wait for it to take the focus
const waitForNewEmptyBlock = async (previousUid) => {
  for (let i = 0; i < 20; i++) {
    await sleep(30);
    const textarea = document.activeElement;
    if (
      isBlockTextarea(textarea) &&
      getUidFromTextarea(textarea) !== previousUid &&
      textarea.value === ""
    )
      return textarea;
  }
  return null;
};

const onEnterKeyDown = async (e) => {
  const textarea = e.target;
  if (!isBlockTextarea(textarea)) return;
  if (
    !isEnterAtEnd({
      key: e.key,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      isComposing: e.isComposing,
      value: textarea.value,
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
    }) ||
    hasOpenReference(textarea.value) ||
    document.querySelector(".rm-autocomplete__results")
  )
    return;

  const uid = getUidFromTextarea(textarea);
  const deps = {
    ...graphDeps,
    getContent: (blockUid) =>
      blockUid === uid ? textarea.value : graphDeps.getContent(blockUid),
  };
  const turn = findUserTurn(uid, deps, chatRoles.user, isAssistantContent);
  if (
    !turn ||
    (turn.turnUid === uid && !hasPromptText(textarea.value, chatRoles.user)) ||
    !isLastTurn(turn, deps) ||
    !isPromptInConversation(turn.turnUid, false)
  )
    return;

  const windowId = getFocusedWindowId();
  // Enter is not prevented: Roam creates the next block as usual
  const newTextarea = await waitForNewEmptyBlock(uid);
  if (!newTextarea) return;
  const emptyUid = getUidFromTextarea(newTextarea);

  displayHint(newTextarea, REPLY_HINT, { onAction: async (action) => {
    if (action === "reply") {
      await replyToTurn({ ...turn, emptyUid });
    } else {
      const position = planOutdent(emptyUid, graphDeps);
      if (!position) return;
      await window.roamAlphaAPI.moveBlock({
        location: {
          "parent-uid": position.parentUid,
          order: position.order,
        },
        block: { uid: emptyUid },
      });
      await sleep(50);
      focusBlock(emptyUid, turn.rootUid, windowId);
    }
  } });
};

export function setInlineChatAutoListener(enabled) {
  document.removeEventListener("keydown", onEnterKeyDown, true);
  dismissHint();
  if (enabled) document.addEventListener("keydown", onEnterKeyDown, true);
}
