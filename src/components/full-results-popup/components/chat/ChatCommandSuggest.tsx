/**
 * Chat Command Suggest Component
 *
 * Displays a filtered list of commands available for the chat interface
 * Based on CommandSuggest.jsx but adapted for chat context
 */

import React from "react";
import { Suggest } from "@blueprintjs/select";
import {
  Icon,
  MenuItem,
  Menu,
  MenuDivider,
  InputGroup,
  Tag,
} from "@blueprintjs/core";
import { BUILTIN_COMMANDS } from "../../../../ai/prebuildCommands";
import { CATEGORY_ICON } from "../../../../ai/prebuildCommands";
import { getOrderedCustomPromptBlocks } from "../../../../ai/dataExtraction";
import ModelsMenu from "../../../ModelsMenu";
import {
  getProviderModels,
  isModelVisible,
  isModelFavorited,
  getOrderedProviders,
  formatContextLength,
  getModelMetadata,
  getModelCapabilities,
} from "../../../../utils/modelConfigHelpers";

interface Command {
  id: number;
  name: string;
  prompt?: string;
  category?: string;
  icon?: string;
  keyWords?: string;
  isSub?: boolean;
  submenu?: number[];
  isIncompatibleWith?: {
    outliner?: boolean;
    chat?: boolean;
    completion?: boolean;
    style?: boolean;
    specificStyles?: string[];
  };
  callback?: Function;
  showOnlyIfAudioInBlock?: boolean;
  // Model command properties
  isModelCommand?: boolean;
  modelProvider?: string;
  modelContextLength?: number;
  isFavorite?: boolean;
}

interface ChatCommandSuggestProps {
  onCommandSelect: (
    command: Command,
    isFromSlashCommand?: boolean,
    instantModel?: string,
  ) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  onClose: () => void;
  initialQuery?: string; // For slash command mode
  isSlashMode?: boolean; // Whether opened via slash command
  currentPrompt?: string; // Current chat input for audio detection
  selectedModel?: string; // Currently selected model (for visual indicator)
  onModelSwitch?: (model: string) => void; // Callback for model switching
  chatSlashCommands?: any[]; // Chat-specific slash commands
  onChatCommand?: (commandId: string) => void; // Callback for chat-specific commands
}

const ChatCommandSuggest: React.FC<ChatCommandSuggestProps> = ({
  onCommandSelect,
  inputRef,
  onClose,
  initialQuery = "",
  isSlashMode = false,
  currentPrompt = "",
  selectedModel = "",
  onModelSwitch,
  chatSlashCommands = [],
  onChatCommand,
}) => {
  const [activeIndex, setActiveIndex] = React.useState(0);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Check if there's audio in the current prompt
  const hasAudioInPrompt = React.useMemo(() => {
    if (!currentPrompt) return false;
    // Check for Roam audio syntax: {{[[audio]]: url}}
    const roamAudioRegex = /\{\{\[\[audio\]\]:\s*https?:[^\s}]+\}\}/gi;
    return roamAudioRegex.test(currentPrompt);
  }, [currentPrompt]);

  // Generate model commands from visible models
  const modelCommands = React.useMemo(() => {
    const commands: Command[] = [];
    const orderedProviders = getOrderedProviders();
    const allProviders = [
      "OpenAI",
      "Anthropic",
      "Google",
      "DeepSeek",
      "Grok",
      "OpenRouter",
      "Groq",
      "Ollama",
    ];

    // Helper to get prefix for model ID
    const getPrefix = (provider: string) => {
      switch (provider) {
        case "OpenRouter":
          return "openRouter/";
        case "Groq":
          return "groq/";
        case "Ollama":
          return "ollama/";
        default:
          return "";
      }
    };

    // Use ordered providers, then add any missing ones
    const providersToProcess = [...orderedProviders];
    allProviders.forEach((p) => {
      if (!providersToProcess.includes(p)) {
        providersToProcess.push(p);
      }
    });

    let modelIndex = 0;
    providersToProcess.forEach((provider) => {
      const models = getProviderModels(provider);

      models.forEach((model) => {
        // Skip hidden models and image generation models
        if (!isModelVisible(model.id)) return;
        const capabilities = getModelCapabilities(model.id);
        if (capabilities.includes("image")) return;

        const prefix = getPrefix(provider);
        const fullModelId = prefix + model.id;
        const metadata = getModelMetadata(model.id);

        commands.push({
          id: 9000 + modelIndex,
          name: model.name || model.id,
          prompt: fullModelId, // Store full model ID for switching
          category: "SWITCH MODEL",
          icon: "cycle", // contrast
          keyWords: `${provider.toLowerCase()} ${model.id} model switch`,
          isModelCommand: true,
          modelProvider: provider,
          modelContextLength: metadata?.contextLength,
          isFavorite: isModelFavorited(model.id),
        } as Command);
        modelIndex++;
      });
    });

    return commands;
  }, []);

  // Get all commands including custom prompts and model commands
  const allCommands = React.useMemo(() => {
    const customPrompts = getOrderedCustomPromptBlocks("liveai/prompt");
    const customCommands = customPrompts.map((custom, index) => ({
      id: 5000 + index,
      name: custom.content,
      prompt: custom.uid,
      category: "CUSTOM PROMPTS",
      icon: "user",
    }));

    return [
      ...chatSlashCommands,
      ...BUILTIN_COMMANDS,
      ...customCommands,
      ...modelCommands,
    ];
  }, [modelCommands, chatSlashCommands]);

  // Filter commands to exclude chat-incompatible ones
  const chatCompatibleCommands = React.useMemo(() => {
    return allCommands.filter((cmd) => {
      // Exclude commands marked as incompatible with chat
      if (cmd.isIncompatibleWith?.chat === true) {
        return false;
      }
      // Filter out "Audio transcription" command if no audio in prompt
      if (cmd.showOnlyIfAudioInBlock && !hasAudioInPrompt) {
        return false;
      }
      // Exclude special commands that don't have category (except conditionally shown commands)
      if (
        !cmd.category &&
        !cmd.showOnlyIfAudioInBlock &&
        cmd.name !== "Web search"
      ) {
        return false;
      }
      return true;
    });
  }, [allCommands, hasAudioInPrompt]);

  // Filter function for search
  const filterCommands = (query: string, item: Command): boolean => {
    // When no query, hide sub-items (they'll be shown as submenus)
    if (!query && item.isSub) {
      return false;
    }

    // When there's a query, search in all commands
    if (query) {
      const normalizedQuery = query.toLowerCase();
      const nameMatch = item.name.toLowerCase().includes(normalizedQuery);
      const keywordsMatch = item.keyWords
        ?.toLowerCase()
        .includes(normalizedQuery);
      const categoryMatch = item.category
        ?.toLowerCase()
        .includes(normalizedQuery);
      return nameMatch || keywordsMatch || categoryMatch || false;
    }

    return true;
  };

  // Render individual command item with submenu support
  const renderCommand = (
    item: Command,
    { handleClick, modifiers, query }: any,
  ) => {
    if (!modifiers.matchesPredicate) {
      return null;
    }

    // Check if this command has submenus and we should show them (no query)
    const hasSubmenu = item.submenu && item.submenu.length > 0 && !query;

    return (
      <MenuItem
        key={item.id}
        text={item.name}
        active={modifiers.active}
        onClick={handleClick}
        icon={item.icon as any}
      >
        {hasSubmenu ? (
          <>
            {item.submenu!.map((subId) => {
              const subCommand = chatCompatibleCommands.find(
                (cmd) => cmd.id === subId,
              );
              if (!subCommand || query) return null;

              return (
                <MenuItem
                  key={subCommand.id}
                  text={subCommand.name}
                  icon={subCommand.icon as any}
                  onClick={() => {
                    onCommandSelect(subCommand, isSlashMode);
                    onClose();
                  }}
                />
              );
            })}
          </>
        ) : item.name.includes("Image generation") ||
          item.name === "Web search" ? (
          <>
            <ModelsMenu
              callback={({ command, model }) => {
                onCommandSelect(command, false, model);
              }}
              command={item}
              prompt={undefined}
              setModel={undefined}
              isConversationToContinue={undefined}
            />
          </>
        ) : null}
      </MenuItem>
    );
  };

  // Prepare filtered items for slash mode (computed early for hooks)
  const slashModeFilteredItems = React.useMemo(() => {
    if (!isSlashMode) return [];
    return chatCompatibleCommands.filter((item) =>
      filterCommands(initialQuery, item),
    );
  }, [isSlashMode, chatCompatibleCommands, initialQuery]);

  const slashModeFlatItems = React.useMemo(() => {
    return slashModeFilteredItems.filter(
      (item) => !item.submenu || initialQuery,
    );
  }, [slashModeFilteredItems, initialQuery]);

  // Reset active index when query changes or filtered items change
  React.useEffect(() => {
    if (!isSlashMode) return;
    // Reset to 0 when query changes to start from top of filtered list
    setActiveIndex(0);
  }, [initialQuery, isSlashMode]);

  // Also adjust if current index is out of bounds
  React.useEffect(() => {
    if (!isSlashMode) return;
    if (
      activeIndex >= slashModeFlatItems.length &&
      slashModeFlatItems.length > 0
    ) {
      setActiveIndex(slashModeFlatItems.length - 1);
    }
  }, [slashModeFlatItems.length, activeIndex, isSlashMode]);

  // Handle keyboard navigation for slash mode
  React.useEffect(() => {
    if (!isSlashMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+J/N (next) and Ctrl+K/P (prev) override browser shortcuts
      // (e.g. Ctrl+N=new window, Ctrl+P=print) while the command suggest popup is open
      const isCtrlOnly = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
      const normalizedKey = isCtrlOnly ? e.key.toLowerCase() : "";
      const isVimNext =
        isCtrlOnly && (normalizedKey === "j" || normalizedKey === "n");
      const isVimPrev =
        isCtrlOnly && (normalizedKey === "k" || normalizedKey === "p");

      if (e.key === "ArrowDown" || isVimNext) {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((prev) =>
          Math.min(prev + 1, slashModeFlatItems.length - 1),
        );
      } else if (e.key === "ArrowUp" || isVimPrev) {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && slashModeFlatItems[activeIndex]) {
        e.preventDefault();
        e.stopPropagation();
        const selectedCommand = slashModeFlatItems[activeIndex];
        // Handle model commands specially - just switch model, don't run command
        // Note: onModelSwitch callback handles closing and clearing slash state
        if (
          selectedCommand.isModelCommand &&
          onModelSwitch &&
          selectedCommand.prompt
        ) {
          onModelSwitch(selectedCommand.prompt!);
        } else {
          // Close menu first, then select command in next tick
          onClose();
          setTimeout(() => {
            onCommandSelect(selectedCommand, true);
          }, 0);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [activeIndex, slashModeFlatItems, onCommandSelect, isSlashMode, onClose]);

  // Group commands by category
  const groupedItemRenderer = ({
    items,
    query,
    renderItem,
    itemsParentRef,
  }: any) => {
    const filteredItems = items.filter((item: Command) =>
      filterCommands(query, item),
    );

    if (!filteredItems.length) {
      return (
        <Menu ulRef={itemsParentRef}>
          <MenuItem disabled={true} text="No matching commands found" />
        </Menu>
      );
    }

    // Group by category
    const grouped: Record<string, Command[]> = {};
    const noCategory: Command[] = [];

    filteredItems.forEach((item: Command) => {
      if (!item.category) {
        noCategory.push(item);
      } else {
        if (!grouped[item.category]) {
          grouped[item.category] = [];
        }
        grouped[item.category].push(item);
      }
    });

    return (
      <Menu ulRef={itemsParentRef}>
        {/* Render commands without category first */}
        {noCategory.map((cmd) => renderItem(cmd, noCategory.indexOf(cmd)))}

        {/* Render categorized commands */}
        {Object.entries(grouped).map(([category, commands]) => {
          const categoryIcon =
            CATEGORY_ICON[category as keyof typeof CATEGORY_ICON] || "chat";

          return (
            <React.Fragment key={category}>
              <MenuDivider
                title={
                  <>
                    <Icon icon={categoryIcon as any} /> {category}
                  </>
                }
              />
              {commands.map((cmd) => {
                const globalIndex = filteredItems.indexOf(cmd);
                return renderItem(cmd, globalIndex);
              })}
            </React.Fragment>
          );
        })}
      </Menu>
    );
  };

  // In slash mode: render simple menu (no input to steal focus)
  // In button mode: render Suggest with search input
  if (isSlashMode) {
    // Use pre-computed values from top-level hooks
    const filteredItems = slashModeFilteredItems;
    const flatItems = slashModeFlatItems;

    // Group by category
    const grouped: Record<string, Command[]> = {};
    const noCategory: Command[] = [];

    filteredItems.forEach((item) => {
      if (!item.category) {
        noCategory.push(item);
      } else {
        if (!grouped[item.category]) {
          grouped[item.category] = [];
        }
        grouped[item.category].push(item);
      }
    });

    const renderSimpleCommand = (item: Command) => {
      const hasSubmenu =
        item.submenu && item.submenu.length > 0 && !initialQuery;
      const itemIndex = flatItems.indexOf(item);
      const isActive = itemIndex === activeIndex && !hasSubmenu;

      // Handle model commands specially
      if (item.isModelCommand) {
        const isCurrentModel = selectedModel === item.prompt;
        return (
          <MenuItem
            key={item.id}
            text={item.name}
            active={isActive}
            icon={
              isCurrentModel ? "tick" : item.isFavorite ? "star" : undefined
            }
            onClick={() => {
              // Note: onModelSwitch callback handles closing and clearing slash state
              if (onModelSwitch && item.prompt) {
                onModelSwitch(item.prompt!);
              }
            }}
            labelElement={
              item.modelContextLength ? (
                <Tag minimal>
                  {formatContextLength(item.modelContextLength)}
                </Tag>
              ) : null
            }
          />
        );
      }

      return (
        <MenuItem
          key={item.id}
          text={item.name}
          active={isActive}
          onClick={
            !hasSubmenu
              ? () => {
                  const cmd = item;
                  onClose();
                  setTimeout(() => {
                    onCommandSelect(cmd, true);
                  }, 0);
                }
              : undefined
          }
          icon={item.icon as any}
        >
          {hasSubmenu ? (
            <>
              {item.submenu!.map((subId) => {
                const subCommand = chatCompatibleCommands.find(
                  (cmd) => cmd.id === subId,
                );
                if (!subCommand) return null;

                return (
                  <MenuItem
                    key={subCommand.id}
                    text={subCommand.name}
                    icon={subCommand.icon as any}
                    onClick={() => {
                      const cmd = subCommand;
                      onClose();
                      setTimeout(() => {
                        onCommandSelect(cmd, true);
                      }, 0);
                    }}
                  />
                );
              })}
            </>
          ) : item.name.includes("Image generation") ? (
            <>
              <ModelsMenu
                callback={({ command, model }) => {
                  onClose();
                  setTimeout(() => {
                    onCommandSelect(command, true, model);
                  }, 0);
                }}
                command={item}
                prompt={undefined}
                setModel={undefined}
                isConversationToContinue={undefined}
              />
            </>
          ) : null}
        </MenuItem>
      );
    };

    return (
      <div ref={menuRef}>
        <Menu className="chat-command-suggest-menu slash-mode">
          {!filteredItems.length && (
            <MenuItem disabled={true} text="No matching commands found" />
          )}

          {/* Render commands without category first */}
          {noCategory.map((cmd) => renderSimpleCommand(cmd))}

          {/* Render categorized commands */}
          {Object.entries(grouped).map(([category, commands]) => {
            const categoryIcon =
              CATEGORY_ICON[category as keyof typeof CATEGORY_ICON] || "dot";

            return (
              <React.Fragment key={category}>
                <MenuDivider
                  title={
                    <>
                      <Icon icon={categoryIcon as any} /> {category}
                    </>
                  }
                />
                {commands.map((cmd) => renderSimpleCommand(cmd))}
              </React.Fragment>
            );
          })}
        </Menu>
      </div>
    );
  }

  // Button mode: use Suggest with search input
  return (
    <div className="chat-command-suggest-wrapper">
      <Suggest
        fill={true}
        items={chatCompatibleCommands}
        itemListRenderer={groupedItemRenderer}
        itemRenderer={(item, props) => {
          return renderCommand(item, {
            ...props,
          });
        }}
        itemPredicate={filterCommands}
        scrollToActiveItem={true}
        onItemSelect={(item, props) => {
          onCommandSelect(item, false);
          onClose();
        }}
        inputProps={{
          className: "chat-command-suggest-input",
          placeholder: "Search commands...",
          inputRef: inputRef as any,
          leftElement: <Icon icon="search" />,
          autoFocus: true,
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            // Prevent event from bubbling up to parent components
            if (
              e.key === "ArrowDown" ||
              e.key === "ArrowUp" ||
              e.key === "Enter"
            ) {
              e.stopPropagation();
            }
          },
        }}
        popoverProps={{
          placement: "top-start",
          popoverClassName: "chat-command-suggest-popover",
          isOpen: true,
          onClose: onClose,
          portalClassName: "chat-command-suggest-portal",
          enforceFocus: false,
        }}
        inputValueRenderer={(item) => item.name}
      />
    </div>
  );
};

export default ChatCommandSuggest;
