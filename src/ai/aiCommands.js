import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { getEncoding } from "js-tiktoken";
import axios from "axios";

import {
  ANTHROPIC_API_KEY,
  assistantCharacter,
  chatRoles,
  contextInstruction,
  defaultTemplate,
  getInstantAssistantRole,
  gptCustomModel,
  defaultModel,
  isResponseToSplit,
  openaiLibrary,
  tokensLimit,
  transcriptionLanguage,
  userContextInstructions,
  whisperPrompt,
  streamResponse,
  openrouterLibrary,
  openRouterModels,
  ollamaModels,
} from "..";
import {
  addContentToBlock,
  convertTreeToLinearArray,
  copyTreeBranches,
  createChildBlock,
  createSiblingBlock,
  getFlattenedContentFromArrayOfBlocks,
  getTreeByUid,
  highlightHtmlElt,
  insertBlockInCurrentView,
  isExistingBlock,
  roamImageRegex,
  updateArrayOfBlocks,
} from "../utils/utils";
import {
  instructionsOnJSONResponse,
  instructionsOnTemplateProcessing,
} from "./prompts";
import { AppToaster } from "../components/VoiceRecorder";
import {
  displaySpinner,
  insertInstantButtons,
  insertParagraphForStream,
  removeSpinner,
} from "../utils/domElts";
import { isCanceledStreamGlobal } from "../components/InstantButtons";
import {
  sanitizeJSONstring,
  splitParagraphs,
  trimOutsideOuterBraces,
} from "../utils/format";

const encoding = getEncoding("cl100k_base");
export const lastCompletion = {
  prompt: null,
  targetUid: null,
  context: null,
  typeOfCompletion: null,
};

export function initializeOpenAIAPI(API_KEY, baseURL) {
  try {
    const clientSetting = {
      apiKey: API_KEY,
      dangerouslyAllowBrowser: true,
    };
    if (baseURL) {
      clientSetting.baseURL = baseURL;
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
      // dangerouslyAllowBrowser: true,
    });
    return anthropic;
  } catch (error) {
    console.log(error.message);
    AppToaster.show({
      message: `Live AI Assistant - Error during the initialization of Anthropic API: ${error.message}`,
    });
  }
}

export async function transcribeAudio(filename) {
  if (!openaiLibrary) return null;
  try {
    // console.log(filename);
    const options = {
      file: filename,
      model: "whisper-1",
    };
    if (transcriptionLanguage) options.language = transcriptionLanguage;
    if (whisperPrompt) options.prompt = whisperPrompt;
    const transcript = await openaiLibrary.audio.transcriptions.create(options);
    return transcript.text;
  } catch (error) {
    console.error(error.message);
    AppToaster.show({
      message: `OpenAI error msg: ${error.message}`,
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

// export async function gptPostProcessing(prompt, openai, context) {
//   console.log("text: ", text);
//   try {
//     const postProcessedText = await openai.completions.create({
//       model: "gpt-3.5-turbo-0125",
//       prompt:
//         text +
//         "\nYou are an [expert] in note-taking. Reproduce [exactly] the previous text, putting the most important words in double brackets like [[that]].",
//       max_tokens: Math.floor(text.length / 2),
//       temperature: 0.1,
//     });
//     console.log(postProcessedText.choices[0]);
//     return postProcessedText.choices[0].text;
//   } catch (error) {
//     console.error(error);
//   }
// }

async function aiCompletion(
  instantModel,
  prompt,
  content = "",
  responseFormat,
  targetUid
) {
  let aiResponse;
  let model = instantModel || defaultModel;
  let prefix = model.split("/")[0];
  if (responseFormat === "json_object")
    prompt += "\n\nResponse format:\n" + instructionsOnJSONResponse;
  if (prefix === "openRouter" && openrouterLibrary?.apiKey) {
    aiResponse = await openaiCompletion(
      openrouterLibrary,
      model.replace("openRouter/", ""),
      prompt,
      content,
      responseFormat,
      targetUid
    );
  } else if (prefix === "ollama") {
    aiResponse = await ollamaCompletion(
      model.replace("ollama/", ""),
      prompt,
      content,
      responseFormat,
      targetUid
    );
  } else {
    if (model.slice(0, 6) === "Claude" && ANTHROPIC_API_KEY)
      aiResponse = await claudeCompletion(
        model,
        prompt,
        content,
        responseFormat,
        targetUid
      );
    else if (openaiLibrary?.apiKey)
      aiResponse = await openaiCompletion(
        openaiLibrary,
        model,
        prompt,
        content,
        responseFormat,
        targetUid
      );
    else {
      AppToaster.show({
        message: `Provide an API key to use ${model} model. See doc and settings.`,
        timeout: 15000,
      });
      AppToaster;
      return "";
    }
  }

  if (responseFormat === "json_object") {
    const parsedResponse = JSON.parse(aiResponse);
    aiResponse = parsedResponse.response;
  }
  if (aiResponse)
    insertInstantButtons({
      model,
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

async function claudeCompletion(model, prompt, content, responseFormat) {
  if (ANTHROPIC_API_KEY) {
    switch (model) {
      // Anthropic models: https://docs.anthropic.com/claude/docs/models-overview#model-recommendations
      // Claude 3 Opus : claude-3-opus-20240229
      // Claude 3 Sonnet	: claude-3-sonnet-20240229
      // Claude 3 Haiku :	claude-3-haiku-20240307
      case "Claude Opus":
        model = "claude-3-opus-20240229";
        break;
      case "Claude Sonnet":
        model = "claude-3-sonnet-20240229";
        break;
      case "Claude Haiku":
        model = "claude-3-haiku-20240307";
    }
    const { data } = await axios.post(
      "https://site--ai-api-back--2bhrm4wg9nqn.code.run/anthropic/message",
      {
        key: ANTHROPIC_API_KEY,
        prompt: prompt,
        context: content,
        model: model,
        // headers: {
        //   "Access-Control-Allow-Origin": "*",
        //   "Content-Type": "application/json",
        //   "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
        // },
      }
    );
    console.log("Anthropic Claude response :>> ", data.response);
    let text = data.response.content[0].text;
    let jsonOnly;
    if (responseFormat !== "text") {
      jsonOnly = trimOutsideOuterBraces(text);
      jsonOnly = sanitizeJSONstring(jsonOnly);
    }
    return jsonOnly || text;
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
  const messages = [
    {
      role: "system",
      content: content,
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: prompt,
        },
      ],
    },
  ];
  if (model === "gpt-4o") {
    const matchingImagesInPrompt = prompt.matchAll(roamImageRegex);
    matchingImagesInPrompt.forEach((imgUrl) => {
      messages[1].content.push({
        type: "image_url",
        image_url: {
          url: imgUrl[1],
        },
      });
    });
    const matchingImagesInContext = content.matchAll(roamImageRegex);
    matchingImagesInContext.forEach((imgUrl, index) => {
      if (index === 0)
        messages.splice(1, 0, {
          role: "user",
          content: [],
        });
      if (index < 3)
        messages[1].content.push({
          type: "image_url",
          image_url: {
            url: imgUrl[1],
          },
        });
    });
    console.log(messages);
  }
  try {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            "Timeout error on client side: OpenAI response time exceeded (90 seconds)"
          )
        );
      }, 90000);
    });
    const response = await Promise.race([
      await aiClient.chat.completions.create({
        model: model,
        response_format: { type: responseFormat },
        messages: messages,
        stream: streamResponse && responseFormat === "text",
      }),
      timeoutPromise,
    ]);
    let streamEltCopy = "";

    console.log(response);

    if (streamResponse && responseFormat === "text") {
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
        // const reader = response.data.getReader();
        // if (!reader) {
        //   throw new Error("Failed to read response body");
        // }

        // while (true) {
        //   const { done, value } = await reader.read();
        //   if (done) {
        //     break;
        //   }
        //   const rawjson = new TextDecoder().decode(value);
        //   const json = JSON.parse(rawjson);

        //   if (json.done === false) {
        //     respStr += json.message.content;
        //     streamElt.innerHTML += json.message.content;
        //   }
        // }

        for await (const chunk of response) {
          if (isCanceledStreamGlobal) {
            streamElt.innerHTML += "(⚠️ stream interrupted by user)";
            // respStr = "";
            break;
          }
          respStr += chunk.choices[0]?.delta?.content || "";
          streamElt.innerHTML += chunk.choices[0]?.delta?.content || "";
        }
      } catch (e) {
        console.log("Error during OpenAI stream response: ", e);
        return "";
      } finally {
        streamEltCopy = streamElt.innerHTML;
        if (isCanceledStreamGlobal)
          console.log("GPT response stream interrupted.");
        else streamElt.remove();
      }
    }
    console.log("OpenAI chat completion response :>>", response);
    return streamResponse && responseFormat === "text"
      ? respStr
      : response.choices[0].message.content;
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
    // need to allow * CORS origin
    // command MacOS terminal: launchctl setenv OLLAMA_ORIGINS "*"
    // then, close terminal and relaunch ollama serve
    const response = await axios.post(
      "http://localhost:11434/api/chat",
      {
        model: model,
        messages: [
          {
            role: "system",
            content: content,
          },
          { role: "user", content: prompt },
        ],
        options: {
          num_ctx: 8192,
        },
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

export const insertCompletion = async (
  prompt,
  targetUid,
  context,
  typeOfCompletion,
  instantModel,
  isRedone
) => {
  lastCompletion.prompt = prompt;
  lastCompletion.targetUid = targetUid;
  lastCompletion.context = context;
  lastCompletion.typeOfCompletion = typeOfCompletion;
  lastCompletion.instantModel = instantModel;

  let model = instantModel || defaultModel;
  if (model === "first OpenRouter model") {
    model = openRouterModels.length
      ? "openRouter/" + openRouterModels[0]
      : "gpt-3.5-turbo";
  } else if (model === "first Ollama local model") {
    model = ollamaModels.length ? "ollama/" + ollamaModels[0] : "gpt-3.5-turbo";
  }
  const responseFormat =
    typeOfCompletion === "gptPostProcessing" ? "json_object" : "text";
  const assistantRole = instantModel
    ? getInstantAssistantRole(instantModel)
    : chatRoles.assistant;

  let content;

  if (isRedone) content = context;
  else {
    content =
      assistantCharacter +
      // (responseFormat === "json_object" ? instructionsOnJSONResponse : "") +
      (context
        ? contextInstruction +
          userContextInstructions +
          "\nHere is the content to rely on:\n" +
          context
        : "");
    content = verifyTokenLimitAndTruncate(model, prompt, content);
  }
  console.log("Context (eventually truncated):\n", content);

  if (isRedone && typeOfCompletion === "gptCompletion") {
    if (isExistingBlock(targetUid)) {
      targetUid = createSiblingBlock(targetUid, "before");
      window.roamAlphaAPI.updateBlock({
        block: {
          uid: targetUid,
          string: assistantRole,
        },
      });
    } else targetUid = await insertBlockInCurrentView(assistantRole);
  }
  const intervalId = await displaySpinner(targetUid);
  console.log("Prompt sent to AI assistant :>>\n", prompt);
  // console.log("typeOfCompletion :>> ", typeOfCompletion);
  const aiResponse = await aiCompletion(
    model,
    prompt,
    context,
    responseFormat,
    targetUid
  );
  console.log("aiResponse :>> ", aiResponse);
  removeSpinner(intervalId);
  if (typeOfCompletion === "gptPostProcessing") {
    // console.log("parsedResponse :>> ", parsedResponse);
    updateArrayOfBlocks(aiResponse);
    // if (!isOnlyTextual)
    //   window.roamAlphaAPI.moveBlock({
    //     location: { "parent-uid": targetUid, order: 0 },
    //     block: { uid: startBlock },
    //   });
  } else {
    const splittedResponse = splitParagraphs(aiResponse);
    if (!isResponseToSplit || splittedResponse.length === 1)
      addContentToBlock(targetUid, splittedResponse[0]);
    else {
      for (let i = 0; i < splittedResponse.length; i++) {
        createChildBlock(targetUid, splittedResponse[i]);
      }
    }
  }
};

export const getTemplateForPostProcessing = async (parentUid) => {
  let prompt = "";
  let isInMultipleBlocks = true;
  let tree = getTreeByUid(parentUid);
  if (parentUid && tree) {
    if (tree.length && tree[0].children) {
      let eltToHightlight = document.querySelector(`[id$="${parentUid}"]`);
      eltToHightlight =
        eltToHightlight.tagName === "TEXTAREA"
          ? eltToHightlight.parentElement.parentElement.nextElementSibling
          : eltToHightlight.parentElement.nextElementSibling;
      // console.log("elt :>> ", elt.tagName);
      highlightHtmlElt(null, eltToHightlight);
      // prompt is a template as children of the current block
      let linearArray = convertTreeToLinearArray(tree[0].children);
      // console.log("linearArray :>> ", linearArray);
      prompt = instructionsOnTemplateProcessing + linearArray.join("\n");
    } else {
      return null;
    }
  } else return null;
  return { stringified: prompt, isInMultipleBlocks: isInMultipleBlocks };
};

export const copyTemplate = async (targetUid, templateUid) => {
  if (!templateUid && !defaultTemplate) return;
  const tree = getTreeByUid(templateUid || defaultTemplate);
  await copyTreeBranches(tree, targetUid);
};

const verifyTokenLimitAndTruncate = (model, prompt, content) => {
  // console.log("tokensLimit object :>> ", tokensLimit);
  const tokens = encoding.encode(prompt + content);
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
    // + 2% margin of error
    const ratio = limit / tokens.length - 0.02;
    content = content.slice(0, content.length * ratio);
    console.log(
      "tokens of truncated context:",
      encoding.encode(prompt + content).length
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
