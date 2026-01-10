import {
  openaiLibrary,
  transcriptionLanguage,
  whisperPrompt,
  resImages,
  groqLibrary,
  isUsingGroqWhisper,
  maxImagesNb,
  openRouterModelsInfo,
  googleLibrary,
  ttsVoice,
  voiceInstructions,
  transcriptionModel,
  defaultImageModel,
} from "..";

import { updateTokenCounter } from "./modelsInfo";
import { createImageUsageObject } from "./utils/imageTokensCalculator";
import { hasCapability } from "./modelRegistry";

// Storage for active image generation chat instances
// Key: conversation parent UID, Value: chat instance
export const imageGenerationChats = new Map();
import {
  pdfLinkRegex,
  roamImageRegex,
  roamVideoRegex,
  youtubeRegex,
  videoStartTimeRegex,
  videoEndTimeRegex,
  roamAudioRegex,
  urlRegex,
} from "../utils/regex";
import { AppToaster, displayThinkingToast } from "../components/Toaster";
import {
  getFormatedPdfRole,
  getResolvedContentFromBlocks,
} from "./dataExtraction";
import { getParentBlock } from "../utils/roamAPI";

export async function transcribeAudio(filename) {
  if (!openaiLibrary && !groqLibrary) return null;
  try {
    // console.log(filename);
    const defaultPrompt =
      "Provide a clear transcription with proper paragraphs based on natural speech breaks, topic changes, or speaker changes. If multiple speakers are detected, indicate speaker changes. If audio is longuer than 30s, add mm:ss timestamp for key moments.";
    const options = {
      file: filename,
      model:
        isUsingGroqWhisper && groqLibrary
          ? "whisper-large-v3"
          : transcriptionModel,
      // stream: true, // doesn't work as real streaming here
      response_format: "text",
      prompt: whisperPrompt || defaultPrompt,
    };
    if (transcriptionLanguage) options.language = transcriptionLanguage;
    const transcript =
      isUsingGroqWhisper && groqLibrary
        ? await groqLibrary.audio.transcriptions.create(options)
        : await openaiLibrary.audio.transcriptions.create(options);
    // console.log(transcript);

    return transcript ? transcript.trim() : "";

    // streaming doesn't work as expected (await for the whole audio transcription before streaming...)
    // let transcribedText = "";
    // const streamElt = insertParagraphForStream("FSeIh5CS8"); // test uid
    // let accumulatedData = "";
    // for await (const event of transcript) {
    //   accumulatedData += event;
    //   const endOfMessageIndex = accumulatedData.indexOf("\n");
    //   if (endOfMessageIndex !== -1) {
    //     const completeMessage = accumulatedData.substring(0, endOfMessageIndex);
    //     console.log("completedMessage :>> ", completeMessage);
    //     if (completeMessage.startsWith("data: ")) {
    //       try {
    //         const jsonStr = completeMessage.replace("data: ", "");
    //         const jsonObj = JSON.parse(jsonStr);
    //         console.log("Nouvel objet reçu:", jsonObj);
    //         // console.log(`Type: ${jsonObj.type}, Delta: ${jsonObj.delta}`);s
    //         streamElt.innerHTML += jsonObj.delta;
    //         transcribedText += jsonObj.delta;
    //       } catch (error) {
    //         console.error("Erreur de parsing JSON:", error);
    //       }
    //     }
    //     accumulatedData = accumulatedData.substring(endOfMessageIndex + 2);
    //   }
    // }
    // streamElt.remove();
    // return transcribedText;
  } catch (error) {
    console.error(error.message);
    AppToaster.show({
      message: `${
        isUsingGroqWhisper && groqLibrary ? "Groq API" : "OpenAI API"
      } error msg: ${error.message}`,
      timeout: 15000,
    });
    return "";
  }
}

export async function translateAudio(filename) {
  if (!openaiLibrary) return null;
  try {
    const options = {
      file: filename,
      model: "whisper-1",
    };
    // if (transcriptionLanguage) options.language = transcriptionLanguage;
    // if (whisperPrompt) options.prompt = whisperPrompt;
    const transcript = await openaiLibrary.audio.translations.create(options);
    return transcript.text;
  } catch (error) {
    console.error(error);
    AppToaster.show({
      message: `OpenAI error msg: ${error.message}`,
      timeout: 15000,
    });
    return null;
  }
}

// Global variable to track currently playing audio
let currentAudio = null;
let currentAudioText = null;

export async function textToSpeech(inputText, instructions) {
  if (!inputText) return;
  if (!openaiLibrary) {
    AppToaster.show({
      message: `OpenAI API Key is needed for Text to Speech feature`,
      timeout: 10000,
    });
    return;
  }
  if (Array.isArray(inputText)) {
    inputText = getResolvedContentFromBlocks(inputText, false, false);
  }

  // If clicking TTS for the same text that's currently playing, stop it
  if (currentAudio && currentAudioText === inputText) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
    currentAudioText = null;
    AppToaster.show({
      message: "Audio stopped",
      timeout: 2000,
    });
    return;
  }

  // If there's a different audio playing, stop it first
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
    currentAudioText = null;
  }

  try {
    const response = await openaiLibrary.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: ttsVoice.toLowerCase() || "ash",
      input: inputText,
      instructions:
        instructions ||
        voiceInstructions ||
        "Voice Affect: Calm, composed, and reassuring. Competent and in control, instilling trust.",
      response_format: "wav",
    });
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    // Store reference to current audio
    currentAudio = audio;
    currentAudioText = inputText;

    // events to handle stop or end of audio
    const stopAudio = () => {
      audio.pause();
      audio.currentTime = 0;
      currentAudio = null;
      currentAudioText = null;
      document.removeEventListener("keydown", handleKeyPress);
    };
    const handleKeyPress = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        stopAudio();
      }
    };
    audio.addEventListener("ended", () => {
      currentAudio = null;
      currentAudioText = null;
      document.removeEventListener("keydown", handleKeyPress);
    });

    audio.play();
    document.addEventListener("keydown", handleKeyPress);
  } catch (error) {
    console.error(error);
    AppToaster.show({
      message: `OpenAI error msg: ${error.message}`,
      timeout: 15000,
    });
  }
}

/**
 * Parse nano banana specific parameters from user prompt
 * Extracts aspectRatio, imageSize, and googleSearch mentions
 */
function parseNanoBananaParams(prompt) {
  const config = {};
  let cleanedPrompt = prompt;

  // Extract aspectRatio (1:1|2:3|3:2|3:4|4:3|4:5|5:4|9:16|16:9|21:9)
  const aspectRatioRegex = /\b(1:1|2:3|3:2|3:4|4:3|4:5|5:4|9:16|16:9|21:9)\b/;
  const aspectRatioMatch = prompt.match(aspectRatioRegex);
  if (aspectRatioMatch) {
    config.aspectRatio = aspectRatioMatch[1];
    cleanedPrompt = cleanedPrompt.replace(aspectRatioMatch[0], "").trim();
  }

  // Extract imageSize (1K|2K|4K) - case insensitive match but store as uppercase
  const imageSizeRegex = /\b([1-4])k\b/i;
  const imageSizeMatch = prompt.match(imageSizeRegex);
  if (imageSizeMatch) {
    config.imageSize = imageSizeMatch[1] + "K"; // Always uppercase K
    cleanedPrompt = cleanedPrompt.replace(imageSizeMatch[0], "").trim();
  }

  // Check for exact 'googleSearch' mention (case sensitive)
  if (prompt.includes("googleSearch")) {
    config.googleSearch = true;
    cleanedPrompt = cleanedPrompt.replace(/googleSearch/g, "").trim();
  }

  // Clean up extra whitespace
  cleanedPrompt = cleanedPrompt.replace(/\s+/g, " ").trim();

  return { prompt: cleanedPrompt, config };
}

/**
 * Format image URL with model attribution
 * @param {string} imageUrl - The Firebase image URL
 * @param {string} model - The model name
 * @returns {string} - Formatted string with image and attribution
 */
function formatImageWithAttribution(imageUrl, model) {
  // Format: ![](url)
  // Image generated by [model]
  return `Image generated by ${model}:\n${imageUrl}`;
}

export async function processPromptForImagen(prompt) {
  // Use Gemini to translate and extract parameters from the prompt
  if (!googleLibrary) return { prompt, config: {} };

  try {
    const systemPrompt = `You are a prompt processor for Google Imagen. Your task is to:
1. Translate the prompt to English if it's not already in English
2. Extract image generation parameters from natural language descriptions
3. Return a JSON object with the processed prompt and configuration

Extract these parameters if mentioned:
- numberOfImages: between 1-4 (default: 1)
- imageSize: "1K" or "2K" (default: "1K")
- aspectRatio: "1:1", "3:4", "4:3", "9:16", or "16:9" (default: "1:1")

Examples:
Input: "Un robot tenant un skateboard rouge, format 16:9"
Output: {"prompt": "Robot holding a red skateboard", "config": {"aspectRatio": "16:9"}}

Input: "Generate 3 images of a sunset in portrait mode"
Output: {"prompt": "Sunset", "config": {"numberOfImages": 3, "aspectRatio": "3:4"}}

Return ONLY valid JSON, no other text.`;

    const response = await googleLibrary.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ text: `Process this prompt: ${prompt}` }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      config: {
        responseMimeType: "application/json",
      },
    });

    let resultText = response.text;
    // Remove markdown code blocks if present
    resultText = resultText.replace(/```json\n?/g, "").replace(/```\n?/g, "");

    const result = JSON.parse(resultText);
    return {
      prompt: result.prompt || prompt,
      config: result.config || {},
    };
  } catch (error) {
    console.error("Error processing prompt for Imagen:", error);
    return { prompt, config: {} };
  }
}

/**
 * Find existing image generation chat in parent hierarchy
 * @param {string} blockUid - Starting block UID
 * @param {string} model - The model name
 * @returns {string|null} - The conversationUid if found, null otherwise
 */
function findExistingImageChat(blockUid, model) {
  if (!blockUid || !model.includes("gemini")) {
    return null;
  }

  let currentUid = blockUid;
  const maxDepth = 10; // Prevent infinite loops
  let depth = 0;

  while (currentUid && depth < maxDepth) {
    const chatKey = `${currentUid}_${model}`;
    if (imageGenerationChats.has(chatKey)) {
      return currentUid;
    }

    // Move up to parent using existing getParentBlock
    const parentUid = getParentBlock(currentUid);
    if (parentUid) {
      currentUid = parentUid;
      depth++;
    } else {
      break;
    }
  }

  return null;
}

/**
 * Get or create an image generation chat instance for nano banana models
 * @param {string} conversationUid - Parent block UID for the conversation
 * @param {string} model - The model name
 * @param {object} config - Initial config for the chat
 * @returns {object} - Chat instance
 */
function getOrCreateImageChat(conversationUid, model, config = {}) {
  if (!conversationUid || !model.includes("gemini")) {
    return null;
  }

  // First, try to find an existing chat in the parent hierarchy
  const existingChatUid = findExistingImageChat(conversationUid, model);
  const chatUid = existingChatUid || conversationUid;

  const chatKey = `${chatUid}_${model}`;

  if (!imageGenerationChats.has(chatKey)) {
    // Create new chat instance
    const chat = googleLibrary.chats.create({
      model,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        ...config,
      },
    });
    imageGenerationChats.set(chatKey, chat);
  }

  return imageGenerationChats.get(chatKey);
}

/**
 * Clear image generation chat for a conversation
 * @param {string} conversationUid - Parent block UID for the conversation
 * @param {string} model - The model name (optional, clears all if not provided)
 */
export function clearImageGenerationChat(conversationUid, model = null) {
  if (model) {
    const chatKey = `${conversationUid}_${model}`;
    imageGenerationChats.delete(chatKey);
  } else {
    // Clear all chats for this conversation
    const keysToDelete = [];
    for (const key of imageGenerationChats.keys()) {
      if (key.startsWith(conversationUid + "_")) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => imageGenerationChats.delete(key));
  }
}

// Replace Buffer.from(arrayBuffer).toString('base64')
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Replace Buffer.from(base64, 'base64')
function base64ToBlob(base64, mimeType = "image/png") {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

export async function imageGeneration(
  prompt,
  quality = "auto",
  model,
  tokensCallback,
  conversationUid = null // Optional: parent block UID for chat-based editing
) {
  // Use default image model if no model specified
  if (!model) {
    model = defaultImageModel;
  }

  // Check if selected model requires Google API and fallback if not available
  const requiresGoogle =
    model === "gemini-2.5-flash-image" ||
    model === "gemini-3-pro-image-preview" ||
    model.includes("imagen-4.0");

  if (requiresGoogle && !googleLibrary?.apiKey) {
    const warningMessage = `Google API key required for ${model}. Falling back to gpt-image-1-mini.`;
    console.warn(warningMessage);
    AppToaster.show({
      message: warningMessage,
      intent: "warning",
      timeout: 5000,
    });
    model = "gpt-image-1-mini";
  }

  // Validate prompt - prevent generating random images with empty prompts
  if (!prompt || (typeof prompt === "string" && prompt.trim() === "")) {
    const errorMessage =
      "Error: Image generation requires a text prompt. Please provide a description of the image you want to generate.";
    console.error(errorMessage);
    AppToaster.show({
      message: errorMessage,
      intent: "danger",
      timeout: 5000,
    });
    return errorMessage;
  }

  // Determine if we're using Google Imagen/Gemini or OpenAI
  const isGoogleImagen =
    model === "imagen-4.0-generate-001" ||
    model === "imagen-4.0-ultra-generate-001" ||
    model === "imagen-4.0-fast-generate-001" ||
    model === "gemini-2.5-flash-image" ||
    model === "gemini-3-pro-image-preview" ||
    (model && model.includes("gemini"));

  // Select appropriate model based on quality if model includes "gemini" but isn't specific
  if (
    isGoogleImagen &&
    model.includes("gemini") &&
    model !== "gemini-2.5-flash-image" &&
    model !== "gemini-3-pro-image-preview"
  ) {
    // Default to gemini-2.5-flash-image (nano banana)
    model = "gemini-2.5-flash-image";
  } else if (
    isGoogleImagen &&
    !model.includes("gemini") &&
    !model.includes("imagen")
  ) {
    // If it's determined as Google but not specific, use default
    model = "gemini-2.5-flash-image";
  }

  // For Imagen-specific models, adjust based on quality
  if (model && model.startsWith("imagen-4.0")) {
    if (quality === "high") {
      model = "imagen-4.0-ultra-generate-001";
    } else if (quality === "low") {
      model = "imagen-4.0-fast-generate-001";
    } else {
      // "medium" or "auto"
      model = "imagen-4.0-generate-001";
    }
  }

  const isNanoBanana =
    model === "gemini-2.5-flash-image" ||
    model === "gemini-3-pro-image-preview";

  const isNanoBananaPro = model === "gemini-3-pro-image-preview";

  // Check required libraries
  if (isGoogleImagen && !googleLibrary) {
    AppToaster.show({
      message: `Google API Key is needed for Gemini/Imagen image generation`,
      timeout: 10000,
    });
    return;
  }

  if (!isGoogleImagen && !openaiLibrary) {
    AppToaster.show({
      message: `OpenAI API Key is needed for image generation`,
      timeout: 10000,
    });
    return;
  }

  try {
    let result;

    // Google Gemini/Imagen generation
    if (isGoogleImagen) {
      // Check if there are images in the prompt (for editing)
      roamImageRegex.lastIndex = 0;
      const matchingImagesInPrompt = Array.from(
        prompt.matchAll(roamImageRegex)
      );

      // For nano banana, support image editing (single or multiple images)
      if (isNanoBanana && matchingImagesInPrompt.length) {
        // Remove image markdown from prompt
        let textPrompt = prompt;
        for (const match of matchingImagesInPrompt) {
          textPrompt = textPrompt.replace(
            match[0],
            match[1] ? `[${match[1]}]` : ""
          );
        }

        // Parse nano banana specific parameters from the prompt
        const { prompt: processedPrompt, config: nanoBananaConfig } =
          parseNanoBananaParams(textPrompt);

        // Ensure the model generates an image by adding explicit instruction
        const enhancedPrompt = `${processedPrompt}\n\nIMPORTANT: You must generate an image based on the description and input image(s) above. Do not provide text-only responses.`;

        // Apply quality fallback for imageSize if not parsed (pro model only)
        if (isNanoBananaPro && !nanoBananaConfig.imageSize) {
          if (quality === "high") {
            nanoBananaConfig.imageSize = "4K";
          } else if (quality === "low") {
            nanoBananaConfig.imageSize = "1K";
          } else {
            // "medium" or "auto"
            nanoBananaConfig.imageSize = "2K";
          }
        }

        // Fetch and convert all images to base64
        const imageDataArray = [];
        for (const match of matchingImagesInPrompt) {
          const imageUrl = match[2]; // URL is in capture group 2

          const imageBlob = await roamAlphaAPI.file.get({ url: imageUrl });
          const imageArrayBuffer = await imageBlob.arrayBuffer();
          const imageBase64 = arrayBufferToBase64(imageArrayBuffer);
          const mimeType = imageBlob.type || "image/png";

          imageDataArray.push({
            inlineData: {
              mimeType: mimeType,
              data: imageBase64,
            },
          });
        }

        // Create multi-part prompt with text and all images
        // Format: [text, image1, image2, ...]
        const contents = [{ text: enhancedPrompt }, ...imageDataArray];

        // Build config object for nano banana
        const generateConfig = {
          responseModalities: ["IMAGE"],
        };
        if (
          nanoBananaConfig.aspectRatio ||
          (isNanoBananaPro && nanoBananaConfig.imageSize)
        ) {
          generateConfig.imageConfig = {};
          if (nanoBananaConfig.aspectRatio) {
            generateConfig.imageConfig.aspectRatio =
              nanoBananaConfig.aspectRatio;
          }
          // imageSize only for pro model
          if (isNanoBananaPro && nanoBananaConfig.imageSize) {
            generateConfig.imageConfig.imageSize = nanoBananaConfig.imageSize;
          }
        }
        // googleSearch only for pro model
        if (isNanoBananaPro && nanoBananaConfig.googleSearch) {
          generateConfig.tools = [{ googleSearch: {} }];
        }

        // Check if we should use chat-based API for multi-turn editing
        const chat = conversationUid
          ? getOrCreateImageChat(conversationUid, model, generateConfig)
          : null;

        if (chat) {
          // Use chat.sendMessage for multi-turn image editing
          result = await chat.sendMessage({
            message: contents,
            ...(Object.keys(generateConfig).length > 0 && {
              config: generateConfig,
            }),
          });
        } else {
          // Use single-turn generateContent for image editing
          result = await googleLibrary.models.generateContent({
            model,
            contents: contents,
            ...(Object.keys(generateConfig).length > 0 && {
              config: generateConfig,
            }),
          });
        }

        // Extract the generated image from response
        if (result.candidates && result.candidates.length > 0) {
          const candidate = result.candidates[0];

          // Check if content and parts exist
          if (!candidate.content || !candidate.content.parts) {
            console.error("Invalid response structure:", result);
            throw new Error(
              "Invalid response structure: missing content.parts"
            );
          }

          for (const part of candidate.content.parts) {
            // if (part.text) {
            //   // In case of text output
            //   console.log("Nano banana text response:", part.text);
            // }
            if (part.inlineData) {
              const imageData = part.inlineData.data;
              const blob = base64ToBlob(imageData);
              const firebaseUrl = await roamAlphaAPI.file.upload({
                file: blob,
              });

              // Track usage for nano banana editing with proper token counting
              const usage = createImageUsageObject(
                model,
                result,
                nanoBananaConfig.imageSize || "2K",
                true // hasInputImage
              );
              if (tokensCallback) {
                tokensCallback(usage);
              }
              updateTokenCounter(model, usage);

              return formatImageWithAttribution(firebaseUrl, model);
            }
          }
          throw new Error("No image in nano banana response");
        } else {
          throw new Error("No response from nano banana");
        }
      } else {
        // Standard generation (no input image)

        // Nano banana uses generateContent API (or chat for multi-turn)
        if (isNanoBanana) {
          // Parse nano banana specific parameters from the prompt
          const { prompt: processedPrompt, config: nanoBananaConfig } =
            parseNanoBananaParams(prompt);

          // Ensure the model generates an image by adding explicit instruction
          const enhancedPrompt = `${processedPrompt}\n\nIMPORTANT: You must generate an image based on the description above. Do not provide text-only responses.`;

          // Apply quality fallback for imageSize if not parsed (pro model only)
          if (isNanoBananaPro && !nanoBananaConfig.imageSize) {
            if (quality === "high") {
              nanoBananaConfig.imageSize = "4K";
            } else if (quality === "low") {
              nanoBananaConfig.imageSize = "1K";
            } else {
              // "medium" or "auto"
              nanoBananaConfig.imageSize = "2K";
            }
          }

          // Build config object for nano banana
          const generateConfig = {
            responseModalities: ["IMAGE"],
          };
          if (
            nanoBananaConfig.aspectRatio ||
            (isNanoBananaPro && nanoBananaConfig.imageSize)
          ) {
            generateConfig.imageConfig = {};
            if (nanoBananaConfig.aspectRatio) {
              generateConfig.imageConfig.aspectRatio =
                nanoBananaConfig.aspectRatio;
            }
            // imageSize only for pro model
            if (isNanoBananaPro && nanoBananaConfig.imageSize) {
              generateConfig.imageConfig.imageSize = nanoBananaConfig.imageSize;
            }
          }
          // googleSearch only for pro model
          if (isNanoBananaPro && nanoBananaConfig.googleSearch) {
            generateConfig.tools = [{ googleSearch: {} }];
          }

          // Check if we should use chat-based API for multi-turn editing
          const chat = conversationUid
            ? getOrCreateImageChat(conversationUid, model, generateConfig)
            : null;

          if (chat) {
            // Use chat.sendMessage for multi-turn conversation
            result = await chat.sendMessage({
              message: enhancedPrompt,
              ...(Object.keys(generateConfig).length > 0 && {
                config: generateConfig,
              }),
            });
          } else {
            // Use single-turn generateContent API
            const contents = [{ text: enhancedPrompt }];
            result = await googleLibrary.models.generateContent({
              model,
              contents: contents,
              ...(Object.keys(generateConfig).length > 0 && {
                config: generateConfig,
              }),
            });
          }

          // Extract the generated image from response
          if (result.candidates && result.candidates.length > 0) {
            const candidate = result.candidates[0];

            // Check if content and parts exist
            if (!candidate.content || !candidate.content.parts) {
              console.error("Invalid response structure:", result);
              throw new Error(
                "Invalid response structure: missing content.parts"
              );
            }

            for (const part of candidate.content.parts) {
              //   if (part.text) {
              //     // Text output in case of problem - return text to Roam
              //     console.log("Nano banana text response:", part.text);
              //   }
              if (part.inlineData) {
                const imageData = part.inlineData.data;

                const blob = base64ToBlob(imageData);
                const firebaseUrl = await roamAlphaAPI.file.upload({
                  file: blob,
                });

                // Track usage for nano banana generation with proper token counting
                const usage = createImageUsageObject(
                  model,
                  result,
                  nanoBananaConfig.imageSize || "2K",
                  false // no input image
                );
                if (tokensCallback) {
                  tokensCallback(usage);
                }
                updateTokenCounter(model, usage);

                return formatImageWithAttribution(firebaseUrl, model);
              }
            }
            throw new Error("No image in nano banana response");
          } else {
            throw new Error("No response from nano banana");
          }
        } else {
          // Imagen models use generateImages API
          // Process prompt with Gemini for translation and parameter extraction
          const { prompt: processedPrompt, config } =
            await processPromptForImagen(prompt);

          result = await googleLibrary.models.generateImages({
            model,
            prompt: processedPrompt,
            config: {
              numberOfImages: config.numberOfImages || 1,
              imageSize: config.imageSize,
              aspectRatio: config.aspectRatio,
            },
          });

          // Process the first generated image
          if (result.generatedImages && result.generatedImages.length > 0) {
            const imgBytes = result.generatedImages[0].image.imageBytes;
            const blob = base64ToBlob(imgBytes);
            const firebaseUrl = await roamAlphaAPI.file.upload({
              file: blob,
            });

            // Track usage for Imagen models (1 image = 1 "output token" for pricing)
            const usage = {
              input_tokens: 0,
              output_tokens: 1, // 1 image generated
            };
            if (tokensCallback) {
              tokensCallback(usage);
            }
            updateTokenCounter(model, usage);

            return formatImageWithAttribution(firebaseUrl, model);
          } else {
            throw new Error("No images generated");
          }
        }
      }
    }

    // OpenAI image generation (existing logic)
    if (!model || model !== "gpt-image-1") {
      model = "gpt-image-1-mini";
    }

    let mode = "generate";
    let options = {
      model,
      prompt,
      quality,
      size: "auto",
      background: "auto",
      moderation: "low",
    };

    // extract images from prompt
    roamImageRegex.lastIndex = 0;
    const matchingImagesInPrompt = Array.from(prompt.matchAll(roamImageRegex));
    if (matchingImagesInPrompt.length) {
      const imageURLs = [];
      let maskIndex = null;
      for (let i = 0; i < matchingImagesInPrompt.length; i++) {
        imageURLs.push(matchingImagesInPrompt[i][2]);
        if (matchingImagesInPrompt[i][1] === "mask") maskIndex = i;
        prompt = prompt.replace(
          matchingImagesInPrompt[i][0],
          matchingImagesInPrompt[i][1]
            ? i === maskIndex
              ? `Image n°${i} is the mask`
              : `Title of image n°${i + 1}: ${matchingImagesInPrompt[i][1]}`
            : ""
        );
        //console.log(imageURLs);
      }
      mode = "edit";
      const images = await Promise.all(
        imageURLs.map(async (url) => await roamAlphaAPI.file.get({ url }))
      );

      if (maskIndex !== null) {
        options.mask = images[maskIndex];
        options.image = images[maskIndex === 0 ? 1 : 0];
      } else {
        options.image = images;
      }
    }
    if (mode === "generate")
      result = await openaiLibrary.images.generate(options);
    else if (mode === "edit") result = await openaiLibrary.images.edit(options);
    // console.log("result :>> ", result);
    if (result.usage) {
      const usage = {
        input_tokens: {},
        output_tokens: 0,
      };

      usage["input_tokens"] = result.usage["input_tokens_details"];
      usage["output_tokens"] = result.usage["output_tokens"];
      if (tokensCallback)
        tokensCallback({
          input_tokens: result.usage["input_tokens"],
          output_tokens: usage["output_tokens"],
        });
      updateTokenCounter(model, usage);
    }
    const image_base64 = result.data[0].b64_json;
    const byteCharacters = atob(image_base64);
    const byteNumbers = Array.from(byteCharacters).map((c) => c.charCodeAt(0));
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: "image/png" });
    const firebaseUrl = await roamAlphaAPI.file.upload({
      file: blob,
    });
    return formatImageWithAttribution(firebaseUrl, model);
  } catch (error) {
    console.error(error);
    AppToaster.show({
      message: `OpenAI error msg: ${error.message}`,
      timeout: 15000,
    });
  }
}

export const addImagesUrlToMessages = async (
  messages,
  content,
  isAnthropicModel
) => {
  let nbCountdown = maxImagesNb;

  for (let i = 1; i < messages.length; i++) {
    roamImageRegex.lastIndex = 0;
    const matchingImagesInPrompt = Array.from(
      messages[i].content?.matchAll(roamImageRegex)
    );
    if (matchingImagesInPrompt.length) {
      messages[i].content = [
        {
          type: "text",
          text: messages[i].content,
        },
      ];
    }
    for (let j = 0; j < matchingImagesInPrompt.length; j++) {
      messages[i].content[0].text = messages[i].content[0].text
        .replace(matchingImagesInPrompt[j][0], `[Image ${i + 1}]`)
        .trim();
      if (nbCountdown > 0) {
        if (!isAnthropicModel)
          messages[i].content.push({
            type: "image_url",
            image_url: {
              url: matchingImagesInPrompt[j][2],
              detail: resImages,
            },
          });
        else if (isAnthropicModel)
          messages[i].content.push({
            type: "image",
            source: {
              type: "url",
              url: matchingImagesInPrompt[j][2],
            },
          });
      }
      nbCountdown--;
    }
  }

  if (content && content.length) {
    roamImageRegex.lastIndex = 0;
    const matchingImagesInContext = Array.from(
      content.matchAll(roamImageRegex)
    );
    for (let i = 0; i < matchingImagesInContext.length; i++) {
      if (nbCountdown > 0) {
        if (i === 0)
          messages.splice(1, 0, {
            role: "user",
            content: [
              { type: "text", text: "Image(s) provided in the context:" },
            ],
          });
        if (!isAnthropicModel) {
          messages[1].content.push({
            type: "image_url",
            image_url: {
              url: matchingImagesInContext[i][2],
              detail: resImages,
            },
          });
        } else if (isAnthropicModel) {
          messages[1].content.push({
            type: "image",
            source: {
              type: "url",
              url: matchingImagesInContext[i][2],
            },
          });
        }
        nbCountdown--;
      }
    }
  }
  return messages;
};

export const isModelSupportingImage = (model) => {
  if (!model) return false;

  // First, check the registry for capability
  if (hasCapability(model, "imageInput")) {
    return true;
  }

  // Fallback for dynamic models (OpenRouter) not in registry
  const modelLower = model.toLowerCase();
  if (openRouterModelsInfo.length) {
    const ormodel = openRouterModelsInfo.find(
      (m) => m.id.toLowerCase() === modelLower
    );
    if (ormodel) return ormodel.imagePricing ? true : false;
  }

  return false;
};

export const addPdfUrlToMessages = async (messages, content, provider) => {
  for (let i = 1; i < messages.length; i++) {
    pdfLinkRegex.lastIndex = 0;
    const matchingPdfInPrompt = Array.from(
      (typeof messages[i].content === "string"
        ? messages[i].content?.matchAll(pdfLinkRegex)
        : []) || []
    );

    if (matchingPdfInPrompt.length) {
      messages[i].content = [
        {
          type: provider !== "OpenAI" ? "text" : "input_text",
          text: messages[i].content,
        },
      ];
    }

    for (let j = 0; j < matchingPdfInPrompt.length; j++) {
      messages[i].content[0].text = messages[i].content[0].text
        .replace(matchingPdfInPrompt[j][0], "")
        .trim();

      const pdfRole = await getFormatedPdfRole(
        matchingPdfInPrompt[j][1],
        matchingPdfInPrompt[j][2],
        provider
      );

      messages[i].content.push(pdfRole);
    }
  }

  if (content && typeof content === "string" && content.length) {
    pdfLinkRegex.lastIndex = 0;
    const matchingPdfInContext = Array.from(content.matchAll(pdfLinkRegex));

    for (let i = 0; i < matchingPdfInContext.length; i++) {
      if (i === 0)
        messages.splice(1, 0, {
          role: "user",
          content: [
            {
              type: provider !== "OpenAI" ? "text" : "input_text",
              text: "Pdf(s) provided in the context:",
            },
          ],
        });
      const pdfRole = await getFormatedPdfRole(
        matchingPdfInContext[i][1],
        matchingPdfInContext[i][2],
        provider
      );
      messages[1].content.push(pdfRole);
    }
  }

  return messages;
};

export const addPdfToGeminiMessage = async (messageParts, content) => {
  // Extract PDF URLs from the content
  pdfLinkRegex.lastIndex = 0;
  const matchingPdfInContext = Array.from(content.matchAll(pdfLinkRegex));

  const externalPdfUrls = [];

  for (let i = 0; i < matchingPdfInContext.length; i++) {
    try {
      const pdfUrl = matchingPdfInContext[i][1] || matchingPdfInContext[i][2];

      if (pdfUrl.includes("firebasestorage.googleapis.com")) {
        // Firebase-hosted PDFs need to be uploaded via Files API (after decryption via Roam API)
        const pdfBlob = await roamAlphaAPI.file.get({ url: pdfUrl });

        const uploadedFile = await googleLibrary.files.upload({
          file: pdfBlob,
          config: {
            mimeType: "application/pdf",
          },
        });

        messageParts.push({
          fileData: {
            fileUri: uploadedFile.uri,
            mimeType: uploadedFile.mimeType,
          },
        });
      } else {
        // External PDFs - use URL Context tool (Gemini fetches them directly)
        externalPdfUrls.push(pdfUrl);
      }
    } catch (error) {
      console.error(`Error processing PDF: ${error.message}`);
      console.error(error);
    }
  }

  // Return both message parts and external PDF URLs
  return { messageParts, externalPdfUrls };
};

export const addImagesToGeminiMessage = async (messageParts, content) => {
  // Extract image URLs from the content
  roamImageRegex.lastIndex = 0;
  const matchingImagesInContent = Array.from(content.matchAll(roamImageRegex));

  for (let i = 0; i < matchingImagesInContent.length; i++) {
    try {
      const imageUrl = matchingImagesInContent[i][2];

      // Fetch the image from the URL
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        console.error(`Failed to fetch image from ${imageUrl}`);
        continue;
      }

      const imageArrayBuffer = await imageResponse.arrayBuffer();
      const imageBase64 = arrayBufferToBase64(imageArrayBuffer);

      // Detect MIME type from URL or response headers
      const contentType =
        imageResponse.headers.get("content-type") || "image/jpeg";

      // Add image as inline data to the message parts
      messageParts.push({
        inlineData: {
          mimeType: contentType,
          data: imageBase64,
        },
      });
    } catch (error) {
      console.error(`Error processing image: ${error.message}`);
    }
  }

  return messageParts;
};

// Helper function to parse time from user input (supports m:s or just s)
const parseVideoTime = (timeStr) => {
  const startMatch = timeStr.match(videoStartTimeRegex);
  const endMatch = timeStr.match(videoEndTimeRegex);

  let startOffset = null;
  let endOffset = null;

  if (startMatch) {
    if (startMatch[1] && startMatch[2]) {
      // Format: m:s
      const minutes = parseInt(startMatch[1], 10);
      const seconds = parseInt(startMatch[2], 10);
      startOffset = `${minutes * 60 + seconds}s`;
    } else if (startMatch[3]) {
      // Format: s only
      startOffset = `${startMatch[3]}s`;
    }
  }

  if (endMatch) {
    if (endMatch[1] && endMatch[2]) {
      // Format: m:s
      const minutes = parseInt(endMatch[1], 10);
      const seconds = parseInt(endMatch[2], 10);
      endOffset = `${minutes * 60 + seconds}s`;
    } else if (endMatch[3]) {
      // Format: s only
      endOffset = `${endMatch[3]}s`;
    }
  }

  return { startOffset, endOffset };
};

export const addVideosToGeminiMessage = async (messageParts, content) => {
  const processedUrls = new Set();

  // Parse start/end times from content
  const { startOffset, endOffset } = parseVideoTime(content);

  // First, process videos wrapped in {{[[video]]: }} or {{[[youtube]]: }} format
  roamVideoRegex.lastIndex = 0;
  const matchingVideosInContent = Array.from(content.matchAll(roamVideoRegex));

  for (let i = 0; i < matchingVideosInContent.length; i++) {
    try {
      // Group 1 is the keyword (video|youtube), Group 2 is the URL
      const videoUrl = matchingVideosInContent[i][2];
      processedUrls.add(videoUrl);

      const youtubeMatch = videoUrl.match(youtubeRegex);

      if (youtubeMatch) {
        // Use the full matched YouTube URL (youtubeMatch[0]) or construct it properly
        const youtubeUrl = youtubeMatch[0].startsWith("http")
          ? youtubeMatch[0]
          : `https://www.youtube.com/watch?v=${youtubeMatch[1]}`;

        const videoPart = {
          fileData: {
            fileUri: youtubeUrl,
            mimeType: "video/*",
          },
          mediaResolution: {
            level: "media_resolution_low",
          },
        };

        // Add videoMetadata if start/end times are specified
        if (startOffset || endOffset) {
          videoPart.videoMetadata = {};
          if (startOffset) videoPart.videoMetadata.startOffset = startOffset;
          if (endOffset) videoPart.videoMetadata.endOffset = endOffset;
        }

        messageParts.push(videoPart);
      } else {
        let videoBlob;

        if (videoUrl.includes("firebasestorage.googleapis.com")) {
          videoBlob = await roamAlphaAPI.file.get({ url: videoUrl });
        } else {
          const videoResponse = await fetch(videoUrl);
          if (!videoResponse.ok) {
            console.error(`Failed to fetch video from ${videoUrl}`);
            continue;
          }
          videoBlob = await videoResponse.blob();
        }

        const videoSize = videoBlob.size;

        if (videoSize > 20 * 1024 * 1024) {
          console.log(
            `Video is ${(videoSize / 1024 / 1024).toFixed(
              2
            )}MB. Using Files API.`
          );

          const uploadedFile = await googleLibrary.files.upload({
            file: videoBlob,
            config: {
              mimeType: videoBlob.type || "video/mp4",
            },
          });

          const videoPart = {
            fileData: {
              fileUri: uploadedFile.uri,
              mimeType: uploadedFile.mimeType,
            },
            mediaResolution: {
              level: "media_resolution_low",
            },
          };

          // Add videoMetadata if start/end times are specified
          if (startOffset || endOffset) {
            videoPart.videoMetadata = {};
            if (startOffset) videoPart.videoMetadata.startOffset = startOffset;
            if (endOffset) videoPart.videoMetadata.endOffset = endOffset;
          }

          messageParts.push(videoPart);
        } else {
          const videoArrayBuffer = await videoBlob.arrayBuffer();
          const videoBase64 = arrayBufferToBase64(videoArrayBuffer);
          const mimeType = videoBlob.type || "video/mp4";

          const videoPart = {
            inlineData: {
              mimeType: mimeType,
              data: videoBase64,
            },
            mediaResolution: {
              level: "media_resolution_low",
            },
          };

          // Add videoMetadata if start/end times are specified
          if (startOffset || endOffset) {
            videoPart.videoMetadata = {};
            if (startOffset) videoPart.videoMetadata.startOffset = startOffset;
            if (endOffset) videoPart.videoMetadata.endOffset = endOffset;
          }

          messageParts.push(videoPart);
        }
      }
    } catch (error) {
      console.error(`Error processing video: ${error.message}`);
    }
  }

  // Second, process standalone YouTube URLs in content that weren't already wrapped
  const youtubeRegexGlobal = new RegExp(youtubeRegex.source, "g");
  const standaloneYoutubeUrls = Array.from(
    content.matchAll(youtubeRegexGlobal)
  );

  for (let i = 0; i < standaloneYoutubeUrls.length; i++) {
    try {
      const youtubeUrl = standaloneYoutubeUrls[i][0];

      // Skip if this URL was already processed in the wrapped format
      if (processedUrls.has(youtubeUrl)) {
        continue;
      }

      // Ensure proper URL format
      const formattedUrl = youtubeUrl.startsWith("http")
        ? youtubeUrl
        : `https://www.youtube.com/watch?v=${standaloneYoutubeUrls[i][1]}`;

      const videoPart = {
        fileData: {
          fileUri: formattedUrl,
          mimeType: "video/*",
        },
        mediaResolution: {
          level: "media_resolution_low",
        },
      };

      // Add videoMetadata if start/end times are specified
      if (startOffset || endOffset) {
        videoPart.videoMetadata = {};
        if (startOffset) videoPart.videoMetadata.startOffset = startOffset;
        if (endOffset) videoPart.videoMetadata.endOffset = endOffset;
      }

      messageParts.push(videoPart);
    } catch (error) {
      console.error(
        `Error processing standalone YouTube URL: ${error.message}`
      );
    }
  }

  return messageParts;
};

// Transcribe audio from block content using either Gemini or OpenAI
export const transcribeAudioFromBlock = async (
  blockContent,
  userPrompt = "",
  model = ""
) => {
  try {
    // Check if we should use Gemini (if model name includes "gemini")
    const useGemini = model.toLowerCase().includes("gemini");

    // Extract audio URL from block content
    roamAudioRegex.lastIndex = 0;
    const audioMatches = Array.from(blockContent.matchAll(roamAudioRegex));

    if (!audioMatches || audioMatches.length === 0) {
      AppToaster.show({
        message: "No audio file found in the block.",
        timeout: 5000,
      });
      return null;
    }

    // Get the URL from the first match: Group 1 is from {{[[audio]]: url}}, Group 0 is from direct URLs
    const audioUrl = audioMatches[0][1] || audioMatches[0][0];

    if (useGemini && googleLibrary) {
      // Use Gemini for transcription
      const defaultInstructions =
        "Provide a clear transcription with proper paragraphs based on natural speech breaks, topic changes, or speaker changes. If multiple speakers are detected, indicate speaker changes (try to name them properly or follow the user indication if provided). Give timestamps for the key moments. If audio is longuer than 30s, add mm:ss timestamp for key moments.";
      const fullPrompt = userPrompt
        ? `${defaultInstructions}\n\nAdditional instructions: ${userPrompt}`
        : defaultInstructions;

      // Create message parts with audio
      let messageParts = [{ text: fullPrompt }];
      messageParts = await addAudioToGeminiMessage(messageParts, blockContent);

      // Call Gemini API
      const response = await googleLibrary.models.generateContent({
        model: model,
        contents: messageParts,
      });

      return response.text || "";
    } else if (openaiLibrary || groqLibrary) {
      // Use OpenAI/Groq for transcription
      // Fetch the audio file
      let audioBlob;
      if (audioUrl.includes("firebasestorage.googleapis.com")) {
        audioBlob = await roamAlphaAPI.file.get({ url: audioUrl });
      } else {
        const audioResponse = await fetch(audioUrl);
        if (!audioResponse.ok) {
          throw new Error(`Failed to fetch audio from ${audioUrl}`);
        }
        audioBlob = await audioResponse.blob();
      }

      // Determine the correct MIME type and filename
      const mimeType = audioBlob.type || getAudioMimeType(audioUrl);
      const extension =
        audioUrl.split(".").pop().toLowerCase().split("?")[0] || "mp3";
      const filename = `audio.${extension}`;

      // Create a File object for the API
      const audioFile = new File([audioBlob], filename, {
        type: mimeType,
      });

      // Prepare transcription options
      const defaultPrompt =
        "Provide a clear transcription with proper paragraphs based on natural speech breaks, topic changes, or speaker changes. If multiple speakers are detected, indicate speaker changes.";
      const options = {
        file: audioFile,
        model:
          isUsingGroqWhisper && groqLibrary
            ? "whisper-large-v3"
            : transcriptionModel,
        response_format: "text",
        prompt: userPrompt
          ? `${defaultPrompt}\n\nAdditional instructions: ${userPrompt}`
          : whisperPrompt || defaultPrompt,
      };

      if (transcriptionLanguage) options.language = transcriptionLanguage;

      const transcript =
        isUsingGroqWhisper && groqLibrary
          ? await groqLibrary.audio.transcriptions.create(options)
          : await openaiLibrary.audio.transcriptions.create(options);

      return transcript.text || transcript;
    } else {
      AppToaster.show({
        message:
          "No AI provider available for transcription. Please set up OpenAI or Google API key.",
        timeout: 8000,
      });
      return null;
    }
  } catch (error) {
    console.error("Error transcribing audio:", error);
    AppToaster.show({
      message: `Transcription error: ${error.message}`,
      timeout: 10000,
    });
    return null;
  }
};

// Helper function to get MIME type from audio extension
const getAudioMimeType = (url) => {
  const extension = url.split(".").pop().toLowerCase().split("?")[0];
  const mimeTypes = {
    mp3: "audio/mp3",
    wav: "audio/wav",
    aiff: "audio/aiff",
    aac: "audio/aac",
    ogg: "audio/ogg",
    flac: "audio/flac",
    m4a: "audio/m4a",
  };
  return mimeTypes[extension] || "audio/mpeg";
};

export const addAudioToGeminiMessage = async (messageParts, content) => {
  const processedUrls = new Set();

  // Parse start/end times from content (same logic as video)
  const { startOffset, endOffset } = parseVideoTime(content);

  // Process audio files in {{[[audio]]: url}} format and direct audio URLs
  roamAudioRegex.lastIndex = 0;
  const matchingAudioInContent = Array.from(content.matchAll(roamAudioRegex));

  for (let i = 0; i < matchingAudioInContent.length; i++) {
    try {
      // Group 1 is the URL from {{[[audio]]: url}} format, Group 2 is the extension from direct URLs
      const audioUrl =
        matchingAudioInContent[i][1] || matchingAudioInContent[i][0];

      // Skip if already processed
      if (processedUrls.has(audioUrl)) {
        continue;
      }
      processedUrls.add(audioUrl);

      let audioBlob;

      // Handle Roam-hosted files
      if (audioUrl.includes("firebasestorage.googleapis.com")) {
        audioBlob = await roamAlphaAPI.file.get({ url: audioUrl });
      } else {
        // Fetch from external URL
        const audioResponse = await fetch(audioUrl);
        if (!audioResponse.ok) {
          console.error(`Failed to fetch audio from ${audioUrl}`);
          continue;
        }
        audioBlob = await audioResponse.blob();
      }

      const audioSize = audioBlob.size;
      const mimeType = audioBlob.type || getAudioMimeType(audioUrl);

      if (audioSize > 20 * 1024 * 1024) {
        // Use Files API for large files (>20MB)
        console.log(
          `Audio is ${(audioSize / 1024 / 1024).toFixed(2)}MB. Using Files API.`
        );

        const uploadedFile = await googleLibrary.files.upload({
          file: audioBlob,
          config: {
            mimeType: mimeType,
          },
        });

        const audioPart = {
          fileData: {
            fileUri: uploadedFile.uri,
            mimeType: uploadedFile.mimeType,
          },
        };

        // Add audioMetadata if timestamp range is specified
        if (startOffset && endOffset) {
          audioPart.audioMetadata = {
            startOffset: startOffset,
            endOffset: endOffset,
          };
        }

        messageParts.push(audioPart);
      } else {
        // Inline base64 for small files (<20MB)
        const audioArrayBuffer = await audioBlob.arrayBuffer();
        const audioBase64 = arrayBufferToBase64(audioArrayBuffer);

        const audioPart = {
          inlineData: {
            mimeType: mimeType,
            data: audioBase64,
          },
        };

        // Add audioMetadata if timestamp range is specified
        if (startOffset && endOffset) {
          audioPart.audioMetadata = {
            startOffset: startOffset,
            endOffset: endOffset,
          };
        }

        messageParts.push(audioPart);
      }
    } catch (error) {
      console.error(`Error processing audio: ${error.message}`);
    }
  }

  return messageParts;
};
