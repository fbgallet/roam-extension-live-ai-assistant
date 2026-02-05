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
export const urlRegex =
  /(?:https?):\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)/g;
export const sbParamRegex = /^\{.*\}$/;
export const customTagRegex = {
  "liveai/prompt": /\#?\[?\[?liveai\/prompt\]?\]?/i,
  "liveai/style": /\#?\[?\[?liveai\/style\]?\]?/i,
  "liveai/outline": /\#?\[?\[?liveai\/outline\]?\]?/i,
  "liveai/template": /\#?\[?\[?liveai\/template\]?\]?/i,
};
export const builtInPromptRegex = /<built-in:([^>:]+)(?::([^>:]+))?>/i;
export const suggestionsComponentRegex = /\{\{or:\s?([^|]*)\|.*\}\}/;
export const roamQueryRegex = /\{\{\s*(\[\[query\]\]|query)\s*:/i;

export const getConjunctiveRegex = (allRegex) => {
  let totalRegexControl = "^";
  for (let i = 0; i < allRegex.length; i++) {
    totalRegexControl += `(?=.*${allRegex[i].replaceAll("(?i)", "")})`;
  }
  totalRegexControl += ".*";
  return totalRegexControl;
};
