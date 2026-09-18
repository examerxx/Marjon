import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrdersReportPage from "./OrdersReportPage";
import WaitersReportPage from "./WaitersReportPage";
import DishesReportPage from "./DishesReportPage";
import TablesReportPage from "./TablesReportPage";
import CancelledDishesReportPage from "./CancelledDishesReportPage";

vi.mock("../api/reports", () => ({
  reportsService: {
    listOrders: vi.fn(),
    getOrdersFilters: vi.fn(),
    listWaiters: vi.fn(),
    getWaitersFilters: vi.fn(),
    listDishes: vi.fn(),
    getDishesFilters: vi.fn(),
    listTables: vi.fn(),
    getTablesFilters: vi.fn(),
    listCancelledDishes: vi.fn(),
  },
}));

vi.mock("../utils/excel", () => ({ exportToExcel: vi.fn() }));

import { reportsService } from "../api/reports";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// No full-page loader: every report mounts its shell (title/controls/table)
// immediately and keeps a silent same-geometry pending state until the first
// response resolves. Only the response populates rows or truthful empty-state.
describe("report initial shell without full-page loader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    reportsService.getOrdersFilters.mockResolvedValue({ data: {} });
    reportsService.getWaitersFilters.mockResolvedValue({ data: { waiters: [] } });
    reportsService.getDishesFilters.mockResolvedValue({ data: {} });
    reportsService.getTablesFilters.mockResolvedValue({ data: {} });
  });

  it.each([
    ["orders", OrdersReportPage, "Отчёт по заказам", "listOrders"],
    ["waiters", WaitersReportPage, "Отчёт по официантам", "listWaiters"],
    ["dishes", DishesReportPage, "Отчёт по блюдам", "listDishes"],
    ["tables", TablesReportPage, "Отчёт по столам", "listTables"],
    ["cancelled", CancelledDishesReportPage, "Отчёт по отменённым блюдам", "listCancelledDishes"],
  ])("%s mounts its shell with no visible loader while pending", async (_key, Page, title, listFn) => {
    const gate = deferred();
    reportsService[listFn].mockReturnValue(gate.promise);

    const { unmount } = render(<Page />);

    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0);
    // No visible loading indicator of any kind.
    expect(screen.queryByText("Загрузка отчёта...")).toBeNull();
    expect(document.querySelector(".dashboard-empty")).toBeNull();
    expect(document.querySelector(".report-loading-row")).toBeNull();
    expect(document.querySelector(".owner-report-loading")).toBeNull();

    gate.resolve({ data: [] });
    unmount();
  });

  it("orders resolves rows after the silent pending state", async () => {
    const gate = deferred();
    reportsService.listOrders.mockReturnValue(gate.promise);

    const { unmount } = render(<OrdersReportPage />);
    expect(screen.getByRole("heading", { name: "Отчёт по заказам" })).toBeInTheDocument();

    gate.resolve({
      data: [{
        order_id: "order-9", order_number: "ORD-1101", created_at: "2026-09-16T10:00:00Z",
        status: "completed", table_number: "3", waiter_name: "Официант 1", items_count: 1, total_amount: 50000,
      }],
    });
    expect(await screen.findByText("ORD-1101")).toBeInTheDocument();
    expect(document.querySelector(".dashboard-empty")).toBeNull();
    unmount();
  });

  it("orders shows the truthful empty state only after loaded zero data", async () => {
    reportsService.listOrders.mockResolvedValue({ data: [] });

    const { unmount } = render(<OrdersReportPage />);
    expect(await screen.findByText("Заказов не найдено")).toBeInTheDocument();
    expect(document.querySelector(".report-loading-row")).toBeNull();
    unmount();
  });

  it("dishes shows rows and the truthful empty state after response", async () => {
    const gate = deferred();
    reportsService.listDishes.mockReturnValue(gate.promise);

    const { unmount } = render(<DishesReportPage />);
    expect(screen.getByRole("heading", { name: "Отчёт по блюдам" })).toBeInTheDocument();

    gate.resolve({
      data: {
        rows: [{ product_id: "dish-7", name: "Плов", unit: "порц", quantity: "2.000", price: "50000.00", amount: "100000" }],
        totals: { quantity: "2", amount: "100000" },
      },
    });
    const section = await screen.findByText("1. Плов");
    expect(within(section.closest("section")).getByRole("heading", { name: "Отчёт по блюдам" })).toBeInTheDocument();
    unmount();

    reportsService.listDishes.mockResolvedValue({ data: { rows: [], totals: { quantity: "0", amount: "0" } } });
    const second = render(<DishesReportPage />);
    expect(await screen.findByText("Блюд не найдено")).toBeInTheDocument();
    expect(document.querySelector(".report-loading-row")).toBeNull();
    second.unmount();
  });

  it("tables shows rows and the truthful empty state after response", async () => {
    const gate = deferred();
    reportsService.listTables.mockReturnValue(gate.promise);

    const { unmount } = render(<TablesReportPage />);
    expect(screen.getByRole("heading", { name: "Отчёт по столам" })).toBeInTheDocument();

    gate.resolve({ data: [{ table_number: "TBL-12A", orders_count: 2, revenue: 100000, avg_check: 50000 }] });
    expect(await screen.findByText("TBL-12A")).toBeInTheDocument();
    unmount();

    reportsService.listTables.mockResolvedValue({ data: [] });
    const second = render(<TablesReportPage />);
    expect(await screen.findByText("Столы не найдены")).toBeInTheDocument();
    expect(document.querySelector(".report-loading-row")).toBeNull();
    second.unmount();
  });

  it("cancelled shows rows and the truthful empty state after response", async () => {
    const gate = deferred();
    reportsService.listCancelledDishes.mockReturnValue(gate.promise);

    const { unmount } = render(<CancelledDishesReportPage />);
    expect(screen.getByRole("heading", { name: "Отчёт по отменённым блюдам" })).toBeInTheDocument();

    gate.resolve({
      data: [{
        date: "2026-09-16", time: "10:00", order_number: "42", table_number: "3",
        name: "Backend Dish", quantity: 1, price: 300, waiter_name: "Жасур", unit: "шт",
      }],
    });
    expect(await screen.findByText("Backend Dish")).toBeInTheDocument();
    unmount();

    reportsService.listCancelledDishes.mockResolvedValue({ data: [] });
    const second = render(<CancelledDishesReportPage />);
    expect(await screen.findByText("Отменённых блюд нет")).toBeInTheDocument();
    expect(document.querySelector(".report-loading-row")).toBeNull();
    second.unmount();
  });

  it("waiters keeps the totals row with zero state after loaded zero data", async () => {
    reportsService.listWaiters.mockResolvedValue({
      data: {
        rows: [],
        totals: {
          orders_count: 0, orders_total: "0.00", takeaway_delivery_total: "0.00",
          service_total: "0.00", waiter_service_total: "0.00", dishes_count: "0",
        },
      },
    });
    reportsService.getWaitersFilters.mockResolvedValue({ data: { waiters: [] } });

    const { unmount } = render(<WaitersReportPage />);
    expect(await screen.findByText("Всего")).toBeInTheDocument();
    expect(document.querySelector(".report-loading-row")).toBeNull();
    unmount();
  });
});
