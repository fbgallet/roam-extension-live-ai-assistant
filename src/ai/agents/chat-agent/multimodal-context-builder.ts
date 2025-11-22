/**
 * Multimodal Context Builder
 *
 * Helper utilities for building multimodal prompts from resultsContext
 * for image generation and other multimodal AI tasks
 */

import { roamImageRegex, roamAudioRegex, roamVideoRegex, youtubeRegex } from "../../../utils/regex";

export interface ExtractedContext {
  images: string[];  // Array of image markdown: ![alt](url)
  textContent: string[];  // Array of text content from results
  audioFiles: string[];  // Array of audio URLs or markdown: {{[[audio]]: url}}
  videoFiles?: string[];  // Array of video URLs or YouTube links
}

/**
 * Extract images, audio files and text content from resultsContext
 *
 * @param resultsContext - Array of Result objects from search/tools
 * @returns Extracted images, audio files and text content
 */
export function extractMultimodalContext(resultsContext: any[]): ExtractedContext {
  if (!resultsContext || resultsContext.length === 0) {
    return { images: [], textContent: [], audioFiles: [] };
  }

  const images: string[] = [];
  const audioFiles: string[] = [];
  const textContent: string[] = [];

  resultsContext.forEach((result: any, index: number) => {
    // Extract images and audio from content field
    if (result.content) {
      // Reset lastIndex for global regex
      roamImageRegex.lastIndex = 0;
      const imageMatches = Array.from(result.content.matchAll(roamImageRegex));

      if (imageMatches.length > 0) {
        imageMatches.forEach(match => {
          images.push(match[0]); // Full match: ![alt](url)
        });
      }

      // Extract audio files
      roamAudioRegex.lastIndex = 0;
      const audioMatches = Array.from(result.content.matchAll(roamAudioRegex));

      if (audioMatches.length > 0) {
        audioMatches.forEach(match => {
          // Extract URL from either {{[[audio]]: url}} or direct URL
          const audioUrl = match[1] || match[0];
          audioFiles.push(audioUrl);
        });
      }

      // Extract text content (remove images and audio)
      roamImageRegex.lastIndex = 0;
      roamAudioRegex.lastIndex = 0;
      let textOnly = result.content
        .replace(roamImageRegex, '')
        .replace(roamAudioRegex, '')
        .trim();
      if (textOnly) {
        textContent.push(textOnly);
      }
    }

    // Check for direct image URL properties
    if (result.imageUrl) {
      images.push(`![](${result.imageUrl})`);
    }

    // Check for images and audio in text field
    if (result.text) {
      roamImageRegex.lastIndex = 0;
      const imageMatches = Array.from(result.text.matchAll(roamImageRegex));

      if (imageMatches.length > 0) {
        imageMatches.forEach(match => {
          images.push(match[0]);
        });
      }

      // Extract audio files
      roamAudioRegex.lastIndex = 0;
      const audioMatches = Array.from(result.text.matchAll(roamAudioRegex));

      if (audioMatches.length > 0) {
        audioMatches.forEach(match => {
          const audioUrl = match[1] || match[0];
          audioFiles.push(audioUrl);
        });
      }

      // Extract text content (remove images and audio)
      roamImageRegex.lastIndex = 0;
      roamAudioRegex.lastIndex = 0;
      let textOnly = result.text
        .replace(roamImageRegex, '')
        .replace(roamAudioRegex, '')
        .trim();
      if (textOnly) {
        textContent.push(textOnly);
      }
    }

    // Include plain text or content fields that don't have images or audio
    if (result.plainText && !result.content && !result.text) {
      textContent.push(result.plainText);
    }
  });

  // Remove duplicates
  const uniqueImages = Array.from(new Set(images));
  const uniqueAudioFiles = Array.from(new Set(audioFiles));
  const uniqueTextContent = Array.from(new Set(textContent));

  return {
    images: uniqueImages,
    audioFiles: uniqueAudioFiles,
    textContent: uniqueTextContent
  };
}

/**
 * Build a complete prompt for image generation including:
 * - Images from resultsContext (only if chat is new/first turn)
 * - Text content from resultsContext as additional context
 * - User's text prompt (prominently)
 *
 * @param userPrompt - The user's text prompt
 * @param resultsContext - Results context from chat state
 * @param chatSessionId - Chat session ID (to check if it's first turn)
 * @param imageGenerationChats - Map of existing image generation chats
 * @returns Complete prompt with images and context
 */
export function buildImageGenerationPrompt(
  userPrompt: string,
  resultsContext: any[] | undefined,
  chatSessionId: string | undefined,
  imageGenerationChats: Map<string, any>
): string {
  // Only add context on first turn (when no existing chat session for this model)
  // On subsequent turns, the images are already in the chat history
  const isFirstTurn = !chatSessionId || (
    !imageGenerationChats.has(`${chatSessionId}_gemini-2.5-flash-image`) &&
    !imageGenerationChats.has(`${chatSessionId}_gemini-3-pro-image-preview`)
  );

  if (!isFirstTurn || !resultsContext || resultsContext.length === 0) {
    return userPrompt;
  }

  // Extract multimodal content
  const { images, textContent } = extractMultimodalContext(resultsContext);

  // If no images or text content, just return user prompt
  if (images.length === 0 && textContent.length === 0) {
    return userPrompt;
  }

  // Build prompt with better structure for image generation:
  // 1. Images (visual context)
  // 2. Optional text context (only meaningful text, filtered)
  // 3. User instruction (clearly marked as the task)

  const parts: string[] = [];

  // Add images if present
  if (images.length > 0) {
    parts.push(images.join('\n'));
  }

  // Filter and add text content (remove auto-generated attribution text)
  if (textContent.length > 0) {
    const meaningfulText = textContent.filter(text => {
      // Filter out auto-generated content
      const lowerText = text.toLowerCase();
      return !lowerText.includes('image generated by') &&
             !lowerText.includes('parent:') &&
             text.trim().length > 0;
    });

    if (meaningfulText.length > 0) {
      parts.push(meaningfulText.join('\n'));
    }
  }

  // Add user prompt as the main instruction (clearly separated)
  if (parts.length > 0) {
    parts.push(`Instruction: ${userPrompt}`);
  } else {
    // If no context was added, just return the user prompt
    return userPrompt;
  }

  return parts.join('\n\n');
}
