import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { Tiktoken } from "js-tiktoken/lite"; // too big in bundle (almost 3 Mb)
import axios from "axios";

import {
  ANTHROPIC_API_KEY,
  assistantCharacter,
  chatRoles,
  contextInstruction,
  defaultTemplate,
  getInstantAssistantRole,
  openAiCustomModels,
  defaultModel,
  openaiLibrary,
  transcriptionLanguage,
  userContextInstructions,
  whisperPrompt,
  streamResponse,
  openrouterLibrary,
  openRouterModels,
  ollamaModels,
  openRouterModelsInfo,
  maxImagesNb,
  modelTemperature,
  ollamaServer,
  resImages,
  anthropicLibrary,
  isSafari,
  groqLibrary,
  isUsingGroqWhisper,
  groqModels,
} from "..";
import {
  convertTreeToLinearArray,
  copyTreeBranches,
  createSiblingBlock,
  getConversationArray,
  getFlattenedContentFromArrayOfBlocks,
  getParentBlock,
  getPreviousSiblingBlock,
  getTreeByUid,
  insertBlockInCurrentView,
  isExistingBlock,
  roamImageRegex,
  uidRegex,
  updateArrayOfBlocks,
  updateTokenCounter,
} from "../utils/utils";
import {
  hierarchicalResponseFormat,
  instructionsOnJSONResponse,
  instructionsOnTemplateProcessing,
} from "./prompts";
import { AppToaster } from "../components/VoiceRecorder";
import {
  displaySpinner,
  highlightHtmlElt,
  insertInstantButtons,
  insertParagraphForStream,
  removeSpinner,
} from "../utils/domElts";
import { isCanceledStreamGlobal } from "../components/InstantButtons";
import {
  insertStructuredAIResponse,
  sanitizeJSONstring,
  trimOutsideOuterBraces,
} from "../utils/format";
import ModelsMenu from "../components/ModelsMenu";
import { normalizeClaudeModel, tokensLimit } from "./modelsInfo";

export const lastCompletion = {
  prompt: null,
  targetUid: null,
  context: null,
  typeOfCompletion: null,
};

const getTokenizer = async () => {
  try {
    const { data } = await axios.get(
      "https://tiktoken.pages.dev/js/cl100k_base.json"
    );
    return new Tiktoken(data);
  } catch (error) {
    console.log("Fetching tiktoken rank error:>> ", error);
    return null;
  }
};
export let tokenizer = await getTokenizer();

export function initializeOpenAIAPI(API_KEY, baseURL) {
  try {
    const clientSetting = {
      apiKey: API_KEY,
      dangerouslyAllowBrowser: true,
    };
    if (baseURL) {
      clientSetting.baseURL = baseURL;
      if (baseURL === "https://openrouter.ai/api/v1")
        clientSetting.defaultHeaders = {
          "HTTP-Referer":
            "https://github.com/fbgallet/roam-extension-speech-to-roam", // Optional, for including your app on openrouter.ai rankings.
          "X-Title": "Live AI Assistant for Roam Research", // Optional. Shows in rankings on openrouter.ai.
        };
    }
    const openai = new OpenAI(clientSetting);
    return openai;
  } catch (error) {
    console.log(error.message);
    AppToaster.show({
      message: `Live AI Assistant - Error during the initialization of OpenAI API: ${error.message}`,
    });
  }
}

export function initializeAnthropicAPI(ANTHROPIC_API_KEY) {
  try {
    const anthropic = new Anthropic({
      apiKey: ANTHROPIC_API_KEY, // defaults to process.env["ANTHROPIC_API_KEY"]
      // "anthropic-dangerous-direct-browser-access": true,
    });
    return anthropic;
  } catch (error) {
    console.log("Error at initialization stage");
    console.log(error.message);
    AppToaster.show({
      message: `Live AI Assistant - Error during the initialization of Anthropic API: ${error.message}`,
    });
  }
}

export async function transcribeAudio(filename) {
  if (!openaiLibrary && !groqLibrary) return null;
  try {
    // console.log(filename);
    const options = {
      file: filename,
      model:
        isUsingGroqWhisper && groqLibrary ? "whisper-large-v3" : "whisper-1",
    };
    if (transcriptionLanguage) options.language = transcriptionLanguage;
    if (whisperPrompt) options.prompt = whisperPrompt;
    const transcript =
      isUsingGroqWhisper && groqLibrary
        ? await groqLibrary.audio.transcriptions.create(options)
        : await openaiLibrary.audio.transcriptions.create(options);
    console.log(transcript);
    return transcript.text;
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

export function modelAccordingToProvider(model) {
  const llm = {
    provider: "",
    prefix: "",
    id: "",
    library: undefined,
  };
  model = model.toLowerCase();
  console.log("model :>> ", model);
  let prefix = model.split("/")[0];
  if (model.includes("openrouter")) {
    llm.provider = "openRouter";
    llm.prefix = "openRouter/";
    llm.id =
      prefix === "openrouter"
        ? model.replace("openrouter/", "")
        : openRouterModels.length
        ? openRouterModels[0]
        : undefined;
    llm.library = openrouterLibrary;
  } else if (model.includes("ollama")) {
    llm.provider = "ollama";
    llm.prefix = "ollama/";
    llm.id =
      prefix === "ollama"
        ? model.replace("ollama/", "")
        : ollamaModels.length
        ? ollamaModels[0]
        : undefined;
  } else if (model.includes("groq")) {
    llm.provider = "groq";
    llm.prefix = "groq/";
    llm.id =
      llm.prefix === "groq"
        ? model.replace("groq/", "")
        : groqModels.length
        ? groqModels[0]
        : undefined;
    llm.library = groqLibrary;
  } else if (model.slice(0, 6) === "claude") {
    llm.provider = "Anthropic";
    llm.id = normalizeClaudeModel(model);
    llm.library = anthropicLibrary;
  } else {
    llm.provider = "OpenAI";
    llm.id = model;
    llm.library = openaiLibrary;
  }
  if (!llm.id) {
    AppToaster.show({
      message: `No model available in the settings for the current provider: ${llm.provider}.`,
      timeout: 15000,
    });
    return null;
  }
  if (!llm.library.apiKey) {
    AppToaster.show({
      message: `Provide an API key to use ${llm.model} model. See doc and settings.`,
      timeout: 15000,
    });
    return null;
  }
  return llm;
}

async function aiCompletion(
  instantModel,
  prompt,
  content = "",
  responseFormat,
  targetUid,
  isInConversation
) {
  let aiResponse;
  let hasAPIkey = true;
  let model = instantModel || defaultModel;

  const llm = modelAccordingToProvider(model);
  if (!llm) return "";

  if (
    responseFormat === "json_object" &&
    !prompt[0].content.includes(instructionsOnJSONResponse)
  ) {
    prompt[0].content += "\n\nResponse format:\n" + instructionsOnJSONResponse;
  }

  console.log(
    "Initial instructions and context (eventually truncated):\n",
    content
  );

  if (
    llm.provider === "OpenAI" ||
    llm.provider === "openRouter" ||
    llm.provider === "groq"
  ) {
    aiResponse = await openaiCompletion(
      llm.library,
      llm.id,
      prompt,
      content,
      responseFormat,
      targetUid
    );
  } else if (llm.provider === "ollama") {
    aiResponse = await ollamaCompletion(
      llm.id,
      prompt,
      content,
      responseFormat,
      targetUid
    );
  } else {
    aiResponse = await claudeCompletion(
      llm.id,
      prompt,
      content,
      responseFormat,
      targetUid
    );
  }

  if (responseFormat === "json_object") {
    let parsedResponse = JSON.parse(aiResponse);
    if (typeof parsedResponse.response === "string")
      parsedResponse.response = JSON.parse(parsedResponse.response);
    aiResponse = parsedResponse.response;
  }
  if (aiResponse)
    insertInstantButtons({
      model: llm.prefix + llm.id,
      prompt,
      content,
      responseFormat,
      targetUid,
      isStreamStopped: true,
      response:
        responseFormat === "text"
          ? aiResponse
          : getFlattenedContentFromArrayOfBlocks(aiResponse),
    });
  return aiResponse;
}

async function claudeCompletion(
  model,
  prompt,
  content,
  responseFormat,
  targetUid
) {
  if (ANTHROPIC_API_KEY) {
    model = normalizeClaudeModel(model);
    try {
      let messages = [
        {
          role: "user",
          content: content,
        },
      ].concat(prompt);
      const options = {
        max_tokens:
          model.includes("3-5") || model.includes("3.5") ? 8192 : 4096,
        model: model,
        messages,
      };
      const usage = {
        input_tokens: 0,
        output_tokens: 0,
      };
      // if (content) options.system = content;
      if (modelTemperature !== null) options.temperature = modelTemperature;
      if (streamResponse && responseFormat === "text") options.stream = true;

      // No data is stored on the server or displayed in any log
      // const { data } = await axios.post(
      //   "https://site--ai-api-back--2bhrm4wg9nqn.code.run/anthropic/message",
      //   options
      // );
      // See server code here: https://github.com/fbgallet/ai-api-back

      console.log("Messages sent as prompt to the model:", messages);

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(options),
      });

      // handle streamed responses (not working from client-side)
      let respStr = "";

      if (streamResponse && responseFormat === "text") {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let streamEltCopy = "";
        if (true) {
          insertInstantButtons({
            model,
            prompt,
            content,
            responseFormat,
            targetUid,
            isStreamStopped: false,
          });
          const streamElt = insertParagraphForStream(targetUid);

          try {
            while (true) {
              if (isCanceledStreamGlobal) {
                streamElt.innerHTML += "(⚠️ stream interrupted by user)";
                respStr = "";
                break;
              }
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value);
              const lines = chunk.split("\n");

              for (const line of lines) {
                if (line.startsWith("data:")) {
                  const data = JSON.parse(line.slice(5));
                  // console.log("data :>> ", data);
                  if (data.type === "content_block_delta") {
                    const text = data.delta.text;
                    respStr += text;
                    streamElt.innerHTML += text;
                  } else if (data.type === "message_start") {
                    usage["input_tokens"] =
                      data.message?.usage["input_tokens"] || 0;
                  } else if (data.type === "message_delta" && data.usage) {
                    usage["output_tokens"] = data.usage["output_tokens"] || 0;
                  }
                }
              }
            }
          } catch (e) {
            console.log("Error during stream response: ", e);
            return "";
          } finally {
            streamEltCopy = streamElt.innerHTML;
            if (isCanceledStreamGlobal)
              console.log("Anthropic API response stream interrupted.");
            else streamElt.remove();
          }
        }
      } else {
        const data = await response.json();
        respStr = data.content[0].text;
        if (data.usage) {
          usage["input_tokens"] = data.usage["input_tokens"];
          usage["output_tokens"] = data.usage["output_tokens"];
        }
      }
      let jsonOnly;
      if (responseFormat !== "text") {
        console.log("respStr :>> ", respStr);
        jsonOnly = trimOutsideOuterBraces(respStr);
        jsonOnly = sanitizeJSONstring(jsonOnly);
      }

      console.log(`Tokens usage (${model}):>> `, usage);
      updateTokenCounter(model, usage);

      return jsonOnly || respStr;
    } catch (error) {
      console.log("error :>> ");
      console.log(error);
      let errorMsg = error.response?.data?.message;
      if (errorMsg && errorMsg.includes("{")) {
        let errorData;
        errorData = trimOutsideOuterBraces(error.response.data.message);
        errorData = JSON.parse(errorData);
        console.log("Claude API error type:", errorData.error?.type);
        console.log("Claude API error message:\n", errorData.error?.message);
        errorMsg = errorData.error?.message;
      }
      if (errorMsg) {
        AppToaster.show({
          message: (
            <>
              <h4>Claude API error</h4>
              <p>Message: {errorMsg}</p>
            </>
          ),
          timeout: 15000,
        });
      }
      return "see error message";
    }
  }
}

export async function openaiCompletion(
  aiClient,
  model,
  prompt,
  content,
  responseFormat = "text",
  targetUid
) {
  let respStr = "";
  let usage = {};
  let messages = [
    {
      role: model.startsWith("o1") ? "user" : "system",
      content: content,
    },
  ].concat(prompt);

  console.log("Messages sent as prompt to the model:", messages);

  if (isModelSupportingImage(model)) {
    messages = addImagesUrlToMessages(messages, content);
  }
  const isToStream = model.startsWith("o1")
    ? false
    : streamResponse && responseFormat === "text";
  try {
    let response;
    const options = {
      model: model,
      response_format: { type: responseFormat },
      messages: messages,
      stream: isToStream,
    };
    isToStream && (options["stream_options"] = { include_usage: true });
    if (modelTemperature !== null) options.temperature = modelTemperature * 2.0;
    // maximum temperature with OpenAI models regularly produces aberrations.
    if (
      options.temperature > 1.2 &&
      (model.includes("gpt") || model.includes("o1"))
    )
      options.temperature = 1.3;

    if (!isSafari) {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              "Timeout error on client side: OpenAI response time exceeded (90 seconds)"
            )
          );
        }, 90000);
      });
      response = await Promise.race([
        await aiClient.chat.completions.create(options),
        timeoutPromise,
      ]);
    } else {
      response = await aiClient.chat.completions.create(options);
    }
    let streamEltCopy = "";

    console.log("OpenAI response :>>", response);

    if (isToStream) {
      insertInstantButtons({
        model,
        prompt,
        content,
        responseFormat,
        targetUid,
        isStreamStopped: false,
      });
      const streamElt = insertParagraphForStream(targetUid);

      try {
        for await (const chunk of response) {
          if (isCanceledStreamGlobal) {
            streamElt.innerHTML += "(⚠️ stream interrupted by user)";
            // respStr = "";
            break;
          }
          respStr += chunk.choices[0]?.delta?.content || "";
          streamElt.innerHTML += chunk.choices[0]?.delta?.content || "";
          if (chunk.usage) usage = chunk.usage;
        }
      } catch (e) {
        console.log("Error during OpenAI stream response: ", e);
        console.log(respStr);
        return "";
      } finally {
        streamEltCopy = streamElt.innerHTML;
        if (isCanceledStreamGlobal)
          console.log("GPT response stream interrupted.");
        else streamElt.remove();
      }
    } else usage = response.usage;
    console.log(`Tokens usage (${model}):>> `, usage);
    updateTokenCounter(model, {
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
    });
    return isToStream ? respStr : response.choices[0].message.content;
  } catch (error) {
    console.error(error);
    AppToaster.show({
      message: `OpenAI error msg: ${error.message}`,
      timeout: 15000,
    });
    return respStr;
  }
}

export async function ollamaCompletion(
  model,
  prompt,
  content,
  responseFormat = "text",
  targetUid
) {
  let respStr = "";
  try {
    const options = {
      num_ctx: 8192,
    };
    if (modelTemperature !== null) options.temperature = modelTemperature;
    // need to allow * CORS origin
    // command MacOS terminal: launchctl setenv OLLAMA_ORIGINS "*"
    // then, close terminal and relaunch ollama serve
    const response = await axios.post(
      `${ollamaServer ? ollamaServer : "http://localhost:11434"}/api/chat`,
      {
        model: model,
        messages: [
          {
            role: "system",
            content: content,
          },
        ].concat(prompt),
        options: options,
        format: responseFormat.includes("json") ? "json" : null,
        stream: false,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Ollama chat completion response :>>", response);
    let text = response.data.message.content;
    let jsonOnly;
    if (responseFormat !== "text") {
      jsonOnly = trimOutsideOuterBraces(text);
      jsonOnly = sanitizeJSONstring(jsonOnly);
    }
    return jsonOnly || text;
  } catch (error) {
    console.error(error);
    const msg =
      error.message === "Network Error"
        ? "Unable to establish connection with Ollama server. Have you assigned " +
          "'https://roamresearch.com' to the OLLAMA_ORIGINS environment variable and executed 'ollama serve' in the terminal?" +
          " See documentation for detailled instructions."
        : error.message;
    AppToaster.show({
      message: `Error msg: ${msg}`,
      timeout: 15000,
    });
    return "";
  }
}

export const insertCompletion = async ({
  prompt,
  targetUid,
  context,
  typeOfCompletion,
  instantModel,
  isRedone,
  isInConversation,
}) => {
  lastCompletion.prompt = prompt;
  lastCompletion.targetUid = targetUid;
  lastCompletion.context = context;
  lastCompletion.typeOfCompletion = typeOfCompletion;
  lastCompletion.instantModel = instantModel;

  // console.log("prompt in insertCompletion :>> ", prompt);

  let model = instantModel || defaultModel;
  if (model === "first OpenRouter model") {
    model = openRouterModels.length
      ? "openRouter/" + openRouterModels[0]
      : "gpt-4o-mini";
  } else if (model === "first Ollama local model") {
    model = ollamaModels.length ? "ollama/" + ollamaModels[0] : "gpt-4o-mini";
  }
  const responseFormat =
    typeOfCompletion === "gptPostProcessing" ? "json_object" : "text";
  const assistantRole = instantModel
    ? getInstantAssistantRole(instantModel)
    : chatRoles.assistant;

  let content;

  let isContextInstructionToInsert = false;
  uidRegex.lastIndex = 0;
  if (uidRegex.test(context)) isContextInstructionToInsert = true;

  if (isRedone || isInConversation) content = context;
  else {
    content =
      assistantCharacter +
      (responseFormat === "text" ? hierarchicalResponseFormat : "") +
      (context && !context.includes(contextInstruction)
        ? (isContextInstructionToInsert ? contextInstruction : "") +
          userContextInstructions +
          "\n\nUSER INPUT (content to rely to or apply the next user prompt to, and refered as 'context', between double angle brackets):\n<< " +
          context +
          " >>"
        : "");
    content = await verifyTokenLimitAndTruncate(model, prompt, content);
  }

  // if (typeOfCompletion === "gptCompletion") {
  if (isRedone) {
    if (isExistingBlock(targetUid)) {
      targetUid = await createSiblingBlock(targetUid, "before");
      window.roamAlphaAPI.updateBlock({
        block: {
          uid: targetUid,
          string: assistantRole,
        },
      });
    } else targetUid = await insertBlockInCurrentView(assistantRole);
  } else {
    if (typeof prompt === "string") {
      // else prompt is already conversation object
      if (isInConversation) {
        prompt = getConversationArray(getParentBlock(targetUid));
      } else {
        prompt = [
          {
            role: "user",
            content: prompt,
          },
        ];
      }
    }
  }
  // }
  const intervalId = await displaySpinner(targetUid);

  let aiResponse = await aiCompletion(
    model,
    prompt,
    content,
    responseFormat,
    targetUid,
    isInConversation
  );
  console.log("aiResponse :>> ", aiResponse);
  if (isInConversation)
    aiResponse = aiResponse.replace(assistantRole, "").trim();
  if (typeOfCompletion === "gptPostProcessing" && Array.isArray(aiResponse)) {
    updateArrayOfBlocks(aiResponse);
  } else {
    insertStructuredAIResponse(targetUid, aiResponse);
  }
  setTimeout(() => {
    removeSpinner(intervalId);
  }, 100);
};

export const getTemplateForPostProcessing = async (
  parentUid,
  depth,
  uidsToExclude,
  withInstructions = true,
  isToHighlight = true
) => {
  let prompt = "";
  let excluded;
  let isInMultipleBlocks = true;
  let tree = getTreeByUid(parentUid);
  if (parentUid && tree) {
    if (tree.length && tree[0].children) {
      isToHighlight && highlightHtmlElt({ eltUid: parentUid });
      // prompt is a template as children of the current block
      let { linearArray, excludedUids } = convertTreeToLinearArray(
        tree[0].children,
        depth,
        99,
        true,
        uidsToExclude.length ? uidsToExclude : "{text}"
      );
      excluded = excludedUids;
      prompt =
        (withInstructions ? instructionsOnTemplateProcessing : "") +
        linearArray.join("\n");
    } else {
      return null;
    }
  } else return null;
  return {
    stringified: prompt,
    isInMultipleBlocks: isInMultipleBlocks,
    excluded,
  };
};

export const copyTemplate = async (
  targetUid,
  templateUid,
  maxDepth,
  strToExclude = "{text}"
) => {
  let uidsToExclude = [];
  if (!templateUid && !defaultTemplate) return;
  const tree = getTreeByUid(templateUid || defaultTemplate);
  uidsToExclude = await copyTreeBranches(
    tree,
    targetUid,
    maxDepth,
    strToExclude
  );
  return uidsToExclude;
};

const verifyTokenLimitAndTruncate = async (model, prompt, content) => {
  // console.log("tokensLimit object :>> ", tokensLimit);
  if (!tokenizer) {
    tokenizer = await getTokenizer();
  }
  if (!tokenizer) return content;
  const tokens = tokenizer.encode(prompt + content);
  console.log("context tokens :", tokens.length);

  const limit = tokensLimit[model];
  if (!limit) {
    console.log("No context length provided for this model.");
    return content;
  }

  if (tokens.length > limit) {
    AppToaster.show({
      message: `The token limit (${limit}) has been exceeded (${tokens.length} needed), the context will be truncated to fit ${model} token window.`,
    });
    // 1% margin of error
    const ratio = limit / tokens.length - 0.01;
    content = content.slice(0, content.length * ratio);
    console.log(
      "tokens of truncated context:",
      tokenizer.encode(prompt + content).length
    );
  }
  return content;
};

export function getValidLanguageCode(input) {
  if (!input) return "";
  let lggCode = input.toLowerCase().trim().slice(0, 2);
  if (supportedLanguage.includes(lggCode)) {
    AppToaster.clear();
    return lggCode;
  } else {
    AppToaster.show({
      message:
        "Live AI Assistant: Incorrect language code for transcription, see instructions in settings panel.",
    });
    return "";
  }
}

const supportedLanguage = [
  "af",
  "am",
  "ar",
  "as",
  "az",
  "ba",
  "be",
  "bg",
  "bn",
  "bo",
  "br",
  "bs",
  "ca",
  "cs",
  "cy",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "eu",
  "fa",
  "fi",
  "fo",
  "fr",
  "gl",
  "gu",
  "ha",
  "haw",
  "he",
  "hi",
  "hr",
  "ht",
  "hu",
  "hy",
  "id",
  "is",
  "it",
  "ja",
  "jw",
  "ka",
  "kk",
  "km",
  "kn",
  "ko",
  "la",
  "lb",
  "ln",
  "lo",
  "lt",
  "lv",
  "mg",
  "mi",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "my",
  "ne",
  "nl",
  "nn",
  "no",
  "oc",
  "pa",
  "pl",
  "ps",
  "pt",
  "ro",
  "ru",
  "sa",
  "sd",
  "si",
  "sk",
  "sl",
  "sn",
  "so",
  "sq",
  "sr",
  "su",
  "sv",
  "sw",
  "ta",
  "te",
  "tg",
  "th",
  "tk",
  "tl",
  "tr",
  "tt",
  "uk",
  "ur",
  "uz",
  "vi",
  "yi",
  "yo",
  "zh",
];

const addImagesUrlToMessages = (messages, content) => {
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
        .replace(matchingImagesInPrompt[j][0], "")
        .trim();
      if (nbCountdown > 0)
        messages[i].content.push({
          type: "image_url",
          image_url: {
            url: matchingImagesInPrompt[j][1],
            detail: resImages,
          },
        });
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
        messages[1].content.push({
          type: "image_url",
          image_url: {
            url: matchingImagesInContext[i][1],
            detail: resImages,
          },
        });
        nbCountdown--;
      }
    }
  }
  return messages;
};

const isModelSupportingImage = (model) => {
  if (model === "gpt-4o" || model === "gpt-4o-mini") return true;
  if (openRouterModelsInfo.length) {
    const ormodel = openRouterModelsInfo.find((m) => m.id === model);
    // console.log("ormodel :>> ", ormodel);
    if (ormodel) return ormodel.imagePricing ? true : false;
  }
  return false;
};

export const isPromptInConversation = (promptUid) => {
  const previousSiblingUid = getPreviousSiblingBlock(promptUid);
  const isInConversation =
    previousSiblingUid &&
    chatRoles.genericAssistantRegex &&
    chatRoles.genericAssistantRegex.test(previousSiblingUid.string)
      ? true
      : false;
  if (isInConversation) {
    const conversationButton = document.querySelector(
      ".speech-instant-container:not(:has(.fa-rotage-right)):has(.fa-comments)"
    );
    conversationButton && conversationButton.remove();
  }
  return isInConversation;
};
