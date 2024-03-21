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
} from ".";
import {
  addContentToBlock,
  convertTreeToLinearArray,
  copyTreeBranches,
  createChildBlock,
  displaySpinner,
  extractBetweenBraces,
  getTreeByUid,
  highlightHtmlElt,
  insertBlockInCurrentView,
  isExistingBlock,
  removeSpinner,
  sanitizeJSONstring,
  trimOutiseOuterBraces,
  updateArrayOfBlocks,
} from "./utils/utils";
import {
  instructionsOnJSONResponse,
  instructionsOnTemplateProcessing,
} from "./utils/prompts";
import { AppToaster } from "./components/VoiceRecorder";

const encoding = getEncoding("cl100k_base");
export const lastCompletion = {
  prompt: null,
  targetUid: null,
  context: null,
  typeOfCompletion: null,
};

export function initializeOpenAIAPI(OPENAI_API_KEY) {
  try {
    const openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
      dangerouslyAllowBrowser: true,
    });
    return openai;
  } catch (error) {
    console.log(error.message);
    AppToaster.show({
      message: `Speech-to-Roam - Error during the initialization of OpenAI API: ${error.message}`,
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
      message: `Speech-to-Roam - Error during the initialization of Anthropic API: ${error.message}`,
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
  context = "",
  responseFormat
) {
  let content =
    assistantCharacter +
    (responseFormat === "json_object" ? instructionsOnJSONResponse : "") +
    (context
      ? contextInstruction +
        userContextInstructions +
        "\nHere is the content to rely on:\n" +
        context
      : "");
  let model = instantModel || defaultModel;
  content = verifyTokenLimitAndTruncate(model, prompt, content);
  console.log("Context (eventually truncated):\n", content);

  console.log("responseFormat :>> ", responseFormat);
  if (
    // responseFormat !== "json_object" &&
    model.slice(0, 6) === "Claude" &&
    ANTHROPIC_API_KEY
  )
    return await claudeCompletion(model, prompt, content, responseFormat);
  if (openaiLibrary?.apiKey)
    return await gptCompletion(model, prompt, content, responseFormat);
  else {
    AppToaster.show({
      message: `Provide an API key to use ${model} model. See doc and settings.`,
      timeout: 15000,
    });
    AppToaster;
    return "";
  }
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
      jsonOnly = trimOutiseOuterBraces(text);
      jsonOnly = sanitizeJSONstring(jsonOnly);
    }
    return jsonOnly || text;
  }
}

export async function gptCompletion(
  model,
  prompt,
  content,
  responseFormat = "text"
) {
  try {
    const response = await openaiLibrary.chat.completions.create({
      model:
        model === "custom model"
          ? gptCustomModel
          : model && !model.includes("Claude")
          ? model
          : "gpt-3.5-turbo",
      response_format: { type: responseFormat },
      messages: [
        {
          role: "system",
          content: content,
        },
        { role: "user", content: prompt },
      ],
    });
    console.log("OpenAI chat completion response :>>", response);
    return response.choices[0].message.content;
  } catch (error) {
    console.error(error);
    AppToaster.show({
      message: `OpenAI error msg: ${error.message}`,
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

  const assistantRole = instantModel
    ? getInstantAssistantRole(instantModel)
    : chatRoles.assistant;

  if (isRedone && typeOfCompletion === "gptCompletion") {
    if (isExistingBlock(targetUid))
      window.roamAlphaAPI.updateBlock({
        block: {
          uid: targetUid,
          string: assistantRole,
        },
      });
    else targetUid = await insertBlockInCurrentView(assistantRole);
  }
  const intervalId = await displaySpinner(targetUid);
  console.log("Prompt sent to AI assistant :>>\n", prompt);
  // console.log("typeOfCompletion :>> ", typeOfCompletion);
  const aiResponse = await aiCompletion(
    instantModel,
    prompt,
    context,
    typeOfCompletion === "gptPostProcessing" ? "json_object" : "text"
  );
  console.log("aiResponse :>> ", aiResponse);
  removeSpinner(intervalId);
  if (typeOfCompletion === "gptPostProcessing" && aiResponse.includes("{")) {
    const parsedResponse = JSON.parse(aiResponse);
    updateArrayOfBlocks(parsedResponse.response);
    // if (!isOnlyTextual)
    //   window.roamAlphaAPI.moveBlock({
    //     location: { "parent-uid": targetUid, order: 0 },
    //     block: { uid: startBlock },
    //   });
  } else {
    const splittedResponse = aiResponse.split(`\n\n`);
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
  const tokens = encoding.encode(prompt + content);
  console.log("context tokens :", tokens.length);

  if (tokens.length > tokensLimit[model]) {
    AppToaster.show({
      message: `The token limit (${tokensLimit[model]}) has been exceeded (${tokens.length} needed), the context will be truncated to fit ${model} token window.`,
    });
    // + 2% margin of error
    const ratio = tokensLimit[model] / tokens.length - 0.02;
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
        "Speech-to-Roam: Incorrect language code for transcription, see instructions in settings panel.",
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
