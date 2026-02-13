/**
 * Random Pick Tool
 *
 * Randomly picks one or more unique items from a provided list.
 * The LLM is responsible for assembling the items array before calling this tool:
 * - From context panel results (extract label + uid)
 * - From a user-provided list
 * - From an LLM-generated list (e.g., all EU countries)
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Fisher-Yates shuffle (in-place, returns same array)
const fisherYatesShuffle = <T>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export const randomPickTool = tool(
  async (input, config) => {
    const { items, count = 1, select_in_ui = false } = input;

    // Validate count
    if (count > items.length) {
      return `Error: Requested ${count} items but only ${items.length} available. Please request at most ${items.length}.`;
    }

    // Shuffle a copy and take the first `count` elements
    const shuffled = fisherYatesShuffle([...items]);
    const picked = shuffled.slice(0, count);

    // Optionally select in UI
    if (select_in_ui) {
      const selectResultsCallback = config?.configurable?.selectResultsCallback;
      const uids = picked.map((item) => item.uid).filter(Boolean);
      if (selectResultsCallback && uids.length > 0) {
        selectResultsCallback(uids);
      }
    }

    // Format result — just the picked items, no parameters echoed
    if (picked.length === 1) {
      return picked[0].label;
    }
    return picked.map((item, i) => `${i + 1}. ${item.label}`).join("\n");
  },
  {
    name: "random_pick",
    description: `Randomly pick one or more unique items from a list. Uses unbiased Fisher-Yates shuffle — no duplicates guaranteed.

IMPORTANT: You must always build the full items array BEFORE calling this tool:
- From context results: extract each result's page title (or content snippet) as label, and its uid
- From a user-provided list: map each item to a label
- From your own knowledge: enumerate ALL valid options first (e.g., all 27 EU member states), then pass them as items

Never call this tool with a partial or incomplete list — the randomness is only as good as the input list.`,
    schema: z.object({
      items: z
        .array(
          z.object({
            label: z.string().describe("Display label for the item"),
            uid: z
              .string()
              .optional()
              .describe(
                "Roam block/page UID, if the item comes from context results",
              ),
          }),
        )
        .min(1)
        .describe("The complete list of items to randomly pick from"),
      count: z
        .number()
        .int()
        .min(1)
        .optional()
        .default(1)
        .describe(
          "Number of items to randomly pick. Must be ≤ items.length. Defaults to 1. Picked items are guaranteed unique (no duplicates).",
        ),
      select_in_ui: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Set to tru if explicitly asked to select/check the picked items in the context panel UI (only if they have UID)",
        ),
    }),
  },
);
