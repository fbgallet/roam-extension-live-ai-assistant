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
  let currentParentRef = parentBlockRef;
  let stack = [{ level: 0, ref: parentBlockRef }];
  let minTitleLevel = null;
  let inCodeBlock = false;
  let codeBlockContent = "";
  let isFistParent = true;
  let position = isParentToReplace
    ? getBlockOrderByUid(parentBlockRef)
    : undefined;

  // Browse first to identify the minimum heading level
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const headerMatch = trimmedLine.match(/^(#{1,6})\s+/);
    if (headerMatch) {
      const headerLevel = headerMatch[1].length;
      minTitleLevel =
        minTitleLevel === null
          ? headerLevel
          : Math.min(minTitleLevel, headerLevel);
    }
  }

  minTitleLevel = minTitleLevel || 1;

  const hierarchyTracker = new Map();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Detect indentation by spaces
    const leadingSpaces = line.match(/^ */)[0].length;
    const indentLevel = Math.floor(leadingSpaces / 2);
    let trimmedLine = line.trimStart();

    // Handle code blocks and Katex multi-lines
    if (trimmedLine.startsWith("```") || trimmedLine.startsWith("$$")) {
      if (!inCodeBlock) {
        // Begin
        inCodeBlock = true;
        codeBlockContent = line + "\n";
      } else {
        // End
        inCodeBlock = false;
        codeBlockContent += line;

        const codeParentRef =
          stack.length > 0 ? stack[stack.length - 1].ref : parentBlockRef;

        const newBlockRef = await createChildBlock(
          codeParentRef,
          codeBlockContent
        );

        hierarchyTracker.set(i, {
          level: indentLevel,
          ref: newBlockRef,
          isHeader: false,
          headerLevel: null,
          indentLevel: indentLevel,
        });

        codeBlockContent = "";
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent += line + "\n";
      continue;
    }

    // Line analysis
    let content = trimmedLine;
    let hierarchyLevel = indentLevel;
    let isHeader = false;
    let headerLevel = null;
    let isList = false;
    let listMatchType = null;

    // 1. Is it a header ?
    const headerMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      headerLevel = headerMatch[1].length;
      content = headerMatch[2].trim();
      hierarchyLevel = headerLevel - minTitleLevel;
      isHeader = true;
    }
    // 2. Numbered list (1., 2., etc.)
    else if (trimmedLine.match(/^\d+[.)]\s+/)) {
      content = trimmedLine.replace(/^\d+[.)]\s+/, "");
      listMatchType = "numeric";
      isList = true;
    }
    // 3. Alpha list (a., b., A., B., etc.)
    else if (trimmedLine.match(/^[a-zA-Z][.)]\s+/)) {
      content = trimmedLine.replace(/^[a-zA-Z][.)]\s+/, "");
      listMatchType = "alpha";
      isList = true;
    }
    // 4. Roman numbers (i., ii., I., II., etc.)
    else if (trimmedLine.match(/^[ivx]+[.)]\s+|^[IVX]+[.)]\s+/i)) {
      content = trimmedLine.replace(/^[ivx]+[.)]\s+|^[IVX]+[.)]\s+/i, "");
      listMatchType = "roman";
      isList = true;
    }
    // 5. Bullets (-, •, *)
    else if (trimmedLine.match(/^[-•*]\s+/)) {
      content = trimmedLine.replace(/^[-•*]\s+/, "");
      listMatchType = "bullet";
      isList = true;
    }

    let parentInfo = null;

    if (isHeader) {
      for (let j = i - 1; j >= 0; j--) {
        const prevInfo = hierarchyTracker.get(j);
        if (
          prevInfo &&
          prevInfo.isHeader &&
          prevInfo.headerLevel < headerLevel
        ) {
          parentInfo = prevInfo;
          break;
        }
      }

      // first level ?
      if (!parentInfo) {
        stack = [{ level: 0, ref: parentBlockRef }];
        currentParentRef = parentBlockRef;
      } else {
        while (
          stack.length > 0 &&
          stack[stack.length - 1].level >= hierarchyLevel
        ) {
          stack.pop();
        }
        currentParentRef = parentInfo.ref;
        if (
          stack.length === 0 ||
          stack[stack.length - 1].ref !== currentParentRef
        ) {
          stack.push({ level: hierarchyLevel - 1, ref: currentParentRef });
        }
      }
    } else {
      // Special case: first line after a title is a child of this title
      let foundParent = false;
      for (let j = i - 1; j >= 0; j--) {
        const prevInfo = hierarchyTracker.get(j);
        if (!prevInfo) continue;
        if (
          prevInfo.indentLevel !== undefined &&
          prevInfo.indentLevel < indentLevel
        ) {
          parentInfo = prevInfo;
          foundParent = true;
          break;
        }

        if (prevInfo.isHeader) {
          parentInfo = prevInfo;
          if (j === i - 1 && !isList && indentLevel === 0) {
            hierarchyLevel = prevInfo.level + 1;
          }
          foundParent = true;
          break;
        } else if (
          prevInfo.isList &&
          listMatchType !== "numeric" &&
          j === i - 1 &&
          !isList
        ) {
          parentInfo = prevInfo;
          hierarchyLevel = prevInfo.level + 1;
          foundParent = true;
          break;
        }
      }
      if (!foundParent) {
        currentParentRef = parentBlockRef;
      } else if (parentInfo) {
        while (
          stack.length > 0 &&
          stack[stack.length - 1].level >= hierarchyLevel
        ) {
          stack.pop();
        }
        if (isList && indentLevel > 0) {
          const prevLine = i > 0 ? hierarchyTracker.get(i - 1) : null;
          const prevIndentLevel =
            prevLine && prevLine.indentLevel !== undefined
              ? prevLine.indentLevel
              : 0;
          if (indentLevel > prevIndentLevel && stack.length > 0) {
            currentParentRef = stack[stack.length - 1].ref;
            hierarchyLevel = stack[stack.length - 1].level + 1;
          } else {
            currentParentRef = parentInfo.ref;
          }
        } else {
          currentParentRef = parentInfo.ref;
        }
      }
    }

    let newBlockRef;
    let heading = isHeader ? (headerLevel > 3 ? 3 : headerLevel) : undefined;

    if (isList) {
      let listPrefix = "";
      if (listMatchType === "numeric") {
        const numMatch = trimmedLine.match(/^(\d+[.)])\s+/);
        listPrefix = numMatch ? numMatch[1] + " " : "";
      } else if (listMatchType === "alpha") {
        const alphaMatch = trimmedLine.match(/^([a-zA-Z][.)])\s+/);
        listPrefix = alphaMatch ? alphaMatch[1] + " " : "";
      } else if (listMatchType === "roman") {
        const romanMatch = trimmedLine.match(
          /^([ivx]+[.]|[IVX]+[.]|[ivx]+[)]|[IVX]+[)])\s+/i
        );
        listPrefix = romanMatch ? romanMatch[1] + " " : "";
      }

      if (listPrefix) {
        content = listPrefix + content;
      }
    }

    if (position === undefined || !isFistParent) {
      newBlockRef = await createChildBlock(
        currentParentRef,
        content,
        "last",
        true,
        heading
      );
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

    if (newBlockRef) {
      stack.push({ level: hierarchyLevel, ref: newBlockRef });
    }

    hierarchyTracker.set(i, {
      level: hierarchyLevel,
      ref: newBlockRef,
      indentLevel: indentLevel,
      isHeader: isHeader,
      headerLevel: headerLevel,
      isList: isList,
    });
  }
};
