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
import { getActiveModel, getFavoriteModelStrings } from "../utils/activeModel";
import {
  getModelByIdentifier,
  getMaxOutput,
  getThinkingEffortOptions,
  isThinkingModel,
} from "../ai/modelRegistry";
import {
  modelAccordingToProvider,
  isAPIKeyNeeded,
  estimateContextTokens,
} from "../ai/aiAPIsHub";
import { modelsPricing, openRouterModelPricing } from "../ai/modelsInfo";
import {
  textToBlockTree,
  trimOutsideOuterBraces,
  sanitizeJSONstring,
} from "../utils/format";
import { insertStructuredAIResponse } from "../ai/responseInsertion";
import { createChildBlock, addContentToBlock } from "../utils/roamAPI";
import { getAndNormalizeContext } from "../ai/dataExtraction";
import {
  defaultAssistantCharacter,
  roamBasicsFormat,
  hierarchicalResponseFormat,
} from "../ai/prompts";
import {
  getRelativeDateAndTimeString,
  getMainViewUid,
} from "../utils/roamAPI";

const API_VERSION = "1.0";
const API_READY_EVENT = "liveai:api-ready";
const API_UNLOADED_EVENT = "liveai:api-unloaded";
// Each caller has its own budget, so one chatty extension can't block the
// others; the global cap still bounds the total spend on the user's keys.
const RATE_LIMIT_PER_CALLER = 20;
const RATE_LIMIT_GLOBAL = 60;
const RATE_LIMIT_WINDOW_MS = 60000;
const ANONYMOUS_CALLER = "(anonymous)";

const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Error codes exposed on error.code, so callers can react without parsing messages.
 */
export const API_ERROR_CODES = Object.freeze({
  INVALID_OPTIONS: "INVALID_OPTIONS",
  RATE_LIMIT: "RATE_LIMIT",
  INVALID_MODEL: "INVALID_MODEL",
  NO_API_KEY: "NO_API_KEY",
  EMPTY_RESPONSE: "EMPTY_RESPONSE",
  INVALID_JSON: "INVALID_JSON",
  PROVIDER_ERROR: "PROVIDER_ERROR",
});

function apiError(code, message) {
  const error = new Error(`[LiveAI_API] ${message}`);
  error.code = code;
  return error;
}

function invalidOptions(message) {
  return apiError(API_ERROR_CODES.INVALID_OPTIONS, message);
}

// Rate limiter state: caller name -> request timestamps
let requestTimestamps = new Map();

function checkRateLimit(caller) {
  const now = Date.now();
  let total = 0;
  for (const [key, timestamps] of requestTimestamps) {
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length) requestTimestamps.set(key, recent);
    else requestTimestamps.delete(key);
    total += recent.length;
  }
  const key = caller || ANONYMOUS_CALLER;
  const callerTimestamps = requestTimestamps.get(key) || [];
  if (callerTimestamps.length >= RATE_LIMIT_PER_CALLER) {
    throw apiError(
      API_ERROR_CODES.RATE_LIMIT,
      `Rate limit exceeded for "${key}": max ${RATE_LIMIT_PER_CALLER} requests per minute.`
    );
  }
  if (total >= RATE_LIMIT_GLOBAL) {
    throw apiError(
      API_ERROR_CODES.RATE_LIMIT,
      `Global rate limit exceeded: max ${RATE_LIMIT_GLOBAL} requests per minute across all extensions.`
    );
  }
  callerTimestamps.push(now);
  requestTimestamps.set(key, callerTimestamps);
}

function validateGenerateOptions(options) {
  if (!options || typeof options !== "object") {
    throw invalidOptions("generate() requires an options object.");
  }
  if (!options.prompt) {
    throw invalidOptions("generate() requires a 'prompt' parameter.");
  }
  if (
    typeof options.prompt !== "string" &&
    !Array.isArray(options.prompt)
  ) {
    throw invalidOptions(
      "'prompt' must be a string or an array of {role, content} messages."
    );
  }
  if (Array.isArray(options.prompt)) {
    for (const msg of options.prompt) {
      if (!msg.role || !msg.content) {
        throw invalidOptions(
          "Each message in prompt array must have 'role' and 'content'."
        );
      }
    }
  }

  const validOutputs = ["raw", "blocks", "insert"];
  const output = options.output || "raw";
  if (!validOutputs.includes(output)) {
    throw invalidOptions(
      `'output' must be one of: ${validOutputs.join(", ")}`
    );
  }
  if (output === "insert" && !options.targetUid) {
    throw invalidOptions(
      "'targetUid' is required when output is 'insert'."
    );
  }

  if (
    options.responseFormat &&
    !["text", "json_object"].includes(options.responseFormat)
  ) {
    throw invalidOptions(
      "'responseFormat' must be 'text' or 'json_object'."
    );
  }

  if (options.temperature != null) {
    if (typeof options.temperature !== "number" || options.temperature < 0 || options.temperature > 2) {
      throw invalidOptions("'temperature' must be a number between 0 and 2.");
    }
  }

  if (options.effort != null && !EFFORT_LEVELS.includes(options.effort)) {
    throw invalidOptions(
      `'effort' must be one of: ${EFFORT_LEVELS.join(", ")}`
    );
  }

  if (options.model != null && typeof options.model !== "string") {
    throw invalidOptions("'model' must be a string.");
  }

  if (options.jsonSchema != null) {
    if (
      typeof options.jsonSchema !== "object" ||
      Array.isArray(options.jsonSchema)
    ) {
      throw invalidOptions("'jsonSchema' must be a JSON Schema object.");
    }
    if (options.responseFormat === "text") {
      throw invalidOptions(
        "'jsonSchema' requires responseFormat 'json_object' (or omit responseFormat)."
      );
    }
    if (options.output && options.output !== "raw") {
      throw invalidOptions("'jsonSchema' can only be used with output 'raw'.");
    }
  }

  if (options.signal && !(options.signal instanceof AbortSignal)) {
    throw invalidOptions("'signal' must be an AbortSignal instance.");
  }

  if (
    options.focusedBlockUid != null &&
    typeof options.focusedBlockUid !== "string"
  ) {
    throw invalidOptions("'focusedBlockUid' must be a block uid string.");
  }

  if (options.roamContext != null) validateRoamContext(options.roamContext);

  if (options.context && options.roamContext) {
    throw invalidOptions(
      "Provide either 'context' (string) or 'roamContext' (RoamContext object), not both."
    );
  }

  if (options.streamTo && options.streamTo !== "none" && !(options.streamTo instanceof HTMLElement)) {
    throw invalidOptions(
      "'streamTo' must be an HTMLElement or \"none\"."
    );
  }

  if (options.onChunk && typeof options.onChunk !== "function") {
    throw invalidOptions("'onChunk' must be a function.");
  }
}

/**
 * Minimal JSON Schema validator (type, properties, required, items, enum,
 * additionalProperties: false). Enough to catch a model drifting from the
 * expected shape; not a full JSON Schema implementation.
 * Returns a list of error messages (empty when valid).
 */
function validateAgainstSchema(value, schema, path = "$") {
  if (!schema || typeof schema !== "object") return [];
  const errors = [];

  if (schema.enum && !schema.enum.some((v) => v === value)) {
    errors.push(`${path} must be one of ${JSON.stringify(schema.enum)}`);
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matches = types.some((type) => {
      switch (type) {
        case "null":
          return value === null;
        case "array":
          return Array.isArray(value);
        case "object":
          return (
            value !== null && typeof value === "object" && !Array.isArray(value)
          );
        case "integer":
          return Number.isInteger(value);
        case "number":
          return typeof value === "number" && Number.isFinite(value);
        default:
          return typeof value === type;
      }
    });
    if (!matches) {
      errors.push(`${path} must be of type ${types.join(" | ")}`);
      return errors;
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${path}.${key} is required`);
    }
    const properties = schema.properties || {};
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in value) {
        errors.push(
          ...validateAgainstSchema(value[key], propSchema, `${path}.${key}`)
        );
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties))
          errors.push(`${path}.${key} is not allowed`);
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => {
      errors.push(...validateAgainstSchema(item, schema.items, `${path}[${i}]`));
    });
  }

  return errors;
}

function parseJsonResponse(text) {
  // Models sometimes wrap JSON in code fences or add a sentence around it.
  const trimmed = trimOutsideOuterBraces(text);
  const attempts = [text, trimmed, sanitizeJSONstring(trimmed)];
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (e) {}
  }
  throw apiError(
    API_ERROR_CODES.INVALID_JSON,
    "The model response is not valid JSON."
  );
}

/**
 * Normalize provider usage and estimate its cost (USD) from Live AI's pricing
 * table. estimatedCost is null when the model has no known pricing.
 */
function buildUsage(model, rawUsage) {
  if (!rawUsage) return null;
  const inputTokens = rawUsage.input_tokens || 0;
  const outputTokens = rawUsage.output_tokens || 0;
  let estimatedCost = null;
  try {
    const modelId = modelAccordingToProvider(model)?.id || model;
    const inputPrice =
      modelsPricing[modelId]?.input ?? openRouterModelPricing(modelId, "input");
    const outputPrice =
      modelsPricing[modelId]?.output ??
      openRouterModelPricing(modelId, "output");
    if (inputPrice != null && outputPrice != null) {
      estimatedCost =
        (inputTokens * inputPrice + outputTokens * outputPrice) / 1000000;
    }
  } catch (e) {
    // Pricing is informative only
  }
  return { inputTokens, outputTokens, estimatedCost };
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

const ROAM_CONTEXT_ARRAY_KEYS = [
  "pageArgument",
  "linkedRefsArgument",
  "blockArgument",
];
const FOCUSED_BLOCK_KEYS = ["children", "siblings", "path"];

function validateRoamContext(roamContext) {
  if (typeof roamContext !== "object" || Array.isArray(roamContext)) {
    throw invalidOptions("'roamContext' must be a RoamContext object.");
  }
  for (const key of ROAM_CONTEXT_ARRAY_KEYS) {
    if (
      roamContext[key] != null &&
      (!Array.isArray(roamContext[key]) ||
        roamContext[key].some((item) => typeof item !== "string"))
    ) {
      throw invalidOptions(`'roamContext.${key}' must be an array of strings.`);
    }
  }
  if (
    roamContext.logPagesArgument != null &&
    (!Number.isInteger(roamContext.logPagesArgument) ||
      roamContext.logPagesArgument < 0)
  ) {
    throw invalidOptions(
      "'roamContext.logPagesArgument' must be a positive integer."
    );
  }
}

/**
 * Copy the caller's roamContext (getAndNormalizeContext mutates it, e.g. with
 * linkedPages) and fill what a caller can't easily know:
 *   - page / linkedRefs without explicit titles → the page open in the main view
 *   - children / siblings / path → focusedBlockUid, or the block focused in Roam
 */
async function normalizeRoamContext(roamContext, focusedBlockUid) {
  const normalized = { ...roamContext };
  for (const key of ROAM_CONTEXT_ARRAY_KEYS) {
    normalized[key] = [...(roamContext[key] || [])];
  }

  const needsCurrentView =
    (normalized.page && !normalized.pageArgument.length) ||
    (normalized.linkedRefs && !normalized.linkedRefsArgument.length);
  if (needsCurrentView && !normalized.pageViewUid) {
    normalized.pageViewUid = (await getMainViewUid()) || null;
  }

  let focusedBlock = focusedBlockUid;
  if (FOCUSED_BLOCK_KEYS.some((key) => normalized[key])) {
    focusedBlock ||=
      window.roamAlphaAPI?.ui?.getFocusedBlock?.()?.["block-uid"];
    if (!focusedBlock) {
      throw invalidOptions(
        `roamContext ${FOCUSED_BLOCK_KEYS.join("/")} need a block: pass 'focusedBlockUid' (no block is focused in Roam).`
      );
    }
  }

  return { roamContext: normalized, focusedBlock };
}

async function extractRoamContext(roamContext, focusedBlockUid) {
  const normalized = await normalizeRoamContext(roamContext, focusedBlockUid);
  return await getAndNormalizeContext({
    roamContext: normalized.roamContext,
    focusedBlock: normalized.focusedBlock,
  });
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
    return await extractRoamContext(
      options.roamContext,
      options.focusedBlockUid
    );
  }
  return "";
}

/**
 * Extract the text Live AI would send as context for a roamContext, without
 * calling any model. Useful to preview the context or check its size first.
 */
async function getContext(roamContext, options = {}) {
  if (roamContext == null) {
    throw invalidOptions("getContext() requires a RoamContext object.");
  }
  validateRoamContext(roamContext);
  if (!options || typeof options !== "object") {
    throw invalidOptions("getContext() options must be an object.");
  }
  if (
    options.focusedBlockUid != null &&
    typeof options.focusedBlockUid !== "string"
  ) {
    throw invalidOptions("'focusedBlockUid' must be a block uid string.");
  }

  const text = await extractRoamContext(roamContext, options.focusedBlockUid);
  return {
    text,
    estimatedTokens: Number(estimateContextTokens(text)) || 0,
  };
}

/**
 * Check that a model requested by a caller is one the user has configured.
 * Accepts the exact id returned by listModels() or any alias resolving to the
 * same registry entry.
 */
function isModelAvailable(model) {
  if (availableModels.includes(model)) return true;
  const requested = getModelByIdentifier(model);
  if (!requested?.id) return false;
  return availableModels.some(
    (availableId) => getModelByIdentifier(availableId)?.id === requested.id
  );
}

/**
 * Resolve and check the model before any request: unknown or unconfigured
 * models, and models without an API key, fail with an explicit error code
 * instead of resolving with an empty text.
 */
function resolveModel(options) {
  const model = options.model || defaultModel;
  if (!model) {
    throw apiError(
      API_ERROR_CODES.INVALID_MODEL,
      "No model specified and no default model configured."
    );
  }
  if (options.model && !isModelAvailable(model)) {
    throw apiError(
      API_ERROR_CODES.INVALID_MODEL,
      `Model "${model}" is not available. Use listModels() to get the configured models.`
    );
  }
  const llm = modelAccordingToProvider(model, options.thinking);
  if (!llm) {
    throw apiError(API_ERROR_CODES.INVALID_MODEL, `Unknown model "${model}".`);
  }
  if (isAPIKeyNeeded(llm, true)) {
    throw apiError(
      API_ERROR_CODES.NO_API_KEY,
      `No API key configured for ${llm.name || model}.`
    );
  }
  return model;
}

function isAbortError(error, signal) {
  return (
    signal?.aborted ||
    error?.name === "AbortError" ||
    error?.name === "APIUserAbortError"
  );
}

/**
 * List available models with safe metadata (no API keys or library references).
 */
function listModels() {
  const activeModel = getActiveModel();
  const favorites = getFavoriteModelStrings();
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
        isActive: modelId === activeModel,
        isFavorite: favorites.includes(modelId),
        thinkingEfforts: isThinkingModel(modelId)
          ? getThinkingEffortOptions(modelId)
          : [],
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
      isActive: modelId === activeModel,
      isFavorite: favorites.includes(modelId),
      thinkingEfforts: [],
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

  if (options.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const output = options.output || "raw";
  const model = resolveModel(options);
  checkRateLimit(options.caller);

  logCaller(options.caller, model);

  const responseFormat = options.jsonSchema
    ? "json_object"
    : options.responseFormat || "text";

  // Build system prompt (with or without Live AI defaults)
  let systemPrompt = buildSystemPrompt(options);
  if (options.jsonSchema) {
    systemPrompt +=
      "\n\nRespond ONLY with a JSON object that conforms to this JSON Schema " +
      "(no code fence, no comment):\n" +
      JSON.stringify(options.jsonSchema, null, 2);
  }

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

  let rawUsage = null;

  try {
    const aiResponse = await aiCompletion({
      instantModel: model,
      prompt,
      systemPrompt,
      content,
      responseFormat,
      targetUid: output === "insert" ? options.targetUid : "",
      isButtonToInsert: false,
      thinkingEnabled: options.thinking,
      silent: true,
      onChunk: options.onChunk,
      streamTo,
      // The API exposes an OpenAI-style 0-2 scale; internally temperature is
      // 0-1 and rescaled to each provider's range.
      temperature:
        options.temperature != null ? options.temperature / 2 : undefined,
      effort: options.effort,
      signal: options.signal,
      throwOnError: true,
      onUsage: (usage) => {
        rawUsage = {
          input_tokens:
            (rawUsage?.input_tokens || 0) + (usage?.input_tokens || 0),
          output_tokens:
            (rawUsage?.output_tokens || 0) + (usage?.output_tokens || 0),
        };
      },
      // The API returns the model's JSON as is (see result.json below)
      parseJsonResponse: false,
    });

    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    if (
      aiResponse == null ||
      (typeof aiResponse === "string" && !aiResponse.trim())
    ) {
      throw apiError(
        API_ERROR_CODES.EMPTY_RESPONSE,
        `${model} returned an empty response.`
      );
    }

    // Build result
    const result = {
      text: typeof aiResponse === "string" ? aiResponse : JSON.stringify(aiResponse),
      model,
      provider: "",
      usage: buildUsage(model, rawUsage),
    };

    if (responseFormat === "json_object") {
      result.json =
        typeof aiResponse === "string"
          ? parseJsonResponse(aiResponse)
          : aiResponse;
      if (options.jsonSchema) {
        const schemaErrors = validateAgainstSchema(
          result.json,
          options.jsonSchema
        );
        if (schemaErrors.length) {
          const error = apiError(
            API_ERROR_CODES.INVALID_JSON,
            `The model response does not match the JSON Schema: ${schemaErrors
              .slice(0, 5)
              .join("; ")}`
          );
          error.json = result.json;
          throw error;
        }
      }
    }

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
    if (isAbortError(error, options.signal)) {
      throw new DOMException("Aborted", "AbortError");
    }
    if (error.code && Object.values(API_ERROR_CODES).includes(error.code)) {
      throw error;
    }
    // Only the message is kept: raw provider errors may carry request details.
    throw apiError(
      API_ERROR_CODES.PROVIDER_ERROR,
      `Generation failed: ${error.message || "Unknown error"}`
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
    errorCodes: API_ERROR_CODES,
    generate,
    getContext,
    parseToBlocks,
    insertBlocks,
  });

  window.LiveAI_API = api;
  console.log(`[LiveAI API] Public API v${API_VERSION} registered on window.LiveAI_API`);
  // Lets extensions loaded before Live AI (or before the API is enabled)
  // wait for it instead of polling window.LiveAI_API.
  window.dispatchEvent(
    new CustomEvent(API_READY_EVENT, { detail: { version: API_VERSION } })
  );
}

/**
 * Unregister the public API from window.LiveAI_API.
 */
export function cleanupPublicApi() {
  if (typeof window === "undefined") return;
  if (window.LiveAI_API) {
    delete window.LiveAI_API;
    console.log("[LiveAI API] Public API unregistered.");
    window.dispatchEvent(new CustomEvent(API_UNLOADED_EVENT));
  }
  requestTimestamps = new Map();
}
