import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { financeService } from "../../../api/finance";
import {
  aggregateByDay,
  CounterpartyStatementView,
  directionLabel,
  formatTxDate,
  turnover,
} from "./CounterpartyHistory";

vi.mock("../../../api/finance", () => ({
  financeService: { listCounterpartyTransactions: vi.fn() },
}));

const TX = [
  { id: "t1", date: "2026-09-20T10:00:00", amount: 100000, direction: "income", comment: "Оплата" },
  { id: "t2", date: "2026-09-20T15:00:00", amount: 40000, direction: "expense", comment: "" },
  { id: "t3", date: "2026-09-21T09:00:00", amount: 25000, direction: "income", comment: null },
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
});

describe("CounterpartyStatementView", () => {
  const row = { id: "cp-1", name: "Test Client", phone: "+998901112233", balance: 15000 };

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
    // V11: no redundant act/period/balance block above the table.
    expect(screen.queryByText("Акт сверки")).toBeNull();
    expect(screen.queryByText((_, element) => element?.textContent?.startsWith("за период:"))).toBeNull();
    expect(screen.getByText(/Обороты за период/)).toBeInTheDocument();
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

  it("aggregates per-day rows in simple mode", async () => {
    mockPages([{ items: TX, total: 3 }]);
    const { container } = render(<CounterpartyStatementView row={row} onBack={() => {}} />);
    await screen.findByText("Оплата");
    const { getByRole } = within(container);
    getByRole("button", { name: "Простой" }).click();
    await waitFor(() => expect(screen.getByText("20.09.2026")).toBeInTheDocument());
  });

  it("shows NO redundant header texts: no act title, no period copy, no balance", async () => {
    mockPages([{ items: [], total: 0 }]);
    const { container } = render(<CounterpartyStatementView row={row} onBack={() => {}} />);
    await screen.findByText("Нет транзакций за выбранный период");
    // V11 cleanup: the period already lives in the period button.
    expect(screen.queryByText("Акт сверки")).toBeNull();
    expect(screen.queryByText((_, element) => element?.textContent?.startsWith("за период:"))).toBeNull();
    expect(screen.queryByText(/Текущий баланс/)).toBeNull();
    // Kept header: eyebrow + name + phone (table mask reused) + controls.
    expect(screen.getByText("История транзакций")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Test Client" })).toBeInTheDocument();
    expect(screen.getByText("+998 (90) 111-22-33")).toBeInTheDocument();
    expect(screen.queryByText("+998901112233")).toBeNull();
    // Name + phone share one baseline row.
    const identity = container.querySelector(".client-statement-identity");
    expect(identity).not.toBeNull();
    expect(identity.querySelector("h1")).not.toBeNull();
    expect(identity.querySelector(".client-statement-phone")).not.toBeNull();
    expect(container.querySelector(".client-statement-right .staff-tabs.staff-tabs--slider")).not.toBeNull();
    expect(container.querySelector(".client-statement-right .report-period-picker")).not.toBeNull();
    expect(container.querySelector(".staff-table-wrapper")).not.toBeNull();
  });

  it("reuses the Reports date-period picker and reloads on period apply", async () => {
    mockPages([{ items: TX, total: 3 }]);
    const { container } = render(<CounterpartyStatementView row={row} onBack={() => {}} />);
    await screen.findByText("Оплата");
    expect(container.querySelector(".report-period-picker")).not.toBeNull();
    const { getByRole, getByText } = within(container);
    fireEvent.click(getByRole("button", { name: "Период истории транзакций" }));
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

  it("reuses the Clients slider tabs and the Reports animated period picker", async () => {
    mockPages([{ items: TX, total: 3 }]);
    const { container } = render(<CounterpartyStatementView row={row} onBack={() => {}} />);
    await screen.findByText("Оплата");
    // SAME segmented-control primitive as the Clients directory tabs.
    const modes = container.querySelector(".client-statement-right .staff-tabs.staff-tabs--slider");
    expect(modes).not.toBeNull();
    expect(modes.querySelector(".staff-tabs__indicator")).not.toBeNull();
    // SAME controlled Reports invocation: animateExit keeps the panel mounted
    // for the exit animation instead of unmounting instantly.
    expect(container.querySelector(".report-period-picker")).not.toBeNull();
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
