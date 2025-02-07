import { dnpUidRegex } from "../../../utils/regex";

export const getBlocksMatchingRegexQuery = (
  withExcludeRegex: boolean,
  pageRegex: string,
  matchingParents?: boolean
) => {
  const { parentStr, pageStr, excludeRegexVar, excludeStr } =
    getAdaptativeQueryStrings(
      withExcludeRegex,
      pageRegex,
      null,
      null,
      matchingParents
    );

  const q = `[:find ?uid ?content ?time ?page-title
      :in $ ${
        matchingParents ? "% [?matching-parents-uid ...] " : ""
      }?regex ${excludeRegexVar}
      :where ${parentStr}
      [?b :block/uid ?uid]
     [?b :block/string ?content]
     [?b :block/page ?page]
     [?page :node/title ?page-title]
     ${pageStr}
     [?b :edit/time ?time]
     [(re-pattern ?regex) ?pattern]
     [(re-find ?pattern ?content)]
     ${
       excludeStr
         ? `${excludeStr}
        (not [(re-find ?pattern-not ?content)])`
         : ""
     }]`;
  return q;
};

export const descendantRule = `[[(descendants ?parent ?child)
    [?parent :block/children ?child]]
    [(descendants ?descendant ?child)
    [?parent :block/children ?child]
    (descendants ?descendant ?parent)]]]`;

export const twoLevelsChildrenRule = `[[(descendants ?parent ?child)
  [?parent :block/children ?child]]
  [(descendants ?parent ?child)
  [?parent :block/children ?child-bis]
  [?child-bis :block/children ?child]
  ]]`;

export const directChildrenRule = `[[(descendants ?parent ?child)
    [?parent :block/children ?child]]]`;

export const getMultipleMatchingRegexInTreeQuery = (
  nbOfRegex: number,
  withExcludeRegex: boolean,
  pageRegex: string
) => {
  const {
    resultStr,
    regexVarStr,
    findStr,
    pageStr,
    excludeRegexVar,
    excludeStr,
  } = getAdaptativeQueryStrings(withExcludeRegex, pageRegex, nbOfRegex);

  const q = `[:find ?matching-b ?content ?time ?page-title ${resultStr}
      :in $ % [?matching-b ...] ${regexVarStr} ${excludeRegexVar}
      
      :where
      [?b :block/uid ?matching-b]
      [?b :block/string ?content]
      [?b :block/page ?page]
      [?page :node/title ?page-title]
      ${pageStr}
      [?b :edit/time ?time]
      ${
        excludeStr
          ? `${excludeStr}
        [?b :block/children ?direct-child]
        [?direct-child :block/string ?child-content]
        (not [(re-find ?pattern-not ?content)])
        (not [(re-find ?pattern-not ?child-content)])`
          : ""
      }
      ${findStr}
      ]`;
  return q;
};

export const getSiblingsParentMatchingRegexQuery = (
  nbOfRegex: number,
  withExcludeRegex: boolean,
  pageRegex: string
) => {
  const {
    resultStr,
    regexVarStr,
    findStr,
    pageStr,
    excludeRegexVar,
    excludeStr,
    findSiblingsStr,
  } = getAdaptativeQueryStrings(withExcludeRegex, pageRegex, nbOfRegex, true);

  const q = `[:find ?parent-uid ?parent-content ?time ?page-title ${resultStr}
    :in $ [?matching-b ...] ${regexVarStr} ${excludeRegexVar}
    :where
      [?b :block/uid ?matching-b]
      [?b :block/page ?page]
      [?page :node/title ?page-title]
      ${pageStr}
      [?parents :block/children ?b]
      [?parents :block/children ?child0]
      [?parents :block/children ?child1]
      [?child0 :block/string ?child-content0]
      [?child1 :block/string ?child-content1]
      [(not= ?child0 ?child1)]
      ${
        excludeStr
          ? `${excludeStr}
        (not [?parents :block/children ?any-child]
        [?any-child :block/string ?any-content]
        [(re-find ?pattern-not ?any-content)])`
          : ""
      }
      [(re-pattern ?regex0) ?pattern0]
      [(re-pattern ?regex1) ?pattern1]
      [(re-find ?pattern0 ?child-content0)]
      [(re-find ?pattern1 ?child-content1)]
      ${findSiblingsStr}
      [?child0 :block/uid ?child-uid0]
      [?child1 :block/uid ?child-uid1]
      [?parents :block/uid ?parent-uid]
      [?parents :block/string ?parent-content]
      [?parents :edit/time ?time]
      ]`;
  return q;
};

const getAdaptativeQueryStrings = (
  withExcludeRegex: boolean,
  pageRegex: string,
  nbOfRegex: number,
  onlySiblings?: boolean,
  matchingParents?: boolean
) => {
  let regexVarStr = "";
  let findStr = "";
  let resultStr = "";
  let excludeRegexVar = "";
  let excludeStr = "";
  let findSiblingsStr = "";
  let parentStr = "";
  if (nbOfRegex) {
    for (let i = 0; i < nbOfRegex; i++) {
      resultStr += `?child-uid${i} ?child-content${i} `;
      regexVarStr += `?regex${i} `;
      if (!onlySiblings) {
        findStr += `
          [(re-pattern ?regex${i}) ?pattern${i}]
          (descendants ?b ?child${i})
          [?child${i} :block/uid ?child-uid${i}]
          [?child${i} :block/string ?child-content${i}]
          (or
            [(re-find ?pattern${i} ?child-content${i})]
            [(re-find ?pattern${i} ?content)])\n`;
      } else if (i > 1) {
        findSiblingsStr += `[?parents :block/children ?child${i}]
      [?child${i} :block/string ?child-content${i}]
      [(not= ?child${i - 1} ?child${i})]
      [(re-pattern ?regex${i}) ?pattern${i}]
      [(re-find ?pattern${i} ?child-content${i})]
      [?child${i} :block/uid ?child-uid${i}]\n`;
      }
    }
  }
  const pageStr = pageRegex
    ? pageRegex === "dnp"
      ? `[?page :block/uid ?page-uid]
      [(re-pattern "${dnpUidRegex.source.slice(1, -1)}") ?page-regex]
  [(re-find ?page-regex ?page-uid)]`
      : `[(re-pattern "${pageRegex}") ?page-regex]
  [(re-find ?page-regex ?page-title)]`
    : "";

  if (withExcludeRegex) {
    excludeRegexVar = "?regex-not";
    excludeStr = "[(re-pattern ?regex-not) ?pattern-not]";
  }

  if (matchingParents) {
    parentStr = `\n[?matching-parents :block/uid ?matching-parents-uid]
      (descendants ?matching-parents ?b)`;
  }

  return {
    resultStr,
    regexVarStr,
    findStr,
    pageStr,
    excludeRegexVar,
    excludeStr,
    findSiblingsStr,
    parentStr,
  };
};

export const parseQueryResults = (queryResults: any[]) => {
  const parsed = queryResults.map((block: any) => {
    return {
      uid: block[0],
      content: block[1],
      editTime: block[2],
      pageTitle: block[3],
      childMatchingContent:
        block.length > 4
          ? block
              .slice(4)
              .reduce(
                (
                  result: any[],
                  _: string,
                  index: number,
                  original: string[]
                ) => {
                  if (index % 2 === 0) {
                    result.push({
                      uid: original[index],
                      content: original[index + 1],
                    });
                  }
                  return result;
                },
                []
              )
          : null,
    };
  });
  return parsed;
};
