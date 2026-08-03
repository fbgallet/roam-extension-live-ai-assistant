const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getEnhancedTableModel,
  updateTableCell,
} = require("../src/utils/roamGridBridge.cjs");

test("enhanced tables are read through Roam Grid with raw UID-backed cells", () => {
  const apiRoot = {
    roamGrid: {
      v1: {
        getTableModel: (uid) => {
          assert.equal(uid, "table-uid");
          return {
            columnIds: ["a", "b"],
            rows: [[{ uid: "cell-1", raw: "((source))" }, { uid: "cell-2", raw: "" }]],
          };
        },
      },
    },
  };

  const model = getEnhancedTableModel(
    "table-uid",
    (raw) => (raw === "((source))" ? "Resolved source" : raw),
    apiRoot
  );

  assert.equal(model.roamGrid, true);
  assert.equal(model.colCount, 2);
  assert.deepEqual(model.rows[0][0], {
    uid: "cell-1",
    content: "((source))",
    display: "Resolved source",
  });
});

test("missing, unenhanced, and failed Grid reads return null for native fallback", () => {
  assert.equal(getEnhancedTableModel("table-uid", String, {}), null);
  assert.equal(
    getEnhancedTableModel("table-uid", String, {
      roamGrid: { v1: { getTableModel: () => ({ rows: [] }) } },
    }),
    null
  );
  const previousWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(
      getEnhancedTableModel("table-uid", String, {
        roamGrid: { v1: { getTableModel: () => { throw new Error("reload"); } } },
      }),
      null
    );
  } finally {
    console.warn = previousWarn;
  }
});

test("enhanced completion writes use one transactional Grid patch", async () => {
  const calls = [];
  const apiRoot = {
    roamGrid: {
      v1: {
        applyPatch: async (...args) => calls.push(args),
      },
    },
    roamAlphaAPI: { updateBlock: () => assert.fail("native writer called") },
  };

  await updateTableCell({
    tableBlockUid: "table-uid",
    coordinate: { row: 3, col: 4 },
    uid: "cell-uid",
    value: "Paris",
    roamGrid: true,
    apiRoot,
  });

  assert.deepEqual(calls, [["table-uid", { op: "set", row: 3, col: 4, value: "Paris" }]]);
});

test("native tables retain direct block updates", async () => {
  const calls = [];
  const apiRoot = {
    roamAlphaAPI: {
      updateBlock: async (update) => calls.push(update),
    },
  };

  await updateTableCell({
    tableBlockUid: "table-uid",
    coordinate: { row: 0, col: 0 },
    uid: "cell-uid",
    value: "Native value",
    roamGrid: false,
    apiRoot,
  });

  assert.deepEqual(calls, [{ block: { uid: "cell-uid", string: "Native value" } }]);
});

test("Grid disappearance during streaming falls back to the native writer", async () => {
  const calls = [];
  const apiRoot = {
    roamAlphaAPI: { updateBlock: async (update) => calls.push(update) },
  };

  await updateTableCell({
    tableBlockUid: "table-uid",
    coordinate: { row: 1, col: 2 },
    uid: "cell-uid",
    value: "Recovered",
    roamGrid: true,
    apiRoot,
  });

  assert.equal(calls[0].block.string, "Recovered");
});
