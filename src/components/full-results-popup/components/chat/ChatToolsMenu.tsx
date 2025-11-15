/**
 * Chat Tools Menu Component
 *
 * Displays a popover menu with a list of available tools and skills
 * with toggles to enable/disable each one
 */

import React, { useState, useEffect } from "react";
import {
  Button,
  Menu,
  MenuItem,
  Popover,
  Switch,
  Divider,
  Tooltip,
  Icon,
  Collapse,
  Tag,
} from "@blueprintjs/core";
import { MultiSelect, ItemRenderer } from "@blueprintjs/select";
import { CHAT_TOOLS } from "../../../../ai/agents/chat-agent/tools/chatToolsRegistry";
import {
  extractAllSkills,
  SkillInfo,
} from "../../../../ai/agents/chat-agent/tools/skillsUtils";
import {
  loadDepot,
  getEnabledTopicIds,
  setEnabledTopicIds,
  MAX_ENABLED_TOPICS,
  type HelpTopic,
} from "../../../../ai/agents/chat-agent/tools/helpDepotUtils";
import "../../style/chatToolsMenu.css";
import { MINIMAL } from "@blueprintjs/core/lib/esm/common/classes";

interface ChatToolsMenuProps {
  enabledTools: Set<string>;
  onToggleTool: (toolName: string) => void;
  onToggleAll: (enable: boolean) => void;
  permissions: { contentAccess: boolean };
}

export const ChatToolsMenu: React.FC<ChatToolsMenuProps> = ({
  enabledTools,
  onToggleTool,
  onToggleAll,
  permissions,
}) => {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(
    new Set()
  );

  // Help topics state
  const [helpTopics, setHelpTopics] = useState<HelpTopic[]>([]);
  const [selectedHelpTopics, setSelectedHelpTopics] = useState<HelpTopic[]>([]);
  const [isHelpSectionExpanded, setIsHelpSectionExpanded] = useState(false);
  const [isRefreshingDepot, setIsRefreshingDepot] = useState(false);

  // Load skills when menu opens and auto-enable new ones
  useEffect(() => {
    if (isOpen) {
      const loadedSkills = extractAllSkills();
      setSkills(loadedSkills);

      // Auto-enable new skills that aren't in the enabled set yet
      // (only if live_ai_skills tool is enabled)
      if (enabledTools.has("live_ai_skills")) {
        loadedSkills.forEach((skill) => {
          const skillKey = `skill:${skill.name}`;
          if (!enabledTools.has(skillKey)) {
            onToggleTool(skillKey); // Auto-enable new skill
          }
        });
      }
    }
  }, [isOpen, enabledTools, onToggleTool]);

  // Load help topics when menu opens
  useEffect(() => {
    if (isOpen) {
      loadHelpTopics();
    }
  }, [isOpen]);

  // Load help topics from depot
  const loadHelpTopics = async () => {
    try {
      const depot = await loadDepot();
      setHelpTopics(depot.topics);

      // Load enabled topics from storage
      const enabledIds = getEnabledTopicIds();
      const enabled = depot.topics.filter((t) => enabledIds.includes(t.id));
      setSelectedHelpTopics(enabled);
    } catch (error) {
      console.error("Failed to load help depot:", error);
    }
  };

  // Refresh depot from GitHub
  const refreshHelpDepot = async () => {
    setIsRefreshingDepot(true);
    try {
      const depot = await loadDepot(true); // Force refresh
      setHelpTopics(depot.topics);

      // Reload selected topics
      const enabledIds = getEnabledTopicIds();
      const enabled = depot.topics.filter((t) => enabledIds.includes(t.id));
      setSelectedHelpTopics(enabled);
    } catch (error) {
      console.error("Failed to refresh help depot:", error);
    } finally {
      setIsRefreshingDepot(false);
    }
  };

  // Handle help topic selection
  const handleHelpTopicSelect = (topic: HelpTopic) => {
    const newSelected = [...selectedHelpTopics, topic];
    if (newSelected.length <= MAX_ENABLED_TOPICS) {
      setSelectedHelpTopics(newSelected);
      setEnabledTopicIds(newSelected.map((t) => t.id));
    }
  };

  // Handle help topic deselection
  const handleHelpTopicDeselect = (topic: HelpTopic) => {
    const newSelected = selectedHelpTopics.filter((t) => t.id !== topic.id);
    setSelectedHelpTopics(newSelected);
    setEnabledTopicIds(newSelected.map((t) => t.id));
  };

  // Clear all selected help topics
  const handleClearHelpTopics = () => {
    setSelectedHelpTopics([]);
    setEnabledTopicIds([]);
  };

  // Toggle description expansion
  const toggleDescription = (toolName: string) => {
    setExpandedDescriptions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(toolName)) {
        newSet.delete(toolName);
      } else {
        newSet.add(toolName);
      }
      return newSet;
    });
  };

  // Get available tools based on permissions
  const availableTools = Object.entries(CHAT_TOOLS).filter(([, info]) => {
    if (info.securityLevel === "secure") return true;
    if (info.securityLevel === "content" && permissions.contentAccess)
      return true;
    return false;
  });

  // Check if all tools are enabled
  const allToolsEnabled =
    availableTools.every(([name]) => enabledTools.has(name)) &&
    skills.every((skill) => enabledTools.has(`skill:${skill.name}`));

  // Count enabled tools (including skills)
  const enabledCount = enabledTools.size;
  const totalCount = availableTools.length + skills.length;

  // Determine icon intent based on enabled count
  // No intent (grey) if 0 enabled, primary (blue) if some enabled, success (green) if all enabled
  let iconIntent: "none" | "primary" | "success" = "none";
  const iconName = "wrench";
  if (enabledCount === 0) {
    iconIntent = "none";
  } else if (enabledCount < totalCount) {
    iconIntent = "primary";
  } else {
    iconIntent = "success";
  }

  const menu = (
    <Menu className="chat-tools-menu">
      <div className="chat-tools-menu-header">
        <strong>Available Tools</strong>
        <Button
          small
          minimal
          text={allToolsEnabled ? "Disable All" : "Enable All"}
          onClick={() => onToggleAll(!allToolsEnabled)}
        />
      </div>
      <Divider />

      {/* Regular Tools */}
      {availableTools.map(([toolName, toolInfo]) => {
        const isExpanded = expandedDescriptions.has(toolName);
        const isGetHelpTool = toolName === "get_help";
        const isAskYourGraph = toolName === "ask_your_graph";

        return (
          <React.Fragment key={toolName}>
            <MenuItem
              text={
                <div
                  className="chat-tool-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDescription(toolName);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <div className="chat-tool-name">
                    <Icon
                      icon={isExpanded ? "chevron-down" : "chevron-right"}
                      size={12}
                    />
                    <span style={{ marginLeft: "6px" }}>
                      {formatToolName(toolName)}
                    </span>
                    {isAskYourGraph && (
                      <Tooltip
                        content="Heavy operation: May take several seconds and use significant tokens"
                        hoverOpenDelay={300}
                      >
                        <Tag
                          minimal
                          intent="warning"
                          style={{ marginLeft: "8px", fontSize: "10px" }}
                        >
                          ⚡ Heavy
                        </Tag>
                      </Tooltip>
                    )}
                  </div>
                  <div
                    className={`chat-tool-description ${
                      isExpanded ? "expanded" : "collapsed"
                    }`}
                  >
                    {toolInfo.description}
                  </div>
                </div>
              }
              labelElement={
                <Switch
                  checked={enabledTools.has(toolName)}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleTool(toolName);
                  }}
                  style={{ marginBottom: 0 }}
                  onClick={(e) => e.stopPropagation()}
                />
              }
              shouldDismissPopover={false}
            />

            {/* Help Topics Configuration (only for get_help tool) */}
            {isGetHelpTool && enabledTools.has("get_help") && (
              <div className="help-topics-section">
                <div
                  className="help-topics-header"
                  onClick={() =>
                    setIsHelpSectionExpanded(!isHelpSectionExpanded)
                  }
                >
                  <div className="help-topics-header-left">
                    <Icon
                      icon={
                        isHelpSectionExpanded ? "chevron-down" : "chevron-right"
                      }
                      size={12}
                    />
                    <span>Help Topics</span>
                  </div>
                  <span className="help-topics-count">
                    {selectedHelpTopics.length}/{MAX_ENABLED_TOPICS} enabled
                  </span>
                </div>

                <Collapse isOpen={isHelpSectionExpanded}>
                  <div className="help-topics-collapsed">
                    <HelpTopicsMultiSelect
                      topics={helpTopics}
                      selectedTopics={selectedHelpTopics}
                      onSelect={handleHelpTopicSelect}
                      onDeselect={handleHelpTopicDeselect}
                      maxSelections={MAX_ENABLED_TOPICS}
                      isRefreshing={isRefreshingDepot}
                      onRefresh={refreshHelpDepot}
                      onClearAll={handleClearHelpTopics}
                    />
                  </div>
                </Collapse>
              </div>
            )}
          </React.Fragment>
        );
      })}

      {/* Skills Section */}
      {skills.length > 0 && (
        <>
          <Divider />
          <div className="chat-tools-menu-section-header">
            <strong>Skills</strong>
          </div>
          {skills.map((skill) => {
            const skillKey = `skill:${skill.name}`;
            const isExpanded = expandedDescriptions.has(skillKey);
            const isLiveaiSkillsEnabled = enabledTools.has("live_ai_skills");

            return (
              <MenuItem
                key={skillKey}
                text={
                  <div
                    className="chat-tool-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleDescription(skillKey);
                    }}
                    style={{
                      cursor: "pointer",
                      opacity: isLiveaiSkillsEnabled ? 1 : 0.5,
                    }}
                  >
                    <div className="chat-tool-name">
                      <Icon
                        icon={isExpanded ? "chevron-down" : "chevron-right"}
                        size={12}
                      />
                      <span style={{ marginLeft: "6px" }}>{skill.name}</span>
                    </div>
                    <div
                      className={`chat-tool-description ${
                        isExpanded ? "expanded" : "collapsed"
                      }`}
                    >
                      {skill.description}
                    </div>
                  </div>
                }
                labelElement={
                  <Switch
                    checked={enabledTools.has(skillKey)}
                    onChange={(e) => {
                      e.stopPropagation();
                      onToggleTool(skillKey);
                    }}
                    style={{ marginBottom: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    disabled={!isLiveaiSkillsEnabled}
                  />
                }
                shouldDismissPopover={false}
                disabled={!isLiveaiSkillsEnabled}
              />
            );
          })}
        </>
      )}
    </Menu>
  );

  return (
    <Tooltip
      content={`Agentic chat: ${enabledCount}/${totalCount} tools enabled`}
      placement="top"
    >
      <Popover
        content={menu}
        isOpen={isOpen}
        onInteraction={(nextOpenState) => setIsOpen(nextOpenState)}
        placement="top"
        minimal
      >
        <Button minimal small icon={iconName} intent={iconIntent} />
      </Popover>
    </Tooltip>
  );
};

/**
 * Format tool name for display (convert snake_case to Title Case)
 */
function formatToolName(name: string): string {
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Help Topics MultiSelect Component
 */
interface HelpTopicsMultiSelectProps {
  topics: HelpTopic[];
  selectedTopics: HelpTopic[];
  onSelect: (topic: HelpTopic) => void;
  onDeselect: (topic: HelpTopic) => void;
  maxSelections: number;
  isRefreshing: boolean;
  onRefresh: () => void;
  onClearAll: () => void;
}

const HelpTopicsMultiSelect: React.FC<HelpTopicsMultiSelectProps> = ({
  topics,
  selectedTopics,
  onSelect,
  onDeselect,
  maxSelections,
  isRefreshing,
  onRefresh,
  onClearAll,
}) => {
  const selectedIds = new Set(selectedTopics.map((t) => t.id));
  const isMaxReached = selectedTopics.length >= maxSelections;
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const isClickingRemoveButton = React.useRef(false);

  // Map category to tag intent
  const getCategoryIntent = (category: string) => {
    switch (category) {
      case "extension-liveai":
        return "primary";
      case "roam-core":
        return "success";
      case "roam-depot":
      case "extension-third-party":
        return "warning";
      case "workflows":
        return "none";
      case "integrations":
        return "none";
      default:
        return "none";
    }
  };

  const renderTopic: ItemRenderer<HelpTopic> = (
    topic,
    { handleClick, handleFocus, modifiers }
  ) => {
    if (!modifiers.matchesPredicate) {
      return null;
    }

    const isSelected = selectedIds.has(topic.id);
    const isDisabled = !isSelected && isMaxReached;

    return (
      <MenuItem
        key={topic.id}
        text={
          <div>
            <div style={{ fontSize: "13px", fontWeight: 500 }}>
              {topic.topic}
            </div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: "500px",
                color: "#5c7080",
                marginTop: "0px",
              }}
            >
              by {topic.author}
            </div>
            <div
              style={{
                fontSize: "10px",
                color: "#5c7080",
                marginTop: "1px",
                textWrap: "wrap",
              }}
            >
              {topic.shortDescription}
            </div>
          </div>
        }
        active={modifiers.active}
        disabled={isDisabled}
        onClick={handleClick}
        onFocus={handleFocus}
        icon={isSelected ? "tick" : "blank"}
        shouldDismissPopover={false}
        className="help-topics-multiselect-menu-item"
      />
    );
  };

  const filterTopic = (query: string, topic: HelpTopic) => {
    const normalizedQuery = query.toLowerCase();
    return (
      topic.topic.toLowerCase().includes(normalizedQuery) ||
      topic.author.toLowerCase().includes(normalizedQuery) ||
      topic.shortDescription.toLowerCase().includes(normalizedQuery) ||
      topic.category.toLowerCase().includes(normalizedQuery)
    );
  };

  const handleItemSelect = (topic: HelpTopic) => {
    if (selectedIds.has(topic.id)) {
      onDeselect(topic);
    } else if (selectedTopics.length < maxSelections) {
      onSelect(topic);
    }
  };

  const renderTag = (topic: HelpTopic) => topic.topic;

  return (
    <div
      className="help-topics-multiselect-container"
      onMouseDown={(e) => {
        // Prevent clicks on tag remove buttons from opening the popover
        const target = e.target as HTMLElement;
        const isRemoveButton =
          target.closest(".bp3-tag-remove") ||
          target.classList.contains("bp3-tag-remove");

        if (isRemoveButton) {
          isClickingRemoveButton.current = true;
          setTimeout(() => {
            isClickingRemoveButton.current = false;
          }, 100);
        }
      }}
    >
      <div className="help-topics-multiselect-wrapper">
        <MultiSelect<HelpTopic>
          items={topics}
          selectedItems={selectedTopics}
          itemRenderer={renderTopic}
          itemPredicate={filterTopic}
          tagRenderer={renderTag}
          onItemSelect={handleItemSelect}
          tagInputProps={{
            onRemove: (_tag, index) => {
              onDeselect(selectedTopics[index]);
            },
            tagProps: (_value, index) => ({
              className: "help-topics-tag",
              minimal: true,
              intent: getCategoryIntent(selectedTopics[index]?.category || ""),
            }),
            placeholder: "Search or select help topics...",
            rightElement: (
              <div
                style={{ display: "flex", alignItems: "center", gap: "4px" }}
              >
                <Tag minimal intent={isMaxReached ? "warning" : "none"}>
                  {selectedTopics.length}/{maxSelections}
                </Tag>
                <Tooltip content="Refresh topics from GitHub" position="top">
                  <Button
                    minimal
                    icon="refresh"
                    loading={isRefreshing}
                    onClick={onRefresh}
                    style={{ minWidth: "16px", minHeight: "16px" }}
                  />
                </Tooltip>
                {selectedTopics.length > 0 && (
                  <Tooltip content="Clear all selections" position="top">
                    <Button
                      minimal
                      icon="cross"
                      onClick={onClearAll}
                      style={{ minWidth: "16px", minHeight: "16px" }}
                    />
                  </Tooltip>
                )}
              </div>
            ),
          }}
          popoverProps={{
            className: "help-topics-multiselect-wrapper",
            minimal: true,
            isOpen: isPopoverOpen,
            onInteraction: (nextOpenState) => {
              // Don't open if clicking remove button
              if (nextOpenState && isClickingRemoveButton.current) {
                return;
              }
              setIsPopoverOpen(nextOpenState);
            },
          }}
          fill
        />
      </div>
    </div>
  );
};
