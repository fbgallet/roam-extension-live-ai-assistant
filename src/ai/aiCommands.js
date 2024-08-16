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
  openRouterModelsInfo,
  maxImagesNb,
  modelTemperature,
  ollamaServer,
  resImages,
  anthropicLibrary,
  isSafari,
} from "..";
import {
  addContentToBlock,
  convertTreeToLinearArray,
  copyTreeBranches,
  createSiblingBlock,
  getConversationArray,
  getFlattenedContentFromArrayOfBlocks,
  getParentBlock,
  getPreviousSiblingBlock,
  getTreeByUid,
  highlightHtmlElt,
  insertBlockInCurrentView,
  isExistingBlock,
  roamImageRegex,
  updateArrayOfBlocks,
} from "../utils/utils";
import {
  hierarchicalResponseFormat,
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
  parseAndCreateBlocks,
  sanitizeJSONstring,
  splitParagraphs,
  trimOutsideOuterBraces,
} from "../utils/format";

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
    console.log("Error at initialization stage");
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

async function aiCompletion(
  instantModel,
  prompt,
  content = "",
  responseFormat,
  targetUid
) {
  let aiResponse;
  let hasAPIkey = true;
  let model = instantModel || defaultModel;
  let prefix = model.split("/")[0];
  if (responseFormat === "json_object")
    prompt += "\n\nResponse format:\n" + instructionsOnJSONResponse;
  else {
    content += "\n\n" + hierarchicalResponseFormat;
  }

  if (prefix === "openRouter") {
    if (!openrouterLibrary?.apiKey) hasAPIkey = false;
    else
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
    if (model.slice(0, 6) === "Claude") {
      if (!ANTHROPIC_API_KEY) {
        console.log("anthropicLibrary :>> ", anthropicLibrary);
        hasAPIkey = false;
      } else
        aiResponse = await claudeCompletion(
          model,
          prompt,
          content,
          responseFormat,
          targetUid
        );
    } else {
      if (!openaiLibrary?.apiKey) {
        hasAPIkey = false;
      } else
        aiResponse = await openaiCompletion(
          openaiLibrary,
          model,
          prompt,
          content,
          responseFormat,
          targetUid
        );
    }
    if (!hasAPIkey) {
      AppToaster.show({
        message: `Provide an API key to use ${model} model. See doc and settings.`,
        timeout: 15000,
      });
      return "";
    }
  }

  if (responseFormat === "json_object") {
    let parsedResponse = JSON.parse(aiResponse);
    if (typeof parsedResponse.response === "string")
      parsedResponse.response = JSON.parse(parsedResponse.response);
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
      case "Claude Sonnet 3.5":
        model = "claude-3-5-sonnet-20240620";
        // model = "claude-3-sonnet-20240229"; previous version
        break;
      case "Claude Haiku":
        model = "claude-3-haiku-20240307";
    }
    try {
      const options = {
        key: ANTHROPIC_API_KEY,
        prompt: prompt,
        context: content,
        model: model,
      };
      if (modelTemperature !== null) options.temperature = modelTemperature;
      const { data } = await axios.post(
        "https://site--ai-api-back--2bhrm4wg9nqn.code.run/anthropic/message",
        //"http://localhost:3000/anthropic/message",
        // See server code here: https://github.com/fbgallet/ai-api-back
        // No data is stored on the server or displayed in any log
        options
      );
      console.log("Anthropic Claude response :>> ", data.response);
      let text = data.response.content[0].text;
      let jsonOnly;
      if (responseFormat !== "text") {
        jsonOnly = trimOutsideOuterBraces(text);
        jsonOnly = sanitizeJSONstring(jsonOnly);
      }
      return jsonOnly || text;
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
  let messages = [
    {
      role: "system",
      content: content,
    },
  ].concat(prompt);
  console.log("messages :>> ", messages);
  // {
  //   role: "user",
  //   content: [
  //     {
  //       type: "text",
  //       text: prompt,
  //     },
  //   ],
  // },
  // ];
  if (isModelSupportingImage(model)) {
    messages = addImagesUrlToMessages(messages, content);
  }
  try {
    let response;
    const options = {
      model: model,
      response_format: { type: responseFormat },
      messages: messages,
      stream: streamResponse && responseFormat === "text",
    };
    if (modelTemperature !== null) options.temperature = modelTemperature * 2.0;
    // maximum temperature with OpenAI models regularly produces aberrations.
    if (options.temperature > 1.2 && model.includes("gpt"))
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
        console.log(respStr);
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

  if (isRedone || isInConversation) content = context;
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
    content = await verifyTokenLimitAndTruncate(model, prompt, content);
  }
  console.log("Context (eventually truncated):\n", content);

  if (typeOfCompletion === "gptCompletion") {
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
  }
  const intervalId = await displaySpinner(targetUid);

  console.log("prompt :>> ", prompt);

  let aiResponse = await aiCompletion(
    model,
    prompt,
    content,
    responseFormat,
    targetUid
  );
  console.log("aiResponse :>> ", aiResponse);
  if (isInConversation)
    aiResponse = aiResponse.replace(assistantRole, "").trim();
  if (typeOfCompletion === "gptPostProcessing" && Array.isArray(aiResponse)) {
    updateArrayOfBlocks(aiResponse);
  } else {
    const splittedResponse = splitParagraphs(aiResponse);
    if (
      (!isResponseToSplit || splittedResponse.length === 1) &&
      !/^[-\d.]\s*|^[a-z]\)\s|^#{1,6}\s/im.test(splittedResponse[0])
    )
      await addContentToBlock(targetUid, splittedResponse[0]);
    else {
      await parseAndCreateBlocks(targetUid, aiResponse);
    }
  }
  setTimeout(() => {
    removeSpinner(intervalId);
  }, 100);
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
      highlightHtmlElt(null, eltToHightlight);
      // prompt is a template as children of the current block
      let linearArray = convertTreeToLinearArray(tree[0].children);
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

export async function getModelsInfo() {
  try {
    const { data } = await axios.get("https://openrouter.ai/api/v1/models");
    // console.log("data", data.data);
    let result = data.data
      .filter((model) => openRouterModels.includes(model.id))
      .map((model) => {
        tokensLimit["openRouter/" + model.id] = model.context_length;
        return {
          id: model.id,
          name: model.name,
          contextLength: Math.round(model.context_length / 1024),
          description: model.description,
          promptPricing: model.pricing.prompt * 1000000,
          completionPricing: model.pricing.completion * 1000000,
          imagePricing: model.pricing.image * 1000,
        };
      });
    return result;
  } catch (error) {
    console.log("Impossible to get OpenRouter models infos:", error);
    return [];
  }
}

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

  messages &&
    messages.forEach((msg, index) => {
      if (index > 0) {
        roamImageRegex.lastIndex = 0;
        const matchingImagesInPrompt = msg.content?.matchAll(roamImageRegex);
        matchingImagesInPrompt.length &&
          matchingImagesInPrompt.forEach((imgUrl) => {
            if (nbCountdown > 0)
              msg.content = [
                {
                  type: "text",
                  text: msg.content,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: imgUrl[1],
                    detail: resImages,
                  },
                },
              ];
            nbCountdown--;
          });
      }
    });

  if (content && content.length) {
    roamImageRegex.lastIndex = 0;
    const matchingImagesInContext = content.matchAll(roamImageRegex);
    matchingImagesInContext.forEach((imgUrl, index) => {
      if (nbCountdown > 0) {
        if (index === 0)
          messages.splice(1, 0, {
            role: "user",
            content: [
              { type: "text", text: "Image(s) provided in the context:" },
            ],
          });
        messages[1].content.push({
          type: "image_url",
          image_url: {
            url: imgUrl[1],
            detail: resImages,
          },
        });
        nbCountdown--;
      }
    });
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
  return previousSiblingUid &&
    chatRoles.genericAssistantRegex &&
    chatRoles.genericAssistantRegex.test(previousSiblingUid.string)
    ? true
    : false;
};
