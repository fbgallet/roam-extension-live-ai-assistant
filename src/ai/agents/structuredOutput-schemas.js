import { z } from "zod";
/************************/
/*  SMART SEARCH AGENT  */
/************************/

export const searchListSchema = z.object({
  directList: z
    .string()
    .describe("Search list of key terms directly extracted from user query"),
  alternativeList: z
    .string()
    .optional()
    .nullable()
    .describe(
      "Alternative search list if key terms in user query are likely to be too limited"
    ),
  isPostProcessingNeeded: z
    .boolean()
    .optional()
    .nullable()
    .describe(
      "True if the user query ask not only for a search but also for post-processing search results"
    ),
  pagesLimitation: z
    .string()
    .optional()
    .nullable()
    .describe(
      "Limitation to a set of pages: 'dnp' or expression to be matched by the page titles"
    ),
  nbOfResults: z
    .number()
    .optional()
    .nullable()
    .describe("Number of requested results, otherwise null"),
  isRandom: z.boolean().optional().describe("Is a random result requested"),
  isDirectedFilter: z
    .boolean()
    .optional()
    .describe(
      "Is filter directed from parent meeting a conditon to children meeting other conditions"
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

const filtersArray = z
  .array(
    z
      .object({
        regexString: z
          .string()
          .describe(
            "Regex string (eventually with disjonctive logic) to search"
          ),
        isToExclude: z
          .boolean()
          .optional()
          .nullable()
          .describe("True if this regexString is to exclude"),
        isParentFilter: z
          .boolean()
          .optional()
          .nullable()
          .describe(
            "True if this filter is to apply to parent blocks in the case of a hierarchically directed search"
          ),
      })
      .describe("Filter object")
  )
  .nullable()
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
