/**
 * Chat Input Area Component
 *
 * Renders the chat input controls including access mode selector, model selector, and text input
 */

import React, { useState, useRef, useEffect } from "react";
import { Button, HTMLSelect, Popover, Switch } from "@blueprintjs/core";
import ModelsMenu from "../../../ModelsMenu";
import { ChatMode } from "../../types/types";
import ChatCommandSuggest from "./ChatCommandSuggest";
import { BUILTIN_COMMANDS } from "../../../../ai/prebuildCommands";

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
  onCommandSelect: (command: any, isFromSlashCommand?: boolean) => void;
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
  onCommandSelect,
}) => {
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isCommandSuggestOpen, setIsCommandSuggestOpen] = useState(false);
  const [slashCommandMode, setSlashCommandMode] = useState(false);
  const commandSuggestInputRef = useRef<HTMLInputElement>(null);

  const handleModelSelection = async ({ model }: { model: string }) => {
    // Model was changed via ModelsMenu callback
    // Update the model in parent component
    onModelSelect(model);
    setIsModelMenuOpen(false);
  };

  const handleCommandSelect = (command: any, fromSlash: boolean = false) => {
    onCommandSelect(command, fromSlash);
    setIsCommandSuggestOpen(false);
    setSlashCommandMode(false);
  };

  // Detect slash command trigger
  const handleInputChange = (value: string) => {
    onChatInputChange(value);

    // Find the last "/" in the input
    const lastSlashIndex = value.lastIndexOf("/");
    const hasSlash = lastSlashIndex !== -1;

    if (hasSlash) {
      // Extract the part after the last "/"
      const afterSlash = value.substring(lastSlashIndex + 1);
      const hasSpaceAfterSlash = afterSlash.includes(" ");

      if (!hasSpaceAfterSlash && !isCommandSuggestOpen) {
        // Open command suggest in slash mode
        setSlashCommandMode(true);
        setIsCommandSuggestOpen(true);
      } else if (slashCommandMode && hasSpaceAfterSlash) {
        // Close if user added space after slash
        setSlashCommandMode(false);
        setIsCommandSuggestOpen(false);
      }
    } else if (slashCommandMode && !hasSlash) {
      // Close if slash was removed
      setSlashCommandMode(false);
      setIsCommandSuggestOpen(false);
    }
  };

  // Get slash query (text after the last "/")
  const getSlashQuery = () => {
    if (slashCommandMode) {
      const lastSlashIndex = chatInput.lastIndexOf("/");
      if (lastSlashIndex !== -1) {
        return chatInput.substring(lastSlashIndex + 1); // Text after the last "/"
      }
    }
    return "";
  };

  // Find first matching command for slash mode
  const findMatchingCommand = (query: string) => {
    if (!query) return null;

    const normalizedQuery = query.toLowerCase();

    // Filter chat-compatible commands
    const compatibleCommands = BUILTIN_COMMANDS.filter((cmd) => {
      if (cmd.isIncompatibleWith?.chat === true) return false;
      if (
        cmd.id === 0 ||
        cmd.id === 1 ||
        cmd.id === 2 ||
        cmd.id === 100 ||
        cmd.id === 102
      )
        return false;
      if (!query && cmd.isSub) return false; // Hide sub-items when no query
      return true;
    });

    // Find first matching command
    return compatibleCommands.find((cmd) => {
      const nameMatch = cmd.name.toLowerCase().includes(normalizedQuery);
      const keywordsMatch = cmd.keyWords
        ?.toLowerCase()
        .includes(normalizedQuery);
      return nameMatch || keywordsMatch;
    });
  };

  // Auto-resize textarea when content changes externally (e.g., cleared after submit)
  useEffect(() => {
    if (chatInputRef.current) {
      chatInputRef.current.style.height = "auto";
      chatInputRef.current.style.height =
        chatInputRef.current.scrollHeight + "px";
    }
  }, [chatInput, chatInputRef]);

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
            onChange={(e) =>
              onChatModeChange(e.currentTarget.checked ? "agent" : "simple")
            }
            label="Agentic"
            style={{ marginBottom: 0 }}
          />
        </div>
        <div className="full-results-chat-command-suggest">
          <Popover
            minimal={true}
            isOpen={isCommandSuggestOpen}
            onInteraction={(nextOpenState) => {
              // Don't close in slash mode via interaction
              if (!slashCommandMode) {
                setIsCommandSuggestOpen(nextOpenState);
              }
            }}
            content={
              <ChatCommandSuggest
                onCommandSelect={handleCommandSelect}
                inputRef={commandSuggestInputRef}
                onClose={() => {
                  setIsCommandSuggestOpen(false);
                  setSlashCommandMode(false);
                }}
                initialQuery={getSlashQuery()}
                isSlashMode={slashCommandMode}
              />
            }
            placement="top"
            enforceFocus={false}
            autoFocus={false}
            canEscapeKeyClose={slashCommandMode}
          >
            <Button
              minimal
              small
              icon="lightbulb"
              title="Browse available commands"
              onClick={() => {
                if (!slashCommandMode) {
                  setIsCommandSuggestOpen(true);
                }
              }}
            />
          </Popover>
        </div>
        <div className="full-results-chat-model-selector">
          <Popover
            isOpen={isModelMenuOpen}
            onInteraction={(nextOpenState) => setIsModelMenuOpen(nextOpenState)}
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
        <textarea
          ref={chatInputRef}
          placeholder="Ask me about your results... (type / for commands)"
          value={chatInput}
          onChange={(e) => {
            handleInputChange(e.target.value);
            // Auto-resize textarea
            e.target.style.height = "auto";
            e.target.style.height = e.target.scrollHeight + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();

              // In slash mode, execute the first matching command
              if (slashCommandMode) {
                const query = getSlashQuery();
                const matchingCommand = findMatchingCommand(query);

                if (matchingCommand) {
                  // Clear the slash command from input
                  onChatInputChange("");
                  handleCommandSelect(matchingCommand, true); // true = from slash command
                } else {
                  // No matching command, close slash mode and treat as normal input
                  setSlashCommandMode(false);
                  setIsCommandSuggestOpen(false);
                }
              } else {
                // Normal submit
                onSubmit();
              }
            } else if (e.key === "Escape" && slashCommandMode) {
              // Close slash mode on Escape
              e.preventDefault();
              setSlashCommandMode(false);
              setIsCommandSuggestOpen(false);
            }
          }}
          disabled={isTyping}
          className="full-results-chat-input bp3-input"
          rows={1}
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
