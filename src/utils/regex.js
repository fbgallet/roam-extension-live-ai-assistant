export const uidRegex = /(?<!`)\(\([^\)`\s]{9}\)\)(?!\)?`)/g;
export const dnpUidRegex =
  /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])-(19|20)[0-9][0-9]$/;
export const flexibleUidRegex = /\(?\(?([^\)]{9})\)?\)?/;
export const pageRegex = /\[\[.*\]\]/g;
export const strictPageRegex = /^\[\[.*\]\]$/; // very simplified, not recursive...
export const embedRegex =
  /\{\{\[?\[?embed(-path|-children|)\]?\]?:\s?([^\}]+)\}\}/;
export const contextRegex = /\{\{context:\s?(.*)\}\}|\(\(context:\s?(.*)\)\)/;
export const templateRegex = /\(\(template:.?(\(\([^\)]{9}\)\))\)\)/;
export const dateStringRegex = /^[0-9]{2}-[0-9]{2}-[0-9]{4}$/;
export const numbersRegex = /\d+/g;
export const roamImageRegex = /!\[([^\]]*)\]\((http[^\s)]+)\)/g;
export const roamVideoRegex =
  /\{\{\[?\[?(video|youtube)\]?\]?:\s?(https?:[^\s}]+)\}/g;
export const youtubeRegex =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/;
export const videoStartTimeRegex =
  /(?:start|from):\s*(\d+):(\d+)|(?:start|from):\s*(\d+)/i;
export const videoEndTimeRegex =
  /(?:end|to):\s*(\d+):(\d+)|(?:end|to):\s*(\d+)/i;
export const roamAudioRegex =
  /\{\{\[?\[?audio\]?\]?:\s?(https?:[^\s}]+)\}\}|https?:[^\s)]+\.(mp3|wav|aiff|aac|ogg|flac|m4a)/gi;
export const pdfLinkRegex =
  /(http[^\s)]+\.pdf)|{{\[?\[?pdf\]?\]?:\s?(https?:[^\s})]+)}}/g;

// Attached documents other than PDF, which has its own dedicated handling.
// Plain-text formats are inlined as text and readable by every model; Office
// formats can only be parsed by OpenAI models (see multimodalAI).
export const textFileExtensions = [
  "md", "markdown", "txt", "text", "csv", "tsv", "json", "xml", "yaml", "yml",
  "org", "log", "js", "jsx", "ts", "tsx", "py", "rb", "java", "c", "h", "cpp",
  "cs", "go", "rs", "php", "sh", "sql", "css",
];
export const officeFileExtensions = [
  "docx", "doc", "pptx", "ppt", "xlsx", "xls", "rtf", "odt", "odp", "ods",
];
const anyFileExtension = [...textFileExtensions, ...officeFileExtensions].join(
  "|",
);
// Extensions that also end served pages and page assets. Recognized only in an
// explicit markdown link or on a graph-hosted url — in a bare external url they
// are far more often a page than an attachment, and probing them earns a CORS
// error on every request. Every other format is safe in a bare url: the
// path-segment requirement below already rules out the extensions that double
// as TLDs (.org, .sh, .rs, .md…), since a TLD can't end a path segment.
const webAssetExtensions = ["php", "js", "jsx", "ts", "tsx", "css"];
const bareUrlFileExtension = [...textFileExtensions, ...officeFileExtensions]
  .filter((extension) => !webAssetExtensions.includes(extension))
  .join("|");

// A url whose LAST PATH SEGMENT is a file name. Requiring a path segment is
// what keeps ordinary links out: many of these extensions are also TLDs, so
// allowing the extension right after the host would turn
// https://en.wikipedia.org/wiki/Roam into an "org-mode file" whose url is
// truncated to the domain. `.enc` covers encrypted graphs (which keep the real
// name in the path), and the optional query string MUST be part of the match
// because a Roam file url carries its access token there — truncate it and the
// request 403s.
const fileUrlTail = (extensions) =>
  `/[^\\s)\\]/]*\\.(?:${extensions})(?![\\w])(?:\\.enc)?(?:\\?[^\\s)\\]]*)?`;

const graphFileHost = `firebasestorage\\.googleapis\\.com`;

// Four shapes:
//  0. [name.ext](graph-hosted url) — Roam stores some attachments under a url
//     that carries NO extension at all (…/o/imgs%2Fapp%2Fgraph%2FACUn9VIqwz),
//     so for the graph's own files the markdown label is the only place the
//     file name exists. Trusting it is safe here because the host is the
//     graph's own storage; doing it for any host is what made a
//     [CHANGELOG.md](github.com/user/repo) link look like a markdown file.
//  1. [any label](url whose path ends in a file name) — the url decides.
//  2. bare graph-hosted url, in any supported format.
//  3. bare url on any host, for every format except the page/asset extensions.
export const attachedFileRegex = new RegExp(
  `\\[(?<label>[^\\]\\n]*?\\.(?:${anyFileExtension}))\\]\\((?<url0>https?://${graphFileHost}[^\\s)]*)\\)` +
    `|\\[[^\\]\\n]*\\]\\((?<url1>https?://[^\\s)\\]]*${fileUrlTail(
      anyFileExtension,
    )})\\)` +
    `|(?<url2>https?://${graphFileHost}[^\\s)\\]]*${fileUrlTail(
      anyFileExtension,
    )})` +
    `|(?<url3>https?://[^\\s)\\]]*${fileUrlTail(bareUrlFileExtension)})`,
  "gi",
);
export const urlRegex =
  /(?:https?):\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)/g;
export const sbParamRegex = /^\{.*\}$/;
export const customTagRegex = {
  "liveai/prompt": /\#?\[?\[?liveai\/prompt\]?\]?/i,
  "liveai/style": /\#?\[?\[?liveai\/style\]?\]?/i,
  "liveai/outline": /\#?\[?\[?liveai\/outline\]?\]?/i,
  "liveai/template": /\#?\[?\[?liveai\/template\]?\]?/i,
  "liveai/role": /\#?\[?\[?liveai\/role\]?\]?/i,
  "liveai/debate-preset": /\#?\[?\[?liveai\/debate-preset\]?\]?/i,
};
export const builtInPromptRegex = /<built-in:([^>:]+)(?::([^>:]+))?>/i;
export const suggestionsComponentRegex = /\{\{or:\s?([^|]*)\|.*\}\}/;
export const roamQueryRegex = /\{\{\s*(\[\[query\]\]|query)\s*:/i;
export const calloutRegex =
  /^\[\[>\]\]\s+\[\[!(?:NOTE|INFO|SUMMARY|ABSTRACT|TLDR|TIP|HINT|IMPORTANT|SUCCESS|QUESTION|HELP|FAQ|WARNING|CAUTION|ATTENTION|FAILURE|FAIL|MISSING|DANGER|ERROR|BUG|EXAMPLE|QUOTE)\]\]/i;

export const getConjunctiveRegex = (allRegex) => {
  let totalRegexControl = "^";
  for (let i = 0; i < allRegex.length; i++) {
    totalRegexControl += `(?=.*${allRegex[i].replaceAll("(?i)", "")})`;
  }
  totalRegexControl += ".*";
  return totalRegexControl;
};
