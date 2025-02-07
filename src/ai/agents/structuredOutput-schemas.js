import { z } from "zod";
/************************/
/*  SMART SEARCH AGENT  */
/************************/

export const searchListSchema = z.object({
  searchList: z
    .string()
    .describe("Search list of key terms directly extracted from user request"),
  alternativeList: z
    .string()
    .optional()
    .nullable()
    .describe(
      "Optional alternative search list if strong disjunctive logic in user request"
    ),
  nbOfResults: z
    .number()
    .optional()
    .nullable()
    .describe("Number of requested results, otherwise null"),
  isRandom: z.boolean().optional().describe("Is a random result requested"),
  isPostProcessingNeeded: z
    .boolean()
    .optional()
    .nullable()
    .describe(
      "True if the user query ask not only for a search but also for post-processing search results"
    ),
  isInferenceNeeded: z
    .boolean()
    .optional()
    .nullable()
    .describe(
      "True if the user question keywords aren't enough to catch relevant data "
    ),
  depthLimitation: z
    .number()
    .optional()
    .nullable()
    .describe(
      "Depth limitation of the search: 0, 1 or to levels of children, or ignore this property if no indication"
    ),
  pagesLimitation: z
    .string()
    .optional()
    .nullable()
    .describe(
      "Limitation to a set of pages: 'dnp' or expression to be matched by the page titles"
    ),
  period: z
    .object({
      begin: z
        .string()
        .optional()
        .nullable()
        .describe(
          "Date of the beginning of the period (older than the end), in the format yyyy/mm/dd"
        ),
      end: z
        .string()
        .optional()
        .nullable()
        .describe("Date of the end of the period, in the format yyyy/mm/dd"),
    })
    .optional()
    .nullable()
    .describe(
      "Restricted period of the request, only if mentioned by the user"
    ),
});

export const alternativeSearchListSchema = z.object({
  alternativeSearchList: z
    .string()
    .optional()
    .nullable()
    .describe("The formatted alternative query"),
});

const filtersArray = z
  .array(
    z
      .object({
        regexString: z
          .string()
          .describe(
            "Regex string (eventually with disjonctive logic) to search, should never be a void string"
          ),
        isToExclude: z
          .boolean()
          .optional()
          .nullable()
          .describe("True if this regexString is to exclude"),
        isTopBlockFilter: z
          .boolean()
          .optional()
          .nullable()
          .describe(
            "true only for item greater (higher) in the hierarchy expressed by '<' or '>' symbol"
          ),
      })
      .describe("Filter object")
  )
  .nullable()
  .optional()
  .describe(
    "Array of filter objects defining conjunctively combined search conditions"
  );

export const searchFiltersSchema = z
  .object({
    firstListFilters: filtersArray,
    alternativeListFilters: filtersArray,
  })
  .describe(
    "Each search list converted in an array of filters. If no alternative list, set corresponding property to null"
  );

export const preselectionSchema = z.object({
  relevantUids: z
    .array(z.string().describe("uid without parentheses, exactly 9 characters"))
    .describe("Array of relevant uids only"),
});
