import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportsService } from "../api/reports";
import OrdersReportPage from "./OrdersReportPage";

vi.mock("../api/reports", () => ({
  reportsService: { listOrders: vi.fn(), getOrdersFilters: vi.fn() },
}));

vi.mock("../utils/excel", () => ({ exportToExcel: vi.fn() }));

const options = {
  waiters: [
    { value: "waiter-1", label: "Официант 1" },
    { value: "waiter-2", label: "Официант 2" },
  ],
  cashiers: [
    { value: "cashier-1", label: "Кассир 1" },
    { value: "cashier-2", label: "Кассир 2" },
  ],
  products: [
    { value: "product-1", label: "Плов" },
    { value: "product-2", label: "Лагман" },
  ],
  // The backend also offers `qr`, and calls dine_in "На месте" — the Orders report
  // curates that down to exactly three rows with the floor's own wording.
  order_types: [
    { value: "dine_in", label: "На месте" },
    { value: "takeaway", label: "На вынос" },
    { value: "delivery", label: "Доставка" },
    { value: "qr", label: "QR" },
  ],
  order_statuses: [
    { value: "completed", label: "Завершён" },
    { value: "ready", label: "Готов" },
  ],
  payment_methods: [
    { value: "cash", label: "Наличные" },
    { value: "card", label: "Карта" },
  ],
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
// Dropdowns have NO transactional footer — these are only asserted to be ABSENT.
function panelFooter() {
  return document.querySelector(".orders-filter-select__footer");
}
function openFilter(label) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const closingPanel = document.querySelector(".orders-filter-select__panel.is-closing, .report-date-menu.is-closing");
  if (closingPanel) fireEvent(closingPanel, new Event("webkitAnimationEnd", { bubbles: true }));
  return screen.getByRole("listbox", { name: label });
}
function check(label, optionName) {
  fireEvent.click(within(screen.getByRole("listbox", { name: label })).getByRole("option", { name: optionName }));
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

  it("closes an active dropdown when the filter section collapses", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());
    openFilter("Официант");

    fireEvent.click(toggleBtn());
    const closing = document.querySelector(".orders-filter-select__panel.is-closing");
    expect(closing).toHaveAttribute("inert");
    fireEvent(closing, new Event("webkitAnimationEnd", { bubbles: true }));
    fireEvent.click(toggleBtn());

    expect(screen.queryByRole("listbox", { name: "Официант" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Официант" })).toHaveAttribute("aria-expanded", "false");
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

  it("toggles update the trigger immediately; no footer; no request per checkbox", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());
    expect(reportsService.listOrders).toHaveBeenCalledTimes(1);

    const waiter = screen.getByRole("combobox", { name: "Официант" });
    openFilter("Официант");
    check("Официант", "Официант 1");
    // Z-report parity: the FIRST checkbox click already re-renders the trigger.
    expect(waiter).toHaveTextContent("Официант 1");
    check("Официант", "Официант 2");
    expect(waiter).toHaveTextContent("Официант 1, Официант 2");
    // Both stay checked — a second pick never replaces the first.
    const rows = within(screen.getByRole("listbox", { name: "Официант" })).getAllByRole("option");
    expect(rows.filter((r) => r.getAttribute("aria-selected") === "true")).toHaveLength(2);

    // No transactional footer inside the panel — «Выбрать»/«Отменить» are gone.
    expect(panelFooter()).toBeNull();
    expect(screen.queryByRole("button", { name: "Выбрать" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Отменить" })).toBeNull();

    // Toggling never issues a request; only the page-level «Фильтровать» does.
    expect(reportsService.listOrders).toHaveBeenCalledTimes(1);
    fireEvent.click(applyBtn());
    await waitFor(() => expect(reportsService.listOrders).toHaveBeenCalledTimes(2));
    expect(reportsService.listOrders.mock.calls[1][2].filters).toMatchObject({
      waiterId: ["waiter-1", "waiter-2"],
    });
  });

  it("keeps the report mounted while an applied filter request is pending", async () => {
    let resolveRequest;
    const pending = new Promise((resolve) => { resolveRequest = resolve; });
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());
    openFilter("Официант");
    check("Официант", "Официант 1");
    reportsService.listOrders.mockReturnValueOnce(pending);

    fireEvent.click(applyBtn());

    expect(screen.queryByText("Загрузка отчёта...")).toBeNull();
    expect(screen.getByRole("table", { name: "Отчёт по заказам" })).toBeInTheDocument();
    expect(document.querySelector(".orders-filter-select__panel.is-closing")).toBeInTheDocument();
    resolveRequest({ data: [] });
    await screen.findByText("Заказов не найдено");
  });

  it("issues a fresh request on every page-level Filter click", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());

    fireEvent.click(applyBtn());
    await waitFor(() => expect(reportsService.listOrders).toHaveBeenCalledTimes(2));
    fireEvent.click(applyBtn());
    await waitFor(() => expect(reportsService.listOrders).toHaveBeenCalledTimes(3));
  });

  it("supports multiple values in every dimension and sends them as lists", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());

    const picks = [
      ["Официант", ["Официант 1", "Официант 2"]],
      ["Кассир", ["Кассир 1", "Кассир 2"]],
      ["Блюда", ["Плов", "Лагман"]],
      ["Тип заказа", ["На стол", "Доставка"]],
      ["Статус заказа", ["Завершён", "Готов"]],
      ["Тип оплаты", ["Наличные", "Карта"]],
    ];
    for (const [label, names] of picks) {
      openFilter(label);
      names.forEach((name) => check(label, name));
      // immediate model: every dimension's trigger reflects its picks at once
      expect(screen.getByRole("combobox", { name: label })).toHaveTextContent(names.join(", "));
    }

    fireEvent.click(applyBtn());
    await waitFor(() => expect(reportsService.listOrders).toHaveBeenCalledTimes(2));
    expect(reportsService.listOrders.mock.calls[1][2].filters).toMatchObject({
      waiterId: ["waiter-1", "waiter-2"],
      cashierId: ["cashier-1", "cashier-2"],
      productId: ["product-1", "product-2"],
      orderType: ["dine_in", "delivery"],
      orderStatus: ["completed", "ready"],
      paymentMethod: ["cash", "card"],
    });
  });

  it("closing a panel (outside click, Escape, trigger) keeps the toggled selection", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());
    const waiter = screen.getByRole("combobox", { name: "Официант" });

    // outside click
    openFilter("Официант");
    check("Официант", "Официант 1");
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox", { name: "Официант" })).toBeNull();
    expect(waiter).toHaveTextContent("Официант 1");

    // Escape
    openFilter("Официант");
    check("Официант", "Официант 2");
    fireEvent.keyDown(waiter.closest(".orders-filter-select"), { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Официант" })).toBeNull();
    expect(waiter).toHaveTextContent("Официант 1, Официант 2");

    // a second trigger click toggles the row out, then closes with it unchecked
    openFilter("Официант");
    check("Официант", "Официант 2");
    fireEvent.click(waiter);
    expect(screen.queryByRole("listbox", { name: "Официант" })).toBeNull();
    expect(waiter).toHaveTextContent("Официант 1");

    // nothing above ever reached the network
    expect(reportsService.listOrders).toHaveBeenCalledTimes(1);
  });

  it("shows the placeholder only while nothing is selected, then a summary", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());
    const waiter = screen.getByRole("combobox", { name: "Официант" });
    expect(waiter).toHaveTextContent("Выберите официанта");
    expect(waiter).toHaveClass("is-placeholder", { exact: false });

    openFilter("Официант");
    check("Официант", "Официант 1");
    expect(waiter).toHaveTextContent("Официант 1");
    expect(waiter).not.toHaveTextContent("Выберите официанта");

    check("Официант", "Официант 2");
    // Two short labels still fit the field, so they stay joined.
    expect(waiter).toHaveTextContent("Официант 1, Официант 2");
  });

  it("never renders the placeholder as a selectable row inside a panel", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());
    const placeholders = {
      "Официант": "Выберите официанта",
      "Кассир": "Выберите кассира",
      "Блюда": "Выберите блюдо",
      "Тип заказа": "Выберите тип заказа",
      "Статус заказа": "Выберите статус заказа",
      "Тип оплаты": "Выберите тип оплаты",
    };
    for (const [label, placeholder] of Object.entries(placeholders)) {
      const box = openFilter(label);
      const rowTexts = within(box).getAllByRole("option").map((r) => r.textContent.trim());
      expect(rowTexts).not.toContain(placeholder);
      expect(rowTexts.some((t) => t.startsWith("Все "))).toBe(false);
      fireEvent.keyDown(screen.getByRole("combobox", { name: label }).closest(".orders-filter-select"), { key: "Escape" });
    }
  });

  it("offers exactly На стол / На вынос / Доставка for order type — no QR, no reset row", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());
    const box = openFilter("Тип заказа");
    expect(within(box).getAllByRole("option").map((r) => r.textContent.trim())).toEqual([
      "На стол", "На вынос", "Доставка",
    ]);
    expect(within(box).queryByText("QR")).toBeNull();
    expect(within(box).queryByText("На месте")).toBeNull();
  });

  it("keeps all three frozen order types when the options response omits them", async () => {
    reportsService.getOrdersFilters.mockResolvedValueOnce({
      data: { ...options, order_types: [] },
    });
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());

    const trigger = screen.getByRole("combobox", { name: "Тип заказа" });
    expect(trigger).not.toBeDisabled();
    const box = openFilter("Тип заказа");
    expect(within(box).getAllByRole("option").map((row) => row.textContent.trim())).toEqual([
      "На стол", "На вынос", "Доставка",
    ]);
  });

  it("keeps at most one filter panel open at a time", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());
    openFilter("Официант");
    expect(document.querySelectorAll(".orders-filter-select__panel")).toHaveLength(1);
    openFilter("Кассир");
    expect(document.querySelectorAll(".orders-filter-select__panel")).toHaveLength(1);
    expect(screen.queryByRole("listbox", { name: "Официант" })).toBeNull();
    expect(screen.getByRole("listbox", { name: "Кассир" })).toBeInTheDocument();
    openFilter("Тип оплаты");
    expect(document.querySelectorAll(".orders-filter-select__panel")).toHaveLength(1);
    expect(screen.queryByRole("listbox", { name: "Кассир" })).toBeNull();
  });

  it("waits for a filter exit before opening another filter or the period", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());

    openFilter("Официант");
    fireEvent.click(screen.getByRole("combobox", { name: "Кассир" }));
    const closingFilter = document.querySelector(".orders-filter-select__panel.is-closing");
    expect(closingFilter).toHaveAttribute("inert");
    expect(closingFilter).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("listbox", { name: "Кассир" })).toBeNull();
    fireEvent(closingFilter, new Event("webkitAnimationEnd", { bubbles: true }));
    expect(await screen.findByRole("listbox", { name: "Кассир" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Период отчёта по заказам" }));
    const closingCashier = document.querySelector(".orders-filter-select__panel.is-closing");
    expect(closingCashier).toHaveAttribute("inert");
    expect(document.querySelector(".report-date-menu")).toBeNull();
    fireEvent(closingCashier, new Event("webkitAnimationEnd", { bubbles: true }));
    expect(await document.querySelector(".report-date-menu")).toBeInTheDocument();
  });

  it("lets a second activation cancel a panel that is still pending", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());

    openFilter("Официант");
    const cashier = screen.getByRole("combobox", { name: "Кассир" });
    fireEvent.click(cashier);
    expect(document.querySelector(".orders-filter-select__panel.is-closing")).toBeInTheDocument();
    fireEvent.click(cashier);
    const closing = document.querySelector(".orders-filter-select__panel.is-closing");
    fireEvent(closing, new Event("webkitAnimationEnd", { bubbles: true }));

    expect(screen.queryByRole("listbox", { name: "Кассир" })).toBeNull();
    expect(document.querySelectorAll(".report-date-menu, .orders-filter-select__panel")).toHaveLength(0);
  });

  it("cancels a pending panel when the user clicks outside during exit", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());

    openFilter("Официант");
    fireEvent.click(screen.getByRole("combobox", { name: "Кассир" }));
    const closing = document.querySelector(".orders-filter-select__panel.is-closing");
    fireEvent.mouseDown(document.body);
    fireEvent(closing, new Event("webkitAnimationEnd", { bubbles: true }));

    expect(screen.queryByRole("listbox", { name: "Кассир" })).toBeNull();
    expect(document.querySelectorAll(".report-date-menu, .orders-filter-select__panel")).toHaveLength(0);
  });

  it("keeps the period as the only mounted panel until its exit completes", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());
    fireEvent.click(screen.getByRole("button", { name: "Период отчёта по заказам" }));
    expect(document.querySelector(".report-date-menu")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("combobox", { name: "Статус заказа" }).closest(".orders-filter-select"), { key: "Enter" });
    const closingPeriod = document.querySelector(".report-date-menu.is-closing");
    expect(closingPeriod).toHaveAttribute("inert");
    expect(screen.queryByRole("listbox", { name: "Статус заказа" })).toBeNull();
    fireEvent(closingPeriod, new Event("webkitAnimationEnd", { bubbles: true }));
    expect(await screen.findByRole("listbox", { name: "Статус заказа" })).toBeInTheDocument();
    expect(document.querySelectorAll(".report-date-menu, .orders-filter-select__panel")).toHaveLength(1);
  });

  it("summarises selections that exceed the trigger budget as first +N", async () => {
    reportsService.getOrdersFilters.mockResolvedValueOnce({
      data: {
        ...options,
        waiters: [
          { value: "waiter-1", label: "Алишер Абдуллаев" },
          { value: "waiter-2", label: "Эльёр Рахимов" },
          { value: "waiter-3", label: "Бехруз Каримов" },
        ],
      },
    });
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());
    openFilter("Официант");
    ["Алишер Абдуллаев", "Эльёр Рахимов", "Бехруз Каримов"].forEach((name) => check("Официант", name));
    expect(screen.getByRole("combobox", { name: "Официант" })).toHaveTextContent("Алишер Абдуллаев +2");
  });

  it("page-level «Очистить» resets every filter back to its placeholder", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());
    fireEvent.change(screen.getByLabelText("Номер заказа"), { target: { value: "42" } });
    for (const [label, name] of [["Официант", "Официант 1"], ["Статус заказа", "Готов"], ["Тип заказа", "Доставка"]]) {
      openFilter(label);
      check(label, name);
    }
    fireEvent.click(applyBtn());
    await waitFor(() => expect(reportsService.listOrders).toHaveBeenCalledTimes(2));

    fireEvent.click(clearBtn());
    await waitFor(() => expect(reportsService.listOrders).toHaveBeenCalledTimes(3));
    expect(reportsService.listOrders.mock.calls[2][2].filters).toMatchObject({
      orderNumber: "", waiterId: [], cashierId: [], productId: [],
      orderType: [], orderStatus: [], paymentMethod: [],
    });
    FILTER_LABELS.forEach((label) => {
      expect(screen.getByRole("combobox", { name: label }).textContent).toMatch(/^Выберите /);
    });
    expect(screen.getByLabelText("Номер заказа")).toHaveValue("");
  });

  it("toggled selection survives collapsing and reopening the filter section", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(toggleBtn());
    openFilter("Официант");
    check("Официант", "Официант 1");
    fireEvent.click(toggleBtn()); // collapse
    fireEvent.click(toggleBtn()); // reopen
    expect(screen.getByRole("combobox", { name: "Официант" })).toHaveTextContent("Официант 1");
    // still only the initial request — the draft never auto-applies
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
