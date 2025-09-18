import {
  executeDatomicQuery,
} from "../../helpers/searchUtils";
import { dnpUidRegex } from "../../../../../utils/regex.js";
import { findBlocksByContentTool } from "../findBlocksByContent/findBlocksByContentTool";
import { escapeRegex, escapeForDatomic } from "./parsers";
import type { AttributeValue } from "./schemas";

/**
 * Search using regex pattern in block content
 */
export const searchWithRegex = async (
  regexPattern: string,
  includeDaily: boolean = true,
  limitToPageUids?: string[]
): Promise<any[]> => {
  let query = `[:find ?uid ?content ?time ?page-title ?page-uid ?page-created ?page-modified
                :where 
                [?b :block/uid ?uid]
                [?b :block/string ?content]
                [?b :block/page ?page]
                [?page :node/title ?page-title]
                [?page :block/uid ?page-uid]
                [?page :create/time ?page-created]
                [?page :edit/time ?page-modified]
                [?b :edit/time ?time]
                [(re-pattern "(?i)${regexPattern}") ?pattern]
                [(re-find ?pattern ?content)]`;

  // Add UID-based filtering for optimization
  if (limitToPageUids && limitToPageUids.length > 0) {
    if (limitToPageUids.length === 1) {
      query += `\n                [?page :block/uid "${limitToPageUids[0]}"]`;
    } else {
      const uidsSet = limitToPageUids.map((uid) => `"${uid}"`).join(" ");
      query += `\n                [(contains? #{${uidsSet}} ?page-uid)]`;
    }
  }

  if (!includeDaily) {
    query += `\n                [(re-pattern "${dnpUidRegex.source.slice(
      1,
      -1
    )}") ?dnp-pattern]
                (not [(re-find ?dnp-pattern ?page-uid)])`;
  }

  query += `]`;

  return await executeDatomicQuery(query);
};

/**
 * Search for attribute blocks with capture group to get the value part
 */
export const searchAttributeBlocksWithCapture = async (
  attributeKey: string,
  includeDaily: boolean = true,
  limitToPageUids?: string[]
): Promise<
  {
    uid: string;
    content: string;
    valueContent: string;
    isEmpty: boolean;
    pageData: any;
  }[]
> => {
  const escapedKey = escapeRegex(attributeKey);
  // Capture everything after :: until end of line
  const regexPattern = escapeForDatomic(`^${escapedKey}::(.*)$`);

  let query = `[:find ?uid ?content ?time ?page-title ?page-uid ?page-created ?page-modified
                :where 
                [?b :block/uid ?uid]
                [?b :block/string ?content]
                [?b :block/page ?page]
                [?page :node/title ?page-title]
                [?page :block/uid ?page-uid]
                [?page :create/time ?page-created]
                [?page :edit/time ?page-modified]
                [?b :edit/time ?time]
                [(re-pattern "(?i)${regexPattern}") ?pattern]
                [(re-find ?pattern ?content)]`;

  // Add UID-based filtering for optimization
  if (limitToPageUids && limitToPageUids.length > 0) {
    if (limitToPageUids.length === 1) {
      query += `\n                [?page :block/uid "${limitToPageUids[0]}"]`;
    } else {
      const uidsSet = limitToPageUids.map((uid) => `"${uid}"`).join(" ");
      query += `\n                [(contains? #{${uidsSet}} ?page-uid)]`;
    }
  }

  if (!includeDaily) {
    query += `\n                [(re-pattern "${dnpUidRegex.source.slice(
      1,
      -1
    )}") ?dnp-pattern]
                (not [(re-find ?dnp-pattern ?page-uid)])`;
  }

  query += `]`;

  const results = await executeDatomicQuery(query);

  // Process results to extract value content and determine if empty
  return results.map(
    ([uid, content, time, pageTitle, pageUid, pageCreated, pageModified]) => {
      // Extract the value part using the same regex
      const regex = new RegExp(`^${attributeKey}::(.*)$`, "i");
      const match = content.match(regex);
      const valueContent = match ? match[1].trim() : "";
      const isEmpty = valueContent === "";

      return {
        uid,
        content,
        valueContent,
        isEmpty,
        pageData: [
          uid,
          content,
          time,
          pageTitle,
          pageUid,
          pageCreated,
          pageModified,
        ],
      };
    }
  );
};

/**
 * Check if value content matches the logical conditions
 */
export const checkValueMatches = (
  valueContent: string,
  values: AttributeValue[],
  valueType: string
): boolean => {
  const andValues = values.filter((v) => v.operator === "+");
  const orValues = values.filter((v) => v.operator === "|");
  const notValues = values.filter((v) => v.operator === "-");

  // Check AND conditions (all must be present)
  for (const andVal of andValues) {
    if (!checkSingleValueMatch(valueContent, andVal.value, valueType)) {
      return false;
    }
  }

  // Check OR conditions (at least one must be present)
  if (orValues.length > 0) {
    const hasOrMatch = orValues.some((orVal) =>
      checkSingleValueMatch(valueContent, orVal.value, valueType)
    );
    if (!hasOrMatch) {
      return false;
    }
  }

  // Check NOT conditions (none must be present)
  for (const notVal of notValues) {
    if (checkSingleValueMatch(valueContent, notVal.value, valueType)) {
      return false;
    }
  }

  return true;
};

/**
 * Check if a single value matches the content based on type
 */
export const checkSingleValueMatch = (
  content: string,
  value: string,
  valueType: string
): boolean => {
  const cleanValue = value.replace(/^#/, ""); // Remove leading # if present

  switch (valueType) {
    case "page_ref": {
      // Check for [[page]], #[[page]], or #page formats
      const patterns = [
        `[[${cleanValue}]]`,
        `#[[${cleanValue}]]`,
        `#${cleanValue}`,
      ];
      return patterns.some((pattern) => content.includes(pattern));
    }
    case "text":
      return content.toLowerCase().includes(value.toLowerCase());
    case "regex":
      try {
        const regex = new RegExp(value, "i");
        return regex.test(content);
      } catch {
        return false;
      }
    default:
      return content.toLowerCase().includes(value.toLowerCase());
  }
};

/**
 * Get direct children UIDs for a batch of parent block UIDs
 */
export const getDirectChildrenBatch = async (
  parentUids: string[]
): Promise<string[]> => {
  if (parentUids.length === 0) return [];

  const uidsSet = parentUids.map((uid) => `"${uid}"`).join(" ");
  const query = `[:find ?child-uid
                  :where
                  [?parent :block/uid ?parent-uid]
                  [(contains? #{${uidsSet}} ?parent-uid)]
                  [?parent :block/children ?child]
                  [?child :block/uid ?child-uid]]`;

  const results = await executeDatomicQuery(query);
  return results.map(([childUid]) => childUid);
};

/**
 * Search children blocks with logical conditions using findBlocksByContent
 */
export const searchChildrenWithLogic = async (
  childrenUids: string[],
  values: AttributeValue[],
  valueType: string,
  state?: any
): Promise<any[]> => {
  if (childrenUids.length === 0) return [];

  const andValues = values.filter((v) => v.operator === "+");
  const orValues = values.filter((v) => v.operator === "|");
  const notValues = values.filter((v) => v.operator === "-");

  let resultUids = new Set(childrenUids);

  // AND logic: all conditions must match
  for (const andVal of andValues) {
    const matches = (await findBlocksByContentTool.invoke({
      conditions: [{ type: valueType as any, text: andVal.value }],
      limitToBlockUids: Array.from(resultUids),
      combineConditions: "AND",
    })) as any;

    // Parse JSON string if needed
    let parsedMatches = matches;
    if (typeof matches === "string") {
      try {
        parsedMatches = JSON.parse(matches);
      } catch (e) {
        console.warn(
          `🔍 Failed to parse tool result JSON for AND logic:`,
          e.message,
          "Raw result:",
          matches.substring(0, 300) + "..."
        );
        parsedMatches = { success: false, data: [] };
      }
    }

    if (
      parsedMatches.success === true &&
      parsedMatches.data &&
      Array.isArray(parsedMatches.data) &&
      parsedMatches.data.length > 0
    ) {
      resultUids = new Set(parsedMatches.data.map((m: any) => m.uid));
    } else {
      resultUids = new Set(); // No matches for this AND condition
    }
  }

  // OR logic: at least one condition must match
  if (orValues.length > 0) {
    const allOrMatches = new Set();
    for (const orVal of orValues) {
      const matches = (await findBlocksByContentTool.invoke({
        conditions: [{ type: valueType as any, text: orVal.value }],
        limitToBlockUids: childrenUids,
        combineConditions: "AND",
      })) as any;

      // Parse JSON string if needed
      let parsedMatches = matches;
      if (typeof matches === "string") {
        try {
          parsedMatches = JSON.parse(matches);
        } catch (e) {
          console.warn(
            `🔍 Failed to parse tool result JSON for OR logic:`,
            e.message,
            "Raw result:",
            matches.substring(0, 300) + "..."
          );
          parsedMatches = { success: false, data: [] };
        }
      }

      if (
        parsedMatches.success &&
        parsedMatches.data &&
        Array.isArray(parsedMatches.data)
      ) {
        parsedMatches.data.forEach((m: any) => allOrMatches.add(m.uid));
      }
    }
    resultUids = new Set(
      Array.from(resultUids).filter((uid) => allOrMatches.has(uid))
    );
  }

  // NOT logic: remove matches
  for (const notVal of notValues) {
    const matches = (await findBlocksByContentTool.invoke({
      conditions: [{ type: valueType as any, text: notVal.value }],
      limitToBlockUids: Array.from(resultUids),
      combineConditions: "AND",
    })) as any;

    // Parse JSON string if needed
    let parsedMatches = matches;
    if (typeof matches === "string") {
      try {
        parsedMatches = JSON.parse(matches);
      } catch (e) {
        console.warn(
          `🔍 Failed to parse tool result JSON for NOT logic:`,
          e.message,
          "Raw result:",
          matches.substring(0, 300) + "..."
        );
        parsedMatches = { success: false, data: [] };
      }
    }

    if (
      parsedMatches.success &&
      parsedMatches.data &&
      Array.isArray(parsedMatches.data)
    ) {
      const notUids = new Set(parsedMatches.data.map((m: any) => m.uid));
      resultUids = new Set(
        Array.from(resultUids).filter((uid) => !notUids.has(uid))
      );
    }
  }

  // Convert back to the expected format for page analysis
  const finalResults = [];
  for (const uid of Array.from(resultUids)) {
    // We need to get the actual block data - query it
    const blockQuery = `[:find ?uid ?content ?time ?page-title ?page-uid ?page-created ?page-modified
                        :where 
                        [?b :block/uid ?uid]
                        [(= ?uid "${uid}")]
                        [?b :block/string ?content]
                        [?b :block/page ?page]
                        [?page :node/title ?page-title]
                        [?page :block/uid ?page-uid]
                        [?page :create/time ?page-created]
                        [?page :edit/time ?page-modified]
                        [?b :edit/time ?time]]`;

    const blockData = await executeDatomicQuery(blockQuery);
    if (blockData.length > 0) {
      finalResults.push(blockData[0]);
    }
  }

  return finalResults;
};