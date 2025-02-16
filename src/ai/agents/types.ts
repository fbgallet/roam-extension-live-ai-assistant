export interface RoamContext {
  linkedRefs: boolean;
  sidebar: boolean;
  mainPage: boolean;
  logPages: boolean;
  block?: boolean;
  blockArgument?: string[];
  page?: boolean;
  pageArgument?: string[];
}
