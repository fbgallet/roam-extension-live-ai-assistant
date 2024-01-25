# Speech-to-Roam

**Voice transcription, translation (to english) or vocal prompting to a GPT model, using OpenAI Whisper API or Web Speech API.**

<img width="726" alt="speech-to-roam visual" src="https://github.com/fbgallet/roam-extension-speech-to-roam/assets/74436347/a7798ac9-40fc-4231-b2f6-1af02530dfce">

By default, the controls will be inserted in the left sidebar, after "Daily Notes". It's possible to display them in the topbar (always visible, more convenient on mobile).

**Keyboard hotkeys** (available when recording):

- Pause/Resume: `Spacebar`
- Stop and rewind: `Escape` or `Backspace`
- Transcribe: `T or Enter`
- Translate (in English): `E`
- Speak to ChatGPT: `C`

**Commands** (in command panel)

- Toggle on/off Icon (in the left sidebar or in the topbar, depending on your choice in the settings)
- Record your Voice for transcription

⚠️ _Currently, this extension doesn't work on either the MacOS desktop app or the Android app, but it works on browsers (desktop and mobile) and on Windows desktop app._

### To be done right after installation

In the settings, provide an OpenAI API key (by copying/pasting an existing key or generating a new key via [this link](https://platform.openai.com/api-keys)). You need an account on OpenAI to benefit from Whisper transcriptions.

### Voice transcription

- the transcribed text will be inserted at the bottom of the current page (or page view) or appended to the current focused block.
- if you have not entered any OpenAI API Key, or if you disable Whisper, the free Web Speech API will be used to transcribe audio (⚠️ not available in Electron Desktop app and Firefox or Arc browser)
- by default, the language should be automatically detected, but you can specify it for better results, using the [ISO 639-1 codes](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)

⚠️ _OpenAI Whisper API is a paid but quite cheap service_

`$0.006/minute` (rounded to the nearest second)

To give you an idea, using Whisper for 10 minutes a day for a month equates to 1.80 $

### Translation

A large number of [source languages are supported](https://platform.openai.com/docs/guides/speech-to-text/supported-languages), but the target language is currently limited to English. This limitation can be easily overcome through post-processing using a GPT model, as it only requires asking it to translate into any language.

### Speak directly to an AI Assistant (OpenAI GPT models)

- ask any question, rephrasing, completion, translation! Feel free to specify the expected format of the response (its length, style, etc.).
- assistant response is inserted as last child of prompt block (current limitation: the answer is only one long block)
- you can easily **provide context by selecting some block(s)** in the page or right sidebar. You can use it to extend a conversation, ask a question about any content, request a summary or translation, and so on. 🚀
- the context provided by selected blocks is handled with the following instructions:

    > _"Here is the context or content to which you must refer to respond to the user's prompt, to which the user can refer to as 'this', 'that', 'this block', 'these blocks', 'the selected blocks' or 'what is selected' among other possibilities. The 9-characters code between parentheses represents the reference to the block containing the copied text. In your response, you can also refer to it if asked, using the following syntax `[*](((9-characters code)))`. Here is the content in question:\n"_

- you can customize the AI assistants's "character", its default character is defined this way:

    > _"You are a smart, rigorous and concise assistant. Your name is 'Roam', we can also call you 'Roam assistant', 'Assistant' or 'AI assistant'. You are playful only if the tone of the request is playful or humorous and directed at you personally, otherwise your tone is serious and thoughtful."_
  
- model by default is currently `gpt-3.5-turbo-1106`
- you can try other chat completion model, or your own fine-tuned models


⚠️ _OpenAI GPT API is a paid but cheap service_

- gpt-3.5
  - Input: $0.0010 / 1K tokens
  - Output: $0.0020 / 1K tokens
- gpt-4-1106-preview (128k context)
  - input: $0.01 / 1K tokens
  - output: $0.03 / 1K tokens

---

### For any question or suggestion, DM me on **Twitter** and follow me to be informed of updates and new extensions : [@fbgallet](https://twitter.com/fbgallet).
