import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KpiInfoDialog } from "./DashboardDialogs";
import { buildRealKpis } from "./analyticsData";
import { readFileSync } from "node:fs";
const revenueStyles = readFileSync(`${process.cwd()}/src/pages/dashboard/revenueProducts.css`, "utf8");

const summary = {
  metric_basis: "completed_income_minus_snapshot_cogs", date_from: "2026-10-12", date_to: "2026-10-17",
  income_total: "220.01", cogs_total: "40.00", today_revenue: "180.01", today_orders: 1,
  product_rows: [{ product_id: "1", name: "Плов", category: "Горячее", quantity: "0.333",
    income: "220.01", cogs: "40.00", revenue: "180.01" }],
};
// Карточки ищем по классу, а не по позиции: порядок задаёт владелец.
const CARD = {
  revenue: "premium-kpi--revenue",
  orders: "premium-kpi--orders",
  income: "premium-kpi--tables",
};
function show(data, card = CARD.revenue) {
  const kpi = buildRealKpis(data, [], "2026-10-17", [], [])
    .find((item) => item.className === card);
  render(<KpiInfoDialog kpi={kpi} onClose={() => {}} />);
  return screen.getByRole("table");
}
describe("Revenue product detail", () => {
  it("keeps totals outside the scrolling dish list", () => {
    show(summary);
    const scroll = screen.getByRole("region", { name: "Продажи оплаченных блюд" });
    expect(scroll.querySelector("thead > .revenue-products__total")).not.toBeNull();
    expect(scroll.querySelector("tbody .revenue-products__total")).toBeNull();
    expect(revenueStyles).toMatch(/kpi-detail-table tbody \{[^}]*overflow-y: auto/);
  });
  it("sizes the detail panel to its rows and disables hover shadows", () => {
    const panel = revenueStyles.match(/body\.dashboard-body \.kpi-info-window\.kpi-info-window--detail \{([^}]+)\}/)[1];
    expect(panel).toContain("height: auto");
    expect(panel).toContain("max-height: calc(100dvh - 32px)");
    expect(revenueStyles).not.toContain("height: min(980px");
    // !important в проекте запрещён (tools/no-important.py): приоритет даёт
    // внеслойный файл + высокая специфичность селектора, а не флаг.
    expect(revenueStyles).toMatch(/--detail:hover,[\s\S]*?box-shadow: none(?!\s*!important)/);
    expect(revenueStyles).toMatch(/--detail tr:hover \{\s*box-shadow: none(?!\s*!important)/);
  });
  it("places the profit title and centered amount in one compact heading", () => {
    show(summary);
    const dialog = screen.getByRole("dialog");
    const head = dialog.querySelector(".kpi-info-window__head");
    expect(dialog).toHaveClass("kpi-info-window--detail");
    expect(dialog.parentElement).toHaveClass("kpi-info-backdrop--detail");
    expect(within(head).getByRole("heading", { name: "Чистая прибыль" }).closest(".kpi-info-window__title-group")).not.toBeNull();
    expect(head.querySelector(".kpi-info-window__value")).not.toBeNull();
    expect(dialog.querySelectorAll(".kpi-info-window__value")).toHaveLength(1);
    expect(dialog.querySelector(":scope > .kpi-info-window__value")).toBeNull();
  });

  it("uses the same compact heading for the income dialog", () => {
    show(summary, CARD.income);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("kpi-info-window--detail");
    expect(dialog.querySelector(".kpi-info-window__head > .kpi-info-window__value")).not.toBeNull();
  });
  it("reverses both money columns, row values and totals only for income", () => {
    const table = show(summary, CARD.income);
    expect(within(table).getAllByRole("columnheader").map(el => el.textContent)).toEqual([
      "№", "Блюдо / товар", "Категория", "Продано", "Чистая прибыль", "Денежный приход",
    ]);
    const cells = table.querySelectorAll("tbody tr:not(.revenue-products__total) td");
    expect(cells[4].textContent).toBe("180,01 Сум");
    expect(cells[5].textContent).toBe("220,01 Сум");
    const totals = table.querySelectorAll("thead tr.revenue-products__total td");
    expect(totals[0].textContent).toBe("180,01 Сум");
    expect(totals[1].textContent).toBe("220,01 Сум");
    expect(screen.queryByText(/Подтверждённые оплаты полностью/)).toBeNull();
  });
  it("removes the orders explanation without changing its count", () => {
    show(summary, CARD.orders);
    expect(screen.getByText("шт")).toBeTruthy();
    expect(screen.queryByText("Полностью оплаченные завершённые заказы за выбранный период.")).toBeNull();
  });
  it("keeps all five order columns and no-data row without a total when empty", () => {
    const table = show({ ...summary, today_orders: 0, order_rows: [], orders_total: "0" }, CARD.orders);
    expect(within(table).getAllByRole("columnheader").map(el => el.textContent)).toEqual([
      "№ заказа", "Дата и время оплаты", "Место", "Сумма", "Статус",
    ]);
    expect(within(table).getByText("Нет данных")).toBeTruthy();
    expect(within(table).queryByText("Итого")).toBeNull();
    expect(within(table).queryByText("0 Сум")).toBeNull();
    expect(within(table).queryByText("Доля")).toBeNull();
    expect(screen.getByRole("dialog").className).toContain("kpi-info-window--detail");
  });
  it("renders genuine order fields and their total without mapping completed to ready", () => {
    const table = show({ ...summary, order_rows: [{ id: "order-1", number: "5", date_label: "17.10 19:57",
      place: "Стол 5", amount: "220.01", status: "completed" }], orders_total: "220.01" }, CARD.orders);
    for (const text of ["#5", "17.10 19:57", "Стол 5", "Завершён"]) expect(within(table).getByText(text)).toBeTruthy();
    expect(within(table).getAllByText("220,01 Сум")).toHaveLength(2);
  });
  it("does not present a failed order report as empty or show a fake total", () => {
    const table = show({ ...summary, financial_unavailable: true }, CARD.orders);
    expect(within(table).getByText("Не удалось загрузить заказы")).toBeTruthy();
    expect(within(table).queryByText("Итого")).toBeNull();
  });
  it("uses the six sales columns, real rows and reconciled totals", () => {
    const table = show(summary);
    expect(within(table).getAllByRole("columnheader").map(el => el.textContent)).toEqual([
      "№", "Блюдо / товар", "Категория", "Продано", "Денежный приход", "Чистая прибыль",
    ]);
    expect(within(table).getByText("Плов")).toBeTruthy();
    expect(within(table).getByText("Горячее")).toBeTruthy();
    expect(within(table).getByText(/0[.,]333/)).toBeTruthy();
    expect(within(table).getAllByText("220,01 Сум")).toHaveLength(2);
    expect(within(table).getByText("Итого")).toBeTruthy();
    expect(table.querySelector("thead tr:last-child")).toHaveClass("revenue-products__total");
    expect(table.querySelector("tfoot")).toBeNull();
    expect(within(table).queryByText("Средняя цена")).toBeNull();
    expect(screen.getByText("12.10.2026 – 17.10.2026")).toBeTruthy();
    expect(screen.queryByText(/Денежный приход минус историческая/)).toBeNull();
    expect(screen.queryByText(/Приход распределён/)).toBeNull();
    expect(screen.queryByText(/Себестоимость оплаченных позиций:/)).toBeNull();
  });
  it("keeps unknown historical profit unknown", () => {
    const table = show({ ...summary, cogs_total: null, today_revenue: null,
      product_rows: [{ ...summary.product_rows[0], cogs: null, revenue: null }] });
    expect(within(table).getAllByText("Неизвестно")).toHaveLength(2);
  });
  it("shows a compact empty state without totals", () => {
    const table = show({ ...summary, income_total: "0", cogs_total: "0", today_revenue: "0", product_rows: [] });
    expect(within(table).getByText("Нет данных")).toBeTruthy();
    expect(within(table).queryByText("Итого")).toBeNull();
  });
  it("does not show invented zero totals on request failure", () => {
    const table = show({ ...summary, financial_unavailable: true, income_total: null,
      cogs_total: null, today_revenue: null, product_rows: [] });
    expect(within(table).getByText("Не удалось загрузить продажи")).toBeTruthy();
    expect(within(table).queryByText("Итого")).toBeNull();
  });
});
