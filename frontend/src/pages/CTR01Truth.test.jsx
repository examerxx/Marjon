import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import CancelledDishesReportPage from "./CancelledDishesReportPage";
import DebtorsCreditorsReportPage from "./DebtorsCreditorsReportPage";
import FinanceTransactionsPage from "./FinanceTransactionsPage";
import OrdersReportPage from "./OrdersReportPage";
import OwnerDashboard from "./OwnerDashboard";
import TablesReportPage from "./TablesReportPage";
import WaitersReportPage from "./WaitersReportPage";
import ZReportPage, { formatZReportPeriodLabel, validateZReportPeriod } from "./ZReportPage";

vi.mock("../api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  formatMoney: (value, currency = "UZS") => `${Number(value).toLocaleString("ru-RU")} ${currency}`,
  formatNumber: (value) => Number(value).toLocaleString("ru-RU"),
}));

vi.mock("../utils/excel", () => ({ exportToExcel: vi.fn() }));

vi.mock("../components/ReportDateRangePicker", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: ({ value, onChange }) => (
      <div>
        <input aria-label="Начало периода" value={value?.start || ""} onChange={(event) => onChange({ ...value, start: event.target.value })} />
        <input aria-label="Конец периода" value={value?.end || ""} onChange={(event) => onChange({ ...value, end: event.target.value })} />
      </div>
    ),
  };
});

vi.mock("react-router-dom", () => ({
  Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
  useOutletContext: () => ({ selectedDate: "2026-08-12" }),
}));

vi.mock("chart.js", () => {
  class ChartMock {
    static register = vi.fn();
    destroy() {}
  }
  return { Chart: ChartMock, CategoryScale: {}, Filler: {}, LineController: {}, LineElement: {}, LinearScale: {}, PointElement: {}, Tooltip: {} };
});

const zReport = {
  date: "2026-08-12",
  shift_opened_at: null,
  shift_closed_at: null,
  is_closed: false,
  orders_count: 2,
  cancelled_orders_count: 1,
  payments_count: 2,
  fiscal_receipts_count: 1,
  gross_sales: 123456,
  discounts_total: 0,
  service_fee_total: 0,
  tax_total: 0,
  refunds_total: 0,
  net_sales: 123456,
  cash_total: 23456,
  cash_received_total: 25000,
  change_given_total: 1544,
  non_cash_total: 100000,
  avg_check: 61728,
  payment_methods: [{ method: "Backend card", amount: 100000, count: 1 }],
};

function financeGet(path) {
  if (path === "/finance/transactions") return Promise.resolve({ data: { items: [{ id: "tx-1", date: "2026-08-12T10:00:00Z", amount: 700, direction: "income", payment_type_id: "pay-1", counterparty_id: "cp-1", category_id: "cat-1", finance_template_id: "tpl-1", comment: "Backend transaction" }] } });
  if (path === "/finance/payment-types") return Promise.resolve({ data: { items: [{ id: "pay-1", name: "Backend payment" }] } });
  if (path === "/finance/transaction-categories") return Promise.resolve({ data: { items: [{ id: "cat-1", name: "Backend income", kind: "income" }, { id: "cat-2", name: "Backend expense", kind: "expense" }] } });
  if (path === "/finance/counterparties") return Promise.resolve({ data: { items: [{ id: "cp-1", full_name: "Backend counterparty" }] } });
  return Promise.resolve({ data: [] });
}

describe("CTR-01 critical financial truth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: [] });
    api.post.mockResolvedValue({ data: {} });
    api.patch.mockResolvedValue({ data: {} });
  });

  // ALIGNMENT-03: the whole-shift "Печать общего Z-отчёта" action was removed, so
  // this page no longer loads /analytics/z-report at all. Per-entity print is the
  // only print here, and its request semantics (date vs date_from/date_to) are
  // pinned in ZReportPage.test.jsx against /analytics/z-report/detail.
  it("no longer loads the general Z-report or offers a whole-shift print", async () => {
    api.get.mockResolvedValue({ data: zReport });
    render(<ZReportPage />);
    await screen.findByRole("button", { name: "Отчёт по официантам" });

    expect(screen.queryByRole("button", { name: /Печать общего Z-отчёта/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Начало периода"), { target: { value: "01.08.2026" } });
    fireEvent.change(screen.getByLabelText("Конец периода"), { target: { value: "31.08.2026" } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/auth/staff-users", expect.anything()));
    expect(api.get.mock.calls.some((call) => call[0] === "/analytics/z-report")).toBe(false);
    expect(screen.queryByText(/Смена закрыта/)).not.toBeInTheDocument();
  });

  it("formats and validates the applied Z-report period", () => {
    expect(formatZReportPeriodLabel({ start: "24.08.2026", end: "24.08.2026" })).toBe("24.08.2026");
    expect(formatZReportPeriodLabel({ start: "01.08.2026", end: "24.08.2026" })).toBe("01.08.2026 – 24.08.2026");
    expect(validateZReportPeriod({ start: "24.08.2026", end: "23.08.2026" })).toMatch(/начала/);
    expect(validateZReportPeriod({ start: "01.08.2026", end: "24.08.2026" })).toBe("");
  });

  it("enables the waiter percentage only while a waiter is selected", async () => {
    api.get.mockImplementation((path) => {
      if (path === "/analytics/z-report") return Promise.resolve({ data: zReport });
      if (path === "/auth/staff-users") return Promise.resolve({ data: [{ id: "waiter-1", name: "Backend Waiter", role_slugs: ["waiter"] }] });
      return Promise.resolve({ data: [] });
    });
    render(<ZReportPage />);

    const percent = screen.getByRole("spinbutton", { name: "Процент официанта" });
    expect(percent).toBeDisabled();
    fireEvent.click(await screen.findByRole("button", { name: "Отчёт по официантам" }));
    fireEvent.click(screen.getByRole("option", { name: "Backend Waiter" }));
    expect(percent).toBeEnabled();
    fireEvent.change(percent, { target: { value: "15" } });
    expect(percent).toHaveValue(15);
    fireEvent.click(screen.getByRole("option", { name: "Backend Waiter" }));
    expect(percent).toBeDisabled();
  });

  it("preserves real dashboard finance amounts without fabricated finance deltas", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
    });
    api.get.mockImplementation((path) => {
      if (path === "/analytics/dashboard") return Promise.resolve({ data: { today_revenue: 1000, today_orders: 2, avg_check: 500, active_orders: 1 } });
      if (path === "/analytics/sales") return Promise.resolve({ data: [{ date: "2026-08-11", revenue: 800, orders_count: 2, avg_check: 400 }, { date: "2026-08-12", revenue: 1000, orders_count: 2, avg_check: 500 }] });
      if (path === "/finance/transactions") return Promise.resolve({ data: { items: [{ id: "income", direction: "income", amount: 700 }, { id: "expense", direction: "expense", amount: 200 }] } });
      return Promise.resolve({ data: [] });
    });
    render(<OwnerDashboard />);

    const incomeCard = (await screen.findByText("Денежный приход")).closest("button");
    const expenseCard = screen.getByText("Денежные расходы").closest("button");
    expect(incomeCard).toHaveTextContent("700");
    expect(expenseCard).toHaveTextContent("200");
    expect(within(incomeCard).queryByText(/к вчерашнему дню/)).not.toBeInTheDocument();
    expect(within(expenseCard).queryByText(/к вчерашнему дню/)).not.toBeInTheDocument();
  });

  it("renders only frozen Orders report fields", async () => {
    api.get.mockResolvedValue({ data: [{ order_id: "order-1", order_number: "42", created_at: "2026-08-12T10:00:00Z", status: "completed", table_number: "7", waiter_name: "Backend Waiter", items_count: 3, total_amount: 900 }] });
    render(<OrdersReportPage />);
    expect((await screen.findAllByText("Backend Waiter")).length).toBeGreaterThan(0);
    ["Клиент", "Курьер", "Цена товаров", "Цена места", "Скидка", "Цена доставки", "Цена обслуживания", "Тип заказа"].forEach((label) => expect(screen.queryByRole("columnheader", { name: label })).not.toBeInTheDocument());
    expect(screen.getByRole("columnheader", { name: "Количество позиций" })).toBeInTheDocument();
  });

  it("renders only table_number, orders_count, revenue, and avg_check in Tables report", async () => {
    api.get.mockResolvedValue({ data: [{ table_number: "9", orders_count: 4, revenue: 1200, avg_check: 300 }] });
    render(<TablesReportPage />);
    expect(await screen.findByText("9")).toBeInTheDocument();
    ["Цена обслуживания", "Скидка", "Цена места", "Сумма блюд", "Транзакции", "Действие"].forEach((label) => expect(screen.queryByRole("columnheader", { name: label })).not.toBeInTheDocument());
    expect(screen.getByRole("columnheader", { name: "Средний чек" })).toBeInTheDocument();
  });

  it("renders only authoritative waiter aggregates and no invented zero columns", async () => {
    api.get.mockResolvedValue({ data: [{ waiter_id: "waiter-1", name: "Backend Waiter", orders_count: 4, orders_total: 1200, dishes_count: 8 }] });
    render(<WaitersReportPage />);
    expect((await screen.findAllByText("Backend Waiter")).length).toBe(2);
    ["Сумма заказов на вынос", "Сумма услуги", "Обслуга официанта", "Процент"].forEach((label) => expect(screen.queryByText(label)).not.toBeInTheDocument());
    expect(screen.getByRole("columnheader", { name: "Количество заказов" })).toBeInTheDocument();
  });

  it("renders and exports only frozen cancelled-item metadata", async () => {
    api.get.mockResolvedValue({ data: [{ date: "2026-08-12", time: "10:00", order_number: "42", table_number: null, name: "Backend Dish", quantity: 2, price: 300, waiter_name: null, unit: "шт" }] });
    render(<CancelledDishesReportPage />);
    expect(await screen.findByText("Backend Dish")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Сумма" })).not.toBeInTheDocument();
    ["Комментарий", "Тип", "Повар", "Автор"].forEach((label) => expect(screen.queryByRole("columnheader", { name: label })).not.toBeInTheDocument());
    expect(screen.queryByText("На стол")).not.toBeInTheDocument();
  });

  it("keeps the Cancelled Dishes period as draft until the existing Filter action", async () => {
    api.get.mockResolvedValue({ data: [] });
    render(<CancelledDishesReportPage />);
    const filterButton = await screen.findByRole("button", { name: "Фильтровать" });
    expect(api.get).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Начало периода"), { target: { value: "02.08.2026" } });
    fireEvent.change(screen.getByLabelText("Конец периода"), { target: { value: "12.08.2026" } });
    expect(api.get).toHaveBeenCalledTimes(1);

    fireEvent.click(filterButton);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(api.get).toHaveBeenLastCalledWith("/reports/cancelled", expect.objectContaining({
      params: { date_from: "2026-08-02", date_to: "2026-08-12" },
      signal: expect.any(AbortSignal),
    }));
  });

  it("uses date_from/date_to and counterparty_id for Debt/Credit without FX conversion", async () => {
    api.get.mockResolvedValue({ data: [{ counterparty_id: "cp-real", counterparty_name: "Backend Counterparty", opening_balance: 100, debit: 200, credit: 50, closing_balance: 250 }] });
    render(<DebtorsCreditorsReportPage />);
    const row = await screen.findByText("Backend Counterparty");
    expect(row.closest("tr")).toHaveAttribute("data-counterparty-id", "cp-real");
    // TEST-SAFETY: set Начало BEFORE Конец. Setting the end first left the
    // intermediate range inverted whenever the current month starts after the
    // hard-coded end (e.g. any day in September vs 12.08), which tripped the
    // page's own start>end guard. Production behaviour is unchanged.
    fireEvent.change(screen.getByLabelText("Начало периода"), { target: { value: "02.08.2026" } });
    await screen.findByText("Backend Counterparty");
    fireEvent.change(screen.getByLabelText("Конец периода"), { target: { value: "12.08.2026" } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/reports/debt-credit", expect.objectContaining({ params: { date_from: "2026-08-02", date_to: "2026-08-12" }, signal: expect.any(AbortSignal) })));
    expect(screen.queryByText("USD")).not.toBeInTheDocument();
  });

  it("sends the finance date range/direction, joins UUID dictionaries, and patches only supported fields", async () => {
    api.get.mockImplementation(financeGet);
    render(<FinanceTransactionsPage />);
    expect(await screen.findByText("Backend payment")).toBeInTheDocument();
    expect(screen.getByText("Backend counterparty")).toBeInTheDocument();
    expect(screen.getByText("Backend income")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Начало периода"), { target: { value: "02.08.2026" } });
    fireEvent.change(screen.getByLabelText("Конец периода"), { target: { value: "12.08.2026" } });
    fireEvent.change(screen.getByLabelText("Направление"), { target: { value: "income" } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/finance/transactions", expect.objectContaining({ params: { date_from: "2026-08-02", date_to: "2026-08-12", direction: "income" }, signal: expect.any(AbortSignal) })));

    fireEvent.click(screen.getByRole("button", { name: "Редактировать транзакцию tx-1" }));
    expect(screen.queryByLabelText("Дата")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Валюта")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Тип оплаты/)).toBeDisabled();
    expect(screen.getByLabelText(/Контрагент/)).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Сумма, UZS"), { target: { value: "800" } });
    fireEvent.change(screen.getByLabelText("Тип операции"), { target: { value: "expense" } });
    fireEvent.change(screen.getByLabelText("Категория"), { target: { value: "cat-2" } });
    fireEvent.change(screen.getByLabelText("Комментарий"), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/finance/transactions/tx-1", { amount: 800, direction: "expense", comment: "Updated", category_id: "cat-2", finance_template_id: "tpl-1" }));
  });

  it("keeps failed finance edits open and never claims success", async () => {
    api.get.mockImplementation(financeGet);
    api.patch.mockRejectedValue({ response: { data: { detail: "Backend rejected update" } } });
    render(<FinanceTransactionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Редактировать транзакцию tx-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Backend rejected update");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps finance create on the exact supported contract", async () => {
    api.get.mockImplementation(financeGet);
    render(<FinanceTransactionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /ПРИХОД/ }));
    fireEvent.change(screen.getByLabelText("Сумма, UZS"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Тип оплаты"), { target: { value: "pay-1" } });
    fireEvent.change(screen.getByLabelText("Контрагент"), { target: { value: "cp-1" } });
    fireEvent.change(screen.getByLabelText("Категория"), { target: { value: "cat-1" } });
    fireEvent.change(screen.getByLabelText("Комментарий"), { target: { value: "Created" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/finance/transactions",
      { amount: 500, direction: "income", comment: "Created", category_id: "cat-1", payment_type_id: "pay-1", counterparty_id: "cp-1" },
      { headers: { "Idempotency-Key": expect.stringMatching(/^owner-finance-/) } },
    ));
  });

  it("contains no scoped fake markers or unsupported report mappings in production sources", () => {
    const sources = Object.fromEntries(["ZReportPage.jsx", "OwnerDashboard.jsx", "OrdersReportPage.jsx", "TablesReportPage.jsx", "WaitersReportPage.jsx", "CancelledDishesReportPage.jsx", "DebtorsCreditorsReportPage.jsx", "FinanceTransactionsPage.jsx"].map((name) => [name, readFileSync(`${process.cwd()}/src/pages/${name}`, "utf8")]));
    expect(sources["ZReportPage.jsx"]).not.toMatch(/КАССА 2|Khusniddin|Administrator|Кассир 1|Повар 1/);
    expect(sources["OwnerDashboard.jsx"]).not.toContain("const incomeChange");
    expect(sources["OwnerDashboard.jsx"]).not.toContain("const expenseChange");
    expect(sources["OwnerDashboard.jsx"]).not.toContain("prevIncome * 0.31");
    expect(sources["OrdersReportPage.jsx"]).not.toMatch(/goodsPrice|servicePrice|deliveryPrice|client_name|courier_name|order_type \|\|/);
    expect(sources["TablesReportPage.jsx"]).not.toMatch(/service_price|discount|place_price|dishes_amount/);
    expect(sources["WaitersReportPage.jsx"]).not.toMatch(/takeaway|waiterService|service_total|percent/i);
    expect(sources["CancelledDishesReportPage.jsx"]).not.toMatch(/order_type|chef|author|comment|На стол/);
    expect(sources["DebtorsCreditorsReportPage.jsx"]).not.toMatch(/12650|USD|item\.id/);
  });
});
