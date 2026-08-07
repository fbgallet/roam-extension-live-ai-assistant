function currentWindow() {
  return typeof window === "undefined" ? undefined : window;
}

/**
 * Read an opted-in Roam Grid table through its public API. Returning null is
 * intentional: callers can continue through Live AI's native-table reader.
 */
function getEnhancedTableModel(
  tableBlockUid,
  resolveReferences,
  apiRoot = currentWindow()
) {
  try {
    const enhanced = apiRoot?.roamGrid?.v1?.getTableModel?.(tableBlockUid);
    if (!enhanced?.rows?.length) return null;
    const rows = enhanced.rows.map((row) =>
      row.map((cell) => {
        const raw = cell?.raw ?? "";
        return {
          uid: cell?.uid,
          content: raw,
          display: resolveReferences(raw),
        };
      })
    );
    return {
      tableUid: tableBlockUid,
      rows,
      colCount:
        enhanced.columnIds?.length ||
        rows.reduce((max, row) => Math.max(max, row.length), 0),
      roamGrid: true,
    };
  } catch (error) {
    console.warn(
      "Live AI table: Roam Grid adapter failed; using native blocks",
      error
    );
    return null;
  }
}

/**
 * Keep enhanced-table writes transactional. If the table is native, or the
 * extension disappeared during a streamed completion, retain the established
 * direct-block update path.
 */
function updateTableCell({
  tableBlockUid,
  coordinate,
  uid,
  value,
  roamGrid,
  apiRoot = currentWindow(),
}) {
  if (roamGrid && coordinate && apiRoot?.roamGrid?.v1?.applyPatch) {
    return apiRoot.roamGrid.v1.applyPatch(tableBlockUid, {
      op: "set",
      row: coordinate.row,
      col: coordinate.col,
      value,
    });
  }
  return apiRoot.roamAlphaAPI.updateBlock({ block: { uid, string: value } });
}

module.exports = { getEnhancedTableModel, updateTableCell };
