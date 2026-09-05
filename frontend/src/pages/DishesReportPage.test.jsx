import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportsService } from "../api/reports";
import DishesReportPage from "./DishesReportPage";

vi.mock("../api/reports", () => ({
  reportsService: { listDishes: vi.fn(), getDishesFilters: vi.fn() },
}));

vi.mock("../components/ReportDateRangePicker", () => ({
  default: () => <button type="button">Период</button>,
}));

vi.mock("../utils/excel", () => ({ exportToExcel: vi.fn() }));

describe("DishesReportPage filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportsService.listDishes.mockResolvedValue({
      data: [{ id: "dish-1", name: "Плов", status: "Завершено", quantity: 2, amount: 100000 }],
    });
    reportsService.getDishesFilters.mockResolvedValue({
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
    });
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
    expect(screen.queryByText("Показаны все блюда за выбранный период")).not.toBeInTheDocument();
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
    expect(screen.queryByLabelText("Повар")).not.toBeInTheDocument();
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
    expect(author).toHaveValue("author-1");
    expect(status).toHaveValue("completed");

    fireEvent.click(screen.getAllByRole("button", { name: "Фильтровать" })[1]);
    await waitFor(() => expect(screen.getByText("Поиск: Плов")).toBeInTheDocument());
    expect(screen.getByText("Официант: Официант 1")).toBeInTheDocument();
    expect(screen.getByText("Статус заказа: Завершён")).toBeInTheDocument();
    await waitFor(() => expect(reportsService.listDishes).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ filters: expect.objectContaining({ query: "Плов", authorId: "author-1", orderStatus: "completed" }) }),
    ));

    fireEvent.click(screen.getByRole("button", { name: "Очистить" }));
    await waitFor(() => expect(screen.getByLabelText("Поиск по названию блюда")).toHaveValue(""));
    expect(screen.getByLabelText("Официант")).toHaveValue("all");
    expect(screen.getByLabelText("Статус заказа")).toHaveValue("all");
    expect(screen.queryByLabelText("Активные фильтры")).not.toBeInTheDocument();
  });
});
