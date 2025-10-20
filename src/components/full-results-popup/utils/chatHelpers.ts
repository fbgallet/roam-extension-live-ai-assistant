import { Result } from "../types/types";

export const getSelectedResultsForChat = (
  selectedResults: Result[],
  allResults: Result[]
): Result[] => {
  return selectedResults.length > 0 ? selectedResults : allResults;
};

export const canUseChat = (
  privateMode: boolean,
  permissions: { contentAccess: boolean }
): boolean => {
  return !privateMode || permissions.contentAccess;
};

export const prepareContextFromResults = (results: Result[]): string => {
  return results
    .map((result) => {
      const content = result.content || result.text || "";
      const pageInfo = result.pageTitle ? `Page: ${result.pageTitle}` : "";
      const uid = result.uid ? `UID: ${result.uid}` : "";
      return `${pageInfo}\n${content}\n${uid}`.trim();
    })
    .join("\n\n---\n\n");
};

export const getSelectedResultsList = (
  selectedIndices: Set<number>,
  allResults: Result[]
): Result[] => {
  return Array.from(selectedIndices).map((index) => allResults[index]);
};
