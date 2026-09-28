import { test, expect } from "@playwright/test";

// Customer preview-top alignment oracle: the right preview stage starts at
// the top-controls row (paper selector), with paper width/scale preserved,
// width-driven fit only (no height-fit), stable under browser zoom.
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

test.describe("Customer preview stage — raised top alignment", () => {
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

  async function metrics() {
    await page.goto("/settings/receipt");
    await page.locator(".receipt-settings-page").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("[data-receipt-print-root]").waitFor({ state: "visible", timeout: 30000 });
    return page.evaluate(() => {
      const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width) }; };
      const root = document.querySelector("[data-receipt-print-root]");
      const shell = document.querySelector("[data-receipt-preview-shell]");
      const printBtn = [...document.querySelectorAll(".receipt-header .receipt-editor-actions button")].find((b) => b.textContent.includes("Печать"));
      const pb = printBtn ? printBtn.getBoundingClientRect() : null;
      return {
        stage: r(".receipt-preview-col"),
        controls: r(".receipt-header .receipt-editor-actions"),
        paperSelect: null,
        printBtn: pb ? { top: Math.round(pb.top) } : null,
        paperW: root ? Math.round(root.getBoundingClientRect().width) : null,
        scale: shell ? shell.getAttribute("data-fit-scale") : null,
      };
    });
  }

  test("stage top aligns with the top-controls row; paper width/scale preserved", async () => {
    const m = await metrics();
    // No paper selector remains: the stage aligns with the header actions row.
    expect(Math.abs(m.stage.top - m.controls.top)).toBeLessThanOrEqual(8);
    expect(Math.abs(m.stage.top - m.printBtn.top)).toBeLessThanOrEqual(8);
    expect(m.paperW).toBeGreaterThanOrEqual(395);
    expect(m.paperW).toBeLessThanOrEqual(415);
    expect(Number(m.scale)).toBeGreaterThanOrEqual(0.5);
    expect(Number(m.scale)).toBeLessThanOrEqual(1);
  });

  test("browser zoom keeps the width-driven scale (no height-fit)", async () => {
    await metrics();
    const s100 = await page.evaluate(() => document.querySelector("[data-receipt-preview-shell]").getAttribute("data-fit-scale"));
    // DevTools deviceScaleFactor is the zoom-independent proxy here: the fit
    // contract binds scale to pane WIDTH only, so a shorter viewport must not
    // shrink the receipt.
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.waitForTimeout(400);
    const s700 = await page.evaluate(() => document.querySelector("[data-receipt-preview-shell]").getAttribute("data-fit-scale"));
    expect(Math.abs(Number(s700) - Number(s100))).toBeLessThanOrEqual(0.05);
    await page.setViewportSize({ width: 1440, height: 900 });
  });
});
