import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportsService } from "../api/reports";
import CancelledDishesReportPage from "./CancelledDishesReportPage";

// VISUAL FIX 01 regression net: the real shared ReportDateRangePicker
// (NOT mocked here) must behave on Cancelled exactly like the oracle pages.
// Root causes were Cancelled selectors missing from shared CSS groups plus a
// divergent actions-wrapper class; these tests pin the integration contract.
vi.mock("../api/reports", () => ({
  reportsService: { listCancelledDishes: vi.fn(), getCancelledFilters: vi.fn() },
}));

vi.mock("../api/orders", () => ({
  ordersService: { get: vi.fn() },
}));

vi.mock("../utils/excel", () => ({ exportToExcel: vi.fn() }));

function periodTrigger() {
  return screen.getByRole("button", { name: "Период отчёта по отменённым блюдам" });
}

function periodMenu() {
  return document.querySelector(".cancelled-report-page .report-date-menu");
}

function finishPeriodExit() {
  // Oracle parity: jsdom never runs CSS animations, so complete the shared
  // exit handshake manually with the exact event name the approved suites
  // use (Dishes finishDropdownExit).
  const closing = document.querySelector(".cancelled-report-page .report-date-menu.is-closing");
  if (closing) fireEvent(closing, new Event("webkitAnimationEnd", { bubbles: true }));
}

describe("Cancelled VISUAL FIX 01 — Period interaction parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportsService.listCancelledDishes.mockResolvedValue({ data: [] });
    reportsService.getCancelledFilters.mockResolvedValue({ data: { authors: [], dishes: [] } });
  });

  it("opens the shared period popover on trigger click", async () => {
    render(<CancelledDishesReportPage />);
    await screen.findByRole("table");
    expect(periodMenu()).toBeNull();
    fireEvent.click(periodTrigger());
    const menu = await screen.findByText("Сегодня", { selector: ".report-date-presets button" });
    expect(menu).toBeInTheDocument();
    expect(periodMenu()).not.toBeNull();
    expect(periodMenu().classList.contains("is-closing")).toBe(false);
    // Open state carries the approved entrance animation class contract.
    expect(periodMenu().className).toContain("report-date-menu");
  });

  it("closes the popover on outside click", async () => {
    render(<CancelledDishesReportPage />);
    await screen.findByRole("table");
    fireEvent.click(periodTrigger());
    await screen.findByText("Сегодня", { selector: ".report-date-presets button" });
    fireEvent.mouseDown(document.body);
    finishPeriodExit();
    await waitFor(() => expect(periodMenu()).toBeNull());
  });

  it("toggles correctly when the trigger is clicked twice", async () => {
    render(<CancelledDishesReportPage />);
    await screen.findByRole("table");
    fireEvent.click(periodTrigger());
    await screen.findByText("Сегодня", { selector: ".report-date-presets button" });
    fireEvent.click(periodTrigger());
    finishPeriodExit();
    await waitFor(() => expect(periodMenu()).toBeNull());
  });

  it("keeps the popover open while interacting inside it", async () => {
    render(<CancelledDishesReportPage />);
    await screen.findByRole("table");
    fireEvent.click(periodTrigger());
    const preset = await screen.findByText("Сегодня", { selector: ".report-date-presets button" });
    fireEvent.mouseDown(preset);
    fireEvent.click(preset);
    expect(periodMenu()).not.toBeNull();
    expect(periodMenu().classList.contains("is-closing")).toBe(false);
  });

  it("closes on Escape and cleans listeners up on unmount", async () => {
    const first = render(<CancelledDishesReportPage />);
    await screen.findByRole("table");
    fireEvent.click(periodTrigger());
    await screen.findByText("Сегодня", { selector: ".report-date-presets button" });
    fireEvent.keyDown(document, { key: "Escape" });
    finishPeriodExit();
    await waitFor(() => expect(periodMenu()).toBeNull());
    first.unmount();

    // Unmount with an open popover must detach every document listener:
    // post-unmount outside interactions stay silent instead of throwing.
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const second = render(<CancelledDishesReportPage />);
    await screen.findByRole("table");
    fireEvent.click(periodTrigger());
    await screen.findByText("Сегодня", { selector: ".report-date-presets button" });
    second.unmount();
    expect(removeSpy.mock.calls.length).toBeGreaterThan(0);
    fireEvent.mouseDown(document.body);
    fireEvent.keyDown(document, { key: "Escape" });
    removeSpy.mockRestore();
  });

  it("keeps the card unclipped and the Excel button on the shared contract", async () => {
    render(<CancelledDishesReportPage />);
    await screen.findByRole("table");
    // VISUAL FIX 02: the absolutely-positioned period popover lives inside
    // the card, so the card must carry the unclipped oracle hook; the Excel
    // control must carry the shared 22px-pill hook (not a one-off class).
    const card = document.querySelector(".cancelled-report-page .cancelled-report-card");
    expect(card).not.toBeNull();
    expect(card.classList.contains("owner-report-surface")).toBe(true);
    const excel = screen.getByRole("button", { name: "Скачать Excel" });
    expect(excel.classList.contains("report-excel-button")).toBe(true);
    expect(excel.classList.contains("owner-report-excel")).toBe(true);
  });

  it("uses the shared actions wrapper and control classes (no divergent geometry)", async () => {
    render(<CancelledDishesReportPage />);
    await screen.findByRole("table");
    // Regression pin for the actual visual-fix root cause: the actions row
    // must carry the shared `report-actions` class or every
    // `.cancelled-report-page .report-actions …` oracle rule silently misses.
    const actions = document.querySelector(".cancelled-report-page .report-actions");
    expect(actions).not.toBeNull();
    expect(actions.classList.contains("owner-report-actions")).toBe(true);
    // Shared period trigger contract: identical classes to the oracle pages.
    const trigger = periodTrigger();
    expect(trigger.classList.contains("report-period-button")).toBe(true);
    expect(trigger.classList.contains("owner-reports__period-button")).toBe(true);
    // Approved teal toggle pattern (base + expanded hook for the shared CSS).
    const toggle = screen.getAllByRole("button", { name: "Фильтровать" }).find((button) => (
      button.classList.contains("cancelled-filter-toggle")
    ));
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
