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
  isThinkingProcessToDisplay,
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
  getModelByIdentifier,
  getMaxOutput,
  supportsStreaming,
  getSystemRole,
  useCompletionApi,
  getTemperatureConfig,
  isThinkingModel,
  usesAdaptiveThinking,
} from "./modelRegistry";
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
import { completionCommands } from "./prompts";

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
    gemini.apiKey = apiKey;
    return gemini;
  } catch (error) {
    console.log("Error at initialization stage");
    console.log(error.message);
    AppToaster.show({
      message: `Live AI - Error during the initialization of Gemini API: ${error.message}`,
    });
  }
}

/**
 * Get model information based on model identifier
 * Uses MODEL_REGISTRY for pre-defined models, handles dynamic providers separately
 *
 * @param {string} model - Model identifier (name, ID, or prefixed ID)
 * @param {boolean} thinkingEnabled - Whether thinking mode is enabled (optional)
 * @returns {Object|null} LLM configuration object
 */
export function modelAccordingToProvider(model, thinkingEnabled = undefined) {
  const llm = {
    provider: "",
    prefix: "",
    id: "",
    name: "",
    library: undefined,
    tokensLimit: 128000,
  };

  if (!model) {
    llm.provider = "OpenAI";
    llm.id = "gpt-4.1-mini";
    llm.name = "gpt-4.1-mini";
    llm.library = openaiLibrary;
    isAPIKeyNeeded(llm);
    return llm;
  }

  const modelLower = model.toLowerCase();
  const prefix = modelLower.split("/")[0];

  // ==================== HANDLE PREFIXED/DYNAMIC PROVIDERS ====================
  // These need special handling as they're not in the static registry

  // Custom provider models (e.g., anthropic/custom/model-name)
  if (modelLower.startsWith("anthropic/custom/")) {
    llm.provider = "Anthropic";
    llm.prefix = "anthropic/custom/";
    llm.id = model.replace(/^anthropic\/custom\//i, "");
    llm.name = llm.id;
    llm.library = anthropicLibrary;
  } else if (modelLower.startsWith("google/custom/")) {
    llm.provider = "Google";
    llm.prefix = "google/custom/";
    llm.id = model.replace(/^google\/custom\//i, "");
    llm.name = llm.id;
    llm.library = googleLibrary;
  } else if (modelLower.startsWith("deepseek/custom/")) {
    llm.provider = "DeepSeek";
    llm.prefix = "deepseek/custom/";
    llm.id = model.replace(/^deepseek\/custom\//i, "");
    llm.name = llm.id;
    llm.library = deepseekLibrary;
  } else if (modelLower.startsWith("grok/custom/")) {
    llm.provider = "Grok";
    llm.prefix = "grok/custom/";
    llm.id = model.replace(/^grok\/custom\//i, "");
    llm.name = llm.id;
    llm.library = grokLibrary;
  }
  // OpenRouter models
  else if (modelLower.includes("openrouter")) {
    llm.provider = "openRouter";
    llm.prefix = "openRouter/";
    llm.id =
      prefix === "openrouter"
        ? modelLower.replace("openrouter/", "")
        : openRouterModels.length
          ? openRouterModels[0]
          : undefined;
    const openRouterInfos = openRouterModelsInfo.find((m) => m.id === llm.id);
    llm.tokensLimit = openRouterInfos?.contextLength * 1024 || 128000;
    llm.name = llm.id && openRouterInfos ? openRouterInfos.name : llm.id;
    llm.library = openrouterLibrary;
  }
  // Ollama models
  else if (modelLower.includes("ollama")) {
    llm.provider = "ollama";
    llm.prefix = "ollama/";
    llm.id =
      prefix === "ollama"
        ? modelLower.replace("ollama/", "")
        : ollamaModels.length
          ? ollamaModels[0]
          : undefined;
    llm.library = "ollama";
  }
  // Groq models
  else if (modelLower.includes("groq")) {
    llm.provider = "groq";
    llm.prefix = "groq/";
    llm.id =
      prefix === "groq"
        ? modelLower.replace("groq/", "")
        : groqModels.length
          ? groqModels[0]
          : undefined;
    llm.library = groqLibrary;
  }
  // Custom OpenAI-compatible models
  else if (modelLower.includes("custom")) {
    llm.provider = "custom";
    llm.prefix = "custom/";
    llm.id =
      prefix === "custom"
        ? modelLower.replace("custom/", "")
        : openAiCustomModels.length
          ? openAiCustomModels[0]
          : undefined;
    llm.library = customOpenaiLibrary;
  }
  // ==================== HANDLE REGISTRY-BASED MODELS ====================
  else {
    // Check for thinking mode suffix
    const hasThinking =
      modelLower.includes("+thinking") || modelLower.includes(" thinking");
    const baseModelName = modelLower
      .replace("+thinking", "")
      .replace(" thinking", "")
      .trim();

    // Try to find model in registry
    const registryEntry = getModelByIdentifier(baseModelName);

    if (registryEntry) {
      llm.provider = registryEntry.provider;
      llm.id = registryEntry.id;
      llm.name = registryEntry.name;
      llm.tokensLimit = registryEntry.contextLength || 128000;

      // Set thinking mode if requested and model supports it
      if (hasThinking && registryEntry.capabilities?.thinking) {
        llm.thinking = true;
      }

      // Set web search capability
      if (registryEntry.capabilities?.webSearch) {
        llm.web = true;
      }

      // Set library based on provider
      switch (registryEntry.provider) {
        case "OpenAI":
          llm.library = openaiLibrary;
          break;
        case "Anthropic":
          llm.library = anthropicLibrary;
          // For Claude, use normalized ID
          llm.id = normalizeClaudeModel(model);
          llm.name = normalizeClaudeModel(model, true);
          break;
        case "Google":
          llm.library = googleLibrary;
          break;
        case "DeepSeek":
          llm.library = deepseekLibrary;
          break;
        case "Grok":
          llm.library = grokLibrary;
          break;
      }
    }
    // ==================== FALLBACK LOGIC FOR UNREGISTERED MODELS ====================
    else {
      // Claude models
      if (modelLower.startsWith("claude")) {
        llm.provider = "Anthropic";
        llm.id = normalizeClaudeModel(model);
        llm.name = normalizeClaudeModel(model, true);
        llm.library = anthropicLibrary;
        if (hasThinking) {
          llm.thinking = true;
        }
      }
      // DeepSeek models
      else if (modelLower.includes("deepseek")) {
        llm.provider = "DeepSeek";
        const normalizedModel = modelLower.replace("v3.1", "v3.2");
        if (
          normalizedModel === "deepseek-v3.2 thinking" ||
          normalizedModel === "deepseek-reasoner"
        ) {
          llm.id = "deepseek-reasoner";
          llm.name = "DeepSeek-V3.2 Thinking";
          llm.thinking = true;
        } else {
          llm.id = "deepseek-chat";
          llm.name = "DeepSeek-V3.2";
        }
        llm.library = deepseekLibrary;
      }
      // Grok models
      else if (modelLower.includes("grok")) {
        llm.provider = "Grok";
        if (
          modelLower === "grok-2-vision" ||
          modelLower === "grok-2 vision" ||
          modelLower === "grok-2-vision-1212"
        ) {
          llm.id = "grok-2-vision-1212";
          llm.name = "Grok-2-vision";
        } else {
          llm.id = modelLower;
          llm.web = true;
          llm.name = model.charAt(0).toUpperCase() + model.slice(1);
          if (
            modelLower.includes("grok-3-mini") ||
            modelLower === "grok-4" ||
            modelLower === "grok-4-1-fast-reasoning"
          ) {
            llm.thinking = true;
          }
        }
        llm.library = grokLibrary;
      }
      // Gemini models
      else if (modelLower.includes("gemini")) {
        llm.provider = "Google";
        llm.id = modelLower;
        llm.name = modelLower;
        llm.library = googleLibrary;
        if (modelLower.includes("gemini-3")) llm.thinking = true;
      }
      // Default to OpenAI
      else {
        llm.provider = "OpenAI";
        llm.library = openaiLibrary;

        // Handle reasoning models
        if (
          modelLower.startsWith("o") ||
          (modelLower.includes("gpt-5") &&
            !modelLower.includes("chat") &&
            !modelLower.includes("search") &&
            modelLower !== "gpt-5.1")
        ) {
          llm.thinking = true;
        }

        // Handle search models
        if (modelLower.includes("search")) {
          llm.web = true;
          llm.id = modelLower;
          llm.name = modelLower;
          if (modelLower.includes("-preview")) {
            llm.name = modelLower.replace("-preview", "");
          } else if (!modelLower.includes("gpt-5")) {
            llm.id = modelLower + "-preview";
          }
        } else if (modelLower === "gpt-5.1 reasoning") {
          llm.id = "gpt-5.1";
          llm.name = "gpt-5.1 reasoning";
          llm.thinking = true;
        } else {
          llm.id = modelLower || "gpt-4.1-mini";
        }
      }
    }
  }

  // Finalize LLM object
  if (!llm.name) llm.name = llm.id;
  if (llm.provider !== "openRouter" && tokensLimit[llm.id]) {
    llm.tokensLimit = tokensLimit[llm.id];
  }

  if (!llm.id) {
    AppToaster.show({
      message: `No model available in the settings for the current provider: ${llm.provider}.`,
      timeout: 15000,
    });
    return null;
  }

  // Handle thinking mode if explicitly set
  if (thinkingEnabled !== undefined) {
    const { getApiModelId, hasThinkingDefault } = require("./modelRegistry");

    // Get the model's thinking default
    const modelThinkingDefault = hasThinkingDefault(model);

    // For models with thinkingDefault=true, thinking is always on
    const finalThinkingEnabled = modelThinkingDefault || thinkingEnabled;

    // Update the ID if the model has thinking ID suffix (e.g., Grok)
    llm.id = getApiModelId(model, finalThinkingEnabled);

    // Set the thinking flag in the llm object
    llm.thinking = finalThinkingEnabled;
  }

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
          : command === "Export to PDF" || command === "Export to PDF outline"
            ? [
                {
                  role: "user",
                  content:
                    (command === "Export to PDF outline"
                      ? completionCommands.pdfOutline
                      : completionCommands.pdfCleanDocument) +
                    // User-specific instructions from focused block (formatting, margins, etc.)
                    (prompt.length && prompt[0]?.content
                      ? "\n\nADDITIONAL USER INSTRUCTIONS:\n" +
                        prompt[0].content
                      : "") +
                    // Content to export (from context: page, linkedRefs, sidebar, etc.)
                    (content ? "\n\nCONTENT TO EXPORT:\n" + content : ""),
                },
              ]
            : [
                {
                  role: "user",
                  content:
                    (systemPrompt ? systemPrompt + "\n\n" : "") + content,
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
        max_tokens: getMaxOutput(model),
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
      } else if (
        command === "Export to PDF" ||
        command === "Export to PDF outline"
      ) {
        options.stream = false;
        options.tools = [
          { type: "code_execution_20250825", name: "code_execution" },
        ];
        options.container = {
          skills: [{ type: "anthropic", skill_id: "pdf", version: "latest" }],
        };
        headers["anthropic-beta"] =
          "code-execution-2025-08-25,skills-2025-10-02,files-api-2025-04-14";
      }

      if (thinking) {
        if (usesAdaptiveThinking(model)) {
          // Opus 4.6+: adaptive thinking with effort parameter
          options.thinking = { type: "adaptive" };
          options.output_config = {
            effort: reasoningEffort === "minimal" ? "low" : reasoningEffort,
          };
        } else {
          // Legacy Claude models: enabled thinking with budget_tokens
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
            provider,
          );
        } else
          options.messages = await addImagesUrlToMessages(
            messages,
            content,
            true,
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
        if (thinking && isThinkingProcessToDisplay) {
          thinkingToasterStream = displayThinkingToast(
            "Claude 4.5 Extended Thinking process:",
          );
        }

        let citations = [];
        let lastCitationIndex = -1;

        try {
          while (true) {
            if (isCanceledStreamGlobal) {
              streamElt.innerHTML += DOMPurify.sanitize(
                "(⚠️ stream interrupted by user)",
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
                          (cit) => cit.url === data.delta.citation.url,
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
            (res) => res.type === "web_fetch_tool_result",
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
        } else if (command === "Web search") {
          // Extract search results
          const searchResults = data.content.filter(
            (block) => block.type === "web_search_tool_result",
          );

          // Build response from text blocks and citations
          const textBlocks = data.content.filter(
            (block) => block.type === "text",
          );

          respStr = textBlocks.map((block) => block.text).join("");

          // Add search sources at the end
          if (searchResults.length > 0) {
            respStr += "\n\nWeb search sources:\n";
            const uniqueUrls = new Set();

            searchResults.forEach((result) => {
              if (result.content && Array.isArray(result.content)) {
                result.content.forEach((item) => {
                  if (
                    item.type === "web_search_result" &&
                    item.url &&
                    !uniqueUrls.has(item.url)
                  ) {
                    uniqueUrls.add(item.url);
                    respStr += `  - [${item.title}](${item.url})`;
                    if (item.page_age) {
                      respStr += ` (${item.page_age})`;
                    }
                    respStr += "\n";
                  }
                });
              }
            });
          }
        } else if (
          command === "Export to PDF" ||
          command === "Export to PDF outline"
        ) {
          AppToaster.show({
            message: "Generating PDF... This may take 30 seconds or more.",
            timeout: 60000,
            intent: "primary",
            icon: "document",
          });

          // Handle pause_turn: loop until stop_reason !== "pause_turn"
          let currentData = data;
          let currentMessages = [...options.messages];
          let containerId = currentData.container?.id;

          while (currentData.stop_reason === "pause_turn") {
            currentMessages.push({
              role: "assistant",
              content: currentData.content,
            });
            const continueResponse = await fetch(
              "https://api.anthropic.com/v1/messages",
              {
                method: "POST",
                headers,
                body: JSON.stringify({
                  ...options,
                  messages: currentMessages,
                  container: {
                    id: containerId,
                    skills: [
                      {
                        type: "anthropic",
                        skill_id: "pdf",
                        version: "latest",
                      },
                    ],
                  },
                }),
              },
            );
            currentData = await continueResponse.json();
            if (currentData.container?.id)
              containerId = currentData.container.id;
          }

          // Extract file info and text from response
          let pdfGenerated = false;
          let pdfFilename = "export.pdf";
          let textContent = "";
          for (const item of currentData.content) {
            if (item.type === "bash_code_execution_tool_result") {
              const result = item.content;
              if (
                result.type === "bash_code_execution_result" &&
                result.content
              ) {
                for (const file of result.content) {
                  if (file.file_id) {
                    pdfGenerated = true;
                    if (file.filename) pdfFilename = file.filename;
                  }
                }
              }
            } else if (item.type === "text") {
              textContent += item.text;
            }
          }

          if (pdfGenerated) {
            AppToaster.show({
              message: "PDF generated! Retrieving file...",
              timeout: 30000,
              intent: "primary",
              icon: "document",
            });
            // Files API is not accessible from browser (CORS).
            // Send a follow-up message in the same container to get base64-encoded PDF.
            const followUpMessages = [...currentMessages];
            followUpMessages.push({
              role: "assistant",
              content: currentData.content,
            });
            followUpMessages.push({
              role: "user",
              content:
                "Read the PDF file you just created and output ONLY its base64-encoded content. " +
                "Use Python:\nimport base64\nwith open('" +
                pdfFilename +
                "', 'rb') as f:\n    print(base64.b64encode(f.read()).decode())\n" +
                "Output ONLY the raw base64 string, no explanation, no markdown.",
            });

            let b64Response = await fetch(
              "https://api.anthropic.com/v1/messages",
              {
                method: "POST",
                headers,
                body: JSON.stringify({
                  ...options,
                  messages: followUpMessages,
                  container: {
                    id: containerId,
                    skills: [
                      {
                        type: "anthropic",
                        skill_id: "pdf",
                        version: "latest",
                      },
                    ],
                  },
                }),
              },
            );
            let b64Data = await b64Response.json();

            // Handle pause_turn for the follow-up too
            let b64Messages = [...followUpMessages];
            while (b64Data.stop_reason === "pause_turn") {
              b64Messages.push({
                role: "assistant",
                content: b64Data.content,
              });
              b64Response = await fetch(
                "https://api.anthropic.com/v1/messages",
                {
                  method: "POST",
                  headers,
                  body: JSON.stringify({
                    ...options,
                    messages: b64Messages,
                    container: {
                      id: containerId,
                      skills: [
                        {
                          type: "anthropic",
                          skill_id: "pdf",
                          version: "latest",
                        },
                      ],
                    },
                  }),
                },
              );
              b64Data = await b64Response.json();
            }

            // Extract base64 from stdout or text content
            let base64Content = "";
            for (const item of b64Data.content) {
              if (item.type === "bash_code_execution_tool_result") {
                const result = item.content;
                if (result?.stdout) {
                  base64Content = result.stdout.trim();
                }
              } else if (item.type === "text" && !base64Content) {
                // Fallback: look for base64 string in text
                const cleaned = item.text.replace(/[\s\n`]/g, "");
                if (
                  /^[A-Za-z0-9+/]+=*$/.test(cleaned) &&
                  cleaned.length > 100
                ) {
                  base64Content = cleaned;
                }
              }
            }

            AppToaster.clear();
            if (base64Content) {
              // Decode base64 and upload to Roam
              const binaryString = atob(base64Content);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              const blob = new Blob([bytes], { type: "application/pdf" });
              const firebaseUrl = await roamAlphaAPI.file.upload({
                file: blob,
              });

              respStr =
                (textContent ? textContent + "\n" : "") + `${firebaseUrl}`;
            } else {
              console.warn("PDF base64 extraction failed", b64Data);
              respStr =
                textContent || "PDF was generated but could not be retrieved";
            }
          } else {
            AppToaster.clear();
            respStr =
              textContent || "PDF generation failed - no file was created";
          }

          if (currentData.usage) {
            usage["input_tokens"] = currentData.usage["input_tokens"];
            usage["output_tokens"] = currentData.usage["output_tokens"];
          }
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

/**
 * Legacy OpenAI Chat Completions API
 * Kept for backward compatibility with models that have useCompletionApi: true
 * @deprecated Use openaiResponse for new implementations
 */
export async function openaiCompletionLegacy({
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
        provider,
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
    // For OpenRouter models with web search, append :online suffix
    const modelWithOnline =
      provider === "openRouter" && command === "Web search"
        ? model + ":online"
        : model;

    const options = {
      model: modelWithOnline,
      stream: isToStream,
    };
    if (model === "o3-pro" || (withPdf && provider !== "openRouter")) {
      options.input = messages;
      options["text"] = { format: { type: responseFormat } };
      options.stream = model === "o3-pro" ? false : streamResponse;
    } else {
      options.messages = messages;
      if (!model.includes("deepseek"))
        options["response_format"] =
          // Fixing current issue with LM studio not supporting "text" response_format...
          (aiClient.baseURL === "http://127.0.0.1:1234/v1" ||
            aiClient.baseURL === "http://localhost:1234/v1") &&
          responseFormat === "text"
            ? undefined
            : { type: responseFormat };
      isToStream &&
        !model.includes("deepseek") &&
        (options["stream_options"] = { include_usage: true });
    }
    console.log("model :>> ", modelWithOnline);

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
      // options["search_parameters"] = {
      //   mode: command === "Web search" ? "on" : "auto",
      //   return_citations: true,
      // };
      options["tools"] = [
        {
          type: "web_search",
        },
        {
          type: "x_search",
        },
      ];
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
              "Timeout error on client side: OpenAI response time exceeded (90 seconds)",
            ),
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
        isThinkingProcessToDisplay &&
        (model === "deepseek-reasoner" ||
          model.includes("grok-3-mini") ||
          model === "grok-4" ||
          model === "grok-4-1-fast-reasoning")
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
              model === "grok-4-1-fast-reasoning") &&
            thinkingToasterStream
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
 * OpenAI Response API completion (new unified API)
 * Uses the Response API which supports built-in tools, server-side state, and better reasoning
 */
export async function openaiResponse({
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
  previousResponseId = null,
  storeConversation = false,
  vectorStoreIds = null,
}) {
  let respStr = "";
  let usage = {};

  // Build input array (Response API format)
  const systemRole = getSystemRole(model);
  let input = [
    {
      role: systemRole,
      content: systemPrompt + (content ? "\n\n" + content : ""),
    },
  ].concat(prompt);

  // Handle images and PDFs for Response API
  if (isModelSupportingImage(model)) {
    if (
      pdfLinkRegex.test(JSON.stringify(prompt)) ||
      (includePdfInContext && pdfLinkRegex.test(content))
    ) {
      input = await addPdfUrlToMessages(
        input,
        includePdfInContext ? content : "",
        provider,
        true, // useResponseApi
      );
    } else {
      input = await addImagesUrlToMessages(
        input,
        content,
        false, // isAnthropicModel
        true, // useResponseApi
      );
    }
  }

  try {
    const options = {
      model,
      input,
      ...(storeConversation && { store: true }),
      ...(previousResponseId && { previous_response_id: previousResponseId }),
    };

    // Response format
    if (responseFormat !== "text") {
      options.text = { format: { type: responseFormat } };
    }

    // Add built-in tools
    const tools = [];
    if (command === "Web search" || model.includes("-search")) {
      tools.push({ type: "web_search" });
    }
    if (vectorStoreIds?.length) {
      tools.push({ type: "file_search", vector_store_ids: vectorStoreIds });
    }
    // Grok-specific tools
    if (model.includes("grok")) {
      tools.push({ type: "web_search" });
      tools.push({ type: "x_search" });
    }
    if (tools.length) options.tools = tools;

    // Handle reasoning for thinking models
    if (
      thinking ||
      model.includes("o3") ||
      model.includes("o4") ||
      (model.includes("gpt-5") &&
        !model.includes("search") &&
        model !== "gpt-5.1")
    ) {
      options.reasoning = { effort: reasoningEffort };
    }
    // Grok-3-mini has special reasoning effort handling
    if (model.includes("grok-3-mini") && !model.includes("high")) {
      options.reasoning_effort = reasoningEffort === "high" ? "high" : "low";
    }

    // Temperature handling (provider-aware)
    if (modelTemperature !== null) {
      const tempConfig = getTemperatureConfig(model);
      let temp = modelTemperature * tempConfig.scale;
      if (temp > tempConfig.max) temp = tempConfig.max;
      options.temperature = temp;
    }

    // Streaming support
    const isToStream =
      supportsStreaming(model) && streamResponse && responseFormat === "text";

    if (isToStream) {
      options.stream = true;
    }

    console.log("OpenAI Response API options :>> ", options);

    const response = await aiClient.responses.create(options);

    // Handle streaming
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
        isThinkingProcessToDisplay &&
        (model.includes("o3") ||
          model.includes("o4") ||
          model.includes("gpt-5") ||
          model.includes("grok-3-mini") ||
          model === "grok-4" ||
          model === "grok-4-1-fast-reasoning")
      ) {
        thinkingToasterStream = displayThinkingToast("Thinking process:");
      }

      try {
        for await (const event of response) {
          if (isCanceledStreamGlobal) {
            streamElt.innerHTML += "(⚠️ stream interrupted by user)";
            break;
          }

          // Handle different event types from Response API
          if (event.type === "response.output_text.delta") {
            const chunkStr = event.delta || "";
            respStr += chunkStr;
            streamElt.innerHTML += DOMPurify.sanitize(chunkStr);
          } else if (
            event.type === "response.reasoning.delta" &&
            thinkingToasterStream
          ) {
            thinkingToasterStream.innerText += event.delta || "";
          } else if (
            event.type === "response.completed" ||
            event.type === "response.done"
          ) {
            if (event.response?.usage) {
              usage = event.response.usage;
            }
          }
        }
      } catch (e) {
        console.log("Error during OpenAI Response API stream: ", e);
        return "";
      } finally {
        if (isCanceledStreamGlobal) {
          console.log("OpenAI Response API stream interrupted.");
        } else {
          streamElt.remove();
        }
      }
    } else {
      // Non-streaming response
      respStr = response.output_text || "";
      if (response.usage) {
        usage = response.usage;
      }
    }

    // Add web sources annotations if present
    if (response.annotations?.length && model.includes("-search")) {
      let webSources = "\n\nWeb sources:";
      response.annotations.forEach((annotation) => {
        if (annotation.url_citation) {
          webSources += `\n  - [${annotation.url_citation.title}](${annotation.url_citation.url})`;
        }
      });
      respStr += webSources;
    }

    // Token usage tracking
    console.log(`Tokens usage (${model}):>> `, usage);
    if (usage.input_tokens || usage.output_tokens) {
      updateTokenCounter(model, {
        input_tokens: usage.input_tokens || usage.prompt_tokens,
        output_tokens: usage.output_tokens || usage.completion_tokens,
      });
    }

    return respStr;
  } catch (error) {
    console.error("OpenAI Response API error:", error);
    AppToaster.show({
      message: `OpenAI Response API error: ${error.message}`,
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
    citationNumbers.forEach((num) =>
      citationsByBoundary.get(boundary).add(num),
    );
  }

  // Sort boundaries in descending order to avoid shifting issues when inserting
  const sortedBoundaries = Array.from(citationsByBoundary.keys()).sort(
    (a, b) => b - a,
  );

  // Insert citations at boundaries
  for (const boundary of sortedBoundaries) {
    const citationNumbers = Array.from(citationsByBoundary.get(boundary)).sort(
      (a, b) => a - b,
    );

    // Format as numbered citations
    const citationString = ` [${citationNumbers.join(", ")}]`;

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
      groundingMetadata.webSearchQueries,
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
            const pdfResult = await addPdfToGeminiMessage(
              currentMessageParts,
              msg.content,
            );
            currentMessageParts = pdfResult.messageParts;

            // For external PDFs, keep URLs in text (for URL Context tool)
            // For Firebase PDFs, remove from text (already uploaded to Files API)
            pdfLinkRegex.lastIndex = 0;
            const allPdfMatches = Array.from(
              msg.content.matchAll(pdfLinkRegex),
            );
            let cleanedText = currentMessageParts[0].text;

            for (const match of allPdfMatches) {
              const url = match[1] || match[2];
              // Only remove Firebase URLs (Files API), keep external URLs for URL Context
              if (url.includes("firebasestorage.googleapis.com")) {
                cleanedText = cleanedText.replace(match[0], "").trim();
              }
            }

            currentMessageParts[0].text = cleanedText;
          }

          // Add images from the last prompt message
          if (hasImageInPrompt && roamImageRegex.test(msg.content)) {
            currentMessageParts = await addImagesToGeminiMessage(
              currentMessageParts,
              msg.content,
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
              msg.content,
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
              msg.content,
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
            const pdfResult = await addPdfToGeminiMessage(
              userParts,
              msg.content,
            );
            userParts = pdfResult.messageParts;

            // For external PDFs, keep URLs in text (for URL Context tool)
            // For Firebase PDFs, remove from text (already uploaded to Files API)
            pdfLinkRegex.lastIndex = 0;
            const allPdfMatches = Array.from(
              msg.content.matchAll(pdfLinkRegex),
            );
            let cleanedText = userParts[0].text;

            for (const match of allPdfMatches) {
              const url = match[1] || match[2];
              // Only remove Firebase URLs (Files API), keep external URLs for URL Context
              if (url.includes("firebasestorage.googleapis.com")) {
                cleanedText = cleanedText.replace(match[0], "").trim();
              }
            }

            userParts[0].text = cleanedText;
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
      const pdfResult = await addPdfToGeminiMessage(
        currentMessageParts,
        content,
      );
      currentMessageParts = pdfResult.messageParts;
      // Note: external PDF URLs from context are already in the systemInstruction (content)
      // so URL Context tool will pick them up automatically
    }

    // Add images from context
    if (hasImageInContent) {
      currentMessageParts = await addImagesToGeminiMessage(
        currentMessageParts,
        content,
      );
    }

    // Add videos from context
    if (hasVideoInContent) {
      currentMessageParts = await addVideosToGeminiMessage(
        currentMessageParts,
        content,
      );
    }

    // Add audio from context
    if (hasAudioInContent) {
      currentMessageParts = await addAudioToGeminiMessage(
        currentMessageParts,
        content,
      );
    }

    // Disable streaming for Web search to ensure proper grounding metadata processing
    const isToStream =
      streamResponse && responseFormat === "text" && command !== "Web search";

    const generationConfig = {};
    if (responseFormat === "json_object") {
      generationConfig.responseMimeType = "application/json";
    }
    // Skip temperature for thinking models (Google handles it internally)
    const isGoogleThinkingModel = isThinkingModel(model);
    if (modelTemperature !== null && !isGoogleThinkingModel) {
      generationConfig.temperature = modelTemperature;
    }

    if (isGoogleThinkingModel) {
      generationConfig["thinkingConfig"] = {
        thinkingLevel: reasoningEffort === "minimal" ? "low" : reasoningEffort,
        includeThoughts: true,
      };
    }

    // Add tools configuration
    const toolsConfig = [];
    if (command === "Web search") {
      toolsConfig.push({ googleSearch: {} });
    }
    // Add URL Context tool for PDFs (allows Gemini to fetch external PDFs directly)
    if (hasPdfInPrompt || hasPdfInContent) {
      toolsConfig.push({ urlContext: {} });
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

    // IMPORTANT: Use direct model API for PDFs (chat API doesn't support PDF fileData properly)
    const usesDirectModelAPI = hasPdfInPrompt || hasPdfInContent;

    // Create chat instance (only if not using direct model API)
    const chat = usesDirectModelAPI ? null : aiClient.chats.create(chatConfig);

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

    if (usesDirectModelAPI) {
      // Use direct model API for PDFs (chat API doesn't support PDF fileData properly)
      // Build contents array for direct model API
      const contents = [];

      // Add history messages as contents (alternating user/model)
      if (history.length > 0) {
        history.forEach((msg) => {
          contents.push({
            role: msg.role,
            parts: msg.parts,
          });
        });
      }

      // Add current message with PDFs
      contents.push({
        role: "user",
        parts: currentMessageParts,
      });

      // Build generation config
      const generateConfig = {
        model: model,
        contents: contents,
        config: {
          ...generationConfig,
          // Add URL Context tool for PDFs
          ...(toolsConfig.length > 0 && { tools: toolsConfig }),
        },
      };

      // Add system instruction if provided
      if (systemInstruction) {
        generateConfig.systemInstruction = {
          parts: [{ text: systemInstruction }],
        };
      }

      // Call direct model API (non-streaming for PDFs)
      const response = await aiClient.models.generateContent(generateConfig);

      respStr = response.text || "";

      if (response.usageMetadata) {
        usage = {
          input_tokens: response.usageMetadata.promptTokenCount || 0,
          output_tokens: response.usageMetadata.candidatesTokenCount || 0,
        };
      }
    } else if (isToStream) {
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
      if (isGoogleThinkingModel && isThinkingProcessToDisplay) {
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
              if (thinkingToasterStream) {
                thinkingToasterStream.innerText += part.text;
              }
              // Skip adding thought to main response regardless of display setting
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
      },
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
