import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportsService } from "../api/reports";
import { staffService } from "../api/staff";
import { settingsService } from "../api/settings";
import { getCategories } from "../api/categories";
import ZReportPage from "./ZReportPage";

vi.mock("../api/reports", () => ({ reportsService: { getZReport: vi.fn() } }));
vi.mock("../api/staff", () => ({ staffService: { listStaffUsers: vi.fn() } }));
vi.mock("../api/settings", () => ({ settingsService: { listPlaces: vi.fn(), listDashboardPlaces: vi.fn() } }));
vi.mock("../api/categories", () => ({ getCategories: vi.fn() }));
vi.mock("../components/ReportDateRangePicker", () => ({
  default: () => <button type="button">Период Z-отчёта</button>,
  formatCanonicalReportPeriodLabel: (p) => p?.end || "",
  validateCanonicalReportPeriod: () => "",
}));

const Z = { date: "2026-08-25", is_closed: false, payment_methods: [], orders_count: 0, cancelled_orders_count: 0, payments_count: 0, fiscal_receipts_count: 0, gross_sales: "0", net_sales: "0", tax_total: "0", refunds_total: "0", cash_total: "0", non_cash_total: "0", avg_check: "0" };
const STAFF = [
  { id: "w1", name: "Шерзод", role_slugs: ["waiter"] },
  { id: "w2", name: "Алишер", role_slugs: ["waiter"] },
  { id: "c1", name: "Мансур", role_slugs: ["cashier"] },
];
const HALLS = [
  { id: "hall-1", name: "Во дворе" },
  { id: "hall-2", name: "Балкон" },
];
const BRANCHES = [{ id: "b1", name: "Основной филиал" }];

describe("ZReportPage detail UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportsService.getZReport.mockResolvedValue({ data: Z });
    staffService.listStaffUsers.mockResolvedValue({ data: STAFF });
    settingsService.listPlaces.mockResolvedValue({ data: HALLS });
    settingsService.listDashboardPlaces.mockResolvedValue({ data: BRANCHES });
    getCategories.mockResolvedValue({ data: [] });
  });

  function openRow(title) {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${title}`) }));
  }

  it("waiter multi-select shows selected NAMES, never 'Выбрано: N'", async () => {
    render(<ZReportPage />);
    const waiter = await screen.findByRole("button", { name: "Отчёт по официантам" });
    fireEvent.click(waiter);
    fireEvent.click(screen.getByRole("option", { name: "Шерзод" }));
    fireEvent.click(screen.getByRole("option", { name: "Алишер" }));
    const trigger = screen.getByRole("button", { name: /^Отчёт по официантам:/ });
    expect(trigger).toHaveTextContent("Шерзод, Алишер");
    expect(document.body.textContent).not.toMatch(/Выбрано:\s*\d/);
    // full names preserved in title/aria for overflow
    expect(trigger).toHaveAttribute("title", "Шерзод, Алишер");
    expect(trigger).toHaveAttribute("aria-label", "Отчёт по официантам: Шерзод, Алишер");
  });

  it("zero selection keeps the truthful 'Не выбрано' placeholder", async () => {
    render(<ZReportPage />);
    const waiter = await screen.findByRole("button", { name: "Отчёт по официантам" });
    expect(waiter).toHaveTextContent("Не выбрано");
  });

  it("percent field stays numeric while showing a visible % suffix", async () => {
    render(<ZReportPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Отчёт по официантам" }));
    fireEvent.click(screen.getByRole("option", { name: "Шерзод" }));
    const percent = screen.getByRole("spinbutton", { name: "Процент официанта" });
    fireEvent.change(percent, { target: { value: "12" } });
    // value is the raw number, never "12%"
    expect(percent).toHaveValue(12);
    expect(percent.value).toBe("12");
    // the % is a separate visual suffix element
    const suffix = document.querySelector(".owner-report-row__percent-suffix");
    expect(suffix).toHaveTextContent("%");
    expect(suffix).toHaveAttribute("aria-hidden", "true");
  });

  it("'Отчёт по местам' sources canonical Halls (not branches) and multi-selects by Hall id", async () => {
    render(<ZReportPage />);
    await screen.findByRole("button", { name: "Отчёт по официантам" });
    // canonical directory used, branch endpoint never
    expect(settingsService.listPlaces).toHaveBeenCalledTimes(1);
    expect(settingsService.listDashboardPlaces).not.toHaveBeenCalled();

    const place = screen.getByRole("button", { name: "Отчёт по местам" });
    fireEvent.click(place);
    // options are Hall names, not the branch "Основной филиал"
    expect(screen.getByRole("option", { name: "Во дворе" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Балкон" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Основной филиал" })).toBeNull();
    // multi-select: pick two Halls → trigger shows both names
    fireEvent.click(screen.getByRole("option", { name: "Во дворе" }));
    fireEvent.click(screen.getByRole("option", { name: "Балкон" }));
    expect(screen.getByRole("button", { name: /^Отчёт по местам:/ })).toHaveTextContent("Во дворе, Балкон");
  });

  it("per-entity Print stays truthfully DISABLED (no backend detail contract) — no fake print", async () => {
    render(<ZReportPage />);
    await screen.findByRole("button", { name: "Отчёт по официантам" });
    // select a waiter — Print must NOT become enabled (contract unsupported)
    fireEvent.click(screen.getByRole("button", { name: "Отчёт по официантам" }));
    fireEvent.click(screen.getByRole("option", { name: "Шерзод" }));
    const prints = screen.getAllByRole("button", { name: /Печать недоступна/ });
    expect(prints).toHaveLength(4);
    prints.forEach((btn) => {
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute("title", "Отчёт ещё не подключён");
    });
    // the ONE real, supported action remains the whole-shift print
    expect(screen.getByRole("button", { name: /Печать общего Z-отчёта/ })).toBeInTheDocument();
  });

  // ZR-UI-CLEANUP-01: the unused "Отчёт по поварам" row was removed outright —
  // it only ever rendered a permanently disabled "Нет поваров" control, because
  // no cook report contract exists. Four detailed rows remain, in order.
  it("renders exactly four detailed report rows and no cook row", async () => {
    render(<ZReportPage />);
    await screen.findByRole("button", { name: "Отчёт по официантам" });

    const titles = Array.from(document.querySelectorAll(".owner-report-row__title")).map(
      (el) => el.textContent,
    );
    expect(titles).toEqual([
      "Отчёт по кассирам",
      "Отчёт по официантам",
      "Отчёт по местам",
      "Отчёт по меню",
    ]);
    expect(document.querySelectorAll(".owner-report-row")).toHaveLength(4);

    // the cook row is gone in every form it used to appear in
    expect(screen.queryByText("Отчёт по поварам")).toBeNull();
    expect(screen.queryByText("Нет поваров")).toBeNull();
    expect(screen.queryByRole("button", { name: /повар/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/повар/i);

    // the four approved rows are still individually reachable
    expect(screen.getByRole("button", { name: "Отчёт по кассирам" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отчёт по официантам" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отчёт по местам" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Отчёт по меню" })).toBeInTheDocument();
    // three employee/place multi-selects (cashier, waiter, place) — cook removed
    expect(document.querySelectorAll(".owner-msel")).toHaveLength(3);
  });

  it("dropdown closes on Escape and outside click", async () => {
    render(<ZReportPage />);
    const waiter = await screen.findByRole("button", { name: "Отчёт по официантам" });
    fireEvent.click(waiter);
    expect(screen.getByRole("option", { name: "Шерзод" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("option", { name: "Шерзод" })).toBeNull());
    fireEvent.click(waiter);
    expect(screen.getByRole("option", { name: "Шерзод" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("option", { name: "Шерзод" })).toBeNull());
  });

  it("percent stays numeric for 0 and 100 with the % suffix beside it", async () => {
    render(<ZReportPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Отчёт по официантам" }));
    fireEvent.click(screen.getByRole("option", { name: "Шерзод" }));
    const percent = screen.getByRole("spinbutton", { name: "Процент официанта" });
    const suffix = document.querySelector(".owner-report-row__percent-suffix");
    for (const v of ["0", "100", "12"]) {
      fireEvent.change(percent, { target: { value: v } });
      expect(percent.value).toBe(v);
      expect(percent.value).not.toContain("%");
    }
    expect(suffix).toHaveTextContent("%");
  });
});
