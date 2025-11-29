# Roam tips

## Hidden / not documented features

- `{{or: option A|option B}}` insert a dropdown component to select from multiple options and display only the chosen one
- `{{=:text|content of the tooltip}}` open a tooltip displaying some hidden content clicking on the text (click again to close the tooltip)
- `{{orphans}}` show orphaned blocks
- `{{x-unread}}` notification / unread blocks feature
- `{{x-template-button: ((roam/template block ref))}}` insert a button for the referenced template
- `{{x-daily-template: ((roam/template block ref))}}` daily template: insert a `+` button in any daily note title to insert the referenced template (only on empty daily notes)
- `{{iframe: URL}}` display the correspoding web page (if this page allows iframe)
- `{{a}}` anonomous slider for shared graphs
- `{{chart: ATTR_PAGE_TO_CHART}}` ???
- `{{datalog-block-query: Datalog query}}` run and display the results of the Datalog query in the format of native Roam queries
- `:document` open an inline WYSIWYG text editor
- `:q Datalog query` run and display the results of the appended or referenced Datalog query in a sortable table
