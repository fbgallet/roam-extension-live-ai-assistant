import { createChildBlock } from "./utils";

const codeBlockRegex = /\`\`\`((?:(?!\`\`\`)[\s\S])*?)\`\`\`/g;
const jsonContentStringRegex = /"content": "([^"]*\n[^"]*)+"/g;
const notEscapedBreakLineRegex = /(?<!\\)\n/g;
export const hierarchyFlagRegex =
  /^\s*\(?[-\d](?:\.|\))\s*|^\s*[a-z]\)\s*|^\s*[ivx]+(?:\.|\))\s*|^\s*#{1,6}\s|^\s*(?:-|•)\s?/im;
export const dashOrNumRegex = /^\s*-\s|^\d{1,2}\.\s/m;

export const trimOutsideOuterBraces = (str) => {
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

// Fonction principale pour parser le texte hiérarchisé et créer des blocs dans RoamResearch
export const parseAndCreateBlocks = async (parentBlockRef, text) => {
  const lines = text.split("\n");
  let currentParentRef = parentBlockRef;
  let stack = [{ level: 0, ref: parentBlockRef }];
  let minTitleLevel;
  let updatedMinLevel = false;
  let inCodeBlock = false;
  let codeBlockContent = "";

  for (const line of lines) {
    if (!line.trim()) continue;

    let trimmedLine = line.trim();
    // Handle codeblocks (multiline)
    if (trimmedLine.startsWith("```")) {
      if (!inCodeBlock) {
        // Codeblock begin
        inCodeBlock = true;
        codeBlockContent = trimmedLine + "\n";
      } else {
        // Codeblock end
        inCodeBlock = false;
        codeBlockContent += trimmedLine;
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
      codeBlockContent += trimmedLine + "\n";
      continue;
    }

    const { level, titleDegree } = getLevel(line, minTitleLevel);

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

    const newBlockRef = await createChildBlock(
      currentParentRef,
      content,
      "last",
      true,
      titleDegree ? (titleDegree > 3 ? 3 : titleDegree) : undefined
    );
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

  if (/^\*?\*?\(?\d+(?:\.|\))/.test(trimmedLine)) level += 1; // Numbers 1. 2. or 1) 2)
  if (/^\*?\*?[a-z]\)/.test(trimmedLine)) level += 1; // Lettres a) b) etc.
  if (/^\*?\*?[ivx]+(?:\.|\))/i.test(trimmedLine)) level += 1; // Roman numbers i) ii) or I. II.
  if (/^\*?\*?(?:-|•)\s?/.test(trimmedLine)) level += 1; // Dash -

  return { level, titleDegree };
}
