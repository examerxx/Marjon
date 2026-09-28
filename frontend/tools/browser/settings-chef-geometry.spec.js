import { test, expect } from "@playwright/test";

// Chef constructor geometry oracle: 8-row model, per-block control sets,
// 3-zone (SIZE/ALIGN/WEIGHT) and 2-zone (SIZE/WEIGHT-right) desktop layout.
// Runs against :5277 with mocked auth/template. No backend, no database.
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

const THREE_ZONE = ["Номер заказа", "Номер заказа (Отмена)", "Дата"];
const TWO_ZONE = ["Тип заказа", "Номер стола", "Официант", "Заказы (показать сумму)", "Комментарий"];

let page;

test.describe("Chef constructor — 8 rows, zoned controls", () => {
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
    await page.route(/\/api\/v1\/settings\/kitchen-receipt-template(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({}),
    }));
    await page.route(/\/api\/v1\/settings\/receipt-template(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({}),
    }));
  });

  test.afterAll(async () => { await page.close(); });

  async function openChef() {
    await page.goto("/settings/kitchen-receipt");
    await page.locator(".receipt-settings-page").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("[data-receipt-print-root]").waitFor({ state: "visible", timeout: 30000 });
  }

  function rowFor(name) {
    return page.locator(".receipt-section-row").filter({ hasText: name }).first();
  }

  async function styleGeometry(name) {
    return rowFor(name).locator(".receipt-section-row__style").evaluate((styleEl) => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width) }; };
      const groups = [...styleEl.querySelectorAll(":scope > .receipt-segment-group")];
      return {
        row: r(styleEl),
        overflow: styleEl.scrollWidth > styleEl.clientWidth + 1,
        clipped: [...styleEl.querySelectorAll("button")].some((b) => b.scrollWidth > b.clientWidth + 1),
        groups: groups.map((g) => {
          const seg = g.querySelector(":scope > .receipt-segments");
          const labelBox = r(g.querySelector(":scope > span"));
          const segBox = r(seg);
          return {
            label: g.querySelector(":scope > span").textContent.trim(),
            box: r(g),
            labelTop: labelBox.top,
            labelCx: (labelBox.left + labelBox.right) / 2,
            segCx: (segBox.left + segBox.right) / 2,
            segTop: segBox.top,
            segH: segBox.h,
            buttons: [...seg.querySelectorAll("button")].map((b) => ({ text: b.textContent.trim(), ...r(b) })),
          };
        }),
      };
    });
  }

  test("exactly 8 chef rows, no params card, no reset", async () => {
    await openChef();
    await expect(page.getByRole("heading", { name: "Настройка чека повара" })).toBeVisible();
    expect(await page.locator("[data-block-row]").count()).toBe(8);
    await expect(page.getByText("Параметры кухни")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Сбросить" })).toHaveCount(0);
    await expect(page.getByText("Автопечать нового заказа")).toHaveCount(0);
    await expect(page.getByText("Размер бумаги")).toHaveCount(0);
    for (const name of [...THREE_ZONE, ...TWO_ZONE]) {
      await expect(rowFor(name).getByRole("checkbox").first()).toBeVisible();
    }
    for (const gone of ["Позиции", "Модификаторы", "Приоритет"]) {
      await expect(page.getByRole("checkbox", { name: gone })).toHaveCount(0);
    }
  });

  for (const name of THREE_ZONE) {
    test(`3-zone "${name}": size LEFT / align CENTER / weight RIGHT, one row`, async () => {
      await openChef();
      const g = await styleGeometry(name);
      expect(g.groups.map((x) => x.label)).toEqual(["Размер текста", "Выравнивание", "Жирность"]);
      const allBtns = g.groups.flatMap((x) => x.buttons);
      for (const b of allBtns) {
        expect(Math.abs(b.top - allBtns[0].top)).toBeLessThanOrEqual(1);
      }
      for (let i = 1; i < 3; i++) {
        expect(Math.abs(g.groups[i].labelTop - g.groups[0].labelTop)).toBeLessThanOrEqual(1);
        expect(Math.abs(g.groups[i].segTop - g.groups[0].segTop)).toBeLessThanOrEqual(1);
      }
      const [size, align, weight] = g.groups.map((x) => x.box);
      expect(size.left).toBeLessThan(align.left);
      expect(align.left).toBeLessThan(weight.left);
      expect(Math.abs(size.left - g.row.left)).toBeLessThanOrEqual(8);
      expect(Math.abs(g.row.right - weight.right)).toBeLessThanOrEqual(8);
      const rowCx = (g.row.left + g.row.right) / 2;
      const alignCx = (align.left + align.right) / 2;
      expect(Math.abs(alignCx - rowCx)).toBeLessThanOrEqual(100);
      expect(align.right - align.left).toBeGreaterThanOrEqual(125);
      expect(weight.right - weight.left).toBeGreaterThanOrEqual(130);
      expect(g.overflow).toBe(false);
      expect(g.clipped).toBe(false);
      // Equal-width segments inside every control (<=2px tolerance).
      // Every label centered over its own control (<=2px tolerance).
      for (const grp of g.groups) {
        const widths = grp.buttons.map((b) => b.right - b.left);
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
        expect(Math.abs(grp.labelCx - grp.segCx)).toBeLessThanOrEqual(2);
      }
    });
  }

  for (const name of TWO_ZONE) {
    test(`2-zone "${name}": size MAX LEFT / weight MAX RIGHT, one row`, async () => {
      await openChef();
      const g = await styleGeometry(name);
      expect(g.groups.map((x) => x.label)).toEqual(["Размер текста", "Жирность"]);
      const allBtns = g.groups.flatMap((x) => x.buttons);
      for (const b of allBtns) {
        expect(Math.abs(b.top - allBtns[0].top)).toBeLessThanOrEqual(1);
      }
      expect(Math.abs(g.groups[1].labelTop - g.groups[0].labelTop)).toBeLessThanOrEqual(1);
      const [size, weight] = g.groups.map((x) => x.box);
      expect(size.left).toBeLessThan(weight.left);
      expect(Math.abs(size.left - g.row.left)).toBeLessThanOrEqual(8);
      expect(Math.abs(g.row.right - weight.right)).toBeLessThanOrEqual(8);
      expect(g.overflow).toBe(false);
      expect(g.clipped).toBe(false);
      for (const grp of g.groups) {
        const widths = grp.buttons.map((b) => b.right - b.left);
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
        expect(Math.abs(grp.labelCx - grp.segCx)).toBeLessThanOrEqual(2);
      }
    });
  }

  test("every chef size row exposes exactly Стандартный/Большой/Очень большой", async () => {
    await openChef();
    const sizeTexts = async (name) => (await styleGeometry(name)).groups[0].buttons.map((b) => b.text);
    for (const name of ["Номер заказа", "Номер заказа (Отмена)", "Тип заказа", "Номер стола", "Официант", "Заказы (показать сумму)", "Дата", "Комментарий"]) {
      expect(await sizeTexts(name)).toEqual(["Стандартный", "Большой", "Очень большой"]);
    }
    await expect(page.getByRole("button", { name: "Средний", exact: true })).toHaveCount(0);
  });

  test("toggling a row OFF hides its preview line; core dishes always stay", async () => {
    await openChef();
    const paper = page.locator("[data-receipt-print-root]");
    await rowFor("Номер стола").getByRole("checkbox").click();
    await expect(paper.getByText("Стол:")).toHaveCount(0);
    await expect(paper).toContainText("Плов чайханский");
    await rowFor("Номер стола").getByRole("checkbox").click();
    await expect(paper.getByText("Стол:")).toBeVisible();
  });

  test("normal ticket shows no cancellation block and no priority banner", async () => {
    await openChef();
    const paper = page.locator("[data-receipt-print-root]");
    await expect(paper.getByText("ОТМЕНА")).toHaveCount(0);
    await expect(paper.getByText("! СРОЧНО !")).toHaveCount(0);
    await expect(paper).toContainText("#A-1042");
  });
});
