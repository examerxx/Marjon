import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { exportToExcel } from "./excel";

vi.mock("xlsx", () => ({
  utils: {
    aoa_to_sheet: vi.fn(() => ({ sheet: true })),
    book_new: vi.fn(() => ({ workbook: true })),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}));

describe("exportToExcel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the existing tabular export when metadata is omitted", () => {
    exportToExcel([{ amount: 10 }], [{ key: "amount", label: "Сумма" }], "plain");
    expect(XLSX.utils.aoa_to_sheet).toHaveBeenCalledWith([["Сумма"], [10]]);
    expect(XLSX.writeFile).toHaveBeenCalledWith({ workbook: true }, "plain.xlsx");
  });

  it("writes report metadata before the current-state table", () => {
    exportToExcel(
      [{ name: "Алишер", amount: 10 }, { name: "Всего", amount: 10 }],
      [{ key: "name", label: "Имя" }, { key: "amount", label: "Сумма" }],
      "waiters-report",
      { metadata: [{ label: "Период", value: "01.09.2026 – 12.09.2026" }] },
    );
    expect(XLSX.utils.aoa_to_sheet).toHaveBeenCalledWith([
      ["Период", "01.09.2026 – 12.09.2026"],
      [],
      ["Имя", "Сумма"],
      ["Алишер", 10],
      ["Всего", 10],
    ]);
  });
});
