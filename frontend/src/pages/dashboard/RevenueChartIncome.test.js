import { describe, expect, it } from "vitest";
import { buildRevenueChartSales, bucketIncome } from "./analyticsData";

describe("income chart and repayment totals", () => {
  const repayments = [{ direction: "income", category_name: "Возврат долга", date: "2026-11-18T12:30:00Z", amount: 721800 }];
  it("adds repayments to their local hour without changing paid-order income", () => {
    const original = [{ date: "2026-11-18", chart_label: "17:00", income: 238990 }];
    const result = buildRevenueChartSales(original, repayments, "2026-11-18", "2026-11-18");
    expect(result.reduce((sum, row) => sum + bucketIncome(row), 0)).toBe(960790);
    expect(result.find(row => row.chart_label === "17:00").income).toBe(960790);
    expect(original[0].income).toBe(238990);
  });
  it("shows repayment income even when there are no completed orders", () => {
    const result = buildRevenueChartSales([], repayments, "2026-11-18", "2026-11-18");
    expect(result).toHaveLength(24);
    expect(result.reduce((sum, row) => sum + bucketIncome(row), 0)).toBe(721800);
  });
  it("groups repayments by local day and excludes expenses", () => {
    const result = buildRevenueChartSales([], [...repayments, { ...repayments[0], direction: "expense", amount: 999 }], "2026-11-17", "2026-11-18");
    expect(result.find(row => row.date === "2026-11-18").income).toBe(721800);
    expect(result.reduce((sum, row) => sum + bucketIncome(row), 0)).toBe(721800);
  });
});
