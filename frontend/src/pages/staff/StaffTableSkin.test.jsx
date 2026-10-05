import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StaffTable from "./StaffTable";

vi.mock("../../components/Icon", () => ({ default: () => <span aria-hidden="true" /> }));

const props = {
  staffLoading: false,
  staffError: "",
  visibleStaff: [],
  pendingActionId: "",
  openEditModal: vi.fn(),
  archiveStaff: vi.fn(),
  restoreStaff: vi.fn(),
};

describe("canonical Staff role table visual skin", () => {
  it.each([
    ["waiter", { isWaiter: true }, 8],
    ["cashier", { isCashier: true }, 8],
    ["manager", { isManager: true }, 7],
    ["warehouse", { isWarehouse: true }, 7],
    ["monoblock", { isMonoblock: true }, 8],
    ["other roles", {}, 8],
  ])("scopes %s skin and preserves its column contract", (_role, flags, columns) => {
    const { container } = render(<StaffTable {...props} {...flags} />);
    const shell = container.querySelector(".staff-table-wrapper--roles");
    expect(shell.querySelector(":scope > .staff-role-table-scroll > .staff-table")).not.toBeNull();
    expect(shell.querySelectorAll("thead th")).toHaveLength(columns);
    expect(shell.querySelector(".staff-empty-cell").colSpan).toBe(columns);
  });

  it("limits the V30 palette and hover to the role wrapper without changing geometry", () => {
    const css = readFileSync(`${process.cwd()}/src/styles/owner/staff-users.css`, "utf8");
    const skin = css.slice(css.indexOf("/* STAFF-TABLE-V1:"));
    expect(skin).toContain("border-color: var(--neutral-200, #d0d9e8)");
    expect(skin).toContain("border-top-color: var(--neutral-200, #d0d9e8)");
    expect(skin).toContain("background: var(--blue-50, #eff6ff)");
    expect(skin).toContain("background: var(--neutral-50, #f4f7fc)");
    expect(skin).toContain("border-radius: 20px");
    expect(skin).toContain("overflow-x: auto");
    expect(skin).toContain("tr:not(.staff-empty-row):hover td");
    expect(skin).toContain("transition: none");
    const selectors = [...skin.matchAll(/(?:^|\n)(\.[^{]+)\{/g)].map((match) => match[1].trim());
    expect(selectors.length).toBe(9);
    expect(selectors.every((selector) => selector.includes(".staff-table-wrapper--roles"))).toBe(true);
    expect(skin).not.toMatch(/(?:^|[;\s])(?:width|height|min-width|min-height|padding|font-size|font-weight|transform)\s*:/);
    expect(skin).not.toContain("!important");
  });
});
