import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

// Shared selected-label formatter for OWNER report multi-select triggers
// (Orders, Dishes, Tables — one algorithm, no per-page copies).
// Empty → "" (the caller shows its muted placeholder). Otherwise EVERY
// selected label is joined with ", " in DROPDOWN OPTION ORDER (never a count,
// never "+N", never truncated): duplicated ids collapse to one label, and a
// selected id missing from options still renders truthfully as its raw value.
export function formatSelectedLabels(selected, options) {
  const seen = new Set();
  const labels = [];
  for (const option of options || []) {
    if ((selected || []).includes(option.value) && !seen.has(option.value)) {
      seen.add(option.value);
      labels.push(option.label);
    }
  }
  for (const value of selected || []) {
    if (!seen.has(value)) {
      seen.add(value);
      labels.push(value);
    }
  }
  return labels.join(", ");
}

// Shared OWNER multi-select filter primitive for report pages (Dishes, Tables).
// Ported faithfully from the approved Orders `FilterMultiSelect`: same markup
// and classes (`orders-filter-select__*` panel + Z-report `owner-msel__*`
// checkbox rows, same approved CSS), same keyboard contract, same exit
// animation, same parent-owned single-open orchestration. Only the trigger
// summary differs per product rule: empty → gray placeholder, exactly one →
// trigger always shows every selected label (see formatSelectedLabels).
//
// Checking a row toggles the page's filter draft at once (OR within the
// dimension); the page-level «Фильтровать» still commits the draft into
// appliedFilters. Toggling never issues a request and never closes the panel.
export default function ReportMultiSelect({
  filterKey, label, placeholder, options, selected, onToggle,
  disabled = false, open, closing = false, onOpen, onClose, onExitComplete,
}) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const valueRef = useRef(null);
  const listId = `report-filter-${filterKey}-menu`;
  const selection = Array.isArray(selected) ? selected : [];
  const summary = formatSelectedLabels(selection, options);

  // When the selection empties (page-level Clear), reset the value viewport
  // to its logical start so no stale scrolled text lingers.
  useEffect(() => {
    if (selection.length === 0 && valueRef.current) {
      valueRef.current.scrollLeft = 0;
    }
  }, [selection.length]);

  // Every open starts keyboard navigation from the top.
  useEffect(() => {
    if (open) setActiveIndex(-1);
  }, [open]);

  // Outside click just closes; the selection is already the page's draft state.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) {
      if (!rootRef.current?.contains(event.target)) onClose();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose]);

  function toggle(value) {
    onToggle(value);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      if (open) { event.preventDefault(); event.stopPropagation(); onClose(); triggerRef.current?.focus(); }
      return;
    }
    if (event.key === "Tab") { if (open) onClose(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { onOpen(); return; }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => {
        const next = i + step;
        if (next < 0) return (options || []).length - 1;
        if (next >= (options || []).length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) { onOpen(); return; }
      if (activeIndex >= 0 && (options || [])[activeIndex]) toggle(options[activeIndex].value);
    }
  }

  function handlePanelAnimationEnd(event) {
    if (closing && event.target === event.currentTarget) onExitComplete();
  }

  return (
    <div className={`orders-filter-select${open ? " is-open" : ""}`} ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={triggerRef}
        className={`orders-filter-select__trigger${summary ? "" : " is-placeholder"}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
        aria-label={label}
        title={summary || undefined}
        disabled={disabled}
        onClick={() => (open ? onClose() : onOpen())}
      >
        <span ref={valueRef} className="orders-filter-select__value">{summary || placeholder}</span>
        <span className="orders-filter-select__chevron" aria-hidden="true"><Icon name="bi-chevron-down" size={16} /></span>
      </button>
      {open || closing ? (
        <div
          className={`orders-filter-select__panel${closing ? " is-closing" : ""}`}
          aria-hidden={closing ? true : undefined}
          {...(closing ? { inert: true } : {})}
          onAnimationEnd={closing ? handlePanelAnimationEnd : undefined}
        >
          <ul className="orders-filter-select__menu" id={listId} role="listbox" aria-multiselectable="true" aria-label={label}>
            {(options || []).map((option, index) => {
              const checked = selection.includes(option.value);
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={checked}
                    className={`orders-filter-select__option owner-msel__option${checked ? " is-checked" : ""}${index === activeIndex ? " is-active" : ""}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => toggle(option.value)}
                  >
                    <span className="owner-msel__check" aria-hidden="true">
                      {checked ? (
                        <svg className="owner-msel__tick" viewBox="0 0 16 16" width="12" height="12">
                          <path d="M13 4.5 6.5 11 3 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : null}
                    </span>
                    <span className="owner-msel__option-label">{option.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
