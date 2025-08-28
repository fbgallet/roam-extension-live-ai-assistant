import { defaultModel, extensionStorage } from "../../..";
import {
  invokeSearchAgentSecure,
  invokeSearchAgentFull,
} from "./ask-your-graph-invoke";

// Session state management for Ask your graph
let currentSessionMode: string;
let sessionModeRemembered: boolean = false;

// Initialize session state from extension settings
export function initializeAskGraphSession() {
  const askGraphMode = extensionStorage.get("askGraphMode") || "Balanced";
  currentSessionMode = askGraphMode;
  sessionModeRemembered = false;
}

// Session management functions
export function getCurrentAskGraphMode(): string {
  return (
    currentSessionMode || extensionStorage.get("askGraphMode") || "Balanced"
  );
}

export function setSessionAskGraphMode(
  mode: string,
  rememberForSession: boolean = false
) {
  currentSessionMode = mode;
  if (rememberForSession) {
    sessionModeRemembered = true;
  }
}

export function resetSessionAskGraphMode() {
  const askGraphMode = extensionStorage.get("askGraphMode") || "Balanced";
  currentSessionMode = askGraphMode;
  sessionModeRemembered = false;
}

// Smart mode detection
export function needsModeEscalation(
  userQuery: string,
  currentMode: string
): string | false {
  if (currentMode === "Full Access") return false;

  // Keywords that suggest content processing is needed
  const contentProcessingKeywords = [
    "summarize",
    "summary",
    "what do",
    "what does",
    "explain",
    "analyze",
    "compare",
    "contrast",
    "tell me about",
    "describe",
    "elaborate",
    "discuss",
    "review",
    "comment on",
    "thoughts on",
    "opinion",
  ];

  // Keywords that suggest full access is needed
  const fullAccessKeywords = [
    "deep dive",
    "detailed analysis",
    "comprehensive",
    "in-depth",
    "everything about",
    "all information",
    "complete picture",
  ];

  const queryLower = userQuery.toLowerCase();

  if (fullAccessKeywords.some((keyword) => queryLower.includes(keyword))) {
    return "Full Access";
  }

  if (
    currentMode === "Private" &&
    contentProcessingKeywords.some((keyword) => queryLower.includes(keyword))
  ) {
    return "Balanced";
  }

  return false;
}

export interface AskYourGraphParams {
  model?: string;
  rootUid: string;
  targetUid?: string;
  target?: string;
  prompt: string;
  previousAgentState?: any;
  options?: any;
  requestedMode?: "Private" | "Balanced" | "Full Access";
  forcePrivacyMode?: "Private" | "Balanced" | "Full Access"; // For command menu forcing
  forceExpansionMode?: "always_fuzzy" | "always_synonyms" | "always_all"; // For command menu forcing
  bypassDialog?: boolean;
}

// Main Ask your graph function with three-tier privacy system
export async function askYourGraph(params: AskYourGraphParams) {
  const {
    model = defaultModel,
    rootUid,
    targetUid,
    target,
    prompt,
    previousAgentState,
    options,
    requestedMode, // For manual mode override
    forcePrivacyMode, // For command menu forcing
    forceExpansionMode, // For command menu forcing
    bypassDialog = false, // For continuing conversations
  } = params;

  // If forcePrivacyMode is specified, use it as requestedMode
  const effectiveRequestedMode = forcePrivacyMode || requestedMode;

  // Determine current mode
  let effectiveMode = effectiveRequestedMode || getCurrentAskGraphMode();

  // Check if this is the first time using Ask Your Graph
  if (!bypassDialog && !sessionModeRemembered) {
    const suggestedMode = needsModeEscalation(prompt, effectiveMode);
    if (suggestedMode && suggestedMode !== effectiveMode) {
      // Show escalation dialog - this will be handled by the UI component
      const escalationNeeded = new Error("MODE_ESCALATION_NEEDED");
      (escalationNeeded as any).currentMode = effectiveMode;
      (escalationNeeded as any).suggestedMode = suggestedMode;
      (escalationNeeded as any).userQuery = prompt;
      throw escalationNeeded;
    }
  }


  // Execute based on mode
  const searchParams = {
    model,
    rootUid,
    targetUid,
    target,
    prompt,
    previousAgentState: {
      ...previousAgentState,
      // Set flag when privacy mode is forced to skip privacy analysis in IntentParser
      isPrivacyModeForced: Boolean(forcePrivacyMode),
      // Set automatic expansion mode when forced
      ...(forceExpansionMode && { automaticExpansionMode: forceExpansionMode }),
    },
    options,
  };

  switch (effectiveMode) {
    case "Private":
      // Private mode: secure tools only, return UIDs with embed syntax
      const privateResult = await invokeSearchAgentSecure({
        ...searchParams,
        // Force private mode processing
        permissions: { contentAccess: false },
        privateMode: true,
      });

      // Post-process to ensure only UIDs are returned
      return {
        ...privateResult,
        // finalAnswer: formatPrivateModeResponse(privateResult.finalAnswer, prompt),
        finalAnswer: privateResult.finalAnswer, // Use direct result from agent graph
      };

    case "Balanced":
      // Balanced mode: secure tools + final processing (current behavior)
      return await invokeSearchAgentSecure({
        ...searchParams,
        permissions: { contentAccess: false },
      });

    case "Full Access":
      // Full access: all tools available
      return await invokeSearchAgentFull({
        ...searchParams,
        permissions: { contentAccess: true },
      });

    default:
      throw new Error(`Unknown mode: ${effectiveMode}`);
  }
}


