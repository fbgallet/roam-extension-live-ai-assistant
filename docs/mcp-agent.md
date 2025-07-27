# MCP (Model Context Protocol) Integration

Live AI turns Roam Research into a comprehensive MCP Client. Connect external tools, databases, and services to your Roam workspace through an intelligent AI agent that can orchestrate MCP tools and even complex workflows across multiple MCP servers.

## What You Can Do

### 🤖 MCP Agent (tools orchestrator)

Transform your connected MCP servers into smart assistants that understand your goals and automatically choose the right tools to accomplish them. The MCP agent support **single-Server** and **multi-server** workflows.

### 🛠️ Direct Tool Access

Use individual tools when you need precise control over specific operations. Enable/disable any tool in the MCP servers configuration panel.

### 📚 Resources & Prompts

Access remote data sources and pre-built prompt templates from your connected servers. MCP prompts help you to guide your interaction with the MCP server to leverage their capabilities for a specific purpose.

## How to Use

### Getting Started

1. **Open the Context Menu**: Right-click + Cmd/Meta anywhere in Roam
2. **Configure MCP Servers**: Click the MCP server icon on the top-right (database with lightning bolt) to add your first server
3. **Start Using**: Describe what you want to accomplish in any block and run an MCP agent command for the choosen MCP server from Live AI context menu

### Three Ways to Work with MCP

#### 1. Smart Agents (Recommended)

**Best for**: Complex tasks requiring multiple steps or tools

**How it works**: Describe your goal in natural language, and the AI agent automatically:

- Analyzes available tools from your connected servers
- Creates an execution plan (for multi-server tasks)
- Executes tools in the right sequence
- Synthesizes results into a comprehensive response

**Commands:**

- **"All Servers (X)"** - Coordinates across all your connected servers
- **"Server: [Name]"** - Uses tools from a specific server only

**Example:**

```
Select: "All Servers (3)"
Prompt: "Find recent user complaints in the database, analyze the related code, and update the troubleshooting documentation"

Result: Agent automatically queries database → analyzes code files → updates docs → provides comprehensive report
```

#### 2. Individual Tools

**Best for**: Specific, single-tool operations

**How it works**: Direct access to individual functions from your MCP servers.

**Commands:** `[ServerName]: [ToolName]` (e.g., "FileSystem: search_files")

**Example:**

```
Select: "DevTools: git_log"
Result: Shows recent Git commits directly
```

#### 3. Resources & Prompts

**Best for**: Accessing data sources or using pre-built templates

**Commands:**

- **MCP Resources**: `[ServerName]: [ResourceName]`
- **MCP Prompts**: `[ServerName]: [PromptName]`

## Configuration

### 1. Adding a local HTTP/SSE or WebSocket MCP Server

**Via Context Menu**

1. Right-click + Meta/Cmd to open the Live AI context menu
2. Click the MCP server icon on the top-right (database with lightning bolt)
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

Many MCP servers use stdio (standard input/output) for communication, which browsers cannot access directly. For these servers, you'll need to use the **Roam MCP Bridge**. The bridge is also needed for remove MCP servers.

**Bridge Setup:**

1. Visit the [Roam MCP Bridge repository](https://github.com/fbgallet/roam-mcp-bridge/blob/main/README.md) for detailed setup instructions
2. The bridge converts stdio MCP servers to HTTP endpoints that your browser extension can use
3. Follow the README to install and run the bridge locally
4. Once running, add `http://localhost:8000` (or your configured port) as the MCP server URL in your extension

**Why a Bridge is Needed:**

- **stdio MCP servers** communicate via standard input/output (designed for desktop applications like Claude Desktop)
- **Browser security** prevents direct process spawning and stdio access.
- CORS policy will also prevent to connect directly from Roam to a remote MCP Server.
- **HTTP bridge** acts as a translator between browser HTTP requests and stdio MCP servers
  => This enables access to the full ecosystem of stdio-based MCP servers from your browser extension

### 3. Testing Connection

- Use the test button (satellite icon) to verify connection
- Status is displayed with color coding:
  - Green: Successfully connected
  - Red: Connection error
  - Gray: Disabled

## Common Use Cases

### Development Workflow

**Server**: Development Tools (git, file system, testing)
**Prompt**: "Review the authentication changes in the last commit and run the security tests"
**What happens**: Agent gets commit info → analyzes files → runs security tests → provides review

### Research & Writing

**Servers**: Web Search + Document Management
**Prompt**: "Find recent articles about sustainable energy and create a summary document"
**What happens**: Agent searches web → filters results → extracts key points → creates formatted document

### Data Analysis

**Server**: Database Tools
**Prompt**: "Show me user engagement trends from the last quarter"
**What happens**: Agent queries database → calculates metrics → generates visualizations → provides insights

### Multi-System Workflows

**Servers**: Database + Development + Documentation
**Prompt**: "Check user activity data, review related code, and update the API documentation"
**What happens**: Agent coordinates across all three systems to complete the full workflow

## Tips for Better Results

### Writing Effective Prompts

- **Be specific about your goal**: "Analyze security vulnerabilities in auth code" vs "Check the code"
- **Include context**: "Using the user feedback from last month, identify the top 3 issues"
- **Specify output format**: "Create a summary table" or "List the top 5 findings"

### Choosing the Right Command

- **Use "All Servers"** for tasks that might need multiple systems
- **Use "Server: [Name]"** when you know exactly which server has the tools you need
- **Use individual tools** for quick, specific operations

### Roam Context Integration

The agent can uses your current Roam context:

- **Selected text or blocks** are part of the prompt
- **Current page**, pages in **Sidebar** or **Linked references** provides background context

### MCP Agent Iterations & Conversations

MCP agents support all Live AI capabilities for iterative improvement and conversations:

#### Live AI Block Buttons

After any MCP agent execution, use the **Live AI buttons** that appear on the right side of result blocks:

- **🔄 Retry**: Re-run the same MCP agent command with the same prompt

  - Useful when an execution failed or produced incomplete results
  - Maintains the same tool selection and parameters

- **⚡ Retry Better**: Re-run with enhanced instructions to improve the result

  - Automatically adds context about what could be improved
  - Asks the agent to refine its approach and provide better output
  - You can provide more guidance to the agent by writting some instructions in any block and focusing on this block when clicking the retry button

- **💬 Continue**: Start a conversation mode with the MCP agent
  - Follow up with questions or additional requests
  - Agent maintains context of previous tool executions and results
  - Perfect for iterative workflows: "Now analyze the security implications" or "Create a summary report"

#### Conversation Examples

**Initial MCP execution:**

```
Prompt: "Find user authentication files in the codebase"
Result: Agent finds and lists authentication-related files
```

**Follow-up using Continue button:**

```
Follow-up: "Now analyze these files for security vulnerabilities"
Result: Agent analyzes the previously found files for security issues
```

**Another follow-up:**

```
Follow-up: "Create a summary report with recommendations"
Result: Agent synthesizes findings into a formatted report with actionable recommendations
```

This conversation capability makes MCP agents particularly powerful for complex, multi-step workflows where you might need to refine or expand on initial results.

## Troubleshooting

### Connection Issues

1. Verify the URL is correct
2. Ensure the MCP server is running
3. Check firewall/proxy settings
4. Test with HTTP before WebSocket

### Commands Not Appearing

- Check that your server is connected (green status)
- Use the refresh icon in the context menu
- Restart the extension if needed

### Execution Errors

- Errors are displayed in the Roam results
- Check MCP server logs for details
- Try using individual tools to isolate issues

## Example Server Configurations

### Local Development

```
Name: Dev Tools
URL: ws://localhost:3000/mcp
Description: Git, file system, testing tools
```

### Cloud Database

```
Name: Company Database
URL: https://api.company.com/mcp
API Key: sk-your-key-here
Description: User data and analytics
```

### Bridge-Connected Service

```
Name: Readwise
URL: http://localhost:8000
Description: Reading highlights via MCP bridge
```

For more information on the MCP protocol: https://modelcontextprotocol.io/
