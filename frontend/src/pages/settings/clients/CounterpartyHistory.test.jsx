import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { financeService } from "../../../api/finance";
import {
  aggregateByDay,
  CounterpartyStatementView,
  directionLabel,
  formatTxDate,
  normalizeClientOrder,
  turnover,
} from "./CounterpartyHistory";

vi.mock("../../../api/finance", () => ({
  financeService: {
    listCounterpartyTransactions: vi.fn(),
    listCounterpartyOrders: vi.fn(),
  },
}));

// Чек — отдельный тяжёлый диалог (свой контекст организации и запросы).
// В тесте карточки клиента проверяем только факт открытия и переданный заказ.
vi.mock("../../dashboard/OrderReceiptDialog", () => ({
  default: ({ orderId, orderNumber }) => (
    <div data-testid="receipt-dialog">{`чек ${orderNumber} / ${orderId}`}</div>
  ),
}));

const TX = [
  { id: "t1", date: "2026-09-20T10:00:00", amount: 100000, direction: "income", comment: "Оплата" },
  { id: "t2", date: "2026-09-20T15:00:00", amount: 40000, direction: "expense", comment: "" },
  { id: "t3", date: "2026-09-21T09:00:00", amount: 25000, direction: "income", comment: null },
];

const ORDER_ROWS = [
  {
    order_id: "o-1",
    order_number: "3",
    created_at: "2026-09-20T12:30:00",
    status: "completed",
    items_count: 4,
    total_amount: "156800",
    paid_amount: "0",
    debt_amount: "156800",
    payment_methods: [],
    waiter_name: null,
  },
  {
    order_id: "o-2",
    order_number: "5",
    created_at: "2026-09-21T18:05:00",
    status: "completed",
    items_count: 1,
    total_amount: "39200",
    paid_amount: "39200",
    debt_amount: "0",
    payment_methods: ["cash"],
    waiter_name: null,
  },
];

function mockPages(pages) {
  const queue = [...pages];
  financeService.listCounterpartyTransactions.mockImplementation(() => {
    const page = queue.shift() || { items: [], total: 0 };
    return Promise.resolve({ data: { ...page, page: 1, size: 200, pages: 1 } });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  financeService.listCounterpartyOrders.mockResolvedValue({ data: [] });
});

describe("counterparty history helpers", () => {
  it("labels directions without accounting claims", () => {
    expect(directionLabel("income")).toBe("Приход");
    expect(directionLabel("expense")).toBe("Расход");
  });

  it("formats dates and tolerates garbage", () => {
    expect(formatTxDate("2026-09-20T10:00:00")).toContain("20.09.2026");
    expect(formatTxDate("")).toBe("-");
  });

  it("aggregates days deterministically", () => {
    const days = aggregateByDay(TX);
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ income: 100000, expense: 40000, count: 2 });
    expect(turnover(TX)).toMatchObject({ income: 125000, expense: 40000, count: 3 });
  });

  it("normalizes a backend order row", () => {
    expect(normalizeClientOrder(ORDER_ROWS[0])).toMatchObject({
      id: "o-1",
      orderNumber: "3",
      itemsCount: 4,
      totalAmount: 156800,
      paidAmount: 0,
      debtAmount: 156800,
    });
  });
});

describe("CounterpartyStatementView (поставщик: транзакции)", () => {
  const row = { id: "cp-1", name: "Test Client", phone: "+998901112233", type: "suppliers" };

  it("fetches with server date filter and renders detailed rows", async () => {
    mockPages([{ items: TX, total: 3 }]);
    render(<CounterpartyStatementView row={row} onBack={() => {}} />);
    await waitFor(() => expect(financeService.listCounterpartyTransactions).toHaveBeenCalled());
    const [, params] = financeService.listCounterpartyTransactions.mock.calls[0];
    expect(params).toMatchObject({ page: 1, size: 200 });
    expect(params.date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.date_to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByText("Оплата")).toBeInTheDocument();
    expect(screen.getByText(/Обороты за период/)).toBeInTheDocument();
    // Заказы запрашиваем только у клиентов.
    expect(financeService.listCounterpartyOrders).not.toHaveBeenCalled();
  });

  it("shows an illustrated empty state without sample rows", async () => {
    mockPages([{ items: [], total: 0 }]);
    const { container } = render(<CounterpartyStatementView row={row} onBack={() => {}} />);
    expect(await screen.findByText("Нет транзакций за выбранный период")).toBeInTheDocument();
    expect(container.querySelector(".owner-report-empty-image")).not.toBeNull();
    expect(screen.queryByText("Оплата")).toBeNull();
  });

  it("shows an error state when the API fails", async () => {
    financeService.listCounterpartyTransactions.mockRejectedValue(
      Object.assign(new Error("boom"), { response: { data: { detail: "Сервис недоступен" } } }),
    );
    render(<CounterpartyStatementView row={row} onBack={() => {}} />);
    expect(await screen.findByText("Сервис недоступен")).toBeInTheDocument();
  });

  it("reuses the Reports date-period picker and reloads on period apply", async () => {
    mockPages([{ items: TX, total: 3 }]);
    const { container } = render(<CounterpartyStatementView row={row} onBack={() => {}} />);
    await screen.findByText("Оплата");
    expect(container.querySelector(".report-period-picker")).not.toBeNull();
    const { getByRole, getByText } = within(container);
    fireEvent.click(getByRole("button", { name: "Период" }));
    fireEvent.click(getByText("Этот месяц"));
    fireEvent.click(getByRole("button", { name: "ОК" }));
    await waitFor(() => expect(financeService.listCounterpartyTransactions).toHaveBeenCalledTimes(2));
    const [, params] = financeService.listCounterpartyTransactions.mock.calls[1];
    expect(params.date_from).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it("has no counterparty filter and no fabricated document links", async () => {
    mockPages([{ items: TX, total: 3 }]);
    const { container } = render(<CounterpartyStatementView row={row} onBack={() => {}} />);
    await screen.findByText("Оплата");
    expect(container.querySelectorAll("select").length).toBe(0);
    expect(container.querySelectorAll('table a[href]').length).toBe(0);
    expect(screen.queryByText(/Продажа №/)).toBeNull();
    expect(screen.queryByText(/Дебет/)).toBeNull();
    expect(screen.queryByText("Сальдо начальное")).toBeNull();
    expect(screen.queryByText("Сальдо конечное")).toBeNull();
  });

  it("has NO local back button — the topbar Back owns the return", async () => {
    mockPages([{ items: [], total: 0 }]);
    render(<CounterpartyStatementView row={row} onBack={() => {}} />);
    await screen.findByText("История транзакций");
    expect(screen.queryByText("Акт сверки")).toBeNull();
    expect(screen.queryByText((_, element) => element?.textContent?.startsWith("за период:"))).toBeNull();
    expect(screen.queryByRole("button", { name: /Назад/ })).toBeNull();
    expect(screen.queryByText("← Клиенты")).toBeNull();
    expect(screen.queryByText("Клиенты")).toBeNull();
  });

  it("renders history inside the shared settings-card shell", async () => {
    mockPages([{ items: [], total: 0 }]);
    const { container } = render(<CounterpartyStatementView row={row} onBack={() => {}} />);
    await screen.findByText("История транзакций");
    expect(container.querySelector(".settings-card")).not.toBeNull();
    expect(container.querySelector(".client-statement-card")).toBeNull();
    expect(container.querySelector(".settings-header .settings-title-group")).not.toBeNull();
    expect(screen.getByText("История транзакций")).toBeInTheDocument();
  });
});

describe("CounterpartyStatementView (клиент: заказы)", () => {
  const row = { id: "cp-2", name: "Абдуманноп", phone: "+998901112233", type: "clients" };

  it("shows the client's orders instead of an empty transaction list", async () => {
    mockPages([{ items: [], total: 0 }]);
    financeService.listCounterpartyOrders.mockResolvedValue({ data: ORDER_ROWS });
    const { container } = render(<CounterpartyStatementView row={row} />);

    expect(await screen.findByText("Заказы клиента")).toBeInTheDocument();
    // Оба заказа в таблице: номер, сумма и остаток долга по неоплаченному.
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    // Неоплаченный заказ показывает остаток долга красным.
    const debtCell = container.querySelector(".client-statement-debt.is-debt");
    expect(debtCell).toHaveTextContent("156 800 UZS");
    expect(container.querySelectorAll(".client-statement-order-row")).toHaveLength(2);
    // Пустое состояние «нет транзакций» больше не показывается.
    expect(screen.queryByText("Нет транзакций за выбранный период")).toBeNull();
    expect(screen.queryByText("Нет заказов за выбранный период")).toBeNull();
    // Итоги по заказам.
    expect(screen.getByText(/Заказов:/)).toBeInTheDocument();
    expect(screen.getByText(/Долг 156 800 UZS/)).toBeInTheDocument();

    const [, params] = financeService.listCounterpartyOrders.mock.calls[0];
    expect(params.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("opens the order receipt on row click", async () => {
    mockPages([{ items: [], total: 0 }]);
    financeService.listCounterpartyOrders.mockResolvedValue({ data: ORDER_ROWS });
    const { container } = render(<CounterpartyStatementView row={row} />);
    await waitFor(() => expect(container.querySelectorAll(".client-statement-order-row")).toHaveLength(2));
    expect(screen.queryByTestId("receipt-dialog")).toBeNull();
    fireEvent.click(container.querySelectorAll(".client-statement-order-row")[0]);
    expect(await screen.findByTestId("receipt-dialog")).toHaveTextContent("чек 3 / o-1");
  });

  it("has no Simple/Detailed toggle any more", async () => {
    mockPages([{ items: [], total: 0 }]);
    financeService.listCounterpartyOrders.mockResolvedValue({ data: ORDER_ROWS });
    const { container } = render(<CounterpartyStatementView row={row} />);
    await screen.findByText("Заказы клиента");
    expect(screen.queryByRole("button", { name: "Простой" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Подробный" })).toBeNull();
    expect(container.querySelector(".staff-tabs")).toBeNull();
  });

  it("keeps manual finance operations as a second block when they exist", async () => {
    mockPages([{ items: TX, total: 3 }]);
    financeService.listCounterpartyOrders.mockResolvedValue({ data: ORDER_ROWS });
    render(<CounterpartyStatementView row={row} />);
    expect(await screen.findByText("Финансовые операции")).toBeInTheDocument();
    expect(screen.getByText("Оплата")).toBeInTheDocument();
    expect(screen.getByText("Заказы клиента")).toBeInTheDocument();
  });

  it("shows the orders empty state for a client without orders", async () => {
    mockPages([{ items: [], total: 0 }]);
    financeService.listCounterpartyOrders.mockResolvedValue({ data: [] });
    render(<CounterpartyStatementView row={row} />);
    expect(await screen.findByText("Нет заказов за выбранный период")).toBeInTheDocument();
  });
});
