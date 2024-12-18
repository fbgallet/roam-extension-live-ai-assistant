import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from "@langchain/ollama";
import { CallbackManager } from "@langchain/core/callbacks/manager";
import { updateTokenCounter } from "../../utils/utils";
import { ANTHROPIC_API_KEY } from "../..";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseMessage, AIMessage } from "@langchain/core/messages";

export interface LlmInfos {
  provider: string;
  prefix: string;
  id: string;
  library: any;
}

export interface TokensUsage {
  input_tokens: number;
  output_tokens: number;
}

export function modelViaLanggraph(llmInfos: LlmInfos) {
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
      if (usage.input_tokens && usage.output_tokens)
        updateTokenCounter(llmInfos.id, usage);
    },
  });

  const options = {
    apiKey: llmInfos.library.apiKey,
    callbackManager: tokensUsageCallback,
  };

  if (llmInfos.provider === "OpenAI" || llmInfos.provider === "groq") {
    llm = new ChatOpenAI({
      model: llmInfos.id,
      ...options,
      configuration: {
        baseURL: llmInfos.library.baseURL,
      },
    });
  } else if (llmInfos.provider === "openRouter") {
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
      callbackManager: tokensUsageCallback,
    });
  } else if (llmInfos.provider === "Anthropic") {
    llm = new ChatAnthropic({
      model: llmInfos.id,
      ...options,
      clientOptions: {
        baseURL: llmInfos.library.baseURL,
        dangerouslyAllowBrowser: true,
      },
    });
  }
  return llm;
}
