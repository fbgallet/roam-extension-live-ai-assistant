const test = require("node:test");
const assert = require("node:assert/strict");
const {
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
} = require("../src/utils/inlineChatAuto.cjs");

const USER = "Me: ";
const isAssistant = (content) => /^AI assistant/.test((content || "").trim());

// Small in-memory graph: { uid: { string, children: [uid...] } }, "page" is a page
const makeGraph = (nodes) => {
  const parents = {};
  Object.entries(nodes).forEach(([uid, node]) =>
    (node.children || []).forEach((child) => (parents[child] = uid))
  );
  return {
    getContent: (uid) => nodes[uid]?.string || "",
    getParent: (uid) => parents[uid] || null,
    isPage: (uid) => uid === "page",
    getChildrenUids: (uid) => nodes[uid]?.children || [],
    getOrder: (uid) =>
      (nodes[parents[uid]]?.children || []).indexOf(uid),
  };
};

// root "X" holds the conversation:  X > [ai1, me1 > [child1 > [grandChild]], empty]
const conversation = () =>
  makeGraph({
    page: { children: ["X"] },
    X: { string: "Initial question", children: ["ai1", "me1", "empty"] },
    ai1: { string: "AI assistant (gpt): answer", children: ["aiChild"] },
    aiChild: { string: "detail of the answer" },
    me1: { string: "Me: my follow-up", children: ["child1"] },
    child1: { string: "more details", children: ["grandChild"] },
    grandChild: { string: "even more" },
    empty: { string: "" },
  });

test("user turns are recognised by their role prefix", () => {
  assert.equal(isUserTurn("Me: hello", USER), true);
  assert.equal(isUserTurn("  Me: hello", USER), true);
  assert.equal(isUserTurn("hello Me: ", USER), false);
  assert.equal(isUserTurn("AI assistant: hi", USER), false);
  assert.equal(isUserTurn("anything", ""), false);
});

test("a bare role prefix is not a prompt", () => {
  assert.equal(hasPromptText("Me: ", USER), false);
  assert.equal(hasPromptText("Me:", USER), false);
  assert.equal(hasPromptText("Me: question", USER), true);
});

test("Enter triggers the hint only alone, at the end of a non-empty block", () => {
  const base = {
    key: "Enter",
    value: "Me: question",
    selectionStart: 12,
    selectionEnd: 12,
  };
  assert.equal(isEnterAtEnd(base), true);
  assert.equal(isEnterAtEnd({ ...base, selectionStart: 5, selectionEnd: 5 }), false);
  assert.equal(isEnterAtEnd({ ...base, selectionStart: 0 }), false);
  assert.equal(isEnterAtEnd({ ...base, shiftKey: true }), false);
  assert.equal(isEnterAtEnd({ ...base, metaKey: true }), false);
  assert.equal(isEnterAtEnd({ ...base, isComposing: true }), false);
  assert.equal(isEnterAtEnd({ ...base, key: "a" }), false);
  assert.equal(isEnterAtEnd({ ...base, value: "  ", selectionStart: 2, selectionEnd: 2 }), false);
});

test("an unclosed [[ or (( means an autocomplete menu is probably open", () => {
  assert.equal(hasOpenReference("Me: see [[Some pa"), true);
  assert.equal(hasOpenReference("Me: see ((abc"), true);
  assert.equal(hasOpenReference("Me: see [[Page]]"), false);
  assert.equal(hasOpenReference("Me: see ((abc))"), false);
});

test("findUserTurn: the user turn itself", () => {
  const deps = conversation();
  assert.deepEqual(findUserTurn("me1", deps, USER, isAssistant), {
    turnUid: "me1",
    rootUid: "X",
  });
});

test("findUserTurn: a child or grand-child of the user turn", () => {
  const deps = conversation();
  assert.deepEqual(findUserTurn("child1", deps, USER, isAssistant), {
    turnUid: "me1",
    rootUid: "X",
  });
  assert.deepEqual(findUserTurn("grandChild", deps, USER, isAssistant), {
    turnUid: "me1",
    rootUid: "X",
  });
});

test("findUserTurn: ignores the assistant's turns and their children", () => {
  const deps = conversation();
  assert.equal(findUserTurn("ai1", deps, USER, isAssistant), null);
  assert.equal(findUserTurn("aiChild", deps, USER, isAssistant), null);
});

test("findUserTurn: ignores blocks outside any user turn", () => {
  const deps = conversation();
  assert.equal(findUserTurn("X", deps, USER, isAssistant), null);
  assert.equal(findUserTurn("empty", deps, USER, isAssistant), null);
});

test("findUserTurn: uses the live text of the edited block", () => {
  const deps = conversation();
  // "empty" is being typed as a new user turn, not saved yet in the graph
  const live = { ...deps, getContent: (uid) => (uid === "empty" ? "Me: new" : deps.getContent(uid)) };
  assert.deepEqual(findUserTurn("empty", live, USER, isAssistant), {
    turnUid: "empty",
    rootUid: "X",
  });
});

test("findUserTurn: a user turn at the top of a page is not a conversation", () => {
  const deps = makeGraph({
    page: { children: ["me"] },
    me: { string: "Me: hello" },
  });
  assert.equal(findUserTurn("me", deps, USER, isAssistant), null);
});

test("isLastTurn: only the last turn of the conversation can be answered", () => {
  const deps = makeGraph({
    page: { children: ["X"] },
    X: { string: "q", children: ["ai1", "me1", "ai2", "me2"] },
  });
  assert.equal(isLastTurn({ turnUid: "me2", rootUid: "X" }, deps), true);
  assert.equal(isLastTurn({ turnUid: "me1", rootUid: "X" }, deps), false);
  assert.equal(isLastTurn({ turnUid: "me1", rootUid: "unknown" }, deps), false);
});

test("hint keys: Space replies, Tab indents, Enter outdents, anything else dismisses", () => {
  assert.equal(getKeyAction({ key: " " }), "reply");
  assert.equal(getKeyAction({ key: "Tab" }), "indent");
  assert.equal(getKeyAction({ key: "Tab", shiftKey: true }), "dismiss");
  assert.equal(getKeyAction({ key: "Enter" }), "outdent");
  assert.equal(getKeyAction({ key: "Enter", shiftKey: true }), "dismiss");
  assert.equal(getKeyAction({ key: "a" }), "dismiss");
  assert.equal(getKeyAction({ key: "Escape" }), "dismiss");
  assert.equal(getKeyAction({ key: "Backspace" }), "dismiss");
  assert.equal(getKeyAction({ key: " ", metaKey: true }), "dismiss");
});

test("hint keys: a lone modifier key does not dismiss the hint", () => {
  ["Shift", "Control", "Alt", "Meta"].forEach((key) =>
    assert.equal(getKeyAction({ key }), "ignore")
  );
});

test("first turn keys: Shift+Esc discards, Shift+Enter regenerates, others dismiss", () => {
  assert.equal(getFirstTurnKeyAction({ key: "Escape", shiftKey: true }), "discard");
  assert.equal(getFirstTurnKeyAction({ key: "Enter", shiftKey: true }), "regenerate");
  // a plain Escape only leaves the empty turn (which is then removed)
  assert.equal(getFirstTurnKeyAction({ key: "Escape" }), "dismiss");
  assert.equal(getFirstTurnKeyAction({ key: "Enter" }), "dismiss");
  assert.equal(getFirstTurnKeyAction({ key: "a" }), "dismiss");
  assert.equal(getFirstTurnKeyAction({ key: "Escape", shiftKey: true, metaKey: true }), "dismiss");
  assert.equal(getFirstTurnKeyAction({ key: "Shift" }), "ignore");
});

test("planReplyPosition: empty sibling right after the turn needs no move", () => {
  const deps = conversation();
  // me1 is at index 1, empty at index 2
  assert.equal(
    planReplyPosition({ turnUid: "me1", rootUid: "X", emptyUid: "empty" }, deps),
    null
  );
});

test("planReplyPosition: an empty block nested in the user turn goes after it", () => {
  const deps = makeGraph({
    page: { children: ["X"] },
    X: { string: "q", children: ["ai1", "me1"] },
    me1: { string: "Me: question", children: ["child1", "emptyChild"] },
    child1: { string: "details" },
    emptyChild: { string: "" },
  });
  assert.deepEqual(
    planReplyPosition({ turnUid: "me1", rootUid: "X", emptyUid: "emptyChild" }, deps),
    { parentUid: "X", order: 2 }
  );
});

test("planOutdent: leaving the user turn's children, then the conversation", () => {
  const deps = makeGraph({
    page: { children: ["X"] },
    X: { string: "q", children: ["ai1", "me1"] },
    me1: { string: "Me: question", children: ["c1"] },
    c1: { string: "details", children: ["emptyGrand"] },
    emptyGrand: { string: "" },
  });
  // emptyGrand (under c1) goes back at the level of c1, right after it
  assert.deepEqual(planOutdent("emptyGrand", deps), { parentUid: "me1", order: 1 });
  // an empty sibling of the user turn leaves the conversation: next to X
  const flat = conversation();
  assert.deepEqual(planOutdent("empty", flat), { parentUid: "page", order: 1 });
});

test("planOutdent: nothing to do at the top of a page", () => {
  const deps = makeGraph({ page: { children: ["top"] }, top: { string: "" } });
  assert.equal(planOutdent("top", deps), null);
});
