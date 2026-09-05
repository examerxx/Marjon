import { describe, expect, it } from "vitest";
import { navItems } from "./navConfig";

const childPaths = (key) => navItems.find((item) => item.key === key)?.children.map((child) => child.to);

describe("OWNER sidebar navigation order", () => {
  it("keeps the requested report, menu, and warehouse-report ordering", () => {
    expect(childPaths("reports")).toEqual([
      "/reports/z-report",
      "/reports/orders",
      "/reports/waiters",
      "/reports/dishes",
      "/reports/tables",
      "/reports/cancelled-dishes",
    ]);
    expect(childPaths("nomenclature")).toEqual([
      "/nomenclature/dishes",
      "/nomenclature/dish-categories",
      "/nomenclature/menu",
      "/nomenclature/stop-list",
    ]);
    expect(childPaths("warehouse-report")).toEqual([
      "/stock-report/incoming-journal",
      "/stock-report/incoming",
      "/stock-report/outgoing",
      "/stock-report/stock",
      "/stock-report/transfer",
      "/stock-report/inventory",
      "/stock-report/write-off",
      "/stock-report/write-off-categories",
      "/stock-report/waste",
    ]);
  });
});
