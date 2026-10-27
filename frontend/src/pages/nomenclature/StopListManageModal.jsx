// Стоп-лист V3.5: centered-модалка «Управление лимитами» для одного Product.
// Два независимых сброса выполняются непосредственно кнопками строк:
//  - Обнулить остаток (POST allowance-zero: daily=0+sold=0, НЕ unlimited);
//  - Обнулить предыдущий лимит (POST history-reset: checkpoint видимости,
//    остаток и audit-строки не трогаем).
// Модалка остаётся открытой после успеха (значения обновляются из refetch);
// при ошибке — значения/ошибка на месте, retry доступен.
// Стиль — язык OWNER settings-modal (глобальный) + scoped stoplist-суффиксы.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import { formatQuantity } from "./stopListFormat";
import { historyView } from "./stopListHistory";
import { t as tr } from "../../i18n/t";

function HistoryText({ row }) {
  const view = historyView(row.recentTopups, { allowance: row.allowance, resetSeq: row.historyResetSeq });
  if (view.kind === "pair") {
    if (view.pair.length === 1) {
      return <span className="stoplist-hist-new">{formatQuantity(view.pair[0])}</span>;
    }
    return (
      <span className="stoplist-hist-pair">
        <span className="stoplist-hist-old">({formatQuantity(view.pair[0])})</span>
        <span className="stoplist-hist-new">{formatQuantity(view.pair[1])}</span>
      </span>
    );
  }
  return <span className="stoplist-hist-empty">—</span>;
}

export default function StopListManageModal({
  row,
  onClose,
  onZeroRemainder,
  onResetHistory,
  savingId,
}) {
  const id = String(row.id);
  const [pending, setPending] = useState(null);
  const pendingRef = useRef(false);
  const busy = String(savingId) === id || pending !== null;
  const [doneFlash, setDoneFlash] = useState(null);
  // Локальная ошибка сброса: модалка открыта, значения целы, retry доступен.
  // 404 = рантайм старше UI (маршрута нет на сервере) → отдельное объяснение.
  const [resetError, setResetError] = useState(null);
  const closeRef = useRef(null);
  const timers = useRef([]);

  useEffect(() => () => {
    timers.current.forEach((t) => clearTimeout(t));
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Сброс флэша/ошибки при смене строки.
  useEffect(() => {
    setDoneFlash(null);
    setResetError(null);
  }, [id]);

  const flashDone = (kind) => {
    setDoneFlash(kind);
    const t = setTimeout(() => setDoneFlash(null), 1200);
    timers.current.push(t);
  };

  async function runReset(kind) {
    if (busy || pendingRef.current) return;
    pendingRef.current = true;
    setPending(kind);
    setResetError(null);
    let res;
    try {
      res = kind === "remainder"
        ? await onZeroRemainder(id)
        : await onResetHistory(id);
    } catch (error) {
      res = { error: error?.message || "Не удалось выполнить операцию." };
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
    if (res && res.ok) {
      flashDone(kind);
      return;
    }
    // Неудача: значения не тронуты, retry — та же кнопка строки.
    // 404 означает устаревший рантайм (маршрута нет на сервере), а не данные.
    const status = res ? res.status : null;
    setResetError({ kind, text: status === 404
      ? "Операция пока недоступна. Сервер не поддерживает эту функцию."
      : String((res && res.error) || "Не удалось выполнить операцию.") });
  }

  const remainderText = row.remainderText;

  return createPortal(
    <div className="settings-owner-view stoplist-manage-layer">
      <div className="settings-drawer settings-modal-overlay" role="presentation">
        <div
          className="settings-drawer__backdrop"
          onClick={busy ? undefined : onClose}
        />
        <section
          className="settings-form settings-modal stoplist-manage-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stoplist-manage-title"
        >
          <header className="settings-form__header">
            <span className="settings-accent-bar" aria-hidden="true" />
            <div>
              <p>{tr("pages.nomenclature.stoplistmanagemodal.menyu")}</p>
              <h2 id="stoplist-manage-title">{tr("pages.nomenclature.stoplistmanagemodal.upravlenie_limitami")}</h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              disabled={busy}
              onClick={onClose}
              aria-label={tr("pages.nomenclature.stoplistmanagemodal.zakryt_upravlenie_limitami")}
            >
              <Icon name="bi-x-lg" size={20} />
            </button>
          </header>

          <p className="stoplist-manage-product" title={row.name}>{row.name}</p>

          <div className="stoplist-manage-block" data-block="remainder">
            <div className="stoplist-manage-row">
              <div className="stoplist-manage-info">
                <span className="stoplist-manage-label">{tr("pages.nomenclature.stoplistmanagemodal.ostatok")}</span>
                <span
                  className={`stoplist-manage-value${doneFlash === "remainder" ? " is-fresh" : ""}`}
                  title={row.remainderHint || undefined}
                >
                  {remainderText}
                </span>
                {resetError?.kind === "remainder" && <p className="stoplist-manage-error" role="alert">{resetError.text}</p>}
              </div>
              <button
                type="button"
                className="stoplist-manage-reset"
                disabled={busy}
                onClick={() => runReset("remainder")}
                aria-label={`Обнулить остаток: ${row.name}`}
              >
                {pending === "remainder" ? "Сброс..." : "Обнулить"}
              </button>
            </div>
          </div>

          <div className="stoplist-manage-block" data-block="history">
            <div className="stoplist-manage-row">
              <div className="stoplist-manage-info">
                <span className="stoplist-manage-label">{tr("pages.nomenclature.stoplistmanagemodal.predyduschiy_limit")}</span>
                <span className={`stoplist-manage-value${doneFlash === "history" ? " is-fresh" : ""}`}>
                  <HistoryText row={row} />
                </span>
                {resetError?.kind === "history" && <p className="stoplist-manage-error" role="alert">{resetError.text}</p>}
              </div>
              <button
                type="button"
                className="stoplist-manage-reset"
                disabled={busy}
                onClick={() => runReset("history")}
                aria-label={`Обнулить предыдущий лимит: ${row.name}`}
              >
                {pending === "history" ? "Сброс..." : "Обнулить"}
              </button>
            </div>
          </div>

          <footer className="settings-form__footer stoplist-manage-footer">
            <button type="button" disabled={busy} onClick={onClose}>
             {tr("pages.nomenclature.stoplistmanagemodal.zakryt")}
            </button>
          </footer>
        </section>
      </div>
    </div>,
    document.body,
  );
}
