/**
 * Model Updates Configuration
 *
 * This file contains developer-controlled model updates for:
 * - New model announcements (shown with "NEW" badges)
 * - Deprecated models (prompts user to migrate)
 * - Model replacements/migrations
 *
 * When adding new models or deprecating old ones, update this file.
 * The version should match the extension version when changes were made.
 */

export const MODEL_UPDATES = {
  // Version when these updates were added
  version: "1.28.0",

  // Last updated timestamp (for cache invalidation)
  lastUpdated: "2025-01-04",

  updates: [
    // Example: New model announcement
    // {
    //   type: "new",
    //   modelId: "gpt-5",
    //   provider: "OpenAI",
    //   addedDate: "2025-01-15",
    //   description: "Latest GPT model with improved reasoning"
    // },

    // Example: Deprecated model with replacement
    // {
    //   type: "deprecated",
    //   oldModelId: "gpt-4-0314",
    //   newModelId: "gpt-4-turbo",
    //   provider: "OpenAI",
    //   reason: "Model is being retired. GPT-4 Turbo offers better performance.",
    //   deprecationDate: "2025-02-01",
    //   autoMigrate: false
    // },

    // Example: Model renamed/replaced
    // {
    //   type: "renamed",
    //   oldModelId: "claude-3-opus",
    //   newModelId: "claude-opus-4",
    //   provider: "Anthropic",
    //   reason: "Claude 3 Opus has been upgraded to Claude Opus 4",
    //   autoMigrate: true
    // }
  ]
};

/**
 * Get all new model IDs from updates
 * @returns {Array} Array of new model IDs
 */
export function getNewModelIds() {
  return MODEL_UPDATES.updates
    .filter(u => u.type === "new")
    .map(u => u.modelId);
}

/**
 * Get all deprecated models from updates
 * @returns {Array} Array of deprecated model update objects
 */
export function getDeprecatedModels() {
  return MODEL_UPDATES.updates.filter(
    u => u.type === "deprecated" || u.type === "renamed"
  );
}

/**
 * Check if a model is deprecated
 * @param {string} modelId - Model ID to check
 * @returns {Object|null} Deprecation info or null if not deprecated
 */
export function getModelDeprecationInfo(modelId) {
  return MODEL_UPDATES.updates.find(
    u => (u.type === "deprecated" || u.type === "renamed") && u.oldModelId === modelId
  ) || null;
}

/**
 * Check if a model is new (recently added)
 * @param {string} modelId - Model ID to check
 * @returns {boolean} True if model is new
 */
export function isModelNew(modelId) {
  return MODEL_UPDATES.updates.some(
    u => u.type === "new" && u.modelId === modelId
  );
}

/**
 * Get the replacement model for a deprecated model
 * @param {string} oldModelId - Old model ID
 * @returns {string|null} New model ID or null
 */
export function getReplacementModel(oldModelId) {
  const update = MODEL_UPDATES.updates.find(
    u => (u.type === "deprecated" || u.type === "renamed") && u.oldModelId === oldModelId
  );
  return update?.newModelId || null;
}

/**
 * Get the current update version
 * @returns {string} Version string
 */
export function getUpdateVersion() {
  return MODEL_UPDATES.version;
}
