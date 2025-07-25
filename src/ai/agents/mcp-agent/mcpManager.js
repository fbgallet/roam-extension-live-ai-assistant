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
    
    // Add test prompt for development - remove in production
    if (process.env.NODE_ENV !== 'production') {
      // If we have connected clients, use the first one, otherwise create a fake server entry
      if (this.clients.size > 0) {
        const testServerId = Array.from(this.clients.keys())[0];
        const testClient = this.clients.get(testServerId);
        
        allPrompts.push({
          name: "philosophical-beliefs-exploration",
          description: "Guide deep exploration of foundational philosophical beliefs and worldview",
          arguments: [
            {
              name: "focus_area",
              description: "Specific philosophical domain to explore (ethics, metaphysics, epistemology, etc.)",
              required: false
            },
            {
              name: "depth_level", 
              description: "Level of philosophical depth (introductory, intermediate, advanced)",
              required: false
            }
          ],
          serverId: testServerId,
          serverName: testClient.config.name + " (Test Prompt)"
        });
      } else {
        // No connected servers - create a fake test prompt anyway for testing
        allPrompts.push({
          name: "philosophical-beliefs-exploration",
          description: "Guide deep exploration of foundational philosophical beliefs and worldview",
          arguments: [
            {
              name: "focus_area",
              description: "Specific philosophical domain to explore (ethics, metaphysics, epistemology, etc.)",
              required: false
            },
            {
              name: "depth_level", 
              description: "Level of philosophical depth (introductory, intermediate, advanced)",
              required: false
            }
          ],
          serverId: "test-server",
          serverName: "Test Philosophy Server"
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
    // Handle test prompt for development
    if (promptName === "philosophical-beliefs-exploration" && process.env.NODE_ENV !== 'production') {
      const focusArea = arguments_?.focus_area || "general philosophy";
      const depthLevel = arguments_?.depth_level || "intermediate";
      
      return {
        result: {
          description: "Guide deep exploration of foundational philosophical beliefs and worldview",
          messages: [
            {
              role: "system",
              content: {
                type: "text",
                text: `You are an expert philosophical guide helping explore deep foundational beliefs about ${focusArea}. 

PHILOSOPHICAL EXPLORATION FRAMEWORK:
- Start with fundamental questions about reality, knowledge, and values
- Guide through ${depthLevel}-level philosophical inquiry
- Encourage reflection on underlying assumptions and worldview
- Connect abstract concepts to practical life implications
- Use Socratic questioning to deepen understanding

EXPLORATION AREAS FOR ${focusArea.toUpperCase()}:
${focusArea === "ethics" ? 
  "- What makes actions right or wrong?\n- Are moral truths objective or relative?\n- How should we balance individual rights vs collective good?\n- What role does intention vs consequences play in morality?" :
focusArea === "metaphysics" ? 
  "- What is the fundamental nature of reality?\n- Do we have free will or is everything determined?\n- What is the relationship between mind and matter?\n- Is there meaning or purpose built into existence?" :
focusArea === "epistemology" ?
  "- How do we acquire genuine knowledge?\n- Can we trust our senses and reason?\n- What is the role of faith, intuition, and experience?\n- How certain can we be about anything?" :
  "- What gives life meaning and purpose?\n- How should we understand truth and knowledge?\n- What are our moral obligations to others?\n- What is the good life and how should it be lived?"
}

DEPTH LEVEL: ${depthLevel.toUpperCase()}
${depthLevel === "introductory" ? "Focus on accessible concepts and real-world examples" :
  depthLevel === "intermediate" ? "Engage with classical philosophical positions and their implications" :
  "Explore nuanced arguments, paradoxes, and the interaction between different philosophical domains"
}

Remember: The goal is not to provide answers but to guide thoughtful exploration of these fundamental questions about existence, knowledge, and values.`
              }
            },
            {
              role: "user", 
              content: {
                type: "text",
                text: `Please guide me through a philosophical exploration focusing on ${focusArea} at the ${depthLevel} level. Help me examine my foundational beliefs and assumptions through thoughtful questioning and reflection.`
              }
            }
          ]
        }
      };
    }
    
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