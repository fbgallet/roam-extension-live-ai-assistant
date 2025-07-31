import React from "react";
import { Dialog, Button, Classes, Icon, Checkbox } from "@blueprintjs/core";

const AskGraphModeDialog = ({ 
  isOpen, 
  onClose, 
  currentMode, 
  suggestedMode, 
  userQuery,
  onModeSelect 
}) => {
  const [rememberChoice, setRememberChoice] = React.useState(false);

  const handleModeSelect = (selectedMode) => {
    onModeSelect(selectedMode, rememberChoice);
    onClose();
  };

  const getModeIcon = (mode) => {
    switch (mode) {
      case "Private": return "lock";
      case "Balanced": return "shield";  
      case "Full Access": return "unlock";
      default: return "help";
    }
  };

  const getModeDescription = (mode) => {
    switch (mode) {
      case "Private": 
        return "Only UIDs returned with embed syntax. No content processing by AI.";
      case "Balanced": 
        return "Secure tools + final summary. Current behavior - good balance of privacy and utility.";
      case "Full Access": 
        return "Complete content access for in-depth analysis. Maximum functionality.";
      default: 
        return "";
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="🔒 Content Access Required"
      className="laia-askgraph-mode-dialog"
    >
      <div className={`${Classes.DIALOG_BODY} laia-askgraph-mode-dialog-body`}>
        <p className="laia-askgraph-user-query">
          <strong>Your question:</strong> "{userQuery}"
        </p>
        <p className="laia-askgraph-current-mode">
          To answer this question, I need access to block content. 
          You're currently in <strong>{currentMode}</strong> mode.
        </p>
        
        <div className="laia-askgraph-mode-options">
          <h4 className="laia-askgraph-mode-options-title">Choose how to proceed:</h4>
          
          <div className="laia-askgraph-mode-option">
            <Button
              intent="primary"
              large
              fill
              onClick={() => handleModeSelect(suggestedMode)}
              className="laia-askgraph-mode-button laia-askgraph-mode-button-recommended"
            >
              <Icon icon={getModeIcon(suggestedMode)} className="laia-askgraph-mode-icon" />
              <div className="laia-askgraph-mode-content">
                <div className="laia-askgraph-mode-title"><strong>Continue with {suggestedMode}</strong> (Recommended)</div>
                <div className="laia-askgraph-mode-description">
                  {getModeDescription(suggestedMode)}
                </div>
              </div>
            </Button>
          </div>

          <div className="laia-askgraph-mode-option">
            <Button
              large
              fill
              onClick={() => handleModeSelect(currentMode)}
              className="laia-askgraph-mode-button"
            >
              <Icon icon={getModeIcon(currentMode)} className="laia-askgraph-mode-icon" />
              <div className="laia-askgraph-mode-content">
                <div className="laia-askgraph-mode-title"><strong>Stay in {currentMode}</strong></div>
                <div className="laia-askgraph-mode-description">
                  {getModeDescription(currentMode)}
                </div>
              </div>
            </Button>
          </div>

          {currentMode !== "Full Access" && suggestedMode !== "Full Access" && (
            <div className="laia-askgraph-mode-option">
              <Button
                large
                fill
                onClick={() => handleModeSelect("Full Access")}
                className="laia-askgraph-mode-button"
              >
                <Icon icon="unlock" className="laia-askgraph-mode-icon" />
                <div className="laia-askgraph-mode-content">
                  <div className="laia-askgraph-mode-title"><strong>Use Full Access</strong></div>
                  <div className="laia-askgraph-mode-description">
                    {getModeDescription("Full Access")}
                  </div>
                </div>
              </Button>
            </div>
          )}
        </div>

        <Checkbox
          checked={rememberChoice}
          onChange={(e) => setRememberChoice(e.target.checked)}
          label="Remember my choice for this session"
          className="laia-askgraph-remember-checkbox"
        />
      </div>
    </Dialog>  
  );
};

export default AskGraphModeDialog;