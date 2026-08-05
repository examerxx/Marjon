import SettingsResourcePage, { STATUS_ACTIVE, STATUS_INACTIVE } from "./SettingsResourcePage";

const rows = [
  [1, "Граммы (г)", "г"],
  [1, "Килограммы (кг)", "кг"],
  [1, "Порция (пр)", "пр"],
  [1, "Литры (л)", "л"],
  [1, "Штуки (шт)", "шт"],
  [1, "gramm", "g"],
].map(([sort, name, shortName], index) => ({ id: index + 1, sort, name, shortName, status: STATUS_ACTIVE }));

const apiMapRow = (item) => ({
  id: item.id,
  sort: item.sort_order ?? item.sort ?? 0,
  name: item.name || "",
  shortName: item.short_name || item.shortName || "",
  status: item.is_active !== false ? STATUS_ACTIVE : STATUS_INACTIVE,
});

const apiMapFormToPayload = (form) => ({
  name: form.name,
  short_name: form.shortName,
  sort_order: parseInt(form.sort, 10) || 0,
});

function SettingsUnitsPage() {
  return (
    <SettingsResourcePage
      title="Единица измерения"
      initialRows={rows}
      apiEndpoint="/units"
      apiMapRow={apiMapRow}
      apiMapFormToPayload={apiMapFormToPayload}
      columns={[
        { key: "sort", label: "Сорт", inlineSort: true },
        { key: "name", label: "Название" },
        { key: "shortName", label: "Короткое название" },
        { key: "status", label: "Статус" },
      ]}
      formFields={[
        { key: "sort", label: "Сорт" },
        { key: "name", label: "Название" },
        { key: "shortName", label: "Короткое название" },
        { key: "status", label: "Статус active", type: "select", options: [STATUS_ACTIVE, STATUS_INACTIVE] },
      ]}
    />
  );
}

export default SettingsUnitsPage;
