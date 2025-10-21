/**
 * Simple Multiply Tool for Testing
 *
 * A basic tool that multiplies two numbers together.
 * Used for testing tool usage feedback in the chat UI.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const multiplyTool = tool(
  (input) => {
    return input.a * input.b;
  },
  {
    name: "multiply_tool",
    description: "Multiply two numbers a and b",
    schema: z.object({
      a: z.number().describe("number a"),
      b: z.number().describe("number b"),
    }),
  }
);
