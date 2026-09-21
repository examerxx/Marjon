import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const authClient = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  isAuthenticated: vi.fn(() => false),
  login: vi.fn(),
  loginByPhone: vi.fn(),
  loginByPin: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("./api/client", () => ({
  api: {
    get: authClient.get,
    post: authClient.post,
    patch: authClient.patch,
    delete: authClient.delete,
  },
  isAuthenticated: authClient.isAuthenticated,
  login: authClient.login,
  loginByPhone: authClient.loginByPhone,
  loginByPin: authClient.loginByPin,
  logout: authClient.logout,
  formatMoney: (value, currency = "UZS") => `${Number(value || 0)} ${currency}`,
  formatNumber: (value) => String(Number(value || 0)),
}));

vi.mock("./api/receipt", () => ({
  printKitchenReceipt: vi.fn(),
  printOrderReceipt: vi.fn(),
}));

const appUser = (role, id = role) => ({
  id,
  email: `${id}@marjon.test`,
  auth_scope: "app",
  company_id: "company-1",
  is_superadmin: false,
  role_slugs: role ? [role] : [],
});

const users = {
  owner: appUser("owner"),
  admin: appUser("admin"),
  manager: appUser("manager"),
  cashier: appUser("cashier"),
  waiter: appUser("waiter"),
  kitchen: appUser("kitchen"),
  monoblock: appUser("monoblock"),
  courier: appUser("courier"),
  warehouse: appUser("warehouse"),
  superadmin: {
    id: "superadmin",
    email: "superadmin@marjon.test",
    auth_scope: "hq_admin",
    company_id: null,
    is_superadmin: true,
    role_slugs: [],
  },
};

function emptyApiResponse(url) {
  if (url === "/analytics/dashboard") return {};
  return [];
}

function mockAuthenticatedUser(user, staffUsers = []) {
  localStorage.setItem("access_token", "test-token");
  authClient.isAuthenticated.mockReturnValue(true);
  authClient.get.mockImplementation((url) => {
    if (url === "/auth/me") return Promise.resolve({ data: user });
    if (url === "/auth/staff-users") return Promise.resolve({ data: staffUsers });
    return Promise.resolve({ data: emptyApiResponse(url) });
  });
}

function renderAt(pathname) {
  window.history.pushState({}, "", pathname);
  return render(<App />);
}

async function waitForPath(pathname) {
  await waitFor(() => expect(window.location.pathname).toBe(pathname));
}

describe("Web Launch V1 route surfaces", () => {
  beforeEach(() => {
    authClient.isAuthenticated.mockReturnValue(false);
    authClient.get.mockResolvedValue({ data: null });
  });

  it("redirects an unauthenticated protected route to the OWNER login", async () => {
    renderAt("/finance/transactions");
    await waitForPath("/login");
  });

  it("keeps the canonical OWNER Web shell available", async () => {
    mockAuthenticatedUser(users.owner);
    renderAt("/settings/support");

    await waitForPath("/settings/support");
    await waitFor(() => expect(document.querySelector(".dashboard-shell")).toBeInTheDocument());
  });

  it.each([
    ["manager", users.manager, "/"],
    ["cashier", users.cashier, "/orders"],
    ["waiter", users.waiter, "/"],
    ["kitchen", users.kitchen, "/"],
    ["monoblock", users.monoblock, "/orders"],
    ["courier", users.courier, "/"],
    ["warehouse", users.warehouse, "/"],
    ["legacy admin", users.admin, "/finance/transactions"],
    ["SUPER_ADMIN HQ identity", users.superadmin, "/"],
  ])("does not mount the OWNER APP for %s", async (_, user, pathname) => {
    mockAuthenticatedUser(user);
    renderAt(pathname);

    await waitForPath("/login");
    expect(document.querySelector(".dashboard-shell")).not.toBeInTheDocument();
  });

  it.each([
    "/login/staff",
    "/login/pin/employee-1",
    "/waiter",
    "/waiter/new",
    "/waiter/order/order-1",
    "/waiter/orders",
    "/kitchen",
  ])("deactivates the legacy Web client URL %s", async (pathname) => {
    mockAuthenticatedUser(users.owner);
    renderAt(pathname);

    await waitForPath("/login");
    expect(document.querySelector(".dashboard-shell")).not.toBeInTheDocument();
  });

  it("preserves OWNER staff-role filtering and all assignable operational role values", async () => {
    const staffUsers = [
      { id: "cashier-1", email: "cashier1@marjon.test", name: "Cashier One", role_slug: "cashier", role_slugs: ["cashier"], is_active: true },
      { id: "waiter-1", email: "waiter1@marjon.test", name: "Waiter One", role_slug: "waiter", role_slugs: ["waiter"], is_active: true },
    ];
    mockAuthenticatedUser(users.owner, staffUsers);
    renderAt("/users");

    await waitForPath("/users");
    await waitFor(() => expect(document.body).toHaveTextContent("Cashier One"));
    expect(document.body).toHaveTextContent("Waiter One");

    const roleFilter = document.querySelector(".staff-filters select");
    const roleValues = Array.from(roleFilter.options).map((option) => option.value);
    expect(roleValues).toEqual([
      "",
      "cashier",
      "waiter",
      "courier",
      "monoblock",
      "kitchen",
      "manager",
      "warehouse",
    ]);
  });

  it("removes the filter panel on the cashier page but keeps route filtering", async () => {
    const staffUsers = [
      { id: "cashier-1", email: "cashier1@marjon.test", name: "Cashier One", role_slug: "cashier", role_slugs: ["cashier"], is_active: true },
      { id: "waiter-1", email: "waiter1@marjon.test", name: "Waiter One", role_slug: "waiter", role_slugs: ["waiter"], is_active: true },
    ];
    mockAuthenticatedUser(users.owner, staffUsers);
    renderAt("/users/cashier");

    await waitForPath("/users/cashier");
    await waitFor(() => expect(document.body).toHaveTextContent("Cashier One"));
    expect(document.body).not.toHaveTextContent("Waiter One");

    expect(document.querySelector(".staff-filters")).toBeNull();
  });
});
