export function removeDuplicates(arr) {
  return [...new Set(arr)];
}

export function removeDuplicatesByProperty(arr, property) {
  const seen = new Set();
  return arr.filter((item) => {
    const value = item[property];
    if (seen.has(value)) {
      return false;
    } else {
      seen.add(value);
      return true;
    }
  });
}

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

export function getRandomElements(arr, n) {
  const arrayCopy = [...arr];
  const result = [];
  if (n >= arrayCopy.length) return arr;
  n = Math.min(n, arrayCopy.length);
  while (result.length < n) {
    const randomIndex = Math.floor(Math.random() * arrayCopy.length);
    result.push(arrayCopy[randomIndex]);
    arrayCopy.splice(randomIndex, 1);
  }
  return result;
}
