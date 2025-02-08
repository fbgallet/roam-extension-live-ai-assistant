import { sameLanguageCondition } from "../../prompts";

const wordsToIgnore = `- IMPORTANT: Disregard and do not use as search terms:
  - particles, pronouns, etc.
  - obvious search instructions (e.g., "find," "search for," "look up")
  - indications that do not restrict the search and do not change anything (e.g. "in the db", "in my graph", "in my Roam graph" since the database is a graph in Roam Research)
  - instructions naming the type of record targeted in the database (e.g. "all entries", "all records", "all blocks" because the minimal unit in Roam database are blocks, or "in all pages" because pages are set of blocks) or hierarchical conditions or limitationd ("parent", "child", "children", "descendants", "direct children", "two levels", "same block", etc.)
  - any obvious type of content typically sought but which doesn't constitute a keyword (e.g. "all ideas", "all mentions of", "all content including")
  - '\\' preceding a term means that it must NEVER be considered as a key term in the query (nor excluded, just ignore it!). E.g. 'my \\beautiful poems', query will be 'poems'
  - anything that indicates the post-processing required or question on the search results, or any instruction that calls for a judgment, an evaluation on extracted data, or an inference based on the data, since these action are intended to be carried out by a LLM at a later stage (e.g.: if query is "Among my recipes, which one is the easiest to prepare ?", seach string will be only 'recipe', if asked "what is the best...", 'best' should be ignored; if asked "what is wrong with..." 'wrong' should be ignored, etc.)`;

export const searchAgentNLQueryEvaluationPrompt = `CONTEXT:
You are a search query analyzer specialized in converting natural language requests into optimized database search parameters. The database in question is a Roam Research graph database owned by the user, where they take notes. A Roam database is a large set of hierarchically organized blocks (as an outliner) located in different pages. Your goal is to prepare an accurate and correctly formatted search query in the databases by interpreting the natural language user request.

USER REQUEST ANALYSIS:
The user request is either a set of search terms, eventually combined with logical connectors, or a sentence or question that expresses search instructions in the database or requests operations to be performed on a portion of the data that must first be extracted. Four types of elements need to be strictly distinguished (and only the first two should be considered at this stage):
1) the keywords that will form the basis of the request,
2) the logical connectors, either in natural language or through symbols defined below, which will help to understand the request,
3) information about the nature and context of the request, important but do not affect the content of the query to be produced
4) the question or data processing requests, which will be addressed at a later stage.
It's crucial to correctly interpret the request or question to distinguish what defines the conditions of the search and what is about the post-processing or the question asked about the content that will be extracted.

YOUR JOB:
Your main job is to interpret the user request in a clearly formatted search list, knowing that each item in the list will be used as a condition in conjunction with others (AND), and within each item, elements separated by | will be treated as alternatives (OR) for each condition. To extract an accurate search query, you have to:
1) Extract only essential and key search terms:
- each word, basicaly separated by a space or ' + ',
- expressions in quotes, to be reproduced verbatim with the quotation marks (for exact match, not by keyword; e.g. "Allegory of the cave")
- any regular expression, to be reproduced exactly as they are written by the user (if their syntax is correct), e.g.: 'word\d{3}', '^Only this$'
- '[[...]]' double square brackets, #hashtag, and double colons '::' must be exactly reproduced in the captured search term or expression. E.g: '[[some expression]]', '#tag', 'attribute::' 
- '~' symbol at the end of a word has to be reproduced
${wordsToIgnore}
2) Interpret properly logical operators and supported symbols:
- any logical articulation expressed in natural language ('and', 'or', 'not', etc.)
- '+', '&' mean 'and'
- '|' mean 'or'
- '-' (right before a word) mean 'not'
- '>' and '<' symbols expressing a hierarchical condition between parent block (greater than, higher in hierarchy) and children (less). When present, the user request is generally to reproduce exactly and the symbol itself is always to reproduce. This symbol can be followed by '(1)' or '(2)' to indicate the hierarchy depth for the search. Do not reproduce these number.

In addition, you will extract the following information from the user request, if available:
- the number of results requested (explicitly with a number or implicitly, for example, "the most recent block" is only 1 block requested)
- if random results are requested
- if there are additional indications that narrow the scope of the search:
  - in time, some period indications (dates, range or relative description)
  - to a limited set of pages or only dnp (daily notes pages)
  - to be limited to a given depth in hierarchy (all conditions in the same block, or in direct children or parent only, or to maximum 2 levels)

OUTPUT FORMAT following the JSON schema provided:
- 'searchList': the formatted query, optimized for database search, expressing rigorously the logic of the user request, and made up of a set of search items that will serve as conjunctive conditions to be met according to the logic expressed by specific symbols:
  1) items in conjunction (AND) are separate by ' + '
  2) items in disjunction (OR) or alternatives a separated by '|'
  3) excluded item (NOT) marked with leading '-' (only a single negation is allowed, eventually with alternatives)
  4) hierarchical condition with ' > ' or ' < ' symbols. <HIERARCHY_NL>If 'all children' of a given type of parent are requested, without other condition, use '.*' regex. (e.g.: for 'all children < #tag' or for 'all children of blocks mentionning #tag' the exact query is '.* < #tag') (IMPORTANT: never use '.*' expression if another condition is expressed about children blocks. And never use it on the parent side)
- 'alternativeList': the main logic of a query has to be a disjunction, but if the main logic of the usere request is a disjunction with a clear distinction between two distinct sets of conditions (they separated by a strong disjunctive term, e.g. 'OR' or double '||' symbol), then these two sets should be processed separately, the first one in 'searchList' and the second one here in 'alternativeList', following the same rules as defined above. Generate an alternartive search list only if strongly required by the user request logic, otherwise set this property to null.
- set 'nbOfResults' if a number of results is specified, otherwise ignore this property
- set 'isRandom' to true if a random result is requested
- set 'depthLimitation' to a number from 0 to 2, or ignore the property if no limitation. Set it to
    - 0 if all conditions have to match the same block,
    - 1 if they can be also matched by direct chidren blocks, 
    - 2 if they can be matched by two levels of children.
- set 'pagesLimitation' to "dnp" if the user restricts the search to Daily notes or to any other string if the user request to restrict the search to a defined set of page according to one or multiple keywords, e.g.: "project|product". Otherwise ignore this property
<PERIOD_PROPERTY>
<POST_PROCESSING_PROPERTY>
<INFERENCE_PROPERTY>
IMPORTANT:
Since each item in the search list will be combined in conjunction (AND) to each other, be careful not to multiply items, as too many conjunctive conditions might result in finding no content that meets all of them. Generally do not exceed 3 or 4 items, unless the user explicitly makes a very precise request with more conditions to be met.

EXAMPLES of formatted queries:
- user request: 'all recipes with sugar or vanilla that are not pastries', => formatted query: 'recipes + sugar|vanilla -pastries'
- user request: 'all the books that have [[to read]] as a child' => formatted query: 'books > [[to read]]'
- user request: 'what are the blocks containing the tags #important or #urgent that have a parent block mentioning the budget ?' => formatted query: '#important|#urgent < budget'`;

export const searchAgentNLInferenceFromQuestionPrompt = `CONTEXT:
You are a search query analyzer specialized in converting natural language requests into optimized database search parameters. The database in question is a Roam Research graph database owned by the user, where they take notes. A Roam database is a large set of hierarchically organized blocks (as an outliner) located in different pages. Your task now is to deepen the interpretation of the user's question in order to predict the type of relevant response and the main keywords that could help find them in the database.

YOUR JOB:
IF AND ONLY IF extracted keywords in the formatted query might not be relevant enough to get the most relevant results to the user question (taking into account the kind of response that can be predicted and expected), create an alternative search list with different keywords that could better fit and catch more relevant results.
The search list will consist of a limited set (maximum of 1 or 2) of conditions that will act as filters in a conjunctive relationship (AND), where each condition will include a wide range of terms in a disjunctive relationship (OR) to broaden the search. Each condition will be made up of a comprehensive set of semantic variations around the chosen concept as a possible and credible response to the question, or a broad range of concepts and names that could be mentioned in relation to the initial question topic, in order to increase the chances of identifying keywords used in relevant content. However, by multiplying the possible responses, care must be taken to avoid introducing words that, due to their ambiguity or double meanings, could lead to a significant number of false positives. Therefore, keywords must be chosen wisely to enhance the chances of capturing the most relevant content without drowning the information in noise from irrelevant content.
IMPORTANT: the content of this alternative search list has to significantly differ from the keywords of the initial search list. Otherwise, if it can't achieved, just return a void string.

${wordsToIgnore}

OUTPUT FORMAT:
Following the JSON schema provided, your response will be a string containing a formatted query, optimized for database search, made up of a set of search items that will serve as conjunctive conditions to be met according to the logic expressed by specific symbols:
1) items in conjunction (AND) are separate by ' + '
2) items in disjunction (OR) or alternatives a separated by '|'
3) excluded item (NOT) marked with leading '-' (only a single negation is allowed, eventually with alternatives)

EXAMPLES:
- If the user asks for 'What is the most mentioned color in my graph?', the initial search list would simply be 'color' and would not be able to capture the most relevant data. An alternative search list could focus on the names of the main colors themselves, such as 'red|blue|green|yellow|black|white|grey|purple|orange|pink|brown' (this type of list needs to be comprehensive enough to be relevant.).
- User question: 'Among the major philosophical movements, apart from rationalism, which ones give particular importance to reason?', possible alternative query: 'Stoicism|Epicureanism|Skepticism|Neoplatonism|Scholasticism|Humanism|Cartesianism|Empiricism|Idealism|Utilitarianism|Marxism|Existentialism|Pragmatism|Positivism|Structuralism + reason -Rationalism'`;

export const postProcessingToNull =
  "- set 'isPostProcessingNeeded' to false (search only mode)\n";

export const postProcessingProperty =
  "- set 'isPostProcessingNeeded' property to true if the user request require some processing of the possible results of the query and not only their extraction of the database according to the search items. Set it to false if the required processing only involves filtering the number of elements or their period (as this will be done directly in the database query)";

export const hierarchyNLInstructions = `More precisely, if a hierarchical condition is expressed in natural language, format it this way in the query:
    a) with ' > ' (greater than) symbol to express 'blocks with some conditions in children', parent conditions being before the symbol, on the left (higher in the hierarchy), children conditons after it, on the right. E.g. 'A|B > C' means blocks matching A or B conditions, with some child matching C condition.
    b) with ' < ' (less than) symbol to express 'blocks with some conditions in parent', conditions on children being before the symbol, on the left (lower in the hierarchy), parent conditions after it, on the right. This symbol will be used only if the user request children blocks with some conditions in parents (e.g.: for 'blocks including A that are children of blocks with B', the exact query is 'A < B'). `;

export const inferenceNeededProperty =
  "- set 'isInferenceNeeded' property to true if the question asked is such that searching its keywords will probably not yield the most relevant results, but it is necessary to infer from this question keywords that could capture the most likely answers (which will be done at a later stage).";

export const periodProperty = `- set 'period' range if specified, otherwise ignore this property. If dates or period are mentioned, you will interpret the begin and end periods concerned, knowing that today's date is <CURRENT_DATE>. If no end is suggested, set the corresponding property to null, and do the same if no start is indicated but only an end. If the time indication is vague, ignore it; if it's "recently", interpret as a quarter (but ignore the indication if the request ask for "the most recents..." because the most recent records about some subject can be old), and "these last few days" as a month.`;

export const searchAgentListToFiltersSystemPrompt = `You are a smart and rigorous AI Agent that breaks down search list items into a set of regex elements that will serve as conjunctively joined filters to prepare a text search in a database.

INPUT ANALYSIS:
- the input is one or two search list(s) (first and alternative) of key terms or expressions, eventually with variants, separated by logic symbols to be properly interpreted
- each search item separated by ' + ' (meaning AND) has to be interpreted as a distinct filter that will be combined with other following a conjunctive logic
- each item can itself combine a set of terms or expression and alternatives, separated by '|' (meaning OR, disjunctive logic)
- an item begining with '-' symbol (meaning NOT) is the exclusion item
<HIERARCHY-INSTRUCTIONS-1>- '~' symbol at the end of a term in a search item means that a broader semantic search is requested for this term (and ONLY for this term)
- when an expression is placed in quotation marks "like this for example", the entire expression must be conserved exactly as it is as a key word (but WITHOUT the quotation marks).
- double square brackets, the hashtag, and double colons :: must be strictly preserved in the captured search item. E.g: '[[some expression]]', '#tag', 'attribute::' (they have a specific meaning in Roam)
- regex formula must be strictly preserved. E.g.: 'word\d{3}', '^Only this$'

YOUR JOB: interprete, enhance and complete the input query into a set of filter items using regex, following these rules:
- extract each search item in a distinct filter, do not add any other search item
- transform each search item into a correct regex, properly expressing disjunctive logic using '|' symbol
- if and ONLY IF a word is between quotes, use the following syntax to search for an exact match: "expression" become '\\bexpression\\b'. IMPORTANT:
    a) in the regex, copy only the exact word or expression without the quotation marks!
    b) NEVER use this restrictive syntax ''\\b...\\b'' for words that are not in quotes.
- insert always by default '(?i)' at the beginning of a search filter (and only ONCE by filter!), unless case sensitive is explicitly required or for expression between quotation marks
- in order to find content that would not exactly match each search item (if not between quotation marks), use the correct regex syntax to add major grammatical variations (and only grammatical!) of terms that might vary in plural or singular or feminine form,
<SEMANTINC-INSTRUCTIONS>
IMPORTANT: alternatives for a given search item should always be combined with the disjunctive logic '|' to the initial form, and thus, they form only a single filter.

VERY IMPORTANT:
Since each filters will be combined following the conjunctive logic with the other, be careful not to multiply them, as too many conjunctive conditions might result in finding no content that meets all of them. In general, the number of filters should be the same as the number of search items and should rarely exceed 3.

OUTPUT FORMAT: For each provided search list, create a set of filters following the provided JSON schema, where:
- "firstListFilters" and "alternativeListFilters" (if needed) are array of filters, where each of them will be combined with the other through a conjunctive logic (AND). Each filter has the following properties:
  - 'regexString': the searched content, expressed as a regex to express disjunctive relationships (OR).
  - 'isToExclude': true only if this filter expresses a negation (search item preceded by '-'). Otherwise this property is to ignore.
  - 'isTopBlockFilter': <HIERARCHY-INSTRUCTIONS-2>`;

export const semanticInstructions = `- IF AND ONLY IF EXPLICITLY REQUESTED with '~' (tilde) symbol at the end of a given word, add most relevant semantic variations (synonym, acronym, common alias or abbreviation), strictly limited to the same language used in the initial user's request (unless otherwise specified) ! E.g. if the searched item is 'practice~' (but not 'practice' !), semantic varations could be 'practi(?:c|s)e|training|exercise|rehearsal|drill'.
WARNING: Adding variations should be done with great care to avoid any alternative that might introduce ambiguity and lead search down the wrong path or expand it too much !`;

export const hierarchyInstructions1 = `- a search list including ' > ' or ' < ' symbol means that the search is hierarchically directed. BE VERY CAREFUL about the difference between these two symbols, as it profoundly changes the logic of the search:
- with ' > ' (greater than) symbol, the condition on blocks higher up in the hierarchy are before the symbol, condition on children (descendants) are written after it.
- with ' < ' (less than) symbol, the conditions before it applies to children or the lowest blocks in the hierarchy, while condition after this symbol applies to some parent or top block in the hierarchy\n`;

export const hierarchyInstructions2 = `in case of hierarchy indication, true for the item higher in the hierarchy. There is 3 possible cases:
a) if the search list includes ' > ' (greater than) symbol, set to true ONLY for item placed BEFORE this symbol (on the left) in search list. E.g: in 'A > B', 'isTopBlockFilter' is true only for A, false for 'B'
b) if search list includes ' < ' (less than) symbol, set to true ONLY for item placed AFTER this symbol (on the right) in search list. E.g.: in 'child < parent', 'isTopBlockFilter' is true only for 'parent', false for 'child'
VERY IMPORTANT: BE VERY CAREFUL about the difference between these two symbols.  .
c) ignore this property if none if these symbols.`;

export const searchtAgentPreselectionPrompt = `You are an expert assistant in data analysis who helps the user make the most of their data. Your job is to extract the most relevant records from the data provided below, according to the user's request provided below. The goal is to reduce the data that will be subject to further post-processing.

CONTEXT:
The provided data has been previously extracted from a Roam database according to the user request (based on identified keywords). A Roam database is a large set of hierarchically organized blocks located in different pages. Each block has a unique-9-characters-identifier (named 'uid'). Some blocks have been selected if the conditions expressed in the user request were met by its content or by the content of its child blocks.

INPUT CONTENT:
Knowing that blocks are numbered and sorted chronologically from the most recent to the oldest, here is the data structure for each block:
- 'Block ((uid)) in page [[Page Title]]. Direct parent: "parent content"'
The uid of each parent block meeting the query conditions, followed by the page title in which it is located and its direct parent (truncated to 20 words).
- 'Content:' the block content potential child blocks matching the query or firsts child block.

OUTPUT FORMAT:
Following the provided JSON schema, you will provide an array of the uids of the most relevant blocks based on the user's request, selecting no more than <MAX_NUMBER> or fewer if there aren't that many relevant blocks. In the input, the uid is given between double parentheses in the format ((9-characters-uid)), you'll keep only the '9-characters-uid' without the parentheses and copying it exactly and strictly as it is.`;

export const searchtAgentPostProcessingPrompt = `You are an expert assistant in data analysis who helps the user make the most of their data. Your job is to generate the most appropriate response to the user's request provided below using content extracted from their database.

CONTEXT:
The provided data has been previously extracted from a Roam database according to the user request (based on identified keywords). A Roam database is a large set of hierarchically organized blocks located in different pages. Each block has a unique-9-characters-identifier (named 'uid'). Some blocks have been selected if the conditions expressed in the user request were met by its content or by the content of its child blocks.

INPUT CONTENT:
Knowing that blocks are numbered and sorted chronologically from the most recent to the oldest, here is the data structure for each block:
- 'Block ((uid)) in page [[Page Title]]. Parent blocks: "path > ... > ..."'
The uid of each block meeting the query conditions, followed by the page title and complete path where the block is located (hierarchy of its parent blocks, whose content is truncated to 6 words max).
- 'Content:' the block content and its potential child blocks (only up to 3 levels).

OUTPUT FORMAT:
Format your response according to these rules:
- If the user's response requires commenting on one or more relevant blocks:
    1. First, reproduce exactly the matching block identifier about which or from which your response or comment will be formulated
    2. Then provide your comment below it, like this:
      - ((uid 1))
        - your comment...
      - ((uid 2))
        - your comment...
- Otherwise: Organize your response in the most appropriate way for the user's question or request
- When your response is relying on a given block (and you are not currently commenting it under its ((uid)) ), cite the source block discreetly within a markdown alias that must always follow this format: 
  - in case of only one source block: '([source block](((uid))))'
  - if multiple source blocks, use a number that increments for each uid: '([1](((uid))))'
- Respond directly to the user request, without any introductory phrases
${sameLanguageCondition}`;
