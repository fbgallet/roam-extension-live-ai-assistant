import OpenAI from "openai";
import {
  assistantCharacter,
  gptCustomModel,
  gptModel,
  transcriptionLanguage,
  whisperPrompt,
} from ".";

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

export async function gptPostProcessing(text, openai) {
  console.log("text: ", text);
  try {
    const postProcessedText = await openai.completions.create({
      model: "gpt-3.5-turbo-instruct",
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

export async function gptCompletion(prompt, openai, context) {
  try {
    const response = await openai.chat.completions.create({
      model: gptModel === "custom model" ? gptCustomModel : gptModel,
      messages: [
        {
          role: "system",
          content:
            assistantCharacter +
            (context
              ? " Here is the context or content to which you must refer to respond to the user's prompt, " +
                " to which the user can refer to as 'this', 'that', 'this block', 'these blocks', 'the selected blocks' or 'what is selected' among other possibilities" +
                "(the 9-characters code between parentheses represents the reference to the block containing the copied text. In your response, you can also refer to it if asked, using the following syntax [*](((9-characters code))). Here is the content in question:\n" +
                context
              : ""),
        },
        { role: "user", content: prompt },
      ],
    });
    console.log(response.choices[0]);
    return response.choices[0].message.content;
  } catch (error) {
    console.error(error);
  }
}

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
