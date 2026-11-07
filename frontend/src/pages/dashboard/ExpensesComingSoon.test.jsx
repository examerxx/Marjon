import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildRealKpis } from "./analyticsData";
import { KpiInfoDialog } from "./DashboardDialogs";

describe("OWNER money expenses coming soon", () => {
  it("shows Soon instead of a financial zero or recorded expense amount", () => {
    const kpi = buildRealKpis({ expense_total: 12345 }, [], "2026-10-18", [], [
      { direction: "expense", amount: 99999 },
    ])[4];
    expect(kpi.value).toBe("Скоро");
    expect(kpi.suffix).toBe("");
    expect(kpi.comingSoon).toBe(true);
    expect(kpi.table).toBeUndefined();
  });

  it("opens an Orders-width dialog without counts, financial text, or table labels", () => {
    const kpi = buildRealKpis({}, [], "2026-10-18")[4];
    render(<KpiInfoDialog kpi={kpi} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Денежные расходы" });
    expect(dialog).toHaveClass("kpi-info-window--detail", "kpi-info-window--coming-soon");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Скоро, эта категория в разработке");
    expect(within(dialog).queryByRole("table")).toBeNull();
    expect(dialog.querySelector(".kpi-info-window__value")).toBeNull();
    for (const text of [/0\s*шт/, /UZS/, "№ заказа", "Дата и время", "Место", "Сумма", "Статус", "Нет данных", "Итого", "Статья расходов", /Фактические расходы/]) {
      expect(within(dialog).queryByText(text)).toBeNull();
    }
    expect(within(dialog).getByRole("button", { name: "Закрыть" })).toBeEnabled();
  });
});
