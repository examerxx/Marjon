import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildRealKpis } from "./analyticsData";
import { TopSalesCard, RecentOrdersCard } from "./DashboardCards";

// OWNER dashboard EMPTY-content stage: a healthy new company (success + empty)
// must render an intentional empty state — never a fake product/order row and
// never a fabricated day-over-day comparison. FULL rendering stays intact.

vi.mock("../../api/client", () => ({
  formatMoney: (value) => `${Number(value).toLocaleString("ru-RU")} UZS`,
  formatNumber: (value) => Number(value).toLocaleString("ru-RU"),
}));

vi.mock("react-router-dom", () => ({
  Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
}));

describe("OWNER dashboard empty content", () => {
  it("distinguishes unavailable paid sales from a successful empty period", () => {
    render(<TopSalesCard dishes={[]} error="Требуется обновление backend." />);
    expect(screen.getByText("Топ-5 временно недоступен")).toBeInTheDocument();
    expect(screen.getByText("Требуется обновление backend.")).toBeInTheDocument();
    expect(screen.queryByText("Продаж пока нет")).toBeNull();
  });
  it("opens the real dish photo in the catalogue viewer and closes with Escape", () => {
    render(<TopSalesCard dishes={[{ product_id: "p1", name: "Плов", quantity: 3, revenue: 180000, photo: "/media/plov.webp" }]} />);
    const button = screen.getByRole("button", { name: "Открыть фото Плов" });
    expect(within(button).getByRole("img")).toHaveAttribute("src", "/media/plov.webp");
    button.focus(); fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "Фото блюда Плов" });
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/media/plov.webp");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("closes the photo viewer using its close button", () => {
    render(<TopSalesCard dishes={[{ product_id: "p1", name: "Плов", quantity: 1, revenue: 100, photo: "/media/plov.webp" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть фото Плов" }));
    fireEvent.click(screen.getByRole("button", { name: "Закрыть фото" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses a neutral placeholder rather than a fabricated dish photo when missing", () => {
    render(<TopSalesCard dishes={[{ product_id: "p1", name: "Без фото", quantity: 1, revenue: 100 }]} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button", { name: /Открыть фото/ })).toBeNull();
    expect(screen.getByLabelText("Нет фото")).toBeInTheDocument();
  });
  it("renders Top-5 sales empty state without a fake product row", () => {
    render(<TopSalesCard dishes={[]} />);

    expect(screen.getByText("Продаж пока нет")).toBeInTheDocument();
    expect(screen.getByText("После первых заказов здесь появятся самые продаваемые позиции.")).toBeInTheDocument();
    expect(screen.queryByText("Нет продаж за выбранную дату")).not.toBeInTheDocument();
    expect(screen.queryByText("0 шт")).not.toBeInTheDocument();
    expect(screen.queryByText("0 UZS")).not.toBeInTheDocument();
  });

  it("keeps real Top-5 rows when sales exist (FULL preserved)", async () => {
    render(<TopSalesCard dishes={[{ product_id: "p1", name: "Backend dish", quantity: 3, revenue: 180000 }]} />);

    expect(screen.getByText("Backend dish")).toBeInTheDocument();
    expect(await screen.findByText("3 шт")).toBeInTheDocument();
    expect(screen.queryByText("Продаж пока нет")).not.toBeInTheDocument();
  });

  it("renders Last Orders empty state without a fake order row", () => {
    render(<RecentOrdersCard orders={[]} />);

    expect(screen.getByText("Заказов пока нет")).toBeInTheDocument();
    expect(screen.getByText("Новые заказы будут отображаться здесь.")).toBeInTheDocument();
    expect(screen.queryByText("Нет заказов за выбранную дату")).not.toBeInTheDocument();
    expect(screen.queryByText("0 UZS")).not.toBeInTheDocument();
  });

  it("keeps real order rows when orders exist (FULL preserved)", () => {
    render(<RecentOrdersCard orders={[{ id: "#42", date: "12.08 10:00", place: "Стол 7", amount: "900 UZS", status: "Готов", statusCode: "ready", ready: true }]} />);

    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("900 UZS")).toBeInTheDocument();
    // Статус — общий OrderStatus (точка + подпись), как в «Отчёте по заказам»,
    // а не отдельная плашка.
    const status = document.querySelector(".recent-order .report-order-status");
    expect(status).not.toBeNull();
    expect(status).toHaveTextContent("Готов");
    expect(status.querySelector(".report-order-status__dot")).not.toBeNull();
    expect(document.querySelector(".recent-order small")).toBeNull();
    expect(screen.queryByText("Заказов пока нет")).not.toBeInTheDocument();
  });

  it("keeps distinct tones for recent order statuses", () => {
    render(<RecentOrdersCard orders={[
      { id: "#3", date: "25.10 20:40", place: "Стол 3", amount: "167 400 UZS", statusCode: "new" },
      { id: "#1", date: "25.10 17:10", place: "Стол 2", amount: "146 000 UZS", statusCode: "completed" },
    ]} />);
    expect(screen.getByText("Новый")).toHaveClass("report-order-status--new");
    expect(screen.getByText("Завершён")).toHaveClass("report-order-status--completed");
    expect(screen.getByText("Новый").querySelector(".report-order-status__dot")).not.toBeNull();
    expect(screen.getByText("Завершён").querySelector(".report-order-status__dot")).not.toBeNull();
  });

  it("does not fabricate a day-over-day comparison without sales history", () => {
    const kpis = buildRealKpis({ today_revenue: 0, today_orders: 0, avg_check: 0 }, [], "2026-08-12");
    const notes = Object.fromEntries(kpis.map((kpi) => [kpi.label, kpi.note]));

    expect(notes["Чистая прибыль"]).toBe("Нет данных для сравнения");
    expect(notes["Заказы"]).toBe("Заказов пока нет");
    expect(notes["Средний чек"]).toBe("Появится после первых заказов");
    expect(notes["Чистая прибыль"]).not.toMatch(/к вчерашнему дню/);

    const revenueInsight = kpis.find((kpi) => kpi.label === "Чистая прибыль").insight;
    expect(revenueInsight).toBe("Пока нет данных за предыдущий день для сравнения.");
    expect(revenueInsight).not.toMatch(/Темп/);
  });

  it("keeps the real comparison when sales history exists", () => {
    const sales = [
      { revenue: 800, orders_count: 2, avg_check: 400 },
      { revenue: 1000, orders_count: 3, avg_check: 500 },
    ];
    const kpis = buildRealKpis({ today_revenue: 1000, today_orders: 3, avg_check: 500 }, sales, "2026-08-12");
    const revenueNote = kpis.find((kpi) => kpi.label === "Чистая прибыль").note;

    expect(revenueNote).toMatch(/к вчерашнему дню/);
  });

  it("never compares neighbouring hours as «вчера» on a single-day hourly chart", () => {
    const hourly = Array.from({ length: 24 }, (_, hour) => ({
      date: "2026-10-16",
      chart_label: `${String(hour).padStart(2, "0")}:00`,
      revenue: hour === 10 ? 67200 : 0,
      orders_count: hour === 10 ? 2 : 0,
      avg_check: hour === 10 ? 33600 : 0,
    }));
    const kpis = buildRealKpis({ today_revenue: 67200, today_orders: 2, avg_check: 33600 }, hourly, "2026-10-16");
    const notes = Object.fromEntries(kpis.map((kpi) => [kpi.label, kpi.note]));

    expect(notes["Чистая прибыль"]).toBe("Нет данных для сравнения");
    expect(notes["Чистая прибыль"]).not.toMatch(/к вчерашнему дню/);
  });
});
