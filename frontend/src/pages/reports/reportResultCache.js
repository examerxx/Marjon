// Session-only, in-memory cache of the LAST SUCCESSFUL REAL report result,
// keyed per report type + request identity (date range + applied filters).
// Purpose: when the user returns to a report subcategory already loaded this
// SPA session, render the real rows / real empty-state instantly and revalidate
// in the background — no blank tbody, no "Загрузка…" flash, no empty-PNG delay.
//
// Truthful by construction:
//  - only successful REAL responses are written (never loading/error/guesses);
//  - the key includes the request identity, so a different period/filter combo
//    (never loaded) is a cache MISS and shows a truthful loading state;
//  - no localStorage / sessionStorage — this is wiped on full reload.
const store = new Map();

export function reportCacheKey(type, identity) {
  return `${type}::${JSON.stringify(identity ?? null)}`;
}

export function readReportCache(key) {
  return store.has(key) ? store.get(key) : null;
}

// `payload` is the report's own success shape (e.g. { rows } or { rows, totals });
// stored verbatim and returned as-is by readReportCache.
export function writeReportCache(key, payload) {
  store.set(key, payload);
}

// Test-only helper so unit tests start from a clean slate.
export function __resetReportCache() {
  store.clear();
}
