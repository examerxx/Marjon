import SettingsResourcePage from "./SettingsResourcePage";

const rows = [
  { name: "Касса", typeLabel: "Чековый", endpoint: "192.168.1.50:9100", zone: "Касса", status: "Активно", testPrint: true },
  { name: "Кухня", typeLabel: "Кухонный", endpoint: "192.168.1.51:9100", zone: "Кухня", status: "Активно", testPrint: true },
  { name: "Бар", typeLabel: "Кухонный", endpoint: "192.168.1.52:9100", zone: "Бар", status: "#не активно", testPrint: true },
].map((row, index) => ({ id: index + 1, ...row }));

const apiMapRow = (item) => ({
  id: item.id,
  name: item.name || "",
  typeLabel: item.type || item.printer_type || "",
  endpoint: item.ip_address ? `${item.ip_address}:${item.port || 9100}` : "",
  zone: item.zone || item.print_zone || "",
  status: item.is_active !== false ? "Активно" : "#не активно",
  testPrint: true,
});

const apiMapFormToPayload = (form) => ({
  name: form.name,
  type: form.typeLabel,
  ip_address: form.ip,
  port: parseInt(form.port, 10) || 9100,
  zone: form.zone,
  is_active: form.status === "Активно",
});

function SettingsPrintersPage() {
  return (
    <SettingsResourcePage
      title="Настройка принтеров"
      addLabel="Добавить принтер +"
      initialRows={rows}
      apiEndpoint="/printers"
      apiMapRow={apiMapRow}
      apiMapFormToPayload={apiMapFormToPayload}
      columns={[
        { key: "name", label: "Название" },
        { key: "typeLabel", label: "Тип" },
        { key: "endpoint", label: "IP / порт" },
        { key: "zone", label: "Зона печати" },
        { key: "status", label: "Статус" },
        { key: "test", label: "Тест" },
      ]}
      formFields={[
        { key: "name", label: "Название" },
        { key: "typeLabel", label: "Тип принтера", type: "select", options: ["Чековый", "Кухонный"] },
        { key: "ip", label: "IP" },
        { key: "port", label: "Порт" },
        { key: "zone", label: "Зона печати" },
        { key: "status", label: "Статус", type: "select", options: ["Активно", "#не активно"] },
      ]}
    />
  );
}

export default SettingsPrintersPage;
