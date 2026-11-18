import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import FinanceSelect from "../finance/FinanceSelect";
import "../finance/financeOperationModal.css";
import "./purchasePaymentDialog.css";

export const PAYMENT_PAID = "paid";
export const PAYMENT_CREDIT = "credit";

const money = (value) => `${Math.round(Number(value) || 0).toLocaleString("ru-RU")} UZS`;

// Способы оплаты для расхода: без «В долг» и «VIP» (это не деньги), одинаковые названия — один раз.
export function purchasePaymentTypes(list) {
  const seen = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const name = String(item?.name || "").trim();
    if (!name || item.status === false) continue;
    if (["в долг", "vip"].includes(name.toLowerCase())) continue;
    const key = name.toLowerCase();
    const current = seen.get(key);
    if (!current || (current.scope_kind === "system" && item.scope_kind !== "system")) seen.set(key, item);
  }
  return [...seen.values()];
}

// Окно после «Сохранить» в приходе: оплачен сразу или на потом.
// «Сразу» — денежный расход (Финансы → Операции). «На потом» — долг перед поставщиком (кредиторы).
export default function PurchasePaymentDialog({
  total = 0, supplier = "", paymentTypes = [], saving = false, error = "", onConfirm, onCancel,
}) {
  const titleId = useId();
  const options = useMemo(() => purchasePaymentTypes(paymentTypes), [paymentTypes]);
  const defaultType = useMemo(
    () => (options.find((item) => /налич/i.test(item.name)) || options[0])?.id || "",
    [options],
  );
  const [mode, setMode] = useState(PAYMENT_PAID);
  const [typeId, setTypeId] = useState("");
  const cancelRef = useRef(null);
  const creditAllowed = Boolean(String(supplier || "").trim());
  const chosenType = typeId || defaultType;

  useEffect(() => {
    cancelRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event) => {
      if (event.key === "Escape" && !saving) { event.preventDefault(); onCancel?.(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [saving, onCancel]);

  return createPortal(
    <div className="purchase-pay">
      <div className="purchase-pay__backdrop" onClick={() => { if (!saving) onCancel?.(); }} />
      <div className="purchase-pay__card" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={saving}>
        <header className="purchase-pay__head">
          <span className="purchase-pay__bar" aria-hidden="true" />
          <div>
            <p>Приход товаров{supplier ? ` · ${supplier}` : ""}</p>
            <h2 id={titleId}>Как оплачен приход?</h2>
          </div>
          <button type="button" className="purchase-pay__close" onClick={onCancel} disabled={saving} aria-label="Закрыть">
            <Icon name="bi-x-lg" size={18} />
          </button>
        </header>

        <div className="purchase-pay__sum" data-testid="purchase-total"><span>Сумма прихода</span><strong>{money(total)}</strong></div>

        <div className="purchase-pay__options" role="radiogroup" aria-label="Оплата прихода">
          <label className={`purchase-pay__option${mode === PAYMENT_PAID ? " is-active" : ""}`}>
            <input type="radio" name={titleId} checked={mode === PAYMENT_PAID} onChange={() => setMode(PAYMENT_PAID)} disabled={saving} />
            <span className="purchase-pay__icon" aria-hidden="true"><Icon name="bi-cash-coin" size={20} /></span>
            <span className="purchase-pay__text">
              <strong>Оплачено сразу</strong>
              <small>Сумма попадёт в денежные расходы</small>
            </span>
          </label>
          <label className={`purchase-pay__option${mode === PAYMENT_CREDIT ? " is-active" : ""}${creditAllowed ? "" : " is-disabled"}`}>
            <input type="radio" name={titleId} checked={mode === PAYMENT_CREDIT} onChange={() => setMode(PAYMENT_CREDIT)} disabled={saving || !creditAllowed} />
            <span className="purchase-pay__icon" aria-hidden="true"><Icon name="bi-clock-history" size={20} /></span>
            <span className="purchase-pay__text">
              <strong>Договорились на потом</strong>
              <small>{creditAllowed ? "Сумма попадёт в кредиторы — долг перед поставщиком" : "Выберите поставщика, чтобы записать долг"}</small>
            </span>
          </label>
        </div>

        {mode === PAYMENT_PAID ? (
          <div className="purchase-pay__type">
            <FinanceSelect
              label="Тип оплаты"
              expandAll
              value={chosenType}
              disabled={saving || !options.length}
              onChange={setTypeId}
              placeholder={options.length ? "Выберите" : "Нет способов оплаты"}
              options={options.map((item) => ({ value: item.id, label: item.name }))}
            />
          </div>
        ) : null}

        {error ? <p className="purchase-pay__error" role="alert">{error}</p> : null}

        <footer className="purchase-pay__footer">
          <button type="button" ref={cancelRef} className="purchase-pay__cancel" onClick={onCancel} disabled={saving}>Отмена</button>
          <button
            type="button"
            className="purchase-pay__confirm"
            disabled={saving || (mode === PAYMENT_CREDIT && !creditAllowed)}
            onClick={() => onConfirm?.({ mode, paymentTypeId: mode === PAYMENT_PAID ? chosenType || null : null })}
          >
            {saving ? "Сохранение…" : mode === PAYMENT_PAID ? "Сохранить приход" : "Сохранить в долг"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
