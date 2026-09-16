import * as XLSX from "xlsx";

export function exportToExcel(data, columns, filename = "export", { metadata = [] } = {}) {
  const header = columns.map((col) => col.label || col);
  const keys = columns.map((col) => col.key || col);

  const rows = data.map((row) =>
    keys.map((key) => {
      const value = row[key];
      if (value === null || value === undefined) return "";
      return value;
    })
  );

  const metadataRows = metadata.map((item) => [item.label, item.value]);
  const sheetRows = metadataRows.length ? [...metadataRows, [], header, ...rows] : [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Отчёт");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
