import {
  openaiLibrary,
  transcriptionLanguage,
  whisperPrompt,
  resImages,
  groqLibrary,
  grokLibrary,
  GROK_API_KEY,
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
import { getModelConfig } from "../utils/modelConfigHelpers";

// Storage for active image generation chat instances (Gemini)
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

// Tunable thresholds for the Whisper silence guard (2) and hallucination filter (3).
// Loosen these (smaller silence gates, more negative logprob, higher compression)
// if real/faint notes get dropped; tighten them if hallucinations slip through.
const TRANSCRIPTION_THRESHOLDS = {
  // (2) Below BOTH of these the recording is treated as silent and not sent.
  silencePeak: 0.01, // max abs sample amplitude (0..1)
  silenceRms: 0.0015, // root-mean-square amplitude (0..1)
  // (3) A Whisper verbose_json segment is dropped as a hallucination when any holds:
  noSpeechProb: 0.6, // ...combined with logprob below noSpeechLogprob
  noSpeechLogprob: -0.5,
  lowLogprob: -1.0, // poor decode confidence on its own
  highCompression: 2.4, // abnormally repetitive text (decode loop)
};

export async function transcribeAudio(filename) {
  // Provider is auto-detected from the selected transcription model id.
  const selectedModel = (transcriptionModel || "").toLowerCase();
  if (selectedModel.includes("gemini")) {
    if (!googleLibrary) return null;
    return await transcribeAudioWithGemini(filename, transcriptionModel);
  }
  if (selectedModel.includes("grok")) {
    if (!GROK_API_KEY) return null;
    // MediaRecorder yields webm (Chrome), which xAI STT may reject; send WAV.
    const wavBlob = await audioFileToWavBlob(filename);
    return await transcribeAudioWithGrok(wavBlob);
  }
  if (!openaiLibrary && !groqLibrary) return null;
  try {
    // console.log(filename);
    // (2) Silence guard: Whisper hallucinates (or repeats prompt/phrases) when the
    // audio is essentially silent. Skip the API call entirely on near-silent input.
    const loudness = await getAudioLoudness(filename);
    if (
      loudness &&
      loudness.peak < TRANSCRIPTION_THRESHOLDS.silencePeak &&
      loudness.rms < TRANSCRIPTION_THRESHOLDS.silenceRms
    ) {
      AppToaster.show({
        message: "No speech detected in the recording (audio is silent).",
        timeout: 4000,
      });
      return "";
    }

    // whisper-1 (and Groq whisper-large-v3) treat `prompt` as conditioning text,
    // not as instructions: feeding it a task description makes it echo/repeat that
    // text on low-confidence audio (silence, short notes...). So only pass it the
    // user's vocabulary/spelling hints. The gpt-4o(-mini)-transcribe models are
    // GPT-4o based and DO follow prompt instructions, so give them the guidance
    // prompt plus any vocabulary hints.
    const isGpt4oTranscribe =
      !isUsingGroqWhisper && selectedModel.includes("transcribe");
    const options = {
      file: filename,
      model:
        isUsingGroqWhisper && groqLibrary
          ? "whisper-large-v3"
          : transcriptionModel,
      // stream: true, // doesn't work as real streaming here
      // (3) Whisper models expose per-segment confidence via verbose_json, which
      // lets us drop hallucinated segments below. gpt-4o(-mini)-transcribe only
      // supports json/text, so keep plain text for them.
      response_format: isGpt4oTranscribe ? "text" : "verbose_json",
    };
    if (isGpt4oTranscribe) {
      let prompt =
        "Provide a clear transcription with proper paragraphs based on natural speech breaks, topic changes, or speaker changes. If multiple speakers are detected, indicate speaker changes.";
      if (whisperPrompt)
        prompt += `\n\nSpecific words or proper nouns to spell correctly: ${whisperPrompt}`;
      options.prompt = prompt;
    } else if (whisperPrompt) {
      options.prompt = whisperPrompt;
    }
    if (transcriptionLanguage) options.language = transcriptionLanguage;
    const transcript =
      isUsingGroqWhisper && groqLibrary
        ? await groqLibrary.audio.transcriptions.create(options)
        : await openaiLibrary.audio.transcriptions.create(options);
    // console.log(transcript);

    // gpt-4o path: response_format "text" returns a plain string.
    if (isGpt4oTranscribe || typeof transcript === "string")
      return transcript ? transcript.trim() : "";

    // Whisper verbose_json path: filter out hallucinated segments before joining.
    return filterWhisperSegments(transcript);

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

// Transcribe a recorded audio File/Blob with a Gemini model (generateContent).
// The audio is converted to mono 16kHz WAV first, because the browser MediaRecorder
// produces audio/webm (on Chrome) which Gemini does not accept.
async function transcribeAudioWithGemini(file, model) {
  try {
    const defaultPrompt =
      "Provide a clear transcription with proper paragraphs based on natural speech breaks, topic changes, or speaker changes. If multiple speakers are detected, indicate speaker changes. If audio is longer than 90s, add mm:ss timestamp only for key moments.";
    let prompt = whisperPrompt
      ? `${defaultPrompt}\n\nSpecific words or proper nouns to spell correctly: ${whisperPrompt}`
      : defaultPrompt;
    if (transcriptionLanguage)
      prompt += `\n\nThe primary language of the audio is "${transcriptionLanguage}" (ISO 639-1 code).`;
    prompt +=
      "\n\nReturn ONLY the transcription text, without any introduction, comment or markdown code fence.";

    const wavBlob = await audioFileToWavBlob(file);
    const mimeType = "audio/wav";
    const messageParts = [{ text: prompt }];

    if (wavBlob.size > 20 * 1024 * 1024) {
      // Use the Files API for large recordings (>20MB)
      const uploadedFile = await googleLibrary.files.upload({
        file: wavBlob,
        config: { mimeType },
      });
      messageParts.push({
        fileData: {
          fileUri: uploadedFile.uri,
          mimeType: uploadedFile.mimeType,
        },
      });
    } else {
      const audioBase64 = arrayBufferToBase64(await wavBlob.arrayBuffer());
      messageParts.push({ inlineData: { mimeType, data: audioBase64 } });
    }

    const response = await googleLibrary.models.generateContent({
      model,
      contents: messageParts,
    });

    return response.text ? response.text.trim() : "";
  } catch (error) {
    console.error(error.message);
    AppToaster.show({
      message: `Google API (Gemini) transcription error: ${error.message}`,
      timeout: 15000,
    });
    return "";
  }
}

// Transcribe an audio File/Blob with Grok (xAI) via the dedicated /v1/stt endpoint.
// Expects a Grok-compatible format (wav, mp3, ogg, flac, m4a…); callers handling
// raw MediaRecorder output should convert to WAV first.
async function transcribeAudioWithGrok(file) {
  try {
    const formData = new FormData();
    // `format=true` enables inverse text normalization but requires a language.
    if (transcriptionLanguage) {
      formData.append("format", "true");
      formData.append("language", transcriptionLanguage);
    }
    // Bias transcription toward user-provided vocabulary/proper nouns (max 100 terms,
    // 50 chars each). The field is repeated once per term.
    if (whisperPrompt) {
      whisperPrompt
        .split(/[,\n]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 100)
        .forEach((term) => formData.append("keyterm", term.slice(0, 50)));
    }
    // The `file` field MUST be appended last (xAI multipart requirement).
    formData.append("file", file, file.name || "audio.wav");

    const response = await fetch("https://api.x.ai/v1/stt", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROK_API_KEY}` },
      body: formData,
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`${response.status} ${errText}`.trim());
    }
    const result = await response.json();
    return result?.text ? result.text.trim() : "";
  } catch (error) {
    console.error(error.message);
    AppToaster.show({
      message: `xAI (Grok) transcription error: ${error.message}`,
      timeout: 15000,
    });
    return "";
  }
}

// Convert any audio File/Blob the browser can decode into a mono 16kHz 16-bit
// PCM WAV Blob (a format Gemini accepts, unlike the webm/opus MediaRecorder output).
// (2) Measure peak amplitude and RMS of the decoded audio (samples are -1..1),
// so the caller can skip transcription of essentially-silent recordings, which
// are what make Whisper hallucinate. Returns null if decoding fails (then we just
// proceed with the API call rather than dropping a possibly-valid recording).
async function getAudioLoudness(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    let decoded;
    try {
      decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      if (audioCtx.close) audioCtx.close();
    }
    let peak = 0;
    let sumSquares = 0;
    let count = 0;
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
        sumSquares += data[i] * data[i];
      }
      count += data.length;
    }
    const rms = count ? Math.sqrt(sumSquares / count) : 0;
    return { peak, rms };
  } catch (e) {
    console.error("getAudioLoudness failed:", e.message);
    return null;
  }
}

// (3) Whisper verbose_json returns per-segment confidence. Drop segments that are
// almost certainly hallucinations, then join the rest. Heuristics (the same ones
// Whisper uses internally for its temperature-fallback decisions):
//  - high no_speech_prob + low avg_logprob  -> model thinks it's NOT speech
//  - very low avg_logprob                   -> decode confidence is poor
//  - high compression_ratio                 -> abnormally repetitive (loop)
function filterWhisperSegments(transcript) {
  if (!transcript) return "";
  const segments = transcript.segments;
  if (!Array.isArray(segments)) return (transcript.text || "").trim();
  const t = TRANSCRIPTION_THRESHOLDS;
  const kept = segments.filter((seg) => {
    const noSpeech = seg.no_speech_prob ?? 0;
    const logprob = seg.avg_logprob ?? 0;
    const compression = seg.compression_ratio ?? 0;
    const isHallucination =
      (noSpeech > t.noSpeechProb && logprob < t.noSpeechLogprob) ||
      logprob < t.lowLogprob ||
      compression > t.highCompression;
    return !isHallucination;
  });
  const result = kept
    .map((s) => s.text)
    .join("")
    .trim();
  // Warn when there was audio but every segment was discarded as non-speech /
  // hallucination — the user gets nothing back and should know why.
  if (!result && segments.length) {
    AppToaster.show({
      message:
        "No transcribable speech detected (the audio seems to be silence or noise).",
      timeout: 4000,
    });
  }
  return result;
}

async function audioFileToWavBlob(file, targetSampleRate = 16000) {
  const arrayBuffer = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  let decoded;
  try {
    decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    if (audioCtx.close) audioCtx.close();
  }

  // Downmix to mono and resample to targetSampleRate via OfflineAudioContext.
  const frameCount = Math.max(
    1,
    Math.round(decoded.duration * targetSampleRate),
  );
  const offline = new OfflineAudioContext(1, frameCount, targetSampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();

  return encodeWavBlob(rendered);
}

// Encode an AudioBuffer's first channel as a 16-bit PCM WAV Blob.
function encodeWavBlob(audioBuffer) {
  const samples = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++)
      view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * blockAlign)
  view.setUint16(32, 2, true); // block align (channels * bytesPerSample)
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([view], { type: "audio/wav" });
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
 * Parse OpenAI image generation parameters from user prompt
 * Extracts: size (portrait/landscape/square), quality (low/medium/high),
 * format (png/webp/jpeg), compression (0-100), background (transparent/opaque)
 */
function parseOpenAIImageParams(prompt) {
  const config = {};
  let cleanedPrompt = prompt;

  // Extract size: portrait, landscape, square
  const sizeRegex = /\b(portrait|landscape|square)\b/i;
  const sizeMatch = prompt.match(sizeRegex);
  if (sizeMatch) {
    config.size = sizeMatch[1].toLowerCase();
    cleanedPrompt = cleanedPrompt.replace(sizeMatch[0], "").trim();
  }

  // Extract quality: low, medium, high
  const qualityRegex = /\bquality[:\s]*(low|medium|high)\b/i;
  const qualityMatch = prompt.match(qualityRegex);
  if (qualityMatch) {
    config.quality = qualityMatch[1].toLowerCase();
    cleanedPrompt = cleanedPrompt.replace(qualityMatch[0], "").trim();
  }

  // Extract format: png, webp, jpeg
  const formatRegex = /\bformat[:\s]*(png|webp|jpeg|jpg)\b/i;
  const formatMatch = prompt.match(formatRegex);
  if (formatMatch) {
    config.format =
      formatMatch[1].toLowerCase() === "jpg"
        ? "jpeg"
        : formatMatch[1].toLowerCase();
    cleanedPrompt = cleanedPrompt.replace(formatMatch[0], "").trim();
  }

  // Extract compression: 0-100 (for jpeg/webp)
  const compressionRegex = /\bcompression[:\s]*(\d{1,3})%?\b/i;
  const compressionMatch = prompt.match(compressionRegex);
  if (compressionMatch) {
    const compressionValue = parseInt(compressionMatch[1], 10);
    if (compressionValue >= 0 && compressionValue <= 100) {
      config.compression = compressionValue;
    }
    cleanedPrompt = cleanedPrompt.replace(compressionMatch[0], "").trim();
  }

  // Extract background: transparent, opaque
  const backgroundRegex =
    /\b(transparent|opaque)\s*background\b|\bbackground[:\s]*(transparent|opaque)\b/i;
  const backgroundMatch = prompt.match(backgroundRegex);
  if (backgroundMatch) {
    config.background = (
      backgroundMatch[1] || backgroundMatch[2]
    ).toLowerCase();
    cleanedPrompt = cleanedPrompt.replace(backgroundMatch[0], "").trim();
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
  conversationUid = null, // Optional: parent block UID for chat-based editing
) {
  // Use default image model if no model specified
  if (!model) {
    // Check for custom defaultImageModel in config first
    const modelConfig = getModelConfig();
    model = modelConfig?.defaultImageModel || defaultImageModel;
  }

  // Check if selected model requires Google API and fallback if not available
  const requiresGoogle =
    model === "gemini-2.5-flash-image" ||
    model === "gemini-3.1-flash-image-preview" ||
    model === "gemini-3.1-flash-lite-image" ||
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

  // Normalize prompt to string if it's an array or object
  // This handles cases where prompt comes from chat message format
  if (Array.isArray(prompt)) {
    // Extract text content from array of message parts
    prompt = prompt
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object") {
          // Handle message content objects like {type: "text", text: "..."} or {content: "..."}
          return p.text || p.content || "";
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  } else if (prompt && typeof prompt === "object") {
    // Handle single message object
    prompt = prompt.text || prompt.content || String(prompt);
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
    model !== "gemini-3.1-flash-image-preview" &&
    model !== "gemini-3.1-flash-lite-image" &&
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
    model === "gemini-3.1-flash-image-preview" ||
    model === "gemini-3.1-flash-lite-image" ||
    model === "gemini-3-pro-image-preview";

  const isNanoBananaPro = model === "gemini-3-pro-image-preview";

  const isGrokImagine = model === "grok-imagine-image";

  // Check required libraries
  if (isGoogleImagen && !googleLibrary) {
    AppToaster.show({
      message: `Google API Key is needed for Gemini/Imagen image generation`,
      timeout: 10000,
    });
    return;
  }

  if (isGrokImagine && !grokLibrary) {
    AppToaster.show({
      message: `Grok API Key is needed for Grok Imagine image generation`,
      timeout: 10000,
    });
    return;
  }

  if (!isGoogleImagen && !isGrokImagine && !openaiLibrary) {
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
        prompt.matchAll(roamImageRegex),
      );

      // For nano banana, support image editing (single or multiple images)
      if (isNanoBanana && matchingImagesInPrompt.length) {
        // Remove image markdown from prompt
        let textPrompt = prompt;
        for (const match of matchingImagesInPrompt) {
          textPrompt = textPrompt.replace(
            match[0],
            match[1] ? `[${match[1]}]` : "",
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
              "Invalid response structure: missing content.parts",
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
                true, // hasInputImage
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
                "Invalid response structure: missing content.parts",
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
                  false, // no input image
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

    // Grok Imagine image generation
    if (isGrokImagine) {
      // Check if there are images in the prompt (for editing)
      roamImageRegex.lastIndex = 0;
      const matchingImagesInPrompt = Array.from(
        prompt.matchAll(roamImageRegex),
      );

      if (matchingImagesInPrompt.length) {
        // Image editing mode
        // xAI API requires application/json for image edits (not multipart/form-data),
        // so we use a direct HTTP request instead of the OpenAI SDK's images.edit()
        let textPrompt = prompt;
        for (const match of matchingImagesInPrompt) {
          textPrompt = textPrompt.replace(
            match[0],
            match[1] ? `[${match[1]}]` : "",
          );
        }

        // Fetch the first image and convert to base64 data URI
        // (Roam Firebase URLs may be private, so base64 is more reliable than passing the URL)
        const imageUrl = matchingImagesInPrompt[0][2];
        const imageBlob = await roamAlphaAPI.file.get({ url: imageUrl });
        const mimeType = imageBlob.type || "image/jpeg";
        const imageArrayBuffer = await imageBlob.arrayBuffer();
        const imageBase64 = arrayBufferToBase64(imageArrayBuffer);
        const dataUri = `data:${mimeType};base64,${imageBase64}`;

        // Direct HTTP request to xAI image edit endpoint (JSON format)
        const editResponse = await fetch("https://api.x.ai/v1/images/edits", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${GROK_API_KEY}`,
          },
          body: JSON.stringify({
            model: "grok-imagine-image",
            prompt: textPrompt.trim(),
            image: {
              url: dataUri,
              type: "image_url",
            },
            response_format: "b64_json",
          }),
        });

        if (!editResponse.ok) {
          const errorBody = await editResponse.text();
          throw new Error(
            `Grok image edit failed (${editResponse.status}): ${errorBody}`,
          );
        }

        result = await editResponse.json();
      } else {
        // Generation mode
        result = await grokLibrary.images.generate({
          model: "grok-imagine-image",
          prompt: prompt,
          response_format: "b64_json",
          n: 1,
        });
      }

      // Process result
      if (result && result.data && result.data[0]) {
        let firebaseUrl;

        if (result.data[0].b64_json) {
          // Handle base64 response (from generate)
          const image_base64 = result.data[0].b64_json;
          const byteCharacters = atob(image_base64);
          const byteNumbers = Array.from(byteCharacters).map((c) =>
            c.charCodeAt(0),
          );
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: "image/png" });
          firebaseUrl = await roamAlphaAPI.file.upload({
            file: blob,
          });
        } else if (result.data[0].url) {
          // Handle URL response (from edit) - fetch and upload to Firebase
          const imageResponse = await fetch(result.data[0].url);
          const blob = await imageResponse.blob();
          firebaseUrl = await roamAlphaAPI.file.upload({
            file: blob,
          });
        } else {
          throw new Error("No image data in Grok Imagine response");
        }

        // Update token counter (Grok Imagine pricing TBD)
        const usage = createImageUsageObject(model, 0, 0, 1);
        if (tokensCallback) {
          tokensCallback(usage);
        }
        updateTokenCounter(model, usage);

        return formatImageWithAttribution(firebaseUrl, model);
      } else {
        throw new Error("No image generated from Grok Imagine");
      }
    }

    // Parse image generation options from prompt
    // Supported: size (portrait/landscape/square), quality (low/medium/high),
    // format (png/webp/jpeg), compression (0-100), background (transparent/opaque)
    const { prompt: cleanedPrompt, config: imageConfig } =
      parseOpenAIImageParams(prompt);

    // Map quality parameter to OpenAI format
    let openaiQuality = quality;
    if (imageConfig.quality) {
      openaiQuality = imageConfig.quality;
    }

    // Map size parameter
    let size = "auto";
    if (imageConfig.size === "portrait") {
      size = "1024x1536";
    } else if (imageConfig.size === "landscape") {
      size = "1536x1024";
    } else if (imageConfig.size === "square") {
      size = "1024x1024";
    }

    // Build base options
    const options = {
      model,
      prompt: cleanedPrompt,
      quality: openaiQuality,
      size,
      background: imageConfig.background || "auto",
      moderation: "low",
    };

    // Add output format options if specified
    if (imageConfig.format) {
      options.output_format = imageConfig.format;
    }
    if (imageConfig.compression !== undefined) {
      options.output_compression = imageConfig.compression;
    }

    // Check if there are images in the prompt (for editing)
    roamImageRegex.lastIndex = 0;
    const matchingImagesInPrompt = Array.from(
      cleanedPrompt.matchAll(roamImageRegex),
    );

    let mode = "generate";

    if (matchingImagesInPrompt.length) {
      mode = "edit";
      const imageURLs = [];
      let maskIndex = null;
      let textPrompt = cleanedPrompt;

      for (let i = 0; i < matchingImagesInPrompt.length; i++) {
        imageURLs.push(matchingImagesInPrompt[i][2]);
        if (matchingImagesInPrompt[i][1] === "mask") maskIndex = i;
        textPrompt = textPrompt.replace(
          matchingImagesInPrompt[i][0],
          matchingImagesInPrompt[i][1]
            ? i === maskIndex
              ? `Image n°${i} is the mask`
              : `Title of image n°${i + 1}: ${matchingImagesInPrompt[i][1]}`
            : "",
        );
      }

      // Update prompt without image markdown
      options.prompt = textPrompt.trim();

      // Fetch images from URLs
      const images = await Promise.all(
        imageURLs.map(async (url) => await roamAlphaAPI.file.get({ url })),
      );

      if (maskIndex !== null) {
        options.mask = images[maskIndex];
        options.image = images[maskIndex === 0 ? 1 : 0];
      } else {
        options.image = images;
      }

      // Add input_fidelity for editing
      if (model === "gpt-image-1.5") options.input_fidelity = "high";
    }

    console.log("OpenAI Images API options :>> ", options);

    // Call appropriate API endpoint
    if (mode === "generate") {
      result = await openaiLibrary.images.generate(options);
    } else {
      result = await openaiLibrary.images.edit(options);
    }

    console.log("OpenAI Images API result :>> ", result);

    // Handle usage tracking
    if (result.usage) {
      const usage = {
        input_tokens: {},
        output_tokens: 0,
      };
      usage["input_tokens"] = result.usage["input_tokens_details"];
      usage["output_tokens"] = result.usage["output_tokens"];
      if (tokensCallback) {
        tokensCallback({
          input_tokens: result.usage["input_tokens"],
          output_tokens: usage["output_tokens"],
        });
      }
      updateTokenCounter(model, usage);
    }

    // Decode base64 image and upload to Firebase
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
  isAnthropicModel,
  useResponseApi = false,
) => {
  let nbCountdown = maxImagesNb;

  for (let i = 1; i < messages.length; i++) {
    roamImageRegex.lastIndex = 0;
    const matchingImagesInPrompt = Array.from(
      messages[i].content?.matchAll(roamImageRegex),
    );
    if (matchingImagesInPrompt.length) {
      messages[i].content = [
        {
          type: useResponseApi ? "input_text" : "text",
          text: messages[i].content,
        },
      ];
    }
    for (let j = 0; j < matchingImagesInPrompt.length; j++) {
      messages[i].content[0].text = messages[i].content[0].text
        .replace(matchingImagesInPrompt[j][0], `[Image ${i + 1}]`)
        .trim();
      if (nbCountdown > 0) {
        if (isAnthropicModel) {
          messages[i].content.push({
            type: "image",
            source: {
              type: "url",
              url: matchingImagesInPrompt[j][2],
            },
          });
        } else if (useResponseApi) {
          // OpenAI Response API format
          messages[i].content.push({
            type: "input_image",
            image_url: matchingImagesInPrompt[j][2],
          });
        } else {
          // Legacy OpenAI Chat API format
          messages[i].content.push({
            type: "image_url",
            image_url: {
              url: matchingImagesInPrompt[j][2],
              detail: resImages,
            },
          });
        }
      }
      nbCountdown--;
    }
  }

  if (content && content.length) {
    roamImageRegex.lastIndex = 0;
    const matchingImagesInContext = Array.from(
      content.matchAll(roamImageRegex),
    );
    for (let i = 0; i < matchingImagesInContext.length; i++) {
      if (nbCountdown > 0) {
        if (i === 0)
          messages.splice(1, 0, {
            role: "user",
            content: [
              {
                type: useResponseApi ? "input_text" : "text",
                text: "Image(s) provided in the context:",
              },
            ],
          });
        if (isAnthropicModel) {
          messages[1].content.push({
            type: "image",
            source: {
              type: "url",
              url: matchingImagesInContext[i][2],
            },
          });
        } else if (useResponseApi) {
          // OpenAI Response API format
          messages[1].content.push({
            type: "input_image",
            image_url: matchingImagesInContext[i][2],
          });
        } else {
          // Legacy OpenAI Chat API format
          messages[1].content.push({
            type: "image_url",
            image_url: {
              url: matchingImagesInContext[i][2],
              detail: resImages,
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
      (m) => m.id.toLowerCase() === modelLower,
    );
    if (ormodel) return ormodel.imagePricing ? true : false;
  }

  return false;
};

export const addPdfUrlToMessages = async (
  messages,
  content,
  provider,
  useResponseApi = false,
) => {
  // Determine if we should use Response API format
  const isResponseApi = provider === "OpenAI" && useResponseApi;

  for (let i = 1; i < messages.length; i++) {
    pdfLinkRegex.lastIndex = 0;
    const matchingPdfInPrompt = Array.from(
      (typeof messages[i].content === "string"
        ? messages[i].content?.matchAll(pdfLinkRegex)
        : []) || [],
    );

    if (matchingPdfInPrompt.length) {
      messages[i].content = [
        {
          type: isResponseApi ? "input_text" : "text",
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
        provider,
        useResponseApi,
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
              type: isResponseApi ? "input_text" : "text",
              text: "Pdf(s) provided in the context:",
            },
          ],
        });
      const pdfRole = await getFormatedPdfRole(
        matchingPdfInContext[i][1],
        matchingPdfInContext[i][2],
        provider,
        useResponseApi,
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
              2,
            )}MB. Using Files API.`,
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
    content.matchAll(youtubeRegexGlobal),
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
        `Error processing standalone YouTube URL: ${error.message}`,
      );
    }
  }

  return messageParts;
};

// Transcribe audio from block content using either Gemini or OpenAI
export const transcribeAudioFromBlock = async (
  blockContent,
  userPrompt = "",
  model = "",
) => {
  try {
    // Provider auto-detected from the model id.
    const useGemini = model.toLowerCase().includes("gemini");
    const useGrok = model.toLowerCase().includes("grok");

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
        "Provide a clear transcription with proper paragraphs based on natural speech breaks, topic changes, or speaker changes. If multiple speakers are detected, indicate speaker changes (try to name them properly or follow the user indication if provided). Give timestamps for the key moments. If audio is longuer than 90s, add mm:ss timestamp for key moments.";
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
    } else if (useGrok && GROK_API_KEY) {
      // Use Grok (xAI) STT. The block audio is typically mp3/wav, which the
      // /v1/stt endpoint accepts directly (no conversion needed).
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
      const mimeType = audioBlob.type || getAudioMimeType(audioUrl);
      const extension =
        audioUrl.split(".").pop().toLowerCase().split("?")[0] || "mp3";
      const audioFile = new File([audioBlob], `audio.${extension}`, {
        type: mimeType,
      });
      return await transcribeAudioWithGrok(audioFile);
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
          `Audio is ${(audioSize / 1024 / 1024).toFixed(2)}MB. Using Files API.`,
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
