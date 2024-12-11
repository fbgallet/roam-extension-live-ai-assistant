/*
  Rich queries 'filters like' + siblings AND
                                            */

const qInitialA = `[:find ?uid ?str
    :in $ % ?block-mentionA ?block-mentionB ?exclude-mention1 ?exclude-mention2
    :where
      (or 
        (has-mention ?blocks ?block-mentionA)
        (has-mention ?blocks ?block-mentionB)
      )
      (not 
        (or
          (has-mention ?blocks ?exclude-mention1)
          (has-mention ?blocks ?exclude-mention2)
        )
      )
      (not [?blocks :block/parents ?parents] 
        (or
          (has-mention ?parents ?exclude-mention1)
          (has-mention ?parents ?exclude-mention2)
        ))
      [?blocks :block/uid ?uid]
      [?blocks :block/string ?str]]`;
// 2. Parmi les résultats précédents, ceux qui contiennent aussi C ou D
const qWithBC = `[:find ?uid ?str
    :in $ % [[?filtered-uid ?filtered-str]] ?mentionC ?mentionD
    :where
      [?blocks :block/uid ?filtered-uid]
      (or
        (has-mention ?blocks ?mentionC)
        (has-mention ?blocks ?mentionD)
      )
      [?blocks :block/string ?str]
      [?blocks :block/uid ?uid]]`;
// 3. Blocs avec B ou C dans leurs parents
const qParentsBC = `[:find ?uid ?str
    :in $ % [[?filtered-uid ?filtered-str]] ?mentionC ?mentionD
    :where
      [?blocks :block/uid ?filtered-uid]
      [?blocks :block/parents ?parents]
      (or
        (has-mention ?parents ?mentionC)
        (has-mention ?parents ?mentionD)
      )
      [?blocks :block/uid ?uid]
      [?blocks :block/string ?str]]`;
// 4. Blocs avec B ou C dans leurs descendants
const qDescendantsBC = `[:find ?uid ?str
    :in $ % [[?filtered-uid ?filtered-str]] ?mentionC ?mentionD
    :where
      [?blocks :block/uid ?filtered-uid]
      (ancestors ?children ?blocks)
      (or
        (has-mention ?children ?mentionC)
        (has-mention ?children ?mentionD)
      )
      [?children :block/uid ?uid]
      [?children :block/string ?str]]`;
const qSameLevel = `[:find ?uid ?str
    :in $ % [[?filtered-uid _]] ?mentionC ?mentionD
    :where
      [?blocks :block/uid ?filtered-uid]
      [?blocks :block/parents ?parents]
      [?siblings :block/parents ?parents]
      [(not= ?siblings ?blocks)]
      [?parents :block/uid ?uid]
      [?parents :block/string ?str]
      [?parents :block/children ?blocks]
      [?parents :block/children ?siblings]
      (or
        (has-mention ?siblings ?mentionC)
        (has-mention ?siblings ?mentionD)
      )
      ]`;
const qSameHierarchy = `[:find ?uid ?str
    :in $ % [[?filtered-uid _]] ?mentionC ?mentionD
    :where
      [?blocks :block/uid ?filtered-uid]
      [?blocks :block/parents ?parents]
      [?siblings :block/parents ?parents]
      [(not= ?siblings ?blocks)]
      [?parents :block/uid ?uid]
      [?parents :block/string ?str]
      (or
        (has-mention ?siblings ?mentionC)
        (has-mention ?siblings ?mentionD)
      )
      ]`;
const rules = `[[(ancestors ?child ?parent)
    [?parent :block/children ?child]]
    [(ancestors ?child ?ancestor)
    [?parent :block/children ?child]
    (ancestors ?parent ?ancestor)]
    [(has-mention ?block ?title)
    [?b :node/title ?title]
    [?block :block/refs ?b]]]`;

const generalQuery = () => {
  const begin = performance.now();
  const initialResults = window.roamAlphaAPI.q(
    qInitialA,
    rules,
    "A",
    "",
    "E",
    "F"
  );
  console.log(initialResults);
  const withBC = window.roamAlphaAPI.q(
    qWithBC,
    rules,
    initialResults,
    "C",
    "D"
  );
  console.log(withBC);
  const remainingBlocks = initialResults.filter(
    (r) => !withBC.some((b) => b[0] === r[0])
  );
  const withParentsBC = window.roamAlphaAPI.q(
    qParentsBC,
    rules,
    remainingBlocks,
    "C",
    "D"
  );
  console.log(withParentsBC);
  const withDescendantsBC = window.roamAlphaAPI.q(
    qDescendantsBC,
    rules,
    remainingBlocks,
    "C",
    "D"
  );
  console.log(withDescendantsBC);
  const finalResults = [...withBC, ...withParentsBC, ...withDescendantsBC];
  const inSameLevel = window.roamAlphaAPI.q(
    qSameLevel,
    rules,
    initialResults,
    "C",
    "D"
  );
  console.log("inSameLevel:", inSameLevel);
  const end = performance.now();
  console.log(finalResults, (end - begin) / 1000);
};
