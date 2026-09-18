import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportsService } from "../api/reports";
import { ordersService } from "../api/orders";
import { exportToExcel } from "../utils/excel";
import { formatMoney } from "./reports/reportMoney";
import CancelledDishesReportPage from "./CancelledDishesReportPage";

vi.mock("../api/reports", () => ({
  reportsService: { listCancelledDishes: vi.fn(), getCancelledFilters: vi.fn() },
}));

vi.mock("../api/orders", () => ({
  ordersService: { get: vi.fn() },
}));

vi.mock("../components/ReportDateRangePicker", () => ({
  default: ({ value, onChange }) => (
    <div>
      <input aria-label="Начало периода" value={value?.start || ""} onChange={(event) => onChange({ ...value, start: event.target.value })} />
      <input aria-label="Конец периода" value={value?.end || ""} onChange={(event) => onChange({ ...value, end: event.target.value })} />
    </div>
  ),
}));

vi.mock("../utils/excel", () => ({ exportToExcel: vi.fn() }));

function todayApiValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const FILTERS = {
  data: {
    authors: [
      { id: "author-1", name: "Официант Али", role: "waiter" },
      { id: "author-2", name: "Кассир Вали", role: "cashier" },
    ],
    dishes: ["Плов", "Лагман"],
  },
};

function cancelledRow(overrides = {}) {
  return {
    order_number: "ORD-42",
    name: "Плов",
    table_number: "5",
    quantity: 2,
    waiter_name: "Официант Али",
    order_type: "dine_in",
    amount: 600,
    cancelled_by_name: "Кассир Вали",
    price: 300,
    order_id: "order-1",
    order_item_id: "item-1",
    cancellation_scope: "item",
    date_source: "cancelled_at",
    report_event_at: "2026-08-12T12:00:00Z",
    cancelled_at: "2026-08-12T12:00:00Z",
    ...overrides,
  };
}

function lastReportFilters() {
  const calls = reportsService.listCancelledDishes.mock.calls;
  return calls[calls.length - 1][2].filters;
}

function headerFilterToggle() {
  return screen.getAllByRole("button", { name: "Фильтровать" }).find((button) => (
    button.classList.contains("cancelled-filter-toggle")
  ));
}

function panelApplyButton() {
  return screen.getAllByRole("button", { name: "Фильтровать" }).find((button) => (
    button.classList.contains("report-filter-apply")
  ));
}

function finishDropdownExit() {
  const closingPanel = document.querySelector(".orders-filter-select__panel.is-closing");
  if (closingPanel) fireEvent(closingPanel, new Event("webkitAnimationEnd", { bubbles: true }));
}

function openCancelledFilter(label) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  finishDropdownExit();
  return screen.getByRole("listbox", { name: label });
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// The author/dish directories load asynchronously on mount; wait until the
// pickers enable before interacting with them.
async function awaitFilterDirectory() {
  await waitFor(() => {
    expect(screen.getByRole("combobox", { name: "Автор" })).not.toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Блюда" })).not.toBeDisabled();
  });
}

describe("CancelledDishesReportPage Phase 1B", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportsService.listCancelledDishes.mockResolvedValue({ data: [] });
    reportsService.getCancelledFilters.mockResolvedValue(FILTERS);
    ordersService.get.mockResolvedValue({ data: { items: [], subtotal: 0 } });
  });

  it("renders the exact 10 visible columns with no totals row", async () => {
    render(<CancelledDishesReportPage />);
    for (const label of ["Номер заказа", "Дата", "Название", "Номер стола", "Кол-во", "Официант", "Тип", "Сумма", "Автор", "Действие"]) {
      expect(await screen.findByRole("columnheader", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByText("Итого")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Ед. изм." })).toBeNull();
  });

  it("opens on today and loads the filters directory independently", async () => {
    render(<CancelledDishesReportPage />);
    await waitFor(() => expect(reportsService.listCancelledDishes).toHaveBeenCalled());
    const [dateFrom, dateTo] = reportsService.listCancelledDishes.mock.calls[0].slice(0, 2);
    expect(dateFrom).toBe(todayApiValue());
    expect(dateTo).toBe(todayApiValue());
    expect(reportsService.getCancelledFilters).toHaveBeenCalledTimes(1);
  });

  it("maps rows from truthful backend fields, keeping waiter and author separate", async () => {
    reportsService.listCancelledDishes.mockResolvedValue({ data: [cancelledRow()] });
    render(<CancelledDishesReportPage />);
    const row = await screen.findByText("Плов").then((node) => node.closest("tr"));
    const cells = within(row).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("ORD-42");
    expect(cells[1]).toHaveTextContent(/12\.08\.2026/);
    expect(cells[3]).toHaveTextContent("5");
    expect(cells[4]).toHaveTextContent("2");
    expect(cells[5]).toHaveTextContent("Официант Али");
    expect(cells[6]).toHaveTextContent("На месте");
    expect(cells[7]).toHaveTextContent(formatMoney(600));
    expect(cells[8]).toHaveTextContent("Кассир Вали");
  });

  it("renders — for missing author, waiter, and table without substitution", async () => {
    reportsService.listCancelledDishes.mockResolvedValue({
      data: [cancelledRow({ waiter_name: null, cancelled_by_name: null, table_number: null, amount: null })],
    });
    render(<CancelledDishesReportPage />);
    const row = await screen.findByText("Плов").then((node) => node.closest("tr"));
    const cells = within(row).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent("—");
    expect(cells[5]).toHaveTextContent("—");
    expect(cells[7]).toHaveTextContent("—");
    expect(cells[8]).toHaveTextContent("—");
  });

  it("falls back to unknown type labels truthfully and maps known types", async () => {
    reportsService.listCancelledDishes.mockResolvedValue({
      data: [
        cancelledRow({ order_item_id: "a", order_type: "qr" }),
        cancelledRow({ order_item_id: "b", order_type: "mystery_type" }),
      ],
    });
    render(<CancelledDishesReportPage />);
    expect(await screen.findByText("QR")).toBeInTheDocument();
    expect(screen.getByText("mystery_type")).toBeInTheDocument();
  });

  it("renders the waiter+cashier author directory even when rows are empty", async () => {
    reportsService.listCancelledDishes.mockResolvedValue({ data: [] });
    render(<CancelledDishesReportPage />);
    await awaitFilterDirectory();
    fireEvent.click(headerFilterToggle());
    const box = openCancelledFilter("Автор");
    expect(within(box).getByText("Официант Али")).toBeInTheDocument();
    expect(within(box).getByText("Кассир Вали")).toBeInTheDocument();
  });

  it("multi-selects authors and sends repeated author_id params", async () => {
    render(<CancelledDishesReportPage />);
    await awaitFilterDirectory();
    fireEvent.click(headerFilterToggle());
    const box = openCancelledFilter("Автор");
    fireEvent.click(within(box).getByText("Официант Али"));
    fireEvent.click(within(box).getByText("Кассир Вали"));
    // All selected labels shown, never a count.
    expect(screen.getByRole("combobox", { name: "Автор" })).toHaveTextContent("Официант Али, Кассир Вали");
    fireEvent.click(panelApplyButton());
    await waitFor(() => expect(lastReportFilters().authorId).toEqual(["author-1", "author-2"]));
    // Draft toggles never issue requests before Apply.
    expect(reportsService.listCancelledDishes).toHaveBeenCalledTimes(2);
  });

  it("multi-selects dishes and combines OR-within with AND-across", async () => {
    render(<CancelledDishesReportPage />);
    await awaitFilterDirectory();
    fireEvent.click(headerFilterToggle());
    const box = openCancelledFilter("Блюда");
    fireEvent.click(within(box).getByText("Плов"));
    fireEvent.click(within(box).getByText("Лагман"));
    fireEvent.change(screen.getByLabelText("Номер заказа"), { target: { value: "ORD-7" } });
    fireEvent.click(panelApplyButton());
    await waitFor(() => {
      const filters = lastReportFilters();
      expect(filters.dishName).toEqual(["Плов", "Лагман"]);
      expect(filters.orderNumber).toBe("ORD-7");
    });
    // One request carries every dimension (AND across, OR within server-side).
    expect(reportsService.listCancelledDishes).toHaveBeenCalledTimes(2);
  });

  it("omits emptied params on Clear instead of sending blanks", async () => {
    render(<CancelledDishesReportPage />);
    await awaitFilterDirectory();
    fireEvent.click(headerFilterToggle());
    const box = openCancelledFilter("Автор");
    fireEvent.click(within(box).getByText("Официант Али"));
    fireEvent.change(screen.getByLabelText("Номер заказа"), { target: { value: "ORD-7" } });
    fireEvent.click(panelApplyButton());
    await waitFor(() => expect(lastReportFilters().authorId).toEqual(["author-1"]));
    fireEvent.click(screen.getByRole("button", { name: "Очистить" }));
    await waitFor(() => {
      const filters = lastReportFilters();
      expect(filters.authorId).toEqual([]);
      expect(filters.dishName).toEqual([]);
      expect(filters.orderNumber).toBe("");
    });
  });

  it("shows the truthful empty state with headers and no fake totals", async () => {
    reportsService.listCancelledDishes.mockResolvedValue({ data: [] });
    render(<CancelledDishesReportPage />);
    expect(await screen.findByText("Отменённых блюд нет")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Автор" })).toBeInTheDocument();
    expect(screen.queryByText("Итого")).toBeNull();
  });

  it("keeps the shell on error with an inline alert", async () => {
    reportsService.listCancelledDishes.mockRejectedValue({ response: { data: { detail: "Backend down" } } });
    render(<CancelledDishesReportPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Backend down");
    expect(screen.getByRole("heading", { name: "Отчёт по отменённым блюдам" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("exports visible columns with full multi-filter metadata and no totals", async () => {
    reportsService.listCancelledDishes.mockResolvedValue({ data: [cancelledRow()] });
    render(<CancelledDishesReportPage />);
    await screen.findByText("Плов");
    await awaitFilterDirectory();
    fireEvent.click(headerFilterToggle());
    const authorBox = openCancelledFilter("Автор");
    fireEvent.click(within(authorBox).getByText("Официант Али"));
    fireEvent.click(within(authorBox).getByText("Кассир Вали"));
    const dishBox = openCancelledFilter("Блюда");
    fireEvent.click(within(dishBox).getByText("Плов"));
    fireEvent.click(within(dishBox).getByText("Лагман"));
    fireEvent.change(screen.getByLabelText("Номер заказа"), { target: { value: "ORD-42" } });
    fireEvent.click(panelApplyButton());
    await waitFor(() => expect(lastReportFilters().dishName).toEqual(["Плов", "Лагман"]));
    fireEvent.click(screen.getByRole("button", { name: "Скачать Excel" }));
    expect(exportToExcel).toHaveBeenCalledTimes(1);
    const [lines, columns, filename, options] = exportToExcel.mock.calls[0];
    expect(filename).toBe("cancelled-dishes-report");
    expect(columns.map((col) => col.label)).toEqual([
      "Номер заказа", "Дата", "Название", "Номер стола", "Кол-во",
      "Официант", "Тип", "Сумма", "Автор",
    ]);
    expect(lines).toHaveLength(1);
    const metadata = Object.fromEntries(options.metadata.map((item) => [item.label, item.value]));
    expect(metadata["Номер заказа"]).toBe("ORD-42");
    expect(metadata["Автор"]).toBe("Официант Али, Кассир Вали");
    expect(metadata["Блюда"]).toBe("Плов, Лагман");
    expect(JSON.stringify(options)).not.toContain("Итого");
  });

  it("exports headers plus metadata only when the result is empty", async () => {
    reportsService.listCancelledDishes.mockResolvedValue({ data: [] });
    render(<CancelledDishesReportPage />);
    await screen.findByText("Отменённых блюд нет");
    fireEvent.click(screen.getByRole("button", { name: "Скачать Excel" }));
    const [lines, columns, , options] = exportToExcel.mock.calls[0];
    expect(lines).toEqual([]);
    expect(columns).toHaveLength(9);
    expect(options.metadata.length).toBeGreaterThan(0);
    expect(JSON.stringify(options)).not.toContain("Итого");
  });

  it("keeps stale rows during refresh and lets the latest request win", async () => {
    const first = deferred();
    const second = deferred();
    reportsService.listCancelledDishes
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<CancelledDishesReportPage />);
    fireEvent.click(headerFilterToggle());
    fireEvent.change(screen.getByLabelText("Номер заказа"), { target: { value: "STALE" } });
    fireEvent.click(panelApplyButton());
    first.resolve({ data: [cancelledRow({ order_item_id: "stale", name: "Stale Plov" })] });
    second.resolve({ data: [cancelledRow({ order_item_id: "fresh", name: "Fresh Lagman" })] });
    expect(await screen.findByText("Fresh Lagman")).toBeInTheDocument();
    expect(screen.queryByText("Stale Plov")).toBeNull();
  });

  it("ignores a late response after unmount without crashing", async () => {
    const gate = deferred();
    reportsService.listCancelledDishes.mockReturnValue(gate.promise);
    const { unmount } = render(<CancelledDishesReportPage />);
    unmount();
    gate.resolve({ data: [cancelledRow()] });
    await Promise.resolve();
  });

  it("lazy-loads canonical order details only when the action opens", async () => {
    ordersService.get.mockResolvedValue({
      data: {
        items: [{ product_id: "p-1", name: "Плов", quantity: 2, price: 300, total: 600 }],
        subtotal: 600, discount_amount: 0, tax_amount: 72, service_fee: 0, total_amount: 672,
      },
    });
    reportsService.listCancelledDishes.mockResolvedValue({ data: [cancelledRow()] });
    render(<CancelledDishesReportPage />);
    const row = await screen.findByText("Плов").then((node) => node.closest("tr"));
    expect(ordersService.get).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole("button", { name: /Детали отмены/ }));
    await waitFor(() => expect(ordersService.get).toHaveBeenCalledWith("order-1", expect.anything()));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Отмена позиции")).toBeInTheDocument();
    expect(screen.getByText("672 UZS")).toBeInTheDocument();
    // Cached: reopening the same row issues no second request.
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    fireEvent.click(within(row).getByRole("button", { name: /Детали отмены/ }));
    await screen.findByRole("dialog");
    expect(ordersService.get).toHaveBeenCalledTimes(1);
  });

  it("shows an inline detail error without fake data", async () => {
    ordersService.get.mockRejectedValue(new Error("order unavailable"));
    reportsService.listCancelledDishes.mockResolvedValue({ data: [cancelledRow()] });
    render(<CancelledDishesReportPage />);
    const row = await screen.findByText("Плов").then((node) => node.closest("tr"));
    fireEvent.click(within(row).getByRole("button", { name: /Детали отмены/ }));
    expect(await screen.findByText("Не удалось загрузить детали заказа.")).toBeInTheDocument();
  });
});
