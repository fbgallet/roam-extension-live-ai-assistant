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

## Smart Search Agent (experimental 🧪)

This agent first interprets a natural language request and formats it into a search list supporting regex, which will then be converted into a set of Datomic queries to be executed via the Roam API and filtered according to the criteria provided in the initial request (period, expected number of results, random, etc.). These queries enable testing conditions across <del>the entire hierarchy (or, optionally, within the same block or on one or two levels of children), in both directions or in a specific direction, or even for sibling blocks (within a limit of two conditions)</del>2 children level (working on optimization of queries to search on entire hierarchy and sibling blocks).
⚠️ Currently, the queries are limited to text search ([[page title]] or #tag are interpreted as text, not as reference).

This method allows for more advanced searches in principle, but processing will generally be slower than with previous agents, and even more so as the graph becomes larger (which is why this is only an experimental Agent, still to be optimized. ⚠️ It can potentially cause a freeze in the graph during complex searches in large graphs ⚠️).

The request can be a sentence, a question, or a set of keywords. Here are the specific syntactic elements that the Agent is capable of understanding:

- same logical symbols as those supported by Natural language Query Agent: `+ & | -`
- `word~` for semantic variations arount the word
- Regex support. E.g. `word\d{3}` or `^Only this$`
- hierarchically directed conditions: you can ask for some condition in parent block and other condition in children block by natural language or using the following symbols. Either you search for all blocks (parents) with some condition in children, or you search for all blocks with some condition in parents. You can only use one of this symbol, and only once:
  - `>`: all blocks matching condition defined on the left, that have children (descendant) with condition on the right.
  - `<`: all blocks matching condition defined on the left, that have parent (ascendant) with condition on the right
    For example, 'All blocks mentioning [[recipe]] with mushroom in one of its children' is equivalent to '[[recipe]] > mushroom'
- Depth limitation: by default, the conditions will be tested in all the hierarchy (from first parent to last children), but you can limit the depth with a natural language instruction so:
  - all condition have to be combined in the same block
  - 1 level: conditon have to be combined in a block and its direct children
  - 2 levels of children
- the number of results requested
  - by default, they are sorted from the most recent edition date
  - you can request random results
- period of time limitation
- pages limitation: only on DNP or only on pages matching a given condition in ther title

## Ask to your graph...

You ask a question or request to process blocks that meet certain criteria (these blocks will not be directly affected, they are only extracted, then their content is processed). The search relies on the Smart Search Agent: its results (up to a maximum of 100, including their direct parent and first child) are provided as context to an LLM for a pre-selection of a maximum of 20 most relevant blocks based on the query. The most relevant blocks (including all their parents and children on 3 levels) then serve as context for processing the initial request.

⚠️ Important to know: this is the only agent among Query Agents that will receive data directly from your graph. If you do not want a non-local LLM to use your data, do not use this agent (you can safely use the previous agents as they only access your query, with all processing done locally afterwards).

It is recommended to first use the Smart Search Agent to test your query and see if it captures relevant data. From Smart Search Agent results, you can also ask a question about the results (by clicking on the magnifying glass that appears to the right of the results), which will indirectly call "Ask to my graph".
