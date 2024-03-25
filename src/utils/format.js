const codeBlockRegex = /\`\`\`([^\`\`\`]*\n[^\`\`\`]*)\`\`\`/g;
const jsonContentStringRegex = /"content": "([^"]*\n[^"]*)+"/g;
const notEscapedBreakLineRegex = /(?<!\\)\n/g;

export const sanitizeJSONstring = (str) => {
  let sanitized = str
    // escape line break in code blocks
    .replace(codeBlockRegex, (match) => match.replace(/\n/g, "\\n"))
    // escape line break in all content string, if not already escaped
    .replace(jsonContentStringRegex, (match) =>
      match.replace(notEscapedBreakLineRegex, "\\n")
    );
  return sanitized;
};

export const splitParagraphs = (str) => {
  // change double break line of codeblocks to exclude them on the split process
  str = str.replace(codeBlockRegex, (match) => match.replace(/\n\n/g, "\n \n"));
  return str.split(`\n\n`);
};
