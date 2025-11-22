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
} from "@blueprintjs/core";
import { BUILTIN_COMMANDS } from "../../../../ai/prebuildCommands";
import { CATEGORY_ICON } from "../../../../ai/prebuildCommands";
import { getOrderedCustomPromptBlocks } from "../../../../ai/dataExtraction";
import ModelsMenu from "../../../ModelsMenu";

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
}

interface ChatCommandSuggestProps {
  onCommandSelect: (
    command: Command,
    isFromSlashCommand?: boolean,
    instantModel?: string
  ) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  onClose: () => void;
  initialQuery?: string; // For slash command mode
  isSlashMode?: boolean; // Whether opened via slash command
}

const ChatCommandSuggest: React.FC<ChatCommandSuggestProps> = ({
  onCommandSelect,
  inputRef,
  onClose,
  initialQuery = "",
  isSlashMode = false,
}) => {
  const [activeIndex, setActiveIndex] = React.useState(0);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Get all commands including custom prompts
  const allCommands = React.useMemo(() => {
    const customPrompts = getOrderedCustomPromptBlocks("liveai/prompt");
    const customCommands = customPrompts.map((custom, index) => ({
      id: 5000 + index,
      name: custom.content,
      prompt: custom.uid,
      category: "CUSTOM PROMPTS",
      icon: "user",
    }));

    return [...BUILTIN_COMMANDS, ...customCommands];
  }, []);

  // Filter commands to exclude chat-incompatible ones
  const chatCompatibleCommands = React.useMemo(() => {
    return allCommands.filter((cmd) => {
      // Exclude commands marked as incompatible with chat
      if (cmd.isIncompatibleWith?.chat === true) {
        return false;
      }
      // Exclude special commands that don't make sense in chat
      if (!cmd.category) {
        return false;
      }
      return true;
    });
  }, [allCommands]);

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
    { handleClick, modifiers, query }: any
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
                (cmd) => cmd.id === subId
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
        ) : item.name.includes("Image generation") ? (
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
      filterCommands(initialQuery, item)
    );
  }, [isSlashMode, chatCompatibleCommands, initialQuery]);

  const slashModeFlatItems = React.useMemo(() => {
    return slashModeFilteredItems.filter(
      (item) => !item.submenu || initialQuery
    );
  }, [slashModeFilteredItems, initialQuery]);

  // Reset active index when filtered items change
  React.useEffect(() => {
    if (!isSlashMode) return;
    if (activeIndex >= slashModeFlatItems.length) {
      setActiveIndex(Math.max(0, slashModeFlatItems.length - 1));
    }
  }, [slashModeFlatItems.length, activeIndex, isSlashMode]);

  // Handle keyboard navigation for slash mode
  React.useEffect(() => {
    if (!isSlashMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((prev) =>
          Math.min(prev + 1, slashModeFlatItems.length - 1)
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && slashModeFlatItems[activeIndex]) {
        e.preventDefault();
        e.stopPropagation();
        const selectedCommand = slashModeFlatItems[activeIndex];
        // Close menu first, then select command in next tick
        onClose();
        setTimeout(() => {
          onCommandSelect(selectedCommand, true);
        }, 0);
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
      filterCommands(query, item)
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
                  (cmd) => cmd.id === subId
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
