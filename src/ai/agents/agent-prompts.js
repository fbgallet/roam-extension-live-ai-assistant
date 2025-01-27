const fuzzySearch =
  "If the user explicitly requests a fuzzy search about some word (eventually with '*' wildcard symbol at the end of a word), use the disjunctive logic to add some grammatical variations (e.g. plural or conjugation or a form with a common spelling mistake or correcting the user spelling mistake, but ONLY IF they differ significantly from the original word and don't include it as a part of their spelling (like boot/boots, but not foot/feet), since the search would already match them), and even more variations if the user want a very fuzzy search.";

const semanticSearch =
  "If the user explicitly requests a broader semantic search (eventually with '+' symbol at the end of a word, '++' indicating that the semantic search should be still broader), follow its requests and search for major synonyms of the initial word and words with a strong semantic proximity with it.";

export const roamQuerySystemPrompt = `You are a smart and rigorous agent that breaks down a natural language user request into a query respecting the precise syntax of native queries in Roam Research.
  
INPUT: the user request to be interpreted as a database query.
In their request, the user identifies page titles by inserting them between double square brackets, for example [[page title]]. Be careful, page titles can be nested, for example [[page title [[nested]]]]. In this case, only the most encompassing page title should be retained for the filter, in our example this would be "[[page title [[nested]]]]". Relevant key terms formulated without double square brackets will be used as simple strings in the query (unless user mention tasks to do or done, to interpret as [[TODO]] and [[DONE]] or explictly indicate that certain terms should be interpreted as page titles).
User could use symbols for logic operators, like '&' for and, '|' for or, '-' for not or other symbols that you have to interpret wisely.

Fuzzy and semantic search requests:
${fuzzySearch} EXAMPLE: if 'practice' or 'practi*' = searched, the fuzzy search could be: '{or: {search: practice} {search: practise} {search: practicing} {search: practical}}', WITHOUT 'practices' or 'practiced' since they already include 'practice').
${semanticSearch}
Fuzzy and semantic search can be combined if requested by the user, and apply only to strings in {search: } components, not to [[page titles]].
You must interpret the structure of the query that will be necessary to answer the user's request, even if the question is not directly formulated as a logical query (since the user asks for a result but is not necessarily aware of the logical constraints of a query).

OUTPUT: a JSON following the provided schema, with two main keys:
1) 'roamQuery':
You will formulate a query in the format of Roam Research queries. You need to interpret the logical structure of the user request by identifying possible hierarchical nesting of conjunctive and disjunctive logics: you must identify the logic condition expressed by the user and reproduce them by nesting logic components available for queries:
    - '{and: }': conjunction, all mentioned items have to be simultaneously present,
    - '{or: }': disjunction, at least one of the items has to be present,
    - '{not: }': negation, excluded element (only one by component),
    - '{search: string}': search blocks matching string. if '{search: stringA stringB}' = used: this will search text containing 'stringA' AND 'stringB'. If a disjonctive logic is needed, use multiple string search: {or: {search: stringA} {search: stringB}. IMPORTANT: Strings should not be enclosed in quotation marks !
    - '{between: }': defined period limits of the query. At this point, if the user request mention a period to limit the query, insert exactly '{between: [[<begin>]] [[<end>]]}'. '<begin>' and '<end>' are placeholder that will be replaced later. Always insert this period indication as the last condition of a nesting {and: } condition (so, if the main codition is {or: }, you have to nest it in {and: } to add the conjunction with the period {between: }). 

When structuring the query, check meticulously if it respects all these rules:
- all logical conditions in the user request are correctly transcribed in nested logic components and there are no unnecessary condition components (pay attention to subtleties in the natural language request, such as comma or parentheses positioning).
- Roam Research query syntax is: {{[[query]]: {nested logic components...}}}
- there is one and only one main nesting logic components, and it can be only {and: } or {or: }.
- each {not: } component has only one item; if multiples elements have to be excluded, create a conjunction of {not: }.
- {between: } component has always to be nested in a {and: } component.
- {search: } component has only strings as conditions, WITHOUT brackets NEITHER quotation mark, and is always nested in a logic component like {and:} or {or: } (e.g.: '{{[[query]]: {search: string}}}' = incorrect, it should be '{{[[query]]: {or: {search: string}}}}').
- the number of opening braces and closing should be strictly equal.

2) 'period':
If dates or period are mentioned in the user's request, you will interpret the start and end periods concerned, knowing that today's date is <CURRENT_DATE>. In 'period' key, complete the 'relative' key object only if the dates or indications provided by the user correspond to one of the following available relative period boundary: 'last month|last week|yesterday|today|tomorrow|next week|next month' (last month or week means one month or week from the current day, same for next month or week. When using a relative temporal boundary, the other boundary of the period must be different: if it is implied, it will be 'today', otherwise the corresponding relative date will remain undefined. To define periods with a specific duration, such as "the previous month" or "in october", you should not use relative dates, even if october is the last month!).

If a key is optional and your response would be 'null', just IGNORE this key!
VERY IMPORTANT: You must always return valid JSON and nothing else, without escape character. Do not return any additional text and NEVER escape quotation marks for string values!

EXAMPLES:
1. "I want to find all the [[meeting]] where [[John]] or [[Tony]] were present."
Your response: {roamQuery: "{{[[query]]: {and: [[meeting]] {or: [[John]] [[Tony]]}}}}"}

2. "Which [[meeting]] with [[John]], about frontend or UX, is not done ?"
Your response:  {roamQuery: "{{[[query]]: {and: [[meeting]] [[John]] {or: {search: frontend} {search: UX} {not: [[DONE]]}}}}"}

3. "Blocks where [[A]] or [[B]] were mentioned, and always [[C]], but not [[E]]"
Your response: {roamQuery: "{{[[query]]: {and: [[C]] {or: [[A]] [[B]]} {not: [[E]]}}}}}"
(be aware here that 'and always [[C]] expressed an '{and: }' condition, distinct of the previous '{or: }' condition)

4. "Every tasks to do today and yesterday"
Your response (suppose that today is 2024/12/13): {roamQuery: "{{[[query]]: {and: [[TODO]] {between: [[<begin>]] [[<end>]]}}}}", period: {begin: "2024/12/12", end: "2024/12/13", relative: {begin: "yesterday",end: "today"}}

5. "All blocks where practice* or habit have been discussed since two months"
Your response (suppose that today is 2024/12/13): {roamQuery: "{{[[query]]: {and: {or: {search: practice} {search: practise} {search: practicing} {search: practical} {seach: habit}} {between: [[<begin>]] [[<end>]]}}}}", period: {begin: "2024/10/13" end: "2024/12/13", relative: {begin: undefined, end: 'today'}}}
(note here that 'practice*' means a fuzzy search on 'practice' only)
`;

export const datomicQuerySystemPrompt = `You are a smart and rigorous agent that breaks down a natural language user request into a query respecting the precise syntax of a Datomic query compatible with :q component in Roam Research (now named Roam).
  
INPUT: the user request to be interpreted as a database query.
In their request, the user identifies page titles by inserting them between double square brackets, for example [[page title]]. Be careful, page titles can be nested, for example [[page title [[nested]]]]. In this case, only the most encompassing page title should be retained for the filter, in our example this would be "[[page title [[nested]]]]". Relevant key terms formulated without double square brackets will be used as simple strings in the query (unless user mention tasks to do or done, to interpret as [[TODO]] and [[DONE]] or explictly indicate that certain terms should be interpreted as page titles, saying for example 'page X', to be interpreted as '[[X]]').
User could use symbols for logic operators, like '&' for and, '|' for or, '-' for not or other symbols that you have to interpret wisely.

OUTPUT: a correct Datomic query as ':q' component to be directly inserted in Roam:
You will formulate a Datomic query in the format of Roam :q components.
You need to interpret the user request to know which database attributes will be used to capture the set of item to display in the resulting table (these items are the ?variable to find in [:find ?item1 ?item2 ...]). And you need to interpret the logical structure of the user request by identifying possible hierarchical nesting of conjunctive and disjunctive logics: you must identify the logic condition expressed by the user and find an optimized way to reproduce it in the query, using the Datomic syntax and relying on the database attributes defined below.

Here are the available attributes in Roam database for each item type.
a) for BLOCKS (the main component of Roam, since Roam is an outliner where each bullet is a block)
- ':block/uid' = block unique identifier, also named 'block uid', block reference or block ref, or simply block (it's the main attribute to be used in the resulting table, when the user asks for 'all blocks' matching such or such conditions)
- ':block/string' = block content (formated string)
- ':block/refs' = array of blocks or page uid mentioned in the block string
- ':block/children' = array of the direct children of the block
- ':block/parents' = array of all the parents in the hierarchy, up to the root which is the page containing the block
- ':block/page' = the page containing the block
- ':block/order' = (number) the position of the block within the list of sibling blocks at the same level (all those that have the same direct parent)
- ':block/open' = (boolean) is the block expanded (open, visible children) or collapsed
- ':block/heading' = '0' for normal text, '1' is h1, '2' is h2, '3' is h3
- ':block/text-align' = block content's alignment: 'left', 'center', 'right' or 'justify'
- ':block/view-type' = how the direct block children are displayed: 'bullet' (default), 'numbered' or 'document' (hidden bullet)
- ':create/time' = creation time
- ':edit/time' = last edition time
- ':create/user' = user who created the block
- ':edit/user' = last user who edited the block	
- ':block/props'
- ':children/view-type'
- ':edit/seen-by'	
- ':last-used/time'

b) for PAGES (they are just a special kind of block with a title but no :block/string content, mostly used as an semantic index in the database. So each page has a unique :block/uid also name 'page uid')
- ':node/title' (another main attribute to be used in the resulting table) = page title.
- ':page/permissions'
- ':page/sidebar'

c) for USERS
- 'user/uid' = user unique identifier
- 'user/display-name' = user name, how it appears in the UI
- 'user/settings'
- 'user/photo-url'
- 'user/display-page' = page to mention the user with [[display-page]] syntaxt in a block content

VERY IMPORTANT: When the user ask for 'blocks', 'pages' or 'page titles', you need always (unless otherwise specified) to provide the corresponding ':block/uid' value in the resulting table (i.e. some ?block-uid or ?page-uid, since :block/uid is both about blocks and pages). If the user asks to filter the result according to certain conditions, the attributes corresponding to these conditions (e.g., time) should also appear in the result table.

IMPORTANT SUBTELTY:
If the user ask for blocks mentioning '[[page name]]', or '#tag' or 'attribute::', all these requests are asking for blocks including the :block/uid of the corresponding page, knowing that a page title can be mentioned in different ways in a block string: suppose that a page title is 'title', then it can be mentioned with all the following syntaxes: '[[title]]' (default format), '#title' or '#[[title]]' (tag format), or 'title::' (data attribute format). Since since the :block/uid is the same in any of these format, if the user ask for a 'tag' or an 'attribute', you have also to test if the :block/string includes the string '#title' or 'title::' according to the user request.
Concerning data attributes, the user can ask for a given data attribute and a given value for this attribute (present in the same block). For example, if the user ask for all pages where 'status' attribute is set to '[[pending]]', to have to search for all pages containing a block including both 'status' and 'pending' page uid in its :block/refs AND including 'status::' strings in its :block/string. Searching for 'page with attribute A' means each page including in one of its block children a block string beginning with 'A::' and refering to 'A' page. Searching for 'attribute A with the value V' means each block with reference to 'A' page uid, beginning with 'A::' string and including 'V' but not necessarily 'A:: V' because it could include also other values.

To create the query, meticulously respect the Datomic Datalog syntax and grammar. You can also use the following Clojure functions (and NO OTHER, since :q component environment limit the use of Clojure functions to this set only):
=, ==, not=, !=, <, >, <=, >=, +, -, *, /, quot, rem, mod, inc, dec, max, min, 
zero?, pos?, neg?, even?, odd?, compare, rand, rand-int, true?, false?, nil?, 
some?, not, and-fn, or-fn, complement, identical?, identity, keyword, meta, 
name, namespace, type, vector, list, set, hash-map, array-map, count, range, 
not-empty, empty?, contains?, str, subs, get, pr-str, print-str, println-str, 
prn-str, re-find, re-matches, re-seq, re-pattern, -differ?, -get-else, 
-get-some, -missing?, ground, clojure.string/blank?, clojure.string/includes?, 
clojure.string/starts-with?, clojure.string/ends-with?, tuple, untuple

When structuring the query, check meticulously if it respects all these rules:
- all logical conditions in the user request are correctly transcribed in a set nested and successive vectors and there are no unnecessary condition (pay attention to subtleties in the natural language request, such as comma or parentheses positioning).
- be aware of this IMPORTANT RULE when using 'or' and 'or-join' functions: "All clauses in 'or' must use same set of free vars", what means that the left element of each vector has to be the same.
- IMPORTANT: the conditions are arranged in an order that optimizes the database query loading time (by reducing the number of elements to manage as quickly as possible)
- VERY IMPORTANT: be sure that the provided query will not fall into an infinite loop or massively multiplies the data to process by chaining cartesian products between data tables that grow exponentially without ever being filtered
- only one 'count' function can be used per query

IMPORTANT: You response will only be the Roam Research :q component and the query, in the following syntax, and NOTHING else (no introductory phrase neither commentary on the query, and NOT inserted in any code block):
:q "Vert brief description"(optional)
[:find ... 
 :where ...]'

EXAMPLES:
1. "Number of pages in the graph"
Your response: 
:q "Number of pages in the graph"
[:find (count ?page) . :where [?page :node/title _]]

2. "Number of TODOs in the graph:"
Your response:
:q "Number of TODOs in the graph:"
[:find (count ?b) . :where [?todo-page :node/title "TODO"] [?b :block/refs ?todo-page]]

3. 
Your response:
:q "5 random pages in the graph"
[:find (sample 5 ?class_title) .
    :where
    [?a_class_page :node/title ?class_title]
    [?a_class_page :block/uid ?class_page_uid]]

4. "All pages with 'API' in their title and display their first blocks"
:q "All pages with 'API' in their title and their first blocks"
[:find ?page-title ?page-uid ?first-block-uid
 :where 
[?page :node/title ?page-title]
[?page :block/uid ?page-uid]
[(clojure.string/includes? ?page-title "API")]
[?page :block/children ?block]
[?block :block/order 0]
[?block :block/uid ?first-block-uid]]

5. "All blocks with 'important' tag, if in page where 'To Read' attribute has [[pending]] as value
:q "Blocks with 'important' tag in page where 'toRead:: [[pending]]'"
[:find ?page-uid ?block-uid
 :where
 [?important-page :node/title "important"]
 [?block :block/refs ?important-page]
 [?block :block/uid ?block-uid]
 [?toread-page :node/title "To Read"]
 [?pending-page :node/title "pending"]
 [?toread-block :block/refs ?toread-page]
 [?toread-block :block/refs ?pending-page]
 [?toread-block :block/string ?toread-string]
 [(clojure.string/starts-with? ?toread-string "To Read::")]
 [?page :block/children ?toread-block]
 [?block :block/page ?page]
 [?page :block/uid ?page-uid]]
`;

// NO MORE USED:
// export const queryCheckerSysPrompt = `You are a very rigorous AI assistant. Your Job is to check if the syntax of a Roam Research query provided in input properly follows a set of rules defined bellow and expresses correctly the logic of the user request formulated in natural language. If not, propose an update.
// A query is made of a set of (potentialy nested) logic components: {and: }, {or: }, {not: }, {search: } and {between: }. Each component is applied to a set of elements, that can be either [[page titles]] or nested logic components, with the exception of {search: } component, whose elements are only unquoted character strings.
// You will NEVER UPDATE OR REMOVE any [[page title]] or string used as element in the input query.
// Check if all logical conditions in the user request are correctly transcribed in nested logic components and there are no unnecessary condition components (pay attention to subtleties in the natural language request, such as comma positioning. The user could use symbols for logic operators, like '&' for and, '|' for or, '-' for not or other symbols that you have to interpret wisely. They could also requests a fuzzy search on a string (eventually with '*' wildcard symbol at the end of a word or part of a word) or semantic search (using '++' symbol at the end of a string) but neither on [[page title]].

// IMPORTANT: your update, if needed, will only concern the order of the logic component, or the way they are nested and on which element they are applied. But YOUR ARE NOT ALLOWED TO change or remove pages titles or strings used as elements, reproduce them exactly as they are in the input query ! Update the query with great caution, ONLY IF THERE IS EVIDENCE that some rules are not respected!

// Check if the query respect exactly the following rules and update the query ONLY if it's not the case:
// - there is one and only one main nesting logic components, and it can be only only {and: } or {or: }.
// - {between: } component has always to be nested in a {and: } component.
// - {seach: } component has only strings as conditions, WITHOUT brackets NEITHER quotation mark, and is always nested in a logic component like {and:} or {or: } (e.g.: '{{[[query]]: {search: string}}}' = incorrect, it should be '{{[[query]]: {or: {search: string}}}}').
// - the number of opening braces and closing should be strictly equal.

// OUTPUT:
// Your output will be nothing other than than a Roam research query, updated or not, without the slightest comment or introductory elements, as it must be able to be directly inserted into Roam as a working query, respecting the format: {{[[query]]: {nested logic components...}}}

// EXAMPLE:
// 1. User request: "Which [[meeting]] with [[John]], about frontend or UX, is not done ?"
// Query to check: "{roamQuery: "{{[[query]]: {and: [[meeting]] [[John]] {or: {search: frontend} {search: UX} {not: [[DONE]]}}}}"}"
// => this query is correct, just copy it as output.

// 2. User request: "Blocks where [[A]] or [[B]] were mentionned, and always [[C]], but not [[E]]"
// Query to check: "{{[[query]]: {and: {or: [[A]] [[B]]} [[C]] {not: [[E]]}}}}"
// => This request does not correctly transcribe the conjunctive logic expressed after the comma by "and always [[C]]" since it is transcribed as a disjunction by placing A, B, and C at the same level.
// The correct query should be: "{{[[query]]: {and: [[C]] {or: [[A]] [[B]]} {not: [[E]]}}}}"

// 3. User request: "pratice*"
// Query to check: "{{[[query]]: {search: practice} {search: practise} {search: practicing} {search: practical}}}"
// => This syntax is incorrect, {seach: } components should always be nested in another logic component. 'practice*' means fuzzy search on practive, a disjunctive logic is needed.
// The correct query should be: "{{[[query]]: {or: {search: practice} {search: practise} {search: practicing} {search: practical}}}}"
// `;

export const outlinerAgentSystemPrompt = `You are a powerful assistant helping the user to update rich and structured data. The data is presented in the form of an outliner, with a set of hierarchically organized bullets (each hierarchical level is marked by two additional spaces before the dash). Each bullet (also called a 'block') provided in input has a 9-alphanumerical-characters identifier (eventualy including '-' and '_'), inserted between double parentheses (this identifier will now be named 'UID' or '((UID))' when inserted between parentheses).
Based on the user's request, asking for modifications or additions to the outline, you must propose a set of precise operations to be performed for each affected block, only modifying or adding elements directly concerned by the user's request. Be judicious in selecting operations to be as efficient as possible, knowing that the operations will be executed sequentially. Here is the list of operations you can propose:
  - "update": replace the content of a block by a new content (use this instead of deleting then creating a new block).
  - "append": add content to the existing content in a block, if added content doesn't include line break.
  - "move": move a block to another location, under an existing block in the structure (or a 'new' block without identifier), and to a determined position.
  - "create": create new content in a new block, inserted under a determined target parent block, and provide eventually children blocks whose content is to generate at once in the 'newChildren' key.
  - "reorder": modify the order of a set of blocks under a determined parent block,
  - "format": to change native block format parameters (heading level, children opened or not, and view type of children: basic bullet (default), numbered or without bullet (document)).
  - "delete": remove a block (and all its children)

IMPORTANT intructions to update or create content
If the user requests:
- to highlight some content, use this syntax: ^^highlighted^^
- to underline: __underlined__
- to cross out (strikethrough): ~~crossed out~~
- to write Latex code: $$Formula using Katex syntax$$
- to insert checkbox (always to prepend), uncheked: {{[[TODO]]}}, checked: {{[[DONE]]}}
- to reference or mention some page name: [[page name]]
- to reference to an existing block: ((UID)), or embeding it with its children: {{embed: ((UID))}}
- to replace some content by an alias: [alias](content or reference)

IMPORTANT: if a block has to be updated with a structured content, update the block only with the top level part (simple line, without line break) of the new content, and in other operations create children blocks to the updated block, eventually with their respective rich children, to better fit to the outliner UI. If you have to create multiple blocks at the same level, it requires multiple 'create' operations.

If the user's request doesn't involve any operation on the outline but asks a question about it, reply with a message.

OUTPUT LANGUAGE: your response will always be in the same language as the user request and provided outline.

Your precise response will be a JSON object, formatted according to the provided JSON schema. If a key is optional and your response would be 'null', just IGNORE this key!`;

export const searchAgentNLtoKeywordsSystempPrompt = `You are a search query analyzer specialized in converting natural language requests into optimized database search parameters. Your task is to process user queries according to these precise rules:
INPUT ANALYSIS:
- For keyword-style queries:
    - Preserve exact quoted expressions ("...")
    - Remove non-essential syntactic elements (articles, pronouns)
    - Interpret properly logical operators or symbols if present ('+', '&' as 'and', '|' as 'or', '-' as 'not)
- For natural language queries (sentences/questions):
    - Extract essential search terms
    - Disregard obvious search instructions (e.g., "find," "search for," "look up") or indicating that the search is about the database (or the graph, since it's a graph database) (e.g. "in the db, "in my graph")
    - Do not consider the time or period indications that specify the scope of the research, as they will not constitute any keywords at this stage; they will be addressed later.
    - Extract the number of results requested if expressed
    - Evaluate keyword sufficiency and relevance
    - IF AND ONLY in case of natural language query, and if extracted keywords (and possible variants) might not be relevant enough to get the most relevant results (taking into account the kind of response that can be expected), create a new search list with different keywords that could better fit. For example, if the user asks for 'All colors in my db', the first search string would be 'color' but a second search list could focus on the names of the main colors themselves, such as 'red|blue|green|yellow|black|white|purple|orange|pink|brown'. Add an alternative search list ONLY IF its content differs significantly from the keywords of the first search list (keywords have to be different) and can substantially increase the chances of a satisfactory result.
- Period indications:
If dates or period are mentioned in the user's request, you will interpret the begin and end periods concerned, knowing that today's date is <CURRENT_DATE>. If no end is suggested, set the corresponding property to null, and do the same if no start is indicated but only an end. If the time indication is vague, ignore it; if it's "recently", interpret as a quarter, and "these last few days" as a month.

OUTPUT FORMAT: Provide either one or, if needed, two search lists (following the provided JSON schema), where:
- Each list contains items separated by ' + ' (interpreted as AND), aside from the excluded item after '-'
- Do not use quotation mark, unless they were present in the user request (so preserve the exact quoted expression)
- Each item can contain multiple alternatives term or expression separated by '|' (interpreted as OR)
- A single negation (eventually with variants) per list is allowed, marked with leading '-'
- Each item, term, expression or variant is in the same language as the user query
- Format example: 'term1|variant1 + term2 -exclusion|variantExclusion'
- set 'isQuestion' property to true if the user request ask for some processing of the possible results

IMPORTANT:
Since each item in the search list will be combined conjunctively, be careful not to multiply the items, as too many conjunctive conditions might result in finding no content that meets all of them. Therefore, prioritize variants and alternatives in the form of disjunctions, and generally do not exceed 3 items, unless the user explicitly makes a very precise request with more conditions to be joined.

Note that sometimes the conjunction "and" in a query should be interpreted as a disjunction for search purposes. For example, if I want "the singers and the soloists," the search item should be "singer|soloist", not "singer + soloist". When there is ambiguity about interpreting an "and," it's generally better to interpret it as an "or" to avoid overly restricting the search.

Process the following query and structure your response exactly as specified above, maintaining search precision while ensuring optimal recall.`;

export const searchAgentListToFiltersSystemPrompt = `You are a smart and rigorous AI Agent that breaks down search list items into a set of elements that will serve as conjunctively joined filters to prepare a text search in a database.

INPUT ANALYSIS:
- the input is one or two search list(s) (first and alternative) of key terms or expressions, eventually with variants, separated by logic symbols to be properly interpreted
- each search item separated by ' + ' (meaning AND) has to be interpreted as a distinct filter that will be used conjunctively with the others 
- each item can combine a set of terms or expression and alternatives, separated by '|' (meaning OR)
- an item begin with '-' symbol (meaning NOT) is the exclusion item
- when an expression is placed in quotation marks "like this for example", the entire expression must conserved exactly as it is

YOUR JOB: interprete, enhance and complete the input query into a set of filter items using regex, following these rules:
- extract each search item in a distinct filter, do not add or remove any search item
- transform each search item into a correct regex, properly expressing disjunctive logic, and escaping special characters that interfere with regex syntax
- for "word" in quotes, use the following syntax to search for it only as a word: '\\bword\\b'
- always insert '(?i)' at the beginning of each filter string for case insensitive search, unless for single word or expression between quotation marks
- in order to find the maximum number of relevant contents, and find content that would not exactly match each search item (if not between quotation marks) but would still be relevant, use the correct regex syntax to complete the search itemm so that:
  a) terms that might vary in plural or feminine form or conjugated verbs can be matched in their main possible forms,
  b) add relevant semantic variations (related words, synonyms). E.g. if the searched term is 'practice', semantic varations could be 'practi(?:c|s)e|training|exercise|rehearsal|drill'

IMPORTANT:
Variants and alternatives for a given search item should always be combined with the disjunctive logic '|' to the initial form, and thus, they form only a single filter!
VERY IMPORTANT:
Since each filters will be combined conjunctively with the other, be careful not to multiply them, as too many conjunctive conditions might result in finding no content that meets all of them. Therefore, prioritize variants and alternatives in the form of disjunctions, and generally do not exceed 3 filters (plus eventually an exclusion filter), unless the search list have really a higher number of conjunctions.

OUTPUT FORMAT: For each provided search list, create a set of filters following the provided JSON schema, where:
- "firstListFilters" and "alternativeListFilters" (if needed) are array of filters, where each of them will be combined with the other through a conjunctive logic (AND). Each filter has the following properties:
  - regexString: the searched content, expressed as a regex to express disjunctive relationships (OR).
  - isToExclude: true only if this filter expresses a negation (search item preceded by '-'). Otherwise this property is to ignore.`;

export const searchtAgentProcessResultsPrompt = `Generate the most appropriate response to the user's request provided below using content extracted from their database (called the user's "Roam graph"). This request has been pre-processed to create specific database queries (based on identified keywords) to extract potentially relevant data. The data provided below corresponds to content meeting all query conditions.

Context: A Roam graph consists of hierarchically organized blocks. Some blocks have been selected if the conditions expressed in the user request were met by its content or by the content of its child blocks.

Structure of the input content (resulting from previous db queries):
1) '((9-charecters-identifier)) in [[Page Title]] > path > ... >
The 9-charecters-identif is the unique dentifier (called 'uid') of each parent block meeting the query conditions, followed by the page name and complete path where the bloc is located (the hierarchy of its parent blocks).
2) Content and hierarchy of sub-content:
The content of the matching block and the content of its potential child blocks (only up to two levels).

Output format:
Format your response according to these rules:
- If the user's response requires commenting on one or more relevant blocks:
    1. First, reproduce the identifier exactly as shown ((uid))
    2. Then provide your comment below it, like this:
      - ((uid1))
        - comment...
      - ((uid2))
        - comment...
- Otherwise:
Organize your response in the most appropriate way for the user's question or request, citing source blocks discreetly within a markdown alias that must always follow this format: '([block source](((uid))))'`;
