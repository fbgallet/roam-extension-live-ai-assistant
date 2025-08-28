import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from "@langchain/ollama";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { CallbackManager } from "@langchain/core/callbacks/manager";
import { updateTokenCounter } from "../modelsInfo";
import { reasoningEffort } from "../..";

export interface LlmInfos {
  provider: string;
  prefix: string;
  id: string;
  name: string;
  library: any;
  thinking?: boolean;
}

export interface TokensUsage {
  input_tokens: number;
  output_tokens: number;
}

export function modelViaLanggraph(
  llmInfos: LlmInfos,
  turnTokensUsage?: TokensUsage,
  structuredOutput?: boolean
) {
  let llm;

  const tokensUsageCallback = CallbackManager.fromHandlers({
    async handleLLMEnd(output: any) {
      console.log(
        "Used tokens",
        output.llmOutput?.tokenUsage || output.llmOutput?.usage
      );
      const usage: TokensUsage = {
        input_tokens:
          output.llmOutput?.tokenUsage?.promptTokens ||
          output.llmOutput?.usage?.input_tokens,
        output_tokens:
          output.llmOutput?.tokenUsage?.completionTokens ||
          output.llmOutput?.usage?.output_tokens,
      };
      if (usage.input_tokens && usage.output_tokens) {
        if (turnTokensUsage) {
          turnTokensUsage.input_tokens += usage.input_tokens;
          turnTokensUsage.output_tokens += usage.output_tokens;
        } else updateTokenCounter(llmInfos.id, usage);
      }
    },
  });

  let options: any = {
    callbackManager: !llmInfos.id.includes("+thinking")
      ? tokensUsageCallback
      : null,
    maxRetries: 2,
  };
  if (llmInfos.provider !== "ollama") options.apiKey = llmInfos.library?.apiKey;
  else options.temperature = 0;
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

  // console.log("llmInfos in langgraphModelsLoader :>> ", llmInfos);

  if (
    llmInfos.provider === "OpenAI" ||
    llmInfos.provider === "groq" ||
    llmInfos.provider === "Grok"
  ) {
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
    if (llmInfos.id.includes("+thinking")) {
      options.maxTokens = 32000;
      options.thinking = { type: "enabled", budget_tokens: 1024 };
      options.streaming = true;
    }
    llm = new ChatAnthropic({
      model: llmInfos.id.replace("+thinking", ""),
      ...options,
      clientOptions: {
        baseURL: llmInfos.library.baseURL,
        dangerouslyAllowBrowser: true,
      },
    });
  } else if (llmInfos.provider === "DeepSeek") {
    llm = new ChatDeepSeek({
      model: llmInfos.id,
      ...options,
      configuration: {
        baseURL: llmInfos.library.baseURL,
      },
    });
  } else if (llmInfos.provider === "Google") {
    llm = new ChatGoogleGenerativeAI({
      model: llmInfos.id,
      ...options,
      baseUrl: llmInfos.library.baseURL,
    });
  }
  return llm;
}

export const getLlmSuitableOptions = (
  model: LlmInfos,
  schemaTitle: string,
  temperature?: number
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
  if (model.provider === "OpenAI" && model.thinking) {
    outputOptions["reasoning_effort"] =
      reasoningEffort === "minimal" ? reasoningEffort : "low";
  }
  if (isClaudeModel) outputOptions.includeRaw = true;
  return outputOptions;
};
