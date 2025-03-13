/*
  Rich queries 'filters like' + siblings AND
                                            */

const qInitialA = `[:find ?uid ?str
    :in $ % [?block-mentions ...] [?exclude1 ?exclude2]
    :where
      (or
        (has-mention ?blocks ?block-mentions)
      )
      (not 
        (or
          (has-mention ?blocks ?exclude1)
          (has-mention ?blocks ?exclude2)
        )
      )
      (not [?blocks :block/parents ?parents] 
        (or
          (has-mention ?parents ?exclude1)
          (has-mention ?parents ?exclude2)
        ))
      [?blocks :block/uid ?uid]
      [?blocks :block/string ?str]]`;
// 2. Parmi les résultats précédents, ceux qui contiennent aussi C ou D
const qWithBC = `[:find ?uid ?str
  :in $ % [[?filtered-uid ?filtered-str]] [?mentions ...]
  :where
    [?blocks :block/uid ?filtered-uid]
    (or
      (has-mention ?blocks ?mentions)
    )
    [?blocks :block/string ?str]
    [?blocks :block/uid ?uid]]`;
// 3. Blocs avec B ou C dans leurs parents
const qParentsBC = `[:find ?uid ?str
  :in $ % [[?filtered-uid ?filtered-str]] [?mentions ...]
  :where
    [?blocks :block/uid ?filtered-uid]
    [?blocks :block/parents ?parents]
    (or
      (has-mention ?parents ?mentions)
    )
    [?blocks :block/uid ?uid]
    [?blocks :block/string ?str]]`;
// 4. Blocs avec B ou C dans leurs descendants
const qDescendantsBC = `[:find ?uid ?str
  :in $ % [[?filtered-uid ?filtered-str]] [?mentions ...]
  :where
    [?blocks :block/uid ?filtered-uid]
    (ancestors ?children ?blocks)
    (or
      (has-mention ?children ?mentions)
    )
    [?children :block/uid ?uid]
    [?children :block/string ?str]]`;
const qSameLevel = `[:find ?uid ?str
  :in $ % [[?filtered-uid _]] [?mentions ...]
  :where
    [?blocks :block/uid ?filtered-uid]
    [?blocks :block/parents ?parents]
    [(not= ?siblings ?blocks)]
    [?siblings :block/parents ?parents]
    [?parents :block/children ?blocks]
    [?parents :block/children ?siblings]
    (has-mention ?siblings ?mentions)
    [?parents :block/uid ?uid]
    [?parents :block/string ?str]
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

export function replaceStringNullWithActualNull(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj === "null" ? null : obj;
  }
  // Process array of objects
  if (Array.isArray(obj)) {
    return obj.map((item) => replaceStringNullWithActualNull(item));
  }

  const result = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (value === "null" || value === ":null") {
        result[key] = null;
        // recursivity if the key itself an object
      } else if (typeof value === "object") {
        result[key] = replaceStringNullWithActualNull(value);
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}
