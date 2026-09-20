import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportsService } from "../api/reports";
import { exportToExcel } from "../utils/excel";
import { formatDateLabel, shiftDate, todayInputValue } from "../utils/date";
import OrdersReportPage, { currentOrdersDateRange, formatPlace } from "./OrdersReportPage";

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
function finishPeriodExit() {
  const closing = document.querySelector(".report-date-menu.is-closing");
  if (closing) fireEvent(closing, new Event("webkitAnimationEnd", { bubbles: true }));
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
        order_id: "11111111-1111-4111-8111-111111111111", public_id: 10000000,
        order_number: "42", created_at: "2026-08-25T10:00:00Z",
        status: "completed", table_number: "7", hall_name: "Основной зал",
        waiter_name: "Официант 1",
        items_count: 2, total_amount: 100000, order_type: "dine_in",
        cashier_names: ["Кассир 1"], service_fee: 9300, payment_methods: ["cash"],
      }],
    });
    reportsService.getOrdersFilters.mockResolvedValue({ data: options });
  });

  // PLACEHOLDER_TESTS

  it("builds the initial Orders period from the local calendar day", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 8, 12, 0, 30));
      expect(currentOrdersDateRange()).toEqual({
        preset: "Сегодня",
        start: "12.09.2026",
        end: "12.09.2026",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens on Today and sends today/today in the initial request", async () => {
    const today = todayInputValue();
    const todayDisplay = formatDateLabel(today);
    render(<OrdersReportPage />);
    await screen.findByText("42");

    expect(screen.getByRole("button", { name: "Период отчёта по заказам" })).toHaveTextContent(todayDisplay);
    expect(reportsService.listOrders).toHaveBeenNthCalledWith(
      1,
      today,
      today,
      expect.objectContaining({
        filters: {
          orderNumber: "", waiterId: [], cashierId: [], productId: [],
          orderType: [], orderStatus: [], paymentMethod: [],
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Период отчёта по заказам" }));
    expect(screen.getByRole("button", { name: "Сегодня" })).toHaveClass("is-active");
  });

  it("keeps Yesterday, Today and an arbitrary manual range working", async () => {
    const today = todayInputValue();
    const yesterday = shiftDate(today, -1);
    const trigger = () => screen.getByRole("button", { name: "Период отчёта по заказам" });
    render(<OrdersReportPage />);
    await screen.findByText("42");

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Вчера" }));
    fireEvent.click(document.querySelector(".report-date-ok"));
    await waitFor(() => expect(reportsService.listOrders).toHaveBeenCalledTimes(2));
    expect(reportsService.listOrders.mock.calls[1].slice(0, 2)).toEqual([yesterday, yesterday]);
    finishPeriodExit();

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Сегодня" }));
    fireEvent.click(document.querySelector(".report-date-ok"));
    await waitFor(() => expect(reportsService.listOrders).toHaveBeenCalledTimes(3));
    expect(reportsService.listOrders.mock.calls[2].slice(0, 2)).toEqual([today, today]);
    finishPeriodExit();

    fireEvent.click(trigger());
    fireEvent.change(screen.getByLabelText("Начало периода"), { target: { value: "05.08.2026 | 00:00" } });
    fireEvent.change(screen.getByLabelText("Конец периода"), { target: { value: "07.08.2026 | 00:00" } });
    fireEvent.click(document.querySelector(".report-date-ok"));
    await waitFor(() => expect(reportsService.listOrders).toHaveBeenCalledTimes(4));
    expect(reportsService.listOrders.mock.calls[3].slice(0, 2)).toEqual(["2026-08-05", "2026-08-07"]);
  });

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

  it("shows every selected label without any count summary", async () => {
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
    expect(screen.getByRole("combobox", { name: "Официант" })).toHaveTextContent(
      "Алишер Абдуллаев, Эльёр Рахимов, Бехруз Каримов"
    );
    expect(screen.getByRole("combobox", { name: "Официант" }).textContent).not.toMatch(/\+\d/);
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
    const periodBeforeClear = reportsService.listOrders.mock.calls[1].slice(0, 2);
    expect(reportsService.listOrders.mock.calls[2].slice(0, 2)).toEqual(periodBeforeClear);
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

  it("renders '—' for null table/waiter/cashier instead of fabricating a value", async () => {
    reportsService.listOrders.mockResolvedValueOnce({
      data: [{
        order_id: "order-2", order_number: "77", created_at: "2026-08-26T09:00:00Z",
        status: "new", table_number: null, waiter_name: null, items_count: 1, total_amount: 5000,
        order_type: "takeaway", cashier_names: [], service_fee: 0, payment_methods: [],
      }],
    });
    render(<OrdersReportPage />);
    const row = (await screen.findByText("77")).closest("tr");
    const cells = row.querySelectorAll("td");
    expect(cells).toHaveLength(8);
    expect(cells[3]).toHaveTextContent("—");
    expect(cells[5]).toHaveTextContent("—");
    expect(cells[6]).toHaveTextContent("—");
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

  it("renders the shared universal illustration instead of the legacy icon", async () => {
    reportsService.listOrders.mockResolvedValueOnce({ data: [] });
    const { container } = render(<OrdersReportPage />);
    await screen.findByText("Заказов не найдено");
    const image = container.querySelector(".owner-report-empty-image");
    expect(image?.tagName).toBe("IMG");
    expect(image).toHaveAttribute("alt", "");
    expect(container.querySelector(".owner-report-empty__icon")).toBeNull();
  });

  // REPORTS-EXCEL-02 FINAL business structure: the visible UI carries
  // EXACTLY eight business columns in requested order. ID, service_fee and
  // payment_methods stay out of the visible table (Excel-only richness);
  // the row itself remains the clickable/keyboard details action.
  it("renders exactly the eight final business columns", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Номер заказа", "Тип", "Дата", "Место", "Цена всего", "Официант", "Кассир", "Статус",
    ]);
    expect(screen.queryByRole("columnheader", { name: "ID" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "ID заказа" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Количество позиций" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Цена обслуживания" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Тип оплаты" })).toBeNull();
    const row = screen.getByText("42").closest("tr");
    const cells = row.querySelectorAll("td");
    expect(cells).toHaveLength(8);
    expect(cells[0]).toHaveTextContent("42");
    expect(cells[1]).toHaveTextContent("На стол");
    expect(cells[3]).toHaveTextContent("7");
    expect(cells[4]).toHaveTextContent("UZS");
    expect(cells[5]).toHaveTextContent("Официант 1");
    expect(cells[6]).toHaveTextContent("Кассир 1");
    expect(cells[7]).toHaveTextContent("completed");
  });

  it("labels order_type via the existing map and falls back to raw values", async () => {
    reportsService.listOrders.mockResolvedValueOnce({
      data: [
        {
          order_id: "order-t1", order_number: "T1", created_at: "2026-08-25T10:00:00Z",
          status: "completed", table_number: "7", waiter_name: "Официант 1",
          items_count: 1, total_amount: 10000, order_type: "delivery",
          cashier_names: [], service_fee: 0, payment_methods: [],
        },
        {
          order_id: "order-t2", order_number: "T2", created_at: "2026-08-25T11:00:00Z",
          status: "completed", table_number: "7", waiter_name: "Официант 1",
          items_count: 1, total_amount: 10000, order_type: "qr_future_type",
          cashier_names: [], service_fee: 0, payment_methods: [],
        },
      ],
    });
    render(<OrdersReportPage />);
    expect((await screen.findByText("T1")).closest("tr").querySelectorAll("td")[1]).toHaveTextContent("Доставка");
    // Unknown future raw values stay visible — never hidden, never blank.
    expect((await screen.findByText("T2")).closest("tr").querySelectorAll("td")[1]).toHaveTextContent("qr_future_type");
  });

  it("shows every cashier and never substitutes the waiter", async () => {
    reportsService.listOrders.mockResolvedValueOnce({
      data: [{
        order_id: "order-c1", order_number: "C1", created_at: "2026-08-25T10:00:00Z",
        status: "completed", table_number: "7", waiter_name: "Официант 1",
        items_count: 1, total_amount: 10000, order_type: "dine_in",
        cashier_names: ["Яков", "Алишер"], service_fee: 0, payment_methods: [],
      }],
    });
    render(<OrdersReportPage />);
    const cells = (await screen.findByText("C1")).closest("tr").querySelectorAll("td");
    expect(cells[5]).toHaveTextContent("Официант 1");
    expect(cells[6]).toHaveTextContent("Яков, Алишер");
  });

  it("keeps row-click details working on internal order identity", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(screen.getByRole("button", { name: "Детали заказа 42" }));
    const drawer = await screen.findByRole("dialog", { name: "Детали заказа" });
    expect(drawer).toBeInTheDocument();
  });

  it("exports the final eleven Excel columns with typed money/date cells", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    fireEvent.click(screen.getByRole("button", { name: "Скачать Excel" }));
    expect(exportToExcel).toHaveBeenCalledTimes(1);
    const [rows, cols, filename, callOptions] = exportToExcel.mock.calls[0];
    expect(filename).toBe("orders-report");
    expect(cols.map((col) => col.label)).toEqual([
      "ID", "Номер заказа", "Дата", "Тип", "Место", "Официант", "Кассир",
      "Цена обслуживания", "Цена всего", "Тип оплаты", "Статус",
    ]);
    expect(cols.map((col) => col.key)).toEqual([
      "id", "orderNumber", "createdAt", "orderType", "place", "waiterName",
      "cashiers", "serviceFee", "totalAmount", "payments", "status",
    ]);
    expect(cols.find((col) => col.key === "serviceFee")).toMatchObject({ type: "number", format: "#,##0" });
    expect(cols.find((col) => col.key === "totalAmount")).toMatchObject({ type: "number", format: "#,##0" });
    expect(cols.find((col) => col.key === "createdAt")).toMatchObject({ type: "date", format: "dd.mm.yyyy hh:mm" });
    expect(cols.some((col) => /action|eye|itemsCount/i.test(col.key || ""))).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      // ID = canonical public_id (integer), NOT the UUID / a truncated UUID.
      id: 10000000,
      orderNumber: "42",
      orderType: "На стол",
      // Место = canonical hall_name + table_number via the shared formatter.
      place: "Основной зал, стол 7",
      waiterName: "Официант 1",
      cashiers: "Кассир 1",
      serviceFee: 9300,
      totalAmount: 100000,
      payments: "Наличные",
      status: "Завершён",
    });
    expect(rows[0].id).not.toBe("11111111-1111-4111-8111-111111111111"); // never the UUID
    expect(JSON.stringify(rows)).not.toContain("Детали заказа");
    // VISUAL FIX 01: the exported Orders workbook no longer carries a metadata
    // block. OLD: callOptions.metadata held a "Период" string. NEW approved
    // decision: no metadata is passed at all (sheet starts at the row-1 header).
    // Strengthened to assert the metadata option is genuinely absent.
    expect(callOptions.metadata).toBeUndefined();
  });

  it("preserves multiple cashiers and payment methods in Excel cells", async () => {
    reportsService.listOrders.mockResolvedValueOnce({
      data: [{
        order_id: "order-m1", public_id: 10000005, order_number: "M1",
        created_at: "2026-08-25T10:00:00Z",
        status: "ready", table_number: null, hall_name: null, waiter_name: null,
        items_count: 1, total_amount: 50000, order_type: "dine_in",
        cashier_names: ["Яков", "Алишер"], service_fee: 0, payment_methods: ["cash", "payme"],
      }],
    });
    render(<OrdersReportPage />);
    await screen.findByText("M1");
    fireEvent.click(screen.getByRole("button", { name: "Скачать Excel" }));
    const [rows] = exportToExcel.mock.calls[0];
    expect(rows[0]).toMatchObject({
      id: 10000005,
      cashiers: "Яков, Алишер",
      payments: "Наличные, Pay me",
      // Tableless order → hall_name + table_number both absent → "".
      place: "",
      waiterName: "",
      serviceFee: 0,
    });
  });

  // VISUAL FIX 01 reframes this test. OLD product expectation: applied filters
  // were echoed into the workbook's METADATA block, and unapplied drafts were
  // not. NEW approved decision: the workbook carries NO metadata block at all.
  // The underlying business truth is unchanged and still asserted here via the
  // authoritative observable — the REQUEST: applied filters build the exported
  // population (drive listOrders), while an unapplied draft does not. The
  // no-metadata guarantee is asserted in both the draft and applied states.
  it("builds the exported population from applied filters, not unapplied drafts (no metadata block)", async () => {
    render(<OrdersReportPage />);
    await screen.findByText("42");
    await waitFor(() => expect(reportsService.listOrders).toHaveBeenCalledTimes(1));
    fireEvent.click(toggleBtn());
    // Draft only: toggled but NOT applied via «Фильтровать».
    openFilter("Официант");
    check("Официант", "Официант 2");
    fireEvent.click(screen.getByRole("button", { name: "Скачать Excel" }));
    // Draft did not fire a new request (population unchanged)...
    expect(reportsService.listOrders).toHaveBeenCalledTimes(1);
    // ...and the workbook carries no metadata block.
    expect(exportToExcel.mock.calls[0][3].metadata).toBeUndefined();

    // Close the still-open draft panel before building the applied selection.
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Официант" }).closest(".orders-filter-select"), { key: "Escape" });
    const closingDraft = document.querySelector(".orders-filter-select__panel.is-closing");
    if (closingDraft) fireEvent(closingDraft, new Event("webkitAnimationEnd", { bubbles: true }));

    // Now apply: both waiters selected, plus cashier + payment + type + status.
    openFilter("Официант");
    check("Официант", "Официант 1");
    openFilter("Кассир");
    check("Кассир", "Кассир 1");
    check("Кассир", "Кассир 2");
    openFilter("Тип оплаты");
    check("Тип оплаты", "Наличные");
    check("Тип оплаты", "Карта");
    openFilter("Тип заказа");
    check("Тип заказа", "Доставка");
    openFilter("Статус заказа");
    check("Статус заказа", "Завершён");
    fireEvent.click(applyBtn());
    await waitFor(() => expect(reportsService.listOrders).toHaveBeenCalledTimes(2));

    // The applied filters (not the earlier draft) drive the request that BUILDS
    // the exported population — this is the business truth the metadata block
    // used to surface. Assert the request carried exactly the applied selection.
    const appliedCall = reportsService.listOrders.mock.calls[1];
    const appliedFilters = appliedCall[2].filters;
    expect(appliedFilters.waiterId).toEqual(["waiter-2", "waiter-1"]);
    expect(appliedFilters.cashierId).toEqual(["cashier-1", "cashier-2"]);
    expect(appliedFilters.paymentMethod).toEqual(["cash", "card"]);
    expect(appliedFilters.orderType).toEqual(["delivery"]);
    expect(appliedFilters.orderStatus).toEqual(["completed"]);
    // Untouched dimensions stay empty (never fabricated).
    expect(appliedFilters.orderNumber).toBe("");
    expect(appliedFilters.productId).toEqual([]);

    exportToExcel.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Скачать Excel" }));
    // Still no metadata block in the applied-filter export.
    expect(exportToExcel.mock.calls[0][3].metadata).toBeUndefined();
  });

  it("adds numeric totals over exactly the exported rows without double counting", async () => {
    reportsService.listOrders.mockResolvedValueOnce({
      data: [
        {
          order_id: "order-s1", order_number: "S1", created_at: "2026-08-25T10:00:00Z",
          status: "completed", table_number: "1", waiter_name: "Официант 1",
          items_count: 1, total_amount: 100000, order_type: "dine_in",
          cashier_names: ["Кассир 1"], service_fee: 9300, payment_methods: ["cash"],
        },
        {
          order_id: "order-s2", order_number: "S2", created_at: "2026-08-25T11:00:00Z",
          status: "completed", table_number: "2", waiter_name: "Официант 1",
          items_count: 1, total_amount: 80000, order_type: "takeaway",
          cashier_names: [], service_fee: 8400, payment_methods: ["card"],
        },
        {
          order_id: "order-s3", order_number: "S3", created_at: "2026-08-25T12:00:00Z",
          status: "completed", table_number: "3", waiter_name: "Официант 2",
          items_count: 2, total_amount: 120000, order_type: "delivery",
          cashier_names: ["Кассир 2"], service_fee: 11200, payment_methods: ["cash", "payme"],
        },
      ],
    });
    render(<OrdersReportPage />);
    await screen.findByText("S3");
    fireEvent.click(screen.getByRole("button", { name: "Скачать Excel" }));
    const [rows, , , callOptions] = exportToExcel.mock.calls[0];
    expect(rows).toHaveLength(3);
    expect(callOptions.totals).toMatchObject({
      label: "Итого:",
      values: { serviceFee: 9300 + 8400 + 11200, totalAmount: 100000 + 80000 + 120000 },
    });
    // Two separate metrics — service is already inside total, never re-added.
    expect(callOptions.totals.values.serviceFee).toBe(28900);
    expect(callOptions.totals.values.totalAmount).toBe(300000);
    expect(callOptions.totals.values.totalAmount).not.toBe(300000 + 28900);
  });
});


// ── ORDERS-FRONTEND-TRUTH-01: canonical ID / order_number / place mapping ────
describe("ORDERS-FRONTEND-TRUTH-01 canonical mapping", () => {
  const CONTRACT_ROW = {
    order_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", public_id: 10000000,
    order_number: "7", created_at: "2026-09-18T14:05:00Z", status: "completed",
    table_number: "12", hall_name: "Основной зал", waiter_name: "Алишер",
    items_count: 1, total_amount: 33000, order_type: "dine_in",
    cashier_names: ["Яков"], service_fee: 9300, payment_methods: ["cash"],
  };

  it("UI table shows public_id order number and hall+table place from backend truth", async () => {
    reportsService.listOrders.mockResolvedValue({ data: [CONTRACT_ROW] });
    reportsService.getOrdersFilters.mockResolvedValue({ data: options });
    render(<OrdersReportPage />);
    // Номер заказа cell = canonical order_number (7), never a row index.
    await screen.findByText("7");
    // Место cell = canonical hall_name + table_number (never live-Hall derived).
    expect(screen.getByText("Основной зал, стол 12")).toBeInTheDocument();
    // The raw UUID must not appear anywhere in the visible table.
    expect(screen.queryByText(CONTRACT_ROW.order_id)).toBeNull();
  });

  it("Excel export maps ID->public_id, Номер заказа->order_number, Место->hall+table", async () => {
    reportsService.listOrders.mockResolvedValue({ data: [CONTRACT_ROW] });
    reportsService.getOrdersFilters.mockResolvedValue({ data: options });
    render(<OrdersReportPage />);
    await screen.findByText("7");
    fireEvent.click(screen.getByRole("button", { name: "Скачать Excel" }));
    const [rows, cols] = exportToExcel.mock.calls[0];
    // ID column carries the integer public_id, not the UUID / a truncation of it.
    expect(rows[0].id).toBe(10000000);
    expect(rows[0].id).not.toBe(CONTRACT_ROW.order_id);
    expect(String(rows[0].id)).not.toBe(CONTRACT_ROW.order_id.slice(0, 8));
    // Номер заказа is the backend value verbatim (not derived from index/date/UUID).
    expect(rows[0].orderNumber).toBe("7");
    // Место = canonical hall_name + table_number via the shared formatter.
    expect(rows[0].place).toBe("Основной зал, стол 12");
    // The ID column label/key is preserved; place column keyed "place".
    expect(cols.find((c) => c.label === "ID").key).toBe("id");
    expect(cols.find((c) => c.label === "Место").key).toBe("place");
  });

  it("formatPlace composes canonical values and handles partial states", () => {
    expect(formatPlace("Основной зал", "12")).toBe("Основной зал, стол 12");
    expect(formatPlace("Терраса", null)).toBe("Терраса");   // hall only
    expect(formatPlace(null, "5")).toBe("стол 5");           // table only
    expect(formatPlace(null, null)).toBe("");                // neither → empty (UI adds "—")
    expect(formatPlace("", "")).toBe("");
  });
});
