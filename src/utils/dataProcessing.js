export function excludeItemsInArray(sourceArray, itemsToExclude) {
  return sourceArray.filter((item) => !itemsToExclude.includes(item));
}
