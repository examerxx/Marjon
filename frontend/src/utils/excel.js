import ExcelJS from "exceljs";

// REPORTS-EXCEL-04: the production workbook WRITER is ExcelJS 4.4.0 (SheetJS CE
// 0.18.5 could not serialize fonts/fills/borders/alignment/freeze — the plain
// output was visually rejected). Business truth (REPORTS-EXCEL-02) and the
// widths/autofilter intentions (REPORTS-EXCEL-03) are preserved; only the
// presentation fidelity changes. xlsx is retained solely as a test-side
// readback parser, never imported here.

// REPORTS-EXCEL-02 typed cells. Money stays an authoritative raw number
// (never a "12 500 UZS" display string) so Excel can sum/sort it; datetimes
// stay real date cells. Both helpers return null for missing/invalid input
// so the column keeps one type (empty cell, never a placeholder string).
export function excelAmountNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(num) ? num : null;
}

// Build a floating local datetime from the SAME wall-clock components the
// OWNER UI formatter renders in this browser (same instant, same timezone),
// instead of converting to UTC. The Excel cell therefore shows exactly the
// business-local time the user saw, stays sortable, and never drifts with
// the viewer's timezone. Seconds are kept, sub-second dust is dropped.
export function excelLocalDateTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const instant = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  return new Date(
    instant.getFullYear(), instant.getMonth(), instant.getDate(),
    instant.getHours(), instant.getMinutes(), instant.getSeconds(),
  );
}

// Resolve a column's typed value: a real Date for date columns, a real Number
// for number columns (null when missing/invalid so the cell stays empty and
// summable), and the raw string otherwise. Text columns keep "" -> null so an
// empty Кассир / Тип оплаты is a truly blank cell, never a placeholder.
function typedValue(value, column) {
  const type = typeof column === "object" ? column.type : undefined;
  if (type === "date") return excelLocalDateTime(value);
  if (type === "number") return excelAmountNumber(value);
  if (value === null || value === undefined || value === "") return null;
  return value;
}

// ---- Shared presentation palette (classic professional Excel) ---------------
// Understated, business-neutral. No saturated green/purple, no branding.
const FONT_NAME = "Calibri";           // uniform body/header typeface
const FONT_SIZE = 11;                  // uniform 11pt (VISUAL FIX 01)
const HEADER_FILL = "FFB6EFF0";        // #B6EFF0 light teal header band
const METADATA_LABEL_FILL = "FFF5F7FA"; // very subtle label tint (non-Orders)
const TOTALS_FILL = "FFF2F5F9";        // light neutral totals band
const BORDER_COLOR = "FFBFBFBF";       // clearer neutral medium-light gray grid
const HEADER_TEXT = "FF1F2937";        // dark slate, readable bold
const THIN_GRAY = { style: "thin", color: { argb: BORDER_COLOR } };
const ALL_BORDERS = { top: THIN_GRAY, bottom: THIN_GRAY, left: THIN_GRAY, right: THIN_GRAY };

// Restrained status font colors (text stays the source of truth; color only
// reinforces). Keyed by the exact OWNER status labels; unknown => normal text.
const STATUS_COLORS = {
  "Завершён": "FF15803D", // subtle green
  "Завершен": "FF15803D",
  "Готов": "FF15803D",
  "Новый": "FF1D4ED8",    // subtle blue
  "Принят": "FF1D4ED8",
  "Готовится": "FFB45309", // subtle amber
  "Отменён": "FFB91C1C",  // subtle red
  "Отменен": "FFB91C1C",
};

function alignmentForType(type) {
  if (type === "number") return { horizontal: "right", vertical: "middle" };
  if (type === "date") return { horizontal: "center", vertical: "middle" };
  return { horizontal: "left", vertical: "middle" };
}

// Build the styled ExcelJS workbook. Pure/synchronous and side-effect free so
// tests can drive it directly and read the buffer back. Layout mirrors the
// approved SheetJS structure exactly:
//   [metadata rows] [blank spacer] [business header] [data rows] [totals row?]
// Row/column math is 1-based (ExcelJS convention).
export function buildReportWorkbook(data, columns, {
  metadata = [], totals = null, autofilter = false, sheetName = "Отчёт",
} = {}) {
  const cols = columns.map((col) => (typeof col === "object" ? col : { key: col, label: col }));
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARJON";
  wb.created = new Date();
  // Excel worksheet names cannot exceed 31 chars or contain : \ / ? * [ ].
  const safeName = String(sheetName).replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Отчёт";
  const ws = wb.addWorksheet(safeName, { views: [] });

  // Column widths (character units). Width-less columns keep a sensible default
  // so borders/alignment still render on a uniform grid.
  ws.columns = cols.map((col) => ({ width: col.width != null ? col.width : 12 }));

  // ---- Metadata block: bold label in col A, plain value in col B ----------
  let cursor = 1;
  metadata.forEach((item) => {
    const labelCell = ws.getCell(cursor, 1);
    labelCell.value = item.label;
    labelCell.font = { name: FONT_NAME, bold: true, size: FONT_SIZE, color: { argb: HEADER_TEXT } };
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: METADATA_LABEL_FILL } };
    labelCell.alignment = { horizontal: "left", vertical: "middle" };
    const valueCell = ws.getCell(cursor, 2);
    valueCell.value = item.value;
    valueCell.font = { name: FONT_NAME, size: FONT_SIZE };
    valueCell.alignment = { horizontal: "left", vertical: "middle" };
    cursor += 1;
  });
  // Exactly one blank spacer row between metadata and the table header.
  if (metadata.length) cursor += 1;

  const headerRow = cursor;
  // ---- Business header: bold dark text, light fill, thin borders ----------
  cols.forEach((col, index) => {
    const cell = ws.getCell(headerRow, index + 1);
    cell.value = col.label;
    cell.font = { name: FONT_NAME, bold: true, size: FONT_SIZE, color: { argb: HEADER_TEXT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = ALL_BORDERS;
  });
  ws.getRow(headerRow).height = 22;

  // ---- Data rows ----------------------------------------------------------
  data.forEach((row, rowIndex) => {
    const excelRow = headerRow + 1 + rowIndex;
    cols.forEach((col, index) => {
      const cell = ws.getCell(excelRow, index + 1);
      const value = typedValue(row[col.key], col);
      if (value !== null && value !== undefined) cell.value = value;
      if (col.format) cell.numFmt = col.format;
      cell.font = { name: FONT_NAME, size: FONT_SIZE };
      cell.alignment = alignmentForType(col.type);
      cell.border = ALL_BORDERS;
      // Restrained status coloring (opt-in per column via statusColors: true).
      if (col.statusColors && typeof value === "string" && STATUS_COLORS[value]) {
        cell.font = { name: FONT_NAME, size: FONT_SIZE, color: { argb: STATUS_COLORS[value] } };
      }
    });
    ws.getRow(excelRow).height = 18;
  });

  // ---- Totals row (opt-in): bold, subtle top border + light fill ----------
  let totalsRow = null;
  if (totals && typeof totals === "object") {
    totalsRow = headerRow + 1 + data.length;
    const source = totals.values && typeof totals.values === "object" ? totals.values : {};
    cols.forEach((col, index) => {
      const cell = ws.getCell(totalsRow, index + 1);
      if (index === 0) {
        cell.value = totals.label ?? "";
      } else {
        const value = typedValue(source[col.key], col);
        if (value !== null && value !== undefined) cell.value = value;
        if (col.format) cell.numFmt = col.format;
      }
      cell.font = { name: FONT_NAME, bold: true, size: FONT_SIZE, color: { argb: HEADER_TEXT } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTALS_FILL } };
      cell.alignment = alignmentForType(col.type);
      cell.border = { ...ALL_BORDERS, top: { style: "medium", color: { argb: BORDER_COLOR } } };
    });
    ws.getRow(totalsRow).height = 20;
  }

  // ---- Native autofilter: header row across full width, DATA rows only ----
  // (metadata, spacer and totals row are deliberately excluded).
  if (autofilter && cols.length && data.length) {
    ws.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: headerRow + data.length, column: cols.length },
    };
  }

  // ---- Freeze pane: everything down to and including the business header
  // stays visible during vertical scroll (metadata + header pinned).
  ws.views = [{ state: "frozen", ySplit: headerRow, topLeftCell: `A${headerRow + 1}` }];

  return wb;
}

// Serialize to an .xlsx ArrayBuffer. Async because ExcelJS buffer writing is
// promise-based. Kept separate from the DOM download so tests read the buffer
// without touching the browser.
export async function reportWorkbookBuffer(data, columns, options = {}) {
  const wb = buildReportWorkbook(data, columns, options);
  return wb.xlsx.writeBuffer();
}

// Public helper (unchanged signature + name so report pages need no rewrite):
// build the styled workbook and trigger a browser download of `${filename}.xlsx`.
export async function exportToExcel(data, columns, filename = "export", options = {}) {
  const buffer = await reportWorkbookBuffer(data, columns, options);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filename}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
