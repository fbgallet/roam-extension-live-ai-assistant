# Live AI Public API (`window.LiveAI_API`)

Live AI exposes a public API that allows **any Roam Research extension** to leverage its generative AI capabilities — without needing their own API keys or AI integration code. The API is a secure proxy: all LLM calls are handled internally, and API keys are never exposed.

## Setup

The API is **disabled by default**. To enable it:

1. Open Roam's extension settings for Live AI
2. Toggle **"Enable Public API (window.LiveAI_API)"** to ON

Once enabled, `window.LiveAI_API` is available globally. It is cleaned up when the extension unloads.

---

## API Reference

### `window.LiveAI_API.version`

**Type:** `string`

Current API version (e.g. `"1.0"`). Use this for compatibility checks.

---

### `window.LiveAI_API.isAvailable()`

**Returns:** `boolean`

Returns `true` if Live AI is loaded and at least one model is configured with a valid API key.

```js
if (window.LiveAI_API?.isAvailable()) {
  // Safe to call generate()
}
```

---

### `window.LiveAI_API.getDefaultModel()`

**Returns:** `string | null`

Returns the user's currently configured default model id (e.g. `"gpt-5.1"`, `"claude-sonnet-4"`), or `null` if none is set.

---

### `window.LiveAI_API.listModels()`

**Returns:** `ModelInfo[]`

Returns metadata for all models the user has configured (with valid API keys). **No API keys or library references are included.**

```js
const models = window.LiveAI_API.listModels();
// [
//   {
//     id: "gpt-5.1",
//     name: "GPT-5.1",
//     provider: "OpenAI",
//     capabilities: { thinking: false, imageInput: true, webSearch: true },
//     contextLength: 400000,
//     maxOutput: 32000,
//     isDefault: true,
//   },
//   ...
// ]
```

**ModelInfo fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Model identifier to pass to `generate()` |
| `name` | `string` | Human-readable display name |
| `provider` | `string` | Provider name (OpenAI, Anthropic, Google, DeepSeek, Grok, etc.) |
| `capabilities` | `object` | `{ thinking, imageInput, webSearch, fileInput, videoInput, audioInput }` |
| `contextLength` | `number \| null` | Token context window |
| `maxOutput` | `number \| null` | Maximum output tokens |
| `isDefault` | `boolean` | Whether this is the user's current default model |

---

### `window.LiveAI_API.generate(options)`

**Returns:** `Promise<GenerateResult>`

The core method. Sends a prompt to an LLM and returns the response.

#### Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | `string \| Message[]` | **required** | The user prompt. A simple string or an array of `{role, content}` messages for multi-turn conversations. |
| `model` | `string` | user's default | Model id (e.g. `"claude-sonnet-4"`, `"gpt-5.1"`). Use `listModels()` to see available models. |
| `systemPrompt` | `string` | `""` | Additional system instructions. Behavior depends on `useDefaultSystemPrompt`. |
| `useDefaultSystemPrompt` | `boolean` | `true` | See [System Prompt Behavior](#system-prompt-behavior) below. |
| `context` | `string` | `""` | Additional text context injected alongside the prompt. Mutually exclusive with `roamContext`. |
| `roamContext` | `RoamContext` | `undefined` | Roam graph context object. Mutually exclusive with `context`. See [RoamContext](#roamcontext) below. |
| `responseFormat` | `"text" \| "json_object"` | `"text"` | Response format. Use `"json_object"` for structured JSON responses. |
| `temperature` | `number` | model default | Temperature override (0-2). |
| `thinking` | `boolean` | `undefined` | Enable extended thinking/reasoning if the model supports it. |
| `output` | `"raw" \| "blocks" \| "insert"` | `"raw"` | Output mode. See [Output Modes](#output-modes) below. |
| `targetUid` | `string` | `undefined` | Required when `output` is `"insert"`. The Roam block UID where children blocks will be inserted. |
| `targetBlockTitle` | `string` | `undefined` | When `output` is `"insert"`: write this text into the parent block (at `targetUid`) before inserting the response as children. Useful for adding a title/header. |
| `onChunk` | `(chunk: string) => void` | `undefined` | Streaming callback. Called with each text chunk as it arrives from the LLM. See [Streaming](#streaming) below. |
| `streamTo` | `HTMLElement \| "none"` | `"none"` | Where to display the streaming response. An HTMLElement to stream into, or `"none"` (default for API) to suppress DOM display. Omit or set to `"none"` if you only want the `onChunk` callback. |
| `signal` | `AbortSignal` | `undefined` | Standard `AbortController` signal for cancellation. |
| `caller` | `string` | `undefined` | Caller identification (e.g. `"my-extension/1.0"`). Logged to console for transparency. |

#### GenerateResult

| Field | Type | Description |
|-------|------|-------------|
| `text` | `string` | Raw text response (always present) |
| `blocks` | `Block[] \| undefined` | Parsed Roam block tree. Present when `output` is `"blocks"` or `"insert"`. Each block: `{ string, children: [] }` |
| `model` | `string` | Actual model id used |
| `provider` | `string` | Provider name |

#### System Prompt Behavior

By default (`useDefaultSystemPrompt: true` or omitted), Live AI **prepends its standard system prompt** before your `systemPrompt`. The default includes:

- **Assistant character**: a smart assistant that follows instructions and responds in the user's language
- **Roam formatting rules**: markdown syntax, callouts, KaTeX, date format, tag safety, code blocks
- **Current date and time**
- **Hierarchical response format**: indentation rules for structured responses

| `useDefaultSystemPrompt` | `systemPrompt` provided? | Result |
|--------------------------|--------------------------|--------|
| `true` (default) | No | Live AI defaults only |
| `true` (default) | Yes | Live AI defaults + your prompt appended |
| `false` | No | Empty system prompt |
| `false` | Yes | Your prompt only |

**Recommendation:** Keep the default for responses that will be inserted into Roam (the formatting rules ensure proper block structure). Set `useDefaultSystemPrompt: false` when you need full control (e.g. translation, code generation, custom agents).

#### Output Modes

| Mode | Behavior | `blocks` in result? |
|------|----------|---------------------|
| `"raw"` | Returns the LLM text response as-is | No |
| `"blocks"` | Returns text + parsed Roam block tree | Yes |
| `"insert"` | Returns text + blocks, **and** inserts content into the Roam block at `targetUid` | Yes |

The block tree uses the same parsing logic as Live AI's internal response handler: headings become parent blocks, indented content becomes children, code blocks and callouts are preserved.

When using `"insert"` with `targetBlockTitle`, the title is written into the parent block and the generated content is inserted as children underneath:

```
- targetBlockTitle        ← written into the parent block at targetUid
  - Generated heading     ← children inserted by Live AI
    - Generated content
    - More content
```

#### Streaming

When the LLM provider supports streaming, Live AI streams the response internally. By default for API calls, the streamed chunks are **not** displayed anywhere in the DOM (unlike Live AI's normal UI, which shows a temporary overlay in the Roam view). Two parameters let you control where the stream goes:

- **`onChunk(chunk: string)`**: A callback invoked with each raw text chunk as it arrives from the LLM. Use it to build your own streaming UI, pipe to console, or accumulate text progressively.
- **`streamTo`**: Controls whether/where chunks are rendered in the DOM during generation:
  - `"none"` (default for API calls) — no DOM rendering at all.
  - An `HTMLElement` — each chunk is appended to the element's `innerHTML` (HTML-sanitized). The element is **not** removed after completion — it's yours to manage.

These two parameters are independent and can be combined freely:

| `streamTo` | `onChunk` | What happens during generation |
|---|---|---|
| `"none"` (default) | not set | **Silent** — no visible output until the promise resolves with the full response. |
| `"none"` (default) | set | **Callback only** — each chunk is sent to your function, nothing in the DOM. |
| `HTMLElement` | not set | **Custom DOM only** — chunks appear progressively in your element. |
| `HTMLElement` | set | **Both** — chunks appear in your element AND are sent to your callback. |

> **Important:** The full response is always returned in `result.text` after the promise resolves, regardless of streaming settings. Streaming gives you **real-time progressive access** to partial content; it does not change the final result.

> **Note:** Streaming only works when the model and provider support it (most do for `responseFormat: "text"`). For non-streaming models or `responseFormat: "json_object"`, the response is returned whole — `onChunk` won't be called and `streamTo` has no effect.

```js
// 1. Callback only — log chunks to console
const result = await window.LiveAI_API.generate({
  prompt: "Tell me a story",
  onChunk: (chunk) => console.log(chunk),
});

// 2. Custom DOM element — render streamed text in a div
const myDiv = document.getElementById("my-stream-output");
const result = await window.LiveAI_API.generate({
  prompt: "Tell me a story",
  streamTo: myDiv,
});

// 3. Both — render in DOM + track in callback
const result = await window.LiveAI_API.generate({
  prompt: "Tell me a story",
  streamTo: myDiv,
  onChunk: (chunk) => { /* update a progress indicator, etc. */ },
});

// 4. Silent (default) — no streaming output, just await the result
const result = await window.LiveAI_API.generate({
  prompt: "Tell me a story",
});
```

#### RoamContext

Instead of passing a plain string as `context`, you can pass a `roamContext` object to dynamically pull content from the user's Roam graph. This uses the same context resolution engine that powers Live AI's inline context, context menu, and SmartBlock commands.

**You cannot combine `context` and `roamContext` — provide one or the other.**

```ts
interface RoamContext {
  // Page content
  page?: boolean;               // Include page content
  pageArgument?: string[];      // Specific page titles to include
  pageViewUid?: string;         // UID of the current page view

  // Linked references
  linkedRefs?: boolean;         // Include linked references of the page
  linkedRefsArgument?: string[];// Linked refs of specific page titles

  // Sidebar
  sidebar?: boolean;            // Include right sidebar content

  // Daily notes
  logPages?: boolean;           // Include daily note pages
  logPagesArgument?: number;    // Number of daily notes (default: user setting)

  // Specific blocks
  block?: boolean;              // Include specific blocks
  blockArgument?: string[];     // Array of block UIDs to include

  // Relative to focused block
  children?: boolean;           // Include children of the focused block
  siblings?: boolean;           // Include sibling blocks

  // Path / breadcrumb
  path?: boolean;               // Include hierarchical breadcrumb path
  pathDepth?: number;           // Number of ancestors (0 = full path)

  // Linked pages
  linkedPages?: boolean;        // Include pages linked from context blocks
}
```

**Examples:**

```js
// Include the current page + its linked references
roamContext: {
  page: true,
  pageViewUid: "page-uid-here",
  linkedRefs: true,
}

// Include specific blocks by UID
roamContext: {
  block: true,
  blockArgument: ["uid1", "uid2", "uid3"],
}

// Include the last 7 daily notes
roamContext: {
  logPages: true,
  logPagesArgument: 7,
}

// Include specific pages by title
roamContext: {
  page: true,
  pageArgument: ["Project Alpha", "Meeting Notes"],
}

// Include the right sidebar content
roamContext: {
  sidebar: true,
}
```

---

### `window.LiveAI_API.parseToBlocks(text)`

**Parameters:** `text: string`
**Returns:** `Block[]`

Parses markdown/LLM text into a Roam block tree structure **without making any LLM call or Roam write**. Useful for formatting text from any source into Roam-ready blocks.

```js
const blocks = window.LiveAI_API.parseToBlocks(
  "# Introduction\nSome paragraph\n- Item 1\n- Item 2"
);
// [
//   { string: "Introduction", children: [
//     { string: "Some paragraph", children: [] },
//     { string: "Item 1", children: [] },
//     { string: "Item 2", children: [] },
//   ]}
// ]
```

---

### `window.LiveAI_API.insertBlocks(targetUid, blocks)`

**Parameters:** `targetUid: string`, `blocks: Block[]`
**Returns:** `Promise<void>`

Inserts a block tree into Roam as children of the target block. Each block should have `{ string, children }` (the format returned by `parseToBlocks()` and `generate()` with `output: "blocks"`).

```js
await window.LiveAI_API.insertBlocks("target-uid", [
  { string: "**Main point**", children: [
    { string: "Supporting detail A", children: [] },
    { string: "Supporting detail B", children: [] },
  ]},
]);
```

---

## Security

- **No API key leakage**: API keys are stored in Roam's extension settings and resolved internally. The `generate()` function returns only text, blocks, model id, and provider name. Library objects containing keys are never exposed.
- **Frozen API object**: `window.LiveAI_API` is frozen with `Object.freeze()`, preventing monkey-patching or prototype chain attacks.
- **Opt-in gating**: The API is disabled by default. Users must explicitly enable it in the settings panel.
- **Caller logging**: When the `caller` field is provided, requests are logged to the browser console: `[LiveAI API] Request from "extension-name" -> model-id`. Users can monitor which extensions are making API calls.
- **Rate limiting**: Maximum 20 requests per minute per extension session, to prevent runaway loops from buggy code.
- **Input validation**: All parameters are validated before execution. Errors return clear messages without exposing internal stack traces.

---

## Error Handling

All errors are thrown as standard JavaScript `Error` objects with descriptive messages prefixed by `[LiveAI_API]`. Errors from LLM providers are wrapped to avoid leaking internal details.

```js
try {
  const result = await window.LiveAI_API.generate({ prompt: "Hello" });
} catch (error) {
  console.error(error.message);
  // "[LiveAI_API] Generation failed: Provide an API key to use..."
  // "[LiveAI_API] Rate limit exceeded: max 20 requests per minute."
  // "[LiveAI_API] 'prompt' must be a string or an array of {role, content} messages."
}
```

For cancellation via `AbortController`, the error has `name: "AbortError"`:

```js
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000); // Cancel after 5s

try {
  await window.LiveAI_API.generate({
    prompt: "Write a long essay",
    signal: controller.signal,
  });
} catch (error) {
  if (error.name === "AbortError") {
    console.log("Request cancelled");
  }
}
```

---

## Complete Examples

### Simple generation (raw text)

```js
const result = await window.LiveAI_API.generate({
  prompt: "What are the key principles of Zettelkasten?",
  caller: "my-extension/1.0",
});
console.log(result.text);
```

### Generate and insert into Roam

```js
// Get the currently focused block UID
const focusedUid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];

const result = await window.LiveAI_API.generate({
  prompt: "Create a brief weekly review template",
  output: "insert",
  targetUid: focusedUid,
  caller: "weekly-review-ext/1.0",
});
```

### Multi-turn conversation

```js
const result = await window.LiveAI_API.generate({
  prompt: [
    { role: "user", content: "What is spaced repetition?" },
    { role: "assistant", content: "Spaced repetition is a learning technique..." },
    { role: "user", content: "How can I implement it in Roam Research?" },
  ],
  model: "claude-sonnet-4",
  output: "blocks",
});
console.log(result.blocks); // Structured block tree
```

### Using roamContext to include page content

```js
// Get the current page UID
const pageUid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();

const result = await window.LiveAI_API.generate({
  prompt: "Summarize this page and identify the 3 most important action items",
  roamContext: {
    page: true,
    pageViewUid: pageUid,
  },
  output: "blocks",
  caller: "summary-ext/1.0",
});
```

### Custom system prompt without Live AI defaults

```js
const result = await window.LiveAI_API.generate({
  prompt: "console.log('Hello World')",
  systemPrompt: "You are a code reviewer. Only output the review, no code.",
  useDefaultSystemPrompt: false,
  model: "gpt-5.1",
});
```

### JSON structured output

```js
const result = await window.LiveAI_API.generate({
  prompt: "Extract all people and places mentioned in this text",
  context: "Yesterday, Alice met Bob at the Eiffel Tower in Paris...",
  responseFormat: "json_object",
  systemPrompt: "Return a JSON object with 'people' and 'places' arrays.",
});
// result.text is the parsed JSON object
```

### Insert with a title in the parent block

```js
const focused = window.roamAlphaAPI.ui.getFocusedBlock();

const result = await window.LiveAI_API.generate({
  prompt: "List the 5 most important principles of GTD (Getting Things Done)",
  output: "insert",
  targetUid: focused["block-uid"],
  targetBlockTitle: "**GTD Principles** (generated by Live AI)",
  caller: "gtd-helper/1.0",
});
// The focused block now contains "**GTD Principles** (generated by Live AI)"
// with the 5 principles inserted as child blocks underneath
```

### Streaming with onChunk callback

```js
// Stream chunks to console in real time
const result = await window.LiveAI_API.generate({
  prompt: "Write a short poem about knowledge graphs",
  onChunk: (chunk) => console.log(chunk),
  caller: "console-test/1.0",
});
// Each chunk is logged as it arrives
// result.text contains the complete response after completion
```

### Streaming into a custom DOM element

```js
// Create a floating panel to display the stream
const panel = document.createElement("div");
panel.style.cssText = "position:fixed;top:10px;right:10px;width:400px;max-height:300px;overflow:auto;background:#1a1a2e;color:#eee;padding:16px;border-radius:8px;z-index:9999;font-size:14px;white-space:pre-wrap;";
document.body.appendChild(panel);
panel.innerHTML = "<b>Streaming...</b><br>";

const result = await window.LiveAI_API.generate({
  prompt: "Explain the concept of spaced repetition in 3 paragraphs",
  streamTo: panel,
  onChunk: (chunk) => console.log("chunk:", chunk),
});

// After completion, update the panel
panel.innerHTML += "<br><br><i>Done!</i>";
setTimeout(() => panel.remove(), 5000);
```

### Cancellable request

```js
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000);

try {
  const result = await window.LiveAI_API.generate({
    prompt: "Detailed analysis of...",
    signal: controller.signal,
  });
  clearTimeout(timeout);
  console.log(result.text);
} catch (e) {
  if (e.name === "AbortError") console.log("Cancelled");
}
```
