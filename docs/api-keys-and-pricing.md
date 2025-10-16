## Choose your LLMs provider

If you haven't already, you will need to create a user account with one of the following providers. Payment is made to them and generally involves crediting your account in advance with a specific amount (you can start with 5 or 10$, which is usually more than enough for several months).
All features of Live AI Assistant have been tested with OpenAI and Anthropic models, and they also work well with DeepSeek, Grok and Llama3.3 on Groq. Most models available on OpenRouter work for generative AI, but it's more unpredictable for Query Agents and Live Outliner. Currently, Gemini models work only with generative AI, not agents.

## Get API Keys

- To use GPT models, voice transcription, TTS and image generation, provide an OpenAI API key (by copying/pasting an existing key or generating a new one via [this link](https://platform.openai.com/api-keys)). A payment method has to be defined in API > Settings > Billing > [Payment methods](https://platform.openai.com/account/billing/payment-methods). OpenAI API usage is a paid service, see API usage fees here.

NB: API fees should not be confused with the ChatGPT Plus subscription; they are strictly separate. You do not need the ChatGPT plus subscription to use Live AI Assistant.

- To use Anthropic (Claude) models, or DeepSeek models, or Grok models, you have to provide an API key for each of these providers. The principle is the same, you have to create an account, credit your account with a few dollars, get an API and copy it in Live AI Assistant settings.

- To use [any other existing models](https://openrouter.ai/docs#models), you can provide an OpenRouter API Key or a Groq API Key. You can define OpenRouter as your default model provider or use it as a complement to direct access to OpenAI and Anthropic API. Using Groq, you can also replace default Whisper model by `whisper-large-v3` model.

- Use models throught OpenRouter:

OpenRouter is an unified API routing requests to [wide range of models](https://openrouter.ai/docs#models). The benefit is having a single account to access to most of existing and up-to-date models. You pay as you go: after purchasing credit (you can test without credit), your credit is debited on each request. OpenRouter also offers a continuously updated [ranking](https://openrouter.ai/rankings) of the most popular models.

In the settings, provide the list of IDs of the models you want to use in LiveAI. They will appear in the context menu in a dedicated section or replace the native models if you check the corresponding option. The first model in your list can be selected as your default model.

By default, logging of your inputs & outputs in OpenRouter's settings is enabled, you can disable it from your OpenRouter account.

- To use free and local models with Ollama, you doesn't need API key, see 'Use Ollama to run local models' section below.

## Main models pricing per million tokens

Pricing currently used in cost calculations in Live AI Assistant

In practice, regular use of generative models will cost only a few dozen cents per month or a few dollars if you process large quantities of data (you'll need to be more careful with reasoning models like gpt-5, o3, Claude Sonnet 4 Thinking, deepseek-v3 Thinking, etc.).

NB: Prices may have changed (generally decreased) since the last update of this document. Additionally, the price of cached input tokens is not shown here and is not included in the calculations made in Live AI. However, using the same prompt repeatedly utilizes the cache, which significantly lowers the cost of requests (for example, with OpenAI, cached inputs are half the price). The costs shown in Live AI Assistant are always the assumed maximum cost; in practice, you will pay less. For an accurate breakdown of your costs, check the usage and costs page of each AI provider.

| **Model**                    | **Input** Price/1M Tokens | **Output** Price/1M Tokens |
| ---------------------------- | ------------------------- | -------------------------- |
| **OpenAI**                   |                           |                            |
| gpt-5-nano                   | $0.05                     | $0.40                      |
| gpt-5-mini                   | $0.25                     | $2.00                      |
| gpt-5                        | $1.25                     | $10.00                     |
| gpt-4.1-mini                 | $0.40                     | $1.60                      |
| gpt-4.1                      | $2.00                     | $8.00                      |
| gpt-4o-mini-search-preview\* | $0.15                     | $0.60                      |
| gpt-4o-search-preview\*      | $2.50                     | $10.00                     |
| gpt-image-1\*\*              | text: $5, image: \*10     | $40.00                     |
| o4-mini                      | $1.10                     | $4.40                      |
| o3                           | $2.00                     | $8.00                      |
| o3-pro                       | $20.00                    | $80.00                     |
| **Anthropic**                |                           |                            |
| claude-3-5-haiku-20241022    | $0.80                     | $4.00                      |
| claude-haiku-4-5-20251001    | $1.00                     | $5.00                      |
| claude-sonnet-4-5-20250929   | $3.00                     | $15.00                     |
| claude-opus-4-1-20250805     | $15.00                    | $75.00                     |
| **DeepSeek**                 |                           |                            |
| DeepSeek-V3.2                | $0.28                     | $0.42                      |
| **Grok**                     |                           |                            |
| grok-2-1212                  | $2.00                     | $10.00                     |
| grok-3-mini                  | $0.30                     | $0.50                      |
| grok-3-mini-fast             | $0.60                     | $4.00                      |
| grok-3 & grok-4              | $3.00                     | $15.00                     |

(\*) additional pricing for OpenAI Web Search models **by 1k calls** (included as input tokens for each request in Live AI tokens counter):

- gpt-4o-mini (low / medium / high context size): 25$ / 27.5$ / 30$
- gpt-4o default (low / medium / high context size): 30$ / 35$ / 50$

(\*\*) pricing examples for 1 image generation in square format (1024\*1024) (portrait or landscape format are 50% more expensive) (not taking into account tokens for input images if you edit or combine them):

- low quality: $0.011
- medim: $0.042
- high: $0.167

For a complete and up-to-date comparison of pricing and performance, see https://artificialanalysis.ai/models#pricing

See here on [OpenRouter.ai](https://openrouter.ai/models?order=pricing-low-to-high) for pricing of all other available models via OpenRouter

## Using Ollama to run local models

[Ollama](https://ollama.com/) allows you to run local models like Llama3.1, so all your data shared with the AI assistant is processed entirely locally and is not sent to a third party like OpenAI or Anthropic. (Please note: a local model is typically slower than a remote model and requires a machine with a lot of RAM. E.g a 7B model may require 7GB of RAM to work properly)
Install Ollama (or update it to last version), install a model (ex. `ollama run llama3.1`), add the model name in the settings above (e.g. `llama3.1`), and follow the instructions below:

To use Ollama in Roam, you have also to set OLLAMA_ORIGINS environment variable to `https://roamresearch.com` (by default, Ollama CORS is restricted to local origins). See [Ollama documentation here](https://github.com/ollama/ollama/blob/main/docs/faq.md#how-do-i-configure-ollama-server) or proceed this way, according to your operating system:

### on MacOS

- Edit `~/.zshrc` file and add `export OLLAMA_ORIGINS="https://roamresearch.com"` command. The environment variable will be set at OS startup or when opening the zsh terminal. (To edit a file, open the terminal and run a text editor, e.g. `nano ~/.zshrc`. Save changes with Ctrl+x, Y and Enter). Close and open again the terminal. (You can also set this variable temporarily using the command `launchctl setenv OLLAMA_ORIGINS "https://roamresearch.com"` and restart the terminal)
- Then, stop or close Ollama.app and run "ollama serve" in the terminal

⚠️ In my experience, MacOS Ollama.app doesn't take into account OLLAMA_ORIGINS variable change. After Ollama installation, Ollama.app will be loaded in the background. You need to close it (using, e.g., the activity monitor), then launch "ollama serve" from the terminal. It may also be necessary to disable the automatic startup of Ollama.app when your OS starts by going to System Preferences > General > Startup > Open at login: select Ollama.app and click on the minus sign (-).

### on Windows

- Close Ollama app (with Task manager).
- Open the Control Panel and navigate to “Edit system environment variables.”
- Choose to edit or create a new system environment variable named OLLAMA_ORIGINS and define it to `https://roamresearch.com`
- Apply the changes and close the control panel.
- Run 'ollama serve' from a new terminal window to ensure it picks up the updated environment variables. If ollama serve return an error message, it probably means that you have to stop Ollama app running in the background (with Task manager).

### on Linux

- Run `systemctl edit ollama.service` to open the service file in an editor.
- In the `[Service]` section, add: `Environment="OLLAMA_ORIGINS=https://roamresearch.com"`
- Save your changes, then reload systemd and restart Ollama with: `systemctl daemon-reload` and `systemctl restart ollama` commands
