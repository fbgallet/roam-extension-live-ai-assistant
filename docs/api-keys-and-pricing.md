## Choose your LLMs provider

If you haven't already, you will need to create a user account with one of the following providers. Payment is made to them and generally involves crediting your account in advance with a specific amount (you can start with 5 or 10$, which is usually more than enough for several months).
All features of Live AI Assistant have been tested with OpenAI and Anthropic models, and they also work well with DeepSeek and Llama3.3 on Groq. Most models available on OpenRouter work for generative AI, but it's more unpredictable for Query Agents and Live Outliner. Currently, Gemini models work only with generative AI, not agents.

## Get API Keys

- To use GPT models and voice transcription, provide an OpenAI API key (by copying/pasting an existing key or generating a new one via [this link](https://platform.openai.com/api-keys)). A payment method has to be defined in API > Settings > Billing > [Payment methods](https://platform.openai.com/account/billing/payment-methods). OpenAI API usage is a paid service, see API usage fees here.

NB: API fees should not be confused with the ChatGPT Plus subscription; they are strictly separate. You do not need the ChatGPT plus subscription to use Live AI Assistant.

- To use Claude models, provide your Anthropic API key (by copying/pasting an existing key or generating a new one via [this link](https://console.anthropic.com/settings/keys)).

- To use [other existing models](https://openrouter.ai/docs#models), you can provide an OpenRouter API Key or a Groq API Key. You can define OpenRouter as your default model provider or use it as a complement to direct access to OpenAI and Anthropic API. Using Groq, you can also replace default Whisper model by `whisper-large-v3` model!

- You need an account on OpenAI to benefit from Whisper transcriptions

- To use free and local models with Ollama, you doesn't need API key, see 'Use Ollama to run local models' section.

## Main models pricing per million tokens

Pricing currently used in cost calculations in Live AI Assistant

In practice, regular use of generative models will cost only a few dozen cents per month or a few dollars if you process large quantities of data (you'll need to be more careful with reasoning models like o3, o1, deepseek-reasoner, etc.).

NB: Prices may have changed (generally decreased) since the last update of this document. Additionally, the price of cached input tokens is not shown here and is not included in the calculations made in Live AI Assistant. However, using the same prompt repeatedly utilizes the cache, which significantly lowers the cost of requests (for example, with OpenAI, cached inputs are half the price). The costs shown in Live AI Assistant are always the assumed maximum cost; in practice, you will pay less. For an accurate breakdown of your costs, check the usage and costs page of each AI provider.

| **Model**                  | **Input** Price/1M Tokens | **Output** Price/1M Tokens |
| -------------------------- | ------------------------- | -------------------------- |
| **OpenAI**                 |                           |                            |
| gpt-4o-mini                | $0.15                     | $0.60                      |
| gpt-4o                     | $2.50                     | $10.00                     |
| o3-mini                    | $1.10                     | $4.40                      |
| o1-mini                    | $1.10                     | $4.40                      |
| o1                         | $15.00                    | $60.00                     |
| **Anthropic**              |                           |                            |
| claude-3-haiku-20240307    | $0.25                     | $1.25                      |
| claude-3-5-haiku-20241022  | $0.80                     | $4.00                      |
| claude-3-5-sonnet-20241022 | $3.00                     | $15.00                     |
| claude-3-opus-20240229     | $15.00                    | $75.00                     |
| **DeepSeek**               |                           |                            |
| deepseek-chat              | $0.27                     | $1.10                      |
| deepseek-reasoner          | $0.55                     | $2.19                      |

For a complete and up-to-date comparison of pricing and performance, see https://artificialanalysis.ai/models#pricing

See here on [OpenRouter.ai](https://openrouter.ai/models?order=pricing-low-to-high) for pricing of all other available models via OpenRouter
