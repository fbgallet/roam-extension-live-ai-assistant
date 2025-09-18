import { defaultModel, extensionStorage } from "../../..";
import {
  invokeSearchAgentSecure,
  invokeSearchAgentFull,
} from "./ask-your-graph-invoke";

// Session state management for Ask your graph
let currentSessionMode: string;

// Initialize session state from extension settings
export function initializeAskGraphSession() {
  const askGraphMode = extensionStorage.get("askGraphMode") || "Balanced";
  currentSessionMode = askGraphMode;
}

// Session management functions
export function getCurrentAskGraphMode(): string {
  return (
    currentSessionMode || extensionStorage.get("askGraphMode") || "Balanced"
  );
}

export function setSessionAskGraphMode(mode: string) {
  currentSessionMode = mode;
}

export function resetSessionAskGraphMode() {
  const askGraphMode = extensionStorage.get("askGraphMode") || "Balanced";
  currentSessionMode = askGraphMode;
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
  forcePopupOnly?: boolean; // For command menu forcing popup-only results
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
    forcePopupOnly = false, // For command menu forcing popup-only results
  } = params;

  // If forcePrivacyMode is specified, use it as requestedMode
  const effectiveRequestedMode = forcePrivacyMode || requestedMode;

  // Determine current mode
  let effectiveMode = effectiveRequestedMode || getCurrentAskGraphMode();



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
      // Set flag to force popup-only results
      forcePopupOnly: Boolean(forcePopupOnly),
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


