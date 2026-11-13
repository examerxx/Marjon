import { useCallback, useEffect, useRef, useState } from "react";
import brandMark from "../assets/brand/marjon-neon-logo-v110.png";
import {
  IconAlert,
  IconCheck,
  IconClock,
  IconEye,
  IconEyeOff,
  IconLogout,
  IconRefresh,
} from "../kitchen/icons.jsx";
import { formatLocalPhone, getLocalPhoneDigits, isLocalPhoneComplete, toFullPhone } from "../utils/phoneMask";
import { t as tr } from "../i18n/t";
import {
  clearExpoSession,
  confirmExpoOrder,
  expoLogin,
  expoLogout,
  fetchExpoOrders,
  getExpoUser,
  isExpoAuthenticated,
} from "./api";

const POLL_MS = 4000;

// Бэкенд отдаёт время в UTC, но SQLite теряет смещение — без «Z» браузер
// прочитал бы метку как локальную и показал возраст заказа на 5 часов больше.
function parseServerDate(iso) {
  if (!iso) return NaN;
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
  return Date.parse(zoned);
}

function minutesSince(iso) {
  const at = parseServerDate(iso);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.round((Date.now() - at) / 60000));
}

function TableBadge({ order }) {
  if (order.table_number) {
    return (
      <span className="expo-table">
        {tr("kitchen.expo.table")} <b>{order.table_number}</b>
      </span>
    );
  }
  return <span className="expo-table expo-table--muted">{order.order_type || "—"}</span>;
}

function ExpoCard({ order, busy, onConfirm }) {
  const items = order.items.filter((item) => item.status !== "cancelled");
  const dishes = items.slice(0, 5);
  const rest = items.length - dishes.length;
  return (
    <article className="expo-card">
      <header className="expo-card__head">
        <span className="expo-card__id">
          <span className="expo-card__eyebrow">{tr("kitchen.tv.order")}</span>
          <span className="expo-card__num">{order.order_number}</span>
        </span>
        <TableBadge order={order} />
      </header>
      <ul className="expo-card__items">
        {dishes.map((item) => (
          <li key={item.id}>
            <b>{Number(item.quantity) || 1}×</b>
            <span>{item.name}</span>
          </li>
        ))}
        {rest > 0 ? <li className="expo-card__more">+{rest}</li> : null}
      </ul>
      <footer className="expo-card__foot">
        <span className="expo-card__age">
          <IconClock size={15} />
          {minutesSince(order.updated_at)} {tr("kitchen.expo.min_short")}
        </span>
        <button type="button" className="expo-confirm" disabled={busy} onClick={() => onConfirm(order.id)}>
          <IconCheck size={20} />
          {busy ? tr("kitchen.expo.confirming") : tr("kitchen.expo.confirm")}
        </button>
      </footer>
    </article>
  );
}

// Вход в раздачу — та же белая карточка на тёмной канве, что у входа
// десктопа и кухни: логотип-знак, маска +998 и глазок у пароля.
function ExpoGate({ onSignedIn }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!isLocalPhoneComplete(phone)) {
      setError(tr("kitchen.expo.phone_incomplete"));
      return;
    }
    if (!password.trim()) {
      setError(tr("kitchen.expo.login_error"));
      return;
    }
    setError("");
    setBusy(true);
    try {
      const user = await expoLogin(toFullPhone(phone), password.trim());
      onSignedIn(user);
    } catch (err) {
      const status = err?.response?.status;
      setError(status === 401 || status === 403
        ? tr("kitchen.expo.login_error")
        : tr("kitchen.expo.network_error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="expo-auth">
      <span className="expo-auth__bg" aria-hidden="true" />
      <section className="expo-gate">
        <header className="expo-brand-head">
          <span className="expo-brand-mark">
            <img src={brandMark} alt="" width={44} height={44} decoding="async" />
            <b>MARJON</b>
          </span>
          <h1 className="expo-gate__title">{tr("kitchen.expo.login_title")}</h1>
          <p className="expo-gate__sub">{tr("kitchen.expo.login_hint")}</p>
        </header>

        <form className="expo-form" onSubmit={submit} noValidate>
          {error ? (
            <div className="expo-error" role="alert">
              <IconAlert size={17} />
              <span>{error}</span>
            </div>
          ) : null}

          <label className="expo-field">
            <span className="expo-field__label">{tr("kitchen.expo.phone")}</span>
            <span className="expo-field__phone">
              <strong className="expo-field__prefix">+998</strong>
              <input
                className="expo-field__input"
                type="tel"
                inputMode="numeric"
                value={formatLocalPhone(phone)}
                onChange={(event) => setPhone(getLocalPhoneDigits(event.target.value))}
                placeholder="90 111-22-33"
                autoComplete="username"
                spellCheck="false"
                aria-label={tr("kitchen.expo.phone")}
              />
            </span>
          </label>

          <label className="expo-field">
            <span className="expo-field__label">{tr("kitchen.expo.password")}</span>
            <span className="expo-field__pw">
              <input
                className="expo-field__input"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-label={tr("kitchen.expo.password")}
              />
              <button
                className="expo-eye"
                type="button"
                aria-label={
                  showPassword ? tr("kitchen.expo.hide_password") : tr("kitchen.expo.show_password")
                }
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <IconEyeOff size={19} /> : <IconEye size={19} />}
              </button>
            </span>
          </label>

          <button type="submit" className="expo-submit" disabled={busy}>
            {busy ? tr("kitchen.expo.signing_in") : tr("kitchen.expo.sign_in")}
          </button>
        </form>
      </section>
    </div>
  );
}

export default function ExpoApp() {
  const [user, setUser] = useState(getExpoUser);
  const [authed, setAuthed] = useState(isExpoAuthenticated);
  const [orders, setOrders] = useState([]);
  const [offline, setOffline] = useState(false);
  const [denied, setDenied] = useState(false);
  // Сетевая сессия без филиала (владелец): сервер просит branch_id, а экран
  // раздачи живёт в одном филиале. Это не «нет связи» — показываем причину.
  const [needsBranch, setNeedsBranch] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const revision = useRef(0);

  const signOut = useCallback(async () => {
    await expoLogout();
    setAuthed(false);
    setUser(null);
    setOrders([]);
    setDenied(false);
    setNeedsBranch(false);
  }, []);

  const load = useCallback(async () => {
    const current = ++revision.current;
    try {
      const data = await fetchExpoOrders();
      if (current !== revision.current) return;
      setOrders(Array.isArray(data) ? data : []);
      setOffline(false);
      setDenied(false);
      setNeedsBranch(false);
    } catch (err) {
      if (current !== revision.current) return;
      const status = err?.response?.status;
      if (status === 401) {
        clearExpoSession();
        setAuthed(false);
        return;
      }
      if (status === 403) {
        setDenied(true);
        return;
      }
      if (status === 422) {
        setNeedsBranch(true);
        setOffline(false);
        return;
      }
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    if (!authed || denied || needsBranch) return undefined;
    let stopped = false;
    let timer;
    const tick = async () => {
      await load();
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [authed, denied, needsBranch, load]);

  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(id);
  }, [notice]);

  const onConfirm = async (orderId) => {
    if (busyId) return;
    setBusyId(orderId);
    try {
      const confirmed = await confirmExpoOrder(orderId);
      setOrders((list) => list.filter((order) => order.id !== orderId));
      setNotice(tr("kitchen.expo.confirmed", { n: confirmed?.order_number ?? "" }));
    } catch {
      setNotice(tr("kitchen.expo.confirm_error"));
      load();
    } finally {
      setBusyId("");
    }
  };

  if (!authed) return <ExpoGate onSignedIn={(me) => { setUser(me); setAuthed(true); }} />;

  return (
    <div className="expo">
      <header className="expo-topbar">
        <div className="expo-topbar__brand">
          <img className="expo-topbar__logo" src={brandMark} alt="" width={40} height={40} />
          <span className="expo-topbar__text">
            <b>{tr("kitchen.expo.title")}</b>
            <small>{user?.name || tr("kitchen.expo.employee")}</small>
          </span>
        </div>
        <span className="expo-topbar__rule" aria-hidden="true" />
        <span className="expo-count">
          {orders.length} {tr("kitchen.expo.waiting_short")}
        </span>
        <div className="expo-topbar__right">
          {offline ? (
            <span className="expo-offline">
              <IconRefresh size={15} />
              {tr("kitchen.tv.offline")}
            </span>
          ) : null}
          <button type="button" className="expo-logout" onClick={signOut}>
            <IconLogout size={17} />
            {tr("kitchen.expo.sign_out")}
          </button>
        </div>
      </header>

      {needsBranch ? (
        <div className="expo-state">
          <p className="expo-state__eyebrow">{tr("kitchen.expo.title")}</p>
          <h2 className="expo-state__title">{tr("kitchen.expo.branch_required_title")}</h2>
          <p className="expo-state__text">{tr("kitchen.expo.branch_required")}</p>
        </div>
      ) : denied ? (
        <div className="expo-state">
          <p className="expo-state__eyebrow">{tr("kitchen.expo.title")}</p>
          <h2 className="expo-state__title">{tr("kitchen.expo.no_access_title")}</h2>
          <p className="expo-state__text">{tr("kitchen.expo.no_access")}</p>
        </div>
      ) : orders.length ? (
        <main className="expo-board">
          {orders.map((order) => (
            <ExpoCard key={order.id} order={order} busy={busyId === order.id} onConfirm={onConfirm} />
          ))}
        </main>
      ) : (
        <div className="expo-state expo-state--empty">
          <p className="expo-state__eyebrow">{tr("kitchen.expo.waiting_short")}</p>
          <h2 className="expo-state__title">{tr("kitchen.expo.empty_title")}</h2>
          <p className="expo-state__text">{tr("kitchen.expo.empty_hint")}</p>
        </div>
      )}

      {notice ? <div className="expo-toast" role="status">{notice}</div> : null}
    </div>
  );
}
