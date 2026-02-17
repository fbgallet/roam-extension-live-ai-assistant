/**
 * Multimodal Commands Handler
 *
 * Centralized module for handling multimodal AI commands in chat:
 * - Image generation and editing
 * - Audio processing
 * - Video processing
 * - Web search
 */

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import {
  imageGeneration,
  imageGenerationChats,
  transcribeAudioFromBlock,
  addVideosToGeminiMessage,
} from "../../multimodalAI";
import {
  buildImageGenerationPrompt,
  extractMultimodalContext,
} from "./multimodal-context-builder";
import { TokensUsage } from "../langraphModelsLoader";
import { imageGenerationModels, webSearchModels } from "../../modelsInfo";
import {
  defaultImageModel,
  extensionStorage,
  googleLibrary,
  defaultModel,
} from "../../..";
import {
  getDefaultWebSearchModel,
  getModelByIdentifier,
} from "../../modelRegistry";
import {
  isModelVisible,
  getModelConfig,
  getOrderedProviders,
} from "../../../utils/modelConfigHelpers";
import {
  roamAudioRegex,
  roamImageRegex,
  roamVideoRegex,
  youtubeRegex,
  pdfLinkRegex,
} from "../../../utils/regex";
import { aiCompletion } from "../../responseInsertion";
import { buildResultsContext } from "./chat-agent-prompts";
import { AppToaster } from "../../../components/Toaster";
import { ANTHROPIC_API_KEY } from "../../..";

interface MultimodalCommandResult {
  messages: any[];
  tokensUsage?: TokensUsage;
}

interface ImageGenerationResult extends MultimodalCommandResult {
  imageEditionMode?: boolean;
  imageGenerationModelId?: string;
  lastGeneratedImageUrl?: string;
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
 * @param userChoiceCallback - Optional callback for inline choice forms
 * @param isAlreadyInEditMode - Whether the chat is already in image edition mode
 * @returns Result with updated messages, token usage, and image edition state
 */
export async function handleImageGenerationCommand(
  originalUserPrompt: string,
  commandPrompt: string | undefined,
  modelId: string,
  resultsContext: any[] | undefined,
  chatSessionId: string | undefined,
  currentMessages: any[],
  userChoiceCallback?: (req: any) => Promise<{
    selectedOptions: Record<string, string>;
    cancelled: boolean;
  }>,
  isAlreadyInEditMode: boolean = false,
): Promise<ImageGenerationResult> {
  let turnTokensUsage: TokensUsage | undefined;

  // Extract quality from command prompt (e.g., "Image generation (high)" -> "high")
  const quality = commandPrompt?.split("(")[1]?.split(")")[0] || "auto";

  // Get default image model from config or fallback to global setting
  const modelConfig = getModelConfig();
  const configDefaultImageModel =
    modelConfig?.defaultImageModel || defaultImageModel;

  let imageModel = imageGenerationModels.includes(modelId)
    ? modelId
    : configDefaultImageModel;

  // Resolve display names (e.g., "Nano Banana Pro") to API model IDs
  if (imageModel && !imageGenerationModels.includes(imageModel)) {
    const resolved = getModelByIdentifier(imageModel);
    if (resolved?.id) {
      imageModel = resolved.id;
    }
  }

  // Check if this is a Gemini model that supports multi-turn editing
  // Note: OpenAI Images API doesn't support multi-turn conversation
  const isNanoBanana =
    imageModel === "gemini-2.5-flash-image" ||
    imageModel === "gemini-3-pro-image-preview";

  // Check if this is an explicit image generation command (not an edit in existing chat)
  const isExplicitImageGeneration =
    commandPrompt?.slice(0, 16) === "Image generation";

  // Check if this is the first turn (BEFORE creating the chat)
  // Only applicable for Gemini models that support multi-turn
  const isFirstTurn =
    chatSessionId &&
    isNanoBanana &&
    !imageGenerationChats.has(`${chatSessionId}_${imageModel}`);

  // Check if this is an OpenAI image model (doesn't support multi-turn)
  const isOpenAIImageModel = imageModel.startsWith("gpt-image");

  // Build complete prompt including images and text from resultsContext
  // For OpenAI: always include images (no multi-turn support)
  // For Gemini: only on first turn (images persist in chat history)
  const completePrompt = buildImageGenerationPrompt(
    originalUserPrompt,
    resultsContext,
    chatSessionId,
    imageGenerationChats,
    imageModel,
  );

  console.log("Image generation - resultsContext:", resultsContext);
  console.log("Image generation - completePrompt:", completePrompt);

  // Generate image
  let imageLink: string;
  try {
    imageLink = await imageGeneration(
      completePrompt,
      quality,
      imageModel,
      (t: any) => {
        turnTokensUsage = { ...t };
      },
      chatSessionId, // Enable multi-turn image editing in chat sessions
    );
  } catch (error: any) {
    console.error("Image generation error:", error);
    const errorMessage = `⚠️ Image generation failed: ${error.message || "Unknown error"}`;
    return {
      messages: [...currentMessages, new AIMessage(errorMessage)],
      imageEditionMode: isAlreadyInEditMode,
    };
  }

  console.log("imageModel :>> ", imageModel);

  // Extract generated image URL from the response
  const imageUrlMatch = imageLink?.match(/!\[.*?\]\((.*?)\)/);
  const generatedImageUrl = imageUrlMatch ? imageUrlMatch[1] : undefined;

  // Detect if this was an image edit operation (images were in the prompt)
  roamImageRegex.lastIndex = 0;
  const hadImagesInPrompt = roamImageRegex.test(completePrompt);

  // Add helpful message based on model type and operation
  let responseMessage = imageLink;

  if (isNanoBanana && isExplicitImageGeneration && isFirstTurn) {
    // Gemini multi-turn: explain that follow-up edits are supported
    responseMessage +=
      "\n\n*You can now continue editing this image by sending follow-up messages in this chat. Each new message will refine the image based on your instructions.*";
  } else if (
    isOpenAIImageModel &&
    hadImagesInPrompt &&
    isExplicitImageGeneration
  ) {
    // OpenAI image edit: confirm the edit was applied
    responseMessage +=
      "\n\n*Image edited based on your instructions. To make further edits, include the new image in your next message.*";
  }

  // Ask user if they want to enter image edition mode
  // Only on explicit first generation, not when already in edit mode
  let enterEditMode = false;

  if (
    isExplicitImageGeneration &&
    userChoiceCallback &&
    generatedImageUrl &&
    !isAlreadyInEditMode
  ) {
    const choice = await userChoiceCallback({
      commandId: "image_edition_mode",
      title: "Image Edition Mode",
      options: [
        {
          id: "mode",
          label:
            "Would you like to enter image edition mode? All your next messages will be treated as image editing instructions.",
          type: "radio",
          choices: [
            { value: "yes", label: "Yes, enter image edition mode" },
            { value: "no", label: "No, continue conversation" },
          ],
          defaultValue: "no",
        },
      ],
    });

    if (!choice.cancelled && choice.selectedOptions.mode === "yes") {
      enterEditMode = true;
      responseMessage +=
        "\n\n*🖼️ Image edition mode activated. All your messages will now be used to edit this image. Use `/exit-edit` or click the badge to return to conversation mode.*";
    }
  }

  return {
    messages: [...currentMessages, new AIMessage(responseMessage)],
    tokensUsage: turnTokensUsage,
    imageEditionMode: enterEditMode || isAlreadyInEditMode,
    imageGenerationModelId: imageModel,
    lastGeneratedImageUrl: generatedImageUrl,
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
  chatSessionId: string | undefined,
  imageEditionMode: boolean = false,
): boolean {
  // Check if this is an explicit image generation command
  const isImageGeneration = commandPrompt?.slice(0, 16) === "Image generation";

  // Check if we're in an active Gemini image editing session
  // Note: OpenAI Images API doesn't support multi-turn, only Gemini does
  // Only auto-route to image generation if imageEditionMode is still active
  if (chatSessionId && imageEditionMode) {
    const hasGeminiChat =
      imageGenerationChats.has(`${chatSessionId}_gemini-2.5-flash-image`) ||
      imageGenerationChats.has(`${chatSessionId}_gemini-3-pro-image-preview`);

    if (hasGeminiChat) {
      return true;
    }
  }

  return isImageGeneration;
}

/**
 * Detect if prompt or context contains audio files
 *
 * @param userPrompt - The user's text prompt
 * @param resultsContext - Results context from chat state
 * @returns true if audio is detected, false otherwise
 */
export function hasAudioContent(
  userPrompt: string,
  resultsContext: any[] | undefined,
): boolean {
  // Check if user prompt contains audio
  roamAudioRegex.lastIndex = 0;
  const audioInPrompt = roamAudioRegex.test(userPrompt);
  if (audioInPrompt) {
    return true;
  }

  // Check if user mentions "audio" in their prompt (suggesting they want to analyze audio in context)
  const mentionsAudio = /\b(audio|transcribe|transcription)\b/i.test(
    userPrompt,
  );

  // Check if resultsContext contains audio files
  if (resultsContext && resultsContext.length > 0 && mentionsAudio) {
    const { audioFiles } = extractMultimodalContext(resultsContext);
    if (audioFiles.length > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Extract all audio URLs from prompt and context
 *
 * @param userPrompt - The user's text prompt
 * @param resultsContext - Results context from chat state
 * @returns Array of audio URLs
 */
function extractAudioUrls(
  userPrompt: string,
  resultsContext: any[] | undefined,
): string[] {
  const audioUrls: string[] = [];

  // Extract from user prompt
  roamAudioRegex.lastIndex = 0;
  const audioMatches = Array.from(userPrompt.matchAll(roamAudioRegex));
  audioMatches.forEach((match) => {
    const audioUrl = match[1] || match[0];
    audioUrls.push(audioUrl);
  });

  // Extract from resultsContext if user mentions audio
  const mentionsAudio = /\b(audio|transcribe|transcription)\b/i.test(
    userPrompt,
  );
  if (resultsContext && resultsContext.length > 0 && mentionsAudio) {
    const { audioFiles } = extractMultimodalContext(resultsContext);
    audioUrls.push(...audioFiles);
  }

  // Remove duplicates
  return Array.from(new Set(audioUrls));
}

/**
 * Handle audio analysis request
 *
 * @param originalUserPrompt - The user's original text prompt
 * @param modelId - The model ID from state
 * @param resultsContext - Results context containing audio files
 * @param currentMessages - Current message history
 * @param audioTranscriptionCache - Cache of previously transcribed audio
 * @returns Result with updated messages and audio transcriptions
 */
/**
 * Check if LLM response contains fresh audio transcription request marker
 */
export function isRequestingFreshAudioTranscription(
  responseContent: string,
): boolean {
  const FRESH_AUDIO_MARKER = "🔄 REQUEST_FRESH_AUDIO_TRANSCRIPTION";
  return responseContent.trim().startsWith(FRESH_AUDIO_MARKER);
}

/**
 * Handle fresh audio transcription request from LLM
 * When LLM includes the marker, this function re-transcribes audio and re-invokes the LLM
 *
 * @param originalUserPrompt - Original user prompt
 * @param modelId - Model ID
 * @param resultsContext - Results context
 * @param currentMessages - Current messages
 * @param llm - LLM instance to re-invoke
 * @param sysMsg - System message
 * @returns Updated messages with fresh analysis and updated cache
 */
export async function handleFreshAudioTranscriptionRequest(
  originalUserPrompt: string,
  modelId: string,
  resultsContext: any[] | undefined,
  currentMessages: any[],
  llm: any,
  sysMsg: any,
): Promise<{ messages: any[]; audioTranscriptionCache: Map<string, string> }> {
  console.log("🔄 LLM requested fresh audio transcription - re-analyzing...");

  // Clear cache to force fresh transcription
  const clearedCache = new Map<string, string>();

  // Re-run audio analysis with cleared cache
  const audioResult = await handleAudioAnalysisRequest(
    originalUserPrompt,
    modelId,
    resultsContext,
    currentMessages,
    clearedCache, // Empty cache forces fresh transcription
  );

  if (audioResult.messages !== currentMessages) {
    // Re-invoke LLM with fresh transcription
    const freshMessages = [sysMsg, ...audioResult.messages];
    const freshResponse = await llm.invoke(freshMessages);

    return {
      messages: [...currentMessages, freshResponse],
      audioTranscriptionCache: audioResult.audioTranscriptions || new Map(),
    };
  }

  // Fallback: no fresh transcription available, return original
  return {
    messages: currentMessages,
    audioTranscriptionCache: clearedCache,
  };
}

export async function handleAudioAnalysisRequest(
  originalUserPrompt: string,
  modelId: string,
  resultsContext: any[] | undefined,
  currentMessages: any[],
  audioTranscriptionCache: Map<string, string>,
): Promise<
  MultimodalCommandResult & {
    audioTranscriptions?: Map<string, string>;
    isTranscriptionOnly?: boolean;
  }
> {
  // Extract audio URLs from prompt and context
  const audioUrls = extractAudioUrls(originalUserPrompt, resultsContext);

  if (audioUrls.length === 0) {
    // No audio found - return without modification
    return { messages: currentMessages };
  }

  // Remove audio URLs from prompt to check if user has additional instructions
  roamAudioRegex.lastIndex = 0;
  const cleanedPrompt = originalUserPrompt.replace(roamAudioRegex, "").trim();

  // Check if user just wants transcription (no additional instructions)
  // If cleanedPrompt is empty or very short, they just want the transcription
  const isTranscriptionOnly = !cleanedPrompt || cleanedPrompt.length < 3;

  // Transcribe all audio files that aren't already cached
  const transcriptions: string[] = [];
  const updatedCache = new Map(audioTranscriptionCache);

  for (const audioUrl of audioUrls) {
    // Check cache first
    if (audioTranscriptionCache.has(audioUrl)) {
      console.log(`✅ Using cached transcription for: ${audioUrl}`);
      transcriptions.push(audioTranscriptionCache.get(audioUrl)!);
      continue;
    }

    // Transcribe the audio
    console.log(`🎵 Transcribing audio: ${audioUrl}`);

    // Create a temporary content string with audio for transcribeAudioFromBlock
    const audioContent = audioUrl.startsWith("http")
      ? `{{[[audio]]: ${audioUrl}}}`
      : audioUrl;

    try {
      // For transcription-only requests, pass empty string to get default formatting
      // For analysis requests, pass the user's instructions
      const transcription = await transcribeAudioFromBlock(
        audioContent,
        isTranscriptionOnly ? "" : cleanedPrompt,
        modelId, // Pass model ID to support Gemini or OpenAI/Groq
      );

      if (transcription) {
        transcriptions.push(transcription);
        updatedCache.set(audioUrl, transcription);
      }
    } catch (error) {
      console.error(`Failed to transcribe audio ${audioUrl}:`, error);
      transcriptions.push(`[Error transcribing audio: ${error.message}]`);
    }
  }

  // If we have transcriptions
  if (transcriptions.length > 0) {
    if (isTranscriptionOnly) {
      // Return transcription directly as AI response, skip LLM
      const transcriptionResponse = transcriptions
        .map((t, i) =>
          transcriptions.length > 1
            ? `**Audio ${i + 1} transcription:**\n\n${t}`
            : t,
        )
        .join("\n\n---\n\n");

      return {
        messages: [...currentMessages, new AIMessage(transcriptionResponse)],
        audioTranscriptions: updatedCache,
        isTranscriptionOnly: true,
      };
    }

    // User has specific instructions - add transcription as context for LLM
    const transcriptionContext = transcriptions
      .map((t, i) => `Audio ${i + 1} transcription:\n${t}`)
      .join("\n\n");

    const enhancedPrompt = `${transcriptionContext}\n\nUser request: ${cleanedPrompt}`;

    // Replace the last user message with the enhanced version
    const messagesWithoutLast = currentMessages.slice(0, -1);

    // Create new HumanMessage with enhanced content (proper LangChain message type)
    const enhancedMessage = new HumanMessage(enhancedPrompt);

    return {
      messages: [...messagesWithoutLast, enhancedMessage],
      audioTranscriptions: updatedCache,
      isTranscriptionOnly: false,
    };
  }

  return {
    messages: currentMessages,
    audioTranscriptions: updatedCache,
  };
}

/**
 * Detect if prompt or context contains video files or YouTube URLs
 *
 * @param userPrompt - The user's text prompt
 * @param resultsContext - Results context from chat state
 * @returns true if video is detected, false otherwise
 */
export function hasVideoContent(
  userPrompt: string,
  resultsContext: any[] | undefined,
): boolean {
  // Check if user prompt contains video in Roam format: {{[[video]]: url}} or {{[[youtube]]: url}}
  roamVideoRegex.lastIndex = 0;
  const videoInPrompt = roamVideoRegex.test(userPrompt);
  if (videoInPrompt) {
    return true;
  }

  // Check for standalone YouTube URLs
  const youtubeInPrompt = youtubeRegex.test(userPrompt);
  if (youtubeInPrompt) {
    return true;
  }

  // Check if user mentions "video" or "youtube" in their prompt (suggesting they want to analyze video in context)
  const mentionsVideo = /\b(video|youtube|watch|analyze.*video)\b/i.test(
    userPrompt,
  );

  // Check if resultsContext contains video files or YouTube URLs
  if (resultsContext && resultsContext.length > 0 && mentionsVideo) {
    for (const result of resultsContext) {
      const content = result.content || result.text || "";

      // Check for video in Roam format
      roamVideoRegex.lastIndex = 0;
      if (roamVideoRegex.test(content)) {
        return true;
      }

      // Check for YouTube URLs
      if (youtubeRegex.test(content)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extract all video URLs from prompt and context
 *
 * @param userPrompt - The user's text prompt
 * @param resultsContext - Results context from chat state
 * @returns Array of video URLs
 */
function extractVideoUrls(
  userPrompt: string,
  resultsContext: any[] | undefined,
): string[] {
  const videoUrls: string[] = [];

  // Extract from user prompt - Roam format {{[[video]]: url}} or {{[[youtube]]: url}}
  roamVideoRegex.lastIndex = 0;
  const videoMatches = Array.from(userPrompt.matchAll(roamVideoRegex));
  videoMatches.forEach((match) => {
    const videoUrl = match[2]; // Group 2 is the URL in roamVideoRegex
    videoUrls.push(videoUrl);
  });

  // Extract standalone YouTube URLs from prompt
  const youtubeMatches = Array.from(
    userPrompt.matchAll(new RegExp(youtubeRegex.source, "g")),
  );
  youtubeMatches.forEach((match) => {
    const youtubeUrl = match[0];
    // Only add if not already in videoUrls
    if (!videoUrls.includes(youtubeUrl)) {
      videoUrls.push(youtubeUrl);
    }
  });

  // Extract from resultsContext if user mentions video
  const mentionsVideo = /\b(video|youtube|watch|analyze.*video)\b/i.test(
    userPrompt,
  );
  if (resultsContext && resultsContext.length > 0 && mentionsVideo) {
    for (const result of resultsContext) {
      const content = result.content || result.text || "";

      // Extract Roam format videos
      roamVideoRegex.lastIndex = 0;
      const contextVideoMatches = Array.from(content.matchAll(roamVideoRegex));
      contextVideoMatches.forEach((match) => {
        const videoUrl = match[2];
        if (!videoUrls.includes(videoUrl)) {
          videoUrls.push(videoUrl);
        }
      });

      // Extract YouTube URLs
      const contextYoutubeMatches = Array.from(
        content.matchAll(new RegExp(youtubeRegex.source, "g")),
      );
      contextYoutubeMatches.forEach((match) => {
        const youtubeUrl = match[0];
        if (!videoUrls.includes(youtubeUrl)) {
          videoUrls.push(youtubeUrl);
        }
      });
    }
  }

  // Remove duplicates
  return Array.from(new Set(videoUrls));
}

/**
 * Handle video analysis request (requires Gemini model)
 *
 * @param originalUserPrompt - The user's original text prompt
 * @param modelId - The model ID from state
 * @param resultsContext - Results context containing video files
 * @param currentMessages - Current message history
 * @returns Result with updated messages
 */
export async function handleVideoAnalysisRequest(
  originalUserPrompt: string,
  modelId: string,
  resultsContext: any[] | undefined,
  currentMessages: any[],
): Promise<MultimodalCommandResult & { isAnalysisOnly?: boolean }> {
  // Check if Gemini model is being used (required for video)
  if (!modelId.toLowerCase().includes("gemini")) {
    return {
      messages: [
        ...currentMessages,
        new AIMessage(
          "⚠️ Video analysis requires a Gemini model. Please switch to a Gemini model to analyze video content.",
        ),
      ],
    };
  }

  // Check if Google library is available
  if (!googleLibrary) {
    return {
      messages: [
        ...currentMessages,
        new AIMessage(
          "⚠️ Video analysis requires Google API key. Please configure your Google API key in settings.",
        ),
      ],
    };
  }

  // Extract video URLs from prompt and context
  const videoUrls = extractVideoUrls(originalUserPrompt, resultsContext);

  if (videoUrls.length === 0) {
    // No video found - return without modification
    return { messages: currentMessages };
  }

  // Remove video URLs from prompt to check if user has additional instructions
  let cleanedPrompt = originalUserPrompt;
  roamVideoRegex.lastIndex = 0;
  cleanedPrompt = cleanedPrompt.replace(roamVideoRegex, "").trim();

  // Also remove standalone YouTube URLs
  const youtubeRegexGlobal = new RegExp(youtubeRegex.source, "g");
  cleanedPrompt = cleanedPrompt.replace(youtubeRegexGlobal, "").trim();

  // Check if user just wants analysis (no additional instructions)
  // If cleanedPrompt is empty or very short, they just want the default analysis
  const isAnalysisOnly = !cleanedPrompt || cleanedPrompt.length < 3;

  // Build the prompt for Gemini
  const analysisPrompt = isAnalysisOnly
    ? "Please analyze this video content. Provide a comprehensive summary including key points, topics discussed, and any important information."
    : cleanedPrompt;

  // Create message parts with video using addVideosToGeminiMessage
  const videoContent = videoUrls
    .map((url) => {
      // Check if it's a YouTube URL or needs wrapping
      if (youtubeRegex.test(url)) {
        return url; // YouTube URLs can be passed directly
      } else {
        return `{{[[video]]: ${url}}}`; // Wrap non-YouTube videos
      }
    })
    .join("\n");

  let messageParts = [{ text: analysisPrompt }];

  try {
    // Add videos to message parts
    messageParts = await addVideosToGeminiMessage(messageParts, videoContent);

    // Call Gemini API
    const response = await googleLibrary.models.generateContent({
      model: modelId,
      contents: messageParts,
    });

    const analysisText = response.text || "Video analysis completed.";

    return {
      messages: [...currentMessages, new AIMessage(analysisText)],
      isAnalysisOnly,
    };
  } catch (error) {
    console.error("Error analyzing video:", error);
    return {
      messages: [
        ...currentMessages,
        new AIMessage(`⚠️ Error analyzing video: ${error.message}`),
      ],
    };
  }
}

/**
 * Detect if prompt or context contains PDF files
 *
 * @param userPrompt - The user's text prompt
 * @param resultsContext - Results context from chat state
 * @returns true if PDF is detected, false otherwise
 */
export function hasPdfContent(
  userPrompt: string,
  resultsContext: any[] | undefined,
): boolean {
  // Check if user prompt contains PDF in Roam format: {{[[pdf]]: url}} or direct PDF URL
  pdfLinkRegex.lastIndex = 0;
  const pdfInPrompt = pdfLinkRegex.test(userPrompt);
  if (pdfInPrompt) {
    return true;
  }

  // Check if user mentions "pdf" in their prompt (suggesting they want to analyze PDF in context)
  const mentionsPdf = /\b(pdf|document|paper)\b/i.test(userPrompt);

  // Check if resultsContext contains PDF files
  if (resultsContext && resultsContext.length > 0 && mentionsPdf) {
    for (const result of resultsContext) {
      const content = result.content || result.text || "";

      // Check for PDF in Roam format or direct URLs
      pdfLinkRegex.lastIndex = 0;
      if (pdfLinkRegex.test(content)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extract all PDF URLs from prompt and context
 *
 * @param userPrompt - The user's text prompt
 * @param resultsContext - Results context from chat state
 * @returns Array of PDF URLs
 */
function extractPdfUrls(
  userPrompt: string,
  resultsContext: any[] | undefined,
): string[] {
  const pdfUrls: string[] = [];

  // Extract from user prompt - Roam format {{[[pdf]]: url}} or direct PDF URLs
  pdfLinkRegex.lastIndex = 0;
  const pdfMatches = Array.from(userPrompt.matchAll(pdfLinkRegex));
  pdfMatches.forEach((match) => {
    const pdfUrl = match[1] || match[2]; // Group 1 is direct URL, Group 2 is Roam syntax URL
    pdfUrls.push(pdfUrl);
  });

  // Extract from resultsContext if user mentions PDF
  const mentionsPdf = /\b(pdf|document|paper)\b/i.test(userPrompt);
  if (resultsContext && resultsContext.length > 0 && mentionsPdf) {
    for (const result of resultsContext) {
      const content = result.content || result.text || "";

      // Extract PDFs from context
      pdfLinkRegex.lastIndex = 0;
      const contextPdfMatches = Array.from(content.matchAll(pdfLinkRegex));
      contextPdfMatches.forEach((match) => {
        const pdfUrl = match[1] || match[2];
        if (!pdfUrls.includes(pdfUrl)) {
          pdfUrls.push(pdfUrl);
        }
      });
    }
  }

  // Remove duplicates
  return Array.from(new Set(pdfUrls));
}

/**
 * Handle PDF analysis request (requires Gemini model)
 *
 * @param originalUserPrompt - The user's original text prompt
 * @param modelId - The model ID from state
 * @param resultsContext - Results context containing PDF files
 * @param currentMessages - Current message history
 * @returns Result with updated messages
 */
export async function handlePdfAnalysisRequest(
  originalUserPrompt: string,
  modelId: string,
  resultsContext: any[] | undefined,
  currentMessages: any[],
): Promise<MultimodalCommandResult & { isAnalysisOnly?: boolean }> {
  // Check if Gemini model is being used (required for PDF)
  if (!modelId.toLowerCase().includes("gemini")) {
    return {
      messages: [
        ...currentMessages,
        new AIMessage(
          "⚠️ PDF analysis requires a Gemini model. Please switch to a Gemini model to analyze PDF content.",
        ),
      ],
    };
  }

  // Check if Google library is available
  if (!googleLibrary) {
    return {
      messages: [
        ...currentMessages,
        new AIMessage(
          "⚠️ PDF analysis requires Google API key. Please configure your Google API key in settings.",
        ),
      ],
    };
  }

  // Extract PDF URLs from prompt and context
  const pdfUrls = extractPdfUrls(originalUserPrompt, resultsContext);

  if (pdfUrls.length === 0) {
    // No PDF found - return without modification
    return { messages: currentMessages };
  }

  // Remove PDF URLs from prompt to check if user has additional instructions
  let cleanedPrompt = originalUserPrompt;
  pdfLinkRegex.lastIndex = 0;
  cleanedPrompt = cleanedPrompt.replace(pdfLinkRegex, "").trim();

  // Check if user just wants analysis (no additional instructions)
  // If cleanedPrompt is empty or very short, they just want the default analysis
  const isAnalysisOnly = !cleanedPrompt || cleanedPrompt.length < 3;

  // Build the prompt for Gemini
  const analysisPrompt = isAnalysisOnly
    ? "Please analyze this PDF document. Provide a comprehensive summary including key points, main topics, and important information."
    : cleanedPrompt;

  // Build PDF content string (with Roam syntax for Firebase PDFs, plain URLs for external)
  const pdfContent = pdfUrls
    .map((url) => {
      // Wrap in Roam syntax if not already
      if (url.includes("firebasestorage.googleapis.com")) {
        return `{{[[pdf]]: ${url}}}`;
      } else {
        // External PDFs can be plain URLs (URL Context tool will handle them)
        return url;
      }
    })
    .join("\n");

  // Combine prompt with PDF content
  const fullPrompt = `${pdfContent}\n\n${analysisPrompt}`;

  try {
    // Call Gemini API with URL Context tool for external PDFs
    const response = await googleLibrary.models.generateContent({
      model: modelId,
      contents: [{ text: fullPrompt }],
      config: {
        tools: [{ urlContext: {} }], // Enable URL Context for external PDFs
      },
    });

    const analysisText = response.text || "PDF analysis completed.";

    return {
      messages: [...currentMessages, new AIMessage(analysisText)],
      isAnalysisOnly,
    };
  } catch (error) {
    console.error("Error analyzing PDF:", error);
    return {
      messages: [
        ...currentMessages,
        new AIMessage(`⚠️ Error analyzing PDF: ${error.message}`),
      ],
    };
  }
}

/**
 * Check if the command is a web search request
 *
 * @param commandPrompt - The command prompt string
 * @returns true if this is a web search request
 */
export function isWebSearchRequest(commandPrompt: string | undefined): boolean {
  return commandPrompt === "Web search";
}

/**
 * Handle web search request using aiCompletion
 *
 * @param userPrompt - The user's search query
 * @param instantModel - Optional model ID to use (if not provided, uses default web search model)
 * @param resultsContext - Optional context from selected results
 * @param currentMessages - Current message history
 * @returns Result with web search response
 */
export async function handleWebSearchRequest(
  userPrompt: string,
  instantModel: string | undefined,
  resultsContext: any[] | undefined,
  currentMessages: any[],
): Promise<MultimodalCommandResult> {
  try {
    // Build context string if results are provided
    let contextString = "";
    if (resultsContext && resultsContext.length > 0) {
      contextString = buildResultsContext(resultsContext);
    }

    // Determine default web search model if not provided or not a web search model
    if (!instantModel || !webSearchModels.includes(instantModel)) {
      const modelConfig = getModelConfig();
      const currentDefaultModel =
        (await extensionStorage.get("defaultModel")) || defaultModel;
      const orderedProviders = getOrderedProviders();

      instantModel = getDefaultWebSearchModel(
        currentDefaultModel,
        isModelVisible,
        orderedProviders,
        modelConfig.modelOrder,
        modelConfig.defaultWebSearchModel,
      );

      // If no web search model is available, throw error
      if (!instantModel) {
        throw new Error(
          "No web search capable model is currently enabled. Please enable at least one web search model in the Model Configuration.",
        );
      }
    }

    console.log("Web search model :>> ", instantModel);

    // Call aiCompletion with Web search command
    // The aiCompletion function will handle the web search via the appropriate provider
    // If instantModel is provided, use it; otherwise aiCompletion will use the default web search model
    const response = await aiCompletion({
      instantModel: instantModel, // Use provided model or undefined for default
      prompt: [{ role: "user", content: userPrompt }], // Format prompt as message array
      command: "Web search",
      content: contextString,
      responseFormat: "text",
      targetUid: "chatResponse", // Special identifier to stream to chat UI instead of Roam blocks
      isButtonToInsert: false, // Don't insert buttons in chat mode
    });

    if (!response) {
      throw new Error("No response received from web search");
    }

    // Return the response as an AI message
    return {
      messages: [...currentMessages, new AIMessage(response)],
    };
  } catch (error) {
    console.error("Error performing web search:", error);
    return {
      messages: [
        ...currentMessages,
        new AIMessage(
          `⚠️ Error performing web search: ${error.message || "Unknown error"}`,
        ),
      ],
    };
  }
}

/**
 * Check if the command is a file export request (PDF, DOCX, or PPTX)
 *
 * @param commandPrompt - The command prompt string
 * @returns true if this is a file export request
 */
export function isFileExportRequest(
  commandPrompt: string | undefined,
): boolean {
  return (
    commandPrompt === "Export to PDF" ||
    commandPrompt === "Export to DOCX" ||
    commandPrompt === "Export to PPTX"
  );
}

/** @deprecated Use isFileExportRequest instead */
export function isPdfExportRequest(commandPrompt: string | undefined): boolean {
  return isFileExportRequest(commandPrompt);
}

/**
 * Handle file export command (PDF, DOCX, PPTX) via inline choice form + aiCompletion
 *
 * @param commandPrompt - The export command ("Export to PDF", "Export to DOCX", "Export to PPTX")
 * @param originalUserPrompt - The user's original text prompt
 * @param resultsContext - Results context from chat state
 * @param conversationHistory - Conversation history array
 * @param conversationSummary - Conversation summary string
 * @param userChoiceCallback - Callback to show inline choice form
 * @param currentMessages - Current message history
 * @returns Result with updated messages
 */
export async function handleFileExportCommand(
  commandPrompt: string,
  originalUserPrompt: string,
  resultsContext: any[] | undefined,
  conversationHistory: string[] | undefined,
  conversationSummary: string | undefined,
  userChoiceCallback:
    | ((req: any) => Promise<{
        selectedOptions: Record<string, string>;
        cancelled: boolean;
      }>)
    | undefined,
  currentMessages: any[],
): Promise<MultimodalCommandResult> {
  const formatLabel =
    commandPrompt === "Export to DOCX"
      ? "DOCX"
      : commandPrompt === "Export to PPTX"
        ? "PPTX"
        : "PDF";

  // Check that an Anthropic API key is configured (required for Claude Skills)
  if (!ANTHROPIC_API_KEY) {
    return {
      messages: [
        ...currentMessages,
        new AIMessage(
          `⚠️ An Anthropic API key is required for ${formatLabel} export (Claude Skills). Please add your key in the extension settings.`,
        ),
      ],
    };
  }

  // Check if userChoiceCallback is available
  if (!userChoiceCallback) {
    return {
      messages: [
        ...currentMessages,
        new AIMessage(
          `⚠️ ${formatLabel} export is not available in this context.`,
        ),
      ],
    };
  }

  // Determine available content sources
  const hasContext = resultsContext && resultsContext.length > 0;
  const hasConversation = conversationHistory && conversationHistory.length > 0;

  if (!hasContext && !hasConversation) {
    return {
      messages: [
        ...currentMessages,
        new AIMessage(
          `⚠️ No content available for ${formatLabel} export. Please add context blocks or start a conversation first.`,
        ),
      ],
    };
  }

  // Build choice options
  const options: Array<{
    id: string;
    label: string;
    type: "radio" | "text" | "slider";
    choices?: Array<{ value: string; label: string }>;
    defaultValue?: string;
    placeholder?: string;
    min?: number;
    max?: number;
    step?: number;
  }> = [];

  // Content source options (only if both are available)
  if (hasContext && hasConversation) {
    options.push({
      id: "source",
      label: "Content source",
      type: "radio",
      choices: [
        { value: "context", label: "Context blocks" },
        { value: "conversation", label: "Conversation history" },
        { value: "both", label: "Both" },
      ],
      defaultValue: "context",
    });
  }

  // Format options per export type
  if (commandPrompt === "Export to PDF" || commandPrompt === "Export to DOCX") {
    options.push({
      id: "format",
      label: "Document format",
      type: "radio",
      choices: [
        { value: "clean", label: "Clean document (prose)" },
        { value: "outline", label: "Outline (hierarchical)" },
      ],
      defaultValue: "clean",
    });
  } else if (commandPrompt === "Export to PPTX") {
    options.push({
      id: "format",
      label: "Content density",
      type: "radio",
      choices: [
        { value: "short", label: "Shortened content (lighter slides)" },
        { value: "full", label: "Full content (more charged slides)" },
      ],
      defaultValue: "short",
    });
    options.push({
      id: "slides",
      label: "Approximate number of slides",
      type: "slider",
      min: 3,
      max: 30,
      step: 1,
      defaultValue: "10",
    });
  }

  // Fidelity option for all formats
  options.push({
    id: "fidelity",
    label: "Content fidelity",
    type: "radio",
    choices: [
      { value: "faithful", label: "Faithful (preserve original wording)" },
      {
        value: "rephrase",
        label: "Rephrase (rewrite freely, keep the spirit)",
      },
    ],
    defaultValue: "faithful",
  });

  // Model choice for all formats
  options.push({
    id: "model",
    label: "Claude model",
    type: "radio",
    choices: [
      { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
      { value: "claude-opus-4-6", label: "Opus 4.6" },
      { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
    ],
    defaultValue: "claude-sonnet-4-6",
  });

  // Styling text input for all formats
  options.push({
    id: "styling",
    label: "Formatting preferences (optional)",
    type: "text",
    placeholder: "e.g. font, color theme, layout...",
  });

  // Show the choice form
  const choiceResult = await userChoiceCallback({
    commandId: "file_export",
    title: `${formatLabel} Export Options`,
    options,
  });

  if (choiceResult.cancelled) {
    return {
      messages: [
        ...currentMessages,
        new AIMessage(`${formatLabel} export cancelled.`),
      ],
    };
  }

  const sel = choiceResult.selectedOptions;

  // Determine content source
  let source = sel.source;
  if (!source) {
    source = hasContext ? "context" : "conversation";
  }

  // Build content string from selection
  let contentToExport = "";

  if (source === "context" || source === "both") {
    contentToExport += buildResultsContext(resultsContext!);
  }

  if (source === "conversation" || source === "both") {
    if (contentToExport) {
      contentToExport += "\n\n---\n\n";
    }
    if (conversationSummary) {
      contentToExport += `Summary of earlier conversation:\n${conversationSummary}\n\n`;
    }
    contentToExport += conversationHistory!.join("\n\n");
  }

  // Determine command based on format selection
  let command = commandPrompt;
  if (sel.format === "outline") {
    if (commandPrompt === "Export to PDF") command = "Export to PDF outline";
    else if (commandPrompt === "Export to DOCX")
      command = "Export to DOCX outline";
  } else if (commandPrompt === "Export to PPTX" && sel.format === "full") {
    command = "Export to PPTX full";
  }

  // Append optional user preferences to content
  if (sel.fidelity === "rephrase") {
    contentToExport += `\n\n---\nCONTENT FIDELITY: You may freely rephrase, restructure and rewrite the content. Respect the spirit and meaning but not necessarily the original wording.`;
  } else {
    contentToExport += `\n\n---\nCONTENT FIDELITY: Stay as faithful as possible to the original content and wording. Preserve the exact phrasing — only adapt formatting for the target document type.`;
  }
  if (sel.styling) {
    contentToExport += `\n\n---\nFORMATTING PREFERENCES: ${sel.styling}`;
  }
  if (sel.slides) {
    contentToExport += `\n\n---\nTARGET NUMBER OF SLIDES: approximately ${sel.slides} slides`;
  }

  // Use selected model or default to Sonnet
  const selectedModel = sel.model || "claude-sonnet-4-6";

  // Show early toast — the actual generation can take 1-2 minutes
  AppToaster.show({
    message: `⏳ Generating ${formatLabel} with Claude skill — this may take 1–2 minutes…`,
    timeout: 15000,
    intent: "primary",
    icon: "document",
  });

  try {
    const response = await aiCompletion({
      instantModel: selectedModel,
      prompt: [{ role: "user", content: originalUserPrompt || "" }],
      command,
      content: contentToExport,
      responseFormat: "text",
      targetUid: "chatResponse",
      isButtonToInsert: false,
    });

    AppToaster.clear();
    if (!response) {
      throw new Error(`No response received from ${formatLabel} export`);
    }

    return {
      messages: [...currentMessages, new AIMessage(response)],
    };
  } catch (error) {
    AppToaster.clear();
    AppToaster.show({
      message: `⚠️ ${formatLabel} export failed: ${error.message || "Unknown error"}`,
      timeout: 10000,
      intent: "danger",
      icon: "error",
    });
    console.error(`Error during ${formatLabel} export:`, error);
    return {
      messages: [
        ...currentMessages,
        new AIMessage(
          `⚠️ Error during ${formatLabel} export: ${error.message || "Unknown error"}`,
        ),
      ],
    };
  }
}

/** @deprecated Use handleFileExportCommand instead */
export async function handlePdfExportCommand(
  originalUserPrompt: string,
  resultsContext: any[] | undefined,
  conversationHistory: string[] | undefined,
  conversationSummary: string | undefined,
  userChoiceCallback:
    | ((req: any) => Promise<{
        selectedOptions: Record<string, string>;
        cancelled: boolean;
      }>)
    | undefined,
  currentMessages: any[],
): Promise<MultimodalCommandResult> {
  return handleFileExportCommand(
    "Export to PDF",
    originalUserPrompt,
    resultsContext,
    conversationHistory,
    conversationSummary,
    userChoiceCallback,
    currentMessages,
  );
}
