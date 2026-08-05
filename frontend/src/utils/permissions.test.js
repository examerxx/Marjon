import { describe, expect, it } from "vitest";
import {
  canAccessPath,
  canAccessSection,
  canPerform,
  filterNavItems,
  getRole,
  getRoleHomePath,
} from "./permissions";

const users = {
  owner: { role_slugs: ["owner"] },
  superadmin: { is_superadmin: true, role_slugs: [] },
  admin: { role_slugs: ["admin"] },
  manager: { role_slugs: ["manager"] },
  cashier: { role_slugs: ["cashier"] },
  waiter: { role_slugs: ["waiter"] },
  kitchen: { role_slugs: ["kitchen"] },
  unknown: { role_slugs: ["auditor"] },
  noRole: { role_slugs: [] },
};

describe("permissions", () => {
  it("allows owner and super admin to access all sections", () => {
    const owner = { role_slugs: ["owner"] };
    const admin = { is_superadmin: true, role_slugs: [] };

    expect(getRole(owner)).toBe("owner");
    expect(getRole(admin)).toBe("superadmin");
    expect(canAccessSection(owner, "finance")).toBe(true);
    expect(canAccessSection(admin, "unknown-section")).toBe(true);
  });

  it("keeps cashier access limited to cashier sections", () => {
    const cashier = { role_slugs: ["cashier"] };

    expect(getRole(cashier)).toBe("cashier");
    expect(canAccessSection(cashier, "orders")).toBe(true);
    expect(canAccessSection(cashier, "settings.profile")).toBe(true);
    expect(canAccessSection(cashier, "finance")).toBe(false);
  });

  it("filters navigation safely when user data is missing", () => {
    expect(filterNavItems([{ key: "orders" }], null)).toEqual([]);
  });

  it("allows profile and support to approved known roles only", () => {
    [users.owner, users.superadmin, users.admin, users.manager, users.cashier, users.waiter, users.kitchen]
      .forEach((user) => {
        expect(canAccessPath(user, "/settings/profile")).toBe(true);
        expect(canAccessPath(user, "/settings/support")).toBe(true);
      });

    expect(canAccessPath(users.unknown, "/settings/profile")).toBe(false);
    expect(canAccessPath(users.noRole, "/settings/support")).toBe(false);
  });

  it("keeps store access aligned with orders", () => {
    [users.owner, users.superadmin, users.admin, users.manager, users.cashier].forEach((user) => {
      expect(canAccessPath(user, "/orders")).toBe(true);
      expect(canAccessPath(user, "/store")).toBe(true);
    });

    [users.waiter, users.kitchen, users.unknown, users.noRole].forEach((user) => {
      expect(canAccessPath(user, "/orders")).toBe(false);
      expect(canAccessPath(user, "/store")).toBe(false);
    });
  });

  it("limits reviews to owner, superadmin, admin, and manager", () => {
    [users.owner, users.superadmin, users.admin, users.manager].forEach((user) => {
      expect(canAccessPath(user, "/reviews")).toBe(true);
    });

    [users.cashier, users.waiter, users.kitchen, users.unknown, users.noRole].forEach((user) => {
      expect(canAccessPath(user, "/reviews")).toBe(false);
    });
  });

  it("keeps admin route access aligned with manager without granting write permissions", () => {
    expect(canAccessPath(users.admin, "/finance/transactions")).toBe(canAccessPath(users.manager, "/finance/transactions"));
    expect(canAccessPath(users.admin, "/store")).toBe(canAccessPath(users.manager, "/store"));
    expect(canAccessPath(users.admin, "/reviews")).toBe(canAccessPath(users.manager, "/reviews"));
    expect(canPerform(users.admin, "finance.write")).toBe(false);
    expect(canPerform(users.admin, "orders.write")).toBe(false);
    expect(canPerform(users.manager, "finance.write")).toBe(true);
  });

  it("returns safe role homes without falling back to owner", () => {
    expect(getRoleHomePath(users.owner)).toBe("/");
    expect(getRoleHomePath(users.superadmin)).toBe("/");
    expect(getRoleHomePath(users.admin)).toBe("/");
    expect(getRoleHomePath(users.manager)).toBe("/");
    expect(getRoleHomePath(users.cashier)).toBe("/orders");
    expect(getRoleHomePath(users.waiter)).toBe("/waiter");
    expect(getRoleHomePath(users.kitchen)).toBe("/kitchen");
    expect(getRoleHomePath(users.unknown)).toBe("/login");
    expect(getRoleHomePath(users.noRole)).toBe("/login");
  });
});
