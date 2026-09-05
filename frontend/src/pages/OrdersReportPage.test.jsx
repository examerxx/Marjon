import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportsService } from "../api/reports";
import OrdersReportPage from "./OrdersReportPage";

vi.mock("../api/reports", () => ({
  reportsService: { listOrders: vi.fn(), getOrdersFilters: vi.fn() },
}));

vi.mock("../components/ReportDateRangePicker", () => ({
  default: () => <button type="button">Период</button>,
}));

vi.mock("../utils/excel", () => ({ exportToExcel: vi.fn() }));

const options = {
  waiters: [{ value: "waiter-1", label: "Официант 1" }],
  cashiers: [{ value: "cashier-1", label: "Кассир 1" }],
  products: [{ value: "product-1", label: "Плов" }],
  order_types: [{ value: "dine_in", label: "На месте" }],
  order_statuses: [{ value: "completed", label: "Завершён" }],
  payment_methods: [{ value: "cash", label: "Наличные" }],
};

const FILTER_LABELS = ["Официант", "Кассир", "Блюда", "Тип заказа", "Статус заказа", "Тип оплаты"];

function collapse() {
  return document.querySelector(".orders-filter-collapse");
}
function collapseInner() {
  return document.querySelector(".orders-filter-collapse__inner");
}
// The top toggle and the inner Apply both read "Фильтровать"; select by class to
// stay unambiguous now that the panel is always mounted (collapse animation).
function toggleBtn() {
  return document.querySelector(".orders-filter-toggle");
}
function applyBtn() {
  return document.querySelector(".report-filter-apply");
}
function clearBtn() {
  return document.querySelector(".report-filter-clear");
}

describe("OrdersReportPage filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportsService.listOrders.mockResolvedValue({
      data: [{
        order_id: "order-1", order_number: "42", created_at: "2026-08-25T10:00:00Z",
        status: "completed", table_number: "7", waiter_name: "Официант 1",
        items_count: 2, total_amount: 100000,
      }],
    });
    reportsService.getOrdersFilters.mockResolvedValue({ data: options });
  });

  // PLACEHOLDER_TESTS

  it("panel expands/collapses via the toggle; closed panel is inert", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    expect(toggleBtn()).toHaveAttribute("aria-expanded", "false");
    expect(toggleBtn()).toHaveAttribute("aria-controls", "orders-report-filters");
    expect(collapse()).not.toHaveClass("is-open");
    expect(collapseInner()).toHaveAttribute("inert");

    fireEvent.click(toggleBtn());
    expect(toggleBtn()).toHaveAttribute("aria-expanded", "true");
    expect(collapse()).toHaveClass("is-open");
    expect(collapseInner()).not.toHaveAttribute("inert");

    fireEvent.click(toggleBtn());
    expect(toggleBtn()).toHaveAttribute("aria-expanded", "false");
    expect(collapse()).not.toHaveClass("is-open");
    expect(collapseInner()).toHaveAttribute("inert");
  });

  it("renders exactly six custom dropdowns + the order-number input (no native select)", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());
    expect(document.querySelectorAll(".orders-filter-panel select")).toHaveLength(0);
    FILTER_LABELS.forEach((label) => {
      expect(screen.getByRole("combobox", { name: label })).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Номер заказа")).toBeInTheDocument();
    ["Клиент", "Автор", "Курьер", "Повар", "Мин. сумма"].forEach((label) => {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    });
  });

  it("selecting a dropdown option updates the DRAFT only; Apply sends canonical ids; Clear resets", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());
    expect(reportsService.listOrders).toHaveBeenCalledTimes(1);

    const waiter = screen.getByRole("combobox", { name: "Официант" });
    fireEvent.click(waiter);
    const listbox = screen.getByRole("listbox", { name: "Официант" });
    fireEvent.click(within(listbox).getByRole("option", { name: "Официант 1" }));
    expect(waiter).toHaveTextContent("Официант 1");
    expect(screen.queryByRole("listbox", { name: "Официант" })).toBeNull();
    expect(reportsService.listOrders).toHaveBeenCalledTimes(1); // no premature apply

    const status = screen.getByRole("combobox", { name: "Статус заказа" });
    fireEvent.click(status);
    fireEvent.click(within(screen.getByRole("listbox", { name: "Статус заказа" })).getByRole("option", { name: "Завершён" }));
    expect(reportsService.listOrders).toHaveBeenCalledTimes(1);

    fireEvent.click(applyBtn());
    await waitFor(() => expect(reportsService.listOrders).toHaveBeenCalledTimes(2));
    const applied = reportsService.listOrders.mock.calls[1][2].filters;
    expect(applied).toMatchObject({ waiterId: "waiter-1", orderStatus: "completed" });

    fireEvent.click(clearBtn());
    await waitFor(() => expect(reportsService.listOrders).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("combobox", { name: "Официант" })).toHaveTextContent("Выберите официанта");
    expect(screen.getByRole("combobox", { name: "Статус заказа" })).toHaveTextContent("Выберите статус заказа");
  });

  it("dropdown closes on Escape and on outside click without changing the value", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());
    const waiter = screen.getByRole("combobox", { name: "Официант" });

    fireEvent.click(waiter);
    expect(screen.getByRole("listbox", { name: "Официант" })).toBeInTheDocument();
    fireEvent.keyDown(waiter.closest(".orders-filter-select"), { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Официант" })).toBeNull();
    expect(waiter).toHaveTextContent("Выберите официанта");

    fireEvent.click(waiter);
    expect(screen.getByRole("listbox", { name: "Официант" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox", { name: "Официант" })).toBeNull();
  });

  it("draft selection survives collapsing and reopening the panel", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());
    const waiter = screen.getByRole("combobox", { name: "Официант" });
    fireEvent.click(waiter);
    fireEvent.click(within(screen.getByRole("listbox", { name: "Официант" })).getByRole("option", { name: "Официант 1" }));
    fireEvent.click(toggleBtn()); // collapse
    fireEvent.click(toggleBtn()); // reopen
    expect(screen.getByRole("combobox", { name: "Официант" })).toHaveTextContent("Официант 1");
    expect(reportsService.listOrders).toHaveBeenCalledTimes(1);
  });

  it("renders real rows with truthful money and no fabricated data", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    expect(reportsService.listOrders).toHaveBeenCalledTimes(1);
    const row = screen.getByText("42").closest("tr");
    expect(row).toHaveTextContent("completed");
    const total = row.querySelector(".report-total-price");
    expect(total).toHaveTextContent("UZS");
    expect(total).not.toHaveTextContent("NaN");
    expect(screen.queryByText(/демо|demo/i)).not.toBeInTheDocument();
  });

  it("renders '—' for null table/waiter instead of fabricating a value", async () => {
    reportsService.listOrders.mockResolvedValueOnce({
      data: [{
        order_id: "order-2", order_number: "77", created_at: "2026-08-26T09:00:00Z",
        status: "new", table_number: null, waiter_name: null, items_count: 1, total_amount: 5000,
      }],
    });
    render(<OrdersReportPage />);
    const row = (await screen.findByText("77")).closest("tr");
    const cells = row.querySelectorAll("td");
    expect(cells[4]).toHaveTextContent("—");
    expect(cells[5]).toHaveTextContent("—");
  });

  it("details drawer opens by keyboard (Enter) and closes on Escape", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    const row = screen.getByRole("button", { name: "Детали заказа 42" });
    expect(row).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(row, { key: "Enter" });
    const drawer = await screen.findByRole("dialog", { name: "Детали заказа" });
    expect(drawer).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Детали заказа" })).toBeNull());
  });

  it("shows a truthful error alert (not empty) when the backend fails", async () => {
    reportsService.listOrders.mockRejectedValueOnce({ response: { data: { detail: "Отчёт недоступен" } } });
    render(<OrdersReportPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Отчёт недоступен");
    expect(screen.queryByText("Заказов не найдено")).toBeNull();
  });

  it("shows the truthful no-results state for an empty period", async () => {
    reportsService.listOrders.mockResolvedValueOnce({ data: [] });
    render(<OrdersReportPage />);
    expect(await screen.findByText("Заказов не найдено")).toBeInTheDocument();
  });
});
