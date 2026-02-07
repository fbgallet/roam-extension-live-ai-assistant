/**
 * LiveAI Skills Tool
 *
 * Provides access to Roam-based skills stored with #liveai/skill tag.
 * Skills provide specialized instructions and resources that are loaded
 * progressively as needed to reduce context overload.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  extractAllSkills,
  extractSkillInstructions,
  extractSkillResource,
  extractSkillRecords,
  getFormattedSkillsList,
} from "./skillsUtils";

export const liveaiSkillsTool = tool(
  async (
    input: {
      skill_name: string;
      resource_title?: string;
      records_title?: string;
    },
    config
  ) => {
    const { skill_name, resource_title, records_title } = input;

    // Get all available skills
    const availableSkills = extractAllSkills();

    if (availableSkills.length === 0) {
      return `No skills available in your Roam graph.

To create a skill, add a block with the structure:
- Skill Name #liveai/skill
  - Description: Brief description of what this skill helps accomplish
  - Instructions:
    - Step 1...
    - Step 2...
      - How to do X #liveai/skill-resource
        - Detailed instructions for X...`;
    }

    // Find the requested skill (case-insensitive match)
    const skill = availableSkills.find(
      (s) => s.name.toLowerCase().trim() === skill_name.toLowerCase().trim()
    );

    if (!skill) {
      const availableNames = availableSkills.map((s) => s.name).join(", ");
      return `Skill "${skill_name}" not found. Available skills: ${availableNames}`;
    }

    // If resource_title is provided, extract that specific resource
    if (resource_title) {
      const resourceContent = extractSkillResource(skill.uid, resource_title);

      if (!resourceContent) {
        const instructions = extractSkillInstructions(skill.uid);
        const availableResources = instructions?.resources
          .map((r) => r.title)
          .join(", ");

        return `Resource "${resource_title}" not found in skill "${skill_name}".${
          availableResources
            ? ` Available resources: ${availableResources}`
            : " No resources available in this skill."
        }`;
      }

      return `[DISPLAY]Loaded resource "${resourceContent.title}" from skill "${skill.name}"[/DISPLAY]

# Skill: ${skill.name}

## Resource: ${resourceContent.title}

${resourceContent.content}

---

You have loaded deeper instructions for "${resourceContent.title}". Use these detailed instructions to complete the specific task at hand. If you need more resources, call this tool again with a different resource_title.`;
    }

    // If records_title is provided, extract that specific records outline
    if (records_title) {
      const recordsContent = extractSkillRecords(skill.uid, records_title);

      if (!recordsContent) {
        const instructions = extractSkillInstructions(skill.uid);
        const availableRecords = instructions?.records
          .map((r) => r.title)
          .join(", ");

        return `Records "${records_title}" not found in skill "${skill_name}".${
          availableRecords
            ? ` Available records: ${availableRecords}`
            : " No records available in this skill."
        }`;
      }

      const targetLocation = recordsContent.targetPageName
        ? `page [[${recordsContent.targetPageName}]]`
        : "children of this records block";

      return `[DISPLAY]Loaded records "${recordsContent.title}" from skill "${skill.name}"[/DISPLAY]

# Skill: ${skill.name}

## Records: ${recordsContent.title}

**Description:** ${recordsContent.description}

**Target location:** ${targetLocation} (UID: \`${recordsContent.recordsUid}\`)

**Current content:**
${recordsContent.content}

---

These are EDITABLE RECORDS. You can:
- Use **create_block** with parent_uid="${recordsContent.recordsUid}" to add new entries on ${targetLocation}
- Use **update_block** to modify existing records within this outline
- Use **delete_block** to remove records from this outline

**IMPORTANT:** Always write records to the target location above (UID: \`${recordsContent.recordsUid}\`), NOT as children of the skill definition block.

Follow any conditions or format described above when adding or editing records.`;
    }

    // Extract core instructions (without resources)
    const instructions = extractSkillInstructions(skill.uid);

    if (!instructions) {
      return `Error loading skill "${skill_name}". The skill may be malformed.`;
    }

    // Build response with core instructions and available resources/records
    const totalExtras =
      instructions.resources.length + instructions.records.length;
    let response = `[DISPLAY]Loaded skill "${instructions.name}"${
      totalExtras > 0
        ? ` (${totalExtras} resource${totalExtras === 1 ? "" : "s"}/record${
            totalExtras === 1 ? "" : "s"
          } available)`
        : ""
    }[/DISPLAY]

# Skill: ${instructions.name}

## Description
${instructions.description}

## Core Instructions
${instructions.instructions}`;

    // Add information about available deeper resources and records
    if (instructions.resources.length > 0 || instructions.records.length > 0) {
      response += `\n\n---`;

      if (instructions.resources.length > 0) {
        response += `\n\n**Deeper resources available:**
${instructions.resources.map((r) => `- "${r.title}"`).join("\n")}`;
      }

      if (instructions.records.length > 0) {
        response += `\n\n**Editable records available:**
${instructions.records
  .map(
    (r) =>
      `- "${r.title}" (${
        r.isEmbed ? "target: external page, " : ""
      }records UID: \`${r.recordsUid}\`)${
        r.isEmbed ? " [records on external page]" : ""
      }`
  )
  .join("\n")}`;
      }

      response += `\n\n**Next action:** If any resource or records would help complete the user's task, IMMEDIATELY call this tool again with skill_name="${
        instructions.name
      }" and the appropriate parameter: resource_title or records_title (don't ask user first - be autonomous and thorough).`;
    }

    return response;
  },
  {
    name: "live_ai_skills",
    description: `Load expert skills from the user's Roam graph to get specialized workflows and step-by-step guidance.

Available skills: ${getFormattedSkillsList(true)}

When the user's request matches ANY available skill (even partially), call this tool to load the expert instructions. Skills provide specialized knowledge that will help you complete the task correctly. Full skill descriptions are in your system prompt.

Usage:
1. Call with skill_name to load core instructions
2. If the response lists deeper resources, call again with skill_name + resource_title
3. If the response lists editable records, call again with skill_name + records_title to see current content and get the records UID for writing
4. Use create_block/update_block with records UIDs to add or edit records
5. You can load multiple resources/records in sequence (same turn)

Note: If "## Active Skill Instructions" section in your prompt already contains the exact skill/resource you need, use it directly without calling again.`,
    schema: z.object({
      skill_name: z
        .string()
        .describe(
          "The name of the skill to load (exact name from available skills list)"
        ),
      resource_title: z
        .string()
        .optional()
        .describe(
          "Optional: The title of a specific deeper resource to load from within the skill. Only use this after loading the core skill instructions first and identifying that you need more detailed information on a specific topic."
        ),
      records_title: z
        .string()
        .optional()
        .describe(
          "Optional: The title of a specific editable records outline to load. Returns the records' current content and the UID needed to add or edit records using create_block or update_block."
        ),
    }),
  }
);

// **Progressive loading workflow (IMPORTANT - be autonomous):**
// 1. First call: Use skill_name only to get core instructions
// 2. Review the response: If it mentions "[Deeper resource available]" or "[Editable records available]", you SHOULD immediately:
//    - Evaluate if the deeper resource/records would help complete the user's task
//    - If YES: Call again with skill_name + resource_title or records_title (WITHOUT asking the user first)
//    - If NO: Proceed with core instructions only
// 3. Multiple resources/records: You can load multiple sequentially if needed
// 4. Follow ALL skill instructions - they supersede your general knowledge
