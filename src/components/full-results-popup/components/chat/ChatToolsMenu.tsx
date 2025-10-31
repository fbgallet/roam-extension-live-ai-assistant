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
      // (only if liveai_skills tool is enabled)
      if (enabledTools.has("liveai_skills")) {
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
              <div
                style={{
                  padding: "8px 12px",
                  backgroundColor: "#f5f5f5",
                  borderLeft: "3px solid #137cbd",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "8px",
                    cursor: "pointer",
                  }}
                  onClick={() =>
                    setIsHelpSectionExpanded(!isHelpSectionExpanded)
                  }
                >
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <Icon
                      icon={
                        isHelpSectionExpanded ? "chevron-down" : "chevron-right"
                      }
                      size={12}
                    />
                    <span
                      style={{ marginLeft: "6px", fontSize: "12px", fontWeight: 500 }}
                    >
                      Help Topics
                    </span>
                  </div>
                  <span style={{ fontSize: "11px", color: "#666" }}>
                    {selectedHelpTopics.length}/{MAX_ENABLED_TOPICS} enabled
                  </span>
                </div>

                <Collapse isOpen={isHelpSectionExpanded}>
                  <div style={{ marginTop: "8px" }}>
                    <div
                      style={{
                        display: "flex",
                        gap: "4px",
                        marginBottom: "8px",
                      }}
                    >
                      <Button
                        small
                        minimal
                        icon="refresh"
                        text="Refresh"
                        loading={isRefreshingDepot}
                        onClick={refreshHelpDepot}
                      />
                      {selectedHelpTopics.length > 0 && (
                        <Button
                          small
                          minimal
                          icon="cross"
                          text="Clear"
                          onClick={handleClearHelpTopics}
                        />
                      )}
                    </div>

                    <HelpTopicsMultiSelect
                      topics={helpTopics}
                      selectedTopics={selectedHelpTopics}
                      onSelect={handleHelpTopicSelect}
                      onDeselect={handleHelpTopicDeselect}
                      maxSelections={MAX_ENABLED_TOPICS}
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
}

const HelpTopicsMultiSelect: React.FC<HelpTopicsMultiSelectProps> = ({
  topics,
  selectedTopics,
  onSelect,
  onDeselect,
  maxSelections,
}) => {
  const selectedIds = new Set(selectedTopics.map((t) => t.id));
  const isMaxReached = selectedTopics.length >= maxSelections;

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
            <div style={{ fontWeight: 500 }}>{topic.topic}</div>
            <div style={{ fontSize: "11px", color: "#666", marginTop: "2px" }}>
              by {topic.author}
            </div>
            <div style={{ fontSize: "10px", color: "#999", marginTop: "2px" }}>
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
        placeholder:
          selectedTopics.length === 0
            ? "Select help topics..."
            : `${selectedTopics.length}/${maxSelections} selected`,
        rightElement:
          isMaxReached ? (
            <Tag minimal intent="warning">
              Max
            </Tag>
          ) : undefined,
      }}
      popoverProps={{
        minimal: true,
        fill: true,
      }}
      fill
    />
  );
};
