/**
 * Expansion UI utilities for the search agent  
 * Handles generation of contextual expansion options for the user interface
 */

// Generate simple, consistent expansion options with contextual logic
export const getContextualExpansionOptions = (
  userQuery: string,
  formalQuery?: string,
  appliedSemanticStrategies?: Array<
    "fuzzy" | "synonyms" | "related_concepts" | "broader_terms" | "custom"
  >
): string => {
  // Use formal query for analysis if available, fallback to user query
  const queryToAnalyze = formalQuery || userQuery;

  // Detect if this is primarily a page search
  const isPageSearch =
    queryToAnalyze.includes("page:(") ||
    userQuery.toLowerCase().includes("page") ||
    userQuery.toLowerCase().includes("title");

  // Detect if query has multiple conditions using symbolic operators
  const hasMultipleConditions =
    queryToAnalyze.includes("+") || // AND operator
    queryToAnalyze.includes("|") || // OR operator
    queryToAnalyze.includes("-"); // NOT operator

  const options = [];
  const appliedStrategies = appliedSemanticStrategies || [];

  // Define all semantic strategies with their info
  const semanticStrategies = {
    fuzzy: {
      emoji: "🔍",
      label: "Fuzzy matching (typos, morphological variations)",
    },
    synonyms: { emoji: "📝", label: "Synonyms and alternative terms" },
    related_concepts: {
      emoji: "🧠",
      label: "Related concepts and associated terms",
    },
    broader_terms: {
      emoji: "🔺",
      label: "Broader categories and umbrella terms",
    },
  };

  // First option: "Automatic until results" (normal progression)
  options.push("🤖 Auto (let the agent test progressive strategy)");

  // Second option: "All semantic expansions at once" (only if no semantic expansion has been processed)
  const hasProcessedSemanticExpansion = appliedStrategies.some((strategy) =>
    ["fuzzy", "synonyms", "related_concepts", "broader_terms"].includes(
      strategy
    )
  );

  if (!hasProcessedSemanticExpansion) {
    options.push("⚡ All at once (fuzzy + synonyms + related concepts)");
  }

  // Add individual semantic strategies that haven't been processed yet
  const availableStrategies = Object.keys(semanticStrategies).filter(
    (strategy) => !appliedStrategies.includes(strategy as any)
  );

  // Don't display "broader_terms" if "related_concepts" has not been processed
  if (!appliedStrategies.includes("related_concepts")) {
    const broaderIndex = availableStrategies.indexOf("broader_terms");
    if (broaderIndex > -1) {
      availableStrategies.splice(broaderIndex, 1);
    }
  }

  // Add available semantic strategies
  for (const strategy of availableStrategies) {
    const info =
      semanticStrategies[strategy as keyof typeof semanticStrategies];
    options.push(`${info.emoji} ${info.label}`);
  }

  // Add hierarchy option for block searches with multiple conditions
  if (!isPageSearch && hasMultipleConditions) {
    options.push(
      "🏗️ Deepen hierarchy search (explore parent/child relationships)"
    );
  }

  // Always offer multi-strategy as final fallback
  options.push("🔄 Try other search strategies (combine different approaches)");

  // Format as bullet points
  return options.map((option) => `• ${option}`).join("\n");
};

export const buildRetryGuidance = (
  retryType: string,
  hasCachedResults: boolean
): string => {
  const baseGuidance = hasCachedResults
    ? "Previous search results are available in cache. "
    : "No previous results cached. ";

  switch (retryType) {
    case "semantic":
      return (
        baseGuidance +
        "Apply semantic expansion: use related concepts, synonyms, and findPagesSemantically for page references."
      );

    case "hierarchical":
      return (
        baseGuidance +
        "Apply hierarchical expansion: convert flat searches to hierarchical (A + B → A <=> B), use deep hierarchy (>> instead of >), try bidirectional relationships."
      );

    case "expansion":
      return (
        baseGuidance +
        "Apply progressive expansion: fuzzy matching, semantic variations, scope broadening. Try different tool strategies if no results found."
      );

    case "basic":
    default:
      return (
        baseGuidance +
        "Apply basic retry with fuzzy matching and basic expansions."
      );
  }
};