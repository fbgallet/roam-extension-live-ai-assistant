import { isResponseToSplit } from "..";
import {
  addContentToBlock,
  createChildBlock,
  createSiblingBlock,
  getBlockOrderByUid,
  updateBlock,
} from "./roamAPI";

const codeBlockRegex = /\`\`\`((?:(?!\`\`\`)[\s\S])*?)\`\`\`/g;
const jsonContentStringRegex = /"content": "([^"]*\n[^"]*)+"/g;
const notEscapedBreakLineRegex = /(?<!\\)\n/g;
export const hierarchyFlagRegex =
  /^\s*\(?[-\d](?:\.|\))\s*|^\s*[a-z]\)\s*|^\s*[ivx]+(?:\.|\))\s*|^\s*#{1,6}\s|^\s*(?:-|•)\s?/im;
export const dashOrNumRegex = /^\s*-\s|^\d{1,2}\.\s/m;

export const yearToWords = {
  2023: "two thousand twenty-three",
  2024: "two thousand twenty-four",
  2025: "two thousand twenty-five",
  2026: "two thousand twenty-six",
  2027: "two thousand twenty-seven",
  2028: "two thousand twenty-eight",
  2029: "two thousand twenty-nine",
  2030: "two thousand thirty",
};

export const trimOutsideOuterBraces = (str) => {
  if (!str) return str;
  const matches = str.match(/\{.*\}/gs);
  if (matches) {
    return matches[0];
  } else {
    return str;
  }
};

export const sanitizeJSONstring = (str) => {
  codeBlockRegex.lastIndex = 0;
  let sanitized = str
    // escape line break in code blocks
    .replace(codeBlockRegex, (match) => match.replace(/\n/g, "\\n"))
    // escape line break in all content string, if not already escaped
    .replace(jsonContentStringRegex, (match) =>
      match.replace(notEscapedBreakLineRegex, " \\n")
    );
  return sanitized;
};

export const sanitizeClaudeJSON = (str) => {
  if (!str) return str;
  str = trimOutsideOuterBraces(str);
  str = str.replace(/\\"/g, '"');
  str = str.replace(/(begin|end|relative)/g, '"$1"');
  str = sanitizeJSONstring(str);
  return str;
};

export const balanceBraces = (str) => {
  if (!str) return str;
  str = str.trim();
  const openBraces = (str.match(/{/g) || []).length;
  const closeBraces = (str.match(/}/g) || []).length;
  if (openBraces === closeBraces) return str;
  // if (!str.startsWith('{') || !str.endsWith('}')) {
  //   throw new Error('str has to begin and end with braces');
  // }
  const diff = openBraces - closeBraces;
  if (diff > 0) {
    return str + "}".repeat(diff);
  } else if (diff < 0) {
    return str + "{".repeat(Math.abs(diff));
  }
  return str;
};

export const splitParagraphs = (str) => {
  codeBlockRegex.lastIndex = 0;
  // clean double line break
  str = str.replace(/\n\s*\n/g, "\n\n");
  // change double line break of codeblocks to exclude them on the split process
  str = str.replace(codeBlockRegex, (match) => match.replace(/\n\n/g, "\n \n"));
  return str.split(`\n\n`);
};

export const parseAndCreateBlocks = async (
  parentBlockRef,
  text,
  isParentToReplace = false
) => {
  const lines = text.split("\n");
  // console.log("lines :>> ", lines);
  let currentParentRef = parentBlockRef;
  let stack = [{ level: 0, ref: parentBlockRef }];
  let minTitleLevel;
  let minLevel;
  let updatedMinLevel = false;
  let inCodeBlock = false;
  let codeBlockContent = "";
  let codeBlockShift = 0;
  let isFistParent = true;
  let position = isParentToReplace
    ? getBlockOrderByUid(parentBlockRef)
    : undefined;

  for (const line of lines) {
    if (!line.trim()) continue;

    let trimmedLine = line.trimStart();
    // Handle codeblocks (multiline)
    if (trimmedLine.startsWith("```")) {
      if (!inCodeBlock) {
        // Codeblock begin
        codeBlockShift = line.length - trimmedLine.length;
        inCodeBlock = true;
        codeBlockContent = line.slice(codeBlockShift) + "\n";
      } else {
        // Codeblock end
        inCodeBlock = false;
        codeBlockContent += line.slice(codeBlockShift);
        const newBlockRef = await createChildBlock(
          currentParentRef,
          codeBlockContent
        );
        stack.push({
          level: stack[stack.length - 1].level + 1,
          ref: newBlockRef,
        });
        codeBlockContent = "";
      }
      continue;
    }
    if (inCodeBlock) {
      codeBlockContent += line.slice(codeBlockShift) + "\n";
      continue;
    }

    const { level, titleDegree } = getLevel(line, minTitleLevel);

    if (minLevel === undefined) minLevel = level;

    if (titleDegree !== null) {
      if (!updatedMinLevel) {
        minTitleLevel = minTitleLevel
          ? Math.min(minTitleLevel, titleDegree)
          : titleDegree;
        updatedMinLevel = true;
      }
      trimmedLine = trimmedLine.replace(/^#{1,6}\s*/, "").trim();
    }

    // const content = trimmedLine.startsWith("- ") || trimmedLine.startsWith("• ")
    const content = /^(?:-|•)\s?/.test(trimmedLine)
      ? trimmedLine.slice(trimmedLine.match(/^(?:-|•)\s?/).length).trim()
      : trimmedLine;

    // Get parent of current block
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    currentParentRef =
      stack[stack.length - 1] !== undefined
        ? stack[stack.length - 1].ref
        : parentBlockRef;

    let newBlockRef;
    let heading = titleDegree ? (titleDegree > 3 ? 3 : titleDegree) : undefined;

    if (position === undefined || level > minLevel) {
      newBlockRef = await createChildBlock(
        currentParentRef,
        content,
        "last",
        true,
        heading
      );
      //  await new Promise((resolve) => setTimeout(resolve, 10));
    } else if (position !== undefined && !isFistParent) {
      newBlockRef = await createSiblingBlock(
        currentParentRef,
        position++,
        content,
        { open: true, heading }
      );
      //  await new Promise((resolve) => setTimeout(resolve, 10));
    } else if (isFistParent) {
      newBlockRef = currentParentRef;
      position++;
      updateBlock({
        blockUid: currentParentRef,
        newContent: content,
        format: { heading },
      });
      isFistParent = false;
    }
    stack.push({ level, ref: newBlockRef });
  }
};

function getLevel(line, minTitleLevel) {
  let level = 0;
  let titleDegree = null;

  const spaces = line.match(/^ */)[0].length;
  level = spaces;

  let trimmedLine = line.trim();

  // Markdown title
  const titleMatch = trimmedLine.match(/^#{1,6}\s/);
  if (titleMatch) {
    titleDegree = titleMatch[0].trim().length; // Le nombre de # correspond au degré de titre
    level = titleDegree - (minTitleLevel ? minTitleLevel : titleDegree); // Ajuster le niveau en fonction du titre le plus élevé
    return { level, titleDegree };
  }

  if (/^\*?\*?\(?\d+(?:\.|\))/.test(trimmedLine))
    level += 1; // Numbers 1. 2. or 1) 2)
  else if (/^\*?\*?[a-z]\)/.test(trimmedLine)) level += 1; // Lettres a) b) etc.
  else if (/^\*?\*?[ivx]+(?:\.|\))/i.test(trimmedLine))
    level += 1; // Roman numbers i) ii) or I. II.
  else if (/^\*?\*?(?:-|•)\s?/.test(trimmedLine)) level += 1; // Dash -

  return { level, titleDegree };
}
