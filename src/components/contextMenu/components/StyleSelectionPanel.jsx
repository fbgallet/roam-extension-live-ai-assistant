import React from "react";
import { HTMLSelect, Tooltip, Icon } from "@blueprintjs/core";

const BUILTIN_STYLES = [
  "Normal",
  "Concise",
  "Conversational",
  "No bullet points",
  "Atomic",
  "Quiz",
  "Socratic",
];

const StyleSelectionPanel = ({
  style,
  setStyle,
  isPinnedStyle,
  setIsPinnedStyle,
  customStyleTitles,
  inputRef,
}) => {
  return (
    <div
      className="aicommands-style"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      Style{" "}
      <Tooltip
        content={
          <div>
            Pin/unpin this style for this session
            <br />
            To set is as default, see extension settings
          </div>
        }
        openOnTargetFocus={false}
        style={{ zIndex: "9999" }}
      >
        <Icon
          icon={isPinnedStyle ? "unpin" : "pin"}
          onClick={(e) => {
            e.stopPropagation();
            setIsPinnedStyle((prev) => !prev);
          }}
          intent={isPinnedStyle ? "primary" : "none"}
        />
      </Tooltip>
      <HTMLSelect
        options={BUILTIN_STYLES.concat(customStyleTitles)}
        minimal={true}
        onClick={(e) => {
          e.stopPropagation();
        }}
        onChange={(e) => {
          setStyle(e.currentTarget.value);
          inputRef.current?.focus();
        }}
        value={style}
      />
    </div>
  );
};

export default StyleSelectionPanel;