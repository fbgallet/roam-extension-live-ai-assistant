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
    bypassDialog = false, // For continuing conversations
  } = params;

  // Determine current mode
  let effectiveMode = requestedMode || getCurrentAskGraphMode();

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
    previousAgentState,
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
        finalAnswer: formatPrivateModeResponse(privateResult.finalAnswer, prompt),
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

// Extract user-requested limit from query (e.g., "2 random results", "first 5 pages", "show me 10 blocks")
function extractUserRequestedLimit(userQuery: string): number | null {
  const query = userQuery.toLowerCase();
  
  // Pattern 1: "N results", "N random results", "N pages", "N blocks"
  const numberResultsMatch = query.match(/(\d+)\s+(random\s+)?(results?|pages?|blocks?)/);
  if (numberResultsMatch) {
    const num = parseInt(numberResultsMatch[1], 10);
    if (num > 0 && num <= 500) { // Reasonable bounds
      return num;
    }
  }
  
  // Pattern 2: "first N", "top N", "show me N"
  const firstNMatch = query.match(/(first|top|show me)\s+(\d+)/);
  if (firstNMatch) {
    const num = parseInt(firstNMatch[2], 10);
    if (num > 0 && num <= 500) {
      return num;
    }
  }
  
  // Pattern 3: "limit to N", "max N", "up to N"
  const limitMatch = query.match(/(limit to|max|up to)\s+(\d+)/);
  if (limitMatch) {
    const num = parseInt(limitMatch[2], 10);
    if (num > 0 && num <= 500) {
      return num;
    }
  }
  
  return null; // No specific limit found
}

// Helper function to format private mode responses with proper page/block formatting
function formatPrivateModeResponse(response: string | any, userQuery?: string): string {
  // Ensure response is a string
  const responseStr = typeof response === 'string' 
    ? response 
    : response?.toString() || '';
    
  if (!responseStr) return responseStr;

  // Extract user-requested limit from query
  const userRequestedLimit = userQuery ? extractUserRequestedLimit(userQuery) : null;
  const displayLimit = userRequestedLimit || 20; // Default to 20 if no specific limit requested

  // Try to detect if this is a page search result by looking for page-specific keywords
  const isPageSearch = /pages?.*found|page.*results|page.*matching/i.test(responseStr);
  
  if (isPageSearch) {
    // For page results, extract page titles instead of UIDs
    const pageTitleRegex = /\[\[([^\]]+)\]\]/g;
    const allPageMatches = responseStr.match(pageTitleRegex) || [];
    
    if (allPageMatches.length > 0) {
      // Deduplicate page titles
      const uniquePages = [...new Set(allPageMatches)];
      console.log(`🔄 [formatPrivateModeResponse] Deduplicated ${allPageMatches.length} page references to ${uniquePages.length} unique pages`);
      
      const displayPages = uniquePages.slice(0, displayLimit);
      const hasMoreResults = uniquePages.length > displayLimit;
      
      const formattedPages = displayPages.join("\n- ");
      let result = `Found ${uniquePages.length} matching pages:\n\n- ${formattedPages}`;
      
      if (hasMoreResults) {
        const limitLabel = userRequestedLimit ? `first ${displayLimit}` : `first ${displayLimit}`;
        result += `\n\n---\n**Note**: Showing ${limitLabel} of ${uniquePages.length} pages. Click the **"View Full Results"** button to see all results.`;
      }
      
      return result;
    }
  }
  
  // For block results, extract UIDs and convert to embed syntax
  const uidRegex = /\b[a-zA-Z0-9_-]{9}\b/g;
  const allUids = responseStr.match(uidRegex) || [];

  if (allUids.length === 0) return responseStr;

  // Deduplicate UIDs
  const uniqueUids = [...new Set(allUids)];
  console.log(`🔄 [formatPrivateModeResponse] Deduplicated ${allUids.length} UIDs to ${uniqueUids.length} unique blocks`);

  // Apply user-requested limit or default display limit
  const displayUids = uniqueUids.slice(0, displayLimit);
  const hasMoreResults = uniqueUids.length > displayLimit;

  // Create embed syntax for each UID
  const embeds = displayUids
    .map((uid: string) => `{{[[embed-path]]: ((${uid}))}}`)
    .join("\n\n");

  let result = `Found ${uniqueUids.length} matching blocks:\n\n${embeds}`;
  
  // Add info about full results button if there are more results
  if (hasMoreResults) {
    const limitLabel = userRequestedLimit ? `first ${displayLimit}` : `first ${displayLimit}`;
    result += `\n\n---\n**Note**: Showing ${limitLabel} of ${uniqueUids.length} results. Click the **"View Full Results"** button in the notification to see all results with selection options.`;
  }

  return result;
}
