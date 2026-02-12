import React, { useMemo } from "react";
import { Checkbox, Tooltip, NumericInput, Icon, MenuItem } from "@blueprintjs/core";
import { Select } from "@blueprintjs/select";
import { hasBlockChildren, hasSiblings, isLogView, getPathOfBlock } from "../../../utils/roamAPI";

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

const PathContextControl = ({
  roamContext,
  updateContext,
  setRoamContext,
  focusedBlockUid,
}) => {
  const ancestorCount = useMemo(() => {
    if (!focusedBlockUid.current) return 0;
    const path = getPathOfBlock(focusedBlockUid.current);
    if (!path) return 0;
    // path includes page (with string undefined) + ancestor blocks
    // Count only those with string content (actual block ancestors)
    return path.filter((p) => p.string).length;
  }, [focusedBlockUid.current]);

  const pathDepthOptions = useMemo(() => {
    const options = [{ value: 0, label: "Full" }];
    for (let i = ancestorCount; i >= 1; i--) {
      options.push({ value: i, label: `${i}` });
    }
    return options;
  }, [ancestorCount]);

  const currentDepth = roamContext.pathDepth || 0;
  const currentLabel =
    pathDepthOptions.find((o) => o.value === currentDepth)?.label || "Full";

  return (
    <>
      <Tooltip
        content={
          <div>
            Hierarchical location of the focused block
            <br />
            (Page &gt; parent &gt; parent...)
          </div>
        }
        hoverOpenDelay={800}
        openOnTargetFocus={false}
      >
        <Checkbox
          checked={roamContext.path}
          label="Path"
          inline={true}
          onChange={(e) => updateContext("path", e)}
        />
      </Tooltip>
      {roamContext.path && ancestorCount > 1 && (
        <Select
          items={pathDepthOptions}
          itemRenderer={(item, { handleClick, modifiers }) => (
            <MenuItem
              key={item.value}
              text={item.label}
              active={modifiers.active}
              onClick={handleClick}
              icon={item.value === currentDepth ? "tick" : "blank"}
            />
          )}
          onItemSelect={(item) => {
            setRoamContext((prev) => ({
              ...prev,
              pathDepth: item.value,
            }));
          }}
          filterable={false}
          popoverProps={{
            minimal: true,
            placement: "bottom-start",
          }}
        >
          <button>
            {currentLabel}
            <Icon icon="caret-down" size={12} />
          </button>
        </Select>
      )}
    </>
  );
};

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
  includeQueryInContext,
  setIncludeQueryInContext,
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
        {!selectedBlocks?.current?.length &&
          !selectedTextInBlock.current &&
          focusedBlockUid.current &&
          hasSiblings(focusedBlockUid.current) && (
            <Tooltip
              content={
                <div>
                  Include all sibling blocks
                  <br />
                  and their children
                </div>
              }
              hoverOpenDelay={800}
              openOnTargetFocus={false}
            >
              <Checkbox
                checked={roamContext.siblings}
                label="Siblings"
                inline={true}
                onChange={(e) => updateContext("siblings", e)}
              />
            </Tooltip>
          )}
        {!selectedBlocks?.current?.length &&
          !selectedTextInBlock.current &&
          focusedBlockUid.current && (
            <PathContextControl
              roamContext={roamContext}
              updateContext={updateContext}
              setRoamContext={setRoamContext}
              focusedBlockUid={focusedBlockUid}
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
              Execute Roam queries and :q Datomic queries
              <br />
              found in prompt/context and add results as context
            </div>
          }
          hoverOpenDelay={800}
          openOnTargetFocus={false}
        >
          <Checkbox
            checked={includeQueryInContext}
            label="Queries"
            inline={true}
            onChange={() => setIncludeQueryInContext((prev) => !prev)}
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
