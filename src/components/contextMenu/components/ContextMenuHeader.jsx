import React from "react";
import { Icon, Tooltip, MenuDivider } from "@blueprintjs/core";
import { displayTokensDialog } from "../../../utils/domElts";
import { MCPDiagnostics } from "../../../ai/agents/mcp-agent/mcpDiagnostics";

const ContextMenuHeader = ({
  defaultModel,
  setIsHelpOpen,
  setIsOpen,
  setIsMCPConfigOpen,
  updateUserCommands,
  updateCustomStyles,
  updateLiveOutlines,
  updateTemplates,
  handleClose,
  inputRef,
}) => {
  return (
    <>
      <div className="aicommands-topbar">
        <div>LIVE AI</div>
        <div className="laia-topbar-icons">
          <Tooltip
            content="Quick reminder"
            disabled={window.roamAlphaAPI.platform.isMobile}
            hoverOpenDelay={600}
            openOnTargetFocus={false}
            style={{ zIndex: "9990" }}
          >
            <Icon
              icon="help"
              size={12}
              onClick={(e) => {
                e.stopPropagation();
                setIsHelpOpen(true);
              }}
            />
          </Tooltip>
          <Tooltip
            content="Tokens usage and cost by model"
            disabled={window.roamAlphaAPI.platform.isMobile}
            hoverOpenDelay={600}
            openOnTargetFocus={false}
            style={{ zIndex: "9999" }}
          >
            <Icon
              icon="dollar"
              size={12}
              onClick={(e) => {
                e.stopPropagation();
                displayTokensDialog();
                setIsOpen(false);
              }}
            />
          </Tooltip>
          <Tooltip
            content="Configure MCP servers"
            disabled={window.roamAlphaAPI.platform.isMobile}
            hoverOpenDelay={600}
            openOnTargetFocus={false}
            style={{ zIndex: "9999" }}
          >
            <Icon
              icon="data-connection"
              size={12}
              onClick={(e) => {
                e.stopPropagation();
                setIsMCPConfigOpen(true);
              }}
            />
          </Tooltip>
          <Tooltip
            content="Refresh custom content menus"
            disabled={window.roamAlphaAPI.platform.isMobile}
            hoverOpenDelay={600}
            openOnTargetFocus={false}
            style={{ zIndex: "9999" }}
          >
            <Icon
              icon="reset"
              size={10}
              onClick={(e) => {
                e.stopPropagation();
                updateUserCommands(true);
                updateCustomStyles();
                updateLiveOutlines();
                updateTemplates();
                MCPDiagnostics.runFullDiagnostic();
                inputRef.current?.focus();
              }}
            />
          </Tooltip>
          <Tooltip
            content="Close context menu"
            disabled={window.roamAlphaAPI.platform.isMobile}
            hoverOpenDelay={600}
            openOnTargetFocus={false}
            style={{ zIndex: "9999" }}
          >
            <Icon icon="cross" size={12} onClick={() => handleClose()} />
          </Tooltip>
        </div>
      </div>
      <MenuDivider
        className="menu-hint"
        title={
          <div>
            Default model:{" "}
            <b>
              {defaultModel
                .replace("openRouter/", "")
                .replace("groq/", "")}
            </b>
          </div>
        }
      />
    </>
  );
};

export default ContextMenuHeader;