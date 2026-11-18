import { useCallback, useEffect, useState } from "react";
import SettingsResourcePage from "./SettingsResourcePage";
import "./SettingsClientsTable.css";
import { formatDebt, loadClientDebts } from "./clients/clientDebts";
import { CounterpartyStatementView } from "./clients/CounterpartyHistory";
import SupplierStatementView from "./clients/SupplierStatement";
import { formatPhoneDisplay, formatTablePhone, normalizePhoneForPayload, parsePhoneInput } from "./clients/phone";
import { t } from "../../i18n/t";

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

// Текущий долг клиентов (с учётом погашений); null — ещё грузится или не удалось загрузить.
function useClientDebts() {
  const [debts, setDebts] = useState(null);
  const reload = useCallback((signal) => loadClientDebts({ signal })
    .then((map) => { if (!signal?.aborted) setDebts(map); })
    .catch(() => {}), []);
  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    return () => controller.abort();
  }, [reload]);
  return [debts, () => reload()];
}

export function debtCell(row, debts) {
  if (row?.type !== "clients" || !debts) return "-";
  const debt = debts.get(String(row.id)) || 0;
  if (debt > 0) return <span className="client-debt-cell is-debt">{formatDebt(debt)}</span>;
  if (debt < 0) return <span className="client-debt-cell is-overpaid">Переплата {formatDebt(-debt)}</span>;
  return <span className="client-debt-cell">Нет долга</span>;
}

function SettingsClientsPage() {
  const [debts, reloadDebts] = useClientDebts();
  return (
    <SettingsResourcePage
      title={t("pages.settings.settingsclientspage.klienty")}
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
      renderStatementView={(row, onBack) => (row.type === "suppliers" ? (
        // Поставщик: та же структура, но по теме — приходы «на потом» и оплаты поставщику.
        <SupplierStatementView row={row} onDebtChanged={reloadDebts} />
      ) : (
        <CounterpartyStatementView row={row} onBack={onBack}
          debt={row.type === "clients" && debts ? debts.get(String(row.id)) || 0 : null}
          onDebtChanged={reloadDebts} />
      ))}
      requireDeleteConfirm
      deleteConfirmText="Удалить контрагента?"
      searchPlaceholder="Поиск"
      emptyText={t("pages.settings.settingsclientspage.spisok_pust")}
      formatPhoneDisplay={formatPhoneDisplay}
      parsePhoneInput={parsePhoneInput}
      pageClassName="clients-directory-page"
      actionsLabel="Действия"
      columns={[
        { key: "name", label: t("pages.settings.settingsclientspage.fio") },
        // Display-only UZ mask (+998 (XX) XXX-XX-XX); raw canonical value
        // stays untouched for search, edit, and payloads.
        { key: "phone", label: t("pages.settings.settingsclientspage.nomer_telefona"), format: (value) => formatTablePhone(value) },
        { key: "debt", label: "Долг", format: (_value, row) => debtCell(row, debts) },
        { key: "status", label: t("pages.settings.settingsclientspage.status") },
        { key: "history", label: t("pages.settings.settingsclientspage.istoriya_tranzaktsiy") },
      ]}
      formFields={[
        { key: "type", label: t("pages.settings.settingsclientspage.tip_kontragenta"), type: "select", options: tabs.map((tab) => ({ value: tab.key, label: tab.label })) },
        { key: "name", label: t("pages.settings.settingsclientspage.fio_nazvanie") },
        { key: "phone", label: t("pages.settings.settingsclientspage.nomer_telefona"), type: "phone" },
        // Local-only visual parity (backend has no status field): order in
        // the modal is name → phone → status → footer. The `status` key is
        // the future canonical name; the mapper deliberately excludes it
        // until the backend supports it. Never persisted.
        { key: "status", label: t("pages.settings.settingsclientspage.status"), type: "status", defaultValue: "active" },
      ]}
    />
  );
}

export default SettingsClientsPage;
