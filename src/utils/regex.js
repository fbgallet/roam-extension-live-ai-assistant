export const uidRegex = /\(\([^\)]{9}\)\)/g;
export const dnpUidRegex =
  /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])-(19|20)\d{2}$/;
export const flexibleUidRegex = /\(?\(?([^\)]{9})\)?\)?/;
export const pageRegex = /\[\[.*\]\]/g;
export const strictPageRegex = /^\[\[.*\]\]$/; // very simplified, not recursive...
export const contextRegex = /\(\(context:.?(.*)\)\)/;
export const templateRegex = /\(\(template:.?(\(\([^\)]{9}\)\))\)\)/;
export const dateStringRegex = /^[0-9]{2}-[0-9]{2}-[0-9]{4}$/;
export const numbersRegex = /\d+/g;
export const roamImageRegex = /!\[[^\]]*\]\((http[^\s)]+)\)/g;
export const sbParamRegex = /^\{.*\}$/;
export const customPromptTagRegex = /\#?\[?\[?liveai\/prompt\]?\]?/i;
export const customStyleTagRegex = /\#?\[?\[?liveai\/style\]?\]?/i;
export const builtInPromptRegex = /<built-in:([^>:]+)(?::([^>:]+))?>/i;
