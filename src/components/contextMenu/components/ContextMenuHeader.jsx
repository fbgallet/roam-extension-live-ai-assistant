import React, { useState, useEffect } from "react";
import { Icon, Tooltip, MenuDivider } from "@blueprintjs/core";
import { displayTokensDialog } from "../../../utils/domElts";
import { MCPDiagnostics } from "../../../ai/agents/mcp-agent/mcpDiagnostics";
import AskGraphModeIndicator from "../../AskGraphModeIndicator";
import AskGraphFirstTimeDialog from "../../AskGraphFirstTimeDialog";
import { getCurrentAskGraphMode, setSessionAskGraphMode } from "../../../ai/agents/search-agent/ask-your-graph";

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
  const [currentMode, setCurrentMode] = useState(() => getCurrentAskGraphMode());
  const [isAskGraphDialogOpen, setIsAskGraphDialogOpen] = useState(false);

  // Update mode when component mounts or when external changes occur
  useEffect(() => {
    setCurrentMode(getCurrentAskGraphMode());
  }, []);

  const handleModeChange = (newMode) => {
    console.log("🔄 Mode changed to:", newMode);
    setSessionAskGraphMode(newMode, true);
    setCurrentMode(newMode); // Update local state immediately
  };

  const handleOpenAskGraphDialog = () => {
    setIsAskGraphDialogOpen(true);
  };

  const handleCloseAskGraphDialog = () => {
    setIsAskGraphDialogOpen(false);
    // Keep the context menu open after closing the dialog
  };

  const handleModeSelect = (selectedMode) => {
    handleModeChange(selectedMode);
  };

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
          
          {/* Ask Graph Mode Indicator */}
          <AskGraphModeIndicator
            currentMode={currentMode}
            onModeChange={handleModeChange}
            onRightClick={handleOpenAskGraphDialog}
            showChangeOption={true}
            iconOnly={true}
          />
          
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

      {/* Ask Graph First Time Dialog */}
      <AskGraphFirstTimeDialog
        isOpen={isAskGraphDialogOpen}
        onClose={handleCloseAskGraphDialog}
        onModeSelect={handleModeSelect}
        initialMode={currentMode}
      />
    </>
  );
};

export default ContextMenuHeader;