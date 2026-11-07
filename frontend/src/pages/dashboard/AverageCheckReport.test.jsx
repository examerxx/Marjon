import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KpiInfoDialog } from "./DashboardDialogs";
import { buildRealKpis } from "./analyticsData";

const summary = {
  metric_basis: "completed_income_minus_snapshot_cogs", date_from: "2026-10-12", date_to: "2026-10-17",
  income_total: "700000", avg_check: "140000", today_orders: 5,
  average_check_rows: [
    { id: "2", place: "Стол 2", orders_count: 3, income: "300000", avg_check: "100000" },
    { id: "5", place: "Стол 5", orders_count: 2, income: "400000", avg_check: "200000" },
  ],
};
// Карточку ищем по классу, а не по позиции: порядок карточек задаёт владелец.
function show(data) {
  const kpi = buildRealKpis(data, [], "2026-10-17", [], [])
    .find((item) => item.className === "premium-kpi--avg");
  render(<KpiInfoDialog kpi={kpi} onClose={() => {}} />);
  return screen.getByRole("table");
}
describe("Average check by place", () => {
  it("shows four columns, paid counts and backend weighted total", () => {
    const table = show(summary);
    expect(within(table).getAllByRole("columnheader").map(el => el.textContent)).toEqual([
      "Место", "Оплачено заказов", "Денежный приход", "Средний чек",
    ]);
    for (const text of ["Стол 2", "Стол 5", "3 шт", "2 шт", "5 шт"]) expect(within(table).getByText(text)).toBeTruthy();
    expect(table.querySelector("thead tr.revenue-products__total td:last-child").textContent).toMatch(/140\s000 Сум/);
    expect(within(table).queryByText("Индекс")).toBeNull();
    expect(within(table).queryByText("Канал")).toBeNull();
    expect(screen.queryByText(/Денежный приход \/ количество/)).toBeNull();
  });
  it("shows a real empty report without totals", () => {
    const table = show({ ...summary, average_check_rows: [], avg_check: "0", income_total: "0", today_orders: 0 });
    expect(within(table).getByText("Нет данных")).toBeTruthy();
    expect(within(table).queryByText("Итого")).toBeNull();
    expect(within(table).queryByText("0 шт")).toBeNull();
    expect(within(table).queryAllByText("0 Сум")).toHaveLength(0);
  });
  it("distinguishes failed requests from empty data", () => {
    const table = show({ ...summary, average_check_rows: [], avg_check: null, financial_unavailable: true });
    expect(within(table).getByText("Не удалось загрузить средний чек")).toBeTruthy();
    expect(within(table).queryByText("Итого")).toBeNull();
    expect(screen.getByText("Недоступно")).toBeTruthy();
  });
  it("preserves fractional monetary amounts in the table", () => {
    const table = show({ ...summary, avg_check: "140000.25" });
    expect(within(table).getByText(/140\s000,25 Сум/)).toBeTruthy();
  });
});
