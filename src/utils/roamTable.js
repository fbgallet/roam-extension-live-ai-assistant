import {
  getTreeByUid,
  createChildBlock,
  getBlockOrderByUid,
  resolveReferences,
} from "./roamAPI";
const { getEnhancedTableModel } = require("./roamGridBridge.cjs");

// A Roam table is a block whose string is `{{[[table]]}}`. Its children encode the
// grid: each direct child (sorted by :block/order) is a ROW, and within a row the
// columns are nested one level deeper each (col 0 = the row block itself, col 1 = its
// first child, col 2 = grandchild, ...). See `roamTableFormat` in src/ai/prompts.js.

export const TABLE_MARKER_REGEX = /\{\{(\[\[)?table(\]\])?\}\}/i;

// A cell is "fillable" when it is empty or holds a single bracketed instruction like
// [city] or [a short bio of this author]. We deliberately do NOT match [[page refs]]
// (double brackets) or [markdown](links) so real content is never overwritten.
export const PLACEHOLDER_REGEX = /^\[([^\[\]]+)\]$/;

const sortByOrder = (arr) =>
  [...(arr || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

export function isBlankCellContent(content) {
  return !content || !content.trim();
}

/**
 * If the cell content is a single bracketed instruction, return the inner text
 * (e.g. "[city]" -> "city"); otherwise return null.
 */
export function getPlaceholderInstruction(content) {
  const match = (content || "").trim().match(PLACEHOLDER_REGEX);
  return match ? match[1].trim() : null;
}

export function isFillableCell(content) {
  return (
    isBlankCellContent(content) || getPlaceholderInstruction(content) !== null
  );
}

/**
 * Walk the single-child column chain of a row block, returning the ordered list of
 * cells [{ uid, content }] from the first column to the last existing one.
 */
function getColumnChain(rowBlock) {
  const chain = [];
  let current = rowBlock;
  while (current) {
    const raw = current.string ?? "";
    // `content` is the raw string (used for uid + blank/placeholder detection);
    // `display` resolves ((block refs)) to their text for the LLM prompt.
    chain.push({ uid: current.uid, content: raw, display: resolveReferences(raw) });
    const children = sortByOrder(current.children);
    current = children.length ? children[0] : null;
  }
  return chain;
}

/**
 * Build a 2D model of a Roam table from its `{{[[table]]}}` block uid.
 * Returns { tableUid, rows, colCount } where rows[0] is the header row and each cell
 * is { uid, content }. Returns null if the block can't be read.
 */
export function getTableModel(tableBlockUid) {
  // Roam Grid keeps enhanced native tables backed by these same block UIDs, but
  // its public model is already normalized and includes cells that may be
  // temporarily virtualized out of the DOM. Prefer that model when available;
  // fall back to the native outline reader when Roam Grid is absent or the table
  // has not opted in.
  const enhanced = getEnhancedTableModel(tableBlockUid, resolveReferences);
  if (enhanced) return enhanced;
  const root = getTreeByUid(tableBlockUid)?.[0];
  if (!root) return null;
  const rowBlocks = sortByOrder(root.children);
  const rows = rowBlocks.map((rowBlock) => getColumnChain(rowBlock));
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return { tableUid: tableBlockUid, rows, colCount };
}

/**
 * Ensure a row's column chain reaches `targetColCount` cells, creating missing cells
 * as empty blocks (a single space, per the Roam table convention that empty cells must
 * still exist). Returns the (possibly extended) array of cells; newly created cells are
 * flagged with `created: true`.
 */
export async function ensureRowColumns(rowCells, targetColCount) {
  const cells = [...rowCells];
  while (cells.length < targetColCount) {
    const parentUid = cells[cells.length - 1].uid;
    const uid = await createChildBlock(parentUid, " ");
    cells.push({ uid, content: " ", display: " ", created: true });
  }
  return cells;
}

/**
 * Insert `count` new empty rows immediately below `anchorRowUid` (the "Insert below"
 * equivalent). Each new row is a full column chain of empty (" ") cells, `colCount`
 * wide. Returns an array of rows, each row being an array of { uid, content, created }
 * cells (col 0 first).
 */
export async function insertEmptyRowsBelow(tableUid, anchorRowUid, count, colCount) {
  const base = getBlockOrderByUid(anchorRowUid);
  const newRows = [];
  for (let i = 1; i <= count; i++) {
    const order = typeof base === "number" ? base + i : "last";
    const rowUid = await createChildBlock(tableUid, " ", order);
    const cells = [{ uid: rowUid, content: " ", display: " ", created: true }];
    let previousUid = rowUid;
    for (let col = 1; col < colCount; col++) {
      const cellUid = await createChildBlock(previousUid, " ");
      cells.push({ uid: cellUid, content: " ", display: " ", created: true });
      previousUid = cellUid;
    }
    newRows.push(cells);
  }
  return newRows;
}

/**
 * Append `count` new empty columns to the right of the table: for every row (header
 * included), extend its column chain by `count` empty (" ") cells. Rows shorter than
 * `existingColCount` are first padded to that width. Returns { newColumns, cleanupUids }
 * where newColumns[j] is the array of new cells (one per row, header first) for the j-th
 * added column, and cleanupUids are the first appended cell of each row (deleting them
 * removes the whole appended chain, used to roll back on failure).
 */
export async function insertEmptyColumnsRight(model, count, existingColCount) {
  const existing = existingColCount ?? model.colCount;
  const appendedPerRow = [];
  for (let r = 0; r < model.rows.length; r++) {
    let cells = model.rows[r];
    if (cells.length < existing) {
      cells = await ensureRowColumns(cells, existing);
      model.rows[r] = cells;
    }
    let previousUid = cells[cells.length - 1].uid;
    const appended = [];
    for (let j = 0; j < count; j++) {
      const uid = await createChildBlock(previousUid, " ");
      appended.push({ uid, rowIndex: r, colIndex: existing + j });
      previousUid = uid;
    }
    appendedPerRow.push(appended);
  }
  const newColumns = [];
  for (let j = 0; j < count; j++) {
    newColumns.push(appendedPerRow.map((row) => row[j]));
  }
  const cleanupUids = appendedPerRow.map((row) => row[0].uid);
  return { newColumns, cleanupUids };
}

/**
 * Render the whole table as readable text for LLM context: one row per line, columns
 * separated by " | ", empty cells shown as ∅.
 */
export function renderTableAsText(model) {
  if (!model || !model.rows.length) return "";
  return model.rows
    .map((row) =>
      row
        .map((cell) =>
          isBlankCellContent(cell.content)
            ? "∅"
            : (cell.display ?? cell.content).trim()
        )
        .join(" | ")
    )
    .join("\n");
}
