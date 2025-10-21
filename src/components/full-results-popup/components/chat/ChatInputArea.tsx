/**
 * Chat Input Area Component
 *
 * Renders the chat input controls including access mode selector, model selector, and text input
 */

import React, { useState } from "react";
import { Button, HTMLSelect, Popover, TextArea, Switch } from "@blueprintjs/core";
import ModelsMenu from "../../../ModelsMenu";
import { ChatMode } from "../../types/types";

interface ChatInputAreaProps {
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSubmit: () => void;
  isTyping: boolean;
  chatAccessMode: "Balanced" | "Full Access";
  onAccessModeChange: (mode: "Balanced" | "Full Access") => void;
  chatMode: ChatMode;
  onChatModeChange: (mode: ChatMode) => void;
  selectedModel: string;
  onModelSelect: (model: string) => void;
  chatInputRef: React.RefObject<HTMLTextAreaElement>;
}

export const ChatInputArea: React.FC<ChatInputAreaProps> = ({
  chatInput,
  onChatInputChange,
  onSubmit,
  isTyping,
  chatAccessMode,
  onAccessModeChange,
  chatMode,
  onChatModeChange,
  selectedModel,
  onModelSelect,
  chatInputRef,
}) => {
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);

  const handleModelSelection = async ({ model }: { model: string }) => {
    // Model was changed via ModelsMenu callback
    // Update the model in parent component
    onModelSelect(model);
    setIsModelMenuOpen(false);
  };

  return (
    <div className="full-results-chat-input-area">
      <div className="full-results-chat-controls">
        <div className="full-results-chat-access-mode">
          <HTMLSelect
            minimal={true}
            value={chatAccessMode}
            onChange={(e) =>
              onAccessModeChange(e.target.value as "Balanced" | "Full Access")
            }
            options={[
              { label: "🛡️ Balanced", value: "Balanced" },
              { label: "🔓 Full Access", value: "Full Access" },
            ]}
          />
        </div>
        <div className="full-results-chat-agentic-mode">
          <Switch
            checked={chatMode === "agent"}
            onChange={(e) => onChatModeChange(e.currentTarget.checked ? "agent" : "simple")}
            label="Agentic"
            style={{ marginBottom: 0 }}
          />
        </div>
        <div className="full-results-chat-model-selector">
          <Popover
            isOpen={isModelMenuOpen}
            onInteraction={(nextOpenState) =>
              setIsModelMenuOpen(nextOpenState)
            }
            content={
              <ModelsMenu
                callback={handleModelSelection}
                setModel={onModelSelect}
                command={null}
                prompt=""
                isConversationToContinue={false}
              />
            }
            placement="top"
          >
            <Button
              minimal
              small
              icon="cog"
              text={selectedModel}
              title="Click to change AI model"
            />
          </Popover>
        </div>
      </div>

      {/* Future evolution: Chat Mode vs Deep Analysis - currently hidden
      <div className="full-results-chat-mode-toggle" style={{display: 'none'}}>
        <label>
          <input
            type="radio"
            name="chatMode"
            value="simple"
            checked={true}
            readOnly
          />
          <Icon icon="chat" size={12} style={{marginRight: '4px'}} />Chat Mode (Focus on provided results)
        </label>
        <label>
          <input
            type="radio"
            name="chatMode"
            value="agent"
            checked={false}
            disabled
          />
          <Icon icon="search" size={12} style={{marginRight: '4px'}} />Deep Analysis (Can explore with search tools)
        </label>
      </div>
      */}

      <div className="full-results-chat-input-container">
        <TextArea
          inputRef={chatInputRef}
          placeholder="Ask me about your results..."
          value={chatInput}
          onChange={(e) => onChatInputChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && onSubmit()}
          disabled={isTyping}
          className="full-results-chat-input"
          autoResize={true}
          // rows={1}
          fill={true}
        />
        <Button
          icon="send-message"
          onClick={onSubmit}
          disabled={!chatInput.trim() || isTyping}
          intent="primary"
          className="full-results-chat-send"
        />
      </div>
    </div>
  );
};
