/**
 * Public API for Live AI — window.LiveAI_API
 *
 * Allows other Roam extensions to use Live AI's generative capabilities
 * without needing their own API keys or AI integration code.
 *
 * Security: API keys are never exposed. All LLM calls are proxied internally.
 */

import { availableModels, defaultModel } from "..";
import { aiCompletion } from "../ai/responseInsertion";
import {
  getModelByIdentifier,
  getMaxOutput,
} from "../ai/modelRegistry";
import { textToBlockTree } from "../utils/format";
import { insertStructuredAIResponse } from "../ai/responseInsertion";
import { createChildBlock, addContentToBlock } from "../utils/roamAPI";
import { getAndNormalizeContext } from "../ai/dataExtraction";
import {
  defaultAssistantCharacter,
  roamBasicsFormat,
  hierarchicalResponseFormat,
} from "../ai/prompts";
import { getRelativeDateAndTimeString } from "../utils/roamAPI";

const API_VERSION = "1.0";
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60000;

// Rate limiter state
let requestTimestamps = [];

function checkRateLimit() {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  if (requestTimestamps.length >= RATE_LIMIT_MAX) {
    throw new Error(
      `[LiveAI_API] Rate limit exceeded: max ${RATE_LIMIT_MAX} requests per minute.`
    );
  }
  requestTimestamps.push(now);
}

function validateGenerateOptions(options) {
  if (!options || typeof options !== "object") {
    throw new Error("[LiveAI_API] generate() requires an options object.");
  }
  if (!options.prompt) {
    throw new Error("[LiveAI_API] generate() requires a 'prompt' parameter.");
  }
  if (
    typeof options.prompt !== "string" &&
    !Array.isArray(options.prompt)
  ) {
    throw new Error(
      "[LiveAI_API] 'prompt' must be a string or an array of {role, content} messages."
    );
  }
  if (Array.isArray(options.prompt)) {
    for (const msg of options.prompt) {
      if (!msg.role || !msg.content) {
        throw new Error(
          "[LiveAI_API] Each message in prompt array must have 'role' and 'content'."
        );
      }
    }
  }

  const validOutputs = ["raw", "blocks", "insert"];
  const output = options.output || "raw";
  if (!validOutputs.includes(output)) {
    throw new Error(
      `[LiveAI_API] 'output' must be one of: ${validOutputs.join(", ")}`
    );
  }
  if (output === "insert" && !options.targetUid) {
    throw new Error(
      "[LiveAI_API] 'targetUid' is required when output is 'insert'."
    );
  }

  if (
    options.responseFormat &&
    !["text", "json_object"].includes(options.responseFormat)
  ) {
    throw new Error(
      "[LiveAI_API] 'responseFormat' must be 'text' or 'json_object'."
    );
  }

  if (options.temperature != null) {
    if (typeof options.temperature !== "number" || options.temperature < 0 || options.temperature > 2) {
      throw new Error("[LiveAI_API] 'temperature' must be a number between 0 and 2.");
    }
  }

  if (options.signal && !(options.signal instanceof AbortSignal)) {
    throw new Error("[LiveAI_API] 'signal' must be an AbortSignal instance.");
  }

  if (options.context && options.roamContext) {
    throw new Error(
      "[LiveAI_API] Provide either 'context' (string) or 'roamContext' (RoamContext object), not both."
    );
  }

  if (options.streamTo && options.streamTo !== "none" && !(options.streamTo instanceof HTMLElement)) {
    throw new Error(
      "[LiveAI_API] 'streamTo' must be an HTMLElement or \"none\"."
    );
  }

  if (options.onChunk && typeof options.onChunk !== "function") {
    throw new Error("[LiveAI_API] 'onChunk' must be a function.");
  }
}

function logCaller(caller, model) {
  if (caller) {
    console.log(`[LiveAI API] Request from "${caller}" → ${model}`);
  }
}

/**
 * Build the system prompt based on options.
 *
 * - If options.systemPrompt is "none" or options.useDefaultSystemPrompt is false:
 *     use only the caller's systemPrompt (or empty string).
 * - Otherwise (default): prepend the Live AI default system prompt
 *     (assistant character + Roam formatting instructions + hierarchical format),
 *     then append the caller's systemPrompt if provided.
 */
function buildSystemPrompt(options) {
  const callerSystemPrompt = options.systemPrompt || "";

  if (options.useDefaultSystemPrompt === false) {
    // Caller explicitly opts out of default system prompt
    return callerSystemPrompt;
  }

  // Default: use Live AI's standard system prompt + Roam formatting
  let systemPrompt = defaultAssistantCharacter;
  systemPrompt += roamBasicsFormat;
  systemPrompt += `\nCurrent date and time are: ${getRelativeDateAndTimeString()}`;
  systemPrompt += hierarchicalResponseFormat;

  // Append caller's system prompt if provided
  if (callerSystemPrompt) {
    systemPrompt += "\n\n" + callerSystemPrompt;
  }

  return systemPrompt;
}

/**
 * Resolve context: either a direct string or a roamContext object.
 * When roamContext is provided, uses getAndNormalizeContext() to extract
 * text content from the Roam graph (pages, linked refs, sidebar, etc.).
 */
async function resolveContext(options) {
  if (options.context) {
    return options.context;
  }
  if (options.roamContext) {
    return await getAndNormalizeContext({
      roamContext: options.roamContext,
    });
  }
  return "";
}

/**
 * List available models with safe metadata (no API keys or library references).
 */
function listModels() {
  return availableModels.map((modelId) => {
    const registryEntry = getModelByIdentifier(modelId);
    if (registryEntry) {
      return {
        id: modelId,
        name: registryEntry.name,
        provider: registryEntry.provider,
        capabilities: registryEntry.capabilities
          ? { ...registryEntry.capabilities }
          : {},
        contextLength: registryEntry.contextLength || null,
        maxOutput: getMaxOutput(modelId) || null,
        isDefault: modelId === defaultModel,
      };
    }
    return {
      id: modelId,
      name: modelId,
      provider: "unknown",
      capabilities: {},
      contextLength: null,
      maxOutput: null,
      isDefault: modelId === defaultModel,
    };
  });
}

/**
 * Check if Live AI is available and has at least one model configured.
 */
function isAvailable() {
  return availableModels.length > 0;
}

/**
 * Get the current default model id.
 */
function getDefaultModel() {
  return defaultModel || null;
}

/**
 * Core generation method. Proxies to aiCompletion() with UI side-effects suppressed.
 *
 * System prompt behavior:
 *   - By default (useDefaultSystemPrompt !== false): the Live AI default system prompt
 *     is used (assistant character + Roam formatting rules + hierarchical format).
 *     If you also provide a systemPrompt, it is appended after the default.
 *   - If useDefaultSystemPrompt is false: only your systemPrompt is used (or empty).
 *
 * Context:
 *   - context (string): injected as-is alongside the prompt.
 *   - roamContext (RoamContext object): resolves Roam graph content (pages, linked refs,
 *     sidebar, daily notes, etc.) into text context. Same format used by Live AI internally.
 *     Cannot be combined with context string.
 *
 * RoamContext shape:
 *   {
 *     page?: boolean,               // Include current page content
 *     pageArgument?: string[],      // Specific page titles to include
 *     pageViewUid?: string,         // UID of the page view
 *     linkedRefs?: boolean,         // Include linked references
 *     linkedRefsArgument?: string[],// Specific page titles for linked refs
 *     sidebar?: boolean,            // Include right sidebar content
 *     logPages?: boolean,           // Include daily note pages
 *     logPagesArgument?: number,    // Number of daily notes to include
 *     block?: boolean,              // Include specific blocks
 *     blockArgument?: string[],     // UIDs of blocks to include
 *     children?: boolean,           // Include children of focused block
 *     siblings?: boolean,           // Include sibling blocks
 *     path?: boolean,               // Include breadcrumb path
 *     pathDepth?: number,           // Ancestors depth (0 = full)
 *     linkedPages?: boolean,        // Include pages linked from context
 *   }
 */
async function generate(options) {
  validateGenerateOptions(options);
  checkRateLimit();

  const output = options.output || "raw";
  const model = options.model || defaultModel;

  if (options.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  logCaller(options.caller, model);

  // Build system prompt (with or without Live AI defaults)
  const systemPrompt = buildSystemPrompt(options);

  // Resolve context (string or roamContext)
  const content = await resolveContext(options);

  // Normalize prompt to the format aiCompletion expects
  let prompt;
  if (typeof options.prompt === "string") {
    prompt = [{ role: "user", content: options.prompt }];
  } else {
    prompt = options.prompt;
  }

  // Determine streaming configuration for the API call
  // By default for API calls: suppress DOM stream (streamTo: "none") unless caller specifies otherwise
  const streamTo = options.streamTo !== undefined ? options.streamTo : "none";

  try {
    const aiResponse = await aiCompletion({
      instantModel: model,
      prompt,
      systemPrompt,
      content,
      responseFormat: options.responseFormat || "text",
      targetUid: output === "insert" ? options.targetUid : "",
      isButtonToInsert: false,
      thinkingEnabled: options.thinking,
      silent: true,
      onChunk: options.onChunk,
      streamTo,
    });

    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    // Build result
    const result = {
      text: typeof aiResponse === "string" ? aiResponse : JSON.stringify(aiResponse),
      model,
      provider: "",
    };

    // Resolve provider for metadata
    try {
      const registryEntry = getModelByIdentifier(model);
      if (registryEntry) {
        result.provider = registryEntry.provider;
        result.model = registryEntry.id || model;
      }
    } catch (e) {
      // Non-critical, keep going
    }

    // Handle output modes
    if (output === "blocks" || output === "insert") {
      const textForBlocks = typeof aiResponse === "string" ? aiResponse : JSON.stringify(aiResponse);
      result.blocks = textToBlockTree(textForBlocks);

      if (output === "insert" && options.targetUid) {
        // Write title into the parent block if provided
        if (options.targetBlockTitle) {
          await addContentToBlock(options.targetUid, options.targetBlockTitle);
        }
        await insertStructuredAIResponse({
          targetUid: options.targetUid,
          content: textForBlocks,
        });
      }
    }

    return result;
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      `[LiveAI_API] Generation failed: ${error.message || "Unknown error"}`
    );
  }
}

/**
 * Parse markdown text into a Roam block tree (no LLM call, no Roam writes).
 */
function parseToBlocks(text) {
  if (typeof text !== "string") {
    throw new Error("[LiveAI_API] parseToBlocks() requires a string argument.");
  }
  return textToBlockTree(text);
}

/**
 * Insert a block tree into Roam at a target uid.
 */
async function insertBlocks(targetUid, blocks) {
  if (!targetUid || typeof targetUid !== "string") {
    throw new Error("[LiveAI_API] insertBlocks() requires a valid targetUid.");
  }
  if (!Array.isArray(blocks)) {
    throw new Error("[LiveAI_API] insertBlocks() requires an array of blocks.");
  }

  async function insertBlockTree(parentUid, blockArray) {
    for (const block of blockArray) {
      const content = block.string || block.content || "";
      const newUid = await createChildBlock(parentUid, content);
      if (block.children && block.children.length > 0 && newUid) {
        await insertBlockTree(newUid, block.children);
      }
    }
  }

  await insertBlockTree(targetUid, blocks);
}

/**
 * Register the public API on window.LiveAI_API.
 */
export function initPublicApi() {
  if (typeof window === "undefined") return;

  const api = Object.freeze({
    version: API_VERSION,
    isAvailable,
    listModels,
    getDefaultModel,
    generate,
    parseToBlocks,
    insertBlocks,
  });

  window.LiveAI_API = api;
  console.log(`[LiveAI API] Public API v${API_VERSION} registered on window.LiveAI_API`);
}

/**
 * Unregister the public API from window.LiveAI_API.
 */
export function cleanupPublicApi() {
  if (typeof window === "undefined") return;
  if (window.LiveAI_API) {
    delete window.LiveAI_API;
    console.log("[LiveAI API] Public API unregistered.");
  }
  requestTimestamps = [];
}
