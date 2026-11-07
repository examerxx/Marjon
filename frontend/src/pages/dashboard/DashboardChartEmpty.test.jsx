import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OwnerDashboard from "../OwnerDashboard";
import { dashboardService } from "../../api/dashboard";
import { todayInputValue } from "../../utils/date";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../api/dashboard", () => ({
  dashboardService: { loadOwnerOverview: vi.fn() },
}));

vi.mock("../../api/client", () => ({
  formatMoney: (value) => `${Number(value || 0)} UZS`,
  formatNumber: (value) => String(Number(value || 0)),
}));

vi.mock("../../components/Icon", () => ({ default: () => <span aria-hidden="true" /> }));
vi.mock("../../components/Loader", () => ({ PageLoader: () => <div>loading</div> }));
// Probe instead of the real Chart.js component (jsdom has no canvas 2D):
// serializes exactly what the dashboard hands to the real chart.
vi.mock("./RevenueChart", () => ({
  default: ({ sales }) => (
    <div
      data-testid="revenue-chart-probe"
      data-points={sales.length}
      data-revenues={sales.map((item) => Number(item.revenue || 0)).join(",")}
      data-labels={sales.map((item) => item.chartLabel || item.date).join("|")}
    />
  ),
}));
vi.mock("./DashboardDialogs", () => ({
  KpiInfoDialog: () => null,
  WarehouseReportDialog: () => null,
}));
vi.mock("./DashboardCards", () => ({
  EmptyState: ({ title }) => <div>{title}</div>,
  TopSalesCard: () => <div data-testid="top-sales" />,
  RecentOrdersCard: () => <div data-testid="recent-orders" />,
  SectionEmpty: ({ title }) => <div>{title}</div>,
}));

function overviewWith(salesRows) {
  return [
    { data: {} },
    { data: salesRows },
    { data: [] },
    { data: [] },
    { data: [] },
    { data: [] },
    { data: [] },
    { data: [] },
  ];
}

describe("OWNER Revenue Analytics no-data zero line", () => {
  beforeEach(() => {
    dashboardService.loadOwnerOverview.mockReset();
    window.history.replaceState({}, "", "/");
  });

  it("renders the real chart with a flat zero series instead of the large empty overlay", async () => {
    dashboardService.loadOwnerOverview.mockResolvedValue(overviewWith([]));
    render(<OwnerDashboard />);

    const probe = await screen.findByTestId("revenue-chart-probe");
    // Single default day -> 9 intraday buckets (axis to 23:59), all exactly zero.
    expect(probe).toHaveAttribute("data-points", "9");
    expect(probe.getAttribute("data-revenues").split(",").every((v) => v === "0")).toBe(true);
    expect(probe.getAttribute("data-labels")).toContain("00:00");
    expect(probe.getAttribute("data-labels")).toContain("23:59");
    // Large replacement overlay is gone from the chart area.
    expect(screen.queryByText("Продаж пока нет")).not.toBeInTheDocument();
    // Summary stays truthful at zero.
    expect(screen.getByText("Максимум").parentElement).toHaveTextContent("0 UZS");
  });

  it("respects the selected multi-day period for zero buckets", async () => {
    window.history.replaceState({}, "", "/?date_from=2026-09-26&date_to=2026-10-02");
    dashboardService.loadOwnerOverview.mockResolvedValue(overviewWith([]));
    render(<OwnerDashboard />);

    const probe = await screen.findByTestId("revenue-chart-probe");
    expect(probe).toHaveAttribute("data-points", "7");
    expect(probe.getAttribute("data-labels")).toContain("2026-09-26");
    expect(probe.getAttribute("data-labels")).toContain("2026-10-02");
    expect(probe.getAttribute("data-revenues").split(",").every((v) => v === "0")).toBe(true);
  });

  it("replaces minimum with average and shows actual period service fees", async () => {
    const result = overviewWith([]);
    result[0].data.service_fee_total = "16300.00";
    dashboardService.loadOwnerOverview.mockResolvedValue(result);
    render(<OwnerDashboard />);
    await screen.findByTestId("revenue-chart-probe");
    const stats = document.querySelector(".revenue-stat-grid");
    expect([...stats.querySelectorAll("span")].map((node) => node.textContent)).toEqual(["Максимум", "Среднее", "Обслуживание"]);
    await waitFor(() => expect(stats.lastElementChild.textContent.replace(/\s/g, "")).toContain("16300UZS"));
    expect(screen.queryByText("Минимум")).toBeNull();
  });

  it("keeps actual values untouched when real sales exist", async () => {
    const today = todayInputValue();
    dashboardService.loadOwnerOverview.mockResolvedValue(overviewWith([
      { date: today, revenue: 5000, orders_count: 2, avg_check: 2500 },
      { date: today, revenue: 8000, orders_count: 3, avg_check: 2600 },
    ]));
    render(<OwnerDashboard />);

    const probe = await screen.findByTestId("revenue-chart-probe");
    expect(probe).toHaveAttribute("data-points", "2");
    expect(probe).toHaveAttribute("data-revenues", "5000,8000");
    await waitFor(() => expect(screen.getByText("Максимум").parentElement).toHaveTextContent("8000 UZS"));
  });

  it("renders 10 decorative card artworks without total costs", async () => {
    dashboardService.loadOwnerOverview.mockResolvedValue(overviewWith([]));
    render(<OwnerDashboard />);
    await screen.findByTestId("revenue-chart-probe");

    const kpiArt = document.querySelectorAll(".dashboard-kpi-card__art");
    expect(kpiArt).toHaveLength(5);
    const sideArt = document.querySelectorAll(".dashboard-side-metric__art");
    expect(sideArt).toHaveLength(5);
    for (const img of [...kpiArt, ...sideArt]) {
      expect(img.getAttribute("alt")).toBe("");
      expect(img.getAttribute("aria-hidden")).toBe("true");
    }
    // V3.1: whole PNG visible, no crop viewport.
    expect(document.querySelectorAll(".dashboard-side-card__art-viewport")).toHaveLength(0);
  });

  it("removes KPI bottom note text and shows honest right-column values", async () => {
    dashboardService.loadOwnerOverview.mockResolvedValue(overviewWith([]));
    render(<OwnerDashboard />);
    await screen.findByTestId("revenue-chart-probe");

    // V3.1: no note text under KPI values (title + value + badge + art only).
    expect(document.querySelectorAll(".kpi-card .kpi-note")).toHaveLength(0);
    expect(screen.queryByText("Нет данных для сравнения")).not.toBeInTheDocument();
    expect(screen.queryByText("Заказов пока нет")).not.toBeInTheDocument();
    expect(screen.queryByText("Появится после первых заказов")).not.toBeInTheDocument();

    // Honest UI-state zeros for goods/costs cards; creditor/debtor untouched.
    expect(screen.queryByText("Общие затраты")).toBeNull();
    for (const label of ["Приход товаров", "Остаток склада"]) {
      expect(screen.getByText(label).closest("button")).toHaveTextContent("0 UZS");
    }
    expect(screen.getByText("Расход товаров").closest("button")).toHaveTextContent("Недоступно");
    for (const label of ["Кредиторка", "Дебиторка"]) {
      expect(screen.getByText(label).closest("button")).toHaveTextContent("Скоро");
    }
  });
});
