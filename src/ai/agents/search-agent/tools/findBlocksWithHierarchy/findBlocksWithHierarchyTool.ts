import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Global type declaration for hierarchy counts
declare global {
  var hierarchyCounts: Record<string, number> | undefined;
}
import {
  filterByDateRange,
  createToolResult,
  generateSemanticExpansions,
  parseSemanticExpansion,
  SearchCondition,
  extractUidsFromResults,
  getExpansionStrategyLabel,
} from "../../helpers/searchUtils";
import type {
  SearchCondition as StructuredSearchCondition,
  CompoundCondition,
  HierarchyCondition,
  StructuredHierarchyQuery,
} from "../types/index";
import { findBlocksByContentTool } from "../findBlocksByContentTool";
import { updateAgentToaster } from "../../../shared/agentsUtils";
import {
  schema,
  llmFacingSchema,
  transformLlmInputToInternalSchema,
  type HierarchicalExpression,
  type SearchTerm,
  type CompoundExpression,
  type ParsedExpression,
} from "./schemas";
import {
  parseSimpleCompoundCondition,
  parseSimpleSearchCondition,
  parseHierarchicalExpression,
} from "./parsers";
import {
  expandConditions,
  applyHierarchyFilters,
  enrichWithFullHierarchy,
  sortHierarchyResults,
} from "./processors";
import {
  executeStructuredStrictHierarchySearch,
  executeStructuredBidirectionalSearch,
  executeStructuredFlexibleHierarchySearch,
  executeStructuredDeepFlexibleHierarchySearch,
  executeStructuredDeepBidirectionalSearch,
  executeStructuredDeepStrictHierarchySearch,
  executeStrictHierarchySearch,
  executeBidirectionalSearch,
  executeDeepBidirectionalSearch,
  executeFlexibleHierarchySearch,
  executeInverseStrictHierarchySearch,
  executeContentSearch,
  executeDeepStrictHierarchySearch,
  executeCombineResults,
  searchBlocksWithConditions,
  applyFinalProcessing,
} from "./executors";

/**
 * Find blocks with hierarchical context using content and structure conditions
 * Security Level: Flexible (secure mode = UIDs/metadata only, content mode = includes full hierarchy)
 *
 * Example structured hierarchy condition:
 * {
 *   operator: ">",
 *   leftCondition: {type: "page_ref", text: "Machine Learning"},
 *   rightCondition: {type: "page_ref", text: "AI Fundamentals"}
 * }
 *
 * Supported operators: >, <, >>, <<, =>, <=, =>>, <<=, <=>, <<=>
 * - > : A is direct parent of B
 * - < : A is direct child of B
 * - >> : A is ancestor of B (any depth)
 * - << : A is descendant of B (any depth)
 * - => : A is same block OR parent of B
 * - <= : A is same block OR child of B
 * - <=> : A and B have bidirectional relationship
 *
 * Use secureMode=true to exclude full block content from results (UIDs and metadata only).
 */

export const findBlocksWithHierarchyTool = tool(
  async (input, config) => {
    const startTime = performance.now();

    // Extract state from config first
    const state = config?.configurable?.state;

    // Handle automatic expansion modes (matching other tools)
    let expansionStates = {
      isExpansionGlobal: state?.isExpansionGlobal || false,
      semanticExpansion: state?.semanticExpansion || null,
    };

    if (state?.automaticExpansionMode) {
      const expansionMode = state.automaticExpansionMode;
      console.log(
        `🔧 [FindBlocksWithHierarchy] Checking expansion mode: ${expansionMode}`
      );

      // Set expansion states based on mode (only if not already set by user actions)
      if (!state?.isExpansionGlobal) {
        switch (expansionMode) {
          case "always_fuzzy":
          case "Always with fuzzy":
            expansionStates.isExpansionGlobal = true;
            expansionStates.semanticExpansion = "fuzzy";
            console.log(
              `🔧 [FindBlocksWithHierarchy] Auto-enabling fuzzy expansion due to mode: ${expansionMode}`
            );
            break;
          case "always_synonyms":
          case "Always with synonyms":
            expansionStates.isExpansionGlobal = true;
            expansionStates.semanticExpansion = "synonyms";
            console.log(
              `🔧 [FindBlocksWithHierarchy] Auto-enabling synonyms expansion due to mode: ${expansionMode}`
            );
            break;
          case "always_all":
          case "Always with all":
            expansionStates.isExpansionGlobal = true;
            expansionStates.semanticExpansion = "all";
            console.log(
              `🔧 [FindBlocksWithHierarchy] Auto-enabling all expansions due to mode: ${expansionMode}`
            );
            break;
        }
      }
    }

    // Store automatic expansion mode for later use (moved to end as fallback)
    const shouldUseAutomaticExpansion =
      state?.automaticExpansionMode === "auto_until_result";

    // Transform LLM input to internal schema format with state injection
    const internalInput = transformLlmInputToInternalSchema(input, state);
    const isPrivateMode = state?.privateMode || internalInput.secureMode;

    // Override enrichment parameters in private mode for performance and privacy
    const finalInput = isPrivateMode
      ? {
          ...internalInput,
          includeChildren: false,
          includeParents: false,
          childDepth: 1,
          parentDepth: 1,
          secureMode: true,
        }
      : internalInput;

    try {
      // First attempt: Execute without expansion for auto_until_result mode
      // For other modes (always_*), expansion is already enabled in expansionStates
      const initialState = shouldUseAutomaticExpansion 
        ? {
            ...state,
            // Disable expansion for initial attempt in auto_until_result mode
            isExpansionGlobal: false,
            semanticExpansion: null,
            automaticExpansionMode: null, // Prevent sub-tools from triggering their own expansion
          }
        : {
            ...state,
            ...expansionStates,
            // Keep original automaticExpansionMode for hierarchy tool itself
            // Sub-tools will get disabled mode via their individual calls
          };

      const results = await findBlocksWithHierarchyImpl(finalInput, initialState);

      // Check if we got results
      const hasResults = Array.isArray(results) && results.length > 0;

      // If we have results from initial attempt, return them
      if (hasResults) {
        return createToolResult(
          true,
          results,
          undefined,
          "findBlocksWithHierarchy",
          startTime
        );
      }

      // No results - try expansion if auto_until_result or if always_* modes are enabled
      const shouldExpandAfterNoResults = 
        shouldUseAutomaticExpansion || expansionStates.isExpansionGlobal;

      if (shouldExpandAfterNoResults) {
        console.log(`🔄 [FindBlocksWithHierarchy] No initial results, trying with semantic expansion...`);

        if (shouldUseAutomaticExpansion) {
          // Import the helper function
          const { automaticSemanticExpansion } = await import(
            "../../helpers/searchUtils"
          );

          // Use automatic expansion starting from fuzzy
          const expansionResult = await automaticSemanticExpansion(
            finalInput,
            (params: any, state?: any) =>
              findBlocksWithHierarchyImpl(params, state),
            {
              ...state,
              ...expansionStates,
            }
          );

          return createToolResult(
            true,
            expansionResult.results,
            undefined,
            "findBlocksWithHierarchy",
            startTime,
            {
              automaticExpansion: {
                used: expansionResult.expansionUsed,
                attempts: expansionResult.expansionAttempts,
                finalAttempt: expansionResult.finalAttempt,
              },
            }
          );
        } else {
          // For always_* modes, try with expansion enabled
          const expandedResults = await findBlocksWithHierarchyImpl(finalInput, {
            ...state,
            ...expansionStates,
            // Keep original automaticExpansionMode - sub-tools get disabled mode via their calls
          });

          return createToolResult(
            true,
            expandedResults,
            undefined,
            "findBlocksWithHierarchy",
            startTime
          );
        }
      }

      // No expansion needed or available, return original results
      return createToolResult(
        true,
        results,
        undefined,
        "findBlocksWithHierarchy",
        startTime
      );
    } catch (error) {
      console.error("FindBlocksWithHierarchy tool error:", error);
      return createToolResult(
        false,
        undefined,
        error.message,
        "findBlocksWithHierarchy",
        startTime
      );
    }
  },
  {
    name: "findBlocksWithHierarchy",
    description:
      "Find blocks using hierarchical parent-child relationships. Use 'hierarchyCondition' with operator (>, >>, <=>, etc.) and left/right conditions. SIMPLE: Use leftConditions/rightConditions arrays for basic logic. GROUPED: Use leftConditionGroups/rightConditionGroups for complex logic like ((A|B) AND NOT C). Supports all hierarchy operators and semantic expansion.",
    schema: llmFacingSchema, // Use minimal schema for token optimization
  }
);

const findBlocksWithHierarchyImpl = async (
  input: z.infer<typeof schema>,
  state?: any
) => {
  const {
    contentConditions,
    hierarchyConditions,
    combineConditions,
    combineHierarchy,
    includeChildren,
    childDepth,
    includeParents,
    parentDepth,
    includeDaily,
    dateRange,
    sortBy,
    limit,
    secureMode,
    fromResultId,
    limitToBlockUids,
    limitToPageUids,
    hierarchicalExpression,
    hierarchyCondition,
    maxHierarchyDepth,
    strategyCombination,
  } = input;

  // Determine if we should use combination testing based on IntentParser analysis
  const shouldUseCombinationTesting = (() => {
    // Only test combinations when IntentParser indicates this was a forced hierarchical conversion
    const forceHierarchical = state?.forceHierarchical;

    if (!forceHierarchical) {
      return false;
    }

    if (!hierarchyCondition) {
      return false;
    }

    // Count positive AND conditions only (exclude NOT conditions)
    let positiveAndConditions = 0;

    // Count left positive conditions
    if (
      hierarchyCondition.leftConditions &&
      Array.isArray(hierarchyCondition.leftConditions)
    ) {
      positiveAndConditions += hierarchyCondition.leftConditions.filter(
        (c) => !c.negate
      ).length;
    }

    // Count right positive conditions
    if (
      hierarchyCondition.rightConditions &&
      Array.isArray(hierarchyCondition.rightConditions)
    ) {
      positiveAndConditions += hierarchyCondition.rightConditions.filter(
        (c) => !c.negate
      ).length;
    }

    // Test combinations only for ≥3 positive AND conditions with bidirectional operators
    const shouldTest =
      positiveAndConditions >= 3 &&
      (hierarchyCondition.operator === "<=>" ||
        hierarchyCondition.operator === "<<=>>");

    return shouldTest;
  })();

  // Validation: Prevent using both legacy and modern APIs simultaneously
  if (hierarchicalExpression && hierarchyCondition) {
    throw new Error(
      "Cannot use both 'hierarchicalExpression' (legacy) and 'hierarchyCondition' (modern) simultaneously. Please use only 'hierarchyCondition' for better reliability."
    );
  }

  // Handle modern structured hierarchy condition (PREFERRED API - OpenAI compatible)
  if (hierarchyCondition) {
    // Check if this is a grouped condition OR needs combination testing
    if (
      hierarchyCondition.leftConditionGroups ||
      hierarchyCondition.rightConditionGroups ||
      shouldUseCombinationTesting
    ) {
      const structuredQuery = {
        hierarchyCondition: hierarchyCondition,
        searchConditions: [],
        combineConditions: "AND" as const,
      };

      return await processStructuredHierarchyCondition(
        structuredQuery.hierarchyCondition,
        {
          maxHierarchyDepth,
          strategyCombination,
          includeChildren,
          childDepth,
          includeParents,
          parentDepth,
          includeDaily,
          dateRange,
          sortBy,
          limit,
          secureMode,
          fromResultId,
          limitToBlockUids,
          limitToPageUids,
          excludeBlockUid: input.excludeBlockUid,
          testAllCombinations: shouldUseCombinationTesting,
        },
        state
      );
    }

    // Handle simple array-based conditions (backward compatibility)
    return await processSimpleHierarchyCondition(
      hierarchyCondition,
      {
        maxHierarchyDepth,
        strategyCombination,
        includeChildren,
        childDepth,
        includeParents,
        parentDepth,
        includeDaily,
        dateRange,
        sortBy,
        limit,
        secureMode,
        fromResultId,
        limitToBlockUids,
        limitToPageUids,
        excludeBlockUid: input.excludeBlockUid,
      },
      state
    );
  }

  // Handle hierarchical expressions if provided
  if (hierarchicalExpression) {
    // Convert to structured format for semantic expansion support
    const structuredCondition = convertHierarchicalExpressionToStructured(
      hierarchicalExpression
    );

    if (structuredCondition) {
      return await processStructuredHierarchyQuery(
        {
          hierarchyCondition: structuredCondition,
          searchConditions: [],
          combineConditions: "AND",
        },
        {
          maxHierarchyDepth,
          strategyCombination,
          includeChildren,
          childDepth,
          includeParents,
          parentDepth,
          includeDaily,
          dateRange,
          sortBy,
          limit,
          secureMode,
          fromResultId,
          limitToBlockUids,
          limitToPageUids,
          excludeBlockUid: input.excludeBlockUid,
        },
        state
      );
    } else {
      // Fallback to original processing if conversion fails
      console.log(
        "⚠️ Failed to convert to structured format, using legacy processing"
      );
      return await processHierarchicalExpression(
        hierarchicalExpression,
        {
          maxHierarchyDepth,
          strategyCombination,
          includeChildren,
          childDepth,
          includeParents,
          parentDepth,
          includeDaily,
          dateRange,
          sortBy,
          limit,
          secureMode,
          fromResultId,
          limitToBlockUids,
          limitToPageUids,
          excludeBlockUid: input.excludeBlockUid,
        },
        state
      );
    }
  }

  // UID-based filtering for optimization
  const { blockUids: finalBlockUids, pageUids: finalPageUids } =
    extractUidsFromResults(
      fromResultId,
      limitToBlockUids,
      limitToPageUids,
      state
    );

  // Step 1: Process content conditions with semantic expansion (CENTRALIZED)
  // Expand once here and prevent sub-tools from expanding by setting disabled state
  const expandedContentConditions = await expandConditions(
    contentConditions,
    {
      ...state,
      // Mark that expansion has been handled at hierarchy level
      hierarchyExpansionDone: true,
    }
  );

  // Step 2: Find blocks matching content conditions
  const contentMatches = await searchBlocksWithConditions(
    expandedContentConditions,
    combineConditions,
    includeDaily,
    finalBlockUids.length > 0 ? finalBlockUids : undefined,
    finalPageUids.length > 0 ? finalPageUids : undefined
  );

  // Step 3: Apply hierarchy conditions if specified
  let hierarchyFilteredBlocks = contentMatches;
  if (hierarchyConditions?.length > 0) {
    hierarchyFilteredBlocks = await applyHierarchyFilters(
      contentMatches,
      hierarchyConditions,
      combineHierarchy
    );
  }

  // Step 4: Enrich with full hierarchical context (only if explicitly requested)
  let enrichedResults = hierarchyFilteredBlocks;
  if (includeChildren === true || includeParents === true) {
    enrichedResults = await enrichWithFullHierarchy(
      hierarchyFilteredBlocks,
      includeChildren,
      childDepth,
      includeParents,
      parentDepth,
      secureMode
    );
  }

  // Step 5: Apply date range filtering
  let filteredResults = enrichedResults;
  if (dateRange && (dateRange.start || dateRange.end)) {
    const parsedDateRange = {
      start:
        typeof dateRange.start === "string"
          ? new Date(dateRange.start)
          : dateRange.start,
      end:
        typeof dateRange.end === "string"
          ? new Date(dateRange.end)
          : dateRange.end,
    };
    const filterMode = dateRange.filterMode || "modified";
    filteredResults = filterByDateRange(
      enrichedResults,
      parsedDateRange,
      filterMode
    );
  }

  // Step 5.5: Exclude user query block from results by UID
  if (input.excludeBlockUid) {
    const originalCount = filteredResults.length;
    filteredResults = filteredResults.filter(
      (result) => result.uid !== input.excludeBlockUid
    );
    const excludedCount = originalCount - filteredResults.length;
  }

  // Step 6: Sort results
  filteredResults = sortHierarchyResults(
    filteredResults,
    sortBy,
    contentConditions
  );

  // Step 7: Limit results
  if (filteredResults.length > limit) {
    filteredResults = filteredResults.slice(0, limit);
  }

  return filteredResults;
};

/**
 * Convert hierarchicalExpression string to structured HierarchyCondition
 * This provides backward compatibility while enabling the new structured approach
 */
const convertHierarchicalExpressionToStructured = (
  expression: string
): HierarchyCondition | null => {
  try {
    const parsed = parseHierarchicalExpression(expression);

    if (!parsed || parsed.type === "term" || parsed.type === "compound") {
      return null;
    }

    const hierarchicalParsed = parsed as HierarchicalExpression;

    // Convert old operator format to new operator format
    const operatorMap: Record<string, HierarchyCondition["operator"]> = {
      ">": ">",
      "<": "<",
      ">>": ">>",
      "<<": "<<",
      "=>": "=>",
      "<=": "<=",
      "=>>": "=>>",
      "<<=": "<<=",
      "<=>": "<=>",
      "<<=>>": "<<=>>",
    };

    const newOperator = operatorMap[hierarchicalParsed.operator];
    if (!newOperator) {
      console.warn(`Unknown operator: ${hierarchicalParsed.operator}`);
      return null;
    }

    return {
      operator: newOperator,
      leftCondition: convertParsedExpressionToSearchCondition(
        hierarchicalParsed.leftOperand
      ),
      rightCondition: convertParsedExpressionToSearchCondition(
        hierarchicalParsed.rightOperand
      ),
      maxDepth: hierarchicalParsed.maxDepth,
    };
  } catch (error) {
    console.error("Failed to convert hierarchical expression:", error);
    return null;
  }
};

/**
 * Convert ParsedExpression (old format) to SearchCondition or CompoundCondition (new format)
 */
const convertParsedExpressionToSearchCondition = (
  expression: SearchTerm | CompoundExpression
): StructuredSearchCondition | CompoundCondition => {
  if (expression.type === "term") {
    return {
      type:
        expression.searchType === "page_ref"
          ? "page_ref"
          : expression.searchType === "regex"
          ? "regex"
          : "text",
      text: expression.text,
      matchType: expression.searchType === "regex" ? "regex" : "contains",
      weight: 1.0,
      negate: false,
    };
  } else if (expression.type === "compound") {
    return {
      operator: expression.operator,
      conditions: expression.operands.map(
        convertParsedExpressionToSearchCondition
      ),
    };
  }

  throw new Error(`Unsupported expression type: ${(expression as any).type}`);
};

/**
 * Process simple hierarchy condition with array-based structure
 * Converts arrays to internal compound structures while maintaining full semantic expansion
 */
const processSimpleHierarchyCondition = async (
  hierarchyCondition: any,
  options: any,
  state?: any
): Promise<any> => {
  // Step 1: Convert array-based conditions to internal compound structures
  const internalHierarchyCondition = await convertArraysToInternalFormat(
    hierarchyCondition,
    state
  );

  // Step 2: Apply semantic expansion to the converted condition
  const expandedHierarchyCondition = await expandHierarchyConditionSemantics(
    internalHierarchyCondition,
    state
  );

  const structuredQuery = {
    hierarchyCondition: expandedHierarchyCondition,
    searchConditions: [],
    combineConditions: "AND" as const,
  };

  return await processStructuredHierarchyQuery(structuredQuery, options, state);
};

/**
 * Convert OpenAI array-based format to internal compound condition format
 */
const convertArraysToInternalFormat = async (
  hierarchyCondition: any,
  state?: any
): Promise<any> => {
  const convertConditionArray = (conditions: any[], combination: string) => {
    if (!conditions || conditions.length === 0) {
      console.warn(
        "⚠️ Empty or undefined conditions array passed to convertConditionArray"
      );
      return null;
    }
    if (conditions.length === 1) {
      // Single condition - return directly
      return conditions[0];
    } else {
      // Multiple conditions - create compound
      return {
        operator: combination,
        conditions: conditions,
      };
    }
  };

  const leftCondition = convertConditionArray(
    hierarchyCondition.leftConditions,
    hierarchyCondition.leftCombination || "AND"
  );

  const rightCondition = convertConditionArray(
    hierarchyCondition.rightConditions,
    hierarchyCondition.rightCombination || "AND"
  );

  // Handle case where conditions are invalid
  if (!leftCondition && !rightCondition) {
    throw new Error("Both left and right conditions are invalid or empty");
  }

  return {
    operator: hierarchyCondition.operator,
    leftCondition: leftCondition,
    rightCondition: rightCondition,
    maxDepth: hierarchyCondition.maxDepth,
  };
};

/**
 * Process enhanced hierarchy condition with two-step approach
 * Simple path: Handle simple conditions and single-operator compounds directly
 * Complex path: Use LLM decomposition for nested conditions (future enhancement)
 */
const processEnhancedHierarchyCondition = async (
  hierarchyCondition: any, // Will be typed properly
  options: any,
  state?: any
): Promise<any> => {
  // Step 1: Convert any string expressions to structured conditions
  const normalizedHierarchyCondition = await normalizeHierarchyCondition(
    hierarchyCondition,
    state
  );

  // Step 2: Apply semantic expansion to the normalized condition
  const expandedHierarchyCondition = await expandHierarchyConditionSemantics(
    normalizedHierarchyCondition,
    state
  );

  const structuredQuery = {
    hierarchyCondition: expandedHierarchyCondition,
    searchConditions: [],
    combineConditions: "AND" as const,
  };

  return await processStructuredHierarchyQuery(structuredQuery, options, state);
};

/**
 * Normalize hierarchy condition: handle both structured objects and string expressions
 * This bridges the gap between LLM-generated structured conditions and string expressions
 */
const normalizeHierarchyCondition = async (
  hierarchyCondition: any,
  state?: any
): Promise<any> => {
  // If already fully structured, return as-is
  if (isFullyStructured(hierarchyCondition)) {
    return hierarchyCondition;
  }

  // Handle mixed cases where leftCondition or rightCondition might be strings
  const normalizedLeft = await normalizeCondition(
    hierarchyCondition.leftCondition,
    state
  );
  const normalizedRight = await normalizeCondition(
    hierarchyCondition.rightCondition,
    state
  );

  return {
    ...hierarchyCondition,
    leftCondition: normalizedLeft,
    rightCondition: normalizedRight,
  };
};

/**
 * Normalize a single condition (left or right side of hierarchy)
 */
const normalizeCondition = async (
  condition: any,
  state?: any
): Promise<any> => {
  // If it's already a structured object, return as-is
  if (typeof condition === "object" && condition.type) {
    return condition;
  }

  // If it's already a structured compound, return as-is
  if (
    typeof condition === "object" &&
    condition.operator &&
    condition.conditions
  ) {
    return condition;
  }

  // If it's a string, try to parse it with simple path first
  if (typeof condition === "string") {
    // Try simple compound parsing first (covers 95% of cases)
    const simpleCompound = parseSimpleCompoundCondition(condition);
    if (simpleCompound) {
      return simpleCompound;
    }

    // Try simple search condition
    const simpleCondition = parseSimpleSearchCondition(condition);
    if (simpleCondition) {
      return simpleCondition;
    }

    // Complex case - fall back to LLM decomposition (future enhancement)
    return await fallbackComplexConditionParsing(condition, state);
  }

  // Unknown format - return as-is and let downstream handle it
  console.warn("⚠️ Unknown condition format:", condition);
  return condition;
};

/**
 * Check if hierarchy condition is fully structured (no string expressions)
 */
const isFullyStructured = (hierarchyCondition: any): boolean => {
  const leftIsStructured = isConditionStructured(
    hierarchyCondition.leftCondition
  );
  const rightIsStructured = isConditionStructured(
    hierarchyCondition.rightCondition
  );

  return leftIsStructured && rightIsStructured;
};

/**
 * Check if a single condition is structured (not a string)
 */
const isConditionStructured = (condition: any): boolean => {
  if (typeof condition === "string") {
    return false;
  }

  if (typeof condition === "object") {
    // Simple structured condition
    if (condition.type && condition.text) {
      return true;
    }

    // Compound structured condition
    if (condition.operator && Array.isArray(condition.conditions)) {
      return condition.conditions.every((c: any) => isConditionStructured(c));
    }
  }

  return false;
};

/**
 * Fallback for complex conditions that can't be parsed with simple path
 * For now, convert to simple text condition - can be enhanced with LLM decomposition later
 */
const fallbackComplexConditionParsing = async (
  condition: string,
  state?: any
): Promise<any> => {
  // For now, treat as simple text condition
  // This can be enhanced later with LLM decomposition for truly complex cases
  return {
    type: "text",
    text: condition,
    matchType: "contains",
  };
};

/**
 * Apply semantic expansion to hierarchy condition (both left and right conditions)
 */
const expandHierarchyConditionSemantics = async (
  hierarchyCondition: any,
  state?: any
): Promise<any> => {
  const expandedLeftCondition = await expandConditionSemantics(
    hierarchyCondition.leftCondition,
    state
  );
  const expandedRightCondition = await expandConditionSemantics(
    hierarchyCondition.rightCondition,
    state
  );

  return {
    ...hierarchyCondition,
    leftCondition: expandedLeftCondition,
    rightCondition: expandedRightCondition,
  };
};

/**
 * Apply semantic expansion to a single condition (simple or compound)
 */
const expandConditionSemantics = async (
  condition: any,
  state?: any
): Promise<any> => {
  if (condition.operator) {
    // Compound condition - expand each sub-condition
    const expandedConditions = await Promise.all(
      condition.conditions.map((c: any) => expandConditionSemantics(c, state))
    );

    return {
      ...condition,
      conditions: expandedConditions.flat(), // Flatten in case expansion creates multiple conditions
    };
  } else {
    // Simple condition - apply semantic expansion
    const expandedConditions = await expandSingleCondition(condition, state);

    // If only one condition returned, return it directly
    // If multiple returned (semantic expansion), wrap in OR compound
    if (expandedConditions.length === 1) {
      return expandedConditions[0];
    } else {
      return {
        operator: "OR",
        conditions: expandedConditions,
      };
    }
  }
};

/**
 * Apply semantic expansion to structured search conditions
 */
const expandStructuredConditions = async (
  conditions: (StructuredSearchCondition | CompoundCondition)[],
  state?: any
): Promise<(StructuredSearchCondition | CompoundCondition)[]> => {
  // Handle undefined or empty conditions array
  if (!conditions || !Array.isArray(conditions)) {
    console.warn(
      "⚠️ expandStructuredConditions called with invalid conditions:",
      conditions
    );
    return [];
  }

  const expandedConditions: (StructuredSearchCondition | CompoundCondition)[] =
    [];

  for (const condition of conditions) {
    // Skip undefined or null conditions
    if (!condition) {
      console.warn(
        "⚠️ Skipping undefined condition in expandStructuredConditions"
      );
      continue;
    }

    if ("operator" in condition) {
      // CompoundCondition - recursively expand nested conditions
      expandedConditions.push({
        operator: condition.operator,
        conditions: await expandStructuredConditions(
          condition.conditions,
          state
        ),
      });
    } else {
      // SearchCondition - apply semantic expansion
      const expandedCondition = await expandSingleCondition(condition, state);
      expandedConditions.push(...expandedCondition);
    }
  }

  return expandedConditions;
};


/**
 * Apply semantic expansion to a single SearchCondition
 */
export const expandSingleCondition = async (
  condition: StructuredSearchCondition,
  state?: any
): Promise<StructuredSearchCondition[]> => {
  // Initialize expansion cache if not exists
  if (!state?.expansionCache) {
    state = { ...state, expansionCache: new Map() };
  }

  // Note: No need to check _expandedTerm flag since we now generate single regex conditions

  // Check if semantic expansion is needed - either globally or per-condition
  const hasGlobalExpansion = state?.isExpansionGlobal === true;

  // Parse semantic expansion from condition text using parseSemanticExpansion
  const { cleanText, expansionType } = parseSemanticExpansion(
    condition.text,
    state?.semanticExpansion
  );

  // Determine final expansion strategy: per-condition > global
  let effectiveExpansionStrategy = expansionType || condition.semanticExpansion;
  if (!effectiveExpansionStrategy && hasGlobalExpansion) {
    effectiveExpansionStrategy = state?.semanticExpansion || "synonyms";
  }

  // Apply semantic expansion if needed
  if (effectiveExpansionStrategy && condition.type !== "regex") {
    try {
      const customStrategy =
        effectiveExpansionStrategy === "custom"
          ? state?.customSemanticExpansion
          : undefined;

      // Determine the mode based on condition type
      const expansionMode = condition.type === "page_ref" ? "page_ref" : "text";

      // Create cache key for this condition
      const cacheKey = `single|${cleanText}|${effectiveExpansionStrategy}|${expansionMode}|${state?.userQuery || ''}`;
      
      let expansionTerms;
      if (state.expansionCache.has(cacheKey)) {
        // Reuse cached expansion results
        expansionTerms = state.expansionCache.get(cacheKey);
        console.log(`🔄 [Hierarchy] Reusing cached single condition expansion for "${cleanText}"`);
        
        // Show expanded terms in toaster for cached results too
        if (expansionTerms.length > 0) {
          const { updateAgentToaster } = await import("../../../shared/agentsUtils");
          const strategyLabel = getExpansionStrategyLabel(effectiveExpansionStrategy);
          updateAgentToaster(`🔍 Expanded "${cleanText}" (${strategyLabel}) → ${cleanText}, ${expansionTerms.join(', ')}`);
        }
      } else {
        // Use generateSemanticExpansions
        expansionTerms = await generateSemanticExpansions(
          cleanText,
          effectiveExpansionStrategy as any,
          state?.userQuery,
          state?.model,
          state?.language,
          customStrategy,
          expansionMode
        );
        
        // Cache the results
        state.expansionCache.set(cacheKey, expansionTerms);
        console.log(`💾 [Hierarchy] Cached single condition expansion for "${cleanText}": ${expansionTerms.length} terms`);
        
        // Show expanded terms in toaster
        if (expansionTerms.length > 0) {
          const { updateAgentToaster } = await import("../../../shared/agentsUtils");
          const strategyLabel = getExpansionStrategyLabel(effectiveExpansionStrategy);
          updateAgentToaster(`🔍 Expanded "${cleanText}" (${strategyLabel}) → ${cleanText}, ${expansionTerms.join(', ')}`);
        }
      }

      // REPLACE original condition with single expanded regex condition
      if (expansionTerms.length > 0) {
        const allTerms = [cleanText, ...expansionTerms];
        
        if (condition.type === "page_ref") {
          // For page references, create comprehensive regex that matches [[PageName]], #PageName, and PageName:: formats
          const escapedTerms = allTerms.map(term => 
            term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          );
          
          // Use comprehensive Roam page reference pattern: [[title]], #title, or title::
          const termAlternation = escapedTerms.join('|');
          const pageRefRegex = `(?:\\[\\[(?:${termAlternation})\\]\\]|#(?:${termAlternation})(?!\\w)|(?:${termAlternation})::)`;
          
          return [{
            ...condition,
            type: "regex",
            text: pageRefRegex,
            matchType: "regex", 
            semanticExpansion: undefined,
            weight: condition.weight || 1.0,
          } as any];
        } else {
          // For text conditions, generate simple regex pattern
          const escapedTerms = allTerms.map(term => 
            term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          );
          const regexPattern = `(${escapedTerms.join('|')})`;
          
          return [{
            ...condition,
            type: "regex",
            text: regexPattern,
            matchType: "regex",
            semanticExpansion: undefined,
            weight: condition.weight || 1.0,
          } as any];
        }
      }
    } catch (error) {
      console.warn(`Failed to expand condition "${condition.text}":`, error);
    }
  }

  // If no expansion happened, return cleaned original condition
  return [{
    ...condition,
    text: cleanText,
    semanticExpansion: undefined,
  }];
};

/**
 * Extract search conditions from parsed expressions with compound structure preservation
 */
const extractSearchConditions = (
  expression: SearchTerm | CompoundExpression,
  globalSemanticExpansion?:
    | "fuzzy"
    | "synonyms"
    | "related_concepts"
    | "broader_terms"
    | "custom"
    | "all"
): SearchCondition[] => {
  if (expression.type === "term") {
    const searchType = expression.searchType || "text";
    const matchType = searchType === "regex" ? "regex" : "contains";

    const condition: SearchCondition = {
      type: searchType,
      text: expression.text,
      matchType,
      semanticExpansion:
        globalSemanticExpansion &&
        (searchType === "page_ref" || searchType === "text")
          ? globalSemanticExpansion
          : undefined,
      weight: 1.0,
      negate: false,
    };

    // Add regex flags if present
    if (expression.regexFlags) {
      condition.regexFlags = expression.regexFlags;
    }

    return [condition];
  }

  if (expression.type === "compound") {
    // For page reference OR compounds, create a special combined condition
    if (
      expression.operator === "OR" &&
      expression.operands.every(
        (op) => op.type === "term" && op.searchType === "page_ref"
      )
    ) {
      // Create a single condition that represents the OR of page references
      const pageNames = expression.operands.map(
        (op) => (op as SearchTerm).text
      );

      return [
        {
          type: "page_ref_or",
          text: pageNames.join("|"), // Store as pipe-separated for Datomic OR handling
          matchType: "contains",
          semanticExpansion: undefined,
          weight: 1.0,
          negate: false,
          pageNames: pageNames, // Store original array for proper query building
        } as any,
      ]; // Cast to any since we're extending the SearchCondition type
    }

    // For other compounds, flatten as before
    return expression.operands.flatMap((operand) =>
      extractSearchConditions(operand, globalSemanticExpansion)
    );
  }

  return [];
};

/**
 * Get combine logic from compound expressions
 */
const getCombineLogic = (
  expression: SearchTerm | CompoundExpression
): "AND" | "OR" => {
  if (expression.type === "compound") {
    return expression.operator;
  }
  return "AND"; // Default for simple terms
};

/**
 * Format expression for display (preserves actual AND/OR logic)
 */
const formatExpressionForDisplay = (
  expression: SearchTerm | CompoundExpression
): string => {
  if (expression.type === "term") {
    return expression.text;
  }

  if (expression.type === "compound") {
    const operator = expression.operator === "OR" ? " | " : " + ";
    return expression.operands
      .map((operand) => {
        const formatted = formatExpressionForDisplay(operand);
        // Add parentheses for nested compound expressions
        return operand.type === "compound" ? `(${formatted})` : formatted;
      })
      .join(operator);
  }

  return String(expression);
};

/**
 * Process structured hierarchy query with semantic expansion support
 */
const processStructuredHierarchyQuery = async (
  query: StructuredHierarchyQuery,
  options: {
    maxHierarchyDepth: number;
    strategyCombination: "union" | "intersection";
    includeChildren?: boolean;
    childDepth?: number;
    includeParents?: boolean;
    parentDepth?: number;
    includeDaily: boolean;
    dateRange?: any;
    sortBy: string;
    limit: number;
    secureMode: boolean;
    fromResultId?: string;
    limitToBlockUids?: string[];
    limitToPageUids?: string[];
    excludeBlockUid?: string;
  },
  state?: any
): Promise<any[]> => {
  // Apply semantic expansion to hierarchy condition if present (legacy format only)
  // Skip this for grouped conditions as they handle expansion in processStructuredHierarchyCondition
  if (
    query.hierarchyCondition &&
    query.hierarchyCondition.leftCondition &&
    query.hierarchyCondition.rightCondition
  ) {
    const expandedLeftConditions = await expandStructuredConditions(
      [query.hierarchyCondition.leftCondition],
      state
    );
    const expandedRightConditions = await expandStructuredConditions(
      [query.hierarchyCondition.rightCondition],
      state
    );

    // For now, use the first expanded condition (could be enhanced to handle multiple)
    query.hierarchyCondition.leftCondition = expandedLeftConditions[0];
    query.hierarchyCondition.rightCondition = expandedRightConditions[0];
  }

  // Apply semantic expansion to additional search conditions if present
  if (query.searchConditions && query.searchConditions.length > 0) {
    const expandedSearchConditions = await expandStructuredConditions(
      query.searchConditions,
      state
    );
    query.searchConditions = expandedSearchConditions.filter(
      (cond): cond is StructuredSearchCondition => !("operator" in cond)
    );
  }

  // Process structured hierarchy condition natively (preferred approach)
  if (query.hierarchyCondition) {
    return await processStructuredHierarchyCondition(
      query.hierarchyCondition,
      options,
      state
    );
  }

  // If no hierarchy condition, fall back to regular content search
  if (query.searchConditions && query.searchConditions.length > 0) {
    // Convert structured conditions to legacy format and use existing logic
    const legacyConditions = query.searchConditions.map(
      convertStructuredToLegacyCondition
    );

    // Use findBlocksByContentTool for pure content search
    // CRITICAL: Disable expansion for sub-calls - expansion should only be handled at hierarchy level
    const result: any = await findBlocksByContentTool.invoke({
      conditions: legacyConditions.map((cond) => ({
        ...cond,
        semanticExpansion: null, // Force disable expansion for sub-calls
      })),
      combineConditions: query.combineConditions || "AND",
      includeChildren: options.includeChildren,
      includeParents: options.includeParents,
      limit: options.limit,
      secureMode: options.secureMode,
    }, {
      configurable: {
        state: {
          ...state,
          // Disable automatic expansion for sub-tools - hierarchy tool controls expansion
          automaticExpansionMode: "disabled_by_hierarchy",
          hierarchyExpansionDone: true,
        }
      }
    });

    // Parse the result if it's a string
    if (typeof result === "string") {
      try {
        const parsed = JSON.parse(result);
        return parsed.success ? parsed.data : [];
      } catch (e) {
        console.error("Failed to parse findBlocksByContent result:", e);
        return [];
      }
    }

    // Handle object result
    if (result && typeof result === "object") {
      return result.data || [];
    }

    return [];
  }

  return [];
};

/**
 * Process hierarchical combinations for 3-4 AND conditions
 * Tests all possible combinations: A<=>B+C, B<=>A+C, C<=>A+B (for 3 conditions)
 */
const processHierarchicalCombinations = async (
  hierarchyCondition: any,
  options: any,
  state?: any
): Promise<any[]> => {
  updateAgentToaster("🔀 Testing all hierarchical combinations...");

  // Extract only positive AND conditions (NOT conditions should be distributed across all combinations)
  const positiveConditions: any[] = [];
  const negativeConditions: any[] = [];

  // Extract and separate left conditions
  if (
    hierarchyCondition.leftConditions &&
    Array.isArray(hierarchyCondition.leftConditions)
  ) {
    for (const condition of hierarchyCondition.leftConditions) {
      if (condition.negate) {
        negativeConditions.push(condition);
      } else {
        positiveConditions.push(condition);
      }
    }
  }

  // Extract and separate right conditions
  if (
    hierarchyCondition.rightConditions &&
    Array.isArray(hierarchyCondition.rightConditions)
  ) {
    for (const condition of hierarchyCondition.rightConditions) {
      if (condition.negate) {
        negativeConditions.push(condition);
      } else {
        positiveConditions.push(condition);
      }
    }
  }

  // Only process 3-4 positive conditions
  if (positiveConditions.length < 3 || positiveConditions.length > 4) {
    console.warn(
      `🔀 Combination testing only supports 3-4 positive AND conditions, got ${positiveConditions.length}. Falling back to normal processing.`
    );
    // Fall back to normal processing by calling processSimpleHierarchyCondition directly
    return await processSimpleHierarchyCondition(
      hierarchyCondition,
      options,
      state
    );
  }

  // Generate all combinations using only positive conditions
  const combinations = generateHierarchyCombinations(positiveConditions);

  // Preview all combinations that will be tested
  combinations.forEach((combo, idx) => {
    const leftDesc = combo.leftConditions
      .map((c) => {
        const typePrefix = c.type === "page_ref" ? "ref" : c.type;
        return `${c.negate ? "NOT " : ""}${typePrefix}:${c.text}`;
      })
      .join(" + ");
    const rightDesc = combo.rightConditions
      .map((c) => {
        const typePrefix = c.type === "page_ref" ? "ref" : c.type;
        return `${c.negate ? "NOT " : ""}${typePrefix}:${c.text}`;
      })
      .join(" + ");
  });

  const allResults = new Map<string, any>(); // uid -> result (for deduplication)

  // Execute each combination with detailed logging
  for (let i = 0; i < combinations.length; i++) {
    const { leftConditions, rightConditions } = combinations[i];

    // Create readable condition descriptions for logging
    const leftDesc = leftConditions
      .map((c) => {
        const typePrefix = c.type === "page_ref" ? "ref" : c.type;
        return `${c.negate ? "NOT " : ""}${typePrefix}:${c.text}`;
      })
      .join(" + ");
    const rightDesc = rightConditions
      .map((c) => {
        const typePrefix = c.type === "page_ref" ? "ref" : c.type;
        return `${c.negate ? "NOT " : ""}${typePrefix}:${c.text}`;
      })
      .join(" + ");

    updateAgentToaster(
      `🔀 Testing combination ${i + 1}/${combinations.length}: (${leftDesc}) ${
        hierarchyCondition.operator
      } (${rightDesc})`
    );

    // Create simple hierarchy condition for this combination
    // Distribute NOT conditions to both sides (they apply to the entire query)
    const combinationHierarchyCondition = {
      operator: hierarchyCondition.operator,
      leftConditions: [...leftConditions, ...negativeConditions],
      leftCombination: "AND",
      rightConditions: [...rightConditions, ...negativeConditions],
      rightCombination: "AND",
      maxDepth: hierarchyCondition.maxDepth,
    };

    try {
      // Create options for this combination with semantic expansion disabled
      const combinationOptions = {
        ...options,
        disableSemanticExpansion: true, // Disable semantic expansion for individual combinations
        testAllCombinations: false, // Prevent recursive combination testing
      };

      // Create state with semantic expansion disabled for this combination
      const combinationState = {
        ...state,
        disableSemanticExpansion: true,
      };

      // Call processSimpleHierarchyCondition for this combination
      const combinationResults = await processSimpleHierarchyCondition(
        combinationHierarchyCondition,
        combinationOptions,
        combinationState
      );

      // Add results to map (automatic deduplication by UID)
      let newResultsAdded = 0;
      if (Array.isArray(combinationResults)) {
        combinationResults.forEach((result) => {
          if (result && result.uid && !allResults.has(result.uid)) {
            allResults.set(result.uid, result);
            newResultsAdded++;
          }
        });
      }
    } catch (error) {
      console.error(`🔀   → FAILED:`, error);
    }
  }

  const finalResults = Array.from(allResults.values());

  updateAgentToaster(
    `✅ Combination testing complete: ${finalResults.length} unique results from ${combinations.length} combinations`
  );

  // Note: Semantic expansion should be applied by the calling function after combination testing
  // Individual combinations ran with semantic expansion disabled for efficiency

  return finalResults;
};

/**
 * Generate all valid hierarchy combinations for 3-4 AND conditions
 */
const generateHierarchyCombinations = (
  conditions: any[]
): Array<{ leftConditions: any[]; rightConditions: any[] }> => {
  const combinations: Array<{ leftConditions: any[]; rightConditions: any[] }> =
    [];

  if (conditions.length === 3) {
    // For 3 conditions A, B, C: 3 combinations
    // A <=> (B + C), B <=> (A + C), C <=> (A + B)
    for (let i = 0; i < 3; i++) {
      const leftConditions = [conditions[i]];
      const rightConditions = conditions.filter((_, idx) => idx !== i);
      combinations.push({ leftConditions, rightConditions });
    }
  } else if (conditions.length === 4) {
    // For 4 conditions A, B, C, D: 7 combinations
    // Balanced 2 vs 2: (A+B) <=> (C+D), (A+C) <=> (B+D), (A+D) <=> (B+C)
    // Generate all ways to split 4 items into 2 groups of 2
    combinations.push(
      {
        leftConditions: [conditions[0], conditions[1]],
        rightConditions: [conditions[2], conditions[3]],
      },
      {
        leftConditions: [conditions[0], conditions[2]],
        rightConditions: [conditions[1], conditions[3]],
      },
      {
        leftConditions: [conditions[0], conditions[3]],
        rightConditions: [conditions[1], conditions[2]],
      }
    );

    // 1 vs 3: A <=> (B+C+D), B <=> (A+C+D), C <=> (A+B+D), D <=> (A+B+C)
    for (let i = 0; i < 4; i++) {
      const leftConditions = [conditions[i]];
      const rightConditions = conditions.filter((_, idx) => idx !== i);
      combinations.push({ leftConditions, rightConditions });
    }
  }

  return combinations;
};

/**
 * Process structured hierarchy condition natively without converting to legacy string
 */
const processStructuredHierarchyCondition = async (
  hierarchyCondition: any,
  options: any,
  state?: any
): Promise<any[]> => {
  // Validate that operator is defined
  if (!hierarchyCondition || !hierarchyCondition.operator) {
    console.error(
      "❌ Invalid hierarchy condition - missing operator:",
      hierarchyCondition
    );
    return [];
  }

  // Handle combination testing for bidirectional operators with 3-4 AND conditions
  if (
    options.testAllCombinations &&
    (hierarchyCondition.operator === "<=>" ||
      hierarchyCondition.operator === "<<=>>")
  ) {
    return await processHierarchicalCombinations(
      hierarchyCondition,
      options,
      state
    );
  }

  // Extract and process left and right conditions with backward compatibility
  let leftConditions: any[], leftCombination: string;
  let rightConditions: any[], rightCombination: string;

  // Handle grouped conditions (new) - only if they have content
  if (
    hierarchyCondition.leftConditionGroups &&
    Array.isArray(hierarchyCondition.leftConditionGroups) &&
    hierarchyCondition.leftConditionGroups.length > 0
  ) {
    const processedGroups = await processConditionGroups(
      hierarchyCondition.leftConditionGroups,
      hierarchyCondition.leftGroupCombination || "AND",
      state
    );
    leftConditions = processedGroups.conditions;
    leftCombination = processedGroups.combination;
  } else {
    // Handle simple conditions (existing - backward compatible)
    leftConditions = Array.isArray(hierarchyCondition.leftConditions)
      ? hierarchyCondition.leftConditions
      : hierarchyCondition.leftCondition?.conditions ||
        (hierarchyCondition.leftCondition
          ? [hierarchyCondition.leftCondition]
          : []);
    leftCombination =
      hierarchyCondition.leftCombination ||
      hierarchyCondition.leftCondition?.operator ||
      "AND";
  }

  if (
    hierarchyCondition.rightConditionGroups &&
    Array.isArray(hierarchyCondition.rightConditionGroups) &&
    hierarchyCondition.rightConditionGroups.length > 0
  ) {
    const processedGroups = await processConditionGroups(
      hierarchyCondition.rightConditionGroups,
      hierarchyCondition.rightGroupCombination || "AND",
      state
    );
    rightConditions = processedGroups.conditions;
    rightCombination = processedGroups.combination;
  } else {
    // Handle simple conditions (existing - backward compatible)
    rightConditions = Array.isArray(hierarchyCondition.rightConditions)
      ? hierarchyCondition.rightConditions
      : hierarchyCondition.rightCondition?.conditions ||
        (hierarchyCondition.rightCondition
          ? [hierarchyCondition.rightCondition]
          : []);
    rightCombination =
      hierarchyCondition.rightCombination ||
      hierarchyCondition.rightCondition?.operator ||
      "AND";
  }

  // Apply semantic expansion to conditions
  const expandedLeftConditions = await expandStructuredConditions(
    leftConditions,
    state
  );
  const expandedRightConditions = await expandStructuredConditions(
    rightConditions,
    state
  );

  // Apply OR-to-regex conversion for mixed logic cases (Tier 2)
  const processedLeftConditions = applyORToRegexConversion(
    expandedLeftConditions,
    leftCombination
  );
  const processedRightConditions = applyORToRegexConversion(
    expandedRightConditions,
    rightCombination
  );

  // Execute hierarchy search based on operator
  switch (hierarchyCondition.operator) {
    case ">":
      // Strict hierarchy: left > right (left parent, right child)
      return await executeStructuredStrictHierarchySearch(
        processedLeftConditions.conditions,
        processedRightConditions.conditions,
        processedLeftConditions.combination,
        processedRightConditions.combination,
        options,
        state
      );

    case ">>":
      // Deep strict hierarchy: left >> right (left ancestor, right descendant)
      return await executeStructuredDeepStrictHierarchySearch(
        processedLeftConditions.conditions,
        processedRightConditions.conditions,
        processedLeftConditions.combination,
        processedRightConditions.combination,
        options,
        state
      );

    case "<=>":
      // Bidirectional: left <=> right (either direction)
      return await executeStructuredBidirectionalSearch(
        processedLeftConditions.conditions,
        processedRightConditions.conditions,
        processedLeftConditions.combination,
        processedRightConditions.combination,
        options,
        state
      );

    case "=>":
      // Flexible hierarchy: left => right (same block OR left parent of right)
      return await executeStructuredFlexibleHierarchySearch(
        processedLeftConditions.conditions,
        processedRightConditions.conditions,
        processedLeftConditions.combination,
        processedRightConditions.combination,
        options,
        state
      );

    case "=>>":
      // Right flexible hierarchy: left =>> right (left ancestor, right descendant with flexibility, deep)
      return await executeStructuredDeepFlexibleHierarchySearch(
        processedLeftConditions.conditions,
        processedRightConditions.conditions,
        processedLeftConditions.combination,
        processedRightConditions.combination,
        options,
        state
      );

    case "<<=>>":
      // Deep bidirectional: left <<=>> right (either direction, any depth)
      return await executeStructuredDeepBidirectionalSearch(
        processedLeftConditions.conditions,
        processedRightConditions.conditions,
        processedLeftConditions.combination,
        processedRightConditions.combination,
        options,
        state
      );

    case "<":
      // Inverse strict hierarchy: left < right (left child, right parent) - swap conditions
      return await executeStructuredStrictHierarchySearch(
        processedRightConditions.conditions,
        processedLeftConditions.conditions,
        processedRightConditions.combination,
        processedLeftConditions.combination,
        options,
        state
      );

    case "<<":
      // Inverse deep strict hierarchy: left << right (left descendant, right ancestor) - swap conditions
      return await executeStructuredDeepStrictHierarchySearch(
        processedRightConditions.conditions,
        processedLeftConditions.conditions,
        processedRightConditions.combination,
        processedLeftConditions.combination,
        options,
        state
      );

    case "<=":
      // Inverse flexible hierarchy: left <= right (same block OR left child of right) - swap conditions
      return await executeStructuredFlexibleHierarchySearch(
        processedRightConditions.conditions,
        processedLeftConditions.conditions,
        processedRightConditions.combination,
        processedLeftConditions.combination,
        options,
        state
      );

    case "<<=":
      // Left deep flexible hierarchy: left <<= right (left descendant, right ancestor with flexibility) - swap conditions
      return await executeStructuredFlexibleHierarchySearch(
        processedRightConditions.conditions,
        processedLeftConditions.conditions,
        processedRightConditions.combination,
        processedLeftConditions.combination,
        options,
        state
      );

    default:
      console.warn(
        `⚠️ Unsupported structured operator: ${hierarchyCondition.operator}`
      );
      return [];
  }
};

/**
 * Process condition groups for complex logic like ((A|B) AND NOT C)
 * Converts groups into flat conditions for existing OR-to-regex processing
 */
const processConditionGroups = async (
  conditionGroups: any[],
  groupCombination: string,
  state?: any
): Promise<{ conditions: any[]; combination: string }> => {
  const allConditions: any[] = [];
  let hasMultipleGroups = conditionGroups.length > 1;
  let hasORGroups = conditionGroups.some((group) => group.combination === "OR");

  // Process each group
  for (const group of conditionGroups) {
    const groupConditions = group.conditions || [];
    const groupCombination = group.combination || "AND";

    // If this is an OR group with multiple conditions, we may need OR-to-regex conversion
    if (groupCombination === "OR" && groupConditions.length > 1) {
      // Check if this group has negated conditions mixed with positive ones
      const hasNegated = groupConditions.some((c) => c.negate === true);
      const hasPositive = groupConditions.some((c) => c.negate !== true);

      if (hasNegated && hasPositive) {
        // This is a complex case that needs OR-to-regex conversion
        // For now, add all conditions and let OR-to-regex conversion handle it
        allConditions.push(...groupConditions);
      } else {
        // Simple OR group - add all conditions
        allConditions.push(...groupConditions);
      }
    } else {
      // AND group or single condition - add all conditions
      allConditions.push(...groupConditions);
    }
  }

  // Determine final combination logic
  let finalCombination: string;

  if (hasMultipleGroups && groupCombination === "AND") {
    // Multiple groups combined with AND
    finalCombination = "AND";
  } else if (hasORGroups && !hasMultipleGroups) {
    // Single OR group
    finalCombination = "OR";
  } else if (hasMultipleGroups && groupCombination === "OR") {
    // This is complex - multiple groups with OR between them
    // For now, treat as OR and let OR-to-regex conversion handle it
    finalCombination = "OR";
  } else {
    // Default to AND
    finalCombination = "AND";
  }

  return {
    conditions: allConditions,
    combination: finalCombination,
  };
};

/**
 * Apply OR-to-regex conversion for mixed logic cases (Tier 2)
 * Detects AND-dominant logic with OR sub-groups and converts OR groups to regex
 */
const applyORToRegexConversion = (
  conditions: any[],
  combination: string
): { conditions: any[]; combination: string } => {
  // Only apply conversion for AND-dominant logic with potential OR sub-groups
  if (combination !== "AND" && combination !== "OR") {
    return { conditions, combination };
  }

  // Check if this is a mixed logic case that benefits from OR-to-regex conversion
  const hasNegatedConditions = conditions.some((c) => c.negate === true);

  // For pure OR without negation, keep current OR clause logic
  if (combination === "OR" && !hasNegatedConditions) {
    return { conditions, combination };
  }

  // For OR logic with negation, apply conversion (NOT for simple AND+NOT queries)
  if (combination === "OR" && hasNegatedConditions) {
    // Group positive conditions for potential OR-to-regex conversion
    const positiveConditions = conditions.filter((c) => c.negate !== true);
    const negativeConditions = conditions.filter((c) => c.negate === true);

    // Convert multiple positive conditions to a single regex condition
    if (positiveConditions.length > 1) {
      const regexCondition = convertConditionsToRegex(positiveConditions);
      const newConditions = [regexCondition, ...negativeConditions];

      return { conditions: newConditions, combination: "AND" };
    }
  }

  return { conditions, combination };
};

/**
 * Convert multiple conditions to a single regex condition
 */
const convertConditionsToRegex = (conditions: any[]): any => {
  const regexParts: string[] = [];

  for (const condition of conditions) {
    switch (condition.type) {
      case "text":
        if (condition.matchType === "regex") {
          // Keep existing regex as-is (don't double-wrap)
          regexParts.push(condition.text);
        } else {
          // Wrap text in .* for partial matching
          const escapedText = condition.text.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );
          regexParts.push(`.*${escapedText}.*`);
        }
        break;

      case "page_ref":
        // Convert page reference to multiple syntax patterns
        const escapedPage = condition.text.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );
        const pagePattern = `.*(\\[\\[${escapedPage}\\]\\]|#${escapedPage}|${escapedPage}::).*`;
        regexParts.push(pagePattern);
        break;

      case "block_ref":
        // Convert block reference to pattern (less common, but include for completeness)
        const escapedBlock = condition.text.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );
        regexParts.push(`.*\\(\\(${escapedBlock}\\)\\).*`);
        break;

      default:
        console.warn(
          `Unsupported condition type for OR-to-regex conversion: ${condition.type}`
        );
        // Fallback: treat as text
        const escapedFallback = condition.text.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );
        regexParts.push(`.*${escapedFallback}.*`);
    }
  }

  // Combine all patterns with OR - this will be sanitized when used in Datomic query
  const combinedRegex = `(?i)(${regexParts.join("|")})`;

  return {
    type: "text",
    text: combinedRegex,
    matchType: "regex",
    semanticExpansion: false, // Already expanded
    weight: 1,
    negate: false,
  };
};

/**
 * Convert structured HierarchyCondition back to legacy expression string
 * This is a temporary bridge function
 */
const convertStructuredToLegacyExpression = (
  condition: HierarchyCondition
): string => {
  const leftExpr = convertConditionToString(condition.leftCondition);
  const rightExpr = convertConditionToString(condition.rightCondition);
  return `${leftExpr} ${condition.operator} ${rightExpr}`;
};

/**
 * Convert SearchCondition or CompoundCondition to string representation
 */
const convertConditionToString = (
  condition: StructuredSearchCondition | CompoundCondition
): string => {
  if ("operator" in condition) {
    // CompoundCondition
    const operatorSymbol = condition.operator === "AND" ? " + " : " | ";
    const conditionStrings = condition.conditions.map(convertConditionToString);
    return `(${conditionStrings.join(operatorSymbol)})`;
  } else {
    // SearchCondition
    return condition.text;
  }
};

/**
 * Convert structured SearchCondition to legacy condition format
 */
const convertStructuredToLegacyCondition = (
  condition: StructuredSearchCondition
) => ({
  type: condition.type,
  text: condition.text,
  matchType: condition.matchType,
  weight: condition.weight,
  negate: condition.negate,
});

/**
 * Process hierarchical expressions by decomposing into multiple search strategies
 */
const processHierarchicalExpression = async (
  expression: string,
  options: {
    maxHierarchyDepth: number;
    strategyCombination: "union" | "intersection";
    includeChildren?: boolean;
    childDepth?: number;
    includeParents?: boolean;
    parentDepth?: number;
    includeDaily: boolean;
    dateRange?: any;
    sortBy: string;
    limit: number;
    secureMode: boolean;
    fromResultId?: string;
    limitToBlockUids?: string[];
    limitToPageUids?: string[];
    excludeBlockUid?: string;
  },
  state?: any
): Promise<any[]> => {
  const parsedExpression = parseHierarchicalExpression(expression);
  if (!parsedExpression) {
    throw new Error(`Failed to parse hierarchical expression: "${expression}"`);
  }

  // If it's just a simple term, fall back to basic content search
  if (parsedExpression.type === "term") {
    const searchResult = await executeContentSearch(
      [
        {
          type: "text",
          text: parsedExpression.text,
          matchType: "contains",
          semanticExpansion: undefined,
          weight: 1.0,
          negate: false,
        },
      ],
      "AND",
      options,
      state
    );
    return searchResult.results;
  }

  // Handle hierarchical expressions
  if (
    parsedExpression.type === "strict_hierarchy" ||
    parsedExpression.type === "deep_strict_hierarchy" ||
    parsedExpression.type === "flexible_hierarchy" ||
    parsedExpression.type === "bidirectional" ||
    parsedExpression.type === "deep_bidirectional" ||
    parsedExpression.type === "strict_hierarchy_left" ||
    parsedExpression.type === "deep_strict_hierarchy_left" ||
    parsedExpression.type === "flexible_hierarchy_left" ||
    parsedExpression.type === "flexible_hierarchy_right" ||
    parsedExpression.type === "deep_flexible_hierarchy"
  ) {
    return await processHierarchicalQuery(parsedExpression, options, state);
  }

  if (parsedExpression.type === "compound") {
    return await processCompoundQuery(parsedExpression, options, state);
  }

  throw new Error(`Unsupported expression type: ${parsedExpression.type}`);
};

/**
 * Process different types of hierarchical queries
 */
const processHierarchicalQuery = async (
  expr: HierarchicalExpression,
  options: any,
  state?: any
): Promise<any[]> => {
  const expansionLevel = state?.expansionLevel || 0;
  const globalSemanticExpansion =
    options.semanticExpansion || expansionLevel >= 2;
  const leftConditions = extractSearchConditions(
    expr.leftOperand,
    globalSemanticExpansion
  );
  const rightConditions = extractSearchConditions(
    expr.rightOperand,
    globalSemanticExpansion
  );
  const leftCombineLogic = getCombineLogic(expr.leftOperand);
  const rightCombineLogic = getCombineLogic(expr.rightOperand);

  const leftDisplay = formatExpressionForDisplay(expr.leftOperand);
  const rightDisplay = formatExpressionForDisplay(expr.rightOperand);

  // Show concise search info (no extra queries for performance)
  // const leftTerms = formatExpressionForDisplay(expr.leftOperand);
  // const rightTerms = formatExpressionForDisplay(expr.rightOperand);

  // updateAgentToaster(`🔍 Searching: ${leftTerms} ${expr.operator} ${rightTerms}`);

  let resultSets: any[] = [];

  switch (expr.operator) {
    case ">":
      // Strict hierarchy: A > B (A parent, B child)
      resultSets = await executeStrictHierarchySearch(
        leftConditions,
        rightConditions,
        leftCombineLogic,
        rightCombineLogic,
        options,
        state
      );
      break;

    case ">>":
      // Deep strict hierarchy: A >> B (A ancestor, B descendant, any depth)
      resultSets = await executeDeepStrictHierarchySearch(
        leftConditions,
        rightConditions,
        leftCombineLogic,
        rightCombineLogic,
        options,
        state
      );
      break;

    case "=>":
      // Flexible hierarchy: A => B (same block OR A parent of B)
      resultSets = await executeFlexibleHierarchySearch(
        leftConditions,
        rightConditions,
        leftCombineLogic,
        rightCombineLogic,
        options,
        state
      );
      break;

    case "<=>":
      // Bidirectional: A <=> B (A parent of B OR B parent of A)
      resultSets = await executeBidirectionalSearch(
        leftConditions,
        rightConditions,
        leftCombineLogic,
        rightCombineLogic,
        options,
        state
      );
      break;

    case "<<=>>":
      // Deep bidirectional: A <<=>> B (A ancestor/descendant of B, any depth)
      resultSets = await executeDeepBidirectionalSearch(
        leftConditions,
        rightConditions,
        leftCombineLogic,
        rightCombineLogic,
        options,
        state
      );
      break;

    case "<":
      // Inverse strict hierarchy: A < B (A child, B parent) - return child blocks
      resultSets = await executeInverseStrictHierarchySearch(
        leftConditions, // A (child condition to return)
        rightConditions, // B (parent condition to filter)
        leftCombineLogic,
        rightCombineLogic,
        options,
        state
      );
      break;

    case "<<":
      // Inverse deep strict hierarchy: A << B (A descendant, B ancestor) - swap the conditions
      resultSets = await executeDeepStrictHierarchySearch(
        rightConditions, // B becomes ancestor
        leftConditions, // A becomes descendant
        rightCombineLogic,
        leftCombineLogic,
        options,
        state
      );
      break;

    case "<=":
      // Inverse flexible hierarchy: A <= B (same block OR A child of B) - swap the conditions
      resultSets = await executeFlexibleHierarchySearch(
        rightConditions, // B becomes parent
        leftConditions, // A becomes child
        rightCombineLogic,
        leftCombineLogic,
        options,
        state
      );
      break;

    case "=>>":
      // Right flexible hierarchy: A =>> B (A ancestor, B descendant with flexibility)
      resultSets = await executeFlexibleHierarchySearch(
        leftConditions,
        rightConditions,
        leftCombineLogic,
        rightCombineLogic,
        options,
        state
      );
      break;

    case "<<=":
      // Left deep flexible hierarchy: A <<= B (A descendant, B ancestor with flexibility) - swap the conditions
      resultSets = await executeFlexibleHierarchySearch(
        rightConditions, // B becomes ancestor
        leftConditions, // A becomes descendant
        rightCombineLogic,
        leftCombineLogic,
        options,
        state
      );
      break;

    default:
      throw new Error(`Unsupported hierarchical operator: ${expr.operator}`);
  }

  // Combine all result sets
  if (resultSets.length === 0) {
    return [];
  }

  if (resultSets.length === 1) {
    return resultSets[0];
  }

  // Use combineResults to merge multiple result sets
  const combinedResults = await executeCombineResults(
    resultSets,
    options.strategyCombination
  );

  // Apply final sorting and limiting
  return applyFinalProcessing(combinedResults, options);
};

/**
 * Process compound queries (AND/OR operations) with proper structure preservation
 * This handles queries like "(A | A') + (B | B')" correctly by preserving grouping
 */
const processCompoundQuery = async (
  expr: CompoundExpression,
  options: any,
  state?: any
): Promise<any[]> => {
  // Check if this is a mixed structure that needs special handling
  const hasNestedCompounds = expr.operands.some((op) => op.type === "compound");

  if (hasNestedCompounds && expr.operator === "AND") {
    // Handle complex structures like (A | A') + (B | B')

    const groupResults: any[] = [];

    // Process each operand group separately
    for (const operand of expr.operands) {
      if (operand.type === "compound") {
        // Process nested compound (like A | A')
        const groupConditions = extractSearchConditions(operand);
        const groupLogic = getCombineLogic(operand);

        const groupResult = await executeContentSearch(
          groupConditions,
          groupLogic,
          options,
          state
        );

        groupResults.push(groupResult.results || []);
      } else {
        // Process single term
        const termConditions = extractSearchConditions(operand);
        const termResult = await executeContentSearch(
          termConditions,
          "AND",
          options,
          state
        );

        groupResults.push(termResult.results || []);
      }
    }

    // Intersect all group results (AND operation between groups)
    if (groupResults.length === 0) return [];
    if (groupResults.length === 1) return groupResults[0];

    // Find UIDs that appear in ALL groups
    const allUIDs = groupResults.map(
      (group) => new Set(group.map((item: any) => item.uid || item[0]))
    );
    const intersection = allUIDs[0];

    for (let i = 1; i < allUIDs.length; i++) {
      for (const uid of intersection) {
        if (!allUIDs[i].has(uid)) {
          intersection.delete(uid);
        }
      }
    }

    // Return results from first group that match intersection
    return groupResults[0].filter((item: any) =>
      intersection.has(item.uid || item[0])
    );
  } else {
    // Simple compound - use flat processing
    const globalSemanticExpansion = options.semanticExpansion;
    const allConditions = extractSearchConditions(
      expr,
      globalSemanticExpansion
    );
    const combineLogic = getCombineLogic(expr);

    const searchResult = await executeContentSearch(
      allConditions,
      combineLogic,
      options,
      state
    );

    return searchResult.results || [];
  }
};

/**
 * Find parent blocks that have descendants matching ALL conditions
 */
// const findParentsWithAllConditionsInDescendants = async (
//   allMatchingBlockUids: string[],
//   conditionMatches: any[][],
//   contentConditions: SearchCondition[],
//   levels: number,
//   isDescendants: boolean = true
// ): Promise<any[]> => {
//   if (allMatchingBlockUids.length === 0) return [];

//   // Get hierarchy relationships for all matching blocks
//   const hierarchyQuery = `[:find ?parent-uid ?child-uid ?level
//                            :where
//                            ${allMatchingBlockUids
//                              .map(
//                                (uid, i) => `[?child${i} :block/uid "${uid}"]`
//                              )
//                              .join("\n                           ")}

//                            ${allMatchingBlockUids
//                              .map(
//                                (uid, i) =>
//                                  `(or-join [?parent-uid ?child-uid ?level]
//                                ${
//                                  isDescendants
//                                    ? // For descendants: find parents of matching blocks
//                                      `(and [?child${i} :block/uid ?child-uid]
//                                        [?child${i} :block/parents ?parent]
//                                        [?parent :block/uid ?parent-uid]
//                                        [(get-level ?parent ?child${i}) ?level]
//                                        [(<= ?level ${levels})])`
//                                    : // For ancestors: find children of matching blocks
//                                      `(and [?parent${i} :block/uid ?parent-uid]
//                                        [?parent${i} :block/parents ?child]
//                                        [?child :block/uid ?child-uid]
//                                        [(get-level ?child ?parent${i}) ?level]
//                                        [(<= ?level ${levels})])`
//                                })`
//                              )
//                              .join("\n                           ")}]`;

//   // This is getting complex - let me use a simpler approach with existing utilities

//   const parentCandidates = new Map<string, Set<string>>(); // parentUid -> set of condition indices it satisfies

//   for (
//     let conditionIndex = 0;
//     conditionIndex < conditionMatches.length;
//     conditionIndex++
//   ) {
//     const blocks = conditionMatches[conditionIndex];

//     for (const block of blocks) {
//       let relatedBlocks: any[] = [];

//       if (isDescendants) {
//         // Find ancestors of this block (parents that could have this block as descendant)
//         const ancestorResults = await getFlattenedAncestors(
//           [block.uid],
//           levels
//         );
//         relatedBlocks = Object.values(ancestorResults).flat();
//       } else {
//         // Find descendants of this block (children that this block could be parent of)
//         const descendantResults = await getFlattenedDescendants(
//           [block.uid],
//           levels
//         );
//         relatedBlocks = Object.values(descendantResults).flat();
//       }

//       // Record that these parent/ancestor blocks satisfy this condition
//       for (const relatedBlock of relatedBlocks) {
//         const key = relatedBlock.uid;
//         if (!parentCandidates.has(key)) {
//           parentCandidates.set(key, new Set());
//         }
//         parentCandidates.get(key)!.add(conditionIndex.toString());
//       }
//     }
//   }

//   // Find parents that satisfy ALL conditions
//   const validParents: any[] = [];
//   const numConditions = contentConditions.length;

//   for (const [parentUid, satisfiedConditions] of parentCandidates) {
//     if (satisfiedConditions.size === numConditions) {
//       // This parent has descendants that match ALL conditions

//       // Get the full block data for this parent
//       const parentData =
//         await executeDatomicQuery(`[:find ?uid ?content ?time ?page-title ?page-uid
//                                                      :where
//                                                      [?b :block/uid "${parentUid}"]
//                                                      [?b :block/uid ?uid]
//                                                      [?b :block/string ?content]
//                                                      [?b :block/page ?page]
//                                                      [?page :node/title ?page-title]
//                                                      [?page :block/uid ?page-uid]
//                                                      [?b :edit/time ?time]]`);

//       if (parentData.length > 0) {
//         validParents.push({
//           uid: parentData[0][0],
//           content: parentData[0][1],
//           time: parentData[0][2],
//           page_title: parentData[0][3],
//           page_uid: parentData[0][4],
//         });
//       }
//     }
//   }

//   return validParents;
// };

/**
 * Helper functions for parent-priority deduplication
 */

/**
 * Check if a block contains conditions (matches search terms)
 */
const containsConditions = (
  block: any,
  conditions: SearchCondition[],
  combineLogic: "AND" | "OR" = "AND"
): boolean => {
  if (!block || !block.content) return false;

  const content = block.content.toLowerCase();

  // Use appropriate logic based on combineLogic parameter
  const checkFunction =
    combineLogic === "OR" ? conditions.some : conditions.every;

  return checkFunction.call(conditions, (condition: SearchCondition) => {
    const searchTerm = condition.text.toLowerCase();

    switch (condition.type) {
      case "text":
        if (condition.matchType === "exact") {
          return content === searchTerm;
        } else if (condition.matchType === "regex") {
          try {
            const regex = new RegExp(condition.text, "i");
            return regex.test(content);
          } catch {
            return false;
          }
        } else {
          // Contains match
          const matches = content.includes(searchTerm);
          return condition.negate ? !matches : matches;
        }

      case "page_ref":
        const pageRefPattern = new RegExp(
          `\\[\\[${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]`,
          "i"
        );
        const pageMatches = pageRefPattern.test(content);
        return condition.negate ? !pageMatches : pageMatches;

      case "block_ref":
        const blockRefPattern = new RegExp(
          `\\(\\(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)\\)`,
          "i"
        );
        const blockMatches = blockRefPattern.test(content);
        return condition.negate ? !blockMatches : blockMatches;

      default:
        return false;
    }
  });
};

/**
 * Extract child UIDs from a parent result that match given conditions
 */
export const extractChildUids = (
  parentResult: any,
  conditions: SearchCondition[],
  combineLogic: "AND" | "OR" = "AND"
): string[] => {
  if (!parentResult.children || parentResult.children.length === 0) {
    return [];
  }

  const matchingChildUids: string[] = [];

  const checkChildRecursively = (children: any[]) => {
    for (const child of children) {
      if (containsConditions(child, conditions, combineLogic)) {
        matchingChildUids.push(child.uid);
      }

      // Check nested children if they exist
      if (child.children && child.children.length > 0) {
        checkChildRecursively(child.children);
      }
    }
  };

  checkChildRecursively(parentResult.children);
  return matchingChildUids;
};

/**
 * Calculate maximum depth of hierarchy
 */
const getMaxDepth = (children: any[], currentDepth: number = 0): number => {
  if (!children || children.length === 0) return currentDepth;

  let maxDepth = currentDepth;
  for (const child of children) {
    if (child.children) {
      maxDepth = Math.max(
        maxDepth,
        getMaxDepth(child.children, currentDepth + 1)
      );
    }
  }

  return maxDepth;
};

/**
 * Calculate relevance score including hierarchy context
 */
export const calculateHierarchyRelevanceScore = (
  result: any,
  conditions: any[]
): number => {
  let score = 0;
  const content = (result.content || "").toLowerCase();

  // Score based on main content
  for (const condition of conditions) {
    if (condition.type === "text" && condition.text) {
      const text = condition.text.toLowerCase();
      const weight = condition.weight || 1;

      if (condition.matchType === "exact" && content === text) {
        score += 10 * weight;
      } else if (content.includes(text)) {
        const exactWordMatch = new RegExp(
          `\\b${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`
        ).test(content);
        score += exactWordMatch ? 5 * weight : 2 * weight;
      }
    }
  }

  // Bonus for hierarchy depth (more context = higher relevance)
  score += (result.hierarchyDepth || 0) * 0.5;

  // Bonus for having both children and parents
  if ((result.children || []).length > 0 && (result.parents || []).length > 0) {
    score += 1;
  }

  return score;
};
