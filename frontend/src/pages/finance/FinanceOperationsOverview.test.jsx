import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, it, expect, vi } from "vitest";
import FinanceOperationsOverview from "./FinanceOperationsOverview";
import { financeService } from "../../api/finance";

vi.mock("../../api/finance", () => ({ financeService: {
  listTransactions: vi.fn(), listPaymentTypes: vi.fn(), listTransactionCategories: vi.fn(),
} }));
vi.mock("../../utils/excel", () => ({ exportToExcel: vi.fn() }));
vi.mock("../../components/ReportDateRangePicker", () => ({ default: () => <button>Period</button> }));
const tx = (id, direction, amount) => ({ id, direction, amount, date: "2026-10-10T09:00:00Z", category_id: "food", payment_type_id: "cash" });
const draw = () => render(<MemoryRouter><FinanceOperationsOverview /></MemoryRouter>);
beforeEach(() => {
  vi.clearAllMocks();
  financeService.listTransactions.mockImplementation(({ dateFrom }) => Promise.resolve({ data: { items: dateFrom ? [tx("1", "income", "100"), tx("2", "expense", "50")] : [tx("old", "income", "25")] } }));
  financeService.listPaymentTypes.mockResolvedValue({ data: { items: [{ id: "cash", name: "Касса" }] } });
  financeService.listTransactionCategories.mockResolvedValue({ data: { items: [{ id: "food", name: "Продукты" }] } });
});
describe("finance overview live API states", () => {
  it("opens the matching create form from both toolbar actions", async () => {
    draw();
    await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Денежные операции");
    fireEvent.click(screen.getByRole("button", { name: "Приход", exact: true }));
    expect(screen.getByRole("heading", { name: "Приходная операция" })).toBeInTheDocument();
    const operationType = screen.getByRole("combobox", { name: /Тип операции/ });
    fireEvent.click(operationType);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(operationType, { key: "ArrowDown" });
    fireEvent.keyDown(operationType, { key: "Enter" });
    expect(screen.getByRole("heading", { name: "Расходная операция" })).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(operationType);
    fireEvent.keyDown(operationType, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    fireEvent.click(screen.getByRole("button", { name: "Расход", exact: true }));
    expect(screen.getByRole("heading", { name: "Расходная операция" })).toBeInTheDocument();
  });
  it("shows recorded opening/closing balances and keeps the transaction list reachable", async () => {
    const { container } = draw();
    await waitFor(() => expect(container.querySelectorAll(".fo-summary-card strong")[3]).toHaveTextContent("75 UZS"));
    expect([...container.querySelectorAll(".fo-summary-card strong")].map(e => e.textContent)).toEqual(["25 UZS", "100 UZS", "50 UZS", "75 UZS"]);
    expect(screen.getByRole("link", { name: /Все операции/ }).getAttribute("href")).toMatch(/^\/finance\/operations\?date_from=\d{4}-\d{2}-\d{2}&date_to=\d{4}-\d{2}-\d{2}$/);
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3);
    expect(financeService.listTransactions).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it("does not fabricate opening/closing balances when historical data fails", async () => {
    financeService.listTransactions.mockImplementation(({ dateFrom }) => dateFrom ? Promise.resolve({ data: { items: [tx("1", "income", "100")] } }) : Promise.reject(new Error("offline")));
    const { container } = draw();
    await screen.findByText(/История до начала периода недоступна/);
    expect([...container.querySelectorAll(".fo-summary-card strong")].map(e => e.textContent)).toEqual(["—", "100 UZS", "0 UZS", "—"]);
  });
  it("shows an error rather than zero sums on API failure", async () => {
    financeService.listTransactions.mockRejectedValue(new Error("offline"));
    const { container } = draw();
    await screen.findByRole("alert");
    expect([...container.querySelectorAll(".fo-summary-card strong")].every(e => e.textContent === "—")).toBe(true);
    expect(screen.getByRole("button", { name: "Экспорт" })).toBeDisabled();
  });
  it("renders honest zero/empty states for a successful empty ledger", async () => {
    financeService.listTransactions.mockResolvedValue({ data: { items: [] } });
    const { container } = draw();
    await screen.findByText("За этот период операций нет");
    expect([...container.querySelectorAll(".fo-summary-card strong")].every(e => e.textContent === "0 UZS")).toBe(true);
    expect(screen.getByText("Расходов за период нет")).toBeInTheDocument();
  });
});
