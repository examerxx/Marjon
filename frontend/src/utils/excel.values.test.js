import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  excelAmountNumber,
  excelLocalDateTime,
  reportWorkbookBuffer,
  buildReportWorkbook,
} from "./excel";

// REPORTS-EXCEL-04 proof: the production writer is ExcelJS. These tests drive
// the REAL writer, serialize to a buffer, and reload it through a fresh
// ExcelJS.Workbook — genuine write -> read proof of values, types, and the
// styled presentation (fonts/fills/borders/alignment/freeze/autofilter), with
// no repo artifacts.
async function roundtrip(data, columns, options) {
  const buffer = await reportWorkbookBuffer(data, columns, options);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  return { wb, ws, name: ws.name };
}

describe("excel typed values (REPORTS-EXCEL-02 truth preserved under ExcelJS)", () => {
  it("keeps money numeric and dates real through an XLSX roundtrip", async () => {
    const { ws } = await roundtrip(
      [{ total: "33000", when: "2026-09-18T14:05:00", label: "ORD-1" }],
      [
        { key: "label", label: "Номер" },
        { key: "total", label: "Цена всего", type: "number", format: "#,##0" },
        { key: "when", label: "Дата", type: "date", format: "dd.mm.yyyy hh:mm" },
      ],
    );
    // Header row 1 (no metadata), data row 2.
    expect(ws.getCell(1, 1).value).toBe("Номер");
    const total = ws.getCell(2, 2);
    expect(typeof total.value).toBe("number");
    expect(total.value).toBe(33000);
    const when = ws.getCell(2, 3);
    expect(when.value).toBeInstanceOf(Date);
    const expected = new Date(2026, 8, 18, 14, 5, 0).getTime();
    expect(Math.abs(when.value.getTime() - expected)).toBeLessThan(5000);
  });

  it("pins explicit RU display formats (numFmt) that survive serialization", async () => {
    const { ws } = await roundtrip(
      [{ total: "33000", when: "2026-09-18T14:05:00" }],
      [
        { key: "total", label: "Цена всего", type: "number", format: "#,##0" },
        { key: "when", label: "Дата", type: "date", format: "dd.mm.yyyy hh:mm" },
      ],
    );
    expect(ws.getCell(2, 1).numFmt).toBe("#,##0");
    expect(ws.getCell(2, 2).numFmt).toBe("dd.mm.yyyy hh:mm");
  });

  it("writes empty cells (never placeholders) for missing typed values", async () => {
    const { ws } = await roundtrip(
      [{ total: null, when: "not-a-date" }],
      [
        { key: "total", label: "Сумма", type: "number", format: "#,##0" },
        { key: "when", label: "Дата", type: "date", format: "dd.mm.yyyy hh:mm" },
      ],
    );
    // No value set → ExcelJS reports null; the column stays summable/sortable.
    expect(ws.getCell(2, 1).value).toBeNull();
    expect(ws.getCell(2, 2).value).toBeNull();
  });

  it("excelAmountNumber accepts Decimal strings and rejects junk", () => {
    expect(excelAmountNumber("900.00")).toBe(900);
    expect(excelAmountNumber(0)).toBe(0);
    expect(excelAmountNumber(null)).toBeNull();
    expect(excelAmountNumber("")).toBeNull();
    expect(excelAmountNumber("12 500 UZS")).toBeNull();
    expect(excelAmountNumber("nan")).toBeNull();
  });

  it("excelLocalDateTime keeps browser-local wall clock without UTC shift", () => {
    const out = excelLocalDateTime("2026-09-18T14:05:07Z");
    expect(out).toBeInstanceOf(Date);
    const ref = new Date("2026-09-18T14:05:07Z");
    expect(out.getFullYear()).toBe(ref.getFullYear());
    expect(out.getMonth()).toBe(ref.getMonth());
    expect(out.getDate()).toBe(ref.getDate());
    expect(out.getHours()).toBe(ref.getHours());
    expect(out.getMinutes()).toBe(ref.getMinutes());
    expect(out.getSeconds()).toBe(ref.getSeconds());
    expect(excelLocalDateTime(null)).toBeNull();
    expect(excelLocalDateTime("")).toBeNull();
    expect(excelLocalDateTime("not-a-date")).toBeNull();
  });
});

describe("REPORTS-EXCEL-04 Orders: contract + styled presentation", () => {
  // ORDERS-FRONTEND-TRUTH-01: canonical export shape — ID column carries the
  // integer public_id (not a UUID), and "Место" is the composed place string.
  const columns = [
    { key: "id", label: "ID", width: 14 },
    { key: "orderNumber", label: "Номер заказа", width: 16 },
    { key: "createdAt", label: "Дата", type: "date", format: "dd.mm.yyyy hh:mm", width: 18 },
    { key: "orderType", label: "Тип", width: 13 },
    { key: "place", label: "Место", width: 22 },
    { key: "waiterName", label: "Официант", width: 18 },
    { key: "cashiers", label: "Кассир", width: 24 },
    { key: "serviceFee", label: "Цена обслуживания", type: "number", format: "#,##0", width: 20 },
    { key: "totalAmount", label: "Цена всего", type: "number", format: "#,##0", width: 16 },
    { key: "payments", label: "Тип оплаты", width: 20 },
    { key: "status", label: "Статус", width: 14, statusColors: true },
  ];
  const data = [
    {
      id: 10000000, orderNumber: "7",
      createdAt: "2026-09-18T14:05:00", orderType: "На стол", place: "Основной зал, стол 5",
      waiterName: "Алишер", cashiers: "Яков, Алишер", serviceFee: 9300,
      totalAmount: 33000, payments: "Наличные, Pay me", status: "Завершён",
    },
    {
      id: 10000001, orderNumber: "8",
      createdAt: "2026-09-18T15:00:00", orderType: "Доставка", place: "",
      waiterName: "", cashiers: "", serviceFee: 0,
      totalAmount: 80000, payments: "", status: "Новый",
    },
  ];
  // VISUAL FIX 01: Orders no longer emits a metadata block. The sheet begins
  // directly with the business header at row 1 (filters still BUILD the
  // exported population on the page; only the visible rows are omitted).
  const options = {
    sheetName: "Отчёт по заказам",
    autofilter: true,
    totals: { label: "Итого:", values: { serviceFee: 9300, totalAmount: 113000 } },
  };
  // Header row 1, data rows 2-3, totals row 4 (no metadata, no spacer).
  const HEADER = 1;

  it("keeps exactly 11 headers in the approved order", async () => {
    const { ws } = await roundtrip(data, columns, options);
    const labels = columns.map((_, i) => ws.getCell(HEADER, i + 1).value);
    expect(labels).toEqual([
      "ID", "Номер заказа", "Дата", "Тип", "Место", "Официант", "Кассир",
      "Цена обслуживания", "Цена всего", "Тип оплаты", "Статус",
    ]);
    expect(ws.getCell(HEADER, 12).value).toBeNull(); // no 12th column
  });

  // VISUAL FIX 01 replaces the former "preserves metadata semantics" test.
  // OLD product expectation: rows 1-2 carried a "Период"/"Официант" filter
  // metadata block above the table. NEW approved decision: no metadata block —
  // row 1 IS the business header. This assertion is strengthened: it proves the
  // metadata is genuinely absent (row 1 is the ID header, not "Период").
  it("emits NO metadata block — row 1 is the business header", async () => {
    const { ws } = await roundtrip(data, columns, options);
    expect(ws.getCell(1, 1).value).toBe("ID");
    expect(ws.getCell(1, 1).value).not.toBe("Период");
    // First data row sits immediately below the header at row 2 — the canonical
    // integer public_id (not a UUID).
    expect(ws.getCell(2, 1).value).toBe(10000000);
  });

  it("keeps canonical values truthful (public_id numeric, date typed, money numeric)", async () => {
    const { ws } = await roundtrip(data, columns, options);
    // Data rows now start at row 2 (header is row 1; no metadata/spacer).
    const pid = ws.getCell(2, 1);
    expect(typeof pid.value).toBe("number");
    expect(pid.value).toBe(10000000);
    // Место carries the composed canonical place string.
    expect(ws.getCell(2, 5).value).toBe("Основной зал, стол 5");
    const date = ws.getCell(2, 3);
    expect(date.value).toBeInstanceOf(Date);
    expect(Math.abs(date.value.getTime() - new Date(2026, 8, 18, 14, 5, 0).getTime())).toBeLessThan(5000);
    expect(typeof ws.getCell(2, 8).value).toBe("number"); // serviceFee 9300
    expect(ws.getCell(2, 8).value).toBe(9300);
    expect(typeof ws.getCell(2, 9).value).toBe("number"); // totalAmount 33000
    expect(ws.getCell(2, 9).value).toBe(33000);
    // Zero service stays numeric 0; empty text stays empty (not "—").
    expect(ws.getCell(3, 8).value).toBe(0);
    expect(ws.getCell(3, 7).value).toBeNull(); // empty cashiers
  });

  it("preserves multi-cashier and multi-payment joins verbatim", async () => {
    const { ws } = await roundtrip(data, columns, options);
    expect(ws.getCell(2, 7).value).toBe("Яков, Алишер");
    expect(ws.getCell(2, 10).value).toBe("Наличные, Pay me");
  });

  it("writes a numeric totals row with separate service/total (never summed)", async () => {
    const { ws } = await roundtrip(data, columns, options);
    // Totals row now sits at row 4 (header 1 + 2 data rows + 1).
    expect(ws.getCell(4, 1).value).toBe("Итого:");
    expect(ws.getCell(4, 8).value).toBe(9300);
    expect(ws.getCell(4, 9).value).toBe(113000);
    expect(typeof ws.getCell(4, 8).value).toBe("number");
    expect(typeof ws.getCell(4, 9).value).toBe("number");
    // Totals styling: bold + clear top border + light fill.
    const totalCell = ws.getCell(4, 9);
    expect(totalCell.font.bold).toBe(true);
    expect(totalCell.border.top.style).toBe("medium");
    expect(totalCell.fill.type).toBe("pattern");
    expect(totalCell.numFmt).toBe("#,##0");
  });

  // VISUAL FIX 01: header fill changed from FFEEF2F7 (old light blue-gray) to
  // FFB6EFF0 (#B6EFF0 approved teal); font pinned to Calibri 11 bold. Borders
  // stay thin. Assertions strengthened with explicit font name + size.
  it("styles the header: Calibri 11 bold, #B6EFF0 fill, thin borders, centered", async () => {
    const { ws } = await roundtrip(data, columns, options);
    const cell = ws.getCell(HEADER, 1);
    expect(cell.font.name).toBe("Calibri");
    expect(cell.font.size).toBe(11);
    expect(cell.font.bold).toBe(true);
    expect(cell.font.color.argb).toBe("FF1F2937");
    expect(cell.fill.type).toBe("pattern");
    expect(cell.fill.fgColor.argb).toBe("FFB6EFF0");
    expect(cell.border.top.style).toBe("thin");
    expect(cell.border.bottom.style).toBe("thin");
    expect(cell.alignment.horizontal).toBe("center");
    expect(cell.alignment.vertical).toBe("middle");
    expect(ws.getRow(HEADER).height).toBe(22);
  });

  // VISUAL FIX 01: body font pinned to Calibri 11 (non-bold) across data cells.
  it("uses Calibri 11 non-bold body font in data rows", async () => {
    const { ws } = await roundtrip(data, columns, options);
    const dataCell = ws.getCell(2, 1);
    expect(dataCell.font.name).toBe("Calibri");
    expect(dataCell.font.size).toBe(11);
    expect(dataCell.font.bold).toBeFalsy();
  });

  it("aligns numbers right, dates center, text left in data rows", async () => {
    const { ws } = await roundtrip(data, columns, options);
    expect(ws.getCell(2, 8).alignment.horizontal).toBe("right");  // money
    expect(ws.getCell(2, 3).alignment.horizontal).toBe("center"); // date
    expect(ws.getCell(2, 1).alignment.horizontal).toBe("left");   // text
  });

  it("applies number/date formats to data cells", async () => {
    const { ws } = await roundtrip(data, columns, options);
    expect(ws.getCell(2, 8).numFmt).toBe("#,##0");
    expect(ws.getCell(2, 9).numFmt).toBe("#,##0");
    expect(ws.getCell(2, 3).numFmt).toBe("dd.mm.yyyy hh:mm");
  });

  it("sets per-column widths", async () => {
    const { ws } = await roundtrip(data, columns, options);
    // ID column is now 14 (canonical ~8-digit public_id, not a 38-wide UUID).
    expect(ws.getColumn(1).width).toBe(14);
    expect(ws.getColumn(8).width).toBe(20);
    expect(ws.getColumn(9).width).toBe(16);
  });

  // VISUAL FIX 01: header is now row 1, so the filter starts at row 1.
  // OLD: A4:K6 (below the metadata block). NEW: A1:K3 — header row 1 through
  // the last DATA row 3; the totals row (4) stays outside the filter.
  it("adds a native autofilter from row 1 over data rows only (totals excluded)", async () => {
    const { ws } = await roundtrip(data, columns, options);
    // ExcelJS serializes the from/to range to an A1 ref string on reload.
    expect(ws.autoFilter).toBe("A1:K3");
  });

  // VISUAL FIX 01: with no metadata, the freeze sits directly below row 1
  // (ySplit = 1) so only the business header stays pinned on scroll.
  it("freezes the pane directly below the header row (ySplit = 1)", async () => {
    const { ws } = await roundtrip(data, columns, options);
    const view = ws.views[0];
    expect(view.state).toBe("frozen");
    expect(view.ySplit).toBe(1);
    expect(HEADER).toBe(1);
  });

  it("applies restrained status font colors, unknown → default", async () => {
    const { ws } = await roundtrip(data, columns, options);
    // "Завершён" (row 2) → subtle green, "Новый" (row 3) → subtle blue.
    expect(ws.getCell(2, 11).font.color.argb).toBe("FF15803D");
    expect(ws.getCell(3, 11).font.color.argb).toBe("FF1D4ED8");
  });

  it("uses the requested worksheet name", async () => {
    const { name } = await roundtrip(data, columns, options);
    expect(name).toBe("Отчёт по заказам");
  });

  // VISUAL FIX 01 replaces the former "metadata row OUT of autofilter" test
  // (no metadata exists now). The meaningful remaining exclusion: the totals
  // row must stay OUTSIDE the filter. Filter ends at row 3 (last data row);
  // the "Итого:" totals row at row 4 is excluded.
  it("keeps the totals row OUT of the autofilter range", async () => {
    const { ws } = await roundtrip(data, columns, options);
    const endRow = Number(String(ws.autoFilter).split(":")[1].match(/\d+/)[0]);
    expect(endRow).toBe(3);
    // Row 4 holds the totals label, proving it is past the filter end.
    expect(ws.getCell(4, 1).value).toBe("Итого:");
  });
});

describe("REPORTS-EXCEL-04 backwards-safe defaults", () => {
  it("defaults to sheet name Отчёт and no autofilter/totals when unset", async () => {
    const { ws, name } = await roundtrip(
      [{ amount: 10 }],
      [{ key: "amount", label: "Сумма" }],
    );
    expect(name).toBe("Отчёт");
    expect(ws.autoFilter).toBeUndefined();
    expect(ws.getCell(1, 1).value).toBe("Сумма");
    expect(ws.getCell(2, 1).value).toBe(10);
    expect(ws.getCell(3, 1).value).toBeNull(); // no totals row
  });

  it("truncates/sanitizes overlong or illegal sheet names", () => {
    const wb = buildReportWorkbook([{ a: 1 }], [{ key: "a", label: "A" }], {
      sheetName: "Отчёт: по [делам]/личный* очень длинное имя которое выходит за предел",
    });
    const name = wb.worksheets[0].name;
    expect(name.length).toBeLessThanOrEqual(31);
    expect(/[:\\/?*[\]]/.test(name)).toBe(false);
  });

  it("omits autofilter on an empty data set", async () => {
    const { ws } = await roundtrip(
      [],
      [{ key: "id", label: "ID", width: 12 }],
      { autofilter: true },
    );
    expect(ws.autoFilter).toBeUndefined();
  });
});


// ── WAITERS-EXCEL-01: 5-column contract, numeric money, percent-dependent E ──
describe("WAITERS-EXCEL-01 Waiters export", () => {
  const columns = [
    { key: "name", label: "Имя", width: 24 },
    { key: "ordersTotal", label: "Сумма заказов", type: "number", format: "#,##0", width: 20 },
    { key: "takeawayDeliveryTotal", label: "Сумма заказов на вынос", type: "number", format: "#,##0", width: 24 },
    { key: "serviceTotal", label: "Сумма услуги", type: "number", format: "#,##0", width: 18 },
    { key: "waiterServiceTotal", label: "Обслуга официанта", type: "number", format: "#,##0", width: 20 },
  ];
  // Backend-parameterized rows: waiter_service_total already reflects the chosen
  // percent (canonical). We simulate the two backend responses (10% vs 20%).
  const rowsFor = (pct) => [
    { name: "Алишер", ordersTotal: 500006576000, takeawayDeliveryTotal: 32000, serviceTotal: 2298000, waiterServiceTotal: Math.round(2298000 * pct / 100) },
    { name: "Эльёр", ordersTotal: 2298000, takeawayDeliveryTotal: 0, serviceTotal: 205000, waiterServiceTotal: Math.round(205000 * pct / 100) },
  ];
  const totalsFor = (rows) => ({
    label: "Итого:",
    values: {
      ordersTotal: rows.reduce((a, r) => a + r.ordersTotal, 0),
      takeawayDeliveryTotal: rows.reduce((a, r) => a + r.takeawayDeliveryTotal, 0),
      serviceTotal: rows.reduce((a, r) => a + r.serviceTotal, 0),
      waiterServiceTotal: rows.reduce((a, r) => a + r.waiterServiceTotal, 0),
    },
  });

  it("has exactly 5 reference-worded headers at row 1, no metadata, no col F", async () => {
    const { ws } = await roundtrip(rowsFor(10), columns, { sheetName: "Отчёт по официантам", totals: totalsFor(rowsFor(10)) });
    expect([1,2,3,4,5].map((c) => ws.getCell(1, c).value)).toEqual([
      "Имя", "Сумма заказов", "Сумма заказов на вынос", "Сумма услуги", "Обслуга официанта",
    ]);
    expect(ws.getCell(1, 6).value).toBeNull();       // no "Блюда"/6th col
    expect(ws.getCell(1, 1).value).not.toBe("Период"); // no metadata block above
  });

  it("keeps money numeric (big values, never stringified)", async () => {
    const { ws } = await roundtrip(rowsFor(10), columns, { sheetName: "Отчёт по официантам", totals: totalsFor(rowsFor(10)) });
    expect(typeof ws.getCell(2, 1).value).toBe("string");     // name
    expect(ws.getCell(2, 2).value).toBe(500006576000);        // big order sum
    expect(typeof ws.getCell(2, 2).value).toBe("number");
    expect(ws.getCell(2, 2).numFmt).toBe("#,##0");
  });

  it("totals row follows data immediately with numeric totals", async () => {
    const rows = rowsFor(10);
    const { ws } = await roundtrip(rows, columns, { sheetName: "Отчёт по официантам", totals: totalsFor(rows) });
    // rows 2-3 data, row 4 totals.
    expect(ws.getCell(4, 1).value).toBe("Итого:");
    expect(ws.getCell(4, 2).value).toBe(500008874000);        // sum of orders
    expect(typeof ws.getCell(4, 5).value).toBe("number");     // total Обслуга numeric
  });

  it("Обслуга официанта (E) changes with the service percent; other columns do not", async () => {
    const r10 = rowsFor(10), r20 = rowsFor(20);
    const a = await roundtrip(r10, columns, { sheetName: "Отчёт по официантам", totals: totalsFor(r10) });
    const b = await roundtrip(r20, columns, { sheetName: "Отчёт по официантам", totals: totalsFor(r20) });
    // Row-level E doubles from 10% to 20%.
    expect(a.ws.getCell(2, 5).value).toBe(229800);
    expect(b.ws.getCell(2, 5).value).toBe(459600);
    expect(a.ws.getCell(2, 5).value).not.toBe(b.ws.getCell(2, 5).value);
    // Totals E changes consistently (2x).
    expect(b.ws.getCell(4, 5).value).toBe(a.ws.getCell(4, 5).value * 2);
    // Non-percent columns (orders sum) unchanged across percent.
    expect(a.ws.getCell(4, 2).value).toBe(b.ws.getCell(4, 2).value);
  });

  it("zero-data: headers row 1 + Итого row 2 with numeric zeros", async () => {
    const zeros = { label: "Итого:", values: { ordersTotal: 0, takeawayDeliveryTotal: 0, serviceTotal: 0, waiterServiceTotal: 0 } };
    const { ws } = await roundtrip([], columns, { sheetName: "Отчёт по официантам", totals: zeros });
    expect(ws.getCell(1, 1).value).toBe("Имя");
    expect(ws.getCell(2, 1).value).toBe("Итого:");
    expect(ws.getCell(2, 2).value).toBe(0);
    expect(typeof ws.getCell(2, 5).value).toBe("number");
  });
});
