import { mcpManager } from "./mcpManager.js";

export class MCPDiscovery {
  static COMMON_PORTS = [3000, 3001, 3002, 8000, 8001, 8002];

  static DISCOVERY_ENDPOINTS = [
    "/mcp",
    "/api/mcp",
    "/rpc",
    "/jsonrpc",
    "/api/jsonrpc",
    "/v1/mcp",
    "",
  ];

  static async discoverLocalServers() {
    console.log("🔍 Starting MCP server auto-discovery...");
    const discoveries = [];

    // Check WebSocket connections
    const wsServers = await MCPDiscovery.discoverWebSocketServers();
    discoveries.push(...wsServers);

    // Check HTTP endpoints
    const httpServers = await MCPDiscovery.discoverHTTPServers();
    discoveries.push(...httpServers);

    console.log(
      `🎯 Auto-discovery completed. Found ${discoveries.length} potential MCP servers:`,
      discoveries
    );
    return discoveries;
  }

  static async discoverWebSocketServers() {
    const discoveries = [];
    const promises = [];

    for (const port of MCPDiscovery.COMMON_PORTS) {
      for (const endpoint of MCPDiscovery.DISCOVERY_ENDPOINTS) {
        const url = `ws://localhost:${port}${endpoint}`;
        promises.push(MCPDiscovery.testWebSocketConnection(url));
      }

      // Also test root WebSocket
      const rootUrl = `ws://localhost:${port}`;
      promises.push(MCPDiscovery.testWebSocketConnection(rootUrl));
    }

    const results = await Promise.allSettled(promises);

    results.forEach((result) => {
      if (result.status === "fulfilled" && result.value) {
        discoveries.push(result.value);
      }
    });

    return discoveries;
  }

  static async discoverHTTPServers() {
    const discoveries = [];
    const promises = [];

    for (const port of MCPDiscovery.COMMON_PORTS) {
      // Test static endpoints
      for (const endpoint of MCPDiscovery.DISCOVERY_ENDPOINTS) {
        const url = `http://localhost:${port}${endpoint}`;
        promises.push(MCPDiscovery.testHTTPConnection(url));
      }

      // Test for MCP bridge and discover available servers
      promises.push(MCPDiscovery.discoverBridgeServers(port));
    }

    const results = await Promise.allSettled(promises);

    results.forEach((result) => {
      if (result.status === "fulfilled" && result.value) {
        if (Array.isArray(result.value)) {
          discoveries.push(...result.value);
        } else {
          discoveries.push(result.value);
        }
      }
    });

    return discoveries;
  }

  static async testWebSocketConnection(url) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(null);
      }, 2000); // 2 second timeout

      try {
        const ws = new WebSocket(url);

        ws.onopen = async () => {
          try {
            // Send MCP initialize request
            const initRequest = {
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2025-06-18",
                capabilities: {
                  experimental: {},
                  sampling: {},
                },
                clientInfo: {
                  name: "roam-extension-discovery",
                  version: "1.0.0",
                },
              },
            };

            ws.send(JSON.stringify(initRequest));
          } catch (error) {
            clearTimeout(timeout);
            ws.close();
            resolve(null);
          }
        };

        ws.onmessage = (event) => {
          try {
            const response = JSON.parse(event.data);
            if (response.result && response.result.capabilities) {
              clearTimeout(timeout);
              ws.close();

              const serverInfo = {
                type: "websocket",
                url: url,
                name:
                  response.result.serverInfo?.name ||
                  `Local MCP Server (${url})`,
                description: `Auto-discovered MCP server at ${url}`,
                capabilities: response.result.capabilities,
                serverInfo: response.result.serverInfo,
                autoDiscovered: true,
              };

              resolve(serverInfo);
            } else {
              clearTimeout(timeout);
              ws.close();
              resolve(null);
            }
          } catch (error) {
            clearTimeout(timeout);
            ws.close();
            resolve(null);
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          ws.close();
          resolve(null);
        };

        ws.onclose = () => {
          clearTimeout(timeout);
          resolve(null);
        };
      } catch (error) {
        clearTimeout(timeout);
        resolve(null);
      }
    });
  }

  static async discoverBridgeServers(bridgePort) {
    try {
      const bridgeUrl = `http://localhost:${bridgePort}/servers`;
      console.log(`🔍 [BRIDGE] Testing MCP bridge at: ${bridgeUrl}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 3000);

      const response = await fetch(bridgeUrl, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }

      const serversData = await response.json();
      console.log(
        `📦 [BRIDGE] Found servers from bridge on port ${bridgePort}:`,
        serversData
      );

      if (typeof serversData !== "object" || serversData === null) {
        return null;
      }

      const serverNames = Object.keys(serversData);
      if (serverNames.length === 0) {
        return null;
      }

      // Test each discovered server on all common ports
      const discoveries = [];
      const testPromises = [];

      for (const serverName of serverNames) {
        for (const serverPort of MCPDiscovery.COMMON_PORTS) {
          const serverUrl = `http://localhost:${serverPort}/rpc/${serverName}`;
          console.log(`🧪 [BRIDGE] Testing discovered server: ${serverUrl}`);
          testPromises.push(MCPDiscovery.testHTTPConnection(serverUrl));
        }
      }

      const testResults = await Promise.allSettled(testPromises);
      testResults.forEach((result) => {
        if (result.status === "fulfilled" && result.value) {
          discoveries.push(result.value);
        }
      });

      return discoveries.length > 0 ? discoveries : null;
    } catch (error) {
      console.log(
        `❌ [BRIDGE] Error querying bridge at port ${bridgePort}:`,
        error.message
      );
      return null;
    }
  }

  static async testHTTPConnection(url) {
    try {
      console.log(`🔍 [DISCOVERY] Testing HTTP connection to: ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.log(`⏰ [DISCOVERY] Timeout for ${url}`);
        controller.abort();
      }, 3000); // 3 second timeout

      const initRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {
            experimental: {},
            sampling: {},
          },
          clientInfo: {
            name: "roam-extension-discovery",
            version: "1.0.0",
          },
        },
      };

      console.log(
        `📤 [DISCOVERY] Sending request to ${url}:`,
        JSON.stringify(initRequest, null, 2)
      );

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(initRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log(
        `📥 [DISCOVERY] Response from ${url}: Status ${response.status} ${response.statusText}`
      );

      if (!response.ok) {
        console.log(`❌ [DISCOVERY] ${url} returned HTTP ${response.status}`);
        return null;
      }

      const data = await response.json();
      console.log(
        `📦 [DISCOVERY] Response data from ${url}:`,
        JSON.stringify(data, null, 2)
      );

      if (data.result && data.result.capabilities) {
        console.log(`✅ [DISCOVERY] Valid MCP server found at ${url}`);
        return {
          type: "http",
          url: url,
          name: data.result.serverInfo?.name || `Local MCP Server (${url})`,
          description: `Auto-discovered MCP server at ${url}`,
          capabilities: data.result.capabilities,
          serverInfo: data.result.serverInfo,
          autoDiscovered: true,
        };
      } else {
        console.log(
          `⚠️ [DISCOVERY] ${url} responded but not a valid MCP server (no capabilities)`
        );
      }

      return null;
    } catch (error) {
      if (error.name === "AbortError") {
        console.log(`⏰ [DISCOVERY] Request to ${url} timed out`);
      } else {
        console.log(
          `❌ [DISCOVERY] Error connecting to ${url}:`,
          error.message
        );
      }
      return null;
    }
  }

  static async addDiscoveredServers(discoveries, extensionStorage) {
    const existingServers = extensionStorage?.get("mcpServers") || [];
    const newServers = [];

    for (const discovery of discoveries) {
      // Check if server already exists
      const exists = existingServers.find(
        (server) =>
          server.url === discovery.url || server.name === discovery.name
      );

      if (!exists) {
        const serverConfig = {
          id: MCPDiscovery.generateId(),
          name: discovery.name,
          url: discovery.url,
          apiKey: "",
          enabled: false, // Don't auto-enable, let user decide
          description: discovery.description,
          autoDiscovered: true,
          discoveredCapabilities: discovery.capabilities,
          discoveredServerInfo: discovery.serverInfo,
        };

        newServers.push(serverConfig);
      }
    }

    if (newServers.length > 0) {
      const updatedServers = [...existingServers, ...newServers];
      await extensionStorage?.set("mcpServers", updatedServers);
      console.log(
        `✅ Added ${newServers.length} new MCP servers from auto-discovery`
      );
    } else {
      console.log("ℹ️ No new MCP servers found during auto-discovery");
    }

    return newServers;
  }

  static generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }

  static async autoDiscoverAndAdd(extensionStorage) {
    try {
      console.log("🚀 Starting automatic MCP server discovery...");
      const discoveries = await MCPDiscovery.discoverLocalServers();
      const newServers = await MCPDiscovery.addDiscoveredServers(
        discoveries,
        extensionStorage
      );

      return {
        success: true,
        discovered: discoveries.length,
        added: newServers.length,
        servers: newServers,
      };
    } catch (error) {
      console.error("❌ Auto-discovery failed:", error);
      return {
        success: false,
        error: error.message,
        discovered: 0,
        added: 0,
        servers: [],
      };
    }
  }

  // Check for common MCP server indicators in the system
  static async detectMCPEnvironment() {
    const indicators = [];

    try {
      // Check for common MCP-related processes or files
      // This is a simplified version - real implementation might check:
      // - package.json files with MCP dependencies
      // - Running processes with MCP keywords
      // - Configuration files indicating MCP usage

      // For now, just indicate potential
      indicators.push({
        type: "environment",
        description: "Local development environment detected",
        recommendation: "Run auto-discovery to find MCP servers",
      });
    } catch (error) {
      console.log("Environment detection not available in browser context");
    }

    return indicators;
  }
}

export default MCPDiscovery;
