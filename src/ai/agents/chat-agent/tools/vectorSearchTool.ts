/**
 * Vector Search Tool
 *
 * Searches across indexed Roam graph and uploaded files using
 * OpenAI's Vector Store semantic search. Supports multiple databases.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  search as vectorSearch,
  getVectorStoreInfo,
  listDatabases,
} from "../../../vectorStore/vectorStoreService";

export const vectorSearchTool = tool(
  async (
    input: {
      query: string;
      max_results?: number;
      source_filter?: "all" | "roam" | "uploads";
      database_filter?: string;
      reason?: string;
    },
    _config
  ): Promise<string> => {
    const {
      query,
      max_results = 10,
      source_filter = "all",
      database_filter,
      reason,
    } = input;

    // Read user-configured settings from the tools menu
    const userSettings = (typeof window !== "undefined" && (window as any).vectorSearchSettings) || {};
    const effectiveMaxResults = userSettings.maxResults ?? max_results;
    const scoreThreshold = userSettings.threshold ?? 0;

    if (reason) {
      console.log(`   [vectorSearch] Reason: ${reason}`);
    }

    try {
      // Check if vector store is configured
      const info = getVectorStoreInfo();
      if (!info.isConfigured) {
        return `No vector store is configured yet. The user needs to set up vector search first:
- Open the Chat tools menu and create a vector database
- Click "Index Roam Graph" to index their graph into a database
- Or upload files (PDF, DOCX, TXT, etc.) via the "Upload Files" button

Once files are indexed, this tool can search across them semantically.`;
      }

      // Resolve database filter to IDs
      let databaseIds: string[] | undefined;
      if (database_filter) {
        const databases = listDatabases();
        const filterLower = database_filter.toLowerCase();
        const matched = databases.filter(
          (db) =>
            db.name.toLowerCase().includes(filterLower) ||
            db.id === database_filter
        );
        if (matched.length > 0) {
          databaseIds = matched.map((db) => db.id);
        } else {
          const dbNames = databases.map((db) => `"${db.name}"`).join(", ");
          return `No database found matching "${database_filter}". Available databases: ${dbNames}`;
        }
      }

      const startTime = Date.now();

      let results = await vectorSearch(query, {
        maxResults: effectiveMaxResults,
        sourceFilter: source_filter,
        databaseIds,
      });

      // Apply score threshold filter
      if (scoreThreshold > 0) {
        results = results.filter((r) => Math.round(r.score * 100) >= scoreThreshold);
      }

      const executionTime = ((Date.now() - startTime) / 1000).toFixed(1);

      if (results.length === 0) {
        return `Vector search completed in ${executionTime}s but found no results for: "${query}"

The vector store contains ${info.roamPageCount} Roam pages and ${info.uploadedFileCount} uploaded files across ${info.databaseCount} database(s).

Consider:
- Rephrasing the query with different terms
- Checking if the relevant content has been indexed
- Using broader or more specific search terms`;
      }

      // Clean content: strip [uid:...] markers, PAGE markers, and page headers
      const cleanContent = (text: string): string => {
        return text
          .replace(/<!-- PAGE: .+? -->\n?/g, "")
          .replace(/\[uid:[^\]]+\]\s*/g, "")
          .trim();
      };

      // Fallback page title extraction if service didn't provide one
      const fallbackPageTitle = (text: string, fileName: string, blockUids: string[]): string => {
        // Try <!-- PAGE: Title --> marker
        const markerMatch = text.match(/<!-- PAGE: (.+?) -->/);
        if (markerMatch) return markerMatch[1];

        // Try # Title header
        const headerMatch = text.match(/^#\s+(.+)/m);
        if (headerMatch) return headerMatch[1].trim();

        // Fallback: look up via Roam API from first block UID
        if (blockUids.length > 0 && typeof window !== "undefined" && (window as any).roamAlphaAPI) {
          try {
            const result = (window as any).roamAlphaAPI.q(
              `[:find ?title . :where [?b :block/uid "${blockUids[0]}"] [?b :block/page ?p] [?p :node/title ?title]]`
            );
            if (result && typeof result === "string") return result;
          } catch {}
        }

        return fileName.replace(/\.[^.]+$/, "");
      };

      /**
       * Find the first top-level (depth 0) block UID in the chunk content.
       * Top-level blocks start at column 0: "- [uid:xxx]"
       * Indented children start with spaces: "  - [uid:xxx]"
       * We must NOT return the page UID (pages have :node/title, not :block/string).
       */
      const findFirstTopBlockUid = (content: string, allBlockUids: string[]): string | undefined => {
        // Match lines starting with "- [uid:xxx]" (no leading spaces = top-level block)
        const topLevelMatch = content.match(/^- \[uid:([^\]]+)\]/m);
        if (topLevelMatch) return topLevelMatch[1];
        // Fallback to first UID in the list
        return allBlockUids[0];
      };

      // Build structured results for UI display
      const structuredResults = results.map((r, i) => {
        // Prefer page title from service (extracted from <!-- PAGE: --> marker)
        const pageTitle = r.pageTitle || fallbackPageTitle(r.content, r.fileName, r.blockUids);
        const cleaned = cleanContent(r.content);
        const contentWithoutTitle = cleaned
          .replace(/^#\s+.+\n+/, "")
          .trim();

        // Find first top-level block UID (not page UID, not child block)
        const firstTopBlockUid = findFirstTopBlockUid(r.content, r.blockUids);

        return {
          index: i + 1,
          pageTitle,
          score: Math.round(r.score * 100),
          source: r.source as string,
          content: contentWithoutTitle,
          blockUids: r.blockUids,
          firstTopBlockUid,
          fileName: r.fileName,
          databaseName: r.databaseName,
          databaseId: r.databaseId,
        };
      });

      // Build clean LLM output
      let llmOutput = `**Vector Search Results for: "${query}"**\n`;
      llmOutput += `Found ${results.length} relevant passages | ${executionTime}s\n\n`;

      for (const sr of structuredResults) {
        llmOutput += `---\n`;
        llmOutput += `**[${sr.index}] ${sr.pageTitle}** | Relevance: ${sr.score}%`;
        if (sr.databaseName) {
          llmOutput += ` | DB: ${sr.databaseName}`;
        }
        llmOutput += `\n${sr.content}\n\n`;
      }
      llmOutput += `---\nUse these results to answer the user's question. Cite sources by page title when relevant.`;

      // Embed structured data as hidden JSON for UI parsing
      const uiPayload = {
        type: "vector_search_results",
        query,
        executionTime,
        results: structuredResults,
      };
      const output =
        llmOutput +
        `\n<!--VECTOR_SEARCH_UI:${JSON.stringify(uiPayload)}:END_VECTOR_SEARCH_UI-->`;

      return output;
    } catch (error: any) {
      console.error("[vectorSearchTool] Search failed:", error);

      if (error.message?.includes("API key")) {
        return `OpenAI API key is required for vector search. Please configure it in the extension settings.`;
      }

      if (error.message?.includes("quota") || error.message?.includes("429") || error.status === 429) {
        return `**OpenAI quota exceeded.** Your OpenAI API account has run out of credits or exceeded its usage limit. Please check your plan and billing details at https://platform.openai.com/account/billing`;
      }

      return `Vector search failed: ${error.message || "Unknown error"}

Try:
- Checking your OpenAI API key configuration
- Re-indexing the vector store from the tools menu
- Simplifying your search query`;
    }
  },
  {
    name: "vector_search",
    description: `Search across the user's indexed Roam graph and uploaded files using semantic vector search powered by OpenAI.

This tool finds content by MEANING, not just keywords. Use it when:
- The user wants to find content across their entire graph or uploaded documents based on a topic or concept
- Keyword-based search (ask_your_graph) might miss semantically related content
- The user has uploaded external files (PDFs, documents) they want to search

The user can have multiple vector databases (e.g. one for their Roam graph, another for research papers).
Searches all enabled databases by default. Use database_filter to target a specific one.
Returns ranked passages with relevance scores, source attribution, and database name.`,
    schema: z.object({
      query: z
        .string()
        .describe(
          "Natural language search query to find relevant content semantically"
        ),
      max_results: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum number of results to return (1-50)"),
      source_filter: z
        .enum(["all", "roam", "roam-pages", "roam-dnp", "uploads"])
        .optional()
        .default("all")
        .describe(
          "Filter by source: 'roam' for all graph content, 'roam-pages' for pages only, 'roam-dnp' for daily notes only, 'uploads' for files only, 'all' for everything"
        ),
      database_filter: z
        .string()
        .optional()
        .describe(
          "Filter by database name (partial match) or ID. Omit to search all enabled databases."
        ),
      reason: z
        .string()
        .optional()
        .describe("Brief explanation of why this search is needed"),
    }),
  }
);
