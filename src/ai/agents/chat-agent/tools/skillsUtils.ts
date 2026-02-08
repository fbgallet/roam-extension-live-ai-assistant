/**
 * Skills Utilities (Optimized)
 *
 * Functions to query and extract Roam-based skills for the chat agent.
 * Leverages existing dataExtraction functions for tree processing.
 */

import {
  getPageNameByPageUid,
  getPageUidByPageName,
  getParentBlock,
  getTreeByUid,
  hasBlockChildren,
  resolveReferences,
} from "../../../../utils/roamAPI";
import { embedRegex, strictPageRegex } from "../../../../utils/regex";
import { getFlattenedContentFromTree } from "../../../dataExtraction";

const DESCRIPTION_PREFIX_REGEX = /^\*{0,2}Description\*{0,2}::?\s*/i;
const RESOURCE_PREFIX_REGEX = /^\*{0,2}Resources?\*{0,2}::?\s*/i;
const RECORDS_PREFIX_REGEX = /^\*{0,2}Records?\*{0,2}::?\s*/i;

export interface SkillInfo {
  name: string;
  description: string;
  uid: string;
}

export interface SkillInstructions {
  name: string;
  description: string;
  instructions: string;
  resources: SkillResourceInfo[];
  records: SkillRecordsInfo[];
}

export interface SkillResourceInfo {
  title: string;
  blockString: string;
  uid: string;
}

export interface SkillResourceContent {
  title: string;
  content: string;
}

export interface SkillRecordsInfo {
  title: string;
  description: string;
  uid: string;
  recordsUid: string;
  isEmbed: boolean;
}

export interface SkillRecordsContent {
  title: string;
  description: string;
  recordsUid: string;
  content: string;
  targetPageName?: string;
}

/**
 * Flatten a description block: extract its own text (stripping prefix)
 * plus all children content as a multi-line string.
 */
function flattenDescriptionBlock(block: any): string {
  let text = (block.string || "").replace(DESCRIPTION_PREFIX_REGEX, "").trim();

  if (block.children && block.children.length > 0) {
    try {
      const childrenContent = getFlattenedContentFromTree({
        parentUid: block.uid,
        maxCapturing: 99,
        maxUid: 0,
        withDash: false,
        isParentToIgnore: true,
      });
      if (childrenContent.trim()) {
        text += "\n" + childrenContent;
      }
    } catch {
      // getFlattenedContentFromTree may not be available yet at module init time
    }
  }

  return text;
}

// Tag detection helpers — support both singular and plural forms
function isResourceTag(str: string): boolean {
  return /(?:^|\s)#liveai\/skill-resources?(?:\s|$)/i.test(str);
}

function isRecordsTag(str: string): boolean {
  return /(?:^|\s)#liveai\/skill-records?(?:\s|$)/i.test(str);
}

function stripSkillTag(str: string): string {
  return str.replace(/#liveai\/skills?/gi, "").trim();
}

function stripResourceTag(str: string): string {
  return str.replace(/#liveai\/skill-resources?/gi, "").trim();
}

function stripRecordsTag(str: string): string {
  return str.replace(/#liveai\/skill-records?/gi, "").trim();
}

/**
 * Extract all blocks containing #liveai/skill(s) tag from the graph
 * @returns Array of skill information (name, description, uid)
 */
export function extractAllSkills(): SkillInfo[] {
  try {
    // Query blocks referencing both singular and plural pages
    const query = `[:find ?uid ?string
                    :where
                    [?skill-page :node/title "liveai/skill"]
                    [?block :block/refs ?skill-page]
                    [?block :block/uid ?uid]
                    [?block :block/string ?string]]`;

    const queryPlural = `[:find ?uid ?string
                    :where
                    [?skill-page :node/title "liveai/skills"]
                    [?block :block/refs ?skill-page]
                    [?block :block/uid ?uid]
                    [?block :block/string ?string]]`;

    const results = window.roamAlphaAPI.q(query) || [];
    const resultsPlural = window.roamAlphaAPI.q(queryPlural) || [];

    // Merge and deduplicate by uid
    const allResults = [...results];
    const seenUids = new Set(results.map((r: any) => r[0]));
    for (const r of resultsPlural) {
      if (!seenUids.has(r[0])) {
        allResults.push(r);
        seenUids.add(r[0]);
      }
    }

    if (allResults.length === 0) {
      return [];
    }

    const skills: SkillInfo[] = [];

    for (const [uid, blockString] of allResults) {
      // Extract skill name (everything before the tag)
      const name = stripSkillTag(blockString);

      // Get the tree to extract description
      const tree = getTreeByUid(uid);
      if (!tree || !tree[0]) continue;

      const rootBlock = tree[0];
      const children = rootBlock.children || [];

      // Find description in first child (including its children if any)
      let description = "";
      if (children.length > 0) {
        const firstChild = children.sort(
          (a: any, b: any) => (a.order || 0) - (b.order || 0)
        )[0];
        if (firstChild && firstChild.string) {
          if (DESCRIPTION_PREFIX_REGEX.test(firstChild.string)) {
            description = flattenDescriptionBlock(firstChild);
          } else {
            description = firstChild.string.trim();
          }
        }
      }

      skills.push({
        name,
        description,
        uid,
      });
    }

    return skills;
  } catch (error) {
    console.error("Error extracting skills:", error);
    return [];
  }
}

/**
 * Extract the core instructions of a skill (excluding resource/records children)
 * Uses existing tree traversal functions with custom resource handling
 * @param skillUid The UID of the skill block
 * @returns Skill instructions with list of available resources and records
 */
export function extractSkillInstructions(
  skillUid: string
): SkillInstructions | null {
  try {
    const tree = getTreeByUid(skillUid);
    if (!tree || !tree[0]) return null;

    const rootBlock = tree[0];
    const children = rootBlock.children || [];

    if (children.length === 0) return null;

    const sortedChildren = [...children].sort(
      (a: any, b: any) => (a.order || 0) - (b.order || 0)
    );

    // Extract name and description (including children of description block)
    const name = stripSkillTag(rootBlock.string);
    const firstChild = sortedChildren[0];
    const isFirstChildDescription =
      firstChild &&
      firstChild.string &&
      DESCRIPTION_PREFIX_REGEX.test(firstChild.string);
    const description = isFirstChildDescription
      ? flattenDescriptionBlock(firstChild)
      : firstChild?.string?.trim() || "";

    // Extract instructions (skip first child only if it's the description)
    const instructionsBlocks = sortedChildren.slice(
      isFirstChildDescription ? 1 : 0
    );
    const resources: SkillResourceInfo[] = [];
    const records: SkillRecordsInfo[] = [];
    const instructionLines: string[] = [];

    // Process blocks to identify resources, records, and build instructions
    function processBlock(block: any, indent: number = 0) {
      const blockString = block.string || "";

      // Check for resource (tag or prefix)
      const hasResourceTag = isResourceTag(blockString);
      const isPrefixResource =
        !hasResourceTag && RESOURCE_PREFIX_REGEX.test(blockString);
      const isResource = hasResourceTag || isPrefixResource;

      // Check for records (tag or prefix)
      const hasRecordsTag = !isResource && isRecordsTag(blockString);
      const isPrefixRecords =
        !isResource && !hasRecordsTag && RECORDS_PREFIX_REGEX.test(blockString);
      const isRecords = hasRecordsTag || isPrefixRecords;

      if (isResource) {
        // Collect resource metadata
        const resourceTitle = hasResourceTag
          ? stripResourceTag(blockString)
          : blockString.replace(RESOURCE_PREFIX_REGEX, "").trim();
        resources.push({
          title: resourceTitle,
          blockString: blockString,
          uid: block.uid,
        });

        const indentStr = "  ".repeat(indent);
        const resolvedTitle = resolveReferences(resourceTitle);
        instructionLines.push(
          `${indentStr}- ${resolvedTitle} [Deeper resource available]`
        );
        // Don't process children of resource blocks
      } else if (isRecords) {
        // Extract records title/description
        const recordsDescription = hasRecordsTag
          ? stripRecordsTag(blockString)
          : blockString.replace(RECORDS_PREFIX_REGEX, "").trim();

        // Resolve the actual records UID — check if first child is an embed
        const blockChildren = block.children
          ? [...block.children].sort(
              (a: any, b: any) => (a.order || 0) - (b.order || 0)
            )
          : [];

        let recordsUid = block.uid;
        let isEmbed = false;

        if (blockChildren.length > 0) {
          const firstChildStr = blockChildren[0].string || "";
          const embedMatch = firstChildStr.match(embedRegex);
          if (embedMatch) {
            isEmbed = true;
            const embedRef = embedMatch[2].trim();
            if (strictPageRegex.test(embedRef)) {
              const pageName = embedRef.slice(2, -2);
              recordsUid = getPageUidByPageName(pageName) || block.uid;
            } else {
              recordsUid = embedRef
                .replace(/^\(\(/, "")
                .replace(/\)\)$/, "");
            }
          }
        }

        // Fallback: if no embed, check for [[page]] reference in the description
        if (!isEmbed) {
          const pageMatch = recordsDescription.match(/\[\[([^\]]+)\]\]/);
          if (pageMatch) {
            const pageName = pageMatch[1];
            const pageUid = getPageUidByPageName(pageName);
            if (pageUid) {
              recordsUid = pageUid;
              isEmbed = true;
            }
          }
        }

        records.push({
          title: recordsDescription,
          description: recordsDescription,
          uid: block.uid,
          recordsUid,
          isEmbed,
        });

        const indentStr = "  ".repeat(indent);
        const resolvedTitle = resolveReferences(recordsDescription);
        instructionLines.push(
          `${indentStr}- ${resolvedTitle} [Editable records available]`
        );
        // Don't process children of records blocks
      } else {
        // Add instruction with resolved references
        const indentStr = "  ".repeat(indent);
        const resolvedContent = resolveReferences(blockString);
        instructionLines.push(`${indentStr}- ${resolvedContent}`);

        // Recursively process children
        if (block.children && block.children.length > 0) {
          const sortedChildren = [...block.children].sort(
            (a: any, b: any) => (a.order || 0) - (b.order || 0)
          );
          sortedChildren.forEach((child: any) =>
            processBlock(child, indent + 1)
          );
        }
      }
    }

    // Process all instruction blocks
    instructionsBlocks.forEach((block: any) => processBlock(block, 0));

    return {
      name,
      description,
      instructions: instructionLines.join("\n"),
      resources,
      records,
    };
  } catch (error) {
    console.error("Error extracting skill instructions:", error);
    return null;
  }
}

/**
 * Extract the detailed content of a specific skill resource
 * Uses optimized Datomic query to find resource block directly
 * @param skillUid The UID of the skill block
 * @param resourceTitle The title/blockString of the resource to extract
 * @returns Resource content with all children
 */
export function extractSkillResource(
  skillUid: string,
  resourceTitle: string
): SkillResourceContent | null {
  try {
    // Clean the resource title for matching
    const cleanedResourceTitle = resourceTitle
      .replace(/\s?#liveai\/skill-resources?/gi, "")
      .trim();

    // Use Datomic query to find descendant blocks that:
    // 1. Are descendants of the skill block (using :block/parents reverse relationship)
    // 2. Reference the liveai/skill-resource page
    // 3. Contain the cleaned resource title in their content
    const query = `[:find ?uid ?string ?refs-uid
                    :where
                    [?parent :block/uid "${skillUid}"]
                    [?block :block/parents ?parent]
                    [?skill-resource-page :node/title "liveai/skill-resource"]
                    [?block :block/refs ?skill-resource-page]
                    [?block :block/uid ?uid]
                    [?block :block/string ?string]
                    [(clojure.string/includes? ?string "${resourceTitle}")]
                    [?block :block/refs ?refs]
                    [?refs :block/uid ?refs-uid]]`;

    // Also query for plural form
    const queryPlural = `[:find ?uid ?string ?refs-uid
                    :where
                    [?parent :block/uid "${skillUid}"]
                    [?block :block/parents ?parent]
                    [?skill-resource-page :node/title "liveai/skill-resources"]
                    [?block :block/refs ?skill-resource-page]
                    [?block :block/uid ?uid]
                    [?block :block/string ?string]
                    [(clojure.string/includes? ?string "${resourceTitle}")]
                    [?block :block/refs ?refs]
                    [?refs :block/uid ?refs-uid]]`;

    const results = window.roamAlphaAPI.q(query);
    const resultsPlural = window.roamAlphaAPI.q(queryPlural);
    const allResults =
      results && results.length > 0
        ? results
        : resultsPlural && resultsPlural.length > 0
        ? resultsPlural
        : null;

    let resourceUid: string;
    let resourceRefs: string[];

    if (allResults && allResults.length > 0) {
      // Tag-based resource found via Datomic query
      resourceUid = allResults[0][0];
      const resourcePageUid =
        getPageUidByPageName("liveai/skill-resource") ||
        getPageUidByPageName("liveai/skill-resources");
      resourceRefs = allResults
        .filter((r: any) => r[2] !== resourcePageUid)
        .map((r: any) => r[2]);
    } else {
      // Fallback: search tree for "Resource:" prefix blocks
      const found = findPrefixBlockInTree(
        skillUid,
        cleanedResourceTitle,
        RESOURCE_PREFIX_REGEX
      );
      if (!found) return null;
      resourceUid = found.uid;
      resourceRefs = [];
    }

    let content = "";
    if (resourceRefs && resourceRefs.length) {
      content = "**Resources pages content**:\n";
      resourceRefs.forEach((ref: string) => {
        const isPage = !getParentBlock(ref);
        if (isPage)
          content += `Content of [[${getPageNameByPageUid(ref)}]] page:\n`;
        else content += `Content of ((${ref})) block:\n`;
        content += getFlattenedContentFromTree({
          parentUid: ref,
          maxCapturing: 99,
          maxUid: 0,
          withDash: true,
          isParentToIgnore: isPage,
          initialLeftShift: "  ",
        });
        content += "\n\n";
      });
    }

    // Use existing getFlattenedContentFromTree to extract children efficiently
    content +=
      (content.length && hasBlockChildren(resourceUid)
        ? "Direct resource content:\n"
        : "") +
      getFlattenedContentFromTree({
        parentUid: resourceUid,
        maxCapturing: 99,
        maxUid: 0,
        withDash: true,
        isParentToIgnore: true,
      });

    return {
      title: cleanedResourceTitle,
      content: content || "(No additional content in this resource)",
    };
  } catch (error) {
    console.error("Error extracting skill resource:", error);
    return null;
  }
}

/**
 * Walk a skill tree to find a block matching a prefix pattern with a given title.
 * Used as fallback when Datomic query doesn't find tag-based blocks.
 */
function findPrefixBlockInTree(
  skillUid: string,
  searchTitle: string,
  prefixRegex: RegExp
): { uid: string } | null {
  const tree = getTreeByUid(skillUid);
  if (!tree || !tree[0]) return null;

  const normalizedTitle = searchTitle.toLowerCase().trim();

  function searchChildren(children: any[]): { uid: string } | null {
    if (!children) return null;
    for (const child of children) {
      const str = child.string || "";
      if (prefixRegex.test(str)) {
        const title = str.replace(prefixRegex, "").trim();
        if (title.toLowerCase() === normalizedTitle) {
          return { uid: child.uid };
        }
      }
      const found = searchChildren(child.children);
      if (found) return found;
    }
    return null;
  }

  return searchChildren(tree[0].children || []);
}

/**
 * Walk the skill tree to find a records block by title match.
 * Checks both #liveai/skill-record(s) tag and Records: prefix.
 */
function findRecordsInTree(
  children: any[],
  recordsTitle: string
): any | null {
  if (!children) return null;
  const normalizedTitle = recordsTitle.toLowerCase().trim();

  for (const child of children) {
    const str = child.string || "";

    if (isRecordsTag(str)) {
      const title = stripRecordsTag(str);
      if (title.toLowerCase() === normalizedTitle) return child;
    }
    if (RECORDS_PREFIX_REGEX.test(str)) {
      const title = str.replace(RECORDS_PREFIX_REGEX, "").trim();
      if (title.toLowerCase() === normalizedTitle) return child;
    }

    const found = findRecordsInTree(child.children, recordsTitle);
    if (found) return found;
  }
  return null;
}

/**
 * Extract the content and records UID of a specific skill records outline.
 * Resolves embeds to find the actual UID for writing.
 * @param skillUid The UID of the skill block
 * @param recordsTitle The title of the records to extract
 * @returns Records content with writable UID
 */
export function extractSkillRecords(
  skillUid: string,
  recordsTitle: string
): SkillRecordsContent | null {
  try {
    const cleanedTitle = recordsTitle.trim();

    const tree = getTreeByUid(skillUid);
    if (!tree || !tree[0]) return null;

    const recordsBlock = findRecordsInTree(
      tree[0].children || [],
      cleanedTitle
    );
    if (!recordsBlock) return null;

    // Extract description from the block text
    const blockStr = recordsBlock.string || "";
    let description: string;
    if (isRecordsTag(blockStr)) {
      description = stripRecordsTag(blockStr);
    } else {
      description = blockStr.replace(RECORDS_PREFIX_REGEX, "").trim();
    }

    // Resolve the actual records UID (handle embeds)
    const sortedChildren = recordsBlock.children
      ? [...recordsBlock.children].sort(
          (a: any, b: any) => (a.order || 0) - (b.order || 0)
        )
      : [];

    let actualRecordsUid = recordsBlock.uid;
    let embedFound = false;
    let targetPageName: string | undefined;

    if (sortedChildren.length > 0) {
      const firstChildStr = sortedChildren[0].string || "";
      const embedMatch = firstChildStr.match(embedRegex);
      if (embedMatch) {
        embedFound = true;
        const embedRef = embedMatch[2].trim();
        if (strictPageRegex.test(embedRef)) {
          const pageName = embedRef.slice(2, -2);
          actualRecordsUid =
            getPageUidByPageName(pageName) || recordsBlock.uid;
          targetPageName = pageName;
        } else {
          actualRecordsUid = embedRef
            .replace(/^\(\(/, "")
            .replace(/\)\)$/, "");
        }
      }
    }

    // Fallback: if no embed, check for [[page]] reference in the description
    if (!embedFound) {
      const pageMatch = description.match(/\[\[([^\]]+)\]\]/);
      if (pageMatch) {
        const pageName = pageMatch[1];
        const pageUid = getPageUidByPageName(pageName);
        if (pageUid) {
          actualRecordsUid = pageUid;
          targetPageName = pageName;
        }
      }
    }

    // Get the current content of the records outline
    const content = getFlattenedContentFromTree({
      parentUid: actualRecordsUid,
      maxCapturing: 99,
      maxUid: 0,
      withDash: true,
      isParentToIgnore: true,
    });

    return {
      title: cleanedTitle,
      description,
      recordsUid: actualRecordsUid,
      content: content || "(Empty records - no content yet)",
      targetPageName,
    };
  } catch (error) {
    console.error("Error extracting skill records:", error);
    return null;
  }
}

/**
 * Get a formatted list of all available skills
 * @param short If true, only show skill names without descriptions
 * @returns Formatted string for tool description or system prompt
 */
export function getFormattedSkillsList(short: boolean = false): string {
  const skills = extractAllSkills();

  if (skills.length === 0) {
    return "No skills available. Users can create skills by adding blocks with #liveai/skill tag.";
  }

  const skillsList = skills
    .map((skill) =>
      short ? `"${skill.name}"` : `- "${skill.name}": ${skill.description}`
    )
    .join(short ? ", " : "\n");

  return short ? skillsList : `Available skills:\n${skillsList}`;
}
