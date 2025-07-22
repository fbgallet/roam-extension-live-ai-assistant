class MCPClient {
  constructor(serverConfig) {
    this.config = serverConfig;
    this.connection = null;
    this.isConnected = false;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.capabilities = null;
    this.tools = [];
    this.resources = [];
    this.prompts = [];
    this.sessionId = null; // Store session ID for HTTP requests
  }

  async connect() {
    try {
      if (this.config.url.startsWith('ws://') || this.config.url.startsWith('wss://')) {
        await this.connectWebSocket();
      } else if (this.config.transport === 'sse' || this.config.url.includes('/sse')) {
        await this.connectSSE();
      } else {
        await this.connectHTTP();
      }
      
      await this.initialize();
      this.isConnected = true;
      console.log(`Connected to MCP server: ${this.config.name}`);
      return true;
    } catch (error) {
      console.error(`Failed to connect to MCP server ${this.config.name}:`, error);
      return false;
    }
  }

  async connectWebSocket() {
    return new Promise((resolve, reject) => {
      this.connection = new WebSocket(this.config.url);
      
      this.connection.onopen = () => {
        console.log(`WebSocket connection established to ${this.config.name}`);
        resolve();
      };
      
      this.connection.onmessage = (event) => {
        this.handleMessage(JSON.parse(event.data));
      };
      
      this.connection.onerror = (error) => {
        reject(error);
      };
      
      this.connection.onclose = () => {
        this.isConnected = false;
        console.log(`WebSocket connection closed for ${this.config.name}`);
      };
    });
  }

  async connectSSE() {
    return new Promise((resolve, reject) => {
      // For SSE, we need both an EventSource for receiving and fetch for sending
      const sseUrl = this.config.url.includes('/sse') ? this.config.url : `${this.config.url}/sse`;
      
      console.log(`Attempting SSE connection to: ${sseUrl}`);
      
      this.connection = {
        type: 'sse',
        url: this.config.url.replace('/sse', '/mcp'),
        sseUrl: sseUrl,
        eventSource: null,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
        }
      };
      
      // Create EventSource for receiving messages
      try {
        this.connection.eventSource = new EventSource(sseUrl);
        
        this.connection.eventSource.onopen = () => {
          console.log(`SSE connection established to ${this.config.name}`);
          resolve();
        };
        
        this.connection.eventSource.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse SSE message:', error);
          }
        };
        
        this.connection.eventSource.onerror = (error) => {
          console.error('SSE connection error:', error);
          if (!this.isConnected) {
            reject(error);
          } else {
            this.isConnected = false;
          }
        };
        
        this.connection.eventSource.onclose = () => {
          console.log(`SSE connection closed for ${this.config.name}`);
          this.isConnected = false;
        };
        
      } catch (error) {
        console.error('Failed to create SSE connection:', error);
        reject(error);
      }
    });
  }

  async connectHTTP() {
    this.connection = {
      type: 'http',
      url: this.config.url,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
      }
    };
  }

  async initialize() {
    const initRequest = {
      jsonrpc: '2.0',
      id: this.generateRequestId(),
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {
          experimental: {},
          sampling: {}
        },
        clientInfo: {
          name: 'roam-extension-speech-to-roam',
          version: '1.0.0'
        }
      }
    };

    const response = await this.sendRequest(initRequest);
    if (response.result) {
      this.capabilities = response.result.capabilities;
      console.log('MCP server capabilities:', this.capabilities);
      
      await this.loadTools();
      await this.loadResources();
      await this.loadPrompts();
    }
  }

  async loadTools() {
    if (!this.capabilities?.tools) return;
    
    try {
      const response = await this.sendRequest({
        jsonrpc: '2.0',
        id: this.generateRequestId(),
        method: 'tools/list'
      });
      
      if (response.result?.tools) {
        this.tools = response.result.tools;
        console.log(`Loaded ${this.tools.length} tools from ${this.config.name}`);
      }
    } catch (error) {
      console.error('Failed to load tools:', error);
    }
  }

  async loadResources() {
    if (!this.capabilities?.resources) return;
    
    try {
      const response = await this.sendRequest({
        jsonrpc: '2.0',
        id: this.generateRequestId(),
        method: 'resources/list'
      });
      
      if (response.result?.resources) {
        this.resources = response.result.resources;
        console.log(`Loaded ${this.resources.length} resources from ${this.config.name}`);
      }
    } catch (error) {
      console.error('Failed to load resources:', error);
    }
  }

  async loadPrompts() {
    if (!this.capabilities?.prompts) return;
    
    try {
      const response = await this.sendRequest({
        jsonrpc: '2.0',
        id: this.generateRequestId(),
        method: 'prompts/list'
      });
      
      if (response.result?.prompts) {
        this.prompts = response.result.prompts;
        console.log(`Loaded ${this.prompts.length} prompts from ${this.config.name}`);
      }
    } catch (error) {
      console.error('Failed to load prompts:', error);
    }
  }

  async callTool(name, arguments_) {
    if (!this.isConnected) {
      throw new Error('Not connected to MCP server');
    }

    const request = {
      jsonrpc: '2.0',
      id: this.generateRequestId(),
      method: 'tools/call',
      params: {
        name,
        arguments: arguments_ || {}
      }
    };

    console.log(`🔧 [MCP CLIENT] Sending tool call request:`, JSON.stringify(request, null, 2));
    
    const response = await this.sendRequest(request);
    
    console.log(`📦 [MCP CLIENT] Received response:`, JSON.stringify(response, null, 2));
    
    return response;
  }

  async getResource(uri) {
    if (!this.isConnected) {
      throw new Error('Not connected to MCP server');
    }

    const request = {
      jsonrpc: '2.0',
      id: this.generateRequestId(),
      method: 'resources/read',
      params: {
        uri
      }
    };

    return await this.sendRequest(request);
  }

  async getPrompt(name, arguments_) {
    if (!this.isConnected) {
      throw new Error('Not connected to MCP server');
    }

    const request = {
      jsonrpc: '2.0',
      id: this.generateRequestId(),
      method: 'prompts/get',
      params: {
        name,
        arguments: arguments_ || {}
      }
    };

    return await this.sendRequest(request);
  }

  async sendRequest(request) {
    if (this.connection instanceof WebSocket) {
      // WebSocket connection - async with pendingRequests
      return new Promise((resolve, reject) => {
        this.pendingRequests.set(request.id, { resolve, reject });
        this.connection.send(JSON.stringify(request));
        
        setTimeout(() => {
          if (this.pendingRequests.has(request.id)) {
            this.pendingRequests.delete(request.id);
            reject(new Error('Request timeout'));
          }
        }, 30000);
      });
    } else if (this.connection.type === 'sse') {
      // SSE connection - send via HTTP POST, receive via EventSource  
      return new Promise((resolve, reject) => {
        this.pendingRequests.set(request.id, { resolve, reject });
        
        // Just send the request, response will come via EventSource -> handleMessage
        this.sendHTTPRequestOnly(request).catch(reject);
        
        setTimeout(() => {
          if (this.pendingRequests.has(request.id)) {
            this.pendingRequests.delete(request.id);
            reject(new Error('Request timeout'));
          }
        }, 30000);
      });
    } else {
      // Regular HTTP connection - synchronous request/response
      const response = await this.sendHTTPRequest(request);
      
      // Process the response through handleMessage for consistency
      if (response.error) {
        throw new Error(response.error.message || 'MCP request failed');
      }
      
      return response;
    }
  }

  async sendHTTPRequest(request) {
    try {
      console.log(`🔥 [HTTP] Sending request to: ${this.connection.url}`);
      console.log(`🔥 [HTTP] Headers:`, this.connection.headers);
      console.log(`🔥 [HTTP] Body:`, JSON.stringify(request, null, 2));
      
      // Add session ID header if available
      const headers = { ...this.connection.headers };
      if (this.sessionId) {
        headers['Mcp-Session-Id'] = this.sessionId;
        console.log(`🔥 [HTTP] Using session ID:`, this.sessionId);
      }
      
      const response = await fetch(this.connection.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request)
      });
      
      console.log(`🔥 [HTTP] Response status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`🚨 [HTTP] Error response body:`, errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const text = await response.text();
      console.log(`🔥 [HTTP] Raw response:`, text);
      
      // Parse SSE format if needed
      if (text.startsWith('event: message')) {
        const lines = text.split('\n');
        const dataLine = lines.find(line => line.startsWith('data: '));
        const idLine = lines.find(line => line.startsWith('id: '));
        
        if (dataLine) {
          const parsed = JSON.parse(dataLine.substring(6)); // Remove 'data: ' prefix
          
          // Extract session ID for future requests
          if (idLine && parsed.method === undefined) { // Only for responses, not notifications
            this.sessionId = idLine.substring(4); // Remove 'id: ' prefix
            console.log(`🔥 [HTTP] Captured session ID:`, this.sessionId);
          }
          
          console.log(`🔥 [HTTP] Parsed SSE:`, parsed);
          return parsed;
        }
      }
      
      // Fallback to regular JSON
      const parsed = JSON.parse(text);
      console.log(`🔥 [HTTP] Parsed JSON:`, parsed);
      return parsed;
    } catch (error) {
      console.error('🚨 [HTTP] Request failed:', error);
      throw error;
    }
  }

  async sendHTTPRequestOnly(request) {
    try {
      const response = await fetch(this.connection.url, {
        method: 'POST',
        headers: this.connection.headers,
        body: JSON.stringify(request)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // For SSE, we don't return the response, it comes via EventSource
      console.log(`🔥 [SSE] HTTP request sent, waiting for SSE response`);
    } catch (error) {
      console.error('SSE HTTP request failed:', error);
      throw error;
    }
  }

  handleMessage(message) {
    console.log(`📨 [MCP CLIENT] Received message:`, JSON.stringify(message, null, 2));
    
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);
      
      if (message.error) {
        console.error(`❌ [MCP CLIENT] Server returned error:`, JSON.stringify(message.error, null, 2));
        reject(new Error(message.error.message || 'MCP request failed'));
      } else {
        console.log(`✅ [MCP CLIENT] Server returned success:`, JSON.stringify(message, null, 2));
        resolve(message);
      }
    }
  }

  generateRequestId() {
    return ++this.requestId;
  }

  disconnect() {
    if (this.connection instanceof WebSocket) {
      this.connection.close();
    } else if (this.connection?.type === 'sse' && this.connection.eventSource) {
      this.connection.eventSource.close();
    }
    this.isConnected = false;
    this.pendingRequests.clear();
  }

  getTools() {
    return this.tools;
  }

  getResources() {
    return this.resources;
  }

  getPrompts() {
    return this.prompts;
  }

  getServerInfo() {
    return {
      name: this.config.name,
      url: this.config.url,
      isConnected: this.isConnected,
      capabilities: this.capabilities,
      toolsCount: this.tools.length,
      resourcesCount: this.resources.length,
      promptsCount: this.prompts.length
    };
  }
}

export default MCPClient;