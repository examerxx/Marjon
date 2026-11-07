import { readFileSync } from "node:fs";
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { warehouseService } from "../api/warehouse";
import { webDateTime } from "../utils/webTime";
import { nomenclatureService } from "../api/nomenclature";
import { catalogService } from "../api/catalog";
import { settingsService } from "../api/settings";
import WarehousePage, { __resetDocRangeCache, aggregateExpenseProducts, WarehouseStockDetailRoute } from "./WarehousePage";

// Период кэшируется по секции между маунтами — тесты изолируем сбросом.
beforeEach(() => {
  __resetDocRangeCache();
  window.history.replaceState({}, "", "/");
  // Батч-эндпоинт деталей (один запрос на список документов). Тесты задают
  // поведение по одному id через getPurchase/getExpense — мост сохраняет их
  // смысл, а факт «один запрос вместо N» проверяется отдельным тестом.
  const bridge = (single) => async (ids) => ({
    data: await Promise.all(
      (Array.isArray(ids) ? ids : []).map(async (id) => ({
        ...((await single(id))?.data || {}),
        id,
      })),
    ),
  });
  warehouseService.listPurchaseDetails.mockImplementation(bridge(warehouseService.getPurchase));
  warehouseService.listExpenseDetails.mockImplementation(bridge(warehouseService.getExpense));
});

vi.mock("../api/warehouse", () => ({
  warehouseService: {
    list: vi.fn(),
    listOutgoingReport: vi.fn(),
    listStock: vi.fn(),
    listIngredients: vi.fn(),
    listWarehouses: vi.fn(),
    createWarehouse: vi.fn(),
    updateWarehouse: vi.fn(),
    deleteWarehouse: vi.fn(),
    getPurchase: vi.fn(),
    listPurchaseDetails: vi.fn(),
    createPurchase: vi.fn(),
    getExpense: vi.fn(),
    listExpenseDetails: vi.fn(),
    createInventory: vi.fn(),
    getInventory: vi.fn(),
    updateInventory: vi.fn(),
    deleteInventory: vi.fn(),
  },
}));

vi.mock("../api/nomenclature", () => ({
  nomenclatureService: {
    listIngredients: vi.fn(async () => ({ data: [] })),
  },
}));

vi.mock("../api/catalog", () => ({
  catalogService: {
    listProducts: vi.fn(async () => ({ data: [] })),
  },
}));

vi.mock("../api/settings", () => ({
  settingsService: {
    listResource: vi.fn(async () => ({ data: [] })),
  },
}));

vi.mock("../components/Icon", () => ({ default: () => <span aria-hidden="true" /> }));
vi.mock("../components/ReportEmptyState", () => ({
  default: ({ title }) => <div><strong>{title}</strong></div>,
}));

const warehouses = [
  { id: "wh-1", company_id: "c1", name: "Главный склад", address: null, is_main: true, branch_id: null },
  { id: "wh-2", company_id: "c1", name: "BAR", address: null, is_main: false, branch_id: null },
];

const stock = [
  { warehouse_id: "wh-1", ingredient_id: "ing-1", quantity: 50, cost_price: 1000, unit: "кг" },
  { warehouse_id: "wh-1", ingredient_id: "ing-2", quantity: 10, cost_price: 500, unit: "кг" },
  { warehouse_id: "wh-2", ingredient_id: "ing-1", quantity: 5, cost_price: 1000, unit: "кг" },
];

const ingredients = [
  { id: "ing-1", name: "kartoshka", category: "sabzavotlar", unit: "кг" },
  { id: "ing-2", name: "POMIDOR", category: "sabzavotlar", unit: "кг" },
];

function mockOutgoingReport(product, tovar = 0, qty = 1, bar = 0) {
  const response = { data: {
    rows: [
      { key: "wh-1", id: "wh-1", name: "Главный склад", product, tovar, raw: product + tovar },
      { key: "wh-2", id: "wh-2", name: "BAR", product: bar, tovar: 0, raw: bar },
    ], total: product + tovar + bar,
    lines: [
      { key: "movement-1", warehouseKey: "wh-1", ingredientId: "ing-1", name: "kartoshka", category: "sabzavotlar", qty, unit: "кг", sum: product, isTovar: false },
      ...(tovar ? [{ key: "movement-2", warehouseKey: "wh-1", ingredientId: "ing-2", name: "COCA COLA", category: "напитки", qty: 3, unit: "шт", sum: tovar, isTovar: true }] : []),
      ...(bar ? [{ key: "movement-3", warehouseKey: "wh-2", ingredientId: "ing-1", name: "kartoshka", category: "sabzavotlar", qty: 1, unit: "кг", sum: bar, isTovar: false }] : []),
    ],
  } };
  warehouseService.listOutgoingReport.mockResolvedValue(response);
  return response;
}

function mockStock({ warehouses: wh = warehouses, stock: items = stock, ingredients: ings = ingredients } = {}) {
  warehouseService.listStock.mockResolvedValue({ data: items });
  warehouseService.listWarehouses.mockResolvedValue({ data: wh });
  warehouseService.listIngredients.mockResolvedValue({ data: ings });
  warehouseService.list.mockResolvedValue({ data: [] });
}

describe("Warehouse stock summary (V36 dishes family)", () => {
  it("uses the dashboard URL period and preserves it after a remount", async () => {
    window.history.replaceState({}, "", "/stock-report/outgoing?date_from=2026-10-12&date_to=2026-10-17");
    mockStock(); mockOutgoingReport(21000);
    const view = render(<WarehousePage initialSection="outgoing" />);
    await waitFor(() => expect(warehouseService.listOutgoingReport).toHaveBeenCalledWith("2026-10-12", "2026-10-17"));
    expect((await screen.findByRole("table", { name: "Расход по складам" })).textContent).toMatch(/21[\s\u00a0\u202f]*000 UZS/);
    view.unmount(); __resetDocRangeCache();
    render(<WarehousePage initialSection="outgoing" />);
    await waitFor(() => expect(warehouseService.listOutgoingReport).toHaveBeenLastCalledWith("2026-10-12", "2026-10-17"));
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. renders per-warehouse rows with tfoot total at the bottom", async () => {
    mockStock();
    const { container } = render(<WarehousePage initialSection="stock" />);
    expect(await screen.findByRole("heading", { name: "Остаток товаров" })).toBeInTheDocument();
    const headers = [...container.querySelectorAll(".warehouse-stock-table thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["№", "Название", "Продукты", "Товары", "Сумма", "Статус", "Действия"]);
    const table = screen.getByRole("table", { name: "Остаток по складам" });
    // wh-1: 50×1000 + 10×500 = 55 000; wh-2: 5×1000 = 5 000; итого 60 000.
    expect(within(table).getByText("Главный склад")).toBeInTheDocument();
    expect(within(table).getByText("BAR")).toBeInTheDocument();
    const tfoot = container.querySelector(".warehouse-stock-table tfoot");
    expect(tfoot).not.toBeNull();
    expect(tfoot.textContent).toMatch(/Итого/);
    await waitFor(() => {
      expect(table.textContent).toMatch(/55[\s\u00a0\u202f]*000 UZS/);
      expect(table.textContent).toMatch(/5[\s\u00a0\u202f]*000 UZS/);
      expect(tfoot.textContent).toMatch(/60[\s\u00a0\u202f]*000 UZS/);
    });
    // Товары отделяются от Продуктов: без sale-карточек всё — Продукты.
    expect(warehouseService.list).toHaveBeenCalledWith("incoming", expect.anything());
  });

  it("2. add warehouse through centered modal posts name and active status", async () => {
    mockStock();
    warehouseService.createWarehouse.mockImplementation(async (payload) => ({
      data: { id: "wh-3", name: payload.name, is_main: false },
    }));
    render(<WarehousePage initialSection="stock" />);
    await screen.findByText("Главный склад");
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    expect(await screen.findByRole("heading", { name: "Добавить склад" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Название склада"), { target: { value: "Третий" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Добавить" }).pop());
    await waitFor(() => expect(warehouseService.createWarehouse).toHaveBeenCalledWith({ name: "Третий", is_active: true }));
    await waitFor(() => expect(warehouseService.listStock).toHaveBeenCalledTimes(2));
  });

  it("3. rename warehouse through edit modal", async () => {
    mockStock();
    warehouseService.updateWarehouse.mockResolvedValue({ data: {} });
    render(<WarehousePage initialSection="stock" />);
    await screen.findByText("BAR");
    const row = screen.getByText("BAR").closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "Редактировать" }));
    expect(await screen.findByRole("heading", { name: "Редактировать склад" })).toBeInTheDocument();
    const input = screen.getByLabelText("Название склада");
    fireEvent.change(input, { target: { value: "Бар" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(warehouseService.updateWarehouse).toHaveBeenCalledWith("wh-2", { name: "Бар", is_active: true }));
  });

  it("4. delete guarded warehouse shows backend 409 detail", async () => {
    mockStock();
    warehouseService.deleteWarehouse.mockRejectedValue({
      response: { data: { detail: "Склад используется: остатки" } },
    });
    render(<WarehousePage initialSection="stock" />);
    await screen.findByText("BAR");
    const row = screen.getByText("BAR").closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "Удалить" }));
    expect(await screen.findByRole("heading", { name: "Удалить склад?" })).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(warehouseService.deleteWarehouse).toHaveBeenCalledWith("wh-2"));
    expect(await screen.findByText("Склад используется: остатки")).toBeInTheDocument();
  });

  it("5. empty warehouses show compact empty state without tfoot", async () => {
    mockStock({ warehouses: [], stock: [] });
    const { container } = render(<WarehousePage initialSection="stock" />);
    expect(await screen.findByText("Склады пока не добавлены.")).toBeInTheDocument();
    expect(container.querySelector(".warehouse-stock-table tfoot")).toBeNull();
  });

  it("9. warehouse modal closes through exit animation with proportional X", async () => {
    mockStock();
    render(<WarehousePage initialSection="stock" />);
    await screen.findByText("Главный склад");
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    await screen.findByRole("heading", { name: "Добавить склад" });
    const overlay = document.querySelector(".warehouse-modal-layer .settings-modal-overlay, .settings-modal.warehouse-modal");
    expect(overlay).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(document.querySelector(".settings-modal-overlay.is-closing")).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Добавить склад" })).toBeNull());
    const css = readFileSync(`${process.cwd()}/src/styles/owner/warehouse.css`, "utf8");
    const x = css.match(
      /\.settings-owner-view \.settings-modal\.warehouse-modal \.settings-form__header button\[aria-label="Закрыть"\]\s*\{[^}]*\}/,
    )?.[0] || "";
    expect(x).toMatch(/width:\s*38px/);
    expect(x).toMatch(/border-radius:\s*999px/);
  });

  it("6. warehouse name is a link that opens detail without Excel or search", async () => {
    mockStock();
    render(<WarehousePage initialSection="stock" />);
    const link = await screen.findByRole("button", { name: "Открыть остатки склада Главный склад" });
    expect(link).toHaveClass("wh-stock-link");
    fireEvent.click(link);
    const detail = await screen.findByRole("table", { name: "Остаток склада Главный склад" });
    expect(within(detail).getByText("Всего")).toBeInTheDocument();
    expect(within(detail).getByText("Продукты")).toBeInTheDocument();
    expect(within(detail).getByText("Товары")).toBeInTheDocument();
    // Без Excel и поисковика — по требованию OWNER.
    expect(screen.queryByRole("button", { name: /excel/i })).toBeNull();
    expect(screen.queryByPlaceholderText(/поиск/i)).toBeNull();
    // Категории по умолчанию закрыты — позиции видны после раскрытия.
    expect(within(detail).queryByText("kartoshka")).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "Развернуть категорию продуктов sabzavotlar" }));
    expect(await within(detail).findByText("kartoshka")).toBeInTheDocument();
  });

  it("7. detail groups by category with totals; warehouseId prop renders detail directly", async () => {
    mockStock();
    render(<WarehousePage initialSection="stock" warehouseId="wh-1" />);
    const detail = await screen.findByRole("table", { name: "Остаток склада Главный склад" });
    // wh-1: qty 50+10=60; sum 50×1000+10×500=55 000.
    expect(detail.textContent).toMatch(/60/);
    expect(detail.textContent).toMatch(/55[\s\u00a0\u202f]*000 UZS/);
    expect(within(detail).getByText("sabzavotlar")).toBeInTheDocument();
    // Позиции скрыты, пока категория закрыта.
    expect(within(detail).queryByText("POMIDOR")).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "Развернуть категорию продуктов sabzavotlar" }));
    expect(await within(detail).findByText("POMIDOR")).toBeInTheDocument();
    // Кнопки «Назад» в шапке нет — возврат через стрелку топбара (роут).
    expect(screen.queryByRole("button", { name: /назад/i })).toBeNull();
  });

  it("7b. link click notifies onOpenWarehouse for route navigation", async () => {
    mockStock();
    const onOpen = vi.fn();
    render(<WarehousePage initialSection="stock" onOpenWarehouse={onOpen} />);
    fireEvent.click(await screen.findByRole("button", { name: "Открыть остатки склада BAR" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(onOpen.mock.calls[0][0]).toMatchObject({ id: "wh-2", name: "BAR" });
  });

  it("7c. focusIngredientId opens only the category of that ingredient", async () => {
    // Две разные категории: заход из колокольчика дефицита должен раскрыть
    // ровно одну — ту, где лежит дефицитное сырьё.
    mockStock({
      stock: [
        { warehouse_id: "wh-1", ingredient_id: "ing-1", quantity: 50, cost_price: 1000, unit: "кг" },
        { warehouse_id: "wh-1", ingredient_id: "ing-3", quantity: 7, cost_price: 200, unit: "кг" },
      ],
      ingredients: [
        { id: "ing-1", name: "kartoshka", category: "sabzavotlar", unit: "кг" },
        { id: "ing-3", name: "guruch", category: "krupy", unit: "кг" },
      ],
    });
    render(<WarehousePage initialSection="stock" warehouseId="wh-1" focusIngredientId="ing-3" />);
    const detail = await screen.findByRole("table", { name: "Остаток склада Главный склад" });
    // Категория дефицита раскрыта — строка видна без кликов.
    expect(await within(detail).findByText("guruch")).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "Свернуть категорию продуктов krupy" })).toBeInTheDocument();
    // Чужая категория осталась закрытой.
    expect(within(detail).queryByText("kartoshka")).toBeNull();
    expect(within(detail).getByRole("button", { name: "Развернуть категорию продуктов sabzavotlar" })).toBeInTheDocument();
  });

  it("7d. unknown focusIngredientId leaves every category closed", async () => {
    mockStock();
    render(<WarehousePage initialSection="stock" warehouseId="wh-1" focusIngredientId="ing-gone" />);
    const detail = await screen.findByRole("table", { name: "Остаток склада Главный склад" });
    expect(within(detail).queryByText("kartoshka")).toBeNull();
    expect(within(detail).getByRole("button", { name: "Развернуть категорию продуктов sabzavotlar" })).toBeInTheDocument();
  });

  it("7e. stock detail route passes ?ingredient= through to the page", async () => {
    // Сквозная проверка ссылки из колокольчика дефицита: URL со складом и
    // сырьём должен открыть остатки этого склада с раскрытой категорией.
    mockStock({
      stock: [
        { warehouse_id: "wh-1", ingredient_id: "ing-1", quantity: 50, cost_price: 1000, unit: "кг" },
        { warehouse_id: "wh-1", ingredient_id: "ing-3", quantity: 7, cost_price: 200, unit: "кг" },
      ],
      ingredients: [
        { id: "ing-1", name: "kartoshka", category: "sabzavotlar", unit: "кг" },
        { id: "ing-3", name: "guruch", category: "krupy", unit: "кг" },
      ],
    });
    render(
      <MemoryRouter initialEntries={["/stock-report/stock/wh-1?ingredient=ing-3"]}>
        <Routes>
          <Route path="/stock-report/stock/:warehouseId" element={<WarehouseStockDetailRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    const detail = await screen.findByRole("table", { name: "Остаток склада Главный склад" });
    expect(await within(detail).findByText("guruch")).toBeInTheDocument();
    expect(within(detail).queryByText("kartoshka")).toBeNull();
  });

  it("8. category toggle expands and collapses ingredient lines", async () => {
    mockStock();
    render(<WarehousePage initialSection="stock" />);
    fireEvent.click(await screen.findByRole("button", { name: "Открыть остатки склада Главный склад" }));
    const detail = await screen.findByRole("table", { name: "Остаток склада Главный склад" });
    // По умолчанию закрыто.
    expect(within(detail).queryByText("kartoshka")).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "Развернуть категорию продуктов sabzavotlar" }));
    await within(detail).findByText("kartoshka");
    const toggle = within(detail).getByRole("button", { name: "Свернуть категорию продуктов sabzavotlar" });
    fireEvent.click(toggle);
    // Закрытие с анимацией 200мс: строки уходят не мгновенно.
    await waitFor(() => expect(within(detail).queryByText("kartoshka")).toBeNull());
    expect(within(detail).getByText("sabzavotlar")).toBeInTheDocument();
  });

  it("8b. tovar ingredient splits into Товары column and tree", async () => {
    mockStock();
    catalogService.listProducts.mockResolvedValue({
      data: [{ id: "prod-1", name: "POMIDOR", category_name: "sabzavotlar", unit: "кг", price: 500, product_type: "sale", is_active: true }],
    });
    const { container } = render(<WarehousePage initialSection="stock" />);
    const table = await screen.findByRole("table", { name: "Остаток по складам" });
    // wh-1: продукты 50×1000=50 000, товары 10×500=5 000, сумма 55 000.
    await waitFor(() => {
      expect(table.textContent).toMatch(/50[\s\u00a0\u202f]*000 UZS/);
      expect(table.textContent).toMatch(/55[\s\u00a0\u202f]*000 UZS/);
    });
    // Статус-точка как в Официантах: без пилюли, точка + текст.
    expect(container.querySelector(".wh-status-dot.is-active")).not.toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Открыть остатки склада Главный склад" }));
    const detail = await screen.findByRole("table", { name: "Остаток склада Главный склад" });
    expect(within(detail).getByText("Товары по категориям")).toBeInTheDocument();
    expect(within(detail).getByText("Продукты по категориям")).toBeInTheDocument();
  });

  it("8c. period picker reloads stock as of date and locks mutations", async () => {
    mockStock();
    render(<WarehousePage initialSection="stock" />);
    await screen.findByText("Главный склад");
    // Кнопка периода — тот же canonical-пикер, что в отчётах (сегодня = текущие).
    // По умолчанию пресет Сегодня активен, как в Отчётах.
    expect(screen.getByRole("button", { name: "Остатки на дату" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Добавить" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Остатки на дату" }));
    expect(await screen.findByRole("button", { name: "Сегодня" })).toHaveClass("is-active");
    fireEvent.click(await screen.findByRole("button", { name: "Вчера" }));
    // Как в отчётах: пресет — черновик до ОК.
    fireEvent.click(screen.getByRole("button", { name: "ОК" }));
    const pad = (value) => String(value).padStart(2, "0");
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayApi = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
    await waitFor(() => {
      const calls = warehouseService.listStock.mock.calls;
      expect(calls.some((call) => call[0]?.params?.as_of === yesterdayApi)).toBe(true);
    });
    // Исторический срез read-only: Добавить скрыт, плашка видна.
    // Формат даты в плашке — точками (ДД.ММ.ГГГГ), как кнопка и отчёты.
    expect(screen.queryByRole("button", { name: "Добавить" })).toBeNull();
    expect(await screen.findByText(/Срез на \d{2}\.\d{2}\.\d{4} — только просмотр/)).toBeInTheDocument();
    // Кнопка периода — та же пилюля 22px, что в Отчётах (REPORT-02/DISHES-01).
    const whCss = readFileSync(`${process.cwd()}/src/styles/owner/warehouse.css`, "utf8");
    const periodRule = whCss.match(/\.warehouse-stock-page[^{]*\.report-period-button\s*\{[^}]*\}/)?.[0] || "";
    expect(periodRule).toMatch(/border-radius:\s*22px/);
    // Пресет Сегодня возвращает к текущим остаткам.
    fireEvent.click(screen.getByRole("button", { name: "Остатки на дату" }));
    fireEvent.click(await screen.findByRole("button", { name: "Сегодня" }));
    fireEvent.click(screen.getByRole("button", { name: "ОК" }));
    await waitFor(() => {
      const calls = warehouseService.listStock.mock.calls;
      expect(calls[calls.length - 1][0]?.params).toBeUndefined();
    });
    expect(await screen.findByRole("button", { name: "Добавить" })).toBeInTheDocument();
  });

  it("8c2. stockRangeToAsOf takes period end as the snapshot date", async () => {
    const { stockRangeToAsOf } = await import("./WarehousePage");
    expect(stockRangeToAsOf({ start: "01.10.2026", end: "05.10.2026" })).toBe("2026-10-05");
    expect(stockRangeToAsOf({ start: "05.10.2026", end: "05.10.2026" })).toBe("2026-10-05");
    expect(stockRangeToAsOf({})).toBe("");
  });

  it("8e. incoming summary groups by warehouse with product/tovar split", async () => {
    const pad = (value) => String(value).padStart(2, "0");
    const today = new Date();
    const isoToday = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const regToday = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()} / 12:00`;
    const doc = (id, number, whId, whName, total) => ({
      id, number, supplier: `Поставщик-${number}`, warehouse_id: whId, warehouse_name: whName,
      date: isoToday, registered_at: regToday,
      items_count: 1, total_amount: total,
      status: "draft", created_by_name: "",
    });
    warehouseService.list.mockResolvedValue({
      data: [
        doc("d1", 1, "wh-1", "Главный склад", 2500),
        doc("d2", 2, "wh-1", "Главный склад", 3000),
        doc("d3", 3, "wh-2", "BAR", 500),
      ],
    });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    // Продукт vs Товар — по строкам getPurchase (есть product_id → Товар).
    warehouseService.getPurchase.mockImplementation(async (id) => {
      if (id === "d1") {
        return { data: { items: [
          { quantity: 2, cost_price: 1000, product_id: null },
          { quantity: 1, cost_price: 500, product_id: "prod-1" },
        ] } };
      }
      if (id === "d2") {
        return { data: { items: [{ quantity: 1, cost_price: 3000, product_id: null }] } };
      }
      return { data: { items: [{ quantity: 5, cost_price: 100, product_id: "prod-2" }] } };
    });
    const { container } = render(<WarehousePage initialSection="incoming" />);
    const table = await screen.findByRole("table", { name: "Приход по складам" });
    const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["№", "Название", "Продукт", "Товар", "Сумма"]);
    // Снизу — карточка «Инвентаризация» как таблица Прихода (излишки).
    const invTable = await screen.findByRole("table", { name: "Инвентаризация по складам" });
    expect([...invTable.querySelectorAll("thead th")].map((th) => th.textContent))
      .toEqual(["№", "Название", "Продукт", "Товар", "Сумма"]);
    // wh-1: продукты 2×1000+1×3000=5 000, товары 1×500=500, сумма 5 500.
    // wh-2: товары 5×100=500.
    expect(within(table).getByText("Главный склад")).toBeInTheDocument();
    expect(within(table).getByText("BAR")).toBeInTheDocument();
    expect(table.textContent).toMatch(/5[\s\u00a0\u202f]*500 UZS/);
    expect(table.textContent).toMatch(/500 UZS/);
    const tfoot = container.querySelector(".warehouse-stock-table tfoot");
    expect(tfoot).not.toBeNull();
    expect(tfoot.textContent).toMatch(/Итого/);
    expect(tfoot.textContent).toMatch(/6[\s\u00a0\u202f]*000 UZS/);
    // Кнопка периода общая (docRange); кнопки «Новый приход +» нет.
    expect(screen.getByRole("button", { name: "Период документов" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Новый приход/ })).toBeNull();
  });

  it("8h. incoming summary period filters like reports", async () => {
    const pad = (value) => String(value).padStart(2, "0");
    const isoDay = (offset) => {
      const dt = new Date();
      dt.setDate(dt.getDate() - offset);
      return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    };
    const regDay = (offset) => {
      const dt = new Date();
      dt.setDate(dt.getDate() - offset);
      return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()} / 12:00`;
    };
    const doc = (id, number, whId, whName, date, registeredAt, total) => ({
      id, number, supplier: `Поставщик-${number}`, warehouse_id: whId, warehouse_name: whName,
      date, registered_at: registeredAt,
      items_count: 1, total_amount: total,
      status: "draft", created_by_name: "",
    });
    warehouseService.list.mockResolvedValue({
      data: [
        doc("d1", 1, "wh-1", "Главный склад", isoDay(1), regDay(0), 1000),
        doc("d2", 2, "wh-2", "BAR", isoDay(0), regDay(1), 2000),
      ],
    });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.getPurchase.mockResolvedValue({ data: { items: [] } });
    render(<WarehousePage initialSection="incoming" />);
    const table = await screen.findByRole("table", { name: "Приход по складам" });
    const rowFor = (name) => within(table).getByText(name).closest("tr");
    // По умолчанию Сегодня: wh-1 = 1 000, wh-2 = 0 (период по дате регистрации).
    expect(rowFor("Главный склад").textContent).toMatch(/1[\s\u00a0\u202f]*000 UZS/);
    // Вчера + ОК — наоборот (пресет черновик до ОК, как в отчётах).
    fireEvent.click(screen.getByRole("button", { name: "Период документов" }));
    fireEvent.click(await screen.findByRole("button", { name: "Вчера" }));
    fireEvent.click(screen.getByRole("button", { name: "ОК" }));
    expect(await within(table).findByText("BAR")).toBeInTheDocument();
    expect(rowFor("BAR").textContent).toMatch(/2[\s\u00a0\u202f]*000 UZS/);
    // Сегодня + ОК — возврат.
    fireEvent.click(screen.getByRole("button", { name: "Период документов" }));
    fireEvent.click(await screen.findByRole("button", { name: "Сегодня" }));
    fireEvent.click(screen.getByRole("button", { name: "ОК" }));
    expect(rowFor("Главный склад").textContent).toMatch(/1[\s\u00a0\u202f]*000 UZS/);
  });

  it("8i. incoming warehouse click opens stock-like breakdown of primary приход", async () => {
    const pad = (value) => String(value).padStart(2, "0");
    const today = new Date();
    const isoToday = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const regToday = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()} / 12:00`;
    const doc = (id, number, supplier, whId, whName) => ({
      id, number, supplier, warehouse_id: whId, warehouse_name: whName,
      date: isoToday, registered_at: regToday,
      items_count: 2, total_amount: 220000,
      status: "draft", created_by_name: "",
    });
    warehouseService.list.mockResolvedValue({
      data: [
        doc("d1", 1, "Анвар", "wh-1", "Главный склад"),
        doc("d2", 2, "Другой", "wh-2", "BAR"),
      ],
    });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    // Только первичный приход: строки документа (расхода здесь нет).
    warehouseService.getPurchase.mockImplementation(async (id) => {
      if (id !== "d1") return { data: { items: [] } };
      return { data: { items: [
        { id: "li-1", ingredient_id: "ing-1", product_id: null, name: "kartoshka", quantity: 20, unit: "кг", cost_price: 5000 },
        { id: "li-2", ingredient_id: null, product_id: "prod-1", name: "COCA COLA", quantity: 10, unit: "шт", cost_price: 12000 },
      ] } };
    });
    warehouseService.listIngredients.mockResolvedValue({
      data: [{ id: "ing-1", name: "kartoshka", category: "sabzavotlar", unit: "кг" }],
    });
    render(<WarehousePage initialSection="incoming" />);
    fireEvent.click(await screen.findByRole("button", { name: "Открыть приходы склада Главный склад" }));
    // Внутренний экран как в Остатках: Всего/Продукты/Товары + категории.
    const detail = await screen.findByRole("table", { name: "Приход склада Главный склад" });
    expect(within(detail).getByText("Всего")).toBeInTheDocument();
    expect(within(detail).getByText("Продукты")).toBeInTheDocument();
    expect(within(detail).getByText("Товары")).toBeInTheDocument();
    // 20×5000 + 10×12000 = 220 000; кол-во 30.
    expect(detail.textContent).toMatch(/220[\s\u00a0\u202f]*000 UZS/);
    // Категории по умолчанию закрыты — позиции видны после раскрытия.
    expect(within(detail).queryByText("kartoshka")).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "Развернуть категорию продуктов sabzavotlar" }));
    expect(await within(detail).findByText("kartoshka")).toBeInTheDocument();
    // Чужого склада здесь нет, Excel/поиска нет, кнопки «Новый приход» нет.
    expect(within(detail).queryByText("Другой")).toBeNull();
    expect(screen.queryByRole("button", { name: /excel/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Новый приход/ })).toBeNull();
    // Период и в детализации; кнопки «Назад» в шапке нет —
    // возврат стрелкой топбара (popstate) на главный экран «Приход товаров».
    expect(screen.getByRole("button", { name: "Период документов" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /назад/i })).toBeNull();
    // Стрелка топбара: history.back -> popstate закрывает детализацию.
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByRole("table", { name: "Приход по складам" })).toBeInTheDocument();
  });

  it("8j. outgoing summary groups by warehouse with sale-match tovar split", async () => {
    mockOutgoingReport(2000, 1500, 2, 1000);
    const pad = (value) => String(value).padStart(2, "0");
    const today = new Date();
    const isoToday = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const regToday = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()} / 12:00`;
    const doc = (id, number, whId, whName) => ({
      id, number, receiver: `Получатель-${number}`, warehouse_id: whId, warehouse_name: whName,
      date: isoToday, registered_at: regToday,
      items_count: 1, total_amount: 1000,
      status: "draft", created_by_name: "",
    });
    warehouseService.list.mockResolvedValue({
      data: [doc("e1", 1, "wh-1", "Главный склад"), doc("e2", 2, "wh-2", "BAR")],
    });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.listIngredients.mockResolvedValue({
      data: [
        { id: "ing-1", name: "kartoshka", category: "sabzavotlar", unit: "кг" },
        { id: "ing-2", name: "COCA COLA", category: "напитки", unit: "шт" },
      ],
    });
    catalogService.listProducts.mockResolvedValue({
      data: [{ id: "prod-1", name: "COCA COLA", unit: "шт", product_type: "sale", is_active: true }],
    });
    // У строк расхода нет product_id — Товар отделяем совпадением с sale.
    warehouseService.getExpense.mockImplementation(async (id) => {
      if (id === "e1") {
        return { data: { items: [
          { ingredient_id: "ing-1", name: "kartoshka", quantity: 2, unit: "кг", cost_price: 1000 },
          { ingredient_id: "ing-2", name: "COCA COLA", quantity: 3, unit: "шт", cost_price: 500 },
        ] } };
      }
      return { data: { items: [
        { ingredient_id: "ing-1", name: "kartoshka", quantity: 1, unit: "кг", cost_price: 1000 },
      ] } };
    });
    render(<WarehousePage initialSection="outgoing" />);
    const table = await screen.findByRole("table", { name: "Расход по складам" });
    expect([...table.querySelectorAll("thead th")].map((th) => th.textContent))
      .toEqual(["№", "Название", "Продукт", "Товар", "Сумма"]);
    // wh-1: продукты 2×1000=2 000, товары 3×500=1 500, сумма 3 500.
    const rowFor = (name) => within(table).getByText(name).closest("tr");
    expect(rowFor("Главный склад").textContent).toMatch(/3[\s\u00a0\u202f]*500 UZS/);
    expect(rowFor("BAR").textContent).toMatch(/1[\s\u00a0\u202f]*000 UZS/);
    expect(table.textContent).toMatch(/4[\s\u00a0\u202f]*500 UZS/);
    // Кнопки «Новый расход +» нет (как в Приходе), период на месте.
    expect(screen.getByRole("button", { name: "Период документов" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Новый расход/ })).toBeNull();
  });

  it("8k. outgoing summary period filters like reports", async () => {
    const todayReport = mockOutgoingReport(1000);
    const yesterdayReport = mockOutgoingReport(0, 0, 0, 2000);
    const pad = (value) => String(value).padStart(2, "0");
    const isoDay = (offset) => {
      const dt = new Date();
      dt.setDate(dt.getDate() - offset);
      return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    };
    const regDay = (offset) => {
      const dt = new Date();
      dt.setDate(dt.getDate() - offset);
      return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()} / 12:00`;
    };
    warehouseService.listOutgoingReport.mockImplementation(async (from) => from === isoDay(0) ? todayReport : yesterdayReport);
    const doc = (id, number, whId, whName, date, registeredAt, total) => ({
      id, number, receiver: `Получатель-${number}`, warehouse_id: whId, warehouse_name: whName,
      date, registered_at: registeredAt,
      items_count: 1, total_amount: total,
      status: "draft", created_by_name: "",
    });
    warehouseService.list.mockResolvedValue({
      data: [
        doc("e1", 1, "wh-1", "Главный склад", isoDay(1), regDay(0), 1000),
        doc("e2", 2, "wh-2", "BAR", isoDay(0), regDay(1), 2000),
      ],
    });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.getExpense.mockResolvedValue({ data: { items: [] } });
    render(<WarehousePage initialSection="outgoing" />);
    const table = await screen.findByRole("table", { name: "Расход по складам" });
    const rowFor = (name) => within(table).getByText(name).closest("tr");
    expect(rowFor("Главный склад").textContent).toMatch(/1[\s\u00a0\u202f]*000 UZS/);
    fireEvent.click(screen.getByRole("button", { name: "Период документов" }));
    fireEvent.click(await screen.findByRole("button", { name: "Вчера" }));
    fireEvent.click(screen.getByRole("button", { name: "ОК" }));
    await waitFor(() => expect(rowFor("BAR").textContent).toMatch(/2[\s\u00a0\u202f]*000 UZS/));
    expect(warehouseService.listOutgoingReport).toHaveBeenLastCalledWith(isoDay(1), isoDay(1));
  });

  it("8l. outgoing warehouse click opens stock-like breakdown of expense only", async () => {
    mockOutgoingReport(100000, 0, 20);
    const pad = (value) => String(value).padStart(2, "0");
    const today = new Date();
    const isoToday = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const regToday = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()} / 12:00`;
    warehouseService.list.mockResolvedValue({
      data: [{
        id: "e1", number: 1, receiver: "Кухня", warehouse_id: "wh-1", warehouse_name: "Главный склад",
        date: isoToday, registered_at: regToday,
        items_count: 1, total_amount: 100000,
        status: "draft", created_by_name: "",
      }],
    });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.listIngredients.mockResolvedValue({
      data: [{ id: "ing-1", name: "kartoshka", category: "sabzavotlar", unit: "кг" }],
    });
    catalogService.listProducts.mockResolvedValue({ data: [] });
    warehouseService.getExpense.mockResolvedValue({ data: { items: [
      { ingredient_id: "ing-1", name: "kartoshka", quantity: 20, unit: "кг", cost_price: 5000 },
    ] } });
    render(<WarehousePage initialSection="outgoing" />);
    fireEvent.click(await screen.findByRole("button", { name: "Открыть расходы склада Главный склад" }));
    const detail = await screen.findByRole("table", { name: "Расход склада Главный склад" });
    expect(within(detail).getByText("Всего")).toBeInTheDocument();
    // 20×5000 = 100 000, всё — Продукты.
    expect(detail.textContent).toMatch(/100[\s\u00a0\u202f]*000 UZS/);
    expect(within(detail).queryByText("kartoshka")).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "Развернуть категорию продуктов sabzavotlar" }));
    expect(await within(detail).findByText("kartoshka")).toBeInTheDocument();
    // Кнопки «Назад» в шапке нет — возврат стрелкой топбара (popstate)
    // на главный экран «Расход товаров».
    expect(screen.queryByRole("button", { name: /назад/i })).toBeNull();
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByRole("table", { name: "Расход по складам" })).toBeInTheDocument();
  });

  // Расход: один продукт — одна строка. Раньше «Мясо» повторялось столько раз,
  // сколько было списаний (документ/продажа на каждую строку).
  it("8m. aggregateExpenseProducts folds movements of one product into a single row", () => {
    const merged = aggregateExpenseProducts([
      { key: "m1", name: "Мясо", unit: "кг", category: "Мясо и птица", qty: "0.5", sum: "20000",
        dishes: [{ name: "Плов", qty: "0.3" }, { name: "Шашлык", qty: "0.2" }] },
      { key: "m2", name: "Мясо", unit: "кг", category: "Мясо и птица", qty: "0.1", sum: "4000",
        dishes: [], registeredAt: "23.10.2026 / 15:50" },
      { key: "m3", name: "Мясо", unit: "кг", category: "Мясо и птица", qty: "0.4", sum: "16000",
        dishes: [{ name: "Плов", qty: "0.4" }] },
      { key: "m4", name: "Соль", unit: "кг", category: "Специи", qty: "0.04", sum: "320", dishes: [] },
      // продажа, у которой блюдо не восстановить (заказ удалён) — не ручной расход
      { key: "m5", name: "Соль", unit: "кг", category: "Специи", qty: "0.06", sum: "480",
        dishes: [], source: "sale", dishesReason: "order_deleted", registeredAt: "22.10.2026 / 10:00" },
    ]);
    expect(merged).toHaveLength(2);
    const meat = merged.find((item) => item.name === "Мясо");
    expect(meat.qty).toBeCloseTo(1, 6);
    expect(meat.sum).toBeCloseTo(40000, 6);
    // Блюда складываются по имени и сортируются по расходу (Плов 0.3 + 0.4).
    expect(meat.dishes).toEqual([{ name: "Плов", qty: 0.7, sum: 28000 }, { name: "Шашлык", qty: 0.2, sum: 8000 }]);
    // Документ без блюд уходит в «Ручной расход», а не в разбивку.
    expect(meat.manual).toHaveLength(1);
    expect(meat.manualQty).toBeCloseTo(0.1, 6);
    expect(meat.manualSum).toBeCloseTo(4000, 6);
    const salt = merged.find((item) => item.name === "Соль");
    expect(salt.dishes).toEqual([]);
    expect(salt.manual).toHaveLength(1);
    // Продажа без блюд отделена от ручного документа, причина — от бэкенда.
    expect(salt.unlinked).toHaveLength(1);
    expect(salt.unlinkedQty).toBeCloseTo(0.06, 6);
    expect(salt.unlinkedReasons.order_deleted).toMatchObject({ count: 1, qty: 0.06, sum: 480 });
    expect(salt.unlinkedReasons.order_deleted.candidates).toEqual([]);
  });

  it("allocates actual expense amounts to dishes and preserves rounding totals", () => {
    const [tomato] = aggregateExpenseProducts([
      { name: "Помидор", qty: 8, sum: 28000, dishes: [{ name: "Борщ", qty: 7 }, { name: "Плов", qty: 1 }] },
    ]);
    expect(tomato.dishes).toEqual([{ name: "Борщ", qty: 7, sum: 24500 }, { name: "Плов", qty: 1, sum: 3500 }]);
    const [rounded] = aggregateExpenseProducts([
      { name: "Соль", qty: 3, sum: 1, dishes: [{ name: "A", qty: 1 }, { name: "B", qty: 1 }, { name: "C", qty: 1 }] },
    ]);
    expect(rounded.dishes.map((dish) => dish.sum)).toEqual([0.33, 0.34, 0.33]);
    expect(rounded.dishes.reduce((total, dish) => total + dish.sum, 0)).toBe(rounded.sum);
  });

  it("8m2. recipe rewrite keeps the sold dishes of the order as candidates", () => {
    // Техкарту переписали (мясо убрали из Плова), заказ жив — бэкенд отдаёт
    // проданные блюда, и расход всё равно подписан блюдом.
    const merged = aggregateExpenseProducts([
      // Один заказ, два движения (дозаказ): состав заказа в обоих одинаковый,
      // поэтому порции считаются один раз, а не дважды.
      { key: "s1", orderId: "o1", name: "Мясо", unit: "кг", category: "Мясо и птица", qty: "0.5", sum: "20000",
        dishes: [], source: "sale", dishesReason: "not_in_recipe",
        dishesCandidates: [{ name: "Плов", qty: "2" }, { name: "Шашлык", qty: "1" }],
        dishesCandidatesTotal: 2 },
      { key: "s2", orderId: "o1", name: "Мясо", unit: "кг", category: "Мясо и птица", qty: "0.3", sum: "12000",
        dishes: [], source: "sale", dishesReason: "not_in_recipe",
        dishesCandidates: [{ name: "Плов", qty: "2" }, { name: "Шашлык", qty: "1" }],
        dishesCandidatesTotal: 2 },
      { key: "s3", orderId: "o2", name: "Мясо", unit: "кг", category: "Мясо и птица", qty: "0.2", sum: "8000",
        dishes: [], source: "sale", dishesReason: "not_in_recipe",
        dishesCandidates: [{ name: "Плов", qty: "1" }], dishesCandidatesTotal: 1 },
    ]);
    const meat = merged[0];
    expect(meat.dishes).toEqual([]);
    // Блюда складываются по имени, количества — в порциях проданного,
    // по разным заказам: Плов 2 (o1) + 1 (o2), Шашлык 1 (o1).
    expect(meat.unlinkedReasons.not_in_recipe.candidates).toEqual([
      { name: "Плов", portions: 3 },
      { name: "Шашлык", portions: 1 },
    ]);
    expect(meat.unlinkedReasons.not_in_recipe.candidatesTotal).toBe(2);
  });

  it("8n. outgoing detail renders one row per product and reveals its dishes", async () => {
    warehouseService.listOutgoingReport.mockResolvedValue({ data: {
      rows: [{ key: "wh-1", id: "wh-1", name: "Главный склад", product: 35000, tovar: 0, raw: 35000 }],
      total: 35000,
      lines: [
        { key: "m1", warehouseKey: "wh-1", ingredientId: "ing-1", name: "kartoshka", category: "sabzavotlar",
          qty: "0.5", unit: "кг", sum: "20000", isTovar: false, source: "sale",
          dishes: [{ name: "Плов", qty: "0.3" }, { name: "Шашлык", qty: "0.2" }] },
        { key: "m2", warehouseKey: "wh-1", ingredientId: "ing-1", name: "kartoshka", category: "sabzavotlar",
          qty: "0.1", unit: "кг", sum: "10000", isTovar: false, source: "expense", dishes: [] },
        { key: "m3", warehouseKey: "wh-1", ingredientId: "ing-1", name: "kartoshka", category: "sabzavotlar",
          qty: "0.2", unit: "кг", sum: "5000", isTovar: false, source: "sale", dishes: [],
          dishesReason: "order_deleted" },
      ],
    } });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.listIngredients.mockResolvedValue({
      data: [{ id: "ing-1", name: "kartoshka", category: "sabzavotlar", unit: "кг" }],
    });
    catalogService.listProducts.mockResolvedValue({ data: [] });
    warehouseService.list.mockResolvedValue({ data: [] });
    render(<WarehousePage initialSection="outgoing" />);
    fireEvent.click(await screen.findByRole("button", { name: "Открыть расходы склада Главный склад" }));
    const detail = await screen.findByRole("table", { name: "Расход склада Главный склад" });
    fireEvent.click(within(detail).getByRole("button", { name: "Развернуть категорию продуктов sabzavotlar" }));
    // Два движения — одна строка продукта со суммарными кол-вом и суммой.
    const rows = await within(detail).findAllByText("kartoshka");
    expect(rows).toHaveLength(1);
    expect(rows[0].closest("tr").textContent).toMatch(/0,8/);
    expect(rows[0].closest("tr").textContent).toMatch(/35[\s\u00a0\u202f]*000 UZS/);
    expect(within(detail).queryByText("Плов")).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "Развернуть расход продукта kartoshka" }));
    expect(await within(detail).findByText("Плов")).toBeInTheDocument();
    expect(within(detail).getByText("Плов").closest("tr").textContent).toMatch(/12[\s\u00a0\u202f]*000 UZS/);
    expect(within(detail).getByText("Шашлык")).toBeInTheDocument();
    expect(within(detail).getByText("Ручной расход")).toBeInTheDocument();
    // Причина потери блюда подписана, а не спрятана за «без разбивки».
    expect(within(detail).getByText("Заказ удалён")).toBeInTheDocument();
    // Стрелка сворачивает разбивку обратно.
    fireEvent.click(within(detail).getByRole("button", { name: "Свернуть расход продукта kartoshka" }));
    await waitFor(() => expect(within(detail).queryByText("Плов")).toBeNull());
  });

  it("8n2. recipe rewrite still names the dishes under the reason row", async () => {
    // Мясо месяц был в техкарте Плова, потом его оттуда убрали. Заказ жив —
    // значит под «Нет в техкарте» обязаны стоять проданные блюда.
    warehouseService.listOutgoingReport.mockResolvedValue({ data: {
      rows: [{ key: "wh-1", id: "wh-1", name: "Главный склад", product: 20000, tovar: 0, raw: 20000 }],
      total: 20000,
      lines: [
        { key: "s1", warehouseKey: "wh-1", ingredientId: "ing-1", name: "myaso", category: "go'sht",
          qty: "0.5", unit: "кг", sum: "20000", isTovar: false, source: "sale", dishes: [],
          dishesReason: "not_in_recipe",
          dishesCandidates: [{ name: "Плов", qty: "2" }, { name: "Шашлык", qty: "1" }],
          dishesCandidatesTotal: 2 },
      ],
    } });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.listIngredients.mockResolvedValue({
      data: [{ id: "ing-1", name: "myaso", category: "go'sht", unit: "кг" }],
    });
    catalogService.listProducts.mockResolvedValue({ data: [] });
    warehouseService.list.mockResolvedValue({ data: [] });
    render(<WarehousePage initialSection="outgoing" />);
    fireEvent.click(await screen.findByRole("button", { name: "Открыть расходы склада Главный склад" }));
    const detail = await screen.findByRole("table", { name: "Расход склада Главный склад" });
    fireEvent.click(within(detail).getByRole("button", { name: "Развернуть категорию продуктов go'sht" }));
    fireEvent.click(await within(detail).findByRole("button", { name: "Развернуть расход продукта myaso" }));
    expect(await within(detail).findByText("Нет в техкарте")).toBeInTheDocument();
    // Блюда заказа — отдельными строками с числом проданных порций.
    const plov = await within(detail).findByText("Плов");
    expect(plov.closest("tr").textContent).toMatch(/продано 2/);
    const shashlik = within(detail).getByText("Шашлык");
    expect(shashlik.closest("tr").textContent).toMatch(/продано 1/);
    expect(plov.closest("tr").className).toMatch(/wh-detail-dish-row--candidate/);
  });

  it("8e2. docDateToISO normalizes doc dates for range compare", async () => {
    const { docDateToISO, registeredAtToISO } = await import("./WarehousePage");
    expect(docDateToISO("2026-10-05")).toBe("2026-10-05");
    expect(docDateToISO("05.10.2026")).toBe("2026-10-05");
    expect(docDateToISO("05-10-2026")).toBe("2026-10-05");
    expect(docDateToISO("")).toBe("");
    // registered_at — UTC без зоны ("05.10.2026 / 12:00"): полдень не
    // перепрыгивает сутки при переводе в локальный день.
    expect(registeredAtToISO("05.10.2026 / 12:00")).toBe("2026-10-05");
    expect(registeredAtToISO("")).toBe("");
    expect(registeredAtToISO("—")).toBe("");
  });

  it("8g. incoming-journal list header has reports period button", async () => {
    warehouseService.list.mockResolvedValue({ data: [] });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    render(<WarehousePage initialSection="incoming-journal" />);
    expect(await screen.findByRole("button", { name: "Период документов" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Создать" })).toBeInTheDocument();
    // Календарь журнала — нежирный, как в отчётах: попап живёт внутри
    // dish-header-actions, где react-overrides ставит button 800.
    const whCss = readFileSync(`${process.cwd()}/src/styles/owner/warehouse.css`, "utf8");
    const journalRule = whCss.match(/\.warehouse-journal-page[^{]*\{[^}]*\}/g)?.find((rule) => rule.includes(".report-date-calendar-grid button")) || "";
    expect(journalRule).toMatch(/font-weight:\s*400/);
  });

  it("8f. stock period button shows range like reports", async () => {
    mockStock();
    render(<WarehousePage initialSection="stock" />);
    await screen.findByText("Главный склад");
    const pad = (value) => String(value).padStart(2, "0");
    const fmt = (dt) => `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()}`;
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const monStr = fmt(monday);
    const todayStr = fmt(now);
    fireEvent.click(screen.getByRole("button", { name: "Остатки на дату" }));
    fireEvent.click(await screen.findByRole("button", { name: "Эта неделя" }));
    fireEvent.click(screen.getByRole("button", { name: "ОК" }));
    // Кнопка — диапазоном, как в отчётах (а не одной датой).
    const trigger = screen.getByRole("button", { name: "Остатки на дату" });
    if (monStr === todayStr) {
      expect(trigger).toHaveTextContent(monStr);
    } else {
      expect(trigger).toHaveTextContent(`${monStr} – ${todayStr}`);
    }
    // Данные — текущие (конец недели = сегодня): Добавить на месте, среза нет.
    expect(screen.getByRole("button", { name: "Добавить" })).toBeInTheDocument();
    expect(screen.queryByText(/только просмотр/)).toBeNull();
    // Пресет подсвечен и после применения.
    fireEvent.click(trigger);
    expect(await screen.findByRole("button", { name: "Эта неделя" })).toHaveClass("is-active");
  });

  it("8d. detail header has period picker", async () => {
    mockStock();
    render(<WarehousePage initialSection="stock" warehouseId="wh-1" />);
    const detail = await screen.findByRole("table", { name: "Остаток склада Главный склад" });
    expect(detail).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Остатки на дату" })).toBeInTheDocument();
  });
});

describe("Warehouse incoming-journal (Добавить продуктов)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("10. shows warehouse fallback name and local registration time", async () => {
    // Журнал фильтруется периодом (по умолчанию Сегодня, как в отчётах) —
    // дата документа = сегодня, иначе строка скрыта фильтром.
    const pad0 = (value) => String(value).padStart(2, "0");
    const now0 = new Date();
    const todayApi0 = `${now0.getFullYear()}-${pad0(now0.getMonth() + 1)}-${pad0(now0.getDate())}`;
    const todayDMY0 = `${pad0(now0.getDate())}-${pad0(now0.getMonth() + 1)}-${now0.getFullYear()}`;
    // registered_at — сегодня в полдень UTC (локальный день совпадает при
    // любом разумном часовом поясе, как в 8e/8h).
    const regToday0 = `${pad0(now0.getDate())}.${pad0(now0.getMonth() + 1)}.${now0.getFullYear()} / 12:00`;
    warehouseService.list.mockResolvedValue({
      data: [{
        id: "doc-1",
        number: 7,
        supplier: "Анвар",
        warehouse_id: "wh-1",
        warehouse_name: null,
        date: todayApi0,
        registered_at: regToday0,
        items_count: 3,
        total_amount: 2400000,
        status: "draft",
        created_by_name: "admin",
      }],
    });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    render(<WarehousePage initialSection="incoming-journal" />);
    expect(await screen.findByRole("heading", { name: "Добавить продуктов" })).toBeInTheDocument();
    // Склад без названия подтягивается из справочника по id.
    expect(await screen.findByText("Главный склад")).toBeInTheDocument();
    // Дата поступления — в формате DD-MM-YYYY.
    expect(await screen.findByText(todayDMY0)).toBeInTheDocument();
    // UTC-строка backend показывается в часовом поясе веб-кабинета
    // (Asia/Tashkent, utils/webTime), а не в локальном поясе браузера:
    // у владельца и у сервера отчётов должен быть один день.
    const expected = webDateTime(new Date(Date.UTC(now0.getFullYear(), now0.getMonth(), now0.getDate(), 12, 0)));
    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it("11. row click navigates to document detail instead of expanding inline", async () => {
    const pad1 = (value) => String(value).padStart(2, "0");
    const now1 = new Date();
    const todayApi1 = `${now1.getFullYear()}-${pad1(now1.getMonth() + 1)}-${pad1(now1.getDate())}`;
    const regToday1 = `${pad1(now1.getDate())}.${pad1(now1.getMonth() + 1)}.${now1.getFullYear()} / 12:00`;
    warehouseService.list.mockResolvedValue({
      data: [{
        id: "doc-1",
        number: 7,
        supplier: "Анвар",
        warehouse_id: "wh-1",
        warehouse_name: "Главный склад",
        date: todayApi1,
        registered_at: regToday1,
        items_count: 2,
        total_amount: 2400000,
        status: "draft",
        created_by_name: "admin",
      }],
    });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    const onOpenDocDetail = vi.fn();
    render(<WarehousePage initialSection="incoming-journal" onOpenDocDetail={onOpenDocDetail} />);
    const row = (await screen.findByText("Анвар")).closest("tr");
    fireEvent.click(row);
    expect(onOpenDocDetail).toHaveBeenCalledWith("doc-1");
    // Под строкой ничего не раскрывается.
    expect(screen.queryByRole("table", { name: "Состав прихода 7" })).toBeNull();
    expect(warehouseService.getPurchase).not.toHaveBeenCalled();
  });

  it("12. detail view mirrors creation window with document lines only", async () => {
    warehouseService.getPurchase.mockResolvedValue({
      data: {
        id: "doc-1",
        number: 7,
        supplier: "Анвар",
        warehouse_id: "wh-1",
        warehouse_name: "Главный склад",
        date: "2026-10-08",
        total_amount: 220000,
        status: "draft",
        items: [
          { id: "li-1", ingredient_id: "ing-1", name: "kartoshka", quantity: "20.0000", unit: "кг", cost_price: "5000.0000", total: "100000.0000" },
          { id: "li-2", ingredient_id: null, name: "COCA COLA", quantity: 10, unit: "шт", cost_price: 12000, total: 120000 },
        ],
      },
    });
    warehouseService.listIngredients.mockResolvedValue({ data: ingredients });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    render(<WarehousePage initialSection="incoming-journal" detailDocId="doc-1" />);
    const table = await screen.findByRole("table", { name: "Создать приход" });
    // Только позиции документа, не весь каталог.
    expect(within(table).getByText("kartoshka")).toBeInTheDocument();
    expect(within(table).getByText("COCA COLA")).toBeInTheDocument();
    expect(within(table).queryByText("POMIDOR")).toBeNull();
    // Шапка документа.
    expect(screen.getByText("Анвар")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-10-08")).toBeInTheDocument();
    // Только просмотр: без кнопки Сохранить и без полей ввода — цифры
    // с суффиксами одной строкой (Decimal backend без хвоста и точки).
    expect(screen.queryByRole("button", { name: /Сохранить/ })).toBeNull();
    expect(screen.queryByLabelText("Цена kartoshka")).toBeNull();
    expect(screen.queryByLabelText("Количество kartoshka")).toBeNull();
    expect(screen.getByText("5 000 UZS")).toBeInTheDocument();
    expect(screen.getByText("20 кг")).toBeInTheDocument();
    expect(warehouseService.getPurchase).toHaveBeenCalledWith("doc-1");
  });

  it("12b. detail without items warns about stale backend instead of empty catalog", async () => {
    // Старый backend отдаёт документ без ключа items — показываем честную
    // плашку про обновление, а не «продукты не добавлены».
    warehouseService.getPurchase.mockResolvedValue({
      data: {
        id: "doc-2",
        number: 8,
        supplier: "Анвар",
        warehouse_id: "wh-1",
        warehouse_name: "Главный склад",
        date: "2026-10-08",
        status: "draft",
      },
    });
    warehouseService.listIngredients.mockResolvedValue({ data: ingredients });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    render(<WarehousePage initialSection="incoming-journal" detailDocId="doc-2" />);
    expect(await screen.findByText(/Состав документа недоступен/)).toBeInTheDocument();
    expect(screen.queryByText(/Продукты пока не добавлены/)).toBeNull();
  });

  it("13. create lists templates and sale goods with type column and own links", async () => {
    warehouseService.list.mockResolvedValue({ data: [] });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    nomenclatureService.listIngredients.mockResolvedValue({
      data: [
        { id: "ing-1", name: "kartoshka", category: "sabzavotlar", unit: "кг", purchase_price: 5000, is_active: true },
      ],
    });
    catalogService.listProducts.mockResolvedValue({
      data: [
        { id: "prod-1", name: "COCA COLA", category_name: "напитки", unit: "шт", price: 12000, product_type: "sale", is_active: true },
      ],
    });
    settingsService.listResource.mockResolvedValue({ data: [] });
    warehouseService.createPurchase.mockResolvedValue({ data: { id: "doc-9" } });
    const onClose = vi.fn();
    render(<WarehousePage initialSection="incoming-journal" startCreating onCloseCreate={onClose} />);
    const table = await screen.findByRole("table", { name: "Создать приход" });
    // Шаблоны (Продукт) и Товары-реализация (Товар) с колонкой Тип.
    expect(within(table).getByText("kartoshka")).toBeInTheDocument();
    expect(within(table).getByText("COCA COLA")).toBeInTheDocument();
    expect([...table.querySelectorAll("thead th")].map((th) => th.textContent))
      .toEqual(["Категория", "Названия", "Тип", "Цена", "Кол-во", "Итоговая сумма"]);
    // Склад обязателен: выбираем.
    fireEvent.click(screen.getByRole("combobox", { name: "Выбор склада" }));
    fireEvent.click(await screen.findByRole("option", { name: "Главный склад" }));
    // Количество без цены — сохранить нельзя.
    fireEvent.change(screen.getByLabelText("Количество kartoshka"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    expect(await screen.findByText("Укажите количество и цену хотя бы для одного продукта.")).toBeInTheDocument();
    expect(warehouseService.createPurchase).not.toHaveBeenCalled();
    // Продукт уходит со ссылкой на шаблон, Товар — со ссылкой на карточку
    // (шаблон backend автопривяжет сам).
    fireEvent.change(screen.getByLabelText("Цена kartoshka"), { target: { value: "4000" } });
    fireEvent.change(screen.getByLabelText("Количество COCA COLA"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Цена COCA COLA"), { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    await waitFor(() => expect(warehouseService.createPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        warehouse_id: "wh-1",
        items: [
          { name: "kartoshka", ingredient_id: "ing-1", quantity: 5, unit: "кг", cost_price: 4000 },
          { name: "COCA COLA", product_id: "prod-1", quantity: 10, unit: "шт", cost_price: 12000 },
        ],
      }),
    ));
    expect(onClose).toHaveBeenCalled();
  });

  it("13b. remembers last price only across sessions via localStorage (qty always empty)", async () => {
    nomenclatureService.listIngredients.mockResolvedValue({
      data: [
        { id: "m1", name: "Мясо", category: "овощи", unit: "кг", purchase_price: 90000, is_active: true },
      ],
    });
    catalogService.listProducts.mockResolvedValue({ data: [] });
    settingsService.listResource.mockResolvedValue({ data: [] });
    warehouseService.list.mockResolvedValue({ data: [] });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.createPurchase.mockResolvedValue({ data: { id: "doc-10" } });
    // Прошлая сессия: вчера для Мяса ввели цену 100 000 и кол-во 10.
    localStorage.setItem(
      "marjon:purchase-last-values:v1",
      JSON.stringify({ "ing-m1": { price: "100000", qty: "10", total: "" } }),
    );
    const onClose = vi.fn();
    render(<WarehousePage initialSection="incoming-journal" startCreating onCloseCreate={onClose} />);
    const table = await screen.findByRole("table", { name: "Создать приход" });
    expect(within(table).getByText("Мясо")).toBeInTheDocument();
    // Сегодня поле цены уже заполнено вчерашним значением, кол-во — пустое.
    expect(screen.getByLabelText("Цена Мясо").value).toBe("100 000");
    expect(screen.getByLabelText("Количество Мясо").value).toBe("");
    // Меняем на 110 000 × 30 и сохраняем.
    fireEvent.click(screen.getByRole("combobox", { name: "Выбор склада" }));
    fireEvent.click(await screen.findByRole("option", { name: "Главный склад" }));
    fireEvent.change(screen.getByLabelText("Цена Мясо"), { target: { value: "110000" } });
    fireEvent.change(screen.getByLabelText("Количество Мясо"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    await waitFor(() => expect(warehouseService.createPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          { name: "Мясо", ingredient_id: "m1", quantity: 30, unit: "кг", cost_price: 110000 },
        ],
      }),
    ));
    // Запомнилась только цена, кол-во для следующей сессии пустое.
    expect(JSON.parse(localStorage.getItem("marjon:purchase-last-values:v1"))).toMatchObject({
      "ing-m1": { price: "110000", qty: "" },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("13c. Enter in row inputs saves like the Сохранить button", async () => {
    nomenclatureService.listIngredients.mockResolvedValue({
      data: [
        { id: "ing-1", name: "kartoshka", category: "sabzavotlar", unit: "кг", purchase_price: 5000, is_active: true },
      ],
    });
    catalogService.listProducts.mockResolvedValue({ data: [] });
    settingsService.listResource.mockResolvedValue({ data: [] });
    warehouseService.list.mockResolvedValue({ data: [] });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.createPurchase.mockResolvedValue({ data: { id: "doc-11" } });
    const onClose = vi.fn();
    render(<WarehousePage initialSection="incoming-journal" startCreating onCloseCreate={onClose} />);
    await screen.findByRole("table", { name: "Создать приход" });
    fireEvent.click(screen.getByRole("combobox", { name: "Выбор склада" }));
    fireEvent.click(await screen.findByRole("option", { name: "Главный склад" }));
    fireEvent.change(screen.getByLabelText("Цена kartoshka"), { target: { value: "4000" } });
    const qty = screen.getByLabelText("Количество kartoshka");
    fireEvent.change(qty, { target: { value: "5" } });
    // Не-Enter клавиша не сохраняет.
    fireEvent.keyDown(qty, { key: "a" });
    expect(warehouseService.createPurchase).not.toHaveBeenCalled();
    // Enter — тот же Сохранить, что кнопка.
    fireEvent.keyDown(qty, { key: "Enter" });
    await waitFor(() => expect(warehouseService.createPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        warehouse_id: "wh-1",
        items: [
          { name: "kartoshka", ingredient_id: "ing-1", quantity: 5, unit: "кг", cost_price: 4000 },
        ],
      }),
    ));
    expect(onClose).toHaveBeenCalled();
  });

  it("17b. journal create opens inline without leaving the list", async () => {
    warehouseService.list.mockResolvedValue({ data: [] });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    nomenclatureService.listIngredients.mockResolvedValue({ data: [] });
    catalogService.listProducts.mockResolvedValue({ data: [] });
    settingsService.listResource.mockResolvedValue({ data: [] });
    render(<WarehousePage initialSection="incoming-journal" />);
    // Кнопка Создать открывает создание тем же маунтом (без onOpenCreate).
    fireEvent.click(await screen.findByRole("button", { name: "Создать" }));
    expect(await screen.findByRole("table", { name: "Создать приход" })).toBeInTheDocument();
    // Выход — назад топбара (history.back): возврат к списку той же подкатегории.
    window.history.back();
    expect(await screen.findByRole("button", { name: "Создать" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Создать приход" })).toBeNull();
  });

  it("18. journal period survives detail navigation within the section", async () => {    const pad = (value) => String(value).padStart(2, "0");
    const isoDay = (offset) => {
      const dt = new Date();
      dt.setDate(dt.getDate() - offset);
      return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    };
    const regDay = (offset) => {
      const dt = new Date();
      dt.setDate(dt.getDate() - offset);
      return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()} / 12:00`;
    };
    const doc = (id, number, supplier, dayOffset, total) => ({
      id, number, supplier, warehouse_id: "wh-1", warehouse_name: "Главный склад",
      date: isoDay(dayOffset), registered_at: regDay(dayOffset),
      items_count: 1, total_amount: total, status: "draft", created_by_name: "",
    });
    warehouseService.list.mockResolvedValue({
      data: [doc("d1", 1, "Анвар", 0, 1000), doc("d2", 2, "Бозор", 1, 2000)],
    });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.getPurchase.mockResolvedValue({
      data: {
        id: "d2", number: 2, supplier: "Бозор", warehouse_id: "wh-1",
        warehouse_name: "Главный склад", date: isoDay(1), total_amount: 2000, status: "draft",
        items: [{ id: "li-1", ingredient_id: "ing-1", name: "kartoshka", quantity: 2, unit: "кг", cost_price: 500 }],
      },
    });
    // Список и деталка — разные маунты (как роуты): key форсит перемонтирование.
    function Harness() {
      const [docId, setDocId] = useState(null);
      return (
        <>
          {docId ? <button type="button" onClick={() => setDocId(null)}>Назад в журнал</button> : null}
          <WarehousePage
            key={docId ? "detail" : "list"}
            initialSection="incoming-journal"
            {...(docId ? { detailDocId: docId } : { onOpenDocDetail: (id) => setDocId(id) })}
          />
        </>
      );
    }
    render(<Harness />);
    // По умолчанию Сегодня — виден только сегодняшний документ.
    expect(await screen.findByText("Анвар")).toBeInTheDocument();
    expect(screen.queryByText("Бозор")).toBeNull();
    // Ставим Вчера — видны оба.
    fireEvent.click(screen.getByRole("button", { name: "Период документов" }));
    fireEvent.click(await screen.findByRole("button", { name: "Вчера" }));
    fireEvent.click(screen.getByRole("button", { name: "ОК" }));
    expect(await screen.findByText("Бозор")).toBeInTheDocument();
    // Уходим в историю строки и возвращаемся назад.
    fireEvent.click(screen.getByText("Бозор").closest("tr"));
    expect(await screen.findByRole("table", { name: "Создать приход" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Назад в журнал" }));
    // Период не сбросился на Сегодня — вчерашний документ на месте.
    expect(await screen.findByText("Бозор")).toBeInTheDocument();
  });
});

describe("Warehouse inventory (Инвентаризация, V42)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const invCheck = (id, status = "draft") => ({
    id,
    warehouse_id: "wh-1",
    warehouse_name: "Главный склад",
    comment: "Пересчёт мяса",
    check_type: "Приход и расход учтены",
    status,
    created_by_name: "admin",
    created_at: new Date().toISOString(),
  });

  it("14. list shows check rows with create button and without actions", async () => {
    warehouseService.list.mockResolvedValue({ data: [invCheck("inv-1"), invCheck("inv-2", "accepted")] });
    render(<WarehousePage initialSection="inventory" />);
    const table = await screen.findByRole("table", { name: "Инвентаризация" });
    expect([...table.querySelectorAll("thead th")].map((th) => th.textContent))
      .toEqual(["№", "Склад", "Дата регистрации", "Комментарий"]);
    expect(within(table).getAllByText("Главный склад")).toHaveLength(2);
    expect(within(table).getAllByText("Пересчёт мяса")).toHaveLength(2);
    expect(within(table).queryByRole("button", { name: "Удалить инвентаризацию" })).toBeNull();
    expect(screen.getByRole("button", { name: "Период документов" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Создать" })).toBeInTheDocument();
  });

  it("14b. row click opens centered corrections (Дата регистрации / Название / Корректировка)", async () => {
    warehouseService.list.mockResolvedValue({ data: [invCheck("inv-1")] });
    warehouseService.getInventory.mockResolvedValue({ data: { items: [
      { id: "li-1", name: "Фанта", unit: "шт", stock_qty: "20.0000", actual_qty: "10.0000", diff_qty: "-10.0000" },
      { id: "li-2", name: "Соль", unit: "Гр", stock_qty: "0.0000", actual_qty: "19.0000", diff_qty: "19.0000" },
    ] } });
    render(<WarehousePage initialSection="inventory" />);
    const table = await screen.findByRole("table", { name: "Инвентаризация" });
    fireEvent.click(within(table).getAllByText("Главный склад")[0].closest("tr"));
    const modal = await screen.findByRole("table", { name: "Корректировки инвентаризации" });
    expect([...modal.querySelectorAll("thead th")].map((th) => th.textContent))
      .toEqual(["Дата регистрации", "Название", "Корректировка"]);
    expect(warehouseService.getInventory).toHaveBeenCalledWith("inv-1");
    expect(within(modal).getByText("Фанта")).toBeInTheDocument();
    expect(within(modal).getByText("Соль")).toBeInTheDocument();
    // Недостача красным, излишек зелёным.
    const minus = within(modal).getByText(/10 шт/);
    expect(minus).toHaveClass("is-minus");
    const plus = within(modal).getByText(/19 Гр/);
    expect(plus).toHaveClass("is-plus");
    // Дата регистрации проверки — в каждой строке.
    expect(within(modal).getAllByText(/\d{2}\.\d{2}\.\d{4} \/ \d{2}:\d{2}/).length).toBeGreaterThan(0);
    // Закрытие по Escape возвращает к списку.
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("table", { name: "Корректировки инвентаризации" })).toBeNull());
    expect(await screen.findByRole("table", { name: "Инвентаризация" })).toBeInTheDocument();
  });

  it("14c. corrections failure renders an error without fake rows", async () => {
    warehouseService.list.mockResolvedValue({ data: [invCheck("inv-1")] });
    warehouseService.getInventory.mockRejectedValue(new Error("offline"));
    render(<WarehousePage initialSection="inventory" />);
    const table = await screen.findByRole("table", { name: "Инвентаризация" });
    fireEvent.click(within(table).getAllByText("Главный склад")[0].closest("tr"));
    expect(await screen.findByText("Не удалось загрузить корректировки.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Корректировки инвентаризации" })).toBeNull();
  });

  it("14d. comment field saves through PATCH and reloads the list", async () => {
    warehouseService.list.mockResolvedValue({ data: [invCheck("inv-1")] });
    warehouseService.getInventory.mockResolvedValue({ data: { items: [
      { id: "li-1", name: "Фанта", unit: "шт", diff_qty: "-10.0000" },
    ] } });
    warehouseService.updateInventory.mockResolvedValue({ data: {} });
    render(<WarehousePage initialSection="inventory" />);
    const table = await screen.findByRole("table", { name: "Инвентаризация" });
    fireEvent.click(within(table).getAllByText("Главный склад")[0].closest("tr"));
    await screen.findByRole("table", { name: "Корректировки инвентаризации" });
    const field = screen.getByRole("textbox", { name: "Комментарий инвентаризации" });
    expect(field).toHaveValue("Пересчёт мяса");
    fireEvent.change(field, { target: { value: "Ночная проверка" } });
    const callsBefore = warehouseService.list.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(warehouseService.updateInventory).toHaveBeenCalledWith("inv-1", { comment: "Ночная проверка" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(warehouseService.list.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(warehouseService.list).toHaveBeenLastCalledWith("inventory", expect.anything());
  });

  it("14e. comment save failure keeps the modal with an error", async () => {
    warehouseService.list.mockResolvedValue({ data: [invCheck("inv-1")] });
    warehouseService.getInventory.mockResolvedValue({ data: { items: [] } });
    warehouseService.updateInventory.mockRejectedValue({ response: { data: { detail: "Нет прав." } } });
    render(<WarehousePage initialSection="inventory" />);
    const table = await screen.findByRole("table", { name: "Инвентаризация" });
    fireEvent.click(within(table).getAllByText("Главный склад")[0].closest("tr"));
    await screen.findByRole("table", { name: "Корректировки инвентаризации" });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Нет прав.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("14f. clearing the comment erases it through PATCH with an empty string", async () => {
    warehouseService.list.mockResolvedValue({ data: [invCheck("inv-1")] });
    warehouseService.getInventory.mockResolvedValue({ data: { items: [] } });
    warehouseService.updateInventory.mockResolvedValue({ data: {} });
    render(<WarehousePage initialSection="inventory" />);
    const table = await screen.findByRole("table", { name: "Инвентаризация" });
    fireEvent.click(within(table).getAllByText("Главный склад")[0].closest("tr"));
    await screen.findByRole("table", { name: "Корректировки инвентаризации" });
    const field = screen.getByRole("textbox", { name: "Комментарий инвентаризации" });
    expect(field).toHaveValue("Пересчёт мяса");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(warehouseService.updateInventory).toHaveBeenCalledWith("inv-1", { comment: "" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("15. create modal posts counted lines with warehouse and apply flag", async () => {
    warehouseService.list.mockResolvedValue({ data: [] });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.listStock.mockResolvedValue({
      data: [{ warehouse_id: "wh-1", ingredient_id: "ing-1", quantity: 100, cost_price: 1000, unit: "кг" }],
    });
    nomenclatureService.listIngredients.mockResolvedValue({ data: ingredients });
    catalogService.listProducts.mockResolvedValue({ data: [] });
    warehouseService.createInventory.mockResolvedValue({ data: { id: "inv-9" } });
    render(<WarehousePage initialSection="inventory" />);
    fireEvent.click(await screen.findByRole("button", { name: "Создать" }));
    expect(await screen.findByRole("heading", { name: "Создать инвентаризацию" })).toBeInTheDocument();
    // Переключателя сверху нет — расхождения всегда учитываются.
    expect(screen.queryByRole("switch")).toBeNull();
    // Склад обязателен.
    fireEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    expect(await screen.findByText("Выберите склад.")).toBeInTheDocument();
    expect(warehouseService.createInventory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("combobox", { name: "Склад инвентаризации" }));
    fireEvent.click(await screen.findByRole("option", { name: "Главный склад" }));
    // В таблице — только приходившее на склад или с остатком: POMIDOR
    // (без прихода и остатка) скрыт, kartoshka (остаток 100) на месте.
    expect(screen.queryByText("POMIDOR")).toBeNull();    // Факт без позиций — сохранить нельзя.
    fireEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    expect(await screen.findByText(/хотя бы для одной позиции/)).toBeInTheDocument();
    // 100 → 95: недостача 5 уйдёт в расход на бэкенде.
    fireEvent.change(screen.getByLabelText("Факт kartoshka"), { target: { value: "95" } });
    expect(await screen.findByText(/−5/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    await waitFor(() => expect(warehouseService.createInventory).toHaveBeenCalledWith(
      expect.objectContaining({
        warehouse_id: "wh-1",
        apply_to_stock: true,
        items: [{ ingredient_id: "ing-1", actual_qty: 95 }],
      }),
    ));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Создать инвентаризацию" })).toBeNull());
  });

  it("16. inventory card shows surplus purchases with warehouse detail", async () => {
    const pad = (value) => String(value).padStart(2, "0");
    const today = new Date();
    const isoToday = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const regToday = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()} / 12:00`;
    const doc = (id, number, supplier, whId, whName, total, status) => ({
      id, number, supplier, warehouse_id: whId, warehouse_name: whName,
      date: isoToday, registered_at: regToday,
      items_count: 1, total_amount: total,
      status, created_by_name: "",
    });
    warehouseService.list.mockResolvedValue({
      data: [
        doc("d1", 1, "Инвентаризация", "wh-1", "Главный склад", 50000, "accepted"),
        doc("d2", 2, "Анвар", "wh-1", "Главный склад", 100000, "accepted"),
      ],
    });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.getPurchase.mockImplementation(async (id) => {
      if (id !== "d1") return { data: { items: [] } };
      return { data: { items: [
        { id: "li-1", ingredient_id: "ing-1", product_id: null, name: "myaso", quantity: 5, unit: "кг", cost_price: 10000 },
      ] } };
    });
    warehouseService.listIngredients.mockResolvedValue({
      data: [{ id: "ing-1", name: "myaso", category: "gosht", unit: "кг" }],
    });
    render(<WarehousePage initialSection="incoming" />);
    // Излишек +5кг × 10 000 = 50 000 — только в карточке инвентаризации.
    const invTable = await screen.findByRole("table", { name: "Инвентаризация по складам" });
    const invRow = within(invTable).getByText("Главный склад").closest("tr");
    expect(invRow.textContent).toMatch(/50[\s\u00a0\u202f]*000 UZS/);
    expect(invRow.textContent).not.toMatch(/100[\s\u00a0\u202f]*000/);
    // Обычный приход живёт только в верхней таблице (fallback total→Продукт).
    // Верхняя таблица суммирует ВСЕ приходы: 50 000 излишков + 100 000 обычных.
    const primary = screen.getByRole("table", { name: "Приход по складам" });
    expect(within(primary).getByText("Главный склад").closest("tr").textContent)
      .toMatch(/150[\s\u00a0\u202f]*000 UZS/);
    // Клик — внутренний экран склада с излишками.
    fireEvent.click(await screen.findByRole("button", { name: "Открыть инвентаризацию склада Главный склад" }));
    const detail = await screen.findByRole("table", { name: "Инвентаризация склада Главный склад" });
    expect(within(detail).getByText("Всего")).toBeInTheDocument();
    expect(detail.textContent).toMatch(/50[\s\u00a0\u202f]*000 UZS/);
    expect(within(detail).queryByText("myaso")).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "Развернуть категорию продуктов gosht" }));
    expect(await within(detail).findByText("myaso")).toBeInTheDocument();
    // Кнопки «Назад» в шапке нет — возврат стрелкой топбара (popstate)
    // на главный экран «Приход товаров».
    expect(screen.queryByRole("button", { name: /назад/i })).toBeNull();
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByRole("table", { name: "Приход по складам" })).toBeInTheDocument();
  });

  it("17. expense inventory card shows shortage documents with warehouse detail", async () => {
    mockOutgoingReport(20000, 0, 10);
    const pad = (value) => String(value).padStart(2, "0");
    const today = new Date();
    const isoToday = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const regToday = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()} / 12:00`;
    const doc = (id, number, receiver, whId, whName, total, status) => ({
      id, number, receiver, warehouse_id: whId, warehouse_name: whName,
      date: isoToday, registered_at: regToday,
      items_count: 1, total_amount: total,
      status, created_by_name: "",
    });
    warehouseService.list.mockResolvedValue({
      data: [
        doc("e1", 1, "Инвентаризация", "wh-1", "Главный склад", 10000, "accepted"),
        doc("e2", 2, "Кухня", "wh-1", "Главный склад", 20000, "accepted"),
      ],
    });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.listIngredients.mockResolvedValue({
      data: [{ id: "ing-1", name: "kartoshka", category: "sabzavotlar", unit: "кг" }],
    });
    catalogService.listProducts.mockResolvedValue({ data: [] });
    warehouseService.getExpense.mockImplementation(async (id) => {
      if (id !== "e1") return { data: { items: [] } };
      return { data: { items: [
        { id: "li-1", ingredient_id: "ing-1", name: "kartoshka", quantity: 5, unit: "кг", cost_price: 2000 },
      ] } };
    });
    render(<WarehousePage initialSection="outgoing" />);
    // Недостача −5кг × 2 000 = 10 000 — только в карточке инвентаризации.
    const invTable = await screen.findByRole("table", { name: "Инвентаризация расходов по складам" });
    const invRow = within(invTable).getByText("Главный склад").closest("tr");
    expect(invRow.textContent).toMatch(/10[\s\u00a0\u202f]*000 UZS/);
    expect(invRow.textContent).not.toMatch(/20[\s\u00a0\u202f]*000/);
    // Верхняя таблица — ТОЛЬКО ручной расход без инвентаризации (20 000).
    // Недостача 10 000 живёт только в нижней карточке.
    const primary = screen.getByRole("table", { name: "Расход по складам" });
    expect(within(primary).getByText("Главный склад").closest("tr").textContent)
      .toMatch(/20[\s\u00a0\u202f]*000 UZS/);
    expect(within(primary).getByText("Главный склад").closest("tr").textContent)
      .not.toMatch(/30[\s\u00a0\u202f]*000/);
    // Кнопки «Создать» в карточках Прихода/Расхода нет.
    expect(screen.queryByRole("button", { name: "Создать" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Открыть инвентаризацию расходов склада Главный склад" }));
    const detail = await screen.findByRole("table", { name: "Инвентаризация склада Главный склад" });
    expect(within(detail).getByText("Всего")).toBeInTheDocument();
    expect(detail.textContent).toMatch(/10[\s\u00a0\u202f]*000 UZS/);
    fireEvent.click(within(detail).getByRole("button", { name: "Развернуть категорию продуктов sabzavotlar" }));
    expect(await within(detail).findByText("kartoshka")).toBeInTheDocument();
    // Кнопки «Назад» в шапке нет — возврат стрелкой топбара (popstate)
    // на главный экран «Расход товаров».
    expect(screen.queryByRole("button", { name: /назад/i })).toBeNull();
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByRole("table", { name: "Расход по складам" })).toBeInTheDocument();
  });

  it("19. modal shows one row per ingredient when sale product links to template", async () => {
    warehouseService.list.mockResolvedValue({ data: [] });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.listStock.mockResolvedValue({
      data: [{ warehouse_id: "wh-1", ingredient_id: "ing-1", quantity: 100, cost_price: 1000, unit: "шт" }],
    });
    nomenclatureService.listIngredients.mockResolvedValue({
      data: [{ id: "ing-1", name: "fanta", category: "napitki", unit: "шт" }],
    });
    catalogService.listProducts.mockResolvedValue({
      data: [{ id: "prod-1", name: "fanta", category_name: "napitki", unit: "шт", product_type: "sale", is_active: true }],
    });
    render(<WarehousePage initialSection="inventory" />);
    fireEvent.click(await screen.findByRole("button", { name: "Создать" }));
    expect(await screen.findByRole("heading", { name: "Создать инвентаризацию" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Склад инвентаризации" }));
    fireEvent.click(await screen.findByRole("option", { name: "Главный склад" }));
    // Один учёт — одна строка (Товар с привязкой), дубль-Продукт скрыт.
    expect(await screen.findAllByLabelText("Факт fanta")).toHaveLength(1);
  });
});

describe("Warehouse document details are batched (perf: 1 request instead of N)", () => {
  const pad = (value) => String(value).padStart(2, "0");
  const today = new Date();
  const isoToday = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const regToday = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()} / 12:00`;

  const purchaseDoc = (id, number, total) => ({
    id, number, supplier: `Поставщик ${number}`, warehouse_id: "wh-1", warehouse_name: "Главный склад",
    date: isoToday, registered_at: regToday,
    items_count: 1, total_amount: total, status: "accepted", created_by_name: "",
  });

  it("20. incoming summary calls listPurchaseDetails once and never per-document", async () => {
    warehouseService.list.mockResolvedValue({
      data: [purchaseDoc("d1", 1, 1000), purchaseDoc("d2", 2, 2000), purchaseDoc("d3", 3, 3000)],
    });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.listPurchaseDetails.mockResolvedValue({ data: [] });
    render(<WarehousePage initialSection="incoming" />);
    await screen.findByRole("table", { name: "Приход по складам" });
    await waitFor(() => expect(warehouseService.listPurchaseDetails).toHaveBeenCalled());
    // Ровно один запрос деталей на весь список — и ни одного поштучного.
    expect(warehouseService.listPurchaseDetails).toHaveBeenCalledTimes(1);
    expect(warehouseService.listPurchaseDetails).toHaveBeenCalledWith(["d1", "d2", "d3"]);
    expect(warehouseService.getPurchase).not.toHaveBeenCalled();
  });

  it("21. outgoing summary calls listExpenseDetails once and never per-document", async () => {
    mockOutgoingReport(0, 0, 0);
    warehouseService.list.mockResolvedValue({
      data: [1, 2, 3].map((n) => ({
        id: `e${n}`, number: n, receiver: `Получатель ${n}`,
        warehouse_id: "wh-1", warehouse_name: "Главный склад",
        date: isoToday, registered_at: regToday,
        items_count: 1, total_amount: n * 1000, status: "accepted", created_by_name: "",
      })),
    });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.listExpenseDetails.mockResolvedValue({ data: [] });
    render(<WarehousePage initialSection="outgoing" />);
    await screen.findByRole("table", { name: "Расход по складам" });
    await waitFor(() => expect(warehouseService.listExpenseDetails).toHaveBeenCalled());
    expect(warehouseService.listExpenseDetails).toHaveBeenCalledTimes(1);
    expect(warehouseService.listExpenseDetails).toHaveBeenCalledWith(["e1", "e2", "e3"]);
    expect(warehouseService.getExpense).not.toHaveBeenCalled();
  });

  it("22. classification is not truncated: документ №80 за прежним лимитом 60 всё ещё Товар", async () => {
    // Раньше брали slice(0, 60) — приход с product_id на 80-м месте молча
    // считался Продуктом. Батч отдаёт все документы, поэтому признак верный.
    const docs = Array.from({ length: 80 }, (_, i) => purchaseDoc(`d${i + 1}`, i + 1, 1000));
    warehouseService.list.mockResolvedValue({ data: docs });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.listPurchaseDetails.mockResolvedValue({
      data: docs.map((doc) => ({
        ...doc,
        items: doc.id === "d80"
          ? [{ id: "li-80", ingredient_id: "ing-1", product_id: "prod-1", name: "fanta", quantity: 1, unit: "шт", cost_price: 1000 }]
          : [],
      })),
    });
    warehouseService.listIngredients.mockResolvedValue({
      data: [{ id: "ing-1", name: "fanta", category: "napitki", unit: "шт" }],
    });
    catalogService.listProducts.mockResolvedValue({ data: [] });
    render(<WarehousePage initialSection="incoming" />);
    const table = await screen.findByRole("table", { name: "Приход по складам" });
    // Все 80 документов ушли одним запросом.
    await waitFor(() => expect(warehouseService.listPurchaseDetails).toHaveBeenCalledTimes(1));
    expect(warehouseService.listPurchaseDetails.mock.calls[0][0]).toHaveLength(80);
    // ing-1 распознан как Товар → сумма документа №80 попала в колонку
    // «Товар» (индекс 3), а не растворилась в «Продукте».
    await waitFor(() => {
      const row = within(table).getByText("Главный склад").closest("tr");
      const cells = [...row.querySelectorAll("td")].map((td) => td.textContent.trim());
      expect(cells[3]).toMatch(/1[\s\u00a0\u202f]*000 UZS/);
      expect(cells[2]).toMatch(/79[\s\u00a0\u202f]*000 UZS/);
    });
  });

  it("23. inventory modal loads purchase history with one batch request", async () => {
    warehouseService.list.mockResolvedValue({
      data: [purchaseDoc("d1", 1, 1000), purchaseDoc("d2", 2, 2000)],
    });
    warehouseService.listWarehouses.mockResolvedValue({ data: warehouses });
    warehouseService.listStock.mockResolvedValue({
      data: [{ warehouse_id: "wh-1", ingredient_id: "ing-1", quantity: 100, cost_price: 1000, unit: "шт" }],
    });
    nomenclatureService.listIngredients.mockResolvedValue({
      data: [{ id: "ing-1", name: "fanta", category: "napitki", unit: "шт" }],
    });
    catalogService.listProducts.mockResolvedValue({ data: [] });
    warehouseService.listPurchaseDetails.mockResolvedValue({
      data: [
        { id: "d1", items: [{ id: "li-1", ingredient_id: "ing-1", quantity: 5, unit: "шт", cost_price: 1000 }] },
        { id: "d2", items: [{ id: "li-2", ingredient_id: "ing-1", quantity: 7, unit: "шт", cost_price: 1000 }] },
      ],
    });
    render(<WarehousePage initialSection="inventory" />);
    fireEvent.click(await screen.findByRole("button", { name: "Создать" }));
    expect(await screen.findByRole("heading", { name: "Создать инвентаризацию" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Склад инвентаризации" }));
    fireEvent.click(await screen.findByRole("option", { name: "Главный склад" }));
    // История приходов — один запрос на все документы, ни одного поштучного.
    await waitFor(() => expect(warehouseService.listPurchaseDetails).toHaveBeenCalled());
    expect(warehouseService.listPurchaseDetails).toHaveBeenCalledTimes(1);
    expect(warehouseService.listPurchaseDetails.mock.calls[0][0].sort()).toEqual(["d1", "d2"]);
    expect(warehouseService.getPurchase).not.toHaveBeenCalled();
    // Позиция из истории приходов доступна для пересчёта.
    expect(await screen.findByLabelText("Факт fanta")).toBeInTheDocument();
  });
});
