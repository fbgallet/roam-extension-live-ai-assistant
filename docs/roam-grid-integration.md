# Roam Grid integration

Live AI table completion remains native-first and adds an optional compatibility bridge for enhanced Roam Grid tables.

## Read path

When `window.roamGrid.v1.getTableModel(tableUid)` is available and returns an enhanced table, Live AI reads the UID-backed raw cell strings from that model. Raw strings remain the values used for placeholder detection and writes; resolved block-reference text is used only in the model prompt.

If Roam Grid is unavailable, the table is not enhanced, or its model call fails during reload, Live AI immediately falls back to its existing native Roam block-chain reader.

## Write path

Generated values for an enhanced table are serialized through:

```js
window.roamGrid.v1.applyPatch(tableUid, {
  op: "set",
  row,
  col,
  value,
});
```

This keeps Roam Grid's optimistic model, formulas, undo history, and persistence lane coherent. Native tables continue to use `roamAlphaAPI.updateBlock`. If Roam Grid unloads while a streamed completion is running, the write safely uses that native fallback.

The adapter is additive: Live AI does not require Roam Grid, change native table storage, or take ownership of Roam Grid's metadata.
