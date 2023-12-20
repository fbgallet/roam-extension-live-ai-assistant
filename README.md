# Speech-to-Roam

**Voice transcription, translation (to english) or vocal prompting to a GPT model, using OpenAI Whisper API or Web Speech API.**

⚠️ this extension works currently on Windows and Chrome MacOS but not iOS nor Android. Use iOS "Speach to Roam" shortcut instead.

![image](https://github.com/fbgallet/roam-extension-speech-to-roam/assets/74436347/369b7667-773e-4ef6-9bb6-a70cc2d78971)

By default, the controls will be inserted in the left sidebar. It's possible to display them in the topbar (always visible).

**Keyboard hotkeys** (available when recording):

- Pause/Resume: `Spacebar`
- Stop and rewind: `Escape` or `Backspace`
- Transcribe: `T or Enter`
- Translate (in English): `E`
- Speak to ChatGPT: `C`

**Commands** (in command panel)

- Toggle on/off Icon (in the left sidebar or in the topbar, depending on your choice in the settings)
- Voice Transcription
- Translate to english
- Speak to GPT assistant

### Voice transcription

- the transcribed text will be inserted at the bottom of the current page or appended to the current focused block.
- if you have not entered any OpenAI API Key, or if you disable Whisper, the free Web Speech API will be used to transcribe audio (⚠️ not available in Electron Desktop app and Firefox browser)
- by default, the language should be automatically detected, but you can specify it for better results, using the [ISO 639-1 codes](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)

_⚠️ OpenAI Whisper API is a paid but quite cheap service_

`$0.006/minute` (rounded to the nearest second)

To give you an idea, using Whisper for 10 minutes a day for a month equates to 1,8$

### Translation

A large number of [source languages are supported](https://platform.openai.com/docs/guides/speech-to-text/supported-languages), but the target language is currently limited to English. This limitation can be easily overcome through post-processing using a GPT model, as it only requires asking it to translate into any language.

### Speak directly to a GPT model

- ask any question, rephrasing, completion, translation! Feel free to specify the expected format of the response (its length, style, etc.).
- model by default is currently `gpt-3.5-turbo-1106`
- you can try other chat completion model, or your own fine-tuned models
- assistant response is inserted as last child of prompt block (current limitation: the answer is only one long block)
- additional context and other features to come, stay tuned ! 🚀

_⚠️ OpenAI GPT API is a paid but cheap service_

- gpt-3.5
  - Input: $0.0010 / 1K tokens
  - Output: $0.0020 / 1K tokens
- gpt-4-1106-preview (128k context)
  - input: $0.01 / 1K tokens
  - output: $0.03 / 1K tokens

---

### For any question or suggestion, DM me on **Twitter** and follow me to be informed of updates and new extensions : [@fbgallet](https://twitter.com/fbgallet).
