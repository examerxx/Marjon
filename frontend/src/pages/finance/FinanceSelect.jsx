import { useEffect, useId, useRef, useState } from "react";
import Icon from "../../components/Icon";

export default function FinanceSelect({ label, value, onChange, options, placeholder, disabled = false }) {
  const id = useId();
  const root = useRef(null);
  const trigger = useRef(null);
  const [open, setOpen] = useState(false);
  const selected = options.findIndex(option => String(option.value) === String(value));
  const [highlight, setHighlight] = useState(Math.max(0, selected));
  useEffect(() => {
    if (!open) return undefined;
    const close = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => {
    if (open) root.current?.querySelector(`[data-option-index="${highlight}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [highlight, open]);
  const choose = index => { onChange(options[index].value); setOpen(false); trigger.current?.focus(); };
  const onKey = event => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key === "Tab") { setOpen(false); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!open) { setHighlight(Math.max(0, selected)); setOpen(true); return; }
      setHighlight(index => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if ((event.key === "Enter" || event.key === " ") && open) { event.preventDefault(); choose(highlight); }
  };
  return <div className="finance-select-field" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <span className="finance-select-label" id={`${id}-label`}>{label}</span>
    <button ref={trigger} type="button" className={`finance-select-trigger${open ? " is-open" : ""}`} data-empty={selected < 0} role="combobox" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-activedescendant={open ? `${id}-option-${highlight}` : undefined} disabled={disabled || !options.length} onKeyDown={onKey} onClick={() => { setHighlight(Math.max(0, selected)); setOpen(current => !current); }}>
      <span id={`${id}-value`}>{options[selected]?.label ?? placeholder ?? options[0]?.label}</span><Icon name="bi-chevron-down" size={14} />
    </button>
    {open && !disabled ? <div className="finance-select-list" id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`}>{options.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={String(option.value) === String(value)} data-option-index={index} className={`finance-select-option${highlight === index ? " is-highlighted" : ""}`} onPointerDown={event => event.preventDefault()} onPointerMove={() => setHighlight(index)} onClick={() => choose(index)}><span>{option.label}</span>{String(option.value) === String(value) ? <Icon name="bi-check2" size={16} /> : null}</div>)}</div> : null}
  </div>;
}
