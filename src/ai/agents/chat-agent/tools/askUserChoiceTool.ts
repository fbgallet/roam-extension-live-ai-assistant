/**
 * Ask User Choice Tool
 *
 * A general-purpose tool the agent can call when it needs the user to select
 * among specific options before proceeding. Rendered inline in chat as an
 * interactive form.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const askUserChoiceTool = tool(
  async (input, config) => {
    console.log(
      "🔍 [ask_user_choice] Tool called with input:",
      JSON.stringify(input).slice(0, 200),
    );
    const userChoiceCallback = config?.configurable?.userChoiceCallback;
    if (!userChoiceCallback) {
      return JSON.stringify({ error: "User choice not available" });
    }

    const result = await userChoiceCallback({
      commandId: input.command_id || "agent_choice",
      title: input.title,
      hintsEnabled: input.hints_enabled ?? false,
      options: input.options.map((opt) => ({
        id: opt.id,
        label: opt.label,
        type: (opt.type || "radio") as "radio" | "checkbox" | "text" | "slider",
        choices: opt.choices?.map((c) => ({
          value: c.value,
          label: c.label,
          hint: c.hint,
        })),
        defaultValue:
          opt.type === "text"
            ? ""
            : opt.type === "slider"
              ? String(Math.round(((opt.min ?? 0) + (opt.max ?? 10)) / 2))
              : opt.choices?.[0]?.value,
        placeholder: opt.placeholder,
        min: opt.min,
        max: opt.max,
        step: opt.step,
      })),
    });

    console.log("🔍 [ask_user_choice] User responded:", JSON.stringify(result));
    if (result.cancelled) {
      return JSON.stringify({ cancelled: true });
    }

    return JSON.stringify({ selections: result.selectedOptions });
  },
  {
    name: "ask_user_choice",
    description:
      "Present the user with an interactive choice form inline in the chat. Use this tool whenever: (1) A request is ambiguous and you need the user to pick an approach before proceeding, (2) You want to offer the user a set of options to choose from (e.g. quiz/QCM questions, polls, preference selection), (3) A task has multiple valid paths and the user should decide (e.g. format, scope, style), (4) You are building an interactive experience that requires step-by-step user input. Prefer this over listing options as plain text whenever the user needs to make an actual selection that drives what happens next.",
    schema: z.object({
      title: z.string().describe("Short title for the choice form"),
      command_id: z.string().optional().describe("Identifier for tracking"),
      hints_enabled: z
        .boolean()
        .optional()
        .describe(
          "If true, show a 'Show hints' toggle button. When user enables it, hints on individual choices are revealed on hover. Great for quizzes/QCM.",
        ),
      options: z
        .array(
          z.object({
            id: z.string().describe("Unique key for this option group"),
            label: z.string().describe("Label displayed above the choices"),
            type: z
              .enum(["radio", "checkbox", "text", "slider"])
              .optional()
              .describe(
                "Input type: 'radio' for single choice (default), 'checkbox' for multiple selections, 'text' for free-form written input, 'slider' for numeric range (use with min/max/step)",
              ),
            choices: z
              .array(
                z.object({
                  value: z.string().describe("Value returned when selected"),
                  label: z.string().describe("Display text for the choice"),
                  hint: z
                    .string()
                    .optional()
                    .describe(
                      "Hint text shown on hover when hints are enabled. For QCM: a clue to help the user.",
                    ),
                }),
              )
              .optional()
              .describe(
                "Available choices (required for radio/checkbox, omit for text)",
              ),
            placeholder: z
              .string()
              .optional()
              .describe("Placeholder text for text input fields"),
            min: z
              .number()
              .optional()
              .describe("Minimum value for slider (default: 0)"),
            max: z
              .number()
              .optional()
              .describe("Maximum value for slider (default: 10)"),
            step: z
              .number()
              .optional()
              .describe("Step increment for slider (default: 1)"),
          }),
        )
        .describe("Option groups to present"),
    }),
  },
);
