import { z } from "zod";

export const schema = z
  .object({
    // Input - what to fetch details for
    blockUids: z
      .array(z.string())
      .optional()
      .describe("Array of block UIDs to get details for"),
    pageUids: z
      .array(z.string())
      .optional()
      .describe("Array of page UIDs to get details for"),
    fromResultId: z
      .string()
      .optional()
      .describe(
        "Get details for blocks/pages from previous result (e.g., 'findBlocksByContent_001')"
      ),

    // What details to include
    includeContent: z
      .boolean()
      .default(true)
      .describe("Include full block content (secure mode: false)"),
    includeMetadata: z
      .boolean()
      .default(true)
      .describe("Include creation/modification dates"),
    includeHierarchy: z
      .boolean()
      .default(false)
      .describe("Include parent/child information"),

    // Limiting
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum number of nodes to fetch details for"),
    // Result lifecycle management
    purpose: z
      .enum(["final", "intermediate", "replacement", "completion"])
      .optional()
      .describe(
        "Purpose: 'final' for user response data, 'intermediate' for non-final multi-step, 'replacement' to replace previous results, 'completion' to add to previous results"
      ),
  })
  .refine(
    (data) =>
      data.blockUids?.length > 0 ||
      data.pageUids?.length > 0 ||
      data.fromResultId,
    { message: "Either blockUids, pageUids, or fromResultId must be provided" }
  );
