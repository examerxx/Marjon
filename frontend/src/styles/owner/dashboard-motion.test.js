import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner sidebar collapse motion", () => {
  it("keeps submenu opening responsive and synchronizes closing with React retention", () => {
    const css = readFileSync(resolve("src/styles/owner/dashboard.css"), "utf8").replaceAll("\r\n", "\n");
    const panel = css.slice(
      css.indexOf("OWNER expanded subcategory panel"),
      css.indexOf("OWNER sidebar MOTION + ICON cleanup"),
    );

    expect(panel).toContain("--owner-submenu-motion-ms: 320ms;");
    expect(panel).toContain("--owner-submenu-motion-easing: cubic-bezier(0.4, 0, 0.2, 1);");
    expect(panel).toContain("height var(--owner-submenu-motion-ms)");
    expect(panel).toContain("opacity var(--owner-submenu-motion-ms)");
    expect(panel).toContain("margin-top var(--owner-submenu-motion-ms)");
    expect(panel).toContain("padding var(--owner-submenu-motion-ms)");
    expect(panel).toContain("border-width var(--owner-submenu-motion-ms)");
    expect(panel).toMatch(/\.sidebar-nav-item\.has-submenu\.is-open \.sidebar-submenu\s*\{[^}]*--owner-submenu-motion-ms:\s*220ms;[^}]*--owner-submenu-motion-easing:\s*cubic-bezier\(0\.22, 1, 0\.36, 1\);/s);
    expect(panel).toMatch(/\.sidebar-nav-item\.has-submenu\.is-open \.sidebar-submenu\s*\{[^}]*margin-top:\s*0;/s);
  });

  it("gives collapsed flyouts a light stationary entrance animation", () => {
    const css = readFileSync(resolve("src/styles/owner/dashboard.css"), "utf8").replaceAll("\r\n", "\n");
    const flyout = css.slice(
      css.indexOf("Collapsed flyout popover"),
      css.indexOf("OWNER sidebar NAVIGATION search"),
    );

    expect(flyout).toMatch(/\.dashboard-sidebar\.is-collapsed \.sidebar-collapsed-popover\s*\{[^}]*transform:\s*none;[^}]*transition:\s*none;/s);
    expect(flyout).toMatch(/\.sidebar-nav-item\.has-popover \.sidebar-collapsed-popover\s*\{[^}]*transform-origin:\s*left center;[^}]*transition:\s*none;[^}]*animation:\s*owner-collapsed-popover-in 160ms cubic-bezier\(0\.22, 1, 0\.36, 1\) both;/s);
    expect(flyout).toMatch(/@keyframes owner-collapsed-popover-in\s*\{[\s\S]*?transform:\s*scale\(0\.99\);[\s\S]*?transform:\s*scale\(1\);/s);
  });

  it("keeps rail, category wrappers and buttons on one 180ms geometry track", () => {
    const css = readFileSync(resolve("src/styles/owner/dashboard.css"), "utf8").replaceAll("\r\n", "\n");
    const contract = css.slice(css.indexOf("OWNER sidebar collapse motion contract"));

    expect(contract).toContain(".dashboard-sidebar .sidebar-nav-item");
    expect(contract).toContain(".dashboard-sidebar .sidebar-link--button");
    expect(contract).toMatch(/\.dashboard-sidebar \.sidebar-nav-item\.has-submenu\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
    expect(contract).toMatch(/\.sidebar-nav-item\.has-submenu > \.sidebar-link--button\s*\{[^}]*margin-block:\s*0;/s);
    expect(contract).toContain("width 180ms ease");
    expect(contract).toContain("height 180ms ease");
    expect(contract).toContain(".sidebar-nav-item:not(.is-open)");
    expect(contract).toMatch(/\.dashboard-sidebar:not\(\.is-collapsed\) \.sidebar-nav-item\.has-submenu\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*46px;[^}]*max-height:\s*none;/s);
    expect(contract).toMatch(/\.dashboard-sidebar\.is-collapsed \.sidebar-nav-item\.has-submenu\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*56px;[^}]*max-height:\s*none;/s);
    expect(contract).toMatch(/\.dashboard-sidebar\.is-collapsed \.sidebar-nav-item::before\s*\{[^}]*inset:\s*-6px -16px;[^}]*pointer-events:\s*auto;/s);
    expect(contract).toMatch(/\.sidebar-nav-item\.has-popover > \.sidebar-link--button:not\(\.is-active\)\s*\{[^}]*background:\s*rgba\(29, 181, 181, 0\.07\);/s);
    expect(contract).toContain(".sidebar-nav-item.has-submenu .sidebar-link__chevron");
    expect(contract).toContain("grid-template-columns 180ms ease");
    expect(contract).toContain("grid-template-columns: 22px minmax(0, 0fr) 0;");
    expect(contract).toMatch(/\.dashboard-sidebar\.is-collapsed \.sidebar-link,[\s\S]*?\.sidebar-link--button\s*\{[^}]*justify-content:\s*stretch;/);
    expect(contract).toContain(".dashboard-main");
    expect(contract).toContain("margin-left 180ms ease");
    expect(contract).toContain("padding-top: 0;");
    expect(contract).toContain("margin-top: 102px;");
    expect(contract).toContain("opacity 120ms ease");
    expect(contract).toContain("display: block;");
    expect(contract).toContain(".dashboard-sidebar:not(.is-collapsed) .sidebar-link");
    expect(contract).toContain("width: 100%;");
    expect(contract).toMatch(/\.dashboard-sidebar:not\(\.is-collapsed\) \.sidebar-nav\s*\{[^}]*margin-left:\s*0;/s);
    expect(contract).toContain(".dashboard-sidebar.is-collapsed .sidebar-link");
    expect(contract).toContain("width: 56px;");
    expect(contract).toContain("margin-left: 10px;");
    expect(contract).toContain("justify-self: start;");
    expect(contract).toContain("padding-inline: 27px;");
    expect(contract).toContain("place-items: center;");
    expect(contract).toContain("flex: 0 0 22px;");
    expect(contract).toContain("left: 12px;");
    expect(contract).toMatch(/\.dashboard-sidebar\.is-collapsed \.sidebar-brand\s*\{[^}]*overflow:\s*visible;/s);
    expect(contract).toContain("inset: 0 auto auto 4px;");
    expect(contract).toContain("appearance: none;");
    expect(contract).toContain(".brand-mark--button:active");
    expect(contract).toContain("align-items: flex-start;");
    expect(contract).toContain("align-self: flex-start;");
    expect(contract).toContain("justify-self: start;");
    expect(contract).toMatch(/\.dashboard-sidebar\.is-collapsed \.sidebar-nav-item\s*\{[^}]*margin:\s*0;/s);
    expect(contract).toContain("border-radius 180ms ease");
    expect(contract).toContain("border-radius: 24px;");
    expect(contract).toContain("border-radius: 17px;");
    expect(contract).toContain("transition-duration: 0.01ms;");
  });

  it("keeps search clearance on the same 180ms track", () => {
    const css = readFileSync(resolve("src/styles/owner/dashboard.css"), "utf8").replaceAll("\r\n", "\n");
    const search = css.slice(css.indexOf("OWNER sidebar NAVIGATION search"), css.indexOf("Search field internals"));

    expect(search).toContain("max-height 180ms ease");
    expect(search).toContain("margin-top 180ms ease");
    expect(search).toContain("transition: margin-top 180ms ease;");
    expect(search).toContain("transition-delay: 0ms, 0ms, 90ms, 90ms;");
    expect(search).toContain("transition-delay: 0ms, 0ms, 0ms, 180ms;");
  });

  it("does not snap brand or account content between layout modes", () => {
    const css = readFileSync(resolve("src/styles/owner/dashboard.css"), "utf8").replaceAll("\r\n", "\n");
    const contract = css.slice(css.indexOf("OWNER sidebar collapse motion contract"));

    expect(contract).toContain(".sidebar-brand__identity > div");
    expect(contract).toContain(".brand-title");
    expect(contract).toContain(".brand-subtitle");
    expect(contract).toContain(".dashboard-sidebar.is-collapsed .brand-title");
    expect(contract).toMatch(/\.dashboard-sidebar\.is-collapsed \.sidebar-brand__identity > div\s*\{[^}]*width:\s*0;[^}]*max-width:\s*0;[^}]*margin-left:\s*0;/s);
    expect(contract).toContain("width 250ms ease");
    expect(contract).toContain("opacity 180ms ease");
    expect(contract).toContain("visibility 180ms ease");
    expect(contract).toContain(".sidebar-account");
    expect(contract).toContain(".sidebar-user__meta");
    expect(contract).toContain(".sidebar-user__arrow");
    expect(contract).toContain("grid-template-columns: 56px minmax(0, 0fr) 0;");
  });

  it("matches collapsed category hover geometry while preserving its pale colour", () => {
    const css = readFileSync(resolve("src/styles/owner/dashboard.css"), "utf8").replaceAll("\r\n", "\n");
    const contract = css.slice(css.indexOf("OWNER sidebar collapse motion contract"));

    expect(contract).toContain(".sidebar-nav-item.has-submenu:not(.is-open) > .sidebar-link--button:hover");
    expect(contract).toContain(".sidebar-nav-item.has-submenu.has-popover > .sidebar-link--button");
    expect(contract).toContain(".sidebar-link:not(.is-active):hover");
    expect(contract).toContain("border-radius: 17px;");
    expect(contract).toContain("transform: none;");
    const hoverContract = contract.slice(contract.indexOf("A closed category keeps its pale hover colour"));
    const hoverRule = hoverContract.slice(0, hoverContract.indexOf("}") + 1);
    expect(hoverRule).not.toContain("background:");
    expect(hoverRule).not.toContain("color:");
  });
});
