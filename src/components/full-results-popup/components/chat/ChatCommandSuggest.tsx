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
  onCommandSelect: (command: Command, isFromSlashCommand?: boolean) => void;
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
      return nameMatch || keywordsMatch || false;
    }

    return true;
  };

  // Render individual command item with submenu support
  const renderCommand = (
    item: Command,
    { handleClick, modifiers }: any,
    query: string
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
        onClick={!hasSubmenu ? handleClick : undefined}
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
                    onCommandSelect(subCommand, isSlashMode);
                    onClose();
                  }}
                />
              );
            })}
          </>
        ) : null}
      </MenuItem>
    );
  };

  // Group commands by category
  const groupedItemRenderer = ({ items, query, renderItem }: any) => {
    const filteredItems = items.filter((item: Command) =>
      filterCommands(query, item)
    );

    if (!filteredItems.length) {
      return (
        <Menu>
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
      <Menu>
        {/* Render commands without category first */}
        {noCategory.map((cmd) =>
          renderCommand(
            cmd,
            {
              handleClick: () => {
                onCommandSelect(cmd, isSlashMode);
                onClose();
              },
              modifiers: { active: false, matchesPredicate: true },
            },
            query
          )
        )}

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
              {commands.map((cmd) =>
                renderCommand(
                  cmd,
                  {
                    handleClick: () => {
                      onCommandSelect(cmd, isSlashMode);
                      onClose();
                    },
                    modifiers: { active: false, matchesPredicate: true },
                  },
                  query
                )
              )}
            </React.Fragment>
          );
        })}
      </Menu>
    );
  };

  // In slash mode: render simple menu (no input to steal focus)
  // In button mode: render Suggest with search input
  if (isSlashMode) {
    const filteredItems = chatCompatibleCommands.filter((item) =>
      filterCommands(initialQuery, item)
    );

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

      return (
        <MenuItem
          key={item.id}
          text={item.name}
          onClick={
            !hasSubmenu
              ? () => {
                  onCommandSelect(item, true);
                  onClose();
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
                      onCommandSelect(subCommand, true);
                      onClose();
                    }}
                  />
                );
              })}
            </>
          ) : null}
        </MenuItem>
      );
    };

    return (
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
    );
  }

  // Button mode: use Suggest with search input
  return (
    <div className="chat-command-suggest-wrapper">
      <Suggest
        fill={true}
        items={chatCompatibleCommands}
        itemListRenderer={groupedItemRenderer}
        itemRenderer={(item, props) => renderCommand(item, props, "")}
        itemPredicate={filterCommands}
        scrollToActiveItem={true}
        onItemSelect={(item) => {
          onCommandSelect(item, false);
          onClose();
        }}
        inputProps={{
          className: "chat-command-suggest-input",
          placeholder: "Search commands...",
          inputRef: inputRef as any,
          leftElement: <Icon icon="search" />,
          autoFocus: true,
        }}
        popoverProps={{
          minimal: true,
          placement: "top-start",
          popoverClassName: "chat-command-suggest-popover",
          isOpen: true,
          onClose: onClose,
          portalClassName: "chat-command-suggest-portal",
        }}
        inputValueRenderer={(item) => item.name}
      />
    </div>
  );
};

export default ChatCommandSuggest;
