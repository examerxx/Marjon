import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FinanceCategoriesPage from "./FinanceCategoriesPage";
import { financeService } from "../../api/finance";

vi.mock("../../api/finance", () => ({ financeService: {
  listTransactionCategories: vi.fn(), createTransactionCategory: vi.fn(),
  updateTransactionCategory: vi.fn(), deleteTransactionCategory: vi.fn(),
} }));
beforeEach(() => {
  vi.clearAllMocks();
  financeService.listTransactionCategories.mockResolvedValue({ data: { items: [
    { id: "1", name: "Продажи", kind: "income", status: true },
    { id: "2", name: "Архив", kind: "income", status: false },
    { id: "3", name: "Аренда", kind: "expense", status: true },
  ] } });
});
describe("finance categories", () => {
  it("separates directions and archived records", async () => {
    render(<FinanceCategoriesPage kind="income" />);
    await screen.findByText("Продажи");
    expect(screen.queryByText("Аренда")).toBeNull();
    expect(screen.queryByText("Архив")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Архивированные" }));
    expect(screen.getByText("Архив")).toBeInTheDocument();
    expect(screen.queryByText("Продажи")).toBeNull();
  });
  it("creates an expense with the correct kind and trimmed name", async () => {
    financeService.createTransactionCategory.mockResolvedValue({ data: { id: "4", name: "Закупки", kind: "expense", status: true } });
    render(<FinanceCategoriesPage kind="expense" />);
    await screen.findByText("Аренда");
    fireEvent.click(screen.getByRole("button", { name: "Добавить категорию" }));
    fireEvent.change(screen.getByPlaceholderText("Название категории"), { target: { value: "  Закупки  " } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить", exact: true }));
    await screen.findByText("Закупки");
    expect(financeService.createTransactionCategory).toHaveBeenCalledWith({ name: "Закупки", kind: "expense", status: true });
  });
  it("archives through status PATCH and preserves rows on rejected mutation", async () => {
    financeService.updateTransactionCategory.mockRejectedValue({ response: { data: { detail: "Нет доступа" } } });
    render(<FinanceCategoriesPage kind="income" />);
    await screen.findByText("Продажи");
    fireEvent.click(screen.getByRole("button", { name: "Архивировать категорию Продажи" }));
    fireEvent.click(screen.getByRole("button", { name: "Архивировать", exact: true }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("Нет доступа");
    expect(financeService.updateTransactionCategory).toHaveBeenCalledWith("1", { status: false });
    expect(financeService.deleteTransactionCategory).not.toHaveBeenCalled();
    expect(screen.getByText("Продажи")).toBeInTheDocument();
  });
  it("shows load failure separately from an empty list", async () => {
    financeService.listTransactionCategories.mockRejectedValue(new Error("offline"));
    render(<FinanceCategoriesPage kind="expense" />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Не удалось загрузить категории"));
    expect(screen.queryByText("Категорий пока нет.")).toBeNull();
  });
});
