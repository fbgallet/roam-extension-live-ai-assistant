# Query Agents in Live AI Assistant

The four agents presented below make Roam's advanced features accessible to all users by interpreting queries in natural language (eventually with a few simple symbols) into properly formatted queries.

Ideally, users simply need to write their request in natural language. The agents will identify the relevant elements and query logic. The user will only need to learn to recognize which agent will best respond to their expectations in different situations. But in practice, it is also useful to know a bit more about the main features offered in order to write simpler queries that provide more reliable results.

## Natural language Query Agent

This agent generate native Roam queries of the type `{{[[query]]: {and: [[ex-A]] [[ex-B]]}}}`, which allow combining searches on page titles, text, time periods, and create/edit user. Roam queries capture results that meet conditions across their entire path (including parents and children), not just within the same block.

- To differentiate between search on page title and simple text search, use the standard syntax to mention a [[page title]] and write simple text directly without quotes. E.g.: 'Which [[meeting]] with [[John]], about frontend or UX, is not [[DONE]]?'
- In natural language, clearly express logical articulations (and, or, not...) or use the following symbols:
  - space or `&` or `+` as and,
  - `|` as or,
  - `-`as not.
    For example: [[meeting]] & [[John]] & frontend|UX -[[DONE]]
- Text search will work better if you target multiple words separately rather than a whole expression (Smart Search is more suitable for searching expressions).
- **Fuzzy search**: to search for different grammatical variants of a word, request a fuzzy search o radd the `*` symbol at the end of the word. E.g. 'pratice\*' will search also for 'practise', 'practising'
- **Semantic search**: to expand the search to synonymous or related terms, add the `~` symbol, or a double `~~` for a broader semantic search. E.g.: 'practice~' can search also for 'workout', 'exercise', 'drill'...
- To delimit a time period, you can express any relative period in natural language (e.g., "last month") or with specific dates.

Currently, the most reliable results are obtained with OpenAI `gpt-4o` and Groq `llama-3.3-70b-versatile` (Anthropic seems less reliable here)

## Natural language :q Datomic Agent

This agent generate Datalog Datomic queries in the :q format whose results are displayed in a sortable table. They allow for expressing a more complex and specific logic related to Roam's database structure, as you can target database attributes concerning different properties of blocks and pages and their hierarchical relationships.

However, this makes their format much more complex, and generative AIs will have more difficulty producing satisfactory results, especially as the required logic becomes more complex. In case of failure, it is recommended to retry once or twice. Otherwise, you should simplify the query or make its logic more explicit.

Another problem with their complexity is that users who have not learned Datalog query logic will not be able to correct or improve the results of generative AIs, unlike what can be easily done with Roam queries.

To make your requests as clear and effective as possible, use as keywords the concepts that designate the main components of Roam: block, page, title, content, parent, child, attribute, etc.

Exemple of natural language request: Blocks starting with 'Once upon a time' in pages with 'story' in title

Result will be:

````
:q "Blocks starting with 'Once upon a time' in pages with 'story' in title"
[:find ?block-uid ?page-title
 :where
 [?page :node/title ?page-title]
 [(clojure.string/includes? ?page-title "story")]
 [?block :block/page ?page]
 [?block :block/string ?block-string]
 [(clojure.string/starts-with? ?block-string "Once upon a time")]
 [?block :block/uid ?block-uid]]```

````

## Smart Search Agent

## Ask to your graph...
