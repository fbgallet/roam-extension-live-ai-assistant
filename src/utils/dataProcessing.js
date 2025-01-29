export function excludeItemsInArray(
  sourceArray,
  itemsToExclude,
  matchingProperty
) {
  return sourceArray.filter((item) =>
    matchingProperty !== undefined
      ? !itemsToExclude.some(
          (elt) => elt[matchingProperty] === item[matchingProperty]
        )
      : !itemsToExclude.includes(item)
  );
}

export function concatWithoutDuplicates(
  sourceArray = [],
  arrayToConcat = [],
  matchingProperty
) {
  if (!sourceArray || !sourceArray.length) return arrayToConcat;
  if (!sourceArray || !arrayToConcat.length) return sourceArray;
  for (let i = 0; i < arrayToConcat.length; i++) {
    if (matchingProperty !== undefined) {
      if (
        !sourceArray.some(
          (item) =>
            item[matchingProperty] === arrayToConcat[i][matchingProperty]
        )
      )
        sourceArray.push(arrayToConcat[i]);
    } else if (!sourceArray.includes(arrayToConcat[i]))
      sourceArray.push(arrayToConcat[i]);
  }
  return sourceArray;
}

export function sliceByWordLimit(text, wordLimit) {
  const words = text.split(" ");
  if (words.length <= wordLimit) {
    return text;
  }
  return words.slice(0, wordLimit).join(" ") + "...";
}
