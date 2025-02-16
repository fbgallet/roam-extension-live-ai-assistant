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
  toExcludeArray,
  property,
  isValueToExcludeInProperty = true
) {
  return sourceArray.filter((item) =>
    property !== undefined
      ? isValueToExcludeInProperty
        ? !toExcludeArray.some((elt) => elt[property] === item[property])
        : !toExcludeArray.includes(item[property])
      : !toExcludeArray.includes(item)
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

export function sliceByWordLimit(text = "", wordLimit) {
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

export function hasTrueBooleanKey(obj) {
  return Object.keys(obj).some(
    (key) => typeof obj[key] === "boolean" && obj[key]
  );
}
