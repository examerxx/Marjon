import { describe, expect, it } from "vitest";
import { buildRealKpis, bucketIncome } from "./analyticsData";
import { formatRevenueAxisTick } from "./RevenueChart";

const summary = {
  metric_basis: "completed_income_minus_snapshot_cogs", date_from: "2026-10-12", date_to: "2026-10-17",
  income_total: "220.00", cogs_total: "40.00", today_revenue: "180.00", today_orders: 1,
  avg_check: "220.00", active_orders: 3, payment_methods: [{ method: "cash", amount: "220.00" }],
};
const finance = [{ direction: "income", amount: 999999, category_name: "Ручной приход" }, { direction: "expense", amount: 50 }];
const build = (data) => buildRealKpis(data, [], "2026-10-17", [], finance);

// Порядок карточек на дашборде — требование владельца, а не деталь вёрстки:
// денежный приход → чистая прибыль → заказы → средний чек → расходы.
const CARD_ORDER = ["Денежный приход", "Чистая прибыль", "Заказы", "Средний чек", "Денежные расходы"];
const income = (kpis) => kpis[0];
const profit = (kpis) => kpis[1];
const expense = (kpis) => kpis[4];

describe("OWNER agreed financial scheme", () => {
  it("keeps the owner's card order and the agreed labels", () => {
    const kpis = build(summary);
    expect(kpis.map((kpi) => kpi.label)).toEqual(CARD_ORDER);
    // Класс карточки едет вместе с метрикой: перестановка не должна
    // переназначить иллюстрацию/цвет соседней карточке.
    expect(kpis.map((kpi) => kpi.className)).toEqual([
      "premium-kpi--tables", "premium-kpi--revenue", "premium-kpi--orders",
      "premium-kpi--avg", "premium-kpi--expense",
    ]);
  });

  it("subtracts Finance expenses without double counting unrelated income", () => {
    const kpis = build(summary);
    expect(income(kpis).value).toBe("220");
    expect(profit(kpis).value).toBe("130");
    expect(income(kpis).table.rows).toEqual([{ name: "Наличные", amount: 220, percent: 100 }]);
    expect(expense(kpis).numericValue).toBe(50);
    expect(profit(kpis).table.showShare).toBe(false);
    expect(profit(kpis).table.rows.map((r) => r.amount)).toEqual([220, "40.00", 50, 130]);
  });

  it("does not invent profit when historical cost is missing, but keeps known income", () => {
    const kpis = build({ ...summary, today_revenue: null, cogs_total: null });
    expect(profit(kpis).value).toBe("Недоступно");
    expect(income(kpis).value).toBe("220");
    expect(profit(kpis).table.formatValue(null)).toBe("Неизвестно");
  });

  it("preserves a negative result rather than clamping it to zero", () => {
    const kpis = build({ ...summary, today_revenue: "-180.00", cogs_total: "400.00" });
    expect(profit(kpis).value).toMatch(/[-−]230/);
    expect(formatRevenueAxisTick(-50000, true)).toBe("−50K");
    expect(formatRevenueAxisTick(-200, true)).toBe("−200");
    expect(formatRevenueAxisTick(200, true)).toBe("200");
  });

  it("distinguishes a failed financial report from a successful empty period", () => {
    const failed = build({ ...summary, income_total: null, cogs_total: null, today_revenue: null, financial_unavailable: true });
    expect(profit(failed).value).toBe("Недоступно");
    expect(income(failed).value).toBe("Недоступно");
    const empty = build({ ...summary, income_total: "0.00", cogs_total: "0.00", today_revenue: "0.00", today_orders: 0, avg_check: 0, payment_methods: [] });
    expect(profit(empty).value).toMatch(/[-−]50/);
    expect(income(empty).value).toBe("0");
  });
});

describe("bucketIncome (график денежного прихода)", () => {
  it("prefers the gross income of the bucket over the net revenue", () => {
    expect(bucketIncome({ income: "220.00", revenue: "180.00" })).toBe(220);
  });

  it("falls back to revenue when an older response has no income field", () => {
    expect(bucketIncome({ revenue: "180.00" })).toBe(180);
    expect(bucketIncome({ revenue: null })).toBe(0);
    expect(bucketIncome(null)).toBe(0);
  });
});

it("counts debt sales as reporting expenses and repayments as income without a cash withdrawal", () => {
  const rows = [
    { direction: "expense", amount: 340000, category_name: "Продажа в долг", non_cash: true },
    { direction: "expense", amount: 10000, category_name: "Аренда" },
    { direction: "income", amount: 200000, category_name: "Возврат долга" },
  ];
  const kpis = buildRealKpis({ ...summary, income_total: 0, today_revenue: 0, cogs_total: 0 }, [], "2026-11-18", [], rows);
  expect(income(kpis).numericValue).toBe(200000);
  expect(expense(kpis).numericValue).toBe(350000);
  expect(profit(kpis).numericValue).toBe(-150000);
  expect(rows[0].non_cash).toBe(true);
});
