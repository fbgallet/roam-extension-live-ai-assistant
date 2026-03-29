/**
 * Chat Tools Menu Component
 *
 * Displays a popover menu with a list of available tools and skills
 * with toggles to enable/disable each one
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Alert,
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
  ProgressBar,
  Spinner,
} from "@blueprintjs/core";
import { MultiSelect, ItemRenderer } from "@blueprintjs/select";
import {
  CHAT_TOOLS,
  EDIT_SECTION_KEY,
} from "../../../../ai/agents/chat-agent/tools/chatToolsRegistry";
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
import {
  getVectorStoreInfo as getVSInfo,
  uploadFile as vsUploadFile,
  deleteDatabase as vsDeleteDatabase,
  createDatabase as vsCreateDatabase,
  toggleDatabase as vsToggleDatabase,
  renameDatabase as vsRenameDatabase,
  listDatabases as vsListDatabases,
  getDefaultDatabaseId as vsGetDefaultDatabaseId,
  setDefaultDatabase as vsSetDefaultDatabase,
} from "../../../../ai/vectorStore/vectorStoreService";
import type { VectorDatabase } from "../../../../ai/vectorStore/types";
import {
  indexRoamGraph as vsIndexRoamGraph,
  indexRoamExport as vsIndexRoamExport,
  isRoamJsonExport as vsIsRoamJsonExport,
} from "../../../../ai/vectorStore/fileConverter";
// @ts-ignore - JS module
import { OPENAI_API_KEY } from "../../../../index";
import "../../style/chatToolsMenu.css";

interface ChatToolsMenuProps {
  enabledTools: Set<string>;
  onToggleTool: (toolName: string) => void;
  isAgentMode: boolean;
  onToggleAgentMode: (enabled: boolean) => void;
  permissions: { contentAccess: boolean };
}

export const ChatToolsMenu: React.FC<ChatToolsMenuProps> = ({
  enabledTools,
  onToggleTool,
  isAgentMode,
  onToggleAgentMode,
  permissions,
}) => {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const autoEnabledSkills = useRef<Set<string>>(new Set());
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(
    new Set(),
  );

  // Help topics state
  const [helpTopics, setHelpTopics] = useState<HelpTopic[]>([]);
  const [selectedHelpTopics, setSelectedHelpTopics] = useState<HelpTopic[]>([]);
  const [isHelpSectionExpanded, setIsHelpSectionExpanded] = useState(false);
  const [isRefreshingDepot, setIsRefreshingDepot] = useState(false);

  // Section expansion state
  const [isEditSectionExpanded, setIsEditSectionExpanded] = useState(false);
  const [isSkillsSectionExpanded, setIsSkillsSectionExpanded] = useState(false);

  // Vector Store state
  const [isVectorStoreSectionExpanded, setIsVectorStoreSectionExpanded] =
    useState(false);
  const [vectorStoreInfo, setVectorStoreInfo] = useState<{
    isConfigured: boolean;
    databaseCount: number;
    enabledCount: number;
    roamPageCount: number;
    uploadedFileCount: number;
  }>({
    isConfigured: false,
    databaseCount: 0,
    enabledCount: 0,
    roamPageCount: 0,
    uploadedFileCount: 0,
  });
  const [databases, setDatabases] = useState<VectorDatabase[]>([]);
  const [defaultDbId, setDefaultDbId] = useState<string | undefined>();
  const [vectorStoreStatus, setVectorStoreStatus] = useState<
    "idle" | "indexing" | "uploading" | "deleting" | "creating"
  >("idle");
  const [vectorStoreProgress, setVectorStoreProgress] = useState("");
  const [vectorStoreProgressRatio, setVectorStoreProgressRatio] = useState(0);
  const [activeDatabaseId, setActiveDatabaseId] = useState<
    string | undefined
  >();
  const [newDbName, setNewDbName] = useState("");
  const [renamingDbId, setRenamingDbId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Vector search settings (persisted on window for tool access)
  const [vsMaxResults, setVsMaxResults] = useState<number>(
    () => (window as any).vectorSearchSettings?.maxResults ?? 10,
  );
  const [vsThreshold, setVsThreshold] = useState<number>(
    () => (window as any).vectorSearchSettings?.threshold ?? 0,
  );

  // Sync settings to window whenever they change
  useEffect(() => {
    (window as any).vectorSearchSettings = {
      maxResults: vsMaxResults,
      threshold: vsThreshold,
    };
  }, [vsMaxResults, vsThreshold]);

  // Index confirmation dialog state
  const [isIndexAlertOpen, setIsIndexAlertOpen] = useState(false);
  const [pendingIndexDbId, setPendingIndexDbId] = useState<
    string | undefined
  >();

  // Load vector store info when menu opens
  useEffect(() => {
    if (isOpen) {
      loadVectorStoreInfo();
    }
  }, [isOpen]);

  const loadVectorStoreInfo = () => {
    try {
      setVectorStoreInfo(getVSInfo());
      setDatabases(vsListDatabases());
      setDefaultDbId(vsGetDefaultDatabaseId());
    } catch {
      // Service not available yet
    }
  };

  const handleCreateDatabase = useCallback(async () => {
    const name = newDbName.trim();
    if (!name) return;
    setVectorStoreStatus("creating");
    setVectorStoreProgress(`Creating "${name}"...`);
    try {
      await vsCreateDatabase(name);
      setNewDbName("");
      setVectorStoreProgress("");
      loadVectorStoreInfo();
    } catch (e: any) {
      setVectorStoreProgress(`Error: ${e.message}`);
    } finally {
      setVectorStoreStatus("idle");
    }
  }, [newDbName]);

  const handleToggleDatabase = useCallback(async (dbId: string) => {
    try {
      await vsToggleDatabase(dbId);
      loadVectorStoreInfo();
    } catch (e: any) {
      setVectorStoreProgress(`Error: ${e.message}`);
    }
  }, []);

  const handleDeleteDatabase = useCallback(
    async (dbId: string, dbName: string) => {
      if (!confirm(`Delete database "${dbName}"? This cannot be undone.`))
        return;
      setVectorStoreStatus("deleting");
      setVectorStoreProgress(`Deleting "${dbName}"...`);
      try {
        await vsDeleteDatabase(dbId);
        setVectorStoreProgress("");
        loadVectorStoreInfo();
      } catch (e: any) {
        setVectorStoreProgress(`Error: ${e.message}`);
      } finally {
        setVectorStoreStatus("idle");
      }
    },
    [],
  );

  const handleSetDefault = useCallback(async (dbId: string) => {
    try {
      await vsSetDefaultDatabase(dbId);
      setDefaultDbId(dbId);
    } catch (e: any) {
      setVectorStoreProgress(`Error: ${e.message}`);
    }
  }, []);

  const handleRenameDatabase = useCallback(
    async (dbId: string) => {
      const name = renameValue.trim();
      if (!name) return;
      try {
        await vsRenameDatabase(dbId, name);
        setRenamingDbId(null);
        setRenameValue("");
        loadVectorStoreInfo();
      } catch (e: any) {
        setVectorStoreProgress(`Error: ${e.message}`);
      }
    },
    [renameValue],
  );

  const confirmAndIndexRoamGraph = useCallback((databaseId?: string) => {
    setPendingIndexDbId(databaseId);
    setIsIndexAlertOpen(true);
  }, []);

  const handleIndexRoamGraph = useCallback(async (databaseId?: string) => {
    setVectorStoreStatus("indexing");
    setVectorStoreProgress("Querying pages...");
    setVectorStoreProgressRatio(0);
    try {
      await vsIndexRoamGraph((progress) => {
        const ratio =
          progress.total > 0 ? progress.processed / progress.total : 0;
        setVectorStoreProgressRatio(ratio);
        if (progress.phase === "done") {
          setVectorStoreProgress(
            `Done: ${progress.newPages} new, ${progress.updatedPages} updated, ${progress.deletedPages} deleted, ${progress.unchangedPages} unchanged`,
          );
        } else {
          setVectorStoreProgress(
            `${progress.phase}: ${progress.processed}/${progress.total}${progress.currentPage ? ` — ${progress.currentPage}` : ""}`,
          );
        }
      }, databaseId);
      loadVectorStoreInfo();
    } catch (e: any) {
      setVectorStoreProgress(`Error: ${e.message}`);
    } finally {
      setVectorStoreStatus("idle");
    }
  }, []);

  const handleUploadFiles = useCallback(
    async (files: FileList, databaseId?: string) => {
      setVectorStoreStatus("uploading");
      setVectorStoreProgress(`Uploading ${files.length} file(s)...`);
      setVectorStoreProgressRatio(0);
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setVectorStoreProgress(
            `Processing ${file.name} (${i + 1}/${files.length})...`,
          );
          setVectorStoreProgressRatio(i / files.length);

          if (file.name.endsWith(".msgpack")) {
            await vsIndexRoamExport(
              file,
              (progress) => {
                const ratio =
                  progress.total > 0 ? progress.processed / progress.total : 0;
                setVectorStoreProgressRatio((i + ratio) / files.length);
                setVectorStoreProgress(
                  `${file.name}: ${progress.phase} ${progress.processed}/${progress.total}`,
                );
              },
              databaseId,
            );
          } else if (
            file.name.endsWith(".json") &&
            (await vsIsRoamJsonExport(file))
          ) {
            await vsIndexRoamExport(
              file,
              (progress) => {
                const ratio =
                  progress.total > 0 ? progress.processed / progress.total : 0;
                setVectorStoreProgressRatio((i + ratio) / files.length);
                setVectorStoreProgress(
                  `${file.name}: ${progress.phase} ${progress.processed}/${progress.total}`,
                );
              },
              databaseId,
            );
          } else {
            const blob = new Blob([await file.arrayBuffer()], {
              type: file.type,
            });
            await vsUploadFile(blob, file.name, "user-upload", databaseId);
          }
        }

        setVectorStoreProgress(`Done: ${files.length} file(s) processed`);
        loadVectorStoreInfo();
      } catch (e: any) {
        setVectorStoreProgress(`Error: ${e.message}`);
      } finally {
        setVectorStoreStatus("idle");
      }
    },
    [],
  );

  // Load skills when menu opens and auto-enable new ones
  useEffect(() => {
    if (isOpen) {
      const loadedSkills = extractAllSkills();
      setSkills(loadedSkills);

      // Auto-enable skills that have never been seen before
      // (only if live_ai_skills tool is enabled)
      // We track which skills we've already auto-enabled to avoid
      // re-enabling skills that the user has manually disabled
      if (enabledTools.has("live_ai_skills")) {
        loadedSkills.forEach((skill) => {
          const skillKey = `skill:${skill.name}`;
          if (!autoEnabledSkills.current.has(skillKey)) {
            autoEnabledSkills.current.add(skillKey);
            if (!enabledTools.has(skillKey)) {
              onToggleTool(skillKey); // Auto-enable new skill
            }
          }
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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

  // Categorize tools
  const contextTools = availableTools.filter(
    ([, info]) => info.category === "context",
  );
  const editTools = availableTools.filter(
    ([, info]) => info.category === "edit",
  );
  const interactionTools = availableTools.filter(
    ([, info]) => info.category === "interaction",
  );
  const skillsToolEntry = availableTools.find(
    ([, info]) => info.category === "skills",
  );

  // Edit section master switch - uses a special key in enabledTools
  // This acts as a gate - when off, no edit tools work even if individually enabled
  const isEditSectionEnabled = enabledTools.has(EDIT_SECTION_KEY);

  // Check if skills section is enabled
  const isSkillsSectionEnabled = enabledTools.has("live_ai_skills");

  // Count enabled tools (including skills)
  const enabledCount = enabledTools.size;
  const totalCount = availableTools.length + skills.length;

  // Determine icon intent based on agent mode
  // No intent (grey) if agent mode off, primary (blue) if on with some tools, success (green) if on with all tools
  let iconIntent: "none" | "primary" | "success" = "none";
  const iconName = "wrench";
  if (!isAgentMode) {
    iconIntent = "none";
  } else if (enabledCount < totalCount) {
    iconIntent = "primary";
  } else {
    iconIntent = "success";
  }

  // Render a tool item
  const renderToolItem = (
    toolName: string,
    toolInfo: (typeof CHAT_TOOLS)[string],
    disabled = false,
  ) => {
    const isExpanded = expandedDescriptions.has(toolName);
    const isGetHelpTool = toolName === "get_help";
    const isAskYourGraph = toolName === "ask_your_graph";
    const isVectorSearch = toolName === "vector_search";
    const needsOpenAIKey = isVectorSearch && !OPENAI_API_KEY;
    const isDisabled = disabled || needsOpenAIKey;

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
              style={{ cursor: "pointer", opacity: isDisabled ? 0.5 : 1 }}
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
                      Heavy
                    </Tag>
                  </Tooltip>
                )}
                {needsOpenAIKey && (
                  <Tooltip
                    content="Requires an OpenAI API key (set in extension settings)"
                    hoverOpenDelay={300}
                  >
                    <Tag
                      minimal
                      intent="danger"
                      style={{ marginLeft: "8px", fontSize: "10px" }}
                    >
                      No API key
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
              disabled={isDisabled}
            />
          }
          shouldDismissPopover={false}
          disabled={isDisabled}
        />

        {/* Help Topics Configuration (only for get_help tool) */}
        {isGetHelpTool && enabledTools.has("get_help") && (
          <div className="help-topics-section">
            <div
              className="help-topics-header"
              onClick={() => setIsHelpSectionExpanded(!isHelpSectionExpanded)}
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

        {/* Vector Store Manager (only for vector_search tool) */}
        {isVectorSearch && enabledTools.has("vector_search") && (
          <div className="vector-store-section">
            <div
              className="vector-store-header"
              onClick={() =>
                setIsVectorStoreSectionExpanded(!isVectorStoreSectionExpanded)
              }
            >
              <div className="vector-store-header-left">
                <Icon
                  icon={
                    isVectorStoreSectionExpanded
                      ? "chevron-down"
                      : "chevron-right"
                  }
                  size={12}
                />
                <span>Vector Databases</span>
              </div>
              <span className="vector-store-status-tag">
                {vectorStoreInfo.isConfigured ? (
                  <Tag minimal intent="success" style={{ fontSize: "10px" }}>
                    {vectorStoreInfo.enabledCount}/
                    {vectorStoreInfo.databaseCount} DBs
                  </Tag>
                ) : (
                  <Tag minimal intent="none" style={{ fontSize: "10px" }}>
                    No databases
                  </Tag>
                )}
              </span>
            </div>

            <Collapse isOpen={isVectorStoreSectionExpanded}>
              <div className="vector-store-content">
                {/* Progress indicator */}
                {vectorStoreStatus !== "idle" && (
                  <div className="vector-store-progress">
                    <ProgressBar
                      value={vectorStoreProgressRatio}
                      intent="primary"
                      stripes
                      animate
                    />
                    <span className="vector-store-progress-text">
                      {vectorStoreProgress}
                    </span>
                  </div>
                )}

                {/* Done message */}
                {vectorStoreStatus === "idle" && vectorStoreProgress && (
                  <div className="vector-store-progress-text">
                    {vectorStoreProgress}
                  </div>
                )}

                {/* First-time setup: no databases yet */}
                {databases.length === 0 && vectorStoreStatus === "idle" && (
                  <div className="vs-get-started">
                    <p className="vs-get-started-text">
                      Create a vector database to enable semantic search across your content.
                    </p>
                    <div className="vs-get-started-actions">
                      <Button
                        icon="database"
                        text="Index my Roam Graph"
                        intent="primary"
                        small
                        onClick={async () => {
                          try {
                            const db = await vsCreateDatabase("Current Graph");
                            loadVectorStoreInfo();
                            confirmAndIndexRoamGraph(db.id);
                          } catch (e: any) {
                            setVectorStoreProgress(`Error: ${e.message}`);
                          }
                        }}
                        disabled={!OPENAI_API_KEY}
                        title={!OPENAI_API_KEY ? "Requires an OpenAI API key" : undefined}
                      />
                      <Button
                        icon="upload"
                        text="Upload Files"
                        small
                        onClick={async () => {
                          const name = newDbName.trim() || "Uploaded Files";
                          try {
                            const db = await vsCreateDatabase(name);
                            loadVectorStoreInfo();
                            setActiveDatabaseId(db.id);
                            setNewDbName("");
                            fileInputRef.current?.click();
                          } catch (e: any) {
                            setVectorStoreProgress(`Error: ${e.message}`);
                          }
                        }}
                        disabled={!OPENAI_API_KEY}
                        title={!OPENAI_API_KEY ? "Requires an OpenAI API key" : undefined}
                      />
                    </div>
                    {!OPENAI_API_KEY && (
                      <p className="vs-get-started-warning">
                        <Icon icon="warning-sign" size={12} /> An OpenAI API key is required. Set it in extension settings.
                      </p>
                    )}
                  </div>
                )}

                {/* Database list */}
                {databases.length > 0 && (
                  <div className="vector-db-list">
                    {databases.map((db) => {
                      const pageCount = Object.keys(db.manifest).length;
                      const fileCount = db.files.length;
                      const isDefault = db.id === defaultDbId;

                      return (
                        <div
                          key={db.id}
                          className={`vector-db-item ${db.enabled ? "enabled" : "disabled"}`}
                        >
                          <div className="vector-db-item-header">
                            <div className="vector-db-item-left">
                              <Switch
                                checked={db.enabled}
                                onChange={() => handleToggleDatabase(db.id)}
                                style={{ marginBottom: 0 }}
                                disabled={vectorStoreStatus !== "idle"}
                              />
                              {renamingDbId === db.id ? (
                                <input
                                  className="vector-db-rename-input"
                                  value={renameValue}
                                  onChange={(e) =>
                                    setRenameValue(e.target.value)
                                  }
                                  onBlur={() => {
                                    handleRenameDatabase(db.id);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter")
                                      handleRenameDatabase(db.id);
                                    if (e.key === "Escape") {
                                      setRenamingDbId(null);
                                      setRenameValue("");
                                    }
                                  }}
                                  autoFocus
                                />
                              ) : (
                                <span
                                  className="vector-db-name"
                                  onDoubleClick={() => {
                                    setRenamingDbId(db.id);
                                    setRenameValue(db.name);
                                  }}
                                  title="Double-click to rename"
                                >
                                  {db.name}
                                </span>
                              )}
                              {isDefault && (
                                <Tag
                                  minimal
                                  intent="primary"
                                  style={{ fontSize: "9px" }}
                                >
                                  default
                                </Tag>
                              )}
                            </div>
                            <div className="vector-db-item-right">
                              <Tag minimal style={{ fontSize: "10px" }}>
                                {pageCount > 0 ? `${pageCount} pages` : ""}
                                {pageCount > 0 && fileCount > 0 ? ", " : ""}
                                {fileCount > 0 ? `${fileCount} files` : ""}
                                {pageCount === 0 && fileCount === 0
                                  ? "empty"
                                  : ""}
                              </Tag>
                            </div>
                          </div>

                          <div className="vector-db-item-actions">
                            <Tooltip
                              content="Index Roam graph into this database"
                              position="top"
                            >
                              <Button
                                small
                                minimal
                                icon="database"
                                text="Index"
                                onClick={() => {
                                  setActiveDatabaseId(db.id);
                                  confirmAndIndexRoamGraph(db.id);
                                }}
                                loading={
                                  vectorStoreStatus === "indexing" &&
                                  activeDatabaseId === db.id
                                }
                                disabled={vectorStoreStatus !== "idle"}
                              />
                            </Tooltip>
                            <Tooltip
                              content="Upload files to this database"
                              position="top"
                            >
                              <Button
                                small
                                minimal
                                icon="upload"
                                text="Upload"
                                onClick={() => {
                                  setActiveDatabaseId(db.id);
                                  fileInputRef.current?.click();
                                }}
                                loading={
                                  vectorStoreStatus === "uploading" &&
                                  activeDatabaseId === db.id
                                }
                                disabled={vectorStoreStatus !== "idle"}
                              />
                            </Tooltip>
                            {!isDefault && (
                              <Tooltip
                                content="Set as default database"
                                position="top"
                              >
                                <Button
                                  small
                                  minimal
                                  icon="pin"
                                  onClick={() => handleSetDefault(db.id)}
                                  disabled={vectorStoreStatus !== "idle"}
                                />
                              </Tooltip>
                            )}
                            <Tooltip
                              content="Delete this database"
                              position="top"
                            >
                              <Button
                                small
                                minimal
                                icon="trash"
                                intent="danger"
                                onClick={() =>
                                  handleDeleteDatabase(db.id, db.name)
                                }
                                disabled={vectorStoreStatus !== "idle"}
                              />
                            </Tooltip>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Search settings */}
                <div className="vs-search-settings">
                  <div className="vs-search-settings-row">
                    <label className="vs-search-settings-label">
                      Max results
                    </label>
                    <input
                      type="number"
                      className="vs-search-settings-input"
                      value={vsMaxResults}
                      min={1}
                      max={50}
                      onChange={(e) =>
                        setVsMaxResults(
                          Math.max(
                            1,
                            Math.min(50, parseInt(e.target.value) || 10),
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="vs-search-settings-row">
                    <label className="vs-search-settings-label">
                      Min score %
                      <Tooltip
                        content="Hide results below this relevance score (0 = show all)"
                        position="top"
                      >
                        <Icon
                          icon="info-sign"
                          size={10}
                          style={{ marginLeft: 4, opacity: 0.5 }}
                        />
                      </Tooltip>
                    </label>
                    <input
                      type="number"
                      className="vs-search-settings-input"
                      value={vsThreshold}
                      min={0}
                      max={100}
                      step={5}
                      onChange={(e) =>
                        setVsThreshold(
                          Math.max(
                            0,
                            Math.min(100, parseInt(e.target.value) || 0),
                          ),
                        )
                      }
                    />
                  </div>
                </div>

                {/* Create new database */}
                <div className="vector-db-create">
                  <input
                    className="vector-db-create-input"
                    placeholder="New database name..."
                    value={newDbName}
                    onChange={(e) => setNewDbName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateDatabase();
                    }}
                    disabled={vectorStoreStatus !== "idle"}
                  />
                  <Tooltip
                    content="Create a new vector database"
                    position="top"
                  >
                    <Button
                      small
                      icon="plus"
                      intent="primary"
                      onClick={handleCreateDatabase}
                      loading={vectorStoreStatus === "creating"}
                      disabled={
                        vectorStoreStatus !== "idle" || !newDbName.trim()
                      }
                    />
                  </Tooltip>
                </div>

                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.doc,.txt,.md,.json,.html,.csv,.js,.ts,.py,.msgpack,.pptx"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleUploadFiles(e.target.files, activeDatabaseId);
                      e.target.value = "";
                    }
                  }}
                />
              </div>
            </Collapse>
          </div>
        )}
      </React.Fragment>
    );
  };

  const menu = (
    <Menu className="chat-tools-menu">
      <div className="chat-tools-menu-header">
        <Tooltip
          content={
            <>
              When enabled, the AI can use tools to search your graph, run
              queries, etc.
              <br></br>
              Each enabled tool adds ~50–200 tokens per request.
            </>
          }
          openOnTargetFocus={false}
          hoverOpenDelay={500}
        >
          <div className="chat-tools-mode-label">
            <strong>Agent Mode</strong>
            <span
              className={`chat-tools-mode-status ${isAgentMode ? "enabled" : "disabled"}`}
            >
              {isAgentMode ? "(tools available)" : "(tools disabled)"}
            </span>
          </div>
        </Tooltip>
        <Switch
          checked={isAgentMode}
          onChange={() => onToggleAgentMode(!isAgentMode)}
          style={{ marginBottom: 0 }}
        />
      </div>
      <Divider />

      <div
        className={`chat-tools-sections-wrapper ${!isAgentMode ? "agent-mode-disabled" : ""}`}
      >
        {/* Context Section */}
        <div className="chat-tools-section">
          <div className="chat-tools-section-header">
            <Icon icon="search-around" size={14} />
            <span>Context</span>
          </div>
          {contextTools.map(([toolName, toolInfo]) =>
            renderToolItem(toolName, toolInfo, !isAgentMode),
          )}
        </div>

        {/* Interaction Section */}
        {interactionTools.length > 0 && (
          <>
            <Divider />
            <div className="chat-tools-section">
              <div className="chat-tools-section-header">
                <Icon icon="form" size={14} />
                <span>Interaction</span>
              </div>
              {interactionTools.map(([toolName, toolInfo]) =>
                renderToolItem(toolName, toolInfo, !isAgentMode),
              )}
            </div>
          </>
        )}

        <Divider />

        {/* Edit or Add Content Section */}
        <div
          className={`chat-tools-section chat-tools-section-edit ${
            isEditSectionEnabled ? "enabled" : "disabled"
          }`}
        >
          <div
            className="chat-tools-section-header chat-tools-section-header-clickable"
            onClick={() => setIsEditSectionExpanded(!isEditSectionExpanded)}
          >
            <div className="chat-tools-section-header-left">
              <Icon
                icon={isEditSectionExpanded ? "chevron-down" : "chevron-right"}
                size={12}
              />
              <Icon icon="warning-sign" size={14} intent="warning" />
              <span>Edit or add content</span>
            </div>
            <Tooltip
              content={
                isEditSectionEnabled
                  ? "Disable edit section"
                  : "Enable edit section (allows AI to modify your graph)"
              }
              position="top"
            >
              <Switch
                checked={isEditSectionEnabled}
                onChange={(e) => {
                  e.stopPropagation();
                  onToggleTool(EDIT_SECTION_KEY);
                }}
                onClick={(e) => e.stopPropagation()}
                style={{ marginBottom: 0 }}
              />
            </Tooltip>
          </div>
          <Collapse isOpen={isEditSectionExpanded}>
            <div className="chat-tools-section-content">
              {editTools.map(([toolName, toolInfo]) =>
                renderToolItem(
                  toolName,
                  toolInfo,
                  !isEditSectionEnabled || !isAgentMode,
                ),
              )}
            </div>
          </Collapse>
        </div>

        <Divider />

        {/* Skills Section */}
        <div
          className={`chat-tools-section chat-tools-section-skills ${
            isSkillsSectionEnabled ? "enabled" : "disabled"
          }`}
        >
          <div
            className="chat-tools-section-header chat-tools-section-header-clickable"
            onClick={() => setIsSkillsSectionExpanded(!isSkillsSectionExpanded)}
          >
            <div className="chat-tools-section-header-left">
              <Icon
                icon={
                  isSkillsSectionExpanded ? "chevron-down" : "chevron-right"
                }
                size={12}
              />
              <Icon icon="lightbulb" size={14} />
              <span>Skills</span>
            </div>
            {skillsToolEntry && (
              <Tooltip
                content={
                  isSkillsSectionEnabled
                    ? "Disable skills tool"
                    : "Enable skills tool"
                }
                position="top"
              >
                <Switch
                  checked={isSkillsSectionEnabled}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleTool("live_ai_skills");
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ marginBottom: 0 }}
                />
              </Tooltip>
            )}
          </div>
          <Collapse isOpen={isSkillsSectionExpanded}>
            <div className="chat-tools-section-content">
              {skills.length > 0 ? (
                skills.map((skill) => {
                  const skillKey = `skill:${skill.name}`;
                  const isExpanded = expandedDescriptions.has(skillKey);

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
                            opacity: isSkillsSectionEnabled ? 1 : 0.5,
                          }}
                        >
                          <div className="chat-tool-name">
                            <Icon
                              icon={
                                isExpanded ? "chevron-down" : "chevron-right"
                              }
                              size={12}
                            />
                            <span style={{ marginLeft: "6px" }}>
                              {skill.name}
                            </span>
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
                          disabled={!isSkillsSectionEnabled}
                        />
                      }
                      shouldDismissPopover={false}
                      disabled={!isSkillsSectionEnabled}
                    />
                  );
                })
              ) : (
                <div className="chat-tools-no-skills">
                  No skills found. Add skills with <code>#liveai/skill</code>{" "}
                  tag in your graph.
                </div>
              )}
            </div>
          </Collapse>
        </div>
      </div>
      {/* end chat-tools-sections-wrapper */}
    </Menu>
  );

  return (
    <>
      <Tooltip
        content={
          isAgentMode
            ? `Agent mode: ${enabledCount}/${totalCount} tools enabled`
            : "Chat mode (no tools)"
        }
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

      <Alert
        isOpen={isIndexAlertOpen}
        onConfirm={() => {
          setIsIndexAlertOpen(false);
          handleIndexRoamGraph(pendingIndexDbId);
        }}
        onCancel={() => setIsIndexAlertOpen(false)}
        confirmButtonText="Index my graph"
        cancelButtonText="Cancel"
        intent="primary"
        icon="cloud-upload"
      >
        <p>
          <strong>Index your Roam graph into the vector database?</strong>
        </p>
        <p>This will:</p>
        <ul style={{ paddingLeft: 20, margin: "8px 0" }}>
          <li>
            Extract all your pages and blocks content (excluding blocks with
            your exclusion tags)
          </li>
          <li>
            Convert them to text and upload to OpenAI's storage for semantic
            search
          </li>
          <li>Daily notes and regular pages are stored in separate chunks</li>
        </ul>
        <p style={{ fontSize: 12, color: "#5c7080", marginTop: 8 }}>
          Your data is stored on OpenAI's servers and can be managed at{" "}
          <a
            href="https://platform.openai.com/storage"
            target="_blank"
            rel="noopener noreferrer"
          >
            platform.openai.com/storage
          </a>
          . An OpenAI API key is required and usage fees will apply (free
          storage up to 1 GB, $2.50 / 1k calls + tokens processed).
        </p>
      </Alert>
    </>
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
    { handleClick, handleFocus, modifiers },
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
