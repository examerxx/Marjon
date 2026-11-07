import { describe, it, expect } from "vitest";
import { checkedTransactions, previousDay, transactionTotals, expenseGroups, paymentBalances, dailyMovement, overviewRangeFromSearch } from "./financeOverviewData";

const rows = [
  { direction: "income", amount: "100.10", date: "2026-10-29T20:00:00Z", payment_type_id: "cash" },
  { direction: "expense", amount: "20.05", date: "2026-10-30T09:00:00Z", payment_type_id: "cash", category_id: "food" },
  { direction: "expense", amount: "0.05", date: "2026-10-30T10:00:00Z", category_id: "other" },
];
describe("finance overview recorded ledger", () => {
  it("preserves the chosen period when opening all operations, rejecting invalid dates", () => {
    const fallback = { start: "01.10.2026", end: "30.10.2026" };
    expect(overviewRangeFromSearch("?date_from=2026-09-01&date_to=2026-09-30", fallback)).toMatchObject({ start: "01.09.2026", end: "30.09.2026" });
    expect(overviewRangeFromSearch("?date_from=2026-02-30&date_to=2026-09-30", fallback)).toBe(fallback);
    expect(overviewRangeFromSearch("?date_from=2026-10-30&date_to=2026-10-01", fallback)).toBe(fallback);
  });
  it("totals decimal money without floating point drift", () => {
    expect(transactionTotals(rows)).toEqual({ income: 100.1, expense: 20.1, net: 80 });
    expect(transactionTotals([])).toEqual({ income: 0, expense: 0, net: 0 });
  });
  it("uses the day before the start across month/year boundaries", () => {
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
    expect(previousDay("2024-03-01")).toBe("2024-02-29");
  });
  it("buckets by Tashkent date and keeps quiet days", () => {
    expect(dailyMovement(rows, "2026-10-29", "2026-10-30")).toEqual([
      { date: "2026-10-29", income: 0, expense: 0 },
      { date: "2026-10-30", income: 100.1, expense: 20.1 },
    ]);
  });
  it("groups by immutable category and payment IDs, not translated labels", () => {
    expect(expenseGroups(rows, [{ id: "food", name: "Oziq-ovqat" }], "Other").map(row => [row.name, row.amount]))
      .toEqual([["Oziq-ovqat", 20.05], ["Other", 0.05]]);
    expect(paymentBalances(rows, [{ id: "cash", name: "Naqd" }], "Unknown").map(row => [row.name, row.amount]))
      .toEqual([["Naqd", 80.05], ["Unknown", -0.05]]);
  });
  it("does not turn malformed or unknown responses into zero money", () => {
    expect(checkedTransactions({ data: { items: [] } })).toEqual([]);
    expect(() => checkedTransactions({ data: [] })).toThrow();
    expect(() => checkedTransactions({ data: { items: [{ ...rows[0], amount: null }] } })).toThrow();
    expect(() => checkedTransactions({ data: { items: [{ ...rows[0], direction: "transfer" }] } })).toThrow();
  });
});
