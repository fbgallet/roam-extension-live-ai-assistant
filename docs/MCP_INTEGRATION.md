# MCP (Model Context Protocol) Integration

This Roam extension now supports the Model Context Protocol (MCP) which allows connecting to external servers to access remote tools, resources, and prompts.

## 🤖 Agentive MCP Usage (Recommended)

The extension provides an **enhanced agentive experience** that goes beyond Claude Desktop capabilities. Each connected MCP server appears as an intelligent agent with advanced planning and coordination capabilities:

### Key Intelligence Features

- **Hybrid Execution**: Pure ReAct for single servers (maximum speed), strategic planning for multi-server coordination
- **Multi-Server Coordination**: Can orchestrate tools across multiple MCP servers simultaneously with intelligent planning
- **Context Optimization**: Efficiently manages conversation history to minimize token usage
- **Retry Intelligence**: Learns from previous attempts to improve response quality
- **Token Efficiency**: Optimized approach reduces overhead for single-server operations

### Execution Modes

**Pure ReAct Mode** (single server):
- Direct tool reasoning and execution
- Maximum speed and efficiency
- Natural ReAct (Reasoning and Acting) loop
- No planning overhead

**Strategic Planning Mode** (multi-server):
- Coordinated execution across multiple servers
- Strategic planning for cross-server workflows
- Tool orchestration and dependency management
- Optimized server utilization

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
   - **🤖 MCP AGENTS** *(Recommended)*: Intelligent agents for server coordination
     - **All Servers (X)**: Multi-server coordinator (appears when 2+ servers connected)
     - **Server: [Name]**: Individual server agents
   - **MCP TOOLS**: Individual executable tools from servers
   - **MCP RESOURCES**: Accessible resources (data, files)
   - **MCP PROMPTS**: Predefined prompts from servers

### Primary Usage: MCP Agents

**Use MCP Agent: [Server Name]** commands provide the best experience:

1. **Natural interaction**: Just describe what you want to accomplish
2. **Hybrid intelligence**: Pure ReAct for single servers, strategic planning for multi-server coordination
3. **Optimized execution**: Maximum speed for single-server requests, intelligent coordination for multi-server workflows
4. **Automatic tool selection**: The LLM chooses appropriate tools through reasoning or planning
5. **Multi-tool orchestration**: Can use multiple tools in optimal sequence
6. **Multi-server coordination**: Can work across multiple MCP servers simultaneously with strategic planning
7. **Context-aware**: Integrates with your selected Roam context
8. **Conversation continuity**: Remembers previous interactions and tool results

**Example workflows:**

**Single Server Request (Pure ReAct):**
- Select: "Use MCP Agent: Development Tools"
- Prompt: "Find all authentication-related files, check their test coverage, and identify security vulnerabilities"
- Result: Agent uses natural ReAct reasoning → searches files → analyzes code → runs coverage tools → performs security scan → synthesizes comprehensive report
- Execution: Fast, direct tool reasoning without planning overhead

**Simple Single Server Request:**
- Select: "Use MCP Agent: Development Tools"
- Prompt: "Show me the main.py file"
- Result: Direct file retrieval using ReAct reasoning

**Multi-Server Request** (using "All Servers" command):
- Select: "All Servers (3)" *(appears when 2+ servers connected)*
- Prompt: "Get recent user feedback from the database and create a summary document"
- Result: Agent creates strategic plan → coordinates between database server and document server → queries data → processes feedback → creates formatted document
- Execution: Strategic planning ensures optimal cross-server coordination

**Single Server Request** (using individual server):
- Select: "Use MCP Agent: Development Tools"
- Prompt: "Show me recent git commits"
- Result: Uses pure ReAct reasoning to access git tools from Development Tools server only
- Execution: Fast, direct execution without planning overhead

### MCP Item Types

#### 🤖 MCP Agents (Primary Method)

**All Servers Command** (Multi-Server Coordinator):
- **Automatic Availability**: Appears when 2+ MCP servers are connected
- **Priority Display**: Shows first in MCP AGENTS category as "All Servers (X)"
- **Strategic Planning**: Always uses intelligent planning for cross-server coordination
- **Unified Interface**: Single command to access the full ecosystem of your MCP servers
- **Smart Distribution**: AI determines which servers to use for different parts of your request

**Individual Server Agents**:
- **Server-Specific**: Each connected server gets its own dedicated agent command
- **Pure ReAct Execution**: Uses fast, direct tool reasoning without planning overhead
- **Focused Scope**: Limited to tools and resources from that specific server
- **Optimized Performance**: Maximum speed for single-server operations

**Common Features** (All MCP Agents):
- **Hybrid Intelligence**: Pure ReAct for single servers, strategic planning for multi-server coordination
- **Execution Optimization**: Chooses the most efficient approach based on server configuration
- **Intelligent orchestration**: AI decides which tools to use and in what sequence
- **Natural language interface**: Describe your goal, not individual steps
- **Multi-tool workflows**: Chains multiple tools automatically based on dependencies
- **Context optimization**: Efficiently manages conversation context to minimize token usage
- **Contextual awareness**: Uses your Roam selection as input
- **Comprehensive responses**: Synthesizes results from multiple tools and servers
- **Conversation continuity**: Maintains context across interactions for follow-up questions

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

**Hybrid Agent Workflow:**
1. **User provides natural language prompt** (e.g., "Analyze the recent changes to user authentication")
2. **Server Detection**: Agent determines if single server or multi-server request
   - **Single server** → Pure ReAct execution (direct tool reasoning)
   - **Multi-server** → Strategic planning mode
3. **Execution Path**:
   
   **Single Server (Pure ReAct):**
   - Agent reasons about available tools
   - Executes tools based on natural reasoning loop
   - No planning overhead for maximum speed
   
   **Multi-Server (Strategic Planning):**
   - Creates strategic execution plan
   - Coordinates tools across servers
   - Manages cross-server dependencies
   - Optimizes server utilization

4. **Agent receives full tool inventory** from connected MCP server(s)
5. **Intelligent Execution**: Tools are executed through ReAct reasoning or strategic plan
6. **Results are synthesized** into a comprehensive response

**Intelligence Features:**
- **Hybrid Approach**: Pure ReAct for single servers, strategic planning for multi-server coordination
- **Execution Optimization**: Chooses the most efficient approach based on server configuration
- **Context Optimization**: Reuses conversation context efficiently to minimize token usage
- **Retry Intelligence**: Analyzes previous attempts to improve responses

**vs. Individual Tool Usage:**
- **Single Server Agent**: "Check the test coverage for authentication code"
  - → Agent uses ReAct reasoning → searches files → analyzes code → runs coverage tools → synthesizes report (fast execution)
- **Multi-Server Agent**: "Get user data from database and update documentation"
  - → Agent creates plan → coordinates database + docs servers → executes across servers → synthesizes results
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

### Data Management (Single Server)
**MCP Server**: Database Tools (SQL, analytics, reporting)
**Prompt**: "Show me user engagement trends over the last quarter"
**Agent Actions** (Pure ReAct):
1. **Direct Reasoning**: Uses ReAct to reason about available database tools
2. **Tool Execution**: Queries user activity database → Calculates engagement metrics → Generates trend analysis → Creates visualization data
3. **Synthesis**: Provides actionable insights combining all results
4. **Performance**: Fast execution without planning overhead

### Multi-Server Workflow
**MCP Servers**: Development Tools + Documentation Server + Testing Tools
**Prompt**: "Review the authentication system, update the documentation, and ensure all tests pass"
**Agent Actions** (Strategic Planning):
1. **Multi-Server Detection**: Identifies multi-server workflow requiring coordination
2. **Strategic Planning**: Creates execution plan coordinating between three different servers
3. **Orchestrated Execution**: 
   - Development Tools: Analyzes authentication code
   - Documentation Server: Updates technical documentation
   - Testing Tools: Runs comprehensive test suite
4. **Integrated Results**: Provides unified report on code review, documentation updates, and test results

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

### Multi-Server Configuration Example
```
# Server 1: Development Tools
Name: Dev Tools
URL: ws://localhost:3000/mcp
Description: File system, git, testing tools

# Server 2: Database Access
Name: Database
URL: https://api.company.com/mcp
API Key: sk-database-key
Description: User data, analytics, reporting

# Server 3: Documentation
Name: Docs
URL: http://localhost:8001
Description: Wiki, documentation management
```

**Multi-Server Usage:**  
With multiple servers configured, you have two options:

**Option 1: All Servers Command** *(Recommended for cross-server tasks)*
- Command: "All Servers (3)" *(automatically appears when 3+ servers connected)*
- Example: "Analyze user engagement from the database, check related code in development tools, and update the documentation"
- Result: Agent automatically coordinates across all three servers to complete the request
- Best for: Complex workflows requiring multiple server types

**Option 2: Individual Server Commands** *(Targeted operations)*
- Commands: "Server: Database", "Server: Dev Tools", "Server: Docs"
- Example: Select "Server: Database" → "Show me user engagement trends"
- Result: Uses only the Database server tools
- Best for: Server-specific operations or when you know the exact server needed

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
- **Single Server**: Uses pure ReAct execution, errors are handled through natural reasoning loops
- **Multi-Server Planning Errors**: If planning fails, the agent uses fallback templates and continues with available servers
- **Multi-Server Errors**: If one server fails, the agent continues with available servers and reports which operations couldn't be completed

### Refresh
- Use the refresh icon in the context menu to reload MCP tools
- Restart the extension if needed via Roam settings

## Advanced Features

### Hybrid Execution System
- **Single Server Optimization**: Uses pure ReAct for maximum speed and efficiency
- **Multi-Server Coordination**: Employs strategic planning for cross-server workflows
- **Automatic Detection**: Intelligently chooses execution mode based on server configuration
- **Performance Optimization**: Eliminates unnecessary overhead for single-server operations

### Multi-Server Support
- **Unified Interface**: "All Servers" command provides single prompt coordination across multiple MCP servers
- **Automatic Command Creation**: "All Servers (X)" command appears automatically when 2+ servers are connected
- **Tool Namespacing**: Automatically handles naming conflicts between servers (e.g., `server1:search`, `server2:search`)
- **Cross-Server Dependencies**: Intelligent coordination of tools across different servers
- **Smart Server Selection**: AI automatically determines which servers to use for different request components
- **Fallback Resilience**: If one server fails, continues with available servers and reports limitations
- **Configuration**: Supports both individual server setup via UI and automatic multi-server coordination

### Context Management
- **Token Optimization**: Efficient handling of conversation history to minimize API costs
- **Cache Utilization**: Reuses previous tool results when applicable
- **Context Levels**: Different context depths for planning vs. execution phases

### Retry Intelligence
- **Failure Analysis**: Analyzes previous attempts to improve retry strategies
- **Adaptive Planning**: Adjusts approach based on what didn't work previously
- **Context Preservation**: Maintains relevant context while optimizing for improved results

## Technical Specifications

- Compatible with MCP version 2025-06-18
- WebSocket and HTTP support
- JSON-RPC 2.0 for communication
- Native integration with existing extension architecture
- **Agent Architecture**: LangGraph-based with hybrid execution system
- **Single Server Mode**: Pure ReAct implementation for optimal performance
- **Multi-Server Mode**: Strategic planning with cross-server coordination
- **Multi-Server Support**: Arrays of server IDs and names for coordinated operations
- **Context Optimization**: Intelligent conversation context management
- **Planning System**: JSON-based execution planning for multi-server workflows only

For more information on the MCP protocol: https://modelcontextprotocol.io/