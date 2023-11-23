# Speech-to-Roam

### Voice transcription, translation (to english) or vocal prompting to GPT model, using OpenAI Whisper API or Web Speech API.

**Voice transcription**
- While recording, you can pause/resume/rewind to the beginning
- the transcribed text in your graph will be inserted at the bottom of the current page or appended to the current focused block.
- if you have not entered any OpenAI API Key, or if you disable Whisper, the free Web Speech API will be used to transcribe audio.
- by default, the language will be automatically detected, but you can specify it for better results, using the [ISO 639-1 codes](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)

Keyboard hotkeys (available when recording):
- Pause/Resume: `Space bar`
- Stop and rewind: `Escape`
- Transcribe: `Enter`

⚠️ OpenAI Whisper API is a paid but very cheap service:
$0.006 / minute (rounded to the nearest second)
To give you an idea, using Whisper for 10 minutes a day for a month equates to 1,8$

**Translation**
A large number of [source languages are supported](https://platform.openai.com/docs/guides/speech-to-text/supported-languages), but the target language is currently limited to English. This limitation can be easily overcome through post-processing using a GPT model, as it only requires asking it to translate into any language.

**Speak directly to a GPT model**
- model by default is currently gpt-3.5-turbo-1106
- you can try other chat completion model, or your own fine-tuned models

---

### For any question or suggestion, DM me on **Twitter** and follow me to be informed of updates and new extensions : [@fbgallet](https://twitter.com/fbgallet).
