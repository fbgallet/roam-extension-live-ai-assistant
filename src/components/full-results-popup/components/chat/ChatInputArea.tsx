/**
 * Chat Input Area Component
 *
 * Renders the chat input controls including access mode selector, model selector, and text input
 */

import React, { useState, useRef, useEffect } from "react";
import {
  Button,
  Popover,
  Tooltip,
  Menu,
  MenuItem,
  Switch,
} from "@blueprintjs/core";
import {
  faMicrophone,
  faWandMagicSparkles,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import ModelsMenu from "../../../ModelsMenu";
import { ChatMode } from "../../types/types";
import ChatCommandSuggest from "./ChatCommandSuggest";
import ChatPageAutocomplete from "./ChatPageAutocomplete";
import { ChatToolsMenu } from "./ChatToolsMenu";
import { BUILTIN_COMMANDS } from "../../../../ai/prebuildCommands";
import { BUILTIN_STYLES } from "../../../../ai/styleConstants";

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
  availablePages: string[];
  isLoadingPages: boolean;
  onQueryPages: (query: string) => void;
  enabledTools: Set<string>;
  onToggleTool: (toolName: string) => void;
  onToggleAllTools: (enable: boolean) => void;
  selectedStyle?: string;
  onStyleChange?: (style: string) => void;
  customStyleTitles?: string[];
  isPinnedStyle?: boolean;
  onPinnedStyleChange?: (isPinned: boolean) => void;
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
  availablePages,
  isLoadingPages,
  onQueryPages,
  enabledTools,
  onToggleTool,
  onToggleAllTools,
  selectedStyle = "Normal",
  onStyleChange,
  customStyleTitles = [],
  isPinnedStyle = false,
  onPinnedStyleChange,
}) => {
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isCommandSuggestOpen, setIsCommandSuggestOpen] = useState(false);
  const [slashCommandMode, setSlashCommandMode] = useState(false);
  const [isPageAutocompleteOpen, setIsPageAutocompleteOpen] = useState(false);
  const [pageAutocompleteQuery, setPageAutocompleteQuery] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceRecorderAvailable, setIsVoiceRecorderAvailable] =
    useState(false);
  const [isAccessModeMenuOpen, setIsAccessModeMenuOpen] = useState(false);
  const [isStyleMenuOpen, setIsStyleMenuOpen] = useState(false);
  const commandSuggestInputRef = useRef<HTMLInputElement>(null);

  const allStyles = [...BUILTIN_STYLES, ...customStyleTitles];

  // Track if component is mounted to prevent setState on unmounted component
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  const handlePageSelect = (pageTitle: string) => {
    // Find the [[ position and replace the incomplete link with completed one
    const lastDoubleBracketIndex = chatInput.lastIndexOf("[[");
    if (lastDoubleBracketIndex !== -1) {
      const beforeBrackets = chatInput.substring(0, lastDoubleBracketIndex);
      const newValue = `${beforeBrackets}[[${pageTitle}]]`;
      onChatInputChange(newValue);

      // Close autocomplete
      setIsPageAutocompleteOpen(false);
      setPageAutocompleteQuery("");

      // Maintain focus on textarea
      setTimeout(() => {
        if (chatInputRef.current) {
          chatInputRef.current.focus();
          // Move cursor to end
          chatInputRef.current.selectionStart = newValue.length;
          chatInputRef.current.selectionEnd = newValue.length;
        }
      }, 0);
    }
  };

  // Detect slash command trigger
  const handleInputChange = (value: string) => {
    // Update parent state first
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
        // Close if user added space after slash, but maintain focus
        setSlashCommandMode(false);
        setIsCommandSuggestOpen(false);
        // Maintain focus on the textarea
        setTimeout(() => {
          if (chatInputRef.current) {
            chatInputRef.current.focus();
          }
        }, 0);
      }
    } else if (slashCommandMode && !hasSlash) {
      // Close if slash was removed
      setSlashCommandMode(false);
      setIsCommandSuggestOpen(false);
    }

    // Detect [[ for page autocomplete
    const lastDoubleBracketIndex = value.lastIndexOf("[[");
    const hasDoubleBracket = lastDoubleBracketIndex !== -1;

    if (hasDoubleBracket) {
      // Extract the part after the last "[["
      const afterBrackets = value.substring(lastDoubleBracketIndex + 2);
      const hasClosingBracket = afterBrackets.includes("]]");
      const hasSpace = afterBrackets.startsWith(" ");

      // Only open if there's at least one character and no space immediately after [[
      if (!hasClosingBracket && !hasSpace && afterBrackets.length > 0) {
        if (!isPageAutocompleteOpen) {
          setIsPageAutocompleteOpen(true);
        }
        // Update query and fetch pages
        setPageAutocompleteQuery(afterBrackets);
        onQueryPages(afterBrackets);
      } else if (
        isPageAutocompleteOpen &&
        (hasClosingBracket || hasSpace || afterBrackets.length === 0)
      ) {
        // Close if user completed the link or added space or removed all text
        setIsPageAutocompleteOpen(false);
        setPageAutocompleteQuery("");
      }
    } else if (isPageAutocompleteOpen && !hasDoubleBracket) {
      // Close if [[ was removed
      setIsPageAutocompleteOpen(false);
      setPageAutocompleteQuery("");
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

  // Monitor recording state and VoiceRecorder availability
  useEffect(() => {
    const checkRecordingState = () => {
      const recordButton = document.querySelector(".speech-record-button");

      // Check if VoiceRecorder is mounted and not disabled
      const isMicrophoneSlashPresent =
        document.querySelector('svg[data-icon="microphone-slash"]') !== null;
      const isAvailable = recordButton !== null && !isMicrophoneSlashPresent;

      setIsVoiceRecorderAvailable(isAvailable);

      if (recordButton && isAvailable) {
        const isListening =
          recordButton.querySelector('svg[data-icon="record-vinyl"]') !== null;
        setIsRecording(isListening);
      } else {
        setIsRecording(false);
      }
    };

    // Check immediately
    checkRecordingState();

    // Poll for changes (VoiceRecorder updates its DOM)
    const interval = setInterval(checkRecordingState, 100);

    return () => clearInterval(interval);
  }, []);

  // Expose the onChatInputChange callback to VoiceRecorder via a global reference
  useEffect(() => {
    (window as any).__chatInputChangeHandler = onChatInputChange;
    (window as any).__chatInputRef = chatInputRef;

    return () => {
      delete (window as any).__chatInputChangeHandler;
      delete (window as any).__chatInputRef;
    };
  }, [onChatInputChange, chatInputRef]);

  // Handle microphone button click - trigger VoiceRecorder
  const handleMicClick = () => {
    const recordButton = document.querySelector(
      ".speech-record-button"
    ) as HTMLElement;
    if (recordButton) {
      recordButton.click();
    }
  };

  // Handle transcribe click during recording
  const handleTranscribeClick = () => {
    const transcribeButton = document.querySelector(
      ".speech-transcribe"
    ) as HTMLElement;
    if (transcribeButton) {
      // Mark that we're in chat mode for VoiceRecorder to detect
      document.body.setAttribute("data-chat-transcribe-active", "true");
      transcribeButton.click();
    }
  };

  return (
    <div className="full-results-chat-input-area">
      <div className="full-results-chat-controls">
        <Tooltip
          content={`Access Mode: ${chatAccessMode}`}
          openOnTargetFocus={false}
        >
          <div className="full-results-chat-access-mode">
            <Popover
              isOpen={isAccessModeMenuOpen}
              onInteraction={(nextOpenState) =>
                setIsAccessModeMenuOpen(nextOpenState)
              }
              content={
                <Menu>
                  <MenuItem
                    text="🛡️ Balanced"
                    active={chatAccessMode === "Balanced"}
                    onClick={() => {
                      onAccessModeChange("Balanced");
                      setIsAccessModeMenuOpen(false);
                    }}
                  />
                  <MenuItem
                    text="🔓 Full Access"
                    active={chatAccessMode === "Full Access"}
                    onClick={() => {
                      onAccessModeChange("Full Access");
                      setIsAccessModeMenuOpen(false);
                    }}
                  />
                </Menu>
              }
              placement="top"
            >
              <Button
                minimal
                small
                text={chatAccessMode === "Balanced" ? "🛡️" : "🔓"}
              />
            </Popover>
          </div>
        </Tooltip>
        <div className="full-results-chat-tools-menu">
          <ChatToolsMenu
            enabledTools={enabledTools}
            onToggleTool={onToggleTool}
            onToggleAll={onToggleAllTools}
            permissions={{ contentAccess: chatAccessMode === "Full Access" }}
          />
        </div>
        <Tooltip content={`Style: ${selectedStyle}`} openOnTargetFocus={false}>
          <div className="full-results-chat-style-selector">
            <Popover
              isOpen={isStyleMenuOpen}
              onInteraction={(nextOpenState, event) => {
                // Don't close when clicking on the pin switch or its label
                const target = event?.target as HTMLElement;
                const isClickOnSwitch = target?.closest('.bp3-switch') !== null;

                if (!isClickOnSwitch) {
                  setIsStyleMenuOpen(nextOpenState);
                }
              }}
              content={
                <Menu>
                  <div style={{ padding: "8px 8px 4px 8px" }}>
                    <Switch
                      label="Pin style for session"
                      checked={isPinnedStyle}
                      onChange={(e) => {
                        if (onPinnedStyleChange) {
                          onPinnedStyleChange(e.currentTarget.checked);
                        }
                      }}
                      style={{ marginBottom: 0 }}
                    />
                  </div>
                  {allStyles.map((style) => (
                    <MenuItem
                      key={style}
                      text={style}
                      active={selectedStyle === style}
                      onClick={() => {
                        if (onStyleChange) {
                          onStyleChange(style);
                        }
                        if (!isPinnedStyle) {
                          setIsStyleMenuOpen(false);
                        }
                      }}
                    />
                  ))}
                </Menu>
              }
              placement="top"
            >
              <Button
                minimal
                small
                icon="style"
                intent={isPinnedStyle ? "primary" : "none"}
              />
            </Popover>
          </div>
        </Tooltip>
        <Tooltip
          // autoFocus={false}
          openOnTargetFocus={false}
          content={
            <p>
              Apply built-in or custom prompt
              <br />
              - on user input below or, if none,
              <br />
              - on selected context or, if none,
              <br />- on conversation history
            </p>
          }
        >
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
                icon="rocket"
                onClick={() => {
                  if (!slashCommandMode) {
                    setIsCommandSuggestOpen(true);
                  }
                }}
              >
                Prompts
              </Button>
            </Popover>
          </div>
        </Tooltip>
        <Tooltip openOnTargetFocus={false} content="Switch AI model">
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
              <Button minimal small icon="cog" text={selectedModel} />
            </Popover>
          </div>
        </Tooltip>
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
        {isVoiceRecorderAvailable && (
          <Tooltip
            content={
              isRecording
                ? "Click to transcribe voice to text"
                : "Click to start voice recording"
            }
            hoverOpenDelay={500}
          >
            <Button
              minimal
              small
              className="full-results-chat-mic-button"
              onClick={isRecording ? handleTranscribeClick : handleMicClick}
              disabled={isTyping}
            >
              {isRecording ? (
                <FontAwesomeIcon icon={faWandMagicSparkles} />
              ) : (
                <FontAwesomeIcon icon={faMicrophone} />
              )}
            </Button>
          </Tooltip>
        )}
        <Popover
          minimal={true}
          isOpen={isPageAutocompleteOpen}
          onInteraction={(nextOpenState) => {
            // Don't close via interaction - only close when conditions are met
            if (!nextOpenState) {
              setIsPageAutocompleteOpen(false);
              setPageAutocompleteQuery("");
            }
          }}
          content={
            <ChatPageAutocomplete
              pages={availablePages}
              onPageSelect={handlePageSelect}
              isLoading={isLoadingPages}
              query={pageAutocompleteQuery}
            />
          }
          placement="top-start"
          enforceFocus={false}
          autoFocus={false}
          canEscapeKeyClose={true}
          targetTagName="div"
          fill={true}
        >
          <textarea
            ref={chatInputRef}
            placeholder="Ask me about your results... (type / for commands, [[ for pages)"
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
        </Popover>
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
