import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Phase 5C-6C LIVE E2E — real browser (localhost:5173) against the REAL
// canonical backend @1bcadfe (localhost:8000). NO route mocking. A real OWNER
// token (owner@marjon.uz) is injected into localStorage so the app talks to the
// live API. Screenshots land outside the repository.

const SHOTS = "C:\\Users\\zahongir\\Marjon-visual\\5c6c-live";
const API = "http://localhost:8000/api/v1";
let TOKENS = null;
let ORIGINAL_ORDER = null; // [{id,name,sort_order,branch_id}] captured for restore

// LIVE opt-in: this whole spec authenticates with real OWNER credentials and
// MUTATES canonical marjon_authoritative (creates/edits/reorders Halls). It is
// SKIPPED by default and runs ONLY when MARJON_LIVE_E2E=1 is explicitly set, so
// a normal browser-test run touches no database.
const LIVE_E2E = process.env.MARJON_LIVE_E2E === "1";
const liveDescribe = LIVE_E2E ? test.describe : test.describe.skip;

test.beforeAll(async ({ request }) => {
  if (!LIVE_E2E) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const r = await request.post(`${API}/auth/login`, {
    data: { email: "owner@marjon.uz", password: "owner123" },
  });
  expect(r.ok(), `login failed: ${r.status()}`).toBeTruthy();
  TOKENS = await r.json();
  const list = await request.get(`${API}/halls?include_inactive=true`, {
    headers: { Authorization: `Bearer ${TOKENS.access_token}` },
  });
  ORIGINAL_ORDER = await list.json();
});

async function ownerPage(browser, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 950 } });
  await page.addInitScript(([a, rf]) => {
    localStorage.setItem("access_token", a);
    localStorage.setItem("refresh_token", rf);
  }, [TOKENS.access_token, TOKENS.refresh_token]);
  return page;
}

function names(page) {
  return page.locator(".settings-place__name").allTextContents();
}

async function apiHalls(request) {
  const r = await request.get(`${API}/halls?include_inactive=true`, {
    headers: { Authorization: `Bearer ${TOKENS.access_token}` },
  });
  return r.json();
}

const TEST_NAME = "TEST PRICE 5C6C";
let TEST_HALL_ID = null;

// Drive the real create/edit modal: name, %, custom "Доп. цена" listbox, amount.
async function fillHallForm(page, { name, percent, pricingLabel, price }) {
  if (name !== undefined) {
    const nameInput = page.locator(".settings-form__body input").first();
    await nameInput.fill(name);
  }
  if (percent !== undefined) {
    await page.getByPlaceholder("Введите %").fill(String(percent));
  }
  if (pricingLabel) {
    await page.locator("#hall-pricing-select").click();
    await page.getByRole("option", { name: pricingLabel }).click();
  }
  if (price !== undefined) {
    await page.getByPlaceholder("Введите цену").fill(String(price));
  }
}

test.describe.configure({ mode: "serial" });

liveDescribe("Phase 5C-6C LIVE — price + reorder against real backend", () => {
  test("hourly price create persists and shows on the main list", async ({ browser, request }) => {
    const page = await ownerPage(browser);
    await page.goto("/settings/places");
    await expect(page.locator(".settings-place__name").first()).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "live-A-list-before.png"), fullPage: true });

    await page.getByRole("button", { name: "Добавить место" }).click();
    await fillHallForm(page, { name: TEST_NAME, percent: 10, pricingLabel: "Цена за час", price: "100000" });
    await page.screenshot({ path: path.join(SHOTS, "live-B-create-hourly.png") });
    await page.getByRole("button", { name: "Добавить", exact: true }).click();

    // Main list row shows the hourly price to the LEFT of percent.
    const row = page.locator(".settings-place", { hasText: TEST_NAME });
    await expect(row.locator(".settings-place__price")).toContainText("Цена за час: 100 000 UZS");
    await expect(row.locator(".settings-place__percent")).toHaveText("10 %");
    await page.screenshot({ path: path.join(SHOTS, "live-C-hourly-on-list.png"), fullPage: true });

    // Backend truly persisted price_amount (not condition).
    const halls = await apiHalls(request);
    const created = halls.find((h) => h.name === TEST_NAME);
    expect(created).toBeTruthy();
    TEST_HALL_ID = created.id;
    expect(created.pricing_type).toBe("hourly");
    expect(String(created.price_amount)).toBe("100000.00");
    expect(String(created.percent)).toBe("10");
    await page.close();
  });

  test("editing the hourly amount to 250000 persists and updates the list", async ({ browser, request }) => {
    const page = await ownerPage(browser);
    await page.goto("/settings/places");
    const row = page.locator(".settings-place", { hasText: TEST_NAME });
    await row.getByRole("button", { name: "Редактировать" }).click();
    await fillHallForm(page, { price: "250000" });
    await page.getByRole("button", { name: "Сохранить", exact: true }).last().click();
    await expect(row.locator(".settings-place__price")).toContainText("Цена за час: 250 000 UZS");
    await expect(row.locator(".settings-place__percent")).toHaveText("10 %");
    const halls = await apiHalls(request);
    expect(String(halls.find((h) => h.id === TEST_HALL_ID).price_amount)).toBe("250000.00");
    await page.close();
  });

  test("switching to fixed 300000 persists and survives F5 (never condition)", async ({ browser, request }) => {
    const page = await ownerPage(browser);
    await page.goto("/settings/places");
    const row = page.locator(".settings-place", { hasText: TEST_NAME });
    await row.getByRole("button", { name: "Редактировать" }).click();
    // Clear current pricing, choose fixed, set amount.
    await fillHallForm(page, { pricingLabel: "Дополнительная цена", price: "300000" });
    await page.getByRole("button", { name: "Сохранить", exact: true }).last().click();
    await expect(row.locator(".settings-place__price")).toContainText("Дополнительная цена: 300 000 UZS");
    await page.reload();
    const rowAfter = page.locator(".settings-place", { hasText: TEST_NAME });
    await expect(rowAfter.locator(".settings-place__price")).toContainText("Дополнительная цена: 300 000 UZS");
    const halls = await apiHalls(request);
    const h = halls.find((x) => x.id === TEST_HALL_ID);
    expect(h.pricing_type).toBe("fixed");
    expect(String(h.price_amount)).toBe("300000.00");
    await page.screenshot({ path: path.join(SHOTS, "live-D-fixed-after-f5.png"), fullPage: true });
    await page.close();
  });

  async function dragOnto(page, sourceName, targetName) {
    const src = page.getByRole("button", { name: `Открыть столы: ${sourceName}` });
    const dst = page.getByRole("button", { name: `Открыть столы: ${targetName}` });
    const s = await src.boundingBox();
    const d = await dst.boundingBox();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2 - 14, { steps: 5 });
    await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2, { steps: 10 });
    await page.mouse.up();
  }

  test("live drag persists via one PATCH, no error, survives F5 (twice)", async ({ browser, request }) => {
    const page = await ownerPage(browser);
    const reorderCalls = [];
    page.on("request", (r) => {
      if (r.method() === "PATCH" && r.url().includes("/halls/reorder")) reorderCalls.push(r.url());
    });
    await page.goto("/settings/places");
    await expect(page.locator(".settings-place__name").first()).toBeVisible();
    const before = await names(page);
    const firstName = before[0];

    // Drag the TEST hall up onto the first row.
    await dragOnto(page, TEST_NAME, firstName);
    await expect.poll(() => reorderCalls.length).toBe(1); // exactly one request
    await expect(page.locator(".settings-place__name").first()).toHaveText(TEST_NAME);
    // Success ⇒ NO error banner.
    await expect(page.locator(".settings-places-order-error")).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, "live-E-after-drag.png"), fullPage: true });

    // Persist across F5.
    await page.reload();
    await expect(page.locator(".settings-place__name").first()).toHaveText(TEST_NAME);

    // Second reorder proves durable persistence, then F5 again.
    const afterFirst = await names(page);
    await dragOnto(page, afterFirst[2], TEST_NAME); // move 3rd up above TEST
    await expect.poll(() => reorderCalls.length).toBe(2);
    await page.reload();
    await expect(page.locator(".settings-place__name").first()).toBeVisible();
    const finalOrder = await names(page);
    // API sort_order agrees with the visible order.
    const halls = await apiHalls(request);
    const apiOrder = halls.slice().sort((a, b) => a.sort_order - b.sort_order).map((h) => h.name);
    expect(finalOrder).toEqual(apiOrder);
    await page.close();
  });
});

test.afterAll(async ({ request }) => {
  if (!TOKENS) return;
  const auth = { Authorization: `Bearer ${TOKENS.access_token}` };
  // Deactivate ONLY the temporary test hall.
  if (TEST_HALL_ID) {
    await request.delete(`${API}/halls/${TEST_HALL_ID}`, { headers: auth });
  }
  // Restore the pre-existing halls to their original order (complete-list
  // contract: include the now-inactive test hall last).
  if (ORIGINAL_ORDER && ORIGINAL_ORDER.length) {
    const branchId = ORIGINAL_ORDER[0].branch_id;
    const ids = ORIGINAL_ORDER.map((h) => h.id);
    if (TEST_HALL_ID) ids.push(TEST_HALL_ID);
    await request.patch(`${API}/halls/reorder`, {
      headers: auth,
      data: { branch_id: branchId, hall_ids: ids },
    });
  }
});
