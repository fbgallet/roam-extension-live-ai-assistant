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
  getFormattedSkillsList,
} from "./skillsUtils";

export const liveaiSkillsTool = tool(
  async (
    input: {
      skill_name: string;
      resource_title?: string;
    },
    config
  ) => {
    const { skill_name, resource_title } = input;

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
      (s) => s.name.toLowerCase() === skill_name.toLowerCase()
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

      return `# Skill: ${skill.name}

## Resource: ${resourceContent.title}

${resourceContent.content}

---

You have loaded deeper instructions for "${resourceContent.title}". Use these detailed instructions to complete the specific task at hand. If you need more resources, call this tool again with a different resource_title.`;
    }

    // Extract core instructions (without resources)
    const instructions = extractSkillInstructions(skill.uid);

    if (!instructions) {
      return `Error loading skill "${skill_name}". The skill may be malformed.`;
    }

    // Build response with core instructions and available resources
    let response = `# Skill: ${instructions.name}

## Description
${instructions.description}

## Core Instructions
${instructions.instructions}`;

    // Add information about available deeper resources
    if (instructions.resources.length > 0) {
      response += `

---

**Deeper resources available:**
${instructions.resources.map((r) => `- "${r.title}"`).join("\n")}

**Next action:** If any resource would help complete the user's task, IMMEDIATELY call this tool again with skill_name="${
        instructions.name
      }" and resource_title="<exact name>" (don't ask user first - be autonomous and thorough).`;
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
2. If the response lists deeper resources and they're relevant, call again with skill_name + resource_title
3. You can load multiple resources in sequence (same turn)

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
    }),
  }
);

// **Progressive loading workflow (IMPORTANT - be autonomous):**
// 1. First call: Use skill_name only to get core instructions
// 2. Review the response: If it mentions "[Deeper resource available]", you SHOULD immediately:
//    - Evaluate if the deeper resource would help complete the user's task
//    - If YES: Call again with skill_name + resource_title (WITHOUT asking the user first)
//    - If NO: Proceed with core instructions only
// 3. Multiple resources: You can load multiple resources sequentially if needed
// 4. Follow ALL skill instructions - they supersede your general knowledge
