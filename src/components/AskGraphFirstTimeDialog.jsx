import React from "react";
import {
  Dialog,
  Button,
  Classes,
  Icon,
  RadioGroup,
  Radio,
} from "@blueprintjs/core";

const AskGraphFirstTimeDialog = ({ isOpen, onClose, onModeSelect }) => {
  const [selectedMode, setSelectedMode] = React.useState("Balanced");

  const handleProceed = () => {
    onModeSelect(selectedMode);
    onClose();
  };

  const getModeDescription = (mode) => {
    switch (mode) {
      case "Private":
        return {
          title: "🔒 Private (Maximum Privacy)",
          description:
            "Only page names and block UIDs are processed. Results shown as ((uid)) references - you see the content, but AI doesn't process it.",
          pros: "• Maximum privacy protection\n• Fast execution\n• Minimal token usage",
          cons: "• No AI summaries or insights\n• Limited analysis capabilities",
        };
      case "Balanced":
        return {
          title: "⚖️ Balanced (Recommended)",
          description:
            "AI uses secure tools for searching, then processes final results for summaries and insights. Good balance of privacy and functionality.",
          pros: "• Moderate privacy protection\n• AI summaries and analysis\n• Reasonable token usage",
          cons: "• Final results processed by AI\n• Slightly higher token usage",
        };
      case "Full Access":
        return {
          title: "🔓 Full Access (Maximum Functionality)",
          description:
            "AI has complete access to your content for in-depth analysis, comparisons, and comprehensive insights.",
          pros: "• Maximum functionality\n• Deep content analysis\n• Comprehensive insights",
          cons: "• Full content exposure to AI\n• Higher token usage\n• Slower execution",
        };
      default:
        return { title: "", description: "", pros: "", cons: "" };
    }
  };

  const currentModeInfo = getModeDescription(selectedMode);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="🤖 First time using Ask Your Graph"
      className="laia-askgraph-firsttime-dialog"
      canEscapeKeyClose={false}
      canOutsideClickClose={false}
    >
      <div className={`${Classes.DIALOG_BODY} laia-askgraph-firsttime-dialog-body`}>
        <p className="laia-askgraph-firsttime-intro">
          <strong>Ask Your Graph</strong> Agent lets you search and analyze your
          Roam database using natural language. Choose your default privacy
          mode:
        </p>

        <div className="laia-askgraph-firsttime-radio-group">
          <RadioGroup
            onChange={(e) => setSelectedMode(e.currentTarget.value)}
            selectedValue={selectedMode}
            className="laia-askgraph-firsttime-radio-options"
          >
            <Radio label="🔒 Private" value="Private" className="laia-askgraph-firsttime-radio" />
            <Radio label="⚖️ Balanced (Recommended)" value="Balanced" className="laia-askgraph-firsttime-radio" />
            <Radio label="🔓 Full Access" value="Full Access" className="laia-askgraph-firsttime-radio" />
          </RadioGroup>
        </div>

        <div className="laia-askgraph-firsttime-mode-details">
          <h4 className="laia-askgraph-firsttime-mode-title">{currentModeInfo.title}</h4>
          <p className="laia-askgraph-firsttime-mode-description">{currentModeInfo.description}</p>

          <div className="laia-askgraph-firsttime-pros-cons">
            <div className="laia-askgraph-firsttime-pros">
              <strong className="laia-askgraph-firsttime-pros-title">✓ Pros:</strong>
              <pre className="laia-askgraph-firsttime-pros-content">
                {currentModeInfo.pros}
              </pre>
            </div>
            <div className="laia-askgraph-firsttime-cons">
              <strong className="laia-askgraph-firsttime-cons-title">⚠ Considerations:</strong>
              <pre className="laia-askgraph-firsttime-cons-content">
                {currentModeInfo.cons}
              </pre>
            </div>
          </div>
        </div>

        <div className="laia-askgraph-firsttime-note">
          <Icon icon="info-sign" className="laia-askgraph-firsttime-note-icon" />
          <span>
            <strong>Note:</strong> You can change this setting anytime in
            extension settings, and the system will ask permission before
            escalating during conversations.
          </span>
        </div>

        <div className="laia-askgraph-firsttime-privacy">
          <Icon icon="shield" className="laia-askgraph-firsttime-privacy-icon" />
          <span>
            <strong>Privacy:</strong> Your "exclusion strings" setting will always
            be respected - blocks containing private tags are never processed
            regardless of mode.
          </span>
        </div>
      </div>

      <div className={`${Classes.DIALOG_FOOTER} laia-askgraph-firsttime-dialog-footer`}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button intent="primary" onClick={handleProceed} large className="laia-askgraph-firsttime-proceed-button">
            Set {selectedMode} as Default
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default AskGraphFirstTimeDialog;
