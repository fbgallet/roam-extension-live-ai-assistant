/**
 * Multimodal Commands Handler
 *
 * Centralized module for handling multimodal AI commands in chat:
 * - Image generation and editing
 * - Audio processing (future)
 * - Video processing (future)
 */

import { AIMessage } from "@langchain/core/messages";
import { imageGeneration, imageGenerationChats } from "../../multimodalAI";
import { buildImageGenerationPrompt } from "./multimodal-context-builder";
import { TokensUsage } from "../langraphModelsLoader";
import { imageGenerationModels } from "../../modelsInfo";
import { defaultImageModel } from "../../..";

interface MultimodalCommandResult {
  messages: any[];
  tokensUsage?: TokensUsage;
}

/**
 * Handle image generation command
 *
 * @param originalUserPrompt - The user's original text prompt
 * @param commandPrompt - The command string (e.g., "Image generation (high)")
 * @param modelId - The model ID from state
 * @param resultsContext - Results context containing images/text
 * @param chatSessionId - Chat session ID for multi-turn editing
 * @param currentMessages - Current message history
 * @returns Result with updated messages and token usage
 */
export async function handleImageGenerationCommand(
  originalUserPrompt: string,
  commandPrompt: string | undefined,
  modelId: string,
  resultsContext: any[] | undefined,
  chatSessionId: string | undefined,
  currentMessages: any[]
): Promise<MultimodalCommandResult> {
  let turnTokensUsage: TokensUsage | undefined;

  // Extract quality from command prompt (e.g., "Image generation (high)" -> "high")
  const quality = commandPrompt?.split("(")[1]?.split(")")[0] || "auto";

  const imageModel = imageGenerationModels.includes(modelId)
    ? modelId
    : defaultImageModel;

  // Build complete prompt including images and text from resultsContext (first turn only)
  const completePrompt = buildImageGenerationPrompt(
    originalUserPrompt,
    resultsContext,
    chatSessionId,
    imageGenerationChats
  );

  // Generate image
  const imageLink = await imageGeneration(
    completePrompt,
    quality,
    imageModel,
    (t: any) => {
      turnTokensUsage = { ...t };
    },
    chatSessionId // Enable multi-turn image editing in chat sessions
  );

  // Check if this is a nano banana model that supports multi-turn editing
  const isNanoBanana =
    imageModel === "gemini-2.5-flash-image" ||
    imageModel === "gemini-3-pro-image-preview";

  // Check if this is an explicit image generation command (not an edit in existing chat)
  const isExplicitImageGeneration = commandPrompt?.slice(0, 16) === "Image generation";

  // Check if this is the first turn (chat session just created)
  const isFirstTurn =
    chatSessionId &&
    !imageGenerationChats.has(`${chatSessionId}_${imageModel}`);

  // Add helpful message ONLY for first-time generation (not for edits)
  // Show when: nano banana model + explicit image generation command + first turn
  let responseMessage = imageLink;
  if (isNanoBanana && isExplicitImageGeneration && isFirstTurn) {
    responseMessage +=
      "\n\n*You can now continue editing this image by sending follow-up messages in this chat. Each new message will refine the image based on your instructions.*";
  }

  return {
    messages: [...currentMessages, new AIMessage(responseMessage)],
    tokensUsage: turnTokensUsage,
  };
}

/**
 * Check if the current turn is an image generation request
 *
 * @param commandPrompt - The command prompt string
 * @param chatSessionId - Chat session ID
 * @returns true if this is an image generation request
 */
export function isImageGenerationRequest(
  commandPrompt: string | undefined,
  chatSessionId: string | undefined
): boolean {
  // Check if this is an explicit image generation command
  const isImageGeneration = commandPrompt?.slice(0, 16) === "Image generation";

  // Check if we're in an active image editing session (chat exists for this session)
  const hasImageChat =
    chatSessionId &&
    (imageGenerationChats.has(`${chatSessionId}_gemini-2.5-flash-image`) ||
      imageGenerationChats.has(`${chatSessionId}_gemini-3-pro-image-preview`));

  return isImageGeneration || hasImageChat;
}

/**
 * Handle audio processing command (placeholder for future implementation)
 *
 * @param originalUserPrompt - The user's original text prompt
 * @param commandPrompt - The command string
 * @param modelId - The model ID from state
 * @param resultsContext - Results context containing audio files
 * @param currentMessages - Current message history
 * @returns Result with updated messages and token usage
 */
export async function handleAudioProcessingCommand(
  originalUserPrompt: string,
  commandPrompt: string | undefined,
  modelId: string,
  resultsContext: any[] | undefined,
  currentMessages: any[]
): Promise<MultimodalCommandResult> {
  // TODO: Implement audio processing
  // - Extract audio files from resultsContext
  // - Process with appropriate model
  // - Return results

  return {
    messages: [
      ...currentMessages,
      new AIMessage("Audio processing not yet implemented"),
    ],
  };
}

/**
 * Handle video processing command (placeholder for future implementation)
 *
 * @param originalUserPrompt - The user's original text prompt
 * @param commandPrompt - The command string
 * @param modelId - The model ID from state
 * @param resultsContext - Results context containing video files
 * @param currentMessages - Current message history
 * @returns Result with updated messages and token usage
 */
export async function handleVideoProcessingCommand(
  originalUserPrompt: string,
  commandPrompt: string | undefined,
  modelId: string,
  resultsContext: any[] | undefined,
  currentMessages: any[]
): Promise<MultimodalCommandResult> {
  // TODO: Implement video processing
  // - Extract video files from resultsContext
  // - Process with appropriate model (e.g., Gemini with video support)
  // - Return results

  return {
    messages: [
      ...currentMessages,
      new AIMessage("Video processing not yet implemented"),
    ],
  };
}
