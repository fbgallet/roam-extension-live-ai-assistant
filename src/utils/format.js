import { createChildBlock, getBlockContentByUid } from "./utils";

const codeBlockRegex = /\`\`\`((?:(?!\`\`\`)[\s\S])*?)\`\`\`/g;
const jsonContentStringRegex = /"content": "([^"]*\n[^"]*)+"/g;
const notEscapedBreakLineRegex = /(?<!\\)\n/g;
const markdownHeadingRegex = /^#+\s/m;
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
  let inCodeBlock = false; // Flag pour suivre si on est dans un bloc de code
  let codeBlockContent = ""; // Contenu accumulé pour le bloc de code

  for (const line of lines) {
    if (!line.trim()) continue; // Ignore les lignes vides et passe à la suivante

    let trimmedLine = line.trim();
    // Gestion des blocs de code
    if (trimmedLine.startsWith("```")) {
      if (!inCodeBlock) {
        // Début d'un bloc de code
        inCodeBlock = true;
        codeBlockContent = trimmedLine + "\n"; // Inclure les délimiteurs dans le contenu
      } else {
        // Fin d'un bloc de code
        inCodeBlock = false;
        codeBlockContent += trimmedLine; // Inclure le délimiteur de fin
        const newBlockRef = await createChildBlock(
          currentParentRef,
          codeBlockContent
        );
        stack.push({
          level: stack[stack.length - 1].level + 1,
          ref: newBlockRef,
        });
        codeBlockContent = ""; // Réinitialiser le contenu du bloc de code
      }
      continue;
    }

    if (inCodeBlock) {
      // Accumuler les lignes dans le bloc de code
      codeBlockContent += trimmedLine + "\n";
      continue;
    }

    // Calculer le niveau hiérarchique basé sur l'indentation ou la structure (ex: 1. a) - etc.)
    const { level, titleDegree } = getLevel(line, minTitleLevel);

    if (titleDegree !== null) {
      if (!updatedMinLevel) {
        minTitleLevel = minTitleLevel
          ? Math.min(minTitleLevel, titleDegree)
          : titleDegree; // Mettre à jour le titre le plus élevé rencontré
        updatedMinLevel = true;
      }
      trimmedLine = trimmedLine.replace(/^#{1,6}\s*/, "").trim();
    }

    // Supprimer le tiret en début de ligne, s'il y en a un
    const content = trimmedLine.startsWith("- ")
      ? trimmedLine.slice(2).trim()
      : trimmedLine;

    // Déterminer le parent du bloc actuel
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    // currentParentRef = stack[stack.length - 1].ref;
    currentParentRef =
      stack[stack.length - 1] !== undefined
        ? stack[stack.length - 1].ref
        : parentBlockRef;

    // Créer le bloc sous le parent trouvé
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

// Fonction pour déterminer le niveau hiérarchique d'une ligne
function getLevel(line, minTitleLevel) {
  // Exemple: compter le nombre de tabulations ou d'espaces initiaux
  let level = 0;
  let titleDegree = null;

  // Niveau basé sur les espaces (2 espaces = 1 niveau)
  const spaces = line.match(/^ */)[0].length;
  level = spaces;

  let trimmedLine = line.trim();

  // Vérification des titres Markdown (ex: #, ##, ###)
  const titleMatch = trimmedLine.match(/^#{1,6}\s/);
  if (titleMatch) {
    titleDegree = titleMatch[0].trim().length; // Le nombre de # correspond au degré de titre
    level = titleDegree - (minTitleLevel ? minTitleLevel : titleDegree); // Ajuster le niveau en fonction du titre le plus élevé
    return { level, titleDegree };
  }

  // Autres méthodes pour déterminer le niveau (ex: 1., a), - etc.)
  if (/^\*?\*?\d+\./.test(trimmedLine)) level += 1; // Numérotation 1. 2. 3.
  if (/^\*?\*?[a-z]\)/.test(trimmedLine)) level += 1; // Lettres a) b) c)
  if (/^\*?\*?[ivx]+\)/i.test(trimmedLine)) level += 1; // Niveaux romains i) ii) iii)
  if (/^\*?\*?- /.test(trimmedLine)) level += 1; // Tirets -

  return { level, titleDegree };
}

// export const splitLines = async (str, parentUid, lastParentUid, level = 0) => {
//   let levelsUid = [parentUid];
//   codeBlockRegex.lastIndex = 0;
//   if (
//     !codeBlockRegex.test(str) &&
//     (markdownHeadingRegex.test(str) || dashOrNumRegex.test(str))
//   ) {
//     let isDash = false;
//     let isNum = false;
//     let isSamePrefix = false;
//     let lastBlockUid;
//     const lines = str.split("\n");
//     console.log("lines :>> ", lines);
//     for (let i = 0; i < lines.length; i++) {
//       if (markdownHeadingRegex.test(lines[i])) {
//         const matchingHeading = lines[i].match(markdownHeadingRegex);
//         const headingLevel = matchingHeading[0].length - 1;
//         const headingUid = await createChildBlock(
//           levelsUid[level],
//           lines[i].replace(matchingHeading[0], ""),
//           "last",
//           true,
//           headingLevel > 3 ? 3 : headingLevel
//         );
//         lastParentUid = headingUid;
//         level++;
//         levelsUid.push(headingUid);
//         if (lines.length === 1) return { lastParentUid, level };
//       } else if (dashOrNumRegex.test(lines[i])) {
//         console.log("dashOrNumRegex :>> ", lines[i].match(dashOrNumRegex));
//         const matchingDash = lines[i].match(dashOrNumRegex);
//         console.log("levelsUid :>> ", levelsUid);
//         console.log("level :>> ", level);
//         if (
//           !isSamePrefix &&
//           ((isDash && matchingDash[0].includes("-")) ||
//             (isNum && !matchingDash[0].includes("-")))
//         ) {
//           console.log("SAME SAME");
//           level--;
//           isSamePrefix = true;
//         }
//         lastBlockUid = await createChildBlock(
//           levelsUid[level],
//           matchingDash[0].includes("-")
//             ? lines[i].replace(matchingDash[0], "")
//             : lines[i]
//         );
//         if (!isDash && matchingDash[0].includes("-")) {
//           level++;
//           isDash = true;
//           //levelsUid.push(isNum ? lastBlockUid : lastParentUid || parentUid);
//           levelsUid.push(lastBlockUid);
//         } else if (!isNum && !matchingDash[0].includes("-")) {
//           level++;
//           isNum = true;
//           levelsUid.push(lastBlockUid);
//           //levelsUid.push(isDash ? lastBlockUid : lastParentUid || parentUid);
//         }
//       } else {
//         if (isDash || isNum) {
//           // level++;
//           isDash = false;
//           isNum = false;
//         }
//         // console.log("levelsUid :>> ", levelsUid);
//         // console.log("level :>> ", level);
//         // console.log("lines[i] :>> ", lines[i]);
//         /*lastParentUid = */ lastBlockUid = await createChildBlock(
//           levelsUid[level],
//           lines[i]
//         );
//         // if (isDash || isNum) level++;
//         if (lines.length === 1) return { lastParentUid, level };
//       }
//     }
//     return { lastParentUid, level: 0 };
//   } else return await createChildBlock(parentUid, str);
// };
