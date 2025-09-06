/**
 * Content truncation utilities for managing result data size in different security modes
 * Ensures prompt data stays within character limits to prevent LLM overcharging
 */

/**
 * Apply linear content truncation to stay within character limits when result count > 150
 * Progressively reduces content length per item to fit within the target character limit
 */
export const applyLinearContentTruncation = (
  data: any[],
  targetCharLimit: number
): any[] => {
  console.log(
    `🎯 [LinearTruncation] Starting with ${data.length} results, target limit: ${targetCharLimit} chars`
  );

  // Calculate baseline content per item to stay within limit
  // Reserve space for UIDs, titles, and formatting (~100 chars per item)
  const reservedCharsPerItem = 100;
  const availableContentChars = Math.max(
    0,
    targetCharLimit - data.length * reservedCharsPerItem
  );
  const maxContentPerItem = Math.max(
    50,
    Math.floor(availableContentChars / data.length)
  );

  console.log(
    `🎯 [LinearTruncation] Max content per item: ${maxContentPerItem} chars (${data.length} items)`
  );

  let totalChars = 0;
  const truncatedData = data
    .map((item, index) => {
      const baseItem = {
        uid: item.uid,
        pageUid: item.pageUid,
        pageTitle: item.pageTitle || item.title,
        count: item.count,
      };

      // Calculate current item's base size (UID, title, formatting)
      const baseItemStr = `UID: ${baseItem.uid || baseItem.pageUid}, Title: ${
        baseItem.pageTitle || ""
      }, Count: ${baseItem.count || ""}`;
      const baseItemSize = baseItemStr.length + 20; // +20 for formatting

      // Apply linear content truncation
      let truncatedContent = "";
      if (item.content) {
        if (item.content.length <= maxContentPerItem) {
          truncatedContent = item.content;
        } else {
          truncatedContent =
            item.content.substring(0, maxContentPerItem) + "...";
        }
      }

      const itemTotalSize = baseItemSize + (truncatedContent?.length || 0);
      totalChars += itemTotalSize;

      // Early termination if we're approaching the limit
      if (totalChars > targetCharLimit * 0.95) {
        console.log(
          `🎯 [LinearTruncation] Reached 95% of limit at item ${
            index + 1
          }, stopping here`
        );
        return null; // This will be filtered out
      }

      return {
        ...baseItem,
        content: truncatedContent,
      };
    })
    .filter((item) => item !== null); // Remove null items

  return truncatedData;
};

/**
 * Apply intermediate content truncation for full mode during tool execution
 * More aggressive truncation than final results to keep assistant context manageable
 * Only used when contentAccess=true and result count is reasonable
 */
export const applyIntermediateContentTruncation = (
  data: any[],
  targetCharLimit: number = 50000 // Default 50k chars for intermediate processing
): any[] => {
  console.log(
    `🎯 [IntermediateTruncation] Starting with ${data.length} results, target limit: ${targetCharLimit} chars`
  );

  // More aggressive truncation for intermediate results
  // Reserve space for UIDs, titles, and formatting (~80 chars per item)
  const reservedCharsPerItem = 80;
  const availableContentChars = Math.max(
    0,
    targetCharLimit - data.length * reservedCharsPerItem
  );
  const maxContentPerItem = Math.max(
    100,
    Math.floor(availableContentChars / data.length)
  ); // Minimum 100 chars

  console.log(
    `🎯 [IntermediateTruncation] Max content per item: ${maxContentPerItem} chars (${data.length} items)`
  );

  let totalChars = 0;
  const truncatedData = data
    .map((item, index) => {
      // Preserve essential fields for all result types
      const baseItem = {
        uid: item.uid,
        pageUid: item.pageUid,
        pageTitle: item.pageTitle || item.title,
        count: item.count,
        type: item.type, // Preserve type (e.g., "page")
        isPage: item.isPage,
      };

      // Calculate current item's base size
      const baseItemStr = `UID: ${baseItem.uid || baseItem.pageUid}, Title: ${
        baseItem.pageTitle || ""
      }, Type: ${baseItem.type || "block"}, Count: ${baseItem.count || ""}`;
      const baseItemSize = baseItemStr.length + 20; // +20 for JSON formatting

      // Apply intermediate content truncation based on result type
      let contentToTruncate = "";
      let truncatedFields: any = {};

      if (item.isPage || item.type === "page") {
        // Page results: No direct content, but preserve metadata for getNodeDetails follow-up
        // Pages don't have content field, so no truncation needed
        truncatedFields = {
          // Preserve page-specific fields that tools might need
          created: item.created,
          modified: item.modified,
          isDaily: item.isDaily,
        };
        contentToTruncate = ""; // Pages don't have content field
      } else if (item.content) {
        // Block results: Apply content truncation
        if (item.content.length <= maxContentPerItem) {
          contentToTruncate = item.content;
        } else {
          // More aggressive truncation with smart ending
          const truncated = item.content.substring(0, maxContentPerItem);
          const lastSpace = truncated.lastIndexOf(" ");
          const smartEnd =
            lastSpace > maxContentPerItem * 0.8 ? lastSpace : maxContentPerItem;
          contentToTruncate = item.content.substring(0, smartEnd) + "...";
        }
        truncatedFields.content = contentToTruncate;
      } else if (item.structure || item.hierarchy) {
        // Hierarchy results: Apply truncation to nested content
        const hierarchyContent = item.structure || item.hierarchy;
        const serializedHierarchy =
          typeof hierarchyContent === "string"
            ? hierarchyContent
            : JSON.stringify(hierarchyContent);

        if (serializedHierarchy.length <= maxContentPerItem) {
          truncatedFields.structure = hierarchyContent;
          truncatedFields.hierarchy = hierarchyContent;
          contentToTruncate = serializedHierarchy;
        } else {
          // Truncate serialized hierarchy content
          const truncated = serializedHierarchy.substring(0, maxContentPerItem);
          const smartEnd = Math.max(
            truncated.lastIndexOf("}"),
            truncated.lastIndexOf("]")
          );
          const finalEnd =
            smartEnd > maxContentPerItem * 0.7
              ? smartEnd + 1
              : maxContentPerItem;
          const truncatedSerialized =
            serializedHierarchy.substring(0, finalEnd) + "...}";

          try {
            // Try to parse back if possible, fallback to string
            truncatedFields.structure = item.structure
              ? JSON.parse(truncatedSerialized)
              : undefined;
            truncatedFields.hierarchy = item.hierarchy
              ? JSON.parse(truncatedSerialized)
              : undefined;
          } catch {
            // Fallback: store as truncated string
            truncatedFields.structure = item.structure
              ? truncatedSerialized
              : undefined;
            truncatedFields.hierarchy = item.hierarchy
              ? truncatedSerialized
              : undefined;
          }
          contentToTruncate = truncatedSerialized;
        }
      } else {
        // Other result types: preserve as-is but count their size
        const otherFields = { ...item };
        delete otherFields.uid;
        delete otherFields.pageUid;
        delete otherFields.pageTitle;
        delete otherFields.title;
        delete otherFields.count;
        delete otherFields.type;
        delete otherFields.isPage;

        const serializedOther = JSON.stringify(otherFields);
        contentToTruncate = serializedOther;
        truncatedFields = otherFields; // Include other fields as-is
      }

      const itemTotalSize = baseItemSize + contentToTruncate.length;
      totalChars += itemTotalSize;

      // Early termination if approaching limit
      if (totalChars > targetCharLimit * 0.9) {
        // 90% threshold for intermediate
        console.log(
          `🎯 [IntermediateTruncation] Reached 90% of limit at item ${
            index + 1
          }, stopping here`
        );
        return null;
      }

      return {
        ...baseItem,
        ...truncatedFields,
        // Preserve key metadata that might be useful for tool decisions
        metadata: item.metadata,
      };
    })
    .filter((item) => item !== null);

  return truncatedData;
};
