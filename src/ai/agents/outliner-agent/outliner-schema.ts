import { z } from "zod";

export const planerSchema = z.object({
  message: z
    .string()
    .nullable()
    .describe(
      "Message about error or difficulties encountered regarding the user's request (only if relevant) or, eventually, your answer to a very explicit request the extract some content from the outline. Otherwise, write only 'N/A'"
    ),
  operations: z
    .array(
      z.object({
        action: z
          .string()
          .describe(
            "Operation to perform on the block: update|append|move|create|reorder|delete"
          ),
        blockUid: z
          .string()
          .optional()
          .nullable()
          .describe(
            "The unique UID of the existing block being updated, completed or moved (make sure that it's strickly 9-characters) (optional)"
          ),
        newContent: z
          .string()
          .optional()
          .nullable()
          .describe(
            "The new content to create or to insert in the block, replacing or appended to the former (optional)"
          ),
        newChildren: z
          .string()
          .optional()
          .nullable()
          .describe(
            "If the block created has to be the parent of a rich content to be insert as children, provide its this content here. (optional)"
          ),
        targetParentUid: z
          .string()
          .optional()
          .nullable()
          .describe(
            "If action is 'create', 'move' or 'reorder', the unique AND existing UID (make sure that it's strickly 9-characters) of the parent block where this block should be created or inserted or reordered, or 'root' if the first level blocks are concerned. If target has no existing identifier, set to 'new', NEVER make up any identifier ! (optional)"
          ),
        newOrder: z
          .array(z.string())
          .optional()
          .nullable()
          .describe(
            "If action is 'reorder', an array of the UIDs (only provided ones, and make sure that it's strickly 9-characters, without parentheses!) representing the new order of the concerned blocks (optional)"
          ),
        position: z
          .number()
          .optional()
          .nullable()
          .describe(
            "Position (as a number) of a created or moved block in its new level. 0 is first, ignore this key to append as last block (optional)"
          ),
        format: z
          .object({
            open: z
              .boolean()
              .optional()
              .nullable()
              .describe("block is expanded (true) or collapsed (false)"),
            heading: z
              .number()
              .optional()
              .nullable()
              .describe("normal text is 0 (default), heading is 1|2|3"),
            "children-view-type": z
              .string()
              .optional()
              .nullable()
              .describe("bullet|numbered|document"),
          })
          .optional()
          .nullable()
          .describe(
            "Block format options: needed if action is 'format', optional if 'update', 'append' or 'create'"
          ),
      })
    )
    .describe("Array of all the operations to perform on the affected blocks"),
});
