import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WaitersReportPage from "./WaitersReportPage";

vi.mock("../api/reports", () => ({
  reportsService: { listWaiters: vi.fn(), getWaitersFilters: vi.fn() },
}));

vi.mock("../utils/excel", () => ({ exportToExcel: vi.fn() }));

import { reportsService } from "../api/reports";

const TOTALS = {
  orders_count: 1, orders_total: "1000.00", takeaway_delivery_total: "0.00",
  service_total: "0.00", waiter_service_total: "10.00", dishes_count: "1",
};

function rowsWith(name) {
  return {
    rows: [{
      waiter_id: "waiter-1", name, orders_count: 1, orders_total: "1000.00",
      takeaway_delivery_total: "0.00", service_total: "0.00",
      waiter_service_total: "10.00", dishes_count: "1.000", dishes: [],
    }],
    totals: TOTALS,
  };
}

function lastServicePercent() {
  const calls = reportsService.listWaiters.mock.calls;
  return calls[calls.length - 1][2].filters.servicePercent;
}

// Always re-query: the report shell swaps its first paint (initial loader),
// so captured nodes must never be reused across renders.
function els() {
  const input = screen.getByRole("spinbutton", { name: "Процент обслуживания" });
  const stepper = input.closest(".waiters-percent-stepper");
  return {
    input,
    stepper,
    suffix: stepper.querySelector(".waiters-percent-stepper__suffix"),
    up: stepper.querySelector(".waiters-percent-stepper__up"),
    down: stepper.querySelector(".waiters-percent-stepper__down"),
  };
}

// 0% is the REAL initial value with a muted default look: the initial DATA
// request fires with explicit service_percent=0, so rows/totals always come
// from the backend. Geometry stays anchored (right-aligned fixed slot, one
// fixed "%" slot, overlay-only arrows); typography stays inherited.
describe("waiters percent control stability", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    reportsService.getWaitersFilters.mockResolvedValue({ data: { waiters: [] } });
  });

  it("starts at real muted 0 with an initial DATA request for service_percent=0", async () => {
    reportsService.listWaiters.mockResolvedValue({ data: rowsWith("Жасур") });
    render(<WaitersReportPage />);
    expect(await screen.findByText("Жасур")).toBeInTheDocument();
    const { input, stepper } = els();
    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveValue(0);
    expect(input).toHaveAttribute("placeholder", "0");
    expect(stepper).toHaveClass("is-empty");
    expect(reportsService.listWaiters).toHaveBeenCalledTimes(1);
    expect(lastServicePercent()).toBe("0");
  });

  it("steps UP 0→1 and clamps DOWN at 0 without going negative", async () => {
    reportsService.listWaiters.mockResolvedValue({ data: rowsWith("Жасур") });
    render(<WaitersReportPage />);
    await screen.findByText("Жасур");

    fireEvent.click(els().up);
    await waitFor(() => expect(lastServicePercent()).toBe("1"));
    expect(els().input).toHaveValue(1);
    expect(els().stepper).not.toHaveClass("is-empty");

    fireEvent.click(els().down);
    await waitFor(() => expect(lastServicePercent()).toBe("0"));
    expect(els().input).toHaveValue(0);
    expect(els().stepper).toHaveClass("is-empty");

    const callsBefore = reportsService.listWaiters.mock.calls.length;
    fireEvent.click(els().down);
    await sleep_tick();
    expect(els().input).toHaveValue(0);
    // Clamped: still exactly one "0" request, no negative value ever stored.
    expect(
      reportsService.listWaiters.mock.calls.filter((c) => c[2].filters.servicePercent === "0").length
    ).toBeGreaterThan(0);
    expect(reportsService.listWaiters.mock.calls.length).toBeLessThanOrEqual(callsBefore + 1);
  });

  it("supports direct typing and normalizes a cleared field back to 0", async () => {
    reportsService.listWaiters.mockResolvedValue({ data: rowsWith("Жасур") });
    render(<WaitersReportPage />);
    await screen.findByText("Жасур");
    const nodeBefore = els().input;

    fireEvent.change(els().input, { target: { value: "25" } });
    fireEvent.blur(els().input);
    await waitFor(() => expect(lastServicePercent()).toBe("25"));
    expect(els().stepper).not.toHaveClass("is-empty");

    fireEvent.change(els().input, { target: { value: "100" } });
    fireEvent.blur(els().input);
    await waitFor(() => expect(lastServicePercent()).toBe("100"));

    // Manual clear is transient while editing; commit restores real 0.
    fireEvent.change(els().input, { target: { value: "" } });
    expect(els().input.value).toBe("");
    fireEvent.blur(els().input);
    await waitFor(() => expect(lastServicePercent()).toBe("0"));
    expect(els().input).toHaveValue(0);
    expect(els().stepper).toHaveClass("is-empty");
    expect(screen.queryByText("Введите целое число от 0 до 100.")).toBeNull();

    fireEvent.change(els().input, { target: { value: "" } });
    fireEvent.blur(els().input);
    await waitFor(() => expect(els().input).toHaveValue(0));
    expect(els().input).toBe(nodeBefore);
    expect(nodeBefore.isConnected).toBe(true);
  });

  it("strips leading zeroes as typed, never showing 012", async () => {
    reportsService.listWaiters.mockResolvedValue({ data: rowsWith("Жасур") });
    render(<WaitersReportPage />);
    await screen.findByText("Жасур");

    // Real typing appends onto the initial "0": raw "01" must display "1".
    fireEvent.change(els().input, { target: { value: "01" } });
    expect(els().input.value).toBe("1");
    fireEvent.blur(els().input);
    await waitFor(() => expect(lastServicePercent()).toBe("1"));

    fireEvent.change(els().input, { target: { value: "012" } });
    expect(els().input.value).toBe("12");
    fireEvent.blur(els().input);
    await waitFor(() => expect(lastServicePercent()).toBe("12"));
    fireEvent.change(els().input, { target: { value: "0012" } });
    expect(els().input.value).toBe("12");

    fireEvent.change(els().input, { target: { value: "025" } });
    expect(els().input.value).toBe("25");

    fireEvent.change(els().input, { target: { value: "0100" } });
    expect(els().input.value).toBe("100");
    fireEvent.blur(els().input);
    await waitFor(() => expect(lastServicePercent()).toBe("100"));

    fireEvent.change(els().input, { target: { value: "00" } });
    expect(els().input.value).toBe("0");
  });

  it("keeps typography inherited and the suffix fixed while stepping ±1", async () => {
    reportsService.listWaiters.mockResolvedValue({ data: rowsWith("Жасур") });
    render(<WaitersReportPage />);
    await screen.findByText("Жасур");
    let { input, stepper, suffix, up } = els();
    expect(stepper.querySelector(".waiters-percent-stepper__down")).not.toBeNull();

    // No inline typography: input + suffix inherit the approved Golos stack
    // from the stylesheet (guards against per-control font experiments).
    expect(input.style.fontFamily).toBe("");
    expect(input.style.fontWeight).toBe("");
    expect(input.style.fontSize).toBe("");
    expect(suffix.style.fontFamily).toBe("");

    fireEvent.click(up);
    await waitFor(() => expect(lastServicePercent()).toBe("1"));
    // NOTE: jsdom serializes calc operands sorted ("0.5ch + 33px").
    ({ input, stepper, suffix, up } = els());
    expect(suffix.style.left).toBe("calc(0.5ch + 33px)");

    const nodeBefore = input;
    fireEvent.click(up);
    await waitFor(() => expect(lastServicePercent()).toBe("2"));
    ({ input, stepper, suffix } = els());
    expect(input).toBe(nodeBefore);
    expect(nodeBefore.isConnected).toBe(true);
    expect(suffix.style.left).toBe("calc(0.5ch + 33px)");
  });

  it("renders the shell immediately with no visible loader until the first DATA response", async () => {
    let resolveFirst;
    reportsService.listWaiters.mockReturnValueOnce(
      new Promise((resolve) => { resolveFirst = resolve; })
    );
    render(<WaitersReportPage />);
    // Shell first: title, controls and table header mount while pending.
    expect(screen.getByRole("heading", { name: "Отчёт по официантам" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0);
    // No visible loading indicator anywhere (only screen-reader-neutral busy).
    expect(screen.queryByText("Загрузка отчёта...")).toBeNull();
    expect(document.querySelector(".waiters-report-page .dashboard-empty")).toBeNull();
    expect(document.querySelector(".waiters-report-page .report-loading-row")).toBeNull();
    expect(screen.queryByText("Жасур")).toBeNull();
    resolveFirst({ data: rowsWith("Жасур") });
    // Only the resolved response populates rows — nothing synthesized.
    expect(await screen.findByText("Жасур")).toBeInTheDocument();
  });

  it("keeps stale rows and totals mounted while a percent refetch pends", async () => {
    reportsService.listWaiters.mockResolvedValue({ data: rowsWith("Жасур") });
    render(<WaitersReportPage />);
    await screen.findByText("Жасур");
    const staleTotal = document.querySelector(".waiters-report-page .report-total-row").innerHTML;
    expect(screen.getByText("Всего")).toBeInTheDocument();

    let resolveRefetch;
    reportsService.listWaiters.mockReturnValueOnce(
      new Promise((resolve) => { resolveRefetch = resolve; })
    );
    fireEvent.click(els().up);
    // Pending: stale truthful content stays, no initial loader returns.
    await waitFor(() => expect(lastServicePercent()).toBe("1"));
    expect(screen.getByText("Жасур")).toBeInTheDocument();
    expect(screen.getByText("Всего")).toBeInTheDocument();
    expect(document.querySelector(".waiters-report-page .report-total-row").innerHTML).toBe(staleTotal);
    expect(screen.queryByText("Загрузка отчёта...")).toBeNull();
    expect(document.querySelector(".waiters-report-page .dashboard-empty")).toBeNull();

    resolveRefetch({ data: rowsWith("Валишер") });
    expect(await screen.findByText("Валишер")).toBeInTheDocument();
  });

  it("keeps the zero-data structure stable while a refetch pends", async () => {
    const zero = {
      rows: [],
      totals: {
        orders_count: 0, orders_total: "0.00", takeaway_delivery_total: "0.00",
        service_total: "0.00", waiter_service_total: "0.00", dishes_count: "0",
      },
    };
    reportsService.listWaiters.mockResolvedValue({ data: zero });
    render(<WaitersReportPage />);
    await waitFor(() => expect(reportsService.listWaiters).toHaveBeenCalled());
    expect(screen.getByText("Всего")).toBeInTheDocument();

    let resolveRefetch;
    reportsService.listWaiters.mockReturnValueOnce(
      new Promise((resolve) => { resolveRefetch = resolve; })
    );
    fireEvent.click(els().up);
    await waitFor(() => expect(lastServicePercent()).toBe("1"));
    // Zero structure (totals row, no rows) persists through the pending phase.
    expect(screen.getByText("Всего")).toBeInTheDocument();
    expect(document.querySelector(".waiters-report-page .dashboard-empty")).toBeNull();

    resolveRefetch({ data: zero });
    await waitFor(() => expect(lastServicePercent()).toBe("1"));
    expect(screen.getByText("Всего")).toBeInTheDocument();
  });

  it("lets the latest percent request win over a slower older one", async () => {
    reportsService.listWaiters.mockResolvedValue({ data: rowsWith("Жасур") });
    render(<WaitersReportPage />);
    await screen.findByText("Жасур");

    let resolveOld, resolveNew;
    reportsService.listWaiters
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveNew = resolve; }));
    fireEvent.click(els().up); // -> 1 (slow)
    await waitFor(() => expect(lastServicePercent()).toBe("1"));
    fireEvent.click(els().up); // -> 2 (fast)
    await waitFor(() => expect(lastServicePercent()).toBe("2"));
    resolveNew({ data: rowsWith("Валишер") });
    expect(await screen.findByText("Валишер")).toBeInTheDocument();
    // The stale response must not overwrite the latest state.
    resolveOld({ data: rowsWith("Старый") });
    await sleep_tick();
    expect(screen.queryByText("Старый")).toBeNull();
    expect(screen.getByText("Валишер")).toBeInTheDocument();
  });

  it("neutralizes the global dashboard input focus ring on the stepper input", () => {
    // MICRO-JITTER-03: `.dashboard-shell input:focus` (react-overrides.css)
    // paints a rectangular glow on the square input inside the rounded pill.
    // This source-level guard keeps the neutralization while typography stays
    // inherited (no per-control font-family).
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../styles/owner/reports.css"),
      "utf8"
    );
    const block = css.match(
      /\.waiters-report-page\s+\.waiters-percent-stepper\s+input:focus\s*\{[^}]*\}/
    );
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/box-shadow\s*:\s*none/);
    const inputRule = css.match(
      /\.waiters-report-page\s+\.waiters-percent-stepper\s+input\s*\{[^}]*\}/
    );
    expect(inputRule).not.toBeNull();
    expect(inputRule[0]).not.toMatch(/font-family/);
  });
});

function sleep_tick() {
  return new Promise((resolve) => { setTimeout(resolve, 50); });
}
