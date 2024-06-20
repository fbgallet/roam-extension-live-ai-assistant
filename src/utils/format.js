import { createChildBlock } from "./utils";

const codeBlockRegex = /\`\`\`([^\`\`\`]*\n[^\`\`\`]*)\`\`\`/g;
const jsonContentStringRegex = /"content": "([^"]*\n[^"]*)+"/g;
const notEscapedBreakLineRegex = /(?<!\\)\n/g;
const markdownHeadingRegex = /^#+\s/m;
const dashRegex = /^\s*-\s/m;

export const trimOutsideOuterBraces = (str) => {
  const matches = str.match(/\{.*\}/gs);
  if (matches) {
    return matches[0];
  } else {
    return "";
  }
};

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
  // clean double line break
  str = str.replace(/\n\s*\n/g, "\n\n");
  // change double line break of codeblocks to exclude them on the split process
  str = str.replace(codeBlockRegex, (match) => match.replace(/\n\n/g, "\n \n"));
  return str.split(`\n\n`);
};

export const splitLines = async (str, parentUid) => {
  let levelsUid = [parentUid];
  if (
    !codeBlockRegex.test(str) &&
    (markdownHeadingRegex.test(str) || dashRegex.test(str))
  ) {
    let level = 0;
    let isDash = false;
    let lastBlockUid = parentUid;
    const lines = str.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (markdownHeadingRegex.test(lines[i])) {
        const matchingHeading = lines[i].match(markdownHeadingRegex);
        const headingUid = await createChildBlock(
          levelsUid[level],
          lines[i].replace(matchingHeading[0], ""),
          "last",
          true,
          matchingHeading[0].length - 1
        );
        lastBlockUid = headingUid;
        level++;
        levelsUid.push(headingUid);
      } else if (dashRegex.test(lines[i])) {
        if (!isDash) {
          isDash = true;
          level++;
          levelsUid.push(lastBlockUid);
        }
        const matchingDash = lines[i].match(dashRegex);
        const dashUid = await createChildBlock(
          lastBlockUid,
          lines[i].replace(matchingDash[0], "")
        );
      } else {
        if (isDash) {
          level--;
          isDash = false;
        }
        lastBlockUid = await createChildBlock(levelsUid[level], lines[i]);
      }
      console.log(level);
    }
  } else await createChildBlock(parentUid, str);
};
