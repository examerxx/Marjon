import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Real-browser final-viewport oracle for Settings → Настройка чека.
// Runs against a review runtime (default :5273) and route-mocks auth/shell +
// the receipt-template endpoints, so it needs no backend and touches no
// database. Override with RECEIPT_BROWSER_BASE_URL (same convention as
// HQ_BROWSER_BASE_URL in hq-organizations.spec.js) for release runtimes/CI.
// Layout contract: secondary actions right-aligned over the LEFT settings
// area, Save at the END of the scrollable editor (never pinned), receipt
// preview fit-to-pane with NO scrollbars, stationary while the editor scrolls.
const RECEIPT_BASE_URL = process.env.RECEIPT_BROWSER_BASE_URL || "http://127.0.0.1:5273";
test.use({ baseURL: RECEIPT_BASE_URL });

const SHOTS = "C:\\Users\\zahongir\\Marjon-visual\\receipt";

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
let customerTpl = {};

test.describe("Settings → Настройка чека — final viewport layout", () => {
  test.beforeAll(async ({ browser }) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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
    // Stateful customer template: PATCH stores the draft, GET replays it — so a
    // save + reload proves the persisted order is what the preview re-renders.
    await page.route(/\/api\/v1\/settings\/receipt-template(\?|$)/, async (route) => {
      const req = route.request();
      if (req.method() === "PATCH") {
        try { customerTpl = { ...customerTpl, ...JSON.parse(req.postData() || "{}") }; } catch { /* ignore */ }
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(customerTpl) });
    });
    await page.route(/\/api\/v1\/settings\/kitchen-receipt-template(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  });

  test.afterAll(async () => { await page.close(); });

  async function open() {
    await page.goto("/settings/receipt");
    await page.locator(".receipt-settings-page").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("[data-receipt-print-root]").waitFor({ state: "visible", timeout: 30000 });
  }
  const rcptTop = () => page.locator("[data-receipt-print-root]").evaluate((el) => Math.round(el.getBoundingClientRect().top));
  const scrollEditor = (y) => page.locator(".receipt-editor").evaluate((el, v) => { el.scrollTop = v; }, y);
  const editorMetrics = () => page.locator(".receipt-editor").evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
  async function geometry() {
    return page.evaluate(() => {
      const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
      const ed = document.querySelector(".receipt-editor");
      const pc = document.querySelector(".receipt-preview-col");
      const shell = document.querySelector("[data-receipt-preview-shell]");
      const root = document.querySelector("[data-receipt-print-root]");
      const vw = { w: window.innerWidth, h: window.innerHeight };
      const title = document.querySelector(".receipt-settings-page .settings-title-group h1");
      const tb = title ? title.getBoundingClientRect() : null;
      const ab = document.querySelector(".receipt-settings-page .settings-header .receipt-editor-actions");
      const arb = ab ? ab.getBoundingClientRect() : null;
      return {
        vw,
        card: r(".receipt-settings-page .settings-card"),
        title: tb ? { top: Math.round(tb.top), bottom: Math.round(tb.bottom), cy: Math.round(tb.top + tb.height / 2) } : null,
        actionsBox: arb ? { top: Math.round(arb.top), bottom: Math.round(arb.bottom), cy: Math.round(arb.top + arb.height / 2), left: Math.round(arb.left), right: Math.round(arb.right) } : null,
        headerSecondary: document.querySelectorAll(".receipt-settings-page .settings-header .receipt-btn-secondary").length,
        headerPrimary: document.querySelectorAll(".receipt-settings-page .settings-header .receipt-btn-primary").length,
        previewLabel: document.querySelectorAll(".receipt-preview-shell__label").length,
        editor: ed ? { sh: ed.scrollHeight, ch: ed.clientHeight, top: Math.round(ed.scrollTop), max: Math.round(ed.scrollHeight - ed.clientHeight), rect: r(".receipt-editor") } : null,
        editorCol: r(".receipt-editor-col"),
        actions: r(".receipt-header .receipt-editor-actions"),
        save: r(".receipt-editor .receipt-editor-save .receipt-save"),
        col: r(".receipt-preview-col"),
        shell: r("[data-receipt-preview-shell]"),
        receipt: r("[data-receipt-print-root]"),
        fitScale: shell ? shell.getAttribute("data-fit-scale") : null,
        previewOverflowY: pc ? getComputedStyle(pc).overflowY : null,
        previewGutter: pc ? pc.offsetWidth - pc.clientWidth : null,
        previewCanScroll: pc ? pc.scrollHeight > pc.clientHeight + 1 : null,
        savePosition: (() => { const s = document.querySelector(".receipt-editor .receipt-editor-save .receipt-save"); return s ? getComputedStyle(s.closest(".receipt-editor-save") || s).position : null; })(),
        oldFooter: !!document.querySelector(".receipt-editor-footer"),
        saveBg: (() => { const s = document.querySelector(".receipt-editor .receipt-editor-save .receipt-save"); return s ? getComputedStyle(s).backgroundColor : null; })(),
        rootW: root ? Math.round(root.getBoundingClientRect().width) : null,
      };
    });
  }

  test("final layout: title-level actions, taller label-free panel, receipt fit, #1FC9C9", async () => {
    await open();
    await expect(page.getByRole("heading", { name: "Настройка чека" })).toBeVisible();
    await expect(page.locator(".receipt-settings-page .settings-title-group p")).toHaveText("Настройки");
    const g = await geometry();
    expect(g.saveBg).toBe("rgb(31, 201, 201)");
    const bottomGap = g.vw.h - g.card.bottom;
    const topGap = g.card.top;
    fs.writeFileSync(path.join(SHOTS, "_measure.txt"),
      `viewport=${g.vw.w}x${g.vw.h}\nSave bg=${g.saveBg}\n`
      + `card top=${g.card.top} bottom=${g.card.bottom} → top gap=${topGap}px bottom gap=${bottomGap}px\n`
      + `title [${g.title.top},${g.title.bottom}] cy=${g.title.cy} actions [${g.actionsBox.top},${g.actionsBox.bottom}] cy=${g.actionsBox.cy} → delta=${Math.abs(g.title.cy - g.actionsBox.cy)}px\n`
      + `editor col [${g.editorCol.left},${g.editorCol.right}] actions [${g.actions.left},${g.actions.right}]\n`
      + `preview panel [${g.col.top},${g.col.bottom}] h=${g.col.h} (left editor top=${g.editor.rect.top}, delta=${g.editor.rect.top - g.col.top}px) receipt [${g.receipt.top},${g.receipt.bottom}]\n`
      + `preview label nodes=${g.previewLabel} header secondary=${g.headerSecondary} header primary=${g.headerPrimary}\n`
      + `fit scale=${g.fitScale} preview overflow-y=${g.previewOverflowY} gutter=${g.previewGutter}px\n`
      + `left editor scrollHeight/clientHeight=${g.editor.sh}/${g.editor.ch}\n`
      + `old footer present=${g.oldFooter}\n`);
    await page.screenshot({ path: path.join(SHOTS, "A-top-1280.png"), fullPage: false });
    // Compact gaps: top kept small, bottom tighter than before (dense workspace).
    expect(topGap).toBeLessThanOrEqual(120);
    expect(bottomGap).toBeGreaterThanOrEqual(0);
    expect(bottomGap).toBeLessThanOrEqual(45);
    // Actions share the title row: vertical centers aligned, right edge on the
    // left pane's right edge, fully left of the receipt column.
    expect(Math.abs(g.title.cy - g.actionsBox.cy)).toBeLessThanOrEqual(14);
    expect(g.actions.right).toBeLessThanOrEqual(g.editorCol.right + 2);
    expect(g.actions.right).toBeGreaterThan(g.editorCol.left + g.editorCol.w / 2);
    expect(g.actions.right).toBeLessThan(g.col.left);
    expect(g.headerSecondary).toBe(2);
    expect(g.headerPrimary).toBe(0);
    // Preview label is gone; panel is tall (label-free + raised + stretched).
    expect(g.previewLabel).toBe(0);
    expect(g.col.h).toBeGreaterThanOrEqual(640);
    // Right preview panel starts visibly HIGHER than the left settings panel
    // (top extended upward into the header's empty right zone).
    expect(g.col.top).toBeLessThan(g.editor.rect.top);
    const topDelta = g.editor.rect.top - g.col.top;
    expect(topDelta).toBeGreaterThanOrEqual(25);
    expect(topDelta).toBeLessThanOrEqual(70);
    // Save is inside the scroll content, not a pinned footer.
    expect(g.oldFooter).toBe(false);
    expect(g.savePosition).not.toBe("sticky");
    expect(g.savePosition).not.toBe("fixed");
    // Receipt fully visible in the viewport, no scrollbars anywhere near it.
    expect(g.receipt.top).toBeGreaterThanOrEqual(0);
    expect(g.receipt.bottom).toBeLessThanOrEqual(g.vw.h);
    expect(g.previewOverflowY).toBe("hidden");
    expect(g.previewGutter).toBe(0);
    expect(g.previewCanScroll).toBe(false);
    // Fit scale is sane (no unreadable shrink).
    expect(Number(g.fitScale)).toBeGreaterThanOrEqual(0.5);
    expect(Number(g.fitScale)).toBeLessThanOrEqual(1);
  });

  test("Save hidden at editor top, visible at editor bottom (part of scroll content)", async () => {
    await open();
    await scrollEditor(0);
    const hidden = await page.evaluate(() => {
      const ed = document.querySelector(".receipt-editor");
      const s = document.querySelector(".receipt-editor .receipt-editor-save .receipt-save");
      const er = ed.getBoundingClientRect();
      const sr = s.getBoundingClientRect();
      return sr.bottom > er.bottom + 1 || sr.top < er.top - 1;
    });
    expect(hidden).toBe(true);
    const m = await editorMetrics();
    expect(m.max).toBeGreaterThan(0);
    await scrollEditor(m.max);
    const shown = await page.evaluate(() => {
      const ed = document.querySelector(".receipt-editor");
      const s = document.querySelector(".receipt-editor .receipt-editor-save .receipt-save");
      const er = ed.getBoundingClientRect();
      const sr = s.getBoundingClientRect();
      return sr.top >= er.top - 1 && sr.bottom <= er.bottom + 1;
    });
    expect(shown).toBe(true);
    await page.screenshot({ path: path.join(SHOTS, "B-save-at-bottom-1280.png"), fullPage: false });
  });

  test("receipt stays at ONE fixed Y while ONLY the left editor scrolls", async () => {
    await open();
    const y0 = await rcptTop();
    await scrollEditor(300);
    const y1 = await rcptTop();
    await scrollEditor(600);
    const y2 = await rcptTop();
    const m = await editorMetrics();
    await scrollEditor(m.max);
    const y3 = await rcptTop();
    const editorScrolled = (await editorMetrics()).top;
    fs.appendFileSync(path.join(SHOTS, "_measure.txt"),
      `two-pane: left editor scrolled to ${editorScrolled}px (max ${m.max}px)\nreceipt top Y @0=${y0} @300=${y1} @600=${y2} @bottom=${y3}\n`);
    expect(editorScrolled).toBeGreaterThan(200);
    for (const y of [y1, y2, y3]) expect(Math.abs(y - y0)).toBeLessThanOrEqual(1);
  });

  test("receipt TOP stays anchored when its content changes (disable / style)", async () => {
    customerTpl = {};
    await open();
    const y0 = await rcptTop();
    await page.getByRole("checkbox", { name: "Итого" }).click();      // disable a block
    await expect(page.getByText("Итого к оплате:")).toHaveCount(0);
    const yDisable = await rcptTop();
    await page.locator(".receipt-section-row").filter({ hasText: "Название ресторана" }).getByRole("button", { name: "Очень большой" }).click(); // style
    const yStyle = await rcptTop();
    fs.appendFileSync(path.join(SHOTS, "_measure.txt"), `content-change receipt top: base=${y0} disable=${yDisable} style=${yStyle}\n`);
    for (const y of [yDisable, yStyle]) expect(Math.abs(y - y0)).toBeLessThanOrEqual(1);
  });

  test("58mm vs 80mm: both fit entirely, 58 narrower, no scrollbars", async () => {
    await open();
    const check = async () => page.evaluate(() => {
      const root = document.querySelector("[data-receipt-print-root]");
      const pc = document.querySelector(".receipt-preview-col");
      const b = root.getBoundingClientRect();
      return { w: Math.round(b.width), top: Math.round(b.top), bottom: Math.round(b.bottom),
        vwH: window.innerHeight, canScroll: pc.scrollHeight > pc.clientHeight + 1,
        scale: document.querySelector("[data-receipt-preview-shell]").getAttribute("data-fit-scale") };
    });
    const r80 = await check();
    await page.getByLabel("Размер бумаги").selectOption("58mm");
    await page.locator(".receipt-preview--58mm").waitFor({ state: "visible", timeout: 10000 });
    const r58 = await check();
    fs.appendFileSync(path.join(SHOTS, "_measure.txt"), `80mm w=${r80.w} [${r80.top},${r80.bottom}] scale=${r80.scale}\n58mm w=${r58.w} [${r58.top},${r58.bottom}] scale=${r58.scale}\n`);
    await page.screenshot({ path: path.join(SHOTS, "D-58mm-1280.png"), fullPage: false });
    expect(r58.w).toBeLessThan(r80.w);
    for (const r of [r80, r58]) {
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.bottom).toBeLessThanOrEqual(r.vwH);
      expect(r.canScroll).toBe(false);
    }
    await page.getByLabel("Размер бумаги").selectOption("80mm");
    await page.locator(".receipt-preview--80mm").waitFor({ state: "visible", timeout: 10000 });
  });

  test("tall receipt (all blocks on) still fits entirely with no scrollbar", async () => {
    await open();
    // Enable every block toggle to maximize receipt height.
    for (const box of await page.getByRole("checkbox").all()) {
      if (!(await box.isChecked())) await box.check();
    }
    const r = await page.evaluate(() => {
      const root = document.querySelector("[data-receipt-print-root]");
      const pc = document.querySelector(".receipt-preview-col");
      const b = root.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), vwH: window.innerHeight,
        canScroll: pc.scrollHeight > pc.clientHeight + 1,
        scale: Number(document.querySelector("[data-receipt-preview-shell]").getAttribute("data-fit-scale")) };
    });
    fs.appendFileSync(path.join(SHOTS, "_measure.txt"), `tall receipt [${r.top},${r.bottom}] vw=${r.vwH} scale=${r.scale}\n`);
    await page.screenshot({ path: path.join(SHOTS, "E-tall-1280.png"), fullPage: false });
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.bottom).toBeLessThanOrEqual(r.vwH);
    expect(r.canScroll).toBe(false);
    expect(r.scale).toBeGreaterThanOrEqual(0.5);
  });

  test("block edit reflects immediately in the preview", async () => {
    await open();
    await expect(page.getByText("Итого к оплате:")).toBeVisible();
    await page.getByRole("checkbox", { name: "Итого" }).click();
    await expect(page.getByText("Итого к оплате:")).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, "F-block-edit-1280.png"), fullPage: false });
  });

  test("saved block order is reflected in the preview and survives reload (parity with printer)", async () => {
    // Persisted order comes from template.blocks — the same field the ESC/POS
    // formatter uses. Reorder UI was removed; order is still honoured on load.
    customerTpl = { blocks: ["total", "items", "logo", "restaurantName", "orderNumber", "table", "waiter", "dateTime", "discount", "serviceFee", "vat", "paymentMethod", "qr", "thankYouText", "footerText", "address", "phone"] };
    await open();
    const text = () => page.locator("[data-receipt-print-root]").evaluate((el) => el.textContent);
    await expect.poll(async () => {
      const x = await text();
      return x.indexOf("Итого к оплате:") >= 0 && x.indexOf("Итого к оплате:") < x.indexOf("Кол-во");
    }).toBe(true);
    await page.screenshot({ path: path.join(SHOTS, "H-saved-order-1280.png"), fullPage: false });
    // Receipt stays fixed while the left editor scrolls.
    const yBefore = await rcptTop();
    await scrollEditor(500);
    expect(Math.abs((await rcptTop()) - yBefore)).toBeLessThanOrEqual(1);
    // Reload: the persisted order is what the preview re-renders.
    await page.reload();
    await page.locator("[data-receipt-print-root]").waitFor({ state: "visible", timeout: 30000 });
    await expect.poll(async () => {
      const x = await text();
      return x.indexOf("Итого к оплате:") >= 0 && x.indexOf("Итого к оплате:") < x.indexOf("Кол-во");
    }, { timeout: 10000 }).toBe(true);
    fs.appendFileSync(path.join(SHOTS, "_measure.txt"), `saved order ИТОГО before Кол-во (load + reload) = true\n`);
  });

  test("kitchen page: same final layout (actions end, Save in content, fit, no pricing)", async () => {
    await page.goto("/settings/kitchen-receipt");
    await page.locator(".receipt-settings-page").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("[data-receipt-print-root]").waitFor({ state: "visible", timeout: 30000 });
    await expect(page.getByRole("heading", { name: "Настройка чека повара" })).toBeVisible();
    const geo = await page.evaluate(() => {
      const pc = document.querySelector(".receipt-preview-col");
      const ed = document.querySelector(".receipt-editor");
      const title = document.querySelector(".receipt-settings-page .settings-title-group h1");
      const ab = document.querySelector(".receipt-settings-page .settings-header .receipt-editor-actions");
      const tb = title.getBoundingClientRect();
      const arb = ab.getBoundingClientRect();
      const actions = ab.getBoundingClientRect();
      const col = document.querySelector(".receipt-editor-col").getBoundingClientRect();
      const save = document.querySelector(".receipt-editor .receipt-editor-save .receipt-save");
      const root = document.querySelector("[data-receipt-print-root]");
      const rb = root.getBoundingClientRect();
      return {
        gutter: pc.offsetWidth - pc.clientWidth,
        canScroll: pc.scrollHeight > pc.clientHeight + 1,
        titleActionsDelta: Math.abs((tb.top + tb.height / 2) - (arb.top + arb.height / 2)),
        actionsRight: Math.round(actions.right) <= Math.round(col.right) + 2,
        actionsLeftOfReceipt: Math.round(actions.right) < Math.round(document.querySelector(".receipt-preview-col").getBoundingClientRect().left),
        previewLabel: document.querySelectorAll(".receipt-preview-shell__label").length,
        saveBg: getComputedStyle(save).backgroundColor,
        saveInContent: !!save.closest(".receipt-editor"),
        headerSecondary: document.querySelectorAll(".receipt-settings-page .settings-header .receipt-btn-secondary").length,
        headerPrimary: document.querySelectorAll(".receipt-settings-page .settings-header .receipt-btn-primary").length,
        oldFooter: !!document.querySelector(".receipt-editor-footer"),
        type: root.getAttribute("data-receipt-type"),
        fit: { top: Math.round(rb.top), bottom: Math.round(rb.bottom), vwH: window.innerHeight },
        editorScrollable: ed.scrollHeight > ed.clientHeight,
      };
    });
    expect(geo.gutter).toBe(0);
    expect(geo.canScroll).toBe(false);
    expect(geo.titleActionsDelta).toBeLessThanOrEqual(14);
    expect(geo.actionsRight).toBe(true);
    expect(geo.actionsLeftOfReceipt).toBe(true);
    expect(geo.previewLabel).toBe(0);
    expect(geo.saveBg).toBe("rgb(31, 201, 201)");
    expect(geo.saveInContent).toBe(true);
    expect(geo.headerSecondary).toBe(2);
    expect(geo.headerPrimary).toBe(0);
    expect(geo.oldFooter).toBe(false);
    expect(geo.type).toBe("kitchen");
    expect(geo.fit.top).toBeGreaterThanOrEqual(0);
    expect(geo.fit.bottom).toBeLessThanOrEqual(geo.fit.vwH);
    // Kitchen omits customer pricing.
    await expect(page.getByText("Итого к оплате:")).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, "K-kitchen-1280.png"), fullPage: false });
  });

  test("functional regression: Reset, Print preview, Save PATCH persists", async () => {
    await open();
    await page.evaluate(() => { window.print = () => {}; });
    // Reset restores defaults with a truthful draft message.
    await page.getByRole("button", { name: "Сбросить" }).click();
    await expect(page.getByText("Шаблон сброшен к стандартному виду.")).toBeVisible();
    // Print preview action (local window.print stubbed).
    await page.getByRole("button", { name: "Печать предпросмотра" }).click();
    await expect(page.getByText("Открыто окно печати предпросмотра.")).toBeVisible();
    // Save is at the editor bottom: scroll there, edit footer text, save via real PATCH.
    await page.getByRole("textbox", { name: "Нижний текст" }).fill("TEST-FOOTER-123");
    const m = await editorMetrics();
    await scrollEditor(m.max);
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByText("Шаблон чека сохранён на сервере.")).toBeVisible({ timeout: 10000 });
    await page.reload();
    await page.locator("[data-receipt-print-root]").waitFor({ state: "visible", timeout: 30000 });
    await expect(page.getByText("TEST-FOOTER-123").first()).toBeVisible({ timeout: 10000 });
    fs.appendFileSync(path.join(SHOTS, "_measure.txt"), `functional: reset/print/save-patch + reload persistence = true\n`);
    await page.screenshot({ path: path.join(SHOTS, "G-functional-1280.png"), fullPage: false });
  });

  test("constructor controls update preview live and persist (representative blocks)", async () => {
    customerTpl = {};
    await open();
    // TOP: company name style → preview brand changes immediately.
    await page.locator(".receipt-section-row").filter({ hasText: "Название ресторана" }).getByRole("button", { name: "Вправо" }).click();
    await expect(page.locator(".receipt-preview__brand").first()).toHaveCSS("text-align", "right");
    // TOP: order number toggle → info row disappears/appears immediately.
    await page.getByRole("checkbox", { name: "Номер заказа" }).click();
    await expect(page.getByText("Номер заказа:")).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Номер заказа" }).click();
    await expect(page.getByText("Номер заказа:")).toBeVisible();
    // MIDDLE: payment details toggle.
    await page.getByRole("checkbox", { name: "Способ оплаты" }).click();
    await expect(page.getByText("Наличные:")).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Способ оплаты" }).click();
    await expect(page.getByText("Наличные:")).toBeVisible();
    // MIDDLE: date/time, table and service-fee toggles.
    await page.getByRole("checkbox", { name: "Дата и время" }).click();
    await expect(page.getByText("Дата:", { exact: true })).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Дата и время" }).click();
    await expect(page.getByText("Дата:", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "Стол" }).click();
    await expect(page.getByText("Номер стола:")).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Стол" }).click();
    await expect(page.getByText("Номер стола:")).toBeVisible();
    await page.getByRole("checkbox", { name: "Сервисный сбор" }).click();
    await expect(page.getByText("Обслуживание")).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Сервисный сбор" }).click();
    await expect(page.getByText("Обслуживание")).toBeVisible();
    // BOTTOM: thank-you text edit → footer updates immediately.
    await page.getByRole("textbox", { name: "Текст благодарности" }).fill("RAXMAT-TEST");
    await expect(page.getByText("RAXMAT-TEST")).toBeVisible();
    // Save → reload → everything persists via the real PATCH replay.
    const m = await editorMetrics();
    await scrollEditor(m.max);
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByText("Шаблон чека сохранён на сервере.")).toBeVisible({ timeout: 10000 });
    await page.reload();
    await page.locator("[data-receipt-print-root]").waitFor({ state: "visible", timeout: 30000 });
    await expect(page.getByText("RAXMAT-TEST")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".receipt-preview__brand").first()).toHaveCSS("text-align", "right");
    fs.appendFileSync(path.join(SHOTS, "_measure.txt"), `constructor live-update + save/reload persistence = true\n`);
    await page.screenshot({ path: path.join(SHOTS, "G2-constructor-1280.png"), fullPage: false });
  });

  test("per-block text size changes the preview (brand + total calibrated scale)", async () => {
    customerTpl = {};
    await open();
    const fs = (sel) => page.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const brandBase = await fs(".receipt-preview__brand");
    await page.locator(".receipt-section-row").filter({ hasText: "Название ресторана" }).getByRole("button", { name: "Очень большой", exact: true }).click();
    await expect.poll(async () => fs(".receipt-preview__brand")).toBeGreaterThan(brandBase + 2);
    const totalBase = await fs(".receipt-preview__total");
    await page.locator(".receipt-section-row").filter({ hasText: "Итого" }).getByRole("button", { name: "Стандартный", exact: true }).first().click();
    await expect.poll(async () => fs(".receipt-preview__total")).toBeLessThan(totalBase - 2);
    // Default template values still render the approved sizes.
    await page.locator(".receipt-section-row").filter({ hasText: "Название ресторана" }).getByRole("button", { name: "Большой", exact: true }).click();
    await expect.poll(async () => fs(".receipt-preview__brand")).toBeCloseTo(brandBase, 0);
    await page.screenshot({ path: path.join(SHOTS, "G3-size-scale-1280.png"), fullPage: false });
  });

  test("paper stage: gray-blue backdrop, unclipped drop-shadow, no scrollbars", async () => {
    await open();
    const stage = await page.evaluate(() => {
      const shell = document.querySelector("[data-receipt-preview-shell]");
      const paper = document.querySelector("[data-receipt-print-root]");
      const sc = getComputedStyle(shell);
      const pc = getComputedStyle(paper);
      const sr = shell.getBoundingClientRect();
      const pr = paper.getBoundingClientRect();
      const col = document.querySelector(".receipt-preview-col");
      return {
        shellBg: sc.backgroundImage + "|" + sc.backgroundColor,
        paperFilter: pc.filter,
        paperBg: pc.backgroundColor,
        shellH: Math.round(sr.height),
        paperVisualH: Math.round(pr.height),
        paperBottom: Math.round(pr.bottom),
        vwH: window.innerHeight,
        gutter: col.offsetWidth - col.clientWidth,
        canScroll: col.scrollHeight > col.clientHeight + 1,
      };
    });
    fs.appendFileSync(path.join(SHOTS, "_measure.txt"),
      `stage bg=${stage.shellBg}\nfilter=${stage.paperFilter}\n`);
    // Backdrop is a gray-blue stage, not plain white.
    expect(stage.shellBg).not.toContain("rgb(255, 255, 255)");
    expect(stage.shellBg).toMatch(/244|238|237|241|246|gradient/i);
    // Paper is white with a drop-shadow (clip-path-safe), not a flat block.
    expect(stage.paperBg).toBe("rgb(255, 255, 255)");
    expect(stage.paperFilter).toContain("drop-shadow");
    // Shadow + paper fully inside the viewport: nothing clipped, no scroll.
    expect(stage.paperBottom).toBeLessThanOrEqual(stage.vwH);
    expect(stage.gutter).toBe(0);
    expect(stage.canScroll).toBe(false);
    await page.screenshot({ path: path.join(SHOTS, "M-stage-1280.png"), fullPage: false });
  });

  test("logo flow: empty state, real upload, preview, delete", async () => {
    const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let companyLogo = null;
    await page.unroute(/\/api\/v1\/companies\/me(\?|$)/);
    await page.route(/\/api\/v1\/companies\/me(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ...FIXTURE_COMPANY, logo: companyLogo }),
    }));
    await page.route(/\/api\/v1\/companies\/me\/logo(\?|$)/, async (route) => {
      if (route.request().method() === "DELETE") {
        companyLogo = null;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...FIXTURE_COMPANY, logo: null }) });
      } else {
        companyLogo = PNG_1PX;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...FIXTURE_COMPANY, logo: PNG_1PX }) });
      }
    });
    await open();
    // Empty state, no fake image anywhere.
    await expect(page.getByText("Логотип компании не установлен")).toBeVisible();
    expect(await page.locator("img.receipt-preview__logo").count()).toBe(0);
    // Real upload through the file input → preview shows the uploaded logo.
    await page.locator('.receipt-logo-field input[type="file"]').setInputFiles({
      name: "logo.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
    });
    await expect(page.getByText("Логотип загружен.")).toBeVisible({ timeout: 10000 });
    const logoImg = page.locator("img.receipt-preview__logo");
    await expect(logoImg).toBeVisible();
    await expect.poll(async () => logoImg.evaluate((el) => el.naturalWidth), { timeout: 10000 }).toBeGreaterThan(0);
    await page.screenshot({ path: path.join(SHOTS, "N-logo-1280.png"), fullPage: false });
    // Reload keeps the server logo (no fake persistence).
    await page.reload();
    await page.locator("[data-receipt-print-root]").waitFor({ state: "visible", timeout: 30000 });
    await expect(page.locator("img.receipt-preview__logo")).toBeVisible({ timeout: 10000 });
    // Delete removes it truthfully.
    await page.getByRole("button", { name: "Убрать" }).click();
    await expect(page.getByText("Логотип удалён.")).toBeVisible({ timeout: 10000 });
    expect(await page.locator("img.receipt-preview__logo").count()).toBe(0);
  });



  test("wider desktop 1536x864: fit still holds with no scrollbars", async () => {
    customerTpl = {};
    await page.setViewportSize({ width: 1536, height: 864 });
    await open();
    const r = await page.evaluate(() => {
      const root = document.querySelector("[data-receipt-print-root]");
      const pc = document.querySelector(".receipt-preview-col");
      const ed = document.querySelector(".receipt-editor");
      const b = root.getBoundingClientRect();
      const pb = pc.getBoundingClientRect();
      const eb = ed.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), vwH: window.innerHeight,
        canScroll: pc.scrollHeight > pc.clientHeight + 1,
        panelTop: Math.round(pb.top), leftTop: Math.round(eb.top) };
    });
    await page.screenshot({ path: path.join(SHOTS, "L-1536x864.png"), fullPage: false });
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.bottom).toBeLessThanOrEqual(r.vwH);
    expect(r.canScroll).toBe(false);
    // Raised panel holds on wide desktop too.
    expect(r.panelTop).toBeLessThan(r.leftTop);
    expect(r.leftTop - r.panelTop).toBeGreaterThanOrEqual(25);
    expect(r.leftTop - r.panelTop).toBeLessThanOrEqual(70);
    await page.setViewportSize({ width: 1280, height: 900 });
  });
});
