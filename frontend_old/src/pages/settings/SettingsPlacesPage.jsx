import SettingsResourcePage, { STATUS_ACTIVE } from "./SettingsResourcePage";

const rows = [
  { name: "ЗАЛЛ", condition: "10%", percent: "10%", status: STATUS_ACTIVE },
  { name: "КАБИНА", condition: "20%", percent: "20%", status: STATUS_ACTIVE },
  { name: "Billiard", condition: "Цена за час: 100 000 UZS", percent: "0%", status: STATUS_ACTIVE },
  { name: "БРОН", condition: "Дополнительная цена: 300 000 UZS | Цена по времени", percent: "10%", status: STATUS_ACTIVE },
  { name: "Бар", condition: "Цена за час: 20 000 UZS", percent: "10%", status: STATUS_ACTIVE },
].map((row, index) => ({ id: index + 1, ...row }));

const apiMapRow = (item) => ({
  id: item.id,
  name: item.name || "",
  condition: item.condition || item.price_description || "",
  percent: item.percent ? `${item.percent}%` : "0%",
  status: item.is_active !== false ? STATUS_ACTIVE : "#не активно",
});

const apiMapFormToPayload = (form) => ({
  name: form.name,
  condition: form.condition,
  percent: parseFloat(form.percent) || 0,
  payment_type: form.paymentType,
});

function SettingsPlacesPage() {
  return (
    <SettingsResourcePage
      title="Место"
      initialRows={rows}
      apiEndpoint="/halls"
      apiMapRow={apiMapRow}
      apiMapFormToPayload={apiMapFormToPayload}
      columns={[
        { key: "name", label: "Название", link: true },
        { key: "condition", label: "Цена / условие" },
        { key: "percent", label: "Процент" },
        { key: "status", label: "Статус" },
      ]}
      formFields={[
        { key: "name", label: "Название" },
        { key: "paymentType", label: "Тип оплаты места", type: "select", options: ["процент", "цена за час", "фиксированная цена", "цена по времени"] },
        { key: "percent", label: "Процент" },
        { key: "condition", label: "Цена" },
        { key: "status", label: "Статус active", type: "select", options: [STATUS_ACTIVE, "#не активно"] },
      ]}
    />
  );
}

export default SettingsPlacesPage;
