import MCPClient from './mcpClient.js';

class MCPManager {
  constructor() {
    this.clients = new Map();
    this.extensionStorage = null;
  }

  initialize(extensionStorage) {
    this.extensionStorage = extensionStorage;
    this.loadServersFromStorage();
  }

  async loadServersFromStorage() {
    const mcpServers = this.extensionStorage?.get('mcpServers') || [];
    
    for (const serverConfig of mcpServers) {
      if (serverConfig.enabled) {
        await this.connectToServer(serverConfig);
      }
    }
  }

  async connectToServer(serverConfig) {
    try {
      if (this.clients.has(serverConfig.id)) {
        await this.disconnectFromServer(serverConfig.id);
      }

      const client = new MCPClient(serverConfig);
      const connected = await client.connect();
      
      if (connected) {
        this.clients.set(serverConfig.id, client);
        console.log(`Successfully connected to MCP server: ${serverConfig.name}`);
        // Notify context menu to update MCP items
        if (window.LiveAI?.updateMCPItems) {
          window.LiveAI.updateMCPItems();
        }
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`Failed to connect to MCP server ${serverConfig.name}:`, error);
      return false;
    }
  }

  async disconnectFromServer(serverId) {
    const client = this.clients.get(serverId);
    if (client) {
      client.disconnect();
      this.clients.delete(serverId);
      console.log(`Disconnected from MCP server: ${serverId}`);
      // Notify context menu to update MCP items
      if (window.LiveAI?.updateMCPItems) {
        window.LiveAI.updateMCPItems();
      }
    }
  }

  async disconnectAll() {
    for (const [serverId, client] of this.clients) {
      client.disconnect();
    }
    this.clients.clear();
  }

  getConnectedServers() {
    return Array.from(this.clients.entries()).map(([serverId, client]) => ({
      ...client.getServerInfo(),
      serverId
    }));
  }

  getClient(serverId) {
    return this.clients.get(serverId);
  }

  getAllTools() {
    const allTools = [];
    const toolPreferences = this.extensionStorage?.get('mcpToolPreferences') || {};
    
    for (const [serverId, client] of this.clients) {
      const tools = client.getTools();
      for (const tool of tools) {
        const isEnabled = toolPreferences[serverId]?.[tool.name] !== false;
        
        if (isEnabled) {
          allTools.push({
            ...tool,
            serverId,
            serverName: client.config.name
          });
        }
      }
    }
    
    return allTools;
  }

  getAllResources() {
    const allResources = [];
    
    for (const [serverId, client] of this.clients) {
      const resources = client.getResources();
      for (const resource of resources) {
        allResources.push({
          ...resource,
          serverId,
          serverName: client.config.name
        });
      }
    }
    
    return allResources;
  }

  getAllPrompts() {
    const allPrompts = [];
    
    for (const [serverId, client] of this.clients) {
      const prompts = client.getPrompts();
      for (const prompt of prompts) {
        allPrompts.push({
          ...prompt,
          serverId,
          serverName: client.config.name
        });
      }
    }
    
    return allPrompts;
  }

  async callTool(serverId, toolName, arguments_) {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`MCP server ${serverId} not connected`);
    }
    
    return await client.callTool(toolName, arguments_);
  }

  async getResource(serverId, uri) {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`MCP server ${serverId} not connected`);
    }
    
    return await client.getResource(uri);
  }

  async getPrompt(serverId, promptName, arguments_) {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`MCP server ${serverId} not connected`);
    }
    
    return await client.getPrompt(promptName, arguments_);
  }

  async saveServerConfig(serverConfig) {
    const mcpServers = this.extensionStorage?.get('mcpServers') || [];
    const existingIndex = mcpServers.findIndex(s => s.id === serverConfig.id);
    
    if (existingIndex >= 0) {
      mcpServers[existingIndex] = serverConfig;
    } else {
      mcpServers.push(serverConfig);
    }
    
    await this.extensionStorage?.set('mcpServers', mcpServers);
    
    if (serverConfig.enabled) {
      await this.connectToServer(serverConfig);
    } else {
      await this.disconnectFromServer(serverConfig.id);
    }
  }

  async removeServerConfig(serverId) {
    const mcpServers = this.extensionStorage?.get('mcpServers') || [];
    const filteredServers = mcpServers.filter(s => s.id !== serverId);
    
    await this.extensionStorage?.set('mcpServers', filteredServers);
    await this.disconnectFromServer(serverId);
  }

  getServerConfigs() {
    return this.extensionStorage?.get('mcpServers') || [];
  }

  async testConnection(serverConfig) {
    try {
      const client = new MCPClient(serverConfig);
      const connected = await client.connect();
      client.disconnect();
      return connected;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }
}

export const mcpManager = new MCPManager();
export default mcpManager;