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
} from "@blueprintjs/core";
import { mcpManager } from "../mcp/mcpManager.js";
import { MCPDiscovery } from "../mcp/mcpDiscovery.js";

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

    setServers(currentServers => {
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
        alert(`Connection successful to server ${server.name}`);
      } else {
        alert(`Connection failed to server ${server.name}`);
      }
    } catch (error) {
      alert(`Connection test error: ${error.message}`);
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
        alert(
          `Auto-discovery complete! Found ${results.discovered} servers, added ${results.added} new ones.`
        );
      } else if (results.success && results.added === 0) {
        alert(
          `Auto-discovery complete! Found ${results.discovered} servers, but all were already configured.`
        );
      } else {
        alert(`Auto-discovery failed: ${results.error || "Unknown error"}`);
      }
    } catch (error) {
      alert(`Auto-discovery error: ${error.message}`);
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
    setExpandedServers(prev => ({
      ...prev,
      [serverId]: !prev[serverId]
    }));
  };

  const toggleToolEnabled = async (serverId, toolName, enabled) => {
    const newPreferences = {
      ...toolPreferences,
      [serverId]: {
        ...toolPreferences[serverId],
        [toolName]: enabled
      }
    };
    await saveToolPreferences(newPreferences);
    
    // Trigger ContextMenu update to reflect changes
    if (window.LiveAI?.updateMCPItems) {
      window.LiveAI.updateMCPItems();
    }
  };

  const getServerTools = (serverId) => {
    const client = mcpManager.getClient(serverId);
    return client ? client.getTools() : [];
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

  const renderServerCard = (server) => {
    const status = getConnectionStatus(server);
    const state = connectionStates[server.id];

    return (
      <Card
        key={server.id}
        elevation={Elevation.ONE}
        style={{ marginBottom: "10px" }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: "8px",
              }}
            >
              <h4 style={{ margin: 0, marginRight: "10px" }}>{server.name}</h4>
              <Tag intent={status.intent} icon={status.icon}>
                {status.text}
              </Tag>
              {server.autoDiscovered && (
                <Tag
                  intent="success"
                  icon="automatic-updates"
                  style={{ marginLeft: "8px" }}
                >
                  Auto-discovered
                </Tag>
              )}
            </div>

            <div
              style={{ fontSize: "12px", color: "#666", marginBottom: "8px" }}
            >
              <strong>URL:</strong> {server.url}
            </div>

            {server.description && (
              <div
                style={{ fontSize: "12px", color: "#666", marginBottom: "8px" }}
              >
                <strong>Description:</strong> {server.description}
              </div>
            )}

            {state?.info && (
              <div style={{ fontSize: "11px", color: "#888" }}>
                <strong>Tools:</strong> {state.info.toolsCount} |
                <strong> Resources:</strong> {state.info.resourcesCount} |
                <strong> Prompts:</strong> {state.info.promptsCount}
              </div>
            )}

            {state?.connected && state.info.toolsCount > 0 && (
              <div style={{ marginTop: "12px" }}>
                <Button
                  minimal
                  small
                  icon={expandedServers[server.id] ? "chevron-down" : "chevron-right"}
                  onClick={() => toggleServerExpanded(server.id)}
                  style={{ fontSize: "11px", padding: "2px 4px" }}
                >
                  {expandedServers[server.id] ? "Hide Tools" : "Show Tools"}
                </Button>
                
                <Collapse isOpen={expandedServers[server.id]}>
                  <div style={{ 
                    marginTop: "8px", 
                    padding: "8px", 
                    backgroundColor: "#f5f5f5", 
                    borderRadius: "4px" 
                  }}>
                    {getServerTools(server.id).map((tool) => (
                      <div
                        key={tool.name}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          marginBottom: "8px",
                          padding: "4px 0"
                        }}
                      >
                        <div style={{ flex: 1, marginRight: "8px" }}>
                          <div style={{ 
                            fontWeight: "bold", 
                            fontSize: "12px",
                            marginBottom: "2px"
                          }}>
                            {tool.name}
                          </div>
                          {tool.description && (
                            <div style={{ 
                              fontSize: "11px", 
                              color: "#666",
                              lineHeight: "1.3"
                            }}>
                              {tool.description}
                            </div>
                          )}
                        </div>
                        <Switch
                          checked={isToolEnabled(server.id, tool.name)}
                          onChange={(e) => toggleToolEnabled(server.id, tool.name, e.target.checked)}
                          small
                        />
                      </div>
                    ))}
                  </div>
                </Collapse>
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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
    <div style={{ padding: "10px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "15px",
        }}
      >
        <h3>MCP Servers</h3>
        <div style={{ display: "flex", gap: "10px" }}>
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
        <Card
          elevation={Elevation.ZERO}
          style={{ textAlign: "center", padding: "20px" }}
        >
          <Icon
            icon="satellite"
            size={40}
            style={{ marginBottom: "10px", opacity: 0.5 }}
          />
          <p style={{ margin: 0, color: "#666" }}>
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
        title={
          editingServer ? "Edit MCP Server" : "Add MCP Server"
        }
        style={{ width: "500px" }}
      >
        <div style={{ padding: "20px" }}>
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

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "10px",
              marginTop: "20px",
            }}
          >
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
