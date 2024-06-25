import { createChildBlock, getBlockContentByUid } from "./utils";

const codeBlockRegex = /\`\`\`([^\`\`\`]*\n[^\`\`\`]*)\`\`\`/g;
const jsonContentStringRegex = /"content": "([^"]*\n[^"]*)+"/g;
const notEscapedBreakLineRegex = /(?<!\\)\n/g;
const markdownHeadingRegex = /^#+\s/m;
export const dashOrNumRegex = /^\s*-\s|^\d{1,2}\.\s/m;

export const trimOutsideOuterBraces = (str) => {
  const matches = str.match(/\{.*\}/gs);
  if (matches) {
    return matches[0];
  } else {
    return "";
  }
};

export const sanitizeJSONstring = (str) => {
  codeBlockRegex.lastIndex = 0;
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
  codeBlockRegex.lastIndex = 0;
  // clean double line break
  str = str.replace(/\n\s*\n/g, "\n\n");
  // change double line break of codeblocks to exclude them on the split process
  str = str.replace(codeBlockRegex, (match) => match.replace(/\n\n/g, "\n \n"));
  return str.split(`\n\n`);
};

export const splitLines = async (str, parentUid, lastParentUid, level = 0) => {
  let levelsUid = [parentUid];
  codeBlockRegex.lastIndex = 0;
  if (
    !codeBlockRegex.test(str) &&
    (markdownHeadingRegex.test(str) || dashOrNumRegex.test(str))
  ) {
    let isDash = false;
    let isNum = false;
    let lastBlockUid;
    const lines = str.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (markdownHeadingRegex.test(lines[i])) {
        const matchingHeading = lines[i].match(markdownHeadingRegex);
        const headingLevel = matchingHeading[0].length - 1;
        const headingUid = await createChildBlock(
          levelsUid[level],
          lines[i].replace(matchingHeading[0], ""),
          "last",
          true,
          headingLevel > 3 ? 3 : headingLevel
        );
        lastParentUid = headingUid;
        level++;
        levelsUid.push(headingUid);
        if (lines.length === 1) return { lastParentUid, level };
      } else if (dashOrNumRegex.test(lines[i])) {
        const matchingDash = lines[i].match(dashOrNumRegex);
        if (!isDash && matchingDash[0].includes("-")) {
          isDash = true;
          level++;
          levelsUid.push(isNum ? lastBlockUid : lastParentUid || parentUid);
        } else if (!isNum && !matchingDash[0].includes("-")) {
          isNum = true;
          level++;
          levelsUid.push(isDash ? lastBlockUid : lastParentUid || parentUid);
        }
        lastBlockUid = await createChildBlock(
          levelsUid[level],
          matchingDash[0].includes("-")
            ? lines[i].replace(matchingDash[0], "")
            : lines[i]
        );
      } else {
        if (isDash || isNum) {
          // level--;
          isDash = false;
          isNum = false;
        }
        lastParentUid = await createChildBlock(levelsUid[level], lines[i]);
        if (lines.length === 1) return { lastParentUid, level };
      }
    }
    return { lastParentUid, level: 0 };
  } else return await createChildBlock(parentUid, str);
};
