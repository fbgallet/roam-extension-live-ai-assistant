import { StructuredOutputType } from "@langchain/core/language_models/base";
import { TokensUsage } from "./langraphModelsLoader";
import { SystemMessage } from "@langchain/core/messages";
import { AgentToaster, displayThinkingToast } from "../../components/Toaster";
import { updateTokenCounter } from "../modelsInfo";

export const streamClaudeThinkingModel = async (
  llm: StructuredOutputType,
  messages: SystemMessage[],
  turnTokensUsage: TokensUsage
) => {
  const response = await llm.stream(messages, {
    stream_options: {
      include_usage: true,
    },
  });

  let streamedResponse = "";
  let thinkingToasterStream: any = displayThinkingToast(
    "Claude Sonnet 3.7 Extended Thinking process:"
  );

  turnTokensUsage = {
    input_tokens: 0,
    output_tokens: 0,
  };

  for await (const chunk of response) {
    if (chunk?.content.length) {
      if (
        chunk.content[0].type === "thinking" &&
        thinkingToasterStream &&
        chunk.content[0].thinking
      ) {
        thinkingToasterStream.innerText += chunk.content[0].thinking;
      } else if (chunk.content[0].type === "text") {
        streamedResponse += chunk.content[0].text;
      }
    }
    if (chunk.usage_metadata) {
      turnTokensUsage.input_tokens += chunk.usage_metadata.input_tokens || 0;
      turnTokensUsage.output_tokens += chunk.usage_metadata.output_tokens || 0;
    }
  }
  console.log("token usage :>> ", turnTokensUsage);
  updateTokenCounter(llm.model, turnTokensUsage);
  return { content: streamedResponse };
};
