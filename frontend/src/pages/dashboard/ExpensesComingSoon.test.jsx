import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildRealKpis } from "./analyticsData";
import { KpiInfoDialog } from "./DashboardDialogs";

describe("Owner money expenses", () => {
  it("uses recorded Finance expenses and groups them by category", () => {
    const kpi = buildRealKpis({ expense_total: 12345 }, [], "2026-10-18", [], [
      { direction: "expense", amount: 200, category_name: "Rent" },
      { direction: "expense", amount: 50, category_name: "Rent" },
      { direction: "income", amount: 999 },
    ])[4];
    expect(kpi.numericValue).toBe(250);
    expect(kpi.suffix).toBe("UZS");
    expect(kpi.table.rows).toEqual([{ name: "Rent", amount: 250, percent: 100 }]);
  });

  it("renders an empty expense breakdown for a period without expenses", () => {
    const kpi = buildRealKpis({}, [], "2026-10-18")[4];
    render(<KpiInfoDialog kpi={kpi} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: kpi.label });
    expect(kpi.numericValue).toBe(0);
    expect(within(dialog).getByText(kpi.table.emptyText)).toBeInTheDocument();
  });
});
