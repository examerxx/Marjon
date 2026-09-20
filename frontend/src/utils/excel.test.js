import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { reportWorkbookBuffer } from "./excel";

// REPORTS-EXCEL-04: layout behavior proven against the REAL ExcelJS writer
// (was previously asserted against SheetJS aoa_to_sheet mocks — obsolete now
// that the production writer is ExcelJS). Same intent: metadata block, one
// blank spacer, business header, then data rows, in that order.
async function load(data, columns, options) {
  const buffer = await reportWorkbookBuffer(data, columns, options);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets[0];
}

describe("exportToExcel layout (ExcelJS)", () => {
  it("keeps a plain header+data table when metadata is omitted", async () => {
    const ws = await load([{ amount: 10 }], [{ key: "amount", label: "Сумма" }], {});
    expect(ws.getCell(1, 1).value).toBe("Сумма"); // header row 1
    expect(ws.getCell(2, 1).value).toBe(10);      // data row 2
  });

  it("writes the metadata block before the table, separated by one blank row", async () => {
    const ws = await load(
      [{ name: "Алишер", amount: 10 }, { name: "Всего", amount: 10 }],
      [{ key: "name", label: "Имя" }, { key: "amount", label: "Сумма" }],
      { metadata: [{ label: "Период", value: "01.09.2026 – 12.09.2026" }] },
    );
    // Row 1: metadata. Row 2: blank spacer. Row 3: header. Rows 4-5: data.
    expect(ws.getCell(1, 1).value).toBe("Период");
    expect(ws.getCell(1, 2).value).toBe("01.09.2026 – 12.09.2026");
    expect(ws.getCell(2, 1).value).toBeNull();
    expect(ws.getCell(3, 1).value).toBe("Имя");
    expect(ws.getCell(3, 2).value).toBe("Сумма");
    expect(ws.getCell(4, 1).value).toBe("Алишер");
    expect(ws.getCell(4, 2).value).toBe(10);
    expect(ws.getCell(5, 1).value).toBe("Всего");
    expect(ws.getCell(5, 2).value).toBe(10);
  });
});
