import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Phase 5C-5.2 visual oracle. Screenshots land OUTSIDE the repo.
//
// Two groups:
//  * "mocked" — the Places read is replayed from the canonical 26d4c50 contract
//    (price_amount is a NUMERIC(15,2) string the current frozen runtime does not
//    have yet), so edit-restore and the dropdown can be proven at 1280.
//  * "live" — NOTHING is intercepted. A real place is created against the real
//    backend to verify the repaired branch, then cleaned up via soft-delete.
//
// LIVE opt-in: the live group authenticates with real OWNER credentials and
// MUTATES canonical marjon_authoritative. It is SKIPPED by default and runs
// ONLY when MARJON_LIVE_E2E=1 is explicitly set. Never enable it in normal or
// CI runs — default invocation stays fully mocked and touches no database.
const LIVE_E2E = process.env.MARJON_LIVE_E2E === "1";
const liveDescribe = LIVE_E2E ? test.describe : test.describe.skip;

const OWNER_PHONE = "907778778";
const OWNER_PASSWORD = "102938";
const SHOTS = "C:\\Users\\zahongir\\Marjon-visual\\5c5-2";
const TEST_HALL = "TEST 5C5 PLACE";

const HALL = {
  id: "11111111-1111-1111-1111-111111111111",
  company_id: "c1", branch_id: "b1",
  name: "VIP-кабина", description: null, is_active: true,
  condition: "Депозит от 200 000", percent: 10,
  price_amount: "1000000.00", pricing_type: "fixed", payment_type_id: null,
  tables: [], created_at: "2026-08-01T10:00:00", updated_at: "2026-08-01T10:00:00",
};
const BRANCHES = [{ id: "b1", company_id: "c1", name: "Основной филиал", is_active: true, created_at: "2026-08-01T10:00:00", updated_at: "2026-08-01T10:00:00" }];

async function login(page) {
  await page.goto("/login");
  await page.locator(".login-pro-input-wrap--phone input").fill(OWNER_PHONE);
  await page.locator('input[type="password"]').fill(OWNER_PASSWORD);
  await page.locator(".login-pro-submit").click();
  await page.locator(".dashboard-shell").waitFor({ state: "visible", timeout: 30000 });
}

test.describe.configure({ mode: "serial" });

test.describe("Phase 5C-5.2 — custom dropdown + create status (mocked read)", () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route(/\/api\/v1\/halls(\?|$)/, (r) => (
      r.request().method() === "GET"
        ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([HALL]) })
        : r.fallback()
    ));
    await page.route(/\/api\/v1\/companies\/me\/branches(\?|$)/, (r) => r.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(BRANCHES),
    }));
    await login(page);
  });

  test.afterAll(async () => { await page.close(); });

  async function settle() {
    await page.locator(".settings-modal").evaluate((el) => Promise.all(
      el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})),
    ));
  }
  async function openAdd() {
    await page.goto("/settings/places");
    await page.locator(".settings-places-list").waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "Добавить место" }).click();
    await expect(page.locator(".settings-modal")).toBeVisible();
    await settle();
  }

  test("A — clean modal: no banner, no asterisks, no native select", async () => {
    await openAdd();
    const form = page.locator(".settings-form");
    expect(await form.textContent()).not.toContain("*");
    // the rejected orange zero-branch block is gone for good
    await expect(form.locator(".settings-inactive-note")).toHaveCount(0);
    // the native control is gone from the modal entirely
    await expect(form.locator("select")).toHaveCount(0);
    // the form starts directly with the name field
    await expect(form.locator(".settings-form__body > *").first()).toContainText("Название места");
    // status is a real switch again
    await expect(form.locator(".settings-switch input")).toBeEnabled();
    await expect(form.locator(".settings-switch__label")).toHaveText("Активен");
    await page.screenshot({ path: path.join(SHOTS, "01-add-place-clean-1280.png") });
  });

  test("B — the open panel is DOM-rendered and Marjon-styled", async () => {
    await openAdd();
    const trigger = page.locator("#hall-pricing-select");
    await expect(trigger).toHaveText("Выберите...");
    await trigger.click();
    const panel = page.locator("#hall-pricing-select-listbox");
    // it really is in the page, so it shows up in the screenshot
    await expect(panel).toBeVisible();
    const options = panel.getByRole("option");
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveText("Дополнительная цена");
    await expect(options.nth(1)).toHaveText("Цена за час");
    await expect(panel.getByText("Выберите...")).toHaveCount(0);

    // Marjon surface, not an OS panel: white bg, our border radius, own shadow
    const style = await panel.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow };
    });
    expect(style.bg).toBe("rgb(255, 255, 255)");
    expect(style.radius).toBe("12px");
    expect(style.shadow).not.toBe("none");
    // panel width tracks the trigger
    const t = await trigger.boundingBox();
    const p = await panel.boundingBox();
    expect(Math.abs(p.width - t.width)).toBeLessThanOrEqual(1);
    // hover highlight is turquoise, never Windows blue
    await options.nth(0).hover();
    const hovered = await options.nth(0).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(hovered).toContain("29, 181, 181");
    // and it is not clipped by the modal
    const modal = await page.locator(".settings-modal").boundingBox();
    expect(p.y + p.height).toBeLessThanOrEqual(modal.y + modal.height + 1);
    await page.screenshot({ path: path.join(SHOTS, "02-add-place-dropdown-open-1280.png") });
  });

  test("C — fixed selected", async () => {
    await openAdd();
    await page.locator("#hall-pricing-select").click();
    await page.getByRole("option", { name: "Дополнительная цена" }).click();
    await expect(page.locator("#hall-pricing-select-listbox")).toHaveCount(0);
    await expect(page.locator("#hall-pricing-select")).toHaveText("Дополнительная цена");
    const field = page.locator(".settings-form__conditional");
    await expect(field.locator("span")).toHaveText("Дополнительная цена");
    await field.locator("input").fill("1000000");
    await expect(field.locator("input")).toHaveValue("1 000 000");
    await page.screenshot({ path: path.join(SHOTS, "03-add-place-fixed-1280.png") });
  });

  test("D — hourly selected, then cleared via ×", async () => {
    await openAdd();
    await page.locator("#hall-pricing-select").click();
    await page.getByRole("option", { name: "Цена за час" }).click();
    await expect(page.locator("#hall-pricing-select")).toHaveText("Цена за час");
    const field = page.locator(".settings-form__conditional");
    await expect(field.locator("span")).toHaveText("Цена за час");
    await field.locator("input").fill("2342342");
    await expect(field.locator("input")).toHaveValue("2 342 342");
    await page.screenshot({ path: path.join(SHOTS, "04-add-place-hourly-1280.png") });

    await page.getByRole("button", { name: "Убрать доп. цену" }).click();
    await expect(page.locator(".settings-form__conditional")).toHaveCount(0);
    await expect(page.locator("#hall-pricing-select")).toHaveText("Выберите...");
  });

  test("E/F — create status switch ON and OFF", async () => {
    await openAdd();
    const form = page.locator(".settings-form");
    const toggle = form.locator(".settings-switch input");
    const track = form.locator(".settings-switch__track");
    // The track colour animates over 160ms, so let it come to rest before
    // reading it — otherwise we sample a mid-transition frame.
    async function restingTrackColor() {
      await track.evaluate((el) => Promise.all(
        el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})),
      ));
      await page.waitForTimeout(220);
      return track.evaluate((el) => getComputedStyle(el).backgroundColor);
    }
    const TEAL = "rgb(29, 181, 181)";

    await expect(toggle).toBeChecked();
    expect(await restingTrackColor()).toBe(TEAL); // brand teal = on
    await page.screenshot({ path: path.join(SHOTS, "05-create-status-on-1280.png") });

    await track.click();
    await expect(toggle).not.toBeChecked();
    await expect(form.locator(".settings-switch__label")).toHaveText("Неактивен");
    expect(await restingTrackColor()).not.toBe(TEAL); // greyed = off
    await page.screenshot({ path: path.join(SHOTS, "06-create-status-off-1280.png") });

    await track.click();
    await expect(toggle).toBeChecked();
    await expect(form.locator(".settings-switch__label")).toHaveText("Активен");
    expect(await restingTrackColor()).toBe(TEAL);
  });

  test("G — edit modal restores price_amount and the status switch works", async () => {
    await page.goto("/settings/places");
    await page.locator(".settings-places-list").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Редактировать" }).first().click();
    await expect(page.locator(".settings-modal")).toBeVisible();
    await settle();
    const form = page.locator(".settings-form");
    expect(await form.textContent()).not.toContain("*");
    await expect(form.getByPlaceholder("Введите цену")).toHaveValue("1 000 000");
    await expect(page.locator("#hall-pricing-select")).toHaveText("Дополнительная цена");
    const toggle = form.locator(".settings-switch input");
    await expect(toggle).toBeChecked();
    await form.locator(".settings-switch__track").click();
    await expect(toggle).not.toBeChecked();
    await page.screenshot({ path: path.join(SHOTS, "07-edit-place-1280.png") });
  });

  test("keyboard: ArrowDown/Enter selects, Escape closes only the panel", async () => {
    await openAdd();
    const trigger = page.locator("#hall-pricing-select");
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("#hall-pricing-select-listbox")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(trigger).toHaveAttribute("aria-activedescendant", "hall-pricing-select-opt-1");
    await page.keyboard.press("Enter");
    await expect(page.locator("#hall-pricing-select-listbox")).toHaveCount(0);
    await expect(trigger).toHaveText("Цена за час");

    await page.keyboard.press("ArrowDown");
    await expect(page.locator("#hall-pricing-select-listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#hall-pricing-select-listbox")).toHaveCount(0);
    // the modal survived and the value is intact
    await expect(page.locator(".settings-modal")).toBeVisible();
    await expect(trigger).toHaveText("Цена за час");
  });
});

liveDescribe("Phase 5C-5.2 — LIVE create against the real backend", () => {
  let page;
  const seen = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("response", async (r) => {
      if (!r.url().includes("/api/v1/halls")) return;
      let body = "";
      try { body = (await r.text()).slice(0, 400); } catch {}
      seen.push({ method: r.request().method(), status: r.status(), body });
    });
    await login(page);
  });

  test.afterAll(async () => { await page.close(); });

  test("the repaired branch lets a real place be created, then cleaned up", async () => {
    await page.goto("/settings/places");
    await page.locator(".settings-card").waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "Добавить место" }).click();
    await expect(page.locator(".settings-modal")).toBeVisible();

    const form = page.locator(".settings-form");
    await form.getByPlaceholder("Введите название места").fill(TEST_HALL);
    await form.getByPlaceholder("Введите %").fill("23");
    await page.locator("#hall-pricing-select").click();
    await page.getByRole("option", { name: "Цена за час" }).click();
    await form.getByPlaceholder("Введите цену").fill("2342342");
    await expect(form.getByPlaceholder("Введите цену")).toHaveValue("2 342 342");
    await expect(form.locator(".settings-switch input")).toBeChecked();

    await form.getByRole("button", { name: "Добавить" }).click();

    const post = await page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/halls") && r.request().method() === "POST",
      { timeout: 15000 },
    );
    console.log("LIVE POST status:", post.status());
    console.log("LIVE POST body:", (await post.text()).slice(0, 400));

    if (post.status() >= 400) {
      // Report the truth rather than weakening the frontend contract.
      const detail = await post.text();
      console.log("LIVE CREATE BLOCKED:", detail);
      expect(post.status(), `live create failed: ${detail}`).toBeLessThan(400);
      return;
    }

    // The row must really be there
    await expect(page.locator(".settings-place", { hasText: TEST_HALL })).toBeVisible({ timeout: 15000 });
    const createdBody = JSON.parse(await post.text());
    console.log("LIVE created id:", createdBody.id, "| branch_id:", createdBody.branch_id);
    console.log("LIVE percent:", createdBody.percent, "| pricing_type:", createdBody.pricing_type);
    // The frozen runtime predates Phase 5C-2, so it has no price_amount column
    // and silently drops the field. The frontend still sends it (contract is NOT
    // weakened) — full price_amount E2E stays blocked until the backend deploys.
    console.log("LIVE price_amount echoed back:", Object.prototype.hasOwnProperty.call(createdBody, "price_amount"));

    // cleanup: remove ONLY the temporary test hall through the supported action.
    // Phase 5C-6D: Trash opens a confirm modal; the DELETE fires only on
    // confirming «Удалить» inside it.
    const row = page.locator(".settings-place", { hasText: TEST_HALL });
    await row.getByRole("button", { name: "Удалить место", exact: true }).click();
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    const del = await page.waitForResponse(
      (r) => r.url().includes("/api/v1/halls/") && r.request().method() === "DELETE",
      { timeout: 15000 },
    );
    expect(del.status()).toBe(204);
    // Outcome depends on the runtime: the canonical backend soft-deletes
    // (row stays, badge flips to Неактивен) while this frozen pre-5C-4 image
    // hard-deletes (row disappears). Either way the test hall is gone from the
    // active directory and nothing else was touched.
    await page.waitForTimeout(1200);
    const stillListed = await page.locator(".settings-place", { hasText: TEST_HALL }).count();
    if (stillListed) {
      await expect(
        page.locator(".settings-place", { hasText: TEST_HALL }).locator(".settings-status-badge"),
      ).toHaveText("Неактивен");
      console.log("LIVE cleanup: soft-deleted (row archived)");
    } else {
      console.log("LIVE cleanup: row removed by the frozen runtime's hard delete");
    }
  });
});
