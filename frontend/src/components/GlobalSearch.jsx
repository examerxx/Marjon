import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Search, X, CornerDownLeft } from "lucide-react";

// Static catalog of navigable destinations. Covers the role/terminal entities
// the owner searches by name ("моноблок", "официант", "кассир", …) plus the
// main sections of the platform.
const STATIC_INDEX = [
  { type: "Сотрудники", label: "Официант", icon: "bi-person", to: "/users/waiter", keywords: "официант зал waiter" },
  { type: "Сотрудники", label: "Кассир", icon: "bi-cash-coin", to: "/users/cashier", keywords: "кассир касса cashier" },
  { type: "Сотрудники", label: "Моноблок", icon: "bi-pc-display", to: "/users/monoblock", keywords: "моноблок терминал рабочее место monoblock pos" },
  { type: "Сотрудники", label: "Кухня", icon: "bi-display", to: "/users/kitchen", keywords: "кухня повар kds kitchen" },
  { type: "Сотрудники", label: "Менеджер", icon: "bi-shield-lock", to: "/users/manager", keywords: "менеджер管 manager" },
  { type: "Сотрудники", label: "Все сотрудники", icon: "bi-people", to: "/users", keywords: "все сотрудники команда staff" },

  { type: "Разделы", label: "Дашборд", icon: "bi-bar-chart-line", to: "/", keywords: "дашборд главная dashboard" },
  { type: "Разделы", label: "Заказы", icon: "bi-receipt", to: "/orders", keywords: "заказы продажи orders" },
  { type: "Разделы", label: "Меню", icon: "bi-cup-hot", to: "/menu", keywords: "меню блюда menu" },
  { type: "Разделы", label: "Склад", icon: "bi-box-seam", to: "/warehouse", keywords: "склад остатки warehouse" },
  { type: "Разделы", label: "Финансы", icon: "bi-wallet2", to: "/finance", keywords: "финансы касса деньги finance" },
  { type: "Разделы", label: "Аналитика", icon: "bi-graph-up-arrow", to: "/analytics", keywords: "аналитика отчеты analytics" },
  { type: "Разделы", label: "Магазин", icon: "bi-shop", to: "/store", keywords: "магазин store" },
  { type: "Разделы", label: "Отзывы", icon: "bi-chat-left", to: "/reviews", keywords: "отзывы reviews" },

  { type: "Отчеты", label: "Z-отчёт", icon: "bi-receipt-cutoff", to: "/reports/z-report", keywords: "z отчет смена" },
  { type: "Отчеты", label: "Отчёт по официантам", icon: "bi-person-lines-fill", to: "/reports/waiters", keywords: "официанты отчет" },
  { type: "Отчеты", label: "Отчёт по блюдам", icon: "bi-stars", to: "/reports/dishes", keywords: "блюда отчет" },
  { type: "Отчеты", label: "Отчёт по столам", icon: "bi-grid-3x3-gap", to: "/reports/tables", keywords: "столы зал отчет" },

  { type: "Настройки", label: "Принтеры", icon: "bi-printer", to: "/settings/printers", keywords: "принтеры печать" },
  { type: "Настройки", label: "Способ оплаты", icon: "bi-credit-card", to: "/settings/payment-methods", keywords: "оплата касса" },
  { type: "Настройки", label: "Профиль", icon: "bi-person", to: "/settings/profile", keywords: "профиль ресторан" },
  { type: "Настройки", label: "Место", icon: "bi-geo-alt", to: "/settings/place", keywords: "зал столы зоны" },
];

function normalize(text = "") {
  return text.toString().toLowerCase().replaceAll("ё", "е").trim();
}

export default function GlobalSearch() {
  const navigate = useNavigate();
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [employees, setEmployees] = useState([]);
  const [products, setProducts] = useState([]);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      api.get("/hr/employees").catch(() => ({ data: [] })),
      api.get("/inventory/products").catch(() => ({ data: [] })),
    ]).then(([emp, prod]) => {
      if (!mounted) return;
      setEmployees(Array.isArray(emp.data) ? emp.data : []);
      setProducts(Array.isArray(prod.data) ? prod.data : []);
    });
    return () => { mounted = false; };
  }, []);

  const dynamicIndex = useMemo(() => {
    const emp = employees.map((e) => ({
      type: "Сотрудники",
      label: e.full_name || e.name || e.email || "Сотрудник",
      sub: e.position || e.role || e.phone || "",
      icon: "bi-person-badge",
      to: "/users",
    }));
    const dishes = products.map((p) => ({
      type: "Блюда",
      label: p.name || "Блюдо",
      sub: p.price != null ? `${Number(p.price).toLocaleString("ru-RU")} UZS` : "",
      icon: "bi-cup-hot",
      to: "/menu",
    }));
    return [...emp, ...dishes];
  }, [employees, products]);

  const results = useMemo(() => {
    const q = normalize(query);
    if (!q) return [];
    const pool = [...STATIC_INDEX, ...dynamicIndex];
    const scored = [];
    for (const item of pool) {
      const haystack = normalize(`${item.label} ${item.sub || ""} ${item.keywords || ""}`);
      const idx = haystack.indexOf(q);
      if (idx === -1) continue;
      // Prefer matches at the start of the label.
      const labelHit = normalize(item.label).startsWith(q) ? 0 : 1;
      scored.push({ item, score: labelHit * 100 + idx });
    }
    return scored.sort((a, b) => a.score - b.score).slice(0, 8).map((s) => s.item);
  }, [query, dynamicIndex]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of results) {
      if (!map.has(r.type)) map.set(r.type, []);
      map.get(r.type).push(r);
    }
    return [...map.entries()];
  }, [results]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  useEffect(() => {
    function onDocClick(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function go(item) {
    navigate(item.to);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function onKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      if (results[activeIndex]) go(results[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  let flatIndex = -1;

  return (
    <div className={`global-search ${open ? "is-open" : ""}`} ref={wrapRef}>
      <div className="global-search__field">
        <Search size={16} strokeWidth={2.2} className="global-search__icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          className="global-search__input"
          placeholder="Поиск…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-label="Глобальный поиск"
        />
        {query ? (
          <button type="button" className="global-search__clear" onClick={() => { setQuery(""); inputRef.current?.focus(); }} aria-label="Очистить">
            <X size={14} strokeWidth={2.5} />
          </button>
        ) : null}
      </div>

      {open && query ? (
        <div className="global-search__panel" role="listbox">
          {results.length === 0 ? (
            <div className="global-search__empty">
              <Search size={20} strokeWidth={2} />
              <p>Ничего не найдено по «{query}»</p>
            </div>
          ) : (
            grouped.map(([type, items]) => (
              <div className="global-search__group" key={type}>
                <div className="global-search__group-title">{type}</div>
                {items.map((item) => {
                  flatIndex += 1;
                  const idx = flatIndex;
                  return (
                    <button
                      type="button"
                      key={`${item.to}-${item.label}`}
                      className={`global-search__result ${idx === activeIndex ? "is-active" : ""}`}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => go(item)}
                    >
                      <span className="global-search__result-icon"><i className={`bi ${item.icon}`} /></span>
                      <span className="global-search__result-body">
                        <strong>{item.label}</strong>
                        {item.sub ? <small>{item.sub}</small> : null}
                      </span>
                      <CornerDownLeft size={14} strokeWidth={2} className="global-search__result-enter" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
