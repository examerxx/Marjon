import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportsService } from "../api/reports";
import { ordersService } from "../api/orders";
import { paymentsService } from "../api/payments";
import { exportToExcel } from "../utils/excel";
import TablesReportPage from "./TablesReportPage";

vi.mock("../api/reports", () => ({
  reportsService: { listTables: vi.fn(), getTablesFilters: vi.fn() },
}));

vi.mock("../api/orders", () => ({
  ordersService: { get: vi.fn() },
}));

vi.mock("../api/payments", () => ({
  paymentsService: { listByOrder: vi.fn() },
}));

vi.mock("../components/ReportDateRangePicker", () => ({
  default: () => <button type="button">Период</button>,
}));

vi.mock("../utils/excel", () => ({ exportToExcel: vi.fn() }));

const FILTERS = {
  data: {
    waiters: [
      { value: "waiter-1", label: "Официант 1" },
      { value: "waiter-2", label: "Официант 2" },
    ],
    cashiers: [
      { value: "cashier-1", label: "Кассир 1" },
      { value: "cashier-2", label: "Кассир 2" },
    ],
    payment_methods: [
      { value: "cash", label: "Наличные" },
      { value: "card", label: "Карта" },
    ],
    places: [
      { value: "hall-zal", label: "Зал" },
      { value: "hall-bar", label: "Бар" },
    ],
    place_filter_supported: true,
  },
};

function tablesPayload() {
  return {
    data: [
      {
        table_id: "table-3", table_number: "3", orders_count: 2,
        revenue: "205.00", avg_check: "102.50",
        hall_id: "hall-zal", hall_name: "Зал",
        orders: [
          {
            order_id: "order-1", order_number: "101",
            created_at: "2026-09-10T10:35:00", total_amount: "120.00",
            order_type: "dine_in", status: "completed", waiter_name: "Официант 1",
          },
          {
            order_id: "order-2", order_number: "102",
            created_at: "2026-09-10T14:20:00", total_amount: "85.00",
            order_type: "delivery", status: "completed", waiter_name: "Официант 1",
          },
        ],
      },
      {
        table_id: null, table_number: "9", orders_count: 1,
        revenue: "50.00", avg_check: "50.00",
        hall_id: null, hall_name: null,
        orders: [
          {
            order_id: "order-9", order_number: "109",
            created_at: "2026-09-10T11:00:00", total_amount: "50.00",
            order_type: "takeaway", status: "completed", waiter_name: null,
          },
        ],
      },
    ],
  };
}

function orderDetailPayload() {
  return {
    data: {
      id: "order-1", order_number: "101", order_type: "dine_in", status: "completed",
      subtotal: "100.00", discount_amount: "0.00", tax_amount: "12.00",
      service_fee: "8.00", total_amount: "120.00",
      items: [
        {
          product_id: "dish-1", name: "Плов", price: "50000.00",
          quantity: "2.000", discount: "0.00", total: "100000.00",
          status: "served", note: null, modifiers: [], course: 1,
        },
      ],
    },
  };
}

function paymentsPayload() {
  return {
    data: [
      { id: "pay-1", amount: "70000.00", method: "cash", status: "completed" },
      { id: "pay-2", amount: "50000.00", method: "card", status: "completed" },
    ],
  };
}

function lastListTablesFilters() {
  const calls = reportsService.listTables.mock.calls;
  return calls[calls.length - 1][2].filters;
}

function headerFilterToggle() {
  return screen.getAllByRole("button", { name: "Фильтровать" }).find((button) => (
    button.classList.contains("tables-filter-toggle")
  ));
}

function openTableFilter(label) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const closingPanel = document.querySelector(".orders-filter-select__panel.is-closing");
  if (closingPanel) fireEvent(closingPanel, new Event("webkitAnimationEnd", { bubbles: true }));
  return screen.getByRole("listbox", { name: label });
}

describe("TablesReportPage Phase 1 exact table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportsService.listTables.mockResolvedValue(tablesPayload());
    reportsService.getTablesFilters.mockResolvedValue(FILTERS);
    ordersService.get.mockResolvedValue(orderDetailPayload());
    paymentsService.listByOrder.mockResolvedValue(paymentsPayload());
  });

  it("renders exactly the 4 approved columns with no KPI cards", async () => {
    render(<TablesReportPage />);
    await screen.findByText("3 — Зал");
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Номер стола", "Дата", "Сумма", "Транзакции",
    ]);
    for (const absent of ["Зал", "Кол-во заказов", "Выручка", "Средний чек", "Действие", "Статус", "Себестоимость", "Прибыль", "Цена обслуживания", "Цена места", "Сумма блюд"]) {
      expect(screen.queryByRole("columnheader", { name: absent })).toBeNull();
    }
    expect(document.querySelector(".report-summary-grid")).toBeNull();
    expect(document.querySelector(".report-filter-panel")).toBeNull();
  });

  it("opens on today and sends today/today in the initial request", async () => {
    render(<TablesReportPage />);
    await screen.findByText("3 — Зал");
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(reportsService.listTables).toHaveBeenNthCalledWith(1, today, today, expect.anything());
  });

  it("shows one row per table with aligned date/sum lines", async () => {
    render(<TablesReportPage />);
    await screen.findByText("3 — Зал");
    // Legacy bucket renders without hall context.
    expect(screen.getByText("9")).toBeInTheDocument();
    const dates = screen.getAllByText("10.09.2026 / 10:35");
    expect(dates.length).toBeGreaterThan(0);
    expect(screen.getByText("10.09.2026 / 14:20")).toBeInTheDocument();
    // Sums use the approved money formatter, aligned with their date lines.
    expect(screen.getByText("120 UZS")).toBeInTheDocument();
    expect(screen.getByText("85 UZS")).toBeInTheDocument();
  });

  it("shows Посмотреть заказы in Transactions without payment labels or action column", async () => {
    render(<TablesReportPage />);
    await screen.findByText("3 — Зал");
    const actions = screen.getAllByRole("button", { name: /Посмотреть заказы стола/ });
    expect(actions).toHaveLength(2);
    expect(screen.queryByText("Наличные")).toBeNull();
    expect(screen.queryByText("Карта")).toBeNull();
  });

  it("opens the modal with matching orders and lazy order detail", async () => {
    render(<TablesReportPage />);
    await screen.findByText("3 — Зал");
    expect(ordersService.get).not.toHaveBeenCalled();
    expect(paymentsService.listByOrder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Посмотреть заказы стола 3 — Зал" }));
    expect(await screen.findByText("Стол №3")).toBeInTheDocument();
    expect(screen.getByText("Зал: Зал")).toBeInTheDocument();
    expect(screen.getByText("Заказ №101")).toBeInTheDocument();
    expect(screen.getByText("Заказ №102")).toBeInTheDocument();
    // Modal order fields come from the lightweight summaries — no fetch yet.
    expect(screen.getByText("На месте")).toBeInTheDocument();
    expect(screen.getByText("Доставка")).toBeInTheDocument();
    expect(ordersService.get).not.toHaveBeenCalled();

    // Expanding one order lazy-loads full contents exactly once.
    fireEvent.click(screen.getByRole("button", { name: "Заказ №101" }));
    await waitFor(() => expect(ordersService.get).toHaveBeenCalledTimes(1));
    expect(ordersService.get).toHaveBeenCalledWith("order-1", expect.anything());
    expect(paymentsService.listByOrder).toHaveBeenCalledWith("order-1", expect.anything());
    expect(await screen.findByText("Плов")).toBeInTheDocument();
    expect(screen.getByText("Подытог")).toBeInTheDocument();
    expect(screen.getByText("Обслуживание")).toBeInTheDocument();
    // Both real payments render — never collapsed into one fake transaction.
    expect(screen.getByText("cash")).toBeInTheDocument();
    expect(screen.getByText("card")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Заказ №101" }));
    fireEvent.click(screen.getByRole("button", { name: "Заказ №101" }));
    await waitFor(() => expect(ordersService.get).toHaveBeenCalledTimes(1));

    // Escape closes the modal.
    fireEvent.keyDown(window.document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Стол №3")).toBeNull());
  });

  it("disables the action for legacy rows without identifiable orders", async () => {
    reportsService.listTables.mockResolvedValue({
      data: [{
        table_id: null, table_number: "9", orders_count: 0,
        revenue: "0.00", avg_check: "0.00",
        hall_id: null, hall_name: null, orders: [],
      }],
    });
    render(<TablesReportPage />);
    await screen.findByText("9");
    const action = screen.getByRole("button", { name: "Посмотреть заказы стола 9" });
    expect(action).toBeDisabled();
  });

  it("shows the truthful empty state with headers and no totals row", async () => {
    reportsService.listTables.mockResolvedValue({ data: [] });
    render(<TablesReportPage />);
    expect(await screen.findByText("Столы не найдены")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
    expect(document.querySelector(".tables-report-page .report-total-row")).toBeNull();
    expect(document.querySelector(".report-loading-row")).toBeNull();
  });

  it("shows error UI instead of fake zero-data on malformed response", async () => {
    reportsService.listTables.mockResolvedValue({ data: { rows: [], totals: {} } });
    render(<TablesReportPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Столы не найдены")).toBeNull();
  });

  it("multi-selects dropdowns with OR semantics and compact triggers", async () => {
    render(<TablesReportPage />);
    await screen.findByText("3 — Зал");
    fireEvent.click(headerFilterToggle());
    expect(document.querySelectorAll(".tables-filter-panel select")).toHaveLength(0);
    expect(screen.getByRole("combobox", { name: "Зал" })).toHaveTextContent("Выберите зал");
    openTableFilter("Официант");
    fireEvent.click(screen.getByRole("option", { name: "Официант 1" }));
    // Panel stays open; both stay checked after the second click.
    fireEvent.click(screen.getByRole("option", { name: "Официант 2" }));
    expect(screen.getByRole("option", { name: "Официант 1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "Официант 2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox", { name: "Официант" })).toHaveTextContent("Официант 1, Официант 2");
    openTableFilter("Зал");
    fireEvent.click(screen.getByRole("option", { name: "Зал" }));
    fireEvent.click(screen.getByRole("option", { name: "Бар" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Фильтровать" })[1]);
    await waitFor(() => expect(lastListTablesFilters()).toMatchObject({
      waiterId: ["waiter-1", "waiter-2"], hallId: ["hall-zal", "hall-bar"],
    }));
    // Unchecking one preserves the other.
    fireEvent.click(headerFilterToggle());
    openTableFilter("Официант");
    fireEvent.click(screen.getByRole("option", { name: "Официант 1" }));
    expect(screen.getByRole("option", { name: "Официант 1" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("option", { name: "Официант 2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox", { name: "Официант" })).toHaveTextContent("Официант 2");
  });

  it("multi-selects cashiers and payment methods with list params", async () => {
    render(<TablesReportPage />);
    await screen.findByText("3 — Зал");
    fireEvent.click(headerFilterToggle());
    openTableFilter("Кассир");
    fireEvent.click(screen.getByRole("option", { name: "Кассир 1" }));
    fireEvent.click(screen.getByRole("option", { name: "Кассир 2" }));
    openTableFilter("Тип оплаты");
    fireEvent.click(screen.getByRole("option", { name: "Наличные" }));
    fireEvent.click(screen.getByRole("option", { name: "Карта" }));
    expect(screen.getByRole("combobox", { name: "Тип оплаты" })).toHaveTextContent("Наличные, Карта");
    fireEvent.click(screen.getAllByRole("button", { name: "Фильтровать" })[1]);
    await waitFor(() => expect(lastListTablesFilters()).toMatchObject({
      cashierId: ["cashier-1", "cashier-2"], paymentMethod: ["cash", "card"],
    }));
    expect(Array.isArray(lastListTablesFilters().cashierId)).toBe(true);
  });

  it("exports every selected filter value in Excel metadata", async () => {
    render(<TablesReportPage />);
    await screen.findByText("3 — Зал");
    fireEvent.click(headerFilterToggle());
    openTableFilter("Официант");
    fireEvent.click(screen.getByRole("option", { name: "Официант 1" }));
    fireEvent.click(screen.getByRole("option", { name: "Официант 2" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Фильтровать" })[1]);
    await waitFor(() => expect(lastListTablesFilters()).toMatchObject({
      waiterId: ["waiter-1", "waiter-2"],
    }));
    document.querySelector(".report-excel-button").click();
    expect(exportToExcel).toHaveBeenCalledTimes(1);
    const [, , , options] = exportToExcel.mock.calls[0];
    expect(options.metadata.some(
      (item) => item.label === "Официант" && item.value === "Официант 1, Официант 2"
    )).toBe(true);
  });

  it("Очистить resets every multi-select to placeholders with no params sent", async () => {    render(<TablesReportPage />);
    await screen.findByText("3 — Зал");
    fireEvent.click(headerFilterToggle());
    openTableFilter("Официант");
    fireEvent.click(screen.getByRole("option", { name: "Официант 1" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Фильтровать" })[1]);
    await waitFor(() => expect(lastListTablesFilters()).toMatchObject({ waiterId: ["waiter-1"] }));
    fireEvent.click(screen.getByRole("button", { name: "Очистить" }));
    expect(screen.getByRole("combobox", { name: "Официант" })).toHaveTextContent("Выберите официанта");
    await waitFor(() => expect(lastListTablesFilters()).toMatchObject({
      waiterId: [], hallId: [], cashierId: [], paymentMethod: [],
    }));
  });

  it("keeps waiter and cashier as separate axes without author/order filters", async () => {
    render(<TablesReportPage />);
    await screen.findByText("3 — Зал");
    fireEvent.click(headerFilterToggle());
    expect(screen.getByRole("combobox", { name: "Официант" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Кассир" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Автор" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Тип заказа" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Статус заказа" })).toBeNull();
  });

  it("exports one row per order with truthful columns and metadata", async () => {
    render(<TablesReportPage />);
    await screen.findByText("3 — Зал");
    document.querySelector(".report-excel-button").click();
    expect(exportToExcel).toHaveBeenCalledTimes(1);
    const [lines, cols, filename, options] = exportToExcel.mock.calls[0];
    expect(cols.map((col) => col.key)).toEqual(["table", "date", "amount"]);
    expect(cols.map((col) => col.label)).toEqual(["Номер стола", "Дата", "Сумма"]);
    expect(filename).toBe("tables-report");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ table: "3 — Зал", date: "10.09.2026 / 10:35" });
    expect(lines[0].amount).toContain("120");
    expect(JSON.stringify(lines)).not.toContain("Посмотреть заказы");
    expect(JSON.stringify(lines)).not.toContain("Средний чек");
    expect(options.metadata.some((item) => item.label === "Период")).toBe(true);
  });

  it("exports an empty report as metadata plus header with no fabricated total row", async () => {
    reportsService.listTables.mockResolvedValue({ data: [] });
    render(<TablesReportPage />);
    expect(await screen.findByText("Столы не найдены")).toBeInTheDocument();
    document.querySelector(".report-excel-button").click();
    expect(exportToExcel).toHaveBeenCalledTimes(1);
    const [lines, cols, filename, options] = exportToExcel.mock.calls[0];
    expect(lines).toEqual([]);
    expect(cols.map((col) => col.label)).toEqual(["Номер стола", "Дата", "Сумма"]);
    expect(filename).toBe("tables-report");
    expect(JSON.stringify(lines)).not.toContain("Итого");
    expect(options.metadata.some((item) => item.label === "Период")).toBe(true);
  });

  it("keeps stale rows while a refetch pends and lets the latest win", async () => {
    render(<TablesReportPage />);
    await screen.findByText("3 — Зал");

    let resolveOld, resolveNew;
    reportsService.listTables
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveNew = resolve; }));
    const search = screen.getByLabelText("Номер стола");
    fireEvent.change(search, { target: { value: "3" } });
    document.querySelector(".report-filter-apply").click();
    fireEvent.change(search, { target: { value: "9" } });
    document.querySelector(".report-filter-apply").click();
    await waitFor(() => expect(reportsService.listTables.mock.calls.length).toBe(3));
    expect(screen.getByText("3 — Зал")).toBeInTheDocument();
    resolveNew({ data: [] });
    expect(await screen.findByText("Столы не найдены")).toBeInTheDocument();
    resolveOld(tablesPayload());
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(screen.queryByText("3 — Зал")).toBeNull();
    expect(screen.getByText("Столы не найдены")).toBeInTheDocument();
  });

  it("mounts the shell immediately with header toggle and collapse", async () => {
    let resolveFirst;
    reportsService.listTables.mockReturnValueOnce(
      new Promise((resolve) => { resolveFirst = resolve; })
    );
    render(<TablesReportPage />);
    expect(screen.getByRole("heading", { name: "Отчёт по столам" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText("Загрузка отчёта...")).toBeNull();
    const toggle = headerFilterToggle();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const collapse = document.querySelector(".tables-report-page .orders-filter-collapse");
    expect(collapse).not.toBeNull();
    expect(collapse).not.toHaveClass("is-open");
    fireEvent.click(toggle);
    expect(collapse).toHaveClass("is-open");
    resolveFirst(tablesPayload());
    expect(await screen.findByText("3 — Зал")).toBeInTheDocument();
  });
});

const placesMeta = {
  waiters: [{ value: "waiter-1", label: "Официант 1" }],
  cashiers: [{ value: "cashier-1", label: "Кассир 1" }],
  payment_methods: [{ value: "cash", label: "Наличные" }],
  places: [
    { value: "hall-zal", label: "Зал" },
    { value: "hall-bar", label: "Бар" },
    { value: "hall-balcony", label: "Балкон" },
  ],
  place_filter_supported: true,
};

describe("TablesReportPage — Зал (Place) filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportsService.listTables.mockResolvedValue({ data: [] }); // zero rows on purpose
    reportsService.getTablesFilters.mockResolvedValue({ data: placesMeta });
    ordersService.get.mockResolvedValue({ data: { items: [] } });
    paymentsService.listByOrder.mockResolvedValue({ data: [] });
  });

  it("exposes canonical Hall options from metadata (not hardcoded, not history-derived)", async () => {
    render(<TablesReportPage />);
    await screen.findByText("Столы не найдены");
    fireEvent.click(headerFilterToggle());
    openTableFilter("Зал");
    const opts = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opts).toEqual(expect.arrayContaining(["Зал", "Бар", "Балкон"]));
    // "Балкон" is present even though listTables returned [] → options come from
    // the filters metadata (Hall directory), not from report rows.
    expect(opts).toContain("Балкон");
  });

  it("sends hall_id only after Apply (draft-only before)", async () => {
    render(<TablesReportPage />);
    await screen.findByText("Столы не найдены");
    expect(reportsService.listTables).toHaveBeenCalledTimes(1); // initial load only
    fireEvent.click(headerFilterToggle());
    openTableFilter("Зал");
    fireEvent.click(screen.getByRole("option", { name: "Зал" }));
    expect(reportsService.listTables).toHaveBeenCalledTimes(1); // still draft — no refetch

    const panel = document.getElementById("tables-report-filters");
    fireEvent.click(within(panel).getByRole("button", { name: "Фильтровать" }));
    await waitFor(() => expect(reportsService.listTables).toHaveBeenCalledTimes(2));
    expect(reportsService.listTables.mock.calls[1][2].filters.hallId).toEqual(["hall-zal"]);
  });

  it("Clear resets the Hall selection back to all", async () => {
    render(<TablesReportPage />);
    await screen.findByText("Столы не найдены");
    fireEvent.click(headerFilterToggle());
    openTableFilter("Зал");
    fireEvent.click(screen.getByRole("option", { name: "Бар" }));
    const panel = document.getElementById("tables-report-filters");
    fireEvent.click(within(panel).getByRole("button", { name: "Фильтровать" }));
    await waitFor(() => expect(reportsService.listTables).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Очистить" }));
    await waitFor(() => expect(reportsService.listTables).toHaveBeenCalledTimes(3));
    expect(reportsService.listTables.mock.calls[2][2].filters.hallId).toEqual([]);
    expect(screen.getByRole("combobox", { name: "Зал" })).toHaveTextContent("Выберите зал");
  });
});

describe("TablesReportPage — Зал backward compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportsService.listTables.mockResolvedValue({ data: [] });
    reportsService.getTablesFilters.mockResolvedValue({
      data: { waiters: [], cashiers: [], payment_methods: [], places: [], place_filter_supported: false },
    });
    ordersService.get.mockResolvedValue({ data: { items: [] } });
    paymentsService.listByOrder.mockResolvedValue({ data: [] });
  });

  it("keeps Зал disabled and applies no specific hall when unsupported", async () => {
    render(<TablesReportPage />);
    await screen.findByText("Столы не найдены");
    fireEvent.click(headerFilterToggle());
    const hall = screen.getByRole("combobox", { name: "Зал" });
    expect(hall).toBeDisabled();
    // Applied hallId stays [] → reports.js compactParams omits hall_id.
    expect(reportsService.listTables.mock.calls.at(-1)[2].filters.hallId).toEqual([]);
  });
});
