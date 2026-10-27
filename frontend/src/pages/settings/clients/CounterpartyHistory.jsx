import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { financeService } from "../../../api/finance";
import { isAbortError } from "../../../hooks/useAsyncSafety";
import ReportDateRangePicker from "../../../components/ReportDateRangePicker";
import ReportEmptyState from "../../../components/ReportEmptyState";
import { formatTablePhone } from "./phone";
import { toApiDate } from "../../reports/reportPeriod";
import { webDayKey, webFormat, webCalendarToday } from "../../../utils/webTime";
import { t } from "../../../i18n/t";

export const DIRECTION_INCOME = "income";
export const DIRECTION_EXPENSE = "expense";

export function directionLabel(direction) {
  return direction === DIRECTION_EXPENSE ? "Расход" : "Приход";
}

export function formatTxDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return webFormat(value, {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

export function txDay(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return webFormat(value, { day: "2-digit", month: "2-digit", year: "numeric" });
}

function txDayKey(value) {
  return webDayKey(value || "") || String(value || "").slice(0, 10);
}

export function toTxNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export function formatTxMoney(value) {
  return `${toTxNumber(value).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} UZS`;
}

// Deterministic client-side aggregation over a COMPLETE fetched set.
// No invented balances: only sums of real loaded operations.
export function aggregateByDay(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = txDayKey(item?.date);
    const entry = map.get(key) || { date: txDay(item?.date), income: 0, expense: 0, count: 0 };
    const amount = toTxNumber(item?.amount);
    if (item?.direction === DIRECTION_EXPENSE) entry.expense += amount;
    else entry.income += amount;
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, entry]) => entry);
}

export function turnover(items) {
  let income = 0;
  let expense = 0;
  for (const item of items || []) {
    const amount = toTxNumber(item?.amount);
    if (item?.direction === DIRECTION_EXPENSE) expense += amount;
    else income += amount;
  }
  return { income, expense, count: (items || []).length };
}

function defaultPeriod() {
  const now = webCalendarToday();
  const pad = (value) => String(value).padStart(2, "0");
  const fmt = (date) => `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
  const ago = new Date(now);
  ago.setDate(ago.getDate() - 30);
  return { preset: "", start: fmt(ago), end: fmt(now) };
}

function useCounterpartyHistory(counterpartyId, period) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("detailed");

  const load = useCallback(async (range) => {
    if (!counterpartyId) return;
    setLoading(true);
    setError("");
    try {
      // Server-side date filtering (endpoint contract) + full pagination so
      // turnover/aggregation always cover the whole selected period.
      // The canonical finance contract is date-only: DD.MM.YYYY -> YYYY-MM-DD.
      const params = { page: 1, size: 200 };
      const from = range ? toApiDate(range.start) : undefined;
      const to = range ? toApiDate(range.end) : undefined;
      if (from) params.date_from = from;
      if (to) params.date_to = to;
      const first = await financeService.listCounterpartyTransactions(counterpartyId, params);
      const all = [...(first.data?.items || [])];
      const pages = Number(first.data?.pages || 1);
      for (let page = 2; page <= pages; page += 1) {
        const next = await financeService.listCounterpartyTransactions(counterpartyId, { ...params, page });
        all.push(...(next.data?.items || []));
        if (!(next.data?.items || []).length) break;
      }
      setItems(all);
      setTotal(Number(first.data?.total ?? all.length));
    } catch (err) {
      if (!isAbortError(err)) {
        setError(err?.response?.data?.detail || "Не удалось загрузить историю операций.");
        setItems([]);
        setTotal(0);
      }
    } finally {
      setLoading(false);
    }
  }, [counterpartyId]);

  useEffect(() => {
    load(period);
  }, [load, period?.start, period?.end]);

  return { items, total, loading, error, mode, setMode, reload: () => load(period) };
}

export function CounterpartyStatementView({ row }) {
  const [period, setPeriod] = useState(() => defaultPeriod());
  const history = useCounterpartyHistory(row?.id, period);
  const { items, loading, error, mode, setMode } = history;
  const sums = useMemo(() => turnover(items), [items]);
  const daily = useMemo(() => (mode === "simple" ? aggregateByDay(items) : []), [items, mode]);

  // Clients V10: the Simple/Detailed toggle reuses the EXACT Clients
  // segmented-control primitive (.staff-header--cashier .staff-tabs--slider +
  // measured indicator), so shell/border/active pill/teal text/shadow/
  // typography/height/radius (22px) match the directory tabs by construction.
  const modeTabsRef = useRef(null);
  const [modePill, setModePill] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const container = modeTabsRef.current;
    if (!container) return undefined;
    const update = () => {
      const active = container.querySelector(`[data-mode="${mode}"]`);
      if (!active) return;
      setModePill((current) => {
        const next = { left: active.offsetLeft, width: active.offsetWidth };
        return current.left === next.left && current.width === next.width
          ? current
          : next;
      });
    };
    update();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(container);
      container.querySelectorAll("[data-mode]").forEach((segment) => ro.observe(segment));
    } else {
      window.addEventListener("resize", update);
    }
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [mode]);

  // Clients V10: the period picker uses the SAME controlled invocation as the
  // accepted Reports pages (variant="canonical" + animateExit + open +
  // onOpenChange + onExitComplete). Previously it was uncontrolled with no
  // animateExit, so it unmounted instantly on close (no exit animation), and
  // the Reports open animation never applied either — its CSS is scoped to
  // report page shells, which this view never carried until now.
  const [panelState, setPanelState] = useState({ active: "", closing: "", pending: "" });
  useEffect(() => {
    if (!panelState.closing) return undefined;
    function cancelPendingOnOutsideClick(event) {
      if (!event.target.closest?.(".orders-filter-select, .report-period-picker")) {
        setPanelState((current) => ({ ...current, pending: "" }));
      }
    }
    document.addEventListener("mousedown", cancelPendingOnOutsideClick);
    return () => document.removeEventListener("mousedown", cancelPendingOnOutsideClick);
  }, [panelState.closing]);
  function requestPanel(panelId) {
    setPanelState((current) => {
      if (current.closing) {
        const nextPending = current.pending === panelId ? "" : panelId;
        return { ...current, pending: nextPending };
      }
      if (!current.active) return panelId ? { active: panelId, closing: "", pending: "" } : current;
      return {
        active: "",
        closing: current.active,
        pending: current.active === panelId ? "" : panelId,
      };
    });
  }
  function completePanelExit(panelId) {
    setPanelState((current) => {
      if (current.closing !== panelId) return current;
      return { active: current.pending, closing: "", pending: "" };
    });
  }

  // No local back button here by design (Clients V10): the global/topbar Back
  // returns to the Clients directory and restores the source tab via
  // ?tab=…&history=… navigation state owned by SettingsResourcePage.
  return (
    <div className="settings-page settings-owner-view clients-directory-page client-statement-page">
      <section className="settings-card">
        <header className="settings-header client-statement-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" />
            <div>
              <p>{t("pages.settings.clients.counterpartyhistory.istoriya_tranzaktsiy")}</p>
              <div className="client-statement-identity">
                <h1>{row?.name || "-"}</h1>
                {row?.phone ? <span className="client-statement-phone">{formatTablePhone(row.phone)}</span> : null}
              </div>
            </div>
          </div>
          <div className="client-statement-right staff-header--cashier">
            <div className="staff-tabs staff-tabs--slider" role="group" aria-label={t("pages.settings.clients.counterpartyhistory.rezhim")} data-active={mode} ref={modeTabsRef}>
              <span
                className="staff-tabs__indicator"
                aria-hidden="true"
                style={{ transform: `translateX(${modePill.left}px)`, width: modePill.width }}
              />
              <button type="button" data-mode="simple" className={mode === "simple" ? "is-active" : ""} onClick={() => setMode("simple")}>{t("pages.settings.clients.counterpartyhistory.prostoy")}</button>
              <button type="button" data-mode="detailed" className={mode === "detailed" ? "is-active" : ""} onClick={() => setMode("detailed")}>{t("pages.settings.clients.counterpartyhistory.podrobnyy")}</button>
            </div>
            <ReportDateRangePicker
              variant="canonical"
              animateExit
              value={period}
              onChange={setPeriod}
              open={panelState.active === "period"}
              onOpenChange={(nextOpen) => requestPanel(nextOpen ? "period" : "")}
              onExitComplete={() => completePanelExit("period")}
              buttonAriaLabel="Период истории транзакций"
            />
          </div>
        </header>

        <div className="staff-table-wrapper client-statement-table-region">
          {loading ? <div className="settings-empty-state">{t("pages.settings.clients.counterpartyhistory.zagruzka")}</div> : null}
          {!loading && error ? <div className="settings-empty-state" role="alert">{error}</div> : null}
          {!loading && !error && !items.length ? (
            <div className="client-statement-empty">
              <ReportEmptyState title={t("pages.settings.clients.counterpartyhistory.net_tranzaktsiy_za_vybrannyy_period")} />
            </div>
          ) : null}

          {!loading && !error && items.length > 0 ? (
            <>
              <table className="staff-table client-statement-table">
                <thead>
                  <tr>
                    <th>{t("pages.settings.clients.counterpartyhistory.data")}</th>
                    {mode === "simple" ? <th>{t("pages.settings.clients.counterpartyhistory.operatsiy")}</th> : <th>{t("pages.settings.clients.counterpartyhistory.operatsiya")}</th>}
                    <th>{t("pages.settings.clients.counterpartyhistory.prihod")}</th>
                    <th>{t("pages.settings.clients.counterpartyhistory.rashod")}</th>
                    {mode === "detailed" ? <th>{t("pages.settings.clients.counterpartyhistory.kommentariy")}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {mode === "simple" ? daily.map((day) => (
                    <tr key={day.date}>
                      <td>{day.date}</td>
                      <td>{day.count}</td>
                      <td>{day.income > 0 ? formatTxMoney(day.income) : "-"}</td>
                      <td>{day.expense > 0 ? formatTxMoney(day.expense) : "-"}</td>
                    </tr>
                  )) : items.map((item) => (
                    <tr key={item.id || `${item.date}-${item.amount}`}>
                      <td>{formatTxDate(item.date)}</td>
                      <td>{directionLabel(item.direction)}</td>
                      <td>{item.direction === DIRECTION_EXPENSE ? "-" : formatTxMoney(item.amount)}</td>
                      <td>{item.direction === DIRECTION_EXPENSE ? formatTxMoney(item.amount) : "-"}</td>
                      <td>{item.comment || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="client-statement-summary">
                <span>{t("pages.settings.clients.counterpartyhistory.oboroty_za_period_prihod")} {formatTxMoney(sums.income)} {t("pages.settings.clients.counterpartyhistory.rashod_2")} {formatTxMoney(sums.expense)}</span>
                <span>{t("pages.settings.clients.counterpartyhistory.operatsiy_2")} {sums.count}</span>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
