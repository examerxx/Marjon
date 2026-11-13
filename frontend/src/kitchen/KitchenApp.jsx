// Отдельный KDS-экран поваров: заказы, блюда, «Сделал / Не сделал» в один тап.
// Не входит в админку (/), десктоп и мобилу: свой entry kitchen.html -> src/kitchen/main.jsx.
//
// Дизайн повторяет рабочий экран зала в Desktop: тёмная navy-канва, плавающая
// белая панель сверху и светлые карточки заказов с цветной шапкой. Сайдбара
// нет — на кухне важны только очередь и две большие кнопки на блюдо.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forgetKdsDevice,
  getKdsBranch,
  getKdsCookName,
  hasKdsDevice,
  isKdsAuthenticated,
  kdsConnectDevice,
  kdsCookLogout,
  kdsGetCooks,
  kdsGetOrders,
  kdsPinLogin,
  kdsSetItemStatus,
  kdsSetOrderReady,
  kdsWsUrl,
} from "./api";
import brandMark from "../assets/brand/marjon-neon-logo-v110.png";
import {
  formatLocalPhone,
  getLocalPhoneDigits,
  isLocalPhoneComplete,
  toFullPhone,
} from "../utils/phoneMask";
import {
  IconAlert,
  IconBack,
  IconBackspace,
  IconCheck,
  IconClock,
  IconExpand,
  IconEye,
  IconEyeOff,
  IconLogout,
  IconRefresh,
  IconSound,
  IconSoundOff,
  IconSpinner,
  IconTv,
  IconUndo,
  IconWifi,
  IconWifiOff,
} from "./icons.jsx";
import { t as tr } from "../i18n/t";

// Бэкенд отдаёт наивный UTC без таймзоны — считаем его UTC, иначе таймеры врут
function parseTs(ts) {
  if (!ts) return Date.now();
  const s = String(ts);
  const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(" ", "T")}Z`;
  const t = new Date(withZone).getTime();
  return Number.isNaN(t) ? Date.now() : t;
}

function formatElapsed(createdAt, now) {
  const diff = Math.max(0, now - parseTs(createdAt));
  const min = Math.floor(diff / 60000);
  const sec = Math.floor((diff % 60000) / 1000);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// Короткий звуковой сигнал о новом заказе без внешних ассетов
function beep(enabled) {
  if (!enabled) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.value = 0.15;
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close?.();
  } catch {
    // Нет звука — не блокируем кухню
  }
}

function itemState(item) {
  const s = String(item?.status || "pending").toLowerCase();
  if (s === "ready" || s === "done" || s === "served") return "ready";
  if (s === "cancelled") return "cancelled";
  if (s === "cooking" || s === "in_progress") return "cooking";
  return "pending";
}

function orderIsReady(order) {
  return String(order?.status || "").toLowerCase() === "ready";
}

// Отменённые блюда не мешают заказу стать готовым — так же считает бэкенд.
function liveItems(order) {
  return (order.items ?? []).filter((item) => itemState(item) !== "cancelled");
}

function isAllReady(order) {
  const items = liveItems(order);
  return items.length > 0 && items.every((item) => itemState(item) === "ready");
}

function isReadyOrder(order) {
  return orderIsReady(order) || isAllReady(order);
}

function orderNumber(order) {
  return order.order_number || order.public_id || String(order.id).slice(0, 8);
}

// Тип заказа приходит кодом — на кухне читаем по-человечески.
const ORDER_TYPES = {
  dine_in: "В зале",
  takeaway: "С собой",
  delivery: "Доставка",
  qr: "QR-меню",
};

function typeLabel(order) {
  const raw = String(order?.order_type || "");
  return ORDER_TYPES[raw] || raw;
}

// Количество бывает дробным (0.5 порции) — хвостовые нули не показываем.
function formatQty(value) {
  const n = Number(value ?? 1);
  if (!Number.isFinite(n)) return "1";
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

// Русское склонение числительных: 1 заказ, 2 заказа, 5 заказов.
function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const tail = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (tail > 1 && tail < 5) return few;
  if (tail === 1) return one;
  return many;
}

const DATE_FMT = new Intl.DateTimeFormat("ru-RU", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

function clockParts(now) {
  const d = new Date(now);
  return {
    hh: String(d.getHours()).padStart(2, "0"),
    mm: String(d.getMinutes()).padStart(2, "0"),
    ss: String(d.getSeconds()).padStart(2, "0"),
    date: DATE_FMT.format(d),
  };
}

// ── Позиция заказа ────────────────────────────────────────────────────────
//
// Две крупные кнопки на блюдо вместо маленькой «Готово»: повар в перчатке
// попадает в 60-пиксельную цель, а «Не сделал» возвращает блюдо в работу
// (бэкенд разрешает ready → cooking). Нажатие на уже активное состояние
// ничего не отправляет — это переключатель, а не двойной запрос.

function DishRow({ item, busy, onStatus }) {
  const st = itemState(item);
  const ready = st === "ready";
  const cancelled = st === "cancelled";
  const modifiers = Array.isArray(item.modifiers)
    ? item.modifiers
        .map((m) => (typeof m === "string" ? m : m?.name))
        .filter(Boolean)
        .join(" · ")
    : "";

  const stateLabel = cancelled
    ? tr("kitchen.kitchenapp.otmeneno")
    : ready
      ? tr("kitchen.kitchenapp.gotovo")
      : st === "cooking"
        ? tr("kitchen.kitchenapp.gotovitsya")
        : tr("kitchen.kitchenapp.zhdet");

  return (
    <li className={`dish is-${st}`}>
      <div className="dish__main">
        <span className="dish__qty">
          {formatQty(item.quantity)}
          <i>×</i>
        </span>

        <span className="dish__text">
          <span className="dish__name">{item.name || "Блюдо"}</span>
          {modifiers ? <span className="dish__mods">{modifiers}</span> : null}
          {item.note ? <span className="dish__note">{item.note}</span> : null}
          {item.takeaway ? <span className="dish__tag">{tr("kitchen.kitchenapp.s_soboy")}</span> : null}
        </span>

        <span className={`dish__state is-${cancelled ? "cancelled" : ready ? "ready" : st}`}>
          {ready ? <IconCheck size={14} /> : null}
          {stateLabel}
        </span>
      </div>

      {cancelled || item.status === "served" ? null : (
        <div className="dish__actions" role="group" aria-label={item.name || "Блюдо"}>
          <button
            className={`dish__act dish__act--done ${ready ? "is-active" : ""}`}
            type="button"
            aria-pressed={ready}
            disabled={busy}
            onClick={() => {
              if (!ready) onStatus(item, "ready");
            }}
          >
            {busy && !ready ? <IconSpinner size={18} /> : <IconCheck size={18} />}
            {tr("kitchen.kitchenapp.sdelal")}
          </button>
          <button
            className={`dish__act dish__act--undone ${ready ? "" : "is-active"}`}
            type="button"
            aria-pressed={!ready}
            disabled={busy}
            onClick={() => {
              if (ready) onStatus(item, "cooking");
            }}
          >
            <IconUndo size={18} />
            {tr("kitchen.kitchenapp.ne_sdelal")}
          </button>
        </div>
      )}
    </li>
  );
}

// ── Карточка заказа ──────────────────────────────────────────────────────
//
// Светлая карточка на navy-канве, как карточки столов в Desktop: цветная
// шапка (teal/янтарь/красный/зелёный) отвечает за возраст и состояние,
// белое тело — блюда, нижняя полоса — прогресс и «Весь стол готов».

function OrderCard({ order, now, busyId, onItemStatus, onOrderReady }) {
  const items = order.items ?? [];
  const active = liveItems(order);
  const readyCount = active.filter((item) => itemState(item) === "ready").length;
  const allReady = isAllReady(order);
  const orderReady = orderIsReady(order);
  const mins = Math.floor(Math.max(0, now - parseTs(order.created_at)) / 60000);
  const tone = orderReady || allReady ? "done" : mins >= 20 ? "urgent" : mins >= 10 ? "late" : "work";
  const type = typeLabel(order);
  const left = Math.max(0, active.length - readyCount);
  const pct = active.length ? Math.round((readyCount / active.length) * 100) : 0;
  const busy = busyId === order.id;

  return (
    <article className={`oc oc--${tone}`} aria-label={`Заказ ${orderNumber(order)}`}>
      <header className="oc__head">
        <div className="oc__id">
          <span className="oc__label">{order.table_number ? tr("kitchen.kitchenapp.stol") : type || tr("kitchen.kitchenapp.zakaz")}</span>
          <strong className={order.table_number ? "oc__place" : "oc__place oc__place--type"}>
            {order.table_number || type || "—"}
          </strong>
          <span className="oc__num">
            № {orderNumber(order)}
            {order.table_number && type ? ` · ${type}` : ""}
          </span>
        </div>

        <span className="oc__timer" title={tr("kitchen.kitchenapp.vremya_s_momenta_zakaza")}>
          <IconClock size={16} />
          {formatElapsed(order.created_at, now)}
        </span>
      </header>

      <div className="oc__body">
        {order.note ? (
          <p className="oc__note">
            <IconAlert size={16} />
            <span>{order.note}</span>
          </p>
        ) : null}

        <ul className="oc__dishes">
          {items.map((item) => (
            <DishRow
              key={item.id}
              item={item}
              busy={busyId !== null}
              onStatus={onItemStatus}
            />
          ))}
        </ul>
      </div>

      <footer className="oc__foot">
        <div className="oc__progress">
          <span className="oc__ratio">
            <b>{readyCount}</b>
            <span>/{active.length}</span>
          </span>
          <span className="oc__bar" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </span>
          <span className="oc__left">
            {allReady || orderReady
              ? tr("kitchen.kitchenapp.vse_gotovo")
              : tr("kitchen.kitchenapp.ostalos", { n: left })}
          </span>
        </div>

        <button
          className="oc__ready"
          type="button"
          disabled={busyId !== null || orderReady || allReady || active.length === 0}
          onClick={() => onOrderReady(order)}
        >
          {busy ? <IconSpinner size={20} /> : <IconCheck size={20} />}
          {orderReady || allReady
            ? tr(order.table_number ? "kitchen.kitchenapp.stol_gotov" : "kitchen.kitchenapp.zakaz_gotov")
            : tr(order.table_number ? "kitchen.kitchenapp.ves_stol_gotov" : "kitchen.kitchenapp.ves_zakaz_gotov")}
        </button>
      </footer>
    </article>
  );
}

// ── Верхняя плавающая панель ──────────────────────────────────────────────
//
// Один в один с логикой Desktop-топбара: белая скруглённая полоса, слева
// бренд и филиал, по центру — фильтры, справа — инструменты и часы. Никакого
// сайдбара: на кухне он отнимает место у заказов.

function Topbar({
  branchName,
  cookName,
  online,
  soundOn,
  filter,
  tabs,
  urgent,
  clock,
  tvHref,
  onFilter,
  onSound,
  onRefresh,
  onFullscreen,
  onLogout,
}) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <img className="topbar__logo" src={brandMark} alt="" width={44} height={44} decoding="async" />
        <span className="topbar__brand-text">
          <strong className="topbar__brand-name">Marjon</strong>
          <span className="topbar__brand-sub">
            {branchName || tr("kitchen.kitchenapp.filial")}
            {cookName ? ` · ${cookName}` : ""}
          </span>
        </span>
      </div>

      <span className="topbar__rule" aria-hidden="true" />

      <div className="topbar__tabs" role="group" aria-label={tr("kitchen.kitchenapp.filtr_zakazov")}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`tab ${filter === tab.key ? "is-active" : ""}`}
            type="button"
            aria-pressed={filter === tab.key}
            onClick={() => onFilter(tab.key)}
          >
            {tab.label}
            <span className="tab__count">{tab.count}</span>
          </button>
        ))}
      </div>

      {urgent > 0 ? (
        <p className="topbar__alarm">
          <IconAlert size={15} />
          {urgent} {plural(urgent, "заказ", "заказа", "заказов")}{" "}
          {plural(urgent, "горит", "горят", "горят")}
        </p>
      ) : null}

      <div className="topbar__right">
        <div className="topbar__tools">
          {tvHref ? (
            <a
              className="toolbtn toolbtn--tv"
              href={tvHref}
              target="_blank"
              rel="noopener noreferrer"
              title={tr("kitchen.kitchenapp.tv_dlya_gostey")}
            >
              <IconTv size={19} />
              <span>{tr("kitchen.kitchenapp.tv_dlya_gostey")}</span>
            </a>
          ) : null}

          <span
            className={`topbar__conn ${online ? "is-on" : "is-off"}`}
            title={online ? "Связь с сервером есть" : "Нет связи с сервером"}
          >
            {online ? <IconWifi size={18} /> : <IconWifiOff size={18} />}
          </span>

          <button
            className={`toolbtn ${soundOn ? "is-on" : ""}`}
            type="button"
            onClick={onSound}
            title={soundOn ? "Звук включён" : "Звук выключен"}
            aria-pressed={soundOn}
            aria-label={soundOn ? "Выключить звук" : "Включить звук"}
          >
            {soundOn ? <IconSound size={19} /> : <IconSoundOff size={19} />}
          </button>

          <button
            className="toolbtn"
            type="button"
            onClick={onRefresh}
            title={tr("kitchen.kitchenapp.obnovit_zakazy")}
            aria-label={tr("kitchen.kitchenapp.obnovit_zakazy")}
          >
            <IconRefresh size={19} />
          </button>

          <button
            className="toolbtn"
            type="button"
            onClick={onFullscreen}
            title={tr("kitchen.kitchenapp.vo_ves_ekran")}
            aria-label={tr("kitchen.kitchenapp.vo_ves_ekran")}
          >
            <IconExpand size={19} />
          </button>

          <button
            className="toolbtn toolbtn--out"
            type="button"
            onClick={onLogout}
            title={tr("kitchen.kitchenapp.smenit_povara")}
            aria-label={tr("kitchen.kitchenapp.smenit_povara")}
          >
            <IconLogout size={19} />
          </button>
        </div>

        <div className="topbar__clock" aria-label={tr("kitchen.kitchenapp.tekuschee_vremya")}>
          <span className="clock">
            <b>
              {clock.hh}:{clock.mm}
            </b>
            <i>{clock.ss}</i>
          </span>
          <span className="topbar__date">{clock.date}</span>
        </div>
      </div>
    </header>
  );
}

// ── Общая оболочка экранов входа ──────────────────────────────────────────
//
// Один в один с десктопом: тёмная navy-канва с мягкими подсветками и белая
// карточка по центру. Кухня — тот же продукт, поэтому и вход, и выбор повара,
// и PIN выглядят как в приложении, а не как «ещё один сайт».

function AuthShell({ children, wide = false }) {
  return (
    <div className="kds-auth">
      <span className="kds-auth__bg" aria-hidden="true" />
      <section className={`kds-card ${wide ? "kds-card--wide" : ""}`}>{children}</section>
    </div>
  );
}

function BrandHead({ title, sub }) {
  return (
    <header className="kds-brand">
      {/* Знак ложится прямо на белую карточку — как в десктопе и веб-логине */}
      <span className="kds-brand__logo">
        <img src={brandMark} alt="" width={44} height={44} decoding="async" />
        <b>MARJON</b>
      </span>
      {title ? <h1 className="kds-card__title">{title}</h1> : null}
      {sub ? <p className="kds-card__sub">{sub}</p> : null}
    </header>
  );
}

function cookInitials(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() || "")
    .join("") || "?";
}

// ── Выбор повара ──────────────────────────────────────────────────────────
//
// Экран привязан к заведению логином моноблока, повара не заводят отдельный
// вход: они выбирают себя и вводят свой PIN. Без PIN карточка неактивна —
// иначе повар упирается в «неверный PIN», который он никогда не задавал.

function CookPicker({ branchName, cooks, loading, error, onPick, onReload, onForget }) {
  return (
    <AuthShell wide>
      <BrandHead
        title={tr("kitchen.kitchenapp.kto_na_smene")}
        sub={
          branchName
            ? `${branchName} · ${tr("kitchen.kitchenapp.vyberite_sebya_i_pin")}`
            : tr("kitchen.kitchenapp.vyberite_sebya_i_pin")
        }
      />

      {loading ? (
        <p className="kds-loading">
          <IconSpinner size={18} /> {tr("kitchen.kitchenapp.zagruzhaem_povarov")}
        </p>
      ) : error ? (
        <div className="kds-error" role="alert">
          <IconAlert size={17} />
          <span>{error}</span>
        </div>
      ) : cooks.length ? (
        <div className="kds-cooks">
          {cooks.map((cook) => {
            const noPin = cook.has_pin === false;
            return (
              <button
                key={cook.id}
                className={`kds-cook ${noPin ? "is-disabled" : ""}`}
                type="button"
                disabled={noPin}
                onClick={() => onPick(cook)}
              >
                <span className="kds-cook__avatar" aria-hidden="true">
                  {cookInitials(cook.name)}
                </span>
                <span className="kds-cook__name">{cook.name}</span>
                <span className="kds-cook__meta">
                  {noPin
                    ? tr("kitchen.kitchenapp.pin_ne_zadan")
                    : tr("kitchen.kitchenapp.voyti_po_pin")}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="kds-empty">
          <h2>{tr("kitchen.kitchenapp.povarov_poka_net")}</h2>
          <p>{tr("kitchen.kitchenapp.dobavte_povara_s_roley_kuhnya")}</p>
        </div>
      )}

      <div className="kds-card__foot">
        <button className="kds-linkbtn" type="button" onClick={onReload} disabled={loading}>
          {tr("kitchen.kitchenapp.obnovit_spisok")}
        </button>
        <button className="kds-linkbtn" type="button" onClick={onForget}>
          {tr("kitchen.kitchenapp.smenit_organizatsiyu")}
        </button>
      </div>
    </AuthShell>
  );
}

// ── Экран ─────────────────────────────────────────────────────────────────

export default function KitchenApp() {
  // Экран настраивается один раз (логин+пароль филиала), дальше повара
  // входят только по PIN — это главный сценарий у плиты.
  const [deviceReady, setDeviceReady] = useState(() => hasKdsDevice());
  const [authed, setAuthed] = useState(() => isKdsAuthenticated());
  const [branch, setBranch] = useState(() => getKdsBranch());
  const [cookName, setCookName] = useState(() => getKdsCookName());
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Два способа привязки экрана: логин моноблока (основной) и старый
  // логин филиала — заведениям, где моноблока ещё нет.
  const [setupMode, setSetupMode] = useState("monoblock");
  const [setupError, setSetupError] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  // У сети несколько филиалов — сервер возвращает список вместо токена.
  const [branchChoices, setBranchChoices] = useState(null);
  const [cooks, setCooks] = useState([]);
  const [cooksLoading, setCooksLoading] = useState(false);
  const [cooksError, setCooksError] = useState("");
  const [selectedCook, setSelectedCook] = useState(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [soundOn, setSoundOn] = useState(true);
  const [online, setOnline] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState("all");
  const seenIdsRef = useRef(null);
  const requestVersionRef = useRef(0);
  const mutationRef = useRef(false);
  const toastTimerRef = useRef(null);
  const pinInputRef = useRef(null);
  // Зеркало PIN в ref: два быстрых тапа подряд идут в одном кадре, и чтение
  // pin из замыкания теряло вторую цифру. Значение ведём через ref.
  const pinValueRef = useRef("");

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  function flashToast(text) {
    setToast(text);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 3200);
  }

  // Тикающий таймер карточек (раз в секунду)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Поле PIN держим в фокусе: повар может набирать и с физической клавиатуры,
  // и с экранной — ввод идёт в одно и то же поле.
  useEffect(() => {
    if (deviceReady && !authed) pinInputRef.current?.focus();
  }, [deviceReady, authed, pinError]);

  const loadOrders = useCallback(async () => {
    const version = ++requestVersionRef.current;
    const data = await kdsGetOrders();
    const list = data?.items ?? data ?? [];
    if (version !== requestVersionRef.current) return null;
    const next = Array.isArray(list) ? list : [];
    setOrders(next);
    setError(null);
    setOnline(true);
    return next;
  }, []);

  // Повара филиала: нужны только на экране выбора, поэтому грузим их
  // после привязки и до входа повара, пока PIN ещё не введён.
  const loadCooks = useCallback(async () => {
    setCooksLoading(true);
    setCooksError("");
    try {
      const list = await kdsGetCooks();
      setCooks(list);
      return list;
    } catch (err) {
      if (err?.response?.status === 401) {
        // Сессия терминала истекла — возвращаемся к привязке экрана.
        forgetKdsDevice();
        setDeviceReady(false);
        setBranch(null);
        setCooks([]);
        return [];
      }
      setCooksError(
        err?.response?.data?.detail || "Не удалось загрузить список поваров. Проверьте связь.",
      );
      return [];
    } finally {
      setCooksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!deviceReady || authed) return;
    loadCooks();
  }, [deviceReady, authed, loadCooks]);

  // Первичная загрузка после входа повара: филиал уже известен из настройки
  // экрана, поэтому сразу тянем заказы.
  useEffect(() => {
    if (!authed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await loadOrders();
        if (!cancelled && list) seenIdsRef.current = new Set(list.map((o) => String(o.id)));
      } catch (e) {
        if (!cancelled) {
          if (e?.response?.status === 401) {
            setAuthed(false);
          } else {
            setError(e);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authed, loadOrders]);

  useEffect(() => {
    if (!authed || !branch?.id) return;
    let stopped = false;
    let socket = null;
    let reconnectTimer;

    const refresh = async () => {
      try {
        const list = await loadOrders();
        if (stopped || !list) return;
        const prev = seenIdsRef.current;
        if (prev) {
          const fresh = list.filter((o) => !prev.has(String(o.id)));
          if (fresh.length) {
            beep(soundOn);
            flashToast(tr("kitchen.kitchenapp.new_orders", { n: fresh.length }));
          }
        }
        seenIdsRef.current = new Set(list.map((o) => String(o.id)));
      } catch (err) {
        if (stopped) return;
        setOnline(false);
        if (err?.response?.status === 401) setAuthed(false);
      }
    };

    const connect = () => {
      if (stopped) return;
      try {
        const url = kdsWsUrl(branch.id);
        if (!url) return;
        socket = new WebSocket(url);
        socket.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            const name = payload?.event || payload?.type || "";
            if (["new_order", "order_updated", "order_cancelled", "item_status_changed", "order_completed"].includes(name)) {
              refresh();
            }
          } catch {
            // Polling recovers missed or malformed events.
          }
        };
        socket.onclose = () => {
          if (!stopped) reconnectTimer = setTimeout(connect, 3000);
        };
        socket.onopen = refresh;
      } catch {
        reconnectTimer = setTimeout(connect, 3000);
      }
    };
    connect();
    const pollTimer = setInterval(refresh, 5000);

    return () => {
      stopped = true;
      ++requestVersionRef.current;
      clearTimeout(reconnectTimer);
      clearInterval(pollTimer);
      socket?.close();
    };
  }, [authed, branch?.id, loadOrders, soundOn]);

  // Привязка экрана: логин+пароль моноблока с правом «Кухня» (основной
  // сценарий) или старый логин филиала. После успеха повара входят по PIN.
  async function connectDevice({ branchId } = {}) {
    if (setupBusy) return;
    setSetupBusy(true);
    setSetupError("");
    try {
      const value = setupMode === "monoblock" ? toFullPhone(login) : login.trim();
      await kdsConnectDevice(value, password, { mode: setupMode, branchId });
      setPassword("");
      setBranchChoices(null);
      setBranch(getKdsBranch());
      setDeviceReady(true);
      setPinValue("");
      setPinError("");
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;

      // Сеть с несколькими филиалами: экран нельзя привязать «вообще»,
      // сервер отдаёт список — показываем его вместо формы.
      if (status === 409 && detail && typeof detail === "object") {
        setBranchChoices(Array.isArray(detail.branches) ? detail.branches : []);
        setSetupError(detail.message || tr("kitchen.kitchenapp.vyberite_filial"));
        return;
      }

      if (setupMode === "monoblock") {
        setSetupError(
          status === 403
            ? typeof detail === "string" && detail
              ? detail
              : tr("kitchen.kitchenapp.kuhnya_vyklyuchena_v_kartochke")
            : status === 401
              ? tr("kitchen.kitchenapp.nevernyy_telefon_ili_parol_monobloka")
              : typeof detail === "string" && detail
                ? detail
                : tr("kitchen.kitchenapp.ne_udalos_podklyuchit_ekran"),
        );
        return;
      }

      // 401 у филиала почти всегда означает не «опечатку», а то, что у
      // филиала вообще не задан логин/пароль (Настройки → Филиалы) — без
      // этого подсказки владелец ищет проблему в PIN повара.
      setSetupError(
        status === 401
          ? typeof detail === "string" && detail
            ? `${detail}. ${tr("kitchen.kitchenapp.login_filiala_iz_nastroyek")}`
            : tr("kitchen.kitchenapp.nevernyy_login_ili_parol_filiala")
          : typeof detail === "string" && detail
            ? detail
            : tr("kitchen.kitchenapp.ne_udalos_podklyuchit_ekran"),
      );
    } finally {
      setSetupBusy(false);
    }
  }

  function handleSetupSubmit(event) {
    event.preventDefault();
    if (setupBusy) return;
    // Поле маскированное: в состоянии только 9 локальных цифр, поэтому
    // неполный номер отсекаем до запроса — иначе сервер ответит «неверный
    // логин», хотя проблема лишь в двух недонабранных цифрах.
    if (setupMode === "monoblock" && !isLocalPhoneComplete(login)) {
      setSetupError(tr("kitchen.kitchenapp.nomer_polnostyu"));
      return;
    }
    if (!login.trim() || !password) {
      setSetupError(tr("kitchen.kitchenapp.ukazhite_login_i_parol"));
      return;
    }
    connectDevice();
  }

  function setPinValue(value) {
    pinValueRef.current = value;
    setPin(value);
  }

  async function submitPin(code) {
    if (pinBusy) return;
    setPinBusy(true);
    setPinError("");
    try {
      const data = await kdsPinLogin(code, selectedCook?.id);
      setCookName(data?.user_name || getKdsCookName());
      if (data?.branch) setBranch(data.branch);
      setPinValue("");
      // Доска не должна на кадр показать «Кухня свободна» до первой выборки.
      setLoading(true);
      setAuthed(true);
    } catch (err) {
      setPinValue("");
      setPinError(err?.response?.data?.detail || "Неверный PIN. Попробуйте ещё раз.");
    } finally {
      setPinBusy(false);
    }
  }

  // PIN набирается цифрами и отправляется сам на 4-м символе — повару не
  // нужно искать кнопку «Войти» мокрыми руками.
  function pressDigit(digit) {
    const current = pinValueRef.current;
    if (pinBusy || current.length >= 4) return;
    setPinError("");
    const next = `${current}${digit}`;
    setPinValue(next);
    if (next.length === 4) submitPin(next);
  }

  function pressBackspace() {
    if (pinBusy) return;
    setPinError("");
    setPinValue(pinValueRef.current.slice(0, -1));
  }

  // Ввод с физической клавиатуры идёт в то же поле, что и с экранной:
  // маска, авто-отправка и очистка ошибки — одинаковые.
  function handlePinChange(event) {
    if (pinBusy) return;
    const digits = String(event.target.value || "").replace(/\D/g, "").slice(0, 4);
    setPinError("");
    setPinValue(digits);
    if (digits.length === 4) submitPin(digits);
  }

  // Выход повара: экран остаётся привязан к филиалу, следующий вводит свой PIN.
  async function handleCookLogout() {
    const logout = kdsCookLogout();
    ++requestVersionRef.current;
    setAuthed(false);
    setCookName("");
    setSelectedCook(null);
    setPinValue("");
    setPinError("");
    setOrders([]);
    setError(null);
    setFilter("all");
    seenIdsRef.current = null;
    await logout;
  }

  // Полный сброс устройства: сменить заведение или отдать экран другому.
  function handleForgetDevice() {
    const ok = window.confirm(
      "Отвязать экран от заведения? Понадобится логин моноблока с правом «Кухня».",
    );
    if (!ok) return;
    forgetKdsDevice();
    setDeviceReady(false);
    setAuthed(false);
    setBranch(null);
    setCookName("");
    setCooks([]);
    setCooksError("");
    setSelectedCook(null);
    setBranchChoices(null);
    setOrders([]);
    setPinValue("");
    setLogin("");
    setPassword("");
  }

  async function handleItemStatus(item, status) {
    if (mutationRef.current) return;
    mutationRef.current = true;
    setBusyId(item.id);
    try {
      await kdsSetItemStatus(item.id, status);
      await loadOrders();
    } catch {
      flashToast(tr("kitchen.kitchenapp.save_failed"));
      loadOrders().catch(() => setOnline(false));
    } finally {
      mutationRef.current = false;
      setBusyId(null);
    }
  }

  async function handleOrderReady(order) {
    if (mutationRef.current || orderIsReady(order)) return;
    mutationRef.current = true;
    setBusyId(order.id);
    try {
      await kdsSetOrderReady(order.id);
      await loadOrders();
    } catch {
      flashToast(tr("kitchen.kitchenapp.save_failed"));
      loadOrders().catch(() => setOnline(false));
    } finally {
      mutationRef.current = false;
      setBusyId(null);
    }
  }

  function refreshNow() {
    setError(null);
    setLoading(true);
    loadOrders()
      .then((list) => {
        if (list) seenIdsRef.current = new Set(list.map((o) => String(o.id)));
        setOnline(true);
      })
      .catch((e) => {
        setOnline(false);
        setError(e);
      })
      .finally(() => setLoading(false));
  }

  const summary = useMemo(
    () => ({
      total: orders.length,
      // Заказы, которые горят: ждут больше 20 минут и ещё не готовы целиком.
      urgent: orders.filter(
        (o) => Math.floor((now - parseTs(o.created_at)) / 60000) > 20 && !isReadyOrder(o),
      ).length,
      readyToServe: orders.filter(isReadyOrder).length,
    }),
    [orders, now],
  );

  // Старые заказы — первыми: повар разгребает очередь, а не список.
  // Готовые уходят в конец и дальше сортируются по времени создания.
  const sortedOrders = useMemo(
    () =>
      [...orders].sort((a, b) => {
        const aReady = isReadyOrder(a) ? 1 : 0;
        const bReady = isReadyOrder(b) ? 1 : 0;
        if (aReady !== bReady) return aReady - bReady;
        return parseTs(a.created_at) - parseTs(b.created_at);
      }),
    [orders],
  );

  const visibleOrders = useMemo(() => {
    if (filter === "ready") return sortedOrders.filter(isReadyOrder);
    if (filter === "cooking") return sortedOrders.filter((o) => !isReadyOrder(o));
    return sortedOrders;
  }, [sortedOrders, filter]);

  const clock = clockParts(now);

  // Привязка экрана (один раз на устройстве): логин моноблока с правом
  // «Кухня» либо логин филиала — то же окно, что в десктопе.
  if (!deviceReady) {
    return (
      <AuthShell>
        <BrandHead
          title={tr("kitchen.kitchenapp.ekran_kuhni")}
          sub={
            setupMode === "monoblock"
              ? tr("kitchen.kitchenapp.monoblok_hint")
              : tr("kitchen.kitchenapp.filial_hint")
          }
        />

        {branchChoices ? (
          <div className="kds-branches">
            <h2 className="kds-branches__title">{tr("kitchen.kitchenapp.vyberite_filial")}</h2>
            <p className="kds-branches__hint">
              {tr("kitchen.kitchenapp.u_organizatsii_neskolko_filialov")}
            </p>
            <div className="kds-branches__list">
              {branchChoices.map((item) => (
                <button
                  key={item.id}
                  className="kds-branch"
                  type="button"
                  disabled={setupBusy}
                  onClick={() => connectDevice({ branchId: item.id })}
                >
                  {item.name}
                </button>
              ))}
            </div>
            <button
              className="kds-linkbtn"
              type="button"
              disabled={setupBusy}
              onClick={() => {
                setBranchChoices(null);
                setSetupError("");
              }}
            >
              {tr("kitchen.kitchenapp.nazad")}
            </button>
          </div>
        ) : (
          <>
            <div className="kds-tabs" role="tablist">
              <button
                className={`kds-tab ${setupMode === "monoblock" ? "is-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={setupMode === "monoblock"}
                onClick={() => {
                  setSetupMode("monoblock");
                  setSetupError("");
                }}
              >
                {tr("kitchen.kitchenapp.monoblok")}
              </button>
              <button
                className={`kds-tab ${setupMode === "branch" ? "is-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={setupMode === "branch"}
                onClick={() => {
                  setSetupMode("branch");
                  setSetupError("");
                  setLogin("");
                }}
              >
                {tr("kitchen.kitchenapp.filial")}
              </button>
            </div>

            <form className="kds-form" onSubmit={handleSetupSubmit} noValidate>
              {setupError ? (
                <div className="kds-error" role="alert">
                  <IconAlert size={17} />
                  <span>{setupError}</span>
                </div>
              ) : null}

              <label className="kds-field">
                <span className="kds-field__label">
                  {setupMode === "monoblock"
                    ? tr("kitchen.kitchenapp.telefon_monobloka")
                    : tr("kitchen.kitchenapp.login_filiala")}
                </span>
                {setupMode === "monoblock" ? (
                  /* Та же маска, что в веб-логине: код страны — статичный
                     префикс, в поле живут только 9 локальных цифр. */
                  <span className="kds-field__phone">
                    <strong className="kds-field__prefix">+998</strong>
                    <input
                      className="kds-field__input"
                      type="tel"
                      inputMode="numeric"
                      value={formatLocalPhone(login)}
                      onChange={(e) => setLogin(getLocalPhoneDigits(e.target.value))}
                      placeholder="90 111-22-33"
                      autoComplete="username"
                      spellCheck="false"
                    />
                  </span>
                ) : (
                  <input
                    className="kds-field__input"
                    type="text"
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    placeholder={tr("kitchen.kitchenapp.login_filiala_placeholder")}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck="false"
                  />
                )}
              </label>

              <label className="kds-field">
                <span className="kds-field__label">{tr("kitchen.kitchenapp.parol")}</span>
                <span className="kds-field__pw">
                  <input
                    className="kds-field__input"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                  <button
                    className="kds-eye"
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={
                      showPassword
                        ? tr("kitchen.kitchenapp.skryt_parol")
                        : tr("kitchen.kitchenapp.pokazat_parol")
                    }
                  >
                    {showPassword ? <IconEyeOff size={20} /> : <IconEye size={20} />}
                  </button>
                </span>
              </label>

              <button className="kds-submit" type="submit" disabled={setupBusy}>
                {setupBusy ? <IconSpinner size={18} /> : null}
                {setupBusy
                  ? tr("kitchen.kitchenapp.podklyuchaem")
                  : tr("kitchen.kitchenapp.podklyuchit_ekran")}
              </button>
            </form>
          </>
        )}
      </AuthShell>
    );
  }

  // Повар ещё не вошёл: сначала выбор себя, затем свой PIN.
  if (!authed && !selectedCook) {
    return (
      <CookPicker
        branchName={branch?.name}
        cooks={cooks}
        loading={cooksLoading}
        error={cooksError}
        onPick={(cook) => {
          setSelectedCook(cook);
          setPinValue("");
          setPinError("");
        }}
        onReload={loadCooks}
        onForget={handleForgetDevice}
      />
    );
  }

  // Вход повара: четыре цифры, крупные кнопки, маска в поле.
  if (!authed) {
    return (
      <AuthShell>
        <button
          className="kds-back"
          type="button"
          onClick={() => {
            setSelectedCook(null);
            setPinValue("");
            setPinError("");
          }}
        >
          <IconBack size={20} />
          {tr("kitchen.kitchenapp.vybrat_drugogo")}
        </button>

        <header className="kds-pin-user">
          <span className="kds-pin-user__avatar" aria-hidden="true">
            {cookInitials(selectedCook?.name)}
          </span>
          <span className="kds-pin-user__name">{selectedCook?.name}</span>
          <span className="kds-pin-user__meta">{branch?.name || tr("kitchen.kitchenapp.filial")}</span>
        </header>

        <div className={`kds-pin ${pinError ? "is-error" : ""} ${pinBusy ? "is-busy" : ""}`}>
          {/* Настоящее поле: держит фокус, принимает и экранную, и физическую
              клавиатуру. Само скрыто — рисуем маску из четырёх точек. */}
          <input
            ref={pinInputRef}
            className="kds-pin__input"
            type="text"
            inputMode="none"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={4}
            value={pin}
            onChange={handlePinChange}
            aria-label={tr("kitchen.kitchenapp.pin_povara_4_tsifry")}
          />
          <div
            className="kds-pin__dots"
            aria-hidden="true"
            onClick={() => pinInputRef.current?.focus()}
          >
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`kds-pin__dot ${pin.length > i ? "is-filled" : ""}`} />
            ))}
          </div>
          <p className="kds-pin__msg" role={pinError ? "alert" : undefined}>
            {pinBusy ? (
              <>
                <IconSpinner size={14} /> {tr("kitchen.kitchenapp.proveryaem_pin")}
              </>
            ) : pinError ? (
              pinError
            ) : (
              tr("kitchen.kitchenapp.mozhno_nabirat_na_klaviature")
            )}
          </p>
        </div>

        <div className="kds-pad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
            <button
              key={digit}
              className="kds-key"
              type="button"
              disabled={pinBusy}
              onClick={() => pressDigit(digit)}
            >
              {digit}
            </button>
          ))}
          <span className="kds-key kds-key--empty" aria-hidden="true" />
          <button
            className="kds-key"
            type="button"
            disabled={pinBusy}
            onClick={() => pressDigit("0")}
          >
            0
          </button>
          <button
            className="kds-key kds-key--action"
            type="button"
            disabled={pinBusy || !pin.length}
            onClick={pressBackspace}
            aria-label={tr("kitchen.kitchenapp.steret_poslednyuyu_tsifru")}
          >
            <IconBackspace size={24} />
          </button>
        </div>
      </AuthShell>
    );
  }

  const tabs = [
    { key: "all", label: tr("common.all"), count: summary.total },
    {
      key: "cooking",
      label: tr("kitchen.kitchenapp.v_rabote"),
      count: summary.total - summary.readyToServe,
    },
    {
      key: "ready",
      label: tr("kitchen.kitchenapp.gotovye"),
      count: summary.readyToServe,
    },
  ];

  // Ссылка на ТВ-экран для гостей: филиал известен из привязки устройства,
  // поэтому кухня может открыть табло одним кликом и скопировать адрес.
  const tvHref = branch?.id
    ? `/tv.html?branch=${encodeURIComponent(branch.id)}`
    : null;

  return (
    <div className="kds">
      <Topbar
        branchName={branch?.name}
        cookName={cookName}
        online={online}
        soundOn={soundOn}
        filter={filter}
        tabs={tabs}
        urgent={summary.urgent}
        clock={clock}
        tvHref={tvHref}
        onFilter={setFilter}
        onSound={() => setSoundOn((v) => !v)}
        onRefresh={refreshNow}
        onFullscreen={() => document.documentElement.requestFullscreen?.()}
        onLogout={handleCookLogout}
      />

      <main className="board" aria-busy={loading ? "true" : "false"}>
        {error ? (
          <section className="state">
            <p className="eyebrow">{tr("kitchen.kitchenapp.net_svyazi")}</p>
            <h2 className="state__title">{tr("kitchen.kitchenapp.server_ne_otvechaet")}</h2>
            <p className="state__text">
              {tr("kitchen.kitchenapp.zakazy_ne_zagruzilis_proverte_internet_ekran_sam")}
            </p>
            <button className="btn btn--primary" type="button" onClick={refreshNow}>
              <IconRefresh size={17} />
              {tr("kitchen.kitchenapp.obnovit")}
            </button>
          </section>
        ) : loading ? (
          <>
            {[0, 1, 2, 3].map((i) => (
              <div className="sk-card" key={i} aria-hidden="true">
                <div className="sk sk-card__head" />
                <div className="sk-card__body">
                  <span className="sk" />
                  <span className="sk" />
                  <span className="sk" />
                </div>
              </div>
            ))}
            <p className="board__loading">
              <IconSpinner size={15} /> {tr("kitchen.kitchenapp.zagruzhaem_zakazy")}
            </p>
          </>
        ) : visibleOrders.length ? (
          visibleOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              now={now}
              busyId={busyId}
              onItemStatus={handleItemStatus}
              onOrderReady={handleOrderReady}
            />
          ))
        ) : orders.length ? (
          <section className="state">
            <p className="eyebrow">{tr("kitchen.kitchenapp.filtr")}</p>
            <h2 className="state__title">{tr("kitchen.kitchenapp.zdes_poka_pusto")}</h2>
            <p className="state__text">
              {filter === "ready"
                ? "Все заказы ещё в работе. Как только блюда будут готовы, они появятся здесь."
                : "В работе нет заказов — все блюда уже отданы."}
            </p>
            <button className="btn" type="button" onClick={() => setFilter("all")}>
              {tr("kitchen.kitchenapp.pokazat_vse_zakazy")}
            </button>
          </section>
        ) : (
          <section className="state state--empty">
            <p className="eyebrow">{tr("kitchen.kitchenapp.ochered_pusta")}</p>
            <h2 className="state__title">{tr("kitchen.kitchenapp.kuhnya_svobodna")}</h2>
            <p className="state__text">
              {tr("kitchen.kitchenapp.novye_zakazy_poyavyatsya_zdes_sami_ekran_slushaet")}
            </p>
            <p className="state__sync">
              {tr("kitchen.kitchenapp.poslednyaya_sinhronizatsiya")}{" "}
              <b>
                {clock.hh}:{clock.mm}:{clock.ss}
              </b>
            </p>
          </section>
        )}
      </main>

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          <span className="toast__rail" aria-hidden="true" />
          <span className="toast__text">{toast}</span>
        </div>
      ) : null}
    </div>
  );
}
