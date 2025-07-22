import { mcpManager } from './mcpManager.js';

export class MCPDiagnostics {
  static async runFullDiagnostic() {
    console.log('🔍 Starting MCP Full Diagnostic...');
    
    const results = {
      timestamp: new Date().toISOString(),
      manager: await MCPDiagnostics.testMCPManager(),
      servers: await MCPDiagnostics.testConnectedServers(),
      tools: await MCPDiagnostics.testToolsDetection(),
      storage: await MCPDiagnostics.testStorage()
    };
    
    console.log('📊 MCP Diagnostic Results:', results);
    return results;
  }
  
  static async testMCPManager() {
    try {
      const serverConfigs = mcpManager.getServerConfigs();
      const connectedServers = mcpManager.getConnectedServers();
      
      return {
        success: true,
        serverConfigs: serverConfigs.length,
        connectedServers: connectedServers.length,
        details: {
          configs: serverConfigs.map(s => ({ id: s.id, name: s.name, enabled: s.enabled, url: s.url })),
          connected: connectedServers.map(s => ({ serverId: s.serverId, name: s.name }))
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  static async testConnectedServers() {
    const results = [];
    const connectedServers = mcpManager.getConnectedServers();
    
    for (const server of connectedServers) {
      try {
        const client = mcpManager.getClient(server.serverId);
        if (client) {
          const tools = client.getTools();
          const resources = client.getResources();
          const prompts = client.getPrompts();
          
          results.push({
            serverId: server.serverId,
            name: server.name,
            success: true,
            capabilities: {
              tools: tools.length,
              resources: resources.length,
              prompts: prompts.length
            },
            details: {
              tools: tools.map(t => ({ name: t.name, description: t.description })),
              resources: resources.map(r => ({ name: r.name || r.uri, description: r.description })),
              prompts: prompts.map(p => ({ name: p.name, description: p.description }))
            }
          });
        } else {
          results.push({
            serverId: server.serverId,
            name: server.name,
            success: false,
            error: 'Client not found'
          });
        }
      } catch (error) {
        results.push({
          serverId: server.serverId,
          name: server.name,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }
  
  static async testToolsDetection() {
    try {
      const allTools = mcpManager.getAllTools();
      const allResources = mcpManager.getAllResources();
      const allPrompts = mcpManager.getAllPrompts();
      
      return {
        success: true,
        totals: {
          tools: allTools.length,
          resources: allResources.length,
          prompts: allPrompts.length
        },
        details: {
          tools: allTools.map(t => ({ 
            name: t.name, 
            serverName: t.serverName,
            serverId: t.serverId,
            description: t.description 
          })),
          resources: allResources.map(r => ({ 
            name: r.name || r.uri, 
            serverName: r.serverName,
            serverId: r.serverId,
            description: r.description 
          })),
          prompts: allPrompts.map(p => ({ 
            name: p.name, 
            serverName: p.serverName,
            serverId: p.serverId,
            description: p.description 
          }))
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  static async testStorage() {
    try {
      const storage = mcpManager.extensionStorage;
      if (!storage) {
        return {
          success: false,
          error: 'Extension storage not available'
        };
      }
      
      const mcpServers = storage.get('mcpServers') || [];
      
      return {
        success: true,
        serversInStorage: mcpServers.length,
        details: mcpServers.map(s => ({
          id: s.id,
          name: s.name,
          enabled: s.enabled,
          url: s.url,
          autoDiscovered: s.autoDiscovered || false
        }))
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  static async testMCPAgentExecution(serverId, serverName, testPrompt = "Test MCP connection and list available capabilities") {
    console.log(`🧪 Testing MCP Agent execution for server: ${serverName}`);
    
    try {
      const client = mcpManager.getClient(serverId);
      if (!client) {
        throw new Error(`Server ${serverName} not connected`);
      }
      
      const tools = client.getTools();
      const resources = client.getResources();
      
      console.log(`✅ Server ${serverName} test results:`, {
        connected: true,
        tools: tools.length,
        resources: resources.length,
        toolNames: tools.map(t => t.name),
        resourceNames: resources.map(r => r.name || r.uri)
      });
      
      return {
        success: true,
        serverId,
        serverName,
        connected: true,
        capabilities: {
          tools: tools.length,
          resources: resources.length
        },
        details: {
          tools: tools.map(t => ({ name: t.name, description: t.description })),
          resources: resources.map(r => ({ name: r.name || r.uri, description: r.description }))
        }
      };
    } catch (error) {
      console.error(`❌ Server ${serverName} test failed:`, error);
      return {
        success: false,
        serverId,
        serverName,
        error: error.message
      };
    }
  }
}

// Add global access for browser console testing
if (typeof window !== 'undefined') {
  window.MCPDiagnostics = MCPDiagnostics;
}

export default MCPDiagnostics;