import { test, expect } from "@playwright/test";

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
  "Отчёт по поварам",
  "Отчёт по местам",
  "Отчёт по меню",
];

test.describe.configure({ mode: "serial" });

test.describe("OWNER Z-report generator workspace", () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto("/login");
    await page.locator(".login-pro-input-wrap--phone input").fill(OWNER_PHONE);
    await page.locator('input[type="password"]').fill(OWNER_PASSWORD);
    await page.locator(".login-pro-submit").click();
    await page.locator(".dashboard-shell").waitFor({ state: "visible", timeout: 30000 });
  });

  test.afterAll(async () => {
    await page.close();
  });

  async function openZReport(width) {
    if (width) await page.setViewportSize({ width, height: 900 });
    await page.goto("/reports/z-report");
    await page.locator(".owner-reports-page").waitFor({ state: "visible", timeout: 20000 });
  }

  test("composition: title left, date right, five rows, deferred print", async () => {
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

    await expect(page.locator(".owner-report-row")).toHaveCount(5);
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

    // three employee multi-selects + two single selects; one percent field
    await expect(page.locator(".owner-msel")).toHaveCount(3);
    await expect(page.locator("select.owner-report-row__select")).toHaveCount(2);
    await expect(page.locator(".owner-report-row__percent")).toHaveCount(1);
    await expect(page.locator(".owner-report-row__percent")).toBeDisabled();

    // no fake "Выберите…" anywhere on the page
    await expect(page.getByText("Выберите", { exact: false })).toHaveCount(0);

    // per-entity print deferred — proven by the truthful disabled state, not by
    // a decorative "Скоро" badge (the old `.owner-report-row__deferred` span was
    // removed). Each per-entity print is non-actionable AND carries an honest
    // "not yet connected" message; there is no fake-success path.
    const perEntityPrint = page.locator(".owner-report-row__print");
    await expect(perEntityPrint).toHaveCount(5);
    await expect(page.locator(".owner-report-row__deferred")).toHaveCount(0);
    for (let i = 0; i < 5; i += 1) {
      const btn = perEntityPrint.nth(i);
      await expect(btn).toBeDisabled();
      await expect(btn).toHaveAttribute("aria-disabled", "true");
      await expect(btn).toHaveAttribute("title", "Отчёт ещё не подключён");
      await expect(btn).toHaveAccessibleName("Печать недоступна: отчёт ещё не подключён");
    }

    // whole-shift print remains the real, distinct action
    await expect(page.locator(".owner-reports__shift-print")).toBeVisible();
    await expect(page.locator(".owner-reports__shift-print")).toHaveText(/Печать общего Z-отчёта/);
  });

  test("no decorative turquoise circle behind the workspace", async () => {
    await openZReport(1280);
    await expect(page.locator(".z-report-page")).toHaveCount(0);
    const beforeContent = await page.locator(".owner-reports-page").evaluate(
      (el) => getComputedStyle(el, "::before").content
    );
    expect(["none", "normal", ""]).toContain(beforeContent);
  });

  test("empty-first: employee multi-selects + single selects truthfully empty", async () => {
    // Hermetic empty-first: force the three directory sources empty so the
    // truthful empty-state contract is asserted regardless of what the live
    // canonical dev DB happens to contain (it now holds real places/categories).
    // Route-mocked, non-destructive — same approach as the cashier fixture test.
    const EMPTY_DIRS = [/\/auth\/staff-users(\?|$)/, /\/settings\/places(\?|$)/, /\/inventory\/categories(\?|$)/];
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
      { disabled: true, text: "Нет поваров" },
    ]);
    const sel = await page.locator("select.owner-report-row__select").evaluateAll(
      (els) => els.map((el) => ({ disabled: el.disabled, text: el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : "" }))
    );
    expect(sel).toEqual([
      { disabled: true, text: "Нет мест" },
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
    await expect(control).toContainText("Выбрано: 2");

    await options.nth(0).click();                 // deselect Иван
    await expect(options.nth(0)).not.toHaveClass(/is-checked/);
    await expect(options.nth(0).locator(".owner-msel__tick")).toHaveCount(0);
    await expect(options.nth(1)).toHaveClass(/is-checked/);
    await expect(control).toContainText("Алексей");

    await page.unroute("**/auth/staff-users");
  });

  for (const w of [390, 768, 1280, 1440]) {
    test(`no horizontal overflow @ ${w}`, async () => {
      await openZReport(w);
      await expect(page.locator(".owner-report-row")).toHaveCount(5);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});
