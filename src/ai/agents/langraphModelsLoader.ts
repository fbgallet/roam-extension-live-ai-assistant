import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from "@langchain/ollama";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { CallbackManager } from "@langchain/core/callbacks/manager";
import { updateTokenCounter } from "../modelsInfo";
import { modelTemperature, reasoningEffort } from "../..";
import { usesAdaptiveThinking, getMaxOutput } from "../modelRegistry";

export interface AdvancedModelParams {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
}

export interface LlmInfos {
  provider: string;
  prefix: string;
  id: string;
  name: string;
  library: any;
  thinking?: boolean;
  advancedParams?: AdvancedModelParams;
}

export interface TokensUsage {
  input_tokens: number;
  output_tokens: number;
}

export function modelViaLanggraph(
  llmInfos: LlmInfos,
  turnTokensUsage?: TokensUsage,
  structuredOutput?: boolean,
) {
  let llm;

  const tokensUsageCallback = CallbackManager.fromHandlers({
    async handleLLMEnd(output: any) {
      console.log(
        "Used tokens",
        output.llmOutput?.tokenUsage ||
          output.llmOutput?.usage ||
          output.llmOutput?.usage_metadata,
      );
      const usage: TokensUsage = {
        input_tokens:
          output.llmOutput?.tokenUsage?.promptTokens ||
          output.llmOutput?.usage?.input_tokens ||
          output.llmOutput?.usage_metadata?.input_tokens,
        output_tokens:
          output.llmOutput?.tokenUsage?.completionTokens ||
          output.llmOutput?.usage?.output_tokens ||
          output.llmOutput?.usage_metadata?.output_tokens,
      };
      if (usage.input_tokens || usage.output_tokens) {
        if (turnTokensUsage) {
          turnTokensUsage.input_tokens += usage.input_tokens || 0;
          turnTokensUsage.output_tokens += usage.output_tokens || 0;
        } else updateTokenCounter(llmInfos.id, usage);
      }
    },
  });

  let options: any = {
    callbackManager:
      !llmInfos.thinking && llmInfos.provider !== "Google"
        ? tokensUsageCallback
        : null,
    maxRetries: 2,
  };
  if (llmInfos.provider !== "ollama") options.apiKey = llmInfos.library?.apiKey;
  else if (modelTemperature !== null && !llmInfos.id.includes("gemini-3"))
    options.temperature = modelTemperature;
  if (structuredOutput && llmInfos.provider === "groq")
    options.response_format = "json_object";
  if (structuredOutput && llmInfos.provider === "openRouter")
    options.response_format = "json_object";
  // ? {
  //     callbackManager: tokensUsageCallback,
  //     format: structuredOutput ? "json" : "",
  //   }
  // : {
  //     apiKey: llmInfos.library?.apiKey,
  //     callbackManager: tokensUsageCallback,
  //   };

  // Apply per-session advanced parameters (override globals) — except maxTokens which is applied after provider setup
  const adv = llmInfos.advancedParams;
  if (adv) {
    // Anthropic throws if temperature or topP are set when thinking is enabled
    const isAnthropicThinking =
      llmInfos.provider === "Anthropic" && llmInfos.thinking;
    if (adv.temperature !== undefined && !isAnthropicThinking)
      options.temperature = adv.temperature;
    if (adv.topP !== undefined && !isAnthropicThinking)
      options.topP = adv.topP;
    // presencePenalty: only supported by OpenAI-compatible providers (OpenAI, Ollama, DeepSeek)
    // Silently ignored by Anthropic/Google, so safe to set unconditionally
    if (adv.presencePenalty !== undefined)
      options.presencePenalty = adv.presencePenalty;
    // maxTokens is applied after LLM construction — see below
  }

  if (
    llmInfos.provider === "OpenAI" ||
    llmInfos.provider === "custom" ||
    llmInfos.provider === "groq" ||
    llmInfos.provider === "Grok"
  ) {
    if (llmInfos.thinking) {
      // GPT-5 and Grok models use reasoning parameter.
      // OpenAI/xAI accept minimal/low/medium/high — map "max" to "high".
      if (llmInfos.id.includes("gpt-5") || llmInfos.provider === "Grok") {
        const effort = reasoningEffort === "max" ? "high" : reasoningEffort;
        options["reasoning"] = { effort, summary: "auto" };
      }
    }
    // if (llmInfos.provider === "OpenAI") options["useResponsesApi"] = true;
    // console.log("options :>> ", options);
    llm = new ChatOpenAI({
      model: llmInfos.id,
      ...options,
      configuration: {
        baseURL: llmInfos.library.baseURL,
      },
    });
  } else if (llmInfos.provider === "openRouter") {
    // if (llmInfos.id.includes("gemini")) {
    //   llm = new ChatGoogleGenerativeAI({
    //     model: llmInfos.id,
    //     ...options,
    //     baseUrl: llmInfos.library.baseURL,
    //   });
    // } else
    llm = new ChatOpenAI({
      model: llmInfos.id,
      ...options,
      configuration: {
        baseURL: llmInfos.library.baseURL,
      },
    });
  } else if (llmInfos.provider === "ollama") {
    llm = new ChatOllama({
      model: llmInfos.id,
      ...options,
      maxRetries: 2,
    });
  } else if (llmInfos.provider === "Anthropic") {
    options.maxTokens = getMaxOutput(llmInfos.id);
    options.streaming = true;
    if (llmInfos.thinking) {
      if (usesAdaptiveThinking(llmInfos.id)) {
        // Opus & Sonnet 4.6+: adaptive thinking with effort parameter
        options.thinking = { type: "adaptive" };
        options["output_config"] = {
          effort: reasoningEffort === "minimal" ? "low" : reasoningEffort,
        };
      } else {
        // Legacy Claude models: enabled thinking with budget_tokens
        const effortMapping = {
          minimal: 1024,
          low: 2500,
          medium: 4096,
          high: 8000,
          max: 16000,
        };
        options.thinking = {
          type: "enabled",
          budget_tokens: effortMapping[reasoningEffort] || 2500,
        };
      }
    }

    llm = new ChatAnthropic({
      model: llmInfos.id,
      ...options,
      invocationKwargs: {
        top_p: undefined,
      },
      clientOptions: {
        baseURL: llmInfos.library.baseURL,
        dangerouslyAllowBrowser: true,
      },
    });
  } else if (llmInfos.provider === "DeepSeek") {
    // DeepSeek V4 models (deepseek-v4-pro, deepseek-v4-flash) have thinking
    // enabled by default at the API. Strict equality so undefined falls
    // through to the API default (thinking on).
    if (llmInfos.id.includes("deepseek-v4")) {
      if (llmInfos.thinking === false) {
        options.modelKwargs = {
          ...options.modelKwargs,
          thinking: { type: "disabled" },
        };
      } else if (llmInfos.thinking === true) {
        // DeepSeek V4 supports the full effort range including "max".
        options.modelKwargs = {
          ...options.modelKwargs,
          thinking: { type: "enabled", effort: reasoningEffort },
        };
      }
    }
    llm = new ChatDeepSeek({
      model: llmInfos.id,
      ...options,
      configuration: {
        baseURL: llmInfos.library.baseURL,
      },
    });
  } else if (llmInfos.provider === "Google") {
    if (llmInfos.thinking && llmInfos.id.includes("gemini-3")) {
      // Gemini accepts low/medium/high — map "max" to "high".
      options["thinkingLevel"] =
        reasoningEffort === "max" ? "high" : reasoningEffort;
      if (
        llmInfos.id === "gemini-3-pro-preview" &&
        (reasoningEffort === "minimal" || reasoningEffort === "medium")
      )
        options["thinkingLevel"] = "low";
      else if (
        llmInfos.id === "gemini-3.1-pro-preview" &&
        reasoningEffort === "minimal"
      )
        options["thinkingLevel"] = "low";
      options["includeThoughts"] = true;
    }
    llm = new ChatGoogleGenerativeAI({
      model: llmInfos.id,
      ...options,
      baseUrl: llmInfos.library.baseURL,
    });
  }
  // Apply per-session maxTokens override after LLM construction
  // (must be done after provider-specific setup which may set its own maxTokens)
  if (adv?.maxTokens !== undefined && llm) {
    const isOpenAILike =
      llmInfos.provider === "OpenAI" ||
      llmInfos.provider === "custom" ||
      llmInfos.provider === "groq" ||
      llmInfos.provider === "Grok" ||
      llmInfos.provider === "openRouter";
    if (isOpenAILike) {
      // Newer OpenAI models reject max_tokens and require max_completion_tokens.
      // LangChain only maps to max_completion_tokens for o1/o3, so we:
      // 1. Set maxTokens = -1 to suppress LangChain's max_tokens param
      // 2. Inject max_completion_tokens via modelKwargs (spread into API params)
      (llm as any).maxTokens = -1;
      (llm as any).modelKwargs = {
        ...(llm as any).modelKwargs,
        max_completion_tokens: adv.maxTokens,
      };
    } else if (llmInfos.provider === "Google") {
      // Google GenAI uses maxOutputTokens
      (llm as any).maxOutputTokens = adv.maxTokens;
    } else {
      // Anthropic, DeepSeek, Ollama: override maxTokens directly
      (llm as any).maxTokens = adv.maxTokens;
    }
  }

  return llm;
}

export const getLlmSuitableOptions = (
  model: LlmInfos,
  schemaTitle: string,
  temperature?: number,
) => {
  const isClaudeModel = model.id.toLowerCase().includes("claude");
  const isGPTmodel = model.id.toLocaleLowerCase().includes("gpt");
  const isKimiModel = model.id.toLocaleLowerCase().includes("kimi");

  const outputOptions: any = {
    name: schemaTitle,
  };
  if (
    temperature !== undefined &&
    !model.id.toLowerCase().includes("o1") &&
    !model.id.toLowerCase().includes("o3") &&
    !model.id.toLowerCase().includes("o4") &&
    !model.id.toLowerCase().includes("gpt-5")
  )
    outputOptions.temperature = temperature;
  // There is an issue with json_mode & GPT models in v.0.3 of Langchain OpenAI chat...
  if (isGPTmodel) {
    outputOptions.method = "jsonSchema"; //"function_calling";
    // outputOptions.strict = true;
  }
  if (
    !isKimiModel &&
    (model.provider === "groq" || model.provider === "openRouter")
  ) {
    outputOptions.method = "function_calling";
  }
  if (isClaudeModel) outputOptions.includeRaw = true;
  return outputOptions;
};
