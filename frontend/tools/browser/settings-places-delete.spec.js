import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Phase 5C-6D contract-replay oracle for the delete-confirmation modal.
//
// NOT live E2E (canonical backend deploy of bi06hde05 is a gated next step):
// this intercepts GET /halls and DELETE /halls/{id} and replays the canonical
// contract — DELETE archives the hall so it leaves the Settings directory on
// refetch (never a lingering "Неактивен" row). No credentials, no database.
// Screenshots land outside the repository.

const SHOTS = "C:\\Users\\zahongir\\Marjon-visual\\5c6d";
const CID = "c0000000-0000-0000-0000-000000000001";
const BR = "b0000000-0000-0000-0000-00000000000a";
const USER = {
  id: "u1", email: "vis@marjon.local", full_name: "Visual", role_slugs: ["owner"],
  auth_scope: "app", company_id: CID, company_name: "MARJON", is_active: true,
};
const COMPANY = { id: CID, name: "MARJON", currency: "UZS", timezone: "Asia/Tashkent" };
const BRANCHES = [{ id: BR, company_id: CID, name: "Основной филиал", is_active: true }];

function hall(id, name, sort_order, is_active = true) {
  return {
    id, company_id: CID, branch_id: BR, name, description: null, is_active,
    condition: null, percent: 10, price_amount: null, pricing_type: null,
    payment_type_id: null, sort_order, tables: [],
  };
}

const HALLS = [
  hall("h-a", "Зал A", 0),
  hall("h-del", "TEST DELETE 5C6D", 1),
  hall("h-off", "Архивный зал", 2, false),
];

async function setup(page) {
  const state = { halls: HALLS.map((h) => ({ ...h })) };
  const deleteCalls = [];
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "5c6d-fixture");
    localStorage.setItem("refresh_token", "5c6d-fixture");
  });
  await page.route(/\/api\/v1\/auth\/me(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) }));
  await page.route(/\/api\/v1\/companies\/me(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(COMPANY) }));
  await page.route(/\/api\/v1\/companies\/me\/branches(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BRANCHES) }));
  await page.route(/\/api\/v1\/billing\/balance(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ balance: 0 }) }));
  await page.route(/cbu\.uz\//, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ Rate: "11801.2" }]) }));
  // DELETE archives → the hall leaves the directory on next GET (204, no body).
  await page.route(/\/api\/v1\/halls\/[^/?]+(\?|$)/, async (route) => {
    if (route.request().method() !== "DELETE") { await route.fallback(); return; }
    const id = route.request().url().split("/halls/")[1].split(/[?#]/)[0];
    deleteCalls.push(id);
    state.halls = state.halls.filter((h) => h.id !== id);
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route(/\/api\/v1\/halls(\?|$)/, async (route) => {
    const sorted = [...state.halls].sort((a, b) => a.sort_order - b.sort_order);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sorted) });
  });
  return { deleteCalls, state };
}

function names(page) {
  return page.locator(".settings-place__name").allTextContents();
}
function trashFor(page, name) {
  return page.locator(".settings-place", { hasText: name }).getByRole("button", { name: "Удалить место" });
}

test.describe.configure({ mode: "serial" });

test.describe("Phase 5C-6D — delete confirmation modal", () => {
  test.beforeAll(() => { fs.mkdirSync(SHOTS, { recursive: true }); });

  test("Trash opens modal; Отмена keeps the hall; Удалить removes it after refetch", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const { deleteCalls } = await setup(page);
    await page.goto("/settings/places");
    await expect(page.locator(".settings-place__name").first()).toBeVisible();
    expect(await names(page)).toEqual(["Зал A", "TEST DELETE 5C6D", "Архивный зал"]);

    // Open the confirm modal — nothing deleted yet.
    await trashFor(page, "TEST DELETE 5C6D").click();
    await expect(page.getByRole("heading", { name: "Удалить место?" })).toBeVisible();
    await expect(page.getByText("Вы уверены, что хотите удалить")).toBeVisible();
    expect(deleteCalls.length).toBe(0);
    await page.screenshot({ path: path.join(SHOTS, "A-delete-modal-1280.png"), fullPage: true });
    await page.getByRole("button", { name: "Удалить", exact: true }).hover();
    await page.screenshot({ path: path.join(SHOTS, "B-delete-modal-danger-hover-1280.png"), fullPage: true });

    // Cancel → nothing changes.
    await page.getByRole("button", { name: "Отмена" }).click();
    await expect(page.getByRole("heading", { name: "Удалить место?" })).toHaveCount(0);
    expect(deleteCalls.length).toBe(0);
    expect(await names(page)).toContain("TEST DELETE 5C6D");
    await page.screenshot({ path: path.join(SHOTS, "C-delete-cancelled-1280.png"), fullPage: true });

    // Confirm → exactly one DELETE, row disappears after canonical refetch.
    await trashFor(page, "TEST DELETE 5C6D").click();
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Удалить место?" })).toHaveCount(0);
    await expect(page.locator(".settings-place__name")).toHaveText(["Зал A", "Архивный зал"]);
    expect(deleteCalls).toEqual(["h-del"]);
    await page.screenshot({ path: path.join(SHOTS, "D-delete-confirmed-list-1280.png"), fullPage: true });
    await page.close();
  });

  test("delete survives F5 (archived hall stays gone)", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await setup(page);
    await page.goto("/settings/places");
    await trashFor(page, "TEST DELETE 5C6D").click();
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(page.locator(".settings-place__name")).toHaveText(["Зал A", "Архивный зал"]);
    await page.reload();
    await expect(page.locator(".settings-place__name")).toHaveText(["Зал A", "Архивный зал"]);
    await page.close();
  });

  test("inactive (Неактивен) hall also deletes via the same modal", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const { deleteCalls } = await setup(page);
    await page.goto("/settings/places");
    const row = page.locator(".settings-place", { hasText: "Архивный зал" });
    await expect(row.getByText("Неактивен")).toBeVisible();
    await trashFor(page, "Архивный зал").click();
    await expect(page.getByRole("heading", { name: "Удалить место?" })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "E-inactive-delete-modal-1280.png"), fullPage: true });
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(page.locator(".settings-place__name")).toHaveText(["Зал A", "TEST DELETE 5C6D"]);
    expect(deleteCalls).toEqual(["h-off"]);
    await page.close();
  });
});
