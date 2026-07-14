import React, { useState, useMemo, useRef, useEffect } from "react";
import ReactDOM from "react-dom";
import {
  Dialog,
  Classes,
  Button,
  TextArea,
  Checkbox,
  NumericInput,
  ContextMenu,
} from "@blueprintjs/core";
import StyleSelectionPanel from "./contextMenu/components/StyleSelectionPanel";
import ThinkingControls from "./contextMenu/components/ThinkingControls";
import ModelsMenu from "./ModelsMenu";
import { getCustomStyles } from "../ai/dataExtraction";
import { getModelThinkingDefault } from "../utils/modelConfigHelpers";
import { defaultStyle, defaultModel, extensionStorage } from "..";
import "./TableAutocompleteDialog.css";

const CONTAINER_ID = "livai-table-autocomplete-dialog-container";

function TableAutocompleteDialog({
  mode,
  title,
  label,
  initialModel,
  pageViewUid,
  onSubmit,
  onClose,
}) {
  const inputRef = useRef(null);
  const [instructions, setInstructions] = useState("");
  const [style, setStyle] = useState(defaultStyle || "Normal");
  const [isPinnedStyle, setIsPinnedStyle] = useState(false);
  const [roamContext, setRoamContext] = useState({
    sidebar: false,
    page: false,
    linkedPages: false,
    pageViewUid: null,
  });
  const [includeAllRows, setIncludeAllRows] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [count, setCount] = useState(3);
  const [selectedModel, setSelectedModel] = useState(
    initialModel || extensionStorage.get("defaultModel") || defaultModel,
  );
  const [thinkingEnabled, setThinkingEnabled] = useState(() =>
    getModelThinkingDefault(
      initialModel || extensionStorage.get("defaultModel") || defaultModel,
    ),
  );
  const [reasoningEffort, setReasoningEffort] = useState(
    extensionStorage.get("reasoningEffort") || "low",
  );

  const customStyleTitles = useMemo(
    () => getCustomStyles().map((s) => s.title),
    [],
  );
  const isMultiRow = mode === "multi-row";
  const isMultiColumn = mode === "multi-column";
  const isMulti = isMultiRow || isMultiColumn;

  // Roam keeps a table cell focused behind the modal; force focus into our textarea
  // once the dialog has mounted (and Roam has settled) so keystrokes land here.
  useEffect(() => {
    const t = setTimeout(() => {
      const ta = document.querySelector(".table-autocomplete-dialog textarea");
      if (ta) ta.focus();
    }, 80);
    return () => clearTimeout(t);
  }, []);

  const updateContext = (key) => {
    setRoamContext((prev) => {
      const next = { ...prev };
      if (key === "page") {
        next.page = !prev.page;
        next.pageViewUid = next.page ? pageViewUid : null;
      } else {
        next[key] = !prev[key];
      }
      return next;
    });
  };

  const submit = () => {
    onClose();
    onSubmit({
      instructions: instructions.trim(),
      style,
      roamContext,
      includeAllRows,
      overwrite,
      rowCount: count,
      model: selectedModel,
      thinkingEnabled,
    });
  };

  const openModelsMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    ContextMenu.show(
      ModelsMenu({
        callback: ({ model }) => setSelectedModel(model),
        setModel: (m) => setSelectedModel(m),
      }),
      { left: e.clientX, top: e.clientY },
      null,
    );
  };

  const modelLabel = (selectedModel || "default").split("/").pop();
  const primaryLabel = isMultiColumn
    ? "Generate columns"
    : isMultiRow
      ? "Generate rows"
      : "Auto-complete";

  return (
    <Dialog
      isOpen={true}
      onClose={onClose}
      title={title}
      icon="th"
      className="table-autocomplete-dialog"
    >
      <div className={`${Classes.DIALOG_BODY} table-autocomplete-body`}>
        <p className="table-autocomplete-label">{label}</p>
        <TextArea
          fill
          autoFocus
          growVertically
          inputRef={inputRef}
          className="table-autocomplete-textarea"
          value={instructions}
          placeholder="Optional instructions — e.g. keep answers short, use metric units… (just press Enter to run)"
          onChange={(e) => setInstructions(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
        />

        <div className="table-autocomplete-options">
          <div className="table-autocomplete-field">
            <StyleSelectionPanel
              style={style}
              setStyle={setStyle}
              isPinnedStyle={isPinnedStyle}
              setIsPinnedStyle={setIsPinnedStyle}
              customStyleTitles={customStyleTitles}
              inputRef={inputRef}
            />
          </div>

          <div className="table-autocomplete-field table-autocomplete-context">
            <span className="table-autocomplete-section-title">Context</span>
            <div className="table-autocomplete-context-row">
              <Checkbox
                checked={roamContext.sidebar}
                label="Sidebar"
                onChange={() => updateContext("sidebar")}
              />
              <Checkbox
                checked={roamContext.page}
                label="Current page"
                onChange={() => updateContext("page")}
              />
              <Checkbox
                checked={roamContext.linkedPages}
                label="Mentioned [[pages]]"
                onChange={() => updateContext("linkedPages")}
              />
            </div>
          </div>

          {!isMulti && (
            <Checkbox
              className="table-autocomplete-checkbox"
              checked={includeAllRows}
              label="Include all table rows as context"
              onChange={() => setIncludeAllRows((p) => !p)}
            />
          )}

          {!isMulti && (
            <Checkbox
              className="table-autocomplete-checkbox"
              checked={overwrite}
              label="Overwrite filled cells (update, not just fill blanks)"
              onChange={() => setOverwrite((p) => !p)}
            />
          )}

          {isMulti && (
            <div className="table-autocomplete-field table-autocomplete-row">
              <span>
                {isMultiColumn ? "Columns to generate:" : "Rows to generate:"}
              </span>
              <NumericInput
                min={1}
                max={isMultiColumn ? 10 : 20}
                value={count}
                onValueChange={(v) => setCount(v)}
                style={{ width: 64 }}
              />
            </div>
          )}

          <div className="table-autocomplete-field table-autocomplete-row">
            <span className="table-autocomplete-section-title">Model</span>
            <Button
              minimal
              icon="predictive-analysis"
              rightIcon="caret-down"
              text={modelLabel}
              onClick={openModelsMenu}
              onContextMenu={openModelsMenu}
              title="Left/right-click to pick the AI model for this run"
            />
            <ThinkingControls
              defaultModel={selectedModel}
              thinkingEnabled={thinkingEnabled}
              setThinkingEnabled={setThinkingEnabled}
              reasoningEffort={reasoningEffort}
              setReasoningEffort={setReasoningEffort}
              inputRef={inputRef}
            />
          </div>
        </div>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>Cancel</Button>
          <Button intent="primary" icon="lightning" onClick={submit}>
            {primaryLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Mount the instructions dialog on document.body. `onSubmit` receives
 * { instructions, style, roamContext, includeAllRows, rowCount, model }.
 * `mode` is "row" | "column" | "multi-row" | "multi-column".
 */
export function openTableAutocompleteDialog({
  mode,
  title,
  label,
  initialModel,
  pageViewUid,
  onSubmit,
}) {
  let container = document.getElementById(CONTAINER_ID);
  if (container) {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  }
  container = document.createElement("div");
  container.id = CONTAINER_ID;
  document.body.appendChild(container);

  const close = () => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  };

  ReactDOM.render(
    <TableAutocompleteDialog
      mode={mode}
      title={title}
      label={label}
      initialModel={initialModel}
      pageViewUid={pageViewUid}
      onSubmit={onSubmit}
      onClose={close}
    />,
    container,
  );
}

export default TableAutocompleteDialog;
