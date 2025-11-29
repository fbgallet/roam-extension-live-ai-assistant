# Roam tips

## Hidden / undocumented features

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
- `#.tag` create a .tag CSS class to easily apply some style
- native Roam tag styles available (see [help graph here](https://roamresearch.com/#/app/help/page/Nt3syyeHc)):
  - `#.rm-grid` display children as a grid with multiple blocks on the same row (adapt to screen size)
  - `#.rm-E` displays children blocks horizontaly
  - `#.rm-g` hides the block when children are expanded
  - `#.rm-hide` hides the block
  - `#.rm-hide-for-readers` hides the block and it's descendants for people who only have read access to that block.
