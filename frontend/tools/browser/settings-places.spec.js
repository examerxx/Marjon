import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Phase 5C-5 real-browser visual oracle for Settings → Места/Столы.
//
// The canonical backend (26d4c50) is NOT deployed yet: the runtime on :8000 is
// the frozen pre-bi06tid01 image, so it has no halls.price_amount column and
// ignores include_inactive. This spec therefore intercepts ONLY the two Places
// requests and replays the ACTUAL 26d4c50 response contract
// (halls/schemas.py: price_amount = NUMERIC(15,2) decimal string, nested
// tables widened by include_inactive). Authentication and shell reads are also
// local fixtures: this spec sends no credentials and touches no database.
//
// Screenshots land outside the repository as visual evidence.

const SHOTS = "C:\\Users\\zahongir\\Marjon-visual\\5c5-5";
const FIXTURE_USER = {
  id: "u0000000-0000-0000-0000-000000000001",
  email: "visual-fixture@marjon.local",
  full_name: "Visual Fixture",
  role_slugs: ["owner"],
  auth_scope: "app",
  company_id: "c0000000-0000-0000-0000-000000000001",
  company_name: "MARJON",
  is_active: true,
};
const FIXTURE_COMPANY = {
  id: "c0000000-0000-0000-0000-000000000001",
  name: "MARJON",
  currency: "UZS",
  timezone: "Asia/Tashkent",
};

const HALLS = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    company_id: "c0000000-0000-0000-0000-000000000001",
    branch_id: "b0000000-0000-0000-0000-000000000001",
    name: "ЗАЛ", description: "Главный зал", is_active: true,
    condition: "Депозит от 200 000", percent: 10,
    price_amount: null, pricing_type: null, payment_type_id: null,
    tables: [
      { id: "t1000000-0000-0000-0000-000000000001", hall_id: "11111111-1111-1111-1111-111111111111", number: 1, capacity: 4, is_active: true, created_at: "2026-08-01T10:00:00", updated_at: "2026-08-01T10:00:00" },
      { id: "t1000000-0000-0000-0000-000000000002", hall_id: "11111111-1111-1111-1111-111111111111", number: 2, capacity: 2, is_active: true, created_at: "2026-08-01T10:00:00", updated_at: "2026-08-01T10:00:00" },
      { id: "t1000000-0000-0000-0000-000000000003", hall_id: "11111111-1111-1111-1111-111111111111", number: 3, capacity: 6, is_active: false, created_at: "2026-08-01T10:00:00", updated_at: "2026-08-01T10:00:00" },
    ],
    created_at: "2026-08-01T10:00:00", updated_at: "2026-08-01T10:00:00",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    company_id: "c0000000-0000-0000-0000-000000000001",
    branch_id: "b0000000-0000-0000-0000-000000000001",
    name: "КАБИНА", description: null, is_active: true,
    condition: null, percent: 20,
    price_amount: null, pricing_type: null, payment_type_id: null,
    tables: [],
    created_at: "2026-08-01T10:00:00", updated_at: "2026-08-01T10:00:00",
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    company_id: "c0000000-0000-0000-0000-000000000001",
    branch_id: "b0000000-0000-0000-0000-000000000001",
    name: "Billiard", description: null, is_active: true,
    condition: "Цена за час: 999 999", percent: 0,
    price_amount: "100000.00", pricing_type: "hourly", payment_type_id: null,
    tables: [
      { id: "t3000000-0000-0000-0000-000000000001", hall_id: "33333333-3333-3333-3333-333333333333", number: 1, capacity: 8, is_active: true, created_at: "2026-08-01T10:00:00", updated_at: "2026-08-01T10:00:00" },
    ],
    created_at: "2026-08-01T10:00:00", updated_at: "2026-08-01T10:00:00",
  },
  {
    id: "44444444-4444-4444-4444-444444444444",
    company_id: "c0000000-0000-0000-0000-000000000001",
    branch_id: "b0000000-0000-0000-0000-000000000001",
    name: "БРОН", description: null, is_active: true,
    condition: null, percent: 10,
    price_amount: "300000.00", pricing_type: "fixed", payment_type_id: null,
    tables: [],
    created_at: "2026-08-01T10:00:00", updated_at: "2026-08-01T10:00:00",
  },
  {
    id: "55555555-5555-5555-5555-555555555555",
    company_id: "c0000000-0000-0000-0000-000000000001",
    branch_id: "b0000000-0000-0000-0000-000000000001",
    name: "Бар", description: null, is_active: true,
    condition: null, percent: 0,
    price_amount: "20000.00", pricing_type: "hourly", payment_type_id: null,
    tables: [],
    created_at: "2026-08-01T10:00:00", updated_at: "2026-08-01T10:00:00",
  },
  {
    id: "66666666-6666-6666-6666-666666666666",
    company_id: "c0000000-0000-0000-0000-000000000001",
    branch_id: "b0000000-0000-0000-0000-000000000001",
    name: "Архив", description: null, is_active: false,
    condition: "Цена за час: 900 000", percent: null,
    price_amount: null, pricing_type: "hourly", payment_type_id: null,
    tables: [
      { id: "t6000000-0000-0000-0000-000000000001", hall_id: "66666666-6666-6666-6666-666666666666", number: 1, capacity: 4, is_active: false, created_at: "2026-08-01T10:00:00", updated_at: "2026-08-01T10:00:00" },
      { id: "t6000000-0000-0000-0000-000000000002", hall_id: "66666666-6666-6666-6666-666666666666", number: 4, capacity: 4, is_active: false, created_at: "2026-08-01T10:00:00", updated_at: "2026-08-01T10:00:00" },
    ],
    created_at: "2026-08-01T10:00:00", updated_at: "2026-08-01T10:00:00",
  },
];

const BRANCHES = [
  { id: "b0000000-0000-0000-0000-000000000001", company_id: "c0000000-0000-0000-0000-000000000001", name: "Основной филиал", is_active: true, created_at: "2026-08-01T10:00:00", updated_at: "2026-08-01T10:00:00" },
];

test.describe.configure({ mode: "serial" });

test.describe("Phase 5C-5 — Settings Места/Столы", () => {
  let page;
  let hallsRequests = [];

  test.beforeAll(async ({ browser }) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    await page.addInitScript(() => {
      localStorage.setItem("access_token", "settings-places-visual-fixture");
      localStorage.setItem("refresh_token", "settings-places-visual-fixture");
    });
    await page.route(/\/api\/v1\/auth\/me(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE_USER),
    }));
    await page.route(/\/api\/v1\/companies\/me(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE_COMPANY),
    }));
    await page.route(/\/api\/v1\/billing\/balance(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ balance: 0 }),
    }));
    await page.route(/cbu\.uz\/ru\/arkhiv-kursov-valyut\/json\/USD\//, (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify([{ Rate: "11801.2" }]),
    }));

    // Replay the canonical 26d4c50 contract for the Places directory only.
    await page.route(/\/api\/v1\/halls(\?|$)/, async (route) => {
      const url = new URL(route.request().url());
      hallsRequests.push(url.search);
      const includeInactive = url.searchParams.get("include_inactive") === "true";
      const body = includeInactive
        ? HALLS
        : HALLS.filter((h) => h.is_active).map((h) => ({ ...h, tables: h.tables.filter((t) => t.is_active) }));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.route(/\/api\/v1\/companies\/me\/branches(\?|$)/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BRANCHES) });
    });

    await page.goto("/settings/places");
    await page.locator(".dashboard-shell").waitFor({ state: "visible", timeout: 30000 });
  });

  test.afterAll(async () => { await page.close(); });

  // Playwright's getByRole name matching is substring-based by default, and
  // "Активировать стол" is a substring of "Деактивировать стол" — so every
  // lifecycle control below is matched with exact: true.
  // Phase 5C-6D renamed the Hall row's Trash action: status OFF (inactive) and
  // Trash (delete/archive) are now distinct operations, so the button's
  // accessible name is «Удалить место», not the old «Деактивировать место».
  const DELETE_HALL = { name: "Удалить место", exact: true };
  const RESTORE_TABLE = { name: "Активировать стол", exact: true };
  const DEACTIVATE_TABLE = { name: "Деактивировать стол", exact: true };

  async function openPlaces() {
    hallsRequests = [];
    await page.goto("/settings/places");
    await page.locator(".settings-places-list").waitFor({ state: "visible", timeout: 20000 });
  }

  test("A. Places list shows active + inactive with textual status", async () => {
    await openPlaces();
    // §13: Settings asks for the archive explicitly
    expect(hallsRequests.some((q) => q.includes("include_inactive=true"))).toBe(true);

    const header = page.locator(".settings-header");
    await expect(header.locator("p")).toHaveText("Настройки");
    await expect(header.getByRole("heading", { name: "Места" })).toBeVisible();
    await expect(page.getByText("Управление залами и столами")).toHaveCount(0);
    const addPlace = header.getByRole("button", { name: "Добавить место" });
    await expect(addPlace).toBeVisible();
    expect(await addPlace.evaluate((el) => getComputedStyle(el).borderRadius)).toBe("22px");

    await expect(page.locator(".settings-place")).toHaveCount(6);
    await expect(page.locator(".settings-place__icon")).toHaveCount(0);
    await expect(page.locator(".settings-place__chevron")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Перейти к столам:/ })).toHaveCount(0);
    const primaryNameStyle = await page.locator(".settings-place__name").first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { size: cs.fontSize, weight: cs.fontWeight, lineHeight: cs.lineHeight };
    });
    expect(primaryNameStyle.size).toBe("20px");
    expect(primaryNameStyle.weight).toBe("600");
    expect(Number.parseFloat(primaryNameStyle.lineHeight)).toBeCloseTo(26, 1);

    const zal = page.locator(".settings-place", { hasText: "ЗАЛ" });
    const cabin = page.locator(".settings-place", { hasText: "КАБИНА" });
    const billiard = page.locator(".settings-place", { hasText: "Billiard" });
    const booking = page.locator(".settings-place", { hasText: "БРОН" });
    const bar = page.locator(".settings-place", { hasText: "Бар" });
    await expect(zal.locator(".settings-place__percent")).toHaveText("10 %");
    await expect(cabin.locator(".settings-place__percent")).toHaveText("20 %");
    await expect(billiard.locator(".settings-place__price")).toHaveText("Цена за час: 100 000 UZS");
    await expect(billiard.locator(".settings-place__percent")).toHaveText("0 %");
    await expect(booking.locator(".settings-place__price")).toHaveText("Дополнительная цена: 300 000 UZS");
    await expect(booking.locator(".settings-place__percent")).toHaveText("10 %");
    await expect(bar.locator(".settings-place__price")).toHaveText("Цена за час: 20 000 UZS");
    await expect(bar.locator(".settings-place__percent")).toHaveText("0 %");

    // The percent occupies the start of its widened data column, leaving a
    // deliberate buffer before the stable status/actions area.
    expect(await booking.locator(".settings-place__percent").evaluate(
      (el) => getComputedStyle(el).justifySelf,
    )).toBe("start");
    const percentBox = await booking.locator(".settings-place__percent").boundingBox();
    const statusBox = await booking.locator(".settings-status-badge").boundingBox();
    expect(statusBox.x - (percentBox.x + percentBox.width)).toBeGreaterThanOrEqual(24);

    const editXs = await page.getByRole("button", { name: "Редактировать" }).evaluateAll(
      (buttons) => buttons.map((button) => button.getBoundingClientRect().x),
    );
    expect(Math.max(...editXs) - Math.min(...editXs)).toBeLessThanOrEqual(1);

    const archived = page.locator(".settings-place", { hasText: "Архив" });
    await expect(archived).toHaveClass(/is-inactive/);
    await expect(archived.locator(".settings-status-badge")).toHaveText("Неактивен");
    await expect(archived.locator(".settings-place__price")).toHaveText("");
    await expect(archived).not.toContainText("900 000 UZS");
    await expect(archived.getByRole("button", { name: "Активировать место", exact: true })).toHaveCount(0);
    await expect(archived.getByRole("button", DELETE_HALL)).toBeVisible();
    await expect(archived.getByRole("button", DELETE_HALL).locator(".lucide-trash-2")).toBeVisible();

    const live = billiard;
    const activeBadge = live.locator(".settings-status-badge");
    await expect(activeBadge).toHaveText("Активен");
    const activeStyle = await activeBadge.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { background: cs.backgroundColor, color: cs.color };
    });
    expect(activeStyle).toEqual({ background: "rgba(0, 0, 0, 0)", color: "rgb(0, 220, 59)" });
    const activeDot = activeBadge.locator(".settings-status-badge__dot");
    await expect(activeDot).toBeVisible();
    expect((await activeDot.boundingBox()).width).toBe(8);
    expect(await activeDot.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(0, 220, 59)");
    await expect(live.getByRole("button", DELETE_HALL)).toBeVisible();
    await expect(live.getByRole("button", DELETE_HALL).locator(".lucide-trash-2")).toBeVisible();
    await expect(live.getByRole("button", DELETE_HALL).locator(".lucide-octagon-x")).toHaveCount(0);
    await expect(live.getByRole("button", { name: "Активировать место", exact: true })).toHaveCount(0);

    const inactiveBadge = archived.locator(".settings-status-badge");
    const inactiveStyle = await inactiveBadge.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { background: cs.backgroundColor, color: cs.color };
    });
    expect(inactiveStyle).toEqual({ background: "rgba(0, 0, 0, 0)", color: "rgb(239, 68, 68)" });
    await expect(inactiveBadge.locator(".settings-status-badge__dot")).toBeVisible();

    await page.screenshot({ path: path.join(SHOTS, "places-list-active-1280.png"), fullPage: true });
    await page.screenshot({ path: path.join(SHOTS, "places-list-inactive-1280.png"), fullPage: true });
    await page.screenshot({ path: path.join(SHOTS, "places-list-pricing-1280.png"), fullPage: true });
  });

  test("B. Hall edit modal restores price_amount as a grouped value", async () => {
    await openPlaces();
    await page.locator(".settings-place", { hasText: "БРОН" })
      .getByRole("button", { name: "Редактировать" }).click();
    const form = page.locator(".settings-form");
    await expect(form).toBeVisible();
    // 300000.00 → "300 000"; the legacy condition note is never parsed as money
    await expect(form.getByPlaceholder("Введите цену")).toHaveValue("300 000");
    // Phase 5C-5.2: the pricing control is a Marjon listbox, so the restored
    // choice reads off the trigger rather than a native select value.
    await expect(page.locator("#hall-pricing-select")).toHaveText("Дополнительная цена");
    await page.screenshot({ path: path.join(SHOTS, "B-hall-modal-fixed-1280.png") });

    // hourly place restores its own amount
    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();
    await page.locator(".settings-place", { hasText: "Billiard" })
      .getByRole("button", { name: "Редактировать" }).click();
    await expect(page.locator(".settings-form").getByPlaceholder("Введите цену")).toHaveValue("100 000");
    await expect(page.locator("#hall-pricing-select")).toHaveText("Цена за час");
    await page.screenshot({ path: path.join(SHOTS, "B-hall-modal-hourly-1280.png") });
    await page.keyboard.press("Escape");
  });

  test("C. Tables subview lists active + inactive tables", async () => {
    await openPlaces();
    await page.getByRole("button", { name: "Открыть столы: ЗАЛ" }).click();
    await page.locator(".settings-tbl").waitFor({ state: "visible" });
    const header = page.locator(".settings-header");
    await expect(header.locator("p")).toHaveText("Настройки");
    await expect(header.getByRole("heading", { name: "ЗАЛ" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Места", exact: true })).toHaveCount(0);
    await expect(page.getByText("Столы — ЗАЛ")).toHaveCount(0);
    await expect(page.getByText("Управление столами выбранного места")).toHaveCount(0);
    const addTable = header.getByRole("button", { name: "Добавить стол" });
    expect(await addTable.evaluate((el) => getComputedStyle(el).borderRadius)).toBe("22px");
    const rows = page.locator(".settings-tbl__row:not(.settings-tbl__head)");
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "№3" })).toHaveClass(/is-inactive/);
    await expect(rows.filter({ hasText: "№3" }).locator(".settings-status-badge")).toHaveText("Неактивен");
    // hall is active → reactivation is offered and enabled
    await expect(page.getByRole("button", RESTORE_TABLE)).toBeEnabled();
    await expect(page.getByRole("button", DEACTIVATE_TABLE)).toHaveCount(2);
    await expect(page.getByRole("button", DEACTIVATE_TABLE).first().locator(".lucide-trash-2")).toBeVisible();
    await expect(page.getByRole("button", { name: "Добавить стол" })).toBeEnabled();
    await page.screenshot({ path: path.join(SHOTS, "C-tables-active-hall-1280.png"), fullPage: true });
  });

  test("C2. Empty Tables state has only the header Add Table CTA", async () => {
    await openPlaces();
    await page.getByRole("button", { name: "Открыть столы: КАБИНА" }).click();
    await expect(page.getByText("Столов пока нет")).toBeVisible();
    await expect(page.getByText("Добавьте первый стол для этого места.")).toBeVisible();
    const addTable = page.getByRole("button", { name: "Добавить стол" });
    await expect(addTable).toHaveCount(1);
    await expect(addTable).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "C2-tables-empty-1280.png"), fullPage: true });
    await addTable.click();
    await expect(page.getByRole("dialog", { name: "Добавить стол" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("D. Inactive hall keeps lifecycle guards without a warning banner", async () => {
    await openPlaces();
    await page.getByRole("button", { name: "Открыть столы: Архив" }).click();
    await page.locator(".settings-tbl").waitFor({ state: "visible" });
    await expect(page.locator(".settings-inactive-note")).toHaveCount(0);
    await expect(page.getByText(/Место неактивно/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Активировать место", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Добавить стол" })).toBeDisabled();
    const restore = page.getByRole("button", RESTORE_TABLE);
    await expect(restore).toHaveCount(2);
    await expect(restore.first()).toBeDisabled();
    await expect(restore.nth(1)).toBeDisabled();
    await page.screenshot({ path: path.join(SHOTS, "tables-inactive-clean-1280.png"), fullPage: true });
  });

  test("E/F/G. responsive web widths including 1280 / 1440 have no horizontal overflow", async () => {
    for (const width of [390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await openPlaces();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `places @${width} horizontal overflow`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: path.join(SHOTS, `places-${width}.png`), fullPage: true });

      await page.getByRole("button", { name: "Открыть столы: ЗАЛ" }).click();
      await page.locator(".settings-tbl").waitFor({ state: "visible" });
      const tablesOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(tablesOverflow, `tables @${width} horizontal overflow`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: path.join(SHOTS, `tables-${width}.png`), fullPage: true });

      // modal geometry at this width
      await page.getByRole("button", { name: "Добавить стол" }).click();
      await expect(page.locator(".settings-modal")).toBeVisible();
      // let the entrance animation settle before measuring/capturing, otherwise
      // the shot catches a mid-fade frame rather than the resting layout
      await page.locator(".settings-modal").evaluate((el) => Promise.all(
        el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})),
      ));
      const modalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(modalOverflow, `table modal @${width} horizontal overflow`).toBeLessThanOrEqual(0);
      // the dialog must sit fully inside the viewport at every width
      const box = await page.locator(".settings-modal").boundingBox();
      expect(box.x, `table modal @${width} left edge`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `table modal @${width} right edge`).toBeLessThanOrEqual(width);
      await page.screenshot({ path: path.join(SHOTS, `table-modal-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect(page.locator(".settings-modal")).toBeHidden();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("long price does not break the hall modal at 390", async () => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openPlaces();
    await page.locator(".settings-place", { hasText: "БРОН" })
      .getByRole("button", { name: "Редактировать" }).click();
    await expect(page.locator(".settings-modal")).toBeVisible();
    await page.locator(".settings-modal").evaluate((el) => Promise.all(
      el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})),
    ));
    const price = page.locator(".settings-form").getByPlaceholder("Введите цену");
    await price.fill("999999999999");
    await expect(price).toHaveValue("999 999 999 999");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // the grouped value must not spill out of its own input either
    const spill = await price.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(spill, "grouped price overflows the input box").toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(SHOTS, "long-price-390.png") });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("keyboard: Escape closes, and inactive-row delete remains reachable", async () => {
    await openPlaces();
    const remove = page.locator(".settings-place", { hasText: "Архив" })
      .getByRole("button", DELETE_HALL);
    await remove.focus();
    await expect(remove).toBeFocused();
    // reachable and not colour-only: it carries an accessible name
    expect(await remove.getAttribute("aria-label")).toBe("Удалить место");

    await page.locator(".settings-place", { hasText: "БРОН" })
      .getByRole("button", { name: "Редактировать" }).click();
    await expect(page.locator(".settings-modal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".settings-modal")).toBeHidden();
  });
});
