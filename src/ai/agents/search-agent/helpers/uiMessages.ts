/**
 * UI message utilities for the search agent
 * Centralizes toaster messages and user feedback
 */

import { updateAgentToaster } from "../../shared/agentsUtils";

export const uiMessages = {
  // Phase: Parsing and Intent
  parsingIntent: () => updateAgentToaster("🎯 Parsing user intent..."),
  executingDatomic: () => updateAgentToaster("🔄 Executing Datomic query..."),
  planningSearch: (strategy: string) => updateAgentToaster(`🔍 ${strategy} search strategy planned`),
  usingFallback: () => updateAgentToaster("⚠️ Using fallback parsing"),
  
  // Phase: Processing
  processingCache: () => updateAgentToaster("💾 Processing cached results..."),
  understandingRequest: () => updateAgentToaster("🤖 Understanding your request..."),
  expandingContext: () => updateAgentToaster("📊 Expanding context for better answers..."),
  
  // Phase: Searching  
  searching: () => updateAgentToaster("🔍 Searching..."),
  searchingWith: (method: string) => updateAgentToaster(`🔍 Searching with ${method}...`),
  
  // Phase: Results
  processingResults: () => updateAgentToaster("📊 Processing search results..."),
  formattingResults: () => updateAgentToaster("✨ Formatting response..."),
  insertingResponse: () => updateAgentToaster("💾 Inserting response..."),
  
  // Specific states
  retry: (reason: string) => updateAgentToaster(`🔄 ${reason}`),
  warning: (message: string) => updateAgentToaster(`⚠️ ${message}`),
  success: (message: string) => updateAgentToaster(`✅ ${message}`),
  
  // Custom message
  custom: (emoji: string, message: string) => updateAgentToaster(`${emoji} ${message}`),
};