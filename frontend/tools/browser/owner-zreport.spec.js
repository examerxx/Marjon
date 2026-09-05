import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// Real-browser (Chromium) oracle for the OWNER Z-report generator workspace.
// Empty-first + truthful DEFERRED per-entity print. Employee rows use a Marjon
// checkbox multi-select. Serial + single shared login (no /auth/login hammering).

const OWNER_PHONE = "907778778";
const OWNER_PASSWORD = "102938";

// TEST-ONLY fixture (never in product code): real-shaped cashiers so the
// employee multi-select can be exercised while the real company is empty.
const CASHIER_FIXTURE = [
  { id: "c1", name: "Иван", role_slugs: ["cashier"], is_active: true },
  { id: "c2", name: "Алексей", role_slugs: ["cashier"], is_active: true },
  { id: "c3", name: "Сардор", role_slugs: ["cashier"], is_active: true },
];

const ROW_TITLES = [
  "Отчёт по кассирам",
  "Отчёт по официантам",
  "Отчёт по местам",
  "Отчёт по меню",
];

// Visual-approval evidence lands OUTSIDE the repo.
const SHOTS = "C:\\Users\\zahongir\\Marjon-visual\\zr-print-01c";

// TEST-ONLY replay of the live GET /analytics/z-report/detail contract (never in
// product code). The canonical dev company has no transactions, so representative
// NON-ZERO accounting has to be replayed for the printed document to be
// inspectable; the request/UI/period assertions below still run against the real
// backend with real ids.
function fixtureFigures(overrides = {}) {
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

function fixtureEntity(name, overrides = {}) {
  return {
    entity_id: "00000000-0000-0000-0000-000000000000",
    entity_name: name,
    entity_is_active: true,
    entity_deleted: false,
    figures: fixtureFigures(overrides),
  };
}

test.describe.configure({ mode: "serial" });

test.describe("OWNER Z-report generator workspace", () => {
  let page;
  let browserRef;

  test.beforeAll(async ({ browser }) => {
    browserRef = browser;
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    // Chrome's print preview is not automatable, so window.print() is intercepted
    // in every page and frame of the CONTEXT — which is what reaches the dedicated
    // print tab the product opens. The state Chrome would have been handed is
    // recorded on that document's own window (asserted in "one click hands Chrome a
    // complete document…"), and because the real call never runs, the tab is not
    // taken away from the tests that read the printed report back. Nothing else is
    // changed: the click, the request, the write and the product's readiness gate
    // all run for real.
    await page.context().addInitScript(() => {
      window.__zrdPrintCalls = [];
      window.print = () => {
        try {
          const column = document.querySelector(".zrd-doc");
          window.__zrdPrintCalls.push({
            readyState: document.readyState,
            jobTitle: document.title,
            openerTitle: window.opener ? window.opener.document.title : null,
            headings: document.querySelectorAll("h1.zrd-title").length,
            tables: document.querySelectorAll(".zrd-table").length,
            rows: document.querySelectorAll(".zrd-table tr").length,
            styles: document.querySelectorAll("style").length,
            bodyChildren: document.body.children.length,
            period: document.querySelector(".zrd-period")?.textContent || "",
            columnWidth: column ? column.getBoundingClientRect().width : 0,
          });
        } catch (error) {
          window.__zrdPrintCalls.push({ error: String(error) });
        }
      };
    });
    await page.goto("/login");
    await page.locator(".login-pro-input-wrap--phone input").fill(OWNER_PHONE);
    await page.locator('input[type="password"]').fill(OWNER_PASSWORD);
    await page.locator(".login-pro-submit").click();
    await page.locator(".dashboard-shell").waitFor({ state: "visible", timeout: 30000 });
  });

  test.afterAll(async () => {
    await page.close();
  });

  // The dedicated print documents are real tabs now, and the reference flow leaves
  // them open on purpose, so each test closes the ones it opened.
  test.afterEach(async () => {
    for (const other of page.context().pages()) {
      if (other !== page) await other.close().catch(() => {});
    }
  });

  async function openZReport(width) {
    if (width) await page.setViewportSize({ width, height: 900 });
    await page.goto("/reports/z-report");
    await page.locator(".owner-reports-page").waitFor({ state: "visible", timeout: 20000 });
  }

  test("composition: title left, date right, four rows, deferred print", async () => {
    await openZReport(1280);
    await expect(page.locator(".owner-reports__title")).toHaveText("Z-отчёт");

    // Date control is the canonical ReportDateRangePicker trigger (the old
    // native `.owner-reports__date` input was removed). Assert it by its
    // accessible name, and that the title sits to its left.
    const periodButton = page.getByRole("button", { name: "Период Z-отчёта" });
    await expect(periodButton).toBeVisible();
    const titleBox = await page.locator(".owner-reports__title").boundingBox();
    const dateBox = await periodButton.boundingBox();
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(dateBox.x);

    await expect(page.locator(".owner-report-row")).toHaveCount(4);
    for (let i = 0; i < ROW_TITLES.length; i += 1) {
      await expect(page.locator(".owner-report-row__title").nth(i)).toHaveText(ROW_TITLES[i]);
    }

    // single outer workspace card with a heading; rows live inside it
    await expect(page.locator(".owner-reports__panel")).toHaveCount(1);
    await expect(page.locator(".owner-reports__panel-title")).toHaveText("Детализированные отчёты");
    // rows are dividers, NOT floating cards
    const firstRow = page.locator(".owner-report-row").first();
    await expect(firstRow).toHaveCSS("box-shadow", "none");
    await expect(firstRow).toHaveCSS("border-radius", "0px");

    // three multi-selects (cashier / waiter / place) + one single select (menu);
    // one percent field
    await expect(page.locator(".owner-msel")).toHaveCount(3);
    await expect(page.locator("select.owner-report-row__select")).toHaveCount(1);
    await expect(page.locator(".owner-report-row__percent")).toHaveCount(1);
    await expect(page.locator(".owner-report-row__percent")).toBeDisabled();

    // no fake "Выберите…" anywhere on the page
    await expect(page.getByText("Выберите", { exact: false })).toHaveCount(0);

    // Per-entity print is REAL for cashier / waiter / place (ZR-PRINT-01C):
    // each is a live button, disabled here only because nothing is selected yet
    // (and proven by a truthful reason, not a decorative "Скоро" badge — the old
    // `.owner-report-row__deferred` span was removed). Menu keeps the DEFERRED
    // state: there is no menu detail dimension, so it never fakes a print.
    const perEntityPrint = page.locator(".owner-report-row__print");
    await expect(perEntityPrint).toHaveCount(4);
    await expect(page.locator(".owner-report-row__deferred")).toHaveCount(0);
    for (let i = 0; i < 3; i += 1) {
      const btn = perEntityPrint.nth(i);
      await expect(btn).toBeDisabled();
      await expect(btn).toHaveAttribute("aria-disabled", "true");
      await expect(btn).toHaveAttribute("title", "Выберите хотя бы одну позицию");
      await expect(btn).toHaveAccessibleName(`Печать: ${ROW_TITLES[i]}`);
    }
    const menuPrint = perEntityPrint.nth(3);
    await expect(menuPrint).toBeDisabled();
    await expect(menuPrint).toHaveAttribute("aria-disabled", "true");
    await expect(menuPrint).toHaveAttribute("title", "Отчёт ещё не подключён");
    await expect(menuPrint).toHaveAccessibleName("Печать недоступна: отчёт ещё не подключён");

    // ALIGNMENT-03: the whole-shift print action is gone — the four per-entity
    // Print controls are the only print on this page, and the head keeps just
    // the period picker
    await expect(page.locator(".owner-reports__shift-print")).toHaveCount(0);
    await expect(page.getByText("Печать общего Z-отчёта")).toHaveCount(0);
    await expect(page.locator(".owner-reports__head-actions > *")).toHaveCount(1);
  });

  test("no decorative turquoise circle behind the workspace", async () => {
    await openZReport(1280);
    await expect(page.locator(".z-report-page")).toHaveCount(0);
    const beforeContent = await page.locator(".owner-reports-page").evaluate(
      (el) => getComputedStyle(el, "::before").content
    );
    expect(["none", "normal", ""]).toContain(beforeContent);
  });

  test("empty-first: multi-selects + single select truthfully empty", async () => {
    // Hermetic empty-first: force the three directory sources empty so the
    // truthful empty-state contract is asserted regardless of what the live
    // canonical dev DB happens to contain (it now holds real places/categories).
    // Route-mocked, non-destructive — same approach as the cashier fixture test.
    // NOTE: the places directory is the canonical Hall endpoint (GET /halls) —
    // mocking "/settings/places" never intercepted anything.
    const EMPTY_DIRS = [/\/auth\/staff-users(\?|$)/, /\/halls(\?|$)/, /\/inventory\/categories(\?|$)/];
    for (const pattern of EMPTY_DIRS) {
      await page.route(pattern, (route) => route.fulfill({
        status: 200, contentType: "application/json", body: "[]",
      }));
    }
    await openZReport(1280);
    const msel = await page.locator(".owner-msel__button").evaluateAll(
      (els) => els.map((el) => ({ disabled: el.disabled, text: el.textContent.trim() }))
    );
    expect(msel).toEqual([
      { disabled: true, text: "Нет кассиров" },
      { disabled: true, text: "Нет официантов" },
      { disabled: true, text: "Нет мест" },
    ]);
    const sel = await page.locator("select.owner-report-row__select").evaluateAll(
      (els) => els.map((el) => ({ disabled: el.disabled, text: el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : "" }))
    );
    expect(sel).toEqual([
      { disabled: true, text: "Нет категорий" },
    ]);

    // The canonical period picker trigger is present and focusable (replaces
    // the removed native `.owner-reports__date` input).
    const periodButton = page.getByRole("button", { name: "Период Z-отчёта" });
    await expect(periodButton).toBeEnabled();
    await periodButton.focus();
    expect(await periodButton.evaluate((el) => el === document.activeElement)).toBe(true);

    for (const pattern of EMPTY_DIRS) await page.unroute(pattern);
  });

  test("cashier multi-select: select multiple, no Выберите, deselect (test-only fixture)", async () => {
    await page.route("**/auth/staff-users", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(CASHIER_FIXTURE),
    }));
    await openZReport(1280);

    const control = page.locator(".owner-msel__button").first();
    await expect(control).toBeEnabled();
    await control.click();

    const menu = page.locator(".owner-msel__menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText("Выберите", { exact: false })).toHaveCount(0);

    const options = menu.locator(".owner-msel__option");
    await expect(options).toHaveCount(3);

    // unchecked → no checkmark rendered
    await expect(options.nth(0).locator(".owner-msel__tick")).toHaveCount(0);

    await options.nth(0).click();                 // Иван
    await expect(options.nth(0)).toHaveClass(/is-checked/);
    // selected → a visible white checkmark inside the box
    await expect(options.nth(0).locator(".owner-msel__tick")).toBeVisible();
    await options.nth(1).click();                 // Алексей — Иван stays selected
    await expect(options.nth(0)).toHaveClass(/is-checked/);
    await expect(options.nth(1)).toHaveClass(/is-checked/);
    await expect(options.nth(1).locator(".owner-msel__tick")).toBeVisible();
    // multiple selection shows the real NAMES, never an opaque "Выбрано: N"
    await expect(control).toContainText("Иван, Алексей");
    await expect(control).not.toContainText("Выбрано:");

    await options.nth(0).click();                 // deselect Иван
    await expect(options.nth(0)).not.toHaveClass(/is-checked/);
    await expect(options.nth(0).locator(".owner-msel__tick")).toHaveCount(0);
    await expect(options.nth(1)).toHaveClass(/is-checked/);
    await expect(control).toContainText("Алексей");

    await page.unroute("**/auth/staff-users");
  });

  // --- ZR-PRINT-01C: real per-entity Print -----------------------------------

  async function pickOption(rowIndex, optionIndex = 0) {
    const row = page.locator(".owner-report-row").nth(rowIndex);
    await row.locator(".owner-msel__button").click();
    await row.locator(".owner-msel__option").nth(optionIndex).click();
    await page.keyboard.press("Escape");
    return row;
  }

  // The dedicated print document is a real tab opened synchronously by the click
  // (ZR-PRINT-REFERENCE-FLOW-07), so the popup event IS the proof that one click
  // produced one printable document. It is returned as its own Page, already
  // carrying the rendered report.
  async function openPrintDocument(rowIndex) {
    const [printPage] = await Promise.all([
      page.context().waitForEvent("page"),
      page.locator(".owner-report-row").nth(rowIndex).locator(".owner-report-row__print").click(),
    ]);
    await printPage.waitForFunction(() => Boolean(document.querySelector(".zrd-doc")), undefined, {
      timeout: 15000,
    });
    return printPage;
  }

  // Closes every print tab opened so far (the product deliberately leaves them
  // open), plus any fallback frame, so a test starts from a clean surface count.
  async function clearPrintFrames() {
    for (const other of page.context().pages()) {
      if (other !== page) await other.close().catch(() => {});
    }
    await page.evaluate(() => {
      document.querySelectorAll("iframe[data-zrd-print]").forEach((frame) => frame.remove());
    });
  }

  test("cashier / waiter / place Print enable on live selection; menu stays disabled", async () => {
    await openZReport(1280);
    const prints = page.locator(".owner-report-row__print");

    for (let i = 0; i < 4; i += 1) await expect(prints.nth(i)).toBeDisabled();

    await pickOption(0);
    await expect(prints.nth(0)).toBeEnabled();
    await expect(prints.nth(1)).toBeDisabled();
    await expect(prints.nth(2)).toBeDisabled();

    await pickOption(1);
    await expect(prints.nth(1)).toBeEnabled();
    // the waiter percent field unlocks with the selection, unchanged in place
    await expect(page.locator(".owner-report-row__percent")).toBeEnabled();

    await pickOption(2);
    await expect(prints.nth(2)).toBeEnabled();

    // menu never becomes actionable
    await expect(prints.nth(3)).toBeDisabled();
    await expect(prints.nth(3)).toHaveAttribute("title", "Отчёт ещё не подключён");

    // deselecting takes Print back to disabled
    await pickOption(0);
    await expect(prints.nth(0)).toBeDisabled();
  });

  test("live Print requests the canonical detail contract and opens a real document", async () => {
    await openZReport(1280);
    await clearPrintFrames();
    const row = await pickOption(0);

    const [request, printPage] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/analytics/z-report/detail?")),
      page.context().waitForEvent("page"),
      row.locator(".owner-report-row__print").click(),
    ]);
    const url = new URL(request.url());
    expect(url.searchParams.get("dimension")).toBe("cashier");
    expect(url.searchParams.getAll("ids")).toHaveLength(1);
    expect(url.searchParams.getAll("ids")[0]).toMatch(/^[0-9a-f-]{36}$/);
    // single-date mode: date only, never both modes, never a percentage
    expect(url.searchParams.get("date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(url.searchParams.has("date_from")).toBe(false);
    expect(url.searchParams.has("date_to")).toBe(false);
    expect(url.searchParams.has("waiter_percent")).toBe(false);
    expect(request.url()).not.toContain("ids%5B%5D");

    // ONE click produced ONE dedicated print tab, and the OWNER page is still there
    await printPage.waitForFunction(() => Boolean(document.querySelector(".zrd-doc")));
    expect(page.context().pages()).toHaveLength(2);
    await expect(page.locator(".owner-reports-page")).toBeVisible();
    const html = await printPage.content();
    // ZR-PRINT-FINAL-UX-05: the heading is the clicked row's own plural name
    expect(html).toContain("Отчёт по кассирам");
    expect(html).not.toContain("Отчёт по кассиру");
    expect(html).not.toContain("Z-отчёт");
    // The canonical DB holds no payments, so the live cashier block is truthfully
    // empty instead of a page of zeroed metrics (ALIGNMENT-03).
    expect(html).toContain("Нет оплат за выбранный период");
    expect(html).toContain("Итого");
    // the detail document never carries the general report's shift stubs
    expect(html).not.toContain("Смена закрыта");
    expect(html).not.toContain("09:00");
    // no request is ever made for a menu dimension
    expect(request.url()).not.toContain("dimension=menu");
    await clearPrintFrames();
  });

  test("period mode reaches the detail request exactly as displayed", async () => {
    await openZReport(1280);
    await clearPrintFrames();
    // switch the approved picker to a real multi-day period (preset + ОК, the
    // canonical variant's own apply flow — no picker UX was changed)
    await page.getByRole("button", { name: "Период Z-отчёта" }).click();
    await page.locator(".report-date-presets button", { hasText: "Этот месяц" }).click();
    await page.locator(".report-date-ok").click();
    await expect(page.locator(".report-date-menu")).toHaveCount(0);

    const row = await pickOption(2);
    const [request, printPage] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/analytics/z-report/detail?")),
      page.context().waitForEvent("page"),
      row.locator(".owner-report-row__print").click(),
    ]);
    const url = new URL(request.url());
    expect(url.searchParams.get("dimension")).toBe("hall");
    expect(url.searchParams.get("date_from")).toMatch(/^\d{4}-\d{2}-01$/);
    expect(url.searchParams.get("date_to")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(url.searchParams.has("date")).toBe(false);

    await printPage.waitForFunction(() => Boolean(document.querySelector(".zrd-doc")));
    const html = await printPage.content();
    const from = url.searchParams.get("date_from").split("-").reverse().join(".");
    const to = url.searchParams.get("date_to").split("-").reverse().join(".");
    // ZR-PRINT-FINAL-UX-06: the head prints the SCREEN window — both endpoints
    // with the picker's clock time (00:00 from the «Этот месяц» preset) joined by
    // " - " — while the request above stays date-only.
    expect(html).toContain(`Период: ${from} 00:00 - ${to} 00:00`);
    expect(html).not.toContain("за период");
    expect(html).not.toContain("Дата:");
    await clearPrintFrames();
  });

  // --- visual approval evidence ----------------------------------------------

  const DETAIL_ROUTE = /\/analytics\/z-report\/detail\?/;

  async function mockDetail(payload) {
    await page.unroute(DETAIL_ROUTE).catch(() => {});
    await page.route(DETAIL_ROUTE, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    }));
  }

  // A4 portrait at 96dpi. The PNG is captured at exactly the physical page width
  // so the printed proportions can be judged from the image itself, and the PDF
  // is Chrome's own print output — the only honest proof of real pagination.
  const A4_W_MM = 210;
  const A4_H_MM = 297;
  const a4px = (mm) => Math.round((mm * 96) / 25.4);

  function pdfPageCount(buffer) {
    // Chrome writes the page-tree /Count uncompressed; the /Type /Page objects
    // agree with it, so the second form is only a fallback.
    const raw = buffer.toString("latin1");
    const declared = raw.match(/\/Count\s+(\d+)/);
    return declared ? Number(declared[1]) : (raw.match(/\/Type\s*\/Page(?![s])/g) || []).length;
  }

  async function capturePrint(html, name) {
    const printPage = await browserRef.newPage({
      viewport: { width: a4px(A4_W_MM), height: a4px(A4_H_MM) },
    });
    await printPage.emulateMedia({ media: "print" });
    await printPage.setContent(html, { waitUntil: "load" });
    // Measured from the same print-media layout Chrome paginates below. A mm
    // probe converts the physical page width into the CSS pixels the element
    // rects use, so no dpi arithmetic leaks into the assertions.
    const geometry = await printPage.evaluate((pageMm) => {
      const column = document.querySelector(".zrd-doc");
      if (!column) return null;
      const probe = document.createElement("div");
      probe.style.cssText = `position:absolute;left:-9999px;top:0;width:${pageMm}mm;height:1mm`;
      document.body.appendChild(probe);
      const pageWidth = probe.getBoundingClientRect().width;
      probe.remove();
      const rect = column.getBoundingClientRect();
      const font = (selector) => {
        const node = document.querySelector(selector);
        return node ? parseFloat(getComputedStyle(node).fontSize) : null;
      };
      // Centre of the rendered TEXT (not of its full-width block box), so a
      // heading/period that stopped being centred is actually caught.
      const textCentre = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        return box.left + box.width / 2;
      };
      return {
        pageWidth,
        columnWidth: rect.width,
        leftGap: rect.left,
        rightGap: pageWidth - rect.right,
        widestTable: Array.from(document.querySelectorAll(".zrd-table"))
          .reduce((max, table) => Math.max(max, table.getBoundingClientRect().width), 0),
        bodyFont: font("body"),
        titleFont: font(".zrd-title"),
        periodFont: font(".zrd-period"),
        cellFont: font(".zrd-table td"),
        // The requested normal-text computed style, read off a real data cell and
        // off the sheet itself: 14px Calibri, #000000, weight 400 — plus the
        // reference's own right-hand cell gutter.
        cellStyle: (() => {
          const cell = document.querySelector(".zrd-table tbody td");
          if (!cell) return null;
          const style = getComputedStyle(cell);
          return {
            family: style.fontFamily,
            size: style.fontSize,
            weight: style.fontWeight,
            color: style.color,
            padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
              .join(" "),
          };
        })(),
        bodyStyle: (() => {
          const style = getComputedStyle(document.body);
          return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, color: style.color };
        })(),
        // Semantic bold must survive the resize: the Итого row stays 700 while the
        // ordinary rows above it stay 400.
        totalWeight: (() => {
          const total = document.querySelector(".zrd-table tfoot td, .zrd-strong td");
          return total ? getComputedStyle(total).fontWeight : null;
        })(),
        // A DATA cell that had to wrap is taller than one line box. Header cells
        // are allowed to wrap (that is the reference's own two-line header), so
        // only td is measured — this is the wrapping-regression gate.
        wrappedCells: Array.from(document.querySelectorAll(".zrd-table td")).filter((cell) => {
          const line = parseFloat(getComputedStyle(cell).lineHeight);
          return Number.isFinite(line) && cell.getBoundingClientRect().height > line * 1.5;
        }).length,
        columnCentre: rect.left + rect.width / 2,
        titleCentre: textCentre(".zrd-title"),
        periodCentre: textCentre(".zrd-period"),
        periodText: document.querySelector(".zrd-period")?.textContent ?? null,
        notes: document.querySelectorAll(".zrd-notes").length,
      };
    }, A4_W_MM);
    await printPage.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
    const pdf = await printPage.pdf({
      path: path.join(SHOTS, `${name}.pdf`), format: "A4", printBackground: true,
    });
    await printPage.close();
    const measured = { pages: pdfPageCount(pdf), ...(geometry || {}) };
    if (geometry) {
      measured.ratio = geometry.columnWidth / geometry.pageWidth;
      measured.widthMm = (measured.ratio * A4_W_MM).toFixed(1);
    }
    return measured;
  }

  // Measured column shares of the four-column waiter table inside the print
  // column — the approved proportions are a visual requirement, so they are
  // measured from the rendered table rather than read back out of the CSS text.
  async function waiterColumnShares(html) {
    const printPage = await browserRef.newPage({
      viewport: { width: a4px(A4_W_MM), height: a4px(A4_H_MM) },
    });
    await printPage.emulateMedia({ media: "print" });
    await printPage.setContent(html, { waitUntil: "load" });
    const shares = await printPage.evaluate(() => {
      const table = document.querySelector(".zrd-table--waiter");
      const total = table.getBoundingClientRect().width;
      return Array.from(table.querySelectorAll("thead th"))
        .map((th) => th.getBoundingClientRect().width / total);
    });
    await printPage.close();
    return shares;
  }

  // Reads the printed place blocks back out of the RENDERED document as ordered
  // [label, value] rows per section, so the row SET and the totals are judged from
  // what the sheet actually shows rather than from the generator source.
  //
  // ZR-PRINT-FINAL-UX-06 removed Скидки and Налог from this block at the explicit
  // request of the user, so the visible rows no longer reconstruct Итого as soon as
  // a discount or a tax exists (Итого is Order.total_amount = subtotal − скидки +
  // сервис + налог). That former block-foots identity is therefore no longer
  // assertable; what is asserted instead is that Итого is the backend own
  // net_sales verbatim, never a frontend re-derivation from the printed lines.
  async function placeBlockRows(html) {
    const printPage = await browserRef.newPage({
      viewport: { width: a4px(A4_W_MM), height: a4px(A4_H_MM) },
    });
    await printPage.emulateMedia({ media: "print" });
    await printPage.setContent(html, { waitUntil: "load" });
    const blocks = await printPage.evaluate(() => Array
      .from(document.querySelectorAll("section.zrd-section"))
      .map((section) => Array.from(section.querySelectorAll("tr")).map((tr) => Array
        .from(tr.children)
        .map((cell) => cell.textContent.replace(/\u00a0/g, " ").trim()))));
    await printPage.close();
    return blocks;
  }

  // One shared geometry gate for every per-entity document: A4 portrait carrying
  // ONE centred column at about half the physical page width. The rejected
  // full-width version measured ≈0.87 of the sheet.
  function expectReferenceGeometry(m) {
    expect(m.ratio).toBeGreaterThanOrEqual(0.5);
    expect(m.ratio).toBeLessThanOrEqual(0.55);
    // centred: the two page gaps agree to within a pixel
    expect(Math.abs(m.leftGap - m.rightGap)).toBeLessThanOrEqual(1);
    // nothing escapes the column — no table stretched across the sheet
    expect(m.widestTable).toBeLessThanOrEqual(m.columnWidth + 1);
    // ZR-PRINT-TYPOGRAPHY-CORRECTION, measured after layout: normal printable text
    // computes to 14px Calibri / #000000 / weight 400 with the reference's own
    // 0 10px 0 0 cell gutter, the UNCHANGED 13pt heading (17.33px), a 9pt period
    // that stays secondary to it, semantic bold still 700 on the Итого row — and no
    // data cell forced to wrap at the larger size inside the same 108mm column.
    expect(m.bodyFont).toBeCloseTo(14, 1);
    expect(m.cellFont).toBeCloseTo(14, 1);
    expect(m.titleFont).toBeCloseTo(17.33, 1);
    expect(m.periodFont).toBeCloseTo(12, 1);
    expect(m.bodyStyle.family).toContain("Calibri");
    expect(m.bodyStyle.color).toBe("rgb(0, 0, 0)");
    expect(m.bodyStyle.weight).toBe("400");
    expect(m.cellStyle.family).toContain("Calibri");
    expect(m.cellStyle.size).toBe("14px");
    expect(m.cellStyle.weight).toBe("400");
    expect(m.cellStyle.color).toBe("rgb(0, 0, 0)");
    expect(m.cellStyle.padding).toBe("0px 10px 0px 0px");
    // A single-entity waiter sheet deliberately has no Итого row, so the semantic
    // bold is asserted wherever one exists.
    if (m.totalWeight !== null) expect(m.totalWeight).toBe("700");
    expect(m.wrappedCells).toBe(0);
    // ZR-PRINT-FINAL-UX-05: heading and period are CENTRED text inside that
    // column (measured on the text, not on its full-width block), and the
    // «Примечание» block is gone from the rendered document.
    expect(Math.abs(m.titleCentre - m.columnCentre)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(m.periodCentre - m.columnCentre)).toBeLessThanOrEqual(1.5);
    // ZR-PRINT-FINAL-UX-06: one «Период» line carrying BOTH endpoints with the
    // clock time the picker committed — DD.MM.YYYY HH:MM - DD.MM.YYYY HH:MM, plain
    // hyphen, no seconds, no en dash, no backend-derived «Дата» wording.
    expect(m.periodText)
      .toMatch(/^Период: \d{2}\.\d{2}\.\d{4} \d{2}:\d{2} - \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
    expect(m.notes).toBe(0);
  }

  // ZR-PRINT-FINAL-UX-05 document head, asserted on the generated SOURCE of every
  // representative document (the geometry gate above measures the same head after
  // layout). The fixtures below all carry backend `coverage`, so "no Примечание"
  // is a real removal here and not an artefact of an empty response.
  function expectPrintHead(html, heading) {
    expect(html).toContain(`<h1 class="zrd-title">${heading}</h1>`);
    expect(html.match(/<h1/g)).toHaveLength(1);
    // the report name is printed once — no singular per-entity restatement
    expect(html.match(/Отчёт по/g)).toHaveLength(1);
    expect(html).not.toContain("Z-отчёт");
    // no «Примечание» block: no markup, no class, no styling
    expect(html).not.toContain("Примечание");
    expect(html).not.toContain("zrd-notes");
    // Chrome's header centre renders the PRINT JOB's document.title and falls back
    // to the host page's title when there is none — which is what printed
    // «MARJON - Dashboard». The job keeps a present-but-glyphless title so no
    // fallback can happen (ZR-PRINT-FINAL-UX-06).
    expect(html).not.toContain("<title></title>");
    // the generator emits the raw NBSP; reading the live frame back through
    // outerHTML serialises the same character as &nbsp;, so both spellings of
    // "present but glyphless" are accepted here
    expect(html).toMatch(/<title>(?:&nbsp;|\s)+<\/title>/);
    expect(html).not.toContain("MARJON");
    expect(html).not.toContain("Dashboard");
  }

  // outerHTML serializes the ru-RU NBSP group separator as &nbsp;, so printed
  // sums are folded to plain spaces before asserting on them.
  function money(html) {
    return String(html).replace(/&nbsp;|\u00a0/g, " ");
  }

  // One click → the dedicated print tab → its rendered HTML. The tab is closed
  // here only because a test does not need it any more; the product leaves it open.
  async function printRow(rowIndex) {
    await clearPrintFrames();
    const printPage = await openPrintDocument(rowIndex);
    const html = await printPage.content();
    await clearPrintFrames();
    return html;
  }

  test("evidence: screen states with real live selections", async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await openZReport(1440);
    const prints = page.locator(".owner-report-row__print");

    await pickOption(0);
    await expect(prints.nth(0)).toBeEnabled();
    await page.screenshot({ path: path.join(SHOTS, "01-cashier-selected-print-active-1440.png"), fullPage: true });

    await pickOption(1);
    await page.locator(".owner-report-row__percent").fill("12");
    await expect(prints.nth(1)).toBeEnabled();
    await page.screenshot({ path: path.join(SHOTS, "02-waiter-percent-print-active-1440.png"), fullPage: true });

    await pickOption(2);
    await expect(prints.nth(2)).toBeEnabled();
    await page.screenshot({ path: path.join(SHOTS, "03-hall-selected-print-active-1440.png"), fullPage: true });

    // menu Print is still disabled with all three others active
    await expect(prints.nth(3)).toBeDisabled();
    await page.locator(".owner-report-row").nth(3).screenshot({
      path: path.join(SHOTS, "04-menu-print-disabled-1440.png"),
    });
  });

  test("evidence: representative cashier print (real id, replayed non-zero figures)", async () => {
    await openZReport(1440);
    await mockDetail({
      dimension: "cashier",
      date: new Date().toISOString().slice(0, 10),
      date_from: null,
      date_to: null,
      entities: [fixtureEntity("Мансур Каримов", {
        orders_count: 18, cancelled_orders_count: null, payments_count: 21, fiscal_receipts_count: 18,
        gross_sales: "2450000.00", discounts_total: "70000.00", service_fee_total: "120000.00",
        tax_total: "220500.00", refunds_total: null, net_sales: "2500000.00",
        cash_total: "900000.00", cash_received_total: "1000000.00", change_given_total: "100000.00",
        non_cash_total: "1600000.00", avg_check: "138888.89",
        payment_methods: [
          { method: "cash", count: 9, amount: "900000.00" },
          { method: "card", count: 12, amount: "1600000.00" },
        ],
      })],
      totals: fixtureFigures({
        orders_count: 18, cancelled_orders_count: null, payments_count: 21, fiscal_receipts_count: 18,
        gross_sales: "2450000.00", discounts_total: "70000.00", service_fee_total: "120000.00",
        tax_total: "220500.00", refunds_total: null, net_sales: "2500000.00",
        cash_total: "900000.00", cash_received_total: "1000000.00", change_given_total: "100000.00",
        non_cash_total: "1600000.00", avg_check: "138888.89",
        payment_methods: [
          { method: "cash", count: 9, amount: "900000.00" },
          { method: "card", count: 12, amount: "1600000.00" },
        ],
      }),
      unsupported_fields: ["cancelled_orders_count", "refunds_total"],
      coverage: [
        { code: "CASHIER_UNATTRIBUTED_PAYMENTS_EXCLUDED", message: "Платежи без кассира (шлюзовые оплаты) не входят ни в один отчёт по кассиру, поэтому сумма по кассирам может быть меньше общего Z-отчёта." },
        { code: "CASHIER_CANCELLED_ORDERS_UNSUPPORTED", message: "Отменённые заказы не закрываются платежом, поэтому их нельзя отнести к кассиру." },
        { code: "CASHIER_REFUNDS_UNSUPPORTED", message: "Возвраты выполняются платёжным шлюзом и не хранят кассира, поэтому сумма возвратов по кассиру не определена." },
      ],
    });

    await pickOption(0);
    const html = await printRow(0);
    expect(html).toContain("Мансур Каримов");
    // ALIGNMENT-03: payment methods and their total — nothing else. The Итого is
    // the sum of exactly those printed rows.
    expect(money(html)).toContain("900 000 UZS");
    expect(money(html)).toContain("1 600 000 UZS");
    expect(money(html)).toContain("2 500 000 UZS");
    // The removed metric ROWS must be gone. Checked as cells, because the same
    // words legitimately appear inside the backend coverage notes below.
    for (const gone of ["Валовые продажи", "Скидки", "Налог", "Средний чек", "Чистые продажи",
      "Отменённые заказы", "Фискальные чеки", "Заказы", "Оплаты", "Наличные"]) {
      expect(html).not.toContain(`<td>${gone}</td>`);
    }
    expect(html).not.toContain("Показатели");
    expect(html).not.toContain("Способы оплаты");
    expect(html).not.toContain("Не определено");
    // the backend coverage notes are NOT printed any more (ZR-PRINT-FINAL-UX-05)
    expect(html).not.toContain("Платежи без кассира");
    expectPrintHead(html, "Отчёт по кассирам");
    const m = await capturePrint(html, "05-print-cashier");
    expectReferenceGeometry(m);
    // ONE selected cashier stays on ONE sheet — a full metric dump across the
    // printable width used to spill onto a second, mostly empty page
    expect(m.pages).toBe(1);
    await page.unroute(DETAIL_ROUTE);
  });

  test("evidence: representative waiter print — 205 000 × 12% = 24 600, two waiters, union totals", async () => {
    // TEST-ONLY: the live company has one active waiter, so a second one is
    // replayed to prove the ONE-percent-for-all rule and the union totals page.
    await page.route("**/auth/staff-users", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "bd853a70-88be-4d31-b830-a6f11606e28f", name: "Алишер", role_slugs: ["waiter"], is_active: true },
        { id: "aa334075-da64-41d2-9eba-ec3c5e908a09", name: "Шерзод", role_slugs: ["waiter"], is_active: true },
      ]),
    }));
    await mockDetail({
      dimension: "waiter",
      date: new Date().toISOString().slice(0, 10),
      date_from: null,
      date_to: null,
      entities: [
        fixtureEntity("Алишер", {
          orders_count: 4, payments_count: 4, fiscal_receipts_count: 4,
          gross_sales: "195000.00", service_fee_total: "20500.00", tax_total: "18636.36",
          net_sales: "205000.00", cash_total: "205000.00", cash_received_total: "205000.00",
          avg_check: "51250.00",
          payment_methods: [{ method: "cash", count: 4, amount: "205000.00" }],
        }),
        fixtureEntity("Шерзод", {
          orders_count: 6, payments_count: 6, fiscal_receipts_count: 6,
          gross_sales: "300000.00", net_sales: "300000.00", non_cash_total: "300000.00",
          tax_total: "27272.73", avg_check: "50000.00",
          payment_methods: [{ method: "card", count: 6, amount: "300000.00" }],
        }),
      ],
      totals: fixtureFigures({
        orders_count: 10, payments_count: 10, fiscal_receipts_count: 10,
        gross_sales: "495000.00", service_fee_total: "20500.00", tax_total: "45909.09",
        net_sales: "505000.00", cash_total: "205000.00", cash_received_total: "205000.00",
        non_cash_total: "300000.00", avg_check: "50500.00",
        payment_methods: [
          { method: "cash", count: 4, amount: "205000.00" },
          { method: "card", count: 6, amount: "300000.00" },
        ],
      }),
      unsupported_fields: [],
      coverage: [{ code: "WAITER_PAYMENTS_VIA_ORDERS", message: "Оплаты и фискальные чеки отнесены к официанту через его заказы, а не как лично принятые им платежи." }],
    });

    await openZReport(1440);
    await pickOption(1, 0);
    await pickOption(1, 1);
    await page.locator(".owner-report-row__percent").fill("12");
    const html = await printRow(1);

    // the approved reference case, and never 20 500 × 12% = 2 460
    expect(money(html)).toContain("24 600 UZS");
    expect(money(html)).toContain("36 000 UZS");
    expect(money(html)).toContain("60 600 UZS");
    expect(money(html)).not.toContain("2 460 UZS");
    // waiter print is ONE compact table covering every selected waiter — never a
    // section per person — with the percent stated once in the caption
    expect(html.match(/class="zrd-section/g)).toHaveLength(1);
    expect(html).toContain("Обслуга по официантам (процент: 12%)");
    expect(html).toContain("<th>Обслуга официанта</th>");
    // the union Итого row foots the printed per-waiter amounts in the same table
    expect(html).toMatch(/<tfoot>[\s\S]*Итого[\s\S]*<\/tfoot>/);
    expect(html).not.toContain("Итого по выбранным официантам");
    expect(html).not.toContain("zrd-section--break");
    expectPrintHead(html, "Отчёт по официантам");
    const m = await capturePrint(html, "06-print-waiter-multi");
    expectReferenceGeometry(m);
    // two waiters + Итого is one compact table on ONE sheet
    expect(m.pages).toBe(1);
    // the approved column proportions, measured inside the print column
    const columns = await waiterColumnShares(html);
    expect(columns).toHaveLength(4);
    [0.22, 0.26, 0.24, 0.28].forEach((expected, index) => {
      expect(columns[index]).toBeCloseTo(expected, 2);
    });

    await page.unroute(DETAIL_ROUTE);
    await page.unroute("**/auth/staff-users");
  });

  test("evidence: representative waiter print — single waiter on one compact sheet", async () => {
    await page.route("**/auth/staff-users", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "aa334075-da64-41d2-9eba-ec3c5e908a09", name: "Сабина", role_slugs: ["waiter"], is_active: true },
      ]),
    }));
    const single = {
      orders_count: 4, payments_count: 4, fiscal_receipts_count: 4,
      gross_sales: "195000.00", service_fee_total: "20500.00", tax_total: "18636.36",
      net_sales: "205000.00", cash_total: "205000.00", cash_received_total: "205000.00",
      avg_check: "51250.00",
      payment_methods: [{ method: "cash", count: 4, amount: "205000.00" }],
    };
    await mockDetail({
      dimension: "waiter",
      date: new Date().toISOString().slice(0, 10),
      date_from: null,
      date_to: null,
      entities: [fixtureEntity("Сабина", single)],
      totals: fixtureFigures(single),
      unsupported_fields: [],
      coverage: [{ code: "WAITER_PAYMENTS_VIA_ORDERS", message: "Оплаты и фискальные чеки отнесены к официанту через его заказы, а не как лично принятые им платежи." }],
    });

    await openZReport(1440);
    await pickOption(1, 0);
    await page.locator(".owner-report-row__percent").fill("12");
    const html = await printRow(1);

    // the same approved arithmetic on the net_sales base
    expect(money(html)).toContain("205 000 UZS");
    expect(money(html)).toContain("24 600 UZS");
    expect(money(html)).not.toContain("2 460 UZS");
    // one waiter gets no Итого row, which would only restate the same figures
    expect(html).not.toContain("<tfoot>");
    expectPrintHead(html, "Отчёт по официантам");
    const m = await capturePrint(html, "06a-print-waiter-single");
    expectReferenceGeometry(m);
    expect(m.pages).toBe(1);

    await page.unroute(DETAIL_ROUTE);
    await page.unroute("**/auth/staff-users");
  });

  test("evidence: representative place print — two real Halls, union totals", async () => {
    // Replayed figures obey the real Marjon identity that the printed block now
    // shows: net_sales (Order.total_amount) = subtotal − скидки + сервис + налог.
    // 600 000 + 30 000 + 42 000 = 672 000 and 140 000 + 30 000 + 10 000 = 180 000.
    await mockDetail({
      dimension: "hall",
      date: new Date().toISOString().slice(0, 10),
      date_from: null,
      date_to: null,
      entities: [
        fixtureEntity("Балкон", {
          orders_count: 5, payments_count: 5, fiscal_receipts_count: 5,
          gross_sales: "600000.00", service_fee_total: "30000.00", tax_total: "42000.00",
          net_sales: "672000.00", cash_total: "672000.00", cash_received_total: "700000.00",
          change_given_total: "28000.00", avg_check: "134400.00",
          payment_methods: [{ method: "cash", count: 5, amount: "672000.00" }],
        }),
        fixtureEntity("Двор", {
          orders_count: 2, payments_count: 2, fiscal_receipts_count: 2,
          gross_sales: "140000.00", service_fee_total: "30000.00", tax_total: "10000.00",
          net_sales: "180000.00", non_cash_total: "180000.00", avg_check: "90000.00",
          payment_methods: [{ method: "click", count: 2, amount: "180000.00" }],
        }),
      ],
      totals: fixtureFigures({
        orders_count: 7, payments_count: 7, fiscal_receipts_count: 7,
        gross_sales: "740000.00", service_fee_total: "60000.00", tax_total: "52000.00",
        net_sales: "852000.00", cash_total: "672000.00", cash_received_total: "700000.00",
        change_given_total: "28000.00", non_cash_total: "180000.00", avg_check: "121714.29",
        payment_methods: [
          { method: "cash", count: 5, amount: "672000.00" },
          { method: "click", count: 2, amount: "180000.00" },
        ],
      }),
      unsupported_fields: [],
      coverage: [{ code: "HALL_TABLELESS_ORDERS_EXCLUDED", message: "Заказы без стола (навынос, доставка, QR и устаревшие записи) не относятся ни к одному месту, поэтому сумма по местам может быть меньше общего Z-отчёта." }],
    });

    await openZReport(1440);
    await pickOption(2, 0);
    await pickOption(2, 1);
    const html = await printRow(2);
    expect(html).toContain("Место: Балкон");
    expect(html).toContain("Место: Двор");
    expect(html).toContain("Итого по выбранным местам");
    // ALIGNMENT-03: the short reference row set, and the union Итого straight
    // from the backend (852 000 = 790 000 − 0 + 62 000, tax included)
    expect(money(html)).toContain("852 000 UZS");
    expect(html).toContain("Кол-во заказов");
    expect(html).toContain("Сумма блюд");
    expect(html).toContain("Сумма обслуживания");
    for (const gone of ["Средний чек", "Чистые продажи", "Наличные", "Фискальные чеки",
      "Валовые продажи", "Возвраты", "Безналичные оплаты"]) {
      expect(html).not.toContain(`<td>${gone}</td>`);
    }
    expect(html).not.toContain("Показатели");
    expect(html).not.toContain("Способы оплаты");
    expect(money(html)).not.toContain("121 714,29");
    // ZR-PRINT-FINAL-UX-06: every printed place block is EXACTLY the four
    // approved rows, read back from the rendered sheet — Скидки and Налог are
    // gone from the entity blocks AND from the union block. Итого is the backend
    // net_sales verbatim (672 000 / 180 000 / 852 000), which is why it is still
    // right even though 600 000 + 30 000 no longer adds up to it on paper.
    const blocks = await placeBlockRows(html);
    expect(blocks).toHaveLength(3);
    for (const rows of blocks) {
      expect(rows.map(([label]) => label))
        .toEqual(["Кол-во заказов", "Сумма блюд", "Сумма обслуживания", "Итого"]);
    }
    expect(blocks.map((rows) => rows.at(-1)[1]))
      .toEqual(["672 000 UZS", "180 000 UZS", "852 000 UZS"]);
    for (const gone of ["Скидки", "Налог"]) {
      expect(html).not.toContain(gone);
    }
    // three sections — two places + the authoritative union totals — that FLOW
    // down the sheet instead of taking a forced page each
    expect(html.match(/class="zrd-section/g)).toHaveLength(3);
    expect(html).not.toContain("zrd-section--break");
    expect(html).not.toContain("break-before:page");
    // the hall coverage note is not printed either (ZR-PRINT-FINAL-UX-05)
    expect(html).not.toContain("Заказы без стола");
    expectPrintHead(html, "Отчёт по местам");
    const m = await capturePrint(html, "07-print-hall-multi");
    expectReferenceGeometry(m);
    // compact flowing blocks: two places plus union totals used to take three
    // sheets when every metric was printed across the printable width
    expect(m.pages).toBe(1);
    await page.unroute(DETAIL_ROUTE);
  });

  // ZR-PRINT-FINAL-UX-05 screen half: the picker's own labels, its display format
  // and its selection colours, measured in a real browser (the jsdom suite pins
  // the markup hooks and the rule text; only this can prove what is painted).
  test("evidence: picker labels centred, DD.MM.YYYY | HH:MM, accent selection", async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await openZReport(1440);
    await page.getByRole("button", { name: "Период Z-отчёта" }).click();
    await page.locator(".report-date-menu").waitFor({ state: "visible" });

    // display only: the API stays date-only and the printout never shows HH:MM
    for (const label of ["Начало периода", "Конец периода"]) {
      await expect(page.getByLabel(label)).toHaveValue(/^\d{2}\.\d{2}\.\d{4} \| \d{2}:\d{2}$/);
    }

    await page.getByLabel("Начало периода").click();
    await expect(page.locator(".report-date-calendar-shell")).toHaveClass(/is-expanded/);
    await expect(page.locator(".report-date-time-panel")).toBeVisible();
    const hours = page.locator(".report-date-time-list").nth(0);
    const minutes = page.locator(".report-date-time-list").nth(1);
    await hours.getByRole("button", { name: "13", exact: true }).click();
    await minutes.getByRole("button", { name: "23", exact: true }).click();
    await expect(page.getByLabel("Начало периода")).toHaveValue(/ \| 13:23$/);

    // Exactly one hour and one minute read as selected, and the three action
    // surfaces settle on the approved accent (#1FC9C9) with white text. Asserted
    // through toHaveCSS so the list's own background transition is waited out
    // instead of sampling a mid-flight blend.
    const selectedHour = hours.locator("button.is-selected");
    const selectedMinute = minutes.locator("button.is-selected");
    await expect(selectedHour).toHaveCount(1);
    await expect(selectedMinute).toHaveCount(1);
    await expect(selectedHour).toHaveText("13");
    await expect(selectedMinute).toHaveText("23");
    for (const surface of [selectedHour, selectedMinute, page.locator(".report-date-today-button")]) {
      await expect(surface).toHaveCSS("background-color", "rgb(31, 201, 201)");
      await expect(surface).toHaveCSS("color", "rgb(255, 255, 255)");
    }

    const measured = await page.evaluate(() => {
      const boxCentre = (node) => {
        const rect = node.getBoundingClientRect();
        return rect.left + rect.width / 2;
      };
      // centre of the rendered TEXT, so a label that merely sits in a centred box
      // is not mistaken for centred text
      const textCentre = (node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        return rect.left + rect.width / 2;
      };
      // «Время» is an icon + word pair: the GROUP is what has to be centred
      const groupCentre = (node) => {
        const rects = Array.from(node.children).map((child) => child.getBoundingClientRect());
        return (Math.min(...rects.map((r) => r.left)) + Math.max(...rects.map((r) => r.right))) / 2;
      };
      const field = (text) => Array.from(document.querySelectorAll(".report-date-field"))
        .find((node) => node.querySelector("span")?.textContent.trim() === text);
      const readField = (text) => {
        const node = field(text);
        return { label: textCentre(node.querySelector("span")), input: boxCentre(node.querySelector("input")) };
      };
      const panel = document.querySelector(".report-date-time-panel");
      const lists = document.querySelectorAll(".report-date-time-list");
      return {
        start: readField("Дата с"),
        end: readField("Дата по"),
        time: {
          label: groupCentre(panel.querySelector(".report-date-time-title")),
          columns: boxCentre(panel.querySelector(".report-date-time-columns")),
        },
        hour: lists[0].querySelector("button.is-selected").textContent.trim(),
        minute: lists[1].querySelector("button.is-selected").textContent.trim(),
      };
    });

    expect(Math.abs(measured.start.label - measured.start.input)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(measured.end.label - measured.end.input)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(measured.time.label - measured.time.columns)).toBeLessThanOrEqual(1.5);
    expect([measured.hour, measured.minute]).toEqual(["13", "23"]);
    await page.locator(".report-date-menu").screenshot({
      path: path.join(SHOTS, "10-picker-labels-time-accent.png"),
    });
  });

  // ZR-PRINT-FINAL-UX-06 fix 3, end to end and on paper: two DIFFERENT times are
  // picked on the two date fields, committed with ОК, and then read back off the
  // printed sheet. Nothing about the request changes — the canonical detail
  // contract is date-only, so this is the picker's selection reaching the head.
  test("evidence: the printed period carries the picked start and end times", async () => {
    await openZReport(1440);
    await page.getByRole("button", { name: "Период Z-отчёта" }).click();
    // preset first: choosing a preset resets both times to 00:00
    await page.locator(".report-date-presets button", { hasText: "Этот месяц" }).click();

    async function pickTime(fieldLabel, hour, minute) {
      await page.getByLabel(fieldLabel).click();
      await expect(page.locator(".report-date-time-panel")).toBeVisible();
      await page.locator(".report-date-time-list").nth(0)
        .getByRole("button", { name: hour, exact: true }).click();
      await page.locator(".report-date-time-list").nth(1)
        .getByRole("button", { name: minute, exact: true }).click();
      await expect(page.getByLabel(fieldLabel)).toHaveValue(new RegExp(` \\| ${hour}:${minute}$`));
    }

    await pickTime("Начало периода", "13", "23");
    await pickTime("Конец периода", "22", "06");
    await page.locator(".report-date-ok").click();
    await expect(page.locator(".report-date-menu")).toHaveCount(0);

    await mockDetail({
      dimension: "cashier",
      date: null,
      date_from: null,
      date_to: null,
      entities: [fixtureEntity("Мансур Каримов", {
        orders_count: 18, payments_count: 21, net_sales: "2500000.00",
        payment_methods: [
          { method: "cash", count: 9, amount: "900000.00" },
          { method: "card", count: 12, amount: "1600000.00" },
        ],
      })],
      totals: fixtureFigures({ net_sales: "2500000.00" }),
      unsupported_fields: [],
      coverage: [],
    });
    await pickOption(0);
    const html = await printRow(0);

    const month = new Date();
    const from = `01.${String(month.getMonth() + 1).padStart(2, "0")}.${month.getFullYear()}`;
    const to = `${String(month.getDate()).padStart(2, "0")}.${String(month.getMonth() + 1).padStart(2, "0")}.${month.getFullYear()}`;
    expect(html).toContain(`Период: ${from} 13:23 - ${to} 22:06`);
    expectPrintHead(html, "Отчёт по кассирам");
    const m = await capturePrint(html, "11-print-period-with-time");
    expectReferenceGeometry(m);
    expect(m.pages).toBe(1);
    await page.unroute(DETAIL_ROUTE);
  });

  // ZR-PRINT-REFERENCE-FLOW-07 evidence, per dimension:
  //   12-doc-*.png      the dedicated print document as the user sees it in its own
  //                     tab, before touching the preview
  //   13-preview-*.pdf  Chrome's own print rendition of that same document WITH the
  //                     native header/footer switched on — i.e. exactly the fields
  //                     the preview draws around the sheet
  //   13-preview-*.png  that PDF rendered through Chrome's viewer, so the header
  //                     band is inspectable as an image (the preview's own UI is
  //                     browser chrome and cannot be screenshotted)
  test("evidence: dedicated print documents and Chrome's own header/footer rendition", async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    const TODAY_ISO = new Date().toISOString().slice(0, 10);
    const cases = [
      {
        name: "cashier",
        row: 0,
        payload: {
          dimension: "cashier",
          entities: [fixtureEntity("Мансур Каримов", {
            orders_count: 18, payments_count: 21, net_sales: "2500000.00",
            payment_methods: [
              { method: "cash", count: 9, amount: "900000.00" },
              { method: "card", count: 12, amount: "1600000.00" },
            ],
          })],
          totals: fixtureFigures({ net_sales: "2500000.00" }),
        },
      },
      {
        name: "waiter",
        row: 1,
        percent: "12",
        payload: {
          dimension: "waiter",
          entities: [fixtureEntity("Алишер", {
            orders_count: 4, net_sales: "205000.00", service_fee_total: "20500.00",
          })],
          totals: fixtureFigures({ net_sales: "205000.00", service_fee_total: "20500.00" }),
        },
      },
      {
        name: "hall",
        row: 2,
        second: 1,
        payload: {
          dimension: "hall",
          entities: [
            fixtureEntity("Балкон", {
              orders_count: 5, gross_sales: "600000.00", service_fee_total: "30000.00",
              net_sales: "672000.00",
            }),
            fixtureEntity("Двор", {
              orders_count: 2, gross_sales: "140000.00", service_fee_total: "30000.00",
              net_sales: "180000.00",
            }),
          ],
          totals: fixtureFigures({
            orders_count: 7, gross_sales: "740000.00", service_fee_total: "60000.00",
            net_sales: "852000.00",
          }),
        },
      },
    ];

    for (const item of cases) {
      await openZReport(1440);
      await clearPrintFrames();
      await mockDetail({
        date: TODAY_ISO, date_from: null, date_to: null, unsupported_fields: [], coverage: [],
        ...item.payload,
      });
      await pickOption(item.row, 0);
      if (item.second != null) await pickOption(item.row, item.second);
      if (item.percent) await page.locator(".owner-report-row__percent").fill(item.percent);

      const printPage = await openPrintDocument(item.row);
      await printPage.setViewportSize({ width: 900, height: 1200 });
      await printPage.screenshot({
        path: path.join(SHOTS, `12-doc-${item.name}.png`),
        fullPage: true,
      });
      const pdfPath = path.join(SHOTS, `13-preview-${item.name}.pdf`);
      await printPage.pdf({
        path: pdfPath, format: "A4", printBackground: true, displayHeaderFooter: true,
      });
      await printPage.close();
      await page.unroute(DETAIL_ROUTE);
    }
  });

  // Chrome draws the print header itself, so the only way to prove what it puts in
  // the title slot is DIFFERENTIALLY: render the same document twice through
  // Chrome's own print pipeline with headers switched on — once with the glyphless
  // title the product emits, once with «MARJON - Dashboard» forced back in — and
  // compare how much text Chrome ends up drawing. A title that prints nothing adds
  // no text-showing operators. (Headless Chromium downloads PDFs instead of
  // rendering them, so the header band cannot be screenshotted; this measures it.)
  test("Chrome's print header draws nothing for the product title", async () => {
    function countTextOperators(buffer) {
      const raw = buffer.toString("latin1");
      const streams = raw.match(/stream\r?\n[\s\S]*?endstream/g) || [];
      return streams.reduce((total, block) => {
        const body = Buffer.from(block.replace(/^stream\r?\n/, "").replace(/endstream$/, ""), "latin1");
        let text = "";
        try {
          text = zlib.inflateSync(body).toString("latin1");
        } catch (error) {
          text = body.toString("latin1");
        }
        return total + (text.match(/\bT[jJ]\b/g) || []).length;
      }, 0);
    }

    async function textOperators(html) {
      const probe = await browserRef.newPage();
      await probe.setContent(html, { waitUntil: "load" });
      const pdf = await probe.pdf({
        format: "A4", printBackground: true, displayHeaderFooter: true,
      });
      await probe.close();
      return countTextOperators(pdf);
    }

    await openZReport(1440);
    await clearPrintFrames();
    await mockDetail({
      dimension: "cashier",
      date: new Date().toISOString().slice(0, 10),
      date_from: null,
      date_to: null,
      entities: [fixtureEntity("Мансур Каримов", {
        net_sales: "2500000.00",
        payment_methods: [{ method: "cash", count: 9, amount: "900000.00" }],
      })],
      totals: fixtureFigures({ net_sales: "2500000.00" }),
      unsupported_fields: [],
      coverage: [],
    });
    await pickOption(0);
    const html = await printRow(0);
    await page.unroute(DETAIL_ROUTE);

    const shipped = await textOperators(html);
    const regressed = await textOperators(
      html.replace(/<title>[\s\S]*?<\/title>/, "<title>MARJON - Dashboard</title>"),
    );
    expect(shipped).toBeGreaterThan(0); // the report itself is drawn
    expect(regressed).toBeGreaterThan(shipped); // a real title adds drawn text
  });

  // ZR-PRINT-REFERENCE-FLOW-07, in a real browser: ONE click opens the dedicated
  // print tab, that tab prints ITSELF automatically once its document is complete,
  // and it stays open afterwards. Chrome's preview UI is not automatable, so
  // window.print() is intercepted inside the tab and the state Chrome would have
  // been handed is recorded instead.
  test("one click opens the print tab, prints it automatically and leaves it open", async () => {
    await openZReport(1440);
    const hostTitleBefore = await page.title();
    expect(hostTitleBefore).toBe("MARJON - Dashboard");
    await mockDetail({
      dimension: "cashier",
      date: new Date().toISOString().slice(0, 10),
      date_from: null,
      date_to: null,
      entities: [fixtureEntity("Мансур Каримов", {
        orders_count: 18, payments_count: 21, net_sales: "2500000.00",
        payment_methods: [
          { method: "cash", count: 9, amount: "900000.00" },
          { method: "card", count: 12, amount: "1600000.00" },
        ],
      })],
      totals: fixtureFigures({ net_sales: "2500000.00" }),
      unsupported_fields: [],
      coverage: [{ code: "CASHIER_UNATTRIBUTED_PAYMENTS_EXCLUDED", message: "Часть оплат не отнесена к кассиру." }],
    });
    await clearPrintFrames();
    await pickOption(0);

    const [printPage] = await Promise.all([
      page.context().waitForEvent("page"),
      page.locator(".owner-report-row").nth(0).locator(".owner-report-row__print").click(),
    ]);
    // a dedicated top-level document of its own, not a frame of the OWNER page
    expect(printPage).not.toBe(page);
    expect(printPage.url()).toBe("about:blank");
    await printPage.waitForFunction(() => Boolean(document.querySelector(".zrd-doc")));

    await expect.poll(() => printPage.evaluate(() => window.__zrdPrintCalls.length)).toBe(1);
    const [call] = await printPage.evaluate(() => window.__zrdPrintCalls);
    // a fully formed, laid-out, self-contained printable document
    expect(call.readyState).toBe("complete");
    expect(call.headings).toBe(1);
    expect(call.tables).toBeGreaterThan(0);
    expect(call.rows).toBeGreaterThan(0);
    expect(call.styles).toBe(1);
    expect(call.bodyChildren).toBe(1);
    expect(call.columnWidth).toBeGreaterThan(300);
    expect(call.period).toMatch(/^Период: \d{2}\.\d{2}\.\d{4} \d{2}:\d{2} - \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
    // the print job's own title has no glyphs, so Chrome's header centre has
    // nothing to draw — and no host title to fall back to, because this document
    // is not inside the OWNER page at all
    expect(call.jobTitle.trim()).toBe("");
    expect(call.openerTitle).toBe("MARJON - Dashboard");
    expect(await printPage.title()).not.toContain("MARJON");
    // the OWNER page is untouched and still shows the workspace …
    expect(await page.title()).toBe(hostTitleBefore);
    await expect(page.locator(".owner-reports-page")).toBeVisible();
    // … and the printable document is STILL OPEN after printing (reference
    // behaviour: cancelling the preview leaves the report on screen)
    expect(printPage.isClosed()).toBe(false);
    expect(page.context().pages()).toHaveLength(2);
    // no second application-level print action was needed anywhere
    await expect(page.locator(".owner-report-row__print")).toHaveCount(4);
    await clearPrintFrames();
    await page.unroute(DETAIL_ROUTE);
  });

  // ALIGNMENT-03 removed the whole-shift Z-report print outright, so the former
  // "the general Z-report print is unchanged" evidence test is replaced by a
  // guard that the page opens no print surface other than the per-entity one.
  test("evidence: the page has no whole-shift print and never calls /analytics/z-report", async () => {
    const generalCalls = [];
    const listener = (request) => {
      const url = request.url();
      if (url.includes("/analytics/z-report") && !url.includes("/z-report/detail")) generalCalls.push(url);
    };
    page.on("request", listener);
    await openZReport(1440);
    await page.evaluate(() => {
      document.querySelectorAll("iframe").forEach((frame) => frame.remove());
    });

    await expect(page.locator(".owner-reports__shift-print")).toHaveCount(0);
    await expect(page.getByText("Печать общего Z-отчёта")).toHaveCount(0);
    await expect(page.locator(".owner-report-row__print")).toHaveCount(4);
    expect(await page.locator("iframe").count()).toBe(0);
    expect(generalCalls).toEqual([]);
    page.off("request", listener);
    await page.screenshot({ path: path.join(SHOTS, "09-screen-no-general-print.png"), fullPage: false });
  });

  for (const w of [390, 768, 1024, 1280, 1440]) {
    test(`no horizontal overflow @ ${w}`, async () => {
      await openZReport(w);
      await expect(page.locator(".owner-report-row")).toHaveCount(4);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      // enabling the Print buttons must not have introduced any wrap: four
      // single-line buttons, and the percent field still sits in its own row
      await expect(page.locator(".owner-report-row__print")).toHaveCount(4);
      for (let i = 0; i < 4; i += 1) {
        const box = await page.locator(".owner-report-row__print").nth(i).boundingBox();
        expect(box.height).toBeLessThanOrEqual(48);
      }
      await expect(page.locator(".owner-report-row__percent")).toHaveCount(1);
      const percentRow = await page.locator(".owner-report-row").nth(1).boundingBox();
      const percentBox = await page.locator(".owner-report-row__percent-wrap").boundingBox();
      expect(percentBox.x).toBeGreaterThanOrEqual(percentRow.x - 1);
      expect(percentBox.x + percentBox.width).toBeLessThanOrEqual(percentRow.x + percentRow.width + 1);
    });
  }
});
