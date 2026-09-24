import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Real-browser visual oracle for Settings → Единица измерения. Runs against
// the review runtime on :5280 and route-mocks auth/shell + the /units
// dictionary, so it needs no backend and touches no database. Screenshots +
// computed-colour proof land outside the repository.
test.use({ baseURL: "http://127.0.0.1:5280" });

const SHOTS = "C:\\Users\\zahongir\\Marjon-visual\\units";
const OWNER_ACCENT = "rgb(31, 201, 201)"; // #1FC9C9
const ACTIVE_GREEN = "rgb(0, 220, 59)"; // #00DC3B

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
};

const UNITS = [
  { id: "u-g", name: "Граммы", short_name: "г", sort: 1, status: true },
  { id: "u-kg", name: "Килограммы", short_name: "кг", sort: 2, status: false },
];

let page;
let units = [];

test.describe("Settings → Единица измерения — visual contract", () => {
  test.beforeAll(async ({ browser }) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => {
      localStorage.setItem("access_token", "units-visual-fixture");
      localStorage.setItem("refresh_token", "units-visual-fixture");
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
    // Neighbor Settings pages visited by the SWR proof must never hit the
    // real backend: an unmocked 401 there logs the fixture session out and
    // yanks the page to /login mid-proof (flaky detached-sidebar retries).
    await page.route(/\/api\/v1\/finance\/payment-types(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, page: 1, size: 20 }),
    }));
    await page.route(/\/api\/v1\/halls(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify([]),
    }));
    await page.route(/\/api\/v1\/companies\/me\/branches(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify([]),
    }));
    await page.route(/\/api\/v1\/units(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ items: units, total: units.length, page: 1, size: 20 }),
    }));
  });

  test.afterAll(async () => { await page.close(); });

  async function open() {
    await page.goto("/settings/units");
    await page.locator(".units-page").waitFor({ state: "visible", timeout: 30000 });
  }

  test("CASE 1 — empty page: header + compact card, title only", async () => {
    units = [];
    await open();
    await expect(page.getByText("Единиц измерения пока нет")).toBeVisible();
    await expect(page.getByRole("button", { name: "Добавить единицу измерения" })).toHaveCount(1);
    const cardBox = await page.locator(".units-page .settings-card").boundingBox();
    fs.writeFileSync(path.join(SHOTS, "_empty-card-height.txt"), `empty card height=${Math.round(cardBox.height)}px`);
    await page.screenshot({ path: path.join(SHOTS, "1-empty-1280.png"), fullPage: true });
  });

  test("CASE 2 — populated table: headers, alignment, accent, status colour", async () => {
    units = UNITS;
    await open();
    await expect(page.getByRole("cell", { name: "Граммы", exact: true })).toBeVisible();
    const addBtn = page.getByRole("button", { name: "Добавить единицу измерения" });
    const addBg = await addBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(addBg).toBe(OWNER_ACCENT);

    // Column boxes coincide for header/body (single auto-layout grid).
    const cols = await page.evaluate(() => {
      const table = document.querySelector(".units-page .settings-table");
      const lefts = (sel) => [...table.querySelectorAll(sel)].map((el) => Math.round(el.getBoundingClientRect().left));
      return { head: lefts("thead th"), body: lefts("tbody tr:first-child td") };
    });
    expect(cols.body).toEqual(cols.head);

    // Guide-line ink contract: cols 1-2 share left edges (+11 nudge), col 4
    // shares the right edge (+11), Тип-like col 3 has no centering here.
    const ink = await page.evaluate(() => {
      const table = document.querySelector(".units-page .settings-table");
      const box = (cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0.5);
        if (!rects.length) return null;
        const l = Math.min(...rects.map((r) => r.left));
        const rgt = Math.max(...rects.map((r) => r.right));
        return { left: Math.round(l), right: Math.round(rgt) };
      };
      const ths = [...table.querySelectorAll("thead th")];
      const tds = [...table.querySelectorAll("tbody tr:first-child td")];
      return { head: ths.map(box), body: tds.map(box) };
    });
    for (const i of [0, 1]) {
      expect(ink.body[i].left - ink.head[i].left).toEqual(11);
    }
    expect(ink.body[3].right - ink.head[3].right).toEqual(11);

    const activeColor = await page.getByText("Активен").first().evaluate((el) => getComputedStyle(el).color);
    expect(activeColor).toBe(ACTIVE_GREEN);

    fs.writeFileSync(
      path.join(SHOTS, "_table-proof.txt"),
      `Add button bg=${addBg}\nheader col lefts=${cols.head.join(", ")}\nbody   col lefts=${cols.body.join(", ")}\nАктивен color=${activeColor}`,
    );
    await page.screenshot({ path: path.join(SHOTS, "2-populated-1280.png"), fullPage: true });
  });

  test("CASE 3 — Add modal: exact fields, no Сорт, teal Save", async () => {
    units = UNITS;
    await open();
    await page.getByRole("button", { name: "Добавить единицу измерения" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("heading", { name: "Добавить единицу измерения" })).toBeVisible();
    await expect(dialog.getByText("Название", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Короткое название")).toBeVisible();
    await expect(dialog.getByText("Статус", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Сорт", { exact: true })).toHaveCount(0);
    const saveBtn = page.getByRole("button", { name: "Сохранить" });
    const saveBg = await saveBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(saveBg).toBe(OWNER_ACCENT);
    await page.screenshot({ path: path.join(SHOTS, "3-add-modal-1280.png") });
  });

  test("CASE 4 — edit modal pre-fills + inline sort present", async () => {
    units = UNITS;
    await open();
    await page.getByRole("button", { name: "Редактировать «Граммы»" }).click();
    await expect(page.getByRole("heading", { name: "Редактировать единицу измерения" })).toBeVisible();
    await page.keyboard.press("Escape");
    const sortInput = page.getByLabel("Сорт: Граммы");
    await expect(sortInput).toHaveValue("1");
    await page.screenshot({ path: path.join(SHOTS, "4-table-1280.png") });
  });

  test("CASE 5 — delete confirm, same family", async () => {
    units = UNITS;
    await open();
    await page.getByRole("button", { name: "Удалить «Граммы»" }).click();
    await expect(page.getByRole("heading", { name: "Удалить единицу измерения?" })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "5-delete-confirm-1280.png") });
  });

  test("CASE 6 — 403 mutation keeps truthful owner-limitation error", async () => {
    units = UNITS;
    await open();
    await page.route(/\/api\/v1\/units(\?|$)/, (route) => {
      if (route.request().method() !== "GET") {
        route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ detail: "Forbidden" }) });
      } else {
        route.continue();
      }
    });
    await page.getByRole("button", { name: "Добавить единицу измерения" }).click();
    await page.getByLabel("Название").first().fill("Метр");
    await page.getByLabel("Короткое название").fill("м");
    await page.getByRole("button", { name: "Сохранить" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Изменение единиц измерения пока недоступно для владельца.")).toBeVisible();
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "6-403-1280.png") });
  });

  test("CASE 7 — return navigation SWR proof: cached rows visible while delayed GET pends", async () => {
    // Drop CASE 6's mutation-403 handler so GET starts from a clean immediate
    // fulfill; the delayed gate is installed only for the return visit below.
    await page.unroute(/\/api\/v1\/units(\?|$)/);
    await page.route(/\/api\/v1\/units(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ items: units, total: units.length, page: 1, size: 20 }),
    }));
    units = UNITS;
    await open();
    await expect(page.getByText("Граммы", { exact: true })).toBeVisible();
    // Leave via SPA sidebar (keeps the in-memory session cache)…
    await page.getByRole("link", { name: /Способ оплаты/ }).first().click();
    await expect(page.getByRole("heading", { name: "Способ оплаты" })).toBeVisible({ timeout: 30000 });
    // …then delay the next /units GET and return.
    await page.unroute(/\/api\/v1\/units(\?|$)/);
    let release;
    const gate = new Promise((res) => { release = res; });
    await page.route(/\/api\/v1\/units(\?|$)/, async (route) => {
      if (route.request().method() === "GET") await gate;
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ items: units, total: units.length, page: 1, size: 20 }),
      });
    });
    // Return via browser Back: the data router handles it as SPA navigation
    // (no reload, so the in-memory session cache survives; the sidebar
    // submenu re-renders unstably here, so a DOM click on its link flakes).
    await page.goBack();
    // Cached REAL rows must already be visible while the GET is still pending.
    await expect(page.getByText("Граммы", { exact: true })).toBeVisible({ timeout: 5000 });
    expect(await page.getByText("Загрузка...").count()).toBe(0);
    // Empty-table shell headers stay rendered from cache too.
    expect(await page.locator(".units-page .settings-table thead th").count()).toBe(5);
    release();
    await expect(page.getByText("Килограммы", { exact: true })).toBeVisible({ timeout: 10000 });
    expect(await page.getByText("Загрузка...").count()).toBe(0);
    await page.screenshot({ path: path.join(SHOTS, "7-return-swr-1280.png"), fullPage: true });
  });
});
