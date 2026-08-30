import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Phase 5C-6B contract-replay oracle for branch-scoped Hall drag-and-drop.
//
// NOT live E2E: the runtime on :8000 is still the frozen pre-5C-6A image. This
// spec intercepts GET /halls and PATCH /halls/reorder and replays the canonical
// backend HEAD 1bcadfe contract (HallResponse.sort_order; PATCH /halls/reorder
// { branch_id, hall_ids } → the branch's halls in the new order). It sends no
// credentials and touches no database. Screenshots land outside the repository.

const SHOTS = "C:\\Users\\zahongir\\Marjon-visual\\5c6b";
const CID = "c0000000-0000-0000-0000-000000000001";
const BR_A = "b0000000-0000-0000-0000-00000000000a";
const BR_B = "b0000000-0000-0000-0000-00000000000b";
const FIXTURE_USER = {
  id: "u0000000-0000-0000-0000-000000000001", email: "vis@marjon.local",
  full_name: "Visual Fixture", role_slugs: ["owner"], auth_scope: "app",
  company_id: CID, company_name: "MARJON", is_active: true,
};
const FIXTURE_COMPANY = { id: CID, name: "MARJON", currency: "UZS", timezone: "Asia/Tashkent" };
const BRANCHES = [
  { id: BR_A, company_id: CID, name: "Основной филиал", is_active: true },
  { id: BR_B, company_id: CID, name: "Второй филиал", is_active: true },
];

function hall(id, name, sort_order, branch_id = BR_A, extra = {}) {
  return {
    id, company_id: CID, branch_id, name, description: null, is_active: true,
    condition: null, percent: 10, price_amount: null, pricing_type: null,
    payment_type_id: null, sort_order, tables: [], ...extra,
  };
}

// Single branch A: A(0) B(1) C(2) D(3); D carries fixed pricing to prove the
// price row survives a reorder.
const HALL_A = hall("aaaaaaaa-0000-0000-0000-000000000001", "Зал A", 0);
const HALL_B = hall("bbbbbbbb-0000-0000-0000-000000000002", "Зал B", 1);
const HALL_C = hall("cccccccc-0000-0000-0000-000000000003", "Зал C", 2);
const HALL_D = hall("dddddddd-0000-0000-0000-000000000004", "Зал D", 3, BR_A, {
  pricing_type: "fixed", price_amount: "300000.00",
});
const SINGLE = [HALL_A, HALL_B, HALL_C, HALL_D];

// Wire auth/company/branches + a stateful GET /halls and PATCH /halls/reorder.
// `patchMode`: "ok" persists+echoes canonical order; "fail" returns 409.
async function setup(page, initialHalls, { patchMode = "ok" } = {}) {
  const state = { halls: initialHalls.map((h) => ({ ...h })) };
  const reorderCalls = [];
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "5c6b-fixture");
    localStorage.setItem("refresh_token", "5c6b-fixture");
  });
  await page.route(/\/api\/v1\/auth\/me(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE_USER) }));
  await page.route(/\/api\/v1\/companies\/me(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE_COMPANY) }));
  await page.route(/\/api\/v1\/companies\/me\/branches(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BRANCHES) }));
  await page.route(/\/api\/v1\/billing\/balance(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ balance: 0 }) }));
  await page.route(/cbu\.uz\//, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ Rate: "11801.2" }]) }));

  await page.route(/\/api\/v1\/halls\/reorder(\?|$)/, async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    reorderCalls.push(body);
    if (patchMode === "fail") {
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: "Не удалось сохранить порядок мест" }) });
      return;
    }
    // Persist: reassign this branch's order to the requested hall_ids.
    const byId = new Map(state.halls.map((h) => [h.id, h]));
    body.hall_ids.forEach((id, index) => { const h = byId.get(id); if (h) h.sort_order = index; });
    const branchHalls = body.hall_ids.map((id) => byId.get(id)).filter(Boolean);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(branchHalls) });
  });
  // GET /halls (reorder must be matched first — Playwright uses last-registered first).
  await page.route(/\/api\/v1\/halls(\?|$)/, async (route) => {
    const sorted = [...state.halls].sort((a, b) => a.sort_order - b.sort_order);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sorted) });
  });
  return { reorderCalls, state };
}

function names(page) {
  return page.locator(".settings-place__name").allTextContents();
}

// dnd-kit needs a real pointer gesture: press the source row body, move past the
// 6px activation threshold, then over the target's centre, then release.
async function dragRowOnto(page, sourceName, targetName) {
  const src = page.getByRole("button", { name: `Открыть столы: ${sourceName}` });
  const dst = page.getByRole("button", { name: `Открыть столы: ${targetName}` });
  const s = await src.boundingBox();
  const d = await dst.boundingBox();
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2 - 12, { steps: 4 });
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2, { steps: 8 });
  return { drop: async () => { await page.mouse.up(); } };
}

test.describe.configure({ mode: "serial" });

test.describe("Phase 5C-6B — branch-scoped Hall drag-and-drop", () => {
  test.beforeAll(() => { fs.mkdirSync(SHOTS, { recursive: true }); });

  test("single branch: drag D between A and B → one PATCH with complete order", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const { reorderCalls } = await setup(page, SINGLE);
    await page.goto("/settings/places");
    await expect(page.locator(".settings-place__name").first()).toHaveText("Зал A");
    expect(await names(page)).toEqual(["Зал A", "Зал B", "Зал C", "Зал D"]);
    await page.screenshot({ path: path.join(SHOTS, "A-places-normal-1280.png"), fullPage: true });

    const gesture = await dragRowOnto(page, "Зал D", "Зал B");
    await page.screenshot({ path: path.join(SHOTS, "B-places-dragging-1280.png"), fullPage: true });
    await page.screenshot({ path: path.join(SHOTS, "C-places-displaced-1280.png"), fullPage: true });
    await gesture.drop();

    await expect.poll(() => reorderCalls.length).toBe(1);
    expect(reorderCalls[0]).toEqual({
      branch_id: BR_A,
      hall_ids: [HALL_A.id, HALL_D.id, HALL_B.id, HALL_C.id],
    });
    await expect(page.locator(".settings-place__name")).toHaveText(["Зал A", "Зал D", "Зал B", "Зал C"]);
    await page.screenshot({ path: path.join(SHOTS, "D-places-reordered-1280.png"), fullPage: true });
    // Pricing row survived the reorder (D keeps "Дополнительная цена: 300 000 UZS").
    await expect(page.locator(".settings-place", { hasText: "Зал D" }).locator(".settings-place__price")).toContainText("Дополнительная цена");
    await page.screenshot({ path: path.join(SHOTS, "E-places-pricing-reorder-1280.png"), fullPage: true });
    await page.close();
  });

  test("persistence: reordered order survives a reload", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await setup(page, SINGLE);
    await page.goto("/settings/places");
    await expect(page.locator(".settings-place__name").first()).toHaveText("Зал A");
    const gesture = await dragRowOnto(page, "Зал D", "Зал B");
    await gesture.drop();
    await expect(page.locator(".settings-place__name")).toHaveText(["Зал A", "Зал D", "Зал B", "Зал C"]);
    await page.reload();
    await expect(page.locator(".settings-place__name")).toHaveText(["Зал A", "Зал D", "Зал B", "Зал C"]);
    await page.close();
  });

  test("failure: rejected reorder rolls back and shows a normalized error", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await setup(page, SINGLE, { patchMode: "fail" });
    await page.goto("/settings/places");
    await expect(page.locator(".settings-place__name").first()).toHaveText("Зал A");
    const gesture = await dragRowOnto(page, "Зал D", "Зал B");
    await gesture.drop();
    // Rolls back to the original order; error surfaced, no AxiosError leak.
    await expect(page.locator(".settings-place__name")).toHaveText(["Зал A", "Зал B", "Зал C", "Зал D"]);
    await expect(page.getByRole("alert")).toContainText("Не удалось сохранить порядок");
    await page.close();
  });

  test("multi-branch: isolated groups; reorder payload never mixes branches", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const multi = [
      hall("aaaaaaaa-0000-0000-0000-0000000000a1", "A1", 0, BR_A),
      hall("aaaaaaaa-0000-0000-0000-0000000000a2", "A2", 1, BR_A),
      hall("bbbbbbbb-0000-0000-0000-0000000000b1", "B1", 0, BR_B),
      hall("bbbbbbbb-0000-0000-0000-0000000000b2", "B2", 1, BR_B),
    ];
    const { reorderCalls } = await setup(page, multi);
    await page.goto("/settings/places");
    await expect(page.locator(".settings-places-group")).toHaveCount(2);
    // Reorder within branch A only (A2 above A1).
    const gesture = await dragRowOnto(page, "A2", "A1");
    await gesture.drop();
    await expect.poll(() => reorderCalls.length).toBe(1);
    expect(reorderCalls[0].branch_id).toBe(BR_A);
    // Payload contains ONLY branch A ids — never a B id.
    expect(reorderCalls[0].hall_ids.every((id) => id.startsWith("aaaaaaaa"))).toBe(true);
    await page.close();
  });

  test("plain click still opens Tables (no reorder request)", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const { reorderCalls } = await setup(page, SINGLE);
    await page.goto("/settings/places");
    await page.getByRole("button", { name: "Открыть столы: Зал B" }).click();
    await expect(page).toHaveURL(/hall_id=/);
    expect(reorderCalls.length).toBe(0);
    await page.close();
  });
});
