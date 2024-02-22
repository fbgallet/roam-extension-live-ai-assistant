import OpenAI from "openai";
import { getEncoding } from "js-tiktoken";

import {
  assistantCharacter,
  contextInstruction,
  gptCustomModel,
  gptModel,
  isResponseToSplit,
  tokensLimit,
  transcriptionLanguage,
  userContextInstructions,
  whisperPrompt,
} from ".";
import {
  addContentToBlock,
  convertTreeToLinearArray,
  createChildBlock,
  displaySpinner,
  getAndNormalizeContext,
  getTreeByUid,
  highlightHtmlElt,
  removeSpinner,
  updateArrayOfBlocks,
} from "./utils/utils";
import {
  instructionsOnJSONResponse,
  instructionsOnTemplateProcessing,
} from "./utils/prompts";

const encoding = getEncoding("cl100k_base");

export function initializeOpenAIAPI(OPENAI_API_KEY) {
  try {
    const openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
      dangerouslyAllowBrowser: true,
    });
    return openai;
  } catch (error) {
    console.log(error.message);
  }
}

export async function transcribeAudio(filename, openai) {
  // let audioFile = new File([filename], "myaudio.ogg", {
  //   type: "audio/ogg; codecs=opus",
  // });
  if (!openai) return null;
  try {
    // console.log(filename);
    const options = {
      file: filename,
      model: "whisper-1",
    };
    if (transcriptionLanguage) options.language = transcriptionLanguage;
    if (whisperPrompt) options.prompt = whisperPrompt;
    const transcript = await openai.audio.transcriptions.create(options);
    return transcript.text;
    // let processed = await gptPostProcessing(transcript.text);
    // return processed;
  } catch (error) {
    console.error(error.message);
    return null;
  }
}

export async function translateAudio(filename, openai) {
  console.log("openai :>> ", openai);
  if (!openai) return null;
  try {
    const options = {
      file: filename,
      model: "whisper-1",
    };
    // if (transcriptionLanguage) options.language = transcriptionLanguage;
    // if (whisperPrompt) options.prompt = whisperPrompt;
    const transcript = await openai.audio.translations.create(options);
    return transcript.text;
    // let processed = await gptPostProcessing(transcript.text);
    // return processed;
  } catch (error) {
    console.error(error);
    return null;
  }
}

export async function gptPostProcessing(prompt, openai, context) {
  console.log("text: ", text);
  try {
    const postProcessedText = await openai.completions.create({
      model: "gpt-3.5-turbo-0125",
      prompt:
        text +
        "\nYou are an [expert] in note-taking. Reproduce [exactly] the previous text, putting the most important words in double brackets like [[that]].",
      max_tokens: Math.floor(text.length / 2),
      temperature: 0.1,
    });
    console.log(postProcessedText.choices[0]);
    return postProcessedText.choices[0].text;
  } catch (error) {
    console.error(error);
  }
}

export async function gptCompletion(
  prompt,
  openai,
  context = "",
  responseFormat = "text"
) {
  try {
    if (!gptModel) gptModel = "gpt-3.5-turbo";

    let content =
      assistantCharacter +
      (responseFormat === "json_object" ? instructionsOnJSONResponse : "") +
      (context
        ? contextInstruction +
          userContextInstructions +
          "\nHere is the content to rely on:\n" +
          context
        : "");
    content = verifyTokenLimitAndTruncate(prompt, content);
    console.log("Context (eventually truncated):\n", content);

    const response = await openai.chat.completions.create({
      model: gptModel === "custom model" ? gptCustomModel : gptModel,
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
  }
}

export const insertCompletion = async (
  prompt,
  openai,
  targetUid,
  context,
  typeOfCompletion
) => {
  const intervalId = await displaySpinner(targetUid);
  console.log("Prompt sent to GPT :>> ", prompt);
  const gptResponse = await gptCompletion(
    prompt,
    openai,
    context,
    typeOfCompletion === gptPostProcessing ? "json_object" : "text"
  );
  removeSpinner(intervalId);
  if (typeOfCompletion === gptPostProcessing) {
    const parsedResponse = JSON.parse(gptResponse);
    updateArrayOfBlocks(parsedResponse.response);
    // if (!isOnlyTextual)
    //   window.roamAlphaAPI.moveBlock({
    //     location: { "parent-uid": targetUid, order: 0 },
    //     block: { uid: startBlock },
    //   });
  } else {
    const splittedResponse = gptResponse.split(`\n\n`);
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
  if (parentUid) {
    if (tree.length && tree[0].children) {
      let eltToHightlight = document.querySelector(`[id$=${parentUid}]`);
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
      // prompt is a simple block
      isInMultipleBlocks = false;
      prompt =
        "Here is the user prompt (the language in which it is written will determine the language of the response): " +
        (await getAndNormalizeContext(parentUid));
    }
  }
  return { stringified: prompt, isInMultipleBlocks: isInMultipleBlocks };
};

const verifyTokenLimitAndTruncate = (prompt, content) => {
  const tokens = encoding.encode(prompt + content);
  console.log("tokens :>> ", tokens.length);

  if (tokens.length > tokensLimit[gptModel]) {
    alert(
      `The token limit (${tokensLimit[gptModel]}) has been exceeded (${tokens.length} needed), the context will be truncated to fit ${gptModel} token window.`
    );
    // + 2% margin of error
    const ratio = tokensLimit[gptModel] / tokens.length - 0.02;
    content = content.slice(0, content.length * ratio);
    console.log(
      "tokens of truncated context:>> ",
      encoding.encode(prompt + content).length
    );
  }
  return content;
};

export const supportedLanguage = [
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
