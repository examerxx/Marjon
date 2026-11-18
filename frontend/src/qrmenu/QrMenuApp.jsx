// Публичное меню по QR: без логина, только просмотр.
// Адрес: /m/<slug>              — меню заведения
//        /m/<slug>/<токен стола> — меню + открытый счёт этого стола
//        /M/<SLUG>, /T/<код стола> — короткие адреса из QR (заглавными QR получается крупнее)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "/api/v1";
const POLL_MS = 12000;

export function parseLocation(pathname = window.location.pathname) {
  const parts = pathname.split("/").filter(Boolean);
  const at = parts.findIndex((part) => /^[mt]$/i.test(part));
  if (at < 0) return { slug: "", token: "", short: "" };
  if (parts[at].toLowerCase() === "t") return { slug: "", token: "", short: (parts[at + 1] || "").toUpperCase() };
  return { slug: parts[at + 1] || "", token: parts[at + 2] || "", short: "" };
}

async function getJson(path) {
  const response = await fetch(`${API}${path}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

const NUMBER = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const unitOf = (currency) => (currency === "UZS" ? "сум" : currency);

// В данных названия часто набраны капсом («UYG'UR LAG'MON») — на экране гостя
// это кричит. Длинные капс-названия приводим к «Uyg'ur Lag'mon», а короткие
// аббревиатуры (KFC, BBQ) оставляем как есть.
function prettyName(name) {
  const text = String(name || "").trim();
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length > 4 && text === text.toUpperCase()) {
    return text.toLowerCase().replace(/(^|[\s(\-/])(\p{L})/gu, (_, lead, ch) => lead + ch.toUpperCase());
  }
  return text;
}

function Money({ value, currency, className = "" }) {
  return (
    <span className={`qm-money ${className}`}>
      {NUMBER.format(Number(value) || 0)}
      <small>{unitOf(currency)}</small>
    </span>
  );
}

const Icon = {
  search: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
  ),
  table: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16M6 9v10M18 9v10M3 9l1.5-4h15L21 9" /></svg>
  ),
  dish: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v6M9 3v6M17 21V3c-2.2 1.2-3.5 4-3.5 7 0 1.7 1 3 3.5 3" /></svg>
  ),
  receipt: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" /></svg>
  ),
  sun: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.2A7 7 0 0 1 19 9.8C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.8" r="2.4" /></svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>
  ),
};

function plural(n, forms) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

const cssUrl = (url) => `url("${String(url).replace(/"/g, "%22")}")`;

// ── Тема ────────────────────────────────────────────────────────────
// Гость сам выбирает светлую/тёмную; пока не выбрал — следуем настройке телефона.
// Выбор помнится на устройстве (localStorage может быть недоступен — тогда без памяти).
const THEME_KEY = "marjon_qm_theme";
const THEME_COLOR = { light: "#f2f6f6", dark: "#0a1115" };

function readTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "";
  } catch { return ""; }
}

function useTheme() {
  const [choice, setChoice] = useState(readTheme);
  const [systemDark, setSystemDark] = useState(() => Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches));
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query?.addEventListener) return undefined;
    const onChange = (event) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const theme = choice || (systemDark ? "dark" : "light");
  useEffect(() => {
    const root = document.documentElement;
    if (choice) root.dataset.theme = choice; else delete root.dataset.theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute("content", THEME_COLOR[theme]));
  }, [choice, theme]);
  const toggle = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setChoice(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* без памяти */ }
  }, [theme]);
  return [theme, toggle];
}

function ThemeToggle({ theme, onToggle }) {
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="qm-theme"
      onClick={onToggle}
      aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"}
      aria-pressed={dark}
      title={dark ? "Светлая тема" : "Тёмная тема"}
    >
      {dark ? Icon.sun : Icon.moon}
    </button>
  );
}

function Thumb({ src, name, placeholder }) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (src && !broken) {
    return (
      <div className="qm-item__media">
        <img
          src={src}
          alt={name}
          loading="lazy"
          decoding="async"
          className={loaded ? "is-loaded" : ""}
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
        />
      </div>
    );
  }
  if (!placeholder) return null;
  return <div className="qm-item__media qm-item__media--empty">{Icon.dish}</div>;
}

function Skeleton() {
  return (
    <main className="qm" aria-busy="true" aria-label="Загрузка меню">
      <div className="qm-skelhero">
        <i className="qm-skel__logo" />
        <div><i className="qm-skel__line" style={{ width: 150 }} /><i className="qm-skel__line" style={{ width: 90 }} /></div>
      </div>
      <div className="qm-wrap">
        {[0, 1, 2, 3].map((n) => <i key={n} className="qm-skel__card" />)}
      </div>
    </main>
  );
}

// Сколько процентов обслуживания: считаем из сумм заказа и показываем, только если число «круглое»
// (например 20%); иначе (часть позиций «с собой» и т. п.) пишем просто «Обслуживание».
function servicePercent(order) {
  const base = (Number(order.subtotal) || 0) - (Number(order.discount) || 0);
  const fee = Number(order.service_fee) || 0;
  if (base <= 0 || fee <= 0) return "";
  const percent = (fee / base) * 100;
  return Math.abs(percent - Math.round(percent)) <= 0.15 ? ` ${Math.round(percent)}%` : "";
}

function OrderCard({ order, currency, cardRef, open, onToggle }) {
  const total = Number(order.total) || 0;
  const paid = Number(order.paid) || 0;
  const share = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const discount = Number(order.discount) || 0;
  const fee = Number(order.service_fee) || 0;
  const accepted = order.accepted_time
    ? (order.accepted_today === false ? `${order.accepted_date} в ${order.accepted_time}` : `в ${order.accepted_time}`)
    : "";
  // «Кассир: …» / «Официант: …» — как на бумажном чеке. Старый формат ответа (просто имена) тоже понимаем.
  const staff = (order.staff || []).map((row) => (typeof row === "string" ? { label: "Персонал", name: row } : row));
  // Одинаковые блюда (официант добавлял по одному) показываем одной строкой.
  const lines = useMemo(() => {
    const merged = new Map();
    for (const item of order.items) {
      const key = `${item.name}|${item.price}`;
      const row = merged.get(key) || { name: item.name, quantity: 0, total: 0 };
      row.quantity += Number(item.quantity) || 0;
      row.total += Number(item.total) || 0;
      merged.set(key, row);
    }
    return [...merged.values()];
  }, [order.items]);

  return (
    <section className="qm-order" ref={cardRef} aria-label="Ваш заказ">
      <button type="button" className="qm-order__head" onClick={onToggle} aria-expanded={open}>
        <span className="qm-order__ico">{Icon.receipt}</span>
        <span className="qm-order__title">
          Ваш заказ
          <em><i className="qm-live" /> онлайн</em>
        </span>
        <Money value={order.total} currency={currency} className="qm-order__sum" />
        <span className={`qm-order__chev${open ? " is-open" : ""}`}>{Icon.chevron}</span>
      </button>

      {/* Чек всегда в разметке, но свёрнут: раскрывается плавно (высота 0 → авто), а в свёрнутом виде
          недоступен ни глазу, ни клавиатуре, ни скринридеру (inert). */}
      <div className={`qm-order__collapse${open ? " is-open" : ""}`} inert={!open}>
       <div className="qm-order__inner">
        <div className="qm-order__body qm-rc">
          {staff.length ? (
            <dl className="qm-rc__meta">
              {staff.map((row) => (
                <div key={row.label}><dt>{row.label}:</dt><dd>{row.name}</dd></div>
              ))}
            </dl>
          ) : null}

          <table className="qm-rc__table">
            <thead>
              <tr><th scope="col">Блюдо</th><th scope="col">Кол-во</th><th scope="col">Сумма</th></tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index}>
                  <td>{prettyName(line.name)}</td>
                  <td>{NUMBER.format(line.quantity)}</td>
                  <td>{NUMBER.format(line.total)}<small>{unitOf(currency)}</small></td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="qm-rc__sums">
            {discount > 0 || fee > 0 ? (
              <div className="qm-rc__strong"><dt>Сумма блюд</dt><dd>{NUMBER.format(Number(order.subtotal) || 0)}<small>{unitOf(currency)}</small></dd></div>
            ) : null}
            {discount > 0 ? <div><dt>Скидка</dt><dd>−{NUMBER.format(discount)}<small>{unitOf(currency)}</small></dd></div> : null}
            {fee > 0 ? <div><dt>Обслуживание{servicePercent(order)}</dt><dd>{NUMBER.format(fee)}<small>{unitOf(currency)}</small></dd></div> : null}
          </dl>

          <div className="qm-rc__total">
            <span>Итого:</span>
            <span>{NUMBER.format(total)}<small>{unitOf(currency)}</small></span>
          </div>

          {paid > 0 ? (
            <div className="qm-pay">
              <div className="qm-pay__bar" role="img" aria-label={`Оплачено ${share}%`}><i style={{ width: `${share}%` }} /></div>
              <div className="qm-pay__row"><span>Оплачено</span><Money value={order.paid} currency={currency} /></div>
              <div className="qm-pay__due"><span>Осталось оплатить</span><Money value={order.remaining} currency={currency} /></div>
            </div>
          ) : null}

          {accepted ? <p className="qm-order__time">Принято {accepted}</p> : null}
        </div>
       </div>
      </div>
    </section>
  );
}

export default function QrMenuApp() {
  const [where, setWhere] = useState(() => parseLocation());
  const { slug, token, short } = where;
  const [menu, setMenu] = useState(null);
  const [table, setTable] = useState(null);
  const [order, setOrder] = useState(null);
  const [failed, setFailed] = useState("");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("");
  const [orderVisible, setOrderVisible] = useState(true);
  const [theme, toggleTheme] = useTheme();
  const sections = useRef({});
  const chips = useRef({});
  const chipsBar = useRef(null);
  const orderRef = useRef(null);
  const [receiptOpen, setReceiptOpen] = useState(false); // по умолчанию чек свёрнут
  const lockSpy = useRef(0);

  // Короткая ссылка стола: узнаём заведение и токен стола, дальше всё как по полной ссылке.
  useEffect(() => {
    if (!short) return;
    getJson(`/public/menu/t/${encodeURIComponent(short)}`)
      .then((data) => setWhere({ slug: data.slug, token: data.token, short: "" }))
      .catch(() => setFailed("Меню не найдено. Проверьте QR-код или попросите официанта."));
  }, [short]);

  useEffect(() => {
    if (short) return;
    if (!slug) { setFailed("Ссылка на меню неполная."); return; }
    getJson(`/public/menu/${encodeURIComponent(slug)}`)
      .then((data) => { setMenu(data); document.title = `${data.company.name} — меню`; })
      .catch(() => setFailed("Меню не найдено. Проверьте QR-код или попросите официанта."));
  }, [slug, short]);

  useEffect(() => {
    if (!slug || !token) return undefined;
    let alive = true;
    const base = `/public/menu/${encodeURIComponent(slug)}/table/${encodeURIComponent(token)}`;
    getJson(base).then((data) => { if (alive) setTable(data); }).catch(() => {});
    const refresh = () => {
      if (document.hidden) return;
      getJson(`${base}/order`)
        .then((data) => { if (alive) setOrder(data); })
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [slug, token]);

  const categories = useMemo(() => {
    if (!menu) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return menu.categories;
    return menu.categories
      .map((c) => ({ ...c, items: c.items.filter((i) => `${i.name} ${i.description || ""}`.toLowerCase().includes(needle)) }))
      .filter((c) => c.items.length);
  }, [menu, query]);

  // Фон шапки — первое попавшееся фото блюда (иначе логотип).
  const cover = useMemo(() => {
    const first = (menu?.categories || []).flatMap((c) => c.items).find((i) => i.image_url);
    return first?.image_url || menu?.company.logo_url || "";
  }, [menu]);
  const dishCount = useMemo(() => (menu?.categories || []).reduce((sum, c) => sum + c.items.length, 0), [menu]);

  // Плитки-заглушки без фото нужны только когда фото есть у большинства блюд:
  // иначе единственная картинка среди текстовых карточек смотрится случайно,
  // а ряд серых плиток — тяжело.
  const hasPhotos = useMemo(() => {
    const all = (menu?.categories || []).flatMap((c) => c.items);
    return all.length > 0 && all.filter((i) => i.image_url).length / all.length >= 0.5;
  }, [menu]);

  // Подсветка текущей категории при прокрутке.
  useEffect(() => {
    if (!categories.length || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (Date.now() < lockSpy.current) return;
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.dataset.cat);
    }, { rootMargin: "-140px 0px -65% 0px", threshold: 0 });
    Object.values(sections.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [categories]);

  // Чип активной категории всегда виден в ленте.
  useEffect(() => {
    const bar = chipsBar.current;
    const chip = chips.current[active];
    if (!bar || !chip) return;
    // Двигаем только ленту категорий (а не всю страницу) и не прижимаем первую плашку к краю экрана.
    const left = chip.offsetLeft - (bar.clientWidth - chip.offsetWidth) / 2;
    bar.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [active]);

  // Кнопка «Счёт» внизу — только когда сам блок заказа ушёл за экран.
  useEffect(() => {
    const el = orderRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => setOrderVisible(entry.isIntersecting), { threshold: 0.05 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [order?.open]);

  const jump = useCallback((id) => {
    setActive(id);
    lockSpy.current = Date.now() + 700;
    sections.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  if (failed) {
    return (
      <main className="qm qm--center">
        <div className="qm-note">
          <span className="qm-note__ico">{Icon.dish}</span>
          <p>{failed}</p>
        </div>
      </main>
    );
  }
  if (!menu) return <Skeleton />;

  const currency = menu.company.currency || "UZS";
  const logo = menu.company.logo_url;
  const orderOpen = Boolean(order?.open);

  return (
    <main className="qm">
      <header className="qm-hero">
        <div className="qm-hero__bg" style={cover ? { backgroundImage: cssUrl(cover) } : undefined} aria-hidden="true" />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <div className="qm-hero__main">
          <Logo src={logo} name={menu.company.name} />
          <div className="qm-hero__text">
            <h1>{menu.company.name}</h1>
            <div className="qm-hero__meta">
              {table ? (
                <span className="qm-pill">{Icon.table}Стол {table.number}{table.hall ? ` · ${table.hall}` : ""}</span>
              ) : null}
              <span className="qm-hero__chip">{Icon.dish}<span>{dishCount} {plural(dishCount, ["блюдо", "блюда", "блюд"])}</span></span>
            </div>
          </div>
        </div>
        {menu.company.address || menu.company.phone ? (
          <ul className="qm-hero__info">
            {menu.company.address ? <li>{Icon.pin}<span>{menu.company.address}</span></li> : null}
            {menu.company.phone ? <li><a href={`tel:${menu.company.phone}`}>{Icon.phone}<span>{menu.company.phone}</span></a></li> : null}
          </ul>
        ) : null}
      </header>

      <div className={`qm-wrap${orderOpen ? " qm-wrap--lift" : ""}`}>
        {orderOpen ? <OrderCard order={order} currency={currency} cardRef={orderRef} open={receiptOpen} onToggle={() => setReceiptOpen((value) => !value)} /> : null}

        <div className="qm-bar">
          <label className="qm-search">
            {Icon.search}
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти блюдо"
              aria-label="Найти блюдо"
            />
            {query ? (
              <button type="button" className="qm-search__clear" onClick={() => setQuery("")} aria-label="Очистить поиск">{Icon.close}</button>
            ) : null}
          </label>
          <nav className="qm-chips" ref={chipsBar} aria-label="Категории">
            {menu.categories.map((c) => (
              <button
                type="button"
                key={c.id}
                ref={(el) => { chips.current[c.id] = el; }}
                className={active === c.id ? "is-active" : ""}
                onClick={() => jump(c.id)}
              >
                {prettyName(c.name)}
              </button>
            ))}
          </nav>
        </div>

        {categories.length === 0 ? <p className="qm-empty">По запросу «{query}» ничего не нашлось</p> : null}

        {categories.map((c) => (
          <section key={c.id} data-cat={c.id} ref={(el) => { sections.current[c.id] = el; }} className="qm-cat">
            <h2>{prettyName(c.name)}<span>{c.items.length}</span></h2>
            <ul>
              {c.items.map((item) => (
                <li key={item.id} className={`qm-item${item.available ? "" : " is-off"}`}>
                  <Thumb src={item.image_url} name={item.name} placeholder={hasPhotos} />
                  <div className="qm-item__body">
                    <h3>{prettyName(item.name)}</h3>
                    {item.description ? <p>{item.description}</p> : null}
                    {!item.available ? <span className="qm-badge">Нет в наличии</span> : null}
                  </div>
                  <Money value={item.price} currency={currency} className="qm-item__price" />
                </li>
              ))}
            </ul>
          </section>
        ))}

      </div>

      {orderOpen && !orderVisible ? (
        <button
          type="button"
          className="qm-fab"
          onClick={() => {
            setReceiptOpen(true); // кнопка «Счёт стола» ведёт к чеку и раскрывает его
            orderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          <span>{Icon.receipt}Счёт стола</span>
          <Money value={Number(order.paid) > 0 ? order.remaining : order.total} currency={currency} />
        </button>
      ) : null}
    </main>
  );
}

function Logo({ src, name }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return <img className="qm-logo" src={src} alt="" onError={() => setBroken(true)} />;
  }
  return <span className="qm-logo qm-logo--letter" aria-hidden="true">{String(name || "?").trim().charAt(0).toUpperCase()}</span>;
}
