import {
  getTableModel,
  ensureRowColumns,
  isFillableCell,
  getPlaceholderInstruction,
  renderTableAsText,
  insertEmptyRowsBelow,
  insertEmptyColumnsRight,
  TABLE_MARKER_REGEX,
} from "../utils/roamTable";
import { getBlockContentByUid, deleteBlock } from "../utils/roamAPI";
import { aiCompletion, getStylePrompt } from "./responseInsertion";
import { getAndNormalizeContext } from "./dataExtraction";
import { showCellSpinners, revealCells } from "../utils/domElts";
import { AppToaster } from "../components/Toaster";
import { extensionStorage } from "..";
import { defaultAssistantCharacter } from "./prompts";
import { hasTrueBooleanKey } from "../utils/dataProcessing";

// The completion streams back one line per cell so we can fill cells progressively.
const LINE_FORMAT_INSTRUCTIONS = `\n\nOUTPUT FORMAT — this is strict. Return ONLY the cells to fill, one per line, each line formatted EXACTLY as:
((uid)): value
where ((uid)) is the 9-character code given for that cell and value is its content on a single line (no line breaks inside a value). Output nothing else: no preamble, no explanation, no JSON, no Roam table, no bullet points. Example:
((abc123xyz)): Paris
((def456uvw)): France`;

const stripUidParens = (uid) => String(uid).replace(/[()]/g, "").trim();
// Matches a streamed "((uid)): value" line.
const CELL_LINE_REGEX = /^\s*\(\(([^)]+)\)\)\s*:?\s*(.*)$/;

// Text to show the LLM for a cell: resolved ((block refs)) via `display`, raw otherwise.
const disp = (cell) => (cell?.display ?? cell?.content ?? "");

const cellHint = (cell) => {
  if (cell.placeholder) return `[instruction: ${cell.placeholder}]`;
  const current = disp(cell).trim();
  if (current) return `(current value: "${current}" — revise/replace it)`;
  return "(currently empty)";
};

const headerLines = (headers, highlightCol) =>
  headers
    .map(
      (h, i) =>
        `${i + 1}. ${disp(h).trim() || "(untitled)"}${
          i === highlightCol ? "  <-- column to complete" : ""
        }`
    )
    .join("\n");

/** Text typed in the same block, after the {{[[table]]}} marker: inline context/instructions. */
function getInlineContext(tableBlockUid) {
  const raw = getBlockContentByUid(tableBlockUid) || "";
  return raw.replace(TABLE_MARKER_REGEX, "").trim();
}

/** Turn the dialog's roamContext (sidebar / current page / mentioned [[pages]]) into text. */
async function getGraphContext(tableBlockUid, roamContext, model) {
  if (!roamContext || !hasTrueBooleanKey(roamContext)) return "";
  try {
    return await getAndNormalizeContext({
      roamContext,
      focusedBlock: tableBlockUid,
      withHierarchy: true,
      withUid: false,
      model,
    });
  } catch (error) {
    console.warn("Live AI table: failed to gather graph context", error);
    return "";
  }
}

async function resolveSystemPrompt(style) {
  const stylePrompt = style ? await getStylePrompt(style) : null;
  return stylePrompt || defaultAssistantCharacter;
}

function contextSection(inlineContext, graphContext) {
  let section = "";
  if (inlineContext)
    section += `\nContext / completion instructions written next to the table (after the {{[[table]]}} component):\n${inlineContext}\n`;
  if (graphContext)
    section += `\nAdditional context gathered from the user's Roam graph:\n<context>\n${graphContext}\n</context>\n`;
  return section;
}

/** Pick a fully-filled data row (≠ excludeIndex) to serve as a style/format example. */
function pickExampleRow(model, excludeIndex) {
  const dataRows = model.rows
    .map((row, i) => ({ row, i }))
    .filter(({ i }) => i >= 1 && i !== excludeIndex);
  const full = dataRows.find(
    ({ row }) =>
      row.length >= model.colCount && row.every((c) => !isFillableCell(c.content))
  );
  return (full ? full.row : dataRows[0]?.row) || null;
}

/* ------------------------------ prompt builders ------------------------------ */

function buildRowPrompt({ tableText, headers, rowLabel, exampleRow, targetCells, instructions, inlineContext, graphContext }) {
  let prompt = `You are completing missing cells in a Roam table.\n\n`;
  if (tableText)
    prompt += `Here is the current table (one row per line, columns separated by " | ", ∅ = empty cell):\n\n${tableText}\n\n`;
  prompt += `The columns (headers) are:\n${headerLines(headers)}\n`;
  if (exampleRow)
    prompt += `\nExample of an already-filled row, to follow for style, format and level of detail:\n${exampleRow
      .map((c) => disp(c).trim() || "∅")
      .join(" | ")}\n`;
  prompt += contextSection(inlineContext, graphContext);
  prompt += `\nComplete ONLY the following cells of the row "${rowLabel}". Each listed cell belongs to the indicated column; infer its value from the column header, the other cells of this same row, and the example row. When a cell shows [instruction: ...], treat that text as a description of what to generate and do NOT keep the brackets. When a cell shows a current value, revise or replace it according to the instructions. Keep each value concise and suitable for a single table cell (no line breaks). Do not modify any other cell.\n\nCells to complete:\n${targetCells
    .map((c) => `- Column "${c.columnTitle || "(untitled)"}" ((${c.uid})): ${cellHint(c)}`)
    .join("\n")}\n`;
  if (instructions) prompt += `\nAdditional instructions from the user: ${instructions}\n`;
  prompt += LINE_FORMAT_INSTRUCTIONS;
  return prompt;
}

function buildColumnPrompt({ tableText, headers, colIndex, columnTitle, exampleValue, targetCells, instructions, inlineContext, graphContext }) {
  let prompt = `You are completing missing cells in a single column of a Roam table.\n\n`;
  if (tableText)
    prompt += `Here is the current table (one row per line, columns separated by " | ", ∅ = empty cell):\n\n${tableText}\n\n`;
  prompt += `The columns (headers) are:\n${headerLines(headers, colIndex)}\n\nYou must complete the column titled "${
    columnTitle || "(untitled)"
  }".\n`;
  if (exampleValue)
    prompt += `\nExample of an already-filled value in this column, to follow for style, format and level of detail: "${exampleValue}"\n`;
  prompt += contextSection(inlineContext, graphContext);
  prompt += `\nFor each listed cell, infer its value from the column header "${
    columnTitle || "(untitled)"
  }", the other cells of the SAME row (shown in the table above), and the example value. When a cell shows [instruction: ...], treat that text as a description of what to generate and do NOT keep the brackets. When a cell shows a current value, revise or replace it according to the instructions. Keep each value concise and suitable for a single table cell (no line breaks). Do not modify any other cell.\n\nCells to complete (each identified by the value of its row's first column):\n${targetCells
    .map((c) => `- Row "${c.rowLabel || "(unlabelled)"}" ((${c.uid})): ${cellHint(c)}`)
    .join("\n")}\n`;
  if (instructions) prompt += `\nAdditional instructions from the user: ${instructions}\n`;
  prompt += LINE_FORMAT_INSTRUCTIONS;
  return prompt;
}

function buildMultiRowPrompt({ tableText, headers, newRows, rowCount, instructions, inlineContext, graphContext }) {
  let prompt = `You are adding new rows to a Roam table.\n\nHere is the current table (one row per line, columns separated by " | ", ∅ = empty cell):\n\n${tableText}\n\nThe columns (headers) are:\n${headerLines(
    headers
  )}\n`;
  prompt += contextSection(inlineContext, graphContext);
  prompt += `\nGenerate ${rowCount} NEW row${
    rowCount > 1 ? "s" : ""
  } that plausibly continue or extend this table, consistent with the column headers and the existing rows. Do NOT duplicate existing rows. Fill every listed cell (identified by its ((uid))), keeping each value concise and suitable for a single table cell (no line breaks).\n\nNew rows to fill:\n`;
  newRows.forEach((row, i) => {
    prompt += `Row ${i + 1}:\n`;
    row.forEach((cell, colIdx) => {
      prompt += `- Column "${headers[colIdx]?.content?.trim() || "(untitled)"}" ((${cell.uid})): \n`;
    });
  });
  if (instructions) prompt += `\nAdditional instructions from the user: ${instructions}\n`;
  prompt += LINE_FORMAT_INSTRUCTIONS;
  return prompt;
}

/* ------------------------------ shared runner ------------------------------ */

async function cleanupBlocks(uids) {
  if (!uids || !uids.length) return;
  for (const uid of uids) {
    try {
      await deleteBlock(uid);
    } catch (error) {
      // ignore — best-effort rollback
    }
  }
}

async function runTableCompletion({
  tableBlockUid,
  prompt,
  systemPrompt,
  model,
  cleanupUids,
  coords,
  roamGrid = false,
  thinkingEnabled,
  boldUids,
}) {
  // Let Roam render any just-created cells before we place per-cell spinners on them.
  await new Promise((resolve) => setTimeout(resolve, 100));
  const spinners = showCellSpinners(tableBlockUid, coords);
  const coordByUid = new Map(
    (coords || []).map((c) => [stripUidParens(c.uid), c])
  );
  const boldSet = new Set((boldUids || []).map(stripUidParens));
  const appliedUids = new Set();
  let writeQueue = Promise.resolve();

  // Write one cell as soon as its "((uid)): value" line has fully arrived.
  const applyCell = (rawUid, rawValue) => {
    const uid = stripUidParens(rawUid);
    if (!uid || appliedUids.has(uid)) return;
    let value = (rawValue ?? "").trim();
    if (!value) return; // don't clobber a cell the model left empty
    if (boldSet.has(uid) && !(value.startsWith("**") && value.endsWith("**"))) {
      value = `**${value}**`;
    }
    appliedUids.add(uid);
    const c = coordByUid.get(uid);
    // Enhanced tables must go through Roam Grid so its optimistic model,
    // formula dependencies, undo history, metadata, and serialized Roam writes
    // stay coherent. Native tables retain the existing direct-block fallback.
    writeQueue = writeQueue.then(() =>
      roamGrid && c && window.roamGrid?.v1?.applyPatch
        ? window.roamGrid.v1.applyPatch(tableBlockUid, {
            op: "set",
            row: c.row,
            col: c.col,
            value,
          })
        : window.roamAlphaAPI.updateBlock({ block: { uid, string: value } })
    );
    spinners.remove(uid);
    if (c) revealCells(tableBlockUid, [{ row: c.row, col: c.col }]);
  };

  // Progressive line parser: consume completed lines from the stream buffer.
  let buffer = "";
  const onChunk = (text) => {
    buffer += text;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const m = line.match(CELL_LINE_REGEX);
      if (m) applyCell(m[1], m[2]);
    }
  };

  try {
    const responseText = await aiCompletion({
      instantModel: model || extensionStorage.get("defaultModel") || undefined,
      prompt: [{ role: "user", content: prompt }],
      systemPrompt,
      content: "",
      responseFormat: "text",
      targetUid: tableBlockUid,
      isButtonToInsert: false,
      streamTo: "none",
      thinkingEnabled,
      onChunk,
    });

    // Reconcile: re-parse the full response so the last (newline-less) line and any
    // line missed while streaming was disabled are still applied (applyCell dedupes).
    if (typeof responseText === "string") {
      responseText.split("\n").forEach((line) => {
        const m = line.match(CELL_LINE_REGEX);
        if (m) applyCell(m[1], m[2]);
      });
    }
    await writeQueue;

    if (appliedUids.size) {
      AppToaster.show({
        message: `Live AI: filled ${appliedUids.size} table cell${
          appliedUids.size > 1 ? "s" : ""
        }.`,
        timeout: 4000,
      });
      return responseText;
    }
    // Nothing usable came back — roll back any blocks we pre-created.
    await cleanupBlocks(cleanupUids);
    AppToaster.show({
      message: cleanupUids?.length
        ? "Live AI: the model returned nothing — the added blank rows/columns were removed."
        : "Live AI: the model returned no cell to fill.",
      intent: "warning",
      timeout: 6000,
    });
    return responseText;
  } catch (error) {
    // Keep whatever streamed in successfully; only roll back if nothing landed.
    if (!appliedUids.size) await cleanupBlocks(cleanupUids);
    throw error;
  } finally {
    spinners.removeAll();
  }
}

/* ------------------------------ public API ------------------------------ */

/**
 * Auto-complete the blank / [placeholder] cells of a single table row, guided by the
 * column headers, an example row, optional inline/graph context and user instructions.
 */
export async function autoCompleteTableRow({
  tableBlockUid,
  rowIndex,
  instructions,
  model,
  style,
  roamContext,
  includeAllRows = true,
  overwrite = false,
  thinkingEnabled,
}) {
  const model2d = getTableModel(tableBlockUid);
  if (!model2d || !model2d.rows.length) {
    AppToaster.show({ message: "Live AI: couldn't read this table.", intent: "warning", timeout: 5000 });
    return;
  }
  if (rowIndex < 0 || rowIndex >= model2d.rows.length) {
    AppToaster.show({ message: "Live AI: this row no longer exists.", intent: "warning", timeout: 5000 });
    return;
  }

  const headers = model2d.rows[0];
  const colCount = Math.max(model2d.colCount, headers.length);
  const rowCells = await ensureRowColumns(model2d.rows[rowIndex], colCount);
  model2d.rows[rowIndex] = rowCells;

  const targetCells = [];
  rowCells.forEach((cell, colIdx) => {
    if (overwrite || cell.created || isFillableCell(cell.content)) {
      targetCells.push({
        uid: cell.uid,
        content: cell.content,
        display: cell.display,
        columnTitle: headers[colIdx]?.display ?? headers[colIdx]?.content,
        placeholder: getPlaceholderInstruction(cell.content),
        col: colIdx,
      });
    }
  });

  if (!targetCells.length) {
    AppToaster.show({
      message:
        "Live AI: no empty or [placeholder] cell to complete in this row (enable overwrite to update filled cells).",
      timeout: 5000,
    });
    return;
  }

  const exampleRow = pickExampleRow(model2d, rowIndex);
  const tableText = includeAllRows
    ? renderTableAsText(model2d)
    : renderTableAsText({ rows: [headers, ...(exampleRow ? [exampleRow] : [])] });
  const rowLabel = disp(rowCells[0]).trim() || `row #${rowIndex + 1}`;
  const inlineContext = getInlineContext(tableBlockUid);
  const graphContext = await getGraphContext(tableBlockUid, roamContext, model);
  const systemPrompt = await resolveSystemPrompt(style);

  const prompt = buildRowPrompt({
    tableText,
    headers,
    rowLabel,
    exampleRow,
    targetCells,
    instructions,
    inlineContext,
    graphContext,
  });
  const coords = targetCells.map((c) => ({ row: rowIndex, col: c.col, uid: c.uid }));
  await runTableCompletion({ tableBlockUid, prompt, systemPrompt, model, coords, roamGrid: model2d.roamGrid, thinkingEnabled });
}

/**
 * Auto-complete the blank / [placeholder] cells of a single table column (across all
 * data rows), guided by the column header, an example value, optional context and
 * user instructions.
 */
export async function autoCompleteTableColumn({
  tableBlockUid,
  colIndex,
  instructions,
  model,
  style,
  roamContext,
  includeAllRows = true,
  overwrite = false,
  thinkingEnabled,
}) {
  const model2d = getTableModel(tableBlockUid);
  if (!model2d || model2d.rows.length < 2) {
    AppToaster.show({ message: "Live AI: this column has no data rows to complete.", timeout: 4000 });
    return;
  }
  if (colIndex < 0) {
    AppToaster.show({ message: "Live AI: couldn't identify this column.", intent: "warning", timeout: 5000 });
    return;
  }

  const headers = model2d.rows[0];
  const columnTitle = disp(headers[colIndex]).trim();

  const targetCells = [];
  let exampleValue = null;
  for (let rowIndex = 1; rowIndex < model2d.rows.length; rowIndex++) {
    let rowCells = model2d.rows[rowIndex];
    if (rowCells.length < colIndex + 1) {
      rowCells = await ensureRowColumns(rowCells, colIndex + 1);
      model2d.rows[rowIndex] = rowCells;
    }
    const cell = rowCells[colIndex];
    if (!cell) continue;
    if (overwrite || cell.created || isFillableCell(cell.content)) {
      targetCells.push({
        uid: cell.uid,
        content: cell.content,
        display: cell.display,
        rowLabel: disp(rowCells[0]).trim(),
        placeholder: getPlaceholderInstruction(cell.content),
        row: rowIndex,
      });
    } else if (!exampleValue) {
      exampleValue = disp(cell).trim();
    }
  }

  if (!targetCells.length) {
    AppToaster.show({
      message:
        "Live AI: no empty or [placeholder] cell to complete in this column (enable overwrite to update filled cells).",
      timeout: 5000,
    });
    return;
  }

  const tableText = includeAllRows
    ? renderTableAsText(model2d)
    : renderTableAsText({ rows: [headers, model2d.rows[1]].filter(Boolean) });
  const inlineContext = getInlineContext(tableBlockUid);
  const graphContext = await getGraphContext(tableBlockUid, roamContext, model);
  const systemPrompt = await resolveSystemPrompt(style);

  const prompt = buildColumnPrompt({
    tableText,
    headers,
    colIndex,
    columnTitle,
    exampleValue,
    targetCells,
    instructions,
    inlineContext,
    graphContext,
  });
  const coords = targetCells.map((c) => ({ row: c.row, col: colIndex, uid: c.uid }));
  await runTableCompletion({ tableBlockUid, prompt, systemPrompt, model, coords, roamGrid: model2d.roamGrid, thinkingEnabled });
}

/**
 * Generate `rowCount` new rows below the anchor row (the "Insert below" equivalent) and
 * fill them with AI-generated content, always using the whole table as context.
 */
export async function generateTableRows({
  tableBlockUid,
  rowIndex,
  rowCount = 3,
  instructions,
  model,
  style,
  roamContext,
  thinkingEnabled,
}) {
  const model2d = getTableModel(tableBlockUid);
  if (!model2d || !model2d.rows.length) {
    AppToaster.show({ message: "Live AI: couldn't read this table.", intent: "warning", timeout: 5000 });
    return;
  }
  const anchorRowUid = model2d.rows[rowIndex]?.[0]?.uid;
  if (!anchorRowUid) {
    AppToaster.show({ message: "Live AI: this row no longer exists.", intent: "warning", timeout: 5000 });
    return;
  }

  const headers = model2d.rows[0];
  const colCount = Math.max(model2d.colCount, headers.length);
  const count = Math.min(Math.max(parseInt(rowCount, 10) || 1, 1), 20);

  // Snapshot the table text BEFORE inserting the (empty) new rows.
  const tableText = renderTableAsText(model2d);
  const inlineContext = getInlineContext(tableBlockUid);
  const graphContext = await getGraphContext(tableBlockUid, roamContext, model);
  const systemPrompt = await resolveSystemPrompt(style);

  // If the anchor row is itself entirely blank, fill it too (as the first row) rather
  // than skipping it; only rows we actually create are rolled back on failure.
  const anchorIsBlank =
    rowIndex >= 1 && model2d.rows[rowIndex].every((c) => isFillableCell(c.content));

  const targetRows = [];
  let createdRowUids = [];
  if (anchorIsBlank) {
    targetRows.push(await ensureRowColumns(model2d.rows[rowIndex], colCount));
    const remaining = count - 1;
    if (remaining > 0) {
      const newRows = await insertEmptyRowsBelow(tableBlockUid, anchorRowUid, remaining, colCount);
      targetRows.push(...newRows);
      createdRowUids = newRows.map((r) => r[0].uid);
    }
  } else {
    const newRows = await insertEmptyRowsBelow(tableBlockUid, anchorRowUid, count, colCount);
    targetRows.push(...newRows);
    createdRowUids = newRows.map((r) => r[0].uid);
  }

  const prompt = buildMultiRowPrompt({
    tableText,
    headers,
    newRows: targetRows,
    rowCount: targetRows.length,
    instructions,
    inlineContext,
    graphContext,
  });
  // DOM row index of the first target row: the (blank) anchor keeps its index, new rows
  // follow it; otherwise the new rows start just below the anchor.
  const firstDomRow = anchorIsBlank ? rowIndex : rowIndex + 1;
  const coords = [];
  targetRows.forEach((row, k) => {
    row.forEach((cell, colIdx) =>
      coords.push({ row: firstDomRow + k, col: colIdx, uid: cell.uid })
    );
  });
  await runTableCompletion({
    tableBlockUid,
    prompt,
    systemPrompt,
    model,
    cleanupUids: createdRowUids,
    coords,
    roamGrid: model2d.roamGrid,
    thinkingEnabled,
  });
}

function buildMultiColumnPrompt({ tableText, rows, newColumns, count, instructions, inlineContext, graphContext }) {
  let prompt = `You are adding new columns to a Roam table.\n\nHere is the current table (one row per line, columns separated by " | ", ∅ = empty cell):\n\n${tableText}\n`;
  prompt += contextSection(inlineContext, graphContext);
  prompt += `\nAdd ${count} NEW column${
    count > 1 ? "s" : ""
  } to this table. For EACH new column: first propose a concise, relevant column header/title (fill the header cell — wrap the title in ** for bold, e.g. **Title**), then fill each data row's cell for that column, consistent with that row's other cells and the table's subject. Keep every value concise and suitable for a single table cell (no line breaks).\n\nNew columns to fill:\n`;
  newColumns.forEach((col, j) => {
    prompt += `Column ${String.fromCharCode(65 + j)}:\n`;
    col.forEach((cell) => {
      if (cell.rowIndex === 0) {
        prompt += `- Header ((${cell.uid})): [propose a column title]\n`;
      } else {
        const rowLabel =
          disp(rows[cell.rowIndex]?.[0]).trim() || `row #${cell.rowIndex + 1}`;
        prompt += `- Row "${rowLabel}" ((${cell.uid})): \n`;
      }
    });
  });
  if (instructions) prompt += `\nAdditional instructions from the user: ${instructions}\n`;
  prompt += LINE_FORMAT_INSTRUCTIONS;
  return prompt;
}

/**
 * Generate `columnCount` new columns on the right of the table (headers + values),
 * filled by AI using the whole table as context.
 */
export async function generateTableColumns({
  tableBlockUid,
  columnCount = 1,
  instructions,
  model,
  style,
  roamContext,
  thinkingEnabled,
}) {
  const model2d = getTableModel(tableBlockUid);
  if (!model2d || !model2d.rows.length) {
    AppToaster.show({ message: "Live AI: couldn't read this table.", intent: "warning", timeout: 5000 });
    return;
  }
  const count = Math.min(Math.max(parseInt(columnCount, 10) || 1, 1), 10);
  const headers = model2d.rows[0];
  const existingColCount = Math.max(model2d.colCount, headers.length);

  const tableText = renderTableAsText(model2d);
  const inlineContext = getInlineContext(tableBlockUid);
  const graphContext = await getGraphContext(tableBlockUid, roamContext, model);
  const systemPrompt = await resolveSystemPrompt(style);

  const { newColumns, cleanupUids } = await insertEmptyColumnsRight(
    model2d,
    count,
    existingColCount
  );

  const prompt = buildMultiColumnPrompt({
    tableText,
    rows: model2d.rows,
    newColumns,
    count,
    instructions,
    inlineContext,
    graphContext,
  });
  const coords = newColumns
    .flat()
    .map((cell) => ({ row: cell.rowIndex, col: cell.colIndex, uid: cell.uid }));
  // The header cell of each new column (row 0) should be rendered bold, like Roam's
  // own table headers.
  const boldUids = newColumns
    .map((col) => col.find((cell) => cell.rowIndex === 0)?.uid)
    .filter(Boolean);
  await runTableCompletion({
    tableBlockUid,
    prompt,
    systemPrompt,
    model,
    cleanupUids,
    coords,
    roamGrid: model2d.roamGrid,
    thinkingEnabled,
    boldUids,
  });
}
