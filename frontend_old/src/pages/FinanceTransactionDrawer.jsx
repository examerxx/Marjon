import Icon from "../components/Icon";

const paymentTypes = ["NAXT", "Terminal", "CLICK", "Payme", "Vip"];

function FinanceTransactionDrawer({ form, setForm, onClose, onSave }) {
  const isExpense = form.type === "expense";

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  return (
    <div className={`finance-drawer ${isExpense ? "is-expense" : "is-income"}`} role="dialog" aria-modal="true">
      <div className="finance-drawer__backdrop" onClick={onClose} />
      <form className="finance-form" onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}>
        <header className="finance-form__header">
          <span className="finance-accent-bar" />
          <div>
            <p>{isExpense ? "Расход" : "Приход"}</p>
            <h2>{isExpense ? "Расходная операция" : "Приходная операция"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <Icon name="bi-x-lg" size={20} />
          </button>
        </header>

        <div className="finance-form__grid">
          <label>
            <span>Тип операции</span>
            <select value={form.type} onChange={(event) => update("type", event.target.value)}>
              <option value="income">Приход</option>
              <option value="expense">Расход</option>
            </select>
          </label>
          <label>
            <span>Дата</span>
            <input value={form.date} onChange={(event) => update("date", event.target.value)} />
          </label>
          <label>
            <span>Сумма</span>
            <input value={form.amount} onChange={(event) => update("amount", event.target.value)} />
          </label>
          <label>
            <span>Валюта</span>
            <select value={form.currency} onChange={(event) => update("currency", event.target.value)}>
              <option value="UZS">UZS</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label>
            <span>Тип оплаты</span>
            <select value={form.paymentType} onChange={(event) => update("paymentType", event.target.value)}>
              {paymentTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label>
            <span>Контрагент</span>
            <input value={form.counterparty} onChange={(event) => update("counterparty", event.target.value)} placeholder="-" />
          </label>
          <label>
            <span>Категория</span>
            <input value={form.category} onChange={(event) => update("category", event.target.value)} />
          </label>
          <label className="finance-form__wide">
            <span>Комментарий</span>
            <textarea value={form.comment} onChange={(event) => update("comment", event.target.value)} />
          </label>
        </div>

        <footer className="finance-form__footer">
          <button type="button" onClick={onClose}>Отмена</button>
          <button type="submit">Сохранить</button>
        </footer>
      </form>
    </div>
  );
}

export default FinanceTransactionDrawer;
