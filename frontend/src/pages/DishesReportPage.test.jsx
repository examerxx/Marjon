import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportsService } from "../api/reports";
import { exportToExcel } from "../utils/excel";
import DishesReportPage from "./DishesReportPage";

vi.mock("../api/reports", () => ({
  reportsService: { listDishes: vi.fn(), getDishesFilters: vi.fn() },
}));

vi.mock("../components/ReportDateRangePicker", () => ({
  default: () => <button type="button">Период</button>,
}));

vi.mock("../utils/excel", () => ({ exportToExcel: vi.fn() }));

const FILTERS = {
  data: {
    authors: [
      { value: "author-1", label: "Официант 1" },
      { value: "cashier-1", label: "Кассир 1" },
    ],
    cooks: [],
    products: [
      { value: "product-1", label: "Плов" },
      { value: "product-2", label: "Лагман" },
    ],
    categories: [
      { value: "category-1", label: "Горячие блюда" },
      { value: "category-2", label: "Супы" },
    ],
    order_types: [
      { value: "dine_in", label: "На месте" },
      { value: "takeaway", label: "На вынос" },
      { value: "delivery", label: "Доставка" },
      { value: "qr", label: "QR" },
    ],
    order_statuses: [
      { value: "new", label: "Новый" },
      { value: "accepted", label: "Принят" },
      { value: "cooking", label: "Готовится" },
      { value: "ready", label: "Готов" },
      { value: "completed", label: "Завершён" },
    ],
    payment_methods: [
      { value: "cash", label: "Наличные" },
      { value: "card", label: "Карта" },
    ],
    cook_filter_supported: false,
  },
};

function rowsPayload() {
  return {
    data: {
      rows: [
        {
          product_id: "dish-1", name: "Плов", unit: "порц",
          quantity: "3.000", price: "17500.00", amount: "70000",
        },
      ],
      totals: { quantity: "999", amount: "888888" },
    },
  };
}

function lastListDishesFilters() {
  const calls = reportsService.listDishes.mock.calls;
  return calls[calls.length - 1][2].filters;
}

function headerFilterToggle() {
  // The header toggle and the panel Apply share the accessible name; the
  // collapse keeps both mounted, so select by the toggle's own class.
  return screen.getAllByRole("button", { name: "Фильтровать" }).find((button) => (
    button.classList.contains("dishes-filter-toggle")
  ));
}

function finishDropdownExit() {
  // Orders parity: opening another dropdown while one closes hands off only
  // after the exit animation; jsdom never runs it, so finish it manually.
  const closingPanel = document.querySelector(".orders-filter-select__panel.is-closing");
  if (closingPanel) fireEvent(closingPanel, new Event("webkitAnimationEnd", { bubbles: true }));
}

function openDishFilter(label) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  finishDropdownExit();
  return screen.getByRole("listbox", { name: label });
}

describe("DishesReportPage Phase 1 truthful core", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportsService.listDishes.mockResolvedValue(rowsPayload());
    reportsService.getDishesFilters.mockResolvedValue(FILTERS);
  });

  it("mounts the shell immediately with no visible loader while pending", async () => {
    let resolveFirst;
    reportsService.listDishes.mockReturnValueOnce(
      new Promise((resolve) => { resolveFirst = resolve; })
    );
    render(<DishesReportPage />);
    expect(screen.getByRole("heading", { name: "Отчёт по блюдам" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0);
    expect(screen.queryByText("Загрузка отчёта...")).toBeNull();
    expect(document.querySelector(".dashboard-empty")).toBeNull();
    expect(document.querySelector(".report-loading-row")).toBeNull();
    expect(screen.queryByText("1. Плов")).toBeNull();
    resolveFirst(rowsPayload());
    expect(await screen.findByText("1. Плов")).toBeInTheDocument();
  });

  it("renders backend rows, unit and weighted price unchanged", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    const section = screen.getByText("1. Плов").closest("section");
    expect(within(section).getByText("порц")).toBeInTheDocument();
    expect(within(section).getByText(/17\s*500 UZS/)).toBeInTheDocument();
    expect(within(section).getByText(/70\s*000 UZS/)).toBeInTheDocument();
  });

  it("renders backend-authoritative totals instead of local sums", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    // Backend totals (999 / 888888) deliberately differ from the row sums
    // (3 / 70000): the Итого row must show the backend values.
    const totalRow = document.querySelector(".dishes-report-page .report-total-row");
    expect(totalRow.textContent).toContain("Итого");
    expect(totalRow.textContent).toContain("999");
    expect(/888\s*888 UZS/.test(totalRow.textContent)).toBe(true);
  });

  it("shows no cost, profit or status columns", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    const headers = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Название", "Ед изм", "Кол-во", "Цена", "Сумма"]);
    expect(screen.queryByText("Себестоимость")).toBeNull();
    expect(screen.queryByText("Прибыль")).toBeNull();
    expect(document.querySelector(".report-status-badge")).toBeNull();
    expect(document.querySelector(".report-detail-row")).toBeNull();
  });

  it("shows an empty unit cell instead of a fake fallback when unit is missing", async () => {
    reportsService.listDishes.mockResolvedValue({
      data: {
        rows: [{
          product_id: "dish-9", name: "Суп", unit: null,
          quantity: "1.000", price: "5000.00", amount: "5000",
        }],
        totals: { quantity: "1", amount: "5000" },
      },
    });
    render(<DishesReportPage />);
    await screen.findByText("1. Суп");
    expect(screen.queryByText("Порция")).toBeNull();
    expect(screen.queryByText("Порция (пр)")).toBeNull();
  });

  it("shows the truthful empty state only after loaded zero data", async () => {
    reportsService.listDishes.mockResolvedValue({ data: { rows: [], totals: { quantity: "0", amount: "0" } } });
    render(<DishesReportPage />);
    expect(await screen.findByText("Блюд не найдено")).toBeInTheDocument();
    expect(document.querySelector(".report-loading-row")).toBeNull();
  });

  it("renders the shared universal illustration instead of the legacy icon", async () => {
    reportsService.listDishes.mockResolvedValue({ data: { rows: [], totals: { quantity: "0", amount: "0" } } });
    const { container } = render(<DishesReportPage />);
    await screen.findByText("Блюд не найдено");
    const image = container.querySelector(".owner-report-empty-image");
    expect(image?.tagName).toBe("IMG");
    expect(image).toHaveAttribute("alt", "");
    expect(container.querySelector(".owner-report-empty__icon")).toBeNull();
  });

  it("hides the visible totals row for successful zero-data", async () => {
    reportsService.listDishes.mockResolvedValue({ data: { rows: [], totals: { quantity: "0", amount: "0" } } });
    render(<DishesReportPage />);
    expect(await screen.findByText("Блюд не найдено")).toBeInTheDocument();
    expect(document.querySelector(".dishes-report-page .report-total-row")).toBeNull();
  });

  it("keeps the totals row when rows exist", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    expect(document.querySelector(".dishes-report-page .report-total-row")).not.toBeNull();
  });

  it("keeps stale rows while a refetch pends and lets the latest win", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");

    let resolveOld, resolveNew;
    reportsService.listDishes
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveNew = resolve; }));
    const search = screen.getByLabelText("Поиск по названию блюда");
    fireEvent.change(search, { target: { value: "п" } });
    document.querySelector(".report-filter-apply").click();
    fireEvent.change(search, { target: { value: "пл" } });
    document.querySelector(".report-filter-apply").click();
    await waitFor(() => expect(reportsService.listDishes.mock.calls.length).toBe(3));
    // Stale truthful rows stay mounted while both requests pend.
    expect(screen.getByText("1. Плов")).toBeInTheDocument();
    expect(document.querySelector(".dishes-report-page .dashboard-empty")).toBeNull();
    resolveNew({ data: { rows: [], totals: { quantity: "0", amount: "0" } } });
    expect(await screen.findByText("Блюд не найдено")).toBeInTheDocument();
    resolveOld({
      data: {
        rows: [{
          product_id: "dish-old", name: "Старое", unit: "порц",
          quantity: "9.000", price: "1.00", amount: "9",
        }],
        totals: { quantity: "9", amount: "9" },
      },
    });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(screen.queryByText("Старое")).toBeNull();
    expect(screen.getByText("Блюд не найдено")).toBeInTheDocument();
  });

  it("sends truthful filter params without any cook dimension", async () => {
    const user = userEvent.setup();
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");

    expect(screen.queryByLabelText("Повар")).toBeNull();
    expect(document.querySelector(".dishes-report-page select")).toBeNull();
    const toggle = headerFilterToggle();
    fireEvent.click(toggle);
    const search = screen.getByLabelText("Поиск по названию блюда");
    search.focus();
    await user.tab();
    fireEvent.change(search, { target: { value: "Плов" } });
    openDishFilter("Автор");
    fireEvent.click(screen.getByRole("option", { name: "Официант 1" }));
    openDishFilter("Статус заказа");
    fireEvent.click(screen.getByRole("option", { name: "Завершенный" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Фильтровать" })[1]);
    await waitFor(() => expect(lastListDishesFilters()).toMatchObject({
      query: "Плов", authorId: ["author-1"], orderStatus: ["completed"],
    }));
    const sent = lastListDishesFilters();
    expect("cookId" in sent).toBe(false);
    expect(Array.isArray(sent.authorId)).toBe(true);
    expect(Array.isArray(sent.orderStatus)).toBe(true);
    expect(screen.getByText("Поиск: Плов")).toBeInTheDocument();
    expect(screen.getByText("Автор: Официант 1")).toBeInTheDocument();
  });

  it("multi-selects authors with OR semantics and a compact trigger", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    fireEvent.click(headerFilterToggle());
    openDishFilter("Автор");
    fireEvent.click(screen.getByRole("option", { name: "Официант 1" }));
    // Panel stays open; both stay checked after the second click.
    expect(screen.getByRole("option", { name: "Официант 1" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("option", { name: "Кассир 1" }));
    expect(screen.getByRole("option", { name: "Официант 1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "Кассир 1" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector(".orders-filter-select__panel:not(.is-closing)")).not.toBeNull();
    const author = screen.getByRole("combobox", { name: "Автор" });
    expect(author).toHaveTextContent("Официант 1, Кассир 1");
    expect(author).not.toHaveClass("is-placeholder");
    fireEvent.click(screen.getAllByRole("button", { name: "Фильтровать" })[1]);
    await waitFor(() => expect(lastListDishesFilters()).toMatchObject({
      authorId: ["author-1", "cashier-1"],
    }));
    // Chip joins every selected label truthfully.
    expect(screen.getByText("Автор: Официант 1, Кассир 1")).toBeInTheDocument();
    // Unchecking one preserves the other.
    fireEvent.click(headerFilterToggle());
    openDishFilter("Автор");
    fireEvent.click(screen.getByRole("option", { name: "Официант 1" }));
    expect(screen.getByRole("option", { name: "Официант 1" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("option", { name: "Кассир 1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox", { name: "Автор" })).toHaveTextContent("Кассир 1");
  });

  it("multi-selects type, status, payment, category and product dimensions", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    fireEvent.click(headerFilterToggle());
    openDishFilter("Тип заказа");
    fireEvent.click(screen.getByRole("option", { name: "На стол" }));
    fireEvent.click(screen.getByRole("option", { name: "Доставка" }));
    openDishFilter("Статус заказа");
    fireEvent.click(screen.getByRole("option", { name: "Новый" }));
    fireEvent.click(screen.getByRole("option", { name: "Завершенный" }));
    openDishFilter("Тип оплаты");
    fireEvent.click(screen.getByRole("option", { name: "Наличные" }));
    fireEvent.click(screen.getByRole("option", { name: "Карта" }));
    openDishFilter("Категория");
    fireEvent.click(screen.getByRole("option", { name: "Горячие блюда" }));
    fireEvent.click(screen.getByRole("option", { name: "Супы" }));
    openDishFilter("Продукт");
    fireEvent.click(screen.getByRole("option", { name: "Плов" }));
    fireEvent.click(screen.getByRole("option", { name: "Лагман" }));
    expect(screen.getByRole("combobox", { name: "Тип заказа" })).toHaveTextContent("На стол, Доставка");
    expect(screen.getByRole("combobox", { name: "Продукт" })).toHaveTextContent("Плов, Лагман");
    expect(screen.getByRole("combobox", { name: "Статус заказа" })).toHaveTextContent("Новый, Завершенный");
    fireEvent.click(screen.getAllByRole("button", { name: "Фильтровать" })[1]);
    await waitFor(() => expect(lastListDishesFilters()).toMatchObject({
      orderType: ["dine_in", "delivery"],
      orderStatus: ["new", "completed"],
      paymentMethod: ["cash", "card"],
      categoryId: ["category-1", "category-2"],
      productId: ["product-1", "product-2"],
    }));
  });

  it("shows all three labels for a fully selected type filter", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    fireEvent.click(headerFilterToggle());
    openDishFilter("Тип заказа");
    fireEvent.click(screen.getByRole("option", { name: "На стол" }));
    fireEvent.click(screen.getByRole("option", { name: "Доставка" }));
    fireEvent.click(screen.getByRole("option", { name: "С собой" }));
    const trigger = screen.getByRole("combobox", { name: "Тип заказа" });
    expect(trigger).toHaveTextContent("На стол, Доставка, С собой");
    expect(trigger.textContent).not.toMatch(/\+\d/);
    expect(trigger.textContent).not.toContain("Выбрано");
  });

  it("exports every selected filter value in Excel metadata", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    fireEvent.click(headerFilterToggle());
    openDishFilter("Автор");
    fireEvent.click(screen.getByRole("option", { name: "Официант 1" }));
    fireEvent.click(screen.getByRole("option", { name: "Кассир 1" }));
    openDishFilter("Тип заказа");
    fireEvent.click(screen.getByRole("option", { name: "На стол" }));
    fireEvent.click(screen.getByRole("option", { name: "Доставка" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Фильтровать" })[1]);
    await screen.findByText("Автор: Официант 1, Кассир 1");
    document.querySelector(".report-excel-button").click();
    expect(exportToExcel).toHaveBeenCalledTimes(1);
    const [, , , options] = exportToExcel.mock.calls[0];
    expect(options.metadata.some(
      (item) => item.label === "Автор" && item.value === "Официант 1, Кассир 1"
    )).toBe(true);
    expect(options.metadata.some(
      (item) => item.label === "Тип заказа" && item.value === "На стол, Доставка"
    )).toBe(true);
  });

  it("Очистить resets every multi-select to placeholders with no params sent", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    fireEvent.click(headerFilterToggle());
    openDishFilter("Автор");
    fireEvent.click(screen.getByRole("option", { name: "Официант 1" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Фильтровать" })[1]);
    await screen.findByText("Автор: Официант 1");
    fireEvent.click(screen.getByRole("button", { name: "Очистить" }));
    expect(screen.getByRole("combobox", { name: "Автор" })).toHaveTextContent("Выберите автора");
    expect(screen.getByRole("combobox", { name: "Автор" })).toHaveClass("is-placeholder");
    await waitFor(() => expect(lastListDishesFilters()).toMatchObject({
      query: "", authorId: [], productId: [], orderType: [], orderStatus: [],
      categoryId: [], paymentMethod: [],
    }));
  });

  it("opens on today and sends today/today in the initial request", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(reportsService.listDishes).toHaveBeenNthCalledWith(
      1, today, today, expect.anything()
    );
  });

  it("shows the author placeholder in muted Orders style until selected", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    fireEvent.click(headerFilterToggle());
    const author = screen.getByRole("combobox", { name: "Автор" });
    expect(author).toHaveTextContent("Выберите автора");
    expect(author).toHaveClass("is-placeholder");
    fireEvent.click(author);
    fireEvent.click(screen.getByRole("option", { name: "Официант 1" }));
    expect(author).toHaveTextContent("Официант 1");
    expect(author).not.toHaveClass("is-placeholder");
  });

  it("offers exactly the requested order type subset without qr", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    fireEvent.click(headerFilterToggle());
    openDishFilter("Тип заказа");
    expect(screen.getByRole("option", { name: "На стол" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Доставка" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "С собой" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "QR" })).toBeNull();
    expect(screen.queryByRole("option", { name: "На месте" })).toBeNull();
    expect(screen.queryByRole("option", { name: "На вынос" })).toBeNull();
  });

  it("offers exactly the requested order status subset", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    fireEvent.click(headerFilterToggle());
    openDishFilter("Статус заказа");
    expect(screen.getByRole("option", { name: "Новый" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Завершенный" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Принят" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Готовится" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Готов" })).toBeNull();
  });

  it("offers backend cashier authors without local injection and sends list params", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    fireEvent.click(headerFilterToggle());
    openDishFilter("Автор");
    fireEvent.click(screen.getByRole("option", { name: "Кассир 1" }));
    expect(screen.getByRole("combobox", { name: "Автор" })).toHaveTextContent("Кассир 1");
    fireEvent.click(screen.getAllByRole("button", { name: "Фильтровать" })[1]);
    await waitFor(() => expect(lastListDishesFilters()).toMatchObject({ authorId: ["cashier-1"] }));
    expect(Array.isArray(lastListDishesFilters().authorId)).toBe(true);
  });

  it("keeps the dropdown exit animation mounted instead of vanishing instantly", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    fireEvent.click(headerFilterToggle());
    openDishFilter("Автор");
    expect(document.querySelector(".orders-filter-select__panel:not(.is-closing)")).not.toBeNull();
    fireEvent.keyDown(document.querySelector(".dishes-filter-panel .orders-filter-select"), { key: "Escape" });
    const closing = document.querySelector(".orders-filter-select__panel.is-closing");
    expect(closing).not.toBeNull();
  });

  it("keeps at most one dropdown panel open at a time", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    fireEvent.click(headerFilterToggle());
    openDishFilter("Автор");
    openDishFilter("Тип заказа");
    expect(document.querySelectorAll(".orders-filter-select__panel:not(.is-closing)")).toHaveLength(1);
    expect(screen.getByRole("combobox", { name: "Тип заказа" })).toHaveAttribute("aria-expanded", "true");
  });

  it("exports visible columns with backend totals and active filter metadata", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");

    const toggle = headerFilterToggle();
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText("Поиск по названию блюда"), { target: { value: "Плов" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Фильтровать" })[1]);
    await screen.findByText("Поиск: Плов");

    document.querySelector(".report-excel-button").click();
    expect(exportToExcel).toHaveBeenCalledTimes(1);
    const [rows, cols, filename, options] = exportToExcel.mock.calls[0];
    expect(cols.map((col) => col.key)).toEqual(["name", "unit", "quantity", "price", "amount"]);
    expect(filename).toBe("dishes-report");
    // Data row uses the amount key (never an empty "total" column)...
    expect(rows[0].amount).toContain("70");
    // ...followed by the backend-totals row, never cost/profit.
    const totalRow = rows[rows.length - 1];
    expect(totalRow.name).toBe("Итого");
    expect(JSON.stringify(rows)).not.toContain("Себестоимость");
    expect(options.metadata.some((item) => item.label === "Период")).toBe(true);
    expect(options.metadata.some((item) => item.label === "Поиск" && item.value === "Плов")).toBe(true);
  });

  it("keeps the real filters in an accessible toggle panel without resetting draft values", async () => {
    const user = userEvent.setup();
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");

    const toggle = headerFilterToggle();
    const panel = document.getElementById("dishes-report-filters");
    const collapse = document.querySelector(".dishes-report-page .orders-filter-collapse");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "dishes-report-filters");
    expect(collapse).not.toHaveClass("is-open");
    expect(screen.getByRole("button", { name: "Скачать Excel" }).querySelector("svg")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(collapse).toHaveClass("is-open");

    const search = screen.getByLabelText("Поиск по названию блюда");
    const author = screen.getByRole("combobox", { name: "Автор" });
    const status = screen.getByRole("combobox", { name: "Статус заказа" });
    expect(screen.getByRole("combobox", { name: "Продукт" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Тип заказа" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Категория" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Тип оплаты" })).toBeInTheDocument();
    expect(document.querySelectorAll(".dishes-filter-panel select")).toHaveLength(0);
    expect(Array.from(panel.children).map((element) => (
      element.matches(".report-filter-buttons")
        ? "Действия"
        : element.querySelector("input, button")?.getAttribute("aria-label")
    ))).toEqual([
      "Поиск по названию блюда",
      "Автор",
      "Категория",
      "Продукт",
      "Тип заказа",
      "Статус заказа",
      "Тип оплаты",
      "Действия",
    ]);
    await waitFor(() => expect(author).toBeEnabled());
    search.focus();
    await user.tab();
    expect(author).toHaveFocus();
    fireEvent.change(search, { target: { value: "Плов" } });
    fireEvent.click(author);
    fireEvent.click(screen.getByRole("option", { name: "Официант 1" }));
    fireEvent.click(status);
    finishDropdownExit();
    fireEvent.click(screen.getByRole("option", { name: "Завершенный" }));

    fireEvent.click(toggle);
    expect(collapse).not.toHaveClass("is-open");
    fireEvent.click(toggle);
    expect(search).toHaveValue("Плов");
  });
});

describe("DishesReportPage zero-downtime bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportsService.getDishesFilters.mockResolvedValue(FILTERS);
  });

  function legacyPayload() {
    return {
      data: [
        {
          product_id: "dish-1", name: "Плов", unit: "порц",
          quantity: 2, price: 45000, amount: 90000,
        },
        {
          product_id: "dish-2", name: "Лагман", unit: "порц",
          quantity: 3, price: 38000, amount: 114000,
        },
      ],
    };
  }

  function canonicalPayload() {
    return {
      data: {
        rows: [
          {
            product_id: "dish-1", name: "Плов", unit: "порц",
            quantity: 2, price: 45000, amount: 90000,
          },
        ],
        totals: { quantity: 99, amount: 999999 },
      },
    };
  }

  it("CASE B: canonical object keeps backend totals authoritative (not recomputed)", async () => {
    reportsService.listDishes.mockResolvedValue(canonicalPayload());
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    const totalRow = document.querySelector(".dishes-report-page .report-total-row");
    const cells = totalRow.querySelectorAll("td");
    expect(cells[2].textContent).toBe("99");
    expect(/999\s*999 UZS/.test(cells[4].textContent)).toBe(true);
    // Rows sum would be 2 / 90000 — backend values must win.
    expect(totalRow.textContent).not.toContain("1. Плов");
  });

  it("CASE A: legacy array renders rows with transitional totals 5 / 204000", async () => {
    reportsService.listDishes.mockResolvedValue(legacyPayload());
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    expect(screen.getByText("2. Лагман")).toBeInTheDocument();
    const totalRow = document.querySelector(".dishes-report-page .report-total-row");
    expect(totalRow.textContent).toContain("Итого");
    const cells = totalRow.querySelectorAll("td");
    expect(cells[2].textContent).toBe("5");
    expect(/204\s*000 UZS/.test(cells[4].textContent)).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores legacy fake cost/profit/status fields", async () => {
    reportsService.listDishes.mockResolvedValue({
      data: [{
        product_id: "dish-1", name: "Плов", unit: "порц",
        quantity: 2, price: 45000, amount: 90000,
        cost: 0, profit: 90000, status: "Завершено",
        details: [{ id: 1 }], cook: "Повар 1",
      }],
    });
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    const headers = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Название", "Ед изм", "Кол-во", "Цена", "Сумма"]);
    expect(screen.queryByText("Себестоимость")).toBeNull();
    expect(screen.queryByText("Прибыль")).toBeNull();
    expect(screen.queryByText("Завершено")).toBeNull();
    expect(document.querySelector(".report-status-badge")).toBeNull();
    expect(document.querySelector(".report-detail-row")).toBeNull();
  });

  it("accepts legacy empty [] as valid zero-data without a visible totals row", async () => {
    reportsService.listDishes.mockResolvedValue({ data: [] });
    render(<DishesReportPage />);
    expect(await screen.findByText("Блюд не найдено")).toBeInTheDocument();
    expect(document.querySelector(".dishes-report-page .report-total-row")).toBeNull();
  });

  it("accepts canonical empty object as valid zero-data without a visible totals row", async () => {
    reportsService.listDishes.mockResolvedValue({ data: { rows: [], totals: { quantity: 0, amount: 0 } } });
    render(<DishesReportPage />);
    expect(await screen.findByText("Блюд не найдено")).toBeInTheDocument();
    expect(document.querySelector(".report-loading-row")).toBeNull();
    expect(document.querySelector(".dishes-report-page .report-total-row")).toBeNull();
  });

  it.each([
    ["empty object", {}],
    ["rows null", { rows: null }],
    ["rows without totals", { rows: [] }],
    ["totals without rows", { totals: {} }],
    ["empty totals", { rows: [], totals: {} }],
    ["null totals", { rows: [], totals: null }],
    ["null", null],
    ["undefined", undefined],
    ["string", "broken"],
    ["number", 123],
    ["unexpected items shape", { items: [] }],
  ])("malformed %s becomes error, not fake zero-data", async (_label, payload) => {
    reportsService.listDishes.mockResolvedValue({ data: payload });
    render(<DishesReportPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert").textContent).toContain("Не удалось загрузить отчёт по блюдам.");
    expect(screen.queryByText("Блюд не найдено")).toBeNull();
  });

  it("keeps legacy unit truth without hardcoded fallback", async () => {
    reportsService.listDishes.mockResolvedValue({
      data: [{ product_id: "dish-1", name: "Плов", unit: "порц", quantity: 2, price: 45000, amount: 90000 }],
    });
    const first = render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    expect(screen.getByText("порц")).toBeInTheDocument();
    first.unmount();

    reportsService.listDishes.mockResolvedValue({
      data: [{ product_id: "dish-9", name: "Суп", unit: null, quantity: 1, price: 5000, amount: 5000 }],
    });
    render(<DishesReportPage />);
    await screen.findByText("1. Суп");
    expect(screen.queryByText("Порция")).toBeNull();
    expect(screen.queryByText("Порция (пр)")).toBeNull();
    expect(screen.queryByText("шт.")).toBeNull();
  });

  it("exports legacy transitional totals with truthful columns only", async () => {
    reportsService.listDishes.mockResolvedValue(legacyPayload());
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    document.querySelector(".report-excel-button").click();
    expect(exportToExcel).toHaveBeenCalledTimes(1);
    const [rows, cols] = exportToExcel.mock.calls[0];
    expect(cols.map((col) => col.key)).toEqual(["name", "unit", "quantity", "price", "amount"]);
    const totalRow = rows[rows.length - 1];
    expect(totalRow.name).toBe("Итого");
    expect(totalRow.quantity).toBe("5");
    expect(totalRow.amount).toContain("204");
    expect(JSON.stringify(rows)).not.toContain("Себестоимость");
  });

  it("exports canonical backend totals with truthful columns only", async () => {
    reportsService.listDishes.mockResolvedValue(canonicalPayload());
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");
    document.querySelector(".report-excel-button").click();
    expect(exportToExcel).toHaveBeenCalledTimes(1);
    const [rows, cols] = exportToExcel.mock.calls[0];
    expect(cols.map((col) => col.key)).toEqual(["name", "unit", "quantity", "price", "amount"]);
    const totalRow = rows[rows.length - 1];
    expect(totalRow.name).toBe("Итого");
    expect(totalRow.quantity).toBe("99");
    expect(totalRow.amount).toContain("999");
  });

  it("keeps stale legacy rows while a refetch pends", async () => {
    reportsService.listDishes.mockResolvedValue(legacyPayload());
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");

    let resolveNext;
    reportsService.listDishes.mockReturnValueOnce(
      new Promise((resolve) => { resolveNext = resolve; })
    );
    fireEvent.change(screen.getByLabelText("Поиск по названию блюда"), { target: { value: "Плов" } });
    document.querySelector(".report-filter-apply").click();
    await waitFor(() => expect(reportsService.listDishes.mock.calls.length).toBe(2));
    expect(screen.getByText("1. Плов")).toBeInTheDocument();
    expect(screen.getByText("2. Лагман")).toBeInTheDocument();
    resolveNext(canonicalPayload());
    expect(await screen.findByText("1. Плов")).toBeInTheDocument();
  });

  it("latest request wins across mixed shapes (stale array cannot overwrite newer object)", async () => {
    reportsService.listDishes.mockResolvedValue(canonicalPayload());
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");

    let resolveOld, resolveNew;
    reportsService.listDishes
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveNew = resolve; }));
    const search = screen.getByLabelText("Поиск по названию блюда");
    fireEvent.change(search, { target: { value: "п" } });
    document.querySelector(".report-filter-apply").click();
    fireEvent.change(search, { target: { value: "пл" } });
    document.querySelector(".report-filter-apply").click();
    await waitFor(() => expect(reportsService.listDishes.mock.calls.length).toBe(3));
    resolveNew({
      data: {
        rows: [{ product_id: "dish-new", name: "Новое", unit: "порц", quantity: 1, price: 1000, amount: 1000 }],
        totals: { quantity: 1, amount: 1000 },
      },
    });
    expect(await screen.findByText("1. Новое")).toBeInTheDocument();
    resolveOld({
      data: [{ product_id: "dish-old", name: "Старое", unit: "порц", quantity: 9, price: 1, amount: 9 }],
    });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(screen.queryByText("Старое")).toBeNull();
    expect(screen.getByText("1. Новое")).toBeInTheDocument();
  });
});
