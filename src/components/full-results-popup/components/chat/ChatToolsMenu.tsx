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
} from "@blueprintjs/core";
import { CHAT_TOOLS } from "../../../../ai/agents/chat-agent/tools/chatToolsRegistry";
import {
  extractAllSkills,
  SkillInfo,
} from "../../../../ai/agents/chat-agent/tools/skillsUtils";

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

  // Load skills when menu opens and auto-enable new ones
  useEffect(() => {
    if (isOpen) {
      const loadedSkills = extractAllSkills();
      setSkills(loadedSkills);

      // Auto-enable new skills that aren't in the enabled set yet
      // (only if liveai_skills tool is enabled)
      if (enabledTools.has('liveai_skills')) {
        loadedSkills.forEach((skill) => {
          const skillKey = `skill:${skill.name}`;
          if (!enabledTools.has(skillKey)) {
            onToggleTool(skillKey); // Auto-enable new skill
          }
        });
      }
    }
  }, [isOpen, enabledTools, onToggleTool]);

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
  if (enabledCount === 0) {
    iconIntent = "none";
  } else if (enabledCount < totalCount) {
    iconIntent = "primary";
  } else {
    iconIntent = "success";
  }

  const iconName = "wrench";

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
        return (
          <MenuItem
            key={toolName}
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
