import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Phase 5C-6E LIVE E2E — real browser (localhost:5173) against the REAL
// canonical backend deployed at 458ee45 (localhost:8000) on marjon_authoritative
// @ bi06hde05. NO route mocking, NO fixtures. A real OWNER token
// (owner@marjon.uz) is injected into localStorage so the app talks to the live
// API. Proves the Phase 5C-6D domain split end to end:
//   INACTIVE (is_active=false, deleted_at NULL) → stays visible as «Неактивен»
//   DELETED  (deleted_at NOT NULL)              → leaves the directory entirely
// Screenshots land outside the repository.

const SHOTS = "C:\\Users\\zahongir\\Marjon-visual\\5c6e-live";
const API = "http://localhost:8000/api/v1";
const TEST_NAME = "TEST DELETE 5C6E";

let TOKENS = null;
let AUTH = null;
let ORIGINAL_ORDER = null; // pre-existing halls, for order restore
let TEST_HALL = null; // {id, branch_id, ...}

// LIVE opt-in: this whole spec authenticates with real OWNER credentials and
// MUTATES canonical marjon_authoritative (creates, toggles, deletes, reorders
// Halls). It is SKIPPED by default and runs ONLY when MARJON_LIVE_E2E=1 is
// explicitly set. Default/CI invocation must never mutate the canonical DB.
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
  AUTH = { Authorization: `Bearer ${TOKENS.access_token}` };
  const list = await request.get(`${API}/halls?include_inactive=true`, { headers: AUTH });
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
function rowFor(page, name) {
  return page.locator(".settings-place", { hasText: name });
}
function trashFor(page, name) {
  return rowFor(page, name).getByRole("button", { name: "Удалить место" });
}
async function apiHalls(request, { includeInactive = true } = {}) {
  const q = includeInactive ? "?include_inactive=true" : "";
  return (await request.get(`${API}/halls${q}`, { headers: AUTH })).json();
}
// Count DELETE calls to the test hall, live.
function watchDeletes(page) {
  const calls = [];
  page.on("request", (r) => {
    if (r.method() === "DELETE" && /\/halls\/[^/?]+(\?|$)/.test(r.url())) calls.push(r.url());
  });
  return calls;
}

test.describe.configure({ mode: "serial" });

liveDescribe("Phase 5C-6E LIVE — inactive vs deleted Hall against real backend", () => {
  test("create the temporary Hall in the active branch (active, not deleted)", async ({ browser, request }) => {
    const page = await ownerPage(browser);
    await page.goto("/settings/places");
    await expect(page.locator(".settings-place__name").first()).toBeVisible();

    await page.getByRole("button", { name: "Добавить место" }).click();
    await page.locator(".settings-form__body input").first().fill(TEST_NAME);
    await page.getByPlaceholder("Введите %").fill("15");
    await page.getByRole("button", { name: "Добавить", exact: true }).click();
    await expect(rowFor(page, TEST_NAME)).toBeVisible();

    const halls = await apiHalls(request);
    TEST_HALL = halls.find((h) => h.name === TEST_NAME);
    expect(TEST_HALL, "test hall must exist via the live API").toBeTruthy();
    expect(TEST_HALL.is_active).toBe(true);
    // Canonical initial state: active, NOT deleted.
    expect(TEST_HALL.deleted_at ?? null).toBeNull();
    await page.close();
  });

  test("status OFF makes it Неактивен, still visible, deleted_at stays NULL after F5", async ({ browser, request }) => {
    const page = await ownerPage(browser);
    await page.goto("/settings/places");
    const row = rowFor(page, TEST_NAME);
    await expect(row.getByText("Активен")).toBeVisible();

    await row.getByRole("button", { name: "Редактировать" }).click();
    // The hall status switch: the only checkbox in the place modal body.
    await page.locator(".settings-toggle-field .settings-switch").click();
    await expect(page.locator(".settings-switch__label")).toHaveText("Неактивен");
    await page.getByRole("button", { name: "Сохранить", exact: true }).last().click();

    // Visible AND labelled Неактивен — an inactive hall is NOT deleted.
    await expect(rowFor(page, TEST_NAME).getByText("Неактивен")).toBeVisible();
    await page.reload();
    await expect(rowFor(page, TEST_NAME).getByText("Неактивен")).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "A-inactive-before-delete-1280.png"), fullPage: true });

    const h = (await apiHalls(request)).find((x) => x.id === TEST_HALL.id);
    expect(h.is_active).toBe(false);
    expect(h.deleted_at ?? null).toBeNull();
    await page.close();
  });

  test("Trash opens the modal WITHOUT deleting; Отмена / Escape / backdrop all close safely", async ({ browser, request }) => {
    const page = await ownerPage(browser);
    const deletes = watchDeletes(page);
    await page.goto("/settings/places");
    await expect(rowFor(page, TEST_NAME)).toBeVisible();

    // 1. Trash → modal, zero DELETE.
    await trashFor(page, TEST_NAME).click();
    await expect(page.getByRole("heading", { name: "Удалить место?" })).toBeVisible();
    expect(deletes.length).toBe(0);
    await expect(page.getByText("Удаление", { exact: true })).toBeVisible();
    await expect(page.locator(".settings-confirm__text")).toContainText(
      `Вы уверены, что хотите удалить «${TEST_NAME}»?`
    );
    await expect(page.locator(".settings-confirm__hint")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Отмена" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Удалить", exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "B-delete-modal-1280.png"), fullPage: true });
    await page.getByRole("button", { name: "Удалить", exact: true }).hover();
    await page.screenshot({ path: path.join(SHOTS, "C-delete-modal-danger-hover-1280.png"), fullPage: true });

    // 2. Отмена.
    await page.getByRole("button", { name: "Отмена" }).click();
    await expect(page.getByRole("heading", { name: "Удалить место?" })).toHaveCount(0);
    expect(deletes.length).toBe(0);
    await expect(rowFor(page, TEST_NAME)).toBeVisible();

    // 3. Escape.
    await trashFor(page, TEST_NAME).click();
    await expect(page.getByRole("heading", { name: "Удалить место?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Удалить место?" })).toHaveCount(0);
    expect(deletes.length).toBe(0);
    await expect(rowFor(page, TEST_NAME)).toBeVisible();

    // 4. Backdrop.
    await trashFor(page, TEST_NAME).click();
    await expect(page.getByRole("heading", { name: "Удалить место?" })).toBeVisible();
    await page.locator(".settings-drawer__backdrop").click({ position: { x: 12, y: 12 } });
    await expect(page.getByRole("heading", { name: "Удалить место?" })).toHaveCount(0);
    expect(deletes.length).toBe(0);
    await expect(rowFor(page, TEST_NAME)).toBeVisible();

    // Nothing was archived by any of the three escape hatches.
    const h = (await apiHalls(request)).find((x) => x.id === TEST_HALL.id);
    expect(h, "hall must still be in the live directory").toBeTruthy();
    expect(h.deleted_at ?? null).toBeNull();
    await page.close();
  });

  test("confirm sends EXACTLY ONE DELETE; the row disappears and stays gone after F5", async ({ browser, request }) => {
    const page = await ownerPage(browser);
    const deletes = watchDeletes(page);
    await page.goto("/settings/places");
    await expect(rowFor(page, TEST_NAME)).toBeVisible();

    await trashFor(page, TEST_NAME).click();
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Удалить место?" })).toHaveCount(0);

    // The row must DISAPPEAR — not linger as «Неактивен».
    await expect(rowFor(page, TEST_NAME)).toHaveCount(0);
    expect(await names(page)).not.toContain(TEST_NAME);
    expect(deletes.filter((u) => u.includes(TEST_HALL.id)).length, "exactly one DELETE").toBe(1);
    expect(deletes.length).toBe(1);
    await page.screenshot({ path: path.join(SHOTS, "D-after-delete-1280.png"), fullPage: true });

    // F5 persistence — backend-authoritative, not an optimistic UI removal.
    await page.reload();
    await expect(page.locator(".settings-place__name").first()).toBeVisible();
    expect(await names(page)).not.toContain(TEST_NAME);
    await page.screenshot({ path: path.join(SHOTS, "E-after-delete-f5-1280.png"), fullPage: true });

    // Absent from BOTH live list contracts.
    const plain = await apiHalls(request, { includeInactive: false });
    const archive = await apiHalls(request, { includeInactive: true });
    expect(plain.some((h) => h.id === TEST_HALL.id)).toBe(false);
    expect(archive.some((h) => h.id === TEST_HALL.id)).toBe(false);

    // Management resolver rejects a deleted hall; PATCH cannot resurrect it.
    const get = await request.get(`${API}/halls/${TEST_HALL.id}`, { headers: AUTH });
    expect(get.status()).toBe(404);
    const patch = await request.patch(`${API}/halls/${TEST_HALL.id}`, {
      headers: AUTH, data: { is_active: true },
    });
    expect(patch.status()).toBe(404);
    const tables = await request.get(`${API}/halls/${TEST_HALL.id}/tables`, { headers: AUTH });
    expect(tables.status()).toBe(404);

    // Not offered as a selectable report place.
    const meta = await request.get(`${API}/reports/tables/filters`, { headers: AUTH });
    expect(meta.status()).toBe(200);
    const body = await meta.json();
    expect(body.places.some((p) => p.value === TEST_HALL.id)).toBe(false);
    expect(body.places.some((p) => p.label === TEST_NAME)).toBe(false);
    await page.close();
  });

  test("remaining halls are contiguous 0..n-1 and reorder excludes the deleted id", async ({ browser, request }) => {
    const page = await ownerPage(browser);
    const reorderCalls = [];
    page.on("request", async (r) => {
      if (r.method() === "PATCH" && r.url().includes("/halls/reorder")) {
        reorderCalls.push(r.postDataJSON());
      }
    });
    await page.goto("/settings/places");
    await expect(page.locator(".settings-place__name").first()).toBeVisible();

    // Compaction: surviving halls hold a contiguous 0..n-1 block.
    const before = await apiHalls(request);
    const orders = before.map((h) => h.sort_order).sort((a, b) => a - b);
    expect(orders).toEqual(before.map((_, i) => i));
    expect(before.some((h) => h.id === TEST_HALL.id)).toBe(false);

    const visible = await names(page);
    test.skip(visible.length < 2, "needs at least two visible halls to drag");

    const src = page.getByRole("button", { name: `Открыть столы: ${visible[1]}` });
    const dst = page.getByRole("button", { name: `Открыть столы: ${visible[0]}` });
    const s = await src.boundingBox();
    const d = await dst.boundingBox();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2 - 14, { steps: 5 });
    await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2, { steps: 10 });
    await page.mouse.up();

    await expect.poll(() => reorderCalls.length).toBe(1);
    await expect(page.locator(".settings-place__name").first()).toHaveText(visible[1]);
    await expect(page.locator(".settings-places-order-error")).toHaveCount(0);

    // Payload = the COMPLETE non-deleted branch set; the deleted id is absent.
    const payload = reorderCalls[0];
    expect(payload.hall_ids).not.toContain(TEST_HALL.id);
    expect(new Set(payload.hall_ids)).toEqual(new Set(before.map((h) => h.id)));
    expect(payload.branch_id).toBe(TEST_HALL.branch_id);
    await page.screenshot({ path: path.join(SHOTS, "F-reorder-after-delete-1280.png"), fullPage: true });

    // Survives F5, and the API order agrees with the visible order.
    await page.reload();
    await expect(page.locator(".settings-place__name").first()).toHaveText(visible[1]);
    const after = await apiHalls(request);
    const apiOrder = after.slice().sort((a, b) => a.sort_order - b.sort_order).map((h) => h.name);
    expect(await names(page)).toEqual(apiOrder);
    await page.close();
  });

  test("row text is not selectable, but modal inputs still are", async ({ browser }) => {
    const page = await ownerPage(browser);
    await page.goto("/settings/places");
    const row = page.locator(".settings-place").first();
    await expect(row).toBeVisible();

    // Scoped suppression, not a global one.
    for (const sel of [".settings-place__name", ".settings-place__price", ".settings-place__percent"]) {
      const el = row.locator(sel).first();
      if (await el.count()) {
        expect(await el.evaluate((n) => getComputedStyle(n).userSelect)).toBe("none");
      }
    }
    expect(await page.evaluate(() => getComputedStyle(document.body).userSelect)).not.toBe("none");

    // A real drag across the row paints no selection.
    const box = await row.locator(".settings-place__name").first().boundingBox();
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    expect(await page.evaluate(() => String(window.getSelection()))).toBe("");

    // Modal inputs remain fully interactive and selectable.
    await page.getByRole("button", { name: "Добавить место" }).click();
    const input = page.locator(".settings-form__body input").first();
    await input.fill("Проверка выделения");
    expect(await input.evaluate((n) => getComputedStyle(n).userSelect)).not.toBe("none");
    await input.selectText();
    expect(await input.evaluate((n) => n.selectionEnd - n.selectionStart)).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await page.close();
  });

  test("price and status presentation still correct on the live list", async ({ browser, request }) => {
    const page = await ownerPage(browser);
    await page.goto("/settings/places");
    await expect(page.locator(".settings-place__name").first()).toBeVisible();

    const halls = await apiHalls(request);
    const priced = halls.find((h) => h.price_amount != null && h.pricing_type);
    test.skip(!priced, "no canonical hall carries a structured price");

    const row = rowFor(page, priced.name);
    const label = priced.pricing_type === "hourly" ? "Цена за час" : "Дополнительная цена";
    const amount = Number(priced.price_amount).toLocaleString("ru-RU").replace(/ /g, " ");
    await expect(row.locator(".settings-place__price")).toContainText(label);
    await expect(row.locator(".settings-place__price")).toContainText(amount);
    await expect(row.locator(".settings-place__price")).toContainText("UZS");

    // Price sits to the LEFT of percent in the DOM order.
    const order = await row.evaluate((n) => Array.from(n.querySelectorAll("[class*=settings-place__]"))
      .map((c) => c.className).filter((c) => /price|percent/.test(c)));
    expect(order.findIndex((c) => c.includes("price")))
      .toBeLessThan(order.findIndex((c) => c.includes("percent")));

    await page.reload();
    await expect(rowFor(page, priced.name).locator(".settings-place__price")).toContainText(amount);

    // Active/inactive remain textually distinct; deleted is simply absent.
    const anyActive = halls.find((h) => h.is_active);
    const anyInactive = halls.find((h) => !h.is_active);
    if (anyActive) await expect(rowFor(page, anyActive.name).getByText("Активен")).toBeVisible();
    if (anyInactive) await expect(rowFor(page, anyInactive.name).getByText("Неактивен")).toBeVisible();
    expect(await names(page)).not.toContain(TEST_NAME);
    await page.close();
  });
});

test.afterAll(async ({ request }) => {
  if (!AUTH || !ORIGINAL_ORDER || !ORIGINAL_ORDER.length) return;
  // Restore the pre-existing halls to their original order. The test hall is
  // deleted (archived), so it is correctly NOT part of the complete set.
  const branchId = ORIGINAL_ORDER[0].branch_id;
  const ids = ORIGINAL_ORDER.map((h) => h.id);
  await request.patch(`${API}/halls/reorder`, {
    headers: AUTH,
    data: { branch_id: branchId, hall_ids: ids },
  });
});
