export function excludeItemsInArray(sourceArray, itemsToExclude) {
  return sourceArray.filter((item) => !itemsToExclude.includes(item));
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
