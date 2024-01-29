# Speech-to-Roam

**Voice transcription, translation (to english) or vocal prompting to a GPT model, using OpenAI Whisper API or Web Speech API.**

<img width="726" alt="speech-to-roam visual" src="https://github.com/fbgallet/roam-extension-speech-to-roam/assets/74436347/a7798ac9-40fc-4231-b2f6-1af02530dfce">

By default, the controls will be inserted in the left sidebar, after "Daily Notes". It's possible to display them in the topbar (always visible, more convenient on mobile).

**Keyboard hotkeys** (available when the recording has been started by a click):

- Pause/Resume: `Spacebar`
- Stop and rewind: `Escape` or `Backspace`
- Transcribe: `T or Enter`
- Translate (in English): `E`
- Speak to ChatGPT: `C`

**Commands** (in command palette - I recommand to set up hotkeys for them)

- Start/Pause record your vocal note
- Transcribe your vocal note
- Translate your vocal note
- Transcribe & send as prompt for GPT assistant
- AI completion of current block as prompt & selection as context (no vocal note)
- Toggle the visibility of the main button (if hidden, the controls will only appear during the recording, which will necessarily be initiated by the above command)
- a SmartBlock command is also provided: `<%SPEECHTOROAM%>`, see the example of SmartBlock at the end of this doc.

⚠️ _Currently, this extension doesn't work on either the MacOS desktop app or the Mobile app, but it works on browsers (desktop and mobile) and on Windows desktop app._

## To be done right after installation

In the settings, provide an OpenAI API key (by copying/pasting an existing key or generating a new key via [this link](https://platform.openai.com/api-keys)). You need an account on OpenAI to benefit from Whisper transcriptions.

## Voice transcription

- the transcribed text will be inserted by default at the **bottom of the current page** (or page view) or **appended to the current focused block** (so exactly where you want, you have just to place the cursor anywhere).
- by default, the language should be automatically detected, but you can specify it for better results, using the [ISO 639-1 codes](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)
- You can specify a list of words to be spelled in a specific way (e.g. proper nouns, acronyms, etc.), see the Whisper prompt option in the settings.
- if you have not entered any OpenAI API Key, or if you disable Whisper, the free Web Speech API will be used to transcribe audio (⚠️ not available in Electron Desktop app and Firefox or Arc browser)

⚠️ _OpenAI Whisper API is a paid but quite cheap service_

`$0.006/minute` (rounded to the nearest second)

To give you an idea, using Whisper for 10 minutes a day for a month equates to 1.80 $

## Translation

A large number of [source languages are supported](https://platform.openai.com/docs/guides/speech-to-text/supported-languages), but the target language is currently limited to English. This limitation can be easily overcome through post-processing using a GPT model, as it only requires asking it to translate into any language.

## Speak directly to an AI Assistant (OpenAI GPT models)

- ask any question, rephrasing, completion, translation! Feel free to specify the expected format of the response (its length, style, etc.).
- assistant response is inserted as child of prompt block (by default, the answer is splitted in as many blocks as it contains paragraphs. There is an option to always limit the response to a block.)
- you can easily **provide context by selecting some block(s) or place the cursor in any block** in the page or right sidebar. You can use it to extend a conversation, ask a question about any content, request a summary or translation, and so on. 🚀 The selection can be done before recording or updated just before sending the transcription to the GPT model. The block content of the initial focused block provide the initial context if no selection is made subsequently. As for simple transcription, the focused block right before completion is the target where your prompt and the answer will be inserted.
- the context provided by selected blocks is handled with the following instructions (you can add your own instructions, see settings):

  > _"\nBelow is the context of your response, it can consist of data to rely on, a conversation to be continued, or other instructions, depending on the user's prompt. The user car refer to it as 'this block' or 'the selected blocks' among other possibilities. The 9-characters code within double parentheses preceding each piece of content is the identifier of this content and is called 'block reference'. In your response, you can refer to it if needed, using markdown link alias syntax `[*](((9-characters code)))` to mention it as a note or citation: e.g. `[*](((kVZwmFnFF)))`. Expressions within double brackets such as [[my page]] should be reused with the exact same syntax as in the source text, keeping the original double brackets: e.g. [[my page]]. "_

- on mobile (selection being not possible), place the cursor in a block to use its content as context, or enable the option to use the whole current view as context (unless you place the cursor in a blank block).
- you can customize the AI assistants's "character", its default character is defined this way (you can add your own definition of its character, see settings):

  > _"You are a smart, rigorous and concise assistant. Your name is 'Roam', we can also call you 'AI assistant'."_

- model by default is currently `gpt-3.5-turbo-1106`
- you can try other chat completion model, or your own fine-tuned models

## Simple text AI completion

You can also use AI assistant feature without vocal just, using the dedicated command in command palette (see above).

- Focus your cursor in a block, it will be used as prompt, the AI response will be inserted as child block.
- Select some blocks, they will be used as context. By default, the prompt will be "Follow the instructions provided in the context". But you can simultaneously focus a block to define your prompt and select some blocks with Roam native multi-select feature.

⚠️ _OpenAI GPT API is a paid but cheap service_

- gpt-3.5
  - Input: $0.0010 / 1K tokens
  - Output: $0.0020 / 1K tokens
- gpt-4-1106-preview (128k context)
  - input: $0.01 / 1K tokens
  - output: $0.03 / 1K tokens

### Using the SmartBlock command

You can insert `<%SPEECHTOROAM%>` command in your SmartBlocks template (using the corresponding extension) to start recording a vocal note in a specific context. You can for example create a very simple SmartBlock and call it with a button:

```
- #SmartBlock Speech-to-Roam
    - <%SPEECHTOROAM%><%CURSOR%>
```

The SmartBlock button will be `{{🎙️:SmartBlock:Speech-to-Roam}}` (can be used once), or to have a permanent button in a given block, and automatically insert the transcription in the children blocks: `{{🎙️:SmartBlock:Speech-to-Roam:RemoveButton=false}}`

---

### For any question or suggestion, DM me on **Twitter** and follow me to be informed of updates and new extensions : [@fbgallet](https://twitter.com/fbgallet).
