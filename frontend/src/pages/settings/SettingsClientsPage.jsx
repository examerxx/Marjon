import SettingsResourcePage from "./SettingsResourcePage";
import { CounterpartyStatementView } from "./clients/CounterpartyHistory";
import { formatPhoneDisplay, formatTablePhone, normalizePhoneForPayload, parsePhoneInput } from "./clients/phone";

const tabs = [
  { key: "clients", label: "Клиенты" },
  { key: "suppliers", label: "Поставщики" },
  { key: "staff", label: "Сотрудники" },
  { key: "other", label: "Другие" },
];

export const apiMapRow = (item) => ({
  id: item.id,
  type: ({ client: "clients", supplier: "suppliers", employee: "staff" })[item.type] || item.type || "other",
  name: item.name || item.full_name || "",
  phone: item.phone || "",
  balance: item.balance ?? null,
  // The Counterparty backend has no status field: rows default to the local
  // "Активный" display state, edits merge the chosen option (payload untouched).
  status: "Активный",
});

export const apiMapFormToPayload = (form) => {
  const fullName = String(form.name || "").trim();
  if (!fullName) return null;
  // STATUS INTEGRATION POINT: form.status is local-only display state while
  // STATUS_BACKEND_SUPPORTED = NO. It is deliberately EXCLUDED from this
  // allowlist — add it here only when the backend accepts a canonical field.
  return {
    full_name: fullName,
    phone: normalizePhoneForPayload(form.phone),
    type: ({ clients: "client", suppliers: "supplier", staff: "employee" })[form.type] || form.type,
  };
};

const TYPE_NOUNS = {
  clients: "клиента",
  suppliers: "поставщика",
  staff: "сотрудника",
  other: "контрагента",
};

const titleFor = (form) => {
  const noun = TYPE_NOUNS[form?.type] || "контрагента";
  return noun;
};

function SettingsClientsPage() {
  return (
    <SettingsResourcePage
      title="Клиенты"
      eyebrow="Настройки"
      addTitle={(form) => `Добавить ${titleFor(form)}`}
      editTitle={(form) => `Редактировать ${titleFor(form)}`}
      tabs={tabs}
      resourceKey="clients"
      staffVariant
      apiMapRow={apiMapRow}
      apiMapFormToPayload={apiMapFormToPayload}
      transactionHistory
      statementHistory
      usePortal
      centeredModal
      hideTypeField
      renderStatementView={(row, onBack) => <CounterpartyStatementView row={row} onBack={onBack} />}
      requireDeleteConfirm
      deleteConfirmText="Удалить контрагента?"
      searchPlaceholder="Поиск"
      emptyText="Список пуст"
      formatPhoneDisplay={formatPhoneDisplay}
      parsePhoneInput={parsePhoneInput}
      pageClassName="clients-directory-page"
      actionsLabel="Действия"
      columns={[
        { key: "name", label: "ФИО" },
        // Display-only UZ mask (+998 (XX) XXX-XX-XX); raw canonical value
        // stays untouched for search, edit, and payloads.
        { key: "phone", label: "Номер телефона", format: (value) => formatTablePhone(value) },
        { key: "status", label: "Статус" },
        { key: "history", label: "История транзакций" },
      ]}
      formFields={[
        { key: "type", label: "Тип контрагента", type: "select", options: tabs.map((tab) => ({ value: tab.key, label: tab.label })) },
        { key: "name", label: "ФИО / название" },
        { key: "phone", label: "Номер телефона", type: "phone" },
        // Local-only visual parity (backend has no status field): order in
        // the modal is name → phone → status → footer. The `status` key is
        // the future canonical name; the mapper deliberately excludes it
        // until the backend supports it. Never persisted.
        { key: "status", label: "Статус", type: "status", defaultValue: "active" },
      ]}
    />
  );
}

export default SettingsClientsPage;
