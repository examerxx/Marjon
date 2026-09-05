import { test, expect } from "@playwright/test";

// OWNER white-shell oracle: sidebar + topbar recolored navy → white with navy
// foreground, turquoise active, readable widgets, and NO white-on-white.
// Serial + single shared login.

const OWNER_PHONE = "907778778";
const OWNER_PASSWORD = "102938";
const WHITE = "rgb(255, 255, 255)";
const TURQUOISE = "rgb(29, 181, 181)";
// REPORTS UI COLOR POLISH-01: OWNER *action* surfaces (active nav item, the
// topbar Баланс button, Z-report prints, Отчёты filter/action buttons) moved to
// a brighter accent. Everything else — hover tints, collapsed-flyout glyphs,
// dashboard card tints — deliberately keeps --color-brand / TURQUOISE.
const OWNER_ACCENT = "rgb(31, 201, 201)";

test.describe.configure({ mode: "serial" });

test.describe("OWNER white shell", () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto("/login");
    await page.locator(".login-pro-input-wrap--phone input").fill(OWNER_PHONE);
    await page.locator('input[type="password"]').fill(OWNER_PASSWORD);
    await page.locator(".login-pro-submit").click();
    await page.locator(".dashboard-shell").waitFor({ state: "visible", timeout: 30000 });
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });
  });

  test.afterAll(async () => { await page.close(); });

  const css = (sel, prop) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

  test("desktop @1280: white surfaces, navy foreground, turquoise active", async () => {
    await expect(page.locator(".dashboard-sidebar")).toHaveCSS("background-color", WHITE);
    await expect(page.locator(".dashboard-topbar")).toHaveCSS("background-color", WHITE);

    // inactive nav readable (navy-ish, not white)
    const navColor = await css(".sidebar-link:not(.is-active)", "color");
    expect(navColor).toContain("11, 31, 63");
    expect(navColor).not.toBe(WHITE);

    // active nav keeps turquoise + white
    await expect(page.locator(".sidebar-link.is-active").first()).toHaveCSS("background-color", OWNER_ACCENT);
    await expect(page.locator(".sidebar-link.is-active").first()).toHaveCSS("color", WHITE);

    // brand + widgets readable (not white)
    expect(await css(".brand-title", "color")).toContain("11, 31, 63");
    expect(await css(".topbar-balance-amount", "color")).toContain("11, 31, 63");
    for (const sel of [".mj-datepicker__trigger", ".topbar-info-widget--rate", ".topbar-notification"]) {
      const c = await css(sel, "color");
      expect(c, `${sel} foreground`).not.toBe(WHITE);
    }

    // NO white-on-white across representative shell elements
    const whiteOnWhite = await page.evaluate((white) => {
      const sels = [".dashboard-sidebar", ".dashboard-topbar", ".brand-title", ".brand-subtitle",
        ".sidebar-link:not(.is-active)", ".sidebar-user", ".mj-datepicker__trigger",
        ".topbar-info-widget--rate", ".topbar-notification", ".topbar-balance-amount"];
      const bad = [];
      for (const s of sels) {
        const el = document.querySelector(s);
        if (!el) continue;
        const cs = getComputedStyle(el);
        if (cs.backgroundColor === white && cs.color === white) bad.push(s);
      }
      return bad;
    }, WHITE);
    expect(whiteOnWhite).toEqual([]);
  });

  test("white shell across OWNER routes", async () => {
    for (const route of ["/", "/reports/z-report", "/finance", "/settings"]) {
      await page.goto(route);
      await page.locator(".dashboard-shell").waitFor({ state: "visible" });
      await expect(page.locator(".dashboard-sidebar"), route).toHaveCSS("background-color", WHITE);
      await expect(page.locator(".dashboard-topbar"), route).toHaveCSS("background-color", WHITE);
    }
  });

  test("responsive: topbar white + no overflow; sidebar white on desktop", async () => {
    for (const w of [390, 768, 1280, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto("/");
      await page.locator(".dashboard-shell").waitFor({ state: "visible" });
      await expect(page.locator(".dashboard-topbar"), `topbar @${w}`).toHaveCSS("background-color", WHITE);
      // workspace surface is the flat cool #E9F0FA at every breakpoint (cards stay white)
      await expect(page.locator(".dashboard-content"), `workspace @${w}`).toHaveCSS("background-color", "rgb(233, 240, 250)");
      if (w >= 1025) {
        await expect(page.locator(".dashboard-sidebar"), `sidebar @${w}`).toHaveCSS("background-color", WHITE);
      } else {
        // <=1024 intentionally uses the mobile bottom-nav architecture.
        await expect(page.locator(".dashboard-sidebar .sidebar-nav"), `desktop nav hidden @${w}`).toBeHidden();
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `overflow @${w}`).toBeLessThanOrEqual(1);
    }
  });

  test("submenu + account dropdown readable on white (no white-on-white)", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // Reports submenu auto-opens on a child route → inactive sibling links visible
    await page.goto("/reports/z-report");
    await page.locator(".dashboard-shell").waitFor({ state: "visible" });
    const sub = page.locator(".sidebar-submenu__link:not(.is-active)").first();
    await expect(sub).toBeVisible();
    // color now animates (160ms) on the active/inactive flip → poll until settled
    await expect.poll(async () => sub.evaluate((el) => getComputedStyle(el).color)).toContain("11, 31, 63");
    const subColor = await sub.evaluate((el) => getComputedStyle(el).color);
    expect(subColor).not.toBe(WHITE);

    // open the account dropdown → name must be navy on the white menu
    await page.locator(".sidebar-user--button, .sidebar-user").first().click();
    const nameEl = page.locator(".sidebar-account__menu .sidebar-account__head-meta strong").first();
    await expect(nameEl).toBeVisible();
    expect(await nameEl.evaluate((el) => getComputedStyle(el).color)).toContain("11, 31, 63");

    // logout ("Выйти") must be readable danger red, not cyan-on-white
    const danger = page.locator(".sidebar-account__menu .sidebar-account__item--danger").first();
    if (await danger.count()) {
      const dc = await danger.evaluate((el) => getComputedStyle(el).color);
      expect(dc).toContain("229, 72, 77");
    }
  });

  test("junction wedge gone + submenu not navy + profile role readable", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/reports/z-report");
    await page.locator(".owner-reports-page").waitFor({ state: "visible" });
    await expect(page.locator(".dashboard-sidebar")).toHaveCSS("background-color", WHITE);

    // shell/main/body are white → no navy shows through the rounded corners (no dark wedge)
    await expect(page.locator(".dashboard-shell")).toHaveCSS("background-color", WHITE);
    await expect(page.locator(".dashboard-main")).toHaveCSS("background-color", WHITE);

    // expanded submenu container + open parent are NOT a navy block
    const navy = "rgb(11, 31, 63)";
    const submenuBg = await page.locator(".sidebar-submenu").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(submenuBg).not.toBe(navy);
    const parentBg = await page.locator(".sidebar-nav-item.has-submenu.is-open").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(parentBg).not.toBe(navy);

    // profile role sub-text readable slate (not near-white)
    const roleColor = await page.locator(".sidebar-user__meta span").first().evaluate((el) => getComputedStyle(el).color);
    expect(roleColor).toContain("83, 109, 142");
  });

  test("polish: flat workspace bg + no resting shadow on balance/logo", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });
    // workspace surface is flat cool #E9F0FA (cards/sidebar/topbar stay white)
    await expect(page.locator(".dashboard-content")).toHaveCSS("background-color", "rgb(233, 240, 250)");
    await expect(page.locator(".dashboard-content")).toHaveCSS("background-image", "none");
    await expect(page.locator(".dashboard-sidebar")).toHaveCSS("background-color", WHITE);
    await expect(page.locator(".dashboard-topbar")).toHaveCSS("background-color", WHITE);
    // topbar has no bottom border; main is solid white; top-left curve 24px
    await expect(page.locator(".dashboard-topbar")).toHaveCSS("border-bottom-width", "0px");
    await expect(page.locator(".dashboard-main")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.locator(".dashboard-content")).toHaveCSS("border-top-left-radius", "24px");
    // resting shadows removed on balance amount, Баланс button, and brand mark
    await expect(page.locator(".topbar-balance-amount").first()).toHaveCSS("box-shadow", "none");
    await expect(page.locator(".topbar-pay-button").first()).toHaveCSS("box-shadow", "none");
    await expect(page.locator(".brand-mark").first()).toHaveCSS("box-shadow", "none");
  });

  test("overlapping rounded balance controls + borderless sidebar + right-nudged cluster", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });

    // TWO individually-rounded controls that visually join (per reference): the
    // parent no longer clips — transparent, no border, overflow VISIBLE.
    await expect(page.locator(".topbar-balance-pill")).toHaveCSS("overflow-x", "visible");
    await expect(page.locator(".topbar-balance-pill")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(page.locator(".topbar-balance-pill")).toHaveCSS("border-top-width", "0px");
    // "0 UZS": rounded on the LEFT only (right corners squared — the overlapping
    // Баланс button covers that side); own border (right removed), navy text.
    await expect(page.locator(".topbar-balance-amount")).toHaveCSS("border-top-left-radius", "12px");
    await expect(page.locator(".topbar-balance-amount")).toHaveCSS("border-bottom-left-radius", "12px");
    await expect(page.locator(".topbar-balance-amount")).toHaveCSS("border-top-right-radius", "0px");
    await expect(page.locator(".topbar-balance-amount")).toHaveCSS("border-bottom-right-radius", "0px");
    await expect(page.locator(".topbar-balance-amount")).toHaveCSS("border-top-width", "1px");
    await expect(page.locator(".topbar-balance-amount")).toHaveCSS("border-left-width", "1px");
    await expect(page.locator(".topbar-balance-amount")).toHaveCSS("border-bottom-width", "1px");
    await expect(page.locator(".topbar-balance-amount")).toHaveCSS("border-right-width", "0px");
    await expect(page.locator(".topbar-balance-amount")).toHaveCSS("background-color", "rgba(246, 248, 252, 0.96)");
    // Right breathing room restored: with the Баланс button overlapping the
    // right edge by 12px, padding-right is 26px so the VISIBLE right gap
    // (26 − 12) ≈ the left gap → balanced [ 0 UZS ][ Баланс ]. Left untouched.
    await expect(page.locator(".topbar-balance-amount")).toHaveCSS("padding-right", "26px");
    const amtColor = await page.locator(".topbar-balance-amount").evaluate((el) => getComputedStyle(el).color);
    expect(amtColor).toContain("11, 31, 63");
    // "Баланс": FULL radius on ALL FOUR corners — left edge must curve, not be flat
    await expect(page.locator(".topbar-pay-button")).toHaveCSS("border-top-left-radius", "12px");
    await expect(page.locator(".topbar-pay-button")).toHaveCSS("border-bottom-left-radius", "12px");
    await expect(page.locator(".topbar-pay-button")).toHaveCSS("border-top-right-radius", "12px");
    await expect(page.locator(".topbar-pay-button")).toHaveCSS("border-bottom-right-radius", "12px");
    await expect(page.locator(".topbar-pay-button")).toHaveCSS("background-color", OWNER_ACCENT);
    // small controlled overlap; turquoise button stacked ABOVE the amount
    const stack = await page.evaluate(() => {
      const a = document.querySelector(".topbar-balance-amount");
      const p = document.querySelector(".topbar-pay-button");
      const ar = a.getBoundingClientRect(), pr = p.getBoundingClientRect();
      return { overlap: Math.round(ar.right - pr.left), az: +getComputedStyle(a).zIndex, pz: +getComputedStyle(p).zIndex };
    });
    expect(stack.overlap).toBeGreaterThanOrEqual(10); // Баланс pulled further over the amount
    expect(stack.overlap).toBeLessThanOrEqual(14);
    expect(stack.pz).toBeGreaterThan(stack.az);    // Баланс sits over the junction
    // no resting shadow on either control
    await expect(page.locator(".topbar-balance-amount")).toHaveCSS("box-shadow", "none");
    await expect(page.locator(".topbar-pay-button")).toHaveCSS("box-shadow", "none");

    // sidebar has no right border (clean meet with workspace) and no ::after divider
    await expect(page.locator(".dashboard-sidebar")).toHaveCSS("border-right-width", "0px");
    const afterContent = await page.locator(".dashboard-sidebar").evaluate((el) => getComputedStyle(el, "::after").content);
    expect(["none", "normal", ""]).toContain(afterContent);

    // left topbar cluster nudged right off the edge; back + date move together, no overflow
    await expect(page.locator(".topbar-left")).toHaveCSS("padding-left", "10px");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("balance semantics: 0 UZS is a display field, Баланс is the only button", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });

    // DOM semantics: amount is a non-button display element; Баланс is a real button
    const dom = await page.evaluate(() => {
      const a = document.querySelector(".topbar-balance-amount");
      const p = document.querySelector(".topbar-pay-button");
      return { amountTag: a.tagName, amountRole: a.getAttribute("role"), payTag: p.tagName };
    });
    expect(dom.amountTag).not.toBe("BUTTON");
    expect(dom.amountRole).not.toBe("button");
    expect(dom.payTag).toBe("BUTTON");

    // amount is non-interactive: default cursor, and identical at rest vs hover
    const amt = page.locator(".topbar-balance-amount");
    await expect(amt).toHaveCSS("cursor", "default");
    const rest = await amt.evaluate((el) => { const c = getComputedStyle(el); return { s: c.boxShadow, bg: c.backgroundColor, t: c.transform }; });
    await amt.hover();
    await page.waitForTimeout(200);
    const hov = await amt.evaluate((el) => { const c = getComputedStyle(el); return { s: c.boxShadow, bg: c.backgroundColor, t: c.transform }; });
    expect(hov.s).toBe(rest.s);   // no hover shadow
    expect(hov.bg).toBe(rest.bg); // no hover background change
    expect(hov.t).toBe(rest.t);   // no transform
    expect(rest.s).toBe("none");  // no resting shadow either

    // Баланс is the interactive control: pointer cursor + a hover shadow appears
    const pay = page.locator(".topbar-pay-button");
    await expect(pay).toHaveCSS("cursor", "pointer");
    const payRest = await pay.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(payRest).toBe("none");
    await pay.hover();
    await page.waitForTimeout(200);
    const payHov = await pay.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(payHov).not.toBe("none");
  });

  test("Back button: compact light nav control (navy arrow, no lift, turquoise focus)", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/finance"); // a child route so Back is meaningful
    await page.locator(".dashboard-shell").waitFor({ state: "visible" });
    const back = page.locator(".topbar-back-slot .dashboard-back-button--topbar-3d");
    await expect(back).toBeVisible();
    // light surface, subtle border, radius ~12, no resting shadow (not a primary button)
    await expect(back).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(back).toHaveCSS("border-radius", "12px");
    await expect(back).toHaveCSS("box-shadow", "none");
    // arrow readable navy (not black, not white), calmer optical size
    const arrow = back.locator("svg").first();
    const arrowColor = await arrow.evaluate((el) => getComputedStyle(el).color);
    expect(arrowColor).toContain("11, 31, 63");
    await expect(arrow).toHaveCSS("width", "18px");
    // near-square control, roughly the topbar control height
    const box = await back.evaluate((el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
    expect(box.h).toBeGreaterThanOrEqual(34);
    expect(box.h).toBeLessThanOrEqual(48);
    expect(Math.abs(box.w - box.h)).toBeLessThanOrEqual(2);
  });

  test("card icons: unified geometry; KPI per-card premium tints, summary turquoise/coral", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });

    const geom = async (sel) => page.locator(sel).first().evaluate((el) => {
      const cs = getComputedStyle(el);
      const svg = el.querySelector("svg");
      const scs = svg ? getComputedStyle(svg) : {};
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), radius: cs.borderTopLeftRadius, svgW: scs.width, stroke: scs.strokeWidth };
    });
    const kpi = await geom(".premium-kpi__icon");
    const sum = await geom(".warehouse-summary-item__icon");
    // unified box + optical size + stroke; KPI rounded-square 18px, summary 12px
    for (const g of [kpi, sum]) {
      expect(g.w).toBe(42);
      expect(g.h).toBe(42);
      expect(g.svgW).toBe("19px");
      expect(g.stroke).toBe("2px");
    }
    // KPI icon is a crisp rounded SQUARE (equal w/h, 14px radius); summary 12px
    expect(kpi.radius).toBe("14px");
    expect(sum.radius).toBe("12px");

    // KPI: 5 distinct premium tints
    await expect(page.locator(".premium-kpi--revenue .premium-kpi__icon")).toHaveCSS("background-color", "rgba(16, 185, 129, 0.12)");
    await expect(page.locator(".premium-kpi--orders .premium-kpi__icon")).toHaveCSS("background-color", "rgba(59, 130, 246, 0.12)");
    await expect(page.locator(".premium-kpi--avg .premium-kpi__icon")).toHaveCSS("background-color", "rgba(139, 92, 246, 0.12)");
    await expect(page.locator(".premium-kpi--tables .premium-kpi__icon")).toHaveCSS("background-color", "rgba(245, 158, 11, 0.14)");
    await expect(page.locator(".premium-kpi--expense .premium-kpi__icon")).toHaveCSS("background-color", "rgba(244, 63, 94, 0.12)");

    // right-summary cards keep their turquoise/coral system (unchanged)
    const turq = "rgba(29, 181, 181, 0.12)";
    const coral = "rgba(224, 106, 90, 0.12)";
    await expect(page.locator(".warehouse-summary-item--income .warehouse-summary-item__icon")).toHaveCSS("background-color", turq);
    await expect(page.locator(".warehouse-summary-item--expense .warehouse-summary-item__icon")).toHaveCSS("background-color", coral);
    await expect(page.locator(".warehouse-summary-item--creditor .warehouse-summary-item__icon")).toHaveCSS("background-color", coral);
    await expect(page.locator(".warehouse-summary-item--debtor .warehouse-summary-item__icon")).toHaveCSS("background-color", turq);
  });

  test("reports subcategory panel: wider inside 280px sidebar, hierarchy, no clip", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/reports/z-report");
    await page.locator(".sidebar-submenu").first().waitFor({ state: "visible" });

    // sidebar width UNCHANGED at exactly 280px
    const sbW = await page.locator(".dashboard-sidebar").evaluate((el) => Math.round(el.getBoundingClientRect().width));
    expect(sbW).toBe(280);

    // panel is a structured group: 1px turquoise hairline, disciplined radius,
    // external non-inset depth with no overlay pseudo-element
    const sub = page.locator(".sidebar-submenu").first();
    await expect(sub).toHaveCSS("border-top-width", "1px");
    const panelDepth = await sub.evaluate((el) => ({
      shadow: getComputedStyle(el).boxShadow,
      after: getComputedStyle(el, "::after").content,
    }));
    expect(panelDepth.shadow).not.toBe("none");
    expect(panelDepth.shadow).not.toContain("inset");
    expect(panelDepth.after).toBe("none");
    await expect(sub).toHaveCSS("border-top-left-radius", "12px");

    // panel is a wide block fully inside the 280px sidebar, with a clean outer margin
    const geo = await page.evaluate(() => {
      const sb = document.querySelector(".dashboard-sidebar").getBoundingClientRect();
      const s = document.querySelector(".sidebar-submenu").getBoundingClientRect();
      return { w: Math.round(s.width), outL: Math.round(s.left - sb.left), outR: Math.round(sb.right - s.right),
        inside: s.left >= sb.left - 0.5 && s.right <= sb.right + 0.5 };
    });
    expect(geo.w).toBeGreaterThanOrEqual(248);
    expect(geo.inside).toBe(true);
    expect(geo.outL).toBeLessThanOrEqual(16);
    expect(geo.outL).toBeGreaterThanOrEqual(4);

    // active child is SECONDARY to the turquoise parent: light tint, navy text, weight 600.
    // COLOR POLISH-01 owns the HUE (accent 31,201,201). The tint ALPHA is owned by
    // the separate in-flight sidebar WIP — committed HEAD says .12, the working
    // copy says .28 — so it is asserted as "an accent tint", not a fixed alpha.
    const active = page.locator(".sidebar-submenu__link.is-active").first();
    const activeBg = await active.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(activeBg).toMatch(/^rgba\(31, 201, 201, 0?\.\d+\)$/);
    await expect(active).toHaveCSS("font-weight", "600");
    const aColor = await active.evaluate((el) => getComputedStyle(el).color);
    expect(aColor).toContain("11, 31, 63");
    // inactive child transparent + muted navy
    const inactive = page.locator(".sidebar-submenu__link:not(.is-active)").first();
    await expect(inactive).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

    // long labels no longer clip (wrap instead of ellipsis)
    const clipped = await page.evaluate(() => Array.from(document.querySelectorAll(".sidebar-submenu__link"))
      .filter((l) => l.scrollWidth > l.clientWidth + 1).length);
    expect(clipped).toBe(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("sidebar motion + icon cleanup + soft submenu shadow", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/reports/z-report");
    await page.locator(".sidebar-submenu").first().waitFor({ state: "visible" });

    // A. consistent motion: main nav and submenu links share the SAME transition
    const mainTrans = await page.locator(".sidebar-link").first().evaluate((el) => getComputedStyle(el).transitionDuration);
    const subTrans = await page.locator(".sidebar-submenu__link").first().evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(subTrans).toBe(mainTrans);
    expect(subTrans).not.toBe("0s");        // submenu links animate (were instant before)

    // main active: strong turquoise, no transform/layout movement
    const act = page.locator(".sidebar-link.is-active").first();
    await expect(act).toHaveCSS("background-color", OWNER_ACCENT);
    await expect(act).toHaveCSS("transform", "none");

    // C. submenu inactive icon: no box (transparent bg, no shadow), muted slate glyph
    const inLink = page.locator(".sidebar-submenu__link:not(.is-active)").first();
    const icon = inLink.locator(".sidebar-submenu__icon");
    await expect(icon).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(icon).toHaveCSS("box-shadow", "none");

    // D. submenu hover: light turquoise row, icon turns turquoise, STILL no dark icon box,
    // plus a gentle rightward nudge (translateX ~3px)
    await inLink.hover();
    await page.waitForTimeout(240);
    const hov = await inLink.evaluate((el) => {
      const c = getComputedStyle(el);
      const ic = el.querySelector(".sidebar-submenu__icon");
      const icc = getComputedStyle(ic);
      const svg = ic.querySelector("svg");
      return { rowBg: c.backgroundColor, iconBg: icc.backgroundColor, iconBox: icc.boxShadow,
        iconColor: svg ? getComputedStyle(svg).color : icc.color, transform: c.transform };
    });
    expect(hov.rowBg).toBe("rgba(29, 181, 181, 0.08)");
    expect(hov.iconBg).toBe("rgba(0, 0, 0, 0)"); // no dark square on hover
    expect(hov.iconBox).toBe("none");
    expect(hov.iconColor).toBe("rgb(29, 181, 181)"); // turquoise, not white/invisible
    expect(hov.transform).toBe("matrix(1, 0, 0, 1, 3, 0)"); // translateX(3px) nudge

    // main inactive link also nudges on hover; transition includes transform
    const mainIn = page.locator(".sidebar-link:not(.is-active)").first();
    expect(await mainIn.evaluate((el) => getComputedStyle(el).transitionProperty)).toContain("transform");
    await mainIn.hover();
    await page.waitForTimeout(240);
    expect(await mainIn.evaluate((el) => getComputedStyle(el).transform)).toBe("matrix(1, 0, 0, 1, 3, 0)");

    // chevron on the open parent is rotated 90°
    const chev = await page.locator(".sidebar-nav-item.has-submenu.is-open .sidebar-link__chevron").first().evaluate((el) => getComputedStyle(el).transform);
    expect(chev).toBe("matrix(0, 1, -1, 0, 0, 0)");

    // F. panel: turquoise hairline + one external, non-inset shadow. No pseudo
    // overlay may enter the white surface or darken the last child row.
    const panel = page.locator(".sidebar-submenu").first();
    await expect(panel).toHaveCSS("border-top-width", "1px");
    await expect(panel).toHaveCSS("border-top-color", "rgb(79, 225, 229)");
    await expect(panel).toHaveCSS("border-top-left-radius", "12px");
    const depth = await panel.evaluate((el) => {
      const c = getComputedStyle(el);
      const a = getComputedStyle(el, "::after");
      const rect = el.getBoundingClientRect();
      const last = el.querySelector(".sidebar-submenu__link:last-child").getBoundingClientRect();
      return { shadow: c.boxShadow, inset: c.boxShadow.includes("inset"), after: a.content,
        lastGap: rect.bottom - last.bottom };
    });
    expect(depth.shadow).not.toBe("none");
    expect(depth.inset).toBe(false);
    expect(depth.after).toBe("none");
    expect(depth.lastGap).toBeGreaterThanOrEqual(4);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("submenu panel border + shadow are 100% stable across child states", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/reports/z-report");
    await page.locator(".sidebar-submenu").first().waitFor({ state: "visible" });
    await page.waitForTimeout(300);
    const panel = () => page.locator(".sidebar-submenu").first().evaluate((el) => {
      const c = getComputedStyle(el);
      const a = getComputedStyle(el, "::after");
      return { border: c.borderTopColor, w: c.borderTopWidth, radius: c.borderTopLeftRadius,
        shadow: c.boxShadow, inset: c.boxShadow.includes("inset"), after: a.content };
    });
    const initial = await panel();
    // The same external shadow must survive hover and active-route changes.
    expect(initial.border).toBe("rgb(79, 225, 229)");
    expect(initial.w).toBe("1px");
    expect(initial.radius).toBe("12px");
    expect(initial.shadow).not.toBe("none");
    expect(initial.inset).toBe(false);
    expect(initial.after).toBe("none");

    // hover a child → panel + shadow layer unchanged
    await page.locator(".sidebar-submenu__link", { hasText: "заказам" }).first().hover();
    await page.waitForTimeout(240);
    expect(await panel()).toEqual(initial);

    // click that child (route active) → unchanged
    await page.locator(".sidebar-submenu__link", { hasText: "заказам" }).first().click();
    await page.locator(".sidebar-submenu").first().waitFor({ state: "visible" });
    await page.waitForTimeout(300);
    expect(await panel()).toEqual(initial);

    // hover a different child → still unchanged
    await page.locator(".sidebar-submenu__link", { hasText: "столам" }).first().hover();
    await page.waitForTimeout(240);
    expect(await panel()).toEqual(initial);

    // box-shadow must NOT be in the panel's transition (never animates)
    const trans = await page.locator(".sidebar-submenu").first().evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(trans).not.toContain("box-shadow");
  });

  test("submenu open/close is single-phase and monotonic", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });
    const reports = page.locator(".sidebar-nav-item.has-submenu").first();
    const trigger = reports.locator(":scope > .sidebar-link--button");
    const read = () => reports.evaluate((host) => {
      const submenu = host.querySelector(".sidebar-submenu");
      const c = getComputedStyle(submenu);
      return {
        panelH: submenu.getBoundingClientRect().height,
        opacity: parseFloat(c.opacity),
        transitions: c.transitionProperty,
        chevron: getComputedStyle(host.querySelector(".sidebar-link__chevron")).transform,
      };
    });

    const closed = await read();
    expect(closed.opacity).toBe(0);
    expect(closed.panelH).toBe(0);
    expect(closed.transitions).toContain("height");
    expect(closed.transitions).not.toContain("transform");

    await trigger.click();
    const opening = [];
    for (let index = 0; index < 6; index += 1) {
      await page.waitForTimeout(28);
      opening.push((await read()).panelH);
    }
    await page.waitForTimeout(180);
    const open = await read();
    expect(open.opacity).toBeGreaterThan(0.95);
    expect(open.chevron).toBe("matrix(0, 1, -1, 0, 0, 0)");
    expect(opening.some((height) => height > 0 && height < open.panelH - 1)).toBe(true);
    expect(opening.every((height, index) => index === 0 || height >= opening[index - 1] - 1)).toBe(true);

    await trigger.click();
    const closing = [];
    for (let index = 0; index < 6; index += 1) {
      await page.waitForTimeout(28);
      closing.push((await read()).panelH);
    }
    await page.waitForTimeout(180);
    const shut = await read();
    expect(shut.panelH).toBe(0);
    expect(shut.opacity).toBe(0);
    expect(closing.some((height) => height > 1 && height < open.panelH - 1)).toBe(true);
    expect(closing.every((height, index) => index === 0 || height <= closing[index - 1] + 1)).toBe(true);
  });

  test("open submenu collapses with one host motion and reopens cleanly", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/reports/z-report");
    const host = page.locator(".sidebar-nav-item.has-submenu.is-active").first();
    const panel = host.locator(".sidebar-submenu");
    await panel.waitFor({ state: "visible" });
    await page.waitForTimeout(280);
    const expandedHeight = await host.evaluate((el) => el.getBoundingClientRect().height);
    const expandedPanelHeight = await panel.evaluate((el) => el.getBoundingClientRect().height);

    // Harness: the retract window is only SUBMENU_RETRACT_MS (260ms) wide before
    // SidebarNav unmounts the inline panel by design, so the intended 6x28ms=168ms
    // sweep has to stay inside the browser. One Playwright round-trip per frame added
    // 15-45ms each and pushed the nominal sweep to 277-350ms, i.e. past the unmount,
    // so the last samples read a detached panel. Click + sampling therefore run in a
    // single evaluate at the intended cadence. Product timing is untouched.
    const collapseFrames = await host.evaluate(async (el, [frames, gap]) => {
      const toggle = document.querySelector(".brand-mark--button");
      if (toggle.getAttribute("aria-label") !== "Свернуть меню") {
        throw new Error(`collapse toggle not in expanded state: ${toggle.getAttribute("aria-label")}`);
      }
      const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
      const samples = [];
      toggle.click();
      for (let index = 0; index < frames; index += 1) {
        await wait(gap);
        const submenu = el.querySelector(".sidebar-submenu");
        samples.push({
          hostH: el.getBoundingClientRect().height,
          panelH: submenu ? submenu.getBoundingClientRect().height : null,
          panelMounted: Boolean(submenu),
        });
      }
      return samples;
    }, [6, 28]);
    await page.waitForTimeout(180);
    const collapsed = await host.evaluate((el) => {
      const c = getComputedStyle(el);
      const search = document.querySelector(".sidebar-search");
      return {
        hostH: el.getBoundingClientRect().height,
        borderW: c.borderTopWidth,
        shadow: c.boxShadow,
        searchH: search.getBoundingClientRect().height,
        searchVisibility: getComputedStyle(search).visibility,
        panelMounted: Boolean(el.querySelector(".sidebar-submenu")),
      };
    });
    // The sampling window must end before the retract deadline, so every frame has to
    // see a live panel; a null here means the harness outran SUBMENU_RETRACT_MS again.
    expect(collapseFrames.every(({ panelMounted }) => panelMounted),
      JSON.stringify({ expandedHeight, expandedPanelHeight, collapseFrames })).toBe(true);
    expect(collapseFrames.some(({ hostH }) => hostH > 57 && hostH < expandedHeight - 1),
      JSON.stringify({ expandedHeight, expandedPanelHeight, collapseFrames })).toBe(true);
    expect(collapseFrames.every(({ hostH }, index) => index === 0 || hostH <= collapseFrames[index - 1].hostH + 1)).toBe(true);
    expect(collapseFrames.some(({ panelH }) => panelH > 1 && panelH < expandedPanelHeight - 1)).toBe(true);
    expect(collapseFrames.every(({ panelH }, index) => index === 0 || panelH <= collapseFrames[index - 1].panelH + 1)).toBe(true);
    expect(Math.abs(collapsed.hostH - 56)).toBeLessThanOrEqual(1);
    expect(collapsed.borderW).toBe("0px");
    expect(collapsed.shadow).toBe("none");
    expect(collapsed.searchH).toBe(0);
    expect(collapsed.searchVisibility).toBe("hidden");
    // …and once the retract lifecycle is over the inline panel is gone from the rail.
    expect(collapsed.panelMounted).toBe(false);

    // Same reasoning as the collapse sweep: reopen is a 220ms height transition, so the
    // 6x28ms cadence stays inside one evaluate instead of paying per-frame IPC.
    const reopenFrames = await host.evaluate(async (el, [frames, gap]) => {
      const toggle = document.querySelector(".brand-mark--button");
      if (toggle.getAttribute("aria-label") !== "Открыть меню") {
        throw new Error(`reopen toggle not in collapsed state: ${toggle.getAttribute("aria-label")}`);
      }
      const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
      const samples = [];
      toggle.click();
      for (let index = 0; index < frames; index += 1) {
        await wait(gap);
        const submenu = el.querySelector(".sidebar-submenu");
        samples.push(submenu ? submenu.getBoundingClientRect().height : null);
      }
      return samples;
    }, [6, 28]);
    await page.waitForTimeout(180);
    const reopenedHeight = await panel.evaluate((el) => el.getBoundingClientRect().height);
    // The panel remounts with the expanded rail, so no reopen frame may be null either.
    expect(reopenFrames.every((height) => typeof height === "number"),
      JSON.stringify({ reopenedHeight, reopenFrames })).toBe(true);
    // The rail re-expands by remounting the panel, so it appears at its final height
    // rather than growing into it (CSS transitions do not run on initial style). Assert
    // the settled contract: it comes back at exactly its pre-collapse height, and the
    // monotonic check below still forbids any rebound or flicker on the way there.
    expect(reopenedHeight).toBeCloseTo(expandedPanelHeight, 0);
    expect(reopenFrames.at(-1)).toBeCloseTo(expandedPanelHeight, 0);
    expect(reopenFrames.every((height, index) => index === 0 || height >= reopenFrames[index - 1] - 1),
      JSON.stringify({ reopenedHeight, reopenFrames })).toBe(true);

    for (let cycle = 0; cycle < 2; cycle += 1) {
      await page.getByRole("button", { name: "Свернуть меню" }).click();
      await page.waitForTimeout(260);
      await page.getByRole("button", { name: "Открыть меню" }).click();
      await page.waitForTimeout(260);
    }
    await expect(host).toHaveClass(/is-open/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });

  test("submenu shell stays clean at 1280, 1440 and 1280x720", async () => {
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/reports/orders");
      const host = page.locator(".sidebar-nav-item.has-submenu.is-open").first();
      const panel = host.locator(".sidebar-submenu");
      await panel.waitFor({ state: "visible" });
      await page.waitForTimeout(240);
      const open = await host.evaluate((el) => {
        const panelEl = el.querySelector(".sidebar-submenu");
        const last = panelEl.querySelector(".sidebar-submenu__link:last-child");
        const hostStyle = getComputedStyle(el);
        const panelStyle = getComputedStyle(panelEl);
        const panelRect = panelEl.getBoundingClientRect();
        const sidebarRect = el.closest(".dashboard-sidebar").getBoundingClientRect();
        return {
          hostBorder: hostStyle.borderTopWidth,
          hostShadow: hostStyle.boxShadow,
          panelShadow: panelStyle.boxShadow,
          inset: panelStyle.boxShadow.includes("inset"),
          after: getComputedStyle(panelEl, "::after").content,
          insideSidebar: panelRect.left >= sidebarRect.left - 1 && panelRect.right <= sidebarRect.right + 1,
          lastGap: panelRect.bottom - last.getBoundingClientRect().bottom,
          activeChild: Boolean(panelEl.querySelector(".sidebar-submenu__link.is-active")),
        };
      });
      expect(open.hostBorder, JSON.stringify(viewport)).toBe("0px");
      expect(open.hostShadow, JSON.stringify(viewport)).toBe("none");
      expect(open.panelShadow, JSON.stringify(viewport)).not.toBe("none");
      expect(open.inset, JSON.stringify(viewport)).toBe(false);
      expect(open.after, JSON.stringify(viewport)).toBe("none");
      expect(open.insideSidebar, JSON.stringify(viewport)).toBe(true);
      expect(open.lastGap, JSON.stringify(viewport)).toBeGreaterThanOrEqual(4);
      expect(open.activeChild, JSON.stringify(viewport)).toBe(true);

      await page.getByRole("button", { name: "Свернуть меню" }).click();
      await page.waitForTimeout(240);
      await page.getByRole("button", { name: "Открыть меню" }).click();
      await panel.waitFor({ state: "visible" });
      await page.waitForTimeout(240);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        JSON.stringify(viewport)).toBeLessThanOrEqual(1);
    }
  });

  test("balance modal: full-shell dim, viewport-centered card, compact header", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });
    await page.locator(".topbar-pay-button").click();
    const ov = page.locator(".balance-payment-modal");
    await ov.waitFor({ state: "visible" });

    // overlay: fixed, full viewport, above the sidebar (z>180), soft dim
    await expect(ov).toHaveCSS("position", "fixed");
    await expect(ov).toHaveCSS("background-color", "rgba(15, 35, 60, 0.34)");
    const z = await ov.evaluate((el) => parseInt(getComputedStyle(el).zIndex, 10));
    expect(z).toBeGreaterThan(180); // above the fixed sidebar (z:180)
    const full = await ov.evaluate((el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
    expect(full.w).toBe(1280);

    // the whole shell is dimmed uniformly — the overlay covers the sidebar too
    const coversSidebar = await page.evaluate(() => {
      const sb = document.querySelector(".dashboard-sidebar").getBoundingClientRect();
      const el = document.elementFromPoint(Math.round(sb.x + sb.width / 2), Math.round(sb.y + 200));
      const ov = document.querySelector(".balance-payment-modal");
      return ov.contains(el) || el === ov;
    });
    expect(coversSidebar).toBe(true);

    // card centered on the viewport (both axes)
    const c = await page.evaluate(() => {
      const d = document.querySelector(".balance-payment-dialog").getBoundingClientRect();
      return { dx: Math.abs((d.x + d.width / 2) - window.innerWidth / 2), dy: Math.abs((d.y + d.height / 2) - window.innerHeight / 2) };
    });
    expect(c.dx).toBeLessThanOrEqual(1);
    expect(c.dy).toBeLessThanOrEqual(1);

    // compact header (trimmed ~40% from the old ~109px)
    const headH = await page.locator(".balance-payment-dialog__head").evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(headH).toBeLessThanOrEqual(80);

    // no horizontal overflow while open
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // close it (backdrop mousedown) so later tests start clean
    await ov.dispatchEvent("mousedown");
    await expect(ov).toHaveCount(0);
  });

  test("balance modal: centered with no overflow at 390/768/1280/1440", async () => {
    for (const w of [390, 768, 1280, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto("/");
      await page.locator(".premium-kpi").first().waitFor({ state: "visible" });
      await page.locator(".topbar-pay-button").click();
      const ov = page.locator(".balance-payment-modal");
      await ov.waitFor({ state: "visible" });
      const r = await page.evaluate((vw) => {
        const o = document.querySelector(".balance-payment-modal").getBoundingClientRect();
        const d = document.querySelector(".balance-payment-dialog").getBoundingClientRect();
        return { ovW: Math.round(o.width), dx: Math.abs((d.x + d.width / 2) - vw / 2),
          inside: d.left >= -0.5 && d.right <= vw + 0.5,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      }, w);
      expect(r.ovW, `overlay full @${w}`).toBe(w);
      expect(r.dx, `centered @${w}`).toBeLessThanOrEqual(1);
      expect(r.inside, `inside @${w}`).toBe(true);
      expect(r.overflow, `overflow @${w}`).toBeLessThanOrEqual(1);
      await ov.dispatchEvent("mousedown");
      await expect(ov).toHaveCount(0);
    }
  });

  test("accordion is deterministic: one category open at a time", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });
    const openCount = () => page.locator(".sidebar-nav-item.has-submenu.is-open").count();
    const open = async (label) => { await page.locator(".sidebar-link--button", { hasText: label }).first().click(); await page.waitForTimeout(320); };
    await open("Отчеты"); expect(await openCount()).toBe(1);
    await open("Сотрудники"); expect(await openCount()).toBe(1); // Отчёты closed, Staff open
    await open("Меню"); expect(await openCount()).toBe(1);
    await open("Меню"); expect(await openCount()).toBe(0); // same-parent toggle closes
    // route-active parent opens deterministically on direct navigation
    await page.goto("/reports/z-report");
    await page.locator(".sidebar-submenu").first().waitFor({ state: "visible" });
    expect(await openCount()).toBe(1);
    const openKey = await page.locator(".sidebar-nav-item.has-submenu.is-open .sidebar-link--button").first().textContent();
    expect(openKey).toContain("Отч");
  });

  test("submenu panel is not clipped by the sidebar-nav on the sides", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const route of ["/reports/z-report", "/settings/clients", "/users/cashier"]) {
      await page.goto(route);
      await page.locator(".sidebar-nav-item.has-submenu.is-open .sidebar-submenu").first().waitFor({ state: "visible" });
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => {
        const nav = document.querySelector(".sidebar-nav");
        const panel = document.querySelector(".sidebar-nav-item.has-submenu.is-open .sidebar-submenu");
        const navR = nav.getBoundingClientRect(); const pR = panel.getBoundingClientRect();
        return { overL: Math.round(navR.left - pR.left), overR: Math.round(pR.right - (navR.left + nav.clientWidth)) };
      });
      expect(r.overL, `left clip @${route}`).toBeLessThanOrEqual(0);   // panel within nav → not clipped
      expect(r.overR, `right clip @${route}`).toBeLessThanOrEqual(0);
    }
  });

  test("shadow invariant + icons clean across Staff & Settings categories", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const panelSig = () => page.locator(".sidebar-nav-item.has-submenu.is-open .sidebar-submenu").first().evaluate((el) => {
      const c = getComputedStyle(el); const a = getComputedStyle(el, "::after");
      return JSON.stringify({ box: c.boxShadow, inset: c.boxShadow.includes("inset"),
        border: c.borderTopColor, after: a.content });
    });
    // Staff: external shadow is stateless; icons have no box
    await page.goto("/users/cashier");
    await page.locator(".sidebar-nav-item.has-submenu.is-open .sidebar-submenu").first().waitFor({ state: "visible" });
    await page.waitForTimeout(250);
    const staffBase = await panelSig();
    await page.goto("/users/manager");
    await page.locator(".sidebar-nav-item.has-submenu.is-open .sidebar-submenu").first().waitFor({ state: "visible" });
    await page.waitForTimeout(300);
    expect(await panelSig()).toBe(staffBase); // child change → panel depth unchanged
    // icons: no dark box on submenu icons
    const iconBox = await page.locator(".sidebar-nav-item.has-submenu.is-open .sidebar-submenu__icon").first().evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, shadow: c.boxShadow }; });
    expect(iconBox.bg).toBe("rgba(0, 0, 0, 0)");
    expect(iconBox.shadow).toBe("none");

    // Settings (long panel): same border + external shadow signature
    await page.goto("/settings/units");
    await page.locator(".sidebar-nav-item.has-submenu.is-open .sidebar-submenu").first().waitFor({ state: "visible" });
    await page.waitForTimeout(250);
    expect(await panelSig()).toBe(staffBase);
  });

  test("motion parity: active Отчёты (has-submenu) matches a normal active item", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // a normal (non-submenu) item active — its resting active box-shadow
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });
    await page.waitForTimeout(250);
    const normalActive = page.locator(".sidebar-link.is-active").first();
    const normalShadow = await normalActive.evaluate((el) => getComputedStyle(el).boxShadow);
    const normalTrans = await normalActive.evaluate((el) => getComputedStyle(el).transitionProperty + "|" + getComputedStyle(el).transitionDuration);

    // the has-submenu parent "Отчёты" active on a child route
    await page.goto("/reports/z-report");
    await page.locator(".sidebar-submenu").first().waitFor({ state: "visible" });
    await page.waitForTimeout(250);
    const reportsActive = page.locator(".sidebar-nav-item.has-submenu .sidebar-link.is-active").first();
    const reportsShadow = await reportsActive.evaluate((el) => getComputedStyle(el).boxShadow);
    const reportsTrans = await reportsActive.evaluate((el) => getComputedStyle(el).transitionProperty + "|" + getComputedStyle(el).transitionDuration);

    // identical resting active shadow AND identical transition system
    expect(reportsShadow).toBe(normalShadow);
    expect(reportsTrans).toBe(normalTrans);
  });

  test("open parent button wears the same turquoise border as its panel", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const route of ["/reports/z-report", "/users/cashier", "/settings/clients"]) {
      await page.goto(route);
      await page.locator(".sidebar-nav-item.has-submenu.is-open .sidebar-submenu").first().waitFor({ state: "visible" });
      await page.waitForTimeout(250);
      const parent = page.locator(".sidebar-nav-item.has-submenu.is-open > .sidebar-link").first();
      const host = page.locator(".sidebar-nav-item.has-submenu.is-open").first();
      await expect(parent, `parent border @${route}`).toHaveCSS("border-top-color", "rgb(79, 225, 229)");
      await expect(parent, `parent border w @${route}`).toHaveCSS("border-top-width", "1px");
      await expect(host, `legacy host border removed @${route}`).toHaveCSS("border-top-width", "0px");
      await expect(host, `legacy host shadow removed @${route}`).toHaveCSS("box-shadow", "none");
      const panel = page.locator(".sidebar-nav-item.has-submenu.is-open .sidebar-submenu").first();
      await expect(panel, `panel border @${route}`).toHaveCSS("border-top-color", "rgb(79, 225, 229)");
      // no overlay/mask layer on the open parent near the chevron (clean right side)
      const layers = await parent.evaluate((el) => {
        const c = getComputedStyle(el);
        const aft = getComputedStyle(el, "::after");
        return { afterContent: aft.content, mask: c.maskImage, bgImage: c.backgroundImage };
      });
      expect(layers.afterContent, `open parent ::after @${route}`).toBe("none");
      expect(layers.mask, `open parent mask @${route}`).toBe("none");
      expect(layers.bgImage, `open parent bg-image @${route}`).toBe("none");
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("account panel: smooth centered entrance + chevron rotates, single shadow", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });
    await page.locator(".sidebar-user--button").first().click();
    const menu = page.locator(".sidebar-account__menu").first();
    await menu.waitFor({ state: "visible" });
    await page.waitForTimeout(240);
    const m = await menu.evaluate((el) => { const c = getComputedStyle(el); return { anim: c.animationName, dur: c.animationDuration, shadowLayers: c.boxShadow.split(/,(?![^(]*\))/).length }; });
    expect(m.anim).toBe("owner-account-menu-in");     // entrance animation present
    expect(parseFloat(m.dur)).toBeGreaterThan(0.1);
    expect(m.shadowLayers).toBeLessThanOrEqual(2);    // single/soft, not a stack of shadows
    // horizontally centered in the sidebar (translateX(-50%) preserved through the animation)
    const centered = await page.evaluate(() => {
      const mr = document.querySelector(".sidebar-account__menu").getBoundingClientRect();
      const sr = document.querySelector(".dashboard-sidebar").getBoundingClientRect();
      return Math.abs((mr.x + mr.width / 2) - (sr.x + sr.width / 2));
    });
    expect(centered).toBeLessThanOrEqual(2);
    // trigger chevron: closed → points right (no rotation), open → points up (rotate -90°)
    const arrowOpen = await page.locator(".sidebar-account.is-open .sidebar-user__arrow").first().evaluate((el) => getComputedStyle(el).transform);
    expect(arrowOpen).toBe("matrix(0, -1, 1, 0, 0, 0)"); // rotate(-90deg) → points up
    // language trigger is one clean control — no inner gray capsule around the code
    const lc = await page.locator(".sidebar-account__lang-current").first().evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, borderW: c.borderTopWidth }; });
    expect(lc.bg).toBe("rgba(0, 0, 0, 0)");   // transparent, no dark/gray pill
    expect(lc.borderW).toBe("0px");
    await expect(page.locator(".sidebar-account__lang-current-flag img")).toHaveAttribute("src", /flag/i);
    // sidebar padding is exactly 10px 6px 15px
    await expect(page.locator(".dashboard-sidebar")).toHaveCSS("padding", "10px 6px 15px");
    // closed state → chevron points right (no rotation)
    await page.locator(".sidebar-user--button").first().click(); // close
    await page.waitForTimeout(300);
    const arrowClosed = await page.locator(".sidebar-user__arrow").first().evaluate((el) => getComputedStyle(el).transform);
    expect(arrowClosed === "none" || arrowClosed === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  });

  test("profile menu: readable text, white language popup, flag sync, smooth close", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });
    await page.locator(".sidebar-user--button").first().click();
    await page.locator(".sidebar-account__menu").waitFor({ state: "visible" });
    await page.waitForTimeout(240);

    // rows are readable navy (not near-white on white), logout is danger red
    const itemColor = await page.locator(".sidebar-account__item:not(.sidebar-account__item--danger)").first().evaluate((el) => getComputedStyle(el).color);
    expect(itemColor).toContain("11, 31, 63");
    const danger = await page.locator(".sidebar-account__item--danger").first().evaluate((el) => getComputedStyle(el).color);
    expect(danger).toContain("229, 72, 77");

    // language trigger shows the selected flag + code (driven by state)
    const startCode = (await page.locator(".sidebar-account__lang-current").first().innerText()).trim();
    const startFlag = await page.locator(".sidebar-account__lang-current-flag img").first().getAttribute("src");
    expect(startFlag).toBeTruthy();

    // open the language popup → white surface (not the old dark navy slab)
    await page.locator(".sidebar-account__lang-trigger").click();
    await page.locator(".sidebar-account__lang-panel").waitFor({ state: "visible" });
    await page.waitForTimeout(180);
    await expect(page.locator(".sidebar-account__lang-panel")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    const langItemColor = await page.locator(".sidebar-account__lang-panel button").first().evaluate((el) => getComputedStyle(el).color);
    expect(langItemColor).toContain("11, 31, 63");
    // popup stays fully inside the profile panel: no intrinsic-width overflow,
    // scrollbar, clipping or side-protrusion from the old legacy side-popover.
    const languageGeometry = await page.evaluate(() => {
      const menu = document.querySelector(".sidebar-account__menu");
      const panel = document.querySelector(".sidebar-account__lang-panel");
      const trigger = document.querySelector(".sidebar-account__lang-trigger");
      const mr = menu.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      const tr = trigger.getBoundingClientRect();
      const horizontallyContained = (outer, node) => {
        const rect = node.getBoundingClientRect();
        return rect.left >= outer.left - 1 && rect.right <= outer.right + 1;
      };
      return {
        menuOverflow: menu.scrollWidth - menu.clientWidth,
        panelOverflow: panel.scrollWidth - panel.clientWidth,
        leftInset: pr.left - mr.left,
        rightInset: mr.right - pr.right,
        overflowX: getComputedStyle(menu).overflowX,
        hasHorizontalScroll: menu.scrollWidth > menu.clientWidth + 1,
        triggerContentContained: [...trigger.querySelectorAll(".sidebar-account__lang-current, .sidebar-account__lang-current-flag, .sidebar-account__lang-chevron")]
          .every((node) => horizontallyContained(tr, node)),
        popupContentContained: [...panel.querySelectorAll(".sidebar-account__lang-flag, .sidebar-account__lang-code")]
          .every((node) => horizontallyContained(pr, node)),
      };
    });
    expect(languageGeometry.menuOverflow).toBeLessThanOrEqual(1);
    expect(languageGeometry.panelOverflow).toBeLessThanOrEqual(1);
    expect(languageGeometry.leftInset).toBeGreaterThanOrEqual(0);
    expect(languageGeometry.rightInset).toBeGreaterThanOrEqual(0);
    expect(languageGeometry.overflowX).toBe("visible");
    expect(languageGeometry.hasHorizontalScroll).toBe(false);
    expect(languageGeometry.triggerContentContained).toBe(true);
    expect(languageGeometry.popupContentContained).toBe(true);

    // Exercise every supported language. The logical language state remains the
    // only selected-value source; presence only keeps the popup alive for exit.
    const flags = { UZ: /Uzbekistan/i, RU: /Russia/i, EN: /United_Kingdom/i };
    for (const [index, code] of ["UZ", "RU", "EN"].entries()) {
      if (index > 0) {
        await page.locator(".sidebar-account__lang-trigger").click();
        await page.locator(".sidebar-account__lang-panel").waitFor({ state: "visible" });
      }
      await page.locator(".sidebar-account__lang-panel button", { hasText: code }).first().click();
      await page.waitForTimeout(40);
      expect(await page.locator(".sidebar-account__lang-panel.is-closing").count()).toBe(1);
      await expect(page.locator(".sidebar-account__lang-panel")).toHaveCSS("animation-name", "owner-lang-panel-out");
      await page.waitForTimeout(180);
      expect(await page.locator(".sidebar-account__lang-panel").count()).toBe(0);
      expect((await page.locator(".sidebar-account__lang-current").first().innerText()).trim()).toContain(code);
      await expect(page.locator(".sidebar-account__lang-current-flag img")).toHaveAttribute("src", flags[code]);
    }
    expect(startCode).toBeTruthy();
    expect(startFlag).toBeTruthy();

    // reopen → selection persisted
    await page.locator(".sidebar-user--button").first().click(); // close
    await page.waitForTimeout(300);
    await page.locator(".sidebar-user--button").first().click(); // reopen
    await page.locator(".sidebar-account__menu").waitFor({ state: "visible" });
    await page.waitForTimeout(240);
    expect((await page.locator(".sidebar-account__lang-current").first().innerText()).trim()).toContain("EN");

    // smooth close: the menu runs an exit animation before unmounting (not instant)
    await page.locator(".sidebar-user--button").first().click();
    await page.waitForTimeout(40);
    expect(await page.locator(".sidebar-account__menu.is-closing").count()).toBe(1);
    const outAnim = await page.locator(".sidebar-account__menu").first().evaluate((el) => getComputedStyle(el).animationName).catch(() => "gone");
    expect(outAnim).toBe("owner-account-menu-out");
    await page.waitForTimeout(320);
    expect(await page.locator(".sidebar-account__menu").count()).toBe(0);
  });

  test("collapsed profile: stable anchor, contained language popup, smooth exit + reopen", async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Свернуть меню" }).click();
    await page.waitForTimeout(260);

    const account = page.locator(".sidebar-account");
    await account.hover();
    const menu = page.locator(".sidebar-account__menu");
    await menu.waitFor({ state: "visible" });
    await page.waitForTimeout(220);
    const anchor = await page.evaluate(() => {
      const sidebar = document.querySelector(".dashboard-sidebar").getBoundingClientRect();
      const trigger = document.querySelector(".sidebar-user--button").getBoundingClientRect();
      const panel = document.querySelector(".sidebar-account__menu").getBoundingClientRect();
      return {
        sidebarRight: sidebar.right,
        triggerBottom: trigger.bottom,
        panelLeft: panel.left,
        panelBottom: panel.bottom,
        panelRight: panel.right,
        panelOverflow: document.querySelector(".sidebar-account__menu").scrollWidth
          - document.querySelector(".sidebar-account__menu").clientWidth,
      };
    });
    expect(anchor.panelLeft).toBeGreaterThan(anchor.sidebarRight);
    expect(Math.abs(anchor.panelBottom - anchor.triggerBottom)).toBeLessThanOrEqual(2);
    expect(anchor.panelRight).toBeLessThanOrEqual(1280);
    expect(anchor.panelOverflow).toBeLessThanOrEqual(1);

    await page.locator(".sidebar-account__lang-trigger").click();
    await page.locator(".sidebar-account__lang-panel").waitFor({ state: "visible" });
    await page.waitForTimeout(180);
    const langContained = await page.evaluate(() => {
      const menuEl = document.querySelector(".sidebar-account__menu");
      const panelEl = document.querySelector(".sidebar-account__lang-panel");
      const triggerEl = document.querySelector(".sidebar-account__lang-trigger");
      const mr = menuEl.getBoundingClientRect();
      const pr = panelEl.getBoundingClientRect();
      const tr = triggerEl.getBoundingClientRect();
      const horizontallyContained = (outer, node) => {
        const rect = node.getBoundingClientRect();
        return rect.left >= outer.left - 1 && rect.right <= outer.right + 1;
      };
      return {
        leftInset: pr.left - mr.left,
        rightInset: mr.right - pr.right,
        menuOverflow: menuEl.scrollWidth - menuEl.clientWidth,
        panelOverflow: panelEl.scrollWidth - panelEl.clientWidth,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        overflowX: getComputedStyle(menuEl).overflowX,
        hasHorizontalScroll: menuEl.scrollWidth > menuEl.clientWidth + 1,
        triggerContentContained: [...triggerEl.querySelectorAll(".sidebar-account__lang-current, .sidebar-account__lang-current-flag, .sidebar-account__lang-chevron")]
          .every((node) => horizontallyContained(tr, node)),
        popupContentContained: [...panelEl.querySelectorAll(".sidebar-account__lang-flag, .sidebar-account__lang-code")]
          .every((node) => horizontallyContained(pr, node)),
      };
    });
    expect(langContained.leftInset).toBeGreaterThanOrEqual(-1);
    expect(langContained.rightInset).toBeGreaterThanOrEqual(-1);
    expect(langContained.menuOverflow).toBeLessThanOrEqual(1);
    expect(langContained.panelOverflow).toBeLessThanOrEqual(1);
    expect(langContained.documentOverflow).toBeLessThanOrEqual(1);
    expect(langContained.overflowX).toBe("auto");
    expect(langContained.hasHorizontalScroll).toBe(false);
    expect(langContained.triggerContentContained).toBe(true);
    expect(langContained.popupContentContained).toBe(true);

    const collapsedFlags = { UZ: /Uzbekistan/i, RU: /Russia/i, EN: /United_Kingdom/i };
    for (const [index, code] of ["UZ", "RU", "EN"].entries()) {
      if (index > 0) {
        await page.locator(".sidebar-account__lang-trigger").click();
        await page.locator(".sidebar-account__lang-panel").waitFor({ state: "visible" });
      }
      const option = page.locator(".sidebar-account__lang-panel button", { hasText: code }).first();
      expect(await option.evaluate((el) => {
        const outer = el.getBoundingClientRect();
        return [...el.querySelectorAll(".sidebar-account__lang-flag, .sidebar-account__lang-code")].every((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left >= outer.left - 1 && rect.right <= outer.right + 1;
        });
      })).toBe(true);
      await option.click();
      await page.locator(".sidebar-account__lang-panel.is-closing").waitFor({ state: "attached", timeout: 1000 });
      expect(await menu.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      await page.locator(".sidebar-account__lang-panel").waitFor({ state: "detached", timeout: 1000 });
      expect((await page.locator(".sidebar-account__lang-current").innerText()).trim()).toContain(code);
      await expect(page.locator(".sidebar-account__lang-current-flag img")).toHaveAttribute("src", collapsedFlags[code]);
    }

    await page.mouse.move(600, 300);
    await page.locator(".sidebar-account__menu.is-closing").waitFor({ state: "attached", timeout: 1000 });
    expect(await menu.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator(".sidebar-account__menu")).toHaveCSS("animation-name", "owner-account-flyout-out");
    await page.locator(".sidebar-account__menu").waitFor({ state: "detached", timeout: 1000 });

    await account.hover();
    await menu.waitFor({ state: "visible" });
    await page.waitForTimeout(220);
    await expect(menu).toHaveCSS("animation-name", "owner-account-flyout-in");
  });

  test("collapsed flyouts: every category is bounded; icons, hover and shadow stay invariant", async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/reports/z-report");
    await page.locator(".sidebar-submenu").first().waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Свернуть меню" }).click();
    await page.waitForTimeout(260);

    const expectedParents = ["Отчеты", "Сотрудники", "Меню", "Склад", "Отчёт по складам", "Финансы", "Настройки"];
    const parents = page.locator(".sidebar-nav-item.has-submenu");
    expect(await parents.count()).toBe(expectedParents.length);
    let invariantShadow = "";

    for (const [index, expectedLabel] of expectedParents.entries()) {
      const host = parents.nth(index);
      expect((await host.locator(":scope > .sidebar-link--button").textContent()).trim()).toContain(expectedLabel);
      await host.hover();
      const flyout = host.locator(".sidebar-collapsed-popover");
      await flyout.waitFor({ state: "visible" });
      await page.waitForTimeout(220);
      const probe = await flyout.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const topbarBottom = document.querySelector(".dashboard-topbar").getBoundingClientRect().bottom;
        const accountTop = document.querySelector(".sidebar-account").getBoundingClientRect().top;
        const icon = el.querySelector(".sidebar-collapsed-popover__icon");
        const svg = icon.querySelector("svg");
        const ic = getComputedStyle(icon);
        const sc = getComputedStyle(svg);
        const pc = getComputedStyle(el);
        const last = el.querySelector(".sidebar-collapsed-popover__link:last-child").getBoundingClientRect();
        return {
          rect: { top: rect.top, right: rect.right, bottom: rect.bottom },
          topbarBottom,
          accountTop,
          shadow: pc.boxShadow,
          insetShadow: pc.boxShadow.includes("inset"),
          icon: { bg: ic.backgroundColor, shadow: ic.boxShadow, width: ic.width, svgWidth: sc.width, stroke: sc.strokeWidth },
          lastGap: rect.bottom - last.bottom,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(probe.rect.top).toBeGreaterThanOrEqual(probe.topbarBottom + 7);
      expect(probe.rect.bottom).toBeLessThanOrEqual(probe.accountTop - 7);
      expect(probe.rect.right).toBeLessThanOrEqual(1280);
      expect(probe.lastGap).toBeGreaterThanOrEqual(8);
      expect(probe.overflow).toBeLessThanOrEqual(1);
      expect(probe.insetShadow).toBe(false);
      expect(probe.icon).toEqual({ bg: "rgba(0, 0, 0, 0)", shadow: "none", width: "18px", svgWidth: "17px", stroke: "2px" });
      if (!invariantShadow) invariantShadow = probe.shadow;
      expect(probe.shadow).toBe(invariantShadow);

      const inactive = flyout.locator(".sidebar-collapsed-popover__link:not(.is-active)").first();
      if (await inactive.count()) {
        await inactive.hover();
        await page.waitForTimeout(220);
        await expect(inactive).toHaveCSS("background-color", "rgba(29, 181, 181, 0.08)");
        await expect(inactive).toHaveCSS("transform", "matrix(1, 0, 0, 1, 3, 0)");
        await expect(inactive.locator(".sidebar-collapsed-popover__icon")).toHaveCSS("color", TURQUOISE);
        expect(await flyout.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(invariantShadow);
      }
      await page.mouse.move(600, 300);
      await page.waitForTimeout(100);
    }

    const reports = parents.first();
    await reports.hover();
    const activeChild = reports.locator(".sidebar-collapsed-popover__link.is-active");
    await activeChild.waitFor({ state: "visible" });
    await expect(activeChild.locator(".sidebar-collapsed-popover__icon")).toHaveCSS("color", TURQUOISE);
    expect(await reports.locator(".sidebar-collapsed-popover").evaluate((el) => getComputedStyle(el).boxShadow)).toBe(invariantShadow);
  });

  test("collapsed flyout remeasures live across viewport height changes", async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/users/cashier");
    await page.locator(".sidebar-nav-item.has-submenu.is-open .sidebar-submenu").first().waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Свернуть меню" }).click();
    await page.waitForTimeout(260);

    const staff = page.locator(".sidebar-nav-item.has-submenu").nth(1);
    await staff.hover();
    const flyout = staff.locator(".sidebar-collapsed-popover");
    await flyout.waitFor({ state: "visible" });
    await page.waitForTimeout(220);

    const readGeometry = () => flyout.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const topbarBottom = document.querySelector(".dashboard-topbar").getBoundingClientRect().bottom;
      const accountTop = document.querySelector(".sidebar-account").getBoundingClientRect().top;
      const last = el.querySelector(".sidebar-collapsed-popover__link:last-child").getBoundingClientRect();
      return {
        rect: { top: rect.top, right: rect.right, bottom: rect.bottom },
        topbarBottom,
        accountTop,
        viewportWidth: window.innerWidth,
        lastGap: rect.bottom - last.bottom,
        flyoutOverflow: el.scrollWidth - el.clientWidth,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const expectBounded = (geometry) => {
      expect(geometry.rect.top).toBeGreaterThanOrEqual(geometry.topbarBottom + 7);
      expect(geometry.rect.bottom).toBeLessThanOrEqual(geometry.accountTop - 7);
      expect(geometry.rect.right).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.lastGap).toBeGreaterThanOrEqual(8);
      expect(geometry.flyoutOverflow).toBeLessThanOrEqual(1);
      expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
    };

    const initial = await readGeometry();
    expectBounded(initial);

    await page.setViewportSize({ width: 1280, height: 640 });
    await expect.poll(async () => {
      const geometry = await readGeometry();
      return Math.round(geometry.rect.bottom - geometry.accountTop);
    }).toBeLessThanOrEqual(-7);
    await expect(flyout).toBeVisible();
    const constrained = await readGeometry();
    expectBounded(constrained);
    expect(constrained.rect.top).toBeLessThan(initial.rect.top - 40);

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect.poll(async () => Math.abs((await readGeometry()).rect.top - initial.rect.top)).toBeLessThanOrEqual(2);
    await expect(flyout).toBeVisible();
    const restored = await readGeometry();
    expectBounded(restored);
  });

  test("sidebar search sits under brand, above Дашборд; active radius 24px", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });

    // placement: brand → search → first nav item, no overlap
    const rects = await page.evaluate(() => {
      const g = (s) => { const el = document.querySelector(s); const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
      const sbTop = document.querySelector(".dashboard-sidebar").getBoundingClientRect().top;
      return { sbTop, brand: g(".sidebar-brand"), search: g(".sidebar-search"), firstNav: g(".sidebar-nav .sidebar-link") };
    });
    expect(rects.search.top).toBeGreaterThanOrEqual(rects.brand.bottom - 1); // below brand
    expect(rects.firstNav.top).toBeGreaterThanOrEqual(rects.search.bottom - 1); // above first nav
    // search is close to Dashboard (small gap ≈ 6px, not a wide void)
    expect(rects.firstNav.top - rects.search.bottom).toBeLessThanOrEqual(9);
    // brand block vertically centered between sidebar top edge and the search bar
    const topGap = rects.brand.top - rects.sbTop;
    const bottomGap = rects.search.top - rects.brand.bottom;
    expect(Math.abs(topGap - bottomGap)).toBeLessThanOrEqual(3);

    // visual: field is the light pill shell (42px, radius 24, solid #f4f7fc),
    // placeholder "Поиск"
    const field = page.locator(".sidebar-search__field");
    await expect(field).toHaveCSS("background-color", "rgb(244, 247, 252)");
    await expect(field).toHaveCSS("border-top-left-radius", "24px");
    await expect(field).toHaveCSS("box-shadow", "none");
    const fieldH = await field.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(fieldH).toBe(42);
    await expect(page.locator(".sidebar-search__input")).toHaveAttribute("placeholder", "Поиск");
    // accessible focus state on the field (bg animates to white over 160ms → poll until settled)
    await page.locator(".sidebar-search__input").focus();
    await expect.poll(async () => field.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
    const focusShadow = await field.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(focusShadow).not.toBe("none");

    // active button radius = 24px (Дашборд active on "/")
    await expect(page.locator(".sidebar-link.is-active").first()).toHaveCSS("border-top-left-radius", "24px");
    // inactive stays not-24
    const inactiveR = await page.locator(".sidebar-link:not(.is-active)").first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(inactiveR).not.toBe("24px");

    // active/open parent also 24px on a child route
    await page.goto("/reports/z-report");
    await page.locator(".sidebar-submenu").first().waitFor({ state: "visible" });
    await page.waitForTimeout(200);
    await expect(page.locator(".sidebar-nav-item.has-submenu.is-open > .sidebar-link")).toHaveCSS("border-top-left-radius", "24px");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("sidebar navigation search: query, keyboard, child nav, clear, empty", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });
    const input = page.locator(".sidebar-search__input");
    const labels = () => page.locator(".sidebar-search__result-label").allInnerTexts();

    // query results derive from the nav tree
    await input.fill("касс"); await page.waitForTimeout(160);
    expect(await labels()).toContain("Кассир");
    await input.fill("заказ"); await page.waitForTimeout(160);
    expect(await labels()).toContain("Отчёт по заказам");
    await input.fill("фин"); await page.waitForTimeout(160);
    expect(await labels()).toContain("Финансы");

    // empty state (not an error)
    await input.fill("zzzzz"); await page.waitForTimeout(160);
    await expect(page.locator(".sidebar-search__empty-title")).toHaveText("Ничего не найдено");

    // clear X resets query + closes results
    await input.fill("касс"); await page.waitForTimeout(120);
    await expect(page.locator(".sidebar-search__clear")).toBeVisible();
    await page.locator(".sidebar-search__clear").click();
    await page.waitForTimeout(100);
    expect(await input.inputValue()).toBe("");
    expect(await page.locator(".sidebar-search__results").count()).toBe(0);

    // keyboard: type child → ArrowDown + Enter navigates + opens correct parent + closes
    await input.fill("касс"); await page.waitForTimeout(160);
    await input.press("Enter");
    await page.waitForTimeout(500);
    expect(page.url()).toContain("/users/cashier");
    const openParent = await page.locator(".sidebar-nav-item.has-submenu.is-open .sidebar-link--button").first().innerText();
    expect(openParent).toContain("Сотрудники");
    expect(await page.locator(".sidebar-search__results").count()).toBe(0); // closed
    expect(await input.inputValue()).toBe(""); // query cleared

    // Escape clears an open query
    await input.fill("мен"); await page.waitForTimeout(140);
    await input.press("Escape");
    await page.waitForTimeout(100);
    expect(await input.inputValue()).toBe("");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("right summary cards match top KPI hover motion (lift + shadow, no jitter)", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });
    const read = (el) => { const c = getComputedStyle(el); return { transform: c.transform, shadow: c.boxShadow, dur: c.transitionDuration }; };

    // KPI hover reference
    const kpi = page.locator(".premium-kpi").first();
    await kpi.hover(); await page.waitForTimeout(300);
    const kpiHover = await kpi.evaluate(read);
    await page.mouse.move(5, 5); await page.waitForTimeout(200);
    expect(kpiHover.transform).toBe("matrix(1, 0, 0, 1, 0, -2)"); // KPI lifts -2px

    // summary resting captured, then hover
    const sum = page.locator(".warehouse-summary-item").first();
    const rest = await sum.evaluate(read);
    expect(rest.transform).toBe("none"); // resting unchanged (no lift at rest)
    await sum.hover(); await page.waitForTimeout(300);
    const hov = await sum.evaluate(read);
    // motion matches KPI: same lift, same shadow, same transition duration
    expect(hov.transform).toBe(kpiHover.transform);
    expect(hov.shadow).toBe(kpiHover.shadow);
    expect(hov.dur).toBe(kpiHover.dur);

    // no sibling/layout jitter: a neighbor card does not move while one is hovered
    const jitter = await page.evaluate(() => {
      const cards = document.querySelectorAll(".warehouse-summary-item");
      const b = cards[1].getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y) };
    });
    await page.locator(".warehouse-summary-item").nth(0).hover();
    await page.waitForTimeout(250);
    const jitter2 = await page.evaluate(() => {
      const cards = document.querySelectorAll(".warehouse-summary-item");
      const b = cards[1].getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y) };
    });
    expect(jitter2).toEqual(jitter);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("topbar is ~15% shorter on desktop; controls centered, no gap/overflow", async () => {
    // desktop compact bucket (1025–1440): 64 → 54 (~15.6%)
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });
    const h1280 = await page.locator(".dashboard-topbar").evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(h1280).toBe(54);
    // large bucket (≥1440): 86 → 73 (~15%)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });
    const h1440 = await page.locator(".dashboard-topbar").evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(h1440).toBe(73);
    const reduction = (86 - h1440) / 86;
    expect(reduction).toBeGreaterThanOrEqual(0.13);
    expect(reduction).toBeLessThanOrEqual(0.17);

    // controls vertically centered, clean topbar→content junction, no overflow
    const probe = await page.evaluate(() => {
      const t = document.querySelector(".dashboard-topbar").getBoundingClientRect();
      const c = document.querySelector(".dashboard-content").getBoundingClientRect();
      const mid = t.top + t.height / 2;
      const bell = document.querySelector(".topbar-notification").getBoundingClientRect();
      return { gap: Math.round(c.top - t.bottom), bellOff: Math.round((bell.top + bell.height / 2) - mid),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(Math.abs(probe.gap)).toBeLessThanOrEqual(1);
    expect(Math.abs(probe.bellOff)).toBeLessThanOrEqual(1);
    expect(probe.overflow).toBeLessThanOrEqual(1);

    // mobile bar unchanged (stays 54, not mechanically shrunk)
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/");
    await page.locator(".dashboard-shell").waitFor({ state: "visible" });
    const hMobile = await page.locator(".dashboard-topbar").evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(hMobile).toBe(54);

    // sidebar width + balance geometry untouched
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.locator(".premium-kpi").first().waitFor({ state: "visible" });
    expect(await page.locator(".dashboard-sidebar").evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(280);
    await expect(page.locator(".topbar-pay-button")).toHaveCSS("border-top-left-radius", "12px");
    await expect(page.locator(".topbar-balance-amount")).toHaveCSS("border-right-width", "0px");
  });

  test("sidebar respects prefers-reduced-motion", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/reports/z-report");
    await page.locator(".sidebar-submenu").first().waitFor({ state: "visible" });
    const nearInstant = (durations) => durations.split(",").every((duration) => parseFloat(duration) <= 0.02);

    const submenuDuration = await page.locator(".sidebar-submenu__link").first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(nearInstant(submenuDuration)).toBe(true);

    await page.locator(".sidebar-user--button").click();
    const accountMenu = page.locator(".sidebar-account__menu");
    await accountMenu.waitFor({ state: "visible" });
    expect(nearInstant(await accountMenu.evaluate((el) => getComputedStyle(el).animationDuration))).toBe(true);

    await page.locator(".sidebar-account__lang-trigger").click();
    const languagePanel = page.locator(".sidebar-account__lang-panel");
    await languagePanel.waitFor({ state: "visible" });
    expect(nearInstant(await languagePanel.evaluate((el) => getComputedStyle(el).animationDuration))).toBe(true);
    await page.locator(".sidebar-account__lang-trigger").click();
    await languagePanel.waitFor({ state: "detached" });
    await page.locator(".sidebar-user--button").click();
    await accountMenu.waitFor({ state: "detached" });

    await page.getByRole("button", { name: "Свернуть меню" }).click();
    const reports = page.locator(".sidebar-nav-item.has-submenu").first();
    await reports.hover();
    const collapsedFlyout = reports.locator(".sidebar-collapsed-popover");
    await collapsedFlyout.waitFor({ state: "visible" });
    const collapsedDurations = await collapsedFlyout.evaluate((el) => ({
      panel: getComputedStyle(el).transitionDuration,
      link: getComputedStyle(el.querySelector(".sidebar-collapsed-popover__link")).transitionDuration,
      icon: getComputedStyle(el.querySelector(".sidebar-collapsed-popover__icon")).transitionDuration,
    }));
    expect(Object.values(collapsedDurations).every(nearInstant)).toBe(true);
    await page.emulateMedia({ reducedMotion: null });
  });
});
