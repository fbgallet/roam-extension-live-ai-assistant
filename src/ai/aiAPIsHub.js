import OpenAI from "openai";
// import { playAudio } from "openai/helpers/audio";
import Anthropic from "@anthropic-ai/sdk";
import { Tiktoken } from "js-tiktoken/lite"; // too big in bundle (almost 3 Mb)
import axios from "axios";

import {
  ANTHROPIC_API_KEY,
  openaiLibrary,
  transcriptionLanguage,
  whisperPrompt,
  streamResponse,
  openrouterLibrary,
  openRouterModels,
  ollamaModels,
  modelTemperature,
  ollamaServer,
  resImages,
  anthropicLibrary,
  isSafari,
  groqLibrary,
  isUsingGroqWhisper,
  groqModels,
  maxImagesNb,
  openRouterModelsInfo,
  deepseekLibrary,
  googleLibrary,
  grokLibrary,
  websearchContext,
  ttsVoice,
  voiceInstructions,
  transcriptionModel,
} from "..";
import {
  insertInstantButtons,
  insertParagraphForStream,
} from "../utils/domElts";
import { isCanceledStreamGlobal } from "../components/InstantButtons";
import { sanitizeJSONstring, trimOutsideOuterBraces } from "../utils/format";
import {
  getModelsInfo,
  normalizeClaudeModel,
  tokensLimit,
  updateTokenCounter,
} from "./modelsInfo";
import { roamImageRegex } from "../utils/regex";
import {
  ThinkingToaster,
  AppToaster,
  addButtonsToThinkingToaster,
  displayThinkingToast,
} from "../components/Toaster";
import { getResolvedContentFromBlocks } from "./dataExtraction";
import { updateBlock } from "../utils/roamAPI";

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
        isUsingGroqWhisper && groqLibrary
          ? "whisper-large-v3"
          : transcriptionModel,
      // stream: true, // doesn't work as real streaming here
    };
    if (transcriptionLanguage) options.language = transcriptionLanguage;
    if (whisperPrompt) options.prompt = whisperPrompt;
    const transcript =
      isUsingGroqWhisper && groqLibrary
        ? await groqLibrary.audio.transcriptions.create(options)
        : await openaiLibrary.audio.transcriptions.create(options);
    // console.log(transcript);

    return transcript.text;

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

    // events to handle stop or end of audio
    const stopAudio = () => {
      audio.pause();
      audio.currentTime = 0;
      document.removeEventListener("keydown", handleKeyPress);
    };
    const handleKeyPress = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        stopAudio();
      }
    };
    audio.addEventListener("ended", () => {
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

export async function imageGeneration(prompt, targetUid) {
  if (!openaiLibrary) {
    AppToaster.show({
      message: `OpenAI API Key is needed for image generation`,
      timeout: 10000,
    });
    return;
  }
  try {
    console.log("prompt :>> ", prompt);
    const result = await openaiLibrary.images.generate({
      model: "gpt-image-1",
      prompt,
      quality: "low",
      size: "auto",
      background: "auto",
      moderation: "low",
    });
    console.log("result :>> ", result);
    if (result.usage) {
      const usage = {
        input_tokens: {},
        output_tokens: 0,
      };
      usage["input_tokens"] = result.usage["input_tokens_details"];
      usage["output_tokens"] = result.usage["output_tokens"];
      updateTokenCounter("gpt-image-1", usage);
    }
    const image_base64 = result.data[0].b64_json;
    const byteCharacters = atob(image_base64);
    const byteNumbers = Array.from(byteCharacters).map((c) => c.charCodeAt(0));
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: "image/png" });
    const firebaseUrl = await roamAlphaAPI.file.upload({
      file: blob,
    });
    return firebaseUrl;
  } catch (error) {
    console.error(error);
    AppToaster.show({
      message: `OpenAI error msg: ${error.message}`,
      timeout: 15000,
    });
  }
}

export function modelAccordingToProvider(model) {
  const llm = {
    provider: "",
    prefix: "",
    id: "",
    name: "",
    library: undefined,
  };
  model = model && model.toLowerCase();

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
    const openRouterInfos = openRouterModelsInfo.find((m) => m.id === llm.id);

    llm.name = llm.id && openRouterInfos ? openRouterInfos.name : llm.id;
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
    llm.library = "ollama";
  } else if (model.includes("groq")) {
    llm.provider = "groq";
    llm.prefix = "groq/";
    llm.id =
      prefix === "groq"
        ? model.replace("groq/", "")
        : groqModels.length
        ? groqModels[0]
        : undefined;
    llm.library = groqLibrary;
  } else if (model.slice(0, 6) === "claude") {
    llm.provider = "Anthropic";
    llm.id = normalizeClaudeModel(model);
    llm.name = normalizeClaudeModel(model, true);
    llm.library = anthropicLibrary;
  } else if (model.includes("deepseek")) {
    llm.provider = "DeepSeek";
    if (model === "deepseek-r1") {
      llm.id = "deepseek-reasoner";
      llm.name = "DeepSeek-R1";
    } else {
      llm.id = "deepseek-chat";
      llm.name = "DeepSeek-V3";
    }
    llm.library = deepseekLibrary;
  } else if (model.includes("grok")) {
    llm.provider = "Grok";
    if (model === "grok-2 vision") {
      llm.id = "grok-2-vision-1212";
      llm.name = "Grok-2 Vision";
    } else {
      llm.id = "grok-2-1212";
      llm.name = "Grok-2";
    }
    llm.library = grokLibrary;
  } else if (model.includes("gemini")) {
    llm.provider = "Google";
    llm.id = model;
    llm.library = googleLibrary;
  } else {
    llm.provider = "OpenAI";
    if (model.includes("search")) {
      if (model.includes("-preview")) {
        llm.id = model;
        llm.name = model.replace("-preview", "");
      } else {
        llm.id = model + "-preview";
        llm.name = model;
      }
    } else llm.id = model || "gpt-4.1-mini";
    llm.library = openaiLibrary;
  }
  if (!llm.name) llm.name = llm.id;
  if (!llm.id) {
    AppToaster.show({
      message: `No model available in the settings for the current provider: ${llm.provider}.`,
      timeout: 15000,
    });
    return null;
  }
  // console.log("Used LLM id :>> ", llm.id);

  if (llm.provider !== "ollama" && !llm.library?.apiKey) {
    AppToaster.show({
      message: `Provide an API key to use ${
        llm.name || "an AI"
      } model. See doc and settings.`,
      timeout: 15000,
    });
    return llm;
  }
  return llm;
}

export async function claudeCompletion({
  model,
  prompt,
  systemPrompt,
  content = "",
  responseFormat,
  targetUid,
  isButtonToInsert = true,
}) {
  if (ANTHROPIC_API_KEY) {
    model = normalizeClaudeModel(model);
    try {
      let messages = [
        {
          role: "user",
          content: (systemPrompt ? systemPrompt + "\n\n" : "") + content,
        },
      ].concat(prompt);
      let thinkingToaster;
      const options = {
        max_tokens:
          model.includes("3-5") || model.includes("3.5") ? 8192 : 4096,
        model: model.replace("+thinking", ""),
        messages,
      };
      if (model.includes("3-7") || model.includes("3.7")) {
        options.max_tokens = 128000;
        // options.betas = ["output-128k-2025-02-19"];
        if (model.includes("+thinking")) {
          options.thinking = {
            type: "enabled",
            budget_tokens: 6500, // limit to 0.10$ by request
          };
        }
      }
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

      if (isModelSupportingImage(model)) {
        messages = addImagesUrlToMessages(messages, content, true);
      }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "output-128k-2025-02-19",
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
        if (isButtonToInsert)
          insertInstantButtons({
            model,
            prompt,
            content,
            responseFormat,
            targetUid,
            isStreamStopped: false,
          });
        const streamElt = insertParagraphForStream(targetUid);
        let thinkingToasterStream;
        if (model.includes("+thinking")) {
          thinkingToasterStream = displayThinkingToast(
            "Sonnet 3.7 Extended Thinking process:"
          );
        }

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
                  if (data.delta.type === "text_delta") {
                    const text = data.delta.text;
                    respStr += text;
                    streamElt.innerHTML += text;
                  } else if (data.delta.type === "thinking_delta") {
                    if (thinkingToasterStream)
                      thinkingToasterStream.innerText += data.delta.thinking;
                  }
                } else if (data.type === "message_start") {
                  usage["input_tokens"] =
                    data.message?.usage["input_tokens"] || 0;
                } else if (data.type === "message_delta" && data.usage) {
                  console.log("data.usage :>> ", data.usage);
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

export async function openaiCompletion({
  aiClient,
  model,
  systemPrompt,
  prompt,
  content,
  responseFormat = "text",
  targetUid,
  isButtonToInsert,
}) {
  let respStr = "";
  let usage = {};
  let messages = [
    {
      role:
        model.startsWith("o1") || model.startsWith("o3") ? "user" : "system",
      content: systemPrompt + (content ? "\n\n" + content : ""),
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
      (model.includes("gpt") || model.includes("o1") || model.includes("o3"))
    )
      options.temperature = 1.3;
    if (model.includes("-search-preview"))
      options.web_search_options = {
        search_context_size: websearchContext,
      };

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
    let annotations;

    console.log("OpenAI response :>>", response);

    if (isToStream) {
      if (isButtonToInsert)
        insertInstantButtons({
          model,
          prompt,
          content,
          responseFormat,
          targetUid,
          isStreamStopped: false,
        });
      const streamElt = insertParagraphForStream(targetUid);
      let thinkingToasterStream;
      if (model === "deepseek-reasoner") {
        thinkingToasterStream = displayThinkingToast(
          "DeepSeek-R1 thinking process:"
        );
      }

      try {
        for await (const chunk of response) {
          if (isCanceledStreamGlobal) {
            streamElt.innerHTML += "(⚠️ stream interrupted by user)";
            // respStr = "";
            break;
          }
          if (chunk.choices[0]?.delta?.reasoning_content)
            thinkingToasterStream.innerText +=
              chunk.choices[0]?.delta?.reasoning_content;
          respStr += chunk.choices[0]?.delta?.content || "";
          streamElt.innerHTML += chunk.choices[0]?.delta?.content || "";
          if (chunk.choices[0]?.delta?.annotations)
            annotations = chunk.choices[0].delta.annotations;
          if (chunk.usage) usage = chunk.usage;
          if (chunk.x_groq?.usage) usage = chunk.x_groq.usage;
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

    // Add web sources annotations with Web search models
    if (!isToStream && response.choices[0].message.annotations?.length)
      annotations = response.choices[0].message.annotations;
    if (model.includes("-search") && annotations && annotations.length) {
      let webSources = "\n\nWeb sources:";
      annotations.forEach((annotation) => {
        webSources += `\n  - [${annotation["url_citation"].title}](${annotation["url_citation"].url})`;
      });
      if (isToStream) respStr += webSources;
      else response.choices[0].message.content += webSources;
    }
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

export async function ollamaCompletion({
  model,
  prompt,
  systemPrompt = "",
  content = "",
  responseFormat = "text",
  targetUid,
}) {
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
            content: (systemPrompt ? systemPrompt + "\n\n" : "") + content,
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

const addImagesUrlToMessages = (messages, content, isAnthropicModel) => {
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
      if (nbCountdown > 0) {
        if (!isAnthropicModel)
          messages[i].content.push({
            type: "image_url",
            image_url: {
              url: matchingImagesInPrompt[j][1],
              detail: resImages,
            },
          });
        else if (isAnthropicModel)
          messages[i].content.push({
            type: "image",
            source: {
              type: "url",
              url: matchingImagesInPrompt[j][1],
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
  model = model.toLowerCase();
  if (
    model.includes("gpt-4o") ||
    model.includes("gpt-4.1") ||
    model.includes("vision")
  )
    return true;
  if (model.includes("claude-3-5") || model.includes("claude-3-7")) return true;
  if (openRouterModelsInfo.length) {
    const ormodel = openRouterModelsInfo.find(
      (m) => m.id.toLowerCase() === model
    );
    // console.log("ormodel :>> ", ormodel);
    if (ormodel) return ormodel.imagePricing ? true : false;
  }
  return false;
};

export const getTokenizer = async () => {
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

export const verifyTokenLimitAndTruncate = async (model, prompt, content) => {
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
