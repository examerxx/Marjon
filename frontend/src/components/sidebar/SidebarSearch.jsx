import { useMemo, useRef, useState, useEffect } from "react";
import Icon from "../Icon";

// OWNER sidebar navigation search. Scope is intentionally the OWNER navigation
// tree only (parents + children from navConfig) — NOT a fabricated global data
// search. Data source is the authoritative visibleNavItems passed by Sidebar;
// accordion open-state reuses the existing pinned/open actions.
function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function buildIndex(navItems) {
  const entries = [];
  for (const item of navItems) {
    entries.push({
      id: `p:${item.key}`, type: "parent", key: item.key, label: item.label,
      icon: item.icon, to: item.to || "", parentKey: item.key, parentLabel: "",
    });
    for (const child of item.children || []) {
      entries.push({
        id: `c:${item.key}:${child.key}`, type: "child", key: child.key,
        label: child.label, icon: child.icon || item.icon, to: child.to || "",
        parentKey: item.key, parentLabel: item.label,
      });
    }
  }
  return entries;
}

function scoreEntry(entry, q) {
  const label = normalize(entry.label);
  const idx = label.indexOf(q);
  if (idx === -1) return null;               // no-match sentinel (kept distinct from a valid 0/negative score)
  let score = idx === 0 ? 0 : 100 + idx;     // exact-start ranks before mid-substring
  if (entry.type === "parent") score -= 0.5; // parents slightly ahead on ties (no collision with no-match)
  return score;
}

export default function SidebarSearch({ navItems, navigate, setPinnedMenu, setOpenMenu, collapsed = false }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef(null);
  const resultsRef = useRef(null);
  const inputRef = useRef(null);

  const index = useMemo(() => buildIndex(navItems), [navItems]);
  const q = normalize(query);
  const results = useMemo(() => {
    if (!q) return [];
    return index
      .map((e) => ({ e, s: scoreEntry(e, q) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => a.s - b.s || a.e.label.localeCompare(b.e.label))
      .slice(0, 10)
      .map((x) => x.e);
  }, [index, q]);

  const showResults = !collapsed && open && q.length > 0;
  // Keep the last real result content during the closing layout transition.
  // Filtering and activation still use the current canonical results above.
  const [displayResults, setDisplayResults] = useState(results);
  if (showResults && displayResults !== results) setDisplayResults(results);

  useEffect(() => { setHighlight(0); }, [q]);
  useEffect(() => { if (collapsed) setOpen(false); }, [collapsed]);
  useEffect(() => {
    if (!showResults) return undefined;
    function onDocDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)
        && !resultsRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [showResults]);

  function clearAll() { setQuery(""); setOpen(false); setHighlight(0); }

  function activate(entry) {
    if (!entry) return;
    if (entry.type === "child" && entry.to) {
      setPinnedMenu(entry.parentKey); setOpenMenu(entry.parentKey); navigate(entry.to);
    } else if (entry.type === "parent" && entry.to) {
      setPinnedMenu(""); setOpenMenu(""); navigate(entry.to);
    } else if (entry.type === "parent") {
      setPinnedMenu(entry.key); setOpenMenu(entry.key);
    }
    clearAll();
  }

  function onKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault(); if (showResults) setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault(); if (showResults) setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter") {
      if (showResults && results[highlight]) { event.preventDefault(); activate(results[highlight]); }
    } else if (event.key === "Escape") {
      if (query) { event.preventDefault(); clearAll(); inputRef.current?.focus(); }
    }
  }

  return (
    <>
    <div className="sidebar-search" ref={rootRef} inert={collapsed} aria-hidden={collapsed || undefined}>
      <div className="sidebar-search__field">
        <Icon name="bi-search" size={16} className="sidebar-search__icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          className="sidebar-search__input"
          placeholder="Поиск"
          aria-label="Поиск по навигации"
          role="combobox"
          aria-expanded={showResults}
          aria-controls="sidebar-search-results"
          aria-autocomplete="list"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => { if (q) setOpen(true); }}
          onKeyDown={onKeyDown}
        />
        {query ? (
          <button
            type="button"
            className="sidebar-search__clear"
            aria-label="Очистить поиск"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { clearAll(); inputRef.current?.focus(); }}
          >
            <Icon name="bi-x-lg" size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
      {/* Separate flow space preserves the input's original collapse sizing. */}
      <div ref={resultsRef} className={`sidebar-search__results-slot${showResults ? " is-open" : ""}`} inert={!showResults} aria-hidden={!showResults}>
        <div className="sidebar-search__results-clip">
        <div className="sidebar-search__results" id="sidebar-search-results" role="listbox" aria-label="Результаты поиска">
          {displayResults.length === 0 ? (
            <div className="sidebar-search__empty">
              <div className="sidebar-search__empty-title">Ничего не найдено</div>
              <div className="sidebar-search__empty-sub">Попробуйте другой запрос</div>
            </div>
          ) : displayResults.map((entry, i) => (
            <button
              key={entry.id}
              type="button"
              role="option"
              aria-selected={i === highlight}
              className={`sidebar-search__result ${i === highlight ? "is-active" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => activate(entry)}
            >
              <span className="sidebar-search__result-icon"><Icon name={entry.icon || "bi-circle"} size={17} /></span>
              <span className="sidebar-search__result-text">
                <span className="sidebar-search__result-label">{entry.label}</span>
                {entry.parentLabel ? <span className="sidebar-search__result-parent">{entry.parentLabel}</span> : null}
              </span>
            </button>
          ))}
        </div>
        </div>
      </div>
    </>
  );
}
