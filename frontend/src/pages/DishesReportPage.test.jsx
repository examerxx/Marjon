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
    authors: [{ value: "author-1", label: "Официант 1" }],
    cooks: [],
    products: [{ value: "product-1", label: "Плов" }],
    categories: [{ value: "category-1", label: "Горячие блюда" }],
    order_types: [{ value: "dine_in", label: "На месте" }],
    order_statuses: [{ value: "completed", label: "Завершён" }],
    payment_methods: [{ value: "cash", label: "Наличные" }],
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
    const toggle = screen.getByRole("button", { name: "Фильтровать" });
    fireEvent.click(toggle);
    const search = screen.getByLabelText("Поиск по названию блюда");
    search.focus();
    await user.tab();
    fireEvent.change(search, { target: { value: "Плов" } });
    fireEvent.change(screen.getByLabelText("Официант"), { target: { value: "author-1" } });
    fireEvent.change(screen.getByLabelText("Статус заказа"), { target: { value: "completed" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Фильтровать" })[1]);
    await waitFor(() => expect(lastListDishesFilters()).toMatchObject({
      query: "Плов", authorId: "author-1", orderStatus: "completed",
    }));
    const sent = lastListDishesFilters();
    expect("cookId" in sent).toBe(false);
    expect(screen.getByText("Поиск: Плов")).toBeInTheDocument();
    expect(screen.getByText("Официант: Официант 1")).toBeInTheDocument();
  });

  it("exports visible columns with backend totals and active filter metadata", async () => {
    render(<DishesReportPage />);
    await screen.findByText("1. Плов");

    const toggle = screen.getByRole("button", { name: "Фильтровать" });
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

    const toggle = screen.getByRole("button", { name: "Фильтровать" });
    const panel = document.getElementById("dishes-report-filters");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "dishes-report-filters");
    expect(panel).toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: "Скачать Excel" }).querySelector("svg")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveAttribute("hidden");

    const search = screen.getByLabelText("Поиск по названию блюда");
    const author = screen.getByLabelText("Официант");
    const status = screen.getByLabelText("Статус заказа");
    expect(screen.getByLabelText("Продукт")).toBeInTheDocument();
    expect(screen.getByLabelText("Тип заказа")).toBeInTheDocument();
    expect(screen.getByLabelText("Категория")).toBeInTheDocument();
    expect(screen.getByLabelText("Тип оплаты")).toBeInTheDocument();
    expect(Array.from(panel.children).map((element) => (
      element.matches(".report-filter-buttons")
        ? "Действия"
        : element.querySelector("input, select")?.getAttribute("aria-label")
    ))).toEqual([
      "Поиск по названию блюда",
      "Официант",
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
    fireEvent.change(author, { target: { value: "author-1" } });
    fireEvent.change(status, { target: { value: "completed" } });

    fireEvent.click(toggle);
    expect(panel).toHaveAttribute("hidden");
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

  it("accepts legacy empty [] as valid zero-data with 0/0 totals", async () => {
    reportsService.listDishes.mockResolvedValue({ data: [] });
    render(<DishesReportPage />);
    expect(await screen.findByText("Блюд не найдено")).toBeInTheDocument();
    const totalRow = document.querySelector(".dishes-report-page .report-total-row");
    expect(totalRow.textContent).toContain("Итого");
    expect(/0 UZS/.test(totalRow.textContent)).toBe(true);
  });

  it("accepts canonical empty object as valid zero-data with backend totals", async () => {
    reportsService.listDishes.mockResolvedValue({ data: { rows: [], totals: { quantity: 0, amount: 0 } } });
    render(<DishesReportPage />);
    expect(await screen.findByText("Блюд не найдено")).toBeInTheDocument();
    expect(document.querySelector(".report-loading-row")).toBeNull();
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
