import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import ReportDateRangePicker from "../../components/ReportDateRangePicker";
import FinanceSelect from "./FinanceSelect";
import { useAnchoredDialogMotion } from "../../hooks/useAnchoredDialogMotion";
import "./financeOperationModal.css";

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
    ["supplier", "Поставщики"], ["client", "Клиенты"],
    ["employee", "Сотрудники"], ["other", "Другие"],
  ];
  const employeeExpense = isExpense && (editing
    ? form.staffService || counterparties.some(item => String(item.id) === form.counterpartyId && item.type === "employee")
    : partyType === "employee");
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
    setForm((current) => ({ ...current, [field]: value, ...(field === "type" ? { categoryId: "", staffService: false } : {}), ...(field === "counterpartyId" && !value ? { staffService: false } : {}) }));
  };

  return createPortal(
    <div className={`finance-drawer finance-operation-modal ${motionClassName} ${isExpense ? "is-expense" : "is-income"}`}>
      <div className="finance-drawer__backdrop" onClick={dismiss} />
      <form ref={modalRef} className="finance-form" style={motionStyle} onAnimationEnd={event => {
        if (event.animationName === "finance-operation-leave" || event.animationName === "finance-backdrop-leave") handleAnimationEnd(event);
      }} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} onSubmit={submit}>
        <header className="finance-form__header">
          <span className="finance-accent-bar" />
          <div><p>Денежные операции · {isExpense ? "Расход" : "Приход"}</p><h2 id={titleId}>{editing ? "Редактирование операции" : isExpense ? "Расходная операция" : "Приходная операция"}</h2></div>
          <button type="button" onClick={dismiss} disabled={busy} aria-label="Закрыть"><Icon name="bi-x-lg" size={20} /></button>
        </header>

        <div className="finance-form__grid">
          <label><span>Сумма, UZS</span><div className="finance-amount" data-amount={String(form.amount ?? "").replace(/^(\d+)/, digits => digits.replace(/\B(?=(\d{3})+(?!\d))/g, " "))}><input ref={amountRef} value={String(form.amount ?? "").replace(/^(\d+)/, digits => digits.replace(/\B(?=(\d{3})+(?!\d))/g, " "))} disabled={busy} onChange={(event) => { const amount = event.target.value.replace(/\s/g, ""); if (/^\d*(?:[.,]\d*)?$/.test(amount)) update("amount", amount); }} inputMode="decimal" autoComplete="off" placeholder="Введите сумму" required />{form.amount && <span className="finance-amount-unit" aria-hidden="true">сум</span>}</div></label>
          <div className="finance-operation-date">
            <span className="finance-select-label">Дата и время операции</span>
            <ReportDateRangePicker
              variant="canonical"
              singleDateTime
              animateExit
              disabled={busy}
              value={operationPeriod}
              buttonAriaLabel="Дата и время операции"
              formatButtonLabel={({ start, startTime }) => start ? `${start} ${startTime}` : "Выберите дату и время"}
              onChange={({ start, startTime }) => update("operationDateTime", `${start.split(".").reverse().join("-")}T${startTime}`)}
            />
          </div>
          {editing && <div className="finance-form__wide"><FinanceSelect label="Тип операции" value={form.type} disabled={busy} onChange={value => update("type", value)} options={[{ value: "income", label: "Приход" }, { value: "expense", label: "Расход" }]} /></div>}
          <div className="finance-form__wide finance-party-panel">
            {!editing && <fieldset className="finance-party-groups" disabled={busy}>
              <legend>Группа контрагентов</legend>
              {partyGroups.map(([type, label]) => <label key={type} className="finance-party-chip">
                <input type="radio" name={titleId} checked={partyType === type} onChange={() => {
                  setPartyType(type);
                  update("counterpartyId", "");
                }} />
                {label}
              </label>)}
            </fieldset>}
            <div className={employeeExpense ? "finance-party-selection has-service-option" : "finance-party-selection"}>
              <FinanceSelect label={`Контрагент${editing ? " — только чтение" : ""}`} value={form.counterpartyId} disabled={editing || busy || !visibleParties.length} onChange={value => update("counterpartyId", value)} placeholder={visibleParties.length ? "Выберите" : "Нет контрагентов в этой группе"} options={visibleParties.map(item => ({ value: item.id, label: item.full_name }))} />
              {employeeExpense && <label className="finance-service-option">
                <input type="checkbox" checked={Boolean(form.staffService)} disabled={busy}
                  onChange={event => update("staffService", event.target.checked)} />
                <span className="finance-service-track" aria-hidden="true" />
                <span>За услугу</span>
              </label>}
            </div>
          </div>
          <FinanceSelect label={`Тип оплаты${editing ? " — только чтение" : ""}`} value={form.paymentTypeId} disabled={editing || busy || !paymentTypes.length} onChange={value => update("paymentTypeId", value)} placeholder={paymentTypes.length ? "Выберите" : "Нет способов оплаты"} options={paymentTypes.map(item => ({ value: item.id, label: item.name }))} />
          <FinanceSelect label="Категория" value={form.categoryId} disabled={busy} onChange={value => update("categoryId", value)} placeholder="Выберите" options={categories.filter(item => (item.status !== false || item.id === form.categoryId) && (!item.kind || item.kind === form.type)).map(item => ({ value: item.id, label: item.name }))} />
          <label className="finance-form__wide"><span>Комментарий</span><textarea value={form.comment} disabled={busy} onChange={(event) => update("comment", event.target.value)} placeholder="Назначение операции или примечание" /></label>
        </div>

        {error ? <p className="finance-operation-error" role="alert">{error}</p> : null}
        <footer className="finance-form__footer"><button type="button" onClick={dismiss} disabled={busy}>Отмена</button><button type="submit" disabled={busy}>{saving ? "Сохранение..." : editing ? "Сохранить" : isExpense ? "Добавить расход" : "Добавить приход"}</button></footer>
      </form>
    </div>, document.body
  );
}

export default FinanceTransactionDrawer;
