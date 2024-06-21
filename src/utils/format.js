import { createChildBlock } from "./utils";

const codeBlockRegex = /\`\`\`([^\`\`\`]*\n[^\`\`\`]*)\`\`\`/g;
const jsonContentStringRegex = /"content": "([^"]*\n[^"]*)+"/g;
const notEscapedBreakLineRegex = /(?<!\\)\n/g;
const markdownHeadingRegex = /^#+\s/m;
const dashOrNumRegex = /^\s*-\s|^\d{1,2}\.\s/m;

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

export const splitLines = async (str, parentUid, lastParentUid) => {
  let levelsUid = [parentUid];
  if (
    !codeBlockRegex.test(str) &&
    (markdownHeadingRegex.test(str) || dashOrNumRegex.test(str))
  ) {
    let level = 0;
    let isDash = false;
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
      } else if (dashOrNumRegex.test(lines[i])) {
        if (!isDash) {
          isDash = true;
          level++;
          levelsUid.push(lastParentUid || parentUid);
        }
        const matchingDash = lines[i].match(dashOrNumRegex);
        await createChildBlock(
          levelsUid[level],
          matchingDash[0].includes("-")
            ? lines[i].replace(matchingDash[0], "")
            : lines[i]
        );
      } else {
        if (isDash) {
          level--;
          isDash = false;
        }
        lastParentUid = await createChildBlock(levelsUid[level], lines[i]);
      }
    }
    return lastParentUid;
  } else return await createChildBlock(parentUid, str);
};
