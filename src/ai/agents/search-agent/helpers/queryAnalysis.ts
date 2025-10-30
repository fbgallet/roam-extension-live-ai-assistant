/**
 * Query analysis utilities for the search agent
 * Handles query complexity detection and strategic analysis
 */

export const determineComplexity = (
  formalQuery: string
): "simple" | "logical" | "multi-step" => {
  if (
    formalQuery.includes("PIPE(") ||
    formalQuery.includes("UNION(") ||
    formalQuery.includes("INTERSECTION(") ||
    formalQuery.includes("DIFFERENCE(")
  )
    return "multi-step";
  if (
    formalQuery.includes("+") ||
    formalQuery.includes("|") ||
    formalQuery.includes("-")
  )
    return "logical";
  return "simple";
};

export const determineApproach = (
  formalQuery: string,
  analysisType?: string
): string => {
  if (analysisType === "connections") return "pattern_analysis";
  if (analysisType === "summary") return "comprehensive_search";
  if (formalQuery.includes("page:")) return "page_focused";
  return "block_focused";
};

export const generateExecutionSteps = (
  formalQuery: string,
  approach: string
): string[] => {
  const steps = [`Execute symbolic query: '${formalQuery}'`];

  if (approach === "pattern_analysis") {
    steps.push("Analyze connections and patterns");
  } else if (approach === "comprehensive_search") {
    steps.push("Gather comprehensive results for summary");
  }

  if (formalQuery.includes("+")) {
    steps.push("Apply hierarchical search for multi-condition queries");
  }

  return steps;
};
