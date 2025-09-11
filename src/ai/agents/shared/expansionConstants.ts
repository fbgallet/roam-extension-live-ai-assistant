/**
 * Centralized expansion option labels and strategies
 * This eliminates duplication across multiple files
 */

export const EXPANSION_OPTIONS = {
  // Semantic expansion strategies
  fuzzy: {
    emoji: "✳️",
    label: "Fuzzy matching (typos, morphological variations)",
    strategy: "fuzzy",
  },
  synonyms: {
    emoji: "🔄",
    label: "Synonyms and alternative terms",
    strategy: "synonyms",
  },
  relatedConcepts: {
    emoji: "⬅️",
    label: "Related concepts and associated terms",
    strategy: "related_concepts",
  },
  broaderTerms: {
    emoji: "🧩",
    label: "Broader terms and categories",
    strategy: "broader_terms",
  },

  // Combined strategies
  allAtOnce: {
    emoji: "⚡",
    label: "All at once (fuzzy + synonyms + related concepts)",
    strategy: "all",
  },
  auto: {
    emoji: "🤖",
    label: "Auto (semantic expansion until results)",
    strategy: "automatic",
  },

  // Depth expansion
  hierarchical: {
    emoji: "🕸️",
    label: "Convert to hierarchical search (depth 0 → 1)",
    strategy: "hierarchical",
  },

  // Other strategies
  otherStrategies: {
    emoji: "🧠",
    label: "Try other search strategies (combine different approaches)",
    strategy: "other",
  },
} as const;

/**
 * Get formatted option text with emoji
 */
export const getOptionText = (
  option: keyof typeof EXPANSION_OPTIONS
): string => {
  const opt = EXPANSION_OPTIONS[option];
  return `${opt.emoji} ${opt.label}`;
};

/**
 * Get option text with bullet point for toaster display
 */
export const getBulletOptionText = (
  option: keyof typeof EXPANSION_OPTIONS
): string => {
  return `• ${getOptionText(option)}`;
};

/**
 * Create depth expansion option text
 */
export const getDepthExpansionText = (
  currentDepth: number,
  nextDepth: number
): string => {
  return `🕸️ Deepen search (level ${currentDepth} → ${nextDepth})`;
};

/**
 * Create depth expansion option with structured data
 */
export const getDepthExpansionOption = (
  currentDepth: number,
  nextDepth: number
): string => {
  return `${getDepthExpansionText(currentDepth, nextDepth)}|DEPTH:${nextDepth}`;
};

/**
 * Map label text to strategy name
 */
export const mapLabelToStrategy = (label: string, action: string): string => {
  // Clean the label (remove bullets and emojis)
  const cleanLabel = label.replace(/^[•\s]*/, "").trim();

  // Direct strategy mapping
  for (const [key, option] of Object.entries(EXPANSION_OPTIONS)) {
    const optionText = `${option.emoji} ${option.label}`;
    const optionTextNoEmoji = option.label;

    if (cleanLabel === optionText || cleanLabel === optionTextNoEmoji) {
      return option.strategy;
    }
  }

  // Fallback to action or label
  return action || cleanLabel.toLowerCase().replace(/\s+/g, "_");
};

/**
 * Default expansion options for post-completion
 */
export const getDefaultExpansionOptions = (): string => {
  return [
    getBulletOptionText("auto"),
    getBulletOptionText("fuzzy"),
    getBulletOptionText("synonyms"),
    getBulletOptionText("relatedConcepts"),
    getBulletOptionText("allAtOnce"),
    getBulletOptionText("otherStrategies"),
  ].join("\n");
};
