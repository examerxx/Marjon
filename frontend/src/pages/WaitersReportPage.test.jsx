import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportsService } from "../api/reports";
import { exportToExcel } from "../utils/excel";
import { formatDateLabel, todayInputValue } from "../utils/date";
import WaitersReportPage, {
  createWaitersTodayRange,
  defaultWaiterFilters,
  normalizeServicePercent,
} from "./WaitersReportPage";

vi.mock("../api/reports", () => ({
  reportsService: { listWaiters: vi.fn(), getWaitersFilters: vi.fn() },
}));

vi.mock("../utils/excel", () => ({ exportToExcel: vi.fn() }));

const waiterOptions = [
  { value: "waiter-1", label: "Алишер" },
  { value: "waiter-2", label: "Эльёр" },
];

const report = {
  rows: [
    {
      waiter_id: "waiter-1", name: "Алишер", orders_count: 3,
      orders_total: "1000.00", takeaway_delivery_total: "300.00",
      service_total: "120.00", waiter_service_total: "10.00", dishes_count: "4.000",
      dishes: [{ product_id: "dish-1", name: "Плов", quantity: "3.000", amount: "750.00" }],
    },
    {
      waiter_id: "waiter-2", name: "Эльёр", orders_count: 1,
      orders_total: "500.00", takeaway_delivery_total: "0.00",
      service_total: "50.00", waiter_service_total: "5.00", dishes_count: "1.000",
      dishes: [{ product_id: "dish-2", name: "Чай", quantity: "1.000", amount: "500.00" }],
    },
  ],
  totals: {
    orders_count: 4, orders_total: "1500.00", takeaway_delivery_total: "300.00",
    service_total: "170.00", waiter_service_total: "15.00", dishes_count: "5.000",
  },
};

function openWaiter() {
  fireEvent.click(screen.getByRole("combobox", { name: "Официант" }));
}

function finishClosingPanel() {
  const panel = document.querySelector(".orders-filter-select__panel.is-closing, .report-date-menu.is-closing");
  if (panel) fireEvent(panel, new Event("webkitAnimationEnd", { bubbles: true }));
}

function lastRequestedFilters() {
  return reportsService.listWaiters.mock.calls.at(-1)?.[2]?.filters;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function renderLoaded() {
  render(<WaitersReportPage />);
  await screen.findByText("Алишер");
  await waitFor(() => expect(reportsService.listWaiters).toHaveBeenCalled());
}

describe("WaitersReportPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportsService.getWaitersFilters.mockResolvedValue({ data: { waiters: waiterOptions } });
    reportsService.listWaiters.mockResolvedValue({ data: report });
  });

  it("normalizes only integer service percentages from 0 to 100", () => {
    expect(normalizeServicePercent("12")).toEqual({ value: "12", error: "" });
    expect(normalizeServicePercent("0012")).toEqual({ value: "12", error: "" });
    expect(normalizeServicePercent("0")).toEqual({ value: "0", error: "" });
    expect(normalizeServicePercent("100")).toEqual({ value: "100", error: "" });
    expect(normalizeServicePercent("12.5").error).toMatch(/целое число/);
    expect(normalizeServicePercent("12,5").error).toMatch(/целое число/);
    expect(normalizeServicePercent("-1").error).toMatch(/целое число/);
    expect(normalizeServicePercent("101").error).toMatch(/от 0 до 100/);
  });

  it("opens on Today and renders the compact Zim Zim control order with OWNER visuals", async () => {
    render(<WaitersReportPage />);
    // No full-page loader: the shell mounts immediately while pending.
    expect(screen.getByRole("heading", { name: "Отчёт по официантам" })).toBeInTheDocument();
    expect(screen.queryByText("Загрузка отчёта...")).toBeNull();

    // Default state is real muted 0%: value "0" stored, initial DATA request
    // fires with explicit service_percent=0, rows come from the backend.
    await screen.findByText("Алишер");

    const today = todayInputValue();
    expect(createWaitersTodayRange()).toEqual({
      preset: "Сегодня", start: formatDateLabel(today), end: formatDateLabel(today),
    });
    expect(reportsService.listWaiters).toHaveBeenCalledWith(
      today,
      today,
      expect.objectContaining({ filters: defaultWaiterFilters }),
    );
    expect(screen.getByRole("heading", { name: "Отчёт по официантам" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Период отчёта по официантам" })).toBeInTheDocument();
    const percent = screen.getByRole("spinbutton", { name: "Процент обслуживания" });
    expect(percent).toHaveValue(0);
    expect(percent).toHaveAttribute("placeholder", "0");
    expect(percent.closest(".waiters-percent-stepper")).toHaveClass("is-empty");
    expect(screen.getByRole("spinbutton", { name: "Процент обслуживания" })).toHaveAttribute("step", "1");
    expect(screen.getByRole("combobox", { name: "Официант" })).toHaveTextContent("Выберите официанта");
    expect(screen.getByRole("button", { name: /Скачать Excel/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Фильтровать" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Очистить" })).toBeNull();
    expect(document.querySelector(".report-filter-panel")).toBeNull();

    const controls = [...document.querySelector(".waiters-report-actions").children];
    expect(controls[0]).toHaveClass("owner-reports__period");
    expect(controls[1]).toHaveClass("waiters-percent-control-wrap");
    expect(controls[2]).toHaveClass("orders-filter-select");
    expect(controls[3]).toHaveClass("owner-report-excel");
  });

  it("keeps the same Period DOM node through the 170ms exit lifecycle", async () => {
    await renderLoaded();
    const trigger = screen.getByRole("button", { name: "Период отчёта по официантам" });
    fireEvent.click(trigger);
    const openNode = document.querySelector(".report-date-menu");
    expect(openNode).toBeTruthy();

    fireEvent.click(trigger);
    const closingNode = document.querySelector(".report-date-menu.is-closing");
    expect(closingNode).toBe(openNode);
    expect(closingNode).toHaveAttribute("inert");
    expect(closingNode).toHaveAttribute("aria-hidden", "true");
    fireEvent(closingNode, new Event("webkitAnimationEnd", { bubbles: true }));
    expect(document.querySelector(".report-date-menu")).toBeNull();
  });

  it("uses a checkbox-free single-select waiter dropdown and applies selection immediately", async () => {
    await renderLoaded();
    expect(reportsService.listWaiters).toHaveBeenCalledTimes(1);
    openWaiter();
    const listbox = screen.getByRole("listbox", { name: "Официант" });
    expect(within(listbox).queryByRole("checkbox")).toBeNull();
    expect(within(listbox).queryByText("Все официанты")).toBeNull();
    expect(within(listbox).getAllByRole("option")).toHaveLength(waiterOptions.length);
    const openNode = document.querySelector(".orders-filter-select__panel");
    fireEvent.click(within(listbox).getByRole("option", { name: "Алишер" }));
    const closingNode = document.querySelector(".orders-filter-select__panel.is-closing");
    expect(closingNode).toBe(openNode);
    expect(closingNode).toHaveAttribute("inert");
    expect(closingNode).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("combobox", { name: "Официант" })).toHaveTextContent("Алишер");
    await waitFor(() => expect(reportsService.listWaiters).toHaveBeenCalledTimes(2));
    expect(lastRequestedFilters().waiterId).toBe("waiter-1");
    finishClosingPanel();

    openWaiter();
    expect(within(screen.getByRole("option", { name: "Алишер" })).getByText("✓")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Сбросить выбор официанта" }));
    await waitFor(() => expect(lastRequestedFilters().waiterId).toBe(""));
    expect(screen.getByRole("combobox", { name: "Официант" })).toHaveTextContent("Выберите официанта");
    finishClosingPanel();
  });

  it("replaces the selected waiter and preserves the current report controls", async () => {
    await renderLoaded();
    const percent = screen.getByRole("spinbutton", { name: "Процент обслуживания" });
    fireEvent.change(percent, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Сумма услуги" }));

    openWaiter();
    fireEvent.click(screen.getByRole("option", { name: "Алишер" }));
    await waitFor(() => expect(lastRequestedFilters().waiterId).toBe("waiter-1"));
    finishClosingPanel();

    openWaiter();
    fireEvent.click(screen.getByRole("option", { name: "Эльёр" }));
    await waitFor(() => expect(lastRequestedFilters()).toMatchObject({
      waiterId: "waiter-2",
      servicePercent: "12",
      includeOrders: true,
      includeTakeawayDelivery: false,
      includeService: true,
    }));
    expect(screen.getByRole("combobox", { name: "Официант" })).toHaveTextContent("Эльёр");
    const [dateFrom, dateTo] = reportsService.listWaiters.mock.calls.at(-1);
    expect(dateFrom).toBe(todayInputValue());
    expect(dateTo).toBe(todayInputValue());
  });

  it("shows backend loading, empty and error states inside the waiter dropdown", async () => {
    let resolveOptions;
    reportsService.getWaitersFilters.mockReturnValueOnce(new Promise((resolve) => { resolveOptions = resolve; }));
    const first = render(<WaitersReportPage />);
    await screen.findByText("Алишер");
    openWaiter();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Загрузка официантов");
    resolveOptions({ data: { waiters: [] } });
    expect(await screen.findByText("Официанты не найдены")).toBeInTheDocument();
    first.unmount();

    reportsService.getWaitersFilters.mockRejectedValueOnce(new Error("network"));
    render(<WaitersReportPage />);
    await screen.findByText("Алишер");
    openWaiter();
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить официантов");
  });

  it("closes the waiter panel on outside click and Escape using the same node", async () => {
    await renderLoaded();
    openWaiter();
    const outsideNode = document.querySelector(".orders-filter-select__panel");
    fireEvent.mouseDown(document.body);
    expect(document.querySelector(".orders-filter-select__panel.is-closing")).toBe(outsideNode);
    finishClosingPanel();

    openWaiter();
    const escapeNode = document.querySelector(".orders-filter-select__panel");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Официант" }), { key: "Escape" });
    expect(document.querySelector(".orders-filter-select__panel.is-closing")).toBe(escapeNode);
    finishClosingPanel();
  });

  it("changes service percent by one with keyboard arrows and clamps at the bounds", async () => {
    await renderLoaded();
    const percent = screen.getByRole("spinbutton", { name: "Процент обслуживания" });
    const suffix = document.querySelector(".waiters-percent-stepper__suffix");
    expect(suffix).toHaveTextContent("%");
    fireEvent.change(percent, { target: { value: "12" } });
    await waitFor(() => expect(lastRequestedFilters().servicePercent).toBe("12"));

    fireEvent.keyDown(percent, { key: "ArrowUp" });
    expect(percent).toHaveValue(13);
    await waitFor(() => expect(lastRequestedFilters().servicePercent).toBe("13"));

    fireEvent.keyDown(percent, { key: "ArrowDown" });
    expect(percent).toHaveValue(12);
    await waitFor(() => expect(lastRequestedFilters().servicePercent).toBe("12"));

    fireEvent.change(percent, { target: { value: "0" } });
    await waitFor(() => expect(lastRequestedFilters().servicePercent).toBe("0"));
    fireEvent.keyDown(percent, { key: "ArrowDown" });
    expect(percent).toHaveValue(0);
    fireEvent.change(percent, { target: { value: "100" } });
    await waitFor(() => expect(lastRequestedFilters().servicePercent).toBe("100"));
    fireEvent.keyDown(percent, { key: "ArrowUp" });
    expect(percent).toHaveValue(100);
  });

  it("keeps the custom arrows mounted while hover and focus reveal them through CSS", async () => {
    await renderLoaded();
    const stepper = document.querySelector(".waiters-percent-stepper");
    const controls = stepper.querySelector(".waiters-percent-stepper__controls");
    expect(controls).toBeTruthy();
    // Idle arrows carry no visible-state class: reveal is pure CSS opacity/visibility.
    expect(controls.classList.contains("is-visible")).toBe(false);
    const up = within(controls).getByRole("button", { name: "Увеличить процент обслуживания" });
    const down = within(controls).getByRole("button", { name: "Уменьшить процент обслуживания" });
    expect(up).toHaveClass("waiters-percent-stepper__up");
    expect(down).toHaveClass("waiters-percent-stepper__down");
    // The arrows stay in the DOM (no mount/unmount) when focus moves onto the input.
    const percent = screen.getByRole("spinbutton", { name: "Процент обслуживания" });
    fireEvent.mouseEnter(stepper);
    expect(document.querySelector(".waiters-percent-stepper__controls")).toBe(controls);
    percent.focus();
    expect(document.querySelector(".waiters-percent-stepper__controls")).toBe(controls);
    percent.blur();
    fireEvent.mouseLeave(stepper);
    expect(document.querySelector(".waiters-percent-stepper__controls")).toBe(controls);
  });

  it("keeps the percent field nodes and external geometry stable across repeated steps", async () => {
    await renderLoaded();
    const stepper = document.querySelector(".waiters-percent-stepper");
    const percent = screen.getByRole("spinbutton", { name: "Процент обслуживания" });
    const controls = stepper.querySelector(".waiters-percent-stepper__controls");
    const suffix = stepper.querySelector(".waiters-percent-stepper__suffix");
    const header = document.querySelector(".waiters-report-header");
    const table = document.querySelector(".owner-report-table");
    expect(stepper).toBeTruthy();
    expect(header).toBeTruthy();
    expect(table).toBeTruthy();
    const geometry = () => {
      const style = getComputedStyle(stepper);
      const rect = stepper.getBoundingClientRect();
      return {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        padding: style.padding, borderWidth: style.borderWidth, lineHeight: style.lineHeight,
      };
    };

    fireEvent.change(percent, { target: { value: "50" } });
    await waitFor(() => expect(lastRequestedFilters().servicePercent).toBe("50"));
    const initialGeometry = geometry();
    percent.focus();

    for (let index = 0; index < 10; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Увеличить процент обслуживания" }));
      expect(document.querySelector(".waiters-percent-stepper")).toBe(stepper);
      expect(screen.getByRole("spinbutton", { name: "Процент обслуживания" })).toBe(percent);
      expect(stepper.querySelector(".waiters-percent-stepper__controls")).toBe(controls);
      expect(stepper.querySelector(".waiters-percent-stepper__suffix")).toBe(suffix);
      expect(document.querySelector(".waiters-report-header")).toBe(header);
      expect(document.querySelector(".owner-report-table")).toBe(table);
      expect(geometry()).toEqual(initialGeometry);
    }
    expect(percent).toHaveValue(60);

    for (let index = 0; index < 10; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Уменьшить процент обслуживания" }));
      expect(document.querySelector(".waiters-percent-stepper")).toBe(stepper);
      expect(screen.getByRole("spinbutton", { name: "Процент обслуживания" })).toBe(percent);
      expect(stepper.querySelector(".waiters-percent-stepper__controls")).toBe(controls);
      expect(stepper.querySelector(".waiters-percent-stepper__suffix")).toBe(suffix);
      expect(document.querySelector(".waiters-report-header")).toBe(header);
      expect(document.querySelector(".owner-report-table")).toBe(table);
      expect(geometry()).toEqual(initialGeometry);
    }
    expect(percent).toHaveValue(50);
  });

  it("steps the service percent by exactly one per arrow click", async () => {
    await renderLoaded();
    const percent = screen.getByRole("spinbutton", { name: "Процент обслуживания" });
    const up = screen.getByRole("button", { name: "Увеличить процент обслуживания" });
    const down = screen.getByRole("button", { name: "Уменьшить процент обслуживания" });

    fireEvent.change(percent, { target: { value: "12" } });
    await waitFor(() => expect(lastRequestedFilters().servicePercent).toBe("12"));

    fireEvent.click(up);
    expect(percent).toHaveValue(13);
    await waitFor(() => expect(lastRequestedFilters().servicePercent).toBe("13"));

    fireEvent.click(down);
    expect(percent).toHaveValue(12);
    await waitFor(() => expect(lastRequestedFilters().servicePercent).toBe("12"));
  });

  it("does not repeat while an arrow is held and applies one step on the resulting click", async () => {
    await renderLoaded();
    const percent = screen.getByRole("spinbutton", { name: "Процент обслуживания" });
    const up = screen.getByRole("button", { name: "Увеличить процент обслуживания" });

    fireEvent.change(percent, { target: { value: "12" } });
    await waitFor(() => expect(lastRequestedFilters().servicePercent).toBe("12"));

    fireEvent.pointerDown(up);
    fireEvent.pointerDown(up);
    expect(percent).toHaveValue(12);
    fireEvent.pointerUp(up);
    fireEvent.click(up);
    expect(percent).toHaveValue(13);
    expect(lastRequestedFilters().servicePercent).toBe("13");
  });

  it("clamps the percent arrows at 0 and 100", async () => {
    await renderLoaded();
    const percent = screen.getByRole("spinbutton", { name: "Процент обслуживания" });
    const up = screen.getByRole("button", { name: "Увеличить процент обслуживания" });
    const down = screen.getByRole("button", { name: "Уменьшить процент обслуживания" });

    fireEvent.change(percent, { target: { value: "0" } });
    await waitFor(() => expect(lastRequestedFilters().servicePercent).toBe("0"));
    fireEvent.click(down);
    expect(percent).toHaveValue(0);

    fireEvent.change(percent, { target: { value: "100" } });
    await waitFor(() => expect(lastRequestedFilters().servicePercent).toBe("100"));
    fireEvent.click(up);
    expect(percent).toHaveValue(100);
  });

  it("prevents mouse-wheel changes on the focused percent field", async () => {
    await renderLoaded();
    const percent = screen.getByRole("spinbutton", { name: "Процент обслуживания" });
    fireEvent.change(percent, { target: { value: "12" } });
    await waitFor(() => expect(lastRequestedFilters().servicePercent).toBe("12"));
    const callCount = reportsService.listWaiters.mock.calls.length;
    percent.focus();
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120 });
    fireEvent(percent, wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(percent).toHaveValue(12);
    expect(reportsService.listWaiters).toHaveBeenCalledTimes(callCount);
  });

  it("shows an inline error for invalid typing and clears it on valid input", async () => {
    await renderLoaded();
    const percent = screen.getByRole("spinbutton", { name: "Процент обслуживания" });
    fireEvent.change(percent, { target: { value: "12.5" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("целое число");
    fireEvent.change(percent, { target: { value: "12" } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("commits the service percent on blur and Enter", async () => {
    await renderLoaded();
    const percent = screen.getByRole("spinbutton", { name: "Процент обслуживания" });

    // Leading zeroes are stripped immediately on input (never "0012").
    fireEvent.change(percent, { target: { value: "0012" } });
    expect(percent.value).toBe("12");
    fireEvent.blur(percent);
    expect(percent.value).toBe("12");

    fireEvent.change(percent, { target: { value: "0033" } });
    expect(percent.value).toBe("33");
    fireEvent.keyDown(percent, { key: "Enter" });
    expect(percent.value).toBe("33");

    fireEvent.change(percent, { target: { value: "12.9" } });
    fireEvent.blur(percent);
    expect(percent.value).toBe("12");

    fireEvent.change(percent, { target: { value: "-4" } });
    fireEvent.keyDown(percent, { key: "Enter" });
    expect(percent.value).toBe("0");

    fireEvent.change(percent, { target: { value: "140" } });
    fireEvent.blur(percent);
    expect(percent.value).toBe("100");

    // Clearing is transient while editing (no error); commit restores real 0.
    fireEvent.change(percent, { target: { value: "" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.blur(percent);
    expect(percent.value).toBe("0");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("blocks decimal and out-of-range percentages without sending them", async () => {
    await renderLoaded();
    const initialCalls = reportsService.listWaiters.mock.calls.length;
    const percent = screen.getByRole("spinbutton", { name: "Процент обслуживания" });
    fireEvent.change(percent, { target: { value: "12.5" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("целое число");
    expect(reportsService.listWaiters).toHaveBeenCalledTimes(initialCalls);

    fireEvent.change(percent, { target: { value: "101" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("от 0 до 100");
    expect(reportsService.listWaiters).toHaveBeenCalledTimes(initialCalls);
  });

  it("places the three calculation toggles in table headers and applies each immediately", async () => {
    await renderLoaded();
    const ordersHeader = screen.getByRole("columnheader", { name: /Сумма заказов/ });
    const takeawayHeader = screen.getByRole("columnheader", { name: /Самовывоз и доставка/ });
    const serviceHeader = screen.getByRole("columnheader", { name: /Сумма услуги/ });
    const orders = within(ordersHeader).getByRole("checkbox", { name: "Сумма заказов" });
    const takeaway = within(takeawayHeader).getByRole("checkbox", { name: "Самовывоз и доставка" });
    const service = within(serviceHeader).getByRole("checkbox", { name: "Сумма услуги" });
    expect(orders).toBeChecked();
    expect(takeaway).not.toBeChecked();
    expect(service).not.toBeChecked();
    expect(within(ordersHeader).getByText("✓")).toBeInTheDocument();
    expect(within(takeawayHeader).queryByText("✓")).toBeNull();
    expect(within(serviceHeader).queryByText("✓")).toBeNull();
    expect(document.querySelector(".waiters-service-settings")).toBeNull();

    fireEvent.click(takeaway);
    await waitFor(() => expect(lastRequestedFilters().includeTakeawayDelivery).toBe(true));
    fireEvent.click(service);
    await waitFor(() => expect(lastRequestedFilters().includeService).toBe(true));
    fireEvent.click(orders);
    await waitFor(() => expect(lastRequestedFilters().includeOrders).toBe(false));
  });

  it("renders six canonical columns, backend totals and the waiter dish drawer", async () => {
    await renderLoaded();
    ["Имя", "Сумма заказов", "Самовывоз и доставка", "Сумма услуги", "Обслуживание официанта", "Блюда"].forEach((name) => {
      expect(screen.getByRole("columnheader", { name: new RegExp(name) })).toBeInTheDocument();
    });
    const totalRow = screen.getByText("Всего").closest("tr");
    expect(totalRow).toHaveTextContent("1 500");
    expect(totalRow).toHaveTextContent("300");
    expect(totalRow).toHaveTextContent("170");
    expect(totalRow).toHaveTextContent("15");
    expect(totalRow).toHaveTextContent("5");

    fireEvent.click(screen.getByRole("button", { name: "Блюда официанта Алишер" }));
    const drawer = screen.getByRole("dialog", { name: "Блюда официанта Алишер" });
    expect(within(drawer).getByText("Плов")).toBeInTheDocument();
    expect(within(drawer).getByText("750 UZS")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("exports the current immediate report state, total row and metadata", async () => {
    await renderLoaded();
    openWaiter();
    fireEvent.click(within(screen.getByRole("listbox", { name: "Официант" })).getByRole("option", { name: "Алишер" }));
    finishClosingPanel();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Процент обслуживания" }), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Сумма услуги" }));
    await waitFor(() => expect(lastRequestedFilters()).toMatchObject({
      waiterId: "waiter-1", servicePercent: "12", includeOrders: true, includeService: true,
    }));
    fireEvent.click(screen.getByRole("button", { name: /Скачать Excel/ }));

    expect(exportToExcel).toHaveBeenCalledTimes(1);
    const [data, columns, filename, options] = exportToExcel.mock.calls[0];
    expect(data.at(-1)).toMatchObject({ name: "Всего", waiterServiceTotal: 15 });
    expect(columns.map((column) => column.label)).toEqual([
      "Имя", "Сумма заказов", "Самовывоз и доставка", "Сумма услуги", "Обслуживание официанта", "Блюда",
    ]);
    expect(filename).toBe("waiters-report");
    expect(options.metadata).toEqual(expect.arrayContaining([
      { label: "Официант", value: "Алишер" },
      { label: "Процент обслуживания", value: "12%" },
      { label: "База расчёта", value: "Сумма заказов, Сумма услуги" },
    ]));
  });

  it("keeps the report structure and a zero total row when waiter rows are empty", async () => {
    reportsService.listWaiters.mockResolvedValue({ data: { rows: [], totals: {
      orders_count: 0, orders_total: 0, takeaway_delivery_total: 0,
      service_total: 0, waiter_service_total: 0, dishes_count: 0,
    } } });
    render(<WaitersReportPage />);
    const totalRow = (await screen.findByText("Всего")).closest("tr");
    expect(totalRow).toHaveTextContent("0 UZS");
    expect(totalRow).toHaveTextContent("0");
    expect(screen.queryByText("Данных по официантам нет")).toBeNull();
    expect(screen.queryByText("Измените период или параметры фильтра.")).toBeNull();
  });

  it("keeps stale data and every report control mounted while a refresh is pending", async () => {
    const refresh = deferred();
    reportsService.listWaiters
      .mockResolvedValueOnce({ data: report })
      .mockReturnValueOnce(refresh.promise);
    await renderLoaded();
    const table = screen.getByRole("table", { name: "Отчёт по официантам" });
    const tableWrap = table.parentElement;
    const header = document.querySelector(".waiters-report-header");
    const percent = screen.getByRole("spinbutton", { name: "Процент обслуживания" });
    const waiter = screen.getByRole("combobox", { name: "Официант" });
    const excel = screen.getByRole("button", { name: /Скачать Excel/ });

    fireEvent.click(screen.getByRole("checkbox", { name: "Самовывоз и доставка" }));
    await waitFor(() => expect(reportsService.listWaiters).toHaveBeenCalledTimes(2));
    expect(tableWrap).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Обновление отчёта...")).toBeNull();
    expect(screen.getByText("Алишер")).toBeInTheDocument();
    expect(screen.getByText("Всего").closest("tr")).toHaveTextContent("1 500");
    expect(screen.getByRole("table", { name: "Отчёт по официантам" })).toBe(table);
    expect(document.querySelector(".waiters-report-header")).toBe(header);
    expect(screen.getByRole("spinbutton", { name: "Процент обслуживания" })).toBe(percent);
    expect(screen.getByRole("combobox", { name: "Официант" })).toBe(waiter);
    expect(screen.getByRole("button", { name: /Скачать Excel/ })).toBe(excel);

    const refreshedReport = {
      rows: [{ ...report.rows[0], name: "Алишер обновлён", orders_total: "1750.00" }],
      totals: { ...report.totals, orders_total: "1750.00" },
    };
    await act(async () => { refresh.resolve({ data: refreshedReport }); });
    await screen.findByText("Алишер обновлён");
    expect(tableWrap).toHaveAttribute("aria-busy", "false");
    expect(screen.getByText("Всего").closest("tr")).toHaveTextContent("1 750");
    expect(screen.getByRole("table", { name: "Отчёт по официантам" })).toBe(table);
    expect(document.querySelector(".waiters-report-header")).toBe(header);
    expect(screen.getByRole("spinbutton", { name: "Процент обслуживания" })).toBe(percent);
    expect(screen.getByRole("combobox", { name: "Официант" })).toBe(waiter);
    expect(screen.getByRole("button", { name: /Скачать Excel/ })).toBe(excel);
  });

  it("preserves the last successful report when a background refresh fails", async () => {
    const refresh = deferred();
    reportsService.listWaiters
      .mockResolvedValueOnce({ data: report })
      .mockReturnValueOnce(refresh.promise);
    await renderLoaded();
    const table = screen.getByRole("table", { name: "Отчёт по официантам" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Самовывоз и доставка" }));
    await waitFor(() => expect(reportsService.listWaiters).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Обновление отчёта...")).toBeNull();
    await act(async () => { refresh.reject(new Error("network")); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить");
    expect(screen.getByRole("table", { name: "Отчёт по официантам" })).toBe(table);
    expect(screen.getByText("Алишер")).toBeInTheDocument();
    expect(screen.getByText("Всего").closest("tr")).toHaveTextContent("1 500");
  });

  it("ignores an older response after a newer refresh has completed", async () => {
    const older = deferred();
    const newer = deferred();
    reportsService.listWaiters
      .mockResolvedValueOnce({ data: report })
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    await renderLoaded();
    const percent = screen.getByRole("spinbutton", { name: "Процент обслуживания" });

    fireEvent.change(percent, { target: { value: "12" } });
    await waitFor(() => expect(reportsService.listWaiters).toHaveBeenCalledTimes(2));
    fireEvent.change(percent, { target: { value: "13" } });
    await waitFor(() => expect(reportsService.listWaiters).toHaveBeenCalledTimes(3));

    const latestReport = {
      rows: [{ ...report.rows[0], name: "Новый ответ" }],
      totals: { ...report.totals, orders_total: "1300.00" },
    };
    await act(async () => { newer.resolve({ data: latestReport }); });
    await screen.findByText("Новый ответ");

    const staleReport = {
      rows: [{ ...report.rows[0], name: "Устаревший ответ" }],
      totals: { ...report.totals, orders_total: "1200.00" },
    };
    await act(async () => { older.resolve({ data: staleReport }); });
    await waitFor(() => expect(screen.getByText("Новый ответ")).toBeInTheDocument());
    expect(screen.queryByText("Устаревший ответ")).toBeNull();
    expect(screen.getByText("Всего").closest("tr")).toHaveTextContent("1 300");
  });
});
