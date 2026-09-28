import { test, expect } from "@playwright/test";

// Style-control 3-zone geometry oracle for Settings → Настройка чека.
// Runs against the receipt runtime (:5277) with route-mocked auth/template,
// no backend, no database. Override with RECEIPT_BROWSER_BASE_URL.
const RECEIPT_BASE_URL = process.env.RECEIPT_BROWSER_BASE_URL || "http://127.0.0.1:5277";
test.use({ baseURL: RECEIPT_BASE_URL });

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
  name: "MARJON", currency: "UZS", timezone: "Asia/Tashkent",
  phone: "+998770702101", address: "Ташкент",
};

let page;

test.describe("Receipt style controls — 3-zone desktop geometry", () => {
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => {
      localStorage.setItem("access_token", "receipt-visual-fixture");
      localStorage.setItem("refresh_token", "receipt-visual-fixture");
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
    await page.route(/cbu\.uz\//, (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify([{ Rate: "11801.2" }]),
    }));
    await page.route(/\/api\/v1\/settings\/receipt-template(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({}),
    }));
    await page.route(/\/api\/v1\/settings\/kitchen-receipt-template(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  });

  test.afterAll(async () => { await page.close(); });

  async function open() {
    await page.goto("/settings/receipt");
    await page.locator(".receipt-settings-page").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("[data-receipt-print-root]").waitFor({ state: "visible", timeout: 30000 });
  }

  function rowFor(blockName) {
    return page.locator(".receipt-section-row").filter({ hasText: blockName }).first();
  }

  async function styleGeometry(blockName) {
    return rowFor(blockName).locator(".receipt-section-row__style").evaluate((styleEl) => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
      const groups = [...styleEl.querySelectorAll(":scope > .receipt-segment-group")];
      const labels = groups.map((g) => g.querySelector(":scope > span").textContent.trim());
      const segs = groups.map((g) => g.querySelector(":scope > .receipt-segments"));
      const buttons = segs.map((s) => [...s.querySelectorAll("button")]);
      return {
        row: r(styleEl),
        overflow: styleEl.scrollWidth > styleEl.clientWidth + 1,
        clipped: [...styleEl.querySelectorAll("button")].some((b) => b.scrollWidth > b.clientWidth + 1),
        groups: groups.map((g, i) => ({
          label: labels[i],
          box: r(g),
          labelBox: r(g.querySelector(":scope > span")),
          segBox: r(segs[i]),
          labelCx: (r(g.querySelector(":scope > span")).left + r(g.querySelector(":scope > span")).right) / 2,
          segCx: (r(segs[i]).left + r(segs[i]).right) / 2,
          segH: Math.round(segs[i].getBoundingClientRect().height),
          buttons: buttons[i].map((b) => ({ text: b.textContent.trim(), ...r(b) })),
        })),
      };
    });
  }

  for (const block of ["Название ресторана", "Стол", "Официант", "Дата и время", "Позиции"]) {
    test(`"${block}": size left / align center / weight right, one row`, async () => {
      await open();
      const g = await styleGeometry(block);
      expect(g.groups.map((x) => x.label)).toEqual(["Размер текста", "Выравнивание", "Жирность"]);
      // Size group: exactly the three approved labels, all on ONE row.
      const sizeBtns = g.groups[0].buttons;
      expect(sizeBtns.map((b) => b.text)).toEqual(["Стандартный", "Большой", "Очень большой"]);
      for (const b of sizeBtns) {
        expect(Math.abs(b.top - sizeBtns[0].top)).toBeLessThanOrEqual(1);
        expect(Math.abs(b.bottom - sizeBtns[0].bottom)).toBeLessThanOrEqual(1);
      }
      // Labels share one Y; segmented controls share one Y.
      for (let i = 1; i < 3; i++) {
        expect(Math.abs(g.groups[i].labelBox.top - g.groups[0].labelBox.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(g.groups[i].segBox.top - g.groups[0].segBox.top)).toBeLessThanOrEqual(1);
      }
      // Equal segmented-control heights despite 3/3/2 options.
      expect(Math.abs(g.groups[1].segH - g.groups[0].segH)).toBeLessThanOrEqual(2);
      expect(Math.abs(g.groups[2].segH - g.groups[0].segH)).toBeLessThanOrEqual(2);
      // Left-to-right order with full-width distribution.
      const [size, align, weight] = g.groups.map((x) => x.box);
      expect(size.left).toBeLessThan(align.left);
      expect(align.left).toBeLessThan(weight.left);
      expect(Math.abs(size.left - g.row.left)).toBeLessThanOrEqual(8);
      expect(Math.abs(g.row.right - weight.right)).toBeLessThanOrEqual(8);
      const rowCx = (g.row.left + g.row.right) / 2;
      const alignCx = (align.left + align.right) / 2;
      expect(Math.abs(alignCx - rowCx)).toBeLessThanOrEqual(60);
      expect(g.overflow).toBe(false);
      expect(g.clipped).toBe(false);
      // Substantial zone widths (1440px floors; wider viewports grow further).
      expect(align.right - align.left).toBeGreaterThanOrEqual(130);
      expect(weight.right - weight.left).toBeGreaterThanOrEqual(130);
      // Equal-width segments inside every control (<=2px tolerance).
      // Every label centered over its own control (<=2px tolerance).
      for (const grp of g.groups) {
        const widths = grp.buttons.map((b) => b.right - b.left);
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
        expect(Math.abs(grp.labelCx - grp.segCx)).toBeLessThanOrEqual(2);
      }
    });
  }

  test("narrow container stacks gracefully (no forced desktop row)", async () => {
    await page.setViewportSize({ width: 500, height: 900 });
    await open();
    const g = await styleGeometry("Название ресторана");
    const tops = g.groups.map((x) => x.box.top);
    expect(new Set(tops).size).toBeGreaterThan(1);
    expect(g.overflow).toBe(false);
      expect(g.clipped).toBe(false);
    await page.setViewportSize({ width: 1440, height: 900 });
  });
});
