// Отдельный KDS-экран поваров: заказы, блюда, «Готово» в одно касание.
// Не входит в админку (/), десктоп и мобилу: свой entry kitchen.html -> src/kitchen/main.jsx.
//
// Дизайн: тёмная доска (navy) с «чеками» заказов. Тёмный фон выбран не ради
// моды — экран висит на кухне весь день, а светлая доска слепит и теряет
// контраст под бликами. Возраст заказа читается по цвету каймы и таймера:
// teal → янтарь (10 мин) → красный (20 мин).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forgetKdsDevice,
  getKdsBranch,
  getKdsCookName,
  hasKdsDevice,
  isKdsAuthenticated,
  kdsConnectDevice,
  kdsCookLogout,
  kdsGetOrders,
  kdsPinLogin,
  kdsSetItemStatus,
  kdsSetOrderReady,
  kdsWsUrl,
} from "./api";
import logo from "../assets/brand/marjon-logo.svg";
import {
  formatLocalPhone,
  getLocalPhoneDigits,
  isLocalPhoneComplete,
  toFullPhone,
} from "../utils/phoneMask";
import {
  IconAlert,
  IconArrow,
  IconBackspace,
  IconCheck,
  IconExpand,
  IconLogout,
  IconRefresh,
  IconSound,
  IconSoundOff,
  IconSpinner,
  IconWifi,
  IconWifiOff,
} from "./icons.jsx";

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
  if (s === "cooking" || s === "in_progress") return "cooking";
  return "pending";
}

function isAllReady(order) {
  const items = order.items ?? [];
  return items.length > 0 && items.every((i) => itemState(i) === "ready");
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

function DishRow({ item, busy, onStatus }) {
  const st = itemState(item);
  const modifiers = Array.isArray(item.modifiers)
    ? item.modifiers
        .map((m) => (typeof m === "string" ? m : m?.name))
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <li className={`dish is-${st}`}>
      <span className="dish__qty">
        {formatQty(item.quantity)}
        <i>×</i>
      </span>

      <span className="dish__text">
        <span className="dish__name">{item.name || "Блюдо"}</span>
        {modifiers ? <span className="dish__mods">{modifiers}</span> : null}
        {item.note ? <span className="dish__note">{item.note}</span> : null}
        {item.takeaway ? <span className="dish__tag">с собой</span> : null}
      </span>

      {st === "ready" ? (
        <span className="dish__done">
          <IconCheck size={18} />
          <span>Готово</span>
        </span>
      ) : (
        <button
          className={`dish__act ${st === "cooking" ? "is-ready" : ""}`}
          type="button"
          disabled={busy}
          onClick={() => onStatus(item, st === "cooking" ? "ready" : "cooking")}
        >
          {busy ? <IconSpinner size={16} /> : st === "cooking" ? <IconCheck size={16} /> : null}
          {st === "cooking" ? "Готово" : "Готовить"}
        </button>
      )}
    </li>
  );
}

// ── Чек заказа ────────────────────────────────────────────────────────────
//
// Левая «корешок»-колонка держит стол и таймер: повар смотрит туда, а не
// вычитывает номер в строке. Правка блюд — в теле чека, отдача заказа —
// отдельной строкой внизу, чтобы её нельзя было нажать случайно.

function Ticket({ order, now, busyId, onItemStatus, onOrderReady }) {
  const items = order.items ?? [];
  const readyCount = items.filter((i) => itemState(i) === "ready").length;
  const allReady = isAllReady(order);
  const mins = Math.floor(Math.max(0, now - parseTs(order.created_at)) / 60000);
  const tone = mins >= 20 ? "urgent" : mins >= 10 ? "late" : "fresh";
  const type = typeLabel(order);
  const left = items.length - readyCount;

  return (
    <article className={`ticket ticket--${tone}`} aria-label={`Заказ ${orderNumber(order)}`}>
      <header className="ticket__head">
        <div className="ticket__id">
          <span className="ticket__label">{order.table_number ? "Стол" : type || "Заказ"}</span>
          <span className={order.table_number ? "ticket__table" : "ticket__type"}>
            {order.table_number || type || "—"}
          </span>
          <span className="ticket__num">
            № {orderNumber(order)}
            {order.table_number && type ? ` · ${type}` : ""}
          </span>
        </div>

        <span className="ticket__timer" title="Время с момента заказа">
          <i className={`ticket__dot is-${tone}`} aria-hidden="true" />
          {formatElapsed(order.created_at, now)}
        </span>
      </header>

      <div className="ticket__body">
        {order.note ? (
          <p className="ticket__note">
            <IconAlert size={15} />
            <span>{order.note}</span>
          </p>
        ) : null}

        <ul className="ticket__dishes">
          {items.map((item) => (
            <DishRow
              key={item.id}
              item={item}
              busy={busyId === item.id}
              onStatus={onItemStatus}
            />
          ))}
        </ul>
      </div>

      <footer className="ticket__foot">
        <span className="ticket__ratio">
          <b>{readyCount}</b>
          <span>/{items.length}</span>
        </span>

        <span className="ticket__ticks" aria-hidden="true">
          {items.map((item) => (
            <i key={item.id} className={itemState(item) === "ready" ? "is-on" : ""} />
          ))}
        </span>

        <button
          className="ticket__serve"
          type="button"
          disabled={!allReady || busyId === order.id}
          onClick={() => onOrderReady(order)}
          aria-label={
            allReady
              ? "Отдать заказ"
              : `Заказ не готов: осталось ${left} ${plural(left, "блюдо", "блюда", "блюд")}`
          }
        >
          {busyId === order.id ? (
            <IconSpinner size={16} />
          ) : allReady ? (
            <>
              Отдать
              <IconArrow size={16} />
            </>
          ) : (
            `Ждём ${left}`
          )}
        </button>
      </footer>
    </article>
  );
}

// ── Левая стойка с инструментами ──────────────────────────────────────────

function Rail({ online, soundOn, onSound, onRefresh, onFullscreen, onLogout }) {
  return (
    <aside className="rail">
      <div className="rail__mark" aria-label="MARJON">
        M
      </div>

      <div
        className={`rail__conn ${online ? "is-on" : "is-off"}`}
        title={online ? "Связь с сервером есть" : "Нет связи с сервером"}
      >
        {online ? <IconWifi size={16} /> : <IconWifiOff size={16} />}
        <span className="rail__conn-text">{online ? "онлайн" : "офлайн"}</span>
      </div>

      <div className="rail__tools">
        <button
          className={`rail__btn ${soundOn ? "is-on" : ""}`}
          type="button"
          onClick={onSound}
          title={soundOn ? "Звук включён" : "Звук выключен"}
          aria-pressed={soundOn}
          aria-label={soundOn ? "Выключить звук" : "Включить звук"}
        >
          {soundOn ? <IconSound size={19} /> : <IconSoundOff size={19} />}
        </button>

        <button
          className="rail__btn"
          type="button"
          onClick={onRefresh}
          title="Обновить заказы"
          aria-label="Обновить заказы"
        >
          <IconRefresh size={19} />
        </button>

        <button
          className="rail__btn"
          type="button"
          onClick={onFullscreen}
          title="Во весь экран"
          aria-label="Во весь экран"
        >
          <IconExpand size={19} />
        </button>
      </div>

      <button
        className="rail__btn rail__btn--out"
        type="button"
        onClick={onLogout}
        title="Сменить повара"
        aria-label="Сменить повара"
      >
        <IconLogout size={19} />
      </button>
    </aside>
  );
}

// ── Общая оболочка экранов входа ──────────────────────────────────────────

function GateAside({ eyebrow, title, facts, footer }) {
  return (
    <aside className="gate__aside">
      <div className="gate__brand">
        {/* Тот же знак, что в веб-логине и сайдбаре: кухня — часть продукта,
            а не отдельное приложение со своим логотипом. */}
        <img src={logo} alt="" width={44} height={44} decoding="async" />
        <span className="gate__wordmark">
          Marjon
          <small>кухонный экран</small>
        </span>
      </div>

      <div className="gate__pitch">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="gate__title">{title}</h1>
      </div>

      <div className="gate__tail">
        <ol className="gate__facts">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ol>

        <div className="gate__foot">{footer}</div>
      </div>
    </aside>
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
  const [setupError, setSetupError] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
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
  const seenIdsRef = useRef(new Set());
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
    const data = await kdsGetOrders();
    const list = data?.items ?? data ?? [];
    setOrders(Array.isArray(list) ? list : []);
    return Array.isArray(list) ? list : [];
  }, []);

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
        if (!cancelled) seenIdsRef.current = new Set(list.map((o) => String(o.id)));
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

  // Живые обновления: WS кухни + опрос-резерв каждые 5 сек
  useEffect(() => {
    if (!authed || !branch?.id) return;
    let stopped = false;
    let socket = null;
    let pollTimer = null;

    const refresh = async (announce = false) => {
      try {
        const list = await loadOrders();
        if (stopped) return;
        setOnline(true);
        const prev = seenIdsRef.current;
        if (prev.size > 0) {
          const fresh = list.filter((o) => !prev.has(String(o.id)));
          if (fresh.length) {
            beep(soundOn);
            if (announce) flashToast(`Новый заказ: ${fresh.length}`);
          }
        }
        seenIdsRef.current = new Set(list.map((o) => String(o.id)));
      } catch {
        if (!stopped) setOnline(false);
        // Ошибку показывает ручной refresh и следующий тик опроса
      }
    };

    try {
      const url = kdsWsUrl(branch.id);
      if (url) {
        socket = new WebSocket(url);
        socket.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            const name = payload?.event || payload?.type || "";
            if (["new_order", "order_updated", "order_cancelled", "item_status_changed"].includes(name)) {
              refresh(name === "new_order");
            }
          } catch {
            // Битый WS-кадр игнорируем — опрос всё равно подтянет
          }
        };
        socket.onclose = () => {
          if (!stopped && !pollTimer) pollTimer = setInterval(() => refresh(false), 5000);
        };
        socket.onopen = () => {
          setOnline(true);
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        };
      }
    } catch {
      // Нет WS — остаёмся на опросе
    }
    pollTimer = setInterval(() => refresh(false), 5000);
    refresh(false);

    return () => {
      stopped = true;
      try {
        socket?.close();
      } catch {
        // ignore
      }
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [authed, branch?.id, loadOrders, soundOn]);

  // Первичная настройка экрана: логин+пароль филиала (как у десктопа).
  async function handleSetupSubmit(event) {
    event.preventDefault();
    if (setupBusy) return;
    // Поле маскированное: в состоянии только 9 локальных цифр, поэтому
    // неполный номер отсекаем до запроса — иначе сервер ответит «неверный
    // логин», хотя проблема лишь в двух недонабранных цифрах.
    const branchLogin = isLocalPhoneComplete(login) ? toFullPhone(login) : login.trim();
    if (!branchLogin || !password) {
      setSetupError("Укажите логин и пароль филиала.");
      return;
    }
    if (!isLocalPhoneComplete(login)) {
      setSetupError("Номер филиала вводится полностью: +998 90 111-22-33.");
      return;
    }
    setSetupError("");
    setSetupBusy(true);
    try {
      await kdsConnectDevice(branchLogin, password);
      setPassword("");
      setBranch(getKdsBranch());
      setDeviceReady(true);
      setPinValue("");
      setPinError("");
    } catch (err) {
      // 401 у филиала почти всегда означает не «опечатку», а то, что у
      // филиала вообще не задан логин/пароль (Настройки → Филиалы) — без
      // этого подсказки владелец ищет проблему в PIN повара.
      const detail = err?.response?.data?.detail;
      setSetupError(
        err?.response?.status === 401
          ? detail
            ? `${detail}. Логин и пароль филиала задаются в админке: Настройки → Филиалы.`
            : "Неверный логин или пароль филиала. Проверьте их в админке: Настройки → Филиалы."
          : detail || "Не удалось подключить экран. Проверьте связь и попробуйте ещё раз.",
      );
    } finally {
      setSetupBusy(false);
    }
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
      const data = await kdsPinLogin(code);
      setCookName(data?.user_name || getKdsCookName());
      if (data?.branch) setBranch(data.branch);
      setPinValue("");
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
    await kdsCookLogout();
    setAuthed(false);
    setCookName("");
    setPinValue("");
    setPinError("");
    setOrders([]);
    setError(null);
    setFilter("all");
    seenIdsRef.current = new Set();
  }

  // Полный сброс устройства: сменить филиал или отдать экран другому заведению.
  function handleForgetDevice() {
    const ok = window.confirm("Отвязать экран от филиала? Понадобится логин и пароль филиала.");
    if (!ok) return;
    forgetKdsDevice();
    setDeviceReady(false);
    setAuthed(false);
    setBranch(null);
    setCookName("");
    setOrders([]);
    setPinValue("");
    setLogin("");
  }

  // Оптимистичный перевод позиции: интерфейс отвечает мгновенно
  async function handleItemStatus(item, status) {
    setBusyId(item.id);
    setOrders((prev) =>
      prev.map((o) => ({
        ...o,
        items: (o.items ?? []).map((it) => (it.id === item.id ? { ...it, status } : it)),
      })),
    );
    try {
      await kdsSetItemStatus(item.id, status);
      await loadOrders();
    } catch {
      // Откатываемся к серверному состоянию
      loadOrders().catch(() => {});
    } finally {
      setBusyId(null);
    }
  }

  async function handleOrderReady(order) {
    setBusyId(order.id);
    try {
      await kdsSetOrderReady(order.id);
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
    } catch {
      loadOrders().catch(() => {});
    } finally {
      setBusyId(null);
    }
  }

  function refreshNow() {
    setError(null);
    setLoading(true);
    loadOrders()
      .then((list) => {
        seenIdsRef.current = new Set(list.map((o) => String(o.id)));
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
        (o) => Math.floor((now - parseTs(o.created_at)) / 60000) > 20 && !isAllReady(o),
      ).length,
      readyToServe: orders.filter(isAllReady).length,
    }),
    [orders, now],
  );

  // Старые заказы — первыми: повар разгребает очередь, а не список.
  const sortedOrders = useMemo(
    () => [...orders].sort((a, b) => parseTs(a.created_at) - parseTs(b.created_at)),
    [orders],
  );

  const visibleOrders = useMemo(() => {
    if (filter === "ready") return sortedOrders.filter(isAllReady);
    if (filter === "cooking") return sortedOrders.filter((o) => !isAllReady(o));
    return sortedOrders;
  }, [sortedOrders, filter]);

  const clock = clockParts(now);

  // Настройка экрана (один раз на устройстве): логин+пароль филиала
  if (!deviceReady) {
    return (
      <div className="gate">
        <GateAside
          eyebrow="Первый запуск"
          title={
            <>
              Один раз настроить,
              <br />
              дальше — только PIN
            </>
          }
          facts={[
            "Логин и пароль филиала вводятся один раз",
            "PIN повара — четыре цифры на смену",
            "Экран запоминает филиал сам",
          ]}
          footer={<span className="gate__note">MARJON POS · кухня</span>}
        />

        <section className="gate__panel">
          <header className="gate__head">
            <p className="eyebrow">Подключение</p>
            <h2 className="gate__panel-title">Экран кухни</h2>
            <p className="gate__hint">
              Это логин и пароль <strong>филиала</strong> из карточки филиала
              (Настройки → Филиалы), а не пароль повара. По ним экран находит свою
              кухню; повара входят по PIN.
            </p>
          </header>

          <form className="form" onSubmit={handleSetupSubmit} noValidate>
            {setupError ? (
              <div className="alert" role="alert">
                <IconAlert size={17} />
                <span>{setupError}</span>
              </div>
            ) : null}

            <label className="field">
              <span className="field__label">Логин филиала</span>
              {/* Та же маска, что в веб-логине: код страны — статичный
                  префикс, в поле живут только 9 локальных цифр. Раньше номер
                  вводился сырым текстом, и «+998 90…», «998901…», «90…»
                  давали три разных запроса. */}
              <div className="field__phone">
                <strong className="field__phone-prefix">+998</strong>
                <input
                  className="field__input"
                  type="tel"
                  inputMode="numeric"
                  value={formatLocalPhone(login)}
                  onChange={(e) => setLogin(getLocalPhoneDigits(e.target.value))}
                  placeholder="90 111-22-33"
                  autoComplete="tel-national"
                  spellCheck="false"
                />
              </div>
            </label>

            <label className="field">
              <span className="field__label">Пароль филиала</span>
              <input
                className="field__input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </label>

            <button className="btn btn--primary btn--block" type="submit" disabled={setupBusy}>
              {setupBusy ? <IconSpinner size={18} /> : null}
              {setupBusy ? "Подключаем…" : "Подключить экран"}
            </button>
          </form>
        </section>
      </div>
    );
  }

  // Вход повара: четыре цифры, крупные кнопки, маска в поле
  if (!authed) {
    return (
      <div className="gate">
        <GateAside
          eyebrow="Смена"
          title={
            <>
              Четыре цифры —
              <br />
              и кухня под контролем
            </>
          }
          facts={[
            "Заказы приходят сами, без обновления страницы",
            "Готовность блюда — одно касание",
            "Экран помнит филиал между сменами",
          ]}
          footer={
            <button className="linkbtn" type="button" onClick={handleForgetDevice}>
              Сбросить привязку экрана
            </button>
          }
        />

        <section className="gate__panel">
          <header className="gate__head">
            <p className="eyebrow">{branch?.name || "Филиал"}</p>
            <h2 className="gate__panel-title">Вход повара</h2>
            <p className="gate__hint">Введите PIN из четырёх цифр — вход произойдёт сам.</p>
          </header>

          <div className={`pin ${pinError ? "is-error" : ""} ${pinBusy ? "is-busy" : ""}`}>
            {/* Настоящее поле: держит фокус, принимает и экранную, и физическую
                клавиатуру. Само скрыто — рисуем маску из четырёх ячеек. */}
            <input
              ref={pinInputRef}
              className="pin__input"
              type="text"
              inputMode="none"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={4}
              value={pin}
              onChange={handlePinChange}
              aria-label="PIN повара, 4 цифры"
            />
            <div
              className="pin__slots"
              aria-hidden="true"
              onClick={() => pinInputRef.current?.focus()}
            >
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={`pin__slot ${pin.length > i ? "is-filled" : ""}`} />
              ))}
            </div>
            <p className="pin__msg" role={pinError ? "alert" : undefined}>
              {pinBusy ? (
                <>
                  <IconSpinner size={14} /> Проверяем PIN
                </>
              ) : pinError ? (
                pinError
              ) : (
                "Можно набирать на клавиатуре экрана"
              )}
            </p>
          </div>

          <div className="keypad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
              <button
                key={digit}
                className="keypad__key"
                type="button"
                disabled={pinBusy}
                onClick={() => pressDigit(digit)}
              >
                {digit}
              </button>
            ))}
            <span className="keypad__gap" aria-hidden="true" />
            <button
              className="keypad__key"
              type="button"
              disabled={pinBusy}
              onClick={() => pressDigit("0")}
            >
              0
            </button>
            <button
              className="keypad__key keypad__key--ghost"
              type="button"
              disabled={pinBusy || !pin.length}
              onClick={pressBackspace}
              aria-label="Стереть последнюю цифру"
            >
              <IconBackspace size={22} />
            </button>
          </div>
        </section>
      </div>
    );
  }

  const tabs = [
    { key: "all", label: "Все", count: summary.total },
    { key: "cooking", label: "Готовим", count: summary.total - summary.readyToServe },
    { key: "ready", label: "К отдаче", count: summary.readyToServe },
  ];

  return (
    <div className="kds">
      <Rail
        online={online}
        soundOn={soundOn}
        onSound={() => setSoundOn((v) => !v)}
        onRefresh={refreshNow}
        onFullscreen={() => document.documentElement.requestFullscreen?.()}
        onLogout={handleCookLogout}
      />

      <div className="kds__main">
        <header className="head">
          <div className="head__id">
            <p className="eyebrow">
              Кухня · {branch?.name || "филиал"}
            </p>
            <h1 className="head__title">{cookName || "Повар"}</h1>
          </div>

          <div className="head__tabs" role="group" aria-label="Фильтр заказов">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={`tab ${filter === tab.key ? "is-active" : ""}`}
                type="button"
                aria-pressed={filter === tab.key}
                onClick={() => setFilter(tab.key)}
              >
                {tab.label}
                <span className="tab__count">{tab.count}</span>
              </button>
            ))}
          </div>

          {summary.urgent > 0 ? (
            <p className="head__alarm">
              <IconAlert size={15} />
              {summary.urgent} {plural(summary.urgent, "заказ", "заказа", "заказов")}{" "}
              {plural(summary.urgent, "горит", "горят", "горят")}
            </p>
          ) : null}

          <div className="head__clock" aria-label="Текущее время">
            <span className="clock">
              <b>
                {clock.hh}:{clock.mm}
              </b>
              <i>{clock.ss}</i>
            </span>
            <span className="head__date">{clock.date}</span>
          </div>
        </header>

        <main className="board" aria-busy={loading ? "true" : "false"}>
          {error ? (
            <section className="state">
              <p className="eyebrow">Нет связи</p>
              <h2 className="state__title">Сервер не отвечает</h2>
              <p className="state__text">
                Заказы не загрузились. Проверьте интернет — экран сам подхватит очередь, как
                только связь вернётся.
              </p>
              <button className="btn btn--primary" type="button" onClick={refreshNow}>
                <IconRefresh size={17} />
                Обновить
              </button>
            </section>
          ) : loading ? (
            <>
              {[0, 1, 2, 3].map((i) => (
                <div className="sk-ticket" key={i} aria-hidden="true">
                  <div className="sk sk--stub" />
                  <div className="sk sk--body" />
                </div>
              ))}
              <p className="board__loading">
                <IconSpinner size={15} /> Загружаем заказы
              </p>
            </>
          ) : visibleOrders.length ? (
            visibleOrders.map((order) => (
              <Ticket
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
              <p className="eyebrow">Фильтр</p>
              <h2 className="state__title">Здесь пока пусто</h2>
              <p className="state__text">
                {filter === "ready"
                  ? "Все заказы ещё в работе. Как только блюда будут готовы, они появятся здесь."
                  : "В работе нет заказов — все блюда уже отданы."}
              </p>
              <button className="btn" type="button" onClick={() => setFilter("all")}>
                Показать все заказы
              </button>
            </section>
          ) : (
            <section className="state state--empty">
              <div className="state__intro">
                <p className="eyebrow">Очередь пуста</p>
                <h2 className="state__title">Кухня свободна</h2>
                <p className="state__text">
                  Новые заказы появятся здесь сами: экран слушает очередь и обновляется
                  каждые пять секунд.
                </p>
                <p className="state__sync">
                  последняя синхронизация <b>{clock.hh}:{clock.mm}:{clock.ss}</b>
                </p>
              </div>

              {/* Пустые места под чеки: объясняют, что сюда приедут заказы,
                  и не оставляют экран пустым пятном. */}
              <div className="state__slots" aria-hidden="true">
                {[0, 1, 2].map((slot) => (
                  <span className="state__slot" key={slot}>
                    <i />
                    <i />
                    <i />
                  </span>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          <span className="toast__rail" aria-hidden="true" />
          <span className="toast__text">{toast}</span>
        </div>
      ) : null}
    </div>
  );
}
