# Speech-to-Roam

**Voice transcription, translation (to english) or vocal prompting to GPT model, using OpenAI Whisper API or Web Speech API.**

![image](https://github.com/fbgallet/roam-extension-speech-to-roam/assets/74436347/369b7667-773e-4ef6-9bb6-a70cc2d78971)


**Keyboard hotkeys** (available when recording):
- Pause/Resume: `Space bar`
- Stop and rewind: `Escape`
- Transcribe: `Enter`

**Commands** (in command panel)
- Toggle on/of Icon in the topbar
- Voice Transcription
- Translate to english
- Speak to GPT assistant

### Voice transcription
- the transcribed text will be inserted at the bottom of the current page or appended to the current focused block.
- if you have not entered any OpenAI API Key, or if you disable Whisper, the free Web Speech API will be used to transcribe audio.
- by default, the language will be automatically detected, but you can specify it for better results, using the [ISO 639-1 codes](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)

_⚠️ OpenAI Whisper API is a paid but quite cheap service_

`$0.006/minute` (rounded to the nearest second)

To give you an idea, using Whisper for 10 minutes a day for a month equates to 1,8$


### Translation
A large number of [source languages are supported](https://platform.openai.com/docs/guides/speech-to-text/supported-languages), but the target language is currently limited to English. This limitation can be easily overcome through post-processing using a GPT model, as it only requires asking it to translate into any language.


### Speak directly to a GPT model
- ask any question, rephrasing, completion, translation! Feel free to specify the expected format of the response (its length, style, etc.).
- model by default is currently gpt-3.5-turbo-1106
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
