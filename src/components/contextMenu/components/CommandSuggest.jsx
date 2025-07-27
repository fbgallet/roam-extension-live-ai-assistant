import React from "react";
import { Suggest } from "@blueprintjs/select";
import { Icon, HTMLSelect, Tooltip, TextArea } from "@blueprintjs/core";
import { simulateClick } from "../../../utils/domElts";

const CommandSuggest = ({
  roamContext,
  popoverRef,
  stableItems,
  groupedItemRenderer,
  renderCommand,
  filterCommands,
  handleItemSelect,
  inputRef,
  displayAddPrompt,
  handleAddPrompt,
  targetBlock,
  setTargetBlock,
  additionalPrompt,
  setAdditionalPrompt,
}) => {
  return (
    <>
      <Suggest
        key={`suggest-${JSON.stringify(roamContext)}`}
        popoverRef={popoverRef}
        fill={true}
        items={stableItems}
        itemListRenderer={groupedItemRenderer}
        itemRenderer={renderCommand}
        itemPredicate={filterCommands}
        scrollToActiveItem={true}
        onItemSelect={handleItemSelect}
        inputProps={{
          className: "str-aicommands-input",
          placeholder: "Live AI command...",
          inputRef: inputRef,
          fill: true,
          leftElement: (
            <Icon
              icon={displayAddPrompt ? "minus" : "add"}
              onClick={(e) => handleAddPrompt(e)}
            />
          ),
          onClick: (e) => e.stopPropagation(),
          onKeyPress: (e) => {
            e.stopPropagation();
            if (e.code === "Enter") {
              const activeMenuElt = document.querySelector(".bp3-active");
              if (activeMenuElt.innerText === "Use this custom prompt")
                simulateClick(document.querySelector(".bp3-active"));
            }
          },
          rightElement: (
            <Tooltip
              content="Target of the AI response"
              openOnTargetFocus={false}
              style={{ zIndex: "9999" }}
            >
              <HTMLSelect
                options={["auto", "new", "new w/o", "replace", "append"]}
                minimal={true}
                onClick={(e) => {
                  e.stopPropagation();
                }}
                onChange={(e) => {
                  setTargetBlock(e.currentTarget.value);
                  inputRef.current?.focus();
                }}
                value={targetBlock}
              />
            </Tooltip>
          ),
        }}
        popoverProps={{
          minimal: true,
          placement: "right-start",
          popoverClassName: "suggested-aicommands",
          isOpen: true,
        }}
        inputValueRenderer={(item) => item.label}
      />
      {displayAddPrompt && (
        <div
          className="str-aicommands-additional"
          onClick={(e) => e.stopPropagation()}
        >
          <TextArea
            growVertically={true}
            fill={true}
            small={true}
            placeholder="Write additional instructions to selected command..."
            value={additionalPrompt}
            onChange={(e) => {
              setAdditionalPrompt(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.code === "Escape" || e.code === "Tab") {
                e.preventDefault();
                inputRef.current?.focus();
              }
            }}
          />
        </div>
      )}
    </>
  );
};

export default CommandSuggest;
