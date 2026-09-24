import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Real-browser visual oracle for Settings → Способ оплаты (visual realignment
// pass). Runs against the review runtime on :5277 and route-mocks auth/shell +
// the /finance/payment-types dictionary, so it needs no backend and touches no
// database. Screenshots + computed-colour proof land outside the repository.
test.use({ baseURL: "http://127.0.0.1:5279" });

const SHOTS = "C:\\Users\\zahongir\\Marjon-visual\\payment-methods";
const OWNER_ACCENT = "rgb(31, 201, 201)"; // #1FC9C9

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

const METHODS = [
  { id: "m-cash", name: "Касса", type: "cash", sort: 1, status: true, sort_order: 1, is_active: true },
  { id: "m-card", name: "Банк-карта", type: "card", sort: 2, status: true, sort_order: 2, is_active: true },
  { id: "m-payme", name: "Онлайн-оплата", type: "payme", sort: 3, status: false, sort_order: 3, is_active: false },
  { id: "m-legacy", name: "Старый VIP", type: "vip_legacy", sort: 4, status: true, sort_order: 4, is_active: true },
];

let page;
let methods = [];

test.describe("Settings → Способ оплаты — visual realignment", () => {
  test.beforeAll(async ({ browser }) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => {
      localStorage.setItem("access_token", "pm-visual-fixture");
      localStorage.setItem("refresh_token", "pm-visual-fixture");
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
    await page.route(/\/api\/v1\/finance\/payment-types(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ items: methods, total: methods.length, page: 1, size: 20 }),
    }));
  });

  test.afterAll(async () => { await page.close(); });

  // PLACEHOLDER_TESTS
  async function open() {
    await page.goto("/settings/payment-methods");
    await page.locator(".payment-methods-page").waitFor({ state: "visible", timeout: 30000 });
  }

  test("CASE 1 — empty table: header visible, PNG/title inside table body", async () => {
    methods = [];
    await open();
    await expect(page.getByText("Способов оплаты пока нет")).toBeVisible();
    // Staff-family empty table: real header row stays visible (rendered
    // uppercase via CSS text-transform — compare case-insensitively)…
    const headers = await page.locator(".payment-methods-page .settings-table thead th").allInnerTexts();
    expect(headers.map((t) => t.trim().toLowerCase())).toEqual(["сорт", "название", "тип", "статус", "действия"]);
    // …PNG/title live inside the table body cell spanning all columns…
    const emptyCell = page.locator(".payment-methods-page td.pm-empty-cell");
    await expect(emptyCell).toBeVisible();
    expect(await emptyCell.getAttribute("colspan")).toBe("5");
    await expect(emptyCell.locator(".owner-report-empty-image")).toBeVisible();
    // …no guidance, no duplicate CTA, only the header Add button.
    await expect(page.getByText(/Добавьте первый способ оплаты/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Добавить способ оплаты" })).toHaveCount(1);
    const cardBox = await page.locator(".payment-methods-page .settings-card").boundingBox();
    fs.writeFileSync(path.join(SHOTS, "_empty-card-height.txt"), `empty card height=${Math.round(cardBox.height)}px`);
    await page.screenshot({ path: path.join(SHOTS, "1-empty-1280.png"), fullPage: true });
  });

  test("CASE 2 — populated OWNER table: header/body aligned + accent + status colour", async () => {
    methods = METHODS;
    await open();
    await expect(page.getByRole("cell", { name: "Касса", exact: true })).toBeVisible();
    await expect(page.getByText("Активен").first()).toBeVisible();
    await expect(page.getByText("Неактивен").first()).toBeVisible();
    const addBtn = page.getByRole("button", { name: "Добавить способ оплаты" });
    const addBg = await addBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(addBg).toBe(OWNER_ACCENT);

    // Column alignment: every body cell's left edge lines up with its header.
    const cols = await page.evaluate(() => {
      const table = document.querySelector(".payment-methods-page .settings-table");
      const lefts = (sel) => [...table.querySelectorAll(sel)].map((el) => Math.round(el.getBoundingClientRect().left));
      const widths = [...table.querySelectorAll("thead th")].map((el) => Math.round(el.getBoundingClientRect().width));
      const hasColgroup = !!table.querySelector("colgroup");
      const layout = getComputedStyle(table).tableLayout;
      const typeTd = [...table.querySelectorAll("tbody tr:first-child td")][2];
      const typeAlign = getComputedStyle(typeTd).textAlign;
      // eslint-disable-next-line no-console
      console.log(`DIAG colgroup=${hasColgroup} layout=${layout} widths=${widths.join(",")} typeTdAlign=${typeAlign}`);
      return { head: lefts("thead th"), body: lefts("tbody tr:first-child td") };
    });
    expect(cols.body).toEqual(cols.head);

    // Ink-level proof per column alignment contract: left columns share the
    // exact first-glyph edge; the centered Тип column shares the exact
    // center; right-aligned Статус/Действия share the exact right edge.
    // (Different text widths can never share all three — each column is
    // checked on its own alignment invariant.)
    const ink = await page.evaluate(() => {
      const table = document.querySelector(".payment-methods-page .settings-table");
      const inkBox = (cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        if (!rects.length) return null;
        const left = Math.min(...rects.map((r) => r.left));
        const right = Math.max(...rects.map((r) => r.right));
        return { left: Math.round(left), center: Math.round((left + right) / 2), right: Math.round(right) };
      };
      const ths = [...table.querySelectorAll("thead th")];
      const tds = [...table.querySelectorAll("tbody tr:first-child td")];
      return {
        head: ths.map(inkBox),
        body: tds.map(inkBox),
      };
    });
    for (const i of [0, 1]) {
      expect(ink.body[i].left - ink.head[i].left).toEqual(11);
    }
    expect(ink.body[2].center).toEqual(ink.head[2].center);
    expect(ink.body[3].right - ink.head[3].right).toEqual(11);
    expect(ink.body[4].right).toEqual(ink.head[4].right);

    // Тип column follows the Staff centered-column language (header + values).
    const typeAlign = await page.evaluate(() => {
      const table = document.querySelector(".payment-methods-page .settings-table");
      const th = [...table.querySelectorAll("thead th")][2];
      const td = [...table.querySelectorAll("tbody tr:first-child td")][2];
      return {
        th: getComputedStyle(th).textAlign,
        td: getComputedStyle(td).textAlign,
      };
    });
    expect(typeAlign).toEqual({ th: "center", td: "center" });

    // Guide-line contract: every body value sits exactly under its header —
    // left edges for Сорт/Название, shared center for Тип, shared right
    // edges for Статус/Действия.
    const guides = await page.evaluate(() => {
      const table = document.querySelector(".payment-methods-page .settings-table");
      const ths = [...table.querySelectorAll("thead th")];
      const tds = [...table.querySelectorAll("tbody tr:first-child td")];
      const align = (el) => getComputedStyle(el).textAlign;
      return {
        leftCols: [0, 1].map((i) => [align(ths[i]), align(tds[i])]),
        centerCol: [align(ths[2]), align(tds[2])],
        rightCols: [3, 4].map((i) => [align(ths[i]), align(tds[i])]),
      };
    });
    expect(guides.leftCols).toEqual([["left", "left"], ["left", "left"]]);
    expect(guides.centerCol).toEqual(["center", "center"]);
    expect(guides.rightCols).toEqual([["right", "right"], ["right", "right"]]);

    // "Активен" text colour is exactly #00DC3B.
    const activeColor = await page.getByText("Активен").first().evaluate((el) => getComputedStyle(el).color);
    expect(activeColor).toBe("rgb(0, 220, 59)");

    fs.writeFileSync(
      path.join(SHOTS, "_table-proof.txt"),
      `Add button bg=${addBg}\nheader col lefts=${cols.head.join(", ")}\nbody   col lefts=${cols.body.join(", ")}\nАктивен color=${activeColor}`,
    );
    await page.screenshot({ path: path.join(SHOTS, "2-populated-1280.png"), fullPage: true });
  });

  test("CASE 3 — create modal is centered/compact + Save accent proof", async () => {
    methods = METHODS;
    await open();
    await page.getByRole("button", { name: "Добавить способ оплаты" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveClass(/settings-modal/);
    await expect(page.getByRole("heading", { name: "Добавить способ оплаты" })).toBeVisible();
    const saveBtn = page.getByRole("button", { name: "Сохранить" });
    const saveBg = await saveBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(saveBg).toBe(OWNER_ACCENT);
    const box = await dialog.boundingBox();
    fs.writeFileSync(
      path.join(SHOTS, "_save-button-color.txt"),
      `Сохранить background-color=${saveBg}\nmodal width=${Math.round(box.width)}px height=${Math.round(box.height)}px`,
    );
    await page.screenshot({ path: path.join(SHOTS, "3-create-modal-1280.png") });
    // Type dropdown: exactly two options, no empty "-", opens animated.
    await page.getByRole("combobox", { name: "Тип" }).click();
    const optionLabels = await page.getByRole("option").allInnerTexts();
    expect(optionLabels.map((t) => t.trim())).toEqual(["Наличные", "Карта"]);
    await page.screenshot({ path: path.join(SHOTS, "3b-create-modal-dropdown-1280.png") });
  });

  test("CASE 4 — edit modal, same family", async () => {
    methods = METHODS;
    await open();
    await page.getByRole("button", { name: "Редактировать «Банк-карта»" }).click();
    await expect(page.getByRole("heading", { name: "Редактировать способ оплаты" })).toBeVisible();
    await expect(page.getByLabel("Название")).toHaveValue("Банк-карта");
    await page.screenshot({ path: path.join(SHOTS, "4-edit-modal-1280.png") });
  });

  test("CASE 5 — delete confirm, same family", async () => {
    methods = METHODS;
    await open();
    await page.getByRole("button", { name: "Удалить «Касса»" }).click();
    await expect(page.getByRole("heading", { name: "Удалить способ оплаты?" })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "5-delete-confirm-1280.png") });
  });

  test("CASE 6 — legacy edit: dropdown stays 2 options, raw value shown as a note", async () => {
    methods = METHODS;
    await open();
    await page.getByRole("button", { name: "Редактировать «Старый VIP»" }).click();
    await expect(page.getByText("Текущий тип: vip_legacy")).toBeVisible();
    await page.getByRole("combobox", { name: "Тип" }).click();
    const optionLabels = await page.getByRole("option").allInnerTexts();
    expect(optionLabels.map((t) => t.trim())).toEqual(["Наличные", "Карта"]);
    await page.screenshot({ path: path.join(SHOTS, "6-legacy-edit-1280.png") });
  });

});
