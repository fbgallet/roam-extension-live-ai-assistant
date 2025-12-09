# Roam tips

## Hidden / undocumented features

- `{{or: option A|option B}}` inserts a dropdown component to select from multiple options and display only the chosen one
- `{{=:text|content of the tooltip}}` opens a tooltip displaying some hidden content clicking on the text (click again to close the tooltip)
- `{{orphans}}` shows orphaned blocks
- `{{x-unread}}` notification / unread blocks feature
- `{{x-template-button: ((roam/template block ref))}}` inserts a button for the referenced template
- `{{x-daily-template: ((roam/template block ref))}}` daily template: inserts a `+` button in any daily note title to insert the referenced template (only on empty daily notes)
- `{{iframe: URL}}` displays the correspoding web page (if this page allows iframe)
- `{{a}}` anonomous slider for shared graphs
- `{{chart: ATTR_PAGE_TO_CHART}}` ???
- `{{datalog-block-query: Datalog query}}` runs and displays the results of the Datalog query in the format of native Roam queries
- `:q Datalog query` runs and displays the results of the appended or referenced Datalog query in a sortable table
- `:document` opens an inline WYSIWYG text editor
- `#.tag` creates a .tag CSS class to easily apply some style
- native Roam tag styles available (see [help graph here](https://roamresearch.com/#/app/help/page/Nt3syyeHc) for the first 3):
  - `#.rm-E` displays children blocks horizontaly
  - `#.rm-g` hides the block when children are expanded
  - `#.rm-hide` hides the block when collapsed, replaced by a clickable bar to open it (useful to make some info availabl without cluttering things up)
  - `#.rm-hide-for-readers` hides the block and it's descendants for people who only have read access to that block.
  - `#.rm-grid` display children as a grid with multiple blocks on the same row (adapt to screen size)
