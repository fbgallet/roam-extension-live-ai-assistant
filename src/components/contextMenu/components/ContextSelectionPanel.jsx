import React from "react";
import { Checkbox, Tooltip, NumericInput, Icon } from "@blueprintjs/core";
import { Select } from "@blueprintjs/select";
import { hasBlockChildren, isLogView } from "../../../utils/roamAPI";

const DNP_PERIOD_OPTIONS = [
  { value: "0", label: "0", days: 0 },
  { value: "1 W", label: "1 week", days: 7 },
  { value: "2 W", label: "2 weeks", days: 14 },
  { value: "3 W", label: "3 weeks", days: 21 },
  { value: "1 M", label: "1 month", days: 30 },
  { value: "2 M", label: "2 months", days: 60 },
  { value: "1 Q", label: "1 quarter", days: 92 },
  { value: "1 Y", label: "1 year", days: 365 },
  { value: "Custom", label: "Custom" },
];

const ContextSelectionPanel = ({
  selectedBlocks,
  selectedTextInBlock,
  focusedBlockUid,
  isChildrenTreeToInclude,
  setIsChildrenTreeToInclude,
  roamContext,
  updateContext,
  mainViewUid,
  isZoom,
  pageUid,
  dnpPeriod,
  handleDnpPeriodChange,
  customDays,
  setCustomDays,
  setRoamContext,
  rootUid,
  renderDnpPeriodItem,
  includePdfInContext,
  setIncludePdfInContext,
}) => {
  return (
    <>
      {!selectedBlocks?.current?.length &&
        !selectedTextInBlock.current &&
        focusedBlockUid.current &&
        hasBlockChildren(focusedBlockUid.current) && (
          <div
            className="aicommands-context"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <strong>Prompt: </strong>
            <Tooltip
              content={<div>Prompt = focused block + all its children </div>}
              hoverOpenDelay={800}
              openOnTargetFocus={false}
            >
              <Checkbox
                checked={isChildrenTreeToInclude}
                label="Include children"
                inline={true}
                onChange={() => {
                  setIsChildrenTreeToInclude((prev) => !prev);
                }}
              />
            </Tooltip>
          </div>
        )}

      <div
        className="aicommands-context"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <strong>Context: </strong>
        {(!isLogView() || mainViewUid.current) && (
          <Tooltip
            content={
              <div>
                Main view content{" "}
                {!isZoom.current || (isZoom.current && !pageUid.current)
                  ? "(entire page)"
                  : "(zoom)"}
              </div>
            }
            hoverOpenDelay={800}
            openOnTargetFocus={false}
          >
            <Checkbox
              checked={roamContext.page}
              label={
                !isZoom.current || (isZoom.current && !pageUid.current)
                  ? "Page"
                  : "Zoom"
              }
              inline={true}
              onChange={(e) =>
                updateContext(
                  !isZoom.current || (isZoom.current && !pageUid.current)
                    ? "page"
                    : "zoom",
                  e
                )
              }
            />
          </Tooltip>
        )}
        <Checkbox
          checked={roamContext.sidebar}
          label="Sidebar"
          inline={true}
          onChange={(e) => updateContext("sidebar", e)}
        />
        <Tooltip
          content={
            <div>
              ⚠️ Mentioned pages content
              <br />+ their linked references
            </div>
          }
          hoverOpenDelay={800}
          openOnTargetFocus={false}
        >
          <Checkbox
            checked={roamContext.linkedPages}
            label="[[pages]]"
            inline={true}
            onChange={(e) => updateContext("linkedPages", e)}
          />
        </Tooltip>
        {!isLogView() && (
          <Checkbox
            checked={roamContext.linkedRefs}
            label="Linked Refs"
            inline={true}
            onChange={(e) => updateContext("linkedRefs", e)}
          />
        )}
        <Tooltip
          content={
            <div>
              Include PDF content from context
              <br />
              (disable to skip PDF processing)
            </div>
          }
          hoverOpenDelay={800}
          openOnTargetFocus={false}
        >
          <Checkbox
            checked={includePdfInContext}
            label="PDF"
            inline={true}
            onChange={() => setIncludePdfInContext((prev) => !prev)}
          />
        </Tooltip>
        <Tooltip
          content={
            <div>
              Previous Daily Note Pages
              <br />
              but NOT TODAY (unless from a not-DNP)
              <br />
              (from today or relative to current DNP)
            </div>
          }
          hoverOpenDelay={800}
          openOnTargetFocus={false}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <Select
              items={DNP_PERIOD_OPTIONS}
              itemRenderer={renderDnpPeriodItem}
              onItemSelect={handleDnpPeriodChange}
              filterable={false}
              popoverProps={{
                minimal: true,
                placement: "bottom-start",
              }}
            >
              <button>
                {dnpPeriod}
                <Icon icon="caret-down" size={12} />
              </button>
            </Select>

            {dnpPeriod === "Custom" && (
              <NumericInput
                value={customDays}
                size="small"
                min={1}
                onValueChange={(value) => {
                  setCustomDays(value);
                  setRoamContext((prev) => ({
                    ...prev,
                    logPagesArgument: value,
                  }));
                }}
                placeholder="days"
                small={true}
                onClick={(e) => e.stopPropagation()}
              />
            )}
            <>DNPs</>
          </div>
        </Tooltip>
        {rootUid && (
          <Checkbox
            checked={roamContext.block}
            label="Outline"
            inline={true}
            onChange={(e) => updateContext("liveOutline", e)}
          />
        )}
      </div>
    </>
  );
};

export default ContextSelectionPanel;
