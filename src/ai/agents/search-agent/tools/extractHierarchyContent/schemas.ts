import { z } from "zod";

export const extractOptionsSchema = z.object({
  maxBlocks: z
    .number()
    .min(1)
    .max(1000)
    .default(100)
    .describe("Maximum blocks to include in extraction"),
  maxDepth: z
    .number()
    .min(1)
    .max(10)
    .default(5)
    .describe("Maximum hierarchy depth to extract"),
  includeReferences: z
    .boolean()
    .default(true)
    .describe("Include page/block references in output"),
  includeMetadata: z
    .boolean()
    .default(false)
    .describe("Include creation/modification dates"),
  truncateLength: z
    .number()
    .min(50)
    .max(1000)
    .default(500)
    .describe("Max characters per block content"),
  indentSize: z
    .number()
    .min(1)
    .max(8)
    .default(2)
    .describe("Spaces per indentation level"),
  bulletStyle: z
    .enum(["dash", "bullet", "number", "none"])
    .default("dash")
    .describe("Bullet point style"),
});

export const formatOptionsSchema = z.object({
  outputFormat: z
    .enum(["markdown", "plain", "roam", "outline"])
    .default("markdown"),
  includeBlockUIDs: z
    .boolean()
    .default(false)
    .describe("Include block UIDs in output"),
  includePageContext: z
    .boolean()
    .default(true)
    .describe("Include page title and context"),
  separatePages: z
    .boolean()
    .default(true)
    .describe("Separate content from different pages"),
  addTimestamps: z
    .boolean()
    .default(false)
    .describe("Add timestamps to blocks"),
  linkFormat: z
    .enum(["roam", "markdown", "plain"])
    .default("roam")
    .describe("How to format links"),
});

export const schema = z
  .object({
    blockUids: z
      .array(z.string().min(9).max(9))
      .optional().nullable()
      .describe("Array of block UIDs to extract content from"),
    fromResultId: z
      .string()
      .optional().nullable()
      .describe(
        "Extract content from block UIDs in previous result (e.g., 'findBlocksByContent_001')"
      ),
    extractOptions: extractOptionsSchema.default({}),
    formatOptions: formatOptionsSchema.default({}),

    // Content filtering
    excludeEmpty: z.boolean().default(true).describe("Exclude empty blocks"),
    includeParents: z
      .boolean()
      .default(false)
      .describe("Include parent blocks for context"),
    includeChildren: z.boolean().default(true).describe("Include child blocks"),

    // Reference handling
    resolveReferences: z
      .boolean()
      .default(false)
      .describe("Resolve page/block references to their content"),
    maxReferenceDepth: z
      .number()
      .min(0)
      .max(3)
      .default(1)
      .describe("Max depth for reference resolution"),
  })
  .refine((data) => data.blockUids?.length > 0 || data.fromResultId, {
    message: "Either blockUids array or fromResultId must be provided",
  });

export interface BlockNode {
  uid: string;
  content: string;
  level: number;
  children: BlockNode[];
  created?: Date;
  modified?: Date;
  page?: string;
  pageUid?: string;
  references?: string[];
}

export interface HierarchyContent {
  rootUid: string;
  content: string;
  structure: BlockNode[];
  references: Array<{ type: "page" | "block"; uid: string; title?: string }>;
  stats: {
    totalBlocks: number;
    maxDepth: number;
    totalCharacters: number;
    truncated: boolean;
  };
}