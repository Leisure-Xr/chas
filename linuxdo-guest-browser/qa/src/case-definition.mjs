export const PRODUCTS = Object.freeze(['shared', 'vscode', 'pycharm']);
export const PLATFORMS = Object.freeze(['darwin', 'win32']);
export const PRIORITIES = Object.freeze(['P0', 'P1', 'P2']);
export const CASE_TYPES = Object.freeze(['automated', 'guided']);
export const RESULT_STATUSES = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'SKIP']);

export function defineCase(definition) {
  return Object.freeze({
    capabilities: [],
    preconditions: [],
    steps: [],
    ...definition,
    platforms: Object.freeze([...(definition.platforms || PLATFORMS)]),
    capabilities: Object.freeze([...(definition.capabilities || [])]),
    preconditions: Object.freeze([...(definition.preconditions || [])]),
    steps: Object.freeze((definition.steps || []).map(step => Object.freeze({ ...step })))
  });
}
