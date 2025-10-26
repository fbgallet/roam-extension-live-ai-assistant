/**
 * Skills Utilities (Optimized)
 *
 * Functions to query and extract Roam-based skills for the chat agent.
 * Leverages existing dataExtraction functions for tree processing.
 */

import { getTreeByUid, resolveReferences } from "../../../../utils/roamAPI";
import { convertTreeToLinearArray, getFlattenedContentFromTree } from "../../../dataExtraction";

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

/**
 * Extract all blocks containing #liveai/skill tag from the graph
 * @returns Array of skill information (name, description, uid)
 */
export function extractAllSkills(): SkillInfo[] {
  try {
    // Query all blocks that reference the page "liveai/skill"
    const query = `[:find ?uid ?string
                    :where
                    [?skill-page :node/title "liveai/skill"]
                    [?block :block/refs ?skill-page]
                    [?block :block/uid ?uid]
                    [?block :block/string ?string]]`;

    const results = window.roamAlphaAPI.q(query);

    if (!results || results.length === 0) {
      return [];
    }

    const skills: SkillInfo[] = [];

    for (const [uid, blockString] of results) {
      // Extract skill name (everything before the tag)
      const name = blockString.replace(/#liveai\/skill/gi, '').trim();

      // Get the tree to extract description
      const tree = getTreeByUid(uid);
      if (!tree || !tree[0]) continue;

      const rootBlock = tree[0];
      const children = rootBlock.children || [];

      // Find description in first child
      let description = '';
      if (children.length > 0) {
        const firstChild = children.sort((a, b) => (a.order || 0) - (b.order || 0))[0];
        if (firstChild && firstChild.string) {
          description = firstChild.string.replace(/^Description::?\s*/i, '').trim();
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
    console.error('Error extracting skills:', error);
    return [];
  }
}

/**
 * Extract the core instructions of a skill (excluding #liveai/skill-resource children)
 * Uses existing tree traversal functions with custom resource handling
 * @param skillUid The UID of the skill block
 * @returns Skill instructions with list of available resources
 */
export function extractSkillInstructions(skillUid: string): SkillInstructions | null {
  try {
    const tree = getTreeByUid(skillUid);
    if (!tree || !tree[0]) return null;

    const rootBlock = tree[0];
    const children = rootBlock.children || [];

    if (children.length === 0) return null;

    const sortedChildren = [...children].sort((a, b) => (a.order || 0) - (b.order || 0));

    // Extract name and description
    const name = rootBlock.string.replace(/#liveai\/skill/gi, '').trim();
    const description = sortedChildren[0]?.string?.replace(/^Description::?\s*/i, '').trim() || '';

    // Extract instructions (skip first child which is description)
    const instructionsBlocks = sortedChildren.slice(1);
    const resources: SkillResourceInfo[] = [];
    const instructionLines: string[] = [];

    // Process blocks to identify resources and build instructions
    // We need custom logic here because we want to:
    // 1. Show resource blocks but not their children
    // 2. Collect resource metadata
    // This is a special case that convertTreeToLinearArray doesn't handle directly
    function processBlock(block: any, indent: number = 0) {
      const blockString = block.string || '';
      const isResource = blockString.includes('#liveai/skill-resource');

      if (isResource) {
        // Collect resource metadata
        const resourceTitle = blockString.replace(/#liveai\/skill-resource/gi, '').trim();
        resources.push({
          title: resourceTitle,
          blockString: blockString,
          uid: block.uid,
        });

        // Add resource reference (with resolved block refs)
        const indentStr = '  '.repeat(indent);
        const resolvedTitle = resolveReferences(resourceTitle);
        instructionLines.push(
          `${indentStr}- ${resolvedTitle} [Deeper resource available]`
        );
        // Don't process children of resource blocks
      } else {
        // Add instruction with resolved references
        const indentStr = '  '.repeat(indent);
        const resolvedContent = resolveReferences(blockString);
        instructionLines.push(`${indentStr}- ${resolvedContent}`);

        // Recursively process children
        if (block.children && block.children.length > 0) {
          const sortedChildren = [...block.children].sort((a, b) => (a.order || 0) - (b.order || 0));
          sortedChildren.forEach((child) => processBlock(child, indent + 1));
        }
      }
    }

    // Process all instruction blocks
    instructionsBlocks.forEach((block) => processBlock(block, 0));

    return {
      name,
      description,
      instructions: instructionLines.join('\n'),
      resources,
    };
  } catch (error) {
    console.error('Error extracting skill instructions:', error);
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
    const cleanedResourceTitle = resourceTitle.replace(/#liveai\/skill-resource/gi, '').trim();

    // Use Datomic query to find descendant blocks that:
    // 1. Are descendants of the skill block (using :block/parents reverse relationship)
    // 2. Reference the liveai/skill-resource page
    // 3. Contain the cleaned resource title in their content
    const query = `[:find ?uid ?string
                    :where
                    [?parent :block/uid "${skillUid}"]
                    [?block :block/parents ?parent]
                    [?skill-resource-page :node/title "liveai/skill-resource"]
                    [?block :block/refs ?skill-resource-page]
                    [?block :block/uid ?uid]
                    [?block :block/string ?string]
                    [(clojure.string/includes? ?string "${cleanedResourceTitle}")]]`;

    const results = window.roamAlphaAPI.q(query);

    if (!results || results.length === 0) {
      return null;
    }

    // Use the first matching result
    const [resourceUid] = results[0];

    // Use existing getFlattenedContentFromTree to extract children efficiently
    // This automatically handles:
    // - Block reference resolution
    // - Proper indentation
    // - Tree traversal
    const content = getFlattenedContentFromTree({
      parentUid: resourceUid,
      maxCapturing: 99,
      maxUid: 0,
      withDash: true,
      isParentToIgnore: true, // Don't include the parent block itself, just children
    });

    return {
      title: cleanedResourceTitle,
      content: content || '(No additional content in this resource)',
    };
  } catch (error) {
    console.error('Error extracting skill resource:', error);
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
    return 'No skills available. Users can create skills by adding blocks with #liveai/skill tag.';
  }

  const skillsList = skills
    .map(skill => short ? `"${skill.name}"` : `- "${skill.name}": ${skill.description}`)
    .join(short ? ', ' : '\n');

  return short ? skillsList : `Available skills:\n${skillsList}`;
}
