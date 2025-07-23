import { mcpManager } from './mcpManager.js';
import { aiCompletionRunner } from '../../responseInsertion.js';
import { getAndNormalizeContext } from '../../dataExtraction.js';

export class MCPExecutor {
  static async executeMCPResource({
    serverId,
    resourceUri,
    sourceUid,
    prompt = "",
    additionalPrompt = "",
    instantModel,
    target = "new",
    roamContext = null,
    style = "Normal"
  }) {
    try {
      const response = await mcpManager.getResource(serverId, resourceUri);
      
      if (!response.result || !response.result.contents) {
        throw new Error('No content from MCP resource');
      }

      let content = response.result.contents;
      
      if (Array.isArray(content)) {
        content = content.map(item => {
          if (item.type === 'text') {
            return item.text;
          } else if (item.type === 'blob') {
            return `Binary data: ${item.mimeType}`;
          }
          return JSON.stringify(item);
        }).join('\n\n');
      }

      let finalPrompt = prompt;
      if (additionalPrompt) {
        finalPrompt = prompt ? `${prompt}\n\n${additionalPrompt}` : additionalPrompt;
      }

      if (finalPrompt && instantModel) {
        const enhancedPrompt = `${finalPrompt}\n\nBased on the following resource content:\n\n${content}`;
        
        await aiCompletionRunner({
          sourceUid,
          prompt: enhancedPrompt,
          additionalPrompt: "",
          command: `MCP Resource: ${resourceUri}`,
          instantModel,
          includeUids: false,
          target,
          style,
          roamContext
        });
      } else {
        await aiCompletionRunner({
          sourceUid,
          prompt: content,
          additionalPrompt: "",
          command: `MCP Resource: ${resourceUri}`,
          instantModel: instantModel || "gpt-4o-mini",
          includeUids: false,
          target,
          style: "Normal",
          roamContext: null
        });
      }
      
      return { success: true, result: content };
    } catch (error) {
      console.error(`Error executing MCP resource ${resourceUri}:`, error);
      
      const errorMessage = `Error accessing MCP resource "${resourceUri}": ${error.message}`;
      await aiCompletionRunner({
        sourceUid,
        prompt: errorMessage,
        additionalPrompt: "",
        command: `MCP Resource Error: ${resourceUri}`,
        instantModel: "gpt-4o-mini",
        includeUids: false,
        target,
        style: "Normal",
        roamContext: null
      });
      
      return { success: false, error: error.message };
    }
  }

  static async executeMCPPrompt({
    serverId,
    promptName,
    promptArguments = {},
    sourceUid,
    additionalPrompt = "",
    instantModel,
    target = "new",
    roamContext = null,
    style = "Normal"
  }) {
    try {
      const response = await mcpManager.getPrompt(serverId, promptName, promptArguments);
      
      if (!response.result || !response.result.messages) {
        throw new Error('No messages from MCP prompt');
      }

      let content = response.result.messages.map(message => {
        if (message.role === 'user' || message.role === 'assistant') {
          if (message.content.type === 'text') {
            return `${message.role}: ${message.content.text}`;
          }
        }
        return JSON.stringify(message);
      }).join('\n\n');

      let finalPrompt = content;
      if (additionalPrompt) {
        finalPrompt = `${content}\n\n${additionalPrompt}`;
      }

      await aiCompletionRunner({
        sourceUid,
        prompt: finalPrompt,
        additionalPrompt: "",
        command: `MCP Prompt: ${promptName}`,
        instantModel: instantModel || "gpt-4o-mini",
        includeUids: false,
        target,
        style,
        roamContext
      });
      
      return { success: true, result: content };
    } catch (error) {
      console.error(`Error executing MCP prompt ${promptName}:`, error);
      
      const errorMessage = `Error executing MCP prompt "${promptName}": ${error.message}`;
      await aiCompletionRunner({
        sourceUid,
        prompt: errorMessage,
        additionalPrompt: "",
        command: `MCP Prompt Error: ${promptName}`,
        instantModel: "gpt-4o-mini",
        includeUids: false,
        target,
        style: "Normal",
        roamContext: null
      });
      
      return { success: false, error: error.message };
    }
  }

  static buildRoamContextForMCP(roamContext) {
    if (!roamContext) return {};
    
    return {
      hasPageContext: roamContext.page,
      hasSidebarContext: roamContext.sidebar,
      hasLinkedPagesContext: roamContext.linkedPages,
      hasLinkedRefsContext: roamContext.linkedRefs,
      hasLogPagesContext: roamContext.logPages,
      hasBlockContext: roamContext.block
    };
  }

  static async prepareContextForMCP(roamContext) {
    if (!roamContext) return "";
    
    try {
      const context = await getAndNormalizeContext({ roamContext });
      return context;
    } catch (error) {
      console.error('Error preparing Roam context for MCP:', error);
      return "";
    }
  }
}

export default MCPExecutor;