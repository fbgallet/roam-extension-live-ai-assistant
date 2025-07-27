import React, { useState, useEffect } from "react";
import {
  Button,
  InputGroup,
  Card,
  Elevation,
  Switch,
  Icon,
  Tooltip,
  Dialog,
  FormGroup,
  TextArea,
  Tag,
  Collapse,
  Toaster,
  Position,
} from "@blueprintjs/core";
import { mcpManager } from "../ai/agents/mcp-agent/mcpManager.js";
import { MCPDiscovery } from "../ai/agents/mcp-agent/mcpDiscovery.js";

// Create toaster instance
const AppToaster = Toaster.create({
  className: "mcp-toaster",
  position: Position.TOP,
});

const MCPConfigComponent = ({ extensionStorage }) => {
  const [servers, setServers] = useState([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState(null);
  const [newServer, setNewServer] = useState({
    id: "",
    name: "",
    url: "",
    apiKey: "",
    enabled: true,
    description: "",
  });
  const [connectionStates, setConnectionStates] = useState({});
  const [testingConnection, setTestingConnection] = useState({});
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryResults, setDiscoveryResults] = useState(null);
  const [expandedServers, setExpandedServers] = useState({});
  const [toolPreferences, setToolPreferences] = useState({});
  const [expandedResources, setExpandedResources] = useState({});
  const [expandedPrompts, setExpandedPrompts] = useState({});

  useEffect(() => {
    loadServers();
    mcpManager.initialize(extensionStorage);
  }, [extensionStorage]);

  useEffect(() => {
    const interval = setInterval(() => {
      updateConnectionStates();
    }, 5000);
    return () => clearInterval(interval);
  }, [servers]);

  const loadServers = () => {
    const mcpServers = extensionStorage?.get("mcpServers") || [];
    setServers(mcpServers);
    updateConnectionStates();
    loadToolPreferences();
  };

  const updateConnectionStates = () => {
    const connectedServers = mcpManager.getConnectedServers();
    const states = {};

    setServers((currentServers) => {
      currentServers.forEach((server) => {
        const connectedServer = connectedServers.find(
          (cs) => cs.name === server.name
        );
        states[server.id] = {
          connected: !!connectedServer,
          info: connectedServer,
        };
      });

      setConnectionStates(states);
      return currentServers;
    });
  };

  const generateId = () => {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  };

  const handleAddServer = async () => {
    const serverToAdd = {
      ...newServer,
      id: editingServer ? editingServer.id : generateId(),
    };

    await mcpManager.saveServerConfig(serverToAdd);
    loadServers();
    resetForm();
  };

  const handleEditServer = (server) => {
    setEditingServer(server);
    setNewServer({ ...server });
    setIsAddDialogOpen(true);
  };

  const handleDeleteServer = async (serverId) => {
    if (window.confirm("Are you sure you want to delete this MCP server?")) {
      await mcpManager.removeServerConfig(serverId);
      loadServers();
    }
  };

  const handleToggleEnabled = async (server) => {
    const updatedServer = { ...server, enabled: !server.enabled };
    await mcpManager.saveServerConfig(updatedServer);
    loadServers();
  };

  const handleTestConnection = async (server) => {
    setTestingConnection((prev) => ({ ...prev, [server.id]: true }));

    try {
      const connected = await mcpManager.testConnection(server);

      if (connected) {
        AppToaster.show({
          message: `Connection successful to server ${server.name}`,
          intent: "success",
          icon: "tick-circle",
          timeout: 3000,
        });
      } else {
        AppToaster.show({
          message: `Connection failed to server ${server.name}`,
          intent: "danger",
          icon: "cross-circle",
          timeout: 3000,
        });
      }
    } catch (error) {
      AppToaster.show({
        message: `Connection test error: ${error.message}`,
        intent: "danger",
        icon: "error",
        timeout: 4000,
      });
    } finally {
      setTestingConnection((prev) => ({ ...prev, [server.id]: false }));
    }
  };

  const handleAutoDiscovery = async () => {
    setIsDiscovering(true);
    setDiscoveryResults(null);

    try {
      const results = await MCPDiscovery.autoDiscoverAndAdd(extensionStorage);
      setDiscoveryResults(results);

      if (results.success && results.added > 0) {
        loadServers(); // Refresh the server list
        AppToaster.show({
          message: `Auto-discovery complete! Found ${results.discovered} servers, added ${results.added} new ones.`,
          intent: "success",
          icon: "search",
          timeout: 4000,
        });
      } else if (results.success && results.added === 0) {
        AppToaster.show({
          message: `Auto-discovery complete! Found ${results.discovered} servers, but all were already configured.`,
          intent: "primary",
          icon: "info-sign",
          timeout: 4000,
        });
      } else {
        AppToaster.show({
          message: `Auto-discovery failed: ${results.error || "Unknown error"}`,
          intent: "danger",
          icon: "error",
          timeout: 4000,
        });
      }
    } catch (error) {
      AppToaster.show({
        message: `Auto-discovery error: ${error.message}`,
        intent: "danger",
        icon: "error",
        timeout: 4000,
      });
      setDiscoveryResults({ success: false, error: error.message });
    } finally {
      setIsDiscovering(false);
    }
  };

  const resetForm = () => {
    setNewServer({
      id: "",
      name: "",
      url: "",
      apiKey: "",
      enabled: true,
      description: "",
    });
    setEditingServer(null);
    setIsAddDialogOpen(false);
  };

  const loadToolPreferences = () => {
    const preferences = extensionStorage?.get("mcpToolPreferences") || {};
    setToolPreferences(preferences);
  };

  const saveToolPreferences = async (preferences) => {
    await extensionStorage?.set("mcpToolPreferences", preferences);
    setToolPreferences(preferences);
  };

  const toggleServerExpanded = (serverId) => {
    setExpandedServers((prev) => ({
      ...prev,
      [serverId]: !prev[serverId],
    }));
  };

  const toggleResourcesExpanded = (serverId) => {
    setExpandedResources((prev) => ({
      ...prev,
      [serverId]: !prev[serverId],
    }));
  };

  const togglePromptsExpanded = (serverId) => {
    setExpandedPrompts((prev) => ({
      ...prev,
      [serverId]: !prev[serverId],
    }));
  };

  const toggleToolEnabled = async (serverId, toolName, enabled) => {
    const newPreferences = {
      ...toolPreferences,
      [serverId]: {
        ...toolPreferences[serverId],
        [toolName]: enabled,
      },
    };
    await saveToolPreferences(newPreferences);

    // ✨ No longer needed - MCP commands generated dynamically in ContextMenu
  };

  const getServerTools = (serverId) => {
    const client = mcpManager.getClient(serverId);
    return client ? client.getTools() : [];
  };

  const getServerResources = (serverId) => {
    const client = mcpManager.getClient(serverId);
    return client ? client.getResources() : [];
  };

  const getServerPrompts = (serverId) => {
    const client = mcpManager.getClient(serverId);
    return client ? client.getPrompts() : [];
  };

  const isToolEnabled = (serverId, toolName) => {
    return toolPreferences[serverId]?.[toolName] !== false; // Default to enabled
  };

  const getConnectionStatus = (server) => {
    const state = connectionStates[server.id];
    if (!server.enabled) {
      return { icon: "disable", intent: "none", text: "Disabled" };
    }
    if (state?.connected) {
      return { icon: "tick-circle", intent: "success", text: "Connected" };
    }
    return { icon: "cross-circle", intent: "danger", text: "Disconnected" };
  };

  const renderCollapsibleSection = (
    title,
    count,
    isExpanded,
    onToggle,
    items,
    renderItem
  ) => {
    if (count === 0) return null;

    return (
      <div className="mcp-collapsible-section">
        <div className="mcp-collapsible-header" onClick={onToggle}>
          <Icon icon={isExpanded ? "chevron-down" : "chevron-right"} />
          <h5 className="mcp-collapsible-title">
            {title} ({count})
          </h5>
        </div>
        <Collapse isOpen={isExpanded}>
          <div className="mcp-collapsible-content">{items.map(renderItem)}</div>
        </Collapse>
      </div>
    );
  };

  const renderServerCard = (server) => {
    const status = getConnectionStatus(server);
    const state = connectionStates[server.id];
    const tools = state?.connected ? getServerTools(server.id) : [];
    const resources = state?.connected ? getServerResources(server.id) : [];
    const prompts = state?.connected ? getServerPrompts(server.id) : [];

    return (
      <Card
        key={server.id}
        elevation={Elevation.ONE}
        className="mcp-server-card"
      >
        <div className="mcp-server-card-content">
          <div className="mcp-server-card-main">
            <div className="mcp-server-title-row">
              <h4 className="mcp-server-title">{server.name}</h4>
              <Tag intent={status.intent} icon={status.icon}>
                {status.text}
              </Tag>
              {server.autoDiscovered && (
                <Tag
                  intent="success"
                  icon="automatic-updates"
                  className="mcp-server-auto-tag"
                >
                  Auto-discovered
                </Tag>
              )}
            </div>

            <div className="mcp-server-url">
              <strong>URL:</strong> {server.url}
            </div>

            {server.description && (
              <div className="mcp-server-description">
                <strong>Description:</strong> {server.description}
              </div>
            )}

            {state?.connected && (
              <>
                {renderCollapsibleSection(
                  "Tools",
                  tools.length,
                  expandedServers[server.id],
                  () => toggleServerExpanded(server.id),
                  tools,
                  (tool) => (
                    <div key={tool.name} className="mcp-tool-item">
                      <div className="mcp-tool-info">
                        <div className="mcp-tool-name">{tool.name}</div>
                        {tool.description && (
                          <div className="mcp-tool-description">
                            {tool.description}
                          </div>
                        )}
                      </div>
                      <Switch
                        checked={isToolEnabled(server.id, tool.name)}
                        onChange={(e) =>
                          toggleToolEnabled(
                            server.id,
                            tool.name,
                            e.target.checked
                          )
                        }
                        small
                      />
                    </div>
                  )
                )}
              </>
            )}

            {state?.connected && (
              <>
                {renderCollapsibleSection(
                  "Resources",
                  resources.length,
                  expandedResources[server.id],
                  () => toggleResourcesExpanded(server.id),
                  resources,
                  (resource) => (
                    <div key={resource.uri} className="mcp-resource-item">
                      <div className="mcp-resource-name">
                        {resource.name || resource.uri}
                      </div>
                      {resource.description && (
                        <div className="mcp-resource-description">
                          {resource.description}
                        </div>
                      )}
                    </div>
                  )
                )}

                {renderCollapsibleSection(
                  "Prompts",
                  prompts.length,
                  expandedPrompts[server.id],
                  () => togglePromptsExpanded(server.id),
                  prompts,
                  (prompt) => (
                    <div key={prompt.name} className="mcp-prompt-item">
                      <div className="mcp-prompt-name">{prompt.name}</div>
                      {prompt.description && (
                        <div className="mcp-prompt-description">
                          {prompt.description}
                        </div>
                      )}
                    </div>
                  )
                )}
              </>
            )}
          </div>

          <div className="mcp-server-card-actions">
            <Tooltip content="Test connection">
              <Button
                icon="satellite"
                minimal
                small
                loading={testingConnection[server.id]}
                onClick={() => handleTestConnection(server)}
              />
            </Tooltip>

            <Tooltip content="Edit">
              <Button
                icon="edit"
                minimal
                small
                onClick={() => handleEditServer(server)}
              />
            </Tooltip>

            <Tooltip content="Delete">
              <Button
                icon="trash"
                minimal
                small
                intent="danger"
                onClick={() => handleDeleteServer(server.id)}
              />
            </Tooltip>

            <Switch
              checked={server.enabled}
              onChange={() => handleToggleEnabled(server)}
              innerLabel="Off"
              innerLabelChecked="On"
            />
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div className="mcp-config-container">
      <div className="mcp-config-header">
        <h3>MCP Servers</h3>
        <div className="mcp-config-header-buttons">
          <Button
            icon="search"
            intent="success"
            loading={isDiscovering}
            onClick={handleAutoDiscovery}
          >
            Auto-discover
          </Button>
          <Button
            icon="plus"
            intent="primary"
            onClick={() => setIsAddDialogOpen(true)}
          >
            Add Server
          </Button>
        </div>
      </div>

      {servers.length === 0 ? (
        <Card elevation={Elevation.ZERO} className="mcp-empty-state">
          <Icon icon="satellite" size={40} className="mcp-empty-state-icon" />
          <p className="mcp-empty-state-text">
            No MCP servers configured.
            <br />
            Add a server to start using MCP tools.
          </p>
        </Card>
      ) : (
        servers.map(renderServerCard)
      )}

      <Dialog
        isOpen={isAddDialogOpen}
        onClose={resetForm}
        title={editingServer ? "Edit MCP Server" : "Add MCP Server"}
        className="mcp-dialog"
      >
        <div className="mcp-dialog-content">
          <FormGroup label="Server Name" labelFor="server-name">
            <InputGroup
              id="server-name"
              value={newServer.name}
              onChange={(e) =>
                setNewServer({ ...newServer, name: e.target.value })
              }
              placeholder="My MCP Server"
            />
          </FormGroup>

          <FormGroup label="Server URL" labelFor="server-url">
            <InputGroup
              id="server-url"
              value={newServer.url}
              onChange={(e) =>
                setNewServer({ ...newServer, url: e.target.value })
              }
              placeholder="ws://localhost:3000/mcp ou https://api.example.com/mcp"
            />
          </FormGroup>

          <FormGroup label="API Key (optional)" labelFor="server-api-key">
            <InputGroup
              id="server-api-key"
              type="password"
              value={newServer.apiKey}
              onChange={(e) =>
                setNewServer({ ...newServer, apiKey: e.target.value })
              }
              placeholder="sk-..."
            />
          </FormGroup>

          <FormGroup
            label="Description (optional)"
            labelFor="server-description"
          >
            <TextArea
              id="server-description"
              value={newServer.description}
              onChange={(e) =>
                setNewServer({ ...newServer, description: e.target.value })
              }
              placeholder="Server description and capabilities"
              rows={3}
              fill
            />
          </FormGroup>

          <FormGroup>
            <Switch
              checked={newServer.enabled}
              onChange={(e) =>
                setNewServer({ ...newServer, enabled: e.target.checked })
              }
              label="Enable server"
            />
          </FormGroup>

          <div className="mcp-dialog-actions">
            <Button onClick={resetForm}>Cancel</Button>
            <Button
              intent="primary"
              onClick={handleAddServer}
              disabled={!newServer.name || !newServer.url}
            >
              {editingServer ? "Update" : "Add"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default MCPConfigComponent;
