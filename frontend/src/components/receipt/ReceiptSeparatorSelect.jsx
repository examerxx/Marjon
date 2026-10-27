import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../Icon";
import { normalizeSeparator } from "./receiptLayout";
import { t } from "../../i18n/t";

// Разделитель чека — собственный listbox вместо нативного <select>: системный
// попап рисовался синей подсветкой ОС и выпадал из дизайна MARJON. Здесь те же
// девять пресетов, сгруппированных по рисунку, но каждый вариант показывает
// ЖИВУЮ линию — выбрать «на глаз», а не по названию.
const PATTERNS = [
  { value: "dashed", label: "Прерывистые" },
  { value: "solid", label: "Сплошные" },
  { value: "stars", label: "Звёздочки" },
];
const WEIGHTS = [
  { value: "thin", label: "Тонкие" },
  { value: "medium", label: "Средние" },
  { value: "bold", label: "Жирные" },
];

const OPTIONS = PATTERNS.flatMap((pattern) => WEIGHTS.map((weight) => ({
  key: `${pattern.value}:${weight.value}`,
  label: `${pattern.label} · ${weight.label}`,
  patternLabel: pattern.label,
  weightLabel: weight.label,
  pattern: pattern.value,
  weight: weight.value,
})));
const GROUPS = PATTERNS.map((pattern) => ({
  label: pattern.label,
  options: OPTIONS.filter((option) => option.pattern === pattern.value),
}));

const MENU_WIDTH = 232;
// Все девять вариантов + три заголовка = ~360px: панель открывается целиком,
// без внутренней прокрутки и «крутилки». max-height остаётся страховкой для
// низких окон, где список физически не помещается.
const MENU_MAX_HEIGHT = 432;

export default function ReceiptSeparatorSelect({ value, onChange, disabled = false }) {
  const current = normalizeSeparator(value);
  const currentKey = `${current.pattern}:${current.weight}`;
  const selectedIndex = OPTIONS.findIndex((option) => option.key === currentKey);
  const selected = OPTIONS[selectedIndex] || OPTIONS[0];

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const [activeIndex, setActiveIndex] = useState(Math.max(selectedIndex, 0));
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const uid = useId();
  const listId = `${uid}-listbox`;
  const canPortal = typeof document !== "undefined";

  function updatePosition() {
    const anchor = triggerRef.current;
    if (!anchor || typeof window === "undefined") return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(MENU_WIDTH, rect.width || 0);
    const left = Math.max(8, Math.min(rect.left || 8, window.innerWidth - width - 8));
    const below = window.innerHeight - (rect.bottom || 0) - 10;
    const above = (rect.top || 0) - 10;
    // Вверх открываемся только когда внизу совсем тесно, а сверху места
    // заметно больше — иначе меню прыгало бы через шапку на пустом экране.
    const openUp = below < 220 && above > below;
    const maxHeight = Math.max(150, Math.min(MENU_MAX_HEIGHT, openUp ? above : below));
    setPosition(openUp
      ? { left, width, maxHeight, bottom: window.innerHeight - (rect.top || 0) + 6 }
      : { left, width, maxHeight, top: (rect.bottom || 0) + 6 });
  }

  // Позиция считается ДО отрисовки: меню появляется сразу в финальных
  // координатах, без кадра в левом верхнем углу экрана.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }
    updatePosition();
    const onPointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onReflow = () => updatePosition();
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", onReflow);
    document.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", onReflow);
      document.removeEventListener("scroll", onReflow, true);
    };
  }, [open]);

  function openMenu() {
    if (disabled) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function commit(index) {
    const option = OPTIONS[index];
    if (option) onChange({ pattern: option.pattern, weight: option.weight });
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (disabled) return;
      if (!open) {
        openMenu();
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => {
        const next = index + step;
        if (next < 0) return OPTIONS.length - 1;
        if (next >= OPTIONS.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (disabled) return;
      if (!open) {
        openMenu();
        return;
      }
      commit(activeIndex);
    }
  }

  const menu = open && position && canPortal ? createPortal(
    <div
      ref={menuRef}
      id={listId}
      className="receipt-separator-select__menu"
      role="listbox"
      aria-label={t("components.receipt.receiptseparatorselect.stil_razdeliteley")}
      style={{ left: position.left, width: position.width, maxHeight: position.maxHeight,
               ...(position.top != null ? { top: position.top } : { bottom: position.bottom }) }}
    >
      {GROUPS.map((group) => (
        <div key={group.label} className="receipt-separator-select__group" role="group" aria-label={t(group.label)}>
          <p className="receipt-separator-select__group-label">{t(group.label)}</p>
          {group.options.map((option) => {
            const index = OPTIONS.indexOf(option);
            const isSelected = option.key === currentKey;
            return (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`receipt-separator-select__option${isSelected ? " is-selected" : ""}${index === activeIndex ? " is-active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(index)}
              >
                <span className="receipt-separator-select__option-label">{t(option.weightLabel)}</span>
                <span
                  className={`receipt-separator-select__sample receipt-separator-select__sample--${option.pattern}`}
                  data-weight={option.weight}
                  aria-hidden="true"
                >
                  {option.pattern === "stars" ? "* * * * * * *" : null}
                </span>
                <span className="receipt-separator-select__check" aria-hidden="true">
                  {isSelected ? <Icon name="bi-check2" size={14} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`receipt-separator-select${open ? " is-open" : ""}`} ref={rootRef}>
      <span>{t("components.receipt.receiptseparatorselect.razdeliteli")}</span>
      <button
        type="button"
        ref={triggerRef}
        className="receipt-separator-select__trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={t("components.receipt.receiptseparatorselect.stil_razdeliteley")}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className="receipt-separator-select__value">{t(selected.patternLabel)} · {t(selected.weightLabel)}</span>
        <Icon name="bi-chevron-down" size={14} className="receipt-separator-select__chevron" />
      </button>
      {menu}
    </div>
  );
}
