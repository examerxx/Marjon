import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../../components/Icon";
import Toast from "../../components/Toast";

// Одиночный dropdown формы блюда (V18): Категория / Принтер.
// Та же визуальная семья, что фильтр каталога и Reports (триггер
// orders-filter-select__*, панель orders-filter-select__panel, exit-анимация
// через is-closing + onAnimationEnd, клавиатура Escape/Enter/Space/стрелки,
// закрытие по outside-click). Отличия от фильтра-мультиселекта: одиночный
// выбор canonical ID (пусто = null, плейсхолдер вместо catch-all опции),
// клик сразу фиксирует значение и закрывает панель.
// searchable: длинные справочники (категории) получают строку поиска в панели —
// без неё нужную категорию приходится искать прокруткой.
export default function DishSingleSelect({
  label = "",
  placeholder = "",
  options = [],
  value = "",
  onChange,
  disabled = false,
  loading = false,
  disabledLabel = "",
  // Пустой список — не молчаливая пустая панель, а честная подпись:
  // иначе поле выглядит сломанным (баг «в сете не видно блюд»).
  emptyLabel = "",
  onCreateNew = null,
  createLabel = "+ Новая категория",
  searchable = false,
  searchPlaceholder = "Поиск…",
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState("");
  const [createSaving, setCreateSaving] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const menuRef = useRef(null);
  // Откреплённая панель: внутри .dish-recipes-dialog и .wh-inv-modal — их окна
  // несут transform (motion / settings-modal-in), а тело overflow:auto:
  // inline-панель там режется краями окна. Панель остаётся в DOM
  // (scoped-стили работают), но position:fixed с координатами от окна диалога
  // (containing block = окно, не вьюпорт). Везде иначе — прежний absolute
  // (проверено вживую).
  const [panelFixed, setPanelFixed] = useState(null);

  useEffect(() => {
    if (!open && !closing) return undefined;
    function update() {
      const trigger = triggerRef.current;
      const host = trigger?.closest?.(".dish-recipes-dialog, .wh-inv-modal");
      if (!trigger?.getBoundingClientRect || !host?.getBoundingClientRect) {
        setPanelFixed(null);
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const next = {
        top: rect.bottom - hostRect.top + 6,
        left: rect.left - hostRect.left,
        width: rect.width,
      };
      setPanelFixed((previous) => previous && previous.top === next.top && previous.left === next.left && previous.width === next.width ? previous : next);
    }
    function onScroll(event) {
      // Scrolling the menu does not move its trigger. Avoid layout reads and
      // React state updates for every tick inside this dropdown.
      if (panelRef.current?.contains(event.target)) return;
      update();
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, closing]);

  useEffect(() => {
    const panel = panelRef.current;
    const menu = menuRef.current;
    if ((!open && !closing) || !panel || !menu) return undefined;
    const onWheel = (event) => {
      if (event.ctrlKey) return; // Preserve native browser zoom.
      event.stopPropagation();
      const horizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const delta = horizontal ? (event.deltaX || event.deltaY) : event.deltaY;
      if (!delta) return;
      const offset = horizontal ? menu.scrollLeft : menu.scrollTop;
      const maximum = horizontal ? menu.scrollWidth - menu.clientWidth : menu.scrollHeight - menu.clientHeight;
      // Native scrolling remains smooth inside the list. At either boundary
      // (including a short/empty list), consume the wheel rather than letting
      // Chrome scroll the recipe body or catalog underneath the dropdown.
      if (maximum <= 0 || (delta < 0 && offset <= 0) || (delta > 0 && offset >= maximum - 1)) {
        event.preventDefault();
      }
    };
    panel.addEventListener("wheel", onWheel, { passive: false });
    return () => panel.removeEventListener("wheel", onWheel);
  }, [open, closing]);
  const listId = `dish-form-${String(label).toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-")}-menu`;
  const selected = (options || []).find((item) => item.value === value) || null;
  const shownPlaceholder = loading ? "Загрузка…" : (disabled && disabledLabel ? disabledLabel : placeholder);

  // Поиск по подписи опции: регистр и раскладка не важны, обрезка пробелов
  // снимает «случайный» пробел в начале. Пустой запрос = весь список.
  const visibleOptions = useMemo(() => {
    const term = String(query || "").trim().toLowerCase();
    if (!searchable || !term) return options;
    return options.filter((option) => String(option?.label ?? "").toLowerCase().includes(term));
  }, [options, query, searchable]);

  useEffect(() => {
    if (open) {
      setActiveIndex(-1);
      setIsCreating(false);
      setNewName("");
      setCreateError("");
      setQuery("");
    }
  }, [open ]);

  // Панель с поиском открывается с фокусом в строке поиска — можно сразу
  // печатать, не наводя мышь на список.
  useEffect(() => {
    if (open && searchable) searchRef.current?.focus({ preventScroll: true });
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) {
      if (!rootRef.current?.contains(event.target)) requestClose();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  function requestClose() {
    if (!open || closing) return;
    setClosing(true);
  }

  function handlePanelAnimationEnd(event) {
    if (closing && event.target === event.currentTarget) {
      setOpen(false);
      setClosing(false);
    }
  }

  function pick(nextValue) {
    if (disabled || loading) return;
    // Повторный клик по выбранной галочке снимает выбор (пусто + плейсхолдер).
    onChange(nextValue === value ? "" : nextValue);
    requestClose();
  }

  async function submitCreate() {
    const name = String(newName || "").trim();
    if (!name) {
      setCreateError("Введите название.");
      return;
    }
    if (createSaving) return;
    setCreateSaving(true);
    setCreateError("");
    try {
      await onCreateNew(name);
      setIsCreating(false);
      setNewName("");
      requestClose();
    } catch (err) {
      setCreateError(err?.response?.data?.detail || err?.message || "Не удалось создать.");
    } finally {
      setCreateSaving(false);
    }
  }

  function onKeyDown(event) {
    if (disabled || loading) return;
    // Ввод в строке поиска/создания — это текст, а не хоткеи селекта.
    if (event.target?.tagName === "INPUT") return;
    if (event.key === "Escape") {
      if (open) { event.preventDefault(); event.stopPropagation(); requestClose(); triggerRef.current?.focus(); }
      return;
    }
    if (event.key === "Tab") { if (open) requestClose(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      const total = visibleOptions.length + (onCreateNew && !isCreating ? 1 : 0);
      if (total === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => {
        const next = i + step;
        if (next < 0) return total - 1;
        if (next >= total) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      if (activeIndex >= 0 && visibleOptions[activeIndex]) pick(visibleOptions[activeIndex].value);
      else if (onCreateNew && !isCreating && activeIndex === visibleOptions.length) {
        setIsCreating(true);
        setNewName("");
        setCreateError("");
      }
    }
  }

  return (
    <div className={`orders-filter-select${open ? " is-open" : ""}`} ref={rootRef} onKeyDown={onKeyDown}>      <button
        type="button"
        ref={triggerRef}
        className={`orders-filter-select__trigger${selected ? "" : " is-placeholder"}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
        aria-label={label}
        title={disabled || loading ? shownPlaceholder : (selected?.label || undefined)}
        disabled={disabled || loading}
        onClick={() => (open ? requestClose() : setOpen(true))}
      >
        <span className="orders-filter-select__value">{selected ? selected.label : shownPlaceholder}</span>
        <span className="orders-filter-select__chevron" aria-hidden="true"><Icon name="bi-chevron-down" size={16} /></span>
      </button>
      {open || closing ? (
        <div
          ref={panelRef}
          className={`orders-filter-select__panel${panelFixed ? " is-detached" : ""}${closing ? " is-closing" : ""}`}
          style={panelFixed
            ? { top: panelFixed.top, left: panelFixed.left, width: panelFixed.width }
            : undefined}
          aria-hidden={closing ? true : undefined}
          {...(closing ? { inert: true } : {})}
          onAnimationEnd={handlePanelAnimationEnd}
        >
          <ul ref={menuRef} className="orders-filter-select__menu" id={listId} role="listbox" aria-label={label}>
            {searchable ? (
              <li className="orders-filter-select__search-row" role="presentation">
                <div className="orders-filter-select__search">
                  <Icon name="bi-search" size={14} />
                  <input
                    ref={searchRef}
                    type="search"
                    className="orders-filter-select__search-input"
                    value={query}
                    placeholder={searchPlaceholder}
                    aria-label={`${label}: поиск`}
                    autoComplete="off"
                    spellCheck="false"
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setActiveIndex(-1);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        requestClose();
                        triggerRef.current?.focus();
                        return;
                      }
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        event.stopPropagation();
                        const total = visibleOptions.length;
                        if (!total) return;
                        const step = event.key === "ArrowDown" ? 1 : -1;
                        setActiveIndex((i) => {
                          const next = i + step;
                          if (next < 0) return total - 1;
                          if (next >= total) return 0;
                          return next;
                        });
                        return;
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.stopPropagation();
                        if (activeIndex >= 0 && visibleOptions[activeIndex]) pick(visibleOptions[activeIndex].value);
                        else if (visibleOptions.length === 1) pick(visibleOptions[0].value);
                        return;
                      }
                      event.stopPropagation();
                    }}
                  />
                  {query ? (
                    <button
                      type="button"
                      className="orders-filter-select__search-clear"
                      aria-label="Очистить поиск"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => { setQuery(""); setActiveIndex(-1); searchRef.current?.focus(); }}
                    >
                      <Icon name="bi-x-lg" size={12} />
                    </button>
                  ) : null}
                </div>
              </li>
            ) : null}
            {visibleOptions.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    className={`orders-filter-select__option owner-msel__option${isSelected ? " is-selected is-checked" : ""}${index === activeIndex ? " is-active" : ""}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => pick(option.value)}
                  >
                    <span className="owner-msel__check" aria-hidden="true">
                      {isSelected ? (
                        <svg className="owner-msel__tick" viewBox="0 0 16 16" width="12" height="12">
                          <path d="M13 4.5 6.5 11 3 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : null}
                    </span>
                    <span className="orders-filter-select__option-label">{option.label}</span>
                  </button>
                </li>
              );
            })}
            {visibleOptions.length === 0 && !onCreateNew ? (
              <li key="__empty" className="orders-filter-select__empty" role="presentation">
                {query.trim() ? "Ничего не найдено" : (emptyLabel || "Нет данных")}
              </li>
            ) : null}
            {onCreateNew && !isCreating ? (
              <li key="__create">
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  className={`orders-filter-select__option owner-msel__option orders-filter-select__create-row${activeIndex === visibleOptions.length ? " is-active" : ""}`}
                  onMouseEnter={() => setActiveIndex(visibleOptions.length)}
                  onClick={() => {
                    setIsCreating(true);
                    setNewName("");
                    setCreateError("");
                  }}
                >
                  <span
                    className="orders-filter-select__create-plus"
                    aria-hidden="true"
                    style={{ color: "var(--color-interactive, #2563eb)", fontWeight: 800, fontSize: 16, lineHeight: 1 }}
                  >
                    +
                  </span>
                  <span
                    className="orders-filter-select__option-label"
                    style={{ color: "var(--color-interactive, #2563eb)", fontWeight: 700 }}
                  >
                    {String(createLabel || "Новая категория").replace(/^\+\s*/, "")}
                  </span>
                </button>
              </li>
            ) : null}
            {onCreateNew && isCreating ? (
              <li key="__create-form">
                <div className="orders-filter-select__create-form" onMouseDown={(e) => e.stopPropagation()}>
                  <input
                    autoFocus
                    className="orders-filter-select__create-input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        submitCreate();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsCreating(false);
                        setNewName("");
                        setCreateError("");
                      } else {
                        e.stopPropagation();
                      }
                    }}
                    placeholder="Название категории"
                    aria-label="Новая категория"
                    disabled={createSaving}
                  />
                  <div className="orders-filter-select__create-actions">
                    <button
                      type="button"
                      className="orders-filter-select__create-cancel"
                      disabled={createSaving}
                      onClick={() => {
                        setIsCreating(false);
                        setNewName("");
                        setCreateError("");
                      }}
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      className="orders-filter-select__create-submit"
                      disabled={createSaving || !String(newName || "").trim()}
                      onClick={submitCreate}
                    >
                      {createSaving ? "Создание…" : "Создать"}
                    </button>
                  </div>
                  {createError ? <Toast kind="error" message={createError} onClose={() => { setCreateError(""); }} /> : null}
                </div>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
