import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import ReportDateRangePicker from "../../components/ReportDateRangePicker";
import FinanceSelect from "./FinanceSelect";
import { useAnchoredDialogMotion } from "../../hooks/useAnchoredDialogMotion";
import "./financeOperationModal.css";
import { t } from "../../i18n/t";

function FinanceTransactionDrawer({
  form,
  setForm,
  onClose,
  onSave,
  editing = false,
  paymentTypes = [],
  counterparties = [],
  categories = [],
  saving = false,
  error = "",
  onClearError = null,
}) {
  const operationPeriod = useMemo(() => {
    const [date, time] = (form.operationDateTime || "").split("T");
    return { start: date.split("-").reverse().join("."), startTime: time };
  }, [form.operationDateTime]);
  const isExpense = form.type === "expense";
  const titleId = useId();
  const [partyType, setPartyType] = useState("supplier");
  const partyGroups = [
    ["supplier", t("Поставщики")], ["client", t("Клиенты")],
    ["employee", t("Сотрудники")], ["other", t("Другие")],
  ];
  const visibleParties = editing ? counterparties : counterparties.filter(item =>
    partyType === "other"
      ? !["supplier", "client", "employee"].includes(item.type)
      : item.type === partyType
  );

  const amountRef = useRef(null);
  const closeRef = useRef(onClose);
  const savingRef = useRef(saving);
  closeRef.current = onClose;
  savingRef.current = saving;
  const finishClose = useCallback(() => closeRef.current(), []);
  const { dialogRef: modalRef, motionClassName, motionStyle, requestClose, handleAnimationEnd } = useAnchoredDialogMotion({
    isOpen: true,
    onClose: finishClose,
    motionMode: "centered",
    escapeDisabled: true,
  });
  const closing = motionClassName.includes("is-motion-closing");
  const busy = saving || closing;
  const animateClose = () => {
    if (closing) return;
    const panel = modalRef.current;
    const backdrop = panel?.previousElementSibling;
    if (panel && backdrop) {
      const panelStyle = getComputedStyle(panel);
      panel.style.setProperty("--finance-leave-transform", panelStyle.transform);
      panel.style.setProperty("--finance-leave-opacity", panelStyle.opacity);
      backdrop.style.setProperty("--finance-leave-opacity", getComputedStyle(backdrop).opacity);
    }
    requestClose();
  };
  const dismiss = () => {
    if (!savingRef.current) animateClose();
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const submit = async (event) => {
    event.preventDefault();
    if (savingRef.current || closing) return;
    if (await onSave() === true) animateClose();
  };
  useEffect(() => {
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    amountRef.current?.focus({ preventScroll: true });
    const onKey = (event) => {
      if (event.key === "Escape" && !modalRef.current?.querySelector(".finance-operation-date button[aria-expanded=\"true\"]")) {
        event.preventDefault();
        dismissRef.current();
      }
      if (event.key !== "Tab") return;
      const fields = [...modalRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')];
      const first = fields[0], last = fields[fields.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  const update = (field, value) => {
    onClearError?.();
    setForm((current) => ({ ...current, [field]: value, ...(field === "type" ? { categoryId: "" } : {}) }));
  };

  return createPortal(
    <div className={`finance-drawer finance-operation-modal ${motionClassName} ${isExpense ? "is-expense" : "is-income"}`}>
      <div className="finance-drawer__backdrop" onClick={dismiss} />
      <form ref={modalRef} className="finance-form" style={motionStyle} onAnimationEnd={event => {
        if (event.animationName === "finance-operation-leave" || event.animationName === "finance-backdrop-leave") handleAnimationEnd(event);
      }} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} onSubmit={submit}>
        <header className="finance-form__header">
          <span className="finance-accent-bar" />
          <div><p>{t("Денежные операции")} · {isExpense ? t("Расход") : t("Приход")}</p><h2 id={titleId}>{editing ? t("pages.finance.financetransactiondrawer.redaktirovanie_operatsii") : isExpense ? t("pages.finance.financetransactiondrawer.rashodnaya_operatsiya") : t("pages.finance.financetransactiondrawer.prihodnaya_operatsiya")}</h2></div>
          <button type="button" onClick={dismiss} disabled={busy} aria-label={t("pages.finance.financetransactiondrawer.zakryt")}><Icon name="bi-x-lg" size={20} /></button>
        </header>

        <div className="finance-form__grid">
          <label><span>{t("pages.finance.financetransactiondrawer.summa_uzs")}</span><div className="finance-amount" data-amount={String(form.amount ?? "").replace(/^(\d+)/, digits => digits.replace(/\B(?=(\d{3})+(?!\d))/g, " "))}><input ref={amountRef} value={String(form.amount ?? "").replace(/^(\d+)/, digits => digits.replace(/\B(?=(\d{3})+(?!\d))/g, " "))} disabled={busy} onChange={(event) => { const amount = event.target.value.replace(/\s/g, ""); if (/^\d*(?:[.,]\d*)?$/.test(amount)) update("amount", amount); }} inputMode="decimal" autoComplete="off" placeholder={t("Введите сумму")} required />{form.amount && <span className="finance-amount-unit" aria-hidden="true">{t("сум")}</span>}</div></label>
          <div className="finance-operation-date">
            <span className="finance-select-label">{t("pages.finance.financetransactiondrawer.data_i_vremya_operatsii")}</span>
            <ReportDateRangePicker
              variant="canonical"
              singleDateTime
              animateExit
              disabled={busy}
              value={operationPeriod}
              buttonAriaLabel={t("pages.finance.financetransactiondrawer.data_i_vremya_operatsii")}
              formatButtonLabel={({ start, startTime }) => start ? `${start} ${startTime}` : t("pages.finance.financetransactiondrawer.vyberite_datu_i_vremya")}
              onChange={({ start, startTime }) => update("operationDateTime", `${start.split(".").reverse().join("-")}T${startTime}`)}
            />
          </div>
          {editing && <div className="finance-form__wide"><FinanceSelect label={t("Тип операции")} value={form.type} disabled={busy} onChange={value => update("type", value)} options={[{ value: "income", label: t("Приход") }, { value: "expense", label: t("Расход") }]} /></div>}
          <div className="finance-form__wide finance-party-panel">
            {!editing && <fieldset className="finance-party-groups" disabled={busy}>
              <legend>{t("pages.finance.financetransactiondrawer.gruppa_kontragentov")}</legend>
              {partyGroups.map(([type, label]) => <label key={type} className="finance-party-chip">
                <input type="radio" name={titleId} checked={partyType === type} onChange={() => {
                  setPartyType(type);
                  update("counterpartyId", "");
                }} />
                {label}
              </label>)}
            </fieldset>}
            <FinanceSelect label={`${t("Контрагент")}${editing ? t("pages.finance.financetransactiondrawer.tolko_chtenie") : ""}`} value={form.counterpartyId} disabled={editing || busy || !visibleParties.length} onChange={value => update("counterpartyId", value)} placeholder={visibleParties.length ? t("Выберите") : t("pages.finance.financetransactiondrawer.net_kontragentov_v_etoy_gruppe")} options={visibleParties.map(item => ({ value: item.id, label: item.full_name }))} />
          </div>
          <FinanceSelect label={`${t("Тип оплаты")}${editing ? t("pages.finance.financetransactiondrawer.tolko_chtenie") : ""}`} value={form.paymentTypeId} disabled={editing || busy || !paymentTypes.length} onChange={value => update("paymentTypeId", value)} placeholder={paymentTypes.length ? t("Выберите") : t("pages.finance.financetransactiondrawer.net_sposobov_oplaty")} options={paymentTypes.map(item => ({ value: item.id, label: item.name }))} />
          <FinanceSelect label={t("Категория")} value={form.categoryId} disabled={busy} onChange={value => update("categoryId", value)} placeholder={t("Выберите")} options={categories.filter(item => (item.status !== false || item.id === form.categoryId) && (!item.kind || item.kind === form.type)).map(item => ({ value: item.id, label: item.name }))} />
          <label className="finance-form__wide"><span>{t("pages.finance.financetransactiondrawer.kommentariy")}</span><textarea value={form.comment} disabled={busy} onChange={(event) => update("comment", event.target.value)} placeholder={t("pages.finance.financetransactiondrawer.naznachenie_operatsii_ili_primechanie")} /></label>
        </div>

        {error ? <p className="finance-operation-error" role="alert">{error}</p> : null}
        <footer className="finance-form__footer"><button type="button" onClick={dismiss} disabled={busy}>{t("pages.finance.financetransactiondrawer.otmena")}</button><button type="submit" disabled={busy}>{saving ? t("staff.saving") : editing ? t("common.save") : isExpense ? t("Добавить расход") : t("Добавить приход")}</button></footer>
      </form>
    </div>, document.body
  );
}

export default FinanceTransactionDrawer;
