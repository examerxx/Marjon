import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OwnerDashboard, { buildDashboardPeriodSearch, isDashboardPreviewEnabled } from "../OwnerDashboard";
import { dashboardService } from "../../api/dashboard";
import { buildDashboardPreviewKpis, dashboardPreviewData } from "./dashboardPreviewData";

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../../api/dashboard", () => ({ dashboardService: { loadOwnerOverview: vi.fn() } }));
vi.mock("../../components/Icon", () => ({ default: () => <span aria-hidden="true" /> }));
vi.mock("../../components/Loader", () => ({ PageLoader: () => <div>loading</div> }));
vi.mock("./RevenueChart", () => ({
  // Пробрасываем valueKey: тест обязан видеть, ЧТО именно рисует график.
  default: ({ sales, valueKey }) => (
    <div data-testid="normal-chart" data-value-key={valueKey}>{JSON.stringify(sales)}</div>
  ),
}));
vi.mock("./DashboardCards", () => ({
  EmptyState: ({ title }) => <div>{title}</div>,
  TopSalesCard: ({ dishes }) => <div data-testid="normal-top">{JSON.stringify(dishes)}</div>,
  RecentOrdersCard: ({ orders }) => <div data-testid="normal-orders">{JSON.stringify(orders)}</div>,
}));

const overview = () => [
  { data: { today_revenue: 900, today_orders: 2, avg_check: 450 } },
  { data: [{ date: "2026-10-05", revenue: 900, orders_count: 2, avg_check: 450 }] },
  { data: [{ product_id: "real", name: "Real product", quantity_sold: 2, revenue: 900 }] },
  { data: [] }, { data: [] },
  { data: [{ id: "real-order", order_number: 42, total_amount: 900, created_at: "2026-10-05T12:00:00Z" }] },
  { data: [] }, { data: [{ amount: 100, direction: "expense", category_name: "Real expense" }] },
];

// Порядок карточек на дашборде: приход → чистая прибыль → заказы → чек → расходы.
const specifications = [
  ["Денежный приход", 12450000, "QR / Онлайн", 3],
  ["Чистая прибыль", 12450000, "Плов", 5],
  ["Заказы", 246, "Лагман", 5],
  ["Средний чек", 50610, "Стол 5", 5],
  ["Денежные расходы", 3420000, "Закупка продуктов", 5],
];

describe("Dashboard DEV URL-only KPI preview", () => {
  it("renders the agreed financial calculation and matching chart series", async () => {
    window.history.replaceState({}, "", "/?date_from=2026-10-12&date_to=2026-10-17");
    const data = overview();
    data[0] = { data: { metric_basis: "completed_income_minus_snapshot_cogs", date_from: "2026-10-12", date_to: "2026-10-17", income_total: "220", cogs_total: "40", today_revenue: "180", today_orders: 1, avg_check: 220 } };
    // Бакет приходит с обоими числами: revenue — чистая прибыль, income — приход.
    data[1] = { data: [{ date: "2026-10-17", revenue: "180", income: "220", cogs: "40", orders_count: 1 }] };
    data[7] = { data: [{ direction: "income", amount: 999999 }] };
    dashboardService.loadOwnerOverview.mockResolvedValue(data);
    render(<OwnerDashboard />);
    expect((await screen.findByRole("button", { name: /Чистая прибыль/ })).querySelector(".kpi-value")).toHaveTextContent("180");
    expect(screen.getByRole("button", { name: /Денежный приход/ }).querySelector(".kpi-value")).toHaveTextContent("220");
    // График — денежный приход, а не чистая прибыль.
    expect(screen.getByTestId("normal-chart")).toHaveAttribute("data-value-key", "income");
    expect(screen.getByTestId("normal-chart")).toHaveTextContent('"income":"220"');
  });

  // График показывает денежный приход, а он не зависит от исторической
  // себестоимости: приход известен — график рисуется. Врать при этом нельзя:
  // карточка «Чистая прибыль» обязана остаться «Недоступно».
  it("keeps the income chart when the historical cost is unknown, but never invents profit", async () => {
    window.history.replaceState({}, "", "/");
    const data = overview();
    data[0] = { data: { metric_basis: "completed_income_minus_snapshot_cogs", income_total: "220", today_revenue: null, cogs_total: null, today_orders: 1, avg_check: 220, profit_unavailable_reason: "Историческая себестоимость неизвестна" } };
    dashboardService.loadOwnerOverview.mockResolvedValue(data);
    render(<OwnerDashboard />);
    expect(await screen.findByRole("button", { name: /Чистая прибыль/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Чистая прибыль/ }).querySelector(".kpi-value")).toHaveTextContent("Недоступно");
    expect(screen.getByRole("button", { name: /Денежный приход/ }).querySelector(".kpi-value")).toHaveTextContent("220");
    expect(screen.getByTestId("normal-chart")).toHaveAttribute("data-value-key", "income");
    expect(screen.getByTestId("normal-chart")).toHaveTextContent('"revenue":900');
  });

  // Никакого поддельного нулевого графика: если недоступен сам приход —
  // графика нет, а не «ровная линия по нулям».
  it("draws no graph at all when the income itself is unavailable", async () => {
    window.history.replaceState({}, "", "/");
    const data = overview();
    data[0] = { data: { metric_basis: "completed_income_minus_snapshot_cogs", financial_unavailable: true, income_total: null, today_revenue: null, cogs_total: null, sales: [], profit_unavailable_reason: "Не удалось загрузить оплаты и историческую себестоимость." } };
    data[1] = { data: [] };
    dashboardService.loadOwnerOverview.mockResolvedValue(data);
    render(<OwnerDashboard />);
    expect(await screen.findByText("Не удалось загрузить оплаты и историческую себестоимость.")).toBeInTheDocument();
    expect(screen.queryByTestId("normal-chart")).toBeNull();
  });
  it("maps real product photos by product ID, not rank or translated name", async () => {
    const data = overview();
    data[3] = { data: [{ id: "different", image_url: "/wrong.webp" }, { id: "real", image_url: "/real-photo.webp" }] };
    dashboardService.loadOwnerOverview.mockResolvedValue(data);
    render(<OwnerDashboard />);
    await waitFor(() => expect(screen.getByTestId("normal-top")).toHaveTextContent("/real-photo.webp"));
    expect(screen.getByTestId("normal-top")).not.toHaveTextContent("/wrong.webp");
  });
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query) => ({ matches: query === "(prefers-reduced-motion: reduce)" }));
    vi.unstubAllEnvs();
    vi.stubEnv("DEV", true);
    window.history.replaceState({}, "", "/?previewData=1");
    dashboardService.loadOwnerOverview.mockReset();
    dashboardService.loadOwnerOverview.mockResolvedValue(overview());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("requires both DEV=true and the exact opt-in query value", () => {
    expect(isDashboardPreviewEnabled("?previewData=1", true)).toBe(true);
    for (const search of ["", "?previewData=0", "?previewData=true", "?other=1"]) {
      expect(isDashboardPreviewEnabled(search, true)).toBe(false);
    }
    expect(isDashboardPreviewEnabled("?previewData=1", false)).toBe(false);
  });

  it("keeps one deterministic fixture and exact supplied hours/shares", () => {
    const kpis = buildDashboardPreviewKpis();
    expect(kpis).toEqual(buildDashboardPreviewKpis());
    expect(dashboardPreviewData.date).toBe("2026-10-05");
    expect(kpis.map((kpi) => kpi.label)).toEqual(specifications.map((item) => item[0]));
    expect(kpis.map((kpi) => Number(kpi.value.replace(/\s/g, "")))).toEqual(specifications.map((item) => item[1]));
    // Таблицы ищем по классу карточки, а не по позиции: порядок может меняться.
    const card = (cls) => kpis.find((kpi) => kpi.className === cls);
    expect(card("premium-kpi--revenue").table.rows[0]).toEqual({ name: "Плов", amount: 3250000, percent: 26.1 });
    expect(card("premium-kpi--tables").table.rows.map((row) => row.percent)).toEqual([58.5, 37.3, 4.2]);
    expect(dashboardPreviewData.orders.hourly.at(-1)).toEqual({ hour: "21:00", value: 84 });
    expect(dashboardPreviewData.expense.hourly).toHaveLength(8);
  });

  it.each(specifications)("populates %s and opens its unchanged table dialog", async (label, total, rowLabel, rowCount) => {
    render(<OwnerDashboard />);
    const button = await screen.findByRole("button", { name: new RegExp(label) });
    expect(button.querySelector(".kpi-value").textContent.replace(/\s/g, "")).toContain(String(total));
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: label });
    expect(dialog.querySelector(".kpi-info-window__value").textContent.replace(/\s/g, "")).toContain(String(total));
    expect(within(dialog).getByText(rowLabel)).toBeInTheDocument();
    expect(dialog.querySelectorAll("tbody tr")).toHaveLength(rowCount);
    expect(within(dialog).getByText(/Предпросмотр · 05.10.2026/)).toBeInTheDocument();
    expect(dialog.querySelector("canvas")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not populate the normal chart, outer Top-5, latest orders or warehouse", async () => {
    render(<OwnerDashboard />);
    await screen.findByRole("button", { name: /Чистая прибыль/ });
    await waitFor(() => expect(screen.getByTestId("normal-top")).toHaveTextContent("Real product"));
    expect(screen.getByTestId("normal-chart")).toHaveTextContent('"revenue":900');
    expect(screen.getByTestId("normal-top")).not.toHaveTextContent("Плов");
    expect(screen.getByTestId("normal-orders")).toHaveTextContent("#42");
    expect(document.querySelector(".warehouse-summary-list")).not.toHaveTextContent("12 450 000");
  });

  it("can render preview values while normal-widget API requests are still pending, without storage writes", async () => {
    dashboardService.loadOwnerOverview.mockReturnValue(new Promise(() => {}));
    const localWrite = vi.spyOn(window.localStorage, "setItem");
    const sessionWrite = vi.spyOn(window.sessionStorage, "setItem");
    render(<OwnerDashboard />);
    const button = await screen.findByRole("button", { name: /Чистая прибыль/ });
    expect(button.textContent.replace(/\s/g, "")).toContain("12450000");
    expect(localWrite).not.toHaveBeenCalled();
    expect(sessionWrite).not.toHaveBeenCalled();
    localWrite.mockRestore();
    sessionWrite.mockRestore();
  });

  it("keeps all five preview cards and dialogs populated after a late canonical API response with zero KPI values", async () => {
    let finishOverview;
    dashboardService.loadOwnerOverview.mockReturnValue(new Promise((resolve) => { finishOverview = resolve; }));
    render(<OwnerDashboard />);
    await screen.findByRole("button", { name: /Чистая прибыль/ });
    const cardValues = () => Array.from(document.querySelectorAll(".owner-kpi-band .kpi-value"))
      .map((el) => el.textContent.replace(/\s/g, ""));
    // Ожидание выводится из specifications, чтобы порядок карточек не
    // приходилось дублировать в каждом тесте.
    const expected = specifications.map(([label, total]) => `${total}${label === "Заказы" ? "ШТ" : "UZS"}`);
    expect(cardValues()).toEqual(expected);

    const zeroOverview = overview();
    zeroOverview[0] = { data: { today_revenue: 0, today_orders: 0, avg_check: 0 } };
    zeroOverview[1] = { data: [{ date: "2026-10-05", revenue: 0, orders_count: 0, avg_check: 0 }] };
    zeroOverview[7] = { data: [] };
    await act(async () => finishOverview(zeroOverview));
    // The external widget proves that the late response has actually rendered.
    await waitFor(() => expect(screen.getByTestId("normal-top")).toHaveTextContent("Real product"));
    expect(cardValues()).toEqual(expected);
    expect(screen.getByTestId("normal-chart")).toHaveTextContent('"revenue":0');
    expect(window.location.search).toBe("?previewData=1");

    for (const [label, total, rowLabel] of specifications) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
      const dialog = screen.getByRole("dialog", { name: label });
      expect(dialog.querySelector(".kpi-info-window__value").textContent.replace(/\s/g, "")).toContain(String(total));
      expect(within(dialog).getByText(rowLabel)).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }
    expect(cardValues()).toEqual(expected);
  });

  it("retains preview on remount only through the URL and returns to normal when removed", async () => {
    const first = render(<OwnerDashboard />);
    await screen.findByRole("button", { name: /Чистая прибыль/ });
    first.unmount();
    const second = render(<OwnerDashboard />);
    const preview = await screen.findByRole("button", { name: /Чистая прибыль/ });
    expect(preview.textContent.replace(/\s/g, "")).toContain("12450000");
    second.unmount();
    window.history.replaceState({}, "", "/");
    render(<OwnerDashboard />);
    const normal = await screen.findByRole("button", { name: /Чистая прибыль/ });
    expect(normal.querySelector(".kpi-value")).toHaveTextContent("900 UZS");
    expect(normal.textContent.replace(/\s/g, "")).not.toContain("12450000");
  });

  it("never enables preview in production, even with the URL parameter", async () => {
    vi.stubEnv("DEV", false);
    render(<OwnerDashboard />);
    const button = await screen.findByRole("button", { name: /Чистая прибыль/ });
    expect(button.querySelector(".kpi-value")).toHaveTextContent("900 UZS");
  });

  it("preserves the normal API-error state", async () => {
    window.history.replaceState({}, "", "/");
    dashboardService.loadOwnerOverview.mockRejectedValue(new Error("offline"));
    render(<OwnerDashboard />);
    expect(await screen.findByText("Dashboard недоступен")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Чистая прибыль/ })).not.toBeInTheDocument();
  });

  it.each([
    [true, "?previewData=1&unrelated=drop&date=2026-10-01", "&previewData=1"],
    [true, "?unrelated=drop", ""],
    [true, "?previewData=0", ""],
    [true, "?previewData=true", ""],
    [false, "?previewData=1", ""],
  ])("builds a canonical date query with only existing DEV preview (DEV=%s, query=%s)", (isDev, search, previewSuffix) => {
    const first = buildDashboardPeriodSearch({ date_from: "2026-10-05", date_to: "2026-10-05" }, search, isDev);
    expect(first).toBe(`date_from=2026-10-05&date_to=2026-10-05${previewSuffix}`);
    const second = buildDashboardPeriodSearch({ date_from: "2026-10-02", date_to: "2026-10-04" }, `?${first}`, isDev);
    expect(second).toBe(`date_from=2026-10-02&date_to=2026-10-04${previewSuffix}`);
  });

  it("keeps all five preview KPIs through two real date-picker apply/refetch cycles", async () => {
    window.history.replaceState({}, "", "/?previewData=1&unrelated=drop");
    render(<OwnerDashboard />);
    const trigger = await screen.findByRole("button", { name: "Период денежного прихода" });
    const applyRange = async (start, end) => {
      fireEvent.click(trigger);
      fireEvent.change(screen.getByLabelText("Начало периода"), { target: { value: `${start} | 00:00` } });
      fireEvent.change(screen.getByLabelText("Конец периода"), { target: { value: `${end} | 00:00` } });
      fireEvent.click(document.querySelector(".owner-revenue-switcher .report-date-ok"));
      const closingMenu = document.querySelector(".owner-revenue-switcher .report-date-menu.is-closing");
      if (closingMenu) fireEvent(closingMenu, new Event("webkitAnimationEnd", { bubbles: true }));
      await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    };
    const values = () => Array.from(document.querySelectorAll(".owner-kpi-band .kpi-value"))
      .map((el) => el.textContent.replace(/\s/g, ""));
    // Ожидание выводится из specifications, чтобы порядок карточек не
    // приходилось дублировать в каждом тесте.
    const expected = specifications.map(([label, total]) => `${total}${label === "Заказы" ? "ШТ" : "UZS"}`);

    await applyRange("05.10.2026", "05.10.2026");
    expect(window.location.search).toBe("?date_from=2026-10-05&date_to=2026-10-05&previewData=1");
    await waitFor(() => expect(dashboardService.loadOwnerOverview).toHaveBeenLastCalledWith(expect.objectContaining({dateFrom: "2026-10-05", dateTo: "2026-10-05"})));
    expect(values()).toEqual(expected);

    await applyRange("02.10.2026", "04.10.2026");
    expect(window.location.search).toBe("?date_from=2026-10-02&date_to=2026-10-04&previewData=1");
    await waitFor(() => expect(dashboardService.loadOwnerOverview).toHaveBeenLastCalledWith(expect.objectContaining({dateFrom: "2026-10-02", dateTo: "2026-10-04"})));
    expect(values()).toEqual(expected);
  });

  it("does not add preview when the normal date picker applies a selection", async () => {
    window.history.replaceState({}, "", "/?unrelated=drop");
    render(<OwnerDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Период денежного прихода" }));
    fireEvent.change(screen.getByLabelText("Начало периода"), { target: { value: "05.10.2026 | 00:00" } });
    fireEvent.change(screen.getByLabelText("Конец периода"), { target: { value: "05.10.2026 | 00:00" } });
    fireEvent.click(document.querySelector(".owner-revenue-switcher .report-date-ok"));
    expect(window.location.search).toBe("?date_from=2026-10-05&date_to=2026-10-05");
    expect(screen.getByRole("button", { name: /Чистая прибыль/ }).querySelector(".kpi-value")).toHaveTextContent("900 UZS");
  });

  it("immediately uses canonical data after manual preview removal and does not re-add it on the next date apply", async () => {
    window.history.replaceState({}, "", "/?date_from=2026-10-05&date_to=2026-10-05&previewData=1");
    const view = render(<OwnerDashboard />);
    const preview = await screen.findByRole("button", { name: /Чистая прибыль/ });
    expect(preview.textContent.replace(/\s/g, "")).toContain("12450000");
    window.history.replaceState({}, "", "/?date_from=2026-10-05&date_to=2026-10-05");
    view.rerender(<OwnerDashboard />);
    expect(screen.getByRole("button", { name: /Чистая прибыль/ }).querySelector(".kpi-value")).toHaveTextContent("900 UZS");
    fireEvent.click(screen.getByRole("button", { name: "Период денежного прихода" }));
    fireEvent.change(screen.getByLabelText("Начало периода"), { target: { value: "04.10.2026 | 00:00" } });
    fireEvent.change(screen.getByLabelText("Конец периода"), { target: { value: "04.10.2026 | 00:00" } });
    fireEvent.click(document.querySelector(".owner-revenue-switcher .report-date-ok"));
    expect(window.location.search).toBe("?date_from=2026-10-04&date_to=2026-10-04");
  });
});
