import OpenAI from "openai";
// import { playAudio } from "openai/helpers/audio";
import Anthropic from "@anthropic-ai/sdk";
// import { Tiktoken } from "js-tiktoken/lite"; // too big in bundle (almost 3 Mb)
import axios from "axios";
import DOMPurify from "dompurify";

import {
  ANTHROPIC_API_KEY,
  openaiLibrary,
  streamResponse,
  openrouterLibrary,
  openRouterModels,
  ollamaModels,
  modelTemperature,
  ollamaServer,
  anthropicLibrary,
  isSafari,
  groqLibrary,
  groqModels,
  openRouterModelsInfo,
  deepseekLibrary,
  googleLibrary,
  grokLibrary,
  customBaseURL,
  openAiCustomModels,
  customOpenaiLibrary,
  reasoningEffort,
} from "..";
import {
  insertInstantButtons,
  insertParagraphForStream,
} from "../utils/domElts";
import { isCanceledStreamGlobal } from "../components/InstantButtons";
import { sanitizeJSONstring, trimOutsideOuterBraces } from "../utils/format";
import {
  modelsPricing,
  normalizeClaudeModel,
  openRouterModelPricing,
  tokensLimit,
  updateTokenCounter,
} from "./modelsInfo";
import {
  pdfLinkRegex,
  roamImageRegex,
  roamVideoRegex,
  youtubeRegex,
  roamAudioRegex,
  urlRegex,
} from "../utils/regex";
import { AppToaster, displayThinkingToast } from "../components/Toaster";
import { GoogleGenAI } from "@google/genai";
import {
  addImagesToGeminiMessage,
  addImagesUrlToMessages,
  addPdfToGeminiMessage,
  addPdfUrlToMessages,
  addVideosToGeminiMessage,
  addAudioToGeminiMessage,
  isModelSupportingImage,
} from "./multimodalAI";

export function initializeOpenAIAPI(API_KEY, baseURL) {
  try {
    const clientSetting = {
      dangerouslyAllowBrowser: true,
      apiKey: API_KEY,
    };
    if (baseURL) {
      clientSetting.baseURL = baseURL;
      if (baseURL === "https://openrouter.ai/api/v1")
        clientSetting.defaultHeaders = {
          "HTTP-Referer":
            "https://github.com/fbgallet/roam-extension-speech-to-roam", // Optional, for including your app on openrouter.ai rankings.
          "X-Title": "Live AI for Roam Research", // Optional. Shows in rankings on openrouter.ai.
        };
    }
    const openai = new OpenAI(clientSetting);
    return openai;
  } catch (error) {
    console.log(error.message);
    AppToaster.show({
      message: `Live AI - Error during the initialization of OpenAI API: ${error.message}`,
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
      message: `Live AI - Error during the initialization of Anthropic API: ${error.message}`,
    });
  }
}

export function initializeGoogleAPI(apiKey) {
  try {
    const gemini = new GoogleGenAI({ apiKey });
    return gemini;
  } catch (error) {
    console.log("Error at initialization stage");
    console.log(error.message);
    AppToaster.show({
      message: `Live AI - Error during the initialization of Gemini API: ${error.message}`,
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
    tokensLimit: 128000,
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
    llm.tokensLimit = openRouterInfos?.contextLength * 1024 || 128000;
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
  } else if (model.includes("custom")) {
    llm.provider = "custom";
    llm.prefix = "custom/";
    llm.id =
      prefix === "custom"
        ? model.replace("custom/", "")
        : openAiCustomModels.length
        ? openAiCustomModels[0]
        : undefined;
    llm.library = customOpenaiLibrary;
  } else if (model.slice(0, 6) === "claude") {
    llm.provider = "Anthropic";
    llm.id = normalizeClaudeModel(model);
    llm.name = normalizeClaudeModel(model, true);
    llm.library = anthropicLibrary;
    if (model.includes("thinking")) {
      llm.thinking = true;
    }
  } else if (model.includes("deepseek")) {
    llm.provider = "DeepSeek";
    model = model.replace("v3.1", "v3.2");
    if (model === "deepseek-v3.2 thinking" || model === "deepseek-reasoner") {
      llm.id = "deepseek-reasoner";
      llm.name = "DeepSeek-V3.2 Thinking";
      llm.thinking = true;
    } else {
      llm.id = "deepseek-chat";
      llm.name = "DeepSeek-V3.2";
    }
    llm.library = deepseekLibrary;
  } else if (model.includes("grok")) {
    llm.provider = "Grok";
    if (
      model === "grok-2-vision" ||
      model === "grok-2 vision" ||
      model === "grok-2-vision-1212"
    ) {
      llm.id = "grok-2-vision-1212";
      llm.name = "Grok-2-vision";
    } else {
      llm.id = model;
      llm.web = true;
      llm.name = model.charAt(0).toUpperCase() + model.slice(1);
      if (
        model.includes("grok-3-mini") ||
        model === "grok-4" ||
        model === "grok-4-1-fast-reasoning"
      ) {
        llm.thinking = true;
      }
    }
    llm.library = grokLibrary;
  } else if (model.includes("gemini")) {
    llm.provider = "Google";
    llm.id = model;
    llm.name = model;
    llm.library = googleLibrary;
    if (model.includes("gemini-3")) llm.thinking = true;
  } else {
    llm.provider = "OpenAI";
    if (
      model.startsWith("o") ||
      (model.includes("gpt-5") &&
        !model.includes("chat") &&
        !model.includes("search") &&
        model !== "gpt-5.1")
    ) {
      llm.thinking = true;
    }
    if (model.includes("search")) {
      llm.web = true;
      llm.id = model;
      llm.name = model;
      if (model.includes("-preview")) {
        llm.name = model.replace("-preview", "");
      } else if (!model.includes("gpt-5")) {
        llm.id = model + "-preview";
      }
    } else if (model === "gpt-5.1 reasoning") {
      llm.id = "gpt-5.1";
      llm.name = "gpt-5.1 reasoning";
    } else llm.id = model || "gpt-4.1-mini";
    llm.library = openaiLibrary;
  }
  if (!llm.name) llm.name = llm.id;
  if (llm.provider !== "openRouter") {
    if (tokensLimit[llm.id]) llm.tokensLimit = tokensLimit[llm.id];
  }
  if (!llm.id) {
    AppToaster.show({
      message: `No model available in the settings for the current provider: ${llm.provider}.`,
      timeout: 15000,
    });
    return null;
  }
  // console.log("Used LLM id :>> ", llm.id);
  isAPIKeyNeeded(llm);

  return llm;
}

export function isAPIKeyNeeded(llm) {
  if (
    llm.provider !== "ollama" &&
    !llm.library?.apiKey &&
    !(llm.provider === "OpenAI" && customBaseURL) &&
    !llm.provider === "custom"
  ) {
    AppToaster.show({
      message: `Provide an API key to use ${
        llm.name || "an AI"
      } model. See doc and settings.`,
      timeout: 15000,
    });
    return true;
  }
  return false;
}

export async function claudeCompletion({
  model,
  prompt,
  provider,
  command,
  systemPrompt,
  content = "",
  responseFormat,
  targetUid,
  isButtonToInsert = true,
  thinking,
  tools,
  includePdfInContext = false,
}) {
  if (ANTHROPIC_API_KEY) {
    model = normalizeClaudeModel(model);

    try {
      let messages =
        command === "Web search"
          ? [
              {
                role: "user",
                content:
                  (systemPrompt ? systemPrompt + "\n\n" : "") +
                  "Prompt for the web search tool: " +
                  prompt[0].content +
                  (content ? "\n\nContext:\n" + content : ""),
              },
            ]
          : [
              {
                role: "user",
                content: (systemPrompt ? systemPrompt + "\n\n" : "") + content,
              },
            ].concat(prompt);
      let thinkingToaster;
      const headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",

        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
      };
      const options = {
        max_tokens:
          model.includes("sonnet") ||
          model.includes("4-5") ||
          model.includes("4.5")
            ? 64000
            : model.includes("opus")
            ? 32000
            : 8192,
        model: thinking ? model.replace("+thinking", "") : model,
        messages,
      };
      if (modelTemperature !== null) options.temperature = modelTemperature;
      if (streamResponse && responseFormat === "text") options.stream = true;

      let isUrlToFetch;
      if (command === "Fetch url" || urlRegex.test(JSON.stringify(prompt))) {
        options.tools = [
          {
            type: "web_fetch_20250910",
            name: "web_fetch",
            max_uses: 5,
            citations: { enabled: command === "Fetch url" ? false : true },
          },
        ];
        isUrlToFetch = true;
        headers["anthropic-beta"] = "web-fetch-2025-09-10";
      }
      if (command === "Fetch url") options.stream = false;

      if (command === "Web search") {
        options.tools = [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 5,
          },
          {
            type: "web_fetch_20250910",
            name: "web_fetch",
            max_uses: 5,
            citations: { enabled: true },
          },
        ];
        headers["anthropic-beta"] = "web-fetch-2025-09-10";
      } else if (command === "MCP Agent") {
        options.tools = tools;
      }

      if (thinking) {
        options.thinking = {
          type: "enabled",
          budget_tokens:
            reasoningEffort === "minimal"
              ? 1024
              : reasoningEffort === "low"
              ? 2500
              : reasoningEffort === "medium"
              ? 4096
              : 8000,
        };
      }
      const usage = {
        input_tokens: 0,
        output_tokens: 0,
      };

      // No data is stored on the server or displayed in any log
      // const { data } = await axios.post(
      //   "https://site--ai-api-back--2bhrm4wg9nqn.code.run/anthropic/message",
      //   options
      // );
      // See server code here: https://github.com/fbgallet/ai-api-back

      if (!isUrlToFetch && isModelSupportingImage(model)) {
        if (
          pdfLinkRegex.test(JSON.stringify(prompt)) ||
          (includePdfInContext && pdfLinkRegex.test(content))
        ) {
          options.messages = await addPdfUrlToMessages(
            messages,
            includePdfInContext ? content : "",
            provider
          );
        } else
          options.messages = await addImagesUrlToMessages(
            messages,
            content,
            true
          );
      }
      console.log("options :>> ", options);

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify(options),
      });

      // handle streamed responses (not working from client-side)
      let respStr = "";
      // console.log("response :>> ", response);

      if (options.stream && streamResponse && responseFormat === "text") {
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
        if (thinking) {
          thinkingToasterStream = displayThinkingToast(
            "Sonnet 4 Extended Thinking process:"
          );
        }

        let citations = [];
        let lastCitationIndex = -1;

        try {
          while (true) {
            if (isCanceledStreamGlobal) {
              streamElt.innerHTML += DOMPurify.sanitize(
                "(⚠️ stream interrupted by user)"
              );
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
                    streamElt.innerHTML += DOMPurify.sanitize(text);
                  } else if (data.delta?.type === "thinking_delta") {
                    if (thinkingToasterStream)
                      thinkingToasterStream.innerText += data.delta.thinking;
                  } else if (data.delta?.type === "citations_delta") {
                    if (data.delta?.citation) {
                      if (
                        !citations.find(
                          (cit) => cit.url === data.delta.citation.url
                        )
                      ) {
                        citations.push(data.delta.citation);
                      }
                    }
                    // streamElt.innerHTML += source;
                  }
                } else if (data.type === "message_start") {
                  usage["input_tokens"] =
                    data.message?.usage["input_tokens"] || 0;
                } else if (data.type === "message_delta" && data.usage) {
                  console.log("data.usage :>> ", data.usage);
                  if (data.usage.server_tool_use?.web_search_requests)
                    usage["input_tokens"] = data.usage["input_tokens"] || 0;
                  usage["output_tokens"] = data.usage["output_tokens"] || 0;
                }
                // TO EDIT: inline links are not properly inserted
                else if (data.type === "content_block_stop") {
                  if (citations.length - 1 > lastCitationIndex) {
                    const cit =
                      citations.length && citations[++lastCitationIndex];
                    const src = cit.cited_text
                      ? ` \n  - > "${cit.cited_text.replaceAll("\n", " ")}"`
                      : ` ([source](${cit.url}))`;
                    respStr = respStr.trim() + src;
                  }
                }
              }
            }
          }
        } catch (e) {
          console.log("Error during stream response: ", e);
          AppToaster.show({
            message: (
              <>
                <h4>Claude Web Search error, try again!</h4>
                <p>{e}</p>
              </>
            ),
            timeout: 15000,
          });
          return "";
        } finally {
          // console.log("citations :>> ", citations);
          if (citations.length && citations.find((cit) => cit.url)) {
            respStr += "\n\nWeb sources:\n";
            citations.forEach((cit) => {
              respStr += `  - [${cit.title}](${cit.url})\n`;
              // + `    - > ${cit.cited_text}\n`  // text citation...
            });
          }
          streamEltCopy = DOMPurify.sanitize(streamElt.innerHTML);
          if (isCanceledStreamGlobal)
            console.warn("Anthropic API response stream interrupted.");
          else streamElt.remove();
        }
      } else {
        const data = await response.json();
        // console.log("data :>> ", data);
        if (command === "Fetch url") {
          let fetchedData = data.content.find(
            (res) => res.type === "web_fetch_tool_result"
          );
          if (fetchedData) {
            if (fetchedData.content.error_code) {
              respStr =
                "⚠️ Error: " +
                fetchedData.content.error_code +
                "\n" +
                (data.content.at(-1).text || "");
            } else
              respStr =
                "### " +
                fetchedData.content.content.title +
                "\n" +
                fetchedData.content.content.source.data;
          } else return "No data to fetch from url";
        } else respStr = data.content[0].text;
        if (data.usage) {
          usage["input_tokens"] = data.usage["input_tokens"];
          usage["output_tokens"] = data.usage["output_tokens"];
        }
      }
      let jsonOnly;
      if (responseFormat !== "text") {
        // console.log("respStr :>> ", respStr);
        jsonOnly = trimOutsideOuterBraces(respStr);
        jsonOnly = sanitizeJSONstring(jsonOnly);
      }

      console.log(`Tokens usage (${model}):>> `, usage);
      updateTokenCounter(model, usage);

      // console.log("respStr :>> ", respStr);

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
      return "There is an error. Please try again, Anthropic’s web search is sometimes overloaded.";
    }
  }
}

export async function openaiCompletion({
  aiClient,
  model,
  provider,
  systemPrompt,
  prompt,
  command,
  content,
  responseFormat = "text",
  targetUid,
  thinking,
  isButtonToInsert,
  includePdfInContext = false,
}) {
  let respStr = "";
  let usage = {};
  let withPdf = false;
  let messages = [
    {
      role:
        model.startsWith("o1") || model === "o3" || model.startsWith("o4")
          ? "user"
          : model === "o3-pro"
          ? "developer"
          : "system",
      content: systemPrompt + (content ? "\n\n" + content : ""),
    },
  ].concat(prompt);

  if (isModelSupportingImage(model)) {
    if (
      pdfLinkRegex.test(JSON.stringify(prompt)) ||
      (includePdfInContext && pdfLinkRegex.test(content))
    ) {
      withPdf = true;
      messages = await addPdfUrlToMessages(
        messages,
        includePdfInContext ? content : "",
        provider
      );
    } else messages = await addImagesUrlToMessages(messages, content);
  }

  // console.log("Messages sent as prompt to the model:", messages);

  const isToStream =
    model.startsWith("o1") || model === "o3-pro"
      ? false
      : streamResponse && responseFormat === "text";
  try {
    let response;
    const options = {
      model: model,
      stream: isToStream,
    };
    if (model === "o3-pro" || (withPdf && provider !== "openRouter")) {
      options.input = messages;
      options["text"] = { format: { type: responseFormat } };
      options.stream = model === "o3-pro" ? false : streamResponse;
    } else {
      options.messages = messages;
      options["response_format"] =
        // Fixing current issue with LM studio not supporting "text" response_format...
        (aiClient.baseURL === "http://127.0.0.1:1234/v1" ||
          aiClient.baseURL === "http://localhost:1234/v1") &&
        responseFormat === "text"
          ? undefined
          : { type: responseFormat };
      isToStream && (options["stream_options"] = { include_usage: true });
    }
    console.log("model :>> ", model);

    if (
      model.includes("o3") ||
      model.includes("o4") ||
      (model.includes("gpt-5") && thinking)
    ) {
      if (withPdf) options["reasoning"] = { effort: reasoningEffort };
      else options["reasoning_effort"] = reasoningEffort;
    }
    if (modelTemperature !== null) options.temperature = modelTemperature * 2.0;
    // maximum temperature with OpenAI models regularly produces aberrations.
    if (
      options.temperature > 1.2 &&
      (model.includes("gpt") || model.includes("o1") || model.includes("o3"))
    )
      options.temperature = 1.3;

    // search_context_size seems deprecated
    // if (model.includes("-search-preview") || model.includes("-search-api"))
    //   options.web_search_options = {
    //     search_context_size: websearchContext,
    //   };

    if (model.includes("grok")) {
      options["search_parameters"] = {
        mode: command === "Web search" ? "on" : "auto",
        return_citations: true,
      };
      if (model.includes("grok-3-mini") && !model.includes("high")) {
        options["reasoning_effort"] =
          reasoningEffort === "high" ? "high" : "low";
      }
    }

    console.log("options :>> ", options);

    if (!isSafari && model !== "o3-pro" && !withPdf) {
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
      response =
        model === "o3-pro" || (withPdf && provider !== "openRouter")
          ? await aiClient.responses.create(options)
          : await aiClient.chat.completions.create(options);
    }
    let streamEltCopy = "";
    let annotations;

    // console.log("OpenAI response :>>", response);

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
      if (
        model === "deepseek-reasoner" ||
        model.includes("grok-3-mini") ||
        model === "grok-4" ||
        model === "grok-4-1-fast-reasoning"
      ) {
        thinkingToasterStream = displayThinkingToast("Thinking process:");
      }

      try {
        let chunkStr = "";
        for await (const chunk of response) {
          if (isCanceledStreamGlobal) {
            streamElt.innerHTML += "(⚠️ stream interrupted by user)";
            // respStr = "";
            break;
          }
          // console.log("chunk :>> ", chunk);
          let streamData;
          if (!chunk.choices?.length && model === "o3-pro" && chunk.output_text)
            streamData = chunk.output_text;
          else if (withPdf && chunk.delta) streamData = chunk;
          else streamData = chunk.choices?.length ? chunk.choices[0] : null;

          chunkStr =
            typeof streamData?.delta === "string"
              ? streamData?.delta
              : streamData?.delta?.content || "";
          if (
            streamData?.delta?.reasoning_content &&
            (model === "deepseek-reasoner" ||
              model.includes("grok-3-mini") ||
              model === "grok-4" ||
              model === "grok-4-1-fast-reasoning")
          )
            thinkingToasterStream.innerText +=
              streamData?.delta?.reasoning_content;
          respStr += chunkStr;
          streamElt.innerHTML += DOMPurify.sanitize(chunkStr);
          if (streamData?.delta?.annotations)
            annotations = streamData.delta.annotations;
          if (chunk.usage || chunk.response?.usage) {
            usage = chunk.usage || chunk.response?.usage;
            if (chunk.citations) console.log(chunk.citations);
          }
          if (chunk.x_groq?.usage) usage = chunk.x_groq.usage;
          // console.log(chunk);
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
    if (
      !isToStream &&
      model !== "o3-pro" &&
      !withPdf &&
      response.choices[0].message.annotations?.length
    )
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
      input_tokens: usage.prompt_tokens || usage.input_tokens,
      output_tokens: usage.completion_tokens || usage.output_tokens,
    });
    console.log(respStr);
    return model === "o3-pro" || (withPdf && !isToStream)
      ? response.output_text
      : isToStream
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

/**
 * Add inline citations to response text from Google Search grounding metadata
 * Based on the groundingSupports and groundingChunks fields
 *
 * Citations are placed in parentheses at the end of sentences or paragraphs
 * for better readability and following proper citation conventions.
 *
 * @param {object} response - The Gemini API response object
 * @returns {string} - Text with inline citations and sources section
 */
function addGroundingCitations(response) {
  if (!response.candidates || !response.candidates[0]) {
    return response.text || "";
  }

  const candidate = response.candidates[0];
  const groundingMetadata = candidate.groundingMetadata;

  // If no grounding metadata, return original text
  if (
    !groundingMetadata ||
    !groundingMetadata.groundingSupports ||
    !groundingMetadata.groundingChunks
  ) {
    return response.text || "";
  }

  let text = response.text || "";
  const supports = groundingMetadata.groundingSupports;
  const chunks = groundingMetadata.groundingChunks;

  /**
   * Find the nearest sentence or paragraph boundary after a given position
   * @param {string} text - The text to search
   * @param {number} position - Starting position
   * @returns {number} - Position of the nearest boundary
   */
  const findNearestBoundary = (text, position) => {
    // Don't go beyond the end of text
    if (position >= text.length) return text.length;

    // Look for sentence-ending punctuation (.!?) followed by space/newline/end
    // Also look for paragraph breaks (double newlines)
    const afterPos = text.slice(position);

    // First, check if we're already at or very close to a boundary
    const immediateMatch = afterPos.match(/^[.!?]\s/);
    if (immediateMatch) {
      return position + immediateMatch[0].length - 1; // Before the space
    }

    // Look for the next sentence ending
    const sentenceMatch = afterPos.match(/[.!?](?=\s|$)/);

    // Look for the next paragraph break (double newline)
    const paragraphMatch = afterPos.match(/\n\n/);

    // Choose the closest boundary
    let nearestPos = text.length;

    if (sentenceMatch && sentenceMatch.index !== undefined) {
      nearestPos = Math.min(nearestPos, position + sentenceMatch.index + 1);
    }

    if (paragraphMatch && paragraphMatch.index !== undefined) {
      nearestPos = Math.min(nearestPos, position + paragraphMatch.index);
    }

    return nearestPos;
  };

  // Group supports by their boundary positions to avoid duplicate citations
  const citationsByBoundary = new Map();

  for (const support of supports) {
    const endIndex = support.segment?.endIndex;
    if (endIndex === undefined || !support.groundingChunkIndices?.length) {
      continue;
    }

    // Find the appropriate boundary for this citation
    const boundary = findNearestBoundary(text, endIndex);

    // Get citation numbers for this support
    const citationNumbers = support.groundingChunkIndices.map((i) => i + 1);

    // Add to the set of citations for this boundary
    if (!citationsByBoundary.has(boundary)) {
      citationsByBoundary.set(boundary, new Set());
    }
    citationNumbers.forEach((num) => citationsByBoundary.get(boundary).add(num));
  }

  // Sort boundaries in descending order to avoid shifting issues when inserting
  const sortedBoundaries = Array.from(citationsByBoundary.keys()).sort(
    (a, b) => b - a
  );

  // Insert citations at boundaries
  for (const boundary of sortedBoundaries) {
    const citationNumbers = Array.from(citationsByBoundary.get(boundary)).sort(
      (a, b) => a - b
    );

    // Format as numbered citations in parentheses
    const citationString = ` ([${citationNumbers.join(", ")}])`;

    text = text.slice(0, boundary) + citationString + text.slice(boundary);
  }

  // Add sources section at the end
  const sources = chunks
    .map((chunk, index) => {
      const uri = chunk?.web?.uri;
      const title = chunk?.web?.title || `Source ${index + 1}`;
      if (uri) {
        return `${index + 1}. [${title}](${uri})`;
      }
      return null;
    })
    .filter(Boolean);

  if (sources.length > 0) {
    text += "\n\n---\n\n**Sources:**\n" + sources.join("\n");
  }

  // Log search queries for debugging
  if (
    groundingMetadata.webSearchQueries &&
    groundingMetadata.webSearchQueries.length > 0
  ) {
    console.log(
      "🔍 Google Search queries used:",
      groundingMetadata.webSearchQueries
    );
  }

  return text;
}

export async function googleCompletion({
  aiClient,
  model,
  systemPrompt,
  prompt,
  command,
  content,
  responseFormat = "text",
  targetUid,
  isButtonToInsert,
  includePdfInContext = false,
}) {
  let respStr = "";
  let usage = {};

  try {
    // Detect if PDFs, images, videos, or audio are present
    roamVideoRegex.lastIndex = 0;
    youtubeRegex.lastIndex = 0;
    roamAudioRegex.lastIndex = 0;
    roamImageRegex.lastIndex = 0;
    pdfLinkRegex.lastIndex = 0;
    const hasPdfInPrompt = pdfLinkRegex.test(JSON.stringify(prompt));
    const hasPdfInContent = includePdfInContext && pdfLinkRegex.test(content);
    const hasImageInPrompt = roamImageRegex.test(JSON.stringify(prompt));
    const hasImageInContent = roamImageRegex.test(content);
    const hasVideoInPrompt =
      roamVideoRegex.test(JSON.stringify(prompt)) ||
      youtubeRegex.test(JSON.stringify(prompt));
    const hasVideoInContent =
      prompt.includes("video") &&
      (roamVideoRegex.test(content) || youtubeRegex.test(content));
    const hasAudioInPrompt = roamAudioRegex.test(JSON.stringify(prompt));
    const hasAudioInContent =
      prompt.includes("audio") && roamAudioRegex.test(content);

    // Prepare system instruction and history in Google's format
    const history = [];
    let systemInstruction = systemPrompt + (content ? "\n\n" + content : "");

    // Add video instructions if videos are detected
    if (hasVideoInPrompt || hasVideoInContent) {
      const videoInstructions = `\n\nIMPORTANT VIDEO INSTRUCTIONS:
1. When providing timestamps for specific moments from videos you are analyzing, always use Roam's timestamp format: '{{[[video-timestamp]]: ((${
        targetUid || "video-block-uid"
      })) hh:mm:ss}}'. This creates clickable timestamps. For example: {{[[video-timestamp]]: ((${
        targetUid || "block-uid"
      })) 00:02:35}} to reference 2 minutes and 35 seconds into the video.

2. Note: If the user specified "start:" or "end:" keywords in their prompt (e.g., "start: 1:30" or "end: 120"), you are analyzing only that specific segment of the video, not the entire video. Adjust your analysis and timestamps accordingly.`;
      systemInstruction += videoInstructions;
    }

    // Add audio instructions if audio files are detected
    if (hasAudioInPrompt || hasAudioInContent) {
      const audioInstructions = `\n\nIMPORTANT AUDIO INSTRUCTIONS:
1. You are analyzing audio content. If the user doesn't give any specific instructions, just provide a transcription; otherwise, analyze the audio content according to their instructions.
2. When transcribing, structure the output with proper paragraphs based on natural speech breaks, topic changes, or speaker changes. DO NOT output a single monolithic block of text. Insert line breaks between distinct ideas or topics to improve readability. If multiple speakers are detected, indicate speaker changes (try to name them properly or follow the user indication if provided). Give timestamps for the key moments.
3. If the user specified "start:" or "end:" keywords in their prompt (e.g., "start: 1:30" or "end: 120"), you are analyzing only that specific segment of the audio, not the entire file. Adjust your transcription and analysis accordingly.
4. When referencing specific moments in the audio, use standard timestamp format (MM:SS or HH:MM:SS).`;
      systemInstruction += audioInstructions;
    }

    let currentMessage = "";
    let currentMessageParts = [];

    // Convert prompt array to Google's chat history format
    for (let i = 0; i < prompt.length; i++) {
      const msg = prompt[i];
      if (msg.role === "assistant" || msg.role === "model") {
        history.push({
          role: "model",
          parts: [{ text: msg.content }],
        });
      } else if (msg.role === "user") {
        if (i === prompt.length - 1) {
          // Last user message is the current message to send
          currentMessage = msg.content;
          currentMessageParts = [{ text: msg.content }];

          // Add PDFs from the last prompt message
          if (hasPdfInPrompt && pdfLinkRegex.test(msg.content)) {
            currentMessageParts = await addPdfToGeminiMessage(
              currentMessageParts,
              msg.content
            );
            // Remove PDF URLs from the text
            pdfLinkRegex.lastIndex = 0;
            currentMessageParts[0].text = currentMessageParts[0].text
              .replace(pdfLinkRegex, "")
              .trim();
          }

          // Add images from the last prompt message
          if (hasImageInPrompt && roamImageRegex.test(msg.content)) {
            currentMessageParts = await addImagesToGeminiMessage(
              currentMessageParts,
              msg.content
            );
            // Remove image markdown from the text
            roamImageRegex.lastIndex = 0;
            currentMessageParts[0].text = currentMessageParts[0].text
              .replace(roamImageRegex, "[Image]")
              .trim();
          }

          // Add videos from the last prompt message
          if (hasVideoInPrompt) {
            currentMessageParts = await addVideosToGeminiMessage(
              currentMessageParts,
              msg.content
            );
            // Remove video markdown from the text
            roamVideoRegex.lastIndex = 0;
            currentMessageParts[0].text = currentMessageParts[0].text
              .replace(roamVideoRegex, "[Video]")
              .trim();
          }

          // Add audio from the last prompt message
          if (hasAudioInPrompt) {
            currentMessageParts = await addAudioToGeminiMessage(
              currentMessageParts,
              msg.content
            );
            // Remove audio markdown from the text
            roamAudioRegex.lastIndex = 0;
            currentMessageParts[0].text = currentMessageParts[0].text
              .replace(roamAudioRegex, "[Audio]")
              .trim();
          }
        } else {
          let userParts = [{ text: msg.content }];

          // Add PDFs from history messages
          if (hasPdfInPrompt && pdfLinkRegex.test(msg.content)) {
            userParts = await addPdfToGeminiMessage(userParts, msg.content);
            // Remove PDF URLs from the text
            pdfLinkRegex.lastIndex = 0;
            userParts[0].text = userParts[0].text
              .replace(pdfLinkRegex, "")
              .trim();
          }

          // Add images from history messages
          if (hasImageInPrompt && roamImageRegex.test(msg.content)) {
            userParts = await addImagesToGeminiMessage(userParts, msg.content);
            // Remove image markdown from the text
            roamImageRegex.lastIndex = 0;
            userParts[0].text = userParts[0].text
              .replace(roamImageRegex, "[Image]")
              .trim();
          }

          // Add videos from history messages
          if (hasVideoInPrompt && roamVideoRegex.test(msg.content)) {
            userParts = await addVideosToGeminiMessage(userParts, msg.content);
            // Remove video markdown from the text
            roamVideoRegex.lastIndex = 0;
            userParts[0].text = userParts[0].text
              .replace(roamVideoRegex, "[Video]")
              .trim();
          }

          // Add audio from history messages
          if (hasAudioInPrompt && roamAudioRegex.test(msg.content)) {
            userParts = await addAudioToGeminiMessage(userParts, msg.content);
            // Remove audio markdown from the text
            roamAudioRegex.lastIndex = 0;
            userParts[0].text = userParts[0].text
              .replace(roamAudioRegex, "[Audio]")
              .trim();
          }

          history.push({
            role: "user",
            parts: userParts,
          });
        }
      }
    }

    // Add PDFs from context if enabled
    if (hasPdfInContent) {
      currentMessageParts = await addPdfToGeminiMessage(
        currentMessageParts,
        content
      );
    }

    // Add images from context
    if (hasImageInContent) {
      currentMessageParts = await addImagesToGeminiMessage(
        currentMessageParts,
        content
      );
    }

    // Add videos from context
    if (hasVideoInContent) {
      currentMessageParts = await addVideosToGeminiMessage(
        currentMessageParts,
        content
      );
    }

    // Add audio from context
    if (hasAudioInContent) {
      currentMessageParts = await addAudioToGeminiMessage(
        currentMessageParts,
        content
      );
    }

    // Disable streaming for Web search to ensure proper grounding metadata processing
    const isToStream =
      streamResponse && responseFormat === "text" && command !== "Web search";

    const generationConfig = {};
    if (responseFormat === "json_object") {
      generationConfig.responseMimeType = "application/json";
    }
    if (modelTemperature !== null && !model.includes("gemini-3")) {
      generationConfig.temperature = modelTemperature;
    }

    if (model.includes("gemini-3")) {
      // generationConfig["thinking-level"] =

      generationConfig["thinkingConfig"] = {
        thinkingLevel: reasoningEffort === "minimal" ? "low" : reasoningEffort,
        includeThoughts: true,
      };
    }

    // Add Google Search grounding tool for Web search command
    const toolsConfig = [];
    if (command === "Web search") {
      toolsConfig.push({ googleSearch: {} });
    }

    // Create chat configuration
    const chatConfig = {
      model: model,
      config: {
        ...generationConfig,
        ...(toolsConfig.length > 0 && { tools: toolsConfig }),
      },
    };

    // Add system instruction if provided
    if (systemInstruction) {
      chatConfig.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    // Add history if exists
    if (history.length > 0) {
      chatConfig.history = history;
    }

    // console.log("Gemini chatConfig :>> ", chatConfig);

    // Create chat instance
    const chat = aiClient.chats.create(chatConfig);

    // Prepare the message to send (use parts format if PDFs, images, videos, or audio are present)
    const messageToSend =
      hasPdfInPrompt ||
      hasPdfInContent ||
      hasImageInPrompt ||
      hasImageInContent ||
      hasVideoInPrompt ||
      hasVideoInContent ||
      hasAudioInPrompt ||
      hasAudioInContent
        ? { message: currentMessageParts }
        : { message: currentMessage };

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
      if (model.includes("gemini-3")) {
        thinkingToasterStream = displayThinkingToast("Thinking process:");
      }

      try {
        const streamResponse = await chat.sendMessageStream(messageToSend);

        for await (const chunk of streamResponse) {
          if (isCanceledStreamGlobal) {
            streamElt.innerHTML += "(⚠️ stream interrupted by user)";
            break;
          }
          for (const part of chunk.candidates[0].content.parts) {
            if (!part.text) {
              continue;
            } else if (part.thought) {
              thinkingToasterStream.innerText += part.text;
            } else {
              const chunkText = part.text || "";
              respStr += chunkText;
              streamElt.innerHTML += DOMPurify.sanitize(chunkText);

              // Capture usage metadata if available in chunks
              if (chunk.usageMetadata) {
                usage = {
                  input_tokens: chunk.usageMetadata.promptTokenCount || 0,
                  output_tokens: chunk.usageMetadata.candidatesTokenCount || 0,
                };
              }
            }
          }
        }
      } catch (e) {
        console.log("Error during Google stream response: ", e);
        console.log(respStr);
        return "";
      } finally {
        if (isCanceledStreamGlobal)
          console.log("Google response stream interrupted.");
        else streamElt.remove();
      }
    } else {
      const response = await chat.sendMessage(messageToSend);
      // console.log("Google response :>>", response);

      // Process grounding citations if Web search was used
      if (command === "Web search") {
        respStr = addGroundingCitations(response);
      } else {
        respStr = response.text || "";
      }

      if (response.usageMetadata) {
        usage = {
          input_tokens: response.usageMetadata.promptTokenCount || 0,
          output_tokens: response.usageMetadata.candidatesTokenCount || 0,
        };
      }
    }

    console.log(`Tokens usage (${model}):>> `, usage);

    if (usage.input_tokens || usage.output_tokens) {
      updateTokenCounter(model, usage);
    }

    // console.log(respStr);
    return respStr;
  } catch (error) {
    console.error(error);

    // Check if it's a 403 error related to video access
    if (
      error.message?.includes("403") ||
      error.message?.includes("PERMISSION_DENIED")
    ) {
      AppToaster.show({
        message: (
          <>
            <h4>Video Access Error</h4>
            <p>
              The YouTube video cannot be analyzed because it's either private,
              restricted, or not allowed for AI analysis. Please ensure the
              video is public and allows embedding.
            </p>
          </>
        ),
        timeout: 15000,
      });
      return "⚠️ Unable to analyze the video: The video is either private, restricted, or not allowed for AI analysis. Please check the video permissions.";
    }

    AppToaster.show({
      message: `Google AI error msg: ${error.message}`,
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

// export const getTokenizer = async () => {
//   try {
//     const { data } = await axios.get(
//       "https://tiktoken.pages.dev/js/cl100k_base.json"
//     );
//     return new Tiktoken(data);
//   } catch (error) {
//     console.log("Fetching tiktoken rank error:>> ", error);
//     return null;
//   }
// };

// export let tokenizer = await getTokenizer();

// export const verifyTokenLimitAndTruncate = async (model, prompt, content) => {
//   // console.log("tokensLimit object :>> ", tokensLimit);
//   if (!tokenizer) {
//     tokenizer = await getTokenizer();
//   }
//   if (!tokenizer) return content;
//   const tokens = tokenizer.encode(prompt + content);
//   console.log("context tokens :", tokens.length);

//   const limit = tokensLimit[model];
//   if (!limit) {
//     console.log("No context length provided for this model.");
//     return content;
//   }

//   if (tokens.length > limit) {
//     AppToaster.show({
//       message: `The token limit (${limit}) has been exceeded (${tokens.length} needed), the context will be truncated to fit ${model} token window.`,
//     });
//     // 1% margin of error
//     const ratio = limit / tokens.length - 0.01;
//     content = content.slice(0, content.length * ratio);
//     console.log(
//       "tokens of truncated context:",
//       tokenizer.encode(prompt + content).length
//     );
//   }
//   return content;
// };

export const estimateContextTokens = (context) => {
  // Tokenizer is too slow for quick estimation of big context
  // if (!tokenizer) {
  //   tokenizer = await getTokenizer();
  // }
  // let tokens = tokenizer && tokenizer.encode(context);

  const estimation = context.length * 0.3;

  return estimation.toFixed(0);
};

export const estimateTokensPricing = (model, tokens) => {
  const llm = modelAccordingToProvider(model);
  const inputPricing =
    modelsPricing[llm.id]?.input || openRouterModelPricing(llm.id, "input");
  // console.log("inputPricing :>> ", inputPricing);
  if (!inputPricing) return null;
  const estimation = (inputPricing * tokens) / 1000000;
  // console.log("estimation :>> ", estimation);

  return estimation.toFixed(3);
};
