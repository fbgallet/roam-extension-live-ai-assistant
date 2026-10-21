import React, { useState, useEffect } from "react";
import { Icon, Tooltip, MenuDivider } from "@blueprintjs/core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faComments } from "@fortawesome/free-solid-svg-icons";
import { displayModelConfigDialog } from "../../../utils/domElts";
import { MCPDiagnostics } from "../../../ai/agents/mcp-agent/mcpDiagnostics";
import AskGraphModeIndicator from "../../AskGraphModeIndicator";
import AskGraphFirstTimeDialog from "../../AskGraphFirstTimeDialog";
import {
  getCurrentAskGraphMode,
  setSessionAskGraphMode,
} from "../../../ai/agents/search-agent/ask-your-graph";
import ThinkingControls from "./ThinkingControls";
import ActiveModelSelector from "./ActiveModelSelector";
import { inlineChatAutoMode, setInlineChatAutoMode } from "../../../index";

const ContextMenuHeader = ({
  activeModel,
  setIsHelpOpen,
  setIsOpen,
  setIsMCPConfigOpen,
  updateUserCommands,
  updateCustomStyles,
  updateLiveOutlines,
  updateTemplates,
  handleClose,
  inputRef,
  thinkingEnabled,
  setThinkingEnabled,
  reasoningEffort,
  setReasoningEffort,
}) => {
  const [currentMode, setCurrentMode] = useState(() =>
    getCurrentAskGraphMode()
  );
  const [isAskGraphDialogOpen, setIsAskGraphDialogOpen] = useState(false);
  const [isAutoChat, setIsAutoChat] = useState(() => !!inlineChatAutoMode);

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
                displayModelConfigDialog({}, "usage-tokens");
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
            content={
              <p>
                Inline chat auto mode: <b>{isAutoChat ? "ON" : "OFF"}</b>
                <br />
                Hint after <code>Enter</code> at the end of your turn in a
                conversation in blocks, next turn created after each response.
                <br />
                Click to turn {isAutoChat ? "off" : "on"}
              </p>
            }
            disabled={window.roamAlphaAPI.platform.isMobile}
            hoverOpenDelay={600}
            openOnTargetFocus={false}
            style={{ zIndex: "9999" }}
          >
            {/* same icon as the inline chat button, not the Chat panel's one */}
            <span
              onClick={(e) => {
                e.stopPropagation();
                setInlineChatAutoMode(!isAutoChat);
                setIsAutoChat(!isAutoChat);
                inputRef.current?.focus();
              }}
              // laid out like Blueprint's <Icon>: inline-block span, block svg
              style={{
                display: "inline-block",
                lineHeight: 0,
                transform: "translateY(3px)",
                cursor: "pointer",
                color: isAutoChat ? "#137cbd" : undefined,
                opacity: isAutoChat ? 1 : 0.45,
              }}
            >
              <FontAwesomeIcon
                icon={faComments}
                style={{ display: "block", height: 12, width: "auto" }}
              />
            </span>
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
            }}
          >
            <ActiveModelSelector
              activeModel={activeModel}
              inputRef={inputRef}
            />
            <ThinkingControls
              model={activeModel}
              thinkingEnabled={thinkingEnabled}
              setThinkingEnabled={setThinkingEnabled}
              reasoningEffort={reasoningEffort}
              setReasoningEffort={setReasoningEffort}
              inputRef={inputRef}
            />
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
