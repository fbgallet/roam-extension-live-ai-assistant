// Pure logic of the inline chat "auto mode" (no Roam / DOM access, so it can be
// unit-tested). Everything that reads the graph goes through injected `deps`.
//
// Conversation layout in blocks:
//   root block (initial prompt)
//     ├─ AI assistant: ...   (assistant turn)
//     ├─ Me: ...             (user turn, may have children completing the prompt)
//     └─ ...

const MODIFIER_KEYS = ["Shift", "Control", "Alt", "Meta", "CapsLock"];

const isUserTurn = (content, userPrefix) => {
  const prefix = (userPrefix || "").trim();
  return !!prefix && (content || "").trimStart().startsWith(prefix);
};

// True when the user turn contains something beyond its "Me:" prefix
const hasPromptText = (content, userPrefix) =>
  (content || "").trim().length > (userPrefix || "").trim().length;

// Enter pressed (alone) at the very end of a non-empty block being edited
const isEnterAtEnd = ({
  key,
  shiftKey,
  ctrlKey,
  metaKey,
  altKey,
  isComposing,
  value,
  selectionStart,
  selectionEnd,
}) =>
  key === "Enter" &&
  !shiftKey &&
  !ctrlKey &&
  !metaKey &&
  !altKey &&
  !isComposing &&
  !!value &&
  value.trim().length > 0 &&
  selectionStart === value.length &&
  selectionEnd === value.length;

// [[ or (( not closed yet: Enter would pick an autocomplete suggestion
const hasOpenReference = (value) => /\[\[[^\]]*$|\(\([^)]*$/.test(value || "");

// deps: { getContent(uid), getParent(uid), isPage(uid) }
// Walks up from the edited block to the user turn it belongs to (the block
// itself or one of its descendants). Returns null when the block is not part
// of a user turn, e.g. it belongs to an assistant turn.
const findUserTurn = (uid, deps, userPrefix, isAssistantContent) => {
  let current = uid;
  for (let depth = 0; current && depth < 12; depth++) {
    const content = deps.getContent(current);
    if (isAssistantContent(content)) return null;
    const parent = deps.getParent(current);
    if (!parent) return null;
    if (isUserTurn(content, userPrefix))
      return deps.isPage(parent) ? null : { turnUid: current, rootUid: parent };
    current = parent;
  }
  return null;
};

// Only the last turn of a conversation can be answered: the conversation is
// rebuilt from the children of the root, the last one being the target block.
// deps: { getChildrenUids(uid) }
const isLastTurn = ({ turnUid, rootUid }, deps) => {
  const children = deps.getChildrenUids(rootUid);
  return children.length > 0 && children[children.length - 1] === turnUid;
};

// What to do with the key pressed while the hint is displayed
const getKeyAction = ({ key, shiftKey, ctrlKey, metaKey, altKey }) => {
  if (MODIFIER_KEYS.includes(key)) return "ignore";
  if (ctrlKey || metaKey || altKey) return "dismiss";
  if (key === " ") return "reply";
  if (key === "Tab" && !shiftKey) return "indent";
  if (key === "Enter" && !shiftKey) return "outdent";
  return "dismiss";
};

// Keys available on the empty user turn created after the first AI response
const getFirstTurnKeyAction = ({ key, shiftKey, ctrlKey, metaKey, altKey }) => {
  if (MODIFIER_KEYS.includes(key)) return "ignore";
  if (ctrlKey || metaKey || altKey) return "dismiss";
  if (shiftKey && key === "Escape") return "discard";
  if (shiftKey && key === "Enter") return "regenerate";
  return "dismiss";
};

// Where the (empty) block has to be moved to become the assistant turn: right
// after the user turn, at the root level. null if it is already there.
// deps: { getParent(uid), getOrder(uid) }
const planReplyPosition = ({ turnUid, rootUid, emptyUid }, deps) => {
  const order = deps.getOrder(turnUid) + 1;
  if (deps.getParent(emptyUid) === rootUid && deps.getOrder(emptyUid) === order)
    return null;
  return { parentUid: rootUid, order };
};

// Move the empty block one level up, just after its parent (leave the
// conversation, or the user turn's children). null at the top of a page.
const planOutdent = (emptyUid, deps) => {
  const parent = deps.getParent(emptyUid);
  if (!parent || deps.isPage(parent)) return null;
  const grandParent = deps.getParent(parent);
  if (!grandParent) return null;
  return { parentUid: grandParent, order: deps.getOrder(parent) + 1 };
};

module.exports = {
  isUserTurn,
  hasPromptText,
  isEnterAtEnd,
  hasOpenReference,
  findUserTurn,
  isLastTurn,
  getKeyAction,
  getFirstTurnKeyAction,
  planReplyPosition,
  planOutdent,
};
