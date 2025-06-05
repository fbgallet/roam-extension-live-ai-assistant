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
  let codeBlockBaseIndent = 0;
  const lines = text.split("\n");
  let currentParentRef = parentBlockRef;
  let stack = [{ level: 0, ref: parentBlockRef }];
  let minTitleLevel = null;
  let inCodeBlock = false;
  let blockType = null; // 'code' or 'katex'
  let codeBlockContent = "";
  let isInListCodeBlock = false;
  let isFistParent = true;
  let position = isParentToReplace
    ? getBlockOrderByUid(parentBlockRef)
    : undefined;

  // Browse first to identify the minimum heading level
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine && !inCodeBlock) continue;

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

    // If we are in a code block, look for the end
    if (inCodeBlock) {
      const trimmedLine = line.trim();
      if (
        (blockType === "code" && trimmedLine.startsWith("```")) ||
        (blockType === "katex" &&
          (trimmedLine === "$$" || trimmedLine.endsWith("$$")))
      ) {
        // End of code block
        inCodeBlock = false;
        blockType = null;
        isInListCodeBlock = false; // Reset flag
        codeBlockContent += "\n" + trimmedLine;

        // Create the code block
        const codeParentRef =
          stack.length > 0 ? stack[stack.length - 1].ref : parentBlockRef;
        const newBlockRef = await createChildBlock(
          codeParentRef,
          codeBlockContent
        );

        hierarchyTracker.set(i, {
          level: stack.length > 0 ? stack[stack.length - 1].level + 1 : 1,
          ref: newBlockRef,
          isHeader: false,
          headerLevel: null,
          indentLevel: Math.floor(line.match(/^ */)[0].length / 2),
          isCodeBlock: true,
        });

        codeBlockContent = "";
        continue;
      } else {
        // Add the line to the code block
        if (!line.trim()) {
          codeBlockContent += "\n";
        } else {
          const leadingSpaces = line.match(/^ */)[0].length;

          let relativeIndent;
          if (isInListCodeBlock) {
            relativeIndent = Math.max(0, leadingSpaces - codeBlockBaseIndent);
          } else {
            relativeIndent = Math.max(0, leadingSpaces - codeBlockBaseIndent);
          }

          const adjustedLine = " ".repeat(relativeIndent) + line.trimStart();
          codeBlockContent += "\n" + adjustedLine;
        }
        continue;
      }
    }

    if (!line.trim()) continue;

    // Detect indentation by spaces
    const leadingSpaces = line.match(/^ */)[0].length;
    const indentLevel = Math.floor(leadingSpaces / 2);
    let trimmedLine = line.trimStart();

    // Handle code blocks and Katex multi-lines
    if (
      trimmedLine.startsWith("```") ||
      trimmedLine.startsWith("$$") ||
      (trimmedLine.includes("$$") &&
        !trimmedLine.match(/\$\$.*\$\$/) &&
        !trimmedLine.endsWith("$$"))
    ) {
      // Check if it's a single-line Katex block
      if (
        trimmedLine.includes("$$") &&
        trimmedLine.match(/\$\$.*\$\$/) &&
        !trimmedLine.includes("\\begin")
      ) {
        // Single-line Katex, treat as normal content - don't continue
      } else {
        // Begin multi-line block
        inCodeBlock = true;
        isInListCodeBlock = false; // Reset flag
        if (trimmedLine.startsWith("```")) {
          blockType = "code";
          codeBlockContent = trimmedLine;
          codeBlockBaseIndent = leadingSpaces;
        } else {
          blockType = "katex";
          if (trimmedLine.includes("$$") && !trimmedLine.startsWith("$$")) {
            const katexStart = trimmedLine.indexOf("$$");
            codeBlockContent = trimmedLine.substring(katexStart);
          } else {
            codeBlockContent = trimmedLine;
          }
          codeBlockBaseIndent = leadingSpaces;
        }
        continue;
      }
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
    // 5. Bullets (-, •, *) - but not if followed by code block
    else if (
      trimmedLine.match(/^[-•*]\s+/) &&
      !trimmedLine.match(/^[-•*]\s+```/)
    ) {
      content = trimmedLine.replace(/^[-•*]\s+/, "");
      listMatchType = "bullet";
      isList = true;
    }
    // Code blocks that start with list markers
    else if (trimmedLine.match(/^[-•*]\s+```/)) {
      const codeStart = trimmedLine.replace(/^[-•*]\s+/, "");
      inCodeBlock = true;
      blockType = "code";
      codeBlockContent = codeStart;
      isInListCodeBlock = true;
      codeBlockBaseIndent = leadingSpaces + 2; // +2 pour compenser "- "
      continue;
    }

    // Determine the correct parent and clean the stack
    if (isHeader) {
      // For headers, clean the stack according to hierarchy level
      while (
        stack.length > 1 &&
        stack[stack.length - 1].level >= hierarchyLevel
      ) {
        stack.pop();
      }
      currentParentRef = stack[stack.length - 1].ref;
    } else {
      // For non-header elements, handle indentation and hierarchy
      let targetLevel = hierarchyLevel;
      let foundParent = false;

      // Find the appropriate parent by looking backwards
      for (let j = i - 1; j >= 0; j--) {
        const prevInfo = hierarchyTracker.get(j);
        if (!prevInfo) continue;

        // For indented content, find parent with lower indentation
        if (indentLevel > 0) {
          if (prevInfo.indentLevel < indentLevel) {
            targetLevel = prevInfo.level + 1;
            foundParent = true;
            break;
          }
        } else {
          // For root level content (indentLevel === 0)
          if (prevInfo.isHeader) {
            // Place under the most recent header
            targetLevel = prevInfo.level + 1;
            foundParent = true;
            break;
          } else if (
            prevInfo.indentLevel === 0 &&
            !prevInfo.isList &&
            !isList
          ) {
            // Same level paragraphs
            targetLevel = prevInfo.level;
            foundParent = true;
            break;
          } else if (prevInfo.indentLevel === 0 && prevInfo.isList && isList) {
            // Same level lists
            targetLevel = prevInfo.level;
            foundParent = true;
            break;
          } else if (prevInfo.indentLevel === 0 && !prevInfo.isList && isList) {
            // List under paragraph
            targetLevel = prevInfo.level + 1;
            foundParent = true;
            break;
          } else if (prevInfo.indentLevel === 0 && prevInfo.isList && !isList) {
            // Paragraph after list - find the level of the content before the list
            let beforeListLevel = 1; // default
            for (let k = j - 1; k >= 0; k--) {
              const beforeInfo = hierarchyTracker.get(k);
              if (
                beforeInfo &&
                beforeInfo.indentLevel === 0 &&
                !beforeInfo.isList
              ) {
                beforeListLevel = beforeInfo.level;
                break;
              }
            }
            targetLevel = beforeListLevel;
            foundParent = true;
            break;
          }
        }
      }

      if (!foundParent) {
        // Default: use the last element from stack
        targetLevel = stack.length > 0 ? stack[stack.length - 1].level + 1 : 1;
      }

      hierarchyLevel = targetLevel;

      // Clean the stack to match target level
      while (
        stack.length > 1 &&
        stack[stack.length - 1].level >= hierarchyLevel
      ) {
        stack.pop();
      }

      currentParentRef = stack[stack.length - 1].ref;
    }

    let newBlockRef;
    let heading = isHeader ? (headerLevel > 3 ? 3 : headerLevel) : undefined;

    // Handle list prefixes
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

    // Create the block
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

    // Update the stack with the new block
    if (newBlockRef) {
      // Add the new block to the stack
      stack.push({ level: hierarchyLevel, ref: newBlockRef });
    }

    // Store hierarchy information
    hierarchyTracker.set(i, {
      level: hierarchyLevel,
      ref: newBlockRef,
      indentLevel: indentLevel,
      isHeader: isHeader,
      headerLevel: headerLevel,
      isList: isList,
      listMatchType: listMatchType,
      parentRef: currentParentRef,
      isCodeBlock: false,
    });
  }
};
