/**
 * fileExport.js
 *
 * Module for AI-assisted document file generation (PDF, DOCX, PPTX).
 * Currently supported only via Anthropic Claude (Skills + Files API).
 * Future providers may be added here.
 */

import { AppToaster } from "../components/Toaster";
import { completionCommands } from "./prompts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Central config for each supported file-export command.
 * Add new formats here; the rest of the code adapts automatically.
 */
const FILE_EXPORT_CONFIG = {
  "Export to PDF": {
    fileType: "pdf",
    mimeType: "application/pdf",
    skillId: "pdf",
    roamComponent: true, // Roam has a {{[[pdf]]: url}} renderer
  },
  "Export to PDF outline": {
    fileType: "pdf",
    mimeType: "application/pdf",
    skillId: "pdf",
    roamComponent: true,
  },
  "Export to DOCX": {
    fileType: "docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    skillId: "docx",
    roamComponent: false,
  },
  "Export to DOCX outline": {
    fileType: "docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    skillId: "docx",
    roamComponent: false,
  },
  "Export to PPTX": {
    fileType: "pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    skillId: "pptx",
    roamComponent: false,
  },
  "Export to PPTX full": {
    fileType: "pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    skillId: "pptx",
    roamComponent: false,
  },
};

// ---------------------------------------------------------------------------
// Helper utilities (exported for use in aiAPIsHub.js and elsewhere)
// ---------------------------------------------------------------------------

/**
 * Returns true if `command` is a recognised file-export command.
 * @param {string} command
 * @returns {boolean}
 */
export function isFileExportCommand(command) {
  return Object.prototype.hasOwnProperty.call(FILE_EXPORT_CONFIG, command);
}

/**
 * Returns the config object for a given file-export command.
 * @param {string} command
 * @returns {{ fileType: string, mimeType: string, skillId: string, roamComponent: boolean }}
 */
export function getFileExportConfig(command) {
  return FILE_EXPORT_CONFIG[command];
}

/**
 * Returns the system prompt string for a given file-export command,
 * sourced from completionCommands in prompts.js.
 * @param {string} command
 * @returns {string}
 */
export function getFileExportPrompt(command) {
  const promptMap = {
    "Export to PDF": completionCommands.pdfCleanDocument,
    "Export to PDF outline": completionCommands.pdfOutline,
    "Export to DOCX": completionCommands.docxDocument,
    "Export to DOCX outline": completionCommands.docxOutline,
    "Export to PPTX": completionCommands.pptxPresentation,
    "Export to PPTX full": completionCommands.pptxFull,
  };
  return promptMap[command] || "";
}

// ---------------------------------------------------------------------------
// Main export handler
// ---------------------------------------------------------------------------

/**
 * Handles the full lifecycle of an AI-driven file export:
 *   1. Shows a progress toast.
 *   2. Loops through Anthropic "pause_turn" continuations.
 *   3. Extracts the generated file from the response.
 *   4. Downloads the file (via server proxy or Haiku base64 fallback).
 *   5. Uploads the file to Roam's Firebase storage.
 *   6. Returns a Roam-ready response string and token usage.
 *
 * @param {object} params
 * @param {object} params.data           - Initial Anthropic API response object.
 * @param {object} params.options        - Original request options (messages, model, etc.).
 * @param {string} params.command        - The export command string (e.g. "Export to PDF").
 * @param {object} params.headers        - Anthropic request headers (including auth).
 * @param {string} params.ANTHROPIC_API_KEY - Raw API key (for proxy requests).
 * @returns {Promise<{ respStr: string, usage: object }>}
 */
export async function handleFileExport({
  data,
  options,
  command,
  headers,
  ANTHROPIC_API_KEY,
}) {
  const exportConfig = getFileExportConfig(command);
  let respStr = "";
  const usage = {};

  AppToaster.show({
    message: `Generating ${exportConfig.fileType.toUpperCase()}... This may take 30 seconds or more.`,
    timeout: 60000,
    intent: "primary",
    icon: "document",
  });

  // -------------------------------------------------------------------------
  // Step 1 – Handle pause_turn: loop until stop_reason !== "pause_turn"
  // -------------------------------------------------------------------------
  let currentData = data;
  let currentMessages = [...options.messages];
  let containerId = currentData.container?.id;

  while (currentData.stop_reason === "pause_turn") {
    currentMessages.push({
      role: "assistant",
      content: currentData.content,
    });
    const continueResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...options,
          messages: currentMessages,
          container: {
            id: containerId,
            skills: [
              {
                type: "anthropic",
                skill_id: exportConfig.skillId,
                version: "latest",
              },
            ],
          },
        }),
      },
    );
    currentData = await continueResponse.json();
    if (currentData.container?.id) containerId = currentData.container.id;
  }

  // -------------------------------------------------------------------------
  // Step 2 – Extract file info and text content from the final response
  // -------------------------------------------------------------------------
  let fileGenerated = false;
  let fileId = "";
  // Default filename — will be overridden by file.filename from Claude's code execution
  const now = new Date();
  const dateSuffix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  let filename = `via-claude-skill-${dateSuffix}.${exportConfig.fileType}`;
  let textContent = "";

  for (const item of currentData.content) {
    if (item.type === "bash_code_execution_tool_result") {
      const result = item.content;
      if (result.type === "bash_code_execution_result" && result.content) {
        for (const file of result.content) {
          if (file.file_id) {
            fileGenerated = true;
            fileId = file.file_id;
            if (file.filename) filename = file.filename;
          }
        }
      }
    } else if (item.type === "text") {
      textContent += item.text;
    }
  }

  if (fileGenerated) {
    AppToaster.show({
      message: `${exportConfig.fileType.toUpperCase()} generated! Retrieving file...`,
      timeout: 30000,
      intent: "primary",
      icon: "document",
    });

    let blob = null;

    // -----------------------------------------------------------------------
    // Strategy 1: Download via server proxy for Files API
    // (fastest – no extra Claude call needed)
    // -----------------------------------------------------------------------
    if (fileId) {
      try {
        console.log(
          `Downloading ${exportConfig.fileType} via server proxy (file_id: ${fileId})...`,
        );
        const proxyResponse = await fetch(
          `https://site--live-ai-file-api--2bhrm4wg9nqn.code.run/anthropic/files/${fileId}/content`,
          {
            method: "GET",
            headers: { "x-api-key": ANTHROPIC_API_KEY },
          },
        );
        if (proxyResponse.ok) {
          blob = await proxyResponse.blob();
          console.log(
            `Server proxy download successful, size: ${blob.size}`,
          );
        } else {
          console.warn(
            `Server proxy failed: ${proxyResponse.status}`,
            await proxyResponse.text(),
          );
        }
      } catch (proxyError) {
        console.warn("Server proxy error:", proxyError);
      }
    }

    // -----------------------------------------------------------------------
    // Strategy 2 (fallback): Ask Haiku to base64-encode the file in the container
    // -----------------------------------------------------------------------
    if (!blob) {
      console.log(
        `Falling back to Haiku base64 retrieval for ${filename}...`,
      );
      const followUpMessages = [...currentMessages];
      followUpMessages.push({
        role: "assistant",
        content: currentData.content,
      });
      followUpMessages.push({
        role: "user",
        content:
          `Read the ${exportConfig.fileType.toUpperCase()} file you just created and output ONLY its base64-encoded content. ` +
          `Use Python:\nimport base64\nwith open('${filename}', 'rb') as f:\n    print(base64.b64encode(f.read()).decode())\n` +
          "Output ONLY the raw base64 string, no explanation, no markdown.",
      });

      const b64Options = {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 16384,
        tools: [{ type: "code_execution_20250825", name: "code_execution" }],
        container: { id: containerId },
        messages: followUpMessages,
      };

      let b64Response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify(b64Options),
      });
      let b64Data = await b64Response.json();

      while (b64Data.stop_reason === "pause_turn") {
        b64Options.messages = [
          ...b64Options.messages,
          { role: "assistant", content: b64Data.content },
        ];
        b64Response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers,
          body: JSON.stringify(b64Options),
        });
        b64Data = await b64Response.json();
      }

      let fallbackBase64 = "";
      for (const item of b64Data.content) {
        if (item.type === "bash_code_execution_tool_result") {
          const result = item.content;
          if (result?.stdout) {
            fallbackBase64 = result.stdout.trim();
          }
        } else if (item.type === "text" && !fallbackBase64) {
          const cleaned = item.text.replace(/[\s\n`]/g, "");
          if (/^[A-Za-z0-9+/]+=*$/.test(cleaned) && cleaned.length > 100) {
            fallbackBase64 = cleaned;
          }
        }
      }

      if (fallbackBase64) {
        const binaryString = atob(fallbackBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        blob = new File([bytes], filename, { type: exportConfig.mimeType });
      }
    }

    // -----------------------------------------------------------------------
    // Step 3 – Upload to Roam Firebase and build the response string
    // -----------------------------------------------------------------------
    AppToaster.clear();
    if (blob) {
      // Convert Blob to File to preserve filename and extension for Firebase storage
      const fileObj =
        blob instanceof File
          ? blob
          : new File([blob], filename, { type: exportConfig.mimeType });
      const firebaseUploadResult = await roamAlphaAPI.file.upload({
        file: fileObj,
      });

      // Extract the raw Firebase URL from the upload result.
      // roamAlphaAPI.file.upload may return {{[[pdf]]: url}}, [](url), or a plain URL.
      const uploadStr = String(firebaseUploadResult);
      const urlMatch =
        uploadStr.match(
          /\{\{\[\[\w+\]\]:\s*(https?:\/\/[^\s}]+)\}\}/i,
        ) || uploadStr.match(/\[.*?\]\((https?:\/\/[^)]+)\)/);
      const fileUrl = urlMatch ? urlMatch[1] : uploadStr;

      if (exportConfig.roamComponent) {
        // Formats with a Roam renderer (PDF): embed the component + copyable code block
        const component = `{{[[${exportConfig.fileType}]]: ${fileUrl}}}`;
        respStr =
          (textContent ? textContent + "\n" : "") +
          `\`${component}\`\n${component}`;
      } else {
        // Formats without a Roam renderer (DOCX, PPTX): plain markdown download link
        respStr =
          (textContent ? textContent + "\n" : "") +
          `[${filename}](${fileUrl})`;
      }
    } else {
      console.warn(
        `${exportConfig.fileType.toUpperCase()} file retrieval failed`,
      );
      respStr =
        textContent ||
        `${exportConfig.fileType.toUpperCase()} was generated but could not be retrieved`;
    }
  } else {
    AppToaster.clear();
    respStr =
      textContent ||
      `${exportConfig.fileType.toUpperCase()} generation failed - no file was created`;
  }

  // -------------------------------------------------------------------------
  // Step 4 – Return token usage from the last API call
  // -------------------------------------------------------------------------
  if (currentData.usage) {
    usage["input_tokens"] = currentData.usage["input_tokens"];
    usage["output_tokens"] = currentData.usage["output_tokens"];
  }

  return { respStr, usage };
}
