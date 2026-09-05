import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportsService } from "../api/reports";
import { staffService } from "../api/staff";
import { settingsService } from "../api/settings";
import { getCategories } from "../api/categories";
import { todayInputValue } from "../utils/date";
import {
  buildZReportDetailPrintDocument,
  INVISIBLE_TITLE,
  PRINT_WAIT_TEXT,
} from "./reports/zReportDetailPrint";
import ZReportPage from "./ZReportPage";

vi.mock("../api/reports", () => ({ reportsService: { getZReport: vi.fn(), getZReportDetail: vi.fn() } }));
vi.mock("../api/staff", () => ({ staffService: { listStaffUsers: vi.fn() } }));
vi.mock("../api/settings", () => ({ settingsService: { listPlaces: vi.fn(), listDashboardPlaces: vi.fn() } }));
vi.mock("../api/categories", () => ({ getCategories: vi.fn() }));
vi.mock("../components/ReportDateRangePicker", () => ({
  // Stand-in for the approved canonical picker plus two test-only affordances:
  // switch the report into multi-day period mode, and commit a window whose
  // start/end TIMES differ from the 00:00 default (the real picker's calendar and
  // its DD.MM.YYYY | HH:MM display are covered by its own suite / the browser
  // oracle). ZR-PRINT-FINAL-UX-06 prints that committed time, so the page needs a
  // way to commit one.
  default: ({ onChange }) => (
    <>
      <button type="button">Период Z-отчёта</button>
      <button
        type="button"
        onClick={() => onChange({ preset: "", start: "01.08.2026", end: "31.08.2026" })}
      >
        set-period
      </button>
      <button
        type="button"
        onClick={() => onChange({
          preset: "", start: "01.09.2026", end: "04.09.2026", startTime: "13:23", endTime: "22:06",
        })}
      >
        set-period-with-time
      </button>
    </>
  ),
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
  // `percent` is the Hall's own pre-existing SERVICE-FEE percent. It is NOT the
  // waiter percentage, and the value below deliberately equals the reference 12%
  // so any accidental use of it would still be caught by the assertions below.
  { id: "hall-1", name: "Во дворе", percent: 12 },
  { id: "hall-2", name: "Балкон", percent: 20 },
];
const BRANCHES = [{ id: "b1", name: "Основной филиал" }];
const TODAY = todayInputValue();
const TODAY_DISPLAY = TODAY.split("-").reverse().join(".");

// --- per-entity detail fixtures ---------------------------------------------
// Shaped exactly like the live canonical GET /analytics/z-report/detail:
// money as Decimal strings, unattributable figures as null (never 0).
function figures(overrides = {}) {
  return {
    orders_count: 0,
    cancelled_orders_count: 0,
    payments_count: 0,
    fiscal_receipts_count: 0,
    gross_sales: "0",
    discounts_total: "0",
    service_fee_total: "0",
    tax_total: "0",
    refunds_total: "0",
    net_sales: "0",
    cash_total: "0",
    cash_received_total: "0",
    change_given_total: "0",
    non_cash_total: "0",
    avg_check: "0",
    payment_methods: [],
    ...overrides,
  };
}

function entity(id, name, overrides = {}) {
  return {
    entity_id: id,
    entity_name: name,
    entity_is_active: true,
    entity_deleted: false,
    figures: figures(overrides),
  };
}

function detailResponse(dimension, entities, extra = {}) {
  return {
    dimension,
    date: TODAY,
    date_from: null,
    date_to: null,
    entities,
    totals: figures(),
    unsupported_fields: [],
    coverage: [],
    ...extra,
  };
}

const CASHIER_COVERAGE = [
  {
    code: "CASHIER_UNATTRIBUTED_PAYMENTS_EXCLUDED",
    message: "Платежи без кассира (шлюзовые оплаты) не входят ни в один отчёт по кассиру.",
  },
];

function normalize(text) {
  // JS \s already covers the ru-RU NBSP group separator, so printed sums
  // collapse to plain single spaces for readable assertions.
  return String(text).replace(/\s+/g, " ").trim();
}

// Table rows of the generated print document, as [label, ...values].
function printRows(doc) {
  return Array.from(doc.querySelectorAll("tr")).map((tr) =>
    Array.from(tr.children).map((cell) => normalize(cell.textContent)));
}

function printCell(doc, label) {
  const found = printRows(doc).find((cells) => cells[0] === label);
  return found ? found[1] : undefined;
}

// Last column ("Обслуга официанта") of the four-column waiter row with this name.
function waiterServiceCell(doc, name) {
  const found = printRows(doc).find((cells) => cells.length === 4 && cells[0] === name);
  return found ? found[3] : undefined;
}

function percentInput() {
  return screen.getByRole("spinbutton", { name: "Процент официанта" });
}

function selectEntity(rowTitle, optionName) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${rowTitle}`) }));
  fireEvent.click(screen.getByRole("option", { name: optionName }));
  fireEvent.keyDown(document, { key: "Escape" });
}

// The product opens a DEDICATED print document in its own tab
// (ZR-PRINT-REFERENCE-FLOW-07), synchronously inside the click handler so the
// popup blocker allows it. jsdom has no real tabs, so window.open hands back a
// same-document stand-in — an iframe's contentWindow. Everything the product then
// does to it is real: the waiting document, the report write, the readiness gate,
// print(). Only the tab itself is simulated, and the popup-blocked fallback
// (window.open → null → hidden iframe) has its own test.
let printView;

function stubPrintWindow() {
  const host = document.createElement("iframe");
  host.setAttribute("data-print-window", "true");
  document.body.appendChild(host);
  printView = host.contentWindow;
  printView.print = vi.fn();
  printView.focus = vi.fn();
  printView.close = vi.fn();
  vi.spyOn(window, "open").mockReturnValue(printView);
  return printView;
}

async function printDetail(rowTitle) {
  fireEvent.click(screen.getByRole("button", { name: `Печать: ${rowTitle}` }));
  await waitFor(() => expect(printView.document.querySelector(".zrd-doc")).not.toBeNull());
  return printView.document;
}

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

  // ZR-PRINT-01C: cashier / waiter / place Print became REAL against
  // GET /analytics/z-report/detail. Menu has no detail dimension and therefore
  // keeps its truthful DEFERRED state — a disabled button, never a fake print.
  it("per-entity Print is disabled until an entity is selected; menu Print stays deferred", async () => {
    render(<ZReportPage />);
    await screen.findByRole("button", { name: "Отчёт по официантам" });

    const cashier = screen.getByRole("button", { name: "Печать: Отчёт по кассирам" });
    const waiter = screen.getByRole("button", { name: "Печать: Отчёт по официантам" });
    const place = screen.getByRole("button", { name: "Печать: Отчёт по местам" });
    const menu = screen.getByRole("button", { name: "Печать недоступна: отчёт ещё не подключён" });

    for (const button of [cashier, waiter, place]) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAttribute("title", "Выберите хотя бы одну позицию");
    }
    expect(menu).toBeDisabled();
    expect(menu).toHaveAttribute("title", "Отчёт ещё не подключён");
    expect(screen.queryByRole("button", { name: "Печать: Отчёт по меню" })).toBeNull();

    selectEntity("Отчёт по кассирам", "Мансур");
    expect(cashier).toBeEnabled();
    expect(cashier).not.toHaveAttribute("aria-disabled");
    expect(cashier).not.toHaveAttribute("title");
    expect(waiter).toBeDisabled();
    expect(place).toBeDisabled();

    selectEntity("Отчёт по официантам", "Шерзод");
    expect(waiter).toBeEnabled();

    selectEntity("Отчёт по местам", "Балкон");
    expect(place).toBeEnabled();

    // menu never becomes actionable, and no request is ever made for it
    expect(menu).toBeDisabled();
    expect(reportsService.getZReportDetail).not.toHaveBeenCalled();

    // deselecting the only cashier takes its Print back to disabled
    selectEntity("Отчёт по кассирам", "Мансур");
    expect(cashier).toBeDisabled();

    // ALIGNMENT-03: the whole-shift "Печать общего Z-отчёта" action is gone —
    // per-entity print is the only print on this page now
    expect(screen.queryByRole("button", { name: /Печать общего Z-отчёта/ })).toBeNull();
    expect(document.querySelector(".owner-reports__shift-print")).toBeNull();
    expect(reportsService.getZReport).not.toHaveBeenCalled();
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

describe("ZReportPage per-entity Print (ZR-PRINT-01C)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportsService.getZReport.mockResolvedValue({ data: Z });
    reportsService.getZReportDetail.mockResolvedValue({
      data: detailResponse("cashier", [entity("c1", "Мансур")]),
    });
    staffService.listStaffUsers.mockResolvedValue({ data: STAFF });
    settingsService.listPlaces.mockResolvedValue({ data: HALLS });
    settingsService.listDashboardPlaces.mockResolvedValue({ data: BRANCHES });
    getCategories.mockResolvedValue({ data: [] });
    stubPrintWindow();
  });

  async function ready() {
    render(<ZReportPage />);
    await screen.findByRole("button", { name: "Отчёт по официантам" });
  }

  // Print surfaces are left in place by the product on purpose (the reference
  // flow keeps the printable document after Cancel); in jsdom nothing tears them
  // down, so the stand-in and any fallback frame are cleared between tests.
  afterEach(() => {
    document.querySelectorAll("iframe").forEach((frame) => frame.remove());
  });

  it("requests exactly one dimension with canonical repeated ids in single-date mode", async () => {
    await ready();

    selectEntity("Отчёт по кассирам", "Мансур");
    await printDetail("Отчёт по кассирам");
    expect(reportsService.getZReportDetail).toHaveBeenLastCalledWith({
      date: TODAY, dimension: "cashier", ids: ["c1"],
    });

    selectEntity("Отчёт по официантам", "Шерзод");
    selectEntity("Отчёт по официантам", "Алишер");
    reportsService.getZReportDetail.mockResolvedValue({
      data: detailResponse("waiter", [entity("w1", "Шерзод"), entity("w2", "Алишер")]),
    });
    await printDetail("Отчёт по официантам");
    expect(reportsService.getZReportDetail).toHaveBeenLastCalledWith({
      date: TODAY, dimension: "waiter", ids: ["w1", "w2"],
    });

    selectEntity("Отчёт по местам", "Балкон");
    reportsService.getZReportDetail.mockResolvedValue({
      data: detailResponse("hall", [entity("hall-2", "Балкон")]),
    });
    await printDetail("Отчёт по местам");
    expect(reportsService.getZReportDetail).toHaveBeenLastCalledWith({
      date: TODAY, dimension: "hall", ids: ["hall-2"],
    });

    // never a menu dimension, never a percentage, never two date modes at once
    for (const [params] of reportsService.getZReportDetail.mock.calls) {
      expect(params.dimension).not.toBe("menu");
      expect(params).not.toHaveProperty("waiter_percent");
      expect(params).not.toHaveProperty("date_from");
      expect(params).not.toHaveProperty("date_to");
    }
  });

  it("switches the detail request to period mode exactly as the picker displays it", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "set-period" }));
    reportsService.getZReportDetail.mockResolvedValue({
      data: detailResponse("hall", [entity("hall-1", "Во дворе")], {
        date: "2026-08-31", date_from: "2026-08-01", date_to: "2026-08-31",
      }),
    });

    selectEntity("Отчёт по местам", "Во дворе");
    const doc = await printDetail("Отчёт по местам");
    expect(reportsService.getZReportDetail).toHaveBeenLastCalledWith({
      date_from: "2026-08-01", date_to: "2026-08-31", dimension: "hall", ids: ["hall-1"],
    });
    expect(reportsService.getZReportDetail.mock.calls.at(-1)[0]).not.toHaveProperty("date");
    // ZR-PRINT-FINAL-UX-06: the printed head names the SCREEN window — both
    // endpoints with the selected clock time, joined by " - ". The request itself
    // stays date-only, which is exactly why the time can only come from the picker.
    expect(normalize(doc.body.textContent))
      .toContain("Период: 01.08.2026 00:00 - 31.08.2026 00:00");
    // never the general report's preposition phrasing, and never the en dash the
    // earlier backend-echo version used
    expect(normalize(doc.body.textContent)).not.toContain("за период");
    expect(normalize(doc.body.textContent)).not.toContain("Дата:");
    expect(normalize(doc.body.textContent)).not.toContain("–");
  });

  // ZR-PRINT-FINAL-UX-06 fix 3, end to end: the clock time the OWNER committed in
  // the picker reaches the printed head, even though the request that produced
  // the figures is date-only. Proven with two DIFFERENT times so a hardcoded
  // 00:00 or a copied start time cannot pass.
  it("prints the committed start and end TIME from the screen picker", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "set-period-with-time" }));
    reportsService.getZReportDetail.mockResolvedValue({
      data: detailResponse("cashier", [entity("c1", "Мансур")], {
        date: null, date_from: "2026-09-01", date_to: "2026-09-04",
      }),
    });

    selectEntity("Отчёт по кассирам", "Мансур");
    const doc = await printDetail("Отчёт по кассирам");

    expect(normalize(doc.querySelector(".zrd-period").textContent))
      .toBe("Период: 01.09.2026 13:23 - 04.09.2026 22:06");
    // the API still receives the date-only window: no time ever leaves the browser
    const params = reportsService.getZReportDetail.mock.calls.at(-1)[0];
    expect(params).toEqual({ date_from: "2026-09-01", date_to: "2026-09-04", dimension: "cashier", ids: ["c1"] });
    expect(JSON.stringify(params)).not.toContain("13:23");
  });

  it("waiter print applies the entered percent to СУММА ЗАКАЗОВ (net_sales), never to the service fee", async () => {
    reportsService.getZReportDetail.mockResolvedValue({
      data: detailResponse("waiter", [
        entity("w1", "Шерзод", {
          net_sales: "205000.00", service_fee_total: "20500.00", orders_count: 4, avg_check: "51250.00",
        }),
      ]),
    });
    await ready();
    selectEntity("Отчёт по официантам", "Шерзод");
    fireEvent.change(percentInput(), { target: { value: "12" } });
    const doc = await printDetail("Отчёт по официантам");

    expect(printRows(doc).filter((cells) => cells.length === 4)).toEqual([
      ["Имя", "Сумма заказов", "Сумма услуги", "Обслуга официанта"],
      ["Шерзод", "205 000 UZS", "20 500 UZS", "24 600 UZS"],
    ]);
    // the percent is stated ONCE in the caption, never as a fourth data column,
    // and one waiter gets no Итого line that would restate the same row
    expect(normalize(doc.body.textContent)).toContain("Обслуга по официантам (процент: 12%)");
    expect(normalize(doc.body.textContent)).not.toContain("Итого");
    // 20 500 × 12% = 2 460 is the WRONG base and must never appear
    expect(normalize(doc.body.textContent)).not.toContain("2 460");
    // no binary-float residue such as 24 599,999
    expect(normalize(doc.body.textContent)).not.toMatch(/24 5\d\d/);
    // the percentage is a print-time presentation, never a backend parameter
    expect(reportsService.getZReportDetail).toHaveBeenCalledWith({
      date: TODAY, dimension: "waiter", ids: ["w1"],
    });
  });

  it("applies ONE percent to every selected waiter and foots the printed total", async () => {
    reportsService.getZReportDetail.mockResolvedValue({
      data: detailResponse("waiter", [
        entity("w1", "Шерзод", { net_sales: "205000.00", service_fee_total: "20500.00" }),
        entity("w2", "Алишер", { net_sales: "300000.00", service_fee_total: "0" }),
      ], {
        totals: figures({ net_sales: "505000.00", service_fee_total: "20500.00", avg_check: "50500.00" }),
      }),
    });
    await ready();
    selectEntity("Отчёт по официантам", "Шерзод");
    selectEntity("Отчёт по официантам", "Алишер");
    fireEvent.change(percentInput(), { target: { value: "12" } });
    const doc = await printDetail("Отчёт по официантам");

    // Имя | Сумма заказов | Сумма услуги | Обслуга официанта
    expect(printRows(doc).filter((cells) => cells.length === 4)).toEqual([
      ["Имя", "Сумма заказов", "Сумма услуги", "Обслуга официанта"],
      ["Шерзод", "205 000 UZS", "20 500 UZS", "24 600 UZS"],
      ["Алишер", "300 000 UZS", "0 UZS", "36 000 UZS"],
      ["Итого", "505 000 UZS", "20 500 UZS", "60 600 UZS"],
    ]);
    // 24 600 + 36 000 = 60 600 = 505 000 × 12% — the printed table reconciles
    expect(normalize(doc.body.textContent)).toContain("Обслуга по официантам (процент: 12%)");
    // exactly one percent control exists; there is no per-waiter percentage
    expect(screen.getAllByRole("spinbutton", { name: "Процент официанта" })).toHaveLength(1);
  });

  it("keeps the waiter service amount unknown for an empty or out-of-range percent", async () => {
    reportsService.getZReportDetail.mockResolvedValue({
      data: detailResponse("waiter", [
        entity("w1", "Шерзод", { net_sales: "205000.00", service_fee_total: "20500.00" }),
      ]),
    });
    await ready();
    selectEntity("Отчёт по официантам", "Шерзод");

    const empty = await printDetail("Отчёт по официантам");
    expect(normalize(empty.body.textContent)).toContain("Обслуга по официантам (процент: не задан)");
    expect(waiterServiceCell(empty, "Шерзод")).toBe("Не определено");
    // the base figures are still printed truthfully — only the derived amount
    // is unknown, and it is never silently shown as 0 UZS
    expect(printRows(empty).find((cells) => cells[0] === "Шерзод"))
      .toEqual(["Шерзод", "205 000 UZS", "20 500 UZS", "Не определено"]);

    fireEvent.change(percentInput(), { target: { value: "150" } });
    const invalid = await printDetail("Отчёт по официантам");
    expect(normalize(invalid.body.textContent))
      .toContain("Обслуга по официантам (процент: недопустимое значение)");
    expect(waiterServiceCell(invalid, "Шерзод")).toBe("Не определено");

    // 0% is a real percentage, not a missing one
    fireEvent.change(percentInput(), { target: { value: "0" } });
    const zero = await printDetail("Отчёт по официантам");
    expect(normalize(zero.body.textContent)).toContain("Обслуга по официантам (процент: 0%)");
    expect(waiterServiceCell(zero, "Шерзод")).toBe("0 UZS");
  });

  // ALIGNMENT-03: the cashier block is the payment-method breakdown and its
  // total, matching the reference print flow. Order-level money (валовые
  // продажи, скидки, налог, средний чек) and the counters are no longer printed —
  // a cashier owns an order only through the payment that closed it.
  it("prints the cashier block as payment methods with an exactly footing total", async () => {
    reportsService.getZReportDetail.mockResolvedValue({
      data: detailResponse("cashier", [
        entity("c1", "Мансур", {
          cancelled_orders_count: null,
          refunds_total: null,
          orders_count: 0,
          payments_count: 2,
          gross_sales: "150000",
          net_sales: "0",
          payment_methods: [
            { method: "cash", count: 1, amount: "900000.00" },
            { method: "card", count: 1, amount: "1600000.50" },
          ],
        }),
      ], {
        totals: figures({ cancelled_orders_count: null, refunds_total: null, payments_count: 2 }),
        unsupported_fields: ["cancelled_orders_count", "refunds_total"],
        coverage: CASHIER_COVERAGE,
      }),
    });
    await ready();
    selectEntity("Отчёт по кассирам", "Мансур");
    const doc = await printDetail("Отчёт по кассирам");
    const text = normalize(doc.body.textContent);

    // method → amount, then Итого = the exact sum of those rows (half-up once)
    expect(printRows(doc)).toEqual([
      ["cash", "900 000 UZS"],
      ["card", "1 600 001 UZS"],
      ["Итого", "2 500 001 UZS"],
    ]);
    // the removed order-level rows must not come back
    for (const label of ["Валовые продажи", "Скидки", "Налог", "Средний чек", "Чистые продажи",
      "Заказы", "Отменённые заказы", "Оплаты", "Фискальные чеки", "Показатели", "Способы оплаты"]) {
      expect(text).not.toContain(label);
    }
    // ZR-PRINT-FINAL-UX-05: the response still CARRIES `coverage`, but the
    // document prints no «Примечание» block at all — neither the human message
    // nor the machine code reaches the sheet.
    expect(text).not.toContain("Примечание");
    expect(text).not.toContain(CASHIER_COVERAGE[0].message);
    expect(text).not.toContain("CASHIER_UNATTRIBUTED_PAYMENTS_EXCLUDED");
    // cashier detail is "orders closed by this cashier" — not a cash shift
    expect(text).not.toContain("кассовая смена");
    expect(text).not.toContain("Смена закрыта");
    expect(text).not.toContain("09:00");
    // the heading is the CLICKED row's own plural name, printed exactly once
    expect(text).toContain("Отчёт по кассирам");
    expect(text.match(/Отчёт по/g)).toHaveLength(1);
    expect(text).toContain("Имя: Мансур");
    // ZR-PRINT-FINAL-UX-06: one label («Период»), both endpoints, selected time
    expect(text).toContain(`Период: ${TODAY_DISPLAY} 00:00 - ${TODAY_DISPLAY} 00:00`);
    expect(text).not.toContain("Дата:");
  });

  it("keeps a cashier without payments truthfully empty instead of printing zeros", async () => {
    reportsService.getZReportDetail.mockResolvedValue({
      data: detailResponse("cashier", [entity("c1", "Мансур", { payment_methods: [] })]),
    });
    await ready();
    selectEntity("Отчёт по кассирам", "Мансур");
    const doc = await printDetail("Отчёт по кассирам");

    expect(normalize(doc.body.textContent)).toContain("Нет оплат за выбранный период");
    expect(printCell(doc, "Итого")).toBe("0 UZS");
  });

  it("prints one section per entity in backend order with backend union totals and no forced page breaks", async () => {
    reportsService.getZReportDetail.mockResolvedValue({
      data: detailResponse("hall", [
        entity("hall-2", "Балкон", {
          orders_count: 3, gross_sales: "80000", discounts_total: "5000",
          service_fee_total: "8000", tax_total: "7000", net_sales: "90000",
        }),
        entity("hall-1", "Во дворе", { orders_count: 1, net_sales: "10000" }),
      ], {
        totals: figures({
          orders_count: 4, gross_sales: "90000", discounts_total: "5000",
          service_fee_total: "8000", tax_total: "7000", net_sales: "100000",
        }),
        coverage: [{ code: "HALL_TABLELESS_ORDERS_EXCLUDED", message: "Заказы без стола не относятся ни к одному месту." }],
      }),
    });
    await ready();
    selectEntity("Отчёт по местам", "Балкон");
    selectEntity("Отчёт по местам", "Во дворе");
    const doc = await printDetail("Отчёт по местам");

    expect(reportsService.getZReportDetail).toHaveBeenLastCalledWith({
      date: TODAY, dimension: "hall", ids: ["hall-2", "hall-1"],
    });

    const sections = doc.querySelectorAll("section.zrd-section");
    expect(sections).toHaveLength(3); // two entity sections + union totals
    expect(normalize(sections[0].textContent)).toContain("Место: Балкон");
    expect(normalize(sections[1].textContent)).toContain("Место: Во дворе");
    expect(normalize(sections[2].textContent)).toContain("Итого по выбранным местам");
    expect(normalize(sections[2].textContent)).toContain("Места: Балкон, Во дворе");
    // sections FLOW down the sheet: a forced break per entity turned a two-place
    // report into a sheet each plus a trailing blank page, so only break-inside
    // is constrained now — a block moves whole instead of being cut mid-table
    expect(doc.querySelectorAll("section.zrd-section--break")).toHaveLength(0);
    const css = doc.querySelector("style").textContent;
    expect(css).toMatch(/@media print\{[\s\S]*break-inside:avoid/);
    expect(css).not.toMatch(/break-before:page/);
    // ZR-PRINT-FINAL-UX-06: the place block is Кол-во заказов / Сумма блюд /
    // Сумма обслуживания / Итого and NOTHING else — Скидки and Налог were removed
    // at the user's explicit request. Итого stays the backend's own net_sales
    // (90 000), so it is still correct even though the visible rows no longer
    // reconstruct it once a discount (5 000) or a tax (7 000) exists.
    expect(printRows(sections[0])).toEqual([
      ["Кол-во заказов", "3"],
      ["Сумма блюд", "80 000 UZS"],
      ["Сумма обслуживания", "8 000 UZS"],
      ["Итого", "90 000 UZS"],
    ]);
    for (const gone of ["Скидки", "Налог"]) {
      expect(normalize(doc.body.textContent)).not.toContain(gone);
    }
    // the removed rows are gone from the union block too, with the same shape
    expect(printRows(sections[2]).map(([label]) => label))
      .toEqual(["Кол-во заказов", "Сумма блюд", "Сумма обслуживания", "Итого"]);
    // union figures come from backend totals, never a frontend sum/average
    expect(printCell(sections[2], "Кол-во заказов")).toBe("4");
    expect(printCell(sections[2], "Итого")).toBe("100 000 UZS");
    // the long generic metric list and the payments table are gone
    for (const label of ["Показатели", "Способы оплаты", "Средний чек", "Валовые продажи",
      "Чистые продажи", "Наличные", "Фискальные чеки", "Возвраты"]) {
      expect(normalize(doc.body.textContent)).not.toContain(label);
    }
    // ZR-PRINT-FINAL-UX-05: hall coverage is not printed either — the document
    // carries no «Примечание» block for ANY dimension
    expect(normalize(doc.body.textContent)).not.toContain("Заказы без стола не относятся ни к одному месту.");
    expect(normalize(doc.body.textContent)).not.toContain("Примечание");
    // the Hall's own service-fee percent (12 / 20 in the fixture) never leaks
    // into the place document as a waiter percentage
    expect(normalize(doc.body.textContent)).not.toContain("Процент официанта");
    expect(normalize(doc.body.textContent)).not.toContain("Обслуга официанта");
    expect(normalize(doc.body.textContent)).not.toContain("12%");
    expect(normalize(doc.body.textContent)).not.toContain("20%");
  });

  it("does not duplicate an identical totals page for a single selected entity", async () => {
    await ready();
    selectEntity("Отчёт по кассирам", "Мансур");
    const doc = await printDetail("Отчёт по кассирам");

    expect(doc.querySelectorAll("section.zrd-section")).toHaveLength(1);
    expect(doc.querySelectorAll("section.zrd-section--break")).toHaveLength(0);
    expect(normalize(doc.body.textContent)).not.toContain("Итого по выбранным");
    // the entity is identified by name — never by its id
    expect(doc.body.textContent).not.toMatch(/\bc1\b/);
  });

  // --- print geometry (ZR-PRINT-VISUAL-PARITY-02) -----------------------------
  // jsdom has no layout, so these pin the CSS contract that produces the
  // proportions; the MEASURED ratio lives in tools/browser/owner-zreport.spec.js.
  it("renders the whole document inside one centred 108mm A4 column", async () => {
    reportsService.getZReportDetail.mockResolvedValue({
      data: detailResponse("cashier", [entity("c1", "Мансур")], { coverage: CASHIER_COVERAGE }),
    });
    await ready();
    selectEntity("Отчёт по кассирам", "Мансур");
    const doc = await printDetail("Отчёт по кассирам");
    const css = doc.querySelector("style").textContent;

    expect(css).toContain("@page{size:A4 portrait;margin:14mm}");
    expect(css).toContain(".zrd-doc{width:108mm;max-width:108mm;margin-left:auto;margin-right:auto}");
    // the column is the ONLY thing on the sheet, so nothing is centred while a
    // table still spans the printable width
    expect(doc.body.children).toHaveLength(1);
    const column = doc.body.firstElementChild;
    expect(column.className).toBe("zrd-doc");
    expect(column.querySelector(".zrd-doc-head")).not.toBeNull();
    expect(column.querySelectorAll("section.zrd-section").length).toBeGreaterThan(0);
    expect(column.querySelectorAll(".zrd-table").length).toBeGreaterThan(0);
    // ZR-PRINT-FINAL-UX-05: the notes block is GONE from the generated markup —
    // not merely hidden — so the column ends with the last accounting table.
    expect(column.querySelector(".zrd-notes")).toBeNull();
  });

  // ZR-PRINT-TYPOGRAPHY-CORRECTION: normal printable text is 14px Calibri in
  // #000000 with the reference's own `padding: 0 10px 0 0` on cells. The main
  // heading keeps its approved size and weight, and SIZE is still the only thing
  // that moves: the set of font-weight declarations is exactly the pre-existing one
  // (400 for table cells, 700 for the heading, the union section header, the waiter
  // caption and the totals rows), so nothing became bold by becoming bigger.
  it("uses the reference 14px Calibri body typography without adding weight", async () => {
    await ready();
    selectEntity("Отчёт по кассирам", "Мансур");
    const css = (await printDetail("Отчёт по кассирам")).querySelector("style").textContent;

    expect(css).toContain("body{font:14px/1.28 Calibri,sans-serif;color:#000000}");
    expect(css).toContain(".zrd-table th,.zrd-table td{border:0;border-bottom:1px dashed #808080;"
      + "padding:0 10px 0 0;text-align:left;font-weight:400;vertical-align:bottom}");
    // the approved heading is unchanged: 13pt, 700, italic
    expect(css).toContain(".zrd-title{margin:0;font-size:13pt;font-weight:700;font-style:italic}");
    // the period stays secondary to that heading, and below the body size
    expect(css).toMatch(/\.zrd-period\{[^}]*font-size:9pt/);
    // a bold section header must not end up SMALLER than the body it heads
    expect(css).toMatch(/\.zrd-head h2\{[^}]*font-size:14px/);
    // WEIGHT did not increase anywhere: same declarations as before the resize
    expect([...css.matchAll(/font-weight:(\d+)/g)].map(([, weight]) => weight).sort())
      .toEqual(["400", "700", "700", "700", "700"]);
    // column headers in particular stay normal weight
    expect(css).toMatch(/\.zrd-table th,\.zrd-table td\{[^}]*font-weight:400/);
    // the removed notes block leaves no styling behind either (ZR-PRINT-FINAL-UX-05)
    expect(css).not.toContain(".zrd-notes");
    // black text, and no colour smuggled in behind it
    expect(css).toContain("color:#000000");
    expect(css).not.toMatch(/color:#(?!000000|000\b)/);
    // thin dashed accounting rules, never boxed tables or filled headers
    expect(css).toContain("border-bottom:1px dashed #808080");
    expect(css).not.toMatch(/background:#(?!fff)/);
  });

  it("gives the waiter table the approved fixed column proportions", async () => {
    reportsService.getZReportDetail.mockResolvedValue({
      data: detailResponse("waiter", [entity("w1", "Шерзод", { net_sales: "205000.00" })]),
    });
    await ready();
    selectEntity("Отчёт по официантам", "Шерзод");
    const css = (await printDetail("Отчёт по официантам")).querySelector("style").textContent;

    expect(css).toContain(".zrd-table--waiter{table-layout:fixed}");
    const widths = [...css.matchAll(/\.zrd-table--waiter td:nth-child\(\d\)\{width:([\d.]+)%\}/g)]
      .map((match) => Number(match[1]));
    // ZR-PRINT-REFERENCE-FLOW-07: 9.5pt money needs more room than 8.5pt did, so
    // the three value columns took the width from Имя (short first names) instead
    // of widening the 108mm sheet. Sum still 100%.
    expect(widths).toEqual([22, 26, 24, 28]);
    expect(widths.reduce((sum, value) => sum + value, 0)).toBe(100);
    // headers wrap to two lines like the reference instead of stretching
    expect(css).not.toContain("white-space:nowrap");
  });

  it("escapes entity names and coverage text inside the print document", async () => {
    const HOSTILE_NAME = '<Admin & "Test">';
    const HOSTILE_NOTE = 'Охват <img src=x onerror="alert(1)"> неполный';
    reportsService.getZReportDetail.mockResolvedValue({
      data: detailResponse("cashier", [entity("c1", HOSTILE_NAME)], {
        coverage: [{ code: "CASHIER_UNATTRIBUTED_PAYMENTS_EXCLUDED", message: HOSTILE_NOTE }],
      }),
    });
    await ready();
    selectEntity("Отчёт по кассирам", "Мансур");
    const doc = await printDetail("Отчёт по кассирам");

    expect(doc.querySelectorAll("img")).toHaveLength(0);
    expect(doc.querySelectorAll("script")).toHaveLength(0);
    expect(doc.querySelectorAll("[onerror]")).toHaveLength(0);
    // the hostile NAME survives as inert TEXT, with no injected children
    const name = doc.querySelector(".zrd-meta");
    expect(name.textContent).toBe(`Имя: ${HOSTILE_NAME}`);
    expect(name.children).toHaveLength(0);
    // the hostile COVERAGE text is not printed at all (ZR-PRINT-FINAL-UX-05 removed
    // the «Примечание» block), so it is neither a vector nor inert leftover text
    expect(doc.querySelector(".zrd-notes")).toBeNull();
    expect(doc.body.textContent).not.toContain("Охват");
    expect(doc.body.textContent).not.toContain("неполный");
    // the print job's own title carries no glyphs and no markup
    expect(doc.title).toBe(INVISIBLE_TITLE);
    expect(doc.title).not.toContain("<");
    // and the generated SOURCE escapes quotes too, so the same values are safe
    // if they ever land in an attribute position
    const html = buildZReportDetailPrintDocument({
      detail: detailResponse("cashier", [entity("c1", HOSTILE_NAME)]),
      periodLabel: 'за <"today">',
    });
    expect(html).toContain("&lt;Admin &amp; &quot;Test&quot;&gt;");
    expect(html).toContain("&lt;&quot;today&quot;&gt;");
    expect(html).not.toContain('"Test"');
  });

  it("does not open a print document when the detail request fails", async () => {
    reportsService.getZReportDetail.mockRejectedValue(Object.assign(new Error("boom"), {
      response: { status: 500, data: { detail: "Сервис недоступен" } },
    }));
    await ready();
    selectEntity("Отчёт по кассирам", "Мансур");
    fireEvent.click(screen.getByRole("button", { name: "Печать: Отчёт по кассирам" }));
    // the dedicated document is opened by the click itself, already showing its
    // waiting state (that is what keeps it out of the popup blocker) ...
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(printView.document.body.textContent).toContain(PRINT_WAIT_TEXT);

    const alert = await screen.findByRole("alert");
    // ... and it is closed again on failure: no blank "successful" report
    expect(printView.close).toHaveBeenCalledTimes(1);
    expect(printView.document.querySelector(".zrd-doc")).toBeNull();
    expect(printView.print).not.toHaveBeenCalled();
    expect(alert).toHaveTextContent("Печать не выполнена — Отчёт по кассирам: Сервис недоступен");
    expect(alert.textContent).not.toContain("Нет данных");
    expect(alert.textContent).not.toContain("0 UZS");
    expect(screen.getByRole("button", { name: "Печать: Отчёт по кассирам" })).toBeEnabled();
  });

  it("prevents duplicate Print execution while the detail request is in flight", async () => {
    let resolveDetail;
    reportsService.getZReportDetail.mockImplementation(
      () => new Promise((resolve) => { resolveDetail = resolve; }),
    );
    await ready();
    selectEntity("Отчёт по кассирам", "Мансур");
    selectEntity("Отчёт по местам", "Балкон");
    const button = screen.getByRole("button", { name: "Печать: Отчёт по кассирам" });

    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(reportsService.getZReportDetail).toHaveBeenCalledTimes(1);
    // ONE print document for ONE click: the extra clicks open no further tabs
    expect(window.open).toHaveBeenCalledTimes(1);
    // a second row cannot start a competing print job either
    expect(screen.getByRole("button", { name: "Печать: Отчёт по местам" })).toBeDisabled();

    resolveDetail({ data: detailResponse("cashier", [entity("c1", "Мансур")]) });
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).not.toHaveAttribute("aria-busy");
  });

  // ZR-PRINT-REFERENCE-FLOW-07: ONE application click opens the dedicated print
  // document, fills it, and invokes the native preview by itself — and the
  // document STAYS afterwards, so cancelling the preview leaves the report on
  // screen instead of a closed tab.
  it("fills the dedicated print document, prints it automatically and leaves it open", async () => {
    const HOST_TITLE = "MARJON - Dashboard";
    await ready();
    document.title = HOST_TITLE;
    selectEntity("Отчёт по кассирам", "Мансур");

    const calls = [];
    printView.print = vi.fn(() => {
      const printed = printView.document;
      calls.push({
        hostTitle: document.title,
        readyState: printed.readyState,
        jobTitle: printed.title,
        headings: printed.querySelectorAll("h1.zrd-title").length,
        tables: printed.querySelectorAll(".zrd-table").length,
        period: printed.querySelector(".zrd-period")?.textContent ?? "",
        bodyChildren: printed.body.children.length,
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Печать: Отчёт по кассирам" }));

    // the tab is opened by the click itself and already shows its waiting state
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    expect(printView.document.body.textContent).toContain(PRINT_WAIT_TEXT);

    await waitFor(() => expect(calls).toHaveLength(1));
    // the document Chrome was handed is complete, fully rendered and CLEAN
    expect(calls[0].readyState).toBe("complete");
    expect(calls[0].headings).toBe(1);
    expect(calls[0].tables).toBeGreaterThan(0);
    expect(calls[0].period).toContain("Период: ");
    expect(calls[0].bodyChildren).toBe(1);
    // its own title carries no glyphs, and the OWNER page keeps its title — the
    // print job is a separate top-level document, so there is nothing to fall back
    // to and nothing to swap
    expect(calls[0].jobTitle).toBe(INVISIBLE_TITLE);
    expect(calls[0].hostTitle).toBe(HOST_TITLE);
    expect(document.title).toBe(HOST_TITLE);
    // one click, one print job, no second application-level action …
    expect(printView.print).toHaveBeenCalledTimes(1);
    expect(printView.focus).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: /^Печать/ })).toHaveLength(4);
    // … and the printable document is still there after the preview closes
    expect(printView.close).not.toHaveBeenCalled();
    expect(printView.document.querySelector(".zrd-doc")).not.toBeNull();
  });

  // Popup-blocked environments must still print from one click: the same document
  // goes into a hidden frame, and THAT path is where Chrome would fall back to the
  // host page's title, so the host title is blanked for the length of the call.
  it("falls back to a hidden frame when the print tab is blocked", async () => {
    const HOST_TITLE = "MARJON - Dashboard";
    window.open.mockReturnValue(null);
    await ready();
    document.title = HOST_TITLE;
    selectEntity("Отчёт по кассирам", "Мансур");

    fireEvent.click(screen.getByRole("button", { name: "Печать: Отчёт по кассирам" }));
    const frame = document.querySelector("iframe[data-zrd-print]");
    expect(frame).not.toBeNull();
    const calls = [];
    frame.contentWindow.focus = vi.fn();
    frame.contentWindow.print = vi.fn(() => calls.push({
      hostTitle: document.title,
      jobTitle: frame.contentDocument.title,
      headings: frame.contentDocument.querySelectorAll("h1.zrd-title").length,
    }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].headings).toBe(1);
    expect(calls[0].jobTitle).toBe(INVISIBLE_TITLE);
    expect(calls[0].hostTitle.trim()).toBe("");
    expect(calls[0].hostTitle).not.toContain("MARJON");
    expect(document.title).toBe(HOST_TITLE);
  });

  // ALIGNMENT-03 replaced the old "the general Z-report print is untouched" test:
  // that document and its button no longer exist, so the guard is now that the
  // page never opens any print surface other than the per-entity one.
  it("has no whole-shift print action and never fetches the general Z-report", async () => {
    await ready();

    expect(screen.queryByRole("button", { name: /Печать общего Z-отчёта/ })).toBeNull();
    expect(document.querySelector(".owner-reports__shift-print")).toBeNull();
    expect(reportsService.getZReport).not.toHaveBeenCalled();
    // the four per-entity Print controls are the only print actions left
    expect(document.querySelectorAll(".owner-report-row__print")).toHaveLength(4);
    // and nothing has opened a print surface of any kind yet
    expect(window.open).not.toHaveBeenCalled();
    expect(document.querySelectorAll("iframe[data-zrd-print]")).toHaveLength(0);
  });
});

// --- printed document head (ZR-PRINT-FINAL-UX-05 / -06) ----------------------
// The head is a document-wide contract — ONE dynamic heading, one centred
// «Период» line carrying the screen window with its time, no «Примечание», no
// visible browser document title — that has
// to hold for EVERY dimension, so the pure builder is exercised per dimension
// here instead of through a single page click.
describe("Z-report print document head (ZR-PRINT-FINAL-UX-05)", () => {
  const HEADINGS = [
    ["cashier", "Отчёт по кассирам"],
    ["waiter", "Отчёт по официантам"],
    ["hall", "Отчёт по местам"],
  ];
  const COVERAGE = [{ code: "ANY_COVERAGE_CODE", message: "Часть данных не отнесена ни к одной позиции." }];
  // What ZReportPage now hands the builder: the screen window, both endpoints,
  // «DD.MM.YYYY HH:MM - DD.MM.YYYY HH:MM» (ZR-PRINT-FINAL-UX-06).
  const SCREEN_PERIOD = "01.09.2026 13:23 - 04.09.2026 22:06";

  function parse(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  function build(dimension, extra = {}, periodLabel = SCREEN_PERIOD) {
    return buildZReportDetailPrintDocument({
      detail: detailResponse(dimension, [entity("e1", "Мансур"), entity("e2", "Алишер")], {
        coverage: COVERAGE,
        ...extra,
      }),
      periodLabel,
      waiterPercent: "12",
    });
  }

  it.each(HEADINGS)("prints the clicked row's own name as the one main heading (%s)", (dimension, heading) => {
    const doc = parse(build(dimension));
    const titles = doc.querySelectorAll("h1");

    expect(titles).toHaveLength(1);
    expect(titles[0].textContent).toBe(heading);
    expect(titles[0].className).toBe("zrd-title");
    // printed exactly once: no singular per-entity restatement under the title
    const text = normalize(doc.body.textContent);
    expect(text.match(/Отчёт по/g)).toHaveLength(1);
    // and the generic word is gone from the document entirely
    expect(text).not.toContain("Z-отчёт");
    expect(text).not.toContain("Z-отчет");
  });

  it("prints the screen window as one centred «Период» line under the heading", () => {
    const html = build("cashier");
    const head = parse(html).querySelector(".zrd-doc-head");
    const period = head.querySelector(".zrd-period");

    expect(period.textContent).toBe(`Период: ${SCREEN_PERIOD}`);
    expect(head.children[0].tagName).toBe("H1");
    expect(head.children[1]).toBe(period);
    // centred by the head's own rule, so heading and period share one measure
    expect(html).toContain(".zrd-doc-head{text-align:center}");
  });

  it("prints both endpoints with the selected time, hyphen-separated and secondless", () => {
    const doc = parse(build(
      "hall",
      { date: null, date_from: "2026-09-01", date_to: "2026-09-04" },
      SCREEN_PERIOD,
    ));
    const period = doc.querySelector(".zrd-period").textContent;

    // exactly DD.MM.YYYY HH:MM - DD.MM.YYYY HH:MM: one space before the time, a
    // plain hyphen with spaces between the endpoints, no seconds, no en dash
    expect(period).toMatch(/^Период: \d{2}\.\d{2}\.\d{4} \d{2}:\d{2} - \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
    expect(period).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(period).not.toContain("–");
    // the screen separator stays on screen; the sheet carries the label instead
    expect(doc.body.textContent).not.toContain("|");
    // the label is fixed, never taken from the backend's date / date_from echo
    expect(doc.body.textContent).not.toContain("Дата:");
  });

  it("keeps the browser print header blank instead of a MARJON product title", () => {
    const html = build("waiter");
    const doc = parse(html);

    // present but glyphless: a non-empty title stops Chrome falling back to the
    // HOST page's title, which is what printed «MARJON - Dashboard»
    expect(doc.querySelectorAll("title")).toHaveLength(1);
    expect(doc.title).toBe(INVISIBLE_TITLE);
    expect(doc.title.length).toBeGreaterThan(0);
    expect(doc.title.trim()).toBe("");
    expect(html).not.toContain("<title></title>");
    expect(html).not.toContain("MARJON");
    expect(html).not.toContain("Dashboard");
  });

  it.each(HEADINGS)("renders no «Примечание» block for %s, though the response carries coverage", (dimension) => {
    const html = build(dimension);
    const doc = parse(html);

    // structurally absent, not hidden: no markup, no class, no styling, no text
    expect(doc.querySelector(".zrd-notes")).toBeNull();
    expect(html).not.toContain("zrd-notes");
    expect(html).not.toContain("Примечание");
    expect(doc.body.textContent).not.toContain(COVERAGE[0].message);
    expect(doc.body.textContent).not.toContain(COVERAGE[0].code);
  });

  // ZR-PRINT-REFERENCE-FLOW-07: the dedicated document holds the REPORT and
  // nothing else — no OWNER shell, no controls, nothing clickable.
  it.each(HEADINGS)("contains only the printable report for %s — no OWNER shell", (dimension) => {
    const html = build(dimension);
    const doc = parse(html);

    expect(doc.body.children).toHaveLength(1);
    expect(doc.body.firstElementChild.className).toBe("zrd-doc");
    expect(doc.querySelectorAll("button, a, input, select, textarea, nav, aside, form, img, script"))
      .toHaveLength(0);
    for (const shell of ["dashboard-shell", "dashboard-sidebar", "dashboard-topbar",
      "owner-reports", "sidebar", "topbar", "DemoNotice", "Печать"]) {
      expect(html).not.toContain(shell);
    }
    // one self-contained stylesheet, no link to the OWNER bundle
    expect(doc.querySelectorAll("style")).toHaveLength(1);
    expect(doc.querySelectorAll("link")).toHaveLength(0);
  });
});
