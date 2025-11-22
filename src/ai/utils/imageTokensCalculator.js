/**
 * Image Generation Tokens and Cost Calculator
 *
 * Handles token counting and cost calculation for image generation models,
 * particularly Gemini nano banana models with complex pricing structures
 */

/**
 * Extract usage metadata from Gemini image generation response
 *
 * Gemini nano banana models return usage in this format:
 * {
 *   candidatesTokenCount: 1259,
 *   candidatesTokensDetails: [{...}],
 *   promptTokenCount: 17,
 *   promptTokensDetails: [{...}],
 *   thoughtsTokenCount: 128,  // Only for gemini-3
 *   totalTokenCount: 1404
 * }
 *
 * @param result - The Gemini API response object
 * @returns Token usage object compatible with our system
 */
export function extractGeminiImageUsage(result) {
  if (!result || !result.usageMetadata) {
    // Fallback for models without usage metadata
    return {
      input_tokens: 0,
      output_tokens: 1, // 1 image generated
      total_tokens: 1,
      thoughts_tokens: 0,
    };
  }

  const metadata = result.usageMetadata;

  return {
    input_tokens: metadata.promptTokenCount || 0,
    output_tokens: metadata.candidatesTokenCount || 1,
    total_tokens: metadata.totalTokenCount || 0,
    thoughts_tokens: metadata.thoughtsTokenCount || 0,
  };
}

/**
 * Calculate cost for Gemini image generation
 *
 * Pricing structure:
 * - gemini-3-pro-image-preview:
 *   - Input: $2.00/1M tokens (text/image)
 *   - Input image: $0.0011 per image
 *   - Output text/thinking: $12.00/1M tokens
 *   - Output images: $0.134 per 1K/2K image, $0.24 per 4K image
 *
 * - gemini-2.5-flash-image:
 *   - Input: $0.30/1M tokens (text/image)
 *   - Output: $0.039 per image
 *
 * @param model - Model ID (gemini-3-pro-image-preview or gemini-2.5-flash-image)
 * @param usage - Token usage object from extractGeminiImageUsage
 * @param imageSize - Image size (1K, 2K, 4K) - only relevant for gemini-3-pro
 * @param hasInputImage - Whether the request included an input image
 * @returns Cost object with input and output costs in dollars
 */
export function calculateGeminiImageCost(
  model,
  usage,
  imageSize = "2K",
  hasInputImage = false
) {
  const isPro = model === "gemini-3-pro-image-preview";

  let inputCost = 0;
  let outputCost = 0;

  if (isPro) {
    // gemini-3-pro-image-preview pricing
    // Input text tokens: $2.00 per 1M tokens
    inputCost += (usage.input_tokens / 1000000) * 2.0;

    // Input image: $0.0011 per image
    if (hasInputImage) {
      inputCost += 0.0011;
    }

    // Output text/thinking tokens: $12.00 per 1M tokens
    // (candidatesTokenCount includes both text and image, but we need to subtract the image portion)
    // For simplicity, we'll count thoughts_tokens + any text output
    const textOutputTokens = usage.thoughts_tokens || 0;
    outputCost += (textOutputTokens / 1000000) * 12.0;

    // Output image cost varies by size
    if (imageSize === "4K") {
      outputCost += 0.24;
    } else {
      // 1K or 2K
      outputCost += 0.134;
    }
  } else {
    // gemini-2.5-flash-image pricing
    // Input: $0.30 per 1M tokens
    inputCost += (usage.input_tokens / 1000000) * 0.3;

    // Input image: $0.30 per image (same as text)
    if (hasInputImage) {
      inputCost += (1 / 1000000) * 0.3; // Treat as tokens or use fixed cost
    }

    // Output: $0.039 per image (fixed)
    outputCost += 0.039;
  }

  return {
    inputCost: inputCost,
    outputCost: outputCost,
    totalCost: inputCost + outputCost,
  };
}

/**
 * Format token usage for display in chat
 *
 * @param usage - Token usage object
 * @param model - Model ID
 * @returns Formatted string for display
 */
export function formatImageTokenUsage(usage, model) {
  const isPro = model === "gemini-3-pro-image-preview";

  if (isPro && usage.thoughts_tokens > 0) {
    return `${usage.input_tokens} → ${usage.output_tokens} (${usage.thoughts_tokens} thinking)`;
  }

  return `${usage.input_tokens} → ${usage.output_tokens}`;
}

/**
 * Update token counter for image generation
 *
 * This creates a usage object compatible with the existing updateTokenCounter function
 * but with proper token counts from Gemini responses
 *
 * @param model - Model ID
 * @param result - Gemini API response
 * @param imageSize - Image size for cost calculation
 * @param hasInputImage - Whether input image was provided
 * @returns Usage object for updateTokenCounter
 */
export function createImageUsageObject(
  model,
  result,
  imageSize = "2K",
  hasInputImage = false
) {
  const usage = extractGeminiImageUsage(result);
  const cost = calculateGeminiImageCost(model, usage, imageSize, hasInputImage);

  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    thoughts_tokens: usage.thoughts_tokens,
    // Add cost information for potential display
    input_cost: cost.inputCost,
    output_cost: cost.outputCost,
    total_cost: cost.totalCost,
    // Store imageSize for reference
    imageSize: imageSize,
  };
}
