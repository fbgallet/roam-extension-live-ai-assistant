import { StoredQuery, PageSelection } from "./queryStorage";

// Types for the Select component
export interface QuerySelectItem {
  id: string;
  type: "current" | "recent" | "saved";
  query?: StoredQuery;
  label: string;
  description?: string;
  group: string;
}

/**
 * Format a timestamp into a human-readable relative string
 */
export const formatTimestamp = (timestamp: Date): string => {
  const now = new Date();
  const diff = now.getTime() - timestamp.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return "Today";
  } else if (days === 1) {
    return "Yesterday";
  } else if (days < 7) {
    return `${days} days ago`;
  } else {
    return timestamp.toLocaleDateString();
  }
};

/**
 * Format page selections into a display string
 */
export const formatPageSelectionsDisplay = (
  pageSelections: PageSelection[]
): string => {
  const pageNames = pageSelections.map((p) => p.title);
  const firstPages = pageNames.slice(0, 2).join(", ");
  const remaining = pageNames.length - 2;
  return remaining > 0
    ? `📄 ${firstPages}, +${remaining} more`
    : `📄 ${firstPages}`;
};

/**
 * Convert queries to select items for the dropdown
 */
export const createSelectItems = (
  queries: { recent: StoredQuery[]; saved: StoredQuery[] },
  currentQuery?: { userQuery?: string }
): QuerySelectItem[] => {
  const items: QuerySelectItem[] = [];

  // Safety check: if queries is undefined, return empty array
  if (!queries) {
    console.error(
      "❌ [querySelectItems] queries is undefined in createSelectItems"
    );
    return items;
  }

  // Add current query if available
  if (currentQuery?.userQuery) {
    items.push({
      id: "current",
      type: "current",
      label: "🔍 Last Query",
      description:
        currentQuery.userQuery.length > 70
          ? currentQuery.userQuery.substring(0, 67) + "..."
          : currentQuery.userQuery,
      group: "", // No group - standalone item
    });
  }

  // Add recent queries
  if (queries?.recent) {
    queries.recent.forEach((query) => {
      // Skip queries without both userQuery AND pageSelections
      if (
        !query.userQuery &&
        (!query.pageSelections || query.pageSelections.length === 0)
      ) {
        console.warn(
          "⚠️ [querySelectItems] Skipping query without userQuery or pageSelections:",
          query
        );
        return;
      }

      // Generate display text: use userQuery if available, otherwise show page selections
      const displayText =
        query.userQuery ||
        (query.pageSelections && query.pageSelections.length > 0
          ? formatPageSelectionsDisplay(query.pageSelections)
          : "Empty query");

      const truncatedQuery =
        displayText.length > 70
          ? displayText.substring(0, 67) + "..."
          : displayText;

      items.push({
        id: query.id,
        type: "recent",
        query: query,
        label: truncatedQuery,
        description: formatTimestamp(query.timestamp), // Timestamp as description/label
        group: "📅 Recent Queries",
      });
    });
  }

  // Add saved queries
  if (queries?.saved) {
    queries.saved.forEach((query) => {
      // Skip queries without both userQuery AND pageSelections
      if (
        !query.userQuery &&
        (!query.pageSelections || query.pageSelections.length === 0)
      ) {
        console.warn(
          "⚠️ [querySelectItems] Skipping saved query without userQuery or pageSelections:",
          query
        );
        return;
      }

      // Generate display label: use name if available, otherwise userQuery, otherwise show page selections
      const displayLabel =
        query.name ||
        query.userQuery ||
        (query.pageSelections && query.pageSelections.length > 0
          ? formatPageSelectionsDisplay(query.pageSelections)
          : "Empty query");
      const truncatedLabel =
        displayLabel.length > 70
          ? displayLabel.substring(0, 67) + "..."
          : displayLabel;

      items.push({
        id: query.id,
        type: "saved",
        query: query,
        label: truncatedLabel,
        description:
          query.name && query.userQuery
            ? query.userQuery.length > 70
              ? query.userQuery.substring(0, 67) + "..."
              : query.userQuery
            : undefined,
        group: "⭐ Saved Queries",
      });
    });
  }

  return items;
};

/**
 * Group items by their group property with smart filtering support
 */
export const groupedItems = (
  items: QuerySelectItem[],
  filterQuery: string = ""
): QuerySelectItem[] => {
  // First, filter items if there's a filter query
  const filteredItems = filterQuery.trim()
    ? items.filter((item) => {
        const lowerQuery = filterQuery.toLowerCase();
        return (
          item.label.toLowerCase().includes(lowerQuery) ||
          (item.description &&
            item.description.toLowerCase().includes(lowerQuery))
        );
      })
    : items;

  // Group the filtered items
  const groups: { [key: string]: QuerySelectItem[] } = {};

  if (filteredItems.length)
    filteredItems.forEach((item) => {
      if (!groups[item.group]) {
        groups[item.group] = [];
      }
      groups[item.group].push(item);
    });

  const result: QuerySelectItem[] = [];

  // Add items with group headers (only if group has items)
  if (Object.entries(groups).length)
    Object.entries(groups).forEach(([groupName, groupItems], groupIndex) => {
      // Only add group header if there are items in this group
      if (groupItems.length > 0) {
        // Add a virtual group header item (if there are multiple groups with items AND the group has a name)
        if (Object.keys(groups).length > 1 && groupName.trim() !== "") {
          result.push({
            id: `__group_${groupIndex}`,
            type: "current", // dummy type
            label: groupName,
            group: groupName,
            description: `${groupItems.length} item${
              groupItems.length !== 1 ? "s" : ""
            }`,
          } as QuerySelectItem);
        }

        // Add the actual items
        result.push(...groupItems);
      }
    });

  return result;
};
