export interface RoamContext {
  linkedRefs?: boolean;
  linkedPages?: boolean;
  linkedRefsArgument?: string[]; // Array of page titles for linked references
  sidebar?: boolean;
  mainPage?: boolean; // Optional - not in context menu but used elsewhere
  page?: boolean;
  pageViewUid?: string | null; // Current page UID (even if view is a block)
  pageArgument?: string[]; // Array of page titles
  logPages?: boolean;
  logPagesArgument?: number; // Number of previous daily notes to include
  block?: boolean;
  blockArgument?: string[]; // Array of block UIDs
  query?: boolean; // Query results context
  queryBlockUid?: string; // UID of the query block to load results from
  siblings?: boolean; // Include sibling blocks and their children
  path?: boolean; // Include hierarchical breadcrumb path
  pathDepth?: number; // Number of ancestors to include (0 = full path)
}
