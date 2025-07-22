# MCP (Model Context Protocol) Integration

This Roam extension now supports the Model Context Protocol (MCP) which allows connecting to external servers to access remote tools, resources, and prompts.

## 🤖 Agentive MCP Usage (Recommended)

The extension provides an **agentive experience** similar to Claude Desktop, where the LLM automatically decides which tools to use based on your prompt. Each connected MCP server appears as an intelligent agent that can orchestrate multiple tools seamlessly.

## Configuration

### 1. Adding an MCP Server

**Method 1: Via Extension Settings**
1. Go to the extension settings (`Live AI Assistant`)
2. Find the `MCP Servers` section
3. Click `Add Server`

**Method 2: Via Context Menu**
1. Right-click + Meta/Cmd to open the Live AI context menu
2. Click the satellite icon (🛰️) in the top toolbar
3. Click `Add Server` in the configuration dialog
4. Fill in the information:
   - **Name**: A descriptive name for the server
   - **URL**: The MCP server URL (WebSocket or HTTP)
     - WebSocket: `ws://localhost:3000/mcp` or `wss://api.example.com/mcp`
     - HTTP: `https://api.example.com/mcp` or `http://localhost:8000` (for local bridge)
   - **API Key**: (Optional) Authentication key if required
   - **Description**: (Optional) Description of server capabilities
   - **Enable**: Check to enable automatic connection

### 2. Using stdio MCP Servers (via Bridge)

Many MCP servers use stdio (standard input/output) for communication, which browsers cannot access directly. For these servers, you'll need to use the **Roam MCP Bridge**.

**Bridge Setup:**
1. Visit the [Roam MCP Bridge repository](https://github.com/fbgallet/roam-mcp-bridge/blob/main/README.md) for detailed setup instructions
2. The bridge converts stdio MCP servers to HTTP endpoints that your browser extension can use
3. Follow the README to install and run the bridge locally
4. Once running, add `http://localhost:8000` (or your configured port) as the MCP server URL in your extension

**Why a Bridge is Needed:**
- **stdio MCP servers** communicate via standard input/output (designed for desktop applications like Claude Desktop)
- **Browser security** prevents direct process spawning and stdio access
- **HTTP bridge** acts as a translator between browser HTTP requests and stdio MCP servers
- This enables access to the full ecosystem of stdio-based MCP servers from your browser extension

### 3. Testing Connection

- Use the test button (satellite icon) to verify connection
- Status is displayed with color coding:
  - Green: Successfully connected
  - Red: Connection error
  - Gray: Disabled

## Usage

### Context Menu

1. **Right-click + Meta/Cmd** to open the Live AI context menu
2. **Quick Configuration**: Click the satellite icon (🛰️) in the top toolbar to access MCP server configuration
3. **MCP items appear in categories**:
   - **🤖 MCP AGENTS** *(Recommended)*: One intelligent agent per connected server
   - **MCP TOOLS**: Individual executable tools from servers
   - **MCP RESOURCES**: Accessible resources (data, files)
   - **MCP PROMPTS**: Predefined prompts from servers

### Primary Usage: MCP Agents

**Use MCP Agent: [Server Name]** commands provide the best experience:

1. **Natural interaction**: Just describe what you want to accomplish
2. **Automatic tool selection**: The LLM chooses appropriate tools
3. **Multi-tool orchestration**: Can use multiple tools in sequence
4. **Context-aware**: Integrates with your selected Roam context

**Example workflow:**
- Select: "Use MCP Agent: Development Tools"
- Prompt: "Find all authentication-related files and check their test coverage"
- Result: Agent automatically uses file search, code analysis, and coverage tools

### MCP Item Types

#### 🤖 MCP Agents (Primary Method)
- **Intelligent orchestration**: AI decides which tools to use
- **Natural language interface**: Describe your goal, not individual steps
- **Multi-tool workflows**: Chains multiple tools automatically
- **Contextual awareness**: Uses your Roam selection as input
- **Comprehensive responses**: Synthesizes results from multiple tools

#### Individual MCP Items (Advanced/Granular Access)

**Tools**
- Direct access to specific server functions
- Manual tool selection and execution
- Useful for precise, single-tool operations

**Resources**
- Direct access to remote data (files, databases, APIs)
- Content retrieved and used as context for the LLM

**Prompts**
- Predefined prompt templates from the server
- Can include dynamic variables
- Executed directly by the LLM

### How MCP Agents Work

**Agent Workflow:**
1. **User provides natural language prompt** (e.g., "Analyze the recent changes to user authentication")
2. **Agent receives full tool inventory** from the MCP server
3. **LLM decides which tools to use** based on the prompt and available capabilities
4. **Tools are executed automatically** in the optimal sequence
5. **Results are synthesized** into a comprehensive response

**vs. Individual Tool Usage:**
- **Agent**: "Check the test coverage for authentication code"
  - → Agent automatically: searches files → analyzes code → runs coverage tools → synthesizes report
- **Individual**: Manual selection of search tool → manual selection of analysis tool → manual selection of coverage tool

### Roam Context Integration

The selected context in Roam (page, blocks, linked references, etc.) is automatically transmitted to MCP agents and tools to enrich their execution:

- **Page context**: Current page content
- **Block selection**: Specific blocks or text selection  
- **Linked references**: Related content from other pages
- **Daily notes**: Temporal context from DNPs
- **Sidebar content**: Additional context sources

## Security

- Connections use HTTPS/WSS in production
- API keys are stored locally and securely
- Each MCP server operates in isolation
- Errors are handled and displayed clearly

## Example Use Cases

### Development Workflow
**MCP Server**: Development Tools (file system, git, testing)
**Prompt**: "Review the changes in the last commit and suggest improvements"
**Agent Actions**: 
1. Gets recent commit info
2. Analyzes changed files
3. Runs relevant tests
4. Checks code quality metrics
5. Provides comprehensive review

### Research & Analysis
**MCP Server**: Research Tools (web search, database, documents)
**Prompt**: "Find recent papers about machine learning in healthcare"
**Agent Actions**:
1. Searches academic databases
2. Filters by date and relevance
3. Retrieves paper abstracts
4. Summarizes key findings
5. Identifies research trends

### Data Management
**MCP Server**: Database Tools (SQL, analytics, reporting)
**Prompt**: "Show me user engagement trends over the last quarter"
**Agent Actions**:
1. Queries user activity database
2. Calculates engagement metrics
3. Generates trend analysis
4. Creates visualization data
5. Provides actionable insights

## Example MCP Servers

### Local Development Server
```
Name: Dev Tools
URL: ws://localhost:3000/mcp
Description: Local development tools
```

### External API
```
Name: External API
URL: https://api.example.com/mcp
API Key: sk-your-api-key-here
Description: External data access via MCP
```

### stdio MCP Server via Bridge
```
Name: Readwise MCP
URL: http://localhost:8000
Description: Readwise highlights and books (via roam-mcp-bridge)
```

*Note: The bridge must be running with the Readwise server configured. See the [bridge repository](https://github.com/fbgallet/roam-mcp-bridge) for setup details.*

## Troubleshooting

### Connection Issues
1. Verify the URL is correct
2. Ensure the MCP server is running
3. Check firewall/proxy settings
4. Test with HTTP before WebSocket

### Execution Errors
- Errors are displayed in console and Roam results
- Verify the MCP server supports protocol version 2025-06-18
- Check MCP server logs for details

### Refresh
- Use the refresh icon in the context menu to reload MCP tools
- Restart the extension if needed via Roam settings

## Technical Specifications

- Compatible with MCP version 2025-06-18
- WebSocket and HTTP support
- JSON-RPC 2.0 for communication
- Native integration with existing extension architecture

For more information on the MCP protocol: https://modelcontextprotocol.io/