import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Real-browser proof for the Reports empty-state transition fix.
// Runs against the review runtime on :5281, route-mocks auth/shell + report
// endpoints (empty, deliberately DELAYED), and drives client-side navigation so
// the session memory-cache is exercised (no full reload between subcategories).
test.use({ baseURL: "http://127.0.0.1:5281" });

const SHOTS = "C:\\Users\\zahongir\\Marjon-visual\\reports-empty";
const GET_DELAY = 1600;

const FIXTURE_USER = { id: "u1", email: "a@b.c", full_name: "Fixture", role_slugs: ["owner"], auth_scope: "app", company_id: "c1", company_name: "MARJON", is_active: true };

let page;
const calls = { tables: 0, dishes: 0, orders: 0 };

test.describe("Reports empty-state PNG transition", () => {
  test.beforeAll(async ({ browser }) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => {
      localStorage.setItem("access_token", "reports-fixture");
      localStorage.setItem("refresh_token", "reports-fixture");
    });
    const okJson = (body) => (r) => r.fulfill({ status: 200, contentType: "application/json", body });
    await page.route(/\/api\/v1\/auth\/me(\?|$)/, okJson(JSON.stringify(FIXTURE_USER)));
    await page.route(/\/api\/v1\/companies\/me(\?|$)/, okJson(JSON.stringify({ id: "c1", name: "MARJON", currency: "UZS" })));
    await page.route(/\/api\/v1\/billing\/balance(\?|$)/, okJson("{\"balance\":0}"));
    await page.route(/cbu\.uz\//, okJson("[{\"Rate\":\"1\"}]"));
    await page.route(/\/api\/v1\/reports\/[a-z-]+\/filters(\?|$)/, okJson("{}"));
    const delayedEmpty = (kind) => async (route) => {
      calls[kind] += 1;
      await new Promise((r) => setTimeout(r, GET_DELAY));
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    };
    await page.route(/\/api\/v1\/reports\/tables(\?|$)/, delayedEmpty("tables"));
    await page.route(/\/api\/v1\/reports\/dishes(\?|$)/, delayedEmpty("dishes"));
    await page.route(/\/api\/v1\/reports\/orders(\?|$)/, delayedEmpty("orders"));
  });

  test.afterAll(async () => { await page.close(); });

  // PLACEHOLDER_TESTS
  const imgState = () => page.evaluate(() => {
    const img = document.querySelector(".owner-report-empty-image");
    return { present: !!img, complete: img ? img.complete : null, nw: img ? img.naturalWidth : null };
  });
  const clickNav = (href) => page.locator(`a[href="${href}"]`).first().click();

  test("FIRST VISIT: stable loading (no blank), then empty PNG once GET confirms zero", async () => {
    await page.goto("/reports/tables");
    await page.locator(".report-table").waitFor({ state: "visible", timeout: 30000 });
    // While the GET is pending: truthful loading treatment, NOT a blank tbody,
    // and NOT the empty PNG/title yet.
    await expect(page.getByText("Загрузка…")).toBeVisible();
    await expect(page.locator(".owner-report-empty-image")).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, "A-first-visit-loading.png"), fullPage: false });
    // After the backend confirms zero rows: canonical empty PNG + title appear;
    // the PNG is already decoded (preloaded) so there is no separate image delay.
    await expect(page.getByText("Столы не найдены")).toBeVisible({ timeout: GET_DELAY + 4000 });
    const img = await imgState();
    expect(img.present).toBe(true);
    expect(img.complete).toBe(true);
    expect(img.nw).toBeGreaterThan(0);
    await page.screenshot({ path: path.join(SHOTS, "B-first-visit-empty.png"), fullPage: false });
    fs.writeFileSync(path.join(SHOTS, "_measure.txt"),
      `GET delay=${GET_DELAY}ms\nfirst visit: loading shown (no blank), empty PNG after GET, img.complete=${img.complete} naturalWidth=${img.nw}\n`);
  });

  test("REVISIT: cached empty PNG shows immediately while a delayed background GET is pending", async () => {
    // Leave Tables (client-side nav, SPA stays alive → session cache kept)...
    await clickNav("/reports/dishes");
    await expect(page.getByText("Загрузка…")).toBeVisible();
    await page.getByText("Блюд не найдено").waitFor({ state: "visible", timeout: GET_DELAY + 4000 });
    const dishesCallsBefore = calls.dishes;
    // ...and return to Tables. The empty PNG must be visible IMMEDIATELY from the
    // session cache, with NO Загрузка… and NO blank, even though a fresh
    // (delayed) revalidation GET is now in flight.
    const tablesCallsBefore = calls.tables;
    await clickNav("/reports/tables");
    // Empty title present within a couple frames (cache), not after GET_DELAY.
    await expect(page.getByText("Столы не найдены")).toBeVisible({ timeout: 400 });
    expect(await page.getByText("Загрузка…").count()).toBe(0);
    const imgImmediate = await imgState();
    expect(imgImmediate.complete).toBe(true);
    await page.screenshot({ path: path.join(SHOTS, "C-revisit-instant-empty.png"), fullPage: false });
    // A background revalidation GET was actually issued (truthful, silent).
    await expect.poll(() => calls.tables).toBeGreaterThan(tablesCallsBefore);
    // While that background GET is still pending, the empty state stays put.
    await expect(page.getByText("Столы не найдены")).toBeVisible();
    expect(await page.getByText("Загрузка…").count()).toBe(0);
    // After it resolves (still empty), the state reconciles without flicker.
    await page.waitForTimeout(GET_DELAY + 300);
    await expect(page.getByText("Столы не найдены")).toBeVisible();
    fs.appendFileSync(path.join(SHOTS, "_measure.txt"),
      `revisit: cached empty visible within 400ms (delay=${GET_DELAY}ms), no Загрузка…, background revalidation issued (tables GETs: ${tablesCallsBefore}→${calls.tables}); dishes visited (${dishesCallsBefore} GET)\n`);
  });

});
